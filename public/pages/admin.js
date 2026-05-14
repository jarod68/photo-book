import { requireLogin } from '../utils/auth-check.js';

await requireLogin();

// ── User info + logout ────────────────────────────────────────────────────────

const { user } = await fetch('/api/auth/me').then(r => r.json());
if (user) document.getElementById('admin-user').textContent = user.username;

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
      body.innerHTML = '<tr><td colspan="5" class="admin-empty">No albums yet.</td></tr>';
      return;
    }
    body.innerHTML = albums.map(a => renderAlbumRow(a)).join('');
    body.querySelectorAll('[data-rename]').forEach(btn =>
      btn.addEventListener('click', () => startRename(btn.dataset.rename)));
    body.querySelectorAll('[data-delete]').forEach(btn =>
      btn.addEventListener('click', () => deleteAlbum(btn.dataset.delete)));
    body.querySelectorAll('[data-upload]').forEach(btn =>
      btn.addEventListener('click', () => openUploadModal(btn.dataset.upload)));
  } catch (_) {
    body.innerHTML = '<tr><td colspan="5" class="admin-error">Failed to load.</td></tr>';
  }
}

function renderAlbumRow(a) {
  return `
    <tr data-album="${esc(a.album)}">
      <td><a class="admin-link" href="/viewer.html?album=${encodeURIComponent(a.album)}">${esc(a.album)}</a></td>
      <td class="num">${a.photos}</td>
      <td class="num">${a.views.toLocaleString()}</td>
      <td class="num">${a.likes.toLocaleString()}</td>
      <td class="admin-row-actions">
        <button class="admin-icon-btn" data-upload="${esc(a.album)}" title="Upload photos">${iconUpload()}</button>
        <button class="admin-icon-btn" data-rename="${esc(a.album)}" title="Rename">${iconPencil()}</button>
        <button class="admin-icon-btn admin-icon-btn--danger" data-delete="${esc(a.album)}" title="Delete">${iconTrash()}</button>
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
      <button type="submit" class="admin-action-btn">Save</button>
      <button type="button" class="admin-action-btn admin-action-btn--ghost admin-rename-cancel">Cancel</button>
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
      alert(error ?? 'Rename failed');
      nameCell.innerHTML = original;
    }
  });
}

async function deleteAlbum(albumName) {
  if (!confirm(`Delete album "${albumName}" and all its photos?\nThis cannot be undone.`)) return;
  const res = await fetch(`/api/admin/albums/${encodeURIComponent(albumName)}`, { method: 'DELETE' });
  if (res.ok) { await loadAlbums(); }
  else {
    const { error } = await res.json().catch(() => ({}));
    alert(error ?? 'Delete failed');
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
    alert(error ?? 'Create failed');
  }
});

// ── Top photos ────────────────────────────────────────────────────────────────

async function loadTopPhotos() {
  const body = document.getElementById('photos-body');
  try {
    const { photos } = await fetch('/api/admin/top-photos?limit=20').then(r => r.json());
    if (!photos.length) {
      body.innerHTML = '<tr><td colspan="4" class="admin-empty">No data yet.</td></tr>';
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
    body.innerHTML = '<tr><td colspan="4" class="admin-error">Failed to load.</td></tr>';
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
      body.innerHTML = '<tr><td colspan="4" class="admin-empty">Docker socket unavailable.</td></tr>';
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
    body.innerHTML = '<tr><td colspan="4" class="admin-error">Failed to load.</td></tr>';
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
  startBtn.textContent = 'Upload';
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
  fileCountEl.textContent = n ? `${n} file${n > 1 ? 's' : ''} selected` : '';
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
      xhr.onerror = () => reject(new Error('Network error'));
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

loadSystem();
loadAlbums();
loadTopPhotos();
