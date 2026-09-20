import type { Page, Response } from '@playwright/test';
import { expect as browserExpect } from '@playwright/test';
import { Prisma } from '@prisma/client';
import { DocumentsHarness, Session, startDocumentsApp } from './support/harness';
import { DocumentsWorld, seedDocumentsWorld } from './support/fixtures';
import {
  activateContract,
  createFinancedContract,
  FinancedContract,
} from './support/receipts-fixtures';
import { startWeb, WebRuntime } from './support/web';
import { recordScenario, saveArtifact } from './support/artifacts';
import { InstallmentAccrual2ATemplate } from '../../src/modules/journal/cpa-templates/installment-accrual-2a.template';
import {
  deviceReturnFinanceBalance,
  deviceReturnShopBalance,
  recallFinanceBalance,
  swapCreditFinanceBalance,
  shopCollectTypedBalance,
} from '../../src/modules/interco-settlement/interco-typed-balance';

const DOMAIN = 'device-return-browser';
const VIEWPORTS = [
  { width: 1440, height: 1000 },
  { width: 390, height: 844 },
];
type Role = 'salesA' | 'financeManager' | 'branchManagerA' | 'accountant';
type BrowserConsole = { error: string; url: string; text: string; beforeLogin: boolean };
type BrowserHttp = { url: string; status: number; beforeLogin: boolean; body: string };
type RoleBrowser = Awaited<ReturnType<WebRuntime['page']>> & {
  session: Session;
  consoleEvents: BrowserConsole[];
  httpErrors: BrowserHttp[];
  pendingDiagnostics: Promise<void>[];
  failedResources: Array<{ url: string; error: string | undefined }>;
};
type Intake = { id: string; docNumber: string };
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });

/** Real routes/guards/accounting; only the harness's documented outbound/storage boundaries are simulated. */
describe('device-return acceptance in the real admin browser', () => {
  let h: DocumentsHarness;
  let web: WebRuntime;
  let world: DocumentsWorld;
  let owner: Session;
  let otherManager: Session;
  let lastFixturePaymentAt = 0;
  let lastObservedAuthRefreshAt = 0;
  const authRefreshTiming: Array<{ role: Role; at: string; beforeLogin: boolean }> = [];
  const contextTiming: Array<{
    role: Role;
    at: string;
    lastRefreshAt: string | null;
    waitedMs: number;
  }> = [];
  const recordAuthTiming = () =>
    saveArtifact(
      DOMAIN,
      'auth-refresh-timing.json',
      JSON.stringify(
        {
          minimumContextGapAfterRefreshMs: 15000,
          contexts: contextTiming,
          requests: authRefreshTiming,
        },
        null,
        2,
      ),
    );
  const browsers = new Map<Role, RoleBrowser>();

  const api = (session = owner) =>
    h.client({ session, company: session.user.primaryCompany as 'SHOP' | 'FINANCE' });
  const load = (id: string) => h.prisma.deviceReturn.findUniqueOrThrow({ where: { id } });
  const journals = (contractId: string) =>
    h.prisma.journalEntry.findMany({
      where: { metadata: { path: ['contractId'], equals: contractId }, deletedAt: null },
      include: { lines: true },
      orderBy: { id: 'asc' },
    });
  const returnedTag = (customerId: string) =>
    h.prisma.customerTag.findMany({
      where: { customerId, tag: 'RETURNED_DEVICE', deletedAt: null },
    });
  const row = (page: Page, text: string) => page.locator('tr').filter({ hasText: text });
  const assertHttp = (status: number, expected: number, body: unknown, label: string) => {
    if (status !== expected) {
      const details = `${label}: expected HTTP ${expected}, received ${status}\n${JSON.stringify(body, null, 2)}`;
      saveArtifact(DOMAIN, `http-failure-${Date.now()}.txt`, details);
      throw new Error(details);
    }
  };
  const response = async (
    page: Page,
    path: string,
    action: () => Promise<unknown>,
    status = 201,
  ) => {
    const [result] = await Promise.all([
      page.waitForResponse(
        (r) => new URL(r.url()).pathname.endsWith(path) && r.request().method() === 'POST',
      ),
      action(),
    ]);
    const body: unknown = await result.json();
    assertHttp(result.status(), status, body, `POST ${path}`);
    return body as { data: Intake };
  };
  const actor = async (role: Role, width = 1440) => {
    let value = browsers.get(role);
    if (!value) {
      // Initial-02 observed two StrictMode bootstrap refreshes per empty context and hit the
      // real 10/minute limit. Pace context creation globally; never retry/ignore a 429 or alter guards.
      const pacingStartedAt = Date.now();
      while (Date.now() - lastObservedAuthRefreshAt < 15000) {
        await new Promise((resolve) =>
          setTimeout(resolve, 15000 - (Date.now() - lastObservedAuthRefreshAt)),
        );
      }
      contextTiming.push({
        role,
        at: new Date().toISOString(),
        lastRefreshAt: lastObservedAuthRefreshAt
          ? new Date(lastObservedAuthRefreshAt).toISOString()
          : null,
        waitedMs: Date.now() - pacingStartedAt,
      });
      recordAuthTiming();
      const created = await web.page(VIEWPORTS[0]);
      let loggedIn = false;
      const consoleEvents: BrowserConsole[] = [];
      const httpErrors: BrowserHttp[] = [];
      const pendingDiagnostics: Promise<void>[] = [];
      const failedResources: RoleBrowser['failedResources'] = [];
      created.page.on('request', (request) => {
        if (
          request.method() === 'POST' &&
          new URL(request.url()).pathname.endsWith('/auth/refresh')
        ) {
          lastObservedAuthRefreshAt = Date.now();
          authRefreshTiming.push({
            role,
            at: new Date(lastObservedAuthRefreshAt).toISOString(),
            beforeLogin: !loggedIn,
          });
          recordAuthTiming();
        }
      });
      created.page.on('console', (message) => {
        if (message.type() === 'error')
          consoleEvents.push({
            error: `console: ${message.text()} (${message.location().url})`,
            url: message.location().url,
            text: message.text(),
            beforeLogin: !loggedIn,
          });
      });
      created.page.on('requestfailed', (request) => {
        failedResources.push({ url: request.url(), error: request.failure()?.errorText });
      });
      created.page.on('response', (result) => {
        if (new URL(result.url()).pathname.endsWith('/auth/login') && result.ok()) loggedIn = true;
        if (result.status() >= 400) {
          const beforeLogin = !loggedIn;
          pendingDiagnostics.push(
            result
              .text()
              .then((body) => {
                httpErrors.push({ url: result.url(), status: result.status(), beforeLogin, body });
              })
              .catch(() => {
                httpErrors.push({
                  url: result.url(),
                  status: result.status(),
                  beforeLogin,
                  body: '<unavailable>',
                });
              }),
          );
        }
      });
      const login = created.page.waitForResponse(
        (r) => new URL(r.url()).pathname.endsWith('/auth/login') && r.request().method() === 'POST',
      );
      await web.login(created.page, world.users[role].email, world.password);
      const result = await (await login).json();
      const auth = result.data ?? result;
      value = {
        ...created,
        session: { token: auth.accessToken, user: auth.user },
        consoleEvents,
        httpErrors,
        pendingDiagnostics,
        failedResources,
      };
      expect(value.session.token).toEqual(expect.any(String));
      browsers.set(role, value);
    }
    await value.page.setViewportSize(VIEWPORTS.find((v) => v.width === width)!);
    return value;
  };
  const evidence = async (
    id: string,
    title: string,
    routes: string[],
    work: () => Promise<void>,
  ) => {
    const artifacts: string[] = [];
    try {
      await work();
      for (const [role, browser] of browsers) {
        await Promise.all(browser.pendingDiagnostics);
        const unexplained = [...browser.errors];
        const classified: Array<{ error: string; reason: string }> = [];
        for (const event of browser.consoleEvents) {
          const initialAuth =
            event.beforeLogin &&
            event.text.includes('status of 401') &&
            /^\/api\/admin\/auth\/(me|refresh|logout)$/.test(
              new URL(event.url, web.origin).pathname,
            ) &&
            browser.httpErrors.some(
              (http) => http.url === event.url && http.beforeLogin && http.status === 401,
            );
          const offlineFont =
            event.text === 'Failed to load resource: net::ERR_INTERNET_DISCONNECTED' &&
            ['fonts.googleapis.com', 'fonts.gstatic.com'].includes(
              new URL(event.url, web.origin).hostname,
            ) &&
            browser.failedResources.some(
              (resource) =>
                resource.url === event.url && resource.error === 'net::ERR_INTERNET_DISCONNECTED',
            );
          if (initialAuth || offlineFont) {
            const index = unexplained.indexOf(event.error);
            if (index !== -1) unexplained.splice(index, 1);
            classified.push({
              error: event.error,
              reason: initialAuth
                ? 'Observed 401 during empty-context auth bootstrap before successful login'
                : 'Observed external Google Fonts request blocked by required network-none runtime; local fallback fonts used',
            });
          }
        }
        artifacts.push(
          saveArtifact(
            DOMAIN,
            `${id}-${role}-browser-diagnostics.json`,
            JSON.stringify({ classified, unexplained, httpErrors: browser.httpErrors }, null, 2),
          ).relativePath,
        );
        expect(unexplained).toEqual([]);
        expect(
          browser.httpErrors.filter((http) => !http.beforeLogin && http.status === 401),
        ).toEqual([]);
        await browserExpect(
          browser.page.getByText('เกิดข้อผิดพลาดที่ไม่คาดคิด', { exact: true }),
        ).toHaveCount(0);
        artifacts.push(
          saveArtifact(
            DOMAIN,
            `${id}-${role}.png`,
            await browser.page.screenshot({ fullPage: true }),
          ).relativePath,
        );
      }
      recordScenario(DOMAIN, {
        id: `${DOMAIN}/${id}`,
        title,
        documents: ['DEVICE_RETURN'],
        routes,
        guards: [
          'real login form',
          'JwtAuthGuard',
          'RolesGuard',
          'real receiving-branch service scope',
          'EntityScopeInterceptor',
        ],
        renderer: 'chromium',
        source: 'api',
        status: 'PASS',
        artifacts,
        simulated: [
          'synthetic contracts and sold FINANCE products; real 1A and payment routes',
          'LINE/SMS/email transports recorded, never sent',
          'private local storage',
          'Vite serves current web source; browser socket transport closed by shared web helper',
        ],
        unverified: ['real LINE delivery', 'MDM manual unlocking', 'physical device custody'],
      });
    } catch (error) {
      for (const [role, browser] of browsers) {
        await Promise.all(browser.pendingDiagnostics);
        saveArtifact(
          DOMAIN,
          `failure-${id}-${role}.html`,
          await browser.page.content().catch(() => 'page unavailable'),
        );
        saveArtifact(
          DOMAIN,
          `failure-${id}-${role}.json`,
          JSON.stringify(
            {
              url: browser.page.url(),
              errors: browser.errors,
              httpErrors: browser.httpErrors,
              consoleEvents: browser.consoleEvents,
              error: String(error),
            },
            null,
            2,
          ),
        );
        await browser.page
          .screenshot({ fullPage: true })
          .then((bytes) => saveArtifact(DOMAIN, `failure-${id}-${role}.png`, bytes))
          .catch(() => undefined);
      }
      throw error;
    }
  };
  const fixture = async (label: string, branch: 'a' | 'b' = 'a', golden = false) => {
    const customer = await h.prisma.customer.create({
      data: {
        name: `ทดสอบระบบ ${world.prefix} ${label}`,
        phone: '0800000099',
        nationalId: `${world.prefix}-${label}`,
        lineIdFinance: `TEST-NOT-SENT-${world.prefix}-${label}`,
      },
    });
    const contract = await createFinancedContract(h.prisma, {
      prefix: world.prefix,
      label,
      branchId: world.branches[branch].id,
      customerId: customer.id,
      salespersonId: world.users[branch === 'a' ? 'salesA' : 'salesB'].id,
    });
    const finance = await h.prisma.companyInfo.findUniqueOrThrow({
      where: { companyCode: 'FINANCE' },
    });
    // The shared document fixture starts IN_STOCK. Match an actual financed sale before exercising returns.
    await h.prisma.product.update({
      where: { id: contract.productId },
      data: { status: 'SOLD_INSTALLMENT', ownedByCompanyId: finance.id },
    });
    await h.prisma.contract.update({
      where: { id: contract.id },
      data: { workflowStatus: 'APPROVED' },
    });
    await activateContract(h.app, contract.id);
    if (golden) {
      for (const installmentNo of [1, 2, 3, 4]) {
        const schedule = await h.prisma.installmentSchedule.findFirstOrThrow({
          where: { contractId: contract.id, installmentNo },
        });
        await h.app.get(InstallmentAccrual2ATemplate).execute(schedule.id);
        // Both installed guards count this endpoint; respect its five/10s limit without overriding or retrying it.
        const waitForThrottleWindow = Math.max(0, 6000 - (Date.now() - lastFixturePaymentAt));
        if (waitForThrottleWindow > 0)
          await new Promise((resolve) => setTimeout(resolve, waitForThrottleWindow));
        lastFixturePaymentAt = Date.now();
        const paid = await api().post('/payments/record', {
          contractId: contract.id,
          installmentNo,
          amount: contract.installmentTotal.toNumber(),
          paymentMethod: 'CASH',
          depositAccountCode: '11-1101',
          case: 'NORMAL',
          transactionRef: `${world.prefix}-${label}-${installmentNo}`,
        });
        assertHttp(
          paid.status,
          201,
          paid.body,
          `POST /payments/record ${label} installment ${installmentNo}`,
        );
      }
      expect(
        await h.prisma.installmentSchedule.count({
          where: {
            contractId: contract.id,
            installmentNo: { gte: 5 },
            accrualJournalEntryId: null,
          },
        }),
      ).toBe(8);
      expect(
        await h.prisma.payment.count({ where: { contractId: contract.id, status: 'PAID' } }),
      ).toBe(4);
    }
    return contract;
  };
  const fillIntake = async (page: Page, repossession = false) => {
    await page.locator('#device-return-reason').waitFor();
    if (repossession) {
      await browserExpect(page.locator('#device-return-reason')).toHaveValue('AFTER_TERMINATION');
      await browserExpect(page.locator('#device-return-reason')).toBeDisabled();
    } else await page.locator('#device-return-reason').selectOption('UNAFFORDABLE');
    await page.getByRole('button', { name: 'B', exact: true }).click();
    await page.locator('#device-return-appraisal').fill('7000');
    await page
      .locator('#device-return-notes')
      .fill('ทดสอบระบบ สภาพจริงประเมินตามเครื่อง ไม่มีการส่งข้อมูลจริง');
    const created = await response(page, '/device-returns', () =>
      page.getByRole('button', { name: 'บันทึกรับเครื่องคืน', exact: true }).last().click(),
    );
    return created.data;
  };
  const create = async (contract: FinancedContract, session: Session, branchId?: string) => {
    const result = await api(session).post('/device-returns', {
      contractId: contract.id,
      deviceReceivedAt: today(),
      conditionGrade: 'B',
      appraisalPrice: 7000,
      returnReason: 'UNAFFORDABLE',
      notes: 'ทดสอบระบบ รับเครื่องข้ามสาขาจริง',
      ...(branchId ? { receivingBranchId: branchId } : {}),
    });
    expect({ status: result.status, body: result.body }).toMatchObject({ status: 201 });
    return result.body.data as Intake;
  };
  const notification = async (intake: Intake, cancellation = false) => {
    const persisted = await load(intake.id);
    expect(persisted.lineNotifyStatus).toBe('SENT');
    const matching = h.external.calls.filter(
      (call) =>
        call.channel === 'line' &&
        typeof call.payload === 'string' &&
        call.payload.includes(intake.docNumber),
    );
    expect(matching.length).toBeGreaterThan(0);
    const text = matching[matching.length - 1].payload;
    expect(typeof text).toBe('string');
    expect(text).not.toMatch(/ราคาประเมิน|7,?000|appraisal/i);
    expect(text).not.toMatch(/สัญญากลับมาดำเนินต่อ|สัญญาจะกลับมาดำเนินต่อ/);
    if (cancellation) expect(text).toContain('ยกเลิก');
    saveArtifact(
      DOMAIN,
      `${intake.docNumber}-${cancellation ? 'closed' : 'intake'}-line.json`,
      JSON.stringify(matching, null, 2),
    );
  };

  beforeAll(async () => {
    h = await startDocumentsApp();
    world = await seedDocumentsWorld(h.prisma);
    // Canonical runtime seeds provide a system actor; the minimal documents harness seeds only the journal actor.
    // This scoped, non-loginable actor enables the real NO_LINE Todo fallback without replacing that service.
    await h.prisma.user.create({
      data: {
        email: `${world.prefix}.system@example.invalid`,
        name: `ทดสอบระบบ ${world.prefix} system`,
        password: 'not-a-login',
        role: 'OWNER',
        isSystemUser: true,
        isActive: false,
        accessibleCompanies: ['SHOP', 'FINANCE'],
        primaryCompany: 'SHOP',
      },
    });
    owner = await h.login(world.users.owner.email, world.password);
    // A real second-branch manager, with the existing manager's unmodified role/company grants.
    const manager = await h.prisma.user.findUniqueOrThrow({
      where: { id: world.users.branchManagerA.id },
    });
    const other = await h.prisma.user.create({
      data: {
        email: `${world.prefix}.manager-b@example.invalid`,
        name: `ทดสอบระบบ ${world.prefix} BM B`,
        password: manager.password,
        role: manager.role,
        branchId: world.branches.b.id,
        accessibleCompanies: manager.accessibleCompanies,
        primaryCompany: manager.primaryCompany,
      },
    });
    otherManager = await h.login(other.email, world.password);
    web = await startWeb(h);
  }, 180000);
  afterAll(async () => {
    await web?.close();
    await h?.close();
  });
  beforeEach(async () => {
    // Each scenario starts with actual login and a fresh query cache. Out-of-band fixture writes in
    // another scenario cannot refresh a previously mounted production page's three-minute cache.
    for (const browser of browsers.values()) await browser.context.close();
    browsers.clear();
  });

  for (const viewport of VIEWPORTS) {
    it(`${viewport.width}px: SALES intake → FINANCE confirmation → real INTER-CO cash and customer history`, async () => {
      await evidence(
        `confirm-${viewport.width}`,
        'Own-contract SALES intake, FINANCE confirmation and typed cash clearing',
        [
          'GET /contracts/:id',
          'POST /device-returns',
          'POST /device-returns/:id/confirm',
          'GET /interco-settlement/pending',
          'POST /interco-settlement/device-returns/:contractId/settle-cash',
          'GET /customers/:id/journey',
        ],
        async () => {
          const contract = await fixture(`DR${viewport.width}`, 'a', true);
          const before = await journals(contract.id);
          const sales = await actor('salesA', viewport.width);
          await web.navigate(sales.page, `/contracts/${contract.id}`);
          await sales.page.getByRole('button', { name: 'รับเครื่องคืน', exact: true }).click();
          const intake = await fillIntake(sales.page);
          await browserExpect(
            sales.page.getByText(`รับเครื่องคืนแล้ว รอ FINANCE ยืนยัน ${intake.docNumber}`, {
              exact: true,
            }),
          ).toBeVisible();
          expect(await load(intake.id)).toMatchObject({
            status: 'PENDING_CONFIRM',
            returnKind: 'VOLUNTARY',
            previousContractStatus: 'ACTIVE',
            receivingBranchId: world.branches.a.id,
          });
          expect(
            (await h.prisma.contract.findUniqueOrThrow({ where: { id: contract.id } })).status,
          ).toBe('TERMINATED');
          expect((await journals(contract.id)).map((j) => j.id)).toEqual(before.map((j) => j.id));
          expect(await returnedTag(contract.customerId)).toEqual([
            expect.objectContaining({ source: 'AUTO' }),
          ]);
          await notification(intake);
          await api(sales.session).post(`/device-returns/${intake.id}/confirm`, {}).expect(403);
          await api(sales.session)
            .post(`/device-returns/${intake.id}/reject`, {
              reason: 'ทดสอบระบบ ไม่มีสิทธิ์ยืนยันหรือส่งกลับ',
            })
            .expect(403);

          const finance = await actor('financeManager', viewport.width);
          await web.navigate(finance.page, '/repossessions');
          await row(finance.page, intake.docNumber)
            .getByRole('button', { name: 'ยืนยัน', exact: true })
            .click();
          await browserExpect(finance.page.getByTestId('dr-appraisal')).toContainText('7,000');
          await browserExpect(
            finance.page.getByTestId('dr-appraisal').locator('input'),
          ).toHaveCount(0);
          await response(finance.page, `/device-returns/${intake.id}/confirm`, () =>
            finance.page.getByRole('button', { name: 'ยืนยันรับเครื่องคืน', exact: true }).click(),
          );
          await browserExpect(row(finance.page, intake.docNumber)).toHaveCount(0);
          expect((await load(intake.id)).status).toBe('CONFIRMED');
          expect(
            (await h.prisma.contract.findUniqueOrThrow({ where: { id: contract.id } })).status,
          ).toBe('CLOSED_BAD_DEBT');
          const shop = await h.prisma.companyInfo.findUniqueOrThrow({
            where: { companyCode: 'SHOP' },
          });
          expect(
            await h.prisma.product.findUniqueOrThrow({ where: { id: contract.productId } }),
          ).toMatchObject({
            status: 'REPOSSESSED',
            category: 'PHONE_USED',
            branchId: world.branches.a.id,
            ownedByCompanyId: shop.id,
          });
          const posted = (await journals(contract.id)).filter(
            (j) => !before.some((old) => old.id === j.id),
          );
          expect(posted).toHaveLength(2);
          for (const entry of posted) {
            expect(entry.status).toBe('POSTED');
            expect(entry.metadata).toMatchObject({
              deviceReturnId: intake.id,
              shopReceivableType: 'DEVICE_RETURN',
            });
            expect(
              entry.lines
                .reduce((sum, line) => sum.add(line.debit).sub(line.credit), new Prisma.Decimal(0))
                .toFixed(2),
            ).toBe('0.00');
          }
          const jp5 = posted.find((j) => (j.metadata as Record<string, unknown>).tag === 'JP5')!;
          expect(jp5).toBeDefined();
          expect(jp5.lines.find((line) => line.accountCode === '11-2107')?.debit.toFixed(2)).toBe(
            '7000.00',
          );
          const shopLeg = posted.find((j) => j.companyId === shop.id)!;
          expect(
            shopLeg.lines.find((line) => line.accountCode === 'S21-1104')?.credit.toFixed(2),
          ).toBe('7000.00');
          const ids = (await journals(contract.id)).map((j) => j.id);
          await api(finance.session).post(`/device-returns/${intake.id}/confirm`, {}).expect(409);
          expect((await journals(contract.id)).map((j) => j.id)).toEqual(ids);
          expect((await deviceReturnFinanceBalance(h.prisma, contract.id)).toFixed(2)).toBe(
            '7000.00',
          );
          expect((await deviceReturnShopBalance(h.prisma, contract.id)).toFixed(2)).toBe('7000.00');
          const otherTypes = async () =>
            Promise.all([
              recallFinanceBalance(h.prisma, contract.id),
              swapCreditFinanceBalance(h.prisma, contract.id),
              shopCollectTypedBalance(h.prisma, contract.id),
            ]).then((values) => values.map((v) => v.toFixed(2)));
          const untouched = await otherTypes();

          await web.navigate(finance.page, '/accounting/intercompany');
          const cashRow = row(finance.page, contract.contractNumber).filter({
            has: finance.page.getByRole('button', { name: 'รับเงินสดค่าเครื่อง', exact: true }),
          });
          await browserExpect(cashRow).toContainText('7,000');
          await cashRow.getByRole('button', { name: 'รับเงินสดค่าเครื่อง', exact: true }).click();
          const dialog = finance.page.getByRole('dialog');
          await browserExpect(dialog).toContainText('S11-1202');
          await browserExpect(dialog.locator('#recall-cash-amount')).toHaveValue(/^7000(?:\.0+)?$/);
          await response(
            finance.page,
            `/interco-settlement/device-returns/${contract.id}/settle-cash`,
            () =>
              dialog
                .getByRole('button', { name: 'บันทึกรับเงินค่าเครื่องคืน', exact: true })
                .click(),
          );
          await browserExpect(dialog).toHaveCount(0);
          expect((await deviceReturnFinanceBalance(h.prisma, contract.id)).toFixed(2)).toBe('0.00');
          expect((await deviceReturnShopBalance(h.prisma, contract.id)).toFixed(2)).toBe('0.00');
          expect(await otherTypes()).toEqual(untouched);
          const cleared = (await journals(contract.id)).filter((j) => !ids.includes(j.id));
          expect(cleared).toHaveLength(2);
          expect(
            cleared
              .flatMap((j) => j.lines)
              .find((line) => line.accountCode === 'S11-1202')
              ?.credit.toFixed(2),
          ).toBe('7000.00');

          await web.navigate(finance.page, `/customers/${contract.customerId}?tab=journey`);
          await browserExpect(
            finance.page.getByText('เคยคืนเครื่อง', { exact: true }).first(),
          ).toBeVisible();
          await browserExpect(
            finance.page.getByText('คืนเครื่อง', { exact: true }).first(),
          ).toBeVisible();
          expect(
            await h.prisma.customerJourneyEntry.count({
              where: { customerId: contract.customerId, kind: 'DEVICE_RETURNED' },
            }),
          ).toBe(1);
          saveArtifact(
            DOMAIN,
            `${viewport.width}-journal-evidence.json`,
            JSON.stringify({ intake, posted, cleared }, null, 2),
          );
        },
      );
    }, 240000);
  }

  it('cross-branch receive, FINANCE reject, recreate, receiving BM cancel, other BM denied', async () => {
    await evidence(
      'close-and-scope',
      'Cross-branch receiving scope and voluntary restoration without accounting',
      [
        'POST /device-returns',
        'POST /device-returns/:id/reject',
        'POST /device-returns/:id/cancel',
        'GET /device-returns',
      ],
      async () => {
        const contract = await fixture('CLOSE', 'b');
        const manager = await actor('branchManagerA');
        const finance = await actor('financeManager');
        const before = (await journals(contract.id)).map((j) => j.id);
        const intake = await create(contract, manager.session);
        expect(await load(intake.id)).toMatchObject({
          receivingBranchId: world.branches.a.id,
          returnKind: 'VOLUNTARY',
        });
        const scoped = await api(otherManager)
          .get(`/device-returns?contractId=${contract.id}`)
          .expect(200);
        expect(scoped.body.data.data).toEqual([]);
        await api(otherManager).get(`/device-returns/${intake.id}`).expect(404);
        await api(otherManager).post(`/device-returns/${intake.id}/cancel`, {}).expect(404);
        await web.navigate(finance.page, '/repossessions');
        await row(finance.page, intake.docNumber)
          .getByRole('button', { name: 'ส่งกลับ', exact: true })
          .click();
        await finance.page
          .getByRole('dialog')
          .getByRole('textbox')
          .fill('ทดสอบระบบ ตรวจสภาพใหม่ก่อนรับคืน');
        await response(finance.page, `/device-returns/${intake.id}/reject`, () =>
          finance.page.getByRole('button', { name: 'ยืนยันส่งกลับ', exact: true }).click(),
        );
        await browserExpect(row(finance.page, intake.docNumber)).toHaveCount(0);
        expect((await load(intake.id)).status).toBe('REJECTED');
        expect(
          (await h.prisma.contract.findUniqueOrThrow({ where: { id: contract.id } })).status,
        ).toBe('ACTIVE');
        expect(await returnedTag(contract.customerId)).toHaveLength(0);
        await notification(intake, true);
        const recreated = await create(contract, manager.session);
        expect(recreated.id).not.toBe(intake.id);
        await web.navigate(manager.page, '/repossessions');
        await row(manager.page, recreated.docNumber)
          .getByRole('button', { name: 'ยกเลิก', exact: true })
          .click();
        await response(manager.page, `/device-returns/${recreated.id}/cancel`, () =>
          manager.page.getByRole('button', { name: 'ยืนยันยกเลิกใบ', exact: true }).click(),
        );
        await browserExpect(row(manager.page, recreated.docNumber)).toHaveCount(0);
        expect((await load(recreated.id)).status).toBe('CANCELED');
        expect(
          (await h.prisma.contract.findUniqueOrThrow({ where: { id: contract.id } })).status,
        ).toBe('ACTIVE');
        expect(await returnedTag(contract.customerId)).toHaveLength(0);
        expect((await journals(contract.id)).map((j) => j.id)).toEqual(before);
        await notification(recreated, true);
      },
    );
  }, 180000);

  it('real termination dispatch → awaiting REPOSSESSION intake; NO_LINE fallback and accountant list', async () => {
    await evidence(
      'dispatched-and-accountant',
      'Dispatched termination intake, no-LINE fallback and ACCOUNTANT permission-safe list',
      [
        'POST /overdue/letters/:id/pdf-generated',
        'POST /overdue/letters/:id/dispatch',
        'GET /device-returns/awaiting-repossession',
        'POST /device-returns',
        'POST /device-returns/:id/resend-line',
      ],
      async () => {
        const contract = await fixture('LEGAL');
        await h.prisma.contract.update({ where: { id: contract.id }, data: { status: 'OVERDUE' } });
        await h.prisma.customer.update({
          where: { id: contract.customerId },
          data: { lineIdFinance: null },
        });
        const letter = await h.prisma.contractLetter.create({
          data: {
            contractId: contract.id,
            letterType: 'CONTRACT_TERMINATION_60D',
            letterNumber: `${world.prefix}-DR60`,
          },
        });
        const manager = await actor('branchManagerA');
        await api(manager.session)
          .post(`/overdue/letters/${letter.id}/pdf-generated`, {})
          .expect(201);
        await api(manager.session)
          .post(`/overdue/letters/${letter.id}/dispatch`, { trackingNumber: 'EM000000060TH' })
          .expect(201);
        expect(
          (await h.prisma.contract.findUniqueOrThrow({ where: { id: contract.id } })).status,
        ).toBe('TERMINATED');
        await web.navigate(manager.page, '/repossessions');
        await row(manager.page, contract.contractNumber)
          .getByRole('button', { name: 'รับเครื่องคืน', exact: true })
          .click();
        const intake = await fillIntake(manager.page, true);
        expect(await load(intake.id)).toMatchObject({
          returnKind: 'REPOSSESSION',
          returnReason: 'AFTER_TERMINATION',
          previousContractStatus: null,
          lineNotifyStatus: 'NO_LINE',
        });
        await browserExpect(
          row(manager.page, contract.contractNumber).getByRole('button', {
            name: 'รับเครื่องคืน',
            exact: true,
          }),
        ).toHaveCount(0);
        expect(
          await h.prisma.todo.count({
            where: {
              title: { contains: intake.docNumber, startsWith: 'แจ้งลูกค้าไม่ได้ ไม่มีไลน์ผูก' },
              deletedAt: null,
            },
          }),
        ).toBe(1);
        const pending = row(manager.page, intake.docNumber);
        await browserExpect(pending).toContainText('ไม่มีไลน์');
        await h.prisma.customer.update({
          where: { id: contract.customerId },
          data: { lineIdFinance: `TEST-NOT-SENT-${world.prefix}-LEGAL` },
        });
        await response(manager.page, `/device-returns/${intake.id}/resend-line`, () =>
          pending.getByTitle('ส่งไลน์แจ้งลูกค้าอีกครั้ง').click(),
        );
        await notification(intake);

        const accountant = await actor('accountant');
        const awaitingRequests: string[] = [];
        const observe = (r: Response) => {
          if (new URL(r.url()).pathname.endsWith('/device-returns/awaiting-repossession'))
            awaitingRequests.push(`${r.status()} ${r.url()}`);
        };
        accountant.page.on('response', observe);
        try {
          await web.navigate(accountant.page, '/repossessions');
          await browserExpect(row(accountant.page, intake.docNumber)).toBeVisible();
          await browserExpect(
            row(accountant.page, intake.docNumber).getByRole('button', {
              name: 'ยืนยัน',
              exact: true,
            }),
          ).toHaveCount(0);
          expect(awaitingRequests).toEqual([]);
        } finally {
          accountant.page.off('response', observe);
        }
        await pending.getByRole('button', { name: 'ยกเลิก', exact: true }).click();
        await response(manager.page, `/device-returns/${intake.id}/cancel`, () =>
          manager.page.getByRole('button', { name: 'ยืนยันยกเลิกใบ', exact: true }).click(),
        );
        expect(
          (await h.prisma.contract.findUniqueOrThrow({ where: { id: contract.id } })).status,
        ).toBe('TERMINATED');
        await notification(intake, true);
      },
    );
  }, 180000);

  it('payment wizard retains its five payment actions and has no device-return entry', async () => {
    await evidence(
      'payment-wizard',
      'Real payment wizard keeps payment actions and removes the legacy return chip',
      ['GET /payments/pending'],
      async () => {
        const contract = await fixture('WIZARD');
        const finance = await actor('financeManager');
        const legacyPosts: string[] = [];
        const observe = (r: Response) => {
          if (
            r.request().method() === 'POST' &&
            new URL(r.url()).pathname.endsWith('/repossessions')
          )
            legacyPosts.push(r.url());
        };
        finance.page.on('response', observe);
        try {
          await web.navigate(
            finance.page,
            `/payments?search=${encodeURIComponent(contract.contractNumber)}`,
          );
          await row(finance.page, contract.contractNumber)
            .getByRole('button', { name: 'รับชำระ', exact: true })
            .first()
            .click();
          const dialog = finance.page.getByRole('dialog');
          for (const label of ['ปกติ', 'แบ่งชำระ', 'ล่วงหน้า', 'ปิดยอด', 'ปรับดิว']) {
            await browserExpect(
              dialog.getByRole('button', { name: label, exact: true }),
            ).toBeVisible();
          }
          await browserExpect(
            dialog.getByRole('button', { name: /คืนเครื่อง|ยึดเครื่อง/ }),
          ).toHaveCount(0);
          await dialog.getByRole('button', { name: 'แบ่งชำระ', exact: true }).click();
          await browserExpect(
            dialog.getByRole('button', { name: 'แบ่งชำระ', exact: true }),
          ).toHaveAttribute('aria-pressed', 'true');
          await dialog.getByRole('button', { name: 'ปกติ', exact: true }).click();
          expect(legacyPosts).toEqual([]);
          saveArtifact(
            DOMAIN,
            'payment-wizard-open.png',
            await finance.page.screenshot({ fullPage: true }),
          );
          await dialog.getByRole('button', { name: 'ยกเลิก', exact: true }).click();
        } finally {
          finance.page.off('response', observe);
        }
      },
    );
  }, 120000);
});
