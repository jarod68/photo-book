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
