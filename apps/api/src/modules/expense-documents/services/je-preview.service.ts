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
   *
   * W8 — now mirrors the templates' multi-line WHT routing (P2-4) and the
   * adjustment rows (P0-4):
   *   - When any line carries its own `whtFormType`, aggregate WHT per form
   *     and emit one Cr line per form (21-3102 + 21-3103). Otherwise fall
   *     back to legacy doc-level routing.
   *   - Render adjustment rows in the appropriate Dr / Cr column.
   *   - Cash leg = `amountPaid` when set (post-adjustment), else `total − wht`.
   *
   * Only renders EXPENSE flows. CN / PAYROLL / VENDOR_SETTLEMENT previews are
   * deferred — the frontend hides the preview panel for those doc types.
   */
  preview(dto: CreateExpenseDocumentDto, accountNames: Map<string, string>): JePreview {
    const priceType = dto.priceType ?? 'EXCLUSIVE';
    const computed = dto.lines.map((l, idx) => ({
      lineNo: idx + 1,
      category: l.category,
      description: l.description,
      vatPercent: l.vatPercent ?? 0,
      whtPercent: l.whtPercent ?? 0,
      whtFormType: l.whtFormType ?? null,
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

    // Dr 11-4101 VAT (if any) — Input Tax Credit, claimable on ภ.พ.30.
    // Must mirror expense-same-day / expense-accrual / credit-note templates,
    // all of which book purchase VAT to 11-4101 (Fix Report P0-1).
    // 11-2104 ("ลูกหนี้-VAT ที่ออกแทน") is reserved for ม.83/6 overseas-service
    // VAT — NOT routine purchase. Booking preview vs actual JE to different
    // accounts deceives the accountant approving the JE.
    if (totals.vatAmount.gt(0)) {
      previewLines.push({
        accountCode: '11-4101',
        accountName: accountNames.get('11-4101') ?? 'ภาษีซื้อ',
        description: 'ภาษีซื้อ',
        dr: totals.vatAmount.toFixed(2),
        cr: '0.00',
      });
    }

    // W8 — adjustments (P0-4 multi-line). Render Dr/Cr per row using the
    // explicit `side`. The service has already validated V12 (signed sum
    // closes the diff), so we just echo what will hit the GL.
    const adjustments = dto.adjustments ?? [];
    for (const adj of adjustments) {
      const amt = new Decimal(adj.amount);
      if (amt.lte(zero)) continue;
      previewLines.push({
        accountCode: adj.accountCode,
        accountName: accountNames.get(adj.accountCode) ?? '',
        description: adj.note ?? 'ปรับผลต่าง',
        dr: adj.side === 'DR' ? amt.toFixed(2) : '0.00',
        cr: adj.side === 'CR' ? amt.toFixed(2) : '0.00',
      });
    }

    if (hasPayment) {
      // Same-day: Cr cash + Cr WHT (per formType, with per-line routing if used)
      // Cash leg = amountPaid when set (post-adjustment), else `total − wht`.
      const cashCr = dto.amountPaid
        ? new Decimal(dto.amountPaid)
        : totals.totalAmount.minus(totals.withholdingTax);
      previewLines.push({
        accountCode: dto.depositAccountCode!,
        accountName: accountNames.get(dto.depositAccountCode!) ?? '',
        description: 'จ่ายเงิน',
        dr: '0.00',
        cr: cashCr.toFixed(2),
      });
      if (totals.withholdingTax.gt(0)) {
        // W8 — per-line WHT routing mirrors expense-same-day.template.ts
        // (P2-4). When any line sets its own whtFormType, we aggregate by
        // form-type and emit up to 2 Cr lines (21-3102 + 21-3103).
        const hasPerLineRouting = computed.some((c) => !!c.whtFormType);
        if (hasPerLineRouting) {
          const whtByForm = new Map<'PND3' | 'PND53', Decimal>();
          for (const c of computed) {
            if (c.whtAmount.lte(zero)) continue;
            const formType = (c.whtFormType ?? dto.whtFormType ?? 'PND3') as 'PND3' | 'PND53';
            // Unknown/invalid form types fall through to PND3 *here only*
            // (preview is best-effort; service guard rejects bad form types
            // before the JE is ever booked).
            const f = formType === 'PND53' ? 'PND53' : 'PND3';
            whtByForm.set(f, (whtByForm.get(f) ?? zero).plus(c.whtAmount));
          }
          for (const [form, amt] of whtByForm.entries()) {
            if (amt.lte(zero)) continue;
            const whtAccount = form === 'PND53' ? '21-3103' : '21-3102';
            previewLines.push({
              accountCode: whtAccount,
              accountName: accountNames.get(whtAccount) ?? '',
              description: `WHT ${form}`,
              dr: '0.00',
              cr: amt.toFixed(2),
            });
          }
        } else {
          const whtAccount = dto.whtFormType === 'PND53' ? '21-3103' : '21-3102';
          previewLines.push({
            accountCode: whtAccount,
            accountName: accountNames.get(whtAccount) ?? '',
            description: `WHT ${dto.whtFormType ?? 'PND3'}`,
            dr: '0.00',
            cr: totals.withholdingTax.toFixed(2),
          });
        }
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
