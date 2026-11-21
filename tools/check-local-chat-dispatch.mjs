import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { showWorkControl } from './chat-ui.mjs';
export async function checkChatDispatch(browser, origin, output) {
  origin = new URL(origin).origin;
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.routeWebSocket('**/socket.io/**', socket => socket.close());
  const page = await context.newPage();
  const info = await (await page.request.get(`${origin}/api/preview/info`)).json();
  assert.equal(info.isolated, true);
  const actor = async key => {
    await page.goto('about:blank'); // Stop the previous actor's browser heartbeat before changing preview identity.
    assert.equal((await page.request.post(`${origin}/api/preview/actor/${key}`)).status(), 201);
  };
  const ready = async value => {
    const response = await page.request.patch(`${origin}/api/staff-chat/dispatch/readiness?company=SHOP`, { data: { ready: value } });
    assert.equal(response.status(), 200);
    return response.json();
  };
  const inbox = () => page.goto(`${origin}/inbox?zone=shop`);
  try {
    await actor('owner'); await ready(false);
    await actor('receiver'); await ready(false); await ready(true);
    await actor('owner');
    await inbox();
    const region = page.getByRole('region', { name: 'สถานะรับแชทของฉัน' });
    await expect(region).toBeVisible();
    await expect(page.locator('.inbox-rail').getByRole('button', { name: 'เข้าคิวรับแชท', exact: true })).toBeVisible();
    const list = region.getByRole('list', { name: 'ลำดับคิวรับแชท' });
    await expect(list.getByRole('listitem')).toHaveCount(1);
    const queue = await page.locator('.inbox-conversations').boundingBox();
    const card = await region.boundingBox();
    assert.ok(card.x + card.width <= queue.x, 'Join and roster stay to the left of conversations');
    await region.getByRole('button', { name: 'เข้าคิวรับแชท', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(region.getByText('กำลังรับแชท', { exact: true })).toBeVisible();
    await expect(region.getByText('ลำดับที่ 2 · พร้อมรับ 2 คน', { exact: true })).toBeVisible();
    await expect(list.getByRole('listitem')).toHaveCount(2);
    await expect(list.getByRole('listitem').nth(1)).toContainText('(คุณ)');
    for (const expected of [info.previewActors.receiver.id, info.previewActors.owner.id, info.previewActors.receiver.id]) {
      const response = await page.request.post(`${origin}/api/preview/chat-dispatch/room`);
      assert.equal(response.status(), 201);
      assert.equal((await response.json()).assignedToId, expected);
    }
    await page.reload();
    await expect(region.getByText('ลำดับที่ 1 · พร้อมรับ 2 คน', { exact: true })).toBeVisible();
    await expect(list.getByRole('listitem').first()).toContainText('(คุณ)');
    await expect(list.getByRole('listitem').first()).toContainText('รับแชทถัดไป');
    await page.screenshot({ path: join(output, 'chat-dispatch-desktop.png'), animations: 'disabled' });
    await region.getByRole('button', { name: 'พักรับแชท', exact: true }).click();
    await expect(region.getByRole('button', { name: 'เข้าคิวรับแชท', exact: true })).toBeVisible();
    await page.setViewportSize({ width: 375, height: 812 });
    await page.reload();
    const queueButton = page.getByRole('button', { name: 'คิวรับแชท', exact: true });
    await queueButton.click();
    await expect(region).toBeVisible();
    await region.getByRole('button', { name: 'เข้าคิวรับแชท', exact: true }).click();
    await expect(region.getByText('ลำดับที่ 2 · พร้อมรับ 2 คน', { exact: true })).toBeVisible();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: join(output, 'chat-dispatch-mobile.png'), animations: 'disabled' });
    await region.getByRole('button', { name: 'พักรับแชท', exact: true }).click();
    await page.setViewportSize({ width: 844, height: 390 });
    const conversations = page.locator('.inbox-queue > [aria-busy]');
    assert.ok((await conversations.boundingBox()).height >= 100, 'Short screens must keep conversations visible');
    await region.locator('summary').click();
    assert.ok((await conversations.boundingBox()).height >= 100, 'Expanded queue help must not collapse conversations');
    await page.screenshot({ path: join(output, 'chat-dispatch-header-landscape.png'), animations: 'disabled' });
    await page.keyboard.press('Escape');
    await expect(queueButton).toBeFocused();
    await (await showWorkControl(page, 'งานรอทำ')).click();
    await expect(page.getByRole('dialog').getByRole('region', { name: 'สถานะรับแชทของฉัน' })).toHaveCount(0);
    await page.setViewportSize({ width: 844, height: 390 });
    const workList = page.getByRole('dialog').locator('[aria-busy]');
    await workList.scrollIntoViewIfNeeded();
    assert.ok((await workList.boundingBox()).height >= 100, 'Landscape must retain usable space for queue items');
    await page.screenshot({ path: join(output, 'chat-dispatch-landscape.png'), animations: 'disabled' });
  } finally {
    await actor('receiver'); await ready(false);
    await actor('owner'); await ready(false);
    await context.close();
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const browser = await chromium.launch({ headless: true });
  try { await checkChatDispatch(browser, process.argv[2], process.argv[3] || '.tmp/local-preview'); console.log('Round-robin browser check passed'); }
  finally { await browser.close(); }
}
