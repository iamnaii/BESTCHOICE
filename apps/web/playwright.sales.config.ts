import { defineConfig } from '@playwright/test';

const baseURL = process.env.SALES_PREVIEW_URL ?? 'http://localhost:5207';
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(baseURL).hostname)) {
  throw new Error('Sales UI fixtures require a loopback checkout preview');
}

// Local checkout UI only. All scenario reads/writes are intercepted; no application DB login.
export default defineConfig({
  testDir: './e2e', testMatch: 'sales-menu-regression.spec.ts',
  timeout: 60000, workers: 1, retries: 0,
  reporter: [['list']],
  use: { baseURL,
    viewport: { width: 1440, height: 1000 }, headless: true, actionTimeout: 10000, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
