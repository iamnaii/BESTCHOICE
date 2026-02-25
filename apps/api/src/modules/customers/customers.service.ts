import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

@Injectable()
export class CustomersService {
  constructor(private prisma: PrismaService) {}

  async findAll(query: { search?: string }) {
    const where: any = { deletedAt: null };

    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { phone: { contains: query.search } },
        { nationalId: { contains: query.search } },
      ];
    }

    return this.prisma.customer.findMany({
      where,
      include: {
        contracts: {
          select: { id: true, contractNumber: true, status: true, sellingPrice: true },
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id },
      include: {
        contracts: {
          where: { deletedAt: null },
          include: {
            product: { select: { id: true, name: true, brand: true, model: true } },
            payments: { orderBy: { installmentNo: 'asc' } },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!customer || customer.deletedAt) throw new NotFoundException('ไม่พบลูกค้า');
    return customer;
  }

  async create(dto: CreateCustomerDto) {
    const existing = await this.prisma.customer.findUnique({
      where: { nationalId: dto.nationalId },
    });
    if (existing && !existing.deletedAt) {
      throw new ConflictException('เลขบัตรประชาชนนี้มีในระบบแล้ว');
    }

    return this.prisma.customer.create({
      data: {
        nationalId: dto.nationalId,
        name: dto.name,
        phone: dto.phone,
        phoneSecondary: dto.phoneSecondary,
        lineId: dto.lineId,
        addressIdCard: dto.addressIdCard,
        addressCurrent: dto.addressCurrent,
        occupation: dto.occupation,
        workplace: dto.workplace,
        documents: dto.documents || [],
      },
    });
  }

  async update(id: string, dto: UpdateCustomerDto) {
    await this.findOne(id);
    return this.prisma.customer.update({
      where: { id },
      data: dto,
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.customer.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
