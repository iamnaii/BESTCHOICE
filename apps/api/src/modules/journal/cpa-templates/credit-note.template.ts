import { Injectable, BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { JournalAutoService, JeLineInput } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * Template — Credit Note (CN ใบลดหนี้). Reverses prior EXPENSE document,
 * fully or partially.
 *
 * Spec §4.3 — JE shape depends on whether original was ACCRUAL (still owed)
 * or POSTED (already paid → refund flow).
 *
 * If original.status === 'ACCRUAL':
 *   Dr 21-1104                            (totalAmount)      — clear AP
 *     Cr 5x-xxxx ค่าใช้จ่าย               (subtotal)
 *     Cr 11-2104 ลูกหนี้-VAT              (vatAmount)        [if VAT > 0]
 *
 * If original.status === 'POSTED' (refund):
 *   Dr depositAccountCode                 (totalAmount)      — refund cash in
 *     Cr 5x-xxxx ค่าใช้จ่าย               (subtotal)
 *     Cr 11-2104 ลูกหนี้-VAT              (vatAmount)        [if VAT > 0]
 *
 * CPA AUDIT REQUIRED — high priority (ม.86/10 compliance).
 */
@Injectable()
export class CreditNoteTemplate {
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
      const cn = await tx.expenseDocument.findUniqueOrThrow({
        where: { id: documentId },
        include: { creditNote: true },
      });

      // Idempotency
      if (cn.journalEntryId) {
        const existing = await tx.journalEntry.findUnique({ where: { id: cn.journalEntryId } });
        return { entryNo: existing?.entryNumber ?? cn.journalEntryId };
      }

      if (!cn.creditNote) {
        throw new Error(`CreditNote ${documentId} missing creditNote detail`);
      }
      const { originalDocumentId, category } = cn.creditNote;
      // Validate `category` against the chart of accounts BEFORE building any
      // JE lines — without this, a corrupted category string would post a
      // journal entry to a non-existent account and silently corrupt the ledger.
      // Must be an active expense account (5x-xxxx prefix AND type "ค่าใช้จ่าย"
      // in CoA — defends against codes that start with '5' but are mis-typed).
      // Note: ChartOfAccount.type stores the Thai label from the CSV seed
      // (e.g. "ค่าใช้จ่าย", "สินทรัพย์"), NOT an English enum.
      const coaRow = await tx.chartOfAccount.findFirst({
        where: { code: category, deletedAt: null },
        select: { code: true, type: true },
      });
      if (!coaRow) {
        throw new BadRequestException(
          `หมวดบัญชี ${category} ไม่พบในผังบัญชี — ไม่สามารถ post ใบลดหนี้`,
        );
      }
      if (!category.startsWith('5') || coaRow.type !== 'ค่าใช้จ่าย') {
        throw new BadRequestException(
          `หมวดบัญชี ${category} ไม่ใช่บัญชีค่าใช้จ่าย — ใบลดหนี้ต้องอ้างถึงบัญชี 5x-xxxx ประเภท "ค่าใช้จ่าย" เท่านั้น`,
        );
      }

      const original = await tx.expenseDocument.findUniqueOrThrow({
        where: { id: originalDocumentId },
      });

      if (['VOIDED', 'DRAFT'].includes(original.status)) {
        throw new BadRequestException(
          `ไม่สามารถ post ใบลดหนี้ เพราะเอกสารต้นฉบับอยู่ในสถานะ ${original.status}`,
        );
      }

      const zero = new Decimal(0);
      const subtotal = new Decimal(cn.subtotal.toString());
      const vat = new Decimal(cn.vatAmount.toString());
      const total = new Decimal(cn.totalAmount.toString());

      const lines: JeLineInput[] = [];

      // Dr leg depends on original status
      if (original.status === 'ACCRUAL') {
        // Reverse the AP booking
        lines.push({
          accountCode: '21-1104',
          dr: total,
          cr: zero,
          description: `กลับเจ้าหนี้ — ${cn.number}`,
        });
      } else {
        // POSTED → refund cash. CN.depositAccountCode (or fall back to original's)
        const refundAccount = cn.depositAccountCode ?? original.depositAccountCode;
        if (!refundAccount) {
          throw new Error(
            `CreditNote ${cn.id} on POSTED original requires depositAccountCode for refund`,
          );
        }
        lines.push({
          accountCode: refundAccount,
          dr: total,
          cr: zero,
          description: `รับคืนเงิน — ${cn.number}`,
        });
      }

      // Cr legs (always)
      lines.push({
        accountCode: category,
        dr: zero,
        cr: subtotal,
        description: `กลับค่าใช้จ่าย — ${cn.number}`,
      });
      if (vat.gt(zero)) {
        lines.push({
          accountCode: '11-2104',
          dr: zero,
          cr: vat,
          description: 'กลับ VAT',
        });
      }

      const shopCompanyId = await this.getShopCompanyId(tx);

      const result = await this.journal.createAndPost(
        {
          description: `ใบลดหนี้ ${cn.number} (อ้าง ${original.id.slice(0, 8)}…)`,
          reference: cn.id,
          metadata: {
            tag: 'CREDIT_NOTE',
            documentId: cn.id,
            documentNumber: cn.number,
            documentType: cn.documentType,
            originalDocumentId,
            flow: 'expense-credit-note',
          },
          postedAt: cn.documentDate,
          companyId: shopCompanyId,
          lines,
        },
        tx,
      );

      // paidAt only on POSTED-original path (cash actually moved); ACCRUAL-path
      // CN clears AP without any cash flow, so paidAt stays null.
      const isCashRefund = original.status === 'POSTED';
      await tx.expenseDocument.update({
        where: { id: cn.id },
        data: {
          status: 'POSTED',
          paidAt: isCashRefund ? cn.documentDate : null,
          journalEntryId: result.id,
          netPayment: isCashRefund ? total : null,
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
