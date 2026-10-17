import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { expect as be } from '@playwright/test';
import { startDocumentsApp } from '../documents/support/harness';
import { seedDocumentsWorld } from '../documents/support/fixtures';
import { startWeb } from '../documents/support/web';
import { seedSystemUi } from './system-fixtures';

describe('Shared pagination and date-chip touch layout', () => {
  it('keeps page controls inside a narrow viewport and actually changes server pages', async () => {
    const h = await startDocumentsApp();
    let web: Awaited<ReturnType<typeof startWeb>> | undefined;
    const output = join(process.env.DOCS_QA_OUTPUT!, 'pagination');
    mkdirSync(output, { recursive: true });
    const results: unknown[] = [];
    try {
      const world = await seedDocumentsWorld(h.prisma);
      const data = await seedSystemUi(h, world);
      await h.prisma.otherIncome.createMany({ data: Array.from({ length: 55 }, (_, i) => ({ docNumber: `TEST-PAGE-${world.prefix}-${i}`, companyId: data.finance.id, issueDate: new Date(), paymentAccountCode: '11-1101', counterpartyName: `ทดสอบระบบ แบ่งหน้า ${i}`, createdById: world.users.owner.id })) });
      web = await startWeb(h);
      const token = (await h.login(world.users.owner.email, world.password)).token;
      for (const config of [{ width: 1440, root: 16, theme: 'light' }, { width: 390, root: 16, theme: 'light' }, { width: 320, root: 16, theme: 'dark' }, { width: 320, root: 20, theme: 'dark' }]) {
        const { page, context, errors } = await web.page({ width: config.width, height: 960 });
        await context.tracing.start({ screenshots: true, snapshots: true });
        await page.addInitScript(({ token, theme }) => { localStorage.setItem('access_token', token); localStorage.setItem('theme', theme); }, { token, theme: config.theme });
        try {
          await page.goto(`${web.origin}/other-income?zone=fin`, { waitUntil: 'networkidle' });
          await page.addStyleTag({ content: `html { font-size: ${config.root}px !important; }` });
          const next = page.getByRole('button', { name: 'Next', exact: true });
          await be(next).toBeEnabled();
          const tableRegion = page.getByRole('region', { name: 'รายการเอกสารรายได้อื่น เลื่อนแนวนอนเพื่อดูทุกคอลัมน์', exact: true });
          expect(await tableRegion.locator('tbody tr').first().evaluate(row => row.getBoundingClientRect().height)).toBeLessThan(120);
          await tableRegion.evaluate(e => { e.scrollLeft = e.scrollWidth; });
          await page.getByRole('button', { name: 'ลบ', exact: true }).first().click();
          await be(page.getByRole('dialog', { name: 'ลบฉบับร่าง', exact: true })).toBeVisible();
          await page.getByRole('button', { name: 'ยกเลิก', exact: true }).click();
          await tableRegion.evaluate(e => { e.scrollLeft = 0; });
          const response = page.waitForResponse(r => new URL(r.url()).pathname.endsWith('/other-income') && new URL(r.url()).searchParams.get('page') === '2');
          await next.click();
          expect((await response).status()).toBe(200);
          await be(page.getByRole('button', { name: '2', exact: true })).toHaveAttribute('aria-current', 'page');
          const perPage = page.getByRole('combobox', { name: 'แสดงต่อหน้า', exact: true });
          await perPage.selectOption('50');
          await be(page.getByRole('button', { name: '1', exact: true })).toHaveAttribute('aria-current', 'page');
          await next.click();
          await be(page.getByRole('button', { name: '2', exact: true })).toHaveAttribute('aria-current', 'page');
          await be(next).toBeDisabled();
          const jump = page.getByRole('textbox', { name: 'ไปหน้าที่', exact: true });
          await jump.fill('1'); await jump.press('Enter');
          await be(page.getByRole('button', { name: '1', exact: true })).toHaveAttribute('aria-current', 'page');
          const nav = next.locator('..');
          const geometry = await nav.locator('button:visible').evaluateAll(nodes => nodes.map(node => { const b = node.getBoundingClientRect(); return { name: node.getAttribute('aria-label'), x: b.x, right: b.right, height: b.height, width: b.width }; }));
          for (const b of geometry) { expect(b.x).toBeGreaterThanOrEqual(0); expect(b.right).toBeLessThanOrEqual(config.width); if (config.width < 1024) { expect(b.width).toBeGreaterThanOrEqual(config.root * 2.75); expect(b.height).toBeGreaterThanOrEqual(config.root * 2.75); } }
          const radios = page.getByRole('radiogroup', { name: 'ช่วงวันที่' });
          await radios.getByRole('radio', { name: 'เดือนที่แล้ว', exact: true }).click();
          await be(page.getByText('ไม่มีข้อมูล', { exact: true }).or(page.getByText('ไม่พบเอกสาร', { exact: false })).first()).toBeVisible();
          await radios.getByRole('radio', { name: 'เดือนนี้', exact: true }).click();
          await be(next).toBeEnabled();
          if (config.width < 1024) for (const box of await radios.getByRole('radio').evaluateAll(nodes => nodes.map(n => n.getBoundingClientRect().height))) expect(box).toBeGreaterThanOrEqual(config.root * 2.75);
          expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
          await nav.scrollIntoViewIfNeeded();
          await page.screenshot({ path: join(output, `${config.width}-${config.root}.png`), animations: 'disabled' });
          results.push({ ...config, geometry, status: 'PASS' });
          writeFileSync(join(output, 'results.json'), JSON.stringify(results, null, 2));
          expect(errors.filter(e => e.startsWith('pageerror:'))).toEqual([]);
          const documentLink = tableRegion.getByRole('link').first();
          const href = await documentLink.getAttribute('href');
          await documentLink.focus(); await documentLink.press('Enter');
          await be(page).toHaveURL(new RegExp(`${href}$`));
        } catch (error) { await page.screenshot({ path: join(output, `failure-${config.width}-${config.root}.png`), fullPage: true }); await context.tracing.stop({ path: join(output, `failure-${config.width}-${config.root}.zip`) }); throw error; }
        finally { await context.close(); }
      }
      expect(h.external.calls).toEqual([]);
    } finally { await web?.close(); await h.close(); }
  }, 300_000);
});
