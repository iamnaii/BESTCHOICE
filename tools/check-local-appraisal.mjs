import assert from 'node:assert/strict';
import { join } from 'node:path';
import { expect } from '@playwright/test';

/** Real questionnaire/price engine, synthetic records in the managed isolated database only. */
export async function checkAppraisal(page, origin, output, width) {
  const url = path => new URL(path, origin).href;
  const info = await (await page.request.get(url('/api/preview/info'))).json();
  assert.equal(info.isolated, true, 'Appraisal checks require the isolated preview');
  const imei = `99${Date.now()}`;
  const created = await page.request.post(url('/api/trade-ins'), { data: {
    deviceBrand: 'Apple', deviceModel: 'iPhone 15', deviceStorage: '128GB', deviceColor: 'ดำ',
    imei, serialNumber: `LOCAL-CHECKLIST-${width}-${Date.now()}`,
    sellerName: 'ผู้ขายแบบตรวจจำลอง', sellerPhone: '0000000000',
  } });
  assert.equal(created.status(), 201, await created.text());
  const item = await created.json();
  const questionnaire = await (await page.request.get(url(`/api/trade-ins/appraisal-questions?tradeInId=${item.id}`))).json();
  assert.ok(questionnaire.questions?.length > 0, 'The preview must seed an active questionnaire');
  await page.goto(url('/trade-in?zone=shop'));
  await page.getByRole('textbox', { name: 'ค้นหารายการรับซื้อ' }).fill(imei);
  await expect(page.getByTestId('data-table').locator('tbody tr')).toHaveCount(1);
  await page.getByRole('button', { name: 'ประเมิน', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'ตรวจสภาพและประเมินราคา' });
  const save = dialog.getByRole('button', { name: 'บันทึกผลตรวจและราคา', exact: true });
  await expect(save).toBeDisabled();
  await expect(dialog.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
  if (questionnaire.eligibilityRequired) {
    await dialog.getByRole('checkbox', { name: 'ยืนยันเครื่องผ่านเงื่อนไขรับซื้อ' }).check();
  }
  const answers = [];
  for (const q of questionnaire.questions) {
    const group = dialog.getByRole('group', { name: new RegExp(q.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) });
    if (q.selectType === 'MULTI') {
      await group.getByRole('checkbox', { name: 'ตรวจแล้ว ไม่พบปัญหา', exact: true }).check();
      answers.push({ questionKey: q.key, choiceIds: [] });
    } else {
      const choice = q.choices.find(c => Number(c.deductValue) === 0) ?? q.choices[0];
      await group.getByRole('radio', { name: choice.label, exact: true }).check();
      answers.push({ questionKey: q.key, choiceIds: [choice.id] });
    }
  }
  await expect(save).toBeEnabled();
  // Exercise a changed inspection after a completed quote; the new amount must be server-derived.
  const changedQuestion = questionnaire.questions.find(q => q.selectType === 'SINGLE' && q.choices.some(c => Number(c.deductValue) > 0));
  assert.ok(changedQuestion, 'Seed must provide a deduction choice');
  const changedChoice = changedQuestion.choices.find(c => Number(c.deductValue) > 0);
  const pendingQuote = page.waitForResponse(r => r.request().method() === 'POST' && r.url().includes(`/${item.id}/appraisal-preview`));
  await dialog.getByRole('group', { name: new RegExp(changedQuestion.title) }).getByRole('radio', { name: changedChoice.label, exact: true }).check();
  answers.find(a => a.questionKey === changedQuestion.key).choiceIds = [changedChoice.id];
  const quoteResponse = await pendingQuote;
  assert.equal(quoteResponse.status(), 201, await quoteResponse.text());
  const quote = await quoteResponse.json();
  assert.ok(quote.available && quote.previewToken);
  assert.equal(quote.breakdown.chosenFlow, item.flow);
  await expect(save).toBeEnabled();
  await expect(dialog.locator('footer')).toContainText(`฿${Number(quote.price).toLocaleString('th-TH')}`);
  const layout = await dialog.evaluate(e => {
    const r = e.getBoundingClientRect();
    const body = e.querySelector('[data-testid="appraisal-body"]');
    const footer = e.querySelector('footer').getBoundingClientRect();
    return { fits: r.left >= 0 && r.right <= innerWidth + 1 && r.top >= 0 && r.bottom <= innerHeight + 1,
      bodyFits: body.scrollWidth <= body.clientWidth + 1, footerFits: footer.bottom <= innerHeight + 1 };
  });
  assert.deepEqual(layout, { fits: true, bodyFits: true, footerFits: true });
  await page.screenshot({ path: join(output, `trade-in-appraisal-${width}.png`) });
  const savedResponse = page.waitForResponse(r => r.request().method() === 'PATCH' && r.url().includes(`/${item.id}/appraise-online`));
  await save.click();
  const saved = await savedResponse;
  assert.equal(saved.status(), 200, await saved.text());
  await expect(dialog).toHaveCount(0);
  const detail = await (await page.request.get(url(`/api/trade-ins/${item.id}`))).json();
  assert.equal(detail.status, 'APPRAISED');
  assert.equal(Number(detail.offeredPrice), Number(quote.price));
  assert.equal(detail.deviceCondition, quote.grade);
  assert.equal(detail.productId, null, 'Inspecting does not receive stock before customer acceptance');
  assert.deepEqual(detail.quoteBreakdown, quote.breakdown);
  assert.deepEqual(detail.conditionAnswers.map(answer => {
    if (answer.questionKey !== '__device_eligibility') return answer;
    const { verifiedById, verifiedAt, ...snapshot } = answer;
    assert.ok(verifiedById && Number.isFinite(Date.parse(verifiedAt)), 'Saved eligibility needs staff/time evidence');
    return snapshot;
  }), quote.conditionAnswers);
  await page.getByRole('button', { name: 'เมนูการทำงาน' }).click();
  await page.getByRole('menuitem', { name: 'ดูรายละเอียด', exact: true }).click();
  const savedDialog = page.getByRole('dialog', { name: 'รายละเอียดรายการรับซื้อ' });
  await expect(savedDialog.getByText('คำตอบแบบประเมินสภาพเครื่อง', { exact: true })).toBeVisible();
  await expect(savedDialog.getByText(changedChoice.label, { exact: true }).last()).toBeVisible();
  await page.screenshot({ path: join(output, `trade-in-inspection-saved-${width}.png`) });
  await savedDialog.getByRole('button', { name: 'ปิด', exact: true }).click();
  return { id: item.id, flow: item.flow, price: quote.price, questions: answers.length };
}
