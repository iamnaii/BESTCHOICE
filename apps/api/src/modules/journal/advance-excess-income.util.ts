import { BadRequestException } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

/**
 * รายได้เงินพักส่วนเกิน 42-1106 (PR4 ต6/ต6ข — คำตอบฝ่ายบัญชี เล่ม 1 ข้อ 3, 29/09/2569).
 *
 * รอบกวาดรายวัน (`journal/cron/advance-excess-income.cron.ts` → `AdvanceExcessIncomeTemplate`) ลง
 * `Dr 21-1103 / Cr 42-1106 / Cr 21-2102 [ภาษีที่รับรู้ตอนพักและยังค้าง]` ให้สัญญาที่ผ่อนครบ/ปิดแล้วและ 21-1103 ยังมียอด.
 * ไฟล์นี้ถือค่าคงที่ร่วม + ตัวอ่านรายการของ flow นี้ (ไม่มี Nest dependency — ใช้ได้ทั้ง template, การยกเลิกใบเสร็จ
 * และจุดสร้างคำขออนุมัติ).
 *
 * ด่าน ต6ข: หลังลงรายได้แล้ว การยกเลิกใบเสร็จของสัญญานั้นจะคืน 21-1103/คอลัมน์ ขณะที่เงินอยู่ใน 42-1106 และ idempotency
 * กันรายการที่สอง ⇒ เงินค้างไม่มีทางออก — จึงปฏิเสธจนกว่าฝ่ายบัญชีจะกลับรายการ (ประทับ `reversed: true`).
 */

export const ADVANCE_EXCESS_INCOME_FLOW = 'advance-excess-income';
export const ADVANCE_EXCESS_INCOME_TAG = 'ADVANCE_EXCESS';
export const ADVANCE_EXCESS_INCOME_ACCOUNT = '42-1106';
export const ADVANCE_EXCESS_INCOME_AUDIT_ACTION = 'ADVANCE_EXCESS_RECOGNIZED';
export const ADVANCE_EXCESS_VOID_BLOCKED_MESSAGE =
  'สัญญานี้ลงรายได้เงินพักส่วนเกิน (42-1106) แล้ว — ต้องให้ฝ่ายบัญชีกลับรายการก่อน';

type Client = Prisma.TransactionClient | PrismaClient;

export interface AdvanceExcessIncomeEntry {
  id: string;
  entryNumber: string;
  metadata: unknown;
}

/**
 * รายการที่ยังมีผล = เป็นรายการของ flow นี้จริง (`metadata.flow` — กันแถวที่หลุดมาจากคำค้นที่กว้างกว่า) และยังไม่ถูกประทับ
 * `reversed: true` (กระจกทุกชนิดประทับบนต้นฉบับ)
 */
export function isActiveAdvanceExcessEntry(entry: { metadata: unknown }): boolean {
  const m = entry.metadata;
  if (!m || typeof m !== 'object' || Array.isArray(m)) return false;
  const meta = m as Record<string, unknown>;
  return meta.flow === ADVANCE_EXCESS_INCOME_FLOW && meta.reversed !== true;
}

/**
 * ทุกรายการ POSTED ที่ไม่ถูกลบของ flow นี้ของสัญญา (รวมที่ถูกกลับแล้ว — ผู้เรียกใช้จำนวนทั้งหมดเป็นลำดับของ
 * idempotencyKey เมื่อต้องลงใหม่หลังกลับรายการ). กรอง `reversed` ใน JS: JSON-path equality บนคีย์ที่ไม่มี
 * เป็น NULL ใน SQL — `NOT(...)` จะทิ้งรายการที่ไม่เคยถูกกลับไปด้วย (กติกาเดียวกับตัวจับคู่ของการยกเลิกใบเสร็จ).
 */
export async function listAdvanceExcessIncomeEntries(
  client: Client,
  contractId: string,
): Promise<AdvanceExcessIncomeEntry[]> {
  return client.journalEntry.findMany({
    where: {
      AND: [
        { metadata: { path: ['flow'], equals: ADVANCE_EXCESS_INCOME_FLOW } },
        { metadata: { path: ['contractId'], equals: contractId } },
      ],
      status: 'POSTED',
      deletedAt: null,
    },
    orderBy: { createdAt: 'asc' },
    select: { id: true, entryNumber: true, metadata: true },
  });
}

export async function findActiveAdvanceExcessIncome(
  client: Client,
  contractId: string,
): Promise<AdvanceExcessIncomeEntry[]> {
  const all = await listAdvanceExcessIncomeEntries(client, contractId);
  return all.filter(isActiveAdvanceExcessEntry);
}

/** ด่าน ต6ข — โยน 400 ภาษาไทยเมื่อสัญญามีรายการรายได้เงินพักส่วนเกินที่ยังมีผล */
export async function assertNoAdvanceExcessIncome(
  client: Client,
  contractId: string,
): Promise<void> {
  const active = await findActiveAdvanceExcessIncome(client, contractId);
  if (active.length > 0) throw new BadRequestException(ADVANCE_EXCESS_VOID_BLOCKED_MESSAGE);
}

/**
 * สถานะสัญญาที่รอบกวาดไม่แตะ (แผน ต6): บอกเลิก/ตัดหนี้สูญ (JP5/ตัดหนี้สูญล้าง 21-1103 เองตาม PR6) · ยกเลิก/ร่าง (ไม่มีรายการ) ·
 * เปลี่ยนเครื่อง (รายการถูก mirror/ย้าย). `COMPLETED` / `EARLY_PAYOFF` และสัญญาที่ทุกแถว Payment เป็น PAID (ครบงวดทาง
 * รอบกลางคืนซึ่งไม่ flip สถานะ — ผลตรวจ I4) คือเป้าหมายของรอบกวาด.
 */
export const ADVANCE_EXCESS_EXCLUDED_CONTRACT_STATUSES = [
  'TERMINATED',
  'CLOSED_BAD_DEBT',
  'CANCELED',
  'DRAFT',
  'EXCHANGED',
  'DEFECT_EXCHANGED',
] as const;
