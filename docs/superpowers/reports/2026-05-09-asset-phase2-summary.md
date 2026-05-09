# Asset Module Phase 2 — Implementation Summary

**Branch:** `feat/asset-module-phase2` (16 task commits + 1 unrelated `feat/termination` commit absorbed)
**TypeScript:** 0 errors (api + web)
**Tests:** 77 jest + 51 vitest = **128 backend tests** (0 failures excluding pre-existing dist/ bundle artifacts)
**E2E specs:** 4 created (deferred to manual run — need API + Web dev servers up)

## Sections shipped

### Section A — Disposal (Tasks 1-7)
- DTOs: `DisposeAssetDto` (conditional proceeds/depositAccount on SALE) + `ReverseDisposalDto`
- `AssetDisposalReverseTemplate` (8 vitest tests) — mirror disposal JE, restore asset to POSTED
- `AssetService.dispose` + `reverseDispose` (13 jest tests) — full atomicity with V15 guards on disposalDate (dispose) and current date (reverse), AuditLog `ASSET_DISPOSE`/`_BLOCKED` + `ASSET_REVERSE_DISPOSE`/`_BLOCKED`
- 2 controller endpoints (OWNER+FINANCE_MANAGER for dispose, OWNER-only for reverse)
- Frontend foundation: API wrappers, DisposalCalculation type, zod/v4 schema, useDisposalCalculation hook
- `AssetDisposePage` — 3 sections (วิธีจำหน่าย toggle / รายละเอียด / Auto JE Preview), live gain/loss + balanced badge, sticky action bar
- `ReverseDisposalDialog` mounted on AssetDetailPage (DISPOSED/WRITTEN_OFF status)
- DetailPage action menu adds Dispose action (POSTED) + Reverse-Dispose action + transfers list link
- Routes wired + 2 E2E specs (assets-dispose, assets-write-off)

### Section B — Depreciation (Tasks 8-13)
- Schema migration: `DepreciationEntry +reversedAt +reversedById` (nullable, additive — no wipe needed) + `[period, reversedAt]` compound index + `User.depreciationEntriesReversed` back-relation
- New module `apps/api/src/modules/depreciation/` (separate from /assets for cross-asset operations)
- `DepreciationService.listRuns` (aggregate by period with status POSTED/REVERSED) + `previewRun` (per-asset dry-run, prefers asset.coa* snapshots) + `runManual` (V15 guard, future-period guard, idempotent per-asset) + `reverseRun` (cascading reverse) — **19 jest tests**
- `DepreciationReverseTemplate` (cascading: reverse all unreversed entries in period, rollback accumulatedDepr + recompute NBV per asset, mark entry.reversedAt, cross-period guard refuses if later period has unreversed) — **8 vitest tests**
- `DepreciationController` 4 endpoints (GET list/preview/POST run/reverse with role gates per spec)
- Forward `DepreciationTemplate.metadata.flow` renamed `monthly` → `depreciation` for consistency with reverse template lookups
- `DepreciationPage` — period selector (last 12 months) + preview table + history DataTable with status badges + reverse action + 2 dialogs
- Sidebar nav: "ค่าเสื่อม" entry added to OWNER/FINANCE_MANAGER/ACCOUNTANT configs
- Route + E2E spec (depreciation-manual)

### Section C — Transfer audit (Tasks 14-15)
- `AssetTransferService.listAllTransfers` (filters: search, custodianContains, locationContains, branchId, fromDate, toDate; paginated 50/page; joined asset + transferredBy) — **6 jest tests**
- New `AssetTransferController` for `GET /asset-transfers` (separate route prefix)
- `AssetTransfersListPage` — cross-asset audit table with filters + clickable rows to detail
- Route + E2E spec (transfers-list)
- Reachable from AssetDetailPage's transfer history card link

## Notable adaptations during implementation

1. **Forward depreciation template `flow` rename** (Task 11) — `'monthly'` → `'depreciation'` to align with reverse template's lookup key. Spec test updated.
2. **Migration hand-written** (Task 8) — `prisma migrate dev --create-only` failed on shadow DB (pgvector unavailable); hand-wrote ALTER TABLE SQL and applied via `migrate deploy`. Same pattern as Phase 1.
3. **Future-period guard uses periodStart, not periodEnd** (Task 10) — `periodEnd > today` would reject current-month manual runs mid-month. Switched to `periodStart > today` (rejects only periods that haven't started yet).
4. **Test pollution cleanup** (Task 12) — added `DEP-TEST-*` prefix cleanup in `beforeEach` to handle vitest+jest test cross-contamination on shared dev DB.
5. **DataTable generic constraint** (Task 13) — `T extends { id: string }` required adding synthetic `id: period` for run summary rows.
6. **AssetTransferService spec pre-broken** (Task 14) — Task 3 added 2 new templates to AssetService constructor; spec was missing them. Fixed during Task 14 work.

## Known concerns

- **E2E tests deferred** — 4 specs created (assets-dispose, assets-write-off, depreciation-manual, transfers-list) but not executed; need running API + Web dev servers.
- **Vitest dist/ failures** — 31 vitest "failures" are stale dist/ CommonJS bundle artifacts; source-level tests all pass. Project-wide pre-existing issue, not Phase 2 regression.
- **One unrelated commit absorbed** — `7dced434 feat(termination): JP5 LEGAL guard...` was committed to the phase2 branch by external work during Phase 2 execution. Not part of Phase 2 scope but landed on the branch.

## Permissions matrix shipped (per spec)

| Endpoint | OWNER | BRANCH_MGR | FINANCE_MGR | ACCOUNTANT |
|----------|:---:|:---:|:---:|:---:|
| POST /assets/:id/dispose | yes | no | yes | no |
| POST /assets/:id/reverse-dispose | yes | no | no | no |
| GET /depreciation | yes | yes | yes | yes |
| GET /depreciation/preview/:period | yes | yes | yes | yes |
| POST /depreciation/run | yes | no | yes | no |
| POST /depreciation/:period/reverse | yes | no | no | no |
| GET /asset-transfers | yes | yes | yes | yes |

## Deferred to Phase 3 (Reports)

- AssetRegisterPage — full register report with as-of-date + CSV export
- AssetSchedulePage — NBV month-by-month projection
- AssetJournalPage — filtered JV list scoped to assets
- AssetSummaryReportPage — 4 tabs by category/custodian/location/movement
- AssetAuditPage — per-asset audit trail viewer (endpoint exists, UI pending)
