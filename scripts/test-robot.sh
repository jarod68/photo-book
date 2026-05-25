#!/usr/bin/env bash
# Run Robot Framework tests against a local Docker stack.
# Usage: ./scripts/test-robot.sh [--no-teardown]
#
# Starts the app via deploy-local.sh, waits for it to be ready,
# runs all Robot suites, then tears the stack down.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

NO_TEARDOWN=false
[[ "${1:-}" == "--no-teardown" ]] && NO_TEARDOWN=true

teardown() {
  if [[ "$NO_TEARDOWN" == false ]]; then
    echo "[robot] Stopping containers..."
    ./deploy-local.sh down
  fi
}
trap teardown EXIT

echo "[robot] Cleaning up any stale containers..."
./deploy-local.sh down 2>/dev/null || true

echo "[robot] Building and starting containers..."
./deploy-local.sh up -d

echo "[robot] Waiting for http://localhost:3000 ..."
for i in $(seq 1 30); do
  if curl -sf http://localhost:3000 > /dev/null 2>&1; then
    echo "[robot] Server ready (${i}s)."
    break
  fi
  if [[ "$i" -eq 30 ]]; then
    echo "[robot] ERROR: server did not become ready in 60s." >&2
    exit 1
  fi
  sleep 2
done

echo "[robot] Running test suites..."
robot --outputdir tests/robot/results tests/robot/suites/
