# Pre-Merge Guard Report — Defect Exchange Branches
**Date:** 2026-05-24  
**Reviewed by:** Pre-Merge Guard Agent  
**Branches reviewed:** 3

---

## Branch 1: `feat/defect-exchange-wizard-flow`

| Field | Value |
|-------|-------|
| **Author** | Akenarin Kongdach &lt;iamnaii@MacBook-Pro-khxng-Akenarin.local&gt; |
| **Commits** | 3 commits (2026-05-23 17:29–17:40 +0700) |
| **Base** | `origin/main` |

### File Changes Summary
| File | +/- |
|------|-----|
| `apps/api/src/cli/seed-sp1-used-exchange.sql` | +73 (new) |
| `apps/web/package.json` | version bump |
| `apps/web/src/pages/DefectExchangePage.tsx` | ~211 added / ~147 removed (net size-neutral: 459 lines) |

### What Changed
Refactored `DefectExchangePage` from a 2-column side-by-side layout to a **3-step wizard** (Contract → Replacement device → Confirm), mirroring the insurance wizard pattern. Also fixes the `products` API call limit from 300→200 (was exceeding `PaginationDto @Max(200)` constraint). Adds a SQL seed file for manual dev testing of the exchange flow.

---

### Issues Found

#### Critical
_None._

#### Warning

**W1 — SQL seed: `storage` column absent from `products` INSERT**  
`apps/api/src/cli/seed-sp1-used-exchange.sql`

The INSERT into `products` does not include `storage` in the column list. All 4 seed products will have `storage = NULL`. The replacement-device filter logic is:

```ts
(p.storage ?? '') === (selectedContract.product.storage ?? '')
```

When both sides are NULL, `'' === ''` → `true`, so the match works. However, the `name` field says "iPhone 15 **256GB**" while the `storage` column is NULL — the dropdown will display blank storage for replacement devices. This is misleading for testers and could cause confusion.

**Fix:** Add `storage` to the INSERT column list:
```sql
(id, name, brand, model, storage, imei_serial, color, ...)
-- values:
('sp1-prod-used-old', ..., '256GB', ...)
```

---

**W2 — SQL seed: `interest_total` doesn't match the stated rate**  
`apps/api/src/cli/seed-sp1-used-exchange.sql`

Seed has `interest_rate: 0.1600` (16% flat) on `financed_amount: 24000.00` for 12 months. Expected `interest_total = 24000 × 0.16 × 1 = 3840.00`, but seed sets `interest_total: 4000.00`.

This is test-only data and won't affect real payment flows, but will produce a slightly inaccurate monthly payment (`2333.33` instead of `2320.00`). Low priority — fix when convenient.

---

#### Info

**I1 — `DefectExchangePage.tsx` approaching 500-line threshold**  
Currently 459 lines. Not a blocking concern but consider extracting the confirmation modal into a `DefectExchangeConfirmDialog` component in a follow-up PR.

---

### Positive Notes
- ✅ `invalidateQueries` present in `onSuccess` for all affected query keys (contracts, products, history, contracts global)
- ✅ `bypassWindow` is role-gated: `bypassWindowRaw && canExecute` — a non-OWNER/BM user crafting `?bypassWindow=true` in the URL has no effect
- ✅ All data fetching uses `useQuery` / `useMutation` from `@tanstack/react-query`
- ✅ All API calls use `api.get()` from `@/lib/api` — no raw `fetch()`
- ✅ Design tokens used correctly (`bg-muted/30`, `text-muted-foreground`, `border-border/60`) — no hardcoded hex
- ✅ `Button variant="primary"` is a valid custom variant defined in `apps/web/src/components/ui/button.tsx`
- ✅ Step gate logic correctly preserves bypass: `canNextFrom1 = !!selectedContractId && (elig?.eligible || bypassWindow)`

### Recommendation: **REVIEW**
Two non-blocking warnings in the SQL seed file. No code changes required before merge — fix seed in a follow-up commit or in this branch before merging.

---

## Branch 2: `hotfix/defect-exchange-preset-contract-visibility`

| Field | Value |
|-------|-------|
| **Author** | Akenarin Kongdach |
| **Commits** | 1 commit (2026-05-23 17:18 +0700) |
| **Base** | `origin/main` |

### File Changes Summary
| File | +/- |
|------|-----|
| `apps/web/package.json` | version bump |
| `apps/web/src/pages/DefectExchangePage.tsx` | +8 / -2 |

### What Changed
Bug fix: when `presetContractId` is provided (coming from the IMEI wizard), the contract dropdown filter previously excluded `PHONE_NEW` contracts, making the preset contract invisible if it was a new device. The fix includes the preset contract in the result regardless of category:

```ts
queryKey: ['defect-exchange-contracts', presetContractId ?? null],  // was: no presetContractId in key
return rows.filter(
  (c) => c.product.category === 'PHONE_USED' || c.id === presetContractId,  // always show preset
);
```

Also adds `presetContractId` to the `queryKey` so React Query correctly re-fetches when the preset changes.

---

### Issues Found

#### Critical
_None._

#### Warning
_None._

#### Info
_None._

### Positive Notes
- ✅ `queryKey` now includes `presetContractId` — correct cache key design
- ✅ Well-commented with explanation of the intent (gives readable eligibility reasons rather than empty dropdown)
- ✅ Targeted, minimal change with no unrelated modifications

### Recommendation: **APPROVE** ✅

---

## Branch 3: `hotfix/defect-exchange-redirect-loop`

| Field | Value |
|-------|-------|
| **Author** | Akenarin Kongdach |
| **Commits** | 1 commit (2026-05-23 16:27 +0700) |
| **Base** | `origin/main` |

### File Changes Summary
| File | +/- |
|------|-----|
| `apps/web/package.json` | version bump |
| `apps/web/src/App.tsx` | +6 / -9 |
| `apps/web/src/components/DefectExchangeRedirect.tsx` | **deleted** |
| `apps/web/src/pages/insurance/WizardSteps/ImeiLookupStep.tsx` | +36 |
| `apps/api/src/modules/repair-tickets/repair-tickets.service.ts` | +7 |

### What Changed
**Root cause fixed:** `/defect-exchange` was routed to `DefectExchangeRedirect` which redirected to `/insurance/new?intent=exchange`. The insurance wizard's `intent=exchange` handler then redirected back to `/defect-exchange` — infinite loop.

**Fix:** Deleted `DefectExchangeRedirect.tsx`, restored `/defect-exchange` route to `DefectExchangePage` directly.

**Additional improvements:**
- `repair-tickets.service.ts`: exposes `purchasedAt`, `shopWarrantyEndDate`, `manufacturerWarrantyEndDate` on the IMEI lookup response
- `ImeiLookupStep.tsx`: displays purchase date + warranty expiry in the preview card with Thai Buddhist Era date formatting

---

### Issues Found

#### Critical
_None._

#### Warning
_None._

#### Info

**I1 — `formatThaiDate` and `warrantyEndSubtitle` defined inline**  
`apps/web/src/pages/insurance/WizardSteps/ImeiLookupStep.tsx`

Both helper functions are defined file-locally. The shared `@/utils/formatters.ts` already contains `formatNumber`, `formatCurrency`, `formatDate` etc. Consider moving `formatThaiDate` there in a follow-up so other components can reuse the Buddhist Era formatter.

---

### Positive Notes
- ✅ No new controllers introduced — existing guards unchanged
- ✅ Backend changes in `repair-tickets.service.ts` only add date fields (`createdAt`, `shopWarrantyEndDate`, `warrantyExpireDate`) — no money fields, no `Number()` conversions
- ✅ `DefectExchangeRedirect.tsx` deletion is clean — no dangling imports remain (import removed from `App.tsx` simultaneously)
- ✅ Root cause comment in `App.tsx` clearly explains the infinite loop pattern for future readers

### Recommendation: **APPROVE** ✅

---

## Summary

| Branch | Recommendation | Blocker? |
|--------|---------------|---------|
| `feat/defect-exchange-wizard-flow` | **REVIEW** | No — fix seed data (W1 `storage` column) ideally before merge |
| `hotfix/defect-exchange-preset-contract-visibility` | **APPROVE** ✅ | — |
| `hotfix/defect-exchange-redirect-loop` | **APPROVE** ✅ | — |

**Merge order recommendation:** merge hotfixes first (they are independent and address regression bugs), then the feat branch after addressing seed data warnings.

No security issues found across all 3 branches. No missing `@UseGuards`, no `Number()` on money fields, no missing `deletedAt: null` filters, no raw `fetch()` calls, no hardcoded secrets.
