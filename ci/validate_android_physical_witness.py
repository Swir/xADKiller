#!/usr/bin/env python3
"""Validate xADKiller Android v1.6 physical-device witness bundles.

Schema 3 ties lifecycle observations to fresh, advancing VPN heartbeats, explicit
radio-state evidence during handover, every captured soak checkpoint and, when
an APK is supplied, to the exact APK SHA-256. Synthetic/host-only evidence can
test this validator but never closes the physical-device release gate by itself.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import tempfile
from pathlib import Path, PurePosixPath

TRUE_RUNNING = re.compile(r'(?:name="running" value="true"|<boolean name="running" value="true")')
HEARTBEAT = re.compile(r'<long name="vpn_heartbeat_v121" value="(\d+)"')
VERSION_CODE = re.compile(r'\bversionCode=(\d+)\b')
VERSION_NAME = re.compile(r'\bversionName=([^\s]+)')
SHA256_RE = re.compile(r'^[0-9a-f]{64}$')
SERIAL_HASH_RE = re.compile(r'^[0-9a-f]{16}$')
COMMIT_RE = re.compile(r'^[0-9a-f]{40}$')
TESTED_ARTIFACT_RE = re.compile(r'^xADKiller-Android-v1\.6\.0-dev-debug-([0-9a-f]{40})\.apk$')
PRIVACY_MARKER = 'local-only-device-id-hashed-no-urls-no-hostnames-no-app-traffic-log'
PROVENANCE_CONTRACT = 'exact-sha-v1'
CANONICAL_ARTIFACT = 'xADKiller-Android-v1.6.0-dev-debug.apk'
PROVENANCE_SNAPSHOT_KEYS = ('schema', 'provenance_contract', 'source_commit', 'artifact', 'tested_artifact', 'apk_sha256')
WITNESS_MANIFEST = 'witness-manifest.sha256'
MANIFEST_EXCLUDED = frozenset({WITNESS_MANIFEST, 'validation-summary.json', 'validator.txt'})
MANIFEST_ROW_RE = re.compile(r'^([0-9a-f]{64})  (.+)$')
ALLOWED_BUILD_PROPERTIES = (
    'ro.build.version.release',
    'ro.build.version.sdk',
    'ro.build.version.security_patch',
    'ro.product.cpu.abi',
)
SOAK_LABEL_RE = re.compile(r'^soak_(\d+)m$')
DEFAULT_MAX_HEARTBEAT_AGE_MS = 30_000
MAX_HEARTBEAT_FUTURE_SKEW_MS = 15_000
SOAK_ELAPSED_TOLERANCE_SECONDS = 2


def read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8", errors="replace")
    except FileNotFoundError:
        return ""


def read_env(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    for raw in read_text(path).splitlines():
        if not raw or raw.startswith("#") or "=" not in raw:
            continue
        key, value = raw.split("=", 1)
        out[key.strip()] = value.strip()
    return out


def read_metadata(root: Path) -> dict[str, str]:
    return read_env(root / "metadata.env")


def read_canonical_provenance(root: Path) -> tuple[dict[str, str], Path]:
    path = root / "build-provenance.env"
    assert path.is_file(), "missing canonical build-provenance.env snapshot"
    out: dict[str, str] = {}
    for raw in read_text(path).splitlines():
        assert raw and not raw.startswith("#") and "=" in raw, "canonical build provenance contains an invalid line"
        key, value = raw.split("=", 1)
        key = key.strip()
        value = value.strip()
        assert key not in out, f"canonical build provenance contains duplicate key: {key}"
        out[key] = value
    assert tuple(out.keys()) == PROVENANCE_SNAPSHOT_KEYS, "canonical build provenance keys/order are invalid"
    return out, path


def assert_witness_tree_safe(root: Path) -> None:
    for path in root.rglob('*'):
        rel = path.relative_to(root).as_posix()
        assert not path.is_symlink(), f"symbolic links are forbidden in witness tree: {rel}"
        assert path.is_file() or path.is_dir(), f"unsupported witness filesystem entry: {rel}"
        if path.is_file():
            assert path.stat(follow_symlinks=False).st_nlink == 1, f"hard-linked witness file is forbidden: {rel}"


def verify_witness_manifest(root: Path) -> tuple[str, int]:
    assert_witness_tree_safe(root)
    manifest_path = root / WITNESS_MANIFEST
    assert manifest_path.is_file(), f"missing {WITNESS_MANIFEST}"
    rows: list[str] = []
    declared: dict[str, str] = {}
    for raw in read_text(manifest_path).splitlines():
        match = MANIFEST_ROW_RE.fullmatch(raw)
        assert match, f"invalid witness manifest row: {raw!r}"
        digest, rel = match.groups()
        posix = PurePosixPath(rel)
        assert not posix.is_absolute(), f"absolute path forbidden in witness manifest: {rel}"
        assert rel not in MANIFEST_EXCLUDED, f"post-validation file forbidden in witness manifest: {rel}"
        assert rel not in declared, f"duplicate witness manifest path: {rel}"
        assert all(part not in ('', '.', '..') for part in posix.parts), f"unsafe path in witness manifest: {rel}"
        target = root.joinpath(*posix.parts)
        assert not target.is_symlink(), f"symbolic link forbidden in witness manifest: {rel}"
        assert target.is_file(), f"witness manifest references missing file: {rel}"
        actual = sha256_file(target)
        assert actual == digest, f"witness manifest digest mismatch: {rel}"
        declared[rel] = digest
        rows.append(rel)
    assert rows, "witness manifest is empty"
    assert rows == sorted(rows), "witness manifest paths must be sorted"
    actual_files = sorted(
        path.relative_to(root).as_posix()
        for path in root.rglob('*')
        if path.is_file() and path.relative_to(root).as_posix() not in MANIFEST_EXCLUDED
    )
    assert rows == actual_files, "witness manifest file set mismatch"
    return sha256_file(manifest_path), len(rows)


def write_witness_manifest_for_self_test(root: Path) -> None:
    paths = sorted(
        path for path in root.rglob('*')
        if path.is_file() and path.relative_to(root).as_posix() not in MANIFEST_EXCLUDED
    )
    lines = [f"{sha256_file(path)}  {path.relative_to(root).as_posix()}" for path in paths]
    (root / WITNESS_MANIFEST).write_text("\n".join(lines) + "\n", encoding="utf-8")


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


def radio_state(snap: Path) -> tuple[str, str]:
    data = read_env(snap / "radio-state.env")
    wifi = data.get("wifi_on", "")
    mobile = data.get("mobile_data", "")
    assert wifi in {"0", "1"}, f"{snap.name}: wifi_on radio state is missing/invalid: {wifi!r}"
    assert mobile in {"0", "1"}, f"{snap.name}: mobile_data radio state is missing/invalid: {mobile!r}"
    return wifi, mobile


def validate_getprop_privacy(snap: Path) -> None:
    path = snap / "getprop.txt"
    text = read_text(path)
    assert text, f"{snap.name}: privacy-safe getprop snapshot is missing"
    seen: set[str] = set()
    for raw in text.splitlines():
        if not raw.strip():
            continue
        assert "=" in raw, f"{snap.name}: getprop line is not allowlist key=value form"
        key, _value = raw.split("=", 1)
        assert key in ALLOWED_BUILD_PROPERTIES, f"{snap.name}: forbidden getprop key in witness: {key}"
        assert key not in seen, f"{snap.name}: duplicate getprop key in witness: {key}"
        seen.add(key)
    assert seen == set(ALLOWED_BUILD_PROPERTIES), f"{snap.name}: getprop allowlist is incomplete"


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


def expected_soak_minutes(total: int) -> list[int]:
    if total <= 0:
        return []
    values = list(range(5, total + 1, 5))
    if not values or values[-1] != total:
        values.append(total)
    return values


def validate(root: Path, apk_path: Path | None = None) -> dict[str, object]:
    meta = read_metadata(root)
    assert meta.get("schema") == "3", "physical witness schema 3 is required for gate-quality evidence"
    assert not meta.get("serial", ""), "raw device serial is forbidden in physical witness metadata"
    serial_hash = meta.get("serial_hash", "")
    assert SERIAL_HASH_RE.fullmatch(serial_hash), "serial_hash must be lowercase 16-hex"
    assert meta.get("serial_privacy") == "sha256-16", "serial_privacy must be sha256-16"
    assert meta.get("privacy") == PRIVACY_MARKER, "physical witness privacy marker is missing/invalid"
    source_commit = meta.get("source_commit", "").lower()
    assert COMMIT_RE.fullmatch(source_commit), "source_commit must be lowercase 40-hex"
    timeline = read_timeline(root)
    snapshot(root, "baseline")
    snapshot(root, "final")
    for label in timeline:
        validate_getprop_privacy(snapshot(root, label))

    try:
        max_age_ms = int(meta.get("max_heartbeat_age_ms", str(DEFAULT_MAX_HEARTBEAT_AGE_MS)))
    except ValueError:
        raise AssertionError("max_heartbeat_age_ms must be an integer") from None
    assert 5_000 <= max_age_ms <= 60_000, "max_heartbeat_age_ms outside reviewed bounds"

    try:
        soak_minutes = int(meta.get("requested_soak_minutes", "0") or 0)
    except ValueError:
        raise AssertionError("requested_soak_minutes must be an integer") from None
    assert soak_minutes >= 0, "requested_soak_minutes cannot be negative"

    requested = {
        "handover": meta.get("requested_handover") == "1",
        "sleep_wake": meta.get("requested_sleep_wake") == "1",
        "idle": meta.get("requested_idle") == "1",
        "package_replace": meta.get("requested_package_replace") == "1",
        "soak_minutes": soak_minutes,
    }
    checks: dict[str, str] = {"snapshot_property_privacy": "PASS (allowlisted build properties only)"}

    if meta.get("apk_supplied") == "1":
        expected = meta.get("apk_sha256", "").lower()
        apk_basename = meta.get("apk_basename", "")
        provenance_artifact = meta.get("provenance_artifact", "")
        tested_artifact = meta.get("provenance_tested_artifact", "")
        provenance_snapshot_sha256 = meta.get("provenance_snapshot_sha256", "").lower()
        assert meta.get("provenance_bound") == "1", "APK witness must be bound to build provenance"
        assert meta.get("provenance_contract") == PROVENANCE_CONTRACT, "provenance_contract must be exact-sha-v1"
        assert provenance_artifact == CANONICAL_ARTIFACT, "provenance_artifact must be the canonical APK name"
        artifact_match = TESTED_ARTIFACT_RE.fullmatch(tested_artifact)
        assert artifact_match, "provenance_tested_artifact is missing/invalid"
        assert artifact_match.group(1) == source_commit, "provenance_tested_artifact does not bind source_commit"
        assert apk_basename == tested_artifact, "apk_basename must match provenance_tested_artifact"
        assert SHA256_RE.fullmatch(expected), "metadata APK SHA-256 is missing/invalid"
        assert SHA256_RE.fullmatch(provenance_snapshot_sha256), "provenance_snapshot_sha256 is missing/invalid"
        provenance_snapshot, provenance_path = read_canonical_provenance(root)
        actual_provenance_sha256 = sha256_file(provenance_path)
        assert actual_provenance_sha256 == provenance_snapshot_sha256, "canonical build provenance snapshot SHA-256 mismatch"
        assert provenance_snapshot["schema"] == "1", "canonical build provenance schema must be 1"
        assert provenance_snapshot["provenance_contract"] == PROVENANCE_CONTRACT, "canonical build provenance contract mismatch"
        assert provenance_snapshot["source_commit"] == source_commit, "canonical build provenance source_commit mismatch"
        assert provenance_snapshot["artifact"] == CANONICAL_ARTIFACT == provenance_artifact, "canonical build provenance artifact mismatch"
        assert provenance_snapshot["tested_artifact"] == tested_artifact, "canonical build provenance tested_artifact mismatch"
        assert provenance_snapshot["apk_sha256"] == expected, "canonical build provenance APK SHA-256 mismatch"
        assert apk_path is not None and apk_path.is_file(), "--apk is required to verify the witnessed APK bytes"
        assert apk_path.name == tested_artifact, "provided --apk basename does not match provenance_tested_artifact"
        actual = sha256_file(apk_path)
        assert actual == expected, f"APK SHA-256 mismatch ({actual} != {expected})"
        checks["apk_provenance"] = f"PASS ({source_commit[:12]} / {actual[:12]})"
        checks["provenance_snapshot"] = f"PASS ({actual_provenance_sha256[:12]})"
    else:
        assert not (root / "build-provenance.env").exists(), "unexpected build provenance snapshot without APK"
        if requested["package_replace"]:
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
        wifi_snap = snapshot(root, "wifi_ready")
        mobile_snap = snapshot(root, "mobile_only")
        restored_snap = snapshot(root, "wifi_restored")
        wifi = read_text(wifi_snap / "connectivity.txt")
        mobile = read_text(mobile_snap / "connectivity.txt")
        restored = read_text(restored_snap / "connectivity.txt")
        wifi_radio = radio_state(wifi_snap)
        mobile_radio = radio_state(mobile_snap)
        restored_radio = radio_state(restored_snap)
        assert wifi_radio[0] == "1", "wifi_ready: Wi-Fi radio is not proven enabled"
        assert mobile_radio[0] == "0", "mobile_only: Wi-Fi radio is not proven disabled"
        assert mobile_radio[1] == "1", "mobile_only: mobile data radio is not proven enabled"
        assert restored_radio[0] == "1", "wifi_restored: Wi-Fi radio is not proven re-enabled"
        assert has_transport(wifi, "WIFI"), "wifi_ready: Wi-Fi transport not observed"
        assert has_transport(mobile, "CELLULAR"), "mobile_only: cellular transport not observed"
        assert has_transport(restored, "WIFI"), "wifi_restored: Wi-Fi transport not observed"
        wifi_hb = require_running(root, "wifi_ready", timeline, max_age_ms)
        mobile_hb = require_running(root, "mobile_only", timeline, max_age_ms)
        restored_hb = require_running(root, "wifi_restored", timeline, max_age_ms)
        require_advanced(wifi_hb, mobile_hb, "wifi_to_mobile_handover")
        require_advanced(mobile_hb, restored_hb, "mobile_to_wifi_handover")
        checks["wifi_mobile_wifi_handover"] = "PASS (transport + radio-state + heartbeat)"

    if soak_minutes > 0:
        start_hb = require_running(root, "soak_start", timeline, max_age_ms)
        soak_start_epoch = timeline["soak_start"]
        previous_hb = start_hb
        checkpoints = expected_soak_minutes(soak_minutes)
        for minute in checkpoints:
            label = f"soak_{minute}m"
            current_hb = require_running(root, label, timeline, max_age_ms)
            require_advanced(previous_hb, current_hb, f"soak_{minute}m_liveness")
            elapsed_seconds = timeline[label] - soak_start_epoch
            minimum_elapsed = minute * 60 - SOAK_ELAPSED_TOLERANCE_SECONDS
            assert elapsed_seconds >= minimum_elapsed, (
                f"{label}: claimed soak duration is not proven by timeline "
                f"({elapsed_seconds}s elapsed, need at least {minimum_elapsed}s)"
            )
            previous_hb = current_hb
        checks["soak_liveness"] = (
            f"PASS ({soak_minutes}m real elapsed, {len(checkpoints)} checkpoint(s))"
        )

    baseline_hb = require_running(root, "baseline", timeline, max_age_ms)
    assert final_heartbeat >= baseline_hb, "final VPN heartbeat regressed behind baseline"
    checks["heartbeat_freshness"] = f"PASS (max_age={max_age_ms}ms)"

    manifest_sha256, manifest_files = verify_witness_manifest(root)
    checks["witness_manifest"] = f"PASS ({manifest_files} files / {manifest_sha256[:12]})"

    summary = {
        "schema": 3,
        "package": meta.get("package", ""),
        "serial_hash": serial_hash,
        "serial_privacy": meta.get("serial_privacy", ""),
        "privacy": meta.get("privacy", ""),
        "source_commit": source_commit,
        "provenance_bound": meta.get("provenance_bound", "0") == "1",
        "provenance_contract": meta.get("provenance_contract", "none"),
        "provenance_artifact": meta.get("provenance_artifact", ""),
        "provenance_tested_artifact": meta.get("provenance_tested_artifact", ""),
        "provenance_snapshot_sha256": meta.get("provenance_snapshot_sha256", ""),
        "witness_manifest_sha256": manifest_sha256,
        "witness_manifest_files": manifest_files,
        "requested": requested,
        "checks": checks,
        "snapshot_count": len(timeline),
        "release_gate_closed": False,
        "note": "Physical witness integrity passed; human review and the remaining full release gate are still required.",
    }
    (root / "validation-summary.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    return summary


def write_snapshot(
    root: Path,
    name: str,
    *,
    epoch: int,
    transport: str = "WIFI",
    wifi_on: str = "1",
    mobile_data: str = "1",
    heartbeat_offset_ms: int = -1000,
) -> None:
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
    (path / "radio-state.env").write_text(
        f"wifi_on={wifi_on}\nmobile_data={mobile_data}\n",
        encoding="utf-8",
    )
    (path / "getprop.txt").write_text(
        "\n".join([
            "ro.build.version.release=15",
            "ro.build.version.sdk=35",
            "ro.build.version.security_patch=2026-09-05",
            "ro.product.cpu.abi=arm64-v8a",
        ]) + "\n",
        encoding="utf-8",
    )


def self_test() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        source_commit = "a" * 40
        tested_artifact = f"xADKiller-Android-v1.6.0-dev-debug-{source_commit}.apk"
        apk = root / tested_artifact
        apk.write_bytes(b"xADKiller physical witness fixture\n")
        apk_sha = sha256_file(apk)
        provenance_path = root / "build-provenance.env"
        provenance_path.write_text(
            "\n".join([
                "schema=1",
                "provenance_contract=" + PROVENANCE_CONTRACT,
                "source_commit=" + source_commit,
                "artifact=" + CANONICAL_ARTIFACT,
                f"tested_artifact={tested_artifact}",
                f"apk_sha256={apk_sha}",
            ]) + "\n",
            encoding="utf-8",
        )
        provenance_sha = sha256_file(provenance_path)
        (root / "metadata.env").write_text(
            "\n".join([
                "schema=3",
                "package=com.swir.xadkiller.debug",
                "serial_hash=0123456789abcdef",
                "serial_privacy=sha256-16",
                "privacy=" + PRIVACY_MARKER,
                "source_commit=" + source_commit,
                "requested_handover=1",
                "requested_sleep_wake=1",
                "requested_idle=1",
                "requested_package_replace=1",
                "requested_soak_minutes=10",
                "apk_supplied=1",
                f"apk_basename={tested_artifact}",
                f"apk_sha256={apk_sha}",
                "provenance_bound=1",
                "provenance_contract=" + PROVENANCE_CONTRACT,
                "provenance_artifact=" + CANONICAL_ARTIFACT,
                f"provenance_tested_artifact={tested_artifact}",
                f"provenance_snapshot_sha256={provenance_sha}",
                "max_heartbeat_age_ms=30000",
            ]) + "\n",
            encoding="utf-8",
        )
        names = [
            "baseline", "pre_package_replace", "post_package_replace", "pre_sleep", "post_wake",
            "pre_idle", "forced_idle", "post_idle", "wifi_ready", "mobile_only", "wifi_restored",
            "soak_start", "soak_5m", "soak_10m", "final",
        ]
        rows = []
        soak_start_epoch = 1_700_000_000 + names.index("soak_start") * 10
        for index, name in enumerate(names):
            epoch = 1_700_000_000 + index * 10
            if name == "soak_start":
                epoch = soak_start_epoch
            elif name == "soak_5m":
                epoch = soak_start_epoch + 5 * 60
            elif name == "soak_10m":
                epoch = soak_start_epoch + 10 * 60
            elif name == "final":
                epoch = soak_start_epoch + 10 * 60 + 10
            transport = "CELLULAR" if name == "mobile_only" else "WIFI"
            wifi_on = "0" if name == "mobile_only" else "1"
            write_snapshot(root, name, epoch=epoch, transport=transport, wifi_on=wifi_on, mobile_data="1")
            rows.append(f"{epoch}\t{name}")
        (root / "timeline.tsv").write_text("\n".join(rows) + "\n", encoding="utf-8")
        write_witness_manifest_for_self_test(root)

        summary = validate(root, apk)
        assert summary["schema"] == 3
        assert summary["serial_hash"] == "0123456789abcdef"
        assert summary["serial_privacy"] == "sha256-16"
        assert "serial" not in summary
        assert summary["checks"]["wifi_mobile_wifi_handover"].startswith("PASS")
        assert summary["checks"]["soak_liveness"] == "PASS (10m real elapsed, 2 checkpoint(s))"
        assert summary["checks"]["apk_provenance"].startswith("PASS")
        assert summary["provenance_bound"] is True
        assert summary["provenance_contract"] == PROVENANCE_CONTRACT
        assert summary["provenance_artifact"] == CANONICAL_ARTIFACT
        assert summary["provenance_tested_artifact"] == tested_artifact
        assert summary["provenance_snapshot_sha256"] == provenance_sha
        assert summary["checks"]["provenance_snapshot"].startswith("PASS")
        assert summary["checks"]["witness_manifest"].startswith("PASS")
        assert summary["witness_manifest_files"] > 0
        assert SHA256_RE.fullmatch(summary["witness_manifest_sha256"])
        assert summary["release_gate_closed"] is False

        metadata_path = root / "metadata.env"
        original_metadata = metadata_path.read_text(encoding="utf-8")
        metadata_path.write_text(original_metadata + "serial=TEST123\n", encoding="utf-8")
        try:
            validate(root, apk)
        except AssertionError as error:
            assert "raw device serial is forbidden" in str(error)
        else:
            raise AssertionError("raw device serial metadata was accepted")
        metadata_path.write_text(original_metadata, encoding="utf-8")

        metadata_path.write_text(original_metadata.replace("serial_hash=0123456789abcdef", "serial_hash=not-a-hash"), encoding="utf-8")
        try:
            validate(root, apk)
        except AssertionError as error:
            assert "serial_hash must be lowercase 16-hex" in str(error)
        else:
            raise AssertionError("invalid serial_hash was accepted")
        metadata_path.write_text(original_metadata, encoding="utf-8")

        metadata_path.write_text(original_metadata.replace("serial_privacy=sha256-16\n", ""), encoding="utf-8")
        try:
            validate(root, apk)
        except AssertionError as error:
            assert "serial_privacy must be sha256-16" in str(error)
        else:
            raise AssertionError("missing serial_privacy marker was accepted")
        metadata_path.write_text(original_metadata, encoding="utf-8")

        metadata_path.write_text(original_metadata.replace("privacy=" + PRIVACY_MARKER + "\n", ""), encoding="utf-8")
        try:
            validate(root, apk)
        except AssertionError as error:
            assert "privacy marker is missing/invalid" in str(error)
        else:
            raise AssertionError("missing privacy marker was accepted")
        metadata_path.write_text(original_metadata, encoding="utf-8")

        metadata_path.write_text(original_metadata.replace("source_commit=" + "a" * 40, "source_commit=unknown"), encoding="utf-8")
        try:
            validate(root, apk)
        except AssertionError as error:
            assert "source_commit must be lowercase 40-hex" in str(error)
        else:
            raise AssertionError("invalid source_commit was accepted")
        metadata_path.write_text(original_metadata, encoding="utf-8")

        metadata_path.write_text(original_metadata.replace("provenance_bound=1", "provenance_bound=0"), encoding="utf-8")
        try:
            validate(root, apk)
        except AssertionError as error:
            assert "must be bound to build provenance" in str(error)
        else:
            raise AssertionError("unbound APK provenance was accepted")
        metadata_path.write_text(original_metadata, encoding="utf-8")

        bad_artifact = f"xADKiller-Android-v1.6.0-dev-debug-{'b' * 40}.apk"
        metadata_path.write_text(original_metadata.replace(tested_artifact, bad_artifact), encoding="utf-8")
        try:
            validate(root, apk)
        except AssertionError as error:
            assert "does not bind source_commit" in str(error) or "basename" in str(error)
        else:
            raise AssertionError("mismatched tested_artifact was accepted")
        metadata_path.write_text(original_metadata, encoding="utf-8")

        original_provenance = provenance_path.read_text(encoding="utf-8")
        provenance_path.write_text(original_provenance.replace("artifact=" + CANONICAL_ARTIFACT, "artifact=tampered.apk"), encoding="utf-8")
        try:
            validate(root, apk)
        except AssertionError as error:
            assert "snapshot SHA-256 mismatch" in str(error) or "artifact mismatch" in str(error)
        else:
            raise AssertionError("tampered canonical provenance snapshot was accepted")
        provenance_path.write_text(original_provenance, encoding="utf-8")

        getprop_path = root / "snapshots" / "baseline" / "getprop.txt"
        original_getprop = getprop_path.read_text(encoding="utf-8")
        getprop_path.write_text(original_getprop + "ro.serialno=TEST123\n", encoding="utf-8")
        try:
            validate(root, apk)
        except AssertionError as error:
            assert "forbidden getprop key" in str(error)
        else:
            raise AssertionError("forbidden getprop identifier was accepted")
        getprop_path.write_text(original_getprop, encoding="utf-8")

        mobile_path = root / "snapshots" / "mobile_only" / "connectivity.txt"
        original_mobile = mobile_path.read_text(encoding="utf-8")
        mobile_path.write_text("NetworkCapabilities: TRANSPORT_WIFI\n", encoding="utf-8")
        try:
            validate(root, apk)
        except AssertionError as error:
            assert "cellular transport not observed" in str(error)
        else:
            raise AssertionError("tampered handover transport evidence was accepted")
        mobile_path.write_text(original_mobile, encoding="utf-8")

        radio_path = root / "snapshots" / "mobile_only" / "radio-state.env"
        original_radio = radio_path.read_text(encoding="utf-8")
        radio_path.write_text("wifi_on=1\nmobile_data=1\n", encoding="utf-8")
        try:
            validate(root, apk)
        except AssertionError as error:
            assert "Wi-Fi radio is not proven disabled" in str(error)
        else:
            raise AssertionError("tampered handover radio evidence was accepted")
        radio_path.write_text(original_radio, encoding="utf-8")

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

        missing_checkpoint = root / "snapshots" / "soak_5m"
        renamed_checkpoint = root / "snapshots" / "soak_5m-missing"
        missing_checkpoint.rename(renamed_checkpoint)
        try:
            validate(root, apk)
        except AssertionError as error:
            assert "missing snapshot: soak_5m" in str(error)
        else:
            raise AssertionError("missing soak checkpoint was accepted")
        renamed_checkpoint.rename(missing_checkpoint)

        timeline_path = root / "timeline.tsv"
        original_timeline = timeline_path.read_text(encoding="utf-8")
        compressed_rows = []
        for row in original_timeline.splitlines():
            epoch_raw, label = row.split("\t", 1)
            if label == "soak_10m":
                epoch_raw = str(soak_start_epoch + 20)
            elif label == "final":
                epoch_raw = str(soak_start_epoch + 30)
            compressed_rows.append(f"{epoch_raw}\t{label}")
        timeline_path.write_text("\n".join(compressed_rows) + "\n", encoding="utf-8")
        try:
            validate(root, apk)
        except AssertionError as error:
            assert (
                "claimed soak duration is not proven by timeline" in str(error)
                or "timeline timestamps moved backwards" in str(error)
            )
        else:
            raise AssertionError("compressed soak timeline was accepted")
        timeline_path.write_text(original_timeline, encoding="utf-8")

        manifest_tamper = root / "snapshots" / "baseline" / "getprop.txt"
        original_manifest_tamper = manifest_tamper.read_text(encoding="utf-8")
        manifest_tamper.write_text(original_manifest_tamper.replace("ro.build.version.release=15", "ro.build.version.release=14"), encoding="utf-8")
        try:
            validate(root, apk)
        except AssertionError as error:
            assert "witness manifest digest mismatch" in str(error)
        else:
            raise AssertionError("witness bundle tamper outside semantic gates was accepted")
        manifest_tamper.write_text(original_manifest_tamper, encoding="utf-8")

        linked = root / "linked-evidence.txt"
        linked.symlink_to(root / "metadata.env")
        try:
            validate(root, apk)
        except AssertionError as error:
            assert "symbolic links are forbidden in witness tree" in str(error)
        else:
            raise AssertionError("symbolic-link witness entry was accepted")
        linked.unlink()

        hardlinked = root / "hardlinked-evidence.txt"
        try:
            hardlinked.hardlink_to(root / "metadata.env")
            try:
                validate(root, apk)
            except AssertionError as error:
                assert "hard-linked witness file is forbidden" in str(error)
            else:
                raise AssertionError("hard-linked witness entry was accepted")
        finally:
            if hardlinked.exists():
                hardlinked.unlink()

        bad_dir = root / "tampered"
        bad_dir.mkdir()
        bad_apk = bad_dir / tested_artifact
        bad_apk.write_bytes(b"different APK bytes\n")
        try:
            validate(root, bad_apk)
        except AssertionError as error:
            assert "APK SHA-256 mismatch" in str(error)
        else:
            raise AssertionError("wrong APK bytes were accepted")

    print("Android physical witness validator schema-3 self-test: PASS")


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
