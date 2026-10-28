'use strict';
const esbuild = require('esbuild');
const fs      = require('fs');
const path    = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

async function main() {
  fs.rmSync(DIST, { recursive: true, force: true });

  const shared = { absWorkingDir: ROOT };

  await Promise.all([
    // Frontend pages: bundle all imports into one file per page, minify
    esbuild.build({
      ...shared,
      entryPoints: ['admin', 'home', 'login', 'map', 'search', 'viewer'].map(p => `public/pages/${p}.js`),
      bundle:  true,
      minify:  true,
      format:  'esm',
      outdir:  'dist/public/pages',
    }),

    // Globe page: Three.js and MapLibre are loaded via the import map (/vendor/), so external
    esbuild.build({
      ...shared,
      entryPoints: ['public/pages/globe.js'],
      bundle:   true,
      minify:   true,
      format:   'esm',
      outdir:   'dist/public/pages',
      external: ['three', 'three/addons/*', 'maplibre-gl'],
    }),

    // CSS: minify
    esbuild.build({
      ...shared,
      entryPoints: ['public/style.css'],
      minify:  true,
      outdir:  'dist/public',
    }),

    // Server + services: bundle into a single file, keep npm packages external
    esbuild.build({
      ...shared,
      entryPoints: ['server.js'],
      bundle:   true,
      minify:   true,
      platform: 'node',
      target:   'node26',
      format:   'cjs',
      packages: 'external',
      outfile:  'dist/server.js',
    }),
  ]);

  // Browser libraries, self-hosted under /vendor/ (services/vendor.js)
  const { VENDOR_FILES } = require('../services/vendor');
  for (const [dest, src] of Object.entries(VENDOR_FILES)) {
    const from = path.join(ROOT, 'node_modules', src);
    const to   = path.join(DIST, 'public', 'vendor', dest);
    if (dest.endsWith('/')) {
      // top-level files only (three's lines/ also holds an unused webgpu/ folder)
      for (const e of fs.readdirSync(from, { withFileTypes: true })) if (e.isFile()) copyFile(path.join(from, e.name), path.join(to, e.name));
    } else {
      copyFile(from, to);
    }
  }

  // Static assets copied as they are: the globe's Earth textures (scripts/earth-textures.js)
  fs.cpSync(path.join(ROOT, 'public', 'textures'), path.join(DIST, 'public', 'textures'), { recursive: true });

  // HTML files are not processed by esbuild — copy as-is
  for (const f of ['index.html', 'admin.html', 'login.html', 'map.html', 'search.html', 'viewer.html', 'globe.html']) {
    copyFile(path.join(ROOT, 'public', f), path.join(DIST, 'public', f));
  }

  console.log('Build complete.');
}

main().catch(err => { console.error(err); process.exit(1); });
