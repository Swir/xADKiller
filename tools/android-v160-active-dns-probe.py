#!/usr/bin/env python3
"""Active on-device DNS smoke probe for the Android v1.6 physical release gate.

The tool never contacts a web service itself. It drives a locally connected adb device,
binds evidence to the tested APK when supplied, stores only a short SHA-256 of the adb
serial, and verifies repeated benign/blocking DNS behavior while the local VPN heartbeat
remains fresh and advances across the probe window. Schema 3 also records and gates the
underlying Android network on VALIDATED/non-captive Wi-Fi, cellular or Ethernet evidence
so a DNS pass behind a captive portal or an ambiguous VPN-only snapshot cannot be counted
as release-quality handover evidence.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
import sys
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterable

SCHEMA = 3
DEFAULT_ALLOWED = ("example.com",)
DEFAULT_BLOCKED = (
    "doubleclick.net",
    "googleadservices.com",
    "googlesyndication.com",
)
HEARTBEAT_MAX_AGE_MS = 30_000
DEFAULT_REPEAT = 3
DEFAULT_INTERVAL_SECONDS = 6.0
MIN_REPEAT = 2
MAX_REPEAT = 10
MIN_INTERVAL_SECONDS = 1.0
MAX_INTERVAL_SECONDS = 30.0
RESOLVER_FAILURE_TOKENS = (
    "unknown host",
    "bad address",
    "name or service not known",
    "no address associated",
    "not found",
    "nxdomain",
)
KNOWN_TRANSPORTS = ("WIFI", "CELLULAR", "ETHERNET")


@dataclass(frozen=True)
class CommandResult:
    code: int
    output: str


@dataclass(frozen=True)
class ProbeResult:
    domain: str
    expected: str
    classification: str
    exit_code: int
    method: str
    output_excerpt: str
    round_index: int = 1


@dataclass(frozen=True)
class VpnSample:
    round_index: int
    vpn_running: bool | None
    heartbeat_at_ms: int | None
    heartbeat_age_ms: int | None


@dataclass(frozen=True)
class NetworkSample:
    round_index: int
    transport: str
    validated: bool | None
    captive_portal: bool | None
    output_excerpt: str


def run(command: list[str], timeout: int = 20) -> CommandResult:
    proc = subprocess.run(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout,
        check=False,
    )
    return CommandResult(proc.returncode, proc.stdout or "")


def adb_prefix(serial: str) -> list[str]:
    result = ["adb"]
    if serial:
        result += ["-s", serial]
    return result


def adb(serial: str, *args: str, timeout: int = 20) -> CommandResult:
    return run(adb_prefix(serial) + list(args), timeout=timeout)


def normalize_excerpt(text: str, limit: int = 400) -> str:
    compact = re.sub(r"\s+", " ", str(text or "")).strip()
    return compact[:limit]


def classify_resolution(exit_code: int, output: str) -> str:
    text = str(output or "").lower()
    if exit_code == 0:
        return "resolved"
    if any(token in text for token in RESOLVER_FAILURE_TOKENS):
        return "refused_or_unresolved"
    return "command_failed"


def parse_pref_bool(xml: str, key: str) -> bool | None:
    match = re.search(rf'<boolean\s+name="{re.escape(key)}"\s+value="(true|false)"', xml or "", re.I)
    if match:
        return match.group(1).lower() == "true"
    return None


def parse_pref_long(xml: str, key: str) -> int | None:
    match = re.search(rf'<long\s+name="{re.escape(key)}"\s+value="(-?\d+)"', xml or "", re.I)
    if not match:
        return None
    try:
        return int(match.group(1))
    except ValueError:
        return None


def choose_resolver_method(serial: str) -> str:
    # Prefer resolver-only commands so the test does not send application payload traffic.
    getent = adb(serial, "shell", "sh", "-c", "command -v getent >/dev/null 2>&1").code
    if getent == 0:
        return "getent"
    nslookup = adb(serial, "shell", "sh", "-c", "command -v nslookup >/dev/null 2>&1").code
    if nslookup == 0:
        return "nslookup"
    return "ping-fallback"


def resolve(serial: str, method: str, domain: str) -> CommandResult:
    if method == "getent":
        return adb(serial, "shell", "getent", "hosts", domain, timeout=12)
    if method == "nslookup":
        return adb(serial, "shell", "nslookup", domain, timeout=12)
    # Compatibility fallback for stripped Android shells. DNS resolution happens before ICMP.
    return adb(serial, "shell", "ping", "-c", "1", "-W", "3", domain, timeout=12)


def apk_sha256(path: Path | None) -> str:
    if path is None:
        return ""
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def serial_token(serial: str) -> str:
    return hashlib.sha256(serial.encode("utf-8")).hexdigest()[:16]


def source_commit() -> str:
    if not shutil.which("git"):
        return "unknown"
    result = run(["git", "rev-parse", "HEAD"], timeout=5)
    value = result.output.strip().lower()
    return value if result.code == 0 and re.fullmatch(r"[0-9a-f]{40}", value) else "unknown"


def read_vpn_sample(serial: str, package: str, round_index: int, now_ms: int | None = None) -> VpnSample:
    prefs = adb(serial, "shell", "run-as", package, "cat", "shared_prefs/xadkiller_prefs.xml")
    vpn_running = parse_pref_bool(prefs.output, "running") if prefs.code == 0 else None
    heartbeat_at = parse_pref_long(prefs.output, "vpn_heartbeat_v121") if prefs.code == 0 else None
    current_ms = int(time.time() * 1000) if now_ms is None else int(now_ms)
    heartbeat_age_ms = current_ms - heartbeat_at if heartbeat_at and heartbeat_at > 0 else None
    return VpnSample(round_index, vpn_running, heartbeat_at, heartbeat_age_ms)


def _transport_from_block(block: str) -> str:
    upper = block.upper()
    if re.search(r"\b(?:TRANSPORT_)?WIFI\b", upper):
        return "wifi"
    if re.search(r"\b(?:TRANSPORT_)?ETHERNET\b", upper):
        return "ethernet"
    if re.search(r"\b(?:TRANSPORT_)?CELLULAR\b", upper):
        return "cellular"
    return "unknown"


def classify_network_state(text: str) -> tuple[str, bool | None, bool | None, str]:
    """Pick the best non-VPN Android network candidate from dumpsys connectivity.

    NetworkAgentInfo blocks are preferred because Android normally keeps transport and
    capabilities for one network together there. The fallback line scan is intentionally
    conservative: unknown formatting yields unknown/None instead of inventing a pass.
    """
    raw = str(text or "")
    if not raw.strip():
        return "unknown", None, None, ""

    split = re.split(r"(?=NetworkAgentInfo\{)", raw)
    blocks = [part for part in split if "NetworkAgentInfo{" in part]
    if not blocks:
        blocks = [line for line in raw.splitlines() if "CAPABILIT" in line.upper() or "TRANSPORT" in line.upper()]

    candidates: list[tuple[int, str, bool, bool, str]] = []
    for block in blocks:
        upper = block.upper()
        if re.search(r"\bTRANSPORT_VPN\b", upper) or re.search(r"TRANSPORTS?:\s*VPN\b", upper):
            continue
        transport = _transport_from_block(block)
        if transport == "unknown":
            continue
        validated = bool(re.search(r"\bVALIDATED\b", upper))
        captive = bool(re.search(r"\bCAPTIVE_PORTAL\b", upper))
        transport_rank = {"wifi": 3, "ethernet": 2, "cellular": 1}.get(transport, 0)
        score = (100 if validated else 0) + (0 if captive else 20) + transport_rank
        candidates.append((score, transport, validated, captive, normalize_excerpt(block)))

    if not candidates:
        return "unknown", None, None, normalize_excerpt(raw)
    candidates.sort(key=lambda item: item[0], reverse=True)
    _, transport, validated, captive, excerpt = candidates[0]
    return transport, validated, captive, excerpt


def read_network_sample(serial: str, round_index: int) -> NetworkSample:
    result = adb(serial, "shell", "dumpsys", "connectivity", timeout=20)
    if result.code != 0:
        return NetworkSample(round_index, "unknown", None, None, normalize_excerpt(result.output))
    transport, validated, captive, excerpt = classify_network_state(result.output)
    return NetworkSample(round_index, transport, validated, captive, excerpt)


def gate_quality(
    probes: Iterable[ProbeResult],
    vpn_samples: Iterable[VpnSample],
    network_samples: Iterable[NetworkSample],
    artifact_sha256: str,
    expected_rounds: int,
) -> tuple[bool, list[str]]:
    probes = list(probes)
    samples = list(vpn_samples)
    networks = list(network_samples)
    reasons: list[str] = []
    allowed = [p for p in probes if p.expected == "allow"]
    blocked = [p for p in probes if p.expected == "block"]

    if expected_rounds < MIN_REPEAT or len(samples) != expected_rounds:
        reasons.append("dns_stability_window_not_proven")
    rounds_seen = {p.round_index for p in probes}
    if rounds_seen != set(range(1, expected_rounds + 1)):
        reasons.append("dns_round_coverage_incomplete")
    if not allowed or any(p.classification != "resolved" for p in allowed):
        reasons.append("benign_resolution_not_proven")
    if len(blocked) < expected_rounds * 2 or any(p.classification != "refused_or_unresolved" for p in blocked):
        reasons.append("blocking_not_proven")
    if any(sample.vpn_running is not True for sample in samples):
        reasons.append("vpn_running_not_proven")
    if any(
        sample.heartbeat_age_ms is None
        or sample.heartbeat_age_ms < 0
        or sample.heartbeat_age_ms > HEARTBEAT_MAX_AGE_MS
        for sample in samples
    ):
        reasons.append("fresh_heartbeat_not_proven")
    heartbeats = [sample.heartbeat_at_ms for sample in samples if sample.heartbeat_at_ms and sample.heartbeat_at_ms > 0]
    if len(heartbeats) != len(samples) or len(heartbeats) < MIN_REPEAT or heartbeats[-1] <= heartbeats[0]:
        reasons.append("heartbeat_not_advancing")

    if len(networks) != expected_rounds or {n.round_index for n in networks} != set(range(1, expected_rounds + 1)):
        reasons.append("network_round_coverage_incomplete")
    if any(n.transport not in {"wifi", "cellular", "ethernet"} or n.validated is not True for n in networks):
        reasons.append("validated_underlying_network_not_proven")
    if any(n.captive_portal is True for n in networks):
        reasons.append("captive_portal_detected")

    if not re.fullmatch(r"[0-9a-f]{64}", artifact_sha256 or ""):
        reasons.append("apk_sha256_not_bound")
    return not reasons, reasons


def discover_serial(explicit: str) -> str:
    if explicit:
        state = adb(explicit, "get-state")
        if state.code != 0 or state.output.strip() != "device":
            raise RuntimeError(f"adb device is not online: {explicit}")
        return explicit
    result = run(["adb", "devices"], timeout=10)
    devices = []
    for line in result.output.splitlines()[1:]:
        parts = line.strip().split()
        if len(parts) >= 2 and parts[1] == "device":
            devices.append(parts[0])
    if len(devices) != 1:
        raise RuntimeError(f"expected exactly one online adb device; found {len(devices)} (use --serial)")
    return devices[0]


def main() -> int:
    parser = argparse.ArgumentParser(description="xADKiller Android v1.6 active DNS physical probe")
    parser.add_argument("--serial", default="")
    parser.add_argument("--package", default="com.swir.xadkiller.debug")
    parser.add_argument("--apk", default="", help="Exact APK under test; required for gate-quality evidence")
    parser.add_argument("--allowed-domain", action="append", default=[])
    parser.add_argument("--blocked-domain", action="append", default=[])
    parser.add_argument("--repeat", type=int, default=DEFAULT_REPEAT, help=f"Probe rounds ({MIN_REPEAT}..{MAX_REPEAT}); default {DEFAULT_REPEAT}")
    parser.add_argument("--interval-seconds", type=float, default=DEFAULT_INTERVAL_SECONDS, help=f"Delay between rounds ({MIN_INTERVAL_SECONDS}..{MAX_INTERVAL_SECONDS}); default {DEFAULT_INTERVAL_SECONDS:g}")
    parser.add_argument("--out", default="")
    args = parser.parse_args()

    if not shutil.which("adb"):
        print("ERROR: adb is required in PATH", file=sys.stderr)
        return 2
    if not MIN_REPEAT <= args.repeat <= MAX_REPEAT:
        print(f"ERROR: --repeat must be {MIN_REPEAT}..{MAX_REPEAT}", file=sys.stderr)
        return 2
    if not MIN_INTERVAL_SECONDS <= args.interval_seconds <= MAX_INTERVAL_SECONDS:
        print(f"ERROR: --interval-seconds must be {MIN_INTERVAL_SECONDS:g}..{MAX_INTERVAL_SECONDS:g}", file=sys.stderr)
        return 2

    apk_path = Path(args.apk).resolve() if args.apk else None
    if apk_path is not None and not apk_path.is_file():
        print(f"ERROR: APK not found: {apk_path}", file=sys.stderr)
        return 2

    try:
        serial = discover_serial(args.serial)
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2

    method = choose_resolver_method(serial)
    allowed_domains = tuple(args.allowed_domain) or DEFAULT_ALLOWED
    blocked_domains = tuple(args.blocked_domain) or DEFAULT_BLOCKED
    probes: list[ProbeResult] = []
    vpn_samples: list[VpnSample] = []
    network_samples: list[NetworkSample] = []

    for round_index in range(1, args.repeat + 1):
        for expected, domains in (("allow", allowed_domains), ("block", blocked_domains)):
            for domain in domains:
                result = resolve(serial, method, domain)
                probes.append(ProbeResult(
                    domain=domain,
                    expected=expected,
                    classification=classify_resolution(result.code, result.output),
                    exit_code=result.code,
                    method=method,
                    output_excerpt=normalize_excerpt(result.output),
                    round_index=round_index,
                ))
        network_samples.append(read_network_sample(serial, round_index))
        vpn_samples.append(read_vpn_sample(serial, args.package, round_index))
        if round_index != args.repeat:
            time.sleep(args.interval_seconds)

    digest = apk_sha256(apk_path)
    quality, blockers = gate_quality(probes, vpn_samples, network_samples, digest, args.repeat)
    now_ms = int(time.time() * 1000)

    witness = {
        "schema": SCHEMA,
        "created_at_epoch_ms": now_ms,
        "source_commit": source_commit(),
        "package": args.package,
        "device_serial_sha256_16": serial_token(serial),
        "resolver_method": method,
        "apk_sha256": digest,
        "probe_rounds": args.repeat,
        "probe_interval_seconds": args.interval_seconds,
        "vpn_samples": [asdict(sample) for sample in vpn_samples],
        "network_samples": [asdict(sample) for sample in network_samples],
        "probes": [asdict(p) for p in probes],
        "gate_quality": quality,
        "blockers": blockers,
        "release_gate_closed": False,
        "note": "This repeated active-DNS + validated-underlying-network probe supplements, but never replaces, the full physical lifecycle and real-app stability witness.",
    }

    out = Path(args.out).resolve() if args.out else Path("artifacts") / f"android-v160-active-dns-{int(time.time())}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(witness, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({"out": str(out), "gate_quality": quality, "blockers": blockers, "rounds": args.repeat}, sort_keys=True))
    return 0 if quality else 1


if __name__ == "__main__":
    raise SystemExit(main())
