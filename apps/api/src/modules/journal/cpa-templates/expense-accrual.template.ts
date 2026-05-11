import { Injectable } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { JournalAutoService, JeLineInput } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * Template — Expense Accrual (EX ตั้งหนี้, no cash leg yet).
 *
 * Spec §4.2 — books expense as AP, awaits VENDOR_SETTLEMENT to clear.
 *
 *   Dr 5x-xxxx ค่าใช้จ่าย                 (subtotal)
 *   Dr 11-4101 ภาษีซื้อ                   (vatAmount)        [if VAT > 0]
 *     Cr 21-1104 เจ้าหนี้-ค่าใช้จ่ายกิจการ (totalAmount)
 *
 * WHT does not post here — defers to SE settlement time (ม.50 ป.รัษฎากร).
 * VAT input is booked to **11-4101 ภาษีซื้อ** (Input Tax Credit, claimable
 * in ภ.พ.30). The placeholder 11-2104 (ลูกหนี้-VAT ที่ออกแทน) used in earlier
 * commits was wrong — that account is for VAT-on-behalf cases (ม.83/6) only,
 * and is NOT claimable as input tax credit on ภ.พ.30. Fix Report P0-1.
 */
@Injectable()
export class ExpenseAccrualTemplate {
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
        include: { expenseDetail: { include: { lines: { orderBy: { lineNo: 'asc' } } } } },
      });

      // Idempotency — journalEntryId stores JournalEntry.id (UUID).
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

      const zero = new Decimal(0);
      const vat = new Decimal(doc.vatAmount?.toString() ?? '0');
      const total = new Decimal(doc.totalAmount.toString());

      // Aggregate Dr by category (multiple lines with same category collapse)
      const byCategory = new Map<string, Decimal>();
      for (const l of expenseLines) {
        const amt = new Decimal(l.amountBeforeVat.toString());
        byCategory.set(l.category, (byCategory.get(l.category) ?? zero).plus(amt));
      }

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
      lines.push({
        accountCode: '21-1104',
        dr: zero,
        cr: total,
        description: 'เจ้าหนี้ค่าใช้จ่ายกิจการ',
      });

      const companyId = await this.getShopCompanyId(tx);
      const result = await this.journal.createAndPost(
        {
          description: `ตั้งหนี้ค่าใช้จ่าย ${doc.number}`,
          reference: doc.id,
          metadata: {
            tag: 'EXPENSE_ACCRUAL',
            documentId: doc.id,
            documentNumber: doc.number,
            documentType: doc.documentType,
            flow: 'expense-accrual',
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
          status: 'ACCRUAL',
          paidAt: null,
          journalEntryId: result.id,
        },
      });

      return { entryNo: result.entryNumber };
    };

    return outerTx ? exec(outerTx) : this.prisma.$transaction(exec);
  }
}
