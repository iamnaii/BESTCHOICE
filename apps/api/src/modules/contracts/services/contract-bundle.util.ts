import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { assertSaleProductEligible, type SaleProductActor } from '../../sales/services/sale-product-policy';
import { assertBundleIsAccessory } from '../../sales/services/bundle-policy';
import { preemptReservationsInTx } from '../../../utils/reservation-preempt.util';
import { assertSameTestSide, type TestSideCustomer } from '../../../utils/test-data-markers';

/**
 * ของแถมในสัญญาผ่อน (2026-09-20) — เดินตามเครื่องหลักทุกจังหวะ:
 *
 *   สร้างสัญญา  → `reserveContractBundles`  IN_STOCK → RESERVED  (หายจากรายการพร้อมขาย กันขายซ้ำ)
 *   เปิดใช้      → `sellContractBundles`     RESERVED → SOLD_CASH (สถานะเดียวกับของแถมที่ขายผ่าน POS)
 *   ลบร่าง/นำออก → `releaseContractBundles`  RESERVED → IN_STOCK
 *   ยกเลิกสัญญา  → `restoreContractBundles`  SOLD_CASH → IN_STOCK
 *
 * ต้นทุนของแถมลงบัญชีตอนเปิดใช้ผ่าน `ShopInventoryTransferTemplate.bundleCosts` (อ่านจาก
 * `Sale.bundleProductIds` ของใบขายที่ `activate` สร้างให้) และ sweep ตอนยกเลิกกลับรายการให้เอง —
 * ไฟล์นี้ดูแลเฉพาะ "สถานะสินค้า" ให้ตรงกับสมุด
 *
 * ยึดเครื่อง/เปลี่ยนเครื่องไม่แตะของแถม (อยู่กับลูกค้าแล้ว)
 */

export const MAX_CONTRACT_BUNDLES = 10;

/** ตัดค่าว่าง + ตัวซ้ำ คงลำดับเดิม */
export function normalizeBundleIds(ids?: string[] | null): string[] {
  return Array.from(new Set((ids ?? []).filter((id): id is string => !!id)));
}

export interface ReserveContractBundlesInput {
  bundleProductIds: string[];
  mainProductId: string;
  branchId: string;
  actor: SaleProductActor;
  customer: TestSideCustomer;
  previouslyDamagedAcknowledged?: boolean;
}

export async function reserveContractBundles(
  tx: Prisma.TransactionClient,
  input: ReserveContractBundlesInput,
): Promise<void> {
  const ids = normalizeBundleIds(input.bundleProductIds);
  if (!ids.length) return;
  if (ids.length > MAX_CONTRACT_BUNDLES) {
    throw new BadRequestException(`ของแถมต่อสัญญาได้ไม่เกิน ${MAX_CONTRACT_BUNDLES} ชิ้น`);
  }
  if (ids.includes(input.mainProductId)) {
    throw new BadRequestException('ของแถมซ้ำกับเครื่องหลักของสัญญา');
  }

  const products = await tx.product.findMany({
    where: { id: { in: ids }, deletedAt: null },
    select: {
      id: true, name: true, imeiSerial: true, category: true, status: true, deletedAt: true,
      branchId: true, wasPreviouslyDamaged: true,
      // test-data fence ต้องเห็น PO ต้นทาง (อุปกรณ์เสริมไร้ IMEI จาก PO ทดสอบ)
      po: { select: { poNumber: true } },
    },
  });
  if (products.length !== ids.length) {
    throw new BadRequestException('ไม่พบสินค้าของแถมบางรายการ');
  }
  for (const p of products) {
    assertSaleProductEligible(p, input.branchId, input.actor, input.previouslyDamagedAcknowledged);
    assertSameTestSide(input.customer, p);
  }
  assertBundleIsAccessory(products);

  // guarded update — ตรวจกับเขียนคนละคำสั่ง: มีคนหยิบของแถมไประหว่างนั้น = count ไม่ครบ ⇒ ล้มทั้ง tx
  const updated = await tx.product.updateMany({
    where: { id: { in: ids }, status: 'IN_STOCK', deletedAt: null },
    data: { status: 'RESERVED' },
  });
  if (updated.count !== ids.length) {
    throw new BadRequestException('ของแถมบางรายการเพิ่งถูกขายหรือจองไป กรุณาเลือกใหม่');
  }
  // ของแถมหลุดจาก IN_STOCK แล้ว — ตัด hold ของเว็บใน tx เดียวกัน (กันขายซ้ำ, pattern เดียวกับเครื่องหลัก)
  await preemptReservationsInTx(tx, ids);
}

export async function releaseContractBundles(
  tx: Prisma.TransactionClient,
  bundleProductIds: string[],
): Promise<void> {
  const ids = normalizeBundleIds(bundleProductIds);
  if (!ids.length) return;
  await tx.product.updateMany({
    where: { id: { in: ids }, status: 'RESERVED' },
    data: { status: 'IN_STOCK' },
  });
}

export async function sellContractBundles(
  tx: Prisma.TransactionClient,
  bundleProductIds: string[],
): Promise<void> {
  const ids = normalizeBundleIds(bundleProductIds);
  if (!ids.length) return;
  const updated = await tx.product.updateMany({
    where: { id: { in: ids }, status: 'RESERVED', deletedAt: null },
    data: { status: 'SOLD_CASH' },
  });
  if (updated.count !== ids.length) {
    // ทางออกที่มีจริง: PATCH /contracts/:id/bundles (OWNER/BRANCH_MANAGER/SALES) — การ์ด "ของแถม" หน้ารายละเอียดสัญญา
    throw new BadRequestException(
      'ของแถมของสัญญานี้บางรายการไม่อยู่ในสถานะจองแล้ว — เปิดหน้ารายละเอียดสัญญา กด "แก้ไข" ที่การ์ดของแถม แล้วเลือกใหม่ก่อนเปิดใช้สัญญา',
    );
  }
}

/**
 * ยกเลิกสัญญาหลังเปิดใช้ — sweep กลับรายการต้นทุนของแถมในสมุดแล้ว สถานะสินค้าต้องตามให้ตรง.
 * ชิ้นที่ไม่ได้อยู่ใน SOLD_CASH แล้ว (ถูกลบ/แก้มือ) ถูกข้ามและรายงานกลับให้ผู้เรียกบันทึกใน AuditLog —
 * **ไม่บล็อกการยกเลิก**: ฝั่งเงินต้องเดินต่อได้ ความผิดปกติของอุปกรณ์เสริมชิ้นเดียวไม่ควรล็อกสัญญาทั้งใบ
 */
export async function restoreContractBundles(
  tx: Prisma.TransactionClient,
  bundleProductIds: string[],
): Promise<{ restoredIds: string[]; skippedIds: string[] }> {
  const ids = normalizeBundleIds(bundleProductIds);
  if (!ids.length) return { restoredIds: [], skippedIds: [] };
  const restorable = await tx.product.findMany({
    where: { id: { in: ids }, status: 'SOLD_CASH', deletedAt: null },
    select: { id: true },
  });
  const restoredIds = restorable.map((p) => p.id);
  if (restoredIds.length) {
    await tx.product.updateMany({
      where: { id: { in: restoredIds }, status: 'SOLD_CASH' },
      data: { status: 'IN_STOCK' },
    });
  }
  return { restoredIds, skippedIds: ids.filter((id) => !restoredIds.includes(id)) };
}
