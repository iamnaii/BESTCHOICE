import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { JournalAutoService } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';

export interface ExpenseReverseInput {
  expenseId: string;
  reversedById: string;
  reason: string;
  /** Flow name of the JE to reverse. Defaults to 'expense'. Use 'expense-clearance' to reverse the clearance leg of a 2-step accrual. */
  flowOverride?: string;
}

/**
 * Template — Reverse a posted expense JE (when Expense status = VOIDED).
 *
 * Pattern (TFRS no-touch — same as asset-disposal-reverse / depreciation-reverse):
 *   - Original POSTED expense JE is NEVER modified beyond a metadata flag.
 *   - A new mirror JE is created with Dr/Cr swapped, descriptions prefixed [VOID].
 *   - Original metadata gets {reversed: true, reversedByEntryNumber, reversedAt}.
 *
 * Guards:
 *   1. reason.trim() must be non-empty.
 *   2. Original expense JE must exist (metadata.flow='expense' + expenseId).
 *   3. Original must NOT already be reversed (metadata.reversed !== true).
 *
 * Idempotency: TOCTOU-safe — runs inside outer $transaction (mandatory).
 *
 * Atomicity: caller MUST provide outerTx so reverse + Expense.status update
 * commit together. Standalone calls supported but not the primary path.
 */
@Injectable()
export class ExpenseReverseTemplate {
  private readonly logger = new Logger(ExpenseReverseTemplate.name);

  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
  ) {}

  async execute(
    input: ExpenseReverseInput,
    outerTx?: Prisma.TransactionClient,
  ): Promise<{ entryNo: string }> {
    const { expenseId, reason, reversedById } = input;
    const flow = input.flowOverride ?? 'expense';

    if (!reason || reason.trim().length === 0) {
      throw new BadRequestException('กรุณาระบุเหตุผลการกลับรายการ');
    }
    if (!reversedById) {
      throw new BadRequestException('reversedById is required for audit logging (T2-C14)');
    }

    const run = async (tx: Prisma.TransactionClient): Promise<{ entryNo: string }> => {
      const original = await tx.journalEntry.findFirst({
        where: {
          AND: [
            { metadata: { path: ['flow'], equals: flow } as any },
            { metadata: { path: ['expenseId'], equals: expenseId } as any },
          ],
          deletedAt: null,
        },
        include: { lines: true },
      });
      if (!original) {
        throw new NotFoundException(`ไม่พบ JE ค่าใช้จ่ายเดิม (flow=${flow}) สำหรับ expense ${expenseId}`);
      }

      const originalMeta = (original.metadata ?? {}) as Record<string, unknown>;
      if (originalMeta.reversed === true) {
        throw new BadRequestException(
          `Expense ${expenseId} ถูก reverse แล้ว — JE เดิม ${original.entryNumber} flagged reversed=true`,
        );
      }

      type Line = { accountCode: string; dr: Decimal; cr: Decimal; description?: string };
      const reversedLines: Line[] = original.lines.map((l) => ({
        accountCode: l.accountCode,
        dr: new Decimal(l.credit.toString()),
        cr: new Decimal(l.debit.toString()),
        description: `[VOID] ${l.description ?? ''}`.trim(),
      }));

      const zero = new Decimal(0);
      const totalDr = reversedLines.reduce((s, l) => s.plus(l.dr), zero);
      const totalCr = reversedLines.reduce((s, l) => s.plus(l.cr), zero);
      if (!totalDr.equals(totalCr)) {
        throw new BadRequestException(
          `Expense reverse JE unbalanced: Dr=${totalDr.toFixed(2)} Cr=${totalCr.toFixed(2)} for expense ${expenseId}`,
        );
      }

      const reverseFlow = `${flow}-reverse`;
      const result = await this.journal.createAndPost(
        {
          description: `[VOID] กลับรายการค่าใช้จ่าย ${originalMeta.expenseNumber ?? expenseId} (${flow}) — ${reason}`,
          reference: `${expenseId}:${reverseFlow}`,
          metadata: {
            tag: 'EXPENSE_REVERSE',
            flow: reverseFlow,
            expenseId,
            originalFlow: flow,
            originalEntryNumber: original.entryNumber,
            reason,
          },
          lines: reversedLines,
        },
        tx,
      );

      // Mark original as reversed (metadata flag — don't mutate lines).
      // TFRS no-touch: ledger lines on POSTED entries are immutable;
      // only metadata.reversed flag is mutable to mark voided status.
      await tx.journalEntry.update({
        where: { id: original.id },
        data: {
          metadata: {
            ...(originalMeta as object),
            reversed: true,
            reversedByEntryNumber: result.entryNumber,
            reversedAt: new Date().toISOString(),
          },
        },
      });

      // T2-C14: immutable audit log inside the same tx so failure rolls back the JE post.
      await tx.journalPostAuditLog.create({
        data: {
          journalEntryId: result.id,
          postedById: reversedById,
          postedAt: new Date(),
        },
      });

      this.logger.log(
        `[A.5a] ExpenseReverseTemplate: posted JE ${result.entryNumber} reversing ${original.entryNumber} for expense ${expenseId}`,
      );

      return { entryNo: result.entryNumber };
    };

    return outerTx ? run(outerTx) : this.prisma.$transaction(run);
  }
}
