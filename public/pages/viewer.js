import { t, applyTranslations, initLangSwitcher } from '../utils/i18n.js';
import '../utils/admin-shortcut.js';
import { AlbumTabs }      from '../components/album-tabs.js';
import { ThumbnailStrip } from '../components/thumbnail-strip.js';
import { PhotoViewer }    from '../components/photo-viewer.js';
import { PhotoMap }       from '../components/photo-map.js';
import { AlbumMap }       from '../components/album-map.js';
import { getUserToken }   from '../utils/user-token.js';
import { getAlbums, getAlbum, getLiked, toggleLike, recordView, geocode, createShareToken } from '../api/client.js';
import { formatViews, formatLikes } from '../utils/format.js';

applyTranslations();
initLangSwitcher('lang-switcher');

const userToken  = getUserToken();
const urlParams  = new URLSearchParams(location.search);
const shareToken = urlParams.get('share');

// ── State ─────────────────────────────────────────────────────────────────────
const state = {
  albums:  [],
  current: null,
  photos:  [],
  index:   -1,
  liked:   new Set(), // filenames liked by this user in the current album
};

// ── DOM ───────────────────────────────────────────────────────────────────────
const tabsEl      = document.getElementById('album-tabs');
const thumbsEl    = document.getElementById('thumbnails');
const albumMapBtn = document.getElementById('album-map-btn');
const locationEl  = document.getElementById('photo-location');
const viewsEl     = document.getElementById('photo-views');
const likeBtn     = document.getElementById('like-btn');
const likeCountEl = document.getElementById('like-count');
const actionsEl     = document.getElementById('photo-actions');
const actionsToggle = document.getElementById('photo-actions-toggle');
const actionsMenu   = document.getElementById('photo-actions-menu');
const downloadBtn   = document.getElementById('download-btn');
const zipBtn        = document.getElementById('zip-btn');
const shareBtn      = document.getElementById('share-btn');
const deleteBtn     = document.getElementById('delete-btn');
const photoInfoEl   = document.getElementById('photo-info');
const emptyEl       = document.getElementById('empty-state');
const exifToggle    = document.getElementById('exif-toggle');
const exifPanel     = document.getElementById('exif-panel');
const exifTable     = document.getElementById('exif-table');
const shareModal    = document.getElementById('share-modal');
const shareModalClose = document.getElementById('share-modal-close');
const shareDuration = document.getElementById('share-duration');
const shareCreateBtn = document.getElementById('share-create-btn');
const shareResult   = document.getElementById('share-result');
const shareUrlInput = document.getElementById('share-url');
const shareCopyBtn  = document.getElementById('share-copy-btn');
const shareExpires  = document.getElementById('share-expires');

// ── Share duration picker ─────────────────────────────────────────────────────
{
  const pickerBtn  = shareDuration.querySelector('.share-duration-btn');
  const pickerMenu = shareDuration.querySelector('.share-duration-menu');
  const pickerLabel = shareDuration.querySelector('.share-duration-label');

  function closePicker() {
    pickerMenu.hidden = true;
    pickerBtn.setAttribute('aria-expanded', 'false');
  }

  pickerBtn.addEventListener('click', e => {
    e.stopPropagation();
    const opening = pickerMenu.hidden;
    pickerMenu.hidden = !opening;
    pickerBtn.setAttribute('aria-expanded', String(opening));
  });

  pickerMenu.querySelectorAll('.share-duration-option').forEach(opt => {
    opt.addEventListener('click', e => {
      e.stopPropagation();
      shareDuration.dataset.value = opt.dataset.value;
      pickerLabel.textContent = opt.textContent;
      pickerMenu.querySelectorAll('.share-duration-option').forEach(o => o.classList.remove('share-duration-option--active'));
      opt.classList.add('share-duration-option--active');
      closePicker();
    });
  });

  document.addEventListener('click', closePicker);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closePicker(); });
}

// ── Action menu toggle ────────────────────────────────────────────────────────
function closeActionsMenu() {
  actionsMenu.classList.remove('open');
  actionsToggle.setAttribute('aria-expanded', 'false');
}

actionsToggle.addEventListener('click', e => {
  e.stopPropagation();
  const isOpen = actionsMenu.classList.toggle('open');
  actionsToggle.setAttribute('aria-expanded', String(isOpen));
});

document.addEventListener('click', closeActionsMenu);
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeActionsMenu();
    closeShareModal();
    closeExifPanel();
  }
});
downloadBtn.addEventListener('click', closeActionsMenu);
zipBtn.addEventListener('click', closeActionsMenu);

// ── EXIF panel ────────────────────────────────────────────────────────────────
function closeExifPanel() {
  exifPanel.hidden = true;
  exifToggle.classList.remove('active');
  viewerEl.classList.remove('exif-open');
}

exifToggle.addEventListener('click', e => {
  e.stopPropagation();
  const open = exifPanel.hidden;
  exifPanel.hidden = !open;
  exifToggle.classList.toggle('active', open);
  viewerEl.classList.toggle('exif-open', open);
});

exifPanel.addEventListener('click', e => e.stopPropagation());

function renderExif(photo) {
  const exif = photo?.exif;
  if (!exif) {
    exifToggle.hidden = true;
    closeExifPanel();
    return;
  }
  exifToggle.hidden = false;

  const rows = [];
  const add = (key, val) => {
    if (val != null && val !== '') rows.push([t(key), val]);
  };

  if (exif.make || exif.model) {
    add('exif.camera', [exif.make, exif.model].filter(Boolean).join(' '));
  }
  add('exif.lens',         exif.lens);
  add('exif.dateTime',     exif.dateTime ? exif.dateTime.replace('T', ' ').replace(/\.\d+Z?$/, '') : null);
  add('exif.iso',          exif.iso      != null ? `ISO ${exif.iso}` : null);
  add('exif.aperture',     exif.aperture != null ? `f/${exif.aperture}` : null);
  add('exif.shutterSpeed', exif.shutterSpeed);
  add('exif.focalLength',  exif.focalLength != null ? `${exif.focalLength} mm` + (exif.focalLength35 ? ` (${exif.focalLength35} mm équiv.)` : '') : null);
  add('exif.dimensions',   exif.width && exif.height ? `${exif.width} × ${exif.height}` : null);

  exifTable.innerHTML = rows.map(([k, v]) =>
    `<tr><th>${k}</th><td>${v}</td></tr>`,
  ).join('');
}

// ── Share modal ───────────────────────────────────────────────────────────────
function closeShareModal() {
  shareModal.classList.add('hidden');
  shareResult.classList.add('hidden');
  shareExpires.textContent = '';
}

function openShareModal() {
  shareResult.classList.add('hidden');
  shareExpires.textContent = '';
  shareModal.classList.remove('hidden');
}

shareModalClose.addEventListener('click', closeShareModal);
shareModal.addEventListener('click', e => { if (e.target === shareModal) closeShareModal(); });

shareCreateBtn.addEventListener('click', async () => {
  shareCreateBtn.disabled = true;
  try {
    const days = parseInt(shareDuration.dataset.value, 10);
    const data = await createShareToken(state.current, days);
    const url  = `${location.origin}/viewer.html?album=${encodeURIComponent(state.current)}&share=${data.token}`;
    shareUrlInput.value = url;
    shareResult.classList.remove('hidden');
    const exp = new Date(data.expires_at).toLocaleDateString();
    shareExpires.textContent = t('viewer.shareExpires', { date: exp });
  } catch {
    alert(t('viewer.shareError'));
  } finally {
    shareCreateBtn.disabled = false;
  }
});

shareCopyBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(shareUrlInput.value);
    shareCopyBtn.textContent = t('viewer.shareCopied');
    setTimeout(() => { shareCopyBtn.textContent = t('viewer.shareCopy'); }, 2000);
  } catch {
    shareUrlInput.select();
    document.execCommand('copy');
  }
});

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
      photo.location = await geocode(photo.gps.lat, photo.gps.lng);
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

const viewerEl = document.getElementById('viewer');
const viewer = new PhotoViewer({
  root:         viewerEl,
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
  const albums = await getAlbums();
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

  const [data, likedData] = await Promise.all([
    getAlbum(name, shareToken),
    getLiked(name, userToken),
  ]);
  const isRestricted = state.albums.find(a => a.name === name)?.visibility === 'restricted';
  state.photos = data.photos.map(p => ({ ...p, isRestricted }));
  state.liked  = new Set(likedData.filenames);
  state.index  = -1;
  viewsEl.textContent = '';
  thumbs.render(state.photos);

  albumMapBtn.disabled = !state.photos.some(p => p.gps);

  const hasActions = data.canDownload || data.canDelete;
  if (hasActions) {
    actionsEl.removeAttribute('hidden');
  } else {
    actionsEl.setAttribute('hidden', '');
  }
  closeActionsMenu();

  if (data.canDelete && state.photos.length > 0) {
    deleteBtn.removeAttribute('hidden');
  } else {
    deleteBtn.setAttribute('hidden', '');
  }

  if (data.canDownload && state.photos.length > 0) {
    const zipShare = shareToken ? `?share=${encodeURIComponent(shareToken)}` : '';
    zipBtn.href = `/api/albums/${encodeURIComponent(name)}/download/zip${zipShare}`;
    zipBtn.removeAttribute('hidden');
  } else {
    zipBtn.setAttribute('hidden', '');
  }

  if (data.canDelete && isRestricted) {
    shareBtn.removeAttribute('hidden');
  } else {
    shareBtn.setAttribute('hidden', '');
  }

  if (state.photos.length === 0) {
    emptyEl.removeAttribute('hidden');
    if (data.canDelete) {
      // Show photo-info in minimal mode so the share button is accessible
      photoInfoEl.removeAttribute('hidden');
      photoInfoEl.classList.add('photo-info--empty');
    } else {
      photoInfoEl.setAttribute('hidden', '');
    }
    return;
  }
  emptyEl.setAttribute('hidden', '');
  photoInfoEl.removeAttribute('hidden');
  photoInfoEl.classList.remove('photo-info--empty');

  if (state.photos.length > 0) {
    const target = targetFilename
      ? (state.photos.findIndex(p => p.filename === targetFilename) || 0)
      : 0;
    showPhoto(Math.max(0, target));
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function updateLikeBtn(photo) {
  const liked = state.liked.has(photo.filename);
  likeBtn.classList.toggle('liked', liked);
  likeBtn.setAttribute('aria-pressed', String(liked));
  likeCountEl.textContent = formatLikes(photo.likes ?? 0);
}

likeBtn.addEventListener('click', e => {
  e.stopPropagation();
  const photo = state.photos[state.index];
  if (!photo) return;

  // Optimistic update
  const nowLiked = !state.liked.has(photo.filename);
  if (nowLiked) { state.liked.add(photo.filename);    photo.likes = (photo.likes ?? 0) + 1; }
  else          { state.liked.delete(photo.filename); photo.likes = Math.max(0, (photo.likes ?? 1) - 1); }
  updateLikeBtn(photo);

  toggleLike(state.current, photo.filename, userToken)
    .then(data => {
      if (!data) return;
      photo.likes = data.count;
      if (data.liked) state.liked.add(photo.filename);
      else            state.liked.delete(photo.filename);
      updateLikeBtn(photo);
    })
    .catch(() => {});
});

shareBtn.addEventListener('click', e => {
  e.stopPropagation();
  closeActionsMenu();
  openShareModal();
});

deleteBtn.addEventListener('click', async e => {
  e.stopPropagation();
  closeActionsMenu();
  const photo = state.photos[state.index];
  if (!photo) return;
  if (!confirm(t('viewer.deleteConfirm', { filename: photo.filename }))) return;
  try {
    const res = await fetch(
      `/api/albums/${encodeURIComponent(state.current)}/photos/${encodeURIComponent(photo.filename)}`,
      { method: 'DELETE' },
    );
    if (!res.ok) throw new Error((await res.json()).error ?? 'Error');
    const idx = state.index;
    state.photos.splice(idx, 1);
    thumbs.render(state.photos);
    if (state.photos.length === 0) {
      state.index = -1;
    } else {
      showPhoto(Math.min(idx, state.photos.length - 1));
    }
  } catch (err) {
    alert(t('viewer.deleteError', { msg: err.message }));
  }
});

// ── Photo display ─────────────────────────────────────────────────────────────
function showPhoto(index) {
  const photo = state.photos[index];
  if (!photo) return;

  // Restore UI if hidden (photo changed from strip or keyboard)
  appEl.classList.remove('ui-hidden');

  state.index = index;
  thumbs.activate(index);
  downloadBtn.href     = photo.url;
  downloadBtn.download = photo.filename;
  photoMap.update(photo, index, state.photos);
  albumMap.setCurrent(index);
  showLocation(photo);
  updateLikeBtn(photo);
  renderExif(photo);

  viewer.show(photo, () => {
    state.photos[index].is360 = true;
    thumbs.addBadge(index);
  });

  // Show known value immediately, then update with confirmed value from server
  viewsEl.textContent = photo.views != null ? formatViews(photo.views) : '';
  recordView(state.current, photo.filename, userToken)
    .then(data => {
      if (!data) return;
      if (data.views != null) {
        photo.views = data.views;
        if (state.index === index) viewsEl.textContent = formatViews(data.views);
      }
      if (data.likes != null) {
        photo.likes = data.likes;
        if (data.liked) state.liked.add(photo.filename);
        else            state.liked.delete(photo.filename);
        if (state.index === index) updateLikeBtn(photo);
      }
    })
    .catch(() => {});

}

// ── Navigation ────────────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'ArrowLeft'  && state.index > 0)                       showPhoto(state.index - 1);
  if (e.key === 'ArrowRight' && state.index < state.photos.length - 1) showPhoto(state.index + 1);
});

// ── Start ─────────────────────────────────────────────────────────────────────
init();
