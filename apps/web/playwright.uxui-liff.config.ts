import { defineConfig, devices } from '@playwright/test';

// Explicitly target this worktree's managed preview. LIFF SDK/API are mocked
// by these specs; this is browser rendering evidence, not real LINE approval.
const baseURL = process.env.UXUI_PREVIEW_URL;
if (!baseURL || !/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(baseURL)) {
  throw new Error('Set UXUI_PREVIEW_URL to this worktree’s local preview URL');
}
export default defineConfig({
  testDir: './e2e',
  testMatch: ['liff-contract.spec.ts', 'liff-payment.spec.ts', 'liff-register.spec.ts', 'liff-early-payoff-ux.spec.ts'],
  workers: 1,
  retries: 0,
  timeout: 30000,
  reporter: [['list'], ['json', { outputFile: '../../.tmp/uxui-remediation/liff-browser-results.json' }]],
  outputDir: '../../.tmp/uxui-remediation/liff-browser',
  use: { baseURL, locale: 'th-TH', timezoneId: 'Asia/Bangkok', screenshot: 'only-on-failure', serviceWorkers: 'block' },
  projects: [
    { name: 'android-light', use: { ...devices['Pixel 7'], colorScheme: 'light' } },
    { name: 'android-dark', use: { ...devices['Pixel 7'], colorScheme: 'dark' } },
    { name: 'iphone-light', use: { ...devices['iPhone 13'], colorScheme: 'light' } },
    { name: 'iphone-dark', use: { ...devices['iPhone 13'], colorScheme: 'dark' } },
  ],
});
