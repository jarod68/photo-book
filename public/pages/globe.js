// @ts-check
/**
 * Globe page: the Earth from space (Three.js, components/globe/space-view.js)
 * and, closer than ~1 400 km, the satellite / street map (MapLibre GL,
 * components/globe/near-view.js). Zooming in or clicking a photo goes down;
 * zooming out of the map comes back up. Both views show the globe at the same
 * apparent size at the switch (utils/globe-math.js), so a short cross-fade
 * hides it.
 */
import { t, getLang, applyTranslations, initLangSwitcher } from '../utils/i18n.js';
import '../utils/admin-shortcut.js';
import { getMapPhotos } from '../api/client.js';
import { showBuildTag } from '../utils/build-tag.js';
import { wireBack, pageState, saveState } from '../utils/back.js';
import { distanceToZoom, zoomToDistance } from '../utils/globe-math.js';
import { loadTimezones, loadBorders, zoneIndexAt, zoneLabel, offsetMinutes } from '../utils/timezones.js';
import { SpaceView, FOV, NEAR_DISTANCE } from '../components/globe/space-view.js';
import { NearView, FAR_ZOOM } from '../components/globe/near-view.js';

applyTranslations();
initLangSwitcher('lang-switcher');

const spaceEl  = document.getElementById('globe-space');
const nearEl   = document.getElementById('globe-near');
const countEl  = document.getElementById('globe-count');
const modesEl  = document.getElementById('globe-modes');
const creditEl = document.getElementById('globe-credit');
const lang     = getLang();

const tzBtn    = document.getElementById('globe-tz-btn');
const tzTip    = document.getElementById('globe-tz-tip');
const TZ_KEY   = 'pb.globeTimezones';
const routeBtn = document.getElementById('globe-route-btn');
const ROUTE_KEY = 'pb.globeRoute';

let state = 'space';
let busy  = false;
let space, near;

const height = () => spaceEl.clientHeight || window.innerHeight;
const fade = () => new Promise((r) => setTimeout(r, 450));    // matches the CSS transition

// `then`: once the map shows, fly to a photo ({ photo }) or frame a group ({ group }).
async function goNear({ lat, lng, distance }, then = {}) {
  if (state === 'near' || busy) return;
  busy = true;
  document.body.classList.add('globe-switching');
  try {
    await near.show({ lat, lng, zoom: distanceToZoom(distance, height(), FOV) });
    state = 'near';
    document.body.classList.add('globe-is-near');
    document.body.classList.remove('globe-switching');
    await fade();
    space.pause();
    if (then.photo) await near.flyToPhoto(then.photo);
    else if (then.group) await near.fitPhotos(then.group);
  } catch (err) {
    // tiles or MapLibre unavailable: stay in space, a little farther out
    console.error('Near view unavailable:', err);
    document.body.classList.remove('globe-is-near');
    state = 'space';
    space.setView(lat, lng, NEAR_DISTANCE * 1.15);
  } finally {
    busy = false;
    document.body.classList.remove('globe-switching');
  }
}

async function goFar({ lat, lng, zoom }) {
  if (state === 'space' || busy) return;
  busy = true;
  space.setView(lat, lng, Math.max(zoomToDistance(Math.min(zoom, FAR_ZOOM), height(), FOV), NEAR_DISTANCE * 1.12));
  space.resume();
  state = 'space';
  document.body.classList.remove('globe-is-near');
  await fade();
  busy = false;
}

// ── Time zones (optional overlay, local time on hover / tap) ─────────────────

let tz = null;            // { names, index } once loaded
let tzOn = false;
let tzTimer = null;
let tipPoint = null;      // last point shown in the card
let tipSticky = false;    // shown by a tap (touch screens): stays until the next tap

// One colour per zone from its current offset: six distinct hues in turn, so
// neighbouring hours never look alike; zones off the hour (India, Nepal,
// Newfoundland…) in gold.
const HOUR_COLORS = [[0.30, 0.62, 1.00], [0.25, 0.85, 0.75], [0.55, 0.90, 0.35], [1.00, 0.72, 0.30], [1.00, 0.42, 0.45], [0.75, 0.48, 1.00]];
const OFF_HOUR = [1.0, 0.86, 0.25];
function zoneColors(names) {
  const out = new Uint8Array(512 * 4);
  const now = simNow();
  names.forEach((name, i) => {
    const m = offsetMinutes(name, now);
    const c = m % 60 ? OFF_HOUR : HOUR_COLORS[(((m / 60) % 6) + 6) % 6];
    out.set([c[0] * 255, c[1] * 255, c[2] * 255, 255], (i + 1) * 4);
  });
  return out;
}

// Borders where the hour changes now (summer time moves some): redrawn only
// when that set changes.
let bordersKey = '';
let tzBorders = null;     // the decoded borders, once loaded
function drawBorders(borders) {
  const now = simNow();
  const offsets = tz.names.map((n) => offsetMinutes(n, now));
  const shown = borders.filter((b) => offsets[b.a] !== offsets[b.b]);
  const key = shown.length + ':' + offsets.join(',');
  if (key === bordersKey) return;
  bordersKey = key;
  space.setTimezoneBorders(shown);
}

async function setTimezones(on) {
  tzOn = on;
  tzBtn.setAttribute('aria-pressed', String(on));
  try { localStorage.setItem(TZ_KEY, on ? '1' : '0'); } catch { /* private mode */ }
  creditEl.innerHTML = t('globe.credit') + (on ? ` · ${t('globe.tzCredit')}` : '');
  clearInterval(tzTimer);
  if (!on) { space.setTimezones(null); showTip(null); return; }
  const touch = matchMedia('(pointer: coarse)').matches;
  const [zones, borders] = await Promise.all([loadTimezones(touch ? 2048 : 4096), loadBorders()]);
  tz = zones;
  tzBorders = borders;
  if (!tzOn) return;
  await space.setTimezones({ url: `/textures/earth/tz-index-${tz.index.width}.png`, width: tz.index.width, colors: zoneColors(tz.names) });
  drawBorders(borders);
  // offsets change with summer time, and the card's clock moves on
  tzTimer = setInterval(() => {
    space.setTimezoneColors(zoneColors(tz.names));
    drawBorders(borders);
    if (tipPoint) showTip(tipPoint);
  }, 30_000);
}

function showTip(p) {
  if (!tzOn || !tz || !p) {
    tzTip.hidden = true;
    tipPoint = null;
    space.setTimezoneHover(0);
    return;
  }
  const n = zoneIndexAt(tz.index, p.lat, p.lng);
  if (n < 0) { showTip(null); return; }
  tipPoint = p;
  const z = zoneLabel(tz.names[n], simNow(), lang);
  tzTip.innerHTML = `<strong>${z.time}</strong><span>${z.place ? `${z.place} · ` : ''}${z.offset}</span><small>${z.day}</small>`;
  const box = document.getElementById('globe-container').getBoundingClientRect();
  const x = Math.min(p.x - box.left + 16, box.width - 180), y = Math.max(8, p.y - box.top - 70);
  tzTip.style.transform = `translate(${x}px, ${y}px)`;
  tzTip.hidden = false;
  space.setTimezoneHover(n + 1);
}

// hover: follow the pointer; tap (touch): show until the next tap
function onPoint(p) {
  if (p?.tap) {
    // a second tap in the same zone closes the card
    const same = tipPoint && tz && zoneIndexAt(tz.index, p.lat, p.lng) === zoneIndexAt(tz.index, tipPoint.lat, tipPoint.lng);
    tipSticky = !same;
    showTip(same ? null : p);
    return;
  }
  if (tipSticky) return;
  showTip(p);
}

// ?at=2026-06-21T12:00:00Z fixes the sun, ?still stops the rotation (reproducible screenshots)
const params = new URLSearchParams(location.search);
const at = params.get('at') ? new Date(params.get('at')) : null;

// ── Time slider: the Earth, its sky and the clocks up to 72 h back or ahead ────
// The offset is added to the clock (or to ?at=), so simulated time keeps
// running; the space view moves its sun, terminator, Moon and planets, the
// time zones their colours, borders and card. Kept for Back (history state).
let offsetMs = 0;
const simNow = () => new Date((at ? at.getTime() : Date.now()) + offsetMs);
const timeRange = /** @type {HTMLInputElement} */ (document.getElementById('globe-time-range'));
const timeLabel = document.getElementById('globe-time-label');
const timeNowBtn = document.getElementById('globe-time-now');
// the viewer's own time, its zone named ("14:00 UTC+2")
const timeFmt = new Intl.DateTimeFormat(lang, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });

/** "+5 h", "−12 h 30", "" for now. */
function offsetText(hours) {
  if (!hours) return '';
  const m = Math.round(Math.abs(hours) * 60);
  return `${hours > 0 ? '+' : '−'}${Math.floor(m / 60)} h${m % 60 ? ` ${String(m % 60).padStart(2, '0')}` : ''}`;
}

function showTime() {
  const hours = offsetMs / 3600e3;
  const off = offsetText(hours);
  timeLabel.innerHTML = `<strong>${timeFmt.format(simNow())}</strong> <span>${off || t('globe.timeNow')}</span>`;
  timeNowBtn.hidden = !hours;
  document.getElementById('globe-time').classList.toggle('globe-time--moved', !!hours);
  // the filled part of the track runs from "now" (the middle) to the thumb
  const pct = ((hours + 72) / 144) * 100;
  timeRange.style.setProperty('--from', `${Math.min(50, pct)}%`);
  timeRange.style.setProperty('--to', `${Math.max(50, pct)}%`);
}

let timeFrame = 0;
function setOffset(hours) {
  offsetMs = Math.round(hours * 4) * 15 * 60e3;   // 15-minute steps
  timeRange.value = String(offsetMs / 3600e3);
  showTime();
  saveState({ globeOffset: offsetMs });
  if (timeFrame) return;
  timeFrame = requestAnimationFrame(() => {          // at most once a frame while dragging
    timeFrame = 0;
    space?.setTimeOffset(offsetMs);
    if (tzOn && tz) {
      space.setTimezoneColors(zoneColors(tz.names));
      if (tzBorders) drawBorders(tzBorders);
      if (tipPoint) showTip(tipPoint);
    }
  });
}
timeRange.addEventListener('input', () => setOffset(Number(timeRange.value)));
timeNowBtn.addEventListener('click', () => setOffset(0));
// the clock moves on: refresh the label every minute (shown at once, before the 3D view)
setInterval(showTime, 60_000);
showTime();
const still = params.has('still');

async function init() {
  const photos = (await getMapPhotos().catch(() => [])).filter((p) => p.gps);
  countEl.textContent = photos.length
    ? t('map.photos', { n: photos.length, s: photos.length > 1 ? 's' : '' })
    : t('map.noPhotos');

  // the route between the photos, as on the map page (on unless turned off):
  // drawn close up only, so by the near view
  let routeOn = true;
  try { routeOn = localStorage.getItem(ROUTE_KEY) !== '0'; } catch { /* private mode */ }
  near = new NearView(nearEl, { photos, lang, t, onFar: goFar, onPoint, route: routeOn });
  space = new SpaceView(spaceEl, {
    photos, lang, at, still, onPoint,
    onNear: (view) => goNear(view),
    onPhoto: async (photo) => {
      if (busy) return;
      if (await space.flyTo(photo.gps.lat, photo.gps.lng, NEAR_DISTANCE * 0.98, 1800)) goNear(space.view(), { photo });
    },
    onGroup: async (photos, { lat, lng }) => {
      if (busy) return;
      if (await space.flyTo(lat, lng, NEAR_DISTANCE * 0.98, 1800)) goNear(space.view(), { group: photos });
    },
  });
  // back from a photo: the globe where it was (seen from space; close up, just
  // above the same spot)
  const lastView = pageState().globe;
  if (lastView) space.setView(lastView.lat, lastView.lng, Math.max(lastView.distance, NEAR_DISTANCE * 1.12));
  setOffset((pageState().globeOffset ?? 0) / 3600e3);   // and the time it showed
  addEventListener('pagehide', () => {
    if (state === 'near' && near.map) {
      const c = near.map.getCenter();
      saveState({ globe: { lat: c.lat, lng: c.lng, distance: zoomToDistance(near.map.getZoom(), height(), FOV) } });
    } else saveState({ globe: space.view() });
  });
  wireBack(document.querySelector('.globe-back'));

  spaceEl.addEventListener('globe-ready', () => {
    document.getElementById('globe-loading')?.remove();
    setTimeout(() => near.preload().catch(() => {}), 2500);   // MapLibre in the background
  }, { once: true });
  // handles for the end-to-end tests (tests/visual_tests/globe.spec.js)
  /** @type {any} */ (spaceEl).globeView = space;
  /** @type {any} */ (nearEl).globeView = near;

  // back up to space: zoom the map out, then switch
  document.getElementById('globe-up').addEventListener('click', async () => {
    if (state !== 'near' || busy) return;
    goFar(await near.zoomOut());
  });

  modesEl.addEventListener('click', (e) => {
    const btn = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('[data-mode]'));
    if (!btn) return;
    modesEl.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
    near.setMode(btn.dataset.mode);
  });
  creditEl.innerHTML = t('globe.credit');
  const showRoute = (on) => {
    routeOn = on;
    near.setRoute(on);
    routeBtn.setAttribute('aria-pressed', String(on));
    routeBtn.title = t(on ? 'map.hideRoute' : 'map.showRoute');
    try { localStorage.setItem(ROUTE_KEY, on ? '1' : '0'); } catch { /* private mode */ }
  };
  showRoute(routeOn);
  routeBtn.addEventListener('click', () => showRoute(!routeOn));
  tzBtn.addEventListener('click', () => setTimezones(!tzOn));
  let saved = null;
  try { saved = localStorage.getItem(TZ_KEY); } catch { /* private mode */ }
  if (saved === '1' || params.has('tz')) setTimezones(true);
  window.addEventListener('resize', () => near.resize());
}

init();
showBuildTag();
