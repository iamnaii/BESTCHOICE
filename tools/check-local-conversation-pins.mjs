import assert from 'node:assert/strict';
import { join } from 'node:path';
import { expect } from '@playwright/test';

// Render the real list with synthetic responses reproducing unread + pin + status.
export async function checkConversationPins(browser, origin, output) {
  const info = await (await fetch(new URL('/api/admin/preview/info', origin))).json();
  assert.equal(info.isolated, true);
  for (const width of [1512, 1024, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 930 }, hasTouch: width < 1024 });
    await context.routeWebSocket('**/socket.io/**', socket => socket.close());
    const pinned = [false, true];
    let pinCalls = 0;
    const now = new Date().toISOString();
    await context.route('**/staff-chat/rooms?*', route => route.fulfill({ json: {
      page: 1, limit: 50, total: 2,
      data: pinned.map((isPinned, index) => ({
        id: `pin-layout-${index}`, channel: 'FACEBOOK', priority: 'HIGH',
        displayName: `ลูกค้าทดสอบปักหมุด ${index + 1} ชื่อยาวสำหรับรายการแชท`,
        pinnedAt: isPinned ? now : null, unreadCount: index ? 128 : 29,
        lastMessageAt: now, lastCustomerAt: now, waitingSince: now, totalMessages: 128,
        assignedTo: { id: 'owner', name: 'พนักงานทดสอบชื่อยาว' },
        messages: [{ text: 'สอบถามสินค้าพร้อมข้อความยาวที่ต้องตัดให้พอดี', role: 'CUSTOMER', createdAt: now }],
      })),
    } }));
    await context.route(url => /\/staff-chat\/rooms\/pin-layout-\d\/pin$/.test(url.pathname), route => {
      const index = Number(new URL(route.request().url()).pathname.match(/pin-layout-(\d)/)[1]);
      pinned[index] = route.request().method() === 'POST';
      pinCalls++;
      return route.fulfill({ json: { success: true } });
    });
    try {
      const page = await context.newPage();
      await page.goto(new URL('/inbox?zone=shop', origin).href);
      const row = page.locator('.inbox-room-item').filter({ hasText: 'ลูกค้าทดสอบปักหมุด 1' });
      await expect(row).toBeVisible();
      const initialUrl = page.url();
      for (const dark of [false, true]) {
        if (dark) await page.getByRole('button', { name: 'สลับธีม', exact: true }).click();
        for (const item of await page.locator('.inbox-room-item').all()) {
          const pin = item.getByRole('button', { name: /^(ปักหมุด|ถอดหมุด)$/ });
          await item.hover();
          await pin.focus();
          await expect(pin).toHaveCSS('opacity', '1');
          const bounds = await pin.boundingBox();
          assert.ok(bounds.width >= 44 && bounds.height >= 44, 'Pin must remain touch-sized');
          for (const selector of ['.inbox-room-preview', '.inbox-room-meta']) {
            const content = await item.locator(selector).boundingBox();
            const overlaps = bounds.x < content.x + content.width && bounds.x + bounds.width > content.x && bounds.y < content.y + content.height && bounds.y + bounds.height > content.y;
            assert.equal(overlaps, false, `Pin covers ${selector} at ${width}px`);
          }
        }
        await expect(row.getByText('29', { exact: true })).toBeVisible();
        await expect(page.getByText('99+', { exact: true })).toBeVisible();
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        await page.screenshot({ path: join(output, `conversation-pin-${width}-${dark ? 'dark' : 'light'}.png`) });
      }
      // Native Enter/Space must pin/unpin without selecting the room.
      const pin = row.getByRole('button', { name: 'ปักหมุด', exact: true });
      await pin.focus();
      await page.keyboard.press('Enter');
      await expect(row.getByRole('button', { name: 'ถอดหมุด', exact: true })).toBeVisible();
      assert.equal(pinCalls, 1);
      assert.equal(page.url(), initialUrl);
      await page.keyboard.press('Space');
      await expect(row.getByRole('button', { name: 'ปักหมุด', exact: true })).toBeVisible();
      assert.equal(pinCalls, 2);
      assert.equal(page.url(), initialUrl);
      await row.getByRole('button', { name: 'ปักหมุด', exact: true }).click();
      await expect(row.getByRole('button', { name: 'ถอดหมุด', exact: true })).toBeVisible();
      await row.getByRole('button', { name: 'ถอดหมุด', exact: true }).click();
      await expect(row.getByRole('button', { name: 'ปักหมุด', exact: true })).toBeVisible();
      assert.equal(pinCalls, 4);
      assert.equal(page.url(), initialUrl);
    } finally { await context.unrouteAll({ behavior: 'wait' }); await context.close(); }
  }
}
