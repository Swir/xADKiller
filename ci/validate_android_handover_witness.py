#!/usr/bin/env python3
"""Validate xADKiller Android v1.6 physical Wi-Fi <-> cellular handover evidence.

This validator consumes the privacy-safe schema-3 JSON emitted by
``tools/android-v160-active-dns-probe.py``. It does not drive adb and it never closes the
release gate by itself. Its job is to reject a nominal DNS/VPN pass unless the same bounded
probe window proves an actual validated, non-captive Wi-Fi <-> cellular transition while
VPN heartbeat evidence remains fresh and advancing and the witness is bound to the tested
APK/source commit.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

SCHEMA = 3
MIN_ROUNDS = 2
HEARTBEAT_MAX_AGE_MS = 30_000
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
COMMIT_RE = re.compile(r"^[0-9a-f]{40}$")
SERIAL_TOKEN_RE = re.compile(r"^[0-9a-f]{16}$")
ALLOWED_TRANSPORTS = {"wifi", "cellular", "ethernet"}


def _rounds(items: list[dict]) -> list[int]:
    values: list[int] = []
    for item in items:
        try:
            values.append(int(item.get("round_index", -1)))
        except (TypeError, ValueError):
            values.append(-1)
    return values


def _wifi_cellular_transition(networks: list[dict]) -> bool:
    ordered = sorted(networks, key=lambda item: int(item.get("round_index", -1)))
    transports = [str(item.get("transport", "")).lower() for item in ordered]
    return any({left, right} == {"wifi", "cellular"} for left, right in zip(transports, transports[1:]))


def validate_witness(
    witness: dict,
    *,
    expected_apk_sha256: str = "",
    expected_commit: str = "",
) -> tuple[bool, list[str], dict]:
    blockers: list[str] = []
    if not isinstance(witness, dict):
        return False, ["witness_not_object"], {}

    if witness.get("schema") != SCHEMA:
        blockers.append("schema_not_3")

    try:
        rounds = int(witness.get("probe_rounds", 0))
    except (TypeError, ValueError):
        rounds = 0
    if rounds < MIN_ROUNDS:
        blockers.append("probe_rounds_too_short")

    apk_sha = str(witness.get("apk_sha256", "")).lower()
    if not SHA256_RE.fullmatch(apk_sha):
        blockers.append("apk_sha256_not_bound")
    if expected_apk_sha256:
        expected_apk_sha256 = expected_apk_sha256.lower()
        if not SHA256_RE.fullmatch(expected_apk_sha256) or apk_sha != expected_apk_sha256:
            blockers.append("apk_sha256_mismatch")

    source_commit = str(witness.get("source_commit", "")).lower()
    if not COMMIT_RE.fullmatch(source_commit):
        blockers.append("source_commit_not_bound")
    if expected_commit:
        expected_commit = expected_commit.lower()
        if not COMMIT_RE.fullmatch(expected_commit) or source_commit != expected_commit:
            blockers.append("source_commit_mismatch")

    if not SERIAL_TOKEN_RE.fullmatch(str(witness.get("device_serial_sha256_16", "")).lower()):
        blockers.append("device_identity_not_privacy_safe")

    if witness.get("gate_quality") is not True or witness.get("blockers") not in ([], tuple()):
        blockers.append("active_dns_gate_not_green")
    if witness.get("release_gate_closed") is not False:
        blockers.append("release_gate_semantics_invalid")

    networks = witness.get("network_samples")
    if not isinstance(networks, list):
        networks = []
    expected_rounds = list(range(1, rounds + 1)) if rounds > 0 else []
    if len(networks) != rounds or sorted(_rounds(networks)) != expected_rounds:
        blockers.append("network_round_coverage_incomplete")
    if any(str(item.get("transport", "")).lower() not in ALLOWED_TRANSPORTS for item in networks):
        blockers.append("network_transport_invalid")
    if any(item.get("validated") is not True for item in networks):
        blockers.append("validated_underlying_network_not_proven")
    if any(item.get("captive_portal") is True for item in networks):
        blockers.append("captive_portal_detected")

    transports = [str(item.get("transport", "")).lower() for item in networks]
    if "wifi" not in transports or "cellular" not in transports:
        blockers.append("wifi_cellular_coverage_not_proven")
    if networks and not _wifi_cellular_transition(networks):
        blockers.append("wifi_cellular_handover_not_observed")

    vpn_samples = witness.get("vpn_samples")
    if not isinstance(vpn_samples, list):
        vpn_samples = []
    if len(vpn_samples) != rounds or sorted(_rounds(vpn_samples)) != expected_rounds:
        blockers.append("vpn_round_coverage_incomplete")
    if any(item.get("vpn_running") is not True for item in vpn_samples):
        blockers.append("vpn_running_not_proven")

    heartbeat_at: list[int] = []
    for item in sorted(vpn_samples, key=lambda value: int(value.get("round_index", -1))):
        try:
            age = int(item.get("heartbeat_age_ms"))
            beat = int(item.get("heartbeat_at_ms"))
        except (TypeError, ValueError):
            blockers.append("fresh_heartbeat_not_proven")
            continue
        if age < 0 or age > HEARTBEAT_MAX_AGE_MS or beat <= 0:
            blockers.append("fresh_heartbeat_not_proven")
        heartbeat_at.append(beat)
    if len(heartbeat_at) != rounds or any(right <= left for left, right in zip(heartbeat_at, heartbeat_at[1:])):
        blockers.append("heartbeat_not_advancing")

    probes = witness.get("probes")
    if not isinstance(probes, list):
        probes = []
    probe_rounds = set(_rounds([item for item in probes if isinstance(item, dict)]))
    if probe_rounds != set(expected_rounds):
        blockers.append("dns_round_coverage_incomplete")
    allowed = [item for item in probes if isinstance(item, dict) and item.get("expected") == "allow"]
    if not allowed or any(item.get("classification") != "resolved" for item in allowed):
        blockers.append("benign_resolution_not_proven")
    blocked = [item for item in probes if isinstance(item, dict) and item.get("expected") == "block"]
    if not blocked or any(item.get("classification") != "refused_or_unresolved" for item in blocked):
        blockers.append("blocking_not_proven")

    # Preserve deterministic order while removing duplicate reasons.
    blockers = list(dict.fromkeys(blockers))
    summary = {
        "schema": witness.get("schema"),
        "probe_rounds": rounds,
        "transports": transports,
        "handover_observed": bool(networks and _wifi_cellular_transition(networks)),
        "apk_sha256_bound": SHA256_RE.fullmatch(apk_sha) is not None,
        "source_commit_bound": COMMIT_RE.fullmatch(source_commit) is not None,
        "release_gate_closed": False,
    }
    return not blockers, blockers, summary


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Validate xADKiller Android v1.6 Wi-Fi/cellular handover witness")
    parser.add_argument("--witness", required=True, help="Schema-3 active DNS witness JSON")
    parser.add_argument("--expected-apk-sha256", default="")
    parser.add_argument("--expected-commit", default="")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    try:
        witness = json.loads(Path(args.witness).read_text(encoding="utf-8"))
    except Exception as exc:
        print(json.dumps({"ok": False, "blockers": ["witness_unreadable"], "error": str(exc)}, sort_keys=True))
        return 2
    ok, blockers, summary = validate_witness(
        witness,
        expected_apk_sha256=args.expected_apk_sha256,
        expected_commit=args.expected_commit,
    )
    print(json.dumps({"ok": ok, "blockers": blockers, "summary": summary}, sort_keys=True))
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
