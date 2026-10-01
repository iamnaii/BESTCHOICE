import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { previewStatus, output } from './local-preview.mjs';
const status = await previewStatus();
assert.ok(status.running && status.current, 'Run npm run local:preview in this checkout first');
const origin = `http://localhost:${status.state.port}`;
const artifacts = join(output, 'finance-cards');
mkdirSync(artifacts, { recursive: true });
// Browser-only synthetic API responses: no financial writes or production calls.
async function mockReceivables(page) {
  const data = ['PENDING', 'PARTIALLY_RECEIVED', 'RECEIVED', 'OVERDUE', 'DISPUTED'].map(
    (status, i) => ({
      id: `test-${i}`,
      status,
      financeCompany: 'LOCAL TEST FINANCE',
      financeRefNumber: 'TEST-001',
      expectedAmount: '15000',
      commissionRate: '0.05',
      commissionAmount: '750',
      netExpectedAmount: '14250',
      receivedAmount: '1234567.89',
      receivedDate: null,
      bankRef: null,
      expectedDate: '2026-10-10',
      note: null,
      createdAt: '2026-09-30',
      externalFinanceCompanyId: null,
      lastContactedAt: null,
      lastPromisedDate: null,
      contactAttemptCount: 0,
      sale: {
        id: `sale-${i}`,
        saleNumber: 'TEST-SALE',
        sellingPrice: '15000',
        netAmount: '15000',
        financeAmount: '15000',
        downPaymentAmount: '0',
        createdAt: '2026-09-30',
        customer: { id: 'test-customer', name: 'ลูกค้าทดสอบการจัดวาง', phone: '0000000000' },
        product: { id: 'test-product', name: 'iPhone 15 Pro Max', brand: 'Apple' },
        salesperson: { id: 'test-user', name: 'ผู้ทดสอบ' },
      },
      branch: { id: 'test-branch', name: 'สาขาทดสอบ' },
      recordedBy: null,
    }),
  );
  await page.route(/\/finance-receivable(?:\/(?:companies|summary))?(?:\?|$)/, async (route) => {
    if (route.request().resourceType() === 'document') return route.continue();
    const path = new URL(route.request().url()).pathname;
    const json = path.endsWith('/companies')
      ? ['LOCAL TEST FINANCE']
      : path.endsWith('/summary')
        ? {
            totalPending: 2,
            totalReceived: 1,
            totalOverdue: 1,
            totalDisputed: 1,
            pendingAmount: '1234567.89',
            receivedAmount: '1234567.89',
            overdueAmount: '1234567.89',
            disputedAmount: '1234567.89',
          }
        : { data, total: data.length };
    await route.fulfill({ json });
  });
}

const n = 1234567.89;
const mocks = {
  '/payments/pending-summary': {
    pendingCount: 1234,
    outstandingPrincipal: n,
    outstandingLateFee: n,
    waivedLateFee: n,
    overdue60Count: 1234,
    collectedAmount: n,
    collectedCount: 1234,
  },
  '/payments/daily-summary': {
    date: '2026-10-01',
    totalPayments: 1234,
    totalAmount: n,
    totalLateFees: n,
    byMethod: { CASH: n, TRANSFER: n },
    data: [],
  },
  '/payments/daily-summary/dates': { days: [] },
  '/imported-sales/summary': {
    totals: { count: 1234, sales: String(n), profit: String(n), cost: String(n) },
    byMonth: [],
    byChannel: [],
    bySalesperson: [],
    byCategory: [],
  },
  '/imported-sales': { data: [], total: 0, page: 1, limit: 50 },
  '/repossessions/profit-loss': {
    summary: {
      count: 1234,
      totalAppraisal: n,
      totalRepairCost: n,
      totalResellPrice: n,
      totalProfit: -n,
    },
    details: [],
  },
  '/repossessions': { data: [], total: 0, page: 1, limit: 50 },
  '/commissions': [],
  '/commissions/payouts': { data: [], total: 0 },
  '/interco-settlement/pending': {
    pending: [],
    recalls: [],
    deviceReturns: [],
    reconcile: {
      pendingTotal: String(n),
      glFinanceTotal: String(n),
      glShopTotal: String(n),
      drift: '0',
    },
  },
  '/interco-settlement/shop-receivable-aging': {
    rows: [],
    asOf: '2026-10-01',
    totals: {
      intercoNet: String(n),
      shopCollect: String(n),
      overdueCount: 1234,
      legacyOneBookNet: String(n),
    },
  },
  '/accounting/year-end-closing/preview': {
    year: 2026,
    revenues: [],
    expenses: [],
    revenueTotal: String(n),
    expenseTotal: String(n),
    netIncome: String(n),
    isProfit: true,
    totalSteps: 4,
    step4Amount: String(n),
    step4IsProfit: true,
    alreadyClosed: false,
    closedAt: null,
    closingBatchId: null,
    openMonths: [],
  },
  '/dashboard/collection-metrics': {
    agingBuckets: [
      { label: '1–30', min: 1, max: 30, count: 1234, amount: n },
      { label: '31–60', min: 31, max: 60, count: 1234, amount: n },
    ],
    collectionRate: { current: 75, lastMonth: 70, mom: 5 },
    collected: { thisMonth: n, count: 1234 },
    topDelinquent: [],
    channelEffectiveness: [],
  },
};
const routes = [
  '/finance-portfolio',
  '/finance-receivable',
  '/payments',
  '/expenses',
  '/repossessions',
  '/commissions',
  '/imported-sales',
  '/accounting/intercompany',
  '/finance/year-end-closing',
  '/collection-dashboard',
];
const browser = await chromium.launch();
async function check(page, label) {
  const grids = page.locator('.finance-card-grid:visible');
  await expect(grids.first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const audit = await grids.evaluateAll((grids) =>
    grids.flatMap((g) =>
      [...g.querySelectorAll('*')]
        .filter((e) => {
          const s = getComputedStyle(e);
          return (
            e.checkVisibility() &&
            parseFloat(s.fontSize) >= 18 &&
            parseInt(s.fontWeight) >= 600 &&
            /\d/.test(e.textContent) &&
            e.children.length === 0
          );
        })
        .map((e) => {
          const r = document.createRange();
          r.selectNodeContents(e);
          const text = r.getBoundingClientRect(),
            box = e.getBoundingClientRect();
          return {
            text: e.textContent,
            height: text.height,
            line: parseFloat(getComputedStyle(e).lineHeight),
            width: text.width,
            available: box.width,
          };
        }),
    ),
  );
  assert.ok(audit.length > 0, 'Numbers rendered ' + label);
  for (const a of audit) {
    assert.ok(a.height <= a.line + 1, `One numeric line ${label}: ${JSON.stringify(a)}`);
    assert.ok(
      a.width <= a.available + 1,
      `Complete ordinary amount ${label}: ${JSON.stringify(a)}`,
    );
  }
  if (!(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))) {
    await page.screenshot({ path: join(artifacts, 'overflow.png') });
    console.log(
      'OVERFLOW',
      label,
      await page.locator('#main *').evaluateAll((es) =>
        es
          .filter((e) => e.checkVisibility() && e.getBoundingClientRect().right > innerWidth + 1)
          .slice(0, 15)
          .map((e) => ({
            tag: e.tagName,
            cls: e.className,
            text: e.textContent.slice(0, 80),
            width: e.getBoundingClientRect().width,
          })),
      ),
    );
  }
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    'No page overflow ' + label,
  );
  console.log('PASS', label, `${audit.length} values fit`);
}
try {
  for (const width of [390, 768, 1056, 1440]) {
    const page = await browser.newPage({
      viewport: { width, height: 1000 },
      reducedMotion: 'reduce',
    });
    await page.routeWebSocket('**/socket.io/**', (s) => s.close());
    await mockReceivables(page);
    await page.route('**/api/admin/**', async (r) => {
      const key = new URL(r.request().url()).pathname.replace('/api/admin', '');
      if (key in mocks) return r.fulfill({ json: mocks[key] });
      return r.fallback();
    });
    for (const route of routes) {
      await page.goto(origin + route + '?zone=fin');
      await expect(page.locator('.app-shell')).toBeVisible();
      if (width >= 1024) {
        const expand = page.getByRole('button', { name: 'ขยายเมนู', exact: true });
        if (await expand.count()) await expand.click();
        await expect(page.locator('.wrapper')).toHaveCSS('padding-left', '264px');
      }
      if (route === '/finance/year-end-closing')
        await page.getByRole('button', { name: 'ดูตัวอย่างการปิดบัญชี', exact: true }).click();
      await check(page, `${route} ${width}`);
      await page.screenshot({
        path: join(artifacts, `${route.replaceAll('/', '_')}-${width}.png`),
        animations: 'disabled',
      });
      if (route === '/payments') {
        for (const trigger of await page.getByRole('button', { name: /^การลงบัญชี:/ }).all()) {
          await trigger.focus();
          await page.keyboard.press('Enter');
          await expect(page.getByRole('dialog')).toBeVisible();
          await page.keyboard.press('Escape');
          await expect(trigger).toBeFocused();
        }
        await page.getByRole('button', { name: 'สรุปรายวัน', exact: true }).click();
        await check(page, `daily summary ${width}`);
      }
      if (route === '/commissions') {
        await page.getByRole('button', { name: 'ใบจ่ายรายเดือน', exact: true }).click();
        await check(page, `commission payouts ${width}`);
      }
      if (route === '/accounting/intercompany') {
        await page.getByRole('tab', { name: 'อายุลูกหนี้หน้าร้าน', exact: true }).click();
        await check(page, `interco aging ${width}`);
      }
      if (route === '/finance/year-end-closing') {
        const trigger = page.getByRole('button', { name: 'วิธีคำนวณ: ยอดปิดกำไรสะสม' });
        await trigger.click();
        await expect(page.getByRole('dialog', { name: 'ยอดปิดกำไรสะสม' })).toBeVisible();
        await page.keyboard.press('Escape');
      }
    }
    await page.close();
  }
} finally {
  await browser.close();
}
