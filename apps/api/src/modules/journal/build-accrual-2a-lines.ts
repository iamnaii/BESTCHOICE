import { Decimal } from '@prisma/client/runtime/library';
import {
  computeInstallmentBreakdown,
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
  /** installmentExclVat + vatPerInst = ยอด Dr 11-2103. */
  installmentTotal: Decimal;
  installmentExclVat: Decimal;
  interestPerInst: Decimal;
  vatPerInst: Decimal;
}

export type Accrual2ALinesInput = Omit<InstallmentBreakdownInput, 'installmentNo'> & {
  /** เลขงวด (บังคับ) — งวดสุดท้ายรับเศษปัดทั้งหมด. */
  installmentNo: number;
};

/**
 * ตัวสร้างบรรทัดรายการ 2A (ตั้งลูกหนี้งวด) แบบฟังก์ชันบริสุทธิ์ — ใช้ร่วมกันโดย
 * InstallmentAccrual2ATemplate (ลงจริง ทั้งรอบกลางคืนและ ณ วันรับเงิน) และ
 * PaymentJournalPreviewService (แสดงก่อนบันทึก) เพื่อให้ "ที่แสดง = ที่ลงจริง" โดยโครงสร้าง.
 *
 * ตัวเลขมาจาก computeInstallmentBreakdown ตัวเดียวกับใบรับชำระ (ปัด ROUND_DOWN ค่างวดก่อน VAT,
 * ROUND_HALF_UP ดอกเบี้ย/VAT, งวดสุดท้ายรับเศษ) — ห้ามคำนวณซ้ำที่อื่น.
 */
export function buildAccrual2ALines(input: Accrual2ALinesInput): Accrual2ALinesResult {
  const b = computeInstallmentBreakdown(input);
  const zero = new Decimal(0);
  const lines: Accrual2ALine[] = [
    {
      accountCode: '11-2103',
      dr: b.installmentTotal,
      cr: zero,
      description: 'ลูกหนี้ค้างชำระ (Accrual)',
    },
    {
      accountCode: '21-2102',
      dr: b.vatPerInst,
      cr: zero,
      description: 'ล้าง ภาษีขายรอเรียกเก็บ',
    },
    {
      accountCode: '11-2106',
      dr: b.interestPerInst,
      cr: zero,
      description: 'ล้าง รายได้รอตัดบัญชี-ดอกเบี้ย',
    },
    {
      accountCode: '11-2101',
      dr: zero,
      cr: b.installmentExclVat,
      description: 'ลูกหนี้ Gross (ลด excl.VAT)',
    },
    {
      accountCode: '11-2105',
      dr: zero,
      cr: b.vatPerInst,
      description: 'ลูกหนี้ภาษีขายรอฯ (ล้าง)',
    },
    {
      accountCode: '41-1101',
      dr: zero,
      cr: b.interestPerInst,
      description: 'รายได้ดอกเบี้ย (รับรู้)',
    },
    {
      accountCode: '21-2101',
      dr: zero,
      cr: b.vatPerInst,
      description: 'ภาษีขาย ภ.พ.30',
    },
  ];
  return {
    lines,
    installmentTotal: b.installmentTotal,
    installmentExclVat: b.installmentExclVat,
    interestPerInst: b.interestPerInst,
    vatPerInst: b.vatPerInst,
  };
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
  const lines = sortAccrual2AReversalLines(
    built.lines.map((l) => ({
      accountCode: l.accountCode,
      dr: l.cr,
      cr: l.dr,
      description: `[กลับรายการ] ${l.description}`,
    })),
  );
  return { ...built, lines };
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
 * validatePeriodOpen ตัดสินปี/เดือนจากเวลาของเครื่อง (Cloud Run = UTC) และเส้นทางรับชำระส่ง Date
 * ของการรับเงินเข้าไปดิบ ๆ. วันครบกำหนดถูกเก็บที่เที่ยงคืนไทย (= 17:00 UTC ของวันก่อนหน้า) —
 * ถ้าตรวจ 2A ด้วยวันครบกำหนดในวันเดียวกับที่รับเงิน 2A กับใบรับชำระจะถูกตัดสินคนละงวดได้
 * (เช่นรับเงิน 08:00 ของวันที่ 1). กติกา:
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
 * นิยามเดียวกับที่รอบกลางคืนใช้เลือกงวด (dueDate < เที่ยงคืนไทยของวันพรุ่งนี้) — ใช้ตัดสินว่าการ
 * ยกเลิกใบเสร็จต้องกลับรายการ 2A ด้วยหรือไม่ และเลือกข้อความของด่านจ่ายบางส่วนใน preview.
 * (คนละเรื่องกับ "เกินกำหนด" — งวดที่อยู่ในวันครบกำหนดถึงกำหนดแล้วแต่ยังไม่เกินกำหนด)
 */
export function isDueDateReached(dueDate: Date, asOf: Date): boolean {
  return bangkokDayDiff(dueDate, asOf) >= 0;
}
