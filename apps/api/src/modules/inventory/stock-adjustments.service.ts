import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { Prisma, ProductStatus, StockAdjustmentReason } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateStockAdjustmentDto } from './dto/create-stock-adjustment.dto';

// T2-C11 — stock adjustments whose product cost exceeds this threshold must
// be approved by an OWNER. Managers (BRANCH_MANAGER / FINANCE_MANAGER) cannot
// rubber-stamp a write-off of a flagship-tier device.
const OWNER_ONLY_ADJUSTMENT_THRESHOLD_THB = 500_000;

/**
 * Phase 5 fix round 3 [Important 1] — `FOUND` เป็น **allow-list** ไม่ใช่ deny ทีละสถานะ
 *
 * `FOUND` = "พบของที่หายไป" ⇒ มีความหมายเฉพาะกลุ่มของหาย/ของเสีย. รอบ 2 ปฏิเสธเฉพาะ
 * `REFURBISHED` แต่ `repossessions.service.ts` ตั้ง `REPOSSESSED` ตอนยึด (REFURBISHED
 * มาทีหลังตอน `markReadyForSale` ที่บังคับตีราคาใหม่) ⇒ เครื่องยึดที่ยังถือราคาขายเดิม
 * flip เข้า `IN_STOCK` ได้ทางนี้ โดยไม่เช็คราคา ไม่มี AuditLog เข้าคลัง — ทั้งที่ปุ่ม
 * "นำเข้าคลังพร้อมขาย" ปฏิเสธมัน. allow-list ปิดสถานะที่ยังไม่มีใครนึกถึงด้วย
 * (`SOLD_INSTALLMENT → IN_STOCK` แย่กว่าเคส REPOSSESSED เสียอีก)
 *
 * `toInStock: true` = กลุ่มที่ "พบคืน" แล้วกลับมาขายได้จริง. สถานะอื่น **ยังกู้แถวที่ถูก
 * soft-delete คืนได้** (`deletedAt: null`) แต่กลับไปสถานะเดิมของมัน ไม่ใช่ `IN_STOCK`
 * — นี่คือทางกู้เครื่องที่ถูกลบทางเดียวที่ระบบมี จึงห้ามปิด แต่ก็ต้องไม่กลายเป็นประตูลัด
 * เข้าคลัง (เครื่อง REFURBISHED ที่กู้คืนมายังต้องผ่านปุ่มยืนยันราคาอยู่ดี)
 */
const FOUND_POLICY = {
  // ── พบคืนแล้วกลับเข้าคลังได้ ──
  LOST: { toInStock: true, hint: '' }, // ความหมายตรงตัวของ "พบของที่หายไป"
  DAMAGED: { toInStock: true, hint: '' }, // ของเสียที่กู้ได้ (ด่าน OWNER-only ด้านบนคุมอยู่)
  WRITTEN_OFF: { toInStock: true, hint: '' }, // ตัดจำหน่ายแล้วเจอของ (OWNER-only เช่นกัน)

  // ── ไม่ใช่ของหาย/ของเสีย: มี flow ของตัวเอง ──
  REFURBISHED: {
    toInStock: false,
    hint: 'เครื่องมือสองที่รับคืน — ใช้ปุ่ม "นำเข้าคลังพร้อมขาย" ที่หน้ารายละเอียดสินค้า เพื่อยืนยันราคาขายก่อน',
  },
  REPOSSESSED: {
    toInStock: false,
    hint: 'เครื่องที่ยึดมา — ต้องผ่าน flow ยึดเครื่อง (ตีราคาขายต่อ/พร้อมขาย) ก่อน แล้วจึงกดปุ่ม "นำเข้าคลังพร้อมขาย"',
  },
  SOLD_INSTALLMENT: {
    toInStock: false,
    hint: 'เครื่องที่สัญญาผ่อนยังถืออยู่ — คืนเข้าสต็อกผ่านยกเลิกสัญญา / ยึดเครื่อง / เปลี่ยนเครื่องเท่านั้น',
  },
  SOLD_CASH: { toInStock: false, hint: 'เครื่องที่ขายไปแล้ว — คืนเข้าสต็อกผ่านการยกเลิกการขาย' },
  SOLD_RESELL: { toInStock: false, hint: 'เครื่องที่ขายต่อไปแล้ว — คืนเข้าสต็อกผ่านการยกเลิกการขาย' },
  RESERVED: { toInStock: false, hint: 'เครื่องที่ติดจองอยู่ — ปลดผ่านการยกเลิกจอง/ยกเลิกออเดอร์' },
  PO_RECEIVED: { toInStock: false, hint: 'เครื่องที่เพิ่งรับเข้าจากใบสั่งซื้อ — เดินตามขั้นตอนรับของ/ตรวจ QC ตามปกติ' },
  QC_PENDING: { toInStock: false, hint: 'เครื่องที่รอตรวจ QC — เข้าคลังเมื่อผ่าน QC ตามขั้นตอน' },
  PHOTO_PENDING: {
    toInStock: false,
    hint: 'เครื่องที่รอถ่ายรูป 6 มุม — เข้าคลังโดยอัปโหลดรูปให้ครบแล้วกดยืนยันรูป (ต้องมีราคาขายก่อน)',
  },
  INSPECTION: { toInStock: false, hint: 'เครื่องที่อยู่ระหว่างตรวจสภาพ — เข้าคลังเมื่อตรวจเสร็จตามขั้นตอน' },
  DEFECT_RETURN: { toInStock: false, hint: 'เครื่องเคลม/ส่งซ่อม — จัดการผ่านใบซ่อม/เปลี่ยนเครื่องชำรุด' },
  IN_STOCK: { toInStock: false, hint: 'เครื่องนี้อยู่ในคลังอยู่แล้ว' },
} satisfies Record<ProductStatus, { toInStock: boolean; hint: string }>;

/** สถานะที่เหตุผล "พบของ" พาเข้า `IN_STOCK` ได้จริง */
const FOUND_TO_IN_STOCK: ReadonlySet<ProductStatus> = new Set(
  (Object.keys(FOUND_POLICY) as ProductStatus[]).filter((s) => FOUND_POLICY[s].toInStock),
);

/**
 * ปฏิเสธ `FOUND` บนสถานะที่ไม่ใช่ของหาย/ของเสีย — ยกเว้นแถวที่ถูก soft-delete
 * (กู้คืนได้ แต่กลับไปสถานะเดิม ไม่ใช่ `IN_STOCK`)
 */
function assertFoundAllowed(status: ProductStatus, deletedAt: Date | null): void {
  if (FOUND_POLICY[status].toInStock || deletedAt) return;
  throw new BadRequestException(
    `สินค้าอยู่สถานะ ${status} — เหตุผล "พบของ" ใช้ได้เฉพาะเครื่องที่หาย/เสียหาย/ตัดจำหน่าย (LOST, DAMAGED, WRITTEN_OFF) ` +
      `หรือเครื่องที่ถูกลบไปแล้วและต้องการกู้แถวคืน: ${FOUND_POLICY[status].hint}`,
  );
}

@Injectable()
export class StockAdjustmentsService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateStockAdjustmentDto, userId: string) {
    // T5-C3 — 4-eyes: approver ≠ adjuster, must be manager-tier + active.
    if (!dto.approverId) {
      throw new BadRequestException('ต้องระบุผู้อนุมัติ (approverId)');
    }
    if (dto.approverId === userId) {
      throw new ForbiddenException(
        'ผู้ปรับสต๊อคและผู้อนุมัติต้องเป็นคนละคน (Segregation of Duties)',
      );
    }
    const approver = await this.prisma.user.findUnique({
      where: { id: dto.approverId },
      select: { id: true, role: true, isActive: true, deletedAt: true },
    });
    if (!approver || !approver.isActive || approver.deletedAt) {
      throw new NotFoundException('ไม่พบผู้อนุมัติ หรือถูกปิดการใช้งาน');
    }
    const approverAllowed = ['OWNER', 'FINANCE_MANAGER', 'BRANCH_MANAGER'];
    if (!approverAllowed.includes(approver.role)) {
      throw new ForbiddenException(
        `ผู้อนุมัติต้องเป็น ${approverAllowed.join(' / ')} (role ปัจจุบัน: ${approver.role})`,
      );
    }

    // T5-C14 — DAMAGED stock adjustments must carry at least one photo as
    // evidence (paralleling the DEFECT exchange gate from T5-C10). The DTO
    // lets `photos` be optional at the type level; enforce per-reason here.
    if (dto.reason === 'DAMAGED') {
      const photos = dto.photos ?? [];
      if (!Array.isArray(photos) || photos.length === 0) {
        throw new BadRequestException(
          'การปรับสต๊อคเหตุผล DAMAGED ต้องแนบรูปภาพอย่างน้อย 1 รูปเป็นหลักฐาน',
        );
      }
    }

    return this.prisma.$transaction(async (tx) => {
      // Find product inside transaction to prevent race conditions
      const product = await tx.product.findUnique({
        where: { id: dto.productId },
        include: { branch: { select: { id: true, name: true } } },
      });

      // FOUND: allow soft-deleted products (they need to be restored)
      if (dto.reason === 'FOUND') {
        if (!product) {
          throw new NotFoundException('ไม่พบสินค้า');
        }
        if (!product.deletedAt && product.status === 'IN_STOCK') {
          throw new BadRequestException('สินค้านี้อยู่ในสต๊อคอยู่แล้ว ไม่สามารถใช้เหตุผล "พบคืน" ได้');
        }
        assertFoundAllowed(product.status, product.deletedAt);
        // T5-C8: restoring from DAMAGED/WRITTEN_OFF requires OWNER approver.
        // The generic 4-eyes allows BRANCH_MANAGER to approve — that's fine
        // for LOST→FOUND (missing phone reappears), but DAMAGED→FOUND is the
        // classic fraud vector (manager flags damage, sells to accomplice as
        // scrap, then resurrects for a clean retail resale). OWNER sign-off
        // raises that bar.
        const isDamageResurrection =
          product.status === 'DAMAGED' || product.status === 'WRITTEN_OFF';
        if (isDamageResurrection && approver.role !== 'OWNER') {
          throw new ForbiddenException(
            'การกู้คืนสินค้าจากสถานะ DAMAGED/WRITTEN_OFF ต้องให้ OWNER อนุมัติเท่านั้น (ไม่ใช่ BRANCH_MANAGER/FINANCE_MANAGER)',
          );
        }
      } else {
        // DAMAGED, LOST, WRITE_OFF, CORRECTION, OTHER: product must exist and be in stock
        if (!product || product.deletedAt) {
          throw new NotFoundException('ไม่พบสินค้า');
        }
        const adjustableStatuses = ['IN_STOCK', 'PO_RECEIVED', 'INSPECTION', 'QC_PENDING'];
        if (!adjustableStatuses.includes(product.status)) {
          throw new BadRequestException(
            `ไม่สามารถปรับสต๊อคสินค้าสถานะ "${product.status}" ได้ (ต้องเป็น IN_STOCK, PO_RECEIVED, QC_PENDING, หรือ INSPECTION)`,
          );
        }
      }

      // T2-C11 — high-value adjustments (> 500K THB cost) require OWNER.
      // BRANCH_MANAGER / FINANCE_MANAGER approval is insufficient for flagship
      // devices because the write-off blast-radius is too large for a mid-tier
      // sign-off. Comparison uses Prisma.Decimal to avoid float drift.
      const adjustmentValue = new Prisma.Decimal(product?.costPrice ?? 0);
      const threshold = new Prisma.Decimal(OWNER_ONLY_ADJUSTMENT_THRESHOLD_THB);
      if (adjustmentValue.greaterThan(threshold) && approver.role !== 'OWNER') {
        throw new ForbiddenException(
          'การปรับสต็อกเกิน 500,000 บาท ต้องได้รับอนุมัติจาก OWNER เท่านั้น',
        );
      }

      // Create adjustment record (with 4-eyes approver captured)
      const adjustment = await tx.stockAdjustment.create({
        data: {
          productId: dto.productId,
          branchId: product.branchId,
          reason: dto.reason as StockAdjustmentReason,
          previousStatus: product.status,
          notes: dto.notes,
          // T5-C14 — photos are write-once: captured at create time from the
          // validated DTO and never mutated afterwards (no update route
          // exists for stock adjustments; service deliberately has no
          // update() method). Cloning the array prevents caller-side
          // aliasing from altering the stored evidence set.
          photos: [...(dto.photos ?? [])],
          adjustedById: userId,
          approvedById: dto.approverId,
          approvedAt: new Date(),
        },
        include: {
          product: { select: { id: true, name: true, imeiSerial: true, brand: true, model: true } },
          branch: { select: { id: true, name: true } },
          adjustedBy: { select: { id: true, name: true } },
          approvedBy: { select: { id: true, name: true } },
        },
      });

      // Update product status based on reason
      if (dto.reason === 'FOUND') {
        // `assertFoundAllowed` (ข้างบน, ก่อนสร้างแถว) เป็นด่านเดียวของกติกา — ตรงนี้แค่
        // เดินตามผลของมัน: กลุ่มของหาย/ของเสีย → IN_STOCK, ที่เหลือ = กู้แถวคืนเฉย ๆ
        const entersStock = FOUND_TO_IN_STOCK.has(product.status);
        const wasDamageRestore =
          product.status === 'DAMAGED' || product.status === 'WRITTEN_OFF';
        await tx.product.update({
          where: { id: dto.productId },
          data: {
            // สถานะเดิมของเครื่องที่แค่ถูกลบไป (เช่น REFURBISHED) ต้องคงไว้ — การพาเข้าคลัง
            // ยังต้องผ่านปุ่ม "นำเข้าคลังพร้อมขาย" ที่บังคับยืนยันราคาอยู่ดี
            ...(entersStock ? { status: 'IN_STOCK' as const, stockInDate: new Date() } : {}),
            deletedAt: null,
            // T5-C8: stamp the restoration so sales can detect a recent
            // damage-then-resurrect pattern. wasPreviouslyDamaged is already
            // set from the prior DAMAGED adjustment — never flip it back.
            restoredFromTerminalAt: wasDamageRestore ? new Date() : undefined,
          },
        });
      } else if (['DAMAGED', 'LOST', 'WRITE_OFF'].includes(dto.reason)) {
        // DAMAGED, LOST, WRITE_OFF → update status and soft delete
        const statusMap: Record<string, 'DAMAGED' | 'LOST' | 'WRITTEN_OFF'> = { DAMAGED: 'DAMAGED', LOST: 'LOST', WRITE_OFF: 'WRITTEN_OFF' };
        await tx.product.update({
          where: { id: dto.productId },
          data: {
            status: statusMap[dto.reason] || dto.reason,
            deletedAt: new Date(),
            // T5-C8: sticky flag — stays true even if FOUND later resurrects.
            wasPreviouslyDamaged: true,
          },
        });
      }
      // CORRECTION, OTHER → record only, no status/deletion change

      return adjustment;
    });
  }

  async findAll(filters: {
    branchId?: string;
    reason?: string;
    productId?: string;
    search?: string;
    startDate?: string;
    endDate?: string;
    page?: number;
    limit?: number;
  }) {
    const where: Record<string, unknown> = { deletedAt: null };
    if (filters.branchId) where.branchId = filters.branchId;
    if (filters.reason) where.reason = filters.reason;
    if (filters.productId) where.productId = filters.productId;
    if (filters.search) {
      where.product = {
        is: {
          OR: [
            { name: { contains: filters.search, mode: 'insensitive' } },
            { brand: { contains: filters.search, mode: 'insensitive' } },
            { model: { contains: filters.search, mode: 'insensitive' } },
            { imeiSerial: { contains: filters.search } },
          ],
        },
      };
    }
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
      this.prisma.stockAdjustment.findMany({
        where,
        include: {
          product: { select: { id: true, name: true, imeiSerial: true, brand: true, model: true, costPrice: true } },
          branch: { select: { id: true, name: true } },
          adjustedBy: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.stockAdjustment.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string) {
    const adjustment = await this.prisma.stockAdjustment.findUnique({
      where: { id },
      include: {
        product: {
          select: {
            id: true, name: true, imeiSerial: true, serialNumber: true,
            brand: true, model: true, color: true, storage: true,
            costPrice: true, category: true, photos: true,
          },
        },
        branch: { select: { id: true, name: true } },
        adjustedBy: { select: { id: true, name: true } },
      },
    });
    if (!adjustment) throw new NotFoundException('ไม่พบรายการปรับสต๊อค');
    return adjustment;
  }

  async getSummary(filters: { branchId?: string; startDate?: string; endDate?: string }) {
    const where: Record<string, unknown> = {};
    if (filters.branchId) where.branchId = filters.branchId;
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

    // Use groupBy for efficient DB-level aggregation
    const grouped = await this.prisma.stockAdjustment.groupBy({
      by: ['reason'],
      where: where as Prisma.StockAdjustmentGroupByArgs['where'],
      _count: true,
    });

    // Get cost values per reason via a separate query (join with product)
    const adjustments = await this.prisma.stockAdjustment.findMany({
      where,
      select: { reason: true, product: { select: { costPrice: true } } },
    });

    const byReason: Record<string, { count: number; totalValue: number }> = {};
    for (const g of grouped) {
      byReason[g.reason] = { count: g._count, totalValue: 0 };
    }
    for (const adj of adjustments) {
      if (byReason[adj.reason]) {
        byReason[adj.reason].totalValue += Number(adj.product?.costPrice ?? 0) || 0;
      }
    }

    const totalCount = grouped.reduce((sum, g) => sum + g._count, 0);
    const totalValue = Object.values(byReason).reduce((sum, r) => sum + r.totalValue, 0);

    return { byReason, totalCount, totalValue };
  }
}
