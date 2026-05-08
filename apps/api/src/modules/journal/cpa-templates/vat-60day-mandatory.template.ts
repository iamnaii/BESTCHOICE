import { Injectable } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { JournalAutoService } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * Template Feature I — VAT 60-Day Mandatory
 *
 * When a customer has not paid an installment for 60+ days, Thai tax law
 * (ประมวลรัษฎากร ม.82/3) requires the seller to remit VAT to the Revenue
 * Department on the customer's behalf. The seller still expects to collect
 * the VAT back from the customer eventually.
 *
 * This JE recognises (per ม.82/3, 1× per installment — NOT 2×):
 *   - A receivable from the customer for VAT paid on their behalf (11-2104)
 *   - The liability to the RD (21-2103)
 *
 * NO P&L expense is recognised here because the customer still owes the
 * amount (write-off only happens when the receivable is deemed bad).
 *
 * Double-entry (vatPerInst = 99.17):
 *   Dr 11-2104 ลูกหนี้-VAT ที่ออกแทน           99.17
 *     Cr 21-2103 VAT บังคับ-ลูกหนี้ค้าง 60 วัน  99.17
 *
 * Total: Dr 99.17 = Cr 99.17 ✓
 *
 * Atomicity: createAndPost + installmentSchedule.update wrapped in
 * a single $transaction. Without the wrapper a process crash between
 * the two writes would commit the JE but leave vat60dayJournalEntryId
 * null — next cron run would double-post.
 *
 * vatPerInst is persisted on metadata so the reversal template can
 * read it back and reverse the same value (avoids fallback drift if
 * Contract fields change between mandatory and reversal).
 *
 * Idempotent: returns null if vat60dayJournalEntryId is already set.
 */
@Injectable()
export class Vat60dayMandatoryTemplate {
  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
  ) {}

  async execute(
    installmentScheduleId: string,
    outerTx?: Prisma.TransactionClient,
  ): Promise<{ entryNo: string } | null> {
    const exec = async (tx: Prisma.TransactionClient) => {
      const inst = await tx.installmentSchedule.findUniqueOrThrow({
        where: { id: installmentScheduleId },
      });

      // Idempotency guard — already processed
      if (inst.vat60dayJournalEntryId) return null;

      const c = await tx.contract.findUniqueOrThrow({ where: { id: inst.contractId } });

      const total = new Decimal(c.totalMonths);
      // grossExclVat (financed + commission + interest) × 0.07
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

      const zero = new Decimal(0);

      const result = await this.journal.createAndPost(
        {
          description: `VAT 60-day mandatory งวด #${inst.installmentNo} สัญญา ${c.contractNumber}`,
          reference: `${inst.id}:vat60-mandatory`,
          metadata: {
            tag: 'VAT60-MANDATORY',
            flow: 'mandatory',
            contractId: c.id,
            installmentScheduleId: inst.id,
            installmentNo: inst.installmentNo,
            // Persist vatPerInst so reversal can mirror it exactly
            vatPerInst: vatPerInst.toFixed(2),
          },
          lines: [
            {
              accountCode: '11-2104',
              dr: vatPerInst,
              cr: zero,
              description: 'ลูกหนี้-VAT ที่ออกแทน',
            },
            {
              accountCode: '21-2103',
              dr: zero,
              cr: vatPerInst,
              description: 'VAT บังคับ-ลูกหนี้ค้าง 60 วัน',
            },
          ],
        },
        tx,
      );

      // Mark installment as having a 60-day VAT JE — same tx as JE post
      await tx.installmentSchedule.update({
        where: { id: inst.id },
        data: { vat60dayJournalEntryId: result.entryNumber },
      });

      return { entryNo: result.entryNumber };
    };

    return outerTx ? exec(outerTx) : this.prisma.$transaction(exec);
  }
}
