'use strict';
/**
 * Builds the Earth textures of the 3D globe (public/textures/earth/), from
 * public-domain NASA imagery and Natural Earth coastlines. Run it by hand when
 * the sources or sizes change; the results are committed, so neither the build
 * nor CI depends on NASA's servers.
 *
 *   node scripts/earth-textures.js [cache-dir]
 *
 * Sources (downloaded into cache-dir on first run, ~40 MB):
 *  - day:   NASA Blue Marble Next Generation, topography & bathymetry, Dec 2004
 *  - night: NASA Black Marble 2016 (city lights, VIIRS)
 *  - water: Natural Earth 1:50m land (world-atlas), rasterised here — the
 *           ocean mask that makes the sun glint on water only
 * Outputs: day-{2048,4096,8192}.webp, night-{2048,4096,8192}.webp, water-4096.webp
 */
const fs    = require('fs');
const path  = require('path');
const sharp = require('sharp');
const topojson = require('topojson-client');

const ROOT  = path.resolve(__dirname, '..');
const OUT   = path.join(ROOT, 'public', 'textures', 'earth');
const CACHE = path.resolve(process.argv[2] || path.join(require('os').tmpdir(), 'earth-sources'));

const SOURCES = {
  day:   'https://eoimages.gsfc.nasa.gov/images/imagerecords/73000/73909/world.topo.bathy.200412.3x21600x10800.jpg',
  night: 'https://eoimages.gsfc.nasa.gov/images/imagerecords/144000/144898/BlackMarble_2016_3km.jpg',
};
const SIZES = [2048, 4096, 8192];   // texture widths (height = width / 2)

async function download(url) {
  const file = path.join(CACHE, path.basename(url));
  if (fs.existsSync(file)) return file;
  console.log(`downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return file;
}

// Equirectangular SVG of the land polygons: white land on black. d3-geo cuts
// the polygons that cross the antimeridian (Chukotka, Fiji) and closes the
// ones around the pole (Antarctica), which a naive projection draws across
// the whole map.
async function landSvg(width) {
  const { geoEquirectangular, geoPath } = await import('d3-geo');
  const height = width / 2;
  const topo = JSON.parse(fs.readFileSync(require.resolve('world-atlas/land-50m.json'), 'utf8'));
  const land = topojson.feature(topo, topo.objects.land);
  const projection = geoEquirectangular().scale(width / (2 * Math.PI)).translate([width / 2, height / 2]).precision(0.1);
  const d = geoPath(projection)(land);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="100%" height="100%" fill="#000"/><path fill="#fff" d="${d}"/></svg>`;
}

async function main() {
  fs.mkdirSync(CACHE, { recursive: true });
  fs.mkdirSync(OUT, { recursive: true });
  const src = { day: await download(SOURCES.day), night: await download(SOURCES.night) };

  for (const [kind, file] of Object.entries(process.env.WATER_ONLY ? {} : src)) {
    for (const w of SIZES) {
      const out = path.join(OUT, `${kind}-${w}.webp`);
      await sharp(file, { limitInputPixels: false })
        .resize(w, w / 2, { fit: 'fill', kernel: 'lanczos3' })
        .webp({ quality: kind === 'night' ? 70 : 80, effort: 6 })
        .toFile(out);
      console.log(`${path.relative(ROOT, out)}  ${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
    }
  }

  // Ocean mask: 255 on water, 0 on land, slightly blurred so the glint fades at the coast.
  const out = path.join(OUT, 'water-4096.webp');
  await sharp(Buffer.from(await landSvg(4096))).negate({ alpha: false }).greyscale().blur(1.2)
    .webp({ quality: 85, effort: 6 }).toFile(out);
  console.log(`${path.relative(ROOT, out)}  ${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
}

main().catch((err) => { console.error(err); process.exit(1); });
