#!/bin/bash
# Runs `devservices up` with retries and telemetry. Intended to be launched in
# the background by setup-devservices/action.yml. Writes the final exit code
# to /tmp/ds-exit after all attempts, and structured output (including
# per-line timestamps on devservices output) to stdout — the caller redirects
# that to /tmp/ds.log. A separate heartbeat sidecar appends docker + host
# state to /tmp/ds-heartbeat.log every 15s, so a future silent hang can be
# diagnosed from the heartbeat trail.
#
# Usage: run.sh <mode> <attempt-timeout> <max-attempts>
#   mode             devservices mode, e.g. acceptance-ci
#   attempt-timeout  per-attempt timeout passed to `timeout`, e.g. 4m
#   max-attempts     integer >= 1
set +e

MODE="$1"
ATTEMPT_TIMEOUT="$2"
MAX_ATTEMPTS="$3"
DS=/tmp/ds-venv/bin/devservices
START_EPOCH=$(date +%s)

elapsed() { echo "+$(( $(date +%s) - START_EPOCH ))s"; }

(
  while :; do
    {
      echo "=== heartbeat $(date -u +%T) ($(elapsed)) ==="
      echo "-- docker ps --"
      timeout 5 docker ps -a --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}' \
        || echo "docker ps hung or failed"
      echo "-- docker/compose procs --"
      pgrep -af 'docker|compose|devservices' || echo "none"
      echo "-- df / --"; df -h / | tail -1
      echo "-- free --";  free -m | awk 'NR<=2'
      echo
    } >> /tmp/ds-heartbeat.log 2>&1
    sleep 15
  done
) &
HB_PID=$!
trap 'kill "$HB_PID" 2>/dev/null' EXIT

dump_diag() {
  local tag="$1"
  echo "::group::$tag diagnostics"
  echo "-- docker info --"
  timeout 10 docker info 2>&1 | head -40 || true
  echo "-- docker ps -a --"
  timeout 10 docker ps -a 2>&1 || true
  echo "-- procs --"
  pgrep -af 'docker|compose|devservices' || true
  echo "-- journalctl docker (last 10m, tail 50) --"
  sudo journalctl -u docker.service --since "10 min ago" --no-pager 2>&1 | tail -50 || true
  echo "::endgroup::"
}

stamp_lines() {
  # Prefix each stdin line with a UTC wall-clock time. Python3 is always on
  # GH-hosted runners; `ts` (moreutils) is not.
  python3 -u -c '
import sys, time
for line in sys.stdin:
    sys.stdout.write("[%s] %s" % (time.strftime("%H:%M:%S", time.gmtime()), line))
    sys.stdout.flush()
'
}

rc=1
for attempt in $(seq 1 "$MAX_ATTEMPTS"); do
  echo "::group::devservices up attempt $attempt/$MAX_ATTEMPTS (per-attempt timeout: $ATTEMPT_TIMEOUT, $(elapsed))"
  stdbuf -oL -eL timeout "$ATTEMPT_TIMEOUT" "$DS" up --mode "$MODE" 2>&1 \
    | stamp_lines
  rc=${PIPESTATUS[0]}
  echo "attempt $attempt finished rc=$rc ($(elapsed))"
  echo "::endgroup::"
  if [ "$rc" -eq 0 ]; then
    break
  fi
  dump_diag "attempt $attempt failure"
  if [ "$attempt" -lt "$MAX_ATTEMPTS" ]; then
    echo "::group::cleanup before retry"
    timeout 60 "$DS" down --mode "$MODE" 2>&1 \
      || echo "devservices down hung or failed (non-fatal)"
    echo "::endgroup::"
    sleep 3
  fi
done

echo "$rc" > /tmp/ds-exit
