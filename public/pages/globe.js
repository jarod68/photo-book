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
import { distanceToZoom, zoomToDistance } from '../utils/globe-math.js';
import { loadTimezones, zoneIndexAt, zoneLabel, offsetMinutes } from '../utils/timezones.js';
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
  const now = at ?? new Date();
  names.forEach((name, i) => {
    const m = offsetMinutes(name, now);
    const c = m % 60 ? OFF_HOUR : HOUR_COLORS[(((m / 60) % 6) + 6) % 6];
    out.set([c[0] * 255, c[1] * 255, c[2] * 255, 255], (i + 1) * 4);
  });
  return out;
}

async function setTimezones(on) {
  tzOn = on;
  tzBtn.setAttribute('aria-pressed', String(on));
  try { localStorage.setItem(TZ_KEY, on ? '1' : '0'); } catch { /* private mode */ }
  creditEl.innerHTML = t('globe.credit') + (on ? ` · ${t('globe.tzCredit')}` : '');
  clearInterval(tzTimer);
  if (!on) { space.setTimezones(null); showTip(null); return; }
  const touch = matchMedia('(pointer: coarse)').matches;
  tz = await loadTimezones(touch ? 2048 : 4096);
  if (!tzOn) return;
  await space.setTimezones({ url: `/textures/earth/tz-index-${tz.index.width}.png`, width: tz.index.width, colors: zoneColors(tz.names) });
  // offsets change with summer time, and the card's clock moves on
  tzTimer = setInterval(() => { space.setTimezoneColors(zoneColors(tz.names)); if (tipPoint) showTip(tipPoint); }, 30_000);
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
  const z = zoneLabel(tz.names[n], at ?? new Date(), lang);
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
const still = params.has('still');

async function init() {
  const photos = (await getMapPhotos().catch(() => [])).filter((p) => p.gps);
  countEl.textContent = photos.length
    ? t('map.photos', { n: photos.length, s: photos.length > 1 ? 's' : '' })
    : t('map.noPhotos');

  near = new NearView(nearEl, { photos, lang, t, onFar: goFar, onPoint });
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
  spaceEl.addEventListener('globe-ready', () => {
    document.getElementById('globe-loading')?.remove();
    setTimeout(() => near.preload().catch(() => {}), 2500);   // MapLibre in the background
  }, { once: true });
  // handles for the end-to-end tests (tests/visual_tests/globe.spec.js)
  spaceEl.globeView = space;
  nearEl.globeView = near;

  // back up to space: zoom the map out, then switch
  document.getElementById('globe-up').addEventListener('click', async () => {
    if (state !== 'near' || busy) return;
    goFar(await near.zoomOut());
  });

  modesEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-mode]');
    if (!btn) return;
    modesEl.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
    near.setMode(btn.dataset.mode);
  });
  creditEl.innerHTML = t('globe.credit');
  tzBtn.addEventListener('click', () => setTimezones(!tzOn));
  let saved = null;
  try { saved = localStorage.getItem(TZ_KEY); } catch { /* private mode */ }
  if (saved === '1' || params.has('tz')) setTimezones(true);
  window.addEventListener('resize', () => near.resize());
}

init();
showBuildTag();
