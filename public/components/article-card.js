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

const HEART = '<svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>';

/**
 * A story's card, made like an album's: its picture across the whole card,
 * over it "Article" (and the album), the title, the day and place, its likes.
 * @param {import('../api/client.js').ArticleCard} a
 * @param {{ share?: string|null, showAlbum?: boolean }} [opts]
 */
export function createArticleCard(a, { share = null, showAlbum = false } = {}) {
  const card = document.createElement('a');
  card.className = 'album-card album-card--article article-card' + (a.published ? '' : ' article-card--draft');
  card.href = articleHref(a.album, a.slug, share);

  const src = a.cover?.previewUrl || a.cover?.thumbUrl;
  if (src) {
    const img = document.createElement('img');
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.onload = () => img.classList.add('loaded');
    img.src = share ? `${src}${src.includes('?') ? '&' : '?'}share=${encodeURIComponent(share)}` : src;
    card.appendChild(img);
  } else {
    const empty = document.createElement('div');
    empty.className = 'album-card-empty album-card-empty--article';
    card.appendChild(empty);
  }
  if (!a.published) {
    const badge = document.createElement('span');
    badge.className = 'article-card-badge';
    badge.textContent = t('art.draft');
    card.appendChild(badge);
  }

  const info = document.createElement('div');
  info.className = 'album-card-info';
  const kicker = document.createElement('div');
  kicker.className = 'album-card-kicker';
  kicker.textContent = showAlbum ? `${t('art.article')} · ${a.album}` : t('art.article');
  const title = document.createElement('div');
  title.className = 'album-card-name article-card-title';
  title.textContent = a.title;
  const meta = document.createElement('div');
  meta.className = 'album-card-count';
  meta.textContent = [formatDay(a.date), a.place].filter(Boolean).join(' · ');
  if (a.likes) {
    const likes = document.createElement('span');
    likes.className = 'album-card-likes';
    likes.innerHTML = `${HEART} ${a.likes}`;
    meta.append(meta.textContent ? ' · ' : '', likes);
  }
  info.append(kicker, title, meta);
  card.appendChild(info);
  return card;
}
