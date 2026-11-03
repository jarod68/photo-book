// @ts-check
'use strict';
/**
 * Data for the load test (tests/load/browse.js): albums of real-sized photos
 * (1600×1067 JPEGs with a capture date and a GPS position, so the map, the
 * route and the date order have work to do) and published articles, made
 * through the admin API of a running server (scripts/e2e-server.sh), then a
 * wait until every photo has its thumbnail, preview and medium size.
 *
 *   BASE_URL=http://localhost:3000 ADMIN_PASS=… node tests/load/seed.js
 *
 * LOAD_ALBUMS (3) × LOAD_PHOTOS (30) photos, LOAD_ARTICLES (2) per album.
 */
const sharp = require('sharp');

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const ALBUMS = Number(process.env.LOAD_ALBUMS || 3);
const PHOTOS = Number(process.env.LOAD_PHOTOS || 30);
const ARTICLES = Number(process.env.LOAD_ARTICLES || 2);
// a trip per album: a start point, then a few km a day
const STARTS = [[38.72, -9.14], [35.34, 25.13], [9.93, -84.08], [16.24, -61.53], [45.76, 4.84]];

const dms = (v) => {
  const a = Math.abs(v), d = Math.floor(a), m = Math.floor((a - d) * 60), s = Math.round(((a - d) * 60 - m) * 6000);
  return `${d}/1 ${m}/1 ${s}/100`;
};

// a landscape: sky and sea gradients, hills, a sun, some noise (so the JPEG
// is the size of a real photo, not a flat image)
async function photo(i, lat, lng, date) {
  const hue = (i * 47) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1067">
    <defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="hsl(${hue} 60% 70%)"/><stop offset="1" stop-color="hsl(${(hue + 40) % 360} 55% 40%)"/></linearGradient></defs>
    <rect width="1600" height="1067" fill="url(#s)"/>
    <circle cx="${300 + (i * 97) % 1000}" cy="260" r="120" fill="rgba(255,255,230,0.6)"/>
    <path d="M0 800 L${200 + i % 300} 560 L700 760 L1050 500 L1600 820 L1600 1067 L0 1067Z" fill="rgba(0,0,0,0.3)"/></svg>`;
  const noise = await sharp({ create: { width: 1600, height: 1067, channels: 3, noise: { type: 'gaussian', mean: 128, sigma: 28 } } })
    .png().toBuffer();
  return sharp(Buffer.from(svg))
    .composite([{ input: noise, blend: 'overlay' }])
    .jpeg({ quality: 85 })
    .withExif({
      IFD0: { Make: 'Load', Model: 'Test' },
      IFD2: { DateTimeOriginal: date },
      IFD3: { GPSLatitudeRef: lat >= 0 ? 'N' : 'S', GPSLatitude: dms(lat), GPSLongitudeRef: lng >= 0 ? 'E' : 'W', GPSLongitude: dms(lng) },
    })
    .toBuffer();
}

async function main() {
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: process.env.ADMIN_PASS }),
  });
  if (!login.ok) throw new Error(`admin login: HTTP ${login.status}`);
  const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const api = (path, method, body) => fetch(`${BASE}${path}`, {
    method, headers: { Cookie: cookie, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body && JSON.stringify(body),
  });

  for (let a = 0; a < ALBUMS; a++) {
    const album = `load-${a + 1}`;
    await api(`/api/admin/albums/${album}`, 'DELETE');
    const r = await api('/api/admin/albums', 'POST', { name: album });
    if (r.status !== 201) throw new Error(`album ${album}: HTTP ${r.status}`);
    const [lat0, lng0] = STARTS[a % STARTS.length];
    const fd = new FormData();
    for (let i = 0; i < PHOTOS; i++) {
      const day = Math.floor(i / 5);
      const date = `2025:0${1 + (a % 9)}:${String(1 + day).padStart(2, '0')} ${String(9 + (i % 5) * 2).padStart(2, '0')}:00:00`;
      const jpeg = await photo(a * PHOTOS + i, lat0 + day * 0.15 + (i % 5) * 0.004, lng0 + day * 0.2, date);
      fd.append('photos', new Blob([jpeg], { type: 'image/jpeg' }), `IMG_${String(i + 1).padStart(4, '0')}.jpg`);
    }
    const up = await fetch(`${BASE}/api/admin/albums/${album}/photos`, { method: 'POST', headers: { Cookie: cookie }, body: fd });
    if (!up.ok) throw new Error(`upload ${album}: HTTP ${up.status}`);
    for (let k = 0; k < ARTICLES; k++) {
      const files = Array.from({ length: 4 }, (_, j) => `IMG_${String(k * 5 + j + 1).padStart(4, '0')}.jpg`);
      const body = [
        'Une journée de **voyage**, racontée en quelques lignes, avec des *photos* et un [lien](https://www.openstreetmap.org).',
        `![Le départ](${files[0]})`,
        '## La suite', 'Le chemin continue le long de la côte, puis dans les collines.',
        files.slice(1).map((f) => `![](${f})`).join('\n'),
        '> Une citation pour finir.',
      ].join('\n\n');
      const c = await api('/api/admin/articles', 'POST', {
        album, title: `Jour ${k + 1} — ${album}`, summary: 'Un article du test de charge.', body,
        cover: files[0], place: 'Quelque part', date: `2025-0${1 + (a % 9)}-${String(1 + k).padStart(2, '0')}`, published: true,
      });
      if (c.status !== 201) throw new Error(`article: HTTP ${c.status}`);
    }
    console.log(`[load] ${album}: ${PHOTOS} photos, ${ARTICLES} articles`);
  }

  // every photo with its derivatives (made in the background after an upload)
  const deadline = Date.now() + 5 * 60_000;
  for (;;) {
    const albums = await (await fetch(`${BASE}/api/albums`)).json();
    let ready = 0, total = 0;
    for (const { name } of albums.filter((x) => x.name.startsWith('load-'))) {
      const { photos } = await (await fetch(`${BASE}/api/albums/${encodeURIComponent(name)}`)).json();
      total += photos.length;
      ready += photos.filter((p) => p.thumbUrl && p.previewUrl && p.mediumUrl).length;
    }
    if (total === ALBUMS * PHOTOS && ready === total) break;
    if (Date.now() > deadline) throw new Error(`derivatives: ${ready}/${total} ready after 5 min`);
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.log(`[load] ready: ${ALBUMS * PHOTOS} photos with their sizes`);
}

main().catch((err) => { console.error(`[load] ${err.message}`); process.exit(1); });
