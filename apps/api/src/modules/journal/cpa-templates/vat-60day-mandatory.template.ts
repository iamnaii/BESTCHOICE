import { Injectable } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { JournalAutoService } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * Template Feature I — VAT 60-Day Mandatory
 *
 * When a customer has not paid an installment for 60+ days, Thai tax law
 * requires the seller to remit VAT to the Revenue Department on their behalf.
 * This JE recognises:
 *   - The P&L cost of paying VAT for the non-paying customer (51-1101)
 *   - A receivable from the customer for VAT paid on their behalf (11-2104)
 *   - The liability to the RD (21-2103)
 *
 * Double-entry (vatPerInst = 99.17):
 *   Dr 51-1101 ค่าใช้จ่าย VAT ลูกหนี้ไม่ชำระ   99.17
 *   Dr 11-2104 ลูกหนี้-VAT ที่ออกแทน           99.17
 *     Cr 21-2103 VAT บังคับ-ลูกหนี้ค้าง 60 วัน 198.34
 *
 * Total: Dr 198.34 = Cr 198.34 ✓
 *
 * Idempotent: returns null if vat60dayJournalEntryId is already set.
 */
@Injectable()
export class Vat60dayMandatoryTemplate {
  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
  ) {}

  async execute(installmentScheduleId: string): Promise<{ entryNo: string } | null> {
    const inst = await this.prisma.installmentSchedule.findUniqueOrThrow({
      where: { id: installmentScheduleId },
    });

    // Idempotency guard — already processed
    if (inst.vat60dayJournalEntryId) return null;

    const c = await this.prisma.contract.findUniqueOrThrow({ where: { id: inst.contractId } });

    const total = new Decimal(c.totalMonths);
    const vat =
      c.vatAmount != null
        ? new Decimal(c.vatAmount.toString())
        : new Decimal(c.financedAmount.toString()).times('1.17').times('0.07').toDecimalPlaces(2);

    const vatPerInst = vat.div(total).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    const doubleVat = vatPerInst.times(2);

    const zero = new Decimal(0);

    const result = await this.journal.createAndPost({
      description: `VAT 60-day mandatory งวด #${inst.installmentNo} สัญญา ${c.contractNumber}`,
      reference: `${inst.id}:vat60-mandatory`,
      metadata: {
        tag: 'VAT60-MANDATORY',
        flow: 'mandatory',
        contractId: c.id,
        installmentScheduleId: inst.id,
        installmentNo: inst.installmentNo,
      },
      lines: [
        {
          accountCode: '51-1101',
          dr: vatPerInst,
          cr: zero,
          description: 'ค่าใช้จ่าย VAT ลูกหนี้ไม่ชำระ',
        },
        {
          accountCode: '11-2104',
          dr: vatPerInst,
          cr: zero,
          description: 'ลูกหนี้-VAT ที่ออกแทน',
        },
        {
          accountCode: '21-2103',
          dr: zero,
          cr: doubleVat,
          description: 'VAT บังคับ-ลูกหนี้ค้าง 60 วัน',
        },
      ],
    });

    // Mark installment as having a 60-day VAT JE
    await this.prisma.installmentSchedule.update({
      where: { id: inst.id },
      data: { vat60dayJournalEntryId: result.entryNumber },
    });

    return { entryNo: result.entryNumber };
  }
}
