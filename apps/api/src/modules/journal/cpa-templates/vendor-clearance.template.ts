import { Injectable, Logger } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { JournalAutoService } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class VendorClearanceTemplate {
  private readonly logger = new Logger(VendorClearanceTemplate.name);

  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Spec §6.7 — point 3 of every case. Pays vendor (shop) the financedAmount + commission.
   *
   * Idempotent: skips if a vendor-clearance JE already exists for this contract.
   * Composable in outer transactions via the optional tx param.
   */
  async execute(
    input: {
      contractId: string;
      depositAccountCode: string;
    },
    outerTx?: Prisma.TransactionClient,
  ): Promise<{ entryNo: string }> {
    const client = outerTx ?? this.prisma;

    // Idempotency check — never double-pay vendor
    const existing = await client.journalEntry.findFirst({
      where: {
        AND: [
          { metadata: { path: ['flow'], equals: 'vendor-clearance' } } as Prisma.JournalEntryWhereInput,
          { metadata: { path: ['contractId'], equals: input.contractId } } as Prisma.JournalEntryWhereInput,
        ],
        deletedAt: null,
      },
    });
    if (existing) {
      this.logger.log(
        `[VC] VendorClearance idempotency — JE ${existing.entryNumber} already exists for contract ${input.contractId}, skipping`,
      );
      return { entryNo: existing.entryNumber };
    }

    const c = await client.contract.findUniqueOrThrow({ where: { id: input.contractId } });
    const financed = new Decimal(c.financedAmount.toString());
    const commission =
      c.storeCommission != null
        ? new Decimal(c.storeCommission.toString())
        : financed.times('0.10').toDecimalPlaces(2);
    const total = financed.plus(commission);

    const result = await this.journal.createAndPost(
      {
        description: `จ่ายเงินหน้าร้าน — สัญญา ${c.contractNumber}`,
        reference: `${c.id}:vendor-clearance`,
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
      },
      outerTx,
    );
    return { entryNo: result.entryNumber };
  }
}
