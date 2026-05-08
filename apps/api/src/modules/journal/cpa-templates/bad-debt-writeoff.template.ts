import { Injectable, Logger } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { JournalAutoService } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';

export interface BadDebtWriteOffInput {
  contractId: string;
  writeOffReason?: string;
}

/**
 * Template — Bad Debt Write-Off.
 *
 * Reads outstanding amounts from the contract's JE ledger (sum of HP Receivable lines).
 * Consumes the existing provision balance (11-2102 Contra), remainder hits P&L (51-1102).
 *
 * JE:
 *   Dr 11-2102 ค่าเผื่อหนี้สงสัยจะสูญ (Contra)   [provisionConsumed]   ← up to provision balance
 *   Dr 51-1102 หนี้สูญ / ขาดทุนจากยึดเครื่อง      [remainder]           ← rest hits P&L
 *     Cr 11-2101 ลูกหนี้ผ่อนชำระ (Gross)           [grossOutstanding]
 */
@Injectable()
export class BadDebtWriteOffTemplate {
  private readonly logger = new Logger(BadDebtWriteOffTemplate.name);

  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
  ) {}

  async execute(
    input: BadDebtWriteOffInput,
    tx?: Prisma.TransactionClient,
  ): Promise<{ entryNo: string }> {
    const { contractId, writeOffReason } = input;
    const client = tx ?? this.prisma;

    // Idempotency check
    const existingWo = await client.journalEntry.findFirst({
      where: {
        AND: [
          { metadata: { path: ['flow'], equals: 'write-off' } } as any,
          { metadata: { path: ['contractId'], equals: contractId } } as any,
        ],
        deletedAt: null,
      },
    });
    if (existingWo) {
      this.logger.log(
        `[A.5a] BadDebtWriteOff idempotency — JE ${existingWo.entryNumber} already exists for contract ${contractId}, skipping`,
      );
      return { entryNo: existingWo.entryNumber };
    }

    const contract = await client.contract.findUniqueOrThrow({
      where: { id: contractId },
      select: { id: true, contractNumber: true },
    });

    // Compute gross outstanding from JournalLine balances for this contract
    // Sum Dr lines on 11-2101 (HP Receivable) minus Cr lines (payments, reversals)
    const lines1A = await client.journalLine.findMany({
      where: {
        accountCode: '11-2101',
        journalEntry: {
          metadata: { path: ['contractId'], equals: contractId },
          deletedAt: null,
        },
      },
      select: { debit: true, credit: true },
    });

    let grossOutstanding = new Decimal(0);
    for (const l of lines1A) {
      grossOutstanding = grossOutstanding.plus(l.debit).minus(l.credit);
    }

    if (grossOutstanding.lte(0)) {
      throw new Error(
        `[A.5a] BadDebtWriteOff — no outstanding HP Receivable balance for contract ${contract.contractNumber}`,
      );
    }

    // Compute existing provision (11-2102 Cr balance for this contract)
    const provisionLines = await client.journalLine.findMany({
      where: {
        accountCode: '11-2102',
        journalEntry: {
          metadata: { path: ['contractId'], equals: contractId },
          deletedAt: null,
        },
      },
      select: { debit: true, credit: true },
    });

    let provisionBalance = new Decimal(0);
    for (const l of provisionLines) {
      provisionBalance = provisionBalance.plus(l.credit).minus(l.debit);
    }

    const provisionConsumed = Decimal.min(provisionBalance.gt(0) ? provisionBalance : new Decimal(0), grossOutstanding);
    const writeOffExpense = grossOutstanding.minus(provisionConsumed);

    const zero = new Decimal(0);
    const drLines: { accountCode: string; dr: Decimal; cr: Decimal; description?: string }[] = [];

    if (provisionConsumed.gt(0)) {
      drLines.push({
        accountCode: '11-2102',
        dr: provisionConsumed,
        cr: zero,
        description: 'ล้างค่าเผื่อหนี้สงสัยจะสูญ',
      });
    }

    if (writeOffExpense.gt(0)) {
      drLines.push({
        accountCode: '51-1102',
        dr: writeOffExpense,
        cr: zero,
        description: `หนี้สูญ — ${writeOffReason ?? 'ตัดหนี้สูญ'}`,
      });
    }

    drLines.push({
      accountCode: '11-2101',
      dr: zero,
      cr: grossOutstanding,
      description: 'ล้างลูกหนี้ผ่อนชำระ (Gross)',
    });

    const result = await this.journal.createAndPost(
      {
        description: `ตัดหนี้สูญ — สัญญา ${contract.contractNumber}`,
        reference: `${contractId}:bad-debt-write-off`,
        metadata: {
          tag: 'BAD-DEBT',
          flow: 'write-off',
          contractId,
          grossOutstanding: grossOutstanding.toFixed(2),
          provisionConsumed: provisionConsumed.toFixed(2),
          writeOffExpense: writeOffExpense.toFixed(2),
          writeOffReason: writeOffReason ?? null,
        },
        lines: drLines,
      },
      tx,
    );

    return { entryNo: result.entryNumber };
  }
}
