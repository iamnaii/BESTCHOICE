import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'ui-followup.spec.ts',
  outputDir: '../../../.tmp/ui-followup/shop',
  workers: 1,
  retries: 0,
  use: { baseURL: 'http://127.0.0.1:5494', trace: 'retain-on-failure' },
  webServer: {
    command: 'npx vite --host 127.0.0.1 --port 5494 --strictPort',
    url: 'http://127.0.0.1:5494',
    reuseExistingServer: false,
  },
});
