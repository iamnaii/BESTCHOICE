import { Prisma } from '@prisma/client';
import { hashPII } from '../../utils/pii.util';
import { normalizeThaiPhone } from '../../utils/thai-phone.util';
import type { CustomerPiiService } from './customer-pii.service';

/**
 * ล็อกเบอร์หลักของลูกค้า (คำตัดสินเจ้าของ 2026-09-17) — ลูกค้าที่ยังไม่ถูกลบสองคนห้ามถือเบอร์หลักเดียวกัน
 * แต่ไม่มี unique index (ข้อมูลเก่ามีคู่ซ้ำ) ⇒ ผู้เขียนเบอร์หลักทุกทางต้องเรียกฟังก์ชันนี้เป็น
 * **คำสั่งแรกของทรานแซกชัน** แล้วตรวจซ้ำด้วย client ตัวเดียวกัน แล้วค่อยเขียน — READ COMMITTED
 * ทำให้การตรวจหลังได้ล็อกเห็นแถวที่ผู้ถือล็อกก่อนหน้า commit ไปแล้ว
 *
 * กติกาลำดับล็อก: `.claude/rules/database.md` หัวข้อ "ล็อกเบอร์หลักของลูกค้า"
 * (ล็อกแรกของทรานแซกชัน · หนึ่งเบอร์ต่อทรานแซกชัน · ห้ามหลัง lockCreditCustomer/ล็อกแถว/`contact:code`
 * · ห้ามใส่ใน ContactResolverService.ensureRole)
 *
 * คีย์ = hash ของเบอร์ที่ normalize แล้ว (ไม่ให้เบอร์จริงไปโผล่ใน log/pg_stat_statements) ·
 * ไม่มี salt (เทส/dev) = ใช้เบอร์ normalize ตรง ๆ · namespace `customer-phone:` ไม่ชนกับคีย์
 * `<channel>:<key>` ของ ChatProspectService · hashtext เป็น 32 บิต — ชนกันได้แค่ทำให้รอกันเกินจำเป็น
 * ไม่ทำให้ผลผิด
 */
export const CUSTOMER_PHONE_LOCK_PREFIX = 'customer-phone:';

type PhoneHasher = Pick<CustomerPiiService, 'hash'>;

/** คีย์ล็อก — null เมื่อไม่มีเบอร์ · `pii` ไม่ได้ฉีดมา (spec เก่าบางตัว) ใช้ salt จาก env สูตรเดียวกับ CustomerPiiService.hash */
export function customerPhoneLockKey(
  pii: PhoneHasher | null | undefined,
  phone: string | null | undefined,
): string | null {
  const normalized = normalizeThaiPhone(phone);
  if (!normalized) return null;
  const salt = process.env.PII_HASH_SALT || '';
  const hashed = pii ? pii.hash(normalized) : salt ? hashPII(normalized, salt) : null;
  return `${CUSTOMER_PHONE_LOCK_PREFIX}${hashed || normalized}`;
}

export async function lockCustomerPhone(
  tx: Prisma.TransactionClient,
  pii: PhoneHasher | null | undefined,
  phone: string | null | undefined,
): Promise<void> {
  const key = customerPhoneLockKey(pii, phone);
  if (!key) return;
  // $executeRaw ไม่ใช่ $queryRaw — pg_advisory_xact_lock คืน void ที่ Prisma deserialize ไม่ได้ · ปล่อยเองตอนทรานแซกชันจบ
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
}
