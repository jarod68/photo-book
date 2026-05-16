import { t } from './i18n.js';

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
