import { AuditInterceptor } from '../audit/audit.interceptor';
import { bangkokDateString } from '../../utils/date.util';
import { currentDomainAccess } from './access-execution-context';
import { TenderSourcePlan } from './access-tender-source';
import { AccessTenderBoundaries } from './access-tender-boundaries';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { Test } from '@nestjs/testing';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { PermissionKey } from '@installment/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AccessSnapshotService } from './access-snapshot.service';
import { AccessResourceService } from './access-resource.service';
import { AccessPolicyService } from './access-policy';
import { AccessPolicyInterceptor } from './access-policy.interceptor';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ShopTendersController } from '../shop-tenders/shop-tenders.controller';
import { ShopTendersReportService } from '../shop-tenders/shop-tenders-report.service';
import { ShopCashCloseService } from '../shop-tenders/shop-cash-close.service';
import { ShopCashHoldingService } from '../shop-tenders/shop-cash-holding.service';
import { ShopCashOverviewService } from '../shop-tenders/shop-cash-overview.service';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../storage/storage.service';
import { JournalAutoService } from '../journal/journal-auto.service';
import { CompanyResolverService } from '../journal/company-resolver.service';
import { ImportedSalesController } from '../imported-sales/imported-sales.controller';
import { ImportedSalesService } from '../imported-sales/imported-sales.service';

const url = process.env.EMPLOYEE_ACCESS_TEST_DATABASE_URL;
if (
  !url?.includes('/bc_access_task2?host=/tmp/bc-access-tender.') ||
  process.env.DATABASE_URL !== url ||
  process.env.DATABASE_URL_FINANCE !== url
)
  throw new Error('Both database URLs must use owned isolated tender PostgreSQL');
const db = new PrismaClient({ datasources: { db: { url } } });
const testRun = randomUUID();
const auditPromises = new Set<Promise<unknown>>();
let snapshotOverride: Awaited<ReturnType<AccessSnapshotService['forUser']>> | undefined;
const snapshots = new AccessSnapshotService(db as PrismaService);
let app: INestApplication,
  reader: string,
  denied: string,
  foreign: string,
  branchOnly: string,
  owner: string;
let trustedId: string,
  unknownId: string,
  branchId: string,
  foreignBranch: string,
  tenderReader: string;
async function user(role: 'ACCOUNTANT' | 'OWNER' = 'ACCOUNTANT') {
  return (
    await db.user.create({
      data: {
        name: 'Owned tender tester',
        email: randomUUID() + '@test.invalid',
        password: 'unused',
        role,
        accessManaged: true,
      },
    })
  ).id;
}
async function grant(
  userId: string,
  permissions: PermissionKey[],
  companyCode = 'SHOP',
  branches?: string[],
) {
  const position = await db.accessPosition.create({
    data: { code: randomUUID(), name: 'Owned tender test', permissions },
  });
  return db.employeeAccessAssignment.create({
    data: {
      userId,
      positionId: position.id,
      companyCode,
      scope: branches ? 'BRANCHES' : 'COMPANY',
      ...(branches ? { branches: { create: branches.map((branchId) => ({ branchId })) } } : {}),
    },
  });
}
function http(path: string, actor = reader) {
  return request(app.getHttpServer())
    .get(path)
    .set('x-test-user', actor)
    .expect('x-owned-tender-app', testRun);
}
beforeAll(async () => {
  const shop = await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'SHOP' } });
  branchId = (await db.branch.create({ data: { name: 'Owned tender branch', companyId: shop.id } }))
    .id;
  foreignBranch = (
    await db.branch.create({ data: { name: 'Foreign tender branch', companyId: shop.id } })
  ).id;
  tenderReader = await user();
  await grant(tenderReader, ['shop-tenders.read'], 'SHOP', [branchId]);
  [reader, denied, foreign, branchOnly, owner] = await Promise.all([
    user(),
    user(),
    user(),
    user(),
    user('OWNER'),
  ]);
  await grant(reader, ['imported-sales.read']);
  await grant(foreign, ['imported-sales.read'], 'FINANCE');
  await grant(branchOnly, ['imported-sales.read'], 'SHOP', [branchId]);
  const data = {
    barcode: randomUUID(),
    productName: 'Historical imported phone',
    category: 'Phone',
    buyerLabel: 'Historical label',
    shopLabel: 'Must not infer branch',
    orderNumber: randomUUID(),
    paymentType: 'CASH',
    priceGroup: 'Retail',
    saleChannel: 'CASH',
    costTotal: '70.01',
    listPrice: '100',
    salePrice: '100',
    profit: '29.99',
    salespersonName: 'Must not infer assignment',
    soldAt: new Date('2026-09-30T23:30:00Z'),
    importBatch: testRun,
  };
  trustedId = (await db.importedSale.create({ data: { ...data, source: 'TOOLTIFY' } })).id;
  unknownId = (await db.importedSale.create({ data: { ...data, source: 'UNKNOWN' } })).id;
  const module = await Test.createTestingModule({
    controllers: [ImportedSalesController, ShopTendersController],
    providers: [
      AccessTenderBoundaries,
      ShopTendersReportService,
      ShopCashCloseService,
      ShopCashHoldingService,
      ShopCashOverviewService,
      AuditService,
      { provide: StorageService, useValue: {} },
      { provide: JournalAutoService, useValue: {} },
      { provide: CompanyResolverService, useValue: {} },
      ImportedSalesService,
      AccessResourceService,
      AccessPolicyService,
      { provide: PrismaService, useValue: db },
      { provide: AccessSnapshotService, useValue: snapshots },
      { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
      { provide: APP_INTERCEPTOR, useClass: AccessPolicyInterceptor },
    ],
  })
    .overrideGuard(JwtAuthGuard)
    .useValue({
      canActivate: async (ctx: ExecutionContext) => {
        const req = ctx.switchToHttp().getRequest(),
          id = req.headers['x-test-user'];
        req.user = {
          ...(await db.user.findUniqueOrThrow({ where: { id } })),
          access: snapshotOverride?.userId === id ? snapshotOverride : await snapshots.forUser(id),
        };
        return true;
      },
    })
    .overrideGuard(RolesGuard)
    .useValue({ canActivate: () => true })
    .compile();
  app = module.createNestApplication();
  app.use(
    (_req: unknown, res: { setHeader: (key: string, value: string) => void }, next: () => void) => {
      res.setHeader('x-owned-tender-app', testRun);
      next();
    },
  );
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  await app.listen(0, '127.0.0.1');
  const audit = app.get(AuditService),
    log = audit.log.bind(audit);
  audit.log = (...args: Parameters<AuditService['log']>) => {
    const promise = log(...args);
    auditPromises.add(promise);
    void promise.finally(() => auditPromises.delete(promise)).catch(() => undefined);
    return promise;
  };
}, 60000);
afterAll(async () => {
  await app?.close();
  await Promise.allSettled([...auditPromises]);
  await db.$disconnect();
});

describe('Imported historical SHOP HTTP source and sensitivity boundaries', () => {
  it('admits explicit COMPANY read, excludes unknown source before total/limit and masks money', async () => {
    const response = await http('/imported-sales?company=SHOP&limit=1').expect(200);
    expect(response.body.total).toBe(1);
    expect(response.body.data.map((row: { id: string }) => row.id)).toEqual([trustedId]);
    expect(response.body.data[0]).toMatchObject({ costTotal: null, profit: null });
  });
  it('summary uses verified sources and UTC month without journals', async () => {
    const before = await db.journalEntry.count();
    const response = await http('/imported-sales/summary?company=SHOP').expect(200);
    expect(response.body.totals).toMatchObject({
      count: 1,
      sales: '100',
      cost: null,
      profit: null,
    });
    expect(response.body.byMonth).toEqual([
      { key: '2026-09', count: 1, sales: '100', profit: null },
    ]);
    expect(await db.journalEntry.count()).toBe(before);
  });
  it.each(['/imported-sales', '/imported-sales/summary'])(
    '%s denies missing/foreign/branch-only authority',
    async (path) => {
      for (const id of [denied, foreign, branchOnly])
        await http(path + '?company=SHOP', id).expect(403);
    },
  );
  it('owner cannot convert unknown discriminator into trusted central provenance', async () => {
    const response = await http('/imported-sales?company=SHOP', owner).expect(200);
    expect(response.body.data.map((row: { id: string }) => row.id)).not.toContain(unknownId);
  });
});

describe('Tender five actual read boundaries', () => {
  it.each([
    'daily-summary',
    'cash-close/status',
    'cash-close/history',
    'cash-close/overview',
    'cash-close/reminder',
  ])('%s permits current branch read without a legacy role grant', async (path) => {
    await http(`/shop-tenders/${path}?company=SHOP&branchId=${branchId}`, tenderReader).expect(200);
  });
  it.each([
    'daily-summary',
    'cash-close/status',
    'cash-close/history',
    'cash-close/overview',
    'cash-close/reminder',
  ])('%s denies missing and foreign branch rights', async (path) => {
    await http(`/shop-tenders/${path}?company=SHOP&branchId=${branchId}`, denied).expect(403);
    await http(`/shop-tenders/${path}?company=SHOP&branchId=${foreignBranch}`, tenderReader).expect(
      403,
    );
  });
});

async function cashCase(cost = false) {
  const shop = await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'SHOP' } });
  const branch = await db.branch.create({
    data: { name: 'Source case ' + randomUUID(), companyId: shop.id, shopCashFloat: '10' },
  });
  const actor = await user();
  await grant(
    actor,
    ['shop-tenders.read', ...(cost ? ['sensitive.cost.read' as const] : [])],
    'SHOP',
    [branch.id],
  );
  const customer = await db.customer.create({
    data: {
      name: 'Private customer ' + randomUUID(),
      accessCompanyCode: 'SHOP',
      accessBranchId: branch.id,
    },
  });
  const booking = await db.booking.create({
    data: {
      bookingNumber: randomUUID(),
      customerId: customer.id,
      branchId: branch.id,
      depositAmount: '100',
      totalAmount: '100',
      expireDate: new Date('2030-01-01'),
      createdById: actor,
    },
  });
  const inflow = await db.shopTender.create({
    data: {
      branchId: branch.id,
      direction: 'IN',
      method: 'CASH',
      amount: '100',
      kind: 'BOOKING_DEPOSIT',
      actorId: actor,
      bookingId: booking.id,
    },
  });
  const tradeIn = await db.tradeIn.create({
    data: {
      branchId: branch.id,
      flow: 'BUYBACK',
      deviceBrand: 'Test',
      deviceModel: 'Test',
      customerId: customer.id,
    },
  });
  const payout = await db.shopTender.create({
    data: {
      branchId: branch.id,
      direction: 'OUT',
      method: 'CASH',
      amount: '30',
      kind: 'TRADE_IN_PAYOUT',
      actorId: actor,
      tradeInId: tradeIn.id,
    },
  });
  return { branch: branch.id, actor, customer, booking, inflow, payout, tradeIn };
}
async function closeCase(branchId: string, actor: string) {
  return db.shopCashClose.create({
    data: {
      branchId,
      floatAmount: '10',
      cashIn: '100',
      cashOut: '30',
      expectedAmount: '80',
      countedAmount: '80',
      varianceAmount: '0',
      varianceReason: 'Private counting note',
      sendAmount: '70',
      countedById: actor,
    },
  });
}
const readCash = (method: string, branch: string, actor: string) =>
  http(`/shop-tenders/${method}?company=SHOP&branchId=${branch}`, actor);

describe('Current scope, canonical money contributors and private projections', () => {
  it('keeps the complete canonical drawer and uses stable blind projections with or without payouts', async () => {
    const f = await cashCase();
    await grant(f.actor, ['shop-tenders.count'], 'SHOP', [f.branch]);
    const blind = (await readCash('cash-close/status', f.branch, f.actor).expect(200)).body;
    expect(blind.round).toMatchObject({ cashIn: 100, cashOut: null, expectedAmount: null });
    expect(blind.holdings).toBeNull();
    expect(blind.permissions).toMatchObject({ canCount: true, canConfirm: false });
    expect(blind.readiness.counters).toContainEqual({
      id: f.actor,
      name: 'Owned tender tester',
      role: null,
    });
    expect(blind.availability.countNote).toEqual({ required: true, minLength: 5, maxLength: 500 });
    const daily = (await readCash('daily-summary', f.branch, f.actor).expect(200)).body;
    expect(daily.totals).toMatchObject({
      totalIn: '100.00',
      totalOut: null,
      expectedCashInDrawer: null,
    });
    expect(daily.rows.find((r: { id: string }) => r.id === f.payout.id).amount).toBeNull();
    expect(daily.byKind.find((r: { kind: string }) => r.kind === 'TRADE_IN_PAYOUT')).toMatchObject({
      total: null,
      cash: null,
    });
    expect(daily.byStaff[0]).toMatchObject({ cashOut: null, netCash: null });
    await grant(f.actor, ['sensitive.cost.read'], 'SHOP', [f.branch]);
    const full = (await readCash('cash-close/status', f.branch, f.actor).expect(200)).body;
    expect(full.round).toMatchObject({
      floatAmount: 10,
      cashIn: 100,
      cashOut: 30,
      expectedAmount: 80,
    });
    const empty = (await readCash('cash-close/status', branchId, tenderReader).expect(200)).body;
    expect(empty.round.expectedAmount).toBeNull();
    expect(empty.availability.money).toBe(blind.availability.money);
  });
  it('separates source navigation and customer labels from tender and cost authority', async () => {
    const f = await cashCase(true);
    let response = (await readCash('daily-summary', f.branch, f.actor).expect(200)).body;
    expect(response.rows.find((r: { id: string }) => r.id === f.inflow.id)).toMatchObject({
      docId: null,
      docNumber: null,
      customerName: null,
      amount: '100.00',
    });
    await grant(f.actor, ['bookings.read'], 'SHOP', [f.branch]);
    response = (await readCash('daily-summary', f.branch, f.actor).expect(200)).body;
    expect(response.rows.find((r: { id: string }) => r.id === f.inflow.id)).toMatchObject({
      docId: f.booking.id,
      customerName: null,
    });
    await grant(f.actor, ['customers.read'], 'SHOP', [f.branch]);
    response = (await readCash('daily-summary', f.branch, f.actor).expect(200)).body;
    expect(response.rows.find((r: { id: string }) => r.id === f.inflow.id).customerName).toBe(
      f.customer.name,
    );
    await db.booking.update({ where: { id: f.booking.id }, data: { deletedAt: new Date() } });
    response = (await readCash('daily-summary', f.branch, f.actor).expect(200)).body;
    expect(response.rows.find((r: { id: string }) => r.id === f.inflow.id)).toMatchObject({
      docId: null,
      amount: '100.00',
    });
    expect(response.availability.sources).toBe('COMPLETE');
  });
  it('does not flatten cost on A and tender read on B into cost on B', async () => {
    const f = await cashCase();
    await grant(f.actor, ['sensitive.cost.read'], 'SHOP', [branchId]);
    expect(
      (await readCash('cash-close/status', f.branch, f.actor).expect(200)).body.round
        .expectedAmount,
    ).toBeNull();
  });
  it('refuses ASSIGNED from receiving actor or chosen salesperson and empty branch scope', async () => {
    const f = await cashCase();
    const assigned = await user();
    const position = await db.accessPosition.create({
      data: { code: randomUUID(), name: 'Assigned', permissions: ['shop-tenders.read'] },
    });
    await db.employeeAccessAssignment.create({
      data: { userId: assigned, positionId: position.id, companyCode: 'SHOP', scope: 'ASSIGNED' },
    });
    await db.shopTender.update({ where: { id: f.inflow.id }, data: { actorId: assigned } });
    await readCash('daily-summary', f.branch, assigned).expect(403);
    const empty = await user();
    await grant(empty, ['shop-tenders.read'], 'SHOP', []);
    await http('/shop-tenders/cash-close/history?company=SHOP', empty).expect(403);
  });
  it('masks close notes, financial states, history shortages and overview settlement counts without cost', async () => {
    const f = await cashCase();
    const close = await closeCase(f.branch, f.actor);
    await db.shopCashClose.update({
      where: { id: close.id },
      data: {
        status: 'CONFIRMED',
        destination: 'BRANCH_SAFE',
        receivedAmount: '70',
        receiveVariance: '0',
        confirmedAt: new Date(),
        confirmedById: owner,
      },
    });
    const history = (await readCash('cash-close/history', f.branch, f.actor).expect(200)).body;
    expect(history.rows[0]).toMatchObject({
      status: 'CONFIRMED',
      expectedAmount: null,
      countedAmount: null,
      varianceReason: null,
      moneyState: null,
    });
    expect(history.alerts.monthShortage).toBeNull();
    const overview = (await readCash('cash-close/overview', f.branch, f.actor).expect(200)).body;
    expect(overview.summary).toMatchObject({ reached: null, atBranch: null });
    expect(overview.rows[0].state).toBeNull();
    expect(overview.strip.rows[0].cells).toBeNull();
    expect(overview.holdings).toBeNull();
  });
  it('rejects current revocation even with an earlier granted HTTP snapshot', async () => {
    const actor = await user(),
      assignment = await grant(actor, ['imported-sales.read']);
    snapshotOverride = await snapshots.forUser(actor);
    await db.accessPosition.update({
      where: { id: assignment.positionId },
      data: { permissions: [] },
    });
    try {
      await http('/imported-sales?company=SHOP', actor).expect(403);
    } finally {
      snapshotOverride = undefined;
    }
  });
  it('excludes malformed kind/document/reversal data and never labels its drawer complete', async () => {
    const f = await cashCase(true);
    await db.shopTender.create({
      data: {
        branchId: f.branch,
        direction: 'OUT',
        method: 'CASH',
        amount: '20',
        kind: 'BOOKING_DEPOSIT_REFUND',
        actorId: f.actor,
        bookingId: f.booking.id,
        reversesTenderId: f.inflow.id,
      },
    });
    const daily = (await readCash('daily-summary', f.branch, f.actor).expect(200)).body;
    expect(daily.rows).toHaveLength(2);
    expect(daily.availability.sources).toBe('PARTIAL');
    expect(daily.totals.expectedCashInDrawer).toBeNull();
    const status = (await readCash('cash-close/status', f.branch, f.actor).expect(200)).body;
    expect(status.round.expectedAmount).toBeNull();
    expect(status.permissions.canCount).toBe(false);
  });
  it('retains a full genuine reversal and soft-deleted source in money history', async () => {
    const f = await cashCase(true);
    await db.booking.update({ where: { id: f.booking.id }, data: { deletedAt: new Date() } });
    await db.shopTender.create({
      data: {
        branchId: f.branch,
        direction: 'OUT',
        method: 'CASH',
        amount: '100',
        kind: 'BOOKING_DEPOSIT_REFUND',
        actorId: f.actor,
        bookingId: f.booking.id,
        reversesTenderId: f.inflow.id,
      },
    });
    const daily = (await readCash('daily-summary', f.branch, f.actor).expect(200)).body;
    expect(daily.rows).toHaveLength(3);
    expect(daily.totals.expectedCashInDrawer).toBe('-30.00');
    expect(daily.availability.sources).toBe('COMPLETE');
  });
  it('scopes all-date duplicate probes and independently hides linked document numbers', async () => {
    const f = await cashCase(true),
      hidden = await cashCase(true),
      reference = randomUUID();
    await db.shopTender.update({
      where: { id: f.inflow.id },
      data: { method: 'BANK_TRANSFER', reference },
    });
    await db.shopTender.update({
      where: { id: hidden.inflow.id },
      data: { method: 'BANK_TRANSFER', reference, occurredAt: new Date('2020-01-01') },
    });
    let daily = (await readCash('daily-summary', f.branch, f.actor).expect(200)).body;
    expect(daily.duplicateReferences).toEqual([]);
    const second = await db.booking.create({
      data: {
        bookingNumber: randomUUID(),
        customerId: f.customer.id,
        branchId: f.branch,
        depositAmount: '100',
        totalAmount: '100',
        expireDate: new Date('2030-01-01'),
        createdById: f.actor,
      },
    });
    await db.shopTender.create({
      data: {
        branchId: f.branch,
        direction: 'IN',
        method: 'BANK_TRANSFER',
        amount: '100',
        reference,
        kind: 'BOOKING_DEPOSIT',
        actorId: f.actor,
        bookingId: second.id,
        occurredAt: new Date('2020-01-01'),
      },
    });
    daily = (await readCash('daily-summary', f.branch, f.actor).expect(200)).body;
    expect(daily.duplicateReferences).toEqual([{ reference, documents: [] }]);
    await grant(f.actor, ['bookings.read'], 'SHOP', [f.branch]);
    daily = (await readCash('daily-summary', f.branch, f.actor).expect(200)).body;
    expect(daily.duplicateReferences[0].documents.sort()).toEqual(
      [f.booking.bookingNumber, second.bookingNumber].sort(),
    );
    expect(JSON.stringify(daily)).not.toContain(hidden.booking.bookingNumber);
  });
  it('uses current candidate capability rather than old role or historical operator', async () => {
    const f = await cashCase();
    const candidate = await user();
    const assignment = await grant(candidate, ['shop-tenders.count'], 'SHOP', [f.branch]);
    await db.user.update({ where: { id: f.actor }, data: { role: 'SALES', branchId: f.branch } });
    let status = (await readCash('cash-close/status', f.branch, f.actor).expect(200)).body;
    expect(status.readiness.counters.map((r: { id: string }) => r.id)).toContain(candidate);
    expect(status.readiness.counters.map((r: { id: string }) => r.id)).not.toContain(f.actor);
    await db.accessPosition.update({
      where: { id: assignment.positionId },
      data: { permissions: [] },
    });
    status = (await readCash('cash-close/status', f.branch, f.actor).expect(200)).body;
    expect(status.readiness.counters.map((r: { id: string }) => r.id)).not.toContain(candidate);
  });
});

describe('Imported immutable provenance and independent sensitive tuples', () => {
  it.each([
    [true, false, '70.01', null],
    [false, true, null, null],
    [true, true, '70.01', '29.99'],
  ] as const)(
    'cost=%s profit=%s applies to rows and every bucket/total',
    async (cost, profit, expectedCost, expectedProfit) => {
      const actor = await user();
      await grant(actor, [
        'imported-sales.read',
        ...(cost ? ['sensitive.cost.read' as const] : []),
        ...(profit ? ['sensitive.profit.read' as const] : []),
      ]);
      const list = (await http('/imported-sales?company=SHOP', actor).expect(200)).body;
      expect(list.data[0]).toMatchObject({ costTotal: expectedCost, profit: expectedProfit });
      const summary = (await http('/imported-sales/summary?company=SHOP', actor).expect(200)).body;
      expect(summary.totals).toMatchObject({ cost: expectedCost, profit: expectedProfit });
      for (const group of ['byMonth', 'byCategory', 'bySalesperson', 'byChannel'])
        expect(summary[group][0].profit).toBe(expectedProfit);
    },
  );
  it('does not mix FINANCE cost or SHOP branch cost into central SHOP historical access', async () => {
    const actor = await user();
    await grant(actor, ['imported-sales.read', 'sensitive.profit.read']);
    await grant(actor, ['sensitive.cost.read'], 'FINANCE');
    await grant(actor, ['sensitive.cost.read'], 'SHOP', [branchId]);
    expect(
      (await http('/imported-sales?company=SHOP', actor).expect(200)).body.data[0],
    ).toMatchObject({ costTotal: null, profit: null });
  });
  it('prevents source relabeling in PostgreSQL and has no implicit insert discriminator', async () => {
    await expect(
      db.importedSale.update({ where: { id: unknownId }, data: { source: 'TOOLTIFY' } }),
    ).rejects.toThrow();
    expect((await db.importedSale.findUniqueOrThrow({ where: { id: unknownId } })).source).toBe(
      'UNKNOWN',
    );
    const column = await db.$queryRaw<
      { column_default: string | null }[]
    >`SELECT column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'imported_sales' AND column_name = 'source'`;
    expect(column).toEqual([{ column_default: null }]);
  });
  it('writes only exact safe outer metadata despite arbitrary body/query/UA text', async () => {
    const poison = 'PRIVATE-NOTE-KEY-DO-NOT-COPY';
    await http('/imported-sales?company=SHOP&fake=' + poison)
      .set('user-agent', poison)
      .send({ note: poison })
      .expect(200);
    await Promise.allSettled([...auditPromises]);
    const logs = await db.auditLog.findMany({
      where: { userId: reader, entity: 'imported-sales' },
    });
    expect(logs.length).toBeGreaterThan(0);
    expect(
      JSON.stringify(logs, (_key, value) => (typeof value === 'bigint' ? value.toString() : value)),
    ).not.toContain(poison);
    expect(logs.at(-1)?.newValue).toMatchObject({
      route: 'ImportedSalesController.list',
      outcome: 'SUCCESS',
    });
  });
});

describe('Held current sources and collection boundaries', () => {
  it('reauthorizes all seven routes against current positions, not the request snapshot', async () => {
    const actor = await user(),
      assignment = await grant(actor, ['shop-tenders.read', 'imported-sales.read']);
    snapshotOverride = await snapshots.forUser(actor);
    await db.accessPosition.update({
      where: { id: assignment.positionId },
      data: { permissions: [] },
    });
    try {
      for (const path of [
        'daily-summary',
        'cash-close/status',
        'cash-close/history',
        'cash-close/overview',
        'cash-close/reminder',
      ])
        await readCash(path, branchId, actor).expect(403);
      for (const path of ['/imported-sales', '/imported-sales/summary'])
        await http(path + '?company=SHOP', actor).expect(403);
    } finally {
      snapshotOverride = undefined;
    }
  });
  it('scopes history before the 500-row limit and scopes overview branches before groups', async () => {
    const f = await cashCase(true),
      other = await cashCase(true);
    const visible = await closeCase(f.branch, f.actor);
    await db.shopCashClose.createMany({
      data: Array.from({ length: 501 }, () => ({
        branchId: other.branch,
        floatAmount: '10',
        cashIn: '100',
        cashOut: '30',
        expectedAmount: '80',
        countedAmount: '80',
        varianceAmount: '0',
        sendAmount: '70',
        countedById: other.actor,
      })),
    });
    const history = (
      await http('/shop-tenders/cash-close/history?company=SHOP', f.actor).expect(200)
    ).body;
    expect(history.rows.map((r: { id: string }) => r.id)).toEqual([visible.id]);
    const overview = (
      await http('/shop-tenders/cash-close/overview?company=SHOP', f.actor).expect(200)
    ).body;
    expect(overview.rows.map((r: { branchId: string }) => r.branchId)).toEqual([f.branch]);
    expect(overview.summary.awaitingConfirm).toBe(1);
  });
  it('retries a held source change and withholds the now-invalid drawer instead of releasing stale values', async () => {
    const f = await cashCase(true);
    let locked!: () => void, release!: () => void;
    const lockedPromise = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const releasePromise = new Promise<void>((resolve) => {
      release = resolve;
    });
    const blocker = db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM bookings WHERE id = ${f.booking.id} FOR UPDATE`;
        locked();
        await releasePromise;
        await tx.booking.update({ where: { id: f.booking.id }, data: { branchId: foreignBranch } });
      },
      { timeout: 15000 },
    );
    await lockedPromise;
    const response = readCash('cash-close/status', f.branch, f.actor)
      .expect(200)
      .then((r) => r);
    let waited = false;
    try {
      for (let i = 0; i < 100; i++) {
        const rows = await db.$queryRaw<
          { n: bigint }[]
        >`SELECT count(*) AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%FROM bookings%'`;
        if (rows[0].n > 0n) {
          waited = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    } finally {
      release();
    }
    await blocker;
    const result = await response;
    expect(waited).toBe(true);
    expect(result.body.availability.sources).toBe('PARTIAL');
    expect(result.body.round.expectedAmount).toBeNull();
  });
  it('money-source contract requires the owned exact client and rejects the visible client for business writes', async () => {
    const f = await cashCase(true);
    let retained!: TenderSourcePlan;
    await app.get(AccessResourceService).execute(
      f.actor,
      'shop-tenders.read',
      'SHOP',
      undefined,
      async () => {
        retained = await TenderSourcePlan.create(currentDomainAccess()!.client, f.branch);
        expect(() => retained.assertComplete(f.branch, 'shop-tenders.read', true)).not.toThrow();
        expect(() => retained.visibleClient().shopTender.create({ data: {} } as never)).toThrow(
          'read-only',
        );
      },
      false,
      { isolationLevel: 'Serializable' },
    );
    expect(() => retained.assertComplete(f.branch, 'shop-tenders.read', true)).toThrow();
  });
  it('narrow Contract-down SHOP money never implies FINANCE document navigation', async () => {
    const f = await cashCase(true);
    const product = await db.product.create({
      data: {
        name: 'Test phone',
        brand: 'Test',
        model: 'Test',
        category: 'PHONE_NEW',
        costPrice: '20',
        branchId: f.branch,
      },
    });
    const contract = await db.contract.create({
      data: {
        contractNumber: randomUUID(),
        customerId: f.customer.id,
        productId: product.id,
        branchId: f.branch,
        salespersonId: f.actor,
        planType: 'STORE_DIRECT',
        sellingPrice: '100',
        downPayment: '10',
        interestRate: '0',
        totalMonths: 1,
        interestTotal: '0',
        financedAmount: '90',
        monthlyPayment: '90',
      },
    });
    const tender = await db.shopTender.create({
      data: {
        branchId: f.branch,
        direction: 'IN',
        method: 'CASH',
        amount: '10',
        kind: 'CONTRACT_DOWN',
        actorId: f.actor,
        contractId: contract.id,
      },
    });
    await grant(f.actor, ['contracts.read'], 'SHOP', [f.branch]);
    let daily = (await readCash('daily-summary', f.branch, f.actor).expect(200)).body;
    expect(daily.rows.find((r: { id: string }) => r.id === tender.id)).toMatchObject({
      amount: '10.00',
      docId: null,
    });
    await grant(f.actor, ['contracts.read'], 'FINANCE', [f.branch]);
    daily = (await readCash('daily-summary', f.branch, f.actor).expect(200)).body;
    expect(daily.rows.find((r: { id: string }) => r.id === tender.id).docId).toBe(contract.id);
  });
});

describe('Finite source safety regressions', () => {
  it('direct imported service cannot borrow unrelated owned operation authority', async () => {
    await expect(
      app
        .get(AccessResourceService)
        .execute(
          tenderReader,
          'shop-tenders.read',
          'SHOP',
          undefined,
          () => app.get(ImportedSalesService).list({ page: 1, limit: 20 }),
          false,
          { isolationLevel: 'Serializable' },
        ),
    ).rejects.toThrow();
  });
  it('duplicate full reversals cannot be counted as two genuine refunds', async () => {
    const f = await cashCase(true);
    for (let i = 0; i < 2; i++)
      await db.shopTender.create({
        data: {
          branchId: f.branch,
          direction: 'OUT',
          method: 'CASH',
          amount: '100',
          kind: 'BOOKING_DEPOSIT_REFUND',
          actorId: f.actor,
          bookingId: f.booking.id,
          reversesTenderId: f.inflow.id,
        },
      });
    const daily = (await readCash('daily-summary', f.branch, f.actor).expect(200)).body;
    expect(daily.availability.sources).toBe('PARTIAL');
    expect(daily.totals.expectedCashInDrawer).toBeNull();
  });
});

describe('Remaining actual positive read and finite origin cases', () => {
  it('reminder is useful for real unclosed cash without revealing hidden expected money', async () => {
    const f = await cashCase();
    await db.shopTender.updateMany({
      where: { branchId: f.branch },
      data: { occurredAt: new Date(Date.now() - 86400000) },
    });
    const blind = (await readCash('cash-close/reminder', f.branch, f.actor).expect(200)).body;
    expect(blind.missed).toMatchObject({
      branchId: f.branch,
      cashIn: 100,
      expectedAmount: null,
      date: bangkokDateString(new Date(Date.now() - 86400000)),
    });
    await grant(f.actor, ['sensitive.cost.read'], 'SHOP', [f.branch]);
    expect(
      (await readCash('cash-close/reminder', f.branch, f.actor).expect(200)).body.missed
        .expectedAmount,
    ).toBe(80);
  });
  it.each([
    ['CASH', 'CASH_SALE'],
    ['EXTERNAL_FINANCE', 'EXTERNAL_FINANCE_DOWN'],
  ] as const)(
    'validates %s money independently from Sale navigation and suppresses multi-document rows',
    async (saleType, kind) => {
      const f = await cashCase(true);
      const product = await db.product.create({
        data: {
          name: 'Test',
          brand: 'Test',
          model: 'Test',
          category: 'PHONE_NEW',
          costPrice: '20',
          branchId: f.branch,
        },
      });
      const sale = await db.sale.create({
        data: {
          saleNumber: randomUUID(),
          saleType,
          customerId: f.customer.id,
          productId: product.id,
          branchId: f.branch,
          salespersonId: f.actor,
          sellingPrice: '200',
          netAmount: '200',
        },
      });
      const tender = await db.shopTender.create({
        data: {
          branchId: f.branch,
          direction: 'IN',
          method: 'CASH',
          amount: '200',
          kind,
          actorId: f.actor,
          saleId: sale.id,
        },
      });
      let daily = (await readCash('daily-summary', f.branch, f.actor).expect(200)).body;
      expect(daily.rows.find((r: { id: string }) => r.id === tender.id)).toMatchObject({
        amount: '200.00',
        docId: null,
      });
      await grant(f.actor, ['sales.read'], 'SHOP', [f.branch]);
      daily = (await readCash('daily-summary', f.branch, f.actor).expect(200)).body;
      expect(daily.rows.find((r: { id: string }) => r.id === tender.id).docId).toBe(sale.id);
      await db.shopTender.update({ where: { id: tender.id }, data: { bookingId: f.booking.id } });
      daily = (await readCash('daily-summary', f.branch, f.actor).expect(200)).body;
      expect(daily.rows.find((r: { id: string }) => r.id === tender.id)).toBeUndefined();
      expect(daily.availability.sources).toBe('PARTIAL');
    },
  );
  it('file-presence metadata requires independent same-source documents.read without accessing storage', async () => {
    const f = await cashCase(true),
      close = await closeCase(f.branch, f.actor);
    await db.shopCashClose.update({
      where: { id: close.id },
      data: { depositSlipKey: `shop-cash-close/${close.id}/legacy.jpg` },
    });
    let status = (await readCash('cash-close/status', f.branch, f.actor).expect(200)).body;
    expect(status.closes[0].hasDepositSlip).toBeNull();
    await grant(f.actor, ['documents.read'], 'SHOP', [branchId]);
    status = (await readCash('cash-close/status', f.branch, f.actor).expect(200)).body;
    expect(status.closes[0].hasDepositSlip).toBeNull();
    await grant(f.actor, ['documents.read'], 'SHOP', [f.branch]);
    status = (await readCash('cash-close/status', f.branch, f.actor).expect(200)).body;
    expect(status.closes[0].hasDepositSlip).toBe(true);
  });
  it('an inactive current branch never survives an earlier request snapshot', async () => {
    const f = await cashCase(true);
    snapshotOverride = await snapshots.forUser(f.actor);
    await db.branch.update({ where: { id: f.branch }, data: { isActive: false } });
    try {
      await readCash('cash-close/status', f.branch, f.actor).expect(403);
    } finally {
      snapshotOverride = undefined;
    }
  });
});

it('branch picker retains all live granted branches while an explicit branch filters money rows', async () => {
  const f = await cashCase(true),
    other = await cashCase(true);
  await grant(f.actor, ['shop-tenders.read'], 'SHOP', [other.branch]);
  const daily = (await readCash('daily-summary', f.branch, f.actor).expect(200)).body;
  expect(daily.scope).toBe('SCOPED');
  expect(daily.branches.map((b: { id: string }) => b.id).sort()).toEqual(
    [f.branch, other.branch].sort(),
  );
  expect(new Set(daily.rows.map((r: { branchId: string }) => r.branchId))).toEqual(
    new Set([f.branch]),
  );
});
