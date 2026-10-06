import { chromium, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
const browser = await chromium.launch();
const p = await browser.newPage({ viewport: { width: 1440, height: 1000 } }),
  errors = [],
  checks = [];
p.on('pageerror', (e) => errors.push(e.message));
const action = async (a) => {
  await p.locator(`[data-action="${a}"]`).filter({ visible: true }).first().click();
};
const check = async (name, fn) => {
  await fn();
  checks.push(name);
  console.log('PASS', name);
};
const state = (fn) => p.evaluate(fn);
await p.goto('http://127.0.0.1:5286');
await check('restored toolbars and dossier tabs', async () => {
  for (const a of [
    'v2-attach',
    'v2-products',
    'v2-templates',
    'v2-offer',
    'v2-pin',
    'v2-ai',
    'v2-mute',
    'v2-tab:gfin',
    'v2-tab:money',
    'v2-tab:device',
  ])
    await expect(p.locator(`[data-action="${a}"]`).first()).toBeVisible();
});
await check('channel and owner filters', async () => {
  await action('filter:ALL');
  await p.locator('[data-v2-change="channel"]').selectOption('LINE');
  await expect(p.locator('.room-item')).toHaveCount(2);
  await action('v2-clear-filters');
  await p.locator('[data-v2-change="ownerFilter"]').selectOption('NONE');
  await expect(p.locator('.room-item')).toHaveCount(1);
  await action('v2-clear-filters');
});
await check('draft survives room change and templates need explicit send', async () => {
  await p.locator('#draft').fill('ร่างที่ต้องเก็บ');
  await action('room:bank');
  await action('room:mook');
  await expect(p.locator('#draft')).toHaveValue('ร่างที่ต้องเก็บ');
  await p.keyboard.press('Control+k');
  await action('canned-select:documents');
  await action('canned-insert');
  await expect(p.locator('#draft')).toContainText('');
  expect(await state(() => activeRoom().wait)).toBe(12);
  expect(await p.locator('#draft').inputValue()).toContain('สเตทเม้น');
});
await check('attachment failure and retry keeps file exactly once', async () => {
  await p.locator('#attachment-input').setInputFiles({
    name: 'statement-demo.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('synthetic fixture'),
  });
  await action('fail');
  await p.locator('#composer-form button[type=submit]').click();
  expect(await state(() => activeRoom().wait)).toBe(12);
  await action('retry');
  expect(await state(() => activeRoom().wait)).toBe(0);
  expect(await state(() => activeRoom().files.length)).toBe(1);
  expect(await state(() => activeRoom().attachments.length)).toBe(0);
  expect(await state(() => activeRoom().messages.at(-1).files[0].name)).toBe('statement-demo.pdf');
});
await check('credit from chat + simulated analysis', async () => {
  await action('v2-media');
  await action('v2-file-credit:0');
  await action('v2-analyze');
  expect(await state(() => activeRoom().creditHistory.length)).toBe(1);
  expect(await state(() => activeRoom().stage)).toBe(3);
});
await check('GFIN draft retained; required slots; full slot list', async () => {
  await action('v2-tab:gfin');
  await action('v2-gfin-start');
  await p.locator('#v2-gfin-customer [name=phone]').fill('0800000000');
  await p.locator('#v2-gfin-customer [name=job]').fill('พนักงานตัวอย่าง');
  await action('v2-tab:money');
  await action('v2-tab:gfin');
  await expect(p.locator('[name=job]')).toHaveValue('พนักงานตัวอย่าง');
  await p.locator('#v2-gfin-customer button[type=submit]').click();
  await action('v2-gfin-product:0');
  await expect(p.locator('[data-action="v2-gfin-next"]')).toBeDisabled();
  await action('v2-gfin-slots');
  await expect(p.locator('.slot-row')).toHaveCount(13);
  for (const n of [0, 1, 2]) await action('v2-gfin-doc:' + n);
  await action('v2-gfin-next');
  await p.locator('#gfin-message').fill('ข้อความที่ตรวจแล้ว');
  await action('v2-gfin-send');
  expect(await state(() => activeRoom().gfin.sent)).toBe(true);
  expect(await state(() => activeRoom().gfin.message)).toBe('ข้อความที่ตรวจแล้ว');
});
await check('offer draft and contract handoff boundary', async () => {
  await action('v2-offer');
  await p.locator('#v2-offer-form button[type=submit]').click();
  await action('v2-contract-handoff');
  await expect(p.locator('#dialog')).toContainText('ฉบับร่างยังไม่สร้างสัญญา');
  await action('dismiss');
});
await check('handoff recipient accepts; sales owner preserved', async () => {
  await action('handoff');
  await p.locator('#handoff-form [name=title]').fill('ทดสอบส่งงานเครดิต');
  await p.locator('#handoff-form button[type=submit]').click();
  await p.locator('#actor').selectOption('praew');
  const taskId = await state(() => state.tasks.at(-1).id);
  await action('task:' + taskId);
  await action('task:' + taskId);
  expect(await state(() => activeRoom().owner)).toBe('may');
  expect(await state(() => state.tasks.at(-1).status)).toBe('DONE');
});
await check('schedule survives close and done work remains discoverable', async () => {
  await action('schedule');
  await p.locator('#schedule-form button[type=submit]').click();
  await action('close-room');
  await action('confirm-close');
  await action('page:work');
  await expect(p.locator('.work-page')).toContainText('ติดตามเอกสาร');
  await action('v2-finish-work:due-mook');
  await action('v2-work-filter:DONE');
  await expect(p.locator('.work-page')).toContainText('ติดตามเอกสาร');
});
await check('link unknown customer; manual assign; pin / AI / mute', async () => {
  await action('page:chat');
  await action('v2-clear-filters');
  await action('room:bank');
  await action('v2-tab:customer');
  await action('v2-link');
  await p.locator('[name=query]').fill('แบงค์');
  await p.locator('#v2-link-search button[type=submit]').click();
  await action('v2-confirm-link');
  expect(await state(() => activeRoom().linked)).toBe(true);
  await action('v2-assign');
  await p.locator('#v2-assign-form [name=owner]').selectOption('ton');
  await p.locator('#v2-assign-form button[type=submit]').click();
  for (const a of ['v2-pin', 'v2-ai', 'v2-mute']) await action(a);
  expect(
    await state(() => ({
      owner: activeRoom().owner,
      pin: activeRoom().pinned,
      ai: activeRoom().ai,
      mute: activeRoom().muted,
    })),
  ).toEqual({ owner: 'ton', pin: true, ai: true, mute: true });
});
await check('warranty, service link, contract payment draft', async () => {
  await action('room:keng');
  await action('v2-tab:device');
  await p.locator('#v2-warranty-form button[type=submit]').click();
  await expect(p.locator('.dossier-content')).toContainText('ผลตัวอย่าง');
  await action('link-case');
  await action('confirm-link');
  expect(await state(() => serviceFor(activeRoom()).case)).toBe('AS-20261005-002');
  await action('v2-tab:money');
  await action('v2-payment');
  await action('v2-payment-draft');
  await expect(p.locator('#draft')).toHaveValue(/ไม่รับเงินจริง/);
  await action('v2-assign');
  await expect(p.locator('#dialog')).toContainText('มีรายการซื้อแล้ว');
  await action('dismiss');
});
await check('public comment drafts and response', async () => {
  await action('page:comments');
  await p.locator('#public-draft').fill('สวัสดีค่ะ ขอบคุณที่สนใจค่ะ');
  await action('comment:c2');
  await action('comment:c1');
  await expect(p.locator('#public-draft')).toHaveValue('สวัสดีค่ะ ขอบคุณที่สนใจค่ะ');
  await p.locator('#public-form button[type=submit]').click();
  expect(await state(() => state.comments[0].status)).toBe('RESPONDED');
});
await check('FINANCE context and analytics respect company', async () => {
  await action('company:FINANCE');
  await action('page:report');
  await expect(p.locator('.report')).not.toContainText('ยอดขายที่เชื่อมโยงกับแชท');
  await action('report-wait');
  expect(await state(() => filtered().every((r) => r.company === 'FINANCE'))).toBe(true);
});
await action('reset');
await p.screenshot({ path: '.tmp/chat-ux-v2/desktop.png' });
for (const width of [320, 390, 768, 1024, 1280, 1440, 1920]) {
  await p.setViewportSize({ width, height: 1000 });
  for (const theme of ['light', 'dark']) {
    await state(() => {
      state.page = 'chat';
      state.mobile = false;
      state.details = false;
      state.dossier = 'customer';
      render();
    });
    if ((await state(() => state.theme)) !== theme) await action('v2-theme');
    for (const mode of ['queue', 'chat', 'details', 'gfin', 'work', 'comments', 'report']) {
      await p.evaluate((m) => {
        state.page = ['work', 'comments', 'report'].includes(m) ? m : 'chat';
        state.mobile = m !== 'queue';
        state.details = ['details', 'gfin'].includes(m);
        state.dossier = m === 'gfin' ? 'gfin' : 'customer';
        render();
      }, mode);
      const overflow = await p.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      );
      expect(overflow, `${width} ${theme} ${mode} overflow`).toBe(false);
    }
  }
  checks.push(`responsive ${width}: 7 screens × light/dark`);
}
await p.setViewportSize({ width: 390, height: 844 });
await p.evaluate(() => {
  state.page = 'chat';
  state.theme = 'light';
  state.mobile = true;
  state.details = false;
  render();
});
await p.screenshot({ path: '.tmp/chat-ux-v2/mobile-chat.png' });
await action('details');
await p.screenshot({ path: '.tmp/chat-ux-v2/mobile-context.png' });
await p.setViewportSize({ width: 1440, height: 1000 });
await p.evaluate(() => {
  state.page = 'work';
  render();
});
await p.screenshot({ path: '.tmp/chat-ux-v2/work-desktop.png' });
await p.evaluate(() => {
  state.page = 'chat';
  state.theme = 'dark';
  render();
});
await p.screenshot({ path: '.tmp/chat-ux-v2/dark-desktop.png' });
await check('keyboard modal Escape and runtime errors', async () => {
  await action('guide');
  await p.keyboard.press('Escape');
  await expect(p.locator('#dialog')).not.toBeVisible();
  expect(errors).toEqual([]);
});
await writeFile(
  'docs/prototypes/chat-operations/qa/workflow-results.json',
  JSON.stringify({ status: 'PASS', checks, responsiveScreens: 98, errors }, null, 2),
);
await browser.close();
