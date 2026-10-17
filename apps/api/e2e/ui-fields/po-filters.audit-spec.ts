import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { expect as browserExpect } from '@playwright/test';
import { startDocumentsApp } from '../documents/support/harness';
import { seedDocumentsWorld } from '../documents/support/fixtures';
import { startWeb } from '../documents/support/web';
import { seedSystemUi } from './system-fixtures';

/** Real PO reads on disposable PostgreSQL; no purchase/payment writes. */
describe('PO filter alignment and selection', () => {
  it('keeps fields aligned and filters usable with long supplier names', async () => {
    const h = await startDocumentsApp();
    let web: Awaited<ReturnType<typeof startWeb>> | undefined;
    const output = join(process.env.DOCS_QA_OUTPUT!, 'po-filters');
    mkdirSync(output, { recursive: true });
    const observations: unknown[] = [];
    try {
      const world = await seedDocumentsWorld(h.prisma);
      const data = await seedSystemUi(h, world);
      const unbrokenName = `TEST-SUPPLIER-${'LongUnbrokenSupplierReference'.repeat(6)}`;
      await h.prisma.supplier.create({ data: { name: unbrokenName, phone: '0800000003' } });
      web = await startWeb(h);
      const token = (await h.login(world.users.owner.email, world.password)).token;
      const configurations = [
        { width: 1440, theme: 'light', root: 16 },
        { width: 1280, theme: 'light', root: 16 },
        { width: 1024, theme: 'light', root: 16 },
        { width: 390, theme: 'light', root: 16 },
        { width: 320, theme: 'dark', root: 16 },
        { width: 390, theme: 'dark', root: 20 },
      ];
      for (const config of configurations) {
        const { page, context, errors } = await web.page({ width: config.width, height: 960 });
        await context.tracing.start({ screenshots: true, snapshots: true });
        try {
          await page.addInitScript(({ token, theme }) => {
            localStorage.setItem('access_token', token);
            localStorage.setItem('theme', theme);
            localStorage.setItem('bc.sidebar.lastZone', 'shop');
            localStorage.setItem('sidebar_collapse', 'false');
          }, { token, theme: config.theme });
          await page.goto(`${web.origin}/purchase-orders?zone=shop`, { waitUntil: 'networkidle' });
          await page.addStyleTag({ content: `html { font-size: ${config.root}px !important; }` });
          const expand = page.getByRole('button', { name: 'ขยายเมนู', exact: true });
          if (config.width >= 1280 && await expand.isVisible()) await expand.click();
          await page.evaluate(async () => {
            await document.fonts.ready;
            for (const animation of document.getAnimations()) {
              if (Number.isFinite(animation.effect?.getComputedTiming().endTime)) animation.finish();
            }
          });

          const search = page.getByRole('textbox', { name: 'ค้นหาเลข PO, ผู้จัดจำหน่าย', exact: true });
          const status = page.getByRole('combobox', { name: 'สถานะ', exact: true });
          const supplier = page.getByRole('combobox', { name: 'ผู้จัดจำหน่าย', exact: true });
          const period = page.getByRole('combobox', { name: 'ช่วงเวลา', exact: true });
          const clear = page.getByRole('button', { name: 'ล้างทั้งหมด', exact: true });
          const empty = page.getByText('ไม่พบใบสั่งซื้อที่ตรงกับตัวกรอง', { exact: true });
          const order = page.getByRole('button', { name: data.po.poNumber, exact: true });
          await browserExpect(order).toBeVisible();

          const fields = await search.locator('..').evaluate(container =>
            [...container.querySelectorAll<HTMLInputElement>('input,button[role=combobox]')].map(element => {
              const box = element.getBoundingClientRect();
              const style = getComputedStyle(element);
              const arrow = element.querySelector('svg')?.getBoundingClientRect();
              const text = element.querySelector('[data-slot=select-value]')?.getBoundingClientRect();
              return {
                label: element.getAttribute('aria-label'), x: box.x, y: box.y, width: box.width, height: box.height,
                font: style.fontFamily, size: style.fontSize, paddingLeft: style.paddingLeft,
                arrowWidth: arrow?.width, arrowInset: arrow ? box.right - arrow.right : null,
                arrowOffsetY: arrow ? arrow.y + arrow.height / 2 - box.y - box.height / 2 : null,
                textInset: text ? text.x - box.x : null,
                textOffsetY: text ? text.y + text.height / 2 - box.y - box.height / 2 : null,
              };
            }));
          expect(fields).toHaveLength(4);
          const selects = fields.slice(1);
          for (const field of fields) {
            expect(field.height).toBeCloseTo(2.75 * config.root, 0);
            expect(field.font).toContain('Noto Sans Thai Looped');
            expect(field.size).toBe(fields[0].size);
            expect(field.paddingLeft).toBe(fields[0].paddingLeft);
          }
          for (const field of selects) {
            expect(field.width).toBeCloseTo(selects[0].width, 0);
            expect(field.arrowWidth).toBeCloseTo(config.root, 0);
            expect(field.arrowInset).toBeCloseTo(0.75 * config.root + 1, 0);
            expect(field.arrowOffsetY).toBeCloseTo(0, 0);
            expect(field.textOffsetY).toBeCloseTo(0, 0);
            expect(field.textInset).toBeCloseTo(0.75 * config.root + 1, 0);
          }
          if (config.width >= 1280) {
            expect(fields[0].width / selects[0].width).toBeCloseTo(2, 1);
            for (const field of selects) expect(field.y).toBeCloseTo(fields[0].y, 0);
          }
          const prefix = `${config.width}-${config.theme}-${config.root}`;
          await page.screenshot({ path: join(output, `${prefix}-fields.png`), animations: 'disabled' });

          await status.click();
          await page.getByRole('option', { name: 'ยกเลิก', exact: true }).click();
          await browserExpect(status).toHaveText('ยกเลิก');
          await browserExpect(empty).toBeVisible();
          await status.click();
          await page.getByRole('option', { name: 'รออนุมัติ', exact: true }).click();
          await browserExpect(order).toBeVisible();

          await supplier.click();
          const longOption = page.getByRole('option', { name: unbrokenName, exact: true });
          await longOption.scrollIntoViewIfNeeded();
          const popup = await longOption.evaluate(element => {
            const label = element.lastElementChild as HTMLElement;
            const box = element.closest('[role=listbox]')!.getBoundingClientRect();
            return { x: box.x, right: box.right, width: box.width, labelWidth: label.clientWidth, labelScroll: label.scrollWidth, labelHeight: label.clientHeight };
          });
          expect(popup.x).toBeGreaterThanOrEqual(0);
          expect(popup.right).toBeLessThanOrEqual(config.width);
          expect(popup.width).toBeCloseTo(selects[1].width, 0);
          expect(popup.labelScroll).toBeLessThanOrEqual(popup.labelWidth + 1);
          expect(popup.labelHeight).toBeGreaterThan(2 * config.root);
          await page.screenshot({ path: join(output, `${prefix}-supplier-open.png`), animations: 'disabled' });
          await longOption.click();
          await browserExpect(supplier).toContainText(unbrokenName);
          await browserExpect(empty).toBeVisible();
          const removeLongSupplier = page.getByRole('button', { name: `ลบ ผู้จัดจำหน่าย: ${unbrokenName}`, exact: true });
          const chip = await removeLongSupplier.evaluate(element => {
            const box = element.parentElement!.getBoundingClientRect();
            return { x: box.x, right: box.right, overflow: document.documentElement.scrollWidth > innerWidth + 1 };
          });
          expect(chip.x).toBeGreaterThanOrEqual(0);
          expect(chip.right).toBeLessThanOrEqual(config.width);
          expect(chip.overflow).toBe(false);
          await removeLongSupplier.click();
          await browserExpect(supplier).toHaveText('ทุกผู้จัดจำหน่าย');
          await browserExpect(order).toBeVisible();
          await supplier.click();
          await page.getByRole('option', { name: data.supplier.name, exact: true }).click();
          await browserExpect(order).toBeVisible();

          await period.click();
          await page.getByRole('option', { name: 'เดือนที่แล้ว', exact: true }).click();
          await browserExpect(empty).toBeVisible();
          await period.focus();
          await page.keyboard.press('Enter');
          await browserExpect(page.getByRole('option', { name: 'เดือนที่แล้ว', exact: true })).toBeFocused();
          await page.keyboard.press('Home');
          await browserExpect(page.getByRole('option', { name: 'ทุกช่วงเวลา', exact: true })).toBeFocused();
          await page.keyboard.press('Enter');
          await browserExpect(period).toHaveText('ทุกช่วงเวลา');
          await browserExpect(order).toBeVisible();
          await period.click();
          await page.getByRole('option', { name: 'เดือนนี้', exact: true }).click();
          await search.fill('TEST-PO-DOES-NOT-EXIST');
          await browserExpect(empty).toBeVisible();
          await search.fill(data.po.poNumber);
          await browserExpect(order).toBeVisible();
          await page.screenshot({ path: join(output, `${prefix}-selected.png`), animations: 'disabled' });
          expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);

          await clear.click();
          await browserExpect(search).toHaveValue('');
          await browserExpect(status).toHaveText('ทุกสถานะ');
          await browserExpect(supplier).toHaveText('ทุกผู้จัดจำหน่าย');
          await browserExpect(period).toHaveText('ทุกช่วงเวลา');
          await browserExpect(order).toBeVisible();
          await status.click();
          await page.keyboard.press('Escape');
          await browserExpect(status).toBeFocused();
          await browserExpect(page.getByRole('listbox')).toHaveCount(0);
          expect(errors.filter(error => error.startsWith('pageerror:'))).toEqual([]);
          observations.push({ ...config, fields, popup, chip, interactions: 'PASS' });
          writeFileSync(join(output, 'results.json'), JSON.stringify(observations, null, 2));
        } catch (error) {
          const prefix = `${config.width}-${config.theme}-${config.root}`;
          await page.screenshot({ path: join(output, `${prefix}-failure.png`), fullPage: true });
          await context.tracing.stop({ path: join(output, `${prefix}-failure.zip`) });
          writeFileSync(join(output, `${prefix}-failure.json`), JSON.stringify({ error: String(error), errors, state: await page.locator('main').innerText(), fields: await page.locator('main input').evaluateAll(elements => elements.map(element => ({ value: (element as HTMLInputElement).value, label: element.getAttribute('aria-label') }))) }, null, 2));
          throw error;
        } finally {
          await context.close();
        }
      }
      expect(h.external.calls).toEqual([]);
    } finally {
      await web?.close();
      await h.close();
    }
  }, 240000);
});
