'use strict';

// Globe page (2026-10 redesign): space view (Three.js, WebGL in SwiftShader)
// and the switch to the satellite / street map (MapLibre, tiles from EOX and
// OpenFreeMap — CI has network access). The album "visual-features" holds three
// geotagged photos in Montréal (global.setup.js).
const { test, expect } = require('@playwright/test');

test.use({ launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] } });
test.setTimeout(90_000);

// fixed sun (June solstice, noon UTC) and no rotation: a reproducible picture
const URL = '/globe.html?still&at=2026-06-21T12:00:00Z';
const view = (page) => page.evaluate(() => document.getElementById('globe-space').globeView);

async function openGlobe(page) {
  await page.goto(URL);
  await page.waitForFunction(() => document.getElementById('globe-space').globeView?.sharp, null, { timeout: 45_000 });
  await page.waitForTimeout(500);
}

test('globe: the Earth from space with photo markers', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openGlobe(page);
  const markers = await page.evaluate(() => document.getElementById('globe-space').globeView.markerPositions());
  expect(markers.reduce((n, m) => n + m.count, 0)).toBeGreaterThanOrEqual(3);
  // software WebGL is slow: allow time for two identical captures in a row
  await expect(page.locator('#globe-space')).toHaveScreenshot('globe-space.png', { maxDiffPixelRatio: 0.02, timeout: 30_000 });
  expect(errors).toEqual([]);
});

test('globe: a group goes down to the map, the globe button comes back up', async ({ page }) => {
  await openGlobe(page);
  const box = await page.locator('#globe-space').boundingBox();
  const group = (await page.evaluate(() => document.getElementById('globe-space').globeView.markerPositions()))
    .find((m) => m.count >= 3);
  expect(group).toBeTruthy();
  await page.mouse.click(box.x + group.x, box.y + group.y);
  await expect(page.locator('body')).toHaveClass(/globe-is-near/, { timeout: 30_000 });
  // the three photos, as single markers or groups (two are ~1 km apart)
  await expect.poll(() => page.$$eval('.near-marker', (ms) => ms.reduce((n, m) => n + (Number(m.textContent) || 1), 0)),
    { timeout: 20_000 }).toBe(3);
  await page.locator('.near-marker:not(:has(.near-marker-count))').first().click();
  await expect(page.locator('.near-popup')).toContainText('visual-features');
  await page.click('#globe-up');
  await expect(page.locator('body')).not.toHaveClass(/globe-is-near/, { timeout: 20_000 });
});

test('globe: time zones overlay, local time on hover', async ({ page }) => {
  await page.goto(`${URL}&tz`);
  await page.waitForFunction(() => document.getElementById('globe-space').globeView?.sharp, null, { timeout: 45_000 });
  await expect(page.locator('#globe-tz-btn')).toHaveAttribute('aria-pressed', 'true');
  const paris = await page.evaluate(() => document.getElementById('globe-space').globeView.screenPoint(46.5, 2.5));
  await page.mouse.move(paris.x, paris.y, { steps: 3 });
  // 21 June 2026, 12:00 UTC: summer time in Paris
  await expect(page.locator('#globe-tz-tip')).toContainText('14:00');
  await expect(page.locator('#globe-tz-tip')).toContainText('UTC+2');
  await expect(page.locator('#globe-space')).toHaveScreenshot('globe-timezones.png', { maxDiffPixelRatio: 0.02, timeout: 30_000 });
  // off again, and remembered
  await page.click('#globe-tz-btn');
  await expect(page.locator('#globe-tz-tip')).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('pb.globeTimezones'))).toBe('0');
});
