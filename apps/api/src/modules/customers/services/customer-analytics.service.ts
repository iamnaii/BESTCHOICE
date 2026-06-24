import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { CustomerQueryService } from './customer-query.service';

/**
 * Read-only analytics / reporting slice of the decomposed CustomersService.
 *
 * Owns the $queryRaw reports + read aggregations with zero writes:
 * getReferralStats, getUpsellCandidates, getWatchList, getChatSummary,
 * getRiskFlag, getContracts. getContracts + getChatSummary share the
 * existence-guard via CustomerQueryService.findOne (the original called
 * `this.findOne(...)`); getRiskFlag does not guard.
 */
@Injectable()
export class CustomerAnalyticsService {
  constructor(
    private prisma: PrismaService,
    private readonly query: CustomerQueryService,
  ) {}

  async getReferralStats(limit = 10) {
    const rows = await this.prisma.$queryRaw<
      { referrerId: string; referrerName: string; referrerPhone: string; referralCount: number }[]
    >(Prisma.sql`
      SELECT
        ref.id AS "referrerId",
        ref.name AS "referrerName",
        ref.phone AS "referrerPhone",
        COUNT(c.id) AS "referralCount"
      FROM customers ref
      JOIN customers c ON c.referred_by_id = ref.id AND c.deleted_at IS NULL
      WHERE ref.deleted_at IS NULL
      GROUP BY ref.id, ref.name, ref.phone
      ORDER BY "referralCount" DESC
      LIMIT ${limit}
    `);

    return {
      total: rows.length,
      topReferrers: rows.map((r) => ({
        referrerId: r.referrerId,
        referrerName: r.referrerName,
        referrerPhone: r.referrerPhone,
        referralCount: Number(r.referralCount),
      })),
    };
  }

  async getContracts(id: string) {
    await this.query.findOne(id);
    return this.prisma.contract.findMany({
      where: { customerId: id, deletedAt: null },
      include: {
        product: { select: { id: true, name: true, brand: true, model: true } },
        branch: { select: { id: true, name: true } },
        _count: { select: { payments: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getRiskFlag(id: string) {
    const overdueContracts = await this.prisma.contract.findMany({
      where: {
        customerId: id,
        status: { in: ['OVERDUE', 'DEFAULT'] },
        deletedAt: null,
      },
      select: {
        id: true,
        contractNumber: true,
        status: true,
      },
    });

    return {
      hasRisk: overdueContracts.length > 0,
      riskLevel: overdueContracts.some((c) => c.status === 'DEFAULT') ? 'HIGH' : overdueContracts.length > 0 ? 'MEDIUM' : 'NONE',
      overdueContracts,
    };
  }

  async getUpsellCandidates(branchId?: string, limit = 20) {
    // Use raw SQL to compute paid ratio (paidInstallments / totalMonths)
    // Prisma ORM cannot HAVING on aggregate counts directly
    const branchFilter = branchId ? Prisma.sql`AND c.branch_id = ${branchId}` : Prisma.empty;

    const rows = await this.prisma.$queryRaw<
      {
        contractId: string;
        contractNumber: string;
        customerId: string;
        customerName: string;
        customerPhone: string;
        totalMonths: number;
        paidCount: number;
        paidRatio: number;
        contractStatus: string;
        hasExchangeHistory: boolean;
        productModel: string | null;
        monthlyPayment: number;
      }[]
    >(Prisma.sql`
      SELECT
        c.id AS "contractId",
        c.contract_number AS "contractNumber",
        cu.id AS "customerId",
        cu.name AS "customerName",
        cu.phone AS "customerPhone",
        c.total_months AS "totalMonths",
        COUNT(p.id) FILTER (WHERE p.status = 'PAID') AS "paidCount",
        ROUND(COUNT(p.id) FILTER (WHERE p.status = 'PAID')::numeric / NULLIF(c.total_months, 0), 3) AS "paidRatio",
        c.status AS "contractStatus",
        (c.parent_contract_id IS NOT NULL) AS "hasExchangeHistory",
        pr.model AS "productModel",
        c.monthly_payment AS "monthlyPayment"
      FROM contracts c
      JOIN customers cu ON cu.id = c.customer_id
      LEFT JOIN payments p ON p.contract_id = c.id
      LEFT JOIN products pr ON pr.id = c.product_id
      WHERE c.deleted_at IS NULL
        AND cu.deleted_at IS NULL
        AND c.status IN ('ACTIVE', 'COMPLETED')
        AND c.dunning_stage = 'NONE'
        ${branchFilter}
      GROUP BY c.id, cu.id, pr.model
      HAVING
        c.status = 'COMPLETED'
        OR (c.parent_contract_id IS NOT NULL)
        OR (
          COUNT(p.id) FILTER (WHERE p.status = 'PAID')::numeric / NULLIF(c.total_months, 0) >= 0.7
        )
      ORDER BY "paidRatio" DESC NULLS LAST, c.created_at DESC
      LIMIT ${limit}
    `);

    return {
      total: rows.length,
      candidates: rows.map((r) => ({
        contractId: r.contractId,
        contractNumber: r.contractNumber,
        customerId: r.customerId,
        customerName: r.customerName,
        customerPhone: r.customerPhone,
        totalMonths: Number(r.totalMonths),
        paidCount: Number(r.paidCount),
        paidRatio: Number(r.paidRatio),
        contractStatus: r.contractStatus,
        hasExchangeHistory: r.hasExchangeHistory,
        productModel: r.productModel,
        monthlyPayment: Number(r.monthlyPayment),
        reason:
          r.contractStatus === 'COMPLETED'
            ? 'ปิดสัญญาแล้ว'
            : r.hasExchangeHistory
              ? 'มีประวัติเปลี่ยนเครื่อง'
              : `ผ่อนแล้ว ${Math.round(Number(r.paidRatio) * 100)}%`,
      })),
    };
  }

  async getWatchList(branchId?: string, limit = 30) {
    const branchFilter = branchId ? Prisma.sql`AND c.branch_id = ${branchId}` : Prisma.empty;

    const rows = await this.prisma.$queryRaw<
      {
        customerId: string;
        customerName: string;
        customerPhone: string;
        contractId: string;
        contractNumber: string;
        latePaymentCount: number;
        partialPaymentCount: number;
        hadDunningReset: boolean;
        dunningStage: string;
        totalMonths: number;
        paidCount: number;
        nextDueDate: Date | null;
        nextAmountDue: number | null;
      }[]
    >(Prisma.sql`
      SELECT
        cu.id AS "customerId",
        cu.name AS "customerName",
        cu.phone AS "customerPhone",
        c.id AS "contractId",
        c.contract_number AS "contractNumber",
        COUNT(p.id) FILTER (
          WHERE p.paid_date IS NOT NULL AND p.paid_date::date > p.due_date::date
        ) AS "latePaymentCount",
        COUNT(p.id) FILTER (WHERE p.status = 'PARTIALLY_PAID') AS "partialPaymentCount",
        (c.dunning_last_action_at IS NOT NULL AND c.dunning_stage = 'NONE') AS "hadDunningReset",
        c.dunning_stage AS "dunningStage",
        c.total_months AS "totalMonths",
        COUNT(p.id) FILTER (WHERE p.status = 'PAID') AS "paidCount",
        MIN(p2.due_date) AS "nextDueDate",
        MIN(p2.amount_due) AS "nextAmountDue"
      FROM customers cu
      JOIN contracts c ON c.customer_id = cu.id AND c.deleted_at IS NULL
      LEFT JOIN payments p ON p.contract_id = c.id
      LEFT JOIN payments p2 ON p2.contract_id = c.id AND p2.status IN ('PENDING', 'OVERDUE')
      WHERE cu.deleted_at IS NULL
        AND c.status = 'ACTIVE'
        ${branchFilter}
      GROUP BY cu.id, c.id
      HAVING
        COUNT(p.id) FILTER (
          WHERE p.paid_date IS NOT NULL AND p.paid_date::date > p.due_date::date
        ) >= 2
        OR COUNT(p.id) FILTER (WHERE p.status = 'PARTIALLY_PAID') >= 1
        OR (c.dunning_last_action_at IS NOT NULL AND c.dunning_stage = 'NONE')
      ORDER BY
        (
          LEAST(COUNT(p.id) FILTER (
            WHERE p.paid_date IS NOT NULL AND p.paid_date::date > p.due_date::date
          ), 5)
          + COUNT(p.id) FILTER (WHERE p.status = 'PARTIALLY_PAID') * 2
          + CASE WHEN c.dunning_last_action_at IS NOT NULL AND c.dunning_stage = 'NONE' THEN 3 ELSE 0 END
        ) DESC
      LIMIT ${limit}
    `);

    const candidates = rows.map((r) => {
      const late = Number(r.latePaymentCount);
      const partial = Number(r.partialPaymentCount);
      const dunningReset = Boolean(r.hadDunningReset);
      const score = Math.min(late, 5) + partial * 2 + (dunningReset ? 3 : 0);
      const riskLevel: 'HIGH' | 'MEDIUM' | 'LOW' = score >= 5 ? 'HIGH' : score >= 3 ? 'MEDIUM' : 'LOW';

      const reasons: string[] = [];
      if (late >= 2) reasons.push(`ชำระล่าช้า ${late} ครั้ง`);
      if (partial >= 1) reasons.push(`จ่ายไม่ครบ ${partial} ครั้ง`);
      if (dunningReset) reasons.push('เคยถูกติดตามหนี้แล้ว reset');

      return {
        customerId: r.customerId,
        customerName: r.customerName,
        customerPhone: r.customerPhone,
        contractId: r.contractId,
        contractNumber: r.contractNumber,
        riskScore: score,
        riskLevel,
        reasons,
        latePaymentCount: late,
        partialPaymentCount: partial,
        hadDunningReset: dunningReset,
        totalMonths: Number(r.totalMonths),
        paidCount: Number(r.paidCount),
        nextDueDate: r.nextDueDate,
        nextAmountDue: r.nextAmountDue ? Number(r.nextAmountDue) : null,
      };
    });

    return {
      total: candidates.length,
      watchList: candidates,
    };
  }

  async getChatSummary(customerId: string) {
    // Verify customer exists
    await this.query.findOne(customerId);

    // 1. Recent installments grouped from the last 5 distinct paymentIds with
    //    a non-voided receipt. Returns each installment with all of its
    //    non-voided receipts so the UI can show partial-payment breakdowns
    //    (1 งวด → N partials).
    const recentReceipts = await this.prisma.receipt.findMany({
      where: {
        contract: { customerId, deletedAt: null },
        deletedAt: null,
        isVoided: false,
        paymentId: { not: null },
      },
      orderBy: { paidDate: 'desc' },
      take: 30, // over-fetch so grouping yields up to 5 distinct installments
      select: {
        id: true,
        receiptNumber: true,
        amount: true,
        paidDate: true,
        paymentMethod: true,
        installmentNo: true,
        paymentId: true,
        contract: { select: { contractNumber: true } },
      },
    });

    const paymentIds = Array.from(
      new Set(recentReceipts.map((r) => r.paymentId).filter((id): id is string => !!id)),
    ).slice(0, 5);

    const payments = paymentIds.length
      ? await this.prisma.payment.findMany({
          where: { id: { in: paymentIds } },
          select: {
            id: true,
            installmentNo: true,
            amountDue: true,
            amountPaid: true,
            status: true,
            contract: { select: { contractNumber: true } },
          },
        })
      : [];
    const paymentMap = new Map(payments.map((p) => [p.id, p]));

    const recentPayments = paymentIds
      .map((pid) => {
        const p = paymentMap.get(pid);
        if (!p) return null;
        const partials = recentReceipts
          .filter((r) => r.paymentId === pid)
          .map((r) => ({
            id: r.id,
            receiptNumber: r.receiptNumber,
            amount: r.amount,
            paidDate: r.paidDate,
            paymentMethod: r.paymentMethod,
          }));
        return {
          id: p.id,
          installmentNo: p.installmentNo,
          amountDue: p.amountDue,
          amountPaid: p.amountPaid,
          status: p.status,
          contract: p.contract,
          partials,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    // 2. Overdue summary
    const overduePayments = await this.prisma.payment.count({
      where: {
        contract: { customerId, deletedAt: null },
        deletedAt: null,
        status: { in: ['PENDING', 'OVERDUE'] },
        dueDate: { lt: new Date() },
      },
    });

    const totalOutstanding = await this.prisma.payment.aggregate({
      where: {
        contract: { customerId, deletedAt: null },
        deletedAt: null,
        status: { in: ['PENDING', 'OVERDUE'] },
      },
      _sum: { amountDue: true },
    });

    // 3. Active contracts with product info
    const activeContracts = await this.prisma.contract.findMany({
      where: { customerId, deletedAt: null, status: { in: ['ACTIVE', 'OVERDUE', 'DEFAULT'] } },
      select: {
        id: true,
        contractNumber: true,
        status: true,
        monthlyPayment: true,
        totalMonths: true,
        // MDM lock + warranty state drive the Customer360 panel badges; without
        // these the UI silently shows "ไม่ได้ล็อค" / "หมดประกัน" for every contract.
        mdmLockedAt: true,
        shopWarrantyEndDate: true,
        product: {
          select: { name: true, brand: true, model: true, serialNumber: true, warrantyExpireDate: true },
        },
        payments: {
          where: { deletedAt: null },
          select: { status: true, dueDate: true },
          orderBy: { installmentNo: 'asc' },
        },
      },
    });

    // Compute per-contract paid/total/next due
    const contractSummaries = activeContracts.map((c) => {
      const paid = c.payments.filter((p) => p.status === 'PAID').length;
      const nextDue = c.payments.find((p) => p.status !== 'PAID');
      return {
        id: c.id,
        contractNumber: c.contractNumber,
        status: c.status,
        monthlyPayment: c.monthlyPayment,
        product: c.product,
        paidInstallments: paid,
        totalInstallments: c.totalMonths,
        nextDueDate: nextDue?.dueDate ?? null,
        serialNumber: c.product?.serialNumber ?? null,
        mdmLockedAt: c.mdmLockedAt,
        shopWarrantyEndDate: c.shopWarrantyEndDate,
      };
    });

    // 4. Call logs across all contracts (last 5)
    const callLogs = await this.prisma.callLog.findMany({
      where: {
        contract: { customerId, deletedAt: null },
      },
      orderBy: { calledAt: 'desc' },
      take: 5,
      select: {
        id: true,
        calledAt: true,
        result: true,
        notes: true,
        caller: { select: { name: true } },
        contract: { select: { contractNumber: true } },
      },
    });

    // 5. Previous chat rooms (all channels)
    const chatRooms = await this.prisma.chatRoom.findMany({
      where: { customerId, deletedAt: null },
      orderBy: { lastMessageAt: 'desc' },
      take: 10,
      select: {
        id: true,
        channel: true,
        status: true,
        totalMessages: true,
        lastMessageAt: true,
        createdAt: true,
        assignedTo: { select: { name: true } },
      },
    });

    return {
      recentPayments,
      overdueCount: overduePayments,
      totalOutstanding: totalOutstanding._sum.amountDue ?? 0,
      activeContracts: contractSummaries,
      callLogs,
      chatRooms,
    };
  }
}
