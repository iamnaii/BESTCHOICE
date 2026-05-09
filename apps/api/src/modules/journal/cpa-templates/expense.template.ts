import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
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
};

const VAT_INPUT_CODE = '11-4101';
const AP_ACCRUED_CODE = '21-1104';
const WHT_PND3_CODE = '21-3102';   // PND3 — บุคคลธรรมดา
const WHT_PND53_CODE = '21-3103';  // PND53 — นิติบุคคล

const DISALLOWED_REASON_CODE: Record<string, string> = {
  NO_RECEIPT: '54-1101',
  PERSONAL_USE: '54-1104',
  PENALTY: '54-1103',
  OTHER: '54-1104',
};

/**
 * Resolves WHT credit account code based on vendor type.
 * Heuristic: Thai juristic-person tax IDs always start with '0'.
 * Falls back to PND53 (B2B default) when no vendorTaxId.
 */
function resolveWhtAccount(vendorTaxId?: string | null): string {
  if (!vendorTaxId) return WHT_PND53_CODE;
  return vendorTaxId.startsWith('0') ? WHT_PND53_CODE : WHT_PND3_CODE;
}

export interface ExpenseTemplateInput {
  expenseId: string;
  /** Cash/bank account code when paid immediately (e.g. '11-1101', '11-1201') */
  depositAccountCode?: string;
  /** If false, credits AP instead of cash. AP-credit ignores WHT (settled at AP-clearance time). */
  isPaid?: boolean;
}

/**
 * Template — Expense booking (generic).
 *
 * Paid (no WHT):
 *   Dr <expenseAccountCode>    [amount excl VAT]
 *   Dr 11-4101 ภาษีซื้อ        [vatAmount]   ← if vatAmount > 0
 *     Cr <depositAccountCode>  [totalAmount = amount + vatAmount]
 *
 * Paid (with WHT):
 *   Dr <expenseAccountCode>    [amount excl VAT]
 *   Dr 11-4101 ภาษีซื้อ        [vatAmount]
 *     Cr 21-3102 หรือ 21-3103  [withholdingTax]   ← derived from vendorTaxId
 *     Cr <depositAccountCode>  [netPayment = totalAmount - withholdingTax]
 *
 * Unpaid (Accrued AP):
 *   Dr <expenseAccountCode>    [amount excl VAT]
 *   Dr 11-4101 ภาษีซื้อ        [vatAmount]
 *     Cr 21-1104 เจ้าหนี้ค่าใช้จ่ายกิจการ  [totalAmount]
 *   (WHT booked at AP-clearance time, not now)
 *
 * Tax-disallowed (54-XXXX):
 *   Dr 54-XXXX                 [totalAmount — VAT input not claimable]
 *     Cr <depositAccountCode>  [totalAmount or netPayment]
 *
 * Idempotent: skips if JE with flow='expense' + expenseId already exists.
 *
 * Atomicity: when called inside an outer transaction (via outerTx), runs there directly.
 * When called standalone, wraps idempotency-check + JE-post in its own transaction.
 */
@Injectable()
export class ExpenseTemplate {
  private readonly logger = new Logger(ExpenseTemplate.name);

  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
  ) {}

  async execute(
    input: ExpenseTemplateInput,
    outerTx?: Prisma.TransactionClient,
  ): Promise<{ entryNo: string } | null> {
    const { expenseId, depositAccountCode = '11-1101', isPaid = true } = input;

    const reader = (outerTx ?? this.prisma) as Prisma.TransactionClient;

    const expense = await reader.expense.findFirst({
      where: { id: expenseId, deletedAt: null },
    });
    if (!expense) {
      throw new NotFoundException(`Expense not found: ${expenseId}`);
    }

    // Resolve expense account code
    let resolvedAccountCode = expense.accountCode ?? CATEGORY_CODE_MAP[expense.category];

    const isTaxDisallowed = (expense as any).taxDisallowed === true;
    const disallowedReason = (expense as any).disallowedReason as string | null | undefined;

    if (isTaxDisallowed) {
      const reasonCode = disallowedReason
        ? DISALLOWED_REASON_CODE[disallowedReason]
        : undefined;
      if (reasonCode) {
        resolvedAccountCode = reasonCode;
      } else if (!resolvedAccountCode?.startsWith('54-')) {
        resolvedAccountCode = '54-1104';
      }
    }

    if (!resolvedAccountCode) {
      throw new BadRequestException(
        `No account code mapping for expense category '${expense.category}' — expense ${expense.expenseNumber}. Add to CATEGORY_CODE_MAP or set accountCode on the Expense record.`,
      );
    }

    const amount = new Decimal(expense.amount.toString());
    const vatAmount = new Decimal(expense.vatAmount.toString());
    const totalAmount = new Decimal(expense.totalAmount.toString());
    const withholdingTax = new Decimal((expense.withholdingTax ?? 0).toString());
    const zero = new Decimal(0);

    // WHT only applies on paid + non-disallowed branches.
    // Tax-disallowed expenses are typically penalties/personal-use — WHT not applicable.
    // Accrued (AP) expenses defer WHT to clearance JE.
    const whtApplies = isPaid && !isTaxDisallowed && withholdingTax.gt(0);
    const whtAccountCode = whtApplies ? resolveWhtAccount(expense.vendorTaxId) : null;

    const lines: { accountCode: string; dr: Decimal; cr: Decimal; description?: string }[] = [];

    if (isTaxDisallowed) {
      // Tax-disallowed: full totalAmount to 54-XXXX, no VAT input claim.
      lines.push({
        accountCode: resolvedAccountCode,
        dr: totalAmount,
        cr: zero,
        description: expense.description,
      });
    } else {
      lines.push({
        accountCode: resolvedAccountCode,
        dr: amount,
        cr: zero,
        description: expense.description,
      });

      if (vatAmount.gt(0)) {
        lines.push({
          accountCode: VAT_INPUT_CODE,
          dr: vatAmount,
          cr: zero,
          description: 'ภาษีซื้อ',
        });
      }
    }

    // Credit side
    if (isPaid) {
      // Cash payment path. Split into WHT + net cash when WHT applies.
      if (whtApplies && whtAccountCode) {
        lines.push({
          accountCode: whtAccountCode,
          dr: zero,
          cr: withholdingTax,
          description: `WHT ${whtAccountCode === WHT_PND3_CODE ? 'ภ.ง.ด.3' : 'ภ.ง.ด.53'}`,
        });
        const netPayment = totalAmount.minus(withholdingTax);
        lines.push({
          accountCode: depositAccountCode,
          dr: zero,
          cr: netPayment,
          description: 'จ่ายเงินสุทธิ (หัก WHT)',
        });
      } else {
        lines.push({
          accountCode: depositAccountCode,
          dr: zero,
          cr: totalAmount,
          description: 'จ่ายเงิน',
        });
      }
    } else {
      // Accrued — entire totalAmount sits in AP (WHT settled at clearance).
      lines.push({
        accountCode: AP_ACCRUED_CODE,
        dr: zero,
        cr: totalAmount,
        description: 'ค้างจ่าย',
      });
    }

    // Sanity check (createAndPost also checks)
    const totalDr = lines.reduce((s, l) => s.plus(l.dr), zero);
    const totalCr = lines.reduce((s, l) => s.plus(l.cr), zero);
    if (!totalDr.equals(totalCr)) {
      throw new BadRequestException(
        `Expense JE unbalanced: Dr=${totalDr.toFixed(2)} Cr=${totalCr.toFixed(2)} for expense ${expense.expenseNumber}`,
      );
    }

    // Atomic block: idempotency check + JE post inside ONE transaction.
    // When outerTx is provided, run inside the caller's transaction.
    const run = async (tx: Prisma.TransactionClient): Promise<{ entryNo: string }> => {
      const existing = await tx.journalEntry.findFirst({
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

      const result = await this.journal.createAndPost(
        {
          description: `บันทึกค่าใช้จ่าย ${expense.expenseNumber} — ${expense.description}`,
          reference: `${expenseId}:expense`,
          metadata: {
            tag: 'EXPENSE',
            flow: 'expense',
            expenseId,
            expenseNumber: expense.expenseNumber,
            category: expense.category,
            isPaid,
            taxDisallowed: isTaxDisallowed,
            disallowedReason: disallowedReason ?? null,
            withholdingTax: withholdingTax.toFixed(2),
            whtAccountCode,
          },
          lines,
        },
        tx,
      );

      return { entryNo: result.entryNumber };
    };

    const out = outerTx ? await run(outerTx) : await this.prisma.$transaction(run);

    return out;
  }
}
