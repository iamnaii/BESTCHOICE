import { Prisma } from '@prisma/client';

/**
 * แปลงคอลัมน์เวลาใน raw SQL เป็นเวลานาฬิกาไทย (2026-11-18)
 *
 * คอลัมน์ DateTime ทุกตัวใน schema.prisma เป็น `timestamp(3) without time zone` ที่เก็บเวลา UTC (ไม่มี @db.Timestamptz)
 * ⇒ `date_trunc` / `EXTRACT` / `::date` บนคอลัมน์ตรง ๆ แบ่งวัน·สัปดาห์·เดือน·ชั่วโมงตาม UTC = ช้ากว่าไทย 7 ชั่วโมง
 * (รายการ 00:00–06:59 น. ไทยตกไปวันก่อนหน้า · ค่าที่เก็บเที่ยงคืนไทยพอดี เช่น due_date กลายเป็นวันก่อนหน้า)
 *
 * `(expr AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Bangkok'` = ตีความค่าเป็น UTC แล้วคืนเวลานาฬิกาไทย (timestamp ไม่มี tz)
 * ไม่ขึ้นกับ TimeZone ของ session ฐานข้อมูล (prod = UTC · ฐานบนเครื่องอาจเป็น Asia/Bangkok) — รูปเดียวกับ
 * customer-journey/sources/chat.source.ts และ chatbot-finance/services/admin-analytics.service.ts
 *
 * `expression` ต้องเป็นข้อความ SQL ที่เขียนไว้ในโค้ด (ชื่อคอลัมน์ / นิพจน์) เท่านั้น — ถูกฝังด้วย Prisma.raw ห้ามส่งค่าจากผู้ใช้
 */
export function sqlBkkLocal(expression: string): Prisma.Sql {
  return Prisma.sql`((${Prisma.raw(expression)} AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Bangkok')`;
}

/** วันตามปฏิทินไทย (ชนิด `date`) ของคอลัมน์เวลา — ใช้เทียบวัน หรือหาจำนวนวันระหว่างสองค่า */
export function sqlBkkDate(expression: string): Prisma.Sql {
  return Prisma.sql`${sqlBkkLocal(expression)}::date`;
}
