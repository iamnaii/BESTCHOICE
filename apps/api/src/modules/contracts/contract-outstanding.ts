import { Prisma } from '@prisma/client';
import { d } from '../../utils/decimal.util';

/**
 * คงค้าง (outstanding) — กฎกลางหนึ่งเดียวของทั้งระบบ
 *
 * 🔴 D2 (คำตัดสินชั่วคราว — รอเจ้าของเคาะ): "คงค้าง" = Σ (amountDue − amountPaid)
 * เฉพาะงวดที่ยัง **ไม่** ปิด (status != 'PAID') clamp ที่ 0 และ **ไม่รวม lateFee**
 * เป็นนิยามเดียวกับการ์ด Customer 360 ของหน้าติดตามหนี้ (ContractSnapshotService)
 * ซึ่งเป็นเลขที่เจ้าของอ่านอยู่แล้ว — ไฟล์นี้ถูกแยกออกมาเพื่อให้สองหน้าจอ
 * (การ์ดติดตามหนี้ + คอลัมน์ "คงค้าง · งวดถัดไป" ของหน้า /customers) ใช้โค้ดชุดเดียวกัน
 * พิสูจน์ได้ว่าไม่มีทางหลุดจากกัน (ก่อนหน้านี้มี 5 สูตรในรีโป และทั้ง 5 ให้เลขไม่ตรงกัน)
 *
 * ไฟล์นี้ **บริสุทธิ์** — ไม่มี Prisma client ไม่มี I/O ผู้เรียกยิง query เอง
 * แล้วส่งแถวเข้ามา จึง batch ได้ (หน้า /customers ยิง groupBy ครั้งเดียวต่อหน้า)
 *
 * ทำไมต้องตัดงวดที่ PAID ทิ้ง: งวดที่ปิดแล้วอาจมี amountPaid < amountDue ได้
 * (ส่วนลดปิดยอดก่อนกำหนด / tolerance ≤1฿) — ช่องว่างนั้นคือ "ส่วนลด" ไม่ใช่ "หนี้"
 * สูตรเก่าที่บวกทุกแถวรายงานส่วนลดเป็นคงค้าง
 */
export const UNPAID_INSTALLMENT_WHERE = {
  deletedAt: null,
  status: { not: 'PAID' },
} satisfies Prisma.PaymentWhereInput;

type DecimalLike = Prisma.Decimal | string | number | null | undefined;

/** แถวงวดที่ยังไม่ปิด — อ่านมาด้วย UNPAID_INSTALLMENT_WHERE เท่านั้น */
export interface UnpaidInstallmentAmount {
  amountDue: DecimalLike;
  amountPaid: DecimalLike;
}

/** แถวงวดที่ยังไม่ปิด พร้อมวันครบกำหนด — สำหรับหา "งวดถัดไป" */
export interface UnpaidInstallmentDue extends UnpaidInstallmentAmount {
  dueDate: Date;
  /** ใช้ตัดสินเมื่อ dueDate เท่ากัน (ไม่ส่งมาก็ได้) */
  installmentNo?: number;
}

/**
 * คงค้างของแถวที่ส่งเข้ามา — Σ (amountDue − amountPaid) clamp ที่ 0
 *
 * ⚠️ ผู้เรียกต้องกรองแถวมาด้วย UNPAID_INSTALLMENT_WHERE ก่อน ฟังก์ชันนี้ไม่กรองซ้ำ
 * (แถว PAID ที่จ่ายขาด = ส่วนลด ถ้าหลุดเข้ามาจะถูกนับเป็นหนี้ผิด ๆ)
 *
 * คำนวณด้วย Prisma.Decimal ไม่ใช่ float — ยอดเงินทุกคอลัมน์เป็น Decimal(12,2)
 */
export function outstandingOf(rows: readonly UnpaidInstallmentAmount[]): number {
  const total = rows.reduce(
    (acc, row) => acc.add(d(row.amountDue)).sub(d(row.amountPaid)),
    new Prisma.Decimal(0),
  );
  return total.isNegative() ? 0 : total.toDecimalPlaces(2).toNumber();
}

/**
 * งวดถัดไป = แถวที่ dueDate เร็วที่สุดในกลุ่มที่ยังไม่ปิด
 *
 * 🔴 กับดักที่มีอยู่จริงในรีโปนี้ (customer-analytics.service.ts:197-202 และ
 * dashboard-collections.service.ts:325-351): ใช้ `MIN(due_date)` คู่กับ
 * `MIN(amount_due)` ใน groupBy เดียวกัน — `MIN(amount_due)` คือ "ยอดที่น้อยที่สุด"
 * ไม่ใช่ "ยอดของงวดที่ครบกำหนดเร็วที่สุด" สองค่ามักมาจากคนละแถว
 * ฟังก์ชันนี้คืน amountDue **ของแถวนั้นเอง** จึงไม่มีทางเพี้ยนแบบนั้น
 */
export function nextDueOf(
  rows: readonly UnpaidInstallmentDue[],
): { dueDate: Date; amountDue: number } | null {
  let earliest: UnpaidInstallmentDue | null = null;
  for (const row of rows) {
    if (!earliest) { earliest = row; continue; }
    const delta = row.dueDate.getTime() - earliest.dueDate.getTime();
    if (delta < 0) { earliest = row; continue; }
    // dueDate ชนกัน (เช่นลูกค้ามีหลายสัญญาครบกำหนดวันเดียวกัน) → งวดเลขน้อยกว่าเป็นงวดถัดไป
    if (delta === 0 && (row.installmentNo ?? Infinity) < (earliest.installmentNo ?? Infinity)) {
      earliest = row;
    }
  }
  if (!earliest) return null;
  return { dueDate: earliest.dueDate, amountDue: d(earliest.amountDue).toDecimalPlaces(2).toNumber() };
}
