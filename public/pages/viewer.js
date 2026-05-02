import { AlbumTabs }      from '../components/album-tabs.js';
import { ThumbnailStrip } from '../components/thumbnail-strip.js';
import { PhotoViewer }    from '../components/photo-viewer.js';

// ── State ─────────────────────────────────────────────────────────────────────
const state = {
  albums:  [],
  current: null,
  photos:  [],
  index:   -1,
};

// ── DOM ───────────────────────────────────────────────────────────────────────
const tabsEl   = document.getElementById('album-tabs');
const thumbsEl = document.getElementById('thumbnails');
const prevBtn  = document.getElementById('prev-btn');
const nextBtn  = document.getElementById('next-btn');

const viewer = new PhotoViewer({
  root:         document.getElementById('viewer'),
  pnlContainer: document.getElementById('pnl-container'),
  stdImg:       document.getElementById('std-img'),
  badge:        document.getElementById('badge-360'),
  nameEl:       document.getElementById('photo-name'),
  descEl:       document.getElementById('photo-desc'),
  panoControls: {
    wrapper:  document.getElementById('pano-controls'),
    zoomIn:   document.getElementById('pano-zoom-in'),
    zoomOut:  document.getElementById('pano-zoom-out'),
    recenter: document.getElementById('pano-recenter'),
  },
});

const tabs   = new AlbumTabs(tabsEl);
const thumbs = new ThumbnailStrip(thumbsEl, i => showPhoto(i), {
  prevBtn: document.getElementById('strip-prev'),
  nextBtn: document.getElementById('strip-next'),
});

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  const albums = await fetch('/api/albums').then(r => r.json());
  state.albums = albums;

  tabs.onSelect(name => selectAlbum(name));
  tabs.render(albums, null);

  const param   = new URLSearchParams(location.search).get('album');
  const initial = albums.find(a => a.name === param) ?? albums[0];
  if (initial) await selectAlbum(initial.name);
}

// ── Album selection ───────────────────────────────────────────────────────────
async function selectAlbum(name) {
  if (name === state.current) return;
  state.current = name;
  tabs.render(state.albums, name);

  const data   = await fetch(`/api/albums/${encodeURIComponent(name)}`).then(r => r.json());
  state.photos = data.photos;
  state.index  = -1;
  thumbs.render(state.photos);

  if (state.photos.length > 0) showPhoto(0);
}

// ── Photo display ─────────────────────────────────────────────────────────────
function showPhoto(index) {
  const photo = state.photos[index];
  if (!photo) return;

  state.index = index;
  updateNav();
  thumbs.activate(index);

  viewer.show(photo, () => {
    state.photos[index].is360 = true;
    thumbs.addBadge(index);
  });
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
