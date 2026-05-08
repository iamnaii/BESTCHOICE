import { Injectable } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { JournalAutoService } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class VendorClearanceTemplate {
  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
  ) {}

  /** Spec §6.7 — point 3 of every case. Pays vendor (shop) the financedAmount + commission. */
  async execute(input: {
    contractId: string;
    depositAccountCode: string;
  }): Promise<{ entryNo: string }> {
    const c = await this.prisma.contract.findUniqueOrThrow({ where: { id: input.contractId } });
    const financed = new Decimal(c.financedAmount.toString());
    const commission =
      (c as any).storeCommission != null
        ? new Decimal((c as any).storeCommission.toString())
        : financed.times('0.10').toDecimalPlaces(2);
    const total = financed.plus(commission);

    const result = await this.journal.createAndPost({
      description: `Vendor payment for contract ${c.contractNumber}`,
      reference: `${c.id}:vendor-clearance:${Date.now()}`,
      metadata: {
        tag: 'VC',
        flow: 'vendor-clearance',
        contractId: c.id,
        financedAmount: financed.toFixed(2),
        commission: commission.toFixed(2),
      },
      lines: [
        {
          accountCode: '21-1101',
          dr: financed,
          cr: new Decimal(0),
          description: 'ล้างเจ้าหนี้-หน้าร้าน',
        },
        {
          accountCode: '21-1102',
          dr: commission,
          cr: new Decimal(0),
          description: 'ล้างเจ้าหนี้ค่าคอม',
        },
        {
          accountCode: input.depositAccountCode,
          dr: new Decimal(0),
          cr: total,
          description: 'จ่ายหน้าร้าน',
        },
      ],
    });
    return { entryNo: result.entryNumber };
  }
}
