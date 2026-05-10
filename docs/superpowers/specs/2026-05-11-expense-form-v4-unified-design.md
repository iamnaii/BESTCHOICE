# Expense Form v4 — Unified Entry Redesign

**Status:** Spec locked, ready for implementation plan
**Date:** 2026-05-11
**Mockup:** Owner-provided 3-screenshot v4 design
**Parent:** PR #801 `feat/expense-documents-all` — extends polymorphic foundation
**Branch:** `feat/expense-form-v4` (off current main once PR #801 merges)

---

## Goal

Replace the 4 separate expense-doc forms (EX/CN/PR/SE) with **one unified entry form** matching the v4 mockup. Adds: multi-line items (each with own category/VAT%/WHT%), Quick Start (Template/Copy/Blank + ใช้บ่อย cards), visual cash-account picker, live AUTO JOURNAL PREVIEW, and explicit approver selector.

## Why

- **Accounting fidelity** — real Thai vendor invoices have multiple line items hitting different expense accounts with potentially mixed VAT and WHT rates per line. Single-category-per-document is a simplification that fails audit when a service invoice mixes consultancy (PND.3 3%) + reimbursable travel (no WHT) + materials (no WHT) on one bill.
- **Workflow speed** — Quick Start templates + "ใช้บ่อย" cards lets the cashier post recurring bills (electric, water, internet) in 2 clicks instead of refilling every field.
- **Audit trust** — live JE preview (BALANCED indicator) lets accountant catch off-by-satang or wrong account before posting, rather than discovering at month-end close.
- **One form vs four** — fewer page-routes to maintain, consistent layout across all 4 doc types, smart defaults (today date → Same-day, past date → ACCRUAL).

---

## Architecture

### Schema

**New table `expense_lines`** (parallel to `payroll_lines` / `settlement_lines`):

```prisma
model ExpenseLine {
  id              String        @id @default(uuid())
  expenseDetailId String        @map("expense_detail_id")
  expenseDetail   ExpenseDetail @relation(fields: [expenseDetailId], references: [documentId], onDelete: Cascade)
  lineNo          Int           @map("line_no")
  category        String        // CoA code (5x-xxxx, validated against chart_of_accounts.type = 'ค่าใช้จ่าย')
  description     String?
  quantity        Decimal       @default(1) @db.Decimal(12, 2)
  unitPrice       Decimal       @db.Decimal(12, 2) @map("unit_price")
  discount        Decimal       @default(0) @db.Decimal(12, 2)
  vatPercent      Decimal       @default(0) @db.Decimal(5, 2) @map("vat_percent")
  whtPercent      Decimal       @default(0) @db.Decimal(5, 2) @map("wht_percent")
  amountBeforeVat Decimal       @db.Decimal(12, 2) @map("amount_before_vat")
  vatAmount       Decimal       @default(0) @db.Decimal(12, 2) @map("vat_amount")
  whtAmount       Decimal       @default(0) @db.Decimal(12, 2) @map("wht_amount")
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt

  @@index([expenseDetailId, lineNo])
  @@map("expense_lines")
}
```

**`ExpenseDetail` changes:**
- DROP `category: String` (now per-line on `ExpenseLine.category`)
- ADD `priceType: String @default("EXCLUSIVE")` — `"EXCLUSIVE"` (ไม่รวม VAT) or `"INCLUSIVE"` (รวม VAT)
- ADD relation `lines: ExpenseLine[]`

`ExpenseDocument` totals (`subtotal`, `vatAmount`, `withholdingTax`, `totalAmount`, `netPayment`) become **derived from line aggregates** — service computes them server-side, not user-supplied. Existing summary aggregations (list/summary/dailySummary endpoints) keep reading the document-level totals so reports stay fast.

### Form layout (v4 mockup, top to bottom)

| Section | Content |
|---|---|
| Header | back, title `บันทึกค่าใช้จ่ายใหม่`, doc number badge, status badge, type badge, สรุปรายวัน button |
| Quick Start (closeable) | 3 mode cards (เริ่มเปล่า / จาก Template / คัดลอกเก่า) + "ใช้บ่อย" up to 6 ExpenseTemplate cards (type chip + name + category code + vendor + sample value) |
| 1 — ประเภทเอกสาร | 5 tabs: Same-day / ตั้งหนี้ / จ่ายเจ้าหนี้ / เงินเดือน / ใบลดหนี้ + smart-default helper text |
| 2 — ผู้ขาย & วันที่ใบกำกับ (EX/CN only) | vendor autocomplete, vendor type (PND.3/PND.53), invoice no, invoice date, price type (รวม VAT / ไม่รวม VAT) |
| 3 — รายการบัญชี (EX/CN only) | multi-line `ExpenseLine[]` editor: category select, qty, unitPrice, discount, VAT%, WHT%, computed ก่อนภาษี, description, per-line VAT/WHT/total summary, + เพิ่มบัญชี button |
| 3 alt — Period+Employee table (PR) | year/month selector, payment date, deposit account, employee lines (existing PayrollForm shape) |
| 3 alt — EX picker (SE) | multi-select ACCRUAL EXs to clear, with amount input per row |
| 3 alt — Original EX picker + reason (CN) | search EX, reason text, line-level amounts mirrored from original |
| 4 — ช่องทางจ่ายเงิน | 6 cash-account visual cards (replaces dropdown), payment date, จำนวนจริง input + ใช้ยอดสุทธิ button, ที่ต้องจ่าย / จ่ายจริง / ผลต่าง |
| 6 — AUTO JOURNAL PREVIEW | live JE table (DR/CR per line) with BALANCED indicator, summary cards (ค่าใช้จ่าย / VAT ซื้อ / WHT / สุทธิจ่าย) |
| 7 — ผู้บันทึก & ผู้อนุมัติ | createdBy (read-only, auto = current user), approver dropdown |
| Footer | ยกเลิก, บันทึกร่าง, Items count + Adj count + Ready indicator, บันทึก & POST |

### Smart Defaults

- **Type tab** auto-switches between Same-day ↔ ตั้งหนี้ when invoice_date crosses today (one-way: user can override)
- **Vendor type** picks default WHT% per line: PND.53 → 1% transport / 3% professional / 5% rent (let user pick); PND.3 → same rates but routed to 21-3102 instead of 21-3103
- **First line VAT%** defaults to 7% if `priceType = "INCLUSIVE"` else 0%; user overrides per line

### Computation (per line)

```
lineSubtotal       = qty × unitPrice − discount
if priceType = EXCLUSIVE:
  amountBeforeVat = lineSubtotal
  vatAmount       = lineSubtotal × vatPercent / 100
elif priceType = INCLUSIVE:
  amountBeforeVat = lineSubtotal × 100 / (100 + vatPercent)
  vatAmount       = lineSubtotal − amountBeforeVat
whtAmount          = amountBeforeVat × whtPercent / 100
lineTotal          = amountBeforeVat + vatAmount
```

Document totals = aggregates:
```
subtotal       = Σ amountBeforeVat
vatAmount      = Σ vatAmount
withholdingTax = Σ whtAmount
totalAmount    = subtotal + vatAmount
netPayment     = totalAmount − withholdingTax
```

**Rounding policy:**
- Per-line VAT: `ROUND_HALF_UP` to 2 decimals
- Per-line WHT: `ROUND_HALF_UP` to 2 decimals
- Document totals: simple sum (no rounding) — guarantees cleaner JE balance

### JE template refactor

`ExpenseSameDayTemplate` and `ExpenseAccrualTemplate` change from single-Dr-expense to **N Dr expense lines** (one per `ExpenseLine.category`, summing lines that share a category to one DR row). VAT row becomes `Dr 11-2104` for `Σ vatAmount`. WHT routing: group lines by `(whtPercent > 0, whtFormType-on-document)` → emit `Cr 21-3102` (PND.3) or `Cr 21-3103` (PND.53) for each WHT bucket.

Cash row stays single (`Cr depositAccountCode = totalAmount − Σ whtAmount`).

### AUTO JOURNAL PREVIEW

**Server-side `POST /expense-documents/preview-je`** endpoint takes the same DTO as `POST /expense-documents` but returns the proposed JE structure (lines + balanced flag) without committing. Frontend renders this every ~300 ms after form changes (debounced). Server is the source of truth — frontend never duplicates the rounding/aggregation logic.

This costs one extra network round-trip per change but **eliminates drift risk** between client preview and server posting. Worth it.

### Quick Start

- **เริ่มเปล่า** — clears form
- **จาก Template** — opens existing Favorites picker; instantiate uses existing `POST /expense-templates/:id/instantiate`
- **คัดลอกเก่า** — opens recent EXs list; clones lines + vendor (skips amount/date)
- **ใช้บ่อย** cards — top 6 most-used templates by `updatedAt DESC, isRecurring DESC` filtered to current branch + matching current type tab. Click instantiates immediately.

### Approver

- `approvedById` field already exists on `ExpenseDocument`
- Add to form (defaults to current user)
- **Not enforced** as 4-eye in this PR (creator can be approver) — flag policy for Phase A.7
- AuditLog on POST records both `createdById` and `approvedById`

---

## Migration Plan

Wipe-and-fresh consistent with parent PR #801. New migration `20260916000000_add_expense_lines`:

```sql
CREATE TABLE "expense_lines" ( ... );
ALTER TABLE "expense_details" DROP COLUMN "category";
ALTER TABLE "expense_details" ADD COLUMN "price_type" TEXT NOT NULL DEFAULT 'EXCLUSIVE';
```

Wipe CLI is unchanged — already truncates `expense_details` cascade which now cascades to `expense_lines`.

---

## Out of scope

- **4-eye approval enforcement** — defer to Phase A.7 (CPA review)
- **Recurring "duplicate detection"** — if same vendor + amount + date posted twice in 7 days, no warning yet
- **Per-line cost-center / project allocation** — defer until business needs it
- **Multi-currency** — single THB always (existing system constraint)
- **Discount at document-level** — only per-line discount (mockup matches)
- **Inline CoA creation** — user must pre-seed CoA codes via Settings → Chart of Accounts

---

## Test plan

- API: 8 unit tests for `createExpense` with multi-line, 4 tests for `previewJe`, 6 tests for line aggregation rounding edge cases
- JE template: re-verify all CPA golden CSV cases still pass (lines now drive Dr expenses) + 5 new cases for mixed-VAT and mixed-WHT invoices
- Frontend: 3 component tests (line editor add/remove/recompute), 1 e2e for full create-EX-with-3-lines-then-post flow
- Integration: full lifecycle test (create draft → preview JE → save → post → JE matches preview)

---

## Self-Review

- ✅ Multi-line covers all real Thai invoice cases (mixed VAT, mixed WHT, single-line still works as N=1)
- ✅ Schema parallel to PayrollLine/SettlementLine — consistent polymorphic pattern
- ✅ Server-computed totals + server-rendered JE preview = no client/server drift
- ✅ Smart defaults + Quick Start match the mockup's UX intent (cashier productivity)
- ✅ Wipe-and-fresh aligns with parent PR migration story
- ⚠️ Form is large — section count (7+) requires careful component decomposition. Plan task splits this into per-section subagents.
- ⚠️ JE preview at ~300ms debounce on every form change → ~3-5 server calls per save. Acceptable for desk app, monitor at scale.

---

## Implementation handoff

Use **superpowers:writing-plans** next to produce a tasked implementation plan. Estimated 18-22 tasks across schema → API → JE templates → frontend components → integration tests.
