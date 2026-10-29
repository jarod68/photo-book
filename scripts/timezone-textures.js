'use strict';
/**
 * Builds the time-zone index of the 3D globe (public/textures/earth/), from
 * timezone-boundary-builder (IANA time-zone boundaries from OpenStreetMap,
 * ODbL). Run by hand when the zones change (a new release); the results are
 * committed.
 *
 * 1. Download timezones-with-oceans.geojson.zip from
 *    https://github.com/evansiroky/timezone-boundary-builder/releases and unzip it.
 * 2. Simplify it (~1 km, far below a pixel of the index):
 *      npx mapshaper@0.7.85 combined-with-oceans.json -simplify interval=1000 keep-shapes \
 *        -o tz-simple.json format=geojson
 * 3. node scripts/timezone-textures.js tz-simple.json
 *
 * Outputs:
 *  - tz-index-{2048,4096}.png: equirectangular; each pixel holds the number of
 *    its zone + 1 (red = low byte, green = high byte; 0 = no zone), drawn
 *    without antialiasing so no pixel mixes two zones;
 *  - tz-zones.json: the zone names (IANA ids), in index order.
 * The page derives everything else (current UTC offset, local time) with Intl.
 */
const fs    = require('fs');
const path  = require('path');
const sharp = require('sharp');

const OUT = path.join(__dirname, '..', 'public', 'textures', 'earth');

async function main() {
  const src = process.argv[2];
  if (!src) throw new Error('usage: node scripts/timezone-textures.js tz-simple.json');
  const { geoEquirectangular, geoPath, geoArea } = await import('d3-geo');
  const zones = JSON.parse(fs.readFileSync(src, 'utf8')).features
    .sort((a, b) => a.properties.tzid.localeCompare(b.properties.tzid));
  // GeoJSON (RFC 7946) rings run counter-clockwise; d3-geo reads them as "the
  // whole sphere minus the zone". Reverse each polygon that covers more than a
  // hemisphere.
  for (const f of zones) {
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const poly of polys) {
      if (geoArea({ type: 'Polygon', coordinates: poly }) > 2 * Math.PI) for (const ring of poly) ring.reverse();
    }
  }
  if (zones.length > 65534) throw new Error('too many zones for two bytes');

  for (const width of [2048, 4096]) {
    const height = width / 2;
    const projection = geoEquirectangular().scale(width / (2 * Math.PI)).translate([width / 2, height / 2]).precision(0.05);
    const toPath = geoPath(projection);
    const paths = zones.map((f, i) => {
      const n = i + 1;
      return `<path fill="rgb(${n & 255},${n >> 8},0)" d="${toPath(f)}"/>`;
    });
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" shape-rendering="crispEdges">
      <rect width="100%" height="100%" fill="#000"/>${paths.join('')}</svg>`;
    const out = path.join(OUT, `tz-index-${width}.png`);
    await sharp(Buffer.from(svg), { limitInputPixels: false, unlimited: true })
      .removeAlpha().png({ compressionLevel: 9, palette: false }).toFile(out);
    console.log(`${path.relative(process.cwd(), out)}  ${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
  }
  const names = zones.map((f) => f.properties.tzid);
  fs.writeFileSync(path.join(OUT, 'tz-zones.json'), JSON.stringify(names));
  console.log(`tz-zones.json  ${names.length} zones`);
}

main().catch((err) => { console.error(err); process.exit(1); });
