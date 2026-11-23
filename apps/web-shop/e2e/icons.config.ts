import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const appRoot = fileURLToPath(new URL('..', import.meta.url));
const port = Number(process.env.ICON_E2E_PORT ?? 5289);
const origin = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: '.',
  testMatch: 'icons.spec.ts',
  outputDir: '../../../.tmp/icons/storefront',
  workers: 2,
  timeout: 45_000,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: origin,
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: `node e2e/fixtures/static-server.mjs --port ${port}`,
    cwd: appRoot,
    url: `${origin}/spa-shell.html`,
    reuseExistingServer: false,
  },
});
