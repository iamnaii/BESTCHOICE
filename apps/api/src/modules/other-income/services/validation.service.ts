import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

const D = Prisma.Decimal;
type Decimal = Prisma.Decimal;

export interface ValidationItem {
  lineNo: number;
  accountCode: string;
  vatPct: Decimal;
  whtPct: Decimal;
  amountBeforeVat: Decimal;
  vatAmount: Decimal;
  whtAmount: Decimal;
}

export interface ValidationAdjustment {
  lineNo: number;
  accountCode: string;
  amount: Decimal;
}

export interface ValidationDoc {
  issueDate: Date | null | undefined;
  paymentAccountCode: string | null | undefined;
  amountReceived: Decimal;
  netReceived: Decimal;
  items: ValidationItem[];
  adjustments: ValidationAdjustment[];
}

export interface ValidationContext {
  isPeriodOpen: (issueDate: Date) => boolean;
  attachmentThreshold: number;
  hasAttachment: boolean;
}

export interface ValidationIssue {
  rule: string;
  msg: string;
  field?: string;
  lineNo?: number;
}

export interface ValidationResult {
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

const VALID_WHT_PCT = [0, 1, 2, 3, 5, 7, 10, 15];
const BLOCKED_INCOME_CODES = new Set(['42-1103']);

@Injectable()
export class ValidationService {
  validate(doc: ValidationDoc, ctx: ValidationContext): ValidationResult {
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];

    // V3: required header fields
    if (!doc.issueDate) {
      errors.push({ rule: 'V3', msg: 'กรุณาระบุวันที่ออกเอกสาร' });
    }
    if (!doc.paymentAccountCode) {
      errors.push({ rule: 'V3', msg: 'กรุณาเลือกช่องทางชำระเงิน' });
    }

    // V3: at least one line item
    if (!doc.items || doc.items.length === 0) {
      errors.push({ rule: 'V3', msg: 'ต้องมีรายการบัญชีอย่างน้อย 1 รายการ' });
    }

    // V4: every item must use a 42-XXXX account (and not a blocked auto-posted code)
    doc.items?.forEach((it) => {
      if (!it.accountCode || !it.accountCode.startsWith('42-')) {
        errors.push({
          rule: 'V4',
          lineNo: it.lineNo,
          msg: `รายการที่ ${it.lineNo}: ต้องเลือกบัญชีกลุ่ม 42-XXXX`,
        });
      } else if (BLOCKED_INCOME_CODES.has(it.accountCode)) {
        errors.push({
          rule: 'V4',
          lineNo: it.lineNo,
          msg: `บัญชี ${it.accountCode} ถูกบันทึกอัตโนมัติผ่านหน้ารับชำระค่างวดอยู่แล้ว — ไม่ต้องบันทึกซ้ำที่นี่`,
        });
      }

      if (it.amountBeforeVat.lte(0)) {
        errors.push({
          rule: 'V4',
          lineNo: it.lineNo,
          msg: `รายการที่ ${it.lineNo}: จำนวนเงินต้องมากกว่า 0`,
        });
      }
    });

    // V7: warn on non-standard WHT% (does not block)
    doc.items?.forEach((it) => {
      const pct = Number(it.whtPct);
      if (!VALID_WHT_PCT.includes(pct)) {
        warnings.push({
          rule: 'V7',
          lineNo: it.lineNo,
          msg: `WHT ${pct}% ไม่อยู่ในชุดมาตรฐาน {0,1,2,3,5,7,10,15}`,
        });
      }
    });

    // V15 — Bank interest income (42-1102) is VAT-exempt under ม.81(1)(ฏ) and
    // is statutorily WHT-deducted at 15% by the bank (ม.50(2)(ข) + ม.50 ทวิ).
    // Bookings that violate either are almost always a misclassified account.
    doc.items?.forEach((it) => {
      if (it.accountCode !== '42-1102') return;
      if (it.vatPct.gt(0)) {
        errors.push({
          rule: 'V15',
          lineNo: it.lineNo,
          msg: `รายการที่ ${it.lineNo}: ดอกเบี้ยเงินฝาก (42-1102) ได้รับยกเว้น VAT (ม.81(1)(ฏ)) — กรุณาตั้ง VAT% = 0`,
        });
      }
      if (!it.whtPct.eq(15)) {
        warnings.push({
          rule: 'V15',
          lineNo: it.lineNo,
          msg: `รายการที่ ${it.lineNo}: ดอกเบี้ยเงินฝาก (42-1102) ถูกหัก ณ ที่จ่าย 15% โดยธนาคารตามกฎหมาย — ตรวจสอบ WHT% อีกครั้ง`,
        });
      }
    });

    // V6: if any item has VAT% > 0, vatAmount must be > 0
    const hasVatItem = doc.items?.some((it) => it.vatPct.gt(0)) ?? false;
    if (hasVatItem) {
      const totalVat = (doc.items || []).reduce<Decimal>(
        (s, it) => s.plus(it.vatAmount),
        new D(0),
      );
      if (totalVat.lte(0)) {
        errors.push({
          rule: 'V6',
          msg: 'มีรายการ VAT% > 0 แต่ vat_amount = 0 — ตรวจสอบการคำนวณ',
        });
      }
    }

    // V8: issueDate must be in an open period
    if (doc.issueDate && !ctx.isPeriodOpen(doc.issueDate)) {
      const ym = `${doc.issueDate.getFullYear()}-${String(doc.issueDate.getMonth() + 1).padStart(2, '0')}`;
      errors.push({
        rule: 'V8',
        msg: `งวด ${ym} ปิดบัญชีแล้ว — ไม่สามารถบันทึกได้`,
      });
    }

    // V10/V12: amountReceived must reconcile to netReceived via adjustments
    const diff = doc.amountReceived.minus(doc.netReceived);
    if (!diff.eq(0)) {
      const adjSum = (doc.adjustments || []).reduce<Decimal>(
        (s, a) => s.plus(a.amount),
        new D(0),
      );
      if (!doc.adjustments || doc.adjustments.length === 0) {
        errors.push({
          rule: 'V10',
          msg: `จำนวนรับ (${doc.amountReceived}) ไม่ตรงกับยอดสุทธิ (${doc.netReceived}) — ต้องระบุบัญชีปรับผลต่าง`,
        });
      } else if (!adjSum.eq(diff.abs())) {
        errors.push({
          rule: 'V12',
          msg: `ผลรวมบัญชีปรับ (${adjSum}) ไม่เท่ากับผลต่าง (${diff.abs()})`,
        });
      }
    }

    // V13/V14: adjustment rows must have accountCode and amount > 0
    doc.adjustments?.forEach((adj) => {
      if (!adj.accountCode) {
        errors.push({
          rule: 'V13',
          lineNo: adj.lineNo,
          msg: `บัญชีปรับแถวที่ ${adj.lineNo} ยังไม่ได้เลือกบัญชี`,
        });
      }
      if (adj.amount.lte(0)) {
        errors.push({
          rule: 'V14',
          lineNo: adj.lineNo,
          msg: `บัญชีปรับแถวที่ ${adj.lineNo}: จำนวนต้องมากกว่า 0`,
        });
      }
    });

    // V11: large amounts require an attachment
    if (doc.amountReceived.gte(ctx.attachmentThreshold) && !ctx.hasAttachment) {
      errors.push({
        rule: 'V11',
        msg: `ยอด ≥ ${ctx.attachmentThreshold} ฿ ต้องแนบไฟล์ประกอบอย่างน้อย 1 ไฟล์`,
      });
    }

    return { errors, warnings };
  }
}
