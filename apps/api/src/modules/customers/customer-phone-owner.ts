import { Prisma } from '@prisma/client';
import { normalizeThaiPhone } from '../../utils/thai-phone.util';

/**
 * หาลูกค้าคนอื่นที่ยังไม่ถูกลบซึ่งถือเบอร์นี้เป็นเบอร์หลัก (เก่าสุดก่อน) — นิยามเดียวของ skip-tracing
 * และการนำเข้าลูกค้า (เรียกหลัง `lockCustomerPhone` ด้วย tx ตัวเดียวกัน)
 *
 * แถวที่ `phoneHash` ชี้เบอร์นี้แต่ plaintext (normalize แล้ว) เป็นเบอร์อื่น = hash ค้างจากบั๊ก skip-tracing
 * เดิม ไม่ใช่เจ้าของจริง ⇒ ข้าม · plaintext ว่าง (strict mode) นับเป็นเจ้าของเมื่อ hash ตรงเท่านั้น
 *
 * `phone` ต้อง normalize มาแล้ว · `excludeIds` = แถวที่ผู้เรียกกำลังเขียนเอง
 */
export async function findLivePhoneOwner(
  db: Prisma.TransactionClient,
  phone: string,
  phoneHash: string | null | undefined,
  excludeIds: string[] = [],
): Promise<{ id: string; name: string } | null> {
  const candidates = await db.customer.findMany({
    where: {
      deletedAt: null,
      ...(excludeIds.length ? { id: { notIn: excludeIds } } : {}),
      OR: [{ phone }, ...(phoneHash ? [{ phoneHash }] : [])],
    },
    select: { id: true, name: true, phone: true, phoneHash: true },
    orderBy: { createdAt: 'asc' },
    take: 10,
  });
  const owner = candidates.find((c) => {
    const plain = normalizeThaiPhone(c.phone);
    return plain ? plain === phone : !!phoneHash && c.phoneHash === phoneHash;
  });
  return owner ? { id: owner.id, name: owner.name } : null;
}
