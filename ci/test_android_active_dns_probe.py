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
sys.modules[spec.name] = probe
spec.loader.exec_module(probe)


class ActiveDnsProbeContractTest(unittest.TestCase):
    def good_probes(self):
        results = []
        for round_index in range(1, 4):
            results.extend([
                probe.ProbeResult("example.com", "allow", "resolved", 0, "getent", "ok", round_index),
                probe.ProbeResult("doubleclick.net", "block", "refused_or_unresolved", 1, "getent", "not found", round_index),
                probe.ProbeResult("googleadservices.com", "block", "refused_or_unresolved", 1, "getent", "not found", round_index),
            ])
        return results

    def good_samples(self):
        return [
            probe.VpnSample(1, True, 1_000, 1_000),
            probe.VpnSample(2, True, 7_000, 1_000),
            probe.VpnSample(3, True, 13_000, 1_000),
        ]

    def test_resolution_classification(self):
        self.assertEqual(probe.classify_resolution(0, "93.184.216.34 example.com"), "resolved")
        self.assertEqual(probe.classify_resolution(1, "ping: bad address 'doubleclick.net'"), "refused_or_unresolved")
        self.assertEqual(probe.classify_resolution(2, "permission denied"), "command_failed")

    def test_pref_parsing(self):
        xml = '<map><boolean name="running" value="true"/><long name="vpn_heartbeat_v121" value="123456"/></map>'
        self.assertIs(probe.parse_pref_bool(xml, "running"), True)
        self.assertEqual(probe.parse_pref_long(xml, "vpn_heartbeat_v121"), 123456)
        self.assertIsNone(probe.parse_pref_long(xml, "missing"))

    def test_gate_quality_requires_stable_dns_vpn_heartbeat_and_artifact(self):
        ok, blockers = probe.gate_quality(self.good_probes(), self.good_samples(), "a" * 64, 3)
        self.assertTrue(ok)
        self.assertEqual(blockers, [])

        stale = self.good_samples()
        stale[-1] = probe.VpnSample(3, True, 13_000, probe.HEARTBEAT_MAX_AGE_MS + 1)
        ok, blockers = probe.gate_quality(self.good_probes(), stale, "a" * 64, 3)
        self.assertFalse(ok)
        self.assertIn("fresh_heartbeat_not_proven", blockers)

    def test_gate_rejects_single_round_or_nonadvancing_heartbeat(self):
        single = [probe.ProbeResult("example.com", "allow", "resolved", 0, "getent", "ok", 1)]
        samples = [probe.VpnSample(1, True, 1_000, 1_000)]
        ok, blockers = probe.gate_quality(single, samples, "a" * 64, 1)
        self.assertFalse(ok)
        self.assertIn("dns_stability_window_not_proven", blockers)
        self.assertIn("blocking_not_proven", blockers)
        self.assertIn("heartbeat_not_advancing", blockers)

        flat = [
            probe.VpnSample(1, True, 1_000, 1_000),
            probe.VpnSample(2, True, 1_000, 1_000),
            probe.VpnSample(3, True, 1_000, 1_000),
        ]
        ok, blockers = probe.gate_quality(self.good_probes(), flat, "a" * 64, 3)
        self.assertFalse(ok)
        self.assertIn("heartbeat_not_advancing", blockers)

    def test_gate_rejects_ambiguous_block_failure(self):
        results = self.good_probes()
        results[1] = probe.ProbeResult("doubleclick.net", "block", "command_failed", 2, "getent", "permission denied", 1)
        ok, blockers = probe.gate_quality(results, self.good_samples(), "b" * 64, 3)
        self.assertFalse(ok)
        self.assertIn("blocking_not_proven", blockers)

    def test_gate_requires_exact_round_coverage(self):
        results = [p for p in self.good_probes() if p.round_index != 2]
        ok, blockers = probe.gate_quality(results, self.good_samples(), "c" * 64, 3)
        self.assertFalse(ok)
        self.assertIn("dns_round_coverage_incomplete", blockers)

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
