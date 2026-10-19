[CmdletBinding()]
param(
    [string]$Apk = "",
    [switch]$PackageReplace,
    [switch]$Handover,
    [switch]$SleepWake,
    [switch]$Idle,
    [ValidateRange(0, 1440)][int]$SoakMinutes = 0,
    [string]$OutDir = "",
    [string]$Provenance = "",
    [string]$ExpectedSourceCommit = "",
    [string]$Serial = "",
    [string]$Package = "com.swir.xadkiller.debug",
    [string]$Activity = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($Activity)) {
    $Activity = "$Package/com.swir.xadkiller.MainActivityV121"
}
if ($PackageReplace -and [string]::IsNullOrWhiteSpace($Apk)) {
    throw "-PackageReplace requires -Apk PATH"
}
if (-not [string]::IsNullOrWhiteSpace($Apk) -and [string]::IsNullOrWhiteSpace($Provenance)) {
    throw "-Apk requires -Provenance PROVENANCE.env for exact-SHA binding"
}
if (-not [string]::IsNullOrWhiteSpace($Apk) -and -not (Test-Path -LiteralPath $Apk -PathType Leaf)) {
    throw "APK not found: $Apk"
}
if (-not [string]::IsNullOrWhiteSpace($Provenance) -and -not (Test-Path -LiteralPath $Provenance -PathType Leaf)) {
    throw "Provenance file not found: $Provenance"
}
if (-not (Get-Command adb -ErrorAction SilentlyContinue)) {
    throw "adb is required and must be available in PATH"
}

$script:AdbPrefix = @()
if (-not [string]::IsNullOrWhiteSpace($Serial)) {
    $script:AdbPrefix = @("-s", $Serial)
}

function Get-Sha256Text {
    param([Parameter(Mandatory)][string]$Value)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($Value)
        $hash = $sha.ComputeHash($bytes)
        return (($hash | ForEach-Object { $_.ToString("x2") }) -join "")
    }
    finally { $sha.Dispose() }
}

function Invoke-AdbText {
    param([Parameter(Mandatory)][string[]]$Arguments, [switch]$IgnoreFailure)
    $previous = $ErrorActionPreference
    try {
        if ($IgnoreFailure) { $ErrorActionPreference = "Continue" }
        $lines = & adb @script:AdbPrefix @Arguments 2>&1
        $code = $LASTEXITCODE
        $text = ($lines | ForEach-Object { [string]$_ }) -join "`n"
        if (-not $IgnoreFailure -and $code -ne 0) {
            throw "adb failed ($code): adb $($Arguments -join ' ')`n$text"
        }
        return $text
    }
    finally {
        $ErrorActionPreference = $previous
    }
}

if ([string]::IsNullOrWhiteSpace($Serial)) {
    $devices = @(& adb devices | Select-Object -Skip 1 | ForEach-Object {
        $parts = ([string]$_).Trim() -split "\s+"
        if ($parts.Count -ge 2 -and $parts[1] -eq "device") { $parts[0] }
    } | Where-Object { $_ })
    if ($devices.Count -ne 1) {
        throw "Expected exactly one online adb device; found $($devices.Count). Use -Serial."
    }
    $Serial = $devices[0]
    $script:AdbPrefix = @("-s", $Serial)
}
if ((Invoke-AdbText -Arguments @("get-state")).Trim() -ne "device") {
    throw "selected adb device is not online"
}

$serialHash = (Get-Sha256Text -Value $Serial).Substring(0, 16)

$stamp = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
if ([string]::IsNullOrWhiteSpace($OutDir)) {
    $OutDir = Join-Path "artifacts" "android-v160-physical-$stamp"
}
$OutDir = [System.IO.Path]::GetFullPath($OutDir)
if (Test-Path -LiteralPath $OutDir) {
    throw "Evidence output must be a fresh path and must not already exist: $OutDir"
}
$outParent = Split-Path -Parent $OutDir
if (-not [string]::IsNullOrWhiteSpace($outParent) -and -not (Test-Path -LiteralPath $outParent)) {
    New-Item -ItemType Directory -Force -Path $outParent | Out-Null
}
New-Item -ItemType Directory -Path $OutDir | Out-Null
$snapshotsDir = Join-Path $OutDir "snapshots"
New-Item -ItemType Directory -Path $snapshotsDir | Out-Null
$timeline = Join-Path $OutDir "timeline.tsv"
[System.IO.File]::WriteAllText($timeline, "", [System.Text.UTF8Encoding]::new($false))

$apkSha256 = ""
$apkBasename = ""
if (-not [string]::IsNullOrWhiteSpace($Apk)) {
    $Apk = (Resolve-Path -LiteralPath $Apk).Path
    $apkSha256 = (Get-FileHash -LiteralPath $Apk -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($apkSha256 -notmatch '^[0-9a-f]{64}$') { throw "Failed to compute APK SHA-256" }
    $apkBasename = [System.IO.Path]::GetFileName($Apk)
}

$sourceCommit = ""
$provenanceApkSha256 = ""
$provenanceArtifact = ""
$provenanceTestedArtifact = ""
$provenanceSnapshotSha256 = ""
$provenanceBound = 0
if (-not [string]::IsNullOrWhiteSpace($Provenance)) {
    $provenanceMap = @{}
    foreach ($line in Get-Content -LiteralPath $Provenance) {
        if ([string]::IsNullOrWhiteSpace($line) -or $line.TrimStart().StartsWith("#") -or $line -notmatch '=') { continue }
        $pair = $line -split '=', 2
        $key = $pair[0].Trim()
        if ($provenanceMap.ContainsKey($key)) { throw "PROVENANCE.env contains duplicate key: $key" }
        $provenanceMap[$key] = $pair[1].Trim()
    }
    if ([string]$provenanceMap['schema'] -ne '1') { throw "PROVENANCE.env schema must be 1" }
    if ([string]$provenanceMap['provenance_contract'] -ne 'exact-sha-v1') { throw "PROVENANCE.env provenance_contract must be exact-sha-v1" }
    $sourceCommit = ([string]$provenanceMap['source_commit']).ToLowerInvariant()
    $provenanceArtifact = [string]$provenanceMap['artifact']
    $provenanceTestedArtifact = [string]$provenanceMap['tested_artifact']
    $provenanceApkSha256 = ([string]$provenanceMap['apk_sha256']).ToLowerInvariant()
    if ($sourceCommit -notmatch '^[0-9a-f]{40}$') { throw "PROVENANCE.env source_commit must be lowercase 40-hex" }
    if ($provenanceArtifact -ne 'xADKiller-Android-v1.6.0-dev-debug.apk') { throw "PROVENANCE.env artifact must be the canonical APK name" }
    $expectedTestedArtifact = "xADKiller-Android-v1.6.0-dev-debug-$sourceCommit.apk"
    if ($provenanceTestedArtifact -ne $expectedTestedArtifact) { throw "PROVENANCE.env tested_artifact does not bind the exact source commit" }
    if ($provenanceApkSha256 -notmatch '^[0-9a-f]{64}$') { throw "PROVENANCE.env apk_sha256 must be lowercase 64-hex" }
    if (-not [string]::IsNullOrWhiteSpace($apkSha256) -and $apkSha256 -ne $provenanceApkSha256) {
        throw "APK SHA-256 does not match PROVENANCE.env"
    }
    if (-not [string]::IsNullOrWhiteSpace($apkBasename) -and $apkBasename -ne $provenanceTestedArtifact) {
        throw "APK basename does not match PROVENANCE.env tested_artifact"
    }
    if (-not [string]::IsNullOrWhiteSpace($apkSha256)) { $provenanceBound = 1 }
}
if (-not [string]::IsNullOrWhiteSpace($ExpectedSourceCommit)) {
    $ExpectedSourceCommit = $ExpectedSourceCommit.Trim().ToLowerInvariant()
    if ($ExpectedSourceCommit -notmatch '^[0-9a-f]{40}$') { throw "-ExpectedSourceCommit must be lowercase 40-hex" }
    if (-not [string]::IsNullOrWhiteSpace($sourceCommit) -and $sourceCommit -ne $ExpectedSourceCommit) {
        throw "-ExpectedSourceCommit does not match PROVENANCE.env"
    }
    $sourceCommit = $ExpectedSourceCommit
}
if ([string]::IsNullOrWhiteSpace($sourceCommit) -and (Get-Command git -ErrorAction SilentlyContinue)) {
    try {
        $candidateCommit = (& git rev-parse HEAD 2>$null | Select-Object -First 1).Trim().ToLowerInvariant()
        if ($candidateCommit -match '^[0-9a-f]{40}$') { $sourceCommit = $candidateCommit }
    } catch {}
}
if ($sourceCommit -notmatch '^[0-9a-f]{40}$') {
    throw "Gate-quality evidence requires an exact 40-hex source commit; run from the tested checkout or pass -Provenance/-ExpectedSourceCommit."
}

$script:WifiBefore = ""
$script:DataBefore = ""
$script:IdleForced = $false

function Read-RadioFlag {
    param([Parameter(Mandatory)][string]$Key)
    return (Invoke-AdbText -Arguments @("shell", "settings", "get", "global", $Key) -IgnoreFailure).Trim()
}

function Set-Utf8NoBom {
    param([Parameter(Mandatory)][string]$Path, [AllowEmptyString()][string]$Value)
    [System.IO.File]::WriteAllText($Path, $Value, [System.Text.UTF8Encoding]::new($false))
}

function Redact-DeviceId {
    param([AllowEmptyString()][string]$Value)
    if (-not [string]::IsNullOrEmpty($Serial)) {
        return $Value.Replace($Serial, "[redacted-device-id]")
    }
    return $Value
}

function Set-RedactedUtf8NoBom {
    param([Parameter(Mandatory)][string]$Path, [AllowEmptyString()][string]$Value)
    Set-Utf8NoBom -Path $Path -Value (Redact-DeviceId -Value $Value)
}

function Save-BuildProperties {
    param([Parameter(Mandatory)][string]$Path)
    $lines = foreach ($key in @(
        "ro.build.version.release",
        "ro.build.version.sdk",
        "ro.build.version.security_patch",
        "ro.product.cpu.abi"
    )) {
        $value = (Invoke-AdbText -Arguments @("shell", "getprop", $key) -IgnoreFailure).Trim()
        "$key=$value"
    }
    Set-RedactedUtf8NoBom -Path $Path -Value (($lines -join "`n") + "`n")
}

function Save-AdbOutput {
    param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][string[]]$Arguments)
    $value = Invoke-AdbText -Arguments $Arguments -IgnoreFailure
    Set-RedactedUtf8NoBom -Path $Path -Value $value
}

function Assert-WitnessTreeSafe {
    $unsafe = Get-ChildItem -LiteralPath $OutDir -Recurse -Force | Where-Object {
        ($_.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0
    } | Select-Object -First 1
    if ($null -ne $unsafe) {
        throw "Witness tree contains a reparse point: $($unsafe.FullName)"
    }
}

function Write-WitnessManifest {
    Assert-WitnessTreeSafe
    $manifestPath = Join-Path $OutDir "witness-manifest.sha256"
    $rootPrefix = $OutDir.TrimEnd([char[]]@('\', '/')) + [System.IO.Path]::DirectorySeparatorChar
    $entries = @()
    foreach ($file in Get-ChildItem -LiteralPath $OutDir -Recurse -File) {
        $relative = $file.FullName.Substring($rootPrefix.Length).Replace('\', '/')
        if ($relative -in @('witness-manifest.sha256', 'validation-summary.json', 'validator.txt')) { continue }
        $digest = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($digest -notmatch '^[0-9a-f]{64}$') { throw "Failed to hash witness file: $relative" }
        $entries += [PSCustomObject]@{ Relative = $relative; Digest = $digest }
    }
    $lines = $entries | Sort-Object -Property Relative | ForEach-Object { "$($_.Digest)  $($_.Relative)" }
    Set-Utf8NoBom -Path $manifestPath -Value (($lines -join "`n") + "`n")
}

function Save-Snapshot {
    param([Parameter(Mandatory)][string]$Label)
    $dir = Join-Path $snapshotsDir $Label
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $epoch = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    [System.IO.File]::AppendAllText($timeline, "$epoch`t$Label`n", [System.Text.UTF8Encoding]::new($false))
    Set-Utf8NoBom -Path (Join-Path $dir "snapshot_epoch_seconds.txt") -Value "$epoch`n"
    Save-BuildProperties -Path (Join-Path $dir "getprop.txt")
    Save-AdbOutput -Path (Join-Path $dir "connectivity.txt") -Arguments @("shell", "dumpsys", "connectivity")
    Save-AdbOutput -Path (Join-Path $dir "power.txt") -Arguments @("shell", "dumpsys", "power")
    Save-AdbOutput -Path (Join-Path $dir "services.txt") -Arguments @("shell", "dumpsys", "activity", "services", $Package)
    Save-AdbOutput -Path (Join-Path $dir "package.txt") -Arguments @("shell", "dumpsys", "package", $Package)
    Save-AdbOutput -Path (Join-Path $dir "boot_count.txt") -Arguments @("shell", "settings", "get", "global", "boot_count")
    Save-AdbOutput -Path (Join-Path $dir "prefs.xml") -Arguments @("shell", "run-as", $Package, "cat", "shared_prefs/xadkiller_prefs.xml")
    Save-AdbOutput -Path (Join-Path $dir "system_console.log") -Arguments @("shell", "run-as", $Package, "cat", "files/system_console.log")
    $wifi = Read-RadioFlag -Key "wifi_on"
    $mobile = Read-RadioFlag -Key "mobile_data"
    Set-Utf8NoBom -Path (Join-Path $dir "radio-state.env") -Value "wifi_on=$wifi`nmobile_data=$mobile`n"
}

function Restore-DeviceState {
    try { if ($script:IdleForced) { Invoke-AdbText -Arguments @("shell", "cmd", "deviceidle", "unforce") -IgnoreFailure | Out-Null } } catch {}
    try { if ($script:WifiBefore -eq "1") { Invoke-AdbText -Arguments @("shell", "svc", "wifi", "enable") -IgnoreFailure | Out-Null } } catch {}
    try { if ($script:WifiBefore -eq "0") { Invoke-AdbText -Arguments @("shell", "svc", "wifi", "disable") -IgnoreFailure | Out-Null } } catch {}
    try { if ($script:DataBefore -eq "1") { Invoke-AdbText -Arguments @("shell", "svc", "data", "enable") -IgnoreFailure | Out-Null } } catch {}
    try { if ($script:DataBefore -eq "0") { Invoke-AdbText -Arguments @("shell", "svc", "data", "disable") -IgnoreFailure | Out-Null } } catch {}
}

if (-not [string]::IsNullOrWhiteSpace($Provenance)) {
    $canonicalProvenance = @(
        "schema=1",
        "provenance_contract=exact-sha-v1",
        "source_commit=$sourceCommit",
        "artifact=$provenanceArtifact",
        "tested_artifact=$provenanceTestedArtifact",
        "apk_sha256=$provenanceApkSha256"
    ) -join "`n"
    $provenanceSnapshotPath = Join-Path $OutDir "build-provenance.env"
    Set-Utf8NoBom -Path $provenanceSnapshotPath -Value ($canonicalProvenance + "`n")
    $provenanceSnapshotSha256 = (Get-FileHash -LiteralPath $provenanceSnapshotPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($provenanceSnapshotSha256 -notmatch '^[0-9a-f]{64}$') { throw "Failed to hash canonical provenance snapshot" }
}

$metadata = @(
    "schema=3",
    "package=$Package",
    "activity=$Activity",
    "serial_hash=$serialHash",
    "serial_privacy=sha256-16",
    "started_utc=$stamp",
    "source_commit=$sourceCommit",
    "requested_handover=$([int]$Handover.IsPresent)",
    "requested_sleep_wake=$([int]$SleepWake.IsPresent)",
    "requested_idle=$([int]$Idle.IsPresent)",
    "requested_package_replace=$([int]$PackageReplace.IsPresent)",
    "requested_soak_minutes=$SoakMinutes",
    "apk_supplied=$([int](-not [string]::IsNullOrWhiteSpace($Apk)))",
    "apk_basename=$apkBasename",
    "apk_sha256=$apkSha256",
    "provenance_bound=$provenanceBound",
    "provenance_contract=$(if (-not [string]::IsNullOrWhiteSpace($Provenance)) { 'exact-sha-v1' } else { 'none' })",
    "provenance_artifact=$provenanceArtifact",
    "provenance_tested_artifact=$provenanceTestedArtifact",
    "provenance_snapshot_sha256=$provenanceSnapshotSha256",
    "max_heartbeat_age_ms=30000",
    "privacy=local-only-device-id-hashed-no-urls-no-hostnames-no-app-traffic-log"
) -join "`n"
Set-Utf8NoBom -Path (Join-Path $OutDir "metadata.env") -Value ($metadata + "`n")

try {
    if (-not [string]::IsNullOrWhiteSpace($Apk)) {
        Set-RedactedUtf8NoBom -Path (Join-Path $OutDir "install-initial.txt") -Value ((Invoke-AdbText -Arguments @("install", "-r", $Apk)) + "`n")
    }

    Save-AdbOutput -Path (Join-Path $OutDir "activity-start.txt") -Arguments @("shell", "am", "start", "-W", "-n", $Activity)
    Start-Sleep -Seconds 2
    Save-Snapshot -Label "baseline"

    $prefsPath = Join-Path $snapshotsDir "baseline/prefs.xml"
    $prefs = if (Test-Path -LiteralPath $prefsPath) { Get-Content -LiteralPath $prefsPath -Raw } else { "" }
    if ($prefs -notmatch 'name="running"\s+value="true"|<boolean\s+name="running"\s+value="true"') {
        $warning = "WARNING: baseline does not prove an active VPN. Grant VPN consent/start protection, then rerun for gate-quality evidence."
        Write-Warning $warning
        Set-Utf8NoBom -Path (Join-Path $OutDir "baseline-warning.txt") -Value ($warning + "`n")
    }

    if ($PackageReplace) {
        Save-Snapshot -Label "pre_package_replace"
        Set-RedactedUtf8NoBom -Path (Join-Path $OutDir "install-package-replace.txt") -Value ((Invoke-AdbText -Arguments @("install", "-r", $Apk)) + "`n")
        Start-Sleep -Seconds 10
        Save-Snapshot -Label "post_package_replace"
    }

    if ($SleepWake) {
        Save-Snapshot -Label "pre_sleep"
        Invoke-AdbText -Arguments @("shell", "input", "keyevent", "223") -IgnoreFailure | Out-Null
        Start-Sleep -Seconds 10
        Invoke-AdbText -Arguments @("shell", "input", "keyevent", "224") -IgnoreFailure | Out-Null
        Invoke-AdbText -Arguments @("shell", "wm", "dismiss-keyguard") -IgnoreFailure | Out-Null
        Start-Sleep -Seconds 8
        Save-Snapshot -Label "post_wake"
    }

    if ($Idle) {
        Save-Snapshot -Label "pre_idle"
        Save-AdbOutput -Path (Join-Path $OutDir "deviceidle-force.txt") -Arguments @("shell", "cmd", "deviceidle", "force-idle")
        $script:IdleForced = $true
        Start-Sleep -Seconds 12
        Save-Snapshot -Label "forced_idle"
        Save-AdbOutput -Path (Join-Path $OutDir "deviceidle-unforce.txt") -Arguments @("shell", "cmd", "deviceidle", "unforce")
        $script:IdleForced = $false
        Start-Sleep -Seconds 8
        Save-Snapshot -Label "post_idle"
    }

    if ($Handover) {
        $script:WifiBefore = Read-RadioFlag -Key "wifi_on"
        $script:DataBefore = Read-RadioFlag -Key "mobile_data"
        if ($script:WifiBefore -notmatch '^[01]$') { $script:WifiBefore = "" }
        if ($script:DataBefore -notmatch '^[01]$') { $script:DataBefore = "" }

        Invoke-AdbText -Arguments @("shell", "svc", "data", "enable") -IgnoreFailure | Out-Null
        Invoke-AdbText -Arguments @("shell", "svc", "wifi", "enable") -IgnoreFailure | Out-Null
        Start-Sleep -Seconds 10
        Save-Snapshot -Label "wifi_ready"

        Invoke-AdbText -Arguments @("shell", "svc", "wifi", "disable") | Out-Null
        Start-Sleep -Seconds 12
        Save-Snapshot -Label "mobile_only"

        Invoke-AdbText -Arguments @("shell", "svc", "wifi", "enable") | Out-Null
        Start-Sleep -Seconds 12
        Save-Snapshot -Label "wifi_restored"
    }

    if ($SoakMinutes -gt 0) {
        Save-Snapshot -Label "soak_start"
        for ($minute = 1; $minute -le $SoakMinutes; $minute++) {
            Start-Sleep -Seconds 60
            if ($minute -eq $SoakMinutes -or ($minute % 5) -eq 0) {
                Save-Snapshot -Label "soak_${minute}m"
            }
        }
    }

    Save-Snapshot -Label "final"
}
finally {
    Restore-DeviceState
}

Write-WitnessManifest

$validator = Join-Path "ci" "validate_android_physical_witness.py"
$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) { $python = Get-Command python3 -ErrorAction SilentlyContinue }
if ($python -and (Test-Path -LiteralPath $validator -PathType Leaf)) {
    $validatorArgs = @($validator, $OutDir)
    if (-not [string]::IsNullOrWhiteSpace($Apk)) { $validatorArgs += @("--apk", $Apk) }
    $result = & $python.Source @validatorArgs 2>&1
    $exit = $LASTEXITCODE
    Set-Utf8NoBom -Path (Join-Path $OutDir "validator.txt") -Value ((($result | ForEach-Object { [string]$_ }) -join "`n") + "`n")
    $result | ForEach-Object { Write-Host $_ }
    if ($exit -ne 0) { throw "Physical witness validator failed with exit code $exit" }
} else {
    Write-Host "Evidence collected at $OutDir. Run the Python physical-witness validator before treating it as gate-quality evidence."
}
