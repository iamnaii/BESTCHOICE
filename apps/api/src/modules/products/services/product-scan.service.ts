import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { hasCrossBranchAccess } from '../../auth/branch-access.util';
import { readStringFlag } from '../../../utils/config.util';
import { resolveShopWarrantyDays, SHOP_WARRANTY_DAYS_CONFIG_KEY } from '../../warranty/shop-warranty-policy';
import { productInclude } from '../products.service';

/**
 * ยิง QR / IMEI ที่หน้าขาย (A4 · 2026-10-22) — ค้นค่าเท่ากัน แล้วตัดสิน "ขายได้ไหม เพราะอะไร"
 *
 * QR บนสติกเกอร์ (A5) เข้ารหัส IMEI → รหัสสินค้าเดิม → id ของเครื่อง ตามลำดับ จึงเทียบค่าเท่ากันทั้งสามช่อง
 * (ไม่ใช่ `contains` แบบรายการค้นหา). เหตุผลที่ส่งกลับเป็นข้อเท็จจริง (ใครจอง ขายเมื่อไร อยู่สาขาไหน) — ถ้อยคำบนจอ
 * เป็นหน้าที่ของเว็บ (`scanOutcome.ts`). กติกาขายจริงยังอยู่ที่ `assertSaleProductEligible` ตอนบันทึกใบขาย;
 * ที่นี่แค่บอกล่วงหน้าด้วยนิยามเดียวกัน (สาขา = `hasCrossBranchAccess`).
 *
 * ลำดับตัดสิน (หยุดที่ข้อแรกที่เข้า): ไม่พบ/ถูกลบ → ขายแล้ว/ติดสัญญา → สาขาอื่น → ติดจอง (ใบจอง · ร่างสัญญา ·
 * เว็บ · ไม่ทราบ) → พร้อมขาย → สถานะอื่น = ยังไม่พร้อม. "ขายแล้ว" มาก่อน "สาขาอื่น" เพราะเฉพาะกว่า — ไม่หลอก
 * ให้ไปขอโอนเครื่องที่ไม่มีอยู่แล้ว.
 */

export type ScanReason =
  | 'SELLABLE'
  | 'NOT_FOUND'
  | 'DELETED'
  | 'OTHER_BRANCH'
  | 'BOOKED'
  | 'DRAFT_CONTRACT'
  | 'WEB_RESERVED'
  | 'RESERVED'
  | 'ON_CONTRACT'
  | 'SOLD'
  | 'NOT_READY';

export type ScanActor = { role: string; branchId?: string | null };

/** แถวเดียวกับที่ `GET /products` ส่ง (include เดิม) + `effectiveShopWarrantyDays` ที่ findAll เติมให้ */
export type ScanProductRow = Prisma.ProductGetPayload<{ include: typeof productInclude }> & {
  effectiveShopWarrantyDays: number;
};

export interface ScanOutcome {
  /** ค่าที่ค้น (trim แล้ว) */
  code: string;
  reason: ScanReason;
  /** === (reason === 'SELLABLE') */
  sellable: boolean;
  /** แถวเต็มรูปเดียวกับ GET /products (+ effectiveShopWarrantyDays) — null เมื่อไม่พบ/ถูกลบ */
  product: ScanProductRow | null;
  branch: { id: string; name: string } | null;
  booking: { id: string; bookingNumber: string; customerName: string; expireDate: string } | null;
  contract: { id: string; contractNumber: string; customerName: string; status: string } | null;
  sale: { id: string; saleNumber: string; customerName: string; soldAt: string } | null;
  reservation: { expiresAt: string } | null;
}

const EMPTY: Omit<ScanOutcome, 'code' | 'reason' | 'sellable'> = {
  product: null,
  branch: null,
  booking: null,
  contract: null,
  sale: null,
  reservation: null,
};

/** สถานะที่ "ติดสัญญาผ่อน" ไม่นับ — นิยามเดียวกับ `ProductsService.loadActiveContract` */
const NOT_LIVE_CONTRACT = ['DRAFT', 'CANCELED'] as const;

@Injectable()
export class ProductScanService {
  constructor(private readonly prisma: PrismaService) {}

  async scan(rawCode: string, actor: ScanActor): Promise<ScanOutcome> {
    const code = (rawCode ?? '').trim();
    const match = { OR: [{ imeiSerial: code }, { legacyProductCode: code }, { id: code }] };

    const row = await this.prisma.product.findFirst({
      where: { deletedAt: null, ...match },
      include: productInclude,
    });
    if (!row) {
      const deleted = await this.prisma.product.findFirst({
        where: { deletedAt: { not: null }, ...match },
        select: { id: true },
      });
      return { code, reason: deleted ? 'DELETED' : 'NOT_FOUND', sellable: false, ...EMPTY };
    }

    const defaults = await readStringFlag(this.prisma, SHOP_WARRANTY_DAYS_CONFIG_KEY, '');
    const product = { ...row, effectiveShopWarrantyDays: resolveShopWarrantyDays(row, defaults) ?? 0 };
    const branch = row.branch ? { id: row.branch.id, name: row.branch.name } : null;
    const base = { code, sellable: false, ...EMPTY, product, branch };

    if (row.status === 'SOLD_CASH' || row.status === 'SOLD_RESELL') {
      return { ...base, reason: 'SOLD', sale: await this.latestSale(row.id) };
    }
    if (row.status === 'SOLD_INSTALLMENT') {
      const contract = await this.prisma.contract.findFirst({
        where: { productId: row.id, deletedAt: null, status: { notIn: [...NOT_LIVE_CONTRACT] } },
        orderBy: { createdAt: 'desc' },
        select: { id: true, contractNumber: true, status: true, customer: { select: { name: true } } },
      });
      if (contract) return { ...base, reason: 'ON_CONTRACT', contract: toContract(contract) };
      return { ...base, reason: 'SOLD', sale: await this.latestSale(row.id) };
    }

    if (!hasCrossBranchAccess(actor) && (!actor.branchId || actor.branchId !== row.branchId)) {
      return { ...base, reason: 'OTHER_BRANCH' };
    }

    if (row.status === 'RESERVED') return this.reservedBy(base, row.id);
    if (row.status === 'IN_STOCK') return { ...base, reason: 'SELLABLE', sellable: true };
    return { ...base, reason: 'NOT_READY' };
  }

  private async reservedBy(
    base: Omit<ScanOutcome, 'reason'>,
    productId: string,
  ): Promise<ScanOutcome> {
    // ชุดเงื่อนไขเดียวกับ booking-lock.util.ts — ใบจอง PAID คือเจ้าของ RESERVED ที่รู้จักชัดที่สุด
    const booking = await this.prisma.booking.findFirst({
      where: { lockedProductId: productId, status: 'PAID', deletedAt: null },
      select: { id: true, bookingNumber: true, expireDate: true, customer: { select: { name: true } } },
    });
    if (booking) {
      return {
        ...base,
        reason: 'BOOKED',
        booking: {
          id: booking.id,
          bookingNumber: booking.bookingNumber,
          customerName: booking.customer.name,
          expireDate: booking.expireDate.toISOString(),
        },
      };
    }
    const draft = await this.prisma.contract.findFirst({
      where: { productId, status: 'DRAFT', deletedAt: null },
      select: { id: true, contractNumber: true, status: true, customer: { select: { name: true } } },
    });
    if (draft) return { ...base, reason: 'DRAFT_CONTRACT', contract: toContract(draft) };

    const reservation = await this.prisma.productReservation.findFirst({
      where: { productId, status: 'ACTIVE', expiresAt: { gt: new Date() } },
      select: { id: true, expiresAt: true },
    });
    if (reservation) {
      return { ...base, reason: 'WEB_RESERVED', reservation: { expiresAt: reservation.expiresAt.toISOString() } };
    }
    return { ...base, reason: 'RESERVED' };
  }

  private async latestSale(productId: string): Promise<ScanOutcome['sale']> {
    const sale = await this.prisma.sale.findFirst({
      where: { productId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { id: true, saleNumber: true, createdAt: true, customer: { select: { name: true } } },
    });
    if (!sale) return null;
    return {
      id: sale.id,
      saleNumber: sale.saleNumber,
      customerName: sale.customer.name,
      soldAt: sale.createdAt.toISOString(),
    };
  }
}

function toContract(row: {
  id: string;
  contractNumber: string;
  status: string;
  customer: { name: string };
}): NonNullable<ScanOutcome['contract']> {
  return { id: row.id, contractNumber: row.contractNumber, customerName: row.customer.name, status: row.status };
}
