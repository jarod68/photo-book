// @ts-check
import { t, applyTranslations, initLangSwitcher } from '../utils/i18n.js';
import { createAlbumCard } from '../components/album-card.js';
import { showBuildTag } from '../utils/build-tag.js';
import { sortAlbums, loadOrder, saveOrder } from '../utils/order.js';
import { formatDateRange } from '../utils/format.js';
import { rememberScroll, restoreScroll } from '../utils/back.js';
import { Uploader, dragHasFiles, preventFileDrops } from '../components/uploader.js';
import { createArticleCard } from '../components/article-card.js';
import { getLatestArticles } from '../api/client.js';

applyTranslations();
initLangSwitcher('lang-switcher');

const grid   = document.getElementById('album-grid');
const explore = document.getElementById('explore-grid');
const hero   = document.getElementById('home-hero');
const sumEl  = document.getElementById('summary');
const authEl = document.getElementById('home-auth');
const sortEl = /** @type {HTMLSelectElement} */ (document.getElementById('album-sort'));
const SORT_KEY = 'pb.albumSort';
const GROUP_KEY = 'pb.albumGroup';
const groupEl = /** @type {HTMLSelectElement} */ (document.getElementById('album-group'));

function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

async function init() {
  const [authData, albums] = await Promise.all([
    fetch('/api/auth/me').then(r => r.json()).catch(() => ({ user: null })),
    fetch('/api/albums').then(r => r.json()).catch(() => []),
  ]);

  renderAuth(authData.user);
  renderArticles();

  const totalPhotos = albums.reduce((n, a) => n + a.count, 0);
  const aS = albums.length !== 1 ? 's' : '';
  const pS = totalPhotos !== 1 ? 's' : '';
  sumEl.textContent =
    `${albums.length} ${t('word.album', { s: aS })} · ${totalPhotos} ${t('word.photo', { s: pS })}`;

  explore.appendChild(createMapCard());
  explore.appendChild(createGlobeCard());

  if (albums.length === 0) {
    const p = document.createElement('p');
    p.className = 'grid-empty';
    p.innerHTML = t('home.empty');
    grid.appendChild(p);
    return;
  }

  renderHero(albums);

  // Album cards, re-sorted in place (F5), optionally grouped by year or by
  // collection (chosen in the admin) under headings across the grid.
  const cards = new Map(albums.map(a => [a.name, createAlbumCard(a)]));
  enableDrops(albums, cards);
  const hasCollections = albums.some(a => a.collection);
  /** @type {HTMLOptionElement} */ (groupEl.querySelector('[value="collection"]')).hidden = !hasCollections;
  const place = () => {
    const sorted = sortAlbums(albums, /** @type {'name' | 'recent' | 'oldest'} */ (sortEl.value));
    grid.replaceChildren();
    for (const { title, items } of groupAlbums(sorted, groupEl.value)) {
      if (title !== null) {
        const h = document.createElement('h3');
        h.className = 'album-group-title';
        h.textContent = title;
        grid.appendChild(h);
      }
      items.forEach(a => grid.appendChild(cards.get(a.name)));
    }
  };
  sortEl.value = loadOrder(SORT_KEY, 'name', ['name', 'recent', 'oldest']);
  groupEl.value = loadOrder(GROUP_KEY, 'none', hasCollections ? ['none', 'year', 'collection'] : ['none', 'year']);
  sortEl.hidden = groupEl.hidden = albums.length < 2;
  sortEl.addEventListener('change', () => { saveOrder(SORT_KEY, sortEl.value); place(); });
  groupEl.addEventListener('change', () => { saveOrder(GROUP_KEY, groupEl.value); place(); });
  place();
  restoreScroll();   // back from an album: where the visitor was
}

// Photos dropped on an album card go into that album — for the admin and the
// members who may change it (canDelete: the same right). Once uploaded, the
// card is redrawn with its new count and dates.
function enableDrops(albums, cards) {
  const allowed = new Set(albums.filter(a => a.canDelete).map(a => a.name));
  if (!allowed.size) return;
  preventFileDrops();
  const uploader = new Uploader({
    endpoint: (album) => `/api/albums/${encodeURIComponent(album)}/photos`,
    onDone: async (album) => {
      const fresh = (await fetch('/api/albums').then(r => r.json()).catch(() => [])).find(a => a.name === album);
      const old = cards.get(album);
      if (!fresh || !old) return;
      const card = createAlbumCard(fresh);
      old.replaceWith(card);
      cards.set(album, card);
      wire(album, card);
    },
  });
  const wire = (name, card) => {
    card.addEventListener('dragover', (e) => {
      if (!dragHasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      card.classList.add('album-card--drop');
    });
    card.addEventListener('dragleave', (e) => { if (!card.contains(e.relatedTarget)) card.classList.remove('album-card--drop'); });
    card.addEventListener('drop', (e) => {
      if (!dragHasFiles(e)) return;
      e.preventDefault();
      card.classList.remove('album-card--drop');
      uploader.open(name, [...e.dataTransfer.files]);
    });
  };
  for (const name of allowed) wire(name, cards.get(name));
}

// [{ title, items }] in display order: one untitled group (no grouping), the
// years newest first (the year of an album's last photo; undated last), or
// the collections A–Z (albums in none last). Albums keep the chosen sort.
function groupAlbums(albums, mode) {
  if (mode !== 'year' && mode !== 'collection') return [{ title: null, items: albums }];
  const keyOf = mode === 'year'
    ? (a) => (a.dateTo || a.dateFrom ? new Date(a.dateTo || a.dateFrom).getUTCFullYear() : null)
    : (a) => a.collection || null;
  const groups = new Map();
  for (const a of albums) {
    const k = keyOf(a);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(a);
  }
  const keys = [...groups.keys()].filter(k => k !== null)
    .sort((a, b) => (mode === 'year' ? b - a : String(a).localeCompare(String(b))));
  if (groups.has(null)) keys.push(null);
  const rest = mode === 'year' ? t('home.groupUndated') : t('home.groupOther');
  return keys.map(k => ({ title: k === null ? rest : String(k), items: groups.get(k) }));
}

// The latest published stories, newest first (hidden when there are none).
async function renderArticles() {
  const list = await getLatestArticles(6).catch(() => []);
  if (!list.length) return;
  const grid = document.getElementById('home-articles-grid');
  for (const a of list) grid.appendChild(createArticleCard(a, { showAlbum: true }));
  document.getElementById('home-articles').hidden = false;
}

// The latest album (by its last photo's date) across the top: its cover, big
// title, an "open" button. The header floats over it.
function renderHero(albums) {
  const latest = sortAlbums(albums.filter(a => a.cover && a.count > 0), 'recent')[0];
  if (!latest) return;
  const href  = `viewer.html?album=${encodeURIComponent(latest.name)}`;
  const dates = formatDateRange(latest.dateFrom, latest.dateTo);
  const meta  = t('album.photos', { n: latest.count, s: latest.count !== 1 ? 's' : '' }) + (dates ? ` · ${dates}` : '');
  hero.innerHTML = `
    <img class="home-hero-img" alt="" decoding="async">
    <div class="home-hero-text">
      <p class="home-hero-kicker">${esc(t('home.latest'))}</p>
      <h2 class="home-hero-title">${esc(latest.name)}</h2>
      <p class="home-hero-meta">${esc(meta)}</p>
      ${latest.description ? `<p class="home-hero-desc">${esc(latest.description)}</p>` : ''}
      <a class="home-hero-cta" href="${href}">${esc(t('home.open'))}
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
      </a>
    </div>`;
  const img = hero.querySelector('img');
  img.onload = () => hero.classList.add('loaded');
  img.src = latest.coverPreview || latest.cover;
  hero.hidden = false;
  document.body.classList.add('has-hero');
}

function renderAuth(user) {
  if (!user) {
    authEl.innerHTML = `
      <a href="/login.html" class="home-auth-btn home-auth-btn--login">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/>
          <circle cx="12" cy="7" r="4"/>
        </svg>
        ${t('nav.signIn')}
      </a>`;
    return;
  }
  // the name opens one's account; every user manages their own albums
  authEl.innerHTML = `
    <a href="account.html" class="home-auth-user" title="${esc(t('nav.account'))}">
      <span class="home-auth-dot"></span>
      ${esc(user.username)}
    </a>
    ${user.role !== 'admin' ? `
      <a href="/admin.html" class="home-auth-btn home-auth-btn--admin home-auth-btn--mine">${esc(t('nav.myAlbums'))}</a>` : ''}
    ${user.role === 'admin' ? `
      <a href="/admin.html" class="home-auth-btn home-auth-btn--admin">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="3"/>
          <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
        </svg>
        ${t('nav.admin')}
      </a>` : ''}
    <button id="home-logout-btn" class="home-auth-btn home-auth-btn--ghost">${t('nav.signOut')}</button>
  `;
  document.getElementById('home-logout-btn').addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.reload();
  });
}

function createMapCard() {
  const card = document.createElement('a');
  card.className = 'album-card';
  card.href = 'map.html';

  const visual = document.createElement('div');
  visual.className = 'album-card-map-visual';
  visual.innerHTML = `
    <svg class="album-card-map-dots" viewBox="0 0 260 174" xmlns="http://www.w3.org/2000/svg">
      ${_pin(52,  62,  '#ff8a5b', 0.9)}
      ${_pin(110, 44,  '#ff8a5b', 0.75)}
      ${_pin(168, 80,  '#ef4444', 1.0)}
      ${_pin(210, 52,  '#ff8a5b', 0.7)}
      ${_pin(78,  118, '#ff8a5b', 0.65)}
      ${_pin(145, 130, '#ff8a5b', 0.55)}
      ${_pin(225, 115, '#ff8a5b', 0.6)}
      ${_line(52,68, 110,50)}
      ${_line(110,50, 168,86)}
      ${_line(168,86, 210,58)}
    </svg>`;
  card.appendChild(visual);

  const info = document.createElement('div');
  info.className = 'album-card-info';
  const name = document.createElement('div');
  name.className = 'album-card-name';
  name.textContent = t('home.mapCard.name');
  const sub = document.createElement('div');
  sub.className = 'album-card-count';
  sub.textContent = t('home.mapCard.sub');
  info.appendChild(name);
  info.appendChild(sub);
  card.appendChild(info);

  return card;
}

function createGlobeCard() {
  const card = document.createElement('a');
  card.className = 'album-card';
  card.href = 'globe.html';

  const visual = document.createElement('div');
  visual.className = 'album-card-globe-visual';
  visual.innerHTML = `
    <svg viewBox="0 0 260 174" xmlns="http://www.w3.org/2000/svg" class="album-card-globe-svg">
      <defs>
        <radialGradient id="gGlow" cx="40%" cy="35%">
          <stop offset="0%"   stop-color="#1e40af" stop-opacity="0.6"/>
          <stop offset="100%" stop-color="#020818" stop-opacity="1"/>
        </radialGradient>
        <clipPath id="gClip"><circle cx="130" cy="87" r="62"/></clipPath>
      </defs>
      <!-- Globe base -->
      <circle cx="130" cy="87" r="62" fill="url(#gGlow)"/>
      <!-- Latitude lines -->
      <g clip-path="url(#gClip)" stroke="rgba(59,130,246,0.20)" stroke-width="0.7" fill="none">
        <ellipse cx="130" cy="87" rx="62" ry="9"/>
        <ellipse cx="130" cy="87" rx="62" ry="25"/>
        <ellipse cx="130" cy="87" rx="62" ry="46"/>
        <ellipse cx="130" cy="87" rx="62" ry="60"/>
        <line x1="68" y1="87" x2="192" y2="87"/>
      </g>
      <!-- Meridian arcs -->
      <g clip-path="url(#gClip)" stroke="rgba(59,130,246,0.18)" stroke-width="0.7" fill="none">
        <ellipse cx="130" cy="87" rx="20" ry="62"/>
        <ellipse cx="130" cy="87" rx="42" ry="62"/>
        <line x1="130" y1="25" x2="130" y2="149"/>
      </g>
      <!-- Globe outline -->
      <circle cx="130" cy="87" r="62" fill="none" stroke="rgba(59,130,246,0.55)" stroke-width="1"/>
      <!-- Atmosphere rim -->
      <circle cx="130" cy="87" r="64" fill="none" stroke="rgba(96,165,250,0.18)" stroke-width="3"/>
      <!-- Photo dots -->
      <circle cx="104" cy="76" r="2.5" fill="#3b82f6" opacity="0.9"/>
      <circle cx="104" cy="76" r="4"   fill="none" stroke="#93c5fd" stroke-width="1" opacity="0.5"/>
      <circle cx="150" cy="82" r="2.5" fill="#3b82f6" opacity="0.9"/>
      <circle cx="150" cy="82" r="4"   fill="none" stroke="#93c5fd" stroke-width="1" opacity="0.5"/>
      <circle cx="120" cy="96" r="2.5" fill="#3b82f6" opacity="0.9"/>
      <circle cx="163" cy="70" r="2.5" fill="#3b82f6" opacity="0.7"/>
      <circle cx="94"  cy="91" r="2.5" fill="#3b82f6" opacity="0.7"/>
    </svg>`;
  card.appendChild(visual);

  const info = document.createElement('div');
  info.className = 'album-card-info';
  const name = document.createElement('div');
  name.className = 'album-card-name';
  name.textContent = t('home.globeCard.name');
  const sub = document.createElement('div');
  sub.className = 'album-card-count';
  sub.textContent = t('home.globeCard.sub');
  info.appendChild(name);
  info.appendChild(sub);
  card.appendChild(info);

  return card;
}

function _pin(x, y, color, opacity) {
  return `
    <g opacity="${opacity}" transform="translate(${x - 7},${y - 18})">
      <path d="M7 0C3.7 0 1 2.7 1 6c0 4.2 6 11.5 6 11.5S13 10.2 13 6C13 2.7 10.3 0 7 0z"
            fill="${color}" stroke="rgba(255,255,255,0.5)" stroke-width="1"/>
      <circle cx="7" cy="6" r="2.5" fill="rgba(255,255,255,0.85)"/>
    </g>`;
}

function _line(x1, y1, x2, y2) {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"
                stroke="rgba(255,255,255,0.12)" stroke-width="1" stroke-dasharray="3 3"/>`;
}

// back from another page, restored whole from the browser's memory: load it
// again, with what changed meanwhile (an album just created…)
addEventListener('pageshow', (e) => { if (e.persisted) location.reload(); });

rememberScroll();
init();

showBuildTag({ footer: true });
