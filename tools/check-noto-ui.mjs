import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { previewStatus, output } from './local-preview.mjs';

const status = await previewStatus();
assert.ok(status.running && status.current, 'Run npm run local:check in this checkout first');
const origin = `http://localhost:${status.state.port}`;
const artifacts = join(output, 'noto-ui');
mkdirSync(artifacts, { recursive: true });
const browser = await chromium.launch();
const records = [];
try {
  for (const width of [320, 390, 1440]) {
    const page = await browser.newPage({
      viewport: { width, height: 900 },
      reducedMotion: 'reduce',
    });
    if (width < 1024) {
      await page.goto(origin + '/bookings');
      const nav = page.getByRole('navigation', { name: 'เมนูด้านล่าง' });
      await expect(nav).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      const crowded = await nav.evaluate((root) =>
        [...root.querySelectorAll('a > span:last-child, button > span:last-child')].flatMap(
          (label) => {
            const text = label.getBoundingClientRect();
            const target = label.parentElement.getBoundingClientRect();
            return text.left < target.left + 3 || text.right > target.right - 3
              ? [label.textContent]
              : [];
          },
        ),
      );
      assert.deepEqual(crowded, [], `Mobile navigation labels fit their targets at ${width}px`);
      // All role/zone configurations use the same 12px label style. Measure
      // bold (active) labels, reserving the actual horizontal button padding.
      const oversizedLabels = await page.evaluate(async () => {
        const { getZoneConfigForRole } = await import('/src/config/menu.ts');
        const canvas = document.createElement('canvas').getContext('2d');
        canvas.font = '700 12px "Noto Sans Thai Looped"';
        const oversized = [];
        for (const role of [
          'OWNER',
          'BRANCH_MANAGER',
          'FINANCE_MANAGER',
          'ACCOUNTANT',
          'SALES',
          'VIEWER',
        ]) {
          for (const [zone, configured] of Object.entries(getZoneConfigForRole(role).bottomNav)) {
            const tabs =
              configured.length > 5
                ? configured.filter((tab) => tab.path !== '/letters')
                : configured;
            for (const tab of tabs) {
              if (canvas.measureText(tab.label).width > innerWidth / tabs.length - 8)
                oversized.push({ role, zone, label: tab.label });
            }
          }
        }
        return oversized;
      });
      assert.deepEqual(oversizedLabels, [], `All role/zone mobile labels fit at ${width}px`);
      records.push({ component: 'MobileBottomNav', width, crowded, oversizedLabels });
    }
    for (const path of ['/terms.html', '/privacy.html', '/verify/RT-999999-99999']) {
      await page.goto(origin + path);
      await expect(page.getByRole('heading').first()).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      const result = await page.evaluate(() => ({
        family: getComputedStyle(document.body).fontFamily,
        loaded: [...document.fonts]
          .filter((f) => f.family.includes('Noto Sans Thai Looped') && f.status === 'loaded')
          .map((f) => f.unicodeRange),
        overflow: document.documentElement.scrollWidth > innerWidth + 1,
      }));
      assert.match(result.family, /Noto Sans Thai Looped/);
      assert.ok(result.loaded.length >= 2, `Thai and Latin local faces loaded: ${path}`);
      assert.equal(result.overflow, false, `${path} ${width}px`);
      records.push({ path, width, ...result });
    }

    // Mount actual components in the same app. No customer/API mutations.
    await page.evaluate(async () => {
      const { default: React } = await import('/node_modules/.vite/deps/react.js');
      const {
        default: { createRoot },
      } = await import('/node_modules/.vite/deps/react-dom_client.js');
      const { default: Header } = await import('/src/components/ui/PageHeader.tsx');
      const { default: Booking } =
        await import('/src/pages/BookingsPage/components/BookingEmptyState.tsx');
      document.querySelector('#root').style.display = 'none';
      const host = document.createElement('main');
      host.id = 'noto-fixture';
      host.style.cssText = 'padding:16px; max-width:1100px; margin:auto';
      document.body.append(host);
      createRoot(host).render(
        React.createElement(
          React.Fragment,
          null,
          React.createElement(Header, {
            title: 'รายการรับเครื่องคืน',
            subtitle: 'ติดตามการรับเครื่องคืนและการยืนยัน',
            helpLabel: 'ขั้นตอนรับเครื่องคืน',
            help: 'ตรวจสอบชื่อผู้ส่งมอบและยอดเงิน 9,999,999.99 บาท ก่อนยืนยันรายการรับเครื่องคืน',
          }),
          React.createElement(Booking, {
            canCreate: true,
            onCreate: () => {
              window.notoCreated = true;
            },
          }),
        ),
      );
    });
    const host = page.locator('#noto-fixture');
    await expect(host.getByRole('heading', { name: 'รายการรับเครื่องคืน' })).toBeVisible();
    for (const theme of ['light', 'dark']) {
      await page.evaluate(
        (theme) => document.documentElement.classList.toggle('dark', theme === 'dark'),
        theme,
      );
      const summary = host.locator('summary').first();
      await summary.focus();
      await page.keyboard.press('Enter');
      await expect(host.locator('details').first()).toHaveAttribute('open', '');
      await page.keyboard.press('Space');
      await expect(host.locator('details').first()).not.toHaveAttribute('open');
      await summary.click();
      await expect(host.getByText(/9,999,999.99/)).toBeVisible();
      const booking = host.getByText('วิธีใช้งานใบจอง', { exact: true });
      await booking.click();
      await expect(host.getByText(/หมดอายุริบมัดจำ/)).toBeVisible();
      await expect(host.getByText(/คืนมัดจำเต็มจำนวน/)).toBeVisible();
      for (const rootSize of [16, 32]) {
        await page.evaluate((size) => {
          document.documentElement.style.fontSize = `${size}px`;
        }, rootSize);
        await page.evaluate(() => document.fonts.ready);
        assert.ok(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
          `Disclosure ${width}px ${theme} ${rootSize}px root text`,
        );
        await page.screenshot({
          path: join(artifacts, `help-${width}-${theme}-${rootSize}.png`),
          fullPage: true,
        });
        records.push({
          component: 'PageHeader + BookingEmptyState',
          width,
          theme,
          rootSize,
          overflow: false,
        });
      }
      await page.evaluate(() => {
        document.documentElement.style.fontSize = '';
      });
      await summary.click();
      await booking.click();
    }
    await host.getByRole('button', { name: 'สร้างใบจองแรก' }).click();
    assert.equal(await page.evaluate(() => window.notoCreated), true);
    await page.close();
  }
  writeFileSync(join(artifacts, 'results.json'), JSON.stringify(records, null, 2));
  console.log(`PASS Noto public pages and disclosure: ${records.length} states; ${artifacts}`);
} finally {
  await browser.close();
}
