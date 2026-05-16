# C1 · Petty Cash Reimbursement

**Status:** 🔵 In Review  |  **Started:** 2026-05-16  |  **PRs:** #867 (backend) + this PR (UI). PDF (C1.8) still deferred.
**Spec:** —  ·  **Plan:** —

## Context

New `PETTY_CASH_REIMBURSEMENT` doc_type for small-cash workflow: custodian advances petty cash, employees submit multiple receipts (different suppliers, possibly different VAT rates) on one document. Existing doc_types enforce single-supplier-per-document; petty cash relaxes this with `supplier_per_line`. V20 enforces invariants (total ≤ limit, every line has supplier, Cr account = 11-1201 not 11-1103).

JE shape: Dr each `53-XXXX` per line + Dr `11-4101` for VATable lines / Cr `11-1201` (bank that replenishes petty cash float).

## Source

- [Settings Audit Core](_owner-package/Settings_Audit_Core_v2.0.md) §1.5
- [Mockup v5](_owner-package/expense_module_mockup_v5.md) page 04B Petty Cash

## Items Checklist

| ID | Item | Priority | Status | PR | Evidence/Notes |
|---|---|---|---|---|---|
| C1.1 | Add `PETTY_CASH_REIMBURSEMENT` to `DocumentType` enum + migration | P0 | 🔵 | TBD | [schema.prisma](../../../apps/api/prisma/schema.prisma) extends `DocumentType` enum. [Migration 20260928000000_petty_cash_reimbursement](../../../apps/api/prisma/migrations/20260928000000_petty_cash_reimbursement/migration.sql) — `ALTER TYPE "DocumentType" ADD VALUE 'PETTY_CASH_REIMBURSEMENT'`. `DocNumberService` PREFIX_MAP gets `PC` prefix → docs number `PC-YYYYMMDD-NNNN`. |
| C1.2 | Schema: add `supplier_name` column to `expense_lines` | P0 | 🔵 | TBD | **Decision (Q1): added nullable column** to existing `expense_lines` rather than a separate polymorphic `petty_cash_lines` table — minimal disruption and matches the established 1-detail-many-lines pattern. Same migration as C1.1 adds `ALTER TABLE expense_lines ADD COLUMN supplier_name TEXT`. For other DocumentTypes the column stays null and the doc-level `vendorName` is used. |
| C1.3 | V20 validator: total ≤ limit, every line has supplier, account = 11-1201 | P0 | 🔵 | TBD | `PettyCashService.validate(opts, config)` enforces V20.1/V20.2/V20.3. Called from `createPettyCash` in `expense-documents.service.ts` before persist. Thai error messages with code prefix. 9 unit tests in [petty-cash.service.spec.ts](../../../apps/api/src/modules/expense-documents/services/__tests__/petty-cash.service.spec.ts). |
| C1.4 | `PettyCashTemplate` JE generator | P0 | 🔵 | TBD | [petty-cash.template.ts](../../../apps/api/src/modules/journal/cpa-templates/petty-cash.template.ts) — emits Dr per-line category + Dr 11-4101 (aggregated VAT) / Cr depositAccountCode. Idempotent via journalEntryId probe. Per-line `supplierName` flows into JE line description for audit trail. `metadata.flow = 'expense-petty-cash'` so PP30 (K-04) picks up the input VAT correctly. |
| C1.5 | `PettyCashService` — config lookup + V20 | P0 | 🔵 | TBD | [petty-cash.service.ts](../../../apps/api/src/modules/expense-documents/services/petty-cash.service.ts) — `getConfig()` reads SystemConfig keys with defaults (`account: 11-1201, limit: 5000`). `createPettyCash` orchestrates: compute lines → aggregate → V20 validate → persist with `ExpenseDetail` + per-line supplier. New `POST /expense-documents/petty-cash` controller endpoint. |
| C1.6 | UI: `PettyCashFormV4` page | P0 | 🔵 | this PR | [PettyCashLinesSection.tsx](../../../apps/web/src/components/expense-form-v4/PettyCashLinesSection.tsx) — per-line table (supplier / category / description / amount / VAT% / tax-invoice). Wires into existing `ExpenseFormV4` rather than a new page — DocTypePicker now 6 chips, render gate adds `PETTY_CASH_REIMBURSEMENT` case, POST handler targets `/expense-documents/petty-cash`. Reuses `CashAccountVisualPicker` for the float account. Custodian name is doc-level (header), suppliers are per-line. ExpensesPage list shows `Petty Cash` label badge. |
| C1.7 | Settings rows: `petty_cash_*` keys | P0 | ⬜ | deferred to A1 | Owner can add via /settings UI when ready. `PettyCashService.getConfig()` falls back to safe defaults if rows are absent (account=11-1201, limit=5000) so the feature works out-of-the-box. Maps to A1.1.5.1–A1.1.5.5 which will land in the Settings Audit phase. |
| C1.8 | Voucher PDF template (mockup 04B) | P1 | ⬜ | — | **Deferred to follow-up PR**. Standalone work that doesn't gate API usage. Receipt PDF service can be extended in a separate session. |

## Decision Log

- **2026-05-16:** Backend bundle approach (mirrors B2). 6/8 items in one PR (1, 2, 3, 4, 5, controller). UI (6) + PDF (8) deferred to follow-up — backend DTO already accepts the right shape so UI is purely additive. C1.7 settings rows deferred to A1 (admin UI work). Service falls back to safe defaults so feature works without those rows.
- **2026-05-16:** Q1 answered — single `expense_lines` with nullable `supplier_name`. Existing pattern; no polymorphic refactor. Other DocumentTypes keep the column null.
- **2026-05-16:** Q2 answered — NO WHT on petty cash. Small-cash workflow scope. Vendors that need WHT use regular EXPENSE flow. DTO + template enforce this (no `whtAmount` field, no WHT line in JE).

## Open Questions

- [x] Q: C1.2 — add `supplier_name` column to existing `expense_lines` table, or create separate `petty_cash_lines` polymorphic table? — **Existing `expense_lines` with nullable column**. Minimal disruption.
- [x] Q: Should petty cash allow WHT on a per-line basis? — **No**. Out of scope; use EXPENSE flow for WHT vendors.

## Dependencies

- ✅ T0
- ✅ A0/A1 don't block this PR (default config kicks in)
- C1.6 UI follow-up should reuse `ExpenseFormV4` like other doctypes (add `PETTY_CASH_REIMBURSEMENT` to DocTypePicker + new section component for per-row supplier table)

## Related anti-patterns

- ❌ Do NOT introduce `EMPLOYEE_REIMBURSEMENT` doc_type — owner is explicit it's `PETTY_CASH_REIMBURSEMENT`
- ❌ Do NOT enforce single supplier on petty cash docs — it's a deliberate exception to the 1-doc-1-supplier rule
