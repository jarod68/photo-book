import { buildMarkerIcon, shortLocation } from '../components/map-marker.js';

async function init() {
  const photos = await fetch('/api/map').then(r => r.json());

  const countEl = document.getElementById('map-page-count');
  countEl.textContent = photos.length
    ? `${photos.length} photo${photos.length > 1 ? 's' : ''} géolocalisée${photos.length > 1 ? 's' : ''}`
    : 'Aucune photo géolocalisée';

  const map = L.map('world-map', {
    minZoom:       2,
    maxZoom:       18,
    worldCopyJump: true,
  }).setView([20, 10], 2);

  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom:     19,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);

  if (photos.length === 0) return;

  // Group by album for colour-coding could be a future enhancement;
  // for now all pins are blue.
  photos.forEach(photo => {
    const icon = buildMarkerIcon(photo.albumIndex + 1, false, shortLocation(photo.location));

    L.marker([photo.gps.lat, photo.gps.lng], { icon })
      .addTo(map)
      .bindPopup(() => buildPopup(photo), { maxWidth: 200, minWidth: 160 });
  });
}

function buildPopup(photo) {
  const wrap = document.createElement('div');
  wrap.className = 'map-popup-inner';

  const albumLabel = document.createElement('span');
  albumLabel.className = 'map-popup-album';
  albumLabel.textContent = photo.album;
  wrap.appendChild(albumLabel);

  const title = document.createElement('strong');
  title.textContent = photo.name;
  wrap.appendChild(title);

  if (photo.previewUrl) {
    const img = document.createElement('img');
    img.src = photo.previewUrl;
    img.alt = photo.name;
    wrap.appendChild(img);
  }

  const link = document.createElement('a');
  link.className = 'map-popup-view';
  link.textContent = 'Voir dans l\'album';
  link.href = `viewer.html?album=${encodeURIComponent(photo.album)}&photo=${encodeURIComponent(photo.filename)}`;
  wrap.appendChild(link);

  return wrap;
}

init();
