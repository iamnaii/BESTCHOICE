import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1512, height: 830 } });
const errors = [],
  checks = [];
page.on('pageerror', (e) => errors.push(e.message));
const action = (a) => page.locator(`[data-action="${a}"]`);
async function reset() {
  await page.goto('http://127.0.0.1:5286/?v=2.3');
  await page.evaluate(() => {
    state.mobile = true;
    render();
  });
  await page.evaluate(() => document.fonts.ready);
}
try {
  await reset();
  for (const theme of ['light', 'dark']) {
    await page.evaluate((theme) => {
      state.theme = theme;
      render();
    }, theme);
    for (const mode of ['reply', 'note']) {
      await action('mode:' + mode).click();
      await page.locator('#draft').focus();
      const geometry = await page.evaluate(() => {
        const card = document.querySelector('.composer'),
          tabs = document.querySelector('.composer-tabs'),
          input = document.querySelector('#draft');
        return {
          gap: card.getBoundingClientRect().top - tabs.getBoundingClientRect().bottom,
          resize: getComputedStyle(input).resize,
          border: getComputedStyle(card).borderColor,
          accent: getComputedStyle(card).getPropertyValue('--composer-accent').trim(),
          warning: getComputedStyle(document.documentElement).getPropertyValue('--warning').trim(),
        };
      });
      assert(geometry.gap >= 7, `${theme} ${mode}: tabs must not overlap card`);
      assert.equal(geometry.resize, 'none');
      if (mode === 'note') assert.equal(geometry.accent, geometry.warning);
      await page.screenshot({
        path: `docs/prototypes/chat-operations/screens/v2.3/${theme}-${mode}.png`,
      });
    }
  }
  checks.push(
    'Reply/note controls separated from the full input border; consistent note focus in both themes',
  );
  await page.locator('#draft').fill('บรรทัด\n'.repeat(40));
  assert.equal(
    await page.locator('#draft').evaluate((el) => el.getBoundingClientRect().height),
    128,
  );
  assert(await page.locator('#draft').evaluate((el) => el.scrollHeight > el.clientHeight));
  await page.locator('#draft').fill('');
  assert.equal(
    await page.locator('#draft').evaluate((el) => el.getBoundingClientRect().height),
    64,
  );
  checks.push('Textarea grows to 128px, then scrolls; deleting content restores compact height');
  await reset();
  await page.locator('#draft').fill('ก่อน หลัง');
  await page.locator('#draft').evaluate((el) => el.setSelectionRange(5, 5));
  const count = await page.evaluate(() => activeRoom().messages.length);
  await action('v2-products').click();
  await expect(page.locator('#product-search')).toBeFocused();
  await expect(page.locator('.product-hit')).toHaveCount(3);
  for (const [term, expected] of [
    ['iphone 15', 'iPhone 15'],
    ['ชมพู', 'iPhone 15'],
    ['128 gb', 'iPhone 15'],
    ['128GB', 'iPhone 15'],
    ['iphone15', 'iPhone 15'],
    ['21,900', 'iPhone 15'],
    ['s24', 'Samsung Galaxy S24'],
    ['IPHONE    มิดไนท์', 'iPhone 14'],
  ]) {
    await page.locator('#product-search').fill(term);
    await expect(page.locator('#product-results')).toContainText(expected);
  }
  await page.locator('#product-search').fill('สินค้าที่ไม่มี');
  await expect(page.locator('.product-hit')).toHaveCount(0);
  await expect(page.locator('#product-results')).toContainText('ไม่พบสินค้า');
  await action('product-clear').click();
  await expect(page.locator('.product-hit')).toHaveCount(3);
  await expect(page.locator('#product-search')).toBeFocused();
  await page.locator('#product-search').fill('s24');
  await page.screenshot({
    path: 'docs/prototypes/chat-operations/screens/v2.3/product-search.png',
  });
  await action('v2-product:2').click();
  await expect(page.locator('#draft')).toHaveValue(/^ก่อน Samsung Galaxy S24.*หลัง$/);
  assert.equal(await page.evaluate(() => activeRoom().messages.length), count);
  assert.equal(await page.evaluate(() => activeRoom().product), 'Samsung Galaxy S24');
  await expect(page.locator('#draft')).toBeFocused();
  await action('v2-products').click();
  await expect(page.locator('#product-search')).toHaveValue('');
  await page.keyboard.press('Escape');
  await expect(page.locator('#draft')).toHaveValue(/Samsung Galaxy S24/);
  checks.push(
    'Search by model/color/capacity/price, case/whitespace, no results/clear, correct filtered selection, caret insert without sending, reopen/Escape',
  );
  for (const [width, height] of [
    [320, 568],
    [390, 844],
    [844, 390],
    [1024, 600],
    [1512, 830],
  ]) {
    await page.setViewportSize({ width, height });
    await reset();
    for (const mode of ['reply', 'note']) {
      await action('mode:' + mode).click();
      await page.locator('#draft').fill('ทดสอบ\n'.repeat(40));
      const rect = await page.locator('#composer-form button[type=submit]').boundingBox();
      assert(rect.x >= 0 && rect.x + rect.width <= width + 1);
      assert(
        rect.y >= 0 && rect.y + rect.height <= height,
        `${width}x${height} ${mode}: send must remain visible during typing`,
      );
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      );
    }
    await action('mode:reply').click();
    await action('v2-products').click();
    await page.locator('#product-search').fill('iphone');
    await expect(page.locator('.product-hit')).toHaveCount(2);
    const rect = await page.locator('#dialog').boundingBox();
    assert(
      rect.x >= 0 &&
        rect.y >= 0 &&
        rect.x + rect.width <= width + 1 &&
        rect.y + rect.height <= height + 1,
    );
    await action('v2-product:1').click();
    await expect(page.locator('#draft')).toHaveValue(/iPhone 14/);
    if (width === 390)
      await page.screenshot({
        path: 'docs/prototypes/chat-operations/screens/v2.3/phone-reply.png',
      });
  }
  checks.push(
    'Composer modes and searchable selection across five desktop/mobile/landscape viewports',
  );
  assert.deepEqual(errors, []);
  await writeFile(
    'docs/prototypes/chat-operations/qa/product-results.json',
    JSON.stringify({ status: 'PASS', checks, errors }, null, 2),
  );
  console.log({ status: 'PASS', checks, errors });
} finally {
  await browser.close();
}
