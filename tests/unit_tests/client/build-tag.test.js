/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { showBuildTag } from '../../../public/utils/build-tag.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
const serve = (body, ok = true) => vi.stubGlobal('fetch', vi.fn(async () => ({ ok, json: async () => body })));
const run = async () => { showBuildTag(); await tick(); await tick(); };

describe('build-tag', () => {
  beforeEach(() => { document.title = 'Photo Book'; });
  afterEach(() => {
    document.querySelectorAll('.build-tag, .env-strip').forEach((e) => e.remove());
    document.documentElement.classList.remove('env-nonprod');
    vi.unstubAllGlobals();
  });

  it('shows the short commit in production, with no QA marking', async () => {
    serve({ sha: 'a8b1aa5a9ebaa7aac14a', env: 'production' });
    await run();
    expect(document.querySelector('.build-tag').textContent).toBe('build a8b1aa5');
    expect(document.querySelector('.env-strip')).toBeNull();
    expect(document.title).toBe('Photo Book');
  });

  it('marks QA: tab title, top strip and badge', async () => {
    serve({ sha: 'ebac94cf053b24b9a6f1', env: 'qa' });
    await run();
    expect(document.querySelector('.build-tag').textContent).toBe('build ebac94c · QA');
    expect(document.querySelector('.env-strip .env-strip-label').textContent).toBe('QA');
    expect(document.title).toBe('[QA] Photo Book');
    expect(document.documentElement.classList.contains('env-nonprod')).toBe(true);
  });

  it('falls back to "dev" when version.json is missing', async () => {
    serve(null, false);
    await run();
    expect(document.querySelector('.build-tag').textContent).toBe('build dev');
    expect(document.querySelector('.env-strip')).toBeNull();
  });
});
