// @ts-check
// Writing an article (write.html?album=…[&a=slug]), for the admin: the form
// on the left, the article as readers will see it on the right (one or the
// other on a phone). Photos come from any album, chosen in the picker —
// inserted in the text as ![](<Album/file.jpg>), or taken as the cover;
// photos can be uploaded to an album from there too.
import { t, applyTranslations, initLangSwitcher } from '../utils/i18n.js';
import { getAlbums, getAlbum, getArticle, saveArticle, deleteArticle } from '../api/client.js';
import { renderArticle, photoRefs, parseRef, refFor, esc } from '../utils/article-render.js';
import { articleMeta } from '../components/article-card.js';
import { Uploader, preventFileDrops } from '../components/uploader.js';
import { wireBack } from '../utils/back.js';

applyTranslations();
initLangSwitcher('lang-switcher');

const params = new URLSearchParams(location.search);
const album  = params.get('album') ?? '';
let slug     = params.get('a');
let id       = null;
let cover    = null;          // "Album/file" or "file" (the article's album)
let dirty    = false;

const $ = (id) => /** @type {any} */ (document.getElementById(id));
const form = { title: $('write-title'), summary: $('write-summary'), date: $('write-date'), place: $('write-place'), body: $('write-body'), published: $('write-published') };
const statusEl = $('write-status');
const albumHref = `album.html?album=${encodeURIComponent(album)}`;
$('write-album').textContent = album;
// ←: back where the admin came from (the journal, the article), like the
// other pages — a plain link would add a page, and the journal's own ←
// would then come back here
const back = /** @type {HTMLAnchorElement} */ (document.querySelector('.write-back'));
back.href = albumHref;          // opened from outside: the album's journal
wireBack(back);

// ── Photos of the albums, loaded once each (for the preview and the picker) ──
/** @type {Map<string, any[]>} */
const albumPhotos = new Map();
async function photosOf(name) {
  if (!albumPhotos.has(name)) albumPhotos.set(name, await getAlbum(name).then((a) => a.photos, () => []));
  return albumPhotos.get(name);
}

// "Album/file" → photo, for the references of the body and the cover
async function photoMap() {
  const refs = photoRefs(form.body.value, album);
  if (cover) refs.push({ ...parseRef(cover, album), caption: '' });
  const map = new Map();
  for (const r of refs) {
    const p = (await photosOf(r.album)).find((x) => x.filename === r.file);
    if (p) map.set(`${r.album}/${r.file}`, { ...p, width: p.exif?.width ?? null, height: p.exif?.height ?? null });
  }
  return map;
}

function coverPhoto(map) {
  if (!cover) return null;
  const r = parseRef(cover, album);
  return map.get(`${r.album}/${r.file}`) ?? null;
}

// ── Preview ───────────────────────────────────────────────────────────────────
let previewTimer = null;
async function preview() {
  const map = await photoMap();
  const c = coverPhoto(map);
  const hero = $('write-preview-hero');
  const pic = c?.mediumUrl || c?.previewUrl;
  hero.classList.toggle('article-hero--plain', !pic);
  hero.classList.toggle('loaded', !!pic);
  const words = form.body.value.split(/\s+/).filter(Boolean).length;
  const meta = articleMeta({ date: form.date.value || null, place: form.place.value.trim() || null, readMinutes: Math.max(1, Math.round(words / 200)) });
  hero.innerHTML = `${pic ? `<img class="article-hero-img" alt="" src="${esc(pic)}">` : ''}
    <div class="article-hero-text">
      <p class="carnet-kicker">${esc(album)}</p>
      <h1 class="article-title">${esc(form.title.value || t('write.title'))}</h1>
      <p class="article-meta">${esc(meta)}</p>
    </div>`;
  $('write-preview-body').innerHTML = (form.summary.value.trim() ? `<p class="article-lead">${esc(form.summary.value.trim())}</p>` : '')
    + renderArticle(form.body.value, { album, photos: map, showMissing: true }).replace(/(<div class="art-missing">)/g, `$1${esc(t('write.missing'))} · `);
  // the cover field
  $('write-cover-img').hidden = !c;
  if (c) $('write-cover-img').src = c.thumbUrl;
  $('write-cover-none').hidden = !!cover;
  $('write-cover-clear').hidden = !cover;
}
const schedulePreview = () => { clearTimeout(previewTimer); previewTimer = setTimeout(preview, 150); };

function setStatus(key, cls = '') {
  statusEl.textContent = key ? t(key) : '';
  statusEl.className = `write-status ${cls}`;
}
function changed() {
  dirty = true;
  setStatus('write.unsaved', 'write-status--dirty');
  schedulePreview();
}

// ── Save / delete ─────────────────────────────────────────────────────────────
async function save() {
  if (!form.title.value.trim()) { form.title.focus(); form.title.reportValidity(); return; }
  const fields = {
    title: form.title.value, summary: form.summary.value, body: form.body.value,
    place: form.place.value, date: form.date.value || null, cover, published: form.published.checked,
  };
  $('write-save').disabled = true;
  try {
    const a = await saveArticle(id, id ? fields : { album, ...fields });
    if (!id) {
      id = a.id;
      slug = a.slug;
      history.replaceState(null, '', `write.html?album=${encodeURIComponent(album)}&a=${encodeURIComponent(slug)}`);
      $('write-heading').textContent = t('write.editTitle');
      $('write-delete').hidden = false;
    }
    dirty = false;
    setStatus('write.saved', 'write-status--saved');
  } catch {
    setStatus('write.saveError', 'write-status--error');
  } finally {
    $('write-save').disabled = false;
  }
}

async function remove() {
  if (!id || !confirm(t('write.confirmDelete', { title: form.title.value }))) return;
  await deleteArticle(id).catch(() => null);
  dirty = false;
  location.replace(albumHref);   // the editor of a deleted article is no page to come back to
}

// ── Markdown toolbar ──────────────────────────────────────────────────────────
function insertAtCursor(text, { block = false } = {}) {
  const ta = form.body;
  const { selectionStart: s, selectionEnd: e, value } = ta;
  let ins = text;
  if (block) {
    // on lines of their own, a blank line around
    const before = value.slice(0, s), after = value.slice(e);
    ins = (before && !before.endsWith('\n\n') ? (before.endsWith('\n') ? '\n' : '\n\n') : '') + text
      + (after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n');
  }
  ta.setRangeText(ins, s, e, 'end');
  ta.focus();
  changed();
}

function wrap(mark, placeholder) {
  const ta = form.body;
  const { selectionStart: s, selectionEnd: e, value } = ta;
  const sel = value.slice(s, e) || placeholder;
  ta.setRangeText(`${mark}${sel}${mark}`, s, e, 'select');
  ta.setSelectionRange(s + mark.length, s + mark.length + sel.length);
  ta.focus();
  changed();
}

function prefixLines(prefix) {
  const ta = form.body;
  const { value } = ta;
  const s = value.lastIndexOf('\n', ta.selectionStart - 1) + 1;
  const e = ta.selectionEnd;
  const lines = value.slice(s, e).split('\n').map((l) => prefix + l.replace(/^(#{1,6}|>|[-*+]|\d+\.)\s+/, ''));
  ta.setRangeText(lines.join('\n'), s, e, 'end');
  ta.focus();
  changed();
}

const ACTIONS = {
  bold: () => wrap('**', t('write.bold').toLowerCase()),
  italic: () => wrap('*', t('write.italic').toLowerCase()),
  heading: () => prefixLines('## '),
  quote: () => prefixLines('> '),
  list: () => prefixLines('- '),
  link: () => {
    const url = prompt(t('write.linkPrompt'), 'https://');
    if (!url || url === 'https://') return;
    const ta = form.body;
    const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd) || url;
    ta.setRangeText(`[${sel}](${url})`, ta.selectionStart, ta.selectionEnd, 'end');
    ta.focus();
    changed();
  },
};

// ── Photo picker ──────────────────────────────────────────────────────────────
const picker = /** @type {HTMLDialogElement} */ ($('picker'));
const pickerAlbum = /** @type {HTMLSelectElement} */ ($('picker-album'));
let picked = [];             // [{ album, file }] in click order
let pickerMode = 'insert';   // 'insert' | 'cover'

async function renderPicker() {
  const grid = $('picker-grid');
  const name = pickerAlbum.value;
  const photos = await photosOf(name);
  grid.replaceChildren();
  if (!photos.length) {
    grid.innerHTML = `<p class="picker-empty">${esc(t('write.noPhotos'))}</p>`;
    return;
  }
  for (const p of photos) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'picker-item';
    b.title = p.name;
    b.innerHTML = `<img src="${esc(p.thumbUrl ?? '')}" alt="${esc(p.name)}" loading="lazy">${p.type === 'video' ? '<span class="picker-video">▶</span>' : ''}<span class="picker-n"></span>`;
    b.addEventListener('click', () => {
      const i = picked.findIndex((x) => x.album === name && x.file === p.filename);
      if (pickerMode === 'cover') picked = i >= 0 ? [] : [{ album: name, file: p.filename }];
      else if (i >= 0) picked.splice(i, 1);
      else picked.push({ album: name, file: p.filename });
      markPicked();
    });
    b.dataset.key = `${name}/${p.filename}`;
    grid.appendChild(b);
  }
  markPicked();
}

function markPicked() {
  for (const b of /** @type {NodeListOf<HTMLElement>} */ ($('picker-grid').querySelectorAll('.picker-item'))) {
    const i = picked.findIndex((x) => `${x.album}/${x.file}` === b.dataset.key);
    b.classList.toggle('picked', i >= 0);
    b.querySelector('.picker-n').textContent = i >= 0 && pickerMode === 'insert' ? String(i + 1) : '';
  }
  $('picker-insert').disabled = !picked.length;
  $('picker-cover').disabled = picked.length !== 1;
}

async function openPicker(mode) {
  pickerMode = mode;
  picked = [];
  if (picker.open) picker.close();
  $('picker-insert').hidden = mode === 'cover';
  if (!pickerAlbum.options.length) {
    const albums = await getAlbums().catch(() => []);
    for (const a of [{ name: album }, ...albums.filter((x) => x.name !== album)]) pickerAlbum.add(new Option(a.name, a.name));
  }
  await renderPicker();
  picker.showModal();
}

const uploader = new Uploader({
  endpoint: (name) => `/api/admin/albums/${encodeURIComponent(name)}/photos`,
  // the picker was closed for the upload window: back to it, the new photos in
  onDone: async (name) => { albumPhotos.delete(name); pickerAlbum.value = name; await openPicker(pickerMode); },
});

// ── Start ─────────────────────────────────────────────────────────────────────
async function init() {
  const me = await fetch('/api/auth/me').then((r) => r.json()).catch(() => ({ user: null }));
  const msg = $('write-message');
  if (me.user?.role !== 'admin') {
    msg.innerHTML = `${esc(t('write.adminOnly'))} <a href="login.html">${esc(t('nav.signIn'))}</a>`;
    msg.hidden = false;
    return;
  }
  if (slug) {
    try {
      const a = await getArticle(album, slug);
      id = a.id;
      form.title.value = a.title;
      form.summary.value = a.lead ?? '';
      form.body.value = a.body;
      form.place.value = a.place ?? '';
      form.date.value = a.date ?? '';
      form.published.checked = a.published;
      cover = a.coverRef;
      $('write-heading').textContent = t('write.editTitle');
      $('write-delete').hidden = false;
      document.title = `${a.title} — ${t('write.editTitle')}`;
    } catch {
      msg.textContent = t('art.notFound');
      msg.hidden = false;
      return;
    }
  } else {
    // the day of the album's first photo (capture date), else today
    const first = (await photosOf(album)).map((p) => p.takenAt).filter(Boolean).sort()[0];
    form.date.value = (first ?? new Date().toISOString()).slice(0, 10);
    document.title = `${t('write.newTitle')} — ${album}`;
  }
  $('write').hidden = false;
  await preview();

  for (const el of Object.values(form)) el.addEventListener('input', changed);
  $('write-save').addEventListener('click', save);
  $('write-delete').addEventListener('click', remove);
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
  });
  window.addEventListener('beforeunload', (e) => { if (dirty) e.preventDefault(); });
  document.querySelector('.write-toolbar').addEventListener('click', (e) => {
    const b = /** @type {HTMLElement} */ (e.target).closest('[data-md]');
    if (b) ACTIONS[/** @type {HTMLElement} */ (b).dataset.md]();
  });
  // on a phone: the form or the preview
  for (const tab of document.querySelectorAll('.write-tab')) {
    tab.addEventListener('click', () => {
      const which = /** @type {HTMLElement} */ (tab).dataset.tab;
      $('write').dataset.tab = which;
      document.querySelectorAll('.write-tab').forEach((x) => x.setAttribute('aria-selected', String(x === tab)));
      if (which === 'preview') preview();
    });
  }

  $('write-photo').addEventListener('click', () => openPicker('insert'));
  $('write-cover-pick').addEventListener('click', () => openPicker('cover'));
  $('write-cover-clear').addEventListener('click', () => { cover = null; changed(); });
  pickerAlbum.addEventListener('change', renderPicker);
  $('picker-insert').addEventListener('click', () => {
    insertAtCursor(picked.map((p) => `![](${refFor(p.album, p.file, album)})`).join('\n'), { block: true });
    picker.close();
  });
  $('picker-cover').addEventListener('click', () => {
    const [p] = picked;
    cover = p.album === album ? p.file : `${p.album}/${p.file}`;
    picker.close();
    changed();
  });
  $('picker-upload').addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = 'image/*,video/*';
    input.onchange = () => {
      if (!input.files?.length) return;
      picker.close();
      uploader.open(pickerAlbum.value, [...input.files]);
    };
    input.click();
  });
  for (const b of picker.querySelectorAll('.picker-close, .picker-cancel')) b.addEventListener('click', () => picker.close());
  preventFileDrops();
}

init();
