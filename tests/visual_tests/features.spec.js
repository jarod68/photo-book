'use strict';

// Screens added in the 2026-10 audit (F2–F8). The album "visual-features" is
// prepared by global.setup.js: three dated GPS photos and one without date, an
// edited title / caption / place, a chosen cover and an album description.
const fs   = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const ALBUM = 'visual-features';
const FIXTURES = path.join(__dirname, '../integration_tests/fixtures');

test('home: album card with description and date range (F3)', async ({ page }) => {
  await page.goto('/');
  const card = page.locator(`a.album-card[href*="album=${ALBUM}"]`);
  await expect(card.locator('.album-card-desc')).toHaveText('Trois jours à Montréal');
  await expect(card).toHaveScreenshot('home-album-card.png');
});

test('home: sort menu (F5)', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#album-sort')).toBeVisible();
  await expect(page.locator('#album-sort')).toHaveScreenshot('home-sort.png');
});

test('admin: photo editor with album details and cover (F2, F3)', async ({ page }) => {
  await page.goto('/admin.html');
  await page.click(`[data-photos="${ALBUM}"]`);
  await page.waitForSelector('.photo-edit-row img.photo-edit-thumb');
  await page.waitForFunction(() => [...document.querySelectorAll('.photo-edit-thumb')].every((i) => i.tagName !== 'IMG' || i.complete));
  await expect(page.locator('.photos-modal')).toHaveScreenshot('admin-photo-editor.png');
});

test('admin: upload report for a duplicate (F7)', async ({ page }) => {
  await page.goto('/admin.html');
  await page.click(`[data-upload="${ALBUM}"]`);
  await page.setInputFiles('#upload-file-input', path.join(FIXTURES, 'test-photo-2.png'));
  await page.click('#upload-start-btn');
  await page.waitForSelector('#upload-report:not([hidden])');
  await expect(page.locator('#upload-report')).toHaveScreenshot('admin-upload-report.png');
});

test('search: results with filters (F6)', async ({ page }) => {
  await page.goto(`/search.html?album=${ALBUM}`);
  await page.waitForSelector('.search-tile');
  await expect(page.locator('.search-tile')).toHaveCount(4);
  await expect(page).toHaveScreenshot('search-results.png');
});

test('search: edited caption and place are searchable (F2, F6)', async ({ page }) => {
  await page.goto('/search.html?q=montreal%20quai');
  await expect(page.locator('.search-tile-name')).toHaveText(['Vieux-Port']);
  await expect(page.locator('.search-tile')).toHaveScreenshot('search-one-result.png');
});

test('viewer: chronological order with day labels (F5)', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('pb.photoOrder', 'date'));
  await page.goto(`/viewer.html?album=${ALBUM}`);
  await page.waitForSelector('.thumb.active');
  await expect(page.locator('.thumb .thumb-day')).toHaveText(['24 mai', '25 mai']);
  await expect(page.locator('#thumbnails')).toHaveScreenshot('viewer-strip-by-date.png');
  await expect(page.locator('.album-nav-right')).toHaveScreenshot('viewer-nav-order-on.png');
});

test('viewer: edited title, caption and place (F2)', async ({ page }) => {
  await page.goto(`/viewer.html?album=${ALBUM}&photo=gps-b.tiff`);
  await expect(page.locator('#photo-name')).toHaveText('Vieux-Port');
  await expect(page.locator('#photo-desc')).toHaveText('Le matin, depuis le quai');
  await expect(page.locator('#photo-location')).toHaveText('Montréal, Canada');
  await expect(page.locator('#photo-info')).toHaveScreenshot('viewer-edited-info.png', {
    mask: [page.locator('#photo-views'), page.locator('#like-count')],
  });
});

test('viewer: slideshow hides the interface, a tap shows it with the pause button (F4)', async ({ page }) => {
  await page.goto(`/viewer.html?album=${ALBUM}`);
  await page.waitForSelector('.thumb.active');
  await page.click('#slideshow-btn');
  await expect(page.locator('#app')).toHaveClass(/slideshow/);
  await expect(page.locator('#app')).toHaveClass(/ui-hidden/);
  await page.mouse.click(640, 360);                    // tap the photo: interface back
  await expect(page.locator('#app')).not.toHaveClass(/ui-hidden/);
  await expect(page.locator('.album-nav-right')).toHaveScreenshot('viewer-nav-slideshow-on.png');
  await page.keyboard.press('Escape');
  await expect(page.locator('#app')).not.toHaveClass(/slideshow/);
});
