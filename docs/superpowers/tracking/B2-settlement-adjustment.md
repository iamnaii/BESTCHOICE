# B2 · Settlement Multi-line Adjustment (V12 expansion)

**Status:** 🔵 In Review  |  **Started:** 2026-05-16  |  **PRs:** TBD (backend bundled; frontend B2.4 deferred)
**Spec:** —  ·  **Plan:** —

## Context

V12 currently validates adjustment sums for `EXPENSE_SAMEDAY` only (`Σ adjustments = amountPaid − netExpected`). Dev Action #2 extends V12 to cover `VENDOR_SETTLEMENT` and adds adjustment lines to `VendorSettlementTemplate`. Real-world need: supplier gives a discount at settlement time, or there's a small rounding diff after WHT — both should flow through Section 5 (Multi-line Adjustment) in `ExpenseFormV4`.

## Source

- [Dev Action Items](_owner-package/Dev_Action_Items_v1.0.md) Action #2
- [Mockup v5](_owner-package/expense_module_mockup_v5.md) page 02A SettlementPage Section 5

## Items Checklist

| ID | Item | Priority | Status | PR | Evidence/Notes |
|---|---|---|---|---|---|
| B2.1 | V12 validator: extend to `VENDOR_SETTLEMENT` case computing `netExpected = sumSettled − wht` | P1 | 🔵 | TBD | Extracted shared `validateAdjustments(tx, opts)` private helper in [expense-documents.service.ts](../../../apps/api/src/modules/expense-documents/expense-documents.service.ts) and called from both `create` (EXPENSE) and `createSettlement` (SE). Same V12/V13/V14 logic, same ADJUSTMENT_ALLOWLIST. |
| B2.2 | `VendorSettlementTemplate.execute` — emit adjustment lines from `doc.adjustments[]` after WHT line | P1 | 🔵 | TBD | [vendor-settlement.template.ts](../../../apps/api/src/modules/journal/cpa-templates/vendor-settlement.template.ts) — `include: { adjustments }`, cash leg now sourced from `doc.netPayment` (which createSettlement set to amountPaid honoring V12), then iterates `doc.adjustments` to emit one Dr/Cr line each per declared side. Existing balanced-JE check in `JournalAutoService.createAndPost` proves V12 invariant end-to-end. |
| B2.3 | DB schema: ensure `expense_adjustments` FK accepts `VENDOR_SETTLEMENT` rows | P1 | ✅ | n/a | Verified `\d expense_adjustments` on dev DB: FK references `expense_documents(id)` with no CHECK constraint on document_type — polymorphic by design. No migration needed. |
| B2.4 | Frontend: add Section 5 (Multi-line Adjustment) to SettlementForm — reuse `AdjustmentTable` component from ExpenseFormV4 | P1 | ⬜ | — | **Deferred to follow-up PR** to keep this PR backend-scoped + reviewable. Backend DTO already accepts `adjustments[]` + `amountPaid` so the UI work is purely additive (no further backend changes needed). |
| B2.5 | K-07 test case: SETTLEMENT + adjustment results in balanced JE with allow-list Cr line | P1 | 🔵 | TBD | 3 new integration tests added to [settlement-lifecycle.integration.spec.ts](../../../apps/api/src/modules/expense-documents/__tests__/settlement-lifecycle.integration.spec.ts): (1) happy path SE with 20฿ discount → balanced JE Dr 21-1104 1000 / Cr cash 980 / Cr 52-1106 20; (2) negative V12 violation; (3) negative V13 violation (rev account 41-1101 rejected). Unit specs: 52/52 pass on the touched suites. |

## Decision Log

- **2026-05-16:** Bundled B2.1+B2.2+B2.3(verify)+B2.5 backend into one PR. Frontend (B2.4) deferred to a follow-up to keep this PR backend-scoped — DTO already accepts the new fields, so UI is purely additive with no further backend changes.
- **2026-05-16:** Extracted shared `validateAdjustments(tx, opts)` helper in `ExpenseDocumentsService` rather than copy-paste V12/V13/V14 between `create` (EXPENSE) and `createSettlement` (SE). DRY win; one place to evolve allow-list / messages.
- **2026-05-16:** SE template cash leg now sourced from `doc.netPayment` (which the service sets to `dto.amountPaid ?? sumSettled − wht` during create). Previously the template derived cash as `sumSettled − wht`, which would have ignored any adjustments-driven delta. Now V12 invariant (`Σ signed(adj) === amountPaid − netExpected`) keeps the JE balanced automatically.

## Open Questions

- [x] Q: Should the schema migration in B2.3 happen — or does the FK already allow polymorphic doc_type? Need `\d` output first — **No migration needed**. FK on `expense_adjustments.document_id → expense_documents.id` with no CHECK on document_type. Polymorphic by design.
- [ ] Q: SettlementForm Section 5 — should the section appear before or after JE Preview? — **Deferred to B2.4 follow-up PR**

## Dependencies

- ✅ T0
- ✅ ExpenseDocument.adjustments relation (already in schema since P0-4)
- B2.4 (frontend) is a follow-up after this PR lands — UI is purely additive
