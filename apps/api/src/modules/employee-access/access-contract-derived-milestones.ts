import type { ContractMilestonesRead } from '@installment/shared';
import { Prisma } from '@prisma/client';
import { PartyQueryPlan } from './access-party-query-plan';
import { categoryAvailability, derivedLabels } from './access-contract-derived-children';

export function milestoneMonth() {
  const now = new Date();
  // Preserve the existing service-local month definition. Changing the accounting
  // calendar is a separate business change, not an authorization repair.
  return {
    gte: new Date(now.getFullYear(), now.getMonth(), 1),
    lte: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999),
  };
}
export async function contractDerivedMilestones(
  plan: PartyQueryPlan,
  where: Prisma.ContractWhereInput,
  month: ReturnType<typeof milestoneMonth>,
): Promise<ContractMilestonesRead> {
  const availability = categoryAvailability(plan, 'payments.read');
  const metadata = {
    scope: 'authorized-sources' as const,
    totalScope: 'authorized-sources' as const,
    previewLimit: 5 as const,
    availability: { newThisMonth: availability, completingThisMonth: availability },
  };
  if (availability === 'UNAVAILABLE')
    return {
      ...metadata,
      newThisMonth: { count: null, totalAmount: null },
      completingThisMonth: { count: null, totalAmount: null },
      recentNewContracts: null,
      finalInstallmentsThisMonth: null,
    };
  const db = plan.db;
  const [newContracts, candidates] = await Promise.all([
    db.contract.findMany({
      where: { AND: [where, { createdAt: month, status: { notIn: ['DRAFT', 'CANCELED'] } }] },
      select: {
        id: true,
        contractNumber: true,
        customerId: true,
        financedAmount: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    }),
    db.payment.findMany({
      where: {
        deletedAt: null,
        status: { in: ['PENDING', 'OVERDUE'] },
        dueDate: month,
        contract: { AND: [where, { status: 'ACTIVE' }] },
      },
      select: {
        id: true,
        contractId: true,
        installmentNo: true,
        amountDue: true,
        dueDate: true,
        contract: {
          select: { id: true, contractNumber: true, customerId: true, totalMonths: true },
        },
      },
      orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
    }),
  ]);
  const maxima = await db.payment.groupBy({
    by: ['contractId'],
    where: {
      contractId: { in: [...new Set(candidates.map((row) => row.contractId))] },
      deletedAt: null,
      contract: where,
    },
    _max: { installmentNo: true },
  });
  const maxById = new Map(maxima.map((row) => [row.contractId, row._max.installmentNo]));
  const finals = candidates.filter((row) => row.installmentNo === maxById.get(row.contractId));
  const labels = await derivedLabels(plan, [
    ...newContracts.slice(0, 5),
    ...finals.slice(0, 5).map((row) => row.contract),
  ]);
  return {
    ...metadata,
    newThisMonth: {
      count: newContracts.length,
      totalAmount: newContracts
        .reduce((sum, row) => sum.plus(row.financedAmount), new Prisma.Decimal(0))
        .toNumber(),
    },
    completingThisMonth: {
      count: new Set(finals.map((row) => row.contractId)).size,
      totalAmount: finals
        .reduce((sum, row) => sum.plus(row.amountDue), new Prisma.Decimal(0))
        .toNumber(),
    },
    recentNewContracts: newContracts
      .slice(0, 5)
      .map((row) => ({
        id: row.id,
        contractNumber: row.contractNumber,
        customerName: labels.customers.get(row.customerId)?.name ?? null,
        financedAmount: row.financedAmount.toNumber(),
        createdAt: row.createdAt.toISOString(),
      })),
    finalInstallmentsThisMonth: finals
      .slice(0, 5)
      .map((row) => ({
        paymentId: row.id,
        contractId: row.contractId,
        contractNumber: row.contract.contractNumber,
        customerName: labels.customers.get(row.contract.customerId)?.name ?? null,
        dueDate: row.dueDate.toISOString(),
        amountDue: row.amountDue.toNumber(),
        installmentNo: row.installmentNo,
        totalMonths: row.contract.totalMonths,
      })),
  };
}
