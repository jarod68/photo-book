import { t, getLang } from './i18n.js';

export function formatViews(n) {
  if (n >= 1_000_000) return t('format.views_M', { n: (n / 1_000_000).toFixed(1).replace(/\.0$/, '') });
  if (n >= 1_000)     return t('format.views_k', { n: (n / 1_000).toFixed(1).replace(/\.0$/, '') });
  return t(n !== 1 ? 'format.views' : 'format.view', { n });
}

export function formatLikes(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + ' M';
  if (n >= 1_000)     return (n / 1_000).toFixed(1).replace(/\.0$/, '') + ' k';
  return n > 0 ? String(n) : '';
}

const LOCALES = { fr: 'fr-FR', en: 'en-GB', es: 'es-ES' };

// "Mar 2024", "Mar – Apr 2024", "Dec 2023 – Jan 2024" (capture dates are
// stored as UTC instants of the camera's local time: format them in UTC).
export function formatDateRange(from, to, lang = getLang()) {
  if (!from) return '';
  const fmt = new Intl.DateTimeFormat(LOCALES[lang] ?? lang, { month: 'short', year: 'numeric', timeZone: 'UTC' });
  const a = new Date(from), b = new Date(to ?? from);
  if (fmt.format(a) === fmt.format(b)) return fmt.format(a);
  return fmt.formatRange ? fmt.formatRange(a, b) : `${fmt.format(a)} – ${fmt.format(b)}`;
}
