import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const database = require('../../../services/database.js');
const activity = require('../../../services/activity.js');
const maintenance = require('../../../services/maintenance.js');

describe('maintenance (T4)', () => {
  let query;
  beforeEach(() => {
    query = vi.fn().mockResolvedValue({ rowCount: 2 });
    database._setState({ query }, true);
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => { maintenance.stopMaintenance(); database._reset(); vi.restoreAllMocks(); vi.useRealTimers(); });

  it('deletes expired sessions and share links expired past the grace period', async () => {
    const out = await maintenance.purgeExpired();
    expect(out).toEqual({ sessions: 2, shares: 2 });
    const [s1, s2] = query.mock.calls;
    expect(s1[0]).toMatch(/DELETE FROM user_sessions WHERE expires_at < NOW\(\)/);
    expect(s2[0]).toMatch(/DELETE FROM share_tokens WHERE expires_at < NOW\(\) - make_interval\(days => \$1\)/);
    expect(s2[1]).toEqual([maintenance.SHARE_GRACE_DAYS]);
  });

  it('does nothing without a database', async () => {
    database._reset();
    expect(await maintenance.purgeExpired()).toEqual({ sessions: 0, shares: 0 });
    expect(query).not.toHaveBeenCalled();
  });

  it('runs at startup, then every EVERY_MS, without keeping the process alive', async () => {
    vi.useFakeTimers();
    const purgeLog = vi.spyOn(activity, 'purgeActivityLog').mockResolvedValue();
    const timer = maintenance.startMaintenance();
    await vi.advanceTimersByTimeAsync(0);
    expect(purgeLog).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(maintenance.EVERY_MS);
    expect(purgeLog).toHaveBeenCalledTimes(2);
    expect(timer.hasRef()).toBe(false);
  });

  it('a failing purge does not stop the activity-log purge', async () => {
    query.mockRejectedValue(new Error('db down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const purgeLog = vi.spyOn(activity, 'purgeActivityLog').mockResolvedValue();
    await maintenance.runMaintenance();
    expect(purgeLog).toHaveBeenCalled();
  });
});
