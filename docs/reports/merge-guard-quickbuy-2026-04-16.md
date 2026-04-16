# Merge Guard Report — chore/quickbuy-step1-reorder

**Date**: 2026-04-16  
**Branch**: `chore/quickbuy-step1-reorder`  
**Author**: iamnaii <akenarin.ak@gmail.com>  
**Commits reviewed**: 2 (5f6468cf → 58871078)  
**Files changed**: 2 files, +103 / -126 lines  

---

## Summary

Small UI branch: reorders Step 1 fields in `QuickBuyModal.tsx` to match the customer information form flow, and expands the ID card upload area. Also includes a minor service-side change in `trade-in.service.ts`. Low risk overall. One warning about a raw `fetch()` call to a hardcoded localhost URL.

---

## Critical Issues

None found.

---

## Warning Issues

### W-001 — Raw `fetch()` with hardcoded `localhost:3457` URL

**File**: `apps/web/src/components/trade-in/QuickBuyModal.tsx`

```ts
const res = await fetch('http://localhost:3457/api/read-card');
```

Two issues:
1. **Hardcoded `localhost:3457`** — fails in all non-developer environments. This URL should come from an env variable.
2. **Raw `fetch()`** — per frontend rules, prefer `api.get()`/`api.post()`. However, this targets an external local hardware service (Thai ID card reader), not the backend API, so using the `api` client (which sends JWT headers) would be incorrect. Raw `fetch` is appropriate here — but the URL must not be hardcoded.

**Recommended fix**:
```ts
// apps/web/.env.local (developer, not committed)
VITE_CARD_READER_URL=http://localhost:3457

// QuickBuyModal.tsx
const cardReaderUrl = import.meta.env.VITE_CARD_READER_URL ?? 'http://localhost:3457';
const res = await fetch(`${cardReaderUrl}/api/read-card`);
```

---

## Info

### I-001 — Pre-existing `Number()` on Decimal fields in `trade-in.service.ts`

```ts
amount: Number(r.agreedPrice ?? 0),
amount: Number(tradeIn.agreedPrice ?? tradeIn.offeredPrice ?? 0),
```

These lines **pre-exist** and are not introduced by this branch (not in the diff). Flagged for awareness — should be fixed in a separate PR.

### I-002 — Pure UI reorder, minimal regression risk

Field reordering in `QuickBuyModal.tsx` is visual only. No data model changes, no logic changes.

---

## Recommendation

**REVIEW** — Address W-001 (hardcoded `localhost:3457`) before merging to keep the build deployable outside developer machines. Very low risk overall.

**Unblock when**: Card reader URL externalized to `VITE_CARD_READER_URL` env variable.
