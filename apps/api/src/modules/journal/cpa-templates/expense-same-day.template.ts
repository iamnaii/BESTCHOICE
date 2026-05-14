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

      // Adjustments (Fix Report P0-4): per-line Dr/Cr postings that absorb the
      // diff between cash leg actually paid and `totalAmount − wht`. Each row
      // carries its own `side` (DR/CR) so the JE template doesn't infer signs
      // from document-level math — V12 in the service has already validated
      // that the signed sum balances.
      const adjustments = doc.adjustments ?? [];

      // Dr expense — Fix Report P2-2: emit one JE line per ExpenseLine so the
      // GL preserves the full breakdown (lines from different invoices, or
      // different sub-descriptions within one category, no longer get squashed
      // together). Description carries the line text so auditors can trace
      // back to the original document line without joining.
      const lines: JeLineInput[] = [];
      for (const l of expenseLines) {
        const amt = new Decimal(l.amountBeforeVat.toString());
        if (amt.lte(zero)) continue;
        lines.push({
          accountCode: l.category,
          dr: amt,
          cr: zero,
          description: l.description
            ? `ค่าใช้จ่าย — ${l.description}`
            : `ค่าใช้จ่าย — ${doc.number}#${l.lineNo}`,
        });
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
      // WHT routing (Fix Report P2-4). When any ExpenseLine sets its own
      // `whtFormType`, switch to per-line aggregation so a single doc with
      // mixed individual + juristic vendors posts up to 2 Cr lines
      // (21-3102 + 21-3103). Otherwise fall back to legacy doc-level routing
      // (single Cr line) — keeps backwards compat with pre-P2-4 docs/tests
      // where line-level whtFormType is null and line-level whtAmount is
      // absent from the include.
      const hasPerLineRouting = expenseLines.some(
        (l: { whtFormType?: string | null }) => !!l.whtFormType,
      );
      if (hasPerLineRouting) {
        const whtByForm = new Map<'PND3' | 'PND53', Decimal>();
        for (const l of expenseLines) {
          const rawWht = (l as { whtAmount?: unknown }).whtAmount;
          if (rawWht == null) continue;
          const lineWht = new Decimal(rawWht.toString());
          if (lineWht.lte(zero)) continue;
          const formType = (l as { whtFormType?: string | null }).whtFormType ?? doc.whtFormType;
          // Fix #C12 — defense in depth. The service-level guard at post()
          // already rejects WHT > 0 without a resolvable form type, but the
          // template throws too so any future caller bypass surfaces here
          // instead of silently misfiling under PND3.
          if (formType !== 'PND3' && formType !== 'PND53') {
            throw new Error(
              `whtFormType ต้องเป็น PND3 หรือ PND53 (got ${formType ?? 'null'}) — line wht=${lineWht}`,
            );
          }
          whtByForm.set(
            formType,
            (whtByForm.get(formType) ?? zero).plus(lineWht),
          );
        }
        for (const [form, amt] of whtByForm.entries()) {
          if (amt.lte(zero)) continue;
          const whtAccount = form === 'PND53' ? '21-3103' : '21-3102';
          lines.push({
            accountCode: whtAccount,
            dr: zero,
            cr: amt,
            description: `หัก ณ ที่จ่าย ${form}`,
          });
        }
      } else if (wht.gt(zero)) {
        // Legacy / single-vendor doc: one Cr line, route by doc.whtFormType.
        // Fix #C12 — no silent PND3 fallback. Service guard guarantees
        // doc.whtFormType is set when wht > 0; template re-checks.
        if (doc.whtFormType !== 'PND3' && doc.whtFormType !== 'PND53') {
          throw new Error(
            `whtFormType ต้องเป็น PND3 หรือ PND53 (got ${doc.whtFormType ?? 'null'}) — doc wht=${wht}`,
          );
        }
        const whtAccount = doc.whtFormType === 'PND53' ? '21-3103' : '21-3102';
        lines.push({
          accountCode: whtAccount,
          dr: zero,
          cr: wht,
          description: `หัก ณ ที่จ่าย ${doc.whtFormType}`,
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
