/**
 * Chronological ordering (F5): photos by capture date, albums by date range.
 * Items without a date always come last, by name. The chosen orders are
 * remembered per browser.
 */

const time = (iso) => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? null : t;
};
const byName = (a, b) => a.localeCompare(b, undefined, { numeric: true });

/** @param {'name'|'date'} mode */
export function sortPhotos(photos, mode) {
  if (mode !== 'date') return [...photos].sort((a, b) => byName(a.filename, b.filename));
  return [...photos].sort((a, b) => {
    const ta = time(a.takenAt), tb = time(b.takenAt);
    if (ta === null || tb === null) return ta === tb ? byName(a.filename, b.filename) : ta === null ? 1 : -1;
    return ta - tb || byName(a.filename, b.filename);
  });
}

/** @param {'name'|'recent'|'oldest'} mode — by the album's last / first capture date */
export function sortAlbums(albums, mode) {
  if (mode !== 'recent' && mode !== 'oldest') return [...albums].sort((a, b) => byName(a.name, b.name));
  const key = (a) => time(mode === 'recent' ? a.dateTo : a.dateFrom);
  return [...albums].sort((a, b) => {
    const ka = key(a), kb = key(b);
    if (ka === null || kb === null) return ka === kb ? byName(a.name, b.name) : ka === null ? 1 : -1;
    return (mode === 'recent' ? kb - ka : ka - kb) || byName(a.name, b.name);
  });
}

/**
 * Label of the first photo of each day ("14 Jun"), null for the others and
 * for undated photos. Capture dates are camera-local times stored as UTC.
 */
export function dayLabels(photos, locale) {
  const fmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' });
  let prev = null;
  return photos.map((p) => {
    const t = time(p.takenAt);
    if (t === null) return null;
    const day = new Date(t).toISOString().slice(0, 10);
    if (day === prev) return null;
    prev = day;
    return fmt.format(t);
  });
}

export function loadOrder(key, fallback, allowed) {
  try {
    const v = localStorage.getItem(key);
    return allowed.includes(v) ? v : fallback;
  } catch { return fallback; }
}

export function saveOrder(key, value) {
  try { localStorage.setItem(key, value); } catch { /* private mode: not remembered */ }
}
