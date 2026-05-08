import { buildMarkerIcon } from '../components/map-marker.js';
import { getMapPhotos }   from '../api/client.js';
import {
  haversineKm, catmullRom, cubicSample,
  centroid, buildSegments, clusterSegment,
} from '../utils/map-math.js';

const ROUTE_COLOR = '#3b82f6';
const ARROW_TS    = [0.2, 0.5, 0.8];

// ── Icône flèche directionnelle (suit la tangente de la courbe) ───────────────
function arrowIcon(deg) {
  return L.divIcon({
    html: `<div style="transform:rotate(${deg.toFixed(1)}deg);transform-origin:center;line-height:0">
             <svg viewBox="0 0 16 22" width="16" height="22" xmlns="http://www.w3.org/2000/svg">
               <polygon points="8,0 15.5,19 8,13.5 0.5,19"
                 fill="${ROUTE_COLOR}"
                 stroke="rgba(255,255,255,0.95)" stroke-width="2" stroke-linejoin="round"/>
             </svg>
           </div>`,
    className:  '',
    iconSize:   [16, 22],
    iconAnchor: [8, 11],
  });
}

// ── Dessin du tracé ───────────────────────────────────────────────────────────
function drawRoute(layer, photos) {
  buildSegments(photos).forEach(segment => {
    const nodes     = clusterSegment(segment);
    const centroids = nodes.map(centroid);

    // Pin discret pour les nœuds multi-photos (même zone géographique)
    nodes.forEach((group, gi) => {
      if (group.length < 2) return;
      const c = centroids[gi];
      L.circleMarker([c.lat, c.lng], {
        radius:      6,
        fillColor:   '#94a3b8',
        color:       '#ffffff',
        weight:      2,
        opacity:     0.9,
        fillOpacity: 0.75,
        interactive: false,
      }).addTo(layer);
    });

    // Tracé Catmull-Rom entre les barycentres consécutifs
    for (let i = 0; i < centroids.length - 1; i++) {
      const a = centroids[i];
      const b = centroids[i + 1];

      if (a.lat === b.lat && a.lng === b.lng) continue;

      const { pts, cp1, cp2, P0, P1 } = catmullRom(centroids, i);

      // Halo blanc pour lisibilité
      L.polyline(pts, {
        color: '#ffffff', weight: 7, opacity: 0.28, lineCap: 'round',
      }).addTo(layer);

      // Ligne en tirets
      L.polyline(pts, {
        color: ROUTE_COLOR, weight: 3, opacity: 0.9,
        dashArray: '12 8', lineCap: 'round', lineJoin: 'round',
      }).addTo(layer);

      // Flèches directionnelles le long de la courbe
      ARROW_TS.forEach(t => {
        const { lat, lng, deg } = cubicSample(t, P0, cp1, cp2, P1);
        L.marker([lat, lng], {
          icon:         arrowIcon(deg),
          interactive:  false,
          zIndexOffset: -500,
        }).addTo(layer);
      });
    }
  });
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  const photos = await getMapPhotos();

  const countEl = document.getElementById('map-page-count');
  countEl.textContent = photos.length
    ? `${photos.length} photo${photos.length > 1 ? 's' : ''} géolocalisée${photos.length > 1 ? 's' : ''}`
    : 'Aucune photo géolocalisée';

  const map = L.map('world-map', {
    minZoom: 2, maxZoom: 18, worldCopyJump: true,
  }).setView([20, 10], 2);

  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);

  if (photos.length === 0) return;

  // Calque du tracé (togglable)
  const routeLayer = L.layerGroup().addTo(map);
  drawRoute(routeLayer, photos);

  // Bouton de bascule
  const toggleBtn = document.getElementById('route-toggle');
  toggleBtn.addEventListener('click', () => {
    const visible = map.hasLayer(routeLayer);
    if (visible) {
      map.removeLayer(routeLayer);
      toggleBtn.classList.remove('active');
      toggleBtn.title = 'Afficher le tracé';
    } else {
      map.addLayer(routeLayer);
      toggleBtn.classList.add('active');
      toggleBtn.title = 'Masquer le tracé';
    }
  });

  // Numérotation par album, ordonnée par date de prise de vue
  // Label : "NomAlbum-N"  ex. "Costa Rica-1"
  const albumGroups = {};
  photos.forEach(p => { (albumGroups[p.album] ??= []).push(p); });

  const seqNum = new Map();
  Object.values(albumGroups).forEach(group => {
    group
      .slice()
      .sort((a, b) => {
        if (!a.date && !b.date) return 0;
        if (!a.date) return 1;
        if (!b.date) return -1;
        return new Date(a.date) - new Date(b.date);
      })
      .forEach((p, i) => seqNum.set(`${p.album}/${p.filename}`, i + 1));
  });

  // Markers photos par-dessus le tracé
  photos.forEach(photo => {
    const n     = seqNum.get(`${photo.album}/${photo.filename}`) ?? (photo.albumIndex + 1);
    const label = photo.album + '-' + n;
    const icon  = buildMarkerIcon(n, false, label);
    L.marker([photo.gps.lat, photo.gps.lng], { icon })
      .addTo(map)
      .bindPopup(() => buildPopup(photo), { maxWidth: 200, minWidth: 160 });
  });
}

// ── Popup ─────────────────────────────────────────────────────────────────────
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

  if (photo.date) {
    const dateEl = document.createElement('span');
    dateEl.className = 'map-popup-date';
    dateEl.textContent = new Date(photo.date).toLocaleDateString('fr-FR', {
      day: 'numeric', month: 'short', year: 'numeric',
    });
    wrap.appendChild(dateEl);
  }

  if (photo.previewUrl) {
    const img = document.createElement('img');
    img.src = photo.previewUrl;
    img.alt = photo.name;
    wrap.appendChild(img);
  }

  const link = document.createElement('a');
  link.className = 'map-popup-view';
  link.textContent = "Voir dans l'album";
  link.href = `viewer.html?album=${encodeURIComponent(photo.album)}&photo=${encodeURIComponent(photo.filename)}`;
  wrap.appendChild(link);

  return wrap;
}

init();
