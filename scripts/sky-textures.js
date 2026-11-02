// @ts-check
'use strict';
/**
 * Builds the starry sky of the 3D globe (public/textures/sky/) from NASA's
 * Deep Star Maps 2020 (Ernie Wright, NASA/Goddard SVS, public domain): 1.7
 * billion stars of the Hipparcos-2, Tycho-2 and Gaia DR2 catalogues, plotted
 * with their real position, brightness and colour — the Milky Way, its dust
 * lanes, the Magellanic Clouds, Andromeda are the stars themselves. Run it by
 * hand when the source or the sizes change; the results are committed.
 *
 *   node scripts/sky-textures.js [cache-dir]
 *
 * Source (downloaded into cache-dir on first run, 125 MB): starmap_2020_8k.exr,
 * plate carrée in celestial coordinates (ICRF/J2000), centred on 0 h of right
 * ascension, right ascension increasing to the left, declination +90° at the
 * top. Linear HDR → a gentle tone curve → sRGB.
 * Outputs: sky-4096.webp, sky-8192.webp (the page picks one, as for the Earth).
 */
const fs    = require('fs');
const path  = require('path');
const sharp = require('sharp');

const ROOT  = path.resolve(__dirname, '..');
const OUT   = path.join(ROOT, 'public', 'textures', 'sky');
const CACHE = path.resolve(process.argv[2] || path.join(require('os').tmpdir(), 'sky-sources'));
const SOURCE = 'https://svs.gsfc.nasa.gov/vis/a000000/a004800/a004851/starmap_2020_8k.exr';
const SIZES = [4096, 8192];

const BLACK    = 0.0015;   // the sky between the stars: black, not grey
const EXPOSURE = 1.6;

async function download(url) {
  const file = path.join(CACHE, path.basename(url));
  if (fs.existsSync(file)) return file;
  console.log(`downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return file;
}

// linear light → display: a soft shoulder keeps the brightest stars from clipping
const toneMap = (v) => {
  const x = Math.max(0, v - BLACK) * EXPOSURE;
  const y = x / (1 + x * 0.6);
  return y <= 0.0031308 ? 12.92 * y : 1.055 * y ** (1 / 2.4) - 0.055;   // sRGB
};

async function main() {
  const file = await download(SOURCE);
  const THREE = await import('three');
  const { EXRLoader } = await import('three/examples/jsm/loaders/EXRLoader.js');
  const buf = fs.readFileSync(file);
  const loader = new EXRLoader();
  loader.setDataType(THREE.FloatType);
  const { width, height, data } = loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const ch = data.length / (width * height);
  console.log(`${path.basename(file)}: ${width}×${height}, ${ch} channels`);

  // three's EXRLoader gives the rows bottom first (WebGL's order): flipped below
  const rgb = Buffer.alloc(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    for (let c = 0; c < 3; c++) rgb[i * 3 + c] = Math.round(Math.min(1, toneMap(data[i * ch + c])) * 255);
  }
  fs.mkdirSync(OUT, { recursive: true });
  for (const w of SIZES) {
    const out = path.join(OUT, `sky-${w}.webp`);
    await sharp(rgb, { raw: { width, height, channels: 3 } })
      .flip()
      .resize(w, w / 2, { kernel: 'lanczos3' })
      .webp({ quality: 82, smartSubsample: true })
      .toFile(out);
    console.log(`${path.relative(ROOT, out)}: ${(fs.statSync(out).size / 1e6).toFixed(1)} MB`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
