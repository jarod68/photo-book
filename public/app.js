/* ── State ───────────────────────────────────────────────────────────────────── */
const state = {
  albums:       [],
  currentAlbum: null,
  photos:       [],
  index:        -1,
  pnlViewer:    null,
};

/* ── DOM ─────────────────────────────────────────────────────────────────────── */
const $ = id => document.getElementById(id);

const albumTabs = $('album-tabs');
const pnlEl     = $('pnl-container');
const stdImg    = $('std-img');
const badge360  = $('badge-360');
const photoName = $('photo-name');
const photoDesc = $('photo-desc');
const prevBtn   = $('prev-btn');
const nextBtn   = $('next-btn');
const thumbsEl  = $('thumbnails');
const loader    = $('loader');

/* ── Bootstrap ───────────────────────────────────────────────────────────────── */
async function init() {
  try {
    const albums = await fetch('/api/albums').then(r => r.json());
    state.albums = albums;
    renderAlbumTabs();
    if (albums.length > 0) {
      await selectAlbum(albums[0].name);
    } else {
      viewerMessage('Add folders to photos/ to create albums');
    }
  } catch (err) {
    viewerMessage('Impossible de charger les albums');
    console.error(err);
  }
}

/* ── Album tabs ──────────────────────────────────────────────────────────────── */
function renderAlbumTabs() {
  albumTabs.innerHTML = '';
  state.albums.forEach(album => {
    const btn = document.createElement('button');
    btn.className = 'album-tab' + (album.name === state.currentAlbum ? ' active' : '');
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', album.name === state.currentAlbum);
    btn.innerHTML = `${album.name}<span class="count">${album.count}</span>`;
    btn.onclick = () => selectAlbum(album.name);
    albumTabs.appendChild(btn);
  });
}

async function selectAlbum(name) {
  if (name === state.currentAlbum) return;
  state.currentAlbum = name;
  renderAlbumTabs();
  clearViewerMessage();
  setLoading(true);

  try {
    const data    = await fetch(`/api/albums/${encodeURIComponent(name)}`).then(r => r.json());
    state.photos  = data.photos;
    state.index   = -1;
    renderThumbs();

    if (state.photos.length > 0) {
      showPhoto(0);
    } else {
      setLoading(false);
      viewerMessage(`L'album "${name}" ne contient aucune photo`);
    }
  } catch (err) {
    setLoading(false);
    console.error(err);
  }
}

/* ── Photo display ───────────────────────────────────────────────────────────── */
function showPhoto(index) {
  const photo = state.photos[index];
  if (!photo) return;

  state.index = index;
  updateNav();
  activateThumb(index);

  photoName.textContent = photo.name;
  photoDesc.textContent = photo.description;
  badge360.classList.toggle('visible', photo.is360);

  if (photo.is360) {
    show360(photo.url);
  } else {
    showStandard(photo.url);
  }
}

function show360(url) {
  pnlEl.style.display = 'block';
  stdImg.style.display = 'none';
  stdImg.classList.remove('loaded');
  destroyPannellum();
  setLoading(true);

  // Wait one animation frame so the browser applies display:block and computes
  // real dimensions before Pannellum reads them for WebGL init.
  // Without this, the container can have 0×0 dimensions and onLoad never fires.
  requestAnimationFrame(() => {
    let settled = false;
    const done = () => { if (!settled) { settled = true; setLoading(false); } };
    // Safety net: hide spinner after 60 s even if Pannellum stays silent
    const timeout = setTimeout(done, 60_000);

    try {
      state.pnlViewer = pannellum.viewer('pnl-container', {
        type:               'equirectangular',
        panorama:           url,
        autoLoad:           true,
        showZoomCtrl:       false,
        showFullscreenCtrl: false,
        showControls:       false,
        mouseZoom:          true,
        hfov:               90,
        onLoad:  () => { clearTimeout(timeout); done(); },
        onError: () => { clearTimeout(timeout); done(); },
      });
      // Redundant event-based listeners — covers Pannellum builds where
      // config callbacks are unreliable
      state.pnlViewer.on('load',  () => { clearTimeout(timeout); done(); });
      state.pnlViewer.on('error', () => { clearTimeout(timeout); done(); });
    } catch (e) {
      clearTimeout(timeout);
      done();
      console.error('Pannellum init error:', e);
    }
  });
}

function showStandard(url) {
  destroyPannellum();
  pnlEl.style.display = 'none';
  stdImg.classList.remove('loaded');
  stdImg.style.display = 'block';
  setLoading(true);

  stdImg.onload = () => {
    // Client-side 360° fallback: check 2:1 aspect ratio for untagged panoramas
    if (!state.photos[state.index]?.is360) {
      const r = stdImg.naturalWidth / stdImg.naturalHeight;
      if (r >= 1.95 && r <= 2.05 && stdImg.naturalWidth >= 3000) {
        state.photos[state.index].is360 = true;
        badge360.classList.add('visible');
        // Update thumb badge
        const tb = thumbsEl.children[state.index]?.querySelector('.thumb-badge');
        if (tb) tb.style.display = 'block';
        else addThumbBadge(state.index);
        show360(url);
        return;
      }
    }
    stdImg.classList.add('loaded');
    setLoading(false);
  };
  stdImg.onerror = () => setLoading(false);
  stdImg.src = url;
}

function destroyPannellum() {
  if (state.pnlViewer) {
    try { state.pnlViewer.destroy(); } catch (_) {}
    state.pnlViewer = null;
    pnlEl.innerHTML = '';
  }
}

/* ── Thumbnails ──────────────────────────────────────────────────────────────── */
function renderThumbs() {
  thumbsEl.innerHTML = '';
  state.photos.forEach((photo, i) => {
    const div = document.createElement('div');
    div.className = 'thumb';
    div.setAttribute('role', 'option');
    div.dataset.i = i;
    div.onclick = () => showPhoto(i);

    const img = document.createElement('img');
    img.alt = photo.name;
    img.onload = () => img.classList.add('loaded');
    img.src = photo.url;
    div.appendChild(img);

    if (photo.is360) addThumbBadge(i, div);

    thumbsEl.appendChild(div);
  });
}

function addThumbBadge(index, container) {
  const el = container || thumbsEl.children[index];
  if (!el) return;
  const badge = document.createElement('span');
  badge.className = 'thumb-badge';
  badge.textContent = '360°';
  el.appendChild(badge);
}

function activateThumb(index) {
  Array.from(thumbsEl.children).forEach((el, i) => el.classList.toggle('active', i === index));
  const el = thumbsEl.children[index];
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
}

/* ── Navigation ──────────────────────────────────────────────────────────────── */
function updateNav() {
  prevBtn.disabled = state.index <= 0;
  nextBtn.disabled = state.index >= state.photos.length - 1;
}

prevBtn.onclick = () => { if (state.index > 0) showPhoto(state.index - 1); };
nextBtn.onclick = () => { if (state.index < state.photos.length - 1) showPhoto(state.index + 1); };

document.addEventListener('keydown', e => {
  if (e.key === 'ArrowLeft')  prevBtn.click();
  if (e.key === 'ArrowRight') nextBtn.click();
});

/* ── UI helpers ──────────────────────────────────────────────────────────────── */
function setLoading(on) { loader.classList.toggle('visible', on); }

function viewerMessage(msg) {
  clearViewerMessage();
  const el = document.createElement('div');
  el.className = 'viewer-empty';
  el.id = '_empty';
  el.textContent = msg;
  $('viewer').appendChild(el);
}

function clearViewerMessage() {
  document.getElementById('_empty')?.remove();
}

/* ── Start ───────────────────────────────────────────────────────────────────── */
init();
