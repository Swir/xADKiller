#!/usr/bin/env python3
"""Validate xADKiller Android v1.6 physical-device witness bundles.

Schema 2 ties lifecycle observations to fresh, advancing VPN heartbeats and, when an APK is
supplied, to the exact APK SHA-256. Synthetic/host-only evidence can test this validator but
never closes the physical-device release gate by itself.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import tempfile
from pathlib import Path

TRUE_RUNNING = re.compile(r'(?:name="running" value="true"|<boolean name="running" value="true")')
HEARTBEAT = re.compile(r'<long name="vpn_heartbeat_v121" value="(\d+)"')
VERSION_CODE = re.compile(r'\bversionCode=(\d+)\b')
VERSION_NAME = re.compile(r'\bversionName=([^\s]+)')
SHA256_RE = re.compile(r'^[0-9a-f]{64}$')
DEFAULT_MAX_HEARTBEAT_AGE_MS = 30_000
MAX_HEARTBEAT_FUTURE_SKEW_MS = 15_000


def read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8", errors="replace")
    except FileNotFoundError:
        return ""


def read_metadata(root: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    for raw in read_text(root / "metadata.env").splitlines():
        if not raw or raw.startswith("#") or "=" not in raw:
            continue
        key, value = raw.split("=", 1)
        out[key.strip()] = value.strip()
    return out


def read_timeline(root: Path) -> dict[str, int]:
    out: dict[str, int] = {}
    last = -1
    for raw in read_text(root / "timeline.tsv").splitlines():
        if not raw.strip():
            continue
        try:
            epoch_raw, label = raw.split("\t", 1)
            epoch = int(epoch_raw)
        except (ValueError, TypeError):
            raise AssertionError(f"invalid timeline row: {raw!r}") from None
        assert label and label not in out, f"duplicate/empty timeline label: {label!r}"
        assert epoch >= last, "timeline timestamps moved backwards"
        out[label] = epoch
        last = epoch
    assert len(out) >= 2, "timeline must contain at least baseline and final snapshots"
    return out


def snapshot(root: Path, name: str) -> Path:
    path = root / "snapshots" / name
    if not path.is_dir():
        raise AssertionError(f"missing snapshot: {name}")
    return path


def running_state(snap: Path) -> tuple[bool, int]:
    prefs = read_text(snap / "prefs.xml")
    running = bool(TRUE_RUNNING.search(prefs))
    match = HEARTBEAT.search(prefs)
    heartbeat = int(match.group(1)) if match else 0
    return running, heartbeat


def require_running(root: Path, name: str, timeline: dict[str, int], max_age_ms: int) -> int:
    running, heartbeat = running_state(snapshot(root, name))
    assert running, f"{name}: VPN running=true not proven in local preferences"
    assert heartbeat > 0, f"{name}: positive VPN heartbeat not proven"
    assert name in timeline, f"{name}: snapshot missing from timeline"
    snapshot_ms = timeline[name] * 1000
    age_ms = snapshot_ms - heartbeat
    assert age_ms <= max_age_ms, f"{name}: VPN heartbeat is stale by {age_ms} ms (limit {max_age_ms})"
    assert age_ms >= -MAX_HEARTBEAT_FUTURE_SKEW_MS, f"{name}: VPN heartbeat is implausibly in the future ({-age_ms} ms)"
    return heartbeat


def require_advanced(before: int, after: int, label: str) -> None:
    assert after > before, f"{label}: VPN heartbeat did not advance ({before} -> {after})"


def has_transport(text: str, transport: str) -> bool:
    token = transport.upper()
    return bool(re.search(rf'\b(?:TRANSPORT_)?{re.escape(token)}\b', text.upper()))


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def package_identity(snap: Path) -> tuple[str, str]:
    text = read_text(snap / "package.txt")
    code = VERSION_CODE.search(text)
    name = VERSION_NAME.search(text)
    assert code and name, f"{snap.name}: package version identity not found"
    return code.group(1), name.group(1)


def validate(root: Path, apk_path: Path | None = None) -> dict[str, object]:
    meta = read_metadata(root)
    assert meta.get("schema") == "2", "physical witness schema 2 is required for gate-quality evidence"
    timeline = read_timeline(root)
    snapshot(root, "baseline")
    snapshot(root, "final")

    try:
        max_age_ms = int(meta.get("max_heartbeat_age_ms", str(DEFAULT_MAX_HEARTBEAT_AGE_MS)))
    except ValueError:
        raise AssertionError("max_heartbeat_age_ms must be an integer") from None
    assert 5_000 <= max_age_ms <= 60_000, "max_heartbeat_age_ms outside reviewed bounds"

    requested = {
        "handover": meta.get("requested_handover") == "1",
        "sleep_wake": meta.get("requested_sleep_wake") == "1",
        "idle": meta.get("requested_idle") == "1",
        "package_replace": meta.get("requested_package_replace") == "1",
        "soak_minutes": int(meta.get("requested_soak_minutes", "0") or 0),
    }
    checks: dict[str, str] = {}

    if meta.get("apk_supplied") == "1":
        expected = meta.get("apk_sha256", "").lower()
        assert SHA256_RE.fullmatch(expected), "metadata APK SHA-256 is missing/invalid"
        assert apk_path is not None and apk_path.is_file(), "--apk is required to verify the witnessed APK bytes"
        actual = sha256_file(apk_path)
        assert actual == expected, f"APK SHA-256 mismatch ({actual} != {expected})"
        checks["apk_provenance"] = f"PASS ({actual[:12]})"
    elif requested["package_replace"]:
        raise AssertionError("package replacement requires APK provenance")

    final_heartbeat = require_running(root, "final", timeline, max_age_ms)
    checks["final_vpn_liveness"] = "PASS"

    if requested["package_replace"]:
        pre = require_running(root, "pre_package_replace", timeline, max_age_ms)
        post = require_running(root, "post_package_replace", timeline, max_age_ms)
        require_advanced(pre, post, "package_replace_resume")
        before_identity = package_identity(snapshot(root, "pre_package_replace"))
        after_identity = package_identity(snapshot(root, "post_package_replace"))
        assert before_identity == after_identity, f"package identity changed across reinstall: {before_identity} -> {after_identity}"
        checks["package_replace_resume"] = f"PASS (versionCode={after_identity[0]}, versionName={after_identity[1]})"

    if requested["sleep_wake"]:
        pre = require_running(root, "pre_sleep", timeline, max_age_ms)
        post = require_running(root, "post_wake", timeline, max_age_ms)
        require_advanced(pre, post, "sleep_wake_liveness")
        checks["sleep_wake_liveness"] = "PASS"

    if requested["idle"]:
        pre = require_running(root, "pre_idle", timeline, max_age_ms)
        forced = require_running(root, "forced_idle", timeline, max_age_ms)
        post = require_running(root, "post_idle", timeline, max_age_ms)
        require_advanced(pre, forced, "idle_enter_liveness")
        require_advanced(forced, post, "idle_exit_liveness")
        checks["idle_liveness"] = "PASS"

    if requested["handover"]:
        wifi = read_text(snapshot(root, "wifi_ready") / "connectivity.txt")
        mobile = read_text(snapshot(root, "mobile_only") / "connectivity.txt")
        restored = read_text(snapshot(root, "wifi_restored") / "connectivity.txt")
        assert has_transport(wifi, "WIFI"), "wifi_ready: Wi-Fi transport not observed"
        assert has_transport(mobile, "CELLULAR"), "mobile_only: cellular transport not observed"
        assert has_transport(restored, "WIFI"), "wifi_restored: Wi-Fi transport not observed"
        wifi_hb = require_running(root, "wifi_ready", timeline, max_age_ms)
        mobile_hb = require_running(root, "mobile_only", timeline, max_age_ms)
        restored_hb = require_running(root, "wifi_restored", timeline, max_age_ms)
        require_advanced(wifi_hb, mobile_hb, "wifi_to_mobile_handover")
        require_advanced(mobile_hb, restored_hb, "mobile_to_wifi_handover")
        checks["wifi_mobile_wifi_handover"] = "PASS"

    soak_minutes = int(requested["soak_minutes"])
    if soak_minutes > 0:
        start_hb = require_running(root, "soak_start", timeline, max_age_ms)
        end_hb = require_running(root, f"soak_{soak_minutes}m", timeline, max_age_ms)
        require_advanced(start_hb, end_hb, "soak_liveness")
        checks["soak_liveness"] = f"PASS ({soak_minutes}m)"

    baseline_hb = require_running(root, "baseline", timeline, max_age_ms)
    assert final_heartbeat >= baseline_hb, "final VPN heartbeat regressed behind baseline"
    checks["heartbeat_freshness"] = f"PASS (max_age={max_age_ms}ms)"

    summary = {
        "schema": 2,
        "package": meta.get("package", ""),
        "serial": meta.get("serial", ""),
        "source_commit": meta.get("source_commit", ""),
        "requested": requested,
        "checks": checks,
        "snapshot_count": len(timeline),
        "release_gate_closed": False,
        "note": "Physical witness integrity passed; human review and the remaining full release gate are still required.",
    }
    (root / "validation-summary.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    return summary


def write_snapshot(root: Path, name: str, *, epoch: int, transport: str = "WIFI", heartbeat_offset_ms: int = -1000) -> None:
    path = root / "snapshots" / name
    path.mkdir(parents=True, exist_ok=True)
    heartbeat = epoch * 1000 + heartbeat_offset_ms
    (path / "prefs.xml").write_text(
        f'<map><boolean name="running" value="true"/><long name="vpn_heartbeat_v121" value="{heartbeat}"/></map>\n',
        encoding="utf-8",
    )
    (path / "connectivity.txt").write_text(f"NetworkCapabilities: TRANSPORT_{transport}\n", encoding="utf-8")
    (path / "package.txt").write_text("versionCode=160 minSdk=26 targetSdk=35\nversionName=1.6.0-dev\n", encoding="utf-8")
    (path / "snapshot_epoch_seconds.txt").write_text(f"{epoch}\n", encoding="utf-8")


def self_test() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        apk = root / "tested.apk"
        apk.write_bytes(b"xADKiller physical witness fixture\n")
        apk_sha = sha256_file(apk)
        (root / "metadata.env").write_text(
            "\n".join([
                "schema=2",
                "package=com.swir.xadkiller.debug",
                "serial=TEST123",
                "source_commit=" + "a" * 40,
                "requested_handover=1",
                "requested_sleep_wake=1",
                "requested_idle=1",
                "requested_package_replace=1",
                "requested_soak_minutes=1",
                "apk_supplied=1",
                "apk_basename=tested.apk",
                f"apk_sha256={apk_sha}",
                "max_heartbeat_age_ms=30000",
            ]) + "\n",
            encoding="utf-8",
        )
        names = [
            "baseline", "pre_package_replace", "post_package_replace", "pre_sleep", "post_wake",
            "pre_idle", "forced_idle", "post_idle", "wifi_ready", "mobile_only", "wifi_restored",
            "soak_start", "soak_1m", "final",
        ]
        rows = []
        for index, name in enumerate(names):
            epoch = 1_700_000_000 + index * 10
            transport = "CELLULAR" if name == "mobile_only" else "WIFI"
            write_snapshot(root, name, epoch=epoch, transport=transport)
            rows.append(f"{epoch}\t{name}")
        (root / "timeline.tsv").write_text("\n".join(rows) + "\n", encoding="utf-8")

        summary = validate(root, apk)
        assert summary["checks"]["wifi_mobile_wifi_handover"] == "PASS"
        assert summary["checks"]["apk_provenance"].startswith("PASS")
        assert summary["release_gate_closed"] is False

        mobile_path = root / "snapshots" / "mobile_only" / "connectivity.txt"
        original_mobile = mobile_path.read_text(encoding="utf-8")
        mobile_path.write_text("NetworkCapabilities: TRANSPORT_WIFI\n", encoding="utf-8")
        try:
            validate(root, apk)
        except AssertionError as error:
            assert "cellular transport not observed" in str(error)
        else:
            raise AssertionError("tampered handover evidence was accepted")
        mobile_path.write_text(original_mobile, encoding="utf-8")

        stale = root / "snapshots" / "post_wake" / "prefs.xml"
        original_stale = stale.read_text(encoding="utf-8")
        stale.write_text(
            '<map><boolean name="running" value="true"/><long name="vpn_heartbeat_v121" value="1"/></map>\n',
            encoding="utf-8",
        )
        try:
            validate(root, apk)
        except AssertionError as error:
            assert "heartbeat is stale" in str(error)
        else:
            raise AssertionError("stale VPN heartbeat was accepted")
        stale.write_text(original_stale, encoding="utf-8")

        bad_apk = root / "tampered.apk"
        bad_apk.write_bytes(b"different APK bytes\n")
        try:
            validate(root, bad_apk)
        except AssertionError as error:
            assert "APK SHA-256 mismatch" in str(error)
        else:
            raise AssertionError("wrong APK bytes were accepted")

    print("Android physical witness validator schema-2 self-test: PASS")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("witness", nargs="?", type=Path)
    parser.add_argument("--apk", type=Path)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return
    if args.witness is None:
        parser.error("witness directory is required unless --self-test is used")
    summary = validate(args.witness, args.apk)
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
