import { Injectable, Logger } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { JournalAutoService } from '../journal-auto.service';

const VAT_INPUT_CODE = '11-4101'; // ภาษีซื้อ

/** Maps whtCategory → WHT payable account code */
const WHT_PAYABLE_CODE: Record<string, string> = {
  PND1: '21-3101', // ภ.ง.ด. 1 ค้างจ่าย — payroll
  PND3: '21-3102', // ภ.ง.ด. 3 ค้างจ่าย — individual contractor
  PND53: '21-3103', // ภ.ง.ด. 53 ค้างจ่าย — corporate vendor
};

export interface WhtAccrualTemplateInput {
  /** Expense account code, e.g. '53-1401' (accounting fees) */
  expenseAccountCode: string;
  /** Gross amount before WHT and before VAT */
  grossAmount: Decimal;
  /** VAT input on the expense (0 if exempt) */
  vatAmount: Decimal;
  /** PND category — determines WHT payable liability account */
  whtCategory: 'PND1' | 'PND3' | 'PND53';
  /** WHT amount (computed by caller, e.g. 3% × gross) */
  whtAmount: Decimal;
  /** Cash/bank account code paying the net amount */
  depositAccountCode: string;
  /** Optional vendor reference for traceability */
  vendorReference?: string;
}

/**
 * Template — Vendor payment with WHT withheld (Phase A.5c).
 *
 * Scenario: Company pays a vendor net-of-WHT and posts the WHT obligation.
 *
 * JE:
 *   Dr <expenseAccountCode>    [grossAmount]
 *   Dr 11-4101 ภาษีซื้อ        [vatAmount]   ← only if vatAmount > 0
 *     Cr <depositAccountCode>  [grossAmount + vatAmount - whtAmount]   (net cash paid)
 *     Cr 21-310X WHT payable   [whtAmount]   (PND1→21-3101, PND3→21-3102, PND53→21-3103)
 *
 * Not idempotent by default — caller should pass a stable vendorReference
 * if retry safety is required (check reference before calling).
 */
@Injectable()
export class WhtAccrualTemplate {
  private readonly logger = new Logger(WhtAccrualTemplate.name);

  constructor(private readonly journal: JournalAutoService) {}

  async execute(input: WhtAccrualTemplateInput): Promise<{ entryNo: string }> {
    const {
      expenseAccountCode,
      grossAmount,
      vatAmount,
      whtCategory,
      whtAmount,
      depositAccountCode,
      vendorReference,
    } = input;

    const zero = new Decimal(0);
    const whtPayableCode = WHT_PAYABLE_CODE[whtCategory];
    // Net cash paid = gross + VAT - WHT
    const netCash = grossAmount.plus(vatAmount).minus(whtAmount);

    const lines: { accountCode: string; dr: Decimal; cr: Decimal; description?: string }[] = [
      {
        accountCode: expenseAccountCode,
        dr: grossAmount,
        cr: zero,
        description: vendorReference ? `ค่าใช้จ่าย - ${vendorReference}` : 'ค่าใช้จ่าย',
      },
    ];

    if (vatAmount.gt(zero)) {
      lines.push({
        accountCode: VAT_INPUT_CODE,
        dr: vatAmount,
        cr: zero,
        description: 'ภาษีซื้อ',
      });
    }

    lines.push(
      {
        accountCode: depositAccountCode,
        dr: zero,
        cr: netCash,
        description: 'จ่ายเงินสุทธิ (หักภาษี ณ ที่จ่าย)',
      },
      {
        accountCode: whtPayableCode,
        dr: zero,
        cr: whtAmount,
        description: `ภาษีหัก ณ ที่จ่าย (${whtCategory})`,
      },
    );

    const ref = `wht-accrual:${vendorReference ?? Date.now()}`;

    const result = await this.journal.createAndPost({
      description: `บันทึกภาษีหัก ณ ที่จ่าย (${whtCategory})${vendorReference ? ` — ${vendorReference}` : ''}`,
      reference: ref,
      metadata: {
        tag: 'WHT',
        flow: 'accrual',
        whtCategory,
        vendorReference: vendorReference ?? null,
      },
      lines,
    });

    this.logger.log(
      `[A.5c] WhtAccrualTemplate: posted JE ${result.entryNumber} — ${whtCategory} wht=${whtAmount.toFixed(2)} ref=${ref}`,
    );

    return { entryNo: result.entryNumber };
  }
}
