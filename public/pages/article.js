// @ts-check
// One article (article.html?album=…&a=slug): its picture across the top, the
// title over it, then the text and its photos (a click opens the photo in the
// viewer), and the previous / next stories of the album.
import { t, applyTranslations, initLangSwitcher } from '../utils/i18n.js';
import '../utils/admin-shortcut.js';
import { getArticle } from '../api/client.js';
import { renderArticle, esc } from '../utils/article-render.js';
import { articleHref, articleMeta } from '../components/article-card.js';
import { wireBack } from '../utils/back.js';
import { showBuildTag } from '../utils/build-tag.js';

// back from the editor, the page comes out of the browser's cache as it was:
// load it again, with what was just saved
addEventListener('pageshow', (e) => { if (e.persisted) location.reload(); });

applyTranslations();
initLangSwitcher('lang-switcher');

const params = new URLSearchParams(location.search);
const album  = params.get('album') ?? '';
const slug   = params.get('a') ?? '';
const share  = params.get('share');
const withShare = (url) => (share && url ? `${url}${url.includes('?') ? '&' : '?'}share=${encodeURIComponent(share)}` : url);
const albumHref = withShare(`album.html?album=${encodeURIComponent(album)}`);

const back = /** @type {HTMLAnchorElement} */ (document.querySelector('.article-back'));
back.href = albumHref;          // opened from outside: the album's journal
wireBack(back);
const albumLink = /** @type {HTMLAnchorElement} */ (document.getElementById('article-album'));
albumLink.href = albumHref;
albumLink.textContent = album;

function renderHero(a) {
  const hero = document.getElementById('article-hero');
  const pic = a.cover?.mediumUrl || a.cover?.previewUrl;
  hero.classList.toggle('article-hero--plain', !pic);
  hero.innerHTML = `
    ${pic ? '<img class="article-hero-img" alt="" decoding="async">' : ''}
    <div class="article-hero-text">
      <p class="carnet-kicker">${esc(album)}${a.published ? '' : ` · <span class="article-draft">${esc(t('art.draft'))}</span>`}</p>
      <h1 class="article-title">${esc(a.title)}</h1>
      <p class="article-meta">${esc(articleMeta(a))}</p>
    </div>`;
  const img = hero.querySelector('img');
  if (img) {
    img.onload = () => hero.classList.add('loaded');
    img.src = withShare(pic);
  }
}

function renderNav(a) {
  const nav = document.getElementById('article-nav');
  const link = (n, cls, label) => (n
    ? `<a class="article-nav-link ${cls}" href="${esc(articleHref(album, n.slug, share))}"><span>${esc(label)}</span><strong>${esc(n.title)}</strong></a>`
    : '<span></span>');
  nav.innerHTML = `
    <div class="article-nav-pair">${link(a.prev, 'article-nav-prev', `← ${t('art.prev')}`)}${link(a.next, 'article-nav-next', `${t('art.next')} →`)}</div>
    <a class="carnet-btn article-nav-album" href="${esc(albumHref)}">${esc(t('art.backAlbum', { album }))}</a>`;
}

async function init() {
  let a;
  try {
    a = await getArticle(album, slug, share);
  } catch (err) {
    const msg = document.getElementById('article-message');
    if (err.status === 401) msg.innerHTML = `${esc(t('art.restricted'))} <a href="login.html">${esc(t('nav.signIn'))}</a>`;
    else msg.textContent = t('art.notFound');
    msg.hidden = false;
    return;
  }
  document.title = `${a.title} — ${album}`;
  renderHero(a);
  const body = document.getElementById('article-body');
  body.innerHTML = (a.lead ? `<p class="article-lead">${esc(a.lead)}</p>` : '')
    + renderArticle(a.body, { album, photos: a.photos, share });
  renderNav(a);
  if (a.canEdit) {
    const edit = /** @type {HTMLAnchorElement} */ (document.getElementById('article-edit'));
    edit.href = `write.html?album=${encodeURIComponent(album)}&a=${encodeURIComponent(a.slug)}`;
    edit.hidden = false;
  }
  document.getElementById('article').hidden = false;
}

init();
showBuildTag({ footer: true });
