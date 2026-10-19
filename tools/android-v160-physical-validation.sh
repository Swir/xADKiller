#!/usr/bin/env bash
set -euo pipefail

PACKAGE="${XADKILLER_PACKAGE:-com.swir.xadkiller.debug}"
ACTIVITY="${XADKILLER_ACTIVITY:-$PACKAGE/com.swir.xadkiller.MainActivityV121}"
SERIAL="${ANDROID_SERIAL:-}"
APK=""
PROVENANCE=""
SOURCE_COMMIT_INPUT=""
DO_HANDOVER=0
DO_SLEEP_WAKE=0
DO_IDLE=0
DO_PACKAGE_REPLACE=0
SOAK_MINUTES=0
OUT=""
MAX_HEARTBEAT_AGE_MS=30000

usage() {
  cat <<'USAGE'
Usage: tools/android-v160-physical-validation.sh [options]

Collects a local-only, reproducible witness bundle for the remaining Android v1.6
physical-device release gates. It never grants VPN consent and never marks the
roadmap complete; the resulting bundle must still be reviewed.

Options:
  --apk PATH             Install/reinstall the exact tested debug APK (requires --provenance).
  --provenance PATH      Build PROVENANCE.env used to bind source commit/APK hash/artifact name.
  --source-commit SHA    Exact lowercase 40-hex source commit (must agree with provenance).
  --package-replace      Exercise MY_PACKAGE_REPLACED using --apk (requires active VPN first).
  --handover             Exercise Wi-Fi -> mobile -> Wi-Fi and restore prior radio state.
  --sleep-wake           Exercise screen sleep/wake while protection stays active.
  --idle                 Exercise Doze force-idle/unforce (adb shell support required).
  --soak-minutes N       Keep collecting evidence for N minutes (0 disables soak).
  --out DIR              Evidence directory (default: artifacts/android-v160-physical-<UTC>).
  --serial SERIAL        adb device serial; otherwise ANDROID_SERIAL/sole attached device.
  -h, --help             Show this help.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apk) APK="${2:?missing APK path}"; shift 2 ;;
    --provenance) PROVENANCE="${2:?missing provenance path}"; shift 2 ;;
    --source-commit) SOURCE_COMMIT_INPUT="${2:?missing source commit}"; shift 2 ;;
    --package-replace) DO_PACKAGE_REPLACE=1; shift ;;
    --handover) DO_HANDOVER=1; shift ;;
    --sleep-wake) DO_SLEEP_WAKE=1; shift ;;
    --idle) DO_IDLE=1; shift ;;
    --soak-minutes) SOAK_MINUTES="${2:?missing minutes}"; shift 2 ;;
    --out) OUT="${2:?missing output directory}"; shift 2 ;;
    --serial) SERIAL="${2:?missing serial}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

[[ "$SOAK_MINUTES" =~ ^[0-9]+$ ]] || { echo "--soak-minutes must be an integer >= 0" >&2; exit 2; }
if (( DO_PACKAGE_REPLACE )) && [[ -z "$APK" ]]; then
  echo "--package-replace requires --apk PATH" >&2
  exit 2
fi
if [[ -n "$APK" && -z "$PROVENANCE" ]]; then
  echo "--apk requires --provenance PROVENANCE.env for exact-SHA binding" >&2
  exit 2
fi
if [[ -n "$APK" && ! -f "$APK" ]]; then
  echo "APK not found: $APK" >&2
  exit 2
fi
if [[ -n "$PROVENANCE" && ! -f "$PROVENANCE" ]]; then
  echo "Provenance file not found: $PROVENANCE" >&2
  exit 2
fi

command -v adb >/dev/null 2>&1 || { echo "adb is required" >&2; exit 127; }
ADB=(adb)
if [[ -n "$SERIAL" ]]; then ADB+=( -s "$SERIAL" ); fi

if [[ -z "$SERIAL" ]]; then
  mapfile -t DEVICES < <(adb devices | awk 'NR>1 && $2=="device" {print $1}')
  if [[ ${#DEVICES[@]} -ne 1 ]]; then
    echo "Expected exactly one online adb device; found ${#DEVICES[@]}. Use --serial." >&2
    exit 3
  fi
  SERIAL="${DEVICES[0]}"
  ADB=(adb -s "$SERIAL")
fi

"${ADB[@]}" get-state | grep -qx device || { echo "selected adb device is not online" >&2; exit 3; }

sha256_file() {
  local path="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$path" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$path" | awk '{print $1}'
  elif command -v python3 >/dev/null 2>&1; then
    python3 - "$path" <<'PY'
import hashlib, pathlib, sys
p = pathlib.Path(sys.argv[1])
h = hashlib.sha256()
with p.open('rb') as f:
    for chunk in iter(lambda: f.read(1024 * 1024), b''):
        h.update(chunk)
print(h.hexdigest())
PY
  else
    echo "Need sha256sum, shasum, or python3 to fingerprint the APK" >&2
    return 127
  fi
}

sha256_text() {
  local value="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    printf '%s' "$value" | sha256sum | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    printf '%s' "$value" | shasum -a 256 | awk '{print $1}'
  elif command -v python3 >/dev/null 2>&1; then
    python3 - "$value" <<'PY'
import hashlib, sys
print(hashlib.sha256(sys.argv[1].encode("utf-8")).hexdigest())
PY
  else
    echo "Need sha256sum, shasum, or python3 to hash the device identity" >&2
    return 127
  fi
}

SERIAL_HASH="$(sha256_text "$SERIAL")"
SERIAL_HASH="${SERIAL_HASH,,}"
SERIAL_HASH="${SERIAL_HASH:0:16}"
[[ "$SERIAL_HASH" =~ ^[0-9a-f]{16}$ ]] || { echo "Failed to derive privacy-safe device identity" >&2; exit 4; }

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="${OUT:-artifacts/android-v160-physical-$STAMP}"
if [[ -e "$OUT" || -L "$OUT" ]]; then
  echo "Evidence output must be a fresh path and must not already exist: $OUT" >&2
  exit 4
fi
OUT_PARENT="$(dirname "$OUT")"
mkdir -p "$OUT_PARENT"
mkdir "$OUT"
mkdir "$OUT/snapshots"
TIMELINE="$OUT/timeline.tsv"
: > "$TIMELINE"

WIFI_BEFORE=""
DATA_BEFORE=""
IDLE_FORCED=0
APK_SHA256=""
APK_BASENAME=""
if [[ -n "$APK" ]]; then
  APK_SHA256="$(sha256_file "$APK")"
  [[ "$APK_SHA256" =~ ^[0-9a-fA-F]{64}$ ]] || { echo "Failed to compute APK SHA-256" >&2; exit 4; }
  APK_SHA256="${APK_SHA256,,}"
  APK_BASENAME="$(basename "$APK")"
fi
SOURCE_COMMIT=""
PROVENANCE_APK_SHA256=""
PROVENANCE_ARTIFACT=""
PROVENANCE_TESTED_ARTIFACT=""
PROVENANCE_SNAPSHOT_SHA256=""
PROVENANCE_BOUND=0
if [[ -n "$PROVENANCE" ]]; then
  for key in schema provenance_contract source_commit artifact tested_artifact apk_sha256; do
    count="$(grep -c "^${key}=" "$PROVENANCE" || true)"
    [[ "$count" == "1" ]] || { echo "PROVENANCE.env must contain exactly one ${key}= entry" >&2; exit 4; }
  done
  PROVENANCE_SCHEMA="$(sed -n 's/^schema=//p' "$PROVENANCE" | head -n1 | tr -d '\r')"
  PROVENANCE_CONTRACT="$(sed -n 's/^provenance_contract=//p' "$PROVENANCE" | head -n1 | tr -d '\r')"
  SOURCE_COMMIT="$(sed -n 's/^source_commit=//p' "$PROVENANCE" | head -n1 | tr '[:upper:]' '[:lower:]' | tr -d '\r')"
  PROVENANCE_ARTIFACT="$(sed -n 's/^artifact=//p' "$PROVENANCE" | head -n1 | tr -d '\r')"
  PROVENANCE_TESTED_ARTIFACT="$(sed -n 's/^tested_artifact=//p' "$PROVENANCE" | head -n1 | tr -d '\r')"
  PROVENANCE_APK_SHA256="$(sed -n 's/^apk_sha256=//p' "$PROVENANCE" | head -n1 | tr '[:upper:]' '[:lower:]' | tr -d '\r')"
  [[ "$PROVENANCE_SCHEMA" == "1" ]] || { echo "PROVENANCE.env schema must be 1" >&2; exit 4; }
  [[ "$PROVENANCE_CONTRACT" == "exact-sha-v1" ]] || { echo "PROVENANCE.env provenance_contract must be exact-sha-v1" >&2; exit 4; }
  [[ "$SOURCE_COMMIT" =~ ^[0-9a-f]{40}$ ]] || { echo "PROVENANCE.env source_commit must be lowercase 40-hex" >&2; exit 4; }
  [[ "$PROVENANCE_ARTIFACT" == "xADKiller-Android-v1.6.0-dev-debug.apk" ]] || { echo "PROVENANCE.env artifact must be the canonical APK name" >&2; exit 4; }
  [[ "$PROVENANCE_TESTED_ARTIFACT" == "xADKiller-Android-v1.6.0-dev-debug-$SOURCE_COMMIT.apk" ]] || {
    echo "PROVENANCE.env tested_artifact does not bind the exact source commit" >&2
    exit 4
  }
  [[ "$PROVENANCE_APK_SHA256" =~ ^[0-9a-f]{64}$ ]] || { echo "PROVENANCE.env apk_sha256 must be lowercase 64-hex" >&2; exit 4; }
  if [[ -n "$APK_SHA256" && "$APK_SHA256" != "$PROVENANCE_APK_SHA256" ]]; then
    echo "APK SHA-256 does not match PROVENANCE.env" >&2
    exit 4
  fi
  if [[ -n "$APK_BASENAME" && "$APK_BASENAME" != "$PROVENANCE_TESTED_ARTIFACT" ]]; then
    echo "APK basename does not match PROVENANCE.env tested_artifact" >&2
    exit 4
  fi
  if [[ -n "$APK_SHA256" ]]; then PROVENANCE_BOUND=1; fi
fi
if [[ -n "$SOURCE_COMMIT_INPUT" ]]; then
  SOURCE_COMMIT_INPUT="${SOURCE_COMMIT_INPUT,,}"
  [[ "$SOURCE_COMMIT_INPUT" =~ ^[0-9a-f]{40}$ ]] || { echo "--source-commit must be lowercase 40-hex" >&2; exit 2; }
  if [[ -n "$SOURCE_COMMIT" && "$SOURCE_COMMIT" != "$SOURCE_COMMIT_INPUT" ]]; then
    echo "--source-commit does not match PROVENANCE.env" >&2
    exit 4
  fi
  SOURCE_COMMIT="$SOURCE_COMMIT_INPUT"
fi
if [[ -z "$SOURCE_COMMIT" ]]; then
  SOURCE_COMMIT="$(git rev-parse HEAD 2>/dev/null || true)"
  SOURCE_COMMIT="${SOURCE_COMMIT,,}"
fi
[[ "$SOURCE_COMMIT" =~ ^[0-9a-f]{40}$ ]] || {
  echo "Gate-quality evidence requires an exact 40-hex source commit; run from the tested checkout or pass --provenance/--source-commit." >&2
  exit 4
}

if [[ -n "$PROVENANCE" ]]; then
  cat > "$OUT/build-provenance.env" <<EOF_PROVENANCE_SNAPSHOT
schema=1
provenance_contract=exact-sha-v1
source_commit=$SOURCE_COMMIT
artifact=$PROVENANCE_ARTIFACT
tested_artifact=$PROVENANCE_TESTED_ARTIFACT
apk_sha256=$PROVENANCE_APK_SHA256
EOF_PROVENANCE_SNAPSHOT
  PROVENANCE_SNAPSHOT_SHA256="$(sha256_file "$OUT/build-provenance.env")"
  [[ "$PROVENANCE_SNAPSHOT_SHA256" =~ ^[0-9a-f]{64}$ ]] || { echo "Failed to hash canonical provenance snapshot" >&2; exit 4; }
fi

adb_shell() { "${ADB[@]}" shell "$@"; }
redact_serial_file() {
  local path="$1" tmp
  [[ -f "$path" && -n "$SERIAL" ]] || return 0
  tmp="$path.redacted.$$"
  awk -v needle="$SERIAL" -v repl="[redacted-device-id]" '
    {
      line=$0
      while (needle != "" && (pos=index(line, needle)) > 0) {
        line=substr(line, 1, pos - 1) repl substr(line, pos + length(needle))
      }
      print line
    }
  ' "$path" > "$tmp"
  mv "$tmp" "$path"
}
assert_witness_tree_types() {
  local bad
  bad="$(find "$OUT" -mindepth 1 ! -type d ! -type f -print -quit)"
  if [[ -n "$bad" ]]; then
    echo "Unsupported witness filesystem entry: ${bad#"$OUT"/}" >&2
    exit 4
  fi
  bad="$(find "$OUT" -type f -links +1 -print -quit)"
  if [[ -n "$bad" ]]; then
    echo "Hard-linked witness file is forbidden: ${bad#"$OUT"/}" >&2
    exit 4
  fi
}
sanitize_witness_tree() {
  local path
  while IFS= read -r -d '' path; do
    redact_serial_file "$path"
  done < <(find "$OUT" -type f ! -name metadata.env -print0)
}
write_witness_manifest() {
  local manifest="$OUT/witness-manifest.sha256" tmp path rel hash
  tmp="$OUT/.witness-manifest.sha256.tmp"
  : > "$tmp"
  while IFS= read -r -d '' path; do
    rel="${path#"$OUT"/}"
    case "$rel" in
      witness-manifest.sha256|.witness-manifest.sha256.tmp|validation-summary.json|validator.txt) continue ;;
    esac
    hash="$(sha256_file "$path")"
    [[ "$hash" =~ ^[0-9a-f]{64}$ ]] || { echo "Failed to hash witness file: $rel" >&2; rm -f "$tmp"; exit 4; }
    printf '%s  %s\n' "$hash" "$rel" >> "$tmp"
  done < <(find "$OUT" -type f -print0 | sort -z)
  mv "$tmp" "$manifest"
}
capture_build_properties() {
  local path="$1" key value
  : > "$path"
  for key in ro.build.version.release ro.build.version.sdk ro.build.version.security_patch ro.product.cpu.abi; do
    value="$(adb_shell getprop "$key" 2>/dev/null | tr -d '\r\n' || true)"
    printf '%s=%s\n' "$key" "$value" >> "$path"
  done
}
read_radio_flag() {
  local key="$1"
  adb_shell settings get global "$key" 2>/dev/null | tr -d '\r' | head -n1 || true
}
restore_device_state() {
  set +e
  if (( IDLE_FORCED )); then adb_shell cmd deviceidle unforce >/dev/null 2>&1; fi
  if [[ "$WIFI_BEFORE" == "1" ]]; then adb_shell svc wifi enable >/dev/null 2>&1; fi
  if [[ "$WIFI_BEFORE" == "0" ]]; then adb_shell svc wifi disable >/dev/null 2>&1; fi
  if [[ "$DATA_BEFORE" == "1" ]]; then adb_shell svc data enable >/dev/null 2>&1; fi
  if [[ "$DATA_BEFORE" == "0" ]]; then adb_shell svc data disable >/dev/null 2>&1; fi
}
trap restore_device_state EXIT INT TERM

snapshot() {
  local label="$1"
  local dir="$OUT/snapshots/$label"
  local epoch wifi_on mobile_data
  epoch="$(date -u +%s)"
  mkdir -p "$dir"
  printf '%s\t%s\n' "$epoch" "$label" >> "$TIMELINE"
  printf '%s\n' "$epoch" > "$dir/snapshot_epoch_seconds.txt"
  capture_build_properties "$dir/getprop.txt"
  adb_shell dumpsys connectivity > "$dir/connectivity.txt" 2>&1 || true
  adb_shell dumpsys power > "$dir/power.txt" 2>&1 || true
  adb_shell dumpsys activity services "$PACKAGE" > "$dir/services.txt" 2>&1 || true
  adb_shell dumpsys package "$PACKAGE" > "$dir/package.txt" 2>&1 || true
  adb_shell settings get global boot_count > "$dir/boot_count.txt" 2>&1 || true
  "${ADB[@]}" shell run-as "$PACKAGE" cat shared_prefs/xadkiller_prefs.xml > "$dir/prefs.xml" 2> "$dir/prefs.err" || true
  "${ADB[@]}" shell run-as "$PACKAGE" cat files/system_console.log > "$dir/system_console.log" 2> "$dir/system_console.err" || true
  wifi_on="$(read_radio_flag wifi_on)"
  mobile_data="$(read_radio_flag mobile_data)"
  cat > "$dir/radio-state.env" <<EOF_RADIO
wifi_on=$wifi_on
mobile_data=$mobile_data
EOF_RADIO
}

cat > "$OUT/metadata.env" <<EOF_META
schema=3
package=$PACKAGE
activity=$ACTIVITY
serial_hash=$SERIAL_HASH
serial_privacy=sha256-16
started_utc=$STAMP
source_commit=$SOURCE_COMMIT
requested_handover=$DO_HANDOVER
requested_sleep_wake=$DO_SLEEP_WAKE
requested_idle=$DO_IDLE
requested_package_replace=$DO_PACKAGE_REPLACE
requested_soak_minutes=$SOAK_MINUTES
apk_supplied=$([[ -n "$APK" ]] && echo 1 || echo 0)
apk_basename=$APK_BASENAME
apk_sha256=$APK_SHA256
provenance_bound=$PROVENANCE_BOUND
provenance_contract=$([[ -n "$PROVENANCE" ]] && echo exact-sha-v1 || echo none)
provenance_artifact=$PROVENANCE_ARTIFACT
provenance_tested_artifact=$PROVENANCE_TESTED_ARTIFACT
provenance_snapshot_sha256=$PROVENANCE_SNAPSHOT_SHA256
max_heartbeat_age_ms=$MAX_HEARTBEAT_AGE_MS
privacy=local-only-device-id-hashed-no-urls-no-hostnames-no-app-traffic-log
EOF_META

if [[ -n "$APK" ]]; then
  "${ADB[@]}" install -r "$APK" | tee "$OUT/install-initial.txt"
fi

"${ADB[@]}" shell am start -W -n "$ACTIVITY" > "$OUT/activity-start.txt" 2>&1 || true
sleep 2
snapshot baseline

# The debug build is debuggable, so a fresh VPN heartbeat can be inspected locally without
# network upload. A missing/stale heartbeat is a truthful blocker: the user must grant VPN
# consent and start protection in the app before the physical lifecycle sequence can be accepted.
if ! grep -Eq 'name="running" value="true"|<boolean name="running" value="true"' "$OUT/snapshots/baseline/prefs.xml" 2>/dev/null; then
  echo "WARNING: baseline does not prove an active VPN. Grant VPN consent/start protection, then rerun for gate-quality evidence." | tee "$OUT/baseline-warning.txt"
fi

if (( DO_PACKAGE_REPLACE )); then
  snapshot pre_package_replace
  "${ADB[@]}" install -r "$APK" | tee "$OUT/install-package-replace.txt"
  sleep 10
  snapshot post_package_replace
fi

if (( DO_SLEEP_WAKE )); then
  snapshot pre_sleep
  adb_shell input keyevent 223 >/dev/null 2>&1 || adb_shell input keyevent KEYCODE_SLEEP >/dev/null 2>&1 || true
  sleep 10
  adb_shell input keyevent 224 >/dev/null 2>&1 || adb_shell input keyevent KEYCODE_WAKEUP >/dev/null 2>&1 || true
  adb_shell wm dismiss-keyguard >/dev/null 2>&1 || true
  sleep 8
  snapshot post_wake
fi

if (( DO_IDLE )); then
  snapshot pre_idle
  adb_shell cmd deviceidle force-idle > "$OUT/deviceidle-force.txt" 2>&1
  IDLE_FORCED=1
  sleep 12
  snapshot forced_idle
  adb_shell cmd deviceidle unforce > "$OUT/deviceidle-unforce.txt" 2>&1
  IDLE_FORCED=0
  sleep 8
  snapshot post_idle
fi

if (( DO_HANDOVER )); then
  WIFI_BEFORE="$(read_radio_flag wifi_on)"
  DATA_BEFORE="$(read_radio_flag mobile_data)"
  [[ "$WIFI_BEFORE" =~ ^[01]$ ]] || WIFI_BEFORE=""
  [[ "$DATA_BEFORE" =~ ^[01]$ ]] || DATA_BEFORE=""

  adb_shell svc data enable >/dev/null 2>&1 || true
  adb_shell svc wifi enable >/dev/null 2>&1 || true
  sleep 10
  snapshot wifi_ready

  adb_shell svc wifi disable >/dev/null 2>&1
  sleep 12
  snapshot mobile_only

  adb_shell svc wifi enable >/dev/null 2>&1
  sleep 12
  snapshot wifi_restored
fi

if (( SOAK_MINUTES > 0 )); then
  snapshot soak_start
  for ((minute=1; minute<=SOAK_MINUTES; minute++)); do
    sleep 60
    if (( minute == SOAK_MINUTES || minute % 5 == 0 )); then
      snapshot "soak_${minute}m"
    fi
  done
fi

snapshot final
assert_witness_tree_types
sanitize_witness_tree
assert_witness_tree_types
write_witness_manifest
restore_device_state
trap - EXIT INT TERM

if command -v python3 >/dev/null 2>&1 && [[ -f "ci/validate_android_physical_witness.py" ]]; then
  VALIDATOR_ARGS=("$OUT")
  if [[ -n "$APK" ]]; then VALIDATOR_ARGS+=(--apk "$APK"); fi
  python3 ci/validate_android_physical_witness.py "${VALIDATOR_ARGS[@]}" | tee "$OUT/validator.txt"
else
  echo "Evidence collected at $OUT; run: python3 ci/validate_android_physical_witness.py '$OUT'${APK:+ --apk '$APK'}"
fi
