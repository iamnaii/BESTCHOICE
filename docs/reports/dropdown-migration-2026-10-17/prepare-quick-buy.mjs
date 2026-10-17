import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from '@playwright/test';

/** Uses real trade-in/product services with synthetic data in the guarded preview database. */
export async function prepareQuickBuy(page, origin, output, width) {
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
  return dialog;
}
