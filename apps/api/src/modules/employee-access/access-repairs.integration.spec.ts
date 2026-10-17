import { ExpenseDocumentCreateService } from '../expense-documents/services/expense-document-create.service';
import { LineAggregatorService } from '../expense-documents/services/line-aggregator.service';
import { DocNumberService as ExpenseNumber } from '../expense-documents/services/doc-number.service';
import { DocNumberService as IncomeNumber } from '../other-income/services/doc-number.service';
import { ADJUSTMENT_ALLOWLIST } from '../expense-documents/expense-validators.util';
import { currentDomainAccess } from './access-execution-context';
import { REPAIR_BOUNDARY_ROUTES } from './access-repair-boundaries';
import { AccessRepairBoundaries } from './access-repair-boundaries';
import { AccessRepairSourceService } from './access-repair-source.service';
import { AccessRepairProjectionService } from './access-repair-projection.service';
import { AccessTradeInProjectionService } from './access-trade-in-projection.service';
import { AccessProcurementSourceService } from './access-procurement-source.service';
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
import { RepairTicketsController } from '../repair-tickets/repair-tickets.controller';
import { RepairTicketsService } from '../repair-tickets/repair-tickets.service';
import { RepairTicketDocNumberService } from '../repair-tickets/services/doc-number.service';
import { AuditService } from '../audit/audit.service';
import { ExpenseDocumentsService } from '../expense-documents/expense-documents.service';
import { OtherIncomeService } from '../other-income/other-income.service';
import { SettingsService } from '../settings/settings.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BranchGuard } from '../auth/guards/branch.guard';
const url = process.env.EMPLOYEE_ACCESS_TEST_DATABASE_URL;
if (!url?.includes('/bc_access_task2?host=/tmp/bc-access-repairs.'))
  throw new Error('Owned isolated database required');
const db = new PrismaClient({ datasources: { db: { url } } });
const snapshots = new AccessSnapshotService(db as PrismaService);
let app: INestApplication,
  actor: string,
  denied: string,
  branchA: string,
  customerId: string,
  owner: string,
  supplierId: string,
  branchB: string,
  shopId: string;
const successes = new Map<
  string,
  { method: 'get' | 'post' | 'patch' | 'delete'; path: string; body?: object }
>();
async function user() {
  return (
    await db.user.create({
      data: {
        name: 'Test',
        email: randomUUID() + '@test.invalid',
        password: 'unused',
        role: 'ACCOUNTANT',
        accessManaged: true,
      },
    })
  ).id;
}
async function grant(id: string, permissions: PermissionKey[], branchIds?: string[]) {
  const p = await db.accessPosition.create({
    data: { code: randomUUID(), name: 'Test', permissions },
  });
  await db.employeeAccessAssignment.create({
    data: {
      userId: id,
      positionId: p.id,
      companyCode: 'SHOP',
      scope: branchIds ? 'BRANCHES' : 'COMPANY',
      ...(branchIds ? { branches: { create: branchIds.map((branchId) => ({ branchId })) } } : {}),
    },
  });
}
function http(
  method: 'get' | 'post' | 'patch' | 'delete',
  path: string,
  body?: object,
  id = actor,
) {
  const r = request(app.getHttpServer())[method](path).set('x-test-user', id);
  if (body) r.send(body);
  return r;
}
beforeAll(async () => {
  const shop = await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'SHOP' } });
  branchA = (await db.branch.create({ data: { name: 'Repair A', companyId: shop.id } })).id;
  actor = await user();
  denied = await user();
  owner = await user();
  await db.user.update({ where: { id: owner }, data: { role: 'OWNER' } });
  shopId = shop.id;
  branchB = (await db.branch.create({ data: { name: 'Repair B', companyId: shop.id } })).id;
  supplierId = (
    await db.supplier.create({
      data: {
        name: 'Repair center',
        phone: '0800000000',
        isRepairCenter: true,
        accessCompanyCode: 'SHOP',
        accessBranchId: branchA,
      },
    })
  ).id;
  for (const code of ADJUSTMENT_ALLOWLIST)
    await db.chartOfAccount.upsert({
      where: { code },
      create: { code, name: code, type: 'expense', normalBalance: 'Dr' },
      update: {},
    });
  await grant(
    actor,
    PERMISSION_CATALOG.filter((p) => !p.ownerOnly).map((p) => p.key),
    [branchA],
  );
  customerId = (
    await db.customer.create({
      data: { name: 'Known repair customer', phone: '0800000000', nationalId: randomUUID() },
    })
  ).id;
  await db.tradeIn.create({
    data: { customerId, branchId: branchA, deviceBrand: 'Apple', deviceModel: 'Evidence' },
  });
  const settings = {
    getDocPrefixMap: async () => ({ REPAIR_SERVICE: 'RS' }),
    getKey: async () => null,
  } as unknown as SettingsService;
  const creator = new ExpenseDocumentCreateService(
    db as PrismaService,
    new ExpenseNumber(settings),
    new LineAggregatorService(),
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const expense = new ExpenseDocumentsService(
    db as PrismaService,
    {} as never,
    {} as never,
    creator,
  );
  const income = new OtherIncomeService(
    db as PrismaService,
    new IncomeNumber(db as PrismaService),
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    new AuditService(db as PrismaService),
  );
  const module = await Test.createTestingModule({
    controllers: [RepairTicketsController],
    providers: [
      AccessRepairBoundaries,
      AccessRepairSourceService,
      AccessRepairProjectionService,
      AccessTradeInProjectionService,
      AccessProcurementSourceService,
      RepairTicketsService,
      RepairTicketDocNumberService,
      AuditService,
      AccessResourceService,
      AccessPolicyService,
      { provide: PrismaService, useValue: db },
      { provide: AccessSnapshotService, useValue: snapshots },
      { provide: SettingsService, useValue: {} },
      // Actual canonical draft services/numbering/Decimal aggregation; unused posting/transport dependencies are inert.
      { provide: ExpenseDocumentsService, useValue: expense },
      { provide: OtherIncomeService, useValue: income },
      { provide: APP_INTERCEPTOR, useClass: AccessPolicyInterceptor },
    ],
  })
    .overrideGuard(JwtAuthGuard)
    .useValue({
      canActivate: async (ctx: ExecutionContext) => {
        const req = ctx.switchToHttp().getRequest(),
          id = req.headers['x-test-user'];
        const response = ctx.switchToHttp().getResponse();
        response.on('finish', () => {
          if (response.statusCode < 300)
            successes.set(ctx.getClass().name + '.' + ctx.getHandler().name, {
              method: req.method.toLowerCase(),
              path: req.originalUrl,
              body: structuredClone(req.body),
            });
        });
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
it('allows real scoped WALK_IN intake for a known customer and rejects persisted no-grants identity', async () => {
  const body = {
    branchId: branchA,
    customerId,
    defectDescription: 'Device does not start',
    payer: 'CUSTOMER',
  };
  const created = await http('post', '/repair-tickets', body).expect(201);
  expect(created.body.warrantyStatus).toBe('WALK_IN');
  await http('post', '/repair-tickets', body, denied).expect(403);
  expect(await db.repairTicket.count()).toBe(1);
});

async function ticket(extra: object = {}, who = actor) {
  return (
    await http(
      'post',
      '/repair-tickets',
      {
        branchId: branchA,
        customerId,
        defectDescription: 'Device does not start',
        payer: 'CUSTOMER',
        ...extra,
      },
      who,
    ).expect(201)
  ).body;
}
async function product(branchId = branchA) {
  return db.product.create({
    data: {
      name: randomUUID(),
      brand: 'Apple',
      model: 'Repair test',
      category: 'PHONE_USED',
      costPrice: 6000,
      branchId,
      ownedByCompanyId: shopId,
      imeiSerial: randomUUID(),
    },
  });
}
async function contract(branchId = branchA) {
  const p = await product(branchId);
  return db.contract.create({
    data: {
      contractNumber: randomUUID(),
      customerId,
      productId: p.id,
      branchId,
      salespersonId: actor,
      planType: 'STORE_DIRECT',
      sellingPrice: 10000,
      downPayment: 1000,
      interestRate: 0.01,
      totalMonths: 10,
      interestTotal: 900,
      financedAmount: 9000,
      monthlyPayment: 990,
      status: 'ACTIVE',
      deviceReceivedAt: new Date(),
      shopWarrantyEndDate: new Date(Date.now() + 86400000 * 30),
    },
  });
}
it('reconciles all 15 HTTP routes with actual permitted success and persisted no-grants denial', async () => {
  const t = await ticket();
  await http('get', '/repair-tickets').expect(200);
  await http('get', '/repair-tickets/' + t.id).expect(200);
  await http('patch', '/repair-tickets/' + t.id, { estimatedCost: 100 }).expect(200);
  await http('post', `/repair-tickets/${t.id}/recalc-warranty`).expect(201);
  await http('post', `/repair-tickets/${t.id}/send`, {
    repairSupplierId: supplierId,
    estimatedCost: 101,
  }).expect(201);
  await http('post', `/repair-tickets/${t.id}/mark-repaired`, {
    actualCost: 123.45,
    payer: 'CUSTOMER',
  }).expect(201);
  await http('post', `/repair-tickets/${t.id}/send-back`, { note: 'QC failed again' }).expect(201);
  await http('post', `/repair-tickets/${t.id}/mark-repaired`, {
    actualCost: 123.45,
    payer: 'CUSTOMER',
  }).expect(201);
  await http('post', `/repair-tickets/${t.id}/return-to-customer`, {}).expect(201);
  const cancelled = await ticket();
  await http('post', `/repair-tickets/${cancelled.id}/cancel`, {
    note: 'Customer canceled',
  }).expect(201);
  await http('delete', '/repair-tickets/' + cancelled.id, undefined, owner).expect(200);
  const c = await contract();
  await http('get', '/repair-tickets/warranty-preview?contractId=' + c.id).expect(200);
  await http('get', '/repair-tickets/warranty-lookup?contractNumber=' + c.contractNumber).expect(
    200,
  );
  await http('get', '/repair-tickets/lookup-by-imei?imei=missing-imei').expect(200);
  const replacement = await ticket();
  await http('post', `/repair-tickets/${replacement.id}/replace`, {
    replacementContractId: c.id,
  }).expect(201);
  expect([...successes.keys()].sort()).toEqual([...REPAIR_BOUNDARY_ROUTES].sort());
  for (const [route, r] of successes) {
    const res = await http(r.method, r.path, r.body, denied);
    expect({ route, status: res.status }).toEqual({ route, status: 403 });
  }
});
const repairPermissions: PermissionKey[] = [
  'repair-tickets.read',
  'repair-tickets.create',
  'repair-tickets.update',
  'customers.read',
  'suppliers.read',
  'products.read',
  'contracts.read',
  'sales.read',
];
it('retains original scope tuples and independently filters search, paging and linked sources', async () => {
  const scoped = await user();
  await grant(scoped, repairPermissions, [branchA]);
  await grant(scoped, ['repair-tickets.read'], [branchB]);
  const foreign = await ticket({ branchId: branchB, defectDescription: 'Foreign intake' }, owner);
  await http(
    'patch',
    '/repair-tickets/' + foreign.id,
    { notes: 'No cross product' },
    scoped,
  ).expect(403);
  await http(
    'post',
    `/repair-tickets/${foreign.id}/send`,
    { repairSupplierId: supplierId },
    scoped,
  ).expect(403);
  const onlyA = await user();
  await grant(onlyA, repairPermissions, [branchA]);
  await http('get', '/repair-tickets/' + foreign.id, undefined, onlyA).expect(403);
  const listed = await http('get', '/repair-tickets?limit=1&page=1', undefined, onlyA).expect(200);
  expect(listed.body.data.every((r: { branchId: string }) => r.branchId === branchA)).toBe(true);
  expect(listed.body.total).toBe(
    await db.repairTicket.count({ where: { branchId: branchA, deletedAt: null } }),
  );
  const noParty = await user();
  await grant(noParty, ['repair-tickets.read'], [branchA]);
  const search = await http(
    'get',
    '/repair-tickets?q=' + encodeURIComponent('Known repair customer'),
    undefined,
    noParty,
  ).expect(200);
  expect(search.body.total).toBe(0);
  await http('get', '/repair-tickets?customerId=' + customerId, undefined, noParty).expect(403);
  const local = await ticket();
  const projected = await http('get', '/repair-tickets/' + local.id, undefined, noParty).expect(
    200,
  );
  expect(projected.body.customer).toBeNull();
  expect(projected.body.customerId).toBeNull();
  const unlinked = await db.customer.create({
    data: { name: 'Unlinked', phone: '0800000001', nationalId: randomUUID() },
  });
  await http('post', '/repair-tickets', {
    branchId: branchA,
    customerId: unlinked.id,
    defectDescription: 'No false party origin',
  }).expect(403);
  const foreignSupplier = await db.supplier.create({
    data: {
      name: 'Foreign repair center',
      phone: '0800000003',
      isRepairCenter: true,
      accessCompanyCode: 'SHOP',
      accessBranchId: branchB,
    },
  });
  await http(
    'post',
    '/repair-tickets',
    {
      branchId: branchA,
      customerId,
      repairSupplierId: foreignSupplier.id,
      defectDescription: 'Supplier substitution',
    },
    onlyA,
  ).expect(403);
  await http(
    'get',
    '/repair-tickets?repairSupplierId=' + foreignSupplier.id,
    undefined,
    onlyA,
  ).expect(403);
  const foreignProduct = await product(branchB);
  await http(
    'post',
    '/repair-tickets',
    {
      branchId: branchA,
      customerId,
      productId: foreignProduct.id,
      defectDescription: 'Product substitution',
    },
    onlyA,
  ).expect(403);
  const c = await contract(branchB),
    p = await product();
  await http('post', '/repair-tickets', {
    branchId: branchA,
    customerId,
    contractId: c.id,
    defectDescription: 'Foreign contract',
  }).expect(403);
  const ca = await contract();
  await http('post', '/repair-tickets', {
    branchId: branchA,
    customerId,
    contractId: ca.id,
    productId: p.id,
    defectDescription: 'Substituted product',
  }).expect(403);
  for (const suffix of ['?limit=0', '?page=9999999999999', '?badFilter=1', '?customerId[]=bad'])
    await http('get', '/repair-tickets' + suffix).expect(400);
});
it('never converts ticket creator into ASSIGNED authority', async () => {
  const assigned = await user();
  const p = await db.accessPosition.create({
    data: { code: randomUUID(), name: 'Assigned', permissions: repairPermissions },
  });
  await db.employeeAccessAssignment.create({
    data: { userId: assigned, positionId: p.id, companyCode: 'SHOP', scope: 'ASSIGNED' },
  });
  const t = await ticket();
  await db.repairTicket.update({ where: { id: t.id }, data: { createdById: assigned } });
  await http('get', '/repair-tickets/' + t.id, undefined, assigned).expect(403);
  await http('get', '/repair-tickets', undefined, assigned).expect(403);
});
it('preserves customer quote provenance across every estimate writer and payer changes', async () => {
  const staff = await user();
  await grant(staff, repairPermissions, [branchA]);
  const quote = await ticket({ estimatedCost: 111.11 }, staff);
  expect(quote.estimatedCost).toBe('111.11');
  expect(quote.estimatedCostPayer).toBe('CUSTOMER');
  const internal = await ticket({ payer: 'SHOP', estimatedCost: 222.22 }, staff);
  expect(internal.estimatedCost).toBeNull();
  const fresh = await http(
    'post',
    `/repair-tickets/${internal.id}/mark-repaired`,
    { payer: 'CUSTOMER', actualCost: 333.33 },
    staff,
  ).expect(201);
  expect(fresh.body.estimatedCost).toBeNull();
  expect(fresh.body.actualCost).toBe('333.33');
  expect(
    (await db.repairTicket.findUniqueOrThrow({ where: { id: internal.id } })).estimatedCostPayer,
  ).toBe('SHOP');
  const unknown = await ticket({ estimatedCost: 444.44 }, staff);
  await db.repairTicket.update({ where: { id: unknown.id }, data: { estimatedCostPayer: null } });
  expect(
    (await http('get', '/repair-tickets/' + unknown.id, undefined, staff).expect(200)).body
      .estimatedCost,
  ).toBeNull();
  expect((await http('get', '/repair-tickets/' + unknown.id).expect(200)).body.estimatedCost).toBe(
    '444.44',
  );
  expect(
    (
      await http('patch', '/repair-tickets/' + unknown.id, { estimatedCost: 555.55 }, staff).expect(
        200,
      )
    ).body.estimatedCost,
  ).toBe('555.55');
  await db.repairTicket.update({ where: { id: unknown.id }, data: { estimatedCostPayer: null } });
  await http(
    'post',
    `/repair-tickets/${unknown.id}/send`,
    { repairSupplierId: supplierId },
    staff,
  ).expect(201);
  expect(
    (await db.repairTicket.findUniqueOrThrow({ where: { id: unknown.id } })).estimatedCostPayer,
  ).toBeNull();
  const sent = await ticket({ estimatedCost: 1 }, staff);
  await db.repairTicket.update({ where: { id: sent.id }, data: { estimatedCostPayer: null } });
  expect(
    (
      await http(
        'post',
        `/repair-tickets/${sent.id}/send`,
        { repairSupplierId: supplierId, estimatedCost: 666.66 },
        staff,
      ).expect(201)
    ).body.estimatedCost,
  ).toBe('666.66');
  expect(
    (await db.repairTicket.findUniqueOrThrow({ where: { id: sent.id } })).estimatedCostPayer,
  ).toBe('CUSTOMER');
});
it('creates canonical exactly-once drafts without granting posting rights and rolls back late failure', async () => {
  const staff = await user();
  await grant(staff, repairPermissions, [branchA]);
  for (const payer of ['SHOP', 'CUSTOMER', 'SUPPLIER_CLAIM'] as const) {
    const t = await ticket({ payer, repairSupplierId: supplierId }, staff);
    await http(
      'post',
      `/repair-tickets/${t.id}/send`,
      { repairSupplierId: supplierId },
      staff,
    ).expect(201);
    await http(
      'post',
      `/repair-tickets/${t.id}/mark-repaired`,
      { payer, actualCost: 1234.56 },
      staff,
    ).expect(201);
    const expenses = await db.expenseDocument.count(),
      incomes = await db.otherIncome.count(),
      audits = await db.auditLog.count(),
      logs = await db.repairStatusLog.count();
    const failure = jest
      .spyOn(app.get(AccessRepairProjectionService), 'project')
      .mockRejectedValueOnce(new Error('late repair projection failure'));
    await http('post', `/repair-tickets/${t.id}/return-to-customer`, {}, staff).expect(500);
    failure.mockRestore();
    expect(await db.expenseDocument.count()).toBe(expenses);
    expect(await db.otherIncome.count()).toBe(incomes);
    expect(await db.auditLog.count()).toBe(audits);
    expect(await db.repairStatusLog.count()).toBe(logs);
    expect((await db.repairTicket.findUniqueOrThrow({ where: { id: t.id } })).status).toBe(
      'READY_FOR_PICKUP',
    );
    const responses = await Promise.all([
      http('post', `/repair-tickets/${t.id}/return-to-customer`, {}, staff),
      http('post', `/repair-tickets/${t.id}/return-to-customer`, {}, staff),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    const closed = await db.repairTicket.findUniqueOrThrow({ where: { id: t.id } });
    const response = responses.find((r) => r.status === 201)!;
    expect(response.body.expenseDocumentId).toBeNull();
    expect(response.body.otherIncomeId).toBeNull();
    expect(await db.expenseDocument.count()).toBe(expenses + (payer === 'SHOP' ? 1 : 0));
    expect(await db.otherIncome.count()).toBe(incomes + (payer === 'CUSTOMER' ? 1 : 0));
    if (payer === 'SHOP')
      expect(
        (
          await db.expenseDocument.findUniqueOrThrow({ where: { id: closed.expenseDocumentId! } })
        ).totalAmount.toString(),
      ).toBe('1234.56');
    if (payer === 'CUSTOMER') {
      const doc = await db.otherIncome.findUniqueOrThrow({ where: { id: closed.otherIncomeId! } });
      expect(doc.companyId).toBe(shopId);
      expect(doc.totalAmount.toString()).toBe('1234.56');
      expect(doc.status).toBe('DRAFT');
    }
    expect(
      await db.auditLog.count({ where: { entityId: t.id, action: 'REPAIR_TICKET_RETURNED' } }),
    ).toBe(1);
    await http('post', `/repair-tickets/${t.id}/return-to-customer`, {}, staff).expect(409);
  }
  for (const amount of [0, 100]) {
    const t = await ticket({ payer: 'SHOP' }, staff);
    await http(
      'post',
      `/repair-tickets/${t.id}/mark-repaired`,
      { payer: 'SHOP', actualCost: amount },
      staff,
    ).expect(201);
    await http('post', `/repair-tickets/${t.id}/return-to-customer`, {}, staff).expect(201);
    expect(
      (await db.repairTicket.findUniqueOrThrow({ where: { id: t.id } })).expenseDocumentId,
    ).toBeNull();
  }
});
import { lockEmployeeAccess } from './access-snapshot.service';
it.each(['revocation', 'demotion', 'source'] as const)(
  'rechecks %s after an actual lock wait',
  async (mode) => {
    const staff = await user();
    await grant(staff, repairPermissions, [branchA]);
    if (mode === 'demotion')
      await db.user.update({ where: { id: staff }, data: { role: 'OWNER' } });
    const t = await ticket();
    let release!: () => void, locked!: () => void;
    const held = new Promise<void>((r) => (locked = r)),
      unlock = new Promise<void>((r) => (release = r));
    const change = db.$transaction(
      async (tx) => {
        await lockEmployeeAccess(tx);
        if (mode === 'source')
          await tx.repairTicket.update({ where: { id: t.id }, data: { branchId: branchB } });
        else {
          const assignments = await tx.employeeAccessAssignment.findMany({
            where: { userId: staff },
          });
          await tx.accessPosition.updateMany({
            where: { id: { in: assignments.map((a) => a.positionId) } },
            data: { permissions: [] },
          });
          await tx.user.update({
            where: { id: staff },
            data: { role: 'ACCOUNTANT', accessRevision: { increment: 1 } },
          });
        }
        locked();
        await unlock;
      },
      { timeout: 15000 },
    );
    await held;
    const pending = http(
      'post',
      `/repair-tickets/${t.id}/mark-repaired`,
      { actualCost: 1, payer: 'CUSTOMER' },
      staff,
    ).then((r) => r);
    try {
      for (let i = 0; i < 100; i++) {
        const [{ waiting }] = await db.$queryRaw<
          Array<{ waiting: boolean }>
        >`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event='advisory' AND datname=current_database()) AS waiting`;
        if (waiting) break;
        if (i === 99) throw new Error('No real lock waiter');
        await new Promise((r) => setTimeout(r, 10));
      }
    } finally {
      release();
    }
    await change;
    expect((await pending).status).toBe(403);
    expect((await db.repairTicket.findUniqueOrThrow({ where: { id: t.id } })).status).toBe('OPEN');
  },
);
it('protects raw child caller hooks and joins createInTx/markReplaced to the actual outer transaction', async () => {
  const svc = app.get(RepairTicketsService),
    engine = app.get(AccessResourceService);
  const userRecord = await db.user.findUniqueOrThrow({ where: { id: actor } });
  const body = { branchId: branchA, customerId, defectDescription: 'Atomic child caller' };
  const count = await db.repairTicket.count();
  await expect(db.$transaction((tx) => svc.createInTx(body, userRecord, tx))).rejects.toThrow(
    'ต้องตรวจสิทธิ์',
  );
  await expect(
    engine.execute(
      actor,
      'repair-tickets.create',
      'SHOP',
      undefined,
      async () => {
        await svc.createInTx(body, userRecord, db); // wrong transaction cannot escape atomic work
      },
      false,
    ),
  ).rejects.toThrow('ธุรกรรมสิทธิ์');
  await expect(
    engine.execute(
      actor,
      'repair-tickets.create',
      'SHOP',
      undefined,
      async () => {
        await svc.createInTx(body, userRecord, currentDomainAccess()!.client);
        throw new Error('outer rollback');
      },
      false,
    ),
  ).rejects.toThrow('outer rollback');
  expect(await db.repairTicket.count()).toBe(count);
  const made = await engine.execute(
    actor,
    'repair-tickets.create',
    'SHOP',
    undefined,
    () => svc.createInTx(body, userRecord, currentDomainAccess()!.client),
    false,
  );
  const c = await contract();
  await expect(
    engine.execute(
      actor,
      'defect-exchanges.create',
      'SHOP',
      undefined,
      async () => {
        await svc.markReplaced(
          made.result.ticket.id,
          c.id,
          userRecord,
          currentDomainAccess()!.client,
        );
        throw new Error('replacement rollback');
      },
      false,
    ),
  ).rejects.toThrow('replacement rollback');
  expect(
    (await db.repairTicket.findUniqueOrThrow({ where: { id: made.result.ticket.id } })).status,
  ).toBe('OPEN');
  expect(
    await db.auditLog.count({
      where: { entityId: made.result.ticket.id, action: 'REPAIR_TICKET_REPLACED' },
    }),
  ).toBe(0);
  await engine.execute(
    actor,
    'defect-exchanges.create',
    'SHOP',
    undefined,
    () => svc.markReplaced(made.result.ticket.id, c.id, userRecord, currentDomainAccess()!.client),
    false,
  );
  const other = await user();
  await grant(other, ['after-sales.create'], [branchA]);
  const otherUser = await db.user.findUniqueOrThrow({ where: { id: other } });
  await expect(
    engine.execute(
      other,
      'after-sales.create',
      'SHOP',
      undefined,
      () => svc.createInTx(body, otherUser, currentDomainAccess()!.client),
      false,
    ),
  ).rejects.toThrow();
  await grant(other, ['repair-tickets.create', 'customers.read'], [branchA]);
  const permitted = await engine.execute(
    other,
    'after-sales.create',
    'SHOP',
    undefined,
    () => svc.createInTx(body, otherUser, currentDomainAccess()!.client),
    false,
  );
  expect(permitted.result.ticket.customerId).toBe(customerId);
});
it('keeps SHOP warranty provenance separate from current FINANCE product and financial Contract details', async () => {
  const c = await contract(),
    foreign = await contract(branchB);
  const finance = await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'FINANCE' } });
  await db.product.update({
    where: { id: c.productId },
    data: { ownedByCompanyId: finance.id, branchId: branchB },
  });
  const staff = await user();
  await grant(staff, repairPermissions, [branchA]);
  await http('get', '/repair-tickets/warranty-preview?contractId=' + c.id, undefined, staff).expect(
    403,
  );
  const p = await db.accessPosition.create({
    data: { code: randomUUID(), name: 'Finance product read', permissions: ['products.read'] },
  });
  await db.employeeAccessAssignment.create({
    data: {
      userId: staff,
      positionId: p.id,
      companyCode: 'FINANCE',
      scope: 'BRANCHES',
      branches: { create: [{ branchId: branchB }] },
    },
  });
  await http('get', '/repair-tickets/warranty-preview?contractId=' + c.id, undefined, staff).expect(
    200,
  );
  await http(
    'get',
    '/repair-tickets/warranty-preview?contractId=' + c.id + '&productId=' + c.productId,
    undefined,
    staff,
  ).expect(200);
  const lookup = await http(
    'get',
    '/repair-tickets/warranty-lookup?customerId=' + customerId,
    undefined,
    staff,
  ).expect(200);
  expect(
    lookup.body.devices.some((d: { contract: { id: string } | null }) => d.contract?.id === c.id),
  ).toBe(true);
  expect(
    lookup.body.devices.some(
      (d: { contract: { id: string } | null }) => d.contract?.id === foreign.id,
    ),
  ).toBe(false);
  expect(JSON.stringify(lookup.body)).not.toMatch(
    /sellingPrice|interestRate|financedAmount|nationalId|advanceBalance/,
  );
  await db.sale.create({
    data: {
      saleNumber: randomUUID(),
      saleType: 'INSTALLMENT',
      customerId,
      productId: c.productId,
      branchId: branchA,
      salespersonId: actor,
      sellingPrice: 10000,
      netAmount: 10000,
      contractId: c.id,
    },
  });
  const productRow = await db.product.findUniqueOrThrow({ where: { id: c.productId } });
  const scan = await http(
    'get',
    '/repair-tickets/lookup-by-imei?imei=' + productRow.imeiSerial,
    undefined,
    staff,
  ).expect(200);
  expect(scan.body.found).toBe(true);
  expect(scan.body.contract.id).toBe(c.id);
  await http(
    'get',
    '/repair-tickets/warranty-lookup?contractNumber=' + foreign.contractNumber,
    undefined,
    staff,
  ).expect(404);
  const t = await ticket({ contractId: c.id }, owner);
  const detail = await http('get', '/repair-tickets/' + t.id, undefined, staff).expect(200);
  expect(Object.keys(detail.body.contract).sort()).toEqual(
    ['contractNumber', 'deviceReceivedAt', 'id', 'shopWarrantyEndDate', 'status'].sort(),
  );
  const noContract = await user();
  await grant(noContract, ['repair-tickets.read'], [branchA]);
  const hidden = await http('get', '/repair-tickets/' + t.id, undefined, noContract).expect(200);
  expect(hidden.body.contractId).toBeNull();
  expect(hidden.body.contract).toBeNull();
});
it.each(['contract', 'repair'] as const)(
  'uses genuine %s-only customer evidence without granting Contract history',
  async (kind) => {
    const c = await db.customer.create({
      data: { name: 'Origin only ' + randomUUID(), phone: '0800000002', nationalId: randomUUID() },
    });
    let sourceId: string;
    if (kind === 'contract') {
      const source = await contract();
      sourceId = source.id;
      await db.contract.update({ where: { id: source.id }, data: { customerId: c.id } });
    } else {
      sourceId = (
        await db.repairTicket.create({
          data: {
            ticketNumber: 'HIST-' + randomUUID(),
            customerId: c.id,
            branchId: branchA,
            createdById: actor,
            defectDescription: 'Historical walk in',
            payer: 'CUSTOMER',
          },
        })
      ).id;
    }
    const staff = await user();
    await grant(
      staff,
      ['repair-tickets.read', 'repair-tickets.create', 'customers.read'],
      [branchA],
    );
    const noParty = await user();
    await grant(noParty, ['repair-tickets.read', 'repair-tickets.create'], [branchA]);
    const foreign = await user();
    await grant(foreign, ['repair-tickets.read', 'repair-tickets.create'], [branchA]);
    await grant(foreign, ['customers.read'], [branchB]);
    await http(
      'get',
      '/repair-tickets/warranty-preview?customerId=' + c.id,
      undefined,
      staff,
    ).expect(200);
    const view = await http(
      'get',
      '/repair-tickets/warranty-lookup?customerId=' + c.id,
      undefined,
      staff,
    ).expect(200);
    expect(view.body.customer.id).toBe(c.id);
    expect(view.body.devices).toEqual([]);
    expect(JSON.stringify(view.body)).not.toMatch(/nationalId|contractNumber|financedAmount/);
    for (const id of [noParty, foreign])
      await http(
        'get',
        '/repair-tickets/warranty-preview?customerId=' + c.id,
        undefined,
        id,
      ).expect(403);
    if (kind === 'contract')
      await db.contract.update({ where: { id: sourceId }, data: { deletedAt: new Date() } });
    else await db.repairTicket.update({ where: { id: sourceId }, data: { deletedAt: new Date() } });
    await http(
      'get',
      '/repair-tickets/warranty-preview?customerId=' + c.id,
      undefined,
      staff,
    ).expect(403);
    if (kind === 'contract')
      await db.contract.update({ where: { id: sourceId }, data: { deletedAt: null } });
    else await db.repairTicket.update({ where: { id: sourceId }, data: { deletedAt: null } });
    const created = await ticket({ customerId: c.id }, staff);
    expect(created.customerId).toBe(c.id);
    const found = await http(
      'get',
      '/repair-tickets?q=' + encodeURIComponent(c.name),
      undefined,
      staff,
    ).expect(200);
    expect(found.body.data.some((t: { id: string }) => t.id === created.id)).toBe(true);
    const hidden = await http(
      'get',
      '/repair-tickets?q=' + encodeURIComponent(c.name),
      undefined,
      noParty,
    ).expect(200);
    expect(hidden.body.total).toBe(0);
  },
);
