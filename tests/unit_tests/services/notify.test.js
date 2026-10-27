import { createRequire } from 'module';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const _require = createRequire(import.meta.url);
const database = _require('../../../services/database.js');
const notify   = _require('../../../services/notify.js');

describe('notify (F9)', () => {
  let send;
  beforeEach(() => {
    vi.useFakeTimers();
    notify._reset(); database._reset();
    send = vi.fn().mockResolvedValue(2);
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => { notify._reset(); vi.useRealTimers(); vi.restoreAllMocks(); });

  it('un seul résumé quand les ajouts cessent, sans doublon (upload + watcher)', async () => {
    notify.photosAdded('Porto', ['b.jpg', 'a.jpg'], { send });
    notify.photosAdded('Porto', ['a.jpg'], { send });            // the watcher sees the upload too
    await vi.advanceTimersByTimeAsync(notify.QUIET_MS - 1);
    expect(send).not.toHaveBeenCalled();
    notify.photosAdded('Porto', ['c.jpg'], { send });            // quiet period restarts
    await vi.advanceTimersByTimeAsync(notify.QUIET_MS);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('Porto', { title: 'Porto', body: '3 nouvelles photos', photo: 'a.jpg', tag: 'album-Porto' });
    expect(notify.pendingFor('Porto')).toEqual([]);
  });

  it('un import continu est annoncé au plus tard MAX_WAIT_MS après la première photo', async () => {
    const start = Date.now();
    const sentAt = [];
    send = vi.fn(async () => { sentAt.push(Date.now() - start); return 1; });
    for (let t = 0; t < 2 * notify.MAX_WAIT_MS; t += notify.QUIET_MS / 2) {
      notify.photosAdded('Big', [`IMG_${t}.jpg`], { send });
      await vi.advanceTimersByTimeAsync(notify.QUIET_MS / 2);
    }
    expect(sentAt[0]).toBe(notify.MAX_WAIT_MS);
    expect(sentAt[1]).toBeLessThanOrEqual(2 * notify.MAX_WAIT_MS + notify.QUIET_MS);
  });

  it('singulier, et une photo supprimée avant l\'envoi n\'est pas annoncée', async () => {
    notify.photosAdded('Perth', ['x.jpg', 'y.jpg'], { send });
    notify.photoRemoved('Perth', 'y.jpg');
    await vi.advanceTimersByTimeAsync(notify.QUIET_MS);
    expect(send.mock.calls[0][1].body).toBe('1 nouvelle photo');
  });

  it('rien si tout a été supprimé, ou si l\'album a désactivé les notifications', async () => {
    notify.photosAdded('A', ['x.jpg'], { send });
    notify.photoRemoved('A', 'x.jpg');
    await vi.advanceTimersByTimeAsync(notify.QUIET_MS);
    database._setState({ query: vi.fn().mockResolvedValue({ rows: [{ notify_new: false }] }) }, true);
    notify.photosAdded('B', ['x.jpg'], { send });
    await vi.advanceTimersByTimeAsync(notify.QUIET_MS);
    expect(send).not.toHaveBeenCalled();
  });

  it('albums indépendants', async () => {
    notify.photosAdded('A', ['1.jpg'], { send });
    notify.photosAdded('B', ['2.jpg'], { send });
    await vi.advanceTimersByTimeAsync(notify.QUIET_MS);
    expect(send.mock.calls.map((c) => c[0]).sort()).toEqual(['A', 'B']);
  });
});
