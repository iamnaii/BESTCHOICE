import { showWorkControl, toggleChatTheme } from './chat-ui.mjs';
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
export async function checkChatWork(page, origin, output, width) {
  const info = await (await page.request.get(new URL('/api/admin/preview/info', origin).href)).json();
  assert.equal(info.isolated, true);
  const roomId = info.chatWorkRooms.SHOP;
  const api = path => new URL(`/api/admin/${path}`, origin).href;
  const queue = async company => {
    const data = [];
    for (let index = 1; index <= 100; index++) {
      const r = await page.request.get(api(`staff-chat/work?company=${company}&view=WAITING&page=${index}`));
      assert.equal(r.status(), 200);
      const result = await r.json();
      assert.equal(result.page, index);
      data.push(...result.data);
      if (result.page * result.limit >= result.total) return { ...result, data };
    }
    throw new Error('Queue API exceeded the verification page limit');
  };
  // The persistent local preview accumulates fixtures across checks. Locate
  // the intended record through the real paginator, not only its first page.
  const expectQueuedItem = async name => {
    const dialog = page.getByRole('dialog');
    const item = dialog.getByRole('button', { name });
    for (let pages = 0; pages < 100; pages++) {
      await expect(dialog.locator('[aria-busy]')).toHaveAttribute('aria-busy', 'false');
      if (await item.count()) break;
      const next = dialog.getByRole('button', { name: 'ถัดไป', exact: true });
      if (!await next.count() || await next.isDisabled()) break;
      const position = dialog.getByText(/^หน้า \d+ \/ \d+$/);
      const before = await position.textContent();
      await next.click();
      await expect(position).not.toHaveText(before);
    }
    await expect(item).toBeVisible();
    return item;
  };
  const expectNoQueuedItem = async name => {
    const dialog = page.getByRole('dialog');
    const settled = async () => {
      await expect(dialog.locator('[aria-busy]')).toHaveAttribute('aria-busy', 'false');
      await expect(dialog.getByRole('alert')).toHaveCount(0);
      await expect(dialog.locator('ul').or(dialog.getByText('ไม่มีงานในมุมมองนี้', { exact: true }))).toBeVisible();
    };
    const turnPage = async button => {
      const position = dialog.getByText(/^หน้า \d+ \/ \d+$/);
      const before = await position.textContent();
      await button.click();
      await expect(position).not.toHaveText(before);
      await settled();
    };
    await settled();
    // Positive lookup may have landed on a later page. Absence must cover
    // every page, including the pages before the matching fixture.
    const previous = dialog.getByRole('button', { name: 'ก่อนหน้า', exact: true });
    for (let pages = 0; await previous.count() && await previous.isEnabled(); pages++) {
      assert.ok(pages < 100, 'Queue rewind exceeded the verification page limit');
      await turnPage(previous);
    }
    for (let pages = 0; pages < 100; pages++) {
      await expect(dialog.getByRole('button', { name })).toHaveCount(0);
      const next = dialog.getByRole('button', { name: 'ถัดไป', exact: true });
      if (!await next.count() || await next.isDisabled()) return;
      await turnPage(next);
    }
    throw new Error('Queue UI exceeded the verification page limit');
  };
  await page.request.post(api(`preview/chat-work/${roomId}/inbound`));
  await page.goto(new URL(`/inbox/${roomId}?zone=shop`, origin).href);
  await expect(page.getByRole('textbox', { name: 'พิมพ์ข้อความ', exact: true })).toBeVisible();
  assert.ok((await queue('SHOP')).data.some(item => item.roomId === roomId), 'Reading must leave room waiting');
  await (await showWorkControl(page, 'คิวงาน')).click();
  await expect(page.getByRole('heading', { name: 'คิวงานแชท', exact: true })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: /^รอตอบ/ }).click();
  await expectQueuedItem(/คิวทดลอง SHOP/);
  await expectNoQueuedItem(/คิวทดลอง FINANCE/);
  await page.getByRole('button', { name: /^ถึงฉัน/ }).click();
  await (await expectQueuedItem(/ติดตามลูกค้า SHOP/)).click();
  await expect(page.getByRole('dialog')).toContainText('รายละเอียดงานในห้องแชทนี้');
  await page.keyboard.press('Escape');
  await page.request.post(api(`preview/chat-work/${roomId}/fail-next`));
  if (width < 1024) await page.goto(new URL(`/inbox/${roomId}?zone=shop`, origin).href);
  const input = page.getByRole('textbox', { name: 'พิมพ์ข้อความ', exact: true });
  await input.fill('ข้อความตอบจากพนักงานทดสอบ');
  await page.getByRole('button', { name: 'ส่งข้อความ', exact: true }).click();
  await expect(page.getByText('จำลองการส่งล้มเหลว กรุณาลองใหม่', { exact: false }).first()).toBeVisible();
  assert.ok((await queue('SHOP')).data.some(item => item.roomId === roomId), 'Failed send must remain waiting');
  await page.getByRole('button', { name: /ลองส่งใหม่|ส่งอีกครั้ง|ลองใหม่/ }).first().click();
  await expect.poll(async () => (await queue('SHOP')).data.some(item => item.roomId === roomId)).toBe(false);
  await (await showWorkControl(page, 'คิวงาน')).click();
  await expect(page.getByRole('heading', { name: 'คิวงานแชท', exact: true })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: /^รอตอบ/ }).click();
  await expectNoQueuedItem(/คิวทดลอง SHOP/);
  await page.keyboard.press('Escape');
  await page.goto(new URL('/inbox?zone=fin', origin).href);
  await (await showWorkControl(page, 'คิวงาน')).click();
  await expect(page.getByRole('heading', { name: 'คิวงานแชท', exact: true })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: /^รอตอบ/ }).click();
  await expectQueuedItem(/คิวทดลอง FINANCE/);
  await expectNoQueuedItem(/คิวทดลอง SHOP/);
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
