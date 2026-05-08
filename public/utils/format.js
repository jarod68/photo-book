/**
 * @param {number} n
 * @returns {string}
 */
export function formatViews(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + ' M vues';
  if (n >= 1_000)     return (n / 1_000).toFixed(1).replace(/\.0$/, '') + ' k vues';
  return `${n} vue${n !== 1 ? 's' : ''}`;
}

/**
 * @param {number} n
 * @returns {string}
 */
export function formatLikes(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + ' M';
  if (n >= 1_000)     return (n / 1_000).toFixed(1).replace(/\.0$/, '') + ' k';
  return n > 0 ? String(n) : '';
}
