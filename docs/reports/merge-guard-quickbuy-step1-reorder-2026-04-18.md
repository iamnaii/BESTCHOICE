# Merge Guard Report — chore/quickbuy-step1-reorder

**Date**: 2026-04-18  
**Branch**: `chore/quickbuy-step1-reorder`  
**Author**: iamnaii <akenarin.ak@gmail.com>  
**Recommendation**: ✅ APPROVE (with advisory)

---

## File Changes Summary

| Commit | Description | Files |
|--------|-------------|-------|
| `58871078` | ui(trade-in): reorder Step 1 fields + expand ID card upload area | `QuickBuyModal.tsx` (+28/-21) |
| `5f6468cf` | refactor(trade-in): quickBuy orchestrator + rebrand modal as primary flow | `trade-in.service.ts` (+75/-105), `QuickBuyModal.tsx` |

Total: 2 files changed, 103 insertions, 126 deletions (net reduction).

---

## Issues

### Critical
_None found._

### Warning

**W1 — trade-in.service.ts: quickBuy() no longer atomic**  
File: `apps/api/src/modules/trade-in/trade-in.service.ts` (quickBuy method)

The refactored `quickBuy()` now calls `create()` → `appraise()` → `accept()` → `voucher.allocate()` as four separate service calls, each with its own transaction. A crash between any two stages leaves the record in an intermediate state (`PENDING_APPRAISAL` or `APPRAISED`).

The commit acknowledges this trade-off: _"partial state กู้คืนผ่าน legacy modals ได้"_. This is an acceptable business decision for an internal POS counter flow, but consider:
- A server restart between Stage 2 (appraise) and Stage 3 (accept) means the UI shows success to the operator but the voucher is never allocated.
- No compensating transaction or rollback mechanism exists.

Recommendation: Add a `try/catch` wrapper that marks the record `CANCELLED` if `accept()` or `voucher.allocate()` throws after `create()` has succeeded. Alternatively, document the recovery procedure in the UI (show the trade-in ID so staff can resume manually).

### Info

**I1 — QuickBuyModal.tsx: pre-existing `bg-white` / `slate-*` in gradient**  
File: `apps/web/src/components/trade-in/QuickBuyModal.tsx`

The modal header uses `bg-gradient-to-b from-emerald-50 to-white dark:from-emerald-950/30 dark:to-slate-950`. The `to-white` and `dark:to-slate-950` values are hardcoded non-semantic colors. These were **not introduced by this PR** (only the `from-*` color changed from amber → emerald); flagging for backlog cleanup.

---

## Checklist

| Check | Result |
|-------|--------|
| New controllers have `@UseGuards(JwtAuthGuard)` | N/A — no new controllers |
| No `Number()` on money/Decimal fields | ✅ Pass |
| All queries include `deletedAt: null` | ✅ Pass |
| No hardcoded secrets | ✅ Pass |
| DTOs have class-validator decorators | N/A — no new DTOs |
| Frontend uses `api.get/post` (not raw fetch) | ✅ Pass |
| `queryClient.invalidateQueries()` after mutations | ✅ Pass (no new mutations) |
| Thai validation messages | N/A |
| No SQL injection risk | ✅ Pass |
