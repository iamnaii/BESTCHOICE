# B2 · Settlement Multi-line Adjustment (V12 expansion)

**Status:** ⬜ Pending  |  **Started:** —  |  **PRs:** —
**Spec:** —  ·  **Plan:** —

## Context

V12 currently validates adjustment sums for `EXPENSE_SAMEDAY` only (`Σ adjustments = amountPaid − netExpected`). Dev Action #2 extends V12 to cover `VENDOR_SETTLEMENT` and adds adjustment lines to `VendorSettlementTemplate`. Real-world need: supplier gives a discount at settlement time, or there's a small rounding diff after WHT — both should flow through Section 5 (Multi-line Adjustment) in `ExpenseFormV4`.

## Source

- [Dev Action Items](_owner-package/Dev_Action_Items_v1.0.md) Action #2
- [Mockup v5](_owner-package/expense_module_mockup_v5.md) page 02A SettlementPage Section 5

## Items Checklist

| ID | Item | Priority | Status | PR | Evidence/Notes |
|---|---|---|---|---|---|
| B2.1 | V12 validator: extend switch to include `VENDOR_SETTLEMENT` case computing `netExpected = apTotal − wht` | P1 | ⬜ | — | File: `apps/api/src/modules/expense-documents/expense-documents.service.ts` (search for "V12") |
| B2.2 | `VendorSettlementTemplate.execute` — emit adjustment lines from `settlement.adjustments[]` after WHT line | P1 | ⬜ | — | File: `apps/api/src/modules/journal/cpa-templates/vendor-settlement.template.ts` |
| B2.3 | DB schema: ensure `expense_adjustments` table has FK to `expense_documents` that accepts `VENDOR_SETTLEMENT` rows. If a CHECK constraint restricts doc_type, relax it per Dev Action #2 §2.4 | P1 | ⬜ | — | Run `\d expense_adjustments` against dev DB to verify |
| B2.4 | Frontend: add Section 5 (Multi-line Adjustment) to SettlementForm — reuse `AdjustmentTable` component from ExpenseFormV4 | P1 | ⬜ | — | File: `apps/web/src/components/expense-form-v4/SettlementLinesSection.tsx` (add new section beneath) |
| B2.5 | K-07 test case: SETTLEMENT + adjustment results in balanced JE with `52-1104` Cr line | P1 | ⬜ | — | Tracks B3.K-07. File: `apps/api/src/modules/expense-documents/__tests__/settlement-lifecycle.integration.spec.ts` |

## Decision Log

(empty)

## Open Questions

- [ ] Q: Should the schema migration in B2.3 happen — or does the FK already allow polymorphic doc_type? Need `\d` output first
- [ ] Q: SettlementForm Section 5 — should the section appear before or after JE Preview?

## Dependencies

- ✅ T0
- B2.5 depends on test infrastructure (B3 Suite K)
