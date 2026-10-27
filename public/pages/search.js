import { t, getLang, applyTranslations, initLangSwitcher } from '../utils/i18n.js';
import { showBuildTag } from '../utils/build-tag.js';

applyTranslations();
initLangSwitcher('lang-switcher');

const form     = document.getElementById('search-form');
const fields   = ['q', 'from', 'to', 'camera', 'album'].map(k => [k, document.getElementById(`search-${k}`)]);
const countEl  = document.getElementById('search-count');
const grid     = document.getElementById('search-results');
const cameraEl = document.getElementById('search-camera');
const albumEl  = document.getElementById('search-album');

const LOCALES = { fr: 'fr-FR', en: 'en-GB', es: 'es-ES' };
const dateFmt = new Intl.DateTimeFormat(LOCALES[getLang()] ?? getLang(), { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

// Filters live in the URL, so a search can be bookmarked or shared.
const params = new URLSearchParams(location.search);
for (const [k, el] of fields) {
  const v = params.get(k);
  if (!v) continue;
  // the camera / album lists are filled by the first answer: keep the URL's
  // choice as an option meanwhile, or the first search would ignore it
  if (el.tagName === 'SELECT') el.appendChild(Object.assign(document.createElement('option'), { value: v, textContent: v }));
  el.value = v;
}

let facetsLoaded = false;
let seq = 0;

function fillSelect(select, values) {
  const keep = select.value;
  for (const v of values) {
    const name = v.name ?? v;
    const o = [...select.options].find(x => x.value === name) ?? select.appendChild(document.createElement('option'));
    o.value = name;
    o.textContent = v.count != null ? `${name} (${v.count})` : name;
  }
  select.value = keep;
}

async function run() {
  const query = new URLSearchParams();
  for (const [k, el] of fields) if (el.value.trim()) query.set(k, el.value.trim());
  history.replaceState(null, '', query.size ? `?${query}` : location.pathname);

  const mine = ++seq;
  const res = await fetch(`/api/search?${query}`).catch(() => null);
  if (mine !== seq) return;   // a newer search was started meanwhile
  if (!res?.ok) { countEl.textContent = t('search.failed'); return; }
  const { total, results, facets } = await res.json();

  if (!facetsLoaded) {
    fillSelect(cameraEl, facets.cameras);
    fillSelect(albumEl, facets.albums);
    if (facets.dateFrom) for (const [, el] of fields.filter(([k]) => k === 'from' || k === 'to')) {
      el.min = facets.dateFrom.slice(0, 10);
      el.max = facets.dateTo.slice(0, 10);
    }
    facetsLoaded = true;
  }

  countEl.textContent = total > results.length
    ? t('search.countLimited', { n: results.length, total })
    : t('search.count', { n: total, s: total !== 1 ? 's' : '' });
  grid.replaceChildren(...results.map(renderResult));
  if (!results.length) {
    const p = document.createElement('p');
    p.className = 'grid-empty';
    p.textContent = t('search.none');
    grid.appendChild(p);
  }
}

function renderResult(r) {
  const a = document.createElement('a');
  a.className = 'search-tile';
  a.href = `viewer.html?album=${encodeURIComponent(r.album)}&photo=${encodeURIComponent(r.filename)}`;
  let media;
  if (r.type === 'video') {
    media = document.createElement('video');
    media.muted = true;
    media.preload = 'metadata';
    media.src = `${r.url.split('?')[0]}#t=0.1`;
  } else {
    media = document.createElement('img');
    media.loading = 'lazy';
    media.decoding = 'async';
    media.alt = r.name;
    media.src = r.thumbUrl || r.url;
  }
  a.appendChild(media);
  const info = document.createElement('div');
  info.className = 'search-tile-info';
  const name = document.createElement('div');
  name.className = 'search-tile-name';
  name.textContent = r.name;
  const meta = document.createElement('div');
  meta.className = 'search-tile-meta';
  meta.textContent = [r.album, r.takenAt ? dateFmt.format(new Date(r.takenAt)) : null, r.location].filter(Boolean).join(' · ');
  info.append(name, meta);
  a.appendChild(info);
  return a;
}

let timer = null;
const later = () => { clearTimeout(timer); timer = setTimeout(run, 250); };
form.addEventListener('input', later);
form.addEventListener('change', later);
form.addEventListener('submit', e => { e.preventDefault(); run(); });
form.addEventListener('reset', () => setTimeout(run));   // after the fields are cleared

run();
showBuildTag();
