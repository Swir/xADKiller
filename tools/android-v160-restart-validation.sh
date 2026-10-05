#!/usr/bin/env bash
set -euo pipefail

PACKAGE="${XADKILLER_PACKAGE:-com.swir.xadkiller.debug}"
SERVICE="${XADKILLER_SERVICE:-$PACKAGE/com.swir.xadkiller.AdBlockVpnServiceV121}"
ACTION_START="com.swir.xadkiller.v121.START"
ACTION_STOP="com.swir.xadkiller.v121.STOP"
SERIAL="${ANDROID_SERIAL:-}"
APK=""
OUT=""
CYCLES=3
MAX_HEARTBEAT_AGE_MS=30000

usage() {
  cat <<'USAGE'
Usage: tools/android-v160-restart-validation.sh [options]

Collects a local-only witness for the Android v1.6 VPN start/stop/restart gate.
The VPN must already be consented and running before the script starts. It never
clicks the VPN consent dialog, never uploads evidence and restores protection to
RUNNING when the baseline was active.

Options:
  --apk PATH          Bind evidence to an exact APK SHA-256 (does not install it).
  --cycles N          Stop/start cycles, 1..10 (default: 3).
  --out DIR           Evidence directory (default: artifacts/android-v160-restart-<UTC>).
  --serial SERIAL     adb device serial; otherwise ANDROID_SERIAL/sole attached device.
  -h, --help          Show this help.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apk) APK="${2:?missing APK path}"; shift 2 ;;
    --cycles) CYCLES="${2:?missing cycle count}"; shift 2 ;;
    --out) OUT="${2:?missing output directory}"; shift 2 ;;
    --serial) SERIAL="${2:?missing serial}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

[[ "$CYCLES" =~ ^[0-9]+$ ]] && (( CYCLES >= 1 && CYCLES <= 10 )) || { echo "--cycles must be 1..10" >&2; exit 2; }
if [[ -n "$APK" && ! -f "$APK" ]]; then echo "APK not found: $APK" >&2; exit 2; fi
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
"${ADB[@]}" get-state | grep -qx device || { echo "adb device is not online" >&2; exit 3; }

sha256_file() {
  local path="$1"
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$path" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then shasum -a 256 "$path" | awk '{print $1}'
  else python3 - "$path" <<'PY'
import hashlib, pathlib, sys
p=pathlib.Path(sys.argv[1]); h=hashlib.sha256()
with p.open('rb') as f:
    for chunk in iter(lambda:f.read(1024*1024), b''): h.update(chunk)
print(h.hexdigest())
PY
  fi
}
sha256_text() {
  if command -v sha256sum >/dev/null 2>&1; then printf '%s' "$1" | sha256sum | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then printf '%s' "$1" | shasum -a 256 | awk '{print $1}'
  else python3 - "$1" <<'PY'
import hashlib,sys
print(hashlib.sha256(sys.argv[1].encode()).hexdigest())
PY
  fi
}

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="${OUT:-artifacts/android-v160-restart-$STAMP}"
mkdir -p "$OUT/snapshots"
TIMELINE="$OUT/timeline.tsv"
: > "$TIMELINE"
SOURCE_COMMIT="$(git rev-parse HEAD 2>/dev/null || true)"
[[ "$SOURCE_COMMIT" =~ ^[0-9a-f]{40}$ ]] || SOURCE_COMMIT="unknown"
SERIAL_HASH="$(sha256_text "$SERIAL" | cut -c1-16)"
APK_SHA256=""
if [[ -n "$APK" ]]; then APK_SHA256="$(sha256_file "$APK" | tr '[:upper:]' '[:lower:]')"; fi

snapshot() {
  local label="$1" epoch dir
  epoch="$(date -u +%s)"
  dir="$OUT/snapshots/$label"
  mkdir -p "$dir"
  printf '%s\t%s\n' "$epoch" "$label" >> "$TIMELINE"
  printf '%s\n' "$epoch" > "$dir/snapshot_epoch_seconds.txt"
  "${ADB[@]}" shell run-as "$PACKAGE" cat shared_prefs/xadkiller_prefs.xml > "$dir/prefs.xml" 2> "$dir/prefs.err" || true
  "${ADB[@]}" shell dumpsys activity services "$PACKAGE" > "$dir/services.txt" 2>&1 || true
  "${ADB[@]}" shell dumpsys package "$PACKAGE" > "$dir/package.txt" 2>&1 || true
}

cat > "$OUT/metadata.env" <<EOF_META
schema=1
scope=vpn-start-stop-restart
package=$PACKAGE
service=$SERVICE
serial_hash=$SERIAL_HASH
started_utc=$STAMP
source_commit=$SOURCE_COMMIT
cycles=$CYCLES
apk_supplied=$([[ -n "$APK" ]] && echo 1 || echo 0)
apk_sha256=$APK_SHA256
max_heartbeat_age_ms=$MAX_HEARTBEAT_AGE_MS
privacy=local-only-no-urls-no-hostnames-no-app-traffic-log
EOF_META

snapshot baseline
if ! grep -Eq 'name="running" value="true"|<boolean name="running" value="true"' "$OUT/snapshots/baseline/prefs.xml" 2>/dev/null; then
  echo "Baseline does not prove an active VPN. Grant VPN consent/start protection in the app, then rerun." >&2
  exit 4
fi

for ((cycle=1; cycle<=CYCLES; cycle++)); do
  "${ADB[@]}" shell am startservice -n "$SERVICE" -a "$ACTION_STOP" > "$OUT/stop-$cycle.txt" 2>&1 || true
  sleep 6
  snapshot "cycle_${cycle}_stopped"

  "${ADB[@]}" shell am start-foreground-service -n "$SERVICE" -a "$ACTION_START" > "$OUT/start-$cycle.txt" 2>&1 || true
  sleep 12
  snapshot "cycle_${cycle}_restarted"
done
snapshot final

if command -v python3 >/dev/null 2>&1 && [[ -f "ci/validate_android_restart_witness.py" ]]; then
  ARGS=("$OUT")
  if [[ -n "$APK" ]]; then ARGS+=(--apk "$APK"); fi
  python3 ci/validate_android_restart_witness.py "${ARGS[@]}" | tee "$OUT/validator.txt"
else
  echo "Evidence collected at $OUT; validate with ci/validate_android_restart_witness.py"
fi
