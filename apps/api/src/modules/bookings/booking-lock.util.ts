import { Prisma } from '@prisma/client';

/**
 * ใบจอง PAID ที่ล็อกเครื่องนี้อยู่ (`Booking.lockedProductId` — PR #1680) หรือ null ถ้าไม่มี
 *
 * #1679 ระยะสั้น: สถานะ `RESERVED` ไม่มีเจ้าของในสคีมา — เส้นทางสัญญาใช้ตัวนี้ถามว่า RESERVED นั้นเป็นของใบจองหรือไม่
 * (ลบร่างสัญญา → ห้ามปลดเครื่อง · เปิดสัญญา → ห้ามเปิด). ส่ง `tx` เมื่ออยู่ใน transaction ให้อ่านแถวเดียวกับที่จะเขียน
 */
export function findPaidBookingLock(
  db: Prisma.TransactionClient,
  productId: string,
): Promise<{ bookingNumber: string } | null> {
  return db.booking.findFirst({
    where: { lockedProductId: productId, status: 'PAID', deletedAt: null },
    select: { bookingNumber: true },
  });
}
