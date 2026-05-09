import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { JournalAutoService } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';

const WHT_PND3_CODE = '21-3102';
const WHT_PND53_CODE = '21-3103';
const AP_ACCRUED_CODE = '21-1104';

function resolveWhtAccount(vendorTaxId?: string | null): string {
  if (!vendorTaxId) return WHT_PND53_CODE;
  return vendorTaxId.startsWith('0') ? WHT_PND53_CODE : WHT_PND3_CODE;
}

export interface ExpenseClearanceInput {
  expenseId: string;
  /** Cash/bank account paying the AP. */
  depositAccountCode?: string;
}

/**
 * Template — Clear an accrued expense (AP → cash).
 *
 * Pre-condition: The expense must already have a posted accrual JE
 * (flow='expense' with metadata.isPaid=false). This template handles the
 * cash-side settlement that derecognizes the AP and applies WHT split.
 *
 * JE (no WHT):
 *   Dr 21-1104 เจ้าหนี้ค่าใช้จ่ายกิจการ  [totalAmount]
 *     Cr <depositAccountCode>            [totalAmount]
 *
 * JE (with WHT):
 *   Dr 21-1104 เจ้าหนี้ค่าใช้จ่ายกิจการ  [totalAmount]
 *     Cr 21-3102/03 (WHT)               [withholdingTax]
 *     Cr <depositAccountCode>            [netPayment = totalAmount - withholdingTax]
 *
 * Idempotent: skips if a clearance JE already exists for this expense.
 */
@Injectable()
export class ExpenseClearanceTemplate {
  private readonly logger = new Logger(ExpenseClearanceTemplate.name);

  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
  ) {}

  async execute(
    input: ExpenseClearanceInput,
    outerTx?: Prisma.TransactionClient,
  ): Promise<{ entryNo: string }> {
    const { expenseId, depositAccountCode = '11-1101' } = input;

    const reader = (outerTx ?? this.prisma) as Prisma.TransactionClient;

    const expense = await reader.expense.findFirst({
      where: { id: expenseId, deletedAt: null },
    });
    if (!expense) {
      throw new NotFoundException(`Expense not found: ${expenseId}`);
    }

    const totalAmount = new Decimal(expense.totalAmount.toString());
    const withholdingTax = new Decimal((expense.withholdingTax ?? 0).toString());
    const zero = new Decimal(0);

    if (totalAmount.lte(0)) {
      throw new BadRequestException(
        `Cannot clear expense ${expense.expenseNumber}: totalAmount must be > 0`,
      );
    }

    const whtApplies = withholdingTax.gt(0);
    const whtAccountCode = whtApplies ? resolveWhtAccount(expense.vendorTaxId) : null;
    const netPayment = totalAmount.minus(withholdingTax);

    const lines: { accountCode: string; dr: Decimal; cr: Decimal; description?: string }[] = [
      {
        accountCode: AP_ACCRUED_CODE,
        dr: totalAmount,
        cr: zero,
        description: `ล้างเจ้าหนี้ ${expense.expenseNumber}`,
      },
    ];

    if (whtApplies && whtAccountCode) {
      lines.push({
        accountCode: whtAccountCode,
        dr: zero,
        cr: withholdingTax,
        description: `WHT ${whtAccountCode === WHT_PND3_CODE ? 'ภ.ง.ด.3' : 'ภ.ง.ด.53'}`,
      });
    }

    lines.push({
      accountCode: depositAccountCode,
      dr: zero,
      cr: netPayment,
      description: 'จ่ายเงินสุทธิ',
    });

    const totalDr = lines.reduce((s, l) => s.plus(l.dr), zero);
    const totalCr = lines.reduce((s, l) => s.plus(l.cr), zero);
    if (!totalDr.equals(totalCr)) {
      throw new BadRequestException(
        `Expense clearance JE unbalanced: Dr=${totalDr.toFixed(2)} Cr=${totalCr.toFixed(2)} for expense ${expense.expenseNumber}`,
      );
    }

    const run = async (tx: Prisma.TransactionClient): Promise<{ entryNo: string }> => {
      // Verify accrual JE exists (caller must have called expenseTemplate with isPaid=false first)
      const accrual = await tx.journalEntry.findFirst({
        where: {
          AND: [
            { metadata: { path: ['flow'], equals: 'expense' } as any },
            { metadata: { path: ['expenseId'], equals: expenseId } as any },
            { metadata: { path: ['isPaid'], equals: false } as any },
          ],
          deletedAt: null,
        },
      });
      if (!accrual) {
        throw new BadRequestException(
          `No accrual JE found for expense ${expense.expenseNumber} — call recordExpenseAccrual first`,
        );
      }

      // Idempotency: skip if clearance already posted
      const existing = await tx.journalEntry.findFirst({
        where: {
          AND: [
            { metadata: { path: ['flow'], equals: 'expense-clearance' } as any },
            { metadata: { path: ['expenseId'], equals: expenseId } as any },
          ],
          deletedAt: null,
        },
      });
      if (existing) {
        this.logger.log(
          `[A.5a] ExpenseClearanceTemplate idempotency — JE ${existing.entryNumber} already exists for expense ${expenseId}, skipping`,
        );
        return { entryNo: existing.entryNumber };
      }

      const result = await this.journal.createAndPost(
        {
          description: `ล้างเจ้าหนี้ค่าใช้จ่าย ${expense.expenseNumber}`,
          reference: `${expenseId}:expense-clearance`,
          metadata: {
            tag: 'EXPENSE_CLEARANCE',
            flow: 'expense-clearance',
            expenseId,
            expenseNumber: expense.expenseNumber,
            accrualEntryNumber: accrual.entryNumber,
            withholdingTax: withholdingTax.toFixed(2),
            whtAccountCode,
          },
          lines,
        },
        tx,
      );

      this.logger.log(
        `[A.5a] ExpenseClearanceTemplate: posted JE ${result.entryNumber} clearing accrual ${accrual.entryNumber} for expense ${expenseId}`,
      );

      return { entryNo: result.entryNumber };
    };

    return outerTx ? run(outerTx) : this.prisma.$transaction(run);
  }
}
