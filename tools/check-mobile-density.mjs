import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { previewStatus } from './local-preview.mjs';

const status = await previewStatus();
assert.ok(status.running && status.current, 'Refresh this checkout with npm run local:preview first');
const origin = `http://localhost:${status.state.port}`;
const shopOrigin = process.env.MOBILE_SHOP_URL || 'http://localhost:5228';
const output = process.env.MOBILE_AUDIT_OUTPUT || '.tmp/mobile-density/final';
mkdirSync(output, { recursive: true });
const results = [];
const failures = [];
const browser = await chromium.launch();

async function measure(locator) {
  return locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, bottom: rect.bottom,
      lineHeight: parseFloat(style.lineHeight), text: element.textContent?.trim() };
  });
}

async function capture(page, name, check) {
  const result = { name, status: 'PASS' };
  try {
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator('main .animate-pulse:visible')).toHaveCount(0);
    result.metrics = await check();
    await page.waitForLoadState('networkidle');
    await expect(page.locator('main .animate-pulse:visible')).toHaveCount(0);
    await expect(page.locator('main').getByRole('status', { name: 'กำลังโหลด', exact: true })).toHaveCount(0);
    const dimensions = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
    assert.ok(dimensions.scroll <= dimensions.width + 1, `${name}: page overflow`);
  } catch (error) {
    result.status = 'FAIL'; result.error = error.message; failures.push(result);
  }
  await page.screenshot({ path: join(output, `${name}.png`) });
  results.push(result);
  console.log(`${result.status} ${name}${result.error ? `: ${result.error.split('\n')[0]}` : ''}`);
}

try {
  for (const width of [320, 375, 390, 430, 1440]) {
    for (const theme of width === 1440 ? ['light'] : ['light', 'dark']) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
      await context.routeWebSocket('**/socket.io/**', socket => socket.close());
      await context.addInitScript(theme => localStorage.setItem('theme', theme), theme);
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      const mobile = width < 640;

      // Stress count cards with synthetic seven-digit totals; no financial writes.
      await page.route(/\/other-income(?:\?|$)/, async route => {
        const url = new URL(route.request().url());
        if (route.request().resourceType() !== 'document' && url.searchParams.get('limit') === '1') {
          return route.fulfill({ json: { data: [], total: 1234567, page: 1, limit: 1 } });
        }
        return route.continue();
      });

      await page.goto(`${origin}/other-income`);
      await expect(page.getByRole('heading', { name: 'รายได้อื่น', exact: true })).toBeVisible();
      await capture(page, `other-income-${width}-${theme}`, async () => {
        const cards = page.locator('main button[aria-pressed]');
        await expect(cards).toHaveCount(4);
        await expect(cards.first()).toContainText('1,234,567');
        assert.equal(await page.evaluate(() => document.documentElement.classList.contains('dark')), theme === 'dark');
        const metrics = [];
        for (const card of await cards.all()) {
          const box = await measure(card);
          const label = await measure(card.locator('p').first());
          if (mobile) {
            assert.ok(box.width >= (width - 48) / 2, 'Status cards lose width to a nested page inset');
            assert.ok(label.height <= label.lineHeight * 2 + 1, 'Status label takes more than two lines');
          }
          const clipped = await card.evaluate(card => {
            const outer = card.getBoundingClientRect();
            return [...card.querySelectorAll('p, div')].filter(element => {
              const rect = element.getBoundingClientRect();
              return rect.right > outer.right + 1 || rect.left < outer.left - 1 || element.scrollWidth > element.clientWidth + 1;
            }).map(element => element.textContent);
          });
          assert.deepEqual(clipped, [], 'Status count or decorative icon clips');
          metrics.push({ box, label });
        }
        await cards.nth(1).click();
        await expect(cards.nth(1)).toHaveAttribute('aria-pressed', 'true');
        await cards.first().click();
        await expect(cards.first()).toHaveAttribute('aria-pressed', 'true');
        return metrics;
      });

      await page.goto(`${origin}/letters`);
      await expect(page.getByRole('heading', { name: 'จัดการจดหมาย', level: 1 })).toBeVisible();
      await capture(page, `letters-${width}-${theme}`, async () => {
        const title = await measure(page.getByRole('heading', { name: 'จัดการจดหมาย', level: 1 }));
        assert.ok(title.height <= title.lineHeight + 1, 'Letter title is squeezed beside export');
        return { title };
      });

      await page.goto(`${origin}/trade-in`);
      await expect(page.getByRole('textbox', { name: 'ค้นหารายการรับซื้อ' })).toBeVisible();
      await capture(page, `trade-in-${width}-${theme}`, async () => {
        const search = await measure(page.getByRole('textbox', { name: 'ค้นหารายการรับซื้อ' }));
        if (mobile) assert.ok(search.width >= width - 80, 'Search is squeezed by the column chooser');
        const choices = page.getByRole('radiogroup', { name: 'ที่มา', exact: true }).getByRole('radio');
        if (mobile) for (const choice of await choices.all()) {
          assert.ok((await measure(choice)).height >= 44, 'Trade-in filter touch target is too short');
        }
        await choices.nth(1).click();
        await expect(choices.nth(1)).toHaveAttribute('aria-checked', 'true');
        await choices.first().click();
        return { search };
      });

      await page.goto(`${origin}/customers`);
      await expect(page.getByRole('group', { name: 'ตัวเลขสรุป' })).toBeVisible();
      await capture(page, `customers-${width}-${theme}`, async () => {
        const group = page.getByRole('group', { name: 'ตัวเลขสรุป' });
        const box = await measure(group);
        if (mobile) assert.ok(box.height <= 250, 'Count filters push search too far down the phone screen');
        const buttons = group.getByRole('button');
        await expect(buttons).toHaveCount(6);
        await buttons.nth(1).click();
        await expect(buttons.nth(1)).toHaveAttribute('aria-pressed', 'true');
        await buttons.first().click();
        await expect(buttons.first()).toHaveAttribute('aria-pressed', 'true');
        return { box };
      });

      await page.goto(`${origin}/expenses`);
      await expect(page.locator('main h1')).toBeVisible();
      await capture(page, `expenses-${width}-${theme}`, async () => {
        const title = await measure(page.locator('main h1'));
        if (mobile) assert.ok(title.height <= title.lineHeight + 1, 'Expense heading takes multiple lines');
        const search = await measure(page.getByPlaceholder('ค้นหาเลขเอกสาร / ผู้ขาย / เลขใบกำกับ...'));
        if (mobile) assert.ok(search.width >= width - 92, 'Expense search is squeezed');
        return { title, search };
      });
      assert.deepEqual(errors, [], 'Admin browser errors');
      await context.close();
    }

    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.goto(`${shopOrigin}/products`);
    await expect(page.locator('[data-product-card]')).toHaveCount(6);
    await expect(page.locator('[aria-busy]').first()).toHaveAttribute('aria-busy', 'false');
    await capture(page, `storefront-${width}`, async () => {
      if (width < 768) await expect(page.getByRole('link', { name: 'ทักแชทหาร้าน', exact: true })).toBeHidden();
      else await expect(page.getByRole('link', { name: 'ทักแชทหาร้าน', exact: true })).toBeVisible();
      await expect(page.locator('footer').getByRole('link', { name: 'LINE', exact: true })).toHaveAttribute('href', /line\.me/);
      const controls = [page.getByRole('group', { name: 'รูปแบบราคา' }).getByRole('button'),
        page.getByRole('button', { name: /^(ทั้งหมด|มือ 1|มือ 2|ตัวกรอง)$/ }),
        page.getByRole('button', { name: /^เรียง:/ })];
      if (width < 640) for (const locator of controls) for (const button of await locator.all()) {
        if (await button.isVisible()) assert.ok((await measure(button)).height >= 44, 'Catalog control touch target is too short');
      }
      const cards = page.locator('[data-product-card]');
      const first = await measure(cards.first());
      const second = await measure(cards.nth(1));
      const headings = [];
      for (const card of await cards.all()) {
        const title = await measure(card.locator('h3'));
        if (width < 640) assert.ok(title.width >= first.width - 34, 'Device number squeezes model name');
        headings.push(title);
      }
      if (Math.abs(first.y - second.y) < 1) {
        const cta1 = await measure(cards.first().getByRole('link', { name: 'ดูเครื่องนี้', exact: true }));
        const cta2 = await measure(cards.nth(1).getByRole('link', { name: 'ดูเครื่องนี้', exact: true }));
        assert.ok(Math.abs(cta1.bottom - cta2.bottom) <= 1, 'Product actions do not align within the row');
      }
      await page.getByRole('group', { name: 'รูปแบบราคา' }).getByRole('button', { name: 'ซื้อสด', exact: true }).click();
      await expect(cards.first().getByText('ราคาเงินสด', { exact: true })).toBeVisible();
      await page.getByRole('group', { name: 'รูปแบบราคา' }).getByRole('button', { name: 'ผ่อน', exact: true }).click();
      await expect(cards.first().getByText('ดาวน์', { exact: true })).toBeVisible();
      return { first, second, headings };
    });
    await context.close();
  }
} finally {
  await browser.close();
  writeFileSync(join(output, 'results.json'), JSON.stringify({ results, failures }, null, 2) + '\n');
}
assert.equal(failures.length, 0, `${failures.length} mobile density findings; see ${output}/results.json`);
console.log(`PASS mobile density: ${results.length} route/width/theme states`);
