import { Prisma } from '@prisma/client';

/**
 * กติกาเดียวของ "รายการสมดุล": Σ เดบิต = Σ เครดิต **พอดีทุกสตางค์ — ไม่มีเผื่อ** (คำตัดสินเจ้าของ 2026-10-31) — ห้ามมีเกณฑ์ชุดที่สอง
 *
 * ผู้ใช้: ทางลงบัญชีทั้งสองทาง (`JournalService.create` · `JournalAutoService.createAndPost`) · ข้อกลางคืน `journal_balance` และการไล่ตรวจสัญญา
 * (`data-audit`) · การตรวจก่อนปิดงวด (`MonthlyCloseService.runDataAudit`) · งบทดลองรวม (`ConsolidatedService`) · ตัวตรวจรายการที่ผู้ใช้แก้เอง
 * (`JournalOverrideService` V1) · `isJournalBalanced` = รูป TS · `JOURNAL_UNBALANCED_SQL` = รูปคิวรีของกติกาเดียวกัน
 *
 * ทางลงบัญชีบังคับสมดุลพอดีตั้งแต่ Wave-1 #10 (`2a4c59c13` · 2026-06-07) ⇒ รายการที่ต่างแม้ 0.01 เกิดได้จากการเขียนนอกสองทางนั้นเท่านั้น (SQL ตรง /
 * ข้อมูลเก่า). เดิมข้อกลางคืน (`JOURNAL_BALANCE_TOLERANCE`) และการตรวจก่อนปิดงวด (`dClose` ค่าเริ่มต้น 0.01) เผื่อ 0.01 — ตัวเลขดั้งเดิมจากก่อนสองทางนั้น
 * บังคับสมดุล ไม่ใช่กติกาบัญชี · **การเผื่อยอดเงิน** (เช่น เศษ ≤ 1 บาทของใบรับชำระ · ±0.01 ของยอดสองสมุดในรอบจ่าย) เป็นคนละเรื่อง ไม่ใช้ตัวนี้
 */
export function isJournalBalanced(
  totalDebit: Prisma.Decimal,
  totalCredit: Prisma.Decimal,
): boolean {
  return totalDebit.equals(totalCredit);
}

/** รูปคิวรีของ `isJournalBalanced` (ไม่สมดุล) — alias `jl` = `journal_lines` ของรายการที่ GROUP BY */
export const JOURNAL_UNBALANCED_SQL = Prisma.sql`SUM(jl.debit) <> SUM(jl.credit)`;
