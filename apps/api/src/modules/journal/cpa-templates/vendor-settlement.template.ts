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
      const vendorKeys = new Set(
        clearedDocs.map((d) => d.vendorTaxId ?? d.vendorName ?? ''),
      );
      vendorKeys.delete('');
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

      // SIDE EFFECT: each cleared EX → POSTED + paidAt (single batched update).
      // Note: does NOT overwrite cleared.journalEntryId — original ACCRUAL JE stays intact.
      await tx.expenseDocument.updateMany({
        where: {
          id: { in: se.settlement.settlementLines.map((l) => l.clearedDocumentId) },
          deletedAt: null,
        },
        data: {
          status: 'POSTED',
          paidAt: se.documentDate,
        },
      });

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
