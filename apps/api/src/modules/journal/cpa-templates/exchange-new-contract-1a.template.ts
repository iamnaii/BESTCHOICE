import { Injectable } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { JournalAutoService } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * Exchange A.1 — New-contract activation JE for same-price exchange.
 *
 * Same JE shape as ContractActivation1ATemplate but invoked from the
 * exchange-approval flow. Posts on the NEW replacement contract (which
 * already has the remaining-installment plan baked in by
 * ContractExchangeService.approve before this template runs).
 *
 *   Dr 11-2101 ลูกหนี้ผ่อนชำระ Gross (financedAmount + commission + interest)
 *   Dr 11-2105 ลูกหนี้ภาษีขายรอเรียกเก็บ (vatTotal)
 *     Cr 21-1101 เจ้าหนี้-หน้าร้าน    (financedAmount)
 *     Cr 21-1102 เจ้าหนี้ค่าคอม       (commission)
 *     Cr 11-2106 รายได้รอตัดบัญชี-ดอกเบี้ย (interest, Contra Asset)
 *     Cr 21-2102 ภาษีขายรอเรียกเก็บ   (vatTotal)
 *
 * Total Dr = Total Cr = financedAmount + commission + interest + vatTotal
 */
@Injectable()
export class ExchangeNewContract1ATemplate {
  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
  ) {}

  async execute(
    newContractId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<{ id: string; entryNumber: string }> {
    const client = tx ?? this.prisma;
    const c = await client.contract.findUniqueOrThrow({
      where: { id: newContractId },
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

    return this.journal.createAndPost(
      {
        description: `Exchange A.1 — new contract activation (${c.contractNumber ?? newContractId})`,
        reference: newContractId,
        metadata: { flow: 'exchange-new-contract-1a', newContractId },
        lines: [
          {
            accountCode: '11-2101',
            dr: grossExclVat,
            cr: zero,
            description: 'ลูกหนี้ผ่อนชำระ Gross (ไม่รวม VAT) — เครื่องทดแทน',
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
      },
      tx,
    );
  }
}
