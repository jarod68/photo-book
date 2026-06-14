'use strict';

const webpush = require('web-push');

let _db        = null;
let _publicKey = null;

async function initVapid(db) {
  _db = db;

  // Prefer explicit env vars
  const envPublic  = process.env.VAPID_PUBLIC_KEY;
  const envPrivate = process.env.VAPID_PRIVATE_KEY;
  const subject    = process.env.VAPID_SUBJECT || 'mailto:admin@photo-book.local';

  if (envPublic && envPrivate) {
    _publicKey = envPublic;
    webpush.setVapidDetails(subject, envPublic, envPrivate);
    return;
  }

  // Try loading from DB
  try {
    const { rows } = await db.query('SELECT public_key, private_key FROM push_vapid WHERE id = 1');
    if (rows.length > 0) {
      _publicKey = rows[0].public_key;
      webpush.setVapidDetails(subject, rows[0].public_key, rows[0].private_key);
      return;
    }

    // Generate new VAPID keys and persist them
    const keys = webpush.generateVAPIDKeys();
    await db.query(
      `INSERT INTO push_vapid (id, public_key, private_key) VALUES (1, $1, $2)
       ON CONFLICT (id) DO UPDATE SET public_key = $1, private_key = $2`,
      [keys.publicKey, keys.privateKey],
    );
    _publicKey = keys.publicKey;
    webpush.setVapidDetails(subject, keys.publicKey, keys.privateKey);
    console.log('  ✓ VAPID keys generated and stored.');
  } catch (err) {
    console.error('  ✗ Failed to init VAPID keys:', err.message);
  }
}

function getVapidPublicKey() {
  return _publicKey;
}

async function sendToAlbum(album, payload) {
  if (!_db) return 0;
  let rows;
  try {
    const result = await _db.query(
      'SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE album = $1',
      [album],
    );
    rows = result.rows;
  } catch (err) {
    console.error('  ✗ push.sendToAlbum query error:', err.message);
    return 0;
  }

  if (rows.length === 0) return 0;

  const body = JSON.stringify({ ...payload, album });
  let sent = 0;
  const invalid = [];

  await Promise.all(rows.map(async row => {
    const sub = {
      endpoint: row.endpoint,
      keys: { p256dh: row.p256dh, auth: row.auth },
    };
    try {
      await webpush.sendNotification(sub, body);
      sent++;
    } catch (err) {
      if (err.statusCode === 410 || err.statusCode === 404) {
        // Subscription no longer valid — remove it
        invalid.push(row.id);
      } else {
        console.error('  ✗ push send error:', err.message);
      }
    }
  }));

  if (invalid.length > 0) {
    try {
      await _db.query(
        `DELETE FROM push_subscriptions WHERE id = ANY($1::int[])`,
        [invalid],
      );
    } catch (err) {
      console.error('  ✗ push cleanup error:', err.message);
    }
  }

  return sent;
}

module.exports = { initVapid, getVapidPublicKey, sendToAlbum };
