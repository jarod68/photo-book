'use strict';
// Periodic database housekeeping (T4): run once at startup, then every few
// hours, so tables that only grow are trimmed without a restart.
//  - expired login sessions (they were only deleted on an explicit logout);
//  - share links that expired more than SHARE_GRACE_DAYS ago (the admin page
//    still lists recently expired links, so they are kept for a while);
//  - the activity log, capped at its newest rows.
const database = require('./database');
const activity = require('./activity');

const SHARE_GRACE_DAYS = 30;
const EVERY_MS = 6 * 60 * 60 * 1000;

async function purgeExpired() {
  if (!database.dbReady) return { sessions: 0, shares: 0 };
  const sessions = await database.db.query('DELETE FROM user_sessions WHERE expires_at < NOW()');
  const shares = await database.db.query(
    `DELETE FROM share_tokens WHERE expires_at < NOW() - make_interval(days => $1)`,
    [SHARE_GRACE_DAYS],
  );
  const out = { sessions: sessions.rowCount ?? 0, shares: shares.rowCount ?? 0 };
  if (out.sessions || out.shares) {
    console.log(`  ✓ Purged ${out.sessions} expired session(s), ${out.shares} expired share link(s).`);
  }
  return out;
}

async function runMaintenance() {
  await purgeExpired().catch((err) => console.error('Expired-row purge failed:', err.message));
  await activity.purgeActivityLog();
}

let timer = null;
function startMaintenance() {
  if (timer) return timer;
  runMaintenance();
  timer = setInterval(runMaintenance, EVERY_MS);
  timer.unref();   // never keeps the process alive on shutdown
  return timer;
}
function stopMaintenance() { clearInterval(timer); timer = null; }

module.exports = { purgeExpired, runMaintenance, startMaintenance, stopMaintenance, SHARE_GRACE_DAYS, EVERY_MS };
