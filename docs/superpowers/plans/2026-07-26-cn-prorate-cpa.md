# CN Pro-rate ตามคำตอบ CPA + Manual Issue Endpoint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ตามคำตอบ CPA (2026-07-26): ใบลดหนี้ ม.82/5 สำหรับงวดจ่ายบางส่วนต้อง **pro-rate ตามยอดค้างจริง** — แก้สูตร CN VAT ใน JE templates (JP5 + write-off) และเอกสาร CN ให้ตรงกันผ่าน shared util, ยกเลิก HELD gate (ออกเอกสารอัตโนมัติทุกเคสด้วยยอด pro-rated), เพิ่ม manual issue endpoint ตามที่ commit ไว้

**Architecture:** util กลางตัวเดียว `computeCnBreakdown` (journal module ข้าง `computeInstallmentBreakdown`) เป็น source of truth ของยอด CN — JP5 template, write-off template, และ `CreditNoteDocumentService` เรียกตัวเดียวกัน → assert JE↔document เท่ากันโดยโครงสร้าง; endpoint ออกมือรันใน tx ของตัวเองสำหรับเคสที่ JE มีแล้วแต่เอกสารยังไม่ออก

**Tech Stack:** NestJS + Prisma + Decimal, vitest golden specs (cpa-templates dir), jest unit

## Global Constraints

- **สูตร CPA (BINDING):** ต่องวด accrued-unpaid i: `outstanding_i = amountDue_i − amountPaid_i` (จาก Payment row; lateFee ไม่เกี่ยว), `cnTotal_i = outstanding_i`, `cnVat_i = (vatPerInst × outstanding_i / installmentTotal).toDecimalPlaces(2, ROUND_HALF_UP)`, `cnBeforeVat_i = cnTotal_i − cnVat_i`; ผลรวม = Σ ต่อรายการงวด (ปัดต่องวดก่อนรวม) — golden CPA: 99.17 × 515.83/1,515.83 = **33.75**
- งวดเต็ม (PENDING/OVERDUE ไม่จ่ายเลย): cnVat_i = vatPerInst พอดี — เคส clean เดิมต้องได้เลขเดิมเป๊ะ (3 งวดเต็ม 17k/12: cnVat 297.51, total 4,547.49, beforeVat 4,249.98 — ห้ามเปลี่ยน)
- นิยาม accrued-unpaid เดิม: `accrualJournalEntryId != null` + ไม่มี Payment `status='PAID'` (PARTIALLY_PAID/PENDING/OVERDUE = ค้าง); Payment lookup ต่องวดด้วย `@@unique([contractId, installmentNo])`
- JE templates stamp `metadata.creditNoteVatAmount = Σ cnVat` (ค่าใหม่ pro-rated); `CreditNoteDocumentService` assert เท่ากับที่ตัวเองคำนวณ (กลไกเดิม — แต่ตอนนี้สองฝั่งเรียก util เดียวกัน)
- **ห้ามแตะ clearing legs ของ JP5** (Cr 11-2103 count-based ฯลฯ) — pre-existing behavior; เปลี่ยนเฉพาะบรรทัด `Dr 21-2101` (CN VAT) — ข้อจำกัด: JP5 กับ partial installment มี over-credit 11-2103 อยู่แล้วเป็น backlog แยก (บันทึกใน §Backlog ล่าง)
- write-off template: Cr legs เป็น GL-based อยู่แล้ว (ถูกกับ partial) — เปลี่ยนเฉพาะ `Dr 21-2101` cnVat + metadata
- HELD gate ใน `CreditNoteDocumentService`: **ยกเลิก** — เคส partial ออกเอกสารอัตโนมัติด้วยยอด pro-rated; ลบ Todo `credit-note-review` path; outcome type `HELD_PARTIAL_PAID` ลบออกจาก union (เช็ค caller ทั้งสอง + tests); อัปเดต accounting.md (checklist ปิดงวดเรื่อง HELD → เปลี่ยนเป็น historical note)
- Manual endpoint: `POST /receipts/credit-note/issue` body `{ contractId, source: 'REPOSSESSION'|'WRITE_OFF' }` — `@Roles('OWNER','FINANCE_MANAGER','ACCOUNTANT')` บน `ReceiptsController` (มี guards ครบอยู่แล้ว); logic: หา JE จาก `metadata.flow` (`repossession`/`write-off`) + contractId (POSTED, deletedAt null) → ไม่มี JE → 404 Thai; มีเอกสารแล้ว → 409 Thai; เรียก `issueForContract` ใน `$transaction` ใหม่ + fire delivery หลัง commit (pattern เดิม); AuditLog ผ่าน actor จริง (req.user)
- **Assert-mismatch policy สำหรับ JE เก่า:** JE ที่ post ก่อน pro-rate (metadata เป็นยอดเต็ม) เรียกผ่าน endpoint → assert fail → 422 พร้อมข้อความไทยแนะนำปรึกษา CPA เรื่องปรับปรุง JE (บน prod ปัจจุบันไม่มีเคสค้าง — เช็คแล้ว 2026-07-26: ไม่มี repossession/write-off JE เลย)
- Decimal เท่านั้น; Thai errors; commit ลงท้าย Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>; branch `feat/cn-prorate-cpa`
- DB-backed specs ใน `apps/api/src/modules/journal/cpa-templates/` (vitest, CI glob)

---

### Task 1: Shared util `computeCnBreakdown`

**Files:**
- Create: `apps/api/src/modules/journal/compute-cn-breakdown.ts`
- Test: `apps/api/src/modules/journal/compute-cn-breakdown.spec.ts` (jest — pure function + prisma-client param)

**Interfaces:**
- Produces:
```ts
export interface CnBreakdownRow { installmentNo: number; outstanding: Decimal; cnVat: Decimal; cnBeforeVat: Decimal; }
export interface CnBreakdown { count: number; totalOutstanding: Decimal; totalCnVat: Decimal; totalBeforeVat: Decimal; rows: CnBreakdownRow[]; }
export async function computeCnBreakdown(
  client: Prisma.TransactionClient | PrismaClient,
  contract: { id: string; totalMonths: number; financedAmount: Decimal|any; storeCommission: Decimal|any|null; interestTotal: Decimal|any; vatAmount: Decimal|any|null },
  opts?: { installments?: ..., payments?: ... } // optional preloaded (JP5 มีข้อมูลin-memory แล้ว — รับได้เพื่อไม่ query ซ้ำ)
): Promise<CnBreakdown>
```
- ภายใน: per-installment values จาก `computeInstallmentBreakdown` (import — ห้าม copy สูตร); query installmentSchedules (deletedAt null, accrualJournalEntryId != null) + payments ของ contract; งวดที่ไม่มี Payment row = ค้างเต็ม (outstanding = installmentTotal); status PAID → ข้าม; อื่นๆ → outstanding = amountDue − amountPaid (clamp ≥ 0, ถ้า > installmentTotal ใช้ installmentTotal)
- Tests: (1) golden CPA partial 33.75; (2) 3 งวดเต็ม → 297.51/4,547.49/4,249.98; (3) mixed 2 เต็ม + 1 partial (จ่าย 1,000) → totalCnVat 99.17+99.17+33.75 = **232.09**, totalOutstanding 1,515.83+1,515.83+515.83 = **3,547.49**, beforeVat = 3,547.49−232.09 = **3,315.40**; (4) งวดไม่มี Payment row = เต็ม; (5) PAID ข้าม

TDD + commit: `feat(cn): computeCnBreakdown — สูตร pro-rate ตาม CPA (util กลาง JE↔เอกสาร)`

---

### Task 2: JP5 template ใช้ util (เฉพาะ CN VAT line)

**Files:**
- Modify: `apps/api/src/modules/journal/cpa-templates/repossession-jp5.template.ts` — แทน `accruedCreditNoteVat = vatPerInst.times(accruedCount)` ด้วยผลจาก `computeCnBreakdown` (ส่ง preloaded insts/payments ที่ template มีอยู่); `Dr 21-2101` = totalCnVat; metadata.creditNoteVatAmount = totalCnVat.toFixed(2); **ห้ามแตะบรรทัดอื่น** (accruedClear11_2103, deferred legs, loss calc ที่หัก CN — ตัว loss จะขยับตาม cnVat ใหม่โดยอัตโนมัติเพราะสูตรอ้าง accruedCreditNoteVat เดิม — ตรวจว่า rename ไม่หลุด)
- Test: `__tests__/jp5-vat-split.spec.ts` — goldens เดิม (งวดเต็มล้วน) ต้องผ่านไม่เปลี่ยนเลข + เพิ่ม 1 golden partial: 3 accrued (1 งวดจ่าย 1,000) → Dr 21-2101 = 232.09 + loss เปลี่ยนตาม (คำนวณ expected ใน test จากสมการ balance เดิม)

Commit: `fix(cn): JP5 CN VAT pro-rate ตาม CPA (งวดจ่ายบางส่วนลดตามสัดส่วนค้าง)`

---

### Task 3: Write-off template ใช้ util (เฉพาะ CN VAT line)

**Files:**
- Modify: `apps/api/src/modules/journal/cpa-templates/bad-debt-writeoff.template.ts` — cnVat จาก util (แทน vatPerInst × count); `creditNoteIssued = totalCnVat.gt(0)`; loss plug ปรับตัวเองอยู่แล้ว (ΣCr−ΣDr)
- Test: `bad-debt-writeoff.template.spec.ts` — goldens เดิมคงเลข + partial scenario: 3 accrued (1 จ่ายบางส่วน 1,000 — สร้าง Payment PARTIALLY_PAID + 2B receipt JE จริงเพื่อให้ GL 11-2103 ลดตาม) → Dr 21-2101 = 232.09; JE balance; plug ตามสมการ

Commit: `fix(cn): write-off CN VAT pro-rate ตาม CPA`

---

### Task 4: CreditNoteDocumentService — ยกเลิก HELD, ออก pro-rated อัตโนมัติ

**Files:**
- Modify: `apps/api/src/modules/receipts/services/credit-note-document.service.ts` — ลบ dirty gate + Todo path; ยอดจาก `computeCnBreakdown` (amount=totalOutstanding, vatAmount=totalCnVat, amountBeforeVat=totalBeforeVat, itemDescription ระบุจำนวนงวด + หมายเหตุ pro-rate เมื่อมี partial); assert vs JE metadata (กลไกเดิม); outcome union ลบ `HELD_PARTIAL_PAID` — อัปเดต callers (repossessions/bad-debt แค่ type — ไม่มี logic เพิ่ม) + tests (HELD test เดิม → กลายเป็น ISSUED pro-rated test ด้วยเลข 232.09/3,547.49/3,315.40)
- Modify: `.claude/rules/accounting.md` — CN section: HELD gate retired (CPA ruling 2026-07-26 = pro-rate), checklist ปิดงวดเรื่อง credit-note-review Todo → historical note (เคสใหม่ไม่เกิด; Todo เก่าถ้ามีให้ใช้ manual endpoint)

Commit: `feat(cn): ออกใบลดหนี้ pro-rated อัตโนมัติทุกเคส (ยกเลิก HELD gate ตาม CPA ruling)`

---

### Task 5: Manual issue endpoint

**Files:**
- Modify: `apps/api/src/modules/receipts/receipts.controller.ts` + `receipts.service.ts` (หรือ service ใหม่เล็ก) — `POST /receipts/credit-note/issue` per Global Constraints (roles, 404/409/422 Thai, own $transaction, delivery after commit fire-and-forget)
- Test: jest controller/service — JE ไม่มี → 404; เอกสารมีแล้ว → 409 (idempotent ผ่าน issueForContract SKIPPED_DUPLICATE → map 409); สำเร็จ → 201 {receiptId, receiptNumber} + deliver called after tx; metadata mismatch (JE เก่ายอดเต็ม) → 422 ข้อความแนะนำ CPA

Commit: `feat(cn): manual CN issue endpoint (เคส JE มีแล้วแต่เอกสารยังไม่ออก)`

---

### Task 6: Gates + docs + PR

- `./tools/check-types.sh all`; jest api เต็ม (triage baseline depreciation); vitest CI-equivalent (32+ ไฟล์); code-reviewer whole branch; รายงาน owner → approve → PR → admin merge

## Backlog (นอก scope — บันทึกไว้)
- JP5 clearing legs count-based over-credit 11-2103 เมื่อมี partial (pre-existing ก่อน pro-rate) — ควรย้ายเป็น GL-based แบบ write-off template ใน pass แยก พร้อม golden partial-repossession เต็มชุด
