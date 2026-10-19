import assert from 'node:assert/strict';
import { join } from 'node:path';
import { expect } from '@playwright/test';
import { openComposerTool } from './chat-ui.mjs';

export async function checkInboxSearch(browser, origin, output) {
  const info = await (await fetch(new URL('/api/admin/preview/info', origin))).json();
  assert.equal(info.isolated, true);
  const fixture = await (await fetch(new URL('/api/admin/preview/message-search-fixture', origin), { method: 'POST' })).json();
  assert.ok(fixture.messageId);
  for (const width of [390, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 930 } });
    await context.routeWebSocket('**/socket.io/**', socket => socket.close());
    await context.addInitScript(() => {
      window.voiceInstances = [];
      window.SpeechRecognition = class {
        constructor() { window.voiceInstances.push(this); }
        start() { this.onstart?.(); }
        stop() { this.onend?.(); }
        abort() { this.aborted = true; }
      };
    });
    try {
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => {
        if (message.type() === 'error' && message.text().includes('Encountered two children with the same key')) errors.push(message.text());
      });
      await page.goto(new URL('/inbox?zone=shop', origin).href);
      const search = page.getByRole('textbox', { name: 'ค้นหาชื่อ เบอร์โทร หรือข้อความในแชท' });
      await search.fill(fixture.key);
      await expect(search).toHaveCSS('outline-style', 'none');
      await expect(page.locator('.inbox-queue-search')).toHaveCSS('outline-width', '2px');
      const row = page.locator('.inbox-room-item').filter({ hasText: fixture.key });
      await expect(row).toHaveCount(1);
      await expect(search).toBeFocused();
      await search.pressSequentially('ไม่พบ');
      await expect(page.getByText(/ไม่พบผลการค้นหา/)).toBeVisible();
      await expect(search).toBeFocused();
      await search.fill(fixture.key);
      await expect(row).toHaveCount(1);
      await expect(search).toBeFocused();
      await expect(row.locator('mark')).toHaveText(fixture.key);
      await expect(row).toContainText('พบในข้อความ');
      await page.screenshot({ path: join(output, `inbox-search-results-${width}.png`) });
      const response = page.waitForResponse(response => response.url().includes(`around=${fixture.messageId}`));
      await row.click();
      assert.equal((await response).status(), 200);
      const hit = page.locator(`[data-message-id="${fixture.messageId}"]`);
      await expect(hit).toBeInViewport();
      await expect(hit).toContainText(fixture.text);
      await expect(page.getByRole('button', { name: 'กลับข้อความล่าสุด', exact: true })).toBeVisible();
      await expect(page.getByRole('textbox', { name: 'พิมพ์ข้อความ', exact: true })).toBeHidden();
      await page.screenshot({ path: join(output, `inbox-search-history-${width}.png`) });
      await page.getByRole('button', { name: 'กลับข้อความล่าสุด', exact: true }).click();
      await expect(page.getByRole('textbox', { name: 'พิมพ์ข้อความ', exact: true })).toBeVisible();
      await expect(page.getByRole('log')).toContainText('บทสนทนาต่อมา 150');
      await expect(hit).toHaveCount(0);
      // Search within the selected room also reaches messages older than the loaded window.
      await page.getByRole('button', { name: 'ค้นหาในแชท', exact: true }).click();
      const roomSearch = page.getByRole('dialog', { name: 'ค้นหาในแชท' });
      await roomSearch.getByRole('textbox', { name: 'ข้อความที่ต้องการค้นหา' }).fill(fixture.key);
      await expect(roomSearch.getByText('พบ 1 ข้อความ')).toBeVisible();
      await page.screenshot({ path: join(output, `inbox-room-search-${width}.png`) });
      await roomSearch.getByRole('button').filter({ hasText: fixture.key }).click();
      await expect(roomSearch).toBeHidden();
      await expect(hit).toBeInViewport();
      await expect(page.getByRole('textbox', { name: 'พิมพ์ข้อความ', exact: true })).toBeHidden();
      await page.getByRole('button', { name: 'กลับข้อความล่าสุด', exact: true }).click();
      await expect(page.getByRole('log')).toContainText('บทสนทนาต่อมา 150');
      await expect(hit).toHaveCount(0);
      await page.getByRole('button', { name: 'ค้นหาในแชท', exact: true }).click();
      await expect(roomSearch.getByRole('textbox')).toHaveValue(fixture.key);
      await roomSearch.getByRole('button', { name: 'ปิด', exact: true }).click();
      await expect(roomSearch).toBeHidden();
      // Returning to the same hit after a failed context read must offer retry, never silently show latest history.
      if (width === 1440) {
        const input = page.getByRole('textbox', { name: 'พิมพ์ข้อความ', exact: true });
        const draft = 'ร่างบรรทัดที่หนึ่ง\nร่างบรรทัดที่สอง\nร่างบรรทัดที่สาม\nยังไม่ส่ง';
        await input.fill(draft);
        const draftHeight = (await input.boundingBox()).height;
        await openComposerTool(page, 'พูดเป็นข้อความ');
        await expect(page.getByRole('button', { name: 'หยุดรับเสียง', exact: true })).toBeVisible();
        await row.click();
        await expect(hit).toBeInViewport();
        await expect.poll(() => page.evaluate(() => window.voiceInstances.at(-1)?.aborted)).toBe(true);
        await page.getByRole('button', { name: 'กลับข้อความล่าสุด', exact: true }).click();
        await expect(input).toHaveValue(draft);
        assert.ok(Math.abs((await input.boundingBox()).height - draftHeight) <= 1, 'Multi-line draft height restored after search history');
        await context.route(url => url.searchParams.has('around'), route => route.fulfill({ status: 404, json: { message: 'ไม่พบข้อความ' } }));
        // Invalidate context by opening a new page so there is no previously successful cached result.
        await page.reload();
        await search.fill(fixture.key);
        await row.click();
        await expect(page.getByText('เปิดข้อความไม่สำเร็จ อาจถูกลบหรือไม่มีสิทธิ์เข้าถึง')).toBeVisible();
        await context.unrouteAll({ behavior: 'wait' });
        await page.getByRole('button', { name: 'ลองอีกครั้ง', exact: true }).click();
        await expect(hit).toBeInViewport();
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0);
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  }
}
