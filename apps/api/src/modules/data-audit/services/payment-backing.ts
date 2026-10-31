import { Prisma } from '@prisma/client';
import { LEGACY_PRIOR_RECEIPT_FLOW } from '../../accounting/peak-export-exclusion';

/**
 * ทางที่เงินของแถวงวดถูกลงบัญชี**โดยไม่มีรายการผูก `paymentId`** — ทาง (b) และ (c) ของ `orphan_payments`
 * (`DataAuditChecksService.orphanPaymentRows`) · ไฟล์เดียวของสองเงื่อนไขนี้: `backfill:receipts` (`cli/backfill-payment-receipts.cli.ts`) ใช้ชุด
 * เดียวกันตัดงวดที่เอกสารของเงินอยู่ที่อื่นแล้ว (Task 23 review m-1) — **ห้ามเขียนเงื่อนไขชุดที่สอง**
 *
 * ทั้งสองเป็นตัวกำหนดเซต (`SELECT … AS id`) สำหรับวางเป็น CTE แล้ว anti-join (`NOT EXISTS (SELECT 1 FROM <cte> b WHERE b.id = …)`) —
 * คิวรีเดียวต่อรอบ ไม่สแกนสมุดบัญชีซ้ำต่อแถวงวด
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
 * (c) id ของสัญญาที่มีรายการปิดยอดก่อนกำหนด JP4 — รายการเดียวระดับสัญญาครอบทุกแถวที่มันจ่าย (ใบ `EARLY_PAYOFF` ก็ไม่ผูก `paymentId`)
 * ⇒ anti-join กับ `p.contract_id`
 */
export const EARLY_PAYOFF_CONTRACTS = Prisma.sql`
        SELECT DISTINCT je.metadata->>'contractId' AS id FROM journal_entries je
        WHERE je.status = 'POSTED' AND je.deleted_at IS NULL
          AND je.metadata->>'flow' = ${EARLY_PAYOFF_FLOW}`;
