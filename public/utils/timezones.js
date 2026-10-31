/**
 * Time zones of the globe (overlay and local time on hover).
 *
 * The zone at a point comes from an equirectangular index image built by
 * scripts/timezone-textures.js (each pixel: zone number + 1, red = low byte,
 * green = high byte) and the list of IANA names; the UTC offset and local
 * time come from Intl, so summer time is always right.
 */

/** Zone number (0-based) stored in an RGBA pixel array, or -1 for none. */
export function zoneIndexAt(index, lat, lng) {
  const { data, width, height } = index;
  const px = (x, y) => {
    const o = (((y + height) % height) * width + ((x + width) % width)) * 4;
    return data[o] + data[o + 1] * 256 - 1;
  };
  const x = Math.min(width - 1, Math.floor(((lng + 180) / 360) * width));
  const y = Math.min(height - 1, Math.max(0, Math.floor(((90 - lat) / 180) * height)));
  let n = px(x, y);
  // the simplified boundaries leave a few hairline gaps: look around
  for (let r = 1; n < 0 && r <= 3; r++) {
    for (let dy = -r; dy <= r && n < 0; dy++) for (let dx = -r; dx <= r && n < 0; dx++) n = px(x + dx, y + dy);
  }
  return n;
}

/** "GMT+05:45" / "GMT-3" / "GMT" → minutes east of UTC. */
export function parseGmtOffset(label) {
  const m = /GMT(?:([+-−])(\d{1,2})(?::?(\d{2}))?)?/.exec(label);
  if (!m || !m[1]) return 0;
  const sign = m[1] === '+' ? 1 : -1;
  return sign * (Number(m[2]) * 60 + Number(m[3] || 0));
}

/** Current UTC offset of an IANA zone, in minutes (summer time included). */
export function offsetMinutes(timeZone, date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' }).formatToParts(date);
  return parseGmtOffset(parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT');
}

/** "UTC+1", "UTC−3:30", "UTC" (typographic minus). */
export function formatOffset(minutes) {
  if (!minutes) return 'UTC';
  const a = Math.abs(minutes), h = Math.floor(a / 60), m = a % 60;
  return `UTC${minutes > 0 ? '+' : '−'}${h}${m ? `:${String(m).padStart(2, '0')}` : ''}`;
}

/** Readable place of a zone: "Europe/Paris" → "Paris", "America/Argentina/Buenos_Aires" → "Buenos Aires"; ocean zones → null. */
export function zonePlace(timeZone) {
  if (timeZone.startsWith('Etc/')) return null;
  return timeZone.split('/').pop().replace(/_/g, ' ');
}

/** What the hover card shows for a zone at `date`. */
export function zoneLabel(timeZone, date = new Date(), lang = 'fr') {
  const offset = offsetMinutes(timeZone, date);
  return {
    timeZone,
    place: zonePlace(timeZone),
    offset: formatOffset(offset),
    time: new Intl.DateTimeFormat(lang, { timeZone, hour: '2-digit', minute: '2-digit' }).format(date),
    day: new Intl.DateTimeFormat(lang, { timeZone, weekday: 'short', day: 'numeric', month: 'short' }).format(date),
    minutes: offset,
  };
}

/** Load the index image and the zone names (once). */
let loading = null;
export function loadTimezones(width = 4096) {
  loading ??= Promise.all([
    fetch(`/textures/earth/tz-index-${width}.png`).then((r) => r.blob()).then((b) => createImageBitmap(b, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' })),
    fetch('/textures/earth/tz-zones.json').then((r) => r.json()),
  ]).then(([bitmap, names]) => {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    const g = canvas.getContext('2d', { willReadFrequently: true });
    g.drawImage(bitmap, 0, 0);
    const { data } = g.getImageData(0, 0, bitmap.width, bitmap.height);
    return { names, bitmap, index: { data, width: bitmap.width, height: bitmap.height } };
  });
  return loading;
}

/**
 * Borders from tz-lines.bin (format in scripts/timezone-textures.js):
 * [{ a, b, coords: Float32Array [lng, lat, lng, lat, …] }].
 */
export function decodeBorders(buffer) {
  const v = new DataView(buffer);
  let o = 0;
  const count = v.getUint32(o, true); o += 4;
  const out = new Array(count);
  for (let i = 0; i < count; i++) {
    const a = v.getUint16(o, true), b = v.getUint16(o + 2, true), n = v.getUint32(o + 4, true);
    let x = v.getInt32(o + 8, true), y = v.getInt32(o + 12, true);
    o += 16;
    const coords = new Float32Array(n * 2);
    coords[0] = x / 1000; coords[1] = y / 1000;
    for (let k = 1; k < n; k++) {
      x += v.getInt16(o, true); y += v.getInt16(o + 2, true); o += 4;
      coords[2 * k] = x / 1000; coords[2 * k + 1] = y / 1000;
    }
    out[i] = { a, b, coords };
  }
  return out;
}

let bordersLoading = null;
export function loadBorders() {
  bordersLoading ??= fetch('/textures/earth/tz-lines.bin').then((r) => r.arrayBuffer()).then(decodeBorders);
  return bordersLoading;
}

/** Zone name at a point, or null. */
export function zoneAt(tz, lat, lng) {
  const n = zoneIndexAt(tz.index, lat, lng);
  return n >= 0 ? tz.names[n] : null;
}
