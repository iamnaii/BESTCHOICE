import { Injectable } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { JournalAutoService } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * Template Feature I — VAT 60-Day Reversal
 *
 * When a customer finally pays the installment that triggered the 60-day
 * mandatory VAT JE, this reversal clears the receivable + liability pair
 * that the mandatory template booked. Mirrors mandatory at 1× vatPerInst
 * per ม.82/3 (mandatory = 1× → reversal = 1×).
 *
 * Double-entry (vatPerInst = 99.17):
 *   Dr 21-2103 กลับรายการ VAT บังคับ                99.17
 *     Cr 11-2104 ล้างลูกหนี้-VAT ที่ออกแทน           99.17
 *
 * Total: Dr 99.17 = Cr 99.17 ✓
 *
 * Atomicity: createAndPost + installmentSchedule.update must run in the
 * same tx. When called from PaymentReceipt2BTemplate the caller passes
 * its own tx; otherwise we open one here.
 *
 * vatPerInst is read from the original mandatory JE's metadata so the
 * reversal mirrors the mandatory 1:1. Refuses to recompute if metadata
 * is missing — drift between mandatory and reversal would leave a
 * permanent imbalance on 21-2103 / 11-2104 if Contract fields changed
 * (W8 fix).
 *
 * Idempotent: returns null if vat60dayJournalEntryId is already null
 * (no mandatory JE was ever posted, or already reversed).
 */
@Injectable()
export class Vat60dayReversalTemplate {
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

      // Nothing to reverse if mandatory was never posted
      if (!inst.vat60dayJournalEntryId) return null;

      const c = await tx.contract.findUniqueOrThrow({ where: { id: inst.contractId } });

      // W8 fix: refuse to recompute vatPerInst at reversal time. The mandatory
      // JE persists vatPerInst in its metadata so the reversal mirrors it 1:1.
      // If Contract.vatAmount / interestTotal / storeCommission were edited
      // between mandatory and reversal (e.g. amend / correction), the
      // recomputed value would drift from the mandatory pair and leave a
      // permanent imbalance on 21-2103 / 11-2104. Better to fail loudly so an
      // accountant fixes the metadata than silently book a drifted reversal.
      const mandatoryEntry = await tx.journalEntry.findUnique({
        where: { entryNumber: inst.vat60dayJournalEntryId },
        select: { metadata: true },
      });
      const meta = (mandatoryEntry?.metadata ?? {}) as Record<string, unknown>;
      if (typeof meta.vatPerInst !== 'string' || !meta.vatPerInst) {
        throw new Error(
          `VAT 60-day reversal refused — mandatory JE ${inst.vat60dayJournalEntryId} ` +
            'is missing vatPerInst in metadata. Recomputation would drift if ' +
            'contract VAT/interest fields changed between mandatory and reversal. ' +
            'Backfill the metadata or post a manual reversal JE.',
        );
      }
      const vatPerInst = new Decimal(meta.vatPerInst);

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
              dr: vatPerInst,
              cr: zero,
              description: 'กลับรายการ VAT บังคับ',
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
      await tx.installmentSchedule.update({
        where: { id: inst.id },
        data: { vat60dayJournalEntryId: null },
      });

      return { entryNo: result.entryNumber };
    };

    return outerTx ? exec(outerTx) : this.prisma.$transaction(exec);
  }
}
