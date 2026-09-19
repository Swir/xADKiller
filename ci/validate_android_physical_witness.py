#!/usr/bin/env python3
"""Validate xADKiller Android v1.6 physical-device witness bundles.

This validator deliberately does not convert a synthetic/host-only run into physical-device
release evidence. It checks that requested lifecycle transitions produced coherent adb snapshots
and that the debug app's local SharedPreferences prove protection remained live afterwards.
"""
from __future__ import annotations

import argparse
import json
import re
import tempfile
from pathlib import Path

TRUE_RUNNING = re.compile(r'(?:name="running" value="true"|<boolean name="running" value="true")')
HEARTBEAT = re.compile(r'<long name="vpn_heartbeat_v121" value="(\d+)"')


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


def require_running(root: Path, name: str) -> None:
    running, heartbeat = running_state(snapshot(root, name))
    assert running, f"{name}: VPN running=true not proven in local preferences"
    assert heartbeat > 0, f"{name}: positive VPN heartbeat not proven"


def has_transport(text: str, transport: str) -> bool:
    token = transport.upper()
    return bool(re.search(rf'\b(?:TRANSPORT_)?{re.escape(token)}\b', text.upper()))


def validate(root: Path) -> dict[str, object]:
    meta = read_metadata(root)
    assert meta.get("schema") == "1", "unsupported/missing witness schema"
    snapshot(root, "baseline")
    snapshot(root, "final")

    requested = {
        "handover": meta.get("requested_handover") == "1",
        "sleep_wake": meta.get("requested_sleep_wake") == "1",
        "idle": meta.get("requested_idle") == "1",
        "package_replace": meta.get("requested_package_replace") == "1",
        "soak_minutes": int(meta.get("requested_soak_minutes", "0") or 0),
    }
    checks: dict[str, str] = {}

    # Gate-quality evidence requires protection to be active at the end regardless of which
    # optional lifecycle slices were requested.
    require_running(root, "final")
    checks["final_vpn_liveness"] = "PASS"

    if requested["package_replace"]:
        require_running(root, "pre_package_replace")
        require_running(root, "post_package_replace")
        checks["package_replace_resume"] = "PASS"

    if requested["sleep_wake"]:
        require_running(root, "pre_sleep")
        require_running(root, "post_wake")
        checks["sleep_wake_liveness"] = "PASS"

    if requested["idle"]:
        require_running(root, "pre_idle")
        require_running(root, "forced_idle")
        require_running(root, "post_idle")
        checks["idle_liveness"] = "PASS"

    if requested["handover"]:
        wifi = read_text(snapshot(root, "wifi_ready") / "connectivity.txt")
        mobile = read_text(snapshot(root, "mobile_only") / "connectivity.txt")
        restored = read_text(snapshot(root, "wifi_restored") / "connectivity.txt")
        assert has_transport(wifi, "WIFI"), "wifi_ready: Wi-Fi transport not observed"
        assert has_transport(mobile, "CELLULAR"), "mobile_only: cellular transport not observed"
        assert has_transport(restored, "WIFI"), "wifi_restored: Wi-Fi transport not observed"
        require_running(root, "mobile_only")
        require_running(root, "wifi_restored")
        checks["wifi_mobile_wifi_handover"] = "PASS"

    soak_minutes = int(requested["soak_minutes"])
    if soak_minutes > 0:
        require_running(root, "soak_start")
        require_running(root, f"soak_{soak_minutes}m")
        checks["soak_liveness"] = f"PASS ({soak_minutes}m)"

    # Keep raw logs local in the bundle, but provide a small machine-readable summary for review.
    timeline = [line for line in read_text(root / "timeline.tsv").splitlines() if line.strip()]
    assert len(timeline) >= 2, "timeline must contain at least baseline and final snapshots"
    summary = {
        "schema": 1,
        "package": meta.get("package", ""),
        "serial": meta.get("serial", ""),
        "requested": requested,
        "checks": checks,
        "snapshot_count": len(timeline),
        "release_gate_closed": False,
        "note": "Physical witness integrity passed; human review and the remaining full release gate are still required.",
    }
    (root / "validation-summary.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    return summary


def write_snapshot(root: Path, name: str, *, transport: str = "WIFI", heartbeat: int = 123456) -> None:
    path = root / "snapshots" / name
    path.mkdir(parents=True, exist_ok=True)
    (path / "prefs.xml").write_text(
        f'<map><boolean name="running" value="true"/><long name="vpn_heartbeat_v121" value="{heartbeat}"/></map>\n',
        encoding="utf-8",
    )
    (path / "connectivity.txt").write_text(f"NetworkCapabilities: TRANSPORT_{transport}\n", encoding="utf-8")


def self_test() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        (root / "metadata.env").write_text(
            "\n".join([
                "schema=1",
                "package=com.swir.xadkiller.debug",
                "serial=TEST123",
                "requested_handover=1",
                "requested_sleep_wake=1",
                "requested_idle=1",
                "requested_package_replace=1",
                "requested_soak_minutes=1",
            ]) + "\n",
            encoding="utf-8",
        )
        for name in [
            "baseline", "final", "pre_package_replace", "post_package_replace",
            "pre_sleep", "post_wake", "pre_idle", "forced_idle", "post_idle",
            "wifi_ready", "mobile_only", "wifi_restored", "soak_start", "soak_1m",
        ]:
            transport = "CELLULAR" if name == "mobile_only" else "WIFI"
            write_snapshot(root, name, transport=transport)
        (root / "timeline.tsv").write_text(
            "\n".join(f"{1700000000+i}\t{name}" for i, name in enumerate([
                "baseline", "pre_package_replace", "post_package_replace", "pre_sleep", "post_wake",
                "pre_idle", "forced_idle", "post_idle", "wifi_ready", "mobile_only", "wifi_restored",
                "soak_start", "soak_1m", "final",
            ])) + "\n",
            encoding="utf-8",
        )
        summary = validate(root)
        assert summary["checks"]["wifi_mobile_wifi_handover"] == "PASS"
        assert summary["release_gate_closed"] is False

        # Tamper regression: a requested handover without a cellular observation must fail.
        (root / "snapshots" / "mobile_only" / "connectivity.txt").write_text(
            "NetworkCapabilities: TRANSPORT_WIFI\n", encoding="utf-8"
        )
        try:
            validate(root)
        except AssertionError as error:
            assert "cellular transport not observed" in str(error)
        else:
            raise AssertionError("tampered handover evidence was accepted")

    print("Android physical witness validator self-test: PASS")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("witness", nargs="?", type=Path)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return
    if args.witness is None:
        parser.error("witness directory is required unless --self-test is used")
    summary = validate(args.witness)
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
