[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$Apk,
    [ValidateRange(3, 10)][int]$Cycles = 3,
    [string]$OutDir = "",
    [string]$Serial = "",
    [string]$SourceCommit = "",
    [string]$Package = "com.swir.xadkiller.debug",
    [string]$Service = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($Service)) {
    $Service = "$Package/com.swir.xadkiller.AdBlockVpnServiceV121"
}
if (-not (Test-Path -LiteralPath $Apk -PathType Leaf)) {
    throw "APK not found: $Apk"
}
if (-not (Get-Command adb -ErrorAction SilentlyContinue)) {
    throw "adb is required and must be available in PATH"
}

$Apk = (Resolve-Path -LiteralPath $Apk).Path
$apkSha256 = (Get-FileHash -LiteralPath $Apk -Algorithm SHA256).Hash.ToLowerInvariant()
if ($apkSha256 -notmatch '^[0-9a-f]{64}$') { throw "Failed to compute APK SHA-256" }

if ([string]::IsNullOrWhiteSpace($SourceCommit) -and (Get-Command git -ErrorAction SilentlyContinue)) {
    try { $SourceCommit = (& git rev-parse HEAD 2>$null | Select-Object -First 1).Trim().ToLowerInvariant() } catch {}
}
$SourceCommit = ([string]$SourceCommit).Trim().ToLowerInvariant()
if ($SourceCommit -notmatch '^[0-9a-f]{40}$') {
    throw "Gate-quality restart evidence requires an exact 40-hex source commit. Run from the tested checkout or pass -SourceCommit <commit>."
}

$script:AdbPrefix = @()
if (-not [string]::IsNullOrWhiteSpace($Serial)) {
    $script:AdbPrefix = @("-s", $Serial)
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
    throw "adb device is not online: $Serial"
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

function Set-Utf8NoBom {
    param([Parameter(Mandatory)][string]$Path, [AllowEmptyString()][string]$Value)
    [System.IO.File]::WriteAllText($Path, $Value, [System.Text.UTF8Encoding]::new($false))
}

function Save-AdbOutput {
    param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][string[]]$Arguments)
    Set-Utf8NoBom -Path $Path -Value (Invoke-AdbText -Arguments $Arguments -IgnoreFailure)
}

$stamp = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
if ([string]::IsNullOrWhiteSpace($OutDir)) {
    $OutDir = Join-Path "artifacts" "android-v160-restart-$stamp"
}
$OutDir = [System.IO.Path]::GetFullPath($OutDir)
$snapshotsDir = Join-Path $OutDir "snapshots"
New-Item -ItemType Directory -Force -Path $snapshotsDir | Out-Null
$timeline = Join-Path $OutDir "timeline.tsv"
Set-Utf8NoBom -Path $timeline -Value ""

$serialHash = (Get-Sha256Text -Value $Serial).Substring(0, 16)
$actionStart = "com.swir.xadkiller.v121.START"
$actionStop = "com.swir.xadkiller.v121.STOP"
$script:BaselineRunning = $false

function Save-Snapshot {
    param([Parameter(Mandatory)][string]$Label)
    $dir = Join-Path $snapshotsDir $Label
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $epoch = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    [System.IO.File]::AppendAllText($timeline, "$epoch`t$Label`n", [System.Text.UTF8Encoding]::new($false))
    Set-Utf8NoBom -Path (Join-Path $dir "snapshot_epoch_seconds.txt") -Value "$epoch`n"
    Save-AdbOutput -Path (Join-Path $dir "prefs.xml") -Arguments @("shell", "run-as", $Package, "cat", "shared_prefs/xadkiller_prefs.xml")
    Save-AdbOutput -Path (Join-Path $dir "services.txt") -Arguments @("shell", "dumpsys", "activity", "services", $Package)
    Save-AdbOutput -Path (Join-Path $dir "package.txt") -Arguments @("shell", "dumpsys", "package", $Package)
}

$metadata = @(
    "schema=1",
    "scope=vpn-start-stop-restart",
    "package=$Package",
    "service=$Service",
    "serial_hash=$serialHash",
    "started_utc=$stamp",
    "source_commit=$SourceCommit",
    "cycles=$Cycles",
    "apk_supplied=1",
    "apk_sha256=$apkSha256",
    "max_heartbeat_age_ms=30000",
    "privacy=local-only-no-urls-no-hostnames-no-app-traffic-log"
) -join "`n"
Set-Utf8NoBom -Path (Join-Path $OutDir "metadata.env") -Value ($metadata + "`n")

try {
    Save-Snapshot -Label "baseline"
    $prefsPath = Join-Path $snapshotsDir "baseline/prefs.xml"
    $prefs = if (Test-Path -LiteralPath $prefsPath) { Get-Content -LiteralPath $prefsPath -Raw } else { "" }
    if ($prefs -notmatch 'name="running"\s+value="true"|<boolean\s+name="running"\s+value="true"') {
        throw "Baseline does not prove an active VPN. Grant VPN consent/start protection in xADKiller, then rerun."
    }
    $script:BaselineRunning = $true

    for ($cycle = 1; $cycle -le $Cycles; $cycle++) {
        Set-Utf8NoBom -Path (Join-Path $OutDir "stop-$cycle.txt") -Value ((Invoke-AdbText -Arguments @("shell", "am", "startservice", "-n", $Service, "-a", $actionStop) -IgnoreFailure) + "`n")
        Start-Sleep -Seconds 6
        Save-Snapshot -Label "cycle_${cycle}_stopped"

        Set-Utf8NoBom -Path (Join-Path $OutDir "start-$cycle.txt") -Value ((Invoke-AdbText -Arguments @("shell", "am", "start-foreground-service", "-n", $Service, "-a", $actionStart) -IgnoreFailure) + "`n")
        Start-Sleep -Seconds 12
        Save-Snapshot -Label "cycle_${cycle}_restarted"
    }
    Save-Snapshot -Label "final"
}
finally {
    if ($script:BaselineRunning) {
        try { Invoke-AdbText -Arguments @("shell", "am", "start-foreground-service", "-n", $Service, "-a", $actionStart) -IgnoreFailure | Out-Null } catch {}
    }
}

$validator = Join-Path "ci" "validate_android_restart_witness.py"
$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) { $python = Get-Command python3 -ErrorAction SilentlyContinue }
if (-not $python) { throw "Python is required to validate gate-quality restart evidence." }
if (-not (Test-Path -LiteralPath $validator -PathType Leaf)) { throw "Restart validator not found: $validator" }

$result = & $python.Source $validator $OutDir --apk $Apk 2>&1
$exit = $LASTEXITCODE
Set-Utf8NoBom -Path (Join-Path $OutDir "validator.txt") -Value ((($result | ForEach-Object { [string]$_ }) -join "`n") + "`n")
$result | ForEach-Object { Write-Host $_ }
if ($exit -ne 0) { throw "Restart witness validator failed with exit code $exit" }
Write-Host "Gate-quality restart witness collected at $OutDir for commit $($SourceCommit.Substring(0,12)) and APK SHA-256 $($apkSha256.Substring(0,12))…"
