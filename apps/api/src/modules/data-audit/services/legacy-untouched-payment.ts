import { Prisma } from '@prisma/client';
import { LEGACY_SYSTEM_USER_EMAIL } from '../../journal/legacy-import-journal';

/**
 * แถวงวด (`payments` alias **`p`**) ที่ตัวนำเข้าระบบเก่าเขียน และ**ยังไม่มีเส้นทางรับเงินใดแตะหลังวันตัด** — เงินทั้งแถว =
 * เงินที่รับก่อนวันตัด ซึ่ง PEAK ลงบัญชีไปแล้ว จึงไม่มีรายการบัญชีใน BESTCHOICE ผูก `paymentId` (Task 16 · 2026-10-30)
 *
 * ครบสามข้อเท่านั้น:
 * 1. `legacy_installment_code` ไม่ว่าง — ผู้เขียนคอลัมน์นี้มีคนเดียวคือตัวนำเข้า (`cli/legacy-backoffice/writer.ts`)
 * 2. `payment_method` ว่าง — ตัวนำเข้าไม่ตั้ง แต่**ทุกเส้นทางรับเงินตั้ง** (หน้ารับชำระ · กระจายเงิน · ใช้เครดิต · ลิงก์ชำระ ·
 *    ปิดยอดก่อนกำหนด)
 * 3. `recorded_by_id` = บัญชีนำเข้า (`LEGACY_SYSTEM_USER_EMAIL`) — ตัวนำเข้าตั้งเฉพาะแถวที่มียอดจ่าย (แถวค้างเป็น null) และเส้นทาง
 *    รับเงินที่มีผู้บันทึกเขียนทับเป็นผู้บันทึกจริง
 *
 * แถวนำเข้าที่รับเงินหลังวันตัดจึงหลุดจากเงื่อนไขนี้ แล้วต้องมีรายการบัญชีหนุนเหมือนแถวของสัญญาปกติ · แถวนำเข้าที่ค้าง
 * (`recorded_by_id` null) ถูกแก้ยอดโดยไม่มีรายการบัญชี = ไม่เข้าเงื่อนไขนี้ (ยังถูกตรวจ)
 *
 * **จุดบอดที่รู้:** แถวนำเข้าที่มีเงินก่อนวันตัดแล้วถูกแก้ยอดโดยเส้นทางที่ไม่ตั้ง `payment_method` (เช่นตัวหักเงินรับล่วงหน้าของ
 * รอบกลางคืน — มีรายการบัญชีของตัวเองผูก `installmentScheduleId`) — การกระทบยอดลูกหนี้รายสัญญา
 * (`journal/contract-receivable-recon.ts`) จับได้ เพราะทะเบียนเปลี่ยนแต่ลูกหนี้ใน GL ไม่เปลี่ยน · เส้นทางรับเงินใหม่ที่ไม่ตั้ง
 * `payment_method` = ต้องทบทวนเงื่อนไขนี้
 *
 * ทุกข้อให้ผลจริง/เท็จเสมอ (ไม่มี NULL) — ข้อ 3 ใช้ `EXISTS` ไม่ใช่ `recorded_by_id IN (…)` ซึ่งเป็น NULL เมื่อแถวไม่มีผู้บันทึก
 * แล้ว `NOT (…)` ของผู้เรียกกลายเป็น NULL ⇒ แถวค้างที่ถูกแก้ยอดหลุดจากการตรวจ (เทส L4 ใน `legacy-import-nightly-checks.db.spec.ts`)
 */
export const LEGACY_UNTOUCHED_PAYMENT = Prisma.sql`(
  p.legacy_installment_code IS NOT NULL
  AND p.payment_method IS NULL
  AND EXISTS (
    SELECT 1 FROM users u
    WHERE u.id = p.recorded_by_id AND u.email = ${LEGACY_SYSTEM_USER_EMAIL}
  )
)`;
