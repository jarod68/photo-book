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

// ?at=2026-06-21T12:00:00Z fixes the sun, ?still stops the rotation (reproducible screenshots)
const params = new URLSearchParams(location.search);
const at = params.get('at') ? new Date(params.get('at')) : null;
const still = params.has('still');

async function init() {
  const photos = (await getMapPhotos().catch(() => [])).filter((p) => p.gps);
  countEl.textContent = photos.length
    ? t('map.photos', { n: photos.length, s: photos.length > 1 ? 's' : '' })
    : t('map.noPhotos');

  near = new NearView(nearEl, { photos, lang, t, onFar: goFar });
  space = new SpaceView(spaceEl, {
    photos, lang, at, still,
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
  window.addEventListener('resize', () => near.resize());
}

init();
showBuildTag();
