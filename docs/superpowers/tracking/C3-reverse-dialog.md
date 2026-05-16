# C3 · Reverse Dialog + V19 (Period Guard)

**Status:** ✅ Done (4/5)  |  **Started:** 2026-05-16  |  **PRs:** #875 (backend) · this PR (UI). Only C3.5 settings deferred to A1.
**Spec:** —  ·  **Plan:** —

## Context

Adds a modal Reverse Dialog with required reason (dropdown of 6 + free text), date picker bounded by V19 (`payment_date ≤ period_close_date + grace_days`), cascade check (block reverse if downstream SETTLEMENT/CN exists), and extended audit log capturing reason_code + reason_detail + reverse_je_id.

## Source

- [Settings Audit Core](_owner-package/Settings_Audit_Core_v2.0.md) §2.6 (V19) + §2.7 (Reverse Entry)
- [Mockup v5](_owner-package/expense_module_mockup_v5.md) page 02E Reverse Dialog

## Items Checklist

| ID | Item | Priority | Status | PR | Evidence/Notes |
|---|---|---|---|---|---|
| C3.1 | V19 validator — reverse date ≤ period_close_date + grace_days; soft warning if backdate > 30 days | P1 | 🔵 | TBD | [`voidDocument`](../../../apps/api/src/modules/expense-documents/expense-documents.service.ts) now accepts optional `reverseDate` in DTO. When provided, reversal JE `postedAt` derives from it via `bkkBusinessDate(new Date(dto.reverseDate))` and `validatePeriodOpen` runs against that date (V19). Soft warning for >30-day backdate is UI concern (C3.2). |
| C3.2 | ReverseDialog modal component — 6-option dropdown + free text + JE before/after preview + date picker | P1 | ✅ | this PR | [ReverseDialog.tsx](../../../apps/web/src/components/expense-form-v4/ReverseDialog.tsx) — shadcn Dialog. 6-option reason dropdown matching backend enum, conditional `reasonDetail` (required when reason=other), ThaiDateInput reverseDate (defaults today BKK), soft warning when backdate > 30 days. Wired into `ExpensesPage` — replaces generic `ConfirmDialog` on the void-action menu item. POST forwards full payload; backend (V19 + cascade + audit from #875) re-validates. JE before/after preview deferred (would require server-side preview endpoint; not blocking for v2.0). |
| C3.3 | Audit log schema — add `reason_code` (enum) + `reason_detail` (text) + `reverse_je_id` (FK) columns to `audit_log` (or extend existing JSON metadata field if present) | P1 | 🔵 | TBD | **Decision (Q1): use existing `newValue` JSON** instead of new columns. AuditLog has a Merkle hash chain — adding columns would break verification on existing rows. `voidDocument` now writes `tx.auditLog.create({ action: 'EXPENSE_VOIDED', entity: 'expense_document', newValue: { status, reverseJournalEntryId, reverseDate, reasonCode, reasonDetail, documentNumber, documentType } })`. Reason metadata also embedded in the reversal JE's own `metadata.reverseReasonCode/Detail` so JE-side queries don't need to join `audit_logs`. |
| C3.4 | Cascade check service method — given an EX, return list of downstream SETTLEMENT/CN that reference it; block reverse if non-empty | P1 | 🔵 | TBD | Extended existing cascade check in `voidDocument` (pre-existing CN check) to also count active VENDOR_SETTLEMENT docs whose `settlement.settlementLines` reference this doc. Blocks with Thai error if any exist. Voiding a SE itself still cascades-revert cleared EXs back to ACCRUAL (existing behavior, separate path). |
| C3.5 | Settings rows: `reverse_reason_required` / `reverse_reasons_dropdown` (6 strings) / `reverse_manager_approval_days` / `reverse_block_cascaded` | P1 | ⬜ | — | **Deferred to A1.** Backend currently uses a hard-coded 6-option enum in `VoidExpenseDocumentDto`. Owner can later add settings rows + service-side override of the whitelist when /settings UI is built. The cascade block (C3.4) is always-on for now per safety. |

## Decision Log

- **2026-05-16:** Backend bundle (3/5 items) in one PR — C3.1 + C3.3 + C3.4. UI (C3.2) + Settings (C3.5) deferred. Same pattern as B2/C1/C2.
- **2026-05-16:** Q1 answered — embed reason metadata in existing AuditLog `newValue` JSON (not new columns). AuditLog has Merkle hash chain so column additions break verification.
- **2026-05-16:** Q2 answered — soft warning (UI concern, ships with C3.2). Server doesn't block based on backdate age; only enforces V19 (period-open).
- **2026-05-16:** Reason metadata duplicated into the reversal JE's own `metadata` field — lets accounting queries grep by reason without joining `audit_logs`.

## Open Questions

- [x] Q: C3.3 — extend existing audit_log schema or use existing JSON metadata field? — **JSON field**. Merkle chain concerns.
- [x] Q: Manager approval after 7 days — soft (warning) or hard (block)? — **Soft (UI-only)**.

## Dependencies

- ✅ T0
- A1 audit may flag existing reverse capability + audit columns — coordinate with C3.3 schema
