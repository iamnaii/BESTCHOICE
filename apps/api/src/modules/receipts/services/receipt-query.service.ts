import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { Prisma } from '@prisma/client';

/** Read-only receipt queries (list, by-contract, by-id, by-number). */
export class ReceiptQueryService {
  constructor(private prisma: PrismaService) {}

  /** List receipts with search, filter, pagination */
  async findAll(filters: {
    search?: string;
    receiptType?: string;
    dateFrom?: string;
    dateTo?: string;
    branchId?: string;
    page?: number;
    limit?: number;
  }) {
    const page = filters.page || 1;
    const limit = Math.min(filters.limit || 20, 200);
    const where: Prisma.ReceiptWhereInput = { deletedAt: null, isVoided: false };

    if (filters.search) {
      where.OR = [
        { receiptNumber: { contains: filters.search, mode: 'insensitive' } },
        { payerName: { contains: filters.search, mode: 'insensitive' } },
        { contract: { contractNumber: { contains: filters.search, mode: 'insensitive' } } },
        { contract: { customer: { phone: { contains: filters.search } } } },
      ];
    }

    if (filters.receiptType) {
      where.receiptType = filters.receiptType;
    }

    if (filters.dateFrom || filters.dateTo) {
      where.paidDate = {};
      if (filters.dateFrom) {
        where.paidDate.gte = new Date(filters.dateFrom);
      }
      if (filters.dateTo) {
        const endDate = new Date(filters.dateTo);
        endDate.setHours(23, 59, 59, 999);
        where.paidDate.lte = endDate;
      }
    }

    if (filters.branchId) {
      where.contract = {
        ...(typeof where.contract === 'object' ? where.contract : {}),
        branchId: filters.branchId,
      } as Prisma.ContractWhereInput;
    }

    const [data, total, summary] = await Promise.all([
      this.prisma.receipt.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          contract: {
            select: {
              contractNumber: true,
              customer: { select: { name: true } },
            },
          },
        },
      }),
      this.prisma.receipt.count({ where }),
      this.prisma.receipt.aggregate({
        where,
        _sum: { amount: true },
        _count: true,
      }),
    ]);

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      summary: {
        totalAmount: summary._sum.amount || 0,
        totalCount: summary._count,
      },
    };
  }

  /** Get receipts for a contract */
  async getContractReceipts(contractId: string) {
    return this.prisma.receipt.findMany({
      where: { contractId, deletedAt: null, isVoided: false },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Get a single receipt */
  async getReceipt(id: string) {
    const receipt = await this.prisma.receipt.findUnique({
      where: { id },
      include: {
        contract: {
          select: {
            contractNumber: true,
            customer: {
              select: {
                name: true,
                phone: true,
                email: true,
                nationalId: true,
                addressIdCard: true,
                addressCurrent: true,
              },
            },
            branch: {
              select: { id: true, name: true, location: true, phone: true },
            },
            product: {
              select: { id: true, name: true, imeiSerial: true, serialNumber: true },
            },
          },
        },
      },
    });
    if (!receipt || receipt.deletedAt) throw new NotFoundException('ไม่พบใบเสร็จ');

    const company = await this.prisma.companyInfo.findFirst({
      where: { isActive: true, deletedAt: null },
      select: {
        nameTh: true,
        nameEn: true,
        taxId: true,
        address: true,
        phone: true,
        logoUrl: true,
        bankName: true,
        bankAccountName: true,
        bankAccountNumber: true,
      },
    });

    const issuer = await this.prisma.user.findUnique({
      where: { id: receipt.issuedById },
      select: { name: true, role: true },
    });

    // Look up the underlying installment to derive partial-payment context
    const payment = receipt.paymentId
      ? await this.prisma.payment.findUnique({
          where: { id: receipt.paymentId },
          select: { amountDue: true, lateFee: true, amountPaid: true, status: true },
        })
      : null;

    return { ...receipt, company, issuer, payment };
  }

  /** Get receipt by number */
  async getReceiptByNumber(receiptNumber: string) {
    const receipt = await this.prisma.receipt.findUnique({
      where: { receiptNumber },
      include: {
        contract: {
          select: {
            contractNumber: true,
            customer: { select: { name: true } },
            branch: {
              select: {
                id: true,
                name: true,
                location: true,
                phone: true,
              },
            },
            product: {
              select: {
                id: true,
                name: true,
                imeiSerial: true,
                serialNumber: true,
              },
            },
          },
        },
      },
    });
    if (!receipt || receipt.deletedAt) throw new NotFoundException('ไม่พบใบเสร็จ');

    // Get company info
    const company = await this.prisma.companyInfo.findFirst({
      where: { isActive: true, deletedAt: null },
      select: {
        nameTh: true,
        nameEn: true,
        taxId: true,
        address: true,
        phone: true,
        logoUrl: true,
      },
    });

    return { ...receipt, company };
  }
}
