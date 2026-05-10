# Expense Document Polymorphic Redesign — Design Spec

**Date**: 2026-05-10
**Author**: AI agent + owner
**Status**: Draft → Pending CPA audit (Phase A.7)
**Supersedes**: existing `Expense` model + `/expenses` REST API

## Summary

Redesign the expense module from a single flat `Expense` model into a polymorphic document system with 4 distinct document types: รายจ่าย (`EXPENSE`), ใบลดหนี้ (`CREDIT_NOTE`), เงินเดือน (`PAYROLL`), and จ่ายเจ้าหนี้ (`VENDOR_SETTLEMENT`). Each type has its own data shape, JE flow, and UI form. Adds a Favorites template system (recurring auto-create) and a print-ready Daily Summary page.

The redesign matches the UI mockup the owner provided (compact header + 7 filter tab cards + simplified search row + 8-column table with type/status badges) and aligns the accounting flow with TFRS for NPAEs Phase A.4 chart of 99 accounts.

## Goals

- Support 4 document types with type-specific data and JE templates
- Match the UI mockup exactly (header, tabs, table columns, badges)
- Provide a Favorites system for repeated entries (utilities, payroll, etc.) with optional monthly auto-create
- Provide a print-ready Daily Summary report (Thai accounting convention "ใบสรุปประจำวัน")
- Replace the old `Expense` model entirely (wipe + fresh start; pre-go-live, all current data is test data)

## Non-Goals (deferred to Phase A.7)

- ภงด.1/3/53 government form file generation (only field storage)
- Vendor master table (free-text `vendorName` for now)
- Approval workflow (ตัดออกตาม mockup — กลับมาทำได้ถ้า business ขอ)
- Cross-module daily summary (รวม RT/OI รายรับด้วย) — current scope is expense-side only
- CPA case golden CSV verification — JE templates are logical-correct in v1, flagged for CPA audit later

---

## 1. Data Model — Polymorphic Class Table Inheritance

### 1.1 Header (`ExpenseDocument`)

Shared properties across all 4 types — number, date, vendor, money totals, status, branch, JE link, audit.

```prisma
model ExpenseDocument {
  id              String   @id @default(uuid())
  number          String   @unique               // <TYPE>-YYYYMMDD-NNNN
  documentType    DocumentType
  branchId        String   @map("branch_id")
  documentDate    DateTime @map("document_date")
  vendorName      String?  @map("vendor_name")
  vendorTaxId     String?  @map("vendor_tax_id")
  taxInvoiceNo    String?  @map("tax_invoice_no")
  description     String?

  // Money — Decimal(12,2)
  subtotal        Decimal  @db.Decimal(12, 2)
  vatAmount       Decimal  @default(0) @db.Decimal(12, 2) @map("vat_amount")
  withholdingTax  Decimal  @default(0) @db.Decimal(12, 2) @map("withholding_tax")
  whtFormType     String?  @map("wht_form_type")  // PND3 | PND53
  totalAmount     Decimal  @db.Decimal(12, 2) @map("total_amount")
  netPayment      Decimal? @db.Decimal(12, 2) @map("net_payment")

  // Status + cash dimension
  status              DocumentStatus @default(DRAFT)
  paidAt              DateTime?      @map("paid_at")
  paymentMethod       PaymentMethod? @map("payment_method")
  depositAccountCode  String?        @map("deposit_account_code")  // 1 of 6 cash codes per accounting.md

  // Polymorphic detail tables (1:1 — only one populated per row, by documentType)
  expenseDetail   ExpenseDetail?
  creditNote      CreditNoteDetail?
  payroll         PayrollDetail?
  settlement      VendorSettlementDetail?

  // JE link
  journalEntryId  String? @map("journal_entry_id")

  // Receipt + ref
  receiptImageUrl  String? @map("receipt_image_url")
  reference        String?
  note             String?

  // Template origin (for recurring cron idempotency + UI hint "created from template X")
  fromTemplateId   String?  @map("from_template_id")

  // Audit
  createdById     String   @map("created_by_id")
  approvedById    String?  @map("approved_by_id")
  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")
  deletedAt       DateTime? @map("deleted_at")

  @@index([branchId, documentDate])
  @@index([documentType, status])
  @@index([status, paidAt])
  @@map("expense_documents")
}

enum DocumentType {
  EXPENSE
  CREDIT_NOTE
  PAYROLL
  VENDOR_SETTLEMENT
}

enum DocumentStatus {
  DRAFT
  ACCRUAL
  POSTED
  VOIDED
}
```

### 1.2 Type-specific Detail Tables (1:1 with header)

```prisma
model ExpenseDetail {
  documentId String          @id @map("document_id")
  document   ExpenseDocument @relation(fields: [documentId], references: [id], onDelete: Cascade)
  category   String          // CoA code (e.g. 53-1302)

  @@map("expense_details")
}

model CreditNoteDetail {
  documentId         String          @id @map("document_id")
  document           ExpenseDocument @relation(fields: [documentId], references: [id], onDelete: Cascade)
  originalDocumentId String          @map("original_document_id")  // FK → ExpenseDocument
  reason             String
  category           String          // CoA code (mirror ของ original)

  @@map("credit_note_details")
}

model PayrollDetail {
  documentId    String          @id @map("document_id")
  document      ExpenseDocument @relation(fields: [documentId], references: [id], onDelete: Cascade)
  payrollPeriod String          @map("payroll_period")  // "2569-05" (Thai year-month)
  lines         PayrollLine[]

  @@map("payroll_details")
}

model PayrollLine {
  id            String        @id @default(uuid())
  payrollId     String        @map("payroll_id")
  payroll       PayrollDetail @relation(fields: [payrollId], references: [documentId], onDelete: Cascade)
  employeeName  String        @map("employee_name")
  employeeTaxId String?       @map("employee_tax_id")
  baseSalary    Decimal       @db.Decimal(12, 2) @map("base_salary")
  ssoEmployee   Decimal       @default(0) @db.Decimal(12, 2) @map("sso_employee")
  whtAmount     Decimal       @default(0) @db.Decimal(12, 2) @map("wht_amount")
  netPaid       Decimal       @db.Decimal(12, 2) @map("net_paid")

  @@index([payrollId])
  @@map("payroll_lines")
}

model VendorSettlementDetail {
  documentId      String           @id @map("document_id")
  document        ExpenseDocument  @relation(fields: [documentId], references: [id], onDelete: Cascade)
  settlementLines SettlementLine[]

  @@map("vendor_settlement_details")
}

model SettlementLine {
  id                String                 @id @default(uuid())
  settlementId      String                 @map("settlement_id")
  settlement        VendorSettlementDetail @relation(fields: [settlementId], references: [documentId], onDelete: Cascade)
  clearedDocumentId String                 @map("cleared_document_id")  // FK → ExpenseDocument (ตั้งหนี้ที่เคลียร์)
  amountSettled     Decimal                @db.Decimal(12, 2) @map("amount_settled")

  @@index([settlementId])
  @@index([clearedDocumentId])
  @@map("settlement_lines")
}
```

### 1.3 Favorites (`ExpenseTemplate`)

Per-branch shared templates, save any of 4 types, optional monthly auto-create.

```prisma
model ExpenseTemplate {
  id              String   @id @default(uuid())
  name            String
  documentType    DocumentType
  branchId        String   @map("branch_id")
  prefilledData   Json     @map("prefilled_data")  // serialized form values (excl. amount/date)
  isRecurring     Boolean  @default(false) @map("is_recurring")
  recurringDay    Int?     @map("recurring_day")   // 1-31
  createdById     String   @map("created_by_id")
  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")
  deletedAt       DateTime? @map("deleted_at")

  @@index([branchId, deletedAt])
  @@index([isRecurring, recurringDay])
  @@map("expense_templates")
}
```

---

## 2. Document Numbering

**Format**: `<TYPE>-YYYYMMDD-NNNN` (daily reset, 4-digit seq, per-type prefix)

| Type | Prefix |
|------|--------|
| EXPENSE | `EX` |
| CREDIT_NOTE | `CN` |
| PAYROLL | `PR` |
| VENDOR_SETTLEMENT | `SE` |

**Examples**: `EX-20260510-0001`, `CN-20260510-0099`, `PR-20260601-0001`

**Implementation** (mirrors RT/OI advisory-lock pattern):

```ts
async function generateDocumentNumber(
  type: DocumentType,
  date: Date,
  tx: Prisma.TransactionClient,
): Promise<string> {
  const prefix = `${typePrefix(type)}-${yyyymmdd(date)}-`;
  const lockKey = hashToBigint(prefix);
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(${lockKey})`;
  const last = await tx.expenseDocument.findFirst({
    where: { number: { startsWith: prefix } },
    orderBy: { number: 'desc' },
    select: { number: true },
  });
  const seq = last ? parseInt(last.number.slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(seq).padStart(4, '0')}`;
}
```

- **Race-safe**: `pg_advisory_xact_lock` per (type, date) key
- **Reset**: daily, per type
- **Cap**: 9999 docs per type per day (sufficient — current usage 99/day max observed)

---

## 3. Status Lifecycle

### 3.1 Allowed Transitions (per type)

```
EXPENSE (Same-day):
  DRAFT ──post──→ POSTED + paidAt → VOIDED

EXPENSE (Accrual / ตั้งหนี้):
  DRAFT ──post──→ ACCRUAL ──pay (via SE)──→ POSTED + paidAt
                     ↓                          ↓
                  VOIDED                     VOIDED

CREDIT_NOTE:
  DRAFT ──post──→ POSTED → VOIDED

PAYROLL:
  DRAFT ──post──→ POSTED + paidAt → VOIDED
  (PR ปกติจ่ายงวดทันที — ไม่ใช้ ACCRUAL state)

VENDOR_SETTLEMENT:
  DRAFT ──post──→ POSTED + paidAt → VOIDED
  (post หนึ่ง SE → cleared docs ทั้งหมด ACCRUAL → POSTED + paidAt = SE.paidAt)
```

### 3.2 Tab → Filter Mapping

| Tab | Filter |
|-----|--------|
| ทั้งหมด | `status != 'VOIDED' AND deletedAt IS NULL` |
| ฉบับร่าง | `status = 'DRAFT'` |
| รอจ่าย | `status = 'ACCRUAL'` |
| บันทึกแล้ว | `status IN ('ACCRUAL', 'POSTED')` |
| จ่ายแล้ว | `paidAt IS NOT NULL` |
| รายการโปรด | (separate route to `/expenses/favorites`) |
| สรุปรายวัน | (separate route to `/expenses/daily-summary`) |

### 3.3 Type Label (UI display, derived)

```ts
function typeLabel(doc: ExpenseDocument): string {
  switch (doc.documentType) {
    case 'EXPENSE':
      return doc.status === 'ACCRUAL' ? 'ตั้งหนี้' : 'Same-day';
    case 'CREDIT_NOTE':       return 'ใบลดหนี้';
    case 'PAYROLL':           return 'เงินเดือน';
    case 'VENDOR_SETTLEMENT': return 'จ่ายเจ้าหนี้';
  }
}
```

---

## 4. JE Templates (5 templates, all balanced, atomic, idempotent)

All templates wrap in `$transaction`, post via `JournalAutoService.createAndPost`, set `postedAt = doc.documentDate`, pass `companyId = SHOP`, and write `journalEntryId` back to header. Skip if doc already has `journalEntryId` (idempotency guard).

⚠️ **CPA AUDIT REQUIRED** — JE accounts in templates below are logical-correct against Phase A.4 chart but pending CPA case verification (similar to JP4 golden CSV process). Flag for Phase A.7 review.

### 4.1 `ExpenseSameDayTemplate` (EX paid same day)

**Trigger**: post EX with `paymentMethod` + `depositAccountCode`

**JE**:
```
Dr 5x-xxxx ค่าใช้จ่ายตาม category    (subtotal)
Dr 11-2104 ลูกหนี้-VAT                (vatAmount)        [if VAT > 0]
  Cr depositAccountCode               (totalAmount - whtAmount)
  Cr 21-3101/3103 หัก ณ ที่จ่าย       (whtAmount)        [if WHT > 0; route by whtFormType]
```

### 4.2 `ExpenseAccrualTemplate` (EX ตั้งหนี้)

**Trigger**: post EX without `paymentMethod`

**JE**:
```
Dr 5x-xxxx ค่าใช้จ่าย                 (subtotal)
Dr 11-2104 ลูกหนี้-VAT                (vatAmount)        [if VAT > 0]
  Cr 21-1104 เจ้าหนี้-ค่าใช้จ่ายกิจการ (totalAmount)
```

WHT does not post here — defers to SE settlement time.

### 4.3 `CreditNoteTemplate` (CN กลับด้านบางส่วนของ original)

**Trigger**: post CN — must reference `originalDocumentId`

**JE** (reverse):
```
Dr 21-1104                            (totalAmount)      [if original still ACCRUAL]
Dr depositAccountCode                 (totalAmount)      [if original POSTED — refund]
  Cr 5x-xxxx ค่าใช้จ่าย               (subtotal)
  Cr 11-2104 ลูกหนี้-VAT              (vatAmount)
```

**Validation**:
- `originalDocument` must exist + same branch + `documentType = EXPENSE` + status IN (ACCRUAL, POSTED)
- `CN.totalAmount ≤ original.totalAmount - sumOfPriorCreditNotes` where `sumOfPriorCreditNotes = SELECT COALESCE(SUM(totalAmount), 0) FROM expense_documents WHERE documentType='CREDIT_NOTE' AND status != 'VOIDED' AND id IN (SELECT documentId FROM credit_note_details WHERE originalDocumentId = original.id)`

### 4.4 `PayrollTemplate` (PR — multi-line aggregated)

**Trigger**: post PR

**JE**:
```
Dr 53-1101 เงินเดือน-ค่าจ้าง          (Σ baseSalary)
  Cr 21-3102 หัก ณ ที่จ่าย ภงด.1      (Σ whtAmount)
  Cr 21-3104 ประกันสังคม               (Σ ssoEmployee)
  Cr depositAccountCode               (Σ netPaid)
```

Line-level data stays in `PayrollLine[]`. ภงด.1 file generation deferred.

### 4.5 `VendorSettlementTemplate` (SE — clears ACCRUAL EXs)

**Trigger**: post SE

**JE**:
```
Dr 21-1104 เจ้าหนี้                   (Σ amountSettled)
  Cr depositAccountCode               (Σ amountSettled - Σ wht)
  Cr 21-3101/3103 หัก ณ ที่จ่าย       (Σ wht if any)
```

**Side effects** (in same tx):
- Each cleared doc: `status = ACCRUAL → POSTED`, `paidAt = SE.paidAt`
- Validate: `amountSettled ≤ original.totalAmount - already-settled-sum`

### 4.6 Reverse on Void

When voiding a POSTED doc:
- Post reverse JE (Dr↔Cr swap), `metadata.reverseOf = original.entryNo`
- Same pattern as existing `expense-reverse.template.ts`

---

## 5. REST API

**Base path**: `/expense-documents`

```
POST   /expense-documents                    create (body includes documentType + type-specific data)
GET    /expense-documents                    list (query: tab, type, status, branchId, dates, search, page, limit)
GET    /expense-documents/summary            counts/totals/byStatus/accrualUnpaid
GET    /expense-documents/daily-summary      daily report aggregation (sec 7)
GET    /expense-documents/:id                detail (header + matching detail subtable)

POST   /expense-documents/:id/post           DRAFT → POSTED/ACCRUAL (fires JE template)
POST   /expense-documents/:id/void           → VOIDED (reverse JE if was POSTED)
# NOTE: ACCRUAL → POSTED transition happens ONLY via VENDOR_SETTLEMENT post (no direct
#       /pay endpoint). This enforces accounting traceability: every cash payment that
#       clears AP must produce its own SE document with full JE + cash dimension audit.
PATCH  /expense-documents/:id                edit DRAFT only (block POSTED+)
DELETE /expense-documents/:id                soft-delete DRAFT only

POST   /expense-documents/credit-note        shorthand for CN create + validation
POST   /expense-documents/payroll            shorthand for PR create + line validation
POST   /expense-documents/settlement         shorthand for SE create + clearing validation

GET    /expense-templates                    list per branch
POST   /expense-templates                    save
PATCH  /expense-templates/:id                edit
DELETE /expense-templates/:id                soft-delete
POST   /expense-templates/:id/instantiate    create new DRAFT ExpenseDocument from template
```

### Roles + Guards

| Endpoint | Roles |
|----------|-------|
| GET (list/detail/summary/daily) | OWNER, BRANCH_MANAGER, FINANCE_MANAGER, ACCOUNTANT |
| POST/PATCH (create/edit) | OWNER, BRANCH_MANAGER, FINANCE_MANAGER, ACCOUNTANT |
| POST `/post` | OWNER, FINANCE_MANAGER, ACCOUNTANT |
| POST `/void` | OWNER, FINANCE_MANAGER (no accountant void) |
| Templates CRUD | OWNER, BRANCH_MANAGER, FINANCE_MANAGER, ACCOUNTANT |

Global: CsrfGuard, ThrottlerGuard (200/sec), AuditInterceptor (auto).

---

## 6. UI Layer

### 6.1 Routes

```
/expenses                              listing (already redesigned)
/expenses/new?type=EX|CN|PR|SE         create form (4 variants)
/expenses/:id                          detail/edit
/expenses/favorites                    template management
/expenses/daily-summary                print-ready report
```

### 6.2 Forms

All 4 forms share common sections (วันที่/สาขา, ผู้รับเงิน, รับชำระ, แนบไฟล์, หมายเหตุ + บันทึกเป็นรายการโปรด).

Type-specific sections:

| Type | Section |
|------|---------|
| **EX** | "รายการค่าใช้จ่าย" — category (CoA), amount, VAT toggle, WHT |
| **CN** | "ใบลดหนี้" — original doc picker (search by number) + reason + amount cap |
| **PR** | "งวดเงินเดือน" — period selector + dynamic table per employee with auto-sum |
| **SE** | "เคลียร์เจ้าหนี้คงค้าง" — multi-select picker จาก ACCRUAL EX ที่ branch เดียวกัน + amount per line |

### 6.3 Form Validation

- `documentDate` not in closed period (use `validatePeriodOpen`)
- `depositAccountCode` ∈ 6 codes (shared constant `CASH_ACCOUNT_CODES`)
- CN: `amount ≤ original.totalAmount - alreadyCredited`
- SE: every cleared doc must be ACCRUAL + same branch
- PR: every line `netPaid = baseSalary - ssoEmployee - whtAmount` (auto-calc + validate)

### 6.4 Listing Page

- Existing redesigned tabs/header/search/table (already live in PR working branch)
- "+ สร้างเอกสารใหม่" button → dropdown 4 options → `/expenses/new?type=X`
- `typeLabel()` helper renders the type badge
- Document number column links to `/expenses/:id`

---

## 7. Favorites + Daily Summary Detail

### 7.1 Favorites (`/expenses/favorites`)

**Layout**: card grid, filter by type/branch, each card shows name + type + category + vendor + recurring badge + actions [ใช้, แก้ไข, ลบ].

**Workflow**:
1. **Save**: form has "🔖 บันทึกเป็นรายการโปรด" checkbox + name field → on save expense, also creates `ExpenseTemplate`
2. **Use**: click card → POST `/expense-templates/:id/instantiate` → returns new DRAFT id → redirect to `/expenses/:id` (pre-filled)
3. **Edit**: modal for name + prefilledData fields + recurring settings
4. **Delete**: soft-delete

**Pre-filled fields**: vendor, category, paymentMethod, depositAccountCode, description, isRecurring (NOT amount, NOT date).

**Recurring auto-create cron** (`expense-recurring.cron.ts`):

```ts
@Cron('0 8 * * *', { timeZone: 'Asia/Bangkok' })
async tick() {
  const today = new Date();
  const dayOfMonth = today.getDate();
  const templates = await prisma.expenseTemplate.findMany({
    where: { isRecurring: true, recurringDay: dayOfMonth, deletedAt: null },
  });
  for (const tpl of templates) {
    // Idempotency key: any document created today via this template
    // (tracked via metadata.fromTemplateId on the document or separate marker column)
    const existing = await prisma.expenseDocument.findFirst({
      where: {
        branchId: tpl.branchId,
        documentDate: { gte: startOfDay(today), lte: endOfDay(today) },
        fromTemplateId: tpl.id,
      },
    });
    if (existing) continue;
    await this.expenseService.createFromTemplate(tpl.id, { auto: true });
    // notify branch users via in-app notification
  }
}
```

- Creates DRAFT only (no JE post — user fills amount and posts later)
- Idempotent per (branch, date, template)
- In-app notification on creation

### 7.2 Daily Summary (`/expenses/daily-summary`)

**Backend** `GET /expense-documents/daily-summary?date=YYYY-MM-DD&branchId=X`:

Returns aggregated documents + totals by type, paymentMethod, category + cash-account movements for the day.

**Frontend layout** (Thai accounting standard):

```
┌─ ใบสรุปรายจ่ายประจำวัน ──────── [📄 พิมพ์] [📊 Excel] ─┐
│ วันที่ + สาขา + ผู้จัดทำ                                │
├──────────────────────────────────────────────────────┤
│ รายการเอกสาร (n รายการ): table                       │
├──────────────────────────────────────────────────────┤
│ รวมตามประเภท | รวมตามวิธีจ่าย                          │
├──────────────────────────────────────────────────────┤
│ เงินสด/ธนาคาร เคลื่อนไหววันนี้                          │
├──────────────────────────────────────────────────────┤
│ ลงนาม: ผู้จัดทำ / ผู้ตรวจสอบ / ผู้อนุมัติ              │
└──────────────────────────────────────────────────────┘
```

**Print** (`@media print`): A4, hide nav/buttons, force page-break after totals if doc count > 30, signature lines always rendered, IBM Plex Sans Thai 10pt.

**Excel export**: `exceljs`, 2 sheets (รายการ + สรุปยอด), filename `daily-summary-YYYYMMDD-<branch>.xlsx`.

---

## 8. Migration (Wipe-and-Fresh)

Confirmed by owner (Q8 = A): all current expense data is test data, no real production records to preserve.

### 8.1 Sequence

```bash
# Step 1 — additive schema migration
npx prisma migrate dev --name add_expense_document_polymorphic
# Creates: expense_documents, expense_details, credit_note_details,
#          payroll_details, payroll_lines,
#          vendor_settlement_details, settlement_lines,
#          expense_templates

# Step 2 — wipe via Cloud Run Job (CONFIRM_WIPE_EXPENSES=YES_I_AM_SURE)
DELETE FROM journal_lines
  WHERE journal_entry_id IN (
    SELECT id FROM journal_entries
    WHERE metadata->>'flow' LIKE 'expense-%'
  );
DELETE FROM journal_entries WHERE metadata->>'flow' LIKE 'expense-%';
DELETE FROM expenses;       -- legacy table
DROP TABLE expenses;         -- final, fail-loud if any old code refs

# Step 3 — old API endpoints behavior:
#   GET /expenses* → 301 Moved Permanently → /expense-documents* (preserves bookmarks)
#   POST/PATCH/DELETE /expenses* → 410 Gone (no graceful redirect for writes — fail loud)
# Step 4 — frontend ExpensesPage switches to /expense-documents API (no UI URL change)
```

### 8.2 Wipe CLI

Mirrors `wipe-accounting.cli.ts` pattern. Required env:

```bash
CONFIRM_WIPE_EXPENSES=YES_I_AM_SURE \
  EXPECTED_DB_NAME=bestchoice_dev \
  npm --prefix apps/api run wipe:expenses

# Production: requires additional ALLOW_PROD_WIPE=YES_I_AM_SURE
```

Guards: env presence, DB name match, NODE_ENV check, 5s Ctrl+C cooldown.

### 8.3 Old API/UI Cleanup

- `apps/api/src/modules/accounting/accounting.controller.ts` — remove old `@Get('expenses')` etc., or proxy 301 → new endpoints
- `apps/web/src/pages/ExpensesPage.tsx` — switch to `/expense-documents` API
- Remove old `Expense` model from `schema.prisma`
- Remove `ExpenseFormPanel` from `ExpensesPage.tsx` — split into 4 type-specific forms

---

## 9. Testing

### 9.1 Unit (jest)

- Numbering service: race-safe, daily reset, per-type seq, format
- Status transition validator: allowed transitions, reject invalid combos
- 5 JE templates: balanced equations, correct accounts, correct amounts (sample CSV inputs)
- Type label derivation
- Tab → query mapping

### 9.2 Integration (vitest + real Postgres)

- Full lifecycle per type: create DRAFT → post → JE balanced + posted → void → reverse JE
- CN: original POSTED → CN POSTED → original.creditedAmount tracked
- SE: 3 ACCRUAL EX → SE POSTED → all 3 transition to POSTED + paidAt
- PR: multi-line + correct WHT/SSO breakdown
- Recurring cron: idempotent + creates DRAFT only

### 9.3 E2E (Playwright)

- Login → /expenses → tab clicks → list filtered correctly
- Create EX form → save DRAFT → post → see POSTED in list
- Save expense as favorite → /expenses/favorites → use → new draft pre-filled
- Open daily summary → print preview correct → Excel exports successfully

### 9.4 CPA Audit Coverage Matrix

All 5 templates flagged ⚠️ pending CPA case verification (no golden CSV yet). Phase A.7 sprint:

| Template | Notes |
|----------|-------|
| ExpenseSameDayTemplate | needs Phase A.7 review |
| ExpenseAccrualTemplate | needs review |
| CreditNoteTemplate | high priority — ม.86/10 compliance |
| PayrollTemplate | needs review; ภงด.1 form gen deferred |
| VendorSettlementTemplate | needs review |

---

## 10. Rollout Plan

Each phase = 1 PR (~500-1500 LOC + tests, 1-2 days each):

| PR | Scope |
|----|-------|
| **PR-1** | Schema migration (additive) + wipe CLI + wipe execution (owner-confirmed) + new endpoints `/expense-documents` (EXPENSE type only) + 2 JE templates (Same-day + Accrual) + UI listing switches to new API + EXPENSE create form. Old `Expense` model + `/expenses` API removed. **Single PR contains the destructive migration to keep risk localized.** |
| **PR-2** | CREDIT_NOTE detail table + `CreditNoteTemplate` JE + `/credit-note` create endpoint + CN form variant |
| **PR-3** | PAYROLL detail + lines tables + `PayrollTemplate` JE + `/payroll` create endpoint + PR form variant (multi-line table UI) |
| **PR-4** | VENDOR_SETTLEMENT detail + lines tables + `VendorSettlementTemplate` JE + `/settlement` create endpoint + SE form variant (multi-select picker UI) — also enables ACCRUAL → POSTED transitions |
| **PR-5** | `ExpenseTemplate` model + Favorites CRUD endpoints + `/expenses/favorites` page + recurring cron (`expense-recurring.cron.ts`) + `fromTemplateId` field wiring |
| **PR-6** | Daily summary aggregation endpoint + `/expenses/daily-summary` page + print CSS + Excel export |

PR-1 is the one PR with destructive migration — owner must confirm wipe execution. Subsequent PRs are additive.

---

## 11. Risks + Mitigations

| Risk | Mitigation |
|------|------------|
| 5 JE templates incorrect for CPA → wrong books | Flag for Phase A.7 audit; logical-balanced validated; do not run on real prod data until CPA review |
| Numbering race conditions | `pg_advisory_xact_lock` per (type, date) — proven from RT/OI |
| Wipe destroys data accidentally | Owner confirmed Q8=A; multi-env-var guard; Cloud Run Job with explicit invocation |
| Recurring cron creates excess drafts | DRAFT only (no JE side-effect); idempotent per (branch, date, template); user notified |
| Old `/expenses` callers broken (LIFF, mobile, integrations) | Audit API call logs pre-deploy; 30-day deprecation window with 301 redirect for GET, 410 for writes |
| Forgetting to set `fromTemplateId` on manual create makes recurring cron fire duplicates | Required: cron query MUST include `fromTemplateId: tpl.id`; manual `instantiate` endpoint must also set this field |

---

## 12. Out of Scope (Phase A.7)

- ภงด.1/3/53 government file generation (only field storage in v1)
- Vendor master table (free-text vendorName for now)
- Approval workflow (cut from lifecycle per mockup)
- Cross-module daily summary (RT/OI inclusion)
- CPA case golden CSV verification per JE template

---

## 13. Open Questions

None — all 8 design questions answered (Q1=B, Q2=C, Q3=B, Q4=A, Q5=C, Q6=all defaults, Q7=B, Q8=A).
