import { PrismaClient } from '@prisma/client';
import { CreditCheckOverrideService } from '../../credit-check/services/credit-check-override.service';
import { generatePaymentSchedule } from '../../../utils/installment.util';

/** Synthetic evidence for a fresh review; no AI provider or private documents are used. */
export function seedStatementReview(prisma: PrismaClient, customerId: string, contractId?: string) {
  return prisma.creditCheck.create({
    data: {
      customerId,
      contractId,
      checkType: 'FULL',
      status: 'MANUAL_REVIEW',
      statementFiles: ['synthetic://integration-statement.pdf'],
      aiAnalysis: { monthlyIncome: 50000, monthlyExpense: 10000 },
    },
  });
}

/** Keep product-guard fixtures valid at the real credit gate before exercising product transitions. */
export async function seedVerifiedContractApproval(
  prisma: PrismaClient,
  contractId: string,
  approvedById: string,
) {
  const contract = await prisma.contract.findUniqueOrThrow({ where: { id: contractId } });
  if (!contract.paymentDueDay) throw new Error('Fixture contract must specify a payment due day');
  const breakdown = {
    principal: Number(contract.financedAmount),
    storeCommission: Number(contract.storeCommission),
    interestTotal: Number(contract.interestTotal),
    vatAmount: Number(contract.vatAmount),
  };
  const total = contract.financedAmount
    .plus(contract.storeCommission ?? 0)
    .plus(contract.interestTotal)
    .plus(contract.vatAmount ?? 0);
  await prisma.payment.createMany({
    data: generatePaymentSchedule(
      contractId,
      contract.totalMonths,
      total.toNumber(),
      Number(contract.monthlyPayment),
      contract.paymentDueDay,
      breakdown,
    ),
  });
  const check = await seedStatementReview(prisma, contract.customerId, contractId);
  const overrides = new CreditCheckOverrideService(prisma as never);
  const basis = {
    verifiedMonthlyIncome: 50000,
    livingExpenses: 10000,
    externalMonthlyDebt: 0,
    salaryPayDay: contract.paymentDueDay,
    evidenceNotes:
      'Synthetic verified income, expenses, debt and payday for product lifecycle integration.',
  };
  const preview = await overrides.approval.preview(check.id, basis, {
    id: approvedById,
    role: 'OWNER',
  });
  await overrides.overrideById(
    check.id,
    {
      status: 'APPROVED',
      overrideReason: 'Verified synthetic affordability before exercising the product lifecycle',
      affordability: {
        ...basis,
        contextToken: preview.contextToken,
        approvedMonthlyPayment: 3000,
        confirmed: true,
      },
    },
    approvedById,
    'OWNER',
  );
}
