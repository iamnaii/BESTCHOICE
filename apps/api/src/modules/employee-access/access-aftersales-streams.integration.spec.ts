import { AccessAfterSalesQueryService } from './access-after-sales-query.service';
import { AccessAfterSalesBoundaries } from './access-after-sales-boundaries';
import { AccessAfterSalesActionBoundaries } from './access-after-sales-action-boundaries';
import { AccessRepairBoundaries } from './access-repair-boundaries';
import { AccessAfterSalesStreams } from './access-after-sales-streams';
import {
  AccessAfterSalesStreamBoundaries,
  AFTER_SALES_STREAM_ROUTES,
} from './access-after-sales-stream-boundaries';
import { Readable } from 'node:stream';
import { AfterSalesRepairService } from '../after-sales/services/after-sales-repair.service';
import { AccessAfterSalesSourceService } from './access-after-sales-source.service';
import { AccessAfterSalesProjectionService } from './access-after-sales-projection.service';
import { AccessRepairProjectionService } from './access-repair-projection.service';
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
import { AccessRepairSourceService } from './access-repair-source.service';
import { AccessTradeInProjectionService } from './access-trade-in-projection.service';
import { AccessProcurementSourceService } from './access-procurement-source.service';
import { AccessExchangeSourceService } from './access-exchange-source.service';
import { AfterSalesController } from '../after-sales/after-sales.controller';
import { AfterSalesService } from '../after-sales/after-sales.service';
import { AfterSalesQueryService } from '../after-sales/services/after-sales-query.service';
import { AfterSalesDocumentService } from '../after-sales/services/after-sales-document.service';
import { AuditService } from '../audit/audit.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BranchGuard } from '../auth/guards/branch.guard';
const url = process.env.EMPLOYEE_ACCESS_TEST_DATABASE_URL;
if (
  !url?.includes('/bc_access_task2?host=/tmp/bc-access-aftersales-streams.') ||
  process.env.DATABASE_URL !== url ||
  process.env.DATABASE_URL_FINANCE !== url ||
  process.env.FINANCE_DATABASE_URL !== url
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
const afterSources = new AccessAfterSalesSourceService(resources, repairSources, exchangeSources);
const afterProjection = new AccessAfterSalesProjectionService(
  afterSources,
  new AccessRepairProjectionService(resources, repairSources),
);
const query = new AfterSalesQueryService(db as PrismaService);
const storage = {
  getStream: jest.fn(async (_key: string) => Readable.from(Buffer.from('PROTECTED-PHOTO'))),
  delete: jest.fn(),
  upload: jest.fn(),
};
const renderer = { htmlToPdf: jest.fn(async (_html: string) => Buffer.from('%PDF-PROTECTED')) };
const streams = new AccessAfterSalesStreams(
  db as PrismaService,
  resources,
  afterSources,
  repairSources,
);
const docs = new AfterSalesDocumentService(
  db as PrismaService,
  storage as never,
  query,
  renderer as never,
  streams,
);
const repair = new AfterSalesRepairService(
  db as PrismaService,
  storage as never,
  {} as never,
  query,
  audit,
  {} as never,
  streams,
);
const facade = new AfterSalesService({} as never, {} as never, query, repair, {} as never);
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
      status: 'READY_FOR_PICKUP',
      payer: 'SHOP',
      estimatedCost: 9347.25,
      estimatedCostPayer: 'SHOP',
      createdById: actor,
    },
  });
  const row = await db.afterSalesCase.create({
    data: {
      caseNumber: id,
      photoKeys: [`after-sales/${id}/intake-fixture.jpg`],
      purchasePhotoKeys: [`after-sales/${id}/purchase-front.jpg`],
      id,
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
      { provide: AfterSalesDocumentService, useValue: docs },
      { provide: PrismaService, useValue: db },
      { provide: AccessSnapshotService, useValue: snapshots },

      { provide: AccessResourceService, useValue: resources },
      AccessAfterSalesStreamBoundaries,
      AccessAfterSalesBoundaries,
      AccessAfterSalesActionBoundaries,
      AccessRepairBoundaries,
      {
        provide: AccessAfterSalesQueryService,
        useValue: new AccessAfterSalesQueryService(afterSources, afterProjection),
      },
      { provide: AccessRepairSourceService, useValue: repairSources },
      {
        provide: AccessRepairProjectionService,
        useValue: new AccessRepairProjectionService(resources, repairSources),
      },
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

beforeEach(() => {
  storage.getStream.mockClear();
  renderer.htmlToPdf.mockClear();
});
const routes = [
  ['photo', 'photos/0'],
  ['purchasePhoto', 'purchase-photos/front'],
  ['receiptPdf', 'receipt.pdf'],
  ['handoverPdf', 'handover.pdf'],
] as const;
it.each(routes)(
  'actual %s HTTP permits authorized source and denies persisted no-grants',
  async (_method, suffix) => {
    const f = await fixture();
    const path = `/after-sales/${f.row.id}/${suffix}`;
    await http(path).expect(200);
    storage.getStream.mockClear();
    renderer.htmlToPdf.mockClear();
    const deniedResponse = await http(path, denied).expect(403);
    expect(JSON.stringify(deniedResponse.body)).not.toContain(f.row.id);
    expect(storage.getStream).not.toHaveBeenCalled();
    expect(renderer.htmlToPdf).not.toHaveBeenCalled();
  },
);

const allPermissions = PERMISSION_CATALOG.filter((p) => !p.ownerOnly).map((p) => p.key);
async function reader(without: PermissionKey[] = []) {
  const id = await user();
  for (const company of ['SHOP', 'FINANCE'] as const)
    await grant(
      id,
      allPermissions.filter((p) => !without.includes(p)),
      company,
    );
  return id;
}
it('registers precisely four streams alongside the existing 20 consumers and repair 15', () => {
  expect(AFTER_SALES_STREAM_ROUTES).toEqual(
    routes.map(([method]) => `AfterSalesController.${method}`),
  );
  expect(
    new Set([
      ...AFTER_SALES_READ_ROUTES,
      ...AFTER_SALES_ACTION_ROUTES,
      ...AFTER_SALES_EXCHANGE_ACTION_ROUTES,
      ...AFTER_SALES_INTAKE_ROUTES,
      ...AFTER_SALES_STREAM_ROUTES,
    ]).size,
  ).toBe(24);
  expect(REPAIR_BOUNDARY_ROUTES).toHaveLength(15);
  const registered = [
    ...AFTER_SALES_READ_ROUTES,
    ...AFTER_SALES_ACTION_ROUTES,
    ...AFTER_SALES_EXCHANGE_ACTION_ROUTES,
    ...AFTER_SALES_INTAKE_ROUTES,
    ...AFTER_SALES_STREAM_ROUTES,
    ...REPAIR_BOUNDARY_ROUTES,
  ];
  expect(registered).toHaveLength(39);
  expect(registered.every((route) => ACCESS_BOUNDARIES.has(route))).toBe(true);
  expect(
    Object.keys(ACCESS_POLICIES)
      .filter(
        (route) =>
          route.startsWith('AfterSalesController.') || route.startsWith('RepairTicketsController.'),
      )
      .sort(),
  ).toEqual([...registered].sort());
});
it.each(routes)(
  '%s independently requires documents.read before storage or rendering',
  async (_method, suffix) => {
    const f = await fixture();
    const staff = await reader(['documents.read']);
    await http(`/after-sales/${f.row.id}/${suffix}`, staff).expect(403);
    expect(storage.getStream).not.toHaveBeenCalled();
    expect(renderer.htmlToPdf).not.toHaveBeenCalled();
  },
);
it.each(['receipt.pdf', 'handover.pdf'])(
  '%s independently requires domain export',
  async (suffix) => {
    const f = await fixture();
    for (const permission of ['after-sales.export'] as const) {
      const staff = await reader([permission]);
      await http(`/after-sales/${f.row.id}/${suffix}`, staff).expect(403);
    }
    expect(storage.getStream).not.toHaveBeenCalled();
    expect(renderer.htmlToPdf).not.toHaveBeenCalled();
  },
);
it.each(['customers.read', 'contracts.read', 'products.read', 'repair-tickets.read'] as const)(
  'fresh document loads independently require %s',
  async (permission) => {
    const f = await fixture();
    const staff = await reader([permission]);
    for (const suffix of ['receipt.pdf', 'handover.pdf'])
      await http(`/after-sales/${f.row.id}/${suffix}`, staff).expect(403);
    expect(storage.getStream).not.toHaveBeenCalled();
    expect(renderer.htmlToPdf).not.toHaveBeenCalled();
  },
);
it('authorizes an actual fresh Sale and rejects substituted contract/customer/replacement identities', async () => {
  const f = await fixture(),
    other = await fixture();
  const sale = await db.sale.findFirstOrThrow({ where: { contractId: f.contract.id } });
  await db.afterSalesCase.update({ where: { id: f.row.id }, data: { saleId: sale.id } });
  const staff = await reader(['sales.read']);
  await http(`/after-sales/${f.row.id}/receipt.pdf`, staff).expect(403);
  await http(`/after-sales/${f.row.id}/receipt.pdf`).expect(200);
  for (const data of [
    { contractId: other.contract.id },
    { customerId: other.customer.id },
    { replacementContractId: other.contract.id, replacementProductId: other.product.id },
  ]) {
    await db.afterSalesCase.update({ where: { id: f.row.id }, data });
    storage.getStream.mockClear();
    renderer.htmlToPdf.mockClear();
    await http(`/after-sales/${f.row.id}/receipt.pdf`).expect(403);
    expect(storage.getStream).not.toHaveBeenCalled();
    expect(renderer.htmlToPdf).not.toHaveBeenCalled();
    await db.afterSalesCase.update({
      where: { id: f.row.id },
      data: {
        contractId: f.contract.id,
        customerId: f.customer.id,
        replacementContractId: null,
        replacementProductId: null,
      },
    });
  }
});
it.each([null, 'SHOP', 'CUSTOMER'] as const)(
  'customer renderer input honors estimate provenance %s even for owner',
  async (provenance) => {
    const f = await fixture();
    const owner = await user();
    await db.user.update({ where: { id: owner }, data: { role: 'OWNER' } });
    await db.repairTicket.update({
      where: { id: f.ticket.id },
      data: {
        payer: 'CUSTOMER',
        estimatedCostPayer: provenance,
        estimatedCost: 9347.25,
        actualCost: 555,
        notes: 'SECRET-INTERNAL-COST',
      },
    });
    const sources: unknown[] = [];
    const original = docs['loadSource'].bind(docs);
    const capture = jest
      .spyOn(docs as unknown as { loadSource: typeof original }, 'loadSource')
      .mockImplementation(async (...args) => {
        const source = await original(...args);
        sources.push(source);
        return source;
      });
    try {
      await http(`/after-sales/${f.row.id}/receipt.pdf`, owner).expect(200);
      await http(`/after-sales/${f.row.id}/handover.pdf`, owner).expect(200);
    } finally {
      capture.mockRestore();
    }
    for (const source of sources) {
      expect(source).toMatchObject({
        repair: { estimatedCost: provenance === 'CUSTOMER' ? '9347.25' : null, actualCost: '555' },
      });
      expect(JSON.stringify(source)).not.toContain('SECRET-INTERNAL');
      if (provenance !== 'CUSTOMER') expect(JSON.stringify(source)).not.toContain('9347.25');
    }
    expect(renderer.htmlToPdf.mock.calls[0][0].includes('9,347.25')).toBe(
      provenance === 'CUSTOMER',
    );
    expect(renderer.htmlToPdf.mock.calls[1][0]).toContain('555.00');
    expect(renderer.htmlToPdf.mock.calls[0][0]).not.toContain('SECRET-LINE');
  },
);
it('customer charges remain available without staff cost rights and unknown prices are not zero', async () => {
  const f = await fixture();
  const staff = await reader(['sensitive.cost.read']);
  await db.repairTicket.update({
    where: { id: f.ticket.id },
    data: { payer: 'CUSTOMER', estimatedCostPayer: 'CUSTOMER', actualCost: null },
  });
  await http(`/after-sales/${f.row.id}/receipt.pdf`, staff).expect(200);
  expect(renderer.htmlToPdf.mock.calls.at(-1)![0]).toContain('9,347.25');
  await db.repairTicket.update({ where: { id: f.ticket.id }, data: { estimatedCostPayer: null } });
  await http(`/after-sales/${f.row.id}/handover.pdf`, staff).expect(200);
  expect(renderer.htmlToPdf.mock.calls.at(-1)![0]).toContain('สอบถามค่าซ่อมที่สาขา');
  expect(renderer.htmlToPdf.mock.calls.at(-1)![0]).not.toContain('9,347.25');
});
it('derives original signed receipt choice from authorized history, not redacted view notes', async () => {
  const f = await fixture();
  await db.afterSalesEvent.create({
    data: {
      caseId: f.row.id,
      kind: 'OUTCOME_SET',
      actorId: actor,
      note: SWITCHED_TO_REPAIR_NOTE + ' SECRET-REASON',
    },
  });
  await http(`/after-sales/${f.row.id}/receipt.pdf`).expect(200);
  expect(renderer.htmlToPdf.mock.calls.at(-1)![0]).toContain('เปลี่ยนรุ่นเดิม');
  expect(renderer.htmlToPdf.mock.calls.at(-1)![0]).not.toContain('SECRET-REASON');
  await http(`/after-sales/${f.row.id}/handover.pdf`).expect(200);
  expect(renderer.htmlToPdf.mock.calls.at(-1)![0]).toContain('ผลการซ่อม');
});
it('copied photos retain ORIGINAL Product source independently of replacement/current Contract', async () => {
  const f = await fixture(),
    other = await fixture(branchB);
  await db.contract.update({ where: { id: f.contract.id }, data: { productId: other.product.id } });
  await db.afterSalesCase.update({
    where: { id: f.row.id },
    data: { replacementProductId: other.product.id },
  });
  const staff = await user();
  await grant(staff, ['after-sales.read', 'documents.read']);
  await grant(staff, ['products.read', 'documents.read'], 'FINANCE', [branchB]);
  await http(`/after-sales/${f.row.id}/purchase-photos/front`, staff).expect(403);
  expect(storage.getStream).not.toHaveBeenCalled();
  await grant(staff, ['products.read', 'documents.read'], 'FINANCE');
  await http(`/after-sales/${f.row.id}/purchase-photos/front`, staff).expect(200);
  expect(storage.getStream).toHaveBeenCalledWith(f.row.purchasePhotoKeys[0]);
  await db.product.update({
    where: { id: f.product.id },
    data: { imeiSerial: 'changed-original' },
  });
  storage.getStream.mockClear();
  await http(`/after-sales/${f.row.id}/purchase-photos/front`, staff).expect(403);
  expect(storage.getStream).not.toHaveBeenCalled();
});
it('refuses caller path tricks, foreign persisted keys, copied-as-intake keys and unresolvable original identity including owner', async () => {
  const f = await fixture(),
    other = await fixture();
  const owner = await user();
  await db.user.update({ where: { id: owner }, data: { role: 'OWNER' } });
  for (const data of [{ photoKeys: other.row.photoKeys }, { photoKeys: f.row.purchasePhotoKeys }]) {
    await db.afterSalesCase.update({ where: { id: f.row.id }, data });
    await http(`/after-sales/${f.row.id}/photos/0`, owner).expect(403);
    await http(`/after-sales/${f.row.id}/receipt.pdf`, owner).expect(403);
  }
  await db.afterSalesCase.update({
    where: { id: f.row.id },
    data: { purchasePhotoKeys: other.row.purchasePhotoKeys },
  });
  await http(`/after-sales/${f.row.id}/purchase-photos/front`, owner).expect(404);
  await http(`/after-sales/${f.row.id}/purchase-photos/front%2F..`, owner).expect(400);
  await db.afterSalesCase.update({
    where: { id: f.row.id },
    data: { productId: null, purchasePhotoKeys: f.row.purchasePhotoKeys },
  });
  await http(`/after-sales/${f.row.id}/purchase-photos/front`, owner).expect(403);
  expect(storage.getStream).not.toHaveBeenCalled();
  expect(renderer.htmlToPdf).not.toHaveBeenCalled();
});
it('does not let original tuple/company/ASSIGNED grants expand to another case or source', async () => {
  const f = await fixture();
  const staff = await user();
  await grant(staff, ['after-sales.read', 'after-sales.export']);
  await grant(staff, ['documents.read', 'documents.export'], 'SHOP', [branchB]);
  await grant(staff, allPermissions, 'FINANCE');
  await http(`/after-sales/${f.row.id}/photos/0`, staff).expect(403);
  await http(`/after-sales/${f.row.id}/receipt.pdf`, staff).expect(403);
  await http(`/after-sales/${f.row.id}/photos/0?company=FINANCE`).expect(403);
  const position = await db.accessPosition.create({
    data: { code: randomUUID(), name: 'Assigned', permissions: allPermissions },
  });
  const assigned = await user();
  await db.employeeAccessAssignment.create({
    data: { userId: assigned, positionId: position.id, companyCode: 'SHOP', scope: 'ASSIGNED' },
  });
  await db.afterSalesCase.update({ where: { id: f.row.id }, data: { receivedById: assigned } });
  await http(`/after-sales/${f.row.id}/photos/0`, assigned).expect(403);
  expect(storage.getStream).not.toHaveBeenCalled();
  expect(renderer.htmlToPdf).not.toHaveBeenCalled();
});
it('records generation honestly with real initiator and no new paper-print event', async () => {
  const f = await fixture();
  await db.afterSalesEvent.create({
    data: { caseId: f.row.id, actorId: actor, kind: 'PRINTED', note: 'historical' },
  });
  for (const suffix of ['receipt.pdf', 'handover.pdf'])
    await http(`/after-sales/${f.row.id}/${suffix}`).expect(200);
  const logs = await db.auditLog.findMany({
    where: { entityId: f.row.id, action: 'AFTER_SALES_DOCUMENT_GENERATED' },
    orderBy: { createdAt: 'asc' },
  });
  expect(logs).toHaveLength(2);
  expect(logs.map((e) => e.userId)).toEqual([actor, actor]);
  expect(logs.map((e) => e.newValue)).toEqual(
    ['RECEIPT', 'HANDOVER'].map((kind) => ({
      kind,
      result: 'GENERATED',
      delivery: 'NOT_OBSERVED',
      paperPrinted: false,
    })),
  );
  expect(
    await db.afterSalesEvent.findMany({
      where: { caseId: f.row.id, kind: 'PRINTED' },
      select: { note: true },
    }),
  ).toEqual([{ note: 'historical' }]);
});
it.each(routes)(
  '%s emits no protected bytes when the actual outer COMMIT fails after the handler',
  async (method, suffix) => {
    const f = await fixture();
    const route = `AfterSalesController.${method}`;
    const boundary = ACCESS_BOUNDARIES.get(route)!;
    ACCESS_BOUNDARIES.set(route, async (...args) => {
      const decision = await boundary(...args);
      if (decision.kind !== 'selection') throw new Error('Expected managed selection');
      return {
        ...decision,
        execute: (handler) =>
          decision.execute(async () => {
            const value = await handler();
            await currentDomainAccess()!.client.auditLog.create({
              data: {
                userId: actor,
                action: 'TEST_STREAM_COMMIT_FAILURE',
                entity: 'after_sales_case',
                entityId: f.row.id,
              },
            });
            return value;
          }),
      };
    });
    await db.$executeRawUnsafe(
      `CREATE FUNCTION fail_stream_commit() RETURNS trigger AS $$ BEGIN IF NEW.action = 'TEST_STREAM_COMMIT_FAILURE' THEN RAISE EXCEPTION 'owned deferred commit failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`,
    );
    await db.$executeRawUnsafe(
      'CREATE CONSTRAINT TRIGGER fail_stream_commit AFTER INSERT ON audit_logs DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fail_stream_commit()',
    );
    try {
      const response = await http(`/after-sales/${f.row.id}/${suffix}`).expect(500);
      expect(JSON.stringify(response.body)).not.toContain('PROTECTED');
      expect(response.headers['content-type']).not.toMatch(/pdf|image/);
    } finally {
      ACCESS_BOUNDARIES.set(route, boundary);
      await db.$executeRawUnsafe('DROP TRIGGER fail_stream_commit ON audit_logs');
      await db.$executeRawUnsafe('DROP FUNCTION fail_stream_commit()');
    }
    expect(
      await db.auditLog.count({
        where: { entityId: f.row.id, action: 'AFTER_SALES_DOCUMENT_GENERATED' },
      }),
    ).toBe(0);
    expect((await db.afterSalesCase.findUniqueOrThrow({ where: { id: f.row.id } })).stage).toBe(
      'RECEIVED',
    );
    if (method.endsWith('Pdf')) expect(renderer.htmlToPdf).toHaveBeenCalledTimes(1);
    else expect(storage.getStream).toHaveBeenCalledTimes(1);
  },
);
import { AFTER_SALES_READ_ROUTES } from './access-after-sales-boundaries';
import {
  AFTER_SALES_ACTION_ROUTES,
  AFTER_SALES_EXCHANGE_ACTION_ROUTES,
  AFTER_SALES_INTAKE_ROUTES,
} from './access-after-sales-action-boundaries';
import { REPAIR_BOUNDARY_ROUTES } from './access-repair-boundaries';
import { ACCESS_BOUNDARIES, ACCESS_POLICIES } from './access-policy.registry';
import { currentDomainAccess } from './access-execution-context';
import { SWITCHED_TO_REPAIR_NOTE } from '../after-sales/utils/after-sales-outcomes.util';
import { lockEmployeeAccess } from './access-snapshot.service';
it.each([
  'revocation',
  'owner-demotion',
  'case-source',
  'original-source',
  'charge-provenance',
] as const)('rechecks %s after observed actual authority-lock wait', async (mode) => {
  const f = await fixture();
  const staff = await reader();
  if (mode === 'owner-demotion') {
    await db.user.update({ where: { id: staff }, data: { role: 'OWNER' } });
    await db.employeeAccessAssignment.updateMany({
      where: { userId: staff },
      data: { deletedAt: new Date() },
    });
  }
  if (mode === 'charge-provenance')
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
      if (mode === 'revocation')
        await tx.employeeAccessAssignment.updateMany({
          where: { userId: staff },
          data: { deletedAt: new Date() },
        });
      else if (mode === 'owner-demotion')
        await tx.user.update({ where: { id: staff }, data: { role: 'ACCOUNTANT' } });
      else if (mode === 'case-source')
        await tx.afterSalesCase.update({ where: { id: f.row.id }, data: { branchId: branchB } });
      else if (mode === 'original-source')
        await tx.product.update({ where: { id: f.product.id }, data: { branchId: branchB } });
      else
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
  const suffix = mode === 'charge-provenance' ? 'receipt.pdf' : 'purchase-photos/front';
  const pending = http(`/after-sales/${f.row.id}/${suffix}`, staff).then((response) => response);
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
  expect((await pending).status).toBe(mode === 'charge-provenance' ? 200 : 403);
  if (mode === 'charge-provenance')
    expect(renderer.htmlToPdf.mock.calls.at(-1)![0]).not.toContain('9,347.25');
  else {
    expect(storage.getStream).not.toHaveBeenCalled();
    expect(renderer.htmlToPdf).not.toHaveBeenCalled();
  }
});
it('managed streams reject raw, wrong-actor and wrong-action calls without relying on raw getCase', async () => {
  const f = await fixture();
  const actual = await db.user.findUniqueOrThrow({ where: { id: actor } });
  const raw = jest.spyOn(query, 'getCase');
  try {
    await expect(docs.render(f.row.id, 'RECEIPT', actual)).rejects.toThrow('ธุรกรรม');
    await expect(repair.getPhoto(f.row.id, 0, actual)).rejects.toThrow('ธุรกรรม');
    await expect(
      resources.execute(
        actor,
        'after-sales.export',
        'SHOP',
        undefined,
        () => docs.render(f.row.id, 'RECEIPT', { ...actual, id: denied }),
        false,
      ),
    ).rejects.toThrow('ผู้ดำเนินการ');
    await expect(
      resources.execute(
        actor,
        'after-sales.update',
        'SHOP',
        undefined,
        () => docs.render(f.row.id, 'RECEIPT', actual),
        false,
      ),
    ).rejects.toThrow('ธุรกรรม');
    for (const [, suffix] of routes) await http(`/after-sales/${f.row.id}/${suffix}`).expect(200);
    expect(raw).not.toHaveBeenCalled();
  } finally {
    raw.mockRestore();
  }
});
it('actual successful responses occur after commit outside execution context', async () => {
  const f = await fixture();
  for (const [method, suffix] of routes) {
    const route = `AfterSalesController.${method}`;
    const boundary = ACCESS_BOUNDARIES.get(route)!;
    let committed = false;
    ACCESS_BOUNDARIES.set(route, async (...args) => {
      const decision = await boundary(...args);
      if (decision.kind !== 'selection') throw new Error('Expected selection');
      return {
        ...decision,
        execute: (handler) =>
          decision.execute(async () => {
            const ctx = currentDomainAccess()!;
            // Registered before controller send: callback queries through independent root connection.
            ctx.effects!.commit.push(async () => {
              expect(currentDomainAccess()).toBeUndefined();
              if (method.endsWith('Pdf'))
                expect(
                  await db.auditLog.count({
                    where: { entityId: f.row.id, action: 'AFTER_SALES_DOCUMENT_GENERATED' },
                  }),
                ).toBeGreaterThan(0);
              committed = true;
            });
            return handler();
          }),
      };
    });
    try {
      await http(`/after-sales/${f.row.id}/${suffix}`).expect(200);
      expect(committed).toBe(true);
    } finally {
      ACCESS_BOUNDARIES.set(route, boundary);
    }
  }
});

it.each(['receipt.pdf', 'handover.pdf'])(
  '%s export authorizes a customer document without general case browsing or documents.export',
  async (suffix) => {
    const f = await fixture();
    const staff = await reader(['after-sales.read', 'documents.export']);
    await http(`/after-sales/${f.row.id}/${suffix}`, staff).expect(200);
    await http(`/after-sales/${f.row.id}`, staff).expect(403);
    expect((await db.afterSalesCase.findUniqueOrThrow({ where: { id: f.row.id } })).stage).toBe(
      'RECEIVED',
    );
    expect(
      await db.auditLog.count({
        where: { entityId: f.row.id, action: 'AFTER_SALES_STAGE_RECONCILED' },
      }),
    ).toBe(0);
  },
);

it('fresh supplier permission controls handover input rather than inventing in-shop repair', async () => {
  const f = await fixture();
  const supplier = await db.supplier.create({
    data: {
      name: 'Verified repair center',
      phone: '0800000000',
      isRepairCenter: true,
      accessCompanyCode: 'SHOP',
      accessBranchId: branchA,
    },
  });
  await db.repairTicket.update({
    where: { id: f.ticket.id },
    data: { repairSupplierId: supplier.id, externalClaimNo: 'VERIFIED-CLAIM' },
  });
  const staff = await reader(['suppliers.read']);
  await http(`/after-sales/${f.row.id}/handover.pdf`, staff).expect(403);
  expect(renderer.htmlToPdf).not.toHaveBeenCalled();
  await http(`/after-sales/${f.row.id}/handover.pdf`).expect(200);
  expect(renderer.htmlToPdf.mock.calls.at(-1)![0]).toContain('Verified repair center');
  expect(renderer.htmlToPdf.mock.calls.at(-1)![0]).toContain('VERIFIED-CLAIM');
});
it('renders verified replacement identity/warranty and preserves original repair receipt semantics', async () => {
  const f = await fixture(),
    next = await fixture();
  await db.contract.update({
    where: { id: next.contract.id },
    data: {
      customerId: f.customer.id,
      parentContractId: f.contract.id,
      shopWarrantyEndDate: new Date('2027-01-01'),
    },
  });
  await db.afterSalesCase.update({
    where: { id: f.row.id },
    data: {
      outcome: 'SAME_MODEL_EXCHANGE',
      replacementProductId: next.product.id,
      replacementContractId: next.contract.id,
    },
  });
  await db.repairTicket.update({ where: { id: f.ticket.id }, data: { status: 'REPLACED' } });
  await http(`/after-sales/${f.row.id}/handover.pdf`).expect(200);
  expect(renderer.htmlToPdf.mock.calls.at(-1)![0]).toContain(next.contract.contractNumber);
  expect(renderer.htmlToPdf.mock.calls.at(-1)![0]).toContain(next.product.imeiSerial);
  await http(`/after-sales/${f.row.id}/receipt.pdf`).expect(200);
  expect(renderer.htmlToPdf.mock.calls.at(-1)![0]).not.toContain(next.contract.contractNumber);
  expect(renderer.htmlToPdf.mock.calls.at(-1)![0]).toContain('ผู้จ่ายค่าซ่อม');
  await db.product.update({ where: { id: next.product.id }, data: { branchId: branchB } });
  renderer.htmlToPdf.mockClear();
  await http(`/after-sales/${f.row.id}/handover.pdf`).expect(403);
  expect(renderer.htmlToPdf).not.toHaveBeenCalled();
});
it('required generation audit failure prevents delivery even after successful rendering', async () => {
  const f = await fixture();
  await db.$executeRawUnsafe(
    `CREATE FUNCTION fail_generation_audit() RETURNS trigger AS $$ BEGIN IF NEW.action = 'AFTER_SALES_DOCUMENT_GENERATED' THEN RAISE EXCEPTION 'owned required evidence failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`,
  );
  await db.$executeRawUnsafe(
    'CREATE TRIGGER fail_generation_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION fail_generation_audit()',
  );
  try {
    const response = await http(`/after-sales/${f.row.id}/receipt.pdf`).expect(500);
    expect(JSON.stringify(response.body)).not.toContain('PROTECTED');
    expect(renderer.htmlToPdf).toHaveBeenCalledTimes(1);
  } finally {
    await db.$executeRawUnsafe('DROP TRIGGER fail_generation_audit ON audit_logs');
    await db.$executeRawUnsafe('DROP FUNCTION fail_generation_audit()');
  }
  expect(
    await db.auditLog.count({
      where: { entityId: f.row.id, action: 'AFTER_SALES_DOCUMENT_GENERATED' },
    }),
  ).toBe(0);
});
it('renderer/storage failure cannot claim generated or emit protected partial image bytes', async () => {
  const f = await fixture();
  renderer.htmlToPdf.mockRejectedValueOnce(new Error('mock renderer failed'));
  await http(`/after-sales/${f.row.id}/receipt.pdf`).expect(500);
  expect(
    await db.auditLog.count({
      where: { entityId: f.row.id, action: 'AFTER_SALES_DOCUMENT_GENERATED' },
    }),
  ).toBe(0);
  storage.getStream.mockImplementationOnce(async () =>
    Readable.from(
      (async function* () {
        yield Buffer.from('PROTECTED-PARTIAL');
        throw new Error('mock read failure');
      })(),
    ),
  );
  const response = await http(`/after-sales/${f.row.id}/photos/0`).expect(500);
  expect(JSON.stringify(response.body)).not.toContain('PROTECTED');
  expect(response.headers['content-type']).not.toContain('image');
  expect(storage.delete).not.toHaveBeenCalled();
});
it('retry discards rendered attempt bytes/evidence and publishes only successful generation', async () => {
  const f = await fixture();
  const route = 'AfterSalesController.receiptPdf';
  const boundary = ACCESS_BOUNDARIES.get(route)!;
  let attempts = 0;
  renderer.htmlToPdf
    .mockResolvedValueOnce(Buffer.from('%PDF-ROLLEDBACK'))
    .mockResolvedValueOnce(Buffer.from('%PDF-COMMITTED'));
  ACCESS_BOUNDARIES.set(route, async (...args) => {
    const decision = await boundary(...args);
    if (decision.kind !== 'selection') throw new Error('Expected selection');
    return {
      ...decision,
      execute: (handler) =>
        decision.execute(async () => {
          const value = await handler();
          if (++attempts === 1)
            throw new Prisma.PrismaClientKnownRequestError(
              'injected retry after actual rendered audit write',
              { code: 'P2034', clientVersion: 'test' },
            );
          return value;
        }),
    };
  });
  try {
    const response = await http(`/after-sales/${f.row.id}/receipt.pdf`).expect(200);
    expect(response.body.toString()).toBe('%PDF-COMMITTED');
  } finally {
    ACCESS_BOUNDARIES.set(route, boundary);
  }
  expect(attempts).toBe(2);
  expect(renderer.htmlToPdf).toHaveBeenCalledTimes(2);
  expect(
    await db.auditLog.count({
      where: { entityId: f.row.id, action: 'AFTER_SALES_DOCUMENT_GENERATED' },
    }),
  ).toBe(1);
});
it('copied-original document authority and product authority are separately necessary at its current company', async () => {
  const f = await fixture();
  const staff = await user();
  await grant(staff, ['after-sales.read', 'documents.read']);
  await grant(staff, ['products.read'], 'FINANCE');
  await http(`/after-sales/${f.row.id}/purchase-photos/front`, staff).expect(403);
  expect(storage.getStream).not.toHaveBeenCalled();
  await grant(staff, ['documents.read'], 'FINANCE');
  await http(`/after-sales/${f.row.id}/purchase-photos/front`, staff).expect(200);
  const onlyDocument = await user();
  await grant(onlyDocument, ['after-sales.read', 'documents.read']);
  await grant(onlyDocument, ['documents.read'], 'FINANCE');
  storage.getStream.mockClear();
  await http(`/after-sales/${f.row.id}/purchase-photos/front`, onlyDocument).expect(403);
  expect(storage.getStream).not.toHaveBeenCalled();
});
it('oversized managed image is bounded and closed without delivery or deleting persisted keys', async () => {
  const f = await fixture();
  const oversized = Readable.from(Buffer.alloc(EVIDENCE_IMAGE_MAX_BYTES + 1));
  storage.getStream.mockResolvedValueOnce(oversized);
  const response = await http(`/after-sales/${f.row.id}/photos/0`).expect(503);
  expect(response.headers['content-type']).not.toContain('image');
  expect(oversized.destroyed).toBe(true);
  expect(storage.delete).not.toHaveBeenCalled();
  expect(
    (await db.afterSalesCase.findUniqueOrThrow({ where: { id: f.row.id } })).photoKeys,
  ).toEqual(f.row.photoKeys);
});
import { EVIDENCE_IMAGE_MAX_BYTES } from '../../utils/upload-image.util';
