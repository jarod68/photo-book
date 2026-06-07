'use strict';

// Creates two test albums, then saves the admin session to .auth/admin.json
// so every spec can reuse it.
//   visual-regression          — public album, one photo
//   visual-regression-private  — restricted album, one photo (for share tests)

const { chromium } = require('@playwright/test');
const fs   = require('fs');
const path = require('path');

const BASE_URL      = process.env.BASE_URL    ?? 'http://localhost:3000';
const ADMIN_PASS    = process.env.ADMIN_PASS  ?? '';
const PUBLIC_ALBUM  = 'visual-regression';
const PRIVATE_ALBUM = 'visual-regression-private';
const AUTH_FILE     = path.join(__dirname, '.auth/admin.json');
const FIXTURE       = path.join(__dirname, '../integration_tests/fixtures/test-photo-1.png');

async function createAlbum(api, name) {
  await api.delete(`${BASE_URL}/api/admin/albums/${name}`).catch(() => {});
  const res = await api.post(`${BASE_URL}/api/admin/albums`, {
    data:    { name },
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok()) throw new Error(`Failed to create album ${name}: ${await res.text()}`);
}

async function uploadPhoto(api, album) {
  const res = await api.post(
    `${BASE_URL}/api/admin/albums/${album}/photos`,
    {
      multipart: {
        photos: {
          name:     'test-photo-1.png',
          mimeType: 'image/png',
          buffer:   fs.readFileSync(FIXTURE),
        },
      },
    },
  );
  if (!res.ok()) throw new Error(`Failed to upload photo to ${album}: ${await res.text()}`);
}

async function globalSetup() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ locale: 'fr-FR' });
  const page    = await context.newPage();

  // ── Login ─────────────────────────────────────────────────────────────────
  await page.goto(`${BASE_URL}/login.html`);
  await page.fill('#username', 'admin');
  await page.fill('#password', ADMIN_PASS);
  await page.click('button[type="submit"]');
  await page.waitForSelector('body.page-home', { timeout: 12_000 });

  // ── Persist session ───────────────────────────────────────────────────────
  fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });
  await context.storageState({ path: AUTH_FILE });

  const api = context.request;

  // ── Public album ──────────────────────────────────────────────────────────
  await createAlbum(api, PUBLIC_ALBUM);
  await uploadPhoto(api, PUBLIC_ALBUM);

  // ── Restricted album ──────────────────────────────────────────────────────
  await createAlbum(api, PRIVATE_ALBUM);
  await uploadPhoto(api, PRIVATE_ALBUM);

  const settings = await api.put(
    `${BASE_URL}/api/admin/albums/${PRIVATE_ALBUM}/settings`,
    {
      data:    { visibility: 'restricted', userIds: [] },
      headers: { 'Content-Type': 'application/json' },
    },
  );
  if (!settings.ok()) throw new Error(`Failed to set restricted visibility: ${await settings.text()}`);

  await browser.close();
}

module.exports = globalSetup;
