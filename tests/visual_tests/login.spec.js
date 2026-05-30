'use strict';

const { test, expect } = require('@playwright/test');

// All login tests are anonymous — override the default admin storageState
test.use({ storageState: { cookies: [], origins: [] } });

test('login page renders correctly', async ({ page }) => {
  await page.goto('/login.html');
  await expect(page).toHaveScreenshot('login-default.png');
});

test('login page shows error on bad credentials', async ({ page }) => {
  await page.goto('/login.html');
  await page.fill('#username', 'wrong');
  await page.fill('#password', 'wrongpass');
  await page.click('button[type="submit"]');
  await page.waitForSelector('#login-error', { state: 'visible' });
  await expect(page).toHaveScreenshot('login-error.png');
});
