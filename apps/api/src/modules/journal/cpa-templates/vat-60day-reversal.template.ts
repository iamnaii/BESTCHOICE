import { Injectable } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { JournalAutoService } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * Template Feature I — VAT 60-Day Reversal
 *
 * When a customer finally pays the installment that triggered the 60-day
 * mandatory VAT JE, this reversal clears those entries:
 *   - Reverses the RD liability (21-2103)
 *   - Records the P&L reversal/recovery (51-1105)
 *   - Clears the VAT receivable from the customer (11-2104)
 *
 * Double-entry (vatPerInst = 99.17):
 *   Dr 21-2103 (กลับรายการ VAT บังคับ)             198.34
 *     Cr 51-1105 VAT กลับรายการ-ลูกหนี้ชำระ         99.17
 *     Cr 11-2104 ล้างลูกหนี้-VAT ที่ออกแทน          99.17
 *
 * Total: Dr 198.34 = Cr 198.34 ✓
 *
 * Idempotent: returns null if vat60dayJournalEntryId is already null
 * (no mandatory JE was ever posted, or already reversed).
 *
 * Called by: PaymentReceipt2BTemplate when it detects vat60dayJournalEntryId != null.
 */
@Injectable()
export class Vat60dayReversalTemplate {
  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
  ) {}

  async execute(
    installmentScheduleId: string,
    tx?: import('@prisma/client').Prisma.TransactionClient,
  ): Promise<{ entryNo: string } | null> {
    const client = tx ?? this.prisma;
    const inst = await client.installmentSchedule.findUniqueOrThrow({
      where: { id: installmentScheduleId },
    });

    // Nothing to reverse if mandatory was never posted
    if (!inst.vat60dayJournalEntryId) return null;

    const c = await client.contract.findUniqueOrThrow({ where: { id: inst.contractId } });

    const total = new Decimal(c.totalMonths);
    // C4 FIX: fallback was financedAmount × 1.17 × 0.07 = wrong (819 for 17K contract).
    // Correct: grossExclVat (financed + commission + interest) × 0.07 → 1190 for standard contract.
    const financed = new Decimal(c.financedAmount.toString());
    const commission =
      c.storeCommission != null
        ? new Decimal(c.storeCommission.toString())
        : financed.times('0.10').toDecimalPlaces(2);
    const interest = new Decimal(c.interestTotal.toString());
    const grossExclVat = financed.plus(commission).plus(interest);
    const vat =
      c.vatAmount != null
        ? new Decimal(c.vatAmount.toString())
        : grossExclVat.times('0.07').toDecimalPlaces(2);

    const vatPerInst = vat.div(total).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    const doubleVat = vatPerInst.times(2);

    const zero = new Decimal(0);

    const result = await this.journal.createAndPost(
      {
        description: `VAT 60-day reversal งวด #${inst.installmentNo} สัญญา ${c.contractNumber}`,
        reference: `${inst.id}:vat60-reversal`,
        metadata: {
          tag: 'VAT60-REVERSAL',
          flow: 'reversal',
          contractId: c.id,
          installmentScheduleId: inst.id,
          installmentNo: inst.installmentNo,
          reversesEntry: inst.vat60dayJournalEntryId,
        },
        lines: [
          {
            accountCode: '21-2103',
            dr: doubleVat,
            cr: zero,
            description: 'กลับรายการ VAT บังคับ',
          },
          {
            accountCode: '51-1105',
            dr: zero,
            cr: vatPerInst,
            description: 'VAT กลับรายการ-ลูกหนี้ชำระ',
          },
          {
            accountCode: '11-2104',
            dr: zero,
            cr: vatPerInst,
            description: 'ล้างลูกหนี้-VAT ที่ออกแทน',
          },
        ],
      },
      tx,
    );

    // Clear the flag — installment is back to normal state
    await client.installmentSchedule.update({
      where: { id: inst.id },
      data: { vat60dayJournalEntryId: null },
    });

    return { entryNo: result.entryNumber };
  }
}
