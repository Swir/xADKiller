#!/usr/bin/env python3
"""Validate local xADKiller Android v1.6 start/stop/restart witness bundles.

Passing this contract proves evidence integrity only. Synthetic/self-test data or
this validator alone can never satisfy the physical-device or final release gate.
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
SERIAL_HASH_RE = re.compile(r'^[0-9a-f]{16}$')
DEFAULT_MAX_HEARTBEAT_AGE_MS = 30_000
MAX_FUTURE_SKEW_MS = 15_000


def read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8", errors="replace")
    except FileNotFoundError:
        return ""


def read_env(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    for raw in read_text(path).splitlines():
        if raw and not raw.startswith("#") and "=" in raw:
            key, value = raw.split("=", 1)
            out[key.strip()] = value.strip()
    return out


def timeline(root: Path) -> dict[str, int]:
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
    return out


def snapshot(root: Path, name: str) -> Path:
    path = root / "snapshots" / name
    assert path.is_dir(), f"missing snapshot: {name}"
    return path


def running_state(path: Path) -> tuple[bool, int]:
    prefs = read_text(path / "prefs.xml")
    match = HEARTBEAT.search(prefs)
    return bool(TRUE_RUNNING.search(prefs)), int(match.group(1)) if match else 0


def require_running(root: Path, name: str, times: dict[str, int], max_age_ms: int) -> int:
    running, heartbeat = running_state(snapshot(root, name))
    assert running, f"{name}: running=true not proven"
    assert heartbeat > 0, f"{name}: positive heartbeat not proven"
    assert name in times, f"{name}: missing timeline row"
    age = times[name] * 1000 - heartbeat
    assert -MAX_FUTURE_SKEW_MS <= age <= max_age_ms, f"{name}: heartbeat freshness invalid ({age} ms)"
    return heartbeat


def require_stopped(root: Path, name: str) -> None:
    running, heartbeat = running_state(snapshot(root, name))
    assert not running, f"{name}: VPN still reports running"
    assert heartbeat == 0, f"{name}: heartbeat must be zero after intentional stop"


def package_identity(path: Path) -> tuple[str, str]:
    text = read_text(path / "package.txt")
    code = VERSION_CODE.search(text)
    name = VERSION_NAME.search(text)
    assert code and name, f"{path.name}: package identity missing"
    return code.group(1), name.group(1)


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def validate(root: Path, apk: Path | None = None) -> dict[str, object]:
    meta = read_env(root / "metadata.env")
    assert meta.get("schema") == "1", "restart witness schema 1 required"
    assert meta.get("scope") == "vpn-start-stop-restart", "unexpected witness scope"
    assert meta.get("privacy") == "local-only-no-urls-no-hostnames-no-app-traffic-log", "privacy contract drifted"
    assert SERIAL_HASH_RE.fullmatch(meta.get("serial_hash", "")), "raw/missing device identifier; expected 16-hex serial hash"
    assert "serial" not in meta, "raw serial field is forbidden"
    try:
        cycles = int(meta.get("cycles", "0"))
        max_age = int(meta.get("max_heartbeat_age_ms", str(DEFAULT_MAX_HEARTBEAT_AGE_MS)))
    except ValueError:
        raise AssertionError("cycles/max_heartbeat_age_ms must be integers") from None
    assert 1 <= cycles <= 10, "cycles must be 1..10"
    assert 5_000 <= max_age <= 60_000, "heartbeat age bound outside reviewed range"

    if meta.get("apk_supplied") == "1":
        expected = meta.get("apk_sha256", "").lower()
        assert SHA256_RE.fullmatch(expected), "APK SHA-256 missing/invalid"
        assert apk is not None and apk.is_file(), "--apk is required to bind witness to bytes"
        assert sha256_file(apk) == expected, "APK SHA-256 mismatch"

    times = timeline(root)
    expected_labels = ["baseline"]
    for index in range(1, cycles + 1):
        expected_labels += [f"cycle_{index}_stopped", f"cycle_{index}_restarted"]
    expected_labels += ["final"]
    assert list(times) == expected_labels, f"unexpected lifecycle sequence: {list(times)!r}"

    baseline = require_running(root, "baseline", times, max_age)
    baseline_identity = package_identity(snapshot(root, "baseline"))
    previous_restart = baseline
    for index in range(1, cycles + 1):
        require_stopped(root, f"cycle_{index}_stopped")
        restarted = require_running(root, f"cycle_{index}_restarted", times, max_age)
        assert restarted > previous_restart, f"cycle {index}: restart heartbeat did not advance"
        assert package_identity(snapshot(root, f"cycle_{index}_restarted")) == baseline_identity, f"cycle {index}: package identity changed"
        previous_restart = restarted
    final = require_running(root, "final", times, max_age)
    assert final >= previous_restart, "final heartbeat regressed"
    assert package_identity(snapshot(root, "final")) == baseline_identity, "final package identity changed"

    summary = {
        "schema":1,
        "scope":"vpn-start-stop-restart",
        "cycles":cycles,
        "package":meta.get("package", ""),
        "source_commit":meta.get("source_commit", ""),
        "apk_bound":meta.get("apk_supplied") == "1",
        "checks":{"baseline_active":"PASS", "stop_zero_heartbeat":"PASS", "restart_fresh_heartbeat":"PASS", "package_identity":"PASS"},
        "release_gate_closed":False,
        "note":"Restart witness integrity passed; physical-device review and the remaining Android release gates are still required."
    }
    (root / "validation-summary.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    return summary


def write_snapshot(root: Path, name: str, epoch: int, running: bool, heartbeat: int) -> None:
    path = root / "snapshots" / name
    path.mkdir(parents=True, exist_ok=True)
    if running:
        prefs = f'<map><boolean name="running" value="true"/><long name="vpn_heartbeat_v121" value="{heartbeat}"/></map>\n'
    else:
        prefs = '<map><boolean name="running" value="false"/><long name="vpn_heartbeat_v121" value="0"/></map>\n'
    (path / "prefs.xml").write_text(prefs, encoding="utf-8")
    (path / "package.txt").write_text("versionCode=160 minSdk=26 targetSdk=35\nversionName=1.6.0-dev\n", encoding="utf-8")


def self_test() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        apk = root / "tested.apk"
        apk.write_bytes(b"xADKiller restart witness fixture\n")
        digest = sha256_file(apk)
        (root / "metadata.env").write_text("\n".join([
            "schema=1", "scope=vpn-start-stop-restart", "package=com.swir.xadkiller.debug",
            "service=com.swir.xadkiller.debug/com.swir.xadkiller.AdBlockVpnServiceV121",
            "serial_hash=0123456789abcdef", "source_commit=" + "a" * 40, "cycles=3",
            "apk_supplied=1", f"apk_sha256={digest}", "max_heartbeat_age_ms=30000",
            "privacy=local-only-no-urls-no-hostnames-no-app-traffic-log"
        ]) + "\n", encoding="utf-8")
        rows = []
        base = 1_700_000_000
        labels = ["baseline", "cycle_1_stopped", "cycle_1_restarted", "cycle_2_stopped", "cycle_2_restarted", "cycle_3_stopped", "cycle_3_restarted", "final"]
        heartbeat = (base * 1000) - 1000
        for i, label in enumerate(labels):
            epoch = base + i * 20
            running = not label.endswith("_stopped")
            if running: heartbeat = epoch * 1000 - 1000
            write_snapshot(root, label, epoch, running, heartbeat if running else 0)
            rows.append(f"{epoch}\t{label}")
        (root / "timeline.tsv").write_text("\n".join(rows) + "\n", encoding="utf-8")
        summary = validate(root, apk)
        assert summary["cycles"] == 3 and summary["release_gate_closed"] is False

        meta = read_text(root / "metadata.env") + "serial=RAWDEVICE\n"
        (root / "metadata.env").write_text(meta, encoding="utf-8")
        try:
            validate(root, apk)
            raise AssertionError("raw serial tamper was accepted")
        except AssertionError as exc:
            assert "raw serial" in str(exc)

    print("Android restart witness validator self-test: PASS")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("root", nargs="?", type=Path)
    parser.add_argument("--apk", type=Path)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return
    if args.root is None:
        parser.error("root is required unless --self-test is used")
    print(json.dumps(validate(args.root, args.apk), indent=2))


if __name__ == "__main__":
    main()
