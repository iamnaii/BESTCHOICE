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

});
