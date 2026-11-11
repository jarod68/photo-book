// @ts-check
import { t, applyTranslations, initLangSwitcher } from '../utils/i18n.js';
import { showBuildTag } from '../utils/build-tag.js';
import { wireBack, cameFromApp } from '../utils/back.js';

applyTranslations();
initLangSwitcher('lang-switcher');
wireBack(document.querySelector('.login-back'));

const form    = /** @type {HTMLFormElement} */ (document.getElementById('login-form'));
const errorEl = document.getElementById('login-error');
const btn     = /** @type {HTMLButtonElement} */ (form.querySelector('button[type="submit"]'));

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

// ── The second step: the code ────────────────────────────────────────────────
const codeForm = /** @type {HTMLFormElement} */ (document.getElementById('code-form'));
const codeError = document.getElementById('code-error');
let ticket = null;

function askCode(t2) {
  ticket = t2;
  form.hidden = true;
  document.getElementById('login-sso').hidden = true;
  codeForm.hidden = false;
  document.getElementById('code').focus();
}

codeForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  codeError.hidden = true;
  const code = /** @type {HTMLInputElement} */ (document.getElementById('code')).value.trim();
  const res = await fetch('/api/auth/login/code', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ticket, code }),
  }).catch(() => null);
  if (res?.ok) { window.location.replace(afterLogin()); return; }
  codeError.textContent = res && res.status !== 429 ? t('login.codeInvalid') : t('login.errorGeneric');
  codeError.hidden = false;
});

// ── Google, and its answers (?sso=…, ?mfa=<ticket>) ──────────────────────────
fetch('/api/auth/providers').then((r) => r.json()).then(({ google }) => {
  if (google && !ticket) document.getElementById('login-sso').hidden = false;
}).catch(() => {});
{
  const q = new URLSearchParams(location.search);
  if (q.get('mfa')) askCode(q.get('mfa'));
  const sso = q.get('sso');
  if (sso) {
    errorEl.textContent = t(sso === 'unknown' ? 'login.ssoUnknown' : 'login.ssoError');
    errorEl.hidden = false;
  }
  if (q.has('mfa') || q.has('sso')) history.replaceState(null, '', location.pathname);
}

form.addEventListener('submit', async e => {
  e.preventDefault();
  errorEl.hidden = true;
  btn.disabled   = true;
  btn.querySelector('.login-btn-text').textContent = t('login.signingIn');

  const username = /** @type {HTMLInputElement} */ (document.getElementById('username')).value.trim();
  const password = /** @type {HTMLInputElement} */ (document.getElementById('password')).value;

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

    if (data.mfa) { askCode(data.ticket); return; }
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
