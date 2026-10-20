import { AuditInterceptor } from '../audit/audit.interceptor';
import { AuditService } from '../audit/audit.service';
import { AccessContractPaymentReadBoundaries } from './access-contract-payment-read-boundaries';
import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { Test } from '@nestjs/testing';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ExecutionContext, INestApplication } from '@nestjs/common';
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
  !url?.includes('/bc_access_contract_payment_reads?host=/tmp/bc-access-contract-payment-reads.') ||
  process.env.DATABASE_URL !== url ||
  process.env.DATABASE_URL_FINANCE !== url
)
  throw new Error('Both database URLs must identify the owned isolated cluster');
const db = new PrismaClient({
  datasources: { db: { url } },
  log: [{ emit: 'event', level: 'query' }],
});
let queries: string[] | undefined;
db.$on('query', (event) => {
  queries?.push(event.query);
});
const audit = { log: jest.fn().mockResolvedValue(undefined) };
const snapshots = new AccessSnapshotService(db as PrismaService);
const marker = randomUUID();
const reads: PermissionKey[] = ['contracts.read', 'payments.read'];
const sensitive: PermissionKey[] = ['sensitive.cost.read', 'sensitive.profit.read'];
let app: INestApplication;
let service: ContractPaymentService;
let actor: string, denied: string, owner: string, assigned: string, full: string;
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
    .get(route)
    .set('x-test-user', id)
    .set('x-company-scope', company)
    .expect('x-owned-contract-payment-read-app', marker);
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
  await grant(actor, reads, 'FINANCE', [branchA]);
  await grant(actor, [...reads, ...sensitive, 'journal.read'], 'SHOP', [branchB]);
  await grant(full, [...reads, ...sensitive], 'FINANCE', [branchA]);
  await grant(assigned, reads, 'FINANCE', [branchA], true);
  contractA = await contract();
  contractB = await contract(branchB);
  assignedCase = await contract(branchA, assigned);
  const module = await Test.createTestingModule({
    controllers: [ContractsController],
    providers: [
      AccessContractPaymentReadBoundaries,
      ContractPaymentService,
      AccessResourceService,
      AccessPartySourceService,
      AccessProcurementSourceService,
      AccessPolicyService,
      { provide: PrismaService, useValue: db },
      { provide: AccessSnapshotService, useValue: snapshots },
      ...[
        ContractsService,
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
  service = module.get(ContractPaymentService);
  app = module.createNestApplication();
  app.use((_req: unknown, res: { setHeader: (k: string, v: string) => void }, next: () => void) => {
    res.setHeader('x-owned-contract-payment-read-app', marker);
    next();
  });
  await app.listen(0, '127.0.0.1');
}, 60000);
afterAll(async () => {
  await app?.close();
  await db.$disconnect();
});

it('canonical owner HTTP quote remains useful with exact default and clamped formulas', async () => {
  const quote = await http(path(contractA, 'early-payoff-quote'), owner).expect(200);
  expect(quote.body).toMatchObject({
    remainingMonths: 10,
    totalRemaining: 12000,
    remainingCost: 10000,
    grossProfit: 2000,
    discountPct: 50,
    discountAmount: 1000,
    totalPayoff: 11000,
  });
  const capped = await http(path(contractA, 'early-payoff-quote?discountPct=80'), owner).expect(
    200,
  );
  expect(capped.body.totalPayoff).toBe(11000);
});
it.each(['schedule', 'early-payoff-quote'])(
  'authorized marked %s is genuinely usable',
  async (route) => {
    const response = await http(path(contractA, route)).expect(200);
    if (route === 'schedule') expect(response.body.data).toHaveLength(10);
    else expect(response.body.remainingMonths).toBe(10);
  },
);
it.each(['schedule', 'early-payoff-quote'])(
  'no grants/foreign/wrong context deny %s',
  async (route) => {
    await http(path(contractA, route), denied).expect(403);
    await http(path(contractB, route)).expect(403);
    await http(path(contractA, route), actor, 'SHOP').expect(403);
  },
);
it.each(['schedule', 'early-payoff-quote'])(
  'independent payment and exact assignment required for %s',
  async (route) => {
    const contractOnly = await user();
    await grant(contractOnly, ['contracts.read'], 'FINANCE', [branchA]);
    await grant(contractOnly, ['payments.read'], 'FINANCE', [branchB]);
    await http(path(contractA, route), contractOnly).expect(403);
    await http(path(assignedCase, route), assigned).expect(200);
    await http(path(contractA, route), assigned).expect(403);
  },
);
it('ordinary staff default quote is finite and no positive-rate arithmetic oracle', async () => {
  for (const query of ['', '?discountPct=25', '?discountPct=80']) {
    const response = await http(path(contractA, 'early-payoff-quote' + query)).expect(200);
    expect(response.body).toMatchObject({
      remainingCost: null,
      grossProfit: null,
      discountAmount: null,
      totalPayoff: null,
      journalPreview: null,
      approvalRequirement: 'UNKNOWN_REQUIRES_REVIEW',
      availability: { sensitive: 'UNAVAILABLE', payoff: 'UNAVAILABLE', journal: 'UNAVAILABLE' },
    });
  }
});
it('explicit zero remains useful while sensitive quote is independently permitted', async () => {
  expect(
    (await http(path(contractA, 'early-payoff-quote?discountPct=0')).expect(200)).body,
  ).toMatchObject({
    totalPayoff: 12000,
    discountAmount: 0,
    grossProfit: null,
    approvalRequirement: 'NONE',
  });
  expect((await http(path(contractA, 'early-payoff-quote'), full).expect(200)).body).toMatchObject({
    totalPayoff: 11000,
    grossProfit: 2000,
    journalPreview: null,
    approvalRequirement: 'OWNER_APPROVAL_REQUIRED',
  });
});
it('finite schedule excludes evidence/notes/gateway and preserves contractual breakdown', async () => {
  const response = await http(path(contractA, 'schedule')).expect(200);
  expect(response.body.availability).toMatchObject({ payments: 'VISIBLE_CURRENT' });
  expect(response.body.data[0]).toMatchObject({
    installmentNo: 1,
    amountDue: '1200',
    monthlyCommission: '0',
    monthlyPrincipal: '1000',
    monthlyInterest: '200',
  });
  expect(JSON.stringify(response.body)).not.toMatch(/NEVER-|gateway|evidenceUrl|recordedById/);
});
it.each(['schedule', 'early-payoff-quote'])(
  'current source and revoked position checked for %s',
  async (route) => {
    const current = await user();
    const assignment = await grant(current, reads, 'FINANCE', [branchA]);
    await http(path(contractA, route), current).expect(200);
    await db.employeeAccessAssignment.update({
      where: { id: assignment.id },
      data: { deletedAt: new Date() },
    });
    await http(path(contractA, route), current).expect(403);
    const moved = await contract();
    await db.contract.update({ where: { id: moved }, data: { branchId: branchB } });
    await http(path(moved, route)).expect(403);
  },
);
it('shared internal calculator remains raw and has unchanged defaults', async () => {
  const result = await service.getEarlyPayoffQuote(contractA);
  expect(result).toMatchObject({ grossProfit: 2000, discountAmount: 1000, totalPayoff: 11000 });
  expect(result.journalPreview.lines.length).toBeGreaterThan(0);
});

it.each(sensitive)(
  'one sensitive capability %s never exposes the protected pair',
  async (permission) => {
    const reader = await user();
    await grant(reader, [...reads, permission], 'FINANCE', [branchA]);
    await grant(reader, sensitive, 'FINANCE', [branchB]);
    const response = await http(path(contractA, 'early-payoff-quote'), reader).expect(200);
    expect(response.body).toMatchObject({
      remainingCost: null,
      grossProfit: null,
      discountAmount: null,
      totalPayoff: null,
    });
  },
);
it.each([12000, 14000])(
  'positive-rate availability is uniform for zero/loss cost %s',
  async (sellingPrice) => {
    const id = await contract();
    await db.contract.update({ where: { id }, data: { sellingPrice, downPayment: 0 } });
    const response = await http(path(id, 'early-payoff-quote')).expect(200);
    expect(response.body).toMatchObject({
      remainingCost: null,
      grossProfit: null,
      totalPayoff: null,
      discountAmount: null,
      approvalRequirement: 'UNKNOWN_REQUIRES_REVIEW',
    });
    const visible = await http(path(id, 'early-payoff-quote'), full).expect(200);
    expect(visible.body.approvalRequirement).toBe(
      sellingPrice >= 12000 ? 'NONE' : 'OWNER_APPROVAL_REQUIRED',
    );
  },
);
it('deleted payment/schedule and actual partial/paid/advance/fee amounts retain canonical semantics', async () => {
  const id = await contract();
  await db.contract.update({
    where: { id },
    data: { creditBalance: 50, advanceBalance: 200, rescheduleAdvanceBalance: 100 },
  });
  const rows = await db.payment.findMany({
    where: { contractId: id },
    orderBy: { installmentNo: 'asc' },
  });
  await db.payment.update({
    where: { id: rows[0].id },
    data: { status: 'PAID', amountPaid: 1200 },
  });
  await db.payment.update({
    where: { id: rows[1].id },
    data: { status: 'PARTIALLY_PAID', amountPaid: 150, lateFee: 80 },
  });
  await db.payment.update({
    where: { id: rows[2].id },
    data: { deletedAt: new Date(), amountPaid: 9999, lateFee: 9999 },
  });
  await db.installmentSchedule.updateMany({
    where: { contractId: id, installmentNo: 3 },
    data: { deletedAt: new Date() },
  });
  const response = await http(path(id, 'early-payoff-quote?discountPct=0')).expect(200);
  expect(response.body).toMatchObject({
    remainingMonths: 8,
    totalRemaining: 9600,
    advancePayment: 200,
    rescheduleAdvanceApplied: 100,
    advanceBalanceApplied: 200,
    remainingBalance: 9100,
    unpaidLateFees: 80,
    totalPayoff: 9180,
  });
  const schedule = await http(path(id, 'schedule')).expect(200);
  expect(schedule.body.data).toHaveLength(9);
  expect(JSON.stringify(schedule.body)).not.toContain('9999');
});
it.each(['schedule', 'early-payoff-quote'])(
  'deleted/missing/source-company/inactive actor denied for %s',
  async (route) => {
    const id = await contract();
    await db.contract.update({ where: { id }, data: { deletedAt: new Date() } });
    await http(path(id, route), owner).expect(403);
    await http(path(randomUUID(), route), owner).expect(403);
    const finance = await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'FINANCE' } });
    const wrong = await db.branch.create({
      data: { name: 'Wrong FINANCE origin', companyId: finance.id },
    });
    await http(path(await contract(wrong.id), route), owner).expect(403);
    const inactive = await user();
    await grant(inactive, reads);
    await db.user.update({ where: { id: inactive }, data: { isActive: false } });
    await http(path(contractA, route), inactive).expect(403);
  },
);
it('finite errors reject actual ineligible quote without exposing canonical status diagnostic', async () => {
  const id = await contract();
  await db.contract.update({ where: { id }, data: { status: 'COMPLETED' } });
  const response = await http(path(id, 'early-payoff-quote')).expect(400);
  expect(response.body.message).toBe('ไม่สามารถคำนวณรายการนี้ได้');
  expect(JSON.stringify(response.body)).not.toMatch(/ACTIVE|OVERDUE|DEFAULT/);
});
it('unavailable preview performs no journal/CoA or unrelated identity/document reads', async () => {
  queries = [];
  try {
    await http(path(contractA, 'early-payoff-quote'), full).expect(200);
    const sql = queries.join('\n');
    expect(sql).not.toMatch(
      /journal_entries|journal_lines|chart_of_accounts|"customers"|"products"|"signatures"|"contract_documents"|gateway_response|evidence_url/,
    );
  } finally {
    queries = undefined;
  }
});
async function bookReader(branchOnly = false) {
  const reader = await user();
  await grant(reader, reads, 'FINANCE', [branchA]);
  for (const company of ['FINANCE', 'SHOP'])
    await grant(
      reader,
      ['journal.read', ...sensitive],
      company,
      branchOnly ? [branchA] : undefined,
    );
  return reader;
}
async function journal(
  contractId: string,
  companyCode: string,
  metadata?: Prisma.InputJsonValue,
  status: 'POSTED' | 'DRAFT' = 'POSTED',
) {
  const company = await db.companyInfo.findUniqueOrThrow({ where: { companyCode } });
  return db.journalEntry.create({
    data: {
      entryNumber: 'OWNED-' + randomUUID(),
      companyId: company.id,
      entryDate: new Date(),
      description: 'NEVER-JE-NOTES',
      status,
      createdById: owner,
      metadata: metadata ?? { contractId },
      lines: {
        create: [
          { accountCode: '11-2101', debit: 12000 },
          { accountCode: '11-2106', credit: 2000 },
        ],
      },
    },
  });
}
it('both COMPANY book grants expose complete unchanged canonical preview; branch grants do not', async () => {
  const id = await contract();
  await journal(id, 'FINANCE');
  await journal(id, 'SHOP');
  const reader = await bookReader();
  const canonical = await service.getEarlyPayoffQuote(id);
  const response = await http(path(id, 'early-payoff-quote'), reader).expect(200);
  expect(response.body.journalPreview).toEqual(canonical.journalPreview);
  expect(response.body.availability.journal).toBe('VISIBLE_CURRENT');
  const branchReader = await bookReader(true);
  expect(
    (await http(path(id, 'early-payoff-quote'), branchReader).expect(200)).body.journalPreview,
  ).toBeNull();
});
it('missing one book capability uniformly skips books before seeing hidden contributors', async () => {
  const reader = await user();
  await grant(reader, [...reads, ...sensitive, 'journal.read']);
  await grant(reader, ['journal.read', 'sensitive.cost.read'], 'SHOP');
  const id = await contract();
  await journal(id, 'SHOP');
  queries = [];
  try {
    expect(
      (await http(path(id, 'early-payoff-quote'), reader).expect(200)).body.journalPreview,
    ).toBeNull();
    expect(queries.join('\n')).not.toMatch(/journal_entries|journal_lines/);
  } finally {
    queries = undefined;
  }
});
it.each(['contract', 'receipt', '2B'])(
  'actual unsupported %s book contributor denies complete preview',
  async (kind) => {
    const companyCode = 'OTHER-' + randomUUID();
    await db.companyInfo.create({
      data: {
        companyCode,
        nameTh: 'Unproven book',
        taxId: '0000000000000',
        address: 'Owned fixture',
        directorName: 'Owned fixture',
      },
    });
    const id = await contract();
    const schedule = await db.installmentSchedule.findFirstOrThrow({ where: { contractId: id } });
    if (kind !== 'contract')
      await db.payment.updateMany({
        where: { contractId: id, installmentNo: schedule.installmentNo },
        data: { lateFee: 10 },
      });
    const entry = await journal(
      id,
      companyCode,
      kind === 'contract' ? { contractId: id } : { tag: kind, installmentScheduleId: schedule.id },
      kind === 'contract' ? 'POSTED' : 'DRAFT',
    );
    if (kind !== 'contract')
      await db.journalEntry.update({ where: { id: entry.id }, data: { deletedAt: new Date() } });
    const response = await http(path(id, 'early-payoff-quote'), await bookReader()).expect(403);
    expect(JSON.stringify(response.body)).not.toMatch(/OTHER-|NEVER-|companyId/);
    // Ordinary monetary quote cannot discover unsupported hidden book existence.
    await http(path(id, 'early-payoff-quote?discountPct=0')).expect(200);
  },
);
it('posted/deleted/nonparticipating account predicates preserve real canonical book scope', async () => {
  const companyCode = 'OTHER-' + randomUUID();
  await db.companyInfo.create({
    data: {
      companyCode,
      nameTh: 'Unproven book',
      taxId: '0000000000000',
      address: 'Owned fixture',
      directorName: 'Owned fixture',
    },
  });
  const id = await contract();
  await journal(id, companyCode, { contractId: id }, 'DRAFT');
  const deleted = await journal(id, companyCode);
  await db.journalEntry.update({ where: { id: deleted.id }, data: { deletedAt: new Date() } });
  const unrelatedAccount = await journal(id, companyCode);
  await db.journalLine.updateMany({
    where: { journalEntryId: unrelatedAccount.id },
    data: { accountCode: '99-UNRELATED' },
  });
  await http(path(id, 'early-payoff-quote'), await bookReader()).expect(200);
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
it.each(['schedule', 'early-payoff-quote'])(
  'rechecks source after observed Contract lock wait for %s',
  async (route) => {
    const id = await contract();
    const result = await observedLockWait(
      (tx) => tx.$queryRaw`SELECT id FROM contracts WHERE id=${id} FOR UPDATE`,
      () => http(path(id, route)).then((r) => r),
      (tx) => tx.contract.update({ where: { id }, data: { branchId: branchB } }),
    );
    expect(result.status).toBe(403);
  },
);
it('rechecks paid money after observed Payment lock wait in the owned transaction', async () => {
  const id = await contract();
  const payment = await db.payment.findFirstOrThrow({ where: { contractId: id } });
  const result = await observedLockWait(
    (tx) => tx.$queryRaw`SELECT id FROM payments WHERE id=${payment.id} FOR UPDATE`,
    () => http(path(id, 'early-payoff-quote?discountPct=0')).then((r) => r),
    (tx) =>
      tx.payment.update({ where: { id: payment.id }, data: { status: 'PAID', amountPaid: 1200 } }),
  );
  expect(result.status).toBe(200);
  expect(result.body).toMatchObject({ remainingMonths: 9, totalPayoff: 10800 });
});
it('rechecks sensitive grant retirement after observed current position lock wait', async () => {
  const reader = await user();
  await grant(reader, reads, 'FINANCE', [branchA]);
  const assignment = await grant(reader, sensitive, 'FINANCE', [branchA]);
  const result = await observedLockWait(
    (tx) =>
      tx.$queryRaw`SELECT id FROM access_positions WHERE id=${assignment.positionId} FOR UPDATE`,
    () => http(path(contractA, 'early-payoff-quote'), reader).then((r) => r),
    (tx) =>
      tx.accessPosition.update({ where: { id: assignment.positionId }, data: { permissions: [] } }),
  );
  expect(result.status).toBe(200);
  expect(result.body.grossProfit).toBeNull();
  expect(result.body.totalPayoff).toBeNull();
});
it('rechecks actual journal contributor company after observed book row lock wait', async () => {
  const companyCode = 'OTHER-' + randomUUID();
  const other = await db.companyInfo.create({
    data: {
      companyCode,
      nameTh: 'Unproven book',
      taxId: '0000000000000',
      address: 'Owned fixture',
      directorName: 'Owned fixture',
    },
  });
  const id = await contract();
  const entry = await journal(id, 'FINANCE');
  const reader = await bookReader();
  const result = await observedLockWait(
    (tx) => tx.$queryRaw`SELECT id FROM journal_entries WHERE id=${entry.id} FOR UPDATE`,
    () => http(path(id, 'early-payoff-quote'), reader).then((r) => r),
    (tx) => tx.journalEntry.update({ where: { id: entry.id }, data: { companyId: other.id } }),
  );
  expect(result.status).toBe(403);
});
it('safe HTTP audit contains route metadata only for success and denial', async () => {
  audit.log.mockClear();
  await http(path(contractA, 'early-payoff-quote?depositAccountCode=NEVER-QUERY-SECRET')).expect(
    200,
  );
  await http(path(contractB, 'schedule')).expect(403);
  const calls = audit.log.mock.calls.map((call) => call[0]);
  expect(calls.map((call) => call.action)).toEqual(['GET', 'GET_ERROR']);
  expect(JSON.stringify(calls)).not.toContain('NEVER-QUERY-SECRET');
  expect(calls.every((call) => call.ipAddress === undefined && call.userAgent === undefined)).toBe(
    true,
  );
});
it('legacy unmanaged caller remains outside the managed staff projection', async () => {
  const reader = await user();
  await db.user.update({ where: { id: reader }, data: { accessManaged: false } });
  const response = await http(path(contractA, 'early-payoff-quote'), reader).expect(200);
  expect(response.body.grossProfit).toBe(2000);
  expect(response.body.availability).toBeUndefined();
});

it('current Contract assignment cannot be substituted by salesperson attribution', async () => {
  const id = await contract(branchA, assigned);
  await http(path(id, 'schedule'), assigned).expect(200);
  await db.contract.update({
    where: { id },
    data: { assignedToId: null, salespersonId: assigned },
  });
  await http(path(id, 'schedule'), assigned).expect(403);
  await http(path(id, 'early-payoff-quote'), assigned).expect(403);
});
it('COMPANY finance read remains useful across real SHOP origins', async () => {
  const reader = await user();
  await grant(reader, reads);
  await http(path(contractB, 'schedule'), reader).expect(200);
  await http(path(contractB, 'early-payoff-quote?discountPct=0'), reader).expect(200);
});
it('inactive origin and inactive FINANCE company fail current source proof', async () => {
  const shop = await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'SHOP' } });
  const branch = await db.branch.create({
    data: { name: 'Inactive origin', companyId: shop.id, isActive: false },
  });
  const id = await contract(branch.id);
  await http(path(id, 'schedule'), owner).expect(403);
  const finance = await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'FINANCE' } });
  await db.companyInfo.update({ where: { id: finance.id }, data: { isActive: false } });
  try {
    await http(path(contractA, 'early-payoff-quote'), owner).expect(403);
  } finally {
    await db.companyInfo.update({ where: { id: finance.id }, data: { isActive: true } });
  }
});
it('empty authorized schedule reports proven empty data; all paid quote fails generically', async () => {
  const id = await contract();
  await db.payment.updateMany({ where: { contractId: id }, data: { deletedAt: new Date() } });
  const response = await http(path(id, 'schedule')).expect(200);
  expect(response.body).toEqual({ data: [], availability: { payments: 'VISIBLE_CURRENT' } });
  const paid = await contract();
  await db.payment.updateMany({ where: { contractId: paid }, data: { status: 'PAID' } });
  expect((await http(path(paid, 'early-payoff-quote')).expect(400)).body.message).toBe(
    'ไม่สามารถคำนวณรายการนี้ได้',
  );
});
it('internal skip option cannot be client-selected and scalar query rules remain explicit', async () => {
  await http(path(contractA, 'early-payoff-quote?skipJournalPreview=true')).expect(400);
  await http(path(contractA, 'early-payoff-quote?discountPct=0&discountPct=50')).expect(400);
  expect(
    (await http(path(contractA, 'early-payoff-quote?discountPct=NaN'), full).expect(200)).body
      .discountPct,
  ).toBe(50);
  expect(
    (await http(path(contractA, 'early-payoff-quote?discountPct=-10')).expect(200)).body,
  ).toMatchObject({ discountPct: 0, totalPayoff: 12000 });
});
it('SHOP collected flag preserves canonical deposit dimension without changing the formula', async () => {
  const response = await http(
    path(contractA, 'early-payoff-quote?collectedByShop=true'),
    owner,
  ).expect(200);
  expect(response.body.totalPayoff).toBe(11000);
  expect(
    response.body.journalPreview.lines.some(
      (line: { accountCode: string }) => line.accountCode === '11-2107',
    ),
  ).toBe(true);
});
