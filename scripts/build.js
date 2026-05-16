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
      entryPoints: ['admin', 'home', 'login', 'map', 'viewer'].map(p => `public/pages/${p}.js`),
      bundle:  true,
      minify:  true,
      format:  'esm',
      outdir:  'dist/public/pages',
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
      target:   'node24',
      format:   'cjs',
      packages: 'external',
      outfile:  'dist/server.js',
    }),
  ]);

  // HTML files are not processed by esbuild — copy as-is
  for (const f of ['index.html', 'admin.html', 'login.html', 'map.html', 'viewer.html']) {
    copyFile(path.join(ROOT, 'public', f), path.join(DIST, 'public', f));
  }

  console.log('Build complete.');
}

main().catch(err => { console.error(err); process.exit(1); });
