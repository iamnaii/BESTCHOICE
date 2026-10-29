import { Prisma } from '@prisma/client';
import { bangkokMidnight } from '../../../utils/date.util';
import { LEGACY_CUSTOMER_COLUMNS } from '../customer';
import type { DumpRow } from '../dump-reader';
import type {
  LegacyBook,
  LegacyContract,
  LegacyFileKind,
  LegacyInstallment,
  LegacyReceipt,
} from '../legacy-book';
import type { PeakMatch, PeakRecon } from '../peak-recon';

/**
 * สมุดระบบเก่าสังเคราะห์สำหรับเทสต์ของ Task 10 (ไม่ใช่ spec) — ข้อมูลทั้งหมดเป็นของปลอม: รหัส TEST-*, ชื่อขึ้นต้น
 * "ทดสอบระบบ", เลขบัตรขึ้นต้น 09 ที่คำนวณหลักตรวจเอง, เบอร์ 0977…, IMEI 35999…
 *
 * สัญญามาตรฐาน (ตัวอย่าง CPA): ยอดจัด 10,000 · ค่าคอม 1,000 · ดอกเบี้ย 6,000 · VAT 1,190 · 12 งวด
 * → งวด 1–11 = 1,515.83 · งวด 12 = 1,515.87
 */

const D = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);
export const MONTHLY = '1515.83';
export const LAST = '1515.87';
export const TEST_NAME = 'ทดสอบระบบ';

/** เลขบัตร 13 หลักที่หลักตรวจถูก (ขึ้นต้น 09 — ไม่ใช่เลขของคนจริง) */
export function thaiId(first12: string): string {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (13 - i);
  return `${first12}${(11 - (sum % 11)) % 10}`;
}

export type InstallmentSpec = {
  /** ยอดเรียกเก็บของงวด (ค่าเริ่มต้นตามสัญญามาตรฐาน) */
  amount?: string;
  /** ยอดจ่าย (ค่าเริ่มต้น 0) — มีใบรับเงินหนึ่งใบเท่ายอดนี้ (วันจ่าย = `paidOn` หรือวันครบกำหนด) */
  paid?: string;
  paidOn?: Date;
  /** ไม่สร้างใบรับเงิน (ยอดจ่ายตามบันทึกงวดอย่างเดียว) */
  noReceipt?: boolean;
};

export type ContractSpec = {
  id: string;
  code: string;
  statusCode?: string;
  /** วันที่ทำสัญญา (กรุงเทพ) `YYYY-MM-DD` */
  date: string;
  memberId: string;
  /** วันครบกำหนดงวดแรก (กรุงเทพ) — งวดถัดไปเดือนละครั้งวันเดียวกัน */
  firstDue: [year: number, monthIndex: number, day: number];
  installments?: InstallmentSpec[];
  detail?: Record<string, string | null>;
  close?: { amount: string; discount: string; date: Date; slip?: string | null };
  imei?: string;
  productType?: string;
  files?: Array<{ kind: LegacyFileKind; path: string }>;
};

export function standardInstallments(overrides: Record<number, InstallmentSpec> = {}) {
  return Array.from({ length: 12 }, (_, i) => ({
    amount: i === 11 ? LAST : MONTHLY,
    ...overrides[i + 1],
  }));
}

export function detail(over: Record<string, string | null> = {}): DumpRow {
  return {
    ref_order_id: '0',
    ref_product_price: '12000',
    deposit: '2000',
    finance: '10000',
    commission_admin: '1000',
    sales_tax: '1190',
    installment_total: '18190',
    installment_number: '12',
    installment_amount: MONTHLY,
    ref_product_brand: 'Apple',
    ref_product_name: 'iPhone ทดสอบ 13',
    ref_product_color: 'ดำ',
    ref_product_storage: '128GB',
    product_type: '2',
    mobile_imei: null,
    mobile_serial_no: null,
    ...over,
  };
}

export function syntheticContract(spec: ContractSpec): LegacyContract {
  const [y, m, d] = spec.firstDue;
  let receiptSeq = 0;
  const receipts: LegacyReceipt[] = [];
  const installments: LegacyInstallment[] = (spec.installments ?? standardInstallments()).map(
    (inst, i) => {
      const amount = D(inst.amount ?? MONTHLY);
      const paid = D(inst.paid ?? '0');
      const dueDate = bangkokMidnight(y, m + i, d);
      const legacyId = `${spec.id}${String(i + 1).padStart(2, '0')}`;
      if (paid.gt(0) && !inst.noReceipt) {
        const id = `${spec.id}9${String(++receiptSeq).padStart(3, '0')}`;
        receipts.push({
          legacyId: id,
          kind: 'INSTALLMENT',
          installmentLegacyId: legacyId,
          closeLegacyId: null,
          date: inst.paidOn ?? dueDate,
          amount: paid,
          installment: paid,
          mulct: D(0),
          discount: D(0),
          slipPath: `upload/payment/TEST-${spec.code}-${id}.jpg`,
          createdAt: inst.paidOn ?? dueDate,
        });
      }
      return {
        legacyId,
        legacyCode: `TEST-I-${spec.code}-${i + 1}`,
        dueDate,
        amount,
        paid,
        balance: amount.minus(paid),
        statusCode: paid.gte(amount) ? '4' : paid.gt(0) ? '3' : '0',
      };
    },
  );
  if (spec.close) {
    const id = `${spec.id}8001`;
    receipts.push({
      legacyId: id,
      kind: 'EARLY_PAYOFF',
      installmentLegacyId: null,
      closeLegacyId: `${spec.id}7`,
      date: spec.close.date,
      amount: D(spec.close.amount),
      installment: D(spec.close.amount),
      mulct: D(0),
      discount: D(spec.close.discount),
      slipPath:
        spec.close.slip === undefined
          ? `upload/payment/TEST-${spec.code}-close.jpg`
          : spec.close.slip,
      createdAt: spec.close.date,
    });
  }
  return {
    contractId: spec.id,
    code: spec.code,
    statusCode: spec.statusCode ?? '2',
    createdAt: new Date(`${spec.date}T10:00:00+07:00`),
    order: {
      ...Object.fromEntries(LEGACY_CUSTOMER_COLUMNS.order.map((c) => [c, null])),
      order_id: `O${spec.id}`,
      ref_member: spec.memberId,
      created_by: 'admin-ทดสอบ',
      member_career: 'พนักงานบริษัท',
    },
    detail: detail({
      mobile_imei: spec.imei ?? `35999${spec.id.padStart(10, '0')}`,
      mobile_serial_no: `TESTSN${spec.id}`,
      product_type: spec.productType ?? '2',
      ...spec.detail,
    }),
    installments,
    receipts,
    close: spec.close
      ? {
          amount: D(spec.close.amount),
          discount: D(spec.close.discount),
          createdAt: spec.close.date,
        }
      : null,
    files: spec.files ?? [{ kind: 'img_contract', path: `uploads/contract/TEST-${spec.code}.jpg` }],
  };
}

export type MemberSpec = {
  id: string;
  code: string;
  nationalId: string | null;
  phone: string | null;
  name?: string;
};

export function syntheticMember(spec: MemberSpec): DumpRow {
  return {
    ...Object.fromEntries(LEGACY_CUSTOMER_COLUMNS.member.map((c) => [c, null])),
    member_id: spec.id,
    member_code: spec.code,
    member_name: spec.name ?? `${TEST_NAME} สมาชิก`,
    member_surname: spec.code,
    member_identity_number: spec.nationalId,
    member_tel: spec.phone,
    member_birth_date: '1990-05-17',
    member_address: '1/1 หมู่ 1',
  };
}

export function syntheticBook(contracts: LegacyContract[], members: DumpRow[]): LegacyBook {
  return {
    contracts,
    members: new Map(members.map((m) => [m.member_id as string, m])),
    anomalies: [],
  };
}

/**
 * คู่ PEAK ของสัญญา — ยอดคงเหลือ = Σ คงเหลือของงวด (หรือที่ส่งมา) · ยอดใบแจ้งหนี้ = Σ ค่างวดระบบเก่า (หรือที่ส่งมา —
 * ใช้จำลองเศษของยอดผ่อนรวม)
 */
export function peakMatch(
  c: LegacyContract,
  contactCode: string,
  remain?: Prisma.Decimal.Value,
  netAmount?: Prisma.Decimal.Value,
): PeakMatch {
  const outstanding = c.installments.reduce(
    (s, i) => (i.balance.gt(0) ? s.plus(i.balance) : s),
    D(0),
  );
  const total = c.installments.reduce((s, i) => s.plus(i.amount), D(0));
  const remainAmount = remain === undefined ? outstanding : D(remain);
  return {
    invoice: {
      invoiceCode: `TEST-INV-${c.code}`,
      contactCode,
      issuedDate: c.createdAt,
      netAmount: netAmount === undefined ? total : D(netAmount),
      remainAmount,
      imei: c.detail.mobile_imei ?? null,
    },
    legacyOutstanding: outstanding,
    diff: remainAmount.minus(outstanding),
    legacyInstallmentTotal: total,
    grossDiff: (netAmount === undefined ? total : D(netAmount)).minus(total),
    source: 'auto',
    note: null,
  };
}

export function syntheticRecon(matches: Array<[LegacyContract, PeakMatch]>): PeakRecon {
  return {
    matched: new Map(matches.map(([c, m]) => [c.contractId, m])),
    unmatchedContracts: [],
    unmatchedInvoices: [],
    ambiguous: [],
  };
}

/** วันตัด 2026-11-30 23:59:59 กรุงเทพ */
export const CUTOFF = new Date('2026-11-30T23:59:59+07:00');
