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
          select: { id: true, name: true, brand: true, model: true, imeiSerial: true, serialNumber: true, photos: true, status: true, costPrice: true, branchId: true, accessoryType: true, accessoryBrand: true },
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
    // Validate supplier exists & get credit terms
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: dto.supplierId },
      select: {
        hasVat: true,
        paymentMethods: {
          select: { paymentMethod: true, creditTermDays: true, isDefault: true },
        },
      },
    });
    if (!supplier) throw new NotFoundException('ไม่พบ Supplier');

    // Calculate total with discount & VAT (only if supplier has VAT)
    const totalAmount = dto.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
    const discount = dto.discount || 0;
    const subtotalAfterDiscount = totalAmount - discount;
    const vatAmount = supplier.hasVat ? Math.round(subtotalAfterDiscount * 0.07 * 100) / 100 : 0;
    const netAmount = subtotalAfterDiscount + vatAmount;

    // Calculate due date from supplier credit terms
    const orderDateObj = new Date(dto.orderDate);
    let dueDate: Date | null = null;
    const selectedPm = dto.paymentMethod
      ? supplier.paymentMethods.find((pm) => pm.paymentMethod === dto.paymentMethod)
      : supplier.paymentMethods.find((pm) => pm.isDefault) || supplier.paymentMethods[0];
    if (selectedPm?.creditTermDays) {
      dueDate = new Date(orderDateObj);
      dueDate.setDate(dueDate.getDate() + selectedPm.creditTermDays);
    }

    // Use transaction to prevent PO number race condition
    return this.prisma.$transaction(async (tx) => {
      // Generate PO number inside transaction: PO-YYYY-MM-NNN format (monthly sequence)
      const today = new Date();
      const year = today.getFullYear();
      const month = String(today.getMonth() + 1).padStart(2, '0');
      const monthStart = new Date(year, today.getMonth(), 1);
      const monthEnd = new Date(year, today.getMonth() + 1, 1);
      const monthCount = await tx.purchaseOrder.count({
        where: {
          createdAt: { gte: monthStart, lt: monthEnd },
        },
      });
      const poNumber = `PO-${year}-${month}-${String(monthCount + 1).padStart(3, '0')}`;

      // PO now starts as DRAFT (requires Owner approval)
      return tx.purchaseOrder.create({
        data: {
          poNumber,
          supplierId: dto.supplierId,
          orderDate: orderDateObj,
          expectedDate: dto.expectedDate ? new Date(dto.expectedDate) : null,
          dueDate,
          totalAmount,
          discount,
          vatAmount,
          netAmount,
          notes: dto.notes,
          stockCheckRef: dto.stockCheckRef || null,
          createdById: userId,
          status: 'DRAFT',
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
              accessoryType: item.accessoryType || null,
              accessoryBrand: item.accessoryBrand || null,
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
      throw new BadRequestException('อนุมัติได้เฉพาะ PO สถานะ DRAFT เท่านั้น (ต้องรอ Owner อนุมัติ)');
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

  async reject(id: string, userId: string, reason: string) {
    const po = await this.findOne(id);
    if (po.status !== 'DRAFT') {
      throw new BadRequestException('ปฏิเสธได้เฉพาะ PO สถานะ DRAFT เท่านั้น');
    }

    return this.prisma.purchaseOrder.update({
      where: { id },
      data: {
        status: 'CANCELLED',
        approvedById: userId,
        rejectReason: reason,
      },
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
    if (dto.paidAmount !== undefined && dto.paidAmount > Number(po.netAmount)) {
      throw new BadRequestException(`ยอดจ่ายเกินกว่ายอดสุทธิ (${Number(po.netAmount).toLocaleString()} บาท)`);
    }

    return this.prisma.purchaseOrder.update({
      where: { id },
      data: {
        paymentStatus: dto.paymentStatus as any,
        ...(dto.paymentMethod !== undefined ? { paymentMethod: dto.paymentMethod || null } : {}),
        paidAmount: dto.paidAmount,
        ...(dto.paymentNotes !== undefined ? { paymentNotes: dto.paymentNotes || null } : {}),
        ...(dto.attachments !== undefined ? { attachments: dto.attachments } : {}),
      },
      include: {
        supplier: { select: { id: true, name: true } },
        items: true,
      },
    });
  }

  async getAccountsPayable() {
    // Get all non-cancelled POs that are not fully paid
    const pos = await this.prisma.purchaseOrder.findMany({
      where: {
        status: { notIn: ['CANCELLED', 'DRAFT'] },
        paymentStatus: { not: 'FULLY_PAID' },
      },
      include: {
        supplier: { select: { id: true, name: true, contactName: true, phone: true } },
        items: { select: { brand: true, model: true, category: true, quantity: true, unitPrice: true, accessoryType: true } },
      },
      orderBy: { orderDate: 'asc' },
    });

    // Group by supplier
    const supplierMap = new Map<string, {
      supplier: { id: string; name: string; contactName: string; phone: string };
      totalNet: number;
      totalPaid: number;
      totalRemaining: number;
      poCount: number;
      pos: {
        id: string;
        poNumber: string;
        orderDate: string;
        dueDate: string | null;
        netAmount: number;
        paidAmount: number;
        remaining: number;
        paymentStatus: string;
        status: string;
        itemsSummary: string;
      }[];
    }>();

    for (const po of pos) {
      const net = Number(po.netAmount);
      const paid = Number(po.paidAmount);
      const remaining = net - paid;

      if (remaining <= 0) continue;

      const entry = supplierMap.get(po.supplierId) || {
        supplier: po.supplier as any,
        totalNet: 0,
        totalPaid: 0,
        totalRemaining: 0,
        poCount: 0,
        pos: [] as { id: string; poNumber: string; orderDate: string; dueDate: string | null; netAmount: number; paidAmount: number; remaining: number; paymentStatus: string; status: string; itemsSummary: string }[],
      };

      entry.totalNet += net;
      entry.totalPaid += paid;
      entry.totalRemaining += remaining;
      entry.poCount++;

      // Build items summary
      const itemsSummary = po.items.map((i) =>
        i.category === 'ACCESSORY'
          ? `${i.accessoryType || ''} x${i.quantity}`
          : `${i.brand} ${i.model} x${i.quantity}`
      ).join(', ');

      entry.pos.push({
        id: po.id,
        poNumber: po.poNumber,
        orderDate: po.orderDate.toISOString(),
        dueDate: po.dueDate ? po.dueDate.toISOString() : null,
        netAmount: net,
        paidAmount: paid,
        remaining,
        paymentStatus: po.paymentStatus,
        status: po.status,
        itemsSummary,
      });

      supplierMap.set(po.supplierId, entry);
    }

    const suppliers = Array.from(supplierMap.values()).sort((a, b) => b.totalRemaining - a.totalRemaining);
    const grandTotal = suppliers.reduce((sum, s) => sum + s.totalRemaining, 0);

    return { grandTotal, suppliers };
  }

  // === Goods Receiving History ===

  async getGoodsReceivings(poId: string, filters: {
    status?: string;
    startDate?: string;
    endDate?: string;
    page?: number;
    limit?: number;
  } = {}) {
    const po = await this.prisma.purchaseOrder.findUnique({ where: { id: poId } });
    if (!po) throw new NotFoundException('ไม่พบใบสั่งซื้อ');

    // Build item-level filter for status (PASS/REJECT)
    const itemFilter: Record<string, unknown> = {};
    if (filters.status) itemFilter.status = filters.status;

    // Build date filter
    const where: Record<string, unknown> = { poId };
    if (filters.startDate || filters.endDate) {
      const dateFilter: Record<string, Date> = {};
      if (filters.startDate) dateFilter.gte = new Date(filters.startDate);
      if (filters.endDate) {
        const end = new Date(filters.endDate);
        end.setHours(23, 59, 59, 999);
        dateFilter.lte = end;
      }
      where.createdAt = dateFilter;
    }

    const page = Math.max(1, filters.page || 1);
    const limit = Math.min(100, Math.max(1, filters.limit || 50));

    const [data, total] = await Promise.all([
      this.prisma.goodsReceiving.findMany({
        where,
        include: {
          receivedBy: { select: { id: true, name: true } },
          items: {
            where: Object.keys(itemFilter).length > 0 ? itemFilter : undefined,
            include: {
              poItem: { select: { id: true, brand: true, model: true, color: true, storage: true, category: true, accessoryType: true } },
              product: { select: { id: true, name: true, imeiSerial: true, status: true, branchId: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.goodsReceiving.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getGoodsReceivingById(poId: string, receivingId: string) {
    const receiving = await this.prisma.goodsReceiving.findFirst({
      where: { id: receivingId, poId },
      include: {
        po: { select: { id: true, poNumber: true, supplierId: true, supplier: { select: { id: true, name: true } } } },
        receivedBy: { select: { id: true, name: true } },
        items: {
          include: {
            poItem: { select: { id: true, brand: true, model: true, color: true, storage: true, category: true, accessoryType: true, accessoryBrand: true, quantity: true, receivedQty: true } },
            product: { select: { id: true, name: true, imeiSerial: true, serialNumber: true, status: true, branchId: true, photos: true } },
          },
        },
      },
    });
    if (!receiving) throw new NotFoundException('ไม่พบรายการรับเข้า');
    return receiving;
  }

  async getReceivingSummary(poId: string, filters: {
    startDate?: string;
    endDate?: string;
  } = {}) {
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id: poId },
      include: { items: true },
    });
    if (!po) throw new NotFoundException('ไม่พบใบสั่งซื้อ');

    // Build date filter for receiving records
    const receivingWhere: Record<string, unknown> = { poId };
    if (filters.startDate || filters.endDate) {
      const dateFilter: Record<string, Date> = {};
      if (filters.startDate) dateFilter.gte = new Date(filters.startDate);
      if (filters.endDate) {
        const end = new Date(filters.endDate);
        end.setHours(23, 59, 59, 999);
        dateFilter.lte = end;
      }
      receivingWhere.createdAt = dateFilter;
    }

    const receivingItems = await this.prisma.goodsReceivingItem.findMany({
      where: { receiving: receivingWhere },
      select: { status: true, rejectReason: true, poItemId: true },
    });

    const totalOrdered = po.items.reduce((sum, item) => sum + item.quantity, 0);
    const totalReceived = po.items.reduce((sum, item) => sum + item.receivedQty, 0);
    const passedCount = receivingItems.filter((i) => i.status === 'PASS').length;
    const rejectedCount = receivingItems.filter((i) => i.status === 'REJECT').length;
    const remaining = totalOrdered - totalReceived;

    // Group rejection reasons
    const rejectReasons: Record<string, number> = {};
    for (const item of receivingItems) {
      if (item.status === 'REJECT' && item.rejectReason) {
        rejectReasons[item.rejectReason] = (rejectReasons[item.rejectReason] || 0) + 1;
      }
    }

    return {
      poId,
      poStatus: po.status,
      totalOrdered,
      totalReceived,
      remaining,
      passedCount,
      rejectedCount,
      rejectReasons,
    };
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
          const productCategory = (poItem.category as any) || 'PHONE_NEW';
          let productName: string;
          if (productCategory === 'ACCESSORY') {
            const isCharger = poItem.accessoryType === 'ชุดชาร์จ';
            if (isCharger) {
              // Charger: "ชุดชาร์จ Anker Type-C" (model = connector type)
              productName = [poItem.accessoryType, poItem.accessoryBrand, poItem.model].filter(Boolean).join(' ');
            } else {
              // Other accessories: "เคส Spigen สำหรับ iPhone 16 Pro, iPhone 16 Pro Max"
              const accParts = [poItem.accessoryType, poItem.accessoryBrand].filter(Boolean);
              productName = poItem.model
                ? `${accParts.join(' ')} สำหรับ ${poItem.model}`
                : accParts.join(' ');
            }
          } else {
            const nameParts = [poItem.brand, poItem.model, poItem.color, poItem.storage].filter(Boolean);
            productName = nameParts.join(' ');
          }
          const product = await tx.product.create({
            data: {
              name: productName,
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
              accessoryType: poItem.accessoryType || null,
              accessoryBrand: poItem.accessoryBrand || null,
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
      if (!['APPROVED', 'PARTIALLY_RECEIVED'].includes(po.status)) {
        throw new BadRequestException('PO นี้ไม่อยู่ในสถานะที่สามารถรับสินค้าได้ (ต้อง APPROVED หรือ PARTIALLY_RECEIVED)');
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

      // Validate duplicate IMEI/Serial in this batch
      const imeiList = dto.items
        .filter((i) => i.status === 'PASS' && i.imeiSerial)
        .map((i) => i.imeiSerial!);
      const uniqueImeis = new Set(imeiList);
      if (uniqueImeis.size !== imeiList.length) {
        throw new BadRequestException('พบ IMEI ซ้ำกันในรายการที่กำลังรับเข้า');
      }

      // Validate IMEI not already exists in system (include soft-deleted due to DB unique constraint)
      if (imeiList.length > 0) {
        const existingProducts = await tx.product.findMany({
          where: { imeiSerial: { in: imeiList } },
          select: { imeiSerial: true, name: true, deletedAt: true },
        });
        if (existingProducts.length > 0) {
          const dupes = existingProducts.map((p) => {
            const suffix = p.deletedAt ? ' [ตัดจำหน่ายแล้ว]' : '';
            return `${p.imeiSerial} (${p.name}${suffix})`;
          }).join(', ');
          throw new BadRequestException(`IMEI ซ้ำกับสินค้าที่มีในระบบแล้ว: ${dupes}`);
        }
      }

      // Process each item
      for (const item of dto.items) {
        const poItem = po.items.find((i) => i.id === item.poItemId);
        if (!poItem) throw new NotFoundException(`ไม่พบรายการ PO: ${item.poItemId}`);

        if (item.status === 'PASS') {
          // Build product name from PO item details
          const productCategory = (poItem.category as any) || 'PHONE_NEW';
          let productName: string;
          if (productCategory === 'ACCESSORY') {
            const isCharger = poItem.accessoryType === 'ชุดชาร์จ';
            if (isCharger) {
              productName = [poItem.accessoryType, poItem.accessoryBrand, poItem.model].filter(Boolean).join(' ');
            } else {
              const accParts = [poItem.accessoryType, poItem.accessoryBrand].filter(Boolean);
              productName = poItem.model
                ? `${accParts.join(' ')} สำหรับ ${poItem.model}`
                : accParts.join(' ');
            }
          } else {
            const nameParts = [poItem.brand, poItem.model, poItem.color, poItem.storage].filter(Boolean);
            productName = nameParts.join(' ');
          }

          // Create product for passed items → goes directly to IN_STOCK (receive + inspect in one step)
          const product = await tx.product.create({
            data: {
              name: productName,
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
              stockInDate: new Date(),
              imeiSerial: item.imeiSerial || null,
              serialNumber: item.serialNumber || null,
              photos: item.photos || [],
              batteryHealth: item.batteryHealth ?? null,
              warrantyExpired: item.warrantyExpired ?? null,
              warrantyExpireDate: item.warrantyExpireDate ? new Date(item.warrantyExpireDate) : null,
              hasBox: item.hasBox ?? null,
              checklistResults: item.checklistResults ?? undefined,
              accessoryType: poItem.accessoryType || null,
              accessoryBrand: poItem.accessoryBrand || null,
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
              batteryHealth: item.batteryHealth ?? null,
              warrantyExpired: item.warrantyExpired ?? null,
              warrantyExpireDate: item.warrantyExpireDate ? new Date(item.warrantyExpireDate) : null,
              hasBox: item.hasBox ?? null,
              checklistResults: item.checklistResults ?? undefined,
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

  /**
   * Confirm QC for products - moves QC_PENDING → IN_STOCK (เข้าคลังหลัก)
   * Workflow Step 4: สินค้าเข้าคลัง
   */
  async confirmQC(productIds: string[]) {
    if (!productIds || productIds.length === 0) {
      throw new BadRequestException('กรุณาระบุสินค้าที่ต้องการยืนยัน QC');
    }

    return this.prisma.$transaction(async (tx) => {
      const products = await tx.product.findMany({
        where: { id: { in: productIds }, deletedAt: null },
      });

      // Validate all products are QC_PENDING
      const invalidProducts = products.filter((p) => p.status !== 'QC_PENDING');
      if (invalidProducts.length > 0) {
        throw new BadRequestException(
          `สินค้าต่อไปนี้ไม่ได้อยู่ในสถานะ QC_PENDING: ${invalidProducts.map((p) => p.name).join(', ')}`,
        );
      }

      const notFound = productIds.filter((id) => !products.find((p) => p.id === id));
      if (notFound.length > 0) {
        throw new BadRequestException(`ไม่พบสินค้า ID: ${notFound.join(', ')}`);
      }

      // Move all products to IN_STOCK
      await tx.product.updateMany({
        where: { id: { in: productIds } },
        data: { status: 'IN_STOCK', stockInDate: new Date() },
      });

      return {
        confirmed: productIds.length,
        message: `ยืนยัน QC สำเร็จ ${productIds.length} ชิ้น → เข้าคลัง IN_STOCK`,
      };
    });
  }

  /**
   * Get products pending QC (QC_PENDING status)
   */
  async getQCPending(filters: { branchId?: string; page?: number; limit?: number }) {
    const where: Record<string, unknown> = { status: 'QC_PENDING', deletedAt: null };
    if (filters.branchId) where.branchId = filters.branchId;

    const page = Math.max(1, filters.page || 1);
    const limit = Math.min(100, Math.max(1, filters.limit || 50));

    const [data, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        include: {
          branch: { select: { id: true, name: true } },
          supplier: { select: { id: true, name: true } },
          po: { select: { id: true, poNumber: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.product.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }
}
