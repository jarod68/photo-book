import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getStoredAlbums, initPush, subscribeTo, unsubscribeFrom, getSubscription } from '../../../public/utils/push.js';

// A fake service worker registration and push subscription.
function fakeBrowser({ supported = true } = {}) {
  const sub = { toJSON: () => ({ endpoint: 'https://push/1', keys: { p256dh: 'k', auth: 'a' } }), unsubscribe: vi.fn().mockResolvedValue(true) };
  const reg = { pushManager: { subscribe: vi.fn().mockResolvedValue(sub), getSubscription: vi.fn().mockResolvedValue(sub) } };
  const sw = { register: vi.fn().mockResolvedValue(reg), getRegistration: vi.fn().mockResolvedValue(reg) };
  if (supported) {
    Object.defineProperty(navigator, 'serviceWorker', { value: sw, configurable: true });
    window.PushManager = function PushManager() {};
  } else {
    delete navigator.serviceWorker;
    delete window.PushManager;
  }
  return { sw, reg, sub };
}

describe('utils/push', () => {
  let fetchMock;
  beforeEach(() => {
    localStorage.clear();
    fetchMock = vi.fn(async (url) => ({ ok: true, json: async () => (url.includes('vapid') ? { publicKey: 'AQAB' } : { ok: true }) }));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('initPush : null sans Push API, sinon enregistre /sw.js', async () => {
    fakeBrowser({ supported: false });
    expect(await initPush()).toBeNull();
    const { sw, reg } = fakeBrowser();
    expect(await initPush()).toBe(reg);
    expect(sw.register).toHaveBeenCalledWith('/sw.js');
  });

  it('subscribeTo : abonne avec la clé VAPID, envoie le partage, mémorise l\'album', async () => {
    const { reg } = fakeBrowser();
    expect(await subscribeTo('Porto', 'tok')).toBe(true);
    const opts = reg.pushManager.subscribe.mock.calls[0][0];
    expect(opts.userVisibleOnly).toBe(true);
    expect([...opts.applicationServerKey]).toEqual([1, 0, 1]);           // 'AQAB' base64url
    const [url, init] = fetchMock.mock.calls.at(-1);
    expect(url).toBe('/api/push/subscribe');
    expect(JSON.parse(init.body)).toMatchObject({ album: 'Porto', share: 'tok', subscription: { endpoint: 'https://push/1' } });
    expect(getStoredAlbums()).toEqual(['Porto']);
    await subscribeTo('Porto');
    expect(getStoredAlbums()).toEqual(['Porto']);                          // no duplicate
  });

  it('subscribeTo : false si le serveur refuse ou sans Push API', async () => {
    fakeBrowser();
    fetchMock.mockImplementation(async (url) => ({ ok: !url.includes('subscribe'), json: async () => ({ publicKey: 'AQAB' }) }));
    expect(await subscribeTo('Secret')).toBe(false);
    expect(getStoredAlbums()).toEqual([]);
    fakeBrowser({ supported: false });
    expect(await subscribeTo('Porto')).toBe(false);
  });

  it('unsubscribeFrom : oublie l\'album, résilie la souscription après le dernier', async () => {
    const { sub } = fakeBrowser();
    localStorage.setItem('pb_push_albums', JSON.stringify(['Porto', 'Perth']));
    await unsubscribeFrom('Porto', 'https://push/1');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ album: 'Porto', endpoint: 'https://push/1' });
    expect(getStoredAlbums()).toEqual(['Perth']);
    expect(sub.unsubscribe).not.toHaveBeenCalled();
    await unsubscribeFrom('Perth', 'https://push/1');
    expect(sub.unsubscribe).toHaveBeenCalled();
  });

  it('getSubscription et getStoredAlbums tolèrent l\'absence de support ou de données', async () => {
    fakeBrowser({ supported: false });
    expect(await getSubscription()).toBeNull();
    const { sw, sub } = fakeBrowser();
    expect(await getSubscription()).toBe(sub);
    sw.getRegistration.mockResolvedValue(undefined);
    expect(await getSubscription()).toBeNull();
    localStorage.setItem('pb_push_albums', '{corrupt');
    expect(getStoredAlbums()).toEqual([]);
  });
});
