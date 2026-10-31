import { createHash, randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import { Logger } from '@nestjs/common';
import { PermissionKey } from '@installment/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { ContractPaymentService, SlipMatchAuthorization } from './contract-payment.service';
import { EarlyPayoffDto } from './dto/contract.dto';
import { ProductsService } from '../products/products.service';
import { JournalAutoService } from '../journal/journal-auto.service';
import { EclStageReverseTemplate } from '../journal/cpa-templates/ecl-stage-reverse.template';
import { EarlyPayoffJP4Template } from '../journal/cpa-templates/early-payoff-jp4.template';
import { ShopCollectSettlementTemplate } from '../journal/cpa-templates/shop-collect-settlement.template';
import { ReceiptVoidReversalTemplate } from '../journal/cpa-templates/receipt-void-reversal.template';
import { ReceiptsService } from '../receipts/receipts.service';
import { LineOaService } from '../line-oa/line-oa.service';
import { JourneyEntryWriter } from '../customer-journey/journey-entry-writer.service';
import { AccessSnapshotService } from '../employee-access/access-snapshot.service';
import { AccessResourceService } from '../employee-access/access-resource.service';
import { currentDomainAccess } from '../employee-access/access-execution-context';
import { createEarlyPayoffRequest } from '../payments/services/early-payoff-request';

jest.mock('@sentry/nestjs', () => ({ captureMessage: jest.fn(), captureException: jest.fn() }));
const url = process.env.PAYOFF_ATOMIC_TEST_DATABASE_URL;
if (
  !url?.includes('/bc_payoff_atomic?host=/tmp/bc-payoff-atomic.') ||
  process.env.DATABASE_URL !== url ||
  process.env.DATABASE_URL_FINANCE !== url
)
  throw new Error('Both database URLs must identify the owned payoff atomic cluster');
const db = new PrismaClient({ datasources: { db: { url } } });
const prisma = db as PrismaService;
const snapshots = new AccessSnapshotService(prisma);
const resources = new AccessResourceService(prisma, snapshots);
const line = { sendPaymentReceipt: jest.fn().mockResolvedValue(undefined) };
const journey = { recordAfterCommit: jest.fn().mockResolvedValue(undefined) };
const journal = new JournalAutoService(prisma);
const products = new ProductsService(prisma);
const receipts = new ReceiptsService(
  prisma,
  journal,
  {} as ReceiptVoidReversalTemplate,
  line as unknown as LineOaService,
);
const service = new ContractPaymentService(
  prisma,
  products,
  journal,
  {} as EarlyPayoffJP4Template,
  {} as ShopCollectSettlementTemplate,
  receipts,
  new EclStageReverseTemplate(journal, prisma),
  journey as unknown as JourneyEntryWriter,
);
let actor: string, legacy: string, finance: string, shop: string, branch: string;
const writes: PermissionKey[] = ['contracts.read', 'payments.read', 'payments.create'];
const paidDate = new Date('2026-10-01T00:00:00.000Z');
async function person(managed: boolean, email = randomUUID() + '@test.invalid') {
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
async function grant(userId: string, permissions = writes) {
  const position = await db.accessPosition.create({
    data: { code: randomUUID(), name: 'Owned position', permissions },
  });
  return db.employeeAccessAssignment.create({
    data: { userId, positionId: position.id, companyCode: 'FINANCE', scope: 'COMPANY' },
  });
}
async function contract(ecl = 0) {
  const lineUserId = randomUUID();
  const customer = await db.customer.create({
    data: { name: 'PRIVATE-PAYER', phone: '0800000000', lineIdFinance: lineUserId },
  });
  // Task 22 fix round 1 I-1 (ง): the LINE receipt goes to the active OTP link row (bind writes it next to the column)
  await db.customerLineLink.create({
    data: { customerId: customer.id, lineUserId, channel: 'FINANCE' },
  });
  const product = await db.product.create({
    data: {
      name: 'Owned device',
      brand: 'Apple',
      model: 'Test',
      category: 'PHONE_NEW',
      costPrice: 9000,
      branchId: branch,
      ownedByCompanyId: finance,
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
      status: 'ACTIVE',
    },
  });
  for (let n = 1; n <= 10; n++) {
    await db.payment.create({
      data: {
        contractId: row.id,
        installmentNo: n,
        dueDate: paidDate,
        amountDue: 1200,
        monthlyPrincipal: 1000,
        monthlyInterest: 200,
        monthlyCommission: 0,
        vatAmount: 0,
      },
    });
    await db.installmentSchedule.create({
      data: {
        contractId: row.id,
        installmentNo: n,
        dueDate: paidDate,
        principal: 1000,
        interest: 200,
        amountDue: 1200,
      },
    });
  }
  await db.journalEntry.create({
    data: {
      entryNumber: 'OPEN-' + randomUUID(),
      entryDate: paidDate,
      postedAt: paidDate,
      description: 'Owned opening ledger',
      status: 'POSTED',
      createdById: legacy,
      companyId: finance,
      metadata: { contractId: row.id, tag: '1A' },
      lines: {
        create: [
          { accountCode: '11-2101', debit: 12000, credit: 0 },
          { accountCode: '11-2106', debit: 0, credit: 2000 },
          { accountCode: '11-1201', debit: 0, credit: 10000 },
          ...(ecl
            ? [
                { accountCode: '11-2102', debit: 0, credit: ecl },
                { accountCode: '51-1103', debit: ecl, credit: 0 },
              ]
            : []),
        ],
      },
    },
  });
  if (ecl > 0)
    await db.badDebtProvision.create({
      data: {
        contractId: row.id,
        provisionDate: paidDate,
        agingBucket: '31-60',
        daysOverdue: 40,
        outstandingAmount: 12000,
        provisionRate: 0.05,
        provisionAmount: ecl,
      },
    });
  return row;
}
function proof(amount = 12000): SlipMatchAuthorization {
  return {
    imageKey: 'PRIVATE-KEY/' + randomUUID(),
    hash: randomUUID(),
    amount,
    refNo: 'PRIVATE-REF',
    bankName: 'PRIVATE-BANK',
    date: paidDate.toISOString(),
    confidence: 0.99,
  };
}
const dto: EarlyPayoffDto = {
  paymentMethod: 'BANK_TRANSFER',
  discountPct: 0,
  paymentDate: '2026-10-01',
  notes: 'PRIVATE-NOTES',
};
async function owned<T>(work: () => Promise<T>, userId = actor) {
  return resources.execute(userId, 'payments.create', 'FINANCE', undefined, work, false, {
    domain: 'parties',
    isolationLevel: 'Serializable',
    maxAttempts: 3,
  });
}
async function state(id: string) {
  return {
    contract: await db.contract.findUniqueOrThrow({ where: { id } }),
    paid: await db.payment.count({ where: { contractId: id, status: 'PAID' } }),
    receipts: await db.receipt.count({ where: { contractId: id } }),
    evidence: await db.paymentEvidence.count({ where: { contractId: id } }),
    fingerprints: await db.slipFingerprint.count({ where: { contractId: id } }),
    journals: await db.journalEntry.count({
      where: { metadata: { path: ['contractId'], equals: id } },
    }),
    product: await db.product.findFirst({
      where: { contracts: { some: { id } } },
      select: { ownedByCompanyId: true },
    }),
    audits: await db.auditLog.count({ where: { entityId: id } }),
    provisions: await db.badDebtProvision.findMany({ where: { contractId: id } }),
  };
}
beforeAll(async () => {
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  finance = (await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'FINANCE' } })).id;
  shop = (await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'SHOP' } })).id;
  await db.companyInfo.update({
    where: { id: finance },
    data: { nameTh: 'Owned FINANCE receiver' },
  });
  branch = (await db.branch.create({ data: { name: 'Owned origin', companyId: shop } })).id;
  actor = await person(true);
  legacy = await person(false, 'admin@bestchoice.com');
  await grant(actor);
  for (const code of [
    '11-1201',
    '11-2101',
    '11-2102',
    '11-2106',
    '41-1101',
    '51-1103',
    '52-1106',
  ]) {
    await db.chartOfAccount.upsert({
      where: { code },
      update: {},
      create: { code, name: 'Owned ' + code, type: 'สินทรัพย์', normalBalance: 'Dr' },
    });
  }
});
beforeEach(() => {
  line.sendPaymentReceipt.mockReset().mockResolvedValue(undefined);
  journey.recordAfterCommit.mockReset().mockResolvedValue(undefined);
  jest.mocked(Sentry.captureMessage).mockClear();
});
afterAll(async () => {
  jest.restoreAllMocks();
  await db.$disconnect();
});

it('baseline genuine unmanaged canonical money and receipt succeed', async () => {
  const c = await contract();
  await service.earlyPayoff(c.id, legacy, dto, undefined, proof());
  const after = await state(c.id);
  expect(after.paid).toBe(10);
  expect(after.receipts).toBe(1);
  expect(after.journals).toBe(2);
  expect(after.contract.status).toBe('EARLY_PAYOFF');
  expect(line.sendPaymentReceipt).toHaveBeenCalledTimes(1);
});
it('managed canonical money, receipt and effects belong to the actual outer rollback', async () => {
  const c = await contract();
  const before = await state(c.id);
  await expect(
    owned(async () => {
      await service.earlyPayoff(c.id, actor, dto, undefined, proof());
      throw new Error('OWNED-OUTER-ROLLBACK');
    }),
  ).rejects.toThrow('OWNED-OUTER-ROLLBACK');
  expect(await state(c.id)).toEqual(before);
  expect(line.sendPaymentReceipt).not.toHaveBeenCalled();
  expect(journey.recordAfterCommit).not.toHaveBeenCalled();
});
it('managed receipt is visible in exact owned client and effects wait for actual commit', async () => {
  const c = await contract();
  await owned(async () => {
    await service.earlyPayoff(c.id, actor, dto, undefined, proof());
    expect(await currentDomainAccess()!.client.receipt.count({ where: { contractId: c.id } })).toBe(
      1,
    );
    expect(line.sendPaymentReceipt).not.toHaveBeenCalled();
    expect(journey.recordAfterCommit).not.toHaveBeenCalled();
  });
  expect(line.sendPaymentReceipt).toHaveBeenCalledTimes(1);
  expect(journey.recordAfterCommit).toHaveBeenCalledTimes(1);
});
it('currently managed actor cannot execute through a legacy unbound slip authorization', async () => {
  const c = await contract();
  await expect(service.earlyPayoff(c.id, actor, dto, undefined, proof())).rejects.toThrow();
  expect((await state(c.id)).paid).toBe(0);
});

it('real JP4, positive ECL and receipt retain actual employee, FINANCE, checked date and canonical fields', async () => {
  const c = await contract(600);
  const result = await owned(() => service.earlyPayoff(c.id, actor, dto, undefined, proof()));
  const entries = await db.journalEntry.findMany({
    where: { metadata: { path: ['contractId'], equals: c.id }, entryNumber: { startsWith: 'JE-' } },
    include: { lines: true },
  });
  expect(entries).toHaveLength(2);
  for (const entry of entries) {
    expect(entry.createdById).toBe(actor);
    expect(entry.companyId).toBe(finance);
    expect(entry.entryDate).toEqual(paidDate);
    expect(entry.postedAt).toEqual(paidDate);
    expect(
      entry.lines
        .reduce((n, l) => n.plus(l.debit).minus(l.credit), new Prisma.Decimal(0))
        .toFixed(2),
    ).toBe('0.00');
  }
  expect(entries.map((e) => (e.metadata as Prisma.JsonObject).tag).sort()).toEqual([
    'ECL-STAGE-REVERSE',
    'JP4',
  ]);
  const ecl = entries.find((e) => (e.metadata as Prisma.JsonObject).tag === 'ECL-STAGE-REVERSE')!;
  expect(ecl.metadata).toMatchObject({ period: '2026-10', reverseAmount: '600.00' });
  expect((await db.badDebtProvision.findFirstOrThrow({ where: { contractId: c.id } })).status).toBe(
    'REVERSED',
  );
  const receipt = await db.receipt.findFirstOrThrow({ where: { contractId: c.id } });
  expect(receipt).toMatchObject({
    issuedById: actor,
    receiverName: 'Owned FINANCE receiver',
    payerName: 'PRIVATE-PAYER',
    sourceJournalEntryId: null,
    receiptType: 'EARLY_PAYOFF',
    paymentMethod: 'BANK_TRANSFER',
    paidDate,
    remainingMonths: 0,
  });
  expect(receipt.amount.toFixed(2)).toBe('12000.00');
  expect(receipt.remainingBalance?.toFixed(2)).toBe('0.00');
  expect(receipt.receiptNumber).toMatch(/^RT-\d{6}-\d{5}$/);
  expect(receipt.fileHash).toBe(
    createHash('sha256')
      .update(
        JSON.stringify({
          receiptNumber: receipt.receiptNumber,
          contractId: c.id,
          amount: 12000,
          installmentNo: null,
          paidDate: paidDate.toISOString(),
        }),
      )
      .digest('hex'),
  );
  expect(
    await db.auditLog.count({
      where: { entityId: receipt.id, action: 'RECEIPT_DOCUMENT_BALANCE_V1' },
    }),
  ).toBe(0);
  const audit = await db.auditLog.findFirstOrThrow({
    where: { entityId: c.id, action: 'EARLY_PAYOFF_EXECUTED' },
  });
  expect(audit.userId).toBe(actor);
  expect(audit.newValue).toMatchObject({
    actorId: actor,
    financeCompanyId: finance,
    originShopCompanyId: shop,
    originBranchId: branch,
    productId: c.productId,
    receiptId: receipt.id,
    receiptNumber: receipt.receiptNumber,
    journalEntryIds: expect.arrayContaining(entries.map((e) => e.id)),
    paymentEvidenceId: expect.any(String),
    slipFingerprintId: expect.any(String),
  });
  expect(JSON.stringify(audit.newValue)).not.toContain('PRIVATE');
  expect(result.result).toMatchObject({
    receiptId: receipt.id,
    receiptNumber: receipt.receiptNumber,
  });
});

it.each(['receipt', 'ownership', 'audit'] as const)(
  'a real %s database failure rolls back every canonical write and effect',
  async (kind) => {
    const c = await contract(600),
      before = await state(c.id);
    const table = { receipt: 'receipts', ownership: 'products', audit: 'audit_logs' }[kind];
    const condition =
      kind === 'ownership'
        ? `NEW.id='${c.productId}' AND NEW.owned_by_company_id IS NULL`
        : kind === 'receipt'
          ? `NEW.contract_id='${c.id}'`
          : `NEW.entity_id='${c.id}' AND NEW.action='EARLY_PAYOFF_EXECUTED'`;
    await db.$executeRawUnsafe(`CREATE FUNCTION owned_payoff_failure() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF ${condition} THEN RAISE EXCEPTION 'OWNED-${kind}-FAILURE'; END IF; RETURN NEW; END $$`);
    await db.$executeRawUnsafe(`CREATE TRIGGER owned_payoff_failure BEFORE ${kind === 'ownership' ? 'UPDATE' : 'INSERT'}
    ON ${table} FOR EACH ROW EXECUTE FUNCTION owned_payoff_failure()`);
    try {
      await expect(
        owned(() => service.earlyPayoff(c.id, actor, dto, undefined, proof())),
      ).rejects.toThrow();
      expect(await state(c.id)).toEqual(before);
      expect(line.sendPaymentReceipt).not.toHaveBeenCalled();
      expect(journey.recordAfterCommit).not.toHaveBeenCalled();
      expect(Sentry.captureMessage).not.toHaveBeenCalled();
    } finally {
      await db.$executeRawUnsafe(`DROP TRIGGER owned_payoff_failure ON ${table}`);
      await db.$executeRawUnsafe('DROP FUNCTION owned_payoff_failure()');
    }
    await owned(() => service.earlyPayoff(c.id, actor, dto, undefined, proof()));
    expect((await state(c.id)).receipts).toBe(1);
  },
);

it('a real serialization abort after receipt retries once with effects only for the committed attempt', async () => {
  const c = await contract();
  let attempts = 0;
  line.sendPaymentReceipt.mockImplementation(async () => {
    expect(currentDomainAccess()).toBeUndefined();
    expect((await state(c.id)).contract.status).toBe('EARLY_PAYOFF');
  });
  await owned(async () => {
    attempts++;
    await service.earlyPayoff(c.id, actor, dto, undefined, proof());
    expect(line.sendPaymentReceipt).not.toHaveBeenCalled();
    if (attempts === 1)
      await currentDomainAccess()!.client.$executeRawUnsafe(
        "DO $$ BEGIN RAISE EXCEPTION 'OWNED-RETRY' USING ERRCODE='40001'; END $$",
      );
  });
  expect(attempts).toBe(2);
  expect((await state(c.id)).receipts).toBe(1);
  expect(line.sendPaymentReceipt).toHaveBeenCalledTimes(1);
  expect(journey.recordAfterCommit).toHaveBeenCalledTimes(1);
});
it('concurrent and repeated confirmation can commit only one actual receipt, payoff and effect', async () => {
  const c = await contract(),
    slip = proof();
  const results = await Promise.allSettled([
    owned(() => service.earlyPayoff(c.id, actor, dto, undefined, slip)),
    owned(() => service.earlyPayoff(c.id, actor, dto, undefined, slip)),
  ]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
  const after = await state(c.id);
  expect(after).toMatchObject({ receipts: 1, paid: 10, evidence: 1, fingerprints: 1, journals: 2 });
  await expect(
    owned(() => service.earlyPayoff(c.id, actor, dto, undefined, slip)),
  ).rejects.toThrow();
  expect(await state(c.id)).toEqual(after);
  expect(line.sendPaymentReceipt).toHaveBeenCalledTimes(1);
});
it('the actual fingerprint unique constraint rejects reuse on a second Contract without partial money', async () => {
  const a = await contract(),
    b = await contract(),
    slip = proof();
  await owned(() => service.earlyPayoff(a.id, actor, dto, undefined, slip));
  const before = await state(b.id);
  await expect(
    owned(() => service.earlyPayoff(b.id, actor, dto, undefined, slip)),
  ).rejects.toThrow();
  expect(await state(b.id)).toEqual(before);
  expect(line.sendPaymentReceipt).toHaveBeenCalledTimes(1);
});
it('computed positive reduction cannot use the managed OCR seam', async () => {
  const c = await contract();
  await expect(
    owned(() =>
      service.earlyPayoff(c.id, actor, { ...dto, discountPct: 50 }, undefined, proof(11000)),
    ),
  ).rejects.toThrow('เจ้าของ');
  expect((await state(c.id)).paid).toBe(0);
});
it('current source and actor identities cannot be borrowed from another execution', async () => {
  const c = await contract();
  await expect(
    owned(() => service.earlyPayoff(c.id, legacy, dto, undefined, proof())),
  ).rejects.toThrow();
  expect((await state(c.id)).paid).toBe(0);
});
it.each(['missing-read', 'assigned-mutation', 'foreign-branch'] as const)(
  'current authority rejects %s',
  async (kind) => {
    const userId = await person(true),
      c = await contract();
    const assignment = await grant(userId, kind === 'missing-read' ? ['payments.create'] : writes);
    if (kind === 'assigned-mutation') {
      await db.employeeAccessAssignment.update({
        where: { id: assignment.id },
        data: { scope: 'ASSIGNED' },
      });
      await db.contract.update({ where: { id: c.id }, data: { assignedToId: userId } });
    } else if (kind === 'foreign-branch') {
      const foreign = await db.branch.create({ data: { name: 'Foreign', companyId: shop } });
      await db.employeeAccessAssignment.update({
        where: { id: assignment.id },
        data: { scope: 'BRANCHES', branches: { create: { branchId: foreign.id } } },
      });
    }
    await expect(
      owned(() => service.earlyPayoff(c.id, userId, dto, undefined, proof()), userId),
    ).rejects.toThrow();
    expect((await state(c.id)).paid).toBe(0);
  },
);
it.each(['deleted-product', 'wrong-owner', 'retired-origin'] as const)(
  'rejects inconsistent live provenance: %s',
  async (kind) => {
    const c = await contract();
    if (kind === 'deleted-product')
      await db.product.update({ where: { id: c.productId }, data: { deletedAt: new Date() } });
    else if (kind === 'wrong-owner')
      await db.product.update({ where: { id: c.productId }, data: { ownedByCompanyId: shop } });
    else {
      const retired = await db.branch.create({
        data: { name: 'Retired', companyId: shop, isActive: false },
      });
      await db.contract.update({ where: { id: c.id }, data: { branchId: retired.id } });
    }
    const before = await state(c.id);
    await expect(
      owned(() => service.earlyPayoff(c.id, actor, dto, undefined, proof())),
    ).rejects.toThrow();
    expect(await state(c.id)).toEqual(before);
  },
);
it('managed pending approval marker still cannot be consumed by the canonical producer', async () => {
  const c = await contract();
  const request = await db.$transaction((tx) =>
    createEarlyPayoffRequest(tx, service, {
      targetId: c.id,
      userId: actor,
      reason: 'PRIVATE-REASON',
      payload: { ...dto, discountPct: 50 },
      managedSource: {
        version: 1,
        requesterId: actor,
        contractId: c.id,
        financeCompanyId: finance,
        originShopCompanyId: shop,
        originBranchId: branch,
      },
    }),
  );
  await expect(
    owned(() =>
      service.earlyPayoff(
        c.id,
        actor,
        { ...dto, discountPct: 50 },
        { requestId: request.id, actorId: actor },
      ),
    ),
  ).rejects.toThrow('รอขั้นตอนอนุมัติ');
  expect((await state(c.id)).paid).toBe(0);
  expect(
    (await db.paymentApprovalRequest.findUniqueOrThrow({ where: { id: request.id } })).status,
  ).toBe('PENDING');
});
it('negative ECL telemetry is deferred and discarded on outer rollback', async () => {
  const c = await contract(-10);
  await expect(
    owned(async () => {
      await service.earlyPayoff(c.id, actor, dto, undefined, proof());
      expect(Sentry.captureMessage).not.toHaveBeenCalled();
      throw new Error('OWNED-OUTER-ROLLBACK');
    }),
  ).rejects.toThrow('OWNED-OUTER-ROLLBACK');
  expect(Sentry.captureMessage).not.toHaveBeenCalled();
  await owned(() => service.earlyPayoff(c.id, actor, dto, undefined, proof()));
  expect(Sentry.captureMessage).toHaveBeenCalledWith(
    'JP4 payoff: negative 11-2102 balance',
    expect.any(Object),
  );
});
it('controlled delivery failure cannot roll back or retry committed money', async () => {
  const c = await contract();
  const logger = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  line.sendPaymentReceipt.mockRejectedValueOnce(new Error('OWNED-DELIVERY-FAILURE'));
  try {
    const result = await owned(() => service.earlyPayoff(c.id, actor, dto, undefined, proof()));
    expect(result.effectFailures).toBe(1);
    expect((await state(c.id)).receipts).toBe(1);
    expect(line.sendPaymentReceipt).toHaveBeenCalledTimes(1);
    expect(journey.recordAfterCommit).toHaveBeenCalledTimes(1);
  } finally {
    logger.mockRestore();
  }
});

async function observedWait<T>(
  lock: (tx: Prisma.TransactionClient) => Promise<unknown>,
  work: () => Promise<T>,
  mutate: (tx: Prisma.TransactionClient) => Promise<unknown>,
) {
  let result!: Promise<{ value?: T; error?: unknown }>;
  await db.$transaction(
    async (tx) => {
      const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      await lock(tx);
      result = work().then(
        (value) => ({ value }),
        (error) => ({ error }),
      );
      let waiting = false;
      for (let i = 0; i < 300; i++) {
        await tx.$executeRaw`SELECT pg_stat_clear_snapshot()`;
        const [state] = await tx.$queryRaw<{ waiting: boolean }[]>`SELECT EXISTS(
        SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND ${pid}=ANY(pg_blocking_pids(pid))
      ) AS waiting`;
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
it('rechecks a current grant revoked during an observed PostgreSQL lock wait', async () => {
  const userId = await person(true),
    assignment = await grant(userId),
    c = await contract();
  const result = await observedWait(
    (tx) =>
      tx.$queryRaw`SELECT id FROM access_positions WHERE id=${assignment.positionId} FOR UPDATE`,
    () => owned(() => service.earlyPayoff(c.id, userId, dto, undefined, proof()), userId),
    (tx) =>
      tx.accessPosition.update({
        where: { id: assignment.positionId },
        data: { permissions: ['contracts.read', 'payments.read'] },
      }),
  );
  expect(result.error).toBeDefined();
  expect((await state(c.id)).paid).toBe(0);
  expect(line.sendPaymentReceipt).not.toHaveBeenCalled();
});
it('rechecks current Product ownership after an observed lock wait', async () => {
  const c = await contract();
  const result = await observedWait(
    (tx) => tx.$queryRaw`SELECT id FROM products WHERE id=${c.productId} FOR UPDATE`,
    () => owned(() => service.earlyPayoff(c.id, actor, dto, undefined, proof())),
    (tx) => tx.product.update({ where: { id: c.productId }, data: { ownedByCompanyId: shop } }),
  );
  expect(result.error).toBeDefined();
  expect((await state(c.id)).paid).toBe(0);
});
it('rechecks changed payment money after an observed lock wait', async () => {
  const c = await contract();
  const payment = await db.payment.findFirstOrThrow({ where: { contractId: c.id } });
  const result = await observedWait(
    (tx) => tx.$queryRaw`SELECT id FROM payments WHERE id=${payment.id} FOR UPDATE`,
    () => owned(() => service.earlyPayoff(c.id, actor, dto, undefined, proof())),
    (tx) =>
      tx.payment.update({
        where: { id: payment.id },
        data: { amountPaid: 10, status: 'PARTIALLY_PAID' },
      }),
  );
  expect(result.error).toBeDefined();
  expect((await state(c.id)).paid).toBe(0);
  expect((await state(c.id)).receipts).toBe(0);
});
it('legacy admission locks the real actor and rejects management enabled during its wait', async () => {
  const userId = await person(false),
    c = await contract();
  const result = await observedWait(
    (tx) => tx.$queryRaw`SELECT id FROM users WHERE id=${userId} FOR UPDATE`,
    () => service.earlyPayoff(c.id, userId, dto, undefined, proof()),
    (tx) => tx.user.update({ where: { id: userId }, data: { accessManaged: true } }),
  );
  expect(result.error).toBeDefined();
  expect((await state(c.id)).paid).toBe(0);
});
it('current FINANCE period is rechecked after an observed period-row wait', async () => {
  const c = await contract();
  const period = await db.accountingPeriod.create({
    data: { companyId: finance, year: 2020, month: 1, status: 'OPEN' },
  });
  const result = await observedWait(
    (tx) => tx.$queryRaw`SELECT id FROM accounting_periods WHERE id=${period.id} FOR UPDATE`,
    () =>
      owned(() =>
        service.earlyPayoff(c.id, actor, { ...dto, paymentDate: '2020-01-15' }, undefined, proof()),
      ),
    (tx) => tx.accountingPeriod.update({ where: { id: period.id }, data: { status: 'CLOSED' } }),
  );
  expect(result.error).toBeDefined();
  expect((await state(c.id)).paid).toBe(0);
  expect(line.sendPaymentReceipt).not.toHaveBeenCalled();
});
it('closed current month retains canonical grace behavior and stamps the checked date on positive ECL', async () => {
  const c = await contract(20);
  const now = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const period = await db.accountingPeriod.upsert({
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
      status: 'CLOSED',
    },
    update: { status: 'CLOSED' },
  });
  try {
    await owned(() =>
      service.earlyPayoff(c.id, actor, { ...dto, paymentDate: date }, undefined, proof()),
    );
    const entry = await db.journalEntry.findFirstOrThrow({
      where: {
        AND: [
          { metadata: { path: ['contractId'], equals: c.id } },
          { metadata: { path: ['tag'], equals: 'ECL-STAGE-REVERSE' } },
        ],
      },
    });
    expect(entry.entryDate).toEqual(new Date(date));
    expect(entry.companyId).toBe(finance);
  } finally {
    await db.accountingPeriod.update({ where: { id: period.id }, data: { status: 'OPEN' } });
  }
});
it('independent current assigned reads with real company mutation authority remain useful', async () => {
  const userId = await person(true),
    c = await contract();
  const read = await grant(userId, ['contracts.read', 'payments.read']);
  await db.employeeAccessAssignment.update({ where: { id: read.id }, data: { scope: 'ASSIGNED' } });
  await grant(userId, ['payments.create']);
  await db.contract.update({ where: { id: c.id }, data: { assignedToId: userId } });
  await owned(() => service.earlyPayoff(c.id, userId, dto, undefined, proof()), userId);
  expect((await state(c.id)).paid).toBe(10);
});
it('future and invalid payment dates do not create any canonical monetary write', async () => {
  for (const date of ['invalid-date', '2099-01-01']) {
    const c = await contract();
    await expect(
      owned(() =>
        service.earlyPayoff(c.id, actor, { ...dto, paymentDate: date }, undefined, proof()),
      ),
    ).rejects.toThrow();
    expect((await state(c.id)).paid).toBe(0);
  }
});
it('canonical deferred ledger warnings are emitted only once after actual commit', async () => {
  const c = await contract();
  await db.journalEntry.create({
    data: {
      entryNumber: 'MISMATCH-' + randomUUID(),
      entryDate: paidDate,
      postedAt: paidDate,
      description: 'Owned ledger mismatch',
      status: 'POSTED',
      createdById: legacy,
      companyId: finance,
      metadata: { contractId: c.id },
      lines: {
        create: [
          { accountCode: '11-2101', debit: 5, credit: 0 },
          { accountCode: '11-1201', debit: 0, credit: 5 },
        ],
      },
    },
  });
  await expect(
    owned(async () => {
      await service.earlyPayoff(c.id, actor, dto, undefined, proof());
      expect(Sentry.captureMessage).not.toHaveBeenCalled();
      throw new Error('OWNED-WARNING-ROLLBACK');
    }),
  ).rejects.toThrow('OWNED-WARNING-ROLLBACK');
  expect(Sentry.captureMessage).not.toHaveBeenCalled();
  await owned(async () => {
    await service.earlyPayoff(c.id, actor, dto, undefined, proof());
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });
  expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
  expect(Sentry.captureMessage).toHaveBeenCalledWith(
    '[early-payoff] 52-1106 differs from the payoff-screen discount by more than 1.00',
    expect.any(Object),
  );
});

async function unmarkedApproval(manageRequester: boolean) {
  const c = await contract();
  const requester = await person(false);
  const reviewer = await person(false);
  await db.user.update({ where: { id: reviewer }, data: { role: 'OWNER' } });
  const input = { ...dto, discountPct: 50 };
  const approval = await db.$transaction((tx) =>
    createEarlyPayoffRequest(tx, service, {
      targetId: c.id, userId: requester, reason: 'PRIVATE-LEGACY-REASON', payload: input,
    }),
  );
  expect(approval.snapshot).not.toHaveProperty('managedEarlyPayoffSource');
  if (manageRequester) {
    await db.user.update({ where: { id: requester }, data: { accessManaged: true } });
    await grant(requester);
  }
  return { c, requester, reviewer, input, approval };
}

it('R140 rejects a genuine old unmarked approval in an otherwise authorized managed execution', async () => {
  const { c, requester, reviewer, input, approval } = await unmarkedApproval(true);
  const before = await state(c.id);
  await expect(owned(() => service.earlyPayoff(c.id, requester, input,
    { requestId: approval.id, actorId: reviewer }), requester)).rejects.toThrow();
  expect(await state(c.id)).toEqual(before);
  expect((await db.paymentApprovalRequest.findUniqueOrThrow({ where: { id: approval.id } })).status).toBe('PENDING');
  expect(line.sendPaymentReceipt).not.toHaveBeenCalled();
  expect(journey.recordAfterCommit).not.toHaveBeenCalled();
});

it('R140 preserves actual genuine unmanaged approved execution through the unchanged consumer', async () => {
  const { c, requester, reviewer, input, approval } = await unmarkedApproval(false);
  await service.earlyPayoff(c.id, requester, input, { requestId: approval.id, actorId: reviewer });
  expect((await state(c.id)).paid).toBe(10);
  expect((await state(c.id)).receipts).toBe(1);
  expect((await db.receipt.findFirstOrThrow({ where: { contractId: c.id } })).amount.toFixed(2)).toBe('11000.00');
  expect((await db.paymentApprovalRequest.findUniqueOrThrow({ where: { id: approval.id } })).status).toBe('APPROVED');
  expect(line.sendPaymentReceipt).toHaveBeenCalledTimes(1);
});
