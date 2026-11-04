// @ts-check
// A user's public page (profile.html?u=username): picture, name, a few words,
// their albums and stories — those the visitor may see.
import { t, applyTranslations, initLangSwitcher } from '../utils/i18n.js';
import '../utils/admin-shortcut.js';
import { getAlbums, getLatestArticles } from '../api/client.js';
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
  $('profile-albums').hidden = !mine.length;
  $('profile-articles').hidden = !stories.length;
  $('profile-empty').hidden = mine.length + stories.length > 0;
}

init();
showBuildTag({ footer: true });
