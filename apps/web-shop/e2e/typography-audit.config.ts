import { defineConfig } from '@playwright/test';

// Typography audit only (TYPOGRAPHY_AUDIT=1). Its own config because ../playwright.config.ts starts
// a vite DEV server on :5176 for every run — the audit must measure the BUILT + prerendered dist/
// instead, served by fixtures/static-server.mjs (firebase.json "shop" hosting rules) on :5281.
// reuseExistingServer:false — a server already on :5281 might serve another checkout's dist
// (e.g. a BEFORE worktree), so the run fails instead of measuring the wrong build.
//
//   cd apps/web-shop && TYPOGRAPHY_AUDIT=1 TYPOGRAPHY_OUT=<dir> npx playwright test -c e2e/typography-audit.config.ts
const enabled = process.env.TYPOGRAPHY_AUDIT === '1';

export default defineConfig({
  testDir: '.',
  testMatch: /typography-audit\.spec\.ts$/,
  // one worker: the static server and unmatched.json are shared, and order keeps runs comparable
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 90_000,
  reporter: 'list',
  use: { headless: true },
  webServer: enabled
    ? {
        command: 'node fixtures/static-server.mjs --port 5281',
        url: 'http://127.0.0.1:5281/spa-shell.html',
        reuseExistingServer: false,
        timeout: 30_000,
      }
    : undefined,
});
