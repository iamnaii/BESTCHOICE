# Pre-Merge Guard Report — feat/sidebar-sp5

**Branch**: `feat/sidebar-sp5`
**Author**: Akenarin Kongdach
**Date reviewed**: 2026-05-18
**Changes**: 33 files changed, +6,457 / -30 lines

---

## File Changes Summary

| Area | Files | Lines |
|------|-------|-------|
| API — new `quotes` module (controller, service, DTOs, PDF template) | 7 | +1,118 |
| API — new `drafts` module (controller, service) | 4 | +376 |
| API — schema + migration (Quote model) | 2 | +226 |
| API — `branch-access.util.ts` additions | 2 | +72 |
| API — `sequence.util.ts` | 1 | +37 |
| API — tests (quotes + drafts) | 2 | +608 |
| Web — `QuotesPage.tsx` + `DraftsPage.tsx` | 2 | +968 |
| Web — `InsurancePage.tsx` (stub) | 1 | +23 |
| Web — test pages | 2 | +88 |
| Web — routing + menu | 2 | +46 |
| Web — E2E spec | 1 | +63 |
| Docs / design specs | 7 | +2,832 |

---

## Security Checks

| Check | Result |
|-------|--------|
| `@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)` on QuotesController | ✅ Class-level |
| `@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)` on DraftsController | ✅ Class-level |
| `@Roles(...)` on every controller method | ✅ All 9 quote + 1 drafts endpoints decorated |
| `deletedAt: null` in all new Prisma queries | ✅ Consistent throughout both services |
| Raw SQL / unparameterized `$queryRaw` | ✅ None |
| Hardcoded secrets or API keys | ✅ None |
| Raw `fetch()` in frontend | ✅ None — uses `api.get/post/delete` + React Query |
| `localStorage` for sensitive data | ✅ None (only sidebar UI state in a separate SP) |
| `queryClient.invalidateQueries()` after mutations | ✅ Present — via direct call or `onChanged/onCreated` callbacks |
| Thai validation messages on new DTOs | ✅ Present on DTO validators |

---

## Issues

### Critical

**C1 — `Number()` on Prisma.Decimal money fields in `drafts.service.ts`**

File: `apps/api/src/modules/drafts/drafts.service.ts`

```typescript
// 4 instances — DraftRow.amount typed as `number` (JS float)
amount: Number(q.total),          // Quote.total   — Decimal
amount: Number(c.financedAmount), // Contract.financedAmount — Decimal
amount: Number(e.totalAmount),    // ExpenseDocument.totalAmount — Decimal
amount: Number(oi.totalAmount),   // OtherIncome.totalAmount — Decimal
```

This directly contradicts the v4 hardening outcome ("53 `Number()` → `Prisma.Decimal` in 12 services, 0 `Number(_sum` remaining"). Although the Drafts Hub is display-only, the project convention is absolute: never serialize Decimal to JS Number. The `DraftRow.amount` interface should use `string` (`.toString()`) or `Prisma.Decimal`.

**Fix**: Change `DraftRow.amount: number` → `amount: string` and replace all `Number(x)` with `x.toString()` (or use `Prisma.Decimal` if downstream needs arithmetic).

---

### Warning

**W1 — `Number()` on Decimal money fields in PDF template (`quotes.service.ts`)**

File: `apps/api/src/modules/quotes/quotes.service.ts` (PDF data preparation method)

```typescript
// 6 instances
unitPrice: Number(it.unitPrice),
amount:    Number(it.amount),
subtotal:  Number(quote.subtotal),
discount:  Number(quote.discount),
vatAmount: Number(quote.vatAmount),
total:     Number(quote.total),
```

Context: these values feed a puppeteer HTML template for PDF rendering. At Thai Baht scales (≤9,999,999.99) float64 is precise enough, but the pattern is still a violation and sets a bad precedent. Use `.toFixed(2)` or `.toString()` for template injection to keep the convention clean.

**Fix**: Replace `Number(x)` with `x.toFixed(2)` or `x.toString()` in the PDF data-prep object. Update the template interface type from `number` to `string`.

**W2 — `Number()` on `unitPrice` in `QuotesPage.tsx` createMutation payload**

File: `apps/web/src/pages/QuotesPage.tsx`

```typescript
// Inside the createMutation request body mapping
unitPrice: Number(i.unitPrice),
```

This converts the API's string-serialized Decimal back to float before posting. Although the DTO accepts a `number`, the round-trip `Decimal → string (JSON) → Number()` can drift. Use `parseFloat(i.unitPrice)` with an explicit comment, or keep input state as `string` and let the DTO handle parsing.

**W3 — `QuotesPage.tsx` at 785 lines**

`apps/web/src/pages/QuotesPage.tsx` is 785 lines — 57% over the 500-line guideline. The file hosts: list table, create modal dialog, quote detail panel, and PDF download handler. Consider splitting into `QuoteListPage.tsx` + `QuoteDetailPage.tsx` + `CreateQuoteDialog.tsx` in a follow-up PR.

---

### Info

**I1 — `QuotesPage.test.tsx` covers only 37 lines of assertions**

The test file is a minimal smoke test. The `quotes.service.spec.ts` (462 lines) provides thorough service coverage, so this is acceptable for now.

---

## Summary

| Severity | Count |
|----------|-------|
| Critical | 1 |
| Warning | 3 |
| Info | 1 |

---

## Recommendation

**⚠️ REVIEW — Fix C1 before merge**

The `Number()` regression on Decimal money fields (C1) directly reverses the v4 hardening that explicitly zeroed all such conversions. It must be fixed before this branch lands on `main`. W1 and W2 are also money-field violations that should be addressed in the same pass since the files are already open.

Suggested fix sequence:
1. `DraftRow.amount: string` + replace 4× `Number()` with `.toString()`
2. PDF template interface → `string` fields + replace 6× `Number()` with `.toFixed(2)`
3. `QuotesPage.tsx` create payload → remove `Number()` wrapper on `unitPrice`
