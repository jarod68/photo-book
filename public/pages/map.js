// @ts-check
import { t, getLang, applyTranslations, initLangSwitcher } from '../utils/i18n.js';
import '../utils/admin-shortcut.js';
import { markerElement, clusterElement } from '../components/map-marker.js';
import { getMapPhotos }   from '../api/client.js';
import { routeData, addRouteLayers, setRouteVisible } from '../utils/route.js';
import { showBuildTag } from '../utils/build-tag.js';
import { createMap } from '../utils/base-map.js';
import { wireBack, pageState, saveState } from '../utils/back.js';

applyTranslations();
initLangSwitcher('lang-switcher');

// ── Photos: clustered GeoJSON source, drawn as HTML pins / badges ─────────────
function addPhotos(ml, map, photos, labels) {
  map.addSource('photos', {
    type: 'geojson', cluster: true, clusterRadius: 50, clusterMaxZoom: 15,
    data: { type: 'FeatureCollection', features: photos.map((p, i) => ({
      type: 'Feature', properties: { i }, geometry: { type: 'Point', coordinates: [p.gps.lng, p.gps.lat] },
    })) },
  });
  // an invisible layer, so the source's features (and clusters) are computed
  map.addLayer({ id: 'photos-hit', type: 'circle', source: 'photos', paint: { 'circle-radius': 0, 'circle-opacity': 0 } });

  const markers = new Map();   // "c<cluster id>" / "p<index>" → Marker
  let popup = null;
  const openPopup = (coords, content) => {
    popup?.remove();
    popup = new ml.Popup({ className: 'pb-popup', offset: [0, -40], maxWidth: '240px' })
      .setLngLat(coords).setDOMContent(content).addTo(map);
  };

  const sync = () => {
    if (!map.isSourceLoaded('photos')) return;
    const seen = new Set();
    for (const f of map.querySourceFeatures('photos')) {
      const { cluster, cluster_id: cid, point_count: count, i } = f.properties;
      const key = cluster ? `c${cid}` : `p${i}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (markers.has(key)) continue;
      let el, anchor;
      if (cluster) {
        el = clusterElement(count);
        anchor = 'center';
        el.addEventListener('click', async (e) => {
          e.stopPropagation();
          const src = map.getSource('photos');
          const zoom = await src.getClusterExpansionZoom(cid);
          if (zoom <= 15 && map.getZoom() < 16) { map.easeTo({ center: f.geometry.coordinates, zoom: zoom + 0.2 }); return; }
          // photos at the very same spot: list them
          const leaves = await src.getClusterLeaves(cid, 20, 0);
          openPopup(f.geometry.coordinates, buildList(leaves.map((l) => photos[l.properties.i])));
        });
      } else {
        const p = photos[i];
        el = markerElement(labels.get(p).n, false, labels.get(p).label);
        anchor = 'bottom';
        el.addEventListener('click', (e) => { e.stopPropagation(); openPopup([p.gps.lng, p.gps.lat], buildPopup(p)); });
      }
      markers.set(key, new ml.Marker({ element: el, anchor }).setLngLat(f.geometry.coordinates).addTo(map));
    }
    for (const [key, m] of markers) if (!seen.has(key)) { m.remove(); markers.delete(key); }
  };
  map.on('render', sync);
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  const photos = await getMapPhotos();

  const countEl = document.getElementById('map-page-count');
  countEl.textContent = photos.length
    ? t('map.photos', { n: photos.length, s: photos.length > 1 ? 's' : '' })
    : t('map.noPhotos');

  // back from a photo: the map where it was
  const saved = pageState().view;
  const { ml, map } = await createMap(document.getElementById('world-map'), {
    center: saved ? [saved.lng, saved.lat] : [10, 20], zoom: saved?.zoom ?? 1, minZoom: 0.5, maxZoom: 18,
  });
  map.on('moveend', () => {
    const c = map.getCenter();
    saveState({ view: { lat: +c.lat.toFixed(5), lng: +c.lng.toFixed(5), zoom: +map.getZoom().toFixed(2) } });
  });
  // handle for the end-to-end tests
  /** @type {any} */ (document.getElementById('world-map')).mapView = map;

  if (photos.length === 0) return;

  // Per-album numbering, sorted by capture date — label "AlbumName-N" (e.g. "Costa Rica-1")
  const albumGroups = {};
  photos.forEach(p => { (albumGroups[p.album] ??= []).push(p); });
  const labels = new Map();
  Object.values(albumGroups).forEach(group => {
    group
      .slice()
      .sort((a, b) => {
        if (!a.date && !b.date) return 0;
        if (!a.date) return 1;
        if (!b.date) return -1;
        return Date.parse(a.date) - Date.parse(b.date);
      })
      .forEach((p, i) => labels.set(p, { n: i + 1, label: `${p.album}-${i + 1}` }));
  });

  const ready = () => { addRouteLayers(map, routeData(photos)); addPhotos(ml, map, photos, labels); };
  if (map.isStyleLoaded()) ready(); else map.once('load', ready);

  // Route toggle
  const toggleBtn = document.getElementById('route-toggle');
  toggleBtn.addEventListener('click', () => {
    const visible = toggleBtn.classList.toggle('active');
    setRouteVisible(map, visible);
    toggleBtn.title = t(visible ? 'map.hideRoute' : 'map.showRoute');
  });
}

// ── Popups ────────────────────────────────────────────────────────────────────
function buildPopup(photo) {
  const locale = { fr: 'fr-FR', en: 'en-US', es: 'es-ES' }[getLang()] ?? 'en-US';
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
    dateEl.textContent = new Date(photo.date).toLocaleDateString(locale, {
      day: 'numeric', month: 'short', year: 'numeric',
    });
    wrap.appendChild(dateEl);
  }

  if (photo.previewUrl) {
    const img = document.createElement('img');
    img.src = photo.thumbUrl || photo.previewUrl;
    img.alt = photo.name;
    wrap.appendChild(img);
  }

  wrap.appendChild(viewLink(photo));
  return wrap;
}

// several photos at the very same spot
function buildList(list) {
  const wrap = document.createElement('div');
  wrap.className = 'map-popup-inner map-popup-list';
  for (const p of list) {
    const a = document.createElement('a');
    a.href = `viewer.html?album=${encodeURIComponent(p.album)}&photo=${encodeURIComponent(p.filename)}`;
    a.title = p.name;
    const img = document.createElement('img');
    img.src = p.thumbUrl || p.previewUrl;
    img.alt = p.name;
    a.appendChild(img);
    wrap.appendChild(a);
  }
  return wrap;
}

function viewLink(photo) {
  const link = document.createElement('a');
  link.className = 'map-popup-view';
  link.textContent = t('map.viewInAlbum');
  link.href = `viewer.html?album=${encodeURIComponent(photo.album)}&photo=${encodeURIComponent(photo.filename)}`;
  return link;
}

wireBack(document.querySelector('.map-page-back'));
init();

showBuildTag();
