import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { JournalAutoService, JeLineInput } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * P3-SP5 — SHOP Operating Expense (rent / utilities / salary / supplies).
 *
 * Trigger: a per-branch operating expense is recorded under SHOP scope —
 * e.g. branch rent, branch electricity, branch staff salary.
 *
 * Two modes:
 *   - mode='CASH'     → paid out of SHOP cash/bank immediately
 *                       Dr expense / Cr cash/bank
 *   - mode='ACCRUAL'  → accrued as payable (e.g. invoice received, pay later)
 *                       Dr expense / Cr S21-1103 (เจ้าหนี้ค่าใช้จ่ายสาขา)
 *
 * SHOP-only — no FINANCE pairing. (FINANCE has its own salary/utilities flows
 * via the existing ExpenseDocument module.)
 */
export type ShopExpenseMode = 'CASH' | 'ACCRUAL';

export interface ShopExpenseInput {
  idempotencyKey: string;
  /** Source document — typically a branch expense voucher id. */
  expenseId: string;
  expenseNumber?: string;
  /** S51-XXXX / S52-XXXX / S53-XXXX. */
  expenseAccountCode: string;
  amount: Decimal;
  mode: ShopExpenseMode;
  /** Required when mode=CASH — the bank/cash account paying out. */
  cashAccountCode?: string;
  /** Optional override of payable account. Defaults to S21-1103. */
  payableAccountCode?: string;
  branchName?: string;
  postedAt?: Date;
}

@Injectable()
export class ShopExpenseTemplate {
  private readonly logger = new Logger(ShopExpenseTemplate.name);
  private shopCompanyId: string | null = null;

  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
  ) {}

  private async getShopCompanyId(tx: Prisma.TransactionClient): Promise<string> {
    if (this.shopCompanyId) return this.shopCompanyId;
    const co = await tx.companyInfo.findFirst({
      where: { companyCode: 'SHOP', deletedAt: null },
      select: { id: true },
    });
    if (!co) throw new BadRequestException('SHOP CompanyInfo not found — seed required');
    this.shopCompanyId = co.id;
    return co.id;
  }

  async execute(
    input: ShopExpenseInput,
    outerTx?: Prisma.TransactionClient,
  ): Promise<{ entryNo: string; journalEntryId: string }> {
    const zero = new Decimal(0);
    const amount = new Decimal(input.amount.toString());
    if (!amount.gt(zero)) {
      throw new BadRequestException('ShopExpense: amount must be > 0');
    }
    if (!input.expenseAccountCode.startsWith('S')) {
      throw new BadRequestException(
        `ShopExpense: expenseAccountCode must be SHOP-side (S-prefix); got ${input.expenseAccountCode}`,
      );
    }

    let creditAccountCode: string;
    if (input.mode === 'CASH') {
      if (!input.cashAccountCode || !input.cashAccountCode.startsWith('S')) {
        throw new BadRequestException(
          `ShopExpense (CASH): cashAccountCode required and must be SHOP-side`,
        );
      }
      creditAccountCode = input.cashAccountCode;
    } else {
      creditAccountCode = input.payableAccountCode ?? 'S21-1103';
      if (!creditAccountCode.startsWith('S')) {
        throw new BadRequestException(
          `ShopExpense (ACCRUAL): payableAccountCode must be SHOP-side; got ${creditAccountCode}`,
        );
      }
    }

    const branchTag = input.branchName ? ` - ${input.branchName}` : '';
    const lines: JeLineInput[] = [
      {
        accountCode: input.expenseAccountCode,
        dr: amount,
        cr: zero,
        description: `ค่าใช้จ่ายสาขา${branchTag}`,
      },
      {
        accountCode: creditAccountCode,
        dr: zero,
        cr: amount,
        description: input.mode === 'CASH' ? `จ่ายเงินสด/โอน${branchTag}` : `ตั้งหนี้ค้างจ่าย${branchTag}`,
      },
    ];

    const run = async (
      tx: Prisma.TransactionClient,
    ): Promise<{ entryNo: string; journalEntryId: string }> => {
      const existing = await tx.journalEntry.findFirst({
        where: {
          AND: [
            { metadata: { path: ['flow'], equals: 'shop-expense' } as any },
            { metadata: { path: ['idempotencyKey'], equals: input.idempotencyKey } as any },
          ],
          deletedAt: null,
        },
      });
      if (existing) {
        this.logger.log(
          `ShopExpenseTemplate idempotency — JE ${existing.entryNumber} for ${input.idempotencyKey}`,
        );
        return { entryNo: existing.entryNumber, journalEntryId: existing.id };
      }

      const shopCompanyId = await this.getShopCompanyId(tx);
      const result = await this.journal.createAndPost(
        {
          description: `ค่าใช้จ่ายสาขา ${input.expenseNumber ?? input.expenseId}${branchTag} (SHOP, ${input.mode})`,
          reference: `expense:${input.expenseId}`,
          metadata: {
            tag: 'SHOP_EXPENSE',
            flow: 'shop-expense',
            idempotencyKey: input.idempotencyKey,
            expenseId: input.expenseId,
            expenseNumber: input.expenseNumber ?? null,
            companyCode: 'SHOP',
            mode: input.mode,
            amount: amount.toFixed(2),
            expenseAccountCode: input.expenseAccountCode,
            creditAccountCode,
            branchName: input.branchName ?? null,
          },
          postedAt: input.postedAt ?? new Date(),
          companyId: shopCompanyId,
          lines,
        },
        tx,
      );
      return { entryNo: result.entryNumber, journalEntryId: result.id };
    };

    return outerTx ? run(outerTx) : this.prisma.$transaction(run);
  }
}
