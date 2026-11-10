// @ts-check
'use strict';
// "On this day": the photos taken around today's date in earlier years, by
// year — a few days either side, the camera's own date (capture dates are the
// camera's local time, stored as UTC: compared in UTC).

const WINDOW_DAYS = 3;
const PER_YEAR = 8;

/** Day of the year of a UTC date, Feb 29 counted as Feb 28 (every year has it). */
function dayOfYear(d) {
  const m = d.getUTCMonth(), day = m === 1 && d.getUTCDate() === 29 ? 28 : d.getUTCDate();
  return Math.round((Date.UTC(2001, m, day) - Date.UTC(2001, 0, 1)) / 864e5);
}

/** Days between two days of the year, around the year's end (Dec 30 – Jan 2: 3). */
function gap(a, b) {
  const d = Math.abs(a - b);
  return Math.min(d, 365 - d);
}

/**
 * @param {{ album: string, photo: any }[]} entries every photo the reader may see
 * @param {Date} today
 * @returns {{ year: number, yearsAgo: number, photos: object[] }[]} the most recent year first
 */
function onThisDay(entries, today, { windowDays = WINDOW_DAYS, perYear = PER_YEAR } = {}) {
  const target = dayOfYear(today), thisYear = today.getUTCFullYear();
  const byYear = new Map();
  for (const { album, photo: p } of entries) {
    const t = p.takenAt ? new Date(p.takenAt) : null;
    if (!t || Number.isNaN(t.getTime()) || p.type === 'video' || !p.thumbUrl) continue;
    const year = t.getUTCFullYear();
    if (year >= thisYear || gap(dayOfYear(t), target) > windowDays) continue;
    if (!byYear.has(year)) byYear.set(year, []);
    byYear.get(year).push({
      album, filename: p.filename, name: p.name, takenAt: p.takenAt,
      thumbUrl: p.thumbUrl, previewUrl: p.previewUrl, mediumUrl: p.mediumUrl ?? null,
    });
  }
  return [...byYear.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([year, photos]) => ({
      year, yearsAgo: thisYear - year,
      // spread over the albums of that time, in shooting order
      photos: photos.sort((a, b) => Date.parse(a.takenAt) - Date.parse(b.takenAt)).filter((_, i, all) => i % Math.ceil(all.length / perYear) === 0).slice(0, perYear),
      count: photos.length,
    }));
}

module.exports = { onThisDay, dayOfYear, WINDOW_DAYS };
