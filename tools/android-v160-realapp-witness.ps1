[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Apk,
    [string]$Witness = "artifacts/android-v160-realapp-witness.json",
    [string]$Serial = "",
    [string]$SourceCommit = "",
    [string]$Package = "com.swir.xadkiller.debug",
    [ValidateSet("browser", "video", "shopping", "banking", "messaging", "maps", "streaming", "other")][string]$Category = "",
    [ValidateSet("wifi", "mobile")][string]$Network = "wifi",
    [ValidateRange(1, 30)][int]$Minutes = 5,
    [ValidateRange(0, 15000)][int]$HeartbeatAgeMs = 0,
    [ValidateSet("none", "allowlist", "reload_lists", "restart_vpn", "disable_smart_detector")][string]$Recovery = "none",
    [switch]$FalsePositive,
    [switch]$ExpectedContentFailed
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Invoke-AdbText {
    param([Parameter(Mandatory)][string[]]$Arguments, [switch]$IgnoreFailure)
    $prefix = if ([string]::IsNullOrWhiteSpace($script:Serial)) { @() } else { @("-s", $script:Serial) }
    $previous = $ErrorActionPreference
    try {
        if ($IgnoreFailure) { $ErrorActionPreference = "Continue" }
        $lines = & adb @prefix @Arguments 2>&1
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

function Write-JsonAtomic {
    param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)]$Value)
    $full = [System.IO.Path]::GetFullPath($Path)
    $dir = Split-Path -Parent $full
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $tmp = "$full.tmp-$PID"
    $json = ($Value | ConvertTo-Json -Depth 10) + "`n"
    [System.IO.File]::WriteAllText($tmp, $json, [System.Text.UTF8Encoding]::new($false))
    Move-Item -Force -LiteralPath $tmp -Destination $full
    return $full
}

if (-not (Test-Path -LiteralPath $Apk -PathType Leaf)) { throw "APK not found: $Apk" }
if (-not (Get-Command adb -ErrorAction SilentlyContinue)) { throw "adb is required and must be available in PATH" }
$Apk = (Resolve-Path -LiteralPath $Apk).Path
$apkSha256 = (Get-FileHash -LiteralPath $Apk -Algorithm SHA256).Hash.ToLowerInvariant()
if ($apkSha256 -notmatch '^[0-9a-f]{64}$') { throw "Failed to compute APK SHA-256" }

$script:Serial = $Serial
if ([string]::IsNullOrWhiteSpace($script:Serial)) {
    $devices = @(& adb devices | Select-Object -Skip 1 | ForEach-Object {
        $parts = ([string]$_).Trim() -split "\s+"
        if ($parts.Count -ge 2 -and $parts[1] -eq "device") { $parts[0] }
    } | Where-Object { $_ })
    if ($devices.Count -ne 1) { throw "Expected exactly one online adb device; found $($devices.Count). Use -Serial." }
    $script:Serial = $devices[0]
}
if ((Invoke-AdbText -Arguments @("get-state")).Trim() -ne "device") { throw "adb device is not online: $script:Serial" }

if ([string]::IsNullOrWhiteSpace($SourceCommit)) {
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw "-SourceCommit is required when git is unavailable" }
    $SourceCommit = (& git rev-parse HEAD 2>$null | Select-Object -First 1).Trim().ToLowerInvariant()
} else {
    $SourceCommit = $SourceCommit.Trim().ToLowerInvariant()
}
if ($SourceCommit -notmatch '^[0-9a-f]{40}$') { throw "SourceCommit must be an exact 40-character lowercase Git commit" }

$model = (Invoke-AdbText -Arguments @("shell", "getprop", "ro.product.model")).Trim()
$sdkText = (Invoke-AdbText -Arguments @("shell", "getprop", "ro.build.version.sdk")).Trim()
[int]$sdk = 0
if ([string]::IsNullOrWhiteSpace($model) -or -not [int]::TryParse($sdkText, [ref]$sdk) -or $sdk -lt 26) {
    throw "Could not establish a supported physical-device model/Android SDK"
}

$fullWitness = [System.IO.Path]::GetFullPath($Witness)
if (Test-Path -LiteralPath $fullWitness -PathType Leaf) {
    $witness = Get-Content -LiteralPath $fullWitness -Raw | ConvertFrom-Json
    if ($witness.schema -ne 1 -or $witness.scope -ne "xADKiller Android v1.6 physical real-app stability witness") { throw "Existing witness has the wrong schema/scope" }
    if ($witness.template -eq $true -or $witness.release_gate_closed -ne $false) { throw "Existing witness is not an open real-app evidence file" }
    if ($witness.candidate.source_commit -ne $SourceCommit) { throw "Existing witness source_commit does not match this candidate" }
    if ($witness.candidate.apk_sha256 -ne $apkSha256) { throw "Existing witness APK SHA-256 does not match this candidate" }
    if ($witness.device.model -ne $model -or [int]$witness.device.android_sdk -ne $sdk) { throw "Existing witness is bound to a different physical device" }
} else {
    $witness = [ordered]@{
        schema = 1
        scope = "xADKiller Android v1.6 physical real-app stability witness"
        template = $false
        candidate = [ordered]@{ source_commit = $SourceCommit; apk_sha256 = $apkSha256 }
        device = [ordered]@{ model = $model; android_sdk = $sdk }
        release_gate_closed = $false
        observations = @()
    }
}

if (-not [string]::IsNullOrWhiteSpace($Category)) {
    if ($FalsePositive -and $Recovery -eq "none") { throw "A false positive requires an explicit recovery action" }
    if (-not $FalsePositive -and $Recovery -ne "none") { throw "Recovery may only be recorded for a false positive" }

    $prefs = Invoke-AdbText -Arguments @("shell", "run-as", $Package, "cat", "shared_prefs/xadkiller_prefs.xml") -IgnoreFailure
    if ($prefs -notmatch 'name="running"\s+value="true"|<boolean\s+name="running"\s+value="true"') {
        throw "Protection is not proven active in app preferences; start VPN protection before recording an observation"
    }

    $observation = [ordered]@{
        observed_at = (Get-Date).ToUniversalTime().ToString("o")
        category = $Category
        network = $Network
        minutes = $Minutes
        vpn_heartbeat_age_ms = $HeartbeatAgeMs
        protection_active = $true
        expected_content_ok = (-not $ExpectedContentFailed.IsPresent)
        false_positive = $FalsePositive.IsPresent
        recovered = $FalsePositive.IsPresent
        recovery = $Recovery
    }
    $existing = @($witness.observations)
    $witness.observations = @($existing + $observation)
}

$fullWitness = Write-JsonAtomic -Path $fullWitness -Value $witness
$items = @($witness.observations)
$totalMinutes = ($items | Measure-Object -Property minutes -Sum).Sum
if ($null -eq $totalMinutes) { $totalMinutes = 0 }
$categories = @($items | ForEach-Object { $_.category } | Sort-Object -Unique).Count
$networks = @($items | ForEach-Object { $_.network } | Sort-Object -Unique) -join ","
Write-Host "Android v1.6 real-app witness: $($items.Count)/12 observations, $totalMinutes/60 minutes, $categories/6 categories, networks=[$networks]"
Write-Host "Candidate: $($SourceCommit.Substring(0,12)) · APK SHA-256 $($apkSha256.Substring(0,12))… · device $model / SDK $sdk"
Write-Host "Evidence file: $fullWitness"

if ($items.Count -ge 12) {
    $validator = Join-Path "ci" "validate_android_realapp_witness.py"
    $python = Get-Command python -ErrorAction SilentlyContinue
    if (-not $python) { $python = Get-Command python3 -ErrorAction SilentlyContinue }
    if ($python -and (Test-Path -LiteralPath $validator -PathType Leaf)) {
        & $python.Source $validator $fullWitness
        if ($LASTEXITCODE -ne 0) { throw "Real-app witness is still incomplete or invalid; evidence was saved for correction" }
    } else {
        Write-Warning "Python validator unavailable. Run: python ci/validate_android_realapp_witness.py `"$fullWitness`" before treating this as gate-quality evidence."
    }
} else {
    Write-Host "Witness remains intentionally incomplete. Continue real-app observations; do not mark the release gate complete yet."
}
