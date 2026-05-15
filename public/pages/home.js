import { createAlbumCard } from '../components/album-card.js';

const grid   = document.getElementById('album-grid');
const sumEl  = document.getElementById('summary');
const authEl = document.getElementById('home-auth');

function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

async function init() {
  const [authData, albums] = await Promise.all([
    fetch('/api/auth/me').then(r => r.json()).catch(() => ({ user: null })),
    fetch('/api/albums').then(r => r.json()).catch(() => []),
  ]);

  renderAuth(authData.user);

  const totalPhotos = albums.reduce((n, a) => n + a.count, 0);
  sumEl.textContent =
    `${albums.length} album${albums.length !== 1 ? 's' : ''} · ${totalPhotos} photo${totalPhotos !== 1 ? 's' : ''}`;

  grid.appendChild(createMapCard());

  if (albums.length === 0) {
    grid.insertAdjacentHTML('beforeend',
      '<p class="grid-empty">Ajoutez des dossiers dans <code>photos/</code> pour créer des albums.</p>');
    return;
  }

  albums.forEach(album => grid.appendChild(createAlbumCard(album)));
}

function renderAuth(user) {
  if (!user) {
    authEl.innerHTML = `
      <a href="/login.html" class="home-auth-btn home-auth-btn--login">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/>
          <circle cx="12" cy="7" r="4"/>
        </svg>
        Connexion
      </a>`;
    return;
  }
  authEl.innerHTML = `
    <span class="home-auth-user">
      <span class="home-auth-dot"></span>
      ${esc(user.username)}
    </span>
    ${user.role === 'admin' ? `
      <a href="/admin.html" class="home-auth-btn home-auth-btn--admin">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="3"/>
          <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
        </svg>
        Admin
      </a>` : ''}
    <button id="home-logout-btn" class="home-auth-btn home-auth-btn--ghost">Déconnexion</button>
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
      ${_pin(52,  62,  '#3b82f6', 0.9)}
      ${_pin(110, 44,  '#3b82f6', 0.75)}
      ${_pin(168, 80,  '#ef4444', 1.0)}
      ${_pin(210, 52,  '#3b82f6', 0.7)}
      ${_pin(78,  118, '#3b82f6', 0.65)}
      ${_pin(145, 130, '#3b82f6', 0.55)}
      ${_pin(225, 115, '#3b82f6', 0.6)}
      ${_line(52,68, 110,50)}
      ${_line(110,50, 168,86)}
      ${_line(168,86, 210,58)}
    </svg>`;
  card.appendChild(visual);

  const info = document.createElement('div');
  info.className = 'album-card-info';
  const name = document.createElement('div');
  name.className = 'album-card-name';
  name.textContent = 'Carte';
  const sub = document.createElement('div');
  sub.className = 'album-card-count';
  sub.textContent = 'Toutes les localisations';
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

init();
