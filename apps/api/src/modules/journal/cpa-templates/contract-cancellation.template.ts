import { Injectable, BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { JournalAutoService } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * Template — Contract Cancellation (P4-SP4).
 *
 * Reverses the 1A activation JE and, when refundAmount > 0, posts the refund:
 *
 * Reversal (mirror of 1A, Dr/Cr swapped):
 *   Dr 21-1101 เจ้าหนี้-หน้าร้าน    (financedAmount)
 *   Dr 21-1102 เจ้าหนี้ค่าคอม       (commission)
 *   Dr 11-2106 รายได้รอตัดบัญชี-ดอกเบี้ย (interest)
 *   Dr 21-2102 ภาษีขายรอเรียกเก็บ   (vat)
 *     Cr 11-2101 ลูกหนี้ Gross
 *     Cr 11-2105 ลูกหนี้ภาษีขายรอเรียกเก็บ
 *
 * Refund (when refundAmount > 0):
 *   Dr 52-1106 ส่วนลดดอกเบี้ย-ปิดยอด (refundAmount)
 *     Cr 11-1201 ธนาคาร KBank         (refundAmount)
 *
 * Idempotency: checks metadata.flow = 'contract-cancellation' + cancellationId
 * to prevent double-posting on retry.
 */
@Injectable()
export class ContractCancellationTemplate {
  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
  ) {}

  async execute(
    params: {
      contractId: string;
      cancellationId: string;
      refundAmount: Decimal;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<{ entryNumber: string; refundEntryNumber?: string }> {
    const { contractId, cancellationId, refundAmount } = params;
    const client = tx ?? this.prisma;

    const contract = await client.contract.findUniqueOrThrow({
      where: { id: contractId },
      select: { contractNumber: true },
    });

    // Find the 1A activation JE tagged to this contract
    const activationJe = await (client.journalEntry as Prisma.JournalEntryDelegate).findFirst({
      where: {
        AND: [
          { metadata: { path: ['tag'], equals: '1A' } } as Prisma.JournalEntryWhereInput,
          { metadata: { path: ['contractId'], equals: contractId } } as Prisma.JournalEntryWhereInput,
        ],
        status: 'POSTED',
        deletedAt: null,
      },
      include: { lines: true },
    });

    if (!activationJe) {
      throw new BadRequestException(
        `ไม่พบรายการบัญชีเปิดสัญญา (1A) สำหรับสัญญา ${contract.contractNumber} — ไม่สามารถยกเลิกได้`,
      );
    }

    // Idempotency check: ensure we haven't already posted the cancellation reversal
    const existingReversal = await (client.journalEntry as Prisma.JournalEntryDelegate).findFirst({
      where: {
        AND: [
          { metadata: { path: ['flow'], equals: 'contract-cancellation' } } as Prisma.JournalEntryWhereInput,
          { metadata: { path: ['cancellationId'], equals: cancellationId } } as Prisma.JournalEntryWhereInput,
        ],
        deletedAt: null,
      },
    });

    if (existingReversal) {
      return { entryNumber: existingReversal.entryNumber };
    }

    // Build reversal lines (swap Dr/Cr from 1A)
    const reversalLines = activationJe.lines.map((l) => ({
      accountCode: l.accountCode,
      dr: new Decimal(l.credit.toString()),
      cr: new Decimal(l.debit.toString()),
      description: `[ยกเลิกสัญญา] ${l.description ?? ''}`.trim(),
    }));

    const reversalResult = await this.journal.createAndPost(
      {
        description: `ยกเลิกสัญญา ${contract.contractNumber} — ย้อนรายการ ${activationJe.entryNumber}`,
        reference: contractId,
        metadata: {
          tag: 'CANCELLATION',
          flow: 'contract-cancellation',
          contractId,
          cancellationId,
          originalEntryId: activationJe.id,
          originalEntryNumber: activationJe.entryNumber,
        },
        lines: reversalLines,
      },
      tx,
    );

    // Mark original 1A as reversed
    const meta = (activationJe.metadata ?? {}) as Prisma.InputJsonObject;
    await client.journalEntry.update({
      where: { id: activationJe.id },
      data: {
        metadata: {
          ...meta,
          reversed: true,
          reversedByEntryNumber: reversalResult.entryNumber,
          reversedByCancellationId: cancellationId,
        },
      },
    });

    // Refund JE (when refundAmount > 0)
    let refundEntryNumber: string | undefined;
    const zero = new Decimal(0);
    if (refundAmount.greaterThan(zero)) {
      const refundResult = await this.journal.createAndPost(
        {
          description: `คืนเงิน ${contract.contractNumber} — ยกเลิกสัญญา`,
          reference: contractId,
          metadata: {
            tag: 'CANCELLATION_REFUND',
            flow: 'contract-cancellation-refund',
            contractId,
            cancellationId,
          },
          lines: [
            {
              accountCode: '52-1106',
              dr: refundAmount,
              cr: zero,
              description: 'ส่วนลดดอกเบี้ย-คืนเงินยกเลิกสัญญา',
            },
            {
              accountCode: '11-1201',
              dr: zero,
              cr: refundAmount,
              description: 'ธนาคาร KBank — จ่ายคืนลูกค้า',
            },
          ],
        },
        tx,
      );
      refundEntryNumber = refundResult.entryNumber;
    }

    return { entryNumber: reversalResult.entryNumber, refundEntryNumber };
  }
}
