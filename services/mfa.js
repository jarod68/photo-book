// @ts-check
'use strict';
// Two-factor sign-in with an authenticator app (TOTP, RFC 6238: HMAC-SHA1,
// 30-second steps, 6 digits — Google Authenticator, Authy, 1Password…),
// backup codes, and the short-lived ticket between the password and the code.
const crypto   = require('crypto');
const QRCode   = require('qrcode');
const database = require('./database');
const { BadRequest } = require('./http-errors');

const ISSUER = 'Photo Book';
const STEP_S = 30;
const DIGITS = 6;
const WINDOW = 1;            // one step either side: a clock a little off
const BACKUP_CODES = 10;
const TICKET_MS = 5 * 60_000;
const TICKET_TRIES = 5;

// ── RFC 4648 base32 (what authenticator apps read) ───────────────────────────
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
function base32Decode(str) {
  let bits = 0, value = 0;
  const out = [];
  for (const c of str.replace(/=+$/, '').toUpperCase()) {
    const i = B32.indexOf(c);
    if (i < 0) throw new Error('Invalid base32');
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

/** The code of one time step (RFC 4226 HOTP). */
function hotp(secret, counter) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', base32Decode(secret)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 10 ** DIGITS).padStart(DIGITS, '0');
}

const stepOf = (ms) => Math.floor(ms / 1000 / STEP_S);

/** The time step a code matches (± WINDOW), or null. Constant-time comparison. */
function matchStep(secret, code, now = Date.now()) {
  const c = String(code ?? '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return null;
  const s = stepOf(now);
  for (let d = -WINDOW; d <= WINDOW; d++) {
    if (crypto.timingSafeEqual(Buffer.from(hotp(secret, s + d)), Buffer.from(c))) return s + d;
  }
  return null;
}

const newSecret = () => base32Encode(crypto.randomBytes(20));
const hashCode = (code) => crypto.createHash('sha256').update(String(code).toLowerCase().replace(/[^a-z0-9]/g, '')).digest('hex');
const newBackupCodes = () => Array.from({ length: BACKUP_CODES }, () => {
  const s = base32Encode(crypto.randomBytes(5)).toLowerCase();
  return `${s.slice(0, 4)}-${s.slice(4, 8)}`;
});

// ── Per user ─────────────────────────────────────────────────────────────────

async function stateOf(userId) {
  const { rows } = await database.db.query(
    'SELECT username, totp_secret, totp_pending, totp_last_step, totp_backup FROM users WHERE id = $1', [userId]);
  return rows[0] ?? null;
}

/** { enabled, backupLeft } */
async function status(userId) {
  const s = await stateOf(userId);
  return { enabled: !!s?.totp_secret, backupLeft: s?.totp_backup?.length ?? 0 };
}

/** Start setting up: a new secret, shown as a QR code and as text. */
async function setup(userId) {
  const s = await stateOf(userId);
  if (!s) throw new BadRequest('No such user');
  const secret = newSecret();
  await database.db.query('UPDATE users SET totp_pending = $2 WHERE id = $1', [userId, secret]);
  const uri = `otpauth://totp/${encodeURIComponent(`${ISSUER}:${s.username}`)}?secret=${secret}&issuer=${encodeURIComponent(ISSUER)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_S}`;
  return { secret, uri, qrSvg: await QRCode.toString(uri, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }) };
}

/** Confirm the setup with a first code: enabled; the backup codes, shown once. */
async function enable(userId, code) {
  const s = await stateOf(userId);
  if (!s?.totp_pending) throw new BadRequest('Nothing being set up');
  const step = matchStep(s.totp_pending, code);
  if (step === null) throw Object.assign(new Error('Wrong code'), { status: 403 });
  const codes = newBackupCodes();
  await database.db.query(
    `UPDATE users SET totp_secret = totp_pending, totp_pending = NULL, totp_last_step = $2, totp_backup = $3 WHERE id = $1`,
    [userId, step, codes.map(hashCode)]);
  return codes;
}

/**
 * Check a code at sign-in (or to confirm a change): a code of the app — not
 * one already used — or a backup code (then used up).
 */
async function verify(userId, code) {
  const s = await stateOf(userId);
  if (!s?.totp_secret) return false;
  const step = matchStep(s.totp_secret, code);
  if (step !== null) {
    if (s.totp_last_step != null && step <= Number(s.totp_last_step)) return false;   // replayed
    await database.db.query('UPDATE users SET totp_last_step = $2 WHERE id = $1', [userId, step]);
    return true;
  }
  const h = hashCode(code);
  if (h.length && (s.totp_backup ?? []).includes(h)) {
    await database.db.query('UPDATE users SET totp_backup = array_remove(totp_backup, $2) WHERE id = $1', [userId, h]);
    return true;
  }
  return false;
}

async function disable(userId) {
  await database.db.query(
    'UPDATE users SET totp_secret = NULL, totp_pending = NULL, totp_last_step = NULL, totp_backup = NULL WHERE id = $1', [userId]);
}

async function regenerateBackup(userId) {
  const codes = newBackupCodes();
  await database.db.query('UPDATE users SET totp_backup = $2 WHERE id = $1', [userId, codes.map(hashCode)]);
  return codes;
}

// ── The ticket between the first factor (password, Google) and the code ─────
// In memory: one replica per instance; a restart only asks to sign in again.
const tickets = new Map();
function issueTicket(userId, via) {
  for (const [k, v] of tickets) if (v.exp < Date.now()) tickets.delete(k);
  const ticket = crypto.randomBytes(24).toString('hex');
  tickets.set(ticket, { userId, via, exp: Date.now() + TICKET_MS, tries: 0 });
  return ticket;
}
/** The ticket's user if `code` is right; null otherwise (5 tries, 5 minutes). */
async function redeemTicket(ticket, code) {
  const t = tickets.get(String(ticket));
  if (!t || t.exp < Date.now()) { tickets.delete(String(ticket)); return null; }
  if (await verify(t.userId, code)) { tickets.delete(String(ticket)); return t; }
  if (++t.tries >= TICKET_TRIES) tickets.delete(String(ticket));
  return null;
}
function _resetTickets() { tickets.clear(); }

module.exports = {
  base32Encode, base32Decode, hotp, matchStep, stepOf, newSecret, hashCode,
  status, setup, enable, verify, disable, regenerateBackup, issueTicket, redeemTicket, _resetTickets,
};
