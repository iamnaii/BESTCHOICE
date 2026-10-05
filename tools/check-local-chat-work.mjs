import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
export async function checkChatWork(page, origin, output, width) {
  const info = await (await page.request.get(new URL('/api/admin/preview/info', origin).href)).json();
  assert.equal(info.isolated, true);
  const roomId = info.chatWorkRooms.SHOP;
  const api = path => new URL(`/api/admin/${path}`, origin).href;
  const queue = async company => { const r = await page.request.get(api(`staff-chat/work?company=${company}&view=WAITING`)); assert.equal(r.status(), 200); return r.json(); };
  await page.request.post(api(`preview/chat-work/${roomId}/inbound`));
  await page.goto(new URL(`/inbox/${roomId}?zone=shop`, origin).href);
  await expect(page.getByRole('textbox', { name: 'พิมพ์ข้อความ', exact: true })).toBeVisible();
  assert.ok((await queue('SHOP')).data.some(item => item.roomId === roomId), 'Reading must leave room waiting');
  await page.getByRole('button', { name: 'คิวงาน', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'คิวงานแชท', exact: true })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: /^รอตอบ/ }).click();
  await expect(page.getByRole('dialog').getByRole('button', { name: /คิวทดลอง SHOP/ })).toBeVisible();
  await expect(page.getByRole('dialog').getByRole('button', { name: /คิวทดลอง FINANCE/ })).toHaveCount(0);
  await page.getByRole('button', { name: /^ถึงฉัน/ }).click();
  await page.getByRole('button', { name: /ติดตามลูกค้า SHOP/ }).click();
  await expect(page.getByRole('dialog')).toContainText('รายละเอียดงานในห้องแชทนี้');
  await page.keyboard.press('Escape');
  await page.request.post(api(`preview/chat-work/${roomId}/fail-next`));
  const input = page.getByRole('textbox', { name: 'พิมพ์ข้อความ', exact: true });
  await input.fill('ข้อความตอบจากพนักงานทดสอบ');
  await page.getByRole('button', { name: 'ส่งข้อความ', exact: true }).click();
  await expect(page.getByText('จำลองการส่งล้มเหลว กรุณาลองใหม่', { exact: false }).first()).toBeVisible();
  assert.ok((await queue('SHOP')).data.some(item => item.roomId === roomId), 'Failed send must remain waiting');
  await page.getByRole('button', { name: /ลองส่งใหม่|ส่งอีกครั้ง|ลองใหม่/ }).first().click();
  await expect.poll(async () => (await queue('SHOP')).data.some(item => item.roomId === roomId)).toBe(false);
  await page.getByRole('button', { name: 'คิวงาน', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'คิวงานแชท', exact: true })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: /^รอตอบ/ }).click();
  await expect(page.getByRole('dialog').getByRole('button', { name: /คิวทดลอง SHOP/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.goto(new URL('/inbox?zone=fin', origin).href);
  await page.getByRole('button', { name: 'คิวงาน', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'คิวงานแชท', exact: true })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: /^รอตอบ/ }).click();
  await expect(page.getByRole('dialog').getByRole('button', { name: /คิวทดลอง FINANCE/ })).toBeVisible();
  await expect(page.getByRole('dialog').getByRole('button', { name: /คิวทดลอง SHOP/ })).toHaveCount(0);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Work queue overflow');
  await expect.poll(async () => (await page.getByRole('dialog').boundingBox())?.x).toBe(0);
  await page.screenshot({ path: join(output, `chat-work-${width}.png`), animations: 'disabled' });
  await page.keyboard.press('Escape');
  await page.goto(new URL('/inbox?zone=shop', origin).href);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      await context.routeWebSocket('**/socket.io/**', socket => socket.close());
      const page = await context.newPage();
      await checkChatWork(page, process.env.LOCAL_CHAT_ORIGIN || 'http://localhost:5217', '.tmp/local-preview', width);
      await context.close();
    }
    console.log('PASS: scoped queue, exact task target, read/fail/success cycle at desktop and mobile');
  } finally { await browser.close(); }
}
