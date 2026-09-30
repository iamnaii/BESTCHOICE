import { Decimal } from '@prisma/client/runtime/library';
import {
  computeInstallmentBreakdown,
  InstallmentBreakdown,
  InstallmentBreakdownInput,
} from './compute-installment-breakdown';
import { bangkokDayDiff } from '../../utils/date.util';

export interface Accrual2ALine {
  accountCode: string;
  dr: Decimal;
  cr: Decimal;
  description: string;
}

export interface Accrual2ALinesResult {
  /** 7 บรรทัดของรายการตั้งลูกหนี้งวด (2A) — Dr 3 บรรทัด ตามด้วย Cr 4 บรรทัด. */
  lines: Accrual2ALine[];
  /** installmentExclVat + vatPerInst = ยอดของทั้งงวด (ฐานของงวด — ไม่ใช่ยอดของรายการที่ลงบางส่วน). */
  installmentTotal: Decimal;
  installmentExclVat: Decimal;
  interestPerInst: Decimal;
  vatPerInst: Decimal;
}

export type Accrual2ALinesInput = Omit<InstallmentBreakdownInput, 'installmentNo'> & {
  /** เลขงวด (บังคับ) — งวดสุดท้ายรับเศษปัดทั้งหมด. */
  installmentNo: number;
};

/** ช่องของสัญญาที่ตัวสร้างบรรทัด 2A ใช้ — ส่งแถว Contract ของ Prisma เข้ามาตรง ๆ ได้. */
export interface Accrual2AContractFields {
  financedAmount: { toString(): string };
  storeCommission: { toString(): string } | null;
  interestTotal: { toString(): string };
  vatAmount: { toString(): string } | null;
  totalMonths: number;
}

/**
 * ข้อมูลเข้าของตัวสร้างบรรทัด 2A จากแถวสัญญา — ตัวเดียวที่ template ตั้งลูกหนี้งวด, ใบรับชำระ, preview และ
 * การกลับรายการใช้ร่วมกัน (เดิมเขียนซ้ำ 5 ที่). storeCommission / vatAmount ที่เป็น null ส่งต่อเป็น null
 * ให้ computeInstallmentBreakdown ใช้ค่าตั้งต้นของมันเอง.
 */
export function accrual2AInputOf(
  c: Accrual2AContractFields,
  installmentNo: number,
): Accrual2ALinesInput {
  return {
    financedAmount: c.financedAmount.toString(),
    storeCommission: c.storeCommission != null ? c.storeCommission.toString() : null,
    interestTotal: c.interestTotal.toString(),
    vatAmount: c.vatAmount != null ? c.vatAmount.toString() : null,
    totalMonths: c.totalMonths,
    installmentNo,
  };
}

/** ยอดที่ตั้งลูกหนี้งวด (2A) ไปแล้วของงวด — คอลัมน์ accrued* ของแถวตารางงวด. */
export interface AccruedSoFar {
  /** Σ Dr 11-2103 ของรายการ 2A ของงวดที่ยังมีผล */
  amount: Decimal;
  /** Σ ภาษีขาย (Cr 21-2101 = Dr 21-2102 = Cr 11-2105) */
  vat: Decimal;
  /** Σ ดอกเบี้ย (Cr 41-1101 = Dr 11-2106) */
  interest: Decimal;
}

/** งวดที่ยังไม่เคยตั้งลูกหนี้เลย */
export const NOTHING_ACCRUED: AccruedSoFar = {
  amount: new Decimal(0),
  vat: new Decimal(0),
  interest: new Decimal(0),
};

type DecimalLike = { toString(): string };

/** แถวตารางงวดที่มีคอลัมน์ยอดที่ตั้งไปแล้วครบทั้งสาม (select ต้องเลือกทั้งสามคอลัมน์). */
export interface AccruedColumns {
  accruedAmount: { toString(): string };
  accruedVat: { toString(): string };
  accruedInterest: { toString(): string };
}

/**
 * ยอดที่ตั้งไปแล้วจากแถวตารางงวด. มีความหมายเฉพาะเมื่อ accrualJournalEntryId ยังว่าง — งวดที่มีลิงก์แล้วคือ
 * "ตั้งครบแล้ว" เสมอ (แถวที่ตั้งครบก่อนมีคอลัมน์นี้เก็บ 0 — ห้ามอ่านคอลัมน์แทนลิงก์).
 * ทั้งสามช่องบังคับ (คำตัดสินผู้คุมงาน 2026-09-30): query ที่ลืมเลือกคอลัมน์ต้องไม่ถูกอ่านเป็น "ยังไม่เคยตั้ง"
 * เงียบ ๆ — type บังคับตอนคอมไพล์ และช่องที่ไม่มีมา (undefined / null) throw ตอนรัน.
 */
export function accruedSoFarOf(row: AccruedColumns): AccruedSoFar {
  const read = (value: DecimalLike | null | undefined, column: keyof AccruedColumns): Decimal => {
    if (value === undefined || value === null) {
      throw new Error(
        `accruedSoFarOf: ${column} is missing — select accruedAmount, accruedVat and accruedInterest ` +
          'of the InstallmentSchedule row',
      );
    }
    return new Decimal(value.toString());
  };
  return {
    amount: read(row.accruedAmount, 'accruedAmount'),
    vat: read(row.accruedVat, 'accruedVat'),
    interest: read(row.accruedInterest, 'accruedInterest'),
  };
}

/** ส่วนของงวดที่รายการ 2A หนึ่งรายการตั้ง: total = exclVat + vat · interest เป็นส่วนหนึ่งของ exclVat. */
export interface Accrual2APortion {
  total: Decimal;
  exclVat: Decimal;
  vat: Decimal;
  interest: Decimal;
}

/**
 * FULL = ตั้งทั้งงวดในรายการเดียว (เหมือนก่อนมีการตั้งตามสัดส่วน) · PARTIAL = ตั้งเท่ายอดที่รับ งวดยังเหลือส่วน
 * ที่ต้องตั้ง · REMAINDER = ตั้งส่วนที่เหลือจนงวดตั้งครบ.
 */
export type Accrual2AKind = 'FULL' | 'PARTIAL' | 'REMAINDER';

export interface Accrual2APartResult extends Accrual2ALinesResult {
  portion: Accrual2APortion;
  kind: Accrual2AKind;
  /** รายการนี้ทำให้งวดตั้งลูกหนี้ครบ (ยอดสะสม = ยอดของงวด) — ผู้ลงต้องประทับ accrualJournalEntryId */
  completes: boolean;
  /** ยอดสะสมหลังรายการนี้ — ค่าที่ต้องเขียนลงคอลัมน์ accrued* ของแถวตารางงวด */
  accruedAfter: AccruedSoFar;
}

/** ฐานต่องวดที่การแบ่งส่วนใช้ — ผลของ computeInstallmentBreakdown (ส่ง installmentNo แล้ว) */
export type Accrual2ABasis = Pick<
  InstallmentBreakdown,
  'installmentTotal' | 'installmentExclVat' | 'vatPerInst' | 'interestPerInst'
>;

/** ภาษีขายของเงินที่รับ = ยอดที่รับ × 7/107 (คำตอบฝ่ายบัญชี ก1 29/09/2569 — ตัวอย่างที่ฝ่ายบัญชีเลือก) */
const VAT_RATE = 7;
const VAT_INCLUSIVE_BASE = 107;

/** 7 บรรทัดของ 2A สำหรับส่วนที่ระบุ — คำอธิบายเท่ากับที่รอบกลางคืนลงอยู่เดิมทุกตัวอักษร. */
function accrual2ALinesFor(p: Accrual2APortion): Accrual2ALine[] {
  const zero = new Decimal(0);
  return [
    { accountCode: '11-2103', dr: p.total, cr: zero, description: 'ลูกหนี้ค้างชำระ (Accrual)' },
    { accountCode: '21-2102', dr: p.vat, cr: zero, description: 'ล้าง ภาษีขายรอเรียกเก็บ' },
    {
      accountCode: '11-2106',
      dr: p.interest,
      cr: zero,
      description: 'ล้าง รายได้รอตัดบัญชี-ดอกเบี้ย',
    },
    {
      accountCode: '11-2101',
      dr: zero,
      cr: p.exclVat,
      description: 'ลูกหนี้ Gross (ลด excl.VAT)',
    },
    { accountCode: '11-2105', dr: zero, cr: p.vat, description: 'ลูกหนี้ภาษีขายรอฯ (ล้าง)' },
    { accountCode: '41-1101', dr: zero, cr: p.interest, description: 'รายได้ดอกเบี้ย (รับรู้)' },
    { accountCode: '21-2101', dr: zero, cr: p.vat, description: 'ภาษีขาย ภ.พ.30' },
  ];
}

/**
 * ส่วนที่ยังไม่ได้ตั้งของงวด = ยอดของงวด − ยอดที่ตั้งไปแล้ว ทีละบัญชี (ยอดรวมของทุกรายการจึงเท่ายอดของงวดพอดี).
 * งวดที่ยังไม่เคยตั้ง = ทั้งงวด.
 */
export function remainingAccrualPortion(
  basis: Accrual2ABasis,
  accrued: AccruedSoFar,
): Accrual2APortion {
  const total = basis.installmentTotal.minus(accrued.amount);
  const vat = basis.vatPerInst.minus(accrued.vat);
  return {
    total,
    exclVat: total.minus(vat),
    vat,
    interest: basis.interestPerInst.minus(accrued.interest),
  };
}

/**
 * ส่วนของงวดที่ต้องตั้งเมื่อรับเงิน `amount` ก่อนวันครบกำหนด (คำตอบฝ่ายบัญชี ก1 "แบบ ข" 29/09/2569):
 *   ภาษีขาย   = HALF_UP(amount × 7/107)
 *   มูลค่า     = amount − ภาษีขาย
 *   ดอกเบี้ย   = HALF_UP(ดอกเบี้ยของงวด × มูลค่า ÷ มูลค่าของงวด)
 * แต่ละบัญชีต้องไม่เกินส่วนที่ยังไม่ได้ตั้ง (ภาษีขายถูกบีบให้มูลค่าไม่เกินส่วนที่เหลือด้วย) · ยอดที่รับ ≥ ส่วนที่เหลือ
 * = ตั้งส่วนที่เหลือทั้งหมดด้วยยอดคงเหลือตรงตัว (รายการสุดท้ายรับเศษ) · ยอดติดลบ/ศูนย์ = ส่วนศูนย์
 */
export function partialAccrualPortion(
  basis: Accrual2ABasis,
  accrued: AccruedSoFar,
  amount: Decimal,
): Accrual2APortion {
  const zero = new Decimal(0);
  const rest = remainingAccrualPortion(basis, accrued);
  const received = Decimal.min(Decimal.max(amount, zero), rest.total);
  if (received.eq(rest.total)) return rest;

  const vatShare = received
    .times(VAT_RATE)
    .div(VAT_INCLUSIVE_BASE)
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const vat = Decimal.max(Decimal.min(vatShare, rest.vat), received.minus(rest.exclVat));
  const exclVat = received.minus(vat);
  const interestShare = basis.installmentExclVat.gt(0)
    ? basis.interestPerInst
        .times(exclVat)
        .div(basis.installmentExclVat)
        .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
    : zero;
  const interest = Decimal.max(zero, Decimal.min(interestShare, rest.interest));
  return { total: received, exclVat, vat, interest };
}

function partResult(
  basis: InstallmentBreakdown,
  accrued: AccruedSoFar,
  portion: Accrual2APortion,
): Accrual2APartResult {
  const accruedAfter: AccruedSoFar = {
    amount: accrued.amount.plus(portion.total),
    vat: accrued.vat.plus(portion.vat),
    interest: accrued.interest.plus(portion.interest),
  };
  const completes = accruedAfter.amount.eq(basis.installmentTotal);
  const kind: Accrual2AKind = !completes
    ? 'PARTIAL'
    : accrued.amount.isZero()
      ? 'FULL'
      : 'REMAINDER';
  return {
    lines: accrual2ALinesFor(portion),
    installmentTotal: basis.installmentTotal,
    installmentExclVat: basis.installmentExclVat,
    interestPerInst: basis.interestPerInst,
    vatPerInst: basis.vatPerInst,
    portion,
    kind,
    completes,
    accruedAfter,
  };
}

/**
 * ตัวสร้างบรรทัดรายการ 2A (ตั้งลูกหนี้งวด) ทั้งงวด แบบฟังก์ชันบริสุทธิ์ — ใช้ร่วมกันโดย
 * InstallmentAccrual2ATemplate (ลงจริง) และ PaymentJournalPreviewService (แสดงก่อนบันทึก) เพื่อให้
 * "ที่แสดง = ที่ลงจริง" โดยโครงสร้าง.
 *
 * ตัวเลขมาจาก computeInstallmentBreakdown ตัวเดียวกับใบรับชำระ (ปัด ROUND_DOWN ค่างวดก่อน VAT,
 * ROUND_HALF_UP ดอกเบี้ย/VAT, งวดสุดท้ายรับเศษ) — ห้ามคำนวณซ้ำที่อื่น.
 */
export function buildAccrual2ALines(input: Accrual2ALinesInput): Accrual2ALinesResult {
  const b = computeInstallmentBreakdown(input);
  return {
    lines: accrual2ALinesFor(remainingAccrualPortion(b, NOTHING_ACCRUED)),
    installmentTotal: b.installmentTotal,
    installmentExclVat: b.installmentExclVat,
    interestPerInst: b.interestPerInst,
    vatPerInst: b.vatPerInst,
  };
}

/**
 * 2A เท่ายอดที่รับ (ใบรับชำระบางส่วนก่อนวันครบกำหนด) — `amount` = ยอดที่ใบรับชำระเครดิต 11-2103
 * (split.principalCleared). ยอดที่รับถึงส่วนที่เหลือของงวด → รายการนี้ปิดงวด (completes).
 */
export function buildPartialAccrual2ALines(
  input: Accrual2ALinesInput,
  accrued: AccruedSoFar,
  amount: Decimal,
): Accrual2APartResult {
  const b = computeInstallmentBreakdown(input);
  return partResult(b, accrued, partialAccrualPortion(b, accrued, amount));
}

/**
 * 2A ส่วนที่เหลือของงวด (ใบที่ทำให้งวดชำระครบ · รอบกลางคืน ณ วันครบกำหนด) — งวดที่ยังไม่เคยตั้ง = ทั้งงวด
 * (ผลเท่ากับ buildAccrual2ALines ทุกตัวอักษร).
 */
export function buildRemainderAccrual2ALines(
  input: Accrual2ALinesInput,
  accrued: AccruedSoFar,
): Accrual2APartResult {
  const b = computeInstallmentBreakdown(input);
  return partResult(b, accrued, remainingAccrualPortion(b, accrued));
}

/** ลำดับบรรทัดของรายการกลับรายการตั้งลูกหนี้งวด — ตามรูปที่เสนอฝ่ายบัญชี (ฝั่ง Dr ก่อน). */
const ACCRUAL_2A_REVERSAL_ORDER = [
  '11-2101',
  '11-2105',
  '21-2101',
  '41-1101',
  '11-2103',
  '21-2102',
  '11-2106',
];

/**
 * เรียงบรรทัดของรายการกลับรายการตั้งลูกหนี้งวดตามรูปที่เสนอฝ่ายบัญชี:
 *   Dr 11-2101 / Dr 11-2105 / Dr 21-2101 / Dr 41-1101 — Cr 11-2103 / Cr 21-2102 / Cr 11-2106
 * บัญชีที่ไม่อยู่ในรูป (ไม่ควรมี) ไม่ถูกทิ้ง — ต่อท้ายตามลำดับเดิม. ไม่แก้ array ที่ส่งเข้ามา.
 */
export function sortAccrual2AReversalLines<T extends { accountCode: string }>(lines: T[]): T[] {
  const rank = (accountCode: string) => {
    const index = ACCRUAL_2A_REVERSAL_ORDER.indexOf(accountCode);
    return index === -1 ? ACCRUAL_2A_REVERSAL_ORDER.length : index;
  };
  return [...lines].sort((a, b) => rank(a.accountCode) - rank(b.accountCode));
}

/** กระจกของบรรทัด 2A — บัญชีและยอดเดิม สลับฝั่งทุกบรรทัด เรียงตามรูปที่เสนอฝ่ายบัญชี. */
function mirrorAccrual2ALines(lines: Accrual2ALine[]): Accrual2ALine[] {
  return sortAccrual2AReversalLines(
    lines.map((l) => ({
      accountCode: l.accountCode,
      dr: l.cr,
      cr: l.dr,
      description: `[กลับรายการ] ${l.description}`,
    })),
  );
}

/**
 * กระจกของ buildAccrual2ALines ตามที่ตัวสร้างคำนวณจากสัญญา — บัญชีและยอดมาจากตัวสร้างตัวเดียวกัน
 * สลับฝั่งทุกบรรทัด ไม่มีตัวเลขชุดที่สอง.
 *
 * ใช้**ตรวจทาน**รายการกลับรายการตั้งลูกหนี้งวดเท่านั้น (คำตัดสินผู้คุมงาน R13): รายการที่ลงจริงตอน
 * ยกเลิกใบเสร็จเป็นกระจกของบรรทัดที่ลงไว้ในสมุดบัญชี (ReceiptVoidReversalTemplate
 * .voidAccrualPostedAtReceipt) — ห้ามใช้ผลของฟังก์ชันนี้หยุดการยกเลิกใบเสร็จ.
 */
export function buildAccrual2AReversalLines(input: Accrual2ALinesInput): Accrual2ALinesResult {
  const built = buildAccrual2ALines(input);
  return { ...built, lines: mirrorAccrual2ALines(built.lines) };
}

/**
 * กระจกของ 2A หนึ่งรายการที่ลงบางส่วน/ส่วนที่เหลือ — ใช้ตรวจทานการกลับรายการแบบเดียวกับ
 * buildAccrual2AReversalLines (ห้ามใช้หยุดการยกเลิกใบเสร็จ).
 */
export function mirrorAccrual2APart(part: Accrual2APartResult): Accrual2ALine[] {
  return mirrorAccrual2ALines(part.lines);
}

/**
 * วันที่ลงรายการ 2A = min(วันครบกำหนด, วันที่รับเงิน) (คำตัดสินฝ่ายบัญชี D2 + Q3, 2026-09-28):
 *   - รับเงินก่อนครบกำหนด → ลงวันที่รับเงิน (จุดความรับผิด VAT = วันรับเงิน)
 *   - รับเงินหลังครบกำหนดแต่รอบกลางคืนตกหล่น → ลงวันครบกำหนด เหมือนที่รอบกลางคืนจะลง
 * เทียบกันที่ระดับเวลา (instant) ไม่ปัดเป็นวัน — ค่าที่คืนคือ Date ตัวเดิมของฝั่งที่ชนะ.
 */
export function resolveAccrualPostingDate(dueDate: Date, receiptDate: Date): Date {
  return receiptDate.getTime() < dueDate.getTime() ? receiptDate : dueDate;
}

/**
 * Date ที่ส่งให้ validatePeriodOpen เพื่อตัดสินงวดบัญชีของรายการ 2A ณ วันรับเงิน.
 *
 * validatePeriodOpen อ่านปี/เดือนด้วย getter เวลาท้องถิ่นของโปรเซส (getFullYear / getMonth) และเส้นทาง
 * รับชำระส่ง Date ของการรับเงินเข้าไปดิบ ๆ. ทุกทางเข้าตั้ง TZ=Asia/Bangkok (installRuntimeGlobals ใน
 * app.setup.ts + ค่าที่ deploy: ENV TZ ใน Dockerfile และตัวแปรของ Cloud Run) เดือนบน prod จึงเป็นเดือนไทย.
 * ในโปรเซสที่รันเป็น UTC (เช่น jest บน CI) วันครบกำหนดที่เก็บที่เที่ยงคืนไทย (= 17:00 UTC ของวันก่อนหน้า)
 * ถูกอ่านเป็นวันก่อนหน้า — วันครบกำหนดวันที่ 1 จึงถูกอ่านเป็นเดือนก่อน ถ้าตรวจ 2A ด้วยวันครบกำหนดในวันเดียวกับ
 * ที่รับเงิน 2A กับใบรับชำระจะถูกตัดสินคนละงวดได้ (เช่นรับเงิน 08:00 ของวันที่ 1). กติกาข้างล่างทำให้ 2A ที่ลงวัน
 * เดียวกับการรับเงิน (ปฏิทินไทย) ถูกตัดสินงวดเดียวกับใบรับชำระ ไม่ว่าโปรเซสจะรันด้วยเขตเวลาใด. กติกา:
 *   - วันที่ลง 2A คือวันที่รับเงิน → ใช้วันที่รับเงิน
 *   - วันที่ลง 2A คือวันครบกำหนด และเป็นวันเดียวกับวันรับเงินตามปฏิทินไทย → ใช้วันที่รับเงิน
 *   - นอกนั้น (รับเงินหลังวันครบกำหนด) → ใช้วันครบกำหนด เหมือนที่รอบกลางคืนตรวจ
 * ค่าที่คืนคือ Date ตัวเดิมของฝั่งที่ถูกเลือก.
 */
export function resolveAccrualPeriodCheckDate(dueDate: Date, receiptDate: Date): Date {
  if (receiptDate.getTime() < dueDate.getTime()) return receiptDate;
  return bangkokDayDiff(dueDate, receiptDate) === 0 ? receiptDate : dueDate;
}

/**
 * วันครบกำหนด "ถึงแล้ว" ณ asOf หรือยัง — ตัดสินตามวันปฏิทินไทย: วันครบกำหนดเอง = ถึงแล้ว.
 * นิยามเดียวกับที่รอบกลางคืนใช้เลือกงวด (dueDate < เที่ยงคืนไทยของวันพรุ่งนี้) — ใช้ตัดสินว่าใบรับชำระบางส่วน
 * ตั้งลูกหนี้งวดเท่ายอดที่รับหรือไม่, การยกเลิกใบเสร็จต้องกลับรายการ 2A ด้วยหรือไม่ และข้อความของด่านจ่าย
 * บางส่วนใน preview. (คนละเรื่องกับ "เกินกำหนด" — งวดที่อยู่ในวันครบกำหนดถึงกำหนดแล้วแต่ยังไม่เกินกำหนด)
 */
export function isDueDateReached(dueDate: Date, asOf: Date): boolean {
  return bangkokDayDiff(dueDate, asOf) >= 0;
}
