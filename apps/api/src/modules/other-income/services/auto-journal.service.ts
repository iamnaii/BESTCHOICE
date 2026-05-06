import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

const D = Prisma.Decimal;
type Decimal = Prisma.Decimal;

export interface JeLineInput {
  accountCode: string;
  debit: Decimal;
  credit: Decimal;
  description?: string;
}

export interface AutoJournalItem {
  lineNo: number;
  accountCode: string;
  accountName: string;
  description?: string | null;
  amountBeforeVat: Decimal;
  vatAmount: Decimal;
  whtAmount: Decimal;
  whtPct: Decimal;
}

export interface AutoJournalAdjustment {
  lineNo: number;
  accountCode: string;
  amount: Decimal;
  note?: string | null;
}

export interface AutoJournalDoc {
  paymentAccountCode: string;
  amountReceived: Decimal;
  netReceived: Decimal;
  items: AutoJournalItem[];
  adjustments: AutoJournalAdjustment[];
}

const ZERO = new D(0);

const WHT_RECEIVABLE_CODE = '11-4103';
const VAT_OUTPUT_CODE = '21-2101';

@Injectable()
export class AutoJournalService {
  generate(doc: AutoJournalDoc): JeLineInput[] {
    const lines: JeLineInput[] = [];

    const totalVat = doc.items.reduce<Decimal>(
      (s, it) => s.plus(it.vatAmount),
      ZERO,
    );
    const totalWht = doc.items.reduce<Decimal>(
      (s, it) => s.plus(it.whtAmount),
      ZERO,
    );

    // Dr: Cash / Bank received
    if (doc.amountReceived.gt(0)) {
      lines.push({
        accountCode: doc.paymentAccountCode,
        debit: doc.amountReceived,
        credit: ZERO,
        description: 'รับเงินจริง',
      });
    }

    // Dr: WHT receivable (ภาษีหัก ณ ที่จ่าย)
    if (totalWht.gt(0)) {
      const firstWhtPct = doc.items.find((i) => i.whtAmount.gt(0))?.whtPct;
      lines.push({
        accountCode: WHT_RECEIVABLE_CODE,
        debit: totalWht,
        credit: ZERO,
        description: firstWhtPct
          ? `ภาษีหัก ณ ที่จ่าย ${firstWhtPct}%`
          : 'ภาษีหัก ณ ที่จ่าย',
      });
    }

    // Adjustments: Dr when received < net (ขาด), Cr when received > net (เกิน)
    const diff = doc.amountReceived.minus(doc.netReceived);
    for (const adj of doc.adjustments) {
      if (diff.lt(0)) {
        lines.push({
          accountCode: adj.accountCode,
          debit: adj.amount,
          credit: ZERO,
          description: adj.note ?? 'ปรับผลต่าง (ขาด)',
        });
      } else {
        lines.push({
          accountCode: adj.accountCode,
          debit: ZERO,
          credit: adj.amount,
          description: adj.note ?? 'ปรับผลต่าง (เกิน)',
        });
      }
    }

    // Cr: Income lines (one per item)
    for (const item of doc.items) {
      lines.push({
        accountCode: item.accountCode,
        debit: ZERO,
        credit: item.amountBeforeVat,
        description: item.description ?? item.accountName,
      });
    }

    // Cr: VAT output (ภาษีขาย ภ.พ.30)
    if (totalVat.gt(0)) {
      lines.push({
        accountCode: VAT_OUTPUT_CODE,
        debit: ZERO,
        credit: totalVat,
        description: 'ภาษีขาย ภ.พ.30',
      });
    }

    return lines;
  }
}
