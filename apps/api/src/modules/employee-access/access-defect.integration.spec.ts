import { Logger } from '@nestjs/common';
import { AccessDefectBoundaries, DEFECT_BOUNDARY_ROUTES } from './access-defect-boundaries';
import { ACCESS_BOUNDARIES, ACCESS_POLICIES } from './access-policy.registry';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { Test } from '@nestjs/testing';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { PermissionKey } from '@installment/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AccessSnapshotService } from './access-snapshot.service';
import { AccessResourceService } from './access-resource.service';
import { AccessExchangeSourceService } from './access-exchange-source.service';
import { AccessTradeInProjectionService } from './access-trade-in-projection.service';
import { AccessPolicyService } from './access-policy';
import { AccessPolicyInterceptor } from './access-policy.interceptor';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { AuditService } from '../audit/audit.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { DefectExchangeController } from '../defect-exchange/defect-exchange.controller';
import { DefectExchangeService } from '../defect-exchange/defect-exchange.service';
import { RepairTicketsService } from '../repair-tickets/repair-tickets.service';
import { AccessRepairSourceService } from './access-repair-source.service';
import { AccessProcurementSourceService } from './access-procurement-source.service';
import { JournalAutoService } from '../journal/journal-auto.service';
import { DefectExchangeReversalTemplate } from '../journal/cpa-templates/defect-exchange-reversal.template';
import { ReceiptNumberService } from '../receipts/services/receipt-number.service';
import { ReceiptVoidReversalTemplate } from '../journal/cpa-templates/receipt-void-reversal.template';
import { ContractActivation1ATemplate } from '../journal/cpa-templates/contract-activation-1a.template';
import { seedStatementReview } from '../contracts/__tests__/credit-approval.fixture';
import { seedShopCoa } from '../../../prisma/seed-coa-shop';
import { seedFinanceCoa } from '../../../prisma/seed-coa-finance';
const url = process.env.EMPLOYEE_ACCESS_TEST_DATABASE_URL;
if (!url?.includes('/bc_access_task2?host=/tmp/bc-access-defect.'))
  throw new Error('Owned isolated database required');
const db = new PrismaClient({ datasources: { db: { url } } });
const prisma = db;
const snapshots = new AccessSnapshotService(db as PrismaService);
const resources = new AccessResourceService(db as PrismaService, snapshots);
const projection = new AccessTradeInProjectionService(resources);
const sources = new AccessExchangeSourceService(resources, projection);
const audit = new AuditService(db as PrismaService);
const journal = new JournalAutoService(db as PrismaService);
const repair = new RepairTicketsService(
  db as PrismaService,
  audit,
  {} as never,
  {} as never,
  {} as never,
  {} as never,
  new AccessRepairSourceService(
    resources,
    projection,
    new AccessProcurementSourceService(resources),
  ),
);
const defect = new DefectExchangeService(
  db as PrismaService,
  journal,
  new DefectExchangeReversalTemplate(journal, db as PrismaService),
  repair,
  new ReceiptVoidReversalTemplate(journal, db as PrismaService),
  new ReceiptNumberService(db as PrismaService),
  sources,
);
const act1a = new ContractActivation1ATemplate(journal, db as PrismaService);
let app: INestApplication,
  branchId: string,
  branchB: string,
  adminId: string,
  shopCompanyId: string,
  financeCompanyId: string;
const DAY = 86400000,
  marker = randomUUID();
const pendingAudits = new Set<Promise<unknown>>();
async function actor() {
  return db.user.create({
    data: {
      name: 'Defect actor',
      email: randomUUID() + '@test.invalid',
      password: 'unused',
      role: 'ACCOUNTANT',
      accessManaged: true,
    },
  });
}
async function grant(
  userId: string,
  permissions: PermissionKey[],
  companyCode: 'SHOP' | 'FINANCE',
  branchIds = [branchId],
) {
  const position = await db.accessPosition.create({
    data: { code: randomUUID(), name: 'Defect test', permissions },
  });
  return db.employeeAccessAssignment.create({
    data: {
      userId,
      positionId: position.id,
      companyCode,
      scope: 'BRANCHES',
      branches: { create: branchIds.map((branchId) => ({ branchId })) },
    },
  });
}
const common: PermissionKey[] = [
  'defect-exchanges.read',
  'defect-exchanges.create',
  'defect-exchanges.approve',
  'products.read',
  'customers.read',
];
async function authorized() {
  const who = await actor();
  await grant(who.id, common, 'SHOP');
  await grant(who.id, common, 'FINANCE');
  return who;
}
function http(method: 'get' | 'post', path: string, id: string, body?: object) {
  const client = request(app.getHttpServer());
  const call = client[method](path).set('x-test-user', id).expect('x-owned-defect-app', marker);
  return body ? call.send(body) : call;
}
beforeAll(async () => {
  await seedFinanceCoa(db);
  await seedShopCoa(db);
  shopCompanyId = (await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'SHOP' } })).id;
  financeCompanyId = (await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'FINANCE' } }))
    .id;
  adminId = (
    await db.user.create({
      data: {
        email: 'admin@bestchoice.com',
        password: 'unused',
        name: 'Journal',
        role: 'OWNER',
        accessManaged: true,
      },
    })
  ).id;
  branchId = (await db.branch.create({ data: { name: 'A', companyId: shopCompanyId } })).id;
  branchB = (await db.branch.create({ data: { name: 'B', companyId: shopCompanyId } })).id;
  const module = await Test.createTestingModule({
    controllers: [DefectExchangeController],
    providers: [
      AccessDefectBoundaries,
      { provide: PrismaService, useValue: db },
      { provide: AccessSnapshotService, useValue: snapshots },
      { provide: AccessResourceService, useValue: resources },
      { provide: AccessExchangeSourceService, useValue: sources },
      { provide: DefectExchangeService, useValue: defect },
      { provide: AuditService, useValue: audit },
      AccessPolicyService,
      { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
      { provide: APP_INTERCEPTOR, useClass: AccessPolicyInterceptor },
    ],
  })
    .overrideGuard(JwtAuthGuard)
    .useValue({
      canActivate: async (ctx: ExecutionContext) => {
        const req = ctx.switchToHttp().getRequest();
        const id = req.headers['x-test-user'];
        req.user = {
          ...(await db.user.findUniqueOrThrow({ where: { id } })),
          access: await snapshots.forUser(id),
        };
        return true;
      },
    })
    .overrideGuard(RolesGuard)
    .useValue({ canActivate: () => true })
    .compile();
  app = module.createNestApplication();
  app.use((_req: unknown, res: { setHeader: (k: string, v: string) => void }, next: () => void) => {
    res.setHeader('x-owned-defect-app', marker);
    next();
  });
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  await app.listen(0, '127.0.0.1');
  const log = audit.log.bind(audit);
  audit.log = (...args: Parameters<AuditService['log']>) => {
    const p = log(...args);
    pendingAudits.add(p);
    void p.finally(() => pendingAudits.delete(p)).catch(() => undefined);
    return p;
  };
}, 60000);
afterAll(async () => {
  await app?.close();
  await Promise.allSettled([...pendingAudits]);
  await db.$disconnect();
});
interface SwapFixture {
  customerId: string;
  oldProductId: string;
  newProductId: string;
  oldContractId: string;
}

/**
 * Old contract = the standard 17K/12M loan math the CPA goldens use:
 *   financed 10,000 + commission 1,000 + interest 6,000 (0.05/mo × 12)
 *   grossExclVat 17,000, VAT 1,190, installmentTotal 1,515.83
 */
async function seedSwapFixture(tag: string): Promise<SwapFixture> {
  const customer = await prisma.customer.create({
    data: {
      name: `__EXCH_TEST_${tag}__`,
      phone: `0899${tag.padStart(6, '0')}`,
      nationalId: `EXCHTEST-${tag}`,
    },
  });

  const model = 'DefectModel';
  const oldProduct = await prisma.product.create({
    data: {
      name: `Exch Test Old ${tag}`,
      brand: 'ExchTestBrand',
      model,
      storage: '128GB',
      imeiSerial: `EXCHTEST-${tag}-OLD`,
      category: 'PHONE_NEW',
      // Deliberately distinct acquisition costs; direct responses expose neither.
      costPrice: new Decimal('7500.00'),
      installmentPrice: new Decimal('12000.00'),
      branchId,
      status: 'SOLD_INSTALLMENT',
      ownedByCompanyId: financeCompanyId,
    },
  });

  // Genuine same-model replacement for the direct defect workflow.
  const newProduct = await prisma.product.create({
    data: {
      name: `Exch Test New ${tag}`,
      brand: 'ExchTestBrand',
      model,
      storage: '128GB',
      imeiSerial: `EXCHTEST-${tag}-NEW`,
      category: 'PHONE_NEW',
      costPrice: new Decimal('8000.00'),
      installmentPrice: new Decimal('12000.00'),
      branchId,
      status: 'IN_STOCK',
      ownedByCompanyId: shopCompanyId,
    },
  });

  const contract = await prisma.contract.create({
    data: {
      contractNumber: `EXCHTEST-${tag}-${Date.now()}`,
      customerId: customer.id,
      productId: oldProduct.id,
      branchId,
      salespersonId: adminId,
      planType: 'STORE_WITH_INTEREST',
      sellingPrice: new Decimal('12000.00'),
      downPayment: new Decimal('2000.00'),
      financedAmount: new Decimal('10000.00'),
      interestRate: new Decimal('0.0500'),
      totalMonths: 12,
      interestTotal: new Decimal('6000.00'),
      storeCommission: new Decimal('1000.00'),
      vatAmount: new Decimal('1190.00'),
      vatPct: new Decimal('0.0700'),
      monthlyPayment: new Decimal('1515.83'),
      status: 'ACTIVE',
    },
  });

  return {
    customerId: customer.id,
    oldProductId: oldProduct.id,
    newProductId: newProduct.id,
    oldContractId: contract.id,
  };
}

async function fixture() {
  const f = await seedSwapFixture(randomUUID());
  await db.product.updateMany({
    where: { id: { in: [f.oldProductId, f.newProductId] } },
    data: { category: 'PHONE_USED' },
  });
  await act1a.execute(f.oldContractId);
  await seedStatementReview(db, f.customerId);
  return f;
}
function dto(f: SwapFixture) {
  return {
    oldContractId: f.oldContractId,
    newProductId: f.newProductId,
    defectReason: 'Persistent display failure',
  };
}
it('actual eligibility HTTP allows current sources and denies no grants', async () => {
  const who = await authorized(),
    no = await actor(),
    f = await fixture();
  await http(
    'get',
    `/defect-exchange/eligibility/${f.oldContractId}?newProductId=${f.newProductId}`,
    no.id,
  ).expect(403);
  const result = await http(
    'get',
    `/defect-exchange/eligibility/${f.oldContractId}?newProductId=${f.newProductId}`,
    who.id,
  ).expect(200);
  expect(result.body).toMatchObject({
    eligible: true,
    oldContract: { id: f.oldContractId },
    newProduct: { id: f.newProductId },
  });
});
it('actual execute HTTP allows real canonical money and denies no grants', async () => {
  const who = await authorized(),
    no = await actor(),
    f = await fixture();
  await http('post', '/defect-exchange/execute', no.id, dto(f)).expect(403);
  const before = await db.journalEntry.count();
  const result = await http('post', '/defect-exchange/execute', who.id, dto(f)).expect(201);
  expect(result.body.oldContract.status).toBe('DEFECT_EXCHANGED');
  expect(
    (
      await db.contract.findUniqueOrThrow({ where: { id: result.body.newContract.id } })
    ).financedAmount.toFixed(2),
  ).toBe('10000.00');
  expect(await db.journalEntry.count()).toBe(before + 1);
});
it('actual list HTTP returns useful genuine history and denies no grants', async () => {
  const who = await authorized(),
    no = await actor(),
    f = await fixture();
  // Preparation through reviewed exact-client executor; no HTTP credit for this setup.
  const result = (
    await resources.execute(
      who.id,
      'defect-exchanges.create',
      'SHOP',
      undefined,
      () => defect.execute(dto(f), who),
      false,
      { isolationLevel: 'Serializable', maxAttempts: 3 },
    )
  ).result;
  await http('get', '/defect-exchange', no.id).expect(403);
  const list = await http('get', '/defect-exchange', who.id).expect(200);
  expect(list.body).toEqual(
    expect.arrayContaining([expect.objectContaining({ entityId: result.newContract.id })]),
  );
});

it('registers exactly the three manifest actions and resolutions', () => {
  expect(DEFECT_BOUNDARY_ROUTES).toEqual([
    'DefectExchangeController.getEligibility',
    'DefectExchangeController.execute',
    'DefectExchangeController.list',
  ]);
  for (const route of DEFECT_BOUNDARY_ROUTES) {
    expect(ACCESS_BOUNDARIES.has(route)).toBe(true);
    expect(ACCESS_POLICIES[route]).toMatchObject({
      permission: route.endsWith('.execute') ? 'defect-exchanges.create' : 'defect-exchanges.read',
      resolution: route.endsWith('.list') ? 'collection' : 'record',
    });
  }
});
it.each(['finance', 'product-read', 'customer', 'approve'] as const)(
  'requires independent %s authority for actual execute',
  async (mode) => {
    const who = await actor(),
      f = await fixture();
    await grant(
      who.id,
      common.filter((p) =>
        mode === 'approve'
          ? p !== 'defect-exchanges.approve'
          : mode === 'product-read'
            ? p !== 'products.read'
            : mode === 'customer'
              ? p !== 'customers.read'
              : true,
      ),
      'SHOP',
    );
    if (mode !== 'finance')
      await grant(
        who.id,
        common.filter((p) =>
          mode === 'approve'
            ? p !== 'defect-exchanges.approve'
            : mode === 'product-read'
              ? p !== 'products.read'
              : mode === 'customer'
                ? p !== 'customers.read'
                : true,
        ),
        'FINANCE',
      );
    const count = await db.journalEntry.count();
    await http('post', '/defect-exchange/execute', who.id, dto(f)).expect(403);
    expect(await db.journalEntry.count()).toBe(count);
    expect(await db.contract.count({ where: { parentContractId: f.oldContractId } })).toBe(0);
  },
);
it('read authority alone is useful but never execute approval; create plus approve does not require read', async () => {
  const reader = await actor(),
    writer = await actor(),
    f = await fixture();
  for (const company of ['SHOP', 'FINANCE'] as const) {
    await grant(reader.id, ['defect-exchanges.read', 'products.read', 'customers.read'], company);
    await grant(
      writer.id,
      ['defect-exchanges.create', 'defect-exchanges.approve', 'products.read', 'customers.read'],
      company,
    );
  }
  await http('get', `/defect-exchange/eligibility/${f.oldContractId}`, reader.id).expect(200);
  await http('post', '/defect-exchange/execute', reader.id, dto(f)).expect(403);
  await http('get', `/defect-exchange/eligibility/${f.oldContractId}`, writer.id).expect(403);
  await http('post', '/defect-exchange/execute', writer.id, dto(f)).expect(201);
});
it.each(['contract', 'original', 'replacement'] as const)(
  'uses the current independent %s source and original permission tuples',
  async (mode) => {
    const who = await authorized(),
      f = await fixture();
    if (mode === 'contract')
      await db.contract.update({ where: { id: f.oldContractId }, data: { branchId: branchB } });
    else
      await db.product.update({
        where: { id: mode === 'original' ? f.oldProductId : f.newProductId },
        data: { branchId: branchB },
      });
    // An unrelated read grant in B must never manufacture action in B.
    for (const company of ['SHOP', 'FINANCE'] as const)
      await grant(who.id, ['products.read', 'customers.read'], company, [branchB]);
    await http(
      'get',
      `/defect-exchange/eligibility/${f.oldContractId}?newProductId=${f.newProductId}`,
      who.id,
    ).expect(403);
    await http('post', '/defect-exchange/execute', who.id, dto(f)).expect(403);
    for (const company of ['SHOP', 'FINANCE'] as const)
      await grant(who.id, common, company, [branchB]);
    await http(
      'get',
      `/defect-exchange/eligibility/${f.oldContractId}?newProductId=${f.newProductId}`,
      who.id,
    ).expect(200);
    await http('post', '/defect-exchange/execute', who.id, dto(f)).expect(201);
  },
);
it('rejects a deleted replacement and wrong work context without exposing blocked reasons', async () => {
  const who = await authorized(),
    f = await fixture();
  await db.product.update({ where: { id: f.newProductId }, data: { deletedAt: new Date() } });
  const denied = await http(
    'get',
    `/defect-exchange/eligibility/${f.oldContractId}?newProductId=${f.newProductId}`,
    who.id,
  ).expect(403);
  expect(denied.body.oldContract).toBeUndefined();
  await db.product.update({ where: { id: f.newProductId }, data: { deletedAt: null } });
  await http(
    'get',
    `/defect-exchange/eligibility/${f.oldContractId}?company=FINANCE`,
    who.id,
  ).expect(403);
});
it('preserves window, state, model and genuine override-origin guards', async () => {
  const who = await authorized(),
    f = await fixture();
  await db.contract.update({
    where: { id: f.oldContractId },
    data: { deviceReceivedAt: new Date(Date.now() - 10 * DAY) },
  });
  const eligibility = await http(
    'get',
    `/defect-exchange/eligibility/${f.oldContractId}`,
    who.id,
  ).expect(200);
  expect(eligibility.body.eligible).toBe(false);
  await http('post', '/defect-exchange/execute', who.id, dto(f)).expect(400);
  await http('post', '/defect-exchange/execute', who.id, {
    ...dto(f),
    bypassWindowCheck: true,
  }).expect(400);
  await http('post', '/defect-exchange/execute', who.id, {
    ...dto(f),
    bypassWindowCheck: true,
    originRepairTicketId: randomUUID(),
  }).expect(403);
  await http('post', '/defect-exchange/execute', who.id, {
    ...dto(f),
    bypassWindowCheck: true,
    originAfterSalesCaseId: randomUUID(),
  }).expect(403);
  await db.contract.update({
    where: { id: f.oldContractId },
    data: { deviceReceivedAt: new Date() },
  });
  await db.product.update({ where: { id: f.newProductId }, data: { model: 'different' } });
  await http('post', '/defect-exchange/execute', who.id, dto(f)).expect(400);
  expect(await db.contract.count({ where: { parentContractId: f.oldContractId } })).toBe(0);
});
it('rejects unproven direct photos and malformed input while empty photos remain usable', async () => {
  const who = await authorized(),
    f = await fixture();
  const result = await http('post', '/defect-exchange/execute', who.id, {
    ...dto(f),
    photoUrls: ['https://secret.invalid/token?key=private'],
  }).expect(400);
  expect(JSON.stringify(result.body)).not.toContain('secret.invalid');
  await http('post', '/defect-exchange/execute', who.id, { ...dto(f), photoUrls: 'bad' }).expect(
    400,
  );
  await http('get', '/defect-exchange?from=invalid', who.id).expect(400);
  await http('get', '/defect-exchange?branchId=invalid', who.id).expect(400);
  await http('get', '/defect-exchange?from=2026-02-01&to=2026-01-01', who.id).expect(400);
  await http(
    'get',
    `/defect-exchange/eligibility/${f.oldContractId}?newProductId=x&newProductId=y`,
    who.id,
  ).expect(400);
  await http('post', '/defect-exchange/execute', who.id, { ...dto(f), photoUrls: [] }).expect(201);
});
async function exchanged(who: { id: string }, f: SwapFixture) {
  return (await http('post', '/defect-exchange/execute', who.id, dto(f)).expect(201)).body;
}
it('projects only finite correlated history and safe actor, preserving original raw audit', async () => {
  const who = await authorized(),
    f = await fixture(),
    result = await exchanged(who, f);
  const original = await db.auditLog.findFirstOrThrow({
    where: { action: 'DEFECT_EXCHANGE', entityId: result.newContract.id },
  });
  const poison = {
    ...(original.newValue as object),
    oldContractNumber: 'FORGED',
    newContractNumber: 'FORGED',
    costPrice: 123,
    profit: 321,
    defectReason: 'private reason',
    notes: 'private notes',
    photoUrls: ['https://private.invalid/secret'],
    extra: { secret: 'hidden' },
  };
  const row = await db.auditLog.create({
    data: {
      userId: who.id,
      action: 'DEFECT_EXCHANGE',
      entity: 'contract',
      entityId: result.newContract.id,
      newValue: poison,
    },
  });
  const list = await http('get', '/defect-exchange', who.id).expect(200);
  const item = list.body.find((r: { id: string }) => r.id === row.id);
  expect(item).toEqual({
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    entity: 'contract',
    entityId: result.newContract.id,
    user: { id: who.id, name: who.name },
    coverage: 'VISIBLE_CURRENT_CORRELATED',
    newValue: {
      oldContractId: f.oldContractId,
      oldContractNumber: result.oldContract.contractNumber,
      newContractId: result.newContract.id,
      newContractNumber: result.newContract.contractNumber,
      oldProductId: f.oldProductId,
      newProductId: f.newProductId,
      transferredCredit: 0,
      supplierClaimEligible: false,
      photoUrls: null,
      photosState: 'UNAVAILABLE',
    },
  });
  expect((await db.auditLog.findUniqueOrThrow({ where: { id: row.id } })).newValue).toEqual(poison);
});
it.each([
  'entity',
  'oldContractId',
  'newContractId',
  'oldProductId',
  'newProductId',
  'customer',
  'current-product',
] as const)('omits history with invalid %s correlation', async (mode) => {
  const who = await authorized(),
    f = await fixture(),
    result = await exchanged(who, f);
  const original = await db.auditLog.findFirstOrThrow({
    where: { action: 'DEFECT_EXCHANGE', entityId: result.newContract.id },
  });
  const value = {
    ...(original.newValue as object),
    ...(['entity', 'customer', 'current-product'].includes(mode) ? {} : { [mode]: randomUUID() }),
  };
  const row = await db.auditLog.create({
    data: {
      userId: who.id,
      action: 'DEFECT_EXCHANGE',
      entity: mode === 'entity' ? 'product' : 'contract',
      entityId: result.newContract.id,
      newValue: value,
    },
  });
  if (mode === 'customer') {
    const other = await db.customer.create({
      data: { name: 'Other', phone: '0800000000', nationalId: randomUUID() },
    });
    await db.contract.update({
      where: { id: result.newContract.id },
      data: { customerId: other.id },
    });
  }
  if (mode === 'current-product')
    await db.contract.update({
      where: { id: result.newContract.id },
      data: { productId: f.oldProductId },
    });
  const list = await http('get', '/defect-exchange', who.id).expect(200);
  expect(list.body.some((r: { id: string }) => r.id === row.id)).toBe(false);
});
it('nulls malformed business snapshots without treating arbitrary audit text as authority', async () => {
  const who = await authorized(),
    f = await fixture(),
    result = await exchanged(who, f);
  const original = await db.auditLog.findFirstOrThrow({
    where: { action: 'DEFECT_EXCHANGE', entityId: result.newContract.id },
  });
  const row = await db.auditLog.create({
    data: {
      userId: who.id,
      action: 'DEFECT_EXCHANGE',
      entity: 'contract',
      entityId: result.newContract.id,
      newValue: {
        ...(original.newValue as object),
        transferredCredit: -50,
        supplierClaimEligible: 'true',
      },
    },
  });
  const list = await http('get', '/defect-exchange', who.id).expect(200);
  expect(list.body.find((r: { id: string }) => r.id === row.id).newValue).toMatchObject({
    transferredCredit: null,
    supplierClaimEligible: null,
  });
});
it('filters foreign and invalid newer rows before the final visible200 with deterministic branch/date limits', async () => {
  const who = await authorized(),
    f = await fixture(),
    result = await exchanged(who, f);
  const original = await db.auditLog.findFirstOrThrow({
    where: { action: 'DEFECT_EXCHANGE', entityId: result.newContract.id },
  });
  const foreign = await fixture();
  await db.contract.update({
    where: { id: foreign.oldContractId },
    data: { branchId: branchB, parentContractId: f.oldContractId },
  });
  const ids: string[] = Array.from({ length: 201 }, () => randomUUID())
    .sort()
    .reverse();
  const base = {
    userId: who.id,
    action: 'DEFECT_EXCHANGE',
    entity: 'contract',
    entityId: result.newContract.id,
    newValue: original.newValue!,
  };
  await db.auditLog.createMany({
    data: [
      ...ids.map((id) => ({ ...base, id, createdAt: new Date('2025-01-01') })),
      ...Array.from({ length: 201 }, () => ({
        ...base,
        createdAt: new Date('2025-01-02'),
        newValue: { ...(original.newValue as object), oldProductId: randomUUID() },
      })),
      ...Array.from({ length: 201 }, () => ({
        ...base,
        createdAt: new Date('2025-01-03'),
        entityId: foreign.oldContractId,
      })),
    ],
  });
  const path = `/defect-exchange?branchId=${branchId}&from=2025-01-01&to=2025-01-04`;
  const list = await http('get', path, who.id).expect(200);
  expect(list.body.map((r: { id: string }) => r.id)).toEqual(ids.slice(0, 200));
  for (const company of ['SHOP', 'FINANCE'] as const)
    await grant(who.id, common, company, [branchB]);
  const repeated = await http('get', path, who.id).expect(200);
  expect(repeated.body.map((r: { id: string }) => r.id)).toEqual(ids.slice(0, 200));
}, 30000);

it.each(['eligibility', 'execute', 'list'] as const)(
  'rechecks current %s authority after an observed advisory wait',
  async (mode) => {
    const who = await authorized(),
      f = await fixture();
    if (mode === 'list') await exchanged(who, f);
    let release!: () => void, locked!: () => void;
    const held = new Promise<void>((r) => (locked = r)),
      unlock = new Promise<void>((r) => (release = r));
    const changing = db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(718294630)`;
        const assignments = await tx.employeeAccessAssignment.findMany({
          where: { userId: who.id },
        });
        await tx.accessPosition.updateMany({
          where: { id: { in: assignments.map((a) => a.positionId) } },
          data: { permissions: [] },
        });
        locked();
        await unlock;
      },
      { timeout: 15000 },
    );
    await held;
    const pending = (
      mode === 'execute'
        ? http('post', '/defect-exchange/execute', who.id, dto(f))
        : http(
            'get',
            mode === 'list'
              ? '/defect-exchange'
              : `/defect-exchange/eligibility/${f.oldContractId}`,
            who.id,
          )
    ).then((r) => r);
    try {
      for (let i = 0; i < 100; i++) {
        const [{ waiting }] = await db.$queryRaw<
          Array<{ waiting: boolean }>
        >`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event='advisory' AND datname=current_database()) AS waiting`;
        if (waiting) break;
        if (i === 99) throw new Error('No real waiter observed');
        await new Promise((r) => setTimeout(r, 10));
      }
    } finally {
      release();
    }
    await changing;
    expect((await pending).status).toBe(403);
    expect(await db.contract.count({ where: { parentContractId: f.oldContractId } })).toBe(
      mode === 'list' ? 1 : 0,
    );
  },
);
it('filters currently unreadable FINANCE and Product history even with SHOP list rights', async () => {
  const who = await authorized(),
    f = await fixture(),
    result = await exchanged(who, f);
  await db.product.update({ where: { id: f.newProductId }, data: { branchId: branchB } });
  let list = await http(
    'get',
    `/defect-exchange?from=${new Date(Date.now() - DAY).toISOString()}`,
    who.id,
  ).expect(200);
  expect(list.body.some((r: { entityId: string }) => r.entityId === result.newContract.id)).toBe(
    false,
  );
  await db.product.update({ where: { id: f.newProductId }, data: { branchId } });
  const assignments = await db.employeeAccessAssignment.findMany({
    where: { userId: who.id, companyCode: 'FINANCE' },
  });
  await db.accessPosition.updateMany({
    where: { id: { in: assignments.map((a) => a.positionId) } },
    data: { permissions: ['products.read', 'customers.read'] },
  });
  list = await http(
    'get',
    `/defect-exchange?from=${new Date(Date.now() - DAY).toISOString()}`,
    who.id,
  ).expect(200);
  expect(list.body.some((r: { entityId: string }) => r.entityId === result.newContract.id)).toBe(
    false,
  );
});
it('rolls back late mandatory audit including real repair child, then commits once concurrently with aftercommit effects', async () => {
  const who = await authorized(),
    f = await fixture();
  await db.contract.update({
    where: { id: f.oldContractId },
    data: { deviceReceivedAt: new Date(Date.now() - 20 * DAY) },
  });
  const ticket = await db.repairTicket.create({
    data: {
      ticketNumber: randomUUID(),
      branchId,
      customerId: f.customerId,
      contractId: f.oldContractId,
      productId: f.oldProductId,
      defectDescription: 'Broken',
      payer: 'SHOP',
      warrantyStatus: 'IN_SHOP_WARRANTY',
      createdById: who.id,
    },
  });
  const body = { ...dto(f), bypassWindowCheck: true, originRepairTicketId: ticket.id };
  // Genuine repair child authority remains independent of direct exchange rights.
  await http('post', '/defect-exchange/execute', who.id, body).expect(403);
  await grant(who.id, ['contracts.read'], 'SHOP');
  const journals = await db.journalEntry.count(),
    statusLogs = await db.repairStatusLog.count();
  const effectReads: Promise<string>[] = [];
  const logger = jest
    .spyOn((defect as unknown as { logger: { log: (s: string) => void } }).logger, 'log')
    .mockImplementation(() => {
      effectReads.push(
        db.contract.findUniqueOrThrow({ where: { id: f.oldContractId } }).then((c) => c.status),
      );
    });
  // Capture only the deliberately injected exception; unexpected errors still print.
  const originalError = Logger.prototype.error;
  const nestError = jest.spyOn(Logger.prototype, 'error').mockImplementation(function (
    ...args: Parameters<Logger['error']>
  ) {
    if (!args.some((a) => String(a).includes('owned late defect audit failure')))
      originalError.apply(this, args);
  });
  try {
    await db.$executeRawUnsafe(
      `CREATE FUNCTION fail_direct_defect_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'DEFECT_EXCHANGE' THEN RAISE EXCEPTION 'owned late defect audit failure'; END IF; RETURN NEW; END $$`,
    );
    await db.$executeRawUnsafe(
      'CREATE TRIGGER fail_direct_defect_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION fail_direct_defect_audit()',
    );
    await http('post', '/defect-exchange/execute', who.id, body).expect(500);
  } finally {
    await db.$executeRawUnsafe('DROP TRIGGER fail_direct_defect_audit ON audit_logs');
    await db.$executeRawUnsafe('DROP FUNCTION fail_direct_defect_audit()');
    nestError.mockRestore();
  }
  expect(await db.journalEntry.count()).toBe(journals);
  expect(await db.repairStatusLog.count()).toBe(statusLogs);
  expect(
    await db.auditLog.count({
      where: {
        action: 'DEFECT_EXCHANGE',
        newValue: { path: ['oldContractId'], equals: f.oldContractId },
      },
    }),
  ).toBe(0);
  expect(await db.contract.count({ where: { parentContractId: f.oldContractId } })).toBe(0);
  expect((await db.contract.findUniqueOrThrow({ where: { id: f.oldContractId } })).status).toBe(
    'ACTIVE',
  );
  expect((await db.product.findUniqueOrThrow({ where: { id: f.newProductId } })).status).toBe(
    'IN_STOCK',
  );
  expect((await db.repairTicket.findUniqueOrThrow({ where: { id: ticket.id } })).status).toBe(
    'OPEN',
  );
  expect(logger).not.toHaveBeenCalled();
  try {
    const pair = await Promise.all([
      http('post', '/defect-exchange/execute', who.id, body),
      http('post', '/defect-exchange/execute', who.id, body),
    ]);
    expect(pair.map((r) => r.status).sort()).toEqual([201, 400]);
    expect(await db.contract.count({ where: { parentContractId: f.oldContractId } })).toBe(1);
    expect(await db.journalEntry.count()).toBe(journals + 1);
    expect(await db.repairStatusLog.count()).toBe(statusLogs + 1);
    expect(
      await db.auditLog.count({
        where: {
          action: 'DEFECT_EXCHANGE',
          newValue: { path: ['oldContractId'], equals: f.oldContractId },
        },
      }),
    ).toBe(1);
    expect(logger).toHaveBeenCalledTimes(1);
    expect(await Promise.all(effectReads)).toEqual(['DEFECT_EXCHANGED']);
    await http('post', '/defect-exchange/execute', who.id, body).expect(400);
  } finally {
    logger.mockRestore();
  }
});
it('captures finite HTTP success and failure evidence without caller notes, URLs or error text', async () => {
  const who = await authorized(),
    f = await fixture();
  await http('post', '/defect-exchange/execute', who.id, {
    ...dto(f),
    notes: 'PRIVATE-NOTE',
    photoUrls: ['https://PRIVATE-URL.invalid'],
  }).expect(400);
  await http('get', `/defect-exchange/eligibility/${f.oldContractId}`, who.id).expect(200);
  await Promise.allSettled([...pendingAudits]);
  const rows = await db.auditLog.findMany({
    where: { userId: who.id, action: { in: ['POST_ERROR', 'GET'] } },
  });
  expect(rows).toHaveLength(2);
  for (const row of rows) {
    expect(Object.keys(row.newValue as object).sort()).toEqual([
      'duration',
      'outcome',
      'route',
      'statusCode',
    ]);
    expect(JSON.stringify(row.newValue)).not.toMatch(/PRIVATE-NOTE|PRIVATE-URL/);
    expect(row.ipAddress ?? '').toBe('');
    expect(row.userAgent ?? '').toBe('');
  }
});

it('requires a genuine live matching after-sales origin before a window override', async () => {
  const who = await authorized(),
    f = await fixture(),
    foreign = await fixture();
  await db.contract.update({
    where: { id: f.oldContractId },
    data: { deviceReceivedAt: new Date(Date.now() - 20 * DAY) },
  });
  const row = await db.afterSalesCase.create({
    data: {
      caseNumber: randomUUID(),
      branchId,
      customerId: f.customerId,
      contractId: foreign.oldContractId,
      productId: f.oldProductId,
      replacementProductId: f.newProductId,
      source: 'INSTALLMENT_CONTRACT',
      outcome: 'SAME_MODEL_EXCHANGE',
      stage: 'AWAITING_APPROVAL',
      symptom: 'Screen',
      warrantySnapshot: { status: 'IN_7DAY_DEFECT' },
      receivedById: who.id,
    },
  });
  const body = { ...dto(f), bypassWindowCheck: true, originAfterSalesCaseId: row.id };
  await http('post', '/defect-exchange/execute', who.id, body).expect(403);
  await db.afterSalesCase.update({
    where: { id: row.id },
    data: { contractId: f.oldContractId, stage: 'CLOSED' },
  });
  await http('post', '/defect-exchange/execute', who.id, body).expect(404);
  await db.afterSalesCase.update({
    where: { id: row.id },
    data: { stage: 'AWAITING_APPROVAL', branchId: branchB },
  });
  await http('post', '/defect-exchange/execute', who.id, body).expect(403);
  await db.afterSalesCase.update({ where: { id: row.id }, data: { branchId } });
  const result = await http('post', '/defect-exchange/execute', who.id, body).expect(201);
  expect(
    await db.auditLog.count({
      where: { action: 'DEFECT_EXCHANGE_WINDOW_BYPASSED', entityId: result.body.newContract.id },
    }),
  ).toBe(1);
});
