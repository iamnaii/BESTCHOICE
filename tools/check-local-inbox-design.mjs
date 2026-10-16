import { chooseComposerMode, openComposerTool, showWorkControl, toggleChatTheme } from './chat-ui.mjs';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { expect } from '@playwright/test';
import { checkConversationPins } from './check-local-conversation-pins.mjs';

// Visual contract from docs/prototypes/chat-operations V2.4, revised 2026-10-07
// (owner: desktop Inbox is its own workspace — no app sidebar, a compact rail on the
// left; phones keep the compact header). Feature switches may hide functionality,
// but must not revert the actual production page shell.
export async function checkInboxNavigationScale(navigation) {
  const items = await navigation.evaluate(async element => {
    await document.fonts.ready;
    return [...element.children].map(control => {
      const label = control.querySelector('span:not(.inbox-navigation-count)');
      const icon = control.querySelector('svg');
      const box = control.getBoundingClientRect();
      const text = label.getBoundingClientRect();
      const style = getComputedStyle(label);
      return {
        label: label.textContent,
        font: style.fontFamily,
        size: parseFloat(style.fontSize),
        expectedSize: parseFloat(getComputedStyle(document.documentElement).fontSize) * .875,
        lineHeight: parseFloat(style.lineHeight),
        width: box.width,
        height: box.height,
        leftInset: text.left - box.left,
        rightInset: box.right - text.right,
        iconWidth: icon.getBoundingClientRect().width,
        iconHeight: icon.getBoundingClientRect().height,
      };
    });
  });
  assert.ok(items.length >= 3, 'Navigation includes chat, queue and analytics');
  for (const item of items) {
    assert.match(item.font, /Noto Sans Thai Looped/, `${item.label}: UI font`);
    assert.equal(item.size, item.expectedSize, `${item.label}: button and link labels share the same scale`);
    assert.equal(item.lineHeight, item.size * 1.5, `${item.label}: Thai line height`);
    assert.ok(item.leftInset >= 3.9 && item.rightInset >= 3.9, `${item.label}: needs space on both sides`);
    assert.equal(item.iconWidth, 18, `${item.label}: primary icon width`);
    assert.equal(item.iconHeight, 18, `${item.label}: primary icon height`);
    assert.ok(item.width >= 44 && item.height >= 44, `${item.label}: usable target size`);
    assert.ok(Math.abs(item.height - items[0].height) < .5, `${item.label}: button and link rows have equal height`);
  }
  return items;
}

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
      if (width >= 1024) await expect(page.getByRole('heading', { name: 'ศูนย์การสื่อสาร', exact: true })).toBeAttached();
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
        assert.equal(railBox.width, largeText ? 110 : 88);
        assert.ok(railBox.height >= height - 1, 'Rail spans the full viewport height');
        assert.equal(queue.x, railBox.x + railBox.width, 'Rail must not cover the conversation list');
        assert.equal(queue.width, 288);
        const railOverflow = await rail.evaluate((e) => e.scrollHeight - e.clientHeight);
        assert.ok(railOverflow <= 0, `Rail content overflows by ${railOverflow}px at ${width}x${height}`);
        await expect(rail.getByRole('link', { name: 'กลับหน้าหลัก', exact: true })).toBeVisible();
        await expect(rail.getByRole('navigation', { name: 'การสื่อสารและงานทีม' })).toBeVisible();
        await checkInboxNavigationScale(rail.locator('.inbox-work-navigation'));
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
        await expect(page.locator('.inbox-workspace-header')).toBeHidden();
        await expect(page.getByRole('button', { name: 'กลับ', exact: true })).toBeVisible();
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
      const modes = await (width < 1024 ? page.getByRole('button', { name: 'เลือกโหมดช่องพิมพ์', exact: true }) : page.getByRole('radiogroup', { name: 'โหมดช่องพิมพ์' })).boundingBox();
      const card = await page.locator('[data-chat-composer-card]').boundingBox();
      assert.ok(modes.y + modes.height <= card.y, 'Mode buttons must not overlap composer border');
      await page.getByRole('textbox', { name: 'พิมพ์ข้อความ', exact: true }).fill('ตรวจสเกล');
      const send = await page.getByRole('button', { name: 'ส่งข้อความ', exact: true }).boundingBox();
      assert.ok(send.y + send.height <= height || width >= 1024, 'Send is outside viewport');
      await expect(page.getByRole('log', { name: 'ประวัติข้อความ' })).toBeVisible();
      await page.screenshot({ path: join(output, `inbox-design-light-${width}${largeText ? '-large-text' : ''}.png`) });
      await chooseComposerMode(page, 'note');
      await expect(page.getByRole('textbox', { name: 'พิมพ์โน้ตภายใน', exact: true })).toBeVisible();
      await toggleChatTheme(page);
      await expect(page.locator('html')).toHaveClass(/dark/);
      await page.screenshot({ path: join(output, `inbox-design-dark-note-${width}${largeText ? '-large-text' : ''}.png`) });
      if (width >= 1024) {
        // Dark mode must keep the rail readable and within the viewport too.
        const rail = page.locator('.inbox-rail');
        await checkInboxNavigationScale(rail.locator('.inbox-work-navigation'));
        const railOverflow = await rail.evaluate((e) => e.scrollHeight - e.clientHeight);
        assert.ok(railOverflow <= 0, `Rail content overflows by ${railOverflow}px in dark mode`);
        await rail.screenshot({ path: join(output, `inbox-rail-dark-${width}${largeText ? '-large-text' : ''}.png`) });
        await toggleChatTheme(page);
        await expect(page.locator('html')).not.toHaveClass(/dark/);
        await rail.screenshot({ path: join(output, `inbox-rail-${width}${largeText ? '-large-text' : ''}.png`) });
        await page.screenshot({ path: join(output, `inbox-rail-workspace-${width}${largeText ? '-large-text' : ''}.png`) });
      } else {
        await page.getByRole('button', { name: 'กลับ', exact: true }).click();
        await page.getByRole('button', { name: 'เมนูงานแชท', exact: true }).click();
        const navigation = page.getByRole('dialog').getByRole('navigation', { name: 'การสื่อสารและงานทีม' });
        await expect(navigation).toBeVisible();
        await checkInboxNavigationScale(navigation);
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
