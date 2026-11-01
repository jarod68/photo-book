// @ts-check
import { createMap, boundsOf } from '../utils/base-map.js';
import { markerElement, shortLocation } from './map-marker.js';

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

/**
 * A map of an album's photos as numbered pins (the current one white), for
 * the viewer's expanded map and the album overlay: a click on a pin opens a
 * card made by the caller. The MapLibre map is created on first show, once
 * its container is visible.
 */
export class PinsMap {
  /** @param {HTMLElement} canvas */
  constructor(canvas) {
    this.canvas  = canvas;
    this.ready   = null;    // Promise<{ ml, map }>
    this.ml      = null;
    this.map     = null;
    this.markers = [];
    this.popup   = null;
    this.photos  = [];
    this.makeCard = null;
  }

  async ensure() {
    await nextFrame();      // the container was display:none a moment ago
    this.ready ??= createMap(this.canvas, { zoom: 1 });
    ({ ml: this.ml, map: this.map } = await this.ready);
    this.map.resize();
  }

  /**
   * Show the GPS photos of `photos` and frame them (or the current one).
   * @param {any[]} photos - the album's photos (those without .gps are skipped)
   * @param {number} current - index of the current photo
   * @param {(photo: any, index: number) => HTMLElement} makeCard - the pin's card
   * @param {{ focusCurrent?: boolean }} [opts]
   */
  async show(photos, current, makeCard, { focusCurrent = false } = {}) {
    await this.ensure();
    this.photos = photos;
    this.makeCard = makeCard;
    this.render(current);
    const pts = photos.filter((p) => p.gps).map((p) => p.gps);
    const cur = photos[current]?.gps;
    const one = (focusCurrent && cur) || (pts.length === 1 && pts[0]);
    if (one) this.map.jumpTo({ center: [one.lng, one.lat], zoom: 13 });
    else if (pts.length > 1) this.map.fitBounds(boundsOf(pts), { padding: 50, maxZoom: 14, duration: 0 });
  }

  /** (Re)draw the pins, `current` highlighted, without moving the map. */
  render(current) {
    if (!this.map) return;
    this.clear();
    this.photos.forEach((p, i) => {
      if (!p.gps) return;
      const el = markerElement(i + 1, i === current, shortLocation(p.location));
      el.addEventListener('click', (e) => { e.stopPropagation(); this.openCard(p, i); });
      this.markers.push(new this.ml.Marker({ element: el, anchor: 'bottom' }).setLngLat([p.gps.lng, p.gps.lat]).addTo(this.map));
    });
  }

  openCard(p, i) {
    this.popup?.remove();
    this.popup = new this.ml.Popup({ className: 'pb-popup', offset: [0, -40], maxWidth: '220px' })
      .setLngLat([p.gps.lng, p.gps.lat]).setDOMContent(this.makeCard(p, i)).addTo(this.map);
  }

  clear() {
    this.markers.forEach((m) => m.remove());
    this.markers = [];
    this.popup?.remove();
    this.popup = null;
  }
}
