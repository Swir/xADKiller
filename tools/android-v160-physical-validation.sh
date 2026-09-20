#!/usr/bin/env bash
set -euo pipefail

PACKAGE="${XADKILLER_PACKAGE:-com.swir.xadkiller.debug}"
ACTIVITY="${XADKILLER_ACTIVITY:-$PACKAGE/com.swir.xadkiller.MainActivityV121}"
SERIAL="${ANDROID_SERIAL:-}"
APK=""
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
  --apk PATH             Install/reinstall a tested debug APK before validation.
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
if [[ -n "$APK" && ! -f "$APK" ]]; then
  echo "APK not found: $APK" >&2
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

"${ADB[@]}" get-state | grep -qx device || { echo "adb device is not online: $SERIAL" >&2; exit 3; }

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

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="${OUT:-artifacts/android-v160-physical-$STAMP}"
mkdir -p "$OUT/snapshots"
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
SOURCE_COMMIT="$(git rev-parse HEAD 2>/dev/null || true)"
[[ "$SOURCE_COMMIT" =~ ^[0-9a-f]{40}$ ]] || SOURCE_COMMIT="unknown"

adb_shell() { "${ADB[@]}" shell "$@"; }
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
  local epoch
  epoch="$(date -u +%s)"
  mkdir -p "$dir"
  printf '%s\t%s\n' "$epoch" "$label" >> "$TIMELINE"
  printf '%s\n' "$epoch" > "$dir/snapshot_epoch_seconds.txt"
  adb_shell getprop > "$dir/getprop.txt" 2>&1 || true
  adb_shell dumpsys connectivity > "$dir/connectivity.txt" 2>&1 || true
  adb_shell dumpsys power > "$dir/power.txt" 2>&1 || true
  adb_shell dumpsys activity services "$PACKAGE" > "$dir/services.txt" 2>&1 || true
  adb_shell dumpsys package "$PACKAGE" > "$dir/package.txt" 2>&1 || true
  adb_shell settings get global boot_count > "$dir/boot_count.txt" 2>&1 || true
  "${ADB[@]}" shell run-as "$PACKAGE" cat shared_prefs/xadkiller_prefs.xml > "$dir/prefs.xml" 2> "$dir/prefs.err" || true
  "${ADB[@]}" shell run-as "$PACKAGE" cat files/system_console.log > "$dir/system_console.log" 2> "$dir/system_console.err" || true
}

cat > "$OUT/metadata.env" <<EOF_META
schema=2
package=$PACKAGE
activity=$ACTIVITY
serial=$SERIAL
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
max_heartbeat_age_ms=$MAX_HEARTBEAT_AGE_MS
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
  WIFI_BEFORE="$(adb_shell settings get global wifi_on 2>/dev/null | tr -d '\r' || true)"
  DATA_BEFORE="$(adb_shell settings get global mobile_data 2>/dev/null | tr -d '\r' || true)"
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
restore_device_state
trap - EXIT INT TERM

if command -v python3 >/dev/null 2>&1 && [[ -f "ci/validate_android_physical_witness.py" ]]; then
  VALIDATOR_ARGS=("$OUT")
  if [[ -n "$APK" ]]; then VALIDATOR_ARGS+=(--apk "$APK"); fi
  python3 ci/validate_android_physical_witness.py "${VALIDATOR_ARGS[@]}" | tee "$OUT/validator.txt"
else
  echo "Evidence collected at $OUT; run: python3 ci/validate_android_physical_witness.py '$OUT'${APK:+ --apk '$APK'}"
fi
