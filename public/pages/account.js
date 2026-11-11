// @ts-check
// My account (account.html): the name shown, a few words, a profile picture
// (uploaded, or one of one's photos), the password.
import { t, applyTranslations, initLangSwitcher } from '../utils/i18n.js';
import { requireLogin } from '../utils/auth-check.js';
import { getAlbums, getAlbum } from '../api/client.js';
import { wireBack } from '../utils/back.js';
import { showBuildTag } from '../utils/build-tag.js';
import { avatarHtml } from '../components/avatar.js';
import { esc } from '../utils/article-render.js';

applyTranslations();
initLangSwitcher('lang-switcher');
wireBack(document.querySelector('.account-back'));

const $ = (id) => /** @type {any} */ (document.getElementById(id));
const JSON_HEADERS = { 'Content-Type': 'application/json' };
let me = null;

function status(el, key, cls = '') {
  el.textContent = key ? t(key) : '';
  el.className = `account-status ${cls}`;
}

function render() {
  $('account-avatar').innerHTML = avatarHtml(me);
  $('avatar-remove').hidden = !me.avatarUrl;
  $('profile-name').value = me.displayName ?? '';
  $('profile-name').placeholder = me.username;
  $('profile-bio').value = me.bio ?? '';
  $('public-profile').href = `profile.html?u=${encodeURIComponent(me.username)}`;
  $('pw-username').value = me.username;   // for password managers
}

async function load() {
  me = await fetch('/api/me', { cache: 'no-cache' }).then((r) => r.json());
  render();
}

$('profile-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const r = await fetch('/api/me', {
    method: 'PUT', headers: JSON_HEADERS,
    body: JSON.stringify({ displayName: $('profile-name').value, bio: $('profile-bio').value }),
  });
  if (r.ok) { me = await r.json(); render(); status($('profile-status'), 'account.saved', 'account-status--ok'); }
  else status($('profile-status'), 'account.error', 'account-status--error');
});

// ── Picture ───────────────────────────────────────────────────────────────────
async function setAvatar(init) {
  const r = await fetch('/api/me/avatar', { method: 'PUT', ...init });
  if (r.ok) { me = await r.json(); render(); status($('profile-status'), 'account.saved', 'account-status--ok'); }
  else status($('profile-status'), 'account.error', 'account-status--error');
}

$('avatar-upload').addEventListener('click', () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = () => {
    const file = input.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('avatar', file);
    setAvatar({ body: fd });
  };
  input.click();
});

$('avatar-remove').addEventListener('click', async () => {
  await fetch('/api/me/avatar', { method: 'DELETE' });
  await load();
});

// one of the photos of one's albums
const picker = /** @type {HTMLDialogElement} */ ($('picker'));
const pickerAlbum = /** @type {HTMLSelectElement} */ ($('picker-album'));
async function renderPicker() {
  const { photos } = await getAlbum(pickerAlbum.value).catch(() => ({ photos: [] }));
  const grid = $('picker-grid');
  grid.replaceChildren();
  for (const p of photos.filter((x) => x.type !== 'video' && x.thumbUrl)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'picker-item';
    b.innerHTML = `<img src="${esc(p.thumbUrl)}" alt="${esc(p.name)}" loading="lazy">`;
    b.addEventListener('click', async () => {
      picker.close();
      await setAvatar({ headers: JSON_HEADERS, body: JSON.stringify({ album: pickerAlbum.value, file: p.filename }) });
    });
    grid.appendChild(b);
  }
  if (!grid.children.length) grid.innerHTML = `<p class="picker-empty">${esc(t('write.noPhotos'))}</p>`;
}
$('avatar-pick').addEventListener('click', async () => {
  if (!pickerAlbum.options.length) {
    const albums = (await getAlbums().catch(() => [])).filter((a) => a.canManage && a.count > 0);
    for (const a of albums) pickerAlbum.add(new Option(a.name, a.name));
  }
  if (!pickerAlbum.options.length) { status($('profile-status'), 'write.noPhotos'); return; }
  await renderPicker();
  picker.showModal();
});
pickerAlbum.addEventListener('change', renderPicker);
picker.querySelector('.picker-close').addEventListener('click', () => picker.close());

// ── Security: two-factor sign-in, Google ────────────────────────────────────
async function loadSecurity() {
  const s = await fetch('/api/me/security').then((r) => r.json());
  const on = s.twoFactor.enabled;
  $('sec-mfa-state').textContent = t(on ? 'sec.mfaOn' : 'sec.mfaOff');
  $('sec-mfa-state').classList.toggle('account-badge--on', on);
  $('sec-required').hidden = on || !s.twoFactor.required;
  $('sec-setup').hidden = on;
  $('sec-new-backup').hidden = !on;
  $('sec-disable').hidden = !on || s.twoFactor.required;
  $('sec-backup-left').textContent = on ? t('sec.backupLeft', { n: s.twoFactor.backupLeft }) : '';
  $('sec-google').textContent = !s.email ? t('sec.googleNone')
    : t(s.google ? 'sec.googleLinked' : 'sec.googleReady', { email: s.email });
  $('sec-unlink').hidden = !s.google;
}

function showBackup(codes) {
  const ol = $('sec-backup-codes');
  ol.replaceChildren(...codes.map((c) => Object.assign(document.createElement('li'), { textContent: c })));
  $('sec-backup').hidden = false;
}

$('sec-setup').addEventListener('click', async () => {
  const r = await fetch('/api/me/2fa/setup', { method: 'POST' });
  if (!r.ok) return;
  const { qrSvg, secret } = await r.json();
  $('sec-qr').innerHTML = qrSvg;   // made by the server's QR library from our own secret
  $('sec-secret').textContent = secret.replace(/(.{4})/g, '$1 ').trim();
  $('sec-setup-form').hidden = false;
  $('sec-code').focus();
});

$('sec-setup-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const r = await fetch('/api/me/2fa/enable', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ code: $('sec-code').value }) });
  if (!r.ok) { status($('sec-status'), 'sec.wrongCode', 'account-status--error'); return; }
  $('sec-setup-form').hidden = true;
  showBackup((await r.json()).backupCodes);
  await loadSecurity();
});

$('sec-new-backup').addEventListener('click', async () => {
  const code = prompt(t('sec.codePrompt'));
  if (!code) return;
  const r = await fetch('/api/me/2fa/backup-codes', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ code }) });
  if (!r.ok) { alert(t('sec.wrongCode')); return; }
  showBackup((await r.json()).backupCodes);
  await loadSecurity();
});

$('sec-disable').addEventListener('click', async () => {
  const password = prompt(t('sec.passwordPrompt'));
  if (!password) return;
  const r = await fetch('/api/me/2fa/disable', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ password }) });
  if (!r.ok) { alert(t('account.wrongCurrent')); return; }
  $('sec-backup').hidden = true;
  await loadSecurity();
});

$('sec-unlink').addEventListener('click', async () => {
  await fetch('/api/me/google', { method: 'DELETE' });
  await loadSecurity();
});

// ── Password ──────────────────────────────────────────────────────────────────
$('password-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const el = $('password-status');
  if ($('pw-new').value !== $('pw-confirm').value) { status(el, 'account.mismatch', 'account-status--error'); return; }
  const r = await fetch('/api/me/password', {
    method: 'PUT', headers: JSON_HEADERS,
    body: JSON.stringify({ current: $('pw-current').value, password: $('pw-new').value }),
  });
  if (r.ok) {
    /** @type {HTMLFormElement} */ ($('password-form')).reset();
    status(el, 'account.changed', 'account-status--ok');
  } else if (r.status === 403) {
    status(el, 'account.wrongCurrent', 'account-status--error');
  } else {
    // the server's rule (length, letters, digits…)
    const { error } = await r.json().catch(() => ({}));
    el.textContent = error ?? t('account.error');
    el.className = 'account-status account-status--error';
  }
});

requireLogin().then(() => { load(); loadSecurity(); });
showBuildTag({ footer: true });
