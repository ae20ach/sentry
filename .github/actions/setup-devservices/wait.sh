#!/bin/bash
set -euo pipefail

# Wait for the background devservices process started by setup-devservices/action.yml.
# run.sh handles retries internally and writes the final rc to /tmp/ds-exit, so
# this ceiling just needs to cover the worst-case retry budget
# (default: 3 attempts × 4m + diagnostics/sleeps ≈ 13m). Bumped from 600s.
# Usage: wait.sh [timeout_seconds]
TIMEOUT=${1:-900}

dump_logs() {
  if [ -f /tmp/ds.log ]; then
    echo "--- /tmp/ds.log ---"
    cat /tmp/ds.log
  fi
  if [ -f /tmp/ds-heartbeat.log ]; then
    echo "--- /tmp/ds-heartbeat.log (last 200 lines) ---"
    tail -n 200 /tmp/ds-heartbeat.log
  fi
}

SECONDS=0
while [ ! -f /tmp/ds-exit ]; do
  if [ $SECONDS -gt "$TIMEOUT" ]; then
    echo "::error::Timed out waiting for devservices after ${TIMEOUT}s"
    dump_logs
    exit 1
  fi
  sleep 2
done

DS_RC=$(< /tmp/ds-exit)
if [ "$DS_RC" -ne 0 ]; then
  echo "::error::devservices up failed (exit $DS_RC) after retries"
  dump_logs
  exit 1
fi

echo "DJANGO_LIVE_TEST_SERVER_ADDRESS=$(docker network inspect bridge --format='{{(index .IPAM.Config 0).Gateway}}')" >> "$GITHUB_ENV"
docker ps -a
