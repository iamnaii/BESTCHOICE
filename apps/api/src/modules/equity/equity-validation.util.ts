import { Prisma, EquityTxnType, ShareholderType } from '@prisma/client';
import {
  NEEDS_PAYMENT,
  NEEDS_RESOLUTION,
  NEEDS_SHAREHOLDERS,
  PaDirection,
} from './equity-journal.builder';

const D = Prisma.Decimal;
type Dec = Prisma.Decimal;

export interface EquityValidationLine {
  shareholderId: string;
  amount: Dec;
  premium: Dec;
  paid: Dec;
  wht: Dec;
}

export interface EquityValidationDoc {
  txnType: EquityTxnType;
  resolutionNo: string | null;
  resolutionDate: Date | null;
  paymentAccountCode: string | null;
  paAccountCode: string | null;
  paAmount: Dec | null;
  paDirection: PaDirection | string | null;
  lines: EquityValidationLine[];
}

export interface EquityValidationError {
  code: string;
  msg: string;
}

/** WHT ปันผล default ตามประเภทผู้ถือหุ้น — INDIVIDUAL/JURISTIC_FOREIGN = 10% (HALF_UP 2dp), JURISTIC_TH = 0 */
export function computeDefaultWht(type: ShareholderType, amount: Dec): Dec {
  if (type === 'JURISTIC_TH') return new D(0);
  return amount.times('0.10').toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

/**
 * Validation ก่อน submit/post (pure — GL guards ที่ต้องอ่าน DB อยู่ใน EquityService).
 * คืน [] เมื่อผ่านทั้งหมด — error message ภาษาไทย
 */
export function validateEquityDoc(
  doc: EquityValidationDoc,
  opts: { hasAttachment: boolean },
): EquityValidationError[] {
  const errors: EquityValidationError[] = [];
  const t = doc.txnType;

  if (NEEDS_RESOLUTION.includes(t)) {
    if (!doc.resolutionNo || !doc.resolutionDate) {
      errors.push({ code: 'V_RESOLUTION', msg: 'กรุณากรอกเลขที่และวันที่มติที่ประชุม' });
    }
    if (!opts.hasAttachment) {
      errors.push({ code: 'V8', msg: 'ต้องแนบเอกสารมติที่ประชุมอย่างน้อย 1 ไฟล์' });
    }
  }

  if (NEEDS_PAYMENT.includes(t) && !doc.paymentAccountCode) {
    errors.push({ code: 'PAYMENT', msg: 'กรุณาเลือกช่องทางเงินสด/ธนาคาร' });
  }

  if (NEEDS_SHAREHOLDERS.includes(t)) {
    if (doc.lines.length === 0) {
      errors.push({ code: 'SH_REQUIRED', msg: 'กรุณาเพิ่มผู้ถือหุ้นอย่างน้อย 1 ราย' });
    }
    const seen = new Set<string>();
    doc.lines.forEach((ln, i) => {
      if (seen.has(ln.shareholderId)) {
        errors.push({
          code: 'V_SH_UNIQUE',
          msg: `รายการที่ ${i + 1}: ผู้ถือหุ้นซ้ำในเอกสารเดียวกัน`,
        });
      }
      seen.add(ln.shareholderId);
      if (ln.amount.lte(0)) {
        errors.push({ code: 'SH_AMOUNT', msg: `รายการที่ ${i + 1}: จำนวนเงินต้องมากกว่า 0` });
      }
    });
  }

  if (t === 'CAP_INIT') {
    doc.lines.forEach((ln, i) => {
      if (ln.paid.lt(0) || ln.paid.gt(ln.amount)) {
        errors.push({
          code: 'V_INIT_PAID_LE_PAR',
          msg: `รายการที่ ${i + 1}: ชำระจริง (${ln.paid.toFixed(2)}) ต้องอยู่ระหว่าง 0 ถึงมูลค่าหุ้นที่จอง (${ln.amount.toFixed(2)})`,
        });
      }
    });
    const totalPar = doc.lines.reduce((s, l) => s.plus(l.amount), new D(0));
    const totalPaid = doc.lines.reduce((s, l) => s.plus(l.paid), new D(0));
    if (totalPar.gt(0) && totalPaid.lt(totalPar.times('0.25'))) {
      errors.push({
        code: 'V_INIT_25',
        msg: `ต้องชำระขั้นต่ำ 25% ของทุนจดทะเบียน (${totalPar.times('0.25').toFixed(2)} บาท) — ปัจจุบันชำระ ${totalPaid.toFixed(2)} บาท (ป.พ.พ. ม.1110)`,
      });
    }
  }

  if (t === 'DIV_PAY') {
    doc.lines.forEach((ln, i) => {
      if (ln.wht.lt(0) || ln.wht.gt(ln.amount)) {
        errors.push({
          code: 'WHT_RANGE',
          msg: `รายการที่ ${i + 1}: WHT ต้องอยู่ระหว่าง 0 ถึงยอดปันผลของรายนั้น`,
        });
      }
    });
  }

  if (t === 'PRIOR_ADJ') {
    const dirOk = doc.paDirection === 'DR_OTHER_CR_RE' || doc.paDirection === 'DR_RE_CR_OTHER';
    if (!doc.paAccountCode || !doc.paAmount || doc.paAmount.lte(0) || !dirOk) {
      errors.push({ code: 'PA_FIELDS', msg: 'กรุณากรอกบัญชีคู่ปรับปรุง จำนวนเงิน (>0) และทิศทาง' });
    }
  }

  return errors;
}
