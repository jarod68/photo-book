'use strict';

// Creates a stable visual-regression album with one photo, then saves the
// admin session to .auth/admin.json so every spec can reuse it.

const { chromium } = require('@playwright/test');
const fs   = require('fs');
const path = require('path');

const BASE_URL    = process.env.BASE_URL    ?? 'http://localhost:3000';
const ADMIN_PASS  = process.env.ADMIN_PASS  ?? '';
const VISUAL_ALBUM = 'visual-regression';
const AUTH_FILE    = path.join(__dirname, '.auth/admin.json');
const FIXTURE      = path.join(__dirname, '../integration_tests/fixtures/test-photo-1.png');

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

  // ── Create test album (idempotent) ────────────────────────────────────────
  const api = context.request;
  await api.delete(`${BASE_URL}/api/admin/albums/${VISUAL_ALBUM}`).catch(() => {});
  const create = await api.post(`${BASE_URL}/api/admin/albums`, {
    data:    { name: VISUAL_ALBUM },
    headers: { 'Content-Type': 'application/json' },
  });
  if (!create.ok()) throw new Error(`Failed to create album: ${await create.text()}`);

  // ── Upload one fixture photo ───────────────────────────────────────────────
  const upload = await api.post(
    `${BASE_URL}/api/admin/albums/${VISUAL_ALBUM}/photos`,
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
  if (!upload.ok()) throw new Error(`Failed to upload photo: ${await upload.text()}`);

  await browser.close();
}

module.exports = globalSetup;
