import { PaymentLinkPurpose, Prisma } from '@prisma/client';
import { formatDateTime } from '../../utils/thai-date.util';

/**
 * Task 41 (ค) — คำตัดสินผู้คุมงาน 2026-11-03: สัญญาหนึ่งมี QR ปิดยอดที่ยังเปิดอยู่ได้ใบเดียว · กันที่ `create-intent` ก่อนลูกค้าได้ลิงก์ชำระ
 * (ลูกค้าจ่าย QR ปิดยอดสองใบ = ใบที่สองไม่มีงวดให้ตัด เงินทั้งก้อนค้างเป็นเงินรับล่วงหน้าที่ระบบยังคืนไม่ได้)
 *
 * "QR ปิดยอดที่ยังเปิด" = แถวติดตามที่ `createPaymentIntent` สร้างสำหรับการปิดยอด (`purpose = PAYOFF` + มี `payoffQuote` — ลิงก์ `/pay/:token`
 * ต้นทางไม่มีค่านี้จึงไม่นับ) · ยังไม่ได้ชำระและไม่ล้ม (`status = ACTIVE` — webhook ตั้ง `USED` เมื่อสำเร็จ / `EXPIRED` เมื่อชำระไม่สำเร็จ) ·
 * ยังไม่เลยเวลาหมดอายุ (30 นาที) · ไม่ถูกลบ · ตัดสินจากข้อมูลของ server เท่านั้น
 *
 * ด่านสองชั้นใน `createPaymentIntent`: (1) ก่อนเรียก gateway — ตรวจเฉย ๆ (คำขอทีละครั้งไม่ถึง gateway) (2) ในธุรกรรมที่สร้างแถวติดตาม —
 * `pg_advisory_xact_lock` ต่อสัญญาแล้วตรวจซ้ำ ⇒ สองคำขอพร้อมกันที่ผ่านชั้นแรกมาทั้งคู่ คำขอที่สองเห็นแถวของคำขอแรก (commit แล้ว) และได้ 400
 * โดยไม่ได้ลิงก์ชำระ (intent ที่ gateway สร้างให้คำขอนั้นไม่มีใครเห็น QR — ไม่มีเงินเข้า) · ไม่ถือล็อกข้ามการเรียก gateway
 */
export const payoffIntentLockKey = (contractId: string) =>
  `paysolutions-payoff-intent:${contractId}`;

type PayoffIntentReader = Pick<Prisma.TransactionClient, 'paymentLink'>;

export async function findOpenPayoffIntent(
  client: PayoffIntentReader,
  contractId: string,
  now: Date = new Date(),
): Promise<{ id: string; expiresAt: Date } | null> {
  return client.paymentLink.findFirst({
    where: {
      contractId,
      purpose: PaymentLinkPurpose.PAYOFF,
      NOT: { payoffQuote: { equals: Prisma.DbNull } },
      status: 'ACTIVE',
      expiresAt: { gt: now },
      deletedAt: null,
    },
    orderBy: { expiresAt: 'desc' },
    select: { id: true, expiresAt: true },
  });
}

/** ล็อกต่อสัญญาของการสร้างแถวติดตาม QR ปิดยอด — แบบเดียวกับ `early-payoff-request.ts` (`$executeRaw` · ปล่อยเองตอนธุรกรรมจบ) */
export async function lockPayoffIntent(
  tx: Pick<Prisma.TransactionClient, '$executeRaw'>,
  contractId: string,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${payoffIntentLockKey(contractId)}))`;
}

/**
 * ข้อความลูกค้า (หน้า LIFF ปิดยอด `/liff/early-payoff` และหน้า `/pay/:token` แสดงข้อความไทยจาก server) · ทางไปต่อที่มีจริง: ทั้งสองหน้ามีลิงก์
 * "กลับไปดูสัญญา" ท้ายหน้า → `/liff/contract` มีปุ่ม "ประวัติชำระเงิน" (`/liff/history` — งวดที่ชำระแล้ว) · หลังเวลาหมดอายุกดชำระบนหน้าเดิมได้อีกครั้ง
 */
export function openPayoffIntentMessage(expiresAt: Date): string {
  return `มี QR ปิดยอดของสัญญานี้ที่สร้างไว้แล้ว ใช้ได้ถึง ${formatDateTime(expiresAt)} น. — ถ้าชำระไปแล้ว กด "กลับไปดูสัญญา" ด้านล่าง แล้วกด "ประวัติชำระเงิน" เพื่อดูผล · ถ้ายังไม่ได้ชำระ กรุณารอให้เลยเวลานั้นแล้วกดชำระใหม่`;
}
