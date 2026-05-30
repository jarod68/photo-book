#!/usr/bin/env bash
# Run Playwright visual regression tests against a local Docker stack.
# Usage: ./scripts/test-visual.sh [--update-snapshots]
#
# Starts the app via deploy-local.sh, runs all Playwright specs, tears down.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

UPDATE_SNAPSHOTS=false
[[ "${1:-}" == "--update-snapshots" ]] && UPDATE_SNAPSHOTS=true

APP_CONTAINER="photo-book-photo-book-1"
ADMIN_USER="admin"
ADMIN_PASS="Admin@test1"

teardown() {
  echo "[visual] Stopping containers..."
  ./deploy-local.sh down
}
trap teardown EXIT

echo "[visual] Cleaning up any stale containers..."
./deploy-local.sh down 2>/dev/null || true

echo "[visual] Building and starting containers..."
./deploy-local.sh up -d

echo "[visual] Waiting for http://localhost:3000 ..."
for i in $(seq 1 30); do
  if curl -sf http://localhost:3000 > /dev/null 2>&1; then
    echo "[visual] Server ready (${i}s)."
    break
  fi
  if [[ "$i" -eq 30 ]]; then
    echo "[visual] ERROR: server did not become ready in 60s." >&2
    exit 1
  fi
  sleep 2
done

echo "[visual] Resetting admin password..."
docker exec "$APP_CONTAINER" node -e "
const b = require('bcryptjs');
const { Pool } = require('pg');
const p = new Pool({
  host: process.env.POSTGRES_HOST,
  database: process.env.POSTGRES_DB || 'photobook',
  user: process.env.POSTGRES_USER || 'photobook',
  password: process.env.POSTGRES_PASSWORD,
});
b.hash('${ADMIN_PASS}', 12)
  .then(h => p.query('UPDATE users SET password_hash=\$1 WHERE username=\$2', [h, '${ADMIN_USER}']))
  .then(() => { console.log('ok'); p.end(); process.exit(0); })
  .catch(e => { console.error(e.message); process.exit(1); });
" || { echo "[visual] ERROR: password reset failed." >&2; exit 1; }
echo "[visual] Admin password set."

echo "[visual] Running Playwright tests..."
if [[ "$UPDATE_SNAPSHOTS" == true ]]; then
  ADMIN_PASS="${ADMIN_PASS}" npx playwright test --update-snapshots
else
  ADMIN_PASS="${ADMIN_PASS}" npx playwright test
fi
