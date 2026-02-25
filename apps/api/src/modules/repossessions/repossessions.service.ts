import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateRepossessionDto, UpdateRepossessionDto } from './dto/create-repossession.dto';
import { ConditionGrade, RepossessionStatus } from '@prisma/client';

@Injectable()
export class RepossessionsService {
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
    return this.prisma.$transaction(async (tx) => {
      const contract = await tx.contract.findUnique({
        where: { id: dto.contractId },
        include: { product: true, payments: true },
      });

      if (!contract) throw new NotFoundException('ไม่พบสัญญา');
      if (!['DEFAULT', 'OVERDUE'].includes(contract.status)) {
        throw new BadRequestException('สัญญานี้ไม่อยู่ในสถานะที่สามารถยึดคืนได้');
      }

      // Calculate outstanding balance for profit/loss
      let outstandingBalance = 0;
      for (const p of contract.payments) {
        if (['PENDING', 'OVERDUE', 'PARTIALLY_PAID'].includes(p.status)) {
          outstandingBalance += Number(p.amountDue) - Number(p.amountPaid) + Number(p.lateFee);
        }
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

      return {
        ...repossession,
        outstandingBalance,
        loss: outstandingBalance - dto.appraisalPrice,
      };
    });
  }

  /**
   * Update repossession (repair cost, resell price, status)
   */
  async update(id: string, dto: UpdateRepossessionDto) {
    const repo = await this.findOne(id);

    const data: Record<string, unknown> = {};
    if (dto.repairCost !== undefined) data.repairCost = dto.repairCost;
    if (dto.resellPrice !== undefined) data.resellPrice = dto.resellPrice;
    if (dto.notes !== undefined) data.notes = dto.notes;

    if (dto.status) {
      data.status = dto.status as RepossessionStatus;

      // Update product status based on repossession status
      if (dto.status === 'UNDER_REPAIR') {
        await this.prisma.product.update({
          where: { id: repo.product.id },
          data: { status: 'REPOSSESSED' },
        });
      } else if (dto.status === 'READY_FOR_SALE') {
        await this.prisma.product.update({
          where: { id: repo.product.id },
          data: { status: 'REFURBISHED' },
        });
      } else if (dto.status === 'SOLD') {
        await this.prisma.product.update({
          where: { id: repo.product.id },
          data: { status: 'SOLD_RESELL' },
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
   * Mark repossessed product as ready for sale (back to IN_STOCK)
   */
  async markReadyForSale(id: string, resellPrice: number) {
    const repo = await this.findOne(id);

    if (repo.status !== 'UNDER_REPAIR' && repo.status !== 'REPOSSESSED') {
      throw new BadRequestException('สถานะไม่ถูกต้อง');
    }

    await this.prisma.product.update({
      where: { id: repo.product.id },
      data: { status: 'IN_STOCK' },
    });

    return this.prisma.repossession.update({
      where: { id },
      data: { status: 'READY_FOR_SALE', resellPrice },
    });
  }

  /**
   * Get profit/loss summary for repossessions
   */
  async getProfitLossSummary() {
    const repos = await this.prisma.repossession.findMany({
      where: { status: 'SOLD' },
      select: {
        appraisalPrice: true,
        repairCost: true,
        resellPrice: true,
      },
    });

    let totalAppraisal = 0;
    let totalRepairCost = 0;
    let totalResellPrice = 0;

    for (const r of repos) {
      totalAppraisal += Number(r.appraisalPrice);
      totalRepairCost += Number(r.repairCost);
      totalResellPrice += Number(r.resellPrice || 0);
    }

    return {
      count: repos.length,
      totalAppraisal,
      totalRepairCost,
      totalResellPrice,
      totalProfit: totalResellPrice - totalAppraisal - totalRepairCost,
    };
  }
}
