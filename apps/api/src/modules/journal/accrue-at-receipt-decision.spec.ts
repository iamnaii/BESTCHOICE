import { ContractStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { AccrueAtReceiptFacts, decideAccrueAtReceipt } from './accrue-at-receipt-decision';
import { splitReceipt } from './split-receipt';

/**
 * กติกา "ตั้งลูกหนี้งวด ณ วันรับเงิน" (คำตัดสินผู้คุมงาน R9 + R12 · คำตอบฝ่ายบัญชี ก1 "แบบ ข" 29/09/2569).
 * ยอดคงเหลือ/ยอดที่ล้างในเทสมาจาก splitReceipt ตัวจริง — ตัวเดียวกับที่ PaymentReceiptTemplate ใช้ — เพื่อปักว่า
 * ค่าที่ใช้ตัดสินคือค่าที่ template คำนวณได้จริง.
 *
 * ตัวเลขของกรณี "ยอดเรียกเก็บไม่เท่ายอดในบัญชี": ยอดในบัญชีของงวด 6,078.67 (5,681.00 + VAT 397.67)
 * ยอดเรียกเก็บ 6,079.00 (ปัดเป็นบาทเต็ม) — ส่วนต่าง 0.33
 */
describe('decideAccrueAtReceipt', () => {
  const dec = (v: string) => new Decimal(v);
  const LEDGER = '6078.67';

  const split = (o: {
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
    over: {
      alreadyAccrued?: boolean;
      contractStatusBeforeReceipt?: ContractStatus;
      dueDateReached?: boolean;
    } = {},
  ) => {
    const s = split(receipt);
    return decideAccrueAtReceipt({
      alreadyAccrued: over.alreadyAccrued ?? false,
      contractStatusBeforeReceipt: over.contractStatusBeforeReceipt ?? 'ACTIVE',
      isFinalReceipt: receipt.isFinalReceipt,
      principalRemainingAfter: s.principalRemainingAfter,
      principalCleared: s.principalCleared,
      dueDateReached: over.dueDateReached ?? false,
    });
  };

  describe('ใบที่ทำให้งวดชำระครบ → ACCRUE (ตั้งส่วนที่เหลือ — ยังไม่เคยตั้ง = ทั้งงวด) ไม่ว่าถึงวันครบกำหนดหรือยัง', () => {
    it.each([false, true])('จ่ายเท่ายอดในบัญชีพอดี (ถึงวันครบกำหนดแล้ว = %s)', (dueDateReached) => {
      expect(decide({ delta: LEDGER, isFinalReceipt: true }, { dueDateReached })).toBe('ACCRUE');
    });

    it('ยอดเรียกเก็บสูงกว่ายอดในบัญชี: จ่าย 6,079.00 → ล้าง 6,078.67 เศษ 0.33 เป็นกำไรปัดเศษ', () => {
      const s = split({ delta: '6079.00', isFinalReceipt: true });
      expect(s.principalCleared.toFixed(2)).toBe('6078.67');
      expect(s.overpayRounding.toFixed(2)).toBe('0.33');
      expect(decide({ delta: '6079.00', isFinalReceipt: true })).toBe('ACCRUE');
    });

    it('จ่ายขาดไม่เกิน 1 บาทและเป็นใบปิดงวด: 6,078.00 → เศษ 0.67 ถูกปิดด้วยส่วนลดเศษสตางค์', () => {
      const s = split({ delta: '6078.00', isFinalReceipt: true });
      expect(s.underpayRounding.toFixed(2)).toBe('0.67');
      expect(s.principalRemainingAfter.toFixed(2)).toBe('0.00');
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

    it('ลูกหนี้ในบัญชีถูกล้างครบไปแล้วโดยใบก่อน ๆ: ใบ 0.33 ที่ทำให้แถวงวดเป็น PAID (ใบนี้ล้างลูกหนี้ 0 บาท)', () => {
      const s = split({ delta: '0.33', prior: LEDGER, isFinalReceipt: true });
      expect(s.principalCleared.toFixed(2)).toBe('0.00');
      expect(s.overpayRounding.toFixed(2)).toBe('0.33');
      expect(decide({ delta: '0.33', prior: LEDGER, isFinalReceipt: true })).toBe('ACCRUE');
    });
  });

  describe('ใบบางส่วนก่อนวันครบกำหนด → ACCRUE_RECEIVED (ตั้งเท่ายอดที่ใบนี้ล้างลูกหนี้ — ก1)', () => {
    it('รับบางส่วน 3,000.00 (ตัวอย่างที่ฝ่ายบัญชีตอบ)', () => {
      expect(decide({ delta: '3000.00', isFinalReceipt: false })).toBe('ACCRUE_RECEIVED');
    });

    it('รับ 6,078.67 แบบบางส่วน (แถวงวดยังค้างเศษ 0.33 ของยอดเรียกเก็บ): ตั้งเท่ายอดที่รับ = ครบทั้งงวด', () => {
      const s = split({ delta: LEDGER, isFinalReceipt: false });
      expect(s.principalRemainingAfter.toFixed(2)).toBe('0.00');
      expect(decide({ delta: LEDGER, isFinalReceipt: false })).toBe('ACCRUE_RECEIVED');
    });

    it('ผู้เรียกบอกว่าเป็นใบปิดงวดแต่ลูกหนี้ในบัญชียังเหลือ (template ปฏิเสธใบแบบนี้อยู่แล้ว) → ไม่ถือว่าทำให้ครบ', () => {
      expect(
        decideAccrueAtReceipt({
          alreadyAccrued: false,
          contractStatusBeforeReceipt: 'ACTIVE',
          isFinalReceipt: true,
          principalRemainingAfter: dec('515.83'),
          principalCleared: dec('1000.00'),
          dueDateReached: false,
        }),
      ).toBe('ACCRUE_RECEIVED');
    });
  });

  describe('ใบบางส่วนที่ไม่ลง 2A → PARTIAL_RECEIPT', () => {
    it('ถึงวันครบกำหนดแล้ว ณ วันรับเงิน (รอบกลางคืนตั้งส่วนที่เหลือ)', () => {
      expect(decide({ delta: '3000.00', isFinalReceipt: false }, { dueDateReached: true })).toBe(
        'PARTIAL_RECEIPT',
      );
    });

    it('ใบนี้ไม่ได้ล้างลูกหนี้ของงวดเลย (ลูกหนี้ถูกล้างครบโดยใบก่อน ๆ — เศษของยอดเรียกเก็บ)', () => {
      const s = split({ delta: '0.10', prior: LEDGER, isFinalReceipt: false });
      expect(s.principalCleared.toFixed(2)).toBe('0.00');
      expect(decide({ delta: '0.10', prior: LEDGER, isFinalReceipt: false })).toBe(
        'PARTIAL_RECEIPT',
      );
    });
  });

  it.each<ContractStatus>([
    'TERMINATED',
    'CLOSED_BAD_DEBT',
    'COMPLETED',
    'EARLY_PAYOFF',
    'EXCHANGED',
    'DEFECT_EXCHANGED',
    'DRAFT',
    'CANCELED',
  ])('สถานะก่อนรับเงินเป็น %s → CONTRACT_NOT_SERVED ทั้งใบที่ทำให้ครบและใบบางส่วน', (status) => {
    expect(
      decide({ delta: LEDGER, isFinalReceipt: true }, { contractStatusBeforeReceipt: status }),
    ).toBe('CONTRACT_NOT_SERVED');
    expect(
      decide({ delta: '3000.00', isFinalReceipt: false }, { contractStatusBeforeReceipt: status }),
    ).toBe('CONTRACT_NOT_SERVED');
  });

  it.each<ContractStatus>(['ACTIVE', 'OVERDUE', 'DEFAULT'])(
    'สถานะก่อนรับเงินเป็น %s → ใบที่ทำให้ครบตั้ง (ACCRUE) · ใบบางส่วนก่อนครบกำหนดตั้งเท่ายอดที่รับ',
    (status) => {
      expect(
        decide({ delta: LEDGER, isFinalReceipt: true }, { contractStatusBeforeReceipt: status }),
      ).toBe('ACCRUE');
      expect(
        decide(
          { delta: '3000.00', isFinalReceipt: false },
          { contractStatusBeforeReceipt: status },
        ),
      ).toBe('ACCRUE_RECEIVED');
    },
  );

  /**
   * ลำดับการตัดสิน (PR2 carry): ข้อแรกที่เป็นจริงชนะ —
   * ตั้งครบแล้ว > สถานะที่ไม่ดูแล > ใบที่ทำให้ครบ > ถึงวันครบกำหนด / ไม่ได้ล้างลูกหนี้ > ตั้งเท่ายอดที่รับ.
   * ทุกแถวตั้งเงื่อนไขของ "ข้อที่แพ้" ให้เป็นจริงพร้อมกันด้วย
   */
  describe('ลำดับการตัดสิน', () => {
    const facts = (over: Partial<AccrueAtReceiptFacts>): AccrueAtReceiptFacts => ({
      alreadyAccrued: false,
      contractStatusBeforeReceipt: 'ACTIVE',
      isFinalReceipt: false,
      principalRemainingAfter: dec('515.83'),
      principalCleared: dec('1000.00'),
      dueDateReached: false,
      ...over,
    });
    const SETTLES = { isFinalReceipt: true, principalRemainingAfter: dec('0') };

    it.each<[string, Partial<AccrueAtReceiptFacts>, string]>([
      [
        'ตั้งครบแล้ว ชนะสถานะที่ไม่ดูแล + ใบที่ทำให้ครบ',
        { alreadyAccrued: true, contractStatusBeforeReceipt: 'TERMINATED', ...SETTLES },
        'ALREADY_ACCRUED',
      ],
      ['ตั้งครบแล้ว ชนะใบบางส่วนก่อนครบกำหนด', { alreadyAccrued: true }, 'ALREADY_ACCRUED'],
      [
        'สถานะที่ไม่ดูแล ชนะใบที่ทำให้ครบ',
        { contractStatusBeforeReceipt: 'CLOSED_BAD_DEBT', ...SETTLES },
        'CONTRACT_NOT_SERVED',
      ],
      [
        'สถานะที่ไม่ดูแล ชนะใบบางส่วนก่อนครบกำหนด',
        { contractStatusBeforeReceipt: 'EARLY_PAYOFF' },
        'CONTRACT_NOT_SERVED',
      ],
      ['ใบที่ทำให้ครบ ชนะถึงวันครบกำหนด', { ...SETTLES, dueDateReached: true }, 'ACCRUE'],
      [
        'ใบที่ทำให้ครบ ชนะไม่ได้ล้างลูกหนี้ (ใบเศษ 0.33)',
        { ...SETTLES, principalCleared: dec('0') },
        'ACCRUE',
      ],
      ['ถึงวันครบกำหนด ชนะตั้งเท่ายอดที่รับ', { dueDateReached: true }, 'PARTIAL_RECEIPT'],
      ['ไม่ได้ล้างลูกหนี้ ชนะตั้งเท่ายอดที่รับ', { principalCleared: dec('0') }, 'PARTIAL_RECEIPT'],
      ['เหลือเพียงใบบางส่วนก่อนครบกำหนดที่ล้างลูกหนี้', {}, 'ACCRUE_RECEIVED'],
    ])('%s', (_label, over, expected) => {
      expect(decideAccrueAtReceipt(facts(over))).toBe(expected);
    });
  });
});
