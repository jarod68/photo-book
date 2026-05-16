import { t, applyTranslations, initLangSwitcher } from '../utils/i18n.js';

applyTranslations();
initLangSwitcher('lang-switcher');

const form    = document.getElementById('login-form');
const errorEl = document.getElementById('login-error');
const btn     = form.querySelector('button[type="submit"]');

async function checkAlreadyLoggedIn() {
  try {
    const { user } = await fetch('/api/auth/me').then(r => r.json());
    if (user) window.location.replace('/');
  } catch (_) {}
}

checkAlreadyLoggedIn();

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

    window.location.replace('/');
  } catch (_) {
    errorEl.textContent = t('login.errorNetwork');
    errorEl.hidden = false;
  } finally {
    btn.disabled = false;
    btn.querySelector('.login-btn-text').textContent = t('login.submit');
  }
});
