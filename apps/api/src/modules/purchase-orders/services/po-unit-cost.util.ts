import { Prisma } from '@prisma/client';
import { d, dRound } from '../../../utils/decimal.util';

/**
 * ต้นทุนต่อหน่วยของสินค้าที่รับเข้าจากใบสั่งซื้อ — คำตัดสินเจ้าของ + คำตอบฝ่ายบัญชี 2026-09-29
 * (ข2 ต้นทุนรวม VAT · ข5 ส่วนลดท้ายบิลแบ่งตามสัดส่วนราคา).
 *
 * ต้นทุน = ส่วนแบ่งของ `netAmount` (ยอดที่ต้องจ่ายผู้จัดจำหน่ายจริง: หลังส่วนลดก่อน VAT,
 * รวม VAT, หลังส่วนลดหลัง VAT) ตามสัดส่วนมูลค่า ⇒ ต้นทุนของทุกหน่วยในใบสั่งซื้อรวมกัน
 * = เจ้าหนี้ที่ตั้งไว้พอดี บัญชีสินค้าคงคลังจึงกลับเป็นศูนย์เมื่อขายครบ
 *
 * ปันแบบ "ปัดสะสม" (cumulative rounding) สองชั้น:
 *   ชั้นรายการ: ต้นทุนของรายการที่ i = round(net × มูลค่าสะสมถึง i ÷ มูลค่ารวม) − round(… ถึง i−1)
 *   ชั้นหน่วย:  ต้นทุนของหน่วยที่ k  = round(ต้นทุนรายการ × k ÷ จำนวน) − round(… × (k−1) ÷ จำนวน)
 * ผลต่างของค่าที่ปัดแล้วรวมกันได้ค่าปลายทางพอดี (telescoping) จึง **ไม่มีเศษเหลือให้ลงทีหลัง**
 * และไม่มีหน่วยไหนติดลบ (ค่าสะสมไม่ลดลง). หน่วยในรายการเดียวกันต่างกันได้ไม่เกิน 1 สตางค์
 *
 * เคยใช้ "ปัดรายหน่วยแล้วลงเศษที่หน่วยเดียวตอนรับครบ" — ตัดทิ้งเพราะใบสั่งซื้อที่มีหน่วยราคาถูก
 * จำนวนมาก (1,000 × 1.00 ส่วนลด 4.99 → เศษ −4.99) หรือรับของแถมราคาศูนย์เป็นชิ้นสุดท้าย
 * ทำให้ต้นทุนติดลบและรับของไม่ครบตลอดไป (ผลตรวจทาน 2026-09-29)
 *
 * หน่วยลำดับที่ k ของรายการ = หน่วยที่ตรวจผ่านเป็นลำดับที่ k ของรายการนั้น (นับข้ามใบรับของ) —
 * ต้นทุนของหน่วยจึงไม่ขึ้นกับว่ารับกี่ครั้งหรือรับรายการไหนก่อน
 */
type DecimalInput = Prisma.Decimal | string | number;

export interface PoCostLine {
  id: string;
  quantity: number;
  unitPrice: DecimalInput;
  createdAt?: Date | null;
}

export interface PoCostBasis {
  /** ยอดสุทธิที่ต้องจ่ายผู้จัดจำหน่าย */
  netAmount: DecimalInput;
  lines: PoCostLine[];
}

/** ลำดับรายการต้องนิ่งข้ามการเรียก — Prisma ไม่รับประกันลำดับของ relation ที่ include มา */
function stableOrder(lines: PoCostLine[]): PoCostLine[] {
  return [...lines].sort((a, b) => {
    const byTime = (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0);
    if (byTime !== 0) return byTime;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** ต้นทุนรวมของแต่ละรายการ (key = id ของรายการ) — รวมกันเท่า `netAmount` พอดี */
export function poLineCosts(basis: PoCostBasis): Map<string, Prisma.Decimal> {
  const net = d(basis.netAmount);
  if (net.lt(0)) {
    throw new RangeError(`PoCostBasis: netAmount must not be negative; got ${net.toFixed(2)}`);
  }
  const ordered = stableOrder(basis.lines);
  const total = ordered.reduce((sum, line) => sum.add(d(line.unitPrice).mul(line.quantity)), new Prisma.Decimal(0));

  const costs = new Map<string, Prisma.Decimal>();
  let cumulativeValue = new Prisma.Decimal(0);
  let allocated = new Prisma.Decimal(0);
  for (const line of ordered) {
    if (!total.gt(0)) {
      costs.set(line.id, new Prisma.Decimal(0));
      continue;
    }
    cumulativeValue = cumulativeValue.add(d(line.unitPrice).mul(line.quantity));
    const allocatedThrough = dRound(net.mul(cumulativeValue).div(total));
    costs.set(line.id, allocatedThrough.sub(allocated));
    allocated = allocatedThrough;
  }
  return costs;
}

/** ต้นทุนของหน่วยลำดับที่ `k` (เริ่มที่ 1) ของรายการที่สั่ง `quantity` หน่วย */
export function poUnitCostAt(lineCost: DecimalInput, quantity: number, k: number): Prisma.Decimal {
  if (!Number.isInteger(k) || k < 1 || k > quantity) {
    throw new RangeError(`poUnitCostAt: unit index ${k} is outside 1..${quantity}`);
  }
  const cost = d(lineCost);
  return dRound(cost.mul(k).div(quantity)).sub(dRound(cost.mul(k - 1).div(quantity)));
}

/** ต้นทุนของ `count` หน่วยติดกัน เริ่มจากหน่วยลำดับที่ `fromK` */
export function poUnitCosts(lineCost: DecimalInput, quantity: number, fromK: number, count: number): Prisma.Decimal[] {
  return Array.from({ length: count }, (_, i) => poUnitCostAt(lineCost, quantity, fromK + i));
}
