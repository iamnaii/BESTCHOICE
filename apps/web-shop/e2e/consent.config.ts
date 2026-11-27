import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'consent.spec.ts',
  outputDir: '../../../.tmp/consent/shop',
  workers: 1,
  retries: 0,
  use: { baseURL: 'http://127.0.0.1:5495', trace: 'retain-on-failure' },
  webServer: {
    command: 'npx vite --host 127.0.0.1 --port 5495 --strictPort',
    url: 'http://127.0.0.1:5495',
    reuseExistingServer: false,
    env: { VITE_GA4_ID: 'G-E2ETEST', VITE_FB_PIXEL_ID: '000000000000000' },
  },
});
