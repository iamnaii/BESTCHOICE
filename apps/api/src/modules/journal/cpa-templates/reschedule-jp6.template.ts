import { Injectable } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { JournalAutoService } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * Template JP6 — Reschedule (Case 6).
 *
 * Supports two variants:
 *
 * **6a (split-pay)** — customer pays fee advance first, then full installment later:
 *   Step 1: recordFeeAdvance — Dr depositAccountCode / Cr 21-1103
 *   Step 2: normal 2B payment of full installment amount (via PaymentReceipt2BTemplate)
 *
 * **6b (bundled)** — customer pays installment + fee in one transaction:
 *   Step 1: recordBundledPayment — Dr depositAccountCode / Cr 11-2103 + Cr 21-1103
 *
 * **Both converge at final installment:**
 *   consumeAdvanceOnFinalInstallment — Dr 21-1103 + Dr depositAccountCode / Cr 11-2103
 */
@Injectable()
export class RescheduleJP6Template {
  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Variant 6a Step 1: record reschedule fee advance receipt.
   *   Dr depositAccountCode   feeAmount
   *     Cr 21-1103             feeAmount
   */
  async recordFeeAdvance(input: {
    contractId: string;
    feeAmount: Decimal;
    depositAccountCode: string;
  }): Promise<{ entryNo: string }> {
    const result = await this.journal.createAndPost({
      description: 'รับค่าธรรมเนียมเลื่อนนัดล่วงหน้า',
      reference: `${input.contractId}:reschedule-fee:${Date.now()}`,
      metadata: {
        tag: '6a',
        flow: 'reschedule-fee',
        contractId: input.contractId,
      },
      lines: [
        {
          accountCode: input.depositAccountCode,
          dr: input.feeAmount,
          cr: new Decimal(0),
        },
        {
          accountCode: '21-1103',
          dr: new Decimal(0),
          cr: input.feeAmount,
          description: 'เงินรับล่วงหน้างวดสุดท้าย',
        },
      ],
    });
    return { entryNo: result.entryNumber };
  }

  /**
   * Variant 6b: record bundled payment (installment + fee advance in one transaction).
   *   Dr depositAccountCode   installmentAmount + feeAmount
   *     Cr 11-2103             installmentAmount
   *     Cr 21-1103             feeAmount
   */
  async recordBundledPayment(input: {
    contractId: string;
    installmentScheduleId: string;
    installmentAmount: Decimal;
    feeAmount: Decimal;
    depositAccountCode: string;
  }): Promise<{ entryNo: string }> {
    const total = input.installmentAmount.plus(input.feeAmount);
    const result = await this.journal.createAndPost({
      description: 'รับชำระงวดรวมค่าธรรมเนียมเลื่อนนัด',
      reference: `${input.installmentScheduleId}:bundled`,
      metadata: {
        tag: '6b',
        flow: 'reschedule-bundled',
        contractId: input.contractId,
        installmentScheduleId: input.installmentScheduleId,
      },
      lines: [
        {
          accountCode: input.depositAccountCode,
          dr: total,
          cr: new Decimal(0),
        },
        {
          accountCode: '11-2103',
          dr: new Decimal(0),
          cr: input.installmentAmount,
          description: 'ล้างลูกหนี้ค้างชำระงวด',
        },
        {
          accountCode: '21-1103',
          dr: new Decimal(0),
          cr: input.feeAmount,
          description: 'เงินรับล่วงหน้างวดสุดท้าย',
        },
      ],
    });
    return { entryNo: result.entryNumber };
  }

  /**
   * Final installment consumption (both 6a and 6b variants).
   * Clears the advance from 21-1103, receives remaining cash, clears HP receivable.
   *
   *   Dr 21-1103              advanceAmount
   *   Dr depositAccountCode   cashRemainder
   *     Cr 11-2103             advanceAmount + cashRemainder
   */
  async consumeAdvanceOnFinalInstallment(input: {
    contractId: string;
    installmentScheduleId: string;
    advanceAmount: Decimal;
    cashRemainder: Decimal;
    depositAccountCode: string;
  }): Promise<{ entryNo: string }> {
    const total = input.advanceAmount.plus(input.cashRemainder);
    const result = await this.journal.createAndPost({
      description: 'หักเงินรับล่วงหน้าเข้างวดสุดท้าย',
      reference: `${input.installmentScheduleId}:final-consumption`,
      metadata: {
        tag: '6a',
        flow: 'reschedule-final',
        contractId: input.contractId,
        installmentScheduleId: input.installmentScheduleId,
      },
      lines: [
        {
          accountCode: '21-1103',
          dr: input.advanceAmount,
          cr: new Decimal(0),
          description: 'ล้างเงินรับล่วงหน้างวดสุดท้าย',
        },
        {
          accountCode: input.depositAccountCode,
          dr: input.cashRemainder,
          cr: new Decimal(0),
        },
        {
          accountCode: '11-2103',
          dr: new Decimal(0),
          cr: total,
          description: 'ล้างลูกหนี้ค้างชำระงวดสุดท้าย',
        },
      ],
    });
    return { entryNo: result.entryNumber };
  }
}
