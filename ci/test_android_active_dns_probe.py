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

    def good_networks(self):
        return [
            probe.NetworkSample(1, "wifi", True, False, "wifi validated"),
            probe.NetworkSample(2, "wifi", True, False, "wifi validated"),
            probe.NetworkSample(3, "cellular", True, False, "cellular validated"),
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

    def test_network_classification_prefers_validated_non_vpn(self):
        dumpsys = """
NetworkAgentInfo{ network{101} nc{[ Transports: VPN Capabilities: INTERNET&VALIDATED ]} }
NetworkAgentInfo{ network{102} nc{[ Transports: WIFI Capabilities: INTERNET&VALIDATED&NOT_VPN ]} }
NetworkAgentInfo{ network{103} nc{[ Transports: CELLULAR Capabilities: INTERNET&NOT_VPN ]} }
"""
        transport, validated, captive, excerpt = probe.classify_network_state(dumpsys)
        self.assertEqual(transport, "wifi")
        self.assertIs(validated, True)
        self.assertIs(captive, False)
        self.assertIn("WIFI", excerpt.upper())

    def test_network_classification_detects_captive_portal(self):
        dumpsys = "NetworkAgentInfo{ network{102} nc{[ Transports: WIFI Capabilities: INTERNET&VALIDATED&CAPTIVE_PORTAL&NOT_VPN ]} }"
        transport, validated, captive, _ = probe.classify_network_state(dumpsys)
        self.assertEqual(transport, "wifi")
        self.assertIs(validated, True)
        self.assertIs(captive, True)

    def test_network_classification_unknown_is_not_invented(self):
        self.assertEqual(probe.classify_network_state("permission denied")[:3], ("unknown", None, None))

    def test_gate_quality_requires_stable_dns_vpn_network_and_artifact(self):
        ok, blockers = probe.gate_quality(self.good_probes(), self.good_samples(), self.good_networks(), "a" * 64, 3)
        self.assertTrue(ok)
        self.assertEqual(blockers, [])

        stale = self.good_samples()
        stale[-1] = probe.VpnSample(3, True, 13_000, probe.HEARTBEAT_MAX_AGE_MS + 1)
        ok, blockers = probe.gate_quality(self.good_probes(), stale, self.good_networks(), "a" * 64, 3)
        self.assertFalse(ok)
        self.assertIn("fresh_heartbeat_not_proven", blockers)

    def test_gate_rejects_single_round_or_nonadvancing_heartbeat(self):
        single = [probe.ProbeResult("example.com", "allow", "resolved", 0, "getent", "ok", 1)]
        samples = [probe.VpnSample(1, True, 1_000, 1_000)]
        networks = [probe.NetworkSample(1, "wifi", True, False, "ok")]
        ok, blockers = probe.gate_quality(single, samples, networks, "a" * 64, 1)
        self.assertFalse(ok)
        self.assertIn("dns_stability_window_not_proven", blockers)
        self.assertIn("blocking_not_proven", blockers)
        self.assertIn("heartbeat_not_advancing", blockers)

        flat = [
            probe.VpnSample(1, True, 1_000, 1_000),
            probe.VpnSample(2, True, 1_000, 1_000),
            probe.VpnSample(3, True, 1_000, 1_000),
        ]
        ok, blockers = probe.gate_quality(self.good_probes(), flat, self.good_networks(), "a" * 64, 3)
        self.assertFalse(ok)
        self.assertIn("heartbeat_not_advancing", blockers)

    def test_gate_rejects_ambiguous_block_failure(self):
        results = self.good_probes()
        results[1] = probe.ProbeResult("doubleclick.net", "block", "command_failed", 2, "getent", "permission denied", 1)
        ok, blockers = probe.gate_quality(results, self.good_samples(), self.good_networks(), "b" * 64, 3)
        self.assertFalse(ok)
        self.assertIn("blocking_not_proven", blockers)

    def test_gate_requires_exact_round_coverage(self):
        results = [p for p in self.good_probes() if p.round_index != 2]
        ok, blockers = probe.gate_quality(results, self.good_samples(), self.good_networks(), "c" * 64, 3)
        self.assertFalse(ok)
        self.assertIn("dns_round_coverage_incomplete", blockers)

        networks = [n for n in self.good_networks() if n.round_index != 2]
        ok, blockers = probe.gate_quality(self.good_probes(), self.good_samples(), networks, "c" * 64, 3)
        self.assertFalse(ok)
        self.assertIn("network_round_coverage_incomplete", blockers)

    def test_gate_rejects_unvalidated_or_captive_network(self):
        unvalidated = self.good_networks()
        unvalidated[1] = probe.NetworkSample(2, "wifi", False, False, "wifi not validated")
        ok, blockers = probe.gate_quality(self.good_probes(), self.good_samples(), unvalidated, "d" * 64, 3)
        self.assertFalse(ok)
        self.assertIn("validated_underlying_network_not_proven", blockers)

        captive = self.good_networks()
        captive[2] = probe.NetworkSample(3, "cellular", True, True, "captive")
        ok, blockers = probe.gate_quality(self.good_probes(), self.good_samples(), captive, "d" * 64, 3)
        self.assertFalse(ok)
        self.assertIn("captive_portal_detected", blockers)

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
