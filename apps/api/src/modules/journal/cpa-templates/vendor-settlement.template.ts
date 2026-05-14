import { Injectable, BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { JournalAutoService, JeLineInput } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * Template — Vendor Settlement (SE จ่ายเจ้าหนี้).
 *
 * Spec §4.5 — clears one or many ACCRUAL EX documents in a single payment.
 *
 *   Dr 21-1104 เจ้าหนี้ค่าใช้จ่ายกิจการ        (Σ amountSettled)
 *     Cr depositAccountCode                  (Σ amountSettled - Σ wht)
 *     Cr 21-3102 / 21-3103 ภ.ง.ด. 3 / 53     (Σ wht)              [if Σ wht > 0]
 *
 * SIDE EFFECT: each cleared EX → status=POSTED + paidAt = SE.documentDate.
 * Original ACCRUAL JE on cleared EX stays untouched (only the SE creates a new JE).
 *
 * WHT routing matches ExpenseSameDayTemplate: PND53 → 21-3103, else 21-3102.
 *
 * ⚠️ CPA AUDIT REQUIRED — Phase A.7 review.
 */
@Injectable()
export class VendorSettlementTemplate {
  private shopCompanyIdCache: string | null = null;

  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
  ) {}

  async execute(
    documentId: string,
    outerTx?: Prisma.TransactionClient,
  ): Promise<{ entryNo: string }> {
    const exec = async (tx: Prisma.TransactionClient): Promise<{ entryNo: string }> => {
      const se = await tx.expenseDocument.findUniqueOrThrow({
        where: { id: documentId },
        include: { settlement: { include: { settlementLines: true } } },
      });

      // Idempotency
      if (se.journalEntryId) {
        const existing = await tx.journalEntry.findUnique({
          where: { id: se.journalEntryId },
        });
        return { entryNo: existing?.entryNumber ?? se.journalEntryId };
      }

      if (!se.settlement || se.settlement.settlementLines.length === 0) {
        throw new Error(`Settlement ${documentId} missing detail/lines`);
      }
      if (!se.depositAccountCode) {
        throw new BadRequestException(`Settlement ${documentId} requires depositAccountCode`);
      }

      // Single-vendor invariant — SE.whtFormType applies to ONE vendor's payment.
      // Reject if cleared EXs span multiple vendors (different tax IDs would
      // need separate SEs because PND.3/PND.53 routing is per-recipient).
      const clearedDocs = await tx.expenseDocument.findMany({
        where: {
          id: { in: se.settlement.settlementLines.map((l) => l.clearedDocumentId) },
        },
        select: { id: true, vendorTaxId: true, vendorName: true },
      });
      // Use doc.id as fallback when both vendorTaxId and vendorName are null so
      // two anonymous-vendor docs produce distinct keys and correctly trip the invariant.
      // (Previous '' fallback + vendorKeys.delete('') silently allowed mixed null vendors.)
      const vendorKeys = new Set(
        clearedDocs.map((d) => d.vendorTaxId ?? d.vendorName ?? `__doc:${d.id}__`),
      );
      if (vendorKeys.size > 1) {
        throw new BadRequestException(
          'SE หนึ่งใบล้างหนี้ได้เพียงผู้ขายรายเดียว — กรุณาแยกใบจ่ายเจ้าหนี้ตามผู้ขาย',
        );
      }

      const zero = new Decimal(0);
      const sumSettled = se.settlement.settlementLines.reduce(
        (s: Decimal, l: { amountSettled: Decimal }) => s.plus(l.amountSettled.toString()),
        zero,
      );
      const wht = new Decimal(se.withholdingTax.toString());
      const cashLeg = sumSettled.minus(wht);

      const lines: JeLineInput[] = [
        {
          accountCode: '21-1104',
          dr: sumSettled,
          cr: zero,
          description: `จ่ายเจ้าหนี้ ${se.number}`,
        },
        {
          accountCode: se.depositAccountCode,
          dr: zero,
          cr: cashLeg,
          description: `ตัดเงินสด ${cashLeg.toFixed(2)} ฿`,
        },
      ];
      if (wht.gt(zero)) {
        const whtAccount = se.whtFormType === 'PND53' ? '21-3103' : '21-3102';
        lines.push({
          accountCode: whtAccount,
          dr: zero,
          cr: wht,
          description: `หัก ณ ที่จ่าย ${se.whtFormType ?? 'PND3'}`,
        });
      }

      const shopCompanyId = await this.getShopCompanyId(tx);

      const result = await this.journal.createAndPost(
        {
          description: `จ่ายเจ้าหนี้ ${se.number}`,
          reference: se.id,
          metadata: {
            tag: 'VENDOR_SETTLEMENT',
            documentId: se.id,
            documentNumber: se.number,
            documentType: se.documentType,
            clearedCount: se.settlement.settlementLines.length,
            flow: 'expense-vendor-settlement',
          },
          postedAt: se.documentDate,
          companyId: shopCompanyId,
          lines,
        },
        tx,
      );

      // SIDE EFFECT: each cleared EX status flip.
      // Fix #C8 — only flip to POSTED when cumulative settled = totalAmount.
      // For partial settlements (Σ POSTED SettlementLine.amountSettled including
      // *this* SE < cleared.totalAmount), keep the EX as ACCRUAL so a subsequent
      // SE can clear the residual. Without this guard, partial-paying EX once
      // strands the residual AP forever (expense-documents.service rejects any
      // SE on non-ACCRUAL docs at line ~480).
      //
      // Original ACCRUAL JE on cleared.journalEntryId stays intact — we only
      // toggle status/paidAt here. paidAt is set only when the doc is fully
      // settled; partial-settled docs keep paidAt = null.
      const clearedIds = se.settlement.settlementLines.map((l) => l.clearedDocumentId);
      const clearedDocsAmts = await tx.expenseDocument.findMany({
        where: { id: { in: clearedIds }, deletedAt: null },
        select: { id: true, totalAmount: true },
      });
      // Aggregate prior POSTED settlements per cleared doc so we know the
      // cumulative settled-amount once *this* SE posts.
      const priorAgg = await tx.settlementLine.groupBy({
        by: ['clearedDocumentId'],
        where: {
          clearedDocumentId: { in: clearedIds },
          settlement: {
            document: {
              status: 'POSTED',
              deletedAt: null,
            },
          },
        },
        _sum: { amountSettled: true },
      });
      const priorByDoc = new Map(
        priorAgg.map((a) => [a.clearedDocumentId, new Decimal(a._sum.amountSettled?.toString() ?? '0')]),
      );
      const thisByDoc = new Map<string, Decimal>();
      for (const sl of se.settlement.settlementLines) {
        const cur = thisByDoc.get(sl.clearedDocumentId) ?? zero;
        thisByDoc.set(sl.clearedDocumentId, cur.plus(sl.amountSettled.toString()));
      }
      const fullyPaidIds: string[] = [];
      const partiallyPaidIds: string[] = [];
      for (const d of clearedDocsAmts) {
        const cumulative = (priorByDoc.get(d.id) ?? zero).plus(thisByDoc.get(d.id) ?? zero);
        const total = new Decimal(d.totalAmount.toString());
        // ≥ instead of = because residual < 0.005 should still close the doc
        // (tolerance — same approach as journal balanced check at 0.01).
        if (cumulative.gte(total.minus(new Decimal('0.005')))) {
          fullyPaidIds.push(d.id);
        } else {
          partiallyPaidIds.push(d.id);
        }
      }
      if (fullyPaidIds.length > 0) {
        await tx.expenseDocument.updateMany({
          where: { id: { in: fullyPaidIds }, deletedAt: null },
          data: {
            status: 'POSTED',
            paidAt: se.documentDate,
          },
        });
      }
      // Partial settlements keep status=ACCRUAL and paidAt=null so a
      // subsequent SE can clear the residual. The cap check at
      // expense-documents.service.ts ~488-500 only counts POSTED SE lines,
      // so this partial SE will consume the cap correctly once it itself
      // becomes POSTED below.

      // Update SE itself
      await tx.expenseDocument.update({
        where: { id: se.id },
        data: {
          status: 'POSTED',
          paidAt: se.documentDate,
          journalEntryId: result.id,
          netPayment: cashLeg,
        },
      });

      return { entryNo: result.entryNumber };
    };

    return outerTx ? exec(outerTx) : this.prisma.$transaction(exec);
  }

  private async getShopCompanyId(tx: Prisma.TransactionClient): Promise<string> {
    if (this.shopCompanyIdCache) return this.shopCompanyIdCache;
    const co = await tx.companyInfo.findFirst({
      where: { companyCode: 'SHOP', deletedAt: null },
      select: { id: true },
    });
    if (!co) throw new Error('SHOP companyInfo not found — seed required');
    this.shopCompanyIdCache = co.id;
    return co.id;
  }
}
