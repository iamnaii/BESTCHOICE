import { Injectable, BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';

export type PriceType = 'EXCLUSIVE' | 'INCLUSIVE';

export interface LineInput {
  quantity: number | string | Decimal;
  unitPrice: number | string | Decimal;
  discount?: number | string | Decimal;
  vatPercent?: number | string | Decimal;
  whtPercent?: number | string | Decimal;
}

export interface LineOutput {
  amountBeforeVat: Decimal;
  vatAmount: Decimal;
  whtAmount: Decimal;
  /** amountBeforeVat + vatAmount (sum of Dr expense + Dr VAT) */
  lineTotal: Decimal;
}

export interface DocumentTotals {
  subtotal: Decimal;
  vatAmount: Decimal;
  withholdingTax: Decimal;
  totalAmount: Decimal;
  netPayment: Decimal;
}

const TWO = 2;

@Injectable()
export class LineAggregatorService {
  /**
   * Compute one line's pre-VAT base, VAT amount, and WHT amount.
   * Per-line rounding is ROUND_HALF_UP to 2 decimals on VAT and WHT.
   * amountBeforeVat is exact arithmetic (no rounding) when EXCLUSIVE,
   * and ROUND_HALF_UP-divided when INCLUSIVE.
   */
  computeLine(input: LineInput, priceType: PriceType): LineOutput {
    const qty = this.dec(input.quantity);
    const unit = this.dec(input.unitPrice);
    const disc = this.dec(input.discount ?? 0);
    const vatPct = this.dec(input.vatPercent ?? 0);
    const whtPct = this.dec(input.whtPercent ?? 0);

    if (qty.lte(0)) throw new BadRequestException('จำนวนต้องมากกว่า 0');
    if (unit.lt(0)) throw new BadRequestException('ราคาต่อหน่วยต้องไม่เป็นลบ');
    if (disc.lt(0)) throw new BadRequestException('ส่วนลดต้องไม่เป็นลบ');

    const lineSubtotal = qty.mul(unit).minus(disc);

    let amountBeforeVat: Decimal;
    let vatAmount: Decimal;
    if (priceType === 'EXCLUSIVE') {
      amountBeforeVat = lineSubtotal;
      vatAmount = lineSubtotal.mul(vatPct).div(100).toDecimalPlaces(TWO, Decimal.ROUND_HALF_UP);
    } else {
      // INCLUSIVE: lineSubtotal includes VAT
      const denom = new Decimal(100).plus(vatPct);
      amountBeforeVat = lineSubtotal.mul(100).div(denom).toDecimalPlaces(TWO, Decimal.ROUND_HALF_UP);
      vatAmount = lineSubtotal.minus(amountBeforeVat);
    }

    const whtAmount = amountBeforeVat.mul(whtPct).div(100).toDecimalPlaces(TWO, Decimal.ROUND_HALF_UP);
    const lineTotal = amountBeforeVat.plus(vatAmount);

    return { amountBeforeVat, vatAmount, whtAmount, lineTotal };
  }

  /** Sum line outputs into document-level totals (no rounding — sums of pre-rounded values). */
  aggregateLines(
    lines: { amountBeforeVat: Decimal; vatAmount: Decimal; whtAmount: Decimal }[],
  ): DocumentTotals {
    const zero = new Decimal(0);
    const subtotal = lines.reduce((s, l) => s.plus(l.amountBeforeVat), zero);
    const vatAmount = lines.reduce((s, l) => s.plus(l.vatAmount), zero);
    const withholdingTax = lines.reduce((s, l) => s.plus(l.whtAmount), zero);
    const totalAmount = subtotal.plus(vatAmount);
    const netPayment = totalAmount.minus(withholdingTax);
    return { subtotal, vatAmount, withholdingTax, totalAmount, netPayment };
  }

  private dec(v: number | string | Decimal): Decimal {
    if (v instanceof Decimal) return v;
    return new Decimal(typeof v === 'number' ? v.toString() : v);
  }
}
