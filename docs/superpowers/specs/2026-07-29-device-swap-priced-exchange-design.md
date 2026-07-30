# Device Swap — Priced Exchange (เปลี่ยนเครื่องแบบมีราคารับซื้อ) — Design

- **Date:** 2026-07-29
- **Source of truth:** "DeviceSwap Accounting Test Workbook v1.0" (12 กรณี, Excel — เจ้าของส่งเป็นภาพ 14 sheets, 2026-07-29) + คำตัดสินเจ้าของ D1–D5 ด้านล่าง
- **Supersedes:** พฤติกรรมบัญชีของ SP2 same-price exchange (`case-8-same-price.csv` golden ถูก retire — ดู §4.1)
- **Related:** `.claude/rules/accounting.md` (Phase A.4 chart), `apps/api/src/modules/contract-exchange/`, `docs/specs/SPEC-installment.md` §5.2/§11.4

## 0. Goal (หนึ่งประโยค)

ขยาย SP2 same-price exchange ให้เป็นระบบเปลี่ยนเครื่องกลางสัญญาแบบมี**ราคารับซื้อเครื่องเดิมจริง** ครบตาม workbook CPA: memo-only สำหรับรุ่นเดิม/ราคาเดิม, derecognition ผ่านบัญชีพัก 21-1106 พร้อมขาเงินสดสำหรับราคาอื่น, approval 3 ระดับ, ยกเลิกได้ใน 30 วัน, และ reverse ECL ตอน derecognize

## 1. Owner decisions (พี่นาย, 2026-07-29)

| # | คำถาม | คำตัดสิน |
|---|---|---|
| D1 | Same-price swap: workbook Case 1 (memo only) ขัดกับ SP2 ปัจจุบัน (post JE + loss) | **ตาม workbook** — same-price = MEMO mode ไม่มี JE ไม่สร้างสัญญาใหม่; derecognition JE เฉพาะ PRICED mode |
| D2 | บัญชี ECL reversal — workbook ใช้ 42-1106 ซึ่ง CSV ระบุเป็น "รายได้บริการซ่อม" | **ใช้ 42-1106 ตาม workbook** — ปลอดภัยเพราะ FINANCE 42-1106 เป็น orphan (runtime repair ใช้ `S42-1101` จริง: `repair-ticket-lifecycle.service.ts:27`, seed dev+prod, spec test ล็อกอยู่) → rename row ใน CSV |
| D3 | "IQR ขอบล่าง" — ระบบไม่มีข้อมูลสถิติราคา | **ใช้ `TradeInValuation.basePrice` × 0.85 แทน** (guardrail ±15% convention เดิมของ trade-in) |
| D4 | Cancellation windows | **ทำครบทั้ง 2 windows** (≤7 วันฟรี / 8–30 วัน + ค่าปรับ 5% → บัญชีใหม่ 42-1107) |
| D5 | ขาเงินสดใน JE จุดที่ 3 — post เมื่อไหร่ | **(a) post ทันทีตอน finalize ตาม workbook** พร้อม `depositAccountCode` (สมมติฐาน: โอนเงินระหว่างบัญชีตัวเองวันเดียวกัน) — หมายเหตุ: 21-1101 ของสัญญาปกติทั้งระบบยังไม่เคยถูกล้าง (VendorClearance unwired) = backlog CPA แยกต่างหาก ดู §12 |

## 2. Workbook-internal inconsistencies — resolution ที่ตกลงใช้

| Workbook พูด | ข้อเท็จจริง | Resolution |
|---|---|---|
| Case 2C "เท่าทุน ไม่มี P/L line" | JE ในหน้าเดียวกัน + Summary มี loss 4,793.36; P/L สุทธิจริงที่ราคา = NCV คือ −793.36 (VAT ม.78/1 ที่ต้องนำส่งแต่เก็บไม่ได้) | ใช้ตาม JE body — loss plug คำนวณจาก balance equation เสมอ ไม่มี special-case "breakeven" |
| Case 2C = Auto ทั้งที่ 7,333.28 < IQR ขอบล่าง 7,800 (ขัดกติกา AND ของ 2A) | กติกากำกวม | นิยามใหม่ชัด (§6): AUTO ต้องผ่านทั้ง NCV และ market check; ราคา = NCV แต่ตก market check → REVIEW |
| Sheets 10–11 ตัวเลข Reverse JE ผิด cell (Dr 11-1101 14,126.64, Cr 21-1101 12,126.64, ลืมกลับขา 51-1102, total ✗) แต่ Summary บอก PASS | สูตร workbook พัง — pattern ที่ตั้งใจคือ mirror ทุกบรรทัด | Implementation ใช้ mirror-reversal จริงทุกบรรทัด (infra `DefectExchangeReversalTemplate` pattern) — **ห้ามใช้ตัวเลขใน sheets 10–11 เป็น golden** |
| ยอดคงเหลือ hardcode 11,333.28 / 793.36 (สูตร ×งวดคงเหลือ) | GL จริงหลังจ่าย 4 งวด = 11,333.36 / 793.32 (เศษปัดอยู่งวดสุดท้าย ตาม ROUND_DOWN/HALF_UP convention) | ทุก leg อ่านจาก **ledger จริง** (เหมือน `computeOldOutstanding` / `glContractBalance`) — golden specs ใช้ตัวเลข GL จริง |
| ค่าปรับยกเลิก → 41-1199 | 41-XXXX = รายได้หลัก; ค่าปรับอยู่หมวด 42 (เทียบ 42-1103) | ใช้ **42-1107** (บัญชีใหม่ §10) |
| Year-end Sheet 13 มี "51-1106 ค่าเสียหายจากการยกเลิก swap" | ไม่มีเคสไหนใน workbook สร้างรายการนี้ (Case 3B ค่าปรับเป็นรายได้) | **ไม่เปิดบัญชี 51-1106** — ฝากถาม CPA; year-end กวาด prefix อัตโนมัติถ้าเพิ่มภายหลัง |
| Year-end ปิดเข้า 32-1101 | โค้ดปัจจุบันปิดเข้า 33-1101; CSV บอก "33 ปิดเข้า 32 สิ้นปี" (step ที่ยังไม่มีโค้ด) | นอก scope sprint นี้ — follow-up แยก (§12) |

## 3. Architecture — ขยาย `contract-exchange` in-place (แนวทาง A)

ไม่สร้าง module ใหม่ SP2 เดิมกลายเป็น MEMO mode; PRICED mode เพิ่มบน flow เดิม (submit → approve → sign-then-activate → finalize) — คิวเดียว model เดียว ประวัติต่อเนื่อง

เหตุผลบังคับทางบัญชีที่ MEMO ต้อง in-place (ไม่สร้างสัญญาใหม่แบบไม่มี JE): สัญญาใหม่ที่ไม่มี 1A ใน ledger จะโดน 2A accrual cron ตั้ง accrue บนยอดที่ไม่มีตั้งต้น → GL เพี้ยน; การคงสัญญาเดิม (1A เดิมอยู่ครบ) คือทางเดียวที่ invariant ไม่แตก

## 4. Mode routing

```
submit(oldContractId, newProductId, buybackPrice?, deviceCondition?, ...)
  ├─ MEMO   : same brand/model/storage และ newProduct.installmentPrice == oldContract.sellingPrice
  │           (เทียบกับราคาบนสัญญา ไม่ใช่ราคาปัจจุบันของ product เก่า — กัน price-list drift)
  │           → ไม่มี JE, ไม่มีสัญญาใหม่, buybackPrice ต้องไม่ส่งมา
  └─ PRICED : ทุกกรณีอื่น → ต้องมี buybackPrice + deviceCondition + depositAccountCode
              + แผนผ่อนใหม่ (newTotalMonths, newInterestRate; downPayment = 0 ใน v1)
```

### 4.1 ผลกระทบต่อ SP2 เดิม

- `case-8-same-price.csv` golden **retire** (scenario นั้นตอนนี้ = MEMO ไม่มี JE) — แก้ fixture-loader/tests ที่ iterate ไฟล์
- Template A.1/A.2/A.3 **ยังอยู่** — ใช้กับ PRICED mode (A.3 ขยายขาเงินสด §7.3)
- Backfill `mode` ของ row เดิม: มี `je2Id` → `PRICED`; row PENDING ค้าง ณ วัน deploy → route ตามกติกาใหม่ตอน approve

## 5. Data model — ขยาย `ContractExchangeRequest` (= "device_swap_log" ของ workbook)

```prisma
// enums ใหม่
enum ExchangeMode { MEMO PRICED }
enum ExchangeApprovalTier { AUTO REVIEW ESCALATE }
// ExchangeRequestStatus เพิ่มค่า: CANCELED

// fields ใหม่บน ContractExchangeRequest
mode                ExchangeMode           @default(PRICED)
buybackPrice        Decimal?               @db.Decimal(12, 2)
deviceCondition     String?                // A-D — key เข้า TradeInValuation
approvalTier        ExchangeApprovalTier?
ncvSnapshot         Decimal?               @db.Decimal(12, 2)  // ณ ตอน approve
basePriceSnapshot   Decimal?               @db.Decimal(12, 2)  // จากตารางราคากลาง (null = ไม่มี row)
depositAccountCode  String?                // 1 ใน 6 cash codes
newTotalMonths      Int?
newInterestRate     Decimal?               @db.Decimal(5, 4)
// ECL
eclReversalJeId     String?
// Cancellation
canceledAt          DateTime?
canceledById        String?
cancelReason        String?
cancelWindow        String?                // FREE_7D | PENALTY_8_30D
penaltyAmount       Decimal?               @db.Decimal(12, 2)
penaltyJeId         String?
reversalJeIds       String[]               @default([])
// MEMO
memoAppliedAt       DateTime?              // MEMO ไม่ผ่าน activation — จุดที่ productId ถูกสลับ
```

Migration additive ทั้งหมด, ไม่มี breaking change

## 6. Approval matrix (PRICED)

คำนวณฝั่ง server; แสดง preview ให้ user เห็นก่อน submit; **enforce จริง ณ ตอน approve ด้วย GL สด** (ไม่ re-tier ตอน finalize — จำนวนเงินใน JE ใช้ GL สดเสมอ)

```
NCV        = GL(11-2101, dr) − GL(11-2106, cr)          // ledger จริงของสัญญาเก่า
marketMin  = TradeInValuation(brand, model, storage, deviceCondition).basePrice × 0.85
marketMax  = basePrice × 1.15                            // symmetric ±15% (I5)

AUTO     : buyback ≥ NCV และ (มี valuation row และ marketMin ≤ buyback ≤ marketMax)
REVIEW   : NCV × 0.70 ≤ buyback < NCV  หรือ  (ผ่าน NCV แต่ตก market check / ไม่มี valuation row)
           หรือ buyback > marketMax (overpay เกินราคากลาง — I5, final review 2026-07-29)
ESCALATE : buyback < NCV × 0.70
```

- **marketMax upper bound (I5, 2026-07-29):** AUTO ต้องอยู่ในกรอบราคากลางทั้ง 2 ด้าน —
  จ่ายแพงเกิน (เอื้อลูกค้า/พนักงาน) ต้องผ่านคนอนุมัติเหมือนจ่ายถูกเกิน ตาม rationale
  symmetric ±`exchange_market_check_pct` ของ D3 เอง (**owner confirmed 2026-07-29** = D6)

- **AUTO** → auto-approve ตอน submit (approvedById = requester, audit ระบุ tier)
- **REVIEW** → BRANCH_MANAGER หรือ OWNER อนุมัติ
- **ESCALATE** → OWNER เท่านั้น
- **MEMO** → BRANCH_MANAGER หรือ OWNER อนุมัติ
- **Authorization บังคับที่ service** (ไม่ใช่แค่ controller): BM กด approve ได้เฉพาะ tier REVIEW/MEMO — กัน BM ยิง API ตรงอนุมัติเคส ESCALATE
- `exchange_market_check_pct` เป็น SystemConfig (default `'15'`)

## 7. Journal entries (PRICED — ทั้งหมดใน `$transaction` ของ activation เหมือนเดิม)

### 7.0 Pre-flight guards (block finalize พร้อมข้อความไทยชัดเจน)

| Guard | เหตุผล |
|---|---|
| `GL(11-2103) > 0` → block "มีงวดค้าง/ถึงกำหนดยังไม่ชำระ — เคลียร์ก่อนเปลี่ยนเครื่อง" | A.2 ไม่มี leg 11-2103; ปล่อยผ่าน = ยอดค้างห้อยตลอดกาล |
| `GL(21-1103) > 0` หรือ `advanceBalance > 0` หรือ `creditBalance > 0` → block "มีเงินรับล่วงหน้า/เครดิตค้าง — ใช้หรือคืนก่อนเปลี่ยนเครื่อง" | derecognize ทั้งที่มีเงินลูกค้าค้าง = หนี้สินห้อย (v1 เลือก block แทน transfer — เคสหายาก, มี flow ใช้/คืนอยู่แล้ว) |
| ค่าปรับล่าช้าค้างชำระ (late fee ยังไม่เก็บ) → **warning ไม่ block** | late fee ไม่อยู่ใน GL asset (รับรู้เมื่อเก็บ) — เตือนให้เก็บก่อนถ้าต้องการ, นโยบายให้ swap ได้ |

### 7.1 A.1 — ExchangeNewContract1ATemplate (เดิม, ไม่แก้โครง)

Dr 11-2101 + Dr 11-2105 / Cr 21-1101 + 21-1102 + 11-2106 + 21-2102 ของสัญญาใหม่ — เพิ่มเฉพาะ `idempotencyKey`

### 7.2 A.2 — ExchangeCloseOld21_1106Template (เดิม, ไม่แก้โครง — ทุก leg = GL จริง)

```
Dr 21-1106                buybackPrice
Dr 11-2106                GL คงเหลือ           → Cr 41-1101 เท่ากัน (รับรู้ดอกเบี้ยทันที — TFRS 9 derecognition)
Dr 21-2102                GL คงเหลือ           → Cr 21-2101 เท่ากัน (VAT due ทันที ม.78/1 — ไม่ออก CN ต่างจาก JP5 โดยเจตนา)
Dr 51-1102 loss plug      (ถ้า buyback < GL(11-2101)+GL(11-2105))
   Cr 11-2101             GL คงเหลือ
   Cr 11-2105             GL คงเหลือ
   Cr 41-1102 gain plug   (ถ้า buyback > ยอดรวมข้างต้น)
```

### 7.3 A.3 — ExchangeClearVendor21_1106Template (**แก้: เพิ่มขาเงินสด — D5**)

```
Dr 21-1101   newFinanced
Dr 21-1102   newCommission
Dr {depositAccountCode}  (buyback − vendorSum)     ← ถ้า buyback > vendorSum (คืนเงินลูกค้า — Case 2G)
   Cr 21-1106            buybackPrice
   Cr {depositAccountCode} (vendorSum − buyback)   ← ถ้า buyback < vendorSum (FINANCE โอนเพิ่มให้ SHOP — Cases 2A–2E)
```

vendorSum = newFinanced + newCommission; buyback == vendorSum → ไม่มีขาเงินสด (Case 2F — พฤติกรรม SP2 เดิม)

### 7.4 A.4 — ShopExchangeReturnTemplate (เดิม) + A.5 ใหม่ — ExchangeEclReversalTemplate

```
A.5 (Case 4 — synchronous ใน tx เดียวกัน ตาม workbook):
Dr 11-2102   GL(11-2102, cr) ของสัญญาเก่า
   Cr 42-1106  รายได้จากการโอนกลับค่าเผื่อหนี้สงสัยจะสูญ
```

- skip ถ้า |GL| < 0.005; ถ้า GL ติดลบ → `Sentry.captureMessage` warning (pattern M1 ของ JP5) ไม่ auto-heal
- ปิด `BadDebtProvision` rows ACTIVE → REVERSED ใน tx เดียวกัน (กัน stale rows — สัญญา EXCHANGED หลุด scope cron)
- **หมายเหตุ asymmetry โดยเจตนา:** JP5/write-off/stage-reverse ยัง release เข้า 51-1103 ตามเดิม — 42-1106 ใช้เฉพาะ derecognition จากการเปลี่ยนเครื่อง (ตาม workbook + D2)

### 7.5 Idempotency (ปิด hardening gap เดิม — key รวม requestId, C1b final review 2026-07-29)

A.1–A.5 ทุกตัวมี `metadata.idempotencyKey` บังคับผ่าน DB partial unique index `journal_entries_idempotency_idx`:

| JE | Key | เหตุผล |
|---|---|---|
| A.1 / A.3 | `{newContractId}` | สัญญาใหม่ unique ต่อ attempt อยู่แล้ว |
| A.2 | `{oldContractId}:{requestId}` | key เดิม (`oldContractId` เพียว) ทำ re-exchange หลัง cancel พัง: JE รอบแรกถูก mirror-reverse แต่ยัง POSTED — key ยังค้างใน index → finalize รอบสอง P2002 |
| A.4 | `{oldProductId}:{oldContractId}:{requestId}` | เหตุผลเดียวกับ A.2 |
| A.5 | `{oldContractId}:{requestId}` | เหตุผลเดียวกับ A.2 |

`requestId` = `ContractExchangeRequest.id` — แต่ละ lifecycle (submit→approve→finalize) มี request row ของตัวเอง จึงยัง idempotent ภายใน attempt เดียว (retry ใน tx เดิมชน key เดิม) แต่ไม่ block attempt ใหม่หลัง cancel

หมายเหตุ: A.4 มี `reference` ด้วย (`contract:{oldContractId}:exchange-return:{requestId}`) — ตาราง `journal_entries` มี unique `(reference_type, reference_id)` แยกอีกชั้น จึงต้องผูก requestId ที่ reference string เช่นกัน ไม่งั้น round 2 ชน constraint นี้แม้ idempotencyKey จะไม่ชนแล้ว

## 8. MEMO mode (Case 1)

**Execute ตอน approve (ไม่ผ่าน sign-then-activate):** ใน tx เดียว —

1. `contract.productId` → new product (สัญญาเดิม สถานะเดิม ตารางเดิม — accrual/ECL/MDM flow วิ่งต่อ seamless)
2. Product moves: เครื่องใหม่รับสถานะ/ownership ที่เครื่องเก่ามี (FINANCE ถือกรรมสิทธิ์); เครื่องเก่า → REFURBISHED + SHOP
3. Request row: `mode=MEMO`, `memoAppliedAt`, je ids ทั้งหมด null (= `je_id_close = NULL` ตาม workbook)
4. AuditLog `EXCHANGE_MEMO_APPLIED` (old/new productId + IMEI ทั้งคู่)
5. **ไม่มี JE ใดๆ ทั้ง FINANCE และ SHOP** (SHOP-side inventory movement ไม่ลงบัญชี — สอดคล้องสถานะ F3 ที่ SHOP JEs ส่วนใหญ่ยัง unwired; CPA ทบทวนใน phase SHOP wiring)

**เอกสาร/ปฏิบัติการ (Major 5):**
- พิมพ์**บันทึกแนบท้ายสัญญา** จาก contract template type "สัญญาเปลี่ยนเครื่อง" (มีใน SPEC-installment.md:508) → ลูกค้าเซ็นกระดาษ → upload เป็น `ContractDocument` (documentType ใหม่ `EXCHANGE_ADDENDUM`) — dialog บังคับติ๊ก checklist ก่อน approve
- **MDM checklist** ใน dialog เดียวกัน: ถอน MDM เครื่องเก่า + ลงทะเบียน MDM เครื่องใหม่ (manual ops step, บันทึกใน audit) — ระบบไม่ยิง MDM API อัตโนมัติใน v1
- ยอมรับว่า `Sale` row เดิมชี้เครื่องเก่า — ประวัติตามได้จาก exchange log + audit

**MEMO cancel:** ภายใน 30 วัน — revert `productId` + product states + audit `EXCHANGE_MEMO_CANCELED`; ไม่มีค่าปรับ (ไม่มีฐานราคารับซื้อ); ไม่มี JE. **Guards (I4, final review 2026-07-29):** ก่อน revert ต้อง `oldContract.status === 'ACTIVE'` **และ** `oldContract.productId === req.newProductId` (สัญญายังอยู่ในสถานะ post-MEMO จริง) — มิเช่นนั้น `BadRequestException` "สัญญาสถานะเปลี่ยนไป หรือเครื่องบนสัญญาไม่ตรงกับคำขอ — ยกเลิกแบบ MEMO ไม่ได้" (กัน blind revert ทับสัญญาที่ปิดไปแล้ว / สลับเครื่องรอบใหม่ไปแล้ว)

## 9. Cancellation (PRICED — Cases 3A/3B)

**Preconditions:** `exchangedAt` set; `now − exchangedAt ≤ 30 วัน` (BKK); สัญญาใหม่ไม่มี Payment ที่ `amountPaid > 0` (มิเช่นนั้นต้อง void receipt ก่อน — pattern zero-payment guard ของ defect-exchange); role OWNER/BM + เหตุผล ≥10 ตัวอักษร

**Abort ก่อน finalize (สถานะ APPROVED แต่ยังไม่เซ็น/activate — ยังไม่มี JE ใดๆ):** endpoint เดียวกัน — soft-delete DRAFT contract แบบ **CAS** (`updateMany` guard `status='DRAFT' AND deletedAt IS NULL`, count ≠ 1 → Conflict — กัน race กับ activation ที่วิ่งพร้อมกัน) + **null `exchangedFromContractId` ใน write เดียวกัน** (C1a — ดูด้านล่าง), คืนเครื่องใหม่ RESERVED → IN_STOCK, request → CANCELED (`cancelWindow = 'PRE_FINALIZE'`), ไม่มี reversal/penalty; audit `EXCHANGE_CANCELED`

**ขั้นตอนใน `$transaction` เดียว:**

1. **Mirror-reverse ทุก JE** (template ใหม่ `ExchangeCancelReversalTemplate` — pattern `DefectExchangeReversalTemplate` + `receipt-void-reversal`): ทุก POSTED entry tagged `metadata.contractId = newContractId` (รวม A.1 + accrual 2A ที่อาจวิ่งไปแล้วบนสัญญาใหม่) + swap JEs บนสัญญาเก่า (A.2, A.3, **A.5 ECL** — Dr 42-1106 / Cr 11-2102 คืน provision ทันที P&L ไม่พองสองข้าง; cron delta เจอ 0 = no-op) + A.4 SHOP; stamp `metadata.reversesEntryId` + `reversalJeIds[]` บน request
2. **Catch-up accrual (Major 3):** งวดของสัญญาเก่าที่ `dueDate ≤ วันนี้ AND accrualJournalEntryId IS NULL` → รัน 2A accrual ให้ครบใน tx (สัญญา EXCHANGED ถูกยกเว้นจาก cron ระหว่าง window — ห้ามเงียบ; ตอนเขียน plan ให้ตรวจ scan window ของ `installment-accrual.cron` ก่อน ถ้า cron backfill เองอยู่แล้วให้ลดเหลือ assertion)
3. **Restore:** สัญญาเก่า → ACTIVE + ล้าง `exchangedAt` (overdue cron จัดสถานะ OVERDUE เองถ้ามีงวดเลย due); เครื่องเก่า → คืน FINANCE-owned + สถานะเดิม; เครื่องใหม่ → IN_STOCK + SHOP; สัญญาใหม่ → CANCELED + **null `exchangedFromContractId`** (C1a, final review 2026-07-29: field เป็น `@unique` — ถ้าคงไว้บนสัญญา EXCH- ที่ตายแล้ว การเปลี่ยนเครื่องรอบใหม่ของสัญญาเดิมจะ P2002 ตอน `contract.create` ตลอดกาล; ประวัติ old↔new อยู่บน request row ครบอยู่แล้ว)
3b. **Reverse ECL rows ของสัญญาใหม่ (I3):** `BadDebtProvision` ที่ cron ตั้งให้สัญญาใหม่ระหว่าง window ≤30 วัน → `status: ACTIVE → REVERSED` ใน tx เดียวกัน (JE ของมันถูก mirror-reverse โดย sweep ข้อ 1 อยู่แล้ว — ห้ามทิ้ง row ACTIVE ค้างบนสัญญา CANCELED)
4. **Penalty (เฉพาะวันที่ 8–30):** `penalty = round2(buybackPrice × exchange_cancel_penalty_pct / 100)` (SystemConfig, default `'5'`) → JE แยก: `Dr {depositAccountCode} / Cr 42-1107` — **ไม่มี VAT** (นโยบายค่าปรับเดียวกับ 42-1103); flow `exchange-cancel-penalty`. เพื่อให้ path นี้ไม่ตาย: **submit แบบ PRICED บังคับ `depositAccountCode` ทุกคำขอ** (final review 2026-07-29 — เดิมบังคับเฉพาะ `buyback ≠ vendorSum` ทำให้เคส Case-2F ที่ offset พอดียกเลิกวันที่ 8–30 ไม่ได้)
5. Request row: status → CANCELED + `cancelWindow` (FREE_7D | PENALTY_8_30D) + `penaltyAmount/penaltyJeId`; AuditLog `EXCHANGE_CANCELED`
6. เกิน 30 วัน → block (ยกเลิกไม่ได้ — ต้องใช้เส้นทางอื่น เช่น repossession/CN ตามเหตุการณ์จริง)

## 10. Chart of accounts (ต้อง CPA sign-off ก่อน merge — แก้ `finance-coa.csv` + reseed upsert)

| Code | Action | ชื่อ | หมายเหตุ |
|---|---|---|---|
| 42-1106 | **Rename** | รายได้บริการซ่อม → **รายได้จากการโอนกลับค่าเผื่อหนี้สงสัยจะสูญ** | orphan ยืนยันแล้ว; **pre-flight prod:** `SELECT COUNT(*) FROM journal_lines WHERE account_code='42-1106'` ต้อง = 0 ก่อน rename; แก้ CLAUDE.md:451 (doc ผิด — runtime ใช้ S42-1101) |
| 42-1107 | **Add** | รายได้ค่าปรับยกเลิกเปลี่ยนเครื่อง | รายได้, Cr, ไม่มี VAT |
| 41-1199 | ไม่เพิ่ม | — | ผิดหมวด (41 = รายได้หลัก) — workbook mapping เปลี่ยนเป็น 42-1107 |
| 51-1106 | ไม่เพิ่ม | — | ไม่มีเคสสร้าง — รอ CPA อธิบาย |

SystemConfig ใหม่: `exchange_cancel_penalty_pct` = `'5'`, `exchange_market_check_pct` = `'15'` (seed dev + prod)

## 11. Endpoints / UI / Tests

**API** (`insurance/exchange-requests`): ขยาย submit DTO (`buybackPrice?, deviceCondition?, depositAccountCode?, newTotalMonths?, newInterestRate?`); `GET /preview?oldContractId&buybackPrice&deviceCondition` (OWNER/BM/SALES) → `{ncv, basePrice, marketMin, tier, expectedPl, grossRemaining}`; `POST /:id/approve` เปิด OWNER+BM (service เช็ค tier §6); `POST /:id/cancel` ใหม่ (OWNER/BM)

**UI:** `ExchangeRequestForm` — mode auto-detect + input ราคารับซื้อ/สภาพเครื่อง (A–D)/บัญชีเงิน + live tier badge + P/L preview (pattern `RepossessionsPage` preview-then-commit) + MEMO addendum/MDM checklist; `ExchangeRequestsPage` — tier chips, คิวตาม role, ปุ่มยกเลิก + countdown 7/30 วัน + penalty confirm dialog

**Tests:**
- Template golden specs (ตัวเลข GL จริง): 2A(8,000 loss)/2C(NCV)/2E(escalate)/2F(no-cash)/2G(refund ลูกค้า) + A.5 ECL + penalty + mirror-cancel + MEMO(no JE)
- Service specs: tier matrix (รวม no-valuation-row → REVIEW, boundary NCV/70%), guards §7.0, window math (BKK timezone, ขอบ 7/8/30), tier-role authorization
- Integration: full flow แบบ `*.integration.spec.ts` (CI = jest, DB จริง)
- Retire case-8 + แก้ tests ที่อ้าง
- CI glob: spec ใหม่ใต้ `cpa-templates/__tests__/` ถูก glob ครอบอยู่แล้ว — ห้ามสร้าง subdirectory ใหม่โดยไม่เช็ค glob

## 12. Out of scope / follow-ups (บันทึกไว้ ไม่หายไปเฉยๆ)

1. **JP4 early-payoff ไม่ release ECL** + cron ตามไม่เจอ (สัญญาหลุด scope) — allowance ค้างบน B/S; fix แยกด้วย 51-1103 convention เดิม — **✅ owner เห็นด้วย (C1, 2026-07-30) → เข้าคิวแก้**
2. **VendorClearance unwired ทั้งระบบ** — FINANCE ไม่เคยบันทึกจ่าย SHOP, 21-1101/21-1102 สะสมไม่ถูกล้าง (ตระกูล F3) — **✅ owner สั่งวางแผนเมนู "จ่ายให้หน้าร้าน (INTER-CO)" (C2, 2026-07-30) → brainstorming ถัดไป**
3. Year-end step "33-1101 ปิดเข้า 32-1101" ที่ CSV สั่งแต่โค้ดยังไม่มี — **✅ owner อนุมัติตามคำแนะนำ (C3, 2026-07-30): ทำเป็น Step 4 ของ year-end closing ก่อนรอบปิดปี 2026 (ม.ค.–มี.ค. 2027) — ไม่ด่วน**
4. SHOP-side JE ของ MEMO mode (inventory swap ไม่ลงบัญชี) — รอ phase SHOP wiring
5. Down payment เพิ่มบนสัญญาใหม่ใน PRICED mode (v1 = 0 ตาม workbook)
6. Transfer เงินรับล่วงหน้าอัตโนมัติแทนการ block (v1 block — §7.0)
7. MDM auto lock/unlock ตอน swap (v1 = manual checklist)

## 13. คำตอบ CPA/owner รอบ 2026-07-30 (relay ผ่านพี่นาย)

| ข้อ | เรื่อง | คำตอบ | ผลต่อระบบ |
|---|---|---|---|
| A1 | Rename 42-1106 → "รายได้จากการโอนกลับค่าเผื่อหนี้สงสัยจะสูญ" (FINANCE ไม่มีรายได้บริการซ่อม — งานซ่อมอยู่ฝั่ง SHOP S42-1101) | **ยืนยัน** | ตรงที่ทำไว้แล้ว — ไม่แก้ |
| A1 | ที่มากติกายกเลิก 7d/8-30d/5% | ชี้แจงแล้ว: โครงกติกา + "ค่าปรับเป็นรายได้" มาจาก workbook CPA (Case 3B + D4 owner เคาะ 2026-07-29); ส่วนที่เราตัดสินใจเอง = ย้ายบัญชี 41-1199→42-1107 (ผิดหมวด) + ทำ 5% เป็น config `exchange_cancel_penalty_pct` | ไม่แก้ (รอ CPA ทักถ้าไม่เห็นด้วย) |
| A2.1 | ค่าปรับยกเลิกไม่คิด VAT | **ยืนยัน** (ตรง 42-1103 convention + ม.79) | ตรงที่ทำไว้แล้ว — 42-1107 ไม่มี VAT |
| A2.2 | ECL reversal: ผสม (exchange→42-1106, ที่เหลือ→51-1103) vs มาตรฐานเดียว | **⏳ OPEN — รอ CPA เลือก** หลังอธิบายความต่าง (กำไรเท่ากัน ต่างที่ gross-up P&L + consistency); คำแนะนำเรา: ถ้าเลือกทางเดียวใช้ Cr 51-1103 ทุกเส้นทางแล้วแก้ workbook | ถ้า CPA เลือกมาตรฐานเดียว → แก้ A.5 template 1 จุด + spec |
| B2 | VAT due ทันทีตอน derecognize (ม.78/1 ไม่ออก CN) | **ยืนยัน** | — |
| B3, B4 | (ตามชุดคำถาม B) | **ยืนยัน/รับทราบ** | — |
| B5 | | **รับทราบ** | — |
| B6 | 51-1106 "ค่าเสียหายจากการยกเลิก swap" | **ไม่เปิดบัญชี** — ชี้แจงที่มา: โผล่เฉพาะ Sheet 13 (Year-End Closing) ของ workbook โดยไม่มี Case ไหน post → ขัดกันเองในไฟล์ | ตัดจาก CoA plan ถาวร; year-end กวาด 51-XXXX อัตโนมัติถ้าเพิ่มภายหลัง |
| C1-C3 | follow-ups | ดูสถานะใน §12 ข้อ 1-3 | — |
