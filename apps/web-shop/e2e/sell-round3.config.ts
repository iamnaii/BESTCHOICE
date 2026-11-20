import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
const appRoot = fileURLToPath(new URL('..', import.meta.url));
const port = Number(process.env.SELL_E2E_PORT ?? 5186);
export default defineConfig({
  testDir: '.',
  testMatch: 'sell-round3.spec.ts',
  workers: 2,
  retries: 0,
  timeout: 45000,
  reporter: 'list',
  outputDir: '../../../.tmp/sell-round3/playwright',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `npx vite --host 127.0.0.1 --port ${port} --strictPort`,
    cwd: appRoot,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
  },
});
