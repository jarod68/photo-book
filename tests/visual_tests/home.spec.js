'use strict';

const { test, expect } = require('@playwright/test');

test.describe('home page - anonymous', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('album grid and map/globe cards', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#album-grid a.album-card', { state: 'visible' });
    await expect(page).toHaveScreenshot('home-anonymous.png', {
      // Summary shows dynamic counts — mask it to avoid flaky baselines
      mask: [page.locator('#summary')],
    });
  });
});

test.describe('home page - admin', () => {
  test('admin sees username and admin link', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#album-grid a.album-card', { state: 'visible' });
    await page.waitForSelector('.home-auth-user', { state: 'visible' });
    await expect(page).toHaveScreenshot('home-admin.png', {
      mask: [
        page.locator('#summary'),
        // Mask the username text so baseline is not user-specific
        page.locator('.home-auth-user'),
      ],
    });
  });
});
