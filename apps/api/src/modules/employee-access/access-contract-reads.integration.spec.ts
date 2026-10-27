import { requestedAccessCompany } from './access-shop-boundaries';
import { AccessContractConsentAuthority } from './access-contract-consent-authority';
import { currentDomainAccess } from './access-execution-context';
import { AuditService } from '../audit/audit.service';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { SalesQueryService } from '../sales/services/sales-query.service';
import { AccessSalesProjectionService } from './access-sales-projection.service';
import { AccessTradeInProjectionService } from './access-trade-in-projection.service';
import { AccessContractReadBoundaries } from './access-contract-read-boundaries';
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
import { AccessPartySourceService } from './access-party-source.service';
import { AccessProcurementSourceService } from './access-procurement-source.service';
import { AccessPolicyService } from './access-policy';
import { AccessPolicyInterceptor } from './access-policy.interceptor';
import { ContractsController } from '../contracts/contracts.controller';
import { ContractsService } from '../contracts/contracts.service';
import { ContractQueryService } from '../contracts/services/contract-query.service';
import { ContractWorkflowService } from '../contracts/contract-workflow.service';
import { ContractPaymentService } from '../contracts/contract-payment.service';
import { ContractDocumentService } from '../contracts/contract-document.service';
import { ContractSnapshotService } from '../contracts/contract-snapshot.service';
import { ContractJournalQueryService } from '../journal/contract-journal-query.service';
import { EarlyPayoffSlipService } from '../contracts/early-payoff-slip/early-payoff-slip.service';
import { JourneyEntryWriter } from '../customer-journey/journey-entry-writer.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BranchGuard } from '../auth/guards/branch.guard';
const url = process.env.EMPLOYEE_ACCESS_TEST_DATABASE_URL;
if (
  !url?.includes('/bc_access_contract_reads?host=/tmp/bc-access-contract-reads.') ||
  process.env.DATABASE_URL !== url ||
  process.env.DATABASE_URL_FINANCE !== url
)
  throw new Error('Both database URLs must identify the owned isolated cluster');
const db = new PrismaClient({
  datasources: { db: { url } },
  log: [{ emit: 'event', level: 'query' }],
});
let measuredQueries: string[] | undefined;
let afterContractLockQuery: (() => void) | undefined;
db.$on('query', (event) => {
  measuredQueries?.push(event.query);
  if (
    afterContractLockQuery &&
    event.query.includes('FROM contracts') &&
    event.query.includes('FOR SHARE')
  ) {
    const once = afterContractLockQuery;
    afterContractLockQuery = undefined;
    once();
  }
});
const snapshots = new AccessSnapshotService(db as PrismaService);
const marker = randomUUID();
let app: INestApplication,
  actor: string,
  denied: string,
  assigned: string,
  warranty: string,
  branchA: string,
  branchB: string;
let contractA: string, contractB: string, assignedCase: string, sibling: string;
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
async function grant(
  id: string,
  permissions: PermissionKey[],
  companyCode = 'FINANCE',
  branches?: string[],
  scope?: 'ASSIGNED',
) {
  const position = await db.accessPosition.create({
    data: { code: randomUUID(), name: 'Test', permissions },
  });
  return db.employeeAccessAssignment.create({
    data: {
      userId: id,
      positionId: position.id,
      companyCode,
      scope: scope ?? (branches ? 'BRANCHES' : 'COMPANY'),
      ...(branches ? { branches: { create: branches.map((branchId) => ({ branchId })) } } : {}),
    },
  });
}
async function contract(branchId: string, assignedToId?: string, salespersonId = actor) {
  const customer = await db.customer.create({
    data: { name: 'Private customer ' + randomUUID(), phone: '0811111111' },
  });
  const product = await db.product.create({
    data: {
      name: 'Private product',
      brand: 'Apple',
      model: 'Test',
      category: 'PHONE_NEW',
      costPrice: 7777,
      branchId,
    },
  });
  return db.contract.create({
    data: {
      contractNumber: 'TEST-' + randomUUID(),
      customerId: customer.id,
      productId: product.id,
      branchId,
      salespersonId,
      assignedToId,
      planType: 'STORE_WITH_INTEREST',
      sellingPrice: 12000,
      downPayment: 2000,
      financedAmount: 10000,
      interestRate: 0.01,
      totalMonths: 10,
      interestTotal: 1000,
      monthlyPayment: 1100,
      notes: 'NEVER-RAW-NOTES',
      contractHash: 'NEVER-HASH',
      status: 'ACTIVE',
      payments: { create: { installmentNo: 1, dueDate: new Date('2026-01-01'), amountDue: 1100 } },
    },
  });
}
function http(path: string, id = actor, company = 'FINANCE') {
  const requestMarker = randomUUID();
  return request(app.getHttpServer())
    .get(path)
    .set('x-test-user', id)
    .set('x-company-scope', company)
    .set('x-owned-request', requestMarker)
    .expect('x-owned-request', requestMarker)
    .expect('x-selected-company', company)
    .expect('x-owned-contract-read-app', marker);
}
beforeAll(async () => {
  const shop = await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'SHOP' } });
  branchA = (await db.branch.create({ data: { name: 'A', companyId: shop.id } })).id;
  branchB = (await db.branch.create({ data: { name: 'B', companyId: shop.id } })).id;
  actor = await user();
  denied = await user();
  assigned = await user();
  warranty = await user();
  await grant(actor, ['contracts.read'], 'FINANCE', [branchA]);
  await grant(actor, ['contracts.read', 'products.read', 'customers.read'], 'SHOP', [branchB]);
  await grant(assigned, ['contracts.read'], 'FINANCE', [branchA], 'ASSIGNED');
  await grant(warranty, ['contracts.read'], 'SHOP', [branchA]);
  contractA = (await contract(branchA)).id;
  assignedCase = (await contract(branchA, assigned)).id;
  sibling = (await contract(branchA, undefined, assigned)).id;
  for (let i = 0; i < 5; i++) contractB = (await contract(branchB)).id;
  const query = new ContractQueryService(db as PrismaService);
  const module = await Test.createTestingModule({
    controllers: [ContractsController],
    providers: [
      AuditService,
      ContractDocumentService,
      AccessContractConsentAuthority,
      AccessContractReadBoundaries,
      AccessResourceService,
      AccessPartySourceService,
      AccessProcurementSourceService,
      AccessPolicyService,
      { provide: PrismaService, useValue: db },
      { provide: AccessSnapshotService, useValue: snapshots },
      {
        provide: ContractsService,
        useValue: { findAll: query.findAll.bind(query), findOne: query.findOne.bind(query) },
      },
      ...[
        ContractWorkflowService,
        ContractPaymentService,
        ContractSnapshotService,
        ContractJournalQueryService,
        EarlyPayoffSlipService,
        JourneyEntryWriter,
      ].map((provide) => ({ provide, useValue: {} })),
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
    .overrideGuard(BranchGuard)
    .useValue({ canActivate: () => true })
    .compile();
  app = module.createNestApplication();
  app.use(
    (
      req: { headers: Record<string, string> },
      res: { setHeader: (key: string, value: string) => void },
      next: () => void,
    ) => {
      res.setHeader('x-owned-contract-read-app', marker);
      res.setHeader('x-owned-request', req.headers['x-owned-request']);
      res.setHeader('x-selected-company', requestedAccessCompany(req));
      next();
    },
  );
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address();
  expect(address.address).toBe('127.0.0.1');
  console.log(
    'Owned Contract read HTTP listener',
    address.address,
    address.port,
    'app',
    marker,
    'both databases',
    url,
  );
}, 60000);
afterAll(async () => {
  await app?.close();
  await db.$disconnect();
});
it.each(['list', 'detail'])('allows real authorized %s HTTP', async (kind) => {
  const res = await http(kind === 'list' ? '/contracts' : '/contracts/' + contractA).expect(200);
  expect(JSON.stringify(res.body)).not.toContain('NEVER-HASH');
});
it.each(['list', 'detail'])('denies no-grant %s HTTP', async (kind) => {
  await http(kind === 'list' ? '/contracts' : '/contracts/' + contractA, denied).expect(403);
});
it('denies foreign FINANCE despite unrelated SHOP at B', async () => {
  await http('/contracts/' + contractB).expect(403);
});
it('denies warranty-only and wrong selected work context', async () => {
  await http('/contracts/' + contractA, warranty).expect(403);
  await http('/contracts/' + contractA, actor, 'SHOP').expect(403);
});
it('uses only current assigned case, not salesperson or customer assignment', async () => {
  await http('/contracts/' + assignedCase, assigned).expect(200);
  await http('/contracts/' + sibling, assigned).expect(403);
  const res = await http('/contracts', assigned).expect(200);
  expect(res.body.data.map((r: { id: string }) => r.id)).toEqual([assignedCase]);
});
it('scopes rows before count, status search and page slots', async () => {
  const statusReader = await user();
  await grant(statusReader, ['contracts.read', 'payments.read'], 'FINANCE', [branchA]);
  const res = await http('/contracts?limit=2&status=ACTIVE', statusReader).expect(200);
  expect(res.body.total).toBe(3);
  expect(res.body.data).toHaveLength(2);
  expect(res.body.data.every((r: { branchId: string }) => r.branchId === branchA)).toBe(true);
  const hidden = await db.contract.findUniqueOrThrow({ where: { id: contractB } });
  expect((await http('/contracts?search=' + hidden.contractNumber).expect(200)).body.total).toBe(0);
});
it('independently hides customer/product/payments and private metadata', async () => {
  const res = await http('/contracts/' + contractA).expect(200);
  expect(res.body.customer).toBeNull();
  expect(res.body.product).toBeNull();
  expect(res.body.payments).toBeNull();
  expect(res.body.availability.payments).toBe('UNAVAILABLE');
  expect(JSON.stringify(res.body)).not.toMatch(/NEVER-|7777/);
});
it('reloads current case reassignment', async () => {
  const row = await contract(branchA, assigned);
  await http('/contracts/' + row.id, assigned).expect(200);
  await db.contract.update({ where: { id: row.id }, data: { assignedToId: denied } });
  await http('/contracts/' + row.id, assigned).expect(403);
});
it.each(['assignment', 'actor', 'grant'])(
  'reloads %s revocation after an observed PostgreSQL lock wait',
  async (mode) => {
    const reader = await user();
    const permission = await grant(reader, ['contracts.read'], 'FINANCE', [branchA], 'ASSIGNED');
    const row = await contract(branchA, reader);
    let response: Promise<request.Response> | undefined;
    await db.$transaction(
      async (tx) => {
        const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
        if (mode === 'assignment')
          await tx.$queryRaw`SELECT id FROM contracts WHERE id=${row.id} FOR UPDATE`;
        else await tx.$executeRaw`SELECT pg_advisory_xact_lock(718294630)`;
        response = http('/contracts/' + row.id, reader).then((r) => r);
        let waited = false;
        for (let i = 0; i < 200; i++) {
          await tx.$executeRaw`SELECT pg_stat_clear_snapshot()`;
          const rows = await tx.$queryRaw<
            { waiting: boolean }[]
          >`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND ${pid}=ANY(pg_blocking_pids(pid))) AS waiting`;
          if (rows[0].waiting) {
            waited = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        expect(waited).toBe(true);
        if (mode === 'assignment')
          await tx.contract.update({ where: { id: row.id }, data: { assignedToId: denied } });
        else if (mode === 'actor')
          await tx.user.update({ where: { id: reader }, data: { isActive: false } });
        else
          await tx.employeeAccessAssignment.update({
            where: { id: permission.id },
            data: { deletedAt: new Date() },
          });
      },
      { timeout: 10000 },
    );
    expect((await response!).status).toBe(403);
  },
);
it('uniformly hides payment-derived status and filters without payment capability', async () => {
  for (const status of ['ACTIVE', 'DRAFT', 'OVERDUE'] as const) {
    await db.contract.update({ where: { id: contractA }, data: { status } });
    const res = await http('/contracts/' + contractA).expect(200);
    expect(res.body.status).toBeNull();
    expect(res.body.workflowStatus).toBe('CREATING');
    expect((await http('/contracts?status=' + status).expect(200)).body.total).toBe(0);
  }
  const list = await http('/contracts').expect(200);
  expect(list.body.summary.activeContracts).toBeNull();
  expect(list.body.summary.overdueContracts).toBeNull();
  await db.contract.update({ where: { id: contractA }, data: { status: 'ACTIVE' } });
});
it('prevents hidden Customer filter/search and validates finite query vocabulary', async () => {
  const row = await db.contract.findUniqueOrThrow({
    where: { id: contractA },
    include: { customer: true },
  });
  expect((await http('/contracts?customerId=' + row.customerId).expect(200)).body.total).toBe(0);
  expect(
    (await http('/contracts?search=' + encodeURIComponent(row.customer.name)).expect(200)).body
      .total,
  ).toBe(0);
  await http('/contracts?sort=product.costPrice').expect(400);
  await http('/contracts?status=INVALID').expect(400);
  await http('/contracts?limit=201').expect(400);
});
it('projects authorized same-case children, current product ownership, and independent sensitive values', async () => {
  const id = await user(),
    row = await contract(branchA, id);
  const finance = await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'FINANCE' } });
  await db.product.update({ where: { id: row.productId }, data: { ownedByCompanyId: finance.id } });
  await db.customer.update({
    where: { id: row.customerId },
    data: { nationalId: '1234567890123', guardianNationalId: '9876543210987', salary: 25000 },
  });
  await grant(
    id,
    ['contracts.read', 'customers.read', 'payments.read'],
    'FINANCE',
    [branchA],
    'ASSIGNED',
  );
  await grant(id, ['products.read', 'sensitive.cost.read'], 'SHOP', [branchA]);
  const before = await http('/contracts/' + row.id, id).expect(200);
  expect(before.body.customer.name).toContain('Private customer');
  expect(before.body.customer.salary).toBe('25000');
  expect(before.body.customer.nationalId).not.toBe('1234567890123');
  expect(before.body.product).toBeNull();
  expect(before.body.payments).toHaveLength(1);
  expect(before.body.status).toBe('ACTIVE');
  expect(before.body._count.payments).toBe(1);
  expect(before.body.contractDocuments).toBeNull();
  await grant(id, ['products.read'], 'FINANCE', [branchA]);
  const product = (await http('/contracts/' + row.id, id).expect(200)).body.product;
  expect(product.id).toBe(row.productId);
  expect(product.costPrice).toBeNull();
  await grant(
    id,
    [
      'sensitive.cost.read',
      'sensitive.customer-identity.read',
      'documents.read',
      'credit-checks.read',
      'collections.read',
      'mdm.read',
    ],
    'FINANCE',
    [branchA],
  );
  await db.signature.create({
    data: { contractId: row.id, signerType: 'CUSTOMER', signatureImage: 'NEVER-SIGNATURE' },
  });
  await db.contractDocument.create({
    data: {
      contractId: row.id,
      documentType: 'ID_CARD_COPY',
      fileName: 'NEVER-KEY',
      fileUrl: 'NEVER-URL',
      uploadedById: actor,
    },
  });
  await db.eDocument.create({
    data: {
      contractId: row.id,
      documentType: 'CONTRACT',
      fileUrl: 'NEVER-URL',
      fileHash: 'NEVER-FILE-HASH',
      createdById: actor,
    },
  });
  await db.creditCheck.create({
    data: { contractId: row.id, customerId: row.customerId, aiScore: 80, salaryVerified: 25000 },
  });
  const after = await http('/contracts/' + row.id, id).expect(200);
  expect(after.body.customer.nationalId).toBe('1234567890123');
  expect(after.body.product.costPrice).toBe('7777');
  expect(after.body.creditCheck.aiScore).toBe(80);
  expect(after.body.creditCheck.salaryVerified).toBe('25000');
  expect(after.body.signatures[0].signerType).toBe('CUSTOMER');
  expect(after.body.contractDocuments).toHaveLength(1);
  expect(after.body.eDocuments).toHaveLength(1);
  expect(after.body.availability.documents).toBe('VISIBLE_CURRENT');
  expect(after.body.deviceLocked).toBe(false);
  expect(after.body.noAnswerCount).toBe(0);
  expect(JSON.stringify(after.body)).not.toMatch(/NEVER-|Encrypted|Hash|fileUrl|signatureImage/);
});
it('reports permitted zero only within declared same-case child scope', async () => {
  const id = await user(),
    row = await contract(branchA);
  await db.payment.deleteMany({ where: { contractId: row.id } });
  await grant(id, ['contracts.read', 'payments.read', 'documents.read'], 'FINANCE', [branchA]);
  const res = await http('/contracts/' + row.id, id).expect(200);
  expect(res.body.payments).toEqual([]);
  expect(res.body._count.payments).toBe(0);
  expect(res.body.contractDocuments).toEqual([]);
  expect(res.body._count.contractDocuments).toBe(0);
  expect(res.body.scope).toBe('authorized-sources');
  expect(res.body.receipts).toBeNull();
});
it('keeps actual unmanaged canonical reads separate from managed projection', async () => {
  const id = await user();
  await db.user.update({ where: { id }, data: { accessManaged: false } });
  const row = await contract(branchA);
  const res = await http('/contracts/' + row.id, id).expect(200);
  expect(res.body.notes).toBe('NEVER-RAW-NOTES');
  expect(res.body.contractHash).toBe('NEVER-HASH');
  expect(res.body.payments).toHaveLength(1);
  expect(res.body.customer.name).toContain('Private customer');
  expect(res.body.scope).toBeUndefined();
});
it('preserves the actual public hash verification contract', async () => {
  expect(
    (await http('/contracts/' + contractA + '/verify', denied).expect(200)).body.verified,
  ).toBe(false);
  const res = await http('/contracts/' + contractA + '/verify?hash=NEVER-HASH', denied).expect(200);
  expect(res.body.verified).toBe(true);
  expect(res.body.contract.status).toBeNull();
  expect(res.body.contract.customer).toBeUndefined();
});
it('records safe successful and denied HTTP metadata without request secrets', async () => {
  const id = await user();
  await grant(id, ['contracts.read'], 'FINANCE', [branchA]);
  await http('/contracts?search=NEVER-QUERY-SECRET', id).expect(200);
  await http('/contracts/' + contractB + '?search=NEVER-QUERY-SECRET', id).expect(403);
  let rows: Awaited<ReturnType<typeof db.auditLog.findMany>> = [];
  for (let i = 0; i < 100; i++) {
    rows = await db.auditLog.findMany({ where: { userId: id } });
    if (rows.length >= 2) break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(rows.map((r) => r.action).sort()).toEqual(['GET', 'GET_ERROR']);
  expect(JSON.stringify(rows.map((r) => r.newValue))).not.toContain('NEVER-');
  expect(rows.every((r) => r.ipAddress === null)).toBe(true);
});
async function saleFor(row: Awaited<ReturnType<typeof contract>>) {
  return db.sale.create({
    data: {
      saleNumber: 'TEST-' + randomUUID(),
      saleType: 'INSTALLMENT',
      contractId: row.id,
      customerId: row.customerId,
      productId: row.productId,
      salespersonId: actor,
      branchId: row.branchId,
      sellingPrice: 12000,
      netAmount: 12000,
    },
  });
}
async function saleRead(
  id: string,
  filters: { contractStatus?: string; limit?: number; search?: string; branchId?: string } = {},
) {
  const resources = new AccessResourceService(db as PrismaService, snapshots);
  const parties = new AccessTradeInProjectionService(resources);
  const projection = new AccessSalesProjectionService(resources, parties);
  return (
    await resources.execute(
      id,
      'sales.read',
      'SHOP',
      undefined,
      async () =>
        projection.project(
          await new SalesQueryService(db as PrismaService).findAll(filters, {
            id,
            role: 'ACCOUNTANT',
            branchId: null,
          }),
          'sale',
        ),
      false,
      { isolationLevel: 'Serializable', maxAttempts: 3 },
    )
  ).result;
}
it('restores Sale navigation and status filter only with independent FINANCE case/payment proof', async () => {
  const id = await user(),
    rowA = await contract(branchA),
    rowB = await contract(branchB);
  const a = await saleFor(rowA);
  await saleFor(rowB);
  await grant(id, ['sales.read'], 'SHOP');
  const without = await saleRead(id);
  expect(without.data.every((r) => r.contractId === null)).toBe(true);
  expect((await saleRead(id, { contractStatus: 'ACTIVE' })).total).toBe(0);
  await grant(id, ['contracts.read'], 'FINANCE', [branchA]);
  const linked = await saleRead(id);
  expect(linked.data.find((r) => r.id === a.id)?.contract?.id).toBe(rowA.id);
  expect(linked.data.find((r) => r.id === a.id)?.contract?.status).toBeNull();
  expect((await saleRead(id, { contractStatus: 'ACTIVE' })).total).toBe(0);
  await grant(id, ['payments.read'], 'FINANCE', [branchA]);
  const status = await saleRead(id, { contractStatus: 'ACTIVE', limit: 1 });
  expect(status.total).toBe(1);
  expect(status.data[0].id).toBe(a.id);
  expect(status.data[0].contract?.status).toBe('ACTIVE');
  const finance = await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'FINANCE' } });
  await db.product.update({
    where: { id: rowA.productId },
    data: { ownedByCompanyId: finance.id },
  });
  expect((await saleRead(id)).data.find((r) => r.id === a.id)?.branchId).toBe(branchA);
});
it('restores genuine TradeIn redemption Contract link without using SHOP warranty authority', async () => {
  const id = await user(),
    row = await contract(branchA);
  const t = await db.tradeIn.create({
    data: { branchId: branchA, deviceBrand: 'Apple', deviceModel: 'Test' },
  });
  const redemption = await db.tradeInCreditRedemption.create({
    data: {
      tradeInId: t.id,
      contractId: row.id,
      baseAmount: 1000,
      bonusAmount: 0,
      createdById: actor,
    },
  });
  await db.tradeIn.update({ where: { id: t.id }, data: { currentRedemptionId: redemption.id } });
  await grant(id, ['trade-in.read', 'contracts.read'], 'SHOP', [branchA]);
  const resources = new AccessResourceService(db as PrismaService, snapshots);
  const read = async () =>
    (
      await resources.execute(
        id,
        'trade-in.read',
        'SHOP',
        undefined,
        async () =>
          new AccessTradeInProjectionService(resources).project(
            await currentDomainAccess()!.client.tradeIn.findUniqueOrThrow({ where: { id: t.id } }),
            t.id,
          ),
        false,
        { isolationLevel: 'Serializable', maxAttempts: 3 },
      )
    ).result as unknown as { currentRedemptionContractId: string | null };
  expect((await read()).currentRedemptionContractId).toBeNull();
  await grant(id, ['contracts.read'], 'FINANCE', [branchA]);
  expect((await read()).currentRedemptionContractId).toBe(row.id);
  await db.contract.update({ where: { id: row.id }, data: { branchId: branchB } });
  expect((await read()).currentRedemptionContractId).toBeNull();
});
it('fails closed for malformed credit correlation and ignores unknown unlinked credit', async () => {
  const id = await user(),
    row = await contract(branchA),
    foreign = await db.customer.create({ data: { name: 'Foreign', phone: '0811111111' } });
  await grant(id, ['contracts.read', 'credit-checks.read'], 'FINANCE', [branchA]);
  await db.creditCheck.create({ data: { customerId: row.customerId, aiScore: 99 } });
  const unknown = (await http('/contracts/' + row.id, id).expect(200)).body;
  expect(unknown.creditCheck).toBeNull();
  await db.creditCheck.create({
    data: { contractId: row.id, customerId: foreign.id, aiScore: 10 },
  });
  const malformed = (await http('/contracts/' + row.id, id).expect(200)).body;
  expect(malformed.creditCheck).toBeNull();
  expect(malformed.availability.credit).toBe('UNAVAILABLE');
});
it('requires live source companies/branch and explicit FINANCE central COMPANY authority', async () => {
  const id = await user();
  await grant(id, ['contracts.read'], 'FINANCE');
  await http('/contracts/' + contractB, id).expect(200);
  const shop = await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'SHOP' } });
  const branch = await db.branch.create({ data: { name: 'Retired', companyId: shop.id } });
  const row = await contract(branch.id);
  await db.branch.update({ where: { id: branch.id }, data: { isActive: false } });
  await http('/contracts/' + row.id, id).expect(403);
  const finance = await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'FINANCE' } });
  await db.companyInfo.update({ where: { id: finance.id }, data: { isActive: false } });
  try {
    await http('/contracts/' + contractA, id).expect(403);
  } finally {
    await db.companyInfo.update({ where: { id: finance.id }, data: { isActive: true } });
  }
});
it('keeps bundle scope metadata fixed when inaccessible contributors are added', async () => {
  const id = await user(),
    row = await contract(branchA);
  await grant(id, ['contracts.read', 'products.read'], 'FINANCE', [branchA]);
  const before = (await http('/contracts/' + row.id, id).expect(200)).body;
  const hidden = await db.product.create({
    data: {
      name: 'Hidden bundle',
      brand: 'Apple',
      model: 'Accessory',
      category: 'ACCESSORY',
      costPrice: 12345,
      branchId: branchB,
    },
  });
  await db.contract.update({ where: { id: row.id }, data: { bundleProductIds: [hidden.id] } });
  const after = (await http('/contracts/' + row.id, id).expect(200)).body;
  expect(after.availability.bundles).toBe(before.availability.bundles);
  expect(after.bundleProducts).toEqual(before.bundleProducts);
  expect(JSON.stringify(after)).not.toContain(hidden.id);
});
it('projects proven bundles and does not claim complete coverage for an invalid contributor', async () => {
  const id = await user(),
    row = await contract(branchA);
  await grant(id, ['contracts.read', 'products.read'], 'FINANCE');
  await grant(id, ['products.read'], 'SHOP');
  const bundle = await db.product.create({
    data: {
      name: 'Visible bundle',
      brand: 'Apple',
      model: 'Accessory',
      category: 'ACCESSORY',
      costPrice: 12345,
      branchId: branchA,
    },
  });
  await db.contract.update({ where: { id: row.id }, data: { bundleProductIds: [bundle.id] } });
  const valid = (await http('/contracts/' + row.id, id).expect(200)).body;
  expect(valid.bundleProducts[0].id).toBe(bundle.id);
  expect(valid.bundleProducts[0].costPrice).toBeNull();
  expect(valid.availability.bundles).toBe('VISIBLE_CURRENT');
  await db.product.update({ where: { id: bundle.id }, data: { deletedAt: new Date() } });
  const invalid = (await http('/contracts/' + row.id, id).expect(200)).body;
  expect(invalid.bundleProducts).toEqual([]);
  expect(invalid.availability.bundles).toBe('PARTIAL');
});
it('keeps positive Customer/source filters and status summary on their proven SQL sources', async () => {
  const id = await user(),
    row = await contract(branchA);
  await grant(id, ['contracts.read', 'customers.read', 'payments.read'], 'FINANCE');
  await db.user.update({ where: { id: row.salespersonId }, data: { branchId: branchA } });
  await grant(id, ['employees.read'], 'SHOP', [branchA]);
  const filters = new URLSearchParams({
    customerId: row.customerId,
    branchId: row.branchId,
    salespersonId: row.salespersonId,
    workflowStatus: 'CREATING',
    startDate: '2020-01-01',
    endDate: '2099-01-01',
  });
  const res = (await http('/contracts?' + filters, id).expect(200)).body;
  expect(res.total).toBe(1);
  expect(res.data[0].id).toBe(row.id);
  expect(res.summary.portfolioValue).toBe(12000);
  expect(res.summary.activeContracts).toBe(1);
  expect(res.summary.overdueContracts).toBe(0);
  expect(res.summary.statusAvailability).toBe('VISIBLE_CURRENT');
});
it.each(['navigation', 'status filter'])(
  'rechecks linked FINANCE %s after an observed Contract lock wait',
  async (mode) => {
    const id = await user(),
      row = await contract(branchA, id),
      sale = await saleFor(row);
    await grant(id, ['sales.read'], 'SHOP', [branchA]);
    await grant(id, ['contracts.read', 'payments.read'], 'FINANCE', [branchA], 'ASSIGNED');
    let retainedSaleId: string | undefined;
    if (mode === 'status filter') {
      // Reassigned contributor is outside the first page but must leave the total.
      await db.sale.update({ where: { id: sale.id }, data: { createdAt: new Date('2001-01-01') } });
      retainedSaleId = (await saleFor(await contract(branchA, id))).id;
    }
    let response: ReturnType<typeof saleRead> | undefined;
    await db.$transaction(
      async (tx) => {
        const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
        await tx.$queryRaw`SELECT id FROM contracts WHERE id=${row.id} FOR UPDATE`;
        response = saleRead(
          id,
          mode === 'status filter' ? { contractStatus: 'ACTIVE', limit: 1 } : {},
        );
        let waited = false;
        for (let i = 0; i < 200; i++) {
          await tx.$executeRaw`SELECT pg_stat_clear_snapshot()`;
          const [state] = await tx.$queryRaw<
            { waiting: boolean }[]
          >`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND ${pid}=ANY(pg_blocking_pids(pid))) AS waiting`;
          if (state.waiting) {
            waited = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        expect(waited).toBe(true);
        await tx.contract.update({ where: { id: row.id }, data: { assignedToId: denied } });
      },
      { timeout: 10000 },
    );
    const result = await response!;
    if (mode === 'status filter') {
      expect(result.total).toBe(1);
      expect(result.data.map((r) => r.id)).toEqual([retainedSaleId]);
    } else expect(result.data.find((r) => r.id === sale.id)?.contractId).toBeNull();
  },
);

// I1: realistic synthetic portfolio shape, isolated DB only. Per-case customers,
// products and twelve installments; ten genuine SHOP origins and explicit FINANCE.
async function portfolio(size: number) {
  const id = await user();
  await grant(id, ['contracts.read', 'payments.read'], 'FINANCE');
  const shop = await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'SHOP' } });
  const branches = [branchA, branchB];
  for (let i = 2; i < 10; i++)
    branches.push(
      (await db.branch.create({ data: { name: 'Scale ' + i, companyId: shop.id } })).id,
    );
  const prefix = 'SCALE-' + randomUUID();
  for (let offset = 0; offset < size; offset += 500) {
    const cases = Array.from({ length: Math.min(500, size - offset) }, (_, i) => ({
      id: randomUUID(),
      customerId: randomUUID(),
      productId: randomUUID(),
      branchId: branches[(offset + i) % branches.length],
      index: offset + i,
    }));
    await db.customer.createMany({
      data: cases.map((c) => ({
        id: c.customerId,
        name: 'Synthetic portfolio customer ' + c.index,
        phone: '0811111111',
      })),
    });
    await db.product.createMany({
      data: cases.map((c) => ({
        id: c.productId,
        name: 'Synthetic phone ' + c.index,
        brand: 'Apple',
        model: 'Scale',
        category: 'PHONE_NEW',
        costPrice: 10000,
        branchId: c.branchId,
      })),
    });
    await db.contract.createMany({
      data: cases.map((c) => ({
        id: c.id,
        contractNumber: prefix + '-' + c.index,
        customerId: c.customerId,
        productId: c.productId,
        branchId: c.branchId,
        salespersonId: actor,
        assignedToId: id,
        planType: 'STORE_WITH_INTEREST',
        sellingPrice: 14000,
        downPayment: 2000,
        financedAmount: 12000,
        interestRate: 0.01,
        totalMonths: 12,
        interestTotal: 1440,
        monthlyPayment: 1120,
        status: 'ACTIVE',
        workflowStatus: 'APPROVED',
        createdAt: new Date(Date.UTC(2025, c.index % 12, 1)),
      })),
    });
    await db.payment.createMany({
      data: cases.flatMap((c) =>
        Array.from({ length: 12 }, (_, i) => ({
          contractId: c.id,
          installmentNo: i + 1,
          dueDate: new Date(Date.UTC(2026, i, 1)),
          amountDue: 1120,
          amountPaid: i < 6 ? 1120 : 0,
          status: i < 6 ? 'PAID' : 'PENDING',
        })),
      ),
    });
  }
  // Fresh bulk-loaded clusters need planner statistics before measuring read work.
  await db.$executeRaw`ANALYZE contracts`;
  await db.$executeRaw`ANALYZE customers`;
  await db.$executeRaw`ANALYZE products`;
  await db.$executeRaw`ANALYZE payments`;
  return { id, prefix };
}
let supportedPortfolio: Awaited<ReturnType<typeof portfolio>> | undefined;
it.each([250, 10000])(
  'I1 bounds query count and unrelated managed contention for %i cases',
  async (size) => {
    const fixture = await portfolio(size);
    if (size === 10000) supportedPortfolio = fixture;
    const other = await user();
    await grant(other, ['contracts.read'], 'FINANCE', [branchA]);
    let competing: Promise<request.Response> | undefined;
    let observation: Promise<boolean> | undefined;
    let competingMs = 0;
    measuredQueries = [];
    afterContractLockQuery = () => {
      const started = performance.now();
      let done = false;
      competing = http('/contracts/' + contractA, other)
        .expect(200)
        .then((response) => {
          competingMs = performance.now() - started;
          done = true;
          return response;
        });
      observation = (async () => {
        for (let i = 0; i < 200 && !done; i++) {
          const [state] = await db.$queryRaw<
            { waiting: boolean }[]
          >`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%pg_advisory_xact_lock(718294630)%' AND pid<>pg_backend_pid()) AS waiting`;
          if (state.waiting) return true;
          await new Promise((resolve) => setTimeout(resolve, 2));
        }
        return false;
      })();
    };
    const started = performance.now();
    try {
      const response = await http('/contracts?limit=1&search=' + fixture.prefix, fixture.id).expect(
        200,
      );
      const portfolioMs = performance.now() - started;
      expect(competing).toBeDefined();
      await competing;
      const waitObserved = await observation;
      const queries = measuredQueries;
      measuredQueries = undefined;
      const sourceLockQueries = queries.filter(
        (q) =>
          q.includes('FOR SHARE') &&
          (q.includes('FROM contracts') ||
            q.includes("company_code='FINANCE'") ||
            q.includes('JOIN contracts c')),
      ).length;
      console.log(
        'I1_PORTFOLIO',
        JSON.stringify({
          cases: size,
          branches: 10,
          installments: size * 12,
          pageSize: 1,
          totalQueries: queries.length,
          sourceLockQueries,
          portfolioMs: Math.round(portfolioMs),
          unrelatedManagedMs: Math.round(competingMs),
          advisoryWaitObserved: waitObserved,
        }),
      );
      expect(response.body.total).toBe(size);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].payments).toHaveLength(12);
      expect(waitObserved).toBe(true);
      // Two operations: one set of source locks for the portfolio and one detail.
      expect(sourceLockQueries).toBeLessThanOrEqual(8);
      expect(queries.length).toBeLessThan(200);
      expect(portfolioMs).toBeLessThan(5000);
      expect(competingMs).toBeLessThan(5000);
    } finally {
      afterContractLockQuery = undefined;
      measuredQueries = undefined;
      await competing;
      await observation;
    }
  },
  120000,
);

it('I1 rejects overflow without partial results and recovers through proven filters for Contracts and Sale status', async () => {
  const fixture = supportedPortfolio ?? (await portfolio(10000));
  const cases = await db.contract.findMany({
    where: { contractNumber: { startsWith: fixture.prefix } },
  });
  await grant(fixture.id, ['sales.read'], 'SHOP');
  for (let offset = 0; offset < cases.length; offset += 500) {
    await db.sale.createMany({
      data: cases.slice(offset, offset + 500).map((row) => ({
        saleNumber: row.contractNumber,
        saleType: 'INSTALLMENT',
        contractId: row.id,
        customerId: row.customerId,
        productId: row.productId,
        salespersonId: actor,
        branchId: row.branchId,
        sellingPrice: 14000,
        netAmount: 14000,
      })),
    });
  }
  await db.$executeRaw`ANALYZE sales`;
  measuredQueries = [];
  const started = performance.now();
  let exact;
  let queries: string[];
  try {
    exact = await saleRead(fixture.id, {
      contractStatus: 'ACTIVE',
      limit: 1,
      search: fixture.prefix,
    });
    queries = measuredQueries;
  } finally {
    measuredQueries = undefined;
  }
  // Four portfolio locks plus the independently projected one-row Contract link.
  const sourceLockQueries = queries.filter(
    (q) =>
      q.includes('FOR SHARE') &&
      (q.includes('FROM contracts') || q.includes("company_code='FINANCE'")),
  ).length;
  console.log(
    'I1_SALE_PORTFOLIO',
    JSON.stringify({
      cases: 10000,
      totalQueries: queries.length,
      sourceLockQueries,
      elapsedMs: Math.round(performance.now() - started),
    }),
  );
  expect(exact.total).toBe(10000);
  expect(exact.data).toHaveLength(1);
  expect(sourceLockQueries).toBeLessThanOrEqual(8);
  expect(queries.length).toBeLessThan(200);

  const extra = await contract(branchB, fixture.id);
  await db.contract.update({
    where: { id: extra.id },
    data: { contractNumber: fixture.prefix + '-overflow' },
  });
  const extraSale = await saleFor(extra);
  await db.sale.update({
    where: { id: extraSale.id },
    data: { saleNumber: fixture.prefix + '-overflow' },
  });
  const overflow = await http('/contracts?limit=1&search=' + fixture.prefix, fixture.id).expect(
    400,
  );
  expect(overflow.body.message).toBe('กรุณาระบุตัวกรองให้แคบลงแล้วลองอีกครั้ง');
  expect(overflow.body.data).toBeUndefined();
  expect(overflow.body.total).toBeUndefined();
  expect(overflow.body.summary).toBeUndefined();
  expect(JSON.stringify(overflow.body)).not.toMatch(/10000|10001|SCALE-/);
  await expect(
    saleRead(fixture.id, { contractStatus: 'ACTIVE', limit: 1, search: fixture.prefix }),
  ).rejects.toMatchObject({ status: 400, message: overflow.body.message });
  const narrowed = await http(
    '/contracts?limit=1&search=' + fixture.prefix + '&branchId=' + branchA,
    fixture.id,
  ).expect(200);
  expect(narrowed.body.total).toBe(1000);
  expect(
    (
      await saleRead(fixture.id, {
        contractStatus: 'ACTIVE',
        limit: 1,
        search: fixture.prefix,
        branchId: branchA,
      })
    ).total,
  ).toBe(1000);
  // Unreadable contributors do not enter the overflow probe or disclose their count.
  const scoped = await user();
  await grant(scoped, ['contracts.read', 'payments.read'], 'FINANCE', [branchA]);
  await grant(scoped, ['sales.read'], 'SHOP');
  expect(
    (await http('/contracts?limit=1&search=' + fixture.prefix, scoped).expect(200)).body.total,
  ).toBe(1000);
  expect(
    (await saleRead(scoped, { contractStatus: 'ACTIVE', limit: 1, search: fixture.prefix })).total,
  ).toBe(1000);
}, 120000);

it('I1 rechecks a portfolio origin after an observed branch dependency lock wait', async () => {
  const shop = await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'SHOP' } });
  const branch = await db.branch.create({ data: { name: 'Dependency wait', companyId: shop.id } });
  const reader = await user();
  await grant(reader, ['contracts.read'], 'FINANCE');
  const row = await contract(branch.id);
  let response: Promise<request.Response> | undefined;
  await db.$transaction(
    async (tx) => {
      const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      await tx.$queryRaw`SELECT id FROM branches WHERE id=${branch.id} FOR UPDATE`;
      response = http('/contracts?limit=1&search=' + row.contractNumber, reader).then((r) => r);
      let waited = false;
      for (let i = 0; i < 200; i++) {
        await tx.$executeRaw`SELECT pg_stat_clear_snapshot()`;
        const [state] = await tx.$queryRaw<
          { waiting: boolean }[]
        >`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND ${pid}=ANY(pg_blocking_pids(pid))) AS waiting`;
        if (state.waiting) {
          waited = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      expect(waited).toBe(true);
      await tx.branch.update({ where: { id: branch.id }, data: { isActive: false } });
    },
    { timeout: 10000 },
  );
  const result = await response!;
  expect(result.status).toBe(200);
  expect(result.body.total).toBe(0);
  expect(result.body.data).toEqual([]);
});

it('R151 I1 ordinary list prevents denied staff attribution inference', async () => {
  const id = await user(),
    seller = await user();
  const row = await contract(branchA, id, seller);
  await db.user.update({ where: { id: seller }, data: { branchId: branchB } });
  await grant(id, ['contracts.read'], 'FINANCE', [branchA], 'ASSIGNED');
  const path = `/contracts?salespersonId=${seller}`;
  expect((await http(path, id).expect(200)).body.total).toBe(0);
  await grant(id, ['employees.read'], 'SHOP', [branchB]);
  const positive = (await http(path, id).expect(200)).body;
  expect(positive.total).toBe(1);
  expect(positive.data[0].id).toBe(row.id);
  await db.user.update({ where: { id: seller }, data: { isSystemUser: true } });
  expect((await http(path, id).expect(200)).body.total).toBe(0);
});
