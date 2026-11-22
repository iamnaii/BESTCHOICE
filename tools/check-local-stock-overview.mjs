import assert from 'node:assert/strict';
import { join } from 'node:path';
import { expect } from '@playwright/test';

/** Real same-checkout read endpoints, synthetic disposable database only. */
export async function checkStockOverview(page, origin, output, width) {
  const originalViewport = page.viewportSize();
  width = width === 390 ? 375 : width;
  await page.setViewportSize({ ...originalViewport, width });
  const stockWrites = [];
  const observe = (request) => {
    if (
      request.url().includes('/products') &&
      ['POST', 'PATCH', 'DELETE'].includes(request.method())
    )
      stockWrites.push(request.url());
  };
  page.on('request', observe);
  const dashboard = (scope) =>
    page.waitForResponse(
      (r) =>
        r.url().includes('/products/stock/dashboard?') &&
        new URL(r.url()).searchParams.get('inventoryScope') === scope,
    );
  const history=await page.request.get(new URL('/api/admin/imported-sales/summary',origin).href);
  assert.equal(history.status(),200,'Imported-history link needs a real preview read endpoint');
  assert.ok((await history.json()).totals.count>=3);
  const first = dashboard('devices');
  await page.goto(new URL('/stock?zone=shop', origin).href, { waitUntil: 'domcontentloaded' });
  const response = await first;
  assert.equal(response.status(), 200);
  const devices = await response.json();
  assert.ok(
    devices.salesAnalytics.current.importedCount >= 2,
    'Synthetic imported same-IMEI occurrences must both count',
  );
  await expect(page.getByRole('radio', { name: 'เครื่อง', exact: true })).toBeChecked();
  await expect(page.getByText('เครื่องพร้อมขาย', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'รวม Tooltify · ดูที่มาของยอด' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByText('ประวัติ Tooltify', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const next = dashboard('accessories');
  await page.getByRole('radio', { name: 'เครื่อง', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('radio', { name: 'อุปกรณ์เสริม', exact: true })).toBeFocused();
  await page.keyboard.press('Space');
  const accessories = await (await next).json();
  assert.ok(accessories.salesAnalytics.current.giftCount >= 1);
  await expect(page.getByText('อุปกรณ์เสริมพร้อมจ่าย', { exact: true })).toBeVisible();
  const last = dashboard('all');
  await page.getByRole('radio', { name: 'ทั้งหมด', exact: true }).click();
  const all = await (await last).json();
  assert.equal(
    all.stockTurnover.currentStock,
    devices.stockTurnover.currentStock + accessories.stockTurnover.currentStock,
  );
  await expect(page.getByRole('radio', { name: 'ทั้งหมด', exact: true })).toBeChecked();
  await expect(page.getByRole('article').getByText('พร้อมขาย', { exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('radio', { name: 'อุปกรณ์เสริม', exact: true })).toBeChecked();
  await page.goForward();
  await expect(page.getByRole('radio', { name: 'ทั้งหมด', exact: true })).toBeChecked();
  const reload = dashboard('all');
  await page.reload();
  await reload;
  await expect(page.getByRole('radio', { name: 'ทั้งหมด', exact: true })).toBeChecked();

  const size = await page.evaluate(() => ({
    viewport: innerWidth,
    content: document.documentElement.scrollWidth,
  }));
  assert.ok(size.content <= size.viewport + 1, 'Stock overview must not overflow');
  await page.screenshot({ path: join(output, `stock-overview-${width}.png`), fullPage: true });
  for (const [label, expected, status, aging] of [
    [/รอตรวจรับ \/ ตรวจสอบราคา/, all.actionRequired.qcPending, 'QC_PENDING', null],
    [/ค้างสต๊อกเกิน 90 วัน/, all.actionRequired.agingOver90, 'IN_STOCK', 'over90'],
  ]) {
    const listResponse = page.waitForResponse(
      (r) =>
        r.url().includes('/products?') && new URL(r.url()).searchParams.get('status') === status,
    );
    await page.getByRole('button', { name: label }).click();
    const list = await (await listResponse).json();
    assert.equal(list.totalUnits, expected);
    await expect(page).toHaveURL(aging ? /aging=over90/ : /view=all/);
    await page.goBack();
    await expect(page.getByRole('radio', { name: 'ทั้งหมด', exact: true })).toBeChecked();
  }
  const failedWarranty = [];
  await page.route('**/products/warranty/expiring?**', (route) => {
    failedWarranty.push(route.request().url());
    return route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Synthetic subsection outage' }),
    });
  });
  await page.reload();
  await expect(page.getByText('โหลดข้อมูลประกันไม่สำเร็จ หรือไม่มีสิทธิ์ดู')).toBeVisible({
    timeout: 20000,
  });
  await expect(page.getByRole('article').getByText('พร้อมขาย', { exact: true })).toBeVisible();
  await page.unroute('**/products/warranty/expiring?**');
  await page.getByRole('button', { name: 'ลองใหม่เฉพาะข้อมูลประกัน' }).click();
  await expect(page.getByText('โหลดข้อมูลประกันไม่สำเร็จ หรือไม่มีสิทธิ์ดู')).toHaveCount(0);
  await page.locator('#main').getByRole('button', { name: 'รายการสินค้า', exact: true }).click();
  await expect(page).toHaveURL(/inventoryScope=all/);
  await expect(page).toHaveURL(/view=ready/);
  await expect(page.getByRole('radio', { name: 'ทั้งหมด', exact: true })).toBeChecked();
  assert.deepEqual(stockWrites, [], 'Scope and drilldown navigation must not write stock');
  page.off('request', observe);
  await page.setViewportSize(originalViewport);
  return failedWarranty;
}
