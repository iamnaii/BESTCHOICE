# แก้บัญชีตามผลตรวจ 2026-09-28 — PR4: ภาษีขายของเงินรับล่วงหน้า (ค่าปรับดิวพัก · เงินจ่ายเกิน · เงินเกินลิงก์ชำระ) ณ วันรับเงิน + เงินพักสะสมเกินเข้ารายได้ 42-1106 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**สถานะ:** ร่างฉบับที่ 3 (2026-10-11) — แก้ตามผลตรวจอิสระรอบ 1 (Critical 1 · Important 6 · Minor 5) และรอบ 2 (Important 3 · Minor 3 — รายละเอียดท้ายไฟล์) · **รอเจ้าของดูก่อนลงมือ** (คำตัดสิน O2: เขียนแผนให้เจ้าของดูก่อนลงมือแต่ละชุด)

**Goal:** เงินของลูกค้าที่บริษัทรับไว้ก่อนถึงกำหนดงวด — ค่าธรรมเนียมปรับดิวที่พักไว้หักงวดสุดท้าย (6a/6b) · เงินที่จ่ายเกินงวดแล้วพักไว้หักงวดถัดไป · เงินเกินจากลิงก์ชำระ PaySolutions · เงินเกินจากการกระจายเงินอัตโนมัติ (เครดิต 21-5101) — **รับรู้ภาษีขาย ณ วันรับเงิน** ตามคำตอบฝ่ายบัญชี เล่ม 1 ข้อ 1–3 (29/09/2569) และไม่รับรู้ซ้ำเมื่อเงินนั้นถูกหักเข้างวดหรือหักหนี้ตอนปิดสัญญา · เงินพักสะสมที่เหลือหลังสัญญาปิด (ผ่อนครบ / ปิดยอดก่อนกำหนด) รับรู้เป็นรายได้ **42-1106 เงินพักค่าปรับดิวสะสมเกิน** สุทธิจากภาษีที่รับรู้ไปแล้ว

**Architecture:** ไม่เปลี่ยนยอด 21-1103 / 21-5101 (แบบ X — คงยอดเต็ม) · **กติกาเดียว:** เงินเข้าถัง (`Cr 21-1103` / `Cr 21-5101`) = `Dr 21-2102 / Cr 21-2101` ภาษีของยอดนั้น · เงินออกจากถัง (`Dr 21-1103` / `Dr 21-5101` — หักเข้างวด · ปิดยอด · ยึดเครื่อง · ตัดหนี้สูญ · รับรู้เป็นรายได้) = `Dr 21-2101 / Cr 21-2102` ภาษีของยอดที่ออก โดยรายการที่ทำให้ถังของสัญญาเป็น 0 ใช้ "ภาษีที่รับรู้แล้วและยังค้าง" ทั้งก้อน · ขาภาษีเพิ่มใน**รายการเดิม**ผ่านตัวช่วยใหม่ตัวเดียว `journal/advance-vat.ts` · "ภาษีที่ยังค้าง" อ่านจากสมุดบัญชี (stamp บน metadata) ไม่เพิ่มคอลัมน์ · รายการ 2A **ไม่แก้** · JP4 / JP5 / ตัดหนี้สูญ **เพิ่มเฉพาะขากลับ** ก่อนขาล้าง 21-2102 เดิม · เงินพักส่วนเกินลงด้วย**รอบกวาดรายวัน** (ไม่ใช่ในธุรกรรมรับชำระ) · เอกสาร (ใบเสร็จ 6a เป็นใบกำกับภาษี · ใบรับเงินส่วนเกินลิงก์ชำระ) แยกเป็น **PR4ข** หลัง mockup

**Tech Stack:** NestJS 11 + Prisma 6 (PostgreSQL 16) · jest (unit) · vitest (integration ต่อฐานจริง) · React 18 (`apps/web` — แถวใหม่ 1 แถวบนหน้า `/finance/vat` + เวอร์ชัน)

**Spec:** `docs/superpowers/specs/2026-09-28-accounting-review-fixes-design.md` ข้อ 5.5 (D6 — PR4 · "จุดที่ต้องแก้: รายการรับปรับดิว · 2A งวดสุดท้าย · ขา VAT ของ JP4 · PDF 6a") · ด่าน Q7/Q8/Q9 ผ่านด้วยคำตอบเล่ม 1 ข้อ 1–3 (`output/BESTCHOICE-accounting-answers-vol1-2026-09-29.md`) · ฝ่ายบัญชียืนยันยอด 42-1106 = สุทธิจาก VAT (949.85 ในตัวอย่าง) 29/09 เย็น · กติกาปัจจุบัน `.claude/rules/accounting.md` หัวข้อ "ค่าปรับดิวพักงวดสุดท้าย" · "ใบกำกับภาษีตามบัญชี — ที่ยังเปิดอยู่" · "ตั้งลูกหนี้งวด ณ วันรับเงิน — ที่ยังเปิดอยู่ (VAT ของเงินที่จ่ายเกิน PR4)"

---

## ส่วนของเจ้าของและฝ่ายบัญชี (อ่านส่วนนี้ก่อน)

คำที่ใช้: "เงินรับล่วงหน้า" = เงินของลูกค้าในบัญชี 21-1103 สองถัง — **ถังพักค่าปรับดิว** (`rescheduleAdvanceBalance` หักได้เฉพาะงวดสุดท้าย) และ**ถังรวม** (`advanceBalance` หักงวดถัดไป) · "เครดิตของลูกค้า" = 21-5101 (`creditBalance` — เงินเกินจากการกระจายเงินอัตโนมัติ และเครดิตจากการเปลี่ยนเครื่องเสีย) · "ภาษีขาย" = 21-2101 (นำส่ง ภ.พ.30) · "ภาษีขายรอเรียกเก็บ" = 21-2102 (ตั้งไว้วันเปิดสัญญา ล้างทีละงวดเข้า 21-2101)

### สรุปภาษาง่าย

**วันนี้:** ลูกค้าจ่ายค่าปรับดิว 1,419 บาท (6a) ระบบลง `Dr เงินสด 1,419 / Cr 21-1103 1,419` **ไม่มีภาษีขาย** ทั้งที่เป็นเงินค่างวดที่รับไว้ก่อน · เงินจ่ายเกินงวด / เงินเกินลิงก์ชำระ / เครดิตจากกระจายเงินก็เหมือนกัน · ภาษีขายของเงินก้อนนั้นไปโผล่ตอนตั้งลูกหนี้งวด (2A) ซึ่งอาจเป็นอีกหลายเดือนถัดไป ⇒ ภ.พ.30 ของเดือนที่รับเงิน**ต่ำไป** · ใบเสร็จค่าปรับดิว 6a พิมพ์ไม่มีภาษี ขณะที่ใบรับชำระที่หักเงินก้อนนั้นเข้างวด (ตั้งแต่ PR3) หักภาษี 7/107 ของเงินที่ "ไม่เคยออกเอกสารภาษี" · สัญญาที่ผ่อนครบแล้วยังมีเงินพักเหลือ ระบบ**ไม่ลงบัญชี** แค่สร้างงานให้คนตัดสิน

**หลัง PR4:**
1. **ทุกครั้งที่เงินของลูกค้าเข้าพัก** (6a · เงินเกินงวด D1 · 6b ส่วนเกิน · ส่วนเกินลิงก์ชำระ · เครดิตจากกระจายเงิน) ลงภาษีขายทันทีในรายการเดียวกัน: `Dr 21-2102 / Cr 21-2101 = HALF_UP(ยอด × 7/107)` — ยอด 21-1103 / 21-5101 คงเต็มจำนวน (แบบ X) · ตัวอย่าง 1,419 → ภาษี **92.83**
2. **ทุกครั้งที่เงินนั้นออกจากถัง** — หักเข้างวด (รอบกลางคืน · ใบรับชำระ · ใช้เครดิตชำระ) **หรือหักหนี้ตอนปิดสัญญา** (ปิดยอดก่อนกำหนด · ยึดเครื่อง · ตัดหนี้สูญ) — ลงขากลับ `Dr 21-2101 / Cr 21-2102` เท่าภาษีของยอดที่ออก (รายการที่ทำให้ถังเป็น 0 ใช้ภาษีที่ยังค้างทั้งก้อน) · รายการตั้งลูกหนี้งวด (2A) ยังลงภาษีเต็มงวดเหมือนเดิม ⇒ ภาษีสุทธิของเดือนที่หัก = ภาษีของเงินสดที่รับจริงในเดือนนั้น · **ภาษีขายรวมทั้งสัญญาเท่าเดิมทุกบาท** (= VAT วันเปิดสัญญา) และ 21-2102 ของสัญญาเป็น 0 เมื่อปิด
3. **ปิดยอด / ยึดเครื่อง / ตัดหนี้สูญ:** ขาดทุน 51-1102 · หนี้สูญ · ส่วนลด 52-1106 · กำไร 41-1102 **ไม่เปลี่ยน** (ขาภาษีเป็นคู่ที่สมดุลกันเอง) — เปลี่ยนเฉพาะบรรทัดภาษี: มีขากลับเพิ่ม และขาล้าง 21-2102 เดิมอ่านยอดในบัญชีหลังขากลับ ⇒ ตัวอย่างข้อ 6 ของฝ่ายบัญชี หนี้สูญยัง **35,053.02** เท่าเดิม
4. **สัญญาที่ปิดแล้วแต่เงินพักเหลือ** (ปรับดิวหลายครั้งจนเกินงวดสุดท้าย · จ่ายเกินงวดสุดท้าย · ถังใหญ่กว่ายอดปิดก่อนกำหนด): **รอบกวาดรายวัน 00:40** ลง `Dr 21-1103 [เหลือ] / Cr 42-1106 [เหลือ − ภาษี] / Cr 21-2102 [ภาษีที่ยังค้าง]` + งานแจ้งฝ่ายบัญชี (เพื่อทราบ) · ครอบทุกทางที่สัญญาปิด (หน้ารับชำระ · กระจายเงิน · ใช้เครดิต · **ลิงก์ชำระ QR** · รอบกลางคืน · ปิดยอดก่อนกำหนด) · เปิดบัญชี **42-1106** กลับมาในชื่อใหม่ "เงินพักค่าปรับดิวสะสมเกิน" (รหัสเดิมเคยถูกลบ 03/08/2569 — ฝ่ายบัญชีเลือกรหัสนี้เอง) · หลังลงรายได้แล้ว **ยกเลิกใบเสร็จของสัญญานั้นไม่ได้** (ให้ฝ่ายบัญชีกลับรายการเอง)
5. **ใบเสร็จ / ใบกำกับภาษีไม่เปลี่ยนใน PR นี้** — ใบรับชำระที่หักเงินรับล่วงหน้าใช้ตัวเลขภาษีตัวเดียวกับบัญชี (ปิดช่อง ±0.01) · ใบเสร็จ 6a ยังพิมพ์ไม่มีภาษี **ชั่วคราว** จนกว่า PR4ข (ต้องมี mockup ใบเสร็จให้เจ้าของเคาะก่อน) ⇒ ระหว่างนั้นภาษีของเงิน 6a อยู่ในบัญชีแต่ยังไม่มีใบกำกับภาษี — ต้องออก PR4ข ให้ทันก่อนเริ่มใช้จริง

**ไม่เปลี่ยน:** ยอด 21-1103 / 21-5101 และคอลัมน์ถังทั้งสาม · สูตรค่าปรับดิว · สูตรยอดปิด · รายการ 2A · ขาที่ไม่ใช่ภาษีของ JP4 / JP5 / ตัดหนี้สูญ · ใบลดหนี้ ม.82/5 · ใบเสร็จทุกชนิด (PR4ข) · เครดิตจากการเปลี่ยนเครื่องเสีย (ไม่ใช่เงินที่รับ — ไม่มีภาษีตอนตั้งเครดิต · ตอนใช้เครดิตไม่มีขากลับ)

### คำตัดสินของแผนนี้ (ผู้คุมงานตรวจได้)

| # | เรื่อง | แผนนี้ทำ | เหตุผล / หลักฐาน |
|---|---|---|---|
| ต1 | รูปแบบ | **แบบ X** — ยอด 21-1103 เต็ม + ขาภาษีแยก 2 บรรทัดในรายการเดียวกัน | คำตอบเล่ม 1 ข้อ 1 · สเปค 5.5: แบบ Y ทำคอลัมน์กับ GL หลุดกัน ~12 จุด |
| ต2 | จุดที่ลงภาษีตอนพัก (`Dr 21-2102 / Cr 21-2101`) | (ก) `build-receipt-lines.ts` เมื่อ `advanceCredit > 0` (D1 เงินเกินงวด · 6b ส่วนเกิน) (ข) `reschedule-collect.service.ts` ขา 6a `Cr 21-1103` (ค) `paysolutions-webhook.service.ts` รายการ `paysolutions-surplus-advance` (ง) `payment-receipt-orchestrator.ts` รายการ `overpayment-credit` (`Cr 21-5101`) — ทั้งสี่ผ่านตัวช่วย `buildAdvanceVatParkLines` · preview (`payment-journal-preview.service.ts`) mirror | ข้อ 2 "ใช้กติกาเดียวกัน" กับเงินรับเกินทั่วไปและเงินเกินออนไลน์ · grep `Cr 21-1103` / `Cr 21-5101` ใน production มีสี่จุดนี้ (ผู้ตรวจอิสระยืนยัน) · `RescheduleJP6Template` ไม่มีผู้เรียก — ไม่แตะ · 6b sweep ย้ายเงินระหว่างถังไม่เปลี่ยนภาษี |
| ต3 | จุดที่ลงขากลับ (`Dr 21-2101 / Cr 21-2102`) | **ทุกจุดที่ `Dr 21-1103` / `Dr 21-5101`:** (ก) `build-receipt-lines.ts` เมื่อ `advanceConsume > 0` หรือ `debitAccountCode === '21-5101'` (ใช้เครดิตชำระ) (ข) รอบกลางคืน `installment-accrual-2a.template.ts` รายการ `advance-consume-on-accrual` / `reschedule-park-consume` (ค) **JP4** `buildEarlyPayoffJE` (บรรทัด `parkRelief` + `advanceRelief` + `creditRelief`) (ง) **JP5** และ **ตัดหนี้สูญ** (บรรทัด `Dr 21-1103` / `Dr 21-5101` ของ PR6) (จ) รายการรายได้ส่วนเกิน (ต6) — ลงในรายการเดิม ไม่สร้างรายการใหม่ | ขากลับต้องแยกบรรทัด ไม่ลดขาภาษีของ 2A: ถังรวมหักเข้างวดที่**ตั้งลูกหนี้ไปแล้ว**ได้ จึงไม่มี 2A ในธุรกรรมเดียวกันให้ลด · ภ.พ.30 อ่าน 21-2101 สุทธิอยู่แล้ว · **JP4/JP5/ตัดหนี้สูญต้องมีขากลับ** (ผลตรวจ I2): ถ้าปล่อยให้ "ปรับตัวเองผ่านยอด GL" อย่างเดียว เมื่อภาษีที่รับรู้ตอนพักมากกว่าภาษีรอเรียกเก็บที่เหลือ (ทุกงวดตั้งลูกหนี้แล้ว) ยอด 21-2102 ของสัญญาติดลบและทั้งสาม template ข้ามยอดติดลบ (`gt(0)` / `Decimal.max(0, …)`) ⇒ 21-2102 ค้างติดลบถาวร + ภาษีขายรวมเกิน (G8) |
| ต4 | ยอดภาษีของขากลับ | `max(0, min(HALF_UP(ยอดที่ออก × 7/107), ภาษีที่ยังค้างของสัญญา))` · **รายการที่ทำให้ 21-1103 + 21-5101 ของสัญญาเป็น 0 ใช้ "ภาษีที่ยังค้าง" ทั้งก้อน** (ใบสุดท้ายรับเศษ — กติกาเดียวกับ 2A บางส่วน) · JP5 / ตัดหนี้สูญ ล้างทั้ง 21-1103 และ 21-5101 ⇒ ขากลับ = ภาษีที่ยังค้างทั้งก้อน · JP4 = ตามยอดที่ปิดยอดหักให้ (ส่วนเกินค้างต่อให้รอบกวาด ต6) · รายได้ส่วนเกิน (ต6) ล้างเฉพาะ 21-1103 ⇒ `emptiesBucket = (GL 21-5101 ของสัญญา == 0)` — ถ้ายังมีเครดิต 21-5101 ค้าง (ถ3) ภาษีของเครดิตนั้นต้องคงค้างไว้ ไม่ถูกกลับพร้อมเงินพัก (ผลตรวจรอบ 2) | ปัดทีละรายการแล้วผลรวมต่าง ±0.01 (500 → 32.71 แต่หัก 250 + 250 → 32.72) — ถ้าไม่มีกติกาเศษ 21-2102 ค้าง ±0.01 ถาวร · เพดาน "ยังค้าง" ทำให้เครดิตที่ไม่เคยมีภาษีตอนตั้ง (เปลี่ยนเครื่องเสีย) ไม่มีขากลับ · `max(0, …)` กัน outstanding ติดลบจาก void (ผลตรวจ I6) |
| ต5 | "ภาษีที่รับรู้แล้วและยังค้าง" อ่านจากไหน | **สมุดบัญชี** — ทุกรายการที่มีขาภาษีของ PR4 stamp `metadata.advanceVatPark` / `metadata.advanceVatConsume` (สตริง 2 ตำแหน่ง) · `advanceVatOutstanding(client, contractId)` = `max(0, Σ park − Σ consume)` ของรายการ `POSTED` ไม่ถูกลบ ที่ `metadata.contractId` = สัญญา และ `metadata.reversed !== true` · กระจกทุกชนิด (void ใบเสร็จ · refund-reversal · exchange-cancel · defect-exchange · contract-cancellation) **ไม่ copy stamp** (ปักเทส) และประทับ `reversed` บนต้นฉบับ ⇒ ผลรวมถูกต้องหลังกลับรายการ · ไม่เพิ่มคอลัมน์บนสัญญา | หลัก "สมุดบัญชีเป็นแหล่งจริง" ของ PR5/PR6 · แยกถังไม่ได้และไม่จำเป็น — ทั้งสองถังอยู่บัญชีเดียวกัน กติกาเศษตัดสินที่ระดับสัญญา · `emptiesBucket` คำนวณจาก `glContractBalance(21-1103) + glContractBalance(21-5101)` ใน tx (ไม่ใช้คอลัมน์ — `applyCreditBalance` เขียน `creditBalance` ตอนท้าย) · รอบกลางคืนมี 2 รายการ (ถังรวม + ถังพัก) ใน tx เดียว ⇒ คำนวณยอดหักรวมก่อน แล้ว "ใบสุดท้าย" คือรายการที่สอง |
| ต6 | เงินพักสะสมเกิน (ข้อ 3) | **รอบกวาดรายวัน `advance-excess-income.cron.ts` 00:40 BKK** (หลังค่าเผื่อฯ 00:30): สัญญาที่ **มีแถว Payment ≥ 1 และไม่มีแถวค้าง** (ทุกแถว `PAID`) หรือสถานะ `COMPLETED` / `EARLY_PAYOFF` · **ไม่มีคำขอยกเลิกใบเสร็จ (`VOID_RECEIPT`) ค้างคิวอนุมัติ** (ข้ามไปวันถัดไป) · สถานะไม่อยู่ใน `TERMINATED` / `CLOSED_BAD_DEBT` / `CANCELED` / `DRAFT` / `EXCHANGED` / `DEFECT_EXCHANGED` · `glContractBalance(21-1103, cr) > 0` · ยังไม่มีรายการ `advance-excess-income` ที่มีผล → ลงใน `$transaction` ของตัวเอง: `Dr 21-1103 [ยอดในบัญชี] / Cr 42-1106 / Cr 21-2102 [advanceVatOutstanding]` + ตั้ง `advanceBalance` / `rescheduleAdvanceBalance` = 0 + งาน MEDIUM ถึงฝ่ายบัญชี (เพื่อทราบ · tag เดิม `reschedule-park` · ข้อความใหม่) + audit `ADVANCE_EXCESS_RECOGNIZED` (`tx.auditLog.create`) · `validatePeriodOpen` FINANCE วันนี้ · `flow: 'advance-excess-income'` + `idempotencyKey: advance-excess-income:<contractId>` + จับ P2002 · ไม่รวม 21-5101 (ถ3) · **ห้ามลงในธุรกรรมรับชำระ** · ส่ง `warnings` ของ `readContractCloseAdvances` (คอลัมน์ ≠ บัญชี · `close-advance-ledger-mismatch` flow `excess-income`) หลัง commit และ **สัญญาที่คอลัมน์ > 0 แต่บัญชี = 0 ยังได้งานแจ้งเพื่อตรวจ** (แทน alarm เดิมที่อ่านจากคอลัมน์) | ผลตรวจ C1: `checkContractCompletion` ถูกเรียก**ก่อน** `paymentReceiptTemplate.execute` ทั้ง 4 ทาง (`orchestrator:581` vs `:618` · `:1001` vs `:1041` · `:1340` vs `:1388` · `late-fee-waiver.service.ts:104`) ⇒ ลงที่นั่นจะอ่านยอด 21-1103 ก่อนใบรับชำระจะหัก → หักซ้ำ 21-1103 ติดลบ · ผลตรวจ I3: ลิงก์ชำระ QR flip COMPLETED เองใน tx (`paysolutions-webhook.service.ts:423-432`) ไม่ผ่าน `checkContractCompletion` · ผลตรวจ I4: บล็อก residual ของรอบกลางคืนตรวจเฉพาะถังพัก และไม่ flip COMPLETED ⇒ รอบกวาดอ่านยอดในบัญชีจึงครอบทุกทางด้วยโค้ดจุดเดียว · ล่าช้าไม่เกิน 1 วัน (ยอมรับได้ — เงินยังอยู่ในบัญชี 21-1103 ระหว่างนั้น) · `alarmResidualParkOnCompletion` เดิม**ถอด** (รอบกวาดสร้างงานแทน) |
| ต6ข | ยกเลิกใบเสร็จหลังลงรายได้ | `ReceiptVoidService.voidReceipt` ปฏิเสธเมื่อสัญญามีรายการ `advance-excess-income` ที่มีผล — วางหลังด่าน CREDIT_NOTE / RESCHEDULE_FEE / EARLY_PAYOFF และหลังอ่าน `contract` (`receipt-void.service.ts:289`) คู่กับ `UNPAY_BLOCKED_CONTRACT_STATUSES` ในธุรกรรมเดียวกัน (`journalEntry.findFirst` flow + contractId + POSTED แล้วกรอง `reversed` ใน JS แบบ :401-403) · **ด่านเดียวกันซ้ำที่จุดสร้างคำขอ** (`payment-approval-request.util.ts:49`) ไม่ให้คำขอเข้าคิวแล้วไปตกตอนอนุมัติ · ข้อความไทย: "สัญญานี้ลงรายได้เงินพักส่วนเกิน (42-1106) แล้ว — ต้องให้ฝ่ายบัญชีกลับรายการก่อน" | ผลตรวจ I4: สัญญาที่ครบงวดทางรอบกลางคืนไม่ถูก flip COMPLETED ⇒ `UNPAY_BLOCKED_CONTRACT_STATUSES` ไม่บล็อก void · void หลังลงรายได้ = คอลัมน์/GL 21-1103 ถูกคืนแต่เงินอยู่ใน 42-1106 และ idempotency กันรายการที่สอง → เงินค้างไม่มีทางออก · กติกาเดียวกับใบ 6a / ปิดยอดก่อนกำหนดที่ปฏิเสธ void อยู่แล้ว |
| ต7 | บัญชี 42-1106 | migration `UPDATE chart_of_accounts SET deleted_at = NULL, status = 'ใช้งาน', name = 'เงินพักค่าปรับดิวสะสมเกิน', notes = … WHERE code = '42-1106'` + `INSERT … ON CONFLICT DO NOTHING` (prod มีแถว soft-delete) + `finance-coa.csv` + พลิกเทส **3 ไฟล์**: `exchange-coa.spec.ts` (assert ว่า**มี**ชื่อใหม่ · 42-1107 ยังต้องไม่มี · `otherIncome` list เพิ่ม) · `journal/__tests__/input-vat-coa.spec.ts:22-24` · `prisma/seed-coa-finance.spec.ts:45-50` | precedent 42-1108 (ก้อน 5) เปิดด้วย migration · `seedFinanceCoa` update เฉพาะ name/type/notes ไม่แตะ `deletedAt`/`status` ⇒ ต้องเป็น migration (ผู้ตรวจอิสระยืนยัน) · ไม่มี `journal_lines` บนรหัสนี้ (SQL ลบตรวจไว้) |
| ต8 | JP4 / JP5 / ตัดหนี้สูญ | **แก้เฉพาะขาภาษี**: เพิ่มขากลับ (ต3 ค/ง · ยอดตาม ต4) **ก่อน**ขาล้าง 21-2102 เดิม และขาล้างคิดจาก `ยอด 21-2102 ในบัญชี + ภาษีที่ยังค้างทั้งก้อน (outstanding)` — **ไม่ใช่ + ขากลับ**: ถ้าปิดยอดหักถังไม่หมด (ถังใหญ่กว่ายอดปิด) ขากลับ r < outstanding p ⇒ 21-2102 หลัง JP4 = −(p − r) แล้วรอบกวาด ต6 ล้างเป็น 0 ด้วย `Cr 21-2102 (p − r)` · Σ Cr 21-2101 = VAT สัญญา + ภาษีของรายได้ 42-1106 (ถูกต้อง — รายได้ส่วนเกินมีภาษี) · ถ้าใช้ "+ ขากลับ" 21-2102 จะค้าง +(p − r) ถาวร (ผลตรวจรอบ 2 A) · JP4: `buildEarlyPayoffJE` รับ `advanceVatReversal` และ `advanceVatOutstanding` จาก `buildEarlyPayoffJournal` · JP5 / ตัดหนี้สูญ: template อ่าน `advanceVatOutstanding` เอง (ล้างถังหมด ⇒ r = p) · ขาอื่นทุกบรรทัดไม่แตะ | สเปค 5.5 ระบุ "ขา VAT ของ JP4" เป็นจุดที่ต้องแก้ของแบบ X · ขาล้างคู่ `Dr 21-2102 / Cr 21-2101` สมดุลกันเอง ⇒ plug (51-1102 / 52-1106 / 41-1102) **ไม่ขยับ** (ผลตรวจ I1 — ร่าง 1 เขียนผิดว่าขาดทุนสูงขึ้น) · G4 / G5 / G8 |
| ต9 | เอกสาร | **PR4ข** (แยก · หลัง mockup): ใบเสร็จ 6a → "ใบเสร็จรับเงิน / ใบกำกับภาษี" เก็บ 7 ช่องของ PR3 · ใบรับเงินส่วนเกินลิงก์ชำระ · ในระหว่างนั้น PR4 ส่งภาษีของขาหักเข้างวดเข้า `computeInstallmentReceiptTax` (`advanceVatConsumed`) ให้ใบรับชำระ = บัญชี | กติกาเจ้าของ 2026-09-06 mockup ก่อนแตะ UI/เอกสาร · ใบรับชำระ (PR3) ไม่เปลี่ยนรูป เปลี่ยนเฉพาะตัวเลขให้ตรงบัญชี |
| ต10 | ภ.พ.30 | ขากลับ (`Dr 21-2101`) จัดประเภทใหม่ `ADVANCE_APPLIED` ("เงินรับล่วงหน้าที่หักเข้างวด — รับรู้ภาษีแล้วตอนรับ") ใน `classifyOutputVatReduction` ด้วย stamp `advanceVatConsume` — ตรวจ**หลัง** REVERSAL/CREDIT_NOTE ก่อน OTHER (กระจกของขาพักจึงยังเป็น REVERSAL) · JSON เพิ่ม `reductionAdvanceApplied` · `tax-preview.service.ts` ส่ง `kind` ต่ออยู่แล้ว · Excel ไม่มีแถว reduction ไม่ต้องแก้ · หน้า `/finance/vat` (`VatPage.tsx` `OUTPUT_VAT_ROWS`) เพิ่มแถว (ข้อความ 1 บรรทัด — ถ5) | ไม่งั้นขากลับทุกใบไปโผล่ "อื่น ๆ" ซึ่งเป็นช่องสัญญาณผิดปกติ (ผู้ตรวจอิสระยืนยันตำแหน่งโค้ด) |
| ต11 | ของเก่า | forward-only — เงินพัก/เครดิตที่ค้างก่อน deploy ไม่มี stamp ⇒ `advanceVatOutstanding` = 0 ⇒ ออกจากถังโดยไม่มีขากลับ (ภาษีลงที่ 2A เหมือนเดิม) · ไม่มี backfill · **ข้อจำกัดที่รู้:** ลิงก์ชำระ QR ที่ปิดสัญญาเองเป็น `EARLY_PAYOFF` ตั้ง `creditBalance: 0` โดยไม่มีรายการและ**ไม่ผ่าน JP4** (X2 — มีอยู่ก่อน · `paysolutions-webhook.service.ts:423-432`) ⇒ ยอด 21-5101 ในบัญชีและ stamp park ของมันค้างถาวร (รอบกวาด ต6 ไม่กวาด 21-5101 — ถ3) · ทาง JP4/JP5/ตัดหนี้สูญปกติล้าง 21-5101 ตามบัญชี (PR6) จึงไม่ค้าง | prod ไม่มีสัญญาที่ผ่อนอยู่ (ตรวจ 11/10/2569) |

### คำถามถึงเจ้าของ/ฝ่ายบัญชี (ไม่เป็นด่าน — แผนทำตามคอลัมน์ "แผนทำ" · ถ้าคำตอบต่างให้แก้ตามคอลัมน์สุดท้ายก่อน merge)

| # | ถึง | คำถาม | แผนทำ | ถ้าคำตอบต่าง |
|---|---|---|---|---|
| ถ1 | ฝ่ายบัญชี (แจ้งเพื่อทราบ) | ตอนยึดเครื่อง / ตัดหนี้สูญ / ปิดยอดก่อนกำหนด ภาษีที่รับรู้ตอนรับเงินพัก**ถูกกลับ** (`Dr 21-2101 / Cr 21-2102`) ในรายการปิดสัญญา แล้วภาษีรอเรียกเก็บที่เหลือ (รวมส่วนที่กลับมา) ถูกล้างเข้า 21-2101 ตามเดิม ⇒ ภาษีขายรวมทั้งสัญญา = VAT วันเปิดสัญญา · ขาดทุน/หนี้สูญ/ส่วนลด**ไม่เปลี่ยน** (G5: หนี้สูญ 35,053.02 เท่าเดิม) · ใบลดหนี้ ม.82/5 ยังคิดจากยอดค้างของงวดที่ตั้งลูกหนี้แล้ว**ไม่ลดตามเงินพักที่หัก** (ข้อจำกัดที่รู้จาก PR6 — ภาษีในใบลดหนี้ของส่วนที่เงินพักจ่ายไปแล้วถูกคืนด้วย) | ตามนี้ (ต3/ต8) | ให้ใบลดหนี้ลดตามเงินที่หัก → งานแยก แก้ `computeCnBreakdown` (กระทบ JP5 / ตัดหนี้สูญ / ใบลดหนี้ที่ออก) |
| ถ2 | ฝ่ายบัญชี | ใบรับชำระที่**หักเงินรับล่วงหน้า**พิมพ์แถว "หักเงินรับล่วงหน้า" ติดลบพร้อมภาษีติดลบ (PR3) — หลัง PR4 ตัวเลขภาษีแถวนั้น = ขากลับในบัญชี (อาจต่างจาก 7/107 ของยอดที่หัก 1 สตางค์ในใบสุดท้าย เช่น 16.35 แทน 16.36) ยอมรับไหม | ตามนี้ (ต4/ต9) | ให้ใบพิมพ์ 7/107 ตรง ๆ → ไม่ส่ง `advanceVatConsumed` เข้า breakdown (ต่าง ±0.01 ระหว่างใบกับบัญชี — บันทึกใน accounting.md) |
| ถ3 | ฝ่ายบัญชี | **เครดิต 21-5101 ที่เหลือ**หลังสัญญาปิด (เงินเกินจากกระจายเงินที่ไม่ถูกใช้) — ลงรายได้ 42-1106 เหมือนเงินพัก หรือคืนลูกค้า | ไม่แตะ — ค้างใน 21-5101 + งานแจ้ง (เหมือนวันนี้) | รายได้ → รอบกวาด ต6 รวม 21-5101 ด้วย (`readContractCloseAdvances().credit`) |
| ถ4 | ฝ่ายบัญชี | **ปิดยอดก่อนกำหนด (JP4)** ที่ถังใหญ่กว่ายอดปิด (ส่วนเกินค้างในบัญชีตามคำตอบ 5.4): รอบกวาด ต6 จะลงส่วนเกินนั้นเป็นรายได้ 42-1106 **วันถัดไป** (สัญญา `EARLY_PAYOFF` + 21-1103 > 0) ถูกต้องไหม | ตามนี้ (ต6 รวม `EARLY_PAYOFF`) | ไม่ → ตัด `EARLY_PAYOFF` ออกจากรอบกวาด (ส่วนเกินค้าง + งานแจ้งเหมือน PR5) |
| ถ5 | เจ้าของ | ข้อความแถวใหม่หน้า `/finance/vat` กล่อง "ที่มาของเดบิต 21-2101": **"เงินรับล่วงหน้าที่หักเข้างวด (รับรู้ภาษีแล้วตอนรับ)"** | ตามนี้ (ต10) | เจ้าของระบุถ้อยคำ |
| ถ6 | เจ้าของ | PR4ข (ใบเสร็จ 6a เป็นใบกำกับภาษี + ใบรับเงินส่วนเกินลิงก์ชำระ) — ให้ทำ mockup ใบเสร็จต่อเลยหลัง PR4 ไหม | รอสั่ง | — |
| ถ8 | ฝ่ายบัญชี | รอบกวาด ต6 ลงรายได้ 42-1106 ให้**ถังรวม**ที่เหลือหลังสัญญาปิดด้วย (จ่ายเกินงวดสุดท้าย D1 · เงินเกินลิงก์ชำระ) — คำตอบข้อ 3 พูดถึง "เงินพักค่าปรับดิว" เท่านั้น ส่วนข้อ 2 ตอบเฉพาะภาษี · ให้ถังรวมใช้กติกาเดียวกันไหม (บัญชีเดียวกัน 21-1103 แยกไม่ได้ในสมุด) | ตามนี้ (กวาดทั้ง 21-1103) | แยกเฉพาะถังพัก → รอบกวาดใช้ `min(ยอดบัญชี, rescheduleAdvanceBalance)` และถังรวมที่เหลือค้าง + งานแจ้ง |
| ถ7 | เจ้าของ | เงินพักส่วนเกินลงรายได้ด้วย**รอบกวาดรายวัน** (ล่าช้าไม่เกิน 1 วันจากวันที่สัญญาปิด) และหลังจากนั้นยกเลิกใบเสร็จของสัญญานั้นไม่ได้ — รับได้ไหม | ตามนี้ (ต6/ต6ข) | ต้องลงวันเดียวกัน → ย้ายไปหลัง `paymentReceiptTemplate.execute` ของผู้เรียก 5 จุด (orchestrator 3 · late-fee-waiver · webhook) — โค้ดเพิ่มและเสี่ยงลำดับผิดกว่า |

**แจ้งเพื่อทราบ (ไม่ต้องตอบ):**
- คู่มือ CPA กรณีที่ 6 (`case-6a-reschedule-split.csv` / `case-6b-reschedule-bundled.csv`) เขียนแบบไม่มีภาษี — คำตัดสิน D6 เปลี่ยนคู่มือกรณีที่ 6 (สเปค 5.5) · แผนนี้เพิ่มบรรทัดในหมายเหตุของ CSV ไม่แก้ตารางเดิม
- ภ.พ.30 ของเดือนที่รับเงินพักจะสูงขึ้นเท่าภาษีนั้น และเดือนที่หัก/ปิดสัญญาจะต่ำลงเท่ากัน — ยอดรวมทั้งสัญญาเท่าเดิม
- ใบเสร็จ 6b (รวมกับค่างวด) พิมพ์ภาษีของส่วนที่พักอยู่แล้วตั้งแต่ PR3 (แถว "เงินรับล่วงหน้างวดที่ N — ปรับดิว") ⇒ หลัง PR4 เอกสารกับบัญชีของ 6b ตรงกัน · เฉพาะ 6a (ใบแยก) ที่ยังต่างจนกว่า PR4ข
- งาน "สัญญาปิดครบงวดแต่ยังมีเงินพักเหลือ" เปลี่ยนจาก "รอ CPA ตัดสิน" เป็น "ลงรายได้ให้แล้ว เลขที่รายการ …" (เพื่อทราบ)

### ข้อความบนจอที่เปลี่ยน

- หน้า `/finance/vat` กล่องที่มาของเดบิต 21-2101: เพิ่มแถว "เงินรับล่วงหน้าที่หักเข้างวด (รับรู้ภาษีแล้วตอนรับ)" (ถ5)
- การ์ด "รายการบัญชี" ในหน้ารับชำระ / หน้าปรับดิว / หน้าปิดยอด / หน้ายึดคืน: บรรทัด 21-2102 / 21-2101 เพิ่ม — **ชื่อบัญชีจากผังบัญชี + คำอธิบาย** "ภาษีขายของเงินรับล่วงหน้า (รับรู้ ณ วันรับ)" / "ภาษีขายของเงินรับล่วงหน้าที่หักเข้างวด (รับรู้แล้วตอนรับ)" — คำอธิบายเดียวกับที่ลงจริง (preview === posted)
- งาน (`/todos`) ข้อความใหม่ (ข้างบน)
- ข้อความ error ใหม่ 1 ข้อความตอนยกเลิกใบเสร็จ (ต6ข)
- ไม่มีการเปลี่ยนใบเสร็จ / PDF / LINE (PR4ข)

### ตัวเลขตัวอย่าง (golden)

HALF_UP = ปัดครึ่งขึ้นที่ 2 ตำแหน่ง · สัญญาตัวอย่าง 17,000/12 งวดละ 1,515.83 (= 1,416.66 + VAT 99.17 · งวดสุดท้ายรับเศษ 99.13) VAT ทั้งสัญญา 1,190.00

**G1 — รับค่าปรับดิว 6a 1,419.00 (ตัวอย่างสเปค 5.5):**
```
Dr 11-1201 ธนาคาร                    1,419.00
   Cr 21-1103 เงินรับล่วงหน้า (6a)              1,419.00
Dr 21-2102 ภาษีขายรอเรียกเก็บ            92.83     ← ใหม่ (metadata.advanceVatPark = "92.83")
   Cr 21-2101 ภาษีขาย                            92.83     ← ใหม่
```
**G2 — รอบกลางคืนงวดสุดท้าย หักเงินพัก 1,419.00 เข้างวด 12** (2A ของงวด 12 ลงเต็มงวดตามเดิม: `Dr 21-2102 99.13 / Cr 21-2101 99.13`):
```
Dr 21-1103                           1,419.00
   Cr 11-2103                                    1,419.00
Dr 21-2101                              92.83     ← ใหม่ (= ภาษีที่ยังค้างทั้งก้อน — รายการที่ทำให้ 21-1103 เป็น 0)
   Cr 21-2102                                    92.83     ← ใหม่ (metadata.advanceVatConsume = "92.83")
```
ผล: 21-2102 ของสัญญา = 0 หลังงวด 12 · Σ Cr 21-2101 ทั้งสัญญา = 1,190.00 · ภ.พ.30 เดือนรับเงิน +92.83 เดือนงวด 12 สุทธิ 99.13 − 92.83 = 6.30 (ภาษีที่ถึงกำหนดของงวดสุทธิจากที่รับรู้ไปแล้ว — ไม่ใช่ 7/107 ของเงินสด 96.87 ซึ่งได้ 6.34)

**G3 — จ่ายเกินงวด 500.00 (D1 → ถังรวม) แล้วรอบกลางคืนหักเข้างวดถัดไป:** พัก `Dr 21-2102 32.71 / Cr 21-2101 32.71` · หัก 500 (ถังรวมหมด) → ขากลับ **32.71** (ยังค้างทั้งก้อน) · ถ้าหัก 250 + 250 → 16.36 + **16.35** (ใบสุดท้ายรับเศษ · ไม่ใช่ 16.36)

**G4 — ปิดยอดก่อนกำหนด มีเงินพัก 1,044.00 ลูกค้าจ่าย 14,318.16 (ตัวอย่าง PR5):** พักไว้ตอน 6a `Dr 21-2102 68.30 / Cr 21-2101 68.30` ⇒ ยอด 21-2102 ในบัญชีตอนปิด = 1,121.70 · JP4 หลัง PR4:
```
Dr 11-1201 เงินสด                   14,318.16
Dr 21-1103 เงินพักปรับดิว             1,044.00
Dr 21-2101                              68.30     ← ขากลับ (ภาษีที่ยังค้าง — ถังหมด)
Dr 11-2106                           6,000.00
Dr 21-2102                           1,190.00     ← ขาล้างเดิม = 1,121.70 (ยอดในบัญชี) + 68.30 (ขากลับ)
Dr 52-1106                           2,827.84     ← ไม่เปลี่ยน
   Cr 11-2101 17,000.00 · Cr 11-2105 1,190.00 · Cr 41-1101 6,000.00 · Cr 21-2102 68.30 · Cr 21-2101 1,190.00
```
Σ Dr = Σ Cr = 25,448.30 · Σ Cr 21-2101 ทั้งสัญญา = 68.30 (พัก) − 68.30 (กลับ) + 1,190.00 = 1,190.00 · 21-2102 = 0 · 52-1106 เท่าเดิม

**G5 — ตัดหนี้สูญตัวอย่างข้อ 6 ของฝ่ายบัญชี (ลูกหนี้ 36,472.02 · เงินพัก 1,419.00):** เพิ่ม `Dr 21-2101 92.83 / Cr 21-2102 92.83` · ขาล้าง `Dr 21-2102 / Cr 21-2101` = ยอดในบัญชี + 92.83 (= ภาษีรอเรียกเก็บที่เหลือจริง) · **หนี้สูญ 51-1102 = 35,053.02 เท่าเดิม** (คู่ภาษีสมดุลกันเอง ไม่แตะ plug)

**G6 — ปรับดิว 2 ครั้ง (1,419.00 × 2 = 2,838.00 · ภาษีรับรู้ 92.83 × 2 = 185.66) งวดสุดท้าย 1,515.87:** รอบกลางคืนหัก 1,515.87 → ขากลับ HALF_UP = **99.17** (21-1103 ยังเหลือ จึงไม่ใช่รายการสุดท้าย) · ยังค้าง 185.66 − 99.17 = 86.49 · วันถัดไปรอบกวาด (ทุกงวด PAID · 21-1103 = 1,322.13):
```
Dr 21-1103                           1,322.13
   Cr 42-1106 เงินพักค่าปรับดิวสะสมเกิน        1,235.64
   Cr 21-2102                                     86.49     ← ภาษีที่ยังค้าง (ไม่ใช่ HALF_UP 86.50)
```
21-2102 ของสัญญา = 0 · ตรงหลัก 949.85 ของฝ่ายบัญชี (สุทธิจากภาษีที่รับรู้แล้ว)

**G7 — ใช้เครดิตจากการเปลี่ยนเครื่องเสีย 2,000 ชำระงวด:** ไม่มี stamp park ⇒ `advanceVatOutstanding` = 0 ⇒ ไม่มีขากลับ (2A รับรู้เต็ม) — เหมือนวันนี้ · ใบกำกับ `CREDIT_BALANCE` ยังพิมพ์ VAT ซ้ำกับใบของสัญญาเดิม (ถ8 ของ PR3 — ไม่แก้ใน PR4)

**G8 — ทุกงวดตั้งลูกหนี้แล้ว (21-2102 = 0) + เงินพัก 6a 1,419.00 ค้าง → ตัดหนี้สูญ (ผลตรวจ I2):** ยอด 21-2102 ในบัญชี = **−92.83** · ขากลับ `Dr 21-2101 92.83 / Cr 21-2102 92.83` → 21-2102 = 0 → ไม่มีขาล้าง (ภาษีรอเรียกเก็บที่เหลือ 0) · Σ Cr 21-2101 = 1,190.00 + 92.83 − 92.83 = 1,190.00 ✓ (**ก่อนใบลดหนี้ ม.82/5** — ใบลดหนี้คิดจากยอดค้างของงวดที่ตั้งลูกหนี้แล้วโดยไม่ลดตามเงินพักที่หัก (ข้อจำกัด PR6 · ถ1) ⇒ ภาษีสุทธิของเงิน 1,419 ที่รับจริงเป็น 0 หลังตัดหนี้สูญ) · **ถ้าไม่มีขากลับ** (ร่าง 1): 21-2102 ค้าง −92.83 ถาวร และภาษีขายรวมเกิน 92.83

**G9 — ปิดยอดก่อนกำหนด ถังพัก 2,000.00 (ภาษีรับรู้ 130.84) แต่ยอดปิดหักได้ 1,500.00:** JP4: `Dr 21-1103 1,500.00` · ขากลับ `Dr 21-2101 / Cr 21-2102` = HALF_UP(1,500 × 7/107) = **98.13** · ขาล้าง `Dr 21-2102 / Cr 21-2101` = ยอดในบัญชี + 130.84 (outstanding ทั้งก้อน) ⇒ 21-2102 หลัง JP4 = −32.71 · เงินพักเหลือ 500.00 (ภาษีค้าง 32.71) · วันถัดไปรอบกวาด (สถานะ `EARLY_PAYOFF` — ถ4): `Dr 21-1103 500.00 / Cr 42-1106 467.29 / Cr 21-2102 32.71` ⇒ 21-2102 = 0 · Σ Cr 21-2101 = VAT สัญญา + 32.71 (ภาษีของรายได้ส่วนเกิน)

**ต้องรู้ก่อน deploy:**
- migration 1 ไฟล์ (42-1106 undelete/rename + ON CONFLICT) · ไม่มีคอลัมน์ใหม่ · cron ใหม่ 1 ตัว (00:40 BKK)
- หลัง deploy ภาษีของเงิน 6a อยู่ในบัญชีแต่ใบเสร็จ 6a ยังไม่มีภาษีจน PR4ข — ไม่ควรเริ่มใช้จริงกับลูกค้าก่อน PR4ข
- forward-only: เงินพัก/เครดิตที่ค้างก่อน deploy ไม่มีภาษีตอนพัก และออกจากถังโดยไม่มีขากลับ (ภาษีลงที่ 2A ตามเดิม) · ห้าม rollback ต่ำกว่าเวอร์ชันนี้หลังมีรายการที่ stamp `advanceVat*` (โค้ดเก่าไม่รู้จัก stamp — หักเข้างวดแล้วภาษีจะซ้ำ)
- เวอร์ชันเว็บ: bump ตามกติกา (ล่าสุด 26.10.19 ใน PR #1689)

---

## หมายเหตุทางเทคนิค (สำหรับผู้คุมงานและผู้ลงมือ)

### 1. ตัวช่วยใหม่ `apps/api/src/modules/journal/advance-vat.ts`
- `advanceVatOf(amount)` — ย้ายจาก `receipt-tax-breakdown.ts` แล้ว re-export (HALF_UP × 7/107 เครื่องหมายตามยอด) — ห้ามมีสูตรที่สอง
- `ADVANCE_VAT_META = { park: 'advanceVatPark', consume: 'advanceVatConsume' } as const`
- `buildAdvanceVatParkLines(vat)` → `[{21-2102 dr}, {21-2101 cr}]` คำอธิบาย "ภาษีขายของเงินรับล่วงหน้า (รับรู้ ณ วันรับ)" · `buildAdvanceVatConsumeLines(vat)` → `[{21-2101 dr}, {21-2102 cr}]` คำอธิบาย "ภาษีขายของเงินรับล่วงหน้าที่หักเข้างวด (รับรู้แล้วตอนรับ)" · ยอด 0 = ไม่มีบรรทัด
- `advanceVatOutstanding(client, contractId)` — `journalEntry.findMany({ status: 'POSTED', deletedAt: null, metadata.contractId = id })` รวม stamp ข้ามแถว `metadata.reversed === true` · `Decimal.max(0, …)` · อ่านบน tx เดียวกับรายการที่กำลังลง
- `resolveConsumeVat(client, contractId, releaseAmount, emptiesBucket)` → `emptiesBucket ? outstanding : max(0, min(advanceVatOf(release), outstanding))` · `emptiesBucket` = `glContractBalance(21-1103, cr) + glContractBalance(21-5101, cr)` ก่อนหัก − ยอดที่หักทั้งหมดในธุรกรรมนี้ ≤ 0.00

### 2. จุดพัก (ต2) — ขาภาษีอยู่ในรายการเดิม
- `build-receipt-lines.ts`: หลัง `Cr 21-1103 advanceCredit` push park lines · `PaymentReceiptTemplate` stamp · preview (`payment-journal-preview.service.ts` ใช้ `buildReceiptLines` อยู่แล้ว :511) mirror · 6a preview ใน `payment-journal-preview.service.ts:236-270` push เหมือน posted
- `reschedule-collect.service.ts` 6a · `paysolutions-webhook.service.ts` surplus · `payment-receipt-orchestrator.ts` `overpayment-credit` — push + stamp (ทั้งสามมี `metadata.contractId` แล้ว)

### 3. จุดหัก (ต3/ต4) + เอกสาร = บัญชี (ต9)
- `PaymentReceiptTemplate.executeInTx`: อ่านยอด 21-1103 + 21-5101 ในบัญชี → `resolveConsumeVat(advanceConsume + (debitAccountCode === '21-5101' ? delta : 0))` → ส่งเข้า `buildReceiptLines({ advanceVatConsume })` + `computeInstallmentReceiptTax({ advanceVatConsumed })` + stamp
- `installment-accrual-2a.template.ts` บล็อก generic (:492) + park (:648): **ย้ายการคำนวณ `parkConsume` (:633-646) มาก่อน post รายการ generic** (ทำได้ — `ledgerCap()` cache ไว้แล้ว :469-479 และ parkCap ใช้ `genericConsumed` เป็นตัวเลข ไม่อ่าน GL หลัง post) → รู้ยอดหักทั้งสองก่อน → ขากลับของแต่ละรายการ 2B · รายการสุดท้ายที่เกิดจริง (park ถ้า parkCap > 0 ไม่งั้น generic) ใช้ `emptiesBucket` จากยอดรวม · stamp
- JP4 `compute-early-payoff-je.ts`: `buildEarlyPayoffJournal` อ่าน `advanceVatOutstanding` (p) และคำนวณ `advanceVatReversal = resolveConsumeVat(parkRelief + advanceRelief + creditRelief, emptiesBucket)` (r) → `buildEarlyPayoffJE` รับทั้ง r และ p · `ledger.deferredVat` ปรับเป็น `ledger.deferredVat + p` (**ไม่ใช่ + r**) ก่อน `Decimal.max(0, …)` · บรรทัดขากลับ r วางก่อน `debit('21-2102', …)` · ลำดับอ่าน GL เดิม (`readEarlyPayoffLedger` → advances → สร้างบรรทัด) ใช้ได้เพราะเป็นเลขคณิตล้วน · `EarlyPayoffJP4Template` (ไม่มีผู้เรียก production) รับค่าเดียวกัน
- JP5 `repossession-jp5.template.ts` / ตัดหนี้สูญ `bad-debt-writeoff.template.ts`: หลังบรรทัด `Dr 21-1103` / `Dr 21-5101` ของ PR6 → `advanceVatOutstanding` ทั้งก้อนเป็นขากลับ (r = p) · `bal21_2102` ที่ใช้ขาล้าง = GL + p (เทียบ `gt(0)` หลังปรับ) · ทั้งสอง template อ่าน `bal21_2102` (:253 / :129) และ `readContractCloseAdvances` ก่อน push ทุกบรรทัดอยู่แล้ว · metadata `advanceVatReversal` + stamp consume
- `receipt-void.service.ts`: ด่านใหม่ ต6ข · ไม่แก้การคืนคอลัมน์ · เทส: void ใบที่มีขาพัก → `advanceVatOutstanding` ลดลงเท่าภาษีของใบนั้น (clamp 0)

### 4. รอบกวาดเงินพักส่วนเกิน (ต6) — `journal/cron/advance-excess-income.cron.ts` + `cpa-templates/advance-excess-income.template.ts`
- เลือกสัญญา: SQL เดียว**นอก tx** — สัญญาที่ไม่มี `Payment` `status != PAID` (`deletedAt null`) และมี Payment ≥ 1, หรือสถานะ `COMPLETED`/`EARLY_PAYOFF`; ตัดสถานะที่ยกเว้น; ไม่มี `PaymentApprovalRequest` ประเภท `VOID_RECEIPT` ค้าง (`payment-approval-request.util.ts:49`) ; แล้วใน tx ต่อสัญญากรองด้วย `glContractBalance(21-1103, cr) > 0` และไม่มีรายการ `flow = 'advance-excess-income'` POSTED ที่ `reversed !== true` · สัญญาที่คอลัมน์ถัง > 0 แต่บัญชี = 0 → ไม่ลงรายการ แต่สร้างงานแจ้ง "คอลัมน์ไม่ตรงบัญชี" (dedup) + Sentry warning · scan `metadata.contractId` ไม่มี index ⇒ tx ต่อสัญญาให้สั้น (อ่าน → ลง → commit)
- ต่อสัญญา `$transaction` Serializable: อ่าน `readContractCloseAdvances(…, 'excess-income')` (เพิ่ม flow ให้ตัวช่วย · ใช้ `.advance` · `.warnings` ส่งหลัง commit) + `advanceVatOutstanding` + `glContractBalance(21-5101)` (เพื่อ `emptiesBucket` — ต4) → `resolveConsumeVat(ยอด 21-1103, emptiesBucket)` → ลง JE (`createAndPost`) → คอลัมน์ถังทั้งสอง = 0 → audit → งาน (dedup ด้วย tag + เลขสัญญา เหมือน `alarmResidualParkOnCompletion`) · P2002 (idempotency) = ข้าม · P2034 = retry รอบถัดไป · Sentry ต่อสัญญาที่ล้ม ไม่หยุด loop
- ถอด `alarmResidualParkOnCompletion` ออกจาก `checkContractCompletion` และ cron accrual (รอบกวาดสร้างงานแทน) — คง export ไว้ถ้าเทสอ้าง หรือลบพร้อมเทส
- Serializable กับ writer อื่น: รอบกวาดอ่าน `journal_entries` ของสัญญาที่ปิดแล้ว (ไม่มีใบรับชำระใหม่โดยนิยาม — ยกเว้น void ซึ่ง ต6ข บล็อกหลังลงรายการ; ก่อนลงรายการ void ทำให้ Payment กลับเป็นค้าง ⇒ สัญญาหลุดเงื่อนไขเอง)

### 5. ภ.พ.30 (ต10)
- `Pp30ReductionKind` เพิ่ม `'ADVANCE_APPLIED'` — `classifyOutputVatReduction` ตรวจ `meta[ADVANCE_VAT_META.consume]` หลัง REVERSAL/CREDIT_NOTE ก่อน `OTHER` · `reductions.advanceApplied` · JSON `reductionAdvanceApplied` · `VatPage.tsx` แถวใหม่ + `VatPage.test.tsx`
- `pp30-output-vat.integration.spec.ts` เพิ่มเคส: รับ 6a เดือน 1 / หักเข้างวดสุดท้ายเดือน 2 → เดือน 1 ภาษีขาย 92.83 · เดือน 2 สุทธิ 99.13 − 92.83 = 6.30 และ `reductionAdvanceApplied = 92.83`

### 6. ข้อเท็จจริงของโค้ดที่แผนพึ่ง (ตรวจ 2026-10-11 บน `origin/main` 984b7a709 · ผู้ตรวจอิสระยืนยัน)
- `Cr 21-1103` ใน production: `build-receipt-lines.ts:85` · `reschedule-collect.service.ts:273` · `paysolutions-webhook.service.ts:600` · (preview) `payment-journal-preview.service.ts:254` · `reschedule-jp6.template.ts` ไม่มีผู้เรียก
- `Dr 21-1103`: `build-receipt-lines.ts:54` · `installment-accrual-2a.template.ts:510/665` · JP4 `compute-early-payoff-je.ts:223-225` · JP5 `repossession-jp5.template.ts:362/374` · ตัดหนี้สูญ `bad-debt-writeoff.template.ts:255`
- `Cr 21-5101`: `payment-receipt-orchestrator.ts:1162` (`overpayment-credit`) · `Dr 21-5101`: `PaymentReceiptTemplate` ผ่าน `debitAccountCode` (`orchestrator:1392`) · JP4 `:227` · JP5 `:378` · ตัดหนี้สูญ `:258` · เครดิตจากเปลี่ยนเครื่องเสีย (`defect-exchange.service.ts:348`) ตั้งคอลัมน์โดยไม่มีรายการ → ไม่มี stamp → ขากลับ 0 (G7)
- `checkContractCompletion` ถูกเรียกก่อน `paymentReceiptTemplate.execute` ทั้ง 4 ทาง (ต6) · ลิงก์ชำระ QR flip COMPLETED/EARLY_PAYOFF เอง (`paysolutions-webhook.service.ts:423-432`) และตั้ง `creditBalance: 0` โดยไม่มีรายการ (X2)
- JP4/JP5/ตัดหนี้สูญ ข้ามยอด 21-2102 ติดลบ (`compute-early-payoff-je.ts:185` · `repossession-jp5.template.ts:286` · `bad-debt-writeoff.template.ts:199`) ⇒ ต้องมีขากลับ (ต3/ต8)
- ภ.พ.30 อ่าน 21-2101 สุทธิ (`computePp30OutputVat`) ⇒ ขากลับลดยอดเดือนที่หัก — ถูกต้องตามกติกาภาษี (ภาษีของเงินที่รับไว้ก่อนถึงจุดภาษีตอนรับ)
- `RefundsService.assertCashOnlyRefund` (:471-497) ปฏิเสธคืนเงินที่มี 21-1103/21-5101 · `receipt-void` ปฏิเสธใบ 6a (:260) · `contract-exchange.service.ts:891-927` บล็อกเมื่อ 21-1103 > 0 ⇒ stamp ไม่ข้ามสัญญา · `defect-exchange-reversal.template.ts` กวาด `payment-receipt`/`reschedule-collect` ของสัญญาเดิมภายใน 7 วัน → กระจกบรรทัดภาษีด้วย + stamp `reversed` (สอดคล้อง ต5)
- กระจกทุกชนิด copy เฉพาะ `contractId` ไม่ copy stamp: `receipt-void-reversal.template.ts:415-424` · `exchange-cancel-reversal.template.ts:172-195` · `defect-exchange-reversal.template.ts:139-145`
- idempotency index `journal_entries_idempotency_idx` บังคับที่ (`flow`, `idempotencyKey`) ⇒ ต6 ต้องตั้ง `flow` คู่ key และจับ P2002 แบบ `bad-debt-writeoff.template.ts:367-382`

### 7. เทสเดิมที่ต้องเปลี่ยน (คาด — ยืนยันตอน Task 0 baseline)
`build-receipt-lines.spec.ts` · `payment-receipt.receipt-tax.spec.ts` · `payment-receipt.accrue-at-receipt.spec.ts` · `payments.preview-journal-money.spec.ts` · `payment-journal-preview.mirror-save.spec.ts` · `payments.service.advance.spec.ts` · `reschedule-collect.service.spec.ts` · `reschedule-collect-lifecycle.integration.spec.ts` · `paysolutions-webhook*.spec.ts` (surplus) · `installment-accrual-2a.template.golden.spec.ts` (บล็อก consume) · `compute-early-payoff-je.spec.ts` + `early-payoff-jp4.template.golden.spec.ts` (เคสที่มี `parkRelief` — เพิ่มขากลับ) · `repossession-jp5.close-advances.spec.ts` · `bad-debt-writeoff.close-advances.spec.ts` (เคสที่มี 21-1103) · `exchange-coa.spec.ts` · `input-vat-coa.spec.ts` · `seed-coa-finance.spec.ts` · `payment-helpers` residual-park specs (ถอด) · integration ที่เดิน 6a → JP5/ตัดหนี้สูญ (`accrue-at-receipt.integration.spec.ts` · `receipt-tax-per-ledger.integration.spec.ts` — บรรทัดภาษี · plug เท่าเดิม) · `pp30-output-vat.integration.spec.ts` · `VatPage.test.tsx` · `receipt-void.*.spec.ts` (ด่านใหม่)
**ต้องผ่านโดยไม่แก้:** golden 2A ทั้งหมด · golden JP4/JP5/ตัดหนี้สูญ ที่ไม่มีเงินพัก/เครดิต (ขากลับ 0 = ไม่มีบรรทัด) · `reconstruct-prior` specs · `receipt-void` คืนคอลัมน์

### 8. สภาพระหว่าง task — ห้าม deploy / merge จนครบ Task 6
Task 2 (พัก) ก่อน Task 3 (หัก) = ภาษีซ้ำชั่วคราว · Task 4 ต้องมาพร้อม migration · ทั้ง PR merge เป็นก้อนเดียว

---

## Tasks

### Task 0: ตรวจสภาพแวดล้อม + baseline
- [x] worktree `BESTCHOICE-pr4-advance-vat` สาขา `feat/acct-review-pr4-advance-vat` จาก `origin/main` 984b7a709 · `npm ci` · `npx prisma generate` (ทำแล้ว 2026-10-11)
- [ ] รัน jest ชุดที่ระบุในหมายเหตุ 7 + vitest integration (`accrue-at-receipt` · `receipt-tax-per-ledger` · `pp30-output-vat` · `reschedule-collect-lifecycle`) เขียว = baseline
- [ ] ยืนยัน grep ตามหมายเหตุ 6 ยังตรง

### Task 1: ตัวช่วย `journal/advance-vat.ts` + เทส
- [ ] `advanceVatOf` (ย้ายจาก `receipt-tax-breakdown.ts` แล้ว re-export) · `ADVANCE_VAT_META` · `buildAdvanceVatParkLines` / `buildAdvanceVatConsumeLines` · `advanceVatOutstanding` (clamp ≥ 0) · `resolveConsumeVat`
- [ ] jest `advance-vat.spec.ts`: 1,419 → 92.83 · 500 → 32.71 · outstanding ข้ามแถว `reversed` · กระจก (ไม่มี stamp) ไม่ถูกนับ · clamp 0 เมื่อ Σ consume > Σ park · `resolveConsumeVat` เพดาน + ใบสุดท้ายรับเศษ (250+250 → 16.36 + 16.35) · เครดิตไม่มี stamp → 0

### Task 2: ขาภาษีตอนพัก 4 จุด + preview (ต2)
- [ ] `build-receipt-lines.ts` + `PaymentReceiptTemplate` stamp · `payment-journal-preview.service.ts` 6a mirror · `reschedule-collect.service.ts` 6a · `paysolutions-webhook.service.ts` surplus · `payment-receipt-orchestrator.ts` `overpayment-credit`
- [ ] เทส: `build-receipt-lines.spec` (D1 500 → 32.71) · `reschedule-collect.service.spec` (G1) · `mirror-save` spec · paysolutions surplus spec · orchestrator overpayment-credit spec · คำอธิบายบรรทัด byte-identical ระหว่าง preview กับ posted

### Task 3: ขากลับตอนหัก — ใบรับชำระ + รอบกลางคืน (ต3 ก/ข · ต4) + เอกสาร = บัญชี (ต9)
- [ ] `PaymentReceiptTemplate.executeInTx`: `resolveConsumeVat` (ฐาน `advanceConsume` + delta ของ 21-5101 · `emptiesBucket` จาก GL ใน tx) → `buildReceiptLines({ advanceVatConsume })` → `computeInstallmentReceiptTax({ advanceVatConsumed })` → stamp
- [ ] `installment-accrual-2a.template.ts` บล็อก generic + park: ยอดหักรวมก่อน · ขากลับต่อรายการ · stamp
- [ ] เทส: G2 · G3 (250+250) · ใช้เครดิตชำระที่มี stamp park · G7 · `reconstructPriorCleared` ไม่นับบรรทัดภาษี · void ใบที่มีขากลับ → outstanding คืน · `receipt-tax-breakdown.spec` รับ `advanceVatConsumed`

### Task 3ข: ขากลับตอนปิดสัญญา — JP4 / JP5 / ตัดหนี้สูญ (ต3 ค/ง · ต8)
- [ ] `compute-early-payoff-je.ts`: `advanceVatReversal` ใน `buildEarlyPayoffJournal` → `buildEarlyPayoffJE` (บรรทัดขากลับ + `deferredVat` ปรับ) · `EarlyPayoffJP4Template` ส่งค่าเดียวกัน · metadata `advanceVatReversal`
- [ ] `repossession-jp5.template.ts` / `bad-debt-writeoff.template.ts`: ขากลับ = `advanceVatOutstanding` ทั้งก้อน หลังบรรทัด 21-1103/21-5101 ก่อนขาล้าง 21-2102 · `bal21_2102` ปรับ · stamp
- [ ] เทส: G4 (JP4 สมดุล 25,448.30 · 52-1106 เท่าเดิม) · G5 (plug เท่าเดิม) · G8 (21-2102 ติดลบ → 0) · **G9** (ถังใหญ่กว่ายอดปิด: 21-2102 หลัง JP4 = −32.71 แล้วรอบกวาดล้างเป็น 0 — integration ร่วมกับ Task 4) · JP5 ตัวอย่างข้อ 5 ของ PR6 + เงินพัก (51-1102 เท่าเดิม) · เคสไม่มีเงินพัก = golden เดิมทุกไบต์ · `payoff-parity-park.spec` ยังผ่าน

### Task 4: รอบกวาดเงินพักส่วนเกิน → 42-1106 (ต6/ต6ข/ต7)
- [ ] migration `2026101100xxxx_reopen_42_1106_advance_excess_income` · `finance-coa.csv` · พลิกเทส 3 ไฟล์ (ต7)
- [ ] `advance-excess-income.template.ts` + `advance-excess-income.cron.ts` (00:40 BKK · เลือกสัญญาตามหมายเหตุ 4 · tx ต่อสัญญา · idempotency flow+key · P2002/P2034 · Sentry ต่อสัญญา) · ลงทะเบียนใน `journal.module.ts` · ถอด `alarmResidualParkOnCompletion` จาก 2 ผู้เรียก · งานข้อความใหม่ · audit `ADVANCE_EXCESS_RECOGNIZED`
- [ ] `receipt-void.service.ts` ด่าน ต6ข + เทส
- [ ] jest golden G6 · integration (vitest): ปรับดิว 2 ครั้ง → ผ่อนครบทางรอบกลางคืน → รอบกวาด → 42-1106 1,235.64 · 21-2102 = 0 · 21-1103 = 0 · คอลัมน์ 0 · งาน 1 ใบ · รันซ้ำไม่ลงซ้ำ · void หลังลง → ปฏิเสธ · เคสลิงก์ชำระ QR ปิดสัญญา (COMPLETED) ถูกกวาด · เคส `EARLY_PAYOFF` ถังเกินยอดปิด (G9 · ถ4) · เคสมี 21-5101 ค้าง → ขากลับไม่กินภาษีของเครดิต (ต4) · เคสคำขอ void ค้างคิว → ข้าม · เคสคอลัมน์ > 0 บัญชี = 0 → งานแจ้ง ไม่ลงรายการ · ด่านซ้ำที่จุดสร้างคำขอ void

### Task 5: ภ.พ.30 จัดประเภท `ADVANCE_APPLIED` (ต10) + หน้า `/finance/vat`
- [ ] `pp30-output-vat.ts` kind ใหม่ + JSON · `VatPage.tsx` แถวใหม่ (ข้อความ ถ5) + `VatPage.test.tsx`
- [ ] `pp30-output-vat.integration.spec.ts` เคสสองเดือน (หมายเหตุ 5)

### Task 6: กติกาบัญชี + CSV กรณีที่ 6 + เวอร์ชัน + regression
- [ ] `.claude/rules/accounting.md`: หัวข้อใหม่ "ภาษีขายของเงินรับล่วงหน้า ณ วันรับเงิน (PR4)" + ขีดฆ่ารายการ "ที่ยังเปิดอยู่" ที่ปิดแล้ว + แก้หัวข้อ "Residual ตอนปิดครบงวด — alarm อย่างเดียว" เป็นรอบกวาด + ตาราง Chart เพิ่ม 42-1106 + หัวข้อ JP4/JP5/ตัดหนี้สูญ แถวภาษีขาย
- [ ] `case-6a` / `case-6b` CSV: บรรทัดหมายเหตุ D6 (ไม่แก้ตารางเดิม)
- [ ] `apps/web/package.json` version bump · `./tools/check-types.sh all` · jest ทั้งชุด · vitest integration globs ที่แตะ (`ACCT_FILES` · payments · journal · receipts)
- [ ] commit + push + เปิด PR (merge รอเจ้าของ) · PR body ระบุ ถ1–ถ7 + "ต้องรู้ก่อน deploy"

### PR4ข (แยก — รอ mockup + ถ6)
- ใบเสร็จ 6a เป็น "ใบเสร็จรับเงิน / ใบกำกับภาษี" เก็บ 7 ช่อง PR3 (`reschedule-collect` ประทับ `metadata.receiptTax` ให้ `generateReceipt` RESCHEDULE_FEE อ่าน) · `receipt-document-money.ts` `vatBearing` รวม RESCHEDULE_FEE เมื่อมีค่าที่เก็บ · ใบรับเงินส่วนเกินลิงก์ชำระ · ยกเลิกใบ 6a ยังปฏิเสธตามเดิม

---

## สถานะการตรวจสอบของแผนนี้
- 2026-10-11 ร่าง 1: อ่านโค้ดบน `origin/main` 984b7a709 · ตัวเลขคำนวณด้วย Decimal (python) ยังไม่ปักด้วยเทส
- 2026-10-11 ผลตรวจอิสระรอบ 2 (เฉพาะส่วนที่เปลี่ยน · ไม่มี Critical) → ร่าง 3: **A** ขาล้าง 21-2102 ของ JP4 ต้อง = GL + outstanding ทั้งก้อน ไม่ใช่ + ขากลับ (ถังใหญ่กว่ายอดปิด → 21-2102 ค้าง +o) → ต8 / หมายเหตุ 3 / G9 · **B** คำขอ void ค้างคิวอนุมัติ → รอบกวาดข้าม + ด่านซ้ำที่จุดสร้างคำขอ (ต6/ต6ข) · **C** ถอด alarm แล้วคอลัมน์ > 0 บัญชี = 0 เงียบ → งานแจ้ง + warnings (ต6 / หมายเหตุ 4) · ต4 รายได้ส่วนเกินใช้ `emptiesBucket = GL 21-5101 == 0` · ต11 ทาง QR EARLY_PAYOFF ไม่ผ่าน JP4 = ข้อจำกัด · ถ8 ถังรวมหลังปิด · หมายเหตุ 3 ย้าย `parkConsume` ก่อน post generic · G8 "ก่อนใบลดหนี้" · ตัวเลข G2/G4/G6 ผู้ตรวจยืนยัน
- 2026-10-11 ผลตรวจอิสระรอบ 1 → ร่าง 2: **C1** ลำดับ `checkContractCompletion` ก่อนใบรับชำระ → เปลี่ยน ต6 เป็นรอบกวาดรายวัน · **I1** ขาดทุน/หนี้สูญไม่เปลี่ยน (คู่ภาษีสมดุล) → แก้สรุปข้อ 3 / G5 / ถ1 · **I2** 21-2102 ติดลบเมื่อภาษีพัก > ภาษีรอเรียกเก็บที่เหลือ → เพิ่มขากลับใน JP4/JP5/ตัดหนี้สูญ (ต3/ต8 · G8 · Task 3ข) · **I3/I4** ทาง QR และรอบกลางคืน → รอบกวาดครอบ + ด่าน void (ต6ข · ถ7) · **I5** เทส 42-1106 อีก 2 ไฟล์ (ต7) · **I6** clamp outstanding ≥ 0 (ต4/ต5) · M1 `emptiesBucket` จาก GL + รอบกลางคืน 2 รายการ (ต5) · M2 G2 ถ้อยคำ (ใช้ 99.13 ของงวดสุดท้าย · 6.30) · M3 flow+key+P2002 (ต6) · M4 ลำดับ classify (ต10) · M5 defect-exchange sweep (หมายเหตุ 6)
