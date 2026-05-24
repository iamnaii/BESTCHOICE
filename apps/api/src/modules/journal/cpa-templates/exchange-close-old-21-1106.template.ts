import { Injectable } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { JournalAutoService } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';

export interface ExchangeCloseOldInput {
  oldContractId: string;
  buyback: Decimal;
  oldGrossOutstanding: Decimal;
  oldVatReceivableOutstanding: Decimal;
  oldUnearnedInterestOutstanding: Decimal;
  oldDeferredVatOutstanding: Decimal;
}

/**
 * Exchange A.2 — Close old contract, clearing all outstanding balances via the
 * 21-1106 internal clearing account, with a plug-balance for any gain/loss.
 *
 * THRESHOLD = oldGrossOutstanding (11-2101) + oldVatReceivableOutstanding (11-2105)
 * diff      = buyback - threshold  (signed)
 *
 *   Dr 21-1106   [buyback]                         — clearing account (payable to old contract)
 *   Dr 11-2106   [oldUnearnedInterestOutstanding]  — reverse contra-asset (unearned interest)
 *   Dr 21-2102   [oldDeferredVatOutstanding]       — reverse deferred VAT
 *   Dr 51-1102   [|diff|]  if diff < 0 (LOSS)
 *     Cr 11-2101 [oldGrossOutstanding]             — clear HP receivable
 *     Cr 11-2105 [oldVatReceivableOutstanding]     — clear VAT receivable
 *     Cr 21-2101 [oldVatReceivableOutstanding]     — recognize VAT to ภ.พ.30
 *     Cr 41-1101 [oldUnearnedInterestOutstanding]  — recognize remaining interest
 *     Cr 41-1102 [diff]    if diff > 0 (GAIN)
 */
@Injectable()
export class ExchangeCloseOld21_1106Template {
  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
  ) {}

  async execute(
    input: ExchangeCloseOldInput,
    tx?: Prisma.TransactionClient,
  ): Promise<{ id: string; entryNumber: string }> {
    const threshold = input.oldGrossOutstanding.plus(input.oldVatReceivableOutstanding);
    const diff = input.buyback.minus(threshold); // signed: negative = loss, positive = gain
    const zero = new Decimal(0);

    const lines: Array<{
      accountCode: string;
      dr: Decimal;
      cr: Decimal;
      description?: string;
    }> = [
      {
        accountCode: '21-1106',
        dr: input.buyback,
        cr: zero,
        description: 'ยอดจ่ายคืนเครื่องเก่า (clearing account)',
      },
      {
        accountCode: '11-2106',
        dr: input.oldUnearnedInterestOutstanding,
        cr: zero,
        description: 'ล้างดอกเบี้ยรอตัดบัญชีที่เหลือ',
      },
      {
        accountCode: '21-2102',
        dr: input.oldDeferredVatOutstanding,
        cr: zero,
        description: 'ล้างภาษีขายรอเรียกเก็บที่เหลือ',
      },
    ];

    if (diff.lessThan(0)) {
      lines.push({
        accountCode: '51-1102',
        dr: diff.abs(),
        cr: zero,
        description: 'ขาดทุนจากการเปลี่ยนเครื่อง (plug)',
      });
    } else if (diff.greaterThan(0)) {
      lines.push({
        accountCode: '41-1102',
        dr: zero,
        cr: diff,
        description: 'กำไรจากการเปลี่ยนเครื่อง (plug)',
      });
    }

    lines.push(
      {
        accountCode: '11-2101',
        dr: zero,
        cr: input.oldGrossOutstanding,
        description: 'ล้างลูกหนี้ผ่อนชำระ Gross เครื่องเก่า',
      },
      {
        accountCode: '11-2105',
        dr: zero,
        cr: input.oldVatReceivableOutstanding,
        description: 'ล้างลูกหนี้ภาษีขายรอเรียกเก็บ',
      },
      {
        accountCode: '21-2101',
        dr: zero,
        cr: input.oldVatReceivableOutstanding,
        description: 'รับรู้ภาษีขายเข้า ภ.พ.30',
      },
      {
        accountCode: '41-1101',
        dr: zero,
        cr: input.oldUnearnedInterestOutstanding,
        description: 'รับรู้ดอกเบี้ยที่เหลือทั้งหมด',
      },
    );

    return this.journal.createAndPost(
      {
        description: `Exchange A.2 — close old contract ${input.oldContractId}`,
        metadata: {
          flow: 'exchange-close-old-21-1106',
          oldContractId: input.oldContractId,
          buyback: input.buyback.toString(),
          threshold: threshold.toString(),
        },
        lines,
      },
      tx,
    );
  }
}
