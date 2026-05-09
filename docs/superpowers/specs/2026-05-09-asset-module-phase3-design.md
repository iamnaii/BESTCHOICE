# Asset Module Phase 3 — Reports — Design Spec

**Date:** 2026-05-09
**Author:** Brainstorming session
**Source:** Phase 1 deferred items + accountant requirements (year-end audit, ภ.ง.ด. submission)
**Phase:** 3 of 3 (Reports)
**Predecessors:** Phase 1 (`beeca351`) + Phase 2 (`7131b148`) merged on main

---

## Background

Phases 1 and 2 shipped the operational asset module: schema, entry workflow, lifecycle ops (dispose, depreciation, transfer). Phase 3 closes the loop with **5 read-only report pages** that give the accountant + management visibility into the register state, NBV projections, JE traceability, operational summaries, and per-asset audit trails.

Backend already has: `findAll` (list), `getDepreciationSummary` (counts), `getAuditTrail` (per-asset). Phase 3 adds 4 new aggregation/projection endpoints + 1 historical-NBV calculation, plus 5 frontend pages.

---

## Goals

1. **AssetRegisterPage** with historical as-of-date NBV calculation + CSV/XLSX export. Critical for year-end audit and ภ.ง.ด. submission.
2. **AssetSchedulePage** per-asset month-by-month NBV projection drill-down (forecast from purchaseDate to fully-depreciated, handles residualValue floor + disposal cutoff).
3. **AssetJournalPage** dedicated JV list scoped to asset-related flows (purchase, disposal, depreciation, all reversals).
4. **AssetSummaryReportPage** single page with 4 tabs (by category / custodian / location / movement) for operational visibility.
5. **AssetAuditPage** per-asset full audit trail viewer with action + date filters.

All read-only. No V15 guard, no JE writes, no schema changes.

---

## Non-Goals

- **Aggregate schedule** (whole register projection in one view) — out of scope. Per-asset only.
- **Per-asset trend chart / graph visualizations** — tables only. Phase 4 candidate if needed.
- **Cross-period reconciliation reports** — out of scope; covered by trial balance in accounting module.
- **Email-scheduled report exports** — manual download only.
- **Tax-form generation** (ภ.ง.ด. PDFs etc.) — out of scope; CSV/XLSX export sufficient.
- **PEAK sync** — already deferred (memory `project_phase4_deferred`).

---

## Architecture

### Module layout (additions)

```
apps/api/src/modules/asset/
├── asset.controller.ts                     — add 3 GET endpoints
├── asset.service.ts                        — add getRegister + getAssetSchedule
├── asset-reports.service.ts                [NEW] — summary aggregations (separate from main service for clarity)
└── __tests__/
    ├── asset.service.spec.ts               — add register + schedule tests
    └── asset-reports.service.spec.ts       [NEW] — summary aggregation tests

apps/api/src/modules/journal/                — separate concern
└── (no changes — query directly via Prisma JSON path filter from a new asset-journal service)

apps/api/src/modules/asset/asset-journal.service.ts  [NEW] — filter JE by metadata.flow

apps/web/src/pages/assets/
├── AssetRegisterPage.tsx                   [NEW]
├── AssetSchedulePage.tsx                   [NEW]
├── AssetJournalPage.tsx                    [NEW]
├── AssetSummaryReportPage.tsx              [NEW]
├── AssetAuditPage.tsx                      [NEW]
├── api.ts                                  — add 5 API wrappers
└── types.ts                                — add report types

apps/web/src/lib/exportXlsx.ts               — exists already (or add helper if missing)
```

### Routes

```
/assets/register              → AssetRegisterPage      [sidebar nav]
/assets/journal               → AssetJournalPage       [sidebar nav]
/assets/summary-report        → AssetSummaryReportPage [sidebar nav]
/assets/:id/schedule          → AssetSchedulePage      [drill-down from /assets/:id]
/assets/:id/audit             → AssetAuditPage         [drill-down from /assets/:id]
```

Sidebar additions under existing "สินทรัพย์" section:
- "ทะเบียนสินทรัพย์" → `/assets/register`
- "รายงานสรุป" → `/assets/summary-report`
- "JV สินทรัพย์" → `/assets/journal`

The 2 drill-down pages reachable from AssetDetailPage's existing action menu + audit/transfer history sections.

---

## Section A: Asset Register (HIGH priority)

### Backend additions

**Service method:** `AssetService.getRegister(filters)`

```typescript
async getRegister(filters: {
  asOfDate?: string;        // YYYY-MM-DD; defaults to today
  category?: AssetCategory;
  status?: AssetStatus;     // default 'POSTED'
  branchId?: string;
  search?: string;
  page?: number;
  limit?: number;
}): Promise<{
  data: AssetRegisterRow[];
  total: number;
  page: number;
  limit: number;
  asOfDate: string;
  summary: { count: number; totalPurchaseCost: string; totalAccumulatedDepr: string; totalNbv: string };
}>
```

Each `AssetRegisterRow`:
```typescript
{
  id, assetCode, name, category, custodian, location, branchId, branch,
  purchaseDate, purchaseCost,
  // historical at asOfDate:
  accumulatedDeprAt: string,
  netBookValueAt: string,
  monthlyDepr: string,
  remainingMonths: number,
  status: AssetStatus,
}
```

**Historical NBV calculation logic:**
- For each asset filter-matched: sum `DepreciationEntry.amount where assetId = asset.id AND period <= asOfYearMonth(asOfDate) AND reversedAt IS NULL`
- `accumulatedDeprAt = sum(amounts)`
- `netBookValueAt = purchaseCost - accumulatedDeprAt`
- `remainingMonths = ceil((netBookValueAt - residualValue) / monthlyDepr)` (capped at 0)
- Filter assets: only include where `purchaseDate ≤ asOfDate AND (status='POSTED' OR (status IN ('DISPOSED','WRITTEN_OFF') AND disposalDate > asOfDate))`

**Endpoint:** `GET /assets/register` — query params for all filters above. Returns paginated rows + summary totals.

**Roles:** OWNER, BRANCH_MANAGER, FINANCE_MANAGER, ACCOUNTANT.

### Frontend

**`AssetRegisterPage.tsx`** at `/assets/register`:

```
┌─ Header ─────────────────────────────────────┐
│ ทะเบียนสินทรัพย์                              │
│ As-of: <ThaiDateInput, default today>         │
│ [Export CSV] [Export Excel]                  │
└──────────────────────────────────────────────┘

┌─ Summary cards ──────────────────────────────┐
│ จำนวน: N · ราคาทุนรวม · NBV รวม              │
└──────────────────────────────────────────────┘

┌─ Filters ────────────────────────────────────┐
│ search · category · branchId · status        │
└──────────────────────────────────────────────┘

┌─ DataTable ──────────────────────────────────┐
│ assetCode · name · category · purchaseDate · │
│ purchaseCost · accumulatedDepr@ · NBV@ ·     │
│ monthlyDepr · remainingMonths · custodian    │
└──────────────────────────────────────────────┘
```

**Export:** Click "Export CSV" → call API with same filters + format='csv' → download. "Export Excel" → format='xlsx'. Uses existing `exceljs` library; reuse pattern from `apps/api/src/modules/sales/excel.util.ts` if present, otherwise inline a CSV serializer for 12 columns.

Alternative simpler approach: do CSV generation client-side (no extra endpoint). The `data` array from list query is already in memory; serialize columns + trigger browser download via `URL.createObjectURL(new Blob([csv], {type:'text/csv'}))`. **Prefer this** — avoids backend complexity and matches scope (small business, ≤ ~50 assets).

---

## Section B: Asset Schedule (per-asset NBV projection)

### Backend addition

**Service method:** `AssetService.getAssetSchedule(assetId)`

Returns month-by-month NBV from `purchaseDate` until either:
- NBV ≤ `residualValue` (fully depreciated)
- `disposalDate` is set (truncates schedule)
- 60 months hard cap (sanity)

```typescript
{
  assetId, assetCode, name, purchaseDate, purchaseCost, residualValue, monthlyDepr,
  rows: [
    { period: 'YYYY-MM', monthlyDepr: '833.33', accumulatedDepr: '833.33', netBookValue: '29166.67', status: 'ACTIVE' },
    // ...
    { period: '2029-01', monthlyDepr: '166.67', accumulatedDepr: '30000.00', netBookValue: '0.00', status: 'FULLY_DEPRECIATED' },
  ],
}
```

The last period's `monthlyDepr` adjusts so `netBookValue = residualValue` (no over-depreciation).

If a `DepreciationEntry` exists for a period (i.e., already happened), use the actual entry; else use formula projection.

**Endpoint:** `GET /assets/:id/schedule`

**Roles:** OWNER, BRANCH_MANAGER, FINANCE_MANAGER, ACCOUNTANT.

### Frontend

**`AssetSchedulePage.tsx`** at `/assets/:id/schedule`:

Header with asset summary card (link back to detail) + DataTable with the rows above. Color-coded ACTIVE / FULLY_DEPRECIATED status. Highlight current month.

---

## Section C: Asset Journal (filtered JV list)

### Backend addition

**Service method:** `AssetJournalService.list(filters)`

```typescript
async list(filters: {
  page?: number;
  limit?: number;
  search?: string;        // matches asset.assetCode/name
  flowType?: 'purchase' | 'depreciation' | 'disposal' | 'all-reversals' | 'all';
  fromDate?: string;
  toDate?: string;
}): Promise<{ data: AssetJournalRow[]; total: number; page: number; limit: number }>
```

Query: `JournalEntry where metadata.flow IN ['asset-purchase', 'asset-purchase-reverse', 'asset-disposal', 'asset-disposal-reverse', 'depreciation', 'depreciation-reverse']` (filtered by `flowType` param), `entryDate` range, with joined `lines` and a fallback to lookup the related asset via `metadata.assetId`.

Each `AssetJournalRow`:
```typescript
{
  id, entryNumber, entryDate, status, description,
  flow: string,            // 'asset-purchase' etc.
  assetId: string | null,  // from metadata.assetId
  asset: { assetCode, name } | null,  // joined
  totalDr: string, totalCr: string,
  reversed: boolean,         // metadata.reversed === true
  reversedByEntryNumber: string | null,
}
```

**Endpoint:** `GET /assets/journal` — separate AssetJournalController with `@Controller('assets/journal')` for clean prefix.

**Roles:** All 4.

### Frontend

**`AssetJournalPage.tsx`** at `/assets/journal`:

DataTable: entryDate · entryNumber · flow badge · asset (link) · description · totalDr · totalCr · status (POSTED/REVERSED indicator from `metadata.reversed`)

Filters: search · flow type select · date range
Click row → modal showing JE lines (or navigate to a future `/journal/:id` detail page if exists)

---

## Section D: Asset Summary Report (4 tabs)

### Backend addition

**Service:** `AssetReportsService` (new file for separation of concerns)

3 methods + reuse 1 existing:

1. `getCategorySummary(filters)` — group by `category`, return:
   ```typescript
   { category: AssetCategory, label: string, count: number, totalPurchaseCost: string, totalAccumulatedDepr: string, totalNbv: string }[]
   ```
   Filter by `status` (default `POSTED`), `branchId`, `asOfDate` (uses same historical NBV logic as Register).

2. `getCustodianSummary(filters)` — group by `custodian` field (free-text). Same shape as #1 with `custodian: string` key.

3. `getLocationSummary(filters)` — group by `location` field. Same shape as #1 with `location: string` key.

4. **Movement timeline** — reuse existing `AssetTransferService.listAllTransfers` already shipped Phase 2. Frontend renders transfer history as a chronological timeline view rather than a flat table.

**Endpoints:**
- `GET /reports/asset-summary/category`
- `GET /reports/asset-summary/custodian`
- `GET /reports/asset-summary/location`
- (Movement tab uses existing `GET /asset-transfers`)

Or single endpoint with `groupBy` query param:
- `GET /reports/asset-summary?groupBy=category|custodian|location`

**Pick single endpoint** — DRYer + 1 controller method.

**New controller:** `AssetReportsController` at `/reports/asset-summary` (separate from `AssetController` to keep prefix clean).

**Roles:** All 4.

### Frontend

**`AssetSummaryReportPage.tsx`** at `/assets/summary-report`:

Tabs component (shadcn): 4 tabs (หมวดหมู่ / ผู้ดูแล / ที่ตั้ง / การเคลื่อนไหว).

Tabs 1-3: each renders DataTable with grouped data + summary footer row.
Tab 4: timeline list of recent 100 transfers (uses `/asset-transfers?limit=100`).

Shared filter card above tabs: as-of-date · branch · status (default POSTED).

---

## Section E: Asset Audit Page (per-asset full trail)

### Backend

No new endpoint — reuse existing `GET /assets/:id/audit` shipped in Phase 1 which returns last 100 AuditLog entries.

If user asks for older entries (rare for small business), they can use the master `/audit-logs` page (existing). Phase 3 doesn't add pagination to `/assets/:id/audit` — keep last-100 cap.

### Frontend

**`AssetAuditPage.tsx`** at `/assets/:id/audit`:

Header with asset summary + back to detail. Action filter (multi-select: ASSET_CREATE, ASSET_UPDATE, ASSET_POST, ASSET_REVERSE, ASSET_DISPOSE, ASSET_REVERSE_DISPOSE, ASSET_TRANSFER, *_BLOCKED). Date range filter.

DataTable: timestamp · action badge · user · oldValue summary · newValue summary · expand button → show full JSON diff.

Click "expand" → expand row to show formatted oldValue/newValue diff.

---

## Permissions matrix (Phase 3)

| Endpoint | OWNER | BRANCH_MGR | FINANCE_MGR | ACCOUNTANT | SALES |
|----------|:---:|:---:|:---:|:---:|:---:|
| GET /assets/register | yes | yes | yes | yes | no |
| GET /assets/:id/schedule | yes | yes | yes | yes | no |
| GET /assets/journal | yes | yes | yes | yes | no |
| GET /reports/asset-summary | yes | yes | yes | yes | no |
| GET /assets/:id/audit (existing) | yes | yes | yes | yes | no |

All 4 roles get read access since reports are reference data, not destructive ops.

---

## Validation rules

Server-side (no client-side schema since these are GET-only with query params):
- `asOfDate`: optional, valid date string ≤ today; defaults to today
- `category`: optional, must be valid `AssetCategory` enum
- `status`: optional, must be valid `AssetStatus`
- `branchId`: optional UUID
- `search`: optional string ≤ 100 chars
- `page`: optional positive int (default 1)
- `limit`: optional positive int 1-200 (default 50)
- `flowType`: optional, one of the 5 allowed values
- `fromDate` / `toDate`: optional valid date strings; if both, fromDate ≤ toDate
- `groupBy` (summary endpoint): one of `'category'|'custodian'|'location'`

Reject invalid params with 400 + Thai message.

---

## Testing strategy

### Unit tests (jest, real DB)

- `asset.service.spec.ts` extensions (~10 cases)
  - `getRegister` with default asOfDate (today) → all POSTED assets returned
  - `getRegister` with past asOfDate → assets created after asOfDate excluded; disposed assets reincluded if disposalDate > asOfDate
  - `getRegister` historical NBV calculation: 2 DepreciationEntry rows applied + 1 reversed → only 1 contributes
  - `getRegister` summary totals match sum of rows
  - `getRegister` paginates
  - `getRegister` filters by category/branch/status correctly
  - `getAssetSchedule` produces N rows where N = ceil((purchaseCost-residual)/monthlyDepr), capped at 60
  - `getAssetSchedule` last period adjusts to residualValue floor (no over-depreciation)
  - `getAssetSchedule` truncates at disposalDate when set
  - `getAssetSchedule` uses actual DepreciationEntry where it exists, formula otherwise

- `asset-reports.service.spec.ts` NEW (~6 cases)
  - getCategorySummary aggregates correctly
  - getCustodianSummary handles null custodian (groups as 'ไม่ระบุ')
  - getLocationSummary handles null location
  - asOfDate respected (historical NBV used in totals)
  - Filter by branch / status work
  - Empty result returns array (not error)

- `asset-journal.service.spec.ts` NEW (~5 cases)
  - list returns asset-related JEs only (filtered by metadata.flow)
  - flowType filter narrows to specific flow
  - search matches asset.assetCode / name
  - date range filter
  - paginates

### E2E tests (Playwright, smoke)

- `assets-register.spec.ts` — load /assets/register, verify asset rows appear, change as-of-date, verify response changes
- `assets-summary-report.spec.ts` — load /assets/summary-report, switch tabs, verify each renders
- `assets-journal.spec.ts` — load /assets/journal, verify JE rows from different flows appear
- `asset-audit-trail.spec.ts` — navigate to /assets/:id/audit, verify entries appear

(Schedule page covered by detail-page navigation; no separate E2E.)

### Acceptance

- TypeScript: 0 errors
- jest: ~21 new tests pass + existing 77 still pass
- E2E: 4 new smoke tests deferred to dev-server runtime
- Manual smoke: navigate to each report, verify data is accurate + CSV downloads

---

## CSV/XLSX export — implementation choice

**Client-side serialization** (simpler):
- Use existing `papaparse` (if present) or inline serializer for CSV
- For XLSX, use `xlsx` library (lightweight) on the client
- No backend export endpoint; reuse data from `getRegister` query response

Verify what's already in `apps/web/package.json`. If `xlsx`/`exceljs` not on web, install `xlsx` (≈100KB gzipped, lazy-load via dynamic import).

Memo: Phase 1 noted `bundle split: exceljs/jspdf/recharts แยก chunks`. Reuse that pattern for the report page's export functionality — `import('xlsx')` inside the export handler.

---

## Out of Scope (explicit)

- Aggregate schedule (whole register projected month-by-month)
- Trend charts / graphs
- ภ.ง.ด. PDF generation
- Email-scheduled exports
- Cross-period reconciliation
- PEAK sync
- Per-asset photo timeline

---

## Open Questions

None — all design decisions resolved during brainstorming.
