#!/usr/bin/env bash
# Run the Robot Framework suites against a local build — same setup as CI.
# Needs an empty PostgreSQL database (POSTGRES_* variables, see e2e-server.sh)
# and `pip install -r requirements-robot.txt && rfbrowser init chromium`.
# Usage: scripts/test-robot.sh [robot options / suite paths]
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

trap 'scripts/e2e-server.sh stop' EXIT
scripts/e2e-server.sh start

robot --outputdir tests/integration_tests/results \
  --variable BASE_URL:"http://localhost:${PORT:-3000}" \
  --variable ADMIN_PASS:"${ADMIN_PASS:-Admin@test1}" \
  --variable BASIC_USER:"${BASIC_USER:-robot-basic}" \
  --variable BASIC_PASS:"${BASIC_PASS:-Robot@basic1}" \
  "${@:-tests/integration_tests/suites/}"
