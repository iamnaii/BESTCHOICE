import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import * as excess from '../journal/advance-excess-income.util';
import {
  buildCreditInLines,
  buildCreditOutLines,
  DEFECT_EXCHANGE_REDIRECT,
  EXCHANGE_BLOCK_EARLY_PAYOFF,
  EXCHANGE_BLOCK_EXCESS_INCOME,
  EXCHANGE_BLOCK_ORPHAN_CN,
  EXCHANGE_BLOCK_PENDING_VOID,
  EXCHANGE_BLOCK_RESCHEDULED,
  EXCHANGE_SKIPPED_RECEIPT_TYPES,
  exchangeMoneyBlockers,
  hasRescheduleHistory,
  listReceiptsToCreditNote,
  sumReceiptAmounts,
} from './defect-exchange-credit';

const D = (n: string | number) => new Decimal(n);
const fmt = (l: { accountCode: string; dr: Decimal; cr: Decimal }) => `${l.accountCode}:${l.dr.toFixed(2)}:${l.cr.toFixed(2)}`;

describe('บรรทัด JE ของการย้ายเครดิต (spec §3 ข/ง)', () => {
  it('ข: Dr 21-1103 a · Dr 21-5101 c · Dr 21-2101 p / Cr 21-1106 a+c · Cr 21-2102 p — บรรทัด 0 ไม่ออก', () => {
    expect(buildCreditOutLines(D(500), D(300), D('52.34')).map(fmt)).toEqual([
      '21-1103:500.00:0.00',
      '21-5101:300.00:0.00',
      '21-2101:52.34:0.00',
      '21-1106:0.00:800.00',
      '21-2102:0.00:52.34',
    ]);
    expect(buildCreditOutLines(D(0), D(300), D(0)).map(fmt)).toEqual(['21-5101:300.00:0.00', '21-1106:0.00:300.00']);
    expect(buildCreditOutLines(D(0), D(0), D(0))).toEqual([]);
  });

  it('ง: Dr 21-1106 T / Cr 21-5101 T — T ≤ 0 ไม่มีบรรทัด', () => {
    expect(buildCreditInLines(D('1515.83')).map(fmt)).toEqual(['21-1106:1515.83:0.00', '21-5101:0.00:1515.83']);
    expect(buildCreditInLines(D(0))).toEqual([]);
  });

  it('redirect ของขั้น ก: เงินสด/ธนาคาร → 21-1106', () => {
    expect(DEFECT_EXCHANGE_REDIRECT).toEqual({
      accountPrefixes: ['11-11', '11-12'],
      to: '21-1106',
      description: 'โอนเป็นเครดิตเปลี่ยนเครื่อง',
    });
  });
});

describe('เลือกใบที่ต้องออกใบลดหนี้', () => {
  it('exclude-list: CREDIT_NOTE / EARLY_PAYOFF / RESCHEDULE_FEE / DOWN_PAYMENT ไม่ถูกเลือก · เรียง paidDate แล้ว receiptNumber', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    await listReceiptsToCreditNote({ receipt: { findMany } } as never, 'ct-old');
    expect(findMany).toHaveBeenCalledWith({
      where: {
        contractId: 'ct-old',
        isVoided: false,
        deletedAt: null,
        receiptType: { notIn: [...EXCHANGE_SKIPPED_RECEIPT_TYPES] },
      },
      orderBy: [{ paidDate: 'asc' }, { receiptNumber: 'asc' }],
      select: expect.objectContaining({ id: true, receiptNumber: true, amount: true, vatAmount: true }),
    });
  });

  it('sumReceiptAmounts รวม Decimal', () => {
    expect(sumReceiptAmounts([{ amount: new Prisma.Decimal('1515.83') }, { amount: new Prisma.Decimal('1000') }]).toFixed(2)).toBe('2515.83');
  });
});

describe('hasRescheduleHistory', () => {
  const client = (opts: { feeCount?: number; entries?: unknown[] }) =>
    ({
      receipt: { count: jest.fn().mockResolvedValue(opts.feeCount ?? 0) },
      journalEntry: { findMany: jest.fn().mockResolvedValue(opts.entries ?? []) },
    }) as never;

  it('ถังพัก > 0 = เคยปรับดิว (ไม่ต้องอ่านฐาน)', async () => {
    expect(await hasRescheduleHistory(client({}), { id: 'c', rescheduleAdvanceBalance: new Prisma.Decimal('1') })).toBe(true);
  });
  it('ใบ RESCHEDULE_FEE ที่ยังมีผล = เคยปรับดิว', async () => {
    expect(await hasRescheduleHistory(client({ feeCount: 1 }), { id: 'c', rescheduleAdvanceBalance: 0 })).toBe(true);
  });
  it.each([
    [{ tag: '6b', flow: 'reschedule-bundled' }],
    [{ tag: '2A', flow: 'reschedule-park-consume' }],
    [{ flow: 'reschedule-collect' }],
  ])('JE %j ที่ยังมีผล = เคยปรับดิว · reversed = ไม่นับ', async (meta) => {
    expect(await hasRescheduleHistory(client({ entries: [{ metadata: { ...meta, contractId: 'c' } }] }), { id: 'c', rescheduleAdvanceBalance: 0 })).toBe(true);
    expect(await hasRescheduleHistory(client({ entries: [{ metadata: { ...meta, contractId: 'c', reversed: true } }] }), { id: 'c', rescheduleAdvanceBalance: 0 })).toBe(false);
  });
  it('ไม่มีร่องรอย = false', async () => {
    expect(await hasRescheduleHistory(client({ entries: [{ metadata: { tag: '1A', contractId: 'c' } }] }), { id: 'c', rescheduleAdvanceBalance: 0 })).toBe(false);
  });
});

describe('exchangeMoneyBlockers — เหตุผลปฏิเสธด้านเงิน (spec §5)', () => {
  afterEach(() => jest.restoreAllMocks());
  const client = (opts: {
    feeCount?: number;
    earlyPayoffCount?: number;
    orphanCn?: number;
    pendingVoid?: boolean;
    entries?: unknown[];
  }) =>
    ({
      receipt: {
        count: jest.fn(({ where }: { where: { receiptType: string | { in: string[] } } }) => {
          if (where.receiptType === 'RESCHEDULE_FEE') return Promise.resolve(opts.feeCount ?? 0);
          if (where.receiptType === 'EARLY_PAYOFF') return Promise.resolve(opts.earlyPayoffCount ?? 0);
          if (where.receiptType === 'CREDIT_NOTE') return Promise.resolve(opts.orphanCn ?? 0);
          return Promise.resolve(0);
        }),
      },
      journalEntry: { findMany: jest.fn().mockResolvedValue(opts.entries ?? []) },
      paymentApprovalRequest: { findFirst: jest.fn().mockResolvedValue(opts.pendingVoid ? { id: 'req-1' } : null) },
    }) as never;
  const contract = { id: 'ct-old', rescheduleAdvanceBalance: 0 };

  it('สะอาด = []', async () => {
    jest.spyOn(excess, 'findActiveAdvanceExcessIncome').mockResolvedValue([]);
    expect(await exchangeMoneyBlockers(client({}), contract)).toEqual([]);
  });
  it('ทุกเหตุผลรายงานพร้อมกัน เรียง: ปรับดิว · 42-1106 · คำขอ void · ปิดยอด · ใบลดหนี้กำพร้า', async () => {
    jest.spyOn(excess, 'findActiveAdvanceExcessIncome').mockResolvedValue([{ id: 'je-aei' } as never]);
    expect(
      await exchangeMoneyBlockers(client({ feeCount: 1, pendingVoid: true, earlyPayoffCount: 1, orphanCn: 1 }), contract),
    ).toEqual([
      EXCHANGE_BLOCK_RESCHEDULED,
      EXCHANGE_BLOCK_EXCESS_INCOME,
      EXCHANGE_BLOCK_PENDING_VOID,
      EXCHANGE_BLOCK_EARLY_PAYOFF,
      EXCHANGE_BLOCK_ORPHAN_CN,
    ]);
  });
  it('คำขอ void ค้าง: ค้น paymentApprovalRequest action VOID_RECEIPT status PENDING ของสัญญา', async () => {
    jest.spyOn(excess, 'findActiveAdvanceExcessIncome').mockResolvedValue([]);
    const c = client({ pendingVoid: true });
    await exchangeMoneyBlockers(c, contract);
    expect((c as never as { paymentApprovalRequest: { findFirst: jest.Mock } }).paymentApprovalRequest.findFirst).toHaveBeenCalledWith({
      where: { contractId: 'ct-old', action: 'VOID_RECEIPT', status: 'PENDING', deletedAt: null },
      select: { id: true },
    });
  });
});

import { estimateCreditToTransfer } from './defect-exchange-credit';

describe('estimateCreditToTransfer — กล่องยืนยันคิดจากแหล่งเดียวกับ T (ผู้ตรวจอิสระ I2)', () => {
  const Dc = (n: string | number) => new Decimal(n);
  const line = (accountCode: string, debit: string | number, credit: string | number) => ({ accountCode, debit: Dc(debit), credit: Dc(credit) });
  const je = (entryNumber: string, metadata: Record<string, unknown>, lines: ReturnType<typeof line>[]) => ({ entryNumber, metadata, lines });
  const receiptJe = (no: string, paymentId: string, lines: ReturnType<typeof line>[]) =>
    je(no, { tag: 'receipt', flow: 'payment-receipt', contractId: 'old', paymentId }, lines);
  const zero = { ledgerAdvance: Dc(0), ledgerCredit: Dc(0) };

  it('ใบรับเงินใบเดียว (เงินสด ↔ 11-2103): ขาเงินสดที่จะถูกย้ายไป 21-1106 = ยอดใบ', () => {
    const out = estimateCreditToTransfer({ entries: [receiptJe('JE-1', 'p1', [line('11-1201', '1515.83', 0), line('11-2103', 0, '1515.83')])], livePaymentIds: new Set(['p1']), ...zero });
    expect(out.estimate.toFixed(2)).toBe('1515.83');
    expect(out.cashFromReceipts.toFixed(2)).toBe('1515.83');
    expect(out.unmirrorable).toEqual([]);
  });
  it('จ่ายเกินแล้วพักถัง (Cr 21-1103 ในใบ): ไม่นับซ้ำ — กระจกใบดึงเงินออกจากถัง แล้วเงินสดทั้งก้อนไป 21-1106', () => {
    const out = estimateCreditToTransfer({
      entries: [receiptJe('JE-2', 'p1', [line('11-1201', '2000', 0), line('11-2103', 0, '1515.83'), line('21-1103', 0, '484.17')])],
      livePaymentIds: new Set(['p1']), ledgerAdvance: Dc('484.17'), ledgerCredit: Dc(0),
    });
    expect(out.estimate.toFixed(2)).toBe('2000.00');
    expect(out.advanceAfter.toFixed(2)).toBe('0.00');
  });
  it('ส่วนเกินลิงก์ชำระ (เงินสด ↔ 21-1103 ล้วน ไม่มีใบ): ขั้น ค ข้าม → เงินยังอยู่ในถัง → ย้ายโดยขั้น ข', () => {
    const out = estimateCreditToTransfer({
      entries: [je('JE-3', { tag: 'receipt', flow: 'paysolutions-surplus-advance', contractId: 'old' }, [line('11-1201', '500', 0), line('21-1103', 0, '500')])],
      livePaymentIds: new Set(), ledgerAdvance: Dc('500'), ledgerCredit: Dc(0),
    });
    expect(out.estimate.toFixed(2)).toBe('500.00');
    expect(out.unmirrorable).toEqual([]);
  });
  it('รอบกลางคืนหักเงินรับล่วงหน้าเข้างวดโดยไม่มีใบ (Dr 21-1103 / Cr 11-2103): ขั้น ค กระจก → เงินกลับเข้าถัง → นับเป็นเครดิต', () => {
    const out = estimateCreditToTransfer({
      entries: [je('JE-4', { tag: '2B', flow: 'advance-consume-on-accrual', contractId: 'old' }, [line('21-1103', '500', 0), line('11-2103', 0, '500')])],
      livePaymentIds: new Set(), ...zero,
    });
    expect(out.estimate.toFixed(2)).toBe('500.00');
    expect(out.advanceAfter.toFixed(2)).toBe('500.00');
  });
  it('ใบที่จ่ายด้วยเครดิต (A→B→C — Dr 21-5101 / Cr 11-2103 ไม่มีเงินสด): กระจกคืนเครดิตเข้า 21-5101 → ย้ายโดยขั้น ข', () => {
    const out = estimateCreditToTransfer({
      entries: [receiptJe('JE-5', 'p1', [line('21-5101', '1515.83', 0), line('11-2103', 0, '1515.83')])],
      livePaymentIds: new Set(['p1']), ...zero,
    });
    expect(out.estimate.toFixed(2)).toBe('1515.83');
    expect(out.cashFromReceipts.toFixed(2)).toBe('0.00');
    expect(out.creditAfter.toFixed(2)).toBe('1515.83');
  });
  it('ใบรับชำระที่ไม่มีใบเสร็จ (เงินสด ↔ 11-2103 แต่ paymentId ไม่อยู่ในใบที่จะยกเลิก): รายงานเป็นรายการที่กลับไม่ได้ ไม่นับเข้าเครดิต', () => {
    const out = estimateCreditToTransfer({
      entries: [receiptJe('JE-6', 'p9', [line('11-1201', '1515.83', 0), line('11-2103', 0, '1515.83')])],
      livePaymentIds: new Set(['p1']), ...zero,
    });
    expect(out.unmirrorable).toEqual(['JE-6']);
    expect(out.estimate.toFixed(2)).toBe('0.00');
  });
  it('รายการที่ถูกข้าม (reversed · tag REVERSAL · flow ย้ายเครดิต · ภาษีซื้อ) ไม่มีผล · ยอดบัญชีติดลบถูก clamp 0', () => {
    const out = estimateCreditToTransfer({
      entries: [
        je('JE-7', { tag: 'receipt', flow: 'payment-receipt', contractId: 'old', paymentId: 'p1', reversed: true }, [line('11-1201', '1515.83', 0), line('11-2103', 0, '1515.83')]),
        je('JE-8', { tag: 'REVERSAL', flow: 'receipt-void', contractId: 'old' }, [line('11-2103', '1515.83', 0), line('21-1106', 0, '1515.83')]),
        je('JE-9', { tag: 'DEFECT_EXCHANGE', flow: 'defect-exchange-credit-in', contractId: 'old' }, [line('21-1106', '300', 0), line('21-5101', 0, '300')]),
        je('JE-10', { flow: 'finance-input-vat-installment', contractId: 'old' }, [line('11-4101', '686', 0), line('42-1108', 0, '686')]),
      ],
      livePaymentIds: new Set(['p1']), ledgerAdvance: Dc('-100'), ledgerCredit: Dc(0),
    });
    expect(out.estimate.toFixed(2)).toBe('0.00');
    expect(out.unmirrorable).toEqual([]);
  });
});
