import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const out = '.tmp/chat-ux-audit/final';
await mkdir(out, { recursive: true });
const browser = await chromium.launch(),
  page = await browser.newPage({ viewport: { width: 320, height: 568 } }),
  errors = [],
  checks = [];
page.on('pageerror', (e) => errors.push(e.message));
const click = async (a) =>
  page.locator(`[data-action="${a}"]`).filter({ visible: true }).first().click();
const test = async (name, fn) => {
  await fn();
  checks.push(name);
  console.log('PASS', name);
};
await page.goto('http://127.0.0.1:5286');
await page.evaluate(() => document.fonts.ready);
await test('small phone: queue, open chat, >=120px thread, visible send', async () => {
  await click('room:mook');
  const b = await page.locator('.thread').boundingBox();
  expect(b.height).toBeGreaterThanOrEqual(120);
  const send = await page.locator('#composer-form button[type=submit]').boundingBox();
  expect(send.y + send.height).toBeLessThanOrEqual(568);
});
await test('eight long filenames stay bounded; review and remove work', async () => {
  await page
    .locator('#attachment-input')
    .setInputFiles(
      Array.from({ length: 8 }, (_, i) => ({
        name: 'เอกสาร_' + 'abcdef'.repeat(18) + i + '.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('synthetic'),
      })),
    );
  await click('v2-attachment-list');
  await expect(page.locator('.attachment-review-row')).toHaveCount(8);
  await click('v2-remove-attachment:7');
  await expect(page.locator('.attachment-review-row')).toHaveCount(7);
  await click('dismiss');
  const b = await page.locator('#composer-form button[type=submit]').boundingBox();
  expect(b.y + b.height).toBeLessThanOrEqual(568);
});
await test('mobile failure simulation remains reachable via menu; retry retains files', async () => {
  await click('v2-room-menu');
  await click('v2-display-settings');
  await click('fail');
  await expect(page.locator('#dialog')).not.toBeVisible();
  await page.locator('#draft').fill('ส่งเอกสารตัวอย่าง');
  await page.locator('#composer-form button[type=submit]').click();
  expect(await page.evaluate(() => activeRoom().wait)).toBe(12);
  await click('retry');
  expect(await page.evaluate(() => activeRoom().files.length)).toBe(7);
  expect(await page.evaluate(() => activeRoom().wait)).toBe(0);
});
await test('mobile back restores keyboard focus to a remaining room', async () => {
  await click('back');
  expect(await page.evaluate(() => document.activeElement.classList.contains('room-item'))).toBe(
    true,
  );
  await click('room:bank');
});
await test('menu pin / mute and profile survive compact header', async () => {
  await click('v2-room-menu');
  await click('v2-pin');
  await click('v2-room-menu');
  await click('v2-mute');
  expect(await page.evaluate(() => activeRoom().pinned && activeRoom().muted)).toBe(true);
  await click('details');
  await click('v2-profile');
  await page
    .locator('#v2-profile-form [name=name]')
    .fill('ชื่อยาวเพื่อทดสอบการแสดงผลและนามสกุลบนหน้าจอเล็ก');
  await page.locator('#v2-profile-form [name=phone]').fill('0800000000');
  await page.locator('#v2-profile-form button[type=submit]').click();
  await click('details');
  await expect(page.locator('.chat-head h2')).toContainText('ชื่อยาว');
});
await test('mobile full GFIN workflow with document slots and retained message', async () => {
  await click('details');
  await click('v2-tab:gfin');
  await click('v2-gfin-start');
  await page.locator('#v2-gfin-customer [name=phone]').fill('0800000000');
  await page.locator('#v2-gfin-customer [name=job]').fill('พนักงานตัวอย่าง');
  await page.locator('#v2-gfin-customer button[type=submit]').click();
  await click('v2-gfin-product:0');
  await click('v2-gfin-slots');
  await expect(page.locator('.slot-row')).toHaveCount(13);
  for (const i of [0, 1, 2]) await click('v2-gfin-doc:' + i);
  await click('v2-gfin-next');
  await page.locator('#gfin-message').fill('ข้อความตัวอย่างที่ทบทวนแล้ว');
  await click('v2-gfin-send');
  await expect(page.locator('#gfin-message')).toHaveAttribute('readonly', '');
});
await test('landscape modal: footer stays visible, scroll fields, submit', async () => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto('http://127.0.0.1:5286');
  await click('details');
  await click('v2-tab:device');
  await click('service');
  const f = await page.locator('.dialog-foot').boundingBox();
  expect(f.y + f.height).toBeLessThanOrEqual(390);
  await page.locator('#service-form [name=symptom]').fill('อาการตัวอย่าง ชาร์จไม่เข้า');
  await page.locator('#service-form [name=due]').fill('2026-10-05T15:00');
  await page.locator('#service-form button[type=submit]').click();
  await expect(page.locator('#dialog')).not.toBeVisible();
  expect(await page.evaluate(() => serviceFor(activeRoom()).symptom)).toContain('ชาร์จไม่เข้า');
});
await test('long comment post can be expanded and public response can be sent', async () => {
  await page.setViewportSize({ width: 320, height: 568 });
  await click('page:comments');
  await click('comment:c1');
  await page.evaluate(() => {
    state.comments[0].post = 'รายละเอียดโพสต์ยาว '.repeat(35);
    render();
  });
  await click('v2-post-details');
  await expect(page.locator('#dialog')).toContainText('รายละเอียดโพสต์ยาว');
  await page.keyboard.press('Escape');
  await page.locator('#public-draft').fill('คำตอบสาธารณะตัวอย่าง');
  await page.locator('#public-form button[type=submit]').click();
  expect(await page.evaluate(() => state.comments[0].status)).toBe('RESPONDED');
});
await test('native modal prevents background focus and Escape closes', async () => {
  await click('guide');
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !document.hasFocus() || !!document.activeElement.closest('#dialog'))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(page.locator('#dialog')).not.toBeVisible();
  expect(errors).toEqual([]);
});
await writeFile(
  out + '/interaction-results.json',
  JSON.stringify({ status: 'PASS', checks, errors }, null, 2),
);
await browser.close();
