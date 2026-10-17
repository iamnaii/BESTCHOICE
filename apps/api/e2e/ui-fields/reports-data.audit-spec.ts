import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { expect as be } from '@playwright/test';
import { startDocumentsApp } from '../documents/support/harness';
import { createSignedContract, seedDocumentsWorld } from '../documents/support/fixtures';
import { downloadBytes, startWeb } from '../documents/support/web';
import { seedSystemUi } from './system-fixtures';

describe('Reports — real API data and branch-scoped export', () => {
  it('renders all tabs with nonzero data, paginates and downloads genuine CSV', async () => {
    const h = await startDocumentsApp();
    let web: Awaited<ReturnType<typeof startWeb>> | undefined;
    const output = join(process.env.DOCS_QA_OUTPUT!, 'reports-data');
    mkdirSync(output, { recursive: true });
    const results: unknown[] = [];
    try {
      const w = await seedDocumentsWorld(h.prisma);
      await seedSystemUi(h, w);
      const extra = await createSignedContract(h.prisma, { prefix: w.prefix, label: 'PAGINATION', branchId: w.branches.a.id, customerId: w.customer.id, salespersonId: w.users.salesA.id, months: 60 });
      await h.prisma.contract.updateMany({ where: { id: { in: [w.contracts.a.id, w.contracts.b.id, extra.id] } }, data: { status: 'OVERDUE' } });
      // UTC noon falls in both local and service date windows. Financial date
      // boundary calculations belong to their separate domain tests.
      const now = new Date();
      const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
      const paidDate = new Date(`${date}T12:00:00Z`);
      await h.prisma.payment.updateMany({ where: { contractId: w.contracts.a.id, installmentNo: 1 }, data: { status: 'PAID', amountPaid: '1000', lateFee: '25.50', paidDate, paymentMethod: 'CASH' } });
      await h.prisma.payment.updateMany({ where: { contractId: w.contracts.b.id, installmentNo: 1 }, data: { status: 'PAID', amountPaid: '2000', paidDate, paymentMethod: 'BANK_TRANSFER' } });
      await h.prisma.payment.updateMany({ where: { contractId: extra.id, installmentNo: { lte: 51 } }, data: { status: 'PAID', amountPaid: '100', paidDate, paymentMethod: 'BANK_TRANSFER' } });
      await h.prisma.payment.updateMany({ where: { contractId: w.contracts.a.id, installmentNo: 2 }, data: { status: 'OVERDUE', dueDate: new Date(Date.now() - 5 * 86400000), amountDue: '1234' } });
      const owner = await h.login(w.users.owner.email, w.password);
      const manager = await h.login(w.users.branchManagerA.email, w.password);
      const ownerClient = h.client({ session: owner });
      const ownerExport = await ownerClient.get('/reports/export/contracts').expect(200);
      expect(ownerExport.body.data.filter((row: { contractNumber: string }) => row.contractNumber.includes(w.prefix))).toHaveLength(3);
      const scoped = await h.client({ session: manager }).get('/reports/export/contracts').expect(200);
      expect(scoped.body.data.map((r: { contractNumber: string }) => r.contractNumber).sort()).toEqual([w.contracts.a.contractNumber, extra.contractNumber].sort());
      await h.client({ session: manager }).get(`/reports/export/contracts?branchId=${w.branches.b.id}`).expect(403);
      const managerRecord = await h.prisma.user.findUniqueOrThrow({ where: { id: manager.user.id } });
      const unassigned = await h.prisma.user.create({ data: { email: `unassigned-${w.prefix}@example.invalid`, name: 'ทดสอบระบบ ผู้จัดการยังไม่ระบุสาขา', password: managerRecord.password, role: 'BRANCH_MANAGER', branchId: null, accessibleCompanies: managerRecord.accessibleCompanies, primaryCompany: managerRecord.primaryCompany } });
      const noBranch = await h.login(unassigned.email, w.password);
      await h.client({ session: noBranch }).get('/reports/export/contracts').expect(403);
      web = await startWeb(h);
      for (const config of [{ width: 1440, root: 16, theme: 'light' }, { width: 768, root: 16, theme: 'dark' }, { width: 390, root: 16, theme: 'light' }, { width: 320, root: 20, theme: 'dark' }]) {
        const { page, context, errors } = await web.page({ width: config.width, height: 960 });
        const failures: string[] = [];
        page.on('response', response => { if (response.url().includes('/reports/') && response.status() >= 400) failures.push(`${response.status()} ${new URL(response.url()).pathname}`); });
        await context.tracing.start({ screenshots: true, snapshots: true });
        await page.addInitScript(({ token, theme }) => { localStorage.setItem('access_token', token); localStorage.setItem('theme', theme); }, { token: owner.token, theme: config.theme });
        const record = async (tab: string) => {
          // AnimatedCounter includes a static print value; wait for the visible
          // value to reach it so evidence never captures intermediate money.
          await page.waitForFunction(() => [...document.querySelectorAll('span[class="print:hidden"]')].every(node => node.textContent === node.nextElementSibling?.textContent));
          await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
          await page.evaluate(async () => { await document.fonts.ready; for (const a of document.getAnimations()) if (Number.isFinite(a.effect?.getComputedTiming().endTime)) a.finish(); });
          expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
          const fields = await page.locator('main input:visible, main select:visible').evaluateAll(nodes => nodes.map(node => ({ height: node.getBoundingClientRect().height, font: getComputedStyle(node).fontFamily, size: parseFloat(getComputedStyle(node).fontSize) })));
          for (const field of fields) { expect(field.height).toBeGreaterThanOrEqual(config.root * 2.75 - 0.1); expect(field.font).toContain('Noto Sans Thai Looped'); }
          const screenshot = `${tab}-${config.width}-${config.root}.png`;
          await page.screenshot({ path: join(output, screenshot), fullPage: true, animations: 'disabled' });
          results.push({ ...config, tab, fields, screenshot, status: 'PASS' });
          writeFileSync(join(output, 'results.json'), JSON.stringify(results, null, 2));
        };
        const tab = async (label: string, endpoint: string) => {
          const response = page.waitForResponse(r => r.url().includes(`/reports/${endpoint}`) && r.status() === 200);
          const selector = page.getByRole('combobox', { name: 'เลือกรายงาน', exact: true });
          if (await selector.isVisible()) await selector.selectOption({ label });
          else await page.getByRole('button', { name: label, exact: true }).click();
          await response;
        };
        try {
          await page.goto(`${web.origin}/reports?zone=shop`, { waitUntil: 'networkidle' });
          await page.addStyleTag({ content: `html { font-size: ${config.root}px !important; }` });
          await be(page.getByRole('row', { name: /รวม 1 1,234/ })).toBeVisible();
          await record('aging');
          await tab('รายได้ / กำไร-ขาดทุน', 'revenue-pl');
          await be(page.getByText('8,100', { exact: false }).first()).toBeVisible();
          await be(page.getByText('25.50', { exact: true }).first()).toBeVisible();
          await record('revenue');
          await page.getByLabel('จากวันที่', { exact: true }).click();
          await page.getByRole('button', { name: 'ล้าง', exact: true }).click();
          await be(page.getByRole('status').filter({ hasText: 'เลือกวันที่ให้ครบ' })).toBeVisible();
          await page.getByRole('radio', { name: 'เดือนนี้', exact: true }).click();
          await be(page.getByText('8,100', { exact: false }).first()).toBeVisible();
          await tab('ลูกค้าเสี่ยงสูง', 'high-risk');
          await be(page.getByText(w.contracts.a.contractNumber, { exact: true })).toBeVisible();
          await record('risk');
          await tab('เปรียบเทียบพนักงาน', 'sales-comparison');
          await be(page.getByText('100.0%', { exact: true }).first()).toBeVisible();
          await record('sales');
          await tab('เปรียบเทียบสาขา', 'branch-comparison');
          await be(page.getByRole('row', { name: new RegExp(w.branches.a.name) })).toBeVisible();
          await record('branch');
          await tab('ชำระรายวัน', 'daily-payments');
          await be(page.getByText('8,100', { exact: false }).first()).toBeVisible();
          await be(page.getByText('เงินสด (หน้านี้)', { exact: true })).toBeVisible();
          await page.getByRole('button', { name: 'ถัดไป', exact: true }).click();
          await be(page.getByText('หน้า 2 / 2 · 53 รายการ', { exact: true })).toBeVisible();
          await be(page.getByRole('button', { name: 'ถัดไป', exact: true })).toBeDisabled();
          await record('daily-page2');
          await page.getByLabel('วันที่', { exact: true }).click();
          await page.getByRole('button', { name: 'ล้าง', exact: true }).click();
          await be(page.getByText('เลือกวันที่เพื่อดูรายการรับชำระ')).toBeVisible();
          await page.getByLabel('วันที่', { exact: true }).click();
          await page.getByRole('button', { name: 'วันนี้', exact: true }).click();
          await be(page.getByText('หน้า 1 / 2 · 53 รายการ', { exact: true })).toBeVisible();
          await tab('สต็อกสินค้า', 'stock');
          await be(page.getByText('มูลค่าต้นทุนสินค้าพร้อมขาย')).toBeVisible();
          await record('stock');
          await tab('กำไร Shop/Finance', 'entity-profit');
          await record('entity-all');
          await page.getByLabel('แสดง', { exact: true }).selectOption('SHOP');
          await be(page.getByRole('heading', { name: 'BESTCHOICE SHOP', exact: true })).toBeVisible();
          await be(page.getByRole('heading', { name: 'BESTCHOICE FINANCE', exact: true })).toHaveCount(0);
          await record('entity-shop');
          const downloaded = page.waitForEvent('download');
          await page.getByRole('button', { name: 'ส่งออกสัญญา CSV', exact: true }).click();
          const download = await downloaded;
          const csv = (await downloadBytes(download)).toString('utf8');
          expect(csv.startsWith('\uFEFF"เลขที่สัญญา"')).toBe(true);
          expect(csv).toContain(w.contracts.a.contractNumber);
          expect(csv).toContain(w.contracts.b.contractNumber);
          expect(csv.split('\r\n')).toHaveLength(ownerExport.body.data.length + 1);
          expect(failures).toEqual([]);
          expect(errors.filter(e => e.startsWith('pageerror:'))).toEqual([]);
        } catch (error) {
          await page.screenshot({ path: join(output, `failure-${config.width}.png`), fullPage: true });
          await context.tracing.stop({ path: join(output, `failure-${config.width}.zip`) });
          throw error;
        } finally { await context.close(); }
      }
      expect(h.external.calls).toEqual([]);
    } finally { await web?.close(); await h.close(); }
  }, 300_000);
});
