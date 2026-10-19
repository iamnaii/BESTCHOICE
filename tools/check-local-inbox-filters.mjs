import assert from 'node:assert/strict';
import { join } from 'node:path';
import { expect } from '@playwright/test';
import { toggleChatTheme } from './chat-ui.mjs';

// Exercise the production Inbox against synthetic responses, including filters
// that match no rooms. No read/pin/message request reaches a live provider.
export async function checkInboxFilters(browser, origin, output) {
  const info = await (await fetch(new URL('/api/admin/preview/info', origin))).json();
  assert.equal(info.isolated, true);
  for (const { width, height = 930, largeText } of [
    { width: 320 }, { width: 390 }, { width: 1024 }, { width: 1440 },
    { width: 390, largeText: true }, { width: 1280, largeText: true },
    { width: 375, height: 667 },
  ]) {
    const context = await browser.newContext({ viewport: { width, height } });
    const requests = [];
    const readBodies = [];
    const now = new Date().toISOString();
    const rooms = [
      { id: 'filter-facebook', displayName: 'ลูกค้าตัวอย่าง Facebook', channel: 'FACEBOOK', unreadCount: 2 },
      { id: 'filter-line', displayName: 'ลูกค้าตัวอย่าง LINE', channel: 'LINE_SHOP', unreadCount: 0 },
    ].map(room => ({ ...room, priority: 'NORMAL', lastMessageAt: now, lastCustomerAt: now, waitingSince: now, totalMessages: 1,
      messages: [{ text: 'ขอรายละเอียดสินค้าหน่อยค่ะ', role: 'CUSTOMER', createdAt: now }] }));
    await context.routeWebSocket('**/socket.io/**', socket => socket.close());
    await context.route('**/staff-chat/rooms?*', route => {
      const params = new URL(route.request().url()).searchParams;
      requests.push(Object.fromEntries(params));
      const eligibleRooms = params.get('assignedToId') === 'filter-owner' ? rooms.slice(0, 1) : rooms;
      const data = params.get('search') ? [] : params.get('channels') ? eligibleRooms.filter(room => room.channel === params.get('channels')) : eligibleRooms;
      return route.fulfill({ json: { page: 1, limit: 50, total: data.length, data } });
    });
    await context.route('**/staff-chat/rooms/counts?*', route => route.fulfill({ json: { all: 11848, mine: 1, waiting: 41, expired: 582, byChannel: { FACEBOOK: 12, LINE_SHOP: 24, LINE_FINANCE: 3, TIKTOK: 1, WEB: 1 } } }));
    await context.route(url => url.pathname.endsWith('/staff-chat/staff/online'), route => route.fulfill({ json: [{ id: 'filter-owner', name: 'ผู้ดูแลตัวอย่างชื่อยาวสำหรับตรวจการจัดวาง' }] }));
    await context.route(url => url.pathname.endsWith('/staff-chat/rooms/read-all'), route => {
      readBodies.push(route.request().postDataJSON());
      return route.fulfill({ json: { count: 1 } });
    });
    try {
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(new URL('/inbox?zone=shop', origin).href);
      if (largeText) await page.addStyleTag({ content: 'html { font-size:20px !important; }' });
      await expect(page.getByRole('button', { name: 'รอตอบ 41 ห้อง' })).toBeVisible();
      const queue = page.locator('.inbox-queue');
      const filter = page.getByRole('button', { name: 'ตัวกรองแชท', exact: true });
      await expect(queue.getByRole('heading', { name: 'กล่องข้อความ' })).toBeVisible();
      for (const dark of [false, true]) {
        if (dark) {
          await toggleChatTheme(page);
          await expect(page.getByRole('dialog')).toHaveCount(0);
        }
        const searchInput = queue.getByRole('textbox', { name: 'ค้นหาชื่อ เบอร์โทร หรือข้อความในแชท' });
        await searchInput.click();
        await expect(searchInput).toHaveCSS('outline-style', 'none');
        await expect(searchInput).toHaveCSS('box-shadow', 'none');
        await expect(queue.locator('.inbox-queue-search')).toHaveCSS('outline-width', '2px');
        await page.keyboard.press('Shift+Tab');
        await page.keyboard.press('Tab');
        await expect(searchInput).toBeFocused();
        await expect(searchInput).toHaveCSS('outline-style', 'none');
        const metrics = await queue.evaluate(async element => {
          await document.fonts.ready;
          const controls = [...element.querySelectorAll('.inbox-queue-icon,.inbox-queue-tabs > button')];
          const search = element.querySelector('.inbox-queue-search').getBoundingClientRect();
          return {
            overflow: element.scrollWidth - element.clientWidth,
            controls: controls.map(control => ({ width: control.getBoundingClientRect().width, height: control.getBoundingClientRect().height, clipped: control.scrollWidth > control.clientWidth + 1 })),
            searchHeight: search.height,
          };
        });
        assert.ok(metrics.overflow <= 1, `Queue overflow at ${width}px: ${JSON.stringify(metrics)}`);
        for (const control of metrics.controls) {
          assert.ok(control.width >= 44 && control.height >= 44 && !control.clipped, `Unusable queue control: ${JSON.stringify(control)}`);
        }
        assert.ok(Math.abs(metrics.searchHeight - metrics.controls[0].height) <= 1, 'Search and adjacent icon controls share their height');
        await page.screenshot({ path: join(output, `inbox-filters-${width}${largeText ? '-large-text' : ''}-${dark ? 'dark' : 'light'}.png`) });
        await filter.click();
        const dialog = page.getByRole('dialog', { name: 'ตัวกรองแชท', exact: true });
        await expect(dialog).toBeVisible();
        await page.getByRole('radio', { name: /LINE ร้าน/ }).check();
        const requestCount = requests.length;
        await page.keyboard.press('Escape');
        await expect(filter).toBeFocused();
        assert.equal(requests.length, requestCount, 'Dismiss does not apply a draft');
        await filter.click();
        await expect(page.getByRole('radio', { name: /ทั้งหมด/ })).toBeChecked();
        await expect(dialog).toHaveCSS('opacity', '1');
        await expect(dialog.getByRole('button', { name: 'แสดงแชท' })).toBeInViewport();
        const bounds = await dialog.boundingBox();
        assert.ok(bounds.x >= -1 && bounds.x + bounds.width <= width + 1 && bounds.y >= 0 && bounds.y + bounds.height <= height + 1);
        await page.screenshot({ path: join(output, `inbox-filter-dialog-${width}${largeText ? '-large-text' : ''}-${dark ? 'dark' : 'light'}.png`) });
        await page.getByRole('radio', { name: /LINE ร้าน/ }).check();
        await page.getByRole('button', { name: 'แสดงแชท', exact: true }).click();
        await expect(queue.locator('.inbox-room-item')).toHaveCount(1);
        await expect(queue.locator('.inbox-room-item')).toContainText('ลูกค้าตัวอย่าง LINE');
        assert.ok(requests.some(request => request.channels === 'LINE_SHOP'), 'LINE filter reaches the API and can reuse its cached result');
        await expect(page.getByRole('button', { name: 'รอตอบ 41 ห้อง' })).toBeVisible();
        await page.getByRole('button', { name: 'ล้างตัวกรอง LINE ร้าน', exact: true }).click();
        await expect(queue.locator('.inbox-room-item')).toHaveCount(2);
      }
      await filter.click();
      await page.getByRole('combobox', { name: 'ผู้ดูแล', exact: true }).click();
      await page.getByRole('option', { name: 'ผู้ดูแลตัวอย่างชื่อยาวสำหรับตรวจการจัดวาง', exact: true }).click();
      await page.getByRole('button', { name: 'แสดงแชท', exact: true }).click();
      await expect.poll(() => requests.at(-1)?.assignedToId).toBe('filter-owner');
      await expect(queue.locator('.inbox-room-item')).toHaveCount(1);
      const ownerChip = page.getByRole('button', { name: 'ล้างตัวกรอง ผู้ดูแลตัวอย่างชื่อยาวสำหรับตรวจการจัดวาง', exact: true });
      await expect(ownerChip).toBeVisible();
      assert.ok(await queue.evaluate(element => element.scrollWidth - element.clientWidth <= 1), 'Long owner chips must fit the queue');
      await ownerChip.click();
      // Returning to an unfiltered query may reuse fresh cache without a request.
      await expect(ownerChip).toBeHidden();
      await expect(queue.locator('.inbox-room-item')).toHaveCount(2);
      await page.getByRole('button', { name: 'ของฉัน 1 ห้อง' }).click();
      await filter.click();
      await expect(page.getByRole('combobox', { name: 'ผู้ดูแล', exact: true })).toBeDisabled();
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'รอตอบ 41 ห้อง' }).click();
      await page.getByRole('button', { name: 'พ้นเวลาตอบ 582' }).click();
      await expect(page.getByText(/ห้อง Facebook ที่พ้นเวลาตอบหรือยังไม่ทราบเวลา/)).toBeVisible();
      await expect.poll(() => requests.at(-1)?.expired).toBe('true');
      await page.getByRole('button', { name: 'กลับคิว', exact: true }).click();
      const search = page.getByRole('textbox', { name: 'ค้นหาชื่อ เบอร์โทร หรือข้อความในแชท' });
      await search.fill('ไม่มีผลลัพธ์');
      await expect(page.getByText(/ไม่พบผลการค้นหา/)).toBeVisible();
      await expect(page.getByText('ยังไม่มีการสนทนา', { exact: true })).toBeHidden();
      await queue.getByRole('button', { name: 'ล้างการค้นหา', exact: true }).first().click();
      await expect(queue.locator('.inbox-room-item')).toHaveCount(2);
      await page.getByRole('button', { name: 'เครื่องมือกล่องข้อความ' }).click();
      await page.getByRole('menuitem', { name: 'ทำเครื่องหมายว่าอ่านแล้ว' }).click();
      await expect.poll(() => readBodies).toEqual([{ roomIds: ['filter-facebook'] }]);
      assert.deepEqual(errors, []);
    } finally { await context.unrouteAll({ behavior: 'wait' }); await context.close(); }
  }
}
