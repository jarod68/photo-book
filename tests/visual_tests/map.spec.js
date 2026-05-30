'use strict';

const { test, expect } = require('@playwright/test');

// Map page is public — test anonymously to keep the baseline minimal
test.use({ storageState: { cookies: [], origins: [] } });

test('map page controls and layout', async ({ page }) => {
  await page.goto('/map.html');
  await page.waitForSelector('#world-map', { state: 'visible' });
  await page.waitForSelector('#route-toggle', { state: 'visible' });

  await expect(page).toHaveScreenshot('map-page.png', {
    // Mask the Leaflet canvas — tile images vary by network/cache and are
    // not meaningful to diff pixel-by-pixel.
    mask: [page.locator('#world-map')],
  });
});

test('map photo count element is present', async ({ page }) => {
  await page.goto('/map.html');
  await page.waitForSelector('#map-page-count', { state: 'visible' });
  await expect(page.locator('#map-page-count')).toHaveScreenshot('map-counter.png');
});
