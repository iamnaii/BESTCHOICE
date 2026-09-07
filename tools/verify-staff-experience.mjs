/**
 * Local-only browser check for the built SALES start screen.
 * Usage: node tools/verify-staff-experience.mjs [--baseline-only]
 * Build apps/web/dist first. Baseline defaults to /tmp/bestchoice-ai-native/baseline.
 * Optional environment variables:
 *   STAFF_EVIDENCE_DIR: screenshots/report directory (default /tmp/bestchoice-ai-native)
 *   STAFF_BASELINE_DIR: baseline build (default <evidence>/baseline)
 *   STAFF_FINAL_DIR: final build (default <repository>/apps/web/dist)
 *   STAFF_BASELINE_PORT / STAFF_FINAL_PORT: localhost ports (default 5197 / 5198)
 *   STAFF_BROWSER_EXECUTABLE_PATH: installed Chromium binary (default Playwright's browser)
 *   STAFF_BASELINE_REF / STAFF_FINAL_REF: build provenance recorded in the report
 * Baseline provenance also reads <evidence>/baseline-ref.txt when present.
 * Every API call is fulfilled here; all other external traffic and sockets are blocked.
 * Gzip totals describe the unique JS files actually requested before interaction,
 * compressed with Node's default gzip, rather than preview-server wire bytes.
 */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { chromium, expect } from '@playwright/test';
import { preview } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(process.env.STAFF_EVIDENCE_DIR || '/tmp/bestchoice-ai-native');
const baselineDir = path.resolve(process.env.STAFF_BASELINE_DIR || path.join(output, 'baseline'));
const finalDir = path.resolve(process.env.STAFF_FINAL_DIR || path.join(root, 'apps/web/dist'));
const baselineOnly = process.argv.includes('--baseline-only');
const baselinePort = Number(process.env.STAFF_BASELINE_PORT || 5197);
const finalPort = Number(process.env.STAFF_FINAL_PORT || 5198);
const profile = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'พนักงานตัวอย่าง', email: 'staff@example.invalid', role: 'SALES',
  branchId: '22222222-2222-4222-8222-222222222222',
  branch: { name: 'สาขาตัวอย่าง' }, preferences: {},
  accessibleCompanies: ['SHOP'], primaryCompany: 'SHOP',
};
const dueDate = `${new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date())}T12:00:00+07:00`;
const taskList = ['ติดตามลูกค้าเรื่องรับสินค้า', 'ตรวจรายการนัดหมายวันนี้'].map((title, index) => ({
  id: `33333333-3333-4333-8333-33333333333${index}`,
  title, status: index ? 'DOING' : 'TODO', priority: index ? 'MEDIUM' : 'HIGH',
  dueDate, assigneeId: profile.id, assignee: { id: profile.id, name: profile.name },
  createdById: profile.id, createdBy: { id: profile.id, name: profile.name },
  tags: [], checklist: [], attachments: [], createdAt: dueDate,
}));
const uiFlags = {
  language: 'th', thousandsSeparator: 'comma', decimalPlaces: 2, dateFormat: 'BE',
  sidebarCollapsedDefault: false, showKeyboardShortcuts: true, animationEnabled: false,
  darkModeDefault: 'light', cacheTtlDashboard: 60, inAppNotificationsEnabled: true,
  settingsAccessRole: 'OWNER', reversePermission: 'OWNER+FINANCE_MANAGER',
  postPermission: 'OWNER+FINANCE_MANAGER+ACCOUNTANT', viewerRoleEnabled: false,
};

function fixture(url) {
  const endpoint = url.pathname.replace(/^\/api(?:\/admin)?/, '');
  switch (endpoint) {
    case '/auth/me': return profile;
    case '/settings/ui-flags': return uiFlags;
    case '/settings/test-mode':
    case '/overdue/collections-flag': return { enabled: false };
    case '/staff-chat/unread-count': return { unread: 0 };
    case '/commissions': return { data: [], total: 0, page: 1, limit: 50 };
    case '/overdue/pipeline': return { stages: [], totalContracts: 0, totalAmount: 0 };
    case '/customers/upsell-candidates': return { candidates: [], total: 0 };
    case '/search/union': return { contracts: [], customers: [], imeis: [], letterTrackings: [] };
    case '/todos': {
      assert.equal(url.searchParams.get('assigneeId'), 'me', 'Task requests must keep the personal filter');
      const view = url.searchParams.get('view');
      assert.ok(['today', 'all', 'completed'].includes(view), `Unexpected task view ${view}`);
      const tasks = view === 'completed' ? [] : taskList;
      return { data: tasks, total: tasks.length, page: 1, limit: Number(url.searchParams.get('limit')),
        summary: { all: 2, today: 2, upcoming: 0, priority: 1, completed: 0 } };
    }
    default: throw new Error(`No local fixture for ${endpoint}`);
  }
}

async function requestedJavaScript(paths, directory) {
  const files = [];
  for (const pathname of [...paths].sort()) {
    const bytes = await readFile(path.join(directory, pathname));
    files.push({ path: pathname, bytes: bytes.length, gzipBytes: gzipSync(bytes).length });
  }
  return { files, count: files.length,
    bytes: files.reduce((sum, file) => sum + file.bytes, 0),
    gzipBytes: files.reduce((sum, file) => sum + file.gzipBytes, 0) };
}

async function noOverflow(page, label) {
  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  assert.ok(dimensions.document <= dimensions.viewport + 1 && dimensions.body <= dimensions.viewport + 1,
    `${label}: horizontal overflow ${JSON.stringify(dimensions)}`);
  return dimensions;
}

const servers = [];
let browser;
const report = {
  checkedAt: new Date().toISOString(),
  scope: 'Built frontend only; fake SALES identity and local API fixtures; no real login/backend',
  fontNote: 'External font stylesheets are fulfilled locally with empty CSS; screenshots use system font fallbacks consistently in both builds',
  gzipMethod: 'Sum of default Node gzip sizes of unique JS assets requested before interaction; not measured wire bytes',
  runs: [],
};

async function runScreen({ name, directory, origin, viewport, isFinal, interactions }) {
  const context = await browser.newContext({ viewport, locale: 'th-TH', timezoneId: 'Asia/Bangkok',
    colorScheme: 'light', serviceWorkers: 'block' });
  const result = { name, origin, viewport, pageErrors: [], consoleErrors: [], apiRequests: [],
    blockedExternal: [], fixtureErrors: [], checkErrors: [], checks: [] };
  report.runs.push(result);
  const scriptPaths = new Set();
  await context.routeWebSocket('**/*', (socket) => socket.close());
  await context.addInitScript(() => {
    localStorage.setItem('theme', 'light');
    localStorage.setItem('sidebar_collapse', 'false');
    localStorage.setItem('bc.sidebar.lastZone', 'shop');
  });
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const apiRequest = url.pathname.startsWith('/api/') || ['xhr', 'fetch'].includes(request.resourceType());
    if (apiRequest) {
      result.apiRequests.push({ method: request.method(), path: url.pathname, search: url.search });
      try {
        assert.equal(request.method(), 'GET', 'Browser verification must not perform a write');
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture(url)) });
      } catch (error) {
        result.fixtureErrors.push(error.message);
        await route.fulfill({ status: 501, contentType: 'application/json', body: JSON.stringify({ message: error.message }) });
      }
      return;
    }
    if (url.origin !== origin) {
      result.blockedExternal.push(request.url());
      // Supply an empty stylesheet so intentionally blocking Google Fonts does
      // not masquerade as an application console error. System Thai font is used.
      if (request.resourceType() === 'stylesheet') {
        await route.fulfill({ status: 200, contentType: 'text/css', body: '' });
      } else {
        await route.abort('blockedbyclient');
      }
      return;
    }
    if (url.pathname.endsWith('.js')) scriptPaths.add(url.pathname);
    await route.continue();
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => result.pageErrors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') result.consoleErrors.push(message.text()); });
  try {
    await page.goto(origin, { waitUntil: 'networkidle', timeout: 30000 });
    await expect(page.getByRole('heading', { name: isFinal ? 'เริ่มงานวันนี้' : 'แดชบอร์ด', exact: true })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await expect(page.getByText('คอมมิชชันเดือนนี้', { exact: true })).toBeVisible();
    result.initialJavaScript = await requestedJavaScript(scriptPaths, directory);
    result.dimensions = await noOverflow(page, `${name} home`);
    await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: true });
    result.checks.push('Home heading rendered without horizontal overflow');
    if (isFinal) {
      await expect(page.getByText(taskList[0].title, { exact: true })).toBeVisible();
      const cards = page.locator('section[aria-labelledby="start-work-title"] a');
      assert.deepEqual(await cards.evaluateAll((links) => links.map((link) => link.getAttribute('href'))),
        ['/pos', '/contracts/create', '/payments', '/inbox']);
      result.checks.push('Four SALES action links point to permitted destinations');
      result.sharedHeavyChunks = result.initialJavaScript.files.filter((file) => /charts-|excel-|pdf-/.test(file.path));
      assert.ok(!result.initialJavaScript.files.some((file) => /ManagementDashboard/.test(file.path)),
        'SALES home must not request the management dashboard');
      result.checks.push('Initial SALES request set excludes ManagementDashboard; shared chart/PDF chunks are separately reported');
      if (interactions) {
        await page.getByRole('button', { name: 'ค้นหาลูกค้าหรือสัญญา', exact: true }).click();
        await page.getByRole('combobox').fill('POS');
        await expect.poll(() => result.apiRequests.some((item) => item.path.endsWith('/search/union') && item.search.includes('q=POS'))).toBe(true);
        const options = await page.getByRole('option').allTextContents();
        if (options.length && options.every((text) => text.includes('ขายสินค้า'))) {
          result.checks.push('POS alias finds sales entries and excludes unrelated menu entries');
        } else {
          result.checkErrors.push(`POS alias should only show sale actions/pages, got ${JSON.stringify(options)}`);
        }
        await page.keyboard.press('Escape');
        // Escape support belongs to the shared palette; backdrop closes if it remains open.
        if (await page.getByRole('combobox').isVisible()) await page.mouse.click(5, 5);
        await page.getByRole('link', { name: 'ดูงานวันนี้ทั้งหมด' }).click();
        await expect(page.getByRole('heading', { name: 'งาน / สิ่งที่ต้องทำ', exact: true })).toBeVisible();
        await expect(page.getByText(taskList[0].title, { exact: true })).toBeVisible();
        assert.equal(new URL(page.url()).searchParams.get('view'), 'today');
        assert.equal(new URL(page.url()).searchParams.get('assigneeId'), 'me');
        await expect(page.locator('select').filter({ has: page.locator('option[value="me"]') })).toHaveValue('me');
        await page.getByRole('button', { name: /^ทั้งหมด/ }).click();
        await expect(page.getByRole('button', { name: /^ทั้งหมด/ })).toHaveClass(/bg-card/);
        assert.equal(new URL(page.url()).searchParams.get('view'), 'all');
        assert.equal(new URL(page.url()).searchParams.get('assigneeId'), 'me');
        assert.ok(!result.apiRequests.some((item) => /\/users\/?$/.test(item.path)), 'SALES must not request /users');
        result.checks.push('Personal todos link/filter persist today/me then all/me without admin user requests');
        result.todosDimensions = await noOverflow(page, `${name} todos`);
        await page.screenshot({ path: path.join(output, `${name}-todos.png`), fullPage: true });
      }
    }
    assert.deepEqual(result.fixtureErrors, [], 'All API calls must have explicit local fixtures');
    assert.deepEqual(result.pageErrors, [], 'Browser must have no JavaScript page errors');
    assert.deepEqual(result.consoleErrors, [], 'Browser must have no console errors');
    assert.deepEqual(result.checkErrors, [], 'Interaction checks must pass');
    result.status = 'PASS';
    console.log(`${name}: PASS; initial JS ${result.initialJavaScript.gzipBytes} gzip bytes (${result.initialJavaScript.count} files)`);
  } catch (error) {
    result.status = 'FAIL';
    result.error = error.message;
    await page.screenshot({ path: path.join(output, `${name}-failure.png`), fullPage: true }).catch(() => {});
    throw error;
  } finally {
    await context.close();
  }
}

try {
  await mkdir(output, { recursive: true });
  report.baselineRef = process.env.STAFF_BASELINE_REF
    || await readFile(path.join(output, 'baseline-ref.txt'), 'utf8').then((ref) => ref.trim()).catch(() => null);
  report.finalRef = process.env.STAFF_FINAL_REF || null;
  await access(path.join(baselineDir, 'index.html'));
  if (!baselineOnly) await access(path.join(finalDir, 'index.html'));
  for (const [directory, port] of [[baselineDir, baselinePort], ...(!baselineOnly ? [[finalDir, finalPort]] : [])]) {
    const server = await preview({ configFile: false, root: path.join(root, 'apps/web'),
      build: { outDir: directory }, preview: { host: '127.0.0.1', port, strictPort: true } });
    servers.push(server);
  }
  browser = await chromium.launch({ headless: true,
    ...(process.env.STAFF_BROWSER_EXECUTABLE_PATH ? { executablePath: process.env.STAFF_BROWSER_EXECUTABLE_PATH } : {}) });
  report.browserVersion = browser.version();
  await runScreen({ name: 'baseline-sales-desktop', directory: baselineDir,
    origin: `http://127.0.0.1:${baselinePort}`, viewport: { width: 1440, height: 1000 }, isFinal: false });
  if (!baselineOnly) {
    for (const [suffix, viewport] of [['desktop', { width: 1440, height: 1000 }], ['mobile', { width: 390, height: 844 }]]) {
      await runScreen({ name: `final-sales-${suffix}`, directory: finalDir,
        origin: `http://127.0.0.1:${finalPort}`, viewport, isFinal: true, interactions: true })
        .catch((error) => console.error(`final-sales-${suffix}: ${error.message}`));
    }
    const before = report.runs[0].initialJavaScript.gzipBytes;
    const after = report.runs[1].initialJavaScript.gzipBytes;
    report.comparison = { beforeGzipBytes: before, afterGzipBytes: after,
      reductionGzipBytes: before - after, reductionPercent: Number(((1 - after / before) * 100).toFixed(2)) };
    console.log(JSON.stringify(report.comparison));
    assert.ok(report.runs.every((run) => run.status === 'PASS'), 'One or more browser scenarios failed; see per-run details');
  }
  report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL';
  report.error = error.message;
  process.exitCode = 1;
  console.error(error.message);
} finally {
  await browser?.close();
  await Promise.all(servers.map((server) => new Promise((resolve) => server.httpServer.close(resolve))));
  await writeFile(path.join(output, baselineOnly ? 'browser-baseline.json' : 'browser-verification.json'), `${JSON.stringify(report, null, 2)}\n`);
}
