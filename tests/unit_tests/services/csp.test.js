import { createRequire } from 'module';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

const _require = createRequire(import.meta.url);
const csp = _require('../../../services/csp.js');
const { VENDOR_FILES } = _require('../../../services/vendor.js');
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');

describe('CSP (T6)', () => {
  beforeEach(() => { csp._reset(); });

  it('hash des scripts inline (seulement ceux sans src)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'csp-'));
    fs.writeFileSync(path.join(dir, 'globe.html'), '<script type="importmap">{"a":1}</script><script src="x.js"></script>');
    const want = `'sha256-${crypto.createHash('sha256').update('{"a":1}').digest('base64')}'`;
    expect(csp.inlineScriptHashes(dir)).toEqual([want]);
    fs.rmSync(dir, { recursive: true });
  });

  it('politique : rien hors du site sauf les tuiles OSM, et les tuiles du globe en images / requêtes', () => {
    const d = csp.directives(path.join(ROOT, 'public'));
    expect(d.scriptSrc[0]).toBe("'self'");
    expect(d.scriptSrc.slice(1).every((s) => s.startsWith("'sha256-"))).toBe(true);
    expect(d.scriptSrc).toHaveLength(2);                    // the globe's import map
    expect(d.imgSrc).toContain(csp.TILE_ORIGIN);
    expect(csp.GLOBE_ORIGINS).toEqual(['https://tiles.maps.eox.at', 'https://tiles.openfreemap.org']);
    expect(d.imgSrc.filter((s) => s.startsWith('https:'))).toEqual([csp.TILE_ORIGIN, ...csp.GLOBE_ORIGINS]);
    expect(d.connectSrc).toEqual(["'self'", ...csp.GLOBE_ORIGINS]);
    // never scripts, styles, workers or frames from elsewhere
    for (const k of ['scriptSrc', 'styleSrc', 'workerSrc', 'defaultSrc', 'fontSrc']) {
      expect(d[k].some((s) => s.startsWith('https:')), k).toBe(false);
    }
    expect(d.frameAncestors).toEqual(["'none'"]);
  });

  it('aucune page ne charge plus de ressource d\'un CDN', () => {
    const files = fs.readdirSync(path.join(ROOT, 'public'), { recursive: true })
      .filter((f) => /\.(html|js|css)$/.test(f) && !f.startsWith('vendor'));
    for (const f of files) {
      const src = fs.readFileSync(path.join(ROOT, 'public', f), 'utf8');
      expect(src, f).not.toMatch(/cdn\.jsdelivr|unpkg\.com|cdnjs/);
    }
  });

  it('chaque fichier vendor existe dans node_modules', () => {
    for (const src of Object.values(VENDOR_FILES)) {
      expect(fs.existsSync(path.join(ROOT, 'node_modules', src)), src).toBe(true);
    }
  });

  it('chaque violation distincte est journalisée une fois', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const report = { 'csp-report': { 'effective-directive': 'img-src', 'blocked-uri': 'https://evil.example/x.png', 'document-uri': 'https://book.holtz.fr/viewer.html?album=A' } };
    expect(csp.logViolation(report)).toBe(true);
    expect(csp.logViolation(report)).toBe(false);
    expect(err).toHaveBeenCalledWith('CSP violation: img-src blocked https://evil.example/x.png on https://book.holtz.fr/viewer.html');
    // Reporting API format
    expect(csp.logViolation([{ body: { effectiveDirective: 'script-src-elem', blockedURL: 'inline', documentURL: 'https://x/globe.html' } }])).toBe(true);
    err.mockRestore();
  });
});
