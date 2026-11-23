import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const adminPort = Number(process.env.ICON_TOAST_ADMIN_PORT ?? 5290);
const shopPort = Number(process.env.ICON_TOAST_SHOP_PORT ?? 5291);
const origin = (port: number) => `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: '.',
  testMatch: 'toasts.spec.mts',
  outputDir: '../../.tmp/icons/toasts',
  reporter: 'list',
  use: { serviceWorkers: 'block', trace: 'retain-on-failure' },
  projects: [
    { name: 'admin', use: { baseURL: origin(adminPort) } },
    { name: 'storefront', use: { baseURL: origin(shopPort) } },
  ],
  webServer: (
    [
      ['web', adminPort],
      ['web-shop', shopPort],
    ] as const
  ).map(([app, port]) => ({
    cwd: repo,
    command: `node tools/icons/serve-toast-fixture.mjs ${app} ${port}`,
    url: origin(port),
    reuseExistingServer: false,
    stdout: 'pipe',
  })),
});
