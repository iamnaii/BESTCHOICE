# Merge Guard Report — fix/users-page-polish

**Date**: 2026-04-18
**Branch**: `fix/users-page-polish`
**Author**: Akenarin Kongdach
**Commits**: 5 (`8ab3d903`…`f19ef1a7`)

## File Changes Summary

| Category | Files | +Lines | -Lines |
|----------|-------|--------|--------|
| trade-in.service (auto-create Product on accept) | 1 | ~80 | ~5 |
| trade-in voucher.service (PDF perf + logo) | 1 | ~155 | ~100 |
| auth.service (lastLoginAt stamp) | 1 | ~10 | ~8 |
| customers.service (portfolio KPI fix) | 1 | ~18 | ~5 |
| users.service (SYSTEM_USER_EMAILS filter + lastLoginAt) | 1 | ~12 | ~4 |
| Frontend UI components (DataTable, CreditChecksPage, etc.) | 13 | ~818 | ~226 |
| **Total** | **18** | **1 093** | **348** |

---

## Issues Found

### ⚠️ Warning (2)

**W-001** — `Number(costPrice)` on a Decimal money field in JSON payload
- **File**: `apps/api/src/modules/trade-in/trade-in.service.ts` — `accept()` method
- **Code**: `agreedPrice: Number(costPrice)` inside `checklistResults` JSON
- **Rule**: No `Number()` on money/financial fields
- **Fix**: `agreedPrice: costPrice.toNumber()` — uses the Prisma Decimal `.toNumber()` method, which is the accepted pattern for JSON serialization at 2 d.p.

**W-002** — Puppeteer shared browser reconnect logic uses non-standard properties
- **File**: `apps/api/src/modules/trade-in/services/voucher.service.ts` — `getBrowser()` method
- **Code**: `browser.connected === false || !browser.process?.()` — `connected` is not in puppeteer's public `Browser` API typings; actual `Browser` exposes `isConnected()`. If the Chromium process dies, `browser.connected` will always be `undefined` (never `=== false`), so the reconnect branch will never trigger until the next `newPage()` throws.
- **Fix**: Replace the condition with `!browser.isConnected()` or wrap `getBrowser()` in a try/catch that relaunches on error.

### ℹ️ Info (2)

**I-001** — `lastLoginAt` field stamp is now unconditional (no `if (user.failedLoginAttempts > 0 || user.lockedUntil)` guard). Verified `lastLoginAt DateTime?` is present in the schema. Change is correct.

**I-002** — `SYSTEM_USER_EMAILS = ['legacy-import@bestchoice.com']` constant defined at module level — clean pattern. If more system accounts are added in the future, this list will need to be kept in sync.

---

## Positive Findings ✅

- `lastLoginAt` field confirmed in Prisma schema ✓
- `trade-in.service.ts`: IMEI uniqueness check prevents duplicate `Product` records on `accept()` ✓
- `trade-in.service.ts`: `branchId` null-guard added before product creation ✓
- `customers.service.ts`: portfolio KPI now counts ACTIVE+OVERDUE+DEFAULT (correct per business model) ✓
- `DataTable.tsx`: `enableSorting` fix allows `col.sortable === true` to override the `!col.render` condition ✓
- No new controllers added; all service methods are non-mutating additions or small fixes ✓
- No raw `fetch()` in frontend changes ✓
- No hardcoded hex colors or `bg-gray-*` violations ✓

---

## Recommendation

**REVIEW** — Fix W-001 (1-line change) and W-002 (replace `browser.connected` check) before merge.

### Required fixes
```typescript
// W-001: trade-in.service.ts accept() — checklistResults JSON
// Before:
agreedPrice: Number(costPrice),
// After:
agreedPrice: costPrice.toNumber(),

// W-002: voucher.service.ts getBrowser() reconnect condition
// Before:
if (browser.connected === false || !browser.process?.()) {
// After:
if (!browser.isConnected()) {
// Note: cast type accordingly — puppeteer Browser has isConnected(): boolean
```
