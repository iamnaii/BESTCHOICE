import { Prisma } from '@prisma/client';
import { bangkokMidnight } from '../../../utils/date.util';
import type { DumpRow } from '../dump-reader';
import type { LegacyContract, LegacyInstallment } from '../legacy-book';
import {
  applyPeakBalance,
  checkInstallmentAmounts,
  mapContractMoney,
  parseMoneyOverridesCsv,
  type ContractMoney,
} from '../money';

/**
 * แปลงยอดเงินสัญญาระบบเก่า — ข้อมูลสังเคราะห์ทั้งหมด (รหัส TEST-*, ยอดตามตัวอย่าง CPA 17,000 / 12 งวด)
 *
 * สัญญามาตรฐาน: ยอดจัด 10,000 · ค่าคอม 1,000 · ดอกเบี้ย 6,000 · VAT 1,190 (7% ของ 17,000) · 12 งวด
 * → งวด 1–11 = 1,416.66 + 99.17 = 1,515.83 · งวด 12 รับเศษ = 1,416.74 + 99.13 = 1,515.87
 */

const D = (value: string) => new Prisma.Decimal(value);
const MONTHLY = '1515.83';
const LAST = '1515.87';

function detail(over: Record<string, string | null> = {}): DumpRow {
  return {
    ref_order_id: '101',
    ref_product_price: '12000',
    deposit: '2000',
    finance: '10000',
    commission_admin: '1000',
    sales_tax: '1190',
    installment_total: '18190',
    installment_number: '12',
    installment_amount: MONTHLY,
    ...over,
  };
}

/** งวดตามค่างวดที่ให้ — ครบกำหนดวันที่ 5 ทุกเดือนตั้งแต่ ก.พ. 2026 · `paid`/`balance` = [จ่ายแล้ว, คงเหลือ] */
function installments(amounts: string[], paidBalance?: [string, string][]): LegacyInstallment[] {
  return amounts.map((amount, i) => {
    const [paid, balance] = paidBalance?.[i] ?? ['0', amount];
    return {
      legacyId: String(1000 + i),
      legacyCode: `TEST-I-${1000 + i}`,
      dueDate: bangkokMidnight(2026, 1 + i, 5),
      amount: D(amount),
      paid: D(paid),
      balance: D(balance),
      statusCode: '0',
    };
  });
}

function standardAmounts(): string[] {
  return [...Array(11).fill(MONTHLY), LAST];
}

function contract(over: Record<string, string | null> = {}): LegacyContract {
  return {
    contractId: '1',
    code: 'TEST-C-0001',
    statusCode: '2',
    createdAt: new Date('2026-01-05T10:00:00+07:00'),
    order: { order_id: '101', ref_member: '501' },
    detail: detail(over),
    installments: installments(standardAmounts()),
    receipts: [],
    close: null,
    files: [],
  };
}

/** ค่าเงินเป็นข้อความทศนิยม 2 ตำแหน่ง — อ่านผลง่ายและไม่ขึ้นกับรูปของ Decimal */
function money(m: ContractMoney) {
  const fixed = (v: Prisma.Decimal | null) => (v === null ? null : v.toFixed(2));
  return {
    sellingPrice: fixed(m.sellingPrice),
    downPayment: fixed(m.downPayment),
    financedAmount: fixed(m.financedAmount),
    storeCommission: fixed(m.storeCommission),
    interestTotal: fixed(m.interestTotal),
    vatAmount: fixed(m.vatAmount),
    vatPct: m.vatPct === null ? null : m.vatPct.toFixed(4),
    interestRate: m.interestRate.toFixed(4),
    monthlyPayment: fixed(m.monthlyPayment),
    totalMonths: m.totalMonths,
  };
}

describe('mapContractMoney', () => {
  it('maps the legacy detail row with the real interest (installment_total − financed − commission − vat)', () => {
    expect(money(mapContractMoney(contract()))).toEqual({
      sellingPrice: '12000.00',
      downPayment: '2000.00',
      financedAmount: '10000.00',
      storeCommission: '1000.00',
      interestTotal: '6000.00',
      vatAmount: '1190.00',
      vatPct: '0.0700',
      // อัตราต่อเดือนแบบคงที่ = 6,000 ÷ 10,000 ÷ 12
      interestRate: '0.0500',
      monthlyPayment: MONTHLY,
      totalMonths: 12,
    });
  });

  it('falls back to selling price − deposit when finance is 0', () => {
    const m = mapContractMoney(contract({ finance: '0', ref_product_price: '11500' }));
    expect(m.financedAmount.toFixed(2)).toBe('9500.00');
    expect(m.interestTotal.toFixed(2)).toBe('6500.00');
  });

  it('commission_admin 0 → a concrete 10% of the original financed amount (never null)', () => {
    const m = mapContractMoney(contract({ commission_admin: '0' }));
    expect(m.storeCommission).not.toBeNull();
    expect(m.storeCommission.toFixed(2)).toBe('1000.00');
    // 10% ของยอดจัดเดิม ไม่ใช่ของยอดที่รวมดอก — ดอกเบี้ยยังเท่าเดิม และค่างวดยังตรงทุกงวด
    expect(m.interestTotal.toFixed(2)).toBe('6000.00');
    expect(checkInstallmentAmounts(m, installments(standardAmounts()))).toEqual([]);
  });

  it('commission fallback rounds 10% to 2 decimals', () => {
    const m = mapContractMoney(contract({ commission_admin: '0', finance: '9999.95' }));
    expect(m.storeCommission.toFixed(2)).toBe('1000.00');
    expect(
      mapContractMoney(
        contract({ commission_admin: '0', finance: '9999' }),
      ).storeCommission.toFixed(2),
    ).toBe('999.90');
  });

  it('interestRate = interestTotal ÷ financed ÷ months (monthly flat, HALF_UP 4 dp); interestTotal stays legacy', () => {
    const even = mapContractMoney(contract({ finance: '10900', installment_total: '19630' }));
    expect([even.interestTotal.toFixed(2), even.interestRate.toFixed(4)]).toEqual([
      '6540.00',
      '0.0500',
    ]);
    const rounded = mapContractMoney(contract({ installment_total: '17190' }));
    // 5,000 ÷ 10,000 ÷ 12 = 0.041666… → 0.0417 · ดอกเบี้ยรวมไม่คิดใหม่จากอัตราที่ปัด (ไม่ใช่ 5,004)
    expect([rounded.interestTotal.toFixed(2), rounded.interestRate.toFixed(4)]).toEqual([
      '5000.00',
      '0.0417',
    ]);
    // 7,147.20 ÷ 8,000 ÷ 12 = 0.07445 พอดี → HALF_UP 0.0745 (ROUND_DOWN / HALF_EVEN ได้ 0.0744)
    const halfUp = mapContractMoney(contract({ finance: '8000', installment_total: '17337.20' }));
    expect([halfUp.interestTotal.toFixed(2), halfUp.interestRate.toFixed(4)]).toEqual([
      '7147.20',
      '0.0745',
    ]);
  });

  it('interestRate 0 when the financed amount is 0 (no division)', () => {
    const m = mapContractMoney(contract({ finance: '0', ref_product_price: '2000' }));
    expect([m.financedAmount.toFixed(2), m.interestRate.toFixed(4)]).toEqual(['0.00', '0.0000']);
  });

  it('sales_tax 0 → explicit zero VAT (vatAmount 0, vatPct 0 — not null, which means +7%)', () => {
    const m = mapContractMoney(contract({ sales_tax: '0' }));
    expect(m.vatAmount?.toFixed(2)).toBe('0.00');
    expect(m.vatPct?.toFixed(4)).toBe('0.0000');
    expect(m.interestTotal.toFixed(2)).toBe('7190.00');
  });

  it('interest never goes below 0', () => {
    const m = mapContractMoney(contract({ installment_total: '11000' }));
    expect(m.interestTotal.toFixed(2)).toBe('0.00');
  });

  it('empty money cells read as 0 (finance → fallback, commission → 10%)', () => {
    const m = mapContractMoney(contract({ finance: null, commission_admin: '' }));
    expect(m.financedAmount.toFixed(2)).toBe('10000.00');
    expect(m.storeCommission.toFixed(2)).toBe('1000.00');
  });

  it('uses the override instead of the legacy financed / commission / vat', () => {
    const m = mapContractMoney(contract(), {
      financedAmount: D('9500'),
      storeCommission: D('950'),
      vatAmount: D('1190'),
    });
    expect(money(m)).toMatchObject({
      sellingPrice: '12000.00',
      downPayment: '2000.00',
      financedAmount: '9500.00',
      storeCommission: '950.00',
      vatAmount: '1190.00',
      vatPct: '0.0700',
      interestTotal: '6550.00',
    });
  });

  it('override vat 0 = explicit no VAT (not the 7% default); empty = null', () => {
    const noVat = mapContractMoney(contract({ sales_tax: '0' }), {
      financedAmount: D('10000'),
      storeCommission: D('1000'),
      vatAmount: D('0'),
    });
    expect(noVat.vatAmount?.toFixed(2)).toBe('0.00');
    expect(noVat.vatPct?.toFixed(4)).toBe('0.0000');
    expect(noVat.interestTotal.toFixed(2)).toBe('7190.00');

    const unknown = mapContractMoney(contract(), {
      financedAmount: D('10000'),
      storeCommission: D('1000'),
      vatAmount: null,
    });
    expect(unknown.vatAmount).toBeNull();
    expect(unknown.vatPct).toBeNull();
  });

  it.each([
    ['0', 'ไม่ใช่จำนวนเต็มบวก'],
    ['12.5', 'ไม่ใช่จำนวนเต็มบวก'],
    [null, 'ไม่มีค่า'],
  ])('installment_number %p → throws naming contract and column', (value, what) => {
    expect(() => mapContractMoney(contract({ installment_number: value }))).toThrow(
      `contract_id=1 ตาราง \`bestchoice_order_product_detail\` ช่อง installment_number — ${what}`,
    );
  });

  it('malformed money → throws without echoing the cell', () => {
    let message = '';
    try {
      mapContractMoney(contract({ finance: '12,5x9' }));
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('ช่อง finance — จำนวนเงินผิดรูปแบบ');
    expect(message).not.toContain('12,5x9');
  });

  it('missing column → throws (the dump structure changed)', () => {
    const c = contract();
    delete c.detail.sales_tax;
    expect(() => mapContractMoney(c)).toThrow('ช่อง sales_tax — ไม่มีคอลัมน์');
  });
});

describe('checkInstallmentAmounts', () => {
  it('12 installments whose principal + interest + VAT equal the legacy amounts → []', () => {
    const m = mapContractMoney(contract());
    expect(checkInstallmentAmounts(m, installments(standardAmounts()))).toEqual([]);
  });

  it('installment 5 off by 3 baht → one mismatch at installmentNo 5', () => {
    const m = mapContractMoney(contract());
    const amounts = standardAmounts();
    amounts[4] = '1518.83';
    const result = checkInstallmentAmounts(m, installments(amounts));
    expect(
      result.map((r) => [r.installmentNo, r.legacy.toFixed(2), r.computed.toFixed(2)]),
    ).toEqual([[5, '1518.83', MONTHLY]]);
  });

  it('tolerates 0.01 on a middle installment, not 0.02', () => {
    const m = mapContractMoney(contract());
    const amounts = standardAmounts();
    amounts[2] = '1515.84';
    amounts[3] = '1515.81';
    expect(checkInstallmentAmounts(m, installments(amounts)).map((r) => r.installmentNo)).toEqual([
      4,
    ]);
  });

  it('the last installment may absorb up to 1.00 of rounding', () => {
    const m = mapContractMoney(contract());
    const within = [...Array(11).fill(MONTHLY), '1516.87'];
    expect(checkInstallmentAmounts(m, installments(within))).toEqual([]);
    const beyond = [...Array(11).fill(MONTHLY), '1516.88'];
    const result = checkInstallmentAmounts(m, installments(beyond));
    expect(result.map((r) => [r.installmentNo, r.computed.toFixed(2)])).toEqual([[12, LAST]]);
  });

  it('sales_tax 0 is checked as no VAT; an override with empty VAT (null) gets the system 7%', () => {
    const amounts = [...Array(11).fill('1416.66'), '1416.74'];
    const m = mapContractMoney(
      contract({ sales_tax: '0', installment_total: '17000', installment_amount: '1416.66' }),
    );
    expect(checkInstallmentAmounts(m, installments(amounts))).toEqual([]);
    // computeInstallmentBreakdown: vatAmount null → 7% ของยอดก่อน VAT
    const sevenPct = mapContractMoney(contract({ sales_tax: '0', installment_total: '17000' }), {
      financedAmount: D('10000'),
      storeCommission: D('1000'),
      vatAmount: null,
    });
    expect(checkInstallmentAmounts(sevenPct, installments(amounts))).toHaveLength(12);
  });

  it('a missing legacy installment is a mismatch (legacy 0)', () => {
    const m = mapContractMoney(contract());
    const result = checkInstallmentAmounts(m, installments(standardAmounts().slice(0, 11)));
    expect(
      result.map((r) => [r.installmentNo, r.legacy.toFixed(2), r.computed.toFixed(2)]),
    ).toEqual([[12, '0.00', LAST]]);
  });

  it('an extra legacy installment is a mismatch (computed 0) whatever its amount', () => {
    const m = mapContractMoney(contract());
    const result = checkInstallmentAmounts(m, installments([...standardAmounts(), '0']));
    expect(
      result.map((r) => [r.installmentNo, r.legacy.toFixed(2), r.computed.toFixed(2)]),
    ).toEqual([[13, '0.00', '0.00']]);
  });
});

describe('applyPeakBalance', () => {
  /** งวด 1 จ่ายครบ · งวด 2–4 ค้างงวดละ 1,000 → ระบบเก่าค้าง 3,000 */
  function book(): LegacyInstallment[] {
    return installments(
      ['1000', '1000', '1000', '1000'],
      [
        ['1000', '0'],
        ['0', '1000'],
        ['0', '1000'],
        ['0', '1000'],
      ],
    );
  }
  const view = (list: LegacyInstallment[]) =>
    list.map((i) => [i.paid.toFixed(2), i.balance.toFixed(2)]);

  it('PEAK 2,500 vs legacy 3,000 → first unpaid installment gets +500 paid, adjustment −500', () => {
    const inst = book();
    const result = applyPeakBalance(inst, D('2500'));
    if ('blocked' in result) throw new Error('unexpected block');
    expect(result.adjustment.toFixed(2)).toBe('-500.00');
    expect(view(result.installments)).toEqual([
      ['1000.00', '0.00'],
      ['500.00', '500.00'],
      ['0.00', '1000.00'],
      ['0.00', '1000.00'],
    ]);
    // ไม่แก้ของเดิม
    expect(view(inst)).toEqual(view(book()));
  });

  it('a larger gap walks on through the next installments in due-date order', () => {
    const result = applyPeakBalance(book(), D('800'));
    if ('blocked' in result) throw new Error('unexpected block');
    expect(result.adjustment.toFixed(2)).toBe('-2200.00');
    expect(view(result.installments)).toEqual([
      ['1000.00', '0.00'],
      ['1000.00', '0.00'],
      ['1000.00', '0.00'],
      ['200.00', '800.00'],
    ]);
  });

  it('PEAK 3,400 → blocked PEAK_HIGHER diff 400, installments untouched', () => {
    const inst = book();
    const result = applyPeakBalance(inst, D('3400'));
    expect('blocked' in result && result.blocked).toBe('PEAK_HIGHER');
    expect('blocked' in result && result.diff.toFixed(2)).toBe('400.00');
    expect(view(inst)).toEqual(view(book()));
  });

  it('equal balances → adjustment 0 and the same amounts', () => {
    const result = applyPeakBalance(book(), D('3000'));
    if ('blocked' in result) throw new Error('unexpected block');
    expect(result.adjustment.toFixed(2)).toBe('0.00');
    expect(view(result.installments)).toEqual(view(book()));
  });

  it('counts only positive balances (like legacyOutstanding) and never touches an overpaid installment', () => {
    const inst = installments(
      ['1000', '1000', '1000'],
      [
        ['1200', '-200'],
        ['300', '700'],
        ['0', '1000'],
      ],
    );
    // ค้าง 1,700 (ไม่หัก −200) · PEAK 1,000 → ปรับ −700 ที่งวด 2 ซึ่งจ่ายมาบางส่วนแล้ว
    const result = applyPeakBalance(inst, D('1000'));
    if ('blocked' in result) throw new Error('unexpected block');
    expect(result.adjustment.toFixed(2)).toBe('-700.00');
    expect(view(result.installments)).toEqual([
      ['1200.00', '-200.00'],
      ['1000.00', '0.00'],
      ['0.00', '1000.00'],
    ]);
  });

  it('negative PEAK remain → throws', () => {
    expect(() => applyPeakBalance(book(), D('-1'))).toThrow('ยอดค้างใน PEAK ติดลบ');
  });
});

describe('parseMoneyOverridesCsv', () => {
  const HEADER = 'legacy_code,financed_amount,store_commission,vat_amount';

  it('reads overrides by legacy contract code; empty vat = null, 0 = explicit 0', () => {
    const map = parseMoneyOverridesCsv(
      `\uFEFF${HEADER}\nTEST-C-0001,"9,500.00",950,1190\nTEST-C-0002,10000,1000,\nTEST-C-0003,10000,1000,0\n`,
    );
    expect([...map.keys()]).toEqual(['TEST-C-0001', 'TEST-C-0002', 'TEST-C-0003']);
    const one = map.get('TEST-C-0001');
    expect([one?.financedAmount.toFixed(2), one?.storeCommission.toFixed(2)]).toEqual([
      '9500.00',
      '950.00',
    ]);
    expect(one?.vatAmount?.toFixed(2)).toBe('1190.00');
    expect(map.get('TEST-C-0002')?.vatAmount).toBeNull();
    expect(map.get('TEST-C-0003')?.vatAmount?.toFixed(2)).toBe('0.00');
  });

  it('duplicate contract → throws with both lines', () => {
    expect(() =>
      parseMoneyOverridesCsv(`${HEADER}\nTEST-C-0001,1,1,1\nTEST-C-0001,2,2,2\n`),
    ).toThrow('บรรทัด 3 ช่อง legacy_code — สัญญาซ้ำกับบรรทัด 2');
  });

  it.each([
    ['TEST-C-0001,,1000,0', 'ช่อง financed_amount — ไม่มีค่า'],
    ['TEST-C-0001,0,1000,0', 'ช่อง financed_amount — ต้องมากกว่า 0'],
    ['TEST-C-0001,10000,-1,0', 'ช่อง store_commission — ติดลบไม่ได้'],
    ['TEST-C-0001,10000,1000,-5', 'ช่อง vat_amount — ติดลบไม่ได้'],
    ['TEST-C-0001,10000,abc,0', 'ช่อง store_commission — จำนวนเงินผิดรูปแบบ'],
  ])('%s → %s', (line, message) => {
    expect(() => parseMoneyOverridesCsv(`${HEADER}\n${line}\n`)).toThrow(`บรรทัด 2 ${message}`);
  });

  it('missing column → throws listing it', () => {
    expect(() => parseMoneyOverridesCsv('legacy_code,financed_amount\nTEST-C-0001,1\n')).toThrow(
      'ไม่มีคอลัมน์ store_commission, vat_amount',
    );
  });
});
