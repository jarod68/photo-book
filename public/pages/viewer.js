import { t, getLang, applyTranslations, initLangSwitcher } from '../utils/i18n.js';
import '../utils/admin-shortcut.js';
import { AlbumTabs }      from '../components/album-tabs.js';
import { ThumbnailStrip } from '../components/thumbnail-strip.js';
import { PhotoViewer }    from '../components/photo-viewer.js';
import { PhotoMap }       from '../components/photo-map.js';
import { AlbumMap }       from '../components/album-map.js';
import { getUserToken }   from '../utils/user-token.js';
import { getAlbums, getAlbum, getLiked, toggleLike, recordView, geocode, createShareToken } from '../api/client.js';
import { formatViews, formatLikes } from '../utils/format.js';
import { subscribeTo, unsubscribeFrom, getSubscription, getStoredAlbums } from '../utils/push.js';
import { showBuildTag } from '../utils/build-tag.js';
import { saveState } from '../utils/back.js';
import { Uploader, dragHasFiles, preventFileDrops } from '../components/uploader.js';
import { Slideshow }      from '../utils/slideshow.js';
import { sortPhotos, dayLabels, loadOrder, saveOrder } from '../utils/order.js';

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
  canUpload: false,   // the visitor may add photos to it (admin, or an authorized member)
};

// Map<album, endpoint> — seeded from localStorage on load, endpoint filled lazily
const subscribedAlbums = new Map(getStoredAlbums().map(a => [a, null]));

// ── DOM ───────────────────────────────────────────────────────────────────────
const tabsEl      = document.getElementById('album-tabs');
const thumbsEl    = document.getElementById('thumbnails');
const albumMapBtn = document.getElementById('album-map-btn');
const articlesBtn = /** @type {HTMLAnchorElement} */ (document.getElementById('album-articles-btn'));
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
const uploadBtn     = document.getElementById('upload-btn');
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
const pushBtn       = document.getElementById('push-btn');

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
  if (open) photoMap.refresh();   // its size changes (and on phones it was hidden)
});

exifPanel.addEventListener('click', e => e.stopPropagation());
// phones: the panel is a bottom sheet over the photo's bar (and its ⓘ):
// a tap anywhere else closes it
document.addEventListener('click', e => {
  if (exifPanel.hidden || !matchMedia('(max-width: 760px)').matches) return;
  if (!e.target.closest('#exif-panel, #exif-toggle, .photo-map-mini')) closeExifPanel();
}, true);

// Grouped, with icons: the camera and its lens, the date, the shot's settings
// as chips, the size. The panel is sized to its content (and on small screens
// also holds the mini-map, hidden from the photo otherwise): shown when the
// photo has EXIF data or a position.
const EXIF_ICONS = {
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  date:   '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  size:   '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 15l5-5 4 4 3-3 6 6"/>',
};
const exifIcon = (name) => `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${EXIF_ICONS[name]}</svg>`;

function renderExif(photo) {
  const exif = photo?.exif;
  if (!exif && !photo?.gps) {
    exifToggle.hidden = true;
    closeExifPanel();
    return;
  }
  exifToggle.hidden = false;
  if (!exif) { exifTable.innerHTML = ''; return; }

  // EXIF values come from untrusted image metadata — escape before injecting
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const row = (icon, label, main, sub) => main
    ? `<div class="exif-row" title="${esc(label)}">${exifIcon(icon)}<div><div class="exif-main">${esc(main)}</div>${sub ? `<div class="exif-sub">${esc(sub)}</div>` : ''}</div></div>`
    : '';

  // the EXIF time is the camera's local clock: shown as is (formatted in UTC)
  let date = null;
  if (exif.dateTime) {
    const d = new Date(exif.dateTime.replace(/\.\d+/, '').replace(/Z?$/, 'Z'));
    date = Number.isNaN(d.getTime()) ? exif.dateTime
      : new Intl.DateTimeFormat(getLang(), { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(d)
        + ' · ' + new Intl.DateTimeFormat(getLang(), { timeZone: 'UTC', hour: '2-digit', minute: '2-digit' }).format(d);
  }
  const chips = [
    ['exif.aperture',     exif.aperture != null ? `f/${exif.aperture}` : null],
    ['exif.shutterSpeed', exif.shutterSpeed],
    ['exif.iso',          exif.iso != null ? `ISO ${exif.iso}` : null],
    ['exif.focalLength',  exif.focalLength != null ? `${exif.focalLength} mm` : null, exif.focalLength35 ? `${exif.focalLength35} mm (24×36)` : null],
  ].filter(([, v]) => v != null && v !== '');
  const mp = exif.width && exif.height ? (exif.width * exif.height) / 1e6 : 0;

  exifTable.innerHTML = [
    row('camera', t('exif.camera'), [exif.make, exif.model].filter(Boolean).join(' ') || exif.lens, exif.make || exif.model ? exif.lens : null),
    row('date', t('exif.dateTime'), date),
    chips.length ? `<div class="exif-chips">${chips.map(([k, v, more]) => `<span class="exif-chip" title="${esc(t(k) + (more ? ` · ${more}` : ''))}">${esc(v)}</span>`).join('')}</div>` : '',
    row('size', t('exif.dimensions'), exif.width && exif.height ? `${exif.width} × ${exif.height}` : null, mp ? `${mp >= 10 ? Math.round(mp) : mp.toFixed(1)} MP` : null),
  ].join('');
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

// ── Push subscription ─────────────────────────────────────────────────────────
const pushSupported = 'PushManager' in window;

// Seed endpoint from PushManager; clear stale localStorage if subscription was revoked
if (pushSupported) {
  getSubscription().then(sub => {
    if (sub) {
      for (const album of subscribedAlbums.keys()) subscribedAlbums.set(album, sub.endpoint);
    } else {
      // Subscription revoked in browser settings — clear local state
      subscribedAlbums.clear();
      localStorage.removeItem('pb_push_albums');
    }
  }).catch(() => {});
}

pushBtn.addEventListener('click', async e => {
  e.stopPropagation();
  const album = state.current;
  if (!album) return;

  if (subscribedAlbums.has(album)) {
    // Unsubscribe
    const endpoint = subscribedAlbums.get(album);
    try {
      await unsubscribeFrom(album, endpoint);
      subscribedAlbums.delete(album);
      pushBtn.classList.remove('active');
      pushBtn.setAttribute('aria-label', t('viewer.subscribe'));
    } catch { /* ignore */ }
  } else {
    // Subscribe
    try {
      const ok = await subscribeTo(album, shareToken);
      if (ok) {
        const sub = await getSubscription();
        subscribedAlbums.set(album, sub?.endpoint ?? null);
        pushBtn.classList.add('active');
        pushBtn.setAttribute('aria-label', t('viewer.unsubscribe'));
      }
    } catch { /* ignore */ }
  }
});

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
  let initial   = albums.find(a => a.name === param);
  // a share link opens a restricted album the visitor does not see in the
  // list: its tab first, opened with the link's token (else the viewer fell
  // back to another album)
  if (!initial && param && shareToken) {
    initial = { name: param, count: 0, visibility: 'restricted', cover: null, coverPreview: null, coverThumb: null };
    state.albums = [initial, ...albums];
    tabs.render(state.albums, null);
  }
  initial ??= albums[0];
  if (initial) await selectAlbum(initial.name, params.get('photo'));
}

// ── Album selection ───────────────────────────────────────────────────────────
async function selectAlbum(name, targetFilename = null) {
  if (name === state.current) return;
  state.current = name;
  slideshow.stop();
  tabs.render(state.albums, name);

  const [data, likedData] = await Promise.all([
    getAlbum(name, shareToken),
    getLiked(name, userToken),
  ]);
  const entry = state.albums.find(a => a.name === name);
  const isRestricted = entry?.visibility === 'restricted';
  if (entry && entry.count !== data.photos.length) {   // a shared album's tab learns its count here
    entry.count = data.photos.length;
    tabs.render(state.albums, name);
  }
  state.photos = orderPhotos(data.photos.map(p => ({ ...p, isRestricted })));
  state.liked  = new Set(likedData.filenames);
  state.index  = -1;
  viewsEl.textContent = '';
  thumbs.render(state.photos);
  orderBtn.disabled = state.photos.length < 2;

  albumMapBtn.disabled = !state.photos.some(p => p.gps);
  slideshowBtn.disabled = state.photos.length < 2;
  // the album's stories (for the admin, `drafts` is set: always, to write one)
  articlesBtn.hidden = !entry?.articles && entry?.drafts === undefined;
  articlesBtn.href = `album.html?album=${encodeURIComponent(name)}${shareToken ? `&share=${encodeURIComponent(shareToken)}` : ''}`;

  state.canUpload = !!data.canUpload;
  uploadBtn.hidden = !state.canUpload;
  const hasActions = data.canDownload || data.canDelete || data.canUpload;
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

  // Push button visibility and state (Map is seeded from localStorage on load)
  if (pushSupported) {
    pushBtn.removeAttribute('hidden');
    const subscribed = subscribedAlbums.has(name);
    pushBtn.classList.toggle('active', subscribed);
    pushBtn.setAttribute('aria-label', t(subscribed ? 'viewer.unsubscribe' : 'viewer.subscribe'));
  }

  if (state.photos.length === 0) {
    emptyEl.removeAttribute('hidden');
    if (data.canDelete || data.canUpload) {
      // Show photo-info in minimal mode so the share and add buttons are accessible
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

// ── Adding photos: the ⋯ menu, or files dropped on the photo ─────────────────
// For the admin and the members who may change this album (canUpload); after
// the upload the album is reloaded and shows the first new photo.
const uploader = new Uploader({
  endpoint: (album) => `/api/albums/${encodeURIComponent(album)}/photos`,
  onDone: async (album, result) => {
    if (album !== state.current) return;
    const keep = result.files?.[0] ?? state.photos[state.index]?.filename ?? null;
    state.current = null;           // selectAlbum skips the album already shown
    await selectAlbum(album, keep);
  },
});
preventFileDrops();

uploadBtn.addEventListener('click', e => {
  e.stopPropagation();
  closeActionsMenu();
  uploader.open(state.current);
});

const dropEl = document.getElementById('viewer-drop');
let dragDepth = 0;
viewerEl.addEventListener('dragenter', (e) => {
  if (!state.canUpload || !dragHasFiles(e)) return;
  dragDepth++;
  document.getElementById('viewer-drop-text').textContent = t('viewer.dropToAdd', { album: state.current });
  dropEl.hidden = false;
});
viewerEl.addEventListener('dragover', (e) => {
  if (!state.canUpload || !dragHasFiles(e)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
});
viewerEl.addEventListener('dragleave', (e) => {
  if (!state.canUpload || !dragHasFiles(e)) return;
  if (--dragDepth <= 0) { dragDepth = 0; dropEl.hidden = true; }
});
viewerEl.addEventListener('drop', (e) => {
  dragDepth = 0;
  dropEl.hidden = true;
  if (!state.canUpload || !dragHasFiles(e)) return;
  e.preventDefault();
  uploader.open(state.current, [...e.dataTransfer.files]);
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

// ── Photo order: by name or chronological (F5) ────────────────────────────────
const ORDER_KEY = 'pb.photoOrder';
const orderBtn  = document.getElementById('order-btn');
let photoOrder  = loadOrder(ORDER_KEY, 'name', ['name', 'date']);

// Sorted copy; in date order the first photo of each day carries its label.
function orderPhotos(photos) {
  const sorted = sortPhotos(photos, photoOrder);
  const labels = photoOrder === 'date' ? dayLabels(sorted, getLang()) : [];
  sorted.forEach((p, i) => { p.dayLabel = labels[i] ?? null; });
  return sorted;
}

function renderOrderBtn() {
  const byDate = photoOrder === 'date';
  orderBtn.classList.toggle('active', byDate);
  orderBtn.setAttribute('aria-pressed', String(byDate));
  orderBtn.title = t(byDate ? 'viewer.orderDate' : 'viewer.orderName');
  orderBtn.setAttribute('aria-label', t('viewer.orderDate'));
}
renderOrderBtn();

orderBtn.addEventListener('click', () => {
  photoOrder = photoOrder === 'date' ? 'name' : 'date';
  saveOrder(ORDER_KEY, photoOrder);
  renderOrderBtn();
  const current = state.photos[state.index]?.filename;
  state.photos = orderPhotos(state.photos);
  thumbs.render(state.photos);
  const i = state.photos.findIndex(p => p.filename === current);
  if (i >= 0) showPhoto(i, { auto: true });   // same photo, new position
});

// ── Slideshow & fullscreen (F4) ───────────────────────────────────────────────
const slideshowBtn  = document.getElementById('slideshow-btn');
const fullscreenBtn = document.getElementById('fullscreen-btn');

const slideshow = new Slideshow({
  // loops back to the first photo; a playing video is watched to the end
  next: () => {
    if (state.photos.length < 2) return false;
    showPhoto((state.index + 1) % state.photos.length, { auto: true });
    return true;
  },
  isBusy: () => viewer.isVideoPlaying(),
  onChange: playing => {
    slideshowBtn.classList.toggle('active', playing);
    slideshowBtn.setAttribute('aria-pressed', String(playing));
    appEl.classList.toggle('slideshow', playing);
    if (playing) appEl.classList.add('ui-hidden');
  },
});
slideshowBtn.addEventListener('click', () => slideshow.toggle());

// Preload the next photo so the slideshow never waits on the network.
function preloadNext(index) {
  const next = state.photos[(index + 1) % state.photos.length];
  if (next && next.type !== 'video') new Image().src = next.mediumUrl || next.displayUrl || next.url;
}

// The Fullscreen API is missing on iPhone: the button is hidden there.
const fsTarget = document.documentElement;
if (document.fullscreenEnabled) fullscreenBtn.hidden = false;
function toggleFullscreen() {
  if (!document.fullscreenEnabled) return;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else fsTarget.requestFullscreen().catch(() => {});
}
fullscreenBtn.addEventListener('click', toggleFullscreen);
document.addEventListener('fullscreenchange', () => {
  fullscreenBtn.classList.toggle('active', !!document.fullscreenElement);
});

// ── Photo display ─────────────────────────────────────────────────────────────
// The address follows the album and photo shown, without new history
// entries: Back still leaves the viewer, and coming back (or reloading,
// or copying the link) reopens the same photo.
function syncUrl(photo) {
  const q = new URLSearchParams({ album: state.current, photo: photo.filename });
  if (shareToken) q.set('share', shareToken);
  saveState({}, `${location.pathname}?${q}`);
}

function showPhoto(index, { auto = false } = {}) {
  const photo = state.photos[index];
  if (!photo) return;

  // Restore UI if hidden (photo changed from strip or keyboard), and give a
  // photo chosen by hand a full slideshow interval.
  if (!auto) {
    appEl.classList.remove('ui-hidden');
    slideshow.restart();
  }
  if (slideshow.playing) preloadNext(index);

  state.index = index;
  thumbs.activate(index);
  syncUrl(photo);
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
  if (e.target.closest?.('input, textarea, select, [contenteditable]')) return;
  if (e.key === 'ArrowLeft'  && state.index > 0)                       showPhoto(state.index - 1);
  if (e.key === 'ArrowRight' && state.index < state.photos.length - 1) showPhoto(state.index + 1);
  if (e.key === ' ' && !e.target.closest?.('button, a, video') && state.photos.length > 1) {
    e.preventDefault();
    slideshow.toggle();
  }
  if (e.key === 'Escape') slideshow.stop();
  if ((e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.metaKey && !e.altKey) toggleFullscreen();
});

// ── Start ─────────────────────────────────────────────────────────────────────
init();

showBuildTag();
