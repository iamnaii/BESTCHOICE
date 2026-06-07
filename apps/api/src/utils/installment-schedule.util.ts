import { Prisma } from '@prisma/client';

/**
 * Single source of truth for `installment_schedules` row generation.
 *
 * The exact per-installment values + rounding modes below MUST match the CPA
 * 2A/2B journal templates (see `.claude/rules/accounting.md` → Rounding Modes),
 * otherwise the receipt JE base diverges from the schedule and golden fixtures
 * fail:
 *   principal = financedAmount / totalMonths  (ROUND_DOWN truncate)
 *   interest  = interestTotal  / totalMonths  (ROUND_HALF_UP)
 *   amountDue = monthlyPayment (incl. VAT)
 *   dueDate   = createdAt month + i, on paymentDueDay (default = createdAt day)
 *
 * Historically this algorithm was copy-pasted in three places
 * (contract-workflow activation, the backfill CLI, and the lazy-gen recovery
 * path). They are now consolidated here so the schedule is identical no matter
 * which flow first materialises it.
 */
export interface ScheduleSourceContract {
  id: string;
  totalMonths: number;
  financedAmount: Prisma.Decimal | string | number;
  interestTotal: Prisma.Decimal | string | number | null;
  monthlyPayment: Prisma.Decimal | string | number | null;
  paymentDueDay: number | null;
  createdAt: Date;
}

export function buildInstallmentScheduleRows(
  c: ScheduleSourceContract,
): Prisma.InstallmentScheduleCreateManyInput[] {
  if (c.totalMonths <= 0) return [];

  const financed = new Prisma.Decimal(c.financedAmount.toString());
  const interest = new Prisma.Decimal((c.interestTotal ?? 0).toString());
  const monthly = new Prisma.Decimal((c.monthlyPayment ?? 0).toString());
  const principalPerInst = financed
    .div(c.totalMonths)
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_DOWN);
  const interestPerInst = interest
    .div(c.totalMonths)
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

  const baseDate = c.createdAt;
  const dueDay = c.paymentDueDay ?? baseDate.getDate();

  const rows: Prisma.InstallmentScheduleCreateManyInput[] = [];
  for (let i = 1; i <= c.totalMonths; i++) {
    const dueDate = new Date(baseDate.getFullYear(), baseDate.getMonth() + i, dueDay);
    rows.push({
      contractId: c.id,
      installmentNo: i,
      dueDate,
      principal: principalPerInst,
      interest: interestPerInst,
      amountDue: monthly,
    });
  }
  return rows;
}

/**
 * Idempotent in-transaction ensure: generates the contract's
 * `installment_schedules` rows if (and only if) none exist yet. Safe to call
 * from any flow — activation, payment-receipt recovery, or backfill — because
 * it short-circuits when rows are already present (`count > 0`).
 *
 * Returns the number of rows generated (0 = already existed, or ungeneratable
 * because `totalMonths <= 0`). The caller must re-query the schedule after this
 * returns; this helper deliberately does not return the rows so the caller's
 * existing lookup remains the source of truth inside its own transaction.
 *
 * MUST be passed a transaction client so the generation is atomic with the
 * caller's financial write (e.g. the PAID flip + receipt JE).
 */
export async function ensureInstallmentSchedules(
  tx: Prisma.TransactionClient,
  contractId: string,
): Promise<{ generated: number }> {
  const existing = await tx.installmentSchedule.count({
    where: { contractId, deletedAt: null },
  });
  if (existing > 0) return { generated: 0 };

  const c = await tx.contract.findUniqueOrThrow({
    where: { id: contractId },
    select: {
      id: true,
      totalMonths: true,
      financedAmount: true,
      interestTotal: true,
      monthlyPayment: true,
      paymentDueDay: true,
      createdAt: true,
    },
  });

  const rows = buildInstallmentScheduleRows(c);
  if (rows.length === 0) return { generated: 0 };

  await tx.installmentSchedule.createMany({ data: rows });
  return { generated: rows.length };
}
