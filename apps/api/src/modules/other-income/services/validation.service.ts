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

/**
 * Validation rule numbering — aligned to the accountant's PDF Spec v1.0
 * (`docs/superpowers/specs/2026-05-12-other-income-v2-1-pdf-gap-fixes-design.md`).
 *
 * Rules from the spec:
 *   V1  — Dr = Cr (Balanced journal)            // N/A here: journal auto-built by AutoJournalService + balanced by construction
 *   V2  — Journal lines ≥ 2                     // N/A here: same reason as V1
 *   V3  — Header complete (date + payment ch.) + ≥1 item
 *   V4  — Every item: account_code valid + amount > 0
 *   V5  — Dr XOR Cr per line                    // N/A here: same reason as V1
 *   V6  — VAT consistent (item vatPct↔vatAmount, item↔journal)
 *   V7  — WHT% ∈ {0,1,2,3,5,7,10,15}            // warning only — non-standard rates allowed
 *   V8  — Issue date in an open accounting period
 *   V9  — Maker ≠ Approver                      // enforced in OtherIncomeService.approve() (Maker-Checker opt-in flag)
 *   V10 — Diff between received and expected requires adjustment rows
 *   V11 — Amounts ≥ ATTACHMENT_THRESHOLD require an attachment
 *   V12 — Sum(adjustments) == |diff|
 *   V13 — Every adjustment row has account_code
 *   V14 — Every adjustment row amount > 0
 *
 * BESTCHOICE-specific extension (not in PDF spec):
 *   V15 — 42-1102 bank interest is VAT-exempt (ม.81(1)(ฏ)) — vatPct must be 0
 */
@Injectable()
export class ValidationService {
  validate(doc: ValidationDoc, ctx: ValidationContext): ValidationResult {
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];

    // V3 — Header complete + ≥1 item
    if (!doc.issueDate) {
      errors.push({ rule: 'V3', msg: 'กรุณาระบุวันที่ออกเอกสาร' });
    }
    if (!doc.paymentAccountCode) {
      errors.push({ rule: 'V3', msg: 'กรุณาเลือกช่องทางชำระเงิน' });
    }
    if (!doc.items || doc.items.length === 0) {
      errors.push({ rule: 'V3', msg: 'ต้องมีรายการบัญชีอย่างน้อย 1 รายการ' });
    }

    // V4 — Every item: 42-XXXX account + amountBeforeVat > 0 (+ block auto-posted codes)
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

    // V6 — VAT consistent: if any item has VAT% > 0, totalVat must be > 0
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

    // V7 — WHT% in standard set (warning only — non-standard rates pass)
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

    // V8 — Issue date must be in an OPEN accounting period
    if (doc.issueDate && !ctx.isPeriodOpen(doc.issueDate)) {
      const ym = `${doc.issueDate.getFullYear()}-${String(doc.issueDate.getMonth() + 1).padStart(2, '0')}`;
      errors.push({
        rule: 'V8',
        msg: `งวด ${ym} ปิดบัญชีแล้ว — ไม่สามารถบันทึกได้`,
      });
    }

    // V9 — Maker ≠ Approver
    //   Enforced in OtherIncomeService.approve() (Maker-Checker flow), not here.
    //   Validator only sees DRAFT/POSTED docs — the maker-vs-approver check happens at the approval step.

    // V11 — Amounts ≥ ATTACHMENT_THRESHOLD require an attachment
    if (doc.amountReceived.gte(ctx.attachmentThreshold) && !ctx.hasAttachment) {
      errors.push({
        rule: 'V11',
        msg: `ยอด ≥ ${ctx.attachmentThreshold} ฿ ต้องแนบไฟล์ประกอบอย่างน้อย 1 ไฟล์`,
      });
    }

    // V10 / V12 — Reconcile amountReceived with netReceived via adjustments
    const diff = doc.amountReceived.minus(doc.netReceived);
    if (!diff.eq(0)) {
      const adjSum = (doc.adjustments || []).reduce<Decimal>(
        (s, a) => s.plus(a.amount),
        new D(0),
      );
      if (!doc.adjustments || doc.adjustments.length === 0) {
        // V10 — Diff > 0 with no adjustments
        errors.push({
          rule: 'V10',
          msg: `จำนวนรับ (${doc.amountReceived}) ไม่ตรงกับยอดสุทธิ (${doc.netReceived}) — ต้องระบุบัญชีปรับผลต่าง`,
        });
      } else if (!adjSum.eq(diff.abs())) {
        // V12 — Sum of adjustments must equal |diff|
        errors.push({
          rule: 'V12',
          msg: `ผลรวมบัญชีปรับ (${adjSum}) ไม่เท่ากับผลต่าง (${diff.abs()})`,
        });
      }
    }

    // V13 / V14 — Every adjustment row: has account_code and amount > 0
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

    // V15 — BESTCHOICE extension: 42-1102 bank interest is VAT-exempt (ม.81(1)(ฏ)).
    //   WHT rate is left to user judgement (1% for นิติบุคคล ออมทรัพย์ ท.ป.4/2528;
    //   15% for ฝากประจำ ม.50). UI tooltip surfaces per-account suggestions.
    doc.items?.forEach((it) => {
      if (it.accountCode !== '42-1102') return;
      if (it.vatPct.gt(0)) {
        errors.push({
          rule: 'V15',
          lineNo: it.lineNo,
          msg: `รายการที่ ${it.lineNo}: ดอกเบี้ยเงินฝาก (42-1102) ได้รับยกเว้น VAT (ม.81(1)(ฏ)) — กรุณาตั้ง VAT% = 0`,
        });
      }
    });

    return { errors, warnings };
  }
}
