import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { acquireLock, ensurePreview, fingerprint, git, output, repo, run } from './local-preview.mjs';
import { checkLocalPages } from './check-local-pages.mjs';
import { checkWorkCompany } from './check-local-work-company.mjs';

const release = acquireLock('check');
const report = { status: 'RUNNING', scope: 'Basic checks + synthetic Inbox, customers, dashboard, FINANCE portfolio and work-company navigation; not a full backend/financial regression',
  repo, revision: git('rev-parse', '--short', 'HEAD'), sourceFingerprint: fingerprint(), startedAt: new Date().toISOString(), checks: [] };
mkdirSync(output, { recursive: true });
const save = () => writeFileSync(join(output, 'check.json'), JSON.stringify(report, null, 2) + '\n');
const checkLog = join(output, 'checks.log');
writeFileSync(checkLog, '');
save();

try {
  const steps = [
    ['Local tooling', process.execPath, ['--test', 'tools/local-preview.test.mjs', 'tools/preview-chat-credit.test.mjs']],
    ['Prisma SHOP', join(repo, 'node_modules/.bin/prisma'), ['generate', '--schema', 'apps/api/prisma/schema.prisma']],
    ['Prisma FINANCE', join(repo, 'node_modules/.bin/prisma'), ['generate', '--schema', 'apps/api/prisma-finance/schema.prisma']],
    ['API + Web types', 'bash', ['tools/check-types.sh', 'all']],
    ['API lint (no autofix)', 'npm', ['exec', '--workspace=apps/api', '--', 'eslint', 'src', '--ext', '.ts']],
    ['Web lint', 'npm', ['run', 'lint', '--workspace=apps/web']],
    ['Web tests', 'npm', ['run', 'test', '--workspace=apps/web']],
    ['Shared tests', 'npm', ['run', 'test', '--workspace=@installment/shared']],
    ['Web build', 'npm', ['run', 'build', '--workspace=apps/web']],
  ];
  for (const [label, command, args] of steps) {
    console.log(`\nLocal check: ${label}`);
    report.currentCheck = label;
    save();
    await run(command, args, repo, checkLog);
    report.checks.push({ label, status: 'PASS' });
  }
  assert.equal(fingerprint(), report.sourceFingerprint, 'Source changed during checks; run local:check again.');
  report.currentCheck = 'Preview + browser smoke';
  save();
  const info = await ensurePreview({ prepared: true });
  report.url = info.url;
  const browser = await chromium.launch({ headless: true });
  try {
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      const context = await browser.newContext({ viewport });
      await context.routeWebSocket('**/socket.io/**', socket => socket.close());
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      // React ErrorBoundary catches rendering errors, so pageerror alone misses them.
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      await page.goto(info.url, { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('button', { name: /^รอตอบ/ })).toBeVisible();
      await expect(page.getByRole('combobox', { name: 'กรองตามช่องทาง' })).toBeVisible();
      await expect(page.getByText('เกิดข้อผิดพลาด', { exact: true })).toHaveCount(0);
      const width = await page.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.scrollWidth }));
      assert.ok(width.content <= width.viewport + 1, 'Horizontal overflow');
      assert.deepEqual(errors, [], 'Browser errors');
      await page.screenshot({ path: join(output, `inbox-${viewport.width}.png`), fullPage: true });
      report.checks.push({ label: `Inbox ${viewport.width}px`, status: 'PASS' });
      await checkLocalPages(page, info.url, output, viewport.width);
      assert.deepEqual(errors, [], 'Browser errors');
      report.checks.push({ label: `Customers + FINANCE portfolio (filters, pagination, empty report) ${viewport.width}px`, status: 'PASS' });
      await checkWorkCompany(page, info.url, output, viewport.width);
      assert.deepEqual(errors, [], 'Browser errors');
      report.checks.push({ label: `SHOP/FINANCE navigation (requests, reload, back/forward) ${viewport.width}px`, status: 'PASS' });
      await context.close();
    }
  } finally { await browser.close(); }
  assert.equal(fingerprint(), report.sourceFingerprint, 'Source changed during browser verification; run local:check again.');
  report.status = 'PASS';
  delete report.currentCheck;
  console.log(`\nLocal checks passed: ${info.url}\nWorkspace: ${repo}\nPreview remains running. Data/AI are synthetic; exercise the changed feature separately.`);
} catch (error) {
  report.status = 'FAIL';
  report.error = error.message;
  console.error(`\nLocal check failed: ${error.message}\nDetails: ${checkLog}`);
  process.exitCode = 1;
} finally { report.finishedAt = new Date().toISOString(); save(); release(); }
