import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { splitReceipt } from '../journal/split-receipt';
import {
  allocatePaidAmountFifo,
  fifoUnpaidPaymentsArgs,
  payAllocationPreviewLines,
  payLinkAmountKind,
} from './pay-allocation';

/**
 * Task 42 — การกระจายเงินที่ webhook PaySolutions ทำ (งวดเก่าก่อน) เป็นฟังก์ชันเดียว: webhook เรียกตอนรับเงินจริง · หน้า `/pay/:token`
 * เรียกตอนแสดง "นำไปชำระ (งวดเก่าก่อน)" ⇒ สิ่งที่ลูกค้าเห็นก่อนจ่าย = สิ่งที่ webhook ทำหลังจ่าย
 */
const dec = (v: string) => new Prisma.Decimal(v);
/** บัญชีของงวดที่ยังไม่มีใบรับชำระ (หรือไม่มีค่าปรับที่ลงไปแล้ว) — ค่างวดตามบัญชี 1,515.83 */
const ledger =
  (priorLateFeeBooked: Record<number, string> = {}) =>
  (installmentNo: number) => ({
    installmentTotal: dec('1515.83'),
    priorPrincipalCleared: dec('0'),
    priorLateFeeBooked: dec(priorLateFeeBooked[installmentNo] ?? '0'),
  });
const row = (
  installmentNo: number,
  amountPaid: string,
  lateFee: string,
  lateFeeWaived = false,
  amountDue = '1515.83',
) => ({
  id: `pay-${installmentNo}`,
  installmentNo,
  amountDue: dec(amountDue),
  amountPaid: dec(amountPaid),
  lateFee: dec(lateFee),
  lateFeeWaived,
});

describe('fifoUnpaidPaymentsArgs — งวดที่ webhook กระจายเงินเข้า', () => {
  it('ยังไม่ PAID · ไม่ถูกลบ · ของสัญญานี้ · งวดเก่าก่อน', () => {
    expect(fifoUnpaidPaymentsArgs('ct-1')).toEqual({
      where: { contractId: 'ct-1', status: { not: 'PAID' }, deletedAt: null },
      orderBy: { installmentNo: 'asc' },
    });
  });
});

describe('allocatePaidAmountFifo — กติกาการกระจายเงินของ webhook', () => {
  it('ตามลำดับที่ได้ (งวดเก่าก่อน) · ลงงวดละไม่เกินยอดค้าง · เงินหมดแล้วหยุด', () => {
    const payments = [row(2, '900.00', '100.00'), row(3, '0', '0'), row(4, '0', '0')];

    const { lines, remaining } = allocatePaidAmountFifo(payments, dec('2231.66'));

    expect(
      lines.map((l) => [
        l.payment.installmentNo,
        l.owed.toFixed(2),
        l.payThis.toFixed(2),
        l.newAmountPaid.toFixed(2),
        l.fullyPaid,
      ]),
    ).toEqual([
      [2, '715.83', '715.83', '1615.83', true],
      [3, '1515.83', '1515.83', '1515.83', true],
    ]);
    expect(remaining.toFixed(2)).toBe('0.00');
  });

  it('เงินไม่พอปิดงวด → งวดนั้นได้บางส่วน (fullyPaid = false) แล้วหยุด', () => {
    const { lines, remaining } = allocatePaidAmountFifo(
      [row(2, '0', '100.00'), row(3, '0', '0')],
      dec('1000'),
    );

    expect(lines.map((l) => [l.payment.installmentNo, l.payThis.toFixed(2), l.fullyPaid])).toEqual([
      [2, '1000.00', false],
    ]);
    expect(lines[0].newAmountPaid.toFixed(2)).toBe('1000.00');
    expect(remaining.toFixed(2)).toBe('0.00');
  });

  it('เงินพอค่างวดแต่ไม่พอค่าปรับ → งวดยังไม่ครบ (ค่าปรับนับในยอดที่ต้องปิด)', () => {
    const allocation = allocatePaidAmountFifo(
      [row(2, '0', '100.00'), row(3, '0', '0')],
      dec('1515.83'),
    );

    expect(
      allocation.lines.map((l) => [l.payment.installmentNo, l.payThis.toFixed(2), l.fullyPaid]),
    ).toEqual([[2, '1515.83', false]]);
    expect(payAllocationPreviewLines(allocation, ledger())).toEqual([
      { kind: 'PARTIAL', installmentNo: 2, amount: 1515.83 },
      { kind: 'LEFT_AFTER', installmentNo: 2, amount: 100 },
    ]);
  });

  it('ค่าปรับที่ยกเว้นแล้วไม่นับ · งวดที่ไม่มียอดค้าง (owed ≤ 0) ข้าม', () => {
    const { lines } = allocatePaidAmountFifo(
      [row(1, '1515.83', '0'), row(2, '0', '100.00', true), row(3, '0', '0')],
      dec('1615.83'),
    );

    expect(
      lines.map((l) => [l.payment.installmentNo, l.lateFee.toFixed(2), l.payThis.toFixed(2)]),
    ).toEqual([
      [2, '0.00', '1515.83'],
      [3, '0.00', '100.00'],
    ]);
  });

  it('เงินเกินทุกงวดค้าง → เหลือ remaining (webhook พักเป็นเงินรับล่วงหน้า)', () => {
    const { lines, remaining } = allocatePaidAmountFifo([row(12, '0', '0')], dec('2000'));

    expect(lines).toHaveLength(1);
    expect(remaining.toFixed(2)).toBe('484.17');
  });
});

describe('payAllocationPreviewLines — แถว "นำไปชำระ (งวดเก่าก่อน)" ของหน้า /pay/:token', () => {
  it('แจ้งล็อก (mockup): งวดที่จ่ายมาแล้วบางส่วน = ค่างวดคงเหลือ + ค่าปรับ · งวดที่ยังไม่จ่าย = ค่างวด', () => {
    const allocation = allocatePaidAmountFifo(
      [row(2, '900.00', '100.00'), row(3, '0', '0')],
      dec('2231.66'),
    );

    expect(payAllocationPreviewLines(allocation, ledger())).toEqual([
      { kind: 'INSTALLMENT_REMAINING', installmentNo: 2, amount: 615.83 },
      { kind: 'LATE_FEE', installmentNo: 2, amount: 100 },
      { kind: 'INSTALLMENT', installmentNo: 3, amount: 1515.83 },
    ]);
  });

  it('ยอดนัด (mockup): งวดที่เงินไม่พอปิด = ชำระบางส่วน + ยังค้างหลังชำระ', () => {
    const allocation = allocatePaidAmountFifo(
      [row(2, '0', '100.00'), row(3, '0', '0')],
      dec('1000'),
    );

    expect(payAllocationPreviewLines(allocation, ledger())).toEqual([
      { kind: 'PARTIAL', installmentNo: 2, amount: 1000 },
      { kind: 'LEFT_AFTER', installmentNo: 2, amount: 615.83 },
    ]);
  });

  it('งวดที่จ่ายค่างวดครบแล้วเหลือแต่ค่าปรับ → แถวค่าปรับอย่างเดียว · ค่าปรับที่ยกเว้นไม่มีแถว', () => {
    const allocation = allocatePaidAmountFifo(
      [row(1, '1515.83', '100.00'), row(2, '0', '50.00', true)],
      dec('1615.83'),
    );

    expect(payAllocationPreviewLines(allocation, ledger())).toEqual([
      { kind: 'LATE_FEE', installmentNo: 1, amount: 100 },
      { kind: 'INSTALLMENT', installmentNo: 2, amount: 1515.83 },
    ]);
  });

  it('เงินเกินทุกงวดค้าง → แถวส่วนเกิน (webhook พักเป็นเงินรับล่วงหน้า) · ผลรวมแถว = ยอดของลิงก์', () => {
    const allocation = allocatePaidAmountFifo([row(12, '1000.00', '0')], dec('1000'));
    const lines = payAllocationPreviewLines(allocation, ledger());

    expect(lines).toEqual([
      { kind: 'INSTALLMENT_REMAINING', installmentNo: 12, amount: 515.83 },
      { kind: 'SURPLUS', amount: 484.17 },
    ]);
  });
});

describe('payAllocationPreviewLines — ค่าปรับก่อน ตามรายการบัญชีของงวด (แบบเดียวกับใบรับชำระ · รีวิว I1)', () => {
  // งวด 1,515.83 + ค่าปรับ 100 · จ่ายที่สาขาแล้ว 900 · เงินลิงก์ปิดงวดนี้ (715.83)
  const paidAtBranch = () => allocatePaidAmountFifo([row(1, '900.00', '100.00')], dec('715.83'));

  it.each([
    [
      'ใบ 900 ลงค่าปรับ 100 ไปแล้ว (มีค่าปรับก่อนจ่าย) → ค่างวดคงเหลือ 715.83 แถวเดียว ไม่มีค่าปรับซ้ำ',
      '100',
      [{ kind: 'INSTALLMENT_REMAINING', installmentNo: 1, amount: 715.83 }],
    ],
    [
      'ใบ 900 ลงค่าปรับ 50 (ค่าปรับขยับเป็น 100 ภายหลัง) → 665.83 + ค่าปรับ 50',
      '50',
      [
        { kind: 'INSTALLMENT_REMAINING', installmentNo: 1, amount: 665.83 },
        { kind: 'LATE_FEE', installmentNo: 1, amount: 50 },
      ],
    ],
    [
      'ใบ 900 ไม่มีค่าปรับ (จ่ายก่อนค่าปรับเกิด — ตัวเลข mockup) → 615.83 + ค่าปรับ 100',
      '0',
      [
        { kind: 'INSTALLMENT_REMAINING', installmentNo: 1, amount: 615.83 },
        { kind: 'LATE_FEE', installmentNo: 1, amount: 100 },
      ],
    ],
  ] as const)('%s', (_label, booked, expected) => {
    expect(payAllocationPreviewLines(paidAtBranch(), ledger({ 1: booked }))).toEqual(expected);
  });

  it('ค่าปรับของแถว = lateFeePortion ของ splitReceipt (ตัวที่ใบรับชำระของ webhook ใช้) ทุกกรณี', () => {
    for (const paid of ['0', '50.00', '900.00', '1515.83']) {
      for (const fee of ['0', '50.00', '100.00']) {
        for (const booked of ['0', '50.00', '100.00']) {
          if (dec(booked).gt(fee) || dec(booked).gt(paid)) continue;
          const allocation = allocatePaidAmountFifo([row(1, paid, fee)], dec('5000'));
          const [line] = allocation.lines;
          if (!line) continue; // งวดที่ไม่มียอดค้าง — ไม่มีแถว
          const lateFeeRow = payAllocationPreviewLines(allocation, ledger({ 1: booked })).find(
            (r) => r.kind === 'LATE_FEE',
          );
          const books = splitReceipt({
            delta: new Decimal(line.payThis.toString()),
            installmentTotal: new Decimal('1515.83'),
            lateFee: new Decimal(line.lateFee.toString()),
            priorPrincipalCleared: new Decimal('0'),
            priorLateFeeBooked: new Decimal(booked),
            advanceConsume: new Decimal(0),
            advanceCredit: new Decimal(0),
            isFinalReceipt: true,
          });
          expect([paid, fee, booked, lateFeeRow?.amount ?? 0]).toEqual([
            paid,
            fee,
            booked,
            books.lateFeePortion.toNumber(),
          ]);
        }
      }
    }
  });
});

describe('payLinkAmountKind — หัวยอดของหน้า /pay/:token (ตัดสินที่ server จาก purpose + กฎที่สร้างลิงก์)', () => {
  it.each([
    ['INSTALLMENT', null, 'DUE'],
    ['INSTALLMENT', 'CALL_NO_ANSWER', 'DUE'],
    ['PAYOFF', null, 'PAYOFF'],
    ['AMOUNT', 'DEVICE_LOCKED', 'OUTSTANDING'],
    ['AMOUNT', 'CALL_ANSWERED_PROMISE', 'PROMISE'],
    ['AMOUNT', null, 'DUE'],
    ['AMOUNT', 'LETTER_DISPATCHED', 'DUE'],
    [null, null, 'DUE'],
    [null, 'DEVICE_LOCKED', 'DUE'],
  ] as const)('purpose %s · sourceEvent %s → %s', (purpose, sourceEvent, kind) => {
    expect(payLinkAmountKind(purpose, sourceEvent)).toBe(kind);
  });
});
