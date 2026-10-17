import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { expect as browserExpect } from '@playwright/test';
import { startDocumentsApp } from '../documents/support/harness';
import { seedDocumentsWorld } from '../documents/support/fixtures';
import { seedSystemUi } from './system-fixtures';
import { startWeb } from '../documents/support/web';

describe('Public, service, report and settings field regressions', () => {
  it('uses consistent field sizes and preserves filter and editor behavior', async () => {
    const h = await startDocumentsApp();
    let web: Awaited<ReturnType<typeof startWeb>> | undefined;
    const output = join(process.env.DOCS_QA_OUTPUT!, 'report-controls');
    mkdirSync(output, { recursive: true });
    const results: unknown[] = [];
    try {
      const world = await seedDocumentsWorld(h.prisma);
      await seedSystemUi(h, world);
      web = await startWeb(h);
      const token = (await h.login(world.users.owner.email, world.password)).token;
      for (const config of [{ width: 1440, root: 16, theme: 'light' }, { width: 768, root: 16, theme: 'dark' }, { width: 390, root: 16, theme: 'light' }, { width: 320, root: 16, theme: 'dark' }, { width: 390, root: 20, theme: 'dark' }]) {
        const { page, context, errors } = await web.page({ width: config.width, height: 960 });
        await context.tracing.start({ screenshots: true, snapshots: true });
        await page.addInitScript(({ token, config }) => { localStorage.setItem('access_token', token); localStorage.setItem('theme', config.theme); }, { token, config });
        const record = async (name: string) => {
          await page.evaluate(async () => { await document.fonts.ready; for (const a of document.getAnimations()) if (Number.isFinite(a.effect?.getComputedTiming().endTime)) a.finish(); });
          const fields = await page.evaluate(() => {
            const scope = document.querySelector('main') || document.body;
            return [...scope.querySelectorAll<HTMLInputElement>('input:not([type=checkbox],[type=radio],[type=hidden],[type=file]),select,button[role=combobox]')].filter(e => e.checkVisibility({checkVisibilityCSS:true,checkOpacity:true})).map(e => {
              const b = e.getBoundingClientRect(), s = getComputedStyle(e);
              return { name: e.getAttribute('aria-label') || [...e.labels || []].map(l => l.textContent).join(' '), height: b.height, size: parseFloat(s.fontSize), font: s.fontFamily, x: b.x, right: b.right };
            });
          });
          expect(fields.length).toBeGreaterThan(0);
          for (const f of fields) { expect(f.height).toBeGreaterThanOrEqual(config.root * 2.75 - 0.1); expect(f.font).toContain('Noto Sans Thai Looped'); expect(f.x).toBeGreaterThanOrEqual(0); expect(f.right).toBeLessThanOrEqual(config.width); if (config.width < 1024) expect(f.size).toBeGreaterThanOrEqual(config.root); }
          expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
          await page.screenshot({ path: join(output, `${name}-${config.width}-${config.theme}-${config.root}.png`), fullPage: true, animations: 'disabled' });
          results.push({ name, ...config, fields, status: 'PASS' });
          writeFileSync(join(output, 'results.json'), JSON.stringify(results, null, 2));
        };
        const navigate = async (path: string) => {
          await page.goto(web!.origin + path, { waitUntil: 'networkidle' });
          await page.addStyleTag({ content: `html { font-size: ${config.root}px !important; }` });
        };
        try {
          await navigate('/forgot-password');
          await page.getByLabel('อีเมล', { exact: true }).fill('test@example.invalid');
          await record('forgot-password');
          await page.getByLabel('อีเมล', { exact: true }).fill('');
          await navigate('/after-sales');
          const imei = page.getByRole('textbox', { name: 'เลข IMEI หรือเลขเครื่อง', exact: true });
          await imei.fill('000000000000000');
          await record('after-sales-imei');
          await imei.clear();
          await navigate('/assets/register');
          const category = page.getByRole('combobox', { name: 'หมวด', exact: true });
          await category.click(); await page.getByRole('option').nth(1).click();
          await browserExpect(page).toHaveURL(/category=EQUIPMENT/);
          const status = page.getByRole('combobox', { name: 'สถานะ', exact: true });
          await status.click(); await page.getByRole('option', { name: 'ลงบัญชีแล้ว', exact: true }).click();
          await browserExpect(page).toHaveURL(/status=POSTED/);
          await page.getByRole('textbox', { name: 'ค้นหา', exact: true }).fill('ชื่อสินทรัพย์ทดสอบยาวมากที่ไม่พบรายการ');
          await browserExpect(page).toHaveURL(/search=/);
          await record('asset-register-filtered');
          await page.getByRole('textbox', { name: 'ค้นหา', exact: true }).clear();
          await navigate('/finance/wht-annual');
          const year = page.getByRole('combobox', { name: 'ปี', exact: true });
          const current = await year.innerText();
          await year.click(); await page.getByRole('option', { name: 'ปีภาษี 2563', exact: true }).click();
          await browserExpect(year).toHaveText('ปีภาษี 2563');
          await year.click();
          await page.getByRole('option', { name: current, exact: true }).click();
          await browserExpect(year).toHaveText(current);
          expect(await year.locator('[data-slot=select-value]').evaluate(e => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
          await record('wht-year-return');
          const download = page.waitForEvent('download');
          await page.getByRole('button', { name: 'ดาวน์โหลด Excel', exact: true }).click();
          expect((await download).suggestedFilename()).toMatch(/^PND1A-\d{4}\.xlsx$/);
          await navigate('/other-income/daily-sheet');
          await page.getByLabel('วันที่เริ่ม', { exact: true }).fill('2026-10-01');
          await page.getByLabel('วันที่สิ้นสุด', { exact: true }).fill('2026-10-17');
          await record('income-range');
          await navigate('/settings/rich-menu');
          const layout = page.getByLabel('Layout เมนู', { exact: true });
          await layout.selectOption(await layout.locator('option').nth(1).getAttribute('value') as string);
          await page.getByLabel('ไอคอน (Emoji)', { exact: true }).fill('★');
          await page.getByLabel('ชื่อปุ่ม', { exact: true }).fill('ทดสอบ');
          await page.getByRole('button', { name: 'เขียว', exact: true }).click();
          await browserExpect(page.getByRole('button', { name: 'เขียว', exact: true })).toHaveAttribute('aria-pressed', 'true');
          await page.getByRole('radio', { name: 'ส่งข้อความ', exact: true }).check();
          await page.getByLabel('ข้อความที่จะส่ง', { exact: true }).fill('ข้อความร่างสำหรับตรวจ UI ไม่ได้เผยแพร่');
          await record('rich-menu-draft');
          expect(errors.filter(e => e.startsWith('pageerror:'))).toEqual([]);
        } catch (error) {
          await page.screenshot({ path: join(output, `failure-${config.width}-${config.root}.png`), fullPage: true });
          await context.tracing.stop({ path: join(output, `failure-${config.width}-${config.root}.zip`) });
          throw error;
        } finally { await context.close(); }
      }
      expect(h.external.calls).toEqual([]);
    } finally { await web?.close(); await h.close(); }
  }, 300_000);
});
