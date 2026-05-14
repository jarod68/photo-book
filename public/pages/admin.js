import { requireLogin } from '../utils/auth-check.js';

await requireLogin();

// ── User info + logout ────────────────────────────────────────────────────────

const { user } = await fetch('/api/auth/me').then(r => r.json());
if (user) document.getElementById('admin-user').textContent = user.username;

document.getElementById('logout-btn').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.replace('/');
});

// ── Albums stats ──────────────────────────────────────────────────────────────

async function loadAlbums() {
  const body = document.getElementById('albums-body');
  try {
    const { albums } = await fetch('/api/admin/stats').then(r => r.json());
    if (!albums.length) {
      body.innerHTML = '<tr><td colspan="4" class="admin-empty">No data yet.</td></tr>';
      return;
    }
    body.innerHTML = albums.map(a => `
      <tr>
        <td><a class="admin-link" href="/viewer.html#${encodeURIComponent(a.album)}">${esc(a.album)}</a></td>
        <td class="num">${a.photos}</td>
        <td class="num">${a.views.toLocaleString()}</td>
        <td class="num">${a.likes.toLocaleString()}</td>
      </tr>
    `).join('');
  } catch (_) {
    body.innerHTML = '<tr><td colspan="4" class="admin-error">Failed to load.</td></tr>';
  }
}

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

function esc(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

loadSystem();
loadAlbums();
loadTopPhotos();
