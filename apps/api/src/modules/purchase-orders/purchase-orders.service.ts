import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePODto, UpdatePODto, ReceivePODto, GoodsReceivingDto, UpdatePaymentDto } from './dto/create-po.dto';

@Injectable()
export class PurchaseOrdersService {
  constructor(private prisma: PrismaService) {}

  async findAll(filters: { status?: string; supplierId?: string }) {
    const where: Record<string, unknown> = {};
    if (filters.status) where.status = filters.status;
    if (filters.supplierId) where.supplierId = filters.supplierId;

    return this.prisma.purchaseOrder.findMany({
      where,
      include: {
        supplier: { select: { id: true, name: true, contactName: true, phone: true, hasVat: true } },
        createdBy: { select: { id: true, name: true } },
        approvedBy: { select: { id: true, name: true } },
        items: true,
        _count: { select: { products: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id },
      include: {
        supplier: true,
        createdBy: { select: { id: true, name: true } },
        approvedBy: { select: { id: true, name: true } },
        items: {
          include: {
            receivingItems: {
              include: {
                product: { select: { id: true, name: true, imeiSerial: true, serialNumber: true, status: true, branchId: true } },
              },
            },
          },
        },
        products: {
          select: { id: true, name: true, brand: true, model: true, imeiSerial: true, serialNumber: true, photos: true, status: true, costPrice: true, branchId: true },
        },
        goodsReceivings: {
          include: {
            receivedBy: { select: { id: true, name: true } },
            items: true,
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!po) throw new NotFoundException('ไม่พบใบสั่งซื้อ');
    return po;
  }

  async create(dto: CreatePODto, userId: string) {
    // Validate supplier exists
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: dto.supplierId },
      select: { hasVat: true },
    });
    if (!supplier) throw new NotFoundException('ไม่พบ Supplier');

    // Generate PO number: YYYYMMDD-NNN format
    const today = new Date();
    const datePrefix = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const todayEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
    const todayCount = await this.prisma.purchaseOrder.count({
      where: {
        createdAt: { gte: todayStart, lt: todayEnd },
      },
    });
    const poNumber = `${datePrefix}${String(todayCount + 1).padStart(3, '0')}`;

    // Calculate total with discount & VAT
    const totalAmount = dto.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
    const discount = dto.discount || 0;
    const subtotalAfterDiscount = totalAmount - discount;
    const vatAmount = Math.round(subtotalAfterDiscount * 0.07 * 100) / 100;
    const netAmount = subtotalAfterDiscount + vatAmount;

    return this.prisma.purchaseOrder.create({
      data: {
        poNumber,
        supplierId: dto.supplierId,
        orderDate: new Date(dto.orderDate),
        expectedDate: dto.expectedDate ? new Date(dto.expectedDate) : null,
        totalAmount,
        discount,
        vatAmount,
        netAmount,
        notes: dto.notes,
        createdById: userId,
        status: 'PENDING',
        paymentStatus: (dto.paymentStatus as any) || 'UNPAID',
        paymentMethod: dto.paymentMethod || null,
        paidAmount: dto.paidAmount || 0,
        paymentNotes: dto.paymentNotes || null,
        attachments: dto.attachments || [],
        items: {
          create: dto.items.map((item) => ({
            brand: item.brand,
            model: item.model,
            color: item.color || null,
            storage: item.storage || null,
            category: item.category || null,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
          })),
        },
      },
      include: {
        supplier: { select: { id: true, name: true, hasVat: true } },
        items: true,
      },
    });
  }

  async update(id: string, dto: UpdatePODto) {
    const po = await this.findOne(id);
    if (!['DRAFT', 'PENDING'].includes(po.status)) {
      throw new BadRequestException('แก้ไขได้เฉพาะ PO สถานะร่างหรือรอรับสินค้าเท่านั้น');
    }

    const data: Record<string, unknown> = {};
    if (dto.expectedDate) data.expectedDate = new Date(dto.expectedDate);
    if (dto.notes !== undefined) data.notes = dto.notes;

    return this.prisma.purchaseOrder.update({
      where: { id },
      data,
      include: { items: true },
    });
  }

  async approve(id: string, userId: string) {
    const po = await this.findOne(id);
    if (po.status !== 'DRAFT') {
      throw new BadRequestException('อนุมัติได้เฉพาะ PO สถานะ DRAFT เท่านั้น');
    }

    return this.prisma.purchaseOrder.update({
      where: { id },
      data: { status: 'APPROVED', approvedById: userId },
      include: {
        supplier: { select: { id: true, name: true } },
        items: true,
      },
    });
  }

  async cancel(id: string) {
    const po = await this.findOne(id);
    if (!['DRAFT', 'APPROVED', 'PENDING'].includes(po.status)) {
      throw new BadRequestException('ยกเลิกได้เฉพาะ PO ที่ยังไม่ได้รับสินค้าเท่านั้น');
    }

    return this.prisma.purchaseOrder.update({
      where: { id },
      data: { status: 'CANCELLED' },
    });
  }

  async updatePayment(id: string, dto: UpdatePaymentDto) {
    const po = await this.findOne(id);
    if (po.status === 'CANCELLED') {
      throw new BadRequestException('ไม่สามารถอัปเดตการจ่ายเงินของ PO ที่ยกเลิกแล้วได้');
    }

    return this.prisma.purchaseOrder.update({
      where: { id },
      data: {
        paymentStatus: dto.paymentStatus as any,
        paymentMethod: dto.paymentMethod || null,
        paidAmount: dto.paidAmount,
        paymentNotes: dto.paymentNotes || null,
        ...(dto.attachments !== undefined && { attachments: dto.attachments }),
      },
      include: {
        supplier: { select: { id: true, name: true } },
        items: true,
      },
    });
  }

  /**
   * Legacy receive - kept for backward compatibility
   */
  async receive(id: string, dto: ReceivePODto, userId: string, branchId: string) {
    return this.prisma.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.findUnique({
        where: { id },
        include: { items: true, supplier: true },
      });

      if (!po) throw new NotFoundException('ไม่พบใบสั่งซื้อ');
      if (!['APPROVED', 'PARTIALLY_RECEIVED'].includes(po.status)) {
        throw new BadRequestException('PO นี้ไม่อยู่ในสถานะที่สามารถรับสินค้าได้');
      }

      const receivedProducts: any[] = [];

      for (const receiveItem of dto.items) {
        const poItem = po.items.find((i) => i.id === receiveItem.poItemId);
        if (!poItem) {
          throw new NotFoundException(`ไม่พบรายการ PO: ${receiveItem.poItemId}`);
        }

        const totalReceived = poItem.receivedQty + receiveItem.receivedQty;
        if (totalReceived > poItem.quantity) {
          throw new BadRequestException(
            `จำนวนรับเกิน: ${poItem.brand} ${poItem.model} (สั่ง ${poItem.quantity}, รับแล้ว ${poItem.receivedQty}, กำลังรับ ${receiveItem.receivedQty})`,
          );
        }

        await tx.pOItem.update({
          where: { id: receiveItem.poItemId },
          data: { receivedQty: totalReceived },
        });

        for (let i = 0; i < receiveItem.receivedQty; i++) {
          const nameParts = [poItem.brand, poItem.model, poItem.color, poItem.storage].filter(Boolean);
          const productCategory = (poItem.category as any) || 'PHONE_NEW';
          const product = await tx.product.create({
            data: {
              name: nameParts.join(' '),
              brand: poItem.brand,
              model: poItem.model,
              color: poItem.color || null,
              storage: poItem.storage || null,
              category: productCategory,
              costPrice: Number(poItem.unitPrice),
              supplierId: po.supplierId,
              poId: po.id,
              branchId,
              status: 'PO_RECEIVED',
            },
          });
          receivedProducts.push(product);
        }
      }

      const updatedPO = await tx.purchaseOrder.findUnique({
        where: { id },
        include: { items: true },
      });

      const allReceived = updatedPO!.items.every((item) => item.receivedQty >= item.quantity);
      const newStatus = allReceived ? 'FULLY_RECEIVED' : 'PARTIALLY_RECEIVED';

      await tx.purchaseOrder.update({
        where: { id },
        data: { status: newStatus },
      });

      return {
        poId: id,
        status: newStatus,
        receivedProducts: receivedProducts.length,
        products: receivedProducts,
      };
    });
  }

  /**
   * New goods receiving flow with IMEI/Serial/photos/pass-reject per unit
   */
  async goodsReceiving(id: string, dto: GoodsReceivingDto, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.findUnique({
        where: { id },
        include: { items: true, supplier: true },
      });

      if (!po) throw new NotFoundException('ไม่พบใบสั่งซื้อ');
      if (!['PENDING', 'APPROVED', 'PARTIALLY_RECEIVED'].includes(po.status)) {
        throw new BadRequestException('PO นี้ไม่อยู่ในสถานะที่สามารถรับสินค้าได้');
      }

      // Find main warehouse branch
      let mainWarehouse = await tx.branch.findFirst({
        where: { isMainWarehouse: true, isActive: true },
      });
      if (!mainWarehouse) {
        // Fallback: use first active branch
        mainWarehouse = await tx.branch.findFirst({
          where: { isActive: true },
          orderBy: { createdAt: 'asc' },
        });
      }
      if (!mainWarehouse) {
        throw new BadRequestException('ไม่พบคลังกลาง กรุณาตั้งค่าสาขาคลังกลางก่อน');
      }

      // Create goods receiving record
      const receiving = await tx.goodsReceiving.create({
        data: {
          poId: id,
          receivedById: userId,
          notes: dto.notes,
        },
      });

      const passedProducts: any[] = [];
      const rejectedItems: any[] = [];

      // Group items by poItemId to count per PO item
      const countByPoItem: Record<string, number> = {};
      for (const item of dto.items) {
        if (item.status === 'PASS') {
          countByPoItem[item.poItemId] = (countByPoItem[item.poItemId] || 0) + 1;
        }
      }

      // Validate quantities
      for (const [poItemId, passCount] of Object.entries(countByPoItem)) {
        const poItem = po.items.find((i) => i.id === poItemId);
        if (!poItem) throw new NotFoundException(`ไม่พบรายการ PO: ${poItemId}`);

        const totalReceived = poItem.receivedQty + passCount;
        if (totalReceived > poItem.quantity) {
          throw new BadRequestException(
            `จำนวนรับเกิน: ${poItem.brand} ${poItem.model} (สั่ง ${poItem.quantity}, รับแล้ว ${poItem.receivedQty}, กำลังรับ ${passCount})`,
          );
        }
      }

      // Process each item
      for (const item of dto.items) {
        const poItem = po.items.find((i) => i.id === item.poItemId);
        if (!poItem) throw new NotFoundException(`ไม่พบรายการ PO: ${item.poItemId}`);

        if (item.status === 'PASS') {
          // Build product name from PO item details
          const nameParts = [poItem.brand, poItem.model, poItem.color, poItem.storage].filter(Boolean);
          const productCategory = (poItem.category as any) || 'PHONE_NEW';

          // Create product for passed items → goes to main warehouse with IN_STOCK
          const product = await tx.product.create({
            data: {
              name: nameParts.join(' '),
              brand: poItem.brand,
              model: poItem.model,
              color: poItem.color || null,
              storage: poItem.storage || null,
              category: productCategory,
              costPrice: Number(poItem.unitPrice),
              supplierId: po.supplierId,
              poId: po.id,
              branchId: mainWarehouse!.id,
              status: 'IN_STOCK',
              imeiSerial: item.imeiSerial || null,
              serialNumber: item.serialNumber || null,
              photos: item.photos || [],
            },
          });

          // Create receiving item linked to product
          await tx.goodsReceivingItem.create({
            data: {
              receivingId: receiving.id,
              poItemId: item.poItemId,
              imeiSerial: item.imeiSerial,
              serialNumber: item.serialNumber,
              photos: item.photos || [],
              status: 'PASS',
              productId: product.id,
            },
          });

          passedProducts.push(product);
        } else {
          // Create receiving item for rejected items (no product created)
          const rejectedItem = await tx.goodsReceivingItem.create({
            data: {
              receivingId: receiving.id,
              poItemId: item.poItemId,
              imeiSerial: item.imeiSerial,
              serialNumber: item.serialNumber,
              photos: item.photos || [],
              status: 'REJECT',
              rejectReason: item.rejectReason,
            },
          });

          rejectedItems.push(rejectedItem);
        }
      }

      // Update PO item received quantities (only passed items count)
      for (const [poItemId, passCount] of Object.entries(countByPoItem)) {
        const poItem = po.items.find((i) => i.id === poItemId)!;
        await tx.pOItem.update({
          where: { id: poItemId },
          data: { receivedQty: poItem.receivedQty + passCount },
        });
      }

      // Check if all items fully received
      const updatedPO = await tx.purchaseOrder.findUnique({
        where: { id },
        include: { items: true },
      });

      const allReceived = updatedPO!.items.every((item) => item.receivedQty >= item.quantity);
      const newStatus = allReceived ? 'FULLY_RECEIVED' : 'PARTIALLY_RECEIVED';

      await tx.purchaseOrder.update({
        where: { id },
        data: { status: newStatus },
      });

      return {
        receivingId: receiving.id,
        poId: id,
        status: newStatus,
        passed: passedProducts.length,
        rejected: rejectedItems.length,
        products: passedProducts,
        mainWarehouse: mainWarehouse!.name,
      };
    });
  }
}
