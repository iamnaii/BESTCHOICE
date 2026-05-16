# C3 · Reverse Dialog + V19 (Period Guard)

**Status:** ⬜ Pending  |  **Started:** —  |  **PRs:** —
**Spec:** —  ·  **Plan:** —

## Context

Adds a modal Reverse Dialog with required reason (dropdown of 6 + free text), date picker bounded by V19 (`payment_date ≤ period_close_date + grace_days`), cascade check (block reverse if downstream SETTLEMENT/CN exists), and extended audit log capturing reason_code + reason_detail + reverse_je_id.

## Source

- [Settings Audit Core](_owner-package/Settings_Audit_Core_v2.0.md) §2.6 (V19) + §2.7 (Reverse Entry)
- [Mockup v5](_owner-package/expense_module_mockup_v5.md) page 02E Reverse Dialog

## Items Checklist

| ID | Item | Priority | Status | PR | Evidence/Notes |
|---|---|---|---|---|---|
| C3.1 | V19 validator — reverse date ≤ period_close_date + grace_days; soft warning if backdate > 30 days | P1 | ⬜ | — | File: `expense-documents.service.ts` |
| C3.2 | ReverseDialog modal component — 6-option dropdown + free text + JE before/after preview + date picker | P1 | ⬜ | — | New file: `apps/web/src/components/expense-form-v4/ReverseDialog.tsx` |
| C3.3 | Audit log schema — add `reason_code` (enum) + `reason_detail` (text) + `reverse_je_id` (FK) columns to `audit_log` (or extend existing JSON metadata field if present) | P1 | ⬜ | — | Migration |
| C3.4 | Cascade check service method — given an EX, return list of downstream SETTLEMENT/CN that reference it; block reverse if non-empty | P1 | ⬜ | — | New method on expense-documents.service.ts |
| C3.5 | Settings rows: `reverse_reason_required` / `reverse_reasons_dropdown` (6 strings) / `reverse_manager_approval_days` / `reverse_block_cascaded` | P1 | ⬜ | — | Maps to A1.2.7.1–A1.2.7.4 |

## Decision Log

(empty)

## Open Questions

- [ ] Q: C3.3 — extend existing audit_log schema or use existing JSON metadata field?
- [ ] Q: Manager approval after 7 days — soft (warning) or hard (block)?

## Dependencies

- ✅ T0
- A1 audit may flag existing reverse capability + audit columns — coordinate with C3.3 schema
