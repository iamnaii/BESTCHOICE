import { Prisma } from '@prisma/client';

/**
 * เงินที่ "รับจากพนักงานแล้วแต่ยังไม่เข้าธนาคาร" ของ (สาขา, แหล่งเก็บ) — คำนวณจากสองกองเท่านั้น:
 * การปิดยอดที่ยืนยันแล้วซึ่งเลือกแหล่งเก็บนั้น กับยอด "บันทึกนำฝาก" สะสม. ตัดแบบ FIFO (ครั้งที่เก่าสุดก่อน) —
 * ไม่มีคอลัมน์ผูกนำฝาก↔ปิดยอด โดยตั้งใจ: ฝากรวมหลายครั้ง/ฝากบางส่วนได้ และผลลัพธ์คำนวณซ้ำได้เหมือนเดิมเสมอ
 */
export interface HoldingClose {
  id: string;
  confirmedAt: Date;
  amount: Prisma.Decimal;
  /** การปิดยอดครั้งนี้ลงบัญชีแล้วหรือไม่ (มี JE ตอนยืนยันรับเงิน) */
  posted: boolean;
}

export interface HoldingAllocation {
  outstanding: Prisma.Decimal;
  openCloses: { id: string; confirmedAt: Date; outstanding: Prisma.Decimal }[];
  /** การปิดยอดที่ยอดนำฝากสะสมครอบเต็มจำนวนแล้ว */
  settledCloseIds: string[];
}

const ZERO = new Prisma.Decimal(0);
const CENT = new Prisma.Decimal('0.005');

/** `closes` ต้องเรียงเก่า → ใหม่ */
export function allocateDeposits(closes: HoldingClose[], depositedTotal: Prisma.Decimal): HoldingAllocation {
  let remaining = depositedTotal;
  const openCloses: HoldingAllocation['openCloses'] = [];
  const settledCloseIds: string[] = [];
  for (const close of closes) {
    const covered = Prisma.Decimal.min(close.amount, Prisma.Decimal.max(remaining, ZERO));
    remaining = remaining.minus(covered);
    const left = close.amount.minus(covered);
    if (left.gte(CENT)) openCloses.push({ id: close.id, confirmedAt: close.confirmedAt, outstanding: left });
    else settledCloseIds.push(close.id);
  }
  return { outstanding: openCloses.reduce((sum, row) => sum.plus(row.outstanding), ZERO), openCloses, settledCloseIds };
}

/**
 * ส่วนของยอดนำฝากครั้งใหม่ (ช่วง [ฝากไปแล้ว, ฝากไปแล้ว + amount) บนแกนสะสมของการปิดยอด) ที่ตกบนการปิดยอดซึ่ง **ลงบัญชีแล้ว**.
 * JE นำฝากเครดิตบัญชีแหล่งเก็บได้เฉพาะส่วนที่เคยถูกเดบิตจริง — การปิดยอดที่ข้ามการลงบัญชี (สาขายังไม่ตั้งลิ้นชัก) ไม่มียอดให้ล้าง
 */
export function postedPortion(closes: HoldingClose[], alreadyDeposited: Prisma.Decimal, amount: Prisma.Decimal): Prisma.Decimal {
  const from = alreadyDeposited;
  const to = alreadyDeposited.plus(amount);
  let cursor = ZERO;
  let posted = ZERO;
  for (const close of closes) {
    const start = cursor;
    const end = cursor.plus(close.amount);
    cursor = end;
    if (!close.posted) continue;
    const overlap = Prisma.Decimal.min(end, to).minus(Prisma.Decimal.max(start, from));
    if (overlap.gt(0)) posted = posted.plus(overlap);
  }
  return posted;
}
