import * as bcrypt from 'bcrypt';
import { Prisma } from '@prisma/client';
import { resolveCompanyAccess } from '@installment/shared';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { TEST_NAME_PREFIX } from '../../../src/utils/test-data-markers';
import { DocumentsWorld, WorldUser } from './fixtures';

/**
 * DOC-04 (issue #1563) domain fixtures — payroll employees in the employee
 * registry (linked payroll lines derive name / tax id from it) and the
 * independent money model of a payroll line and an annual 50 ทวิ summary.
 */

const D = Prisma.Decimal;

export interface EmployeeFixture {
  user: WorldUser;
  /** The tax id the payroll snapshot must carry (profile override wins over the national id). */
  taxId: string;
  nationalId: string;
  bank: { bankName: string; bankAccountNo: string } | null;
}

/** Synthetic national id: 13 digits starting with 7 (never a real citizen pattern). */
export function syntheticEmployeeId(seed: number): string {
  return `7${String(Date.now()).slice(-8)}${String(seed).padStart(4, '0')}`;
}

/**
 * User (any staff role) + EmployeeProfile, the shape `preparePayrollInput`
 * resolves for a linked line (`userId`): active, not soft-deleted, not resigned.
 */
export async function createEmployee(
  prisma: PrismaService,
  world: DocumentsWorld,
  key: string,
  input: { branchId: string | null; role?: string; nationalId: string; taxIdOverride?: string; position?: string; baseSalary?: number; bank?: { bankName: string; bankAccountNo: string } | null; resignedDate?: Date },
): Promise<EmployeeFixture> {
  const role = input.role ?? 'SALES';
  const hashed = await bcrypt.hash(world.password, 10);
  const access = resolveCompanyAccess(role, [], null);
  const user = await prisma.user.create({ data: {
    email: `${world.prefix.toLowerCase()}.${key.toLowerCase()}@example.invalid`, password: hashed, name: `${TEST_NAME_PREFIX} พนักงาน ${key}`, role: role as never,
    branchId: input.branchId, nationalId: input.nationalId, accessibleCompanies: [...access.accessible], primaryCompany: access.primary,
  } });
  await prisma.employeeProfile.create({ data: {
    userId: user.id, position: input.position ?? 'พนักงานขาย', baseSalary: input.baseSalary == null ? null : new D(input.baseSalary), ssoEligible: true,
    taxIdOverride: input.taxIdOverride ?? null, bankName: input.bank?.bankName ?? null, bankAccountNo: input.bank?.bankAccountNo ?? null, resignedDate: input.resignedDate ?? null,
  } });
  return {
    user: { id: user.id, email: user.email, role, branchId: input.branchId, password: world.password },
    taxId: input.taxIdOverride ?? input.nationalId,
    nationalId: input.nationalId,
    bank: input.bank ?? null,
  };
}

// ─── Independent money model ────────────────────────────────────────────────

export interface PayrollLineSpec {
  baseSalary: number;
  ssoEmployee?: number;
  whtAmount?: number;
  customIncome?: Array<{ accountCode: string; name: string; amount: number; isTaxable?: boolean }>;
  customDeduction?: Array<{ accountCode: string; name: string; amount: number }>;
}

export interface PayrollLineMoney {
  base: Prisma.Decimal;
  sso: Prisma.Decimal;
  wht: Prisma.Decimal;
  income: Prisma.Decimal;
  taxableIncome: Prisma.Decimal;
  deduction: Prisma.Decimal;
  /** base + income − sso − wht − deduction — the cash the employee receives. */
  net: Prisma.Decimal;
  /** base + taxable income — the ภ.ง.ด.1 / 50 ทวิ income figure. */
  gross: Prisma.Decimal;
}

export function payrollLineMoney(spec: PayrollLineSpec): PayrollLineMoney {
  const zero = new D(0);
  const base = new D(spec.baseSalary);
  const sso = new D(spec.ssoEmployee ?? 0);
  const wht = new D(spec.whtAmount ?? 0);
  const income = (spec.customIncome ?? []).reduce((sum, row) => sum.plus(row.amount), zero);
  const taxableIncome = (spec.customIncome ?? []).filter((row) => row.isTaxable !== false).reduce((sum, row) => sum.plus(row.amount), zero);
  const deduction = (spec.customDeduction ?? []).reduce((sum, row) => sum.plus(row.amount), zero);
  return { base, sso, wht, income, taxableIncome, deduction, net: base.plus(income).minus(sso).minus(wht).minus(deduction), gross: base.plus(taxableIncome) };
}

export interface PayrollDocMoney {
  subtotal: Prisma.Decimal;
  sso: Prisma.Decimal;
  wht: Prisma.Decimal;
  net: Prisma.Decimal;
  /** Dr per custom income account and Cr per custom deduction account, aggregated across lines. */
  incomeByAccount: Record<string, string>;
  deductionByAccount: Record<string, string>;
}

export function payrollDocMoney(lines: PayrollLineSpec[]): PayrollDocMoney {
  const zero = new D(0);
  const money = lines.map(payrollLineMoney);
  const incomeByAccount: Record<string, Prisma.Decimal> = {};
  const deductionByAccount: Record<string, Prisma.Decimal> = {};
  for (const line of lines) {
    for (const row of line.customIncome ?? []) incomeByAccount[row.accountCode] = (incomeByAccount[row.accountCode] ?? zero).plus(row.amount);
    for (const row of line.customDeduction ?? []) deductionByAccount[row.accountCode] = (deductionByAccount[row.accountCode] ?? zero).plus(row.amount);
  }
  const fixed = (map: Record<string, Prisma.Decimal>) => Object.fromEntries(Object.entries(map).map(([code, amount]) => [code, amount.toFixed(2)]));
  return {
    subtotal: money.reduce((sum, line) => sum.plus(line.base), zero),
    sso: money.reduce((sum, line) => sum.plus(line.sso), zero),
    wht: money.reduce((sum, line) => sum.plus(line.wht), zero),
    net: money.reduce((sum, line) => sum.plus(line.net), zero),
    incomeByAccount: fixed(incomeByAccount),
    deductionByAccount: fixed(deductionByAccount),
  };
}

/**
 * POST /auth/login is throttled 10/min per IP and every API session plus every
 * Playwright context of a run share one IP — pace logins so none lands on a 429.
 */
export function createLoginPacer(limit = 9, windowMs = 65_000) {
  const times: number[] = [];
  return async () => {
    for (;;) {
      const now = Date.now();
      while (times.length && now - times[0] > windowMs) times.shift();
      if (times.length < limit) break;
      await new Promise((resolve) => setTimeout(resolve, times[0] + windowMs - now + 250));
    }
    times.push(Date.now());
  };
}
