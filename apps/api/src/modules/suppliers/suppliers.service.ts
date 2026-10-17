import { productScopeWhere } from '../employee-access/access-query-scope';
import { purchaseOrderScopeWhere } from '../employee-access/access-procurement-scope';
import { domainAccessClient, currentDomainAccess, currentPermissionScope } from '../employee-access/access-execution-context';
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { paginatedResponse } from '../../common/helpers/pagination.helper';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto, PaymentMethodUpdateDto } from './dto/update-supplier.dto';
import { ContactResolverService } from '../contacts/contact-resolver.service';

@Injectable()
export class SuppliersService {
  private get prisma(): PrismaService { return domainAccessClient(this.basePrisma); }

  constructor(
    private basePrisma: PrismaService,
    private contactResolver: ContactResolverService,
  ) {}

  private sourceCounts() {
    const products = currentPermissionScope('products.read');
    const pos = currentPermissionScope('purchase-orders.read');
    return { products: products ? { where: { deletedAt: null, ...productScopeWhere(products) } } : true, purchaseOrders: pos ? { where: purchaseOrderScopeWhere(pos) } : true };
  }

  async findAll(search?: string, isActive?: string, page = 1, limit = 50) {
    const andConditions: Record<string, unknown>[] = [{ deletedAt: null }];

    if (isActive === 'true') {
      andConditions.push({ isActive: true });
    } else if (isActive === 'false') {
      andConditions.push({ isActive: false });
    }

    if (search) {
      const orConditions: Record<string, unknown>[] = [
        { name: { contains: search, mode: 'insensitive' } },
        { contactName: { contains: search, mode: 'insensitive' } },
        { nickname: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search } },
        { taxId: { contains: search } },
      ];

      // Also match phone with/without dash formatting
      const digits = search.replace(/\D/g, '');
      if (digits.length >= 3) {
        const formatted =
          digits.length <= 3
            ? digits
            : digits.length <= 6
              ? `${digits.slice(0, 3)}-${digits.slice(3)}`
              : `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
        if (formatted !== search) {
          orConditions.push({ phone: { contains: formatted } });
        }
      }

      andConditions.push({ OR: orConditions });
    }

    const where =
      andConditions.length > 0 ? { AND: andConditions } : {};

    const [data, total] = await Promise.all([
      this.prisma.supplier.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          _count: { select: this.sourceCounts() },
          paymentMethods: { orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] },
        },
      }),
      this.prisma.supplier.count({ where }),
    ]);

    return paginatedResponse(data, total, page, limit);
  }

  async findOne(id: string) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id },
      include: {
        _count: { select: this.sourceCounts() },
        paymentMethods: { orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] },
      },
    });
    if (!supplier || supplier.deletedAt) throw new NotFoundException('ไม่พบผู้จัดจำหน่าย');
    return supplier;
  }

  async create(dto: CreateSupplierDto) {
    const { paymentMethods, ...supplierData } = dto;
    // Resolve/create the Contact (party master) and link it on the new
    // supplier in the SAME transaction so the contact row and the supplier
    // FK are atomic. Suppliers are keyed by taxId (no national id).
    return this.prisma.$transaction(async (tx) => {
      const contact = await this.contactResolver.findOrCreateByNaturalKey(tx, {
        name: dto.name,
        taxId: dto.taxId ?? null,
        nationalIdHash: null,
        phone: dto.phone ?? null,
        role: 'SUPPLIER',
      });

      return tx.supplier.create({
        data: {
          ...supplierData,
          ...(currentDomainAccess() ? { accessCompanyCode: currentDomainAccess()!.scope.company } : {}),
          contactId: contact.id,
          paymentMethods: paymentMethods?.length
            ? {
                create: paymentMethods.map((pm, index) => ({
                  paymentMethod: pm.paymentMethod,
                  bankName: pm.bankName,
                  bankAccountName: pm.bankAccountName,
                  bankAccountNumber: pm.bankAccountNumber,
                  creditTermDays: pm.creditTermDays,
                  isDefault: pm.isDefault ?? index === 0,
                })),
              }
            : undefined,
        },
        include: {
          paymentMethods: true,
        },
      });
    });
  }

  async update(id: string, dto: UpdateSupplierDto) {
    await this.findOne(id);
    const { paymentMethods, ...supplierData } = dto;

    // T5-C18: Block bank-field edits when a non-CANCELLED PurchaseOrder
    // still points at this supplier. The PO carries bankAccountSnapshot +
    // bankNameSnapshot from its create-time, so historical POs are safe,
    // but live POs that still need paying must keep the same bank target
    // that was agreed with the supplier when the PO was issued.
    if (paymentMethods !== undefined) {
      const openPo = await this.prisma.purchaseOrder.count({
        where: {
          supplierId: id,
          deletedAt: null,
          status: { not: 'CANCELLED' },
        },
      });

      if (openPo > 0) {
        const existing = await this.prisma.supplierPaymentMethod.findMany({
          where: { supplierId: id, deletedAt: null },
          select: { bankName: true, bankAccountNumber: true },
        });
        const oldBanks = existing
          .map((pm) => `${pm.bankName ?? ''}|${pm.bankAccountNumber ?? ''}`)
          .sort()
          .join(';');
        const newBanks = (paymentMethods as PaymentMethodUpdateDto[])
          .map((pm) => `${pm.bankName ?? ''}|${pm.bankAccountNumber ?? ''}`)
          .sort()
          .join(';');
        if (oldBanks !== newBanks) {
          throw new BadRequestException(
            `ไม่สามารถแก้บัญชีธนาคารของผู้จัดจำหน่ายนี้ได้ เพราะยังมีใบสั่งซื้อ (PO) ที่ยังไม่ยกเลิกอยู่ ${openPo} ใบ — กรุณายกเลิก PO ที่เปิดอยู่ก่อนแก้ไขข้อมูลธนาคาร`,
          );
        }
      }
    }

    return this.prisma.$transaction(async (tx) => {
      // Update supplier fields
      const supplier = await tx.supplier.update({
        where: { id },
        data: supplierData,
      });

      // If paymentMethods is provided, replace all payment methods
      if (paymentMethods !== undefined) {
        // Soft delete existing payment methods (preserve audit trail)
        await tx.supplierPaymentMethod.updateMany({
          where: { supplierId: id, deletedAt: null },
          data: { deletedAt: new Date() },
        });

        // Create new payment methods
        if (paymentMethods.length > 0) {
          await tx.supplierPaymentMethod.createMany({
            data: paymentMethods.map((pm, index) => ({
              supplierId: id,
              paymentMethod: pm.paymentMethod,
              bankName: pm.bankName,
              bankAccountName: pm.bankAccountName,
              bankAccountNumber: pm.bankAccountNumber,
              creditTermDays: pm.creditTermDays,
              isDefault: pm.isDefault ?? index === 0,
            })),
          });
        }
      }

      // Return with payment methods
      return tx.supplier.findUnique({
        where: { id: supplier.id },
        include: {
          _count: { select: this.sourceCounts() },
          paymentMethods: { orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] },
        },
      });
    });
  }

  async markRepairCenter(id: string) {
    const count = await this.prisma.supplier.count({ where: { id, deletedAt: null } });
    if (count === 0) throw new NotFoundException('ไม่พบผู้จัดจำหน่าย');
    return this.prisma.supplier.update({
      where: { id },
      data: { isRepairCenter: true },
      select: { id: true, isRepairCenter: true },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.supplier.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
  }

  async getPurchaseHistory(id: string, page = 1, limit = 50) {
    const safeLimit = Math.min(limit, 100);
    await this.findOne(id);

    const productScope = currentPermissionScope('products.read');
    const poScope = currentPermissionScope('purchase-orders.read');
    const productWhere = { supplierId: id, deletedAt: null, ...(productScope ? productScopeWhere(productScope) : {}) };
    const poWhere = { supplierId: id, ...(poScope ? purchaseOrderScopeWhere(poScope) : {}) };

    const [products, productTotal, purchaseOrders, poTotal] = await Promise.all([
      this.prisma.product.findMany({
        where: productWhere,
        select: {
          id: true,
          name: true,
          brand: true,
          model: true,
          imeiSerial: true,
          category: true,
          costPrice: true,
          status: true,
          createdAt: true,
          branch: { select: { id: true, name: true } },
          po: { select: { id: true, poNumber: true, orderDate: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * safeLimit,
        take: safeLimit,
      }),
      this.prisma.product.count({ where: productWhere }),
      this.prisma.purchaseOrder.findMany({
        where: poWhere,
        select: {
          id: true,
          poNumber: true,
          orderDate: true,
          expectedDate: true,
          status: true,
          totalAmount: true,
          paymentStatus: true,
          paymentMethod: true,
          paidAmount: true,
          notes: true,
          createdAt: true,
          createdBy: { select: { id: true, name: true } },
          items: true,
          _count: { select: { products: true } },
        },
        orderBy: { orderDate: 'desc' },
        skip: (page - 1) * safeLimit,
        take: safeLimit,
      }),
      this.prisma.purchaseOrder.count({ where: poWhere }),
    ]);

    return {
      products: { data: products, total: productTotal, page, limit: safeLimit },
      purchaseOrders: { data: purchaseOrders, total: poTotal, page, limit: safeLimit },
    };
  }
}
