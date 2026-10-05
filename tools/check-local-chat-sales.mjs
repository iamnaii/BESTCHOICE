import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
export async function checkChatSales(page, origin, output, width) {
  const info = await (await page.request.get(new URL('/api/admin/preview/info', origin).href)).json();
  assert.equal(info.isolated, true);
  const roomId = info.chatWorkRooms.SHOP;
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
