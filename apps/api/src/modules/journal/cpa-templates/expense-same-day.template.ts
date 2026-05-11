import { Injectable } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { JournalAutoService, JeLineInput } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * Template — Expense Same-day (EX paid same day).
 *
 * Spec §4.1 — records expense + cash payment in one JE.
 *
 *   Dr 5x-xxxx ค่าใช้จ่ายตาม category     (subtotal)
 *   Dr 11-4101 ภาษีซื้อ                   (vatAmount)        [if VAT > 0]
 *   Dr <adj-account>                      (adjustment)       [if underpay diff < 0]
 *     Cr depositAccountCode                (amountReceived if set, else totalAmount - whtAmount)
 *     Cr 21-3102/3103 หัก ณ ที่จ่าย         (whtAmount)        [if WHT > 0; route by whtFormType]
 *     Cr <adj-account>                      (adjustment)       [if overpay diff > 0]
 *
 * Fix Report P0-1: VAT input → 11-4101 (was 11-2104).
 * Fix Report P0-4: adjustments line up to balance amount_paid ≠ amount_expected.
 *
 * ⚠️ CPA AUDIT REQUIRED — accounts logical-correct against Phase A.4 chart
 * but pending CPA case verification (Phase A.7).
 */
@Injectable()
export class ExpenseSameDayTemplate {
  private shopCompanyId: string | null = null;

  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
  ) {}

  /** Resolve SHOP company id (cached). Expense docs are SHOP-side per Phase A.5b plan. */
  private async getShopCompanyId(tx: Prisma.TransactionClient): Promise<string> {
    if (this.shopCompanyId) return this.shopCompanyId;
    const company = await tx.companyInfo.findFirst({
      where: { companyCode: 'SHOP', deletedAt: null },
      select: { id: true },
    });
    if (!company) {
      throw new Error(
        'SHOP company not found in database — expense documents must be recorded against SHOP',
      );
    }
    this.shopCompanyId = company.id;
    return company.id;
  }

  async execute(
    documentId: string,
    outerTx?: Prisma.TransactionClient,
  ): Promise<{ entryNo: string }> {
    const exec = async (tx: Prisma.TransactionClient): Promise<{ entryNo: string }> => {
      const doc = await tx.expenseDocument.findUniqueOrThrow({
        where: { id: documentId },
        include: {
          expenseDetail: { include: { lines: { orderBy: { lineNo: 'asc' } } } },
          adjustments: { orderBy: { lineNo: 'asc' } },
        },
      });

      // Idempotency — journalEntryId stores JournalEntry.id (UUID).
      // Look up entryNumber for legacy/return shape parity.
      if (doc.journalEntryId) {
        const existing = await tx.journalEntry.findUnique({
          where: { id: doc.journalEntryId },
          select: { entryNumber: true },
        });
        return { entryNo: existing?.entryNumber ?? doc.journalEntryId };
      }

      const expenseLines = doc.expenseDetail?.lines ?? [];
      if (expenseLines.length === 0) {
        throw new Error(`ExpenseDocument ${documentId} has no expense lines`);
      }
      if (!doc.depositAccountCode) {
        throw new Error(`ExpenseDocument ${documentId} missing depositAccountCode`);
      }

      const zero = new Decimal(0);
      const vat = new Decimal(doc.vatAmount?.toString() ?? '0');
      const wht = new Decimal(doc.withholdingTax?.toString() ?? '0');
      const total = new Decimal(doc.totalAmount.toString());
      // Cash leg: prefer `netPayment` (the actual amount paid; reconciled to
      // `total − wht` ± Σ adjustments by V12 in the service). Fall back to
      // `total − wht` for legacy docs without adjustments + amountPaid.
      const cashAmount = doc.netPayment
        ? new Decimal(doc.netPayment.toString())
        : total.minus(wht);

      // Aggregate Dr by category (multiple lines with same category collapse)
      const byCategory = new Map<string, Decimal>();
      for (const l of expenseLines) {
        const amt = new Decimal(l.amountBeforeVat.toString());
        byCategory.set(l.category, (byCategory.get(l.category) ?? zero).plus(amt));
      }

      // Adjustments (Fix Report P0-4): per-line Dr/Cr postings that absorb the
      // diff between cash leg actually paid and `totalAmount − wht`. Each row
      // carries its own `side` (DR/CR) so the JE template doesn't infer signs
      // from document-level math — V12 in the service has already validated
      // that the signed sum balances.
      const adjustments = doc.adjustments ?? [];

      const lines: JeLineInput[] = [];
      for (const [code, amt] of byCategory.entries()) {
        if (amt.lte(zero)) continue; // skip zero/negative aggregations
        lines.push({ accountCode: code, dr: amt, cr: zero, description: `ค่าใช้จ่าย — ${doc.number}` });
      }
      if (vat.gt(zero)) {
        lines.push({
          accountCode: '11-4101',
          dr: vat,
          cr: zero,
          description: 'ภาษีซื้อ',
        });
      }
      for (const adj of adjustments) {
        const amt = new Decimal(adj.amount.toString());
        if (amt.lte(zero)) continue;
        lines.push({
          accountCode: adj.accountCode,
          dr: adj.side === 'DR' ? amt : zero,
          cr: adj.side === 'CR' ? amt : zero,
          description: adj.note ?? `ปรับผลต่าง — ${doc.number}`,
        });
      }
      lines.push({
        accountCode: doc.depositAccountCode,
        dr: zero,
        cr: cashAmount,
        description: `จ่ายเงิน ${cashAmount.toFixed(2)} ฿`,
      });
      if (wht.gt(zero)) {
        const whtAccount = doc.whtFormType === 'PND53' ? '21-3103' : '21-3102';
        lines.push({
          accountCode: whtAccount,
          dr: zero,
          cr: wht,
          description: `หัก ณ ที่จ่าย ${doc.whtFormType ?? 'PND3'}`,
        });
      }

      const companyId = await this.getShopCompanyId(tx);
      const result = await this.journal.createAndPost(
        {
          description: `บันทึกจ่ายค่าใช้จ่าย ${doc.number}`,
          reference: doc.id,
          metadata: {
            tag: 'EXPENSE_SAME_DAY',
            documentId: doc.id,
            documentNumber: doc.number,
            documentType: doc.documentType,
            flow: 'expense-same-day',
            lineCount: expenseLines.length,
          },
          postedAt: doc.documentDate,
          lines,
          companyId,
        },
        tx,
      );

      await tx.expenseDocument.update({
        where: { id: doc.id },
        data: {
          status: 'POSTED',
          paidAt: doc.documentDate,
          journalEntryId: result.id,
          netPayment: cashAmount,
        },
      });

      return { entryNo: result.entryNumber };
    };

    return outerTx ? exec(outerTx) : this.prisma.$transaction(exec);
  }
}
