import { AuditInterceptor } from '../audit/audit.interceptor';
import { seedStatementReview } from '../contracts/__tests__/credit-approval.fixture';
import { Decimal } from '@prisma/client/runtime/library';
import { PermissionKey } from '@installment/shared';
import { AccessSnapshotService } from './access-snapshot.service';
import { AccessResourceService } from './access-resource.service';
import { AccessTradeInProjectionService } from './access-trade-in-projection.service';
import { AccessExchangeSourceService } from './access-exchange-source.service';
import { currentDomainAccess } from './access-execution-context';
import { ShopAccountResolver } from '../journal/shop-account-resolver.service';
import { ShopInventoryTransferTemplate } from '../journal/cpa-templates/shop-inventory-transfer.template';
import { ExchangeCancelReversalTemplate } from '../journal/cpa-templates/exchange-cancel-reversal.template';
import { ExchangeEclReversalTemplate } from '../journal/cpa-templates/exchange-ecl-reversal.template';
import { ShopExchangeReturnTemplate } from '../journal/cpa-templates/shop-exchange-return.template';
import { ExchangeBuybackReceivable11_2107Template } from '../journal/cpa-templates/exchange-buyback-receivable-11-2107.template';
import { ExchangeCloseOld21_1106Template } from '../journal/cpa-templates/exchange-close-old-21-1106.template';
import { ExchangeNewContract1ATemplate } from '../journal/cpa-templates/exchange-new-contract-1a.template';
import { ContractActivation1ATemplate } from '../journal/cpa-templates/contract-activation-1a.template';
import { JournalAutoService } from '../journal/journal-auto.service';
import { InstallmentInputVatTemplate } from '../journal/cpa-templates/installment-input-vat.template';
import { CompanyResolverService } from '../journal/company-resolver.service';
import { AuditService } from '../audit/audit.service';
import { ExchangeCancelService } from '../contract-exchange/contract-exchange-cancel.service';
import { seedShopCoa } from '../../../prisma/seed-coa-shop';
import { seedFinanceCoa } from '../../../prisma/seed-coa-finance';
import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ContractExchangeService } from '../contract-exchange/contract-exchange.service';
const url = process.env.EMPLOYEE_ACCESS_TEST_DATABASE_URL;
if (
  !url?.includes('/bc_access_task2?host=/tmp/bc-access-direct-exchanges.') ||
  process.env.DATABASE_URL !== url ||
  process.env.DATABASE_URL_FINANCE !== url
)
  throw new Error('Owned isolated database required');
const db = new PrismaClient({ datasources: { db: { url } } });

const prisma = db;
const snapshots = new AccessSnapshotService(db as PrismaService);
const resources = new AccessResourceService(db as PrismaService, snapshots);
const access = new AccessExchangeSourceService(
  resources,
  new AccessTradeInProjectionService(resources),
);
const journal = new JournalAutoService(db as PrismaService);
const companyResolver = new CompanyResolverService(db as PrismaService);
const audit = new AuditService(db as PrismaService);
const act1a = new ContractActivation1ATemplate(journal, db as PrismaService);
const svc = new ContractExchangeService(
  db as PrismaService,
  audit,
  new ExchangeNewContract1ATemplate(journal, db as PrismaService),
  new ExchangeCloseOld21_1106Template(journal, db as PrismaService),
  new ExchangeBuybackReceivable11_2107Template(journal, db as PrismaService),
  new ShopExchangeReturnTemplate(journal, db as PrismaService, companyResolver),
  new ExchangeEclReversalTemplate(journal, db as PrismaService),
  companyResolver,
  new ShopInventoryTransferTemplate(journal, db as PrismaService, companyResolver),
  new ShopAccountResolver(db as PrismaService),
  new InstallmentInputVatTemplate(journal, db as PrismaService, companyResolver),
  access,
);
const cancel = new ExchangeCancelService(
  db as PrismaService,
  audit,
  companyResolver,
  new ExchangeCancelReversalTemplate(journal, db as PrismaService),
  access,
);
let branchId: string,
  branchB: string,
  adminId: string,
  shopCompanyId: string,
  financeCompanyId: string;
async function actor() {
  return db.user.create({
    data: {
      name: 'Test exchange',
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
    data: { code: randomUUID(), name: 'Exchange test', permissions },
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
  'contract-exchanges.create',
  'contract-exchanges.read',
  'contract-exchanges.approve',
  'contract-exchanges.update',
  'contracts.update',
  'products.read',
  'customers.read',
];
async function run<T>(id: string, work: () => Promise<T>) {
  return (
    await resources.execute(id, 'contracts.activate', 'FINANCE', undefined, work, false, {
      isolationLevel: 'Serializable',
      maxAttempts: 3,
    })
  ).result;
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
        name: 'Test journal owner',
        role: 'OWNER',
        accessManaged: true,
      },
    })
  ).id;
  branchId = (await db.branch.create({ data: { name: 'Exchange A', companyId: shopCompanyId } }))
    .id;
  branchB = (await db.branch.create({ data: { name: 'Exchange B', companyId: shopCompanyId } })).id;
}, 120000);
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
async function seedSwapFixture(tag: string, opts: { memo?: boolean } = {}): Promise<SwapFixture> {
  const customer = await prisma.customer.create({
    data: {
      name: `__EXCH_TEST_${tag}__`,
      phone: `0899${tag.padStart(6, '0')}`,
      nationalId: `EXCHTEST-${tag}`,
    },
  });

  const model = opts.memo ? 'MemoModel' : `PricedModel-${tag}`;
  const oldProduct = await prisma.product.create({
    data: {
      name: `Exch Test Old ${tag}`,
      brand: 'ExchTestBrand',
      model,
      storage: '128GB',
      imeiSerial: `EXCHTEST-${tag}-OLD`,
      category: 'PHONE_NEW',
      // 7,500 ≠ buyback 8,000 โดยตั้งใจ (Task 5) — ให้ assertion "cancel restore
      // costPrice" แยกแยะได้จริงระหว่างค่าเดิมกับค่าที่ A.4 เขียนทับ (ถ้าเท่ากัน
      // การ restore ที่พังก็ยัง pass แบบบังเอิญ). ไม่มี golden อื่นอ้างค่านี้:
      // สัญญาเก่า seed ตรงผ่าน prisma (ไม่ผ่าน activation → ไม่มี COGS/S50 JE)
      // และ A.4 รูปใหม่ book ที่ราคารับซื้อ ไม่ใช่ costPrice.
      costPrice: new Decimal('7500.00'),
      installmentPrice: new Decimal('12000.00'),
      branchId,
      status: 'SOLD_INSTALLMENT',
      ownedByCompanyId: financeCompanyId,
    },
  });

  // MEMO mode requires same model AND newPrice === old contract sellingPrice
  const newProduct = await prisma.product.create({
    data: {
      name: `Exch Test New ${tag}`,
      brand: 'ExchTestBrand',
      model: opts.memo ? 'MemoModel' : `PricedModel-${tag}-NEW`,
      storage: '128GB',
      imeiSerial: `EXCHTEST-${tag}-NEW`,
      category: 'PHONE_NEW',
      costPrice: new Decimal(opts.memo ? '8000.00' : '9000.00'),
      installmentPrice: new Decimal(opts.memo ? '12000.00' : '15000.00'),
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

import { Test } from '@nestjs/testing';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ExecutionContext, INestApplication, ValidationPipe, Type } from '@nestjs/common';
import request from 'supertest';
import { AccessPolicyService } from './access-policy';
import { AccessPolicyInterceptor } from './access-policy.interceptor';
import { EmployeeAccessModule } from './employee-access.module';
import { ContractExchangeController } from '../contract-exchange/contract-exchange.controller';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { MODULE_METADATA } from '@nestjs/common/constants';

let app: INestApplication;
const appMarker = randomUUID();
const genericAudit = { log: jest.fn(async () => undefined) };
const staleSnapshots = new Map<string, Awaited<ReturnType<typeof snapshots.forUser>>>();
// Discover the production boundary when installed; baseline has none. No test boundary.
const directBoundary = (
  Reflect.getMetadata(MODULE_METADATA.PROVIDERS, EmployeeAccessModule) as Array<Type<unknown>>
).filter((p) => p.name === 'AccessDirectExchangeBoundaries');
beforeAll(async () => {
  const module = await Test.createTestingModule({
    controllers: [ContractExchangeController],
    providers: [
      ...directBoundary,
      AccessPolicyService,
      { provide: AccessExchangeSourceService, useValue: access },
      { provide: AccessResourceService, useValue: resources },
      { provide: AccessSnapshotService, useValue: snapshots },
      { provide: PrismaService, useValue: db },
      { provide: ContractExchangeService, useValue: svc },
      { provide: ExchangeCancelService, useValue: cancel },
      {
        provide: APP_INTERCEPTOR,
        useValue: new AuditInterceptor(genericAudit as unknown as AuditService),
      },
      { provide: APP_INTERCEPTOR, useClass: AccessPolicyInterceptor },
    ],
  })
    .overrideGuard(JwtAuthGuard)
    .useValue({
      canActivate: async (ctx: ExecutionContext) => {
        const req = ctx.switchToHttp().getRequest();
        const id = req.headers['x-test-user'];
        ctx.switchToHttp().getResponse().setHeader('x-owned-direct-exchange-app', appMarker);
        req.user = {
          ...(await db.user.findUniqueOrThrow({ where: { id } })),
          access: staleSnapshots.get(id) ?? (await snapshots.forUser(id)),
        };
        return true;
      },
    })
    .overrideGuard(RolesGuard)
    .useValue({ canActivate: () => true })
    .compile();
  app = module.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  await app.listen(0, '127.0.0.1');
});
afterAll(async () => {
  await app?.close();
  await db.$disconnect();
});
const base = '/insurance/exchange-requests';
async function authorized(permissions: PermissionKey[] = common, branches = [branchId]) {
  const who = await actor();
  await grant(who.id, permissions, 'SHOP', branches);
  await grant(who.id, permissions, 'FINANCE', branches);
  return who;
}
type Operation = 'submit' | 'preview' | 'pending' | 'recent' | 'approve' | 'reject' | 'cancel';
const operations: Operation[] = [
  'submit',
  'preview',
  'pending',
  'recent',
  'approve',
  'reject',
  'cancel',
];
async function setup(operation: Operation) {
  const f = await seedSwapFixture(randomUUID().slice(0, 8), { memo: true });
  let newContractId: string | undefined;
  if (operation === 'cancel') {
    const old = await db.contract.findUniqueOrThrow({ where: { id: f.oldContractId } });
    newContractId = (
      await db.contract.create({
        data: {
          customerId: f.customerId,
          branchId,
          salespersonId: adminId,
          planType: old.planType,
          sellingPrice: old.sellingPrice,
          downPayment: old.downPayment,
          financedAmount: old.financedAmount,
          interestRate: old.interestRate,
          totalMonths: old.totalMonths,
          interestTotal: old.interestTotal,
          storeCommission: old.storeCommission,
          vatAmount: old.vatAmount,
          monthlyPayment: old.monthlyPayment,
          contractNumber: randomUUID(),
          productId: f.newProductId,
          status: 'DRAFT',
          exchangedFromContractId: f.oldContractId,
        },
      })
    ).id;
    await db.product.update({ where: { id: f.newProductId }, data: { status: 'RESERVED' } });
  }
  const row = await db.contractExchangeRequest.create({
    data: {
      oldContractId: f.oldContractId,
      oldProductId: f.oldProductId,
      newProductId: f.newProductId,
      requestedById: adminId,
      newContractId,
      mode: operation === 'cancel' ? 'PRICED' : 'MEMO',
      status: ['recent', 'cancel'].includes(operation) ? 'APPROVED' : 'PENDING',
      conditionNote: 'PRIVATE NOTE',
      conditionPhotos: ['private/key'],
    },
  });
  return { ...f, row };
}
function invoke(operation: Operation, id: string, f: Awaited<ReturnType<typeof setup>>) {
  const client = request(app.getHttpServer());
  const req =
    operation === 'preview'
      ? client
          .get(base + '/preview')
          .query({ oldContractId: f.oldContractId, newProductId: f.newProductId })
      : operation === 'pending' || operation === 'recent'
        ? client.get(base + '/' + operation)
        : operation === 'submit'
          ? client.post(base).send({
              oldContractId: f.oldContractId,
              oldProductId: f.oldProductId,
              newProductId: f.newProductId,
              conditionNote: 'Screen replacement',
            })
          : client.post(base + '/' + f.row.id + '/' + operation).send({
              reason: 'Customer changed decision',
              memoAddendumSigned: true,
              memoMdmSwapped: true,
            });
  return req.set('x-test-user', id).set('x-company-scope', 'SHOP');
}
function marked(response: request.Response) {
  expect(response.headers['x-owned-direct-exchange-app']).toBe(appMarker);
}
it.each(operations)('authorized %s has a useful finite real HTTP success', async (operation) => {
  const who = await authorized();
  const f = await setup(operation);
  const response = await invoke(operation, who.id, f);
  marked(response);
  expect(response.status).toBe(['preview', 'pending', 'recent'].includes(operation) ? 200 : 201);
  if (operation === 'preview')
    expect(response.body).toMatchObject({
      mode: 'MEMO',
      ncv: '0.00',
      blockers: { overdueBlocked: false, advanceBlocked: false },
    });
  else if (operation === 'pending' || operation === 'recent') {
    const row = response.body.find((r: { id: string }) => r.id === f.row.id);
    expect(row).toMatchObject({
      id: f.row.id,
      mode: 'MEMO',
      status: operation === 'recent' ? 'APPROVED' : 'PENDING',
    });
    expect(row).not.toHaveProperty('conditionPhotos');
    expect(row).not.toHaveProperty('conditionNote');
    expect(row).not.toHaveProperty('requestedBy');
    expect(row.oldContract).toBeNull(); // No independent contracts.read permission.
  } else {
    expect(response.body.id).toEqual(expect.any(String));
    expect(response.body).not.toHaveProperty('conditionPhotos');
    expect(response.body).not.toHaveProperty('conditionNote');
    const actual = await db.contractExchangeRequest.findUniqueOrThrow({
      where: { id: response.body.id },
    });
    expect(actual.status).toBe(
      operation === 'approve'
        ? 'APPROVED'
        : operation === 'reject'
          ? 'REJECTED'
          : operation === 'cancel'
            ? 'CANCELED'
            : 'PENDING',
    );
  }
});
it.each(operations)(
  '%s denies no grants and filters foreign original sources',
  async (operation) => {
    const f = await setup(operation);
    const no = await actor();
    const denied = await invoke(operation, no.id, f);
    marked(denied);
    expect(denied.status).toBe(403);
    const foreign = await authorized(common, [branchB]);
    const result = await invoke(operation, foreign.id, f);
    marked(result);
    if (operation === 'pending' || operation === 'recent') {
      expect(result.status).toBe(200);
      expect(result.body).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ id: f.row.id })]),
      );
    } else expect(result.status).toBe(403);
  },
);
it.each(operations)(
  '%s rechecks revoked current grants despite an admitted stale snapshot',
  async (operation) => {
    const who = await authorized();
    const f = await setup(operation);
    staleSnapshots.set(who.id, await snapshots.forUser(who.id));
    await db.employeeAccessAssignment.updateMany({
      where: { userId: who.id },
      data: { deletedAt: new Date() },
    });
    const response = await invoke(operation, who.id, f);
    marked(response);
    expect(response.status).toBe(403);
  },
);
it.each(operations)(
  '%s never flattens action A with product-read B into action B',
  async (operation) => {
    const who = await authorized();
    const f = await setup(operation);
    await db.product.update({ where: { id: f.newProductId }, data: { branchId: branchB } });
    await grant(who.id, ['products.read'], 'SHOP', [branchB]);
    const response = await invoke(operation, who.id, f);
    marked(response);
    if (operation === 'pending' || operation === 'recent') {
      expect(response.status).toBe(200);
      expect(response.body).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ id: f.row.id })]),
      );
    } else expect(response.status).toBe(403);
  },
);
it.each(operations)(
  '%s stays in selected SHOP while retaining independent FINANCE sources',
  async (operation) => {
    const who = await authorized(),
      f = await setup(operation);
    const response = await invoke(operation, who.id, f).set('x-company-scope', 'FINANCE');
    marked(response);
    expect(response.status).toBe(403);
  },
);
it.each(['deleted', 'merged', 'assignment'] as const)(
  'rejects current %s Customer even with parent action authority',
  async (kind) => {
    const permissions = common.filter((p) => p !== 'customers.read');
    const who = await authorized(permissions),
      f = await setup('approve');
    const pos = await db.accessPosition.create({
      data: { code: randomUUID(), name: 'Customer assigned', permissions: ['customers.read'] },
    });
    await db.employeeAccessAssignment.create({
      data: {
        userId: who.id,
        positionId: pos.id,
        companyCode: 'SHOP',
        scope: 'ASSIGNED',
        branches: { create: { branchId } },
      },
    });
    await db.customer.update({ where: { id: f.customerId }, data: { assignedToId: who.id } });
    expect((await invoke('preview', who.id, f)).status).toBe(200);
    const other = await db.customer.create({
      data: { name: 'other', phone: '0800000000', nationalId: randomUUID() },
    });
    await db.customer.update({
      where: { id: f.customerId },
      data:
        kind === 'deleted'
          ? { deletedAt: new Date() }
          : kind === 'merged'
            ? { mergedIntoId: other.id }
            : { assignedToId: null },
    });
    expect((await invoke('approve', who.id, f)).status).toBe(403);
    expect(
      (await db.contractExchangeRequest.findUniqueOrThrow({ where: { id: f.row.id } })).status,
    ).toBe('PENDING');
  },
);
async function observeWait(tx: Prisma.TransactionClient, pid: number) {
  for (let i = 0; i < 200; i++) {
    await tx.$executeRaw`SELECT pg_stat_clear_snapshot()`;
    const [row] = await tx.$queryRaw<
      { waiting: boolean }[]
    >`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND ${pid}=ANY(pg_blocking_pids(pid))) AS waiting`;
    if (row.waiting) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('No observed PostgreSQL lock wait');
}
it.each(['customer', 'product', 'contract', 'request'] as const)(
  'rechecks actual %s source after a database lock wait',
  async (kind) => {
    const who = await authorized(),
      f = await setup('approve');
    let response: Promise<request.Response> | undefined;
    await db.$transaction(async (tx) => {
      const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      if (kind === 'customer')
        await tx.$queryRaw`SELECT id FROM customers WHERE id=${f.customerId} FOR UPDATE`;
      if (kind === 'product')
        await tx.$queryRaw`SELECT id FROM products WHERE id=${f.newProductId} FOR UPDATE`;
      if (kind === 'contract')
        await tx.$queryRaw`SELECT id FROM contracts WHERE id=${f.oldContractId} FOR UPDATE`;
      if (kind === 'request')
        await tx.$queryRaw`SELECT id FROM contract_exchange_requests WHERE id=${f.row.id} FOR UPDATE`;
      response = invoke('approve', who.id, f).then((res) => res);
      await observeWait(tx, pid);
      if (kind === 'customer')
        await tx.customer.update({ where: { id: f.customerId }, data: { deletedAt: new Date() } });
      if (kind === 'product')
        await tx.product.update({ where: { id: f.newProductId }, data: { branchId: branchB } });
      if (kind === 'contract')
        await tx.contract.update({ where: { id: f.oldContractId }, data: { branchId: branchB } });
      if (kind === 'request')
        await tx.contractExchangeRequest.update({
          where: { id: f.row.id },
          data: { status: 'REJECTED' },
        });
    });
    const result = await response!;
    marked(result);
    expect(result.status).toBe(kind === 'request' ? 409 : 403);
    expect(
      (await db.contract.findUniqueOrThrow({ where: { id: f.oldContractId } })).productId,
    ).toBe(f.oldProductId);
  },
);
it('mutation without independent exchange read returns only id/status and durable structural submit audit', async () => {
  const who = await authorized(common.filter((p) => p !== 'contract-exchanges.read')),
    f = await setup('submit');
  const result = await invoke('submit', who.id, f);
  expect(result.status).toBe(201);
  expect(result.body).toEqual({ id: expect.any(String), status: 'PENDING' });
  const log = await db.auditLog.findFirstOrThrow({
    where: { entityId: result.body.id, action: 'EXCHANGE_REQUESTED' },
  });
  expect(log.userId).toBe(who.id);
  expect(log.newValue).toEqual({
    mode: 'MEMO',
    status: 'PENDING',
    oldContractId: f.oldContractId,
    oldProductId: f.oldProductId,
    newProductId: f.newProductId,
  });
});
it('finite reads gate Contract status and product cost independently without nested records or documents', async () => {
  const who = await authorized(),
    f = await setup('pending');
  await grant(who.id, ['contracts.read'], 'FINANCE');
  await grant(who.id, ['sensitive.cost.read'], 'SHOP');
  const response = await invoke('pending', who.id, f);
  expect(response.status).toBe(200);
  const row = response.body.find((r: { id: string }) => r.id === f.row.id);
  expect(row.oldContract).toMatchObject({ id: f.oldContractId, status: null, totalMonths: 12 });
  expect(row.customer).toEqual({ id: f.customerId, name: expect.any(String) });
  expect(row.oldProduct.costPrice).toBeNull();
  expect(row.newProduct.costPrice).toBe('8000');
  expect(Object.keys(row).sort()).toEqual(
    [
      'id',
      'status',
      'mode',
      'createdAt',
      'approvedAt',
      'approvalTier',
      'oldContract',
      'newContract',
      'customer',
      'oldProduct',
      'newProduct',
      'financial',
    ].sort(),
  );
  await grant(who.id, ['payments.read'], 'FINANCE');
  expect(
    (await invoke('pending', who.id, f)).body.find((r: { id: string }) => r.id === f.row.id)
      .oldContract.status,
  ).toBe('ACTIVE');
});
it.each(['12junk', '0', '49', '1.2', '-1', 'Infinity'])(
  'preview rejects malformed months %s before monetary calculation',
  async (value) => {
    const who = await authorized(),
      f = await setup('preview');
    const response = await invoke('preview', who.id, f).query({ newTotalMonths: value });
    marked(response);
    expect(response.status).toBe(400);
  },
);
it('direct photos have no private producer and reject without persisting a request', async () => {
  const who = await authorized(),
    f = await setup('submit'),
    before = await db.contractExchangeRequest.count();
  const response = await invoke('submit', who.id, f).send({
    conditionPhotos: ['private/secret-token'],
  });
  marked(response);
  expect(response.status).toBe(400);
  expect(JSON.stringify(response.body)).not.toContain('secret-token');
  expect(await db.contractExchangeRequest.count()).toBe(before);
});
async function priced() {
  const f = await seedSwapFixture(randomUUID().slice(0, 8));
  await act1a.execute(f.oldContractId);
  const old = await db.product.findUniqueOrThrow({ where: { id: f.oldProductId } });
  await db.tradeInValuation.create({
    data: {
      brand: old.brand,
      model: old.model,
      storage: old.storage!,
      condition: 'A',
      basePrice: 11000,
    },
  });
  await seedStatementReview(db, f.customerId);
  return { ...f, buybackPrice: '11000', deviceCondition: 'A', newTotalMonths: 12 };
}
function submitPriced(id: string, f: Awaited<ReturnType<typeof priced>>) {
  return request(app.getHttpServer())
    .post(base)
    .set('x-test-user', id)
    .set('x-company-scope', 'SHOP')
    .send(f);
}
it('create-only AUTO stays pending; real independent approval creates exact draft terms and no journals', async () => {
  const who = await authorized(common.filter((p) => p !== 'contract-exchanges.approve')),
    f = await priced(),
    before = await db.journalEntry.count();
  const submitted = await submitPriced(who.id, f);
  marked(submitted);
  expect(submitted.status).toBe(201);
  expect(submitted.body.status).toBe('PENDING');
  const persisted = await db.contractExchangeRequest.findUniqueOrThrow({
    where: { id: submitted.body.id },
  });
  expect(persisted.approvalTier).toBe('AUTO');
  expect(persisted.newContractId).toBeNull();
  const approver = await authorized();
  const approved = await invoke('approve', approver.id, { ...f, row: persisted });
  expect(approved.status).toBe(201);
  const updated = await db.contractExchangeRequest.findUniqueOrThrow({
    where: { id: persisted.id },
  });
  const draft = await db.contract.findUniqueOrThrow({ where: { id: updated.newContractId! } });
  expect([
    draft.status,
    draft.financedAmount.toFixed(2),
    draft.monthlyPayment.toFixed(2),
    draft.interestTotal.toFixed(2),
    draft.vatAmount!.toFixed(2),
  ]).toEqual(['DRAFT', '15000.00', '2273.75', '9000.00', '1785.00']);
  expect(await db.journalEntry.count()).toBe(before);
  expect((await invoke('cancel', who.id, { ...f, row: updated })).status).toBe(201);
  expect(await db.journalEntry.count()).toBe(before);
  expect(
    (await db.contract.findUniqueOrThrow({ where: { id: draft.id } })).deletedAt,
  ).not.toBeNull();
});
it('preview NCV is financial workflow data; valuation cost follows original Product only and profit remains separate', async () => {
  const who = await authorized(),
    f = await priced();
  const preview = () =>
    request(app.getHttpServer())
      .get(base + '/preview')
      .set('x-test-user', who.id)
      .set('x-company-scope', 'SHOP')
      .query(f);
  const before = await preview();
  expect(before.status).toBe(200);
  expect(before.body).toMatchObject({
    ncv: '11000.00',
    basePrice: null,
    marketMin: null,
    expectedPl: null,
  });
  await grant(who.id, ['sensitive.cost.read'], 'FINANCE');
  const after = await preview();
  expect(after.status).toBe(200);
  expect(after.body).toMatchObject({
    ncv: '11000.00',
    basePrice: '11000.00',
    marketMin: '9350.00',
    marketCheckPct: 15,
    expectedPl: null,
  });
  await grant(who.id, ['sensitive.profit.read'], 'SHOP');
  await grant(who.id, ['sensitive.profit.read'], 'FINANCE');
  expect((await preview()).body.expectedPl).toBe('-1190.00');
});
it.each(['submit', 'approve', 'reject', 'cancel'] as const)(
  '%s required audit failure rolls back real canonical state',
  async (operation) => {
    const who = await authorized(),
      f = await setup(operation);
    const before = {
      requests: await db.contractExchangeRequest.count(),
      journals: await db.journalEntry.count(),
      audits: await db.auditLog.count(),
      contract: await db.contract.findUniqueOrThrow({ where: { id: f.oldContractId } }),
      product: await db.product.findUniqueOrThrow({ where: { id: f.newProductId } }),
    };
    const failure = jest
      .spyOn(audit, 'log')
      .mockRejectedValueOnce(new Error('required audit failure'));
    try {
      expect((await invoke(operation, who.id, f)).status).toBe(500);
    } finally {
      failure.mockRestore();
    }
    expect(await db.contractExchangeRequest.count()).toBe(before.requests);
    expect(await db.journalEntry.count()).toBe(before.journals);
    expect(await db.auditLog.count()).toBe(before.audits);
    expect(await db.contract.findUniqueOrThrow({ where: { id: f.oldContractId } })).toEqual(
      before.contract,
    );
    expect(await db.product.findUniqueOrThrow({ where: { id: f.newProductId } })).toEqual(
      before.product,
    );
    expect(
      (await db.contractExchangeRequest.findUniqueOrThrow({ where: { id: f.row.id } })).status,
    ).toBe(f.row.status);
  },
);
it('AUTO approval rolls back creation and draft if its required request audit fails', async () => {
  const who = await authorized(),
    f = await priced(),
    before = await db.contract.count();
  const failure = jest
    .spyOn(audit, 'log')
    .mockRejectedValueOnce(new Error('required request audit failure'));
  try {
    expect((await submitPriced(who.id, f)).status).toBe(500);
  } finally {
    failure.mockRestore();
  }
  expect(await db.contract.count()).toBe(before);
  expect(
    await db.contractExchangeRequest.count({ where: { oldContractId: f.oldContractId } }),
  ).toBe(0);
  expect((await db.product.findUniqueOrThrow({ where: { id: f.newProductId } })).status).toBe(
    'IN_STOCK',
  );
});
it('concurrent MEMO approvals commit once, then only current protected owner can reverse the applied swap', async () => {
  const who = await authorized(),
    f = await setup('approve'),
    before = await db.journalEntry.count();
  const responses = await Promise.all([invoke('approve', who.id, f), invoke('approve', who.id, f)]);
  expect(responses.filter((r) => r.status === 201)).toHaveLength(1);
  expect(
    await db.auditLog.count({ where: { entityId: f.row.id, action: 'EXCHANGE_MEMO_APPLIED' } }),
  ).toBe(1);
  expect((await invoke('cancel', who.id, f)).status).toBe(403);
  expect((await invoke('cancel', adminId, f)).status).toBe(201);
  expect((await db.contract.findUniqueOrThrow({ where: { id: f.oldContractId } })).productId).toBe(
    f.oldProductId,
  );
  expect(await db.journalEntry.count()).toBe(before);
});
async function finalizedPriced() {
  const f = await priced();
  const result = await submitPriced(adminId, f);
  expect(result.status).toBe(201);
  const row = await db.contractExchangeRequest.findUniqueOrThrow({ where: { id: result.body.id } });
  await run(adminId, async () => {
    const tx = currentDomainAccess()!.client;
    const next = await tx.contract.findUniqueOrThrow({
      where: { id: row.newContractId! },
      include: { product: true },
    });
    // The direct caller has no activation route. This finite cancel fixture calls
    // the real exact-client finalizer; actual activation+positive ECL is separately
    // exercised by access-contract-activation.integration.spec.ts.
    const proof = await svc.prepareActivation(next.id, tx);
    await tx.contract.update({ where: { id: next.id }, data: { status: 'ACTIVE' } });
    await tx.product.update({
      where: { id: next.productId },
      data: { status: 'SOLD_INSTALLMENT', ownedByCompanyId: financeCompanyId },
    });
    await svc.finalizeAfterActivation(
      {
        ...next,
        exchangedFromContractId: next.exchangedFromContractId!,
        productCategory: next.product.category,
        productCostPrice: next.product.costPrice,
      },
      tx,
      { id: adminId },
      proof,
    );
  });
  return {
    ...f,
    row: await db.contractExchangeRequest.findUniqueOrThrow({ where: { id: row.id } }),
  };
}
import * as periodLock from '../../utils/period-lock.util';
it('finalized PRICED cancellation checks and posts one actual date/client across both books, preserving grace and exact mirrors once', async () => {
  const f = await finalizedPriced();
  const now = new Date(),
    year = now.getFullYear(),
    month = now.getMonth() + 1;
  for (const companyId of [shopCompanyId, financeCompanyId])
    await db.accountingPeriod.upsert({
      where: { companyId_year_month: { companyId, year, month } },
      create: { companyId, year, month, status: 'CLOSED' },
      update: { status: 'CLOSED' },
    });
  const calls: Array<{ client: object | undefined; date: Date | undefined; company?: string }> = [];
  const original = journal.createAndPost.bind(journal);
  const write = jest.spyOn(journal, 'createAndPost').mockImplementation(async (input, tx) => {
    calls.push({ client: tx, date: input.postedAt, company: input.companyId });
    return original(input, tx);
  });
  const check = jest.spyOn(periodLock, 'validatePeriodOpen');
  const before = await db.journalEntry.count();
  try {
    const response = await invoke('cancel', adminId, f);
    marked(response);
    expect(response.status).toBe(201);
    expect(check).toHaveBeenCalledTimes(2);
    expect(new Set(check.mock.calls.map((c) => c[2]))).toEqual(
      new Set([shopCompanyId, financeCompanyId]),
    );
    expect(calls).toHaveLength(6);
    for (const call of calls) {
      expect(call.client).toBe(check.mock.calls[0][0]);
      expect(call.date).toBe(check.mock.calls[0][1]);
      expect(call.date!.getTime()).toBeGreaterThanOrEqual(now.getTime());
    }
  } finally {
    write.mockRestore();
    check.mockRestore();
    for (const companyId of [shopCompanyId, financeCompanyId])
      await db.accountingPeriod.update({
        where: { companyId_year_month: { companyId, year, month } },
        data: { status: 'OPEN' },
      });
  }
  const reversals = await db.journalEntry.findMany({
    where: { metadata: { path: ['flow'], equals: 'exchange-cancel' } },
    include: { lines: true },
  });
  const ours = reversals.filter((r) =>
    calls.some((c) => c.date?.getTime() === r.postedAt?.getTime()),
  );
  expect(ours).toHaveLength(6);
  for (const reversal of ours) {
    const meta = reversal.metadata as { originalEntryId: string };
    const originalEntry = await db.journalEntry.findUniqueOrThrow({
      where: { id: meta.originalEntryId },
      include: { lines: true },
    });
    expect(reversal.companyId).toBe(originalEntry.companyId);
    expect(
      reversal.lines.map((l) => [l.accountCode, l.debit.toFixed(2), l.credit.toFixed(2)]).sort(),
    ).toEqual(
      originalEntry.lines
        .map((l) => [l.accountCode, l.credit.toFixed(2), l.debit.toFixed(2)])
        .sort(),
    );
  }
  expect(await db.journalEntry.count()).toBe(before + 6);
  expect(
    (await db.product.findUniqueOrThrow({ where: { id: f.oldProductId } })).costPrice.toFixed(2),
  ).toBe('7500.00');
  expect((await invoke('cancel', adminId, f)).status).toBe(400);
  expect(await db.journalEntry.count()).toBe(before + 6);
});
it('finalized reversal rolls back actual money, ownership, request links and audit on required audit failure', async () => {
  const f = await finalizedPriced();
  const before = {
    journals: await db.journalEntry.count(),
    audits: await db.auditLog.count(),
    old: await db.contract.findUniqueOrThrow({ where: { id: f.oldContractId } }),
    next: await db.contract.findUniqueOrThrow({ where: { id: f.row.newContractId! } }),
    product: await db.product.findUniqueOrThrow({ where: { id: f.oldProductId } }),
  };
  const failure = jest
    .spyOn(audit, 'log')
    .mockRejectedValueOnce(new Error('required reversal audit failure'));
  try {
    expect((await invoke('cancel', adminId, f)).status).toBe(500);
  } finally {
    failure.mockRestore();
  }
  expect(await db.journalEntry.count()).toBe(before.journals);
  expect(await db.auditLog.count()).toBe(before.audits);
  expect(await db.contract.findUniqueOrThrow({ where: { id: f.oldContractId } })).toEqual(
    before.old,
  );
  expect(await db.contract.findUniqueOrThrow({ where: { id: f.row.newContractId! } })).toEqual(
    before.next,
  );
  expect(await db.product.findUniqueOrThrow({ where: { id: f.oldProductId } })).toEqual(
    before.product,
  );
  expect(await db.contractExchangeRequest.findUniqueOrThrow({ where: { id: f.row.id } })).toEqual(
    f.row,
  );
  const responses = await Promise.all([invoke('cancel', adminId, f), invoke('cancel', adminId, f)]);
  expect(responses.filter((r) => r.status === 201)).toHaveLength(1);
  expect(await db.journalEntry.count()).toBe(before.journals + 6);
});
it('finalized cancellation refuses unexplained third-book journal contributors before any reversal', async () => {
  const f = await finalizedPriced();
  const third = await db.companyInfo.create({
    data: {
      companyCode: 'FOREIGN-' + randomUUID(),
      nameTh: 'Foreign fixture',
      nameEn: 'Foreign fixture',
      taxId: randomUUID(),
      address: 'Owned fixture',
      directorName: 'Fixture',
    },
  });
  await db.journalEntry.update({ where: { id: f.row.je3Id! }, data: { companyId: third.id } });
  const before = await db.journalEntry.count();
  const response = await invoke('cancel', adminId, f);
  expect(response.status).toBe(403);
  expect(await db.journalEntry.count()).toBe(before);
});
it('error projection hides financial statuses and supplied private notes from action-only caller', async () => {
  const who = await authorized(common.filter((p) => p !== 'contract-exchanges.read')),
    f = await setup('submit');
  await db.contract.update({ where: { id: f.oldContractId }, data: { status: 'OVERDUE' } });
  const response = await invoke('submit', who.id, f).send({ conditionNote: 'PRIVATE_SECRET_NOTE' });
  expect(response.status).toBe(400);
  expect(response.body).toEqual({
    statusCode: 400,
    message: 'ไม่สามารถดำเนินการตามสถานะหรือเงื่อนไขปัจจุบัน',
  });
});
it('recent filters independently foreign sources before the authorized hundred-row limit', async () => {
  const who = await authorized(),
    visible = await setup('recent'),
    foreign = await setup('recent');
  await db.contract.update({ where: { id: foreign.oldContractId }, data: { branchId: branchB } });
  const date = new Date(Date.now() + 10000);
  await db.contractExchangeRequest.createMany({
    data: Array.from({ length: 105 }, () => ({
      oldContractId: foreign.oldContractId,
      oldProductId: foreign.oldProductId,
      newProductId: foreign.newProductId,
      requestedById: adminId,
      mode: 'MEMO' as const,
      status: 'APPROVED' as const,
      updatedAt: date,
    })),
  });
  const response = await invoke('recent', who.id, visible);
  expect(response.status).toBe(200);
  expect(response.body).toEqual(
    expect.arrayContaining([expect.objectContaining({ id: visible.row.id })]),
  );
  expect(response.body).not.toEqual(
    expect.arrayContaining([expect.objectContaining({ id: foreign.row.id })]),
  );
});
it('generic request audit uses only safe route/outcome metadata on success and rejection', async () => {
  const who = await authorized(),
    f = await setup('submit');
  genericAudit.log.mockClear();
  expect((await invoke('submit', who.id, f)).status).toBe(201);
  expect(
    (await invoke('submit', who.id, f).send({ conditionPhotos: ['private/token'] })).status,
  ).toBe(400);
  expect(genericAudit.log).toHaveBeenCalledTimes(2);
  for (const call of genericAudit.log.mock.calls) {
    const entry = (
      call as unknown as [
        { newValue: Record<string, unknown>; ipAddress?: string; userAgent?: string },
      ]
    )[0];
    expect(Object.keys(entry.newValue).sort()).toEqual(
      ['route', 'outcome', 'statusCode', 'duration'].sort(),
    );
    expect(entry.newValue.route).toBe('ContractExchangeController.submit');
    expect(entry.ipAddress).toBeUndefined();
    expect(entry.userAgent).toBeUndefined();
    expect(JSON.stringify(entry)).not.toContain('private/token');
  }
});
it('asymmetric replacement destination needs its own FINANCE tuple and then succeeds', async () => {
  const who = await authorized(),
    f = await setup('approve');
  await db.product.update({ where: { id: f.newProductId }, data: { branchId: branchB } });
  await grant(who.id, common, 'SHOP', [branchB]);
  expect((await invoke('approve', who.id, f)).status).toBe(403);
  await grant(who.id, common, 'FINANCE', [branchB]);
  expect((await invoke('approve', who.id, f)).status).toBe(201);
  expect(
    (await db.product.findUniqueOrThrow({ where: { id: f.newProductId } })).ownedByCompanyId,
  ).toBe(financeCompanyId);
});
it.each([
  'oldContractId',
  'newProductId',
  'buybackPrice',
  'deviceCondition',
  'newInterestRate',
] as const)(
  'preview validates %s rather than reaching an uncontrolled calculation error',
  async (field) => {
    const who = await authorized(),
      f = await setup('preview');
    expect((await invoke('preview', who.id, f).query({ [field]: 'not-valid' })).status).toBe(400);
  },
);
it('current period versions are rechecked after an observed lock wait and current-month grace remains usable', async () => {
  const f = await finalizedPriced(),
    now = new Date(),
    year = now.getFullYear(),
    month = now.getMonth() + 1;
  const period = await db.accountingPeriod.upsert({
    where: { companyId_year_month: { companyId: financeCompanyId, year, month } },
    create: { companyId: financeCompanyId, year, month, status: 'OPEN' },
    update: { status: 'OPEN' },
  });
  let response: Promise<request.Response> | undefined;
  await db.$transaction(async (tx) => {
    const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
    await tx.$queryRaw`SELECT id FROM accounting_periods WHERE id=${period.id} FOR UPDATE`;
    response = invoke('cancel', adminId, f).then((res) => res);
    await observeWait(tx, pid);
    await tx.accountingPeriod.update({ where: { id: period.id }, data: { status: 'SYNCED' } });
  });
  expect((await response!).status).toBe(201);
  expect((await db.accountingPeriod.findUniqueOrThrow({ where: { id: period.id } })).status).toBe(
    'SYNCED',
  );
  await db.accountingPeriod.update({ where: { id: period.id }, data: { status: 'OPEN' } });
});

it.each(['customer', 'product', 'backlink', 'old-product'] as const)(
  'R128 cancel rejects independently authorized but unrelated %s identity before any state effects',
  async (kind) => {
    const who = await authorized(),
      f = await setup('cancel'),
      other = await setup('cancel');
    if (kind === 'customer')
      await db.contract.update({
        where: { id: f.row.newContractId! },
        data: { customerId: other.customerId },
      });
    if (kind === 'product')
      await db.contract.update({
        where: { id: f.row.newContractId! },
        data: { productId: other.newProductId },
      });
    if (kind === 'backlink')
      await db.contract.update({
        where: { id: f.row.newContractId! },
        data: { exchangedFromContractId: null },
      });
    if (kind === 'old-product')
      await db.contract.update({
        where: { id: f.oldContractId },
        data: { productId: other.oldProductId },
      });
    const before = {
      journals: await db.journalEntry.count(),
      audits: await db.auditLog.count(),
      next: await db.contract.findUniqueOrThrow({ where: { id: f.row.newContractId! } }),
      product: await db.product.findUniqueOrThrow({ where: { id: f.newProductId } }),
    };
    const response = await invoke('cancel', who.id, f);
    marked(response);
    expect(response.status).toBe(403);
    expect(await db.journalEntry.count()).toBe(before.journals);
    expect(await db.auditLog.count()).toBe(before.audits);
    expect(await db.contract.findUniqueOrThrow({ where: { id: f.row.newContractId! } })).toEqual(
      before.next,
    );
    expect(await db.product.findUniqueOrThrow({ where: { id: f.newProductId } })).toEqual(
      before.product,
    );
    expect(
      (await db.contractExchangeRequest.findUniqueOrThrow({ where: { id: f.row.id } })).status,
    ).toBe('APPROVED');
  },
);
it('R128 finalized cancellation rejects a substituted current Customer and preserves all books', async () => {
  const f = await finalizedPriced(),
    other = await setup('submit');
  await db.contract.update({
    where: { id: f.row.newContractId! },
    data: { customerId: other.customerId },
  });
  const before = await db.journalEntry.count();
  expect((await invoke('cancel', adminId, f)).status).toBe(403);
  expect(await db.journalEntry.count()).toBe(before);
  expect((await db.contract.findUniqueOrThrow({ where: { id: f.oldContractId } })).status).toBe(
    'EXCHANGED',
  );
});
