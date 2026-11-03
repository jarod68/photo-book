// Load test (k6): visitors browsing the site the way the pages do — the home
// page, an album in the viewer (thumbnails, photos, a view, a like), an
// article, the map, a search — ramping up to LOAD_VUS (50) at once, thinking
// a second or two between pages. The run fails when the thresholds below are
// not met: answers slower than budgeted at the 95th percentile, errors, or
// failed checks.
//
//   k6 run -e BASE_URL=http://localhost:3000 tests/load/browse.js
//
// Data: tests/load/seed.js (albums load-*, their photos and articles). The
// server's own rate limits are off in test mode (NODE_ENV=test): this is the
// app's capacity, not the limiter's.
import http from 'k6/http';
import { check, group, sleep } from 'k6';

const BASE = __ENV.BASE_URL || 'http://localhost:3000';
const VUS = Number(__ENV.LOAD_VUS || 50);

export const options = {
  scenarios: {
    visitors: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '20s', target: VUS },        // arriving
        { duration: '60s', target: VUS },        // all browsing
        { duration: '10s', target: 0 },          // leaving
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],                                   // < 1 % errors
    checks: ['rate>0.99'],
    'http_req_duration{kind:page}': ['p(95)<150'],                    // HTML, JS, CSS
    'http_req_duration{kind:api}': ['p(95)<400', 'p(99)<1000'],       // JSON
    'http_req_duration{kind:image}': ['p(95)<300'],                   // thumbnails, previews, medium
    'http_req_duration{kind:write}': ['p(95)<400'],                   // views, likes
  },
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

const randomItem = (list) => list[Math.floor(Math.random() * list.length)];
const randomIntBetween = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
const get = (path, kind, name = path) => http.get(`${BASE}${path}`, { tags: { kind, name } });
const ok = (res, what) => check(res, { [`${what}: 200`]: (r) => r.status === 200 });

// the albums and articles made by seed.js
export function setup() {
  const albums = http.get(`${BASE}/api/albums`).json().filter((a) => a.name.startsWith('load-'));
  if (!albums.length) throw new Error('no load-* album: run tests/load/seed.js first');
  const articles = http.get(`${BASE}/api/articles?limit=24`).json().filter((a) => a.album.startsWith('load-'));
  return { albums: albums.map((a) => a.name), articles: articles.map((a) => [a.album, a.slug]) };
}

export default function (data) {
  const token = `00000000-0000-4000-8000-${String(__VU).padStart(12, '0')}`;   // the visitor's anonymous id

  group('home', () => {
    ok(get('/', 'page', '/'), 'home page');
    get('/style.css', 'page');
    get('/pages/home.js', 'page');
    get('/api/auth/me', 'api');
    ok(get('/api/albums', 'api'), 'albums');
    ok(get('/api/articles?limit=6', 'api', '/api/articles?limit'), 'latest articles');
  });
  sleep(randomIntBetween(1, 2));

  const album = randomItem(data.albums);
  const a = encodeURIComponent(album);
  group('album', () => {
    get(`/viewer.html?album=${a}`, 'page', '/viewer.html');
    get('/pages/viewer.js', 'page');
    const res = get(`/api/albums/${a}`, 'api', '/api/albums/:album');
    ok(res, 'album');
    get(`/api/liked?album=${a}&token=${token}`, 'api', '/api/liked');
    const photos = res.status === 200 ? res.json('photos') : [];
    if (!photos.length) return;
    // the strip: a dozen thumbnails at once, as the browser loads them
    http.batch(photos.slice(0, 12).map((p) => ['GET', `${BASE}${p.thumbUrl}`, null, { tags: { kind: 'image', name: 'thumb' } }]))
      .forEach((r) => ok(r, 'thumbnail'));
    // then a few photos, one after the other
    for (let i = 0; i < 3; i++) {
      const p = randomItem(photos);
      ok(http.get(`${BASE}${p.mediumUrl || p.previewUrl}`, { tags: { kind: 'image', name: 'medium' } }), 'photo');
      const v = http.post(`${BASE}/api/view`, JSON.stringify({ album, filename: p.filename, token }),
        { headers: { 'Content-Type': 'application/json' }, tags: { kind: 'write', name: '/api/view' } });
      ok(v, 'view');
      sleep(randomIntBetween(1, 3) / 2);
    }
    if (Math.random() < 0.2) {
      const like = http.post(`${BASE}/api/like`, JSON.stringify({ album, filename: randomItem(photos).filename, token }),
        { headers: { 'Content-Type': 'application/json' }, tags: { kind: 'write', name: '/api/like' } });
      ok(like, 'like');
    }
  });
  sleep(randomIntBetween(1, 2));

  if (data.articles.length) {
    group('article', () => {
      const [al, slug] = randomItem(data.articles);
      get(`/article.html?album=${encodeURIComponent(al)}&a=${slug}`, 'page', '/article.html');
      get('/pages/article.js', 'page');
      const res = get(`/api/articles/${encodeURIComponent(al)}/${slug}`, 'api', '/api/articles/:album/:slug');
      ok(res, 'article');
      const photos = res.status === 200 ? Object.values(res.json('photos')) : [];
      http.batch(photos.slice(0, 4).map((p) => ['GET', `${BASE}${p.mediumUrl || p.previewUrl}`, null, { tags: { kind: 'image', name: 'medium' } }]))
        .forEach((r) => ok(r, 'article photo'));
    });
    sleep(randomIntBetween(1, 2));
  }

  if (Math.random() < 0.5) {
    group('map', () => {
      get('/map.html', 'page');
      ok(get('/api/map', 'api'), 'map');
    });
  } else {
    group('search', () => {
      get('/search.html', 'page');
      ok(get(`/api/search?q=${randomItem(['load', 'IMG', 'jour', '2025', 'quelque'])}`, 'api', '/api/search'), 'search');
    });
  }
  sleep(randomIntBetween(1, 3));
}
