import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateFinanceCompanyContactDto,
  UpdateFinanceCompanyContactDto,
} from './dto/finance-company-contact.dto';

@Injectable()
export class FinanceCompanyContactsService {
  constructor(private prisma: PrismaService) {}

  async list(companyId: string) {
    return this.prisma.financeCompanyContact.findMany({
      where: { externalFinanceCompanyId: companyId, deletedAt: null },
      orderBy: [{ isPrimary: 'desc' }, { isActive: 'desc' }, { name: 'asc' }],
    });
  }

  async create(companyId: string, dto: CreateFinanceCompanyContactDto) {
    const company = await this.prisma.externalFinanceCompany.findFirst({
      where: { id: companyId, deletedAt: null },
    });
    if (!company) throw new NotFoundException('ไม่พบบริษัทไฟแนนซ์');

    return this.prisma.$transaction(async (tx) => {
      if (dto.isPrimary) {
        await tx.financeCompanyContact.updateMany({
          where: { externalFinanceCompanyId: companyId, isPrimary: true, deletedAt: null },
          data: { isPrimary: false },
        });
      }
      return tx.financeCompanyContact.create({
        data: {
          externalFinanceCompanyId: companyId,
          name: dto.name,
          position: dto.position,
          department: dto.department,
          phone: dto.phone,
          email: dto.email,
          lineId: dto.lineId,
          notes: dto.notes,
          isPrimary: dto.isPrimary ?? false,
        },
      });
    });
  }

  async update(companyId: string, contactId: string, dto: UpdateFinanceCompanyContactDto) {
    const existing = await this.prisma.financeCompanyContact.findFirst({
      where: { id: contactId, externalFinanceCompanyId: companyId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('ไม่พบผู้ติดต่อ');

    return this.prisma.$transaction(async (tx) => {
      if (dto.isPrimary === true && !existing.isPrimary) {
        await tx.financeCompanyContact.updateMany({
          where: { externalFinanceCompanyId: companyId, isPrimary: true, deletedAt: null },
          data: { isPrimary: false },
        });
      }
      return tx.financeCompanyContact.update({
        where: { id: contactId },
        data: dto,
      });
    });
  }

  async setPrimary(companyId: string, contactId: string) {
    const contact = await this.prisma.financeCompanyContact.findFirst({
      where: { id: contactId, externalFinanceCompanyId: companyId, deletedAt: null },
    });
    if (!contact) throw new NotFoundException('ไม่พบผู้ติดต่อ');

    return this.prisma.$transaction(async (tx) => {
      // Row-lock the company to serialise concurrent setPrimary calls
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM external_finance_companies WHERE id = ${companyId} FOR UPDATE`,
      );
      await tx.financeCompanyContact.updateMany({
        where: { externalFinanceCompanyId: companyId, isPrimary: true, deletedAt: null },
        data: { isPrimary: false },
      });
      return tx.financeCompanyContact.update({
        where: { id: contactId },
        data: { isPrimary: true },
      });
    });
  }

  async softDelete(companyId: string, contactId: string) {
    const contact = await this.prisma.financeCompanyContact.findFirst({
      where: { id: contactId, externalFinanceCompanyId: companyId, deletedAt: null },
    });
    if (!contact) throw new NotFoundException('ไม่พบผู้ติดต่อ');

    if (contact.isPrimary) {
      const others = await this.prisma.financeCompanyContact.count({
        where: {
          externalFinanceCompanyId: companyId,
          deletedAt: null,
          isActive: true,
          NOT: { id: contactId },
        },
      });
      if (others > 0) {
        throw new BadRequestException(
          'ไม่สามารถลบผู้ติดต่อหลักได้ — กรุณาตั้งผู้ติดต่อหลักคนใหม่ก่อน',
        );
      }
    }

    return this.prisma.financeCompanyContact.update({
      where: { id: contactId },
      data: { deletedAt: new Date() },
    });
  }
}
