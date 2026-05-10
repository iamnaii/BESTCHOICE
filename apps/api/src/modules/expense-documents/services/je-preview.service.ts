import { Injectable } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { LineAggregatorService } from './line-aggregator.service';
import { CreateExpenseDocumentDto } from '../dto/create.dto';

export interface PreviewLine {
  accountCode: string;
  accountName: string;
  description: string;
  dr: string;
  cr: string;
}

export interface JePreview {
  flow: 'expense-same-day' | 'expense-accrual';
  lines: PreviewLine[];
  totals: {
    subtotal: string;
    vatAmount: string;
    withholdingTax: string;
    totalAmount: string;
    netPayment: string;
    drSum: string;
    crSum: string;
    balanced: boolean;
  };
}

@Injectable()
export class JePreviewService {
  constructor(private readonly aggregator: LineAggregatorService) {}

  /**
   * Build a JE preview from form-state DTO without touching the database.
   * Same logic as ExpenseSameDay/ExpenseAccrual templates but pure.
   */
  preview(dto: CreateExpenseDocumentDto, accountNames: Map<string, string>): JePreview {
    const priceType = dto.priceType ?? 'EXCLUSIVE';
    const computed = dto.lines.map((l, idx) => ({
      lineNo: idx + 1,
      category: l.category,
      description: l.description,
      vatPercent: l.vatPercent ?? 0,
      whtPercent: l.whtPercent ?? 0,
      ...this.aggregator.computeLine(l, priceType),
    }));
    const totals = this.aggregator.aggregateLines(computed);
    const hasPayment = !!(dto.paymentMethod && dto.depositAccountCode);
    const flow: JePreview['flow'] = hasPayment ? 'expense-same-day' : 'expense-accrual';

    const previewLines: PreviewLine[] = [];
    const zero = new Decimal(0);

    // Aggregate Dr expense by category
    const byCategory = new Map<string, Decimal>();
    for (const c of computed) {
      byCategory.set(c.category, (byCategory.get(c.category) ?? zero).plus(c.amountBeforeVat));
    }
    for (const [code, amt] of byCategory.entries()) {
      previewLines.push({
        accountCode: code,
        accountName: accountNames.get(code) ?? '',
        description: 'ค่าใช้จ่าย',
        dr: amt.toFixed(2),
        cr: '0.00',
      });
    }

    // Dr 11-2104 VAT (if any)
    if (totals.vatAmount.gt(0)) {
      previewLines.push({
        accountCode: '11-2104',
        accountName: accountNames.get('11-2104') ?? 'ลูกหนี้-VAT ที่ออกแทน',
        description: 'VAT ซื้อ',
        dr: totals.vatAmount.toFixed(2),
        cr: '0.00',
      });
    }

    if (hasPayment) {
      // Same-day: Cr cash (totalAmount − wht), Cr WHT (per formType)
      const cashCr = totals.totalAmount.minus(totals.withholdingTax);
      previewLines.push({
        accountCode: dto.depositAccountCode!,
        accountName: accountNames.get(dto.depositAccountCode!) ?? '',
        description: 'จ่ายเงิน',
        dr: '0.00',
        cr: cashCr.toFixed(2),
      });
      if (totals.withholdingTax.gt(0)) {
        const whtAccount = dto.whtFormType === 'PND53' ? '21-3103' : '21-3102';
        previewLines.push({
          accountCode: whtAccount,
          accountName: accountNames.get(whtAccount) ?? '',
          description: `WHT ${dto.whtFormType ?? 'PND3'}`,
          dr: '0.00',
          cr: totals.withholdingTax.toFixed(2),
        });
      }
    } else {
      // Accrual: Cr 21-1104 AP for total
      previewLines.push({
        accountCode: '21-1104',
        accountName: accountNames.get('21-1104') ?? 'เจ้าหนี้ค่าใช้จ่ายกิจการ',
        description: 'ตั้งหนี้',
        dr: '0.00',
        cr: totals.totalAmount.toFixed(2),
      });
    }

    const drSum = previewLines.reduce((s, l) => s.plus(l.dr), zero);
    const crSum = previewLines.reduce((s, l) => s.plus(l.cr), zero);
    const balanced = drSum.equals(crSum);

    return {
      flow,
      lines: previewLines,
      totals: {
        subtotal: totals.subtotal.toFixed(2),
        vatAmount: totals.vatAmount.toFixed(2),
        withholdingTax: totals.withholdingTax.toFixed(2),
        totalAmount: totals.totalAmount.toFixed(2),
        netPayment: totals.netPayment.toFixed(2),
        drSum: drSum.toFixed(2),
        crSum: crSum.toFixed(2),
        balanced,
      },
    };
  }
}
