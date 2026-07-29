import { Injectable } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { JournalAutoService } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * ค่าปรับยกเลิก swap วันที่ 8-30 (workbook Case 3B; บัญชีเปลี่ยนจาก 41-1199 → 42-1107 ตาม spec §2):
 *   Dr {cash} [penalty] / Cr 42-1107 [penalty] — ไม่มี VAT (นโยบายค่าปรับ)
 */
@Injectable()
export class ExchangeCancelPenaltyTemplate {
  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
  ) {}

  async execute(
    input: {
      requestId: string;
      oldContractId: string;
      depositAccountCode: string;
      penalty: Decimal;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<{ id: string; entryNumber: string }> {
    const zero = new Decimal(0);
    return this.journal.createAndPost(
      {
        description: `ค่าปรับยกเลิกเปลี่ยนเครื่อง (8-30 วัน) — คำขอ ${input.requestId.slice(0, 8)}`,
        metadata: {
          flow: 'exchange-cancel-penalty',
          idempotencyKey: input.requestId,
          contractId: input.oldContractId,
          requestId: input.requestId,
        },
        lines: [
          {
            accountCode: input.depositAccountCode,
            dr: input.penalty,
            cr: zero,
            description: 'รับเงินค่าปรับจากลูกค้า',
          },
          {
            accountCode: '42-1107',
            dr: zero,
            cr: input.penalty,
            description: 'รายได้ค่าปรับยกเลิกเปลี่ยนเครื่อง (ไม่มี VAT)',
          },
        ],
      },
      tx,
    );
  }
}
