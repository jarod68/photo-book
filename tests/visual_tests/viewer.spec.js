'use strict';

const { test, expect } = require('@playwright/test');

const ALBUM = 'visual-regression';

test('viewer loads thumbnail strip and main photo', async ({ page }) => {
  await page.goto(`/viewer.html?album=${ALBUM}`);
  await page.waitForSelector('css=.thumb.active[data-i="0"]', { state: 'visible', timeout: 10_000 });

  await expect(page).toHaveScreenshot('viewer-loaded.png', {
    mask: [
      // Dynamic text that changes on every view
      page.locator('#photo-name'),
      page.locator('#photo-views'),
      page.locator('#like-count'),
      page.locator('#photo-location'),
    ],
  });
});

test('viewer thumbnail strip', async ({ page }) => {
  await page.goto(`/viewer.html?album=${ALBUM}`);
  await page.waitForSelector('css=#thumbnails .thumb >> nth=0', { state: 'visible', timeout: 10_000 });

  await expect(page.locator('#thumbnails')).toHaveScreenshot('viewer-thumbnails.png');
});

test('viewer actions panel expands on click', async ({ page }) => {
  await page.goto(`/viewer.html?album=${ALBUM}`);
  await page.waitForSelector('#photo-actions', { state: 'visible', timeout: 10_000 });

  await page.click('#photo-actions-toggle');
  await page.waitForSelector('#photo-actions-menu', { state: 'visible' });

  await expect(page.locator('#photo-actions')).toHaveScreenshot('viewer-actions-open.png');
});

test('lang switcher opens custom dropdown below button', async ({ page }) => {
  await page.goto(`/viewer.html?album=${ALBUM}`);
  await page.waitForSelector('.lang-btn', { state: 'visible', timeout: 10_000 });

  // The custom dropdown should be hidden initially
  await expect(page.locator('.lang-menu')).toBeHidden();

  // Click the lang button — menu should appear
  await page.click('.lang-btn');
  await expect(page.locator('.lang-menu')).toBeVisible();

  // Menu must be positioned below the button (top >= button bottom)
  const btnBox  = await page.locator('.lang-btn').boundingBox();
  const menuBox = await page.locator('.lang-menu').boundingBox();
  expect(menuBox.y).toBeGreaterThanOrEqual(btnBox.y + btnBox.height - 2);

  await expect(page.locator('.lang-switcher')).toHaveScreenshot('viewer-lang-menu-open.png');
});

test('album-map-btn is styled as a box control (not an underline tab)', async ({ page }) => {
  await page.goto(`/viewer.html?album=${ALBUM}`);
  await page.waitForSelector('.album-map-btn', { state: 'visible', timeout: 10_000 });

  const box = await page.locator('.album-map-btn').boundingBox();
  expect(box.height).toBeGreaterThanOrEqual(24);
  expect(box.height).toBeLessThanOrEqual(36);

  await expect(page.locator('.album-map-btn')).toHaveScreenshot('viewer-map-btn.png');
});

test('share button absent on public album', async ({ page }) => {
  // visual-regression album is public by default
  await page.goto(`/viewer.html?album=${ALBUM}`);
  await page.waitForSelector('#photo-actions', { state: 'visible', timeout: 10_000 });
  await page.click('#photo-actions-toggle');
  await page.waitForSelector('#photo-actions-menu', { state: 'visible' });

  await expect(page.locator('#share-open-btn')).toBeHidden();
});
