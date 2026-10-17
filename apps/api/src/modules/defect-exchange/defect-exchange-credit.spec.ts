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
