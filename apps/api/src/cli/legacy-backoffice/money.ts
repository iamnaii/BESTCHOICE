import { Prisma } from '@prisma/client';
import { computeInstallmentBreakdown } from '../../modules/journal/compute-installment-breakdown';
import { resolveStoreCommission } from '../../utils/store-commission.util';
import { parseMoney, readCsv, type CsvRow } from './csv';
import type { LegacyContract, LegacyInstallment } from './legacy-book';
import { legacyOutstanding } from './peak-recon';

/**
 * ยอดเงินของสัญญาระบบเก่า (Task 4 · ร่าง 5) — ฟังก์ชันบริสุทธิ์ ไม่แตะฐานข้อมูล
 *
 * สูตรตามสคริปต์เดิม `scripts/import-legacy/index.ts` (แถว `bestchoice_order_product_detail`):
 * - `financedAmount` = `finance` (> 0) ไม่งั้น `ref_product_price − deposit`
 * - `storeCommission` = `commission_admin` (> 0) ไม่งั้น 10% ของยอดจัด (`resolveStoreCommission` ตัวเดียวกับ
 *   ระบบ) — **เขียนเป็นตัวเลขเสมอ** ห้ามว่าง: ค่าว่างทำให้ระบบคิด 10% ใหม่ทุกครั้งที่อ่าน
 * - `vatAmount` = `sales_tax` · 0 → **0 (ไม่มี VAT)** ไม่ใช่ null — null ในระบบใหม่แปลว่า "VAT 7% ของยอดก่อน VAT"
 *   (`computeInstallmentBreakdown`) · `vatPct` = 0.07 เมื่อมี VAT ไม่งั้น 0
 * - `interestTotal` = max(0, `installment_total − financed − commission − vat`) **ตามจริง** (ร่าง 5)
 * - `interestRate` = อัตราต่อเดือนแบบคงที่ของระบบใหม่ (`installment.util.ts`: ดอกเบี้ย = ยอดจัด × อัตรา × งวด)
 *   = `interestTotal ÷ financedAmount ÷ totalMonths` ปัด HALF_UP 4 ตำแหน่ง (Decimal(5,4))
 *   — `detail.increase` ของระบบเก่าเป็นสัดส่วนดอกเบี้ยรวม**ทั้งสัญญา** ใช้ตรงไม่ได้ (ตรวจกับ dump 29/10)
 *   · `interestTotal` ไม่คิดใหม่จากอัตราที่ปัดแล้ว
 * - `totalMonths` = `installment_number` · `monthlyPayment` = `installment_amount`
 *
 * `vatAmount` / `vatPct` **ไม่มีทางเป็น null** — ทั้งจาก dump และจาก override (null = ระบบบวก VAT 7% ซ้ำ)
 *
 * ยอดจัด ≤ 0 (หลังใช้ override แล้ว) หรือค่างวด ≤ 0 = `LegacyMoneyError` (`LEGACY_MONEY_INVALID`) ให้ผู้เรียก
 * ลงเป็นตัวบล็อกของสัญญานั้น — override แก้ยอดจัดได้ แต่แก้ค่างวดไม่ได้
 *
 * ข้อความ error บอกได้แค่สัญญา (`contract_id` / เลขสัญญา) ตาราง ช่อง และชนิดของปัญหา — ไม่ยกค่าในช่องมาพิมพ์
 */

type Decimal = Prisma.Decimal;

export type ContractMoney = {
  sellingPrice: Decimal;
  downPayment: Decimal;
  financedAmount: Decimal;
  storeCommission: Decimal;
  interestTotal: Decimal;
  /** 0 = ไม่มี VAT — ไม่เคยเป็น null (null ในระบบใหม่ = บวก VAT 7% ของยอดก่อน VAT) */
  vatAmount: Decimal;
  /** 0.07 เมื่อมี VAT ไม่งั้น 0 */
  vatPct: Decimal;
  interestRate: Decimal;
  monthlyPayment: Decimal;
  totalMonths: number;
};

/**
 * ยอดที่เจ้าของแก้รายสัญญา (`--money-overrides`) — แทนค่าจากระบบเก่าทั้งสามช่อง · ดอกเบี้ยคิดใหม่จากยอดเหล่านี้
 * · `vatAmount` ต้องระบุเสมอ (0 = ไม่มี VAT)
 */
export type MoneyOverride = {
  financedAmount: Decimal;
  storeCommission: Decimal;
  vatAmount: Decimal;
};

/** ช่องของ `ContractMoney` ที่ต้องเป็นบวก */
export type LegacyMoneyField = 'financedAmount' | 'monthlyPayment';

/**
 * ยอดจัด / ค่างวดของสัญญาไม่เป็นบวก — สัญญานำเข้าไม่ได้จนกว่าจะแก้ (ยอดจัดแก้ด้วย `--money-overrides` ได้)
 * · ข้อความมีเลขสัญญา + `contract_id` + ชื่อช่อง ไม่มียอดเงิน
 */
export class LegacyMoneyError extends Error {
  readonly code = 'LEGACY_MONEY_INVALID';

  constructor(
    readonly contractId: string,
    readonly contractCode: string,
    readonly fields: readonly LegacyMoneyField[],
  ) {
    const labels: Record<LegacyMoneyField, string> = {
      financedAmount: 'ยอดจัด (financedAmount)',
      monthlyPayment: 'ค่างวด (monthlyPayment · installment_amount)',
    };
    super(
      `LEGACY_MONEY_INVALID: สัญญา ${contractCode} (contract_id=${contractId}) — ${fields
        .map((f) => labels[f])
        .join(' และ ')} ต้องมากกว่า 0`,
    );
    this.name = 'LegacyMoneyError';
  }
}

export type AmountMismatch = { installmentNo: number; legacy: Decimal; computed: Decimal };

export type PeakBalanceResult =
  | { installments: LegacyInstallment[]; adjustment: Decimal }
  | { blocked: 'PEAK_HIGHER'; diff: Decimal };

const DETAIL_TABLE = 'bestchoice_order_product_detail';
/** ชื่อคอลัมน์จริงตาม CREATE TABLE ของ dump 29/10 */
const DETAIL = {
  sellingPrice: 'ref_product_price',
  downPayment: 'deposit',
  finance: 'finance',
  commission: 'commission_admin',
  vat: 'sales_tax',
  installmentTotal: 'installment_total',
  months: 'installment_number',
  monthly: 'installment_amount',
} as const;

const MONEY_ERROR = 'อ่านยอดเงินสัญญาไม่ได้';
const OVERRIDE_ERROR = 'อ่านไฟล์แก้ยอดเงินสัญญาไม่ได้';
const PEAK_ERROR = 'ปรับยอดค้างตาม PEAK ไม่ได้';
const VAT_PCT = new Prisma.Decimal('0.07');
const ZERO = new Prisma.Decimal(0);
/**
 * ค่างวดที่คำนวณได้ต่างจากระบบเก่าได้ไม่เกิน 0.01 · งวดสุดท้ายรับเศษปัดได้ 1.00 — ใช้ร่วมกับด่านส่วนต่างยอดเรียกเก็บ
 * ของรายการยกมา (`opening.ts`)
 */
export const INSTALLMENT_AMOUNT_TOLERANCE = new Prisma.Decimal('0.01');
export const LAST_INSTALLMENT_AMOUNT_TOLERANCE = new Prisma.Decimal('1.00');

/** หัวคอลัมน์ที่ต้องมีในไฟล์ `--money-overrides` (คอลัมน์อื่นไม่อ่าน) */
export const MONEY_OVERRIDE_COLUMNS = [
  'legacy_code',
  'financed_amount',
  'store_commission',
  'vat_amount',
] as const;

/** อ่านช่องของแถว detail — ช่องว่าง/NULL = 0 แบบ `legacy-book` · คอลัมน์ไม่มีในแถว = throw */
function detailReader(c: LegacyContract) {
  const fail = (column: string, what: string) =>
    new Error(
      `${MONEY_ERROR}: สัญญา contract_id=${c.contractId} ตาราง \`${DETAIL_TABLE}\` ช่อง ${column} — ${what}`,
    );
  const raw = (column: string): string | null => {
    if (!(column in c.detail)) throw fail(column, 'ไม่มีคอลัมน์');
    const value = c.detail[column]?.trim();
    return value ? value : null;
  };
  const money = (column: string): Decimal => {
    const value = raw(column);
    if (value === null) return new Prisma.Decimal(0);
    let parsed: Decimal;
    try {
      parsed = new Prisma.Decimal(value);
    } catch {
      throw fail(column, 'จำนวนเงินผิดรูปแบบ');
    }
    if (!parsed.isFinite()) throw fail(column, 'จำนวนเงินผิดรูปแบบ');
    return parsed;
  };
  const months = (column: string): number => {
    const value = raw(column);
    if (value === null) throw fail(column, 'ไม่มีค่า');
    if (!/^\d+$/.test(value) || Number(value) <= 0) throw fail(column, 'ไม่ใช่จำนวนเต็มบวก');
    return Number(value);
  };
  return { money, months };
}

/** แปลงแถว detail ของสัญญาเป็นยอดเงินในระบบใหม่ · `override` แทนยอดจัด / ค่าคอม / VAT */
export function mapContractMoney(c: LegacyContract, override?: MoneyOverride): ContractMoney {
  const r = detailReader(c);
  const sellingPrice = r.money(DETAIL.sellingPrice);
  const downPayment = r.money(DETAIL.downPayment);
  const installmentTotal = r.money(DETAIL.installmentTotal);
  const totalMonths = r.months(DETAIL.months);
  const monthlyPayment = r.money(DETAIL.monthly);

  let financedAmount: Decimal;
  if (override) {
    financedAmount = override.financedAmount;
  } else {
    const finance = r.money(DETAIL.finance);
    financedAmount = finance.gt(0) ? finance : sellingPrice.minus(downPayment);
  }
  // ก่อนคิดค่าคอม — ยอดจัดติดลบจะได้ค่าคอม 10% ติดลบ
  const invalid: LegacyMoneyField[] = [];
  if (!financedAmount.gt(0)) invalid.push('financedAmount');
  if (!monthlyPayment.gt(0)) invalid.push('monthlyPayment');
  if (invalid.length > 0) throw new LegacyMoneyError(c.contractId, c.code, invalid);

  let storeCommission: Decimal;
  let vatAmount: Decimal;
  if (override) {
    ({ storeCommission, vatAmount } = override);
  } else {
    const commission = r.money(DETAIL.commission);
    storeCommission = commission.gt(0)
      ? commission
      : resolveStoreCommission({ storeCommission: null, financedAmount });
    const vat = r.money(DETAIL.vat);
    vatAmount = vat.gt(0) ? vat : new Prisma.Decimal(0);
  }

  const interest = installmentTotal.minus(financedAmount).minus(storeCommission).minus(vatAmount);
  const interestTotal = interest.gt(0) ? interest : new Prisma.Decimal(0);
  return {
    sellingPrice,
    downPayment,
    financedAmount,
    storeCommission,
    interestTotal,
    vatAmount,
    vatPct: vatAmount.gt(0) ? VAT_PCT : new Prisma.Decimal(0),
    // ยอดจัด > 0 และงวด ≥ 1 แล้ว (ตรวจข้างบน / `months`)
    interestRate: interestTotal
      .div(financedAmount)
      .div(totalMonths)
      .toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP),
    monthlyPayment,
    totalMonths,
  };
}

/**
 * เทียบค่างวดระบบเก่ากับ `computeInstallmentBreakdown` ของระบบใหม่ (ตัวเดียวกับ 2A / 2B) ทีละงวด
 * — ต่างเกิน 0.01 (งวดสุดท้าย 1.00) = ไม่ตรง · งวดที่มีฝั่งเดียว (จำนวนงวดไม่เท่า `totalMonths`) = ไม่ตรงเสมอ
 * โดยฝั่งที่ไม่มีเป็น 0 · `inst` เรียงตามวันครบกำหนด (งวดที่ = ลำดับในอาร์เรย์ + 1)
 */
export function checkInstallmentAmounts(
  m: ContractMoney,
  inst: readonly LegacyInstallment[],
): AmountMismatch[] {
  const mismatches: AmountMismatch[] = [];
  const count = Math.max(m.totalMonths, inst.length);
  for (let installmentNo = 1; installmentNo <= count; installmentNo++) {
    const legacyRow = inst[installmentNo - 1];
    const inContract = installmentNo <= m.totalMonths;
    const computed = inContract
      ? computeInstallmentBreakdown({
          financedAmount: m.financedAmount,
          storeCommission: m.storeCommission,
          interestTotal: m.interestTotal,
          vatAmount: m.vatAmount,
          totalMonths: m.totalMonths,
          installmentNo,
        }).installmentTotal
      : ZERO;
    const legacy = legacyRow?.amount ?? ZERO;
    const tolerance =
      installmentNo === m.totalMonths
        ? LAST_INSTALLMENT_AMOUNT_TOLERANCE
        : INSTALLMENT_AMOUNT_TOLERANCE;
    if (!legacyRow || !inContract || legacy.minus(computed).abs().gt(tolerance)) {
      mismatches.push({ installmentNo, legacy, computed });
    }
  }
  return mismatches;
}

/**
 * ทำยอดค้างของงวดให้เท่ายอดคงเหลือใน PEAK (ร่าง 4) — ยอดค้าง = `legacyOutstanding` (`peak-recon.ts` ตัวเดียวกับ
 * ที่จับคู่ PEAK: Σ `balance` ที่ > 0 · งวดที่จ่ายเกินไม่หักลบ)
 * - PEAK ค้างน้อยกว่า → เพิ่ม `paid` / ลด `balance` ของงวดที่ยังค้างตามลำดับในอาร์เรย์ (= วันครบกำหนด)
 *   จนยอดค้างเท่า PEAK · `adjustment` = PEAK − ระบบเก่า (≤ 0) ให้ลงรายงาน · `statusCode` ไม่เปลี่ยน
 * - PEAK ค้างมากกว่า → ไม่ปรับ คืน `blocked` (สเปกข้อ 1: ห้ามทวงงวดที่ลูกค้าจ่ายแล้วตามสลิป)
 * - คืนอาร์เรย์ใหม่ ไม่แก้ของเดิม · PEAK ติดลบ = throw (ยอดค้างระบบเก่าต่ำสุด 0)
 */
export function applyPeakBalance(
  inst: readonly LegacyInstallment[],
  peakRemain: Decimal,
): PeakBalanceResult {
  if (peakRemain.isNegative()) {
    throw new Error(`${PEAK_ERROR}: ยอดค้างใน PEAK ติดลบ — ต้องตรวจใบแจ้งหนี้ใน PEAK ก่อน`);
  }
  const diff = peakRemain.minus(legacyOutstanding({ installments: inst }));
  if (diff.gt(0)) return { blocked: 'PEAK_HIGHER', diff };

  let remaining = diff.negated();
  const installments = inst.map((i) => {
    if (remaining.lte(0) || i.balance.lte(0)) return { ...i };
    const take = Prisma.Decimal.min(i.balance, remaining);
    remaining = remaining.minus(take);
    return { ...i, paid: i.paid.plus(take), balance: i.balance.minus(take) };
  });
  return { installments, adjustment: diff };
}

type OverrideColumn = (typeof MONEY_OVERRIDE_COLUMNS)[number];

function nonNegativeMoney(row: CsvRow<OverrideColumn>, column: OverrideColumn): Decimal {
  const value = parseMoney(row, column);
  if (value.isNegative()) throw row.fail(column, 'ติดลบไม่ได้');
  return value;
}

/**
 * อ่าน CSV `--money-overrides` (หัวคอลัมน์ `legacy_code,financed_amount,store_commission,vat_amount`)
 * → ยอดที่แก้ตามเลขสัญญาระบบเก่า (`LegacyContract.code`) · **ทุกช่องต้องมีค่า** — `vat_amount` 0 = ไม่มี VAT
 * (ว่าง = "ไม่มีค่า" ไม่ใช่ VAT 7% ตามระบบ) · ยอดจัดต้อง > 0 · ติดลบไม่ได้ · เลขสัญญาซ้ำ = throw
 */
export function parseMoneyOverridesCsv(text: string): Map<string, MoneyOverride> {
  const overrides = new Map<string, MoneyOverride>();
  const lineOfCode = new Map<string, number>();
  for (const row of readCsv(text, MONEY_OVERRIDE_COLUMNS, OVERRIDE_ERROR)) {
    const code = row.text('legacy_code');
    const previous = lineOfCode.get(code);
    if (previous !== undefined) throw row.fail('legacy_code', `สัญญาซ้ำกับบรรทัด ${previous}`);
    lineOfCode.set(code, row.line);

    const financedAmount = nonNegativeMoney(row, 'financed_amount');
    if (financedAmount.isZero()) throw row.fail('financed_amount', 'ต้องมากกว่า 0');
    overrides.set(code, {
      financedAmount,
      storeCommission: nonNegativeMoney(row, 'store_commission'),
      vatAmount: nonNegativeMoney(row, 'vat_amount'),
    });
  }
  return overrides;
}
