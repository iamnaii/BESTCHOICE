import { AccessPayoffRequestBoundary } from './access-payoff-request-boundary';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { AuditService } from '../audit/audit.service';
import { PaymentApprovalController } from '../payments/payment-approval.controller';
import { PaymentsService } from '../payments/payments.service';
import {
  consumePaymentApproval,
  MANAGED_PAYOFF_SOURCE_KEY,
  paymentApprovalSnapshot,
} from '../payments/services/payment-approval-request.util';
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
import { ProductsService } from '../products/products.service';
import { ReceiptsService } from '../receipts/receipts.service';
import { JournalAutoService } from '../journal/journal-auto.service';
import { EarlyPayoffJP4Template } from '../journal/cpa-templates/early-payoff-jp4.template';
import { ShopCollectSettlementTemplate } from '../journal/cpa-templates/shop-collect-settlement.template';
import { EclStageReverseTemplate } from '../journal/cpa-templates/ecl-stage-reverse.template';

const url = process.env.EMPLOYEE_ACCESS_TEST_DATABASE_URL;
if (
  !url?.includes('/bc_access_payoff_requests?host=/tmp/bc-access-payoff-requests.') ||
  process.env.DATABASE_URL !== url ||
  process.env.DATABASE_URL_FINANCE !== url
)
  throw new Error('Both database URLs must identify the owned isolated cluster');
const db = new PrismaClient({
  datasources: { db: { url } },
});
const audit = { log: jest.fn().mockResolvedValue(undefined) };
const snapshots = new AccessSnapshotService(db as PrismaService);
const marker = randomUUID();
const reads: PermissionKey[] = ['contracts.read', 'payments.read'];
const writes: PermissionKey[] = [...reads, 'payments.create'];
const sensitive: PermissionKey[] = ['sensitive.cost.read', 'sensitive.profit.read'];
let app: INestApplication;
let actor: string, denied: string, owner: string, assigned: string, full: string, legacy: string;
let branchA: string, branchB: string, contractA: string, contractB: string, assignedCase: string;
async function user(role: 'ACCOUNTANT' | 'OWNER' = 'ACCOUNTANT') {
  return (
    await db.user.create({
      data: {
        name: 'Owned quote reader',
        email: randomUUID() + '@test.invalid',
        password: 'unused',
        role,
        accessManaged: true,
      },
    })
  ).id;
}
async function grant(
  userId: string,
  permissions: PermissionKey[],
  companyCode = 'FINANCE',
  branches?: string[],
  assignedScope = false,
) {
  const position = await db.accessPosition.create({
    data: {
      code: randomUUID(),
      name: 'Owned test',
      permissions,
    },
  });
  return db.employeeAccessAssignment.create({
    data: {
      userId,
      positionId: position.id,
      companyCode,
      scope: assignedScope ? 'ASSIGNED' : branches ? 'BRANCHES' : 'COMPANY',
      ...(branches ? { branches: { create: branches.map((branchId) => ({ branchId })) } } : {}),
    },
  });
}
async function contract(branchId = branchA, assignedToId?: string) {
  const customer = await db.customer.create({
    data: { name: 'PRIVATE CUSTOMER', phone: '0811111111' },
  });
  const product = await db.product.create({
    data: {
      name: 'PRIVATE PRODUCT',
      brand: 'Apple',
      model: 'Test',
      category: 'PHONE_NEW',
      costPrice: 7777,
      branchId,
    },
  });
  const row = await db.contract.create({
    data: {
      contractNumber: 'TEST-' + randomUUID(),
      customerId: customer.id,
      productId: product.id,
      branchId,
      salespersonId: actor,
      assignedToId,
      planType: 'STORE_WITH_INTEREST',
      sellingPrice: 12000,
      downPayment: 2000,
      financedAmount: 12000,
      interestRate: 0.01,
      totalMonths: 10,
      interestTotal: 2000,
      storeCommission: 0,
      monthlyPayment: 1200,
      notes: 'NEVER-CONTRACT-NOTES',
      contractHash: 'NEVER-HASH',
      status: 'ACTIVE',
    },
  });
  for (let installmentNo = 1; installmentNo <= 10; installmentNo++) {
    await db.payment.create({
      data: {
        contractId: row.id,
        installmentNo,
        dueDate: new Date('2026-01-01'),
        amountDue: 1200,
        monthlyPrincipal: 1000,
        monthlyInterest: 200,
        monthlyCommission: 0,
        notes: 'NEVER-PAYMENT-NOTES',
        evidenceUrl: 'NEVER-EVIDENCE-KEY',
        gatewayResponse: { private: 'NEVER-GATEWAY' },
      },
    });
    await db.installmentSchedule.create({
      data: {
        contractId: row.id,
        installmentNo,
        dueDate: new Date('2026-01-01'),
        principal: 1000,
        interest: 200,
        amountDue: 1200,
      },
    });
  }
  return row.id;
}
function http(route: string, id = actor, company = 'FINANCE') {
  return request(app.getHttpServer())
    .post(route)
    .set('x-test-user', id)
    .set('x-company-scope', company)
    .expect('x-owned-payoff-request-app', marker);
}
const path = (id: string, route: string) => `/contracts/${id}/${route}`;
beforeAll(async () => {
  const shop = await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'SHOP' } });
  branchA = (await db.branch.create({ data: { name: 'A', companyId: shop.id } })).id;
  branchB = (await db.branch.create({ data: { name: 'B', companyId: shop.id } })).id;
  actor = await user();
  denied = await user();
  owner = await user('OWNER');
  assigned = await user();
  full = await user();
  await grant(actor, writes, 'FINANCE', [branchA]);
  await grant(actor, [...reads, ...sensitive, 'journal.read'], 'SHOP', [branchB]);
  await grant(full, writes, 'FINANCE');
  await grant(assigned, reads, 'FINANCE', [branchA], true);
  await grant(assigned, ['payments.create'], 'FINANCE', [branchA]);
  legacy = await user('OWNER');
  await db.user.update({ where: { id: legacy }, data: { accessManaged: false } });
  contractA = await contract();
  contractB = await contract(branchB);
  assignedCase = await contract(branchA, assigned);
  const module = await Test.createTestingModule({
    controllers: [ContractsController, PaymentApprovalController],
    providers: [
      AccessPayoffRequestBoundary,
      ContractPaymentService,
      AccessResourceService,
      AccessPartySourceService,
      AccessProcurementSourceService,
      AccessPolicyService,
      { provide: PrismaService, useValue: db },
      { provide: AccessSnapshotService, useValue: snapshots },
      ...[
        PaymentsService,
        ContractWorkflowService,
        ContractDocumentService,
        ContractSnapshotService,
        ContractJournalQueryService,
        EarlyPayoffSlipService,
        JourneyEntryWriter,
        ProductsService,
        ReceiptsService,
        JournalAutoService,
        EarlyPayoffJP4Template,
        ShopCollectSettlementTemplate,
        EclStageReverseTemplate,
      ].map((provide) => ({ provide, useValue: {} })),
      {
        provide: ContractsService,
        useValue: { findOne: (id: string) => db.contract.findUniqueOrThrow({ where: { id } }) },
      },
      { provide: AuditService, useValue: audit },
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
  app.use((_req: unknown, res: { setHeader: (k: string, v: string) => void }, next: () => void) => {
    res.setHeader('x-owned-payoff-request-app', marker);
    next();
  });
  app.useGlobalPipes(
    new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
  );
  await app.listen(0, '127.0.0.1');
}, 60000);
afterAll(async () => {
  await app?.close();
  await db.$disconnect();
});

const body = { paymentMethod: 'BANK_TRANSFER', reason: 'Review this exact payoff request' };
async function pending(id: string, requester = actor, extra: Record<string, unknown> = {}) {
  const response = await http(path(id, 'early-payoff'), requester)
    .send({ ...body, ...extra })
    .expect(201);
  expect(response.body).toEqual({ requestId: expect.any(String), status: 'PENDING_APPROVAL' });
  const row = await db.paymentApprovalRequest.findUniqueOrThrow({
    where: { id: response.body.requestId },
  });
  expect(row).toMatchObject({
    action: 'EARLY_PAYOFF',
    status: 'PENDING',
    requestedById: requester,
    contractId: id,
    targetId: id,
  });
  expect(row.reviewSummary).toMatchObject({
    discountPct: 50,
    discountAmount: 1000,
    totalPayoff: 11000,
  });
  return row;
}
it('genuine legacy request producer preserves raw canonical snapshot and default quote', async () => {
  const id = await contract();
  const response = await http('/payments/approval-requests', legacy)
    .send({
      action: 'EARLY_PAYOFF',
      targetId: id,
      reason: body.reason,
      payload: { paymentMethod: 'BANK_TRANSFER' },
    })
    .expect(201);
  const snap = await db.$transaction((tx) => paymentApprovalSnapshot(tx, 'EARLY_PAYOFF', id));
  expect(response.body.snapshot).toEqual(snap.snapshot);
  expect(response.body.reviewSummary).toMatchObject({
    discountPct: 50,
    discountAmount: 1000,
    totalPayoff: 11000,
    journalPreview: expect.any(Object),
  });
  expect(response.body.status).toBe('PENDING');
});
it('authorized scoped staff creates an honestly pending request with no money or effects', async () => {
  await pending(contractA);
  expect(await db.contract.findUnique({ where: { id: contractA } })).toMatchObject({
    status: 'ACTIVE',
  });
  expect(await db.payment.count({ where: { contractId: contractA, status: 'PAID' } })).toBe(0);
  expect(await db.journalEntry.count()).toBe(0);
  expect(await db.receipt.count()).toBe(0);
  expect(await db.slipFingerprint.count()).toBe(0);
});
it('current protected owner creates pending rather than executing a reduction', async () => {
  await pending(await contract(), owner);
});
it('explicit FINANCE COMPANY authority creates a pending request at either origin', async () => {
  await pending(await contract(branchB), full);
});
it('current ASSIGNED ordinary reads combine with independently scoped mutation', async () => {
  await pending(assignedCase, assigned);
});
it('no grants and foreign source remain denied before private snapshot', async () => {
  await http(path(contractB, 'early-payoff')).send(body).expect(403);
  await http(path(contractA, 'early-payoff'), denied).send(body).expect(403);
});
it('selected SHOP is not FINANCE authority', async () => {
  await http(path(contractA, 'early-payoff'), actor, 'SHOP').send(body).expect(403);
});
it('separate action and branch tuples cannot cross multiply', async () => {
  const id = await user();
  await grant(id, reads, 'FINANCE', [branchA]);
  await grant(id, ['payments.create'], 'FINANCE', [branchB]);
  await http(path(contractA, 'early-payoff'), id).send(body).expect(403);
});
it('ASSIGNED mutation does not authorize request creation', async () => {
  const id = await user();
  await grant(id, writes, 'FINANCE', [branchA], true);
  await http(path(await contract(branchA, id), 'early-payoff'), id)
    .send(body)
    .expect(403);
});
it('source retirement denies a formerly useful current request', async () => {
  const shop = await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'SHOP' } });
  const branch = await db.branch.create({ data: { name: 'Retired origin', companyId: shop.id } });
  const id = await contract(branch.id);
  await pending(id, full);
  await db.branch.update({ where: { id: branch.id }, data: { isActive: false } });
  await http(path(id, 'early-payoff'), full).send(body).expect(403);
});
it('actual HTTP rejects fabricated approval, source and snapshot fields', async () => {
  for (const extra of [
    { approvalContext: { actorId: owner } },
    { snapshot: {} },
    { source: {} },
    { managedEarlyPayoffSource: { version: 1, requesterId: owner } },
    { requestedById: owner },
    { reviewSummary: { totalPayoff: 0 } },
  ]) {
    await http(path(await contract(), 'early-payoff'))
      .send({ ...body, ...extra })
      .expect(400);
  }
});
it('explicit bounded reason and unverified slip URL are rejected', async () => {
  for (const extra of [
    { reason: '' },
    { reason: ' '.repeat(4) },
    { reason: 'x'.repeat(1001) },
    { slipUrl: 'https://example.invalid/private' },
  ]) {
    await http(path(await contract(), 'early-payoff'))
      .send({ ...body, ...extra })
      .expect(400);
  }
});

it('server envelope is exact persisted provenance and canonical snapshot is otherwise unchanged', async () => {
  const id = await contract();
  const row = await pending(id);
  const finance = await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'FINANCE' } });
  const origin = await db.branch.findUniqueOrThrow({ where: { id: branchA } });
  const snapshot = row.snapshot as Prisma.JsonObject;
  expect(snapshot[MANAGED_PAYOFF_SOURCE_KEY]).toEqual({
    version: 1,
    requesterId: actor,
    contractId: id,
    financeCompanyId: finance.id,
    originShopCompanyId: origin.companyId,
    originBranchId: branchA,
  });
  const canonical = await db.$transaction((tx) => paymentApprovalSnapshot(tx, 'EARLY_PAYOFF', id));
  expect(
    Object.fromEntries(
      Object.entries(snapshot).filter(([key]) => key !== MANAGED_PAYOFF_SOURCE_KEY),
    ),
  ).toEqual(canonical.snapshot);
  expect(row.payload).toMatchObject({
    paymentMethod: 'BANK_TRANSFER',
    paymentDate: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }),
  });
  const event = await db.auditLog.findFirstOrThrow({
    where: { entityId: row.id, action: 'PAYMENT_APPROVAL_REQUESTED' },
  });
  expect(event.userId).toBe(actor);
  expect(event.newValue).toEqual({
    action: 'EARLY_PAYOFF',
    targetId: id,
    requestedById: actor,
    sourceVersion: 1,
    status: 'PENDING',
  });
});
it('concurrent real HTTP requests create exactly one pending request and audit, then replay conflicts', async () => {
  const id = await contract();
  const results = await Promise.all([
    http(path(id, 'early-payoff')).send(body),
    http(path(id, 'early-payoff')).send(body),
  ]);
  expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
  const rows = await db.paymentApprovalRequest.findMany({ where: { targetId: id } });
  expect(rows).toHaveLength(1);
  expect(
    await db.auditLog.count({
      where: { entityId: rows[0].id, action: 'PAYMENT_APPROVAL_REQUESTED' },
    }),
  ).toBe(1);
  await http(path(id, 'early-payoff'))
    .send({ ...body, discountPct: 0 })
    .expect(409);
  expect(rows[0].reviewSummary).toMatchObject({ discountAmount: 1000 });
});
it('actual late required-audit failure rolls the new request back', async () => {
  const id = await contract();
  await db.$executeRawUnsafe(
    `CREATE FUNCTION task_payoff_request_audit_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'PAYMENT_APPROVAL_REQUESTED' AND NEW.new_value->>'targetId' = '${id}' THEN RAISE EXCEPTION 'OWNED-LATE-AUDIT-FAILURE'; END IF; RETURN NEW; END $$`,
  );
  await db.$executeRawUnsafe(
    'CREATE TRIGGER task_payoff_request_audit_fail BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION task_payoff_request_audit_fail()',
  );
  try {
    const result = await http(path(id, 'early-payoff')).send(body).expect(500);
    expect(JSON.stringify(result.body)).not.toContain('OWNED-LATE-AUDIT-FAILURE');
    expect(await db.paymentApprovalRequest.count({ where: { targetId: id } })).toBe(0);
    expect(await db.contract.findUnique({ where: { id } })).toMatchObject({ status: 'ACTIVE' });
    expect(await db.payment.count({ where: { contractId: id, status: 'PAID' } })).toBe(0);
  } finally {
    await db.$executeRawUnsafe('DROP TRIGGER task_payoff_request_audit_fail ON audit_logs');
    await db.$executeRawUnsafe('DROP FUNCTION task_payoff_request_audit_fail()');
  }
  await pending(id);
});
it('both current owner and legacy permission approver cannot execute managed pending envelope', async () => {
  const id = await contract();
  const row = await pending(id);
  const approver = await user();
  await db.user.update({ where: { id: approver }, data: { accessManaged: false } });
  await db.systemConfig.upsert({
    where: { key: 'payment_approval_permissions' },
    create: {
      key: 'payment_approval_permissions',
      value: JSON.stringify({ [approver]: ['EARLY_PAYOFF'] }),
    },
    update: { value: JSON.stringify({ [approver]: ['EARLY_PAYOFF'] }) },
  });
  for (const reviewer of [owner, approver]) {
    const response = await http(`/payments/approval-requests/${row.id}/approve`, reviewer)
      .send({ reason: 'Actual reviewer request' })
      .expect(403);
    expect(response.body.message).toContain('ยังรอขั้นตอนอนุมัติของเจ้าของ');
  }
  expect(await db.paymentApprovalRequest.findUnique({ where: { id: row.id } })).toMatchObject({
    status: 'PENDING',
    reviewedById: null,
  });
  expect(
    await db.auditLog.count({ where: { entityId: row.id, action: 'PAYMENT_APPROVAL_APPROVED' } }),
  ).toBe(0);
  expect(await db.journalEntry.count()).toBe(0);
  expect(await db.receipt.count()).toBe(0);
  expect(await db.paymentEvidence.count()).toBe(0);
  expect(await db.slipFingerprint.count()).toBe(0);
});
it('legacy unmarked snapshot remains genuinely consumable with original actor and money', async () => {
  const id = await contract();
  const response = await http('/payments/approval-requests', legacy)
    .send({
      action: 'EARLY_PAYOFF',
      targetId: id,
      reason: 'Legacy reason',
      payload: {
        paymentMethod: 'BANK_TRANSFER',
        discountPct: 80,
        collectedByShop: true,
        slipUrl: 'legacy-evidence',
      },
    })
    .expect(201);
  expect(response.body.snapshot[MANAGED_PAYOFF_SOURCE_KEY]).toBeUndefined();
  expect(response.body.reviewSummary).toMatchObject({ discountPct: 50, discountAmount: 1000 });
  expect(response.body.payload).toMatchObject({
    discountPct: 80,
    slipUrl: 'legacy-evidence',
    collectedByShop: true,
  });
  const rollback = new Error('ROLLBACK-LEGACY-CONSUMPTION');
  await expect(
    db.$transaction(async (tx) => {
      const result = await consumePaymentApproval(
        tx,
        {
          requestId: response.body.id,
          actorId: legacy,
          reason: 'Original owner self-review reason',
        },
        'EARLY_PAYOFF',
        id,
      );
      expect(result.requestedById).toBe(legacy);
      expect(result.approverId).toBe(legacy);
      expect(result.reviewSummary).toEqual(response.body.reviewSummary);
      expect(
        await tx.paymentApprovalRequest.findUnique({ where: { id: response.body.id } }),
      ).toMatchObject({ status: 'APPROVED' });
      throw rollback;
    }),
  ).rejects.toBe(rollback);
});
it.each([0, 80, 100])(
  'preserves actual effective discount and raw request rate %s without applying it',
  async (discountPct) => {
    const id = await contract();
    const response = await http(path(id, 'early-payoff'))
      .send({ ...body, discountPct, slipUrl: '' })
      .expect(201);
    const row = await db.paymentApprovalRequest.findUniqueOrThrow({
      where: { id: response.body.requestId },
    });
    expect(row.payload).toMatchObject({ discountPct });
    expect(row.reviewSummary).toMatchObject({
      discountPct: Math.min(discountPct, 50),
      discountAmount: discountPct ? 1000 : 0,
      totalPayoff: discountPct ? 11000 : 12000,
    });
  },
);
it.each([-1, 101, '50', null])(
  'canonical request rejects invalid discount %s',
  async (discountPct) => {
    await http(path(await contract(), 'early-payoff'))
      .send({ ...body, discountPct })
      .expect(400);
  },
);
it.each([
  { paymentMethod: 'CARD' },
  { depositAccountCode: '11-1101' },
  { paymentDate: 'not-a-date' },
  { collectedByShop: 'true' },
])('canonical payload validation rejects %j', async (extra) => {
  await http(path(await contract(), 'early-payoff'))
    .send({ ...body, ...extra })
    .expect(400);
});
it('each ordinary read is independent of mutation permission and foreign read tuples', async () => {
  for (const missing of reads) {
    const reader = await user();
    await grant(
      reader,
      writes.filter((p) => p !== missing),
      'FINANCE',
      [branchA],
    );
    await grant(reader, [missing], 'FINANCE', [branchB]);
    await http(path(await contract(), 'early-payoff'), reader)
      .send(body)
      .expect(403);
  }
});
it('current assignment cannot be replaced by salesperson attribution', async () => {
  const id = await contract(branchA, assigned);
  await pending(id, assigned);
  await db.contract.update({
    where: { id },
    data: { assignedToId: null, salespersonId: assigned },
  });
  await http(path(id, 'early-payoff'), assigned).send(body).expect(403);
});
it('deleted, missing, inactive FINANCE or invalid SHOP origin are uniformly unavailable', async () => {
  const id = await contract();
  await db.contract.update({ where: { id }, data: { deletedAt: new Date() } });
  for (const target of [id, randomUUID()])
    await http(path(target, 'early-payoff'), owner).send(body).expect(403);
  const finance = await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'FINANCE' } });
  await db.companyInfo.update({ where: { id: finance.id }, data: { isActive: false } });
  try {
    await http(path(contractA, 'early-payoff'), owner).send(body).expect(403);
  } finally {
    await db.companyInfo.update({ where: { id: finance.id }, data: { isActive: true } });
  }
  const branch = await db.branch.create({ data: { name: 'Wrong source', companyId: finance.id } });
  await http(path(await contract(branch.id), 'early-payoff'), owner)
    .send(body)
    .expect(403);
});
it('canonical invalid contract state and all-paid errors are generic with no raw snapshot', async () => {
  const id = await contract();
  await db.contract.update({ where: { id }, data: { status: 'DRAFT' } });
  expect((await http(path(id, 'early-payoff')).send(body).expect(400)).body.message).toBe(
    'ไม่สามารถสร้างคำขอรายการนี้ได้',
  );
  const paid = await contract();
  await db.payment.updateMany({ where: { contractId: paid }, data: { status: 'PAID' } });
  await http(path(paid, 'early-payoff')).send(body).expect(400);
  expect(await db.paymentApprovalRequest.count({ where: { targetId: { in: [id, paid] } } })).toBe(
    0,
  );
});
it('safe HTTP audit excludes genuine reason, notes and rejected private body for success and denial', async () => {
  audit.log.mockClear();
  await http(path(await contract(), 'early-payoff'))
    .send({ ...body, reason: 'NEVER-PRIVATE-REASON', notes: 'NEVER-PRIVATE-NOTES' })
    .expect(201);
  await http(path(contractB, 'early-payoff'))
    .send({ ...body, notes: 'NEVER-PRIVATE-DENIED' })
    .expect(403);
  const calls = audit.log.mock.calls.map((call) => call[0]);
  expect(calls.map((call) => call.action)).toEqual(['POST', 'POST_ERROR']);
  expect(JSON.stringify(calls)).not.toContain('NEVER-PRIVATE');
  expect(calls.every((call) => call.ipAddress === undefined && call.userAgent === undefined)).toBe(
    true,
  );
});

async function observedLockWait(
  begin: (tx: Prisma.TransactionClient) => Promise<unknown>,
  read: () => Promise<request.Response>,
  mutate: (tx: Prisma.TransactionClient) => Promise<unknown>,
) {
  let response: Promise<request.Response> | undefined;
  await db.$transaction(
    async (tx) => {
      const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      await begin(tx);
      response = read();
      let waited = false;
      for (let i = 0; i < 200; i++) {
        await tx.$executeRaw`SELECT pg_stat_clear_snapshot()`;
        const [state] = await tx.$queryRaw<{ waiting: boolean }[]>`SELECT EXISTS(
        SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND ${pid}=ANY(pg_blocking_pids(pid))
      ) AS waiting`;
        if (state.waiting) {
          waited = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      expect(waited).toBe(true);
      await mutate(tx);
    },
    { timeout: 10000 },
  );
  return response!;
}

it('rechecks Contract source after a real PostgreSQL lock wait', async () => {
  const id = await contract();
  const result = await observedLockWait(
    (tx) => tx.$queryRaw`SELECT id FROM contracts WHERE id=${id} FOR UPDATE`,
    () =>
      http(path(id, 'early-payoff'))
        .send(body)
        .then((r) => r),
    (tx) => tx.contract.update({ where: { id }, data: { branchId: branchB } }),
  );
  expect(result.status).toBe(403);
  expect(await db.paymentApprovalRequest.count({ where: { targetId: id } })).toBe(0);
});
it('rechecks actual write-grant retirement after a real position lock wait', async () => {
  const requester = await user();
  const assignment = await grant(requester, writes, 'FINANCE', [branchA]);
  const id = await contract();
  const result = await observedLockWait(
    (tx) =>
      tx.$queryRaw`SELECT id FROM access_positions WHERE id=${assignment.positionId} FOR UPDATE`,
    () =>
      http(path(id, 'early-payoff'), requester)
        .send(body)
        .then((r) => r),
    (tx) =>
      tx.accessPosition.update({
        where: { id: assignment.positionId },
        data: { permissions: reads },
      }),
  );
  expect(result.status).toBe(403);
  expect(await db.paymentApprovalRequest.count({ where: { targetId: id } })).toBe(0);
});
it('snapshots fresh exact payment money after a real payment lock wait', async () => {
  const id = await contract();
  const payment = await db.payment.findFirstOrThrow({ where: { contractId: id } });
  const result = await observedLockWait(
    (tx) => tx.$queryRaw`SELECT id FROM payments WHERE id=${payment.id} FOR UPDATE`,
    () =>
      http(path(id, 'early-payoff'))
        .send(body)
        .then((r) => r),
    (tx) =>
      tx.payment.update({ where: { id: payment.id }, data: { status: 'PAID', amountPaid: 1200 } }),
  );
  expect(result.status).toBe(201);
  const row = await db.paymentApprovalRequest.findUniqueOrThrow({
    where: { id: result.body.requestId },
  });
  expect(row.reviewSummary).toMatchObject({
    remainingMonths: 9,
    discountAmount: 900,
    totalPayoff: 9900,
  });
  expect((row.snapshot as Prisma.JsonObject).payments).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: payment.id, amountPaid: '1200', status: 'PAID' }),
    ]),
  );
});

it('managed owner cannot create an unmarked payoff through legacy queue compatibility', async () => {
  const id = await contract();
  await http('/payments/approval-requests', owner)
    .send({
      action: 'EARLY_PAYOFF',
      targetId: id,
      reason: 'Managed owner compatibility attempt',
      payload: { paymentMethod: 'BANK_TRANSFER' },
    })
    .expect(403);
  expect(await db.paymentApprovalRequest.count({ where: { targetId: id } })).toBe(0);
  await pending(id, owner);
});

it('legacy admission rechecks persisted management after a real User lock wait', async () => {
  const requester = await user('OWNER');
  await db.user.update({ where: { id: requester }, data: { accessManaged: false } });
  const id = await contract();
  const input = {
    action: 'EARLY_PAYOFF',
    targetId: id,
    reason: 'Current admission',
    payload: { paymentMethod: 'BANK_TRANSFER' },
  };
  const result = await observedLockWait(
    (tx) => tx.$queryRaw`SELECT id FROM users WHERE id=${requester} FOR UPDATE`,
    () =>
      http('/payments/approval-requests', requester)
        .send(input)
        .then((r) => r),
    (tx) => tx.user.update({ where: { id: requester }, data: { accessManaged: true } }),
  );
  expect(result.status).toBe(409);
  expect(await db.paymentApprovalRequest.count({ where: { targetId: id } })).toBe(0);
  await http('/payments/approval-requests', requester).send(input).expect(403);
  await pending(id, requester);
});
it.each([' ', null])(
  'managed request cannot persist nonempty or null unverified slipUrl %s',
  async (slipUrl) => {
    await http(path(await contract(), 'early-payoff'))
      .send({ ...body, slipUrl })
      .expect(400);
  },
);
it('new producer and pending envelope do not register any additional approval or payoff routes', () => {
  const { ACCESS_BOUNDARIES } = jest.requireActual('./access-policy.registry');
  expect(ACCESS_BOUNDARIES.has('ContractsController.earlyPayoff')).toBe(true);
  for (const route of [
    'PaymentApprovalController.create',
    'PaymentApprovalController.approve',
    'ContractsController.earlyPayoffSlipVerify',
    'ContractsController.earlyPayoffSlipConfirm',
    'ContractsController.shopCollectSettlement',
  ])
    expect(ACCESS_BOUNDARIES.has(route)).toBe(false);
});

it('managed legacy-entry denial also emits only safe HTTP audit metadata', async () => {
  audit.log.mockClear();
  await http('/payments/approval-requests', owner)
    .send({
      action: 'EARLY_PAYOFF',
      targetId: await contract(),
      reason: 'NEVER-PRIVATE-COMPATIBILITY',
      payload: { paymentMethod: 'BANK_TRANSFER', notes: 'NEVER-PRIVATE-NOTES' },
    })
    .expect(403);
  const calls = audit.log.mock.calls.map((call) => call[0]);
  expect(calls).toHaveLength(1);
  expect(JSON.stringify(calls)).not.toContain('NEVER-PRIVATE');
  expect(calls[0].ipAddress).toBeUndefined();
});
it('extraction preserves other legacy request actions, including existing managed owner compatibility', async () => {
  for (const action of ['WAIVE_LATE_FEE', 'RECORD_PAYMENT']) {
    const id = await contract();
    const payment = await db.payment.findFirstOrThrow({ where: { contractId: id } });
    await db.payment.update({ where: { id: payment.id }, data: { lateFee: 100 } });
    const payload =
      action === 'WAIVE_LATE_FEE'
        ? {}
        : {
            contractId: id,
            installmentNo: payment.installmentNo,
            amount: 100,
            paymentMethod: 'CASH',
            case: 'UNDERPAY',
          };
    const response = await http('/payments/approval-requests', owner)
      .send({ action, targetId: payment.id, reason: 'Existing action compatibility', payload })
      .expect(201);
    expect(response.body).toMatchObject({ action, status: 'PENDING', requestedById: owner });
    expect(response.body.snapshot[MANAGED_PAYOFF_SOURCE_KEY]).toBeUndefined();
    expect(response.body.requiredPermissions).toEqual([
      action === 'WAIVE_LATE_FEE' ? 'WAIVE_LATE_FEE' : 'PAYMENT_TOLERANCE',
    ]);
  }
});

it('malformed HTTP body cannot create a request', async () => {
  await http(path(await contract(), 'early-payoff'))
    .send([])
    .expect(400);
  await http(path(await contract(), 'early-payoff'))
    .send({ reason: body.reason })
    .expect(400);
});
