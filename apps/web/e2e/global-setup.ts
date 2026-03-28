import { chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTH_FILE = path.join(__dirname, '../.playwright-auth.json');

export default async function globalSetup() {
  const apiURL = process.env.API_DIRECT_URL || 'http://localhost:3000';

  const browser = await chromium.launch();
  const page = await browser.newPage();

  const response = await page.request.post(`${apiURL}/api/auth/login`, {
    data: {
      email: 'admin@bestchoice.com',
      password: 'admin1234',
    },
    headers: { 'X-Requested-With': 'XMLHttpRequest' },
  });

  if (!response.ok()) {
    await browser.close();
    throw new Error(`Global setup login failed: HTTP ${response.status()}`);
  }

  const data = await response.json();
  if (!data.accessToken) {
    await browser.close();
    throw new Error('Global setup: accessToken missing from login response');
  }

  fs.writeFileSync(
    AUTH_FILE,
    JSON.stringify({ accessToken: data.accessToken, timestamp: Date.now() }),
  );

  await browser.close();
}
