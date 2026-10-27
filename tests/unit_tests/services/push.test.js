import { createRequire } from 'module';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// services/push.js and this file share the CJS cache: spying on web-push's
// exports here is what push.js calls.
const _require = createRequire(import.meta.url);
const webpush  = _require('web-push');
const push     = _require('../../../services/push.js');

const KEYS = { publicKey: 'BPublicKey', privateKey: 'privateKey' };

describe('services/push', () => {
  let setVapid;
  beforeEach(() => {
    setVapid = vi.spyOn(webpush, 'setVapidDetails').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

  describe('initVapid', () => {
    it('prend les clés de l\'environnement en priorité', async () => {
      vi.stubEnv('VAPID_PUBLIC_KEY', 'envPub'); vi.stubEnv('VAPID_PRIVATE_KEY', 'envPriv');
      const db = { query: vi.fn() };
      await push.initVapid(db);
      expect(setVapid).toHaveBeenCalledWith('mailto:admin@photo-book.local', 'envPub', 'envPriv');
      expect(db.query).not.toHaveBeenCalled();
      expect(push.getVapidPublicKey()).toBe('envPub');
    });

    it('relit les clés enregistrées en base', async () => {
      const db = { query: vi.fn().mockResolvedValue({ rows: [{ public_key: 'dbPub', private_key: 'dbPriv' }] }) };
      await push.initVapid(db);
      expect(setVapid).toHaveBeenCalledWith(expect.any(String), 'dbPub', 'dbPriv');
      expect(push.getVapidPublicKey()).toBe('dbPub');
    });

    it('génère et enregistre des clés au premier démarrage', async () => {
      vi.spyOn(webpush, 'generateVAPIDKeys').mockReturnValue(KEYS);
      const db = { query: vi.fn().mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] }) };
      await push.initVapid(db);
      expect(db.query.mock.calls[1]).toEqual([expect.stringContaining('INSERT INTO push_vapid'), ['BPublicKey', 'privateKey']]);
      expect(push.getVapidPublicKey()).toBe('BPublicKey');
    });

    it('ne plante pas si la base est indisponible', async () => {
      await expect(push.initVapid({ query: vi.fn().mockRejectedValue(new Error('down')) })).resolves.toBeUndefined();
    });
  });

  describe('sendToAlbum', () => {
    const rows = [
      { id: 1, endpoint: 'https://p/1', p256dh: 'k1', auth: 'a1' },
      { id: 2, endpoint: 'https://p/2', p256dh: 'k2', auth: 'a2' },
      { id: 3, endpoint: 'https://p/3', p256dh: 'k3', auth: 'a3' },
    ];

    async function withDb(query) {
      vi.spyOn(webpush, 'generateVAPIDKeys').mockReturnValue(KEYS);
      const db = { query: vi.fn().mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] }) };
      await push.initVapid(db);           // sets the module's database handle
      db.query.mockImplementation(query);
      return db;
    }

    it('envoie à chaque abonné de l\'album, avec le nom de l\'album', async () => {
      const db = await withDb(async (sql) => (sql.startsWith('SELECT') ? { rows } : { rows: [] }));
      const send = vi.spyOn(webpush, 'sendNotification').mockResolvedValue({});
      expect(await push.sendToAlbum('Porto', { title: 'Porto', body: '2 nouvelles photos' })).toBe(3);
      expect(send).toHaveBeenCalledTimes(3);
      expect(send.mock.calls[0]).toEqual([
        { endpoint: 'https://p/1', keys: { p256dh: 'k1', auth: 'a1' } },
        JSON.stringify({ title: 'Porto', body: '2 nouvelles photos', album: 'Porto' }),
      ]);
      expect(db.query.mock.calls.at(-1)[1]).toEqual(['Porto']);
    });

    it('supprime les abonnements expirés (404 / 410), garde les autres erreurs', async () => {
      const db = await withDb(async (sql) => (sql.startsWith('SELECT') ? { rows } : { rows: [] }));
      vi.spyOn(webpush, 'sendNotification')
        .mockRejectedValueOnce(Object.assign(new Error('gone'), { statusCode: 410 }))
        .mockRejectedValueOnce(Object.assign(new Error('boom'), { statusCode: 500 }))
        .mockRejectedValueOnce(Object.assign(new Error('missing'), { statusCode: 404 }));
      expect(await push.sendToAlbum('Porto', { title: 't' })).toBe(0);
      const del = db.query.mock.calls.find(([sql]) => sql.includes('DELETE FROM push_subscriptions'));
      expect(del[1]).toEqual([[1, 3]]);
    });

    it('0 sans abonné ou si la lecture échoue', async () => {
      await withDb(async () => ({ rows: [] }));
      expect(await push.sendToAlbum('Vide', { title: 't' })).toBe(0);
      await withDb(async () => { throw new Error('db'); });
      expect(await push.sendToAlbum('Porto', { title: 't' })).toBe(0);
    });
  });
});
