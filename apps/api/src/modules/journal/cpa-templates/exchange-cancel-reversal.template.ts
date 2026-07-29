import { Injectable, Logger } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { JournalAutoService } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * Device Swap 2026-07 — ยกเลิก swap (workbook Cases 3A/3B, spec §9).
 * Mirror-reverse ทุกบรรทัด (Corrective Control C1 — ห้ามแก้ JE เดิม):
 *   1. JE ตาม ids ที่ request บันทึกไว้ (A.1/A.2/A.3/A.4/A.5) — แม่นกว่า metadata sweep
 *   2. sweep JE อื่นที่ tag metadata.contractId = newContractId (เช่น 2A accrual
 *      ที่วิ่งบนสัญญาใหม่ระหว่าง window) — ยกเว้น payment flows (ถูก guard บล็อกก่อนแล้ว)
 * Mirror ต้อง copy companyId (A.4 = SHOP!) + metadata.contractId เดิม เพื่อให้
 * glContractBalance net เป็น 0 ทุกบัญชีทุกสัญญา
 */
@Injectable()
export class ExchangeCancelReversalTemplate {
  private readonly logger = new Logger(ExchangeCancelReversalTemplate.name);

  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
  ) {}

  async reverse(
    input: { jeIds: string[]; newContractId: string },
    tx?: Prisma.TransactionClient,
  ): Promise<{ reversalJeIds: string[] }> {
    const client = tx ?? this.prisma;
    const byId = await client.journalEntry.findMany({
      where: { id: { in: input.jeIds }, status: 'POSTED', deletedAt: null },
      include: { lines: true },
    });
    const swept = await client.journalEntry.findMany({
      where: {
        metadata: { path: ['contractId'], equals: input.newContractId } as any,
        status: 'POSTED',
        deletedAt: null,
      },
      include: { lines: true },
    });
    const all = new Map<string, (typeof byId)[number]>();
    for (const je of [...byId, ...swept]) all.set(je.id, je);

    const reversalJeIds: string[] = [];
    for (const je of all.values()) {
      const meta = (je.metadata ?? {}) as Record<string, unknown>;
      if (meta['reversed'] === true) continue;
      if (meta['flow'] === 'exchange-cancel') continue; // reversal ของตัวเองที่ sweep เจอ
      if (je.lines.length === 0) continue;

      const reversedLines = je.lines.map((l) => ({
        accountCode: l.accountCode,
        dr: new Decimal(l.credit.toString()),
        cr: new Decimal(l.debit.toString()),
        description: `[ยกเลิกเปลี่ยนเครื่อง] ${l.description ?? ''}`.trim(),
      }));

      const result = await this.journal.createAndPost(
        {
          description: `[ยกเลิกเปลี่ยนเครื่อง] กลับรายการ ${je.entryNumber}`,
          reference: `${je.id}:exchange-cancel`,
          companyId: je.companyId, // สำคัญ: A.4 เป็น SHOP company
          metadata: {
            tag: 'REVERSAL',
            flow: 'exchange-cancel',
            idempotencyKey: `cancel:${je.id}`,
            originalEntryId: je.id,
            reversesEntryId: je.id,
            contractId: (meta['contractId'] as string | undefined) ?? undefined,
          },
          lines: reversedLines,
        },
        tx,
      );

      await client.journalEntry.update({
        where: { id: je.id },
        data: {
          metadata: {
            ...(meta as Prisma.InputJsonObject),
            reversed: true,
            reversedByEntryNumber: result.entryNumber,
          },
        },
      });
      reversalJeIds.push(result.id);
    }
    this.logger.log(`Exchange cancel — reversed ${reversalJeIds.length} JE(s)`);
    return { reversalJeIds };
  }
}
