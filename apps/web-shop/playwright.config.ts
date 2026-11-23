import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testIgnore: 'icons.spec.ts',
  use: { baseURL: 'http://127.0.0.1:5176', headless: true },
  webServer: {
    command: 'npx vite --host 127.0.0.1 --port 5176 --strictPort',
    url: 'http://127.0.0.1:5176',
    reuseExistingServer: !process.env.CI,
  },
});
