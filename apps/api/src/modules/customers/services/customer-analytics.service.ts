import { outstandingOf, UNPAID_INSTALLMENT_WHERE } from '../../contracts/contract-outstanding';
import { currentPartyQuery } from '../../employee-access/access-party-query-plan';
import { domainAccessClient } from '../../employee-access/access-execution-context';
import { calculatePaymentWatchRisk } from '../../../utils/payment-watch-risk.util';
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
    private basePrisma: PrismaService,
    private readonly query: CustomerQueryService,
  ) {}

  private get prisma() {
    return domainAccessClient(this.basePrisma);
  }

  async getReferralStats(limit = 10) {
    const plan = currentPartyQuery();
    const visible = plan
      ? (await this.prisma.customer.findMany({ where: plan.customer, select: { id: true } })).map(
          (r) => r.id,
        )
      : [];
    const identityScope = plan
      ? Prisma.sql`AND ref.id = ANY(${visible}::text[]) AND c.id = ANY(${visible}::text[])`
      : Prisma.empty;
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
        ${identityScope}
      GROUP BY ref.id, ref.name, ref.phone
      ORDER BY "referralCount" DESC
      LIMIT ${limit}
    `);

    const contacts = plan
      ? await this.query.managedContactViews(rows.map((r) => r.referrerId))
      : undefined;
    return {
      total: rows.length,
      ...(plan ? { availability: { referrals: 'scoped' as const } } : {}),
      topReferrers: rows.map((r) => ({
        referrerId: r.referrerId,
        referrerName: r.referrerName,
        referrerPhone: contacts ? (contacts.get(r.referrerId)?.phone ?? null) : r.referrerPhone,
        referralCount: Number(r.referralCount),
      })),
    };
  }

  async getContracts(id: string) {
    const plan = currentPartyQuery();
    if (plan) {
      await plan.assertCustomer(id);
      const rows = await this.prisma.contract.findMany({
        where: { customerId: id, AND: plan.contract },
        select: {
          id: true,
          contractNumber: true,
          status: true,
          createdAt: true,
          monthlyPayment: true,
          totalMonths: true,
          sellingPrice: true,
          downPayment: true,
          financedAmount: true,
          interestTotal: true,
          product: { select: { id: true, name: true, brand: true, model: true } },
          branch: { select: { id: true, name: true } },
          _count: { select: { payments: { where: plan.payment } } },
        },
        orderBy: { createdAt: 'desc' },
      });
      const contracts = await Promise.all(
        rows.map(async (row) => ({
          ...row,
          product: await plan.productView(row.product),
          _count: {
            payments: (await plan.contractAllows(row.id, 'payments.read'))
              ? row._count.payments
              : null,
          },
          availability: {
            contracts: 'scoped' as const,
            payments: (await plan.contractAllows(row.id, 'payments.read'))
              ? ('scoped' as const)
              : ('unavailable' as const),
          },
        })),
      );
      return { contracts, availability: { contracts: plan.coverage('contracts.read') } };
    }
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
    const plan = currentPartyQuery();
    if (plan) await plan.assertCustomer(id);
    const overdueContracts = await this.prisma.contract.findMany({
      where: {
        customerId: id,
        ...(plan ? { AND: plan.contract } : {}),
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
      hasRisk: plan && !plan.has('contracts.read', 'FINANCE') ? null : overdueContracts.length > 0,
      riskLevel:
        plan && !plan.has('contracts.read', 'FINANCE')
          ? null
          : overdueContracts.some((c) => c.status === 'DEFAULT')
            ? 'HIGH'
            : overdueContracts.length > 0
              ? 'MEDIUM'
              : 'NONE',
      overdueContracts,
      ...(plan ? { availability: { contracts: plan.coverage('contracts.read') } } : {}),
    };
  }

  private async reportScope(branchId: string | undefined, kind: 'upsell' | 'watch') {
    const plan = currentPartyQuery();
    if (!plan) return null;
    const contracts = await this.prisma.contract.findMany({
      where: {
        AND: [plan.contract, plan.finance('payments.read'), plan.finance('collections.read')],
        customer: plan.customer,
        ...(branchId ? { branchId } : {}),
        ...(kind === 'upsell'
          ? { status: { in: ['ACTIVE', 'COMPLETED'] }, dunningStage: 'NONE' }
          : { status: 'ACTIVE' }),
      },
      select: { id: true, customerId: true, parentContractId: true, productId: true },
    });
    const ids = contracts.map((c) => c.id);
    const [payments, products, parents] = await Promise.all([
      this.prisma.payment.findMany({
        where: { AND: plan.payment, contractId: { in: ids } },
        select: { id: true },
      }),
      this.prisma.product.findMany({
        where: { AND: plan.product, id: { in: contracts.map((c) => c.productId) } },
        select: { id: true },
      }),
      this.prisma.contract.findMany({
        where: {
          AND: plan.contract,
          id: { in: contracts.flatMap((c) => (c.parentContractId ? [c.parentContractId] : [])) },
        },
        select: { id: true, customerId: true },
      }),
    ]);
    const byId = new Map(parents.map((c) => [c.id, c]));
    return {
      contracts: ids,
      payments: payments.map((p) => p.id),
      products: products.map((p) => p.id),
      exchanges: contracts
        .filter(
          (c) => c.parentContractId && byId.get(c.parentContractId)?.customerId === c.customerId,
        )
        .map((c) => c.id),
    };
  }
  async getUpsellCandidates(branchId?: string, limit = 20) {
    // Use raw SQL to compute paid ratio (paidInstallments / totalMonths)
    // Prisma ORM cannot HAVING on aggregate counts directly
    const branchFilter = branchId ? Prisma.sql`AND c.branch_id = ${branchId}` : Prisma.empty;
    const scope = await this.reportScope(branchId, 'upsell');
    const contractScope = scope
      ? Prisma.sql`AND c.id = ANY(${scope.contracts}::text[])`
      : Prisma.empty;
    const paymentScope = scope
      ? Prisma.sql`AND p.id = ANY(${scope.payments}::text[])`
      : Prisma.empty;
    const productScope = scope
      ? Prisma.sql`AND pr.id = ANY(${scope.products}::text[])`
      : Prisma.empty;
    const exchange = scope
      ? Prisma.sql`c.id = ANY(${scope.exchanges}::text[])`
      : Prisma.sql`c.parent_contract_id IS NOT NULL`;

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
        (${exchange}) AS "hasExchangeHistory",
        pr.model AS "productModel",
        c.monthly_payment AS "monthlyPayment"
      FROM contracts c
      JOIN customers cu ON cu.id = c.customer_id
      LEFT JOIN payments p ON p.contract_id = c.id AND p.deleted_at IS NULL ${paymentScope}
      LEFT JOIN products pr ON pr.id = c.product_id ${productScope}
      WHERE c.deleted_at IS NULL
        AND cu.deleted_at IS NULL
        AND c.status IN ('ACTIVE', 'COMPLETED')
        AND c.dunning_stage = 'NONE'
        ${branchFilter}
        ${contractScope}
      GROUP BY c.id, cu.id, pr.model
      HAVING
        c.status = 'COMPLETED'
        OR (${exchange})
        OR (
          COUNT(p.id) FILTER (WHERE p.status = 'PAID')::numeric / NULLIF(c.total_months, 0) >= 0.7
        )
      ORDER BY "paidRatio" DESC NULLS LAST, c.created_at DESC
      LIMIT ${limit}
    `);

    const contacts = scope
      ? await this.query.managedContactViews(rows.map((r) => r.customerId))
      : undefined;
    return {
      total: rows.length,
      ...(scope
        ? {
            availability: {
              contracts: currentPartyQuery()!.coverage('contracts.read'),
              payments: currentPartyQuery()!.coverage('payments.read'),
              collections: currentPartyQuery()!.coverage('collections.read'),
            },
          }
        : {}),
      candidates: rows.map((r) => ({
        contractId: r.contractId,
        contractNumber: r.contractNumber,
        customerId: r.customerId,
        customerName: r.customerName,
        customerPhone: contacts ? (contacts.get(r.customerId)?.phone ?? null) : r.customerPhone,
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
    const scope = await this.reportScope(branchId, 'watch');
    const contractScope = scope
      ? Prisma.sql`AND c.id = ANY(${scope.contracts}::text[])`
      : Prisma.empty;
    const paymentScope = scope
      ? Prisma.sql`AND p.id = ANY(${scope.payments}::text[])`
      : Prisma.empty;
    const nextScope = scope ? Prisma.sql`AND p2.id = ANY(${scope.payments}::text[])` : Prisma.empty;
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
        COUNT(DISTINCT p.id) FILTER (
          WHERE p.paid_date IS NOT NULL AND p.paid_date::date > p.due_date::date
        ) AS "latePaymentCount",
        COUNT(DISTINCT p.id) FILTER (WHERE p.status = 'PARTIALLY_PAID') AS "partialPaymentCount",
        (c.dunning_last_action_at IS NOT NULL AND c.dunning_stage = 'NONE') AS "hadDunningReset",
        c.dunning_stage AS "dunningStage",
        c.total_months AS "totalMonths",
        COUNT(DISTINCT p.id) FILTER (WHERE p.status = 'PAID') AS "paidCount",
        (SELECT p2.due_date FROM payments p2 WHERE p2.contract_id = c.id AND p2.deleted_at IS NULL AND p2.status IN ('PENDING', 'OVERDUE') ${nextScope} ORDER BY p2.due_date, p2.installment_no, p2.id LIMIT 1) AS "nextDueDate",
        (SELECT p2.amount_due FROM payments p2 WHERE p2.contract_id = c.id AND p2.deleted_at IS NULL AND p2.status IN ('PENDING', 'OVERDUE') ${nextScope} ORDER BY p2.due_date, p2.installment_no, p2.id LIMIT 1) AS "nextAmountDue"
      FROM customers cu
      JOIN contracts c ON c.customer_id = cu.id AND c.deleted_at IS NULL
      LEFT JOIN payments p ON p.contract_id = c.id AND p.deleted_at IS NULL ${paymentScope}
      WHERE cu.deleted_at IS NULL
        AND c.status = 'ACTIVE'
        ${branchFilter}
        ${contractScope}
      GROUP BY cu.id, c.id
      HAVING
        COUNT(DISTINCT p.id) FILTER (
          WHERE p.paid_date IS NOT NULL AND p.paid_date::date > p.due_date::date
        ) >= 2
        OR COUNT(DISTINCT p.id) FILTER (WHERE p.status = 'PARTIALLY_PAID') >= 1
        OR (c.dunning_last_action_at IS NOT NULL AND c.dunning_stage = 'NONE')
      ORDER BY
        (
          LEAST(COUNT(DISTINCT p.id) FILTER (
            WHERE p.paid_date IS NOT NULL AND p.paid_date::date > p.due_date::date
          ), 5)
          + COUNT(DISTINCT p.id) FILTER (WHERE p.status = 'PARTIALLY_PAID') * 2
          + CASE WHEN c.dunning_last_action_at IS NOT NULL AND c.dunning_stage = 'NONE' THEN 3 ELSE 0 END
        ) DESC
      LIMIT ${limit}
    `);

    const contacts = scope
      ? await this.query.managedContactViews(rows.map((r) => r.customerId))
      : undefined;
    const candidates = rows.map((r) => {
      const { late, partial, dunningReset, score, riskLevel, reasons } =
        calculatePaymentWatchRisk(r);

      return {
        customerId: r.customerId,
        customerName: r.customerName,
        customerPhone: contacts ? (contacts.get(r.customerId)?.phone ?? null) : r.customerPhone,
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
        nextAmountDue: r.nextAmountDue === null ? null : Number(r.nextAmountDue),
      };
    });

    return {
      total: candidates.length,
      watchList: candidates,
      ...(scope
        ? {
            availability: {
              contracts: currentPartyQuery()!.coverage('contracts.read'),
              payments: currentPartyQuery()!.coverage('payments.read'),
              collections: currentPartyQuery()!.coverage('collections.read'),
            },
          }
        : {}),
    };
  }

  async getChatSummary(customerId: string) {
    const plan = currentPartyQuery();
    if (plan) await plan.assertCustomer(customerId);
    else await this.query.findOne(customerId);

    // Choose the five latest valid installments first, then fetch every partial.
    // Receipt.paymentId has no FK; validate its actual Contract backlink first.
    const validPayments = await this.prisma.payment.findMany({
      where: {
        deletedAt: null,
        contract: { customerId, deletedAt: null },
        ...(plan ? { AND: plan.payment } : {}),
      },
      select: { id: true, contractId: true },
    });
    const receiptWhere: Prisma.ReceiptWhereInput = plan
      ? await plan.receipts(customerId)
      : {
          deletedAt: null,
          isVoided: false,
          OR: validPayments.map((p) => ({ paymentId: p.id, contractId: p.contractId })),
        };
    const recent = await this.prisma.receipt.groupBy({
      by: ['paymentId'],
      where: receiptWhere,
      _max: { paidDate: true },
      orderBy: [{ _max: { paidDate: 'desc' } }, { paymentId: 'asc' }],
      take: 5,
    });
    const paymentIds = recent.flatMap((r) => (r.paymentId ? [r.paymentId] : []));
    const recentReceipts = await this.prisma.receipt.findMany({
      where: { AND: receiptWhere, paymentId: { in: paymentIds } },
      orderBy: [{ paidDate: 'desc' }, { id: 'asc' }],
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

    const payments = paymentIds.length
      ? await this.prisma.payment.findMany({
          where: { id: { in: paymentIds }, ...(plan ? { AND: plan.payment } : {}) },
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
        ...(plan ? { AND: plan.payment } : {}),
        dueDate: { lt: new Date() },
      },
    });

    const outstandingRows = await this.prisma.payment.findMany({
      where: {
        ...UNPAID_INSTALLMENT_WHERE,
        contract: { customerId, deletedAt: null },
        ...(plan ? { AND: plan.payment } : {}),
      },
      select: { amountDue: true, amountPaid: true },
    });
    const totalOutstanding = outstandingOf(outstandingRows);

    // 3. Active contracts with product info
    const activeContracts = await this.prisma.contract.findMany({
      where: {
        customerId,
        deletedAt: null,
        status: { in: ['ACTIVE', 'OVERDUE', 'DEFAULT'] },
        ...(plan ? { AND: plan.contract } : {}),
      },
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
          select: {
            id: true,
            name: true,
            brand: true,
            model: true,
            serialNumber: true,
            warrantyExpireDate: true,
          },
        },
        payments: {
          where: { deletedAt: null, ...(plan ? { AND: plan.payment } : {}) },
          select: { status: true, dueDate: true },
          orderBy: { installmentNo: 'asc' },
        },
      },
    });

    // Compute per-contract paid/total/next due
    const contractSummaries = await Promise.all(
      activeContracts.map(async (c) => {
        const product = plan
          ? await plan.productView(c.product)
          : c.product
            ? {
                name: c.product.name,
                brand: c.product.brand,
                model: c.product.model,
                serialNumber: c.product.serialNumber,
                warrantyExpireDate: c.product.warrantyExpireDate,
              }
            : null;
        const paymentAvailable = !plan || (await plan.contractAllows(c.id, 'payments.read'));
        const mdmAvailable = !plan || (await plan.contractAllows(c.id, 'mdm.read'));
        const paid = c.payments.filter((p) => p.status === 'PAID').length;
        const nextDue = c.payments.find((p) => p.status !== 'PAID');
        return {
          id: c.id,
          contractNumber: c.contractNumber,
          status: c.status,
          monthlyPayment: c.monthlyPayment,
          product,
          paidInstallments: paymentAvailable ? paid : null,
          totalInstallments: c.totalMonths,
          nextDueDate: paymentAvailable ? (nextDue?.dueDate ?? null) : null,
          serialNumber: product?.serialNumber ?? null,
          mdmLockedAt: mdmAvailable ? c.mdmLockedAt : null,
          ...(plan
            ? {
                availability: {
                  payments: paymentAvailable ? ('scoped' as const) : ('unavailable' as const),
                  mdm: mdmAvailable ? ('scoped' as const) : ('unavailable' as const),
                  product: product ? ('available' as const) : ('unavailable' as const),
                },
              }
            : {}),
          shopWarrantyEndDate: c.shopWarrantyEndDate,
        };
      }),
    );

    // 4. Call logs across all contracts (last 5)
    const callLogs = await this.prisma.callLog.findMany({
      where: {
        contract: { customerId, deletedAt: null },
        ...(plan ? { AND: plan.collection } : {}),
      },
      orderBy: { calledAt: 'desc' },
      take: 5,
      select: {
        id: true,
        contractId: true,
        calledAt: true,
        result: true,
        notes: true,
        caller: { select: { name: true } },
        contract: { select: { contractNumber: true } },
      },
    });

    // 5. Previous chat rooms (all channels)
    const chatRooms = await this.prisma.chatRoom.findMany({
      where: { customerId, deletedAt: null, ...(plan ? { AND: plan.room } : {}) },
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
      overdueCount:
        plan && plan.coverage('payments.read') === 'unavailable' ? null : overduePayments,
      totalOutstanding:
        plan && plan.coverage('payments.read') === 'unavailable' ? null : totalOutstanding,
      activeContracts: contractSummaries,
      callLogs: plan
        ? await Promise.all(
            callLogs.map(async (row) => {
              const allowed =
                (await plan.contractAllows(row.contractId, 'documents.read')) &&
                (await plan.contractAllows(row.contractId, 'sensitive.customer-identity.read'));
              return {
                id: row.id,
                calledAt: row.calledAt,
                caller: row.caller,
                contract: row.contract,
                result:
                  allowed || ['ANSWERED', 'NO_ANSWER', 'PROMISED', 'REFUSED'].includes(row.result)
                    ? row.result
                    : null,
                notes: allowed ? row.notes : null,
                notesAvailability: allowed ? 'available' : 'unavailable',
              };
            }),
          )
        : callLogs.map((row) => ({
            id: row.id,
            calledAt: row.calledAt,
            result: row.result,
            notes: row.notes,
            caller: row.caller,
            contract: row.contract,
          })),
      chatRooms,
      ...(plan
        ? {
            availability: {
              contracts: plan.coverage('contracts.read'),
              payments: plan.coverage('payments.read'),
              receipts: plan.coverage('receipts.read'),
              collections: plan.coverage('collections.read'),
              chat: [...plan.live].some((c) => plan.has('chat.read', c)) ? 'scoped' : 'unavailable',
            },
          }
        : {}),
    };
  }
}
