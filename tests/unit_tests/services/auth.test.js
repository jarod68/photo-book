import { createRequire } from 'module';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Load auth.js — it requires database.js (same CJS cache).
// We inject a mock DB via database._setState() to control query results.
const auth     = await import('../../../services/auth.js');
const _require = createRequire(import.meta.url);
const database = _require('../../../services/database.js');
const bcrypt   = _require('bcryptjs');

const mockQuery = vi.fn();

beforeEach(() => {
  mockQuery.mockReset();
  database._reset();
  auth._setBypass(false);
});

afterEach(() => vi.restoreAllMocks());

// ── ensureAdmin ───────────────────────────────────────────────────────────────

describe('ensureAdmin', () => {
  it('ne fait rien si l\'admin existe déjà', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: 1 }] });
    database._setState({ query: mockQuery }, true);
    await auth.ensureAdmin();
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery.mock.calls[0][0]).toContain('SELECT id FROM users');
  });

  it('crée l\'admin avec un mot de passe haché si absent', async () => {
    vi.spyOn(bcrypt, 'hash').mockResolvedValue('$hashed');
    mockQuery
      .mockResolvedValueOnce({ rows: [] })  // SELECT → no admin
      .mockResolvedValueOnce({ rows: [] }); // INSERT
    database._setState({ query: mockQuery }, true);
    await auth.ensureAdmin();
    expect(mockQuery).toHaveBeenCalledTimes(2);
    const [insertSql, insertParams] = mockQuery.mock.calls[1];
    expect(insertSql).toContain('INSERT INTO users');
    expect(insertSql).toContain('admin');   // username hardcodé dans le SQL
    expect(insertParams).toContain('$hashed');
  });
});

// ── login ─────────────────────────────────────────────────────────────────────

describe('login', () => {
  it('retourne null si l\'utilisateur n\'existe pas', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    database._setState({ query: mockQuery }, true);
    const result = await auth.login('nobody', 'pass');
    expect(result).toBeNull();
  });

  it('retourne null si le mot de passe est incorrect', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: 1, password_hash: '$2a$12$hash' }] });
    vi.spyOn(bcrypt, 'compare').mockResolvedValue(false);
    database._setState({ query: mockQuery }, true);
    const result = await auth.login('admin', 'wrong');
    expect(result).toBeNull();
  });

  it('retourne un token hex 64 chars si les credentials sont corrects', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 1, password_hash: '$2a$12$hash' }] }) // SELECT user
      .mockResolvedValueOnce({ rows: [] }); // INSERT session
    vi.spyOn(bcrypt, 'compare').mockResolvedValue(true);
    database._setState({ query: mockQuery }, true);
    const token = await auth.login('admin', 'correct');
    expect(token).toBeTypeOf('string');
    expect(token).toHaveLength(64);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('insère la session avec la bonne expiration (30 jours)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 42, password_hash: '$hash' }] })
      .mockResolvedValueOnce({ rows: [] });
    vi.spyOn(bcrypt, 'compare').mockResolvedValue(true);
    database._setState({ query: mockQuery }, true);
    const before = Date.now();
    await auth.login('admin', 'pass');
    const [, userId, expiresAt] = mockQuery.mock.calls[1][1];
    expect(userId).toBe(42);
    const diff = expiresAt.getTime() - before;
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    expect(diff).toBeGreaterThanOrEqual(thirtyDays - 1000);
    expect(diff).toBeLessThanOrEqual(thirtyDays + 1000);
  });
});

// ── getSessionUser ────────────────────────────────────────────────────────────

describe('getSessionUser', () => {
  it('retourne null si le token est null', async () => {
    expect(await auth.getSessionUser(null)).toBeNull();
  });

  it('retourne null si le token est trop court (< 64 chars)', async () => {
    expect(await auth.getSessionUser('abc')).toBeNull();
  });

  it('retourne null si aucune session trouvée en DB', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    database._setState({ query: mockQuery }, true);
    expect(await auth.getSessionUser('a'.repeat(64))).toBeNull();
  });

  it('retourne l\'utilisateur si la session est valide', async () => {
    const user = { id: 1, username: 'admin', role: 'admin' };
    mockQuery.mockResolvedValue({ rows: [user] });
    database._setState({ query: mockQuery }, true);
    const result = await auth.getSessionUser('a'.repeat(64));
    expect(result).toEqual(user);
  });

  it('passe le token dans la requête SQL', async () => {
    const token = 'b'.repeat(64);
    mockQuery.mockResolvedValue({ rows: [] });
    database._setState({ query: mockQuery }, true);
    await auth.getSessionUser(token);
    expect(mockQuery.mock.calls[0][1]).toContain(token);
  });
});

// ── logout ────────────────────────────────────────────────────────────────────

describe('logout', () => {
  it('supprime le token de user_sessions', async () => {
    mockQuery.mockResolvedValue({ rowCount: 1 });
    database._setState({ query: mockQuery }, true);
    await auth.logout('mytoken');
    expect(mockQuery).toHaveBeenCalledWith(
      'DELETE FROM user_sessions WHERE token = $1',
      ['mytoken'],
    );
  });
});

// ── requireAuth ───────────────────────────────────────────────────────────────

describe('requireAuth', () => {
  const makeRes = () => {
    const res = { status: vi.fn(), json: vi.fn() };
    res.status.mockReturnValue(res);
    return res;
  };

  it('appelle next() directement si bypass activé', async () => {
    auth._setBypass(true);
    const next = vi.fn();
    await auth.requireAuth({}, makeRes(), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('retourne 401 si aucun cookie pb_session', async () => {
    const res  = makeRes();
    const next = vi.fn();
    await auth.requireAuth({ cookies: {} }, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Authentication required' });
    expect(next).not.toHaveBeenCalled();
  });

  it('retourne 401 si la session est expirée ou introuvable', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    database._setState({ query: mockQuery }, true);
    const req  = { cookies: { pb_session: 'a'.repeat(64) } };
    const res  = makeRes();
    const next = vi.fn();
    await auth.requireAuth(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Session expired' });
    expect(next).not.toHaveBeenCalled();
  });

  it('appelle next() et expose req.user si session valide', async () => {
    const user = { id: 1, username: 'admin', role: 'admin' };
    mockQuery.mockResolvedValue({ rows: [user] });
    database._setState({ query: mockQuery }, true);
    const req  = { cookies: { pb_session: 'a'.repeat(64) } };
    const res  = makeRes();
    const next = vi.fn();
    await auth.requireAuth(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(req.user).toEqual(user);
  });

  it('retourne 401 si getSessionUser lève une exception', async () => {
    mockQuery.mockRejectedValue(new Error('DB crash'));
    database._setState({ query: mockQuery }, true);
    const req  = { cookies: { pb_session: 'a'.repeat(64) } };
    const res  = makeRes();
    const next = vi.fn();
    await auth.requireAuth(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
  });
});

// ── requireAdmin ─────────────────────────────────────────────────────────────

describe('requireAdmin', () => {
  const makeRes = () => {
    const res = { status: vi.fn(), json: vi.fn() };
    res.status.mockReturnValue(res);
    return res;
  };

  it('appelle next() si bypass activé (quel que soit le rôle)', () => {
    auth._setBypass(true);
    const next = vi.fn();
    auth.requireAdmin({ user: { role: 'basic' } }, makeRes(), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('appelle next() si req.user.role === admin', () => {
    auth._setBypass(false);
    const next = vi.fn();
    auth.requireAdmin({ user: { role: 'admin' } }, makeRes(), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('retourne 403 si req.user.role !== admin', () => {
    auth._setBypass(false);
    const res  = makeRes();
    const next = vi.fn();
    auth.requireAdmin({ user: { role: 'basic' } }, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Forbidden' });
    expect(next).not.toHaveBeenCalled();
  });

  it('retourne 403 si req.user est absent', () => {
    auth._setBypass(false);
    const res  = makeRes();
    const next = vi.fn();
    auth.requireAdmin({}, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});

// ── authStaticGuard ───────────────────────────────────────────────────────────

describe('authStaticGuard', () => {
  const makeRes = () => ({ redirect: vi.fn() });
  const flush   = () => new Promise(r => setTimeout(r, 0));

  it('appelle next() directement si bypass activé', () => {
    auth._setBypass(true);
    const next = vi.fn();
    auth.authStaticGuard({}, makeRes(), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('redirige vers /login.html si aucun cookie', () => {
    const res  = makeRes();
    const next = vi.fn();
    auth.authStaticGuard({ cookies: {} }, res, next);
    expect(res.redirect).toHaveBeenCalledWith('/login.html');
    expect(next).not.toHaveBeenCalled();
  });

  it('appelle next() si la session est valide', async () => {
    const user = { id: 1, username: 'admin', role: 'admin' };
    mockQuery.mockResolvedValue({ rows: [user] });
    database._setState({ query: mockQuery }, true);
    const req  = { cookies: { pb_session: 'a'.repeat(64) } };
    const res  = makeRes();
    const next = vi.fn();
    auth.authStaticGuard(req, res, next);
    await flush();
    expect(next).toHaveBeenCalledOnce();
    expect(res.redirect).not.toHaveBeenCalled();
  });

  it('redirige si la session est invalide', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    database._setState({ query: mockQuery }, true);
    const req  = { cookies: { pb_session: 'a'.repeat(64) } };
    const res  = makeRes();
    const next = vi.fn();
    auth.authStaticGuard(req, res, next);
    await flush();
    expect(res.redirect).toHaveBeenCalledWith('/login.html');
    expect(next).not.toHaveBeenCalled();
  });

  it('redirige si getSessionUser lève une exception', async () => {
    mockQuery.mockRejectedValue(new Error('DB crash'));
    database._setState({ query: mockQuery }, true);
    const req  = { cookies: { pb_session: 'a'.repeat(64) } };
    const res  = makeRes();
    const next = vi.fn();
    auth.authStaticGuard(req, res, next);
    await flush();
    expect(res.redirect).toHaveBeenCalledWith('/login.html');
  });
});

// ── hashPassword ──────────────────────────────────────────────────────────────

describe('hashPassword', () => {
  it('retourne un hash bcrypt valide', async () => {
    const hash = await auth.hashPassword('mypassword');
    expect(hash).toBeTypeOf('string');
    expect(hash).toMatch(/^\$2[ab]\$/);
  });

  it('le hash correspond au mot de passe original', async () => {
    const hash = await auth.hashPassword('secret123');
    const match = await bcrypt.compare('secret123', hash);
    expect(match).toBe(true);
  });

  it('deux hashes du même mot de passe sont différents (salt unique)', async () => {
    const h1 = await auth.hashPassword('same');
    const h2 = await auth.hashPassword('same');
    expect(h1).not.toBe(h2);
  });
});

// ── requireAuth avec _testUser ────────────────────────────────────────────────

describe('requireAuth + _setTestUser', () => {
  const makeRes = () => {
    const res = { status: vi.fn(), json: vi.fn() };
    res.status.mockReturnValue(res);
    return res;
  };

  afterEach(() => {
    auth._setBypass(false);
    auth._setTestUser(null);
  });

  it('expose req.user depuis _testUser quand bypass activé', async () => {
    const user = { id: 99, username: 'tester', role: 'basic' };
    auth._setBypass(true);
    auth._setTestUser(user);
    const req  = {};
    const next = vi.fn();
    await auth.requireAuth(req, makeRes(), next);
    expect(req.user).toEqual(user);
    expect(next).toHaveBeenCalledOnce();
  });

  it('n\'expose pas req.user si _testUser est null avec bypass', async () => {
    auth._setBypass(true);
    auth._setTestUser(null);
    const req  = {};
    const next = vi.fn();
    await auth.requireAuth(req, makeRes(), next);
    expect(req.user).toBeUndefined();
    expect(next).toHaveBeenCalledOnce();
  });
});
