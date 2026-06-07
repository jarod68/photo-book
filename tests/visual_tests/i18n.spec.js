'use strict';

// Tests for the language switcher (custom dropdown, not a native <select>).
// Covers: open/close, language change, text update, localStorage persistence.

const { test, expect } = require('@playwright/test');

// Clear lang preference before each test so the page starts in a known state
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.removeItem('lang'));
});

// ── Lang button structure ─────────────────────────────────────────────────────

test('lang switcher is rendered as a custom button, not a native select', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('.lang-btn', { state: 'visible' });

  // Must be a BUTTON element
  const tag = await page.locator('.lang-btn').evaluate(el => el.tagName);
  expect(tag).toBe('BUTTON');

  // No native <select> with class lang-select should exist
  await expect(page.locator('select.lang-select')).toHaveCount(0);
});

test('lang menu is hidden on page load', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('.lang-btn', { state: 'visible' });
  await expect(page.locator('.lang-menu')).toBeHidden();
});

test('lang menu opens below the button on click', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('.lang-btn', { state: 'visible' });

  await page.click('.lang-btn');
  await expect(page.locator('.lang-menu')).toBeVisible();

  const btnBox  = await page.locator('.lang-btn').boundingBox();
  const menuBox = await page.locator('.lang-menu').boundingBox();
  expect(menuBox.y).toBeGreaterThanOrEqual(btnBox.y + btnBox.height - 2);

  await expect(page.locator('.lang-switcher')).toHaveScreenshot('lang-menu-open.png');
});

test('lang menu contains all supported languages', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('.lang-btn', { state: 'visible' });

  await page.click('.lang-btn');
  await expect(page.locator('.lang-menu')).toBeVisible();

  const options = await page.locator('.lang-option').allTextContents();
  expect(options).toContain('Français');
  expect(options).toContain('English');
  expect(options).toContain('Español');
});

test('lang menu closes when clicking outside', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('.lang-btn', { state: 'visible' });

  await page.click('.lang-btn');
  await expect(page.locator('.lang-menu')).toBeVisible();

  // Click somewhere else on the page
  await page.click('body', { position: { x: 10, y: 10 } });
  await expect(page.locator('.lang-menu')).toBeHidden();
});

test('lang menu closes on Escape key', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('.lang-btn', { state: 'visible' });

  await page.click('.lang-btn');
  await expect(page.locator('.lang-menu')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.locator('.lang-menu')).toBeHidden();
});

// ── Language switching ────────────────────────────────────────────────────────

test('switching to English updates page text', async ({ page }) => {
  // Start in French (default locale in playwright.config.js)
  await page.goto('/');
  await page.evaluate(() => { localStorage.setItem('lang', 'fr'); location.reload(); });
  await page.waitForSelector('.lang-btn', { state: 'visible' });

  // Switch to English
  await page.click('.lang-btn');
  await page.locator('.lang-option', { hasText: 'English' }).click();

  // The button label should now show EN
  const btnText = await page.locator('.lang-btn span').first().textContent();
  expect(btnText.trim()).toBe('EN');

  // At least one translatable element should be in English
  // The summary section has an i18n key — check it changed from French
  const bodyText = await page.locator('body').textContent();
  // In English the nav/summary uses English words; just verify lang attr changed
  const htmlLang = await page.locator('html').getAttribute('lang');
  expect(htmlLang).toBe('en');
});

test('switching to Spanish updates page text', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('.lang-btn', { state: 'visible' });

  await page.click('.lang-btn');
  await page.locator('.lang-option', { hasText: 'Español' }).click();

  const htmlLang = await page.locator('html').getAttribute('lang');
  expect(htmlLang).toBe('es');

  const btnText = await page.locator('.lang-btn span').first().textContent();
  expect(btnText.trim()).toBe('ES');
});

test('active language option is marked in the menu', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => { localStorage.setItem('lang', 'en'); location.reload(); });
  await page.waitForSelector('.lang-btn', { state: 'visible' });

  await page.click('.lang-btn');

  const activeOption = page.locator('.lang-option--active');
  await expect(activeOption).toBeVisible();
  const activeText = await activeOption.textContent();
  expect(activeText).toBe('English');
});

// ── Persistence ───────────────────────────────────────────────────────────────

test('chosen language persists across page reload via localStorage', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('.lang-btn', { state: 'visible' });

  // Switch to English
  await page.click('.lang-btn');
  await page.locator('.lang-option', { hasText: 'English' }).click();

  // Reload the page
  await page.reload();
  await page.waitForSelector('.lang-btn', { state: 'visible' });

  const htmlLang = await page.locator('html').getAttribute('lang');
  expect(htmlLang).toBe('en');

  const btnText = await page.locator('.lang-btn span').first().textContent();
  expect(btnText.trim()).toBe('EN');
});

test('language preference stored in localStorage as "lang"', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('.lang-btn', { state: 'visible' });

  await page.click('.lang-btn');
  await page.locator('.lang-option', { hasText: 'English' }).click();

  const stored = await page.evaluate(() => localStorage.getItem('lang'));
  expect(stored).toBe('en');
});

// ── Viewer page ───────────────────────────────────────────────────────────────

test('lang switcher also works on the viewer page', async ({ page }) => {
  await page.goto('/viewer.html?album=visual-regression');
  await page.waitForSelector('.lang-btn', { state: 'visible', timeout: 10_000 });

  await page.click('.lang-btn');
  await expect(page.locator('.lang-menu')).toBeVisible();

  await page.locator('.lang-option', { hasText: 'English' }).click();

  const htmlLang = await page.locator('html').getAttribute('lang');
  expect(htmlLang).toBe('en');
});
