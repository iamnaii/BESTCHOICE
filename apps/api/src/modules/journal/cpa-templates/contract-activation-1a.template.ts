import { Injectable } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { JournalAutoService } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * Template 1A — Contract Activation (fires once when contract activates).
 *
 * Spec §6.1 — creates the initial HP receivable JE:
 *
 *   Dr 11-2101 ลูกหนี้ Gross (financedAmount + commission + interest)
 *   Dr 11-2105 ลูกหนี้ภาษีขายรอเรียกเก็บ (vatTotal)
 *     Cr 21-1101 เจ้าหนี้-หน้าร้าน    (financedAmount)
 *     Cr 21-1102 เจ้าหนี้ค่าคอม       (commission)
 *     Cr 11-2106 รายได้รอตัดบัญชี-ดอกเบี้ย (interest, Contra Asset)
 *     Cr 21-2102 ภาษีขายรอเรียกเก็บ   (vatTotal)
 *
 * Total Dr = Total Cr = financedAmount + commission + interest + vatTotal
 *
 * Source of amounts (from Contract schema):
 *   financedAmount  → contract.financedAmount
 *   commission      → contract.storeCommission (nullable; fallback: 10% of financedAmount)
 *   interest        → contract.interestTotal
 *   vatTotal        → contract.vatAmount (nullable; fallback: 7% of gross excl VAT)
 */
@Injectable()
export class ContractActivation1ATemplate {
  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
  ) {}

  async execute(contractId: string): Promise<{ entryNumber: string }> {
    const c = await this.prisma.contract.findUniqueOrThrow({
      where: { id: contractId },
    });

    const financed = new Decimal(c.financedAmount.toString());
    const interest = new Decimal(c.interestTotal.toString());

    // commission: use storeCommission if set, else derive as 10% of financedAmount
    const commission =
      c.storeCommission != null
        ? new Decimal(c.storeCommission.toString())
        : financed.times('0.10').toDecimalPlaces(2);

    const grossExclVat = financed.plus(commission).plus(interest);

    // vatTotal: use vatAmount if set, else derive as 7% of grossExclVat
    const vat =
      c.vatAmount != null
        ? new Decimal(c.vatAmount.toString())
        : grossExclVat.times('0.07').toDecimalPlaces(2);

    const zero = new Decimal(0);

    const result = await this.journal.createAndPost({
      description: `สัญญาผ่อนชำระ ${c.contractNumber} — รับรู้ลูกหนี้ครั้งแรก`,
      reference: contractId,
      metadata: { tag: '1A', contractId },
      lines: [
        {
          accountCode: '11-2101',
          dr: grossExclVat,
          cr: zero,
          description: 'ลูกหนี้ผ่อนชำระ Gross (ไม่รวม VAT)',
        },
        {
          accountCode: '11-2105',
          dr: vat,
          cr: zero,
          description: 'ลูกหนี้ภาษีขายรอเรียกเก็บ',
        },
        {
          accountCode: '21-1101',
          dr: zero,
          cr: financed,
          description: 'เจ้าหนี้-หน้าร้าน',
        },
        {
          accountCode: '21-1102',
          dr: zero,
          cr: commission,
          description: 'เจ้าหนี้ค่าคอม-หน้าร้าน',
        },
        {
          accountCode: '11-2106',
          dr: zero,
          cr: interest,
          description: 'รายได้รอตัดบัญชี-ดอกเบี้ย (Contra Asset)',
        },
        {
          accountCode: '21-2102',
          dr: zero,
          cr: vat,
          description: 'ภาษีขายรอเรียกเก็บ',
        },
      ],
    });

    return { entryNumber: result.entryNumber };
  }
}
