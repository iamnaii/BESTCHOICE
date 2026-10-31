import { LineChannelType } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { buildBrowserUrl } from '../../../utils/line-login.util';

/**
 * Task 20 C1 — ลูกค้าที่ LINE นี้ "พิสูจน์แล้ว" ว่าถือเบอร์ = แถว customer_line_links ช่อง FINANCE ที่ยังผูกอยู่
 * (ผู้เขียนแถวนี้มีทางเดียวคือ VerificationService หลังยืนยัน OTP ทาง SMS — Task 19).
 *
 * บอท OA ร้าน (SHOP) ใช้ฟังก์ชันนี้ก่อนตอบชื่อ/สัญญา/ยอด/งวด/ใบเสร็จ/QR ชำระ/สาขาของสัญญา และบริบท AI —
 * **ห้ามใช้ `customers.line_id_shop` เป็นหลักฐานตัวตน**: คอลัมน์นั้นเคยผูกได้ด้วยการพิมพ์เบอร์อย่างเดียว
 * (ทางนั้นถูกถอดแล้ว แต่ค่าที่เขียนไปก่อนหน้านี้ยังอยู่) และพนักงานพิมพ์เองได้.
 *
 * สมมติฐาน: OA ร้าน / OA การเงิน / LIFF อยู่ LINE provider เดียวกัน ⇒ userId เดียวกัน (สมมติฐานเดียวกับ
 * `liff-warranty`) — ถ้าไม่ใช่ จะไม่มี LINE ฝั่งร้านคนไหนผ่าน (fail closed ไม่ใช่รั่ว)
 */
export async function findOtpVerifiedCustomerId(
  prisma: Pick<PrismaService, 'customerLineLink'>,
  lineUserId: string,
): Promise<string | null> {
  const link = await prisma.customerLineLink.findFirst({
    where: {
      lineUserId,
      channel: LineChannelType.FINANCE,
      unlinkedAt: null,
      deletedAt: null,
      customer: { deletedAt: null },
    },
    select: { customerId: true },
  });
  return link?.customerId ?? null;
}

/**
 * จุดตัดของค่า `customers.line_id_shop` ที่ยังเชื่อเป็นทางสำรอง — ก่อน Task 20 (2026-10-31 00:00 เวลาไทย).
 * แถวที่แก้หลังจากนั้น (`updated_at` ใหม่กว่า — Prisma ตั้งให้ทุกครั้งที่ update) อาจถือค่าที่พนักงาน/บอทขายเขียนใหม่โดยไม่มี OTP
 * ⇒ ไม่นับ (fail closed: แถวเก่าที่ถูกแก้ช่องอื่นภายหลังก็หลุด — ลูกค้ายืนยัน OTP แทน)
 */
export const LEGACY_SHOP_LINE_ID_CUTOFF = new Date('2026-10-31T00:00:00+07:00');

/**
 * Task 22 (task-20-report ข้อกังวล 1 — ทางเลือก ก) — ตัวตนลูกค้าของหน้า LIFF ฝั่งร้าน ("ประกันของฉัน" / เคสหลังการขาย):
 * 1. แถว OTP ของ LINE เดียวกัน (`findOtpVerifiedCustomerId`) — หลักฐานตัวตนเดียวของระบบ (ลูกค้าเงินสดก็ยืนยันได้: OTP ค้นลูกค้าจากเบอร์
 *    ไม่ดูว่ามีสัญญา)
 * 2. สำรองเฉพาะค่า `line_id_shop` ที่เขียนก่อน Task 20 (`updatedAt < LEGACY_SHOP_LINE_ID_CUTOFF`) — ค่าที่เขียนหลังจากนั้นไม่ผ่าน OTP
 *    (พนักงาน/บอทขายยังเขียนคอลัมน์นี้ได้) จึงไม่นับ · ชุดแถวสำรองนี้จำกัดแล้ว (ไม่โตขึ้น) — ตรวจ/ล้างก่อนเชื่อม OA ร้านกับ prod
 *
 * ไม่ใช้ทางเลือก ข (ให้ OTP เขียน line_id_shop ด้วย) เพราะคอลัมน์นั้นยังมีผู้เขียนที่ไม่ผ่าน OTP — เขียนเพิ่มอีกทางไม่ทำให้มันเป็นหลักฐานได้
 */
export async function findShopLiffCustomerId(
  prisma: Pick<PrismaService, 'customerLineLink' | 'customer'>,
  lineUserId: string,
): Promise<string | null> {
  const verified = await findOtpVerifiedCustomerId(prisma, lineUserId);
  if (verified) return verified;
  const legacy = await prisma.customer.findFirst({
    where: {
      lineIdShop: lineUserId,
      deletedAt: null,
      updatedAt: { lt: LEGACY_SHOP_LINE_ID_CUTOFF },
    },
    select: { id: true },
  });
  return legacy?.id ?? null;
}

/**
 * ข้อความเดียวที่บอท OA ร้านตอบ LINE ที่ยังไม่ยืนยัน OTP เมื่อขอข้อมูลสัญญา/ยอด หรือพิมพ์เบอร์มา —
 * ไม่บอกว่าเบอร์มีในระบบไหม ไม่มีชื่อ · ลิงก์เดียวกับที่บอท OA การเงินส่ง (LINE Login → /liff/finance-verify)
 */
export function buildShopVerifyPrompt(): string {
  return (
    'เพื่อความปลอดภัยของข้อมูล ต้องยืนยันตัวตนด้วยเบอร์โทร + รหัส OTP ทาง SMS ก่อนนะคะ\n\n' +
    `👉 ยืนยันตัวตน:\n${buildBrowserUrl('/liff/finance-verify')}\n\n` +
    'ยืนยันเสร็จแล้วกลับมาพิมพ์ "เช็คยอด" ได้เลยค่ะ'
  );
}
