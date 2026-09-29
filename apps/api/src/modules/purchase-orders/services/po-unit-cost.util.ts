import { Prisma } from '@prisma/client';
import { d, dRound } from '../../../utils/decimal.util';

/**
 * ต้นทุนต่อหน่วยของสินค้าที่รับเข้าจากใบสั่งซื้อ — คำตัดสินเจ้าของ + คำตอบฝ่ายบัญชี 2026-09-29
 * (ข2 ต้นทุนรวม VAT · ข5 ส่วนลดท้ายบิลแบ่งตามสัดส่วนราคา).
 *
 * ต้นทุน = ส่วนแบ่งของ `netAmount` (ยอดที่ต้องจ่ายผู้จัดจำหน่ายจริง: หลังส่วนลดก่อน VAT,
 * รวม VAT, หลังส่วนลดหลัง VAT) ตามสัดส่วน `unitPrice ÷ totalAmount` ⇒ ต้นทุนของทุกหน่วยใน
 * ใบสั่งซื้อรวมกัน = เจ้าหนี้ที่ตั้งไว้พอดี บัญชีสินค้าคงคลังจึงกลับเป็นศูนย์เมื่อขายครบ
 *
 * ปัดครึ่งขึ้นที่สตางค์ "รายหน่วย" — เศษที่เหลือ (`poCostRemainder`) ผู้เรียกลงหน่วยเดียว
 * ในการรับครั้งที่ทำให้ใบสั่งซื้อครบ ต้นทุนของหน่วยที่รับไปก่อนหน้าจึงไม่ต้องย้อนกลับไปแก้
 */
type DecimalInput = Prisma.Decimal | string | number;

export interface PoCostBasis {
  /** Σ quantity × unitPrice — ก่อนส่วนลด ก่อน VAT */
  totalAmount: DecimalInput;
  /** ยอดสุทธิที่ต้องจ่ายผู้จัดจำหน่าย */
  netAmount: DecimalInput;
  items: { quantity: number; unitPrice: DecimalInput }[];
}

function assertNetNotNegative(basis: PoCostBasis): void {
  if (d(basis.netAmount).lt(0)) {
    throw new RangeError(`PoCostBasis: netAmount must not be negative; got ${d(basis.netAmount).toFixed(2)}`);
  }
}

export function poUnitCost(basis: PoCostBasis, unitPrice: DecimalInput): Prisma.Decimal {
  assertNetNotNegative(basis);
  const total = d(basis.totalAmount);
  if (!total.gt(0)) return dRound(unitPrice);
  return dRound(d(basis.netAmount).mul(unitPrice).div(total));
}

export function poCostRemainder(basis: PoCostBasis): Prisma.Decimal {
  assertNetNotNegative(basis);
  if (!d(basis.totalAmount).gt(0)) return new Prisma.Decimal(0);
  const allocated = basis.items.reduce(
    (sum, item) => sum.add(poUnitCost(basis, item.unitPrice).mul(item.quantity)),
    new Prisma.Decimal(0),
  );
  return d(basis.netAmount).sub(allocated);
}
