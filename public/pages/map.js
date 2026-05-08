import { buildMarkerIcon } from '../components/map-marker.js';
import { getMapPhotos }   from '../api/client.js';

const MAX_DAYS    = 21;    // fenêtre consécutive max : 3 semaines
const MAX_KM      = 400;   // rayon max entre deux points consécutifs
const CLUSTER_KM  = 5;     // rayon de regroupement de photos proches
const ROUTE_COLOR = '#3b82f6'; // bleu cobalt — cohérent avec les pins
const ARROW_TS    = [0.2, 0.5, 0.8]; // positions des flèches sur la courbe (t ∈ ]0,1[)

// ── Haversine distance (km) ───────────────────────────────────────────────────
function haversineKm(lat1, lng1, lat2, lng2) {
  const R   = 6371;
  const d2r = Math.PI / 180;
  const dLat = (lat2 - lat1) * d2r;
  const dLng = (lng2 - lng1) * d2r;
  const a = Math.sin(dLat / 2) ** 2
          + Math.cos(lat1 * d2r) * Math.cos(lat2 * d2r) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Bézier cubique avec tangentes Catmull-Rom ─────────────────────────────────
// Chaque nœud partage la même direction tangente entre la courbe entrante et
// sortante → les segments consécutifs ne se croisent jamais.
function catmullRom(centroids, i, steps = 40) {
  const n  = centroids.length;
  const P0 = centroids[i];
  const P1 = centroids[i + 1];
  // Points fantômes aux extrémités pour avoir une tangente cohérente
  const prev = i > 0     ? centroids[i - 1] : { lat: 2 * P0.lat - P1.lat, lng: 2 * P0.lng - P1.lng };
  const next = i + 2 < n ? centroids[i + 2] : { lat: 2 * P1.lat - P0.lat, lng: 2 * P1.lng - P0.lng };

  // Tangentes Catmull-Rom : direction = voisin suivant − voisin précédent
  const tx0 = (P1.lat - prev.lat) / 2;
  const ty0 = (P1.lng - prev.lng) / 2;
  const tx1 = (next.lat - P0.lat) / 2;
  const ty1 = (next.lng - P0.lng) / 2;

  // Longueur du segment courant → points de contrôle plafonnés à 30 % du seg.
  const segLen = Math.sqrt((P1.lat - P0.lat) ** 2 + (P1.lng - P0.lng) ** 2) || 1e-9;
  const len0   = Math.sqrt(tx0 * tx0 + ty0 * ty0) || 1e-9;
  const len1   = Math.sqrt(tx1 * tx1 + ty1 * ty1) || 1e-9;
  const cap    = segLen * 0.30;
  const s0     = Math.min(cap, len0) / (3 * len0);
  const s1     = Math.min(cap, len1) / (3 * len1);

  const cp1 = { lat: P0.lat + tx0 * s0, lng: P0.lng + ty0 * s0 };
  const cp2 = { lat: P1.lat - tx1 * s1, lng: P1.lng - ty1 * s1 };

  const pts = [];
  for (let j = 0; j <= steps; j++) {
    const t = j / steps;
    const u = 1 - t;
    pts.push([
      u*u*u * P0.lat + 3*u*u*t * cp1.lat + 3*u*t*t * cp2.lat + t*t*t * P1.lat,
      u*u*u * P0.lng + 3*u*u*t * cp1.lng + 3*u*t*t * cp2.lng + t*t*t * P1.lng,
    ]);
  }

  return { pts, cp1, cp2, P0, P1 };
}

// ── Position + cap (degrés) sur une Bézier cubique en t ──────────────────────
function cubicSample(t, P0, cp1, cp2, P1) {
  const u    = 1 - t;
  const lat  = u*u*u * P0.lat + 3*u*u*t * cp1.lat + 3*u*t*t * cp2.lat + t*t*t * P1.lat;
  const lng  = u*u*u * P0.lng + 3*u*u*t * cp1.lng + 3*u*t*t * cp2.lng + t*t*t * P1.lng;
  const dlat = 3*u*u * (cp1.lat - P0.lat) + 6*u*t * (cp2.lat - cp1.lat) + 3*t*t * (P1.lat - cp2.lat);
  const dlng = 3*u*u * (cp1.lng - P0.lng) + 6*u*t * (cp2.lng - cp1.lng) + 3*t*t * (P1.lng - cp2.lng);
  const deg  = (Math.atan2(dlng, dlat) * 180 / Math.PI + 360) % 360;
  return { lat, lng, deg };
}

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

// ── Segmentation des photos par date & distance ───────────────────────────────
function buildSegments(photos) {
  const dated = photos
    .filter(p => p.date && p.gps)
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  if (dated.length < 2) return [];

  const segments = [];
  let current = [dated[0]];

  for (let i = 1; i < dated.length; i++) {
    const prev = current[current.length - 1];
    const curr = dated[i];
    const days = (new Date(curr.date) - new Date(prev.date)) / 86_400_000;
    const km   = haversineKm(prev.gps.lat, prev.gps.lng, curr.gps.lat, curr.gps.lng);

    if (days <= MAX_DAYS && km <= MAX_KM) {
      current.push(curr);
    } else {
      if (current.length >= 2) segments.push(current);
      current = [curr];
    }
  }
  if (current.length >= 2) segments.push(current);

  return segments;
}

// ── Regroupement des photos proches en nœuds ─────────────────────────────────
function clusterSegment(segment) {
  const nodes = [];
  let current = [segment[0]];

  for (let i = 1; i < segment.length; i++) {
    const ref = current[0].gps;
    const p   = segment[i].gps;
    if (haversineKm(ref.lat, ref.lng, p.lat, p.lng) <= CLUSTER_KM) {
      current.push(segment[i]);
    } else {
      nodes.push(current);
      current = [segment[i]];
    }
  }
  nodes.push(current);
  return nodes;
}

function centroid(photos) {
  return {
    lat: photos.reduce((s, p) => s + p.gps.lat, 0) / photos.length,
    lng: photos.reduce((s, p) => s + p.gps.lng, 0) / photos.length,
  };
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
