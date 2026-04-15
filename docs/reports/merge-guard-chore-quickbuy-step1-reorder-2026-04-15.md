# Merge Guard Report — `chore/quickbuy-step1-reorder`
**Date**: 2026-04-15  
**Reviewed by**: Pre-Merge Guard (automated)  
**Recommendation**: ⚠️ REVIEW

---

## Branch Info
| Field | Value |
|-------|-------|
| Branch | `chore/quickbuy-step1-reorder` |
| Author | iamnaii (akenarin.ak@gmail.com) |
| Commits unique to branch | 1 |
| Base | `chore/trade-in-orchestrator-rebrand` (stacked branch — review parent first) |
| Latest commit | `58871078` — `ui(trade-in): reorder Step 1 fields` |

---

## File Changes Summary
| File | Change |
|------|--------|
| `apps/web/src/components/trade-in/QuickBuyModal.tsx` | +28 / -21 |

**Scope**: UI-only change. Converts 2-column grid → single-column flow on Step 1 of QuickBuyModal. Reorders fields to: ชื่อ → เลขบัตร → เบอร์ → ที่อยู่ → แนบรูปบัตร. Enlarges photo upload button to `h-12` with clearer label.

---

## Issues Found

### Critical
_None found._

---

### Warning

**W-001 · Raw `fetch()` with hardcoded localhost URL**  
**File**: `apps/web/src/components/trade-in/QuickBuyModal.tsx:135`  
```ts
const res = await fetch('http://localhost:3457/api/read-card');
```
- This is a pre-existing call to a local hardware card reader service (Thai national ID card reader). It is **not** a new issue introduced by this commit.
- Raw `fetch()` is not recommended (rule: use `api.get()`), but in this case the target is a different local service on port 3457, so `api.get()` would not apply.
- **Risk**: Hardcoded `http://localhost:3457` will fail in environments without the card reader agent (production web browsers, testing environments). Should be configurable or handled gracefully — current code already catches errors with a toast, which is acceptable.
- **Recommendation**: Consider moving the URL to an env/config constant (e.g. `VITE_CARD_READER_URL`) so it can be overridden per environment.

---

### Info

**I-001 · Stacked branch — depends on parent**  
This branch is stacked on top of `chore/trade-in-orchestrator-rebrand`. The parent branch must be reviewed and merged first. Merging this branch alone to main without the parent would be a cherry-pick, not a standard merge.

**I-002 · No TypeScript types changed**  
Pure UI reorder — no logic, no API calls, no state changes. Low regression risk.

---

## Verification Checklist
- [x] `@UseGuards(JwtAuthGuard, RolesGuard)` — N/A (frontend only)
- [x] `Number()` on money fields — N/A (no financial calculations)
- [x] `deletedAt: null` in queries — N/A (no queries)
- [x] Hardcoded secrets — None
- [x] `@Roles()` decorators — N/A (frontend only)
- [x] SQL injection (`$queryRaw`) — N/A (frontend only)
- [x] `queryClient.invalidateQueries()` after mutations — Parent page (`TradeInPage.tsx:512`) calls `invalidateQueries({ queryKey: ['trade-ins'] })` in `onSuccess` callback ✓

---

## Recommendation: ⚠️ REVIEW

No Critical issues. The change is a low-risk UI reorder. However:
1. **Merge parent branch first** (`chore/trade-in-orchestrator-rebrand`) — see its report.
2. Address W-001 optionally: externalize card reader URL to `VITE_CARD_READER_URL` env var.

This branch is **safe to merge after the parent branch is cleared**.
