import { Prisma } from '@prisma/client';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { clearSystemConfig, setSystemConfig } from './expense-fixtures';

/**
 * DOC-05 (issue #1564) domain fixtures — the independent money model of an
 * other-income document (42-XXXX items with VAT / WHT, adjustments, partial
 * receipt), the journal the OtherIncomeTemplate must book for it, the daily
 * sheet aggregation, and two runtime toggles the scenarios flip.
 *
 * Tax rules mirrored here are the system's own policy (VAT on the pre-VAT
 * amount, WHT base = amountBeforeVat per ม.50 / V17, half-up to satang) —
 * they are re-derived from the rules, not read from the service code.
 */

const D = Prisma.Decimal;
const ZERO = new D(0);
const round2 = (value: Prisma.Decimal) => value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

export type PriceType = 'EXCLUSIVE' | 'INCLUSIVE';

export interface OtherIncomeItemSpec {
  accountCode: string;
  quantity: number;
  unitAmount: number;
  discountAmount?: number;
  vatPct?: number;
  whtPct?: number;
  description?: string;
}

export interface OtherIncomeAdjustmentSpec { accountCode: string; amount: number; note?: string }

export interface OtherIncomeSpec {
  priceType: PriceType;
  paymentAccountCode: string;
  items: OtherIncomeItemSpec[];
  adjustments?: OtherIncomeAdjustmentSpec[];
  /** Defaults to the computed net (full receipt). */
  amountReceived?: number;
}

export interface OtherIncomeItemMoney { accountCode: string; beforeVat: Prisma.Decimal; vat: Prisma.Decimal; wht: Prisma.Decimal }

export interface OtherIncomeMoney {
  items: OtherIncomeItemMoney[];
  incomeGross: Prisma.Decimal;
  vat: Prisma.Decimal;
  wht: Prisma.Decimal;
  /** incomeGross + vat — the receipt's จำนวนเงินทั้งสิ้น. */
  total: Prisma.Decimal;
  /** total − wht — what the payer hands over when nothing is short or over. */
  net: Prisma.Decimal;
  received: Prisma.Decimal;
}

export function otherIncomeMoney(spec: OtherIncomeSpec): OtherIncomeMoney {
  const items = spec.items.map((item): OtherIncomeItemMoney => {
    const line = new D(item.quantity).times(item.unitAmount).minus(item.discountAmount ?? 0);
    const vatPct = new D(item.vatPct ?? 0);
    let beforeVat: Prisma.Decimal;
    let vat: Prisma.Decimal;
    if (vatPct.gt(0) && spec.priceType === 'INCLUSIVE') {
      beforeVat = round2(line.div(vatPct.div(100).plus(1)));
      vat = line.minus(beforeVat);
    } else {
      beforeVat = line;
      vat = vatPct.gt(0) ? round2(line.times(vatPct).div(100)) : ZERO;
    }
    const wht = round2(beforeVat.times(item.whtPct ?? 0).div(100));
    return { accountCode: item.accountCode, beforeVat, vat, wht };
  });
  const incomeGross = items.reduce((sum, item) => sum.plus(item.beforeVat), ZERO);
  const vat = items.reduce((sum, item) => sum.plus(item.vat), ZERO);
  const wht = items.reduce((sum, item) => sum.plus(item.wht), ZERO);
  const total = incomeGross.plus(vat);
  const net = total.minus(wht);
  return { items, incomeGross, vat, wht, total, net, received: spec.amountReceived == null ? net : new D(spec.amountReceived) };
}

export interface ExpectedJournalLine { accountCode: string; debit: string; credit: string }

/** WHT the payer withheld is our receivable; VAT collected is output tax payable. */
export const WHT_RECEIVABLE = '11-4103';
export const VAT_OUTPUT = '21-2101';

/**
 * Dr cash/bank (received) + Dr WHT receivable + adjustments (Dr when short, Cr when over)
 * / Cr each income account at its pre-VAT amount + Cr VAT output. Sorted for comparison.
 */
export function expectedJournalLines(spec: OtherIncomeSpec, money = otherIncomeMoney(spec)): ExpectedJournalLine[] {
  const lines: ExpectedJournalLine[] = [{ accountCode: spec.paymentAccountCode, debit: money.received.toFixed(2), credit: '0.00' }];
  if (money.wht.gt(0)) lines.push({ accountCode: WHT_RECEIVABLE, debit: money.wht.toFixed(2), credit: '0.00' });
  const diff = money.received.minus(money.net);
  for (const adjustment of spec.adjustments ?? []) {
    const amount = new D(adjustment.amount).toFixed(2);
    lines.push(diff.lt(0) ? { accountCode: adjustment.accountCode, debit: amount, credit: '0.00' } : { accountCode: adjustment.accountCode, debit: '0.00', credit: amount });
  }
  for (const item of money.items) lines.push({ accountCode: item.accountCode, debit: '0.00', credit: item.beforeVat.toFixed(2) });
  if (money.vat.gt(0)) lines.push({ accountCode: VAT_OUTPUT, debit: '0.00', credit: money.vat.toFixed(2) });
  return sortJournalLines(lines);
}

export function sortJournalLines<T extends ExpectedJournalLine>(lines: T[]): T[] {
  return [...lines].sort((a, b) => a.accountCode.localeCompare(b.accountCode) || a.debit.localeCompare(b.debit) || a.credit.localeCompare(b.credit));
}

export function mirroredJournalLines(lines: ExpectedJournalLine[]): ExpectedJournalLine[] {
  return sortJournalLines(lines.map((line) => ({ accountCode: line.accountCode, debit: line.credit, credit: line.debit })));
}

/** The request body `POST /other-income` accepts for a spec. */
export function otherIncomeBody(spec: OtherIncomeSpec, header: { issueDate: string; paymentDate?: string; customerId?: string; counterpartyName?: string; counterpartyTaxId?: string; counterpartyAddress?: string; counterpartyPhone?: string; customerNote?: string }) {
  const money = otherIncomeMoney(spec);
  return {
    issueDate: header.issueDate,
    paymentDate: header.paymentDate ?? header.issueDate,
    priceType: spec.priceType,
    customerId: header.customerId,
    counterpartyName: header.counterpartyName,
    counterpartyTaxId: header.counterpartyTaxId,
    counterpartyAddress: header.counterpartyAddress,
    counterpartyPhone: header.counterpartyPhone,
    paymentAccountCode: spec.paymentAccountCode,
    amountReceived: Number(money.received.toFixed(2)),
    items: spec.items.map((item) => ({ accountCode: item.accountCode, description: item.description, quantity: item.quantity, unitAmount: item.unitAmount, discountAmount: item.discountAmount ?? 0, vatPct: item.vatPct ?? 0, whtPct: item.whtPct ?? 0 })),
    adjustments: spec.adjustments?.map((adjustment) => ({ accountCode: adjustment.accountCode, amount: adjustment.amount, note: adjustment.note })),
    customerNote: header.customerNote,
  };
}

// ─── Daily sheet expectation ────────────────────────────────────────────────

export interface DailySheetExpectation {
  docCount: number;
  incomeGross: string;
  vat: string;
  wht: string;
  netReceived: string;
  byAccount: Record<string, { total: string; count: number }>;
  byPayment: Record<string, { total: string; count: number }>;
}

/**
 * Sums over the POSTED documents of one BKK day the way the sheet must report them:
 * header totals are the documents' income / VAT / WHT / net-after-WHT (not the cash
 * actually received), income per account at the pre-VAT amount, cash per payment
 * account at the amount received. A reversal document contributes with sign −1.
 */
export function dailySheetExpectation(docs: Array<{ spec: OtherIncomeSpec; sign?: 1 | -1 }>): DailySheetExpectation {
  const byAccount: Record<string, { total: Prisma.Decimal; count: number }> = {};
  const byPayment: Record<string, { total: Prisma.Decimal; count: number }> = {};
  let incomeGross = ZERO, vat = ZERO, wht = ZERO, netReceived = ZERO;
  for (const { spec, sign = 1 } of docs) {
    const money = otherIncomeMoney(spec);
    incomeGross = incomeGross.plus(money.incomeGross.times(sign));
    vat = vat.plus(money.vat.times(sign));
    wht = wht.plus(money.wht.times(sign));
    netReceived = netReceived.plus(money.net.times(sign));
    for (const item of money.items) {
      const row = (byAccount[item.accountCode] ??= { total: ZERO, count: 0 });
      row.total = row.total.plus(item.beforeVat.times(sign));
      row.count += 1;
    }
    const payment = (byPayment[spec.paymentAccountCode] ??= { total: ZERO, count: 0 });
    payment.total = payment.total.plus(money.received.times(sign));
    payment.count += 1;
  }
  const fixed = (map: Record<string, { total: Prisma.Decimal; count: number }>) => Object.fromEntries(Object.entries(map).map(([code, row]) => [code, { total: row.total.toFixed(2), count: row.count }]));
  return { docCount: docs.length, incomeGross: incomeGross.toFixed(2), vat: vat.toFixed(2), wht: wht.toFixed(2), netReceived: netReceived.toFixed(2), byAccount: fixed(byAccount), byPayment: fixed(byPayment) };
}

// ─── Runtime toggles ────────────────────────────────────────────────────────

/** `ExportEnabledGuard` reads SystemConfig `export_enabled` per request ('false'/'0' → 403). */
export async function setExportEnabled(prisma: PrismaService, enabled: boolean | null): Promise<void> {
  if (enabled === null) await clearSystemConfig(prisma, 'export_enabled');
  else await setSystemConfig(prisma, 'export_enabled', enabled ? 'true' : 'false');
}

export const MAKER_CHECKER_KEY = 'OTHER_INCOME_MAKER_CHECKER_ENABLED';

/**
 * An admin access token that already expired — signed with the app's own secret and
 * payload shape (aud 'admin'), so JwtStrategy rejects it for the reason we want (exp)
 * and not for a malformed claim.
 */
export function mintExpiredAdminToken(app: INestApplication, user: { id: string; email: string; role: string; branchId: string | null }): string {
  const jwt = app.get(JwtService);
  const config = app.get(ConfigService);
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role, branchId: user.branchId, aud: 'admin', scope: 'admin:full', accessibleCompanies: ['SHOP', 'FINANCE'], primaryCompany: 'FINANCE' },
    { secret: config.get<string>('JWT_SECRET')!, expiresIn: -60 },
  );
}
