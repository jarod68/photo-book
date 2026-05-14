/**
 * Creates an album card element linking to the viewer page.
 * @param {Object} album - { name, count, cover }
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
    empty.textContent = 'Empty album';
    card.appendChild(empty);
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
