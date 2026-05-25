#!/usr/bin/env bash
# Run Robot Framework tests against a local Docker stack.
# Usage: ./scripts/test-robot.sh [--no-teardown]
#
# Starts the app via deploy-local.sh, resets the admin password to a known
# test value, creates a basic test user, runs all Robot suites, tears down.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

NO_TEARDOWN=false
[[ "${1:-}" == "--no-teardown" ]] && NO_TEARDOWN=true

ADMIN_USER="admin"
ADMIN_PASS="Admin@test1"
BASIC_USER="robot-basic"
BASIC_PASS="Robot@basic1"
APP_CONTAINER="photo-book-photo-book-1"

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

# Reset admin password to a fixed known value using bcryptjs+pg inside container
# (node_modules/ has bcryptjs and pg as production deps — always present in image)
echo "[robot] Resetting admin password..."
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
" || { echo "[robot] ERROR: password reset failed." >&2; exit 1; }
echo "[robot] Admin password set."

# Login as admin to get a session cookie for user setup
COOKIE_JAR=$(mktemp)
LOGIN_STATUS=$(curl -sf -c "$COOKIE_JAR" -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"${ADMIN_USER}\",\"password\":\"${ADMIN_PASS}\"}" \
  -w "%{http_code}" -o /dev/null)

if [[ "$LOGIN_STATUS" != "200" ]]; then
  echo "[robot] ERROR: admin login failed (HTTP $LOGIN_STATUS)." >&2
  exit 1
fi

# Remove stale basic test user if present
STALE_ID=$(curl -sf -b "$COOKIE_JAR" http://localhost:3000/api/admin/users | \
  python3 -c "
import sys, json
data = json.load(sys.stdin)
for u in data.get('users', []):
    if u['username'] == '${BASIC_USER}':
        print(u['id']); break
")
if [[ -n "$STALE_ID" ]]; then
  curl -sf -b "$COOKIE_JAR" -X DELETE \
    "http://localhost:3000/api/admin/users/${STALE_ID}" > /dev/null
  echo "[robot] Removed stale test user (id=${STALE_ID})."
fi

# Create basic test user
CREATE_STATUS=$(curl -sf -b "$COOKIE_JAR" -X POST http://localhost:3000/api/admin/users \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"${BASIC_USER}\",\"password\":\"${BASIC_PASS}\",\"role\":\"basic\"}" \
  -w "%{http_code}" -o /dev/null)

if [[ "$CREATE_STATUS" == "201" ]]; then
  echo "[robot] Basic test user '${BASIC_USER}' created."
else
  echo "[robot] WARNING: basic user creation returned HTTP ${CREATE_STATUS}." >&2
fi

# Generate test fixture images (pure Python, no external deps)
echo "[robot] Generating test fixture images..."
python3 tests/integration_tests/fixtures/generate.py

echo "[robot] Running test suites..."
robot \
  --outputdir tests/integration_tests/results \
  --variable ADMIN_PASS:"${ADMIN_PASS}" \
  --variable BASIC_USER:"${BASIC_USER}" \
  --variable BASIC_PASS:"${BASIC_PASS}" \
  tests/integration_tests/suites/
