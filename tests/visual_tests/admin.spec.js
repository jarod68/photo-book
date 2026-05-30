'use strict';

const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
  await page.goto('/admin.html');
  await page.waitForSelector('#new-album-btn', { state: 'visible' });
});

test('admin albums table', async ({ page }) => {
  await expect(page.locator('#section-albums')).toHaveScreenshot('admin-albums.png', {
    mask: [
      // Photo counts and view stats are dynamic
      page.locator('#albums-body'),
    ],
  });
});

test('admin users section', async ({ page }) => {
  await page.waitForSelector('#users-body tr', { state: 'visible' });
  await expect(page.locator('#section-users')).toHaveScreenshot('admin-users.png', {
    mask: [
      // User list changes between runs
      page.locator('#users-body'),
    ],
  });
});

test('admin system section layout', async ({ page }) => {
  await page.waitForSelector('#section-system', { state: 'visible' });
  await expect(page.locator('#section-system')).toHaveScreenshot('admin-system.png', {
    mask: [
      // Uptime, node version, containers are all dynamic
      page.locator('#section-system'),
    ],
  });
});

test('admin full page', async ({ page }) => {
  await expect(page).toHaveScreenshot('admin-full.png', {
    mask: [
      page.locator('#albums-body'),
      page.locator('#users-body'),
      page.locator('#section-system'),
      page.locator('#logs-body'),
      page.locator('#photos-body'),
    ],
  });
});
