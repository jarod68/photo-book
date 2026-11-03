#!/usr/bin/env bash
# Load test against a local build — same setup as CI (the `load` job): the
# e2e server (scripts/e2e-server.sh) filled with tests/load/seed.js, visitors
# simulated by k6 (tests/load/browse.js, its thresholds fail the run), the
# server's memory sampled every second: its peak must stay under
# LOAD_MAX_RSS_MB (768: prod's pod is limited to 1 GiB). A Markdown summary
# goes to $LOAD_SUMMARY (and to the CI run's page).
# Needs k6 on the PATH and an empty PostgreSQL (POSTGRES_* variables).
# Usage: scripts/test-load.sh [k6 options]   e.g. -e LOAD_VUS=150
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

export PORT="${PORT:-3000}"
export E2E_DIR="${E2E_DIR:-${RUNNER_TEMP:-/tmp}/photo-book-e2e}"
BASE_URL="http://localhost:${PORT}"
MAX_RSS_MB="${LOAD_MAX_RSS_MB:-768}"
OUT="${LOAD_OUT:-load-results}"
mkdir -p "$OUT"

trap 'scripts/e2e-server.sh stop' EXIT
scripts/e2e-server.sh start
BASE_URL="$BASE_URL" ADMIN_PASS="${ADMIN_PASS:-Admin@test1}" node tests/load/seed.js

# the server's peak resident memory, sampled while k6 runs
pid="$(cat "$E2E_DIR/server.pid")"
( peak=0
  while kill -0 "$pid" 2>/dev/null; do
    rss="$(ps -o rss= -p "$pid" | tr -d ' ')"
    [[ "${rss:-0}" -gt "$peak" ]] && peak="$rss" && echo $((peak / 1024)) > "$OUT/peak-rss-mb"
    sleep 1
  done ) &
sampler=$!

status=0
k6 run -e BASE_URL="$BASE_URL" --summary-export="$OUT/k6-summary.json" "$@" tests/load/browse.js || status=$?
kill "$sampler" 2>/dev/null || true
peak="$(cat "$OUT/peak-rss-mb" 2>/dev/null || echo 0)"

node tests/load/summary.js "$OUT/k6-summary.json" "$peak" "$MAX_RSS_MB" | tee "$OUT/summary.md"
[[ -n "${GITHUB_STEP_SUMMARY:-}" ]] && cat "$OUT/summary.md" >> "$GITHUB_STEP_SUMMARY"

if (( peak >= MAX_RSS_MB )); then
  echo "[load] the server used ${peak} MB, over the ${MAX_RSS_MB} MB ceiling" >&2
  status=1
fi
exit "$status"
