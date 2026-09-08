import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from '@playwright/test';

/** Uses real trade-in/product services with synthetic data in the guarded preview database. */
export async function checkTradeIn(page, origin, output, width) {
  const info = await (await page.request.get(new URL('/api/preview/info', origin).href)).json();
  assert.equal(info.isolated, true, 'Never create a purchase outside the isolated preview');
  await page.goto(new URL('/trade-in?zone=shop', origin).href);
  await page.getByRole('button', { name: 'รับซื้อเครื่อง', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('select').selectOption({ label: 'LOCAL PREVIEW BRANCH' });
  await dialog.getByText('ค้นหาหรือสร้างผู้ขาย', { exact: true }).click();
  await page.getByPlaceholder('ค้นหาผู้ติดต่อ / เลขภาษี...').fill('ผู้ขายตัวอย่าง Local');
  await page.getByRole('option', { name: /ผู้ขายตัวอย่าง Local/ }).click();
  // The option text is visible before ensure-role finishes. Wait for the form
  // to receive the selected contact before entering evidence that selection resets.
  await expect(dialog.getByLabel('ชื่อผู้ขายตามบัตรประชาชน *', { exact: true })).toHaveValue('ผู้ขายตัวอย่าง Local');
  await dialog.getByLabel('เลขบัตรประชาชน *', { exact: true }).fill('0000000000001');
  await dialog.getByLabel('เบอร์โทรผู้ขาย *', { exact: true }).fill('0000000000');
  await dialog.getByPlaceholder('123/45').fill('1 Synthetic Road');
  await dialog.getByRole('button', { name: 'ถัดไป' }).click();
  await expect(dialog.getByText('ขั้นที่ 2 / 3', { exact: true })).toBeVisible();
  await dialog.locator('select').nth(0).selectOption('Apple');
  await dialog.locator('select').nth(1).selectOption('iPhone 15');
  const imei = `99${Date.now()}`; // Synthetic identifier, unique across retained preview runs.
  const serialNumber = `LOCAL-SN-${width}-${Date.now()}`;
  await dialog.getByLabel('IMEI', { exact: true }).fill(imei);
  await dialog.getByLabel('Serial Number', { exact: true }).fill(serialNumber);
  await dialog.getByPlaceholder('0', { exact: true }).fill('5000');
  await dialog.getByRole('button', { name: 'ถัดไป' }).click();
  await dialog.getByRole('checkbox', { name: /ตรวจบัตรประชาชน/ }).check();
  await dialog.getByRole('checkbox', { name: /ผู้ขายได้อ่านและยอมรับ/ }).check();
  // Check the recipient UI on desktop and the cash path on mobile.
  if (width >= 1024) {
    await dialog.getByRole('radio', { name: 'โอนเงิน' }).check();
    await dialog.getByLabel('ธนาคารผู้ขาย *').fill('ธนาคารผู้ขายตัวอย่าง');
    await dialog.getByLabel('เลขบัญชีผู้ขาย *').fill('1234567890');
    await dialog.getByLabel('ชื่อบัญชีผู้ขาย *').fill('ผู้ขายตัวอย่าง Local');
  }
  await expect(dialog.getByRole('button', { name: 'ยืนยันลงนาม', exact: true })).toHaveCount(0);
  const canvas = dialog.locator('canvas');
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  assert.ok(box);
  await page.mouse.move(box.x + 30, box.y + 30);
  await page.mouse.down();
  await page.mouse.move(box.x + 100, box.y + 60, { steps: 8 });
  await page.mouse.up();
  await page.screenshot({ path: join(output, `trade-in-payment-${width}.png`) });
  const saved = page.waitForResponse(r => /\/trade-ins\/quick-buy(?:\?|$)/.test(r.url()) && r.request().method() === 'POST');
  await dialog.getByRole('button', { name: 'บันทึก + ออกใบสำคัญ', exact: true }).click();
  const response = await saved;
  assert.equal(response.status(), 201, await response.text());
  const result = await response.json();
  assert.ok(result.productId);
  const received = await (await page.request.get(new URL(`/api/trade-ins/${result.id}`, origin).href)).json();
  assert.equal(received.imei, imei);
  assert.equal(received.serialNumber, serialNumber);
  assert.equal(result.productStatus, 'PHOTO_PENDING');
  await expect(page.getByText('รับเครื่องแล้ว — รอเตรียมเครื่องก่อนขาย', { exact: true })).toBeVisible();
  await page.screenshot({ path: join(output, `trade-in-handoff-${width}.png`) });
  const voucher = page.waitForResponse(r => /\/voucher\.pdf(?:\?|$)/.test(r.url()));
  await page.getByRole('button', { name: 'พิมพ์เอกสารรับเครื่อง' }).click();
  const pdfResponse = await voucher;
  assert.equal(pdfResponse.status(), 200, 'Real voucher PDF must render');
  const filename = `ใบสำคัญจ่ายเงิน_${result.voucherNumber}.pdf`;
  assert.ok(pdfResponse.headers()['content-disposition'].includes(`filename*=UTF-8''${encodeURIComponent(filename)}`));
  const preview = page.getByRole('dialog', { name: 'ตัวอย่างเอกสารรับเครื่อง' });
  await expect(preview.getByText(filename, { exact: true })).toBeVisible();
  const download = page.waitForEvent('download');
  await preview.getByRole('link', { name: 'ดาวน์โหลด PDF' }).click();
  const file = await download;
  assert.equal(file.suggestedFilename(), filename, 'Browser must save a descriptive filename, not the blob UUID');
  await file.saveAs(join(output, `trade-in-voucher-${width}.pdf`));
  assert.deepEqual(readFileSync(join(output, `trade-in-voucher-${width}.pdf`)), await pdfResponse.body(),
    'Downloaded file must be the same PDF that was opened for preview');
  await page.screenshot({ path: join(output, `trade-in-voucher-${width}.png`) });
  await preview.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(preview).toHaveCount(0);
  await page.getByRole('link', { name: 'เปิดเครื่อง ดูรูปและราคา' }).click();
  await expect(page).toHaveURL(new RegExp(`/products/${result.productId}`));
  await page.getByRole('button', { name: 'แก้ราคา', exact: true }).click();
  await page.getByRole('dialog').getByRole('spinbutton').nth(0).fill('6000');
  await page.getByRole('dialog').getByRole('spinbutton').nth(1).fill('6500');
  const price = page.waitForResponse(r => r.request().method() === 'PATCH' && r.url().includes(`/products/${result.productId}`));
  await page.getByRole('dialog').getByRole('button', { name: 'บันทึก', exact: true }).click();
  assert.equal((await price).status(), 200);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'รูปถ่าย', exact: true }).click();
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aNGkAAAAASUVORK5CYII=', 'base64');
  for (let n = 0; n < 6; n++) {
    await page.getByRole('button', { name: 'ถ่าย', exact: true }).first().click();
    const upload = page.waitForResponse(r => /\/photos\/upload(?:\?|$)/.test(r.url()));
    await page.locator('input[type=file]').setInputFiles({ name: 'synthetic-device.png', mimeType: 'image/png', buffer: png });
    assert.equal((await upload).status(), 201);
    await expect(page.getByRole('button', { name: 'ถ่าย', exact: true })).toHaveCount(5 - n);
  }
  const completed = page.waitForResponse(r => /\/photos\/complete(?:\?|$)/.test(r.url()));
  await page.getByRole('button', { name: 'ยืนยันรูปครบ', exact: true }).click();
  const completedResponse = await completed;
  assert.equal(completedResponse.status(), 201);
  assert.equal((await completedResponse.json()).enteredStock, true);
  await expect(page.getByRole('button', { name: 'ยืนยันรูปครบ', exact: true })).toHaveCount(0);
  const size = await page.evaluate(() => ({ content: document.documentElement.scrollWidth, viewport: innerWidth }));
  assert.ok(size.content <= size.viewport + 1, 'Product handoff must fit the viewport');
  await page.screenshot({ path: join(output, `trade-in-stock-${width}.png`), fullPage: true });

  // A successful purchase is not enough: staff must still reach the list controls,
  // inspect its receipt and distinguish current stock/prices from the intake record.
  await page.goto(new URL('/trade-in?zone=shop', origin).href);
  await page.getByRole('textbox', { name: 'ค้นหารายการรับซื้อ' }).fill(imei);
  await expect(page.getByTestId('data-table').locator('tbody tr')).toHaveCount(1);
  await expect(page.getByRole('table').getByText(imei, { exact: true })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const controls = await page.evaluate(() => ({
    viewport: innerWidth, content: document.documentElement.scrollWidth,
    clipped: [...document.querySelectorAll('main input, main [role=radio], main button')]
      .filter((e) => !e.closest('table'))
      .filter((e) => {
        const r = e.getBoundingClientRect();
        return r.width < 24 || r.x < 0 || r.right > innerWidth + 1;
      }).map((e) => e.getAttribute('aria-label') || e.textContent),
  }));
  assert.ok(controls.content <= controls.viewport + 1, 'Trade-in list must fit the viewport');
  assert.deepEqual(controls.clipped, [], 'Search, filters and page actions must remain reachable');
  const scroller = page.getByTestId('data-table');
  for (const edge of ['start', 'end']) {
    await scroller.evaluate((e, side) => { e.scrollLeft = side === 'start' ? 0 : e.scrollWidth; }, edge);
    const menu = page.getByRole('button', { name: 'เมนูการทำงาน' });
    const action = await menu.boundingBox();
    assert.ok(action && action.x >= 0 && action.x + action.width <= width, 'Row actions must stay pinned inside the viewport');
    await menu.click();
    await page.getByRole('menuitem', { name: 'ดูรายละเอียด', exact: true }).click();
    const detail = page.getByRole('dialog', { name: 'รายละเอียดรายการรับซื้อ' });
    await expect(detail.getByText(result.voucherNumber, { exact: true })).toBeVisible();
    await expect(detail.getByText(serialNumber, { exact: true })).toBeVisible();
    const inventory = detail.getByRole('region', { name: 'สถานะเครื่องปัจจุบัน' });
    await expect(inventory.getByText('พร้อมขาย', { exact: true })).toBeVisible();
    await expect(inventory.getByText('6/6 มุม')).toBeVisible();
    await expect(inventory.getByText('฿6,000', { exact: true })).toBeVisible();
    await expect(inventory.getByText('฿6,500', { exact: true })).toBeVisible();
    assert.equal(await detail.evaluate((e) => e.scrollWidth <= e.clientWidth + 1), true, 'Receipt details must not clip horizontally');
    await page.screenshot({ path: join(output, `trade-in-detail-${width}.png`) });
    if (edge === 'start') {
      await detail.getByRole('button', { name: 'พิมพ์เอกสารรับเครื่อง', exact: true }).click();
      const documentPreview = page.getByRole('dialog', { name: 'ตัวอย่างเอกสารรับเครื่อง' });
      await expect(documentPreview.getByRole('link', { name: 'ดาวน์โหลด PDF' })).toBeVisible();
      await documentPreview.getByRole('button', { name: 'Close', exact: true }).click();
    }
    await detail.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(detail).toHaveCount(0);
  }
  await page.screenshot({ path: join(output, `trade-in-list-${width}.png`), fullPage: true });
}
