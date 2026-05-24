import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { JournalAutoService } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';

export interface ExchangeClearVendorInput {
  newContractId: string;
  buyback: Decimal;
  newVendorYodjat: Decimal;
  newVendorCommission: Decimal;
}

/**
 * Exchange A.3 — Clear 21-1106 against new contract's vendor payables.
 *
 * SAME-PRICE constraint guarantees: buyback === newVendorYodjat + newVendorCommission.
 * Therefore only ONE form (perfect offset — no cash leg).
 *
 *   Dr 21-1101 [new vendor yodjat]
 *   Dr 21-1102 [new vendor commission]
 *     Cr 21-1106 [buyback]
 *
 * If buyback != vendorSum → throw (defensive — indicates same-price filter bug upstream).
 */
@Injectable()
export class ExchangeClearVendor21_1106Template {
  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
  ) {}

  async execute(
    input: ExchangeClearVendorInput,
    tx?: Prisma.TransactionClient,
  ): Promise<{ id: string; entryNumber: string }> {
    const vendorSum = input.newVendorYodjat.plus(input.newVendorCommission);
    if (!vendorSum.equals(input.buyback)) {
      throw new InternalServerErrorException(
        `Exchange A.3: buyback ${input.buyback} does not equal vendor sum ${vendorSum}. ` +
        `Same-price filter must have failed upstream.`,
      );
    }
    const zero = new Decimal(0);

    return this.journal.createAndPost(
      {
        description: `Exchange A.3 — clear 21-1106 (perfect offset)`,
        metadata: {
          flow: 'exchange-clear-vendor-21-1106',
          newContractId: input.newContractId,
        },
        lines: [
          {
            accountCode: '21-1101',
            dr: input.newVendorYodjat,
            cr: zero,
            description: 'เจ้าหนี้-หน้าร้าน (ยอดจัดเครื่องทดแทน)',
          },
          {
            accountCode: '21-1102',
            dr: input.newVendorCommission,
            cr: zero,
            description: 'เจ้าหนี้ค่าคอม-หน้าร้าน (เครื่องทดแทน)',
          },
          {
            accountCode: '21-1106',
            dr: zero,
            cr: input.buyback,
            description: 'ยอดจ่ายคืนเครื่องเก่า (clear)',
          },
        ],
      },
      tx,
    );
  }
}
