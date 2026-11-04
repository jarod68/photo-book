import { createRequire } from 'module';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const _require = createRequire(import.meta.url);
const database = _require('../../../services/database.js');
const sharp    = _require('sharp');
const bcrypt   = _require('bcryptjs');
const profiles = _require('../../../services/profiles.js');

const row = (o = {}) => ({ id: 3, username: 'ana', role: 'basic', display_name: 'Ana', bio: null, avatar_updated_at: null, ...o });

describe('profils', () => {
  beforeEach(() => database._reset());

  it('sans base : rien', async () => {
    expect(await profiles.byUsername('ana')).toBeNull();
    expect(await profiles.byId(3)).toBeNull();
    expect((await profiles.byIds([3])).size).toBe(0);
    expect(await profiles.directory()).toEqual([]);
    expect(await profiles.avatarOf('ana')).toBeNull();
  });

  it('lecture : nom affiché, version de la photo', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [row({ avatar_updated_at: new Date(5000) })] });
    database._setState({ query }, true);
    expect(await profiles.byUsername('ana')).toMatchObject({ id: 3, username: 'ana', displayName: 'Ana', avatarVersion: 5000 });
    expect((await profiles.byIds([3])).get(3).role).toBe('basic');
    query.mockResolvedValueOnce({ rows: [{ id: 3, username: 'ana', display_name: null }] });
    expect(await profiles.directory()).toEqual([{ id: 3, username: 'ana', displayName: null }]);
  });

  it('mise à jour : seulement les champs donnés, vide = effacé, trop long refusé', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [row()] });
    database._setState({ query }, true);
    await profiles.update(3, { displayName: '  Ana Silva ', bio: '' });
    expect(query.mock.calls[0]).toEqual(['UPDATE users SET display_name = $2, bio = $3 WHERE id = $1', [3, 'Ana Silva', null]]);
    query.mockClear();
    await profiles.update(3, {});
    expect(query.mock.calls[0][0]).toMatch(/^SELECT/);   // nothing to change: read back
    await expect(profiles.update(3, { displayName: 'x'.repeat(81) })).rejects.toMatchObject({ status: 400 });
    await expect(profiles.update(3, { bio: 42 })).rejects.toMatchObject({ status: 400 });
  });

  it('photo : n’importe quelle image → WebP carré de 256 px ; autre chose refusé', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [row()] });
    database._setState({ query }, true);
    const png = await sharp({ create: { width: 800, height: 400, channels: 3, background: '#f80' } }).png().toBuffer();
    await profiles.setAvatar(3, png);
    const webp = query.mock.calls[0][1][1];
    expect(await sharp(webp).metadata()).toMatchObject({ format: 'webp', width: 256, height: 256 });
    await expect(profiles.setAvatar(3, Buffer.from('not an image'))).rejects.toMatchObject({ status: 400 });
    await profiles.clearAvatar(3);
    expect(query.mock.calls.at(-1)[0]).toMatch(/avatar = NULL/);
  });

  it('mot de passe : l’actuel d’abord, la règle, puis les autres sessions fermées', async () => {
    const hash = await bcrypt.hash('Ancien#2026long', 4);
    const query = vi.fn(async (sql) => (sql.startsWith('SELECT password_hash') ? { rows: [{ password_hash: hash }] } : { rows: [] }));
    database._setState({ query }, true);
    await expect(profiles.changePassword(3, 'faux', 'Nouveau#2026long', 't')).rejects.toMatchObject({ status: 403 });
    await expect(profiles.changePassword(3, 'Ancien#2026long', 'court', 't')).rejects.toMatchObject({ status: 400 });
    await expect(profiles.changePassword(3, undefined, 'Nouveau#2026long', 't')).rejects.toMatchObject({ status: 400 });
    await profiles.changePassword(3, 'Ancien#2026long', 'Nouveau#2026long', 'tok');
    const sqls = query.mock.calls.map((c) => c[0]);
    expect(sqls.some((s) => s.startsWith('UPDATE users SET password_hash'))).toBe(true);
    expect(query.mock.calls.find((c) => c[0].startsWith('DELETE FROM user_sessions'))[1]).toEqual([3, 'tok']);
  });
});
