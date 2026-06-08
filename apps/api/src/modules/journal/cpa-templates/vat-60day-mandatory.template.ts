import { Injectable } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { JournalAutoService } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { computeInstallmentBreakdown } from '../compute-installment-breakdown';

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

      // vatPerInst via the shared single source of truth (same rounding as 2A):
      // (financed + commission[10%] + interest) × 7% / totalMonths, ROUND_HALF_UP.
      const { vatPerInst } = computeInstallmentBreakdown({
        financedAmount: c.financedAmount.toString(),
        storeCommission: c.storeCommission != null ? c.storeCommission.toString() : null,
        interestTotal: c.interestTotal.toString(),
        vatAmount: c.vatAmount != null ? c.vatAmount.toString() : null,
        totalMonths: c.totalMonths,
      });

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
