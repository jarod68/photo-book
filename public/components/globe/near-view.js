/**
 * Globe page — the "near" view (MapLibre GL, globe projection): from a few
 * hundred kilometres up down to the street, with free, keyless tiles:
 *  - Satellite: EOxCloudless 2024 (Sentinel-2, ~10 m), with country borders
 *    and place names from OpenFreeMap's vector tiles drawn over it;
 *  - Map: OpenFreeMap "Liberty" (OpenStreetMap data), down to the street.
 * Photos: clustered GeoJSON source drawn as round thumbnails (HTML markers);
 * a click opens the photo card, or zooms into a group.
 * MapLibre (1.5 MB) is imported only when this view is first needed.
 */
const OFM = 'https://tiles.openfreemap.org';
const EOX_TILES = 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg';
const EOX_ATTRIBUTION = '<a href="https://cloudless.eox.at" target="_blank" rel="noopener">EOxCloudless 2024</a> by EOX IT Services GmbH '
  + '(contains modified Copernicus Sentinel data 2024), CC BY-NC-SA 4.0';
const OSM_ATTRIBUTION = '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> '
  + '© <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> '
  + 'Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';

export const FAR_ZOOM = 2.2;               // zooming out below this goes back to space
const PHOTO_ZOOM = 16;                     // flying to a photo
const SKY = { 'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 4, 1, 7, 0] };

const nameExpr = (lang) => ['coalesce', ['get', `name:${lang}`], ['get', 'name:latin'], ['get', 'name']];

// Satellite imagery + borders and place names from the OpenMapTiles schema.
function satelliteStyle(lang) {
  const font = ['Noto Sans Regular'], bold = ['Noto Sans Bold'];
  const halo = { 'text-color': '#fff', 'text-halo-color': 'rgba(0,0,0,0.75)', 'text-halo-width': 1.4 };
  return {
    version: 8,
    projection: { type: 'globe' },
    sky: SKY,
    glyphs: `${OFM}/fonts/{fontstack}/{range}.pbf`,
    sources: {
      sat: { type: 'raster', tiles: [EOX_TILES], tileSize: 256, maxzoom: 16, attribution: EOX_ATTRIBUTION },
      omt: { type: 'vector', url: `${OFM}/planet`, attribution: OSM_ATTRIBUTION },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#000' } },
      { id: 'sat', type: 'raster', source: 'sat', paint: { 'raster-fade-duration': 200 } },
      { id: 'borders', type: 'line', source: 'omt', 'source-layer': 'boundary',
        filter: ['all', ['==', ['get', 'admin_level'], 2], ['!=', ['get', 'maritime'], 1]],
        paint: { 'line-color': 'rgba(255,255,255,0.55)', 'line-width': ['interpolate', ['linear'], ['zoom'], 2, 0.6, 8, 1.4] } },
      { id: 'roads', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 12,
        filter: ['match', ['get', 'class'], ['motorway', 'trunk', 'primary', 'secondary'], true, false],
        paint: { 'line-color': 'rgba(255,240,200,0.35)', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.6, 16, 2.4] } },
      { id: 'countries', type: 'symbol', source: 'omt', 'source-layer': 'place', maxzoom: 7,
        filter: ['==', ['get', 'class'], 'country'],
        layout: { 'text-field': nameExpr(lang), 'text-font': bold, 'text-size': ['interpolate', ['linear'], ['zoom'], 2, 11, 6, 16],
          'text-transform': 'uppercase', 'text-letter-spacing': 0.08 },
        paint: halo },
      { id: 'cities', type: 'symbol', source: 'omt', 'source-layer': 'place', minzoom: 4,
        filter: ['match', ['get', 'class'], ['city', 'town'], true, false],
        layout: { 'text-field': nameExpr(lang), 'text-font': font, 'text-size': ['interpolate', ['linear'], ['zoom'], 4, 11, 12, 16],
          'symbol-sort-key': ['get', 'rank'] },
        paint: halo },
      { id: 'villages', type: 'symbol', source: 'omt', 'source-layer': 'place', minzoom: 11,
        filter: ['match', ['get', 'class'], ['village', 'suburb', 'neighbourhood'], true, false],
        layout: { 'text-field': nameExpr(lang), 'text-font': font, 'text-size': 12 },
        paint: halo },
    ],
  };
}

// OpenFreeMap Liberty, on the globe, with names in the reader's language.
async function mapStyle(lang) {
  const style = await fetch(`${OFM}/styles/liberty`).then((r) => r.json());
  style.projection = { type: 'globe' };
  style.sky = SKY;
  for (const l of style.layers) {
    const tf = l.layout?.['text-field'];
    if (tf && JSON.stringify(tf).includes('name')) l.layout['text-field'] = nameExpr(lang);
  }
  return style;
}

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export class NearView {
  /**
   * @param {HTMLElement} container
   * @param {{ photos: object[], lang: string, t: Function, onFar: Function }} opts
   *   onFar({ lat, lng, zoom }): the user zoomed out below FAR_ZOOM
   */
  constructor(container, { photos, lang, t, onFar, onPoint = () => {} }) {
    Object.assign(this, { container, photos, lang, t, onFar, onPoint });
    this.mode = 'satellite';
    this.markers = new Map();        // "c<cluster id>" / "p<photo index>" → maplibregl.Marker
    this.ready = null;
  }

  /** Create the map (first time) and show `center` / `zoom` without animation. */
  async show({ lat, lng, zoom }) {
    if (!this.ready) this.ready = this.create(lat, lng, zoom);
    await this.ready;
    this.map.jumpTo({ center: [lng, lat], zoom });
    this.map.resize();
  }

  /** Download MapLibre ahead of time (idle), so the first switch is quick. */
  preload() {
    this.module ??= import('maplibre-gl');
    return this.module;
  }

  async create(lat, lng, zoom) {
    const ml = this.ml = await this.preload();
    this.map = new ml.Map({
      container: this.container,
      style: satelliteStyle(this.lang),
      center: [lng, lat], zoom,
      maxZoom: 19,
      attributionControl: { compact: true },
      fadeDuration: 150,
    });
    this.map.addControl(new ml.NavigationControl({ visualizePitch: true }), 'top-right');
    this.map.on('style.load', () => this.addPhotos());
    this.map.on('render', () => this.syncMarkers());
    // pointer over the map / tap on it (time-zone card): page coordinates
    const at = (e, tap) => {
      const r = this.container.getBoundingClientRect();
      this.onPoint({ lat: e.lngLat.lat, lng: e.lngLat.lng, x: r.left + e.point.x, y: r.top + e.point.y, tap });
    };
    this.map.on('mousemove', (e) => at(e, false));
    this.map.on('mouseout', () => this.onPoint(null));
    this.map.on('click', (e) => { if (e.originalEvent.pointerType !== 'mouse') at(e, true); });
    // back to space when the user zooms out far enough
    this.map.on('zoom', (e) => {
      if (e.originalEvent && this.map.getZoom() < FAR_ZOOM) {
        const c = this.map.getCenter();
        this.onFar({ lat: c.lat, lng: c.lng, zoom: this.map.getZoom() });
      }
    });
    await new Promise((r) => this.map.once('load', r));
  }

  addPhotos() {
    if (this.map.getSource('photos')) return;
    this.map.addSource('photos', {
      type: 'geojson', cluster: true, clusterRadius: 56, clusterMaxZoom: 17,
      data: {
        type: 'FeatureCollection',
        features: this.photos.map((p, i) => ({ type: 'Feature', id: i, properties: { i }, geometry: { type: 'Point', coordinates: [p.gps.lng, p.gps.lat] } })),
      },
    });
    // an invisible layer, so the source's features (and clusters) are computed
    this.map.addLayer({ id: 'photos-hit', type: 'circle', source: 'photos', paint: { 'circle-radius': 0, 'circle-opacity': 0 } });
  }

  async setMode(mode) {
    if (mode === this.mode || !this.map) return;
    this.mode = mode;
    this.clearMarkers();
    this.map.setStyle(mode === 'map' ? await mapStyle(this.lang) : satelliteStyle(this.lang), { diff: false });
  }

  clearMarkers() {
    for (const m of this.markers.values()) m.remove();
    this.markers.clear();
  }

  // One HTML marker per cluster / single photo of the loaded tiles.
  syncMarkers() {
    if (!this.map.getSource('photos') || !this.map.isSourceLoaded('photos')) return;
    const seen = new Set();
    for (const f of this.map.querySourceFeatures('photos')) {
      const { cluster, cluster_id: cid, point_count: count, i } = f.properties;
      const key = cluster ? `c${cid}` : `p${i}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (this.markers.has(key)) continue;
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'near-marker';
      if (cluster) {
        el.innerHTML = `<span class="near-marker-count">${count > 99 ? '99+' : count}</span>`;
        this.map.getSource('photos').getClusterLeaves(cid, 1, 0).then((leaves) => {
          const p = this.photos[leaves[0]?.properties.i];
          if (p?.thumbUrl) el.style.backgroundImage = `url("${p.thumbUrl}")`;
        }).catch(() => {});
        el.addEventListener('click', (e) => { e.stopPropagation(); this.openCluster(cid, f.geometry.coordinates); });
      } else {
        const p = this.photos[i];
        if (p.thumbUrl) el.style.backgroundImage = `url("${p.thumbUrl}")`;
        el.setAttribute('aria-label', p.name || p.filename);
        el.addEventListener('click', (e) => { e.stopPropagation(); this.openPhoto(p); });
      }
      this.markers.set(key, new this.ml.Marker({ element: el }).setLngLat(f.geometry.coordinates).addTo(this.map));
    }
    for (const [key, m] of this.markers) if (!seen.has(key)) { m.remove(); this.markers.delete(key); }
  }

  async openCluster(cid, coords) {
    const src = this.map.getSource('photos');
    const zoom = await src.getClusterExpansionZoom(cid);
    if (zoom <= 17 && this.map.getZoom() < 17.5) {
      this.map.easeTo({ center: coords, zoom: Math.min(zoom + 0.3, 18), duration: 700 });
      return;
    }
    // photos taken at the very same spot: list them
    const leaves = await src.getClusterLeaves(cid, 12, 0);
    const html = leaves.map((l) => this.photoLink(this.photos[l.properties.i], true)).join('');
    this.popup(coords, `<div class="near-popup-grid">${html}</div>`);
  }

  photoLink(p, small = false) {
    const href = `viewer.html?album=${encodeURIComponent(p.album)}&photo=${encodeURIComponent(p.filename)}`;
    return small
      ? `<a class="near-popup-thumb" href="${href}" title="${escapeHtml(p.name || p.filename)}"><img src="${escapeHtml(p.thumbUrl || p.previewUrl)}" alt=""></a>`
      : href;
  }

  openPhoto(p) {
    const date = p.date ? new Date(p.date).toLocaleDateString(this.lang, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : '';
    this.popup([p.gps.lng, p.gps.lat], `
      <a class="near-popup-img" href="${this.photoLink(p)}"><img src="${escapeHtml(p.previewUrl || p.thumbUrl)}" alt=""></a>
      <div class="near-popup-text">
        <span class="near-popup-album">${escapeHtml(p.album)}</span>
        <strong>${escapeHtml(p.name || p.filename)}</strong>
        ${date ? `<span class="near-popup-date">${escapeHtml(date)}</span>` : ''}
        ${p.location ? `<span class="near-popup-date">${escapeHtml(p.location)}</span>` : ''}
        <a class="near-popup-link" href="${this.photoLink(p)}">${escapeHtml(this.t('map.viewInAlbum'))} →</a>
      </div>`);
  }

  popup(coords, html) {
    this.currentPopup?.remove();
    this.currentPopup = new this.ml.Popup({ className: 'near-popup', maxWidth: '300px', offset: 30 })
      .setLngLat(coords).setHTML(html).addTo(this.map);
  }

  /** Fly down to a photo and open its card. */
  async flyToPhoto(p) {
    await this.ready;
    this.map.flyTo({ center: [p.gps.lng, p.gps.lat], zoom: PHOTO_ZOOM, speed: 1.1, curve: 1.5, essential: true });
    await new Promise((r) => this.map.once('moveend', r));
    this.openPhoto(p);
  }

  /** Animated zoom out to the switch level; resolves with the view to hand back. */
  async zoomOut() {
    this.currentPopup?.remove();
    this.map.flyTo({ zoom: FAR_ZOOM, speed: 1.6, curve: 1.2, essential: true });
    await new Promise((r) => this.map.once('moveend', r));
    const c = this.map.getCenter();
    return { lat: c.lat, lng: c.lng, zoom: this.map.getZoom() };
  }

  /** Frame a group of photos (one city, one trip leg). */
  async fitPhotos(photos) {
    await this.ready;
    const lngs = photos.map((p) => p.gps.lng), lats = photos.map((p) => p.gps.lat);
    this.map.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
      { padding: 90, maxZoom: PHOTO_ZOOM, duration: 2600, essential: true });
    await new Promise((r) => this.map.once('moveend', r));
  }

  resize() { this.map?.resize(); }
}
