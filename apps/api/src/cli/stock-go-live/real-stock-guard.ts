/**
 * ด่าน 5 ของ factory reset — spec docs/superpowers/specs/2026-09-05-stock-go-live-design.md §6
 *
 * factory reset ล้าง goods_receivings / stock_transfers / stock_counts / stock_adjustments /
 * stock_alerts ทั้งตารางโดยไม่ดู marker (factory-reset-tables.ts) — หลังเริ่มใช้คลัง/จัดซื้อจริง
 * การรันซ้ำ = ใบรับของจริงหายทั้งที่สินค้า/PO ยังอยู่. ด่านนี้นับ "ของจริง" (แถว live ที่ไม่มี marker
 * ทดสอบ) แล้วปฏิเสธ เว้นแต่ผู้รันพิมพ์ชื่อสิ่งที่จะเสียลง env เอง (consent ใหม่ ไม่ reuse
 * ALLOW_PROD_RESET). ทางล้างข้อมูลทดสอบหลังจากนี้ = cleanup:test-pack + cleanup:test-contracts
 */
import type { PrismaClient } from '@prisma/client';
import { realProductWhere, realPurchaseOrderWhere } from '../../utils/test-data-markers';

export const ALLOW_WIPE_REAL_STOCK_ENV = 'ALLOW_WIPE_REAL_STOCK';
export const REQUIRED_CONSENT = 'YES_I_AM_SURE';

export interface RealStockCounts {
  realProducts: number;
  realGoodsReceivings: number;
}

export type RealStockClient = Pick<PrismaClient, 'product' | 'goodsReceiving'>;

export class RealStockPresentError extends Error {}

export async function countRealStock(prisma: RealStockClient): Promise<RealStockCounts> {
  const [realProducts, realGoodsReceivings] = await Promise.all([
    prisma.product.count({ where: { deletedAt: null, AND: [realProductWhere] } }),
    prisma.goodsReceiving.count({ where: { deletedAt: null, po: realPurchaseOrderWhere } }),
  ]);
  return { realProducts, realGoodsReceivings };
}

export function assertNoRealStock(
  counts: RealStockCounts,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (counts.realProducts === 0 && counts.realGoodsReceivings === 0) return;
  if (env[ALLOW_WIPE_REAL_STOCK_ENV] === REQUIRED_CONSENT) return;
  throw new RealStockPresentError(
    `มีข้อมูลคลังของจริงอยู่ในระบบ — สินค้าจริง ${counts.realProducts} เครื่อง, ` +
      `ใบรับของจริง ${counts.realGoodsReceivings} ใบ (นับเฉพาะแถวที่ไม่มี marker ทดสอบ). ` +
      'factory reset จะล้าง goods_receivings/stock_* ทั้งตารางโดยไม่ดู marker ' +
      '⇒ ใบรับของจริงจะหายทั้งที่สินค้า/PO ยังอยู่. ' +
      'ทางล้างข้อมูลทดสอบหลังเริ่มใช้คลังจริงคือ cleanup:test-pack + cleanup:test-contracts เท่านั้น. ' +
      `ถ้าตั้งใจทิ้งของจริงทั้งหมดจริง ๆ ให้ตั้ง ${ALLOW_WIPE_REAL_STOCK_ENV}=${REQUIRED_CONSENT}`,
  );
}
