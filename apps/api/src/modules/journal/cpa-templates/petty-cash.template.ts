import { Injectable, BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { JournalAutoService, JeLineInput } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * Template — Petty Cash Reimbursement (C1).
 *
 * Multi-supplier single-document workflow. Each line carries its own
 * `supplierName` + `category` + optional `vatAmount`. Unlike EXPENSE_SAMEDAY,
 * Petty Cash has no WHT (small-cash scope — vendors with WHT use regular
 * EXPENSE flow).
 *
 *   Dr 5x-xxxx ค่าใช้จ่ายตาม category   (amount per line, exclusive of VAT)
 *   Dr 11-4101 ภาษีซื้อ                  (Σ vatAmount across lines)        [if Σ > 0]
 *     Cr depositAccountCode              (Σ line totals — the float account, typically 11-1201)
 *
 * `expense_lines.supplierName` is captured but doesn't drive routing — it's
 * audit-trail-only at the JE level. The supplier list shows up on the
 * voucher PDF (C1.8).
 *
 * V20 invariants are enforced upstream in PettyCashService.validate, not here.
 */
@Injectable()
export class PettyCashTemplate {
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
    if (!co) throw new Error('SHOP companyInfo not found — seed required');
    this.shopCompanyId = co.id;
    return co.id;
  }

  async execute(
    documentId: string,
    outerTx?: Prisma.TransactionClient,
  ): Promise<{ entryNo: string }> {
    const exec = async (tx: Prisma.TransactionClient): Promise<{ entryNo: string }> => {
      // Cheap idempotency probe — same pattern as expense-same-day / vendor-settlement.
      const probe = await tx.expenseDocument.findUnique({
        where: { id: documentId },
        select: { journalEntryId: true },
      });
      if (probe?.journalEntryId) {
        const existing = await tx.journalEntry.findUnique({
          where: { id: probe.journalEntryId },
          select: { entryNumber: true },
        });
        return { entryNo: existing?.entryNumber ?? probe.journalEntryId };
      }

      const doc = await tx.expenseDocument.findUniqueOrThrow({
        where: { id: documentId },
        include: {
          expenseDetail: { include: { lines: { orderBy: { lineNo: 'asc' } } } },
        },
      });

      // Belt-and-braces idempotency after the heavy fetch.
      if (doc.journalEntryId) {
        const existing = await tx.journalEntry.findUnique({
          where: { id: doc.journalEntryId },
        });
        return { entryNo: existing?.entryNumber ?? doc.journalEntryId };
      }

      if (!doc.expenseDetail || doc.expenseDetail.lines.length === 0) {
        throw new BadRequestException(`Petty Cash ${documentId} missing lines`);
      }
      if (!doc.depositAccountCode) {
        throw new BadRequestException(
          `Petty Cash ${documentId} requires depositAccountCode (float account)`,
        );
      }

      const zero = new Decimal(0);
      const lines: JeLineInput[] = [];

      // One Dr line per expense line (per category — same category can repeat
      // across lines; we don't merge so the audit trail keeps per-supplier visibility).
      let totalCash = zero;
      let totalVat = zero;
      for (const l of doc.expenseDetail.lines) {
        const base = new Decimal(l.amountBeforeVat.toString());
        const vat = new Decimal(l.vatAmount.toString());
        const lineTotal = base.plus(vat);
        totalCash = totalCash.plus(lineTotal);
        totalVat = totalVat.plus(vat);
        if (base.gt(zero)) {
          lines.push({
            accountCode: l.category,
            dr: base,
            cr: zero,
            description: l.supplierName
              ? `${l.supplierName}${l.description ? ` — ${l.description}` : ''}`
              : (l.description ?? `รายการที่ ${l.lineNo}`),
          });
        }
      }

      // Aggregate VAT line — Fix Report P0-1 routes to 11-4101 (NOT 11-2104).
      if (totalVat.gt(zero)) {
        lines.push({
          accountCode: '11-4101',
          dr: totalVat,
          cr: zero,
          description: `ภาษีซื้อ Petty Cash (รวม ${doc.expenseDetail.lines.length} รายการ)`,
        });
      }

      // Cash leg — single Cr of the float account for the whole document.
      lines.push({
        accountCode: doc.depositAccountCode,
        dr: zero,
        cr: totalCash,
        description: `เบิกชดเชย Petty Cash ${doc.number} (${doc.expenseDetail.lines.length} รายการ)`,
      });

      const shopCompanyId = await this.getShopCompanyId(tx);

      const result = await this.journal.createAndPost(
        {
          description: `เบิกชดเชย Petty Cash ${doc.number}`,
          reference: doc.id,
          metadata: {
            tag: 'PETTY_CASH_REIMBURSEMENT',
            documentId: doc.id,
            documentNumber: doc.number,
            documentType: doc.documentType,
            lineCount: doc.expenseDetail.lines.length,
            supplierCount: new Set(
              doc.expenseDetail.lines
                .map((l) => l.supplierName)
                .filter((v): v is string => !!v),
            ).size,
            flow: 'expense-petty-cash',
          },
          postedAt: doc.documentDate,
          companyId: shopCompanyId,
          lines,
        },
        tx,
      );

      await tx.expenseDocument.update({
        where: { id: doc.id },
        data: {
          status: 'POSTED',
          paidAt: doc.documentDate,
          journalEntryId: result.id,
          netPayment: totalCash,
        },
      });

      return { entryNo: result.entryNumber };
    };

    return outerTx ? exec(outerTx) : this.prisma.$transaction(exec);
  }
}
