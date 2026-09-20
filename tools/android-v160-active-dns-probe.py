#!/usr/bin/env python3
"""Active on-device DNS smoke probe for the Android v1.6 physical release gate.

The tool never contacts a web service itself. It drives a locally connected adb device,
binds evidence to the tested APK when supplied, stores only a short SHA-256 of the adb
serial, and verifies that a benign hostname resolves while known high-confidence ad hosts
are refused by the active local VPN/DNS path.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterable

SCHEMA = 1
DEFAULT_ALLOWED = ("example.com",)
DEFAULT_BLOCKED = (
    "doubleclick.net",
    "googleadservices.com",
    "googlesyndication.com",
)
HEARTBEAT_MAX_AGE_MS = 30_000
RESOLVER_FAILURE_TOKENS = (
    "unknown host",
    "bad address",
    "name or service not known",
    "no address associated",
    "not found",
    "nxdomain",
)


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


def gate_quality(
    probes: Iterable[ProbeResult],
    vpn_running: bool | None,
    heartbeat_age_ms: int | None,
    artifact_sha256: str,
) -> tuple[bool, list[str]]:
    probes = list(probes)
    reasons: list[str] = []
    allowed = [p for p in probes if p.expected == "allow"]
    blocked = [p for p in probes if p.expected == "block"]
    if not allowed or any(p.classification != "resolved" for p in allowed):
        reasons.append("benign_resolution_not_proven")
    if len(blocked) < 2 or any(p.classification != "refused_or_unresolved" for p in blocked):
        reasons.append("blocking_not_proven")
    if vpn_running is not True:
        reasons.append("vpn_running_not_proven")
    if heartbeat_age_ms is None or heartbeat_age_ms < 0 or heartbeat_age_ms > HEARTBEAT_MAX_AGE_MS:
        reasons.append("fresh_heartbeat_not_proven")
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
    parser.add_argument("--out", default="")
    args = parser.parse_args()

    if not shutil.which("adb"):
        print("ERROR: adb is required in PATH", file=sys.stderr)
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
            ))

    prefs = adb(serial, "shell", "run-as", args.package, "cat", "shared_prefs/xadkiller_prefs.xml")
    vpn_running = parse_pref_bool(prefs.output, "running") if prefs.code == 0 else None
    heartbeat_at = parse_pref_long(prefs.output, "vpn_heartbeat_v121") if prefs.code == 0 else None
    now_ms = int(time.time() * 1000)
    heartbeat_age_ms = now_ms - heartbeat_at if heartbeat_at and heartbeat_at > 0 else None
    digest = apk_sha256(apk_path)
    quality, blockers = gate_quality(probes, vpn_running, heartbeat_age_ms, digest)

    witness = {
        "schema": SCHEMA,
        "created_at_epoch_ms": now_ms,
        "source_commit": source_commit(),
        "package": args.package,
        "device_serial_sha256_16": serial_token(serial),
        "resolver_method": method,
        "apk_sha256": digest,
        "vpn_running": vpn_running,
        "heartbeat_age_ms": heartbeat_age_ms,
        "probes": [asdict(p) for p in probes],
        "gate_quality": quality,
        "blockers": blockers,
        "release_gate_closed": False,
        "note": "This probe supplements, but never replaces, the full physical lifecycle and real-app stability witness.",
    }

    out = Path(args.out).resolve() if args.out else Path("artifacts") / f"android-v160-active-dns-{int(time.time())}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(witness, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({"out": str(out), "gate_quality": quality, "blockers": blockers}, sort_keys=True))
    return 0 if quality else 1


if __name__ == "__main__":
    raise SystemExit(main())
