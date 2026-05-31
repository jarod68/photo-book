import { createRequire } from 'module';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const activity = await import('../../../services/activity.js');
const _require  = createRequire(import.meta.url);
const database  = _require('../../../services/database.js');

const mockQuery = vi.fn();

beforeEach(() => {
  mockQuery.mockReset();
  database._reset();
});

afterEach(() => vi.restoreAllMocks());

// ── log ───────────────────────────────────────────────────────────────────────

describe('log', () => {
  it('ne fait rien si la DB n\'est pas prête', async () => {
    // database._reset() leaves dbReady=false
    await activity.log('test_action');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('insère une entrée dans activity_log avec les bons paramètres', async () => {
    mockQuery.mockResolvedValue({ rowCount: 1 });
    database._setState({ query: mockQuery }, true);
    await activity.log('login', { username: 'alice', ip: '1.2.3.4', details: { browser: 'Firefox' } });
    expect(mockQuery).toHaveBeenCalledOnce();
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('INSERT INTO activity_log');
    expect(params[0]).toBe('login');
    expect(params[1]).toBe('alice');
    expect(params[2]).toBe('1.2.3.4');
    expect(params[3]).toBe(JSON.stringify({ browser: 'Firefox' }));
  });

  it('utilise null pour username et ip absents', async () => {
    mockQuery.mockResolvedValue({ rowCount: 1 });
    database._setState({ query: mockQuery }, true);
    await activity.log('page_view');
    const [, params] = mockQuery.mock.calls[0];
    expect(params[1]).toBeNull();
    expect(params[2]).toBeNull();
  });

  it('utilise null si username est une chaîne vide', async () => {
    mockQuery.mockResolvedValue({ rowCount: 1 });
    database._setState({ query: mockQuery }, true);
    await activity.log('test', { username: '', ip: '' });
    const [, params] = mockQuery.mock.calls[0];
    expect(params[1]).toBeNull();
    expect(params[2]).toBeNull();
  });

  it('avale les erreurs de DB sans les propager', async () => {
    mockQuery.mockRejectedValue(new Error('DB crash'));
    database._setState({ query: mockQuery }, true);
    await expect(activity.log('test')).resolves.toBeUndefined();
  });

  it('sérialise les details en JSON', async () => {
    mockQuery.mockResolvedValue({ rowCount: 1 });
    database._setState({ query: mockQuery }, true);
    const details = { key: 'value', nested: { a: 1 } };
    await activity.log('event', { details });
    const [, params] = mockQuery.mock.calls[0];
    expect(params[3]).toBe(JSON.stringify(details));
  });
});

// ── purgeActivityLog ──────────────────────────────────────────────────────────

describe('purgeActivityLog', () => {
  it('ne fait rien si la DB n\'est pas prête', async () => {
    await activity.purgeActivityLog();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('ne supprime pas si count ≤ 5000', async () => {
    mockQuery.mockResolvedValue({ rows: [{ cnt: '4999' }] });
    database._setState({ query: mockQuery }, true);
    await activity.purgeActivityLog();
    expect(mockQuery).toHaveBeenCalledOnce();
    expect(mockQuery.mock.calls[0][0]).toContain('SELECT COUNT(*)');
  });

  it('ne supprime pas si count === 5000', async () => {
    mockQuery.mockResolvedValue({ rows: [{ cnt: '5000' }] });
    database._setState({ query: mockQuery }, true);
    await activity.purgeActivityLog();
    expect(mockQuery).toHaveBeenCalledOnce();
  });

  it('émet un DELETE si count > 5000', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ cnt: '5001' }] })
      .mockResolvedValueOnce({ rowCount: 1 });
    database._setState({ query: mockQuery }, true);
    await activity.purgeActivityLog();
    expect(mockQuery).toHaveBeenCalledTimes(2);
    const deleteSql = mockQuery.mock.calls[1][0];
    expect(deleteSql).toContain('DELETE FROM activity_log');
  });

  it('le DELETE conserve les 5000 entrées les plus récentes', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ cnt: '10000' }] })
      .mockResolvedValueOnce({ rowCount: 5000 });
    database._setState({ query: mockQuery }, true);
    await activity.purgeActivityLog();
    const deleteSql = mockQuery.mock.calls[1][0];
    expect(deleteSql).toContain('LIMIT 5000');
  });

  it('avale les erreurs de DB sans les propager', async () => {
    mockQuery.mockRejectedValue(new Error('DB crash'));
    database._setState({ query: mockQuery }, true);
    await expect(activity.purgeActivityLog()).resolves.toBeUndefined();
  });
});
