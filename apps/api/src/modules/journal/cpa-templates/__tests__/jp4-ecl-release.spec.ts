import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { seedFinanceCoa } from '../../../../../prisma/seed-coa-finance';
import { seedStandard17k12m } from '../../__tests__/scenario-helpers';
import { ContractActivation1ATemplate } from '../contract-activation-1a.template';
import { InstallmentAccrual2ATemplate } from '../installment-accrual-2a.template';
import { BadDebtProvisionTemplate } from '../bad-debt-provision.template';
import { EclStageReverseTemplate } from '../ecl-stage-reverse.template';
import { EarlyPayoffJP4Template } from '../early-payoff-jp4.template';
import { Vat60dayReversalTemplate } from '../vat-60day-reversal.template';
import { ShopCollectSettlementTemplate } from '../shop-collect-settlement.template';
import { JournalAutoService } from '../../journal-auto.service';
import { glContractBalance } from '../../gl-contract-balance';
import { ContractPaymentService } from '../../../contracts/contract-payment.service';
import { ProductsService } from '../../../products/products.service';

/**
 * C1 (owner decision 2026-07-30) — early payoff (JP4) never released the
 * contract's ECL allowance (11-2102). `ContractPaymentService.earlyPayoff`
 * posted the JP4 JE + flipped the contract to EARLY_PAYOFF but never touched
 * 11-2102 — once the contract leaves the daily bad-debt-provision cron's
 * scope (ACTIVE/OVERDUE/DEFAULT/TERMINATED only), any allowance sticks on the
 * balance sheet forever with a stale ACTIVE BadDebtProvision row.
 *
 * Fix: `ContractPaymentService.releaseEclOnPayoff` runs INSIDE the same
 * earlyPayoff $transaction, right after the contract flips to EARLY_PAYOFF.
 * It mirrors the JP5/write-off release convention exactly
 * (`glContractBalance` + `EclStageReverseTemplate` — Dr 11-2102 / Cr 51-1103),
 * minus the "consume against loss" leg (JP4 is a full cash settlement, no
 * derecognition loss to net against) — then ALWAYS flips ACTIVE
 * BadDebtProvision rows to REVERSED (mirrors RepossessionsService's identical
 * step after JP5).
 *
 * Golden (17k/12m fixture, installmentTotal 1,515.83): a pre-existing 30.32
 * provision (e.g. a 30d-overdue B1 bucket, 2%) seeded via a real
 * `BadDebtProvisionTemplate` JE + a matching ACTIVE `BadDebtProvision` row →
 * earlyPayoff() must post Dr 11-2102 30.32 / Cr 51-1103 30.32, leave GL
 * 11-2102 for the contract at exactly 0.00, flip the row to REVERSED, and be
 * idempotent on a second run (no new JE, `EclStageReverseTemplate` self-skips
 * once the GL balance nets to 0).
 */

const prisma = new PrismaClient();

async function setup(): Promise<{ journal: JournalAutoService; adminId: string }> {
  // JournalPostAuditLog rows (asset flows) FK-reference journal_entries —
  // clear them BEFORE journalEntry or deleteMany trips P2003 (same cleanup
  // convention as early-payoff-jp4.template.spec.ts / ecl-terminated-base.spec.ts).
  await prisma.journalPostAuditLog.deleteMany({});
  await prisma.journalLine.deleteMany({});
  await prisma.journalEntry.deleteMany({});
  await prisma.badDebtProvision.deleteMany({});
  await prisma.receipt.deleteMany({});
  await prisma.eDocument.deleteMany({});
  await prisma.signature.deleteMany({});
  await prisma.contractDocument.deleteMany({});
  await prisma.partialPaymentLink.deleteMany({});
  await prisma.warrantyAuditLog.deleteMany({});
  await prisma.promiseSlot.deleteMany({});
  await prisma.callLog.deleteMany({});
  await prisma.dunningAction.deleteMany({});
  await prisma.repossession.deleteMany({});
  await prisma.installmentSchedule.deleteMany({});
  await prisma.payment.deleteMany({});
  // T1-C7 guard: a contract that went through a real writeOffBadDebt() has a
  // permanent (DB-trigger-immutable) badDebtWriteOffAuditLog row FK-referencing
  // it (see cn-issue-on-writeoff.spec.ts, Phase 3 Task 3) — an unscoped
  // deleteMany would throw once one exists in this shared dev/CI DB.
  const woPoisoned = await prisma.badDebtWriteOffAuditLog.findMany({ select: { contractId: true } });
  await prisma.contract.deleteMany({ where: { id: { notIn: woPoisoned.map((p) => p.contractId) } } });
  await seedFinanceCoa(prisma);

  const existingFinance = await prisma.companyInfo.findFirst({ where: { companyCode: 'FINANCE' } });
  if (!existingFinance) {
    await prisma.companyInfo.create({
      data: {
        nameTh: 'BESTCHOICE FINANCE',
        taxId: '0000000000002',
        companyCode: 'FINANCE',
        address: '1 Finance Rd.',
        directorName: 'Test Director',
        vatRegistered: true,
        vatRate: new Decimal('0.0700'),
      },
    });
  }

  let admin = await prisma.user.findFirst({ where: { email: 'admin@bestchoice.com' } });
  if (!admin) {
    admin = await prisma.user.create({
      data: { email: 'admin@bestchoice.com', password: 'x', name: 'admin', role: 'OWNER' },
    });
  }

  return { journal: new JournalAutoService(prisma as any), adminId: admin.id };
}

/**
 * earlyPayoff() reads unpaid installments from the `Payment` table (NOT
 * InstallmentSchedule) — seed PENDING rows for every installment, mirroring
 * shop-collect-payoff.integration.spec.ts's identical helper.
 */
async function seedPendingPayments(contractId: string, installmentCount: number): Promise<void> {
  const installmentTotal = new Decimal('1515.83');
  const startDate = new Date('2025-01-01');
  for (let installmentNo = 1; installmentNo <= installmentCount; installmentNo++) {
    const dueDate = new Date(startDate);
    dueDate.setMonth(dueDate.getMonth() + installmentNo);
    await prisma.payment.upsert({
      where: { contractId_installmentNo: { contractId, installmentNo } },
      create: {
        contractId,
        installmentNo,
        amountDue: installmentTotal,
        amountPaid: new Decimal('0'),
        dueDate,
        status: 'PENDING',
      },
      update: {
        amountDue: installmentTotal,
        amountPaid: new Decimal('0'),
        dueDate,
        status: 'PENDING',
      },
    });
  }
}

function buildService(journal: JournalAutoService): ContractPaymentService {
  const products = new ProductsService(prisma as any);
  const vat60Reversal = new Vat60dayReversalTemplate(journal, prisma as any);
  // EarlyPayoffJP4Template is a required constructor dep but earlyPayoff()
  // never calls it directly (see contract-payment.service.ts comment ~line 378
  // — it builds its own JE via computeEarlyPayoffJE to avoid double-creating
  // Payment rows). Mirrors shop-collect-*.integration.spec.ts's construction.
  const jp4 = new EarlyPayoffJP4Template(journal, prisma as any, vat60Reversal);
  const settlementTemplate = new ShopCollectSettlementTemplate(journal, prisma as any);
  const eclStageReverseTemplate = new EclStageReverseTemplate(journal, prisma as any);
  return new ContractPaymentService(
    prisma as any,
    products,
    journal,
    jp4,
    settlementTemplate,
    { generateReceipt: async () => undefined } as any,
    eclStageReverseTemplate,
  );
}

async function getStageReverseEntries(contractId: string) {
  return prisma.journalEntry.findMany({
    where: {
      AND: [
        { metadata: { path: ['contractId'], equals: contractId } } as any,
        { metadata: { path: ['flow'], equals: 'stage-reverse' } } as any,
      ],
    },
    include: { lines: true },
  });
}

describe('JP4 early payoff releases 11-2102 ECL allowance (C1, 2026-07-30)', () => {
  let contractId: string;
  let adminId: string;

  beforeAll(async () => {
    const { journal, adminId: uid } = await setup();
    adminId = uid;

    const c = await seedStandard17k12m(prisma);
    contractId = c.id;
    await new ContractActivation1ATemplate(journal, prisma as any).execute(contractId);

    // 1A + 2A×1 — accrue installment #1 (mirrors the standard golden setup;
    // accrual state is orthogonal to the ECL-release logic under test, which
    // only reads the GL 11-2102 balance + the ACTIVE BadDebtProvision row).
    const inst1 = await prisma.installmentSchedule.findFirst({
      where: { contractId, installmentNo: 1 },
    });
    await new InstallmentAccrual2ATemplate(journal, prisma as any).execute(inst1!.id);

    // earlyPayoff() reads unpaid installments from Payment, not the schedule.
    await seedPendingPayments(contractId, c.installmentCount);

    // Seed a POSTED provision JE 30.32 (Dr 51-1103 / Cr 11-2102) — a real prior
    // monthly-close run, same as jp5-vat-split.spec.ts / ecl-terminated-base.spec.ts.
    const provisionTmpl = new BadDebtProvisionTemplate(journal, prisma as any);
    await provisionTmpl.execute({
      contractId,
      provisionAmount: new Decimal('30.32'),
      period: '2025-02',
    });

    // Matching ACTIVE BadDebtProvision row (30d overdue, B1 bucket 2%).
    await prisma.badDebtProvision.create({
      data: {
        contractId,
        provisionDate: new Date(),
        agingBucket: '1-30',
        daysOverdue: 30,
        outstandingAmount: new Decimal('1515.83'),
        provisionRate: new Decimal('0.02'),
        provisionAmount: new Decimal('30.32'),
        status: 'ACTIVE',
      },
    });
  });

  afterAll(async () => {
    // Scoped to this spec's own contractId — do NOT touch journal_entries/
    // journal_lines unscoped (shared across specs; each spec's own setup()
    // wipe already guarantees a clean slate — see sibling specs' convention).
    await prisma.badDebtProvision.deleteMany({ where: { contractId } });
    await prisma.payment.deleteMany({ where: { contractId } });
    await prisma.installmentSchedule.deleteMany({ where: { contractId } });
    await prisma.contract.deleteMany({ where: { id: contractId } });
    await prisma.$disconnect();
  });

  it('sanity: GL 11-2102 balance for the contract is 30.32 BEFORE payoff', async () => {
    const bal = await glContractBalance(prisma, contractId, '11-2102', 'cr');
    expect(bal.toFixed(2)).toBe('30.32');
  });

  it('earlyPayoff() releases the 30.32 ECL allowance (Dr 11-2102 / Cr 51-1103), GL nets to 0.00, row REVERSED', async () => {
    const journal = new JournalAutoService(prisma as any);
    const svc = buildService(journal);

    await svc.earlyPayoff(contractId, adminId, { paymentMethod: 'CASH', discountPct: 50 });

    // Contract flipped to EARLY_PAYOFF (the pre-existing JP4 behaviour).
    const updated = await prisma.contract.findUnique({ where: { id: contractId } });
    expect(updated!.status).toBe('EARLY_PAYOFF');

    // Exactly ONE ECL-stage-reverse JE posted for this contract.
    const entries = await getStageReverseEntries(contractId);
    expect(entries.length, 'expected exactly 1 ECL stage-reverse JE').toBe(1);

    const lines = entries[0].lines;
    const dr112102 = lines
      .filter((l) => l.accountCode === '11-2102')
      .reduce((s, l) => s.plus(l.debit.toString()), new Decimal(0));
    const cr511103 = lines
      .filter((l) => l.accountCode === '51-1103')
      .reduce((s, l) => s.plus(l.credit.toString()), new Decimal(0));
    expect(dr112102.toFixed(2)).toBe('30.32');
    expect(cr511103.toFixed(2)).toBe('30.32');

    // JE balanced.
    const totalDr = lines.reduce((s, l) => s.plus(l.debit.toString()), new Decimal(0));
    const totalCr = lines.reduce((s, l) => s.plus(l.credit.toString()), new Decimal(0));
    expect(totalDr.toFixed(2)).toBe(totalCr.toFixed(2));

    // GL 11-2102 for this contract now nets to exactly 0.00.
    const balAfter = await glContractBalance(prisma, contractId, '11-2102', 'cr');
    expect(balAfter.toFixed(2)).toBe('0.00');

    // BadDebtProvision row flipped to REVERSED.
    const row = await prisma.badDebtProvision.findFirst({ where: { contractId } });
    expect(row!.status).toBe('REVERSED');
  });

  it('idempotent: re-running the release path posts NOTHING new (GL already 0)', async () => {
    const journal = new JournalAutoService(prisma as any);
    const svc = buildService(journal);

    const before = await getStageReverseEntries(contractId);
    expect(before.length).toBe(1);

    // Invoke the private helper's exact code path directly (same pattern as
    // bad-debt.streak-bucket.integration.spec.ts's `(svc as any).streakToBucket`)
    // — earlyPayoff() itself can't be called twice (the contract is no longer
    // ACTIVE/OVERDUE/DEFAULT after the first payoff).
    await prisma.$transaction(async (tx) => {
      await (svc as any).releaseEclOnPayoff(tx, contractId);
    });

    const after = await getStageReverseEntries(contractId);
    expect(after.length, 'no new ECL stage-reverse JE on re-run').toBe(1);
    expect(after[0].id).toBe(before[0].id);

    const balAfter = await glContractBalance(prisma, contractId, '11-2102', 'cr');
    expect(balAfter.toFixed(2)).toBe('0.00');

    const row = await prisma.badDebtProvision.findFirst({ where: { contractId } });
    expect(row!.status).toBe('REVERSED');
  });
});
