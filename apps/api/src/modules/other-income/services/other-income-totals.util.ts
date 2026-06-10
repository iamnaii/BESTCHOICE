import { Prisma } from '@prisma/client';
import { CreateOtherIncomeDto, OtherIncomeItemDto } from '../dto/create-other-income.dto';

const D = Prisma.Decimal;
type Decimal = Prisma.Decimal;
const ZERO = new D(0);

/**
 * Pure money-math for OtherIncome totals. No DI — imported by the Lifecycle
 * service. Behaviour byte-identical to the former private OtherIncomeService
 * methods of the same name.
 */
export function computeItem(
  it: OtherIncomeItemDto,
  priceType: 'EXCLUSIVE' | 'INCLUSIVE',
  lineNo: number,
) {
  const qty = new D(String(it.quantity));
  const unit = new D(String(it.unitAmount));
  const disc = new D(String(it.discountAmount ?? 0));
  const vatPct = new D(String(it.vatPct ?? 0));
  const whtPct = new D(String(it.whtPct ?? 0));

  const gross = qty.times(unit).minus(disc);
  let amountBeforeVat: Decimal;
  let vatAmount: Decimal;

  if (vatPct.gt(0)) {
    if (priceType === 'INCLUSIVE') {
      const factor = new D(1).plus(vatPct.div(100));
      amountBeforeVat = gross.div(factor).toDecimalPlaces(2);
      vatAmount = gross.minus(amountBeforeVat);
    } else {
      amountBeforeVat = gross;
      vatAmount = gross.times(vatPct).div(100).toDecimalPlaces(2);
    }
  } else {
    amountBeforeVat = gross;
    vatAmount = ZERO;
  }
  // V17 — WHT base is amountBeforeVat (pre-VAT taxable income), never the
  // VAT-inclusive total. See .claude/rules/accounting.md.
  const whtAmount = amountBeforeVat.times(whtPct).div(100).toDecimalPlaces(2);

  return {
    lineNo,
    accountCode: it.accountCode,
    accountName: '',
    description: it.description ?? null,
    quantity: qty,
    unitAmount: unit,
    discountAmount: disc,
    vatPct,
    whtPct,
    amountBeforeVat,
    vatAmount,
    whtAmount,
  };
}

export function computeTotals(dto: CreateOtherIncomeDto) {
  const items = dto.items.map((it, i) => computeItem(it, dto.priceType, i + 1));
  const incomeGross = items.reduce<Decimal>((s, it) => s.plus(it.amountBeforeVat), ZERO);
  const vatAmount = items.reduce<Decimal>((s, it) => s.plus(it.vatAmount), ZERO);
  const whtAmount = items.reduce<Decimal>((s, it) => s.plus(it.whtAmount), ZERO);
  const totalAmount = incomeGross.plus(vatAmount);
  const netReceived = totalAmount.minus(whtAmount);

  return { items, incomeGross, vatAmount, whtAmount, totalAmount, netReceived };
}
