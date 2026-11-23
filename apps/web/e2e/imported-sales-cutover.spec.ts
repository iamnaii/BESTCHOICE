import { test, expect, type Page } from '@playwright/test';
import { join } from 'node:path';
import { tooltifyPreview } from './tooltify-preview';

const peek = tooltifyPreview();
const imei = '001234567890123';
async function search(page: Page, key: string, text: string) {
  const response = (suffix: string) =>
    page.waitForResponse((r) => {
      const url = new URL(r.url());
      return (
        url.origin === peek.baseURL &&
        url.pathname === '/api/admin/imported-sales' + suffix &&
        url.searchParams.get(key) === text &&
        url.searchParams.get('company') === 'shop' &&
        r.ok()
      );
    });
  const [list, summary] = await Promise.all([
    response(''),
    response('/summary'),
    page.getByRole('button', { name: 'ค้นหา', exact: true }).click(),
  ]);
  return { list: await list.json(), summary: await summary.json() };
}

test('finds every exact IMEI sale and each bill line using the masked real SHOP API', async ({
  page,
}, info) => {
  const proof = await page.request.get('/__tooltify_run');
  expect(await proof.json()).toEqual({ runId: peek.runId, apiOrigin: peek.apiOrigin });
  const auth = await page.request.post('/api/admin/auth/login', {
    headers: { 'X-Requested-With': 'XMLHttpRequest' },
    data: { email: peek.email, password: peek.password },
  });
  expect(auth.ok()).toBeTruthy();
  const login = (await auth.json()).data;
  expect(login.user.id).toBe(peek.userId);
  await page.addInitScript((token) => {
    localStorage.setItem('access_token', token);
  }, login.accessToken);
  await page.goto('/imported-sales');
  await expect(page.getByRole('heading', { name: /Tooltify/ })).toBeVisible();
  await expect(page).toHaveURL(/zone=shop/);
  const foreign = await page.request.get('/api/admin/imported-sales?company=finance', {
    headers: { Authorization: 'Bearer ' + login.accessToken },
  });
  expect(foreign.status()).toBe(403);
  if (info.project.name === 'desktop') {
    await page.goto('/shop/accounting');
    await page.getByRole('button', { name: 'บัญชีหน้าร้าน (SHOP)', exact: true }).click();
    await page.getByRole('link', { name: 'ยอดขายย้อนหลัง (Tooltify)', exact: true }).click();
    await expect(page).toHaveURL(/imported-sales.*zone=shop/);
  }
  await page.reload();
  await expect(page).toHaveURL(/imported-sales.*zone=shop/);
  await page.getByLabel('บาร์โค้ด/IMEI', { exact: true }).fill(imei);
  const { list, summary } = await search(page, 'barcode', imei);
  expect(list.total).toBe(2);
  expect(list.data.map((r: { orderNumber: string }) => r.orderNumber)).toEqual([
    'TT-TEST-002',
    'TT-TEST-001',
  ]);
  expect(summary.totals).toMatchObject({
    billCount: 2,
    lineCount: 2,
    sales: '2469.12',
    cost: null,
    profit: null,
  });
  for (const row of list.data)
    expect(row).toMatchObject({ barcode: imei, costTotal: null, profit: null });
  for (const group of [
    summary.byMonth,
    summary.byChannel,
    summary.byCategory,
    summary.bySalesperson,
  ]) {
    expect(group.length).toBeGreaterThan(0);
    for (const row of group) expect(row.profit).toBeNull();
  }
  await expect(page.getByRole('cell', { name: 'TT-TEST-001', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'TT-TEST-002', exact: true })).toBeVisible();
  await expect(page.getByText('ไม่มีสิทธิ์ดู', { exact: true })).toHaveCount(4);
  await expect(page.getByText('฿2,469.12', { exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  await page.screenshot({ path: join(peek.run, info.project.name + '-imei.png'), fullPage: true });
  await page.getByLabel('บาร์โค้ด/IMEI', { exact: true }).fill('');
  await page.getByLabel('เลขบิล', { exact: true }).fill('TEST-002');
  const bill = await search(page, 'orderNumber', 'TEST-002');
  expect(bill.summary.totals).toMatchObject({ billCount: 1, lineCount: 2 });
  expect(bill.list.data.map((row: { barcode: string }) => row.barcode).sort()).toEqual([
    imei,
    '001234567890124',
  ]);
  await expect(page.getByRole('cell', { name: 'TT-TEST-002', exact: true })).toHaveCount(2);
  await expect(
    page
      .locator('dl div')
      .filter({ has: page.getByText('จำนวนบิล', { exact: true }) })
      .locator('dd'),
  ).toHaveText('1');
  await expect(
    page
      .locator('dl div')
      .filter({ has: page.getByText('จำนวนรายการ', { exact: true }) })
      .locator('dd'),
  ).toHaveText('2');
  await expect(page.getByText('ยังไม่มีการรับรองช่วงที่ค้น')).toBeVisible();
});
