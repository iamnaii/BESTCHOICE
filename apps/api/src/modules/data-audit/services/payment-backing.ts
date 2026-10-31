import { Prisma } from '@prisma/client';
import { LEGACY_PRIOR_RECEIPT_FLOW } from '../../accounting/peak-export-exclusion';

/**
 * ทางที่เงินของแถวงวดถูกลงบัญชี**โดยไม่มีรายการผูก `paymentId`** — ทาง (b) และ (c) ของ `orphan_payments`
 * (`DataAuditChecksService.orphanPaymentRows`) · ไฟล์เดียวของสองเงื่อนไขนี้: `backfill:receipts` (`cli/backfill-payment-receipts.cli.ts`) ใช้ชุด
 * เดียวกันตัดงวดที่เอกสารของเงินอยู่ที่อื่นแล้ว (Task 23 review m-1) และ `overpaid_contracts` ใช้ (c) ให้ส่วนเผื่อค่าปรับของ JP4
 * (Task 17 ข้อ B) — **ห้ามเขียนเงื่อนไขชุดที่สอง**
 *
 * (b) เป็นตัวกำหนดเซต (`SELECT … AS id`) สำหรับวางเป็น CTE แล้ว anti-join (`NOT EXISTS (SELECT 1 FROM <cte> b WHERE b.id = …)`) ·
 * (c) เป็นเงื่อนไขต่อแถว Payment (`EXISTS` แบบ correlated — Postgres ทำเป็น semi/anti-join) — คิวรีเดียวต่อรอบ ไม่สแกนสมุดบัญชีซ้ำต่อแถวงวด
 */

/** ปิดยอดก่อนกำหนด JP4 (รายการระดับสัญญา ไม่มี `paymentId`) — `contracts/contract-payment.service.ts:842-843` */
export const EARLY_PAYOFF_FLOW = 'early-payoff';

/**
 * (b) id ของแถวตารางงวด (`installment_schedules.id`) ที่มีรายการ `POSTED` เครดิต 11-2103 ผูก `metadata.installmentScheduleId` — รอบกลางคืน
 * หักเงินรับล่วงหน้า / เงินพักเข้างวด (`advance-consume-on-accrual` / `reschedule-park-consume` — tag `2B` ไม่มี `paymentId`) · 6a/6b ·
 * และรายการรับชำระเอง (stamp ทั้ง `paymentId` และ `installmentScheduleId` — นับต้นฉบับที่ `reversed` ด้วย ดูคอมเมนต์ใน `orphanPaymentRows`)
 * ⇒ anti-join กับ `s.id` (แถวตารางงวดของแถว Payment)
 *
 * ยกเว้น marker ยอดรับก่อนวันตัดของงวดนำเข้า (`legacy-prior-receipt`): มันหนุนเฉพาะส่วนก่อนวันตัด ซึ่งงวดที่ยังไม่ถูกแตะได้ยกเว้นอยู่แล้ว
 * (`LEGACY_UNTOUCHED_PAYMENT`) — เมื่อมีใบรับแตะงวดนั้น งวดต้องมีรายการของตัวเอง marker จึงต้องไม่ใช้เป็นข้ออ้าง
 */
export const SCHEDULE_ROWS_CLEARED_BY_ENTRY = Prisma.sql`
        SELECT DISTINCT je.metadata->>'installmentScheduleId' AS id
        FROM journal_entries je
        JOIN journal_lines jl ON jl.journal_entry_id = je.id AND jl.deleted_at IS NULL
        WHERE je.status = 'POSTED' AND je.deleted_at IS NULL
          AND je.metadata->>'installmentScheduleId' IS NOT NULL
          AND jl.account_code = '11-2103' AND jl.credit > 0
          AND COALESCE(je.metadata->>'flow', '') <> ${LEGACY_PRIOR_RECEIPT_FLOW}`;

/**
 * (c) แถว Payment (alias **`p`**) ที่รายการปิดยอดก่อนกำหนด JP4 ของสัญญา**เป็นผู้จ่าย** — รายการเดียวระดับสัญญาไม่มี `paymentId` (ใบ
 * `EARLY_PAYOFF` ก็ไม่ผูก `paymentId`) จึงตัดสินจากสองข้อ (Task 17 ข้อ B):
 * - `je.posted_at = p.paid_date` — `ContractPaymentService.earlyPayoff` เขียน `Payment.paidDate` และ `postedAt` ของ JP4 จากตัวแปร `paidDate`
 *   ตัวเดียว (คอลัมน์ทั้งสอง `timestamp(3)`)
 * - งวดอยู่ในช่วง `firstUnpaidInstallmentNo..lastUnpaidInstallmentNo` ที่ JP4 stamp (งวดที่ไม่ใช่ `PAID` ตอนปิดยอด เรียงจากน้อยไปมาก) — ใบรับชำระ
 *   ที่ลงวันเดียวกับวันปิดยอดได้เวลาเที่ยงคืน UTC เท่ากัน (หน้ารับชำระ / หน้าปิดยอดส่ง `YYYY-MM-DD`) วันที่อย่างเดียวจึงแยกไม่ได้ ·
 *   รายการ JP4 ที่ไม่มีช่วง (ก่อน 2026-10-18) ใช้วันที่อย่างเดียว
 *
 * ⇒ งวดที่**จ่ายก่อนปิดยอด**ไม่ได้หนุนด้วย JP4 (Task 25 · Task 23 re-review r-1 — เดิม (c) ตัดสินทั้งสัญญา: ทุกงวด PAID ของสัญญาที่มี JP4
 * ถือว่าหนุน รวมงวดที่จ่ายก่อนปิดยอดโดยไม่มีรายการเลย ⇒ `orphan_payments` และ `backfill:receipts` ข้ามเงียบ)
 */
export const PAID_BY_EARLY_PAYOFF = Prisma.sql`EXISTS (
               SELECT 1 FROM journal_entries je
               WHERE je.metadata->>'contractId' = p.contract_id
                 AND je.metadata->>'flow' = ${EARLY_PAYOFF_FLOW}
                 AND je.status = 'POSTED' AND je.deleted_at IS NULL
                 AND je.posted_at = p.paid_date
                 AND (
                   je.metadata->>'firstUnpaidInstallmentNo' IS NULL
                   OR p.installment_no BETWEEN (je.metadata->>'firstUnpaidInstallmentNo')::int
                                           AND (je.metadata->>'lastUnpaidInstallmentNo')::int
                 )
             )`;
