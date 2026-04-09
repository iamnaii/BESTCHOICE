import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StructuredLoggerService } from '../../common/logger';
import { FinanceReceivableStatus, Prisma } from '@prisma/client';
import { RecordReceiveDto, UpdateFinanceReceivableDto } from './dto/finance-receivable.dto';

@Injectable()
export class FinanceReceivableService {
  private readonly structuredLogger = new StructuredLoggerService(FinanceReceivableService.name);
  constructor(private prisma: PrismaService) {}

  async findAll(filters: {
    status?: FinanceReceivableStatus;
    financeCompany?: string;
    branchId?: string;
    search?: string;
    startDate?: string;
    endDate?: string;
    page?: number;
    limit?: number;
  }) {
    const { status, financeCompany, branchId, search, startDate, endDate, page = 1, limit = 20 } = filters;
    const safePage = Math.max(1, page);
    const safeLimit = Math.min(100, Math.max(1, limit));

    const where: Prisma.FinanceReceivableWhereInput = { deletedAt: null };
    if (status) where.status = status;
    if (financeCompany) where.financeCompany = financeCompany;
    if (branchId) where.branchId = branchId;
    if (startDate || endDate) {
      where.expectedDate = {};
      if (startDate) where.expectedDate.gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        where.expectedDate.lte = end;
      }
    }
    if (search) {
      where.OR = [
        { financeRefNumber: { contains: search, mode: 'insensitive' } },
        { bankRef: { contains: search, mode: 'insensitive' } },
        { sale: { saleNumber: { contains: search, mode: 'insensitive' } } },
        { sale: { customer: { name: { contains: search, mode: 'insensitive' } } } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.financeReceivable.findMany({
        where,
        include: {
          sale: {
            select: {
              id: true, saleNumber: true, saleType: true,
              sellingPrice: true, netAmount: true, financeCompany: true,
              financeAmount: true, downPaymentAmount: true, createdAt: true,
              customer: { select: { id: true, name: true, phone: true } },
              product: { select: { id: true, name: true, brand: true } },
              salesperson: { select: { id: true, name: true } },
            },
          },
          branch: { select: { id: true, name: true } },
          recordedBy: { select: { id: true, name: true } },
        },
        orderBy: { expectedDate: 'asc' },
        skip: (safePage - 1) * safeLimit,
        take: safeLimit,
      }),
      this.prisma.financeReceivable.count({ where }),
    ]);

    return { data, total, page: safePage, limit: safeLimit };
  }

  async findOne(id: string) {
    const record = await this.prisma.financeReceivable.findFirst({
      where: { id, deletedAt: null },
      include: {
        sale: {
          include: {
            customer: { select: { id: true, name: true, phone: true } },
            product: { select: { id: true, name: true, brand: true } },
            salesperson: { select: { id: true, name: true } },
          },
        },
        branch: { select: { id: true, name: true } },
        recordedBy: { select: { id: true, name: true } },
      },
    });
    if (!record) throw new NotFoundException('ไม่พบรายการเงินรับจากไฟแนนซ์');
    return record;
  }

  async recordReceive(id: string, dto: RecordReceiveDto, recordedById: string) {
    const record = await this.prisma.financeReceivable.findFirst({ where: { id, deletedAt: null } });
    if (!record) throw new NotFoundException('ไม่พบรายการเงินรับจากไฟแนนซ์');
    if (record.status === 'RECEIVED') {
      throw new BadRequestException('รายการนี้ได้รับเงินครบแล้ว');
    }

    const receivedAmount = new Prisma.Decimal(dto.receivedAmount);
    const netExpected = record.netExpectedAmount;

    const status: FinanceReceivableStatus = receivedAmount.gte(netExpected) ? 'RECEIVED' : 'PARTIALLY_RECEIVED';

    const updated = await this.prisma.financeReceivable.update({
      where: { id },
      data: {
        receivedAmount,
        receivedDate: new Date(dto.receivedDate),
        bankRef: dto.bankRef,
        note: dto.note ?? record.note,
        status,
        recordedById,
      },
      include: {
        sale: { select: { saleNumber: true } },
        branch: { select: { name: true } },
      },
    });
    this.structuredLogger.log('financeReceivable.received', {
      financeReceivableId: id,
      financeCompany: record.financeCompany,
      branchId: record.branchId,
      expectedAmount: Number(record.netExpectedAmount),
      receivedAmount: dto.receivedAmount,
      status,
      bankRef: dto.bankRef ?? null,
      recordedById,
    });
    return updated;
  }

  async update(id: string, dto: UpdateFinanceReceivableDto) {
    const record = await this.prisma.financeReceivable.findFirst({ where: { id, deletedAt: null } });
    if (!record) throw new NotFoundException('ไม่พบรายการเงินรับจากไฟแนนซ์');

    const data: Prisma.FinanceReceivableUpdateInput = {};
    if (dto.financeRefNumber !== undefined) data.financeRefNumber = dto.financeRefNumber;
    if (dto.expectedDate !== undefined) data.expectedDate = new Date(dto.expectedDate);
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.note !== undefined) data.note = dto.note;

    if (dto.commissionRate !== undefined) {
      const rate = new Prisma.Decimal(dto.commissionRate);
      const commissionAmount = record.expectedAmount.mul(rate);
      const netExpected = record.expectedAmount.sub(commissionAmount);
      data.commissionRate = rate;
      data.commissionAmount = commissionAmount;
      data.netExpectedAmount = netExpected;
    }

    return this.prisma.financeReceivable.update({
      where: { id },
      data,
      include: {
        sale: { select: { saleNumber: true } },
        branch: { select: { name: true } },
      },
    });
  }

  async getSummary(branchId?: string) {
    const where: Prisma.FinanceReceivableWhereInput = { deletedAt: null };
    if (branchId) where.branchId = branchId;

    const records = await this.prisma.financeReceivable.findMany({
      where,
      select: { status: true, netExpectedAmount: true, receivedAmount: true },
    });

    const summary = {
      totalPending: 0, totalReceived: 0, totalOverdue: 0, totalDisputed: 0,
      pendingAmount: new Prisma.Decimal(0), receivedAmount: new Prisma.Decimal(0),
      overdueAmount: new Prisma.Decimal(0), disputedAmount: new Prisma.Decimal(0),
    };

    for (const r of records) {
      switch (r.status) {
        case 'PENDING': case 'PARTIALLY_RECEIVED':
          summary.totalPending++;
          summary.pendingAmount = summary.pendingAmount.add(r.netExpectedAmount.sub(r.receivedAmount ?? new Prisma.Decimal(0)));
          break;
        case 'RECEIVED':
          summary.totalReceived++;
          summary.receivedAmount = summary.receivedAmount.add(r.receivedAmount ?? new Prisma.Decimal(0));
          break;
        case 'OVERDUE':
          summary.totalOverdue++;
          summary.overdueAmount = summary.overdueAmount.add(r.netExpectedAmount.sub(r.receivedAmount ?? new Prisma.Decimal(0)));
          break;
        case 'DISPUTED':
          summary.totalDisputed++;
          summary.disputedAmount = summary.disputedAmount.add(r.netExpectedAmount);
          break;
      }
    }

    return summary;
  }

  async getFinanceCompanies() {
    const companies = await this.prisma.financeReceivable.findMany({
      where: { deletedAt: null },
      select: { financeCompany: true },
      distinct: ['financeCompany'],
      orderBy: { financeCompany: 'asc' },
    });
    return companies.map((c) => c.financeCompany);
  }
}
