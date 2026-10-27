import * as postingPeriods from './managed-payoff-execution';
import { AccessShopSettlementBoundary } from '../employee-access/access-shop-settlement-boundary';
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
import * as Sentry from '@sentry/nestjs';
import { Logger } from '@nestjs/common';
import { PermissionKey } from '@installment/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { ContractPaymentService } from './contract-payment.service';
import { ProductsService } from '../products/products.service';
import { JournalAutoService } from '../journal/journal-auto.service';
import { EclStageReverseTemplate } from '../journal/cpa-templates/ecl-stage-reverse.template';
import { EarlyPayoffJP4Template } from '../journal/cpa-templates/early-payoff-jp4.template';
import { ShopCollectSettlementTemplate } from '../journal/cpa-templates/shop-collect-settlement.template';
import { ReceiptsService } from '../receipts/receipts.service';
import { JourneyEntryWriter } from '../customer-journey/journey-entry-writer.service';
import { AccessSnapshotService } from '../employee-access/access-snapshot.service';
import { AccessResourceService } from '../employee-access/access-resource.service';

import { randomUUID } from 'node:crypto';
import { requestedAccessCompany } from '../employee-access/access-shop-boundaries';

jest.mock('@sentry/nestjs', () => ({ captureMessage: jest.fn(), captureException: jest.fn() }));
const url = process.env.SHOP_SETTLEMENT_TEST_DATABASE_URL;
if (
  !url?.includes('/bc_shop_settlement?host=/tmp/bc-shop-settlement.') ||
  process.env.DATABASE_URL !== url ||
  process.env.DATABASE_URL_FINANCE !== url
)
  throw new Error('Both database URLs must identify the owned settlement cluster');
const db = new PrismaClient({ datasources: { db: { url } } });
const prisma = db as PrismaService;
const snapshots = new AccessSnapshotService(prisma);
const journal = new JournalAutoService(prisma);
const template = new ShopCollectSettlementTemplate(journal, prisma);
const service = new ContractPaymentService(
  prisma,
  {} as ProductsService,
  journal,
  {} as EarlyPayoffJP4Template,
  template,
  {} as ReceiptsService,
  {} as EclStageReverseTemplate,
);
let actor: string, legacy: string, finance: string, shop: string, branch: string, denied: string;
const writes: PermissionKey[] = ['contracts.read', 'payments.read', 'payments.create'];
async function person(managed = true, email = randomUUID() + '@test.invalid') {
  return (
    await db.user.create({
      data: {
        name: 'Owned actor',
        email,
        password: 'unused',
        role: 'ACCOUNTANT',
        accessManaged: managed,
      },
    })
  ).id;
}
async function grant(
  userId: string,
  permissions = writes,
  companyCode = 'FINANCE',
  branchIds?: string[],
  scope?: 'ASSIGNED',
) {
  const position = await db.accessPosition.create({
    data: { code: randomUUID(), name: 'Owned position', permissions },
  });
  return db.employeeAccessAssignment.create({
    data: {
      userId,
      positionId: position.id,
      companyCode,
      scope: scope ?? (branchIds ? 'BRANCHES' : 'COMPANY'),
      ...(branchIds ? { branches: { create: branchIds.map((branchId) => ({ branchId })) } } : {}),
    },
  });
}
async function ledger(contractId: string, companyId: string, amount: number, payable = false) {
  return db.journalEntry.create({
    data: {
      entryNumber: 'SOURCE-' + randomUUID(),
      entryDate: new Date(),
      postedAt: new Date(),
      description: 'Owned collection',
      status: 'POSTED',
      createdById: legacy,
      companyId,
      metadata: { contractId, shopReceivableType: 'SHOP_COLLECT' },
      lines: {
        create: payable
          ? [
              { accountCode: 'S11-1202', debit: amount, credit: 0 },
              { accountCode: 'S21-1104', debit: 0, credit: amount },
            ]
          : [
              { accountCode: '11-2107', debit: amount, credit: 0 },
              { accountCode: '11-2101', debit: 0, credit: amount },
            ],
      },
    },
  });
}
async function contract(payable = true) {
  const customer = await db.customer.create({ data: { name: 'Owned payer', phone: '0800000000' } });
  const product = await db.product.create({
    data: {
      name: 'Released device',
      brand: 'Apple',
      model: 'Test',
      category: 'PHONE_NEW',
      costPrice: 9000,
      branchId: branch,
      ownedByCompanyId: null,
      status: 'SOLD_INSTALLMENT',
    },
  });
  const row = await db.contract.create({
    data: {
      contractNumber: 'OWNED-' + randomUUID(),
      customerId: customer.id,
      productId: product.id,
      branchId: branch,
      salespersonId: actor,
      planType: 'STORE_WITH_INTEREST',
      sellingPrice: 12000,
      downPayment: 2000,
      financedAmount: 10000,
      totalMonths: 10,
      monthlyPayment: 1200,
      interestRate: 0.02,
      interestTotal: 2000,
      vatAmount: 0,
      vatPct: 0,
      status: 'COMPLETED',
    },
  });
  await ledger(row.id, finance, 1000);
  if (payable) await ledger(row.id, shop, 1000, true);
  return row;
}
let app: INestApplication;
const marker = randomUUID();
async function http(
  id: string,
  who = actor,
  amount = 400,
  requestId: string | undefined = randomUUID(),
  company = 'FINANCE',
) {
  const response = await request(app.getHttpServer())
    .post(`/contracts/${id}/shop-collect-settlement`)
    .set('x-test-user', who)
    .set('x-company-scope', company)
    .send({ depositAccountCode: '11-1201', amount, ...(requestId ? { requestId } : {}) });
  expect(response.headers['x-owned-settlement-app']).toBe(marker);
  expect(response.headers['x-owned-selected-company']).toBe(company);
  return response;
}
async function postings(id: string) {
  return db.journalEntry.findMany({
    where: {
      AND: [
        { metadata: { path: ['contractId'], equals: id } },
        { metadata: { path: ['flow'], string_starts_with: 'shop-collect-settlement' } },
      ],
    },
    include: { lines: true },
  });
}
beforeAll(async () => {
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  finance = (await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'FINANCE' } })).id;
  shop = (await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'SHOP' } })).id;
  branch = (await db.branch.create({ data: { name: 'Owned origin', companyId: shop } })).id;
  actor = await person();
  legacy = await person(false, 'admin@bestchoice.com');
  denied = await person();
  await grant(actor);
  await grant(actor, ['payments.create'], 'SHOP');
  for (const code of ['11-1201', '11-2101', '11-2107', 'S11-1202', 'S21-1104'])
    await db.chartOfAccount.upsert({
      where: { code },
      update: {},
      create: { code, name: 'Owned ' + code, type: 'สินทรัพย์', normalBalance: 'Dr' },
    });
  const module = await Test.createTestingModule({
    controllers: [ContractsController],
    providers: [
      AccessShopSettlementBoundary,
      AccessResourceService,
      AccessPartySourceService,
      AccessProcurementSourceService,
      AccessPolicyService,
      { provide: PrismaService, useValue: prisma },
      { provide: AccessSnapshotService, useValue: snapshots },
      { provide: ContractPaymentService, useValue: service },
      ...[
        ContractsService,
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
      res.setHeader('x-owned-settlement-app', marker);
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
it('canonical unmanaged HTTP actually posts both books after Product ownership release', async () => {
  const c = await contract();
  expect((await http(c.id, legacy)).status).toBe(201);
  const entries = await postings(c.id);
  expect(entries).toHaveLength(2);
  expect(entries.every((e) => e.createdById === legacy)).toBe(true);
  expect(
    entries
      .find((e) => e.companyId === finance)
      ?.lines.map((l) => [l.accountCode, String(l.debit), String(l.credit)]),
  ).toEqual([
    ['11-1201', '400', '0'],
    ['11-2107', '0', '400'],
  ]);
});
it('managed both-book authority posts genuine paired money with actual actor and required audit', async () => {
  const c = await contract();
  const response = await http(c.id);
  expect(response.status).toBe(201);
  expect(response.body).toEqual({ success: true, contractId: c.id });
  const entries = await postings(c.id);
  expect(entries).toHaveLength(2);
  expect(entries.every((e) => e.createdById === actor)).toBe(true);
  expect(entries[0].postedAt).toEqual(entries[1].postedAt);
  expect(
    await db.auditLog.count({
      where: { entityId: c.id, action: 'SHOP_COLLECT_SETTLED', userId: actor },
    }),
  ).toBe(1);
});
it('independent SHOP authority is required even NO_SHOP_PAYABLE', async () => {
  const who = await person();
  await grant(who);
  const c = await contract(false);
  expect((await http(c.id, who)).status).toBe(403);
  expect(await postings(c.id)).toHaveLength(0);
});
it('managed NO_SHOP_PAYABLE remains useful with both-book authority', async () => {
  const c = await contract(false);
  expect((await http(c.id)).status).toBe(201);
  expect(await postings(c.id)).toHaveLength(1);
});
it('denied and wrong-company HTTP remain no-write controls', async () => {
  const c = await contract();
  expect((await http(c.id, denied)).status).toBe(403);
  expect((await http(c.id, actor, 400, randomUUID(), 'SHOP')).status).toBe(403);
  expect(await postings(c.id)).toHaveLength(0);
});
it.each(['ASSIGNED', 'SHOP_BRANCH', 'OTHER_BRANCH', 'MIXED_TUPLE'] as const)(
  'rejects %s mutation authority without borrowing the Contract branch',
  async (mode) => {
    const who = await person();
    if (mode === 'ASSIGNED') {
      await grant(who, writes, 'FINANCE', undefined, 'ASSIGNED');
      await grant(who, ['payments.create'], 'SHOP');
    }
    if (mode === 'SHOP_BRANCH') {
      await grant(who);
      await grant(who, ['payments.create'], 'SHOP', [branch]);
    }
    const other = (await db.branch.create({ data: { name: 'Other origin', companyId: shop } })).id;
    if (mode === 'OTHER_BRANCH') {
      await grant(who, writes, 'FINANCE', [other]);
      await grant(who, ['payments.create'], 'SHOP');
    }
    if (mode === 'MIXED_TUPLE') {
      await grant(who, ['contracts.read', 'payments.read'], 'FINANCE', [branch]);
      await grant(who, ['payments.create'], 'FINANCE', [other]);
      await grant(who, ['payments.create'], 'SHOP');
    }
    const c = await contract();
    await db.contract.update({ where: { id: c.id }, data: { assignedToId: who } });
    expect((await http(c.id, who)).status).toBe(403);
    expect(await postings(c.id)).toHaveLength(0);
  },
);
it('independent assigned reads plus actual branch mutation authority remain useful', async () => {
  const who = await person();
  await grant(who, ['contracts.read', 'payments.read'], 'FINANCE', undefined, 'ASSIGNED');
  await grant(who, ['payments.create'], 'FINANCE', [branch]);
  await grant(who, ['payments.create'], 'SHOP');
  const c = await contract();
  await db.contract.update({ where: { id: c.id }, data: { assignedToId: who } });
  expect((await http(c.id, who)).status).toBe(201);
});
it('managed owner cannot settle hidden wrong-book source merely from matching Contract metadata', async () => {
  const owner = await person();
  await db.user.update({ where: { id: owner }, data: { role: 'OWNER' } });
  const c = await contract();
  await ledger(c.id, shop, 200);
  expect((await http(c.id, owner)).status).toBe(403);
  expect(await postings(c.id)).toHaveLength(0);
});
it('requestId retry and mismatch preserve exact canonical once-only money', async () => {
  const c = await contract();
  const key = randomUUID();
  expect((await http(c.id, actor, 1000, key)).status).toBe(201);
  expect((await http(c.id, actor, 1000, key)).status).toBe(201);
  expect((await http(c.id, actor, 999, key)).status).toBe(409);
  expect(await postings(c.id)).toHaveLength(2);
});
it('absent requestId retains legacy amount dedupe ordering and intentional distinct IDs', async () => {
  const c = await contract();
  expect((await http(c.id, actor, 200, '')).status).toBe(201);
  expect((await http(c.id, actor, 200, '')).status).toBe(201);
  expect(await postings(c.id)).toHaveLength(2);
  expect((await http(c.id, actor, 200)).status).toBe(201);
  expect(await postings(c.id)).toHaveLength(4);
});
it('canonical outstanding and tolerance preserve no-negative rejection', async () => {
  const c = await contract();
  expect((await http(c.id, actor, 1000.02)).status).toBe(400);
  expect(await postings(c.id)).toHaveLength(0);
  expect((await http(c.id, actor, 1000.01)).status).toBe(201);
  expect((await http(c.id, actor, 1)).status).toBe(400);
});
it('canonical DEVICE_RETURN history guard still blocks ordinary remittance', async () => {
  const c = await contract();
  const source = await ledger(c.id, finance, 100);
  await db.journalEntry.update({
    where: { id: source.id },
    data: { metadata: { contractId: c.id, shopReceivableType: 'DEVICE_RETURN' } },
  });
  expect((await http(c.id)).status).toBe(400);
  expect(await postings(c.id)).toHaveLength(0);
});
it('canonical ordinary outstanding includes deleted lines while typed SHOP payable does not', async () => {
  const c = await contract();
  await db.journalLine.updateMany({
    where: { journalEntry: { metadata: { path: ['contractId'], equals: c.id } } },
    data: { deletedAt: new Date() },
  });
  expect((await http(c.id)).status).toBe(201);
  expect(await postings(c.id)).toHaveLength(1);
});
it('concurrent same requestId commits one paired posting, safe retry, no transient telemetry', async () => {
  const c = await contract();
  const key = randomUUID();
  jest.mocked(Sentry.captureMessage).mockClear();
  const results = await Promise.all([http(c.id, actor, 400, key), http(c.id, actor, 400, key)]);
  expect(results.map((r) => r.status)).toEqual([201, 201]);
  expect(await postings(c.id)).toHaveLength(2);
  expect(Sentry.captureMessage).not.toHaveBeenCalled();
});
it('concurrent distinct remittances cannot over-clear actual receivable or payable', async () => {
  const c = await contract();
  const results = await Promise.all([http(c.id, actor, 700), http(c.id, actor, 700)]);
  expect(results.map((r) => r.status).sort()).toEqual([201, 400]);
  expect(await postings(c.id)).toHaveLength(2);
});
it('required late domain audit failure rolls back both genuine journals', async () => {
  const c = await contract();
  await db.$executeRawUnsafe(
    `CREATE FUNCTION settlement_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='SHOP_COLLECT_SETTLED' THEN RAISE EXCEPTION 'owned required audit failure'; END IF; RETURN NEW; END $$`,
  );
  await db.$executeRawUnsafe(
    `CREATE TRIGGER settlement_audit_failure BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION settlement_audit_failure()`,
  );
  const diagnostic = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  try {
    expect((await http(c.id)).status).toBe(500);
    expect(await postings(c.id)).toHaveLength(0);
    expect(diagnostic).toHaveBeenCalledTimes(1);
    expect(String(diagnostic.mock.calls[0][0])).toContain('owned required audit failure');
  } finally {
    diagnostic.mockRestore();
    await db.$executeRawUnsafe('DROP TRIGGER settlement_audit_failure ON audit_logs');
    await db.$executeRawUnsafe('DROP FUNCTION settlement_audit_failure()');
  }
});

async function deduction(
  contractId: string,
  status: 'POSTED' | 'PENDING_APPROVAL' = 'POSTED',
  column: 'swapCreditAmount' | 'recallAmount' | 'deviceReturnAmount' = 'swapCreditAmount',
) {
  const batch = await db.interCoSettlementBatch.create({
    data: {
      batchNumber: 'OWNED-' + randomUUID(),
      status,
      transferDate: new Date(),
      financeBankCode: '11-1201',
      shopBankCode: 'S11-1202',
      totalFinanced: 200,
      totalCommission: 0,
      totalAmount: 200,
      shopPostedAmount: 200,
      totalDeduction: 200,
      netTransferAmount: 0,
      shopNetAmount: 0,
      makerId: legacy,
      items: {
        create: {
          contractId,
          financedGl: 200,
          commissionGl: 0,
          shopFinancedGl: 200,
          shopCommissionGl: 0,
          itemType:
            column === 'swapCreditAmount'
              ? 'SETTLEMENT'
              : column === 'recallAmount'
                ? 'RECALL'
                : 'DEVICE_RETURN',
          [column]: 200,
        },
      },
    },
  });
  if (status === 'POSTED') {
    const ids: string[] = [];
    for (const [companyId, code, side, counterpart] of [
      [finance, '11-2107', 'credit', '11-2101'],
      [shop, 'S21-1104', 'debit', 'S11-1202'],
    ] as const) {
      const entry = await db.journalEntry.create({
        data: {
          entryNumber: 'BATCH-' + randomUUID(),
          entryDate: new Date(),
          status: 'POSTED',
          postedAt: new Date(),
          companyId,
          createdById: legacy,
          description: 'Owned deduction',
          metadata: { flow: 'interco-settlement-batch', settlementBatchId: batch.id },
          lines: {
            create: [
              {
                accountCode: code,
                debit: side === 'debit' ? 200 : 0,
                credit: side === 'credit' ? 200 : 0,
              },
              {
                accountCode: counterpart,
                debit: side === 'credit' ? 200 : 0,
                credit: side === 'debit' ? 200 : 0,
              },
            ],
          },
        },
      });
      ids.push(entry.id);
    }
    await db.interCoSettlementBatch.update({
      where: { id: batch.id },
      data: { financeJournalEntryId: ids[0], shopJournalEntryId: ids[1] },
    });
  }
  return db.interCoSettlementBatch.findUniqueOrThrow({
    where: { id: batch.id },
    include: { items: true },
  });
}
it.each(['swapCreditAmount', 'recallAmount', 'deviceReturnAmount'] as const)(
  'canonical posted %s deduction reduces available settlement with proven paired source',
  async (column) => {
    const c = await contract();
    await deduction(c.id, 'POSTED', column);
    expect((await http(c.id, actor, 800.02)).status).toBe(400);
    expect((await http(c.id, actor, 800)).status).toBe(201);
    expect((await http(c.id, actor, 1)).status).toBe(400);
  },
);
it('genuine pending deduction reaches canonical pending guard', async () => {
  const c = await contract();
  await deduction(c.id, 'PENDING_APPROVAL');
  const r = await http(c.id);
  expect(r.status).toBe(400);
  expect(r.body.message).toContain('INTER-CO');
  expect(await postings(c.id)).toHaveLength(0);
});
it.each([
  'missing-shop',
  'wrong-book',
  'wrong-batch',
  'draft-je',
  'deleted-je',
  'missing-clearing-line',
  'mixed-column',
] as const)(
  'unsupported interco %s provenance fails generically without dropping money',
  async (mode) => {
    const c = await contract();
    const batch = await deduction(c.id);
    if (mode === 'missing-shop')
      await db.interCoSettlementBatch.update({
        where: { id: batch.id },
        data: { shopJournalEntryId: null },
      });
    if (mode === 'wrong-book')
      await db.journalEntry.update({
        where: { id: batch.financeJournalEntryId! },
        data: { companyId: shop },
      });
    if (mode === 'wrong-batch')
      await db.journalEntry.update({
        where: { id: batch.financeJournalEntryId! },
        data: { metadata: { flow: 'interco-settlement-batch', settlementBatchId: randomUUID() } },
      });
    if (mode === 'draft-je')
      await db.journalEntry.update({
        where: { id: batch.shopJournalEntryId! },
        data: { status: 'DRAFT' },
      });
    if (mode === 'deleted-je')
      await db.journalEntry.update({
        where: { id: batch.shopJournalEntryId! },
        data: { deletedAt: new Date() },
      });
    if (mode === 'missing-clearing-line')
      await db.journalLine.updateMany({
        where: { journalEntryId: batch.shopJournalEntryId!, accountCode: 'S21-1104' },
        data: { deletedAt: new Date() },
      });
    if (mode === 'mixed-column')
      await db.interCoSettlementItem.update({
        where: { id: batch.items[0].id },
        data: { recallAmount: 20 },
      });
    const r = await http(c.id);
    expect(r.status).toBe(403);
    expect(r.body.message).toBe('ไม่มีสิทธิ์ดำเนินการกับข้อมูลนี้');
    expect(await postings(c.id)).toHaveLength(0);
  },
);
it('zero-deduction FINANCE-only legacy batch requires no invented SHOP link', async () => {
  const c = await contract();
  const b = await deduction(c.id);
  await db.interCoSettlementItem.update({
    where: { id: b.items[0].id },
    data: { swapCreditAmount: 0 },
  });
  await db.interCoSettlementBatch.update({
    where: { id: b.id },
    data: { shopJournalEntryId: null },
  });
  expect((await http(c.id, actor, 1000)).status).toBe(201);
});

async function observedWait<T>(
  lock: (tx: Prisma.TransactionClient) => Promise<unknown>,
  work: () => Promise<T>,
  mutate: (tx: Prisma.TransactionClient) => Promise<unknown>,
) {
  let result!: Promise<T>;
  await db.$transaction(
    async (tx) => {
      const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      await lock(tx);
      result = work();
      let waiting = false;
      for (let i = 0; i < 300; i++) {
        await tx.$executeRaw`SELECT pg_stat_clear_snapshot()`;
        const [state] = await tx.$queryRaw<
          { waiting: boolean }[]
        >`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND ${pid}=ANY(pg_blocking_pids(pid))) AS waiting`;
        if (state.waiting) {
          waiting = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      expect(waiting).toBe(true);
      await mutate(tx);
    },
    { timeout: 10000 },
  );
  return result;
}
it('observed grant-row wait rechecks revoked independent SHOP authority', async () => {
  const who = await person();
  await grant(who);
  const g = await grant(who, ['payments.create'], 'SHOP');
  const c = await contract();
  const r = await observedWait(
    (tx) => tx.$queryRaw`SELECT id FROM access_positions WHERE id=${g.positionId} FOR UPDATE`,
    () => http(c.id, who),
    (tx) => tx.accessPosition.update({ where: { id: g.positionId }, data: { permissions: [] } }),
  );
  expect(r.status).toBe(403);
  expect(await postings(c.id)).toHaveLength(0);
});
it('observed Contract-row wait reloads actual branch rather than stale authorized case', async () => {
  const who = await person();
  await grant(who, writes, 'FINANCE', [branch]);
  await grant(who, ['payments.create'], 'SHOP');
  const c = await contract();
  const other = (await db.branch.create({ data: { name: 'Other', companyId: shop } })).id;
  const r = await observedWait(
    (tx) => tx.$queryRaw`SELECT id FROM contracts WHERE id=${c.id} FOR UPDATE`,
    () => http(c.id, who),
    (tx) => tx.contract.update({ where: { id: c.id }, data: { branchId: other } }),
  );
  expect(r.status).toBe(403);
  expect(await postings(c.id)).toHaveLength(0);
});
it('observed source JE wait reloads changed contributor book', async () => {
  const c = await contract();
  const entry = await ledger(c.id, finance, 200);
  const r = await observedWait(
    (tx) => tx.$queryRaw`SELECT id FROM journal_entries WHERE id=${entry.id} FOR UPDATE`,
    () => http(c.id),
    (tx) => tx.journalEntry.update({ where: { id: entry.id }, data: { companyId: shop } }),
  );
  expect(r.status).toBe(403);
  expect(await postings(c.id)).toHaveLength(0);
});
it('observed contributor-line wait recalculates actual outstanding on the retried snapshot', async () => {
  const c = await contract(false);
  const entry = await db.journalEntry.findFirstOrThrow({
    where: { metadata: { path: ['contractId'], equals: c.id } },
    include: { lines: true },
  });
  const line = entry.lines.find((l) => l.accountCode === '11-2107')!;
  const r = await observedWait(
    (tx) => tx.$queryRaw`SELECT id FROM journal_lines WHERE id=${line.id} FOR UPDATE`,
    () => http(c.id, actor, 900),
    (tx) => tx.journalLine.update({ where: { id: line.id }, data: { debit: 800 } }),
  );
  expect(r.status).toBe(400);
  expect(await postings(c.id)).toHaveLength(0);
});
it('observed batch wait rechecks linked posted provenance', async () => {
  const c = await contract();
  const b = await deduction(c.id);
  const r = await observedWait(
    (tx) => tx.$queryRaw`SELECT id FROM inter_co_settlement_batches WHERE id=${b.id} FOR UPDATE`,
    () => http(c.id),
    (tx) =>
      tx.interCoSettlementBatch.update({ where: { id: b.id }, data: { shopJournalEntryId: null } }),
  );
  expect(r.status).toBe(403);
  expect(await postings(c.id)).toHaveLength(0);
});
it('observed interco item wait preserves canonical changed deduction without stale money', async () => {
  const c = await contract();
  const b = await deduction(c.id);
  const r = await observedWait(
    (tx) =>
      tx.$queryRaw`SELECT id FROM inter_co_settlement_items WHERE id=${b.items[0].id} FOR UPDATE`,
    () => http(c.id, actor, 900),
    (tx) =>
      tx.interCoSettlementItem.update({
        where: { id: b.items[0].id },
        data: { swapCreditAmount: 100 },
      }),
  );
  expect(r.status).toBe(201);
});

// Only the wall clock is controlled: actual row locks and validatePeriodOpen run.
// Simulate an attempt retaining its checked Date across a calendar/grace boundary.
async function postingClock<T>(work: () => Promise<T>) {
  const actualLock = postingPeriods.lockPayoffPeriod;
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
  const guard = jest
    .spyOn(postingPeriods, 'lockPayoffPeriod')
    .mockImplementation(async (tx, date, companyId) => {
      seen.push({ companyId, date });
      await actualLock(tx, date, companyId);
      jest.setSystemTime(new Date('2020-02-20T12:00:00Z'));
    });
  try {
    return { result: await work(), seen };
  } finally {
    guard.mockRestore();
    jest.useRealTimers();
  }
}
async function period(companyId: string, status: 'OPEN' | 'CLOSED') {
  return db.accountingPeriod.upsert({
    where: { companyId_year_month: { companyId, year: 2020, month: 1 } },
    create: { companyId, year: 2020, month: 1, status },
    update: { status },
  });
}
it('actual closed FINANCE period rejects a fresh posting with no money or audit', async () => {
  await period(finance, 'CLOSED');
  await period(shop, 'OPEN');
  const c = await contract();
  const { result, seen } = await postingClock(() => http(c.id));
  expect(result.status).toBe(400);
  expect(seen.map((s) => s.companyId)).toEqual([finance]);
  expect(await postings(c.id)).toHaveLength(0);
});
it('actual closed SHOP period rolls back the genuine new FINANCE leg', async () => {
  await period(finance, 'OPEN');
  await period(shop, 'CLOSED');
  const c = await contract();
  const { result, seen } = await postingClock(() => http(c.id));
  expect(result.status).toBe(400);
  expect(seen.map((s) => s.companyId)).toEqual([finance, shop]);
  expect(seen[0].date).toEqual(seen[1].date);
  expect(await postings(c.id)).toHaveLength(0);
  expect(await db.auditLog.count({ where: { entityId: c.id } })).toBe(0);
});
it('actual closed unused SHOP period does not block NO_SHOP_PAYABLE', async () => {
  await period(finance, 'OPEN');
  await period(shop, 'CLOSED');
  const c = await contract(false);
  const { result, seen } = await postingClock(() => http(c.id));
  expect(result.status).toBe(201);
  expect(seen.map((s) => s.companyId)).toEqual([finance]);
  const entries = await postings(c.id);
  expect(entries).toHaveLength(1);
  expect(entries[0].postedAt).toEqual(seen[0].date);
});
it('authorized existing requestId acknowledgement after closure checks no new posting period', async () => {
  const c = await contract();
  const key = randomUUID();
  expect((await http(c.id, actor, 1000, key)).status).toBe(201);
  await period(finance, 'CLOSED');
  await period(shop, 'CLOSED');
  const { result, seen } = await postingClock(() => http(c.id, actor, 1000, key));
  expect(result.status).toBe(201);
  expect(seen).toEqual([]);
  expect(await postings(c.id)).toHaveLength(2);
});
it('actual observed period row wait retries with a fresh checked Date and preserves canonical current-month grace', async () => {
  const now = new Date();
  const p = await db.accountingPeriod.upsert({
    where: {
      companyId_year_month: {
        companyId: finance,
        year: now.getFullYear(),
        month: now.getMonth() + 1,
      },
    },
    create: {
      companyId: finance,
      year: now.getFullYear(),
      month: now.getMonth() + 1,
      status: 'OPEN',
    },
    update: { status: 'OPEN' },
  });
  const c = await contract();
  try {
    const r = await observedWait(
      (tx) => tx.$queryRaw`SELECT id FROM accounting_periods WHERE id=${p.id} FOR UPDATE`,
      () => http(c.id),
      (tx) => tx.accountingPeriod.update({ where: { id: p.id }, data: { status: 'CLOSED' } }),
    );
    expect(r.status).toBe(201);
    const entries = await postings(c.id);
    expect(entries).toHaveLength(2);
    expect(entries[0].postedAt).toEqual(entries[1].postedAt);
  } finally {
    await db.accountingPeriod.update({ where: { id: p.id }, data: { status: 'OPEN' } });
  }
});
it('unbound managed actor cannot call the canonical service outside the owned boundary', async () => {
  const c = await contract();
  await expect(
    service.shopCollectSettlement(c.id, actor, {
      depositAccountCode: '11-1201',
      amount: 100,
      requestId: randomUUID(),
    }),
  ).rejects.toThrow();
  expect(await postings(c.id)).toHaveLength(0);
});
it('managed writer P2034 retries the whole owned attempt before telemetry and commits once', async () => {
  const c = await contract();
  jest.mocked(Sentry.captureMessage).mockClear();
  const original = journal.createAndPost.bind(journal);
  let calls = 0;
  const writer = jest.spyOn(journal, 'createAndPost').mockImplementation(async (input, tx) => {
    if (++calls === 1)
      throw new Prisma.PrismaClientKnownRequestError('Owned writer serialization', {
        code: 'P2034',
        clientVersion: 'owned',
      });
    return original(input, tx);
  });
  try {
    expect((await http(c.id)).status).toBe(201);
    expect(calls).toBe(3);
    expect(await postings(c.id)).toHaveLength(2);
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  } finally {
    writer.mockRestore();
  }
});
it('managed writer retry exhaustion is bounded and returns sanitized 409 with no effects', async () => {
  const c = await contract();
  jest.mocked(Sentry.captureMessage).mockClear();
  const writer = jest.spyOn(journal, 'createAndPost').mockRejectedValue(
    new Prisma.PrismaClientKnownRequestError('PRIVATE-DB-DETAIL', {
      code: 'P2034',
      clientVersion: 'owned',
    }),
  );
  try {
    const r = await http(c.id);
    expect(r.status).toBe(409);
    expect(JSON.stringify(r.body)).not.toContain('PRIVATE');
    expect(writer).toHaveBeenCalledTimes(3);
    expect(await postings(c.id)).toHaveLength(0);
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  } finally {
    writer.mockRestore();
  }
});
it('real PostgreSQL unique violation returns 409 without querying the aborted transaction', async () => {
  const c = await contract();
  await db.$executeRawUnsafe(
    `CREATE FUNCTION settlement_unique_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.metadata->>'flow'='shop-collect-settlement' THEN RAISE EXCEPTION 'owned unique collision' USING ERRCODE='23505'; END IF; RETURN NEW; END $$`,
  );
  await db.$executeRawUnsafe(
    `CREATE TRIGGER settlement_unique_failure BEFORE INSERT ON journal_entries FOR EACH ROW EXECUTE FUNCTION settlement_unique_failure()`,
  );
  const failures: unknown[] = [];
  const actualWriter = journal.createAndPost.bind(journal);
  const writer = jest.spyOn(journal, 'createAndPost').mockImplementation(async (input, tx) => {
    try {
      return await actualWriter(input, tx);
    } catch (error) {
      failures.push(error);
      throw error;
    }
  });
  try {
    const r = await http(c.id);
    expect(r.status).toBe(409);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect(failures[0]).toMatchObject({ code: 'P2002' });
    expect(await postings(c.id)).toHaveLength(0);
    expect(await db.auditLog.count({ where: { entityId: c.id } })).toBe(0);
  } finally {
    writer.mockRestore();
    await db.$executeRawUnsafe('DROP TRIGGER settlement_unique_failure ON journal_entries');
    await db.$executeRawUnsafe('DROP FUNCTION settlement_unique_failure()');
  }
});
it.each(['finance-company', 'shop-company', 'origin-branch', 'deleted-contract'] as const)(
  'current inactive/deleted %s denies even a managed owner',
  async (mode) => {
    const who = await person();
    await db.user.update({ where: { id: who }, data: { role: 'OWNER' } });
    const c = await contract();
    try {
      if (mode === 'finance-company')
        await db.companyInfo.update({ where: { id: finance }, data: { isActive: false } });
      if (mode === 'shop-company')
        await db.companyInfo.update({ where: { id: shop }, data: { isActive: false } });
      if (mode === 'origin-branch')
        await db.branch.update({ where: { id: branch }, data: { isActive: false } });
      if (mode === 'deleted-contract')
        await db.contract.update({ where: { id: c.id }, data: { deletedAt: new Date() } });
      expect((await http(c.id, who)).status).toBe(403);
      expect(await postings(c.id)).toHaveLength(0);
    } finally {
      await db.companyInfo.updateMany({
        where: { id: { in: [finance, shop] } },
        data: { isActive: true },
      });
      await db.branch.update({ where: { id: branch }, data: { isActive: true } });
    }
  },
);
it('new idempotent acknowledgement still requires current independent SHOP authority', async () => {
  const who = await person();
  await grant(who);
  const shopGrant = await grant(who, ['payments.create'], 'SHOP');
  const c = await contract();
  const key = randomUUID();
  expect((await http(c.id, who, 400, key)).status).toBe(201);
  await db.employeeAccessAssignment.update({
    where: { id: shopGrant.id },
    data: { deletedAt: new Date() },
  });
  expect((await http(c.id, who, 400, key)).status).toBe(403);
  expect(await postings(c.id)).toHaveLength(2);
});
it('dedupe metadata without actual posted FINANCE clearing lines cannot authorize acknowledgement', async () => {
  const c = await contract();
  const key = randomUUID();
  expect((await http(c.id, actor, 400, key)).status).toBe(201);
  const entries = await postings(c.id);
  const je = entries.find((e) => e.companyId === finance)!;
  await db.journalLine.updateMany({
    where: { journalEntryId: je.id, accountCode: '11-2107' },
    data: { credit: 0 },
  });
  expect((await http(c.id, actor, 400, key)).status).toBe(403);
  expect(await postings(c.id)).toHaveLength(2);
});
it('same-transaction audit identifies actual current sources and both real posted journals', async () => {
  const c = await contract();
  expect((await http(c.id)).status).toBe(201);
  const entries = await postings(c.id);
  const audit = await db.auditLog.findFirstOrThrow({
    where: { entityId: c.id, action: 'SHOP_COLLECT_SETTLED' },
  });
  expect(audit.userId).toBe(actor);
  expect(audit.newValue).toMatchObject({
    financeCompanyId: finance,
    shopCompanyId: shop,
    originBranchId: branch,
    financeJournalEntryId: entries.find((e) => e.companyId === finance)!.id,
    shopJournalEntryId: entries.find((e) => e.companyId === shop)!.id,
    deduped: false,
  });
});
it('typed SHOP payable in the wrong book cannot be silently dropped or trusted', async () => {
  const c = await contract(false);
  await ledger(c.id, finance, 1000, true);
  expect((await http(c.id)).status).toBe(403);
  expect(await postings(c.id)).toHaveLength(0);
});
it('legacy absent-requestId after full clearing preserves its original no-outstanding rejection', async () => {
  const c = await contract(false);
  expect((await http(c.id, actor, 1000, '')).status).toBe(201);
  expect((await http(c.id, actor, 1000, '')).status).toBe(400);
  expect(await postings(c.id)).toHaveLength(1);
});
it('post-recovery remittance does not require a live loan or FINANCE-owned Product', async () => {
  const c = await contract();
  await db.contract.update({ where: { id: c.id }, data: { status: 'TERMINATED' } });
  await db.product.update({ where: { id: c.productId }, data: { ownedByCompanyId: shop } });
  expect((await http(c.id)).status).toBe(201);
});
