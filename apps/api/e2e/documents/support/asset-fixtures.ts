import { Prisma } from '@prisma/client';
import { ExpectedJournalLine, sortJournalLines } from './other-income-fixtures';

/**
 * DOC-06 (issue #1565) domain fixtures — the independent money model of a fixed
 * asset (cost, VAT, WHT on the installation part, daily straight-line
 * depreciation) and the journals the asset templates must book for a purchase,
 * a depreciation period, a disposal and a write-off.
 *
 * Rules mirrored here are the system's own policy: capitalised cost excludes
 * VAT, WHT only on the service (installation) part, depreciation per day =
 * (cost − residual) ÷ (months × 365 / 12) kept at 4 dp, period amount = daily ×
 * calendar days in the period rounded half-up to satang.
 */

const D = Prisma.Decimal;
const round2 = (value: Prisma.Decimal) => value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
const round4 = (value: Prisma.Decimal) => value.toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);

export type AssetCategoryKind = 'EQUIPMENT' | 'IMPROVEMENT' | 'FURNITURE' | 'VEHICLE';

/** Cost / accumulated-depreciation / depreciation-expense accounts per category (FINANCE chart). */
export const ASSET_CHART: Record<AssetCategoryKind, { cost: string; accumulated: string; expense: string }> = {
  EQUIPMENT: { cost: '12-2101', accumulated: '12-2102', expense: '53-1601' },
  IMPROVEMENT: { cost: '12-2103', accumulated: '12-2104', expense: '53-1602' },
  FURNITURE: { cost: '12-2105', accumulated: '12-2106', expense: '53-1603' },
  VEHICLE: { cost: '12-2107', accumulated: '12-2108', expense: '53-1604' },
};
export const LOSS_ON_DISPOSAL = '53-1605';
export const GAIN_ON_DISPOSAL = '42-1105';
export const VAT_OUTPUT = '21-2101';

export interface AssetSpec {
  category: AssetCategoryKind;
  basePrice: number;
  shippingCost?: number;
  installationCost?: number;
  otherCapitalized?: number;
  hasVat?: boolean;
  vatInclusive?: boolean;
  vatAccount?: '11-4101' | '11-4102';
  /** WHT on the installation part, e.g. 0.03. */
  whtRate?: number;
  whtBaseAmount?: number;
  whtAccount?: '21-3102' | '21-3103';
  residualValue?: number;
  usefulLifeMonths: number;
  paymentAccount: string;
  /** YYYY-MM-DD — depreciation starts here. */
  purchaseDate: string;
}

export interface AssetMoney {
  /** Net-of-VAT purchase price. */
  basePrice: Prisma.Decimal;
  vat: Prisma.Decimal;
  wht: Prisma.Decimal;
  /** base + shipping + installation + other — what is capitalised. */
  purchaseCost: Prisma.Decimal;
  /** purchaseCost + VAT − WHT — what the payment account is credited. */
  totalPayable: Prisma.Decimal;
  residual: Prisma.Decimal;
  totalDays: number;
  dailyDepr: Prisma.Decimal;
}

export function assetMoney(spec: AssetSpec): AssetMoney {
  const raw = new D(spec.basePrice);
  let basePrice = raw;
  let vat = new D(0);
  if (spec.hasVat) {
    if (spec.vatInclusive) {
      vat = round2(raw.times(7).div(107));
      basePrice = raw.minus(vat);
    } else {
      vat = round2(raw.times('0.07'));
    }
  }
  const installation = new D(spec.installationCost ?? 0);
  const purchaseCost = round2(basePrice.plus(spec.shippingCost ?? 0).plus(installation).plus(spec.otherCapitalized ?? 0));
  const wht = spec.whtRate ? round2(new D(spec.whtBaseAmount ?? installation.toNumber()).times(spec.whtRate)) : new D(0);
  const residual = new D(spec.residualValue ?? 0);
  const totalDays = Math.round((spec.usefulLifeMonths * 365) / 12);
  const dailyDepr = round4(purchaseCost.minus(residual).div(totalDays));
  return { basePrice, vat, wht, purchaseCost, totalPayable: purchaseCost.plus(vat).minus(wht), residual, totalDays, dailyDepr };
}

/** Calendar days of `period` (YYYY-MM) that the asset is depreciated — from the purchase day in its first month, whole months after. */
export function depreciableDays(spec: AssetSpec, period: string): number {
  const [year, month] = period.split('-').map(Number);
  const [purchaseYear, purchaseMonth, purchaseDay] = spec.purchaseDate.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (year < purchaseYear || (year === purchaseYear && month < purchaseMonth)) return 0;
  if (year === purchaseYear && month === purchaseMonth) return lastDay - purchaseDay + 1;
  return lastDay;
}

/** Depreciation booked for one period (not the final force-fill period, which none of the scenarios reach). */
export function depreciationFor(spec: AssetSpec, period: string): Prisma.Decimal {
  const money = assetMoney(spec);
  return round2(money.dailyDepr.times(depreciableDays(spec, period)));
}

export function accumulatedThrough(spec: AssetSpec, periodsRun: string[], throughPeriod: string): Prisma.Decimal {
  return periodsRun.filter((period) => period <= throughPeriod).reduce((sum, period) => sum.plus(depreciationFor(spec, period)), new D(0));
}

/** Dr cost / Dr VAT input (when any) / Cr WHT payable (when any) / Cr payment account for the total payable. */
export function expectedPurchaseJournal(spec: AssetSpec): ExpectedJournalLine[] {
  const money = assetMoney(spec);
  const chart = ASSET_CHART[spec.category];
  const lines: ExpectedJournalLine[] = [{ accountCode: chart.cost, debit: money.purchaseCost.toFixed(2), credit: '0.00' }];
  if (spec.hasVat && money.vat.gt(0) && spec.vatAccount) lines.push({ accountCode: spec.vatAccount, debit: money.vat.toFixed(2), credit: '0.00' });
  if (money.wht.gt(0) && spec.whtAccount) lines.push({ accountCode: spec.whtAccount, debit: '0.00', credit: money.wht.toFixed(2) });
  lines.push({ accountCode: spec.paymentAccount, debit: '0.00', credit: money.totalPayable.toFixed(2) });
  return sortJournalLines(lines);
}

export function expectedDepreciationJournal(spec: AssetSpec, period: string): ExpectedJournalLine[] {
  const chart = ASSET_CHART[spec.category];
  const amount = depreciationFor(spec, period).toFixed(2);
  return sortJournalLines([
    { accountCode: chart.expense, debit: amount, credit: '0.00' },
    { accountCode: chart.accumulated, debit: '0.00', credit: amount },
  ]);
}

/**
 * Dr accumulated depreciation / Dr cash (proceeds) / Cr cost, with the difference as a loss (53-1605) or a gain (42-1105).
 * A write-off is a sale with no proceeds.
 */
export function expectedDisposalJournal(spec: AssetSpec, accumulated: Prisma.Decimal, proceeds: number, depositAccountCode?: string): ExpectedJournalLine[] {
  const money = assetMoney(spec);
  const chart = ASSET_CHART[spec.category];
  const lines: ExpectedJournalLine[] = [];
  if (accumulated.gt(0)) lines.push({ accountCode: chart.accumulated, debit: accumulated.toFixed(2), credit: '0.00' });
  if (proceeds > 0 && depositAccountCode) lines.push({ accountCode: depositAccountCode, debit: new D(proceeds).toFixed(2), credit: '0.00' });
  lines.push({ accountCode: chart.cost, debit: '0.00', credit: money.purchaseCost.toFixed(2) });
  const difference = money.purchaseCost.minus(accumulated).minus(proceeds);
  if (difference.gt(0)) lines.push({ accountCode: LOSS_ON_DISPOSAL, debit: difference.toFixed(2), credit: '0.00' });
  else if (difference.lt(0)) lines.push({ accountCode: GAIN_ON_DISPOSAL, debit: '0.00', credit: difference.abs().toFixed(2) });
  return sortJournalLines(lines);
}

export interface RegisterRowExpectation { purchaseCost: string; accumulatedDeprAt: string; netBookValueAt: string }

export function registerRowExpectation(spec: AssetSpec, periodsRun: string[], asOfDate: string): RegisterRowExpectation {
  const money = assetMoney(spec);
  const accumulated = accumulatedThrough(spec, periodsRun, asOfDate.slice(0, 7));
  return { purchaseCost: money.purchaseCost.toFixed(2), accumulatedDeprAt: accumulated.toFixed(2), netBookValueAt: money.purchaseCost.minus(accumulated).toFixed(2) };
}

export function registerTotals(rows: RegisterRowExpectation[]) {
  const sum = (field: keyof RegisterRowExpectation) => rows.reduce((total, row) => total.plus(row[field]), new D(0)).toFixed(2);
  return { count: rows.length, totalPurchaseCost: sum('purchaseCost'), totalAccumulatedDepr: sum('accumulatedDeprAt'), totalNbv: sum('netBookValueAt') };
}
