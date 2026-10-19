#!/usr/bin/env python3
"""Compose Android v1.6 physical-device evidence into one non-authorizing qualification result.

This tool deliberately does not close the release gate. It binds the physical lifecycle,
start/stop/restart and real-app witnesses to the same exact source commit and APK bytes,
then emits a privacy-safe summary suitable for final human release review.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

COMMIT_RE = re.compile(r"^[0-9a-f]{40}$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
REQUIRED_PHYSICAL_FLAGS = (
    "requested_handover",
    "requested_sleep_wake",
    "requested_idle",
    "requested_package_replace",
)
MIN_RESTART_CYCLES = 3


class QualificationError(ValueError):
    pass


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise QualificationError(message)


def _read_env(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    try:
        rows = path.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError as exc:
        raise QualificationError(f"cannot read {path}: {exc}") from exc
    for raw in rows:
        if not raw or raw.startswith("#") or "=" not in raw:
            continue
        key, value = raw.split("=", 1)
        out[key.strip()] = value.strip()
    return out


def _sha256_file(path: Path) -> str:
    _require(path.is_file(), f"APK not found: {path}")
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _validate_identity(
    expected_commit: str,
    apk_sha256: str,
    physical_meta: dict[str, str],
    restart_meta: dict[str, str],
    realapp_raw: dict,
) -> dict[str, object]:
    expected_commit = expected_commit.strip().lower()
    apk_sha256 = apk_sha256.strip().lower()
    _require(bool(COMMIT_RE.fullmatch(expected_commit)), "--expected-commit must be a 40-character lowercase Git commit")
    _require(bool(SHA256_RE.fullmatch(apk_sha256)), "computed APK SHA-256 is invalid")

    physical_commit = str(physical_meta.get("source_commit") or "").lower()
    restart_commit = str(restart_meta.get("source_commit") or "").lower()
    candidate = realapp_raw.get("candidate") if isinstance(realapp_raw, dict) else None
    _require(isinstance(candidate, dict), "real-app witness candidate object is missing")
    realapp_commit = str(candidate.get("source_commit") or "").lower()
    realapp_apk = str(candidate.get("apk_sha256") or "").lower()

    for label, value in (
        ("physical source_commit", physical_commit),
        ("restart source_commit", restart_commit),
        ("real-app source_commit", realapp_commit),
    ):
        _require(bool(COMMIT_RE.fullmatch(value)), f"{label} is missing/invalid")
        _require(value == expected_commit, f"{label} does not match expected commit")

    _require(physical_meta.get("apk_supplied") == "1", "physical witness is not bound to APK bytes")
    _require(restart_meta.get("apk_supplied") == "1", "restart witness is not bound to APK bytes")
    physical_apk = str(physical_meta.get("apk_sha256") or "").lower()
    restart_apk = str(restart_meta.get("apk_sha256") or "").lower()
    for label, value in (
        ("physical APK SHA-256", physical_apk),
        ("restart APK SHA-256", restart_apk),
        ("real-app APK SHA-256", realapp_apk),
    ):
        _require(bool(SHA256_RE.fullmatch(value)), f"{label} is missing/invalid")
        _require(value == apk_sha256, f"{label} does not match tested APK bytes")

    missing_flags = [flag for flag in REQUIRED_PHYSICAL_FLAGS if physical_meta.get(flag) != "1"]
    _require(not missing_flags, "physical lifecycle witness did not exercise: " + ", ".join(missing_flags))

    try:
        restart_cycles = int(restart_meta.get("cycles", "0"))
    except ValueError as exc:
        raise QualificationError("restart cycles must be an integer") from exc
    _require(restart_cycles >= MIN_RESTART_CYCLES, f"restart witness needs at least {MIN_RESTART_CYCLES} cycles")

    return {
        "source_commit": expected_commit,
        "apk_sha256": apk_sha256,
        "restart_cycles": restart_cycles,
        "physical_flags": list(REQUIRED_PHYSICAL_FLAGS),
    }


def _write_atomic(path: Path, data: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    tmp.replace(path)


def qualify(
    physical_dir: Path,
    restart_dir: Path,
    realapp_path: Path,
    apk_path: Path,
    expected_commit: str,
) -> dict[str, object]:
    from validate_android_physical_witness import validate as validate_physical
    from validate_android_realapp_witness import validate_witness as validate_realapp
    from validate_android_restart_witness import validate as validate_restart

    _require(physical_dir.is_dir(), f"physical witness directory not found: {physical_dir}")
    _require(restart_dir.is_dir(), f"restart witness directory not found: {restart_dir}")
    _require(realapp_path.is_file(), f"real-app witness not found: {realapp_path}")
    apk_sha256 = _sha256_file(apk_path)

    try:
        realapp_raw = json.loads(realapp_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise QualificationError(f"cannot read real-app witness: {exc}") from exc

    physical_meta = _read_env(physical_dir / "metadata.env")
    restart_meta = _read_env(restart_dir / "metadata.env")
    identity = _validate_identity(expected_commit, apk_sha256, physical_meta, restart_meta, realapp_raw)

    try:
        physical = validate_physical(physical_dir, apk_path)
        restart = validate_restart(restart_dir, apk_path)
        realapp = validate_realapp(realapp_raw)
    except (AssertionError, ValueError) as exc:
        raise QualificationError(f"component witness validation failed: {exc}") from exc

    for label, summary in (("physical", physical), ("restart", restart), ("real_app", realapp)):
        _require(summary.get("release_gate_closed") is False, f"{label}: release-gate invariant drifted")

    real_summary = realapp.get("summary") if isinstance(realapp.get("summary"), dict) else {}
    result = {
        "schema": 1,
        "scope": "xADKiller Android v1.6 physical qualification",
        "candidate": {
            "source_commit": identity["source_commit"],
            "apk_sha256": identity["apk_sha256"],
            "bound": True,
        },
        "components": {
            "physical_lifecycle": {
                "integrity_passed": True,
                "snapshot_count": int(physical.get("snapshot_count", 0)),
                "handover": True,
                "sleep_wake": True,
                "idle": True,
                "package_replace": True,
            },
            "restart": {
                "integrity_passed": True,
                "cycles": int(restart.get("cycles", 0)),
            },
            "real_app": {
                "integrity_passed": True,
                "observations": int(real_summary.get("observations", 0)),
                "categories": int(real_summary.get("categories", 0)),
                "total_minutes": int(real_summary.get("total_minutes", 0)),
                "false_positives": int(real_summary.get("false_positives", 0)),
                "recovered_false_positives": int(real_summary.get("recovered_false_positives", 0)),
            },
        },
        "qualification_review_ready": True,
        "release_gate_closed": False,
        "privacy": {
            "raw_device_identifier": "omitted",
            "urls_hosts_packages_titles": "omitted",
            "network_upload": False,
        },
        "note": "All three physical evidence bundles are integrity-valid and bound to one commit/APK. Human review, full CI and final release policy still decide Release.",
    }
    return result


def self_test() -> None:
    commit = "a" * 40
    apk = "b" * 64
    physical = {
        "source_commit": commit,
        "apk_supplied": "1",
        "apk_sha256": apk,
        **{flag: "1" for flag in REQUIRED_PHYSICAL_FLAGS},
    }
    restart = {"source_commit": commit, "apk_supplied": "1", "apk_sha256": apk, "cycles": "3"}
    realapp = {"candidate": {"source_commit": commit, "apk_sha256": apk}}

    result = _validate_identity(commit, apk, physical, restart, realapp)
    _require(result["restart_cycles"] == 3, "self-test restart cycle math failed")

    bad = dict(restart)
    bad["source_commit"] = "c" * 40
    try:
        _validate_identity(commit, apk, physical, bad, realapp)
    except QualificationError as exc:
        _require("does not match expected commit" in str(exc), "self-test expected commit mismatch")
    else:
        raise QualificationError("self-test accepted mismatched restart commit")

    bad_physical = dict(physical)
    bad_physical["requested_handover"] = "0"
    try:
        _validate_identity(commit, apk, bad_physical, restart, realapp)
    except QualificationError as exc:
        _require("did not exercise" in str(exc), "self-test expected lifecycle coverage failure")
    else:
        raise QualificationError("self-test accepted incomplete physical lifecycle coverage")

    bad_realapp = {"candidate": {"source_commit": commit, "apk_sha256": "d" * 64}}
    try:
        _validate_identity(commit, apk, physical, restart, bad_realapp)
    except QualificationError as exc:
        _require("tested APK bytes" in str(exc), "self-test expected APK mismatch")
    else:
        raise QualificationError("self-test accepted mismatched real-app APK")

    print("Android v1.6 qualification identity and release-gate self-test: PASS")


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--physical", type=Path)
    parser.add_argument("--restart", type=Path)
    parser.add_argument("--realapp", type=Path)
    parser.add_argument("--apk", type=Path)
    parser.add_argument("--expected-commit", default="")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args(argv)

    if args.self_test:
        self_test()
        return 0
    missing = [name for name in ("physical", "restart", "realapp", "apk") if getattr(args, name) is None]
    if missing or not args.expected_commit:
        parser.error("--physical --restart --realapp --apk and --expected-commit are required")

    try:
        result = qualify(args.physical, args.restart, args.realapp, args.apk, args.expected_commit)
    except (QualificationError, OSError) as exc:
        print(f"Android v1.6 qualification: FAIL: {exc}", file=sys.stderr)
        return 2

    if args.output:
        _write_atomic(args.output, result)
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
