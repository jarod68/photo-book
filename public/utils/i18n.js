// @ts-check
import fr from '../locales/fr.js';
import en from '../locales/en.js';
import es from '../locales/es.js';

const locales   = { fr, en, es };
const SUPPORTED = ['fr', 'en', 'es'];
const LABELS    = { fr: 'Français', en: 'English', es: 'Español' };

export function getLang() {
  const stored  = localStorage.getItem('lang');
  if (stored && SUPPORTED.includes(stored)) return stored;
  const browser = (navigator.language || '').slice(0, 2).toLowerCase();
  return SUPPORTED.includes(browser) ? browser : 'en';
}

const lang     = getLang();
const messages = locales[lang] ?? locales.en;

document.documentElement.lang = lang;

export function t(key, vars = {}) {
  let str = messages[key] ?? key;
  for (const [k, v] of Object.entries(vars)) {
    str = str.replaceAll(`{${k}}`, v);
  }
  return str;
}

export function setLang(newLang) {
  localStorage.setItem('lang', newLang);
  location.reload();
}

export function applyTranslations(root = document) {
  /** @type {NodeListOf<HTMLInputElement>} */ (root.querySelectorAll('[data-i18n]')).forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
  /** @type {NodeListOf<HTMLInputElement>} */ (root.querySelectorAll('[data-i18n-html]')).forEach(el => {
    el.innerHTML = t(el.dataset.i18nHtml);
  });
  /** @type {NodeListOf<HTMLInputElement>} */ (root.querySelectorAll('[data-i18n-title]')).forEach(el => {
    el.title = t(el.dataset.i18nTitle);
  });
  /** @type {NodeListOf<HTMLInputElement>} */ (root.querySelectorAll('[data-i18n-aria]')).forEach(el => {
    el.setAttribute('aria-label', t(el.dataset.i18nAria));
  });
  /** @type {NodeListOf<HTMLInputElement>} */ (root.querySelectorAll('[data-i18n-placeholder]')).forEach(el => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
}

export function initLangSwitcher(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.className = 'lang-switcher';

  const btn = document.createElement('button');
  btn.className = 'lang-btn';
  btn.setAttribute('aria-haspopup', 'listbox');
  btn.setAttribute('aria-expanded', 'false');
  btn.setAttribute('aria-label', 'Language');
  btn.innerHTML = `<span>${lang.toUpperCase()}</span><svg viewBox="0 0 10 6" width="8" height="8" aria-hidden="true"><path d="M0 0l5 6 5-6z" fill="currentColor"/></svg>`;

  const menu = document.createElement('ul');
  menu.className = 'lang-menu';
  menu.setAttribute('role', 'listbox');
  menu.hidden = true;

  SUPPORTED.forEach(l => {
    const li = document.createElement('li');
    li.className = 'lang-option' + (l === lang ? ' lang-option--active' : '');
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', String(l === lang));
    li.textContent = LABELS[l];
    li.addEventListener('click', e => {
      e.stopPropagation();
      if (l !== lang) setLang(l);
    });
    menu.appendChild(li);
  });

  // The open menu hangs from <body>, fixed under its button: the bars it
  // opens from may scroll sideways (the viewer's album tabs: overflow clips
  // it) or blur what is behind them (a stacking context of their own, under
  // the globe that follows) — from the body, nothing covers or cuts it.
  function close() {
    menu.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
  }

  function place() {
    const r = btn.getBoundingClientRect();
    menu.style.top   = `${Math.round(r.bottom + 5)}px`;
    menu.style.right = `${Math.round(document.documentElement.clientWidth - r.right)}px`;
  }

  function open() {
    document.body.appendChild(menu);
    place();
    menu.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
  }

  btn.addEventListener('click', e => {
    e.stopPropagation();
    if (menu.hidden) open(); else close();
  });

  document.addEventListener('click', close);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  // the bar scrolled or the window changed: follow the button
  const follow = () => { if (!menu.hidden) place(); };
  addEventListener('resize', follow);
  addEventListener('scroll', follow, true);

  el.appendChild(btn);
  el.appendChild(menu);
}
