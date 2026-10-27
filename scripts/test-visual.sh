#!/usr/bin/env bash
# Run the Playwright visual tests against a local build — same setup as CI.
# Needs an empty PostgreSQL database (POSTGRES_* variables, see e2e-server.sh).
# The baselines are made in CI's Linux image (Actions → "Update visual
# baselines"): on another OS, fonts render differently and screenshots differ.
# Usage: scripts/test-visual.sh [playwright options]
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

trap 'scripts/e2e-server.sh stop' EXIT
scripts/e2e-server.sh start

BASE_URL="http://localhost:${PORT:-3000}" ADMIN_PASS="${ADMIN_PASS:-Admin@test1}" npx playwright test "$@"
