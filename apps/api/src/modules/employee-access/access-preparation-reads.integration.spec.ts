import { AuditService } from '../audit/audit.service';
import { AuditInterceptor } from '../audit/audit.interceptor';
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
  !url?.includes('/bc_access_preparation_reads?host=/tmp/bc-access-preparation-reads.') ||
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
    const callback = afterContractLockQuery;
    afterContractLockQuery = undefined;
    callback();
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
  companyCode = 'SHOP',
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
      status: 'DRAFT',
      payments: { create: { installmentNo: 1, dueDate: new Date('2026-01-01'), amountDue: 1100 } },
    },
  });
}
function http(path: string, id = actor, company = 'SHOP') {
  return request(app.getHttpServer())
    .get(path)
    .set('x-test-user', id)
    .set('x-company-scope', company)
    .expect('x-owned-preparation-read-app', marker);
}
beforeAll(async () => {
  const shop = await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'SHOP' } });
  branchA = (await db.branch.create({ data: { name: 'A', companyId: shop.id } })).id;
  branchB = (await db.branch.create({ data: { name: 'B', companyId: shop.id } })).id;
  actor = await user();
  denied = await user();
  assigned = await user();
  warranty = await user();
  await grant(actor, ['contracts.read', 'contracts.update'], 'SHOP', [branchA]);
  await grant(assigned, ['contracts.read', 'contracts.update'], 'SHOP', [branchA], 'ASSIGNED');
  await grant(warranty, ['contracts.read'], 'SHOP', [branchA]);
  contractA = (await contract(branchA)).id;
  assignedCase = (await contract(branchA, assigned, assigned)).id;
  sibling = (await contract(branchA, undefined, assigned)).id;
  contractB = (await contract(branchB)).id;
  const query = new ContractQueryService(db as PrismaService);
  const module = await Test.createTestingModule({
    controllers: [ContractsController],
    providers: [
      AuditService,
      ContractDocumentService,
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
    (_req: unknown, res: { setHeader: (key: string, value: string) => void }, next: () => void) => {
      res.setHeader('x-owned-preparation-read-app', marker);
      next();
    },
  );
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  await app.listen(0, '127.0.0.1');
}, 60000);
afterAll(async () => {
  await app?.close();
  await db.$disconnect();
});

it.each(['list', 'detail'])(
  'R111 current SHOP maker can reload %s through marked HTTP',
  async (kind) => {
    const res = await http(
      kind === 'list'
        ? '/contracts?view=preparation'
        : '/contracts/' + contractA + '?view=preparation',
    ).expect(200);
    expect(res.body.view).toBe('SHOP_PREPARATION');
    if (kind === 'list') {
      expect(res.body.total).toBe(1);
      expect(res.body.data.map((row: { id: string }) => row.id)).toEqual([contractA]);
    } else {
      expect(res.body.applicationState).toBe('PRE_ACTIVATION');
      expect(res.body.customer).toBeNull();
      expect(res.body.product).toBeNull();
      expect(res.body.availability.customer).toBe('UNAVAILABLE');
      expect(res.body).not.toHaveProperty('status');
      expect(res.body).not.toHaveProperty('payments');
      expect(JSON.stringify(res.body)).not.toMatch(/NEVER-|7777/);
    }
  },
);
it('R111 denies other maker, branch, no-update and ASSIGNED-only', async () => {
  for (const [id, reader] of [
    [sibling, actor],
    [contractB, actor],
    [contractA, warranty],
    [assignedCase, assigned],
    [contractA, denied],
  ])
    await http('/contracts/' + id + '?view=preparation', reader).expect(403);
});
it('reads all four DRAFT workflows and denies non-DRAFT lifecycle states', async () => {
  const reader = await user();
  await grant(reader, ['contracts.read', 'contracts.update']);
  const row = await contract(branchA, undefined, reader);
  for (const workflowStatus of ['CREATING', 'REJECTED', 'PENDING_REVIEW', 'APPROVED'] as const) {
    await db.contract.update({ where: { id: row.id }, data: { workflowStatus } });
    const result = await http(`/contracts/${row.id}?view=preparation`, reader).expect(200);
    expect(result.body.workflowStatus).toBe(workflowStatus);
    expect(
      (
        await http(`/contracts?view=preparation&workflowStatus=${workflowStatus}`, reader).expect(
          200,
        )
      ).body.total,
    ).toBe(1);
  }
  for (const status of ['ACTIVE', 'OVERDUE', 'DEFAULT', 'COMPLETED', 'CANCELED'] as const) {
    await db.contract.update({ where: { id: row.id }, data: { status } });
    await http(`/contracts/${row.id}?view=preparation`, reader).expect(403);
    expect((await http('/contracts?view=preparation', reader).expect(200)).body.total).toBe(0);
  }
});
it('protected current owner still requires DRAFT and a live SHOP origin', async () => {
  const owner = await user();
  await db.user.update({ where: { id: owner }, data: { role: 'OWNER' } });
  await http(`/contracts/${sibling}?view=preparation`, owner).expect(200);
  const row = await contract(branchA);
  await db.contract.update({ where: { id: row.id }, data: { status: 'ACTIVE' } });
  await http(`/contracts/${row.id}?view=preparation`, owner).expect(403);
  const shop = await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'SHOP' } });
  const branch = await db.branch.create({ data: { name: 'Retired', companyId: shop.id } });
  const retired = await contract(branch.id);
  await db.branch.update({ where: { id: branch.id }, data: { isActive: false } });
  await http(`/contracts/${retired.id}?view=preparation`, owner).expect(403);
});
it('keeps explicit context, original permission tuple pairing and finite query inputs', async () => {
  const reader = await user();
  await grant(reader, ['contracts.read'], 'SHOP', [branchA]);
  await grant(reader, ['contracts.update'], 'SHOP', [branchB]);
  const row = await contract(branchA, undefined, reader);
  await http(`/contracts/${row.id}?view=preparation`, reader).expect(403);
  await http(`/contracts/${contractA}`, actor).expect(403);
  await http(`/contracts/${contractA}?view=preparation`, actor, 'FINANCE').expect(403);
  for (const query of [
    'status=DRAFT',
    'status=ACTIVE',
    'export=true',
    'limit=201',
    'page=0',
    'workflowStatus=INVALID',
    'sort=costPrice',
    'salespersonId=' + assigned,
  ])
    await http('/contracts?view=preparation&' + query).expect(400);
});
it('has no dependency on a live FINANCE company for SHOP preparation', async () => {
  const finance = await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'FINANCE' } });
  await db.companyInfo.update({ where: { id: finance.id }, data: { isActive: false } });
  try {
    await http(`/contracts/${contractA}?view=preparation`).expect(200);
    expect((await http('/contracts?view=preparation').expect(200)).body.total).toBe(1);
  } finally {
    await db.companyInfo.update({ where: { id: finance.id }, data: { isActive: true } });
  }
});
it.each(['maker', 'activation', 'grant', 'actor', 'origin'] as const)(
  'rechecks current %s after an observed PostgreSQL wait',
  async (mode) => {
    const reader = await user();
    const permission = await grant(reader, ['contracts.read', 'contracts.update']);
    const shop = await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'SHOP' } });
    const branch = await db.branch.create({ data: { name: 'Wait', companyId: shop.id } });
    const row = await contract(branch.id, undefined, reader);
    let response: Promise<request.Response> | undefined;
    await db.$transaction(
      async (tx) => {
        const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
        if (mode === 'origin')
          await tx.$queryRaw`SELECT id FROM branches WHERE id=${branch.id} FOR UPDATE`;
        else if (mode === 'maker' || mode === 'activation')
          await tx.$queryRaw`SELECT id FROM contracts WHERE id=${row.id} FOR UPDATE`;
        else await tx.$executeRaw`SELECT pg_advisory_xact_lock(718294630)`;
        response = http(`/contracts/${row.id}?view=preparation`, reader).then((r) => r);
        let observed = false;
        for (let i = 0; i < 200; i++) {
          await tx.$executeRaw`SELECT pg_stat_clear_snapshot()`;
          const [state] = await tx.$queryRaw<
            { waiting: boolean }[]
          >`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND ${pid}=ANY(pg_blocking_pids(pid))) AS waiting`;
          if (state.waiting) {
            observed = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        expect(observed).toBe(true);
        if (mode === 'maker')
          await tx.contract.update({ where: { id: row.id }, data: { salespersonId: denied } });
        else if (mode === 'activation')
          await tx.contract.update({ where: { id: row.id }, data: { status: 'ACTIVE' } });
        else if (mode === 'origin')
          await tx.branch.update({ where: { id: branch.id }, data: { isActive: false } });
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
it('independently authorizes finite customer, current product and document children', async () => {
  const reader = await user();
  await grant(reader, ['contracts.read', 'contracts.update'], 'SHOP', [branchA]);
  const row = await contract(branchA, undefined, reader);
  await db.customer.update({
    where: { id: row.customerId },
    data: { nationalId: '1234567890123' },
  });
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
      fileHash: 'NEVER-HASH',
      createdById: actor,
    },
  });
  const before = (await http(`/contracts/${row.id}?view=preparation`, reader).expect(200)).body;
  expect(before.customer).toBeNull();
  expect(before.product).toBeNull();
  expect(before.signatures).toBeNull();
  expect(before.contractDocuments).toBeNull();
  expect(before.eDocuments).toBeNull();
  const customer = await db.customer.findUniqueOrThrow({ where: { id: row.customerId } });
  expect(
    (await http('/contracts?view=preparation&customerId=' + row.customerId, reader).expect(200))
      .body.total,
  ).toBe(0);
  expect(
    (
      await http(
        '/contracts?view=preparation&search=' + encodeURIComponent(customer.name),
        reader,
      ).expect(200)
    ).body.total,
  ).toBe(0);
  await grant(reader, ['customers.read', 'products.read', 'documents.read'], 'SHOP', [branchA]);
  const visible = (await http(`/contracts/${row.id}?view=preparation`, reader).expect(200)).body;
  expect(visible.customer.name).toBe(customer.name);
  expect(visible.customer.nationalId).not.toBe('1234567890123');
  expect(visible.product.id).toBe(row.productId);
  expect(visible.product).not.toHaveProperty('costPrice');
  expect(visible.signatures).toHaveLength(1);
  expect(visible.eDocuments).toHaveLength(1);
  expect(visible.contractDocuments).toBeNull();
  expect(visible.availability.contractDocuments).toBe('UNAVAILABLE');
  expect(JSON.stringify(visible)).not.toMatch(/NEVER-|7777/);
  expect(
    (await http('/contracts?view=preparation&customerId=' + row.customerId, reader).expect(200))
      .body.total,
  ).toBe(1);
  await grant(reader, ['sensitive.customer-identity.read', 'contract-documents.read'], 'SHOP', [
    branchA,
  ]);
  const identity = (await http(`/contracts/${row.id}?view=preparation`, reader).expect(200)).body;
  expect(identity.customer.nationalId).toBe('1234567890123');
  expect(identity.contractDocuments).toHaveLength(1);
  const finance = await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'FINANCE' } });
  await db.product.update({ where: { id: row.productId }, data: { ownedByCompanyId: finance.id } });
  expect(
    (await http(`/contracts/${row.id}?view=preparation`, reader).expect(200)).body.product,
  ).toBeNull();
  await grant(reader, ['products.read'], 'FINANCE', [branchA]);
  expect(
    (await http(`/contracts/${row.id}?view=preparation`, reader).expect(200)).body.product.id,
  ).toBe(row.productId);
});
it('keeps bundle availability authorization-derived and denied additions noninterfering', async () => {
  const reader = await user();
  await grant(reader, ['contracts.read', 'contracts.update'], 'SHOP', [branchA]);
  const row = await contract(branchA, undefined, reader);
  const hidden = await db.product.create({
    data: {
      name: 'Hidden bundle',
      brand: 'Apple',
      model: 'Test',
      category: 'ACCESSORY',
      costPrice: 7777,
      branchId: branchB,
    },
  });
  const before = (await http(`/contracts/${row.id}?view=preparation`, reader).expect(200)).body;
  await db.contract.update({ where: { id: row.id }, data: { bundleProductIds: [hidden.id] } });
  const after = (await http(`/contracts/${row.id}?view=preparation`, reader).expect(200)).body;
  expect(before.bundleProducts).toBeNull();
  expect(after.bundleProducts).toBeNull();
  expect(before.availability.bundles).toBe(after.availability.bundles);
  await grant(reader, ['products.read'], 'SHOP', [branchA]);
  const partial = (await http(`/contracts/${row.id}?view=preparation`, reader).expect(200)).body;
  expect(partial.bundleProducts).toEqual([]);
  expect(partial.availability.bundles).toBe('PARTIAL');
});
async function portfolio(size: number) {
  const id = await user();
  await grant(id, ['contracts.read', 'contracts.update'], 'SHOP');
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
        salespersonId: id,
        assignedToId: id,
        planType: 'STORE_WITH_INTEREST',
        sellingPrice: 14000,
        downPayment: 2000,
        financedAmount: 12000,
        interestRate: 0.01,
        totalMonths: 12,
        interestTotal: 1440,
        monthlyPayment: 1120,
        status: 'DRAFT',
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
  return { id, prefix, branches };
}
it('supports exactly 10000 contributors, rejects overflow and recovers by narrowing without truncation', async () => {
  const fixture = await portfolio(10000);
  const queries: string[] = [];
  let competing: Promise<request.Response> | undefined;
  let observation: Promise<boolean> | undefined;
  let competingMs = 0;
  measuredQueries = queries;
  afterContractLockQuery = () => {
    const started = performance.now();
    let done = false;
    competing = http(`/contracts/${contractA}?view=preparation`)
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
  const start = performance.now();
  try {
    const exact = await http(
      '/contracts?view=preparation&limit=1&search=' + fixture.prefix,
      fixture.id,
    ).expect(200);
    const elapsed = performance.now() - start;
    expect(competing).toBeDefined();
    await competing;
    const observed = await observation;
    measuredQueries = undefined;
    expect(exact.body.total).toBe(10000);
    expect(exact.body.totalPages).toBe(10000);
    expect(exact.body.data).toHaveLength(1);
    const sourceLocks = queries.filter(
      (q) =>
        q.includes('FOR SHARE') &&
        (q.includes('FROM contracts') ||
          q.includes('FROM branches b') ||
          q.includes('FROM company_info ci')),
    );
    expect(sourceLocks.length).toBeLessThanOrEqual(12);
    expect(queries.length).toBeLessThan(150);
    expect(observed).toBe(true);
    expect(elapsed).toBeLessThan(5000);
    expect(competingMs).toBeLessThan(5000);
    console.info(
      JSON.stringify({
        scenario: 'SHOP preparation 10000',
        queries: queries.length,
        sourceLocks: sourceLocks.length,
        elapsedMs: Math.round(elapsed),
        unrelatedManagedMs: Math.round(competingMs),
        advisoryWaitObserved: observed,
      }),
    );
  } finally {
    measuredQueries = undefined;
    afterContractLockQuery = undefined;
    await competing;
    await observation;
  }
  const extra = await contract(branchB, undefined, fixture.id);
  await db.contract.update({
    where: { id: extra.id },
    data: { contractNumber: fixture.prefix + '-overflow' },
  });
  const overflow = await http(
    '/contracts?view=preparation&limit=1&search=' + fixture.prefix,
    fixture.id,
  ).expect(400);
  expect(overflow.body).not.toHaveProperty('data');
  expect(overflow.body).not.toHaveProperty('total');
  expect(JSON.stringify(overflow.body)).not.toMatch(/10000|10001|SCALE-/);
  const narrowed = await http(
    '/contracts?view=preparation&limit=1&branchId=' + branchA + '&search=' + fixture.prefix,
    fixture.id,
  ).expect(200);
  expect(narrowed.body.total).toBe(1000);
  const last = await http(
    '/contracts?view=preparation&limit=200&page=5&branchId=' +
      branchA +
      '&search=' +
      fixture.prefix,
    fixture.id,
  ).expect(200);
  expect(last.body.totalPages).toBe(5);
  expect(last.body.data).toHaveLength(200);
  const other = await user();
  await grant(other, ['contracts.read', 'contracts.update']);
  const excluded = await http('/contracts?view=preparation&search=' + fixture.prefix, other).expect(
    200,
  );
  expect(excluded.body.total).toBe(0);
}, 180000);
it('locks an off-page contributor before count and removes it after observed activation wait', async () => {
  const reader = await user();
  await grant(reader, ['contracts.read', 'contracts.update']);
  const row = await contract(branchA, undefined, reader);
  await db.contract.update({ where: { id: row.id }, data: { createdAt: new Date('2001-01-01') } });
  const retained = await contract(branchA, undefined, reader);
  let response: Promise<request.Response> | undefined;
  await db.$transaction(
    async (tx) => {
      const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      await tx.$queryRaw`SELECT id FROM contracts WHERE id=${row.id} FOR UPDATE`;
      response = http('/contracts?view=preparation&limit=1', reader).then((r) => r);
      let observed = false;
      for (let i = 0; i < 200; i++) {
        await tx.$executeRaw`SELECT pg_stat_clear_snapshot()`;
        const [state] = await tx.$queryRaw<
          { waiting: boolean }[]
        >`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND ${pid}=ANY(pg_blocking_pids(pid))) AS waiting`;
        if (state.waiting) {
          observed = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      expect(observed).toBe(true);
      await tx.contract.update({ where: { id: row.id }, data: { status: 'ACTIVE' } });
    },
    { timeout: 10000 },
  );
  const result = await response!;
  expect(result.status).toBe(200);
  expect(result.body.total).toBe(1);
  expect(result.body.data.map((r: { id: string }) => r.id)).toEqual([retained.id]);
});
it('rejects unknown view and never lets unmanaged mode requests fall through to full reads', async () => {
  const reader = await user();
  await grant(reader, ['contracts.read'], 'FINANCE');
  for (const path of ['/contracts', '/contracts/' + contractA]) {
    await http(path + '?view=unknown', reader, 'FINANCE').expect(400);
    await http(path + '?view=preparation&view=other', actor).expect(403);
  }
  await db.user.update({ where: { id: reader }, data: { accessManaged: false } });
  for (const path of ['/contracts', '/contracts/' + contractA])
    await http(path + '?view=preparation', reader).expect(403);
  await http('/contracts/' + contractA, reader, 'FINANCE').expect(200);
});
it('R112 FINANCE Customer lane requires exact independent case authority and pairs sensitive permission', async () => {
  const reader = await user();
  const row = await contract(branchA, reader, reader);
  await grant(reader, ['contracts.read', 'contracts.update'], 'SHOP', [branchA]);
  await grant(
    reader,
    ['customers.read', 'sensitive.customer-identity.read'],
    'FINANCE',
    [branchA],
    'ASSIGNED',
  );
  await db.customer.update({
    where: { id: row.customerId },
    data: { nationalId: '2234567890123', assignedToId: denied },
  });
  expect(
    (await http(`/contracts/${row.id}?view=preparation`, reader).expect(200)).body.customer,
  ).toBeNull();
  await grant(reader, ['contracts.read'], 'FINANCE', [branchA], 'ASSIGNED');
  const readable = (await http(`/contracts/${row.id}?view=preparation`, reader).expect(200)).body;
  expect(readable.customer.id).toBe(row.customerId);
  expect(readable.customer.nationalId).toBe('2234567890123');
  await db.contract.update({ where: { id: row.id }, data: { assignedToId: denied } });
  expect(
    (await http(`/contracts/${row.id}?view=preparation`, reader).expect(200)).body.customer,
  ).toBeNull();
  await grant(reader, ['customers.read'], 'SHOP', [branchA]);
  const masked = (await http(`/contracts/${row.id}?view=preparation`, reader).expect(200)).body;
  expect(masked.customer.id).toBe(row.customerId);
  expect(masked.customer.nationalId).not.toBe('2234567890123');
});
it('R112 does not use readable sibling evidence to reveal this preparation Customer', async () => {
  const reader = await user();
  await grant(reader, ['contracts.read', 'contracts.update']);
  await grant(reader, ['customers.read'], 'SHOP', [branchB]);
  const row = await contract(branchA, undefined, reader);
  const other = await contract(branchB);
  await db.contract.update({ where: { id: other.id }, data: { customerId: row.customerId } });
  expect(
    (await http(`/contracts/${row.id}?view=preparation`, reader).expect(200)).body.customer,
  ).toBeNull();
  expect(
    (await http(`/contracts?view=preparation&customerId=${row.customerId}`, reader).expect(200))
      .body.total,
  ).toBe(0);
});
it.each(['product', 'customer-search', 'document'] as const)(
  'rechecks independent %s after observed child source wait',
  async (mode) => {
    const reader = await user();
    await grant(reader, ['contracts.read', 'contracts.update', 'products.read', 'documents.read']);
    await grant(reader, ['customers.read'], 'SHOP', [branchA], 'ASSIGNED');
    const row = await contract(branchA, undefined, reader);
    await db.customer.update({ where: { id: row.customerId }, data: { assignedToId: reader } });
    const customer = await db.customer.findUniqueOrThrow({ where: { id: row.customerId } });
    const document = await db.signature.create({
      data: { contractId: row.id, signerType: 'CUSTOMER', signatureImage: 'NEVER-SIGNATURE' },
    });
    const foreign = await contract(branchB);
    let response: Promise<request.Response> | undefined;
    await db.$transaction(
      async (tx) => {
        const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
        if (mode === 'product')
          await tx.$queryRaw`SELECT id FROM products WHERE id=${row.productId} FOR UPDATE`;
        else if (mode === 'document')
          await tx.$queryRaw`SELECT id FROM signatures WHERE id=${document.id} FOR UPDATE`;
        else await tx.$queryRaw`SELECT id FROM customers WHERE id=${row.customerId} FOR UPDATE`;
        response = http(
          mode === 'customer-search'
            ? '/contracts?view=preparation&search=' + encodeURIComponent(customer.name)
            : `/contracts/${row.id}?view=preparation`,
          reader,
        ).then((r) => r);
        let observed = false;
        for (let i = 0; i < 200; i++) {
          await tx.$executeRaw`SELECT pg_stat_clear_snapshot()`;
          const [state] = await tx.$queryRaw<
            { waiting: boolean }[]
          >`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND ${pid}=ANY(pg_blocking_pids(pid))) AS waiting`;
          if (state.waiting) {
            observed = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        expect(observed).toBe(true);
        if (mode === 'product') {
          const finance = await tx.companyInfo.findUniqueOrThrow({
            where: { companyCode: 'FINANCE' },
          });
          await tx.product.update({
            where: { id: row.productId },
            data: { ownedByCompanyId: finance.id },
          });
        } else if (mode === 'document')
          await tx.signature.update({
            where: { id: document.id },
            data: { contractId: foreign.id },
          });
        else
          await tx.customer.update({
            where: { id: row.customerId },
            data: { assignedToId: denied },
          });
      },
      { timeout: 10000 },
    );
    const result = await response!;
    expect(result.status).toBe(200);
    if (mode === 'product') expect(result.body.product).toBeNull();
    else if (mode === 'document') expect(result.body.signatures).toEqual([]);
    else expect(result.body.total).toBe(0);
  },
);
it('keeps date/page/filter results exact and returns complete empty authorized child sets only', async () => {
  const owner = await user();
  await db.user.update({ where: { id: owner }, data: { role: 'OWNER' } });
  const row = await contract(branchA, undefined, owner);
  await db.contract.update({
    where: { id: row.id },
    data: { createdAt: new Date('2026-10-18T18:00:00Z') },
  });
  const result = (
    await http(
      `/contracts?view=preparation&salespersonId=${owner}&startDate=2026-10-19&endDate=2026-10-19&page=1&limit=1`,
      owner,
    ).expect(200)
  ).body;
  expect(result.total).toBe(1);
  expect(result.data[0].id).toBe(row.id);
  expect(result.data[0].signatures).toEqual([]);
  expect(result.data[0].availability.signatures).toBe('VISIBLE_CURRENT');
  expect(result.data[0].bundleProducts).toEqual([]);
  expect(result.data[0].availability.bundles).toBe('VISIBLE_CURRENT');
  for (const filter of [
    'page=2147483647&limit=200',
    'startDate=2026-99-99',
    'startDate=2026-10-20&endDate=2026-10-19',
    'search=a&search=b',
  ])
    await http('/contracts?view=preparation&' + filter).expect(400);
  await http(`/contracts/${contractA}?view=preparation&status=DRAFT`).expect(400);
});
