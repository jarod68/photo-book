// @ts-check
// A user's public page (profile.html?u=username): picture, name, a few words,
// their albums and stories — those the visitor may see.
import { t, applyTranslations, initLangSwitcher } from '../utils/i18n.js';
import '../utils/admin-shortcut.js';
import { getAlbums, getLatestArticles, getMapPhotos } from '../api/client.js';
import { travelStats } from '../utils/travel-stats.js';
import { createAlbumCard } from '../components/album-card.js';
import { createArticleCard } from '../components/article-card.js';
import { avatarHtml } from '../components/avatar.js';
import { sortAlbums } from '../utils/order.js';
import { wireBack } from '../utils/back.js';
import { showBuildTag } from '../utils/build-tag.js';

applyTranslations();
initLangSwitcher('lang-switcher');
wireBack(document.querySelector('.profile-back'));

const $ = (id) => /** @type {any} */ (document.getElementById(id));
const username = new URLSearchParams(location.search).get('u') ?? '';

async function init() {
  const r = await fetch(`/api/users/${encodeURIComponent(username)}`);
  if (!r.ok) {
    $('profile-message').textContent = t('profile.notFound');
    $('profile-message').hidden = false;
    return;
  }
  const p = await r.json();
  const name = p.displayName || p.username;
  document.title = `${name} — Photo Book`;
  $('profile-title').textContent = name;
  $('profile-avatar').innerHTML = avatarHtml(p);
  $('profile-name').textContent = name;
  $('profile-username').textContent = `@${p.username}`;
  $('profile-bio').textContent = p.bio ?? '';
  $('profile-head').hidden = false;

  // their albums and stories, as this visitor may see them
  const [albums, articles] = await Promise.all([getAlbums().catch(() => []), getLatestArticles(24).catch(() => [])]);
  const mine = sortAlbums(albums.filter((a) => a.owner?.username === p.username), 'recent');
  const names = new Set(mine.map((a) => a.name));
  const stories = articles.filter((a) => names.has(a.album));
  for (const a of mine) $('profile-album-grid').appendChild(createAlbumCard(a));
  for (const a of stories) $('profile-article-grid').appendChild(createArticleCard(a, { showAlbum: true }));
  renderStats(mine, stories);
  $('profile-albums').hidden = !mine.length;
  $('profile-articles').hidden = !stories.length;
  $('profile-empty').hidden = mine.length + stories.length > 0;
}

// their travels in figures: albums, photos, countries, kilometres, stories
async function renderStats(albums, stories) {
  if (!albums.length) return;
  const names = new Set(albums.map((a) => a.name));
  const located = (await getMapPhotos().catch(() => [])).filter((p) => names.has(p.album));
  const s = travelStats(located);
  const fmt = new Intl.NumberFormat(document.documentElement.lang || undefined);
  const figures = [
    [albums.length, t('stats.albums')],
    [albums.reduce((n, a) => n + a.count, 0), t('stats.photos')],
    [s.countries.length, t('stats.countriesLabel')],
    [s.km, t('stats.kmLabel')],
    [stories.length, t('stats.articles')],
  ].filter(([n]) => n > 0);
  const dl = $('profile-stats');
  for (const [n, label] of figures) {
    const div = document.createElement('div');
    const dd = document.createElement('dd');
    dd.textContent = fmt.format(n);
    const dtEl = document.createElement('dt');
    dtEl.textContent = label;
    div.append(dd, dtEl);
    dl.appendChild(div);
  }
  if (s.countries.length) dl.title = s.countries.join(' · ');
  dl.hidden = false;
}

init();
showBuildTag({ footer: true });
