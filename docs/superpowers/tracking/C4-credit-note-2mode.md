# C4 · Credit Note 2-Mode UI

**Status:** ✅ Done (4/4)  |  **Started:** 2026-05-16  |  **PRs:** #877 (backend) · this PR (UI)
**Spec:** —  ·  **Plan:** —

## Context

Existing CREDIT_NOTE doc_type assumes you've already created the source EXP. Mockup adds explicit two-mode UX:
- **Mode A (LINKED)** — Linked to existing invoice: pick source EX, auto-load supplier/lines/VAT, edit credited amounts per line
- **Mode B (STANDALONE)** — Standalone: free-form supplier + lines (for cases like supplier refund without original invoice)

JE shape is the existing CN reversal logic — backend branches on `creditNote.mode` to skip the original lookup + cap check in STANDALONE.

## Source

- [Mockup v5](_owner-package/expense_module_mockup_v5.md) page 02D Credit Note Page

## Items Checklist

| ID | Item | Priority | Status | PR | Evidence/Notes |
|---|---|---|---|---|---|
| C4.1 | UI: Mode selector at top of CreditNoteForm (radio: Linked / Standalone) | P2 | ✅ | this PR | Two chip-card buttons at top of [`CreditNoteLinesSection`](../../../apps/web/src/components/expense-form-v4/CreditNoteLinesSection.tsx) — `Link2`/`FilePlus2` icons + aria-pressed. Switching modes wipes the cross-mode fields so server-side validation doesn't see stale values. `state.cnMode` (`'LINKED' \| 'STANDALONE'`) added to `ExpenseFormState`. |
| C4.2 | Mode A — auto-load source EX (supplier, lines, VAT) into editable rows; credit amount defaults to source amount | P2 | ✅ | #877 + this PR | Backend inherits `vendorName`/`vendorTaxId` from source onto the CN doc. UI source-doc picker (existing) auto-loads ExpenseLine rows when selected — quantity=1, unitPrice=source.amountBeforeVat, editable. Cap-bound by server. |
| C4.3 | Mode B — standalone form with supplier picker + free-form lines (no source EX FK) | P2 | ✅ | #877 + this PR | Backend: DTO accepts `mode: 'STANDALONE'` + required `vendorName`; service skips original lookup/cap/branch-match; template branches Dr leg on `creditNote.mode` (Dr 21-1104 if no deposit, Dr cash if deposit set). UI: STANDALONE renders vendor inputs (name required, taxId optional) + reason + free-form `ItemLinesSection`. Form omits `depositAccountCode` for STANDALONE per mockup §4 → backend takes Dr 21-1104 path. |
| C4.4 | Metadata field `creditNoteMode` (`LINKED` / `STANDALONE`) on `CreditNote` schema; ภ.30 export filters appropriately | P2 | ✅ | #877 | `CreditNoteMode` enum + `mode` column (default `LINKED`) on `credit_note_details`. `original_document_id` nullable. Migration `20260930000000_credit_note_2mode`. PP30 query already excludes CN via `debit > 0` on 11-4101 (CN books `Cr 11-4101`) — naturally excludes both LINKED + STANDALONE. New `expense-credit-note-standalone` flow string + metadata.mode lets future reports distinguish if needed. |

## Decision Log

- **2026-05-16:** Backend-first PR (#877) — DTO/service/template/migration/tests ready. UI shipped next in this PR.
- **2026-05-16:** Q1 answered — for LINKED Mode A partial-paid source, cap stays at `original.totalAmount − Σ prior CN totals` (existing behavior). Owner can revisit if remaining-AP semantics become needed.
- **2026-05-16:** STANDALONE refund routing: no `depositAccountCode` → Dr 21-1104 (AP-credit-pending); `depositAccountCode` set → Dr cash. UI omits depositAccountCode for STANDALONE per mockup §4 → defaults to AP-clearing. Cash-refund-STANDALONE supported by backend but not surfaced yet; add a toggle later if owner needs it.
- **2026-05-16:** PP30 filter unchanged — existing `debit > 0` on 11-4101 + `flow LIKE 'expense-%'` naturally excludes CN reversals (both LINKED + STANDALONE) since they book `Cr 11-4101`. No tax.service change required.

## Open Questions

- [x] Q: For Mode A, when source EX is partial-paid, should the credit amount cap at remaining-AP or allow over-credit? — **Keep original.totalAmount − Σ prior CN cap** for now.

## Dependencies

- ✅ T0
- Existing CREDIT_NOTE template (`credit-note.template.ts`) — extended for STANDALONE branch (no source lookup)
