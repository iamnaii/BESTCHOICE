/**
 * รอบกวาดเงินพักส่วนเกิน → รายได้ 42-1106 (PR4 ต6/ต6ข) — integration บนฐานจริง (vitest · jest ignore journal/cron).
 * Run: cd apps/api && npx vitest run --no-file-parallelism src/modules/journal/cron/advance-excess-income.cron.spec.ts
 *
 * สายหลัก (แผน Task 4): ปรับดิว 6a สองครั้ง → ผ่อนครบทางรอบกลางคืน (2A งวด 12 หักเงินพัก) → รอบกวาด → 42-1106 ·
 * 21-1103 = 0 · ภาษีที่ยังค้าง = 0 · คอลัมน์ 0 · งาน 1 ใบ · รันซ้ำไม่ลงซ้ำ · void หลังลง → ปฏิเสธ (ด่าน ต6ข ทั้งสองจุด).
 * ตัวเลขจริงของสาย (เลื่อน 30 วัน ×2 — 1,419.00 ของ G6 ไม่ใช่ค่าธรรมเนียมของจำนวนวันเต็ม ⇒ G6 ปักที่ jest golden):
 *   ค่าธรรมเนียม = 1,515.84/30 × 30 ปัดขึ้นเป็นบาทเต็ม (RescheduleService) = 1,516.00 ต่อครั้ง · ภาษีพัก
 *   HALF_UP(1,516 × 7/107) = 99.18 ×2 = 198.36 · งวด 12 หัก 1,515.84 (แถว Payment amountDue = monthlyPayment) ขากลับ
 *   HALF_UP = 99.17 (ถังยังเหลือ 1,516.16) ⇒ ภาษียังค้าง 99.19 · รอบกวาด: Dr 21-1103 1,516.16 / Cr 42-1106 1,416.97 /
 *   Cr 21-2102 99.19 (ภาษีที่ยังค้างทั้งก้อน — ถังหมด; ไม่ใช่ HALF_UP(1,516.16 × 7/107) = 99.19 โดยบังเอิญเท่ากัน)
 * เคสคัดเลือก: COMPLETED (ทาง QR) · EARLY_PAYOFF ถังเกินยอดปิด (G9) · 21-5101 ค้าง (ต4) · คำขอ void ค้างคิว → ข้าม ·
 * TERMINATED → ไม่แตะ · สัญญาที่ยังมีงวดค้าง → ไม่แตะ · คอลัมน์ > 0 บัญชี = 0 → งานแจ้ง ไม่ลงรายการ (dedup)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';
import { seedStandard17k12m } from '../__tests__/scenario-helpers';
import { JournalAutoService } from '../journal-auto.service';
import { CompanyResolverService } from '../company-resolver.service';
import { ContractActivation1ATemplate } from '../cpa-templates/contract-activation-1a.template';
import { InstallmentAccrual2ATemplate } from '../cpa-templates/installment-accrual-2a.template';
import { ReceiptVoidReversalTemplate } from '../cpa-templates/receipt-void-reversal.template';
import { AdvanceExcessIncomeTemplate } from '../cpa-templates/advance-excess-income.template';
import { AdvanceExcessIncomeCron } from './advance-excess-income.cron';
import { RescheduleCollectService } from '../../payments/services/reschedule-collect.service';
import { RescheduleService } from '../../installments/reschedule.service';
import { ReceiptsService } from '../../receipts/receipts.service';
import { paymentApprovalSnapshot } from '../../payments/services/payment-approval-request.util';
import { RESIDUAL_PARK_TODO_TAG } from '../../payments/services/payment-helpers';
import { glContractBalance } from '../gl-contract-balance';
import { ADVANCE_VAT_META, advanceVatOutstanding } from '../advance-vat';
import {
  ADVANCE_EXCESS_INCOME_FLOW,
  ADVANCE_EXCESS_VOID_BLOCKED_MESSAGE,
  assertNoAdvanceExcessIncome,
} from '../advance-excess-income.util';

const prisma = new PrismaClient();
const D = (n: string | number) => new Decimal(n);

const LATE_FEE_KEYS = [
  ['late_fee_tier1_amount', '50'],
  ['late_fee_tier2_amount', '100'],
  ['late_fee_tier2_min_days', '3'],
] as const;

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

/** JournalAutoService.resolveSystemUserId + audit/Todo fallback ต้องการ admin@bestchoice.com */
async function ensureSystemAdminUser(): Promise<string> {
  const existing = await prisma.user.findFirst({ where: { email: 'admin@bestchoice.com' } });
  if (existing) return existing.id;
  const created = await prisma.user.create({
    data: {
      email: 'admin@bestchoice.com',
      password: 'hashed_placeholder',
      name: 'System Admin',
      role: 'OWNER',
    },
  });
  return created.id;
}

async function cleanup(): Promise<void> {
  await prisma.journalPostAuditLog.deleteMany({});
  await prisma.journalLine.deleteMany({});
  await prisma.journalEntry.deleteMany({});
  await prisma.paymentApprovalRequest.deleteMany({});
  await prisma.receipt.deleteMany({});
  await prisma.payment.deleteMany({});
  await prisma.installmentSchedule.deleteMany({});
  await prisma.todo.deleteMany({ where: { tags: { has: RESIDUAL_PARK_TODO_TAG } } });
  const woPoisoned = await prisma.badDebtWriteOffAuditLog.findMany({
    select: { contractId: true },
  });
  await prisma.contract.deleteMany({
    where: { id: { notIn: woPoisoned.map((p) => p.contractId) } },
  });
}

type Line = { accountCode: string; dr: string; cr: string };
type JeShape = { lines: { accountCode: string; debit: unknown; credit: unknown }[] };
const tuples = (je: JeShape): Line[] =>
  je.lines.map((l) => ({
    accountCode: l.accountCode,
    dr: new Decimal(String(l.debit)).toFixed(2),
    cr: new Decimal(String(l.credit)).toFixed(2),
  }));

describe('AdvanceExcessIncomeCron — รอบกวาดเงินพักส่วนเกิน → 42-1106 (PR4 ต6/ต6ข)', () => {
  let journal: JournalAutoService;
  let cron: AdvanceExcessIncomeCron;
  let adminId: string;

  const sweepEntries = (contractId: string) =>
    prisma.journalEntry.findMany({
      where: {
        AND: [
          { metadata: { path: ['flow'], equals: ADVANCE_EXCESS_INCOME_FLOW } } as any,
          { metadata: { path: ['contractId'], equals: contractId } } as any,
        ],
        deletedAt: null,
      },
      include: { lines: true },
    });

  /** รายการจำลองที่ประทับ contractId + stamp ภาษี (ย่อเส้นทางรับเงิน/ปิดสัญญาที่ Task 2/3ข ปักไว้แล้ว) */
  const postSynthetic = (
    contractId: string,
    lines: Array<[string, string, string]>,
    extra: Record<string, string> = {},
  ) =>
    journal.createAndPost({
      description: `synthetic ${contractId}`,
      metadata: { contractId, tag: 'synthetic', ...extra },
      lines: lines.map(([accountCode, dr, cr]) => ({ accountCode, dr: D(dr), cr: D(cr) })),
    });

  const paidRow = (contractId: string, installmentNo: number, dueDate: Date) => ({
    contractId,
    installmentNo,
    dueDate,
    amountDue: D('1515.84'),
    amountPaid: D('1515.84'),
    status: 'PAID' as const,
    paidDate: new Date(),
  });

  beforeAll(async () => {
    await cleanup();
    await seedFinanceCoa(prisma);
    await ensureFinanceCompany();
    adminId = await ensureSystemAdminUser();
    for (const [key, value] of LATE_FEE_KEYS) {
      await prisma.systemConfig.upsert({
        where: { key },
        update: { value },
        create: { key, value },
      });
    }
    journal = new JournalAutoService(prisma as any);
    cron = new AdvanceExcessIncomeCron(
      prisma as any,
      new AdvanceExcessIncomeTemplate(
        journal,
        prisma as any,
        new CompanyResolverService(prisma as any),
      ),
    );
  });

  afterAll(async () => {
    await cleanup();
    await prisma.systemConfig.deleteMany({ where: { key: { in: LATE_FEE_KEYS.map(([k]) => k) } } });
    await prisma.$disconnect();
  });

  it('สายหลัก: ปรับดิว 6a ×2 → งวด 12 หักเงินพักทางรอบกลางคืน → รอบกวาดลง 42-1106 · 21-1103 = 0 · ภาษีค้าง 0 · คอลัมน์ 0 · งาน 1 ใบ · รันซ้ำไม่ลงซ้ำ · void ถูกปฏิเสธ', async () => {
    const c = await seedStandard17k12m(prisma);
    await new ContractActivation1ATemplate(journal, prisma as any).execute(c.id);
    const contractRow = await prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
    const sched1 = await prisma.installmentSchedule.findUniqueOrThrow({
      where: { contractId_installmentNo: { contractId: c.id, installmentNo: 1 } },
    });
    const recordedById = (
      await prisma.user.findFirstOrThrow({
        where: { email: 'test-salesperson@bestchoice-test.internal' },
      })
    ).id;
    const payment1 = await prisma.payment.create({
      data: {
        contractId: c.id,
        installmentNo: 1,
        dueDate: sched1.dueDate,
        amountDue: D('1515.84'),
        status: 'OVERDUE',
      },
    });
    const service = new RescheduleCollectService(
      prisma as any,
      journal,
      new RescheduleService(prisma as any),
      new ReceiptsService(
        prisma as any,
        journal,
        new ReceiptVoidReversalTemplate(journal, prisma as any),
        undefined,
      ),
    );

    // ปรับดิว 6a สองครั้ง เลื่อน 30 วัน (ค่าธรรมเนียม 1,515.84 ต่อครั้ง = หนึ่งงวดพอดี ⇒ ถังพักใหญ่กว่าหนึ่งงวด)
    for (let round = 1; round <= 2; round++) {
      const q = await service.quote({
        contractId: c.id,
        installmentNo: 1,
        daysToShift: 30,
        splitMode: 'SPLIT',
      });
      expect(q.rescheduleFee).toBe('1516.00');
      const r = await service.executeWithCollect({
        contractId: c.id,
        installmentNo: 1,
        daysToShift: 30,
        splitMode: 'SPLIT',
        amount: Number(q.collectAmount),
        paymentMethod: 'CASH',
        recordedById,
      });
      expect(r.variant).toBe('6a');
      expect(r.rescheduleFee).toBe('1516.00');
    }
    expect((await glContractBalance(prisma as any, c.id, '21-1103', 'cr')).toFixed(2)).toBe(
      '3032.00',
    );
    expect((await advanceVatOutstanding(prisma as any, c.id)).toFixed(2)).toBe('198.36');
    const afterPark = await prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
    expect(afterPark.rescheduleAdvanceBalance.toFixed(2)).toBe('3032.00');

    // งวด 1–11 ชำระครบ (แถวข้อมูล — เส้นทางรับชำระปักไว้แล้วที่ Task 3) · งวด 12 ยังค้าง รอรอบกลางคืน
    await prisma.payment.update({
      where: { id: payment1.id },
      data: { status: 'PAID', amountPaid: D('1515.84'), paidDate: new Date() },
    });
    const schedules = await prisma.installmentSchedule.findMany({
      where: { contractId: c.id },
      orderBy: { installmentNo: 'asc' },
    });
    await prisma.payment.createMany({
      data: schedules
        .filter((s) => s.installmentNo >= 2 && s.installmentNo <= 11)
        .map((s) => paidRow(c.id, s.installmentNo, s.dueDate)),
    });
    const sched12 = schedules.find((s) => s.installmentNo === 12)!;
    const payment12 = await prisma.payment.create({
      data: {
        contractId: c.id,
        installmentNo: 12,
        dueDate: sched12.dueDate,
        amountDue: D('1515.84'),
        status: 'PENDING',
      },
    });

    // ยังมีงวดค้าง → รอบกวาดต้องไม่แตะ
    const pre = await cron.tick();
    expect(pre.posted).toBe(0);
    expect(await sweepEntries(c.id)).toHaveLength(0);

    // รอบกลางคืนตั้งลูกหนี้งวด 12 + หักเงินพัก 1,515.84 (ขากลับ 99.17 — Task 3) ⇒ ทุกงวด PAID แต่สถานะสัญญายัง ACTIVE
    const accrued = await new InstallmentAccrual2ATemplate(journal, prisma as any).execute(
      sched12.id,
    );
    expect(accrued).not.toBeNull();
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment12.id } })).status).toBe(
      'PAID',
    );
    expect((await prisma.contract.findUniqueOrThrow({ where: { id: c.id } })).status).toBe(
      'ACTIVE',
    );
    expect((await glContractBalance(prisma as any, c.id, '21-1103', 'cr')).toFixed(2)).toBe(
      '1516.16',
    );
    expect((await advanceVatOutstanding(prisma as any, c.id)).toFixed(2)).toBe('99.19');
    const vat2102Before = await glContractBalance(prisma as any, c.id, '21-2102', 'cr');

    // รอบกวาด
    const r1 = await cron.tick();
    expect(r1.posted).toBe(1);
    expect(r1.failed).toBe(0);
    expect(r1.todosCreated).toBe(1);
    const entries = await sweepEntries(c.id);
    expect(entries).toHaveLength(1);
    expect(tuples(entries[0])).toEqual([
      { accountCode: '21-1103', dr: '1516.16', cr: '0.00' },
      { accountCode: '42-1106', dr: '0.00', cr: '1416.97' },
      { accountCode: '21-2102', dr: '0.00', cr: '99.19' },
    ]);
    const meta = entries[0].metadata as Record<string, unknown>;
    expect(meta.idempotencyKey).toBe(`advance-excess-income:${c.id}`);
    expect(meta[ADVANCE_VAT_META.consume]).toBe('99.19');
    expect(meta.contractNumber).toBe(contractRow.contractNumber);
    expect(entries[0].status).toBe('POSTED');

    expect((await glContractBalance(prisma as any, c.id, '21-1103', 'cr')).toFixed(2)).toBe('0.00');
    expect((await glContractBalance(prisma as any, c.id, '42-1106', 'cr')).toFixed(2)).toBe(
      '1416.97',
    );
    expect(
      (await glContractBalance(prisma as any, c.id, '21-2102', 'cr'))
        .minus(vat2102Before)
        .toFixed(2),
    ).toBe('99.19');
    expect((await advanceVatOutstanding(prisma as any, c.id)).toFixed(2)).toBe('0.00');
    const after = await prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
    expect(after.advanceBalance.toFixed(2)).toBe('0.00');
    expect(after.rescheduleAdvanceBalance.toFixed(2)).toBe('0.00');

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'ADVANCE_EXCESS_RECOGNIZED', entity: 'contract', entityId: c.id },
    });
    expect(audit).not.toBeNull();
    expect((audit!.newValue as Record<string, unknown>).entryNumber).toBe(entries[0].entryNumber);
    // ผู้เขียน audit = ผู้ใช้ SYSTEM ถ้ามีในฐาน (spec อื่นอาจสร้างไว้) ไม่งั้น admin@bestchoice.com
    const auditUser = await prisma.user.findUniqueOrThrow({ where: { id: audit!.userId } });
    expect(auditUser.isSystemUser || auditUser.id === adminId).toBe(true);
    const todos = await prisma.todo.findMany({
      where: {
        tags: { has: RESIDUAL_PARK_TODO_TAG },
        title: { contains: contractRow.contractNumber },
      },
    });
    expect(todos).toHaveLength(1);
    expect(todos[0].title).toContain('1516.16');
    expect(todos[0].priority).toBe('MEDIUM');

    // รันซ้ำ — บัญชีและคอลัมน์เป็น 0 แล้ว สัญญาไม่เข้าเกณฑ์อีก ไม่ลงซ้ำ ไม่สร้างงานซ้ำ
    const r2 = await cron.tick();
    expect(r2.posted).toBe(0);
    expect(await sweepEntries(c.id)).toHaveLength(1);
    expect(
      await prisma.todo.count({
        where: {
          tags: { has: RESIDUAL_PARK_TODO_TAG },
          title: { contains: contractRow.contractNumber },
        },
      }),
    ).toBe(1);

    // ด่าน ต6ข — ทั้งจุดยกเลิกใบเสร็จ (assert ที่ service เรียก) และจุดสร้างคำขออนุมัติ
    await expect(assertNoAdvanceExcessIncome(prisma as any, c.id)).rejects.toThrow(
      ADVANCE_EXCESS_VOID_BLOCKED_MESSAGE,
    );
    const feeReceipt = await prisma.receipt.findFirstOrThrow({
      where: { contractId: c.id, receiptType: 'RESCHEDULE_FEE', deletedAt: null },
    });
    await expect(
      paymentApprovalSnapshot(prisma as any, 'VOID_RECEIPT', feeReceipt.id),
    ).rejects.toThrow(ADVANCE_EXCESS_VOID_BLOCKED_MESSAGE);
  });

  it('คัดเลือกสัญญา: COMPLETED (QR) · EARLY_PAYOFF G9 · 21-5101 ค้าง (22.2 กวาดด้วย) · เฉพาะ 21-5101 (X2) · คำขอ void ค้างคิว → ข้าม · TERMINATED / ยังมีงวดค้าง → ไม่แตะ · คอลัมน์ > 0 บัญชี 0 → งานแจ้งไม่ลงรายการ', async () => {
    // B — ปิดสัญญาทางลิงก์ชำระ (COMPLETED โดยไม่ผ่าน checkContractCompletion) เงินเกิน 700 พักไว้พร้อมภาษี 45.79
    const B = await seedStandard17k12m(prisma);
    await prisma.contract.update({
      where: { id: B.id },
      data: { status: 'COMPLETED', advanceBalance: D('700') },
    });
    await postSynthetic(
      B.id,
      [
        ['11-1201', '700.00', '0'],
        ['21-1103', '0', '700.00'],
        ['21-2102', '45.79', '0'],
        ['21-2101', '0', '45.79'],
      ],
      { [ADVANCE_VAT_META.park]: '45.79' },
    );

    // G — G9: ถังพัก 2,000 (ภาษี 130.84) ยอดปิดหักได้ 1,500 (ขากลับ 98.13 · ขาล้าง GL + outstanding) ⇒ 21-2102 = −32.71
    const G = await seedStandard17k12m(prisma);
    await prisma.contract.update({
      where: { id: G.id },
      data: { status: 'EARLY_PAYOFF', rescheduleAdvanceBalance: D('500') },
    });
    await postSynthetic(G.id, [
      ['11-2105', '1190.00', '0'],
      ['21-2102', '0', '1190.00'],
    ]);
    await postSynthetic(
      G.id,
      [
        ['11-1201', '2000.00', '0'],
        ['21-1103', '0', '2000.00'],
        ['21-2102', '130.84', '0'],
        ['21-2101', '0', '130.84'],
      ],
      { [ADVANCE_VAT_META.park]: '130.84' },
    );
    await postSynthetic(
      G.id,
      [
        ['21-1103', '1500.00', '0'],
        ['11-2101', '0', '1500.00'],
        ['21-2102', '1190.00', '0'],
        ['21-2101', '0', '1190.00'],
        ['21-2101', '98.13', '0'],
        ['21-2102', '0', '98.13'],
      ],
      { [ADVANCE_VAT_META.consume]: '98.13' },
    );
    expect((await glContractBalance(prisma as any, G.id, '21-2102', 'cr')).toFixed(2)).toBe(
      '-32.71',
    );

    // D — 22.2: 21-1103 500 + เครดิต 21-5101 300 (ภาษีพักรวม 52.34) → กวาดทั้งสองบัญชีในรายการเดียว ภาษีค้างทั้งก้อน
    const Dc = await seedStandard17k12m(prisma);
    await prisma.contract.update({
      where: { id: Dc.id },
      data: { status: 'COMPLETED', advanceBalance: D('500'), creditBalance: D('300') },
    });
    await postSynthetic(
      Dc.id,
      [
        ['11-1201', '800.00', '0'],
        ['21-1103', '0', '500.00'],
        ['21-5101', '0', '300.00'],
        ['21-2102', '52.34', '0'],
        ['21-2101', '0', '52.34'],
      ],
      { [ADVANCE_VAT_META.park]: '52.34' },
    );

    // K — X2: ลิงก์ชำระปิดสัญญาเองเป็น EARLY_PAYOFF ตั้ง creditBalance 0 โดยไม่มีรายการ ⇒ 21-5101 2,000 ค้างในบัญชีอย่างเดียว
    // (21-1103 = 0 · คอลัมน์ทั้งสาม 0) → ต้องถูกเลือกจากบัญชี 21-5101 และกวาดเป็นรายได้ + columnsMismatch
    const K = await seedStandard17k12m(prisma);
    await prisma.contract.update({ where: { id: K.id }, data: { status: 'EARLY_PAYOFF' } });
    await postSynthetic(
      K.id,
      [
        ['11-1201', '2000.00', '0'],
        ['21-5101', '0', '2000.00'],
        ['21-2102', '130.84', '0'],
        ['21-2101', '0', '130.84'],
      ],
      { [ADVANCE_VAT_META.park]: '130.84' },
    );
    const kNumber = (await prisma.contract.findUniqueOrThrow({ where: { id: K.id } }))
      .contractNumber;

    // E — มีคำขอยกเลิกใบเสร็จค้างคิว → ข้ามจนกว่าคำขอจะถูกพิจารณา
    const E = await seedStandard17k12m(prisma);
    await prisma.contract.update({
      where: { id: E.id },
      data: { status: 'COMPLETED', advanceBalance: D('200') },
    });
    await postSynthetic(
      E.id,
      [
        ['11-1201', '200.00', '0'],
        ['21-1103', '0', '200.00'],
        ['21-2102', '13.08', '0'],
        ['21-2101', '0', '13.08'],
      ],
      { [ADVANCE_VAT_META.park]: '13.08' },
    );
    const pendingVoid = await prisma.paymentApprovalRequest.create({
      data: {
        action: 'VOID_RECEIPT',
        targetId: 'receipt-x',
        contractId: E.id,
        requestedById: adminId,
        requiredPermissions: ['VOID_RECEIPT'],
        payload: {},
        reviewSummary: {},
        snapshot: {},
        reason: 'ทดสอบคำขอค้างคิว',
        status: 'PENDING',
      },
    });

    // T — บอกเลิกสัญญาแล้ว (JP5/ตัดหนี้สูญจะล้าง 21-1103 เอง) → รอบกวาดไม่แตะ
    const T = await seedStandard17k12m(prisma);
    await prisma.contract.update({
      where: { id: T.id },
      data: { status: 'TERMINATED', advanceBalance: D('400') },
    });
    await postSynthetic(
      T.id,
      [
        ['11-1201', '400.00', '0'],
        ['21-1103', '0', '400.00'],
      ],
      { [ADVANCE_VAT_META.park]: '26.17' },
    );

    // X — ยังผ่อนอยู่ (มีงวดค้าง) แม้ 21-1103 มียอด → ไม่แตะ
    const X = await seedStandard17k12m(prisma);
    await prisma.contract.update({ where: { id: X.id }, data: { advanceBalance: D('300') } });
    await postSynthetic(X.id, [
      ['11-1201', '300.00', '0'],
      ['21-1103', '0', '300.00'],
    ]);
    const xSched = await prisma.installmentSchedule.findMany({
      where: { contractId: X.id },
      orderBy: { installmentNo: 'asc' },
    });
    await prisma.payment.createMany({
      data: [
        paidRow(X.id, 1, xSched[0].dueDate),
        {
          contractId: X.id,
          installmentNo: 2,
          dueDate: xSched[1].dueDate,
          amountDue: D('1515.84'),
          status: 'PENDING' as const,
        },
      ],
    });

    // F — ทุกงวด PAID คอลัมน์ถังพัก 100 แต่ไม่มีอะไรในบัญชี → งานแจ้ง ไม่ลงรายการ
    const F = await seedStandard17k12m(prisma);
    await prisma.contract.update({
      where: { id: F.id },
      data: { rescheduleAdvanceBalance: D('100') },
    });
    const fSched = await prisma.installmentSchedule.findMany({
      where: { contractId: F.id },
      orderBy: { installmentNo: 'asc' },
    });
    await prisma.payment.createMany({
      data: fSched.map((s) => paidRow(F.id, s.installmentNo, s.dueDate)),
    });
    const fNumber = (await prisma.contract.findUniqueOrThrow({ where: { id: F.id } }))
      .contractNumber;

    const r1 = await cron.tick();
    expect(r1.failed).toBe(0);
    expect(r1.posted).toBe(4); // B · G · D · K
    expect(r1.skippedPendingVoid).toBe(1); // E
    expect(r1.columnsOnly).toBe(1); // F

    const [bEntries, gEntries, dEntries, kEntries, eEntries, tEntries, xEntries, fEntries] =
      await Promise.all(
        [B.id, G.id, Dc.id, K.id, E.id, T.id, X.id, F.id].map((id) => sweepEntries(id)),
      );
    expect(tuples(bEntries[0])).toEqual([
      { accountCode: '21-1103', dr: '700.00', cr: '0.00' },
      { accountCode: '42-1106', dr: '0.00', cr: '654.21' },
      { accountCode: '21-2102', dr: '0.00', cr: '45.79' },
    ]);
    expect(tuples(gEntries[0])).toEqual([
      { accountCode: '21-1103', dr: '500.00', cr: '0.00' },
      { accountCode: '42-1106', dr: '0.00', cr: '467.29' },
      { accountCode: '21-2102', dr: '0.00', cr: '32.71' },
    ]);
    // G9: 21-2102 ของสัญญากลับเป็น 0 หลังรอบกวาด (ล้างส่วน −(p − r) ที่ JP4 ทิ้งไว้)
    expect((await glContractBalance(prisma as any, G.id, '21-2102', 'cr')).toFixed(2)).toBe('0.00');
    expect(tuples(dEntries[0])).toEqual([
      { accountCode: '21-1103', dr: '500.00', cr: '0.00' },
      { accountCode: '21-5101', dr: '300.00', cr: '0.00' },
      { accountCode: '42-1106', dr: '0.00', cr: '747.66' },
      { accountCode: '21-2102', dr: '0.00', cr: '52.34' },
    ]);
    // 22.2: เครดิต 21-5101 ถูกกวาดพร้อมเงินพัก ⇒ ภาษีค้าง 0 · 21-5101 = 0 · creditBalance = 0
    expect((await advanceVatOutstanding(prisma as any, Dc.id)).toFixed(2)).toBe('0.00');
    expect((await glContractBalance(prisma as any, Dc.id, '21-5101', 'cr')).toFixed(2)).toBe(
      '0.00',
    );
    const dAfter = await prisma.contract.findUniqueOrThrow({ where: { id: Dc.id } });
    expect(dAfter.creditBalance.toFixed(2)).toBe('0.00');
    expect(dAfter.advanceBalance.toFixed(2)).toBe('0.00');
    // X2: เลือกจากบัญชี 21-5101 ทั้งที่คอลัมน์ทั้งสามเป็น 0 → กวาดเป็นรายได้ + columnsMismatch
    expect(tuples(kEntries[0])).toEqual([
      { accountCode: '21-5101', dr: '2000.00', cr: '0.00' },
      { accountCode: '42-1106', dr: '0.00', cr: '1869.16' },
      { accountCode: '21-2102', dr: '0.00', cr: '130.84' },
    ]);
    expect((kEntries[0].metadata as Record<string, unknown>).columnsMismatch).toBe(true);
    expect((await glContractBalance(prisma as any, K.id, '21-5101', 'cr')).toFixed(2)).toBe(
      '0.00',
    );
    expect((await advanceVatOutstanding(prisma as any, K.id)).toFixed(2)).toBe('0.00');
    const kTodos = await prisma.todo.findMany({
      where: { tags: { has: RESIDUAL_PARK_TODO_TAG }, title: { contains: kNumber } },
    });
    expect(kTodos).toHaveLength(1);
    expect(kTodos[0].description).toContain('Dr 21-5101 2000.00');
    expect(eEntries).toHaveLength(0);
    expect(tEntries).toHaveLength(0);
    expect(xEntries).toHaveLength(0);
    expect(fEntries).toHaveLength(0);
    expect((await glContractBalance(prisma as any, T.id, '21-1103', 'cr')).toFixed(2)).toBe(
      '400.00',
    );
    const fTodos = await prisma.todo.findMany({
      where: { tags: { has: RESIDUAL_PARK_TODO_TAG }, title: { contains: fNumber } },
    });
    expect(fTodos).toHaveLength(1);
    expect(fTodos[0].title).toContain('ตรวจสอบ');
    expect(
      (
        await prisma.contract.findUniqueOrThrow({ where: { id: F.id } })
      ).rescheduleAdvanceBalance.toFixed(2),
    ).toBe('100.00');

    // รอบถัดไป: E ยังค้างคิว → ยังข้าม · F ยังคอลัมน์ > 0 แต่ไม่สร้างงานซ้ำ
    const r2 = await cron.tick();
    expect(r2.posted).toBe(0);
    expect(r2.skippedPendingVoid).toBe(1);
    expect(r2.columnsOnly).toBe(1);
    expect(r2.todosCreated).toBe(0);
    expect(await sweepEntries(E.id)).toHaveLength(0);

    // คำขอถูกพิจารณา (ไม่ว่าทางใด) → รอบถัดไปกวาด E
    await prisma.paymentApprovalRequest.update({
      where: { id: pendingVoid.id },
      data: { status: 'REJECTED' },
    });
    const r3 = await cron.tick();
    expect(r3.posted).toBe(1);
    expect(r3.skippedPendingVoid).toBe(0);
    expect(tuples((await sweepEntries(E.id))[0])).toEqual([
      { accountCode: '21-1103', dr: '200.00', cr: '0.00' },
      { accountCode: '42-1106', dr: '0.00', cr: '186.92' },
      { accountCode: '21-2102', dr: '0.00', cr: '13.08' },
    ]);
  });
});
