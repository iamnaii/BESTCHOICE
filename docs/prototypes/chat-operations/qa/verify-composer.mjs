// Run from repository root against the detached prototype server on 5286.
import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const out = 'docs/prototypes/chat-operations/qa';
const screens = 'docs/prototypes/chat-operations/screens/v2.3';
await mkdir(screens, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1512, height: 830 } });
const errors = [],
  checks = [];
page.on('pageerror', (e) => errors.push(e.message));
const action = (a) => page.locator(`[data-action="${a}"]`);
async function reset(room = 'mook') {
  await page.goto('http://127.0.0.1:5286/?v=2.3');
  await page.evaluate((room) => {
    state.selected = room;
    state.mobile = true;
    render();
  }, room);
  await page.evaluate(() => document.fonts.ready);
}
function pass(name) {
  checks.push(name);
  console.log('PASS', name);
}
try {
  await reset();
  assert.deepEqual(
    await page
      .locator('.tool-list button')
      .evaluateAll((els) => els.map((el) => el.getAttribute('aria-label'))),
    ['แนบไฟล์', 'อิโมจิ / สติกเกอร์', 'ส่งข้อมูลสินค้า', 'ข้อความสำเร็จรูป'],
  );
  const bounds = await page.locator('.tool-list button').evaluateAll((els) =>
    els.map((el) => {
      const b = el.getBoundingClientRect();
      return [b.width, b.height, b.y];
    }),
  );
  assert(bounds.every((b) => b[0] === 36 && b[1] === 36 && b[2] === bounds[0][2]));
  await expect(page.locator('#composer-form button[type=submit]')).toBeDisabled();
  await action('v2-templates').focus();
  const focus = await action('v2-templates').evaluate((el) => ({
    offset: getComputedStyle(el).outlineOffset,
    outline: getComputedStyle(el).outlineWidth,
    overflow: getComputedStyle(el.closest('.composer')).overflow,
  }));
  assert.equal(focus.offset, '-3px');
  assert.equal(focus.outline, '2px');
  assert.equal(focus.overflow, 'visible');
  await page.screenshot({ path: `${screens}/desktop-focus.png` });
  pass('original toolbar order, equal targets, visible inset focus, empty send disabled');

  await page.locator('#draft').fill('ก่อนแทนหลัง');
  await page.locator('#draft').evaluate((el) => el.setSelectionRange(4, 7));
  await action('v2-emoji').click();
  await expect(page.locator('#chat-media-picker')).toBeVisible();
  assert.equal(await page.locator('.media-categories button').count(), 5);
  await expect(action('media-tab:gif')).toBeVisible();
  await expect(action('media-tab:sticker')).toHaveCount(0);
  const textBefore = await page.locator('#draft').inputValue();
  const countBefore = await page.evaluate(() => activeRoom().messages.length);
  await page.screenshot({ path: `${screens}/desktop-emoji.png` });
  await action('media-emoji:0').click();
  await expect(page.locator('#draft')).toHaveValue(
    textBefore.slice(0, 4) + '😊' + textBefore.slice(7),
  );
  assert.equal(await page.locator('#draft').evaluate((el) => el.selectionStart), 6);
  assert.equal(await page.evaluate(() => activeRoom().messages.length), countBefore);
  await expect(page.locator('#draft')).toBeFocused();
  await action('v2-emoji').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('#chat-media-picker')).not.toBeVisible();
  await expect(action('v2-emoji')).toBeFocused();
  await action('v2-emoji').click();
  await expect(page.locator('#chat-media-picker')).toBeVisible();
  await action('v2-emoji').click();
  await expect(page.locator('#chat-media-picker')).not.toBeVisible();
  pass(
    'all emoji categories, channel tabs, selection replacement, no send, Escape focus, trigger toggle',
  );

  await reset('nan');
  await page.locator('#draft').fill('ร่างที่ต้องเก็บ');
  await page.evaluate(() => {
    activeRoom().attachments = [{ name: 'keep.pdf', size: 5 }];
    render();
  });
  await action('v2-emoji').click();
  await action('media-tab:sticker').click();
  await expect(action('media-tab:gif')).toHaveCount(0);
  let total = 0;
  for (let pack = 0; pack < 3; pack++) {
    await action('media-pack:' + pack).click();
    const images = page.locator('.media-sticker-grid img');
    total += await images.count();
    await expect
      .poll(() =>
        images.evaluateAll((els) => els.every((el) => el.complete && el.naturalWidth > 0)),
      )
      .toBe(true);
  }
  assert.equal(total, 34);
  await action('media-pack:0').click();
  await page.screenshot({ path: `${screens}/desktop-stickers.png` });
  await page.evaluate(() => (state.failNext = true));
  await action('media-sticker:52002734').click();
  assert.equal(await page.evaluate(() => state.failed.standalone.sticker.id), 52002734);
  await action('retry').click();
  await expect(page.locator('.sticker-message img')).toHaveCount(1);
  await expect(page.locator('#draft')).toHaveValue('ร่างที่ต้องเก็บ');
  assert.equal(await page.evaluate(() => activeRoom().attachments.length), 1);
  pass('LINE: three original sticker packs, 34 images, direct send/retry keeps draft and files');

  await reset();
  await page.locator('#draft').fill('เริ่ม จบ');
  await page.locator('#draft').evaluate((el) => el.setSelectionRange(5, 5));
  await page.keyboard.press('Control+k');
  await expect(page.locator('#canned-search')).toBeFocused();
  await expect(action('canned-insert')).toBeDisabled();
  await expect(action('canned-send')).toBeDisabled();
  await action('canned-category:ทักทาย').click();
  await expect(action('canned-select:welcome')).toHaveCount(0);
  await page.locator('#canned-search').fill('hello');
  await expect(action('canned-select:welcome')).toBeVisible();
  await action('canned-select:welcome').click();
  await expect(page.locator('#canned-preview')).toContainText('คุณมุก');
  await expect(page.locator('#draft')).toHaveValue('เริ่ม จบ');
  await page.locator('#canned-search').fill('สเตทเม้น');
  await expect(action('canned-select:documents')).toBeVisible();
  await page.locator('#canned-search').fill('ไม่พบเลย');
  await expect(page.locator('#canned-list')).toContainText('ไม่พบข้อความ');
  await page.locator('#canned-search').fill('');
  await page.screenshot({ path: `${screens}/desktop-templates.png` });
  await action('canned-insert').click();
  await expect(page.locator('#draft')).toHaveValue(/เริ่มสวัสดีค่ะ คุณมุก/);
  await expect(page.locator('#dialog')).not.toBeVisible();
  await action('v2-templates').click();
  await expect(page.locator('#canned-search')).toHaveValue('');
  await expect(action('canned-insert')).toBeDisabled();
  await action('canned-select:received').dblclick();
  await expect(page.locator('#dialog')).not.toBeVisible();
  await expect(page.locator('#draft')).toHaveValue(/ได้รับเอกสารแล้วค่ะ/);
  pass(
    'canned categories/search/title/content/shortcut, preview, caret insert, double-click, reset',
  );

  await reset('bank');
  await page.locator('#draft').fill('เก็บร่างนี้');
  await page.evaluate(() => {
    activeRoom().attachments = [{ name: 'keep.pdf' }];
    render();
  });
  await action('v2-templates').click();
  await action('canned-select:welcome').click();
  await expect(page.locator('#canned-preview')).toContainText('คุณแบงค์');
  await page.evaluate(() => (state.failNext = true));
  await action('canned-send').click();
  await expect(page.locator('#draft')).toHaveValue('เก็บร่างนี้');
  assert.equal(await page.evaluate(() => activeRoom().wait), 8);
  await action('retry').click();
  assert.equal(await page.evaluate(() => activeRoom().wait), 0);
  assert.equal(await page.evaluate(() => activeRoom().owner), 'may');
  assert.equal(
    await page.evaluate(() => activeRoom().messages.at(-1).text.includes('คุณแบงค์')),
    true,
  );
  assert.equal(await page.evaluate(() => activeRoom().attachments.length), 1);
  await expect(page.locator('#draft')).toHaveValue('เก็บร่างนี้');
  pass(
    'new room variables, direct canned send/retry, owner/wait transitions, draft/files retained',
  );

  await reset();
  await page.locator('#draft').fill('ร่างลูกค้า');
  await action('mode:note').click();
  await page.locator('#draft').fill('โน้ตภายใน');
  await page.locator('#draft').evaluate((el) => el.setSelectionRange(0, 0));
  await page.keyboard.press('Control+k');
  await action('canned-select:received').click();
  await action('canned-insert').click();
  assert.equal(await page.evaluate(() => state.mode), 'note');
  assert.equal(await page.evaluate(() => state.drafts.mookreply), 'ร่างลูกค้า');
  await expect(page.locator('#draft')).toHaveValue(/^ได้รับเอกสารแล้วค่ะ.*โน้ตภายใน$/);
  pass('Ctrl+K insertion preserves internal-note mode and the separate customer draft');

  let layouts = 0;
  for (const [width, height] of [
    [320, 360],
    [320, 568],
    [360, 640],
    [390, 844],
    [600, 800],
    [844, 390],
    [1024, 600],
    [1280, 720],
    [1512, 830],
    [1920, 1080],
  ]) {
    await page.setViewportSize({ width, height });
    for (const theme of ['light', 'dark']) {
      await reset('nan');
      await page.evaluate((theme) => {
        state.theme = theme;
        render();
      }, theme);
      for (const kind of ['emoji', 'sticker', 'templates']) {
        if (kind === 'templates') {
          await action('v2-templates').click();
          await action('canned-select:welcome').click();
        } else {
          await action('v2-emoji').click();
          await action('media-tab:' + kind).click();
        }
        const root = kind === 'templates' ? '#dialog' : '#chat-media-picker';
        const box = await page.locator(root).boundingBox();
        assert(
          box.x >= 0 &&
            box.y >= 0 &&
            box.x + box.width <= width + 1 &&
            box.y + box.height <= height + 1,
          `${width}x${height} ${kind} viewport`,
        );
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
          false,
        );
        // For every visible control, scroll only containers that actually permit user scrolling.
        const misses = await page.locator(root).evaluate((root) => {
          const failures = [];
          for (const el of root.querySelectorAll('button:not(:disabled), input, summary')) {
            if (!el.getClientRects().length) continue;
            for (
              let parent = el.parentElement;
              parent && parent !== document.body;
              parent = parent.parentElement
            ) {
              const s = getComputedStyle(parent),
                b = el.getBoundingClientRect(),
                p = parent.getBoundingClientRect();
              if (/auto|scroll/.test(s.overflowY)) {
                if (b.top < p.top) parent.scrollTop -= p.top - b.top + 2;
                if (b.bottom > p.bottom) parent.scrollTop += b.bottom - p.bottom + 2;
              }
              if (/auto|scroll/.test(s.overflowX)) {
                if (b.left < p.left) parent.scrollLeft -= p.left - b.left + 2;
                if (b.right > p.right) parent.scrollLeft += b.right - p.right + 2;
              }
            }
            const b = el.getBoundingClientRect();
            const hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
            if (!el.contains(hit)) failures.push(el.textContent.trim().slice(0, 35));
          }
          return failures;
        });
        assert.deepEqual(misses, [], `${width}x${height} ${theme} ${kind} blocked controls`);
        if (width === 390 && theme === 'light')
          await page.screenshot({ path: `${screens}/phone-${kind}.png` });
        if (width === 1512 && theme === 'dark' && kind === 'templates')
          await page.screenshot({ path: `${screens}/dark-templates.png` });
        await page.keyboard.press('Escape');
        layouts++;
      }
    }
  }
  pass(
    `${layouts} popup/modal layouts across 10 viewports and both themes; all controls reachable`,
  );
  assert.deepEqual(errors, []);
  await writeFile(
    `${out}/composer-results.json`,
    JSON.stringify({ status: 'PASS', checks, pageErrors: errors }, null, 2),
  );
} finally {
  await browser.close();
}
