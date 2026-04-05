import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCustomerDto, UpdateCustomerDto } from './dto/customer.dto';

@Injectable()
export class CustomersService {
  constructor(private prisma: PrismaService) {}

  async findAll(
    search?: string,
    page = 1,
    limit = 50,
    contractStatus?: string,
    hasOverdue?: boolean,
    creditStatus?: string,
    branchId?: string,
    sortBy?: string,
    sortOrder?: string,
  ) {
    const where: Record<string, unknown> = { deletedAt: null };

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search } },
        { nationalId: { contains: search } },
      ];
    }

    // Contract status filters
    if (hasOverdue) {
      where.contracts = { some: { status: { in: ['OVERDUE', 'DEFAULT'] }, deletedAt: null } };
    } else if (contractStatus) {
      where.contracts = { some: { status: contractStatus, deletedAt: null } };
    } else if (branchId) {
      where.contracts = { some: { branchId, deletedAt: null } };
    }

    // Credit status filter
    if (creditStatus) {
      where.creditChecks = { some: { status: creditStatus } };
    }

    // Determine sort order
    const order = sortOrder === 'asc' ? 'asc' : 'desc';
    let orderBy: Prisma.CustomerOrderByWithRelationInput = { createdAt: 'desc' };

    if (sortBy === 'name') {
      orderBy = { name: order };
    } else if (sortBy === 'createdAt') {
      orderBy = { createdAt: order };
    } else if (sortBy === 'contractCount') {
      orderBy = { contracts: { _count: order } };
    }
    // For creditScore, we'll sort in-memory after fetching

    const [data, total, withActiveContract, withOverdue, newThisMonth] = await Promise.all([
      this.prisma.customer.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          nationalId: true,
          name: true,
          nickname: true,
          phone: true,
          occupation: true,
          salary: true,
          lineId: true,
          createdAt: true,
          _count: { select: { contracts: true } },
          contracts: {
            where: { deletedAt: null },
            select: { status: true },
          },
          creditChecks: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { status: true, aiScore: true },
          },
        },
      }),
      this.prisma.customer.count({ where }),
      this.prisma.customer.count({
        where: { deletedAt: null, contracts: { some: { status: 'ACTIVE', deletedAt: null } } },
      }),
      this.prisma.customer.count({
        where: { deletedAt: null, contracts: { some: { status: { in: ['OVERDUE', 'DEFAULT'] }, deletedAt: null } } },
      }),
      (() => {
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        return this.prisma.customer.count({
          where: { deletedAt: null, createdAt: { gte: startOfMonth } },
        });
      })(),
    ]);

    const enriched = data.map((c) => {
      const activeContracts = c.contracts.filter((ct) => ct.status === 'ACTIVE').length;
      const overdueContracts = c.contracts.filter((ct) => ['OVERDUE', 'DEFAULT'].includes(ct.status)).length;
      const latestCredit = c.creditChecks[0] || null;
      const { contracts, creditChecks, ...rest } = c;
      return {
        ...rest,
        activeContracts,
        overdueContracts,
        latestCreditStatus: latestCredit?.status || null,
        latestCreditScore: latestCredit?.aiScore || null,
      };
    });

    // In-memory sort for creditScore
    if (sortBy === 'creditScore') {
      enriched.sort((a, b) => {
        const scoreA = a.latestCreditScore || -1;
        const scoreB = b.latestCreditScore || -1;
        return order === 'asc' ? scoreA - scoreB : scoreB - scoreA;
      });
    }

    const totalCustomers = await this.prisma.customer.count({ where: { deletedAt: null } });

    const summary = {
      totalCustomers,
      withActiveContract,
      withOverdue,
      newThisMonth,
    };

    return { data: enriched, total, page, limit, totalPages: Math.ceil(total / limit), summary };
  }

  async findOne(id: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id },
      include: {
        contracts: {
          select: {
            id: true,
            contractNumber: true,
            status: true,
            sellingPrice: true,
            monthlyPayment: true,
            totalMonths: true,
            createdAt: true,
            product: { select: { id: true, name: true, brand: true, model: true } },
            branch: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
        _count: { select: { contracts: true, referrals: true } },
        referredBy: { select: { id: true, name: true, phone: true } },
      },
    });
    if (!customer || customer.deletedAt) throw new NotFoundException('ไม่พบลูกค้า');
    return customer;
  }

  async getReferrals(id: string) {
    await this.findOne(id);
    const referrals = await this.prisma.customer.findMany({
      where: { referredById: id, deletedAt: null },
      select: {
        id: true,
        name: true,
        phone: true,
        createdAt: true,
        _count: { select: { contracts: true } },
        contracts: {
          where: { deletedAt: null },
          select: { status: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      total: referrals.length,
      referrals: referrals.map((r) => ({
        id: r.id,
        name: r.name,
        phone: r.phone,
        createdAt: r.createdAt,
        contractCount: r._count.contracts,
        hasActiveContract: r.contracts.some((c) => c.status === 'ACTIVE'),
      })),
    };
  }

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

  async search(q: string) {
    return this.prisma.customer.findMany({
      where: {
        deletedAt: null,
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { phone: { contains: q } },
          { nationalId: { contains: q } },
        ],
      },
      select: {
        id: true,
        name: true,
        phone: true,
        nationalId: true,
        _count: { select: { contracts: true } },
      },
      take: 10,
      orderBy: { name: 'asc' },
    });
  }

  async create(dto: CreateCustomerDto) {
    // Check duplicate national ID
    const existing = await this.prisma.customer.findUnique({
      where: { nationalId: dto.nationalId },
    });
    if (existing && !existing.deletedAt) {
      throw new ConflictException({
        message: 'ลูกค้าที่มีเลขบัตรประชาชนนี้มีอยู่แล้ว',
        existingCustomer: { id: existing.id, name: existing.name },
      });
    }

    // Validate Thai national ID checksum (skip for foreigners)
    if (!dto.isForeigner && !this.validateNationalId(dto.nationalId)) {
      throw new ConflictException('เลขบัตรประชาชนไม่ถูกต้อง');
    }

    const data: Prisma.CustomerCreateInput = {
      ...dto,
      references: dto.references !== undefined
        ? (dto.references as Prisma.InputJsonValue)
        : undefined,
    };
    return this.prisma.customer.create({ data });
  }

  async update(id: string, dto: UpdateCustomerDto) {
    await this.findOne(id);
    const data: Prisma.CustomerUpdateInput = {
      ...dto,
      references: dto.references !== undefined
        ? (dto.references as Prisma.InputJsonValue)
        : undefined,
    };
    return this.prisma.customer.update({
      where: { id },
      data,
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.customer.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async getContracts(id: string) {
    await this.findOne(id);
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

  async uploadDocument(id: string, dto: { fileName: string; fileUrl: string; mimeType: string; fileSize: number }) {
    const customer = await this.findOne(id);
    const currentDocs = customer.documents || [];
    const updatedDocs = [...currentDocs, dto.fileUrl];
    return this.prisma.customer.update({
      where: { id },
      data: { documents: updatedDocs },
    });
  }

  async deleteDocument(id: string, fileUrl: string) {
    const customer = await this.findOne(id);
    const currentDocs = customer.documents || [];
    const updatedDocs = currentDocs.filter((doc) => doc !== fileUrl);
    return this.prisma.customer.update({
      where: { id },
      data: { documents: updatedDocs },
    });
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

  private validateNationalId(id: string): boolean {
    if (!/^\d{13}$/.test(id)) return false;
    let sum = 0;
    for (let i = 0; i < 12; i++) {
      sum += parseInt(id[i]) * (13 - i);
    }
    const check = (11 - (sum % 11)) % 10;
    return check === parseInt(id[12]);
  }
}
