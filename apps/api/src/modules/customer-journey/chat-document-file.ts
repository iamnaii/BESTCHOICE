import { Prisma } from '@prisma/client';

/*
 * "ลูกค้าส่งไฟล์เอกสารในแชท" — แหล่งเดียวของกติกา (คำตัดสินผู้ควบคุม R-P1 2026-09-15)
 * นับเฉพาะ chat_messages ที่ role CUSTOMER + type FILE + media_url ลงท้ายด้วยนามสกุลเอกสาร (pdf · doc · docx · xls · xlsx ไม่สนตัวพิมพ์)
 * ตามด้วย query string (?) หรือจบสตริง
 * ทำไม: webhook Facebook แปลงไฟล์แนบชนิดที่ไม่รู้จัก (fallback / template เช่นแชร์ลิงก์) เป็น FILE (facebook-webhook.controller.ts parseMessage)
 *   prod 2026-09-15 (นับรวมอย่างเดียว): .pdf 818 ไฟล์ / 416 ห้อง · media_url ว่าง 107 / 48 ห้อง · ลิงก์ facebook.com 26 / 25 ห้อง · เอกสาร office 1
 * ผู้ใช้: sql/journey-state.sql (first_file_at → credit_at) · journey-summary.service.ts (CHAT_FILE · creditFilePending) · sources/chat.source.ts (แถว CHAT_CUSTOMER_FILE)
 * 🔴 PDPA: media_url อยู่ใน WHERE / FILTER เท่านั้น — ห้าม select ออกไปเป็นเหตุการณ์ · summary · log · audit · snapshot ของเทส
 * journey-state.sql import ค่าคงที่ไม่ได้ ⇒ เขียน CUSTOMER_DOCUMENT_FILE_SQL ตรงตัวอักษร · chat-document-file.spec.ts ปักว่าตรงกันและห้ามมีสำเนาอื่นในโมดูล
 */

/** regex ของนามสกุลเอกสารท้าย media_url — ใช้กับ ~* (ไม่สนตัวพิมพ์) */
export const CHAT_DOCUMENT_FILE_PATTERN = String.raw`\.(pdf|docx?|xlsx?)(\?|$)`;

/** เงื่อนไข SQL ทั้งก้อน · alias m = chat_messages · ต้องใช้กับ standard_conforming_strings = on (ค่าเริ่มต้นของ Postgres) */
export const CUSTOMER_DOCUMENT_FILE_SQL = `m.role = 'CUSTOMER' AND m.type = 'FILE' AND m.media_url ~* '${CHAT_DOCUMENT_FILE_PATTERN}'`;

/** เงื่อนไขเดียวกันสำหรับ prisma.$queryRaw — เป็นข้อความคงที่ของโค้ด ไม่มีค่าจากผู้ใช้ จึงฝังด้วย Prisma.raw ได้ */
export const CUSTOMER_DOCUMENT_FILE_FRAGMENT = Prisma.raw(CUSTOMER_DOCUMENT_FILE_SQL);
