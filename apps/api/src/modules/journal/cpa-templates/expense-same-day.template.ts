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
 *   Dr 5x-xxxx ค่าใช้จ่ายตาม category    (subtotal)
 *   Dr 11-2104 ลูกหนี้-VAT                (vatAmount)        [if VAT > 0]
 *     Cr depositAccountCode               (totalAmount - whtAmount)
 *     Cr 21-3102/3103 หัก ณ ที่จ่าย       (whtAmount)        [if WHT > 0; route by whtFormType]
 *
 * ⚠️ CPA AUDIT REQUIRED — accounts logical-correct against Phase A.4 chart
 * but pending CPA case verification (Phase A.7).
 */
@Injectable()
export class ExpenseSameDayTemplate {
  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
  ) {}

  async execute(
    documentId: string,
    outerTx?: Prisma.TransactionClient,
  ): Promise<{ entryNo: string }> {
    const exec = async (tx: Prisma.TransactionClient): Promise<{ entryNo: string }> => {
      const doc = await tx.expenseDocument.findUniqueOrThrow({
        where: { id: documentId },
        include: { expenseDetail: true },
      });

      // Idempotency
      if (doc.journalEntryId) {
        return { entryNo: doc.journalEntryId };
      }

      const zero = new Decimal(0);
      const subtotal = new Decimal(doc.subtotal.toString());
      const vat = new Decimal(doc.vatAmount.toString());
      const wht = new Decimal(doc.withholdingTax.toString());
      const total = new Decimal(doc.totalAmount.toString());
      const cashAmount = total.minus(wht);

      if (!doc.expenseDetail?.category) {
        throw new Error(`ExpenseDocument ${documentId} missing expenseDetail.category`);
      }
      if (!doc.depositAccountCode) {
        throw new Error(`ExpenseDocument ${documentId} missing depositAccountCode`);
      }

      const lines: JeLineInput[] = [
        {
          accountCode: doc.expenseDetail.category,
          dr: subtotal,
          cr: zero,
          description: `ค่าใช้จ่าย — ${doc.number}`,
        },
      ];
      if (vat.gt(zero)) {
        lines.push({
          accountCode: '11-2104',
          dr: vat,
          cr: zero,
          description: 'ลูกหนี้-VAT ที่ออกแทน',
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

      const result = await this.journal.createAndPost(
        {
          description: `รับชำระค่าใช้จ่าย ${doc.number}`,
          reference: doc.id,
          metadata: {
            tag: 'EXPENSE_SAME_DAY',
            documentId: doc.id,
            documentNumber: doc.number,
            documentType: doc.documentType,
            flow: 'expense-same-day',
          },
          postedAt: doc.documentDate,
          lines,
        },
        tx,
      );

      await tx.expenseDocument.update({
        where: { id: doc.id },
        data: {
          status: 'POSTED',
          paidAt: doc.documentDate,
          journalEntryId: result.entryNumber,
          netPayment: cashAmount,
        },
      });

      return { entryNo: result.entryNumber };
    };

    return outerTx ? exec(outerTx) : this.prisma.$transaction(exec);
  }
}
