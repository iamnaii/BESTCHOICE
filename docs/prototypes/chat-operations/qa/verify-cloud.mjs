import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1512, height: 830 } });
const errors = [],
  checks = [];
page.on('pageerror', (e) => errors.push(e.message));
const action = (a) => page.locator(`[data-action="${a}"]`);
const select = (id) => page.locator(`[data-cloud-select="${id}"]`);
async function reset() {
  await page.goto('http://127.0.0.1:5286/?v=2.4');
  await page.evaluate(() => {
    state.mobile = true;
    render();
  });
  await page.evaluate(() => document.fonts.ready);
}
async function open() {
  await action('v2-attach').click();
  await action('cloud-open').click();
}
function pass(name) {
  checks.push(name);
  console.log('PASS', name);
}
try {
  await reset();
  await action('v2-attach').click();
  await expect(action('cloud-device')).toBeVisible();
  await expect(action('cloud-open')).toBeVisible();
  const chooser = page.waitForEvent('filechooser');
  await action('cloud-device').click();
  await (
    await chooser
  ).setFiles({
    name: 'local-example.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('sample'),
  });
  assert.equal(await page.evaluate(() => activeRoom().attachments.length), 1);
  await open();
  await expect(page.locator('#cloud-search')).toBeFocused();
  await expect(page.locator('.cloud-mobile-folder')).not.toBeVisible();
  await expect(action('cloud-confirm')).toBeDisabled();
  await expect(page.locator('.cloud-file')).toHaveCount(8);
  await page.screenshot({ path: 'docs/prototypes/chat-operations/screens/v2.4/cloud-library.png' });
  pass(
    'Attachment source chooser preserves local file picking and opens cloud library with search focused',
  );

  await page.locator('#cloud-search').fill('iPhone');
  await expect(page.locator('.cloud-file')).toHaveCount(3);
  await page.locator('#cloud-type').selectOption('pdf');
  await expect(page.locator('.cloud-file')).toHaveCount(0);
  await expect(page.locator('.cloud-empty')).toContainText('ไม่พบไฟล์');
  await action('cloud-reset-all').click();
  await expect(page.locator('.cloud-file')).toHaveCount(8);
  await action('cloud-folder:saved').click();
  await expect(page.locator('.cloud-empty')).toContainText('ยังไม่มีไฟล์');
  await action('cloud-reset-all').click();
  await page.locator('#cloud-sort').selectOption('size');
  assert.equal(
    await page.locator('.cloud-file').first().getAttribute('data-cloud-file'),
    'shop-promo-image',
  );
  await action('cloud-view:list').click();
  await expect(page.locator('#cloud-file-list')).toHaveClass(/list/);
  await action('cloud-view:grid').click();
  pass('Filename search, folder/type filters, empty states, sorting and grid/list views');

  await action('cloud-folder:products').click();
  await select('shop-phone15').check();
  await action('cloud-preview:shop-phone15').click();
  await expect(page.locator('#cloud-detail')).toContainText('420 KB');
  await expect(page.locator('#cloud-detail')).toContainText('5/10/2569');
  await action('cloud-folder:documents').click();
  await select('shop-guide').check();
  await expect(page.locator('#cloud-selection-count')).toContainText('เลือก 2 ไฟล์');
  await action('cloud-folder:products').click();
  await expect(select('shop-phone15')).toBeChecked();
  await page.screenshot({
    path: 'docs/prototypes/chat-operations/screens/v2.4/cloud-selected.png',
  });
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => activeRoom().attachments.length), 1);
  await open();
  await expect(page.locator('#cloud-selection-count')).toHaveText('เลือก 0 ไฟล์');
  await select('shop-phone15').check();
  await select('shop-guide').check();
  await action('cloud-clear').click();
  await expect(select('shop-guide')).not.toBeChecked();
  await expect(action('cloud-confirm')).toBeDisabled();
  await select('shop-phone15').check();
  await select('shop-guide').check();
  const before = await page.evaluate(() => activeRoom().messages.length);
  await action('cloud-confirm').click();
  assert.equal(await page.evaluate(() => activeRoom().messages.length), before);
  assert.equal(await page.evaluate(() => activeRoom().attachments.length), 3);
  await expect(page.locator('#draft')).toBeFocused();
  await action('v2-attachment-list').click();
  await expect(page.locator('.attachment-review-row')).toHaveCount(3);
  await expect(page.locator('#dialog')).toContainText('คลาวด์');
  await page.keyboard.press('Escape');
  await open();
  await expect(select('shop-phone15')).toBeChecked();
  await expect(select('shop-phone15')).toBeDisabled();
  await expect(action('cloud-confirm')).toBeDisabled();
  await page.keyboard.press('Escape');
  pass(
    'Cross-folder selection, metadata, cancel/clear, attach without sending, duplicate prevention and review',
  );

  await action('fail').click();
  await page.locator('#composer-form button[type=submit]').click();
  assert.equal(await page.evaluate(() => activeRoom().attachments.length), 3);
  assert.equal(await page.evaluate(() => activeRoom().wait), 12);
  await action('retry').click();
  assert.equal(await page.evaluate(() => activeRoom().attachments.length), 0);
  assert.equal(await page.evaluate(() => activeRoom().files.length), 3);
  assert.equal(
    await page.evaluate(
      () =>
        activeRoom()
          .messages.at(-1)
          .files.filter((f) => f.source === 'cloud').length,
    ),
    2,
  );
  assert.equal(await page.evaluate(() => activeRoom().wait), 0);
  pass(
    'File-only cloud/local send failure keeps attachments; retry adds the three files exactly once',
  );

  await reset();
  await open();
  await select('shop-map').check();
  await page.evaluate(() => (state.selected = 'bank'));
  await action('cloud-confirm').click();
  assert.equal(await page.evaluate(() => activeRoom().attachments.length), 0);
  await expect(page.locator('#dialog')).not.toBeVisible();
  await action('company:FINANCE').click();
  await open();
  await expect(page.locator('.cloud-file')).toHaveCount(3);
  await expect(select('shop-phone15')).toHaveCount(0);
  await select('finance-payment').check();
  await action('cloud-confirm').click();
  assert.equal(await page.evaluate(() => activeRoom().attachments[0].company), 'FINANCE');
  pass('Stale room confirmation is blocked; FINANCE library only shows FINANCE fixtures');

  for (const edit of ['remove', 'cloud', 'local']) {
    await reset();
    await open();
    await select('shop-phone15').check();
    await action('cloud-confirm').click();
    const count = await page.evaluate(() => activeRoom().messages.length);
    await action('fail').click();
    await page.locator('#composer-form button[type=submit]').click();
    await expect(action('retry')).toBeVisible();
    if (edit === 'remove') {
      await action('v2-attachment-list').click();
      await action('v2-remove-attachment:0').click();
      await page.keyboard.press('Escape');
      await expect(page.locator('#composer-form button[type=submit]')).toBeDisabled();
    } else if (edit === 'cloud') {
      await open();
      await select('shop-guide').check();
      await action('cloud-confirm').click();
    } else {
      await page.locator('#attachment-input').setInputFiles({
        name: 'another.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('sample'),
      });
    }
    await expect(action('retry')).toHaveCount(0);
    assert.equal(await page.evaluate(() => activeRoom().messages.length), count);
    assert.equal(await page.evaluate(() => activeRoom().wait), 12);
  }
  pass(
    'Removing or adding cloud/local files invalidates the old retry; no phantom file message or changed payload is sent',
  );

  let layouts = 0;
  for (const [width, height] of [
    [320, 360],
    [320, 568],
    [390, 844],
    [600, 800],
    [844, 390],
    [900, 700],
    [1024, 600],
    [1024, 390],
    [1512, 830],
  ]) {
    await page.setViewportSize({ width, height });
    for (const theme of ['light', 'dark']) {
      await reset();
      await page.evaluate((theme) => {
        state.theme = theme;
        render();
      }, theme);
      await open();
      const box = await page.locator('#dialog').boundingBox();
      assert(
        box.x >= 0 &&
          box.y >= 0 &&
          box.x + box.width <= width + 1 &&
          box.y + box.height <= height + 1,
      );
      for (const view of ['grid', 'list']) {
        await action('cloud-view:' + view).click();
        await select('shop-phone15').check();
        await action('cloud-preview:shop-phone15').click();
        await expect(page.locator('#cloud-detail')).toContainText('iPhone 15');
        const misses = await page.locator('#dialog').evaluate((root) => {
          const failures = [];
          for (const el of root.querySelectorAll(
            'button:not(:disabled), input:not(:disabled), select',
          )) {
            if (!el.getClientRects().length) continue;
            for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
              const s = getComputedStyle(p),
                b = el.getBoundingClientRect(),
                r = p.getBoundingClientRect();
              if (/auto|scroll/.test(s.overflowY)) {
                if (b.top < r.top) p.scrollTop -= r.top - b.top + 3;
                if (b.bottom > r.bottom) p.scrollTop += b.bottom - r.bottom + 3;
              }
              if (/auto|scroll/.test(s.overflowX)) {
                if (b.left < r.left) p.scrollLeft -= r.left - b.left + 3;
                if (b.right > r.right) p.scrollLeft += b.right - r.right + 3;
              }
            }
            const r = el.getBoundingClientRect(),
              hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
            if (!el.contains(hit))
              failures.push(el.getAttribute('aria-label') || el.textContent.trim().slice(0, 35));
          }
          return failures;
        });
        assert.deepEqual(misses, [], `${width}x${height} ${theme} ${view} unreachable`);
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
          false,
        );
        layouts++;
      }
      if (width === 390 && theme === 'light')
        await page.screenshot({
          path: 'docs/prototypes/chat-operations/screens/v2.4/cloud-mobile.png',
        });
      await action('cloud-confirm').click();
      assert.equal(await page.evaluate(() => activeRoom().attachments.length), 1);
    }
  }
  pass(
    `${layouts} responsive cloud layouts: nine viewports × two themes × grid/list, every control reachable`,
  );
  assert.deepEqual(errors, []);
  await writeFile(
    'docs/prototypes/chat-operations/qa/cloud-results.json',
    JSON.stringify({ status: 'PASS', checks, errors }, null, 2),
  );
} finally {
  await browser.close();
}
