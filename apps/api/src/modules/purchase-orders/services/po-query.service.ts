import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { d, dAdd, dSub, dSum } from '../../../utils/decimal.util';

/**
 * Read-side of purchase orders: list/detail reads, accounts-payable
 * supplier-grouping, QC-pending list, goods-receiving history + summary.
 *
 * Owns findOne() — the shared read-validate helper used by the lifecycle
 * mutations (update/approve/reject/cancel/updatePayment).
 *
 * Plain class (not @Injectable) — constructed internally by the
 * PurchaseOrdersService facade so the existing spec/module wiring (which only
 * provides PrismaService) is untouched.
 */
export class PoQueryService {
  constructor(private prisma: PrismaService) {}

  async findAll(filters: { status?: string; supplierId?: string; page?: number; limit?: number }) {
    const where: Record<string, unknown> = { deletedAt: null };
    if (filters.status) where.status = filters.status;
    if (filters.supplierId) where.supplierId = filters.supplierId;

    const page = Math.max(1, filters.page || 1);
    const limit = Math.min(200, Math.max(1, filters.limit || 20));

    const [data, total] = await Promise.all([
      this.prisma.purchaseOrder.findMany({
        where,
        include: {
          supplier: { select: { id: true, name: true, contactName: true, phone: true, hasVat: true } },
          createdBy: { select: { id: true, name: true } },
          approvedBy: { select: { id: true, name: true } },
          items: true,
          _count: { select: { products: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.purchaseOrder.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
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
    if (!po || po.deletedAt) throw new NotFoundException('ไม่พบใบสั่งซื้อ');
    return po;
  }

  async getAccountsPayable(page = 1, limit = 50) {
    const safeLimit = Math.min(limit, 100);

    // Get all non-cancelled POs that are not fully paid
    const pos = await this.prisma.purchaseOrder.findMany({
      where: {
        deletedAt: null,
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
      const net = d(po.netAmount);
      const paid = d(po.paidAmount);
      const remaining = dSub(net, paid);

      if (remaining.lte(0)) continue;

      const entry = supplierMap.get(po.supplierId) || {
        supplier: po.supplier as { id: string; name: string; contactName: string; phone: string },
        totalNet: 0,
        totalPaid: 0,
        totalRemaining: 0,
        poCount: 0,
        pos: [] as { id: string; poNumber: string; orderDate: string; dueDate: string | null; netAmount: number; paidAmount: number; remaining: number; paymentStatus: string; status: string; itemsSummary: string }[],
      };

      entry.totalNet = dAdd(entry.totalNet, net).toNumber();
      entry.totalPaid = dAdd(entry.totalPaid, paid).toNumber();
      entry.totalRemaining = dAdd(entry.totalRemaining, remaining).toNumber();
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
        netAmount: net.toNumber(),
        paidAmount: paid.toNumber(),
        remaining: remaining.toNumber(),
        paymentStatus: po.paymentStatus,
        status: po.status,
        itemsSummary,
      });

      supplierMap.set(po.supplierId, entry);
    }

    const suppliers = Array.from(supplierMap.values()).sort((a, b) => b.totalRemaining - a.totalRemaining);
    const grandTotal = dSum(suppliers.map((s) => s.totalRemaining)).toNumber();
    const total = suppliers.length;
    const data = suppliers.slice((page - 1) * safeLimit, page * safeLimit);

    return { grandTotal, data, total, page, limit: safeLimit };
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
    if (!po || po.deletedAt) throw new NotFoundException('ไม่พบใบสั่งซื้อ');

    // Build item-level filter for status (PASS/REJECT)
    const itemFilter: Record<string, unknown> = {};
    if (filters.status) itemFilter.status = filters.status;

    // Build date filter
    const where: Record<string, unknown> = { poId, deletedAt: null };
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
    if (!po || po.deletedAt) throw new NotFoundException('ไม่พบใบสั่งซื้อ');

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

  async getSummary() {
    const now = new Date();
    const base = { deletedAt: null };
    const [pendingApproval, toOrder, incoming, overdue, receiving, waitingQc, unpaid] = await Promise.all([
      this.prisma.purchaseOrder.count({ where: { ...base, status: 'DRAFT' } }),
      this.prisma.purchaseOrder.count({ where: { ...base, status: 'APPROVED' } }),
      this.prisma.purchaseOrder.count({ where: { ...base, status: 'ORDERED' } }),
      this.prisma.purchaseOrder.count({ where: { ...base, status: 'ORDERED', expectedDate: { lt: now } } }),
      this.prisma.purchaseOrder.count({ where: { ...base, status: 'PARTIALLY_RECEIVED' } }),
      this.prisma.product.count({ where: { deletedAt: null, status: { in: ['QC_PENDING', 'PHOTO_PENDING'] } } }),
      this.prisma.purchaseOrder.count({ where: { ...base, status: { notIn: ['CANCELLED', 'DRAFT'] }, paymentStatus: { not: 'FULLY_PAID' } } }),
    ]);
    return { pendingApproval, toOrder, incoming, overdue, receiving, waitingQc, unpaid };
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
