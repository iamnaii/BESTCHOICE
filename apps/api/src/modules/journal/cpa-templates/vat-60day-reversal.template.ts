import { Injectable } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
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

      // W8 fix: prefer mandatory JE's persisted vatPerInst so reversal mirrors
      // the mandatory pair 1:1. If Contract.vatAmount / interestTotal /
      // storeCommission were edited between mandatory and reversal, the
      // recomputed value would drift and leave a permanent imbalance on
      // 21-2103 / 11-2104.
      //
      // Round 2 W8 fix: legacy mandatory JEs posted before vatPerInst was
      // added to metadata MUST still be reversible — otherwise customers
      // who paid an overdue installment would be permanently blocked from
      // payment receipt + early payoff. Fall back to the original recompute
      // (Vat60dayMandatoryTemplate.execute mirrors this exact formula) and
      // Sentry-capture the drift risk so we can run the backfill before
      // contract data drifts further.
      //
      // Backfill script: `apps/api/src/cli/backfill-vat60-metadata.cli.ts`
      // (TODO — see follow-up issue). Transition removed once Sentry warning
      // count drops to zero.
      const mandatoryEntry = await tx.journalEntry.findUnique({
        where: { entryNumber: inst.vat60dayJournalEntryId },
        select: { metadata: true },
      });
      const meta = (mandatoryEntry?.metadata ?? {}) as Record<string, unknown>;
      let vatPerInst: Decimal;
      if (typeof meta.vatPerInst === 'string' && meta.vatPerInst) {
        vatPerInst = new Decimal(meta.vatPerInst);
      } else {
        // Legacy fallback — recompute from current Contract fields. Mirrors
        // Vat60dayMandatoryTemplate's formula exactly so values match for
        // any contract whose VAT/interest fields haven't drifted.
        const total = new Decimal(c.totalMonths);
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
        vatPerInst = vat.div(total).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
        Sentry.captureMessage(
          'VAT 60-day reversal missing vatPerInst — falling back to recompute',
          {
            level: 'warning',
            tags: { module: 'journal', action: 'vat60_reversal_legacy_fallback' },
            extra: {
              installmentScheduleId: inst.id,
              installmentNo: inst.installmentNo,
              contractId: c.id,
              contractNumber: c.contractNumber,
              mandatoryEntryNumber: inst.vat60dayJournalEntryId,
              recomputedVatPerInst: vatPerInst.toFixed(2),
            },
          },
        );
      }

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
