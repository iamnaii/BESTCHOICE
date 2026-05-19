# Phase 4 — FINANCE Menu Completion Design

**Status**: Design (awaiting approval)
**Author**: Akenarin Kongdach (via Claude Code session 2026-05-19)
**Target**: Close remaining FINANCE-menu placeholder gaps from owner CSV
**Predecessor**: PR #1025 (FIN restructure) + PR #1026 (15 placeholders)

## Problem

After PRs #1023–#1026 reorganized the FINANCE-zone sidebar to mirror the owner's CSV layout, **21 of ~43 visible menu items are still placeholders** that route to `ComingSoonPage`. Owner asked "ใช้งานได้ครบไหม?" — the honest answer is **~52% functional, ~48% placeholder**.

This phase closes those gaps in a structured way: 5 sub-projects covering the SP2/SP3/SP4/SP5/SP6 buckets already tagged in the menu config + 4 backend features the CSV explicitly flagged "⚠️ ต้องเพิ่ม".

## Goals

1. Turn every menu placeholder into a real, functional page.
2. Implement the 4 backend features the CSV explicitly demanded (VAT Auto Journal UI, WHT monthly summary, Dashboard widgets).
3. Keep each sub-project small enough to ship as its own PR with full review (~3-5 days each).

## Non-Goals

- "เบิกลงทุน" (capital withdrawal, CSV §5) — flow unclear, **deferred** until owner clarifies.
- "เอกสารใช้ในให้ทำระดับ" (CSV §2) — OCR text is unreadable, **deferred**.
- Architectural changes to JE templates / CoA — Phase A.4 chart is the foundation.
- SHOP-side feature additions — this phase is FINANCE-only.

## Scope — 5 Sub-Projects

### P4-SP1 — งบการเงิน + รายงานบัญชี

The biggest sub-project. Provides the four-statement financial report set + the receivable/journal report family. Foundation that P4-SP4 (Inter-co report) and P4-SP5 (Dashboard widgets) reuse.

**Deliverables (7 pages):**

| Path | Page | Data source |
|------|------|------------|
| `/finance/balance-sheet` | งบดุล (Balance Sheet) | `accounting.service.getBalanceSheetFromJournal` (exists) |
| `/finance/cash-flow` | งบกระแสเงินสด | Derive from JournalEntry where account starts `11-1` (cash) |
| `/finance/equity-statement` | งบ Equity | Sum 33-XXXX retained earnings + capital movements |
| `/finance/general-journal` | สมุดรายวันทั่วไป (chronological JE list) | `JournalEntry.findMany` ordered by `postedAt` |
| `/finance/general-ledger` | สมุดแยกประเภท (per-account ledger) | `JournalLine.findMany` group by `accountCode` |
| `/finance/aging-report` | รายงานลูกหนี้ + Aging buckets | `Payment` + `Contract` joined, bucket by overdue days |
| `/finance/bad-debt-report` | รายงานหนี้สูญ | `JournalLine where accountCode = '51-1102'` + supporting customer details |

**Date filter on every page:** ปีงบ + ช่วง (เริ่ม-สิ้น) + companyId (SHOP/FINANCE/ALL). Same `DateRangePicker` + `CompanyFilter` pattern from existing P&L page.

**Export:** All 7 pages support PDF (jspdf-html2canvas, same as existing reports) + Excel (exceljs). Bundle splitting: lazy-import the export utils per page.

**Effort:** 4-5 days (8 PRs if 1 page = 1 PR; can collapse to 2-3 grouped PRs).

### P4-SP2 — ภาษี UI (VAT/WHT/e-Tax + Auto Journal + e-Receipt)

Tax module already has the CPA journal templates in place — VAT is recorded into 21-2101/21-2102 on every PaymentReceipt2B JE. This sub-project builds the **submission/consolidation UI** on top.

**Deliverables (5 pages):**

| Path | Page | Notes |
|------|------|-------|
| `/finance/vat` | VAT (ภ.พ.30) monthly | Reads JournalLine where account in (`21-2101`, `21-2102`); supports submit-status flag + e-filing XML export (ขมธอ.21-2562 — same lib as P2-SP5 e-Tax) |
| `/finance/wht` | WHT (ภ.ง.ด.1/3/53) monthly | Reads `21-3102`, `21-3103`, `21-3105` (SSO) + per-form aggregation; PDF for filing |
| `/finance/e-tax` | e-Tax Invoice center | List + status + manual resend; bridges existing e-Tax XML pipeline |
| `/finance/vat-auto-journal` | VAT Auto Journal viewer | History view: per-period JE entries that touched VAT accounts; export to PEAK |
| `/finance/e-receipt-auto` | ใบเสร็จอิเล็กทรอนิกส์อัตโนมัติ config | Toggle on/off + template choice + LINE delivery rules |

**Dependency:** Existing CPA templates (`InstallmentAccrual2A`, `PaymentReceipt2B`, `Vat60dayMandatory`, etc.) already write VAT correctly. No template changes needed.

**Effort:** 4-5 days.

### P4-SP3 — ตั้งค่าเอกสาร 8 doc types (tabbed UI)

Currently 8 doc-type sub-items in the menu all point to separate `/settings/document-config/<type>` placeholder routes. Better UX: **single page with 8 tabs** (รายรับ × 3 + รายจ่าย × 5) — keeps the menu hint structure but the actual config is unified.

**Deliverables (1 page, 8 tabs):**

- Tab UI on `/settings/document-config`:
  - รายรับ: ใบรับเงินมัดจำ / ใบเสร็จรับเงิน / ใบลดหนี้
  - รายจ่าย: ใบสั่งซื้อ / ค่าใช้จ่าย / รับใบลดหนี้ / ใบรวมจ่าย / ซื้อสินทรัพย์
- Per-tab config: number prefix · running pattern · footer text · approval requirements · attachment policy
- Menu sub-items keep their `/settings/document-config/<type>` paths but route to the same `DocumentConfigPage` with the matching tab pre-selected via URL param (e.g. `?tab=receipt`).
- Backend: extend `SystemConfig` keys for the 5 new doc types (matches the existing P2-SP2 schema).

**Effort:** 2-3 days.

### P4-SP4 — ยกเลิกสัญญา + Inter-co Report

Two related but distinct features. ยกเลิกสัญญา writes JE reversals; Inter-co report consumes the existing `21-1101`/`21-1102` (จ่ายให้หน้าร้าน + ค่าคอม) flow.

**Deliverables (2 pages + 1 backend):**

1. **เอกสารยกเลิกสัญญา** (`/finance/contract-cancellation`)
   - List of contracts pending cancellation (Contract.status = 'CANCEL_PENDING')
   - Approval flow: SALES requests → OWNER/FM approves → JE reversal posts
   - JE template: reverse the activation entries (`ContractActivation1A`) — Dr 21-1101 / Cr 11-2101 etc.
   - Refund flow: if customer pre-paid, refund logic + journal
   - PDF: cancellation memo (ม.86/4 style)

2. **รายงานลูกหนี้ Inter-co** (`/finance/intercompany-report`)
   - Per-period view: amounts FINANCE owes SHOP (down payment relay + commission)
   - Drill-down per contract showing the matched JE pair
   - Reconciliation: shows any drift between FINANCE Cr 21-1101 vs SHOP Dr (paired SHOP JE expected to land once SHOP module ships in P3-SP5)

**Dependency:** Must wait for **P4-SP1** to ship `general-journal` / `general-ledger` pages — Inter-co report deep-links to them.

**Effort:** 3-4 days.

### P4-SP5 — Dashboard FINANCE widgets

Quick win: ~3 widget cards that surface SP1's data on the Dashboard. Owner sees these immediately on login.

**Deliverables (3 widgets on `/` Dashboard, FIN-zone-only):**

| Widget | Card | Data source |
|---|---|---|
| Aging summary | Buckets 0-30/31-60/61-90/90+ days, color-coded | Same query as SP1 aging-report |
| Alert ติดตามหนี้วันนี้ | List of customers with promise-to-pay due today (PromiseSlot.cycleDeadline = today) | PromiseSlot table |
| สรุปสัญญาใหม่/ครบกำหนด | This month: new contracts + contracts hitting last installment | Contract + Payment |

Conditional render: only when `currentZone === 'fin'` (existing `useLayout` hook).

**Dependency:** Wait for P4-SP1 (Aging data structure).

**Effort:** 1-2 days.

## Dependency Graph

```
P4-SP1 ─────┬──→ P4-SP4 (Inter-co needs SP1's ledger views)
            └──→ P4-SP5 (Dashboard widgets need SP1's Aging logic)

P4-SP2 (independent — can run parallel with SP1)
P4-SP3 (independent — can run parallel with SP1)
```

## Execution Order

**Wave 1 — 3 parallel streams (1.5-2 weeks):**

- P4-SP1 (งบ + รายงาน) — biggest, foundation
- P4-SP2 (ภาษี UI) — independent
- P4-SP3 (Doc Config tabs) — independent

**Wave 2 — after Wave 1 ships (~1 week):**

- P4-SP4 (ยกเลิก + Inter-co) — depends on SP1
- P4-SP5 (Dashboard widgets) — depends on SP1

**Total calendar time**: ~3 weeks if parallelized, ~5 weeks if serial.

## Per-SP Acceptance Criteria

Every sub-project must meet these before merge:

- 🟢 TypeScript: 0 errors
- 🟢 Vitest: all existing tests pass; new tests added for any non-trivial logic (aging buckets, JE reversal, etc.)
- 🟢 ESLint: 0 errors
- 🟢 Vite build: success (no chunk warnings beyond current baseline)
- 🟢 New routes: a `ComingSoonPage` replaced by real page (or the placeholder marker removed from menu config)
- 🟢 Role gating: ProtectedRoute with appropriate `roles=[]`
- 🟢 PDF/Excel export: where the page is a report
- 🟢 Visual review on `bestchoicephone.app` after merge
- 🟢 Web version bumped (26.5.X → 26.5.X+1)

## Risk + Open Questions

1. **"เบิกลงทุน" (CSV §5)** — Deferred. If this means capital withdrawal by the owner, it needs its own design (touches Owner equity accounts 33-XXXX, withdrawal limits, partner consent if multi-owner).
2. **"เอกสารใช้ในให้ทำระดับ" (CSV §2)** — OCR unreadable. Deferred until owner re-states the requirement.
3. **SP2 e-filing XML format** — VAT submission XML format depends on Revenue Department's current schema. Confirm version (อ.อ.ก.) before SP2 begins.
4. **SP4 ยกเลิกสัญญา refund logic** — If customer has paid more than the equipment's residual value, where does the difference book to? (47-XXXX gain on cancellation? Or refund equals exact amount, no JE on diff?) — Need CPA sign-off before SP4 ships.
5. **SP3 doc-config schema** — adding 5 new SystemConfig keys is additive but the page UI grows large with 8 tabs. May split into 2 pages (รายรับ vs รายจ่าย) if scrolling becomes a problem.

## What This Phase Does Not Include

- New JE template authoring (SP4 reverse is the only template change; everything else uses existing templates)
- New CoA accounts (Phase A.4 chart is frozen)
- SHOP-side accounting expansion (Phase 3 SP5 already shipped basic SHOP chart)
- Mobile-specific UX work for these pages (responsive only via existing Tailwind breakpoints)
- New role types (only OWNER + FINANCE_MANAGER + ACCOUNTANT see these pages)

## Next Step

After this design is approved by owner, hand off to `writing-plans` skill to create the implementation plan per sub-project (5 plans, one per SP).
