// @ts-check
// An album's journal (album.html?album=…): its cover and description, its
// articles in the order of the trip, a glimpse of its photos. Album cards
// open it when the album has articles; the admin writes new ones from here.
import { t, applyTranslations, initLangSwitcher } from '../utils/i18n.js';
import '../utils/admin-shortcut.js';
import { getAlbums, getAlbum, getAlbumArticles } from '../api/client.js';
import { createArticleCard } from '../components/article-card.js';
import { formatDateRange, formatDay } from '../utils/format.js';
import { wireBack } from '../utils/back.js';
import { showBuildTag } from '../utils/build-tag.js';

// back from the editor, the page comes out of the browser's cache as it was:
// load it again, with what was just saved
addEventListener('pageshow', (e) => { if (e.persisted) location.reload(); });
import { esc } from '../utils/article-render.js';
import { travelStats } from '../utils/travel-stats.js';
import { subscribeTo, unsubscribeFrom, getStoredAlbums, getSubscription } from '../utils/push.js';

applyTranslations();
initLangSwitcher('lang-switcher');
wireBack(document.querySelector('.map-page-back'));

const params = new URLSearchParams(location.search);
const name   = params.get('album') ?? '';
const share  = params.get('share');
const withShare = (url) => (share && url ? `${url}${url.includes('?') ? '&' : '?'}share=${encodeURIComponent(share)}` : url);
const viewerHref = (photo = null) => withShare(`viewer.html?album=${encodeURIComponent(name)}${photo ? `&photo=${encodeURIComponent(photo)}` : ''}`);

const PREVIEW_PHOTOS = 12;

function message(text, html = false) {
  const el = document.getElementById('carnet-message');
  if (html) el.innerHTML = text; else el.textContent = text;
  el.hidden = false;
}

function renderHero(info, articles, photos) {
  const hero = document.getElementById('carnet-hero');
  const pic = info?.coverPreview || articles.find((a) => a.cover)?.cover?.previewUrl
    || photos.find((p) => p.type !== 'video' && p.previewUrl)?.previewUrl;
  const published = articles.filter((a) => a.published).length;
  const meta = [
    formatDateRange(info?.dateFrom, info?.dateTo),
    published ? t('art.count', { n: published, s: published > 1 ? 's' : '' }) : null,
    photos.length ? t('album.photos', { n: photos.length, s: photos.length > 1 ? 's' : '' }) : null,
  ].filter(Boolean).join(' · ');
  // the trip in figures: days, countries, kilometres along its route
  const s = travelStats(photos);
  const fmt = new Intl.NumberFormat(document.documentElement.lang || undefined);
  const figures = [
    // a trip's length (an album spanning years — not a trip — says nothing)
    s.days > 1 && s.days <= 120 ? t('stats.days', { n: s.days, s: 's' }) : null,
    s.countries.length ? t(s.countries.length > 1 ? 'stats.countries' : 'stats.country', { n: s.countries.length }) : null,
    s.km >= 1 ? t('stats.km', { n: fmt.format(s.km) }) : null,
  ].filter(Boolean);
  hero.innerHTML = `
    ${pic ? '<img class="carnet-hero-img" alt="" decoding="async">' : ''}
    <div class="carnet-hero-text">
      <p class="carnet-kicker">${esc(t('art.diary'))}</p>
      <h2 class="carnet-hero-title">${esc(name)}</h2>
      ${meta ? `<p class="carnet-hero-meta">${esc(meta)}</p>` : ''}
      ${figures.length ? `<p class="carnet-figures">${figures.map((f) => `<span>${esc(f)}</span>`).join('')}</p>` : ''}
      ${info?.description ? `<p class="carnet-hero-desc">${esc(info.description)}</p>` : ''}
      <button type="button" id="carnet-follow" class="carnet-btn carnet-follow" title="${esc(t('follow.hint'))}" hidden>
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
        <span></span>
      </button>
    </div>`;
  hero.classList.toggle('carnet-hero--plain', !pic);
  const img = hero.querySelector('img');
  if (img) {
    img.onload = () => hero.classList.add('loaded');
    img.src = withShare(pic);
  }
  hero.hidden = false;
}

// Follow: told of new photos and new stories (push notifications, like the
// viewer's bell — the same subscription)
function wireFollow() {
  const btn = /** @type {HTMLButtonElement} */ (document.getElementById('carnet-follow'));
  if (!btn || !('PushManager' in window) || !('serviceWorker' in navigator)) return;
  const show = () => {
    const on = getStoredAlbums().includes(name);
    btn.classList.toggle('carnet-follow--on', on);
    btn.setAttribute('aria-pressed', String(on));
    btn.querySelector('span').textContent = t(on ? 'follow.following' : 'follow.follow');
  };
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      if (getStoredAlbums().includes(name)) await unsubscribeFrom(name, (await getSubscription())?.endpoint ?? null);
      else if (!await subscribeTo(name, share)) btn.title = t('follow.denied');
    } catch {
      btn.title = t('follow.denied');
    }
    btn.disabled = false;
    show();
  });
  show();
  btn.hidden = false;
}

function renderArticles(list, canEdit) {
  const section = document.getElementById('carnet-articles');
  const ol = document.getElementById('carnet-list');
  const newBtn = /** @type {HTMLAnchorElement} */ (document.getElementById('carnet-new'));
  if (canEdit) {
    newBtn.href = `write.html?album=${encodeURIComponent(name)}`;
    newBtn.hidden = false;
  }
  if (!list.length && !canEdit) return;
  section.hidden = false;
  if (!list.length) {
    const p = document.createElement('p');
    p.className = 'carnet-empty';
    p.textContent = t('art.empty');
    ol.replaceWith(p);
    return;
  }
  // a timeline: the day on the left, the story on the right
  for (const a of list) {
    const li = document.createElement('li');
    li.className = 'carnet-item';
    const day = document.createElement('div');
    day.className = 'carnet-day';
    if (a.date) {
      day.innerHTML = `<strong>${esc(formatDay(a.date, undefined, { day: 'numeric' }))}</strong>`
        + `<span>${esc(formatDay(a.date, undefined, { month: 'short', year: 'numeric' }))}</span>`;
    }
    li.append(day, createArticleCard(a, { share }));
    ol.appendChild(li);
  }
}

function renderPhotos(photos) {
  if (!photos.length) return;
  const grid = document.getElementById('carnet-grid');
  for (const p of photos.slice(0, PREVIEW_PHOTOS)) {
    const a = document.createElement('a');
    a.className = 'carnet-thumb';
    a.href = viewerHref(p.filename);
    if (p.thumbUrl) {
      const img = document.createElement('img');
      img.alt = p.name ?? '';
      img.loading = 'lazy';
      img.src = withShare(p.thumbUrl);
      a.appendChild(img);
    }
    grid.appendChild(a);
  }
  const all = /** @type {HTMLAnchorElement} */ (document.getElementById('carnet-all'));
  all.href = viewerHref();
  all.textContent = t('art.allPhotos', { n: photos.length });
  document.getElementById('carnet-photos').hidden = false;
}

async function init() {
  document.title = `${name} — Photo Book`;
  let data, album;
  try {
    [data, album] = await Promise.all([getAlbumArticles(name, share), getAlbum(name, share)]);
  } catch (err) {
    if (err.status === 401) message(`${esc(t('art.restricted'))} <a href="login.html">${esc(t('nav.signIn'))}</a>`, true);
    else message(t('art.notFound'));
    return;
  }
  // cover, dates and description: from the album list (not there with a share link)
  const info = (await getAlbums().catch(() => [])).find((x) => x.name === name);
  renderHero(info, data.articles, album.photos);
  wireFollow();
  renderArticles(data.articles, data.canEdit);
  renderPhotos(album.photos);
}

init();
showBuildTag({ footer: true });
