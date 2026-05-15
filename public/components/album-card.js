const LOCK_SVG = `<svg viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path d="M8 1a2 2 0 0 1 2 2v4H6V3a2 2 0 0 1 2-2zm3 6V3a3 3 0 0 0-6 0v4a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z"/>
</svg>`;

/**
 * Creates an album card element linking to the viewer page.
 * @param {Object} album - { name, count, cover, coverPreview, visibility }
 * @returns {HTMLAnchorElement}
 */
export function createAlbumCard(album) {
  const card = document.createElement('a');
  card.className = 'album-card';
  card.href = `viewer.html?album=${encodeURIComponent(album.name)}`;

  if (album.cover) {
    const img = document.createElement('img');
    img.alt = album.name;
    img.onload = () => img.classList.add('loaded');
    img.src = album.coverPreview || album.cover;
    card.appendChild(img);
  } else {
    const empty = document.createElement('div');
    empty.className = 'album-card-empty';
    empty.textContent = 'Album vide';
    card.appendChild(empty);
  }

  if (album.visibility === 'restricted') {
    const lock = document.createElement('div');
    lock.className = 'album-card-lock';
    lock.title = 'Album restreint';
    lock.innerHTML = LOCK_SVG;
    card.appendChild(lock);
  }

  const info = document.createElement('div');
  info.className = 'album-card-info';

  const name = document.createElement('div');
  name.className = 'album-card-name';
  name.textContent = album.name;

  const count = document.createElement('div');
  count.className = 'album-card-count';
  count.textContent = `${album.count} photo${album.count !== 1 ? 's' : ''}`;

  info.appendChild(name);
  info.appendChild(count);
  card.appendChild(info);

  return card;
}
