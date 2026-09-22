#!/usr/bin/env python3
"""Static safety/provenance contract for the Windows restart witness collector."""
from pathlib import Path

SCRIPT = Path("tools/android-v160-restart-validation.ps1")
text = SCRIPT.read_text(encoding="utf-8")

required = [
    "[ValidateRange(3, 10)][int]$Cycles = 3",
    "source_commit=$SourceCommit",
    "serial_hash=$serialHash",
    "apk_supplied=1",
    "apk_sha256=$apkSha256",
    "privacy=local-only-no-urls-no-hostnames-no-app-traffic-log",
    '"com.swir.xadkiller.v121.START"',
    '"com.swir.xadkiller.v121.STOP"',
    '"cycle_${cycle}_stopped"',
    '"cycle_${cycle}_restarted"',
    "validate_android_restart_witness.py",
    "Gate-quality restart evidence requires an exact 40-hex source commit",
]
for token in required:
    assert token in text, f"Windows restart witness contract missing: {token}"

for forbidden in ("Invoke-WebRequest", "Invoke-RestMethod", "Start-BitsTransfer", "curl.exe", "http://", "https://"):
    assert forbidden not in text, f"Windows restart witness must remain local-only: {forbidden}"

assert "Get-FileHash -LiteralPath $Apk -Algorithm SHA256" in text, "APK byte provenance missing"
assert "Get-Sha256Text -Value $Serial" in text and ".Substring(0, 16)" in text, "raw device serial must not be stored"
assert "finally" in text and "start-foreground-service" in text, "collector must best-effort restore an active baseline VPN"
print("Android Windows restart witness contract: PASS")
