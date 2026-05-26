# Pre-Merge Guard Report — 2026-05-26

**Agent**: Pre-Merge Guard  
**Date**: 2026-05-26  
**Branches reviewed**: 3 (of 624 unmerged)  
**Selection criteria**: most recently committed non-guard/non-watchdog branches

---

## Branch 1: `feat/canned-response-channel-tabs`

**Author**: Akenarin Kongdach  
**Latest commit**: ~18 hours ago — `fix(canned-response): Phase 2b — review issues C/W1/W2 channel tabs`

### File changes (5 files, +277 / -20)
| File | Change |
|------|--------|
| `BubbleList.tsx` | +86 / -20 — add channel filtering + badge reporting |
| `ChannelTabs.tsx` | +63 (new) — tab bar component |
| `TemplateEditorPane.tsx` | +17 — wire ChannelTabs + state |
| `bubble-reorder-logic.ts` | +31 (new) — pure reorder helper |
| `bubble-reorder-logic.test.ts` | +100 (new) — 7 unit tests |

### Critical Issues
_None._

### Warnings
_None._

### Info
- `onCountsChange` is listed in the `useEffect` dependency array in `BubbleList.tsx`. The caller passes `setBubbleCounts` (a stable `useState` setter) so there is no infinite loop risk in practice — but if this prop is ever passed as an inline arrow function the effect would run on every render. Low risk given current usage.
- `ChannelTabs.tsx` uses `aria-pressed` on the tab buttons (good a11y). Role could also be `role="tab"` within a `role="tablist"` for richer screen-reader semantics — minor, not blocking.

### Checklist
- [x] No raw `fetch()` — uses `api.get()` / `api.post()` from `@/lib/api`
- [x] React Query patterns — `useQuery` / `useMutation` / `invalidateQueries()` all correct
- [x] `toast.error()` from sonner used for error notifications
- [x] Semantic design tokens — `bg-muted`, `text-muted-foreground`, `border-border`, `bg-primary`, `text-primary-foreground`, `bg-background`; no hardcoded hex or `gray-*`
- [x] `leading-snug` on Thai text
- [x] Lazy-loaded page (no change to routing — component is sub-component of existing lazy page)
- [x] Unit tests extracted for the non-trivial reorder logic (`bubble-reorder-logic.test.ts`)
- [x] No backend changes — no guard/DTO issues

### Recommendation: ✅ APPROVE

---

## Branch 2: `feat/data-deletion-page`

**Author**: Akenarin Kongdach  
**Latest commit**: ~31 hours ago — `feat(privacy): add public /privacy/data-deletion instructions page`

### File changes (2 files, +125)
| File | Change |
|------|--------|
| `App.tsx` | +2 — new public route `/privacy/data-deletion` |
| `DataDeletionPage.tsx` | +123 (new) — static PDPA data-deletion instructions page |

### Critical Issues
_None._

### Warnings
_None._

### Info
- Contact details (email `akenarin.ak@gmail.com`, phone `095-567-8887`, LINE OA `@bestchoice`) are hardcoded in the component. This is intentional for a static PDPA compliance page but means updating them requires a code change. Not a security issue — this information is meant to be publicly visible.
- Top-of-file `/** ... */` block comment describes the Meta PDPA compliance purpose. This crosses the "WHY non-obvious" bar (external platform requirement), so it is acceptable per coding standards.
- Page has no authentication requirement — correct, as this is a public PDPA compliance URL required by Facebook App Review.

### Checklist
- [x] Route is public (`/privacy/data-deletion`) — no `ProtectedRoute` wrapper, correct for PDPA compliance page
- [x] Lazy-loaded via `React.lazy()` in `App.tsx`
- [x] Semantic tokens only — `bg-background`, `bg-muted/40`, `text-foreground`, `text-muted-foreground`, `border-border`
- [x] `leading-snug` on Thai text, `leading-relaxed` on paragraph text
- [x] No data fetching, no API calls, no state management needed
- [x] No backend changes — no guard/DTO issues

### Recommendation: ✅ APPROVE

---

## Branch 3: `fix/exchange-pdpa-clone`

**Author**: Akenarin Kongdach  
**Latest commit**: ~2 days ago — `fix(exchange): clone PDPA consent for new exchange contract`

### File changes (2 files, +79 / -5)
| File | Change |
|------|--------|
| `contract-exchange.service.ts` | +30 / -5 — clone PDPA consent instead of reusing old row |
| `contract-exchange.service.spec.ts` | +54 / -1 — 3 new tests for the clone behaviour |

### Critical Issues
_None._

### Warnings
_None._

### Info
- The fix correctly addresses a `@unique` constraint violation on `Contract.pdpaConsentId`: the old code attempted to reuse the existing consent row ID on the new contract, which would fail at the DB level. The new code clones the consent within the same `$transaction` context (`tx`) so either both the consent clone and the new contract commit together or neither does.
- `clonedPdpaConsentId` is initialised to `null` outside the `if` block, which is correct given the conditional clone path. The null case (old contract had no PDPA consent) is explicitly tested.
- All sensitive consent fields (`privacyNoticeText`, `signatureImage`, `purposes`) are carried over to the clone — this preserves the audit trail per-contract as intended.

### Checklist
- [x] Fix is inside `$transaction` context — atomic with the new contract creation
- [x] Null-safe path tested (`pdpaConsentId: null` case)
- [x] Clone path tested (asserts `clonedPdpaConsentId !== old.pdpaConsentId`)
- [x] No hardcoded secrets or PII logged
- [x] No new controller endpoints — existing guard coverage unaffected
- [x] No DTO changes — no validation coverage gaps

### Recommendation: ✅ APPROVE

---

## Summary

| Branch | Files | Lines | Critical | Warning | Info | Recommendation |
|--------|-------|-------|----------|---------|------|----------------|
| `feat/canned-response-channel-tabs` | 5 | +277 / -20 | 0 | 0 | 2 | ✅ APPROVE |
| `feat/data-deletion-page` | 2 | +125 / 0 | 0 | 0 | 2 | ✅ APPROVE |
| `fix/exchange-pdpa-clone` | 2 | +79 / -5 | 0 | 0 | 2 | ✅ APPROVE |

All three branches are clear to merge. No critical or warning-level issues found.
