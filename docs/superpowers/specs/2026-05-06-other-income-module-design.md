# Other Income Module — Design

**Date:** 2026-05-06
**Status:** Draft (awaiting owner review)
**Owner:** iamnaii (akenarin.ak@gmail.com)
**Branch:** `feat/other-income-module` (proposed)

---

## 1. Context & Problem

ระบบ BESTCHOICE มี Phase A.4 (TFRS for NPAEs) — chart 99 บัญชี, 10 JE templates, daily/monthly cron auto-post. ทุกรายได้หลัก (HP installment, repossession, early payoff) ลง JE อัตโนมัติแล้ว

แต่ **รายได้กลุ่ม 42-XXXX (Other Income)** ยังไม่มี input path ที่ชัดเจน — บัญชีต้องบันทึกเองผ่านนักบัญชีนอก หรือเขียนกระดาษ

| Account | ประเภท | Frequency | สถานะตอนนี้ |
|---|---|---|---|
| 42-1102 ดอกเบี้ยเงินฝาก | bank statement KBank/SCB | ทุกเดือน | ❌ ไม่ได้ลง |
| 42-1103 ค่าปรับชำระล่าช้า | จากค่างวด late | ทุกครั้งที่ลูกค้าจ่าย | ✅ auto-post via `PaymentReceipt2BTemplate` |
| 42-1104 รายได้หักค่าจ้าง | หักเงินเดือนพนักงาน | นาน ๆ ที | ❌ ไม่มี (deferred) |
| 42-1105 กำไรขายสินทรัพย์ | ขายโต๊ะ/รถ | นาน ๆ ที | ❌ ไม่ได้ลง |
| อื่น ๆ | คืนภาษี, indemnity, etc. | เผื่อใช้ | ❌ ไม่มี |

**ผลลัพธ์ที่ต้องการ:** มีหน้าให้บัญชีบันทึก 42-XXXX ลง JE จริงในระบบ ไม่ต้องเขียนกระดาษ — ครบ TB

## 2. Scope

### 2.1 In-scope (v1)
- บันทึกเอกสาร Other Income — รองรับทุก 42-XXXX ที่อยู่ใน `ChartOfAccount` (ไม่ใช่แค่ 4 บัญชีฮาร์ดโค้ด — flexible by CoA)
- Multi-line items per document (1 เอกสารมีหลาย 42-XXXX ได้)
- Auto Journal generator (Pattern A: Standard income) + manual override
- Multi-line Adjustment สำหรับผลต่าง amount_received vs net (เช่น ธนาคารหักค่าธรรมเนียม)
- Reverse Entry — สลับ Dr↔Cr + ตามรอย via `JournalService.void()` pattern
- Daily Sheet report (สรุปรายวัน + Export CSV)
- A4 Receipt printing (เฉพาะกรณีที่มี customer)
- Period close validation (V8) — ใช้ `validatePeriodOpen()` util ที่มีอยู่
- Soft delete (DRAFT only — POSTED ลบไม่ได้)

### 2.2 Out of scope (deferred)
- ❌ **42-1103 ค่าปรับ** — มี auto-post แล้ว ไม่ต้องบันทึกซ้ำ (UI block ถ้าผู้ใช้เลือก 42-1103 → guide ไป Payment receipt)
- ❌ **Pattern B (Payroll 42-1104)** — ต้องคู่กับ payroll module ซึ่งยังไม่มี (`OUT_OF_SCOPE`: skip จนกว่ามี payroll module)
- ❌ **e-Tax Invoice / e-WHT** — Phase A.5+ (มี ETDA integration ทั้งระบบทีหลัง)
- ❌ **LIFF / public access** — เครื่องมือบัญชีภายในเท่านั้น
- ❌ **Multi-company** — single-entity เหมือนทุก module ปัจจุบัน
- ❌ **Settings page (5 tabs)** — Period close UI ทำใน module นี้แค่ 1 tab; tab อื่น (Company, VAT, Users) ใช้ของที่มีในระบบเดิม

### 2.3 Reuse from existing BESTCHOICE infrastructure

| Capability | Existing | How we use |
|---|---|---|
| Auth + RBAC | `JwtAuthGuard` + `RolesGuard` + `User.role` | `@Roles('OWNER', 'ACCOUNTANT', 'FINANCE_MANAGER')` |
| Customer | `Customer` model | optional FK (`customerId`) |
| Chart of Accounts | `ChartOfAccount` (99 FINANCE accounts) | filter `code LIKE '42-%'` for income picker |
| CoA hooks | `useCoaGroups({ type: 'รายได้' })` | dropdown 42-XXXX ที่ frontend |
| Journal | `JournalEntry` + `JournalLine` + `JournalService.create/post/void` | สร้าง JE + reverse |
| Period close | `AccountingPeriod` + `validatePeriodOpen()` | V8 validation |
| Audit log | `AuditLog` + `AuditInterceptor` | auto-capture all mutations |
| Form pattern | `ExpensesPage.tsx` + `accounting.service.ts` | mirror 1:1 |
| Toast/notif | `sonner` `toast.success/error` | inline feedback |

## 3. Architecture

### 3.1 Backend

NestJS module mirror `apps/api/src/modules/accounting/` (Expenses pattern):

```
apps/api/src/modules/other-income/
├── other-income.module.ts
├── other-income.controller.ts        # @Roles + @UseGuards
├── other-income.service.ts           # CRUD + post + reverse
├── auto-journal.service.ts           # Pattern A generator (testable separately)
├── validation.service.ts             # V1-V14 engine
├── dto/
│   ├── create-other-income.dto.ts
│   ├── update-other-income.dto.ts
│   ├── post-other-income.dto.ts
│   └── reverse-other-income.dto.ts
└── __tests__/
    ├── other-income.service.spec.ts  # CRUD + workflow
    ├── auto-journal.spec.ts          # Pattern A + adjustments
    └── validation.spec.ts            # V1-V14
```

### 3.2 Frontend

Pages mirror `apps/web/src/pages/ExpensesPage.tsx`:

```
apps/web/src/pages/other-income/
├── OtherIncomeListPage.tsx           # /other-income
├── OtherIncomeEntryPage.tsx          # /other-income/new, /other-income/:id/edit
├── OtherIncomeViewPage.tsx           # /other-income/:id
├── OtherIncomeReceiptPage.tsx        # /other-income/:id/receipt (A4)
└── OtherIncomeDailySheetPage.tsx     # /other-income/daily-sheet?date=...
```

**Components ที่ reuse จาก codebase:**
- `PageHeader` (breadcrumb + actions)
- `QueryBoundary` (error+retry)
- `ConfirmDialog` (replace `confirm()`)
- `useDebounce` hook (search)

**Components ที่สร้างใหม่ (in this module):**
- `ItemsTable` — รายการ 42-XXXX ในเอกสาร (rows = items)
- `AdjustmentTable` — multi-line ผลต่าง (V12-V14)
- `AutoJournalPreview` — read-only Dr/Cr + override toggle
- `AccountSearchDropdown` — for adjustment account picker
- `PaymentCompareCard` — diff indicator (✓ตรง / ⚠ขาด / ↑เกิน)
- `ReverseModal` — 6 reasons + textarea

### 3.3 Data flow

```
[User submits "Save & Post"]
  ↓
Controller: POST /other-income/:id/post
  ↓
Service.post(id, userId, ipAddress)
  ↓
  1. Load OtherIncome + items + adjustments
  2. ValidationService.validate(doc) → V1-V14
     ↓ (any ERROR) → throw BadRequestException with errors[]
  3. Prisma.$transaction:
     a. AutoJournalService.generate(doc) → JournalLineInput[]
     b. JournalService.createAndPost({ tx, ... })  // see note below
     c. Update OtherIncome: status POSTED, journalEntryId, postedAt, receiptNo
     d. AuditInterceptor logs POSTED event
  4. Return { docNo, journalEntryId, receiptNo, postedAt }
```

**Transaction note:** `JournalService.create/post` in `apps/api/src/modules/journal/journal.service.ts` already accepts an external `tx: Prisma.TransactionClient` arg (used by other A.4 callers). If a unified `createAndPost(tx, input)` helper doesn't exist yet, add it as part of this PR (one wrapper, ~10 LOC) — do NOT inline `create()`+`post()` separately, since `post()` requires the JE to exist and committed.

## 4. Data Model

### 4.1 New Prisma models (3)

```prisma
enum OtherIncomeStatus {
  DRAFT
  POSTED
  REVERSED
}

enum OtherIncomePriceType {
  EXCLUSIVE
  INCLUSIVE
}

model OtherIncome {
  id              String    @id @default(uuid())
  docNumber       String    @unique                    // "OI-26050001"
  status          OtherIncomeStatus @default(DRAFT)

  // Header
  issueDate       DateTime
  dueDate         DateTime?
  paymentDate     DateTime?
  priceType       OtherIncomePriceType @default(EXCLUSIVE)

  // Counterparty (optional — ดอกเบี้ยฝากไม่มี Customer record)
  customerId      String?
  customer        Customer? @relation(fields: [customerId], references: [id])
  counterpartyName     String?    // free-text fallback (e.g., "ธนาคาร KBank")
  counterpartyTaxId    String?
  counterpartyAddress  String?
  counterpartyPhone    String?

  // Payment
  paymentAccountCode String                              // 11-1101..11-1203
  amountReceived     Decimal @db.Decimal(15, 2)

  // Computed totals (cached at post-time for reports)
  incomeGross     Decimal @db.Decimal(15, 2)
  vatAmount       Decimal @db.Decimal(15, 2) @default(0)
  whtAmount       Decimal @db.Decimal(15, 2) @default(0)
  netReceived     Decimal @db.Decimal(15, 2)             // gross+vat-wht-adjustment
  totalAmount     Decimal @db.Decimal(15, 2)             // gross+vat

  // Output references
  receiptNo         String?  @unique                     // "RC-26050001"
  journalEntryId    String?  @unique
  journalEntry      JournalEntry? @relation(fields: [journalEntryId], references: [id])

  customerNote      String?

  // Lifecycle
  createdById       String
  createdBy         User     @relation("OIcreated", fields: [createdById], references: [id])
  postedAt          DateTime?

  // Reverse linkage (self-relation)
  reversedById      String?                                // OI-...-R points back via this
  reversedBy        OtherIncome? @relation("OIreverse", fields: [reversedById], references: [id])
  reverses          OtherIncome[] @relation("OIreverse")
  reverseReason     String?                                // enum-like: input_error/customer_request/...
  reverseNote       String?

  // Recurring
  copiedFromId      String?                                // self-ref soft pointer

  // BESTCHOICE conventions
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  deletedAt         DateTime?                              // DRAFT can be soft-deleted; POSTED cannot

  // Children
  items             OtherIncomeItem[]
  adjustments       OtherIncomeAdjustment[]
  attachments       OtherIncomeAttachment[]

  @@index([status, issueDate])
  @@index([customerId])
  @@index([deletedAt])
}

model OtherIncomeItem {
  id              String   @id @default(uuid())
  otherIncomeId   String
  otherIncome     OtherIncome @relation(fields: [otherIncomeId], references: [id], onDelete: Cascade)

  lineNo          Int
  accountCode     String                     // 42-XXXX
  accountName     String                     // snapshot at create time
  description     String?

  // Inputs
  quantity        Decimal @db.Decimal(15, 2) @default(1)
  unitAmount      Decimal @db.Decimal(15, 2)
  discountAmount  Decimal @db.Decimal(15, 2) @default(0)
  vatPct          Decimal @db.Decimal(5, 2)  @default(0)
  whtPct          Decimal @db.Decimal(5, 2)  @default(0)

  // Computed
  amountBeforeVat Decimal @db.Decimal(15, 2)
  vatAmount       Decimal @db.Decimal(15, 2) @default(0)
  whtAmount       Decimal @db.Decimal(15, 2) @default(0)

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  deletedAt       DateTime?

  @@unique([otherIncomeId, lineNo])
}

model OtherIncomeAdjustment {
  id              String   @id @default(uuid())
  otherIncomeId   String
  otherIncome     OtherIncome @relation(fields: [otherIncomeId], references: [id], onDelete: Cascade)

  lineNo          Int
  accountCode     String                                  // CoA filter: 52-/53-/11-41
  amount          Decimal @db.Decimal(15, 2)              // > 0 (CHECK)
  note            String?

  createdAt       DateTime @default(now())

  @@unique([otherIncomeId, lineNo])
}

model OtherIncomeAttachment {
  id              String   @id @default(uuid())
  otherIncomeId   String
  otherIncome     OtherIncome @relation(fields: [otherIncomeId], references: [id], onDelete: Cascade)

  s3Key           String
  filename        String
  size            Int
  mimeType        String

  uploadedById    String
  uploadedBy      User     @relation(fields: [uploadedById], references: [id])
  createdAt       DateTime @default(now())
}
```

**Migration order:** add new tables only — no FK changes to existing tables.

### 4.2 Reuse existing models (no schema change)

- `User`, `Customer`, `ChartOfAccount`, `AccountingPeriod`
- `JournalEntry` (gets new `OtherIncome.journalEntry?` 1:1 reverse FK on `OtherIncome.journalEntryId`)
- `JournalLine` (no change — generated by `AutoJournalService`)
- `AuditLog` (auto via `AuditInterceptor`)

## 5. Workflow

### 5.1 State machine

```
DRAFT ─[post]──→ POSTED ─[reverse]──→ REVERSED
  │                 │
  │                 └─[create -R doc]──→ new OtherIncome (status POSTED)
  │
  └─[soft-delete]──→ (gone, deletedAt set)

[POSTED] cannot edit, cannot delete, can only Reverse.
[REVERSED] terminal state.
```

### 5.2 Permission matrix

| Action | OWNER | FINANCE_MANAGER | ACCOUNTANT | BRANCH_MANAGER | SALES |
|---|:-:|:-:|:-:|:-:|:-:|
| List + view | ✅ | ✅ | ✅ | ❌ | ❌ |
| Create draft | ✅ | ✅ | ✅ | ❌ | ❌ |
| Edit draft | ✅ | ✅ | ✅ (own only) | ❌ | ❌ |
| Post | ✅ | ✅ | ✅ | ❌ | ❌ |
| Reverse | ✅ | ✅ | ❌ | ❌ | ❌ |
| Period close (V8 toggle) | ✅ | ✅ | ❌ | ❌ | ❌ |

(Reuse existing roles — no new role needed)

## 6. Validation Rules (V1-V14)

| ID | Rule | Block POST | Implementation |
|---|---|:-:|---|
| V1 | Dr = Cr (balanced) | ✅ | sum check after `AutoJournalService.generate()` |
| V2 | Journal lines ≥ 2 | ✅ | length check |
| V3 | issueDate + ≥1 item | ✅ | DTO validators |
| V4 | every item: account_code starts with `42-` + amount > 0 | ✅ | per-row check; block 42-1103 with hint |
| V5 | every JE line: Dr XOR Cr | ✅ | DB CHECK constraint on `JournalLine` |
| V6 | item.vatPct > 0 ⟺ JE has 21-21XX | ✅ | cross-check |
| V7 | whtPct ∈ {0,1,2,3,5,7,10,15} | ⚠ Warning | non-blocking |
| V8 | period not closed | ✅ | `validatePeriodOpen(issueDate)` |
| V9 | (intentionally relaxed — single-user mode per D1) | — | skip |
| V10 | adjustments cover \|amountReceived − netReceived\| | ✅ | sum check |
| V11 | amount ≥ threshold → require attachment | ✅ | configurable threshold (default 50,000) |
| V12 | sum(adjustment.amount) = abs(diff) | ✅ | sum check |
| V13 | every adjustment row has accountCode | ✅ | per-row check |
| V14 | every adjustment.amount > 0 | ✅ | DB CHECK |

**Threshold setting** (V11): store in `IntegrationConfig` with key `OTHER_INCOME_ATTACHMENT_THRESHOLD` (default 50,000 THB).

## 7. Auto Journal Generator

### Pattern A: Standard income (only pattern in v1)

```ts
// AutoJournalService.generate(doc): JournalLineInput[]
const items = doc.items;
const adjustments = doc.adjustments;

const incomeGross = sum(items.map(i => i.amountBeforeVat));
const vatAmount   = sum(items.map(i => i.vatAmount));
const whtAmount   = sum(items.map(i => i.whtAmount));
const totalAmount = incomeGross + vatAmount;
const netExpected = totalAmount - whtAmount;
const adjDelta    = doc.amountReceived - netExpected;  // signed

const lines: JournalLineInput[] = [];

// 1. Cash/Bank in (Dr)
if (doc.amountReceived > 0) {
  lines.push({
    accountCode: doc.paymentAccountCode,
    debit:  doc.amountReceived,
    credit: 0,
    note:   'รับเงินจริง',
  });
}

// 2. WHT receivable (Dr) — ที่ถูกหัก ณ ที่จ่าย
if (whtAmount > 0) {
  lines.push({
    accountCode: '11-4103',
    debit: whtAmount,
    credit: 0,
    note: `ภาษีหัก ณ ที่จ่าย ${items[0].whtPct}%`,
  });
}

// 3. Adjustments (multi-line) — when amountReceived ≠ netExpected
for (const adj of adjustments) {
  if (adjDelta < 0) {  // ขาด → Dr the gap (e.g., bank fee, extra discount)
    lines.push({ accountCode: adj.accountCode, debit: adj.amount, credit: 0, note: adj.note });
  } else {              // เกิน → Cr (gain, extra income)
    lines.push({ accountCode: adj.accountCode, debit: 0, credit: adj.amount, note: adj.note });
  }
}

// 4. Income (Cr) — one line per item
for (const item of items) {
  lines.push({
    accountCode: item.accountCode,    // 42-XXXX
    debit:  0,
    credit: item.amountBeforeVat,
    note:   item.description ?? item.accountName,
  });
}

// 5. VAT Output (Cr) — direct to 21-2101 (cash-basis settle)
//    NOTE: For Other Income, payment is concurrent with recognition,
//    so VAT settles immediately (no 21-2102 deferral needed).
if (vatAmount > 0) {
  lines.push({
    accountCode: '21-2101',
    debit: 0,
    credit: vatAmount,
    note: 'ภาษีขาย ภ.พ.30',
  });
}

return lines;  // V1 check: sum(debit) === sum(credit) per Decimal
```

**Override mode:** if user toggles "Override JV", store user-provided lines verbatim. Validation V1+V5 still apply (Dr=Cr, Dr XOR Cr per line).

## 8. UI Pages

### 8.1 List Page (`/other-income`)
- Header: PageHeader breadcrumb + "+ สร้างเอกสาร" button
- 4 status cards (drop READY/APPROVED per D1): DRAFT / POSTED / REVERSED / Daily Sheet (clickable)
- Filter bar: search (debounced) + status dropdown
- Table: docNumber / counterparty / first 42-XXXX account / amount / issueDate / status badge / actions (view, copy)
- QueryBoundary wrapper (per project convention)

### 8.2 Entry Page (`/other-income/new`, `/other-income/:id/edit`)
Single-page scroll, no wizard:
1. **Header** — counterparty (Customer picker OR free-text), issue/due/payment date, price type
2. **Items** — multi-row table, each row = one 42-XXXX line + description textarea
3. **Payment** — payment account chips (11-1101 / 11-1102 / 11-1201 / etc.) + amountReceived input
4. **PaymentCompareCard** — diff indicator + AdjustmentTable (only when delta ≠ 0)
5. **AutoJournalPreview** — read-only Dr/Cr lines + "Override" checkbox (toggle to manual)
6. **Attachments** — drag-drop S3 uploader (required if amount ≥ threshold)
7. **Sticky bottom bar** — `[ยกเลิก] [บันทึกร่าง] [บันทึก & POST]`
   - POST button disabled until all V1-V14 ERROR rules pass; tooltip lists blockers

react-hook-form + zod (per project convention since W-2 PR #728)

### 8.3 View Page (`/other-income/:id`)
- Read-only DocSummaryView
- Banner เขียว 60s after POST (postedAt within last minute) + animated print button
- Audit Trail (auto-fetched from AuditLog by entity+entityId)
- Bottom-right: small "↺ กลับรายการ" button (if status=POSTED, user has reverse perm, no existing reversal)

### 8.4 Receipt Page (`/other-income/:id/receipt`)
- A4 portrait print preview using `@media print`
- Hide if no `customerId` (ดอกเบี้ยฝากไม่ออกใบเสร็จ — no recipient)
- Reuse existing `MobileReceipt` thai-baht text helper if present (else build from scratch)
- 4-signature block + QR code (signed URL link to view doc)

### 8.5 Daily Sheet (`/other-income/daily-sheet`)
- Date picker (default today)
- 4 summary boxes: incomeGross / vat / wht / netReceived
- 3 tables: docs / by account / by payment channel
- Export CSV (UTF-8 BOM for Excel Thai)
- Highlight rows ≥ threshold in orange
- Print A4

### 8.6 Period Close UI page
New route `/accounting/periods` (not a tab in existing /settings — keeps Other Income module self-contained). Wraps existing `MonthlyCloseService.getPeriodStatus / startReview / finalizePeriod` — UI only, no new backend logic. Linked from the OtherIncome ListPage 5th card label "งวดบัญชี".

## 9. API Endpoints

All `@Roles('OWNER','FINANCE_MANAGER','ACCOUNTANT')` unless noted:

| Method | Path | Purpose |
|---|---|---|
| GET | `/other-income` | List + filter (status, dateRange, q) |
| GET | `/other-income/:id` | Detail (items + adjustments + JE lines) |
| POST | `/other-income` | Create DRAFT |
| PATCH | `/other-income/:id` | Update DRAFT (404 if POSTED) |
| DELETE | `/other-income/:id` | Soft-delete DRAFT |
| POST | `/other-income/:id/post` | V1-V14 + create JE → POSTED |
| POST | `/other-income/:id/reverse` | Reverse Entry (OWNER + FINANCE_MANAGER only) |
| POST | `/other-income/:id/copy` | Clone as new DRAFT |
| GET | `/other-income/daily-sheet?date=YYYY-MM-DD` | Daily summary (3 breakdowns) |
| GET | `/other-income/:id/audit` | Audit log (proxy AuditLog by entity) |

**Validation errors** return 400 with `{ errors: [{ rule: 'V1', msg: '...' }, ...] }`.

## 10. Testing Strategy

Mirror Expenses module test patterns:

| Suite | Coverage | Target |
|---|---|---|
| `other-income.service.spec` | CRUD, post, reverse, copy, soft-delete | ~25 tests |
| `auto-journal.spec` | Pattern A golden cases (no VAT/WHT/adj, with VAT, with WHT, with multi-adj over+under, override mode) | ~12 tests |
| `validation.spec` | V1-V14 each rule blocks/passes correctly | ~15 tests |
| Controller integration | guards, role gating, payload validation | ~8 tests |
| E2E (Playwright) | smoke: create → post → view → reverse | 1 spec |

**Golden fixture seeds:** add CSV cases to `apps/api/src/modules/other-income/__tests__/fixtures/` (mirror `cpa-cases/` pattern from Phase A.4).

## 11. Migration & Rollout

### 11.1 Migration
- Single Prisma migration: `add_other_income_tables` (4 new tables)
- Existing models (`User`, `Customer`, `JournalEntry`) get back-relation fields only — no new columns, no FK changes
- No data backfill needed (greenfield)
- No CoA seed changes (42-XXXX already in 99-account chart)

### 11.2 Rollout
- Single PR `feat/other-income-module`
- Feature flag: NONE (read-only adds; no risk to existing flows)
- Deploy: standard CI/CD via `.github/workflows/deploy.yml`
- Post-deploy verification: owner manual test 1 case end-to-end (create ดอกเบี้ยฝาก KBank → post → view → print preview)

### 11.3 Documentation
- Update `.claude/rules/accounting.md` with v1 module pointer (one paragraph)
- Slash command for accountant (`.claude/skills/create-other-income.md`) — **defer** to post-MVP, not blocking v1 ship

## 12. Estimate

~6 days actual dev work, 1 PR:

| Phase | Hours |
|---|---|
| Prisma schema + migration + seed fixtures | 4h |
| `OtherIncomeService` + `AutoJournalService` + `ValidationService` + tests | 12h |
| Controller + DTOs + integration tests | 4h |
| `OtherIncomeListPage` + `OtherIncomeViewPage` (mirror Expenses) | 6h |
| `OtherIncomeEntryPage` + ItemsTable + AdjustmentTable + JV preview | 12h |
| `OtherIncomeReceiptPage` (A4 print) | 6h |
| `OtherIncomeDailySheetPage` + CSV export | 4h |
| Period Close UI tab | 2h |
| E2E + polish + final review | 4h |

= **~54 hours** spread over real days (~6 working days)

## 13. Risks & Open Questions

| Risk | Mitigation |
|---|---|
| Accountant uses 42-1103 by mistake (already auto-posted) | UI guard: 42-1103 disabled in dropdown, tooltip "ใช้ Payment receipt แทน" |
| ดอกเบี้ยฝากไม่มี Customer record | counterparty free-text fields cover; receipt page conditional |
| VAT direct to 21-2101 vs 21-2102 deferred | Documented in §7 — cash-basis means same-period settlement; if later need accrual variant, add Pattern A2 |
| Multi-line adjustments confusing | UI shows live "ผลรวม X / ผลต่าง Y" footer + "เพิ่มผลต่างที่เหลือ" quick-add |

**Open questions:** none for v1. (`Pattern B Payroll` deferred until payroll module exists.)

---

## 14. Approval

- [x] D1: 3-state workflow (DRAFT → POSTED → REVERSED) — approved 2026-05-06
- [x] D2: customer field optional — approved 2026-05-06
- [x] D3: internal-only (no LIFF) — approved 2026-05-06
- [ ] **Owner final review** of this design doc
- [ ] Hand off to `superpowers:writing-plans` skill

---

*End of design.*
