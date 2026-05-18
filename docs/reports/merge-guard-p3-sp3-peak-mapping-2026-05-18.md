# Pre-Merge Guard Report

**Branch**: `feat/p3-sp3-peak-mapping`  
**Author**: Akenarin Kongdach <akenarin.ak@gmail.com>  
**Date**: 2026-05-18  
**Reviewer**: Pre-Merge Guard (automated)

---

## File Changes Summary

| File | Lines Added |
|------|-------------|
| `apps/api/src/modules/chart-of-accounts/chart-of-accounts.controller.ts` | +51 modified |
| `apps/api/src/modules/chart-of-accounts/chart-of-accounts.service.ts` | +127 modified |
| `apps/api/src/modules/chart-of-accounts/dto/peak-mapping.dto.ts` | +37 (new) |
| `apps/api/src/modules/chart-of-accounts/chart-of-accounts.service.spec.ts` | +163 modified |
| `apps/api/src/modules/accounting/accounting.controller.ts` | +41 modified |
| `apps/api/src/modules/accounting/accounting.service.ts` | +139 modified |
| `apps/api/src/modules/accounting/accounting.service.spec.ts` | +88 modified |
| `apps/api/src/modules/journal/__tests__/csv-fixture-loader.ts` | +5 modified |
| `apps/api/prisma/schema.prisma` | +4 modified |
| `apps/api/prisma/seed-coa-finance.ts` | +12 modified |
| `apps/web/src/pages/PeakExportPage.tsx` | +147 (new) |
| `apps/web/src/pages/__tests__/PeakExportPage.test.tsx` | +77 (new) |
| `apps/web/src/pages/SettingsPage/components/PeakMappingSettings.tsx` | +311 (new) |
| `apps/web/src/pages/SettingsPage/components/__tests__/PeakMappingSettings.test.tsx` | +159 (new) |
| `apps/web/src/pages/SettingsPage/tabs/PeakMappingTab.tsx` | +5 (new) |
| `apps/web/src/pages/SettingsPage/index.tsx` | +7 modified |
| `apps/web/src/App.tsx` | +9 modified |
| `apps/web/src/config/menu.ts` | +5 modified |
| 1 migration | +11 (new) |

**Total**: 20 files changed, 1442 insertions, 6 deletions

---

## Issues by Severity

### Critical (must fix before merge)
_No critical issues found._

### Warning (should fix)
_No warning issues found._

### Info (low priority)
1. **`Number(res.headers['x-skipped-lines'])` in frontend** — `PeakExportPage.tsx:62,63`  
   Parses HTTP response header string to number. This is the correct approach for reading numeric headers — not a money field. No action required.

---

## Positive Findings

- `@UseGuards(JwtAuthGuard, RolesGuard)` inherited at class level on `ChartOfAccountsController` ✅
- `@Roles()` on all 3 new chart-of-accounts endpoints:  
  - `GET /chart-of-accounts/peak-mapping` (OWNER/FM/ACC)  
  - `PUT /chart-of-accounts/peak-mapping` (OWNER/ACC)  
  - `GET /chart-of-accounts/peak-mapping/csv` (OWNER/FM/ACC)
- New `GET /expenses/journal/export-peak` endpoint has `@Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')`
- 186-day date range cap implemented in `exportJournalWithPeakCodes()` service method ✅
- Money values emitted as `Prisma.Decimal.toString()` in CSV export — no `Number()` on financial fields ✅
- `deletedAt: null` on all queries (`chartOfAccount.findMany`, `journalLine.findMany`) ✅
- CSV `escape()` function correctly handles commas, quotes, and newlines — no CSV injection risk
- `PEAK_MAPPING_UPDATED` audit log with diff written on bulk update
- Re-seeder (`seed-coa-finance.ts`) only writes `peakCode` when CSV cell is non-empty — does not overwrite owner-set values on re-seed
- Frontend `PeakExportPage` correctly uses `api.get()` with `responseType: 'blob'` (not raw `fetch()`)
- `ProtectedRoute roles={['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT']}` on `PeakExportPage` route in `App.tsx`
- Route path `/expenses/journal/export-peak` matches between `AccountingController` (`@Controller('expenses')` + `@Get('journal/export-peak')`) and frontend API call ✅
- `Access-Control-Expose-Headers` set for `X-Skipped-Lines` and `X-Row-Count` so browser can read them through CORS ✅
- UTF-8 BOM prepended to CSV output so Excel renders Thai characters correctly
- `peakCode` is not seeded from CSV unless non-empty — backward-compatible with existing deployments

---

## Recommendation: **APPROVE**

No blocking issues. The implementation strictly follows accounting.md spec (186-day cap, Decimal precision, CORS header exposure). Security model is correct (OWNER/FM/ACC read, OWNER/ACC write). CSV export is injection-safe.
