import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
export async function checkChatSales(page, origin, output, width) {
  const info = await (await page.request.get(new URL('/api/admin/preview/info', origin).href)).json();
  assert.equal(info.isolated, true);
  const roomId = info.chatWorkRooms.SHOP;
  const expectedConsoleErrors = [];
  await page.goto(new URL(`/inbox/${roomId}?zone=shop`, origin).href);
  if (width < 1280) await page.getByRole('button', { name: 'ข้อมูลลูกค้า', exact: true }).click();
  const card = page.getByRole('region', { name: 'สถานะขายและงานถัดไป' }).filter({ visible: true });
  await expect(card.getByLabel('ขั้นการขาย', { exact: true })).toHaveText('ยังไม่ผูกข้อมูลลูกค้า');
  await expect(card.getByText('ติดตามลูกค้า SHOP', { exact: true }).first()).toBeVisible();
  await card.getByRole('button', { name: 'ผูกข้อมูลลูกค้า' }).click();
  await expect(page.getByRole('heading', { name: 'ผูกลูกค้าที่มีอยู่' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(card).toBeVisible();
  await page.screenshot({ path: join(output, `chat-sales-${width}.png`), animations: 'disabled' });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  // Real controller + Todo + inbox flow; two edits use the same initial revision.
  await card.getByRole('button', { name: 'ตั้งนัดติดตาม' }).click();
  let dialog = page.getByRole('dialog', { name: 'ตั้งนัดติดตาม', exact: true });
  const title = `ติดตามทดสอบ ${width} ${Date.now()}`;
  await dialog.getByLabel('เรื่องที่ติดตาม', { exact: true }).fill(title);
  await dialog.getByLabel('วันเวลานัด (เวลาไทย)').fill('2026-10-01T10:30');
  const staff = dialog.getByLabel('ผู้รับผิดชอบงาน');
  await expect(staff.locator('option')).not.toHaveCount(1);
  const recipient = await staff.locator('option').nth(1).getAttribute('value');
  await staff.selectOption(recipient);
  const creation = page.waitForResponse(r => r.request().method() === 'POST' && /rooms\/[^/]+\/follow-ups/.test(r.url()));
  await dialog.getByRole('button', { name: 'บันทึกนัด', exact: true }).click();
  const created = await creation; assert.equal(created.status(), 201); const task = await created.json();
  await expect(dialog).toHaveCount(0);
  await page.locator('#room-appointments').filter({ visible: true }).getByRole('button', { name: 'ดู / แก้ไขนัด' }).first().click();
  dialog = page.getByRole('dialog', { name: 'แก้ไขนัดติดตาม', exact: true });
  await expect(dialog.getByLabel('เรื่องที่ติดตาม', { exact: true })).toHaveValue(title);
  await expect(dialog.getByLabel('วันเวลานัด (เวลาไทย)')).toHaveValue('2026-10-01T10:30');
  const other = await page.request.patch(`${origin}/api/staff-chat/follow-ups/${task.id}?company=SHOP`, { data: { expectedRevision: 0, title: `${title} อีกคนแก้` } });
  assert.equal(other.status(), 200);
  await dialog.getByLabel('วันเวลานัด (เวลาไทย)').fill('2026-10-07T00:01');
  const conflictResponse = page.waitForResponse(r => r.status() === 409 && r.url().includes(`/follow-ups/${task.id}`));
  await dialog.getByRole('button', { name: 'บันทึกนัด', exact: true }).click();
  expectedConsoleErrors.push((await conflictResponse).url());
  await expect(dialog.getByRole('alert')).toContainText('มีคนแก้ไขนัดนี้แล้ว');
  await dialog.getByRole('button', { name: 'โหลดข้อมูลล่าสุดเพื่อเทียบ' }).click();
  await expect(dialog.getByText(`${title} อีกคนแก้`, { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'ใช้ฉบับร่างนี้กับข้อมูลล่าสุด' }).click();
  await dialog.getByLabel('สถานะนัด').selectOption('CANCELLED');
  const update = page.waitForResponse(r => r.request().method() === 'PATCH' && r.url().includes(`/follow-ups/${task.id}`));
  await dialog.getByRole('button', { name: 'บันทึกนัด', exact: true }).click();
  const updated = await update; assert.equal(updated.status(), 200);
  const saved = await updated.json(); assert.equal(saved.revision, 2); assert.equal(saved.dueDate, '2026-10-06T17:01:00.000Z');
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('#room-appointments').filter({ visible: true })).not.toContainText(title);
  const generic = await page.request.get(`${origin}/api/todos?roomId=${roomId}&company=SHOP&view=cancelled`);
  assert.equal(generic.status(), 200); assert.ok((await generic.json()).data.some(row => row.id === task.id));
  await page.keyboard.press('Escape');
  // A historical evidence link must load that exact analysis, not merely scroll to the newest card.
  await page.goto(info.resultUrl);
  if (width < 1280) await page.getByRole('button', { name: 'ข้อมูลลูกค้า', exact: true }).click();
  const evidenceCard = page.getByRole('region', { name: 'สถานะขายและงานถัดไป' }).filter({ visible: true });
  await evidenceCard.locator('summary').filter({ hasText: 'รายการที่เกี่ยวข้อง' }).click();
  const response = page.waitForResponse(r => /sales-context\/credit\//.test(r.url()));
  await evidenceCard.getByRole('button', { name: /^ผลตรวจเครดิต/ }).first().click();
  assert.equal((await response).status(), 200);
  await expect(page.getByRole('heading', { name: 'ผลตรวจเครดิตจากหลักฐาน' })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'ผลตรวจเครดิตจากหลักฐาน' }).getByText('20,000 บาท', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await evidenceCard.getByRole('button', { name: 'ไม่ซื้อแล้ว', exact: true }).click();
  const lostDialog = page.getByRole('dialog', { name: 'บันทึกไม่ซื้อแล้ว' });
  await expect(lostDialog.getByRole('button', { name: 'บันทึกเหตุผล' })).toBeDisabled();
  await lostDialog.getByLabel('เหตุผลที่ไม่ซื้อ').selectOption('NOT_INTERESTED');
  await lostDialog.getByRole('button', { name: 'บันทึกเหตุผล' }).click();
  await expect(evidenceCard.getByText('ไม่ซื้อแล้ว · ไม่สนใจ', { exact: true })).toBeVisible();
  await evidenceCard.getByRole('button', { name: 'กลับมาติดตาม', exact: true }).click();
  await page.getByRole('dialog', { name: 'กลับมาติดตามลูกค้า' }).getByRole('button', { name: 'บันทึกกลับมาติดตาม' }).click();
  await expect(evidenceCard.getByRole('button', { name: 'ไม่ซื้อแล้ว', exact: true })).toBeVisible();
  return expectedConsoleErrors;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      await context.routeWebSocket('**/socket.io/**', socket => socket.close());
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await checkChatSales(page, process.env.LOCAL_CHAT_ORIGIN || 'http://localhost:5217', '.tmp/local-preview', width);
      assert.deepEqual(errors, []);
      await context.close();
    }
    console.log('PASS: sales context and original customer-link flow at desktop/mobile');
  } finally { await browser.close(); }
}
