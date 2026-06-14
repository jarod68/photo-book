const SW_PATH      = '/sw.js';
const STORAGE_KEY  = 'pb_push_albums';

// ── localStorage helpers ──────────────────────────────────────────────────────

export function getStoredAlbums() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]'); } catch { return []; }
}

function addStoredAlbum(album) {
  const albums = getStoredAlbums();
  if (!albums.includes(album)) localStorage.setItem(STORAGE_KEY, JSON.stringify([...albums, album]));
}

function removeStoredAlbum(album) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(getStoredAlbums().filter(a => a !== album)));
}

// ── Push API ──────────────────────────────────────────────────────────────────

export async function initPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
  const reg = await navigator.serviceWorker.register(SW_PATH);
  return reg;
}

export async function getVapidKey() {
  const r = await fetch('/api/push/vapid-key');
  const { publicKey } = await r.json();
  return publicKey;
}

export async function subscribeTo(album, share = null) {
  const reg = await initPush();
  if (!reg) return false;
  const publicKey = await getVapidKey();
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });
  const res = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ album, subscription: sub.toJSON(), ...(share ? { share } : {}) }),
  });
  if (!res.ok) return false;
  addStoredAlbum(album);
  return true;
}

export async function unsubscribeFrom(album, endpoint) {
  await fetch('/api/push/subscribe', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ album, endpoint }),
  });
  removeStoredAlbum(album);
  // Cancel PushManager subscription when no albums remain
  if (getStoredAlbums().length === 0) {
    const sub = await getSubscription();
    await sub?.unsubscribe();
  }
}

export async function getSubscription() {
  if (!('serviceWorker' in navigator)) return null;
  const reg = await navigator.serviceWorker.getRegistration(SW_PATH);
  if (!reg) return null;
  return reg.pushManager.getSubscription();
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}
