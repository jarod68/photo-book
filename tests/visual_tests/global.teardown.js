'use strict';

const { chromium } = require('@playwright/test');
const fs   = require('fs');
const path = require('path');

const BASE_URL    = process.env.BASE_URL ?? 'http://localhost:3000';
const AUTH_FILE   = path.join(__dirname, '.auth/admin.json');

async function globalTeardown() {
  if (!fs.existsSync(AUTH_FILE)) return;

  const browser = await chromium.launch();
  const context = await browser.newContext({ storageState: AUTH_FILE });

  await context.request
    .delete(`${BASE_URL}/api/admin/albums/visual-regression`)
    .catch(() => {});

  await browser.close();
}

module.exports = globalTeardown;
