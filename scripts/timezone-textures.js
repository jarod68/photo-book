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
 *  - tz-index-{2048,4096}.png: equirectangular; each pixel holds the number
 *    of its zone + 1 (red = low byte, green = high byte; 0 = no zone), drawn
 *    without antialiasing so no pixel mixes two zones — the overlay's tint;
 *  - tz-zones.json: the zone names (IANA ids), in index order;
 *  - tz-lines.bin: the borders as vector lines, each with the two zones it
 *    separates — drawn sharp at any zoom, only where the hour changes. Borders
 *    between a land zone and an ocean zone (territorial waters along every
 *    coast) are left out. Compact binary, little-endian (decoded by
 *    public/utils/timezones.js, decodeBorders):
 *      uint32 line count; per line: uint16 zone a, uint16 zone b, uint32 n,
 *      int32 lng, int32 lat (first point), then n-1 × (int16 dlng, int16 dlat)
 *      — all in thousandths of a degree (~110 m). Lines are cut at the
 *      antimeridian, so no step exceeds a few degrees.
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

  // Borders: a topology shares each border between its two zones (one arc).
  const { topology } = require('topojson-server');
  const topo = topology({ zones: { type: 'FeatureCollection', features: zones } }, 1e7);
  const owners = topo.arcs.map(() => []);
  const walk = (a, zi) => (Array.isArray(a) ? a.forEach((x) => walk(x, zi)) : owners[a < 0 ? ~a : a].push(zi));
  topo.objects.zones.geometries.forEach((g, zi) => walk(g.arcs ?? [], zi));
  const { scale: [kx, ky], translate: [tx, ty] } = topo.transform;
  const ocean = (i) => names[i].startsWith('Etc/');
  const lines = [];   // [zone a, zone b, [[lng, lat] in 1/1000 °, …]]
  topo.arcs.forEach((arc, i) => {
    const [a, b] = owners[i];
    if (b === undefined || a === b || ocean(a) !== ocean(b)) return;   // outer edge, or a coast
    let x = 0, y = 0, line = [];
    for (const [dx, dy] of arc) {
      x += dx; y += dy;
      const p = [Math.round((x * kx + tx) * 1000), Math.round((y * ky + ty) * 1000)];
      const last = line[line.length - 1];
      if (last && Math.abs(p[0] - last[0]) > 180000) {   // crossing the antimeridian: new line
        if (line.length > 1) lines.push([a, b, line]);
        line = [];
      } else if (last && p[0] === last[0] && p[1] === last[1]) continue;
      else if (last) {
        // long straight steps (the ocean zones' meridians): a point every 2°,
        // so the line follows the globe's curve
        const steps = Math.ceil(Math.max(Math.abs(p[0] - last[0]), Math.abs(p[1] - last[1])) / 2000);
        for (let k = 1; k < steps; k++) {
          line.push([Math.round(last[0] + ((p[0] - last[0]) * k) / steps), Math.round(last[1] + ((p[1] - last[1]) * k) / steps)]);
        }
      }
      line.push(p);
    }
    if (line.length > 1) lines.push([Math.min(a, b), Math.max(a, b), line]);
  });
  const size = 4 + lines.reduce((n, [, , l]) => n + 16 + (l.length - 1) * 4, 0);
  const buf = Buffer.alloc(size);
  let o = buf.writeUInt32LE(lines.length, 0);
  for (const [a, b, l] of lines) {
    o = buf.writeUInt16LE(a, o); o = buf.writeUInt16LE(b, o); o = buf.writeUInt32LE(l.length, o);
    o = buf.writeInt32LE(l[0][0], o); o = buf.writeInt32LE(l[0][1], o);
    for (let k = 1; k < l.length; k++) {
      const dx = l[k][0] - l[k - 1][0], dy = l[k][1] - l[k - 1][1];
      if (Math.abs(dx) > 32767 || Math.abs(dy) > 32767) throw new Error(`step too long in a border of ${names[a]} / ${names[b]}`);
      o = buf.writeInt16LE(dx, o); o = buf.writeInt16LE(dy, o);
    }
  }
  fs.writeFileSync(path.join(OUT, 'tz-lines.bin'), buf);
  console.log(`tz-lines.bin  ${lines.length} borders, ${(size / 1024).toFixed(0)} KB`);
}

main().catch((err) => { console.error(err); process.exit(1); });
