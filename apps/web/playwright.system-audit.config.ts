import { defineConfig, devices } from '@playwright/test';
import { resolve } from 'node:path';

if (!process.env.SYSTEM_E2E_OUTPUT || !process.env.DOCS_QA_OUTPUT || !process.env.API_DIRECT_URL || !process.env.BASE_URL) {
  throw new Error('Run through system-e2e.audit-spec.ts and tools/docs-integration.sh');
}

export default defineConfig({
  globalSetup: './e2e/global-setup.ts',
  testDir: './e2e',
  testIgnore: ['**/load-test-*.spec.ts'],
  fullyParallel: true,
  forbidOnly: true,
  retries: 0,
  workers: 2,
  timeout: 30_000,
  reporter: [['list'], ['json', { outputFile: resolve(process.env.SYSTEM_E2E_OUTPUT, 'playwright-results.json') }]],
  outputDir: resolve(process.env.SYSTEM_E2E_OUTPUT, 'playwright'),
  use: {
    baseURL: process.env.BASE_URL,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    navigationTimeout: 20_000,
    actionTimeout: 15_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
