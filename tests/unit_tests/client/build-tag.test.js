/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { showBuildTag } from '../../../public/utils/build-tag.js';

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('build-tag', () => {
  afterEach(() => { document.querySelectorAll('.build-tag').forEach((e) => e.remove()); vi.unstubAllGlobals(); });

  it('shows the short commit from version.json', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ sha: 'a8b1aa5a9ebaa7aac14a' }) })));
    showBuildTag();
    await tick(); await tick();
    expect(document.querySelector('.build-tag').textContent).toBe('build a8b1aa5');
  });

  it('falls back to "dev" when version.json is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));
    showBuildTag();
    await tick(); await tick();
    expect(document.querySelector('.build-tag').textContent).toBe('build dev');
  });
});
