import { Prisma } from '@prisma/client';
import { PoCostLine, poLineCosts, poUnitCostAt } from './po-unit-cost.util';

/**
 * ภาษีซื้อต่อหน่วยของสินค้าที่รับเข้าจากใบสั่งซื้อ (ก้อน 5 · คำตอบฝ่ายบัญชี 2026-10-05 ข้อ 2.2):
 * แบ่ง `PurchaseOrder.vatAmount` ตามสัดส่วนราคา **ด้วยการปัดสะสมสองชั้นเดียวกับต้นทุน** (`po-unit-cost.util`)
 * ⇒ Σ receivedVat ของทุกหน่วยในใบสั่งซื้อ = vatAmount พอดี · ผู้จัดจำหน่ายไม่จด VAT (vatAmount 0) = ทุกหน่วย 0
 *
 * ไม่คำนวณ 7% เอง — ยอด VAT ที่ลงบัญชีจริงคือยอดบนใบสั่งซื้อ/ใบกำกับ (รวมส่วนลดก่อน VAT แล้ว)
 */
export interface PoVatBasis {
  vatAmount: Prisma.Decimal | string | number;
  lines: PoCostLine[];
}

/** ภาษีซื้อรวมของแต่ละรายการ (key = id ของรายการ) — รวมกันเท่า `vatAmount` พอดี */
export function poLineVats(basis: PoVatBasis): Map<string, Prisma.Decimal> {
  return poLineCosts({ netAmount: basis.vatAmount, lines: basis.lines });
}

/** ภาษีซื้อของหน่วยลำดับที่ `k` (เริ่มที่ 1) ของรายการที่สั่ง `quantity` หน่วย */
export const poUnitVatAt = poUnitCostAt;
