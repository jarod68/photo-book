// @ts-check
// About (about.html): what the site is, how it is made, privacy, credits —
// the text in the page's language (utils/about-content.js) — and a few live
// figures: albums, photos, articles, places on the map.
import { t, getLang, applyTranslations, initLangSwitcher } from '../utils/i18n.js';
import '../utils/admin-shortcut.js';
import { getAlbums, getMapPhotos } from '../api/client.js';
import { ABOUT } from '../utils/about-content.js';
import { wireBack } from '../utils/back.js';
import { showBuildTag } from '../utils/build-tag.js';

applyTranslations();
initLangSwitcher('lang-switcher');
wireBack(document.querySelector('.about-back'));

const text = ABOUT[getLang()] ?? ABOUT.en;
document.title = `${text.title} — Photo Book`;
document.getElementById('about-title').textContent = text.title;
document.getElementById('about-lead').textContent = text.lead;
document.getElementById('about-body').innerHTML = text.body;

async function stats() {
  const [albums, places] = await Promise.all([getAlbums().catch(() => []), getMapPhotos().catch(() => [])]);
  const sum = (/** @type {'count' | 'articles'} */ k) => {
    let n = 0;
    for (const a of albums) n += a[k] ?? 0;
    return n;
  };
  const fmt = new Intl.NumberFormat(getLang());
  const figures = [
    [albums.length, t('about.albums')],
    [sum('count'), t('about.photos')],
    [sum('articles'), t('about.articles')],
    [places.length, t('about.places')],
  ].filter(([n]) => n > 0);
  if (!figures.length) return;
  const dl = document.getElementById('about-stats');
  for (const [n, label] of figures) {
    const div = document.createElement('div');
    const dd = document.createElement('dd');
    dd.textContent = fmt.format(n);
    const dt = document.createElement('dt');
    dt.textContent = label;
    div.append(dd, dt);
    dl.appendChild(div);
  }
  dl.hidden = false;
}

stats();
showBuildTag({ footer: true });
