import { defineConfig } from '@playwright/test';
import { previewStatus } from '../../../tools/local-preview.mjs';

const preview = await previewStatus();
if (!preview.running || !preview.info.isolated) {
  throw new Error('Run npm run local:preview from this checkout before the admin icon suite.');
}

export default defineConfig({
  testDir: '.',
  testMatch: 'icons.spec.ts',
  outputDir: '../../../.tmp/icons/admin',
  workers: 2,
  retries: 0,
  timeout: 45_000,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${preview.state.port}`,
    serviceWorkers: 'block',
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
