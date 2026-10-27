import {
  AFTER_SALES_ACTION_ROUTES,
  AccessAfterSalesActionBoundaries,
} from './access-after-sales-action-boundaries';
import { ExpenseDocumentCreateService } from '../expense-documents/services/expense-document-create.service';
import { LineAggregatorService } from '../expense-documents/services/line-aggregator.service';
import { DocNumberService as ExpenseNumber } from '../expense-documents/services/doc-number.service';
import { DocNumberService as IncomeNumber } from '../other-income/services/doc-number.service';
import { ADJUSTMENT_ALLOWLIST } from '../expense-documents/expense-validators.util';
import { currentDomainAccess } from './access-execution-context';
import { AccessRepairSourceService } from './access-repair-source.service';
import { AccessRepairProjectionService } from './access-repair-projection.service';
import { AccessTradeInProjectionService } from './access-trade-in-projection.service';
import { AccessProcurementSourceService } from './access-procurement-source.service';
import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
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
import { RepairTicketsService } from '../repair-tickets/repair-tickets.service';
import { RepairTicketDocNumberService } from '../repair-tickets/services/doc-number.service';
import { AuditService } from '../audit/audit.service';
import { ExpenseDocumentsService } from '../expense-documents/expense-documents.service';
import { OtherIncomeService } from '../other-income/other-income.service';
import { SettingsService } from '../settings/settings.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BranchGuard } from '../auth/guards/branch.guard';
import { AfterSalesController } from '../after-sales/after-sales.controller';
import { AfterSalesService } from '../after-sales/after-sales.service';
import { AfterSalesRepairService } from '../after-sales/services/after-sales-repair.service';
import { AfterSalesQueryService } from '../after-sales/services/after-sales-query.service';
import { AfterSalesDocumentService } from '../after-sales/services/after-sales-document.service';
const url = process.env.EMPLOYEE_ACCESS_TEST_DATABASE_URL;
if (
  !url?.includes('/bc_access_task2?host=/tmp/bc-access-aftersales-actions.') ||
  process.env.DATABASE_URL !== url ||
  process.env.DATABASE_URL_FINANCE !== url
)
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
let proxy: AfterSalesRepairService;
const imageBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
const storage = {
  upload: jest.fn(async (_key: string, _buffer: Buffer, _mime: string) => undefined),
  delete: jest.fn(async (_key: string) => undefined),
};
const line = { notifyMoment: jest.fn(async () => undefined) };
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
    controllers: [AfterSalesController],
    providers: [
      AccessAfterSalesActionBoundaries,
      {
        provide: AfterSalesService,
        useFactory: (repair: RepairTicketsService, audit: AuditService) => {
          proxy = new AfterSalesRepairService(
            db as PrismaService,
            storage as never,
            repair,
            new AfterSalesQueryService(db as PrismaService),
            audit,
            line as never,
          );
          return new AfterSalesService({} as never, {} as never, {} as never, proxy, {} as never);
        },
        inject: [RepairTicketsService, AuditService],
      },
      { provide: AfterSalesDocumentService, useValue: {} },
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
async function fixture(
  status: 'OPEN' | 'IN_PROGRESS' | 'READY_FOR_PICKUP' = 'OPEN',
  payer: 'SHOP' | 'CUSTOMER' = 'SHOP',
) {
  const ticket = await db.repairTicket.create({
    data: {
      ticketNumber: randomUUID(),
      customerId,
      branchId: branchA,
      deviceBrand: 'Test',
      deviceModel: 'Test',
      defectDescription: 'Screen',
      warrantyStatus: 'WALK_IN',
      payer,
      status,
      actualCost: '9347.25',
      estimatedCost: '999.25',
      estimatedCostPayer: 'SHOP',
      repairSupplierId: supplierId,
      createdById: actor,
    },
  });
  const row = await db.afterSalesCase.create({
    data: {
      caseNumber: randomUUID(),
      branchId: branchA,
      customerId,
      source: 'WALK_IN',
      repairTicketId: ticket.id,
      deviceBrand: 'Test',
      deviceModel: 'Test',
      symptom: 'Screen',
      warrantySnapshot: {},
      outcome: 'REPAIR',
      receivedById: actor,
    },
  });
  return { row, ticket };
}
it('allows six actual repair/photo HTTP operations and denies no grants', async () => {
  const entries = [
    ['repair/send', 'OPEN', { repairSupplierId: supplierId }],
    ['repair/mark-repaired', 'IN_PROGRESS', { actualCost: 9347.25, payer: 'CUSTOMER' }],
    ['repair/send-back', 'READY_FOR_PICKUP', { note: 'QC failed' }],
    ['repair/return', 'READY_FOR_PICKUP', {}],
    ['cancel', 'OPEN', { reason: 'Customer cancels' }],
    ['photos', 'OPEN', {}],
  ] as const;
  for (const [suffix, status, body] of entries) {
    const f = await fixture(status);
    const path = `/after-sales/${f.row.id}/${suffix}`;
    const call = (id: string) =>
      suffix === 'photos'
        ? http('post', path, undefined, id).attach('file', imageBytes, {
            filename: 'test.jpg',
            contentType: 'image/jpeg',
          })
        : http('post', path, body, id);
    expect((await call(denied)).status).toBe(403);
    const response = await call(actor);
    expect({
      suffix,
      status: response.status,
      error: response.status >= 300 ? response.body : undefined,
    }).toEqual({ suffix, status: 201, error: undefined });
    expect(Object.keys(response.body).sort()).toEqual(
      (suffix === 'photos' ? ['photoCount', 'stage'] : ['id', 'stage']).sort(),
    );
  }
  expect([...successes.keys()].sort()).toEqual([...AFTER_SALES_ACTION_ROUTES].sort());
});

const actionPermissions: PermissionKey[] = [
  'after-sales.update',
  'after-sales.create',
  'repair-tickets.update',
  'customers.read',
  'suppliers.read',
];
async function worker(permissions = actionPermissions, branches = [branchA]) {
  const id = await user();
  await grant(id, permissions, branches);
  return id;
}
function photo(id: string, userId = actor, bytes = imageBytes) {
  return http('post', `/after-sales/${id}/photos`, undefined, userId).attach('file', bytes, {
    filename: 'test.jpg',
    contentType: 'image/jpeg',
  });
}
it('supports action-only callers with narrow persisted acknowledgements and real customer-charge drafts', async () => {
  const staff = await worker();
  await db.user.update({ where: { id: staff }, data: { role: 'SALES', branchId: null } });
  const f = await fixture('READY_FOR_PICKUP', 'CUSTOMER');
  const response = await http('post', `/after-sales/${f.row.id}/repair/return`, {}, staff).expect(
    201,
  );
  expect(response.body).toEqual({ id: f.row.id, stage: 'CLOSED' });
  const ticket = await db.repairTicket.findUniqueOrThrow({ where: { id: f.ticket.id } });
  const income = await db.otherIncome.findUniqueOrThrow({ where: { id: ticket.otherIncomeId! } });
  expect(income.totalAmount.toString()).toBe('9347.25');
  expect(income.status).toBe('DRAFT');
  expect(
    await db.auditLog.count({
      where: { entityId: f.ticket.id, action: 'REPAIR_TICKET_RETURNED', userId: staff },
    }),
  ).toBe(1);
  const p = await fixture();
  expect((await photo(p.row.id, staff).expect(201)).body).toEqual({
    photoCount: 1,
    stage: p.row.stage,
  });
});
it('requires independent child action, original tuples and real linked source identity', async () => {
  const f = await fixture();
  const afterOnly = await worker(['after-sales.update']);
  await http(
    'post',
    `/after-sales/${f.row.id}/repair/mark-repaired`,
    { payer: 'SHOP', actualCost: 1 },
    afterOnly,
  ).expect(403);
  const mixed = await worker(['after-sales.read'], [branchA]);
  await grant(mixed, actionPermissions, [branchB]);
  await http(
    'post',
    `/after-sales/${f.row.id}/repair/mark-repaired`,
    { payer: 'SHOP', actualCost: 1 },
    mixed,
  ).expect(403);
  const childForeign = await fixture();
  await db.repairTicket.update({
    where: { id: childForeign.ticket.id },
    data: { branchId: branchB },
  });
  await http('post', `/after-sales/${childForeign.row.id}/repair/mark-repaired`, {
    payer: 'SHOP',
    actualCost: 1,
  }).expect(403);
  const mismatch = await fixture();
  const other = await db.customer.create({
    data: { name: 'Other', phone: '0800000000', nationalId: randomUUID() },
  });
  await db.repairTicket.update({
    where: { id: mismatch.ticket.id },
    data: { customerId: other.id },
  });
  await http('post', `/after-sales/${mismatch.row.id}/repair/mark-repaired`, {
    payer: 'SHOP',
    actualCost: 1,
  }).expect(403);
  expect((await db.repairTicket.findUniqueOrThrow({ where: { id: f.ticket.id } })).status).toBe(
    'OPEN',
  );
});
it.each(['SHOP', 'CUSTOMER'] as const)(
  'rolls back actual %s draft, status, case events and audit on late outer failure',
  async (payer) => {
    const f = await fixture('READY_FOR_PICKUP', payer);
    const before = {
      expense: await db.expenseDocument.count(),
      income: await db.otherIncome.count(),
      audit: await db.auditLog.count(),
      todo: await db.todo.count(),
    };
    const engine = app.get(AccessResourceService),
      original = engine.execute.bind(engine);
    const spy = jest.spyOn(engine, 'execute').mockImplementation(async (...args) => {
      const handler = args[4];
      args[4] = async () => {
        await handler();
        throw new Error('late outer failure');
      };
      return original(...args);
    });
    line.notifyMoment.mockClear();
    try {
      await http('post', `/after-sales/${f.row.id}/repair/return`, {}).expect(500);
    } finally {
      spy.mockRestore();
    }
    const row = await db.repairTicket.findUniqueOrThrow({ where: { id: f.ticket.id } });
    expect(row.status).toBe('READY_FOR_PICKUP');
    expect(row.expenseDocumentId).toBeNull();
    expect(row.otherIncomeId).toBeNull();
    expect(await db.expenseDocument.count()).toBe(before.expense);
    expect(await db.otherIncome.count()).toBe(before.income);
    expect(await db.auditLog.count()).toBe(before.audit);
    expect(await db.todo.count()).toBe(before.todo);
    expect(await db.repairStatusLog.count({ where: { ticketId: f.ticket.id } })).toBe(0);
    expect(await db.afterSalesEvent.count({ where: { caseId: f.row.id } })).toBe(0);
    expect((await db.afterSalesCase.findUniqueOrThrow({ where: { id: f.row.id } })).stage).toBe(
      f.row.stage,
    );
    expect(line.notifyMoment).not.toHaveBeenCalled();
  },
);
it('serializes concurrent closure to one real draft and sends only after the actual commit', async () => {
  const f = await fixture('READY_FOR_PICKUP');
  line.notifyMoment.mockClear();
  let deliveredAfterCommit = false;
  line.notifyMoment.mockImplementationOnce(async () => {
    expect(currentDomainAccess()).toBeUndefined();
    const row = await db.repairTicket.findUniqueOrThrow({ where: { id: f.ticket.id } });
    expect(row.status).toBe('CLOSED');
    expect(row.expenseDocumentId).not.toBeNull();
    expect((await db.afterSalesCase.findUniqueOrThrow({ where: { id: f.row.id } })).stage).toBe(
      'CLOSED',
    );
    deliveredAfterCommit = true;
  });
  const responses = await Promise.all([
    http('post', `/after-sales/${f.row.id}/repair/return`, {}),
    http('post', `/after-sales/${f.row.id}/repair/return`, {}),
  ]);
  expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
  expect(
    await db.repairStatusLog.count({ where: { ticketId: f.ticket.id, toStatus: 'CLOSED' } }),
  ).toBe(1);
  expect(
    await db.auditLog.count({ where: { entityId: f.ticket.id, action: 'REPAIR_TICKET_RETURNED' } }),
  ).toBe(1);
  const row = await db.repairTicket.findUniqueOrThrow({ where: { id: f.ticket.id } });
  const draft = await db.expenseDocument.findUniqueOrThrow({
    where: { id: row.expenseDocumentId! },
  });
  expect(draft.totalAmount.toString()).toBe('9347.25');
  expect(draft.status).toBe('DRAFT');
  expect(line.notifyMoment).toHaveBeenCalledTimes(1);
  expect(deliveredAfterCommit).toBe(true);
});
it('drops effects of a serialization attempt and notifies once after successful retry', async () => {
  const f = await fixture('IN_PROGRESS');
  const engine = app.get(AccessResourceService),
    original = engine.execute.bind(engine);
  let attempts = 0;
  const spy = jest.spyOn(engine, 'execute').mockImplementation(async (...args) => {
    const handler = args[4];
    args[4] = async () => {
      const result = await handler();
      if (++attempts === 1)
        throw new Prisma.PrismaClientKnownRequestError('retry', {
          code: 'P2034',
          clientVersion: 'test',
        });
      return result;
    };
    return original(...args);
  });
  line.notifyMoment.mockClear();
  try {
    await http('post', `/after-sales/${f.row.id}/repair/mark-repaired`, {
      payer: 'CUSTOMER',
      actualCost: 9347.25,
    }).expect(201);
  } finally {
    spy.mockRestore();
  }
  expect(attempts).toBe(2);
  expect(line.notifyMoment).toHaveBeenCalledTimes(1);
  expect(await db.repairStatusLog.count({ where: { ticketId: f.ticket.id } })).toBe(1);
  expect(await db.afterSalesEvent.count({ where: { caseId: f.row.id } })).toBe(1);
});
it('keeps bare cancellation nonfinancial, CAS once-only and rejects real hidden exchange children', async () => {
  const f = await fixture();
  await db.afterSalesCase.update({
    where: { id: f.row.id },
    data: { repairTicketId: null, outcome: 'SAME_MODEL_EXCHANGE' },
  });
  const staff = await worker(['after-sales.update']);
  const responses = await Promise.all([
    http('post', `/after-sales/${f.row.id}/cancel`, { reason: 'Customer canceled' }, staff),
    http('post', `/after-sales/${f.row.id}/cancel`, { reason: 'Customer canceled' }, staff),
  ]);
  expect(responses.map((r) => r.status).sort()).toEqual([201, 400]);
  expect(
    await db.auditLog.count({
      where: { entityId: f.row.id, action: 'AFTER_SALES_CASE_CANCELLED', userId: staff },
    }),
  ).toBe(1);
  const hidden = await fixture();
  await db.afterSalesCase.update({
    where: { id: hidden.row.id },
    data: { outcome: 'SAME_MODEL_EXCHANGE' },
  });
  await http(
    'post',
    `/after-sales/${hidden.row.id}/cancel`,
    { reason: 'Hidden child' },
    staff,
  ).expect(403);
  expect(
    (await db.repairTicket.findUniqueOrThrow({ where: { id: hidden.ticket.id } })).status,
  ).toBe('OPEN');
});
import { lockEmployeeAccess } from './access-snapshot.service';
import { domainAccessClient } from './access-execution-context';
import {
  loadAfterSalesActionCase,
  loadAfterSalesRepairBusiness,
} from './access-after-sales-action';
it.each(['revocation', 'demotion', 'source', 'child-source'] as const)(
  'rechecks current %s after a real advisory lock wait',
  async (mode) => {
    const staff = await worker();
    if (mode === 'demotion')
      await db.user.update({ where: { id: staff }, data: { role: 'OWNER' } });
    const f = await fixture();
    let release!: () => void, locked!: () => void;
    const held = new Promise<void>((r) => (locked = r)),
      unlock = new Promise<void>((r) => (release = r));
    const change = db.$transaction(
      async (tx) => {
        await lockEmployeeAccess(tx);
        if (mode === 'source')
          await tx.afterSalesCase.update({ where: { id: f.row.id }, data: { branchId: branchB } });
        else if (mode === 'child-source')
          await tx.repairTicket.update({ where: { id: f.ticket.id }, data: { branchId: branchB } });
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
      `/after-sales/${f.row.id}/repair/mark-repaired`,
      { payer: 'CUSTOMER', actualCost: 1 },
      staff,
    ).then((r) => r);
    try {
      for (let i = 0; i < 100; i++) {
        const [{ waiting }] = await db.$queryRaw<
          Array<{ waiting: boolean }>
        >`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event='advisory' AND datname=current_database()) AS waiting`;
        if (waiting) break;
        if (i === 99) throw new Error('No observed actual lock waiter');
        await new Promise((r) => setTimeout(r, 10));
      }
    } finally {
      release();
    }
    await change;
    expect((await pending).status).toBe(403);
    expect((await db.repairTicket.findUniqueOrThrow({ where: { id: f.ticket.id } })).status).toBe(
      'OPEN',
    );
    expect(await db.afterSalesEvent.count({ where: { caseId: f.row.id } })).toBe(0);
  },
);
it('rejects raw managed no-execution, wrong-client, wrong-action and stale business inputs', async () => {
  const f = await fixture(),
    engine = app.get(AccessResourceService);
  const actorRow = await db.user.findUniqueOrThrow({ where: { id: actor } });
  await expect(proxy.send(f.row.id, { repairSupplierId: supplierId }, actorRow)).rejects.toThrow(
    'ต้องตรวจสิทธิ์',
  );
  await expect(
    loadAfterSalesActionCase(db as PrismaService, f.row.id, actor, 'after-sales.update'),
  ).rejects.toThrow();
  await engine.execute(
    actor,
    'after-sales.update',
    'SHOP',
    undefined,
    async () => {
      await expect(
        loadAfterSalesActionCase(db as PrismaService, f.row.id, actor, 'after-sales.update'),
      ).rejects.toThrow('ธุรกรรม');
      const client = domainAccessClient(db as PrismaService);
      await expect(
        loadAfterSalesActionCase(client, f.row.id, actor, 'after-sales.create'),
      ).rejects.toThrow('การกระทำ');
      const row = await loadAfterSalesActionCase(client, f.row.id, actor, 'after-sales.update');
      await expect(loadAfterSalesRepairBusiness({ ...row })).rejects.toThrow('ธุรกรรม');
      await currentDomainAccess()!.client.afterSalesCase.update({
        where: { id: f.row.id },
        data: { repairTicketId: null },
      });
      await expect(loadAfterSalesRepairBusiness(row)).rejects.toThrow('อ่านแหล่งเคสใหม่');
    },
    false,
    { isolationLevel: 'Serializable' },
  );
});
it('validates and preauthorizes photo before upload, including full capacity', async () => {
  const f = await fixture();
  storage.upload.mockClear();
  storage.delete.mockClear();
  await photo(f.row.id, denied).expect(403);
  await photo(f.row.id, actor, Buffer.from('invalid')).expect(400);
  await db.afterSalesCase.update({
    where: { id: f.row.id },
    data: { photoKeys: Array.from({ length: 6 }, (_, i) => `existing-${i}`) },
  });
  await photo(f.row.id).expect(400);
  expect(storage.upload).not.toHaveBeenCalled();
  expect(storage.delete).not.toHaveBeenCalled();
});
it.each(['permission', 'source', 'capacity'] as const)(
  'stages outside the lock and cleans only its new photo after %s changes',
  async (mode) => {
    const f = await fixture(),
      staff = await worker();
    const oldKeys = ['preexisting'];
    await db.afterSalesCase.update({ where: { id: f.row.id }, data: { photoKeys: oldKeys } });
    storage.upload.mockClear();
    storage.delete.mockClear();
    let outside = false;
    storage.upload.mockImplementationOnce(async () => {
      outside = !currentDomainAccess();
      await db.$transaction(
        async (tx) => {
          await lockEmployeeAccess(tx); // would deadlock if upload retained the global lock
          if (mode === 'permission') {
            const assignments = await tx.employeeAccessAssignment.findMany({
              where: { userId: staff },
            });
            await tx.accessPosition.updateMany({
              where: { id: { in: assignments.map((a) => a.positionId) } },
              data: { permissions: [] },
            });
          } else if (mode === 'source')
            await tx.afterSalesCase.update({
              where: { id: f.row.id },
              data: { branchId: branchB },
            });
          else
            await tx.afterSalesCase.update({
              where: { id: f.row.id },
              data: {
                photoKeys: [...oldKeys, ...Array.from({ length: 5 }, (_, i) => `concurrent-${i}`)],
              },
            });
        },
        { timeout: 5000 },
      );
    });
    await photo(f.row.id, staff).expect(mode === 'capacity' ? 400 : 403);
    expect(outside).toBe(true);
    expect(storage.upload).toHaveBeenCalledTimes(1);
    const key = storage.upload.mock.calls[0][0];
    expect(storage.delete).toHaveBeenCalledTimes(1);
    expect(storage.delete).toHaveBeenCalledWith(key);
    const keys = (await db.afterSalesCase.findUniqueOrThrow({ where: { id: f.row.id } })).photoKeys;
    expect(keys).toContain(oldKeys[0]);
    expect(keys).not.toContain(key);
  },
);
it('stages a photo once across a real rolled-back attempt and retains only committed ownership', async () => {
  const f = await fixture();
  const engine = app.get(AccessResourceService),
    original = engine.execute.bind(engine);
  let writeAttempts = 0;
  const spy = jest.spyOn(engine, 'execute').mockImplementation(async (...args) => {
    const handler = args[4];
    args[4] = async () => {
      const result = await handler();
      if (result && ++writeAttempts === 1)
        throw new Prisma.PrismaClientKnownRequestError('retry', {
          code: 'P2034',
          clientVersion: 'test',
        });
      return result;
    };
    return original(...args);
  });
  storage.upload.mockClear();
  storage.delete.mockClear();
  try {
    await photo(f.row.id).expect(201);
  } finally {
    spy.mockRestore();
  }
  expect(writeAttempts).toBe(2);
  expect(storage.upload).toHaveBeenCalledTimes(1);
  expect(storage.delete).not.toHaveBeenCalled();
  const row = await db.afterSalesCase.findUniqueOrThrow({ where: { id: f.row.id } });
  expect(row.photoKeys).toEqual([storage.upload.mock.calls[0][0]]);
  expect(await db.afterSalesEvent.count({ where: { caseId: f.row.id, kind: 'PHOTO_ADDED' } })).toBe(
    1,
  );
});
it('rolls back bare cancellation when its required durable audit fails', async () => {
  const f = await fixture();
  await db.afterSalesCase.update({
    where: { id: f.row.id },
    data: { repairTicketId: null, outcome: 'PRICED_EXCHANGE' },
  });
  const audit = app.get(AuditService),
    original = audit.log.bind(audit);
  const spy = jest.spyOn(audit, 'log').mockImplementation(async (entry, tx) => {
    await original(entry, tx);
    if (entry.action === 'AFTER_SALES_CASE_CANCELLED') throw new Error('required audit failed');
  });
  try {
    await http('post', `/after-sales/${f.row.id}/cancel`, { reason: 'Customer canceled' }).expect(
      500,
    );
  } finally {
    spy.mockRestore();
  }
  const row = await db.afterSalesCase.findUniqueOrThrow({ where: { id: f.row.id } });
  expect(row.cancelledAt).toBeNull();
  expect(row.stage).toBe(f.row.stage);
  expect(await db.afterSalesEvent.count({ where: { caseId: f.row.id } })).toBe(0);
  expect(await db.auditLog.count({ where: { entityId: f.row.id } })).toBe(0);
});

it('rejects a bare cancellation when a real replacement contract exists without exposing it', async () => {
  const f = await fixture();
  const product = await db.product.create({
    data: {
      name: 'Replacement',
      brand: 'Test',
      model: 'Model',
      category: 'PHONE_USED',
      costPrice: 5000,
      branchId: branchA,
      ownedByCompanyId: shopId,
      status: 'SOLD_INSTALLMENT',
    },
  });
  const contract = await db.contract.create({
    data: {
      contractNumber: randomUUID(),
      customerId,
      productId: product.id,
      branchId: branchA,
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
    },
  });
  await db.afterSalesCase.update({
    where: { id: f.row.id },
    data: {
      outcome: 'SAME_MODEL_EXCHANGE',
      repairTicketId: null,
      replacementContractId: contract.id,
    },
  });
  const staff = await worker(['after-sales.update']);
  const response = await http(
    'post',
    `/after-sales/${f.row.id}/cancel`,
    { reason: 'Customer canceled' },
    staff,
  ).expect(400);
  expect(JSON.stringify(response.body)).not.toContain(contract.id);
  expect(
    (await db.afterSalesCase.findUniqueOrThrow({ where: { id: f.row.id } })).cancelledAt,
  ).toBeNull();
});
it('authorizes the actual supplied supplier and rejects finance-context or assigned-only case actions', async () => {
  const f = await fixture();
  const supplier = await db.supplier.create({
    data: {
      name: 'Foreign supplier',
      phone: '0800000000',
      isRepairCenter: true,
      accessCompanyCode: 'SHOP',
      accessBranchId: branchB,
    },
  });
  await http('post', `/after-sales/${f.row.id}/repair/send`, {
    repairSupplierId: supplier.id,
  }).expect(403);
  await http('post', `/after-sales/${f.row.id}/repair/send?company=FINANCE`, {
    repairSupplierId: supplierId,
  }).expect(403);
  const staff = await user();
  const position = await db.accessPosition.create({
    data: { code: randomUUID(), name: 'Assigned only', permissions: actionPermissions },
  });
  await db.employeeAccessAssignment.create({
    data: { userId: staff, positionId: position.id, companyCode: 'SHOP', scope: 'ASSIGNED' },
  });
  await http(
    'post',
    `/after-sales/${f.row.id}/repair/send`,
    { repairSupplierId: supplierId },
    staff,
  ).expect(403);
  expect((await db.repairTicket.findUniqueOrThrow({ where: { id: f.ticket.id } })).status).toBe(
    'OPEN',
  );
});
it('does not replay committed repair work when notification delivery fails', async () => {
  const f = await fixture('IN_PROGRESS');
  line.notifyMoment.mockClear();
  line.notifyMoment.mockRejectedValueOnce(new Error('transport unavailable'));
  await http('post', `/after-sales/${f.row.id}/repair/mark-repaired`, {
    payer: 'CUSTOMER',
    actualCost: 9347.25,
  }).expect(201);
  expect(line.notifyMoment).toHaveBeenCalledTimes(1);
  expect(await db.repairStatusLog.count({ where: { ticketId: f.ticket.id } })).toBe(1);
  expect((await db.repairTicket.findUniqueOrThrow({ where: { id: f.ticket.id } })).status).toBe(
    'READY_FOR_PICKUP',
  );
});
it('cleans only the owned staged key after a late database failure', async () => {
  const f = await fixture();
  await db.afterSalesCase.update({ where: { id: f.row.id }, data: { photoKeys: ['old-key'] } });
  const engine = app.get(AccessResourceService),
    original = engine.execute.bind(engine);
  const spy = jest.spyOn(engine, 'execute').mockImplementation(async (...args) => {
    const handler = args[4];
    args[4] = async () => {
      const result = await handler();
      if (result) throw new Error('late photo failure');
      return result;
    };
    return original(...args);
  });
  storage.upload.mockClear();
  storage.delete.mockClear();
  try {
    await photo(f.row.id).expect(500);
  } finally {
    spy.mockRestore();
  }
  expect(storage.upload).toHaveBeenCalledTimes(1);
  expect(storage.delete).toHaveBeenCalledWith(storage.upload.mock.calls[0][0]);
  expect(storage.delete).toHaveBeenCalledTimes(1);
  expect(
    (await db.afterSalesCase.findUniqueOrThrow({ where: { id: f.row.id } })).photoKeys,
  ).toEqual(['old-key']);
  expect(await db.afterSalesEvent.count({ where: { caseId: f.row.id } })).toBe(0);
});
