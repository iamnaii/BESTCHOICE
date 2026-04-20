# BESTCHOICE — Customer Intake & Credit Check Redesign

**Date:** 2026-04-20
**Status:** Draft — pending owner review
**Scope:** Frontend flow + thin backend additions. No schema breaking changes.

## 1. Problem

ปัจจุบันการรับลูกค้าใหม่ที่จะผ่อนในระบบ (ไฟแนนซ์เรา) ต้องเดินผ่าน **3 หน้า + 2 modals**:

1. `/customers` (list) → คลิก "+ เพิ่มลูกค้า" → CustomerCreateModal (20+ fields)
2. `/customers/:id?tab=credit` → คลิก "+ ตรวจเครดิตใหม่" → CreditCheckCreateModal (640 LOC, OCR × 3, scroll ยาว)
3. `/contracts/create` → step 1-3 → กลับไปเช็คว่า credit approved → สร้างสัญญา

**จุดเจ็บ:**
- Sales สลับหน้าบ่อย, จำ path ไม่ไหว
- Modal ซ้อน modal ทำให้รู้สึก UI รก
- กรอกข้อมูลครบก่อนเช็คเครดิต = **เสียเวลา 10+ นาที** กับลูกค้าที่ไม่ผ่าน
- ไม่มี differentiation ระหว่างลูกค้าใหม่กับลูกค้าเก่าที่มี history ดี — ทุกคนต้องผ่าน flow เดียวกัน
- POS flow (เงินสด/ไฟแนนซ์นอก) กับ installment flow แยกกันชัดเจน แต่ share intake ส่วนหน้าได้

## 2. Goals

- ลด click path สำหรับ happy path ของแต่ละประเภท sales (CASH / EXTERNAL / INSTALLMENT)
- **Pre-check** ก่อน full intake — ถ้าไม่ผ่านลูกค้าไม่ต้องกรอก 10 นาทีก่อน
- **Tier-based routing** — reward ลูกค้าเก่าจ่ายดี, ลด friction สำหรับ returnees
- **Statement-first intake** — บังคับ upload statement ตอน quick intake เพื่อ AI pre-check ได้ทันที
- รักษา data resumability (draft save) และ ข้อมูลที่กรอกไม่หายระหว่าง step

## 3. Non-goals

- ไม่ refactor หน้า POS ตอนนี้ (reuse เดิมไปก่อน — optional enhancement ภายหลัง)
- ไม่เปลี่ยน backend endpoints ที่มีอยู่ (/customers, /customers/:id/credit-check)
- ไม่แก้ schema เพิ่มตารางใหม่ — tier compute จาก data ปัจจุบัน
- ไม่เพิ่มฟีเจอร์ใหม่ของ OCR (ใช้ book-bank / salary-slip / bank-statement เดิม)
- ไม่ deal กับ blacklist external (ใช้ internal criteria เท่านั้น)

## 4. Users & Paths

### Sales (พนักงานขาย)
- Walk-in: ลูกค้าเข้ามายังไม่ตัดสินใจ → sales ต้องเริ่มจาก entry point ที่เลือกได้
- Pre-scheduled installment: ลูกค้านัดมาผ่อน → ไปตรง "สร้างสัญญาผ่อน"
- POS: ลูกค้าเงินสด/ไฟแนนซ์นอก → ไปตรง POS

### Branch Manager
- รีวิว credit checks ที่ Tier 4 (RISKY) หรือ manual review
- Override tier decision ได้ (log)

## 5. Architecture Overview

### Entry Points
| ปุ่มเข้า | Path | เริ่มที่ไหน |
|---|---|---|
| **"ขายของ (POS)"** (เดิม) | `/pos` | Quick Intake (minimal) → POS checkout |
| **"สร้างสัญญาผ่อน"** (เดิม) | `/contracts/create` | Customer Intake Wizard (new) → Contract Create |
| **"ลูกค้า"** (list) | `/customers` | View/edit existing customer + "สร้างสัญญาใหม่" button (ผ่าน existing customer) |

### Customer Tiers (computed from existing history, not stored)

```typescript
function getCustomerTier(history: CustomerHistory): CustomerTier {
  if (history.hasBadDebt || history.hasRepossession) return 'BLACKLIST';
  if (history.maxOverdueDays > 30) return 'RISKY';
  if (history.closedContracts >= 2 && history.onTimePaymentPct === 100) return 'GOLD';
  if (history.onTimePaymentPct >= 90 && history.closedContracts >= 1) return 'GOOD';
  return 'NEW';
}
```

### Installment Intake Flow (ไฟแนนซ์เรา)

```
[Entry: "สร้างสัญญาผ่อน"]
     ↓
┌─ STEP 1: Quick Intake (30-60 วิ) ──────────────┐
│  • Scan บัตรประชาชน (smart card reader / OCR) │
│    → prefill: ชื่อ, เลขบัตร, วันเกิด, ที่อยู่ทะเบียน │
│  • เบอร์โทร (กรอก)                            │
│  • Statement 3 เดือน (upload — บังคับ*)        │
│    * fallback: บันทึก draft, upload ภายหลัง   │
│  • ปุ่ม "เช็คเครดิตเบื้องต้น" (เดียว)          │
└────────────────────────────────────────────────┘
     ↓
┌─ STEP 2: Pre-check Gate (auto, 10-30 วิ) ──────┐
│  1. ค้น existing customer จาก nationalId       │
│     → found: compute tier, route ตามนั้น       │
│  2. Run internal checks:                       │
│     • blacklist (bad debt, repo)               │
│     • existing active contracts + overdue      │
│     • phone/nationalId duplicate               │
│  3. AI-lite analyze statement (Tier 3/4)       │
│     → score, confidence                        │
│  4. Output: Tier + Decision                    │
│     PASS / FAIL / REVIEW                       │
└────────────────────────────────────────────────┘
     ↓
┌─ STEP 3: Tier Routing ─────────────────────────┐
│ GOLD      → Skip to Step 5 (ยืนยันข้อมูลเดิม)  │
│ GOOD      → Step 4 (pre-filled form)           │
│ NEW       → Step 4 (empty form)                │
│ RISKY     → Step 4 + manager review queue      │
│ BLACKLIST → Reject, show reason                │
│              (manager override → Step 4)       │
└────────────────────────────────────────────────┘
     ↓
┌─ STEP 4: Full Intake (เฉพาะที่ผ่าน gate) ──────┐
│  • ที่อยู่ ปัจจุบัน + ที่ทำงาน (structured)     │
│  • อาชีพ + รายได้ + สถานที่ทำงาน               │
│  • Reference persons (4 คน — เบอร์, relation) │
│  • เอกสารเพิ่ม: KYC selfie, ID card back       │
│  • Auto-save draft ทุก 30 วิ                  │
└────────────────────────────────────────────────┘
     ↓
┌─ STEP 5: Contract Create ──────────────────────┐
│  เลือกสินค้า → แผนผ่อน → ยืนยัน → สร้าง       │
│  (ใช้ ContractCreatePage เดิม 3 steps หลัง    │
│   PR#606 refactor)                             │
└────────────────────────────────────────────────┘
```

### POS Flow (เงินสด / ไฟแนนซ์นอก)

ไม่เปลี่ยน flow หลัก — ใช้ minimal Quick Intake modal ใน POS เดิม:
- ถ้าไม่มีลูกค้าในระบบ → scan บัตร + เบอร์ → save customer (no statement, no credit check)
- ถ้ามีลูกค้าแล้ว → ค้น/เลือก → checkout

## 6. Data Model

### Existing (ใช้ได้เลย)
- `Customer` — มีทุก field แล้ว
- `CreditCheck` — มี aiScore, aiAnalysis, statementFiles, status
- `Contract` / `Payment` / `BadDebt` / `Repossession` — สำหรับ compute tier

### New (minimal additions)

#### Field on `Customer` (optional)
```prisma
creditCheckStatus  CustomerCreditCheckStatus  @default(NONE)
// NONE | PRE_CHECK_PASSED | FULL_CHECK_PASSED | REJECTED | UNDER_REVIEW
```
Rationale: ใช้ gate รู้ว่า customer ถึง step ไหนแล้ว, resume draft ได้

#### Field on `CreditCheck` (optional)
```prisma
checkType  CreditCheckType  @default(FULL)
// PRE | FULL
```
Rationale: ต้องการแยก pre-check AI analysis กับ full check (pre-check ใช้ statement อย่างเดียว, full ใช้ statement + manual review)

#### Enum
```prisma
enum CustomerCreditCheckStatus {
  NONE
  PRE_CHECK_PASSED
  FULL_CHECK_PASSED
  REJECTED
  UNDER_REVIEW
}

enum CreditCheckType {
  PRE
  FULL
}
```

### Computed (no storage)
- `CustomerTier` — compute on-the-fly ใน service (cached 5 min)
- `maxOverdueDays` — compute จาก Payment.dueDate vs paidAt
- `hasBadDebt`, `hasRepossession` — exists queries

## 7. Components (Frontend)

### New
| Component | Purpose |
|---|---|
| `CustomerIntakeWizard.tsx` | Top-level wizard orchestrator (3-5 steps) |
| `QuickIntakeStep.tsx` | Step 1: scan + contact + statement |
| `PreCheckResultStep.tsx` | Step 2-3: show tier + pre-check result + route |
| `FullIntakeStep.tsx` | Step 4: structured full form (extract from CustomerCreateModal) |
| `CustomerTierBadge.tsx` | Small badge (GOLD/GOOD/NEW/RISKY/BLACKLIST) |
| `CustomerHistoryCard.tsx` | Summary for returning customers (ทั้งหมด/ปิด/on-time/current) |
| `useCustomerIntake.ts` | Hook: wizard state, draft save/load, mutations |

### Modified
| Component | Change |
|---|---|
| `ContractCreatePage` | Prepend Customer Intake Wizard before step 0 (product select) |
| `CustomerDetailPage` (credit tab) | Show tier badge + status, keep existing creation dialog (no change) |
| `CustomersPage` | Add tier column, sort/filter by tier |
| `POSPage` (add customer modal) | Use lightweight version of QuickIntakeStep (no statement) |

### Removed / Deprecated
- None — existing `CustomerCreateModal` from ContractCreatePage + `CreditCheckCreateModal` components are reused internally by the new wizard

## 8. Backend Additions

### New endpoints
```
GET  /customers/:id/tier
     → { tier: 'GOLD' | ..., history: { ... }, reasons: string[] }

POST /customers/pre-check
     body: { nationalId, phone, statementFiles?, bankName? }
     → {
         customerId,              // existing or newly-created
         tier: CustomerTier,
         decision: 'PASS' | 'FAIL' | 'REVIEW',
         reasons: string[],
         aiScore?: number,
         creditCheckId?: string   // if full statement provided
       }
```

### Modified
- `POST /customers/:id/credit-check` — accept `checkType: 'PRE' | 'FULL'`
- `customerHistory` query — add `maxOverdueDays`, `hasBadDebt`, `hasRepossession`

### Caching
- Tier compute cached 5 min per customer (invalidate on new Payment/Contract/Bad debt insert)

## 9. UX Details

- **Wizard progress bar** top of page — step X of Y, click-to-jump backward ok
- **Auto-save draft** every 30 วิ (ใช้ useDraftStorage เดิม)
- **Tier badge colors** (Tailwind tokens):
  - GOLD: `bg-amber-500/15 text-amber-600` 🥇
  - GOOD: `bg-success/10 text-success` ✓
  - NEW: `bg-muted text-muted-foreground`
  - RISKY: `bg-warning/10 text-warning` ⚠
  - BLACKLIST: `bg-destructive/10 text-destructive` ✗
- **Returning customer welcome** — big card on Step 2 showing ประวัติ + tier
- **Fallback for unavailable statement** — button "ยังไม่มี statement — บันทึกไว้ก่อน" saves draft with status `PENDING_STATEMENT`, resumable later
- **Mobile-friendly tablets** — intake wizard designed for landscape tablet (common at counter)
- **"ลืมเลขบัตร" path** — manual input with validate 13-digit check digit

## 10. Error Handling / Edge Cases

- **Scan failed** → fall back to manual input, keep everything else
- **Statement OCR failed or low confidence** → retry button + manual entry fields
- **Pre-check timeout (> 90 วิ)** → show "ยังประมวลผลอยู่, กลับมาดูผลที่หน้าลูกค้า" + save draft
- **Duplicate nationalId** → show existing customer card, offer to use that record or cancel
- **Network failure mid-wizard** → draft auto-saved, resume on next visit
- **Customer decides mid-flow to switch to POS instead** → "เปลี่ยนเป็นขายเงินสด/ไฟแนนซ์นอก" button → save customer data, redirect to POS with this customer preselected
- **Pre-check passes but customer abandons before full intake** → customer row shows tier + status, sales can continue next visit

## 11. Success Metrics

- **Time-to-credit-decision**: walk-in → approved status. Target **< 5 นาที** (ปัจจุบัน ~10-15 นาที รวม full form + analyze)
- **Abandonment rate mid-flow**: target **< 10%** (measure: started wizard, didn't finish within 24 hr)
- **Failed full-forms (customer rejected but filled all)**: target **0%** — pre-check gate ต้อง filter ก่อน
- **Returning customer convenience**: GOLD/GOOD customers → fewer clicks than current flow
- **Credit accuracy**: Pre-check score correlate with Full check score (> 80% agreement on PASS/FAIL boundary)

## 12. Phased Delivery

### Phase 1 — Foundation (Data + Tier)
- Add `CustomerCreditCheckStatus` enum + field on Customer
- Add `CreditCheckType` enum + field on CreditCheck
- Service: `computeCustomerTier` + `customerHistory` extended
- `GET /customers/:id/tier` endpoint
- Frontend: `CustomerTierBadge` + show on CustomersPage list + CustomerDetailPage header

### Phase 2 — Pre-check Gate
- `POST /customers/pre-check` endpoint
- AI-lite threshold config (settings page — tune later)
- Frontend: `PreCheckResultStep` component + `useCustomerIntake` hook
- Tests: pre-check logic (blacklist, duplicate, tier routing)

### Phase 3 — Intake Wizard
- `CustomerIntakeWizard` top-level + `QuickIntakeStep` + `FullIntakeStep`
- Extract existing `CustomerCreateModal` form → reusable `FullIntakeStep`
- Extract OCR flow → `useCustomerOcr` hook
- Wire up `/contracts/create` to render wizard before product select

### Phase 4 — Integration + Polish
- Route returning customer detection → skip/relax path
- Manager review queue (use existing notifications + new page tab)
- Draft resume UX + indicator
- Remove old customer creation modal in `/customers` list (replace with wizard link)
- E2E tests: walk-in → pre-check → full → contract

## 13. Open Questions / Decisions Needed

1. **Pre-check AI threshold** — ค่าเริ่มต้น score ≥ 50 (tunable ที่ settings)?
2. **Statement เดือนล่าสุด วันที่อะไร** — อนุญาต statement เก่าสุดกี่วัน? (แนะนำ 60 วัน)
3. **Tier thresholds** — ควรให้เจ้าของปรับได้ใน settings หรือ hardcode?
4. **Manager review queue** — แยก page ใหม่ หรือรวมใน `/customers` ด้วย filter?
5. **เส้นแบ่ง Tier GOOD → NEW** — ปัจจุบันใช้ closedContracts ≥ 1. ถ้าลูกค้ามี active contract ยังไม่ปิดแต่จ่ายตรงเวลา เอามานับไหม?
6. **Pre-check retry cost** — ถ้า sales พยายาม pre-check ซ้ำกับลูกค้าคนเดิมภายใน 1 ชั่วโมง จะเก็บผลเดิมหรือรันใหม่? (แนะนำ cache 1 ชั่วโมง)

## 14. Risks

- **OCR accuracy** on statement — ถ้า AI pre-check ผิดบ่อย จะทำให้ชั้น tier ไม่ถูกต้อง → mitigate ด้วยการใช้ statement AI เป็น _input_ ให้ manager decision, ไม่ใช่ auto-reject
- **Tier computation performance** — ถ้าลูกค้าเยอะและ query ไม่ index, slow. แก้ด้วย cache 5 นาที + ensure indexes
- **Data migration** — ลูกค้าเก่าทั้งหมด default `creditCheckStatus = NONE`, สัญญาเก่าจะ "ปิด" แต่ status ไม่ match. Mitigate ด้วย backfill script ที่ infer status จาก contracts + credit checks ที่มี
- **UX regression for sales ที่คุ้นชิน flow เก่า** — train + overlay tutorial bubble + link "วิธีใช้แบบเดิม" (กลับเป็น modal-based) ระหว่างช่วง transition

## 15. Implementation Notes

- Reuse `useDraftStorage` for wizard draft
- Reuse `CreditCheckCreateDialog` components from `components/credit-check/` (PR #607 merged already)
- Frontend state: React Query for server data + small Zustand store for wizard navigation
- Form validation: react-hook-form + zod (per existing pattern in Phase 4 hardening)
- Thai label convention consistent with existing pages
- All destructive actions via `ConfirmDialog`
