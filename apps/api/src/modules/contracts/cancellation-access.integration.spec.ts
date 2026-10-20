import * as postingPeriods from './managed-payoff-execution';
import { Logger } from '@nestjs/common';
import { AccessContractCancellationBoundaries } from '../employee-access/access-contract-cancellation-boundaries';
import { Test } from '@nestjs/testing';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { ContractsController } from './contracts.controller';
import { ContractsService } from './contracts.service';
import { ContractWorkflowService } from './contract-workflow.service';
import { ContractDocumentService } from './contract-document.service';
import { ContractSnapshotService } from './contract-snapshot.service';
import { ContractJournalQueryService } from '../journal/contract-journal-query.service';
import { EarlyPayoffSlipService } from './early-payoff-slip/early-payoff-slip.service';
import { AccessPartySourceService } from '../employee-access/access-party-source.service';
import { AccessProcurementSourceService } from '../employee-access/access-procurement-source.service';
import { AccessPolicyService } from '../employee-access/access-policy';
import { AccessPolicyInterceptor } from '../employee-access/access-policy.interceptor';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { AuditService } from '../audit/audit.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BranchGuard } from '../auth/guards/branch.guard';
import { Prisma, PrismaClient } from '@prisma/client';
import { PermissionKey } from '@installment/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { ContractPaymentService } from './contract-payment.service';
import { JournalAutoService } from '../journal/journal-auto.service';
import { EclStageReverseTemplate } from '../journal/cpa-templates/ecl-stage-reverse.template';
import { JourneyEntryWriter } from '../customer-journey/journey-entry-writer.service';
import { AccessSnapshotService } from '../employee-access/access-snapshot.service';
import { AccessResourceService } from '../employee-access/access-resource.service';

import { randomUUID } from 'node:crypto';
import { TradeInCreditService } from '../trade-in/services/trade-in-credit.service';
import { requestedAccessCompany } from '../employee-access/access-shop-boundaries';

jest.mock('@sentry/nestjs', () => ({ captureMessage: jest.fn(), captureException: jest.fn() }));
import { ExchangeCancelReversalTemplate } from '../journal/cpa-templates/exchange-cancel-reversal.template';
import { ContractCancellationTemplate } from '../journal/cpa-templates/contract-cancellation.template';
import { ShopDownPaymentTemplate } from '../journal/cpa-templates/shop-down-payment.template';
import { ShopDownPaymentReversalTemplate } from '../journal/cpa-templates/shop-down-payment-reversal.template';
import { CompanyResolverService } from '../journal/company-resolver.service';
import { ShopAccountResolver } from '../journal/shop-account-resolver.service';

const url = process.env.CONTRACT_CANCELLATION_TEST_DATABASE_URL;
if (
  !url?.includes('/bc_contract_cancellation?host=/tmp/bc-contract-cancellation.') ||
  process.env.DATABASE_URL !== url ||
  process.env.DATABASE_URL_FINANCE !== url
)
  throw new Error('Both database URLs must identify the owned cancellation cluster');
const db = new PrismaClient({ datasources: { db: { url } } });
const prisma = db as PrismaService;
const snapshots = new AccessSnapshotService(prisma);
const journal = new JournalAutoService(prisma);
const resolver = new CompanyResolverService(prisma);
const sweep = new ExchangeCancelReversalTemplate(journal, prisma);
const template = new ContractCancellationTemplate(
  prisma,
  sweep,
  new EclStageReverseTemplate(journal, prisma),
);
const service = new ContractsService(
  prisma,
  new ShopDownPaymentTemplate(journal, prisma, resolver),
  new ShopDownPaymentReversalTemplate(journal, prisma, resolver),
  new ShopAccountResolver(prisma),
  undefined,
  template,
  undefined,
  undefined,
  resolver,
);
let actor: string,
  owner: string,
  legacy: string,
  denied: string,
  finance: string,
  shop: string,
  branch: string,
  foreignBranch: string;
const writes: PermissionKey[] = [
  'contracts.read',
  'sales.cancel.request',
  'customers.read',
  'products.read',
  'payments.read',
];
async function person(
  role: 'OWNER' | 'ACCOUNTANT' = 'ACCOUNTANT',
  managed = true,
  email = randomUUID() + '@test.invalid',
) {
  return (
    await db.user.create({
      data: { name: 'Owned actor', email, password: 'unused', role, accessManaged: managed },
    })
  ).id;
}
async function grant(
  userId: string,
  permissions = writes,
  companyCode = 'FINANCE',
  branchIds?: string[],
) {
  const position = await db.accessPosition.create({
    data: { code: randomUUID(), name: 'Owned position', permissions },
  });
  return db.employeeAccessAssignment.create({
    data: {
      userId,
      positionId: position.id,
      companyCode,
      scope: branchIds ? 'BRANCHES' : 'COMPANY',
      ...(branchIds ? { branches: { create: branchIds.map((branchId) => ({ branchId })) } } : {}),
    },
  });
}
async function contract(draft = false, branchId = branch) {
  const customer = await db.customer.create({
    data: { name: 'Owned customer', phone: '0800000000' },
  });
  const product = await db.product.create({
    data: {
      name: 'Owned phone',
      brand: 'Apple',
      model: 'Test',
      category: 'PHONE_NEW',
      costPrice: 6000,
      branchId,
      ownedByCompanyId: draft ? shop : finance,
      status: draft ? 'RESERVED' : 'SOLD_INSTALLMENT',
    },
  });
  return db.contract.create({
    data: {
      contractNumber: 'CANCEL-OWNED-' + randomUUID(),
      customerId: customer.id,
      productId: product.id,
      branchId,
      salespersonId: actor,
      planType: 'STORE_WITH_INTEREST',
      sellingPrice: 12000,
      downPayment: 0,
      financedAmount: 12000,
      totalMonths: 12,
      monthlyPayment: 1000,
      interestRate: 0,
      interestTotal: 0,
      vatAmount: 0,
      vatPct: 0,
      status: draft ? 'DRAFT' : 'ACTIVE',
      workflowStatus: 'CREATING',
    },
  });
}
async function ledger(contractId: string) {
  return db.journalEntry.create({
    data: {
      entryNumber: 'SOURCE-' + randomUUID(),
      entryDate: new Date(),
      postedAt: new Date(),
      description: 'Owned canonical activation fixture',
      status: 'POSTED',
      createdById: legacy,
      companyId: finance,
      metadata: { contractId, tag: '1A', flow: 'installment-sale' },
      lines: {
        create: [
          { accountCode: '11-2101', debit: 12000, credit: 0 },
          { accountCode: '21-1101', debit: 0, credit: 12000 },
        ],
      },
    },
  });
}
async function pending(contractId: string, refundAmount = 0) {
  return db.contractCancellation.create({
    data: { contractId, requestedById: actor, reason: 'Owned cancellation', refundAmount },
  });
}
let app: INestApplication;
const marker = randomUUID();
async function http(
  method: 'get' | 'post' | 'delete',
  path: string,
  who = actor,
  body: object = {},
  company = 'FINANCE',
) {
  const client = request(app.getHttpServer());
  const response = await client[method](path)
    .set('x-test-user', who)
    .set('x-company-scope', company)
    .send(body);
  expect(response.headers['x-owned-cancellation-app']).toBe(marker);
  expect(response.headers['x-owned-selected-company']).toBe(company);
  return response;
}
beforeAll(async () => {
  finance = (await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'FINANCE' } })).id;
  shop = (await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'SHOP' } })).id;
  branch = (await db.branch.create({ data: { name: 'Owned origin', companyId: shop } })).id;
  foreignBranch = (await db.branch.create({ data: { name: 'Foreign origin', companyId: shop } }))
    .id;
  actor = await person();
  owner = await person('OWNER');
  denied = await person();
  legacy = await person('OWNER', false, 'admin@bestchoice.com');
  await grant(actor, writes, 'FINANCE', [branch]);
  await grant(actor, ['customers.read', 'products.read'], 'SHOP', [branch]);
  for (const code of ['11-2101', '21-1101', 'S11-1101', 'S21-2001'])
    await db.chartOfAccount.upsert({
      where: { code },
      update: {},
      create: { code, name: 'Owned ' + code, type: 'สินทรัพย์', normalBalance: 'Dr' },
    });
  const module = await Test.createTestingModule({
    controllers: [ContractsController],
    providers: [
      AccessContractCancellationBoundaries,
      AccessResourceService,
      AccessPartySourceService,
      AccessProcurementSourceService,
      AccessPolicyService,
      { provide: PrismaService, useValue: prisma },
      { provide: AccessSnapshotService, useValue: snapshots },
      { provide: ContractsService, useValue: service },
      ...[
        ContractPaymentService,
        ContractWorkflowService,
        ContractDocumentService,
        ContractSnapshotService,
        ContractJournalQueryService,
        JourneyEntryWriter,
        EarlyPayoffSlipService,
      ].map((provide) => ({ provide, useValue: {} })),
      { provide: AuditService, useValue: { log: jest.fn() } },
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
      res: { setHeader: (k: string, v: string) => void },
      next: () => void,
    ) => {
      res.setHeader('x-owned-cancellation-app', marker);
      res.setHeader('x-owned-selected-company', requestedAccessCompany(req));
      next();
    },
  );
  app.useGlobalPipes(
    new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
  );
  await app.listen(0, '127.0.0.1');
});
afterAll(async () => {
  jest.restoreAllMocks();
  await app?.close();
  await db.$disconnect();
});
it('unmanaged canonical approval really reverses activation and restores Product', async () => {
  const c = await contract();
  const original = await ledger(c.id);
  const row = await pending(c.id);
  const response = await http('post', `/contracts/cancellations/${row.id}/approve`, legacy);
  expect(response.status).toBe(201);
  expect((await db.contract.findUniqueOrThrow({ where: { id: c.id } })).status).toBe('CANCELED');
  const result = await db.contractCancellation.findUniqueOrThrow({
    where: { id: row.id },
    include: { reversalJournalEntry: { include: { lines: true } } },
  });
  expect(
    result.reversalJournalEntry?.lines.map((l) => [
      l.accountCode,
      String(l.debit),
      String(l.credit),
    ]),
  ).toEqual([
    ['11-2101', '0', '12000'],
    ['21-1101', '12000', '0'],
  ]);
  expect(
    (await db.journalEntry.findUniqueOrThrow({ where: { id: original.id } })).metadata,
  ).toMatchObject({ reversed: true });
  expect(await db.product.findUnique({ where: { id: c.productId } })).toMatchObject({
    status: 'IN_STOCK',
    ownedByCompanyId: shop,
  });
});
it('managed authorized request produces usable pending cancellation', async () => {
  const c = await contract();
  await ledger(c.id);
  const response = await http('post', `/contracts/${c.id}/request-cancellation`, actor, {
    reason: 'Owned reason',
    refundAmount: 0,
  });
  expect(response.status).toBe(201);
  expect(response.body).toMatchObject({ contractId: c.id, status: 'PENDING' });
  expect(
    await db.contractCancellation.count({ where: { contractId: c.id, requestedById: actor } }),
  ).toBe(1);
});
it('managed request then other owner executes actual canonical money exactly once', async () => {
  const c = await contract();
  await ledger(c.id);
  expect(
    (
      await http('post', `/contracts/${c.id}/request-cancellation`, actor, {
        reason: 'Owned cancellation',
        refundAmount: 0,
      })
    ).status,
  ).toBe(201);
  const row = await db.contractCancellation.findFirstOrThrow({ where: { contractId: c.id } });
  const response = await http('post', `/contracts/cancellations/${row.id}/approve`, owner);
  expect(response.status).toBe(201);
  expect(await db.contract.findUnique({ where: { id: c.id } })).toMatchObject({
    status: 'CANCELED',
  });
  const approved = await db.contractCancellation.findUniqueOrThrow({
    where: { id: row.id },
    include: { reversalJournalEntry: true },
  });
  expect(approved.reversalJournalEntry?.createdById).toBe(owner);
  expect(
    (await http('post', `/contracts/cancellations/${row.id}/approve`, owner)).status,
  ).toBeGreaterThanOrEqual(400);
});
it('managed owner disposes a genuine no-money draft without invented journal', async () => {
  const c = await contract(true);
  expect((await http('delete', `/contracts/${c.id}`, owner, {}, 'SHOP')).status).toBe(200);
  expect((await db.contract.findUniqueOrThrow({ where: { id: c.id } })).deletedAt).not.toBeNull();
  expect(
    await db.journalEntry.count({ where: { metadata: { path: ['contractId'], equals: c.id } } }),
  ).toBe(0);
});
it('managed operational queue is source scoped and finite', async () => {
  const c = await contract();
  const hidden = await contract(false, foreignBranch);
  const row = await pending(c.id);
  await pending(hidden.id);
  const response = await http('get', '/contracts/cancellations/pending');
  expect(response.status).toBe(200);
  expect(
    response.body.some(
      (r: { id: string; cancellationId?: string }) =>
        r.id === row.id || r.cancellationId === row.id,
    ),
  ).toBe(true);
  expect(JSON.stringify(response.body)).not.toContain(hidden.id);
  expect(JSON.stringify(response.body)).not.toContain('0800000000');
});
it('managed owner rejection retains reason in required audit without money', async () => {
  const c = await contract();
  const row = await pending(c.id);
  expect(
    (
      await http('post', `/contracts/cancellations/${row.id}/reject`, owner, {
        reason: 'Not appropriate',
      })
    ).status,
  ).toBe(201);
  expect(await db.contractCancellation.findUnique({ where: { id: row.id } })).toMatchObject({
    status: 'REJECTED',
    approvedById: owner,
  });
  expect(
    await db.auditLog.count({
      where: { entityId: c.id, action: 'CANCELLATION_REJECTED', userId: owner },
    }),
  ).toBe(1);
});
it('no grant and foreign origin cannot create requests or see queue', async () => {
  const c = await contract(false, foreignBranch);
  expect(
    (
      await http('post', `/contracts/${c.id}/request-cancellation`, actor, {
        reason: 'x',
        refundAmount: 0,
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await http('post', `/contracts/${c.id}/request-cancellation`, denied, {
        reason: 'x',
        refundAmount: 0,
      })
    ).status,
  ).toBe(403);
  expect((await http('get', '/contracts/cancellations/pending', denied)).status).toBe(403);
});
it('new managed positive refund is rejected and creates no pending row', async () => {
  const c = await contract();
  expect(
    (
      await http('post', `/contracts/${c.id}/request-cancellation`, actor, {
        reason: 'refund',
        refundAmount: 100,
      })
    ).status,
  ).toBe(400);
  expect(await db.contractCancellation.count({ where: { contractId: c.id } })).toBe(0);
});
it('legacy positive request is preserved and canonical approval refuses it', async () => {
  const c = await contract();
  await ledger(c.id);
  expect(
    (
      await http('post', `/contracts/${c.id}/request-cancellation`, legacy, {
        reason: 'legacy',
        refundAmount: 100,
      })
    ).status,
  ).toBe(201);
  const row = await db.contractCancellation.findFirstOrThrow({ where: { contractId: c.id } });
  expect(String(row.refundAmount)).toBe('100');
  expect((await http('post', `/contracts/cancellations/${row.id}/approve`, legacy)).status).toBe(
    400,
  );
});
it('asymmetric positions cannot lend one branch action to another', async () => {
  const split = await person();
  await grant(split, ['sales.cancel.request'], 'FINANCE', [branch]);
  await grant(
    split,
    ['contracts.read', 'customers.read', 'products.read', 'payments.read'],
    'FINANCE',
    [foreignBranch],
  );
  const c = await contract(false, foreignBranch);
  expect(
    (
      await http('post', `/contracts/${c.id}/request-cancellation`, split, {
        reason: 'x',
        refundAmount: 0,
      })
    ).status,
  ).toBe(403);
});
it('current deleted source and selected company are denied before work', async () => {
  const c = await contract();
  await db.branch.update({ where: { id: foreignBranch }, data: { isActive: false } });
  const foreign = await contract(false, foreignBranch);
  expect(
    (
      await http('post', `/contracts/${foreign.id}/request-cancellation`, owner, {
        reason: 'x',
        refundAmount: 0,
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await http(
        'post',
        `/contracts/${c.id}/request-cancellation`,
        actor,
        { reason: 'x', refundAmount: 0 },
        'SHOP',
      )
    ).status,
  ).toBe(403);
  await db.branch.update({ where: { id: foreignBranch }, data: { isActive: true } });
});
it('no-grant employee cannot approve, reject, dispose or list', async () => {
  const c = await contract();
  const row = await pending(c.id);
  const draft = await contract(true);
  for (const action of ['approve', 'reject'])
    expect(
      (
        await http(
          'post',
          `/contracts/cancellations/${row.id}/${action}`,
          denied,
          action === 'reject' ? { reason: 'x' } : {},
        )
      ).status,
    ).toBe(403);
  expect((await http('delete', `/contracts/${draft.id}`, denied, {}, 'SHOP')).status).toBe(403);
  expect((await http('get', '/contracts/cancellations/pending', denied)).status).toBe(403);
  expect(await db.contractCancellation.findUnique({ where: { id: row.id } })).toMatchObject({
    status: 'PENDING',
  });
  expect(await db.contract.findUnique({ where: { id: draft.id } })).toMatchObject({
    deletedAt: null,
  });
});
it('legacy canonical draft disposal reverses actual down-payment money', async () => {
  const c = await contract(true);
  await db.contract.update({
    where: { id: c.id },
    data: { downPayment: 1000, downPaymentReceivedAt: new Date() },
  });
  await db.journalEntry.create({
    data: {
      entryNumber: 'DOWN-' + randomUUID(),
      entryDate: new Date(),
      postedAt: new Date(),
      description: 'Owned down-payment',
      status: 'POSTED',
      createdById: legacy,
      companyId: shop,
      metadata: {
        contractId: c.id,
        flow: 'shop-down-payment',
        idempotencyKey: `shop-down-payment:${c.id}`,
      },
      lines: {
        create: [
          { accountCode: 'S11-1101', debit: 1000, credit: 0 },
          { accountCode: 'S21-2001', debit: 0, credit: 1000 },
        ],
      },
    },
  });
  expect((await http('delete', `/contracts/${c.id}`, legacy, {}, 'SHOP')).status).toBe(200);
  const reverse = await db.journalEntry.findFirstOrThrow({
    where: {
      AND: [
        { metadata: { path: ['contractId'], equals: c.id } },
        { metadata: { path: ['flow'], equals: 'shop-down-payment-reversal' } },
      ],
    },
    include: { lines: true },
  });
  expect(reverse.lines.map((l) => [l.accountCode, String(l.debit), String(l.credit)])).toEqual([
    ['S21-2001', '1000', '0'],
    ['S11-1101', '0', '1000'],
  ]);
});
it('owner cannot request unsupported positive refund or wrong selected company', async () => {
  const c = await contract();
  expect(
    (
      await http('post', `/contracts/${c.id}/request-cancellation`, owner, {
        reason: 'refund',
        refundAmount: 100,
      })
    ).status,
  ).toBe(400);
  expect((await http('get', '/contracts/cancellations/pending', owner, {}, 'SHOP')).status).toBe(
    403,
  );
});
it('owner cannot approve own cancellation request', async () => {
  const c = await contract();
  await ledger(c.id);
  expect(
    (
      await http('post', `/contracts/${c.id}/request-cancellation`, owner, {
        reason: 'Own request',
        refundAmount: 0,
      })
    ).status,
  ).toBe(201);
  const row = await db.contractCancellation.findFirstOrThrow({ where: { contractId: c.id } });
  expect((await http('post', `/contracts/cancellations/${row.id}/approve`, owner)).status).toBe(
    403,
  );
  expect(await db.contract.findUnique({ where: { id: c.id } })).toMatchObject({ status: 'ACTIVE' });
});
it('managed owner cannot execute legacy null-snapshot pending row', async () => {
  const c = await contract();
  await ledger(c.id);
  const row = await pending(c.id);
  expect((await http('post', `/contracts/cancellations/${row.id}/approve`, owner)).status).toBe(
    403,
  );
  expect(await db.contract.findUnique({ where: { id: c.id } })).toMatchObject({ status: 'ACTIVE' });
  expect(await db.contractCancellation.findUnique({ where: { id: row.id } })).toMatchObject({
    status: 'PENDING',
    reversalJournalEntryId: null,
  });
  expect(
    await db.journalEntry.count({
      where: {
        metadata: { path: ['flow'], equals: 'contract-cancellation' },
        AND: { metadata: { path: ['contractId'], equals: c.id } },
      },
    }),
  ).toBe(0);
});
async function managedRequest(c: Awaited<ReturnType<typeof contract>>, who = actor) {
  expect(
    (
      await http('post', `/contracts/${c.id}/request-cancellation`, who, {
        reason: 'Bound request',
        refundAmount: 0,
      })
    ).status,
  ).toBe(201);
  return db.contractCancellation.findFirstOrThrow({
    where: { contractId: c.id, status: 'PENDING' },
  });
}
async function unchanged(c: Awaited<ReturnType<typeof contract>>, row: { id: string }) {
  expect(await db.contract.findUnique({ where: { id: c.id } })).toMatchObject({ status: 'ACTIVE' });
  expect(await db.contractCancellation.findUnique({ where: { id: row.id } })).toMatchObject({
    status: 'PENDING',
    reversalJournalEntryId: null,
  });
}
it('request evidence is private and database-bound; all fields and deletion are immutable', async () => {
  const c = await contract();
  await ledger(c.id);
  const row = await managedRequest(c);
  expect(row.requestSnapshotVersion).toBe(1);
  expect(row.requestFingerprint).toMatch(/^[a-f0-9]{64}$/);
  expect(row.requestSnapshot).toMatchObject({
    version: 1,
    binding: {
      cancellationId: row.id,
      contractId: c.id,
      requestedById: actor,
      reason: 'Bound request',
      refundAmount: '0.00',
    },
  });
  for (const data of [
    { requestSnapshotVersion: null },
    { requestSnapshot: Prisma.JsonNull },
    { requestFingerprint: '0'.repeat(64) },
    { reason: 'Changed' },
    { deletedAt: new Date() },
    { refundAmount: 1 },
    { requestedById: owner },
    { contractId: (await contract()).id },
  ])
    await expect(db.contractCancellation.update({ where: { id: row.id }, data })).rejects.toThrow();
  await expect(db.contractCancellation.delete({ where: { id: row.id } })).rejects.toThrow();
  const response = await http('get', '/contracts/cancellations/pending', owner);
  expect(response.status).toBe(200);
  expect(JSON.stringify(response.body)).not.toContain('requestSnapshot');
  expect(JSON.stringify(response.body)).not.toContain(row.requestFingerprint!);
});
it('DB rejects incomplete and JSON-null snapshot bindings with no SQL-null escape', async () => {
  const c = await contract();
  const base = { contractId: c.id, requestedById: actor, reason: 'Bound', refundAmount: 0 };
  for (const extra of [
    { requestSnapshotVersion: 1 },
    { requestSnapshot: Prisma.JsonNull },
    {
      requestSnapshotVersion: 1,
      requestSnapshot: { version: 1 },
      requestFingerprint: 'a'.repeat(64),
    },
    {
      requestSnapshotVersion: 1,
      requestSnapshot: { version: 1, binding: { reason: null } },
      requestFingerprint: 'a'.repeat(64),
    },
  ])
    await expect(db.contractCancellation.create({ data: { ...base, ...extra } })).rejects.toThrow();
  const old = await pending(c.id);
  await expect(
    db.contractCancellation.update({
      where: { id: old.id },
      data: {
        requestSnapshotVersion: 1,
        requestSnapshot: {
          version: 1,
          binding: {
            cancellationId: old.id,
            contractId: c.id,
            requestedById: actor,
            reason: old.reason,
            refundAmount: '0.00',
          },
        },
        requestFingerprint: 'b'.repeat(64),
      },
    }),
  ).rejects.toThrow();
});
it('bounded rejection reason is private, recorded once, and immutable after withdrawal', async () => {
  const c = await contract();
  await ledger(c.id);
  const row = await managedRequest(c, owner);
  expect(
    (
      await http('post', `/contracts/cancellations/${row.id}/reject`, owner, {
        reason: '  withdraw  ',
      })
    ).status,
  ).toBe(201);
  expect(await db.contractCancellation.findUnique({ where: { id: row.id } })).toMatchObject({
    status: 'REJECTED',
    rejectionReason: 'withdraw',
  });
  await expect(
    db.contractCancellation.update({ where: { id: row.id }, data: { rejectionReason: 'rewrite' } }),
  ).rejects.toThrow();
  await expect(
    db.contractCancellation.update({ where: { id: row.id }, data: { rejectionReason: null } }),
  ).rejects.toThrow();
  expect(
    (await http('post', `/contracts/cancellations/${row.id}/reject`, owner, { reason: 'again' }))
      .status,
  ).toBe(400);
});
it.each(['', '  ', 'x'.repeat(2001)])(
  'managed empty/oversized request and reject reasons fail before mutation (%#)',
  async (reason) => {
    const c = await contract();
    expect(
      (
        await http('post', `/contracts/${c.id}/request-cancellation`, actor, {
          reason,
          refundAmount: 0,
        })
      ).status,
    ).toBe(400);
    const row = await pending(c.id);
    expect(
      (await http('post', `/contracts/cancellations/${row.id}/reject`, owner, { reason })).status,
    ).toBe(400);
    expect(await db.contractCancellation.findUnique({ where: { id: row.id } })).toMatchObject({
      status: 'PENDING',
      rejectionReason: null,
    });
  },
);
it('managed new draft requests are unavailable without creating permanently stale work', async () => {
  const c = await contract(true);
  expect(
    (
      await http('post', `/contracts/${c.id}/request-cancellation`, owner, {
        reason: 'draft',
        refundAmount: 0,
      })
    ).status,
  ).toBe(400);
  expect(await db.contractCancellation.count({ where: { contractId: c.id } })).toBe(0);
});
it('marked request cannot execute through an unmanaged caller or later actor mode changes', async () => {
  const c = await contract();
  await ledger(c.id);
  const row = await managedRequest(c);
  expect((await http('post', `/contracts/cancellations/${row.id}/approve`, legacy)).status).toBe(
    403,
  );
  await db.user.update({ where: { id: owner }, data: { accessManaged: false } });
  try {
    expect((await http('post', `/contracts/cancellations/${row.id}/approve`, owner)).status).toBe(
      403,
    );
  } finally {
    await db.user.update({ where: { id: owner }, data: { accessManaged: true } });
  }
  await unchanged(c, row);
});
it('unmanaged legacy responses retain old shape and hide additive private columns', async () => {
  const c = await contract();
  const result = await http('post', `/contracts/${c.id}/request-cancellation`, legacy, {
    reason: 'Legacy preserved',
    refundAmount: 45,
  });
  expect(result.status).toBe(201);
  expect(result.body).toMatchObject({
    contractId: c.id,
    reason: 'Legacy preserved',
    refundAmount: '45',
  });
  for (const key of [
    'requestSnapshotVersion',
    'requestSnapshot',
    'requestFingerprint',
    'rejectionReason',
  ])
    expect(result.body).not.toHaveProperty(key);
  const queue = await http('get', '/contracts/cancellations/pending', legacy);
  expect(JSON.stringify(queue.body)).not.toContain('requestSnapshot');
  expect(
    (
      await http('post', `/contracts/cancellations/${result.body.id}/reject`, legacy, {
        reason: 'legacy reject',
      })
    ).body,
  ).not.toHaveProperty('rejectionReason');
});
it('material money change makes request stale, then reject permits a fresh request', async () => {
  const c = await contract();
  const entry = await ledger(c.id);
  const row = await managedRequest(c);
  await db.journalLine.updateMany({
    where: { journalEntryId: entry.id, accountCode: '11-2101' },
    data: { debit: 12001 },
  });
  expect((await http('post', `/contracts/cancellations/${row.id}/approve`, owner)).status).toBe(
    409,
  );
  await unchanged(c, row);
  expect(
    (
      await http('post', `/contracts/cancellations/${row.id}/reject`, owner, {
        reason: 'Stale evidence',
      })
    ).status,
  ).toBe(201);
  await db.journalLine.updateMany({
    where: { journalEntryId: entry.id, accountCode: '11-2101' },
    data: { debit: 12000 },
  });
  const fresh = await managedRequest(c);
  expect(fresh.id).not.toBe(row.id);
  expect((await http('post', `/contracts/cancellations/${fresh.id}/approve`, owner)).status).toBe(
    201,
  );
});
it('new paid money and changed current ownership cannot consume the recorded request', async () => {
  const c = await contract();
  await ledger(c.id);
  const row = await managedRequest(c);
  await db.contract.update({ where: { id: c.id }, data: { advanceBalance: 20 } });
  expect((await http('post', `/contracts/cancellations/${row.id}/approve`, owner)).status).toBe(
    409,
  );
  await unchanged(c, row);
  await db.contract.update({ where: { id: c.id }, data: { advanceBalance: 0 } });
  await db.product.update({ where: { id: c.productId }, data: { ownedByCompanyId: shop } });
  expect((await http('post', `/contracts/cancellations/${row.id}/approve`, owner)).status).toBe(
    409,
  );
  await unchanged(c, row);
});
it('missing/deleted/non-sold accessory skips are preserved by genuine canonical approval', async () => {
  const c = await contract();
  await ledger(c.id);
  const other = await contract(true);
  await db.contract.update({
    where: { id: c.id },
    data: { bundleProductIds: [randomUUID(), other.productId] },
  });
  const row = await managedRequest(c);
  expect((await http('post', `/contracts/cancellations/${row.id}/approve`, owner)).status).toBe(
    201,
  );
  expect(await db.product.findUnique({ where: { id: other.productId } })).toMatchObject({
    status: 'RESERVED',
  });
  const audit = await db.auditLog.findFirstOrThrow({
    where: { entityId: c.id, action: 'CONTRACT_CANCELED' },
  });
  expect(audit.newValue).toMatchObject({
    bundlesNotRestored: expect.arrayContaining([other.productId]),
  });
});
it('paid commissions and locked payout totals remain intact while clawable commission is reversed', async () => {
  const c = await contract();
  await ledger(c.id);
  const period = randomUUID();
  const commission = await db.salesCommission.create({
    data: {
      contractId: c.id,
      salespersonId: actor,
      period,
      saleAmount: 12000,
      commissionRate: 0.03,
      commissionAmount: 360,
      status: 'PENDING',
    },
  });
  const paid = await db.salesCommission.create({
    data: {
      contractId: c.id,
      salespersonId: actor,
      period,
      saleAmount: 12000,
      commissionRate: 0.03,
      commissionAmount: 360,
      status: 'PAID',
      paidAmount: 360,
    },
  });
  const payout = await db.commissionPayout.create({
    data: {
      salespersonId: actor,
      period,
      totalSales: 24000,
      totalCommission: 720,
      status: 'APPROVED',
      generatedAt: new Date(),
    },
  });
  const row = await managedRequest(c);
  expect((await http('post', `/contracts/cancellations/${row.id}/approve`, owner)).status).toBe(
    201,
  );
  expect(await db.salesCommission.findUnique({ where: { id: commission.id } })).toMatchObject({
    status: 'CLAWED_BACK',
  });
  expect(await db.salesCommission.findUnique({ where: { id: paid.id } })).toMatchObject({
    status: 'PAID',
  });
  const kept = await db.commissionPayout.findUniqueOrThrow({ where: { id: payout.id } });
  expect(String(kept.totalCommission)).toBe('720');
  expect(kept.deletedAt).toBeNull();
});
it('overlapping owner approvals produce exactly one real reversal', async () => {
  const c = await contract();
  await ledger(c.id);
  const row = await managedRequest(c);
  const responses = await Promise.all([
    http('post', `/contracts/cancellations/${row.id}/approve`, owner),
    http('post', `/contracts/cancellations/${row.id}/approve`, owner),
  ]);
  expect(responses.filter((r) => r.status === 201)).toHaveLength(1);
  expect(responses.filter((r) => r.status >= 400)).toHaveLength(1);
  expect(
    await db.journalEntry.count({
      where: {
        AND: [
          { metadata: { path: ['contractId'], equals: c.id } },
          { metadata: { path: ['flow'], equals: 'contract-cancellation' } },
        ],
      },
    }),
  ).toBe(1);
});
it('concurrent requests produce one pending request and one required audit', async () => {
  const c = await contract();
  await ledger(c.id);
  const responses = await Promise.all(
    [1, 2].map(() =>
      http('post', `/contracts/${c.id}/request-cancellation`, actor, {
        reason: 'one',
        refundAmount: 0,
      }),
    ),
  );
  expect(responses.filter((r) => r.status === 201)).toHaveLength(1);
  expect(responses.filter((r) => r.status === 409)).toHaveLength(1);
  expect(await db.contractCancellation.count({ where: { contractId: c.id } })).toBe(1);
  expect(
    await db.auditLog.count({
      where: { entityId: c.id, action: 'CONTRACT_CANCELLATION_REQUESTED' },
    }),
  ).toBe(1);
});
async function pairedLedger(c: Awaited<ReturnType<typeof contract>>) {
  await ledger(c.id);
  for (const code of ['S11-3001', 'S41-1101', '11-2102', '51-1103', 'S11-1201'])
    await db.chartOfAccount.upsert({
      where: { code },
      update: {},
      create: { code, name: 'Owned ' + code, type: 'สินทรัพย์', normalBalance: 'Dr' },
    });
  await db.journalEntry.create({
    data: {
      entryNumber: 'SHOP-' + randomUUID(),
      entryDate: new Date(),
      postedAt: new Date(),
      description: 'Owned SHOP activation',
      status: 'POSTED',
      createdById: legacy,
      companyId: shop,
      metadata: { contractId: c.id, flow: 'shop-installment-sale' },
      lines: {
        create: [
          { accountCode: 'S11-3001', debit: 12000, credit: 0 },
          { accountCode: 'S41-1101', debit: 0, credit: 12000 },
        ],
      },
    },
  });
}
async function postingClock<T>(work: () => Promise<T>) {
  const real = postingPeriods.lockPayoffPeriod;
  jest.useFakeTimers({
    doNotFake: [
      'hrtime',
      'nextTick',
      'performance',
      'queueMicrotask',
      'setImmediate',
      'clearImmediate',
      'setInterval',
      'clearInterval',
      'setTimeout',
      'clearTimeout',
    ],
  });
  jest.setSystemTime(new Date('2020-01-15T12:00:00Z'));
  const seen: Array<{ companyId: string; date: Date }> = [];
  const spy = jest
    .spyOn(postingPeriods, 'lockPayoffPeriod')
    .mockImplementation(async (tx, date, companyId) => {
      seen.push({ companyId, date });
      await real(tx, date, companyId);
      jest.setSystemTime(new Date('2020-02-20T12:00:00Z'));
    });
  try {
    return { result: await work(), seen };
  } finally {
    spy.mockRestore();
    jest.useRealTimers();
  }
}
async function period(companyId: string, status: 'OPEN' | 'CLOSED') {
  await db.accountingPeriod.upsert({
    where: { companyId_year_month: { companyId, year: 2020, month: 1 } },
    create: { companyId, year: 2020, month: 1, status },
    update: { status },
  });
}
it.each(['FINANCE', 'SHOP'])(
  'closed actual %s posting period rolls back every reversal and state',
  async (book) => {
    await period(finance, book === 'FINANCE' ? 'CLOSED' : 'OPEN');
    await period(shop, book === 'SHOP' ? 'CLOSED' : 'OPEN');
    const c = await contract();
    await pairedLedger(c);
    const row = await managedRequest(c);
    const { result } = await postingClock(() =>
      http('post', `/contracts/cancellations/${row.id}/approve`, owner),
    );
    expect(result.status).toBe(400);
    await unchanged(c, row);
    expect(
      await db.auditLog.count({ where: { entityId: c.id, action: 'CONTRACT_CANCELED' } }),
    ).toBe(0);
    expect(
      await db.journalEntry.count({
        where: {
          AND: [
            { metadata: { path: ['contractId'], equals: c.id } },
            { metadata: { path: ['flow'], equals: 'contract-cancellation' } },
          ],
        },
      }),
    ).toBe(0);
    await period(finance, 'OPEN');
    await period(shop, 'OPEN');
  },
);
it('all original-book reversals and ECL use actual owner and one checked Date across rollover', async () => {
  const c = await contract();
  await pairedLedger(c);
  await db.journalEntry.create({
    data: {
      entryNumber: 'ECL-' + randomUUID(),
      entryDate: new Date(),
      postedAt: new Date(),
      description: 'Owned ECL',
      status: 'POSTED',
      companyId: finance,
      createdById: legacy,
      metadata: { contractId: c.id, flow: 'provision' },
      lines: {
        create: [
          { accountCode: '51-1103', debit: 100, credit: 0 },
          { accountCode: '11-2102', debit: 0, credit: 100 },
        ],
      },
    },
  });
  const row = await managedRequest(c);
  const { result, seen } = await postingClock(() =>
    http('post', `/contracts/cancellations/${row.id}/approve`, owner),
  );
  expect(result.status).toBe(201);
  expect(seen).toHaveLength(3);
  expect(seen.every((s) => s.date.toISOString() === '2020-01-15T12:00:00.000Z')).toBe(true);
  const posted = await db.journalEntry.findMany({
    where: { createdById: owner, metadata: { path: ['contractId'], equals: c.id } },
    include: { lines: true },
  });
  expect(posted).toHaveLength(3);
  expect(posted.every((e) => e.postedAt?.toISOString() === '2020-01-15T12:00:00.000Z')).toBe(true);
  expect(
    posted.find((e) => (e.metadata as { flow: string }).flow === 'stage-reverse'),
  ).toMatchObject({ companyId: finance, createdById: owner });
});
async function downDraft() {
  const c = await contract(true);
  await db.contract.update({
    where: { id: c.id },
    data: { downPayment: 1000, downPaymentReceivedAt: new Date() },
  });
  await db.journalEntry.create({
    data: {
      entryNumber: 'DOWN-' + randomUUID(),
      entryDate: new Date(),
      postedAt: new Date(),
      description: 'Owned down',
      status: 'POSTED',
      companyId: shop,
      createdById: legacy,
      metadata: {
        contractId: c.id,
        flow: 'shop-down-payment',
        idempotencyKey: `shop-down-payment:${c.id}`,
      },
      lines: {
        create: [
          { accountCode: 'S11-1101', debit: 1000, credit: 0 },
          { accountCode: 'S21-2001', debit: 0, credit: 1000 },
        ],
      },
    },
  });
  return c;
}
it('managed mixed-tender draft disposal refunds real ledger once with actual actor/date', async () => {
  const c = await downDraft();
  await db.chartOfAccount.upsert({
    where: { code: 'S11-1201' },
    update: {},
    create: { code: 'S11-1201', name: 'Owned bank', type: 'สินทรัพย์', normalBalance: 'Dr' },
  });
  await db.shopTender.createMany({
    data: [
      {
        direction: 'IN',
        kind: 'CONTRACT_DOWN',
        branchId: branch,
        method: 'CASH',
        amount: 600,
        actorId: actor,
        contractId: c.id,
        seq: 1,
        seqTotal: 2,
      },
      {
        direction: 'IN',
        kind: 'CONTRACT_DOWN',
        branchId: branch,
        method: 'BANK_TRANSFER',
        amount: 400,
        actorId: actor,
        contractId: c.id,
        seq: 2,
        seqTotal: 2,
      },
    ],
  });
  await db.journalEntry.create({
    data: {
      entryNumber: 'SPLIT-' + randomUUID(),
      entryDate: new Date(),
      postedAt: new Date(),
      description: 'Owned split',
      status: 'POSTED',
      companyId: shop,
      createdById: legacy,
      metadata: {
        contractId: c.id,
        flow: 'shop-tender-split',
        idempotencyKey: `shop-tender-split:contract:${c.id}`,
      },
      lines: {
        create: [
          { accountCode: 'S11-1201', debit: 400, credit: 0 },
          { accountCode: 'S11-1101', debit: 0, credit: 400 },
        ],
      },
    },
  });
  const { result, seen } = await postingClock(() =>
    http('delete', `/contracts/${c.id}`, owner, {}, 'SHOP'),
  );
  expect(result.status).toBe(200);
  expect(seen).toHaveLength(2);
  const out = await db.shopTender.findMany({ where: { contractId: c.id, direction: 'OUT' } });
  expect(out).toHaveLength(2);
  expect(
    out.every(
      (t) => t.actorId === owner && t.occurredAt.toISOString() === '2020-01-15T12:00:00.000Z',
    ),
  ).toBe(true);
  const posted = await db.journalEntry.findMany({
    where: { createdById: owner, metadata: { path: ['contractId'], equals: c.id } },
  });
  expect(posted).toHaveLength(2);
  expect(
    posted.every(
      (e) => e.companyId === shop && e.postedAt?.toISOString() === '2020-01-15T12:00:00.000Z',
    ),
  ).toBe(true);
  expect((await http('delete', `/contracts/${c.id}`, owner, {}, 'SHOP')).status).toBe(403);
  expect(await db.shopTender.count({ where: { contractId: c.id, direction: 'OUT' } })).toBe(2);
});
it('closed SHOP period rolls back monetary draft while proven no-money disposal needs no posting period', async () => {
  await period(shop, 'CLOSED');
  const c = await downDraft();
  expect(
    (await postingClock(() => http('delete', `/contracts/${c.id}`, owner, {}, 'SHOP'))).result
      .status,
  ).toBe(400);
  expect(await db.contract.findUnique({ where: { id: c.id } })).toMatchObject({ deletedAt: null });
  const noMoney = await contract(true);
  const clean = await postingClock(() =>
    http('delete', `/contracts/${noMoney.id}`, owner, {}, 'SHOP'),
  );
  expect(clean.result.status).toBe(200);
  expect(clean.seen).toHaveLength(0);
  await period(shop, 'OPEN');
});
it('required audit failure rolls back canonical money, stock, decision and success effects', async () => {
  const c = await contract();
  await ledger(c.id);
  const row = await managedRequest(c);
  await db.$executeRawUnsafe(
    `CREATE FUNCTION owned_fail_cancellation_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='CONTRACT_CANCELED' THEN RAISE EXCEPTION 'owned cancellation audit failure'; END IF; RETURN NEW; END $$`,
  );
  await db.$executeRawUnsafe(
    'CREATE TRIGGER owned_fail_cancellation_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION owned_fail_cancellation_audit()',
  );
  const log = jest.spyOn(Logger.prototype, 'log');
  const errorOriginal = Logger.prototype.error;
  let controlled = 0;
  const errors = jest.spyOn(Logger.prototype, 'error').mockImplementation(function (
    this: Logger,
    ...args: unknown[]
  ) {
    if (args.some((a) => String(a).includes('owned cancellation audit failure'))) {
      controlled++;
      return;
    }
    return errorOriginal.apply(this, args as Parameters<Logger['error']>);
  });
  try {
    expect((await http('post', `/contracts/cancellations/${row.id}/approve`, owner)).status).toBe(
      500,
    );
    await unchanged(c, row);
    expect(controlled).toBe(1);
    expect(
      log.mock.calls.filter((args) => String(args[0]).includes('Exchange cancel — reversed')),
    ).toHaveLength(0);
    expect(await db.product.findUnique({ where: { id: c.productId } })).toMatchObject({
      status: 'SOLD_INSTALLMENT',
      ownedByCompanyId: finance,
    });
  } finally {
    log.mockRestore();
    errors.mockRestore();
    await db.$executeRawUnsafe('DROP TRIGGER owned_fail_cancellation_audit ON audit_logs');
    await db.$executeRawUnsafe('DROP FUNCTION owned_fail_cancellation_audit()');
  }
});
it('sweep success effect observes committed state and does not repeat execution when effect fails', async () => {
  const c = await contract();
  await ledger(c.id);
  const row = await managedRequest(c);
  let seen = 0;
  const checks: Promise<void>[] = [];
  const log = jest.spyOn(Logger.prototype, 'log').mockImplementation((message: unknown) => {
    if (String(message).startsWith('Exchange cancel — reversed')) {
      seen++;
      checks.push(
        db.contract.findUniqueOrThrow({ where: { id: c.id } }).then((result) => {
          expect(result.status).toBe('CANCELED');
        }),
      );
      throw new Error('owned effect failure');
    }
  });
  const original = Logger.prototype.error;
  let controlled = 0;
  const errors = jest.spyOn(Logger.prototype, 'error').mockImplementation(function (
    this: Logger,
    ...args: unknown[]
  ) {
    if (
      args[0] === 'Committed domain mutation: post-commit effect failed; mutation was not retried'
    ) {
      controlled++;
      return;
    }
    return original.apply(this, args as Parameters<Logger['error']>);
  });
  try {
    expect((await http('post', `/contracts/cancellations/${row.id}/approve`, owner)).status).toBe(
      201,
    );
    await Promise.all(checks);
    expect(seen).toBe(1);
    expect(controlled).toBe(1);
  } finally {
    log.mockRestore();
    errors.mockRestore();
  }
});
async function waitForLock(fragment: string) {
  for (let i = 0; i < 250; i++) {
    const rows = await db.$queryRaw<
      Array<{ n: bigint }>
    >`SELECT count(*) AS n FROM pg_stat_activity WHERE datname='bc_contract_cancellation' AND wait_event_type='Lock' AND query LIKE ${'%' + fragment + '%'}`;
    if (Number(rows[0].n) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Owned HTTP execution never waited on the expected source lock');
}
async function concurrentChange(
  change: (tx: Prisma.TransactionClient) => Promise<unknown>,
  fragment: string,
  work: () => Promise<request.Response>,
) {
  const second = new PrismaClient({ datasources: { db: { url } } });
  let unlock!: () => void;
  let ready!: () => void;
  const held = new Promise<void>((resolve) => {
    unlock = resolve;
  });
  const acquired = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const writer = second.$transaction(
    async (tx) => {
      await change(tx);
      ready();
      await held;
    },
    { timeout: 10000 },
  );
  try {
    await acquired;
    const response = work();
    await waitForLock(fragment);
    unlock();
    await writer;
    return await response;
  } finally {
    unlock();
    await writer.catch(() => undefined);
    await second.$disconnect();
  }
}
it('Product owner changed during actual lock wait is rechecked before request creation', async () => {
  const c = await contract();
  await ledger(c.id);
  const result = await concurrentChange(
    (tx) =>
      tx.product.update({
        where: { id: c.productId },
        data: { ownedByCompanyId: shop, branchId: foreignBranch },
      }),
    'products',
    () =>
      http('post', `/contracts/${c.id}/request-cancellation`, actor, {
        reason: 'Current source',
        refundAmount: 0,
      }),
  );
  expect(result.status).toBe(403);
  expect(await db.contractCancellation.count({ where: { contractId: c.id } })).toBe(0);
});
it('persisted owner demotion during authority lock wait prevents an old JWT snapshot from deciding', async () => {
  const c = await contract();
  await ledger(c.id);
  const row = await managedRequest(c);
  try {
    const result = await concurrentChange(
      (tx) => tx.user.update({ where: { id: owner }, data: { role: 'ACCOUNTANT' } }),
      'users',
      () => http('post', `/contracts/cancellations/${row.id}/approve`, owner),
    );
    expect(result.status).toBe(403);
    await unchanged(c, row);
  } finally {
    await db.user.update({ where: { id: owner }, data: { role: 'OWNER' } });
  }
});
it('request permission does not substitute for independent current Contract read', async () => {
  const who = await person();
  await grant(who, ['sales.cancel.request', 'customers.read', 'products.read'], 'FINANCE', [
    branch,
  ]);
  const c = await contract();
  expect(
    (
      await http('post', `/contracts/${c.id}/request-cancellation`, who, {
        reason: 'No case read',
        refundAmount: 0,
      })
    ).status,
  ).toBe(403);
});
it('assigned case reads pair with a real branch action; assigned mutation alone remains unavailable', async () => {
  const who = await person();
  const c = await contract();
  await ledger(c.id);
  await db.contract.update({ where: { id: c.id }, data: { assignedToId: who } });
  const position = await db.accessPosition.create({
    data: {
      code: randomUUID(),
      name: 'Assigned read',
      permissions: ['contracts.read', 'customers.read'],
    },
  });
  await db.employeeAccessAssignment.create({
    data: { userId: who, positionId: position.id, companyCode: 'FINANCE', scope: 'ASSIGNED' },
  });
  await grant(who, ['sales.cancel.request', 'products.read'], 'FINANCE', [branch]);
  expect(
    (
      await http('post', `/contracts/${c.id}/request-cancellation`, who, {
        reason: 'Assigned case',
        refundAmount: 0,
      })
    ).status,
  ).toBe(201);
  const assignedOnly = await person();
  const other = await contract();
  await db.contract.update({ where: { id: other.id }, data: { assignedToId: assignedOnly } });
  const p = await db.accessPosition.create({
    data: { code: randomUUID(), name: 'Assigned only', permissions: writes },
  });
  await db.employeeAccessAssignment.create({
    data: { userId: assignedOnly, positionId: p.id, companyCode: 'FINANCE', scope: 'ASSIGNED' },
  });
  expect(
    (
      await http('post', `/contracts/${other.id}/request-cancellation`, assignedOnly, {
        reason: 'Not an action',
        refundAmount: 0,
      })
    ).status,
  ).toBe(403);
});
it('queue financial and accounting evidence stays explicitly unavailable without independent grants', async () => {
  const who = await person();
  await grant(who, ['contracts.read', 'sales.cancel.request'], 'FINANCE', [branch]);
  const c = await contract();
  const row = await pending(c.id, 900);
  const result = await http('get', '/contracts/cancellations/pending', who);
  expect(result.status).toBe(200);
  expect(result.body.find((r: { id: string }) => r.id === row.id)).toMatchObject({
    reason: null,
    refundAmount: null,
    requestedBy: null,
    settledInBatch: null,
    recallAmount: null,
    contract: { status: null, customer: null },
    availability: { financial: 'UNAVAILABLE', customer: 'UNAVAILABLE', settlement: 'UNAVAILABLE' },
  });
  const reader = await http('get', '/contracts/cancellations/pending', actor);
  expect(reader.body.find((r: { id: string }) => r.id === row.id)).toMatchObject({
    refundAmount: '900',
    evidence: 'UNPROVEN',
    settledInBatch: null,
    recallAmount: null,
  });
});
it('rejection closes a stale request even when affected Product is no longer executable', async () => {
  const c = await contract();
  await ledger(c.id);
  const row = await managedRequest(c);
  await db.product.update({ where: { id: c.productId }, data: { deletedAt: new Date() } });
  expect(
    (
      await http('post', `/contracts/cancellations/${row.id}/reject`, owner, {
        reason: 'Withdraw stale',
      })
    ).status,
  ).toBe(201);
  expect(await db.contract.findUnique({ where: { id: c.id } })).toMatchObject({ status: 'ACTIVE' });
});
it('draft disposal retains paid booking inventory and archives rejected signature/KYC bytes without erasure', async () => {
  const c = await contract(true);
  await db.contract.update({ where: { id: c.id }, data: { workflowStatus: 'REJECTED' } });
  const signature = await db.signature.create({
    data: { contractId: c.id, signerType: 'CUSTOMER', signatureImage: 'private-signature-bytes' },
  });
  const kyc = await db.kycVerification.create({
    data: {
      contractId: c.id,
      customerId: c.customerId,
      otpPhone: '0800000000',
      otpChannel: 'SMS',
      idCardImageUrl: 'private/owned-card',
      expiresAt: new Date(Date.now() + 60000),
    },
  });
  await db.booking.create({
    data: {
      bookingNumber: 'BOOK-' + randomUUID(),
      customerId: c.customerId,
      branchId: branch,
      status: 'PAID',
      depositAmount: 200,
      totalAmount: 12000,
      expireDate: new Date(Date.now() + 86400000),
      createdById: actor,
      lockedProductId: c.productId,
    },
  });
  const warnings = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  try {
    const result = await http('delete', `/contracts/${c.id}`, owner, {}, 'SHOP');
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ id: c.id, deleted: true });
    expect(JSON.stringify(result.body)).not.toContain('private');
    expect(await db.product.findUnique({ where: { id: c.productId } })).toMatchObject({
      status: 'RESERVED',
    });
    const kept = await db.signature.findUniqueOrThrow({ where: { id: signature.id } });
    expect(kept.signatureImage).toBe('private-signature-bytes');
    expect(kept.deletedAt).not.toBeNull();
    const keptKyc = await db.kycVerification.findUniqueOrThrow({ where: { id: kyc.id } });
    expect(keptKyc.idCardImageUrl).toBe('private/owned-card');
    expect(keptKyc.deletedAt).not.toBeNull();
    expect(warnings.mock.calls).toHaveLength(1);
    expect(String(warnings.mock.calls[0][0])).toContain('[#1679]');
  } finally {
    warnings.mockRestore();
  }
});
it('unsigned-only disposal rule preserves live signature evidence on CREATING draft', async () => {
  const c = await contract(true);
  const signature = await db.signature.create({
    data: { contractId: c.id, signerType: 'CUSTOMER', signatureImage: 'evidence' },
  });
  expect((await http('delete', `/contracts/${c.id}`, owner, {}, 'SHOP')).status).toBe(400);
  expect(await db.signature.findUnique({ where: { id: signature.id } })).toMatchObject({
    deletedAt: null,
    signatureImage: 'evidence',
  });
});

async function creditDraft() {
  const c = await contract(true);
  await db.chartOfAccount.upsert({
    where: { code: 'S21-2003' },
    update: { type: 'หนี้สิน', normalBalance: 'Cr' },
    create: { code: 'S21-2003', name: 'Trade credit', type: 'หนี้สิน', normalBalance: 'Cr' },
  });
  await db.chartOfAccount.upsert({
    where: { code: 'S11-2002' },
    update: {},
    create: { code: 'S11-2002', name: 'Used stock', type: 'สินทรัพย์', normalBalance: 'Dr' },
  });
  const trade = await db.tradeIn.create({
    data: {
      customerId: c.customerId,
      branchId: branch,
      deviceBrand: 'Apple',
      deviceModel: 'Credit',
      flow: 'EXCHANGE',
      status: 'ACCEPTED',
      agreedPrice: 1000,
      idCardVerifiedAt: new Date(),
      idCardVerifiedById: legacy,
      sellerDeclarationSnapshot: { confirmed: true },
    },
  });
  const credits = new TradeInCreditService(prisma);
  await db.$transaction((tx) =>
    credits.issue(tx, trade.id, new Prisma.Decimal(1000), new Prisma.Decimal(0)),
  );
  const snapshot = await db.$transaction((tx) =>
    credits.claim(tx, {
      tradeInId: trade.id,
      customerId: c.customerId,
      branchId: branch,
      productId: c.productId,
      priceAfterDiscount: 12000,
      cashAmount: 0,
      actorId: legacy,
      target: { contractId: c.id },
    }),
  );
  await db.contract.update({
    where: { id: c.id },
    data: { downPayment: 1000, tradeInCreditSnapshot: snapshot },
  });
  const redemption = await db.tradeInCreditRedemption.findUniqueOrThrow({
    where: { id: snapshot.redemptionId },
  });
  return { c, trade, redemption };
}
it('managed draft releases genuine trade credit with an actual SHOP reversal and executor', async () => {
  const { c, trade, redemption } = await creditDraft();
  expect((await http('delete', `/contracts/${c.id}`, owner, {}, 'SHOP')).status).toBe(200);
  expect(await db.tradeIn.findUnique({ where: { id: trade.id } })).toMatchObject({
    currentRedemptionId: null,
  });
  expect(
    await db.tradeInCreditRedemption.findUnique({ where: { id: redemption.id } }),
  ).toMatchObject({ releasedById: owner, releasedAt: expect.any(Date) });
  const reversal = await db.journalEntry.findFirstOrThrow({
    where: {
      metadata: {
        path: ['idempotencyKey'],
        equals: `shop-trade-in-credit-released:${redemption.applicationJournalEntryId}`,
      },
    },
    include: { lines: true },
  });
  expect(reversal).toMatchObject({ companyId: shop, createdById: owner, status: 'POSTED' });
  expect(reversal.lines.map((l) => [l.accountCode, String(l.debit), String(l.credit)])).toEqual([
    ['S21-2003', '0', '1000'],
    ['S21-2001', '1000', '0'],
  ]);
});
async function settledContract() {
  const c = await contract();
  await ledger(c.id);
  const source = await db.journalEntry.create({
    data: {
      entryNumber: 'BATCH-' + randomUUID(),
      entryDate: new Date(),
      postedAt: new Date(),
      description: 'Owned settled payout',
      status: 'POSTED',
      companyId: finance,
      createdById: legacy,
      metadata: { flow: 'interco-settlement-batch' },
      lines: {
        create: [
          { accountCode: '21-1101', debit: 12000, credit: 0 },
          { accountCode: '11-1201', debit: 0, credit: 12000 },
        ],
      },
    },
  });
  const batch = await db.interCoSettlementBatch.create({
    data: {
      batchNumber: 'IC-' + randomUUID(),
      status: 'POSTED',
      transferDate: new Date(),
      financeBankCode: '11-1201',
      shopBankCode: 'S11-1201',
      totalFinanced: 12000,
      totalCommission: 0,
      totalAmount: 12000,
      shopPostedAmount: 0,
      makerId: legacy,
      financeJournalEntryId: source.id,
      items: {
        create: {
          contractId: c.id,
          financedGl: 12000,
          commissionGl: 0,
          shopFinancedGl: 0,
          shopCommissionGl: 0,
          legacyNoShop: true,
        },
      },
    },
  });
  return { c, source, batch };
}
it('managed settled cancellation uses canonical C2 recall redirect without reversing actual transfer cash', async () => {
  for (const code of ['11-2107', '11-1201'])
    await db.chartOfAccount.upsert({
      where: { code },
      update: {},
      create: { code, name: code, type: 'สินทรัพย์', normalBalance: 'Dr' },
    });
  const { c, source } = await settledContract();
  const row = await managedRequest(c);
  expect((await http('post', `/contracts/cancellations/${row.id}/approve`, owner)).status).toBe(
    201,
  );
  const approved = await db.contractCancellation.findUniqueOrThrow({
    where: { id: row.id },
    include: { reversalJournalEntry: { include: { lines: true } } },
  });
  expect(
    approved.reversalJournalEntry?.lines.map((l) => [
      l.accountCode,
      String(l.debit),
      String(l.credit),
    ]),
  ).toEqual([
    ['11-2101', '0', '12000'],
    ['11-2107', '12000', '0'],
  ]);
  expect(approved.reversalJournalEntry?.metadata).toMatchObject({
    shopReceivableType: 'PAYOUT_RECALL',
  });
  expect(await db.journalEntry.findUnique({ where: { id: source.id } })).toMatchObject({
    status: 'POSTED',
    metadata: { flow: 'interco-settlement-batch' },
  });
});
it('missing current posted-batch journal source makes settlement unavailable and request unusable', async () => {
  const { c, batch } = await settledContract();
  await db.interCoSettlementBatch.update({
    where: { id: batch.id },
    data: { financeJournalEntryId: randomUUID() },
  });
  await pending(c.id);
  const queue = await http('get', '/contracts/cancellations/pending', owner);
  expect(queue.body.find((r: { contractId: string }) => r.contractId === c.id)).toMatchObject({
    settledInBatch: null,
    recallAmount: null,
    availability: { settlement: 'UNAVAILABLE' },
  });
  expect(
    (
      await http('post', `/contracts/${c.id}/request-cancellation`, actor, {
        reason: 'Actual source required',
        refundAmount: 0,
      })
    ).status,
  ).toBe(403);
});
it('journal line visibility and typed classification are fingerprint inputs', async () => {
  const c = await contract();
  const source = await ledger(c.id);
  const row = await managedRequest(c);
  await db.journalLine.updateMany({
    where: { journalEntryId: source.id },
    data: { deletedAt: new Date() },
  });
  expect((await http('post', `/contracts/cancellations/${row.id}/approve`, owner)).status).toBe(
    409,
  );
  expect(await db.contractCancellation.findUnique({ where: { id: row.id } })).toMatchObject({
    status: 'PENDING',
  });
});
it('draft disposal retains committed loyalty evidence without recrediting', async () => {
  const c = await contract(true);
  const redemption = await db.loyaltyRedemption.create({
    data: {
      customerId: c.customerId,
      contractId: c.id,
      points: 100,
      reason: 'Committed evidence',
      discountAmount: 100,
    },
  });
  const before = await db.loyaltyPoint.findMany({ where: { customerId: c.customerId } });
  expect((await http('delete', `/contracts/${c.id}`, owner, {}, 'SHOP')).status).toBe(200);
  expect(await db.loyaltyRedemption.findUnique({ where: { id: redemption.id } })).toEqual(
    redemption,
  );
  expect(await db.loyaltyPoint.findMany({ where: { customerId: c.customerId } })).toEqual(before);
});

it('draft reversal refuses a down-payment journal borrowed from the wrong book', async () => {
  const c = await downDraft();
  await db.journalEntry.updateMany({
    where: { metadata: { path: ['idempotencyKey'], equals: `shop-down-payment:${c.id}` } },
    data: { companyId: finance },
  });
  expect((await http('delete', `/contracts/${c.id}`, owner, {}, 'SHOP')).status).toBe(403);
  expect(await db.contract.findUnique({ where: { id: c.id } })).toMatchObject({ deletedAt: null });
});

it('managed direct service calls cannot bypass the exact owned executor', async () => {
  const c = await contract();
  await ledger(c.id);
  const row = await managedRequest(c);
  await expect(service.requestCancellation(c.id, actor, 'Bypass', 0)).rejects.toMatchObject({
    status: 403,
  });
  await expect(service.approveCancellation(row.id, owner)).rejects.toMatchObject({ status: 403 });
  await expect(service.rejectCancellation(row.id, owner, 'Bypass')).rejects.toMatchObject({
    status: 403,
  });
  const draft = await contract(true);
  await expect(service.softDelete(draft.id, owner)).rejects.toMatchObject({ status: 403 });
  await unchanged(c, row);
});
it('requester becoming unmanaged does not turn marked evidence into legacy approval', async () => {
  const who = await person();
  await grant(who, writes, 'FINANCE', [branch]);
  const c = await contract();
  await ledger(c.id);
  const row = await managedRequest(c, who);
  await db.user.update({ where: { id: who }, data: { accessManaged: false } });
  expect((await http('post', `/contracts/cancellations/${row.id}/approve`, legacy)).status).toBe(
    403,
  );
  await unchanged(c, row);
});

async function saleFor(c: Awaited<ReturnType<typeof contract>>) {
  return db.sale.create({
    data: {
      saleNumber: 'SALE-' + randomUUID(),
      saleType: 'INSTALLMENT',
      customerId: c.customerId,
      productId: c.productId,
      branchId: branch,
      salespersonId: actor,
      sellingPrice: 12000,
      netAmount: 12000,
      contractId: c.id,
    },
  });
}
it.each(['PENDING', 'RECEIVED'] as const)(
  'own receivable source is checked only for the actually affected %s row',
  async (status) => {
    const c = await contract();
    await ledger(c.id);
    const sale = await saleFor(c);
    const wrong = await db.branch.create({
      data: { name: 'Wrong receivable book', companyId: finance },
    });
    const receivable = await db.financeReceivable.create({
      data: {
        saleId: sale.id,
        branchId: wrong.id,
        financeCompany: 'BESTCHOICE',
        expectedAmount: 12000,
        netExpectedAmount: 12000,
        expectedDate: new Date(),
        status,
        receivedAmount: status === 'RECEIVED' ? 12000 : 0,
      },
    });
    const response = await http('post', `/contracts/${c.id}/request-cancellation`, actor, {
      reason: 'Own affected source',
      refundAmount: 0,
    });
    if (status === 'PENDING') {
      expect(response.status).toBe(403);
      expect(await db.contractCancellation.count({ where: { contractId: c.id } })).toBe(0);
      await db.financeReceivable.update({
        where: { id: receivable.id },
        data: { branchId: branch },
      });
      const row = await managedRequest(c);
      expect((await http('post', `/contracts/cancellations/${row.id}/approve`, owner)).status).toBe(
        201,
      );
      expect(await db.financeReceivable.findUnique({ where: { id: receivable.id } })).toMatchObject(
        { deletedAt: expect.any(Date) },
      );
    } else {
      expect(response.status).toBe(201);
      expect(
        (
          await http(
            'post',
            `/contracts/cancellations/${response.body.cancellationId}/approve`,
            owner,
          )
        ).status,
      ).toBe(201);
      expect(await db.financeReceivable.findUnique({ where: { id: receivable.id } })).toEqual(
        receivable,
      );
    }
  },
);
it('credit cleanup requires the actually affected intercompany books and preserves state on denial', async () => {
  const { c, trade, redemption } = await creditDraft();
  const sale = await saleFor(c);
  const unknown = await db.companyInfo.create({
    data: {
      nameTh: 'Invalid source book',
      taxId: 'owned',
      address: 'fixture',
      directorName: 'fixture',
      isActive: false,
    },
  });
  const interco = await db.interCompanyTransaction.create({
    data: {
      saleId: sale.id,
      contractId: c.id,
      branchId: branch,
      type: 'FINANCE_PURCHASE',
      fromEntity: 'FINANCE',
      toEntity: 'SHOP',
      fromCompanyId: unknown.id,
      toCompanyId: shop,
      principal: 11000,
      commission: 0,
      commissionPct: 0,
      vatAmount: 0,
      vatPct: 0,
      totalAmount: 11000,
      interestTotal: 0,
      costPrice: 6000,
      downPayment: 1000,
      sellingPrice: 12000,
      shopProfit: 6000,
      financeProfit: 0,
    },
  });
  expect((await http('delete', `/contracts/${c.id}`, owner, {}, 'SHOP')).status).toBe(403);
  expect(await db.tradeIn.findUnique({ where: { id: trade.id } })).toMatchObject({
    currentRedemptionId: redemption.id,
  });
  expect(await db.interCompanyTransaction.findUnique({ where: { id: interco.id } })).toMatchObject({
    status: 'PENDING',
    deletedAt: null,
  });
  await db.interCompanyTransaction.update({
    where: { id: interco.id },
    data: { fromCompanyId: finance },
  });
  expect((await http('delete', `/contracts/${c.id}`, owner, {}, 'SHOP')).status).toBe(200);
  expect(await db.interCompanyTransaction.findUnique({ where: { id: interco.id } })).toMatchObject({
    status: 'CANCELLED',
    deletedAt: expect.any(Date),
  });
});
it('changed converted-booking membership makes a credit cancellation stale', async () => {
  const { c } = await creditDraft();
  await db.contract.update({ where: { id: c.id }, data: { status: 'ACTIVE' } });
  await ledger(c.id);
  const sale = await saleFor(c);
  const row = await managedRequest(c);
  await db.booking.create({
    data: {
      bookingNumber: 'CONVERT-' + randomUUID(),
      customerId: c.customerId,
      branchId: branch,
      status: 'PAID',
      depositAmount: 1000,
      totalAmount: 12000,
      expireDate: new Date(),
      createdById: actor,
      convertedToSaleId: sale.id,
    },
  });
  expect((await http('post', `/contracts/cancellations/${row.id}/approve`, owner)).status).toBe(
    409,
  );
  await unchanged(c, row);
});
it('queue scopes before the 10000-Contract envelope and rejects visible overflow without truncation', async () => {
  const c = await contract();
  const visible = await pending(c.id);
  const other = await db.branch.create({
    data: { name: 'Owned envelope foreign origin', companyId: shop },
  });
  const ids: string[] = Array.from({ length: 10001 }, () => randomUUID());
  try {
    for (let offset = 0; offset < ids.length; offset += 500) {
      const batch = ids.slice(offset, offset + 500);
      await db.contract.createMany({
        data: batch.map((id) => ({
          id,
          contractNumber: 'BOUND-' + id,
          customerId: c.customerId,
          productId: c.productId,
          branchId: other.id,
          salespersonId: actor,
          planType: 'STORE_WITH_INTEREST',
          sellingPrice: 12000,
          downPayment: 0,
          financedAmount: 12000,
          totalMonths: 12,
          monthlyPayment: 1000,
          interestRate: 0,
          interestTotal: 0,
          vatAmount: 0,
          vatPct: 0,
          status: 'ACTIVE',
          workflowStatus: 'CREATING',
        })),
      });
      await db.contractCancellation.createMany({
        data: batch.map((contractId) => ({
          contractId,
          requestedById: actor,
          reason: 'Owned envelope',
          refundAmount: 0,
        })),
      });
    }
    const scoped = await http('get', '/contracts/cancellations/pending', actor);
    expect(scoped.status).toBe(200);
    expect(scoped.body.some((r: { id: string }) => r.id === visible.id)).toBe(true);
    expect(scoped.body.some((r: { contractId: string }) => ids.includes(r.contractId))).toBe(false);
    const overflow = await http('get', '/contracts/cancellations/pending', owner);
    expect(overflow.status).toBe(403);
    expect(JSON.stringify(overflow.body)).not.toContain(ids[0]);
  } finally {
    await db.contractCancellation.deleteMany({ where: { contractId: { in: ids } } });
    await db.contract.deleteMany({ where: { id: { in: ids } } });
  }
}, 30000);
