import { createRequire } from 'module';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const access   = await import('../../../services/access.js');
const _require  = createRequire(import.meta.url);
const database  = _require('../../../services/database.js');

const mockQuery = vi.fn();

beforeEach(() => {
  mockQuery.mockReset();
  database._reset();
});

afterEach(() => vi.restoreAllMocks());

// ── validateShareToken ────────────────────────────────────────────────────────

describe('validateShareToken', () => {
  it('retourne false si la DB n\'est pas prête', async () => {
    const result = await access.validateShareToken('abc', 'Paris');
    expect(result).toBe(false);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('retourne false si le token est null', async () => {
    database._setState({ query: mockQuery }, true);
    const result = await access.validateShareToken(null, 'Paris');
    expect(result).toBe(false);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('retourne false si le token est une chaîne vide', async () => {
    database._setState({ query: mockQuery }, true);
    const result = await access.validateShareToken('', 'Paris');
    expect(result).toBe(false);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('retourne true si un token valide est trouvé', async () => {
    mockQuery.mockResolvedValue({ rows: [{ '?column?': 1 }] });
    database._setState({ query: mockQuery }, true);
    const result = await access.validateShareToken('valid-token', 'Paris');
    expect(result).toBe(true);
    expect(mockQuery.mock.calls[0][1]).toEqual(['valid-token', 'Paris']);
  });

  it('retourne false si aucun token trouvé (expiré ou inexistant)', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    database._setState({ query: mockQuery }, true);
    const result = await access.validateShareToken('expired-token', 'Paris');
    expect(result).toBe(false);
  });
});

// ── getAlbumAccess ────────────────────────────────────────────────────────────

describe('getAlbumAccess', () => {
  it('album public + pas d\'utilisateur → allowed true, canDelete false', async () => {
    // visibility query returns 'public'
    mockQuery.mockResolvedValue({ rows: [{ visibility: 'public' }] });
    database._setState({ query: mockQuery }, true);
    const result = await access.getAlbumAccess('Paris', null);
    expect(result).toEqual({ allowed: true, canDelete: false, canManage: false });
  });

  it('album public + admin → allowed true, canDelete true', async () => {
    mockQuery.mockResolvedValue({ rows: [{ visibility: 'public' }] });
    database._setState({ query: mockQuery }, true);
    const result = await access.getAlbumAccess('Paris', { role: 'admin' });
    expect(result).toEqual({ allowed: true, canDelete: true, canManage: true });
  });

  it('album public + utilisateur basique → allowed true, canDelete false', async () => {
    mockQuery.mockResolvedValue({ rows: [{ visibility: 'public' }] });
    database._setState({ query: mockQuery }, true);
    const result = await access.getAlbumAccess('Paris', { id: 5, role: 'basic' });
    expect(result).toEqual({ allowed: true, canDelete: false, canManage: false });
  });

  it('album restreint + share token valide → allowed true, canDelete false', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ visibility: 'restricted' }] }) // getAlbumVisibility
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });           // validateShareToken
    database._setState({ query: mockQuery }, true);
    const result = await access.getAlbumAccess('Private', null, 'valid-token');
    expect(result).toEqual({ allowed: true, canDelete: false, canManage: false });
  });

  it('album restreint + pas d\'utilisateur ni de token → forbidden', async () => {
    mockQuery.mockResolvedValue({ rows: [{ visibility: 'restricted' }] });
    database._setState({ query: mockQuery }, true);
    const result = await access.getAlbumAccess('Private', null);
    expect(result).toEqual({ allowed: false, canDelete: false, canManage: false });
  });

  it('album restreint + pas d\'utilisateur + share token invalide → forbidden', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ visibility: 'restricted' }] })
      .mockResolvedValueOnce({ rows: [] }); // token invalid
    database._setState({ query: mockQuery }, true);
    const result = await access.getAlbumAccess('Private', null, 'bad-token');
    expect(result).toEqual({ allowed: false, canDelete: false, canManage: false });
  });

  it('album restreint + admin → allowed true, canDelete true', async () => {
    mockQuery.mockResolvedValue({ rows: [{ visibility: 'restricted' }] });
    database._setState({ query: mockQuery }, true);
    const result = await access.getAlbumAccess('Private', { role: 'admin' });
    expect(result).toEqual({ allowed: true, canDelete: true, canManage: true });
  });

  it('album restreint + utilisateur basique autorisé → allowed true, canDelete true', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ visibility: 'restricted' }] }) // visibility
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });           // isUserAuthorized
    database._setState({ query: mockQuery }, true);
    const result = await access.getAlbumAccess('Private', { id: 7, role: 'basic' });
    expect(result).toEqual({ allowed: true, canDelete: true, canManage: false });
  });

  it('album restreint + utilisateur basique non autorisé → forbidden', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ visibility: 'restricted' }] })
      .mockResolvedValueOnce({ rows: [] }); // not authorized
    database._setState({ query: mockQuery }, true);
    const result = await access.getAlbumAccess('Private', { id: 8, role: 'basic' });
    expect(result).toEqual({ allowed: false, canDelete: false, canManage: false });
  });

  it('propriétaire : tout, même sur un album privé ; un autre utilisateur, rien sur un album privé', async () => {
    mockQuery.mockResolvedValue({ rows: [{ visibility: 'private', owner_id: 7 }] });
    database._setState({ query: mockQuery }, true);
    expect(await access.getAlbumAccess('Mine', { id: 7, role: 'basic' })).toEqual({ allowed: true, canDelete: true, canManage: true });
    expect(await access.getAlbumAccess('Mine', { id: 8, role: 'basic' })).toEqual({ allowed: false, canDelete: false, canManage: false });
    expect(await access.getAlbumAccess('Mine', null)).toEqual({ allowed: false, canDelete: false, canManage: false });
    expect(await access.getAlbumAccess('Mine', { id: 1, role: 'admin' })).toEqual({ allowed: true, canDelete: true, canManage: true });
  });

  it('album privé : un lien de partage de son propriétaire l’ouvre en lecture', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ visibility: 'private', owner_id: 7 }] })
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
    database._setState({ query: mockQuery }, true);
    expect(await access.getAlbumAccess('Mine', null, 'tok')).toEqual({ allowed: true, canDelete: false, canManage: false });
  });

  it('album privé : un membre de la liste n’y a pas accès (c’est réservé à son propriétaire)', async () => {
    mockQuery.mockResolvedValue({ rows: [{ visibility: 'private', owner_id: 7 }] });
    database._setState({ query: mockQuery }, true);
    expect((await access.getAlbumAccess('Mine', { id: 9, role: 'basic' })).allowed).toBe(false);
    expect(mockQuery).toHaveBeenCalledTimes(1);   // no member lookup
  });

  it('DB non prête → visibilité retombe sur public (allowed true)', async () => {
    // database._reset() leaves dbReady=false → getAlbumVisibility returns 'public'
    const result = await access.getAlbumAccess('Private', null);
    expect(result.allowed).toBe(true);
  });
});

// ── filterVisibleAlbums ───────────────────────────────────────────────────────

const dir = name => ({ name, isDirectory: () => true });

describe('filterVisibleAlbums', () => {
  it('retourne tous les albums si DB non prête (tout public par défaut)', async () => {
    const { filtered } = await access.filterVisibleAlbums([dir('A'), dir('B')], null);
    expect(filtered).toHaveLength(2);
  });

  it('retourne tous les albums publics pour un utilisateur anonyme', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    database._setState({ query: mockQuery }, true);
    const { filtered } = await access.filterVisibleAlbums([dir('Paris'), dir('London')], null);
    expect(filtered).toHaveLength(2);
  });

  it('filtre les albums restreints pour un utilisateur anonyme', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ album: 'Private', visibility: 'restricted' }],
    });
    database._setState({ query: mockQuery }, true);
    const { filtered } = await access.filterVisibleAlbums([dir('Paris'), dir('Private')], null);
    expect(filtered.map(d => d.name)).toEqual(['Paris']);
  });

  it('admin voit tous les albums y compris restreints', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ album: 'Private', visibility: 'restricted' }],
    });
    database._setState({ query: mockQuery }, true);
    const { filtered } = await access.filterVisibleAlbums(
      [dir('Paris'), dir('Private')],
      { id: 1, role: 'admin' },
    );
    expect(filtered).toHaveLength(2);
  });

  it('basic user voit les albums publics et ses albums autorisés', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          { album: 'Private', visibility: 'restricted' },
          { album: 'Secret',  visibility: 'restricted' },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ album: 'Private' }] });
    database._setState({ query: mockQuery }, true);
    const { filtered } = await access.filterVisibleAlbums(
      [dir('Paris'), dir('Private'), dir('Secret')],
      { id: 5, role: 'basic' },
    );
    const names = filtered.map(d => d.name);
    expect(names).toContain('Paris');
    expect(names).toContain('Private');
    expect(names).not.toContain('Secret');
  });

  it('retourne visibilityMap et authorizedSet correctement remplis', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ album: 'A', visibility: 'restricted' }] })
      .mockResolvedValueOnce({ rows: [{ album: 'A' }] });
    database._setState({ query: mockQuery }, true);
    const { visibilityMap, authorizedSet } = await access.filterVisibleAlbums(
      [dir('A')],
      { id: 2, role: 'basic' },
    );
    expect(visibilityMap.get('A')).toBe('restricted');
    expect(authorizedSet.has('A')).toBe(true);
  });

  it('albums privés : seulement pour leur propriétaire (et l’admin) ; un membre n’y entre pas', async () => {
    const settings = { rows: [
      { album: 'Mine', visibility: 'private', owner_id: 5 },
      { album: 'Theirs', visibility: 'private', owner_id: 6 },
      { album: 'Shared', visibility: 'restricted', owner_id: 6 },
    ] };
    mockQuery.mockResolvedValueOnce(settings).mockResolvedValueOnce({ rows: [{ album: 'Theirs' }, { album: 'Shared' }] });
    database._setState({ query: mockQuery }, true);
    const { filtered, ownerMap } = await access.filterVisibleAlbums(
      [dir('Paris'), dir('Mine'), dir('Theirs'), dir('Shared')], { id: 5, role: 'basic' });
    expect(filtered.map(d => d.name)).toEqual(['Paris', 'Mine', 'Shared']);
    expect(ownerMap.get('Theirs')).toBe(6);
    mockQuery.mockResolvedValueOnce(settings);
    expect((await access.filterVisibleAlbums([dir('Mine'), dir('Theirs')], { id: 1, role: 'admin' })).filtered).toHaveLength(2);
  });
});

// ── requireAlbumManager ───────────────────────────────────────────────────────

describe('requireAlbumManager', () => {
  const run = async (user, ownerId) => {
    mockQuery.mockResolvedValue({ rows: ownerId === undefined ? [] : [{ visibility: 'public', owner_id: ownerId }] });
    database._setState({ query: mockQuery }, true);
    const res = { status: vi.fn(() => res), json: vi.fn(() => res) };
    const next = vi.fn();
    await access.requireAlbumManager({ user, params: { album: 'A' } }, res, next);
    return { next: next.mock.calls.length, status: res.status.mock.calls[0]?.[0] };
  };

  it('l’admin et le propriétaire passent ; un autre utilisateur 403 ; un album sans propriétaire est à l’admin', async () => {
    expect(await run({ id: 1, role: 'admin' }, 9)).toEqual({ next: 1, status: undefined });
    expect(await run({ id: 9, role: 'basic' }, 9)).toEqual({ next: 1, status: undefined });
    expect(await run({ id: 8, role: 'basic' }, 9)).toEqual({ next: 0, status: 403 });
    expect(await run({ id: 8, role: 'basic' }, undefined)).toEqual({ next: 0, status: 403 });
  });
});

