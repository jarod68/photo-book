'use strict';

const { defineConfig, devices } = require('@playwright/test');

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';

module.exports = defineConfig({
  testDir:      'tests/visual_tests',
  snapshotDir:  'tests/visual_tests/snapshots',
  // Remove the {platform} suffix so the same baselines work in CI and locally
  // when running inside Docker. Accept minor differences via maxDiffPixels.
  snapshotPathTemplate: '{snapshotDir}/{testFilePath}/{arg}{ext}',

  globalSetup:    './tests/visual_tests/global.setup.js',
  globalTeardown: './tests/visual_tests/global.teardown.js',

  // Run serially — visual tests share album state and must not race
  fullyParallel: false,
  workers:       1,
  retries:       0,

  reporter: [['html', { outputFolder: 'tests/visual_tests/report', open: 'never' }]],

  use: {
    baseURL:      BASE_URL,
    locale:       'fr-FR',
    viewport:     { width: 1280, height: 800 },
    colorScheme:  'light',
    storageState: 'tests/visual_tests/.auth/admin.json',
  },

  expect: {
    toHaveScreenshot: {
      // Allow up to 100 pixels of difference to absorb minor font/antialiasing
      // variations across OS versions.
      maxDiffPixels: 100,
      animations:    'disabled',
      caret:         'hide',
    },
  },

  projects: [
    {
      name: 'chromium',
      use:  { ...devices['Desktop Chrome'] },
    },
  ],
});
