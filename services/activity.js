'use strict';
const database = require('./database.js');

async function log(action, { username = null, ip = null, details = {} } = {}) {
  if (!database.dbReady) return;
  try {
    await database.db.query(
      'INSERT INTO activity_log (action, username, ip, details) VALUES ($1, $2, $3, $4)',
      [action, username || null, ip || null, JSON.stringify(details)],
    );
  } catch (_) {}
}

module.exports = { log };
