#!/usr/bin/env python3
"""Regression tests for the Android v1.6 real-app witness contract."""
from __future__ import annotations

import copy
import datetime as dt
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
