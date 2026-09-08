import assert from 'node:assert/strict';
import { join } from 'node:path';
import { expect } from '@playwright/test';

export async function checkLocalPages(page, origin, output, width) {
  const responsePromise = page.waitForResponse(r => r.url().includes('/reports/finance-portfolio'));
  await page.goto(new URL('/finance-portfolio', origin).href, { waitUntil: 'domcontentloaded' });
  const response = await responsePromise;
  assert.equal(response.status(), 200);
  const portfolio = await response.json();
  assert.ok(Array.isArray(portfolio.data), 'Portfolio must return a report object, not a bare array');
  assert.equal(typeof portfolio.summary.totalOutstanding, 'number');
  assert.equal(typeof portfolio.aging.current.amount, 'number');
  await expect(page.getByRole('heading', { name: 'พอร์ตสัญญา BESTCHOICE FINANCE' })).toBeVisible();
  await expect(page.getByText('TEST-LOCAL-PORTFOLIO-ACTIVE', { exact: true })).toBeVisible();
  await expect(page.getByText('TEST-LOCAL-PORTFOLIO-OVERDUE', { exact: true })).toBeVisible();

  const filteredPromise = page.waitForResponse(r => r.url().includes('status=ACTIVE'));
  await page.getByRole('button', { name: 'ปกติ', exact: true }).click();
  const filtered = await (await filteredPromise).json();
  assert.ok(filtered.data.length > 0 && filtered.data.every(row => row.status === 'ACTIVE'));
  await expect(page.getByText('TEST-LOCAL-PORTFOLIO-ACTIVE', { exact: true })).toBeVisible();
  await expect(page.getByText('TEST-LOCAL-PORTFOLIO-OVERDUE', { exact: true })).toHaveCount(0);
  await expect(page.getByText('เกิดข้อผิดพลาด', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: join(output, `finance-portfolio-${width}.png`), fullPage: true });

  const getReport = async query => {
    const result = await page.request.get(new URL(`/api/admin/reports/finance-portfolio?${query}`, origin).href);
    assert.equal(result.status(), 200);
    return result.json();
  };
  const paginated = await getReport('limit=1');
  assert.equal(paginated.data.length, 1);
  assert.deepEqual(paginated.summary, portfolio.summary, 'Summary must cover all pages');
  const empty = await getReport('startDate=2000-01-01&endDate=2000-01-02');
  assert.deepEqual(empty.data, []);
  assert.equal(empty.total, 0);
  assert.equal(empty.summary.totalOutstanding, 0);
  assert.equal(empty.aging.current.count, 0);
  const unsupported = await page.request.get(new URL('/api/admin/unsupported-preview-route', origin).href);
  assert.equal(unsupported.status(), 501, 'Unknown endpoints must not return fake successful data');

  const customersPromise = page.waitForResponse(r => /\/customers\?/.test(r.url()));
  await page.goto(new URL('/customers', origin).href, { waitUntil: 'domcontentloaded' });
  const customers = await customersPromise;
  assert.equal(customers.status(), 200);
  assert.ok(Array.isArray((await customers.json()).data));
  await expect(page.getByText('ลูกค้าพอร์ตตัวอย่าง ACTIVE', { exact: true })).toBeVisible();
  await expect(page.getByText('เกิดข้อผิดพลาด', { exact: true })).toHaveCount(0);
}
