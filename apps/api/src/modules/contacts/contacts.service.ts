import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ContactRole, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ListContactsDto } from './dto/list-contacts.dto';
import { MergeContactsDto } from './dto/merge-contacts.dto';

@Injectable()
export class ContactsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(dto: ListContactsDto) {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 50;

    const where: Prisma.ContactWhereInput = { deletedAt: null };
    if (dto.role) where.roles = { has: dto.role };
    if (dto.isActive !== undefined) where.isActive = dto.isActive === 'true';
    if (dto.search) {
      where.OR = [
        { name: { contains: dto.search, mode: 'insensitive' } },
        { phone: { contains: dto.search, mode: 'insensitive' } },
        { taxId: { contains: dto.search, mode: 'insensitive' } },
        { contactCode: { contains: dto.search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.contact.findMany({
        where,
        orderBy: { contactCode: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.contact.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  async findOne(id: string) {
    const contact = await this.prisma.contact.findFirst({
      where: { id, deletedAt: null },
      include: {
        customers: { where: { deletedAt: null }, select: { id: true, name: true } },
        suppliers: { where: { deletedAt: null }, select: { id: true, name: true } },
        tradeInsAsSeller: { select: { id: true, createdAt: true } },
        externalFinanceCompany: { where: { deletedAt: null }, select: { id: true, name: true } },
      },
    });
    if (!contact) throw new NotFoundException('ไม่พบผู้ติดต่อ');
    return contact;
  }

  async merge(dto: MergeContactsDto) {
    const { primaryId, duplicateId } = dto;
    if (primaryId === duplicateId) {
      throw new BadRequestException('ไม่สามารถรวมผู้ติดต่อกับตัวเองได้');
    }

    return this.prisma.$transaction(async (tx) => {
      const contacts = await tx.contact.findMany({
        where: { id: { in: [primaryId, duplicateId] }, deletedAt: null },
      });
      const primary = contacts.find((c) => c.id === primaryId);
      const duplicate = contacts.find((c) => c.id === duplicateId);
      if (!primary || !duplicate) {
        throw new NotFoundException('ไม่พบผู้ติดต่อที่จะรวม');
      }

      // Repoint role records from duplicate -> primary
      await tx.customer.updateMany({
        where: { contactId: duplicateId },
        data: { contactId: primaryId },
      });
      await tx.supplier.updateMany({
        where: { contactId: duplicateId },
        data: { contactId: primaryId },
      });
      await tx.tradeIn.updateMany({
        where: { sellerContactId: duplicateId },
        data: { sellerContactId: primaryId },
      });
      await tx.externalFinanceCompany.updateMany({
        where: { contactId: duplicateId },
        data: { contactId: primaryId },
      });

      const unionRoles = Array.from(
        new Set<ContactRole>([...primary.roles, ...duplicate.roles]),
      );
      await tx.contact.update({
        where: { id: primaryId },
        data: { roles: { set: unionRoles } },
      });
      await tx.contact.update({
        where: { id: duplicateId },
        data: { deletedAt: new Date() },
      });

      return { primaryId, mergedRoles: unionRoles };
    });
  }
}
