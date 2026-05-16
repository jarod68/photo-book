import { t, getLang, applyTranslations, initLangSwitcher } from '../utils/i18n.js';
import { requireLogin } from '../utils/auth-check.js';

await requireLogin();

applyTranslations();
initLangSwitcher('lang-switcher');

// ── Password utilities ────────────────────────────────────────────────────────

function validatePwd(password) {
  if (!password || password.length < 8)      return t('admin.pwd.minLength');
  if (!/[A-Z]/.test(password))               return t('admin.pwd.uppercase');
  if (!/[a-z]/.test(password))               return t('admin.pwd.lowercase');
  if (!/[0-9]/.test(password))               return t('admin.pwd.digit');
  if (!/[^A-Za-z0-9]/.test(password))        return t('admin.pwd.special');
  return null;
}

async function genPassword() {
  const res = await fetch('/api/admin/generate-password');
  if (!res.ok) return null;
  const { password } = await res.json().catch(() => ({}));
  return password ?? null;
}

function toggleReveal(input) {
  input.type = input.type === 'password' ? 'text' : 'password';
}

async function copyPassword(input) {
  if (!input.value) return;
  await navigator.clipboard.writeText(input.value).catch(() => {});
  input.select();
  input.classList.add('input--copied');
  const group = input.closest('.admin-pwd-group');
  if (group) group.dataset.copied = '1';
  setTimeout(() => {
    input.classList.remove('input--copied');
    if (group) delete group.dataset.copied;
  }, 1500);
}

// ── User info + logout ────────────────────────────────────────────────────────

const { user } = await fetch('/api/auth/me').then(r => r.json());
if (user) document.getElementById('admin-user-label').textContent = user.username;

const isAdmin = user?.role === 'admin';
if (!isAdmin) {
  for (const id of ['section-albums', 'section-users', 'section-system']) {
    document.getElementById(id).hidden = true;
  }
}

document.getElementById('logout-btn').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.replace('/');
});

// ── Albums management ─────────────────────────────────────────────────────────

async function loadAlbums() {
  const body = document.getElementById('albums-body');
  try {
    const { albums } = await fetch('/api/admin/stats').then(r => r.json());
    if (!albums.length) {
      body.innerHTML = `<tr><td colspan="5" class="admin-empty">${t('admin.noAlbums')}</td></tr>`;
      return;
    }
    body.innerHTML = albums.map(a => renderAlbumRow(a)).join('');
    body.querySelectorAll('[data-settings]').forEach(btn =>
      btn.addEventListener('click', () => openAlbumSettings(btn.dataset.settings)));
    body.querySelectorAll('[data-rename]').forEach(btn =>
      btn.addEventListener('click', () => startRename(btn.dataset.rename)));
    body.querySelectorAll('[data-delete]').forEach(btn =>
      btn.addEventListener('click', () => deleteAlbum(btn.dataset.delete)));
    body.querySelectorAll('[data-upload]').forEach(btn =>
      btn.addEventListener('click', () => openUploadModal(btn.dataset.upload)));
  } catch (_) {
    body.innerHTML = `<tr><td colspan="5" class="admin-error">${t('admin.failedLoad')}</td></tr>`;
  }
}

function renderAlbumRow(a) {
  const vis = a.visibility ?? 'public';
  return `
    <tr data-album="${esc(a.album)}">
      <td>
        <a class="admin-link" href="/viewer.html?album=${encodeURIComponent(a.album)}">${esc(a.album)}</a>
        <span class="admin-visibility-badge admin-visibility-badge--${vis}">${vis}</span>
      </td>
      <td class="num">${a.photos}</td>
      <td class="num">${a.views.toLocaleString()}</td>
      <td class="num">${a.likes.toLocaleString()}</td>
      <td class="admin-row-actions">
        <button class="admin-icon-btn" data-settings="${esc(a.album)}" title="${t('admin.settings')}">${iconGear()}</button>
        <button class="admin-icon-btn" data-upload="${esc(a.album)}" title="${t('admin.uploadPhotos')}">${iconUpload()}</button>
        <button class="admin-icon-btn" data-rename="${esc(a.album)}" title="${t('admin.rename')}">${iconPencil()}</button>
        <button class="admin-icon-btn admin-icon-btn--danger" data-delete="${esc(a.album)}" title="${t('admin.log.album_delete')}">${iconTrash()}</button>
      </td>
    </tr>`;
}

function startRename(albumName) {
  const row = document.querySelector(`[data-album="${CSS.escape(albumName)}"]`);
  if (!row) return;
  const nameCell = row.cells[0];
  const original = nameCell.innerHTML;
  nameCell.innerHTML = `
    <form class="admin-rename-form">
      <input class="admin-inline-input" value="${esc(albumName)}" autocomplete="off" spellcheck="false">
      <button type="submit" class="admin-action-btn">${t('admin.save')}</button>
      <button type="button" class="admin-action-btn admin-action-btn--ghost admin-rename-cancel">${t('admin.cancel')}</button>
    </form>`;
  const form  = nameCell.querySelector('form');
  const input = nameCell.querySelector('input');
  input.focus();
  input.select();
  nameCell.querySelector('.admin-rename-cancel').addEventListener('click', () => {
    nameCell.innerHTML = original;
  });
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const newName = input.value.trim();
    if (!newName || newName === albumName) { nameCell.innerHTML = original; return; }
    const res = await fetch(`/api/admin/albums/${encodeURIComponent(albumName)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName }),
    });
    if (res.ok) { await loadAlbums(); }
    else {
      const { error } = await res.json();
      alert(error ?? t('admin.renameFailed'));
      nameCell.innerHTML = original;
    }
  });
}

async function deleteAlbum(albumName) {
  if (!confirm(t('admin.confirmDeleteAlbum', { name: albumName }))) return;
  const res = await fetch(`/api/admin/albums/${encodeURIComponent(albumName)}`, { method: 'DELETE' });
  if (res.ok) { await loadAlbums(); }
  else {
    const { error } = await res.json().catch(() => ({}));
    alert(error ?? t('admin.deleteFailed'));
  }
}

// ── New album form ────────────────────────────────────────────────────────────

document.getElementById('new-album-btn').addEventListener('click', () => {
  const form = document.getElementById('new-album-form');
  form.hidden = false;
  document.getElementById('new-album-input').focus();
});

document.getElementById('new-album-cancel').addEventListener('click', () => {
  document.getElementById('new-album-form').hidden = true;
  document.getElementById('new-album-input').value = '';
});

document.getElementById('new-album-form').addEventListener('submit', async e => {
  e.preventDefault();
  const name = document.getElementById('new-album-input').value.trim();
  if (!name) return;
  const res = await fetch('/api/admin/albums', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (res.ok) {
    document.getElementById('new-album-form').hidden = true;
    document.getElementById('new-album-input').value = '';
    await loadAlbums();
  } else {
    const { error } = await res.json().catch(() => ({}));
    alert(error ?? t('admin.createFailed'));
  }
});

// ── Top photos ────────────────────────────────────────────────────────────────

async function loadTopPhotos() {
  const body = document.getElementById('photos-body');
  try {
    const { photos } = await fetch('/api/admin/top-photos?limit=20').then(r => r.json());
    if (!photos.length) {
      body.innerHTML = `<tr><td colspan="4" class="admin-empty">${t('admin.noData')}</td></tr>`;
      return;
    }
    body.innerHTML = photos.map(p => `
      <tr>
        <td><a class="admin-link" href="${p.url}" target="_blank">${esc(p.filename)}</a></td>
        <td>${esc(p.album)}</td>
        <td class="num">${p.views.toLocaleString()}</td>
        <td class="num">${p.likes.toLocaleString()}</td>
      </tr>
    `).join('');
  } catch (_) {
    body.innerHTML = `<tr><td colspan="4" class="admin-error">${t('admin.failedLoad')}</td></tr>`;
  }
}

// ── System info ───────────────────────────────────────────────────────────────

async function loadSystem() {
  const meta = document.getElementById('system-meta');
  const body = document.getElementById('system-body');
  try {
    const { node, uptime, containers } = await fetch('/api/admin/system').then(r => r.json());

    meta.innerHTML = `
      <span class="admin-meta-pill">Node ${esc(node)}</span>
      <span class="admin-meta-pill">Uptime ${formatUptime(uptime)}</span>
    `;

    if (!containers.length) {
      body.innerHTML = `<tr><td colspan="4" class="admin-empty">${t('admin.noDockerSocket')}</td></tr>`;
      return;
    }

    body.innerHTML = containers.map(c => {
      const ref    = c.tags[0] ?? c.image;
      const digest = c.digest ? shortDigest(c.digest) : '—';
      const stateClass = c.state === 'running' ? 'admin-state-ok' : 'admin-state-warn';
      return `
        <tr>
          <td class="admin-mono">${esc(c.name)}</td>
          <td class="admin-mono">${esc(c.image)}</td>
          <td class="admin-mono admin-digest" title="${esc(c.digest ?? '')}">
            <span class="admin-ref">${esc(ref)}</span>
            <span class="admin-hash">${esc(digest)}</span>
          </td>
          <td><span class="admin-state ${stateClass}">${esc(c.status)}</span></td>
        </tr>
      `;
    }).join('');
  } catch (_) {
    body.innerHTML = `<tr><td colspan="4" class="admin-error">${t('admin.failedLoad')}</td></tr>`;
  }
}

function shortDigest(digest) {
  // "image@sha256:abcdef..." → "sha256:abcdef" (first 19 chars of hash)
  const match = digest.match(/sha256:([0-9a-f]+)/);
  return match ? `sha256:${match[1].slice(0, 12)}` : digest.slice(0, 24);
}

function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// ── Upload modal ──────────────────────────────────────────────────────────────

const overlay      = document.getElementById('upload-overlay');
const dropZone     = document.getElementById('drop-zone');
const fileInput    = document.getElementById('upload-file-input');
const fileListEl   = document.getElementById('upload-file-list');
const progressWrap = document.getElementById('upload-progress-wrap');
const progressFill = document.getElementById('upload-progress-fill');
const progressText = document.getElementById('upload-progress-text');
const fileCountEl  = document.getElementById('upload-file-count');
const startBtn     = document.getElementById('upload-start-btn');

let uploadAlbum = '';
let pendingFiles = [];

function openUploadModal(album) {
  uploadAlbum = album;
  pendingFiles = [];
  document.getElementById('upload-album-name').textContent = album;
  fileListEl.innerHTML = '';
  fileCountEl.textContent = '';
  progressWrap.hidden = true;
  progressFill.style.width = '0%';
  startBtn.disabled = true;
  startBtn.textContent = t('admin.upload');
  dropZone.classList.remove('drop-zone--active');
  overlay.hidden = false;
}

function closeUploadModal() {
  overlay.hidden = true;
}

function addFiles(newFiles) {
  const existing = new Set(pendingFiles.map(f => f.name));
  for (const f of newFiles) {
    if (!existing.has(f.name)) { pendingFiles.push(f); existing.add(f.name); }
  }
  renderFileList();
}

function renderFileList() {
  fileListEl.innerHTML = pendingFiles.map((f, i) => `
    <li class="upload-file-item">
      <span class="upload-file-name">${esc(f.name)}</span>
      <span class="upload-file-size">${formatBytes(f.size)}</span>
      <button class="upload-file-remove" data-idx="${i}" aria-label="Remove">✕</button>
    </li>`).join('');
  fileListEl.querySelectorAll('.upload-file-remove').forEach(btn =>
    btn.addEventListener('click', () => {
      pendingFiles.splice(Number(btn.dataset.idx), 1);
      renderFileList();
    }));
  const n = pendingFiles.length;
  fileCountEl.textContent = n ? t('admin.filesSelected', { n, s: n > 1 ? 's' : '' }) : '';
  startBtn.disabled = n === 0;
}

function formatBytes(b) {
  if (b < 1024)       return `${b} B`;
  if (b < 1048576)    return `${(b/1024).toFixed(1)} KB`;
  return `${(b/1048576).toFixed(1)} MB`;
}

startBtn.addEventListener('click', async () => {
  if (!pendingFiles.length) return;
  startBtn.disabled = true;
  progressWrap.hidden = false;
  progressFill.style.width = '0%';
  progressText.textContent = '0%';

  const formData = new FormData();
  for (const f of pendingFiles) formData.append('photos', f);

  try {
    await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.upload.onprogress = e => {
        if (!e.lengthComputable) return;
        const pct = Math.round(e.loaded / e.total * 100);
        progressFill.style.width = `${pct}%`;
        progressText.textContent = `${pct}%`;
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve(JSON.parse(xhr.responseText));
        else reject(new Error(JSON.parse(xhr.responseText)?.error ?? 'Upload failed'));
      };
      xhr.onerror = () => reject(new Error(t('admin.networkError')));
      xhr.open('POST', `/api/admin/albums/${encodeURIComponent(uploadAlbum)}/photos`);
      xhr.send(formData);
    });

    progressFill.style.width = '100%';
    progressText.textContent = '100%';
    pendingFiles = [];
    await loadAlbums();
    closeUploadModal();
  } catch (err) {
    progressText.textContent = `Error: ${err.message}`;
    startBtn.disabled = false;
  }
});

// Close
document.getElementById('upload-close-btn').addEventListener('click', closeUploadModal);
overlay.addEventListener('click', e => { if (e.target === overlay) closeUploadModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !overlay.hidden) closeUploadModal(); });

// File input
fileInput.addEventListener('change', () => {
  addFiles([...fileInput.files]);
  fileInput.value = '';
});

// Drag & drop
dropZone.addEventListener('dragover', e => {
  e.preventDefault();
  dropZone.classList.add('drop-zone--active');
});
dropZone.addEventListener('dragleave', e => {
  if (!dropZone.contains(e.relatedTarget)) dropZone.classList.remove('drop-zone--active');
});
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('drop-zone--active');
  addFiles([...e.dataTransfer.files]);
});

function iconUpload() {
  return `<svg viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5
      0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5z"/>
    <path d="M7.646 1.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1-.708.708L8.5
      2.707V11.5a.5.5 0 0 1-1 0V2.707L5.354 4.854a.5.5 0 1 1-.708-.708l3-3z"/>
  </svg>`;
}

function iconPencil() {
  return `<svg viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <path d="M12.146.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1 0 .708l-10 10a.5.5 0 0
      1-.168.11l-5 2a.5.5 0 0 1-.65-.65l2-5a.5.5 0 0 1 .11-.168l10-10zM11.207 2.5
      L13.5 4.793 14.793 3.5 12.5 1.207 11.207 2.5zm1.586 3L10.5 3.207 4 9.707V10h.5a.5.5
      0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.293l6.5-6.5zm-9.761 5.175l-.106.106-1.528
      3.821 3.821-1.528.106-.106A.5.5 0 0 1 5 12.5V12h-.5a.5.5 0 0
      1-.5-.5V11h-.5a.5.5 0 0 1-.468-.325z"/>
  </svg>`;
}

function iconTrash() {
  return `<svg viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5
      0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0
      0-1 0v6a.5.5 0 0 0 1 0V6z"/>
    <path fill-rule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2
      2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1
      0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1
      0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/>
  </svg>`;
}

function esc(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Users management ──────────────────────────────────────────────────────────

async function loadUsers() {
  const body = document.getElementById('users-body');
  try {
    const { users } = await fetch('/api/admin/users').then(r => r.json());
    if (!users.length) {
      body.innerHTML = `<tr><td colspan="4" class="admin-empty">${t('admin.noUsers')}</td></tr>`;
      return;
    }
    body.innerHTML = users.map(u => renderUserRow(u)).join('');
    body.querySelectorAll('.user-role-select').forEach(sel =>
      sel.addEventListener('change', () => saveRole(Number(sel.dataset.id), sel.value, sel)));
    body.querySelectorAll('[data-pwd]').forEach(btn =>
      btn.addEventListener('click', () => openPwdModal(Number(btn.dataset.pwd), btn.dataset.username)));
    body.querySelectorAll('[data-del]').forEach(btn =>
      btn.addEventListener('click', () => deleteUser(Number(btn.dataset.del), btn.dataset.username)));
  } catch (_) {
    body.innerHTML = `<tr><td colspan="4" class="admin-error">${t('admin.failedLoad')}</td></tr>`;
  }
}

function renderUserRow(u) {
  const fmt = d => d ? new Date(d).toLocaleDateString({ fr: 'fr-FR', en: 'en-US', es: 'es-ES' }[getLang()] ?? 'en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
  const isProtected = u.username === 'admin';
  return `
    <tr data-user-id="${u.id}">
      <td>${esc(u.username)}</td>
      <td>
        <select class="admin-role-select user-role-select" data-id="${u.id}"${isProtected ? ' disabled' : ''}>
          <option value="basic"${u.role === 'basic' ? ' selected' : ''}>basic</option>
          <option value="admin"${u.role === 'admin' ? ' selected' : ''}>admin</option>
        </select>
      </td>
      <td class="admin-date">${esc(fmt(u.created_at))}</td>
      <td class="admin-date">${esc(fmt(u.last_login_at))}</td>
      <td class="admin-row-actions">
        <button class="admin-icon-btn" data-pwd="${u.id}" data-username="${esc(u.username)}" title="${t('admin.changePassword')}">${iconKey()}</button>
        <button class="admin-icon-btn admin-icon-btn--danger" data-del="${u.id}" data-username="${esc(u.username)}"
                title="${t('admin.log.user_delete')}"${isProtected ? ' disabled' : ''}>${iconTrash()}</button>
      </td>
    </tr>`;
}

async function saveRole(id, role, selectEl) {
  const prev = selectEl.dataset.prev ?? selectEl.value;
  selectEl.dataset.prev = role;
  const res = await fetch(`/api/admin/users/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role }),
  });
  if (!res.ok) {
    const { error } = await res.json().catch(() => ({}));
    alert(error ?? t('admin.roleFailed'));
    selectEl.value = prev;
    selectEl.dataset.prev = prev;
  }
}

async function deleteUser(id, username) {
  if (!confirm(t('admin.confirmDeleteUser', { name: username }))) return;
  const res = await fetch(`/api/admin/users/${id}`, { method: 'DELETE' });
  if (res.ok) { await loadUsers(); }
  else {
    const { error } = await res.json().catch(() => ({}));
    alert(error ?? t('admin.deleteFailed'));
  }
}

// ── New user form ─────────────────────────────────────────────────────────────

document.getElementById('new-user-btn').addEventListener('click', () => {
  document.getElementById('new-user-form').hidden = false;
  document.getElementById('new-user-username').focus();
});

function resetNewUserForm() {
  document.getElementById('new-user-form').hidden = true;
  document.getElementById('new-user-username').value = '';
  const pwInput = document.getElementById('new-user-password');
  pwInput.value = '';
  pwInput.type = 'password';
  document.getElementById('new-user-pwd-error').textContent = '';
}

document.getElementById('new-user-cancel').addEventListener('click', resetNewUserForm);

document.getElementById('new-user-gen-btn').addEventListener('click', async () => {
  const pwd = await genPassword();
  if (!pwd) return;
  const input = document.getElementById('new-user-password');
  input.value = pwd;
  input.type = 'text';
  document.getElementById('new-user-pwd-error').textContent = '';
});

document.getElementById('new-user-password').addEventListener('click', function () {
  copyPassword(this);
});

document.getElementById('new-user-reveal-btn').addEventListener('click', () => {
  toggleReveal(document.getElementById('new-user-password'));
});

document.getElementById('new-user-form').addEventListener('submit', async e => {
  e.preventDefault();
  const username = document.getElementById('new-user-username').value.trim();
  const password = document.getElementById('new-user-password').value;
  const role     = document.getElementById('new-user-role').value;
  const errEl    = document.getElementById('new-user-pwd-error');
  if (!username) return;
  const pwErr = validatePwd(password);
  if (pwErr) { errEl.textContent = pwErr; return; }
  errEl.textContent = '';
  const res = await fetch('/api/admin/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, role }),
  });
  if (res.ok) {
    resetNewUserForm();
    await loadUsers();
  } else {
    const { error } = await res.json().catch(() => ({}));
    errEl.textContent = error ?? t('admin.createFailed');
  }
});

// ── Password modal ────────────────────────────────────────────────────────────

const pwdOverlay  = document.getElementById('pwd-overlay');
const pwdNewInput = document.getElementById('pwd-new');
const pwdErrorEl  = document.getElementById('pwd-error');
let pwdUserId     = null;

function openPwdModal(id, username) {
  pwdUserId = id;
  document.getElementById('pwd-username').textContent = username;
  pwdNewInput.value = '';
  pwdNewInput.type = 'password';
  pwdErrorEl.textContent = '';
  pwdOverlay.hidden = false;
  pwdNewInput.focus();
}

function closePwdModal() {
  pwdOverlay.hidden = true;
  pwdUserId = null;
  pwdNewInput.type = 'password';
}

document.getElementById('pwd-gen-btn').addEventListener('click', async () => {
  const pwd = await genPassword();
  if (!pwd) return;
  pwdNewInput.value = pwd;
  pwdNewInput.type = 'text';
  pwdErrorEl.textContent = '';
});

pwdNewInput.addEventListener('click', function () {
  copyPassword(this);
});

document.getElementById('pwd-reveal-btn').addEventListener('click', () => {
  toggleReveal(pwdNewInput);
});

document.getElementById('pwd-save-btn').addEventListener('click', async () => {
  const password = pwdNewInput.value;
  const pwErr = validatePwd(password);
  if (pwErr) { pwdErrorEl.textContent = pwErr; return; }
  pwdErrorEl.textContent = '';
  const res = await fetch(`/api/admin/users/${pwdUserId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  if (res.ok) { closePwdModal(); }
  else {
    const { error } = await res.json().catch(() => ({}));
    pwdErrorEl.textContent = error ?? t('admin.pwdFailed');
  }
});

document.getElementById('pwd-close-btn').addEventListener('click', closePwdModal);
pwdOverlay.addEventListener('click', e => { if (e.target === pwdOverlay) closePwdModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !pwdOverlay.hidden) closePwdModal(); });

function iconGear() {
  return `<svg viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <path d="M8 4.754a3.246 3.246 0 1 0 0 6.492 3.246 3.246 0 0 0 0-6.492zM5.754 8a2.246 2.246 0 1 1 4.492 0 2.246 2.246 0 0 1-4.492 0z"/>
    <path d="M9.796 1.343c-.527-1.79-3.065-1.79-3.592 0l-.094.319a.873.873 0 0 1-1.255.52l-.292-.16c-1.64-.892-3.433.902-2.54
      2.541l.159.292a.873.873 0 0 1-.52 1.255l-.319.094c-1.79.527-1.79 3.065 0 3.592l.319.094a.873.873 0 0 1 .52
      1.255l-.16.292c-.892 1.64.901 3.434 2.541 2.54l.292-.159a.873.873 0 0 1 1.255.52l.094.319c.527 1.79 3.065 1.79
      3.592 0l.094-.319a.873.873 0 0 1 1.255-.52l.292.16c1.64.893 3.434-.902 2.54-2.541l-.159-.292a.873.873 0 0 1
      .52-1.255l.319-.094c1.79-.527 1.79-3.065 0-3.592l-.319-.094a.873.873 0 0 1-.52-1.255l.16-.292c.893-1.64-.902-3.433-2.541-2.54l-.292.159a.873.873
      0 0 1-1.255-.52l-.094-.319z"/>
  </svg>`;
}

function iconKey() {
  return `<svg viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <path d="M0 8a4 4 0 0 1 7.465-2H14a.5.5 0 0 1 .354.146l1.5 1.5a.5.5 0
      0 1 0 .708l-1.5 1.5a.5.5 0 0 1-.708 0L13 9.207l-.646.647a.5.5 0 0
      1-.708 0L11 9.207l-.646.647a.5.5 0 0 1-.708 0L9 9.207l-.646.647A.5.5
      0 0 1 8 10h-.535A4 4 0 0 1 0 8zm4-3a3 3 0 1 0 2.712 4.285A.5.5 0 0 1
      7.163 9h.63l.853-.854a.5.5 0 0 1 .708 0l.646.647.646-.647a.5.5 0 0 1
      .708 0l.646.647.646-.647a.5.5 0 0 1 .708 0l.746.746.952-.952-1.236-1.236H7.163a.5.5
      0 0 1-.45-.285A3 3 0 0 0 4 5zm0 3a1 1 0 1 1 0-2 1 1 0 0 1 0 2z"/>
  </svg>`;
}

// ── Album settings modal ──────────────────────────────────────────────────────

const albumSettingsOverlay = document.getElementById('album-settings-overlay');
const albumSettingsError   = document.getElementById('album-settings-error');
let   albumSettingsName    = null;

async function openAlbumSettings(albumName) {
  albumSettingsName = albumName;
  document.getElementById('album-settings-name').textContent = albumName;
  albumSettingsError.textContent = '';
  albumSettingsOverlay.hidden = false;

  const [settingsRes, usersRes] = await Promise.all([
    fetch(`/api/admin/albums/${encodeURIComponent(albumName)}/settings`).then(r => r.json()),
    fetch('/api/admin/users').then(r => r.json()),
  ]);

  const basicUsers    = (usersRes.users ?? []).filter(u => u.role === 'basic');
  const authorizedIds = new Set((settingsRes.users ?? []).map(u => u.id));

  const visRadio = document.querySelector(`input[name="album-visibility"][value="${settingsRes.visibility}"]`);
  if (visRadio) visRadio.checked = true;

  const checkboxesEl = document.getElementById('album-users-checkboxes');
  if (basicUsers.length === 0) {
    checkboxesEl.innerHTML = `<p class="album-settings-no-users">${t('admin.noBasicUsers')}</p>`;
  } else {
    checkboxesEl.innerHTML = basicUsers.map(u => `
      <label class="album-user-checkbox">
        <input type="checkbox" value="${u.id}"${authorizedIds.has(u.id) ? ' checked' : ''}>
        ${esc(u.username)}
      </label>`).join('');
  }

  const usersSection = document.getElementById('album-settings-users');
  usersSection.hidden = settingsRes.visibility !== 'restricted';
  document.querySelectorAll('input[name="album-visibility"]').forEach(radio => {
    radio.onchange = () => { usersSection.hidden = radio.value !== 'restricted'; };
  });
}

function closeAlbumSettings() {
  albumSettingsOverlay.hidden = true;
  albumSettingsName = null;
}

document.getElementById('album-settings-save-btn').addEventListener('click', async () => {
  if (!albumSettingsName) return;
  const visibility = document.querySelector('input[name="album-visibility"]:checked')?.value;
  if (!visibility) return;
  const userIds = [...document.querySelectorAll('#album-users-checkboxes input[type=checkbox]:checked')]
    .map(el => Number(el.value));
  albumSettingsError.textContent = '';
  const res = await fetch(`/api/admin/albums/${encodeURIComponent(albumSettingsName)}/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ visibility, userIds }),
  });
  if (res.ok) {
    closeAlbumSettings();
    await loadAlbums();
  } else {
    const { error } = await res.json().catch(() => ({}));
    albumSettingsError.textContent = error ?? t('admin.saveFailed');
  }
});

document.getElementById('album-settings-close-btn').addEventListener('click', closeAlbumSettings);
albumSettingsOverlay.addEventListener('click', e => { if (e.target === albumSettingsOverlay) closeAlbumSettings(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !albumSettingsOverlay.hidden) closeAlbumSettings(); });

// ── Activity log ──────────────────────────────────────────────────────────────

const LOG_LABELS = {
  login:        { label: () => t('admin.log.login'),        color: 'green'  },
  logout:       { label: () => t('admin.log.logout'),       color: 'gray'   },
  photo_like:   { label: () => t('admin.log.photo_like'),   color: 'pink'   },
  photo_upload: { label: () => t('admin.log.photo_upload'), color: 'blue'   },
  photo_delete: { label: () => t('admin.log.photo_delete'), color: 'red'    },
  album_create: { label: () => t('admin.log.album_create'), color: 'blue'   },
  album_rename: { label: () => t('admin.log.album_rename'), color: 'blue'   },
  album_delete: { label: () => t('admin.log.album_delete'), color: 'red'    },
  user_create:  { label: () => t('admin.log.user_create'),  color: 'green'  },
  user_delete:  { label: () => t('admin.log.user_delete'),  color: 'red'    },
};

function renderLogDetails(action, details) {
  if (!details) return '—';
  switch (action) {
    case 'photo_like':   return `${esc(details.album)}/${esc(details.filename)} (${details.liked ? '♥ liked' : '♡ unliked'})`;
    case 'photo_upload': return `${details.count} photo(s) → ${esc(details.album)}`;
    case 'photo_delete': return `${esc(details.album)}/${esc(details.filename)}`;
    case 'album_create': return esc(details.album);
    case 'album_rename': return `${esc(details.from)} → ${esc(details.to)}`;
    case 'album_delete': return esc(details.album);
    case 'user_create':  return `${esc(details.created_username)} (${esc(details.role)})`;
    case 'user_delete':  return esc(details.deleted_username);
    default: return '—';
  }
}

function renderLogRow(log) {
  const meta  = LOG_LABELS[log.action] ?? { label: () => log.action, color: 'gray' };
  const date  = new Date(log.created_at);
  const dateStr = date.toLocaleDateString({ fr: 'fr-FR', en: 'en-US', es: 'es-ES' }[getLang()] ?? 'en-US', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const timeStr = date.toLocaleTimeString({ fr: 'fr-FR', en: 'en-US', es: 'es-ES' }[getLang()] ?? 'en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return `
    <tr>
      <td class="admin-date" title="${esc(date.toISOString())}">${dateStr} ${timeStr}</td>
      <td><span class="log-badge log-badge--${meta.color}">${esc(meta.label())}</span></td>
      <td>${log.username ? esc(log.username) : `<span class="admin-dim">${t('admin.guest')}</span>`}</td>
      <td class="admin-dim admin-mono">${log.ip ? esc(log.ip) : '—'}</td>
      <td class="admin-dim">${renderLogDetails(log.action, log.details)}</td>
    </tr>`;
}

let logPage = 1;
let logAction = '';

async function loadLogs(page = 1, action = '') {
  logPage   = page;
  logAction = action;
  const body = document.getElementById('logs-body');
  const pag  = document.getElementById('logs-pagination');
  body.innerHTML = `<tr><td colspan="5" class="admin-loading">${t('admin.loading')}</td></tr>`;
  try {
    const params = new URLSearchParams({ page, limit: 50 });
    if (action) params.set('action', action);
    const data = await fetch(`/api/admin/logs?${params}`).then(r => r.json());
    if (!data.logs?.length) {
      body.innerHTML = `<tr><td colspan="5" class="admin-empty">${t('admin.noEntries')}</td></tr>`;
      pag.innerHTML = '';
      return;
    }
    body.innerHTML = data.logs.map(renderLogRow).join('');
    pag.innerHTML = `
      <button class="admin-action-btn admin-action-btn--ghost" ${page <= 1 ? 'disabled' : ''} id="log-prev">${t('admin.prev')}</button>
      <span class="admin-pagination-info">${t('admin.pageInfo', { page, pages: data.pages, total: data.total, s: data.total > 1 ? 's' : '' })}</span>
      <button class="admin-action-btn admin-action-btn--ghost" ${page >= data.pages ? 'disabled' : ''} id="log-next">${t('admin.next')}</button>
    `;
    document.getElementById('log-prev')?.addEventListener('click', () => loadLogs(logPage - 1, logAction));
    document.getElementById('log-next')?.addEventListener('click', () => loadLogs(logPage + 1, logAction));
  } catch (_) {
    body.innerHTML = `<tr><td colspan="5" class="admin-error">${t('admin.failedLoad')}</td></tr>`;
  }
}

document.getElementById('log-filter').addEventListener('change', e => loadLogs(1, e.target.value));

document.getElementById('clear-logs-btn').addEventListener('click', async () => {
  if (!confirm(t('admin.clearLogsConfirm'))) return;
  const res = await fetch('/api/admin/logs', { method: 'DELETE' });
  if (res.ok) loadLogs(1, logAction);
});

loadTopPhotos();
if (isAdmin) {
  loadSystem();
  loadAlbums();
  loadUsers();
  loadLogs();
}
