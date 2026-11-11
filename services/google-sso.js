// @ts-check
'use strict';
// "Sign in with Google" (OpenID Connect, authorization code + PKCE). Off
// unless GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set. No sign-up: a
// Google account opens the account whose e-mail the admin set to its
// address (verified by Google), and stays linked to it (google_sub).
const crypto   = require('crypto');
const database = require('./database');

const AUTH_URL  = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const ISSUERS   = ['https://accounts.google.com', 'accounts.google.com'];

const config = () => ({ id: process.env.GOOGLE_CLIENT_ID ?? '', secret: process.env.GOOGLE_CLIENT_SECRET ?? '' });
const enabled = () => !!(config().id && config().secret);

const b64url = (buf) => buf.toString('base64url');

/** Where Google sends the user back: this site's own address. */
const redirectUri = (origin) => `${origin}/api/auth/google/callback`;

/**
 * The address to send the browser to, and what to remember (in a cookie)
 * to check the answer: state, nonce, PKCE verifier.
 */
function start(origin) {
  const state = b64url(crypto.randomBytes(18));
  const nonce = b64url(crypto.randomBytes(18));
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const q = new URLSearchParams({
    client_id: config().id, redirect_uri: redirectUri(origin), response_type: 'code',
    scope: 'openid email', state, nonce, code_challenge: challenge, code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  return { url: `${AUTH_URL}?${q}`, remember: { state, nonce, verifier } };
}

/**
 * The ID token's claims after the code exchange, checked: issuer, audience,
 * expiry, nonce, a verified e-mail. The token comes straight from Google's
 * token endpoint over TLS (OpenID Connect Core 3.1.3.7: its signature need
 * not be checked then).
 */
async function finish(origin, { code, state }, remembered, _fetch = fetch) {
  if (!remembered || !state || state !== remembered.state) throw new Error('state mismatch');
  const r = await _fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: String(code ?? ''), client_id: config().id, client_secret: config().secret,
      redirect_uri: redirectUri(origin), grant_type: 'authorization_code', code_verifier: remembered.verifier,
    }),
  });
  if (!r.ok) throw new Error(`token endpoint: HTTP ${r.status}`);
  const { id_token: idToken } = await r.json();
  const claims = JSON.parse(Buffer.from(String(idToken).split('.')[1] ?? '', 'base64url').toString('utf8'));
  if (!ISSUERS.includes(claims.iss)) throw new Error('bad issuer');
  if (claims.aud !== config().id) throw new Error('bad audience');
  if (!(claims.exp * 1000 > Date.now())) throw new Error('expired');
  if (claims.nonce !== remembered.nonce) throw new Error('nonce mismatch');
  if (!claims.email || claims.email_verified !== true) throw new Error('e-mail not verified');
  return { sub: String(claims.sub), email: String(claims.email) };
}

/**
 * The account for this Google identity: already linked, else the one whose
 * e-mail is the Google address (linked from now on). Null: none.
 */
async function accountFor({ sub, email }) {
  const { rows: linked } = await database.db.query('SELECT id FROM users WHERE google_sub = $1', [sub]);
  if (linked[0]) return linked[0].id;
  const { rows } = await database.db.query(
    'UPDATE users SET google_sub = $2 WHERE lower(email) = lower($1) AND google_sub IS NULL RETURNING id', [email, sub]);
  return rows[0]?.id ?? null;
}

module.exports = { enabled, start, finish, accountFor, redirectUri };
