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

function options(
  matches: Array<[LegacyContract, string]>,
  over: Partial<ImportOptions> = {},
): ImportOptions {
  return {
    cutoff: CUTOFF,
    peakRecon: syntheticRecon(matches.map(([c, contact]) => [c, peakMatch(c, contact)])),
    canceledMap: new Map(),
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
        [b, 'TESTC002'],
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

    // Σ ค้างของงวด = Σ PEAK (ด่าน 6.2) · ตัวเลขรวมของตารางเชื่อมยอด
    expect(money(plan.totals.outstanding)).toBe(money(plan.totals.peakRemain));
    expect(plan.totals.contracts).toEqual({ active: 2, history: 1, skipped: 0, blocked: 0 });
    expect(plan.totals.markers).toBe(2);
    expect(plan.totals.schedules).toBe(24);
    expect(plan.totals.payments).toBe(24 + 6);
  });

  it('an unconfirmed canceled contract → exactly one blocker; a status-0 contract → skipped', () => {
    const a = overdueContract();
    const canceled = syntheticContract({
      id: '4',
      code: 'TEST-C-0004',
      statusCode: '4',
      date: '2026-02-01',
      memberId: M2.id,
      firstDue: [2026, 2, 1],
    });
    const stub = syntheticContract({
      id: '5',
      code: 'TEST-C-0005',
      statusCode: '0',
      date: '2026-03-01',
      memberId: M3.id,
      firstDue: [2026, 3, 1],
    });
    const plan = planImport(
      syntheticBook([a, canceled, stub], members),
      options([[a, 'TESTC001']]),
    );
    expect(plan.blockers).toEqual([
      { code: 'TEST-C-0004', reason: 'CANCELED_UNCONFIRMED', detail: { legacyStatus: '4' } },
    ]);
    expect(plan.skipped).toEqual([{ code: 'TEST-C-0005', reason: 'status-0' }]);
    expect(plan.items.map((i) => i.code)).toEqual(['TEST-C-0001']);

    const confirmed = planImport(
      syntheticBook([a, canceled], members),
      options([[a, 'TESTC001']], { canceledMap: new Map([['TEST-C-0004', 'CANCELED']]) }),
    );
    expect(confirmed.blockers).toEqual([]);
    expect(item(confirmed, 'TEST-C-0004').status).toBe('CANCELED');
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
        canceledMap: new Map([
          ['TEST-C-9999', 'CANCELED'],
          ['TEST-C-0001', 'CANCELED'],
        ]),
        moneyOverrides: new Map([
          ['TEST-C-8888', { financedAmount: D(1), storeCommission: D(0), vatAmount: D(0) }],
        ]),
        customerOverrides: new Map([['TEST-M-7777', 'cust-x']]),
      }),
    );
    expect(plan.blockers).toEqual([
      {
        code: 'TEST-C-9999',
        reason: 'CANCELED_MAP_UNKNOWN_CONTRACT',
        detail: { source: 'canceled-map' },
      },
      {
        code: 'TEST-C-0001',
        reason: 'CANCELED_MAP_NOT_CANCELED',
        detail: { source: 'canceled-map', legacyStatus: '2' },
      },
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
        [b, 'TESTC002'],
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
