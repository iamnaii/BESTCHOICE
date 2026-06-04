import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ContactRole, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ContactResolverService } from './contact-resolver.service';
import { ListContactsDto } from './dto/list-contacts.dto';
import { MergeContactsDto } from './dto/merge-contacts.dto';

@Injectable()
export class ContactsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly contactResolver: ContactResolverService,
  ) {}

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
        customers: {
          where: { deletedAt: null },
          // identity + non-sensitive only — NO encrypted address PII (deep-link to /customers/:id for full detail)
          select: { id: true, name: true, prefix: true, phone: true },
        },
        suppliers: {
          where: { deletedAt: null },
          select: {
            id: true, name: true, type: true, taxId: true, branchCode: true,
            contactName: true, contactPhone: true, phone: true, hasVat: true, address: true,
          },
        },
        tradeInsAsSeller: {
          where: { deletedAt: null },
          select: { id: true, sellerName: true, sellerPhone: true, createdAt: true },
        },
        externalFinanceCompany: {
          where: { deletedAt: null },
          select: { id: true, name: true, taxId: true, contactPhone: true, email: true, creditTermDays: true },
        },
      },
    });
    if (!contact) throw new NotFoundException('ไม่พบผู้ติดต่อ');
    return contact;
  }

  async merge(
    dto: MergeContactsDto,
    actor?: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
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
      // Primary-wins coalesce — never overwrite an identity field already set on
      // the primary; only fill the gaps from the duplicate.
      const carry = {
        taxId: primary.taxId ?? duplicate.taxId,
        nationalIdHash: primary.nationalIdHash ?? duplicate.nationalIdHash,
        peakContactCode: primary.peakContactCode ?? duplicate.peakContactCode,
        phone: primary.phone ?? duplicate.phone,
        email: primary.email ?? duplicate.email,
      };
      // ORDER MATTERS: soft-delete the duplicate FIRST so it leaves the
      // partial-unique scope (WHERE deleted_at IS NULL) before we carry its
      // tax_id/national_id_hash onto the primary — otherwise two ACTIVE rows
      // would briefly hold the same key and trip the partial-unique index (P2002).
      await tx.contact.update({
        where: { id: duplicateId },
        data: { deletedAt: new Date() },
      });
      await tx.contact.update({
        where: { id: primaryId },
        data: { roles: { set: unionRoles }, ...carry },
      });

      await this.audit.log({
        userId: actor?.userId,
        action: 'CONTACTS_MERGED',
        entity: 'contact',
        entityId: primaryId,
        // Capture the duplicate's pre-merge identity so the irreversible
        // soft-delete + carry remains fully traceable.
        oldValue: {
          duplicate: {
            id: duplicate.id,
            contactCode: duplicate.contactCode,
            name: duplicate.name,
            taxId: duplicate.taxId,
            nationalIdHash: duplicate.nationalIdHash,
            peakContactCode: duplicate.peakContactCode,
            phone: duplicate.phone,
            email: duplicate.email,
            roles: duplicate.roles,
          },
        },
        newValue: { duplicateId, mergedRoles: unionRoles, carried: carry },
        ipAddress: actor?.ipAddress,
        userAgent: actor?.userAgent,
      });

      return { primaryId, mergedRoles: unionRoles };
    });
  }

  async ensureRole(
    id: string,
    role: 'SUPPLIER' | 'CUSTOMER' | 'TRADE_IN_SELLER',
    actor: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    const result = await this.prisma.$transaction((tx) =>
      // role is the narrow caller union (⊆ ContactRole); cast bridges Prisma's
      // enum type. Resolver guards non-SUPPLIER roles at runtime.
      this.contactResolver.ensureRole(tx, id, role as ContactRole),
    );

    if (result.provisioned) {
      await this.audit.log({
        userId: actor.userId,
        action: 'CONTACT_ROLE_ADDED',
        entity: 'contact',
        entityId: id,
        newValue: {
          role: result.role,
          supplierId: result.supplierId,
          ...(result.customerId !== undefined && { customerId: result.customerId }),
        },
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      });
    }

    return result;
  }
}
