import * as bcrypt from 'bcrypt';
import { Prisma } from '@prisma/client';
import { resolveCompanyAccess } from '@installment/shared';
import { PrismaService } from '../../../src/prisma/prisma.service';
import {
  ACCOUNTING_PERMISSIONS_KEY,
  parseAccountingPermissions,
  type AccountingPermission,
} from '../../../src/utils/accounting-permissions';
import { TEST_NAME_PREFIX } from '../../../src/utils/test-data-markers';
import { DocumentsWorld, WorldUser } from './fixtures';

/**
 * DOC-03 (issue #1562) domain fixtures — everything the expense voucher
 * scenarios need beyond `seedDocumentsWorld`, kept out of support/harness.ts so
 * the DOC-00 / DOC-11 coordinator owns the shared files.
 *
 * Money expectations are computed here with plain Decimal arithmetic, on
 * purpose independent of LineAggregatorService / the JE templates: the
 * scenarios compare what the API persisted and printed against these numbers.
 */

/** Extra synthetic user in the same world (same password, real bcrypt hash, role default company grants). */
export async function createWorldUser(
  prisma: PrismaService,
  world: DocumentsWorld,
  key: string,
  role: string,
  branchId: string | null,
): Promise<WorldUser> {
  const hashed = await bcrypt.hash(world.password, 10);
  const access = resolveCompanyAccess(role, [], null);
  const row = await prisma.user.create({ data: {
    email: `${world.prefix.toLowerCase()}.${key.toLowerCase()}@example.invalid`, password: hashed, name: `${TEST_NAME_PREFIX} ${role} ${key}`, role: role as never,
    branchId, accessibleCompanies: [...access.accessible], primaryCompany: access.primary,
  } });
  return { id: row.id, email: row.email, role, branchId, password: world.password };
}

/**
 * Same mechanism the settings UI uses (SystemConfig `accounting_permissions`,
 * JSON map userId → permissions). OWNER needs nothing; every other accounting
 * role gets exactly what is granted here — there is no role fallback.
 */
export async function grantAccountingPermissions(prisma: PrismaService, userId: string, permissions: AccountingPermission[]): Promise<void> {
  const previous = await prisma.systemConfig.findUnique({ where: { key: ACCOUNTING_PERMISSIONS_KEY } });
  const assignments = parseAccountingPermissions(previous?.deletedAt ? null : previous?.value);
  assignments[userId] = [...new Set([...(assignments[userId] ?? []), ...permissions])];
  await prisma.systemConfig.upsert({
    where: { key: ACCOUNTING_PERMISSIONS_KEY },
    update: { value: JSON.stringify(assignments), deletedAt: null },
    create: { key: ACCOUNTING_PERMISSIONS_KEY, value: JSON.stringify(assignments) },
  });
}

export async function setSystemConfig(prisma: PrismaService, key: string, value: string): Promise<void> {
  await prisma.systemConfig.upsert({ where: { key }, update: { value, deletedAt: null }, create: { key, value } });
}

/** Hard delete so every reader (findFirst deletedAt:null and findUnique alike) sees the default again. */
export async function clearSystemConfig(prisma: PrismaService, key: string): Promise<void> {
  await prisma.systemConfig.deleteMany({ where: { key } });
}

// ─── Independent money model ────────────────────────────────────────────────

export type Decimal = Prisma.Decimal;
const D = Prisma.Decimal;

export interface LineSpec {
  category: string;
  description?: string;
  quantity: number;
  unitPrice: number;
  discount?: number;
  vatPercent?: number;
  whtPercent?: number;
  whtFormType?: 'PND3' | 'PND53';
}

export interface LineMoney {
  amountBeforeVat: Decimal;
  vatAmount: Decimal;
  whtAmount: Decimal;
}

export interface DocumentMoney {
  subtotal: Decimal;
  vatAmount: Decimal;
  withholdingTax: Decimal;
  totalAmount: Decimal;
  netPayment: Decimal;
}

/** Thai VAT/WHT rounding: per line, 2 decimals, half-up. Price EXCLUSIVE of VAT unless stated. */
export function lineMoney(spec: LineSpec, priceType: 'EXCLUSIVE' | 'INCLUSIVE' = 'EXCLUSIVE'): LineMoney {
  const gross = new D(spec.quantity).mul(spec.unitPrice).minus(spec.discount ?? 0);
  const vatPct = new D(spec.vatPercent ?? 0);
  let amountBeforeVat: Decimal;
  let vatAmount: Decimal;
  if (priceType === 'EXCLUSIVE') {
    amountBeforeVat = gross;
    vatAmount = gross.mul(vatPct).div(100).toDecimalPlaces(2, D.ROUND_HALF_UP);
  } else {
    amountBeforeVat = gross.mul(100).div(new D(100).plus(vatPct)).toDecimalPlaces(2, D.ROUND_HALF_UP);
    vatAmount = gross.minus(amountBeforeVat);
  }
  const whtAmount = amountBeforeVat.mul(spec.whtPercent ?? 0).div(100).toDecimalPlaces(2, D.ROUND_HALF_UP);
  return { amountBeforeVat, vatAmount, whtAmount };
}

export function documentMoney(lines: LineMoney[]): DocumentMoney {
  const zero = new D(0);
  const subtotal = lines.reduce((sum, line) => sum.plus(line.amountBeforeVat), zero);
  const vatAmount = lines.reduce((sum, line) => sum.plus(line.vatAmount), zero);
  const withholdingTax = lines.reduce((sum, line) => sum.plus(line.whtAmount), zero);
  const totalAmount = subtotal.plus(vatAmount);
  return { subtotal, vatAmount, withholdingTax, totalAmount, netPayment: totalAmount.minus(withholdingTax) };
}

/** Petty cash lines are VAT-exclusive amounts with quantity 1 and never carry WHT. */
export function pettyCashLineMoney(amount: number, vatPercent = 0): LineMoney {
  return lineMoney({ category: '', quantity: 1, unitPrice: amount, vatPercent });
}

/** "20575" / "20575.00" / Decimal / number → "20575.00" so persisted rows and fixtures compare as strings. */
export function fixed2(value: unknown): string {
  return new D(String(value)).toFixed(2);
}

/** Same rendering the voucher uses (en-US grouping, two decimals) — "20,575.00". */
export function money(value: unknown): string {
  return Number(new D(String(value)).toFixed(2)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ─── Dates (Asia/Bangkok, Buddhist Era) ─────────────────────────────────────

/** Calendar date in Bangkok as YYYY-MM-DD, offset by whole days. */
export function bkkDate(offsetDays = 0): string {
  const at = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

/** dd/mm/BBBB — the voucher PDF date format. */
export function thaiShortDate(iso: string): string {
  const [year, month, day] = iso.split('-');
  return `${day}/${month}/${Number(year) + 543}`;
}

const THAI_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];

/** "11 กันยายน 2569" — the browser document header date format. */
export function thaiLongDate(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  return `${day} ${THAI_MONTHS[month - 1]} ${year + 543}`;
}
