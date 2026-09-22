#!/usr/bin/env python3
"""Validate privacy-safe physical-device real-app stability evidence for Android v1.6.

This gate intentionally validates evidence only. It never marks the Android release gate closed,
never performs network I/O and never treats a TEMPLATE as test evidence.
"""
from __future__ import annotations

import argparse
import copy
import datetime as dt
import json
import re
import sys
from pathlib import Path

COMMIT_RE = re.compile(r"^[0-9a-f]{40}$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
CATEGORIES = {"browser", "video", "shopping", "banking", "messaging", "maps", "streaming", "other"}
NETWORKS = {"wifi", "mobile"}
RECOVERY = {"none", "allowlist", "reload_lists", "restart_vpn", "disable_smart_detector"}
MIN_OBSERVATIONS = 12
MIN_CATEGORIES = 6
MIN_TOTAL_MINUTES = 60
MAX_HEARTBEAT_AGE_MS = 15_000
MAX_OBSERVATIONS = 80


class WitnessError(ValueError):
    pass


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise WitnessError(message)


def _iso(value: object, field: str) -> str:
    text = str(value or "").strip()
    try:
        parsed = dt.datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError as exc:
        raise WitnessError(f"{field} must be ISO-8601") from exc
    _require(parsed.tzinfo is not None, f"{field} must include a timezone")
    return parsed.astimezone(dt.timezone.utc).isoformat().replace("+00:00", "Z")


def validate_witness(raw: dict) -> dict:
    _require(isinstance(raw, dict), "witness must be a JSON object")
    _require(raw.get("template") is not True, "TEMPLATE cannot be accepted as real-app evidence")
    _require(raw.get("schema") == 1, "schema must be 1")
    _require(raw.get("scope") == "xADKiller Android v1.6 physical real-app stability witness", "scope mismatch")
    _require(raw.get("release_gate_closed") is False, "real-app witness must keep release_gate_closed=false")

    candidate = raw.get("candidate")
    _require(isinstance(candidate, dict), "candidate object is required")
    source_commit = str(candidate.get("source_commit") or "").lower()
    apk_sha256 = str(candidate.get("apk_sha256") or "").lower()
    _require(bool(COMMIT_RE.fullmatch(source_commit)), "source_commit must be a 40-character lowercase Git commit")
    _require(bool(SHA256_RE.fullmatch(apk_sha256)), "apk_sha256 must be a 64-character lowercase SHA-256")

    device = raw.get("device")
    _require(isinstance(device, dict), "device object is required")
    model = str(device.get("model") or "").strip()
    _require(2 <= len(model) <= 120, "device.model must be present")
    sdk = device.get("android_sdk")
    _require(isinstance(sdk, int) and 26 <= sdk <= 100, "device.android_sdk must be an integer >= 26")

    observations = raw.get("observations")
    _require(isinstance(observations, list), "observations must be a list")
    _require(MIN_OBSERVATIONS <= len(observations) <= MAX_OBSERVATIONS,
             f"observations must contain {MIN_OBSERVATIONS}..{MAX_OBSERVATIONS} records")

    categories: set[str] = set()
    networks: set[str] = set()
    total_minutes = 0
    false_positives = 0
    recovered_false_positives = 0
    timestamps: list[str] = []

    for index, item in enumerate(observations, 1):
        _require(isinstance(item, dict), f"observation {index} must be an object")
        category = str(item.get("category") or "").lower()
        network = str(item.get("network") or "").lower()
        recovery = str(item.get("recovery") or "none").lower()
        _require(category in CATEGORIES, f"observation {index}: invalid category")
        _require(network in NETWORKS, f"observation {index}: invalid network")
        _require(recovery in RECOVERY, f"observation {index}: invalid recovery")
        categories.add(category)
        networks.add(network)
        timestamps.append(_iso(item.get("observed_at"), f"observation {index}.observed_at"))

        minutes = item.get("minutes")
        _require(isinstance(minutes, int) and 1 <= minutes <= 30, f"observation {index}: minutes must be 1..30")
        total_minutes += minutes

        heartbeat_age = item.get("vpn_heartbeat_age_ms")
        _require(isinstance(heartbeat_age, int) and 0 <= heartbeat_age <= MAX_HEARTBEAT_AGE_MS,
                 f"observation {index}: VPN heartbeat is stale or invalid")
        _require(item.get("protection_active") is True, f"observation {index}: protection_active must be true")
        _require(item.get("expected_content_ok") is True, f"observation {index}: expected content failed")

        false_positive = item.get("false_positive")
        recovered = item.get("recovered")
        _require(isinstance(false_positive, bool), f"observation {index}: false_positive must be boolean")
        _require(isinstance(recovered, bool), f"observation {index}: recovered must be boolean")
        if false_positive:
            false_positives += 1
            _require(recovered, f"observation {index}: false positive was not recovered")
            _require(recovery != "none", f"observation {index}: recovered false positive needs an explicit recovery")
            recovered_false_positives += 1
        else:
            _require(recovery == "none", f"observation {index}: recovery without a false positive is not valid evidence")
            _require(recovered is False, f"observation {index}: recovered must be false when no false positive occurred")

        forbidden = {"url", "uri", "host", "hostname", "domain", "package", "app_name", "title", "query", "path"}
        present = sorted(key for key in forbidden if key in item)
        _require(not present, f"observation {index}: privacy-sensitive fields are forbidden: {', '.join(present)}")

    _require(len(categories) >= MIN_CATEGORIES, f"need at least {MIN_CATEGORIES} app categories")
    _require(networks == NETWORKS, "both wifi and mobile observations are required")
    _require(total_minutes >= MIN_TOTAL_MINUTES, f"need at least {MIN_TOTAL_MINUTES} cumulative real-app minutes")

    return {
        "schema": 1,
        "scope": raw["scope"],
        "candidate": {"source_commit": source_commit, "apk_sha256": apk_sha256, "bound": True},
        "device": {"model": model, "android_sdk": sdk},
        "summary": {
            "observations": len(observations),
            "categories": len(categories),
            "networks": sorted(networks),
            "total_minutes": total_minutes,
            "false_positives": false_positives,
            "recovered_false_positives": recovered_false_positives,
            "content_failures": 0,
            "stale_heartbeat_observations": 0,
        },
        "real_app_review_ready": True,
        "release_gate_closed": False,
        "privacy": {
            "urls_hosts_packages_titles": "forbidden",
            "telemetry": False,
            "network_upload": False,
        },
    }


def _valid_fixture() -> dict:
    categories = ["browser", "video", "shopping", "banking", "messaging", "maps"]
    observations = []
    for index in range(12):
        observations.append({
            "observed_at": f"2026-09-20T{index:02d}:00:00Z",
            "category": categories[index % len(categories)],
            "network": "wifi" if index < 6 else "mobile",
            "minutes": 5,
            "vpn_heartbeat_age_ms": 5000 + (index % 3) * 1000,
            "protection_active": True,
            "expected_content_ok": True,
            "false_positive": index == 7,
            "recovered": index == 7,
            "recovery": "allowlist" if index == 7 else "none",
        })
    return {
        "schema": 1,
        "scope": "xADKiller Android v1.6 physical real-app stability witness",
        "template": False,
        "candidate": {"source_commit": "a" * 40, "apk_sha256": "b" * 64},
        "device": {"model": "physical-test-device", "android_sdk": 35},
        "release_gate_closed": False,
        "observations": observations,
    }


def self_test() -> None:
    valid = _valid_fixture()
    summary = validate_witness(valid)
    _require(summary["summary"]["total_minutes"] == 60, "self-test total-minute math failed")
    _require(summary["summary"]["false_positives"] == 1, "self-test false-positive math failed")
    _require(summary["release_gate_closed"] is False, "self-test release gate invariant failed")

    cases = []
    bad = copy.deepcopy(valid); bad["template"] = True; cases.append((bad, "TEMPLATE"))
    bad = copy.deepcopy(valid); bad["candidate"]["apk_sha256"] = "0" * 63; cases.append((bad, "apk_sha256"))
    bad = copy.deepcopy(valid); bad["observations"][0]["vpn_heartbeat_age_ms"] = 15_001; cases.append((bad, "heartbeat"))
    bad = copy.deepcopy(valid); bad["observations"][7]["recovered"] = False; cases.append((bad, "not recovered"))
    bad = copy.deepcopy(valid); bad["observations"][0]["url"] = "https://example.invalid"; cases.append((bad, "privacy-sensitive"))
    bad = copy.deepcopy(valid); bad["observations"] = bad["observations"][:11]; cases.append((bad, "observations"))
    bad = copy.deepcopy(valid)
    for item in bad["observations"]: item["network"] = "wifi"
    cases.append((bad, "both wifi and mobile"))

    for candidate, expected in cases:
        try:
            validate_witness(candidate)
        except WitnessError as exc:
            _require(expected.lower() in str(exc).lower(), f"self-test expected {expected!r}, got {exc!s}")
        else:
            raise WitnessError(f"self-test expected failure containing {expected!r}")
    print("Android real-app witness contract self-test: PASS")


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("witness", nargs="?", type=Path)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args(argv)
    if args.self_test:
        self_test()
        return 0
    if not args.witness:
        parser.error("witness path is required unless --self-test is used")
    try:
        raw = json.loads(args.witness.read_text(encoding="utf-8"))
        result = validate_witness(raw)
    except (OSError, json.JSONDecodeError, WitnessError) as exc:
        print(f"Android real-app witness: FAIL: {exc}", file=sys.stderr)
        return 2
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
