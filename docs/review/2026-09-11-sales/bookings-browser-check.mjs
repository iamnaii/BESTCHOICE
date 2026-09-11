// Real checkout UI, synthetic booking/product reads and intercepted writes only.
// Monetary/stock/expiry behavior is separately exercised on disposable PostgreSQL.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
const origin = process.env.SALES_PREVIEW_URL ?? 'http://localhost:5207';
const output = 'docs/review/2026-09-11-sales/evidence/bookings';
await mkdir(output, { recursive: true });
const actor = await (await fetch(`${origin}/api/admin/auth/me`)).json();
const branch = { id: actor.branchId ?? 'synthetic-branch', name: 'สาขาตัวอย่าง', shopCashAccountCode: 'S11-1101' };
const customer = { id: 'synthetic-customer', name: 'ลูกค้าตัวอย่าง UX', phone: '0800000000' };
const initial = () => ({ id: 'synthetic-booking', bookingNumber: 'BK-UX-001', status: 'PAID', customer, branch,
  createdBy: { id: actor.id, name: 'พนักงานตัวอย่าง' }, totalAmount: '10000', depositAmount: '1000',
  depositPaidAt: '2026-09-10T00:00:00.000Z', depositMethod: 'CASH', expireDate: '2099-09-11T17:00:00.000Z',
  items: [{ id: 'synthetic-item', productId: 'synthetic-product', description: 'เครื่องตัวอย่าง · SYNTHETIC-IMEI', quantity: 1, unitPrice: '10000', amount: '10000' }] });
const browser = await chromium.launch({ headless: true });
const results = [], submitted = [];
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 1000 } });
    await context.routeWebSocket('**/socket.io/**', socket => socket.close());
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    let booking = initial(), detailFails = false;
    await page.route('**/api/admin/**', async route => {
      const request = route.request(), path = new URL(request.url()).pathname.replace('/api/admin', '');
      if (request.method() !== 'GET') {
        if (path.startsWith('/bookings')) {
          submitted.push({ width, path, method: request.method(), body: request.postDataJSON() });
          if (path.endsWith('/convert')) booking = { ...booking, status: 'CONVERTED', convertedToSale: { id: 'synthetic-sale', saleNumber: 'SYNTHETIC-SALE' } };
          if (path.endsWith('/pay-deposit')) booking = { ...booking, status: 'PAID', depositPaidAt: new Date().toISOString() };
          return route.fulfill({ json: booking });
        }
        return route.fulfill({ status: 501, json: { message: 'Synthetic UI check: unrecognized writes disabled' } });
      }
      if (path === '/bookings') return route.fulfill({ json: { data: [booking], page: 1, limit: 50, total: 1 } });
      if (path === '/bookings/synthetic-booking') return route.fulfill(detailFails
        ? { status: 503, json: { message: 'Synthetic detail failure' } } : { json: booking });
      if (path === '/branches') return route.fulfill({ json: [branch] });
      if (path === '/customers') return route.fulfill({ json: { data: [customer], total: 1 } });
      if (path === '/products') return route.fulfill({ json: { data: [{ id: 'synthetic-product', name: 'เครื่องตัวอย่าง',
        imeiSerial: 'SYNTHETIC-IMEI', branchId: branch.id, status: 'IN_STOCK', cashPrice: '10000', installmentPrice: '12000', prices: [] }] } });
      return route.continue();
    });
    const snap = async name => {
      await page.screenshot({ path: `${output}/${name}-${width}.png`, fullPage: true });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
      const modal = await page.getByRole('dialog').boundingBox();
      assert.equal(overflow, false, `page overflow ${name} ${width}`);
      if (modal) { assert.ok(modal.width <= width + 1); assert.ok(modal.height <= (width === 390 ? 844 : 1000)); }
      results.push({ name, width, overflow, dialogFitsViewport: !!modal });
    };
    const open = async () => {
      await page.goto(`${origin}/bookings`);
      await page.getByRole('button', { name: 'เปิด', exact: true }).click();
    };
    const choose = async (label, option) => {
      await page.getByRole('combobox', { name: label }).click();
      await page.getByRole('option', { name: option, exact: true }).click();
    };
    await open();
    await expect(page.getByRole('button', { name: /รับส่วนต่างและขาย|ขายโดยใช้มัดจำที่รับแล้ว/, exact: true })).toBeDisabled();
    await choose('วิธีรับส่วนต่าง', 'โอนธนาคาร');
    await page.getByRole('checkbox', { name: 'ยืนยันว่าได้รับยอดส่วนต่างครบแล้ว' }).check();
    await snap('paid-balance');
    await page.getByRole('button', { name: /รับส่วนต่างและขาย|ขายโดยใช้มัดจำที่รับแล้ว/, exact: true }).click();
    await expect(page.getByText('SYNTHETIC-SALE', { exact: true })).toBeVisible();
    await snap('converted');

    booking = { ...initial(), status: 'PENDING_DEPOSIT', depositPaidAt: null };
    await open();
    await expect(page.getByText(/รับเข้าบัญชี SHOP/)).toContainText('S11-1101');
    await choose('วิธีรับมัดจำ', 'โอนธนาคาร');
    await snap('pending-deposit');
    await page.getByRole('button', { name: 'บันทึกรับมัดจำ', exact: true }).click();
    await expect(page.getByRole('button', { name: 'แก้หมายเหตุ / วันหมดอายุ', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'แก้หมายเหตุ / วันหมดอายุ', exact: true }).click();
    await expect(page.getByLabel('มัดจำที่รับแล้ว (บาท)')).toHaveAttribute('readonly', '');
    await snap('paid-restricted-edit');

    booking = { ...initial(), depositAmount: '10000' }; await open();
    await expect(page.getByRole('combobox', { name: 'วิธีรับส่วนต่าง' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /รับส่วนต่างและขาย|ขายโดยใช้มัดจำที่รับแล้ว/, exact: true })).toBeEnabled();
    await snap('fully-prepaid');
    booking = { ...initial(), items: [{ ...initial().items[0], quantity: 2 }] }; await open();
    await expect(page.getByRole('alert')).toContainText('1 รายการ จำนวน 1 ชิ้น');
    await expect(page.getByRole('button', { name: /รับส่วนต่างและขาย|ขายโดยใช้มัดจำที่รับแล้ว/, exact: true })).toBeDisabled();
    await snap('legacy-items-blocked');
    booking = { ...initial(), expireDate: '2000-01-01T17:00:00.000Z' }; await open();
    await expect(page.getByRole('status')).toContainText('ถึงกำหนดหมดอายุแล้ว');
    await expect(page.getByRole('button', { name: /รับส่วนต่างและขาย|ขายโดยใช้มัดจำที่รับแล้ว/, exact: true })).toHaveCount(0);
    await snap('expired');

    booking = initial(); detailFails = true; await open();
    await expect(page.getByRole('alert')).toContainText('โหลดใบจองไม่สำเร็จ', { timeout: 15000 });
    await snap('detail-error');
    detailFails = false; await page.getByRole('button', { name: 'ลองใหม่', exact: true }).click();
    await expect(page.getByRole('button', { name: /รับส่วนต่างและขาย|ขายโดยใช้มัดจำที่รับแล้ว/, exact: true })).toBeVisible();
    await snap('detail-recovered');

    await page.goto(`${origin}/bookings`);
    await page.getByRole('button', { name: 'สร้างใบจอง', exact: true }).click();
    await choose('ลูกค้า', `${customer.name} — ${customer.phone}`);
    if (!actor.branchId) await choose('สาขา', branch.name);
    await page.getByRole('textbox', { name: 'ค้นหาเครื่องในสาขา' }).fill('SYNTHETIC');
    await page.getByRole('button').filter({ hasText: 'IMEI / Serial: SYNTHETIC-IMEI' }).click();
    await expect(page.getByRole('spinbutton', { name: 'ราคาต่อหน่วยรายการที่ 1' })).toHaveValue('10000');
    await page.getByLabel('ใช้ได้ถึงสิ้นวันที่ (เวลาไทย)').fill('2099-09-11');
    await page.getByLabel('มัดจำที่ต้องรับ (บาท)').fill('1000');
    await snap('create-linked-device');
    await page.getByRole('button', { name: 'บันทึกใบจอง', exact: true }).click();
    assert.deepEqual(errors, [], 'No uncaught browser errors');
    await context.close();
  }
} finally { await browser.close(); }
for (const width of [1440, 390]) {
  const writes = submitted.filter(write => write.width === width);
  assert.equal(writes.length, 3);
  assert.equal(writes[0].body.paymentMethod, 'BANK_TRANSFER');
  assert.deepEqual(writes[1].body, { depositMethod: 'BANK_TRANSFER' });
  assert.equal(writes[2].body.expireDate, '2099-09-11T17:00:00.000Z');
  assert.equal(writes[2].body.items[0].productId, 'synthetic-product');
}
await writeFile(`${output}/result.json`, JSON.stringify({ origin,
  scope: 'Real UI; synthetic booking/product responses; intercepted writes; actual money/stock covered by disposable PostgreSQL tests', results, submitted }, null, 2));
console.log(JSON.stringify(results));
