import { ACCESS_BOUNDARIES, ACCESS_POLICIES } from './access-policy.registry';
import { TENDER_READ_METHODS } from './access-tender-boundaries';
import { TENDER_MONEY_METHODS } from './access-tender-money-boundaries';
import { Readable } from 'node:stream';
import { seedShopCoa } from '../../../prisma/seed-coa-shop';
import { AccessTenderMoneyBoundaries } from './access-tender-money-boundaries';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { AccessTenderBoundaries } from './access-tender-boundaries';
import { createHash, randomUUID } from 'node:crypto';
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
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=',
  'base64',
);
const objects = new Map<string, Buffer>();
const storage = {
  configured: true,
  upload: jest.fn(async (key: string, body: Buffer) => {
    objects.set(key, Buffer.from(body));
  }),
  delete: jest.fn(async (key: string) => {
    objects.delete(key);
  }),
  uploadOwned: jest.fn(async (key: string, body: Buffer) => {
    if (objects.has(key)) throw new Error('collision');
    objects.set(key, Buffer.from(body));
  }),
  deleteOwned: jest.fn(async () => ({
    status: 'retained',
    reason: 'local-path-identity-not-atomic',
  })),
  getStream: jest.fn(async (key: string) => {
    const bytes = objects.get(key);
    if (!bytes) throw new Error('missing');
    return Readable.from([bytes]);
  }),
};
const legacyReviewerIds = new Set<string>();
const auditPromises = new Set<Promise<unknown>>();
let snapshotOverride: Awaited<ReturnType<AccessSnapshotService['forUser']>> | undefined;
const snapshots = new AccessSnapshotService(db as PrismaService);
let app: INestApplication,
  reader: string,
  denied: string,
  foreign: string,
  branchOnly: string,
  owner: string;
let branchId: string, foreignBranch: string, tenderReader: string;
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
  await seedShopCoa(db as never);
  await db.user.create({
    data: {
      name: 'Owned journal system',
      email: 'admin@bestchoice.com',
      password: 'unused',
      role: 'OWNER',
      isSystemUser: true,
    },
  });
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
  const module = await Test.createTestingModule({
    controllers: [ImportedSalesController, ShopTendersController],
    providers: [
      AccessTenderMoneyBoundaries,
      AccessTenderBoundaries,
      ShopTendersReportService,
      ShopCashCloseService,
      ShopCashHoldingService,
      ShopCashOverviewService,
      AuditService,
      { provide: StorageService, useValue: storage },
      JournalAutoService,
      CompanyResolverService,
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
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
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
afterEach(async () => {
  // Legacy OWNER fixtures must not become recipients in unrelated owner-effect tests.
  if (legacyReviewerIds.size) {
    await db.user.updateMany({ where: { id: { in: [...legacyReviewerIds] } }, data: { isActive: false } });
    legacyReviewerIds.clear();
  }
});
afterAll(async () => {
  await app?.close();
  await Promise.allSettled([...auditPromises]);
  await db.$disconnect();
});

describe('Managed tender money HTTP', () => {
  it('accepts configured blind count, preserves unconditional note and fixed acknowledgement', async () => {
    await grant(tenderReader, ['shop-tenders.count'], 'SHOP', [branchId]);
    const response = await request(app.getHttpServer())
      .post('/shop-tenders/cash-close?company=SHOP')
      .set('x-test-user', tenderReader)
      .send({ branchId, countedAmount: 0, varianceReason: '  checked cash  ' })
      .expect('x-owned-tender-app', testRun)
      .expect(201);
    expect(response.body).toEqual({ id: expect.any(String), status: 'PENDING_CONFIRM' });
    expect(await db.shopCashClose.findUnique({ where: { id: response.body.id } })).toMatchObject({
      varianceReason: 'checked cash',
    });
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

async function setup() {
  const f = await cashCase();
  await grant(f.actor, ['shop-tenders.count'], 'SHOP', [f.branch]);
  await db.branch.update({ where: { id: f.branch }, data: { shopCashAccountCode: 'S11-1102' } });
  const reviewer = await user();
  await grant(
    reviewer,
    [
      'shop-tenders.read',
      'shop-tenders.confirm',
      'shop-tenders.deposit',
      'sensitive.cost.read',
      'documents.create',
      'documents.read',
    ],
    'SHOP',
    [f.branch],
  );
  return { ...f, reviewer };
}
async function legacyReviewer(
  branchId: string,
  role: 'BRANCH_MANAGER' | 'OWNER' = 'BRANCH_MANAGER',
) {
  const id = await user();
  await db.user.update({ where: { id }, data: { accessManaged: false, role, branchId } });
  legacyReviewerIds.add(id);
  return id;
}
function post(path: string, actor: string) {
  return request(app.getHttpServer())
    .post('/shop-tenders/' + path + '?company=SHOP')
    .set('x-test-user', actor)
    .expect('x-owned-tender-app', testRun);
}
const count = (f: { branch: string; actor: string }, amount = 80) =>
  post('cash-close', f.actor).send({
    branchId: f.branch,
    countedAmount: amount,
    varianceReason: 'counting note',
  });
const confirm = (id: string, actor: string, destination = 'BRANCH_SAFE') =>
  post(`cash-close/${id}/confirm`, actor).send({ receivedAmount: 70, destination });
const attach = (id: string, actor: string) =>
  post(`cash-close/${id}/deposit-slip`, actor).attach('file', png, {
    filename: 'private.png',
    contentType: 'image/png',
  });
const deposit = (branch: string, actor: string, source = 'BRANCH_SAFE', amount = 70) =>
  post('cash-deposits', actor)
    .field('branchId', branch)
    .field('source', source)
    .field('amount', String(amount))
    .field('reference', 'REF-12345')
    .attach('file', png, { filename: 'private.png', contentType: 'image/png' });
const getSlip = (kind: 'close' | 'deposit', id: string, actor: string) =>
  http(
    `/shop-tenders/${kind === 'close' ? `cash-close/${id}/deposit-slip` : `cash-deposits/${id}/slip`}?company=SHOP`,
    actor,
  );

describe('B7 useful canonical lifecycle and private evidence', () => {
  it('uses full drawer Decimal math while blind count responds identically for match and variance; fixed owner tasks', async () => {
    for (const amount of [80, 79, 81]) {
      const f = await setup();
      const ack = (await count(f, amount).expect(201)).body;
      expect(ack).toEqual({ id: expect.any(String), status: 'PENDING_CONFIRM' });
      const row = await db.shopCashClose.findUniqueOrThrow({ where: { id: ack.id } });
      expect([
        row.expectedAmount.toString(),
        row.cashOut.toString(),
        row.sendAmount.toString(),
      ]).toEqual(['80', '30', String(amount - 10)]);
      expect(row.varianceReason).toBe('counting note');
      const tasks = await db.todo.findMany({ where: { branchId: f.branch } });
      expect(tasks).toHaveLength(1);
      expect(tasks[0]).toMatchObject({
        title: 'ตรวจสอบการปิดยอดเงินสด',
        priority: 'MEDIUM',
        assigneeId: owner,
        description: null,
      });
      expect(JSON.stringify(tasks)).not.toContain('counting note');
    }
  });
  it('validates fixed note before expected queries, rejects malformed contributor, and prevents no-movement duplicate', async () => {
    const f = await setup();
    const compute = jest.spyOn(app.get(ShopCashCloseService), 'computeRound');
    for (const varianceReason of ['', 'abcd', 'x'.repeat(501)])
      await post('cash-close', f.actor)
        .send({ branchId: f.branch, countedAmount: 80, varianceReason })
        .expect(400);
    expect(compute).not.toHaveBeenCalled();
    compute.mockRestore();
    await count(f).expect(201);
    await count(f).expect(400);
    const broken = await setup();
    await db.shopTender.update({
      where: { id: broken.payout.id },
      data: { bookingId: broken.booking.id },
    });
    await count(broken).expect(403);
  });
  it('confirms once with canonical SHOP journal and required safe audit; send-back preserves latest-only rule', async () => {
    const f = await setup(),
      ack = (await count(f).expect(201)).body;
    const results = await Promise.all([confirm(ack.id, f.reviewer), confirm(ack.id, f.reviewer)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const row = await db.shopCashClose.findUniqueOrThrow({ where: { id: ack.id } });
    expect(row.status).toBe('CONFIRMED');
    expect(row.journalEntryId).toBeTruthy();
    const entry = await db.journalEntry.findUniqueOrThrow({
      where: { id: row.journalEntryId! },
      include: { lines: true },
    });
    const shop = await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'SHOP' } });
    expect(entry.companyId).toBe(shop.id);
    expect(entry.lines.reduce((sum, line) => sum + Number(line.debit), 0)).toBe(70);
    const audit = await db.auditLog.findMany({
      where: { entityId: ack.id, action: 'SHOP_CASH_CLOSE_CONFIRMED' },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0].newValue).toEqual({ branchId: f.branch, status: 'CONFIRMED' });
    expect(await db.todo.count({ where: { branchId: f.branch } })).toBe(2);
    const back = await setup(),
      pending = (await count(back).expect(201)).body;
    await post(`cash-close/${pending.id}/send-back`, back.reviewer)
      .send({ reason: 'count again' })
      .expect(201);
    expect((await count(back).expect(201)).body.status).toBe('PENDING_CONFIRM');
  });
  it('requires different current counter/checker including actual owner and configured cost for decisions', async () => {
    const f = await setup(),
      ack = (await count(f).expect(201)).body;
    await grant(
      f.actor,
      ['shop-tenders.confirm', 'sensitive.cost.read', 'documents.create'],
      'SHOP',
      [f.branch],
    );
    await confirm(ack.id, f.actor).expect(403);
    await post(`cash-close/${ack.id}/send-back`, f.actor)
      .send({ reason: 'count again' })
      .expect(403);
    const uploads = storage.uploadOwned.mock.calls.length;
    await attach(ack.id, f.actor).expect(403);
    expect(storage.uploadOwned.mock.calls).toHaveLength(uploads);
    await db.shopCashClose.update({ where: { id: ack.id }, data: { countedById: owner } });
    await confirm(ack.id, owner).expect(403);
    await db.shopCashClose.update({ where: { id: ack.id }, data: { countedById: f.actor } });
    const noCost = await user();
    await grant(noCost, ['shop-tenders.confirm'], 'SHOP', [f.branch]);
    await confirm(ack.id, noCost).expect(403);
    await confirm(ack.id, f.reviewer, 'OWNER_HOLD').expect(403);
    await confirm(ack.id, owner, 'OWNER_HOLD').expect(201);
    await deposit(f.branch, f.reviewer, 'OWNER_HOLD').expect(403);
    await grant(f.reviewer, ['shop-tenders.deposit-owner-hold'], 'SHOP', [f.branch]);
    await deposit(f.branch, f.reviewer, 'OWNER_HOLD').expect(201);
  });
  it('stages immutable close evidence once, retains replacements and unused evidence, and releases private verified bytes', async () => {
    const f = await setup(),
      ack = (await count(f).expect(201)).body;
    await attach(ack.id, f.reviewer).expect(201);
    const before = await db.shopCashSlipEvidence.findMany({ where: { sourceId: ack.id } });
    await attach(ack.id, f.reviewer).expect(201);
    const evidence = await db.shopCashSlipEvidence.findMany({ where: { sourceId: ack.id } });
    expect(evidence).toHaveLength(2);
    expect(objects.has(before[0].storageKey)).toBe(true);
    const response = await getSlip('close', ack.id, f.reviewer)
      .expect(200)
      .expect('Cache-Control', 'private, no-store')
      .expect('X-Content-Type-Options', 'nosniff');
    expect(response.body).toEqual(png);
    await expect(
      db.shopCashSlipEvidence.update({
        where: { id: before[0].id },
        data: { sourceId: randomUUID() },
      }),
    ).rejects.toThrow();
    await confirm(ack.id, f.reviewer).expect(201);
    expect(await db.shopCashSlipEvidence.count({ where: { sourceId: ack.id } })).toBe(2);
    expect(objects.has(before[0].storageKey)).toBe(true);
  });
  it('retains committed managed evidence when a valid legacy reviewer replaces the slip', async () => {
    const f = await setup(),
      ack = (await count(f).expect(201)).body;
    await attach(ack.id, f.reviewer).expect(201);
    const evidence = await db.shopCashSlipEvidence.findFirstOrThrow({
      where: { sourceId: ack.id },
    });
    const before = await db.shopCashClose.findUniqueOrThrow({ where: { id: ack.id } });
    const legacy = await legacyReviewer(f.branch);
    await attach(ack.id, legacy).expect(201);
    const after = await db.shopCashClose.findUniqueOrThrow({ where: { id: ack.id } });
    expect(after.depositSlipKey).not.toBe(before.depositSlipKey);
    expect(after).toMatchObject({
      status: 'PENDING_CONFIRM',
      countedAmount: before.countedAmount,
      sendAmount: before.sendAmount,
      receivedAmount: null,
      journalEntryId: null,
    });
    expect(objects.get(after.depositSlipKey!)).toEqual(png);
    expect(await db.shopCashSlipEvidence.findMany({ where: { sourceId: ack.id } })).toEqual([
      evidence,
    ]);
    expect(evidence.sha256).toBe(createHash('sha256').update(png).digest('hex'));
    expect(storage.delete).not.toHaveBeenCalledWith(evidence.storageKey);
    expect(objects.get(evidence.storageKey)).toEqual(png);
  });
  it.each(['BRANCH_SAFE', 'OWNER_HOLD'] as const)(
    'retains committed managed evidence when a valid legacy reviewer confirms %s',
    async (destination) => {
      const f = await setup(),
        ack = (await count(f).expect(201)).body;
      await attach(ack.id, f.reviewer).expect(201);
      const evidence = await db.shopCashSlipEvidence.findFirstOrThrow({
        where: { sourceId: ack.id },
      });
      const legacy = await legacyReviewer(
        f.branch,
        destination === 'OWNER_HOLD' ? 'OWNER' : 'BRANCH_MANAGER',
      );
      const response = await confirm(ack.id, legacy, destination).expect(201);
      expect(response.body).toMatchObject({
        status: 'CONFIRMED',
        receivedAmount: 70,
        sendAmount: 70,
        receiveVariance: 0,
        destination,
        hasDepositSlip: false,
        journalPosted: true,
      });
      const after = await db.shopCashClose.findUniqueOrThrow({ where: { id: ack.id } });
      expect(after).toMatchObject({
        status: 'CONFIRMED',
        depositSlipKey: null,
        depositReference: null,
        destination,
        confirmedById: legacy,
        journalEntryId: expect.any(String),
      });
      expect(after.countedAmount.toNumber()).toBe(80);
      expect(after.sendAmount.toNumber()).toBe(70);
      expect(after.receivedAmount!.toNumber()).toBe(70);
      expect(await db.shopCashSlipEvidence.findMany({ where: { sourceId: ack.id } })).toEqual([
        evidence,
      ]);
      expect(evidence.sha256).toBe(createHash('sha256').update(png).digest('hex'));
      expect(storage.delete).not.toHaveBeenCalledWith(evidence.storageKey);
      expect(objects.get(evidence.storageKey)).toEqual(png);
    },
  );
  it('retains legacy-only committed slips on replacement and unused-destination confirmation without backfill', async () => {
    const f = await setup(),
      ack = (await count(f).expect(201)).body,
      legacy = await legacyReviewer(f.branch);
    await attach(ack.id, legacy).expect(201);
    const first = await db.shopCashClose.findUniqueOrThrow({ where: { id: ack.id } });
    await attach(ack.id, legacy).expect(201);
    const second = await db.shopCashClose.findUniqueOrThrow({ where: { id: ack.id } });
    expect(second.depositSlipKey).not.toBe(first.depositSlipKey);
    expect(second.status).toBe('PENDING_CONFIRM');
    expect(objects.get(second.depositSlipKey!)).toEqual(png);
    const response = await confirm(ack.id, legacy).expect(201);
    expect(response.body).toMatchObject({
      status: 'CONFIRMED',
      receivedAmount: 70,
      sendAmount: 70,
      destination: 'BRANCH_SAFE',
      hasDepositSlip: false,
      journalPosted: true,
    });
    expect(await db.shopCashClose.findUniqueOrThrow({ where: { id: ack.id } })).toMatchObject({
      depositSlipKey: null,
      confirmedById: legacy,
      journalEntryId: expect.any(String),
    });
    expect(await db.shopCashSlipEvidence.count({ where: { sourceId: ack.id } })).toBe(0);
    for (const key of [first.depositSlipKey!, second.depositSlipKey!]) {
      expect(storage.delete).not.toHaveBeenCalledWith(key);
      expect(objects.get(key)).toEqual(png);
    }
  });
  it('creates deposit once with ledger allocation and content endpoint; independently gates presence versus content', async () => {
    const f = await setup(),
      ack = (await count(f).expect(201)).body;
    await attach(ack.id, f.reviewer).expect(201);
    await grant(f.actor, ['documents.read'], 'SHOP', [f.branch]);
    const state = (
      await http(
        `/shop-tenders/cash-close/status?company=SHOP&branchId=${f.branch}`,
        f.actor,
      ).expect(200)
    ).body;
    expect(state.closes[0]).toMatchObject({ hasDepositSlip: true, canReadSlip: false });
    const reads = storage.getStream.mock.calls.length;
    await getSlip('close', ack.id, f.actor).expect(403);
    expect(storage.getStream.mock.calls).toHaveLength(reads);
    await confirm(ack.id, f.reviewer).expect(201);
    const results = await Promise.all([
      deposit(f.branch, f.reviewer),
      deposit(f.branch, f.reviewer),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 400]);
    const result = results.find((r) => r.status === 201)!;
    await getSlip('deposit', result.body.id, f.reviewer).expect(200);
    await getSlip('deposit', result.body.id, f.actor).expect(403);
    expect(await db.shopCashDeposit.count({ where: { branchId: f.branch } })).toBe(1);
    expect(await db.shopCashSlipEvidence.count({ where: { sourceId: result.body.id } })).toBe(1);
  });
});

describe('B7 current-source and terminal failure matrix', () => {
  it('rejects direct managed service calls without the owned execution and accepts trimmed 500-character notes', async () => {
    const f = await setup();
    await expect(
      app
        .get(ShopCashCloseService)
        .count(
          { id: f.actor, role: 'SALES', branchId: f.branch },
          { branchId: f.branch, countedAmount: 80, varianceReason: 'checked cash' },
        ),
    ).rejects.toThrow();
    await post('cash-close', f.actor)
      .send({
        branchId: f.branch,
        countedAmount: 80,
        varianceReason: '  ' + 'x'.repeat(500) + '  ',
      })
      .expect(201);
  });
  it('denies every actual B7 route with absent, foreign, crossed original tuples and revoked current grants', async () => {
    const f = await setup(),
      close = (await count(f).expect(201)).body;
    await attach(close.id, f.reviewer).expect(201);
    const held = await closeCase(f.branch, f.actor);
    await confirm(held.id, f.reviewer).expect(201);
    const deposited = (await deposit(f.branch, f.reviewer, 'BRANCH_SAFE', 20).expect(201)).body;
    const all: PermissionKey[] = [
      'shop-tenders.count',
      'shop-tenders.confirm',
      'shop-tenders.deposit',
      'shop-tenders.read',
      'documents.create',
      'documents.read',
      'sensitive.cost.read',
    ];
    const foreignActor = await user(),
      crossed = await user(),
      revoked = await user();
    await grant(foreignActor, all, 'SHOP', [foreignBranch]);
    await grant(crossed, all, 'SHOP', [foreignBranch]);
    await grant(crossed, ['customers.read'], 'SHOP', [f.branch]);
    const assignment = await grant(revoked, all, 'SHOP', [f.branch]);
    snapshotOverride = await snapshots.forUser(revoked);
    await db.employeeAccessAssignment.update({
      where: { id: assignment.id },
      data: { deletedAt: new Date() },
    });
    for (const actor of [denied, foreignActor, crossed, revoked]) {
      await post('cash-close', actor)
        .send({ branchId: f.branch, countedAmount: 80, varianceReason: 'checked cash' })
        .expect(403);
      await confirm(close.id, actor).expect(403);
      await post(`cash-close/${close.id}/send-back`, actor)
        .send({ reason: 'check again' })
        .expect(403);
      await attach(close.id, actor).expect(403);
      await deposit(f.branch, actor, 'BRANCH_SAFE', 1).expect(403);
      await getSlip('close', close.id, actor).expect(403);
      await getSlip('deposit', deposited.id, actor).expect(403);
    }
    snapshotOverride = undefined;
  });
  it('rolls back real close/journal writes on late required audit failure and on late journal failure', async () => {
    const f = await setup(),
      close = (await count(f).expect(201)).body;
    const audit = app.get(AuditService),
      real = audit.log.bind(audit);
    const fail = jest.spyOn(audit, 'log').mockImplementation(async (entry, tx) => {
      await real(entry, tx);
      if (entry.action === 'SHOP_CASH_CLOSE_CONFIRMED') throw new Error('late safe test failure');
    });
    await confirm(close.id, f.reviewer).expect(503);
    fail.mockRestore();
    expect((await db.shopCashClose.findUniqueOrThrow({ where: { id: close.id } })).status).toBe(
      'PENDING_CONFIRM',
    );
    expect(
      await db.journalEntry.count({
        where: { metadata: { path: ['shopCashCloseId'], equals: close.id } },
      }),
    ).toBe(0);
    expect(
      await db.auditLog.count({
        where: { entityId: close.id, action: 'SHOP_CASH_CLOSE_CONFIRMED' },
      }),
    ).toBe(0);
    expect(await db.todo.count({ where: { branchId: f.branch } })).toBe(1);
    const journal = app.get(JournalAutoService),
      postReal = journal.createAndPost.bind(journal);
    const journalFail = jest.spyOn(journal, 'createAndPost').mockImplementation(async (...args) => {
      await postReal(...args);
      throw new Error('late journal test failure');
    });
    await confirm(close.id, f.reviewer).expect(503);
    journalFail.mockRestore();
    expect(
      await db.journalEntry.count({
        where: { metadata: { path: ['shopCashCloseId'], equals: close.id } },
      }),
    ).toBe(0);
    await confirm(close.id, f.reviewer).expect(201);
  });
  it('rolls back deposit, evidence and journal on late audit failure; cleans only owned terminal staging', async () => {
    const f = await setup(),
      close = (await count(f).expect(201)).body;
    await confirm(close.id, f.reviewer).expect(201);
    const audit = app.get(AuditService),
      real = audit.log.bind(audit),
      cleanups = storage.deleteOwned.mock.calls.length;
    const fail = jest.spyOn(audit, 'log').mockImplementation(async (entry, tx) => {
      await real(entry, tx);
      if (entry.action === 'SHOP_CASH_DEPOSIT_RECORDED') throw new Error('late deposit failure');
    });
    await deposit(f.branch, f.reviewer).expect(503);
    fail.mockRestore();
    expect(await db.shopCashDeposit.count({ where: { branchId: f.branch } })).toBe(0);
    const lastKey = storage.uploadOwned.mock.calls.at(-1)![0];
    expect(await db.shopCashSlipEvidence.count({ where: { storageKey: lastKey } })).toBe(0);
    expect(storage.deleteOwned.mock.calls).toHaveLength(cleanups + 1);
    expect(objects.has(lastKey)).toBe(true);
    await deposit(f.branch, f.reviewer).expect(201);
  });
  it('never releases bytes on late read evidence failure, hash mismatch, oversized or noncanonical legacy objects', async () => {
    const f = await setup(),
      close = (await count(f).expect(201)).body;
    await attach(close.id, f.reviewer).expect(201);
    const audit = app.get(AuditService),
      real = audit.log.bind(audit);
    const fail = jest.spyOn(audit, 'log').mockImplementation(async (entry, tx) => {
      await real(entry, tx);
      if (entry.action === 'SHOP_CASH_SLIP_READ_AUTHORIZED') throw new Error('late read failure');
    });
    const response = await getSlip('close', close.id, f.reviewer).expect(503);
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.body).not.toEqual(png);
    fail.mockRestore();
    const evidence = await db.shopCashSlipEvidence.findFirstOrThrow({
      where: { sourceId: close.id },
    });
    objects.set(evidence.storageKey, Buffer.concat([png, Buffer.from('tamper')]));
    await getSlip('close', close.id, f.reviewer).expect(503);
    objects.set(evidence.storageKey, png);
    storage.getStream.mockResolvedValueOnce(Readable.from([Buffer.alloc(5242881)]));
    await getSlip('close', close.id, f.reviewer).expect(503);
    await db.shopCashClose.update({
      where: { id: close.id },
      data: { depositSlipKey: '/etc/passwd' },
    });
    const calls = storage.getStream.mock.calls.length;
    await getSlip('close', close.id, f.reviewer).expect(403);
    expect(storage.getStream.mock.calls).toHaveLength(calls);
  });
});

describe('Whole-attempt retries and source waits', () => {
  it.each([
    'count',
    'confirm',
    'sendBack',
    'attach',
    'deposit',
    'closeSlip',
    'depositSlip',
  ] as const)(
    '%s waits for actual source row and rejects changed branch after retry',
    async (method) => {
      const f = await setup(),
        close = (await count(f).expect(201)).body;
      await attach(close.id, f.reviewer).expect(201);
      const held = await closeCase(f.branch, f.actor);
      await confirm(held.id, f.reviewer).expect(201);
      const deposited = (await deposit(f.branch, f.reviewer, 'BRANCH_SAFE', 20).expect(201)).body;
      let release!: () => void, locked!: () => void;
      const released = new Promise<void>((r) => {
          release = r;
        }),
        acquired = new Promise<void>((r) => {
          locked = r;
        });
      const blocker = db.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM bookings WHERE id=${f.booking.id} FOR UPDATE`;
          locked();
          await released;
          await tx.booking.update({
            where: { id: f.booking.id },
            data: { branchId: foreignBranch },
          });
        },
        { timeout: 15000 },
      );
      await acquired;
      const call =
        method === 'count'
          ? count(f)
          : method === 'confirm'
            ? confirm(close.id, f.reviewer)
            : method === 'sendBack'
              ? post(`cash-close/${close.id}/send-back`, f.reviewer).send({ reason: 'check again' })
              : method === 'attach'
                ? attach(close.id, f.reviewer)
                : method === 'deposit'
                  ? deposit(f.branch, f.reviewer, 'BRANCH_SAFE', 1)
                  : getSlip(
                      method === 'closeSlip' ? 'close' : 'deposit',
                      method === 'closeSlip' ? close.id : deposited.id,
                      f.reviewer,
                    );
      const response = call.then((r) => r);
      let waited = false;
      try {
        for (let i = 0; i < 100; i++) {
          const rows = await db.$queryRaw<
            { n: bigint }[]
          >`SELECT count(*) AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%FROM bookings%'`;
          if (rows[0].n > 0n) {
            waited = true;
            break;
          }
          await new Promise((r) => setTimeout(r, 20));
        }
      } finally {
        release();
      }
      await blocker;
      expect(waited).toBe(true);
      expect((await response).status).toBe(403);
    },
  );
  it('stages once across real PostgreSQL serialization retry and runs owner effects once after actual commit', async () => {
    const f = await setup(),
      close = (await count(f).expect(201)).body;
    const audit = app.get(AuditService),
      real = audit.log.bind(audit);
    const uploads = storage.uploadOwned.mock.calls.length,
      cleanups = storage.deleteOwned.mock.calls.length;
    let calls = 0;
    const retry = jest.spyOn(audit, 'log').mockImplementation(async (entry, tx) => {
      if (entry.action === 'SHOP_CASH_CLOSE_SLIP_ATTACHED' && ++calls === 1)
        await tx!.$executeRawUnsafe(
          "DO $$ BEGIN RAISE EXCEPTION 'owned retry' USING ERRCODE='40001'; END $$",
        );
      return real(entry, tx);
    });
    await attach(close.id, f.reviewer).expect(201);
    retry.mockRestore();
    expect(calls).toBe(2);
    expect(storage.uploadOwned.mock.calls).toHaveLength(uploads + 1);
    expect(storage.deleteOwned.mock.calls).toHaveLength(cleanups);
    expect(await db.shopCashSlipEvidence.count({ where: { sourceId: close.id } })).toBe(1);
    calls = 0;
    const retryConfirm = jest.spyOn(audit, 'log').mockImplementation(async (entry, tx) => {
      if (entry.action === 'SHOP_CASH_CLOSE_CONFIRMED' && ++calls === 1)
        await tx!.$executeRawUnsafe(
          "DO $$ BEGIN RAISE EXCEPTION 'owned retry' USING ERRCODE='40001'; END $$",
        );
      return real(entry, tx);
    });
    await confirm(close.id, f.reviewer).expect(201);
    retryConfirm.mockRestore();
    expect(calls).toBe(2);
    expect(await db.todo.count({ where: { branchId: f.branch } })).toBe(2);
    expect(
      await db.journalEntry.count({
        where: { metadata: { path: ['shopCashCloseId'], equals: close.id } },
      }),
    ).toBe(1);
  });
  it('reauthorizes after staging when current documents grant is revoked and retains only terminal owned bytes', async () => {
    const f = await setup(),
      close = (await count(f).expect(201)).body;
    const uploader = await user();
    const assignment = await grant(
      uploader,
      ['shop-tenders.confirm', 'sensitive.cost.read', 'documents.create'],
      'SHOP',
      [f.branch],
    );
    const real = storage.uploadOwned.getMockImplementation()!,
      cleanups = storage.deleteOwned.mock.calls.length;
    storage.uploadOwned.mockImplementationOnce(async (...args) => {
      await real(...args);
      await db.accessPosition.update({
        where: { id: assignment.positionId },
        data: { permissions: ['shop-tenders.confirm', 'sensitive.cost.read'] },
      });
    });
    await attach(close.id, uploader).expect(403);
    expect(storage.deleteOwned.mock.calls).toHaveLength(cleanups + 1);
    expect(await db.shopCashSlipEvidence.count({ where: { sourceId: close.id } })).toBe(0);
  });
  it('preserves partial historical posting, including unposted held cash', async () => {
    const f = await setup(),
      close = (await count(f).expect(201)).body;
    await confirm(close.id, f.reviewer).expect(201);
    const old = await closeCase(f.branch, f.actor);
    await db.shopCashClose.update({
      where: { id: old.id },
      data: {
        status: 'CONFIRMED',
        destination: 'BRANCH_SAFE',
        receivedAmount: '70',
        confirmedById: f.reviewer,
        confirmedAt: new Date('2020-01-01'),
      },
    });
    const result = (await deposit(f.branch, f.reviewer, 'BRANCH_SAFE', 100).expect(201)).body;
    const row = await db.shopCashDeposit.findUniqueOrThrow({ where: { id: result.id } });
    const entry = await db.journalEntry.findUniqueOrThrow({
      where: { id: row.journalEntryId! },
      include: { lines: true },
    });
    expect(entry.lines.reduce((sum, line) => sum + Number(line.debit), 0)).toBe(30);
  });
  it('uses safe outer request evidence on success and denial without body/query/header copies', async () => {
    const f = await setup(),
      poison = 'PRIVATE-NOTE-KEY-DO-NOT-COPY';
    await post('cash-close', f.actor)
      .set('user-agent', poison)
      .send({ branchId: f.branch, countedAmount: 80, varianceReason: poison })
      .expect(201);
    await post('cash-close', denied)
      .set('user-agent', poison)
      .send({ branchId: f.branch, countedAmount: 80, varianceReason: poison })
      .expect(403);
    await Promise.allSettled([...auditPromises]);
    const logs = await db.auditLog.findMany({
      where: { userId: { in: [f.actor, denied] }, entity: 'shop-tenders' },
    });
    expect(logs.some((row) => row.action === 'POST_ERROR')).toBe(true);
    expect(
      JSON.stringify(logs, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)),
    ).not.toContain(poison);
  });
});

describe('Final edge contracts', () => {
  it('keeps current whole-branch cost and document grants independent even with no payouts', async () => {
    const f = await setup(),
      close = (await count(f).expect(201)).body;
    const noDoc = await user();
    await grant(
      noDoc,
      ['shop-tenders.read', 'shop-tenders.confirm', 'shop-tenders.deposit', 'sensitive.cost.read'],
      'SHOP',
      [f.branch],
    );
    const uploads = storage.uploadOwned.mock.calls.length;
    await attach(close.id, noDoc).expect(403);
    expect(storage.uploadOwned.mock.calls).toHaveLength(uploads);
    await attach(close.id, f.reviewer).expect(201);
    await getSlip('close', close.id, noDoc).expect(403);
    await confirm(close.id, f.reviewer).expect(201);
    await deposit(f.branch, noDoc).expect(403);
    const foreignDecision = await user();
    await grant(foreignDecision, ['shop-tenders.confirm', 'sensitive.cost.read'], 'SHOP', [
      foreignBranch,
    ]);
    await confirm(close.id, foreignDecision).expect(403); // closed status must not precede source denial
    const empty = await setup();
    await db.shopTender.delete({ where: { id: empty.payout.id } });
    const emptyClose = (await count(empty, 110).expect(201)).body;
    const noCost = await user();
    await grant(noCost, ['shop-tenders.confirm'], 'SHOP', [empty.branch]);
    await confirm(emptyClose.id, noCost).expect(403);
    await db.branch.update({ where: { id: empty.branch }, data: { isActive: false } });
    await confirm(emptyClose.id, empty.reviewer).expect(403);
  });
  it('enforces latest-only send-back, valid source-specific legacy image keys, and current branch configuration', async () => {
    const f = await setup(),
      first = (await count(f).expect(201)).body;
    const newer = await closeCase(f.branch, f.actor);
    await post(`cash-close/${first.id}/send-back`, f.reviewer)
      .send({ reason: 'check again' })
      .expect(400);
    const key = `shop-cash-close/${newer.id}/${Date.now()}-${randomUUID()}.png`;
    objects.set(key, png);
    await db.shopCashClose.update({ where: { id: newer.id }, data: { depositSlipKey: key } });
    await getSlip('close', newer.id, f.reviewer).expect(200);
    await db.shopCashClose.update({
      where: { id: newer.id },
      data: { depositSlipKey: `shop-cash-close/${first.id}/${Date.now()}-${randomUUID()}.png` },
    });
    await getSlip('close', newer.id, f.reviewer).expect(403);
  });
  it('destroys an acquired stalled stream after the fixed ten-second read deadline', async () => {
    const f = await setup(),
      close = (await count(f).expect(201)).body;
    await attach(close.id, f.reviewer).expect(201);
    const stalled = new Readable({ read() {} });
    storage.getStream.mockResolvedValueOnce(stalled);
    const started = Date.now();
    await getSlip('close', close.id, f.reviewer).expect(503);
    expect(Date.now() - started).toBeGreaterThanOrEqual(9900);
    expect(stalled.destroyed).toBe(true);
  }, 15000);
});

it('reconciles the exact disjoint A7 plus B7 registered parent14', () => {
  const a = [
    ...TENDER_READ_METHODS.map((method) => `ShopTendersController.${method}`),
    'ImportedSalesController.list',
    'ImportedSalesController.summary',
  ];
  const b = Object.keys(TENDER_MONEY_METHODS).map((method) => `ShopTendersController.${method}`);
  expect(a).toHaveLength(7);
  expect(b).toHaveLength(7);
  expect(new Set([...a, ...b]).size).toBe(14);
  for (const route of [...a, ...b]) expect(ACCESS_BOUNDARIES.has(route)).toBe(true);
  for (const [method, permission] of Object.entries(TENDER_MONEY_METHODS))
    expect(ACCESS_POLICIES[`ShopTendersController.${method}`].permission).toBe(permission);
});

it('accepts exactly 5 MiB and bounds multipart before larger files can be staged', async () => {
  const f = await setup(),
    close = (await count(f).expect(201)).body;
  const exact = Buffer.concat([png, Buffer.alloc(5242880 - png.length)]);
  await post(`cash-close/${close.id}/deposit-slip`, f.reviewer)
    .attach('file', exact, { filename: 'evidence.png', contentType: 'image/png' })
    .expect(201);
  const uploads = storage.uploadOwned.mock.calls.length;
  await post(`cash-close/${close.id}/deposit-slip`, f.reviewer)
    .attach('file', Buffer.concat([exact, Buffer.from([0])]), {
      filename: 'evidence.png',
      contentType: 'image/png',
    })
    .expect(413);
  expect(storage.uploadOwned.mock.calls).toHaveLength(uploads);
});

it('does not borrow a shared upload-preparation context for direct managed cash reads or counts', async () => {
  const f = await setup();
  const actor = { id: f.actor, role: 'SALES', branchId: f.branch };
  const { procurementPreparation } = await import('./access-preparation-context');
  await expect(
    procurementPreparation.run(
      { authorize: async () => undefined, execute: async (handler) => handler() },
      () =>
        app
          .get(ShopCashCloseService)
          .count(actor, { branchId: f.branch, countedAmount: 80, varianceReason: 'checked cash' }),
    ),
  ).rejects.toThrow();
  const row = await closeCase(f.branch, f.actor);
  const key = `shop-cash-close/${row.id}/${Date.now()}-${randomUUID()}.png`;
  objects.set(key, png);
  await db.shopCashClose.update({ where: { id: row.id }, data: { depositSlipKey: key } });
  const reads = storage.getStream.mock.calls.length,
    uploads = storage.uploadOwned.mock.calls.length;
  await expect(
    procurementPreparation.run(
      { authorize: async () => undefined, execute: async (handler) => handler() },
      () => app.get(ShopCashCloseService).getDepositSlip({ ...actor, role: 'OWNER' }, row.id),
    ),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    procurementPreparation.run(
      { authorize: async () => undefined, execute: async (handler) => handler() },
      () =>
        app
          .get(ShopCashCloseService)
          .attachDepositSlip({ ...actor, role: 'OWNER' }, row.id, {
            buffer: png,
            mimetype: 'image/png',
          } as Express.Multer.File),
    ),
  ).rejects.toMatchObject({ status: 403 });
  expect(storage.getStream.mock.calls).toHaveLength(reads);
  expect(storage.uploadOwned.mock.calls).toHaveLength(uploads);
});
