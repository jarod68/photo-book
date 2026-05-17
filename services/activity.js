'use strict';
const database = require('./database.js');

/**
 * Inserts an activity log entry.
 * Purging excess rows is handled at startup via purgeActivityLog(), not here.
 *
 * @param {string} action
 * @param {{ username?: string|null, ip?: string|null, details?: object }} opts
 */
async function log(action, { username = null, ip = null, details = {} } = {}) {
  if (!database.dbReady) return;
  try {
    await database.db.query(
      'INSERT INTO activity_log (action, username, ip, details) VALUES ($1, $2, $3, $4)',
      [action, username || null, ip || null, JSON.stringify(details)],
    );
  } catch (err) { console.error('Activity log failed:', err.message); }
}

/**
 * Purges old activity_log rows when the count exceeds 5000.
 * Called once at server startup after the DB connection is established.
 */
async function purgeActivityLog() {
  if (!database.dbReady) return;
  try {
    const { rows } = await database.db.query('SELECT COUNT(*) AS cnt FROM activity_log');
    const count = parseInt(rows[0].cnt, 10);
    if (count > 5000) {
      await database.db.query(
        'DELETE FROM activity_log WHERE id NOT IN (SELECT id FROM activity_log ORDER BY created_at DESC LIMIT 5000)',
      );
      console.log(`  ✓ Activity log purged (${count} → 5000 entries).`);
    }
  } catch (err) { console.error('Activity log purge failed:', err.message); }
}

module.exports = { log, purgeActivityLog };
