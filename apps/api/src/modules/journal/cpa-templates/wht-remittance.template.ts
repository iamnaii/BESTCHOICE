import { Injectable, Logger } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { JournalAutoService } from '../journal-auto.service';

/** Maps whtCategory → WHT payable account code (same as accrual side) */
const WHT_PAYABLE_CODE: Record<string, string> = {
  PND1: '21-3101', // ภ.ง.ด. 1 ค้างจ่าย — payroll
  PND3: '21-3102', // ภ.ง.ด. 3 ค้างจ่าย — individual contractor
  PND53: '21-3103', // ภ.ง.ด. 53 ค้างจ่าย — corporate vendor
};

export interface WhtRemittanceTemplateInput {
  whtCategory: 'PND1' | 'PND3' | 'PND53';
  amount: Decimal;
  remittanceDate: Date;
  /** Cash/bank account code making the payment to RD */
  depositAccountCode: string;
  /** Optional reference (e.g. remittance batch ID or month) */
  vendorReference?: string;
}

/**
 * Template — Remit accrued WHT to Revenue Department (Phase A.5c).
 *
 * Scenario: End-of-month, pay the accumulated WHT balance to สรรพากร.
 *
 * JE:
 *   Dr 21-310X WHT payable   [amount]   (clears the accrual liability)
 *     Cr <depositAccountCode> [amount]
 *
 * Simplification note: For PND53, the full flow should be:
 *   1. File ภ.ง.ด.53 form → move 21-3103 → 21-3202 (เจ้าหนี้สรรพากร ภ.ง.ด. 53 รอชำระ)
 *   2. Pay 21-3202 → Cr cash
 * This template does a single-step direct clearance (21-3103 → Cr cash) for simplicity.
 * Upgrade to 2-step when filing-vs-payment date split becomes operationally relevant.
 */
@Injectable()
export class WhtRemittanceTemplate {
  private readonly logger = new Logger(WhtRemittanceTemplate.name);

  constructor(private readonly journal: JournalAutoService) {}

  async execute(input: WhtRemittanceTemplateInput): Promise<{ entryNo: string }> {
    const { whtCategory, amount, remittanceDate, depositAccountCode, vendorReference } = input;

    const zero = new Decimal(0);
    const whtPayableCode = WHT_PAYABLE_CODE[whtCategory];

    const dateStr = remittanceDate.toISOString().slice(0, 10);
    const ref = `wht-remittance:${whtCategory}:${dateStr}:${vendorReference ?? Date.now()}`;

    const result = await this.journal.createAndPost({
      description: `นำส่งภาษีหัก ณ ที่จ่าย (${whtCategory}) วันที่ ${dateStr}${vendorReference ? ` — ${vendorReference}` : ''}`,
      reference: ref,
      metadata: {
        tag: 'WHT',
        flow: 'remittance',
        whtCategory,
        remittanceDate: dateStr,
        vendorReference: vendorReference ?? null,
      },
      lines: [
        {
          accountCode: whtPayableCode,
          dr: amount,
          cr: zero,
          description: `ล้างภาษีหัก ณ ที่จ่าย (${whtCategory})`,
        },
        {
          accountCode: depositAccountCode,
          dr: zero,
          cr: amount,
          description: `นำส่งสรรพากร (${whtCategory}) ${dateStr}`,
        },
      ],
    });

    this.logger.log(
      `[A.5c] WhtRemittanceTemplate: posted JE ${result.entryNumber} — ${whtCategory} amount=${amount.toFixed(2)} date=${dateStr}`,
    );

    return { entryNo: result.entryNumber };
  }
}
