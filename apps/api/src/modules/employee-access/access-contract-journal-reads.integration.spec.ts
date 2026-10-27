import { AccessContractJournalBoundary } from './access-contract-journal-boundary';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  journalScheduleFixtures,
  journalExchangeFixtures,
  journalTradeCreditFixture,
  journalReturnFixtures,
  journalInputVatFixture,
  journalWriteoffFixture,
  journalPayoffFixture,
  journalDirectFixtures,
  journalHistoryFixtures,
  journalAccrualHistoryFixtures,
  journalCashFixtures,
  journalCancellationEclFixture,
  journalExchangeRecallFixture,
  journalClearedExchangeHistoryFixture,
} from './access-contract-journal-fixtures';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { AuditService } from '../audit/audit.service';
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
import { ContractActivation1ATemplate } from '../journal/cpa-templates/contract-activation-1a.template';
import { ShopDownPaymentTemplate } from '../journal/cpa-templates/shop-down-payment.template';
import { CompanyResolverService } from '../journal/company-resolver.service';
import { EclStageReverseTemplate } from '../journal/cpa-templates/ecl-stage-reverse.template';

const url = process.env.EMPLOYEE_ACCESS_TEST_DATABASE_URL;
if (
  !url?.includes('/bc_access_contract_journal_reads?host=/tmp/bc-access-contract-journal-reads.') ||
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
let financeEntry: string;
let shopEntry: string;
let fullFinance: string;
let fullShop: string;
let fullBoth: string;
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
    .expect('x-owned-contract-journal-read-app', marker);
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
      AccessContractJournalBoundary,
      ContractJournalQueryService,
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
        ContractPaymentService,
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

  app = module.createNestApplication();
  app.use((_req: unknown, res: { setHeader: (k: string, v: string) => void }, next: () => void) => {
    res.setHeader('x-owned-contract-journal-read-app', marker);
    next();
  });
  await app.listen(0, '127.0.0.1');
  fullFinance = await user();
  fullShop = await user();
  fullBoth = await user();
  await grant(fullBoth, ['contracts.read', 'journal.read', ...sensitive], 'FINANCE');
  await grant(fullBoth, ['journal.read', ...sensitive], 'SHOP');
  await grant(fullFinance, ['contracts.read'], 'FINANCE', [branchA]);
  await grant(fullFinance, ['journal.read', ...sensitive]);
  await grant(fullShop, ['contracts.read'], 'FINANCE', [branchA]);
  await grant(fullShop, ['journal.read', ...sensitive], 'SHOP');
  const codes = new Set<string>();
  for (const book of ['finance', 'shop']) {
    const csv = readFileSync(
      join(__dirname, '../journal/__tests__/fixtures/cpa-cases', `${book}-coa.csv`),
      'utf8',
    );
    for (const match of csv.matchAll(/^(S?\d{2}-\d{4}),/gm)) codes.add(match[1]);
  }
  for (const code of codes) {
    await db.chartOfAccount.upsert({
      where: { code },
      update: {},
      create: { code, name: code, type: 'ASSET', normalBalance: 'Dr' },
    });
  }
  await db.user.update({ where: { id: owner }, data: { email: 'admin@bestchoice.com' } });
  const journal = new JournalAutoService(db as PrismaService);
  const activation = await new ContractActivation1ATemplate(journal, db as PrismaService).execute(
    contractA,
  );
  financeEntry = (
    await db.journalEntry.findUniqueOrThrow({ where: { entryNumber: activation.entryNumber } })
  ).id;
  shopEntry = (
    await new ShopDownPaymentTemplate(
      journal,
      db as PrismaService,
      new CompanyResolverService(db as PrismaService),
    ).execute({
      idempotencyKey: `down-${contractA}`,
      contractId: contractA,
      cashAccountCode: 'S11-1101',
      downAmount: new Prisma.Decimal(2000),
    })
  ).journalEntryId;
  console.log(
    JSON.stringify({
      ownedCluster: url,
      financeDatabase: process.env.DATABASE_URL_FINANCE,
      appMarker: marker,
      source: 'canonical ContractActivation1ATemplate + ShopDownPaymentTemplate',
      financeEntry,
      shopEntry,
      address: app.getHttpServer().address(),
    }),
  );
}, 60000);
afterAll(async () => {
  await app?.close();
  await db.$disconnect();
});

it('unmanaged owner control retains canonical formatter and both actual books', async () => {
  await db.user.update({ where: { id: owner }, data: { accessManaged: false } });
  const response = await http(path(contractA, 'journal-entries'), owner).expect(200);
  expect(response.body.map((e: { id: string }) => e.id)).toEqual(
    expect.arrayContaining([financeEntry, shopEntry]),
  );
  expect(response.body[0].totalDebit).toMatch(/^\d+\.\d{2}$/);
});
it('FINANCE-only journal authority reveals FINANCE independently and withholds SHOP', async () => {
  const response = await http(path(contractA, 'journal-entries'), fullFinance).expect(200);
  expect(response.body.data.map((e: { id: string }) => e.id)).toEqual([financeEntry]);
  expect(response.body.availability).toEqual({ FINANCE: 'VISIBLE_CURRENT', SHOP: 'UNAVAILABLE' });
});
it('SHOP-only journal authority reveals SHOP while ordinary Contract remains FINANCE', async () => {
  const response = await http(path(contractA, 'journal-entries'), fullShop).expect(200);
  expect(response.body.data.map((e: { id: string }) => e.id)).toEqual([shopEntry]);
});
it('branch-scoped journal grant is not company authority for branchless books', async () => {
  const response = await http(path(contractA, 'journal-entries')).expect(200);
  expect(response.body.data).toEqual([]);
});
it('current parent scope and selected work deny cross-branch and SHOP selector', async () => {
  await http(path(contractB, 'journal-entries'), fullFinance).expect(403);
  await http(path(contractA, 'journal-entries'), fullFinance, 'SHOP').expect(403);
});

it('all canonical schedule, ECL, VAT60, refund-reversal and SHOP producer variants remain readable', async () => {
  const id = await contract();
  const entries = await journalScheduleFixtures(db, id);
  expect(entries.length).toBeGreaterThanOrEqual(14);
  const result = await http(path(id, 'journal-entries'), fullBoth).expect(200);
  expect(result.body.data.map((entry: { id: string }) => entry.id).sort()).toEqual(
    entries.map((entry) => entry.id).sort(),
  );
  const canonical = await new ContractJournalQueryService(db as PrismaService).listForContract(id);
  for (const row of result.body.data) {
    const original = canonical.find((entry) => entry.id === row.id)!;
    expect(row.totalDebit).toBe(original.totalDebit);
    expect(row.totalCredit).toBe(original.totalCredit);
    expect(row.deltaApplied).toBe(original.deltaApplied);
    expect(row.lateFeePortion).toBe(original.lateFeePortion);
    expect(
      row.lines
        .map(
          (line: { accountCode: string; debit: string; credit: string }) =>
            `${line.accountCode}:${line.debit}:${line.credit}`,
        )
        .sort(),
    ).toEqual(
      original.lines.map((line) => `${line.accountCode}:${line.debit}:${line.credit}`).sort(),
    );
    expect(row.lines.every((line: { description: string }) => line.description === '')).toBe(true);
  }
});

it('poisoned family/reference/book and arbitrary narratives cannot become authorized rows', async () => {
  const id = await contract();
  const journal = new JournalAutoService(db as PrismaService);
  await new ContractActivation1ATemplate(journal, db as PrismaService).execute(id);
  const entry = await db.journalEntry.findFirstOrThrow({
    where: { referenceId: id, referenceType: 'AUTO' },
  });
  await db.journalEntry.update({
    where: { id: entry.id },
    data: { description: 'PRIVATE UNRELATED NARRATIVE' },
  });
  const visible = await http(path(id, 'journal-entries'), fullFinance).expect(200);
  expect(visible.text).not.toContain('PRIVATE UNRELATED NARRATIVE');
  expect(visible.body.scope).toBe('AUTHORIZED_PROVEN_SOURCES');
  await db.journalEntry.update({ where: { id: entry.id }, data: { referenceId: contractB } });
  const poisoned = await http(path(id, 'journal-entries'), fullFinance).expect(200);
  expect(poisoned.body.data).toEqual([]);
  expect(poisoned.body.availability).toEqual(visible.body.availability);
  const shop = await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'SHOP' } });
  await db.journalEntry.update({
    where: { id: entry.id },
    data: { referenceId: id, companyId: shop.id },
  });
  expect((await http(path(id, 'journal-entries'), fullBoth).expect(200)).body.data).toEqual([]);
});
it('unknown source metadata cannot grant authority or change availability', async () => {
  const id = await contract();
  const journal = new JournalAutoService(db as PrismaService);
  const before = await http(path(id, 'journal-entries'), fullFinance).expect(200);
  await journal.createAndPost({
    description: 'PRIVATE',
    reference: randomUUID(),
    metadata: { contractId: id, flow: 'invented' },
    lines: [
      { accountCode: '11-1201', dr: new Prisma.Decimal(1), cr: new Prisma.Decimal(0) },
      { accountCode: '11-2101', dr: new Prisma.Decimal(0), cr: new Prisma.Decimal(1) },
    ],
  });
  const after = await http(path(id, 'journal-entries'), fullFinance).expect(200);
  expect(after.body).toEqual(before.body);
});

it('reference-less exchange, exact request backlinks and same-book sweep history are retained', async () => {
  const oldId = await contract(),
    newId = await contract();
  const fixture = await journalExchangeFixtures(db, oldId, newId, owner);
  const old = await http(path(oldId, 'journal-entries'), fullBoth).expect(200);
  expect(old.body.data.map((e: { id: string }) => e.id)).toEqual(
    expect.arrayContaining(fixture.oldEntries),
  );
  const next = await http(path(newId, 'journal-entries'), fullBoth).expect(200);
  expect(next.body.data.map((e: { id: string }) => e.id).sort()).toEqual(fixture.newEntries.sort());
  await db.contractExchangeRequest.update({
    where: { id: fixture.request.id },
    data: { je2Id: null },
  });
  const poisoned = await http(path(oldId, 'journal-entries'), fullBoth).expect(200);
  expect(poisoned.body.data.map((e: { id: string }) => e.id)).not.toContain(fixture.oldEntries[0]);
  await db.contractExchangeRequest.update({
    where: { id: fixture.request.id },
    data: { je2Id: fixture.oldEntries[0] },
  });
  await db.contract.update({ where: { id: newId }, data: { branchId: branchB } });
  const branchReader = await user();
  await grant(branchReader, ['contracts.read'], 'FINANCE', [branchA]);
  await grant(branchReader, ['journal.read', ...sensitive], 'FINANCE');
  await grant(branchReader, ['journal.read', ...sensitive], 'SHOP');
  const inaccessibleContributor = (
    await http(path(oldId, 'journal-entries'), branchReader).expect(200)
  ).body.data;
  for (const entryId of fixture.oldEntries)
    expect(inaccessibleContributor.map((entry: { id: string }) => entry.id)).not.toContain(entryId);
});
it('trade-credit application and actual release retain historical redemption identity', async () => {
  const id = await contract();
  const redemption = await journalTradeCreditFixture(db, id, owner);
  const response = await http(path(id, 'journal-entries'), fullBoth).expect(200);
  expect(response.body.data).toHaveLength(2);
  expect(response.body.data.map((e: { id: string }) => e.id)).toContain(
    redemption.applicationJournalEntryId,
  );
  await db.tradeInCreditRedemption.update({
    where: { id: redemption.id },
    data: { applicationJournalEntryId: null },
  });
  const poisoned = await http(path(id, 'journal-entries'), fullBoth).expect(200);
  expect(poisoned.body.data).toEqual([]);
});

it('JP5/refund/SCS and true SHOP intake branch use actual typed source while FINANCE remains central', async () => {
  const id = await contract();
  const fixture = await journalReturnFixtures(db, id, owner);
  const branchReader = await user();
  await grant(branchReader, ['contracts.read'], 'FINANCE', [branchA]);
  await grant(branchReader, ['journal.read', ...sensitive], 'SHOP', [branchA]);
  const response = await http(path(id, 'journal-entries'), branchReader).expect(200);
  expect(response.body.data.map((e: { id: string }) => e.id)).toEqual([fixture.intake.id]);
  const fullResponse = await http(path(id, 'journal-entries'), fullFinance).expect(200);
  expect(fullResponse.body.data.map((e: { flow: string }) => e.flow)).toEqual(
    expect.arrayContaining([
      'repossession',
      'refund-payout',
      'refund-waive',
      'shop-collect-settlement',
    ]),
  );
  await db.deviceReturn.update({
    where: { id: fixture.device.id },
    data: { receivingBranchId: branchB },
  });
  const moved = await http(path(id, 'journal-entries'), branchReader).expect(200);
  expect(moved.body.data).toEqual([]);
});
it('input VAT exact backlink and live tax source survive legitimate REVERSED status but deny poisoned receiving', async () => {
  const id = await contract();
  const fixture = await journalInputVatFixture(db, id, owner);
  const response = await http(path(id, 'journal-entries'), fullFinance).expect(200);
  expect(response.body.data).toHaveLength(1);
  await db.contract.update({ where: { id }, data: { inputVatStatus: 'REVERSED' } });
  expect((await http(path(id, 'journal-entries'), fullFinance).expect(200)).body.data).toHaveLength(
    1,
  );
  await db.goodsReceiving.update({
    where: { id: fixture.receiving.id },
    data: { deletedAt: new Date() },
  });
  expect((await http(path(id, 'journal-entries'), fullFinance).expect(200)).body.data).toEqual([]);
});
it('canonical writeoff and JP4 remain readable without invented universal receipt/CN backlinks', async () => {
  const writeoffId = await contract(),
    payoffId = await contract();
  await journalWriteoffFixture(db, writeoffId, owner);
  await journalPayoffFixture(db, payoffId);
  expect(
    (await http(path(writeoffId, 'journal-entries'), fullFinance).expect(200)).body.data.map(
      (e: { flow: string }) => e.flow,
    ),
  ).toContain('write-off');
  expect(
    (await http(path(payoffId, 'journal-entries'), fullFinance).expect(200)).body.data.map(
      (e: { flow: string }) => e.flow,
    ),
  ).toContain('early-payoff');
});

test('all three actual direct producers prove typed sources and suppress unauthorized Payment navigation', async () => {
  const over = await contract(),
    reschedule = await contract(),
    surplus = await contract();
  const { link } = await journalDirectFixtures(db, over, reschedule, surplus, owner);
  for (const [id, tag] of [
    [over, 'overpayment-credit'],
    [reschedule, 'reschedule-collect'],
    [surplus, 'paysolutions-surplus-advance'],
  ]) {
    const result = await http(path(id, 'journal-entries'), fullFinance).expect(200);
    expect(result.body.data.some((r: { tag: string }) => r.tag === tag)).toBe(true);
  }
  const entry = await db.journalEntry.findFirstOrThrow({
    where: { metadata: { path: ['contractId'], equals: over } },
  });
  const original = entry.metadata as Prisma.JsonObject;
  await db.journalEntry.update({
    where: { id: entry.id },
    data: { metadata: { ...original, paymentId: contractB } },
  });
  expect((await http(path(over, 'journal-entries'), fullFinance).expect(200)).body.data).toEqual(
    [],
  );
  // Documented no-allocation sentinel compatibility. The current service loop
  // always pushes a Payment, so this is deliberately not called a producer path.
  await db.journalEntry.update({
    where: { id: entry.id },
    data: { metadata: { ...original, paymentId: over } },
  });
  const sentinel = (await http(path(over, 'journal-entries'), fullFinance).expect(200)).body.data;
  expect(sentinel).toHaveLength(1);
  expect(sentinel[0].paymentId).toBeNull();
  await db.paymentLink.update({ where: { id: link.id }, data: { contractId: contractB } });
  expect((await http(path(surplus, 'journal-entries'), fullFinance).expect(200)).body.data).toEqual(
    [],
  );
  const payment = await db.payment.findFirstOrThrow({
    where: { contractId: reschedule, installmentNo: 1 },
  });
  await db.payment.update({ where: { id: payment.id }, data: { deletedAt: new Date() } });
  expect(
    (await http(path(reschedule, 'journal-entries'), fullFinance).expect(200)).body.data,
  ).toEqual([]);
});

test('accrual advance/park, completed entryNumber history, re-accrual and ordinary receipt void remain readable', async () => {
  const id = await contract();
  const schedules = await journalAccrualHistoryFixtures(db, id);
  const entries = await db.journalEntry.findMany({
    where: { metadata: { path: ['contractId'], equals: id } },
  });
  const result = await http(path(id, 'journal-entries'), fullFinance).expect(200);
  expect(result.body.data.map((r: { id: string }) => r.id).sort()).toEqual(
    entries.map((r) => r.id).sort(),
  );
  expect(entries.some((e) => e.referenceId?.includes(':re-accrual:'))).toBe(true);
  expect(result.body.data.filter((r: { tag: string }) => r.tag === '2B')).toHaveLength(2);
  await db.installmentSchedule.update({
    where: { id: schedules[1].id },
    data: { contractId: contractB, installmentNo: 99 },
  });
  const poisoned = await http(path(id, 'journal-entries'), fullFinance).expect(200);
  expect(poisoned.body.data.length).toBeLessThan(result.body.data.length);
});
test('defect source audit and independently readable new Contract prove same-book reversal', async () => {
  const id = await contract(),
    next = await contract();
  const audit = await journalHistoryFixtures(db, id, next, owner);
  expect((await http(path(id, 'journal-entries'), fullFinance).expect(200)).body.data).toHaveLength(
    2,
  );
  await db.auditLog.update({
    where: { id: audit.id },
    data: {
      newValue: {
        oldContractId: id,
        newContractId: next,
        oldProductId: 'wrong',
        newProductId: 'wrong',
      },
    },
  });
  const poisoned = (await http(path(id, 'journal-entries'), fullFinance).expect(200)).body.data;
  expect(poisoned).toHaveLength(1);
  expect(poisoned[0].reversed).toBe(false);
});
test('canonical cancellation and all three SHOP cash settlement families preserve genuine opposite-book pairing', async () => {
  const id = await contract(),
    deviceId = await contract(),
    legacyId = await contract();
  await journalReturnFixtures(db, deviceId, owner, false);
  const sources = await journalCashFixtures(db, id, deviceId, legacyId, owner);
  for (const [contractId, flow] of [
    [id, 'interco-recall-cash-shop'],
    [deviceId, 'interco-device-return-cash-shop'],
    [legacyId, 'shop-collect-settlement-shop'],
  ]) {
    const rows = (await http(path(contractId, 'journal-entries'), fullShop).expect(200)).body.data;
    expect(rows.some((r: { flow: string }) => r.flow === flow)).toBe(true);
    expect(rows.every((r: { companyCode: string }) => r.companyCode === 'SHOP')).toBe(true);
  }
  const original = (await http(path(id, 'journal-entries'), fullFinance).expect(200)).body.data;
  expect(original.some((r: { flow: string }) => r.flow === 'contract-cancellation')).toBe(true);
  await db.contractCancellation.update({
    where: { id: sources.cancellation.id },
    data: { status: 'REJECTED' },
  });
  const poisoned = (await http(path(id, 'journal-entries'), fullShop).expect(200)).body.data;
  expect(
    poisoned.some(
      (r: { flow: string }) =>
        r.flow === 'interco-recall-cash-shop' || r.flow === 'contract-cancellation',
    ),
  ).toBe(false);
});

async function measureRead(id: string, expected: number) {
  queries = [];
  const start = Date.now();
  const response = await http(path(id, 'journal-entries'), fullFinance).expect(expected);
  const metric = {
    status: response.status,
    elapsedMs: Date.now() - start,
    queries: queries.length,
    bytes: Buffer.byteLength(response.text),
    entries: response.body.data?.length,
  };
  queries = undefined;
  console.log('JOURNAL_BOUND_METRIC', JSON.stringify(metric));
  return response;
}

test('exact 2000 candidates / 8000 lines, overflow, recovery and contending reads are bounded', async () => {
  const id = await contract();
  const finance = await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'FINANCE' } });
  const ids = Array.from({ length: 2001 }, () => randomUUID());
  const entryRows = ids.map((entryId, i) => {
    const day = new Date(Date.UTC(2020, 0, 1 + i)).toISOString().slice(0, 10);
    return {
      id: entryId,
      entryNumber: 'SCALE-' + entryId,
      entryDate: new Date(),
      postedAt: new Date(),
      status: 'POSTED' as const,
      companyId: finance.id,
      description: 'Synthetic scale fixture',
      createdById: owner,
      referenceType: 'AUTO',
      referenceId: `${id}:bad-debt-provision:${day}`,
      metadata: {
        contractId: id,
        tag: 'BAD-DEBT',
        flow: 'provision',
        runDate: day,
        direction: 'increase',
        idempotencyKey: `${id}:${day}`,
      },
      deletedAt: i === 2000 ? new Date() : null,
    };
  });
  // Scale-only equivalent balanced rows. Canonical producer positives are
  // tested separately; this setup does not claim 2000 producer executions.
  await db.journalEntry.createMany({ data: entryRows });
  await db.journalLine.createMany({
    data: ids.slice(0, 2000).flatMap((journalEntryId) =>
      [0, 1, 2, 3].map((i) => ({
        journalEntryId,
        accountCode: i % 2 ? '11-2102' : '51-1103',
        debit: i % 2 ? 0 : 100,
        credit: i % 2 ? 100 : 0,
      })),
    ),
  });
  expect((await measureRead(id, 200)).body.data).toHaveLength(2000);
  await db.journalEntry.update({ where: { id: ids[2000] }, data: { deletedAt: null } });
  expect((await measureRead(id, 400)).body.data).toBeUndefined();
  await db.journalEntry.update({ where: { id: ids[2000] }, data: { deletedAt: new Date() } });
  const extraLine = await db.journalLine.create({
    data: { journalEntryId: ids[0], accountCode: '51-1103', debit: 0, credit: 0 },
  });
  expect((await measureRead(id, 400)).body.data).toBeUndefined();
  await db.journalLine.update({ where: { id: extraLine.id }, data: { deletedAt: new Date() } });
  expect((await measureRead(id, 200)).body.data).toHaveLength(2000);
  const start = Date.now();
  const concurrent = await Promise.all([
    http(path(id, 'journal-entries'), fullFinance).expect(200),
    http(path(id, 'journal-entries'), fullFinance).expect(200),
  ]);
  console.log(
    'JOURNAL_CONTENDING_METRIC',
    JSON.stringify({
      elapsedMs: Date.now() - start,
      entries: concurrent.map((r) => r.body.data.length),
      bytes: concurrent.map((r) => Buffer.byteLength(r.text)),
    }),
  );
  expect(concurrent.map((r) => r.body.data.length)).toEqual([2000, 2000]);
}, 60000);

test('exact 2000 typed source rows, cap+1 denial and recovery use bounded probes', async () => {
  const id = await contract();
  const finance = await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'FINANCE' } });
  const ids = Array.from({ length: 1999 }, () => randomUUID());
  await db.payment.createMany({
    data: ids.map((paymentId, i) => ({
      id: paymentId,
      contractId: id,
      installmentNo: 100 + i,
      dueDate: new Date(),
      amountDue: 100,
    })),
  });
  await db.journalEntry.createMany({
    data: ids.map((paymentId, i) => ({
      id: paymentId,
      entryNumber: 'TYPED-' + paymentId,
      entryDate: new Date(),
      postedAt: new Date(),
      status: 'POSTED',
      companyId: finance.id,
      description: 'Synthetic scale fixture',
      createdById: owner,
      referenceType: 'AUTO',
      referenceId: randomUUID(),
      metadata: { contractId: id, tag: 'overpayment-credit', paymentId },
      deletedAt: i === 1998 ? new Date() : null,
    })),
  });
  await db.journalLine.createMany({
    data: ids.flatMap((journalEntryId) => [
      { journalEntryId, accountCode: '11-1201', debit: 100, credit: 0 },
      { journalEntryId, accountCode: '21-5101', debit: 0, credit: 100 },
    ]),
  });
  expect((await measureRead(id, 200)).body.data).toHaveLength(1998); // Payments + current Customer + Product = 2000.
  await db.journalEntry.update({ where: { id: ids[1998] }, data: { deletedAt: null } });
  expect((await measureRead(id, 400)).body.data).toBeUndefined();
  await db.journalEntry.update({ where: { id: ids[1998] }, data: { deletedAt: new Date() } });
  expect((await measureRead(id, 200)).body.data).toHaveLength(1998);
}, 60000);

async function withHeldSource(
  table:
    | 'journal_entries'
    | 'payments'
    | 'contracts'
    | 'device_returns'
    | 'contract_cancellations'
    | 'contract_exchange_requests'
    | 'journal_lines',
  sourceId: string,
  contractId: string,
  mutation: (tx: Prisma.TransactionClient) => Promise<unknown>,
  expectedStatus = 200,
  reader = fullFinance,
  whileHeld?: () => Promise<void>,
) {
  let unlock!: () => void, locked!: () => void;
  const held = new Promise<void>((resolve) => {
    locked = resolve;
  });
  const release = new Promise<void>((resolve) => {
    unlock = resolve;
  });
  const writer = db.$transaction(
    async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM ${Prisma.raw(table)} WHERE id=${sourceId} FOR UPDATE`,
      );
      locked();
      await release;
      await mutation(tx);
    },
    { timeout: 10000 },
  );
  await held;
  const start = Date.now();
  const response = http(path(contractId, 'journal-entries'), reader).then((r) => r);
  let waiting = false;
  try {
    for (let n = 0; n < 60; n++) {
      const rows = await db.$queryRaw<
        Array<{ query: string }>
      >`SELECT query FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND pid<>pg_backend_pid()`;
      if (rows.some((r) => r.query.includes(table) && r.query.includes('FOR SHARE'))) {
        waiting = true;
        await whileHeld?.();
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  } finally {
    unlock();
  }
  await writer;
  const result = await response;
  console.log(
    'JOURNAL_SOURCE_WAIT',
    JSON.stringify({
      table,
      waited: waiting,
      elapsedMs: Date.now() - start,
      status: result.status,
      entries: result.body.data?.length,
    }),
  );
  expect(waiting).toBe(true);
  expect(result.status).toBe(expectedStatus);
  return result;
}

test('held JE, typed Payment and ordinary Contract changes retry current source before output', async () => {
  const id = await contract();
  const prisma = db as PrismaService;
  const journal = new JournalAutoService(prisma);
  await new ContractActivation1ATemplate(journal, prisma).execute(id);
  const je = await db.journalEntry.findFirstOrThrow({
    where: { metadata: { path: ['contractId'], equals: id } },
  });
  const changed = await withHeldSource('journal_entries', je.id, id, (tx) =>
    tx.journalEntry.update({ where: { id: je.id }, data: { referenceId: 'poison' } }),
  );
  expect(changed.body.data).toEqual([]);
  const directId = await contract(),
    rescheduleId = await contract(),
    surplusId = await contract();
  await journalDirectFixtures(db, directId, rescheduleId, surplusId, owner);
  const entry = await db.journalEntry.findFirstOrThrow({
    where: { metadata: { path: ['contractId'], equals: directId } },
  });
  const paymentId = (entry.metadata as { paymentId: string }).paymentId;
  expect(
    (
      await withHeldSource('payments', paymentId, directId, (tx) =>
        tx.payment.update({ where: { id: paymentId }, data: { deletedAt: new Date() } }),
      )
    ).body.data,
  ).toEqual([]);
  await withHeldSource(
    'contracts',
    id,
    id,
    (tx) => tx.contract.update({ where: { id }, data: { branchId: branchB } }),
    403,
  );
}, 60000);

test('malformed discriminants cannot masquerade as absent canonical tags or flows', async () => {
  const id = await contract();
  await new ContractActivation1ATemplate(
    new JournalAutoService(db as PrismaService),
    db as PrismaService,
  ).execute(id);
  const entry = await db.journalEntry.findFirstOrThrow({
    where: { metadata: { path: ['contractId'], equals: id } },
  });
  await db.journalEntry.update({
    where: { id: entry.id },
    data: {
      metadata: {
        ...(entry.metadata as Prisma.JsonObject),
        flow: { secret: 'unrecognized producer' },
      },
    },
  });
  expect((await http(path(id, 'journal-entries'), fullFinance).expect(200)).body.data).toEqual([]);
});

test('DEVICE_RETURN settlement requires its genuine originating JP5, not a standalone repository row', async () => {
  const id = await contract();
  await journalReturnFixtures(db, id, owner);
  const before = (await http(path(id, 'journal-entries'), fullFinance).expect(200)).body.data;
  expect(before.some((r: { tag: string }) => r.tag === 'SCS')).toBe(true);
  await db.journalEntry.updateMany({
    where: {
      AND: [
        { metadata: { path: ['contractId'], equals: id } },
        { metadata: { path: ['tag'], equals: 'JP5' } },
      ],
    },
    data: { deletedAt: new Date() },
  });
  const after = (await http(path(id, 'journal-entries'), fullFinance).expect(200)).body.data;
  expect(after.some((r: { tag: string }) => r.tag === 'SCS')).toBe(false);
});

test('held genuine SHOP receiving source changes remove branch authority while unrelated reader completes', async () => {
  const id = await contract();
  const fixture = await journalReturnFixtures(db, id, owner);
  await db.deviceReturn.update({
    where: { id: fixture.device.id },
    data: { receivingBranchId: branchB },
  });
  const before = (await http(path(id, 'journal-entries'), actor).expect(200)).body.data;
  expect(before.map((r: { flow: string }) => r.flow)).toEqual(['shop-repossession-intake']);
  const unrelatedContract = await contract();
  const unrelatedActor = await user();
  await grant(unrelatedActor, ['contracts.read', 'journal.read', ...sensitive], 'FINANCE');
  await new ContractActivation1ATemplate(
    new JournalAutoService(db as PrismaService),
    db as PrismaService,
  ).execute(unrelatedContract);
  let unrelatedResponse: Promise<request.Response> | undefined;
  let unrelatedWaited = false;
  let unrelatedStarted = 0;
  const response = await withHeldSource(
    'device_returns',
    fixture.device.id,
    id,
    (tx) =>
      tx.deviceReturn.update({
        where: { id: fixture.device.id },
        data: { receivingBranchId: branchA },
      }),
    200,
    actor,
    async () => {
      unrelatedStarted = Date.now();
      unrelatedResponse = http(path(unrelatedContract, 'journal-entries'), unrelatedActor).then(
        (r) => r,
      );
      for (let n = 0; n < 60; n++) {
        const waits = await db.$queryRaw<
          Array<{ query: string }>
        >`SELECT query FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND pid<>pg_backend_pid()`;
        if (waits.some((r) => r.query.includes('pg_advisory_xact_lock'))) {
          unrelatedWaited = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    },
  );
  const unrelated = await unrelatedResponse!;
  expect(unrelated.status).toBe(200);
  expect(unrelated.body.data).toHaveLength(1);
  expect(unrelatedWaited).toBe(true);
  console.log(
    'JOURNAL_UNRELATED_CONTENTION',
    JSON.stringify({
      differentActor: true,
      differentContract: true,
      heldSource: 'device_returns',
      waitedOnExistingGlobalAdvisoryLock: unrelatedWaited,
      elapsedMs: Date.now() - unrelatedStarted,
      entries: unrelated.body.data.length,
      bytes: Buffer.byteLength(unrelated.text),
      completedAfterRelease: true,
    }),
  );
  expect(response.body.data).toEqual([]);
  expect((await http(path(id, 'journal-entries'), actor).expect(200)).body.data).toEqual([]);
});

test('each sensitive permission is independent and Payment links need current payments.read', async () => {
  const id = await contract(),
    reschedule = await contract(),
    surplus = await contract();
  await journalDirectFixtures(db, id, reschedule, surplus, owner);
  for (const missing of ['journal.read', ...sensitive]) {
    const staff = await user();
    await grant(
      staff,
      ['contracts.read', 'journal.read', ...sensitive].filter(
        (p) => p !== missing,
      ) as PermissionKey[],
      'FINANCE',
    );
    expect((await http(path(id, 'journal-entries'), staff).expect(200)).body.data).toEqual([]);
  }
  const noLink = (await http(path(id, 'journal-entries'), fullFinance).expect(200)).body.data;
  expect(noLink[0].paymentId).toBeNull();
  const staff = await user();
  await grant(staff, ['contracts.read', 'payments.read', 'journal.read', ...sensitive], 'FINANCE');
  const yesLink = (await http(path(id, 'journal-entries'), staff).expect(200)).body.data;
  expect(yesLink[0].paymentId).toEqual(expect.any(String));
  const payment = await db.payment.findUniqueOrThrow({ where: { id: yesLink[0].paymentId } });
  expect(payment.contractId).toBe(id);
});

test('ordinary denied and ASSIGNED Contract controls remain mandatory before journal authority', async () => {
  await http(path(contractA, 'journal-entries'), denied).expect(403);
  await grant(assigned, ['journal.read', ...sensitive], 'FINANCE');
  await new ContractActivation1ATemplate(
    new JournalAutoService(db as PrismaService),
    db as PrismaService,
  ).execute(assignedCase);
  expect(
    (await http(path(assignedCase, 'journal-entries'), assigned).expect(200)).body.data,
  ).toHaveLength(1);
  await http(path(contractA, 'journal-entries'), assigned).expect(403);
  await db.contract.update({ where: { id: assignedCase }, data: { assignedToId: denied } });
  await http(path(assignedCase, 'journal-entries'), assigned).expect(403);
});

test('availability intersects actual possible same-book authority without disjoint or assigned cross-products', async () => {
  const id = await contract();
  const disjoint = await user();
  await grant(disjoint, ['contracts.read'], 'FINANCE');
  await grant(disjoint, ['journal.read', 'sensitive.cost.read'], 'SHOP', [branchA]);
  await grant(disjoint, ['sensitive.profit.read'], 'SHOP', [branchB]);
  expect(
    (await http(path(id, 'journal-entries'), disjoint).expect(200)).body.availability.SHOP,
  ).toBe('UNAVAILABLE');
  const assignedOnly = await user();
  await grant(assignedOnly, ['contracts.read'], 'FINANCE');
  await grant(assignedOnly, ['journal.read', ...sensitive], 'SHOP', undefined, true);
  expect(
    (await http(path(id, 'journal-entries'), assignedOnly).expect(200)).body.availability.SHOP,
  ).toBe('UNAVAILABLE');
  await grant(disjoint, ['sensitive.profit.read'], 'SHOP', [branchA]);
  expect(
    (await http(path(id, 'journal-entries'), disjoint).expect(200)).body.availability.SHOP,
  ).toBe('VISIBLE_CURRENT');
  const financeBranch = await user();
  await grant(financeBranch, ['contracts.read', 'journal.read', ...sensitive], 'FINANCE', [
    branchA,
  ]);
  expect(
    (await http(path(id, 'journal-entries'), financeBranch).expect(200)).body.availability.FINANCE,
  ).toBe('UNAVAILABLE');
});

test('canonical seller-contact trade identity and schedule-optional direct collect remain supported', async () => {
  const tradeId = await contract();
  const redemption = await journalTradeCreditFixture(db, tradeId, owner, true);
  expect(
    (await http(path(tradeId, 'journal-entries'), fullShop).expect(200)).body.data,
  ).toHaveLength(2);
  const unrelated = await db.contract.findUniqueOrThrow({ where: { id: contractB } });
  await db.tradeIn.update({
    where: { id: redemption.tradeInId },
    data: { customerId: unrelated.customerId },
  });
  expect((await http(path(tradeId, 'journal-entries'), fullShop).expect(200)).body.data).toEqual(
    [],
  );
  const over = await contract(),
    collect = await contract(),
    surplus = await contract();
  await journalDirectFixtures(db, over, collect, surplus, owner, true);
  const rows = (await http(path(collect, 'journal-entries'), fullFinance).expect(200)).body.data;
  expect(rows).toHaveLength(1);
  expect(rows[0].tag).toBe('reschedule-collect');
});

test('fix1 I1 canonical CANCEL-to-CANCEL ECL release requires its live approved cancellation', async () => {
  const id = await contract();
  const { cancellation, release } = await journalCancellationEclFixture(db, id, owner);
  expect(
    (await http(path(id, 'journal-entries'), fullFinance).expect(200)).body.data.map(
      (r: { id: string }) => r.id,
    ),
  ).toContain(release.id);
  await db.contractCancellation.update({
    where: { id: cancellation.id },
    data: { status: 'REJECTED' },
  });
  expect(
    (await http(path(id, 'journal-entries'), fullFinance).expect(200)).body.data.map(
      (r: { id: string }) => r.id,
    ),
  ).not.toContain(release.id);
  await db.contractCancellation.update({
    where: { id: cancellation.id },
    data: { status: 'APPROVED' },
  });
  const waited = await withHeldSource('contract_cancellations', cancellation.id, id, (tx) =>
    tx.contractCancellation.update({
      where: { id: cancellation.id },
      data: { status: 'REJECTED' },
    }),
  );
  expect(waited.body.data.map((row: { id: string }) => row.id)).not.toContain(release.id);
});

test('fix1 I2 actual exchange C2 cancellation settles both recall books without generic cancellation', async () => {
  const oldId = await contract(),
    newId = await contract();
  const fixture = await journalExchangeRecallFixture(db, oldId, newId, owner);
  expect(fixture.entries).toHaveLength(2);
  const books = await db.companyInfo.findMany({
    where: { id: { in: fixture.entries.map((entry) => entry.companyId) } },
    select: { id: true, companyCode: true },
  });
  expect(books.map((book) => book.companyCode).sort()).toEqual(['FINANCE', 'SHOP']);
  for (const [reader, book] of [
    [fullFinance, 'FINANCE'],
    [fullShop, 'SHOP'],
  ]) {
    const own = fixture.entries.find(
      (entry) => books.find((company) => company.id === entry.companyId)?.companyCode === book,
    )!;
    const response = (await http(path(newId, 'journal-entries'), reader).expect(200)).body.data;
    expect(
      response
        .filter((row: { id: string }) => fixture.entries.some((entry) => entry.id === row.id))
        .map((row: { id: string }) => row.id),
    ).toEqual([own.id]);
  }
  const currentRequest = await db.contractExchangeRequest.findUniqueOrThrow({
    where: { id: fixture.requestId },
  });
  expect(await db.contractCancellation.count({ where: { contractId: newId } })).toBe(0);
  const visible = (await http(path(newId, 'journal-entries'), fullBoth).expect(200)).body.data.map(
    (r: { id: string }) => r.id,
  );
  for (const entry of fixture.entries) expect(visible).toContain(entry.id);
  await db.contractExchangeRequest.update({
    where: { id: fixture.requestId },
    data: { reversalJeIds: [] },
  });
  const poisoned = (await http(path(newId, 'journal-entries'), fullBoth).expect(200)).body.data.map(
    (r: { id: string }) => r.id,
  );
  for (const entry of fixture.entries) expect(poisoned).not.toContain(entry.id);
  await db.contractExchangeRequest.update({
    where: { id: fixture.requestId },
    data: { reversalJeIds: currentRequest.reversalJeIds },
  });
  const branchReader = await user();
  await grant(branchReader, ['contracts.read'], 'FINANCE', [branchA]);
  await grant(branchReader, ['journal.read', ...sensitive], 'FINANCE');
  await grant(branchReader, ['journal.read', ...sensitive], 'SHOP');
  const branchVisible = (
    await http(path(newId, 'journal-entries'), branchReader).expect(200)
  ).body.data.map((row: { id: string }) => row.id);
  for (const entry of fixture.entries) expect(branchVisible).toContain(entry.id);
  await db.contract.update({ where: { id: oldId }, data: { branchId: branchB } });
  const inaccessibleOrigin = (
    await http(path(newId, 'journal-entries'), branchReader).expect(200)
  ).body.data.map((row: { id: string }) => row.id);
  for (const entry of fixture.entries) expect(inaccessibleOrigin).not.toContain(entry.id);
  await db.contract.update({ where: { id: oldId }, data: { branchId: branchA } });
  const held = await withHeldSource(
    'contract_exchange_requests',
    fixture.requestId,
    newId,
    (tx) =>
      tx.contractExchangeRequest.update({
        where: { id: fixture.requestId },
        data: { status: 'APPROVED' },
      }),
    200,
    fullBoth,
  );
  for (const entry of fixture.entries)
    expect(held.body.data.map((row: { id: string }) => row.id)).not.toContain(entry.id);
});

test('fix1 I3 cleared 2A history rejects the same invalid idempotency as reversal admission', async () => {
  const id = await contract();
  await journalAccrualHistoryFixtures(db, id);
  const reversal = await db.journalEntry.findFirstOrThrow({
    where: {
      AND: [
        { metadata: { path: ['contractId'], equals: id } },
        { metadata: { path: ['flow'], equals: 'receipt-accrual-void' } },
      ],
    },
  });
  const meta = reversal.metadata as Prisma.JsonObject;
  const before = (await http(path(id, 'journal-entries'), fullFinance).expect(200)).body.data.map(
    (r: { id: string }) => r.id,
  );
  expect(before).toEqual(expect.arrayContaining([reversal.id, meta.originalEntryId]));
  await db.journalEntry.update({
    where: { id: reversal.id },
    data: { metadata: { ...meta, idempotencyKey: 'invalid-pair' } },
  });
  const after = (await http(path(id, 'journal-entries'), fullFinance).expect(200)).body.data.map(
    (r: { id: string }) => r.id,
  );
  expect(after).not.toContain(reversal.id);
  expect(after).not.toContain(meta.originalEntryId);
});

test.each(['unmatched', 'deleted'] as const)(
  'fix1 I4 overlong %s CoA code rejects whole entry and recovers',
  async (kind) => {
    const id = await contract();
    await new ContractActivation1ATemplate(
      new JournalAutoService(db as PrismaService),
      db as PrismaService,
    ).execute(id);
    const entry = await db.journalEntry.findFirstOrThrow({
      where: { metadata: { path: ['contractId'], equals: id } },
      include: { lines: true },
    });
    const before = (await http(path(id, 'journal-entries'), fullFinance).expect(200)).body.data;
    const exact = 'B'.repeat(64);
    await db.journalLine.update({ where: { id: entry.lines[0].id }, data: { accountCode: exact } });
    const supported = (await http(path(id, 'journal-entries'), fullFinance).expect(200)).body.data;
    expect(
      supported[0].lines.some(
        (line: { accountCode: string; accountName: string }) =>
          line.accountCode === exact && line.accountName === exact,
      ),
    ).toBe(true);
    await db.journalLine.update({
      where: { id: entry.lines[0].id },
      data: { accountCode: exact + 'X' },
    });
    expect(
      (await http(path(id, 'journal-entries'), fullFinance).expect(400)).body.data,
    ).toBeUndefined();
    const code = 'OVERLONG-' + randomUUID() + 'X'.repeat(10000);
    if (kind === 'deleted')
      await db.chartOfAccount.create({
        data: {
          code,
          name: 'Deleted owned code',
          type: 'ASSET',
          normalBalance: 'Dr',
          deletedAt: new Date(),
        },
      });
    await db.journalLine.update({ where: { id: entry.lines[0].id }, data: { accountCode: code } });
    const denied = await http(path(id, 'journal-entries'), fullFinance).expect(400);
    expect(denied.body.data).toBeUndefined();
    expect(denied.text).not.toContain('OVERLONG');
    await db.journalLine.update({
      where: { id: entry.lines[0].id },
      data: { accountCode: entry.lines[0].accountCode },
    });
    expect((await http(path(id, 'journal-entries'), fullFinance).expect(200)).body.data).toEqual(
      before,
    );
    const waited = await withHeldSource(
      'journal_lines',
      entry.lines[0].id,
      id,
      (tx) =>
        tx.journalLine.update({
          where: { id: entry.lines[0].id },
          data: { accountCode: exact + 'X' },
        }),
      400,
    );
    expect(waited.body.data).toBeUndefined();
    await db.journalLine.update({
      where: { id: entry.lines[0].id },
      data: { accountCode: entry.lines[0].accountCode },
    });
    expect((await http(path(id, 'journal-entries'), fullFinance).expect(200)).body.data).toEqual(
      before,
    );
  },
);

test.each(['identity', 'authority', 'idempotency'] as const)(
  'fix1 I3 cleared exchange history rejects poisoned %s on both sides',
  async (poison) => {
    const oldId = await contract(),
      newId = await contract();
    const fixture = await journalClearedExchangeHistoryFixture(db, oldId, newId, owner);
    const reader = await user();
    await grant(reader, ['contracts.read'], 'FINANCE', [branchA]);
    await grant(reader, ['journal.read', ...sensitive], 'FINANCE');
    expect(
      (await http(path(oldId, 'journal-entries'), reader).expect(200)).body.data.map(
        (r: { id: string }) => r.id,
      ),
    ).toEqual(expect.arrayContaining([fixture.original.id, fixture.reversalId]));
    if (poison === 'identity') {
      const foreign = await db.contract.findUniqueOrThrow({ where: { id: contractB } });
      await db.contractExchangeRequest.update({
        where: { id: fixture.request.id },
        data: { newProductId: foreign.productId },
      });
    } else if (poison === 'authority') {
      await db.contract.update({ where: { id: newId }, data: { branchId: branchB } });
    } else {
      const reverse = await db.journalEntry.findUniqueOrThrow({
        where: { id: fixture.reversalId },
      });
      await db.journalEntry.update({
        where: { id: reverse.id },
        data: {
          metadata: { ...(reverse.metadata as Prisma.JsonObject), idempotencyKey: 'invalid-sweep' },
        },
      });
    }
    const after = (await http(path(oldId, 'journal-entries'), reader).expect(200)).body.data.map(
      (r: { id: string }) => r.id,
    );
    expect(after).not.toContain(fixture.reversalId);
    expect(after).not.toContain(fixture.original.id);
  },
);
