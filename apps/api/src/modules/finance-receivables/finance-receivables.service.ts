import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateFinanceCompanyDto,
  UpdateFinanceCompanyDto,
} from './dto/create-finance-company.dto';
import {
  CreateFinanceReceivableDto,
  UpdateFinanceReceivableDto,
} from './dto/create-finance-receivable.dto';
import { RecordFinanceReceiptDto } from './dto/record-finance-receipt.dto';

@Injectable()
export class FinanceReceivablesService {
  constructor(private prisma: PrismaService) {}

  // ========== Finance Companies ==========

  async findAllCompanies(search?: string, page = 1, limit = 50) {
    const where: Prisma.FinanceCompanyWhereInput = { deletedAt: null };

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { shortName: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.financeCompany.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { name: 'asc' },
      }),
      this.prisma.financeCompany.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  async findOneCompany(id: string) {
    const company = await this.prisma.financeCompany.findFirst({
      where: { id, deletedAt: null },
      include: {
        receivables: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
    });

    if (!company) throw new NotFoundException('ไม่พบบริษัทไฟแนนซ์');
    return company;
  }

  async createCompany(dto: CreateFinanceCompanyDto) {
    return this.prisma.financeCompany.create({ data: dto });
  }

  async updateCompany(id: string, dto: UpdateFinanceCompanyDto) {
    await this.findOneCompany(id);
    return this.prisma.financeCompany.update({ where: { id }, data: dto });
  }

  async deleteCompany(id: string) {
    await this.findOneCompany(id);
    return this.prisma.financeCompany.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  // ========== Finance Receivables ==========

  async findAllReceivables(
    search?: string,
    page = 1,
    limit = 50,
    status?: string,
    financeCompanyId?: string,
    branchId?: string,
    dateFrom?: string,
    dateTo?: string,
  ) {
    const where: Prisma.FinanceReceivableWhereInput = { deletedAt: null };

    if (search) {
      where.OR = [
        { referenceNumber: { contains: search, mode: 'insensitive' } },
        { financeCompany: { name: { contains: search, mode: 'insensitive' } } },
      ];
    }

    if (status) {
      where.status = status as Prisma.EnumFinancePaymentStatusFilter['equals'];
    }
    if (financeCompanyId) where.financeCompanyId = financeCompanyId;
    if (branchId) where.branchId = branchId;
    if (dateFrom || dateTo) {
      where.dueDate = {};
      if (dateFrom) where.dueDate.gte = new Date(dateFrom);
      if (dateTo) where.dueDate.lte = new Date(dateTo);
    }

    const [data, total] = await Promise.all([
      this.prisma.financeReceivable.findMany({
        where,
        include: {
          financeCompany: { select: { name: true, shortName: true } },
          branch: { select: { name: true } },
          contract: { select: { contractNumber: true } },
          createdBy: { select: { name: true } },
        },
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.financeReceivable.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  async findOneReceivable(id: string) {
    const receivable = await this.prisma.financeReceivable.findFirst({
      where: { id, deletedAt: null },
      include: {
        financeCompany: true,
        branch: { select: { name: true } },
        contract: { select: { contractNumber: true, customerSnapshot: true } },
        createdBy: { select: { name: true } },
        receipts: {
          include: { recordedBy: { select: { name: true } } },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!receivable) throw new NotFoundException('ไม่พบรายการตัดจ่ายไฟแนนซ์');
    return receivable;
  }

  async getSummary(branchId?: string) {
    const where: Prisma.FinanceReceivableWhereInput = { deletedAt: null };
    if (branchId) where.branchId = branchId;

    const receivables = await this.prisma.financeReceivable.findMany({
      where,
      select: { status: true, outstandingAmount: true, dueDate: true },
    });

    const now = new Date();
    let totalOutstanding = new Prisma.Decimal(0);
    let pendingCount = 0;
    let overdueCount = 0;
    const aging = { '0_30': new Prisma.Decimal(0), '31_60': new Prisma.Decimal(0), '60_plus': new Prisma.Decimal(0) };

    for (const r of receivables) {
      if (r.status === 'FULLY_PAID' || r.status === 'CANCELLED') continue;
      totalOutstanding = totalOutstanding.add(r.outstandingAmount);
      if (r.status === 'PENDING' || r.status === 'PARTIALLY_PAID') pendingCount++;
      if (r.status === 'OVERDUE') overdueCount++;

      if (r.dueDate) {
        const daysPast = Math.floor(
          (now.getTime() - r.dueDate.getTime()) / (1000 * 60 * 60 * 24),
        );
        if (daysPast > 60) aging['60_plus'] = aging['60_plus'].add(r.outstandingAmount);
        else if (daysPast > 30) aging['31_60'] = aging['31_60'].add(r.outstandingAmount);
        else if (daysPast > 0) aging['0_30'] = aging['0_30'].add(r.outstandingAmount);
      }
    }

    // Monthly receipts (current month)
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthlyReceipts = await this.prisma.financeReceipt.aggregate({
      where: {
        paymentDate: { gte: startOfMonth },
        receivable: branchId ? { branchId, deletedAt: null } : { deletedAt: null },
      },
      _sum: { amount: true },
    });

    return {
      totalOutstanding,
      monthlyReceived: monthlyReceipts._sum.amount || new Prisma.Decimal(0),
      pendingCount,
      overdueCount,
      aging,
    };
  }

  async createReceivable(dto: CreateFinanceReceivableDto, userId: string) {
    const count = await this.prisma.financeReceivable.count();
    const referenceNumber = `FIN-${String(count + 1).padStart(5, '0')}`;

    return this.prisma.financeReceivable.create({
      data: {
        referenceNumber,
        financeCompanyId: dto.financeCompanyId,
        contractId: dto.contractId,
        branchId: dto.branchId,
        expectedAmount: new Prisma.Decimal(dto.expectedAmount),
        outstandingAmount: new Prisma.Decimal(dto.expectedAmount),
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
        notes: dto.notes,
        createdById: userId,
      },
      include: {
        financeCompany: { select: { name: true } },
        branch: { select: { name: true } },
      },
    });
  }

  async updateReceivable(id: string, dto: UpdateFinanceReceivableDto) {
    await this.findOneReceivable(id);
    const data: Prisma.FinanceReceivableUpdateInput = {};

    if (dto.expectedAmount) {
      data.expectedAmount = new Prisma.Decimal(dto.expectedAmount);
      // recalculate outstanding
      const current = await this.prisma.financeReceivable.findUnique({ where: { id } });
      if (current) {
        data.outstandingAmount = new Prisma.Decimal(dto.expectedAmount).sub(
          current.receivedAmount,
        );
      }
    }
    if (dto.dueDate) data.dueDate = new Date(dto.dueDate);
    if (dto.notes !== undefined) data.notes = dto.notes;

    return this.prisma.financeReceivable.update({ where: { id }, data });
  }

  async recordReceipt(receivableId: string, dto: RecordFinanceReceiptDto, userId: string) {
    const receivable = await this.prisma.financeReceivable.findFirst({
      where: { id: receivableId, deletedAt: null },
    });
    if (!receivable) throw new NotFoundException('ไม่พบรายการตัดจ่ายไฟแนนซ์');

    const amount = new Prisma.Decimal(dto.amount);
    if (amount.lte(0)) throw new BadRequestException('จำนวนเงินต้องมากกว่า 0');

    const newReceived = receivable.receivedAmount.add(amount);
    const newOutstanding = receivable.expectedAmount.sub(newReceived);
    const newStatus = newOutstanding.lte(0) ? 'FULLY_PAID' : 'PARTIALLY_PAID';

    const [receipt] = await this.prisma.$transaction([
      this.prisma.financeReceipt.create({
        data: {
          receivableId,
          amount,
          paymentDate: new Date(dto.paymentDate),
          paymentMethod: dto.paymentMethod,
          referenceNumber: dto.referenceNumber,
          evidenceUrl: dto.evidenceUrl,
          notes: dto.notes,
          recordedById: userId,
        },
      }),
      this.prisma.financeReceivable.update({
        where: { id: receivableId },
        data: {
          receivedAmount: newReceived,
          outstandingAmount: newOutstanding.lt(0) ? new Prisma.Decimal(0) : newOutstanding,
          status: newStatus,
        },
      }),
    ]);

    return receipt;
  }
}
