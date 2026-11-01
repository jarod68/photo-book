// @ts-check
'use strict';
/**
 * Builds the app icons (public/icons/) from public/icons/icon.svg: the
 * favicon, the home-screen icons of the web app manifest (192 / 512 px, and a
 * "maskable" one whose motif keeps to the central safe zone, for Android's
 * round / squircle masks) and the iOS touch icon. Run by hand when the SVG
 * changes; the PNGs are committed.  node scripts/icons.js
 */
const fs    = require('fs');
const path  = require('path');
const sharp = require('sharp');

const DIR = path.join(__dirname, '..', 'public', 'icons');
const svg = fs.readFileSync(path.join(DIR, 'icon.svg'), 'utf8');
// full-bleed square with the motif shrunk to 80 % (the maskable safe zone)
const maskable = svg
  .replace(/<rect [^>]*\/>/, '<rect width="512" height="512" fill="url(#bg)"/>')
  .replace(/(<circle[^>]*\/>\s*<path[^>]*\/>)/, '<g transform="translate(51.2 51.2) scale(0.8)">$1</g>');
// iOS draws its own rounded corners on an opaque square
const square = svg.replace(/<rect [^>]*\/>/, '<rect width="512" height="512" fill="url(#bg)"/>');

async function main() {
  /** @type {[string, string, number][]} */
  const out = [
    ['icon-192.png', svg, 192], ['icon-512.png', svg, 512],
    ['maskable-512.png', maskable, 512], ['apple-touch-icon.png', square, 180],
    ['favicon-32.png', svg, 32],
  ];
  for (const [name, src, size] of out) {
    await sharp(Buffer.from(src), { density: 300 }).resize(size, size).png({ compressionLevel: 9 }).toFile(path.join(DIR, name));
    console.log(`public/icons/${name}  ${(fs.statSync(path.join(DIR, name)).size / 1024).toFixed(1)} KB`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
