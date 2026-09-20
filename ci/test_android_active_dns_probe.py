#!/usr/bin/env python3
import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
TOOL = ROOT / "tools" / "android-v160-active-dns-probe.py"
spec = importlib.util.spec_from_file_location("xad_android_dns_probe", TOOL)
probe = importlib.util.module_from_spec(spec)
assert spec.loader is not None
# dataclasses resolves postponed annotations through sys.modules on newer Python releases.
sys.modules[spec.name] = probe
spec.loader.exec_module(probe)


class ActiveDnsProbeContractTest(unittest.TestCase):
    def test_resolution_classification(self):
        self.assertEqual(probe.classify_resolution(0, "93.184.216.34 example.com"), "resolved")
        self.assertEqual(probe.classify_resolution(1, "ping: bad address 'doubleclick.net'"), "refused_or_unresolved")
        self.assertEqual(probe.classify_resolution(2, "permission denied"), "command_failed")

    def test_pref_parsing(self):
        xml = '<map><boolean name="running" value="true"/><long name="vpn_heartbeat_v121" value="123456"/></map>'
        self.assertIs(probe.parse_pref_bool(xml, "running"), True)
        self.assertEqual(probe.parse_pref_long(xml, "vpn_heartbeat_v121"), 123456)
        self.assertIsNone(probe.parse_pref_long(xml, "missing"))

    def test_gate_quality_requires_benign_blocked_vpn_heartbeat_and_artifact(self):
        results = [
            probe.ProbeResult("example.com", "allow", "resolved", 0, "getent", "ok"),
            probe.ProbeResult("doubleclick.net", "block", "refused_or_unresolved", 1, "getent", "not found"),
            probe.ProbeResult("googleadservices.com", "block", "refused_or_unresolved", 1, "getent", "not found"),
        ]
        ok, blockers = probe.gate_quality(results, True, 5_000, "a" * 64)
        self.assertTrue(ok)
        self.assertEqual(blockers, [])

        ok, blockers = probe.gate_quality(results, True, probe.HEARTBEAT_MAX_AGE_MS + 1, "a" * 64)
        self.assertFalse(ok)
        self.assertIn("fresh_heartbeat_not_proven", blockers)

        ok, blockers = probe.gate_quality(results, False, 5_000, "")
        self.assertFalse(ok)
        self.assertIn("vpn_running_not_proven", blockers)
        self.assertIn("apk_sha256_not_bound", blockers)

    def test_gate_rejects_ambiguous_block_failure(self):
        results = [
            probe.ProbeResult("example.com", "allow", "resolved", 0, "getent", "ok"),
            probe.ProbeResult("doubleclick.net", "block", "command_failed", 2, "getent", "permission denied"),
            probe.ProbeResult("googleadservices.com", "block", "refused_or_unresolved", 1, "getent", "not found"),
        ]
        ok, blockers = probe.gate_quality(results, True, 1_000, "b" * 64)
        self.assertFalse(ok)
        self.assertIn("blocking_not_proven", blockers)

    def test_serial_is_never_written_raw(self):
        token = probe.serial_token("sensitive-device-serial")
        self.assertEqual(len(token), 16)
        self.assertNotIn("sensitive-device-serial", token)

    def test_apk_sha256(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "x.apk"
            path.write_bytes(b"test-apk")
            digest = probe.apk_sha256(path)
            self.assertEqual(len(digest), 64)
            self.assertRegex(digest, r"^[0-9a-f]{64}$")


if __name__ == "__main__":
    unittest.main()
