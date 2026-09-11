import * as bcrypt from 'bcrypt';
import { Prisma } from '@prisma/client';
import { resolveCompanyAccess } from '@installment/shared';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { ACCOUNTING_PERMISSIONS_KEY, parseAccountingPermissions, type AccountingPermission } from '../../../src/utils/accounting-permissions';
import { TEST_NAME_PREFIX } from '../../../src/utils/test-data-markers';
import type { WorldUser } from './fixtures';

/** Upsert (or soft-delete with `null`) a SystemConfig key — the same rows the settings UI writes. */
export async function setSystemConfig(prisma: PrismaService, key: string, value: string | null): Promise<void> {
  if (value === null) {
    await prisma.systemConfig.updateMany({ where: { key }, data: { deletedAt: new Date() } });
    return;
  }
  await prisma.systemConfig.upsert({ where: { key }, update: { value, deletedAt: null }, create: { key, value } });
}

/** Grant accounting permissions the way /settings does (SystemConfig `accounting_permissions`). OWNER needs none. */
export async function grantAccountingPermissions(prisma: PrismaService, userId: string, permissions: AccountingPermission[]): Promise<void> {
  const previous = await prisma.systemConfig.findFirst({ where: { key: ACCOUNTING_PERMISSIONS_KEY, deletedAt: null } });
  const assignments = parseAccountingPermissions(previous?.value);
  assignments[userId] = [...new Set([...(assignments[userId] ?? []), ...permissions])];
  await setSystemConfig(prisma, ACCOUNTING_PERMISSIONS_KEY, JSON.stringify(assignments));
}

/** Extra synthetic staff account (same bcrypt/login path as seedDocumentsWorld). */
export async function createWorldUser(prisma: PrismaService, input: { prefix: string; key: string; role: string; branchId: string | null; password: string }): Promise<WorldUser> {
  const access = resolveCompanyAccess(input.role, [], null);
  const row = await prisma.user.create({ data: {
    email: `${input.prefix.toLowerCase()}.${input.key.toLowerCase()}@example.invalid`, password: await bcrypt.hash(input.password, 10),
    name: `${TEST_NAME_PREFIX} ${input.role} ${input.key}`, role: input.role as never, branchId: input.branchId,
    accessibleCompanies: [...access.accessible], primaryCompany: access.primary,
  } });
  return { id: row.id, email: row.email, role: input.role, branchId: input.branchId, password: input.password };
}

export interface ExpenseLineSpec {
  category: string;
  description?: string;
  quantity: number;
  unitPrice: number;
  discount?: number;
  vatPercent?: number;
  whtPercent?: number;
  whtFormType?: 'PND3' | 'PND53';
}

export interface ExpectedTotals {
  subtotal: string;
  vat: string;
  total: string;
  wht: string;
  net: string;
  lines: Array<{ amountBeforeVat: string; vat: string; wht: string }>;
}

const round2 = (value: Prisma.Decimal) => value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

/**
 * Independent restatement of the CPA rule for EXCLUSIVE prices (คู่มือบันทึกรับชำระ):
 * line base = qty × unit − discount; VAT and WHT per line rounded half-up to
 * satang; document totals are plain sums; net = total − WHT.
 */
export function expectedExpenseTotals(lines: ExpenseLineSpec[]): ExpectedTotals {
  let subtotal = new Prisma.Decimal(0);
  let vat = new Prisma.Decimal(0);
  let wht = new Prisma.Decimal(0);
  const out: ExpectedTotals['lines'] = [];
  for (const line of lines) {
    const base = new Prisma.Decimal(line.quantity).mul(line.unitPrice).minus(line.discount ?? 0);
    const lineVat = round2(base.mul(line.vatPercent ?? 0).div(100));
    const lineWht = round2(base.mul(line.whtPercent ?? 0).div(100));
    subtotal = subtotal.plus(base);
    vat = vat.plus(lineVat);
    wht = wht.plus(lineWht);
    out.push({ amountBeforeVat: base.toFixed(2), vat: lineVat.toFixed(2), wht: lineWht.toFixed(2) });
  }
  const total = subtotal.plus(vat);
  return { subtotal: subtotal.toFixed(2), vat: vat.toFixed(2), total: total.toFixed(2), wht: wht.toFixed(2), net: total.minus(wht).toFixed(2), lines: out };
}

/** Petty cash lines are `amount` (before VAT) per supplier; optional VAT %. */
export function expectedPettyCashTotals(lines: Array<{ amount: number; vatPercent?: number }>): ExpectedTotals {
  return expectedExpenseTotals(lines.map((line) => ({ category: 'n/a', quantity: 1, unitPrice: line.amount, vatPercent: line.vatPercent })));
}

/** Debit/credit per account for one journal entry (strings with 2 decimals). */
export async function journalBalances(prisma: PrismaService, journalEntryId: string): Promise<Record<string, { debit: string; credit: string }>> {
  const lines = await prisma.journalLine.findMany({ where: { journalEntryId }, select: { accountCode: true, debit: true, credit: true } });
  const out: Record<string, { debit: Prisma.Decimal; credit: Prisma.Decimal }> = {};
  for (const line of lines) {
    const bucket = out[line.accountCode] ?? { debit: new Prisma.Decimal(0), credit: new Prisma.Decimal(0) };
    bucket.debit = bucket.debit.plus(line.debit);
    bucket.credit = bucket.credit.plus(line.credit);
    out[line.accountCode] = bucket;
  }
  return Object.fromEntries(Object.entries(out).map(([code, v]) => [code, { debit: v.debit.toFixed(2), credit: v.credit.toFixed(2) }]));
}

/** Bangkok calendar date `YYYY-MM-DD` shifted by `days`. */
export function bangkokDate(days = 0): string {
  const now = new Date(Date.now() + days * 86_400_000);
  return now.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
}
