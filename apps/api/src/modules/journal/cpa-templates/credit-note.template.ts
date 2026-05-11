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
 *     Cr 11-4101 ภาษีซื้อ                  (vatAmount)        [if VAT > 0]
 *
 * If original.status === 'POSTED' (refund):
 *   Dr depositAccountCode                 (totalAmount)      — refund cash in
 *     Cr 5x-xxxx ค่าใช้จ่าย               (subtotal)
 *     Cr 11-4101 ภาษีซื้อ                  (vatAmount)        [if VAT > 0]
 *
 * CN reverses the original VAT input recorded at acquisition (11-4101).
 * Fix Report P0-1 — was incorrectly using 11-2104 (ลูกหนี้-VAT ที่ออกแทน,
 * ม.83/6 only) which is not claimable on ภ.พ.30. ม.86/10 compliance.
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
        include: {
          creditNote: true,
          expenseDetail: { include: { lines: { orderBy: { lineNo: 'asc' } } } },
        },
      });

      // Idempotency
      if (cn.journalEntryId) {
        const existing = await tx.journalEntry.findUnique({ where: { id: cn.journalEntryId } });
        return { entryNo: existing?.entryNumber ?? cn.journalEntryId };
      }

      if (!cn.creditNote) {
        throw new Error(`CreditNote ${documentId} missing creditNote detail`);
      }
      const { originalDocumentId } = cn.creditNote;

      const cnLines = cn.expenseDetail?.lines ?? [];
      if (cnLines.length === 0) {
        throw new Error(`CreditNote ${documentId} has no expense lines`);
      }

      // Validate every CN line.category against CoA BEFORE building any JE lines.
      // Must be an active expense account (5x-xxxx prefix AND type "ค่าใช้จ่าย").
      // Note: ChartOfAccount.type stores the Thai label from the CSV seed
      // (e.g. "ค่าใช้จ่าย", "สินทรัพย์"), NOT an English enum.
      const codes = [...new Set(cnLines.map((l) => l.category))];
      const coaRows = await tx.chartOfAccount.findMany({
        where: { code: { in: codes }, deletedAt: null },
        select: { code: true, type: true },
      });
      const byCode = new Map(coaRows.map((r) => [r.code, r.type]));
      for (const c of codes) {
        if (!byCode.get(c)) {
          throw new BadRequestException(
            `หมวดบัญชี ${c} ไม่พบในผังบัญชี — ไม่สามารถ post ใบลดหนี้`,
          );
        }
        if (!c.startsWith('5') || byCode.get(c) !== 'ค่าใช้จ่าย') {
          throw new BadRequestException(
            `หมวดบัญชี ${c} ไม่ใช่บัญชีค่าใช้จ่าย — ใบลดหนี้ต้องอ้างถึงบัญชี 5x-xxxx ประเภท "ค่าใช้จ่าย" เท่านั้น`,
          );
        }
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
      const vat = new Decimal(cn.vatAmount?.toString() ?? '0');
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
        // Cash refund out = total − WHT-of-original-being-reversed (if any).
        // Reasoning: original POSTED entry was Dr expense+VAT / Cr cash + Cr WHT-payable.
        // Reversing means Dr cash (less WHT, since WHT was never given to vendor) +
        // Dr WHT-payable (clears the liability) / Cr expense + Cr VAT.
        // NOTE: createCreditNote service blocks CN on docs with WHT > 0 (defense-in-depth
        // guard prevents this branch in production), but we reverse it correctly anyway.
        const origWht = new Decimal(original.withholdingTax?.toString() ?? '0');
        const cashRefund = total.minus(origWht);
        lines.push({
          accountCode: refundAccount,
          dr: cashRefund,
          cr: zero,
          description: `รับคืนเงิน — ${cn.number}`,
        });
        if (origWht.gt(zero)) {
          const whtAccount = original.whtFormType === 'PND53' ? '21-3103' : '21-3102';
          lines.push({
            accountCode: whtAccount,
            dr: origWht,
            cr: zero,
            description: `กลับรายการ WHT ${original.whtFormType ?? 'PND3'}`,
          });
        }
      }

      // Cr expense legs — Fix Report P2-2: emit one JE line per CN line so
      // the reversal preserves the same breakdown shape as the original
      // ExpenseDocument. Joining ExpenseLine → JournalLine becomes a simple
      // lookup by line description (no aggregation to undo).
      for (const l of cnLines) {
        const amt = new Decimal(l.amountBeforeVat.toString());
        if (amt.lte(zero)) continue;
        lines.push({
          accountCode: l.category,
          dr: zero,
          cr: amt,
          description: l.description
            ? `กลับค่าใช้จ่าย — ${l.description}`
            : `กลับค่าใช้จ่าย — ${cn.number}#${l.lineNo}`,
        });
      }
      if (vat.gt(zero)) {
        lines.push({
          accountCode: '11-4101',
          dr: zero,
          cr: vat,
          description: 'กลับ VAT (ภาษีซื้อ)',
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
            lineCount: cnLines.length,
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
