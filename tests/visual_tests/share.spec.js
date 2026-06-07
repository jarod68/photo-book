'use strict';

// Tests for the album share feature.
// Requires a running stack with:
//   - visual-regression        (public album, created in global.setup.js)
//   - visual-regression-private (restricted album, created in global.setup.js)

const { test, expect } = require('@playwright/test');

const BASE_URL      = process.env.BASE_URL     ?? 'http://localhost:3000';
const PUBLIC_ALBUM  = 'visual-regression';
const PRIVATE_ALBUM = 'visual-regression-private';

// ── Share button visibility ───────────────────────────────────────────────────

test('share button hidden on a public album', async ({ page }) => {
  await page.goto(`/viewer.html?album=${PUBLIC_ALBUM}`);
  await page.waitForSelector('.thumb.active', { state: 'visible', timeout: 10_000 });
  await page.click('#photo-actions-toggle');
  await page.waitForSelector('#photo-actions-menu', { state: 'visible' });

  await expect(page.locator('#share-btn')).toBeHidden();
});

test('share button visible on a restricted album for admin', async ({ page }) => {
  await page.goto(`/viewer.html?album=${PRIVATE_ALBUM}`);
  await page.waitForSelector('.thumb.active', { state: 'visible', timeout: 10_000 });
  await page.click('#photo-actions-toggle');
  await page.waitForSelector('#photo-actions-menu', { state: 'visible' });

  await expect(page.locator('#share-btn')).toBeVisible();
});

// ── Share modal ───────────────────────────────────────────────────────────────

test('share modal opens when share button is clicked', async ({ page }) => {
  await page.goto(`/viewer.html?album=${PRIVATE_ALBUM}`);
  await page.waitForSelector('.thumb.active', { state: 'visible', timeout: 10_000 });
  await page.click('#photo-actions-toggle');
  await page.waitForSelector('#share-btn', { state: 'visible' });
  await page.click('#share-btn');

  await expect(page.locator('#share-modal')).not.toHaveClass(/hidden/);
  await expect(page.locator('.share-modal-box')).toBeVisible();

  await expect(page.locator('#share-modal')).toHaveScreenshot('share-modal-open.png');
});

test('share modal closes with the ✕ button', async ({ page }) => {
  await page.goto(`/viewer.html?album=${PRIVATE_ALBUM}`);
  await page.waitForSelector('.thumb.active', { state: 'visible', timeout: 10_000 });
  await page.click('#photo-actions-toggle');
  await page.waitForSelector('#share-btn', { state: 'visible' });
  await page.click('#share-btn');
  await page.waitForSelector('.share-modal-box', { state: 'visible' });

  await page.click('#share-modal-close');

  await expect(page.locator('#share-modal')).toHaveClass(/hidden/);
});

// ── Duration picker ───────────────────────────────────────────────────────────

test('share duration picker shows custom dropdown (not a native select)', async ({ page }) => {
  await page.goto(`/viewer.html?album=${PRIVATE_ALBUM}`);
  await page.waitForSelector('.thumb.active', { state: 'visible', timeout: 10_000 });
  await page.click('#photo-actions-toggle');
  await page.waitForSelector('#share-btn', { state: 'visible' });
  await page.click('#share-btn');
  await page.waitForSelector('.share-modal-box', { state: 'visible' });

  // Trigger button must be a BUTTON, not a SELECT
  const tag = await page.locator('.share-duration-btn').evaluate(el => el.tagName);
  expect(tag).toBe('BUTTON');

  // Menu is hidden by default
  await expect(page.locator('.share-duration-menu')).toBeHidden();
});

test('share duration picker opens below the button', async ({ page }) => {
  await page.goto(`/viewer.html?album=${PRIVATE_ALBUM}`);
  await page.waitForSelector('.thumb.active', { state: 'visible', timeout: 10_000 });
  await page.click('#photo-actions-toggle');
  await page.waitForSelector('#share-btn', { state: 'visible' });
  await page.click('#share-btn');
  await page.waitForSelector('.share-modal-box', { state: 'visible' });

  await page.click('.share-duration-btn');
  await expect(page.locator('.share-duration-menu')).toBeVisible();

  // Menu must be positioned at or below the button bottom edge
  const btnBox  = await page.locator('.share-duration-btn').boundingBox();
  const menuBox = await page.locator('.share-duration-menu').boundingBox();
  expect(menuBox.y).toBeGreaterThanOrEqual(btnBox.y + btnBox.height - 2);

  await expect(page.locator('.share-duration-picker')).toHaveScreenshot('share-duration-open.png');
});

test('selecting a duration updates label and data-value', async ({ page }) => {
  await page.goto(`/viewer.html?album=${PRIVATE_ALBUM}`);
  await page.waitForSelector('.thumb.active', { state: 'visible', timeout: 10_000 });
  await page.click('#photo-actions-toggle');
  await page.waitForSelector('#share-btn', { state: 'visible' });
  await page.click('#share-btn');
  await page.waitForSelector('.share-modal-box', { state: 'visible' });

  await page.click('.share-duration-btn');
  // Click the "30 days" option
  await page.locator('.share-duration-option[data-value="30"]').click();

  const value = await page.locator('#share-duration').getAttribute('data-value');
  expect(value).toBe('30');

  const labelText = await page.locator('.share-duration-btn .share-duration-label').textContent();
  expect(labelText).toMatch(/30/);
});

// ── Share link generation ─────────────────────────────────────────────────────

test('create share link generates a URL in the input', async ({ page }) => {
  await page.goto(`/viewer.html?album=${PRIVATE_ALBUM}`);
  await page.waitForSelector('.thumb.active', { state: 'visible', timeout: 10_000 });
  await page.click('#photo-actions-toggle');
  await page.waitForSelector('#share-btn', { state: 'visible' });
  await page.click('#share-btn');
  await page.waitForSelector('.share-modal-box', { state: 'visible' });

  await page.click('#share-create-btn');

  // Result section becomes visible
  await expect(page.locator('#share-result')).not.toHaveClass(/hidden/, { timeout: 8_000 });

  const url = await page.locator('#share-url').inputValue();
  expect(url).toContain(`album=${PRIVATE_ALBUM}`);
  expect(url).toMatch(/share=[0-9a-f]{64}/);

  await expect(page.locator('#share-modal')).toHaveScreenshot('share-modal-with-link.png', {
    mask: [page.locator('#share-url'), page.locator('#share-expires')],
  });
});

// ── Anonymous API access via share token ─────────────────────────────────────
// These tests verify the API security layer directly: the browser UI falls back
// to the first public album when a restricted album is absent from the tab list,
// so security assertions belong at the API level.

test('API: anonymous can read restricted album with a valid share token', async ({ context }) => {
  // Create a share token with the admin session
  const createRes = await context.request.post(
    `${BASE_URL}/api/admin/albums/${PRIVATE_ALBUM}/share`,
    {
      data:    { days: 1 },
      headers: { 'Content-Type': 'application/json' },
    },
  );
  expect(createRes.ok()).toBeTruthy();
  const { token } = await createRes.json();

  // Use Node fetch — completely cookie-free, bypasses Playwright session state
  const res = await fetch(`${BASE_URL}/api/albums/${PRIVATE_ALBUM}?share=${token}`);
  expect(res.ok).toBeTruthy();

  const body = await res.json();
  expect(body.name).toBe(PRIVATE_ALBUM);
  expect(Array.isArray(body.photos)).toBeTruthy();
  expect(body.photos.length).toBeGreaterThanOrEqual(1);
  expect(body.canDelete).toBeFalsy();
});

test('API: anonymous is blocked from restricted album without share token', async () => {
  const res = await fetch(`${BASE_URL}/api/albums/${PRIVATE_ALBUM}`);
  expect(res.status).toBe(401);
});

test('API: expired/invalid share token is rejected', async () => {
  const res = await fetch(`${BASE_URL}/api/albums/${PRIVATE_ALBUM}?share=deadbeefdeadbeef`);
  expect(res.status).toBe(401);
});
