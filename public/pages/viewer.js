import { AlbumTabs }      from '../components/album-tabs.js';
import { ThumbnailStrip } from '../components/thumbnail-strip.js';
import { PhotoViewer }    from '../components/photo-viewer.js';
import { PhotoMap }       from '../components/photo-map.js';
import { AlbumMap }       from '../components/album-map.js';

// ── State ─────────────────────────────────────────────────────────────────────
const state = {
  albums:  [],
  current: null,
  photos:  [],
  index:   -1,
};

// ── DOM ───────────────────────────────────────────────────────────────────────
const tabsEl      = document.getElementById('album-tabs');
const thumbsEl    = document.getElementById('thumbnails');
const prevBtn     = document.getElementById('prev-btn');
const nextBtn     = document.getElementById('next-btn');
const albumMapBtn = document.getElementById('album-map-btn');
const locationEl  = document.getElementById('photo-location');

// ── Geocoding (lazy, cached on photo objects) ─────────────────────────────────
async function showLocation(photo) {
  // Priority 1: IPTC location already in metadata
  if (photo.location) {
    locationEl.textContent = photo.location;
    locationEl.classList.add('visible');
    return;
  }

  // Priority 2: reverse geocode from GPS (result cached on the photo object)
  if (photo.gps) {
    locationEl.textContent = '…';
    locationEl.classList.add('visible');
    try {
      const res  = await fetch(`/api/geocode?lat=${photo.gps.lat}&lng=${photo.gps.lng}`);
      const data = await res.json();
      photo.location = data.location || null; // cache on object for next visit
      if (photo.location) {
        locationEl.textContent = photo.location;
      } else {
        locationEl.classList.remove('visible');
      }
    } catch {
      locationEl.classList.remove('visible');
    }
    return;
  }

  locationEl.classList.remove('visible');
}

// ── UI toggle (single tap/click on photo) ─────────────────────────────────────
const appEl = document.getElementById('app');
function toggleUI() {
  appEl.classList.toggle('ui-hidden');
}

const viewer = new PhotoViewer({
  root:         document.getElementById('viewer'),
  pnlContainer: document.getElementById('pnl-container'),
  stdImg:       document.getElementById('std-img'),
  badge:        document.getElementById('badge-360'),
  nameEl:       document.getElementById('photo-name'),
  descEl:       document.getElementById('photo-desc'),
  onToggleUI:   toggleUI,
  onSwipe: dir => {
    if (dir === 'left'  && state.index < state.photos.length - 1) showPhoto(state.index + 1);
    if (dir === 'right' && state.index > 0)                       showPhoto(state.index - 1);
  },
  panoControls: {
    wrapper:  document.getElementById('pano-controls'),
    zoomIn:   document.getElementById('pano-zoom-in'),
    zoomOut:  document.getElementById('pano-zoom-out'),
    recenter: document.getElementById('pano-recenter'),
    gyroBtn:  document.getElementById('pano-gyro'),
  },
});

const tabs   = new AlbumTabs(tabsEl);
const thumbs = new ThumbnailStrip(thumbsEl, i => showPhoto(i), {
  prevBtn: document.getElementById('strip-prev'),
  nextBtn: document.getElementById('strip-next'),
});

const photoMap = new PhotoMap({
  miniEl:      document.getElementById('photo-map-mini'),
  miniCanvas:  document.getElementById('photo-map-canvas'),
  expandBtn:   document.getElementById('photo-map-expand'),
  modalEl:     document.getElementById('map-modal'),
  modalCanvas: document.getElementById('map-modal-canvas'),
  closeBtn:    document.getElementById('map-modal-close'),
  onSelect:    i => showPhoto(i),
});

const albumMap = new AlbumMap({
  overlayEl: document.getElementById('album-map-overlay'),
  canvasEl:  document.getElementById('album-map-canvas'),
  closeBtn:  document.getElementById('album-map-close'),
});

albumMapBtn.addEventListener('click', () => {
  albumMap.open(state.photos, state.index, i => showPhoto(i));
});

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  const albums = await fetch('/api/albums').then(r => r.json());
  state.albums = albums;

  tabs.onSelect(name => selectAlbum(name));
  tabs.render(albums, null);

  const params  = new URLSearchParams(location.search);
  const param   = params.get('album');
  const initial = albums.find(a => a.name === param) ?? albums[0];
  if (initial) await selectAlbum(initial.name, params.get('photo'));
}

// ── Album selection ───────────────────────────────────────────────────────────
async function selectAlbum(name, targetFilename = null) {
  if (name === state.current) return;
  state.current = name;
  tabs.render(state.albums, name);

  const data   = await fetch(`/api/albums/${encodeURIComponent(name)}`).then(r => r.json());
  state.photos = data.photos;
  state.index  = -1;
  thumbs.render(state.photos);

  albumMapBtn.disabled = !state.photos.some(p => p.gps);

  if (state.photos.length > 0) {
    const target = targetFilename
      ? (state.photos.findIndex(p => p.filename === targetFilename) || 0)
      : 0;
    showPhoto(Math.max(0, target));
  }
}

// ── Préchargement ─────────────────────────────────────────────────────────────
// On garde les refs Image en vie : certains navigateurs vident le cache HTTP
// si l'objet Image est collecté par le GC avant que le chargement soit utilisé.
const _preloaded = new Set();

function preloadPhoto(index) {
  const photo = state.photos[index];
  if (!photo?.url || _preloaded.has(photo.url)) return;
  _preloaded.add(photo.url);
  const img = new Image();
  img.src = photo.url;
}

// ── Photo display ─────────────────────────────────────────────────────────────
function showPhoto(index) {
  const photo = state.photos[index];
  if (!photo) return;

  // Rétablir l'UI si elle était cachée (changement de photo depuis la bande ou le clavier)
  appEl.classList.remove('ui-hidden');

  state.index = index;
  updateNav();
  thumbs.activate(index);
  photoMap.update(photo, index, state.photos);
  albumMap.setCurrent(index);
  showLocation(photo);

  viewer.show(photo, () => {
    state.photos[index].is360 = true;
    thumbs.addBadge(index);
  });

  // Précharger la photo suivante et précédente en arrière-plan
  preloadPhoto(index + 1);
  preloadPhoto(index - 1);
}

function updateNav() {
  prevBtn.disabled = state.index <= 0;
  nextBtn.disabled = state.index >= state.photos.length - 1;
}

// ── Navigation ────────────────────────────────────────────────────────────────
prevBtn.onclick = () => { if (state.index > 0) showPhoto(state.index - 1); };
nextBtn.onclick = () => { if (state.index < state.photos.length - 1) showPhoto(state.index + 1); };

document.addEventListener('keydown', e => {
  if (e.key === 'ArrowLeft')  prevBtn.click();
  if (e.key === 'ArrowRight') nextBtn.click();
});

// ── Start ─────────────────────────────────────────────────────────────────────
init();
