import { startDocumentsApp, DocumentsHarness } from './support/harness';
import { seedDocumentsWorld } from './support/fixtures';
import { createWorldUser, setSystemConfig } from './support/expense-fixtures';
import { startWeb, WebRuntime } from './support/web';
import { saveArtifact } from './support/artifacts';

describe('UX/UI staff roles and explicit company grants', () => {
  let h: DocumentsHarness, web: WebRuntime;
  afterAll(async () => { await web?.close(); await h?.close(); });
  it('enforces the voucher deep-link gate for all six roles and restricts a FINANCE-only accountant', async () => {
    h = await startDocumentsApp();
    const world = await seedDocumentsWorld(h.prisma);
    await setSystemConfig(h.prisma, 'viewer_role_enabled', 'true');
    const viewer = await createWorldUser(h.prisma, world, 'viewer', 'VIEWER', null);
    const financeOnly = await createWorldUser(h.prisma, world, 'finance-only', 'ACCOUNTANT', null);
    await h.prisma.user.update({ where: { id: financeOnly.id }, data: { accessibleCompanies: ['FINANCE'], primaryCompany: 'FINANCE' } });
    const branchless = await createWorldUser(h.prisma, world, 'branchless', 'BRANCH_MANAGER', null);
    web = await startWeb(h);
    const results: Array<{ role: string; grants: string[]; branchless: boolean; httpStatus: number; artifact: string }> = [];
    for (const user of [world.users.owner, world.users.branchManagerA, world.users.financeManager, world.users.accountant, world.users.salesA, viewer, financeOnly, branchless]) {
      const session = await h.login(user.email, user.password);
      const permitted = ['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT'].includes(user.role);
      const company = user.id === financeOnly.id || user.id === viewer.id ? 'FINANCE' : 'SHOP';
      const response = await h.client({ session, company }).get('/expense-documents/verify-number/PV-200001-99999');
      expect(response.status).toBe(permitted && user.id !== branchless.id ? 404 : 403);
      if (user.id === financeOnly.id) await h.client({ session, company: 'SHOP' }).get('/expense-documents').expect(403);
      const opened = await web.page({ width: 390, height: 844 });
      try {
        await opened.page.addInitScript(({ token, work }) => {
          localStorage.setItem('access_token', token);
          localStorage.setItem('bc.sidebar.lastZone', work);
        }, { token: session.token, work: company === 'FINANCE' ? 'fin' : 'shop' });
        await opened.page.goto(`${web.origin}/expenses/verify-number/PV-200001-99999`);
        await opened.page.getByText(permitted ? (user.id === branchless.id ? 'ไม่มีสิทธิ์เข้าถึงข้อมูล' : 'ไม่พบเอกสารในบริษัทและสาขาที่คุณมีสิทธิ์เข้าถึง') : 'คุณไม่มีสิทธิ์ในการเข้าถึงหน้านี้', { exact: true }).waitFor({ timeout: 20000 });
        expect(await opened.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
        const artifact = saveArtifact('uxui-roles', `${user.role}-${user.id === financeOnly.id ? 'finance-only' : user.id === branchless.id ? 'branchless' : 'default'}-390.png`, await opened.page.screenshot()).relativePath;
        results.push({ role: user.role, grants: session.user.accessibleCompanies, branchless: user.id === branchless.id, httpStatus: response.status, artifact });
      } finally { await opened.context.close(); }
    }
    saveArtifact('uxui-roles', 'role-results.json', JSON.stringify(results, null, 2));
    expect(h.external.calls).toEqual([]);
  }, 180000);
});
