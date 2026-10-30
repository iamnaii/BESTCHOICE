import { Prisma } from '@prisma/client';
import type { LegacyFileDetail } from '../files';
import type { LegacyContract } from '../legacy-book';
import { planImport, type ImportOptions, type ImportPlan } from '../plan-import';
import {
  CUTOFF,
  LAST,
  MONTHLY,
  peakMatch,
  standardInstallments,
  syntheticBook,
  syntheticContract,
  syntheticMember,
  syntheticRecon,
  thaiId,
  type MemberSpec,
} from './synthetic-book';

/**
 * แผนนำเข้า (Task 10) — ฟังก์ชันบริสุทธิ์ · ข้อมูลสังเคราะห์ทั้งหมด (`synthetic-book.ts`)
 * วันตัด 2026-11-30 23:59:59 กรุงเทพ
 */

const D = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);
/** เลขบัตรที่หลักตรวจผิด (หลักสุดท้ายของ M1 + 1) */
const BAD_ID = (() => {
  const id = thaiId('091234567899');
  return `${id.slice(0, 12)}${(Number(id[12]) + 1) % 10}`;
})();
const M1: MemberSpec = {
  id: '501',
  code: 'TEST-M-0501',
  nationalId: thaiId('091234567890'),
  phone: '0977000001',
};
const M2: MemberSpec = {
  id: '502',
  code: 'TEST-M-0502',
  nationalId: thaiId('091234567891'),
  phone: '0977000002',
};
const M3: MemberSpec = {
  id: '503',
  code: 'TEST-M-0503',
  nationalId: thaiId('091234567892'),
  phone: '0977000003',
};
const members = [M1, M2, M3].map(syntheticMember);

/** ผ่อนอยู่ ค้าง: งวด 1–8 จ่ายครบ · งวด 9 จ่าย 300 · งวด 10 ค้าง · งวด 11 (ครบกำหนด 5 ธ.ค.) จ่ายล่วงหน้า 500 */
function overdueContract(over: Partial<Parameters<typeof syntheticContract>[0]> = {}) {
  const paid = Object.fromEntries(
    Array.from({ length: 8 }, (_, i) => [i + 1, { amount: MONTHLY, paid: MONTHLY }]),
  );
  return syntheticContract({
    id: '1',
    code: 'TEST-C-0001',
    date: '2026-01-05',
    memberId: M1.id,
    firstDue: [2026, 1, 5],
    installments: standardInstallments({
      ...paid,
      9: { paid: '300' },
      11: { paid: '500', paidOn: new Date('2026-11-20T09:00:00+07:00') },
    }),
    ...over,
  });
}

/** ปิดก่อนกำหนดแล้ว (สถานะ 3 + รายการปิด): งวด 1–6 จ่ายครบ แล้วปิดบัญชี */
function earlyPayoffContract() {
  const paid = Object.fromEntries(
    Array.from({ length: 6 }, (_, i) => [i + 1, { amount: MONTHLY, paid: MONTHLY }]),
  );
  return syntheticContract({
    id: '2',
    code: 'TEST-C-0002',
    statusCode: '3',
    date: '2025-06-01',
    memberId: M2.id,
    firstDue: [2025, 6, 1],
    installments: standardInstallments(paid),
    close: { amount: '7500', discount: '1595', date: new Date('2026-01-15T11:00:00+07:00') },
  });
}

/** ผ่อนอยู่ จ่ายล่วงหน้า: งวด 1–3 จ่ายตรงเวลา · งวด 4 (ครบกำหนด 10 ธ.ค.) จ่ายครบล่วงหน้า */
function prepaidContract() {
  const paid = Object.fromEntries(
    Array.from({ length: 4 }, (_, i) => [i + 1, { amount: MONTHLY, paid: MONTHLY }]),
  );
  return syntheticContract({
    id: '3',
    code: 'TEST-C-0003',
    date: '2026-08-10',
    memberId: M3.id,
    firstDue: [2026, 8, 10],
    installments: standardInstallments(paid),
  });
}

/** คู่ PEAK ต่อสัญญา — `remain` ไม่ส่ง = ยอดค้างของงวด (สัญญาประวัติส่ง '0') */
function options(
  matches: Array<[LegacyContract, string, string?]>,
  over: Partial<ImportOptions> = {},
): ImportOptions {
  return {
    cutoff: CUTOFF,
    peakRecon: syntheticRecon(
      matches.map(([c, contact, remain]) => [c, peakMatch(c, contact, remain)]),
    ),
    moneyOverrides: new Map(),
    customerOverrides: new Map(),
    ...over,
  };
}

const money = (value: Prisma.Decimal) => value.toFixed(2);
const item = (plan: ImportPlan, code: string) => {
  const found = plan.items.find((i) => i.code === code);
  if (!found) throw new Error(`no item ${code}`);
  return found;
};

describe('planImport', () => {
  it('three healthy contracts → items, no blockers; ACTIVE carries PEAK + opening, HISTORY carries history only', () => {
    const a = overdueContract();
    const b = earlyPayoffContract();
    const c = prepaidContract();
    const plan = planImport(
      syntheticBook([a, b, c], members),
      options([
        [a, 'TESTC001'],
        [b, 'TESTC002', '0'],
        [c, 'TESTC003'],
      ]),
    );

    expect(plan.blockers).toEqual([]);
    expect(plan.items.map((i) => [i.code, i.kind, i.status])).toEqual([
      ['TEST-C-0002', 'HISTORY', 'EARLY_PAYOFF'],
      ['TEST-C-0001', 'ACTIVE', 'OVERDUE'],
      ['TEST-C-0003', 'ACTIVE', 'ACTIVE'],
    ]);
    expect(plan.catchUpAt.toISOString()).toBe(new Date('2026-12-01T00:05:00+07:00').toISOString());

    const overdue = item(plan, 'TEST-C-0001');
    expect(overdue.schedule).toHaveLength(12);
    expect(overdue.payments).toHaveLength(12);
    expect(overdue.peak?.invoiceCode).toBe('TEST-INV-TEST-C-0001');
    expect(overdue.customer.peakContactCode).toBe('TESTC001');
    expect(
      overdue.opening?.priorReceiptMarkers.map((m) => [m.installmentNo, money(m.amount)]),
    ).toEqual([
      [9, '300.00'],
      [11, '500.00'],
    ]);
    // VAT ของงวดค้างที่ถึงกำหนด: งวด 9 (99.17 − ภาษีของ 300) + งวด 10 (99.17)
    expect(money(plan.totals.catchUpVat)).toBe('178.71');
    expect(overdue.roundingDiff.isZero()).toBe(true);
    expect(overdue.product.imeiSerial).toBe('359990000000001');
    expect(overdue.product.legacyProductCode).toBe('TEST-C-0001/359990000000001');
    expect(overdue.product.category).toBe('PHONE_USED');
    expect(overdue.paymentDueDay).toBe(5);
    expect(overdue.notes).toContain('สัญญาเดิม TEST-C-0001');
    expect(overdue.notes).not.toContain('สัญญาฉบับเก่า');

    const history = item(plan, 'TEST-C-0002');
    expect(history.schedule).toEqual([]);
    expect(history.opening).toBeNull();
    expect(history.payments.map((p) => p.installmentNo)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(history.evidences.filter((e) => e.installmentNo === null)).toHaveLength(1);
    expect(history.product.imeiSerial).toBeNull();
    expect(history.notes).toContain('ปิดบัญชีก่อนกำหนดในระบบเก่า');
    expect(history.notes).toContain('ส่วนลด 1595.00');

    const prepaid = item(plan, 'TEST-C-0003');
    expect(prepaid.opening?.priorReceiptMarkers).toEqual([]);
    expect(prepaid.opening?.catchUpLines).toEqual([]);
    expect(prepaid.opening?.stamps.filter((s) => s.accrued).map((s) => s.installmentNo)).toEqual([
      1, 2, 3, 4,
    ]);

    // ยอดแยกของทุกงวด (สูตรของ generatePaymentSchedule) — สี่ยอดรวม = amountDue รวมงวดของสัญญาประวัติ
    for (const planned of plan.items) {
      for (const p of planned.payments) {
        expect(
          p.monthlyPrincipal
            .plus(p.monthlyInterest)
            .plus(p.monthlyCommission)
            .plus(p.vatAmount)
            .toFixed(2),
        ).toBe(p.amountDue.toFixed(2));
      }
    }
    expect(
      [overdue.payments[0], overdue.payments[11]].map((p) => [
        money(p.monthlyPrincipal),
        money(p.monthlyInterest),
        money(p.monthlyCommission),
        money(p.vatAmount),
      ]),
    ).toEqual([
      ['833.33', '500.00', '83.33', '99.17'],
      ['833.37', '500.00', '83.37', '99.13'],
    ]);

    // Σ ค้างของงวด = Σ PEAK (ด่าน 6.2) · ตัวเลขรวมของตารางเชื่อมยอด
    expect(money(plan.totals.outstanding)).toBe(money(plan.totals.peakRemain));
    expect(plan.totals.contracts).toEqual({ active: 2, history: 1, skipped: 0, blocked: 0 });
    expect(plan.totals.markers).toBe(2);
    expect(plan.totals.schedules).toBe(24);
    expect(plan.totals.payments).toBe(24 + 6);
  });

  it('canceled (4) and status-0 contracts → skipped, never blockers (even with a PEAK pair) · bad debt (5) → BAD_DEBT_UNSUPPORTED', () => {
    const a = overdueContract();
    // สมาชิก M4 มีแต่สัญญายกเลิก — ไม่มีรายการในแผน จึงไม่ได้แถวลูกค้า
    const M4: MemberSpec = {
      id: '504',
      code: 'TEST-M-0504',
      nationalId: thaiId('091234567893'),
      phone: '0977000004',
    };
    const canceled = syntheticContract({
      id: '4',
      code: 'TEST-C-0004',
      statusCode: '4',
      date: '2026-02-01',
      memberId: M4.id,
      firstDue: [2026, 2, 1],
    });
    // สัญญายกเลิกของสมาชิกที่มีสัญญานำเข้า — ข้ามเหมือนกัน (สมาชิกยังได้ลูกค้าจากสัญญาที่นำเข้า)
    const canceledOfM1 = syntheticContract({
      id: '9',
      code: 'TEST-C-0009',
      statusCode: '4',
      date: '2026-06-01',
      memberId: M1.id,
      firstDue: [2026, 6, 1],
    });
    const stub = syntheticContract({
      id: '5',
      code: 'TEST-C-0005',
      statusCode: '0',
      date: '2026-03-01',
      memberId: M3.id,
      firstDue: [2026, 3, 1],
    });
    const badDebt = syntheticContract({
      id: '8',
      code: 'TEST-C-0008',
      statusCode: '5',
      date: '2026-04-01',
      memberId: M3.id,
      firstDue: [2026, 4, 1],
    });
    const plan = planImport(
      syntheticBook([a, canceled, canceledOfM1, stub, badDebt], [...members, syntheticMember(M4)]),
      options([
        [a, 'TESTC001'],
        [canceled, 'TESTC004'],
      ]),
    );
    expect(plan.blockers).toEqual([
      { code: 'TEST-C-0008', reason: 'BAD_DEBT_UNSUPPORTED', detail: { legacyStatus: '5' } },
    ]);
    expect(plan.skipped).toEqual([
      { code: 'TEST-C-0004', reason: 'status-4-canceled' },
      { code: 'TEST-C-0009', reason: 'status-4-canceled' },
      { code: 'TEST-C-0005', reason: 'status-0' },
    ]);
    expect(plan.items.map((i) => i.code)).toEqual(['TEST-C-0001']);
    expect(plan.items.map((i) => i.memberCode)).toEqual([M1.code]);
    expect(plan.totals.contracts).toEqual({ active: 1, history: 0, skipped: 3, blocked: 1 });
  });

  it('a contract signed 2025-11-13 (Bangkok) is old-form; 2025-11-14 is not', () => {
    const old = overdueContract({ id: '6', code: 'TEST-C-0006', date: '2025-11-13' });
    const fresh = overdueContract({
      id: '7',
      code: 'TEST-C-0007',
      date: '2025-11-14',
      memberId: M2.id,
    });
    const plan = planImport(
      syntheticBook([old, fresh], members),
      options([
        [old, 'TESTC001'],
        [fresh, 'TESTC002'],
      ]),
    );
    expect(plan.oldFormCodes).toEqual(['TEST-C-0006']);
    expect(item(plan, 'TEST-C-0006').oldForm).toBe(true);
    expect(
      item(plan, 'TEST-C-0006').notes.startsWith(
        '[สัญญาฉบับเก่า: ค่าปรับตามสัญญาเดิม หลัง 3 วัน วันละ 50 บาท]',
      ),
    ).toBe(true);
    expect(item(plan, 'TEST-C-0007').oldForm).toBe(false);
  });

  it('ACTIVE without a PEAK pair → PEAK_UNMATCHED blocker; HISTORY without one is fine', () => {
    const a = overdueContract();
    const b = earlyPayoffContract();
    const plan = planImport(syntheticBook([a, b], members), options([]));
    expect(plan.blockers).toEqual([{ code: 'TEST-C-0001', reason: 'PEAK_UNMATCHED' }]);
    expect(plan.items.map((i) => i.code)).toEqual(['TEST-C-0002']);
    expect(item(plan, 'TEST-C-0002').peak).toBeNull();
  });

  it('PEAK higher than the legacy outstanding → PEAK_HIGHER with the diff', () => {
    const a = overdueContract();
    const plan = planImport(syntheticBook([a], members), {
      ...options([]),
      peakRecon: syntheticRecon([[a, peakMatch(a, 'TESTC001', '6000.00')]]),
    });
    expect(plan.blockers).toEqual([
      {
        code: 'TEST-C-0001',
        reason: 'PEAK_HIGHER',
        detail: { invoiceCode: 'TEST-INV-TEST-C-0001', diff: '736.64' },
      },
    ]);
  });

  it('PEAK higher by a satang gap ≤ 1.00 (flat legacy last installment) → absorbed on the last unpaid installment; Σ outstanding = PEAK', () => {
    // ระบบเก่าเก็บงวด 12 เท่างวดอื่น (1,515.83) → ยอดผ่อนรวมขาด 0.04 จากที่ PEAK แจ้งหนี้
    const a = overdueContract({
      installments: standardInstallments({
        ...Object.fromEntries(
          Array.from({ length: 8 }, (_, i) => [i + 1, { amount: MONTHLY, paid: MONTHLY }]),
        ),
        9: { paid: '300' },
        11: { paid: '500', paidOn: new Date('2026-11-20T09:00:00+07:00') },
        12: { amount: MONTHLY },
      }),
    });
    const plan = planImport(syntheticBook([a], members), {
      ...options([]),
      peakRecon: syntheticRecon([[a, peakMatch(a, 'TESTC001', '5263.36', '18190.00')]]),
    });
    expect(plan.blockers).toEqual([]);
    const planned = item(plan, 'TEST-C-0001');
    expect(planned.warnings.filter((w) => w.startsWith('SATANG_GAP_UNEXPLAINED'))).toEqual([]);
    expect(money(planned.peak!.satangGap)).toBe('0.04');
    expect(planned.peak!.satangGapInstallmentNo).toBe(12);
    expect(money(planned.peak!.adjustment)).toBe('0.00');
    expect(money(planned.payments[11].amountDue)).toBe(LAST);
    expect(money(planned.roundingDiff)).toBe('0.00');
    expect(planned.notes).toContain(
      'ค่างวด 12 รวมเศษสตางค์ 0.04 ตามยอดผ่อนรวมในใบแจ้งหนี้ PEAK TEST-INV-TEST-C-0001',
    );
    expect(money(plan.totals.outstanding)).toBe('5263.36');
    expect(money(plan.totals.peakRemain)).toBe('5263.36');
    expect(money(plan.totals.satangGap)).toBe('0.04');
    expect(plan.totals.satangGapContracts).toBe(1);

    const tooMuch = planImport(syntheticBook([a], members), {
      ...options([]),
      peakRecon: syntheticRecon([[a, peakMatch(a, 'TESTC001', '5264.33')]]),
    });
    expect(tooMuch.blockers).toEqual([
      {
        code: 'TEST-C-0001',
        reason: 'PEAK_HIGHER',
        detail: { invoiceCode: 'TEST-INV-TEST-C-0001', diff: '1.01' },
      },
    ]);
  });

  it('a PEAK-higher gap that is not the invoice-total gap → absorbed but warned SATANG_GAP_UNEXPLAINED (not a blocker)', () => {
    const a = overdueContract();
    // ยอดใบแจ้งหนี้ = Σ ค่างวดระบบเก่า (ไม่มีเศษของยอดผ่อนรวม) แต่ PEAK ค้างสูงกว่า 0.37
    const plan = planImport(syntheticBook([a], members), {
      ...options([]),
      peakRecon: syntheticRecon([[a, peakMatch(a, 'TESTC001', '5263.73')]]),
    });
    expect(plan.blockers).toEqual([]);
    const planned = item(plan, 'TEST-C-0001');
    expect(money(planned.peak!.satangGap)).toBe('0.37');
    expect(planned.warnings.filter((w) => w.startsWith('SATANG_GAP_UNEXPLAINED'))).toHaveLength(1);
  });

  it('PEAK lower by the invoice-total satang gap → TRIM the last unpaid billing: no fake partial payment, no extra marker', () => {
    // ระบบเก่าเรียกเก็บงวด 12 = 1,515.91 (ยอดผ่อนรวม 18,190.04) · ใบแจ้งหนี้ PEAK 18,190.00
    const a = overdueContract({
      installments: standardInstallments({
        ...Object.fromEntries(
          Array.from({ length: 8 }, (_, i) => [i + 1, { amount: MONTHLY, paid: MONTHLY }]),
        ),
        9: { paid: '300' },
        11: { paid: '500', paidOn: new Date('2026-11-20T09:00:00+07:00') },
        12: { amount: '1515.91' },
      }),
    });
    const plan = planImport(syntheticBook([a], members), {
      ...options([]),
      peakRecon: syntheticRecon([[a, peakMatch(a, 'TESTC001', '5263.36', '18190.00')]]),
    });
    expect(plan.blockers).toEqual([]);
    const planned = item(plan, 'TEST-C-0001');
    expect(money(planned.peak!.satangGap)).toBe('-0.04');
    expect(money(planned.peak!.adjustment)).toBe('0.00');
    expect(planned.peak!.satangGapInstallmentNo).toBe(12);
    expect(money(planned.payments[11].amountDue)).toBe(LAST);
    expect(
      planned.payments.filter((p) => p.status === 'PARTIALLY_PAID').map((p) => p.installmentNo),
    ).toEqual([9, 11]);
    expect(planned.payments[9].amountPaid.isZero()).toBe(true);
    expect(planned.opening!.priorReceiptMarkers).toHaveLength(2);
    expect(planned.notes).toContain('ค่างวด 12 ลดเศษสตางค์ 0.04 ตามยอดผ่อนรวมในใบแจ้งหนี้ PEAK');
    expect(money(plan.totals.outstanding)).toBe('5263.36');
    expect([money(plan.totals.satangTrim), plan.totals.satangTrimContracts]).toEqual(['-0.04', 1]);

    // PEAK ต่ำกว่าแต่ไม่ใช่เศษของยอดใบแจ้งหนี้ (เงินรับที่ระบบเก่าไม่ได้บันทึก) → ยอดจ่ายเพิ่มที่งวดค้างงวดแรก (FIFO เดิม)
    const fifo = planImport(syntheticBook([a], members), {
      ...options([]),
      peakRecon: syntheticRecon([[a, peakMatch(a, 'TESTC001', '5263.36')]]),
    });
    const fifoItem = item(fifo, 'TEST-C-0001');
    expect([money(fifoItem.peak!.adjustment), money(fifoItem.peak!.satangGap)]).toEqual([
      '-0.04',
      '0.00',
    ]);
    expect(money(fifoItem.payments[8].amountPaid)).toBe('300.04');

    // ลงบนงวดที่ไม่เคยจ่าย → งวดชำระบางส่วนเศษสตางค์ไม่มีใบรับเงิน = ข้อเตือน PEAK_LOWER_UNEXPLAINED (ไม่บล็อก)
    const c = prepaidContract();
    const lower = planImport(syntheticBook([c], members), {
      ...options([]),
      peakRecon: syntheticRecon([[c, peakMatch(c, 'TESTC003', '12126.64')]]),
    });
    expect(lower.blockers).toEqual([]);
    const lowerItem = item(lower, 'TEST-C-0003');
    expect(money(lowerItem.payments[4].amountPaid)).toBe('0.04');
    expect(lowerItem.warnings.filter((w) => w.startsWith('PEAK_LOWER_UNEXPLAINED'))).toHaveLength(
      1,
    );
  });

  it('contract status uses the system OVERDUE threshold (overdue_days_threshold, default 7) — not "late by one day"', () => {
    const paid = Object.fromEntries(
      Array.from({ length: 4 }, (_, i) => [i + 1, { paid: MONTHLY }]),
    );
    // งวด 5 ครบกำหนด 28 พ.ย. ยังไม่จ่าย = ค้าง ~3 วัน ณ วันตัด
    const a = syntheticContract({
      id: '20',
      code: 'TEST-C-0020',
      date: '2026-06-28',
      memberId: M1.id,
      firstDue: [2026, 6, 28],
      installments: standardInstallments(paid),
    });
    const plan = planImport(syntheticBook([a], members), options([[a, 'TESTC001']]));
    expect(item(plan, 'TEST-C-0020').status).toBe('ACTIVE');
    const strict = planImport(
      syntheticBook([a], members),
      options([[a, 'TESTC001']], { overdueDaysThreshold: 1 }),
    );
    expect(item(strict, 'TEST-C-0020').status).toBe('OVERDUE');
  });

  it('an interest rate that does not fit Decimal(5,4) → INTEREST_RATE_OUT_OF_RANGE; a duplicated legacy code → DUPLICATE_CONTRACT_CODE', () => {
    const a = overdueContract();
    const tiny = planImport(
      syntheticBook([a], members),
      options([[a, 'TESTC001']], {
        moneyOverrides: new Map([
          ['TEST-C-0001', { financedAmount: D(1), storeCommission: D(1000), vatAmount: D(1190) }],
        ]),
      }),
    );
    expect(tiny.blockers).toEqual([
      {
        code: 'TEST-C-0001',
        reason: 'INTEREST_RATE_OUT_OF_RANGE',
        detail: { interestRate: '1333.25' },
      },
    ]);

    const twin = overdueContract({ id: '24', memberId: M2.id });
    const dup = planImport(syntheticBook([a, twin], members), options([[a, 'TESTC001']]));
    expect(dup.blockers).toEqual([
      { code: 'TEST-C-0001', reason: 'DUPLICATE_CONTRACT_CODE' },
      { code: 'TEST-C-0001', reason: 'DUPLICATE_CONTRACT_CODE' },
    ]);
    expect(dup.items).toEqual([]);
  });

  describe('other blockers', () => {
    it('PEAK_NEGATIVE_REMAIN', () => {
      const a = overdueContract();
      const plan = planImport(syntheticBook([a], members), {
        ...options([]),
        peakRecon: syntheticRecon([[a, peakMatch(a, 'TESTC001', '-1')]]),
      });
      expect(plan.blockers).toEqual([
        {
          code: 'TEST-C-0001',
          reason: 'PEAK_NEGATIVE_REMAIN',
          detail: { invoiceCode: 'TEST-INV-TEST-C-0001' },
        },
      ]);
    });

    it('INSTALLMENT_OVERPAID (an ACTIVE installment paid above its billing)', () => {
      const a = overdueContract({
        installments: standardInstallments({
          1: { paid: MONTHLY },
          2: { paid: MONTHLY },
          3: { paid: '1600' },
        }),
      });
      const plan = planImport(syntheticBook([a], members), options([[a, 'TESTC001']]));
      expect(plan.blockers).toEqual([
        { code: 'TEST-C-0001', reason: 'INSTALLMENT_OVERPAID', detail: { installmentNos: '3' } },
      ]);
    });

    it('OPENING_INPUT_INVALID (a negative paid amount reaches computeOpening)', () => {
      const a = overdueContract();
      const third = a.installments[2];
      a.installments[2] = { ...third, paid: D('-10'), balance: third.amount.plus(10) };
      a.receipts = a.receipts.filter((r) => r.installmentLegacyId !== third.legacyId);
      a.receipts.push({
        ...a.receipts[0],
        legacyId: 'NEG-1',
        installmentLegacyId: third.legacyId,
        amount: D('-10'),
        installment: D('-10'),
      });
      const plan = planImport(syntheticBook([a], members), options([[a, 'TESTC001']]));
      expect(plan.blockers).toHaveLength(1);
      expect(plan.blockers[0]).toMatchObject({
        code: 'TEST-C-0001',
        reason: 'OPENING_INPUT_INVALID',
      });
      expect(plan.blockers[0].detail?.message).toContain('OPENING_INPUT_INVALID');
    });

    it('MEMBER_NOT_FOUND and CUSTOMER_INPUT_INVALID', () => {
      const a = overdueContract({ memberId: '999' });
      const noCode = syntheticMember({ ...M2, id: '602', code: '' });
      const b = prepaidContract();
      const bNoCode = { ...b, order: { ...b.order, ref_member: '602' } };
      const plan = planImport(
        syntheticBook([a, bNoCode], [...members, noCode]),
        options([
          [a, 'TESTC001'],
          [bNoCode, 'TESTC003'],
        ]),
      );
      expect(plan.blockers.map((x) => [x.code, x.reason])).toEqual([
        ['TEST-C-0001', 'MEMBER_NOT_FOUND'],
        ['TEST-C-0003', 'CUSTOMER_INPUT_INVALID'],
      ]);
      expect(plan.blockers[1].detail?.message).toContain('member_code');
    });

    it('DUPLICATE_INSTALLMENT_CODE (Payment.legacyInstallmentCode is unique across the table)', () => {
      const a = overdueContract();
      const c = prepaidContract();
      c.installments[0] = { ...c.installments[0], legacyCode: a.installments[0].legacyCode };
      const plan = planImport(
        syntheticBook([a, c], members),
        options([
          [a, 'TESTC001'],
          [c, 'TESTC003'],
        ]),
      );
      expect(plan.blockers.map((x) => [x.code, x.reason, x.detail?.installmentCode])).toEqual([
        ['TEST-C-0001', 'DUPLICATE_INSTALLMENT_CODE', a.installments[0].legacyCode],
        ['TEST-C-0003', 'DUPLICATE_INSTALLMENT_CODE', a.installments[0].legacyCode],
      ]);
    });

    it('a satang gap that lands on a regular installment (the last one already paid) → ROUNDING_BEYOND_TOLERANCE', () => {
      const a = overdueContract({
        installments: standardInstallments({
          ...Object.fromEntries(
            Array.from({ length: 8 }, (_, i) => [i + 1, { amount: MONTHLY, paid: MONTHLY }]),
          ),
          9: { paid: '300' },
          12: { paid: LAST, paidOn: new Date('2026-11-20T09:00:00+07:00') },
        }),
      });
      const plan = planImport(syntheticBook([a], members), {
        ...options([]),
        peakRecon: syntheticRecon([[a, peakMatch(a, 'TESTC001', '4247.53', '18190.04')]]),
      });
      expect(plan.blockers).toEqual([
        {
          code: 'TEST-C-0001',
          reason: 'OPENING_MISMATCH',
          detail: {
            mismatch: 'ROUNDING_BEYOND_TOLERANCE',
            diff: '-0.04',
            expectedRoundingDiff: '-0.04',
            installmentNos: '11',
          },
        },
      ]);
    });

    it('MONEY_READ_ERROR (a malformed detail cell)', () => {
      const a = overdueContract({ detail: { installment_number: 'abc' } });
      const plan = planImport(syntheticBook([a], members), options([[a, 'TESTC001']]));
      expect(plan.blockers).toHaveLength(1);
      expect(plan.blockers[0]).toMatchObject({ code: 'TEST-C-0001', reason: 'MONEY_READ_ERROR' });
    });
  });

  it('a HISTORY contract whose PEAK invoice still has a remain > 0 → HISTORY_WITH_PEAK_REMAIN blocker', () => {
    const b = earlyPayoffContract();
    const plan = planImport(syntheticBook([b], members), options([[b, 'TESTC002', '100']]));
    expect(plan.blockers).toEqual([
      {
        code: 'TEST-C-0002',
        reason: 'HISTORY_WITH_PEAK_REMAIN',
        detail: { invoiceCode: 'TEST-INV-TEST-C-0002', remain: '100.00' },
      },
    ]);
    expect(plan.items).toEqual([]);
    expect(
      planImport(syntheticBook([b], members), options([[b, 'TESTC002', '0']])).blockers,
    ).toEqual([]);
  });

  it('PEAK lower → installments adjusted; Σ outstanding = PEAK and the note names the invoice', () => {
    const a = overdueContract();
    const plan = planImport(syntheticBook([a], members), {
      ...options([]),
      peakRecon: syntheticRecon([[a, peakMatch(a, 'TESTC001', '5000.00')]]),
    });
    expect(plan.blockers).toEqual([]);
    const planned = item(plan, 'TEST-C-0001');
    expect(money(planned.peak!.adjustment)).toBe('-263.36');
    expect(money(plan.totals.outstanding)).toBe('5000.00');
    expect(planned.notes).toContain('ใบแจ้งหนี้ PEAK TEST-INV-TEST-C-0001 (-263.36)');
  });

  it('LegacyMoneyError → LEGACY_MONEY_INVALID blocker with the field names', () => {
    const a = overdueContract({ detail: { finance: '0', ref_product_price: '2000' } });
    const plan = planImport(syntheticBook([a], members), options([[a, 'TESTC001']]));
    expect(plan.blockers).toEqual([
      { code: 'TEST-C-0001', reason: 'LEGACY_MONEY_INVALID', detail: { fields: 'financedAmount' } },
    ]);
    expect(plan.items).toEqual([]);
  });

  it('a BLOCK: warning from mapPayments (ACTIVE with a payoff row) → PAYMENTS_BLOCK', () => {
    const a = overdueContract({
      close: { amount: '100', discount: '0', date: new Date('2026-10-01T10:00:00+07:00') },
    });
    const plan = planImport(syntheticBook([a], members), options([[a, 'TESTC001']]));
    expect(plan.blockers).toHaveLength(1);
    expect(plan.blockers[0]).toMatchObject({ code: 'TEST-C-0001', reason: 'PAYMENTS_BLOCK' });
    expect(plan.blockers[0].detail?.message).toContain('TEST-C-0001');
    expect(plan.blockers[0].detail?.message.startsWith('BLOCK')).toBe(false);
  });

  it('opening error → OPENING_MISMATCH row with mismatch reason, diff, expectedRoundingDiff and installmentNos', () => {
    // งวด 3 เรียกเก็บ 1,515.84 (ในเกณฑ์ 0.01) จ่าย 1,515.83 = ล้างในบัญชีครบแต่ยอดเรียกเก็บยังค้าง 0.01
    const a = syntheticContract({
      id: '8',
      code: 'TEST-C-0008',
      date: '2026-01-05',
      memberId: M1.id,
      firstDue: [2026, 1, 5],
      installments: standardInstallments({
        1: { paid: MONTHLY },
        2: { paid: MONTHLY },
        3: { amount: '1515.84', paid: MONTHLY },
      }),
    });
    const plan = planImport(syntheticBook([a], members), options([[a, 'TESTC001']]));
    expect(plan.blockers).toEqual([
      {
        code: 'TEST-C-0008',
        reason: 'OPENING_MISMATCH',
        detail: {
          mismatch: 'INSTALLMENT_SETTLED_BELOW_BILLING',
          diff: '-0.01',
          expectedRoundingDiff: '-0.01',
          installmentNos: '3',
        },
      },
    ]);
  });

  it('billing within the rounding tolerance → roundingDiff on the item and in the totals', () => {
    const a = syntheticContract({
      id: '9',
      code: 'TEST-C-0009',
      date: '2026-06-05',
      memberId: M1.id,
      firstDue: [2026, 6, 5],
      installments: Array.from({ length: 12 }, (_, i) => ({ amount: i === 11 ? LAST : '1515.84' })),
    });
    const plan = planImport(syntheticBook([a], members), options([[a, 'TESTC001']]));
    expect(plan.blockers).toEqual([]);
    expect(money(item(plan, 'TEST-C-0009').roundingDiff)).toBe('-0.11');
    expect(money(plan.totals.roundingDiff)).toBe('-0.11');
    expect(plan.totals.roundingContracts).toBe(1);
  });

  it('a legacy amount beyond tolerance → INSTALLMENT_AMOUNT_MISMATCH (override flag reported)', () => {
    const a = syntheticContract({
      id: '10',
      code: 'TEST-C-0010',
      date: '2026-06-05',
      memberId: M1.id,
      firstDue: [2026, 6, 5],
      installments: standardInstallments({ 4: { amount: '1600.00' } }),
    });
    const plan = planImport(syntheticBook([a], members), options([[a, 'TESTC001']]));
    expect(plan.blockers).toEqual([
      {
        code: 'TEST-C-0010',
        reason: 'INSTALLMENT_AMOUNT_MISMATCH',
        detail: { installmentNos: '4', override: 'no' },
      },
    ]);
  });

  it('an ACTIVE contract with nothing outstanding → ACTIVE_NOTHING_OUTSTANDING', () => {
    const a = syntheticContract({
      id: '11',
      code: 'TEST-C-0011',
      date: '2025-10-05',
      memberId: M1.id,
      firstDue: [2025, 10, 5],
      installments: standardInstallments(
        Object.fromEntries(
          Array.from({ length: 12 }, (_, i) => [i + 1, { paid: i === 11 ? LAST : MONTHLY }]),
        ),
      ),
    });
    const plan = planImport(syntheticBook([a], members), options([[a, 'TESTC001']]));
    expect(plan.blockers).toEqual([{ code: 'TEST-C-0011', reason: 'ACTIVE_NOTHING_OUTSTANDING' }]);
  });

  it('a PAID installment without a receipt date → paidDate = cutoff + note', () => {
    const a = overdueContract({
      installments: standardInstallments({
        1: { paid: MONTHLY, noReceipt: true },
        2: { paid: MONTHLY },
      }),
    });
    const plan = planImport(syntheticBook([a], members), options([[a, 'TESTC001']]));
    const [first, second] = item(plan, 'TEST-C-0001').payments;
    expect(first.status).toBe('PAID');
    expect(first.paidDate?.toISOString()).toBe(CUTOFF.toISOString());
    expect(first.notes).toContain('ใช้วันตัดระบบ');
    expect(second.paidDate?.toISOString()).toBe(
      new Date('2026-03-05T00:00:00+07:00').toISOString(),
    );
    expect(plan.totals.paidDateFromCutoff).toBe(1);
  });

  it('customer checks: invalid national id blocks unless overridden; two PEAK codes for one member block the later contract', () => {
    const bad: MemberSpec = { ...M1, id: '601', code: 'TEST-M-0601', nationalId: BAD_ID };
    const a = overdueContract({ memberId: bad.id });
    const book = syntheticBook([a], [...members, syntheticMember(bad)]);
    expect(planImport(book, options([[a, 'TESTC001']])).blockers).toEqual([
      {
        code: 'TEST-C-0001',
        reason: 'CUSTOMER_INVALID_NATIONAL_ID',
        detail: { memberCode: 'TEST-M-0601' },
      },
    ]);
    const overridden = planImport(
      book,
      options([[a, 'TESTC001']], { customerOverrides: new Map([['TEST-M-0601', 'cust-1']]) }),
    );
    expect(overridden.blockers).toEqual([]);
    expect(item(overridden, 'TEST-C-0001').customer.overrideCustomerId).toBe('cust-1');

    const first = overdueContract({ id: '12', code: 'TEST-C-0012', date: '2026-01-05' });
    const second = prepaidContract();
    const sameMember = { ...second, order: { ...second.order, ref_member: M1.id } };
    const conflict = planImport(
      syntheticBook([first, sameMember], members),
      options([
        [first, 'TESTC001'],
        [sameMember, 'TESTC009'],
      ]),
    );
    expect(conflict.blockers).toEqual([
      {
        code: 'TEST-C-0003',
        reason: 'CUSTOMER_PEAK_CODE_CONFLICT',
        detail: {
          memberCode: 'TEST-M-0501',
          peakContactCode: 'TESTC009',
          otherPeakContactCode: 'TESTC001',
        },
      },
    ]);
    expect(conflict.items.map((i) => i.code)).toEqual(['TEST-C-0012']);

    // สัญญาแรกของสมาชิกติดตัวบล็อกอื่น (ไม่มีคู่ PEAK ไม่ได้ — ใช้ PEAK สูงกว่า) → ยังเห็นรหัสชนกัน
    const hidden = planImport(syntheticBook([first, sameMember], members), {
      ...options([]),
      peakRecon: syntheticRecon([
        [first, peakMatch(first, 'TESTC001', '99999.00')],
        [sameMember, peakMatch(sameMember, 'TESTC009')],
      ]),
    });
    expect(hidden.blockers.map((b) => [b.code, b.reason])).toEqual([
      ['TEST-C-0012', 'PEAK_HIGHER'],
      ['TEST-C-0003', 'CUSTOMER_PEAK_CODE_CONFLICT'],
    ]);
    expect(hidden.items).toEqual([]);
  });

  it('owner files naming codes that do not exist → blockers tagged with the file', () => {
    const a = overdueContract();
    const plan = planImport(
      syntheticBook([a], members),
      options([[a, 'TESTC001']], {
        moneyOverrides: new Map([
          ['TEST-C-8888', { financedAmount: D(1), storeCommission: D(0), vatAmount: D(0) }],
        ]),
        customerOverrides: new Map([['TEST-M-7777', 'cust-x']]),
      }),
    );
    expect(plan.blockers).toEqual([
      {
        code: 'TEST-C-8888',
        reason: 'MONEY_OVERRIDE_UNKNOWN_CONTRACT',
        detail: { source: 'money-overrides' },
      },
      {
        code: 'TEST-M-7777',
        reason: 'CUSTOMER_OVERRIDE_UNKNOWN_MEMBER',
        detail: { source: 'customer-overrides' },
      },
    ]);
    expect(plan.totals.contracts).toEqual({ active: 1, history: 0, skipped: 0, blocked: 0 });
  });

  it('two ACTIVE contracts on one IMEI → both blocked; ACTIVE + HISTORY on one IMEI is fine (HISTORY has no imeiSerial)', () => {
    const a = overdueContract({ imei: '359990000000077' });
    const c = {
      ...prepaidContract(),
      detail: { ...prepaidContract().detail, mobile_imei: '359990000000077' },
    };
    const dup = planImport(
      syntheticBook([a, c], members),
      options([
        [a, 'TESTC001'],
        [c, 'TESTC003'],
      ]),
    );
    expect(dup.blockers.map((b) => [b.code, b.reason])).toEqual([
      ['TEST-C-0001', 'DUPLICATE_ACTIVE_IMEI'],
      ['TEST-C-0003', 'DUPLICATE_ACTIVE_IMEI'],
    ]);

    const b = {
      ...earlyPayoffContract(),
      detail: { ...earlyPayoffContract().detail, mobile_imei: '359990000000077' },
    };
    const ok = planImport(
      syntheticBook([a, b], members),
      options([
        [a, 'TESTC001'],
        [b, 'TESTC002', '0'],
      ]),
    );
    expect(ok.blockers).toEqual([]);
    expect(item(ok, 'TEST-C-0002').product.legacyProductCode).toBe('TEST-C-0002/359990000000077');
  });

  it('upload details → missingAttachments per contract (not a blocker)', () => {
    const a = overdueContract();
    const files = new Map<string, LegacyFileDetail>();
    const planned = planImport(syntheticBook([a], members), options([[a, 'TESTC001']]));
    for (const path of item(planned, 'TEST-C-0001').attachmentPaths.slice(1)) {
      files.set(path, { key: `k/${path}`, size: 1, sha256: 'ab', contentType: 'image/jpeg' });
    }
    const plan = planImport(syntheticBook([a], members), options([[a, 'TESTC001']], { files }));
    expect(plan.blockers).toEqual([]);
    expect(item(plan, 'TEST-C-0001').missingAttachments).toEqual([
      'uploads/contract/TEST-TEST-C-0001.jpg',
    ]);
    expect(plan.totals.missingAttachments).toBe(1);
  });

  it('blocker detail never carries customer data', () => {
    const bad: MemberSpec = { ...M1, id: '601', code: 'TEST-M-0601', nationalId: BAD_ID };
    const a = overdueContract({ memberId: bad.id });
    const plan = planImport(syntheticBook([a], [syntheticMember(bad)]), options([[a, 'TESTC001']]));
    const json = JSON.stringify(plan.blockers);
    expect(json).not.toContain(BAD_ID);
    expect(json).not.toContain('0977000001');
    expect(json).not.toContain('ทดสอบระบบ');
  });
});
