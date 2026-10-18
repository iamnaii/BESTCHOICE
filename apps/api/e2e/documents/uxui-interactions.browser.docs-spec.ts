import { startDocumentsApp, DocumentsHarness } from './support/harness';
import { seedDocumentsWorld } from './support/fixtures';
import { startWeb, WebRuntime } from './support/web';
import { saveArtifact } from './support/artifacts';

describe('UX/UI mobile controls on the real isolated API', () => {
  let h: DocumentsHarness, web: WebRuntime, token: string;
  beforeAll(async () => {
    h = await startDocumentsApp();
    const world = await seedDocumentsWorld(h.prisma);
    token = (await h.login(world.users.owner.email, world.password)).token;
    web = await startWeb(h);
  }, 180000);
  afterAll(async () => { await web?.close(); await h?.close(); });
  for (const dark of [false, true]) {
    it(`keeps the editor Add menu, last action, preview and GFIN keyboard tabs usable at 320×568 (${dark ? 'dark' : 'light'})`, async () => {
      const { page, context, errors } = await web.page({ width: 320, height: 568 });
      try {
        await page.addInitScript((accessToken) => { localStorage.setItem('access_token', accessToken); localStorage.setItem('bc.sidebar.lastZone', 'shop'); }, token);
        await page.goto(`${web.origin}/contract-templates`);
        await page.getByRole('button', { name: 'เพิ่ม', exact: true }).waitFor();
        await page.waitForLoadState('networkidle');
        await page.locator('select[aria-label="เทมเพลตสัญญา"]:not(:disabled)').waitFor();
        await page.evaluate(value => document.documentElement.classList.toggle('dark', value), dark);
        const blocksBefore = await page.getByRole('button', { name: /^ย่อ .*รูปภาพ/ }).count();
        await page.getByRole('button', { name: 'เพิ่ม', exact: true }).click();
        // During the red run the old custom menu is a button; after fixing it is a menuitem.
        const last = page.getByRole('menuitem', { name: 'แนบรูปภาพ', exact: true }).or(page.getByRole('button', { name: 'แนบรูปภาพ', exact: true }));
        await last.scrollIntoViewIfNeeded();
        const bounds = await last.boundingBox();
        expect(bounds).not.toBeNull();
        expect(bounds!.x).toBeGreaterThanOrEqual(0);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
        expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(568);
        const menuShot = saveArtifact('uxui-interactions', `editor-menu-320-${dark ? 'dark' : 'light'}.png`, await page.screenshot()).relativePath;
        await last.click({ timeout: 5000 });
        await page.getByRole('button', { name: /^ย่อ .*รูปภาพ/ }).nth(blocksBefore).waitFor({ state: 'attached', timeout: 5000 });
        expect(await page.getByRole('button', { name: /^ย่อ .*รูปภาพ/ }).count()).toBe(blocksBefore + 1);
        await page.getByRole('button', { name: 'Preview', exact: true }).click();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
        saveArtifact('uxui-interactions', `editor-preview-320-${dark ? 'dark' : 'light'}.png`, await page.screenshot());
        // Leave before the 30-second autosave; no template is persisted by this test.
        await web.navigate(page, '/settings/gfin-rates');
        const tabs = page.getByRole('tablist');
        await tabs.getByRole('tab').first().waitFor();
        await tabs.getByRole('tab').first().focus();
        await page.keyboard.press('End');
        await page.waitForTimeout(200);
        const finalTab = tabs.getByRole('tab').last();
        expect(await finalTab.getAttribute('aria-selected')).toBe('true');
        const tabBounds = await finalTab.boundingBox();
        expect(tabBounds!.x).toBeGreaterThanOrEqual(0);
        expect(tabBounds!.x + tabBounds!.width).toBeLessThanOrEqual(320);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
        saveArtifact('uxui-interactions', `gfin-keyboard-tab-320-${dark ? 'dark' : 'light'}.png`, await page.screenshot());
        expect(errors.filter(e => e.startsWith('pageerror:'))).toEqual([]);
        saveArtifact('uxui-interactions', `result-${dark ? 'dark' : 'light'}.json`, JSON.stringify({ status: 'pass', menuShot, selectedTab: await finalTab.innerText() }, null, 2));
      } finally { await context.close(); }
      expect(h.external.calls).toEqual([]);
    }, 120000);
  }
  it('lets an unassigned owner choose the only branch and retry a daily-summary failure at 320px', async () => {
    const branch = await h.prisma.branch.findFirstOrThrow();
    const { page, context } = await web.page({ width: 320, height: 740 });
    let failSummary = true;
    try {
      await page.addInitScript((accessToken) => { localStorage.setItem('access_token', accessToken); localStorage.setItem('bc.sidebar.lastZone', 'shop'); }, token);
      await page.route('**/api/admin/branches?**', route => route.fulfill({ json: { success: true, data: [branch] } }));
      await page.route('**/api/admin/expense-documents/daily-summary?**', route => failSummary ? route.fulfill({ status: 500, json: { message: 'Synthetic retry failure' } }) : route.continue());
      await page.goto(`${web.origin}/expenses/daily-summary`);
      const selection = page.getByRole('combobox', { name: 'สาขาของใบสรุปรายจ่าย' });
      await selection.selectOption(branch.id);
      await page.getByRole('alert').waitFor({ timeout: 20000 });
      expect(await page.getByText('ไม่พบข้อมูลในวันที่เลือก', { exact: true }).count()).toBe(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      saveArtifact('uxui-interactions', 'daily-summary-error-320.png', await page.screenshot());
      failSummary = false;
      await page.getByRole('button', { name: 'ลองใหม่', exact: true }).click();
      await page.getByText(/รายการเอกสาร \(\d+ รายการ\)/).waitFor();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      saveArtifact('uxui-interactions', 'daily-summary-recovered-320.png', await page.screenshot());
    } finally { await context.close(); }
  }, 60000);

  for (const width of [320, 390]) {
    it(`keeps populated dashboard and equity tables usable at ${width}px in both themes`, async () => {
      const { page, context, errors } = await web.page({ width, height: 844 });
      // Deliberately long visual fixtures, independent of other suites' database writes.
      // API/accounting correctness remains covered by the domain suites.
      const longName = 'ทดสอบระบบ ผู้ถือหุ้นชื่อยาว บริษัทตัวอย่างเพื่อทดสอบการแสดงผล จำกัด';
      const fixtures: Record<string, unknown> = {
        '/dashboard/kpis': { contracts: { total: 194, active: 13, overdue: 130, default: 0, completed: 51 }, products: { total: 249, inStock: 90 }, financial: { totalReceivable: 1234567, totalLateFees: 23456, todayPayments: 1234567, todayPaymentCount: 43 }, overdueRate: 67 },
        '/dashboard/watch-list': { total: 1, highCount: 1, mediumCount: 0, watchList: [{ contractId: 'layout-watch', customerId: 'layout-customer', customerName: longName, customerPhone: '0890000000', contractNumber: 'CT-TEST-0001', riskLevel: 'HIGH', reasons: ['ทดสอบระบบ'] }] },
        '/customers/upsell-candidates': { total: 1, candidates: [{ contractId: 'layout-upsell', customerId: 'layout-customer', customerName: longName, customerPhone: '0890000000', productModel: 'ทดสอบระบบ iPhone', paidRatio: 0.9, paidCount: 18, totalMonths: 20, reason: 'ทดสอบระบบ' }] },
        '/overdue/pipeline': { totalContracts: 130, totalAmount: 1234567, stages: [{ stage: 'NOTICE', label: 'ส่งหนังสือทวงถามและแจ้งเตือนแล้ว', count: 130, totalAmount: 1234567 }] },
        '/equity/documents': { data: [{ id: 'layout-document', docNumber: 'EQ-20261120-0001', txnDate: '2026-11-20', txnType: 'DIV_PAY', status: 'POSTED', description: longName, lines: [{ amount: '1234567', premium: '0' }] }], total: 1, page: 1, limit: 100 },
        '/equity/shareholders': [{ id: 'layout-shareholder', name: longName, taxId: '0105500000028', shares: 123456, type: 'JURISTIC_TH', isActive: true }],
        '/equity/dividend-register': { year: new Date().getFullYear(), rows: [{ shareholderId: 'layout-shareholder', name: longName, taxId: '0105500000028', payCount: 12, gross: '1234567', wht: '123456.70', net: '1111110.30', docNumbers: ['EQ-20261120-0001', 'EQ-20261220-0001'] }], totals: { gross: '1234567', wht: '123456.70', net: '1111110.30' } },
      };
      try {
        await page.addInitScript(accessToken => { localStorage.setItem('access_token', accessToken); localStorage.setItem('bc.sidebar.lastZone', 'shop'); }, token);
        await page.route('**/api/admin/**', route => {
          const path = new URL(route.request().url()).pathname.replace('/api/admin', '');
          return path in fixtures ? route.fulfill({ json: { success: true, data: fixtures[path] } }) : route.continue();
        });
        await page.goto(`${web.origin}/`);
        const verifyLayout = async (name: string) => {
          await page.waitForLoadState('networkidle');
          await page.evaluate(() => document.fonts.ready);
          // AnimatedCounter runs in requestAnimationFrame for 1200ms.
          await page.waitForTimeout(1300);
          for (const dark of [false, true]) {
            await page.evaluate(value => document.documentElement.classList.toggle('dark', value), dark);
            saveArtifact('uxui-interactions', `populated-${name}-${width}-${dark ? 'dark' : 'light'}.png`, await page.screenshot({ fullPage: true, animations: 'disabled' }));
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
          }
        };
        await page.getByText('ส่งหนังสือทวงถามและแจ้งเตือนแล้ว', { exact: true }).waitFor();
        await page.getByText(longName, { exact: true }).first().waitFor();
        await verifyLayout('dashboard');
        await web.navigate(page, '/finance/equity');
        await page.getByText('EQ-20261120-0001', { exact: true }).waitFor();
        await verifyLayout('equity');
        const verifyTableFits = async (cellCount: number, values: string[]) => {
          const table = page.locator('table').first();
          const body = table.locator('tbody');
          expect(await body.locator('tr').count()).toBe(1);
          expect(await body.locator('td').count()).toBe(cellCount);
          for (const value of values) expect(await body.innerText()).toContain(value);
          // Mobile rows now fit the viewport. Requiring horizontal overflow would
          // reject that improvement; verify every populated cell remains readable.
          for (const dark of [false, true]) {
            await page.evaluate(value => document.documentElement.classList.toggle('dark', value), dark);
            expect(await table.evaluate(element => {
              const frame = element.parentElement!;
              const box = element.getBoundingClientRect();
              return box.width > 0 && box.left >= -1 && box.right <= innerWidth + 1
                && frame.scrollWidth <= frame.clientWidth + 1;
            })).toBe(true);
            expect(await body.locator('td').evaluateAll(cells => cells.flatMap((cell, index) => {
              const box = cell.getBoundingClientRect();
              const visible = getComputedStyle(cell).visibility !== 'hidden';
              return visible && box.width > 0 && box.height > 0 && box.left >= -1 && box.right <= innerWidth + 1
                && cell.scrollWidth <= cell.clientWidth + 1 && cell.scrollHeight <= cell.clientHeight + 1
                ? [] : [{ index, visible, width: box.width, height: box.height, left: box.left, right: box.right,
                  scrollWidth: cell.scrollWidth, clientWidth: cell.clientWidth,
                  scrollHeight: cell.scrollHeight, clientHeight: cell.clientHeight }];
            }))).toEqual([]);
          }
        };
        await verifyTableFits(6, ['EQ-20261120-0001', longName, '1,234,567.00']);
        await page.getByRole('button', { name: 'ทะเบียนผู้ถือหุ้น', exact: true }).click();
        await page.getByText(longName, { exact: true }).waitFor();
        await verifyLayout('shareholders');
        await verifyTableFits(5, [longName, '0105500000028', '123,456', 'ใช้งาน']);
        await web.navigate(page, '/finance/dividend-register');
        await page.getByRole('button', { name: 'หนังสือรับรอง', exact: true }).waitFor();
        await verifyLayout('dividends');
        await verifyTableFits(8, [longName, '0105500000028', '1,234,567.00', '123,456.70', '1,111,110.30', 'EQ-20261220-0001']);
        await page.getByRole('button', { name: 'หนังสือรับรอง', exact: true }).click({ trial: true });
        expect(errors.filter(error => error.startsWith('pageerror:'))).toEqual([]);
      } finally { await context.close(); }
    }, 120000);
  }

});
