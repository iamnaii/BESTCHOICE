import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateRepossessionDto, UpdateRepossessionDto } from './dto/create-repossession.dto';
import { ConditionGrade, RepossessionStatus, ProductStatus } from '@prisma/client';

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

  async findAll(filters: { status?: string; branchId?: string }) {
    const where: Record<string, unknown> = {};

    if (filters.status) {
      where.status = filters.status;
    }

    if (filters.branchId) {
      where.contract = { branchId: filters.branchId };
    }

    return this.prisma.repossession.findMany({
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
    });
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

      // Calculate outstanding balance for profit/loss
      let outstandingBalance = 0;
      let totalPaid = 0;
      for (const p of contract.payments) {
        if (['PENDING', 'OVERDUE', 'PARTIALLY_PAID'].includes(p.status)) {
          outstandingBalance += Number(p.amountDue) - Number(p.amountPaid) + Number(p.lateFee);
        }
        totalPaid += Number(p.amountPaid);
      }

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
          conditionGrade: dto.conditionGrade as ConditionGrade,
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
        const resellPrice = dto.resellPrice ?? Number(repo.resellPrice || 0);
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
   * Mark repossessed product as ready for sale
   */
  async markReadyForSale(id: string, resellPrice: number) {
    const repo = await this.findOne(id);

    if (repo.status !== 'UNDER_REPAIR' && repo.status !== 'REPOSSESSED') {
      throw new BadRequestException('สถานะไม่ถูกต้อง ต้องเป็น REPOSSESSED หรือ UNDER_REPAIR');
    }

    if (!resellPrice || resellPrice <= 0) {
      throw new BadRequestException('กรุณาระบุราคาขายต่อ');
    }

    // Use transaction to ensure both updates are atomic
    return this.prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id: repo.product.id },
        data: { status: 'REFURBISHED' },
      });
      return tx.repossession.update({
        where: { id },
        data: { status: 'READY_FOR_SALE', resellPrice },
      });
    });
  }

  /**
   * Get profit/loss summary (aggregate + itemized)
   */
  async getProfitLossSummary() {
    const repos = await this.prisma.repossession.findMany({
      where: { status: 'SOLD' },
      include: {
        contract: {
          select: { contractNumber: true, customer: { select: { name: true } } },
        },
        product: {
          select: { name: true, brand: true, model: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    let totalAppraisal = 0;
    let totalRepairCost = 0;
    let totalResellPrice = 0;

    const items = repos.map((r) => {
      const appraisal = Number(r.appraisalPrice);
      const repair = Number(r.repairCost);
      const resell = Number(r.resellPrice || 0);
      const profit = resell - appraisal - repair;

      totalAppraisal += appraisal;
      totalRepairCost += repair;
      totalResellPrice += resell;

      return {
        id: r.id,
        contract: r.contract.contractNumber,
        customer: r.contract.customer.name,
        product: `${r.product.brand} ${r.product.model}`,
        conditionGrade: r.conditionGrade,
        appraisalPrice: appraisal,
        repairCost: repair,
        resellPrice: resell,
        profit,
        marginPct: resell > 0 ? ((profit / resell) * 100).toFixed(1) : '0',
      };
    });

    return {
      summary: {
        count: repos.length,
        totalAppraisal,
        totalRepairCost,
        totalResellPrice,
        totalProfit: totalResellPrice - totalAppraisal - totalRepairCost,
      },
      items,
    };
  }
}
