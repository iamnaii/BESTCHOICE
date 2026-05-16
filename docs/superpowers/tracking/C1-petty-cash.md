# C1 · Petty Cash Reimbursement

**Status:** ⬜ Pending  |  **Started:** —  |  **PRs:** —
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
| C1.1 | Add `PETTY_CASH_REIMBURSEMENT` to the expense doc type enum in `schema.prisma` + migration | P0 | ⬜ | — | File: `apps/api/prisma/schema.prisma` — verify actual enum name (likely `ExpenseDocumentType` or `DocType`) via `grep "PAYROLL.*SETTLEMENT" prisma/schema.prisma` |
| C1.2 | Schema: add `supplier_name` column to `expense_lines` (or new `petty_cash_lines` table) | P0 | ⬜ | — | Decision needed — see Open Questions |
| C1.3 | V20 validator: total ≤ `petty_cash_limit` setting, every line has `supplier_name`, doc has `cashAccountCode = 11-1201` | P0 | ⬜ | — | Add to expense-documents.service.ts |
| C1.4 | `PettyCashTemplate` JE generator — Dr per-line account + per-line VAT / Cr cashAccountCode | P0 | ⬜ | — | New file: `apps/api/src/modules/journal/cpa-templates/petty-cash.template.ts` |
| C1.5 | `PettyCashService` — limit lookup from settings, custodian assignment, replenish threshold alert | P0 | ⬜ | — | New file under `expense-documents/services/` |
| C1.6 | UI: `PettyCashFormV4` page following mockup 04B layout — header (date, custodian, account) + per-row supplier table + JE preview | P0 | ⬜ | — | New file under `apps/web/src/components/expense-form-v4/` |
| C1.7 | Settings rows: `petty_cash_enabled` / `petty_cash_account` / `petty_cash_limit` / `petty_cash_replenish_threshold` / `petty_cash_custodian` | P0 | ⬜ | — | Maps to A1.1.5.1–A1.1.5.5 |
| C1.8 | Voucher PDF template — mockup 04B layout (header + per-row supplier table, no signatures grid for petty cash) | P1 | ⬜ | — | New template under reporting/voucher templates |

## Decision Log

(empty)

## Open Questions

- [ ] Q: C1.2 — add `supplier_name` column to existing `expense_lines` table, or create separate `petty_cash_lines` polymorphic table? Existing pattern uses single `expense_lines` with nullable fields
- [ ] Q: Should petty cash allow WHT on a per-line basis (e.g. a ภ.ง.ด.3 vendor mixed in with cash receipts)?

## Dependencies

- ✅ T0
- A1 audit results may flag conflicts with existing `expense_lines` shape (A1.1.5.1–A1.1.5.5)

## Related anti-patterns

- ❌ Do NOT introduce `EMPLOYEE_REIMBURSEMENT` doc_type — owner is explicit it's `PETTY_CASH_REIMBURSEMENT`
- ❌ Do NOT enforce single supplier on petty cash docs — it's a deliberate exception to the 1-doc-1-supplier rule
