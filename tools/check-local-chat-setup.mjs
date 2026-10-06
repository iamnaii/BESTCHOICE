import assert from 'node:assert/strict';
import { join } from 'node:path';
import { expect } from '@playwright/test';

// UI acceptance with route fixtures only. No provider subscription or real config mutation.
export async function checkChatSetup(browser, origin, output) {
  const info = await (await fetch(new URL('/api/admin/preview/info', origin))).json();
  assert.equal(info.isolated, true);
  for (const width of [1440, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 930 } });
    await context.routeWebSocket('**/socket.io/**', socket => socket.close());
    let flags;
    let subscribed = false;
    let subscriptions = 0;
    let saves = 0;
    await context.route('**/staff-chat/work-settings*', async route => {
      if (route.request().method() === 'PATCH') {
        const data = route.request().postDataJSON();
        for (const flag of data.flags) flags[flag.key] = flag.enabled;
        saves++;
        return route.fulfill({ json: { policy: { ownerMinutes: 10, managerMinutes: 30 } } });
      }
      const response = await route.fetch();
      const data = await response.json();
      flags ??= Object.fromEntries(Object.keys(data.flags).map(key => [key, false]));
      await route.fulfill({ response, json: { ...data, flags } });
    });
    await context.route('**/staff-chat/facebook-comments/page-config*', async route => {
      assert.equal(route.request().method(), 'GET');
      await route.fulfill({ json: { pageId: '123', branches: [{ id: 'branch', name: 'สาขาทดสอบ' }], binding: { branchId: 'branch', enabled: true }, capabilities: {
        receive: subscribed, publicReply: subscribed, privateReply: false,
        reason: subscribed ? null : 'ยังไม่สมัครรับคอมเมนต์',
        checks: [{ key: 'pages_manage_metadata', label: 'สิทธิ์จัดการเหตุการณ์', passed: true }, { key: 'feed', label: 'สมัคร feed แล้ว', passed: subscribed }],
      } } });
    });
    await context.route('**/staff-chat/facebook-comments/page-config/subscribe-feed*', async route => {
      assert.equal(route.request().method(), 'POST');
      subscriptions++; subscribed = true;
      await route.fulfill({ json: { capabilities: { receive: true, publicReply: true } } });
    });
    try {
      const page = await context.newPage();
      await page.goto(new URL('/inbox?zone=shop', origin).href);
      await expect(page.getByRole('button', { name: 'คิวงาน', exact: true })).toBeDisabled();
      await page.getByRole('button', { name: 'ตั้งค่างานแชท', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'ตั้งค่างานแชท', exact: true });
      await expect(dialog).toBeVisible();
      await dialog.getByText('ตั้งค่า Page และสาขา', { exact: true }).click();
      await expect(dialog.getByLabel('สถานะคอมเมนต์')).toContainText('ยังไม่พร้อม');
      assert.equal(subscriptions, 0, 'Reading setup must not change provider subscription');
      assert.equal(saves, 0, 'Reading setup must not enable features');
      await dialog.getByRole('button', { name: 'สมัครรับคอมเมนต์จาก Facebook', exact: true }).click();
      await expect(dialog.getByText('ผ่าน: สมัคร feed แล้ว', { exact: false })).toBeVisible();
      assert.equal(subscriptions, 1);
      // Provider readiness alone must not pretend the application feature is enabled.
      await expect(dialog.getByLabel('สถานะคอมเมนต์')).toContainText('ยังไม่พร้อม');
      await dialog.getByRole('checkbox', { name: 'คิวงานแชท', exact: true }).check();
      await dialog.getByRole('checkbox', { name: 'คอมเมนต์ Facebook', exact: true }).check();
      assert.equal(await dialog.evaluate(el => el.scrollWidth > el.clientWidth + 1), false, 'Setup dialog overflow');
      await page.screenshot({ path: join(output, `chat-setup-${width}.png`) });
      await dialog.getByRole('button', { name: 'บันทึกการตั้งค่า', exact: true }).click();
      await expect(dialog).toBeHidden();
      assert.equal(saves, 1);
      await expect(page.getByRole('button', { name: 'คิวงาน', exact: true })).toBeEnabled();
      await expect(page.getByRole('button', { name: 'คอมเมนต์', exact: true })).toBeEnabled();
      await page.getByRole('button', { name: 'คิวงาน', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'คิวงานแชท', exact: true })).toBeVisible();
    } finally { await context.unrouteAll({ behavior: 'wait' }); await context.close(); }
  }
}
