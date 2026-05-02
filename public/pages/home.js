import { createAlbumCard } from '../components/album-card.js';

const grid    = document.getElementById('album-grid');
const summary = document.getElementById('summary');

async function init() {
  try {
    const albums = await fetch('/api/albums').then(r => r.json());

    const totalPhotos = albums.reduce((n, a) => n + a.count, 0);
    summary.textContent =
      `${albums.length} album${albums.length !== 1 ? 's' : ''} · ${totalPhotos} photo${totalPhotos !== 1 ? 's' : ''}`;

    // Map card always appears first
    grid.appendChild(createMapCard());

    if (albums.length === 0) {
      grid.insertAdjacentHTML('beforeend',
        '<p class="grid-empty">Ajoutez des dossiers dans <code>photos/</code> pour créer des albums.</p>');
      return;
    }

    albums.forEach(album => grid.appendChild(createAlbumCard(album)));
  } catch (err) {
    grid.innerHTML = '<p class="grid-empty">Impossible de charger les albums.</p>';
    console.error(err);
  }
}

function createMapCard() {
  const card = document.createElement('a');
  card.className = 'album-card';
  card.href = 'map.html';

  // Background: dark map-like gradient + grid + decorative pins
  const visual = document.createElement('div');
  visual.className = 'album-card-map-visual';

  // SVG: decorative dots scattered like map pins
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
