[CmdletBinding()]
param(
    [string]$Apk = "",
    [switch]$PackageReplace,
    [switch]$Handover,
    [switch]$SleepWake,
    [switch]$Idle,
    [ValidateRange(0, 1440)][int]$SoakMinutes = 0,
    [string]$OutDir = "",
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
if (-not [string]::IsNullOrWhiteSpace($Apk) -and -not (Test-Path -LiteralPath $Apk -PathType Leaf)) {
    throw "APK not found: $Apk"
}
if (-not (Get-Command adb -ErrorAction SilentlyContinue)) {
    throw "adb is required and must be available in PATH"
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

$stamp = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
if ([string]::IsNullOrWhiteSpace($OutDir)) {
    $OutDir = Join-Path "artifacts" "android-v160-physical-$stamp"
}
$OutDir = [System.IO.Path]::GetFullPath($OutDir)
$snapshotsDir = Join-Path $OutDir "snapshots"
New-Item -ItemType Directory -Force -Path $snapshotsDir | Out-Null
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

$sourceCommit = "unknown"
if (Get-Command git -ErrorAction SilentlyContinue) {
    try {
        $candidateCommit = (& git rev-parse HEAD 2>$null | Select-Object -First 1).Trim().ToLowerInvariant()
        if ($candidateCommit -match '^[0-9a-f]{40}$') { $sourceCommit = $candidateCommit }
    } catch {}
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

function Save-AdbOutput {
    param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][string[]]$Arguments)
    $value = Invoke-AdbText -Arguments $Arguments -IgnoreFailure
    Set-Utf8NoBom -Path $Path -Value $value
}

function Save-Snapshot {
    param([Parameter(Mandatory)][string]$Label)
    $dir = Join-Path $snapshotsDir $Label
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $epoch = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    [System.IO.File]::AppendAllText($timeline, "$epoch`t$Label`n", [System.Text.UTF8Encoding]::new($false))
    Set-Utf8NoBom -Path (Join-Path $dir "snapshot_epoch_seconds.txt") -Value "$epoch`n"
    Save-AdbOutput -Path (Join-Path $dir "getprop.txt") -Arguments @("shell", "getprop")
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

$metadata = @(
    "schema=3",
    "package=$Package",
    "activity=$Activity",
    "serial=$Serial",
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
    "max_heartbeat_age_ms=30000"
) -join "`n"
Set-Utf8NoBom -Path (Join-Path $OutDir "metadata.env") -Value ($metadata + "`n")

try {
    if (-not [string]::IsNullOrWhiteSpace($Apk)) {
        Set-Utf8NoBom -Path (Join-Path $OutDir "install-initial.txt") -Value ((Invoke-AdbText -Arguments @("install", "-r", $Apk)) + "`n")
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
        Set-Utf8NoBom -Path (Join-Path $OutDir "install-package-replace.txt") -Value ((Invoke-AdbText -Arguments @("install", "-r", $Apk)) + "`n")
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
