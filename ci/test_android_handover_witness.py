#!/usr/bin/env python3
import importlib.util
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
TOOL = ROOT / "ci" / "validate_android_handover_witness.py"
spec = importlib.util.spec_from_file_location("xad_android_handover_validator", TOOL)
validator = importlib.util.module_from_spec(spec)
assert spec.loader is not None
sys.modules[spec.name] = validator
spec.loader.exec_module(validator)

APK = "a" * 64
COMMIT = "b" * 40


def valid_witness():
    probes = []
    for round_index in range(1, 4):
        probes.extend([
            {"round_index": round_index, "domain": "example.com", "expected": "allow", "classification": "resolved"},
            {"round_index": round_index, "domain": "doubleclick.net", "expected": "block", "classification": "refused_or_unresolved"},
            {"round_index": round_index, "domain": "googleadservices.com", "expected": "block", "classification": "refused_or_unresolved"},
        ])
    return {
        "schema": 3,
        "source_commit": COMMIT,
        "device_serial_sha256_16": "c" * 16,
        "apk_sha256": APK,
        "probe_rounds": 3,
        "gate_quality": True,
        "blockers": [],
        "release_gate_closed": False,
        "network_samples": [
            {"round_index": 1, "transport": "wifi", "validated": True, "captive_portal": False},
            {"round_index": 2, "transport": "cellular", "validated": True, "captive_portal": False},
            {"round_index": 3, "transport": "cellular", "validated": True, "captive_portal": False},
        ],
        "vpn_samples": [
            {"round_index": 1, "vpn_running": True, "heartbeat_at_ms": 1000, "heartbeat_age_ms": 1000},
            {"round_index": 2, "vpn_running": True, "heartbeat_at_ms": 7000, "heartbeat_age_ms": 1000},
            {"round_index": 3, "vpn_running": True, "heartbeat_at_ms": 13000, "heartbeat_age_ms": 1000},
        ],
        "probes": probes,
    }


class AndroidHandoverWitnessTest(unittest.TestCase):
    def test_valid_wifi_to_cellular_witness_passes(self):
        ok, blockers, summary = validator.validate_witness(valid_witness(), expected_apk_sha256=APK, expected_commit=COMMIT)
        self.assertTrue(ok)
        self.assertEqual(blockers, [])
        self.assertTrue(summary["handover_observed"])

    def test_same_transport_does_not_count_as_handover(self):
        witness = valid_witness()
        for sample in witness["network_samples"]:
            sample["transport"] = "wifi"
        ok, blockers, _ = validator.validate_witness(witness)
        self.assertFalse(ok)
        self.assertIn("wifi_cellular_coverage_not_proven", blockers)
        self.assertIn("wifi_cellular_handover_not_observed", blockers)

    def test_ethernet_does_not_substitute_for_mobile(self):
        witness = valid_witness()
        witness["network_samples"][1]["transport"] = "ethernet"
        witness["network_samples"][2]["transport"] = "wifi"
        ok, blockers, _ = validator.validate_witness(witness)
        self.assertFalse(ok)
        self.assertIn("wifi_cellular_coverage_not_proven", blockers)
        self.assertIn("wifi_cellular_handover_not_observed", blockers)

    def test_unvalidated_or_captive_network_is_rejected(self):
        witness = valid_witness()
        witness["network_samples"][1]["validated"] = False
        witness["network_samples"][1]["captive_portal"] = True
        ok, blockers, _ = validator.validate_witness(witness)
        self.assertFalse(ok)
        self.assertIn("validated_underlying_network_not_proven", blockers)
        self.assertIn("captive_portal_detected", blockers)

    def test_stale_or_nonadvancing_heartbeat_is_rejected(self):
        witness = valid_witness()
        witness["vpn_samples"][1]["heartbeat_age_ms"] = validator.HEARTBEAT_MAX_AGE_MS + 1
        witness["vpn_samples"][2]["heartbeat_at_ms"] = witness["vpn_samples"][1]["heartbeat_at_ms"]
        ok, blockers, _ = validator.validate_witness(witness)
        self.assertFalse(ok)
        self.assertIn("fresh_heartbeat_not_proven", blockers)
        self.assertIn("heartbeat_not_advancing", blockers)

    def test_candidate_binding_mismatch_is_rejected(self):
        witness = valid_witness()
        ok, blockers, _ = validator.validate_witness(witness, expected_apk_sha256="d" * 64, expected_commit="e" * 40)
        self.assertFalse(ok)
        self.assertIn("apk_sha256_mismatch", blockers)
        self.assertIn("source_commit_mismatch", blockers)

    def test_release_gate_cannot_be_claimed_by_supplemental_witness(self):
        witness = valid_witness()
        witness["release_gate_closed"] = True
        ok, blockers, _ = validator.validate_witness(witness)
        self.assertFalse(ok)
        self.assertIn("release_gate_semantics_invalid", blockers)


if __name__ == "__main__":
    unittest.main()
