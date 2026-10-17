import * as periodLock from '../../utils/period-lock.util';
import { seedShopCoa } from '../../../prisma/seed-coa-shop';
import { seedFinanceCoa } from '../../../prisma/seed-coa-finance';
import { Prisma } from '@prisma/client';
import { lockEmployeeAccess } from './access-snapshot.service';
import { currentDomainAccess } from './access-execution-context';
import * as deferredWarnings from '../journal/deferred-warning';
import { bkkYyyymmdd } from '../../utils/document-number-format.util';
import {
  AccessAdjustmentsBoundaries,
  ADJUSTMENT_BOUNDARY_ROUTES,
} from './access-adjustments-boundaries';
import { StockAdjustmentsController } from '../inventory/stock-adjustments.controller';
import { StockAdjustmentsService } from '../inventory/stock-adjustments.service';
import { StockAdjustmentNumberService } from '../inventory/stock-adjustment-number.service';
import { ShopStockWriteOffTemplate } from '../journal/cpa-templates/shop-stock-writeoff.template';
import { ShopAccountResolver } from '../journal/shop-account-resolver.service';
import { CompanyResolverService } from '../journal/company-resolver.service';
import { JournalAutoService } from '../journal/journal-auto.service';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../storage/storage.service';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { PERMISSION_CATALOG, PermissionKey } from '@installment/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AccessSnapshotService } from './access-snapshot.service';
import { AccessResourceService } from './access-resource.service';
import { AccessPolicyService } from './access-policy';
import { AccessPolicyInterceptor } from './access-policy.interceptor';
import { ACCESS_BOUNDARIES } from './access-policy.registry';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BranchGuard } from '../auth/guards/branch.guard';

jest.mock('../journal/deferred-warning', () => ({ emitDeferredWarnings: jest.fn() }));

const url = process.env.EMPLOYEE_ACCESS_TEST_DATABASE_URL;
if (!url?.includes('/bc_access_task2?host=/tmp/bc-access-'))
  throw new Error('Explicit isolated URL required');
const db = new PrismaClient({ datasources: { db: { url } } });
const prisma = db as PrismaService;
const snapshots = new AccessSnapshotService(prisma);
const suffix = randomUUID();
const successes = new Map<string, { method: string; path: string; body: unknown }>();
let app: INestApplication,
  actor: string,
  denied: string,
  stock: string,
  branchA: string,
  branchB: string;
async function user(role: 'SALES' | 'OWNER' = 'SALES') {
  return (
    await db.user.create({
      data: {
        name: 'Procurement fixture',
        email: `${randomUUID()}@test.invalid`,
        password: 'unused',
        role,
        accessManaged: true,
      },
    })
  ).id;
}
async function grant(id: string, permissions: PermissionKey[], branches = [branchA]) {
  const p = await db.accessPosition.create({
    data: { code: randomUUID(), name: 'Fixture', permissions },
  });
  await db.employeeAccessAssignment.create({
    data: {
      userId: id,
      positionId: p.id,
      companyCode: 'SHOP',
      scope: 'BRANCHES',
      branches: { create: branches.map((branchId) => ({ branchId })) },
    },
  });
  return p.id;
}
function http(method: string, path: string, body?: unknown, id = actor) {
  const agent = request(app.getHttpServer());
  const req =
    method === 'get'
      ? agent.get(path)
      : method === 'patch'
        ? agent.patch(path)
        : method === 'delete'
          ? agent.delete(path)
          : agent.post(path);
  const test = req.set('x-test-user', id).expect('x-access-test-instance', suffix);
  if (body && (typeof body === 'object' || typeof body === 'string')) test.send(body);
  test.on('response', (res: request.Response) => {
    if (res.status >= 500) console.error(path, res.status, res.body);
  });
  return test;
}
const get = (path: string, id = actor) => http('get', path, undefined, id);
const post = (path: string, body: unknown, id = actor) => http('post', path, body, id);
beforeAll(async () => {
  for (const companyCode of ['SHOP', 'FINANCE'])
    await db.companyInfo.upsert({
      where: { companyCode },
      create: {
        companyCode,
        nameTh: 'Fixture',
        taxId: 'TEST',
        address: 'TEST',
        directorName: 'TEST',
      },
      update: {},
    });
  const shop = await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'SHOP' } });
  branchA = (
    await db.branch.create({ data: { name: 'A', companyId: shop.id, isMainWarehouse: true } })
  ).id;
  branchB = (await db.branch.create({ data: { name: 'B', companyId: shop.id } })).id;
  actor = await user();
  denied = await user();
  stock = await user();
  await grant(
    actor,
    PERMISSION_CATALOG.filter((p) => !p.ownerOnly && !p.allStaff).map((p) => p.key),
  );
  await grant(stock, ['stock-receiving.read', 'stock-receiving.create']);
  await db.user.create({
    data: {
      name: 'Journal fixture',
      email: 'admin@bestchoice.com',
      password: 'unused',
      role: 'OWNER',
      isSystemUser: true,
    },
  });

  await seedShopCoa(db);
  await seedFinanceCoa(db);
  const module = await Test.createTestingModule({
    controllers: [StockAdjustmentsController],
    providers: [
      AccessAdjustmentsBoundaries,
      AccessResourceService,
      AccessPolicyService,
      RolesGuard,
      BranchGuard,
      { provide: PrismaService, useValue: db },
      { provide: AccessSnapshotService, useValue: snapshots },
      StockAdjustmentsService,
      StockAdjustmentNumberService,
      ShopStockWriteOffTemplate,
      ShopAccountResolver,
      CompanyResolverService,
      JournalAutoService,
      AuditService,
      {
        provide: StorageService,
        useValue: {
          upload: jest.fn(),
          delete: jest.fn(),
          getSignedDownloadUrl: jest.fn().mockResolvedValue('https://test.invalid/photo'),
        },
      },
      { provide: APP_INTERCEPTOR, useClass: AccessPolicyInterceptor },
    ],
  })
    .overrideGuard(JwtAuthGuard)
    .useValue({
      canActivate: async (ctx: ExecutionContext) => {
        const req = ctx.switchToHttp().getRequest(),
          res = ctx.switchToHttp().getResponse();
        const route = `${ctx.getClass().name}.${ctx.getHandler().name}`;
        res.on('finish', () => {
          if (res.statusCode < 300 || (route.endsWith('.updatePayment') && res.statusCode === 410))
            successes.set(route, {
              method: req.method.toLowerCase(),
              path: req.originalUrl,
              body: structuredClone(req.body),
            });
        });
        req.user = {
          ...(await db.user.findUniqueOrThrow({ where: { id: req.headers['x-test-user'] } })),
          access: await snapshots.forUser(req.headers['x-test-user']),
        };
        if (req.headers['x-test-stale-role']) req.user.role = req.headers['x-test-stale-role'];
        return true;
      },
    })
    .overrideGuard(RolesGuard)
    .useValue({ canActivate: () => true })
    .overrideGuard(BranchGuard)
    .useValue({ canActivate: () => true })
    .compile();
  app = module.createNestApplication();
  app.use((_req: unknown, res: { setHeader(k: string, v: string): void }, next: () => void) => {
    res.setHeader('x-access-test-instance', suffix);
    next();
  });
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  await app.listen(0, '127.0.0.1');
}, 60000);
beforeEach(() => {
  jest.mocked(deferredWarnings.emitDeferredWarnings).mockClear();
});
afterAll(async () => {
  ACCESS_BOUNDARIES.clear();
  await app?.close();
  await db.$disconnect();
});

async function product(branchId = branchA) {
  return db.product.create({
    data: {
      name: 'Inventory fixture',
      brand: 'Apple',
      model: randomUUID(),
      category: 'PHONE_NEW',
      status: 'IN_STOCK',
      branchId,
      costPrice: 100,
      cashPrice: 200,
    },
  });
}
test('managed adjustment creation authorizes actual source and scopes lists before paging', async () => {
  const a = await product(),
    b = await product(branchB);
  await post('/stock-adjustments', { productId: b.id, reason: 'LOST' }).expect(403);
  const created = (
    await post('/stock-adjustments', { productId: a.id, reason: 'LOST' }).expect(201)
  ).body;
  expect(created).toMatchObject({ productId: a.id, status: 'PENDING_APPROVAL' });
  expect((await get('/stock-adjustments?limit=1').expect(200)).body.total).toBe(1);
  expect((await db.product.findUniqueOrThrow({ where: { id: a.id } })).status).toBe(
    'ADJUSTMENT_PENDING',
  );
  expect(
    await db.auditLog.count({
      where: { entityId: created.id, action: 'STOCK_ADJUSTMENT_REQUESTED' },
    }),
  ).toBe(1);
});

test('multipart evidence is staged once, authorized before upload, and masked without document authority', async () => {
  const p = await product();
  const storage = app.get(StorageService);
  const jpeg = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00,
  ]);
  const reader = await user();
  await grant(reader, ['stock-adjustments.create', 'stock-adjustments.read']);
  const response = await request(app.getHttpServer())
    .post('/stock-adjustments')
    .set('x-test-user', reader)
    .field('productId', p.id)
    .field('reason', 'DAMAGED')
    .attach('photos', jpeg, { filename: 'evidence.jpg', contentType: 'image/jpeg' })
    .expect(201);
  expect(response.body.photos).toEqual([]);
  expect(response.body.product).toBeNull();
  const row = await db.stockAdjustment.findUniqueOrThrow({ where: { id: response.body.id } });
  expect(row.photos).toHaveLength(1);
  jest.mocked(storage.getSignedDownloadUrl).mockClear();
  const detail = await get(`/stock-adjustments/${row.id}`, reader).expect(200);
  expect(detail.body.photoUrls).toEqual([]);
  expect(storage.getSignedDownloadUrl).not.toHaveBeenCalled();
  await grant(reader, ['documents.read']);
  expect((await get(`/stock-adjustments/${row.id}`, reader).expect(200)).body.photoUrls).toEqual([
    'https://test.invalid/photo',
  ]);
  expect(storage.getSignedDownloadUrl).toHaveBeenCalledWith(row.photos[0]);
  const uploads = jest.mocked(storage.upload).mock.calls.length;
  const foreign = await product(branchB);
  await request(app.getHttpServer())
    .post('/stock-adjustments')
    .set('x-test-user', reader)
    .field('productId', foreign.id)
    .field('reason', 'DAMAGED')
    .attach('photos', jpeg, { filename: 'evidence.jpg', contentType: 'image/jpeg' })
    .expect(403);
  expect(jest.mocked(storage.upload).mock.calls).toHaveLength(uploads);
});

async function bookedProduct(branchId = branchA, cost = 100) {
  const p = await product(branchId);
  await db.product.update({ where: { id: p.id }, data: { costPrice: cost } });
  const shop = await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'SHOP' } });
  const journal = await db.$transaction((tx) =>
    app.get(JournalAutoService).createAndPost(
      {
        companyId: shop.id,
        description: 'Fixture intake',
        reference: `fixture:${p.id}`,
        postedAt: new Date(),
        metadata: { flow: 'shop-repossession-intake', productId: p.id, branchId },
        lines: [
          {
            accountCode: 'S11-2001',
            dr: new Prisma.Decimal(100),
            cr: new Prisma.Decimal(0),
            description: 'inventory',
          },
          {
            accountCode: 'S21-1104',
            dr: new Prisma.Decimal(0),
            cr: new Prisma.Decimal(100),
            description: 'payable',
          },
        ],
      },
      tx,
    ),
  );
  return { ...p, intakeId: journal.id };
}
async function createAdjustment(productId: string, reason = 'LOST', id = actor) {
  return (await post('/stock-adjustments', { productId, reason }, id).expect(201)).body;
}

test('owner authority is current; SHOP cost at approval and FOUND exact reversal retain durable evidence', async () => {
  const owner = await user('OWNER'),
    p = await bookedProduct();
  const row = await createAdjustment(p.id);
  await post(`/stock-adjustments/${row.id}/approve`, {}, actor).expect(403);
  await db.product.update({ where: { id: p.id }, data: { costPrice: 125 } });
  const warnings: Array<{ tx: boolean; count: number }> = [];
  const emit = jest.spyOn(deferredWarnings, 'emitDeferredWarnings').mockImplementation((value) => {
    warnings.push({ tx: !!currentDomainAccess(), count: value.length });
  });
  const approved = await http('post', `/stock-adjustments/${row.id}/approve`, {}, owner)
    .set('x-test-stale-role', 'SALES')
    .expect(201);
  expect(approved.body.adjustment).toMatchObject({
    status: 'APPROVED',
    costAmount: '125',
    inventoryBooked: true,
  });
  expect(warnings).toEqual([{ tx: false, count: 1 }]);
  emit.mockRestore();
  const je = await db.journalEntry.findUniqueOrThrow({
    where: { id: approved.body.adjustment.journalEntryId },
    include: { lines: true, company: true },
  });
  expect(je.company.companyCode).toBe('SHOP');
  expect(je.lines.map((l) => [l.accountCode, l.debit.toFixed(2), l.credit.toFixed(2)])).toEqual([
    ['S53-1102', '125.00', '0.00'],
    ['S11-2001', '0.00', '125.00'],
  ]);
  const deleted = await db.product.findUniqueOrThrow({ where: { id: p.id } });
  expect(deleted.deletedAt).not.toBeNull();
  const foundLookup = await get(`/stock-adjustments/lookup?search=${p.model}&reason=FOUND`).expect(
    200,
  );
  expect(foundLookup.body.map((v: { id: string }) => v.id)).toContain(p.id);
  await get(`/stock-adjustments/preview?productId=${p.id}&reason=FOUND`).expect(200);
  const found = await createAdjustment(p.id, 'FOUND');
  const restored = (await post(`/stock-adjustments/${found.id}/approve`, {}, owner).expect(201))
    .body;
  expect(restored.productStatus).toBe('IN_STOCK');
  const reverse = await db.journalEntry.findUniqueOrThrow({
    where: { id: restored.adjustment.journalEntryId },
    include: { lines: true },
  });
  expect(
    reverse.lines.map((l) => [l.accountCode, l.debit.toFixed(2), l.credit.toFixed(2)]),
  ).toEqual(je.lines.map((l) => [l.accountCode, l.credit.toFixed(2), l.debit.toFixed(2)]));
  expect((await db.product.findUniqueOrThrow({ where: { id: p.id } })).deletedAt).toBeNull();
  expect(
    await db.auditLog.count({ where: { entityId: row.id, action: 'STOCK_ADJUSTMENT_APPROVED' } }),
  ).toBe(1);
  await post(`/stock-adjustments/${row.id}/approve`, {}, owner).expect(409);
});

test('rollback after real journal and audit writes leaves request, stock, Todo and accounting unchanged', async () => {
  const owner = await user('OWNER'),
    p = await bookedProduct(branchA, 125),
    row = await createAdjustment(p.id);
  const audit = app.get(AuditService),
    original = audit.log.bind(audit);
  const warning = jest
    .spyOn(deferredWarnings, 'emitDeferredWarnings')
    .mockImplementation(() => undefined);
  const spy = jest.spyOn(audit, 'log').mockImplementation(async (entry, tx) => {
    await original(entry, tx);
    if (entry.action === 'STOCK_ADJUSTMENT_APPROVED') throw new Error('terminal audit failure');
  });
  await post(`/stock-adjustments/${row.id}/approve`, {}, owner).expect(500);
  spy.mockRestore();
  expect(warning).not.toHaveBeenCalled();
  warning.mockRestore();
  expect((await db.stockAdjustment.findUniqueOrThrow({ where: { id: row.id } })).status).toBe(
    'PENDING_APPROVAL',
  );
  expect((await db.product.findUniqueOrThrow({ where: { id: p.id } })).status).toBe(
    'ADJUSTMENT_PENDING',
  );
  expect(
    await db.journalEntry.count({
      where: { metadata: { path: ['adjustmentId'], equals: row.id } },
    }),
  ).toBe(0);
  expect(
    await db.auditLog.count({ where: { entityId: row.id, action: 'STOCK_ADJUSTMENT_APPROVED' } }),
  ).toBe(0);
  expect(
    await db.todo.count({ where: { tags: { has: `sa:${row.requestNumber}` }, status: 'DONE' } }),
  ).toBe(0);
  await post(`/stock-adjustments/${row.id}/reject`, { reason: 'ตรวจสอบใหม่' }, owner).expect(201);
  expect((await db.product.findUniqueOrThrow({ where: { id: p.id } })).status).toBe('IN_STOCK');
});

test('source-sensitive cost, journal, product and file views require independent authority', async () => {
  const reader = await user();
  await grant(reader, ['stock-adjustments.read', 'stock-adjustments.create'], [branchA, branchB]);
  await grant(reader, ['sensitive.cost.read', 'products.read', 'documents.read'], [branchA]);
  const a = await bookedProduct(),
    b = await bookedProduct(branchB);
  const ar = await createAdjustment(a.id),
    br = await createAdjustment(b.id, 'LOST', reader);
  const detailA = (await get(`/stock-adjustments/${ar.id}`, reader).expect(200)).body;
  const detailB = (await get(`/stock-adjustments/${br.id}`, reader).expect(200)).body;
  expect(detailA.product.costPrice).toBe('100');
  expect(detailB.product).toBeNull();
  expect(detailA.booked.bookedAmount).toBe('100');
  expect(detailB.booked.bookedAmount).toBeNull();
  expect(detailA.booked.journalEntryNo).toBeNull();
  expect(detailB.journalEntryNo).toBeNull();
  const preview = (
    await get(`/stock-adjustments/preview?productId=${a.id}&reason=LOST`, reader).expect(200)
  ).body;
  expect(preview.journalNote).toBeNull();
  expect(preview.journalLines).toEqual([]);
  await grant(reader, ['journal.read']);
  const withJournal = (
    await get(`/stock-adjustments/preview?productId=${a.id}&reason=LOST`, reader).expect(200)
  ).body;
  expect(withJournal.journalLines).toHaveLength(2);
  expect(withJournal.journalNote).toContain('100.00');
  const owner = await user('OWNER');
  await post(`/stock-adjustments/${ar.id}/approve`, {}, owner).expect(201);
  await post(`/stock-adjustments/${br.id}/approve`, {}, owner).expect(201);
  const summary = (await get('/stock-adjustments/summary', reader).expect(200)).body;
  expect(summary.totalCount).toBeGreaterThan(0);
  expect(summary.totalValue).toBeNull();
  await get('/stock-adjustments/pending-count', reader).expect(200);
  await grant(reader, ['sensitive.cost.read'], [branchB]);
  expect(
    (await get('/stock-adjustments/summary', reader).expect(200)).body.totalValue,
  ).not.toBeNull();
});

test('FOUND rejects substituted journal product provenance before creating a recovery request', async () => {
  const owner = await user('OWNER'),
    p = await bookedProduct(),
    row = await createAdjustment(p.id);
  const approved = (await post(`/stock-adjustments/${row.id}/approve`, {}, owner).expect(201)).body;
  const je = await db.journalEntry.findUniqueOrThrow({
    where: { id: approved.adjustment.journalEntryId },
  });
  await db.journalEntry.update({
    where: { id: je.id },
    data: { metadata: { ...(je.metadata as Prisma.JsonObject), productId: randomUUID() } },
  });
  await post('/stock-adjustments', { productId: p.id, reason: 'FOUND' }).expect(400);
  expect(
    await db.stockAdjustment.count({ where: { productId: p.id, status: 'PENDING_APPROVAL' } }),
  ).toBe(0);
  const finance = await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'FINANCE' } });
  await db.journalEntry.update({
    where: { id: je.id },
    data: { companyId: finance.id, metadata: je.metadata as Prisma.InputJsonObject },
  });
  await post('/stock-adjustments', { productId: p.id, reason: 'FOUND' }).expect(400);
  await db.journalEntry.update({ where: { id: je.id }, data: { companyId: je.companyId } });
});

test('historical and current branches both authorize; requester ownership is independent of create grant', async () => {
  const requester = await user(),
    other = await user(),
    owner = await user('OWNER');
  await grant(requester, ['stock-adjustments.create', 'stock-adjustments.read']);
  await grant(other, ['stock-adjustments.create', 'stock-adjustments.read'], [branchA, branchB]);
  const p = await bookedProduct(),
    row = await createAdjustment(p.id, 'LOST', requester);
  await post(`/stock-adjustments/${row.id}/cancel`, {}, other).expect(403);
  await db.product.update({ where: { id: p.id }, data: { branchId: branchB } });
  await get(`/stock-adjustments/${row.id}`, requester).expect(403);
  expect(
    (await get(`/stock-adjustments?productId=${p.id}`, requester).expect(200)).body.total,
  ).toBe(0);
  await post(`/stock-adjustments/${row.id}/cancel`, {}, requester).expect(403);
  const currentOnly = await user();
  await grant(currentOnly, ['stock-adjustments.read'], [branchB]);
  await get(`/stock-adjustments/${row.id}`, currentOnly).expect(403);
  expect(
    (await get(`/stock-adjustments?productId=${p.id}`, currentOnly).expect(200)).body.total,
  ).toBe(0);
  await grant(requester, ['stock-adjustments.create', 'stock-adjustments.read'], [branchB]);
  await get(`/stock-adjustments/${row.id}`, requester).expect(200);
  await post(`/stock-adjustments/${row.id}/approve`, {}, owner).expect(201);
  const found = await createAdjustment(p.id, 'FOUND', requester);
  await post(`/stock-adjustments/${found.id}/approve`, {}, owner).expect(201);
  const note = await createAdjustment(p.id, 'OTHER', requester);
  await post(`/stock-adjustments/${note.id}/cancel`, {}, requester).expect(201);
});

test('numbering includes unrelated deleted rows and concurrent requests/approvals are exactly once', async () => {
  const unrelated = await product(branchB),
    prefix = `SA-${bkkYyyymmdd(new Date())}-`;
  await db.stockAdjustment.create({
    data: {
      productId: unrelated.id,
      branchId: branchB,
      requestNumber: `${prefix}0900`,
      reason: 'OTHER',
      previousStatus: 'IN_STOCK',
      adjustedById: actor,
      deletedAt: new Date(),
    },
  });
  const p = await product(),
    q = await product();
  const rows = await Promise.all([
    createAdjustment(p.id, 'OTHER'),
    createAdjustment(q.id, 'OTHER'),
  ]);
  expect(rows.map((r) => r.requestNumber).sort()).toEqual([`${prefix}0901`, `${prefix}0902`]);
  const duplicate = await product();
  const requests = await Promise.all([
    post('/stock-adjustments', { productId: duplicate.id, reason: 'LOST' }),
    post('/stock-adjustments', { productId: duplicate.id, reason: 'LOST' }),
  ]);
  expect(requests.map((r) => r.status).sort()).toEqual([201, 409]);
  const owner = await user('OWNER'),
    paid = await bookedProduct(),
    row = await createAdjustment(paid.id);
  const results = await Promise.all([
    post(`/stock-adjustments/${row.id}/approve`, {}, owner),
    post(`/stock-adjustments/${row.id}/approve`, {}, owner),
  ]);
  expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
  expect(
    await db.journalEntry.count({
      where: { metadata: { path: ['adjustmentId'], equals: row.id } },
    }),
  ).toBe(1);
  expect(
    await db.auditLog.count({ where: { entityId: row.id, action: 'STOCK_ADJUSTMENT_APPROVED' } }),
  ).toBe(1);
});

test('ASSIGNED never equates to requester; filters reject malformed values and actual company wins', async () => {
  const assigned = await user();
  const position = await db.accessPosition.create({
    data: {
      code: randomUUID(),
      name: 'Assigned',
      permissions: ['stock-adjustments.read', 'stock-adjustments.create'],
    },
  });
  await db.employeeAccessAssignment.create({
    data: { userId: assigned, positionId: position.id, companyCode: 'SHOP', scope: 'ASSIGNED' },
  });
  const p = await product();
  const row = await db.stockAdjustment.create({
    data: {
      productId: p.id,
      branchId: branchA,
      reason: 'OTHER',
      previousStatus: 'IN_STOCK',
      status: 'APPROVED',
      adjustedById: assigned,
    },
  });
  expect((await get('/stock-adjustments?mine=true', assigned).expect(200)).body.total).toBe(0);
  expect(
    (await get(`/stock-adjustments/lookup?search=${p.model}&reason=OTHER`, assigned).expect(200))
      .body,
  ).toEqual([]);
  await get(`/stock-adjustments/${row.id}`, assigned).expect(403);
  await post('/stock-adjustments', { productId: p.id, reason: 'OTHER' }, assigned).expect(403);
  for (const query of [
    'limit=0',
    'page=999999999999999999999999999',
    'page=2147483647',
    'status=bad',
    'reason=bad',
    'mine=bad',
    'page[]=1',
    'costPrice=1',
    'startDate=bad',
  ])
    await get(`/stock-adjustments?${query}`).expect(400);
  const finance = await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'FINANCE' } });
  await db.product.update({ where: { id: p.id }, data: { ownedByCompanyId: finance.id } });
  await post('/stock-adjustments', { productId: p.id, reason: 'OTHER' }).expect(403);
  const f = await user();
  const fp = await db.accessPosition.create({
    data: {
      code: randomUUID(),
      name: 'Finance',
      permissions: ['stock-adjustments.create', 'stock-adjustments.read'],
    },
  });
  await db.employeeAccessAssignment.create({
    data: {
      userId: f,
      positionId: fp.id,
      companyCode: 'FINANCE',
      scope: 'BRANCHES',
      branches: { create: { branchId: branchA } },
    },
  });
  const note = (
    await post(
      '/stock-adjustments?company=FINANCE',
      { productId: p.id, reason: 'CORRECTION' },
      f,
    ).expect(201)
  ).body;
  await get(`/stock-adjustments/${note.id}?company=FINANCE`, f).expect(200);
  await post(`/stock-adjustments/${note.id}/cancel?company=FINANCE`, {}, f).expect(201);
  const booked = await bookedProduct();
  await db.product.update({ where: { id: booked.id }, data: { ownedByCompanyId: finance.id } });
  await post(
    '/stock-adjustments?company=FINANCE',
    { productId: booked.id, reason: 'LOST' },
    f,
  ).expect(400);
  await get(
    `/stock-adjustments/preview?company=FINANCE&productId=${booked.id}&reason=LOST`,
    f,
  ).expect(400);
  expect(await db.stockAdjustment.count({ where: { productId: booked.id } })).toBe(0);
});

test('FOUND restores deleted sold and repossessed rows without bypassing their original status', async () => {
  const owner = await user('OWNER');
  for (const status of ['SOLD_INSTALLMENT', 'REPOSSESSED', 'SOLD_CASH'] as const) {
    const p = await product();
    await db.product.update({ where: { id: p.id }, data: { status, deletedAt: new Date() } });
    const preview = (
      await get(`/stock-adjustments/preview?productId=${p.id}&reason=FOUND`).expect(200)
    ).body;
    expect(preview.productStatusAfter).toBe(status);
    const row = await createAdjustment(p.id, 'FOUND');
    await post(`/stock-adjustments/${row.id}/approve`, {}, owner).expect(201);
    expect(await db.product.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({
      status,
      deletedAt: null,
    });
  }
});

test('FOUND preview original monetary and journal source does not inherit current product branch grants', async () => {
  const owner = await user('OWNER'),
    p = await bookedProduct(),
    row = await createAdjustment(p.id);
  await post(`/stock-adjustments/${row.id}/approve`, {}, owner).expect(201);
  await db.product.update({ where: { id: p.id }, data: { branchId: branchB } });
  const reader = await user();
  await grant(reader, ['stock-adjustments.read', 'journal.read'], [branchA, branchB]);
  await grant(reader, ['sensitive.cost.read'], [branchB]);
  const hidden = (
    await get(`/stock-adjustments/preview?productId=${p.id}&reason=FOUND`, reader).expect(200)
  ).body;
  expect(hidden.journalLines).toEqual([]);
  expect(hidden.journalNote).toBeNull();
  await grant(reader, ['sensitive.cost.read'], [branchA]);
  const visible = (
    await get(`/stock-adjustments/preview?productId=${p.id}&reason=FOUND`, reader).expect(200)
  ).body;
  expect(visible.journalLines).toHaveLength(2);
  expect(visible.journalNote).toContain('กลับรายการ');
});

function multipart(productId: string, count = 1) {
  const jpeg = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00,
  ]);
  const req = request(app.getHttpServer())
    .post('/stock-adjustments')
    .set('x-test-user', actor)
    .field('productId', productId)
    .field('reason', 'DAMAGED');
  for (let i = 0; i < count; i++)
    req.attach('photos', jpeg, { filename: `photo${i}.jpg`, contentType: 'image/jpeg' });
  return req;
}
test('staged evidence survives retry once and only owned files are cleaned on terminal/partial failure', async () => {
  const storage = app.get(StorageService),
    audit = app.get(AuditService),
    original = audit.log.bind(audit);
  jest.mocked(storage.upload).mockClear();
  jest.mocked(storage.delete).mockClear();
  jest.mocked(storage.upload).mockImplementation(async (key) => {
    expect(currentDomainAccess()).toBeUndefined();
    return key;
  });
  let attempts = 0;
  const retry = jest.spyOn(audit, 'log').mockImplementation(async (entry, tx) => {
    await original(entry, tx);
    if (entry.action === 'STOCK_ADJUSTMENT_REQUESTED' && ++attempts === 1)
      throw new Prisma.PrismaClientKnownRequestError('retry', {
        code: 'P2034',
        clientVersion: 'fixture',
      });
  });
  const p = await product(),
    response = await multipart(p.id).expect(201);
  retry.mockRestore();
  expect(attempts).toBe(2);
  expect(storage.upload).toHaveBeenCalledTimes(1);
  expect(storage.delete).not.toHaveBeenCalled();
  expect(
    await db.auditLog.count({
      where: { entityId: response.body.id, action: 'STOCK_ADJUSTMENT_REQUESTED' },
    }),
  ).toBe(1);
  expect(await db.stockAdjustment.count({ where: { productId: p.id } })).toBe(1);
  const q = await product();
  const terminal = jest.spyOn(audit, 'log').mockImplementation(async (entry, tx) => {
    await original(entry, tx);
    throw new Error('terminal request failure');
  });
  await multipart(q.id).expect(500);
  terminal.mockRestore();
  expect(storage.upload).toHaveBeenCalledTimes(2);
  expect(storage.delete).toHaveBeenCalledTimes(1);
  expect(storage.delete).toHaveBeenCalledWith(jest.mocked(storage.upload).mock.calls[1][0]);
  expect(await db.stockAdjustment.count({ where: { productId: q.id } })).toBe(0);
  expect((await db.product.findUniqueOrThrow({ where: { id: q.id } })).status).toBe('IN_STOCK');
  const partial = await product();
  jest
    .mocked(storage.upload)
    .mockResolvedValueOnce('first')
    .mockRejectedValueOnce(new Error('partial upload failure'));
  await multipart(partial.id, 2).expect(500);
  expect(storage.delete).toHaveBeenCalledTimes(2);
  expect(storage.delete).toHaveBeenLastCalledWith(jest.mocked(storage.upload).mock.calls[2][0]);
  expect(await db.stockAdjustment.count({ where: { productId: partial.id } })).toBe(0);
  const count = jest.mocked(storage.upload).mock.calls.length;
  await multipart(partial.id, 7).expect(400);
  expect(jest.mocked(storage.upload).mock.calls).toHaveLength(count);
});

test('actual execution rechecks source after staging and cleans its upload on changed destination', async () => {
  const storage = app.get(StorageService),
    p = await product();
  jest.mocked(storage.delete).mockClear();
  jest.mocked(storage.upload).mockImplementationOnce(async (key) => {
    await db.product.update({ where: { id: p.id }, data: { branchId: branchB } });
    return key;
  });
  await multipart(p.id).expect(403);
  expect(storage.delete).toHaveBeenCalledTimes(1);
  expect(await db.stockAdjustment.count({ where: { productId: p.id } })).toBe(0);
  expect((await db.product.findUniqueOrThrow({ where: { id: p.id } })).status).toBe('IN_STOCK');
});

test('approval retry emits warnings only after the real commit and persists one financial result', async () => {
  const owner = await user('OWNER'),
    p = await bookedProduct(branchA, 120),
    row = await createAdjustment(p.id);
  const audit = app.get(AuditService),
    original = audit.log.bind(audit);
  let attempts = 0;
  const observed: boolean[] = [];
  const warning = jest.spyOn(deferredWarnings, 'emitDeferredWarnings').mockImplementation(() => {
    observed.push(!!currentDomainAccess());
  });
  const retry = jest.spyOn(audit, 'log').mockImplementation(async (entry, tx) => {
    await original(entry, tx);
    if (entry.action === 'STOCK_ADJUSTMENT_APPROVED' && ++attempts === 1)
      throw new Prisma.PrismaClientKnownRequestError('retry', {
        code: 'P2034',
        clientVersion: 'fixture',
      });
  });
  await post(`/stock-adjustments/${row.id}/approve`, {}, owner).expect(201);
  retry.mockRestore();
  warning.mockRestore();
  expect(attempts).toBe(2);
  expect(observed).toEqual([false]);
  expect(
    await db.journalEntry.count({
      where: { metadata: { path: ['adjustmentId'], equals: row.id } },
    }),
  ).toBe(1);
  expect(
    await db.auditLog.count({ where: { entityId: row.id, action: 'STOCK_ADJUSTMENT_APPROVED' } }),
  ).toBe(1);
});

test('owner demotion while waiting for the real access lock prevents stale approval', async () => {
  const owner = await user('OWNER'),
    p = await bookedProduct(),
    row = await createAdjustment(p.id);
  let release!: () => void, locked!: () => void;
  const held = new Promise<void>((resolve) => {
      locked = resolve;
    }),
    unlock = new Promise<void>((resolve) => {
      release = resolve;
    });
  const demotion = db.$transaction(async (tx) => {
    await lockEmployeeAccess(tx);
    await tx.user.update({
      where: { id: owner },
      data: { role: 'SALES', accessRevision: { increment: 1 } },
    });
    locked();
    await unlock;
  });
  await held;
  const pending = post(`/stock-adjustments/${row.id}/approve`, {}, owner)
    .set('x-test-stale-role', 'OWNER')
    .then((response) => response);
  try {
    for (let i = 0; i < 100; i++) {
      const [{ waiting }] = await db.$queryRaw<
        Array<{ waiting: boolean }>
      >`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event = 'advisory' AND datname = current_database()) AS waiting`;
      if (waiting) break;
      if (i === 99) throw new Error('approval did not reach access lock');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  } finally {
    release();
  }
  await demotion;
  expect((await pending).status).toBe(403);
  expect((await db.stockAdjustment.findUniqueOrThrow({ where: { id: row.id } })).status).toBe(
    'PENDING_APPROVAL',
  );
  expect(
    await db.journalEntry.count({
      where: { metadata: { path: ['adjustmentId'], equals: row.id } },
    }),
  ).toBe(0);
});

async function receivingEvidence(productId: string, journalEntryId: string | null) {
  const supplier = await db.supplier.create({
    data: {
      name: 'Hidden source supplier',
      phone: '020000000',
      accessCompanyCode: 'SHOP',
      accessBranchId: branchB,
    },
  });
  const po = await db.purchaseOrder.create({
    data: {
      poNumber: randomUUID(),
      supplierId: supplier.id,
      createdById: actor,
      orderDate: new Date(),
      totalAmount: 100,
      accessCompanyCode: 'SHOP',
      accessBranchId: branchB,
      items: {
        create: {
          brand: 'Apple',
          model: randomUUID(),
          category: 'PHONE_NEW',
          quantity: 1,
          receivedQty: 1,
          unitPrice: 100,
        },
      },
    },
    include: { items: true },
  });
  return db.goodsReceiving.create({
    data: {
      grNumber: `GR-${randomUUID()}`,
      poId: po.id,
      receivedById: actor,
      items: {
        create: {
          poItemId: po.items[0].id,
          productId,
          status: 'PASS',
          receivedCost: 100,
          journalEntryId,
        },
      },
    },
  });
}
test('hidden procurement evidence stays internal and GR precedence plus zero/unbooked policies survive', async () => {
  const owner = await user('OWNER'),
    reader = await user();
  await grant(reader, [
    'stock-adjustments.create',
    'stock-adjustments.read',
    'sensitive.cost.read',
  ]);
  const p = await bookedProduct();
  const gr = await receivingEvidence(p.id, null);
  const preview = (
    await get(`/stock-adjustments/preview?productId=${p.id}&reason=LOST`, reader).expect(200)
  ).body;
  expect(preview.booked.booked).toBe(false);
  expect(JSON.stringify(preview)).not.toContain(gr.grNumber);
  const row = await createAdjustment(p.id, 'LOST', reader);
  const result = (await post(`/stock-adjustments/${row.id}/approve`, {}, owner).expect(201)).body;
  expect(result.adjustment.journalEntryId).toBeNull();
  expect(result.accountingNotified).toBe(true);
  const booked = await bookedProduct();
  await receivingEvidence(booked.id, booked.intakeId);
  const exists = (
    await get(`/stock-adjustments/preview?productId=${booked.id}&reason=LOST`, reader).expect(200)
  ).body;
  expect(exists.booked.booked).toBe(true);
  const bookedRow = await createAdjustment(booked.id, 'LOST', reader);
  expect(
    (await post(`/stock-adjustments/${bookedRow.id}/approve`, {}, owner).expect(201)).body
      .adjustment.journalEntryId,
  ).toBeTruthy();
  const zero = await bookedProduct(branchA, 0),
    zeroRow = await createAdjustment(zero.id);
  const zeroResult = (await post(`/stock-adjustments/${zeroRow.id}/approve`, {}, owner).expect(201))
    .body;
  expect(zeroResult.adjustment.journalEntryId).toBeNull();
  expect(zeroResult.accountingNotified).toBe(false);
});

test('post-grace CLOSED period failure propagates from the real validator and leaves financial state untouched', async () => {
  const owner = await user('OWNER'),
    p = await bookedProduct(),
    row = await createAdjustment(p.id);
  const shop = await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'SHOP' } });
  await db.accountingPeriod.create({
    data: { companyId: shop.id, year: 2030, month: 5, status: 'CLOSED' },
  });
  const original = periodLock.validatePeriodOpen;
  jest.useFakeTimers({
    now: new Date(2030, 4, 15),
    doNotFake: [
      'hrtime',
      'nextTick',
      'performance',
      'queueMicrotask',
      'setImmediate',
      'clearImmediate',
      'setTimeout',
      'clearTimeout',
      'setInterval',
      'clearInterval',
    ],
  });
  const validator = jest
    .spyOn(periodLock, 'validatePeriodOpen')
    .mockImplementation(async (tx, date, companyId) => {
      expect(companyId).toBe(shop.id);
      expect(currentDomainAccess()?.client).toBeDefined();
      // Model crossing the documented grace deadline after approval captured its date.
      jest.setSystemTime(new Date(2030, 5, 10));
      return original(tx, date, companyId);
    });
  try {
    await post(`/stock-adjustments/${row.id}/approve`, {}, owner).expect(400);
  } finally {
    validator.mockRestore();
    jest.useRealTimers();
  }
  expect((await db.stockAdjustment.findUniqueOrThrow({ where: { id: row.id } })).status).toBe(
    'PENDING_APPROVAL',
  );
  expect((await db.product.findUniqueOrThrow({ where: { id: p.id } })).status).toBe(
    'ADJUSTMENT_PENDING',
  );
  expect(
    await db.journalEntry.count({
      where: { metadata: { path: ['adjustmentId'], equals: row.id } },
    }),
  ).toBe(0);
});

test('DAMAGED retains stock with no journal, then FOUND can recover it after owner approval', async () => {
  const owner = await user('OWNER'),
    p = await product();
  const row = (await multipart(p.id).expect(201)).body;
  const damaged = (await post(`/stock-adjustments/${row.id}/approve`, {}, owner).expect(201)).body;
  expect(damaged.adjustment.journalEntryId).toBeNull();
  expect(await db.product.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({
    status: 'DAMAGED',
    deletedAt: null,
  });
  const found = await createAdjustment(p.id, 'FOUND');
  expect(
    (await post(`/stock-adjustments/${found.id}/approve`, {}, owner).expect(201)).body
      .productStatus,
  ).toBe('IN_STOCK');
});

test('current FINANCE ownership rejects unsupported posting but permits owner rejection and nonposting notes', async () => {
  const owner = await user('OWNER'),
    p = await bookedProduct(),
    row = await createAdjustment(p.id);
  const finance = await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'FINANCE' } });
  await db.product.update({ where: { id: p.id }, data: { ownedByCompanyId: finance.id } });
  await post(`/stock-adjustments/${row.id}/approve?company=FINANCE`, {}, owner).expect(400);
  expect(
    await db.journalEntry.count({
      where: { metadata: { path: ['adjustmentId'], equals: row.id } },
    }),
  ).toBe(0);
  await post(
    `/stock-adjustments/${row.id}/reject?company=FINANCE`,
    { reason: 'ใช้ขั้นตอนการเงิน' },
    owner,
  ).expect(201);
  const note = (
    await post(
      '/stock-adjustments?company=FINANCE',
      { productId: p.id, reason: 'OTHER' },
      owner,
    ).expect(201)
  ).body;
  const approved = (
    await post(`/stock-adjustments/${note.id}/approve?company=FINANCE`, {}, owner).expect(201)
  ).body;
  expect(approved.adjustment.status).toBe('APPROVED');
  expect(approved.adjustment.journalEntryId).toBeNull();
});

test('FINANCE zero and unbooked exits are unsupported without inventing SHOP classifications', async () => {
  const owner = await user('OWNER');
  const finance = await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'FINANCE' } });
  for (const costPrice of [0, 100]) {
    const p = await product();
    await db.product.update({
      where: { id: p.id },
      data: { ownedByCompanyId: finance.id, costPrice },
    });
    await post(
      '/stock-adjustments?company=FINANCE',
      { productId: p.id, reason: 'LOST' },
      owner,
    ).expect(400);
    await get(
      `/stock-adjustments/preview?company=FINANCE&productId=${p.id}&reason=WRITE_OFF`,
      owner,
    ).expect(400);
    expect(await db.stockAdjustment.count({ where: { productId: p.id } })).toBe(0);
    await db.product.update({
      where: { id: p.id },
      data: { status: 'SOLD_INSTALLMENT', deletedAt: new Date() },
    });
    const found = (
      await post(
        '/stock-adjustments?company=FINANCE',
        { productId: p.id, reason: 'FOUND' },
        owner,
      ).expect(201)
    ).body;
    await post(`/stock-adjustments/${found.id}/approve?company=FINANCE`, {}, owner).expect(201);
    expect(await db.product.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({
      status: 'SOLD_INSTALLMENT',
      deletedAt: null,
    });
  }
});

test('summary requires cost on the stamped posting branch as well as original and current branches', async () => {
  const shop = await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'SHOP' } });
  const branchC = (await db.branch.create({ data: { name: 'Posting C', companyId: shop.id } })).id;
  const owner = await user('OWNER'),
    p = await bookedProduct(),
    row = await createAdjustment(p.id);
  await db.product.update({ where: { id: p.id }, data: { branchId: branchC } });
  await post(`/stock-adjustments/${row.id}/approve`, {}, owner).expect(201);
  await db.product.update({ where: { id: p.id }, data: { branchId: branchB } });
  const reader = await user();
  await grant(reader, ['stock-adjustments.read', 'sensitive.cost.read'], [branchA, branchB]);
  const hidden = (await get('/stock-adjustments/summary', reader).expect(200)).body;
  expect(hidden.totalValue).toBeNull();
  await grant(reader, ['sensitive.cost.read'], [branchC]);
  const visible = (await get('/stock-adjustments/summary', reader).expect(200)).body;
  expect(visible.totalValue).not.toBeNull();
});

test('original branch company liveness is consistent between collection and record boundaries', async () => {
  const shop = await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'SHOP' } });
  const finance = await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'FINANCE' } });
  const original = await db.branch.create({
    data: { name: 'Historical finance branch', companyId: finance.id },
  });
  const owner = await user('OWNER'),
    p = await product(original.id);
  await db.product.update({ where: { id: p.id }, data: { ownedByCompanyId: shop.id } });
  const row = await createAdjustment(p.id, 'OTHER', owner);
  await db.product.update({ where: { id: p.id }, data: { branchId: branchA } });
  await db.companyInfo.update({ where: { id: finance.id }, data: { isActive: false } });
  try {
    await get(`/stock-adjustments/${row.id}`, owner).expect(403);
    expect((await get(`/stock-adjustments?productId=${p.id}`, owner).expect(200)).body.total).toBe(
      0,
    );
  } finally {
    await db.companyInfo.update({ where: { id: finance.id }, data: { isActive: true } });
  }
});

test('all ten registered adjustment boundaries have real success and persisted no-grants denial', async () => {
  expect(ADJUSTMENT_BOUNDARY_ROUTES).toHaveLength(10);
  expect(ADJUSTMENT_BOUNDARY_ROUTES.filter((route) => !successes.has(route))).toEqual([]);
  for (const route of ADJUSTMENT_BOUNDARY_ROUTES) {
    const hit = successes.get(route)!;
    await http(hit.method, hit.path, hit.body, denied).expect(403);
  }
});
