/**
 * Phase 1 / T1 integration test — RecordPaymentWizard 2A/2B preview blocks.
 *
 * Runner: vitest (DB-backed; *.integration.spec.ts is jest-ignored per package.json).
 * Run:    cd apps/api && npx vitest run --no-file-parallelism \
 *           src/modules/payments/services/payment-journal-preview.block.integration.spec.ts
 *
 * Verifies the DB-dependent half of T1: in 2B_ONLY mode the preview fetches the
 * already-posted 2A accrual JE (= 2,115.00) as a read-only context block, and the
 * live 2B block balances. (The pure block/subtotal math is covered DB-free by
 * payment-preview-blocks.util.spec.ts.)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';
import { seedStandard17k12m } from '../../journal/__tests__/scenario-helpers';
import { JournalAutoService } from '../../journal/journal-auto.service';
import { ContractActivation1ATemplate } from '../../journal/cpa-templates/contract-activation-1a.template';
import { InstallmentAccrual2ATemplate } from '../../journal/cpa-templates/installment-accrual-2a.template';
import { PaymentJournalPreviewService } from './payment-journal-preview.service';

const prisma = new PrismaClient();

async function ensureFinanceCompany(): Promise<void> {
  const existing = await prisma.companyInfo.findFirst({ where: { companyCode: 'FINANCE' } });
  if (!existing) {
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
}

describe('payment-journal-preview — 2A/2B blocks (integration)', () => {
  let svc: PaymentJournalPreviewService;
  let contractId: string;

  beforeAll(async () => {
    await prisma.journalLine.deleteMany({});
    await prisma.journalEntry.deleteMany({});
    await prisma.payment.deleteMany({});
    await prisma.installmentSchedule.deleteMany({});
    await prisma.contract.deleteMany({});

    await seedFinanceCoa(prisma);
    await ensureFinanceCompany();

    const journal = new JournalAutoService(prisma as any);
    const c = await seedStandard17k12m(prisma);
    contractId = c.id;
    await new ContractActivation1ATemplate(journal, prisma as any).execute(c.id);

    // Accrue installment #5 (sets accrualJournalEntryId → 2B_ONLY mode for preview)
    const sched5 = await prisma.installmentSchedule.findUniqueOrThrow({
      where: { contractId_installmentNo: { contractId: c.id, installmentNo: 5 } },
    });
    await new InstallmentAccrual2ATemplate(journal, prisma as any).execute(sched5.id);

    svc = new PaymentJournalPreviewService(prisma as any, undefined);
  });

  afterAll(async () => {
    await prisma.journalLine.deleteMany({});
    await prisma.journalEntry.deleteMany({});
    await prisma.payment.deleteMany({});
    await prisma.installmentSchedule.deleteMany({});
    await prisma.contract.deleteMany({});
    await prisma.$disconnect();
  });

  it('2B_ONLY: returns a posted 2A context block (=2,115.00) and a balanced live 2B block', async () => {
    const res = await svc.previewJournal({
      contractId,
      installmentNo: 5,
      amountReceived: 1515.83,
      depositAccountCode: '11-1201',
      lateFee: 0,
      case: 'NORMAL',
    });

    expect(res.accrualMode).toBe('2B_ONLY');

    // 2A context: posted, balanced at the standard accrual total 2,115.00
    expect(res.accrual2A, 'expected a posted 2A context block').toBeDefined();
    expect(res.accrual2A!.lines.length).toBeGreaterThan(0);
    expect(res.accrual2A!.lines.every((l) => l.block === '2A' && l.posted === true)).toBe(true);
    expect(res.subtotals['2A']?.balanced).toBe(true);
    expect(res.subtotals['2A']?.debit).toBe('2115.00');
    expect(res.subtotals['2A']?.credit).toBe('2115.00');

    // 2A must include the canonical accrual codes
    const a2aCodes = new Set(res.accrual2A!.lines.map((l) => l.accountCode));
    for (const code of ['11-2103', '21-2102', '11-2106', '11-2101', '11-2105', '41-1101', '21-2101']) {
      expect(a2aCodes.has(code), `2A block missing ${code}`).toBe(true);
    }

    // 2B live: unposted, balanced, clears 11-2103
    expect(res.lines.length).toBeGreaterThan(0);
    expect(res.lines.every((l) => l.block === '2B' && l.posted === false)).toBe(true);
    expect(res.subtotals['2B'].balanced).toBe(true);
    expect(res.lines.some((l) => l.accountCode === '11-2103' && Number(l.credit) > 0)).toBe(true);
  });
});
