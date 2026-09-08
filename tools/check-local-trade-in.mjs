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
  const checkLayout = async () => {
    const layout = await dialog.evaluate(element => {
      const rect = element.getBoundingClientRect();
      const body = element.querySelector('[data-testid="quick-buy-body"]');
      return { inViewport: rect.left >= 0 && rect.right <= innerWidth + 1 && rect.top >= 0 && rect.bottom <= innerHeight + 1,
        bodyFits: body.scrollWidth <= body.clientWidth + 1 };
    });
    assert.deepEqual(layout, { inViewport: true, bodyFits: true }, 'Counter purchase must fit the screen');
  };
  await expect(dialog.getByText('ขั้นที่ 1 / 4', { exact: true })).toBeVisible();
  await checkLayout();
  await expect(dialog.getByLabel('ชื่อผู้ขายตามบัตรประชาชน *', { exact: true })).toHaveCount(0);
  await dialog.getByRole('combobox', { name: 'รุ่น iPhone *', exact: true }).click();
  await page.getByRole('option', { name: 'iPhone 15', exact: true }).click();
  const questionsResponse = page.waitForResponse(r => r.url().includes('/trade-ins/quick-buy/questions') && r.request().method() === 'GET');
  await dialog.getByRole('combobox', { name: 'ความจุ *', exact: true }).click();
  await page.getByRole('option', { name: '128GB', exact: true }).click();
  const loadedQuestions = await questionsResponse;
  assert.equal(loadedQuestions.status(), 200, await loadedQuestions.text());
  const questionnaire = await loadedQuestions.json();
  assert.ok(questionnaire.questions?.length > 0, 'Quick Buy must use the selected device questionnaire');
  const imei = `99${Date.now()}`; // Synthetic identifier, unique across retained preview runs.
  const serialNumber = `LOCAL-SN-${width}-${Date.now()}`;
  await dialog.getByLabel('IMEI', { exact: true }).fill(imei);
  await dialog.getByLabel('Serial Number', { exact: true }).fill(serialNumber);
  await dialog.getByRole('button', { name: 'ถัดไป', exact: true }).click();
  await expect(dialog.getByText('ขั้นที่ 2 / 4', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('spinbutton')).toHaveCount(0);
  await expect(dialog.getByLabel('ชื่อผู้ขายตามบัตรประชาชน *', { exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'ถัดไป', exact: true })).toBeDisabled();
  const priceResponse = page.waitForResponse(r => r.url().includes('/trade-ins/quick-buy/preview') && r.request().method() === 'POST');
  if (questionnaire.eligibilityRequired) {
    await dialog.getByRole('checkbox', { name: 'ยืนยันเครื่องผ่านเงื่อนไขรับซื้อ', exact: true }).check();
  }
  const answers = [];
  for (const question of questionnaire.questions) {
    const group = dialog.getByRole('group', { name: new RegExp(question.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) });
    if (question.selectType === 'MULTI') {
      await group.getByRole('checkbox', { name: 'ตรวจแล้ว ไม่พบปัญหา', exact: true }).check();
      answers.push({ questionKey: question.key, choiceIds: [] });
    } else {
      const choice = question.choices.find(c => Number(c.deductValue) === 0) ?? question.choices[0];
      await group.getByRole('radio', { name: choice.label, exact: true }).check();
      answers.push({ questionKey: question.key, choiceIds: [choice.id] });
    }
  }
  const priced = await priceResponse;
  assert.equal(priced.status(), 201, await priced.text());
  const quote = await priced.json();
  assert.ok(quote.available && quote.previewToken && Number(quote.cashPrice) > 0);
  const quotedCash = Number(quote.cashPrice);
  assert.deepEqual(priced.request().postDataJSON(), {
    deviceBrand: 'Apple', deviceModel: 'iPhone 15', deviceStorage: '128GB', answers,
    ...(questionnaire.eligibilityRequired ? { deviceEligibilityConfirmed: true } : {}),
  }, 'The first quote needs only the device inspection, without seller personal data');
  await expect(dialog.getByRole('button', { name: 'ถัดไป', exact: true })).toBeEnabled();
  await checkLayout();
  await page.screenshot({ path: join(output, `trade-in-first-price-${width}.png`) });
  await dialog.getByRole('button', { name: 'ถัดไป', exact: true }).click();
  await expect(dialog.getByText('ขั้นที่ 3 / 4', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'ย้อนกลับ', exact: true }).click();
  await expect(dialog.getByText('ขั้นที่ 2 / 4', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'ถัดไป', exact: true })).toBeEnabled();
  for (const question of questionnaire.questions) {
    const group = dialog.getByRole('group', { name: new RegExp(question.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) });
    if (question.selectType === 'MULTI') {
      await expect(group.getByRole('checkbox', { name: 'ตรวจแล้ว ไม่พบปัญหา', exact: true })).toBeChecked();
    } else {
      const selectedId = answers.find(answer => answer.questionKey === question.key).choiceIds[0];
      await expect(group.getByRole('radio', { name: question.choices.find(choice => choice.id === selectedId).label, exact: true })).toBeChecked();
    }
  }
  await dialog.getByRole('button', { name: 'ถัดไป', exact: true }).click();
  await dialog.getByRole('combobox', { name: 'สาขาที่รับซื้อ *', exact: true }).click();
  await page.getByRole('option', { name: 'LOCAL PREVIEW BRANCH', exact: true }).click();
  await dialog.getByText('ค้นหาหรือสร้างผู้ขาย', { exact: true }).click();
  await page.getByPlaceholder('ค้นหาผู้ติดต่อ / เลขภาษี...').fill('ผู้ขายตัวอย่าง Local');
  await page.getByRole('option', { name: /ผู้ขายตัวอย่าง Local/ }).click();
  // Wait for contact selection to finish before entering the identity evidence it resets.
  await expect(dialog.getByLabel('ชื่อผู้ขายตามบัตรประชาชน *', { exact: true })).toHaveValue('ผู้ขายตัวอย่าง Local');
  await dialog.getByLabel('เลขบัตรประชาชน *', { exact: true }).fill('0000000000001');
  await dialog.getByLabel('เบอร์โทรผู้ขาย *', { exact: true }).fill('0000000000');
  await dialog.getByPlaceholder('123/45').fill('1 Synthetic Road');
  await dialog.getByRole('button', { name: 'ถัดไป', exact: true }).click();
  await expect(dialog.getByText('ขั้นที่ 4 / 4', { exact: true })).toBeVisible();
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
  assert.equal(Number(received.agreedPrice), quotedCash);
  assert.equal(received.deviceCondition, quote.grade);
  assert.deepEqual(response.request().postDataJSON().answers, answers);
  assert.equal(response.request().postDataJSON().previewToken, quote.previewToken);
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
  const salePrice = Math.ceil(quotedCash / 10) * 10 + 1000;
  const installmentPrice = salePrice + 500;
  await page.getByRole('button', { name: 'แก้ราคา', exact: true }).click();
  await page.getByRole('dialog').getByRole('spinbutton').nth(0).fill(String(salePrice));
  await page.getByRole('dialog').getByRole('spinbutton').nth(1).fill(String(installmentPrice));
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
  if (width >= 1440) {
    const expandSidebar = page.getByRole('button', { name: 'ขยายเมนู', exact: true });
    if (await expandSidebar.count()) await expandSidebar.click();
    await page.locator('.wrapper').evaluate((e) => Promise.all(e.getAnimations().map((a) => a.finished.catch(() => {}))));
    assert.ok(await scroller.evaluate((e) => e.scrollWidth <= e.clientWidth + 1), 'All trade-in columns must fit a laptop with the sidebar expanded');
  }
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
    await expect(inventory.getByText(`฿${salePrice.toLocaleString('th-TH')}`, { exact: true })).toBeVisible();
    await expect(inventory.getByText(`฿${installmentPrice.toLocaleString('th-TH')}`, { exact: true })).toBeVisible();
    assert.equal(await detail.evaluate((e) => e.scrollWidth <= e.clientWidth + 1), true, 'Receipt details must not clip horizontally');
    await page.screenshot({ path: join(output, `trade-in-detail-${width}.png`) });
    const detailBody = detail.getByTestId('trade-in-detail-body');
    assert.ok(await detailBody.evaluate((e) => e.scrollWidth <= e.clientWidth + 1), 'Detail content must wrap inside its scroll area');
    const printButton = detail.getByRole('button', { name: 'พิมพ์เอกสารรับเครื่อง', exact: true });
    const printBounds = await printButton.boundingBox();
    const viewportHeight = await page.evaluate(() => innerHeight);
    assert.ok(printBounds && printBounds.height >= 44 && printBounds.y >= 0 && printBounds.y + printBounds.height <= viewportHeight, 'Document action must remain visible below the scrolling details');
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
