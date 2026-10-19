#!/usr/bin/env python3
"""Regression tests for the Android v1.6 real-app witness contract."""
from __future__ import annotations

import copy
import datetime as dt
import json
from pathlib import Path
import unittest

from ci.validate_android_realapp_witness import WitnessError, _valid_fixture, validate_witness


class RealAppWitnessContractTests(unittest.TestCase):
    def assert_rejected(self, witness: dict, expected: str) -> None:
        with self.assertRaises(WitnessError) as ctx:
            validate_witness(witness)
        self.assertIn(expected.lower(), str(ctx.exception).lower())

    def test_valid_fixture_passes(self) -> None:
        summary = validate_witness(_valid_fixture())
        self.assertEqual(summary["summary"]["total_minutes"], 60)
        self.assertGreaterEqual(summary["summary"]["real_elapsed_minutes"], 60)
        self.assertEqual(summary["summary"]["false_positives"], 1)
        self.assertFalse(summary["release_gate_closed"])

    def test_contract_rejections(self) -> None:
        valid = _valid_fixture()

        bad = copy.deepcopy(valid)
        bad["template"] = True
        self.assert_rejected(bad, "template")

        bad = copy.deepcopy(valid)
        bad["candidate"]["apk_sha256"] = "0" * 63
        self.assert_rejected(bad, "apk_sha256")

        bad = copy.deepcopy(valid)
        bad["observations"][0]["vpn_heartbeat_age_ms"] = 15_001
        self.assert_rejected(bad, "heartbeat")

        bad = copy.deepcopy(valid)
        bad["observations"][7]["recovered"] = False
        self.assert_rejected(bad, "not recovered")

        bad = copy.deepcopy(valid)
        bad["observations"][7]["recovery_verified"] = False
        self.assert_rejected(bad, "independently verified")

        bad = copy.deepcopy(valid)
        bad["observations"][0]["url"] = "https://example.invalid"
        self.assert_rejected(bad, "privacy-sensitive")

        bad = copy.deepcopy(valid)
        bad["observations"] = bad["observations"][:11]
        self.assert_rejected(bad, "observations")

        bad = copy.deepcopy(valid)
        for item in bad["observations"]:
            item["network"] = "wifi"
        self.assert_rejected(bad, "both wifi and mobile")

    def test_template_pins_measured_non_authorizing_contract(self) -> None:
        template_path = Path("tools/android-v160-realapp-witness-template.json")
        template = json.loads(template_path.read_text(encoding="utf-8"))
        contract = template["evidence_contract"]

        network = contract["measured_network_v1"]
        self.assertEqual(network["allowed_transport"], ["wifi", "mobile"])
        self.assertEqual(network["source"], "adb_connectivity_active_transport")
        self.assertEqual(network["timestamp_field"], "network_observed_at")
        self.assertTrue(network["fail_closed_on_missing_or_ambiguous_transport"])
        self.assertFalse(network["persist_raw_connectivity_dump"])

        heartbeat = contract["measured_heartbeat_v1"]
        self.assertEqual(heartbeat["source"], "app_local_prefs")
        self.assertEqual(heartbeat["heartbeat_epoch_field"], "heartbeat_epoch_ms")
        self.assertEqual(heartbeat["observation_epoch_field"], "observation_epoch_ms")
        self.assertEqual(heartbeat["max_age_ms"], 15000)
        self.assertFalse(heartbeat["caller_supplied_age_authoritative"])

        recovery = contract["recovery_verification_v1"]
        self.assertTrue(recovery["separate_later_record_required_for_false_positive"])
        self.assertTrue(recovery["explicit_expected_content_confirmation_required"])
        self.assertTrue(recovery["fresh_heartbeat_required"])
        self.assertTrue(recovery["protection_active_required"])
        self.assertFalse(contract["authorizes_release"])

    def test_repository_template_is_never_accepted_as_physical_evidence(self) -> None:
        template_path = Path("tools/android-v160-realapp-witness-template.json")
        template = json.loads(template_path.read_text(encoding="utf-8"))

        self.assertTrue(template["template"])
        self.assertFalse(template["release_gate_closed"])
        self.assertEqual(template["observations"], [])
        self.assert_rejected(template, "template")

    def test_unlinked_recovery_record_cannot_override_observation_gate(self) -> None:
        bad = copy.deepcopy(_valid_fixture())
        false_positive = bad["observations"][7]
        false_positive["recovery_verified"] = False
        bad["recovery_verifications"] = [{
            "observation_index": 7,
            "verified_at": "2026-09-20T01:06:00Z",
            "vpn_heartbeat_age_ms": 1_000,
            "protection_active": True,
            "expected_content_confirmed": True,
            "recovery_action": false_positive["recovery_action"],
        }]

        self.assert_rejected(bad, "independently verified")

    def test_global_elapsed_gate_uses_a_coherent_compressed_timeline(self) -> None:
        bad = copy.deepcopy(_valid_fixture())
        start = dt.datetime(2026, 9, 20, 0, 0, tzinfo=dt.timezone.utc)
        for index, item in enumerate(bad["observations"]):
            item["observed_at"] = (
                start + dt.timedelta(minutes=index * 5)
            ).isoformat().replace("+00:00", "Z")
        self.assert_rejected(bad, "real elapsed minutes")

    def test_non_monotonic_timeline_is_rejected(self) -> None:
        bad = copy.deepcopy(_valid_fixture())
        bad["observations"][5]["observed_at"] = bad["observations"][4]["observed_at"]
        self.assert_rejected(bad, "strictly later")

    def test_declared_minutes_cannot_exceed_measured_interval(self) -> None:
        bad = copy.deepcopy(_valid_fixture())
        previous = dt.datetime.fromisoformat(
            bad["observations"][4]["observed_at"].replace("Z", "+00:00")
        )
        bad["observations"][5]["observed_at"] = (
            previous + dt.timedelta(minutes=1)
        ).isoformat().replace("+00:00", "Z")
        self.assert_rejected(bad, "measured interval")


if __name__ == "__main__":
    unittest.main(verbosity=2)
