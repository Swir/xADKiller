#!/usr/bin/env python3
"""Focused regression for privacy-safe Android physical-witness device identifiers."""
from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WINDOWS_COLLECTOR = ROOT / "tools" / "android-v160-physical-validation.ps1"


class PhysicalWitnessPrivacyContractTests(unittest.TestCase):
    def test_windows_collector_never_persists_raw_device_serial(self) -> None:
        text = WINDOWS_COLLECTOR.read_text(encoding="utf-8")
        self.assertIn("Get-Sha256Text", text)
        self.assertIn('"serial_hash=$serialHash"', text)
        self.assertIn(
            '"privacy=local-only-device-id-hashed-no-urls-no-hostnames-no-app-traffic-log"',
            text,
        )
        self.assertNotIn('"serial=$Serial"', text)
        self.assertNotIn('"serial=$script:Serial"', text)

    def test_windows_device_hash_is_truncated_deterministically(self) -> None:
        text = WINDOWS_COLLECTOR.read_text(encoding="utf-8")
        self.assertIn("(Get-Sha256Text -Value $Serial).Substring(0, 16)", text)


if __name__ == "__main__":
    unittest.main(verbosity=2)
