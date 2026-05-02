import { createAlbumCard } from '../components/album-card.js';

const grid    = document.getElementById('album-grid');
const summary = document.getElementById('summary');

async function init() {
  try {
    const albums = await fetch('/api/albums').then(r => r.json());

    const totalPhotos = albums.reduce((n, a) => n + a.count, 0);
    summary.textContent =
      `${albums.length} album${albums.length !== 1 ? 's' : ''} · ${totalPhotos} photo${totalPhotos !== 1 ? 's' : ''}`;

    if (albums.length === 0) {
      grid.innerHTML =
        '<p class="grid-empty">Ajoutez des dossiers dans <code>photos/</code> pour créer des albums.</p>';
      return;
    }

    albums.forEach(album => grid.appendChild(createAlbumCard(album)));
  } catch (err) {
    grid.innerHTML = '<p class="grid-empty">Impossible de charger les albums.</p>';
    console.error(err);
  }
}

init();
