# C4 · Credit Note 2-Mode UI

**Status:** ⬜ Pending  |  **Started:** —  |  **PRs:** —
**Spec:** —  ·  **Plan:** —

## Context

Existing CREDIT_NOTE doc_type assumes you've already created the source EXP. Mockup adds explicit two-mode UX:
- **Mode A** — Linked to existing invoice: pick source EX, auto-load supplier/lines/VAT, edit credited amounts per line
- **Mode B** — Standalone: free-form supplier + lines (for cases like supplier refund without original invoice)

JE shape is the existing CN reversal logic — this sub-project is mostly UI + a metadata flag distinguishing modes for ภ.30 reconciliation.

## Source

- [Mockup v5](_owner-package/expense_module_mockup_v5.md) page 02D Credit Note Page

## Items Checklist

| ID | Item | Priority | Status | PR | Evidence/Notes |
|---|---|---|---|---|---|
| C4.1 | UI: Mode selector at top of CreditNoteForm (radio: Linked / Standalone) | P2 | ⬜ | — | New section in `apps/web/src/components/expense-form-v4/` |
| C4.2 | Mode A — auto-load source EX (supplier, lines, VAT) into editable rows; credit amount defaults to source amount | P2 | ⬜ | — | Reuses existing CN-from-EX flow if it exists |
| C4.3 | Mode B — standalone form with supplier picker + free-form lines (no source EX FK) | P2 | ⬜ | — | New form variant |
| C4.4 | Metadata field `creditNoteMode` (`LINKED` / `STANDALONE`) on `CreditNote` schema; ภ.30 export filters appropriately | P2 | ⬜ | — | Schema migration |

## Decision Log

(empty)

## Open Questions

- [ ] Q: For Mode A, when source EX is partial-paid, should the credit amount cap at remaining-AP or allow over-credit?

## Dependencies

- ✅ T0
- Existing CREDIT_NOTE template (`credit-note.template.ts`) stays unchanged — only UI + metadata changes
