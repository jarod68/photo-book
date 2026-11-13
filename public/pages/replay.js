// @ts-check
// A trip replayed (replay.html?album=…): the satellite globe, then the camera
// flies along the route from stop to stop (the stops and the route of the map
// and the globe: utils/replay-math.js), the line drawn behind it, and at each
// stop its photos appear with the day and the place; at the end, the whole
// trip and its figures. "Record the video" plays it again into a video file
// (MediaRecorder): the map's canvas and the captions' canvas, composed.
// ?speed=… (tests) and ?autoplay start it at once.
import { t, getLang, applyTranslations, initLangSwitcher } from '../utils/i18n.js';
import { getAlbum } from '../api/client.js';
import { loadMapLibre } from '../utils/base-map.js';
import { satelliteStyle } from '../components/globe/near-view.js';
import { buildStops, buildLegs, pointAlong, STOP_ZOOM, lift, legMs, ease } from '../utils/replay-math.js';
import { travelStats } from '../utils/travel-stats.js';
import { formatDay, formatDateRange } from '../utils/format.js';
import { wireBack } from '../utils/back.js';

applyTranslations();
initLangSwitcher('lang-switcher');

const params = new URLSearchParams(location.search);
const name   = params.get('album') ?? '';
const share  = params.get('share');
const withShare = (url) => (share && url ? `${url}${url.includes('?') ? '&' : '?'}share=${encodeURIComponent(share)}` : url);
const back = /** @type {HTMLAnchorElement} */ (document.querySelector('.map-page-back'));
back.href = withShare(`album.html?album=${encodeURIComponent(name)}`);
wireBack(back);

const $ = (id) => /** @type {any} */ (document.getElementById(id));
const stage = $('replay-stage'), overlay = /** @type {HTMLCanvasElement} */ ($('replay-overlay'));
const playBtn = $('replay-play'), speedSel = $('replay-speed'), recBtn = $('replay-record'), dl = $('replay-download');
const setState = (s) => { document.body.dataset.replay = s; };

const HOLD_MS = 2800;            // at a stop, its photos shown
const INTRO_MS = 3200, OUTRO_MS = 3000, END_MS = 3500;
const PITCH = 52;
const PHOTOS_SHOWN = 4;
const CREDIT = 'EOxCloudless 2024 (Copernicus Sentinel) · © OpenStreetMap';

let speed = Number(params.get('speed')) || 1;
if ([...speedSel.options].some((o) => Number(o.value) === speed)) speedSel.value = String(speed);

function message(text) {
  const el = $('replay-message');
  el.textContent = text;
  el.hidden = false;
}

// ── the clock: the replay's own time, which stops on pause and while the map
// loads its tiles (and the recording with it), and runs at the chosen speed ──
let playing = false, waiting = false, now = 0, last = 0;
/** @type {{ start: number, ms: number, fn: (u: number) => void, resolve: () => void } | null} */
let tween = null;
let generation = 0;
const CANCELLED = Symbol('cancelled');

/** fn(u) for u from 0 to 1 over ms (replay time). */
function animate(ms, fn, gen) {
  return new Promise((resolve, reject) => {
    fn(0);
    tween = { start: now, ms, fn, resolve: () => (gen === generation ? resolve() : reject(CANCELLED)) };
  });
}

// ── the overlay: captions and photos, drawn each frame ──
const ctx = overlay.getContext('2d');
/** What the overlay shows: the title, the current stop's card, the end card. */
const scene = { title: '', sub: '', card: null, cardAt: 0, end: null, endAt: 0 };

function resize() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  overlay.width = Math.round(stage.clientWidth * dpr);
  overlay.height = Math.round(stage.clientHeight * dpr);
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

// The image cut to fill w×h (object-fit: cover).
function drawCover(img, x, y, w, h) {
  if (!img?.complete || !img.naturalWidth) {
    ctx.fillStyle = '#222';
    ctx.fillRect(x, y, w, h);
    return;
  }
  const s = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const sw = w / s, sh = h / s;
  ctx.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, x, y, w, h);
}

function text(str, x, y, size, { weight = 600, color = '#fff', align = 'left', alpha = 1 } = {}) {
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.font = `${weight} ${size}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  ctx.textAlign = /** @type {CanvasTextAlign} */ (align);
  ctx.fillStyle = color;
  ctx.shadowColor = 'rgba(0,0,0,0.7)';
  ctx.shadowBlur = size / 3;
  ctx.fillText(str, x, y);
  ctx.restore();
}

function drawOverlay() {
  const W = overlay.width, H = overlay.height, u = Math.min(W, H) / 100;
  ctx.clearRect(0, 0, W, H);
  // a soft dark band at the top and the bottom, for the text
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, 'rgba(0,0,0,0.45)'); g.addColorStop(0.18, 'rgba(0,0,0,0)');
  g.addColorStop(0.7, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.5)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  text(scene.title, 3 * u, 7 * u, 4.6 * u, { weight: 700 });
  if (scene.sub) text(scene.sub, 3 * u, 11 * u, 2.4 * u, { weight: 500, color: 'rgba(255,255,255,0.8)' });
  text(CREDIT, W - 1.5 * u, H - 1.5 * u, 1.3 * u, { weight: 400, color: 'rgba(255,255,255,0.6)', align: 'right' });

  if (scene.card) {
    const a = Math.min(1, (now - scene.cardAt) / 500);
    const k = ease(a);
    const { imgs, caption, place } = scene.card;
    // the photos, side by side, tilted like prints laid on the map
    const n = imgs.length, size = Math.min(32 * u, (W * 0.8) / Math.max(n, 1));
    const gap = size * 0.08, total = n * size + (n - 1) * gap;
    const y0 = H - 9 * u - size;
    imgs.forEach((img, i) => {
      const d = Math.max(0, Math.min(1, (now - scene.cardAt - i * 140) / 450));
      const s = ease(d);
      if (!s) return;
      const cx = (W - total) / 2 + i * (size + gap) + size / 2, cy = y0 + size / 2;
      ctx.save();
      ctx.globalAlpha = s;
      ctx.translate(cx, cy + (1 - s) * size * 0.25);
      ctx.rotate(((i % 2 ? 1 : -1) * (2 + (i % 3)) * Math.PI) / 180);
      ctx.scale(0.85 + 0.15 * s, 0.85 + 0.15 * s);
      ctx.shadowColor = 'rgba(0,0,0,0.55)';
      ctx.shadowBlur = size * 0.08;
      ctx.fillStyle = '#fafafa';
      const b = size * 0.04;
      roundRect(-size / 2, -size / 2, size, size, size * 0.03);
      ctx.fill();
      ctx.shadowColor = 'transparent';
      drawCover(img, -size / 2 + b, -size / 2 + b, size - 2 * b, size - 2 * b);
      ctx.restore();
    });
    text(caption, W / 2, H - 4.6 * u, 3.2 * u, { weight: 700, align: 'center', alpha: k });
    if (place) text(place, W / 2, H - 1.8 * u - 0.6 * u, 2.2 * u, { weight: 500, color: 'rgba(255,255,255,0.85)', align: 'center', alpha: k });
  }

  if (scene.end) {
    const k = ease(Math.min(1, (now - scene.endAt) / 700));
    ctx.save();
    ctx.globalAlpha = k * 0.55;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
    text(scene.end.title, W / 2, H / 2 - 4 * u, 7 * u, { weight: 800, align: 'center', alpha: k });
    text(scene.end.figures, W / 2, H / 2 + 4 * u, 3.4 * u, { weight: 600, align: 'center', alpha: k, color: '#ffb48f' });
    if (scene.end.dates) text(scene.end.dates, W / 2, H / 2 + 9 * u, 2.4 * u, { weight: 500, align: 'center', alpha: k, color: 'rgba(255,255,255,0.8)' });
  }
}

// ── the video: the map's canvas and the overlay, composed on a third canvas ──
/** @type {{ canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, rec: MediaRecorder, chunks: Blob[], type: string } | null} */
let recording = null;

function videoType() {
  const types = ['video/mp4;codecs=avc1.42E01E', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  return typeof MediaRecorder === 'undefined' ? null : types.find((x) => MediaRecorder.isTypeSupported(x)) ?? null;
}

function composeFrame(map) {
  if (!recording) return;
  const src = map.getCanvas(), c = recording.canvas;
  if (c.width !== src.width || c.height !== src.height) { c.width = src.width; c.height = src.height; }
  recording.ctx.drawImage(src, 0, 0, c.width, c.height);
  recording.ctx.drawImage(overlay, 0, 0, c.width, c.height);
}

// ── the replay ──
function dayOf(stops, i) {
  const t0 = Date.parse(stops[0].date ?? ''), ti = Date.parse(stops[i].date ?? '');
  if (Number.isNaN(t0) || Number.isNaN(ti)) return null;
  return Math.floor(ti / 864e5) - Math.floor(t0 / 864e5) + 1;
}

// The place most of the stop's photos were taken at ("Lisboa, Portugal").
function placeOf(stop) {
  const count = new Map();
  for (const p of stop.photos) if (p.location) count.set(p.location, (count.get(p.location) ?? 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
}

function loadImage(url) {
  const img = new Image();
  img.decoding = 'async';
  img.src = withShare(url);
  return img;
}

async function init() {
  document.title = `${t('replay.title')} — ${name} — Photo Book`;
  let album;
  try {
    album = await getAlbum(name, share);
  } catch {
    setState('error');
    message(t('art.notFound'));
    return;
  }
  const photos = album.photos.filter((p) => p.gps);
  const stops = buildStops(photos);
  document.body.dataset.stops = String(stops.length);
  if (stops.length < 2) {
    setState('error');
    message(t('replay.tooFew'));
    return;
  }
  const legs = buildLegs(stops);
  const stats = travelStats(album.photos);
  const fmt = new Intl.NumberFormat(getLang());
  const dates = album.photos.map((p) => p.takenAt).filter(Boolean).sort();
  const range = formatDateRange(dates[0], dates[dates.length - 1]);
  scene.title = name;
  scene.sub = range;
  // each stop's photos (the first few), loading while the replay starts
  const stopImgs = stops.map((s) => s.photos.slice(0, PHOTOS_SHOWN).map((p) => loadImage(p.previewUrl || p.thumbUrl)));

  resize();
  addEventListener('resize', resize);
  let ml, map;
  try {
    ml = await loadMapLibre();
    map = new ml.Map({
      container: 'replay-map', style: satelliteStyle(getLang()),
      center: [stops[0].lng, stops[0].lat], zoom: 1.6, interactive: false,
      attributionControl: { compact: true }, fadeDuration: 0,
      // the video reads the map's pixels
      canvasContextAttributes: { preserveDrawingBuffer: true },
    });
  } catch (err) {
    console.error(err);
    setState('error');
    message(t('replay.noWebgl'));
    return;
  }
  map.on('error', (e) => console.warn('replay map:', e?.error?.message ?? e));
  await new Promise((r) => map.once('load', r));
  map.addSource('trail', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] }, properties: {} } });
  map.addSource('stops', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({ id: 'trail-glow', type: 'line', source: 'trail', layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#ff8a5b', 'line-width': 9, 'line-opacity': 0.25, 'line-blur': 4 } });
  map.addLayer({ id: 'trail', type: 'line', source: 'trail', layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#ffb48f', 'line-width': 3 } });
  map.addLayer({ id: 'stops', type: 'circle', source: 'stops',
    paint: { 'circle-radius': 6, 'circle-color': '#ff8a5b', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });

  // the line drawn so far ([lng, lat]), and the stops reached
  let trail = [], reached = [];
  const drawTrail = (extra = []) => map.getSource('trail').setData({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [...trail, ...extra] } });
  const drawStops = () => map.getSource('stops').setData({ type: 'FeatureCollection',
    features: reached.map((s) => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [s.lng, s.lat] } })) });

  const angle = (from, to) => ((to - from + 540) % 360) - 180;
  const progress = (i, frac = 0) => {
    $('replay-progress-bar').style.width = `${Math.round(((i + frac) / stops.length) * 100)}%`;
    $('replay-step').textContent = `${Math.min(i + 1, stops.length)} / ${stops.length}`;
  };

  // until the tiles of the place are in (at most a few seconds): the clock and the recording wait
  async function settle() {
    waiting = true;
    recording?.rec.state === 'recording' && recording.rec.pause();
    await new Promise((r) => {
      if (map.areTilesLoaded()) return r();
      map.once('idle', r);
      setTimeout(r, 6000);
    });
    recording?.rec.state === 'paused' && recording.rec.resume();
    waiting = false;
  }

  async function run(gen) {
    const step = (ms, fn) => animate(ms, fn, gen);
    trail = []; reached = []; drawTrail(); drawStops();
    scene.card = null; scene.end = null;
    progress(0);
    // the globe, then down to the first stop
    const first = stops[0];
    map.jumpTo({ center: [first.lng, first.lat], zoom: 1.6, pitch: 0, bearing: 0 });
    await settle();
    let bearing = 0;
    await step(INTRO_MS, (u) => {
      const e = ease(u);
      map.jumpTo({ center: [first.lng, first.lat], zoom: 1.6 + (STOP_ZOOM - 1.6) * e, pitch: PITCH * e, bearing: 0 });
    });
    for (let i = 0; i < stops.length; i++) {
      const stop = stops[i];
      reached.push(stop); drawStops();
      trail.push([stop.lng, stop.lat]); drawTrail();
      progress(i);
      await settle();
      // its photos, the day and the place; the camera turns slowly
      const day = dayOf(stops, i);
      const date = stop.date ? formatDay(String(stop.date).slice(0, 10)) : '';
      scene.card = {
        imgs: stopImgs[i],
        caption: [day ? t('replay.day', { n: day }) : null, date].filter(Boolean).join(' — '),
        place: placeOf(stop),
      };
      scene.cardAt = now;
      const b0 = bearing;
      await step(HOLD_MS, (u) => {
        bearing = b0 + 8 * u;
        map.jumpTo({ center: [stop.lng, stop.lat], zoom: STOP_ZOOM, pitch: PITCH, bearing });
      });
      scene.card = null;
      const leg = legs[i];
      if (!leg) break;
      // to the next stop: along the route (up and down again with its length);
      // between two trips, a jump (no line)
      const rise = leg.jump ? Math.min(STOP_ZOOM - 2, lift(leg.km) + 2) : lift(leg.km);
      const from = bearing;
      await step(legMs(leg.km), (u) => {
        const e = ease(u);
        const p = pointAlong(leg.points, e);
        const ahead = pointAlong(leg.points, Math.min(1, e + 0.08));
        const want = leg.jump ? from : p.heading + angle(p.heading, ahead.heading) / 2;
        bearing += angle(bearing, want) * 0.06;
        map.jumpTo({ center: [p.lng, p.lat], zoom: STOP_ZOOM - rise * Math.sin(Math.PI * u), pitch: PITCH - 15 * Math.sin(Math.PI * u), bearing });
        if (!leg.jump) drawTrail(leg.points.slice(1, p.index).map(([la, ln]) => [ln, la]).concat([[p.lng, p.lat]]));
        progress(i, u);
      });
      if (!leg.jump) trail.push(...leg.points.slice(1).map(([la, ln]) => [ln, la]));
      else trail = [[stops[i + 1].lng, stops[i + 1].lat]];
    }
    // the whole trip, from above, and its figures
    const lngs = stops.map((s) => s.lng), lats = stops.map((s) => s.lat);
    const cam = map.cameraForBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
      { padding: Math.min(stage.clientWidth, stage.clientHeight) * 0.18 }) ?? { center: map.getCenter(), zoom: 3 };
    const c0 = map.getCenter(), z0 = map.getZoom(), p0 = map.getPitch(), b0 = map.getBearing();
    const c1 = ml.LngLat.convert(cam.center), z1 = Math.min(cam.zoom, STOP_ZOOM);
    await step(OUTRO_MS, (u) => {
      const e = ease(u);
      map.jumpTo({ center: [c0.lng + (c1.lng - c0.lng) * e, c0.lat + (c1.lat - c0.lat) * e],
        zoom: z0 + (z1 - z0) * e, pitch: p0 * (1 - e), bearing: b0 + angle(b0, 0) * e });
    });
    progress(stops.length);
    await settle();
    scene.end = {
      title: name,
      figures: [
        stats.days > 1 && stats.days <= 120 ? t('stats.days', { n: stats.days, s: 's' }) : null,
        stats.countries.length ? t(stats.countries.length > 1 ? 'stats.countries' : 'stats.country', { n: stats.countries.length }) : null,
        stats.km >= 1 ? t('stats.km', { n: fmt.format(stats.km) }) : null,
        t('album.photos', { n: album.photos.length, s: album.photos.length > 1 ? 's' : '' }),
      ].filter(Boolean).join('  ·  '),
      dates: range,
    };
    scene.endAt = now;
    await step(END_MS, () => {});
  }

  // each frame: the clock, the current animation, the overlay, the video
  function frame(ts) {
    const dt = last ? Math.min(ts - last, 100) : 0;
    last = ts;
    if (playing && !waiting) now += dt * speed;
    if (tween && !waiting) {
      const u = Math.min(1, (now - tween.start) / tween.ms);
      tween.fn(u);
      if (u >= 1) { const done = tween; tween = null; done.resolve(); }
    }
    drawOverlay();
    if (recording) { map.redraw(); composeFrame(map); }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  const showPlaying = () => playBtn.classList.toggle('replay-play--on', playing);
  async function start({ record = false } = {}) {
    const gen = ++generation;
    tween = null;
    if (record) beginRecording();
    playing = true; showPlaying();
    setState('playing');
    try {
      await run(gen);
    } catch (err) {
      if (err === CANCELLED) return;
      throw err;
    }
    if (gen !== generation) return;
    playing = false; showPlaying();
    setState('done');
    if (recording) endRecording();
  }

  function beginRecording() {
    const type = videoType();
    if (!type) return;
    dl.hidden = true;
    const canvas = document.createElement('canvas');
    const rctx = canvas.getContext('2d');
    recording = { canvas, ctx: rctx, rec: null, chunks: [], type };
    composeFrame(map);
    const rec = new MediaRecorder(canvas.captureStream(30), { mimeType: type, videoBitsPerSecond: 8_000_000 });
    rec.ondataavailable = (e) => e.data.size && recording?.chunks.push(e.data);
    recording.rec = rec;
    rec.start(1000);
    recBtn.classList.add('replay-record--on');
    recBtn.disabled = true;
  }

  function endRecording() {
    const r = recording;
    if (!r) return;
    r.rec.onstop = () => {
      const blob = new Blob(r.chunks, { type: r.type.split(';')[0] });
      if (dl.href) URL.revokeObjectURL(dl.href);
      dl.href = URL.createObjectURL(blob);
      dl.download = `${name.replace(/[\\/:*?"<>|]+/g, '_')}.${r.type.startsWith('video/mp4') ? 'mp4' : 'webm'}`;
      dl.hidden = false;
    };
    r.rec.stop();
    recording = null;
    recBtn.classList.remove('replay-record--on');
    recBtn.disabled = false;
  }

  playBtn.disabled = false;
  recBtn.disabled = !videoType();
  if (!videoType()) recBtn.title = t('replay.noRecord');
  playBtn.addEventListener('click', () => {
    if (document.body.dataset.replay !== 'playing') { start(); return; }
    // no pause while recording: the video would hold the frozen frame
    if (recording) return;
    playing = !playing;
    showPlaying();
  });
  speedSel.addEventListener('change', () => { speed = Number(speedSel.value) || 1; });
  recBtn.addEventListener('click', () => {
    if (recording) return;
    start({ record: true });
  });
  setState('ready');
  if (params.has('autoplay')) start();
}

init();
