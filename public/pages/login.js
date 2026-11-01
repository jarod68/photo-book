import { t, applyTranslations, initLangSwitcher } from '../utils/i18n.js';
import { showBuildTag } from '../utils/build-tag.js';
import { wireBack, cameFromApp } from '../utils/back.js';

applyTranslations();
initLangSwitcher('lang-switcher');
wireBack(document.querySelector('.login-back'));

const form    = document.getElementById('login-form');
const errorEl = document.getElementById('login-error');
const btn     = form.querySelector('button[type="submit"]');

// Signed in: back to the page the visitor came from (the admin sends here
// when not signed in), else the home page.
const afterLogin = () => (cameFromApp() ? document.referrer : '/');

async function checkAlreadyLoggedIn() {
  try {
    const { user } = await fetch('/api/auth/me').then(r => r.json());
    if (user) window.location.replace(afterLogin());
  } catch (_) {}
}

checkAlreadyLoggedIn();

// Backdrop: the cover of a random visible album, blurred behind the card
// (none when no album is visible: the plain dark page).
fetch('/api/albums').then(r => r.json()).then(albums => {
  const covers = albums.map(a => a.coverPreview || a.cover).filter(Boolean);
  if (!covers.length) return;
  const img = document.createElement('img');
  img.className = 'login-backdrop';
  img.alt = '';
  img.onload = () => img.classList.add('loaded');
  img.src = covers[Math.floor(Math.random() * covers.length)];
  document.body.prepend(img);
}).catch(() => {});

form.addEventListener('submit', async e => {
  e.preventDefault();
  errorEl.hidden = true;
  btn.disabled   = true;
  btn.querySelector('.login-btn-text').textContent = t('login.signingIn');

  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;

  try {
    const res  = await fetch('/api/auth/login', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ username, password }),
    });
    const data = await res.json();

    if (!res.ok) {
      errorEl.textContent = data.error === 'Invalid credentials'
        ? t('login.errorInvalid')
        : t('login.errorGeneric');
      errorEl.hidden = false;
      return;
    }

    window.location.replace(afterLogin());
  } catch (_) {
    errorEl.textContent = t('login.errorNetwork');
    errorEl.hidden = false;
  } finally {
    btn.disabled = false;
    btn.querySelector('.login-btn-text').textContent = t('login.submit');
  }
});

showBuildTag({ footer: true });
