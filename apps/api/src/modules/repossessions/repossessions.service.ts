import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateRepossessionDto, UpdateRepossessionDto } from './dto/create-repossession.dto';
import { ConditionGrade, RepossessionStatus, ProductStatus, Prisma } from '@prisma/client';

// Valid status transitions for repossession workflow
const VALID_TRANSITIONS: Record<string, string[]> = {
  REPOSSESSED: ['UNDER_REPAIR', 'READY_FOR_SALE'],
  UNDER_REPAIR: ['READY_FOR_SALE'],
  READY_FOR_SALE: ['SOLD'],
};

@Injectable()
export class RepossessionsService {
  private readonly logger = new Logger(RepossessionsService.name);

  constructor(private prisma: PrismaService) {}

  async findAll(filters: { status?: string; branchId?: string; page?: number; limit?: number }) {
    const where: Record<string, unknown> = { deletedAt: null };

    if (filters.status) {
      where.status = filters.status;
    }

    if (filters.branchId) {
      where.contract = { branchId: filters.branchId };
    }

    const page = Math.max(1, filters.page || 1);
    const limit = Math.min(200, Math.max(1, filters.limit || 20));

    const [data, total] = await Promise.all([
      this.prisma.repossession.findMany({
        where,
        include: {
          contract: {
            select: {
              id: true,
              contractNumber: true,
              customer: { select: { id: true, name: true, phone: true } },
              branch: { select: { id: true, name: true } },
              sellingPrice: true,
              financedAmount: true,
            },
          },
          product: {
            select: { id: true, name: true, brand: true, model: true, imeiSerial: true },
          },
          appraisedBy: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.repossession.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string) {
    const repo = await this.prisma.repossession.findUnique({
      where: { id },
      include: {
        contract: {
          include: {
            customer: true,
            branch: { select: { id: true, name: true } },
            payments: { orderBy: { installmentNo: 'asc' } },
          },
        },
        product: { include: { prices: true } },
        appraisedBy: { select: { id: true, name: true } },
      },
    });
    if (!repo) throw new NotFoundException('ไม่พบข้อมูลการยึดคืน');
    return repo;
  }

  /**
   * Create repossession record and update contract/product statuses
   */
  async create(dto: CreateRepossessionDto, userId: string) {
    // Validate condition grade
    const validGrades = ['A', 'B', 'C', 'D'];
    if (!validGrades.includes(dto.conditionGrade)) {
      throw new BadRequestException(`เกรดสภาพต้องเป็น ${validGrades.join(', ')}`);
    }

    return this.prisma.$transaction(async (tx) => {
      const contract = await tx.contract.findUnique({
        where: { id: dto.contractId },
        include: { product: true, payments: true },
      });

      if (!contract || contract.deletedAt) throw new NotFoundException('ไม่พบสัญญา');
      if (!['DEFAULT', 'OVERDUE'].includes(contract.status)) {
        throw new BadRequestException('สัญญานี้ไม่อยู่ในสถานะที่สามารถยึดคืนได้');
      }

      // Check if product is already repossessed
      if (contract.product.status === 'REPOSSESSED') {
        throw new BadRequestException('สินค้านี้ถูกยึดคืนแล้ว');
      }

      // Calculate outstanding balance for profit/loss using Decimal arithmetic
      let decOutstandingBalance = new Prisma.Decimal(0);
      let decTotalPaid = new Prisma.Decimal(0);
      for (const p of contract.payments) {
        if (['PENDING', 'OVERDUE', 'PARTIALLY_PAID'].includes(p.status)) {
          decOutstandingBalance = decOutstandingBalance
            .add(new Prisma.Decimal(p.amountDue))
            .sub(new Prisma.Decimal(p.amountPaid))
            .add(new Prisma.Decimal(p.lateFee));
        }
        decTotalPaid = decTotalPaid.add(new Prisma.Decimal(p.amountPaid));
      }
      const outstandingBalance = decOutstandingBalance.toNumber();
      const totalPaid = decTotalPaid.toNumber();

      // Create repossession
      const repossession = await tx.repossession.create({
        data: {
          contractId: dto.contractId,
          productId: contract.productId,
          repossessedDate: new Date(dto.repossessedDate),
          conditionGrade: dto.conditionGrade as ConditionGrade,
          appraisalPrice: dto.appraisalPrice,
          appraisedById: userId,
          repairCost: dto.repairCost || 0,
          resellPrice: dto.resellPrice,
          notes: dto.notes,
          status: 'REPOSSESSED',
        },
      });

      // Update contract status
      await tx.contract.update({
        where: { id: dto.contractId },
        data: { status: 'CLOSED_BAD_DEBT' },
      });

      // Update product status
      await tx.product.update({
        where: { id: contract.productId },
        data: {
          status: 'REPOSSESSED',
        },
      });

      // Audit log for repossession
      await tx.auditLog.create({
        data: {
          userId,
          action: 'REPOSSESSION',
          entity: 'repossession',
          entityId: repossession.id,
          newValue: {
            contractId: dto.contractId,
            contractNumber: contract.contractNumber,
            productId: contract.productId,
            conditionGrade: dto.conditionGrade,
            appraisalPrice: dto.appraisalPrice,
            outstandingBalance,
            totalPaid,
          },
          ipAddress: '',
        },
      });

      this.logger.log(`Repossession created for contract ${contract.contractNumber}`);

      return {
        ...repossession,
        outstandingBalance,
        totalPaid,
        loss: outstandingBalance - dto.appraisalPrice,
      };
    });
  }

  /**
   * Update repossession (repair cost, resell price, status) with workflow validation
   */
  async update(id: string, dto: UpdateRepossessionDto) {
    const repo = await this.findOne(id);

    const data: Record<string, unknown> = {};
    if (dto.repairCost !== undefined) data.repairCost = dto.repairCost;
    if (dto.resellPrice !== undefined) data.resellPrice = dto.resellPrice;
    if (dto.notes !== undefined) data.notes = dto.notes;

    if (dto.status) {
      // Validate status transition
      const currentStatus = repo.status;
      const allowedTransitions = VALID_TRANSITIONS[currentStatus] || [];

      if (!allowedTransitions.includes(dto.status)) {
        throw new BadRequestException(
          `ไม่สามารถเปลี่ยนสถานะจาก ${currentStatus} เป็น ${dto.status} ได้ (สถานะที่อนุญาต: ${allowedTransitions.join(', ') || 'ไม่มี'})`,
        );
      }

      // Validate resell price is set when marking as READY_FOR_SALE or SOLD
      if (['READY_FOR_SALE', 'SOLD'].includes(dto.status)) {
        const resellPrice = dto.resellPrice ?? new Prisma.Decimal(repo.resellPrice || 0).toNumber();
        if (!resellPrice || resellPrice <= 0) {
          throw new BadRequestException('กรุณาระบุราคาขายต่อก่อนเปลี่ยนสถานะ');
        }
      }

      data.status = dto.status as RepossessionStatus;

      // Update product status based on repossession status
      const productStatusMap: Record<string, ProductStatus> = {
        UNDER_REPAIR: 'REPOSSESSED',
        READY_FOR_SALE: 'REFURBISHED',
        SOLD: 'SOLD_RESELL',
      };

      // If marking as SOLD, link to resell contract if provided
      if (dto.status === 'SOLD' && dto.soldContractId) {
        data.soldContractId = dto.soldContractId;
      }

      // Use transaction to ensure product status and repossession update are atomic
      const newProductStatus = productStatusMap[dto.status];
      if (newProductStatus) {
        return this.prisma.$transaction(async (tx) => {
          await tx.product.update({
            where: { id: repo.product.id },
            data: { status: newProductStatus },
          });
          return tx.repossession.update({
            where: { id },
            data,
            include: {
              contract: {
                select: { contractNumber: true, customer: { select: { name: true } } },
              },
              product: { select: { name: true, brand: true, model: true } },
            },
          });
        });
      }
    }

    return this.prisma.repossession.update({
      where: { id },
      data,
      include: {
        contract: {
          select: { contractNumber: true, customer: { select: { name: true } } },
        },
        product: { select: { name: true, brand: true, model: true } },
      },
    });
  }

  /**
   * Mark repossessed product as ready for sale with pricing
   * Creates ProductPrice and moves product to REFURBISHED + back to main warehouse
   */
  async markReadyForSale(id: string, resellPrice: number) {
    const repo = await this.findOne(id);

    if (repo.status !== 'UNDER_REPAIR' && repo.status !== 'REPOSSESSED') {
      throw new BadRequestException('สถานะไม่ถูกต้อง ต้องเป็น REPOSSESSED หรือ UNDER_REPAIR');
    }

    if (!resellPrice || resellPrice <= 0) {
      throw new BadRequestException('กรุณาระบุราคาขายต่อ');
    }

    // Use transaction to ensure all updates are atomic
    return this.prisma.$transaction(async (tx) => {
      // Find main warehouse for re-stocking
      const mainWarehouse = await tx.branch.findFirst({
        where: { isMainWarehouse: true, isActive: true },
      });

      await tx.product.update({
        where: { id: repo.product.id },
        data: {
          status: 'REFURBISHED',
          stockInDate: new Date(),
          ...(mainWarehouse ? { branchId: mainWarehouse.id } : {}),
        },
      });

      // Create/update selling price for refurbished product
      const existingPrice = await tx.productPrice.findFirst({
        where: { productId: repo.product.id, isDefault: true },
      });
      if (existingPrice) {
        await tx.productPrice.update({
          where: { id: existingPrice.id },
          data: { amount: resellPrice, label: 'ราคาขายต่อ (Refurbished)' },
        });
      } else {
        await tx.productPrice.create({
          data: {
            productId: repo.product.id,
            label: 'ราคาขายต่อ (Refurbished)',
            amount: resellPrice,
            isDefault: true,
          },
        });
      }

      return tx.repossession.update({
        where: { id },
        data: { status: 'READY_FOR_SALE', resellPrice },
      });
    });
  }

  /**
   * Get profit/loss summary (aggregate + itemized)
   */
  async getProfitLossSummary(page = 1, limit = 50) {
    const safeLimit = Math.min(limit, 100);
    const where = { status: 'SOLD' as const };

    const [repos, total, aggregation] = await Promise.all([
      this.prisma.repossession.findMany({
        where,
        include: {
          contract: {
            select: { contractNumber: true, customer: { select: { name: true } } },
          },
          product: {
            select: { name: true, brand: true, model: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * safeLimit,
        take: safeLimit,
      }),
      this.prisma.repossession.count({ where }),
      this.prisma.repossession.aggregate({
        where,
        _sum: { appraisalPrice: true, repairCost: true, resellPrice: true },
      }),
    ]);

    const data = repos.map((r) => {
      const decAppraisal = new Prisma.Decimal(r.appraisalPrice);
      const decRepair = new Prisma.Decimal(r.repairCost);
      const decResell = new Prisma.Decimal(r.resellPrice || 0);
      const decProfit = decResell.sub(decAppraisal).sub(decRepair);
      const resell = decResell.toNumber();

      return {
        id: r.id,
        contract: r.contract.contractNumber,
        customer: r.contract.customer.name,
        product: `${r.product.brand} ${r.product.model}`,
        conditionGrade: r.conditionGrade,
        appraisalPrice: decAppraisal.toNumber(),
        repairCost: decRepair.toNumber(),
        resellPrice: resell,
        profit: decProfit.toNumber(),
        marginPct: resell > 0 ? (decProfit.div(decResell).mul(100).toNumber()).toFixed(1) : '0',
      };
    });

    const decTotalAppraisal = new Prisma.Decimal(aggregation._sum.appraisalPrice || 0);
    const decTotalRepairCost = new Prisma.Decimal(aggregation._sum.repairCost || 0);
    const decTotalResellPrice = new Prisma.Decimal(aggregation._sum.resellPrice || 0);
    const totalAppraisal = decTotalAppraisal.toNumber();
    const totalRepairCost = decTotalRepairCost.toNumber();
    const totalResellPrice = decTotalResellPrice.toNumber();

    return {
      summary: {
        count: total,
        totalAppraisal,
        totalRepairCost,
        totalResellPrice,
        totalProfit: decTotalResellPrice.sub(decTotalAppraisal).sub(decTotalRepairCost).toNumber(),
      },
      data,
      total,
      page,
      limit: safeLimit,
    };
  }
}
