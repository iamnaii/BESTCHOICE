import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateExternalFinanceCompanyDto,
  UpdateExternalFinanceCompanyDto,
} from './dto/external-finance-company.dto';

@Injectable()
export class ExternalFinanceService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    return this.prisma.externalFinanceCompany.findMany({
      where: { deletedAt: null },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: string) {
    const co = await this.prisma.externalFinanceCompany.findFirst({
      where: { id, deletedAt: null },
    });
    if (!co) throw new NotFoundException('ไม่พบไฟแนนซ์ภายนอกนี้');
    return co;
  }

  async create(dto: CreateExternalFinanceCompanyDto) {
    return this.prisma.externalFinanceCompany.create({
      data: {
        name: dto.name,
        contactPerson: dto.contactPerson,
        contactPhone: dto.contactPhone,
        defaultCommissionRate: dto.defaultCommissionRate,
        bankAccountInfo: dto.bankAccountInfo as Prisma.InputJsonValue | undefined,
        notes: dto.notes,
        isActive: dto.isActive,
        taxId: dto.taxId,
        email: dto.email,
        lineOaId: dto.lineOaId,
        creditTermDays: dto.creditTermDays,
      },
    });
  }

  async update(id: string, dto: UpdateExternalFinanceCompanyDto) {
    await this.findOne(id);
    return this.prisma.externalFinanceCompany.update({
      where: { id },
      data: {
        name: dto.name,
        contactPerson: dto.contactPerson,
        contactPhone: dto.contactPhone,
        defaultCommissionRate: dto.defaultCommissionRate,
        bankAccountInfo: dto.bankAccountInfo as Prisma.InputJsonValue | undefined,
        notes: dto.notes,
        isActive: dto.isActive,
        taxId: dto.taxId,
        email: dto.email,
        lineOaId: dto.lineOaId,
        creditTermDays: dto.creditTermDays,
      },
    });
  }

  async softDelete(id: string) {
    await this.findOne(id);
    return this.prisma.externalFinanceCompany.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
