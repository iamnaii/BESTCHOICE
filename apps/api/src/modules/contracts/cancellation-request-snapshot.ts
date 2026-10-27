import { ForbiddenException } from '@nestjs/common';
import { Contract, Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { creditSnapshot } from '../trade-in/services/trade-in-credit.service';

export function cancellationFingerprint(value: unknown): string {
  return createHash('sha256')
    .update(
      JSON.stringify(value, (_k, v) =>
        v && typeof v === 'object' && !Array.isArray(v)
          ? Object.fromEntries(
              Object.keys(v)
                .sort()
                .map((key) => [key, v[key]]),
            )
          : v,
      ),
    )
    .digest('hex');
}
const bound = <T>(rows: T[]) => {
  if (rows.length > 10000) throw new ForbiddenException('ไม่สามารถดำเนินการกับชุดข้อมูลนี้');
  return rows;
};
const order = { orderBy: { id: 'asc' as const }, take: 10001 };
/** Private, explicit canonical decision inputs. No arbitrary metadata/object graph.
 * createdAt/generatedAt below are genuine commission membership inputs. */
export async function captureCancellationSnapshot(
  tx: Prisma.TransactionClient,
  c: Contract,
  binding: {
    cancellationId: string;
    contractId: string;
    requestedById: string;
    reason: string;
    refundAmount: '0.00';
  },
) {
  const id = c.id;
  const products = bound(
    await tx.product.findMany({
      where: { id: { in: [c.productId, ...c.bundleProductIds] } },
      ...order,
      select: { id: true, branchId: true, ownedByCompanyId: true, status: true, deletedAt: true },
    }),
  );
  const customer = await tx.customer.findUnique({
    where: { id: c.customerId },
    select: { id: true, deletedAt: true, mergedIntoId: true },
  });
  const branch = await tx.branch.findUniqueOrThrow({
    where: { id: c.branchId },
    select: { id: true, companyId: true, isActive: true, deletedAt: true },
  });
  const books = await tx.companyInfo.findMany({
    where: { companyCode: { in: ['SHOP', 'FINANCE'] } },
    orderBy: { id: 'asc' },
    select: { id: true, companyCode: true, isActive: true, deletedAt: true },
  });
  const payments = bound(
    await tx.payment.findMany({
      where: { contractId: id },
      ...order,
      select: { id: true, status: true, amountPaid: true, deletedAt: true },
    }),
  );
  const schedules = bound(
    await tx.installmentSchedule.findMany({
      where: { contractId: id },
      ...order,
      select: { id: true, deletedAt: true },
    }),
  );
  const interco = bound(
    await tx.interCoSettlementItem.findMany({
      where: { contractId: id },
      ...order,
      select: {
        id: true,
        batchId: true,
        itemType: true,
        financedGl: true,
        commissionGl: true,
        shopFinancedGl: true,
        shopCommissionGl: true,
        swapCreditAmount: true,
        recallAmount: true,
        deviceReturnAmount: true,
        deletedAt: true,
        batch: {
          select: {
            id: true,
            status: true,
            deletedAt: true,
            financeJournalEntryId: true,
            shopJournalEntryId: true,
          },
        },
      },
    }),
  );
  const sales = bound(
    await tx.sale.findMany({
      where: { contractId: id },
      ...order,
      select: {
        id: true,
        branchId: true,
        deletedAt: true,
        onlineOrderId: true,
        bundleProductIds: true,
      },
    }),
  );
  const saleIds = sales.map((s) => s.id);
  const receivables = bound(
    await tx.financeReceivable.findMany({
      where: { saleId: { in: saleIds } },
      ...order,
      select: {
        id: true,
        saleId: true,
        branchId: true,
        status: true,
        receivedAmount: true,
        deletedAt: true,
      },
    }),
  );
  const intercompany = bound(
    await tx.interCompanyTransaction.findMany({
      where: { OR: [{ contractId: id }, { saleId: { in: saleIds } }] },
      ...order,
      select: {
        id: true,
        contractId: true,
        saleId: true,
        branchId: true,
        status: true,
        fromCompanyId: true,
        toCompanyId: true,
        journalEntryId: true,
        reconciledAt: true,
        deletedAt: true,
      },
    }),
  );
  const bookings = bound(
    await tx.booking.findMany({
      where: { convertedToSaleId: { in: saleIds } },
      ...order,
      select: { id: true, convertedToSaleId: true, branchId: true, deletedAt: true },
    }),
  );
  const commissions = bound(
    await tx.salesCommission.findMany({
      where: { OR: [{ contractId: id }, { saleId: { in: saleIds } }] },
      ...order,
      select: {
        id: true,
        contractId: true,
        saleId: true,
        salespersonId: true,
        period: true,
        status: true,
        createdAt: true,
        paidAt: true,
        paidAmount: true,
        deletedAt: true,
      },
    }),
  );
  const payouts = commissions.length
    ? bound(
        await tx.commissionPayout.findMany({
          where: {
            OR: commissions.map((c) => ({ salespersonId: c.salespersonId, period: c.period })),
          },
          ...order,
          select: {
            id: true,
            salespersonId: true,
            period: true,
            status: true,
            generatedAt: true,
            deletedAt: true,
          },
        }),
      )
    : [];
  const provisions = bound(
    await tx.badDebtProvision.findMany({
      where: { contractId: id },
      ...order,
      select: { id: true, status: true, deletedAt: true },
    }),
  );
  const repossessions = bound(
    await tx.repossession.findMany({
      where: { productId: c.productId },
      ...order,
      select: {
        id: true,
        contractId: true,
        productId: true,
        status: true,
        soldContractId: true,
        deletedAt: true,
      },
    }),
  );
  const repossessionOrigins = await tx.contract.findMany({
    where: {
      id: {
        in: repossessions
          .filter((r) => r.status === 'SOLD' && !r.deletedAt)
          .map((r) => r.contractId),
      },
    },
    orderBy: { id: 'asc' },
    select: { id: true, branchId: true, deletedAt: true },
  });
  const credit = creditSnapshot(c.tradeInCreditSnapshot);
  const redemption = credit
    ? await tx.tradeInCreditRedemption.findUnique({
        where: { id: credit.redemptionId },
        select: {
          id: true,
          tradeInId: true,
          contractId: true,
          saleId: true,
          baseAmount: true,
          bonusAmount: true,
          applicationJournalEntryId: true,
          releasedAt: true,
        },
      })
    : null;
  const trade = credit
    ? await tx.tradeIn.findUnique({
        where: { id: credit.tradeInId },
        select: {
          id: true,
          branchId: true,
          customerId: true,
          productId: true,
          currentRedemptionId: true,
          deletedAt: true,
        },
      })
    : null;
  const journal = bound(
    await tx.journalEntry.findMany({
      where: {
        OR: [
          { metadata: { path: ['contractId'], equals: id } },
          ...(c.inputVatJournalEntryId ? [{ id: c.inputVatJournalEntryId }] : []),
          ...(redemption?.applicationJournalEntryId
            ? [{ id: redemption.applicationJournalEntryId }]
            : []),
        ],
      },
      ...order,
      select: {
        id: true,
        companyId: true,
        status: true,
        deletedAt: true,
        metadata: true,
        lines: {
          orderBy: { id: 'asc' },
          select: { id: true, accountCode: true, debit: true, credit: true, deletedAt: true },
        },
      },
    }),
  );
  for (const row of journal) bound(row.lines);
  const snapshot = {
    version: 1,
    binding,
    contract: {
      id,
      branchId: c.branchId,
      customerId: c.customerId,
      productId: c.productId,
      bundleProductIds: [...c.bundleProductIds].sort(),
      status: c.status,
      workflowStatus: c.workflowStatus,
      sellingPrice: c.sellingPrice,
      downPayment: c.downPayment,
      financedAmount: c.financedAmount,
      interestTotal: c.interestTotal,
      storeCommission: c.storeCommission,
      vatAmount: c.vatAmount,
      advanceBalance: c.advanceBalance,
      creditBalance: c.creditBalance,
      rescheduleAdvanceBalance: c.rescheduleAdvanceBalance,
      inputVatStatus: c.inputVatStatus,
      inputVatAmount: c.inputVatAmount,
      inputVatJournalEntryId: c.inputVatJournalEntryId,
      tradeCredit: credit
        ? {
            redemptionId: credit.redemptionId,
            tradeInId: credit.tradeInId,
            baseAmount: credit.baseAmount,
            bonusAmount: credit.bonusAmount,
            cashDownAmount: credit.cashDownAmount,
            totalDownAmount: credit.totalDownAmount,
          }
        : null,
    },
    source: { branch, books, customer, products },
    payments,
    schedules,
    interco,
    sales,
    receivables,
    intercompany,
    bookings,
    commissions,
    payouts,
    provisions,
    repossessions,
    repossessionOrigins,
    redemption,
    trade,
    journal: journal.map((row) => {
      const m = (row.metadata ?? {}) as Record<string, unknown>;
      return {
        id: row.id,
        companyId: row.companyId,
        status: row.status,
        deleted: !!row.deletedAt,
        metadata: Object.fromEntries(
          [
            'contractId',
            'tag',
            'flow',
            'reversed',
            'shopReceivableType',
            'collectedByShop',
            'shopReceivable',
          ].map((k) => [k, typeof m[k] === 'string' || typeof m[k] === 'boolean' ? m[k] : null]),
        ),
        lines: row.lines,
      };
    }),
  };
  // Prisma Decimal/Date are serialized to stable strings, never binary values.
  return JSON.parse(JSON.stringify(snapshot)) as Prisma.InputJsonObject;
}
