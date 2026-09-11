/* eslint-disable @typescript-eslint/no-require-imports */
import { ChildProcess, spawn } from 'child_process';
import { createServer } from 'net';
import { createWriteStream, mkdirSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { DocumentsHarness } from './harness';
import { docsOutputDir } from './runtime';

/**
 * Browser layer for domain scenarios: the real admin web app (Vite dev server,
 * same source as `apps/web`) with `/api` proxied to the in-process API of the
 * current harness run, driven by Playwright Chromium. Users log in through the
 * real login form; every request carries the real JWT and `?company=` scope
 * exactly as in production.
 */
export interface WebRuntime {
  origin: string;
  browser: Browser;
  /** Fresh context + page at a viewport; console/page errors are collected. */
  page(viewport: { width: number; height: number }): Promise<{ context: BrowserContext; page: Page; errors: string[] }>;
  /** Real login through /login; resolves when the app left the login route. */
  login(page: Page, email: string, password: string): Promise<void>;
  /**
   * In-app navigation (history.pushState + popstate, what a sidebar link does).
   * The access token lives in memory only, so a full `page.goto` after login
   * means a reload + POST /auth/refresh — throttled per IP (10/min), which every
   * Playwright context in a run shares. Use this for every page after the first.
   */
  navigate(page: Page, path: string): Promise<void>;
  close(): Promise<void>;
}

const repoRoot = resolve(__dirname, '..', '..', '..', '..', '..');

async function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as { port: number };
      server.close(() => resolvePort(address.port));
    });
  });
}

export async function startWeb(harness: DocumentsHarness, options: { headless?: boolean } = {}): Promise<WebRuntime> {
  const { chromium } = require('@playwright/test') as typeof import('@playwright/test');
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const webDir = join(repoRoot, 'apps/web');
  const logDir = join(docsOutputDir(), 'web');
  mkdirSync(logDir, { recursive: true });
  const log = createWriteStream(join(logDir, `vite-${port}.log`), { flags: 'a' });
  const child: ChildProcess = spawn(process.execPath, [join(webDir, 'node_modules/vite/bin/vite.js'), '--config', 'vite.docs-qa.config.ts', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: webDir,
    env: { ...process.env, VITE_API_URL: '/api/admin', DOCS_QA_API_ORIGIN: harness.baseUrl.replace(/\/api$/, ''), VITE_SENTRY_DSN: '', BROWSER: 'none' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.pipe(log);
  child.stderr?.pipe(log);
  const deadline = Date.now() + 60_000;
  let ready = false;
  while (!ready) {
    if (child.exitCode !== null) throw new Error(`Vite exited early (${child.exitCode}); see ${join(logDir, `vite-${port}.log`)}`);
    try { ready = (await fetch(`${origin}/@vite/client`)).ok; } catch { ready = false; }
    if (!ready) {
      if (Date.now() > deadline) { child.kill('SIGTERM'); throw new Error('Vite dev server did not become ready within 60 s'); }
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  const browser = await chromium.launch({ headless: options.headless ?? true });
  return {
    origin,
    browser,
    async page(viewport) {
      const context = await browser.newContext({ viewport, acceptDownloads: true, locale: 'th-TH', timezoneId: 'Asia/Bangkok' });
      await context.routeWebSocket('**/socket.io/**', (socket) => socket.close());
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
      page.on('console', (message) => { if (message.type() === 'error') errors.push(`console: ${message.text()} (${message.location().url})`); });
      page.setDefaultTimeout(30_000);
      page.setDefaultNavigationTimeout(60_000);
      return { context, page, errors };
    },
    async login(page, email, password) {
      await page.goto(`${origin}/login`, { waitUntil: 'domcontentloaded' });
      await page.locator('#email').fill(email);
      await page.locator('#password').fill(password);
      await page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click();
      await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60_000 });
    },
    async navigate(page, path) {
      await page.evaluate((target) => {
        window.history.pushState({}, '', target);
        window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
      }, path);
      await page.waitForURL((url) => `${url.pathname}${url.search}` === path, { timeout: 15_000 });
    },
    async close() {
      await browser.close().catch(() => undefined);
      child.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 300));
      if (child.exitCode === null) child.kill('SIGKILL');
      log.end();
    },
  };
}

/** Bytes of a Playwright download, read from its temporary path. */
export async function downloadBytes(download: import('@playwright/test').Download): Promise<Buffer> {
  const path = await download.path();
  if (!path) throw new Error(`download ${download.suggestedFilename()} has no path (${await download.failure()})`);
  return readFileSync(path);
}
