'use strict';
const database = require('./database.js');

async function log(action, { username = null, ip = null, details = {} } = {}) {
  if (!database.dbReady) return;
  try {
    await database.db.query(
      'INSERT INTO activity_log (action, username, ip, details) VALUES ($1, $2, $3, $4)',
      [action, username || null, ip || null, JSON.stringify(details)],
    );
    await database.db.query(
      'DELETE FROM activity_log WHERE id NOT IN (SELECT id FROM activity_log ORDER BY created_at DESC LIMIT 5000)',
    );
  } catch (err) { console.error('Activity log failed:', err.message); }
}

module.exports = { log };
