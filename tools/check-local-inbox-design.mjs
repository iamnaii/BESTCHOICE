import assert from 'node:assert/strict';
import { join } from 'node:path';
import { expect } from '@playwright/test';

// Visual contract from docs/prototypes/chat-operations V2.4. Feature switches
// may hide functionality, but must not revert the actual production page shell.
export async function checkInboxDesign(browser, origin, output) {
  const info = await (await fetch(new URL('/api/admin/preview/info', origin))).json();
  assert.equal(info.isolated, true);
  const response = await fetch(new URL('/api/admin/preview/fixture', origin), { method: 'POST' });
  assert.equal(response.status, 201);
  const { roomId } = await response.json();
  for (const { width, height, largeText } of [1512, 1280, 1024, 390, 320].map(width => ({ width, height: 930, largeText: false })).concat([{ width: 375, height: 667, largeText: false }, { width: 844, height: 390, largeText: false }, { width: 1280, height: 930, largeText: true }])) {
    const context = await browser.newContext({ viewport: { width, height }, ...(height < 500 ? { reducedMotion: 'reduce' } : {}) });
    await context.routeWebSocket('**/socket.io/**', s => s.close());
    // The live screenshot had feature switches off. Exercise that same shell.
    await context.route('**/staff-chat/work-settings?*', async route => {
      const response = await route.fetch();
      const data = await response.json();
      await route.fulfill({ response, json: { ...data, flags: Object.fromEntries(Object.keys(data.flags ?? {}).map(key => [key, false])) } });
    });
    try {
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(new URL(`/inbox/${roomId}`, origin).href);
      if (largeText) await page.addStyleTag({ content: 'html { font-size:20px !important; }' });
      await expect(page.getByRole('heading', { name: 'แชทลูกค้า', exact: true })).toBeVisible();
      await expect(page.getByRole('textbox', { name: 'พิมพ์ข้อความ', exact: true })).toBeVisible();
      if (width >= 1024) {
        const expand = page.getByRole('button', { name: 'ขยายเมนู', exact: true });
        if (await expand.isVisible()) await expand.click();
        await expect(page.locator('.wrapper')).toHaveCSS('padding-left', '188px');
        const sidebar = await page.locator('[data-inbox-sidebar]').boundingBox();
        const header = await page.locator('.inbox-workspace-header').boundingBox();
        const queue = await page.locator('.inbox-conversations').boundingBox();
        assert.equal(sidebar.width, 188);
        assert.equal(header.x, sidebar.x + sidebar.width, 'Sidebar must not cover title or conversation list');
        assert.equal(queue.width, 288);
        await expect(page.locator('[data-inbox-sidebar]').getByRole('button', { name: 'คิวงาน', exact: true })).toBeDisabled();
        await expect(page.getByRole('heading', { name: 'กล่องข้อความ', exact: true })).toBeVisible();
      }
      if (width >= 1280) {
        await expect(page.getByRole('heading', { name: 'ข้อมูลและการดำเนินงาน', exact: true })).toBeVisible();
        const dossier = await page.locator('.inbox-dossier').boundingBox();
        assert.equal(dossier.width, 330);
        assert.ok(Math.abs(dossier.x + dossier.width - width) <= 1);
      }
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      assert.ok(overflow <= 1, `Horizontal overflow at ${width}px: ${overflow}`);
      const modes = await page.getByRole('radiogroup', { name: 'โหมดช่องพิมพ์' }).boundingBox();
      const card = await page.locator('[data-chat-composer-card]').boundingBox();
      assert.ok(modes.y + modes.height <= card.y, 'Mode buttons must not overlap composer border');
      const send = await page.getByRole('button', { name: 'ส่งข้อความ', exact: true }).boundingBox();
      assert.ok(send.y + send.height <= height - 50 || width >= 1024, 'Send is hidden under mobile bottom bar');
      await expect(page.getByRole('log', { name: 'ประวัติข้อความ' })).toBeVisible();
      await page.screenshot({ path: join(output, `inbox-design-light-${width}${largeText ? '-large-text' : ''}.png`) });
      await page.getByRole('radio', { name: 'โน้ตภายใน', exact: true }).click();
      await expect(page.getByRole('textbox', { name: 'พิมพ์โน้ตภายใน', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'สลับธีม', exact: true }).click();
      await expect(page.locator('html')).toHaveClass(/dark/);
      await page.screenshot({ path: join(output, `inbox-design-dark-note-${width}${largeText ? '-large-text' : ''}.png`) });
      if (width >= 1024) {
        await page.getByRole('button', { name: 'ย่อเมนู', exact: true }).click();
        await expect(page.locator('.wrapper')).toHaveCSS('padding-left', '70px');
        assert.equal(await page.locator('[data-inbox-sidebar]').count(), 0);
        await expect(page.getByRole('button', { name: 'คิวงาน', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'คิวงาน', exact: true })).toBeDisabled();
      }
      assert.deepEqual(errors, []);
    } finally { await context.unrouteAll({ behavior: 'wait' }); await context.close(); }
  }
}
