import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePODto, UpdatePODto, ReceivePODto } from './dto/create-po.dto';

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
        supplier: { select: { id: true, name: true, contactName: true, phone: true } },
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
        items: true,
        products: {
          select: { id: true, name: true, brand: true, model: true, imeiSerial: true, status: true, costPrice: true },
        },
      },
    });
    if (!po) throw new NotFoundException('ไม่พบใบสั่งซื้อ');
    return po;
  }

  async create(dto: CreatePODto, userId: string) {
    // Generate PO number
    const lastPO = await this.prisma.purchaseOrder.findFirst({
      orderBy: { poNumber: 'desc' },
      select: { poNumber: true },
    });
    const nextNum = lastPO ? parseInt(lastPO.poNumber.replace(/\D/g, '')) + 1 : 1;
    const poNumber = `PO${String(nextNum).padStart(6, '0')}`;

    // Calculate total
    const totalAmount = dto.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);

    return this.prisma.purchaseOrder.create({
      data: {
        poNumber,
        supplierId: dto.supplierId,
        orderDate: new Date(dto.orderDate),
        expectedDate: dto.expectedDate ? new Date(dto.expectedDate) : null,
        totalAmount,
        notes: dto.notes,
        createdById: userId,
        status: 'DRAFT',
        items: {
          create: dto.items.map((item) => ({
            brand: item.brand,
            model: item.model,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
          })),
        },
      },
      include: {
        supplier: { select: { id: true, name: true } },
        items: true,
      },
    });
  }

  async update(id: string, dto: UpdatePODto) {
    const po = await this.findOne(id);
    if (po.status !== 'DRAFT') {
      throw new BadRequestException('แก้ไขได้เฉพาะ PO สถานะ DRAFT เท่านั้น');
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
    if (!['DRAFT', 'APPROVED'].includes(po.status)) {
      throw new BadRequestException('ยกเลิกได้เฉพาะ PO สถานะ DRAFT หรือ APPROVED เท่านั้น');
    }

    return this.prisma.purchaseOrder.update({
      where: { id },
      data: { status: 'CANCELLED' },
    });
  }

  /**
   * Receive items from PO (partial or full)
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

        // Update PO item received qty
        await tx.pOItem.update({
          where: { id: receiveItem.poItemId },
          data: { receivedQty: totalReceived },
        });

        // Create products for received items
        for (let i = 0; i < receiveItem.receivedQty; i++) {
          const product = await tx.product.create({
            data: {
              name: `${poItem.brand} ${poItem.model}`,
              brand: poItem.brand,
              model: poItem.model,
              category: 'PHONE_NEW',
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
        poId: id,
        status: newStatus,
        receivedProducts: receivedProducts.length,
        products: receivedProducts,
      };
    });
  }
}
