import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { JournalAutoService } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';

// Mirrors CATEGORY_CODE_MAP in accounting.service.ts — kept in sync manually.
// See accounting.service.ts §C3 FIX for audit notes.
const CATEGORY_CODE_MAP: Record<string, string> = {
  SELL_COMMISSION: '52-1101',
  SELL_ADVERTISING: '52-1102',
  SELL_TRANSPORT: '53-1304',
  SELL_PACKAGING: '52-1102',
  ADMIN_SALARY: '53-1101',
  ADMIN_SOCIAL_SECURITY: '53-1102',
  ADMIN_RENT: '53-1301',
  ADMIN_UTILITIES: '53-1302',
  ADMIN_OFFICE_SUPPLIES: '53-1201',
  ADMIN_INSURANCE: '53-1103',
  ADMIN_TAX_FEE: '54-1103',
  ADMIN_MAINTENANCE: '53-1305',
  ADMIN_TRAVEL: '53-1304',
  ADMIN_TELEPHONE: '53-1303',
  OTHER_INTEREST: '53-1501',
  OTHER_LOSS: '53-1503',
  OTHER_FINE: '54-1104',
  OTHER_MISC: '53-1502',
  // NOTE: COGS_PRODUCT + COGS_REPAIR_PARTS are not mapped here — FINANCE has no COGS accounts.
  // ADMIN_DEPRECIATION is not mapped — no dedicated account in current chart (TODO A.5b).
};

const VAT_INPUT_CODE = '11-4101'; // ภาษีซื้อ
const AP_ACCRUED_CODE = '21-1104'; // เจ้าหนี้ค่าใช้จ่ายกิจการ (unpaid)

export interface ExpenseTemplateInput {
  expenseId: string;
  /** Cash/bank account code when paid immediately (e.g. '11-1101', '11-1201') */
  depositAccountCode?: string;
  /** If false, credits AP instead of cash */
  isPaid?: boolean;
}

/**
 * Template — Expense booking (generic).
 *
 * JE (paid):
 *   Dr <expenseAccountCode>    [amount excl VAT]
 *   Dr 11-4101 ภาษีซื้อ        [vatAmount]   ← if vatAmount > 0
 *     Cr <depositAccountCode>  [totalAmount]
 *
 * JE (unpaid / accrued):
 *   Dr <expenseAccountCode>    [amount excl VAT]
 *   Dr 11-4101 ภาษีซื้อ        [vatAmount]   ← if vatAmount > 0
 *     Cr 21-1104 เจ้าหนี้ค่าใช้จ่ายกิจการ  [totalAmount]
 *
 * Idempotent: skips if JE with flow='expense' + expenseId already exists.
 */
@Injectable()
export class ExpenseTemplate {
  private readonly logger = new Logger(ExpenseTemplate.name);

  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
  ) {}

  async execute(input: ExpenseTemplateInput): Promise<{ entryNo: string } | null> {
    const { expenseId, depositAccountCode = '11-1101', isPaid = true } = input;

    // Idempotency
    const existing = await this.prisma.journalEntry.findFirst({
      where: {
        AND: [
          { metadata: { path: ['flow'], equals: 'expense' } } as any,
          { metadata: { path: ['expenseId'], equals: expenseId } } as any,
        ],
        deletedAt: null,
      },
    });
    if (existing) {
      this.logger.log(
        `[A.5a] ExpenseTemplate idempotency — JE ${existing.entryNumber} already exists for expense ${expenseId}, skipping`,
      );
      return { entryNo: existing.entryNumber };
    }

    const expense = await this.prisma.expense.findFirst({
      where: { id: expenseId, deletedAt: null },
    });
    if (!expense) {
      throw new BadRequestException(`Expense not found: ${expenseId}`);
    }

    // Resolve expense account code
    const expenseAccountCode =
      expense.accountCode ?? CATEGORY_CODE_MAP[expense.category];
    if (!expenseAccountCode) {
      throw new BadRequestException(
        `No account code mapping for expense category '${expense.category}' — expense ${expense.expenseNumber}. Add to CATEGORY_CODE_MAP or set accountCode on the Expense record.`,
      );
    }

    const amount = new Decimal(expense.amount.toString());
    const vatAmount = new Decimal(expense.vatAmount.toString());
    const totalAmount = new Decimal(expense.totalAmount.toString());
    const zero = new Decimal(0);

    // Credit side: cash account or AP accrued
    const creditAccountCode = isPaid ? depositAccountCode : AP_ACCRUED_CODE;

    const lines: { accountCode: string; dr: Decimal; cr: Decimal; description?: string }[] = [
      {
        accountCode: expenseAccountCode,
        dr: amount,
        cr: zero,
        description: expense.description,
      },
    ];

    if (vatAmount.gt(0)) {
      lines.push({
        accountCode: VAT_INPUT_CODE,
        dr: vatAmount,
        cr: zero,
        description: 'ภาษีซื้อ',
      });
    }

    lines.push({
      accountCode: creditAccountCode,
      dr: zero,
      cr: totalAmount,
      description: isPaid ? 'จ่ายเงิน' : 'ค้างจ่าย',
    });

    const result = await this.journal.createAndPost({
      description: `บันทึกค่าใช้จ่าย ${expense.expenseNumber} — ${expense.description}`,
      reference: `${expenseId}:expense`,
      metadata: {
        tag: 'EXPENSE',
        flow: 'expense',
        expenseId,
        expenseNumber: expense.expenseNumber,
        category: expense.category,
        isPaid,
      },
      lines,
    });

    return { entryNo: result.entryNumber };
  }
}
