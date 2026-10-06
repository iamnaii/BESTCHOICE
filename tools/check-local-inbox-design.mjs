import assert from 'node:assert/strict';
import { join } from 'node:path';
import { expect } from '@playwright/test';
import { checkConversationPins } from './check-local-conversation-pins.mjs';

// Visual contract from docs/prototypes/chat-operations V2.4, revised 2026-10-07
// (owner: desktop Inbox is its own workspace — no app sidebar, a 72px rail on the
// left; phones keep the compact header). Feature switches may hide functionality,
// but must not revert the actual production page shell.
export async function checkInboxDesign(browser, origin, output) {
  await checkConversationPins(browser, origin, output);
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
      // The page title is visually hidden inside the desktop rail, so visibility is checked per shell below.
      await expect(page.getByRole('heading', { name: 'ศูนย์การสื่อสาร', exact: true })).toBeAttached();
      await expect(page.getByRole('textbox', { name: 'พิมพ์ข้อความ', exact: true })).toBeVisible();
      if (width >= 1024) {
        // Desktop: no app sidebar at all; the Inbox rail is the only chrome and sits at the left edge.
        assert.equal(await page.getByRole('button', { name: 'ขยายเมนู', exact: true }).count(), 0, 'App sidebar must not render on the desktop Inbox');
        assert.equal(await page.getByRole('button', { name: 'ย่อเมนู', exact: true }).count(), 0, 'App sidebar must not render on the desktop Inbox');
        assert.equal(await page.locator('.inbox-workspace-header').count(), 0, 'Desktop Inbox has no top header');
        await expect(page.locator('.wrapper')).toHaveCSS('padding-left', '0px');
        const rail = page.locator('.inbox-rail');
        const railBox = await rail.boundingBox();
        const queue = await page.locator('.inbox-conversations').boundingBox();
        assert.equal(railBox.x, 0);
        assert.equal(railBox.width, 72);
        assert.ok(railBox.height >= height - 1, 'Rail spans the full viewport height');
        assert.equal(queue.x, railBox.x + railBox.width, 'Rail must not cover the conversation list');
        assert.equal(queue.width, 288);
        const railOverflow = await rail.evaluate((e) => e.scrollHeight - e.clientHeight);
        assert.ok(railOverflow <= 0, `Rail content overflows by ${railOverflow}px at ${width}x${height}`);
        await expect(rail.getByRole('link', { name: 'กลับหน้าหลัก', exact: true })).toBeVisible();
        await expect(rail.getByRole('navigation', { name: 'การสื่อสารและงานทีม' })).toBeVisible();
        await expect(rail.getByRole('button', { name: 'แชทลูกค้า', exact: true })).toBeVisible();
        await expect(rail.getByRole('button', { name: 'คิวงาน', exact: true })).toBeDisabled();
        await expect(rail.getByRole('link', { name: 'ภาพรวมงานแชท', exact: true })).toBeVisible();
        await expect(rail.getByRole('button', { name: 'สลับธีม', exact: true })).toBeVisible();
        await expect(rail.getByRole('button', { name: 'ออกจากระบบ', exact: true })).toBeVisible();
        for (const control of await rail.getByRole('button').all()) {
          const box = await control.boundingBox();
          assert.ok(box && box.height >= 44 && box.width >= 44, 'Rail controls need touch-sized targets');
        }
        await expect(page.getByRole('heading', { name: 'กล่องข้อความ', exact: true })).toBeVisible();
      } else {
        await expect(page.getByRole('heading', { name: 'ศูนย์การสื่อสาร', exact: true })).toBeVisible();
        assert.equal(await page.locator('.inbox-rail').count(), 0, 'Phones keep the compact header, not the rail');
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
        // Dark mode must keep the rail readable and within the viewport too.
        const rail = page.locator('.inbox-rail');
        const railOverflow = await rail.evaluate((e) => e.scrollHeight - e.clientHeight);
        assert.ok(railOverflow <= 0, `Rail content overflows by ${railOverflow}px in dark mode`);
        await rail.screenshot({ path: join(output, `inbox-rail-dark-${width}${largeText ? '-large-text' : ''}.png`) });
        await page.getByRole('button', { name: 'สลับธีม', exact: true }).click();
        await expect(page.locator('html')).not.toHaveClass(/dark/);
        await rail.screenshot({ path: join(output, `inbox-rail-${width}${largeText ? '-large-text' : ''}.png`) });
        await page.screenshot({ path: join(output, `inbox-rail-workspace-${width}${largeText ? '-large-text' : ''}.png`) });
      } else {
        const navigation = page.getByRole('navigation', { name: 'การสื่อสารและงานทีม' });
        await expect(navigation).toBeVisible();
        const analytics = navigation.getByRole('link', { name: 'ภาพรวมงานแชท' });
        await analytics.focus();
        await expect(analytics).toBeInViewport();
        const link = await analytics.boundingBox();
        assert.ok(link.height >= 44, 'Navigation needs touch-sized targets');
      }
      assert.deepEqual(errors, []);
    } finally { await context.unrouteAll({ behavior: 'wait' }); await context.close(); }
  }
}
