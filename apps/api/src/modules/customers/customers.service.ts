import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCustomerDto, UpdateCustomerDto } from './dto/customer.dto';

@Injectable()
export class CustomersService {
  constructor(private prisma: PrismaService) {}

  async findAll(search?: string, page = 1, limit = 50) {
    const where: Record<string, unknown> = { deletedAt: null };

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search } },
        { nationalId: { contains: search } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.customer.findMany({
        where,
        orderBy: { createdAt: 'desc' },
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

    return { data: enriched, total, page, limit, totalPages: Math.ceil(total / limit) };
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
        _count: { select: { contracts: true } },
      },
    });
    if (!customer || customer.deletedAt) throw new NotFoundException('ไม่พบลูกค้า');
    return customer;
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
