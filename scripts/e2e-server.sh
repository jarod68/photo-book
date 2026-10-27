#!/usr/bin/env bash
# Start photo-book for the end-to-end tests (Robot, Playwright) — no Docker:
# builds the app, starts dist/server.js against an existing PostgreSQL with an
# empty photo library, sets the admin password and creates the basic test
# user. Needs only Node (no curl / Python: it also runs in Playwright's image).
# Used by CI and locally.
#
#   POSTGRES_HOST / POSTGRES_PORT / POSTGRES_DB / POSTGRES_USER / POSTGRES_PASSWORD
#       an empty database (default: localhost:5432, photobook / photobook / photobook)
#   PORT (3000)  E2E_DIR (temporary)  SKIP_BUILD=1 reuses dist/
#
# Usage:  scripts/e2e-server.sh start   → prints the log path; the PID is in $E2E_DIR/server.pid
#         scripts/e2e-server.sh stop
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export PORT="${PORT:-3000}"
export POSTGRES_HOST="${POSTGRES_HOST:-localhost}"
export POSTGRES_PORT="${POSTGRES_PORT:-5432}"
export POSTGRES_DB="${POSTGRES_DB:-photobook}"
export POSTGRES_USER="${POSTGRES_USER:-photobook}"
export POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-photobook}"
E2E_DIR="${E2E_DIR:-${RUNNER_TEMP:-/tmp}/photo-book-e2e}"
BASE_URL="http://localhost:${PORT}"

ADMIN_PASS="${ADMIN_PASS:-Admin@test1}"
BASIC_USER="${BASIC_USER:-robot-basic}"
BASIC_PASS="${BASIC_PASS:-Robot@basic1}"

stop() {
  if [[ -f "$E2E_DIR/server.pid" ]]; then
    local pid; pid="$(cat "$E2E_DIR/server.pid")"
    kill "$pid" 2>/dev/null || true
    for _ in $(seq 1 20); do kill -0 "$pid" 2>/dev/null || break; sleep 0.5; done
    rm -f "$E2E_DIR/server.pid"
  fi
}

start() {
  stop
  rm -rf "$E2E_DIR/photos" "$E2E_DIR/previews" "$E2E_DIR/medium"
  mkdir -p "$E2E_DIR/photos" "$E2E_DIR/previews" "$E2E_DIR/medium"
  [[ "${SKIP_BUILD:-}" == 1 ]] || npm run build >/dev/null

  # another server on the port would answer the health check in our place
  if node -e "fetch('$BASE_URL/api/health').then(() => process.exit(0), () => process.exit(1))"; then
    echo "[e2e] Port ${PORT} is already in use." >&2; exit 1
  fi

  echo "[e2e] Starting the app on $BASE_URL (log: $E2E_DIR/server.log)…"
  # exec: the recorded PID is node's own, so `stop` stops the server
  (cd dist && NODE_ENV=test PLACES_BACKGROUND=off \
     PHOTOS_DIR="$E2E_DIR/photos" PREVIEWS_DIR="$E2E_DIR/previews" MEDIUM_DIR="$E2E_DIR/medium" \
     exec node server.js > "$E2E_DIR/server.log" 2>&1) &
  echo $! > "$E2E_DIR/server.pid"

  for i in $(seq 1 60); do
    node -e "fetch('$BASE_URL/api/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))" && break
    if [[ "$i" -eq 60 ]]; then echo "[e2e] The app did not start:" >&2; cat "$E2E_DIR/server.log" >&2; exit 1; fi
    sleep 1
  done
  # ensureAdmin runs right after the database connects
  for i in $(seq 1 20); do grep -q 'Admin user\|Password:' "$E2E_DIR/server.log" && break; sleep 0.5; done

  echo "[e2e] Setting the admin password…"
  ADMIN_PASS="$ADMIN_PASS" node -e "
    const b = require('bcryptjs'); const { Pool } = require('pg');
    const p = new Pool({ host: process.env.POSTGRES_HOST, port: +process.env.POSTGRES_PORT, database: process.env.POSTGRES_DB,
                         user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD });
    b.hash(process.env.ADMIN_PASS, 12)
      .then(h => p.query(\"UPDATE users SET password_hash = \$1 WHERE username = 'admin'\", [h]))
      .then(r => { if (r.rowCount !== 1) throw new Error('no admin user'); return p.end(); })
      .catch(e => { console.error(e.message); process.exit(1); });"

  echo "[e2e] Creating the basic test user…"
  BASE_URL="$BASE_URL" ADMIN_PASS="$ADMIN_PASS" BASIC_USER="$BASIC_USER" BASIC_PASS="$BASIC_PASS" node -e "
    const { BASE_URL, ADMIN_PASS, BASIC_USER, BASIC_PASS } = process.env;
    const json = (body, extra = {}) => ({ method: 'POST', headers: { 'Content-Type': 'application/json', ...extra }, body: JSON.stringify(body) });
    (async () => {
      const login = await fetch(BASE_URL + '/api/auth/login', json({ username: 'admin', password: ADMIN_PASS }));
      if (!login.ok) throw new Error('admin login: HTTP ' + login.status);
      const cookie = login.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
      const r = await fetch(BASE_URL + '/api/admin/users', json({ username: BASIC_USER, password: BASIC_PASS, role: 'basic' }, { Cookie: cookie }));
      if (r.status !== 201 && r.status !== 409) throw new Error('creating ' + BASIC_USER + ': HTTP ' + r.status);
    })().catch(e => { console.error('[e2e] ' + e.message); process.exit(1); });"

  echo "[e2e] Ready: $BASE_URL — admin / ${ADMIN_PASS}, ${BASIC_USER} / ${BASIC_PASS}"
}

case "${1:-start}" in
  start) start ;;
  stop)  stop ;;
  *) echo "Usage: $0 start|stop" >&2; exit 2 ;;
esac
