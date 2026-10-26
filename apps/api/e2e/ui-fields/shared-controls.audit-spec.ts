import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { expect as browserExpect } from '@playwright/test';
import { startDocumentsApp } from '../documents/support/harness';
import { seedDocumentsWorld } from '../documents/support/fixtures';
import { seedSystemUi } from './system-fixtures';
import { startWeb } from '../documents/support/web';

describe('Shared controls and stock forms on isolated full API', () => {
  it('checks native arrows, date keyboard, suggestions and supplier payment rows', async () => {
    const h = await startDocumentsApp();
    let web: Awaited<ReturnType<typeof startWeb>> | undefined;
    const output = join(process.env.DOCS_QA_OUTPUT!, 'shared-controls');
    mkdirSync(output, { recursive: true });
    const observations: unknown[] = [];
    try {
      const world = await seedDocumentsWorld(h.prisma);
      await seedSystemUi(h, world);
      web = await startWeb(h);
      const token = (await h.login(world.users.owner.email, world.password)).token;
      const configurations = [
        { width: 1440, root: 16, theme: 'light' },
        { width: 1280, root: 16, theme: 'dark' },
        { width: 768, root: 16, theme: 'light' },
        { width: 390, root: 16, theme: 'light' },
        { width: 320, root: 16, theme: 'dark' },
        { width: 390, root: 20, theme: 'dark' },
        { width: 844, height: 390, root: 16, theme: 'light' },
      ].filter(config => !process.env.SHARED_WIDTHS || process.env.SHARED_WIDTHS.split(',').includes(String(config.width)));
      for (const config of configurations) {
        const height = 'height' in config ? config.height! : 960;
        const { page, context, errors } = await web.page({ width: config.width, height });
        const captures: unknown[] = [];
        const capture = async (name: string) => {
          await page.evaluate(async () => {
            await document.fonts.ready;
            for (const animation of document.getAnimations()) if (Number.isFinite(animation.effect?.getComputedTiming().endTime)) animation.finish();
          });
          const geometry = await page.evaluate(() => {
            const dialogs = [...document.querySelectorAll('[role=dialog]')];
            const scope = dialogs.at(-1) || document.querySelector('main') || document.body;
            const fields = [...scope.querySelectorAll<HTMLSelectElement>('[data-slot=native-select]')].filter(e => e.getClientRects().length).map(e => {
              const box = e.getBoundingClientRect(), style = getComputedStyle(e);
              const arrow = e.parentElement!.querySelector('svg')!.getBoundingClientRect();
              return { label: e.labels?.[0]?.textContent || e.getAttribute('aria-label'), height: box.height, x: box.x, right: box.right, appearance: style.appearance, font: style.fontFamily, paddingRight: parseFloat(style.paddingRight), iconWidth: arrow.width, iconInset: box.right - arrow.right, iconOffsetY: arrow.y + arrow.height / 2 - box.y - box.height / 2 };
            });
            return { fields, overflow: document.documentElement.scrollWidth > innerWidth + 1 };
          });
          expect(geometry.overflow).toBe(false);
          for (const field of geometry.fields) {
            expect(field.height).toBeCloseTo(2.75 * config.root, 0);
            expect(field.iconWidth).toBeCloseTo(config.root, 0);
            expect(field.iconInset).toBeCloseTo(0.75 * config.root + 1, 0);
            expect(field.iconOffsetY).toBeCloseTo(0, 0);
            expect(field.paddingRight).toBeGreaterThanOrEqual(2.5 * config.root);
            expect(field.appearance).toBe('none');
            expect(field.font).toContain('Noto Sans Thai Looped');
            expect(field.x).toBeGreaterThanOrEqual(0);
            expect(field.right).toBeLessThanOrEqual(config.width);
          }
          const artifact = `${name}-${config.width}-${config.theme}-${config.root}.png`;
          await page.screenshot({ path: join(output, artifact), animations: 'disabled', fullPage: true });
          captures.push({ name, artifact, ...geometry });
        };
        try {
          await page.addInitScript(({ token, config }) => {
            localStorage.setItem('access_token', token);
            localStorage.setItem('theme', config.theme);
            localStorage.setItem('bc.sidebar.lastZone', 'shop');
          }, { token, config });
          await page.goto(`${web.origin}/products/create`, { waitUntil: 'networkidle' });
          await page.addStyleTag({ content: `html { font-size: ${config.root}px !important; }` });
          await page.getByLabel('ยี่ห้อ *', { exact: true }).selectOption('Apple');
          const model = page.getByLabel('รุ่น *', { exact: true });
          await browserExpect(model).toBeEnabled();
          const option = await model.locator('option').nth(1).getAttribute('value');
          await model.selectOption(option!);
          await browserExpect(model).toHaveValue(option!);
          await page.getByLabel('เครื่องไทย / เครื่องนอก', { exact: true }).selectOption('THAI');
          await capture('product-selected');
          await page.getByLabel('ประเภท *', { exact: true }).selectOption('ACCESSORY');
          await page.getByLabel('ประเภทอุปกรณ์ *', { exact: true }).selectOption('ชุดชาร์จ');
          await page.getByLabel('ชนิด *', { exact: true }).selectOption('Type-C');
          await capture('product-accessory');

          await web.navigate(page, '/stock/alerts');
          await page.getByRole('button', { name: '+ Reorder Point', exact: true }).click();
          const dialog = page.getByRole('dialog');
          await dialog.getByLabel('แบรนด์', { exact: true }).selectOption('Apple');
          const stockModel = dialog.getByLabel('รุ่น', { exact: true });
          await stockModel.selectOption(await stockModel.locator('option').nth(1).getAttribute('value') as string);
          await dialog.getByLabel('สาขา', { exact: true }).selectOption(world.branches.a.id);
          await capture('stock-alert-create');
          await page.keyboard.press('Escape');
          await browserExpect(dialog).toHaveCount(0);
          await page.getByRole('button', { name: 'แจ้งเตือน', exact: true }).click();
          await page.getByRole('combobox', { name: 'สถานะ', exact: true }).selectOption('RESOLVED');
          await capture('stock-alert-filter');

          await web.navigate(page, '/suppliers');
          await page.getByRole('button', { name: 'เพิ่มผู้จัดจำหน่าย', exact: true }).click();
          await page.getByRole('button', { name: '+ เพิ่มวิธีชำระเงิน', exact: true }).click();
          const paymentFields = page.getByRole('dialog').getByLabel('วิธีชำระเงิน *', { exact: true });
          await paymentFields.last().selectOption('BANK_TRANSFER');
          const account = page.getByRole('dialog').getByLabel('ชื่อบัญชี', { exact: true });
          await account.last().fill('ทดสอบระบบ ชื่อบัญชีที่ต้องคงไว้');
          await page.getByRole('button', { name: '+ เพิ่มวิธีชำระเงิน', exact: true }).click();
          await paymentFields.last().selectOption('CASH');
          await capture('supplier-payment-methods');
          const methodCount = await paymentFields.count();
          await page.getByRole('button', { name: /^ลบวิธีชำระเงินที่ / }).last().click();
          await browserExpect(paymentFields).toHaveCount(methodCount - 1);
          await browserExpect(account.last()).toHaveValue('ทดสอบระบบ ชื่อบัญชีที่ต้องคงไว้');
          await page.keyboard.press('Escape');
          await browserExpect(page.getByRole('dialog')).toHaveCount(0);

          await web.navigate(page, '/assets/new');
          const custodian = page.getByLabel('ผู้รับผิดชอบ (Custodian) *', { exact: true });
          await custodian.focus();
          const firstName = await page.getByRole('option').first().innerText();
          await page.keyboard.press('ArrowDown');
          await page.keyboard.press('Enter');
          await browserExpect(custodian).toHaveValue(firstName);
          await custodian.fill('ทดสอบระบบ บุคคลใหม่');
          await page.keyboard.press('Escape');
          await browserExpect(custodian).toHaveValue('ทดสอบระบบ บุคคลใหม่');
          const date = page.getByLabel('วันหมดประกัน', { exact: true });
          await date.focus(); await page.keyboard.press('Enter');
          await browserExpect(page.getByRole('button', { name: 'วันนี้', exact: true })).toBeVisible();
          const popup = page.locator('[data-slot=popover-content]');
          await popup.evaluate(async () => {
            for (const animation of document.getAnimations()) if (Number.isFinite(animation.effect?.getComputedTiming().endTime)) animation.finish();
            await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
          });
          await browserExpect(popup).toBeInViewport({ ratio: 1 });
          const bounds = await popup.boundingBox();
          expect(bounds!.x).toBeGreaterThanOrEqual(0);
          expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(config.width);
          expect(bounds!.y).toBeGreaterThanOrEqual(0);
          expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(height);
          await page.addScriptTag({ content: readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8') });
          const calendarAccessibility = await popup.evaluate(async element => {
            const result = await (window as any).axe.run(element, { runOnly: { type: 'rule', values: ['color-contrast', 'button-name'] } });
            return result.violations.map((v: any) => ({ id: v.id, nodes: v.nodes.map((n: any) => ({ html: n.html, summary: n.failureSummary })) }));
          });
          writeFileSync(join(output, `calendar-accessibility-${config.width}-${config.root}.json`), JSON.stringify(calendarAccessibility, null, 2));
          expect(calendarAccessibility).toEqual([]);
          await capture('date-keyboard-open');
          await popup.screenshot({ path: join(output, `calendar-${config.width}-${height}-${config.root}.png`), animations: 'disabled' });
          await page.getByRole('button', { name: 'วันนี้', exact: true }).click();
          await browserExpect(date).not.toHaveValue('');
          await browserExpect(date).toBeFocused();
          await page.keyboard.press('Enter');
          await page.getByRole('button', { name: 'ล้าง', exact: true }).click();
          await browserExpect(date).toHaveValue('');
          await browserExpect(date).toBeFocused();

          // The same date picker is portalled above a modal/drawer in purchasing.
          await web.navigate(page, '/purchase-orders');
          await page.getByRole('button', { name: '+ ซื้อสินค้า', exact: true }).click();
          const expectedDate = page.getByLabel('วันที่คาดรับสินค้า', { exact: true });
          await expectedDate.click();
          const nestedCalendar = page.locator('[data-slot=popover-content]');
          await browserExpect(nestedCalendar).toBeInViewport({ ratio: 1 });
          await page.getByRole('button', { name: 'วันนี้', exact: true }).click();
          await browserExpect(expectedDate).not.toHaveValue('');
          await browserExpect(expectedDate).toBeFocused();
          await expectedDate.press('Enter');
          await page.keyboard.press('Escape');
          await browserExpect(nestedCalendar).toHaveCount(0);
          await browserExpect(page.getByRole('dialog')).toHaveCount(1);
          await browserExpect(expectedDate).toBeFocused();
          await page.keyboard.press('Escape');
          await browserExpect(page.getByRole('dialog')).toHaveCount(0);
          expect(errors.filter(error => error.startsWith('pageerror:'))).toEqual([]);
          observations.push({ ...config, status: 'PASS', captures });
          writeFileSync(join(output, 'results.json'), JSON.stringify(observations, null, 2));
        } catch (error) {
          const failure = await page.evaluate(() => ({
            scrollY, height: innerHeight, active: document.activeElement?.outerHTML,
            inputs: [...document.querySelectorAll('input[readonly]')].map(e => ({ html: e.outerHTML, box: e.getBoundingClientRect().toJSON() })),
            popups: [...document.querySelectorAll('[data-slot=popover-content]')].map(e => ({ html: e.parentElement?.outerHTML.slice(0, 900), box: e.getBoundingClientRect().toJSON() })),
          }));
          writeFileSync(join(output, `failure-${config.width}-${config.root}.json`), JSON.stringify(failure, null, 2));
          await page.screenshot({ path: join(output, `failure-viewport-${config.width}-${config.root}.png`) });
          await page.screenshot({ path: join(output, `failure-${config.width}-${config.root}.png`), fullPage: true });
          throw error;
        } finally { await context.close(); }
      }
      expect(h.external.calls).toEqual([]);
    } finally { await web?.close(); await h.close(); }
  }, 600_000);
});
