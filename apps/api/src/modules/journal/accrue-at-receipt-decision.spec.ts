import { ContractStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { decideAccrueAtReceipt } from './accrue-at-receipt-decision';
import { splitReceipt } from './split-receipt';

/**
 * กติกา "ตั้งลูกหนี้งวด ณ วันรับเงินเฉพาะเมื่อใบรับชำระนี้ทำให้งวดชำระครบ"
 * (คำตัดสินผู้คุมงาน R9 + R12, 2026-09-29). ยอดคงเหลือในเทสมาจาก splitReceipt ตัวจริง —
 * ตัวเดียวกับที่ PaymentReceiptTemplate ใช้ — เพื่อปักว่าค่าที่ใช้ตัดสินคือค่าที่ template คำนวณได้จริง.
 *
 * ตัวเลขของกรณี "ยอดเรียกเก็บไม่เท่ายอดในบัญชี": ยอดในบัญชีของงวด 6,078.67 (5,681.00 + VAT 397.67)
 * ยอดเรียกเก็บ 6,079.00 (ปัดเป็นบาทเต็ม) — ส่วนต่าง 0.33
 */
describe('decideAccrueAtReceipt', () => {
  const dec = (v: string) => new Decimal(v);
  const LEDGER = '6078.67';

  const remainingAfter = (o: {
    delta: string;
    prior?: string;
    advanceConsume?: string;
    isFinalReceipt: boolean;
  }) =>
    splitReceipt({
      delta: dec(o.delta),
      installmentTotal: dec(LEDGER),
      lateFee: dec('0'),
      priorPrincipalCleared: dec(o.prior ?? '0'),
      priorLateFeeBooked: dec('0'),
      advanceConsume: dec(o.advanceConsume ?? '0'),
      advanceCredit: dec('0'),
      isFinalReceipt: o.isFinalReceipt,
    });

  const decide = (
    receipt: { delta: string; prior?: string; advanceConsume?: string; isFinalReceipt: boolean },
    over: { alreadyAccrued?: boolean; contractStatusBeforeReceipt?: ContractStatus } = {},
  ) =>
    decideAccrueAtReceipt({
      alreadyAccrued: over.alreadyAccrued ?? false,
      contractStatusBeforeReceipt: over.contractStatusBeforeReceipt ?? 'ACTIVE',
      isFinalReceipt: receipt.isFinalReceipt,
      principalRemainingAfter: remainingAfter(receipt).principalRemainingAfter,
    });

  describe('ใบที่ทำให้งวดชำระครบ → ตั้งลูกหนี้งวด', () => {
    it('จ่ายเท่ายอดในบัญชีพอดี', () => {
      expect(decide({ delta: LEDGER, isFinalReceipt: true })).toBe('ACCRUE');
    });

    it('ยอดเรียกเก็บสูงกว่ายอดในบัญชี: จ่าย 6,079.00 → ล้าง 6,078.67 เศษ 0.33 เป็นกำไรปัดเศษ', () => {
      const split = remainingAfter({ delta: '6079.00', isFinalReceipt: true });
      expect(split.principalCleared.toFixed(2)).toBe('6078.67');
      expect(split.overpayRounding.toFixed(2)).toBe('0.33');
      expect(decide({ delta: '6079.00', isFinalReceipt: true })).toBe('ACCRUE');
    });

    it('จ่ายขาดไม่เกิน 1 บาทและเป็นใบปิดงวด: 6,078.00 → เศษ 0.67 ถูกปิดด้วยส่วนลดเศษสตางค์', () => {
      const split = remainingAfter({ delta: '6078.00', isFinalReceipt: true });
      expect(split.underpayRounding.toFixed(2)).toBe('0.67');
      expect(split.principalRemainingAfter.toFixed(2)).toBe('0.00');
      expect(decide({ delta: '6078.00', isFinalReceipt: true })).toBe('ACCRUE');
    });

    it('เงินสด 4,078.67 + หักเงินรับล่วงหน้า 2,000.00 ในใบเดียวกัน', () => {
      expect(decide({ delta: '4078.67', advanceConsume: '2000.00', isFinalReceipt: true })).toBe(
        'ACCRUE',
      );
    });

    it('ใบที่สองจ่ายส่วนที่เหลือของงวดที่เคยรับบางส่วน 3,000.00', () => {
      expect(decide({ delta: '3078.67', prior: '3000.00', isFinalReceipt: true })).toBe('ACCRUE');
    });

    it('ลูกหนี้ในบัญชีถูกล้างครบไปแล้วโดยใบก่อน ๆ และยังไม่มี 2A: ใบ 0.33 ที่ทำให้แถวงวดเป็น PAID (ใบนี้ล้างลูกหนี้ 0 บาท)', () => {
      const split = remainingAfter({ delta: '0.33', prior: LEDGER, isFinalReceipt: true });
      expect(split.principalCleared.toFixed(2)).toBe('0.00');
      expect(split.overpayRounding.toFixed(2)).toBe('0.33');
      expect(decide({ delta: '0.33', prior: LEDGER, isFinalReceipt: true })).toBe('ACCRUE');
    });
  });

  describe('ใบที่ยังไม่ทำให้งวดชำระครบ → ไม่ตั้ง (พฤติกรรมเดิม)', () => {
    it('รับบางส่วน 1,000.00', () => {
      expect(decide({ delta: '1000.00', isFinalReceipt: false })).toBe('PARTIAL_RECEIPT');
    });

    it('รับ 6,078.67 แบบบางส่วน: ลูกหนี้ในบัญชีปิดพอดี แต่แถวงวดยังค้างยอดเรียกเก็บ 0.33 (ผู้เรียกไม่ได้บอกว่าเป็นใบปิดงวด)', () => {
      const split = remainingAfter({ delta: LEDGER, isFinalReceipt: false });
      expect(split.principalRemainingAfter.toFixed(2)).toBe('0.00');
      expect(decide({ delta: LEDGER, isFinalReceipt: false })).toBe('PARTIAL_RECEIPT');
    });

    it('ผู้เรียกบอกว่าเป็นใบปิดงวด แต่ลูกหนี้ในบัญชียังเหลือ → ไม่ตั้ง (template ปฏิเสธใบแบบนี้อยู่แล้ว — กันไว้อีกชั้น)', () => {
      expect(
        decideAccrueAtReceipt({
          alreadyAccrued: false,
          contractStatusBeforeReceipt: 'ACTIVE',
          isFinalReceipt: true,
          principalRemainingAfter: dec('515.83'),
        }),
      ).toBe('PARTIAL_RECEIPT');
    });
  });

  it('งวดที่ตั้งลูกหนี้ไปแล้ว → ไม่ต้องทำอะไร ไม่ว่าใบจะครบหรือไม่', () => {
    expect(decide({ delta: LEDGER, isFinalReceipt: true }, { alreadyAccrued: true })).toBe(
      'ALREADY_ACCRUED',
    );
    expect(decide({ delta: '1000.00', isFinalReceipt: false }, { alreadyAccrued: true })).toBe(
      'ALREADY_ACCRUED',
    );
  });

  it.each<ContractStatus>([
    'TERMINATED',
    'CLOSED_BAD_DEBT',
    'COMPLETED',
    'EARLY_PAYOFF',
    'EXCHANGED',
    'DEFECT_EXCHANGED',
  ])('สถานะก่อนรับเงินเป็น %s → ไม่ตั้ง แม้ใบจะทำให้งวดครบ', (status) => {
    expect(
      decide({ delta: LEDGER, isFinalReceipt: true }, { contractStatusBeforeReceipt: status }),
    ).toBe('CONTRACT_NOT_SERVED');
  });

  it('สัญญาร่าง (DRAFT — ยังไม่เปิดใช้ ไม่มี 1A): ใบปิดงวดที่ล้างลูกหนี้ในบัญชีครบ → ไม่ตั้ง', () => {
    const split = remainingAfter({ delta: LEDGER, isFinalReceipt: true });
    expect(split.principalRemainingAfter.toFixed(2)).toBe('0.00');
    expect(
      decide({ delta: LEDGER, isFinalReceipt: true }, { contractStatusBeforeReceipt: 'DRAFT' }),
    ).toBe('CONTRACT_NOT_SERVED');
  });

  it.each<ContractStatus>(['ACTIVE', 'OVERDUE', 'DEFAULT'])(
    'สถานะก่อนรับเงินเป็น %s และใบทำให้งวดครบ → ตั้ง',
    (status) => {
      expect(
        decide({ delta: LEDGER, isFinalReceipt: true }, { contractStatusBeforeReceipt: status }),
      ).toBe('ACCRUE');
    },
  );
});
