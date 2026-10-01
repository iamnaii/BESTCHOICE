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
import { AccountingPeriodStatus, PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';
import { seedStandard17k12m } from '../../journal/__tests__/scenario-helpers';
import { JournalAutoService } from '../../journal/journal-auto.service';
import { ContractActivation1ATemplate } from '../../journal/cpa-templates/contract-activation-1a.template';
import { InstallmentAccrual2ATemplate } from '../../journal/cpa-templates/installment-accrual-2a.template';
import { PaymentReceiptTemplate } from '../../journal/cpa-templates/payment-receipt.template';
import { PaymentJournalPreviewService } from './payment-journal-preview.service';
import type { PrismaService } from '../../../prisma/prisma.service';

const prisma = new PrismaClient();

/** แถวงวดบัญชีของ FINANCE ที่เทสในไฟล์นี้เปิด พร้อมสถานะเดิม — afterAll คืนค่าใน finally */
const reopenedFinancePeriods: { id: string; status: AccountingPeriodStatus }[] = [];

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
  let schedule5Id: string;

  beforeAll(async () => {
    // JournalPostAuditLog rows (asset flows) FK-reference journal_entries — clear
    // them first or this deleteMany trips P2003 when an asset spec ran earlier.
    await prisma.journalPostAuditLog.deleteMany({});
    await prisma.journalLine.deleteMany({});
    await prisma.journalEntry.deleteMany({});
    await prisma.payment.deleteMany({});
    await prisma.installmentSchedule.deleteMany({});
    // T1-C7 guard: see cn-issue-on-writeoff.spec.ts (Phase 3 Task 3) — a
    // contract written off via the real writeOffBadDebt() has a permanent
    // (immutable) badDebtWriteOffAuditLog row FK-referencing it.
    const woPoisoned = await prisma.badDebtWriteOffAuditLog.findMany({ select: { contractId: true } });
    await prisma.contract.deleteMany({ where: { id: { notIn: woPoisoned.map((p) => p.contractId) } } });

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
    schedule5Id = sched5.id;
    await prisma.payment.create({
      data: {
        contractId, installmentNo: 5, dueDate: sched5.dueDate,
        amountDue: new Decimal('1515.83'), amountPaid: new Decimal(0),
      },
    });

    svc = new PaymentJournalPreviewService(prisma as any, undefined);
  });

  afterAll(async () => {
    try {
      // JournalPostAuditLog rows (asset flows) FK-reference journal_entries — clear
      // them first or this deleteMany trips P2003 when an asset spec ran earlier.
      await prisma.journalPostAuditLog.deleteMany({});
      await prisma.journalLine.deleteMany({});
      await prisma.journalEntry.deleteMany({});
      await prisma.payment.deleteMany({});
      await prisma.installmentSchedule.deleteMany({});
      // T1-C7 guard: see cn-issue-on-writeoff.spec.ts (Phase 3 Task 3) — a
      // contract written off via the real writeOffBadDebt() has a permanent
      // (immutable) badDebtWriteOffAuditLog row FK-referencing it.
      const woPoisoned = await prisma.badDebtWriteOffAuditLog.findMany({
        select: { contractId: true },
      });
      await prisma.contract.deleteMany({
        where: { id: { notIn: woPoisoned.map((p) => p.contractId) } },
      });
    } finally {
      try {
        // คืนสถานะเดิมของงวดบัญชี FINANCE ที่เทสเปิด (แตะเฉพาะแถวที่จำไว้)
        const rows = reopenedFinancePeriods.splice(0);
        for (const status of new Set(rows.map((r) => r.status))) {
          await prisma.accountingPeriod.updateMany({
            where: { id: { in: rows.filter((r) => r.status === status).map((r) => r.id) } },
            data: { status },
          });
        }
      } finally {
        await prisma.$disconnect();
      }
    }
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

  it('previews the same remaining 3,000 as posting after a 3,179 partial receipt', async () => {
    const fixture = await seedStandard17k12m(prisma);
    await prisma.contract.update({
      where: { id: fixture.id },
      data: {
        totalMonths: 10, financedAmount: new Decimal(29900),
        storeCommission: new Decimal(2990), interestTotal: new Decimal(23920),
        vatAmount: new Decimal('3976.70'), monthlyPayment: new Decimal(6079),
      },
    });
    const schedule = await prisma.installmentSchedule.update({
      where: { contractId_installmentNo: { contractId: fixture.id, installmentNo: 2 } },
      data: { principal: new Decimal(2990), interest: new Decimal(2392), amountDue: new Decimal(6079) },
    });
    const payment = await prisma.payment.create({
      data: {
        contractId: fixture.id, installmentNo: 2, dueDate: schedule.dueDate,
        amountDue: new Decimal(6079), amountPaid: new Decimal(3179),
        lateFee: new Decimal(100), status: 'PARTIALLY_PAID',
      },
    });
    const journal = new JournalAutoService(prisma as any);
    await new ContractActivation1ATemplate(journal, prisma as any).execute(fixture.id);
    await new InstallmentAccrual2ATemplate(journal, prisma as any).execute(schedule.id);
    const receipt = new PaymentReceiptTemplate(journal, prisma as any);
    await receipt.execute({
      installmentScheduleId: schedule.id, paymentId: payment.id,
      delta: new Decimal(3179), lateFee: new Decimal(100),
      debitAccountCode: '11-1101', isFinalReceipt: false,
    });
    const entriesBefore = await prisma.journalEntry.count();
    const result = await svc.previewJournal({
      contractId: fixture.id, installmentNo: 2, amountReceived: 3000,
      depositAccountCode: '11-1101', lateFee: 100, case: 'NORMAL',
    });
    expect(await prisma.journalEntry.count()).toBe(entriesBefore);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).amountPaid.toFixed(2)).toBe('3179.00');
    expect(result.isBalanced).toBe(true);
    expect(result.subtotals['2B']).toMatchObject({ debit: '3000.00', credit: '3000.00', balanced: true });
    expect(result.lines.find(l => l.accountCode === '42-1103')).toBeUndefined();
    expect(result.lines.find(l => l.accountCode === '11-2103')?.credit).toBe('2999.67');
    expect(result.lines.find(l => l.accountCode === '53-1503')?.credit).toBe('0.33');
    expect(result.accrual2A?.subtotal.balanced).toBe(true);

    const posted = await receipt.execute({
      installmentScheduleId: schedule.id, paymentId: payment.id,
      delta: new Decimal(3000), lateFee: new Decimal(100),
      debitAccountCode: '11-1101', isFinalReceipt: true,
    });
    const entry = await prisma.journalEntry.findUniqueOrThrow({
      where: { entryNumber: posted.entryNo }, include: { lines: true },
    });
    const postedLines = entry.lines.map(l => ({
      code: l.accountCode, debit: l.debit.toFixed(2), credit: l.credit.toFixed(2),
    })).sort((a, b) => a.code.localeCompare(b.code));
    expect(result.lines.map(l => ({ code: l.accountCode, debit: l.debit, credit: l.credit }))
      .sort((a, b) => a.code.localeCompare(b.code))).toEqual(postedLines);
  });

  /**
   * D2 (2026-09-28): งวดที่ยังไม่ตั้งลูกหนี้งวด — บรรทัด 2A ที่ preview แสดง (posted:false) ต้องเท่ากับ
   * รายการ 2A ที่ลงจริงเมื่อรับชำระ ทั้งบรรทัดและวันที่ (มาจากฟังก์ชันเดียวกันทั้งสองฝั่ง).
   */
  it('งวดยังไม่ตั้งลูกหนี้งวด: 2A และ 2B ใน preview ตรงกับที่ลงจริงทุกบรรทัด และวันที่ลง 2A ตรงกัน', async () => {
    const journal = new JournalAutoService(prisma as PrismaService);
    const paidDate = new Date().toISOString().slice(0, 10); // YYYY-MM-DD แบบที่หน้าจอส่ง
    // เทสเตรียมงวดบัญชีที่ตัวเองใช้เอง: เปิดงวดของ FINANCE (บริษัทที่ 2A ตรวจงวด) เดือนที่จะลงรายการ
    // (เดือนตามเวลาของเครื่อง แบบเดียวกับ validatePeriodOpen) — ไม่พึ่งว่าตารางงวดบัญชีของฐานทดสอบว่าง.
    // แตะเฉพาะงวดของ FINANCE และจำสถานะเดิมไว้ให้ afterAll คืนค่า
    const postingDay = new Date(paidDate);
    const finance = await prisma.companyInfo.findFirstOrThrow({
      where: { companyCode: 'FINANCE' },
    });
    const closedPeriods = await prisma.accountingPeriod.findMany({
      where: {
        companyId: finance.id,
        status: { in: ['CLOSED', 'SYNCED'] },
        year: postingDay.getFullYear(),
        month: postingDay.getMonth() + 1,
      },
      select: { id: true, status: true },
    });
    reopenedFinancePeriods.push(...closedPeriods);
    await prisma.accountingPeriod.updateMany({
      where: { id: { in: closedPeriods.map((period) => period.id) } },
      data: { status: 'OPEN' },
    });
    const sched7 = await prisma.installmentSchedule.findUniqueOrThrow({
      where: { contractId_installmentNo: { contractId, installmentNo: 7 } },
    });
    expect(sched7.accrualJournalEntryId).toBeNull();
    // งวด 7 ยังไม่ถึงกำหนด (90 วันข้างหน้า) — ลูกค้าจ่ายล่วงหน้าวันนี้
    const futureDue = new Date(Date.now() + 90 * 86_400_000);
    await prisma.installmentSchedule.update({ where: { id: sched7.id }, data: { dueDate: futureDue } });
    await prisma.payment.create({
      data: {
        contractId, installmentNo: 7, dueDate: futureDue,
        amountDue: new Decimal('1515.83'), amountPaid: new Decimal(0),
      },
    });

    const preview = await svc.previewJournal({
      contractId,
      installmentNo: 7,
      amountReceived: 1515.83,
      depositAccountCode: '11-1201',
      lateFee: 0,
      case: 'NORMAL',
      paidDate,
    });
    expect(preview.accrualMode).toBe('CONSOLIDATED_PAYING_AHEAD');
    expect(preview.accrualPostedAt).toBe(new Date(paidDate).toISOString());
    expect(preview.accrual2A!.lines.every((l) => l.block === '2A' && l.posted === false)).toBe(true);
    expect(preview.subtotals['2A']).toEqual({ debit: '2115.00', credit: '2115.00', balanced: true });

    const posted = await new PaymentReceiptTemplate(journal, prisma as PrismaService).execute({
      installmentScheduleId: sched7.id,
      delta: new Decimal('1515.83'),
      debitAccountCode: '11-1201',
      isFinalReceipt: true,
      postedAt: new Date(paidDate),
    });

    const key = (code: string, debit: string, credit: string) =>
      `${code}:${new Decimal(debit).toFixed(2)}:${new Decimal(credit).toFixed(2)}`;
    const after = await prisma.installmentSchedule.findUniqueOrThrow({ where: { id: sched7.id } });
    const accrualJe = await prisma.journalEntry.findUniqueOrThrow({
      where: { entryNumber: after.accrualJournalEntryId! },
      include: { lines: true },
    });
    expect(
      accrualJe.lines.map((l) => key(l.accountCode, l.debit.toString(), l.credit.toString())).sort(),
    ).toEqual(preview.accrual2A!.lines.map((l) => key(l.accountCode, l.debit, l.credit)).sort());
    expect(accrualJe.postedAt!.toISOString()).toBe(preview.accrualPostedAt);

    const receiptJe = await prisma.journalEntry.findUniqueOrThrow({
      where: { entryNumber: posted.entryNo },
      include: { lines: true },
    });
    expect(
      receiptJe.lines.map((l) => key(l.accountCode, l.debit.toString(), l.credit.toString())).sort(),
    ).toEqual(preview.lines.map((l) => key(l.accountCode, l.debit, l.credit)).sort());
  });

  /**
   * ก1 (คำตอบฝ่ายบัญชี 29/09/2569): รับบางส่วนก่อนวันครบกำหนด — บรรทัด 2A เท่ายอดที่รับที่ preview แสดง
   * ต้องเท่ากับรายการที่ลงจริงทั้งบรรทัดและวันที่ · ใบที่ทำให้งวดครบ: 2A ส่วนที่เหลือเท่ากันเช่นกัน
   */
  it('ก1: รับบางส่วน 1,000 แล้วรับส่วนที่เหลือ 515.83 ก่อนครบกำหนด — 2A ใน preview ตรงกับที่ลงจริงทั้งสองครั้ง', async () => {
    const journal = new JournalAutoService(prisma as PrismaService);
    const paidDate = new Date().toISOString().slice(0, 10);
    // งวดบัญชี FINANCE ของเดือนที่จะลงรายการต้องเปิด — แบบเดียวกับเทสข้างบน (จำสถานะเดิมให้ afterAll คืนค่า)
    const postingDay = new Date(paidDate);
    const finance = await prisma.companyInfo.findFirstOrThrow({ where: { companyCode: 'FINANCE' } });
    const closedPeriods = await prisma.accountingPeriod.findMany({
      where: {
        companyId: finance.id,
        status: { in: ['CLOSED', 'SYNCED'] },
        year: postingDay.getFullYear(),
        month: postingDay.getMonth() + 1,
      },
      select: { id: true, status: true },
    });
    reopenedFinancePeriods.push(...closedPeriods);
    await prisma.accountingPeriod.updateMany({
      where: { id: { in: closedPeriods.map((period) => period.id) } },
      data: { status: 'OPEN' },
    });
    const sched8 = await prisma.installmentSchedule.findUniqueOrThrow({
      where: { contractId_installmentNo: { contractId, installmentNo: 8 } },
    });
    const futureDue = new Date(Date.now() + 120 * 86_400_000);
    await prisma.installmentSchedule.update({ where: { id: sched8.id }, data: { dueDate: futureDue } });
    await prisma.payment.create({
      data: {
        contractId, installmentNo: 8, dueDate: futureDue,
        amountDue: new Decimal('1515.83'), amountPaid: new Decimal(0),
      },
    });
    const key = (code: string, debit: string, credit: string) =>
      `${code}:${new Decimal(debit).toFixed(2)}:${new Decimal(credit).toFixed(2)}`;
    const entryLines = async (entryNumber: string) =>
      (
        await prisma.journalEntry.findUniqueOrThrow({ where: { entryNumber }, include: { lines: true } })
      ).lines
        .map((l) => key(l.accountCode, l.debit.toString(), l.credit.toString()))
        .sort();
    const previewLines = (lines: { accountCode: string; debit: string; credit: string }[]) =>
      lines.map((l) => key(l.accountCode, l.debit, l.credit)).sort();
    const receipt = new PaymentReceiptTemplate(journal, prisma as PrismaService);

    // (1) ใบบางส่วน 1,000
    const partialPreview = await svc.previewJournal({
      contractId, installmentNo: 8, amountReceived: 1000, depositAccountCode: '11-1201',
      lateFee: 0, case: 'PARTIAL', paidDate,
    });
    expect(partialPreview.accrualPortion).toBe('PARTIAL');
    expect(partialPreview.subtotals['2A']).toEqual({ debit: '1395.27', credit: '1395.27', balanced: true });
    const first = await receipt.execute({
      installmentScheduleId: sched8.id, delta: new Decimal('1000'), debitAccountCode: '11-1201',
      isFinalReceipt: false, postedAt: new Date(paidDate),
    });
    expect(await entryLines(first.accrual!.entryNo)).toEqual(previewLines(partialPreview.accrual2A!.lines));
    expect(first.accrual!.postedAt.toISOString()).toBe(partialPreview.accrualPostedAt);
    expect(await entryLines(first.entryNo)).toEqual(previewLines(partialPreview.lines));
    // template ไม่แตะแถว Payment — จำลองสิ่งที่เส้นทางรับชำระเขียนให้ preview ครั้งถัดไปอ่านยอดที่ชำระแล้ว
    await prisma.payment.updateMany({
      where: { contractId, installmentNo: 8 },
      data: { amountPaid: new Decimal(1000), status: 'PARTIALLY_PAID' },
    });

    // (2) ใบที่ทำให้งวดครบ 515.83
    const settlePreview = await svc.previewJournal({
      contractId, installmentNo: 8, amountReceived: 515.83, depositAccountCode: '11-1201',
      lateFee: 0, case: 'NORMAL', paidDate,
    });
    expect(settlePreview.accrualPortion).toBe('REMAINDER');
    expect(settlePreview.accruedBefore).toBe('1000.00');
    const second = await receipt.execute({
      installmentScheduleId: sched8.id, delta: new Decimal('515.83'), debitAccountCode: '11-1201',
      isFinalReceipt: true, postedAt: new Date(paidDate),
    });
    expect(await entryLines(second.accrual!.entryNo)).toEqual(previewLines(settlePreview.accrual2A!.lines));
    expect(await entryLines(second.entryNo)).toEqual(previewLines(settlePreview.lines));
    const after = await prisma.installmentSchedule.findUniqueOrThrow({ where: { id: sched8.id } });
    expect(after.accrualJournalEntryId).toBe(second.accrual!.entryNo);
    expect(after.accruedAmount.toFixed(2)).toBe('1515.83');
  });

  // Critical #1 (code-review): a VOIDED accrual (status=VOIDED, deletedAt still null)
  // must NOT be shown as posted 2A context. Run last — it mutates shared state.
  it('excludes a VOIDED accrual from the 2A context (status:POSTED filter)', async () => {
    const sched = await prisma.installmentSchedule.findUniqueOrThrow({ where: { id: schedule5Id } });
    await prisma.journalEntry.updateMany({
      where: { entryNumber: sched.accrualJournalEntryId! },
      data: { status: 'VOIDED' },
    });

    const res = await svc.previewJournal({
      contractId,
      installmentNo: 5,
      amountReceived: 1515.83,
      depositAccountCode: '11-1201',
      lateFee: 0,
      case: 'NORMAL',
    });

    expect(res.accrual2A, 'voided accrual must not appear as 2A context').toBeUndefined();
    expect(res.subtotals['2A']).toBeUndefined();
  });
});
