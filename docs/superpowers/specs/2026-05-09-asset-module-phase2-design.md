# Asset Module Phase 2 — Lifecycle Operations — Design Spec

**Date:** 2026-05-09
**Author:** Brainstorming session
**Source:** `Handover.md` (Asset Acquisition System v3.4) + Phase 1 design (`2026-05-08-asset-module-phase1-design.md`)
**Phase:** 2 of 3 (Lifecycle Operations: Disposal/Depreciation/Transfer)
**Scope:** FINANCE company only; SHOP-side asset accounting deferred
**Predecessors:** Phase 1 merged at `beeca351` — schema, entry workflow, AssetPurchaseTemplate + reverse, AssetTransferService all live

---

## Background

Phase 1 shipped the foundation: schema, entry workflow (DRAFT → POSTED → REVERSED), purchase JE, and an in-modal transfer dialog. Phase 2 ships the three lifecycle operations that turn the asset module from "create + post" into a complete bookkeeping system: dispose assets when they leave the company, run/reverse monthly depreciation manually, and audit cross-asset custodian/location movements.

All three features have backend foundations in place from Phase 1:
- `AssetDisposalTemplate` (`apps/api/src/modules/journal/cpa-templates/asset-disposal.template.ts`) refactored for atomicity + idempotency
- `DepreciationTemplate` + `DepreciationCron` (`apps/api/src/modules/journal/cron/depreciation.cron.ts`) running monthly at 28-31 01:00 BKK
- `AssetTransferService` (`apps/api/src/modules/asset/asset-transfer.service.ts`) with full per-asset history

What's missing: 2 reverse JE templates, 5+ service methods, 7+ controller endpoints, 3 frontend pages.

---

## Goals

1. **Disposal page** — dedicated `/assets/:id/dispose` route with toggle (Sale / Write-off), live gain/loss + JE preview, V15 period guard, reverse-disposal action on detail page.
2. **Depreciation page** — dedicated `/depreciation` route with last-12-months period selector, preview-before-run, manual run, list of past runs with reverse action.
3. **Transfer list page** — dedicated `/assets/transfers` route showing cross-asset transfer audit with filters (date range, custodian, location, branch, asset search) and 50/page pagination.
4. **Two new JE templates** — `DepreciationReverseTemplate` and `AssetDisposalReverseTemplate` mirroring the Phase 1 reverse pattern (mirror lines, metadata.flow, asset/entry status updates atomic).
5. **Sidebar nav** — add "ค่าเสื่อม" pointing to `/depreciation`. Transfer list only reachable from detail page (audit-style).

---

## Non-Goals

- **Bulk operations** — no bulk dispose/transfer of multiple assets at once. Owner business is small (1-3 EQUIPMENT/yr) and per-record audit clarity matters more than throughput.
- **CSV/Excel export** — deferred to Phase 3 (Reports phase) which adds Register / NBV Schedule / Movement Summary / Audit pages with export.
- **PDF receipts/disposal certificates** — out of scope; existing `taxInvoiceNo`/`disposalNote` text fields suffice for Phase 2.
- **Photo upload** — out of scope per Handover §1.5.
- **PEAK sync** — out of scope (deferred per memory `project_phase4_deferred`).
- **Cron schedule changes** — depreciation cron continues at 28-31 01:00 BKK; this phase only adds manual override.

---

## Architecture

### Module layout (additions)

```
apps/api/src/modules/asset/
├── asset.controller.ts                        — add 6 new endpoints
├── asset.service.ts                           — add dispose/writeOff/reverseDispose/listDisposals
├── asset-transfer.service.ts                  — add listAllTransfers (cross-asset)
└── dto/
    ├── dispose-asset.dto.ts                   [NEW] (replaces stub)
    ├── write-off-asset.dto.ts                 [NEW]
    ├── reverse-disposal.dto.ts                [NEW]
    └── reverse-depreciation.dto.ts            [NEW]

apps/api/src/modules/depreciation/             [NEW MODULE]
├── depreciation.controller.ts                 — manual-run endpoints (separate from /assets to keep cross-asset ops together)
├── depreciation.service.ts                    — runManual / preview / reverseRun / listRuns
├── depreciation.module.ts
├── dto/
│   ├── run-depreciation.dto.ts
│   └── reverse-depreciation-run.dto.ts
└── __tests__/
    └── depreciation.service.spec.ts

apps/api/src/modules/journal/cpa-templates/
├── asset-disposal-reverse.template.ts         [NEW]
├── asset-disposal-reverse.template.spec.ts    [NEW]
├── depreciation-reverse.template.ts           [NEW]
└── depreciation-reverse.template.spec.ts      [NEW]

apps/web/src/pages/assets/
├── AssetDisposePage.tsx                       [NEW]
└── components/
    └── ReverseDisposalDialog.tsx              [NEW]

apps/web/src/pages/transfers/                  [NEW DIR]
└── AssetTransfersListPage.tsx

apps/web/src/pages/depreciation/               [NEW DIR]
├── DepreciationPage.tsx
└── components/
    ├── DepreciationRunDialog.tsx
    ├── DepreciationPreviewTable.tsx
    └── ReverseDepreciationRunDialog.tsx
```

### Routing

```
Existing (Phase 1):       /assets, /assets/new, /assets/:id, /assets/:id/edit
New (Phase 2):
  /assets/:id/dispose         AssetDisposePage (Sale/Write-off toggle form)
  /assets/transfers           AssetTransfersListPage (cross-asset audit)
  /depreciation               DepreciationPage (manual run + history)
```

Sidebar nav addition: **"ค่าเสื่อม"** → `/depreciation` for OWNER, BRANCH_MANAGER, FINANCE_MANAGER, ACCOUNTANT.

`/assets/transfers` not in sidebar — accessed from "ดูประวัติการโอนทั้งหมด" link on AssetDetailPage transfer history section.

---

## Section A: Disposal

### Backend additions

**DTOs:**

```typescript
// dispose-asset.dto.ts
export class DisposeAssetDto {
  @IsIn(['SALE', 'WRITE_OFF'], { message: 'วิธีจำหน่ายไม่ถูกต้อง' })
  disposalType: 'SALE' | 'WRITE_OFF';

  @IsDateString({}, { message: 'วันที่จำหน่ายไม่ถูกต้อง' })
  disposalDate: string;

  @ValidateIf((o) => o.disposalType === 'SALE')
  @IsNumber() @Min(0.01, { message: 'ราคาขายต้องมากกว่า 0' })
  proceeds?: number;

  @ValidateIf((o) => o.disposalType === 'SALE')
  @IsString() @IsIn([...CASH_ACCOUNT_CODES])
  depositAccountCode?: string;

  @IsString() @IsNotEmpty()
  @MinLength(5, { message: 'เหตุผลต้องมีอย่างน้อย 5 ตัวอักษร' })
  reason: string;
}

// reverse-disposal.dto.ts
export class ReverseDisposalDto {
  @IsString() @MinLength(5, { message: 'เหตุผลต้องมีอย่างน้อย 5 ตัวอักษร' })
  reason: string;
}
```

**Service methods on `AssetService`:**

| Method | Behavior |
|--------|----------|
| `dispose(id, dto, userId)` | Outer `$transaction` calls `AssetDisposalTemplate.execute(input, tx)` + writes AuditLog `ASSET_DISPOSE`. V15 guard on `disposalDate`. Status guard: `POSTED → DISPOSED` (or `WRITTEN_OFF` when `disposalType='WRITE_OFF'`). Refuses if `disposalDate > today`. The disposal type is passed to the template so the template can branch on JE structure (existing template already supports zero-proceeds case as write-off internally). |
| `reverseDispose(id, reason, userId)` | Outer `$transaction` calls new `AssetDisposalReverseTemplate.execute(input, tx)` + writes AuditLog `ASSET_REVERSE_DISPOSE`. V15 guard on `new Date()` (current period). Status guard: `DISPOSED|WRITTEN_OFF → POSTED`. Refuses if any post-disposal depreciation entries exist (shouldn't, but defensive). |

**JE template:** `AssetDisposalReverseTemplate` mirrors the existing pattern from `AssetPurchaseReverseTemplate`:
1. Find original disposal JE via `metadata.flow='asset-disposal'` + `metadata.assetId=assetId`.
2. Throw if `original.metadata.reversed === true`.
3. Build mirror lines (swap Dr/Cr, prefix description with `[VOID]`).
4. Inside `$transaction`: idempotency re-check, post mirror via `createAndPost` with `reference: '${assetId}:reverse-dispose'` and `metadata.flow='asset-disposal-reverse'`, flag original `metadata.reversed=true`, restore asset (`status: 'POSTED'`, `disposalDate: null`, `netBookValue: <recomputed from purchaseCost - accumulatedDepr>`), write `JournalPostAuditLog` row.

**Controller endpoints (added to `AssetController`):**

```
POST /assets/:id/dispose           → AssetService.dispose
POST /assets/:id/reverse-dispose   → AssetService.reverseDispose
```

Roles:
- `dispose`: OWNER, FINANCE_MANAGER (matches `post` precedent — disposal is JE-creating)
- `reverse-dispose`: OWNER (matches `reverse` precedent — destructive correction)

### Frontend additions

**`AssetDisposePage.tsx`** at `/assets/:id/dispose`:

```
┌─ Asset summary card (read-only) ─────────────┐
│ assetCode · name · purchaseCost · NBV        │
│ accumulatedDepr · daysSincePurchase          │
└──────────────────────────────────────────────┘

┌─ Section 1: วิธีจำหน่าย ─────────────────────┐
│ [○] ขาย (จำหน่าย)                            │
│ [○] Write-off (ตัดบัญชี)                     │
└──────────────────────────────────────────────┘

┌─ Section 2: รายละเอียด ──────────────────────┐
│ วันที่จำหน่าย *  [ThaiDateInput]              │
│ ─── ถ้าเลือก ขาย ───                         │
│ ราคาขาย *       [number input]               │
│ บัญชีรับเงิน *  [Select CASH_ACCOUNTS]       │
│ ─── always ───                               │
│ เหตุผล *        [Textarea, ≥5 chars]         │
└──────────────────────────────────────────────┘

┌─ Section 3: สรุปบัญชี (Live JE Preview) ──────┐
│ NBV ปัจจุบัน                          XXX.XX │
│ ราคาขาย                               XXX.XX │
│ ─────────────                                 │
│ กำไร/ขาดทุน (auto)                    XXX.XX │
│                                              │
│ Auto JE Preview (Dr/Cr lines table)          │
│ Balanced badge ✓                             │
└──────────────────────────────────────────────┘

┌─ Sticky action bar ──────────────────────────┐
│ [ยกเลิก]  [ยืนยันการจำหน่าย]                  │
└──────────────────────────────────────────────┘
```

**Live calculation hook** `useDisposalCalculation(form)` returns `{ nbv, proceeds, gainLoss, journalLines, isBalanced }`. Reuses `CATEGORY_COA` map from Phase 1 `types.ts`.

**ReverseDisposalDialog** mounted on `AssetDetailPage` action menu when `status ∈ {DISPOSED, WRITTEN_OFF}`. Same UX pattern as `ReverseAssetDialog` (confirm dialog with reason ≥5 chars).

**Form validation** (zod):
- `disposalType` required, one of two values
- `disposalDate` valid date, ≤ today
- `proceeds` required + > 0 when `disposalType='SALE'`
- `depositAccountCode` required when `disposalType='SALE'`, must be in CASH_ACCOUNT_CODES
- `reason` ≥ 5 chars

---

## Section B: Depreciation

### Backend additions

**New module:** `apps/api/src/modules/depreciation/` — kept separate from `asset` because depreciation operations are cross-asset (one run touches every active asset for the period). Co-locating with assets would dilute the module's responsibility.

**DTOs:**

```typescript
// run-depreciation.dto.ts
export class RunDepreciationDto {
  @Matches(/^\d{4}-\d{2}$/, { message: 'รูปแบบงวดต้องเป็น YYYY-MM' })
  period: string; // e.g. "2026-05"
}

// reverse-depreciation-run.dto.ts
export class ReverseDepreciationRunDto {
  @Matches(/^\d{4}-\d{2}$/)
  period: string;

  @IsString() @MinLength(5)
  reason: string;
}
```

**Service:** `DepreciationService`:

| Method | Behavior |
|--------|----------|
| `listRuns()` | Returns array of past runs grouped by period: `{ period, entryNumber, totalAmount, assetCount, ranAt, runByName, status: 'POSTED' \| 'REVERSED' }`. Source: `JournalEntry where metadata.flow='depreciation'` aggregated by `metadata.period`. |
| `previewRun(period)` | Returns dry-run output for `period`: `{ period, lines: { assetId, assetCode, monthlyDepr, drAccount, crAccount }[], totalAmount, assetCount }`. Iterates active assets (status='POSTED', not fully depreciated, not already run for that period). Does NOT post anything. |
| `runManual(period, userId)` | V15 guard. Iterates all eligible assets and calls `DepreciationTemplate.execute({ assetId, period }, tx)` for each, all inside ONE outer `$transaction` (so partial failures roll back the whole run). Writes AuditLog `DEPRECIATION_RUN_MANUAL`. Idempotent: skips assets where `(assetId, period)` already has a `DepreciationEntry`. |
| `reverseRun(period, reason, userId)` | V15 guard on current date. Calls new `DepreciationReverseTemplate.execute({ period, reversedById }, tx)` which finds all DEPRECIATION JEs for the period and reverses each, plus rolls back `accumulatedDepr` and recomputes `netBookValue` on each affected asset, plus marks each `DepreciationEntry.reversedAt`. Writes AuditLog `DEPRECIATION_RUN_REVERSE`. |

**Schema additions:** Two new fields on `DepreciationEntry` (already exists from Phase A.5c, currently has only `assetId, period, amount, journalEntryNo, createdAt`):

```prisma
model DepreciationEntry {
  // ...existing fields
  reversedAt    DateTime?  @map("reversed_at")     // new
  reversedById  String?    @map("reversed_by_id")  // new
  reversedBy    User?      @relation("DepreciationEntryReversedBy", fields: [reversedById], references: [id])  // new

  @@index([period, reversedAt])  // new compound index for "active runs" queries
}
```

Migration: add nullable columns + index. No data migration needed.

**JE template:** `DepreciationReverseTemplate.execute({ period, reversedById }, tx?)`:
1. Find all `DepreciationEntry where period=$period AND reversedAt IS NULL` — these are the entries to reverse.
2. For each, find the corresponding JE (via `journalEntryNo`).
3. Build mirror lines per JE.
4. Inside outer `$transaction`:
   a. For each entry: post mirror JE via `createAndPost` with `reference: '${asset.id}:reverse-depr-${period}'` and metadata `{ flow: 'depreciation-reverse', period, originalEntryId, reversedAssetId }`.
   b. Flag each original JE `metadata.reversed=true, reversedByEntryNumber: <new>`.
   c. Update each affected `FixedAsset`: `accumulatedDepr = accumulatedDepr - <reverseAmount>`, `netBookValue = purchaseCost - accumulatedDepr` (recomputed).
   d. Update each `DepreciationEntry`: `reversedAt = now`, `reversedById = userId`.
   e. Write one `JournalPostAuditLog` per reversed JE.

**Edge case:** If asset was depreciated in this period AND a later period is also closed, reversing this period leaves the later period's entries dangling (asset's `accumulatedDepr` would be inconsistent with later entries). Solution: refuse reversal if any later `DepreciationEntry` exists with `reversedAt IS NULL`. Error message: `"ไม่สามารถ reverse: มีการ run ค่าเสื่อมงวด <YYYY-MM> หลังจากนี้แล้ว ต้อง reverse งวดถัดไปก่อน"`.

**Controller:** `DepreciationController` at `/depreciation`:

```
GET    /depreciation                 → listRuns
GET    /depreciation/preview/:period → previewRun
POST   /depreciation/run             → runManual (body: { period })
POST   /depreciation/:period/reverse → reverseRun (body: { reason })
```

Roles:
- GET: OWNER, BRANCH_MANAGER, FINANCE_MANAGER, ACCOUNTANT
- POST run: OWNER, FINANCE_MANAGER
- POST reverse: OWNER

### Frontend additions

**`DepreciationPage.tsx`** at `/depreciation`:

```
┌─ Header ─────────────────────────────────────┐
│ "ค่าเสื่อมราคา"                              │
│ Subtitle: cron auto-run 01:00 BKK ทุกสิ้นเดือน│
└──────────────────────────────────────────────┘

┌─ Section 1: รัน Manual ──────────────────────┐
│ Period selector  [Select last 12 months]     │
│ [ดูตัวอย่าง]                                 │
│                                              │
│ ── Preview table (when previewed) ──         │
│ Asset · monthlyDepr · drAccount · crAccount  │
│ Total: XXX.XX (N assets)                     │
│                                              │
│ [รันค่าเสื่อมงวดนี้] (disabled if 0 assets)   │
└──────────────────────────────────────────────┘

┌─ Section 2: ประวัติการรัน ───────────────────┐
│ DataTable:                                   │
│ period · entryNumber · totalAmount ·         │
│ assetCount · ranAt · runBy · status · action │
│                                              │
│ status badge: POSTED / REVERSED              │
│ action: Reverse button (POSTED only)         │
└──────────────────────────────────────────────┘
```

**DepreciationRunDialog** — confirm before run, shows total amount + asset count.

**ReverseDepreciationRunDialog** — confirm with reason ≥ 5 chars. Shows warning if multiple periods would be cascaded.

---

## Section C: Transfer audit list

### Backend additions

**Service method** added to `AssetTransferService`:

```typescript
async listAllTransfers(filters: {
  page?: number;
  limit?: number;
  search?: string;     // matches assetCode/name/serialNo
  assetId?: string;
  custodianContains?: string;
  locationContains?: string;
  branchId?: string;
  fromDate?: string;
  toDate?: string;
}): Promise<{ data: AssetTransferHistoryRow[]; total: number; page: number; limit: number }>
```

Each row includes: `transferId, transferDate, assetId, asset.{ assetCode, name, serialNo }, fromCustodian, toCustodian, fromLocation, toLocation, reason, transferredBy.{ id, name }`. Uses `prisma.assetTransferHistory.findMany` with joined `asset` and `transferredBy`.

**Controller endpoint** added to `AssetController` (kept here for cohesion — `asset-transfer.service.ts` already lives in the asset module):

```
GET /asset-transfers   → listAllTransfers
```

Roles: OWNER, BRANCH_MANAGER, FINANCE_MANAGER, ACCOUNTANT (read-only audit).

### Frontend additions

**`AssetTransfersListPage.tsx`** at `/assets/transfers`:

```
┌─ Header ─────────────────────────────────────┐
│ "ประวัติการโอนสินทรัพย์" (cross-asset audit) │
│ [← กลับสินทรัพย์]                            │
└──────────────────────────────────────────────┘

┌─ Filters ────────────────────────────────────┐
│ search input · date range · custodian ·      │
│ location · branch select                     │
└──────────────────────────────────────────────┘

┌─ DataTable ──────────────────────────────────┐
│ วันที่ · รหัสสินทรัพย์ (link) · ชื่อ ·         │
│ ผู้ดูแล (from→to) · ที่ตั้ง (from→to) ·         │
│ เหตุผล · ผู้บันทึก                            │
│                                              │
│ Pagination 50/page                           │
└──────────────────────────────────────────────┘
```

Link from row → `/assets/:id` (detail page).

Reachable from: AssetDetailPage's transfer history card → "ดูประวัติทั้งหมด" link.

---

## Permissions matrix (Phase 2)

| Endpoint | OWNER | BRANCH_MGR | FINANCE_MGR | ACCOUNTANT | SALES |
|----------|:---:|:---:|:---:|:---:|:---:|
| `POST /assets/:id/dispose` | ✓ | ✗ | ✓ | ✗ | ✗ |
| `POST /assets/:id/reverse-dispose` | ✓ | ✗ | ✗ | ✗ | ✗ |
| `GET /depreciation` | ✓ | ✓ | ✓ | ✓ | ✗ |
| `GET /depreciation/preview/:period` | ✓ | ✓ | ✓ | ✓ | ✗ |
| `POST /depreciation/run` | ✓ | ✗ | ✓ | ✗ | ✗ |
| `POST /depreciation/:period/reverse` | ✓ | ✗ | ✗ | ✗ | ✗ |
| `GET /asset-transfers` | ✓ | ✓ | ✓ | ✓ | ✗ |

---

## Validation rules summary

### Disposal V-rules (server)
- VD1: `disposalType ∈ {'SALE','WRITE_OFF'}`
- VD2: `disposalDate` valid + ≤ today
- VD3: `proceeds > 0` if disposalType='SALE'
- VD4: `depositAccountCode ∈ CASH_ACCOUNT_CODES` if disposalType='SALE'
- VD5: `reason` length ≥ 5
- VD6: asset.status === 'POSTED'
- VD7: V15 — disposalDate falls in open period
- VD8 (reverse): asset.status ∈ {'DISPOSED','WRITTEN_OFF'}
- VD9 (reverse): V15 on current date
- VD10 (reverse): no DepreciationEntry created after disposal

### Depreciation V-rules (server)
- VR1: `period` matches `/^\d{4}-\d{2}$/` and represents a valid year-month
- VR2: `period` ≤ current month (no future runs)
- VR3 (run): V15 — period not closed
- VR4 (run): no `DepreciationEntry` exists for `(any-asset, period)` already with `reversedAt IS NULL` (would be no-op or duplicate)
- VR5 (reverse): no later period has `DepreciationEntry where reversedAt IS NULL`
- VR6 (reverse): V15 on current date

### Transfer list (no validation — read only)

---

## Audit log convention

All Phase 2 service methods write `AuditLog` rows with:

- `entity`: `'fixed_asset'` (or `'depreciation_run'` for cross-asset cases — to be decided in implementation; use `'depreciation_run'` with `entityId = period` so audit trail can be queried per period)
- `action`: one of `'ASSET_DISPOSE'`, `'ASSET_DISPOSE_BLOCKED'`, `'ASSET_REVERSE_DISPOSE'`, `'ASSET_REVERSE_DISPOSE_BLOCKED'`, `'DEPRECIATION_RUN_MANUAL'`, `'DEPRECIATION_RUN_MANUAL_BLOCKED'`, `'DEPRECIATION_RUN_REVERSE'`, `'DEPRECIATION_RUN_REVERSE_BLOCKED'`
- `userId`: real UUID FK
- `oldValue`: pre-state object (e.g., `{ status: 'POSTED', netBookValue: 30000 }`)
- `newValue`: post-state + metadata (e.g., `{ status: 'DISPOSED', disposalType: 'SALE', proceeds: 25000, gainLoss: -5000, journalEntryNumber: 'JE-202605-00007' }`)

The `_BLOCKED` actions are written when V15 (or other guard) rejects an operation, before throwing — provides forensic audit of attempted ops in closed periods.

---

## Testing strategy

### Unit tests (jest, real DB)

- `asset.service.spec.ts` extensions (~12 new cases)
  - dispose (SALE) gain case → JE includes 42-1105 line, asset.status='DISPOSED', netBookValue=0
  - dispose (SALE) loss case → JE includes 53-1605 line
  - dispose (WRITE_OFF) → JE includes 53-1605, no proceeds line
  - dispose rejects status≠POSTED
  - dispose rejects future date
  - dispose V15 closed period → ASSET_DISPOSE_BLOCKED audit + throw
  - reverseDispose restores asset to POSTED, clears disposalDate
  - reverseDispose rejects status≠DISPOSED/WRITTEN_OFF
  - reverseDispose rejects if depreciation entry exists after disposal
  - reverseDispose V15 on current date
  - dispose idempotency (second call returns same JE)
  - dispose AuditLog ASSET_DISPOSE captures gain/loss

- `asset-disposal-reverse.template.spec.ts` (~8 cases) mirroring asset-purchase-reverse pattern

- `depreciation.service.spec.ts` (~16 cases)
  - listRuns aggregates correctly
  - previewRun returns lines for active assets only
  - previewRun excludes already-run period
  - previewRun excludes fully-depreciated assets
  - runManual posts JE per asset, all in one tx
  - runManual idempotent (second call no-op)
  - runManual rolls back partial failure
  - runManual V15 closed → blocked + audit
  - reverseRun reverses all entries in period
  - reverseRun rolls back accumulatedDepr correctly
  - reverseRun recomputes netBookValue
  - reverseRun rejects if later period has unreversed entries
  - reverseRun V15 closed → blocked
  - reverseRun marks DepreciationEntry.reversedAt
  - reverseRun AuditLog DEPRECIATION_RUN_REVERSE
  - reverseRun cascades to all affected assets

- `depreciation-reverse.template.spec.ts` (~8 cases)

- `asset-transfer.service.spec.ts` extensions (~6 new cases)
  - listAllTransfers paginates
  - listAllTransfers filters by date range
  - listAllTransfers filters by custodian (case-insensitive)
  - listAllTransfers filters by branch
  - listAllTransfers search matches assetCode/name/serial
  - listAllTransfers includes joined asset + transferredBy

### E2E tests (Playwright, smoke)

- `assets-dispose.spec.ts` — dispose POSTED asset (SALE) → verify status=DISPOSED + JE created
- `assets-write-off.spec.ts` — write-off POSTED asset → verify status=WRITTEN_OFF + loss JE
- `depreciation-manual.spec.ts` — preview + run depreciation for current month → verify run appears in history list
- `transfers-list.spec.ts` — navigate to /assets/transfers → verify filters work

### Acceptance

- TypeScript: 0 errors
- jest: all green (target ~70 new test cases bringing total asset-module tests to ~110)
- vitest CPA templates: 4 templates × 8 tests = ~32 + existing = all green
- Manual smoke: dispose → reverse → verify NBV restored correctly

---

## Migration plan

Schema changes:
- Add 2 nullable columns + 1 index on `depreciation_entries`
- No new tables, no destructive ops
- Migration name: `2026_05_09_depreciation_reverse_tracking`

Production deployment: standard `prisma migrate deploy` — no wipe needed.

---

## Verification (key design assumptions cross-checked against actual code)

| # | Assumption | Verdict |
|---|------------|---------|
| 1 | `AssetDisposalTemplate` already accepts `outerTx?` | ✅ Phase 1 fixes added this |
| 2 | `DepreciationTemplate` already accepts `tx?` | ✅ Phase 1 fixes added this |
| 3 | `DepreciationCron` runs at 28-31 01:00 BKK | ✅ verified `depreciation.cron.ts:25` |
| 4 | `DepreciationEntry` model exists with idempotency unique key | ✅ verified schema:3156 |
| 5 | `42-1105 กำไรจากการจำหน่ายสินทรัพย์` in FINANCE chart | ✅ verified Phase 1 fix |
| 6 | `validatePeriodOpen` works cross-module | ✅ verified |
| 7 | `AuditLog` has oldValue/newValue Json fields | ✅ verified |
| 8 | `JournalEntry.metadata` JSON path queries (`metadata.flow`, `metadata.assetId`) work | ✅ verified existing pattern |
| 9 | `createAndPost` accepts `tx?` | ✅ verified |
| 10 | Sidebar nav config supports adding new entries | ✅ Phase 1 added "สินทรัพย์" successfully |

---

## Out of Scope (explicit)

- Bulk disposal/transfer
- CSV export (deferred Phase 3)
- PDF certificates
- Photo upload
- PEAK sync
- Cron schedule changes
- Asset Register page (Phase 3)
- NBV Schedule page (Phase 3)
- Movement Summary report (Phase 3)
- Per-asset audit timeline page (Phase 3 — Phase 1 has audit endpoint, Phase 3 builds full UI)

---

## Open Questions

None — all design decisions resolved during brainstorming. Ready for `/writing-plans` to produce implementation plan.
