import * as crypto from 'crypto';
import { isFutureBkkDay } from '../../../utils/date.util';

/**
 * ปิดสัญญาก่อนกำหนดด้วยสลิป (คำสั่งเจ้าของ 2026-09-23/24): "ถ้ายอดตรงกับสลิป ปิดยอดได้เลย
 * ไม่ต้องอนุมัติ" — กติกา 5 ข้อที่ต้องผ่านครบ (mockup artifact 69ezDjY8 กระดาน 2/5) แยกเป็น
 * ฟังก์ชันบริสุทธิ์ เพื่อให้เปลี่ยน "เครื่องยนต์อ่านสลิป" (OCR วันนี้ · SCB/บริการกลางวันหน้า)
 * ได้โดยกติกาและหน้าจอไม่เปลี่ยน — เครื่องยนต์แค่คืน `SlipReading` มาให้.
 */

/** เกณฑ์ความมั่นใจเดียวกับบอทการเงิน (slip-processing.service AUTO_APPROVE_CONFIDENCE) */
export const SLIP_CONFIDENCE_MIN = 0.9;
export const SLIP_AMOUNT_TOLERANCE = 0.01;

/** ผลอ่านสลิป — รูปเดียวกับ VisionService.SlipExtraction เพื่อใช้ตรงๆ */
export interface SlipReading {
  isSlip: boolean;
  amount?: number | null;
  refNo?: string | null;
  bankName?: string | null;
  /** YYYY-MM-DD */
  date?: string | null;
  /** HH:mm */
  time?: string | null;
  toAccount?: string | null;
  fromAccount?: string | null;
  toName?: string | null;
  confidence: number;
}

export type SlipCheckCode =
  | 'READABLE'
  | 'AMOUNT_MATCH'
  | 'COMPANY_ACCOUNT'
  | 'NOT_REUSED'
  | 'DATE_VALID';

export interface SlipCheck {
  code: SlipCheckCode;
  ok: boolean;
  label: string;
  detail?: string;
}

export interface SlipCheckInput {
  /** null = เครื่องยนต์อ่านไม่ได้/ไม่พร้อม */
  reading: SlipReading | null;
  /** ยอดปิดที่ระบบคำนวณ (computePayoffQuote.totalPayoff) */
  expectedAmount: number;
  /** บัญชีปลายทางเป็นบัญชีบริษัทหรือไม่ (FinanceConfigService.isCompanyBankAccount) */
  isCompanyAccount: (account: string | null | undefined) => boolean;
  /** ลายนิ้วมือสลิปนี้เคยถูกใช้แล้ว (SlipFingerprint) */
  reused: boolean;
  now?: Date;
}

const LABELS: Record<SlipCheckCode, string> = {
  READABLE: 'อ่านสลิปได้ (ความมั่นใจ ≥ 90%)',
  AMOUNT_MATCH: 'ยอดในสลิปตรงกับยอดปิด',
  COMPANY_ACCOUNT: 'โอนเข้าบัญชีบริษัท',
  NOT_REUSED: 'สลิปนี้ไม่เคยถูกใช้',
  DATE_VALID: 'วันที่โอนไม่เป็นอนาคต',
};

const money = (n: number) =>
  n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** วัน-เวลาโอนจากสลิป (เวลาไทย) — null เมื่ออ่านไม่ได้/รูปแบบผิด */
export function slipTransferDate(reading: SlipReading | null): Date | null {
  if (!reading?.date || !/^\d{4}-\d{2}-\d{2}$/.test(reading.date)) return null;
  const time = reading.time && /^\d{2}:\d{2}$/.test(reading.time) ? reading.time : '12:00';
  const at = new Date(`${reading.date}T${time}:00+07:00`);
  return Number.isNaN(at.getTime()) ? null : at;
}

/** วันที่รับเงิน/ลงบัญชี = วันที่ในสลิป ถ้าอ่านได้และไม่เป็นอนาคต ไม่งั้นวันนี้ */
export function slipPaymentDate(reading: SlipReading | null, now: Date = new Date()): Date {
  const at = slipTransferDate(reading);
  return at && !isFutureBkkDay(at, now) ? at : now;
}

export function evaluateSlipChecks(input: SlipCheckInput): SlipCheck[] {
  const { reading, expectedAmount, isCompanyAccount, reused } = input;
  const now = input.now ?? new Date();
  const readable =
    !!reading &&
    reading.isSlip &&
    typeof reading.confidence === 'number' &&
    reading.confidence >= SLIP_CONFIDENCE_MIN;
  const amount = typeof reading?.amount === 'number' ? reading.amount : null;
  // เทียบเป็นสตางค์ กันเศษ float (0.1 + 0.2 ≠ 0.3)
  const amountOk =
    readable &&
    amount !== null &&
    Math.round(Math.abs(amount - expectedAmount) * 100) <= Math.round(SLIP_AMOUNT_TOLERANCE * 100);
  const accountOk = readable && isCompanyAccount(reading?.toAccount);
  const transferAt = slipTransferDate(reading);
  const dateOk = readable && (transferAt === null || !isFutureBkkDay(transferAt, now));

  return [
    {
      code: 'READABLE',
      ok: readable,
      label: LABELS.READABLE,
      detail: !reading
        ? 'ระบบอ่านสลิปไม่พร้อมหรืออ่านรูปไม่ได้'
        : !reading.isSlip
          ? 'รูปนี้ไม่ใช่สลิปโอนเงิน'
          : readable
            ? `ความมั่นใจ ${Math.round(reading.confidence * 100)}%`
            : `ความมั่นใจ ${Math.round((reading.confidence ?? 0) * 100)}% ต่ำกว่าเกณฑ์`,
    },
    {
      code: 'AMOUNT_MATCH',
      ok: amountOk,
      label: LABELS.AMOUNT_MATCH,
      detail:
        amount === null
          ? 'อ่านยอดไม่ได้'
          : amountOk
            ? `${money(amount)} บาท`
            : amount < expectedAmount
              ? `ขาดอีก ${money(expectedAmount - amount)} บาท จึงจะครบยอดปิด ${money(expectedAmount)}`
              : `เกินยอดปิด ${money(amount - expectedAmount)} บาท (ยอดปิด ${money(expectedAmount)})`,
    },
    {
      code: 'COMPANY_ACCOUNT',
      ok: accountOk,
      label: LABELS.COMPANY_ACCOUNT,
      detail: !reading?.toAccount
        ? 'อ่านบัญชีปลายทางไม่ได้'
        : accountOk
          ? `${reading.bankName ?? ''} ${reading.toAccount}`.trim()
          : 'บัญชีปลายทางไม่ใช่บัญชีบริษัท',
    },
    {
      code: 'NOT_REUSED',
      ok: readable && !reused,
      label: LABELS.NOT_REUSED,
      detail: reused ? 'สลิปนี้เคยใช้บันทึกรายการอื่นแล้ว' : undefined,
    },
    {
      code: 'DATE_VALID',
      ok: dateOk,
      label: LABELS.DATE_VALID,
      detail:
        transferAt === null
          ? 'อ่านวันที่ไม่ได้ — จะใช้วันนี้เป็นวันรับเงิน'
          : dateOk
            ? undefined
            : 'วันที่ในสลิปเป็นวันในอนาคต',
    },
  ];
}

/**
 * ลายนิ้วมือสลิป — สูตรเดียวกับ SlipProcessingService.computeSlipHash ของบอท
 * (sha256(refNo|amount|bank|date) หรือ sha256(url:key)) ⇒ สลิปที่ลูกค้าเคยส่งทางไลน์แล้ว
 * นำมาปิดยอดซ้ำไม่ได้ และกลับกัน
 */
export function slipFingerprint(reading: SlipReading, imageKey: string): string {
  const hasher = crypto.createHash('sha256');
  if (reading.refNo) {
    hasher.update(
      [
        reading.refNo.trim(),
        typeof reading.amount === 'number' ? reading.amount.toFixed(2) : '',
        (reading.bankName ?? '').trim().toUpperCase(),
        (reading.date ?? '').trim(),
      ].join('|'),
    );
  } else {
    hasher.update(`url:${imageKey}`);
  }
  return hasher.digest('hex');
}
