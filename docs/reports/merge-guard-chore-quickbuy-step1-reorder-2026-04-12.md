# Merge Guard Report — chore/quickbuy-step1-reorder
**Date**: 2026-04-12  
**Author**: iamnaii <akenarin.ak@gmail.com>  
**Reviewed commits** (top 2, unique to branch):
- `5f6468c` refactor(trade-in): quickBuy orchestrator + rebrand modal as primary flow
- `5887107` ui(trade-in): reorder Step 1 fields + expand ID card upload area

## File Changes Summary
| Commit | Files | Changes |
|--------|-------|---------|
| 5f6468c (quickBuy orchestrator) | 2 | `trade-in.service.ts` (-60 lines), `QuickBuyModal.tsx` (minor) |
| 5887107 (UI reorder) | 1 | `QuickBuyModal.tsx` (+28/-21) |

**Key files changed:**
- `apps/api/src/modules/trade-in/trade-in.service.ts` — quickBuy() refactored to orchestrator pattern
- `apps/web/src/components/trade-in/QuickBuyModal.tsx` — UI reorder + color scheme update

---

## Issues by Severity

### Critical (must fix before merge): 0

No critical issues:
- No new controllers — trade-in controller not modified ✅
- No raw SQL ✅
- No hardcoded secrets ✅
- No `Number()` on Decimal money fields in changed code ✅
- Existing soft-delete filters in `trade-in.service.ts` are preserved ✅

---

### Warning (should fix before merge): 1

**W-1: Raw `fetch('http://localhost:3457/api/read-card')` in `QuickBuyModal.tsx`**

The modal contains a card reader call using raw `fetch()` to a hardcoded `localhost` URL:

```typescript
// apps/web/src/components/trade-in/QuickBuyModal.tsx
async function readFromCardReader() {
  try {
    const res = await fetch('http://localhost:3457/api/read-card');
```

This violates the frontend rule: "ใช้ `api.get()` / `api.post()` จาก `@/lib/api` เท่านั้น — ห้ามใช้ raw `fetch()`".

The exception here is that `localhost:3457` is a **local hardware service** (the PJ-Soft card reader agent running on the operator's machine), not the backend API — so routing it through `@/lib/api`'s Axios instance (which points to the NestJS API) would be incorrect. The use of raw `fetch()` for this specific call is technically justified.

However, the hardcoded `http://localhost:3457` URL should be extracted to a named constant to make it easier to configure if the port changes:

```typescript
// constants/hardware.ts (or inline)
const CARD_READER_URL = 'http://localhost:3457/api/read-card';
```

This is pre-existing code (not introduced in these commits), so this warning is **inherited from the base branch**, not a regression introduced here.

---

### Info

**I-1: quickBuy() orchestrator is no longer atomic — partial state risk**

The commit explicitly documents this trade-off:
> Trade-off: ไม่ atomic ใน 1 transaction (แต่ละ stage มี tx ของตัวเอง) — ถ้า fail กลางทาง → record ค้างใน intermediate state

The refactor replaces a single `prisma.$transaction()` with 4 sequential calls: `create()` → `appraise()` → `accept()` → `voucher.allocate()`. If the process fails at stage 2 or 3, a `TradeIn` record is left in `PENDING_APPRAISAL` or `APPRAISED` state.

The commit says these can be recovered via legacy modals, which is reasonable. The atomicity loss is an acceptable trade-off for the audit trail benefits documented.

**No action required** — this is a documented architectural decision.

**I-2: Modal rebrand is cosmetic-only**

Color changes (amber → emerald), icon (Zap → ShoppingBag), and title/subtitle text updates are UI-only with no functional impact. No issues.

---

## Recommendation: **APPROVE**

The two commits make focused, well-scoped changes:
1. The orchestrator refactor reduces code duplication and improves audit trail completeness. The atomicity trade-off is clearly documented.
2. The UI reorder is cosmetic.

The one warning (W-1 raw `fetch()`) is pre-existing code not introduced by this branch, and is functionally justified (local hardware service). It does not block merge.

**Ready to merge.**
