import { AccessContractDerivedBoundaries } from './access-contract-derived-boundaries';
import { requestedAccessCompany } from './access-shop-boundaries';
import { ContractActivation1ATemplate } from '../journal/cpa-templates/contract-activation-1a.template';
import { JournalAutoService } from '../journal/journal-auto.service';
import { AccessContractConsentAuthority } from './access-contract-consent-authority';
import { AuditService } from '../audit/audit.service';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { AccessContractReadBoundaries } from './access-contract-read-boundaries';
import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
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
  !url?.includes('/bc_access_contract_derived?host=/tmp/bc-access-contract-derived.') ||
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
      collectionNotes: 'Private collector note',
      contractHash: 'NEVER-HASH',
      status: 'ACTIVE',
      payments: { create: { installmentNo: 1, dueDate: new Date(), amountDue: 1100 } },
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
    .expect('x-owned-contract-derived-app', marker);
}
beforeAll(async () => {
  const shop = await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'SHOP' } });
  branchA = (await db.branch.create({ data: { name: 'A', companyId: shop.id } })).id;
  branchB = (await db.branch.create({ data: { name: 'B', companyId: shop.id } })).id;
  actor = await user();
  denied = await user();
  assigned = await user();
  warranty = await user();
  await grant(
    actor,
    [
      'contracts.read',
      'contracts.export',
      'payments.read',
      'documents.read',
      'contract-documents.read',
      'customers.read',
      'collections.read',
      'collection-contacts.read',
      'payment-promises.read',
    ],
    'FINANCE',
    [branchA],
  );
  await grant(actor, ['journal.read', 'sensitive.cost.read', 'sensitive.profit.read'], 'FINANCE');
  await grant(actor, ['contracts.read', 'products.read', 'customers.read'], 'SHOP', [branchB]);
  await grant(assigned, ['contracts.read'], 'FINANCE', [branchA], 'ASSIGNED');
  await grant(warranty, ['contracts.read'], 'SHOP', [branchA]);
  contractA = (await contract(branchA)).id;
  assignedCase = (await contract(branchA, assigned)).id;
  sibling = (await contract(branchA, undefined, assigned)).id;
  for (let i = 0; i < 5; i++) contractB = (await contract(branchB)).id;
  await db.user.create({
    data: {
      name: 'Owned fixture system',
      email: 'admin@bestchoice.com',
      password: 'unused',
      role: 'OWNER',
    },
  });
  await db.chartOfAccount.createMany({
    data: ['11-2101', '11-2105', '21-1101', '21-1102', '11-2106', '21-2102'].map((code) => ({
      code,
      name: code,
      type: 'สินทรัพย์',
      normalBalance: 'Dr',
    })),
    skipDuplicates: true,
  });
  await new ContractActivation1ATemplate(
    new JournalAutoService(db as PrismaService),
    db as PrismaService,
  ).execute(contractA);
  const module = await Test.createTestingModule({
    controllers: [ContractsController],
    providers: [
      { provide: AuditService, useValue: { log: jest.fn().mockResolvedValue(undefined) } },
      ContractDocumentService,
      ContractSnapshotService,
      ContractJournalQueryService,
      AccessContractConsentAuthority,
      AccessContractReadBoundaries,
      AccessContractDerivedBoundaries,
      AccessResourceService,
      AccessPartySourceService,
      AccessProcurementSourceService,
      AccessPolicyService,
      { provide: PrismaService, useValue: db },
      { provide: AccessSnapshotService, useValue: snapshots },
      {
        provide: ContractsService,
        useValue: new ContractsService(db as PrismaService, {} as never, {} as never, {} as never),
      },
      ...[
        ContractWorkflowService,
        ContractPaymentService,
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
      req: { headers: Record<string, string>; query: Record<string, unknown> },
      res: { setHeader: (key: string, value: string) => void },
      next: () => void,
    ) => {
      res.setHeader('x-owned-contract-derived-app', marker);
      res.setHeader('x-owned-request', req.headers['x-owned-request'] ?? '');
      res.setHeader('x-selected-company', requestedAccessCompany(req));
      next();
    },
  );
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address();
  expect(address.address).toBe('127.0.0.1');
  console.log(
    'Owned derived HTTP listener',
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

const routes = [
  ['export', () => '/contracts/export'],
  ['dashboard', () => '/contracts/document-dashboard'],
  ['milestones', () => '/contracts/milestones-summary'],
  ['snapshot', () => `/contracts/${contractA}/snapshot`],
] as const;
it.each(routes)('authorized %s returns useful scoped data', async (kind, path) => {
  const res = await http(path()).expect(200);
  expect(res.body.scope).toBe('authorized-sources');
  if (kind === 'export') {
    expect(res.body.total).toBe(3);
    expect(res.body.data.map((r: { id: string }) => r.id)).toContain(contractA);
  } else if (kind === 'dashboard') expect(res.body.totalContracts).toBe(3);
  else if (kind === 'milestones') expect(res.body.newThisMonth.count).toBe(3);
  else if (kind === 'snapshot') {
    expect(res.body.contractId).toBe(contractA);
    expect(res.body.totals.outstanding).toBe(1100);
  }
  expect(JSON.stringify(res.body)).not.toContain('NEVER-HASH');
  expect(JSON.stringify(res.body)).not.toContain('NEVER-RAW-NOTES');
});
it.each(routes)('no grants denies %s', async (_kind, path) => {
  await http(path(), denied).expect(403);
});
it.each(routes)('wrong context denies %s', async (_kind, path) => {
  await http(path(), actor, 'SHOP').expect(403);
});
it.each(['snapshot'])('foreign original tuples deny %s', async (suffix) => {
  await http(`/contracts/${contractB}/${suffix}`).expect(403);
});
it('current assigned source and asymmetric original tuples constrain snapshot', async () => {
  await http(`/contracts/${assignedCase}/snapshot`, assigned).expect(200);
  await http(`/contracts/${sibling}/snapshot`, assigned).expect(403);
  await db.contract.update({ where: { id: assignedCase }, data: { assignedToId: null } });
  await http(`/contracts/${assignedCase}/snapshot`, assigned).expect(403);
});
it('export permission alone cannot borrow read from a different source', async () => {
  const split = await user();
  await grant(split, ['contracts.export'], 'FINANCE', [branchA]);
  await grant(split, ['contracts.read'], 'FINANCE', [branchB]);
  const result = await http('/contracts/export', split).expect(200);
  expect(result.body.total).toBe(0);
  expect(result.body.data).toEqual([]);
});

it('keeps independent unavailable categories null and protects Customer/status filters before export', async () => {
  const id = await user();
  const row = await contract(branchA, id);
  await grant(id, ['contracts.read', 'contracts.export'], 'FINANCE', [branchA], 'ASSIGNED');
  await grant(id, ['customers.read', 'payments.read', 'documents.read'], 'FINANCE', [branchB]);
  await grant(id, ['products.read'], 'SHOP', [branchB]);
  const snap = (await http(`/contracts/${row.id}/snapshot`, id).expect(200)).body;
  expect(snap).toMatchObject({
    customer: null,
    product: null,
    status: null,
    totals: null,
    lastPromise: null,
    lastLine: null,
    lastCollectorComment: null,
  });
  const exported = (await http('/contracts/export', id).expect(200)).body;
  expect(exported.total).toBe(1);
  expect(exported.data[0]).toMatchObject({
    customer: null,
    product: null,
    salesperson: null,
    status: null,
  });
  for (const query of [
    `customerId=${row.customerId}`,
    'status=ACTIVE',
    `search=${encodeURIComponent((await db.customer.findUniqueOrThrow({ where: { id: row.customerId } })).name)}`,
  ]) {
    expect((await http('/contracts/export?' + query, id).expect(200)).body.total).toBe(0);
  }
  const base = await user();
  await grant(base, ['contracts.read'], 'FINANCE', [branchA]);
  const dashboard = (await http('/contracts/document-dashboard', base).expect(200)).body;
  expect(dashboard).toMatchObject({
    fullyDocumented: null,
    pendingDocuments: null,
    pendingSignatures: null,
    recentActivity: null,
    overdueContracts: null,
    documentContracts: null,
    paymentContracts: null,
  });
  const milestones = (await http('/contracts/milestones-summary', base).expect(200)).body;
  expect(milestones).toMatchObject({
    newThisMonth: { count: null, totalAmount: null },
    completingThisMonth: { count: null, totalAmount: null },
    recentNewContracts: null,
    finalInstallmentsThisMonth: null,
  });
});

it('uses real staff branch/company authority and finite Customer/Product labels in export', async () => {
  const id = await user(),
    seller = await user(),
    row = await contract(branchA, id, seller);
  await db.user.update({ where: { id: seller }, data: { branchId: branchB } });
  await grant(
    id,
    ['contracts.read', 'contracts.export', 'customers.read', 'payments.read'],
    'FINANCE',
    [branchA],
    'ASSIGNED',
  );
  await grant(id, ['products.read', 'employees.read'], 'SHOP', [branchA]);
  let res = (await http('/contracts/export', id).expect(200)).body;
  expect(res.data[0].salesperson).toBeNull();
  expect(res.data[0].customer).toMatchObject({ id: row.customerId, phone: '0811111111' });
  expect(res.data[0].product.id).toBe(row.productId);
  expect(res.data[0].product.costPrice).toBeUndefined();
  await grant(id, ['employees.read'], 'SHOP', [branchB]);
  res = (await http('/contracts/export', id).expect(200)).body;
  expect(res.data[0].salesperson).toEqual({ id: seller, name: 'Test' });
  await db.user.update({ where: { id: seller }, data: { isSystemUser: true } });
  expect((await http('/contracts/export', id).expect(200)).body.data[0].salesperson).toBeNull();
});

it('separates dashboard eDocument/signature metrics from proven retained document history before top20', async () => {
  const id = await user(),
    row = await contract(branchA, id);
  await grant(id, ['contracts.read', 'documents.read'], 'FINANCE', [branchA], 'ASSIGNED');
  await db.eDocument.createMany({
    data: ['ID_CARD_COPY', 'KYC_SELFIE', 'DEVICE_PHOTO', 'DEVICE_IMEI_PHOTO'].map(
      (documentType) => ({
        contractId: row.id,
        documentType,
        fileUrl: 'PRIVATE-FILE',
        fileHash: 'PRIVATE-HASH',
        createdById: actor,
      }),
    ),
  });
  await db.signature.createMany({
    data: (['CUSTOMER', 'STAFF', 'WITNESS_1', 'WITNESS_2'] as const).map((signerType) => ({
      contractId: row.id,
      signerType,
      signatureImage: 'PRIVATE-SIGNATURE',
    })),
  });
  const retained = await db.contractDocument.create({
    data: {
      contractId: row.id,
      documentType: 'SIGNED_CONTRACT',
      fileName: 'private',
      fileUrl: 'PRIVATE-KEY',
      uploadedById: actor,
      deletedAt: new Date(),
    },
  });
  const valid = await db.documentAuditLog.create({
    data: {
      documentId: retained.id,
      contractId: row.id,
      action: 'VIEW',
      details: { secret: 'PRIVATE-AUDIT' },
      createdAt: new Date('2025-01-01'),
    },
  });
  await db.documentAuditLog.createMany({
    data: Array.from({ length: 25 }, () => ({
      documentId: randomUUID(),
      contractId: row.id,
      action: 'VIEW',
    })),
  });
  await db.documentAuditLog.create({
    data: { documentId: retained.id, contractId: row.id, action: 'ARBITRARY-PRIVATE-ACTION' },
  });
  let res = (await http('/contracts/document-dashboard', id).expect(200)).body;
  expect(res).toMatchObject({
    totalContracts: 1,
    documentContracts: 1,
    fullyDocumented: 1,
    pendingSignatures: 0,
    recentActivity: null,
  });
  await grant(id, ['contract-documents.read'], 'FINANCE', [branchA], 'ASSIGNED');
  res = (await http('/contracts/document-dashboard', id).expect(200)).body;
  expect(res.recentActivity.map((a: { id: string }) => a.id)).toEqual([valid.id]);
  expect(JSON.stringify(res)).not.toContain('PRIVATE');
  await db.eDocument.updateMany({
    where: { contractId: row.id, documentType: 'ID_CARD_COPY' },
    data: { deletedAt: new Date() },
  });
  await db.signature.updateMany({
    where: { contractId: row.id, signerType: 'WITNESS_2' },
    data: { deletedAt: new Date() },
  });
  res = (await http('/contracts/document-dashboard', id).expect(200)).body;
  expect(res).toMatchObject({ fullyDocumented: 0, pendingDocuments: 1, pendingSignatures: 1 });
  const historyOnly = await user();
  await grant(historyOnly, ['contracts.read', 'contract-documents.read'], 'FINANCE', [branchA]);
  res = (await http('/contracts/document-dashboard', historyOnly).expect(200)).body;
  expect(res.fullyDocumented).toBeNull();
  expect(res.recentActivity.some((a: { id: string }) => a.id === valid.id)).toBe(true);
});

it('counts all authorized final installments beyond20 while returning only five previews', async () => {
  const id = await user();
  await grant(id, ['contracts.read', 'payments.read'], 'FINANCE', [branchA], 'ASSIGNED');
  for (let i = 0; i < 25; i++) await contract(branchA, id);
  const decoy = await contract(branchA, id);
  await db.payment.create({
    data: {
      contractId: decoy.id,
      installmentNo: 2,
      dueDate: new Date('2099-01-01'),
      amountDue: 999,
    },
  });
  await contract(branchB, id);
  const res = (await http('/contracts/milestones-summary', id).expect(200)).body;
  expect(res.newThisMonth).toEqual({ count: 26, totalAmount: 260000 });
  expect(res.completingThisMonth).toEqual({ count: 25, totalAmount: 27500 });
  expect(res.recentNewContracts).toHaveLength(5);
  expect(res.finalInstallmentsThisMonth).toHaveLength(5);
  expect(
    res.recentNewContracts.every((r: { customerName: string | null }) => r.customerName === null),
  ).toBe(true);
  expect(res.availability.completingThisMonth).toBe('PARTIAL');
});

it('uses canonical debt and independent promise/contact/chat source categories', async () => {
  const id = await user(),
    row = await contract(branchA, id);
  await grant(
    id,
    ['contracts.read', 'payments.read', 'collections.read', 'payment-promises.read'],
    'FINANCE',
    [branchA],
    'ASSIGNED',
  );
  await db.payment.updateMany({
    where: { contractId: row.id },
    data: { status: 'PAID', amountPaid: 1000 },
  });
  await db.callLog.create({
    data: {
      contractId: row.id,
      calledAt: new Date(),
      result: 'PROMISED',
      settlementDate: new Date(),
      notes: 'PRIVATE-CONTACT',
      brokenAt: new Date(),
    },
  });
  let res = (await http(`/contracts/${row.id}/snapshot`, id).expect(200)).body;
  expect(res.totals.outstanding).toBe(0);
  expect(res.lastPromise).toMatchObject({ result: 'BROKEN', notes: null });
  expect(res.lastCollectorComment).toBeNull();
  await grant(id, ['collection-contacts.read'], 'FINANCE', [branchA], 'ASSIGNED');
  res = (await http(`/contracts/${row.id}/snapshot`, id).expect(200)).body;
  expect(res.lastPromise.notes).toBe('PRIVATE-CONTACT');
  expect(res.lastCollectorComment.text).toBe('Private collector note');
  const room = await db.chatRoom.create({
    data: { customerId: row.customerId, channel: 'LINE_FINANCE', assignedToId: id },
  });
  await db.chatMessage.create({
    data: {
      roomId: room.id,
      role: 'CUSTOMER',
      createdAt: new Date('2025-01-01'),
      readAt: new Date(),
      text: 'PRIVATE-CHAT',
    },
  });
  const hidden = await db.chatRoom.create({
    data: { customerId: row.customerId, channel: 'LINE_FINANCE', assignedToId: denied },
  });
  await db.chatMessage.create({
    data: { roomId: hidden.id, role: 'CUSTOMER', text: 'HIDDEN-CHAT' },
  });
  await grant(id, ['chat.read'], 'FINANCE', undefined, 'ASSIGNED');
  res = (await http(`/contracts/${row.id}/snapshot`, id).expect(200)).body;
  expect(res.lastLine).toEqual({ timestamp: '2025-01-01T00:00:00.000Z', read: true });
  expect(res.availability.chat).toBe('PARTIAL');
  expect(JSON.stringify(res)).not.toContain('PRIVATE-CHAT');
  await db.chatRoom.update({ where: { id: room.id }, data: { assignedToId: denied } });
  expect((await http(`/contracts/${row.id}/snapshot`, id).expect(200)).body.lastLine).toBeNull();
});

it('commits actual export wrapper audit and returns no data on late audit failure', async () => {
  const id = await user(),
    row = await contract(branchA, id);
  await grant(id, ['contracts.read', 'contracts.export'], 'FINANCE', [branchA], 'ASSIGNED');
  const result = (await http('/contracts/export', id).expect(200)).body;
  const audit = await db.auditLog.findFirstOrThrow({
    where: { userId: id, action: 'CONTRACTS_REPORT_EXPORTED' },
  });
  expect(audit.newValue).toMatchObject({ rowCount: 1, asOf: result.asOf, role: 'ACCOUNTANT' });
  expect(audit.rowHash).toBeTruthy();
  const before = await db.auditLog.count({
    where: { userId: id, action: 'CONTRACTS_REPORT_EXPORTED' },
  });
  await db.$executeRawUnsafe(
    `CREATE FUNCTION reject_derived_export() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='CONTRACTS_REPORT_EXPORTED' THEN RAISE EXCEPTION 'owned audit failure'; END IF; RETURN NEW; END $$`,
  );
  await db.$executeRawUnsafe(
    `CREATE TRIGGER reject_derived_export BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_derived_export()`,
  );
  try {
    const failed = await http('/contracts/export', id).expect(500);
    expect(failed.body.data).toBeUndefined();
    expect(failed.text).not.toContain(row.contractNumber);
    expect(
      await db.auditLog.count({ where: { userId: id, action: 'CONTRACTS_REPORT_EXPORTED' } }),
    ).toBe(before);
  } finally {
    await db.$executeRawUnsafe('DROP TRIGGER reject_derived_export ON audit_logs');
    await db.$executeRawUnsafe('DROP FUNCTION reject_derived_export()');
  }
});

async function observedWait(tx: Prisma.TransactionClient, pid: number) {
  for (let i = 0; i < 200; i++) {
    await tx.$executeRaw`SELECT pg_stat_clear_snapshot()`;
    const [state] = await tx.$queryRaw<
      { waiting: boolean }[]
    >`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND ${pid}=ANY(pg_blocking_pids(pid))) AS waiting`;
    if (state.waiting) return true;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return false;
}
it.each(['export', 'document-dashboard', 'milestones-summary', 'snapshot'])(
  'rechecks actual Contract source after observed wait for %s',
  async (route) => {
    const id = await user(),
      row = await contract(branchA, id);
    await grant(
      id,
      ['contracts.read', 'contracts.export', 'payments.read'],
      'FINANCE',
      [branchA],
      'ASSIGNED',
    );
    let pending: Promise<request.Response> | undefined;
    await db.$transaction(
      async (tx) => {
        const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
        await tx.$queryRaw`SELECT id FROM contracts WHERE id=${row.id} FOR UPDATE`;
        pending = http(
          route === 'snapshot' ? `/contracts/${row.id}/snapshot` : `/contracts/${route}`,
          id,
        ).then((res) => res);
        expect(await observedWait(tx, pid)).toBe(true);
        await tx.contract.update({ where: { id: row.id }, data: { assignedToId: denied } });
      },
      { timeout: 10000 },
    );
    const res = await pending!;
    if (route === 'snapshot') expect(res.status).toBe(403);
    else {
      expect(res.status).toBe(200);
      expect(
        route === 'export'
          ? res.body.total
          : route === 'document-dashboard'
            ? res.body.totalContracts
            : res.body.newThisMonth.count,
      ).toBe(0);
    }
  },
);

it.each(['product', 'staff', 'room'])(
  'rechecks independent %s source after an observed real row wait',
  async (kind) => {
    const id = await user(),
      seller = await user(),
      row = await contract(branchA, id, seller);
    await db.user.update({ where: { id: seller }, data: { branchId: branchA } });
    await grant(id, ['contracts.read', 'contracts.export'], 'FINANCE', [branchA], 'ASSIGNED');
    await grant(id, ['products.read', 'employees.read'], 'SHOP', [branchA]);
    await grant(id, ['chat.read'], 'FINANCE', undefined, 'ASSIGNED');
    const room = await db.chatRoom.create({
      data: { customerId: row.customerId, channel: 'LINE_FINANCE', assignedToId: id },
    });
    await db.chatMessage.create({
      data: { roomId: room.id, role: 'CUSTOMER', text: 'source-wait' },
    });
    let pending: Promise<request.Response> | undefined;
    await db.$transaction(
      async (tx) => {
        const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
        if (kind === 'product')
          await tx.$queryRaw`SELECT id FROM products WHERE id=${row.productId} FOR UPDATE`;
        else if (kind === 'staff')
          await tx.$queryRaw`SELECT id FROM users WHERE id=${seller} FOR UPDATE`;
        else await tx.$queryRaw`SELECT id FROM chat_rooms WHERE id=${room.id} FOR UPDATE`;
        pending = http(
          kind === 'room' ? `/contracts/${row.id}/snapshot` : '/contracts/export',
          id,
        ).then((res) => res);
        expect(await observedWait(tx, pid)).toBe(true);
        if (kind === 'product')
          await tx.product.update({ where: { id: row.productId }, data: { branchId: branchB } });
        else if (kind === 'staff')
          await tx.user.update({ where: { id: seller }, data: { branchId: branchB } });
        else await tx.chatRoom.update({ where: { id: room.id }, data: { assignedToId: denied } });
      },
      { timeout: 10000 },
    );
    const res = await pending!;
    expect(res.status).toBe(200);
    if (kind === 'room') expect(res.body.lastLine).toBeNull();
    else expect(res.body.data[0][kind === 'product' ? 'product' : 'salesperson']).toBeNull();
  },
);

async function portfolio(size: number) {
  const id = await user();
  await grant(
    id,
    ['contracts.read', 'contracts.export', 'payments.read', 'customers.read'],
    'FINANCE',
  );
  await grant(id, ['products.read'], 'SHOP');
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
  'bounds actual buffered export queries and lock contention at %i distinct cases',
  async (size) => {
    const fixture = await portfolio(size);
    if (size === 10000) supportedPortfolio = fixture;
    const other = await user();
    await grant(other, ['contracts.read'], 'FINANCE', [branchA]);
    let competing: Promise<request.Response> | undefined, observation: Promise<boolean> | undefined;
    let competingMs = 0;
    measuredQueries = [];
    afterContractLockQuery = () => {
      const started = performance.now();
      let done = false;
      competing = http(`/contracts/${contractA}/snapshot`, other)
        .expect(200)
        .then((res) => {
          competingMs = performance.now() - started;
          done = true;
          return res;
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
      const res = await http('/contracts/export?search=' + fixture.prefix, fixture.id).expect(200);
      const elapsed = performance.now() - started;
      await competing;
      expect(await observation).toBe(true);
      const queries = measuredQueries!;
      measuredQueries = undefined;
      const locks = queries.filter(
        (q) =>
          q.includes('FOR SHARE') &&
          (q.includes('FROM contracts') ||
            q.includes("company_code='FINANCE'") ||
            q.includes('JOIN contracts c')),
      ).length;
      console.log(
        'DERIVED_EXPORT_ENVELOPE',
        JSON.stringify({
          size,
          queries: queries.length,
          sourceLocks: locks,
          ms: elapsed,
          competingMs,
          bytes: Buffer.byteLength(res.text),
        }),
      );
      expect(res.body.total).toBe(size);
      expect(res.body.data).toHaveLength(size);
      expect(
        res.body.data.every(
          (r: { customer: unknown; product: unknown }) => r.customer && r.product,
        ),
      ).toBe(true);
      expect(queries.length).toBeLessThan(150);
      expect(locks).toBeLessThanOrEqual(12);
    } finally {
      measuredQueries = undefined;
      afterContractLockQuery = undefined;
      await competing;
    }
  },
  60000,
);
it('rejects10001 before partial export and supports genuine narrowed recovery', async () => {
  const fixture = supportedPortfolio!;
  const extra = await contract(branchA);
  await db.contract.update({
    where: { id: extra.id },
    data: { contractNumber: fixture.prefix + '-overflow' },
  });
  const deniedRes = await http('/contracts/export?search=' + fixture.prefix, fixture.id).expect(
    400,
  );
  expect(deniedRes.body.data).toBeUndefined();
  expect(deniedRes.body.total).toBeUndefined();
  expect(deniedRes.text).not.toContain(extra.id);
  const narrowed = await http(
    '/contracts/export?search=' + fixture.prefix + '&branchId=' + branchA,
    fixture.id,
  ).expect(200);
  expect(narrowed.body.total).toBe(1001);
  const scoped = await user();
  await grant(scoped, ['contracts.read', 'contracts.export'], 'FINANCE', [branchB]);
  expect(
    (await http('/contracts/export?search=' + fixture.prefix, scoped).expect(200)).body.total,
  ).toBe(1000);
}, 60000);

it('keeps base SLA and payment status totals in independently authorized category subsets', async () => {
  const id = await user(),
    row = await contract(branchA, id);
  await grant(id, ['contracts.read'], 'FINANCE', [branchA], 'ASSIGNED');
  await db.contract.update({
    where: { id: row.id },
    data: { status: 'OVERDUE', updatedAt: new Date('2020-01-01') },
  });
  let res = (await http('/contracts/document-dashboard', id).expect(200)).body;
  expect(res).toMatchObject({ totalContracts: 1, pendingApproval: 1, overdueContracts: null });
  expect(res.slaAlerts).toHaveLength(1);
  expect(res.slaAlerts[0].customerName).toBeNull();
  await grant(id, ['payments.read'], 'FINANCE', [branchA], 'ASSIGNED');
  res = (await http('/contracts/document-dashboard', id).expect(200)).body;
  expect(res).toMatchObject({
    paymentContracts: 1,
    overdueContracts: 1,
    availability: { payments: 'PARTIAL' },
  });
  expect(
    (await http('/contracts/document-dashboard?branchId=' + branchB, id).expect(200)).body
      .totalContracts,
  ).toBe(0);
});
it('rejects invalid filters and genuine inactive original branches without leaking counts', async () => {
  // Export retains the same finite list DTO: a syntactically valid unknown ID is an empty set.
  expect((await http('/contracts/export?branchId=missing').expect(200)).body.total).toBe(0);
  for (const path of [
    '/contracts/export?unknown=private',
    '/contracts/export?limit=201',
    '/contracts/export?page=999999999999',
    '/contracts/document-dashboard?branchId=wrong',
    '/contracts/milestones-summary?status=ACTIVE',
    `/contracts/${contractA}/snapshot?view=preparation`,
  ])
    await http(path).expect(400);
  const shop = await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'SHOP' } });
  const branch = await db.branch.create({
    data: { name: 'Inactive original', companyId: shop.id },
  });
  const id = await user(),
    row = await contract(branch.id);
  await grant(id, ['contracts.read', 'contracts.export'], 'FINANCE');
  await db.branch.update({ where: { id: branch.id }, data: { isActive: false } });
  await http(`/contracts/${row.id}/snapshot`, id).expect(403);
  expect(
    (await http('/contracts/export?search=' + row.contractNumber, id).expect(200)).body.total,
  ).toBe(0);
});
it('uses protected owner global attribution without inventing employee branch provenance', async () => {
  const owner = await user(),
    seller = await user(),
    row = await contract(branchA, undefined, seller);
  await db.user.update({ where: { id: owner }, data: { role: 'OWNER' } });
  const res = (await http('/contracts/export?search=' + row.contractNumber, owner).expect(200))
    .body;
  expect(res.data[0].salesperson).toEqual({ id: seller, name: 'Test' });
  expect(res.data[0].availability.salesperson).toBe('VISIBLE_CURRENT');
});
it('propagates document audit read failure instead of declaring an empty complete history', async () => {
  const id = await user(),
    row = await contract(branchA, id);
  await grant(id, ['contracts.read', 'contract-documents.read'], 'FINANCE', [branchA], 'ASSIGNED');
  await db.$executeRawUnsafe(
    'ALTER TABLE document_audit_logs RENAME TO owned_hidden_document_audit_logs',
  );
  try {
    const result = await http('/contracts/document-dashboard', id).expect(500);
    expect(result.body.recentActivity).toBeUndefined();
    expect(result.text).not.toContain(row.contractNumber);
  } finally {
    await db.$executeRawUnsafe(
      'ALTER TABLE owned_hidden_document_audit_logs RENAME TO document_audit_logs',
    );
  }
});
