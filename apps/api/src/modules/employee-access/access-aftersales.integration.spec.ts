import { AccessAfterSalesBoundaries } from './access-after-sales-boundaries';
import { AccessAfterSalesSourceService } from './access-after-sales-source.service';
import { AccessAfterSalesProjectionService } from './access-after-sales-projection.service';
import { AccessAfterSalesQueryService } from './access-after-sales-query.service';
import { AccessRepairProjectionService } from './access-repair-projection.service';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
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
import { AccessRepairSourceService } from './access-repair-source.service';
import { AccessTradeInProjectionService } from './access-trade-in-projection.service';
import { AccessProcurementSourceService } from './access-procurement-source.service';
import { AccessExchangeSourceService } from './access-exchange-source.service';
import { AfterSalesController } from '../after-sales/after-sales.controller';
import { AfterSalesService } from '../after-sales/after-sales.service';
import { AfterSalesQueryService } from '../after-sales/services/after-sales-query.service';
import { AfterSalesLookupService } from '../after-sales/services/after-sales-lookup.service';
import { AfterSalesExchangeService } from '../after-sales/services/after-sales-exchange.service';
import { AfterSalesDocumentService } from '../after-sales/services/after-sales-document.service';
import { RepairTicketsService } from '../repair-tickets/repair-tickets.service';
import { ContractExchangeService } from '../contract-exchange/contract-exchange.service';
import { DefectExchangeService } from '../defect-exchange/defect-exchange.service';
import { ProductPhotosService } from '../quality-control/product-photos.service';
import { AuditService } from '../audit/audit.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BranchGuard } from '../auth/guards/branch.guard';
const url = process.env.EMPLOYEE_ACCESS_TEST_DATABASE_URL;
if (
  !url?.includes('/bc_access_task2?host=/tmp/bc-access-aftersales.') ||
  process.env.DATABASE_URL !== url ||
  process.env.DATABASE_URL_FINANCE !== url
)
  throw new Error('Owned isolated database and both URL overrides required');
const db = new PrismaClient({ datasources: { db: { url } } });
const snapshots = new AccessSnapshotService(db as PrismaService);
const resources = new AccessResourceService(db as PrismaService, snapshots);
const parties = new AccessTradeInProjectionService(resources);
const repairSources = new AccessRepairSourceService(
  resources,
  parties,
  new AccessProcurementSourceService(resources),
);
const exchangeSources = new AccessExchangeSourceService(resources, parties);
const audit = new AuditService(db as PrismaService);
// Unused mutation dependencies are inert; every service exercised by these reads is real.
const repair = new RepairTicketsService(
  db as PrismaService,
  audit,
  {} as never,
  {} as never,
  {} as never,
  {} as never,
  repairSources,
);
const defect = new DefectExchangeService(
  db as PrismaService,
  {} as never,
  {} as never,
  repair,
  exchangeSources,
);
const exchange = new ContractExchangeService(
  db as PrismaService,
  audit,
  {} as never,
  {} as never,
  {} as never,
  {} as never,
  {} as never,
  {} as never,
  {} as never,
  {} as never,
  {} as never,
  exchangeSources,
);
const afterSources = new AccessAfterSalesSourceService(resources, repairSources, exchangeSources);
const afterProjection = new AccessAfterSalesProjectionService(
  afterSources,
  new AccessRepairProjectionService(resources, repairSources),
);
const afterQuery = new AccessAfterSalesQueryService(afterSources, afterProjection);
const query = new AfterSalesQueryService(db as PrismaService);
const lookup = new AfterSalesLookupService(
  db as PrismaService,
  repair,
  defect,
  new ProductPhotosService(db as PrismaService),
  afterProjection,
  exchangeSources,
  resources,
);
const exchangeProxy = new AfterSalesExchangeService(
  db as PrismaService,
  query,
  defect,
  repair,
  audit,
  exchange,
  {} as never,
  lookup,
  {} as never,
);
const facade = new AfterSalesService(lookup, {} as never, query, {} as never, exchangeProxy);
let app: INestApplication,
  actor: string,
  denied: string,
  branchA: string,
  branchB: string,
  shop: string,
  finance: string;
async function user() {
  return (
    await db.user.create({
      data: {
        email: randomUUID() + '@test.invalid',
        name: 'Reader',
        password: 'unused',
        role: 'ACCOUNTANT',
        accessManaged: true,
      },
    })
  ).id;
}
async function grant(
  id: string,
  permissions: PermissionKey[],
  companyCode: 'SHOP' | 'FINANCE' = 'SHOP',
  branchIds = [branchA],
) {
  const position = await db.accessPosition.create({
    data: { code: randomUUID(), name: 'Reader', permissions },
  });
  return db.employeeAccessAssignment.create({
    data: {
      userId: id,
      positionId: position.id,
      companyCode,
      scope: 'BRANCHES',
      branches: { create: branchIds.map((branchId) => ({ branchId })) },
    },
  });
}
function http(path: string, id = actor) {
  return request(app.getHttpServer()).get(path).set('x-test-user', id);
}
async function fixture(branchId = branchA) {
  const id = randomUUID();
  const customer = await db.customer.create({
    data: {
      name: 'Visible ' + id,
      phone: '0800000000',
      nationalId: id,
      lineIdShop: 'SECRET-LINE-' + id,
    },
  });
  const product = await db.product.create({
    data: {
      name: 'Device',
      brand: 'Test',
      model: 'Model',
      imeiSerial: id.slice(0, 15),
      category: 'PHONE_USED',
      costPrice: 9347.25,
      branchId,
      ownedByCompanyId: finance,
      status: 'SOLD_INSTALLMENT',
    },
  });
  const contract = await db.contract.create({
    data: {
      contractNumber: id,
      customerId: customer.id,
      productId: product.id,
      branchId,
      salespersonId: actor,
      planType: 'STORE_WITH_INTEREST',
      sellingPrice: 12000,
      downPayment: 2000,
      financedAmount: 10000,
      interestRate: 0.05,
      totalMonths: 12,
      interestTotal: 6000,
      storeCommission: 1000,
      vatAmount: 1190,
      monthlyPayment: 1515.83,
      status: 'ACTIVE',
      deviceReceivedAt: new Date(),
    },
  });
  await db.sale.create({
    data: {
      saleNumber: id,
      saleType: 'INSTALLMENT',
      customerId: customer.id,
      productId: product.id,
      contractId: contract.id,
      branchId,
      salespersonId: actor,
      sellingPrice: 12000,
      netAmount: 12000,
    },
  });
  const ticket = await db.repairTicket.create({
    data: {
      ticketNumber: id,
      customerId: customer.id,
      productId: product.id,
      contractId: contract.id,
      branchId,
      deviceBrand: 'Test',
      deviceModel: 'Model',
      deviceImei: id.slice(0, 15),
      defectDescription: 'Screen',
      warrantyStatus: 'IN_7DAY_DEFECT',
      payer: 'SHOP',
      estimatedCost: 9347.25,
      estimatedCostPayer: 'SHOP',
      createdById: actor,
    },
  });
  const row = await db.afterSalesCase.create({
    data: {
      caseNumber: id,
      branchId,
      customerId: customer.id,
      source: 'INSTALLMENT_CONTRACT',
      contractId: contract.id,
      productId: product.id,
      repairTicketId: ticket.id,
      deviceImei: id.slice(0, 15),
      deviceBrand: 'Test',
      deviceModel: 'Model',
      symptom: 'Screen',
      warrantySnapshot: {},
      outcome: 'REPAIR',
      receivedById: actor,
    },
  });
  return { row, ticket, product, contract, customer };
}
beforeAll(async () => {
  shop = (await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'SHOP' } })).id;
  finance = (await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'FINANCE' } })).id;
  branchA = (await db.branch.create({ data: { name: 'A', companyId: shop } })).id;
  branchB = (await db.branch.create({ data: { name: 'B', companyId: shop } })).id;
  actor = await user();
  denied = await user();
  for (const company of ['SHOP', 'FINANCE'] as const)
    await grant(
      actor,
      PERMISSION_CATALOG.filter((p) => !p.ownerOnly).map((p) => p.key),
      company,
    );
  const module = await Test.createTestingModule({
    controllers: [AfterSalesController],
    providers: [
      { provide: AfterSalesService, useValue: facade },
      { provide: AfterSalesDocumentService, useValue: {} },
      { provide: PrismaService, useValue: db },
      { provide: AccessSnapshotService, useValue: snapshots },
      AccessAfterSalesBoundaries,
      { provide: AccessAfterSalesQueryService, useValue: afterQuery },
      AccessResourceService,
      AccessPolicyService,
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
    .overrideGuard(BranchGuard)
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
it('serves all six actual HTTP read routes and denies persisted no-grants for each', async () => {
  const f = await fixture();
  await db.product.create({
    data: {
      name: 'Replacement',
      brand: 'Test',
      model: 'Model',
      category: 'PHONE_USED',
      costPrice: 5000,
      branchId: branchA,
      ownedByCompanyId: shop,
      status: 'IN_STOCK',
    },
  });
  const paths = [
    '/after-sales?summary=true',
    '/after-sales/' + f.row.id,
    '/after-sales/by-ticket/' + f.ticket.id,
    '/after-sales/lookup?imei=' + f.product.imeiSerial,
    '/after-sales/exchange/preview?imei=' + f.product.imeiSerial,
    '/after-sales/replacement-products?sameModel=true&imei=' + f.product.imeiSerial,
  ];
  for (const path of paths) {
    const response = await http(path);
    expect({
      path,
      status: response.status,
      error: response.status >= 300 ? response.body : undefined,
    }).toEqual({ path, status: 200, error: undefined });
    expect((await http(path, denied)).status).toBe(403);
  }
});
const readPermissions: PermissionKey[] = [
  'after-sales.read',
  'repair-tickets.read',
  'contracts.read',
  'sales.read',
  'customers.read',
  'products.read',
];
async function reader(permissions = readPermissions) {
  const id = await user();
  await grant(id, permissions);
  await grant(id, ['products.read'], 'FINANCE');
  return id;
}
it('keeps case-only metadata, nulls independent child identifiers, and never derives from hidden children', async () => {
  const f = await fixture();
  const staff = await reader(['after-sales.read']);
  await db.repairTicket.update({
    where: { id: f.ticket.id },
    data: { status: 'CLOSED', actualCost: 9347.25, returnedToCustomerAt: new Date() },
  });
  const view = await http('/after-sales/' + f.row.id, staff).expect(200);
  expect(view.body).toMatchObject({
    id: f.row.id,
    stage: 'RECEIVED',
    stageVerified: false,
    customer: null,
    customerId: null,
    contractId: null,
    repairTicketId: null,
    repairTicket: null,
    lineLinked: null,
    stageSince: null,
    stale: null,
  });
  expect(JSON.stringify(view.body)).not.toContain('SECRET-LINE');
  expect(JSON.stringify(view.body)).not.toContain('9347.25');
  expect((await db.afterSalesCase.findUniqueOrThrow({ where: { id: f.row.id } })).stage).toBe(
    'RECEIVED',
  );
  expect(
    await db.auditLog.count({
      where: { entityId: f.row.id, action: 'AFTER_SALES_STAGE_RECONCILED' },
    }),
  ).toBe(0);
  const search = await http(
    '/after-sales?q=' + encodeURIComponent(f.customer.name) + '&summary=true',
    staff,
  ).expect(200);
  expect(search.body.total).toBe(0);
  expect(search.body.summary.repairCostShop).toBeNull();
  await http('/after-sales/by-ticket/' + f.ticket.id, staff).expect(404);
});
it('preserves charge provenance, hides internal amounts and raw finance navigation, then admits explicit cost rights', async () => {
  const f = await fixture();
  const staff = await reader();
  await db.repairTicket.update({
    where: { id: f.ticket.id },
    data: { payer: 'CUSTOMER', actualCost: 555, notes: 'secret internal 9347.25' },
  });
  const response = await http('/after-sales/' + f.row.id, staff).expect(200);
  expect(response.body.repairTicket).toMatchObject({
    estimatedCost: null,
    estimatedCostPayer: 'SHOP',
    actualCost: '555',
    notes: null,
  });
  expect(response.body.contract).not.toHaveProperty('financedAmount');
  expect(response.body).toMatchObject({ lineLinked: true, stageVerified: true });
  expect(JSON.stringify(response.body)).not.toContain('SECRET-LINE');
  await grant(staff, ['sensitive.cost.read']);
  const allowed = await http('/after-sales/' + f.row.id, staff).expect(200);
  expect(allowed.body.repairTicket.estimatedCost).toBe('9347.25');
});
it('preserves original branch/company tuples and never uses receivedBy as assignment', async () => {
  const a = await fixture(),
    b = await fixture(branchB);
  const staff = await user();
  await grant(staff, ['after-sales.read'], 'SHOP', [branchA]);
  await grant(staff, ['customers.read'], 'SHOP', [branchB]);
  await grant(staff, ['after-sales.read'], 'FINANCE', [branchB]);
  await http('/after-sales/' + a.row.id, staff).expect(200);
  await http('/after-sales/' + b.row.id, staff).expect(403);
  expect((await http('/after-sales?branchId=' + branchB, staff).expect(200)).body.total).toBe(0);
  await http('/after-sales?company=FINANCE', staff).expect(403);
  const assigned = await user();
  const pos = await db.accessPosition.create({
    data: { code: randomUUID(), name: 'Assigned', permissions: ['after-sales.read'] },
  });
  await db.employeeAccessAssignment.create({
    data: { userId: assigned, positionId: pos.id, companyCode: 'SHOP', scope: 'ASSIGNED' },
  });
  await db.afterSalesCase.update({ where: { id: a.row.id }, data: { receivedById: assigned } });
  await http('/after-sales/' + a.row.id, assigned).expect(403);
});
it('rejects substituted customer/contract and unrelated same-customer replacement links without hiding the case', async () => {
  const a = await fixture(),
    b = await fixture();
  await db.afterSalesCase.update({
    where: { id: a.row.id },
    data: {
      contractId: b.contract.id,
      replacementContractId: b.contract.id,
      replacementProductId: b.product.id,
    },
  });
  const view = await http('/after-sales/' + a.row.id).expect(200);
  expect(view.body).toMatchObject({
    id: a.row.id,
    contractId: null,
    replacementContractId: null,
    repairTicketId: null,
    stageVerified: false,
  });
  await db.contract.update({ where: { id: b.contract.id }, data: { customerId: a.customer.id } });
  expect(
    (await http('/after-sales/' + a.row.id).expect(200)).body.replacementContractId,
  ).toBeNull();
});
it('reconciles completed child state once and records real initiator in the same transaction', async () => {
  const f = await fixture();
  const staff = await reader();
  const closed = new Date();
  await db.repairTicket.update({
    where: { id: f.ticket.id },
    data: { status: 'CLOSED', returnedToCustomerAt: closed },
  });
  const responses = await Promise.all([
    http('/after-sales/' + f.row.id, staff),
    http('/after-sales/' + f.row.id, staff),
  ]);
  for (const response of responses) {
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ stage: 'CLOSED', stageVerified: true });
  }
  const evidence = await db.auditLog.findMany({
    where: { entityId: f.row.id, action: 'AFTER_SALES_STAGE_RECONCILED' },
  });
  expect(evidence).toHaveLength(1);
  expect(evidence[0].userId).toBe(staff);
  expect(evidence[0].newValue).toMatchObject({
    derived: true,
    initiatorId: staff,
    stage: 'CLOSED',
    repairTicketId: f.ticket.id,
  });
  expect((await db.afterSalesCase.findUniqueOrThrow({ where: { id: f.row.id } })).closedAt).toEqual(
    closed,
  );
});
it('rolls back derived CAS when durable audit insert fails late', async () => {
  const f = await fixture();
  await db.repairTicket.update({
    where: { id: f.ticket.id },
    data: { status: 'CLOSED', returnedToCustomerAt: new Date() },
  });
  await db.$executeRawUnsafe(
    `CREATE FUNCTION fail_after_sales_audit() RETURNS trigger AS $$ BEGIN IF NEW.action = 'AFTER_SALES_STAGE_RECONCILED' THEN RAISE EXCEPTION 'test durable audit failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`,
  );
  await db.$executeRawUnsafe(
    'CREATE TRIGGER fail_after_sales_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION fail_after_sales_audit()',
  );
  try {
    await http('/after-sales/' + f.row.id).expect(500);
  } finally {
    await db.$executeRawUnsafe('DROP TRIGGER fail_after_sales_audit ON audit_logs');
    await db.$executeRawUnsafe('DROP FUNCTION fail_after_sales_audit()');
  }
  expect((await db.afterSalesCase.findUniqueOrThrow({ where: { id: f.row.id } })).stage).toBe(
    'RECEIVED',
  );
  expect(
    await db.auditLog.count({
      where: { entityId: f.row.id, action: 'AFTER_SALES_STAGE_RECONCILED' },
    }),
  ).toBe(0);
});
import { lockEmployeeAccess } from './access-snapshot.service';
it.each(['revocation', 'source'] as const)(
  'rechecks %s after an observed PostgreSQL advisory wait',
  async (mode) => {
    const staff = await reader();
    const f = await fixture();
    let release!: () => void, locked!: () => void;
    const held = new Promise<void>((resolve) => {
        locked = resolve;
      }),
      unlock = new Promise<void>((resolve) => {
        release = resolve;
      });
    const change = db.$transaction(
      async (tx) => {
        await lockEmployeeAccess(tx);
        if (mode === 'source')
          await tx.afterSalesCase.update({ where: { id: f.row.id }, data: { branchId: branchB } });
        else {
          const positions = await tx.employeeAccessAssignment.findMany({
            where: { userId: staff },
          });
          await tx.accessPosition.updateMany({
            where: { id: { in: positions.map((p) => p.positionId) } },
            data: { permissions: [] },
          });
        }
        locked();
        await unlock;
      },
      { timeout: 15000 },
    );
    await held;
    const pending = http('/after-sales/' + f.row.id, staff).then((response) => response);
    try {
      for (let i = 0; i < 100; i++) {
        const [{ waiting }] = await db.$queryRaw<
          Array<{ waiting: boolean }>
        >`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event='advisory' AND datname=current_database()) AS waiting`;
        if (waiting) break;
        if (i === 99) throw new Error('No actual waiter');
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    } finally {
      release();
    }
    await change;
    expect((await pending).status).toBe(403);
  },
);
it('uses applied MEMO identity and rejects substituted request/product identity', async () => {
  const f = await fixture();
  const next = await db.product.create({
    data: {
      name: 'Memo replacement',
      brand: 'Test',
      model: 'Model',
      category: 'PHONE_USED',
      costPrice: 5000,
      branchId: branchA,
      ownedByCompanyId: finance,
      status: 'SOLD_INSTALLMENT',
    },
  });
  const swap = await db.contractExchangeRequest.create({
    data: {
      oldContractId: f.contract.id,
      oldProductId: f.product.id,
      newProductId: next.id,
      requestedById: actor,
      mode: 'MEMO',
      status: 'APPROVED',
      memoAppliedAt: new Date(),
    },
  });
  await db.contract.update({ where: { id: f.contract.id }, data: { productId: next.id } });
  await db.afterSalesCase.update({
    where: { id: f.row.id },
    data: {
      repairTicketId: null,
      outcome: 'PRICED_EXCHANGE',
      stage: 'AWAITING_APPROVAL',
      exchangeRequestId: swap.id,
      replacementProductId: next.id,
    },
  });
  const view = await http('/after-sales/' + f.row.id).expect(200);
  expect(view.body).toMatchObject({
    contractId: f.contract.id,
    stage: 'CLOSED',
    stageVerified: true,
    exchangeRequestId: swap.id,
  });
  await db.contractExchangeRequest.update({
    where: { id: swap.id },
    data: { newProductId: f.product.id },
  });
  const hidden = await http('/after-sales/' + f.row.id).expect(200);
  expect(hidden.body).toMatchObject({
    exchangeRequestId: null,
    exchangeRequest: null,
    stageVerified: false,
  });
});
import { hasGlobalOpenAfterSalesCase } from '../after-sales/services/after-sales-stage-reconcile';
import { currentDomainAccess } from './access-execution-context';
it('classifies foreign global IMEI exclusions without reconciling or exposing foreign cases', async () => {
  const f = await fixture(branchB);
  const staff = await reader();
  const classify = () =>
    resources.execute(
      staff,
      'after-sales.read',
      'SHOP',
      undefined,
      () => hasGlobalOpenAfterSalesCase(currentDomainAccess()!.client, f.row.deviceImei!),
      false,
    );
  expect((await classify()).result).toBe(true);
  await db.repairTicket.update({
    where: { id: f.ticket.id },
    data: { status: 'CLOSED', returnedToCustomerAt: new Date() },
  });
  const [first, second] = await Promise.all([classify(), classify()]);
  expect(first.result).toBe(false);
  expect(second.result).toBe(false);
  expect((await db.afterSalesCase.findUniqueOrThrow({ where: { id: f.row.id } })).stage).toBe(
    'RECEIVED',
  );
  expect(
    await db.auditLog.count({
      where: { entityId: f.row.id, action: 'AFTER_SALES_STAGE_RECONCILED' },
    }),
  ).toBe(0);
  await expect(
    hasGlobalOpenAfterSalesCase(db as PrismaService, f.row.deviceImei!),
  ).rejects.toThrow();
});
it('scopes before paging and preserves authorized historical sale behind newer foreign histories', async () => {
  const f = await fixture();
  const staff = await reader();
  await db.sale.create({
    data: {
      saleNumber: randomUUID(),
      saleType: 'CASH',
      customerId: f.customer.id,
      productId: f.product.id,
      branchId: branchB,
      salespersonId: actor,
      sellingPrice: 12000,
      netAmount: 12000,
      createdAt: new Date(Date.now() + 1000),
    },
  });
  await db.afterSalesCase.createMany({
    data: Array.from({ length: 505 }, (_, i) => ({
      caseNumber: 'FOREIGN-' + randomUUID(),
      branchId: branchB,
      customerId: f.customer.id,
      source: 'WALK_IN' as const,
      deviceImei: f.row.deviceImei,
      symptom: 'Foreign',
      warrantySnapshot: {},
      receivedById: actor,
      receivedAt: new Date(Date.now() + i),
    })),
  });
  const scan = await http('/after-sales/lookup?imei=' + f.product.imeiSerial, staff).expect(200);
  expect(scan.body.contract.id).toBe(f.contract.id);
  expect(scan.body.openCase.id).toBe(f.row.id);
  const page = await http(
    '/after-sales?q=' + f.row.caseNumber + '&limit=1&summary=true',
    staff,
  ).expect(200);
  expect(page.body.total).toBe(1);
  expect(page.body.data[0].id).toBe(f.row.id);
  expect(JSON.stringify(page.body)).not.toContain('FOREIGN-');
});
it('requires explicit FINANCE exchange reads while keeping safe warranty lookup useful', async () => {
  const f = await fixture();
  const staff = await reader();
  const scan = await http('/after-sales/lookup?imei=' + f.product.imeiSerial, staff).expect(200);
  expect(scan.body.contract.id).toBe(f.contract.id);
  expect(scan.body.outcomes.every((option: { enabled: boolean }) => !option.enabled)).toBe(true);
  await http('/after-sales/exchange/preview?imei=' + f.product.imeiSerial, staff).expect(403);
  await grant(staff, ['contract-exchanges.read'], 'SHOP');
  await http('/after-sales/exchange/preview?imei=' + f.product.imeiSerial, staff).expect(403);
  await grant(staff, ['contract-exchanges.read', 'customers.read'], 'FINANCE');
  const preview = await http(
    '/after-sales/exchange/preview?imei=' + f.product.imeiSerial,
    staff,
  ).expect(200);
  expect(preview.body.basePrice).toBeNull();
  expect(preview.body.marketMin).toBeNull();
});
it('keeps historical Sale origin separate from current Product source and fresh photo loading', async () => {
  const f = await fixture();
  const staff = await reader();
  await db.product.update({ where: { id: f.product.id }, data: { branchId: branchB } });
  expect(
    (await http('/after-sales/lookup?imei=' + f.product.imeiSerial, staff).expect(200)).body.found,
  ).toBe(false);
  await grant(staff, ['products.read'], 'FINANCE', [branchB]);
  const scan = await http('/after-sales/lookup?imei=' + f.product.imeiSerial, staff).expect(200);
  expect(scan.body.found).toBe(true);
  expect(scan.body.contract.id).toBe(f.contract.id);
});
it('joins captured lookup children to the exact outer transaction and rejects raw/wrong actors', async () => {
  const f = await fixture();
  const staff = await reader();
  const userRecord = await db.user.findUniqueOrThrow({ where: { id: staff } });
  await db.repairTicket.update({
    where: { id: f.ticket.id },
    data: { status: 'CLOSED', returnedToCustomerAt: new Date() },
  });
  await expect(lookup.lookup({ imei: f.product.imeiSerial! }, userRecord)).rejects.toThrow(
    'ธุรกรรม',
  );
  await expect(
    resources.execute(
      staff,
      'after-sales.read',
      'SHOP',
      undefined,
      async () => {
        await lookup.lookup({ imei: f.product.imeiSerial! }, userRecord);
        throw new Error('outer rollback');
      },
      false,
    ),
  ).rejects.toThrow('outer rollback');
  expect((await db.afterSalesCase.findUniqueOrThrow({ where: { id: f.row.id } })).stage).toBe(
    'RECEIVED',
  );
  expect(
    await db.auditLog.count({
      where: { entityId: f.row.id, action: 'AFTER_SALES_STAGE_RECONCILED' },
    }),
  ).toBe(0);
  await expect(
    resources.execute(
      staff,
      'after-sales.read',
      'SHOP',
      undefined,
      () => lookup.lookup({ imei: f.product.imeiSerial! }, { ...userRecord, id: actor }),
      false,
    ),
  ).rejects.toThrow('ผู้ดำเนินการ');
});
it('routes a managed owner through the safe view rather than the raw business payload', async () => {
  const f = await fixture();
  const owner = await user();
  await db.user.update({ where: { id: owner }, data: { role: 'OWNER' } });
  const view = await http('/after-sales/' + f.row.id, owner).expect(200);
  expect(view.body.contract).not.toHaveProperty('financedAmount');
  expect(view.body.customer).not.toHaveProperty('lineIdShop');
  expect(view.body).not.toHaveProperty('photoKeys');
});
it('returns exact authorized paging beyond the former 500-row cap', async () => {
  const f = await fixture();
  const branch = await db.branch.create({
    data: { name: 'Large authorized branch', companyId: shop },
  });
  const staff = await user();
  await grant(staff, ['after-sales.read'], 'SHOP', [branch.id]);
  const prefix = 'PAGE-' + randomUUID();
  await db.afterSalesCase.createMany({
    data: Array.from({ length: 505 }, (_, i) => ({
      caseNumber: prefix + '-' + i,
      branchId: branch.id,
      customerId: f.customer.id,
      source: 'WALK_IN' as const,
      symptom: 'Screen',
      warrantySnapshot: {},
      receivedById: actor,
    })),
  });
  const response = await http('/after-sales?page=3&limit=200&summary=true', staff).expect(200);
  expect(response.body.total).toBe(505);
  expect(response.body.data).toHaveLength(105);
  expect(response.body.truncated).toBe(false);
  expect(response.body.summary.open).toBe(505);
}, 30000);
it('observes current linked charge provenance after an actual authority-lock wait', async () => {
  const f = await fixture();
  const staff = await reader();
  await db.repairTicket.update({
    where: { id: f.ticket.id },
    data: { payer: 'CUSTOMER', estimatedCostPayer: 'CUSTOMER' },
  });
  let release!: () => void, locked!: () => void;
  const held = new Promise<void>((resolve) => {
      locked = resolve;
    }),
    unlock = new Promise<void>((resolve) => {
      release = resolve;
    });
  const change = db.$transaction(
    async (tx) => {
      await lockEmployeeAccess(tx);
      await tx.repairTicket.update({
        where: { id: f.ticket.id },
        data: { estimatedCostPayer: 'SHOP' },
      });
      locked();
      await unlock;
    },
    { timeout: 15000 },
  );
  await held;
  const pending = http('/after-sales/' + f.row.id, staff).then((response) => response);
  try {
    for (let i = 0; i < 100; i++) {
      const [{ waiting }] = await db.$queryRaw<
        Array<{ waiting: boolean }>
      >`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event='advisory' AND datname=current_database()) AS waiting`;
      if (waiting) break;
      if (i === 99) throw new Error('No actual waiter');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  } finally {
    release();
  }
  await change;
  const response = await pending;
  expect(response.status).toBe(200);
  expect(response.body.repairTicket.estimatedCost).toBeNull();
  expect(response.body.repairTicket.estimatedCostPayer).toBe('SHOP');
});
import {
  RECONCILE_SELECT,
  reconcileStage,
} from '../after-sales/services/after-sales-stage-reconcile';
it('rejects cross-row/cross-transaction facts and ignores caller-fabricated derived child status', async () => {
  const f = await fixture(),
    other = await fixture();
  const first = await resources.execute(
    actor,
    'after-sales.read',
    'SHOP',
    undefined,
    async () => {
      const facts = await afterSources.resolve(f.row.id);
      await expect(afterProjection.project(other.row.id, facts)).rejects.toThrow('ธุรกรรม');
      const row = await currentDomainAccess()!.client.afterSalesCase.findUniqueOrThrow({
        where: { id: f.row.id },
        select: RECONCILE_SELECT,
      });
      const result = await reconcileStage(
        currentDomainAccess()!.client,
        { ...row, repairTicket: { ...row.repairTicket!, status: 'CLOSED' as const } },
        facts,
      );
      expect(result.stage).toBe('RECEIVED');
      await currentDomainAccess()!.client.afterSalesCase.update({
        where: { id: f.row.id },
        data: { customerId: other.customer.id },
      });
      await expect(reconcileStage(currentDomainAccess()!.client, row, facts)).rejects.toThrow(
        'แหล่งเคสเปลี่ยนแปลง',
      );
      await currentDomainAccess()!.client.afterSalesCase.update({
        where: { id: f.row.id },
        data: { customerId: f.customer.id },
      });
      return facts;
    },
    false,
  );
  await expect(
    resources.execute(
      actor,
      'after-sales.read',
      'SHOP',
      undefined,
      () => afterProjection.project(f.row.id, first.result),
      false,
    ),
  ).rejects.toThrow('ธุรกรรม');
  expect((await db.afterSalesCase.findUniqueOrThrow({ where: { id: f.row.id } })).stage).toBe(
    'RECEIVED',
  );
});
it('does not reintroduce rejected raw source IDs through the nested repair projector', async () => {
  const f = await fixture(),
    other = await fixture();
  await db.contract.update({ where: { id: f.contract.id }, data: { productId: other.product.id } });
  await db.product.update({
    where: { id: f.product.id },
    data: { imeiSerial: 'changed-device-identity' },
  });
  const response = await http('/after-sales/' + f.row.id).expect(200);
  expect(response.body.contractId).toBeNull();
  expect(response.body.productId).toBeNull();
  expect(response.body.repairTicket.contractId).toBeNull();
  expect(response.body.repairTicket.productId).toBeNull();
  expect(response.body.stageVerified).toBe(false);
});
it.each(['AUTO', 'REVIEW', 'ESCALATE'] as const)(
  'preserves authorized %s exchange workflow metadata without requiring approval permission',
  async (approvalTier) => {
    const f = await fixture();
    const next = await db.product.create({
      data: {
        name: 'Workflow replacement',
        brand: 'Test',
        model: 'Model',
        category: 'PHONE_USED',
        costPrice: 5000,
        branchId: branchA,
        ownedByCompanyId: shop,
        status: 'IN_STOCK',
      },
    });
    const swap = await db.contractExchangeRequest.create({
      data: {
        oldContractId: f.contract.id,
        oldProductId: f.product.id,
        newProductId: next.id,
        requestedById: actor,
        mode: 'PRICED',
        status: 'PENDING',
        approvalTier,
      },
    });
    await db.afterSalesCase.update({
      where: { id: f.row.id },
      data: {
        repairTicketId: null,
        outcome: 'PRICED_EXCHANGE',
        stage: 'AWAITING_APPROVAL',
        exchangeRequestId: swap.id,
        replacementProductId: next.id,
      },
    });
    const staff = await reader();
    const hidden = await http('/after-sales/' + f.row.id, staff).expect(200);
    await grant(staff, ['contract-exchanges.read', 'customers.read'], 'FINANCE');
    await grant(staff, ['contract-exchanges.read'], 'SHOP');
    const expected = {
      approvalTier,
      approverRole: approvalTier === 'ESCALATE' ? 'OWNER' : 'BRANCH_MANAGER',
    };
    const visible = await http('/after-sales/' + f.row.id, staff).expect(200);
    expect(visible.body.exchange).toMatchObject(expected);
    expect(hidden.body.exchange).toMatchObject({ approvalTier: null, approverRole: null });
    const list = await http(
      '/after-sales?tab=AWAITING_APPROVAL&q=' + f.row.caseNumber,
      staff,
    ).expect(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].exchange).toMatchObject(expected);
  },
);
it('preserves the case-owned same-model approval workflow label', async () => {
  const f = await fixture();
  const staff = await reader(['after-sales.read']);
  await db.afterSalesCase.update({
    where: { id: f.row.id },
    data: { outcome: 'SAME_MODEL_EXCHANGE', repairTicketId: null },
  });
  const view = await http('/after-sales/' + f.row.id, staff).expect(200);
  expect(view.body.exchange).toMatchObject({ kind: 'SAME_MODEL', approverRole: 'BRANCH_MANAGER' });
});
