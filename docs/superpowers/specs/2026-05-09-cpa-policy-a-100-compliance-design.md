# CPA Policy A 100% Compliance — Design

**Date:** 2026-05-09
**Author:** owner + Claude
**Status:** Design — pending approval
**Source-of-truth:** 3 CPA documents
- `สรุปการบันทึกรับชำระค่างวด.csv` (Policy A + ECL v3.0)
- `Handover_BestChoiceFinance v3.0.pdf`
- `termination_policy.pdf` (Manual Termination)

**Supersedes:** Wave 2 T3 JP4 logic (ม.79+86/10) — wrong direction per Policy A

---

## 1. Purpose

แก้ระบบ accounting ให้ตรงกับ CPA spec **100%** หลัง audit รอบ 2 พบ 9 errors ที่ implementation ปัจจุบัน (PR #780 merged) ไม่ตรงกับเอกสาร CPA ที่เพิ่งส่งมา.

**Non-goals:** Section 7 Gaps ที่เป็น expense module (payroll, ภ.พ.36, refund) — แยก track ไป รายจ่าย session

## 2. Errors ที่ต้องแก้

| # | Error | Severity | Files affected |
|---|-------|----------|----------------|
| 1 | JP4 Policy A — VAT ไม่ลดตามส่วนลด | 🔴 Critical (in prod) | `early-payoff-jp4.template.ts` + spec + CSV-4 |
| 2 | ECL bucket rates ผิด (10/25/50/75/100% → 15/50/75/100%) | 🔴 Critical (in prod) | `bad-debt.service.ts` constants |
| 3 | Manual Termination workflow ขาด | 🔴 Critical (gap) | NEW module `termination/` + new table |
| 4 | VAT 60-day trigger: calendar → consecutive_missed=2 | 🟡 Warning | `vat-60day.cron.ts` + service |
| 5 | Late Fee auto in 2B | 🟡 Warning | `payment-receipt-2b.template.ts` |
| 6 | ECL Stage Reverse | 🟡 Warning | NEW template + cron |
| 7 | Receipt RT-YYYYMM-NNNNN | 🟡 Warning | `receipts.service.ts` |
| 8 | Partial Receipt Policy | 🟡 Warning | `receipts.service.ts` + 2B-split |
| 9 | Postpone (ปรับดิว) flow alignment | 🟢 Info | `reschedule.service.ts` |

## 3. Architecture

### 3.1 Manual Termination Flow (NEW — Critical)

**Status enum:**
```
contract.status: ACTIVE → TERMINATED → WRITTEN_OFF (terminal)
```

**Pre-condition for JP5:**
```
status === 'TERMINATED' ELSE throw "Must terminate via formal letter first"
```

**New flow:**
```
1. ECL cron detects 60d → Alert event (NOT auto-terminate)
2. Manager reviews → Decision Memo + Approval
3. Generate หนังสือบอกเลิก PDF (ตาม ปพพ.386)
4. Send via ไปรษณีย์ลงทะเบียน → Tracking Number
5. POST /api/termination/mark-as-sent → status: TERMINATED
   - Stop 2A cron for this contract
   - Continue ECL provision cron
   - Block disbursement
   - audit_log: TERMINATION_SENT
6. Wait reply window (e.g. 7 days)
7. If no reply → POST /api/jp5 → ยึดเครื่อง
```

**New table:**
```prisma
model TerminationTracker {
  id                String   @id @default(uuid())
  contractId        String
  contract          Contract @relation(...)
  alertGeneratedAt  DateTime  // when 60d trigger fired
  sentAt            DateTime?  // when หนังสือบอกเลิก sent
  letterPdfUrl      String?
  trackingNumber    String?
  reason            String   // "60d overdue", "voluntary return", etc.
  approverId        String   // Manager/CFO/Owner depending on age
  approverLevel     String   // L1, L2, L3
  approvedAt        DateTime?
  customerReplyAt   DateTime?
  customerReply     String?  // e.g. "promised to pay", "no reply", etc.
  jp5At             DateTime?  // when JP5 executed
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  deletedAt         DateTime?
}
```

**Decision Framework:**
- L1 (60-90d): Manager only
- L2 (90-120d): Manager + CFO
- L3 (>120d): Owner only

### 3.2 JP4 Policy A (Revert Wave 2 T3)

**Wrong (current):**
```
Cr 21-2101 = remainingDeferredVat - vatOnDiscount  (reduced)
cash = remainingGross - discount + (remainingDeferredVat - vatOnDiscount)
```

**Right (CPA Policy A):**
```
Cr 21-2101 = remainingDeferredVat  (full, NOT reduced)
cash = remainingGross - discount + remainingDeferredVat
NO Dr 51-1105 vatOnDiscount
NO Credit Note for VAT (intentional choice — CPA)
```

**Documentation:** "บริษัทเลือก Policy A vs ม.79+86/10" — choice noted

### 3.3 ECL v3.0 — 6 Buckets

**Current (wrong):**
```
1-30: 2%, 31-60: 10%, 61-90: 25%, 91-180: 50%, 181-360: 75%, 360+: 100%
```

**Right (CPA NPAEs Ch.13):**
```
B0: 0 days = 0%, ACTIVE
B1: 1-30 = 2%, ACTIVE
B2: 31-60 = 15%, ACTIVE (alert trigger 60d)
B3: 61-90 = 50%, TERMINATED (stop 2A)
B4: 91-180 = 75%, TERMINATED
B5: >180 = 100%, TERMINATED (NPL)
```

**Calculation source:** จาก `11-2103` (ลูกหนี้ค้างชำระ) เท่านั้น — ไม่ใช่ Net Exposure ทั้งสัญญา

**Verify in current bad-debt.service.ts:** ต้องตรวจว่าใช้ 11-2103 หรือไม่

### 3.4 VAT 60-day Trigger

**Current:** calendar 60 days from due_date
**Right:** `consecutive_missed >= 2` (= 2 งวดติดต่อกัน)

**Logic in cron:**
```typescript
const installments = await prisma.installmentSchedule.findMany({
  where: {
    consecutive_missed: { gte: 2 },
    vat60dayJournalEntryId: null,
    deletedAt: null,
  },
});
```

**1× per งวด** (already correct after Wave 2 T1)

### 3.5 Late Fee in 2B (NEW)

**Logic:**
```typescript
function calcLateFee(overdue_days: number): number {
  if (overdue_days == 0) return 0;
  if (overdue_days < 3) return 50;
  return 100;  // >= 3 days
}
```

**JE addition (per CSV case 6):**
```
Dr cash (amount + late_fee)
Cr 11-2103 amount
Cr 42-1103 late_fee  (รายได้ค่าปรับ)
```

**42-1103 already in COA** — no migration needed

### 3.6 ECL Stage Reverse (NEW)

**Trigger:** When customer pays after ECL provision raised the stage

**JE pattern:**
```
Stage drops B2 → B1: reverse provision delta
  Dr 11-2102 (consume Contra Asset)
  Cr 51-1103 (reverse provision expense)

If B2 with VAT 60d active → also reverse:
  Dr 21-2103 / Cr 11-2104 (reverse VAT mandatory)
  Dr 21-2103 / Cr 51-1105 (VAT recovered)
```

**Trigger:** PaymentReceipt2B post-hook checks if stage dropped

### 3.7 Receipt Module Updates

**Format:** `RT-YYYYMM-NNNNN` (per-month sequence with advisory lock)

**Schema:**
```prisma
model Receipt {
  // existing
  paymentStatus            String   // PARTIAL | PAID
  installmentPartialSeq    Int?     // 1, 2, 3 ... for partial receipts
  remainingAmount          Decimal? @db.Decimal(12, 2)  // installment balance after this receipt
}
```

**Partial Receipt Policy:**
- ออกใบเสร็จทุกครั้งที่รับเงิน (แม้ 11-2103 ยังไม่เป็น 0)
- payment_status = PARTIAL จนกว่าจะครบงวด (= PAID)
- Receipt text: "ชำระบางส่วน งวดที่ N — ครั้งที่ X" + ยอดค้างที่เหลือ

### 3.8 Postpone (ปรับดิว) Flow Alignment

**Current:** Reschedule shifts due_dates, fee in last installment

**CPA spec:**
```
ตอนปรับดิว:
  Dr cash (ค่างวด + ค่าปรับดิว)
  Cr 11-2103 (งวดนี้)
  Cr 21-1103 (ค่าปรับดิว — park)

ในงวดสุดท้าย:
  Dr 21-1103 (ล้าง park)
  Dr cash (ส่วนที่เหลือ)
  Cr 11-2103
```

**ค่าปรับดิว formula:** `installment_amount ÷ 30 × days_to_shift` (ROUND_DOWN)

**Verify:** ปัจจุบัน `RescheduleService` ทำตามนี้หรือไม่ — ถ้าไม่ ต้องปรับ

## 4. Implementation Plan — 5 PRs

### PR-1: Critical Hot Fix (1 day, ~5 commits)
**Branch:** `fix/cpa-policy-a-hot-fix`
- Revert JP4 Wave 2 T3 (Cr 21-2101 = full)
- Fix ECL bucket rates (B1:2/B2:15/B3:50/B4:75/B5:100)
- Update CSV case-4-early-payoff.csv (Cr 21-2101=595.02)
- Update JP4 spec assertions
- Update audit-report.html (note Policy A reverted)

### PR-2: Manual Termination Module (2-3 days, ~10 commits)
**Branch:** `feat/manual-termination-workflow`
- Schema: TerminationTracker model + migration
- Service: TerminationService (createAlert, markAsSent, getTracker, approve)
- Controller: POST /api/termination/* (4 endpoints)
- 2A cron: filter status='ACTIVE' (skip TERMINATED)
- JP5 pre-condition: throw if status !== 'TERMINATED'
- Letter PDF generation (Puppeteer template, ปพพ.386 format)
- 3-tier approval guard (RolesGuard + age check)
- audit_log: TERMINATION_ALERT, TERMINATION_SENT, TERMINATION_APPROVED
- Tests + spec

### PR-3: Late Fee + 2B Auto Cases (1 day, ~5 commits)
**Branch:** `feat/late-fee-and-2b-cases`
- Late fee calc helper
- 2B template: auto-add Cr 42-1103 if overdue_days > 0
- Postpone case in 2B (ปรับดิว — Cr 21-1103 park)
- Hold case (เกิน >1฿ → 21-1103) — verify already correct
- Tests

### PR-4: Receipt Module (1 day, ~5 commits)
**Branch:** `feat/receipt-rt-format-and-partial`
- Schema: Receipt fields (paymentStatus, installmentPartialSeq, remainingAmount)
- Receipt service: RT-YYYYMM-NNNNN with advisory lock
- 2B-split: issue receipt every payment (not just final)
- Receipt PDF: show PARTIAL status + ยอดค้าง
- Tests

### PR-5: ECL Stage Reverse (1 day, ~5 commits)
**Branch:** `feat/ecl-stage-reverse`
- ECL config table (configurable rates per UI)
- ecl-stage-reverse.template.ts
- 2B post-hook: detect stage drop → trigger reverse
- VAT 60d reverse (already partial — complete it)
- Tests

## 5. Coordination with รายจ่าย Session

**Their Track B (Section 7 expense gaps):**
- Write-off จริง (ตัดหนี้สูญ — different from ECL 100%)
- Bad Debt Recovery (customer pays after write-off → Cr 41-1101)
- Refund flow (Overpaid >1฿ → return cash, not park)
- Payroll (53-1101/53-1102/21-3101)
- ภ.พ.36 (21-2104/55-1102)
- Disallowed expense (54-XXXX)

**Shared accounts (must coordinate):**
- 51-1102 (หนี้สูญ) — เราใน JP5, รายจ่าย ใน Write-off
  → audit metadata: `flow: 'JP5'` vs `flow: 'WRITEOFF'`
- 51-1103 (ECL Provision) — เราใน Bad Debt cron + Stage Reverse, รายจ่าย ใน Reverse Stage (overlap → เราเอง)
- 51-1105 (VAT กลับ) — เราใน VAT 60d Reverse, รายจ่าย — none
- 11-2102 (ค่าเผื่อ) — เราใน JP5 Consume + Stage Reverse, รายจ่าย — none

**Files NOT to be touched by รายจ่าย session:**
- `bad-debt.service.ts`
- `cpa-templates/bad-debt-*.ts`
- `cpa-templates/vat-60day-*.ts`
- `cpa-templates/repossession-jp5.template.ts`

**Coordination via:**
- Different branch names (no overlap)
- Different new template files
- Merge order: whoever finishes first → other rebases

## 6. Schema Migrations

**New table:** `termination_tracker`
**New columns:**
- `Receipt.paymentStatus` (string)
- `Receipt.installmentPartialSeq` (int)
- `Receipt.remainingAmount` (Decimal)
- `Contract.status` enum extend if needed (verify TERMINATED already exists)

**No data backfill required** — all existing contracts ACTIVE

## 7. Testing Strategy

**Unit tests:** Each PR adds spec files for new logic
**Integration tests:** Full lifecycle (Activate → 2A × N → Late Fee → Termination → JP5)
**CSV golden:** Update case-4 (revert Policy A) + new case-6 (Postpone) + case-9 (Termination)

## 8. Rollout Order

1. PR-1 (hot fix) → merge ASAP — fixes prod bugs
2. PR-2 (Termination) → merge after PR-1
3. PR-3 (Late Fee) → can be parallel with PR-2
4. PR-4 (Receipts) → can be parallel
5. PR-5 (ECL Reverse) → after PR-2 (depends on TERMINATED status)

## 9. Open Questions (None — locked per CPA documents)

- Policy A: VAT ไม่ลด — locked by CPA
- ECL rates: 0/2/15/50/75/100 — locked
- Late fee 50/100 — locked
- Manual termination — locked

## 10. Approval

Ready for implementation.
