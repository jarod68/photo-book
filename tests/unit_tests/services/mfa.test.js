import { createRequire } from 'module';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const _require = createRequire(import.meta.url);
const database = _require('../../../services/database.js');
const mfa      = _require('../../../services/mfa.js');
const google   = _require('../../../services/google-sso.js');

// a user row kept in memory, as the queries of mfa.js change it
let row;
function fakeDb() {
  return vi.fn(async (sql, p) => {
    if (sql.startsWith('SELECT username, totp_secret')) return { rows: row ? [row] : [] };
    if (sql.startsWith('UPDATE users SET totp_pending')) { row.totp_pending = p[1]; return { rowCount: 1 }; }
    if (sql.startsWith('UPDATE users SET totp_secret = totp_pending')) { Object.assign(row, { totp_secret: row.totp_pending, totp_pending: null, totp_last_step: p[1], totp_backup: p[2] }); return { rowCount: 1 }; }
    if (sql.startsWith('UPDATE users SET totp_last_step')) { row.totp_last_step = p[1]; return { rowCount: 1 }; }
    if (sql.startsWith('UPDATE users SET totp_backup = array_remove')) { row.totp_backup = row.totp_backup.filter((h) => h !== p[1]); return { rowCount: 1 }; }
    if (sql.startsWith('UPDATE users SET totp_backup')) { row.totp_backup = p[1]; return { rowCount: 1 }; }
    if (sql.startsWith('UPDATE users SET totp_secret = NULL')) { Object.assign(row, { totp_secret: null, totp_backup: null }); return { rowCount: 1 }; }
    throw new Error(`unexpected: ${sql}`);
  });
}

describe('TOTP (RFC 6238)', () => {
  it('les vecteurs de référence de la RFC (SHA-1, 6 derniers chiffres)', () => {
    const secret = mfa.base32Encode(Buffer.from('12345678901234567890'));
    expect(mfa.hotp(secret, mfa.stepOf(59_000))).toBe('287082');
    expect(mfa.hotp(secret, mfa.stepOf(1111111109_000))).toBe('081804');
    expect(mfa.hotp(secret, mfa.stepOf(2000000000_000))).toBe('279037');
    expect(mfa.base32Decode(secret).toString()).toBe('12345678901234567890');
  });

  it('un pas d’avance ou de retard accepté, pas deux ; un code mal formé jamais', () => {
    const s = mfa.newSecret();
    const now = Date.now(), step = mfa.stepOf(now);
    expect(mfa.matchStep(s, mfa.hotp(s, step - 1), now)).toBe(step - 1);
    expect(mfa.matchStep(s, mfa.hotp(s, step + 1), now)).toBe(step + 1);
    expect(mfa.matchStep(s, mfa.hotp(s, step + 2), now)).toBeNull();
    expect(mfa.matchStep(s, '12a456', now)).toBeNull();
    expect(mfa.matchStep(s, null, now)).toBeNull();
  });
});

describe('2FA d’un compte', () => {
  beforeEach(() => { row = { username: 'ana', totp_secret: null, totp_pending: null, totp_last_step: null, totp_backup: null }; database._setState({ query: fakeDb() }, true); mfa._resetTickets(); });

  it('configuration : QR code, activation par un premier code, 10 codes de secours', async () => {
    const s = await mfa.setup(3);
    expect(s.qrSvg).toMatch(/^<svg/);
    expect(s.uri).toContain(`secret=${s.secret}`);
    await expect(mfa.enable(3, '000000')).rejects.toMatchObject({ status: 403 });
    const codes = await mfa.enable(3, mfa.hotp(s.secret, mfa.stepOf(Date.now())));
    expect(codes).toHaveLength(10);
    expect(codes[0]).toMatch(/^[a-z2-7]{4}-[a-z2-7]{4}$/);
    expect(await mfa.status(3)).toEqual({ enabled: true, backupLeft: 10 });
    await expect(mfa.enable(3, '123456')).rejects.toMatchObject({ status: 400 });   // nothing pending
  });

  it('un code de l’appli sert une fois ; un code de secours aussi', async () => {
    const s = await mfa.setup(3);
    const codes = await mfa.enable(3, mfa.hotp(s.secret, mfa.stepOf(Date.now()) - 1));
    const now = mfa.hotp(s.secret, mfa.stepOf(Date.now()));
    expect(await mfa.verify(3, now)).toBe(true);
    expect(await mfa.verify(3, now)).toBe(false);          // replayed
    expect(await mfa.verify(3, codes[2].toUpperCase())).toBe(true);
    expect(await mfa.verify(3, codes[2])).toBe(false);     // used up
    expect((await mfa.status(3)).backupLeft).toBe(9);
    const fresh = await mfa.regenerateBackup(3);
    expect(await mfa.verify(3, codes[3])).toBe(false);     // the old ones no longer work
    expect(await mfa.verify(3, fresh[0])).toBe(true);
    await mfa.disable(3);
    expect(await mfa.verify(3, fresh[1])).toBe(false);
  });

  it('le ticket entre le mot de passe et le code : 5 essais, une seule fois', async () => {
    const s = await mfa.setup(3);
    await mfa.enable(3, mfa.hotp(s.secret, mfa.stepOf(Date.now()) - 1));
    const t = mfa.issueTicket(3, 'password');
    for (let i = 0; i < 4; i++) expect(await mfa.redeemTicket(t, '000000')).toBeNull();
    expect(await mfa.redeemTicket(t, mfa.hotp(s.secret, mfa.stepOf(Date.now())))).toMatchObject({ userId: 3, via: 'password' });
    expect(await mfa.redeemTicket(t, mfa.hotp(s.secret, mfa.stepOf(Date.now()) + 1))).toBeNull();   // spent
    const t2 = mfa.issueTicket(3, 'google');
    for (let i = 0; i < 5; i++) await mfa.redeemTicket(t2, '000000');
    expect(await mfa.redeemTicket(t2, mfa.hotp(s.secret, mfa.stepOf(Date.now()) + 1))).toBeNull();   // 5 tries: gone
    expect(await mfa.redeemTicket('nope', '123456')).toBeNull();
  });
});

describe('connexion avec Google', () => {
  const claims = (o = {}) => Buffer.from(JSON.stringify({ iss: 'https://accounts.google.com', aud: 'cid', exp: Date.now() / 1000 + 60, nonce: 'n', sub: '42', email: 'ana@example.org', email_verified: true, ...o })).toString('base64url');
  const token = (o) => ({ ok: true, json: async () => ({ id_token: `h.${claims(o)}.s` }) });
  const remembered = { state: 's', nonce: 'n', verifier: 'v' };

  beforeEach(() => { process.env.GOOGLE_CLIENT_ID = 'cid'; process.env.GOOGLE_CLIENT_SECRET = 'sec'; });

  it('l’adresse de Google : state, nonce et PKCE', () => {
    expect(google.enabled()).toBe(true);
    const { url, remember } = google.start('https://book.holtz.fr');
    const q = new URL(url).searchParams;
    expect(q.get('redirect_uri')).toBe('https://book.holtz.fr/api/auth/google/callback');
    expect(q.get('state')).toBe(remember.state);
    expect(q.get('nonce')).toBe(remember.nonce);
    expect(q.get('code_challenge_method')).toBe('S256');
    delete process.env.GOOGLE_CLIENT_SECRET;
    expect(google.enabled()).toBe(false);
  });

  it('la réponse : vérifiée (state, émetteur, audience, expiration, nonce, e-mail vérifié)', async () => {
    const f = vi.fn().mockResolvedValue(token());
    expect(await google.finish('https://x', { code: 'c', state: 's' }, remembered, f)).toEqual({ sub: '42', email: 'ana@example.org' });
    expect(f.mock.calls[0][1].body.get('code_verifier')).toBe('v');
    await expect(google.finish('https://x', { code: 'c', state: 'other' }, remembered, f)).rejects.toThrow('state');
    for (const bad of [{ iss: 'https://evil' }, { aud: 'other' }, { exp: 1 }, { nonce: 'x' }, { email_verified: false }]) {
      await expect(google.finish('https://x', { code: 'c', state: 's' }, remembered, vi.fn().mockResolvedValue(token(bad)))).rejects.toThrow();
    }
    await expect(google.finish('https://x', { code: 'c', state: 's' }, remembered, vi.fn().mockResolvedValue({ ok: false, status: 400 }))).rejects.toThrow('HTTP 400');
  });

  it('le compte : déjà lié, sinon celui de cette adresse (lié désormais), sinon aucun', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ id: 5 }] });
    database._setState({ query }, true);
    expect(await google.accountFor({ sub: '42', email: 'a@b.c' })).toBe(5);
    query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ id: 6 }] });
    expect(await google.accountFor({ sub: '43', email: 'A@b.c' })).toBe(6);
    expect(query.mock.calls[2][0]).toMatch(/lower\(email\) = lower\(\$1\) AND google_sub IS NULL/);
    query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });
    expect(await google.accountFor({ sub: '44', email: 'x@y.z' })).toBeNull();
  });
});
