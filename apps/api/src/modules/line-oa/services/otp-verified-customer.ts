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
