# Merge Guard Report — `chore/trade-in-orchestrator-rebrand`
**Date**: 2026-04-15  
**Reviewed by**: Pre-Merge Guard (automated)  
**Recommendation**: ⚠️ REVIEW

---

## Branch Info
| Field | Value |
|-------|-------|
| Branch | `chore/trade-in-orchestrator-rebrand` |
| Author | iamnaii (akenarin.ak@gmail.com) |
| Commits unique to branch | 2 |
| Base | Prior `feature/chatbot-finance` merged commit chain |
| Latest commit | `5f6468cf` — `refactor(trade-in): quickBuy orchestrator + rebrand modal as primary flow` |

---

## File Changes Summary
| File | +Lines | -Lines | Type |
|------|--------|--------|------|
| `apps/api/src/modules/trade-in/trade-in.service.ts` | +84 | -164 | Backend refactor |
| `apps/web/src/components/trade-in/QuickBuyModal.tsx` | +16 | -16 | Frontend rebrand |

**Net change**: -180 lines (significant simplification). Backend removes duplicate validation logic; frontend rebrands colors/icons.

---

## Issues Found

### Critical
_None found._

---

### Warning

**W-001 · Non-atomic orchestrator — orphan record risk on partial failure**  
**File**: `apps/api/src/modules/trade-in/trade-in.service.ts:342–407`

The `quickBuy()` method was refactored from **one atomic `$transaction`** to **4 sequential non-atomic calls**:
```
Stage 1: create()    → PENDING_APPRAISAL  (own $transaction)
Stage 2: appraise()  → APPRAISED          (own $transaction)
Stage 3: accept()    → ACCEPTED           (own $transaction)
Stage 4: voucher.allocate()               (own $transaction)
```

**Risk**: If Stage 2, 3, or 4 throws, the trade-in record is left in an intermediate state (`PENDING_APPRAISAL` or `APPRAISED`) with no automatic rollback. The commit message acknowledges this trade-off:
> "ถ้า fail กลางทาง → record ค้างใน intermediate state (PENDING/APPRAISED) ซึ่งสามารถกู้คืนได้ผ่าน legacy modals"

**Severity**: Warning (not Critical) because:
- Recovery is possible via legacy modals (manual path)
- Stage failures are most likely caused by validation errors (e.g. missing consent), which mean Stage 1 data is genuinely useful for recovery
- The trade-off is documented in the code

**Recommendation**: Consider adding a try-catch in `quickBuy()` that soft-deletes the partially-created record if Stage 3 or 4 fails. Or document the recovery procedure in a comment for operators.

---

**W-002 · Raw `fetch()` with hardcoded localhost URL (pre-existing)**  
**File**: `apps/web/src/components/trade-in/QuickBuyModal.tsx:135`  
```ts
const res = await fetch('http://localhost:3457/api/read-card');
```
Pre-existing call to local hardware card reader service on port 3457. Not introduced by this commit. See W-001 in `quickbuy-step1-reorder` report for full context.

---

### Info

**I-001 · Frontend rebrand: amber → emerald, Zap → ShoppingBag icon**  
Pure cosmetic change, no logic impact. Low regression risk.

**I-002 · No new DTOs or endpoints**  
The refactor reuses existing DTOs and service methods. No new validation surface.

**I-003 · `branchId` not passed to `appraise()` call**  
`appraise()` receives only `offeredPrice` + `deviceCondition`. The branch context is already stored on the trade-in record from Stage 1, so no issue — just noting the orchestrator passes no `branchId` to Stage 2.

---

## Verification Checklist
- [x] `@UseGuards(JwtAuthGuard, RolesGuard)` — Existing controller, not changed
- [x] `Number()` on money fields — Not used in this commit
- [x] `deletedAt: null` — `accept()` correctly checks `tradeIn.deletedAt`
- [x] Hardcoded secrets — None
- [x] `@Roles()` decorators — Not changed (existing controller)
- [x] SQL injection (`$queryRaw`) — Not used
- [x] `queryClient.invalidateQueries()` — `TradeInPage.tsx:512` handles this in parent ✓

---

## Recommendation: ⚠️ REVIEW

No Critical blockers. The refactor achieves meaningful code deduplication at the cost of atomicity. The main concern is the orphan-record scenario on partial failure.

**Before merging, confirm with the team:**
1. Is the "recover via legacy modals" strategy acceptable for POS operators? Or should failed partial records be auto-cleaned?
2. Consider adding Sentry capture in the `quickBuy()` catch path so operators are alerted when partial state occurs (similar to PaySolutions atomicity handling in v2 hardening).

This branch can proceed to merge once the orphan-record recovery strategy is confirmed by the team.
