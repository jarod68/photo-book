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
  root.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
  root.querySelectorAll('[data-i18n-html]').forEach(el => {
    el.innerHTML = t(el.dataset.i18nHtml);
  });
  root.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.title = t(el.dataset.i18nTitle);
  });
  root.querySelectorAll('[data-i18n-aria]').forEach(el => {
    el.setAttribute('aria-label', t(el.dataset.i18nAria));
  });
  root.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
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

  function close() {
    menu.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
  }

  btn.addEventListener('click', e => {
    e.stopPropagation();
    const opening = menu.hidden;
    menu.hidden = !opening;
    btn.setAttribute('aria-expanded', String(opening));
  });

  document.addEventListener('click', close);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });

  el.appendChild(btn);
  el.appendChild(menu);
}
