import { createRequire } from 'module';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';

// Sign-in security through the routes: two steps (password, code), Google's
// way back, the account's security page, the admin's actions. The real auth
// guard; the services stubbed.

vi.mock('fs', async () => {
  const actual = await vi.importActual('fs');
  return { ...actual, existsSync: vi.fn().mockReturnValue(false), mkdirSync: vi.fn(), readdirSync: vi.fn().mockReturnValue([]) };
});

const { app } = await import('../../../server.js');
const _require = createRequire(import.meta.url);
const database = _require('../../../services/database.js');
const auth     = _require('../../../services/auth.js');
const mfa      = _require('../../../services/mfa.js');
const google   = _require('../../../services/google-sso.js');

const TOKEN = 'd'.repeat(64);
let sessionUser;
const as = (req) => req.set('Cookie', `pb_session=${TOKEN}`);

beforeEach(() => {
  sessionUser = { id: 3, username: 'ana', role: 'basic', totp_enabled: false };
  database._reset();
  database._setState({ query: vi.fn(async (sql) => {
    if (sql.includes('FROM user_sessions')) return { rows: [sessionUser] };
    if (sql.startsWith('SELECT email, google_sub')) return { rows: [{ email: 'ana@example.org', google: true }] };
    return { rows: [], rowCount: 1 };
  }) }, true);
});
afterEach(() => { vi.restoreAllMocks(); auth._setMfaRequired(false); delete process.env.GOOGLE_CLIENT_ID; delete process.env.GOOGLE_CLIENT_SECRET; });

describe('connexion en deux étapes', () => {
  it('mot de passe avec 2FA : un ticket, pas de session ; puis le code : la session', async () => {
    vi.spyOn(auth, 'checkPassword').mockResolvedValue({ id: 3, username: 'ana', role: 'basic', totpEnabled: true });
    vi.spyOn(mfa, 'issueTicket').mockReturnValue('tkt');
    const step1 = await request(app).post('/api/auth/login').send({ username: 'ana', password: 'x' });
    expect(step1.body).toEqual({ mfa: true, ticket: 'tkt' });
    expect(step1.headers['set-cookie']).toBeUndefined();
    const redeem = vi.spyOn(mfa, 'redeemTicket').mockResolvedValueOnce(null).mockResolvedValueOnce({ userId: 3, via: 'password' });
    vi.spyOn(auth, 'createSession').mockResolvedValue('s'.repeat(64));
    expect((await request(app).post('/api/auth/login/code').send({ ticket: 'tkt', code: '000000' })).status).toBe(401);
    const ok = await request(app).post('/api/auth/login/code').send({ ticket: 'tkt', code: '123456' });
    expect(ok.status).toBe(200);
    expect(ok.headers['set-cookie'][0]).toContain('pb_session=' + 's'.repeat(64));
    expect(redeem).toHaveBeenLastCalledWith('tkt', '123456');
  });
});

describe('Google', () => {
  it('éteint sans configuration ; sinon redirige vers Google avec un cookie de vérification', async () => {
    expect((await request(app).get('/api/auth/providers')).body).toEqual({ google: false });
    expect((await request(app).get('/api/auth/google')).status).toBe(404);
    process.env.GOOGLE_CLIENT_ID = 'cid'; process.env.GOOGLE_CLIENT_SECRET = 'sec';
    expect((await request(app).get('/api/auth/providers')).body).toEqual({ google: true });
    const res = await request(app).get('/api/auth/google');
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^https:\/\/accounts\.google\.com\//);
    expect(res.headers['set-cookie'][0]).toMatch(/^pb_oidc=.*HttpOnly.*SameSite=Lax/);
  });

  it('retour : compte inconnu, compte avec 2FA (le code ensuite), compte sans (connecté)', async () => {
    process.env.GOOGLE_CLIENT_ID = 'cid'; process.env.GOOGLE_CLIENT_SECRET = 'sec';
    const finish = vi.spyOn(google, 'finish').mockResolvedValue({ sub: '42', email: 'ana@example.org' });
    const account = vi.spyOn(google, 'accountFor').mockResolvedValueOnce(null);
    const cb = () => request(app).get('/api/auth/google/callback?code=c&state=s').set('Cookie', 'pb_oidc=' + encodeURIComponent(JSON.stringify({ state: 's' })));
    expect((await cb()).headers.location).toBe('/login.html?sso=unknown');
    account.mockResolvedValue(3);
    vi.spyOn(mfa, 'status').mockResolvedValueOnce({ enabled: true, backupLeft: 3 });
    vi.spyOn(mfa, 'issueTicket').mockReturnValue('tkt');
    expect((await cb()).headers.location).toBe('/login.html?mfa=tkt');
    mfa.status.mockResolvedValueOnce({ enabled: false, backupLeft: 0 });
    vi.spyOn(auth, 'createSession').mockResolvedValue('s'.repeat(64));
    const done = await cb();
    expect(done.headers.location).toBe('/');
    expect(done.headers['set-cookie'].join(';')).toContain('pb_session=');
    finish.mockRejectedValueOnce(new Error('state mismatch'));
    expect((await cb()).headers.location).toBe('/login.html?sso=error');
    expect((await request(app).get('/api/auth/google/callback?error=access_denied')).headers.location).toBe('/login.html?sso=error');
  });
});

describe('Mon compte : sécurité', () => {
  it('état, configuration, activation, nouveaux codes, désactivation', async () => {
    vi.spyOn(mfa, 'status').mockResolvedValue({ enabled: false, backupLeft: 0 });
    expect((await as(request(app).get('/api/me/security'))).body).toEqual({
      twoFactor: { enabled: false, backupLeft: 0, required: false }, email: 'ana@example.org', google: true });
    vi.spyOn(mfa, 'setup').mockResolvedValue({ secret: 'S', uri: 'otpauth://x', qrSvg: '<svg/>' });
    expect((await as(request(app).post('/api/me/2fa/setup'))).body.qrSvg).toBe('<svg/>');
    vi.spyOn(mfa, 'enable').mockResolvedValue(['aaaa-bbbb']);
    expect((await as(request(app).post('/api/me/2fa/enable')).send({ code: '1' })).body).toEqual({ backupCodes: ['aaaa-bbbb'] });
    vi.spyOn(mfa, 'verify').mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    vi.spyOn(mfa, 'regenerateBackup').mockResolvedValue(['cccc-dddd']);
    expect((await as(request(app).post('/api/me/2fa/backup-codes')).send({ code: 'x' })).status).toBe(403);
    expect((await as(request(app).post('/api/me/2fa/backup-codes')).send({ code: 'y' })).body.backupCodes).toEqual(['cccc-dddd']);
    vi.spyOn(auth, 'checkPassword').mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 3 });
    const off = vi.spyOn(mfa, 'disable').mockResolvedValue(undefined);
    expect((await as(request(app).post('/api/me/2fa/disable')).send({ password: 'no' })).status).toBe(403);
    expect((await as(request(app).post('/api/me/2fa/disable')).send({ password: 'yes' })).status).toBe(200);
    expect(off).toHaveBeenCalledWith(3);
    expect((await as(request(app).delete('/api/me/google'))).status).toBe(200);
  });

  it('un admin là où elle est obligatoire : il ne la désactive pas, et l’administration attend', async () => {
    auth._setMfaRequired(true);
    sessionUser = { id: 1, username: 'admin', role: 'admin', totp_enabled: false };
    expect((await as(request(app).post('/api/me/2fa/disable')).send({ password: 'x' })).status).toBe(403);
    const me = await as(request(app).get('/api/auth/me'));
    expect(me.body.user).toEqual({ username: 'admin', role: 'admin', mfaSetup: true });
    const users = await as(request(app).get('/api/admin/users'));
    expect(users.status).toBe(403);
    expect(users.body.code).toBe('mfa_setup');
  });
});

describe('admin : e-mail, 2FA perdue, déblocage', () => {
  beforeEach(() => { sessionUser = { id: 1, username: 'admin', role: 'admin', totp_enabled: true }; });

  it('e-mail invalide 400 ; une nouvelle adresse délie Google ; réinitialiser, débloquer', async () => {
    expect((await as(request(app).post('/api/admin/users')).send({ username: 'bo', password: 'Valid1@pass', role: 'basic', email: 'nope' })).status).toBe(400);
    database._setState({ query: vi.fn(async (sql) => {
      if (sql.includes('FROM user_sessions')) return { rows: [sessionUser] };
      if (sql.startsWith('SELECT username FROM users')) return { rows: [{ username: 'bo' }] };
      return { rows: [], rowCount: 1 };
    }) }, true);
    const q = database.db.query;
    expect((await as(request(app).patch('/api/admin/users/5')).send({ email: 'bad' })).status).toBe(400);
    expect((await as(request(app).patch('/api/admin/users/5')).send({ email: 'bo@example.org', resetMfa: true, unlock: true })).status).toBe(200);
    const update = q.mock.calls.find((c) => c[0].startsWith('UPDATE users SET'))[0];
    expect(update).toContain('google_sub = NULL');
    expect(update).toContain('totp_secret = NULL');
    expect(update).toContain('locked_until = NULL');
  });
});
