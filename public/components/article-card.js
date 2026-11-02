// @ts-check
import { t } from '../utils/i18n.js';
import { formatDay } from '../utils/format.js';

/** Address of an article (album page links keep the share link). */
export function articleHref(album, slug, share = null) {
  return `article.html?album=${encodeURIComponent(album)}&a=${encodeURIComponent(slug)}${share ? `&share=${encodeURIComponent(share)}` : ''}`;
}

/** "12 avril 2026 · Lisboa · 4 min de lecture" (the parts present). */
export function articleMeta(a, { album = false } = {}) {
  return [album ? a.album : null, formatDay(a.date), a.place, t('art.readMin', { n: a.readMinutes })].filter(Boolean).join(' · ');
}

/**
 * A story's card: its picture, title, the start of its text.
 * @param {import('../api/client.js').ArticleCard} a
 * @param {{ share?: string|null, showAlbum?: boolean }} [opts]
 */
export function createArticleCard(a, { share = null, showAlbum = false } = {}) {
  const card = document.createElement('a');
  card.className = 'article-card' + (a.published ? '' : ' article-card--draft');
  card.href = articleHref(a.album, a.slug, share);

  const pic = document.createElement('div');
  pic.className = 'article-card-pic';
  const src = a.cover?.previewUrl || a.cover?.thumbUrl;
  if (src) {
    const img = document.createElement('img');
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.onload = () => img.classList.add('loaded');
    img.src = share ? `${src}${src.includes('?') ? '&' : '?'}share=${encodeURIComponent(share)}` : src;
    pic.appendChild(img);
  }
  if (!a.published) {
    const badge = document.createElement('span');
    badge.className = 'article-card-badge';
    badge.textContent = t('art.draft');
    pic.appendChild(badge);
  }
  card.appendChild(pic);

  const body = document.createElement('div');
  body.className = 'article-card-body';
  const meta = document.createElement('p');
  meta.className = 'article-card-meta';
  meta.textContent = articleMeta(a, { album: showAlbum });
  const title = document.createElement('h3');
  title.className = 'article-card-title';
  title.textContent = a.title;
  body.append(meta, title);
  if (a.summary) {
    const sum = document.createElement('p');
    sum.className = 'article-card-summary';
    sum.textContent = a.summary;
    body.appendChild(sum);
  }
  card.appendChild(body);
  return card;
}
