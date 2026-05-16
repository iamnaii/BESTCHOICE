# Merge Guard Report — feat/ui-polish-emoji-daily-sheet-range

**Date**: 2026-05-16  
**Branch**: `feat/ui-polish-emoji-daily-sheet-range`  
**Author**: Akenarin Kongdach  
**Commits**: 1  
**Changes**: 40 files changed, +337 / -340  

---

## Summary

Single-commit chore covering three concerns:

1. **Dark-mode contrast fixes** — across ~30 components (status badges, text colours, icon fills)
2. **Emoji → Lucide icons** — replaces inline emoji (`✓`, `⚠`, `✕`, step-number circles) with `<Check>`, `<AlertCircle>`, `<X>`, `<CheckCircle2>` from lucide-react
3. **Daily sheet date range** — `GET /other-income/daily-sheet` extended from single `?date=` to `?startDate=&endDate=` (inclusive both ends, capped at 366 days)

---

## File Changes

| Area | Files | Δ |
|---|---|---|
| API: `DailySheetQueryDto` (date→range) | 1 | +8 / -3 |
| API: `OtherIncomeService.dailySheet()` | 1 | +30 / -15 |
| API: `OtherIncomeController` | 1 | +1 / -1 |
| Web: `otherIncome.ts` / `otherIncome.types.ts` | 2 | +12 / -8 |
| Web: `DateRangeChips.tsx` | 1 | +10 / -14 |
| Web: `OverrideConfirmDialog.tsx` | 1 | +2 / -2 |
| Web: UI components (dark-mode + lucide) | ~33 | +274 / -297 |

---

## Issues Found

### Critical
_None_

### Warning

**W1 — Breaking API contract on `GET /other-income/daily-sheet`**  
File: `apps/api/src/modules/other-income/other-income.controller.ts`

The endpoint's query parameter changed from `?date=YYYY-MM-DD` (single field) to `?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD` (two fields). Any client still sending `?date=` will receive a **400 Bad Request** from the DTO `ValidationPipe`.

Confirmed mitigated: `apps/web/src/lib/otherIncome.ts` is updated in the same commit to send `startDate`/`endDate`. No external consumers of this endpoint are known (internal admin tool). However, if other frontend sessions are cached (CDN, service worker) they may briefly 400 until refresh.

**Action**: Verify no other callers (LIFF pages, Chatcone webhooks, PEAK export) pass `?date=`. A quick `grep -r 'daily-sheet' apps/web` after merge is recommended.

### Info

**I1 — `other-income.service.ts` is now 1,385 lines**  
This is a pre-existing condition; this branch adds ~15 net lines to the method. Not a merge blocker, but the file is a candidate for splitting at the next refactor opportunity.

**I2 — `toBkkStart()` helper is inlined in `dailySheet()`**  
The BKK timezone parsing helper defined inside `dailySheet()` duplicates the pattern from `DocNumberService.getBkkDayBounds()`. No functional bug, but extracting to a shared util (`utils/bkk-time.util.ts`) would reduce drift risk if the BKK offset logic ever needs updating.

**I3 — Date range cap (366 days) is hardcoded**  
`const MAX_RANGE_DAYS = 366` at service line. Acceptable for now; could be moved to `SystemConfig` if operators need a different default.

---

## Security Checklist

| Check | Result |
|---|---|
| New controller methods with missing `@UseGuards` | ✅ Existing controller — guards unchanged |
| `@Roles()` on changed controller method | ✅ `dailySheet` inherits class-level guard |
| DTO validation on new params | ✅ Both `startDate`/`endDate` have `@IsDateString()` |
| Business logic validation | ✅ Service rejects `endDate < startDate` + range > 366 days with Thai `BadRequestException` |
| `deletedAt: null` in modified query | ✅ Present in `findMany` where clause |
| Hardcoded secrets / API keys | ✅ None |
| `$queryRaw` | ✅ None |
| Raw `fetch()` in frontend | ✅ Uses `api.get()` via `otherIncome.ts` |
| Hardcoded hex / `bg-gray-*` colors | ✅ All changes use semantic tokens / lucide components |

---

## Recommendation

**APPROVE** with one post-merge action item:

- After merging, run `grep -r 'daily-sheet' apps/` to confirm no stale `?date=` callers remain outside the updated `otherIncome.ts` client.
