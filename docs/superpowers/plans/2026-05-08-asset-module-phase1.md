# Asset Module Phase 1 — Foundation & Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the minimal `FixedAsset` schema with a richer entry workflow (DRAFT → POSTED → REVERSED), capture VAT/WHT/vendor/custodian data, post Auto Journals via 2 new templates, plus 4 frontend routes. FINANCE-only scope; SHOP deferred.

**Architecture:** Replace `apps/api/src/modules/asset/` (existing minimal CRUD) with full lifecycle management. Add 2 new JE templates that follow BESTCHOICE conventions (`createAndPost` with `referenceType='AUTO'`, T2-C14 audit log inside `$transaction`, account snapshots pinned at POST). Add `AssetTransferHistory` for custodian/location moves. Wire 12 endpoints. Frontend: lazy-loaded list / new / edit / detail pages with react-hook-form + zod, 5-section entry form, live JE preview.

**Tech Stack:** NestJS 10, Prisma 5, PostgreSQL, vitest, jest (templates use vitest, services use jest — match existing `__tests__/` patterns); React 18 + Vite 6, react-hook-form, zod, @tanstack/react-query, shadcn/ui, sonner, Playwright.

**Spec:** `docs/superpowers/specs/2026-05-08-asset-module-phase1-design.md`

---

## File Structure

### Backend — REPLACE existing module

| Path | Action | Responsibility |
|------|--------|---------------|
| `apps/api/prisma/schema.prisma` | Modify | Replace `FixedAsset` model + `AssetCategory`/`AssetStatus` enums; add `AssetTransferHistory` |
| `apps/api/prisma/migrations/<timestamp>_asset_phase1/migration.sql` | Create | Drop legacy columns, add new columns, rename enum values |
| `apps/api/src/cli/wipe-assets.cli.ts` | Create | Wipe `asset_transfer_history`, `depreciation_entries`, `fixed_assets` (4-guard pattern) |
| `apps/api/package.json` | Modify | Add `wipe:assets` script |
| `apps/api/src/modules/journal/cpa-templates/depreciation.template.ts` | Modify | Update `CATEGORY_ACCOUNT_MAP` keys + Thai labels for renamed enum |
| `apps/api/src/modules/journal/cpa-templates/depreciation.template.spec.ts` | Modify | Update test fixtures with new enum names |
| `apps/api/src/modules/journal/cpa-templates/asset-disposal.template.ts` | Modify | Update `CATEGORY_ASSET_CODE_MAP` keys |
| `apps/api/src/modules/journal/cpa-templates/asset-disposal.template.spec.ts` | Modify | Update test fixtures |
| `apps/api/src/modules/journal/cron/depreciation.cron.ts` | Modify | Field rename: `assetCategory` → `category`, `costValue` → `purchaseCost` |
| `apps/api/src/modules/asset/dto/asset.dto.ts` | Replace | Replace with 6 new DTOs |
| `apps/api/src/modules/asset/asset.controller.ts` | Replace | Wire 12 endpoints with role guards |
| `apps/api/src/modules/asset/asset.service.ts` | Replace | DRAFT/POST/REVERSE/copy/list/detail/audit/summary/generateCode |
| `apps/api/src/modules/asset/asset-transfer.service.ts` | Create | Custodian/location transfer + history |
| `apps/api/src/modules/asset/asset.module.ts` | Modify | Wire new services + JournalModule import |
| `apps/api/src/modules/asset/__tests__/asset.service.spec.ts` | Create | 33 unit cases |
| `apps/api/src/modules/asset/__tests__/asset-transfer.service.spec.ts` | Create | 10 unit cases |
| `apps/api/src/modules/journal/cpa-templates/asset-purchase.template.ts` | Create | Purchase JE — 4 categories + VAT inclusive/exclusive + WHT |
| `apps/api/src/modules/journal/cpa-templates/asset-purchase.template.spec.ts` | Create | 12 cases (vitest) |
| `apps/api/src/modules/journal/cpa-templates/asset-purchase-reverse.template.ts` | Create | Mirror JE + flag original metadata.reversed |
| `apps/api/src/modules/journal/cpa-templates/asset-purchase-reverse.template.spec.ts` | Create | 8 cases (vitest) |
| `apps/api/src/modules/journal/journal.module.ts` | Modify | Register 2 new templates as providers + exports |

### Frontend

| Path | Action | Responsibility |
|------|--------|---------------|
| `apps/web/src/pages/assets/types.ts` | Create | `Asset`, `AssetTransferHistory`, `AssetSummary`, `AssetCategory`, `AssetStatus` |
| `apps/web/src/pages/assets/api.ts` | Create | API wrappers for 12 endpoints |
| `apps/web/src/pages/assets/schema.ts` | Create | Zod schema for entry form (V1-V14) |
| `apps/web/src/pages/assets/hooks/useAssetCalculation.ts` | Create | Memoized derived values (VAT/WHT/totals/JE preview lines) |
| `apps/web/src/pages/assets/components/AssetStatusBadge.tsx` | Create | Status chip — uses statusBadges helper |
| `apps/web/src/pages/assets/components/AssetEntrySection1Info.tsx` | Create | Section 1 (asset info + custodian) |
| `apps/web/src/pages/assets/components/AssetEntrySection2Cost.tsx` | Create | Section 2 (cost breakdown + VAT/WHT live calc) |
| `apps/web/src/pages/assets/components/AssetEntrySection3Vendor.tsx` | Create | Section 3 (vendor + payment) |
| `apps/web/src/pages/assets/components/AssetEntrySection4Journal.tsx` | Create | Section 4 (auto JE preview + override) |
| `apps/web/src/pages/assets/components/AssetEntrySection5Approver.tsx` | Create | Section 5 (approver + note + SoD warning) |
| `apps/web/src/pages/assets/components/ReverseAssetDialog.tsx` | Create | Reverse confirm dialog with reason |
| `apps/web/src/pages/assets/components/TransferAssetDialog.tsx` | Create | Custodian/location transfer dialog |
| `apps/web/src/pages/assets/AssetsListPage.tsx` | Create | List + filter + 7 stat cards |
| `apps/web/src/pages/assets/AssetEntryPage.tsx` | Create | Form glue (create + edit modes) |
| `apps/web/src/pages/assets/AssetDetailPage.tsx` | Create | Read-only + actions |
| `apps/web/src/lib/status-badges.ts` | Modify | Add `assetStatusMap` |
| `apps/web/src/App.tsx` | Modify | Add 4 lazy routes |
| `apps/web/src/components/MainLayout.tsx` (or equivalent nav) | Modify | Add nav item "สินทรัพย์" |
| `apps/web/e2e/assets-create-post.spec.ts` | Create | E2E: form fill → save → post → verify |
| `apps/web/e2e/assets-reverse.spec.ts` | Create | E2E: existing POSTED → reverse → verify |

---

## Task List Overview

**Backend (10 tasks):**
1. Schema migration + dependent template fixes (so codebase compiles)
2. Wipe CLI for assets
3. New DTOs (6 files)
4. AssetPurchaseTemplate + tests
5. AssetPurchaseReverseTemplate + tests
6. AssetService — CRUD + helpers (createDraft, update, delete, findAll, findOne, generateCode, summary, audit)
7. AssetService — post + reverse
8. AssetService — copy
9. AssetTransferService
10. AssetController + AssetModule wiring + smoke

**Frontend (8 tasks):**
11. Frontend foundation (types, API, zod, hook, status badge)
12. AssetsListPage
13. AssetEntryPage — Section components 1-3
14. AssetEntryPage — Section components 4-5
15. AssetEntryPage — form glue
16. AssetDetailPage + ReverseAssetDialog + TransferAssetDialog
17. Routes + Nav + smoke render
18. E2E tests + final verification

---

## Task 1: Schema migration + dependent template fixes

**Files:**
- Modify: `apps/api/prisma/schema.prisma:3019-3095` (FixedAsset block + enums)
- Create: `apps/api/prisma/migrations/<timestamp>_asset_phase1/migration.sql`
- Modify: `apps/api/src/modules/journal/cpa-templates/depreciation.template.ts:7-19, 86-92`
- Modify: `apps/api/src/modules/journal/cpa-templates/depreciation.template.spec.ts` (search/replace enum values)
- Modify: `apps/api/src/modules/journal/cpa-templates/asset-disposal.template.ts:7-12`
- Modify: `apps/api/src/modules/journal/cpa-templates/asset-disposal.template.spec.ts`
- Modify: `apps/api/src/modules/journal/cron/depreciation.cron.ts:39+` (field references)
- Modify: `apps/api/src/modules/asset/dto/asset.dto.ts` (delete contents — Task 3 will rewrite)
- Modify: `apps/api/src/modules/asset/asset.service.ts` (stub out — Task 6/7 will rewrite)
- Modify: `apps/api/src/modules/asset/asset.controller.ts` (stub out — Task 10 will rewrite)

- [ ] **Step 1.1: Update Prisma schema** — replace `FixedAsset` model and enums

Open `apps/api/prisma/schema.prisma`. Find the `enum AssetStatus` block (around line 3019). Replace lines 3019-3095 with the spec's schema (see `docs/superpowers/specs/2026-05-08-asset-module-phase1-design.md` Schema section). Add `AssetTransferHistory` model immediately after `FixedAsset`.

Critical changes from existing schema:
- `enum AssetCategory`: rename values to `EQUIPMENT`, `IMPROVEMENT`, `FURNITURE`, `VEHICLE` (drop the `OFFICE_` and `BUILDING_` prefixes)
- `enum AssetStatus`: keep all 5 values (`ACTIVE` was used; replace with `DRAFT`, `POSTED`, `REVERSED`, `DISPOSED`, `WRITTEN_OFF`). Note: `FULLY_DEPRECIATED` from existing schema is dropped — Phase 2 will track via separate flag or computed
- `FixedAsset`: drop `costValue`, `salvageValue`, `usefulLife`, `assetCategory` (the optional one), `lastDepreciationPeriod`, `disposalProceeds`, `disposalNote`, `depreciationAccountCode`, `accumulatedAccountCode`. Add new fields per spec
- Add `AssetTransferHistory` model with self-relation back to `FixedAsset`

Also add three new User relations:
```prisma
// In User model, add:
assetsCreated         FixedAsset[]            @relation("AssetCreatedBy")
assetsApproved        FixedAsset[]            @relation("AssetApprover")
assetsPosted          FixedAsset[]            @relation("AssetPostedBy")
assetsReversed        FixedAsset[]            @relation("AssetReversedBy")
assetsTransferred     AssetTransferHistory[]  @relation("AssetTransferredBy")
```

Locate the existing `User` model (search `model User {`) and add these inside the relations block.

- [ ] **Step 1.2: Generate Prisma migration**

Run:
```bash
cd apps/api && npx prisma migrate dev --name asset_phase1 --create-only
```

This creates the migration SQL but does NOT apply it. Open the new migration file (`apps/api/prisma/migrations/<timestamp>_asset_phase1/migration.sql`) and verify it contains:
- `ALTER TYPE "AssetCategory" RENAME VALUE 'OFFICE_EQUIPMENT' TO 'EQUIPMENT'` (and 3 similar for the other values)
- `ALTER TYPE "AssetStatus" ADD VALUE 'DRAFT'` (and similar for new values), then drop unused
- `ALTER TABLE "fixed_assets" DROP COLUMN ...` × 9 (cost_value, salvage_value, useful_life, asset_category, last_depreciation_period, disposal_proceeds, disposal_note, depreciation_account_code, accumulated_account_code)
- `ALTER TABLE "fixed_assets" ADD COLUMN ...` × ~25 (per spec schema)
- `CREATE TABLE "asset_transfer_history" (...)`
- Indexes per spec

If the auto-generated SQL has issues (e.g., enum value renames not supported in older Postgres), edit the SQL by hand. PostgreSQL 13+ supports `ALTER TYPE ... RENAME VALUE`.

- [ ] **Step 1.3: Verify migration is valid SQL**

```bash
cd apps/api && npx prisma migrate diff \
  --from-empty --to-schema-datamodel prisma/schema.prisma \
  --script > /tmp/full-schema.sql
echo "Migration SQL written. Review /tmp/full-schema.sql for asset_transfer_history + fixed_assets columns"
```

Confirm `fixed_assets` and `asset_transfer_history` appear with the expected columns.

- [ ] **Step 1.4: Apply migration locally (dev DB)**

```bash
cd apps/api && npx prisma migrate dev
```

Expected: applies the migration and regenerates Prisma Client. If it fails because existing `fixed_assets` rows can't NULL-fill new NOT NULL columns, drop the dev table first:
```bash
cd apps/api && npx prisma db execute --stdin <<< "TRUNCATE fixed_assets, depreciation_entries CASCADE;"
cd apps/api && npx prisma migrate dev
```

- [ ] **Step 1.5: Fix `depreciation.template.ts` for renamed enum**

Edit `apps/api/src/modules/journal/cpa-templates/depreciation.template.ts:7-19`:

```typescript
const CATEGORY_ACCOUNT_MAP: Record<string, [string, string]> = {
  EQUIPMENT: ['53-1601', '12-2102'],
  IMPROVEMENT: ['53-1602', '12-2104'],
  FURNITURE: ['53-1603', '12-2106'],
  VEHICLE: ['53-1604', '12-2108'],
};

const CATEGORY_LABEL: Record<string, string> = {
  EQUIPMENT: 'อุปกรณ์สำนักงาน',
  IMPROVEMENT: 'ส่วนปรับปรุงอาคาร',
  FURNITURE: 'เครื่องตกแต่งสำนักงาน',
  VEHICLE: 'ยานพาหนะ',
};
```

Then fix the field reads (lines 86-100). The fields `asset.assetCategory`, `asset.costValue`, `asset.salvageValue`, `asset.depreciationAccountCode`, `asset.accumulatedAccountCode`, `asset.accumulatedDepre` no longer exist. Replace with:

```typescript
// Resolve account codes via category enum (asset.category is now non-optional)
const [drCode, crCode] = CATEGORY_ACCOUNT_MAP[asset.category];

// Use new field names
const purchaseCost = new Decimal(asset.purchaseCost.toString());
const residualValue = new Decimal(asset.residualValue.toString());
const accumulatedDepr = new Decimal(asset.accumulatedDepr.toString());
const depreciableBase = purchaseCost.minus(residualValue);
const remainingBase = depreciableBase.minus(accumulatedDepr);
```

Also: the existing template has a guard `if (asset.status !== 'ACTIVE')`. Update to `if (asset.status !== 'POSTED')` — POSTED is the new "active" status.

Read the full template file once and update all references holistically. Don't trust line numbers blindly — search for `assetCategory`, `costValue`, `salvageValue`, `depreciationAccountCode`, `accumulatedAccountCode`, `accumulatedDepre` and update each occurrence.

- [ ] **Step 1.6: Fix `depreciation.template.spec.ts` for new enum names**

Open `apps/api/src/modules/journal/cpa-templates/depreciation.template.spec.ts`. Search/replace:
- `OFFICE_EQUIPMENT` → `EQUIPMENT`
- `BUILDING_IMPROVEMENT` → `IMPROVEMENT`
- `OFFICE_FURNITURE` → `FURNITURE`
- (`VEHICLE` unchanged)

Also rename field references:
- `costValue:` → `purchaseCost:` (in test fixtures creating FixedAsset)
- `salvageValue:` → `residualValue:`
- `usefulLife:` (years) → `usefulLifeMonths:` (multiply existing values by 12 to preserve test semantics)
- `assetCategory:` → `category:`
- Drop fixture references to: `depreciationAccountCode`, `accumulatedAccountCode`, `lastDepreciationPeriod`, `disposalProceeds`, `disposalNote`
- Asset status: replace `'ACTIVE'` literal with `'POSTED'`
- Add to fixture: `basePrice`, `monthlyDepr`, `netBookValue`, `docNo`, `createdById` (use a test user ID), `purchaseDate`, `coaCostAccount`/`coaDeprAccount`/`coaExpenseAccount` (set to expected codes per category)

- [ ] **Step 1.7: Fix `asset-disposal.template.ts` for new enum**

Edit `apps/api/src/modules/journal/cpa-templates/asset-disposal.template.ts:7-12`:

```typescript
const CATEGORY_ASSET_CODE_MAP: Record<string, [string, string]> = {
  EQUIPMENT: ['12-2101', '12-2102'],
  IMPROVEMENT: ['12-2103', '12-2104'],
  FURNITURE: ['12-2105', '12-2106'],
  VEHICLE: ['12-2107', '12-2108'],
};
```

Update field references the same way as Task 1.5. Read the full file and update all `asset.assetCategory`, `asset.costValue`, `asset.accumulatedDepre` references to the new field names.

- [ ] **Step 1.8: Fix `asset-disposal.template.spec.ts`**

Same search/replace as Task 1.6.

- [ ] **Step 1.9: Fix `depreciation.cron.ts`**

Open `apps/api/src/modules/journal/cron/depreciation.cron.ts`. The cron currently filters by `status: 'ACTIVE'`. Update to `status: 'POSTED'`. Also update any field references from `costValue` etc.

- [ ] **Step 1.10: Stub out the asset module to unblock typecheck**

Replace `apps/api/src/modules/asset/dto/asset.dto.ts` with:
```typescript
// Phase 1 stub — will be replaced in Task 3
export class CreateFixedAssetDto {}
export class UpdateFixedAssetDto {}
export class DisposeAssetDto {}
```

Replace `apps/api/src/modules/asset/asset.service.ts` with:
```typescript
import { Injectable } from '@nestjs/common';

@Injectable()
export class AssetService {
  // Phase 1 stub — will be replaced in Tasks 6-8
  findAll(_args: unknown) { throw new Error('AssetService.findAll: not implemented (Phase 1 in progress)'); }
  findOne(_id: string) { throw new Error('not implemented'); }
  create(_dto: unknown, _userId: string) { throw new Error('not implemented'); }
  update(_id: string, _dto: unknown) { throw new Error('not implemented'); }
  dispose(_id: string, _dto: unknown) { throw new Error('not implemented'); }
  runMonthEndDepreciation(_period: string | undefined, _userId: string) { throw new Error('not implemented'); }
  generateAssetCode() { throw new Error('not implemented'); }
  getDepreciationSummary() { throw new Error('not implemented'); }
}
```

Leave `asset.controller.ts` and `asset.module.ts` untouched (they reference the stubbed service which still satisfies the type system).

- [ ] **Step 1.11: Verify TypeScript compiles**

```bash
./tools/check-types.sh api
```

Expected: 0 errors. If failures point at any remaining `OFFICE_EQUIPMENT`/`costValue`/etc., grep them and fix.

- [ ] **Step 1.12: Run existing journal tests to confirm enum migration didn't break logic**

```bash
cd apps/api && npx vitest run journal/cpa-templates/depreciation.template
cd apps/api && npx vitest run journal/cpa-templates/asset-disposal.template
```

Expected: all green. The renames are mechanical so behavior should be unchanged.

- [ ] **Step 1.13: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/ \
        apps/api/src/modules/journal/cpa-templates/depreciation.template.ts \
        apps/api/src/modules/journal/cpa-templates/depreciation.template.spec.ts \
        apps/api/src/modules/journal/cpa-templates/asset-disposal.template.ts \
        apps/api/src/modules/journal/cpa-templates/asset-disposal.template.spec.ts \
        apps/api/src/modules/journal/cron/depreciation.cron.ts \
        apps/api/src/modules/asset/dto/asset.dto.ts \
        apps/api/src/modules/asset/asset.service.ts
git commit -m "feat(asset): schema migration to Phase 1 + dependent template fixes

Replace FixedAsset schema with Phase 1 design (DRAFT workflow, VAT/WHT,
vendor, custodian fields). Rename AssetCategory enum (drop OFFICE_/BUILDING_
prefixes). Add AssetTransferHistory model. Update depreciation.template +
asset-disposal.template + cron + their tests for renamed enum and new
field names. AssetService stubbed to unblock typecheck — will be filled in
Tasks 6-8."
```

---

## Task 2: Wipe CLI for assets

**Files:**
- Create: `apps/api/src/cli/wipe-assets.cli.ts`
- Modify: `apps/api/package.json`

- [ ] **Step 2.1: Create the wipe CLI**

Create `apps/api/src/cli/wipe-assets.cli.ts` mirroring the Phase A.4 pattern (see `apps/api/src/cli/wipe-accounting.cli.ts` for reference). Content:

```typescript
/**
 * Wipe CLI — Asset Module Phase 1 production migration helper.
 *
 * DESTRUCTIVE: Truncates asset_transfer_history, depreciation_entries, fixed_assets.
 *
 * Required env vars (mirroring wipe-accounting.cli.ts):
 *   CONFIRM_WIPE=YES_I_AM_SURE
 *   EXPECTED_DB_NAME=<must-match-current_database()>
 *   ALLOW_PROD_WIPE=YES_I_AM_SURE   (only when NODE_ENV=production)
 *
 * Run: CONFIRM_WIPE=YES_I_AM_SURE EXPECTED_DB_NAME=bestchoice_dev \
 *      npm --prefix apps/api run wipe:assets
 */
import { PrismaClient } from '@prisma/client';

const REQUIRED_CONSENT = 'YES_I_AM_SURE';

async function main(): Promise<void> {
  if (process.env.CONFIRM_WIPE !== REQUIRED_CONSENT) {
    console.error(`ERROR: Refusing to run without CONFIRM_WIPE=${REQUIRED_CONSENT}`);
    console.error('');
    console.error('This script TRUNCATEs the following tables:');
    console.error('  - asset_transfer_history');
    console.error('  - depreciation_entries');
    console.error('  - fixed_assets');
    console.error('');
    console.error('All asset records, depreciation entries, and transfer history will be permanently deleted.');
    console.error(`Re-run with: CONFIRM_WIPE=${REQUIRED_CONSENT} EXPECTED_DB_NAME=<db> npm --prefix apps/api run wipe:assets`);
    console.error(`Production: also add ALLOW_PROD_WIPE=${REQUIRED_CONSENT}`);
    process.exit(1);
  }

  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_PROD_WIPE !== REQUIRED_CONSENT) {
    console.error('ERROR: Refusing to wipe in NODE_ENV=production without ALLOW_PROD_WIPE=YES_I_AM_SURE');
    process.exit(1);
  }

  const expectedDb = process.env.EXPECTED_DB_NAME;
  if (!expectedDb) {
    console.error('ERROR: Refusing to run without EXPECTED_DB_NAME=<exact-db-name>');
    process.exit(1);
  }

  const prisma = new PrismaClient();

  const [{ current_database: actualDb }] = await prisma.$queryRaw<{ current_database: string }[]>`SELECT current_database()`;
  if (actualDb !== expectedDb) {
    console.error(`ERROR: DB mismatch: connected to "${actualDb}" but EXPECTED_DB_NAME="${expectedDb}". Aborting.`);
    await prisma.$disconnect();
    process.exit(1);
  }

  console.error(`WARNING: About to TRUNCATE asset_transfer_history, depreciation_entries, fixed_assets on database "${actualDb}".`);
  console.error('Press Ctrl+C within 5 seconds to abort.');
  await new Promise((r) => setTimeout(r, 5000));

  try {
    console.log('[wipe-assets] Starting Phase 1 wipe...');
    await prisma.$executeRawUnsafe('TRUNCATE TABLE asset_transfer_history CASCADE');
    await prisma.$executeRawUnsafe('TRUNCATE TABLE depreciation_entries CASCADE');
    await prisma.$executeRawUnsafe('TRUNCATE TABLE fixed_assets CASCADE');
    console.log('[wipe-assets] Done. 3 tables truncated.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('[wipe-assets] FAILED:', err);
  process.exit(1);
});
```

- [ ] **Step 2.2: Add npm script**

Open `apps/api/package.json`. Find the `"scripts"` block. Add (alongside existing `wipe:accounting`):

```json
"wipe:assets": "tsx src/cli/wipe-assets.cli.ts",
```

- [ ] **Step 2.3: Smoke-test the CLI guard**

Without env vars set, the CLI should exit 1 with the consent message:

```bash
cd apps/api && npm run wipe:assets
```

Expected: exit code 1, message `ERROR: Refusing to run without CONFIRM_WIPE=YES_I_AM_SURE`.

- [ ] **Step 2.4: Smoke-test on dev DB**

Find your dev DB name:
```bash
cd apps/api && npx prisma db execute --stdin <<< "SELECT current_database();" 2>&1 | tail -1
```

Run the wipe (assume dev DB name is `bestchoice_dev`):
```bash
cd apps/api && CONFIRM_WIPE=YES_I_AM_SURE EXPECTED_DB_NAME=bestchoice_dev npm run wipe:assets
```

Wait 5 seconds, then expect `Done. 3 tables truncated.` Verify with:
```bash
cd apps/api && npx prisma db execute --stdin <<< "SELECT COUNT(*) FROM fixed_assets;"
```

Expected: 0 rows.

- [ ] **Step 2.5: Commit**

```bash
git add apps/api/src/cli/wipe-assets.cli.ts apps/api/package.json
git commit -m "feat(asset): wipe-assets CLI for Phase 1 prod migration

Mirrors Phase A.4 wipe-accounting pattern (4 guards: CONFIRM_WIPE,
EXPECTED_DB_NAME, ALLOW_PROD_WIPE in prod, 5s cooldown). Truncates
asset_transfer_history, depreciation_entries, fixed_assets. Intended
to run as one-shot Cloud Run Job after Phase 1 deploys."
```

---

## Task 3: New DTOs

**Files:**
- Replace: `apps/api/src/modules/asset/dto/asset.dto.ts` (delete contents)
- Create: `apps/api/src/modules/asset/dto/create-asset.dto.ts`
- Create: `apps/api/src/modules/asset/dto/update-asset.dto.ts`
- Create: `apps/api/src/modules/asset/dto/post-asset.dto.ts`
- Create: `apps/api/src/modules/asset/dto/reverse-asset.dto.ts`
- Create: `apps/api/src/modules/asset/dto/transfer-asset.dto.ts`
- Create: `apps/api/src/modules/asset/dto/copy-asset.dto.ts`

- [ ] **Step 3.1: Delete the stub `asset.dto.ts`**

```bash
rm apps/api/src/modules/asset/dto/asset.dto.ts
```

- [ ] **Step 3.2: Create `create-asset.dto.ts`**

```typescript
import {
  IsString, IsOptional, IsNumber, IsEnum, IsDateString, IsBoolean,
  IsIn, IsNotEmpty, IsInt, Min, Max,
} from 'class-validator';
import { AssetCategory, PaymentMethod } from '@prisma/client';

export class CreateAssetDto {
  @IsString({ message: 'กรุณาระบุชื่อสินทรัพย์' })
  @IsNotEmpty({ message: 'กรุณาระบุชื่อสินทรัพย์' })
  name: string;

  @IsOptional() @IsString()
  description?: string;

  @IsEnum(AssetCategory, { message: 'หมวดหมู่สินทรัพย์ไม่ถูกต้อง' })
  category: AssetCategory;

  @IsOptional() @IsString()
  branchId?: string;

  @IsNumber({}, { message: 'ราคาต้องเป็นตัวเลข' })
  @Min(0.01, { message: 'ราคาต้องมากกว่า 0' })
  basePrice: number;

  @IsOptional() @IsNumber() @Min(0)
  shippingCost?: number;

  @IsOptional() @IsNumber() @Min(0)
  installationCost?: number;

  @IsOptional() @IsNumber() @Min(0)
  otherCapitalized?: number;

  @IsOptional() @IsBoolean()
  hasVat?: boolean;

  @IsOptional() @IsBoolean()
  vatInclusive?: boolean;

  @IsOptional() @IsString() @IsIn(['11-4101', '11-4102'], { message: 'รหัสบัญชี VAT ไม่ถูกต้อง' })
  vatAccount?: string;

  @IsOptional() @IsBoolean()
  hasWht?: boolean;

  @IsOptional() @IsNumber() @Min(0)
  whtBaseAmount?: number;

  @IsOptional() @IsNumber() @Min(0) @Max(0.05, { message: 'อัตรา WHT ต้องไม่เกิน 5%' })
  whtRate?: number;

  @IsOptional() @IsString() @IsIn(['21-3102', '21-3103'], { message: 'รหัสบัญชี WHT ไม่ถูกต้อง' })
  whtAccount?: string;

  @IsOptional() @IsIn(['PND3', 'PND53'], { message: 'แบบ ภ.ง.ด. ไม่ถูกต้อง' })
  whtFormType?: string;

  @IsOptional() @IsNumber() @Min(0)
  residualValue?: number;

  @IsInt({ message: 'อายุการใช้งานต้องเป็นจำนวนเต็ม' })
  @Min(1, { message: 'อายุการใช้งานต้องมากกว่า 0 เดือน' })
  usefulLifeMonths: number;

  @IsDateString({}, { message: 'วันที่ซื้อไม่ถูกต้อง' })
  purchaseDate: string;

  @IsOptional() @IsDateString()
  invoiceDate?: string;

  @IsOptional() @IsDateString()
  warrantyExpire?: string;

  @IsOptional() @IsString()
  supplierName?: string;

  @IsOptional() @IsString()
  supplierTaxId?: string;

  @IsOptional() @IsString()
  invoiceNo?: string;

  @IsOptional() @IsString()
  taxInvoiceNo?: string;

  @IsOptional() @IsEnum(PaymentMethod)
  paymentMethod?: PaymentMethod;

  @IsOptional() @IsString()
  paymentAccount?: string;

  @IsOptional() @IsString()
  custodian?: string;

  @IsOptional() @IsString()
  location?: string;

  @IsOptional() @IsString()
  serialNo?: string;

  @IsOptional() @IsString()
  prRef?: string;

  @IsOptional() @IsString()
  note?: string;

  @IsOptional() @IsString()
  approverId?: string;
}
```

- [ ] **Step 3.3: Create `update-asset.dto.ts`**

```typescript
import { PartialType } from '@nestjs/swagger';
import { CreateAssetDto } from './create-asset.dto';

export class UpdateAssetDto extends PartialType(CreateAssetDto) {}
```

- [ ] **Step 3.4: Create `post-asset.dto.ts`**

```typescript
// Empty body — POST /assets/:id/post takes no payload, just authenticates the requestor
export class PostAssetDto {}
```

- [ ] **Step 3.5: Create `reverse-asset.dto.ts`**

```typescript
import { IsString, IsNotEmpty, MinLength } from 'class-validator';

export class ReverseAssetDto {
  @IsString()
  @IsNotEmpty({ message: 'กรุณาระบุเหตุผลการกลับรายการ' })
  @MinLength(5, { message: 'เหตุผลต้องมีอย่างน้อย 5 ตัวอักษร' })
  reason: string;
}
```

- [ ] **Step 3.6: Create `transfer-asset.dto.ts`**

```typescript
import { IsString, IsOptional, IsDateString, IsNotEmpty, MinLength } from 'class-validator';

export class TransferAssetDto {
  @IsDateString({}, { message: 'วันที่โอนไม่ถูกต้อง' })
  transferDate: string;

  @IsOptional() @IsString()
  toCustodian?: string;

  @IsOptional() @IsString()
  toLocation?: string;

  @IsString()
  @IsNotEmpty({ message: 'กรุณาระบุเหตุผลการโอน' })
  @MinLength(5)
  reason: string;
}
```

- [ ] **Step 3.7: Create `copy-asset.dto.ts`**

```typescript
// Empty body — copies all relevant fields from source asset
export class CopyAssetDto {}
```

- [ ] **Step 3.8: Verify typecheck**

```bash
./tools/check-types.sh api
```

Expected: still passes (DTOs aren't wired into anything yet — they'll be wired in Task 10).

- [ ] **Step 3.9: Commit**

```bash
git add apps/api/src/modules/asset/dto/
git commit -m "feat(asset): 6 new DTOs for Phase 1 endpoints

CreateAssetDto, UpdateAssetDto, PostAssetDto, ReverseAssetDto,
TransferAssetDto, CopyAssetDto. class-validator with Thai messages,
constraints per spec V1-V14 (server-side checks)."
```

---

## Task 4: AssetPurchaseTemplate + tests

**Files:**
- Create: `apps/api/src/modules/journal/cpa-templates/asset-purchase.template.ts`
- Create: `apps/api/src/modules/journal/cpa-templates/asset-purchase.template.spec.ts`

- [ ] **Step 4.1: Write the failing test file (vitest)**

Look at `apps/api/src/modules/journal/cpa-templates/expense.template.spec.ts` first to copy its setup pattern (FINANCE company creation, prisma teardown). Then create:

```typescript
// apps/api/src/modules/journal/cpa-templates/asset-purchase.template.spec.ts
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { PrismaClient, AssetCategory, AssetStatus } from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';
import { AssetPurchaseTemplate } from './asset-purchase.template';
import { JournalAutoService } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { Decimal } from '@prisma/client/runtime/library';

const prisma = new PrismaClient();
let template: AssetPurchaseTemplate;
let companyId: string;
let userId: string;

async function createAsset(overrides: Partial<Parameters<typeof prisma.fixedAsset.create>[0]['data']> = {}) {
  return prisma.fixedAsset.create({
    data: {
      assetCode: `TEST-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      docNo: `ASSET-2605-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      name: 'Test Notebook',
      category: 'EQUIPMENT' as AssetCategory,
      basePrice: new Decimal(10000),
      shippingCost: new Decimal(0),
      installationCost: new Decimal(0),
      otherCapitalized: new Decimal(0),
      vatAmount: new Decimal(0),
      whtAmount: new Decimal(0),
      purchaseCost: new Decimal(10000),
      residualValue: new Decimal(0),
      usefulLifeMonths: 36,
      monthlyDepr: new Decimal('277.78'),
      netBookValue: new Decimal(10000),
      purchaseDate: new Date('2026-05-01'),
      paymentAccount: '11-1201',
      status: 'DRAFT' as AssetStatus,
      createdById: userId,
      ...overrides,
    },
  });
}

beforeAll(async () => {
  // Set up FINANCE company
  let company = await prisma.companyInfo.findFirst({ where: { companyCode: 'TEST_FINANCE_AP' } });
  if (!company) {
    company = await prisma.companyInfo.create({
      data: {
        companyCode: 'TEST_FINANCE_AP',
        companyName: 'Test Finance for Asset Purchase',
        taxId: '0000000000000',
        isVatRegistered: true,
      },
    });
  }
  companyId = company.id;

  let user = await prisma.user.findFirst({ where: { email: 'asset-test@bestchoice.local' } });
  if (!user) {
    user = await prisma.user.create({
      data: { email: 'asset-test@bestchoice.local', name: 'Asset Tester', passwordHash: 'x', role: 'OWNER' },
    });
  }
  userId = user.id;

  const moduleRef: TestingModule = await Test.createTestingModule({
    providers: [
      AssetPurchaseTemplate,
      JournalAutoService,
      { provide: PrismaService, useValue: prisma },
    ],
  }).compile();
  template = moduleRef.get(AssetPurchaseTemplate);
});

afterAll(async () => {
  // Cleanup test data
  await prisma.journalLine.deleteMany({ where: { journalEntry: { companyId } } });
  await prisma.journalEntry.deleteMany({ where: { companyId } });
  await prisma.fixedAsset.deleteMany({ where: { createdById: userId } });
  await prisma.companyInfo.deleteMany({ where: { companyCode: 'TEST_FINANCE_AP' } });
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.journalLine.deleteMany({ where: { journalEntry: { companyId } } });
  await prisma.journalEntry.deleteMany({ where: { companyId } });
});

describe('AssetPurchaseTemplate', () => {
  it('posts a balanced JE for EQUIPMENT cash purchase, no VAT, no WHT', async () => {
    const asset = await createAsset();
    const result = await template.execute({ assetId: asset.id, postedById: userId });

    expect(result).toMatchObject({ entryNo: expect.stringMatching(/^JE-\d{6}-\d{5}$/) });

    const je = await prisma.journalEntry.findFirst({
      where: { referenceType: 'AUTO', referenceId: asset.id },
      include: { lines: true },
    });
    expect(je).toBeTruthy();
    expect(je!.status).toBe('POSTED');
    const totalDr = je!.lines.reduce((s, l) => s + Number(l.debit), 0);
    const totalCr = je!.lines.reduce((s, l) => s + Number(l.credit), 0);
    expect(totalDr).toBe(totalCr);
    expect(totalDr).toBe(10000);

    const dr = je!.lines.find((l) => Number(l.debit) > 0);
    expect(dr!.accountCode).toBe('12-2101'); // EQUIPMENT cost account
    const cr = je!.lines.find((l) => Number(l.credit) > 0);
    expect(cr!.accountCode).toBe('11-1201'); // payment account from asset
  });

  it('routes IMPROVEMENT category to 12-2103', async () => {
    const asset = await createAsset({ category: 'IMPROVEMENT' });
    await template.execute({ assetId: asset.id, postedById: userId });
    const je = await prisma.journalEntry.findFirst({
      where: { referenceType: 'AUTO', referenceId: asset.id },
      include: { lines: true },
    });
    const dr = je!.lines.find((l) => Number(l.debit) > 0);
    expect(dr!.accountCode).toBe('12-2103');
  });

  it('routes FURNITURE to 12-2105 and VEHICLE to 12-2107', async () => {
    const f = await createAsset({ category: 'FURNITURE' });
    await template.execute({ assetId: f.id, postedById: userId });
    const fJe = await prisma.journalEntry.findFirst({
      where: { referenceType: 'AUTO', referenceId: f.id },
      include: { lines: true },
    });
    expect(fJe!.lines.find((l) => Number(l.debit) > 0)!.accountCode).toBe('12-2105');

    const v = await createAsset({ category: 'VEHICLE' });
    await template.execute({ assetId: v.id, postedById: userId });
    const vJe = await prisma.journalEntry.findFirst({
      where: { referenceType: 'AUTO', referenceId: v.id },
      include: { lines: true },
    });
    expect(vJe!.lines.find((l) => Number(l.debit) > 0)!.accountCode).toBe('12-2107');
  });

  it('VAT exclusive: adds Dr 11-4101 line for VAT', async () => {
    const asset = await createAsset({
      basePrice: new Decimal(10000),
      hasVat: true, vatInclusive: false,
      vatAmount: new Decimal(700), vatAccount: '11-4101',
      purchaseCost: new Decimal(10000),
      netBookValue: new Decimal(10000),
    });
    await template.execute({ assetId: asset.id, postedById: userId });
    const je = await prisma.journalEntry.findFirst({
      where: { referenceType: 'AUTO', referenceId: asset.id },
      include: { lines: true },
    });
    const vatLine = je!.lines.find((l) => l.accountCode === '11-4101');
    expect(vatLine).toBeTruthy();
    expect(Number(vatLine!.debit)).toBe(700);
    const totalDr = je!.lines.reduce((s, l) => s + Number(l.debit), 0);
    const totalCr = je!.lines.reduce((s, l) => s + Number(l.credit), 0);
    expect(totalDr).toBe(totalCr);
  });

  it('VAT inclusive: NO separate VAT line (already in basePrice)', async () => {
    const asset = await createAsset({
      // For inclusive: caller has already adjusted basePrice to ex-VAT
      basePrice: new Decimal(10000),  // ex-VAT
      hasVat: true, vatInclusive: true,
      vatAmount: new Decimal(700), vatAccount: '11-4101',
      purchaseCost: new Decimal(10000),
      netBookValue: new Decimal(10000),
    });
    await template.execute({ assetId: asset.id, postedById: userId });
    const je = await prisma.journalEntry.findFirst({
      where: { referenceType: 'AUTO', referenceId: asset.id },
      include: { lines: true },
    });
    expect(je!.lines.find((l) => l.accountCode === '11-4101')).toBeUndefined();
  });

  it('WHT PND53 (corporate): adds Cr 21-3103 line', async () => {
    const asset = await createAsset({
      hasWht: true, whtBaseAmount: new Decimal(10000),
      whtRate: new Decimal('0.03'), whtAmount: new Decimal(300),
      whtAccount: '21-3103', whtFormType: 'PND53',
    });
    await template.execute({ assetId: asset.id, postedById: userId });
    const je = await prisma.journalEntry.findFirst({
      where: { referenceType: 'AUTO', referenceId: asset.id },
      include: { lines: true },
    });
    const whtLine = je!.lines.find((l) => l.accountCode === '21-3103');
    expect(whtLine).toBeTruthy();
    expect(Number(whtLine!.credit)).toBe(300);
  });

  it('WHT PND3 (individual): routes to 21-3102', async () => {
    const asset = await createAsset({
      hasWht: true, whtBaseAmount: new Decimal(10000),
      whtRate: new Decimal('0.01'), whtAmount: new Decimal(100),
      whtAccount: '21-3102', whtFormType: 'PND3',
    });
    await template.execute({ assetId: asset.id, postedById: userId });
    const je = await prisma.journalEntry.findFirst({
      where: { referenceType: 'AUTO', referenceId: asset.id },
      include: { lines: true },
    });
    const whtLine = je!.lines.find((l) => l.accountCode === '21-3102');
    expect(whtLine).toBeTruthy();
    expect(Number(whtLine!.credit)).toBe(100);
  });

  it('writes account snapshot fields onto asset after POST', async () => {
    const asset = await createAsset({ category: 'EQUIPMENT' });
    await template.execute({ assetId: asset.id, postedById: userId });
    const updated = await prisma.fixedAsset.findUnique({ where: { id: asset.id } });
    expect(updated!.coaCostAccount).toBe('12-2101');
    expect(updated!.coaDeprAccount).toBe('12-2102');
    expect(updated!.coaExpenseAccount).toBe('53-1601');
  });

  it('idempotency: second call returns same entry, no duplicate JE', async () => {
    const asset = await createAsset();
    const r1 = await template.execute({ assetId: asset.id, postedById: userId });
    const r2 = await template.execute({ assetId: asset.id, postedById: userId });
    expect(r1.entryNo).toBe(r2.entryNo);
    const count = await prisma.journalEntry.count({
      where: { referenceType: 'AUTO', referenceId: asset.id },
    });
    expect(count).toBe(1);
  });

  it('full-cost mix: basePrice + shipping + installation + other', async () => {
    const asset = await createAsset({
      basePrice: new Decimal(10000),
      shippingCost: new Decimal(500),
      installationCost: new Decimal(1000),
      otherCapitalized: new Decimal(200),
      purchaseCost: new Decimal(11700),
      netBookValue: new Decimal(11700),
    });
    await template.execute({ assetId: asset.id, postedById: userId });
    const je = await prisma.journalEntry.findFirst({
      where: { referenceType: 'AUTO', referenceId: asset.id },
      include: { lines: true },
    });
    const dr = je!.lines.find((l) => l.accountCode === '12-2101')!;
    expect(Number(dr.debit)).toBe(11700);
  });

  it('throws if asset not found', async () => {
    await expect(
      template.execute({ assetId: '00000000-0000-0000-0000-000000000000', postedById: userId }),
    ).rejects.toThrow();
  });

  it('inserts JournalPostAuditLog inside same transaction (T2-C14)', async () => {
    const asset = await createAsset();
    await template.execute({ assetId: asset.id, postedById: userId });
    const je = await prisma.journalEntry.findFirst({ where: { referenceId: asset.id } });
    const auditLogs = await prisma.journalPostAuditLog.findMany({ where: { journalEntryId: je!.id } });
    expect(auditLogs).toHaveLength(1);
    expect(auditLogs[0].postedById).toBe(userId);
  });
});
```

- [ ] **Step 4.2: Run test — verify it fails (template doesn't exist yet)**

```bash
cd apps/api && npx vitest run journal/cpa-templates/asset-purchase.template
```

Expected: FAIL with `Cannot find module './asset-purchase.template'`.

- [ ] **Step 4.3: Implement the template**

Create `apps/api/src/modules/journal/cpa-templates/asset-purchase.template.ts`:

```typescript
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { JournalAutoService } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';

/** Maps AssetCategory → [costCode, accDeprCode, expenseCode] */
const CATEGORY_CHART: Record<string, [string, string, string]> = {
  EQUIPMENT:   ['12-2101', '12-2102', '53-1601'],
  IMPROVEMENT: ['12-2103', '12-2104', '53-1602'],
  FURNITURE:   ['12-2105', '12-2106', '53-1603'],
  VEHICLE:     ['12-2107', '12-2108', '53-1604'],
};

const CATEGORY_LABEL: Record<string, string> = {
  EQUIPMENT:   'อุปกรณ์สำนักงาน',
  IMPROVEMENT: 'ส่วนปรับปรุงอาคาร',
  FURNITURE:   'เครื่องตกแต่งสำนักงาน',
  VEHICLE:     'ยานพาหนะ',
};

export interface AssetPurchaseInput {
  assetId: string;
  postedById: string;
}

/**
 * Template — Asset purchase POST (Phase 1).
 *
 * JE structure:
 *   Dr 12-21XX <category cost account>     [purchaseCost]
 *   Dr 11-4101/02 <vat>  (only if hasVat && !vatInclusive)
 *     Cr 21-3102/03 <wht>  (only if hasWht)
 *     Cr <paymentAccount>                  [totalPayable]
 *
 * VAT inclusive case: caller (asset.service) has already removed VAT from basePrice
 * and stored ex-VAT in basePrice. We do NOT add a separate VAT line in this case.
 *
 * Idempotency: returns existing entry if (referenceType='AUTO', referenceId=assetId) row exists.
 *
 * Side effects: writes account snapshots (coaCostAccount/coaDeprAccount/coaExpenseAccount) to asset.
 */
@Injectable()
export class AssetPurchaseTemplate {
  private readonly logger = new Logger(AssetPurchaseTemplate.name);

  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
  ) {}

  async execute(input: AssetPurchaseInput): Promise<{ entryNo: string }> {
    const { assetId, postedById } = input;

    // Idempotency check
    const existing = await this.prisma.journalEntry.findFirst({
      where: { referenceType: 'AUTO', referenceId: assetId, deletedAt: null },
    });
    if (existing) {
      this.logger.log(`AssetPurchase idempotency — JE ${existing.entryNumber} already exists for asset ${assetId}, skipping`);
      return { entryNo: existing.entryNumber };
    }

    const asset = await this.prisma.fixedAsset.findFirst({ where: { id: assetId, deletedAt: null } });
    if (!asset) {
      throw new NotFoundException(`Asset ${assetId} not found`);
    }

    const [costCode, accDeprCode, expenseCode] = CATEGORY_CHART[asset.category];
    const label = CATEGORY_LABEL[asset.category];
    const purchaseCost = new Decimal(asset.purchaseCost.toString());
    const vatAmount = new Decimal(asset.vatAmount.toString());
    const whtAmount = new Decimal(asset.whtAmount.toString());

    // Build JE lines
    type Line = { accountCode: string; dr?: Decimal; cr?: Decimal; description?: string };
    const lines: Line[] = [];

    // Dr cost account
    lines.push({
      accountCode: costCode,
      dr: purchaseCost,
      description: `${label} - ${asset.assetCode}`,
    });

    // Dr VAT (only if exclusive — inclusive means VAT was already netted out of basePrice)
    if (asset.hasVat && !asset.vatInclusive && vatAmount.gt(0) && asset.vatAccount) {
      lines.push({
        accountCode: asset.vatAccount,
        dr: vatAmount,
        description: `ภาษีซื้อ - ${asset.assetCode}`,
      });
    }

    // Cr WHT
    if (asset.hasWht && whtAmount.gt(0) && asset.whtAccount) {
      lines.push({
        accountCode: asset.whtAccount,
        cr: whtAmount,
        description: `WHT ${asset.whtFormType ?? ''} - ${asset.assetCode}`,
      });
    }

    // Cr payment account (totalPayable = purchaseCost + (exclusive ? vatAmount : 0) - whtAmount)
    const totalPayable = purchaseCost
      .plus(asset.vatInclusive ? new Decimal(0) : vatAmount)
      .minus(whtAmount);
    if (!asset.paymentAccount) {
      throw new NotFoundException(`Asset ${asset.assetCode} missing paymentAccount`);
    }
    lines.push({
      accountCode: asset.paymentAccount,
      cr: totalPayable,
      description: `ชำระค่า ${label} - ${asset.assetCode}`,
    });

    // Validate Dr === Cr
    const totalDr = lines.reduce((s, l) => s.plus(l.dr ?? 0), new Decimal(0));
    const totalCr = lines.reduce((s, l) => s.plus(l.cr ?? 0), new Decimal(0));
    if (!totalDr.equals(totalCr)) {
      throw new Error(`AssetPurchase JE unbalanced: Dr=${totalDr} Cr=${totalCr} for asset ${asset.assetCode}`);
    }

    // Post + write snapshots inside one $transaction
    let entryNo: string;
    await this.prisma.$transaction(async (tx) => {
      const result = await this.journal.createAndPost(
        {
          description: `ซื้อสินทรัพย์ ${asset.assetCode} - ${asset.name}`,
          reference: asset.id,
          metadata: {
            tag: 'asset-purchase',
            eventType: 'ASSET_PURCHASE',
            assetCode: asset.assetCode,
            categorySnapshot: asset.category,
            vatInclusive: asset.vatInclusive,
          },
          lines,
          postedById,
          entryDate: asset.purchaseDate,
        },
        tx,
      );
      entryNo = result.entryNumber;

      // Account snapshots
      await tx.fixedAsset.update({
        where: { id: asset.id },
        data: {
          coaCostAccount: costCode,
          coaDeprAccount: accDeprCode,
          coaExpenseAccount: expenseCode,
        },
      });
    });

    this.logger.log(`[Phase1] AssetPurchase posted JE ${entryNo!} for asset ${asset.assetCode}`);
    return { entryNo: entryNo! };
  }
}
```

> Note: this template assumes `JournalAutoService.createAndPost` accepts an optional `tx` 2nd argument. Check the signature in `journal-auto.service.ts:35` — if it doesn't, the `tx` arg is dropped (the helper opens its own transaction internally) and the asset update needs to happen separately. If you find the helper opens its own tx and accepts none, revise this code to call `createAndPost` first (capture entryNumber), then `prisma.fixedAsset.update` second — both still committed atomically through the outer $transaction wrapper if you wrap the whole thing.

If `JournalAutoService.createAndPost` does NOT accept a `tx` parameter, update the spec/code to wrap the whole thing differently. Read `journal-auto.service.ts:35-90` to confirm.

- [ ] **Step 4.4: Register in JournalModule**

Open `apps/api/src/modules/journal/journal.module.ts`. Add `AssetPurchaseTemplate` to the providers and exports arrays. (Find existing template imports/registrations and follow the same pattern.)

- [ ] **Step 4.5: Run tests**

```bash
cd apps/api && npx vitest run journal/cpa-templates/asset-purchase.template
```

Expected: 11 PASS.

If a test fails on the inclusive VAT case because the spec says "caller has already removed VAT from basePrice" — that's correct. The asset.service (Task 7) is responsible for that pre-adjustment. The template assumes basePrice is already ex-VAT when `vatInclusive=true`.

- [ ] **Step 4.6: Run typecheck**

```bash
./tools/check-types.sh api
```

Expected: 0 errors.

- [ ] **Step 4.7: Commit**

```bash
git add apps/api/src/modules/journal/cpa-templates/asset-purchase.template.ts \
        apps/api/src/modules/journal/cpa-templates/asset-purchase.template.spec.ts \
        apps/api/src/modules/journal/journal.module.ts
git commit -m "feat(asset): AssetPurchaseTemplate + 11 tests

JE structure: Dr 12-21XX cost + Dr 11-4101/02 VAT (exclusive only) /
Cr 21-3102/03 WHT / Cr paymentAccount (balanced). Account snapshots
pinned to asset (coaCostAccount/coaDeprAccount/coaExpenseAccount) at
POST time per Handover Fix #1.2. Idempotent on (referenceType, referenceId)."
```

---

## Task 5: AssetPurchaseReverseTemplate + tests

**Files:**
- Create: `apps/api/src/modules/journal/cpa-templates/asset-purchase-reverse.template.ts`
- Create: `apps/api/src/modules/journal/cpa-templates/asset-purchase-reverse.template.spec.ts`

- [ ] **Step 5.1: Write the failing test**

Create `apps/api/src/modules/journal/cpa-templates/asset-purchase-reverse.template.spec.ts` mirroring the setup from Task 4 (same `prisma`, `companyId`, `userId` setup; replace describe block with reverse-specific tests):

```typescript
// Setup identical to asset-purchase.template.spec.ts (copy beforeAll/afterAll/beforeEach)
// + import AssetPurchaseReverseTemplate

import { AssetPurchaseTemplate } from './asset-purchase.template';
import { AssetPurchaseReverseTemplate } from './asset-purchase-reverse.template';

let purchase: AssetPurchaseTemplate;
let reverse: AssetPurchaseReverseTemplate;

// In beforeAll moduleRef.compile, add AssetPurchaseReverseTemplate to providers.

describe('AssetPurchaseReverseTemplate', () => {
  it('creates mirror JE with Cr/Dr swapped, marked as REVERSAL', async () => {
    const asset = await createAsset();  // helper from purchase test pattern
    await purchase.execute({ assetId: asset.id, postedById: userId });

    const result = await reverse.execute({
      assetId: asset.id,
      reversedById: userId,
      reason: 'ลงผิด',
    });
    expect(result.entryNo).toMatch(/^JE-\d{6}-\d{5}$/);

    const original = await prisma.journalEntry.findFirst({
      where: { referenceType: 'AUTO', referenceId: asset.id },
    });
    const reversal = await prisma.journalEntry.findFirst({
      where: { referenceType: 'AUTO', referenceId: `${asset.id}:reverse` },
      include: { lines: true },
    });
    expect(original).toBeTruthy();
    expect(reversal).toBeTruthy();

    // Original metadata flagged
    expect((original!.metadata as any)?.reversed).toBe(true);
    expect((original!.metadata as any)?.reversedByEntryNumber).toBe(reversal!.entryNumber);

    // Mirror balanced
    const totalDr = reversal!.lines.reduce((s, l) => s + Number(l.debit), 0);
    const totalCr = reversal!.lines.reduce((s, l) => s + Number(l.credit), 0);
    expect(totalDr).toBe(totalCr);
  });

  it('rejects if asset has DepreciationEntry', async () => {
    const asset = await createAsset();
    await purchase.execute({ assetId: asset.id, postedById: userId });
    await prisma.depreciationEntry.create({
      data: { assetId: asset.id, period: '2026-05', amount: new Decimal(100) },
    });
    await expect(
      reverse.execute({ assetId: asset.id, reversedById: userId, reason: 'x' }),
    ).rejects.toThrow(/depreciation/i);
  });

  it('rejects if no original JE exists', async () => {
    const asset = await createAsset();  // never posted
    await expect(
      reverse.execute({ assetId: asset.id, reversedById: userId, reason: 'x' }),
    ).rejects.toThrow(/not found/i);
  });

  it('idempotency: second reverse call rejects', async () => {
    const asset = await createAsset();
    await purchase.execute({ assetId: asset.id, postedById: userId });
    await reverse.execute({ assetId: asset.id, reversedById: userId, reason: 'first' });
    await expect(
      reverse.execute({ assetId: asset.id, reversedById: userId, reason: 'second' }),
    ).rejects.toThrow(/already reversed/i);
  });

  it('original JE remains POSTED (TFRS no-touch)', async () => {
    const asset = await createAsset();
    await purchase.execute({ assetId: asset.id, postedById: userId });
    await reverse.execute({ assetId: asset.id, reversedById: userId, reason: 'x' });
    const original = await prisma.journalEntry.findFirst({
      where: { referenceType: 'AUTO', referenceId: asset.id },
    });
    expect(original!.status).toBe('POSTED');
  });

  it('reversal JE description includes [VOID] prefix', async () => {
    const asset = await createAsset();
    await purchase.execute({ assetId: asset.id, postedById: userId });
    await reverse.execute({ assetId: asset.id, reversedById: userId, reason: 'x' });
    const reversal = await prisma.journalEntry.findFirst({
      where: { referenceType: 'AUTO', referenceId: `${asset.id}:reverse` },
      include: { lines: true },
    });
    expect(reversal!.description).toMatch(/ยกเลิก|VOID/i);
    expect(reversal!.lines.every((l) => l.description?.includes('[VOID]'))).toBe(true);
  });

  it('reversal JE metadata links back to original', async () => {
    const asset = await createAsset();
    await purchase.execute({ assetId: asset.id, postedById: userId });
    const original = await prisma.journalEntry.findFirst({
      where: { referenceType: 'AUTO', referenceId: asset.id },
    });
    await reverse.execute({ assetId: asset.id, reversedById: userId, reason: 'x' });
    const reversal = await prisma.journalEntry.findFirst({
      where: { referenceType: 'AUTO', referenceId: `${asset.id}:reverse` },
    });
    const meta = reversal!.metadata as any;
    expect(meta.flow).toBe('asset-purchase-reverse');
    expect(meta.originalEntryId).toBe(original!.id);
    expect(meta.originalEntryNumber).toBe(original!.entryNumber);
    expect(meta.reversalReason).toBe('x');
  });

  it('rejects if reason is empty', async () => {
    const asset = await createAsset();
    await purchase.execute({ assetId: asset.id, postedById: userId });
    await expect(
      reverse.execute({ assetId: asset.id, reversedById: userId, reason: '' }),
    ).rejects.toThrow(/reason/i);
  });
});
```

- [ ] **Step 5.2: Run test — verify it fails**

```bash
cd apps/api && npx vitest run journal/cpa-templates/asset-purchase-reverse.template
```

Expected: FAIL — `Cannot find module './asset-purchase-reverse.template'`.

- [ ] **Step 5.3: Implement the template**

Create `apps/api/src/modules/journal/cpa-templates/asset-purchase-reverse.template.ts`:

```typescript
import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { JournalAutoService } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';

export interface AssetPurchaseReverseInput {
  assetId: string;
  reversedById: string;
  reason: string;
}

@Injectable()
export class AssetPurchaseReverseTemplate {
  private readonly logger = new Logger(AssetPurchaseReverseTemplate.name);

  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
  ) {}

  async execute(input: AssetPurchaseReverseInput): Promise<{ entryNo: string }> {
    const { assetId, reversedById, reason } = input;

    if (!reason || reason.trim().length === 0) {
      throw new BadRequestException('Reversal reason is required');
    }

    // Find original JE
    const original = await this.prisma.journalEntry.findFirst({
      where: { referenceType: 'AUTO', referenceId: assetId, deletedAt: null },
      include: { lines: true },
    });
    if (!original) {
      throw new NotFoundException(`Original purchase JE not found for asset ${assetId}`);
    }
    if ((original.metadata as any)?.reversed === true) {
      throw new BadRequestException(`Asset ${assetId} already reversed`);
    }

    // Block if any depreciation entries exist
    const deprCount = await this.prisma.depreciationEntry.count({ where: { assetId } });
    if (deprCount > 0) {
      throw new BadRequestException(
        `Cannot reverse: asset has ${deprCount} depreciation entries. Reverse those first.`,
      );
    }

    // Build mirror lines
    const reversedLines = original.lines.map((l) => ({
      accountCode: l.accountCode,
      dr: new Decimal(l.credit.toString()),
      cr: new Decimal(l.debit.toString()),
      description: `[VOID] ${l.description ?? ''}`.trim(),
    }));

    let entryNo: string;
    await this.prisma.$transaction(async (tx) => {
      const result = await this.journal.createAndPost(
        {
          description: `[ยกเลิก] กลับรายการซื้อสินทรัพย์ JE ${original.entryNumber}`,
          reference: `${assetId}:reverse`,
          metadata: {
            tag: 'REVERSAL',
            flow: 'asset-purchase-reverse',
            originalEntryId: original.id,
            originalEntryNumber: original.entryNumber,
            reversalReason: reason,
            eventType: 'ASSET_PURCHASE_REVERSAL',
          },
          lines: reversedLines,
          postedById: reversedById,
          entryDate: new Date(),
        },
        tx,
      );
      entryNo = result.entryNumber;

      // Flag original (TFRS no-touch — original stays POSTED)
      const existingMeta = (original.metadata as Prisma.InputJsonObject) ?? {};
      await tx.journalEntry.update({
        where: { id: original.id },
        data: {
          metadata: {
            ...existingMeta,
            reversed: true,
            reversedByEntryNumber: entryNo,
            reversedAt: new Date().toISOString(),
          },
        },
      });
    });

    this.logger.log(`[Phase1] AssetPurchaseReverse posted JE ${entryNo!} (reverses ${original.entryNumber})`);
    return { entryNo: entryNo! };
  }
}
```

- [ ] **Step 5.4: Register in JournalModule**

Add `AssetPurchaseReverseTemplate` to providers + exports in `apps/api/src/modules/journal/journal.module.ts`.

- [ ] **Step 5.5: Run tests**

```bash
cd apps/api && npx vitest run journal/cpa-templates/asset-purchase-reverse.template
```

Expected: 8 PASS.

- [ ] **Step 5.6: Commit**

```bash
git add apps/api/src/modules/journal/cpa-templates/asset-purchase-reverse.template.ts \
        apps/api/src/modules/journal/cpa-templates/asset-purchase-reverse.template.spec.ts \
        apps/api/src/modules/journal/journal.module.ts
git commit -m "feat(asset): AssetPurchaseReverseTemplate + 8 tests

Mirrors original JE (Dr↔Cr swap), uses :reverse-suffixed referenceId to
avoid unique index conflict, flags original metadata.reversed=true,
links via metadata.originalEntryId/originalEntryNumber. Blocks if asset
has depreciation entries. Original stays POSTED per TFRS no-touch."
```

---

## Task 6: AssetService — CRUD + helpers

**Files:**
- Create: `apps/api/src/modules/asset/__tests__/asset.service.spec.ts` (start with CRUD/helper tests)
- Replace: `apps/api/src/modules/asset/asset.service.ts`

- [ ] **Step 6.1: Read reference patterns**

Read `apps/api/src/modules/accounting/accounting.service.ts:200-250` for `expense.create` (pattern for doc-number generation + transaction structure). The asset service mirrors this.

- [ ] **Step 6.2: Write failing tests for CRUD + helpers (~13 cases)**

Create `apps/api/src/modules/asset/__tests__/asset.service.spec.ts`. Use `Test.createTestingModule` like the JE template tests, but provide `AssetService`, `PrismaService`, `JournalAutoService`, `AssetPurchaseTemplate`, `AssetPurchaseReverseTemplate`. Setup helpers:

```typescript
async function createPostedAsset(overrides = {}) {
  const draft = await service.createDraft({
    name: 'Test', category: 'EQUIPMENT', basePrice: 10000,
    usefulLifeMonths: 36, purchaseDate: '2026-05-01',
    paymentAccount: '11-1201', ...overrides,
  }, userId);
  await service.post(draft.id, userId);
  return prisma.fixedAsset.findUnique({ where: { id: draft.id } });
}
```

Tests to write (each as a separate `it` block):

1. `createDraft generates assetCode and docNo` — assertion: result has `assetCode` matching `/^[A-Z]+-\d+$/` and `docNo` matching `/^ASSET-\d{4}-\d+$/`
2. `createDraft computes monthlyDepr correctly` — basePrice 36000, residual 0, life 36 → monthlyDepr 1000
3. `createDraft handles VAT inclusive — adjusts basePrice` — basePrice 10700 inclusive → stored basePrice 10000, vatAmount 700, purchaseCost 10000
4. `createDraft handles VAT exclusive — adds vatAmount` — basePrice 10000 + 7% → vatAmount 700, purchaseCost 10000
5. `createDraft computes WHT from installation cost (Fix #1.1)` — basePrice 100000 + installation 50000 + WHT 3% → whtAmount 1500
6. `update rejects if status != DRAFT` — post first, then update → BadRequestException
7. `delete soft-deletes DRAFT` — delete, then findOne → returns null (or `deletedAt` set)
8. `delete rejects if status != DRAFT` — post, delete → BadRequestException
9. `findAll filters by status` — create 3 DRAFT + 2 POSTED, query `status=POSTED` → 2 results
10. `findAll filters by category and search` — search by partial name match
11. `findAll paginates` — create 12, page 1 limit 10 → 10 results, total 12
12. `findOne returns 404 if not found`
13. `findOne includes recent 10 transferHistory rows` — create 12 transfer history rows, expect 10 returned
14. `generateAssetCode produces sequential codes per category` — call twice → second has higher number
15. `getDepreciationSummary returns counts by status` — verify counts match

- [ ] **Step 6.3: Run tests — verify they fail**

```bash
cd apps/api && npx vitest run modules/asset/__tests__/asset.service
```

Expected: FAIL on `createDraft is not a function` etc.

- [ ] **Step 6.4: Implement `AssetService` CRUD + helpers**

Replace `apps/api/src/modules/asset/asset.service.ts` content:

```typescript
import { Injectable, Logger, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma, AssetCategory, AssetStatus, PaymentMethod } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { CreateAssetDto } from './dto/create-asset.dto';
import { UpdateAssetDto } from './dto/update-asset.dto';
import { AssetPurchaseTemplate } from '../journal/cpa-templates/asset-purchase.template';
import { AssetPurchaseReverseTemplate } from '../journal/cpa-templates/asset-purchase-reverse.template';
import { validatePeriodOpen } from '../../utils/period-lock.util';

const CATEGORY_PREFIX: Record<AssetCategory, string> = {
  EQUIPMENT: 'EQ',
  IMPROVEMENT: 'IM',
  FURNITURE: 'FN',
  VEHICLE: 'VH',
};

function round2(d: Decimal | number | string): Decimal {
  return new Decimal(d).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

function round4(d: Decimal | number | string): Decimal {
  return new Decimal(d).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
}

@Injectable()
export class AssetService {
  private readonly logger = new Logger(AssetService.name);
  private financeCompanyId?: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly purchaseTemplate: AssetPurchaseTemplate,
    private readonly reverseTemplate: AssetPurchaseReverseTemplate,
  ) {}

  private async getFinanceCompanyId(): Promise<string> {
    if (this.financeCompanyId) return this.financeCompanyId;
    const company = await this.prisma.companyInfo.findFirst({
      where: { companyCode: 'FINANCE', deletedAt: null },
    });
    if (!company) throw new Error('FINANCE company not found in CompanyInfo');
    this.financeCompanyId = company.id;
    return company.id;
  }

  async generateAssetCode(category?: AssetCategory): Promise<{ assetCode: string }> {
    const prefix = category ? CATEGORY_PREFIX[category] : 'EQ';
    // Find max existing for this prefix
    const last = await this.prisma.fixedAsset.findFirst({
      where: { assetCode: { startsWith: `${prefix}-` } },
      orderBy: { assetCode: 'desc' },
      select: { assetCode: true },
    });
    const seq = last ? parseInt(last.assetCode.split('-')[1], 10) + 1 : 1;
    return { assetCode: `${prefix}-${seq.toString().padStart(3, '0')}` };
  }

  private async generateDocNo(tx: Prisma.TransactionClient): Promise<string> {
    const now = new Date();
    const yymm = `${now.getFullYear().toString().slice(2)}${(now.getMonth() + 1).toString().padStart(2, '0')}`;
    const prefix = `ASSET-${yymm}-`;
    const last = await tx.fixedAsset.findFirst({
      where: { docNo: { startsWith: prefix } },
      orderBy: { docNo: 'desc' },
      select: { docNo: true },
    });
    const seq = last ? parseInt(last.docNo.slice(prefix.length), 10) + 1 : 1;
    return `${prefix}${seq.toString().padStart(4, '0')}`;
  }

  async createDraft(dto: CreateAssetDto, createdById: string) {
    // Compute derived values
    const basePriceRaw = new Decimal(dto.basePrice);
    const shippingCost = new Decimal(dto.shippingCost ?? 0);
    const installationCost = new Decimal(dto.installationCost ?? 0);
    const otherCapitalized = new Decimal(dto.otherCapitalized ?? 0);
    const residualValue = new Decimal(dto.residualValue ?? 0);

    let basePrice = basePriceRaw;
    let vatAmount = new Decimal(0);
    if (dto.hasVat) {
      if (dto.vatInclusive) {
        // Fix #1.3: extract VAT from inclusive basePrice
        vatAmount = round2(basePriceRaw.times(7).div(107));
        basePrice = basePriceRaw.minus(vatAmount);
      } else {
        vatAmount = round2(basePriceRaw.times('0.07'));
      }
    }

    const purchaseCost = round2(basePrice.plus(shippingCost).plus(installationCost).plus(otherCapitalized));

    // WHT — Fix #1.1: base on installation cost (or custom)
    let whtAmount = new Decimal(0);
    if (dto.hasWht && dto.whtRate) {
      const whtBase = new Decimal(dto.whtBaseAmount ?? installationCost);
      whtAmount = round2(whtBase.times(dto.whtRate));
    }

    const monthlyDepr = round4(purchaseCost.minus(residualValue).div(dto.usefulLifeMonths));

    return this.prisma.$transaction(async (tx) => {
      const docNo = await this.generateDocNo(tx);
      const { assetCode } = await this.generateAssetCode(dto.category);

      return tx.fixedAsset.create({
        data: {
          assetCode,
          docNo,
          name: dto.name,
          description: dto.description,
          category: dto.category,
          branchId: dto.branchId,
          basePrice,
          shippingCost,
          installationCost,
          otherCapitalized,
          hasVat: dto.hasVat ?? false,
          vatInclusive: dto.vatInclusive ?? false,
          vatAmount,
          vatAccount: dto.vatAccount,
          hasWht: dto.hasWht ?? false,
          whtBaseAmount: dto.whtBaseAmount ? new Decimal(dto.whtBaseAmount) : null,
          whtRate: dto.whtRate ? new Decimal(dto.whtRate) : null,
          whtAmount,
          whtAccount: dto.whtAccount,
          whtFormType: dto.whtFormType,
          purchaseCost,
          residualValue,
          usefulLifeMonths: dto.usefulLifeMonths,
          monthlyDepr,
          netBookValue: purchaseCost,
          purchaseDate: new Date(dto.purchaseDate),
          invoiceDate: dto.invoiceDate ? new Date(dto.invoiceDate) : null,
          warrantyExpire: dto.warrantyExpire ? new Date(dto.warrantyExpire) : null,
          supplierName: dto.supplierName,
          supplierTaxId: dto.supplierTaxId,
          invoiceNo: dto.invoiceNo,
          taxInvoiceNo: dto.taxInvoiceNo,
          paymentMethod: dto.paymentMethod,
          paymentAccount: dto.paymentAccount,
          custodian: dto.custodian,
          location: dto.location,
          serialNo: dto.serialNo,
          prRef: dto.prRef,
          note: dto.note,
          status: AssetStatus.DRAFT,
          createdById,
          approverId: dto.approverId,
        },
      });
    });
  }

  async update(id: string, dto: UpdateAssetDto) {
    const asset = await this.prisma.fixedAsset.findFirst({ where: { id, deletedAt: null } });
    if (!asset) throw new NotFoundException('ไม่พบสินทรัพย์');
    if (asset.status !== AssetStatus.DRAFT) {
      throw new BadRequestException('แก้ไขได้เฉพาะสถานะ DRAFT');
    }
    // Re-derive cost fields if any cost-affecting field changed
    // (For simplicity, re-derive whenever dto contains any cost field)
    const costFields = ['basePrice', 'shippingCost', 'installationCost', 'otherCapitalized', 'hasVat', 'vatInclusive', 'hasWht', 'whtRate', 'whtBaseAmount', 'residualValue', 'usefulLifeMonths'];
    const costChanged = costFields.some((f) => dto[f as keyof UpdateAssetDto] !== undefined);

    let derivedUpdate: Prisma.FixedAssetUpdateInput = {};
    if (costChanged) {
      // Merge dto with existing asset, recompute
      const merged = { ...asset, ...dto };
      const basePriceRaw = new Decimal(merged.basePrice as any);
      const shippingCost = new Decimal(merged.shippingCost as any ?? 0);
      const installationCost = new Decimal(merged.installationCost as any ?? 0);
      const otherCapitalized = new Decimal(merged.otherCapitalized as any ?? 0);
      const residualValue = new Decimal(merged.residualValue as any ?? 0);
      let basePrice = basePriceRaw;
      let vatAmount = new Decimal(0);
      if (merged.hasVat) {
        if (merged.vatInclusive) {
          vatAmount = round2(basePriceRaw.times(7).div(107));
          basePrice = basePriceRaw.minus(vatAmount);
        } else {
          vatAmount = round2(basePriceRaw.times('0.07'));
        }
      }
      const purchaseCost = round2(basePrice.plus(shippingCost).plus(installationCost).plus(otherCapitalized));
      let whtAmount = new Decimal(0);
      if (merged.hasWht && merged.whtRate) {
        const whtBase = new Decimal(merged.whtBaseAmount as any ?? installationCost);
        whtAmount = round2(whtBase.times(merged.whtRate as any));
      }
      const monthlyDepr = round4(purchaseCost.minus(residualValue).div(merged.usefulLifeMonths as number));
      derivedUpdate = { basePrice, vatAmount, purchaseCost, whtAmount, monthlyDepr, netBookValue: purchaseCost };
    }

    return this.prisma.fixedAsset.update({
      where: { id },
      data: {
        ...dto,
        purchaseDate: dto.purchaseDate ? new Date(dto.purchaseDate) : undefined,
        invoiceDate: dto.invoiceDate ? new Date(dto.invoiceDate) : undefined,
        warrantyExpire: dto.warrantyExpire ? new Date(dto.warrantyExpire) : undefined,
        ...derivedUpdate,
      },
    });
  }

  async delete(id: string, userId: string) {
    const asset = await this.prisma.fixedAsset.findFirst({ where: { id, deletedAt: null } });
    if (!asset) throw new NotFoundException('ไม่พบสินทรัพย์');
    if (asset.status !== AssetStatus.DRAFT) {
      throw new BadRequestException('ลบได้เฉพาะสถานะ DRAFT');
    }
    return this.prisma.fixedAsset.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async findAll(filters: {
    branchId?: string;
    category?: AssetCategory;
    status?: AssetStatus;
    search?: string;
    page?: number;
    limit?: number;
  }) {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 50;
    const where: Prisma.FixedAssetWhereInput = { deletedAt: null };
    if (filters.branchId) where.branchId = filters.branchId;
    if (filters.category) where.category = filters.category;
    if (filters.status) where.status = filters.status;
    if (filters.search) {
      where.OR = [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { assetCode: { contains: filters.search, mode: 'insensitive' } },
        { docNo: { contains: filters.search, mode: 'insensitive' } },
        { serialNo: { contains: filters.search, mode: 'insensitive' } },
      ];
    }
    const [data, total] = await Promise.all([
      this.prisma.fixedAsset.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { purchaseDate: 'desc' },
        include: { branch: true, createdBy: { select: { id: true, name: true } } },
      }),
      this.prisma.fixedAsset.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async findOne(id: string) {
    const asset = await this.prisma.fixedAsset.findFirst({
      where: { id, deletedAt: null },
      include: {
        branch: true,
        createdBy: { select: { id: true, name: true } },
        approver: { select: { id: true, name: true } },
        postedBy: { select: { id: true, name: true } },
        reversedBy: { select: { id: true, name: true } },
        transferHistory: {
          orderBy: { transferDate: 'desc' },
          take: 10,
          include: { transferredBy: { select: { id: true, name: true } } },
        },
      },
    });
    if (!asset) throw new NotFoundException('ไม่พบสินทรัพย์');
    return asset;
  }

  async getDepreciationSummary() {
    const [draft, posted, reversed, disposed, writtenOff, totalCost, totalNbv] = await Promise.all([
      this.prisma.fixedAsset.count({ where: { status: 'DRAFT', deletedAt: null } }),
      this.prisma.fixedAsset.count({ where: { status: 'POSTED', deletedAt: null } }),
      this.prisma.fixedAsset.count({ where: { status: 'REVERSED', deletedAt: null } }),
      this.prisma.fixedAsset.count({ where: { status: 'DISPOSED', deletedAt: null } }),
      this.prisma.fixedAsset.count({ where: { status: 'WRITTEN_OFF', deletedAt: null } }),
      this.prisma.fixedAsset.aggregate({
        where: { status: 'POSTED', deletedAt: null },
        _sum: { purchaseCost: true },
      }),
      this.prisma.fixedAsset.aggregate({
        where: { status: 'POSTED', deletedAt: null },
        _sum: { netBookValue: true },
      }),
    ]);
    return {
      draft, posted, reversed, disposed, writtenOff,
      totalPurchaseCost: totalCost._sum.purchaseCost ?? 0,
      totalNetBookValue: totalNbv._sum.netBookValue ?? 0,
    };
  }

  async getAuditTrail(assetId: string) {
    return this.prisma.auditLog.findMany({
      where: { entity: 'fixed_asset', entityId: assetId },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { user: { select: { id: true, name: true } } },
    });
  }

  // Stubs for Tasks 7-8
  async post(_id: string, _userId: string): Promise<{ entryNo: string }> {
    throw new Error('post: implement in Task 7');
  }
  async reverse(_id: string, _userId: string, _reason: string): Promise<{ entryNo: string }> {
    throw new Error('reverse: implement in Task 7');
  }
  async copy(_id: string, _userId: string) {
    throw new Error('copy: implement in Task 8');
  }
}
```

- [ ] **Step 6.5: Run tests**

```bash
cd apps/api && npx jest src/modules/asset/__tests__/asset.service
```

Expected: 13+ tests for CRUD/helpers PASS. (Tests for `post`/`reverse`/`copy` will fail — those are Task 7-8 stubs; you can mark them `it.skip(...)` or keep them failing as a TODO list.)

If `validatePeriodOpen` import fails because the asset service doesn't use it yet — that's fine, it's needed in Task 7. Comment out the import for now if needed.

- [ ] **Step 6.6: Typecheck**

```bash
./tools/check-types.sh api
```

Expected: 0 errors. The controller still has the old stubbed shape — leave it for Task 10.

- [ ] **Step 6.7: Commit**

```bash
git add apps/api/src/modules/asset/asset.service.ts \
        apps/api/src/modules/asset/__tests__/asset.service.spec.ts
git commit -m "feat(asset): AssetService CRUD + helpers + 15 tests

createDraft (with VAT inclusive/exclusive + WHT base on installation),
update (DRAFT only, re-derive on cost change), soft delete (DRAFT only),
findAll with pagination/filter/search, findOne with transferHistory,
getDepreciationSummary, getAuditTrail, generateAssetCode (per-category
prefix), generateDocNo. Stubs for post/reverse/copy in Tasks 7-8."
```

---

## Task 7: AssetService — post + reverse

**Files:**
- Modify: `apps/api/src/modules/asset/asset.service.ts` (replace `post()` and `reverse()` stubs)
- Modify: `apps/api/src/modules/asset/__tests__/asset.service.spec.ts` (add post/reverse tests)

- [ ] **Step 7.1: Write failing tests for post/reverse (~10 cases)**

Add to `asset.service.spec.ts`:

```typescript
describe('AssetService.post', () => {
  it('transitions DRAFT → POSTED and creates JE', async () => {
    const draft = await service.createDraft({
      name: 'Notebook', category: 'EQUIPMENT', basePrice: 30000,
      usefulLifeMonths: 36, purchaseDate: '2026-05-01', paymentAccount: '11-1201',
    }, userId);
    const result = await service.post(draft.id, userId);
    expect(result.entryNo).toMatch(/^JE-\d{6}-\d{5}$/);
    const updated = await prisma.fixedAsset.findUnique({ where: { id: draft.id } });
    expect(updated!.status).toBe('POSTED');
    expect(updated!.postedById).toBe(userId);
    expect(updated!.postedAt).toBeTruthy();
  });

  it('rejects POST if status != DRAFT', async () => {
    const asset = await createPostedAsset();
    await expect(service.post(asset.id, userId)).rejects.toThrow(/DRAFT/);
  });

  it('writes AuditLog with action=ASSET_POST', async () => {
    const draft = await service.createDraft({ name: 'X', category: 'EQUIPMENT', basePrice: 1000, usefulLifeMonths: 12, purchaseDate: '2026-05-01', paymentAccount: '11-1201' }, userId);
    await service.post(draft.id, userId);
    const log = await prisma.auditLog.findFirst({
      where: { entity: 'fixed_asset', entityId: draft.id, action: 'ASSET_POST' },
    });
    expect(log).toBeTruthy();
    expect((log!.newValue as any).status).toBe('POSTED');
  });

  it('post is idempotent — second call returns same JE', async () => {
    const draft = await service.createDraft({ name: 'X', category: 'EQUIPMENT', basePrice: 1000, usefulLifeMonths: 12, purchaseDate: '2026-05-01', paymentAccount: '11-1201' }, userId);
    const r1 = await service.post(draft.id, userId);
    const r2 = await service.post(draft.id, userId).catch((e) => e);
    // Either rejects (clearer UX) or returns same entry — either is acceptable
    if (r2 instanceof Error) {
      expect(r2.message).toMatch(/DRAFT|already/i);
    } else {
      expect(r2.entryNo).toBe(r1.entryNo);
    }
  });
});

describe('AssetService.reverse', () => {
  it('transitions POSTED → REVERSED and creates reversal JE', async () => {
    const asset = await createPostedAsset();
    const result = await service.reverse(asset.id, userId, 'ลงผิด');
    expect(result.entryNo).toMatch(/^JE-\d{6}-\d{5}$/);
    const updated = await prisma.fixedAsset.findUnique({ where: { id: asset.id } });
    expect(updated!.status).toBe('REVERSED');
    expect(updated!.reversedById).toBe(userId);
    expect(updated!.reversalReason).toBe('ลงผิด');
  });

  it('rejects reverse if status != POSTED', async () => {
    const draft = await service.createDraft({ name: 'X', category: 'EQUIPMENT', basePrice: 1000, usefulLifeMonths: 12, purchaseDate: '2026-05-01', paymentAccount: '11-1201' }, userId);
    await expect(service.reverse(draft.id, userId, 'reason')).rejects.toThrow(/POSTED/);
  });

  it('rejects reverse if asset has DepreciationEntry', async () => {
    const asset = await createPostedAsset();
    await prisma.depreciationEntry.create({
      data: { assetId: asset.id, period: '2026-05', amount: new Decimal(100) },
    });
    await expect(service.reverse(asset.id, userId, 'x')).rejects.toThrow(/depreciation/i);
  });

  it('writes AuditLog with action=ASSET_REVERSE', async () => {
    const asset = await createPostedAsset();
    await service.reverse(asset.id, userId, 'x');
    const log = await prisma.auditLog.findFirst({
      where: { entity: 'fixed_asset', entityId: asset.id, action: 'ASSET_REVERSE' },
    });
    expect(log).toBeTruthy();
  });

  it('rejects reverse with empty reason', async () => {
    const asset = await createPostedAsset();
    await expect(service.reverse(asset.id, userId, '')).rejects.toThrow();
  });

  it('logs ASSET_POST_BLOCKED when period is closed', async () => {
    // Create a closed period for May 2026 — assumes accounting_period table exists
    const finance = await prisma.companyInfo.findFirst({ where: { companyCode: 'FINANCE' } });
    if (finance) {
      await prisma.accountingPeriod.upsert({
        where: { companyId_period: { companyId: finance.id, period: '2026-05' } },
        update: { isClosed: true, closedAt: new Date(), closedById: userId },
        create: { companyId: finance.id, period: '2026-05', isClosed: true, closedAt: new Date(), closedById: userId },
      });
    }
    const draft = await service.createDraft({ name: 'X', category: 'EQUIPMENT', basePrice: 1000, usefulLifeMonths: 12, purchaseDate: '2026-05-15', paymentAccount: '11-1201' }, userId);
    await expect(service.post(draft.id, userId)).rejects.toThrow(/period|งวด/i);
    const blockedLog = await prisma.auditLog.findFirst({
      where: { entity: 'fixed_asset', entityId: draft.id, action: 'ASSET_POST_BLOCKED' },
    });
    expect(blockedLog).toBeTruthy();
    // Cleanup
    if (finance) {
      await prisma.accountingPeriod.delete({
        where: { companyId_period: { companyId: finance.id, period: '2026-05' } },
      });
    }
  });
});
```

> Note: the V15 test depends on `AccountingPeriod` model. If your schema uses different field names (e.g., `period_year_month`), adjust accordingly. Read `apps/api/prisma/schema.prisma` to find the model.

- [ ] **Step 7.2: Run tests — verify they fail**

```bash
cd apps/api && npx jest src/modules/asset/__tests__/asset.service -t "post|reverse"
```

Expected: FAIL with "post: implement in Task 7".

- [ ] **Step 7.3: Implement `post()` and `reverse()`**

In `asset.service.ts`, replace the stub `post` and `reverse` methods:

```typescript
async post(id: string, postedById: string): Promise<{ entryNo: string }> {
  const asset = await this.prisma.fixedAsset.findFirst({ where: { id, deletedAt: null } });
  if (!asset) throw new NotFoundException('ไม่พบสินทรัพย์');
  if (asset.status !== AssetStatus.DRAFT) {
    throw new BadRequestException(`POST ได้เฉพาะสถานะ DRAFT (ปัจจุบัน: ${asset.status})`);
  }

  // V15: Period lock check
  const financeCompanyId = await this.getFinanceCompanyId();
  try {
    await validatePeriodOpen(this.prisma, asset.purchaseDate, financeCompanyId);
  } catch (err: any) {
    // Log blocked attempt
    await this.prisma.auditLog.create({
      data: {
        userId: postedById, action: 'ASSET_POST_BLOCKED',
        entity: 'fixed_asset', entityId: id,
        oldValue: { status: 'DRAFT' },
        newValue: { reason: err.message ?? 'period closed' },
      },
    });
    throw new BadRequestException(`ไม่สามารถ POST: ${err.message ?? 'งวดบัญชีปิดแล้ว'}`);
  }

  // Post JE via template
  const result = await this.purchaseTemplate.execute({ assetId: id, postedById });

  // Update asset status (template already wrote account snapshots)
  await this.prisma.$transaction(async (tx) => {
    await tx.fixedAsset.update({
      where: { id },
      data: {
        status: AssetStatus.POSTED,
        postedById,
        postedAt: new Date(),
      },
    });
    await tx.auditLog.create({
      data: {
        userId: postedById,
        action: 'ASSET_POST',
        entity: 'fixed_asset',
        entityId: id,
        oldValue: { status: 'DRAFT' },
        newValue: {
          status: 'POSTED',
          postedById,
          journalEntryNumber: result.entryNo,
        },
      },
    });
  });

  this.logger.log(`[Phase1] POST asset ${asset.assetCode} → ${result.entryNo}`);
  return result;
}

async reverse(id: string, reversedById: string, reason: string): Promise<{ entryNo: string }> {
  if (!reason || reason.trim().length === 0) {
    throw new BadRequestException('กรุณาระบุเหตุผลการกลับรายการ');
  }
  const asset = await this.prisma.fixedAsset.findFirst({ where: { id, deletedAt: null } });
  if (!asset) throw new NotFoundException('ไม่พบสินทรัพย์');
  if (asset.status !== AssetStatus.POSTED) {
    throw new BadRequestException(`Reverse ได้เฉพาะสถานะ POSTED (ปัจจุบัน: ${asset.status})`);
  }

  // V15: Period lock check
  const financeCompanyId = await this.getFinanceCompanyId();
  try {
    await validatePeriodOpen(this.prisma, asset.purchaseDate, financeCompanyId);
  } catch (err: any) {
    await this.prisma.auditLog.create({
      data: {
        userId: reversedById, action: 'ASSET_REVERSE_BLOCKED',
        entity: 'fixed_asset', entityId: id,
        oldValue: { status: 'POSTED' },
        newValue: { reason: err.message ?? 'period closed' },
      },
    });
    throw new BadRequestException(`ไม่สามารถ Reverse: ${err.message ?? 'งวดบัญชีปิดแล้ว'}`);
  }

  // Post reversal JE (template already checks for DepreciationEntry)
  const result = await this.reverseTemplate.execute({
    assetId: id, reversedById, reason,
  });

  // Update asset status
  await this.prisma.$transaction(async (tx) => {
    await tx.fixedAsset.update({
      where: { id },
      data: {
        status: AssetStatus.REVERSED,
        reversedById,
        reversedAt: new Date(),
        reversalReason: reason,
      },
    });
    await tx.auditLog.create({
      data: {
        userId: reversedById,
        action: 'ASSET_REVERSE',
        entity: 'fixed_asset',
        entityId: id,
        oldValue: { status: 'POSTED' },
        newValue: {
          status: 'REVERSED',
          reversedById,
          reversalReason: reason,
          reversalEntryNumber: result.entryNo,
        },
      },
    });
  });

  this.logger.log(`[Phase1] REVERSE asset ${asset.assetCode} → ${result.entryNo}`);
  return result;
}
```

Re-add the import that was commented out earlier:
```typescript
import { validatePeriodOpen } from '../../utils/period-lock.util';
```

- [ ] **Step 7.4: Run tests**

```bash
cd apps/api && npx jest src/modules/asset/__tests__/asset.service -t "post|reverse"
```

Expected: all post/reverse tests PASS.

- [ ] **Step 7.5: Run full asset.service tests**

```bash
cd apps/api && npx jest src/modules/asset/__tests__/asset.service
```

Expected: all tests PASS (CRUD from Task 6 + post/reverse from Task 7).

- [ ] **Step 7.6: Typecheck**

```bash
./tools/check-types.sh api
```

Expected: 0 errors.

- [ ] **Step 7.7: Commit**

```bash
git add apps/api/src/modules/asset/asset.service.ts \
        apps/api/src/modules/asset/__tests__/asset.service.spec.ts
git commit -m "feat(asset): post/reverse with V15 period guard + AuditLog

post: DRAFT→POSTED, calls AssetPurchaseTemplate, writes ASSET_POST audit.
reverse: POSTED→REVERSED, calls AssetPurchaseReverseTemplate, writes
ASSET_REVERSE audit + reversalReason. V15 period closed → reject + audit
ASSET_POST_BLOCKED/ASSET_REVERSE_BLOCKED. +10 tests."
```

---

## Task 8: AssetService — copy

**Files:**
- Modify: `apps/api/src/modules/asset/asset.service.ts` (replace `copy()` stub)
- Modify: `apps/api/src/modules/asset/__tests__/asset.service.spec.ts` (add copy tests)

- [ ] **Step 8.1: Write failing tests (~3 cases)**

Add to `asset.service.spec.ts`:

```typescript
describe('AssetService.copy', () => {
  it('clones a POSTED asset into a new DRAFT', async () => {
    const source = await createPostedAsset({
      name: 'Notebook X', custodian: 'Alice', supplierName: 'Vendor A',
    });
    const copy = await service.copy(source.id, userId);
    expect(copy.id).not.toBe(source.id);
    expect(copy.assetCode).not.toBe(source.assetCode);
    expect(copy.docNo).not.toBe(source.docNo);
    expect(copy.status).toBe('DRAFT');
    expect(copy.name).toBe('Notebook X');
    expect(copy.custodian).toBe('Alice');
    expect(copy.supplierName).toBe('Vendor A');
    expect(copy.postedAt).toBeNull();
    expect(copy.coaCostAccount).toBeNull();
  });

  it('clones a REVERSED asset (any source status allowed)', async () => {
    const source = await createPostedAsset();
    await service.reverse(source.id, userId, 'x');
    const copy = await service.copy(source.id, userId);
    expect(copy.status).toBe('DRAFT');
  });

  it('AuditLog ASSET_CREATE includes copiedFromAssetId', async () => {
    const source = await createPostedAsset();
    const copy = await service.copy(source.id, userId);
    const log = await prisma.auditLog.findFirst({
      where: { entity: 'fixed_asset', entityId: copy.id, action: 'ASSET_CREATE' },
    });
    expect(log).toBeTruthy();
    expect((log!.newValue as any).copiedFromAssetId).toBe(source.id);
    expect((log!.newValue as any).copiedFromAssetCode).toBe(source.assetCode);
  });

  it('does NOT copy transferHistory or depreciationEntries', async () => {
    const source = await createPostedAsset();
    await prisma.assetTransferHistory.create({
      data: {
        transferId: 'TRF-test',
        assetId: source.id,
        transferDate: new Date(),
        toCustodian: 'Bob',
        reason: 'test',
        transferredById: userId,
      },
    });
    const copy = await service.copy(source.id, userId);
    const copyHistory = await prisma.assetTransferHistory.count({ where: { assetId: copy.id } });
    expect(copyHistory).toBe(0);
  });
});
```

- [ ] **Step 8.2: Run tests — verify they fail**

```bash
cd apps/api && npx jest src/modules/asset/__tests__/asset.service -t "copy"
```

Expected: FAIL with "copy: implement in Task 8".

- [ ] **Step 8.3: Implement `copy()`**

Replace the `copy` stub in `asset.service.ts`:

```typescript
async copy(id: string, createdById: string) {
  const source = await this.prisma.fixedAsset.findFirst({ where: { id, deletedAt: null } });
  if (!source) throw new NotFoundException('ไม่พบสินทรัพย์ต้นทาง');

  return this.prisma.$transaction(async (tx) => {
    const docNo = await this.generateDocNo(tx);
    const { assetCode } = await this.generateAssetCode(source.category);

    const copy = await tx.fixedAsset.create({
      data: {
        // Generated
        assetCode,
        docNo,
        // Copied operational fields
        name: source.name,
        description: source.description,
        category: source.category,
        branchId: source.branchId,
        basePrice: source.basePrice,
        shippingCost: source.shippingCost,
        installationCost: source.installationCost,
        otherCapitalized: source.otherCapitalized,
        hasVat: source.hasVat,
        vatInclusive: source.vatInclusive,
        vatAmount: source.vatAmount,
        vatAccount: source.vatAccount,
        hasWht: source.hasWht,
        whtRate: source.whtRate,
        whtAccount: source.whtAccount,
        whtFormType: source.whtFormType,
        whtAmount: source.whtAmount,
        purchaseCost: source.purchaseCost,
        residualValue: source.residualValue,
        usefulLifeMonths: source.usefulLifeMonths,
        monthlyDepr: source.monthlyDepr,
        netBookValue: source.purchaseCost,  // reset to full
        purchaseDate: new Date(),  // today
        warrantyExpire: source.warrantyExpire,
        supplierName: source.supplierName,
        supplierTaxId: source.supplierTaxId,
        paymentMethod: source.paymentMethod,
        paymentAccount: source.paymentAccount,
        custodian: source.custodian,
        location: source.location,
        prRef: source.prRef,
        note: source.note,
        // Reset
        whtBaseAmount: null,
        invoiceDate: null,
        invoiceNo: null,
        taxInvoiceNo: null,
        serialNo: null,
        accumulatedDepr: 0,
        coaCostAccount: null,
        coaDeprAccount: null,
        coaExpenseAccount: null,
        approverId: null,
        postedById: null,
        postedAt: null,
        reversedById: null,
        reversedAt: null,
        reversalReason: null,
        status: AssetStatus.DRAFT,
        createdById,
      },
    });

    await tx.auditLog.create({
      data: {
        userId: createdById,
        action: 'ASSET_CREATE',
        entity: 'fixed_asset',
        entityId: copy.id,
        newValue: {
          status: 'DRAFT',
          copiedFromAssetId: source.id,
          copiedFromAssetCode: source.assetCode,
        },
      },
    });

    return copy;
  });
}
```

- [ ] **Step 8.4: Run tests**

```bash
cd apps/api && npx jest src/modules/asset/__tests__/asset.service -t "copy"
```

Expected: 4 PASS.

- [ ] **Step 8.5: Run full asset.service tests**

```bash
cd apps/api && npx jest src/modules/asset/__tests__/asset.service
```

Expected: all PASS (~22 tests total: 15 CRUD/helpers + 6 post/reverse + 4 copy + 1 V15 = ~26).

- [ ] **Step 8.6: Commit**

```bash
git add apps/api/src/modules/asset/asset.service.ts \
        apps/api/src/modules/asset/__tests__/asset.service.spec.ts
git commit -m "feat(asset): copy endpoint clones DRAFT from any source

Cloned: cost fields, vendor, custodian, payment. Reset: ID, codes, dates,
posted/reversed/audit fields, snapshots. AuditLog ASSET_CREATE includes
copiedFromAssetId for lineage. transferHistory and depreciationEntries
NOT copied. +4 tests."
```

---

## Task 9: AssetTransferService

**Files:**
- Create: `apps/api/src/modules/asset/asset-transfer.service.ts`
- Create: `apps/api/src/modules/asset/__tests__/asset-transfer.service.spec.ts`

- [ ] **Step 9.1: Write failing tests (~10 cases)**

Create `apps/api/src/modules/asset/__tests__/asset-transfer.service.spec.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';
import { AssetService } from '../asset.service';
import { AssetTransferService } from '../asset-transfer.service';
import { AssetPurchaseTemplate } from '../../journal/cpa-templates/asset-purchase.template';
import { AssetPurchaseReverseTemplate } from '../../journal/cpa-templates/asset-purchase-reverse.template';
import { JournalAutoService } from '../../journal/journal-auto.service';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
let svc: AssetService;
let transferSvc: AssetTransferService;
let userId: string;

beforeAll(async () => {
  // Setup user + finance company (similar to asset.service.spec.ts)
  // ... (copy setup pattern)

  const moduleRef = await Test.createTestingModule({
    providers: [
      AssetService, AssetTransferService,
      AssetPurchaseTemplate, AssetPurchaseReverseTemplate, JournalAutoService,
      { provide: PrismaService, useValue: prisma },
    ],
  }).compile();
  svc = moduleRef.get(AssetService);
  transferSvc = moduleRef.get(AssetTransferService);
});

afterAll(async () => { await prisma.$disconnect(); });

beforeEach(async () => {
  await prisma.assetTransferHistory.deleteMany({});
  await prisma.fixedAsset.deleteMany({});
});

async function createPostedAsset(custodian = 'Alice', location = 'HQ Floor 1') {
  const draft = await svc.createDraft({
    name: 'Notebook', category: 'EQUIPMENT', basePrice: 30000,
    usefulLifeMonths: 36, purchaseDate: '2026-04-01', paymentAccount: '11-1201',
    custodian, location,
  }, userId);
  await svc.post(draft.id, userId);
  return prisma.fixedAsset.findUnique({ where: { id: draft.id } });
}

describe('AssetTransferService', () => {
  it('changes custodian only — no JE, history row created', async () => {
    const asset = await createPostedAsset('Alice', 'HQ');
    await transferSvc.transfer(asset.id, {
      transferDate: '2026-05-08',
      toCustodian: 'Bob',
      reason: 'Alice resigned',
    }, userId);
    const updated = await prisma.fixedAsset.findUnique({ where: { id: asset.id } });
    expect(updated!.custodian).toBe('Bob');
    expect(updated!.location).toBe('HQ');  // unchanged
    const history = await prisma.assetTransferHistory.findMany({ where: { assetId: asset.id } });
    expect(history).toHaveLength(1);
    expect(history[0].fromCustodian).toBe('Alice');
    expect(history[0].toCustodian).toBe('Bob');
    expect(history[0].fromLocation).toBe('HQ');
    expect(history[0].toLocation).toBe('HQ');
  });

  it('changes location only', async () => {
    const asset = await createPostedAsset('Alice', 'HQ');
    await transferSvc.transfer(asset.id, {
      transferDate: '2026-05-08',
      toLocation: 'Branch A',
      reason: 'relocation',
    }, userId);
    const updated = await prisma.fixedAsset.findUnique({ where: { id: asset.id } });
    expect(updated!.custodian).toBe('Alice');
    expect(updated!.location).toBe('Branch A');
  });

  it('changes both', async () => {
    const asset = await createPostedAsset('Alice', 'HQ');
    await transferSvc.transfer(asset.id, {
      transferDate: '2026-05-08',
      toCustodian: 'Bob', toLocation: 'Branch B',
      reason: 'reassignment',
    }, userId);
    const updated = await prisma.fixedAsset.findUnique({ where: { id: asset.id } });
    expect(updated!.custodian).toBe('Bob');
    expect(updated!.location).toBe('Branch B');
  });

  it('rejects if asset.status !== POSTED', async () => {
    const draft = await svc.createDraft({ name: 'X', category: 'EQUIPMENT', basePrice: 1000, usefulLifeMonths: 12, purchaseDate: '2026-05-01', paymentAccount: '11-1201' }, userId);
    await expect(transferSvc.transfer(draft.id, {
      transferDate: '2026-05-08', toCustodian: 'B', reason: 'x',
    }, userId)).rejects.toThrow(/POSTED/);
  });

  it('rejects if both toCustodian and toLocation are empty/unchanged', async () => {
    const asset = await createPostedAsset('Alice', 'HQ');
    await expect(transferSvc.transfer(asset.id, {
      transferDate: '2026-05-08', reason: 'x',
    }, userId)).rejects.toThrow(/no change/i);
  });

  it('rejects if reason is empty', async () => {
    const asset = await createPostedAsset();
    await expect(transferSvc.transfer(asset.id, {
      transferDate: '2026-05-08', toCustodian: 'B', reason: '',
    }, userId)).rejects.toThrow();
  });

  it('rejects if transferDate is in the future', async () => {
    const asset = await createPostedAsset();
    const future = new Date(); future.setFullYear(future.getFullYear() + 1);
    await expect(transferSvc.transfer(asset.id, {
      transferDate: future.toISOString().slice(0, 10),
      toCustodian: 'B', reason: 'x',
    }, userId)).rejects.toThrow(/future/i);
  });

  it('writes AuditLog ASSET_TRANSFER', async () => {
    const asset = await createPostedAsset();
    await transferSvc.transfer(asset.id, {
      transferDate: '2026-05-08', toCustodian: 'Bob', reason: 'x',
    }, userId);
    const log = await prisma.auditLog.findFirst({
      where: { entity: 'fixed_asset', entityId: asset.id, action: 'ASSET_TRANSFER' },
    });
    expect(log).toBeTruthy();
    expect((log!.oldValue as any).custodian).toBe('Alice');
    expect((log!.newValue as any).custodian).toBe('Bob');
  });

  it('multiple transfers stack in history', async () => {
    const asset = await createPostedAsset('A', 'HQ');
    await transferSvc.transfer(asset.id, { transferDate: '2026-05-08', toCustodian: 'B', reason: '1' }, userId);
    await transferSvc.transfer(asset.id, { transferDate: '2026-05-09', toCustodian: 'C', reason: '2' }, userId);
    const history = await prisma.assetTransferHistory.findMany({ where: { assetId: asset.id }, orderBy: { transferDate: 'asc' } });
    expect(history).toHaveLength(2);
    expect(history[0].toCustodian).toBe('B');
    expect(history[1].fromCustodian).toBe('B');
    expect(history[1].toCustodian).toBe('C');
  });

  it('transferId is unique and TRF-prefixed', async () => {
    const asset = await createPostedAsset();
    await transferSvc.transfer(asset.id, { transferDate: '2026-05-08', toCustodian: 'B', reason: 'x' }, userId);
    const history = await prisma.assetTransferHistory.findFirst({ where: { assetId: asset.id } });
    expect(history!.transferId).toMatch(/^TRF-\d+/);
  });
});
```

- [ ] **Step 9.2: Run tests — verify they fail**

```bash
cd apps/api && npx jest src/modules/asset/__tests__/asset-transfer.service
```

Expected: FAIL — `Cannot find module '../asset-transfer.service'`.

- [ ] **Step 9.3: Implement `AssetTransferService`**

Create `apps/api/src/modules/asset/asset-transfer.service.ts`:

```typescript
import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TransferAssetDto } from './dto/transfer-asset.dto';
import { validatePeriodOpen } from '../../utils/period-lock.util';

@Injectable()
export class AssetTransferService {
  private readonly logger = new Logger(AssetTransferService.name);
  private financeCompanyId?: string;

  constructor(private readonly prisma: PrismaService) {}

  private async getFinanceCompanyId(): Promise<string> {
    if (this.financeCompanyId) return this.financeCompanyId;
    const company = await this.prisma.companyInfo.findFirst({
      where: { companyCode: 'FINANCE', deletedAt: null },
    });
    if (!company) throw new Error('FINANCE company not found');
    this.financeCompanyId = company.id;
    return company.id;
  }

  async transfer(assetId: string, dto: TransferAssetDto, transferredById: string) {
    if (!dto.reason || dto.reason.trim().length === 0) {
      throw new BadRequestException('กรุณาระบุเหตุผลการโอน');
    }

    const asset = await this.prisma.fixedAsset.findFirst({ where: { id: assetId, deletedAt: null } });
    if (!asset) throw new NotFoundException('ไม่พบสินทรัพย์');
    if (asset.status !== 'POSTED') {
      throw new BadRequestException('โอนได้เฉพาะสถานะ POSTED');
    }

    const transferDate = new Date(dto.transferDate);
    if (transferDate > new Date()) {
      throw new BadRequestException('วันที่โอนต้องไม่อยู่ในอนาคต');
    }

    // Determine new values (null/undefined means no change)
    const newCustodian = dto.toCustodian !== undefined && dto.toCustodian !== '' ? dto.toCustodian : asset.custodian;
    const newLocation = dto.toLocation !== undefined && dto.toLocation !== '' ? dto.toLocation : asset.location;

    if (newCustodian === asset.custodian && newLocation === asset.location) {
      throw new BadRequestException('no change requested — must change custodian or location');
    }

    // V15 period guard on transferDate
    const financeCompanyId = await this.getFinanceCompanyId();
    try {
      await validatePeriodOpen(this.prisma, transferDate, financeCompanyId);
    } catch (err: any) {
      throw new BadRequestException(`ไม่สามารถโอน: ${err.message ?? 'งวดบัญชีปิดแล้ว'}`);
    }

    return this.prisma.$transaction(async (tx) => {
      const transferId = `TRF-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

      // Insert history
      await tx.assetTransferHistory.create({
        data: {
          transferId,
          assetId: asset.id,
          transferDate,
          fromCustodian: asset.custodian,
          toCustodian: newCustodian,
          fromLocation: asset.location,
          toLocation: newLocation,
          reason: dto.reason,
          transferredById,
        },
      });

      // Update asset
      const updated = await tx.fixedAsset.update({
        where: { id: asset.id },
        data: { custodian: newCustodian, location: newLocation },
      });

      // AuditLog
      await tx.auditLog.create({
        data: {
          userId: transferredById,
          action: 'ASSET_TRANSFER',
          entity: 'fixed_asset',
          entityId: asset.id,
          oldValue: { custodian: asset.custodian, location: asset.location },
          newValue: {
            custodian: newCustodian,
            location: newLocation,
            transferId,
            reason: dto.reason,
          },
        },
      });

      this.logger.log(`[Phase1] TRANSFER asset ${asset.assetCode} → ${transferId}`);
      return updated;
    });
  }
}
```

- [ ] **Step 9.4: Run tests**

```bash
cd apps/api && npx jest src/modules/asset/__tests__/asset-transfer.service
```

Expected: 10 PASS.

- [ ] **Step 9.5: Commit**

```bash
git add apps/api/src/modules/asset/asset-transfer.service.ts \
        apps/api/src/modules/asset/__tests__/asset-transfer.service.spec.ts
git commit -m "feat(asset): AssetTransferService + 10 tests

Custodian/location transfer with no JE (operational only). Inserts
AssetTransferHistory row, updates asset.custodian/location, writes
AuditLog ASSET_TRANSFER. V15 period guard on transferDate. Rejects
if status != POSTED, future date, empty reason, or no change."
```

---

## Task 10: AssetController + AssetModule wiring

**Files:**
- Replace: `apps/api/src/modules/asset/asset.controller.ts`
- Modify: `apps/api/src/modules/asset/asset.module.ts`

- [ ] **Step 10.1: Replace `asset.controller.ts`**

```typescript
import {
  Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards, HttpCode,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { AssetService } from './asset.service';
import { AssetTransferService } from './asset-transfer.service';
import { CreateAssetDto } from './dto/create-asset.dto';
import { UpdateAssetDto } from './dto/update-asset.dto';
import { ReverseAssetDto } from './dto/reverse-asset.dto';
import { TransferAssetDto } from './dto/transfer-asset.dto';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BranchGuard } from '../auth/guards/branch.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AssetCategory, AssetStatus } from '@prisma/client';

@ApiTags('Assets')
@ApiBearerAuth('JWT')
@Controller('assets')
@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)
export class AssetController {
  constructor(
    private readonly assetService: AssetService,
    private readonly transferService: AssetTransferService,
  ) {}

  @Get()
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  findAll(
    @Query() pagination: PaginationDto,
    @Query('branchId') branchId?: string,
    @Query('category') category?: AssetCategory,
    @Query('status') status?: AssetStatus,
    @Query('search') search?: string,
  ) {
    return this.assetService.findAll({ branchId, category, status, search, page: pagination.page, limit: pagination.limit });
  }

  @Get('summary')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  getSummary() {
    return this.assetService.getDepreciationSummary();
  }

  @Get('generate-code')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  generateCode(@Query('category') category?: AssetCategory) {
    return this.assetService.generateAssetCode(category);
  }

  @Get(':id')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  findOne(@Param('id') id: string) {
    return this.assetService.findOne(id);
  }

  @Get(':id/audit')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  audit(@Param('id') id: string) {
    return this.assetService.getAuditTrail(id);
  }

  @Post()
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  create(@Body() dto: CreateAssetDto, @CurrentUser('id') userId: string) {
    return this.assetService.createDraft(dto, userId);
  }

  @Patch(':id')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  update(@Param('id') id: string, @Body() dto: UpdateAssetDto) {
    return this.assetService.update(id, dto);
  }

  @Delete(':id')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  @HttpCode(204)
  delete(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.assetService.delete(id, userId);
  }

  @Post(':id/post')
  @Roles('OWNER', 'FINANCE_MANAGER')
  post(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.assetService.post(id, userId);
  }

  @Post(':id/reverse')
  @Roles('OWNER')
  reverse(
    @Param('id') id: string,
    @Body() dto: ReverseAssetDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.assetService.reverse(id, userId, dto.reason);
  }

  @Post(':id/transfer')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  transfer(
    @Param('id') id: string,
    @Body() dto: TransferAssetDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.transferService.transfer(id, dto, userId);
  }

  @Post(':id/copy')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  copy(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.assetService.copy(id, userId);
  }
}
```

- [ ] **Step 10.2: Update `asset.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { AssetController } from './asset.controller';
import { AssetService } from './asset.service';
import { AssetTransferService } from './asset-transfer.service';
import { JournalModule } from '../journal/journal.module';

@Module({
  imports: [JournalModule],
  controllers: [AssetController],
  providers: [AssetService, AssetTransferService],
  exports: [AssetService, AssetTransferService],
})
export class AssetModule {}
```

- [ ] **Step 10.3: Verify TypeScript compiles**

```bash
./tools/check-types.sh api
```

Expected: 0 errors.

- [ ] **Step 10.4: Smoke-test the API**

Start the dev API server:
```bash
cd apps/api && npm run dev &
```

In another terminal:
```bash
# Login as OWNER (use admin@bestchoice.com / admin1234 from CLAUDE.md test accounts)
TOKEN=$(curl -s -X POST http://localhost:3000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@bestchoice.com","password":"admin1234"}' | jq -r .accessToken)

# Generate a code
curl -H "Authorization: Bearer $TOKEN" 'http://localhost:3000/assets/generate-code?category=EQUIPMENT'
# Expected: { "assetCode": "EQ-001" }

# Create a draft
curl -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  http://localhost:3000/assets \
  -d '{"name":"Test Notebook","category":"EQUIPMENT","basePrice":30000,"usefulLifeMonths":36,"purchaseDate":"2026-05-08","paymentAccount":"11-1201"}'
# Expected: 201 with the new asset incl. assetCode and docNo

# List
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/assets
# Expected: { data: [...], total: 1, page: 1, limit: 50 }

# Summary
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/assets/summary
# Expected: { draft: 1, posted: 0, ... }
```

Stop the server: `kill %1` (or whatever job number).

- [ ] **Step 10.5: Run all backend tests**

```bash
./tools/run-tests.sh --skip-e2e
```

Expected: pass. (E2E coverage in Task 18.)

- [ ] **Step 10.6: Commit**

```bash
git add apps/api/src/modules/asset/asset.controller.ts \
        apps/api/src/modules/asset/asset.module.ts
git commit -m "feat(asset): wire 12 endpoints with role guards

GET list/summary/generate-code/:id/:id/audit · POST create/post/reverse/
transfer/copy · PATCH :id · DELETE :id (soft). Roles per spec — POST
DRAFT→POSTED requires OWNER or FINANCE_MANAGER, reverse requires OWNER.
Smoke-tested against dev API."
```

---

## Task 11: Frontend foundation — types, API, zod, hook, status badge

**Files:**
- Create: `apps/web/src/pages/assets/types.ts`
- Create: `apps/web/src/pages/assets/api.ts`
- Create: `apps/web/src/pages/assets/schema.ts`
- Create: `apps/web/src/pages/assets/hooks/useAssetCalculation.ts`
- Create: `apps/web/src/pages/assets/components/AssetStatusBadge.tsx`
- Modify: `apps/web/src/lib/status-badges.ts` (add `assetStatusMap`)

- [ ] **Step 11.1: Create `types.ts`**

```typescript
// apps/web/src/pages/assets/types.ts
export type AssetStatus = 'DRAFT' | 'POSTED' | 'REVERSED' | 'DISPOSED' | 'WRITTEN_OFF';
export type AssetCategory = 'EQUIPMENT' | 'IMPROVEMENT' | 'FURNITURE' | 'VEHICLE';
export type PaymentMethod = 'CASH' | 'BANK_TRANSFER' | 'QR_EWALLET';
export type WhtFormType = 'PND3' | 'PND53';

export interface Asset {
  id: string;
  assetCode: string;
  docNo: string;
  name: string;
  description: string | null;
  category: AssetCategory;
  branchId: string | null;
  branch: { id: string; name: string } | null;
  basePrice: string;
  shippingCost: string;
  installationCost: string;
  otherCapitalized: string;
  hasVat: boolean;
  vatInclusive: boolean;
  vatAmount: string;
  vatAccount: string | null;
  hasWht: boolean;
  whtBaseAmount: string | null;
  whtRate: string | null;
  whtAmount: string;
  whtAccount: string | null;
  whtFormType: WhtFormType | null;
  purchaseCost: string;
  residualValue: string;
  usefulLifeMonths: number;
  monthlyDepr: string;
  accumulatedDepr: string;
  netBookValue: string;
  coaCostAccount: string | null;
  coaDeprAccount: string | null;
  coaExpenseAccount: string | null;
  purchaseDate: string;
  invoiceDate: string | null;
  warrantyExpire: string | null;
  supplierName: string | null;
  supplierTaxId: string | null;
  invoiceNo: string | null;
  taxInvoiceNo: string | null;
  paymentMethod: PaymentMethod | null;
  paymentAccount: string | null;
  custodian: string | null;
  location: string | null;
  serialNo: string | null;
  prRef: string | null;
  note: string | null;
  status: AssetStatus;
  isOverridden: boolean;
  createdById: string;
  createdBy: { id: string; name: string };
  approverId: string | null;
  approver: { id: string; name: string } | null;
  postedById: string | null;
  postedBy: { id: string; name: string } | null;
  postedAt: string | null;
  reversedById: string | null;
  reversedBy: { id: string; name: string } | null;
  reversedAt: string | null;
  reversalReason: string | null;
  createdAt: string;
  updatedAt: string;
  transferHistory?: AssetTransferHistory[];
}

export interface AssetTransferHistory {
  id: string;
  transferId: string;
  assetId: string;
  transferDate: string;
  fromCustodian: string | null;
  toCustodian: string | null;
  fromLocation: string | null;
  toLocation: string | null;
  reason: string;
  transferredById: string;
  transferredBy: { id: string; name: string };
  createdAt: string;
}

export interface AssetSummary {
  draft: number;
  posted: number;
  reversed: number;
  disposed: number;
  writtenOff: number;
  totalPurchaseCost: number | string;
  totalNetBookValue: number | string;
}

export interface AuditLogEntry {
  id: string;
  action: string;
  entity: string;
  entityId: string;
  oldValue: Record<string, unknown> | null;
  newValue: Record<string, unknown> | null;
  createdAt: string;
  user: { id: string; name: string };
}

export interface ListResponse {
  data: Asset[];
  total: number;
  page: number;
  limit: number;
}

export const CATEGORY_LABEL: Record<AssetCategory, string> = {
  EQUIPMENT: 'อุปกรณ์สำนักงาน',
  IMPROVEMENT: 'ส่วนปรับปรุงอาคาร',
  FURNITURE: 'เครื่องตกแต่งสำนักงาน',
  VEHICLE: 'ยานพาหนะ',
};

export const CATEGORY_COA: Record<AssetCategory, { cost: string; accDepr: string; expense: string }> = {
  EQUIPMENT:   { cost: '12-2101', accDepr: '12-2102', expense: '53-1601' },
  IMPROVEMENT: { cost: '12-2103', accDepr: '12-2104', expense: '53-1602' },
  FURNITURE:   { cost: '12-2105', accDepr: '12-2106', expense: '53-1603' },
  VEHICLE:     { cost: '12-2107', accDepr: '12-2108', expense: '53-1604' },
};

export const CASH_ACCOUNTS: { code: string; name: string }[] = [
  { code: '11-1101', name: 'เงินสด — สุทธินีย์ คงเดช' },
  { code: '11-1102', name: 'เงินสด — เอกนรินทร์ อาคะนาริน' },
  { code: '11-1103', name: 'เงินสด — พนักงานบัญชี' },
  { code: '11-1201', name: 'ธนาคาร KBank' },
  { code: '11-1202', name: 'ธนาคาร SCB (ค่าใช้จ่าย)' },
  { code: '11-1203', name: 'ธนาคาร SCB (ค่าเสื่อม)' },
];
```

- [ ] **Step 11.2: Create `api.ts`**

```typescript
// apps/web/src/pages/assets/api.ts
import api from '@/lib/api';
import type {
  Asset, AssetCategory, AssetStatus, AssetSummary, AuditLogEntry, ListResponse,
} from './types';

export interface ListFilters {
  page?: number;
  limit?: number;
  branchId?: string;
  category?: AssetCategory;
  status?: AssetStatus;
  search?: string;
}

export const assetsApi = {
  list: async (filters: ListFilters): Promise<ListResponse> => {
    const params: Record<string, string | number> = {};
    if (filters.page) params.page = filters.page;
    if (filters.limit) params.limit = filters.limit;
    if (filters.branchId) params.branchId = filters.branchId;
    if (filters.category) params.category = filters.category;
    if (filters.status) params.status = filters.status;
    if (filters.search) params.search = filters.search;
    const { data } = await api.get<ListResponse>('/assets', { params });
    return data;
  },

  getSummary: async (): Promise<AssetSummary> => {
    const { data } = await api.get<AssetSummary>('/assets/summary');
    return data;
  },

  generateCode: async (category?: AssetCategory): Promise<{ assetCode: string }> => {
    const { data } = await api.get<{ assetCode: string }>('/assets/generate-code', {
      params: category ? { category } : {},
    });
    return data;
  },

  getOne: async (id: string): Promise<Asset> => {
    const { data } = await api.get<Asset>(`/assets/${id}`);
    return data;
  },

  getAudit: async (id: string): Promise<AuditLogEntry[]> => {
    const { data } = await api.get<AuditLogEntry[]>(`/assets/${id}/audit`);
    return data;
  },

  create: async (payload: Record<string, unknown>): Promise<Asset> => {
    const { data } = await api.post<Asset>('/assets', payload);
    return data;
  },

  update: async (id: string, payload: Record<string, unknown>): Promise<Asset> => {
    const { data } = await api.patch<Asset>(`/assets/${id}`, payload);
    return data;
  },

  delete: async (id: string): Promise<void> => {
    await api.delete(`/assets/${id}`);
  },

  post: async (id: string): Promise<{ entryNo: string }> => {
    const { data } = await api.post<{ entryNo: string }>(`/assets/${id}/post`);
    return data;
  },

  reverse: async (id: string, reason: string): Promise<{ entryNo: string }> => {
    const { data } = await api.post<{ entryNo: string }>(`/assets/${id}/reverse`, { reason });
    return data;
  },

  transfer: async (id: string, payload: {
    transferDate: string;
    toCustodian?: string;
    toLocation?: string;
    reason: string;
  }): Promise<Asset> => {
    const { data } = await api.post<Asset>(`/assets/${id}/transfer`, payload);
    return data;
  },

  copy: async (id: string): Promise<Asset> => {
    const { data } = await api.post<Asset>(`/assets/${id}/copy`);
    return data;
  },
};
```

- [ ] **Step 11.3: Create `schema.ts` (zod)**

```typescript
// apps/web/src/pages/assets/schema.ts
import { z } from 'zod';

export const assetEntrySchema = z.object({
  // Section 1
  name: z.string().min(1, 'กรุณาระบุชื่อสินทรัพย์').max(150),
  description: z.string().optional(),
  category: z.enum(['EQUIPMENT', 'IMPROVEMENT', 'FURNITURE', 'VEHICLE'], {
    required_error: 'กรุณาเลือกหมวดหมู่',
  }),
  branchId: z.string().optional(),
  custodian: z.string().optional(),
  location: z.string().optional(),
  serialNo: z.string().optional(),
  warrantyExpire: z.string().optional(),

  // Section 2
  basePrice: z.coerce.number().positive('ราคาต้องมากกว่า 0'),
  shippingCost: z.coerce.number().min(0).optional().default(0),
  installationCost: z.coerce.number().min(0).optional().default(0),
  otherCapitalized: z.coerce.number().min(0).optional().default(0),
  hasVat: z.boolean().default(false),
  vatInclusive: z.boolean().default(false),
  vatAccount: z.enum(['11-4101', '11-4102']).optional(),
  hasWht: z.boolean().default(false),
  whtBaseAmount: z.coerce.number().min(0).optional(),
  whtRate: z.coerce.number().min(0).max(0.05, 'อัตรา WHT ต้องไม่เกิน 5%').optional(),
  whtAccount: z.enum(['21-3102', '21-3103']).optional(),
  whtFormType: z.enum(['PND3', 'PND53']).optional(),
  residualValue: z.coerce.number().min(0).optional().default(0),
  usefulLifeMonths: z.coerce.number().int().min(1, 'อายุการใช้งานต้องมากกว่า 0 เดือน'),

  // Section 3
  purchaseDate: z.string().min(1, 'กรุณาระบุวันที่ซื้อ'),
  invoiceDate: z.string().optional(),
  supplierName: z.string().optional(),
  supplierTaxId: z.string().optional(),
  invoiceNo: z.string().optional(),
  taxInvoiceNo: z.string().optional(),
  paymentMethod: z.enum(['CASH', 'BANK_TRANSFER', 'QR_EWALLET']).optional(),
  paymentAccount: z.string().min(1, 'กรุณาเลือกบัญชีจ่ายเงิน'),

  // Section 5
  approverId: z.string().optional(),
  note: z.string().optional(),
}).refine(
  (data) => !data.hasVat || !!data.vatAccount,
  { message: 'กรุณาเลือกบัญชี VAT', path: ['vatAccount'] },
).refine(
  (data) => !data.hasWht || (!!data.whtAccount && data.whtRate !== undefined),
  { message: 'กรุณาเลือกบัญชี WHT และอัตรา', path: ['whtAccount'] },
).refine(
  (data) => data.residualValue <= data.basePrice,
  { message: 'มูลค่าซากต้องไม่เกินราคา', path: ['residualValue'] },
).refine(
  (data) => new Date(data.purchaseDate) <= new Date(),
  { message: 'วันที่ซื้อต้องไม่อยู่ในอนาคต', path: ['purchaseDate'] },
).refine(
  (data) => !data.paymentMethod || data.paymentMethod === 'CASH' || !!data.supplierName,
  { message: 'กรุณาระบุชื่อผู้ขาย', path: ['supplierName'] },
);

export type AssetEntryFormValues = z.infer<typeof assetEntrySchema>;
```

- [ ] **Step 11.4: Create `useAssetCalculation` hook**

```typescript
// apps/web/src/pages/assets/hooks/useAssetCalculation.ts
import { useMemo } from 'react';
import type { AssetEntryFormValues } from '../schema';
import { CATEGORY_COA } from '../types';

interface JournalLine {
  accountCode: string;
  accountName: string;
  debit: number;
  credit: number;
}

export interface CalculationResult {
  basePrice: number;        // adjusted (ex-VAT if inclusive)
  vatAmount: number;
  whtBase: number;
  whtAmount: number;
  purchaseCost: number;     // basePrice + ship + install + other
  totalPayable: number;     // purchaseCost + (excl ? vat : 0) - wht
  monthlyDepr: number;
  netBookValue: number;
  journalLines: JournalLine[];
  isBalanced: boolean;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10000) / 10000;

export function useAssetCalculation(values: Partial<AssetEntryFormValues>): CalculationResult {
  return useMemo(() => {
    const basePriceRaw = Number(values.basePrice) || 0;
    const shipping = Number(values.shippingCost) || 0;
    const installation = Number(values.installationCost) || 0;
    const other = Number(values.otherCapitalized) || 0;
    const residual = Number(values.residualValue) || 0;
    const usefulLife = Number(values.usefulLifeMonths) || 1;

    // VAT
    let basePrice = basePriceRaw;
    let vatAmount = 0;
    if (values.hasVat) {
      if (values.vatInclusive) {
        vatAmount = round2((basePriceRaw * 7) / 107);
        basePrice = round2(basePriceRaw - vatAmount);
      } else {
        vatAmount = round2(basePriceRaw * 0.07);
      }
    }

    // WHT
    const whtBase = Number(values.whtBaseAmount) || installation || 0;
    const whtRate = Number(values.whtRate) || 0;
    const whtAmount = values.hasWht && whtBase > 0 ? round2(whtBase * whtRate) : 0;

    const purchaseCost = round2(basePrice + shipping + installation + other);
    const totalPayable = round2(purchaseCost + (values.vatInclusive ? 0 : vatAmount) - whtAmount);
    const monthlyDepr = round4((purchaseCost - residual) / usefulLife);

    // JE preview lines
    const cat = values.category;
    const coa = cat ? CATEGORY_COA[cat] : null;
    const lines: JournalLine[] = [];
    if (coa && purchaseCost > 0) {
      lines.push({
        accountCode: coa.cost,
        accountName: `Dr ${cat} cost`,
        debit: purchaseCost,
        credit: 0,
      });
    }
    if (values.hasVat && !values.vatInclusive && vatAmount > 0 && values.vatAccount) {
      lines.push({
        accountCode: values.vatAccount,
        accountName: 'Dr ภาษีซื้อ',
        debit: vatAmount,
        credit: 0,
      });
    }
    if (values.hasWht && whtAmount > 0 && values.whtAccount) {
      lines.push({
        accountCode: values.whtAccount,
        accountName: `Cr WHT ${values.whtFormType ?? ''}`,
        debit: 0,
        credit: whtAmount,
      });
    }
    if (values.paymentAccount && totalPayable > 0) {
      lines.push({
        accountCode: values.paymentAccount,
        accountName: 'Cr ชำระเงิน',
        debit: 0,
        credit: totalPayable,
      });
    }

    const totalDr = lines.reduce((s, l) => s + l.debit, 0);
    const totalCr = lines.reduce((s, l) => s + l.credit, 0);
    const isBalanced = round2(totalDr) === round2(totalCr);

    return {
      basePrice, vatAmount, whtBase, whtAmount,
      purchaseCost, totalPayable, monthlyDepr,
      netBookValue: purchaseCost,
      journalLines: lines,
      isBalanced,
    };
  }, [values]);
}
```

- [ ] **Step 11.5: Add `assetStatusMap` to status badges**

Open `apps/web/src/lib/status-badges.ts`. Add (find the existing maps for guidance):

```typescript
export const assetStatusMap: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  DRAFT:       { label: 'ร่าง',        variant: 'secondary' },
  POSTED:      { label: 'ลงบัญชีแล้ว', variant: 'default' },
  REVERSED:    { label: 'กลับรายการ',  variant: 'outline' },
  DISPOSED:    { label: 'จำหน่ายแล้ว', variant: 'outline' },
  WRITTEN_OFF: { label: 'ตัดบัญชี',    variant: 'destructive' },
};
```

- [ ] **Step 11.6: Create `AssetStatusBadge.tsx`**

```typescript
// apps/web/src/pages/assets/components/AssetStatusBadge.tsx
import { Badge } from '@/components/ui/badge';
import { assetStatusMap } from '@/lib/status-badges';
import type { AssetStatus } from '../types';

export function AssetStatusBadge({ status }: { status: AssetStatus }) {
  const cfg = assetStatusMap[status] ?? { label: status, variant: 'outline' as const };
  return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
}
```

- [ ] **Step 11.7: Verify typecheck**

```bash
./tools/check-types.sh web
```

Expected: 0 errors.

- [ ] **Step 11.8: Commit**

```bash
git add apps/web/src/pages/assets/types.ts \
        apps/web/src/pages/assets/api.ts \
        apps/web/src/pages/assets/schema.ts \
        apps/web/src/pages/assets/hooks/useAssetCalculation.ts \
        apps/web/src/pages/assets/components/AssetStatusBadge.tsx \
        apps/web/src/lib/status-badges.ts
git commit -m "feat(asset): frontend foundation — types, API, zod, calc hook

types.ts (Asset, AssetTransferHistory, summary, audit, CATEGORY_COA,
CASH_ACCOUNTS), api.ts (12 endpoint wrappers), schema.ts (zod with V1-V14
client validation), useAssetCalculation (memoized VAT/WHT/totals + JE
preview), AssetStatusBadge + assetStatusMap."
```

---

## Task 12: AssetsListPage

**Files:**
- Create: `apps/web/src/pages/assets/AssetsListPage.tsx`

- [ ] **Step 12.1: Create the list page**

```typescript
// apps/web/src/pages/assets/AssetsListPage.tsx
import { useState, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Search, Copy, Edit, Trash2 } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import DataTable from '@/components/ui/DataTable';
import QueryBoundary from '@/components/QueryBoundary';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import AnimatedCounter from '@/components/ui/animated-counter';
import { useDebounce } from '@/hooks/useDebounce';
import { formatDateShortThai } from '@/utils/formatters';
import { getErrorMessage } from '@/lib/api';
import { assetsApi } from './api';
import { AssetStatusBadge } from './components/AssetStatusBadge';
import { CATEGORY_LABEL, type Asset, type AssetStatus, type AssetCategory } from './types';

function fmt(n: string | number | null | undefined): string {
  if (n == null) return '-';
  return Number(n).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function AssetsListPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const [searchInput, setSearchInput] = useState(searchParams.get('search') ?? '');
  const search = useDebounce(searchInput, 300);
  const status = (searchParams.get('status') ?? '') as AssetStatus | '';
  const category = (searchParams.get('category') ?? '') as AssetCategory | '';
  const page = Number(searchParams.get('page') ?? 1);

  const summaryQuery = useQuery({
    queryKey: ['assets-summary'],
    queryFn: () => assetsApi.getSummary(),
  });

  const listQuery = useQuery({
    queryKey: ['assets', { search, status, category, page }],
    queryFn: () => assetsApi.list({
      search: search || undefined,
      status: status || undefined,
      category: category || undefined,
      page, limit: 50,
    }),
  });

  const [deleteId, setDeleteId] = useState<string | null>(null);
  const deleteMutation = useMutation({
    mutationFn: (id: string) => assetsApi.delete(id),
    onSuccess: () => {
      toast.success('ลบสินทรัพย์สำเร็จ');
      queryClient.invalidateQueries({ queryKey: ['assets'] });
      queryClient.invalidateQueries({ queryKey: ['assets-summary'] });
      setDeleteId(null);
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const copyMutation = useMutation({
    mutationFn: (id: string) => assetsApi.copy(id),
    onSuccess: (newAsset) => {
      toast.success(`คัดลอกเป็น ${newAsset.assetCode}`);
      queryClient.invalidateQueries({ queryKey: ['assets'] });
      navigate(`/assets/${newAsset.id}/edit`);
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const setParam = (key: string, val: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (val) next.set(key, val); else next.delete(key);
    if (key !== 'page') next.delete('page');
    setSearchParams(next);
  };

  const columns = useMemo(() => [
    {
      header: 'รหัส',
      accessor: (row: Asset) => (
        <button onClick={() => navigate(`/assets/${row.id}`)} className="font-mono text-primary hover:underline">
          {row.assetCode}
        </button>
      ),
    },
    { header: 'ชื่อ', accessor: (row: Asset) => row.name },
    { header: 'หมวด', accessor: (row: Asset) => CATEGORY_LABEL[row.category] },
    {
      header: 'ราคาทุน',
      accessor: (row: Asset) => <span className="text-right tabular-nums">{fmt(row.purchaseCost)}</span>,
    },
    { header: 'ผู้ดูแล', accessor: (row: Asset) => row.custodian ?? '-' },
    {
      header: 'วันที่ซื้อ',
      accessor: (row: Asset) => formatDateShortThai(row.purchaseDate),
    },
    {
      header: 'สถานะ',
      accessor: (row: Asset) => <AssetStatusBadge status={row.status} />,
    },
    {
      header: 'จัดการ',
      accessor: (row: Asset) => (
        <div className="flex gap-1">
          {row.status === 'DRAFT' && (
            <>
              <Button size="icon" variant="ghost" onClick={() => navigate(`/assets/${row.id}/edit`)}>
                <Edit className="h-4 w-4" />
              </Button>
              <Button size="icon" variant="ghost" onClick={() => setDeleteId(row.id)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </>
          )}
          <Button size="icon" variant="ghost" onClick={() => copyMutation.mutate(row.id)}>
            <Copy className="h-4 w-4" />
          </Button>
        </div>
      ),
    },
  ], [navigate, copyMutation]);

  const summary = summaryQuery.data;

  return (
    <div className="space-y-4">
      <PageHeader
        title="สินทรัพย์"
        action={
          <Button onClick={() => navigate('/assets/new')}>
            <Plus className="mr-2 h-4 w-4" /> สินทรัพย์ใหม่
          </Button>
        }
      />

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        {[
          { label: 'ร่าง', value: summary?.draft, status: 'DRAFT' },
          { label: 'ลงบัญชี', value: summary?.posted, status: 'POSTED' },
          { label: 'กลับรายการ', value: summary?.reversed, status: 'REVERSED' },
          { label: 'จำหน่าย', value: summary?.disposed, status: 'DISPOSED' },
          { label: 'ตัดบัญชี', value: summary?.writtenOff, status: 'WRITTEN_OFF' },
          { label: 'ยอดทุนรวม (POSTED)', value: summary?.totalPurchaseCost, fmt: true },
          { label: 'NBV รวม', value: summary?.totalNetBookValue, fmt: true },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <div className="text-sm text-muted-foreground">{s.label}</div>
              <div className="text-2xl font-semibold tabular-nums">
                <AnimatedCounter value={Number(s.value ?? 0)} format={s.fmt ? fmt : undefined} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4 flex flex-col md:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-10"
              placeholder="ค้นหาชื่อ / รหัส / serial"
              value={searchInput}
              onChange={(e) => { setSearchInput(e.target.value); setParam('search', e.target.value || null); }}
            />
          </div>
          <Select value={category || 'ALL'} onValueChange={(v) => setParam('category', v === 'ALL' ? null : v)}>
            <SelectTrigger className="w-48"><SelectValue placeholder="หมวด" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">ทุกหมวด</SelectItem>
              <SelectItem value="EQUIPMENT">{CATEGORY_LABEL.EQUIPMENT}</SelectItem>
              <SelectItem value="IMPROVEMENT">{CATEGORY_LABEL.IMPROVEMENT}</SelectItem>
              <SelectItem value="FURNITURE">{CATEGORY_LABEL.FURNITURE}</SelectItem>
              <SelectItem value="VEHICLE">{CATEGORY_LABEL.VEHICLE}</SelectItem>
            </SelectContent>
          </Select>
          <Select value={status || 'ALL'} onValueChange={(v) => setParam('status', v === 'ALL' ? null : v)}>
            <SelectTrigger className="w-48"><SelectValue placeholder="สถานะ" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">ทุกสถานะ</SelectItem>
              <SelectItem value="DRAFT">ร่าง</SelectItem>
              <SelectItem value="POSTED">ลงบัญชีแล้ว</SelectItem>
              <SelectItem value="REVERSED">กลับรายการ</SelectItem>
              <SelectItem value="DISPOSED">จำหน่าย</SelectItem>
              <SelectItem value="WRITTEN_OFF">ตัดบัญชี</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <QueryBoundary query={listQuery}>
        <DataTable columns={columns} data={listQuery.data?.data ?? []} />
        {listQuery.data && listQuery.data.total > 50 && (
          <div className="flex justify-center gap-2 py-4">
            <Button variant="outline" disabled={page <= 1} onClick={() => setParam('page', String(page - 1))}>ก่อนหน้า</Button>
            <span className="self-center">หน้า {page} / {Math.ceil(listQuery.data.total / 50)}</span>
            <Button variant="outline" disabled={page * 50 >= listQuery.data.total} onClick={() => setParam('page', String(page + 1))}>ถัดไป</Button>
          </div>
        )}
      </QueryBoundary>

      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={(open) => !open && setDeleteId(null)}
        title="ลบสินทรัพย์?"
        description="การลบสินทรัพย์จะไม่สามารถกู้คืนได้ (DRAFT เท่านั้น)"
        onConfirm={() => deleteId && deleteMutation.mutate(deleteId)}
      />
    </div>
  );
}
```

- [ ] **Step 12.2: Verify typecheck**

```bash
./tools/check-types.sh web
```

Expected: 0 errors. If any imports fail (e.g., `DataTable`, `PageHeader`, `QueryBoundary` props mismatch), look at an existing list page (`apps/web/src/pages/CustomersPage.tsx`) and align.

- [ ] **Step 12.3: Commit**

```bash
git add apps/web/src/pages/assets/AssetsListPage.tsx
git commit -m "feat(asset): AssetsListPage — list, filters, 7 stat cards

Search debounced 300ms, filter by category/status, paginated 50/page,
copy + edit + delete row actions, AnimatedCounter for stat values."
```

---

## Task 13: AssetEntryPage — Section components 1-3

**Files:**
- Create: `apps/web/src/pages/assets/components/AssetEntrySection1Info.tsx`
- Create: `apps/web/src/pages/assets/components/AssetEntrySection2Cost.tsx`
- Create: `apps/web/src/pages/assets/components/AssetEntrySection3Vendor.tsx`

- [ ] **Step 13.1: Section 1 — Info**

```typescript
// apps/web/src/pages/assets/components/AssetEntrySection1Info.tsx
import { useFormContext } from 'react-hook-form';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import ThaiDateInput from '@/components/ui/ThaiDateInput';
import type { AssetEntryFormValues } from '../schema';
import { CATEGORY_LABEL } from '../types';

interface Props {
  assetCode?: string;  // shown read-only when editing
  branches: { id: string; name: string }[];
}

export function AssetEntrySection1Info({ assetCode, branches }: Props) {
  const { register, setValue, watch, formState: { errors } } = useFormContext<AssetEntryFormValues>();
  const category = watch('category');
  const branchId = watch('branchId');
  const warrantyExpire = watch('warrantyExpire');

  return (
    <Card>
      <CardHeader>
        <CardTitle>1. ข้อมูลสินทรัพย์</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {assetCode && (
          <div>
            <Label>รหัสสินทรัพย์</Label>
            <Input value={assetCode} readOnly className="font-mono bg-muted" />
          </div>
        )}
        <div>
          <Label>ชื่อสินทรัพย์ *</Label>
          <Input {...register('name')} />
          {errors.name && <p className="text-sm text-destructive mt-1">{errors.name.message}</p>}
        </div>
        <div className="md:col-span-2">
          <Label>คำอธิบาย</Label>
          <Textarea {...register('description')} rows={2} />
        </div>
        <div>
          <Label>หมวดหมู่ *</Label>
          <Select value={category} onValueChange={(v) => setValue('category', v as never, { shouldValidate: true })}>
            <SelectTrigger><SelectValue placeholder="เลือกหมวด" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="EQUIPMENT">{CATEGORY_LABEL.EQUIPMENT}</SelectItem>
              <SelectItem value="IMPROVEMENT">{CATEGORY_LABEL.IMPROVEMENT}</SelectItem>
              <SelectItem value="FURNITURE">{CATEGORY_LABEL.FURNITURE}</SelectItem>
              <SelectItem value="VEHICLE">{CATEGORY_LABEL.VEHICLE}</SelectItem>
            </SelectContent>
          </Select>
          {errors.category && <p className="text-sm text-destructive mt-1">{errors.category.message}</p>}
        </div>
        <div>
          <Label>สาขา (ที่วาง)</Label>
          <Select value={branchId ?? 'NONE'} onValueChange={(v) => setValue('branchId', v === 'NONE' ? undefined : v)}>
            <SelectTrigger><SelectValue placeholder="ไม่ระบุ" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="NONE">ไม่ระบุ</SelectItem>
              {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>ผู้ดูแล (custodian)</Label>
          <Input {...register('custodian')} placeholder="ชื่อ" />
        </div>
        <div>
          <Label>ที่ตั้ง</Label>
          <Input {...register('location')} placeholder="ห้อง/ชั้น/สาขา" />
        </div>
        <div>
          <Label>Serial No.</Label>
          <Input {...register('serialNo')} />
        </div>
        <div>
          <Label>วันหมดประกัน</Label>
          <ThaiDateInput
            value={warrantyExpire ?? ''}
            onChange={(v) => setValue('warrantyExpire', v)}
          />
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 13.2: Section 2 — Cost + VAT/WHT**

```typescript
// apps/web/src/pages/assets/components/AssetEntrySection2Cost.tsx
import { useFormContext } from 'react-hook-form';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { AssetEntryFormValues } from '../schema';
import type { CalculationResult } from '../hooks/useAssetCalculation';

const fmt = (n: number) => n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function AssetEntrySection2Cost({ calc }: { calc: CalculationResult }) {
  const { register, setValue, watch, formState: { errors } } = useFormContext<AssetEntryFormValues>();
  const hasVat = watch('hasVat');
  const vatInclusive = watch('vatInclusive');
  const vatAccount = watch('vatAccount');
  const hasWht = watch('hasWht');
  const whtAccount = watch('whtAccount');
  const whtFormType = watch('whtFormType');

  return (
    <Card>
      <CardHeader>
        <CardTitle>2. รายละเอียดต้นทุน + ภาษี</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <Label>ราคาทุน (basePrice) *</Label>
            <Input type="number" step="0.01" {...register('basePrice')} />
            {errors.basePrice && <p className="text-sm text-destructive mt-1">{errors.basePrice.message}</p>}
          </div>
          <div>
            <Label>ค่าขนส่ง</Label>
            <Input type="number" step="0.01" {...register('shippingCost')} />
          </div>
          <div>
            <Label>ค่าติดตั้ง</Label>
            <Input type="number" step="0.01" {...register('installationCost')} />
          </div>
          <div>
            <Label>ค่าใช้จ่ายอื่น (capitalize)</Label>
            <Input type="number" step="0.01" {...register('otherCapitalized')} />
          </div>
        </div>

        {/* VAT */}
        <div className="rounded-lg border p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Switch checked={hasVat} onCheckedChange={(v) => setValue('hasVat', v)} />
            <Label>มี VAT 7%</Label>
          </div>
          {hasVat && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 ml-6">
              <div className="flex items-center gap-2">
                <Switch checked={vatInclusive} onCheckedChange={(v) => setValue('vatInclusive', v)} />
                <Label>ราคารวม VAT แล้ว (inclusive)</Label>
              </div>
              <div>
                <Label>บัญชี VAT</Label>
                <Select value={vatAccount} onValueChange={(v) => setValue('vatAccount', v as never, { shouldValidate: true })}>
                  <SelectTrigger><SelectValue placeholder="เลือก" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="11-4101">11-4101 ภาษีซื้อ (เครดิตได้)</SelectItem>
                    <SelectItem value="11-4102">11-4102 ภาษีซื้อรอเรียกเก็บ</SelectItem>
                  </SelectContent>
                </Select>
                {errors.vatAccount && <p className="text-sm text-destructive mt-1">{errors.vatAccount.message}</p>}
              </div>
              <div>
                <Label>ยอด VAT (คำนวณ)</Label>
                <Input value={fmt(calc.vatAmount)} readOnly className="bg-muted" />
              </div>
            </div>
          )}
        </div>

        {/* WHT */}
        <div className="rounded-lg border p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Switch checked={hasWht} onCheckedChange={(v) => setValue('hasWht', v)} />
            <Label>มี WHT (หัก ณ ที่จ่าย)</Label>
          </div>
          {hasWht && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 ml-6">
              <div>
                <Label>ฐานคำนวณ WHT</Label>
                <Input type="number" step="0.01" {...register('whtBaseAmount')} placeholder="default = ค่าติดตั้ง" />
              </div>
              <div>
                <Label>อัตรา</Label>
                <Select value={watch('whtRate')?.toString() ?? ''} onValueChange={(v) => setValue('whtRate', Number(v) as never, { shouldValidate: true })}>
                  <SelectTrigger><SelectValue placeholder="เลือก" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0.01">1%</SelectItem>
                    <SelectItem value="0.02">2%</SelectItem>
                    <SelectItem value="0.03">3%</SelectItem>
                    <SelectItem value="0.05">5%</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>แบบ ภ.ง.ด.</Label>
                <Select value={whtFormType} onValueChange={(v) => setValue('whtFormType', v as never)}>
                  <SelectTrigger><SelectValue placeholder="เลือก" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PND3">ภ.ง.ด.3 (บุคคล)</SelectItem>
                    <SelectItem value="PND53">ภ.ง.ด.53 (นิติบุคคล)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>บัญชี WHT</Label>
                <Select value={whtAccount} onValueChange={(v) => setValue('whtAccount', v as never, { shouldValidate: true })}>
                  <SelectTrigger><SelectValue placeholder="เลือก" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="21-3102">21-3102 PND3 ค้างจ่าย</SelectItem>
                    <SelectItem value="21-3103">21-3103 PND53 ค้างจ่าย</SelectItem>
                  </SelectContent>
                </Select>
                {errors.whtAccount && <p className="text-sm text-destructive mt-1">{errors.whtAccount.message}</p>}
              </div>
            </div>
          )}
        </div>

        {/* Live totals */}
        <div className="rounded-lg bg-muted p-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <div>
            <div className="text-muted-foreground">ราคาทุนรวม (purchaseCost)</div>
            <div className="text-xl font-semibold tabular-nums">{fmt(calc.purchaseCost)}</div>
          </div>
          <div>
            <div className="text-muted-foreground">ยอดที่ต้องจ่ายจริง</div>
            <div className="text-xl font-semibold tabular-nums">{fmt(calc.totalPayable)}</div>
          </div>
          <div>
            <div className="text-muted-foreground">ค่าเสื่อม/เดือน</div>
            <div className="text-xl font-semibold tabular-nums">{fmt(calc.monthlyDepr)}</div>
          </div>
          <div>
            <div className="text-muted-foreground">NBV เริ่มต้น</div>
            <div className="text-xl font-semibold tabular-nums">{fmt(calc.netBookValue)}</div>
          </div>
        </div>

        {/* Residual + life */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <Label>มูลค่าซาก (residual)</Label>
            <Input type="number" step="0.01" {...register('residualValue')} />
            {errors.residualValue && <p className="text-sm text-destructive mt-1">{errors.residualValue.message}</p>}
          </div>
          <div>
            <Label>อายุการใช้งาน (เดือน) *</Label>
            <Input type="number" step="1" {...register('usefulLifeMonths')} />
            {errors.usefulLifeMonths && <p className="text-sm text-destructive mt-1">{errors.usefulLifeMonths.message}</p>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 13.3: Section 3 — Vendor + Payment**

```typescript
// apps/web/src/pages/assets/components/AssetEntrySection3Vendor.tsx
import { useFormContext } from 'react-hook-form';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import ThaiDateInput from '@/components/ui/ThaiDateInput';
import type { AssetEntryFormValues } from '../schema';
import { CASH_ACCOUNTS } from '../types';

export function AssetEntrySection3Vendor() {
  const { register, setValue, watch, formState: { errors } } = useFormContext<AssetEntryFormValues>();
  const purchaseDate = watch('purchaseDate');
  const invoiceDate = watch('invoiceDate');
  const paymentMethod = watch('paymentMethod');
  const paymentAccount = watch('paymentAccount');

  return (
    <Card>
      <CardHeader>
        <CardTitle>3. ผู้ขาย + การชำระเงิน</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <Label>วันที่ซื้อ *</Label>
          <ThaiDateInput value={purchaseDate} onChange={(v) => setValue('purchaseDate', v, { shouldValidate: true })} />
          {errors.purchaseDate && <p className="text-sm text-destructive mt-1">{errors.purchaseDate.message}</p>}
        </div>
        <div>
          <Label>วันที่ใบกำกับภาษี</Label>
          <ThaiDateInput value={invoiceDate ?? ''} onChange={(v) => setValue('invoiceDate', v)} />
        </div>
        <div>
          <Label>ชื่อผู้ขาย</Label>
          <Input {...register('supplierName')} />
          {errors.supplierName && <p className="text-sm text-destructive mt-1">{errors.supplierName.message}</p>}
        </div>
        <div>
          <Label>เลขผู้เสียภาษี (13 หลัก)</Label>
          <Input {...register('supplierTaxId')} maxLength={13} />
        </div>
        <div>
          <Label>เลขที่ใบสั่งซื้อ / ใบแจ้งหนี้</Label>
          <Input {...register('invoiceNo')} />
        </div>
        <div>
          <Label>เลขใบกำกับภาษี</Label>
          <Input {...register('taxInvoiceNo')} />
        </div>
        <div>
          <Label>วิธีชำระ</Label>
          <Select value={paymentMethod ?? 'CASH'} onValueChange={(v) => setValue('paymentMethod', v as never)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="CASH">เงินสด</SelectItem>
              <SelectItem value="BANK_TRANSFER">โอนเงิน</SelectItem>
              <SelectItem value="QR_EWALLET">QR / e-Wallet</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>บัญชีจ่ายเงิน *</Label>
          <Select value={paymentAccount} onValueChange={(v) => setValue('paymentAccount', v, { shouldValidate: true })}>
            <SelectTrigger><SelectValue placeholder="เลือกบัญชี" /></SelectTrigger>
            <SelectContent>
              {CASH_ACCOUNTS.map((c) => (
                <SelectItem key={c.code} value={c.code}>{c.code} {c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {errors.paymentAccount && <p className="text-sm text-destructive mt-1">{errors.paymentAccount.message}</p>}
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 13.4: Verify typecheck**

```bash
./tools/check-types.sh web
```

Expected: 0 errors. If `Switch` or other shadcn components don't exist locally, use `Checkbox` (likely available) instead — adjust the `<Switch>` usage to `<Checkbox>`.

- [ ] **Step 13.5: Commit**

```bash
git add apps/web/src/pages/assets/components/AssetEntrySection1Info.tsx \
        apps/web/src/pages/assets/components/AssetEntrySection2Cost.tsx \
        apps/web/src/pages/assets/components/AssetEntrySection3Vendor.tsx
git commit -m "feat(asset): EntryPage Sections 1-3 (info, cost, vendor)

react-hook-form + zod, live VAT/WHT calc displayed in muted panel,
ThaiDateInput for date fields, CASH_ACCOUNTS dropdown for paymentAccount."
```

---

## Task 14: AssetEntryPage — Sections 4-5

**Files:**
- Create: `apps/web/src/pages/assets/components/AssetEntrySection4Journal.tsx`
- Create: `apps/web/src/pages/assets/components/AssetEntrySection5Approver.tsx`

- [ ] **Step 14.1: Section 4 — Auto JE preview**

```typescript
// apps/web/src/pages/assets/components/AssetEntrySection4Journal.tsx
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { CalculationResult } from '../hooks/useAssetCalculation';

const fmt = (n: number) => n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function AssetEntrySection4Journal({ calc }: { calc: CalculationResult }) {
  const totalDr = calc.journalLines.reduce((s, l) => s + l.debit, 0);
  const totalCr = calc.journalLines.reduce((s, l) => s + l.credit, 0);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>4. รายการบัญชี (Auto JE Preview)</CardTitle>
        <Badge variant={calc.isBalanced ? 'default' : 'destructive'}>
          {calc.isBalanced ? '✓ Balanced' : '✗ Unbalanced'}
        </Badge>
      </CardHeader>
      <CardContent>
        {calc.journalLines.length === 0 ? (
          <p className="text-sm text-muted-foreground">กรอกข้อมูลใน Section 2 เพื่อดู preview</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left py-2 px-2">รหัสบัญชี</th>
                <th className="text-left py-2 px-2">ชื่อบัญชี</th>
                <th className="text-right py-2 px-2">Debit</th>
                <th className="text-right py-2 px-2">Credit</th>
              </tr>
            </thead>
            <tbody>
              {calc.journalLines.map((line, idx) => (
                <tr key={idx} className="border-b">
                  <td className="py-2 px-2 font-mono">{line.accountCode}</td>
                  <td className="py-2 px-2">{line.accountName}</td>
                  <td className="py-2 px-2 text-right tabular-nums">{line.debit > 0 ? fmt(line.debit) : '-'}</td>
                  <td className="py-2 px-2 text-right tabular-nums">{line.credit > 0 ? fmt(line.credit) : '-'}</td>
                </tr>
              ))}
              <tr className="font-semibold">
                <td className="py-2 px-2" colSpan={2}>รวม</td>
                <td className="py-2 px-2 text-right tabular-nums">{fmt(totalDr)}</td>
                <td className="py-2 px-2 text-right tabular-nums">{fmt(totalCr)}</td>
              </tr>
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 14.2: Section 5 — Approver + SoD warning**

```typescript
// apps/web/src/pages/assets/components/AssetEntrySection5Approver.tsx
import { useFormContext } from 'react-hook-form';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle } from 'lucide-react';
import api from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import type { AssetEntryFormValues } from '../schema';

interface User { id: string; name: string; role: string; }

export function AssetEntrySection5Approver() {
  const { register, setValue, watch } = useFormContext<AssetEntryFormValues>();
  const { user: currentUser } = useAuth();
  const approverId = watch('approverId');

  const usersQuery = useQuery({
    queryKey: ['users', { canApproveAsset: true }],
    queryFn: async () => {
      // Fetch users with OWNER or FINANCE_MANAGER role
      const { data } = await api.get<User[]>('/users', {
        params: { roles: ['OWNER', 'FINANCE_MANAGER'].join(',') },
      });
      return data;
    },
  });

  const sodWarning = approverId && currentUser && approverId === currentUser.id;

  return (
    <Card>
      <CardHeader>
        <CardTitle>5. ผู้รับผิดชอบ + อนุมัติ</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label>ผู้สร้าง</Label>
          <div className="mt-1">
            <Badge variant="outline">{currentUser?.name ?? '-'}</Badge>
          </div>
        </div>
        <div>
          <Label>ผู้อนุมัติ (ผู้ POST)</Label>
          <Select value={approverId ?? 'NONE'} onValueChange={(v) => setValue('approverId', v === 'NONE' ? undefined : v)}>
            <SelectTrigger><SelectValue placeholder="(ผู้ POST จะระบุตอน POST)" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="NONE">— ไม่ระบุล่วงหน้า —</SelectItem>
              {usersQuery.data?.map((u) => (
                <SelectItem key={u.id} value={u.id}>{u.name} ({u.role})</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {sodWarning && (
            <div className="flex items-center gap-2 mt-2 p-2 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 rounded">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <p className="text-sm text-amber-800 dark:text-amber-200">
                คุณกำลังกำหนดให้ตัวเองเป็นผู้อนุมัติ (Segregation of Duties warning)
              </p>
            </div>
          )}
        </div>
        <div>
          <Label>หมายเหตุ</Label>
          <Textarea {...register('note')} rows={3} />
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 14.3: Verify typecheck**

```bash
./tools/check-types.sh web
```

Expected: 0 errors. If `useAuth` returns user with different shape, adjust to actual shape.

- [ ] **Step 14.4: Commit**

```bash
git add apps/web/src/pages/assets/components/AssetEntrySection4Journal.tsx \
        apps/web/src/pages/assets/components/AssetEntrySection5Approver.tsx
git commit -m "feat(asset): EntryPage Sections 4-5 (JE preview, approver)

Section 4: live JE preview table with balanced badge.
Section 5: approver dropdown filtered to OWNER/FINANCE_MANAGER, SoD soft
warning if approver === current user."
```

---

## Task 15: AssetEntryPage — form glue

**Files:**
- Create: `apps/web/src/pages/assets/AssetEntryPage.tsx`

- [ ] **Step 15.1: Create the entry page**

```typescript
// apps/web/src/pages/assets/AssetEntryPage.tsx
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useForm, FormProvider } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft } from 'lucide-react';
import api, { getErrorMessage } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/button';
import QueryBoundary from '@/components/QueryBoundary';
import { assetsApi } from './api';
import { assetEntrySchema, type AssetEntryFormValues } from './schema';
import { useAssetCalculation } from './hooks/useAssetCalculation';
import { AssetEntrySection1Info } from './components/AssetEntrySection1Info';
import { AssetEntrySection2Cost } from './components/AssetEntrySection2Cost';
import { AssetEntrySection3Vendor } from './components/AssetEntrySection3Vendor';
import { AssetEntrySection4Journal } from './components/AssetEntrySection4Journal';
import { AssetEntrySection5Approver } from './components/AssetEntrySection5Approver';

interface Branch { id: string; name: string; }

const today = () => new Date().toISOString().slice(0, 10);

const defaultValues: AssetEntryFormValues = {
  name: '',
  category: 'EQUIPMENT' as never,
  basePrice: 0,
  shippingCost: 0,
  installationCost: 0,
  otherCapitalized: 0,
  hasVat: false,
  vatInclusive: false,
  hasWht: false,
  residualValue: 0,
  usefulLifeMonths: 36,
  purchaseDate: today(),
  paymentAccount: '11-1201',
};

export default function AssetEntryPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isEdit = !!id;

  const branchesQuery = useQuery({
    queryKey: ['branches'],
    queryFn: async () => (await api.get<Branch[]>('/branches')).data,
  });

  const assetQuery = useQuery({
    queryKey: ['asset', id],
    queryFn: () => assetsApi.getOne(id!),
    enabled: isEdit,
  });

  const codeQuery = useQuery({
    queryKey: ['asset-generate-code', 'EQUIPMENT'],
    queryFn: () => assetsApi.generateCode('EQUIPMENT'),
    enabled: !isEdit,
  });

  const form = useForm<AssetEntryFormValues>({
    resolver: zodResolver(assetEntrySchema),
    defaultValues,
  });

  // Hydrate form when editing
  useEffect(() => {
    if (assetQuery.data) {
      const a = assetQuery.data;
      if (a.status !== 'DRAFT') {
        toast.error('แก้ไขได้เฉพาะสถานะ DRAFT');
        navigate(`/assets/${a.id}`, { replace: true });
        return;
      }
      form.reset({
        name: a.name, description: a.description ?? undefined,
        category: a.category, branchId: a.branchId ?? undefined,
        custodian: a.custodian ?? undefined, location: a.location ?? undefined,
        serialNo: a.serialNo ?? undefined,
        warrantyExpire: a.warrantyExpire?.slice(0, 10),
        basePrice: Number(a.basePrice), shippingCost: Number(a.shippingCost),
        installationCost: Number(a.installationCost), otherCapitalized: Number(a.otherCapitalized),
        hasVat: a.hasVat, vatInclusive: a.vatInclusive,
        vatAccount: a.vatAccount as never,
        hasWht: a.hasWht,
        whtBaseAmount: a.whtBaseAmount ? Number(a.whtBaseAmount) : undefined,
        whtRate: a.whtRate ? Number(a.whtRate) : undefined,
        whtAccount: a.whtAccount as never,
        whtFormType: a.whtFormType ?? undefined,
        residualValue: Number(a.residualValue),
        usefulLifeMonths: a.usefulLifeMonths,
        purchaseDate: a.purchaseDate.slice(0, 10),
        invoiceDate: a.invoiceDate?.slice(0, 10),
        supplierName: a.supplierName ?? undefined,
        supplierTaxId: a.supplierTaxId ?? undefined,
        invoiceNo: a.invoiceNo ?? undefined,
        taxInvoiceNo: a.taxInvoiceNo ?? undefined,
        paymentMethod: a.paymentMethod as never,
        paymentAccount: a.paymentAccount ?? '',
        approverId: a.approverId ?? undefined,
        note: a.note ?? undefined,
      });
    }
  }, [assetQuery.data, form, navigate]);

  const watchedValues = form.watch();
  const calc = useAssetCalculation(watchedValues);

  const createMutation = useMutation({
    mutationFn: (payload: AssetEntryFormValues) => assetsApi.create(payload as never),
    onSuccess: (asset) => {
      toast.success(`สร้างสินทรัพย์ ${asset.assetCode} แล้ว`);
      queryClient.invalidateQueries({ queryKey: ['assets'] });
      navigate(`/assets/${asset.id}`);
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const updateMutation = useMutation({
    mutationFn: (payload: AssetEntryFormValues) => assetsApi.update(id!, payload as never),
    onSuccess: () => {
      toast.success('บันทึกแล้ว');
      queryClient.invalidateQueries({ queryKey: ['assets'] });
      queryClient.invalidateQueries({ queryKey: ['asset', id] });
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const postMutation = useMutation({
    mutationFn: () => assetsApi.post(id!),
    onSuccess: (result) => {
      toast.success(`POST แล้ว → ${result.entryNo}`);
      queryClient.invalidateQueries({ queryKey: ['assets'] });
      queryClient.invalidateQueries({ queryKey: ['asset', id] });
      navigate(`/assets/${id}`);
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const onSaveDraft = form.handleSubmit((values) => {
    if (isEdit) updateMutation.mutate(values);
    else createMutation.mutate(values);
  });

  const onSaveAndPost = form.handleSubmit(async (values) => {
    if (isEdit) {
      await updateMutation.mutateAsync(values);
      postMutation.mutate();
    } else {
      const created = await createMutation.mutateAsync(values);
      // Re-route to edit then post (or use create response and post directly)
      // For simplicity, post via direct API call
      try {
        const result = await assetsApi.post(created.id);
        toast.success(`POST แล้ว → ${result.entryNo}`);
        navigate(`/assets/${created.id}`);
      } catch (e) {
        toast.error(getErrorMessage(e));
      }
    }
  });

  const branches = branchesQuery.data ?? [];
  const assetCode = isEdit ? assetQuery.data?.assetCode : codeQuery.data?.assetCode;
  const isLoading = createMutation.isPending || updateMutation.isPending || postMutation.isPending;

  if (isEdit && assetQuery.isLoading) return <div className="p-8">Loading…</div>;

  return (
    <FormProvider {...form}>
      <div className="space-y-4 pb-24">
        <PageHeader
          title={isEdit ? `แก้ไขสินทรัพย์ ${assetCode ?? ''}` : 'สร้างสินทรัพย์ใหม่'}
          action={
            <Button variant="ghost" onClick={() => navigate('/assets')}>
              <ArrowLeft className="mr-2 h-4 w-4" /> กลับ
            </Button>
          }
        />

        <AssetEntrySection1Info assetCode={assetCode} branches={branches} />
        <AssetEntrySection2Cost calc={calc} />
        <AssetEntrySection3Vendor />
        <AssetEntrySection4Journal calc={calc} />
        <AssetEntrySection5Approver />

        {/* Sticky action bar */}
        <div className="fixed bottom-0 left-0 right-0 bg-background border-t p-4 flex justify-end gap-2 z-10">
          <Button variant="outline" onClick={() => navigate('/assets')} disabled={isLoading}>
            ยกเลิก
          </Button>
          <Button variant="secondary" onClick={onSaveDraft} disabled={isLoading}>
            บันทึกร่าง
          </Button>
          <Button onClick={onSaveAndPost} disabled={isLoading || !calc.isBalanced}>
            บันทึก & POST
          </Button>
        </div>
      </div>
    </FormProvider>
  );
}
```

- [ ] **Step 15.2: Verify typecheck**

```bash
./tools/check-types.sh web
```

Expected: 0 errors. If `getErrorMessage` not exported from `@/lib/api`, look at where it lives in the codebase and adjust import.

- [ ] **Step 15.3: Commit**

```bash
git add apps/web/src/pages/assets/AssetEntryPage.tsx
git commit -m "feat(asset): AssetEntryPage — form glue + 5 sections + sticky actions

react-hook-form + zod, hydrates from API in edit mode (reject if status
!= DRAFT), useAssetCalculation drives live VAT/WHT/totals/JE preview,
sticky action bar (cancel + draft + post). POST disabled until JE balanced."
```

---

## Task 16: AssetDetailPage + ReverseAssetDialog + TransferAssetDialog

**Files:**
- Create: `apps/web/src/pages/assets/AssetDetailPage.tsx`
- Create: `apps/web/src/pages/assets/components/ReverseAssetDialog.tsx`
- Create: `apps/web/src/pages/assets/components/TransferAssetDialog.tsx`

- [ ] **Step 16.1: Reverse dialog**

```typescript
// apps/web/src/pages/assets/components/ReverseAssetDialog.tsx
import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';

export function ReverseAssetDialog({
  open, onOpenChange, onConfirm, isPending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (reason: string) => void;
  isPending: boolean;
}) {
  const [reason, setReason] = useState('');
  const valid = reason.trim().length >= 5;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>กลับรายการสินทรัพย์</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            การกลับรายการจะสร้าง JE สวนทาง สถานะเปลี่ยนเป็น REVERSED ไม่สามารถกู้คืนได้
          </p>
          <div>
            <Label>เหตุผล (ขั้นต่ำ 5 ตัวอักษร) *</Label>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>ยกเลิก</Button>
          <Button variant="destructive" disabled={!valid || isPending} onClick={() => onConfirm(reason)}>
            {isPending ? 'กำลังกลับรายการ…' : 'ยืนยันกลับรายการ'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 16.2: Transfer dialog**

```typescript
// apps/web/src/pages/assets/components/TransferAssetDialog.tsx
import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import ThaiDateInput from '@/components/ui/ThaiDateInput';
import type { Asset } from '../types';

export function TransferAssetDialog({
  asset, open, onOpenChange, onConfirm, isPending,
}: {
  asset: Asset;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (payload: { transferDate: string; toCustodian?: string; toLocation?: string; reason: string }) => void;
  isPending: boolean;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [transferDate, setTransferDate] = useState(today);
  const [toCustodian, setToCustodian] = useState(asset.custodian ?? '');
  const [toLocation, setToLocation] = useState(asset.location ?? '');
  const [reason, setReason] = useState('');

  const valid = reason.trim().length >= 5 &&
    (toCustodian !== (asset.custodian ?? '') || toLocation !== (asset.location ?? ''));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>โอนสินทรัพย์ — {asset.assetCode}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>วันที่โอน *</Label>
            <ThaiDateInput value={transferDate} onChange={setTransferDate} />
          </div>
          <div>
            <Label>ผู้ดูแลใหม่</Label>
            <Input value={toCustodian} onChange={(e) => setToCustodian(e.target.value)} placeholder={asset.custodian ?? '-'} />
            <p className="text-xs text-muted-foreground mt-1">ปัจจุบัน: {asset.custodian ?? '-'}</p>
          </div>
          <div>
            <Label>ที่ตั้งใหม่</Label>
            <Input value={toLocation} onChange={(e) => setToLocation(e.target.value)} placeholder={asset.location ?? '-'} />
            <p className="text-xs text-muted-foreground mt-1">ปัจจุบัน: {asset.location ?? '-'}</p>
          </div>
          <div>
            <Label>เหตุผล (ขั้นต่ำ 5 ตัวอักษร) *</Label>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>ยกเลิก</Button>
          <Button disabled={!valid || isPending} onClick={() => onConfirm({
            transferDate,
            toCustodian: toCustodian !== (asset.custodian ?? '') ? toCustodian : undefined,
            toLocation: toLocation !== (asset.location ?? '') ? toLocation : undefined,
            reason,
          })}>
            {isPending ? 'กำลังโอน…' : 'ยืนยันโอน'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 16.3: Detail page**

```typescript
// apps/web/src/pages/assets/AssetDetailPage.tsx
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, MoreVertical, Edit, Copy, ArrowRightLeft, Undo2, Trash2 } from 'lucide-react';
import { assetsApi } from './api';
import { AssetStatusBadge } from './components/AssetStatusBadge';
import { ReverseAssetDialog } from './components/ReverseAssetDialog';
import { TransferAssetDialog } from './components/TransferAssetDialog';
import { CATEGORY_LABEL } from './types';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import QueryBoundary from '@/components/QueryBoundary';
import { formatDateShortThai } from '@/utils/formatters';
import { getErrorMessage } from '@/lib/api';

const fmt = (n: string | number | null | undefined) => {
  if (n == null) return '-';
  return Number(n).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

export default function AssetDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const assetQuery = useQuery({
    queryKey: ['asset', id],
    queryFn: () => assetsApi.getOne(id!),
  });

  const auditQuery = useQuery({
    queryKey: ['asset-audit', id],
    queryFn: () => assetsApi.getAudit(id!),
  });

  const [showReverse, setShowReverse] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const [showDelete, setShowDelete] = useState(false);

  const reverseMutation = useMutation({
    mutationFn: (reason: string) => assetsApi.reverse(id!, reason),
    onSuccess: (r) => {
      toast.success(`กลับรายการแล้ว → ${r.entryNo}`);
      queryClient.invalidateQueries({ queryKey: ['asset', id] });
      queryClient.invalidateQueries({ queryKey: ['assets'] });
      setShowReverse(false);
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const transferMutation = useMutation({
    mutationFn: (payload: Parameters<typeof assetsApi.transfer>[1]) => assetsApi.transfer(id!, payload),
    onSuccess: () => {
      toast.success('โอนสินทรัพย์แล้ว');
      queryClient.invalidateQueries({ queryKey: ['asset', id] });
      setShowTransfer(false);
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const copyMutation = useMutation({
    mutationFn: () => assetsApi.copy(id!),
    onSuccess: (a) => {
      toast.success(`คัดลอกเป็น ${a.assetCode}`);
      navigate(`/assets/${a.id}/edit`);
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const deleteMutation = useMutation({
    mutationFn: () => assetsApi.delete(id!),
    onSuccess: () => {
      toast.success('ลบแล้ว');
      navigate('/assets');
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const postMutation = useMutation({
    mutationFn: () => assetsApi.post(id!),
    onSuccess: (r) => {
      toast.success(`POST แล้ว → ${r.entryNo}`);
      queryClient.invalidateQueries({ queryKey: ['asset', id] });
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title={
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate('/assets')}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <span>{assetQuery.data?.assetCode ?? '...'}</span>
            {assetQuery.data && <AssetStatusBadge status={assetQuery.data.status} />}
          </div>
        }
        action={
          assetQuery.data && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon"><MoreVertical className="h-4 w-4" /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {assetQuery.data.status === 'DRAFT' && (
                  <>
                    <DropdownMenuItem onClick={() => navigate(`/assets/${id}/edit`)}>
                      <Edit className="mr-2 h-4 w-4" /> แก้ไข
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => postMutation.mutate()}>
                      <ArrowRightLeft className="mr-2 h-4 w-4" /> POST
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setShowDelete(true)} className="text-destructive">
                      <Trash2 className="mr-2 h-4 w-4" /> ลบ
                    </DropdownMenuItem>
                  </>
                )}
                {assetQuery.data.status === 'POSTED' && (
                  <>
                    <DropdownMenuItem onClick={() => setShowTransfer(true)}>
                      <ArrowRightLeft className="mr-2 h-4 w-4" /> โอนผู้ดูแล/ที่ตั้ง
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setShowReverse(true)} className="text-destructive">
                      <Undo2 className="mr-2 h-4 w-4" /> กลับรายการ
                    </DropdownMenuItem>
                  </>
                )}
                <DropdownMenuItem onClick={() => copyMutation.mutate()}>
                  <Copy className="mr-2 h-4 w-4" /> คัดลอกเป็น DRAFT ใหม่
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )
        }
      />

      <QueryBoundary query={assetQuery}>
        {assetQuery.data && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 space-y-4">
              <Card>
                <CardHeader><CardTitle>{assetQuery.data.name}</CardTitle></CardHeader>
                <CardContent>
                  <dl className="grid grid-cols-2 gap-3 text-sm">
                    <div><dt className="text-muted-foreground">รหัส</dt><dd className="font-mono">{assetQuery.data.assetCode}</dd></div>
                    <div><dt className="text-muted-foreground">Doc No.</dt><dd className="font-mono">{assetQuery.data.docNo}</dd></div>
                    <div><dt className="text-muted-foreground">หมวด</dt><dd>{CATEGORY_LABEL[assetQuery.data.category]}</dd></div>
                    <div><dt className="text-muted-foreground">วันที่ซื้อ</dt><dd>{formatDateShortThai(assetQuery.data.purchaseDate)}</dd></div>
                    <div><dt className="text-muted-foreground">ราคาทุน</dt><dd className="tabular-nums">{fmt(assetQuery.data.purchaseCost)}</dd></div>
                    <div><dt className="text-muted-foreground">VAT</dt><dd className="tabular-nums">{fmt(assetQuery.data.vatAmount)}</dd></div>
                    <div><dt className="text-muted-foreground">WHT</dt><dd className="tabular-nums">{fmt(assetQuery.data.whtAmount)}</dd></div>
                    <div><dt className="text-muted-foreground">ค่าเสื่อม/เดือน</dt><dd className="tabular-nums">{fmt(assetQuery.data.monthlyDepr)}</dd></div>
                    <div><dt className="text-muted-foreground">NBV</dt><dd className="tabular-nums">{fmt(assetQuery.data.netBookValue)}</dd></div>
                    <div><dt className="text-muted-foreground">ผู้ดูแล</dt><dd>{assetQuery.data.custodian ?? '-'}</dd></div>
                    <div><dt className="text-muted-foreground">ที่ตั้ง</dt><dd>{assetQuery.data.location ?? '-'}</dd></div>
                    <div><dt className="text-muted-foreground">Serial</dt><dd>{assetQuery.data.serialNo ?? '-'}</dd></div>
                  </dl>
                </CardContent>
              </Card>

              {(assetQuery.data.transferHistory?.length ?? 0) > 0 && (
                <Card>
                  <CardHeader><CardTitle>ประวัติการโอน</CardTitle></CardHeader>
                  <CardContent>
                    <ul className="space-y-2 text-sm">
                      {assetQuery.data.transferHistory!.map((h) => (
                        <li key={h.id} className="border-l-2 border-primary pl-3 py-1">
                          <div className="font-medium">{formatDateShortThai(h.transferDate)} — {h.transferredBy.name}</div>
                          <div className="text-muted-foreground">
                            {h.fromCustodian !== h.toCustodian && <span>ผู้ดูแล: {h.fromCustodian} → {h.toCustodian} </span>}
                            {h.fromLocation !== h.toLocation && <span>ที่ตั้ง: {h.fromLocation} → {h.toLocation}</span>}
                          </div>
                          <div className="text-xs italic">{h.reason}</div>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}
            </div>

            <div className="space-y-4">
              <Card>
                <CardHeader><CardTitle>Audit Trail</CardTitle></CardHeader>
                <CardContent>
                  {auditQuery.data?.length ? (
                    <ul className="space-y-2 text-xs">
                      {auditQuery.data.map((log) => (
                        <li key={log.id} className="border-l-2 border-muted pl-2">
                          <div className="font-medium">{log.action}</div>
                          <div className="text-muted-foreground">{log.user.name} · {new Date(log.createdAt).toLocaleString('th-TH')}</div>
                        </li>
                      ))}
                    </ul>
                  ) : <p className="text-sm text-muted-foreground">ยังไม่มีประวัติ</p>}
                </CardContent>
              </Card>
            </div>
          </div>
        )}
      </QueryBoundary>

      {assetQuery.data && (
        <>
          <ReverseAssetDialog
            open={showReverse}
            onOpenChange={setShowReverse}
            onConfirm={(reason) => reverseMutation.mutate(reason)}
            isPending={reverseMutation.isPending}
          />
          <TransferAssetDialog
            asset={assetQuery.data}
            open={showTransfer}
            onOpenChange={setShowTransfer}
            onConfirm={(p) => transferMutation.mutate(p)}
            isPending={transferMutation.isPending}
          />
          <ConfirmDialog
            open={showDelete}
            onOpenChange={setShowDelete}
            title="ลบสินทรัพย์?"
            description="ลบได้เฉพาะสถานะ DRAFT ไม่สามารถกู้คืนได้"
            onConfirm={() => deleteMutation.mutate()}
          />
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 16.4: Verify typecheck**

```bash
./tools/check-types.sh web
```

Expected: 0 errors. If `DropdownMenu` or `Dialog` components don't exist in the project's shadcn install, find equivalents (`apps/web/src/components/ui/`).

- [ ] **Step 16.5: Commit**

```bash
git add apps/web/src/pages/assets/AssetDetailPage.tsx \
        apps/web/src/pages/assets/components/ReverseAssetDialog.tsx \
        apps/web/src/pages/assets/components/TransferAssetDialog.tsx
git commit -m "feat(asset): AssetDetailPage + reverse/transfer dialogs

Read-only summary, action menu (DRAFT: edit/post/delete · POSTED:
transfer/reverse · all: copy), transfer history timeline, audit trail
sidebar. Dialogs require min-5-char reason."
```

---

## Task 17: Routes + Nav + smoke render

**Files:**
- Modify: `apps/web/src/App.tsx` (or wherever routes live)
- Modify: nav config (typically `apps/web/src/components/MainLayout.tsx` or similar)

- [ ] **Step 17.1: Find the router file**

```bash
grep -l "Routes\|<Route" apps/web/src/App.tsx apps/web/src/main.tsx 2>/dev/null
```

Or:
```bash
find apps/web/src -name '*.tsx' -exec grep -l '<Route' {} \;
```

- [ ] **Step 17.2: Add 4 lazy routes**

In the router file, add (alongside existing lazy imports):

```typescript
const AssetsListPage = lazy(() => import('./pages/assets/AssetsListPage'));
const AssetEntryPage = lazy(() => import('./pages/assets/AssetEntryPage'));
const AssetDetailPage = lazy(() => import('./pages/assets/AssetDetailPage'));
```

In the routes block (inside `<Routes>` or similar):

```tsx
<Route path="/assets" element={<ProtectedRoute><MainLayout><AssetsListPage /></MainLayout></ProtectedRoute>} />
<Route path="/assets/new" element={<ProtectedRoute><MainLayout><AssetEntryPage /></MainLayout></ProtectedRoute>} />
<Route path="/assets/:id/edit" element={<ProtectedRoute><MainLayout><AssetEntryPage /></MainLayout></ProtectedRoute>} />
<Route path="/assets/:id" element={<ProtectedRoute><MainLayout><AssetDetailPage /></MainLayout></ProtectedRoute>} />
```

(Adapt to the existing route wrapping pattern — match how other pages declare routes.)

- [ ] **Step 17.3: Add nav menu item**

Find the sidebar/main nav. Search:
```bash
grep -rln "label: 'รายจ่าย'\|label: 'ลูกค้า'" apps/web/src
```

Add an entry like:
```typescript
{ label: 'สินทรัพย์', icon: Briefcase, path: '/assets', roles: ['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT'] }
```

(Adjust to the nav schema — could be a separate file like `nav-config.ts` or inline in MainLayout.)

- [ ] **Step 17.4: Smoke-test**

Start dev servers:
```bash
npm run dev
```

In a browser:
1. Login as `admin@bestchoice.com / admin1234`
2. Navigate to `/assets` — list page should render with empty state + 7 stat cards (all 0)
3. Click "สินทรัพย์ใหม่" — entry page renders 5 sections
4. Fill in: name "Notebook A", category EQUIPMENT, basePrice 30000, usefulLifeMonths 36, purchaseDate today, paymentAccount 11-1201
5. Verify Section 4 JE preview shows balanced (Dr 12-2101 30000 / Cr 11-1201 30000)
6. Click "บันทึกร่าง" → toast success, redirects to detail page
7. From detail page, action menu: POST → toast `POST แล้ว → JE-XXXX-XXXXX`, status changes to POSTED
8. Action menu: คัดลอกเป็น DRAFT → redirects to edit page with new code

If anything errors visually, adjust the nav/route wiring. Don't write E2E yet — that's Task 18.

- [ ] **Step 17.5: Commit**

```bash
git add apps/web/src/App.tsx  # or whatever router file
git add <nav config file>
git commit -m "feat(asset): wire 4 routes + sidebar nav item

/assets, /assets/new, /assets/:id/edit, /assets/:id all lazy-loaded
under ProtectedRoute + MainLayout. Manual smoke-test passed."
```

---

## Task 18: E2E tests + final verification

**Files:**
- Create: `apps/web/e2e/assets-create-post.spec.ts`
- Create: `apps/web/e2e/assets-reverse.spec.ts`

- [ ] **Step 18.1: Read an existing E2E spec for patterns**

```bash
cat apps/web/e2e/login.spec.ts | head -50
ls apps/web/e2e/
```

Pick a similar list+form spec (e.g., `customers.spec.ts` if it exists) and copy the auth/setup pattern.

- [ ] **Step 18.2: Create `assets-create-post.spec.ts`**

```typescript
// apps/web/e2e/assets-create-post.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Asset create + post', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/อีเมล/i).fill('finance@bestchoice.com');
    await page.getByLabel(/รหัสผ่าน/i).fill('admin1234');
    await page.getByRole('button', { name: /เข้าสู่ระบบ/i }).click();
    await page.waitForURL('**/'); // redirected to dashboard
  });

  test('creates a new asset and posts it', async ({ page }) => {
    await page.goto('/assets');
    await page.getByRole('button', { name: /สินทรัพย์ใหม่/i }).click();
    await page.waitForURL('**/assets/new');

    // Section 1
    await page.getByLabel(/ชื่อสินทรัพย์/i).fill('E2E Test Notebook');
    // category default = EQUIPMENT, OK

    // Section 2
    await page.getByLabel(/ราคาทุน/i).fill('30000');
    await page.getByLabel(/อายุการใช้งาน/i).fill('36');

    // Section 3 — purchaseDate already defaults to today; paymentAccount default 11-1201
    // (verify ThaiDateInput has today)

    // Submit & POST
    await page.getByRole('button', { name: /บันทึก & POST/i }).click();

    // Expect toast and redirect to detail page
    await expect(page.getByText(/POST แล้ว/i)).toBeVisible({ timeout: 5000 });
    await page.waitForURL('**/assets/**');

    // Status badge shows POSTED
    await expect(page.getByText(/ลงบัญชีแล้ว/)).toBeVisible();
  });
});
```

- [ ] **Step 18.3: Create `assets-reverse.spec.ts`**

```typescript
// apps/web/e2e/assets-reverse.spec.ts
import { test, expect } from '@playwright/test';

test('reverse a POSTED asset', async ({ page }) => {
  // Login as OWNER (only OWNER can reverse)
  await page.goto('/login');
  await page.getByLabel(/อีเมล/i).fill('admin@bestchoice.com');
  await page.getByLabel(/รหัสผ่าน/i).fill('admin1234');
  await page.getByRole('button', { name: /เข้าสู่ระบบ/i }).click();

  // Create + post first
  await page.goto('/assets/new');
  await page.getByLabel(/ชื่อสินทรัพย์/i).fill('E2E Reverse Test');
  await page.getByLabel(/ราคาทุน/i).fill('5000');
  await page.getByLabel(/อายุการใช้งาน/i).fill('12');
  await page.getByRole('button', { name: /บันทึก & POST/i }).click();
  await page.waitForURL('**/assets/**', { timeout: 10000 });

  // Open action menu and reverse
  await page.getByRole('button').filter({ hasText: '' }).last().click();  // MoreVertical
  await page.getByRole('menuitem', { name: /กลับรายการ/i }).click();

  // Confirm dialog
  await page.getByLabel(/เหตุผล/i).fill('E2E test rollback');
  await page.getByRole('button', { name: /ยืนยันกลับรายการ/i }).click();

  await expect(page.getByText(/กลับรายการแล้ว/i)).toBeVisible({ timeout: 5000 });
  await expect(page.getByText('กลับรายการ')).toBeVisible();  // status badge
});
```

> Note: E2E selectors (`getByLabel(/...)`, etc.) may need adjustment. Run with `--headed` to inspect what the page actually renders.

- [ ] **Step 18.4: Run E2E**

```bash
cd apps/web && npx playwright test e2e/assets-create-post.spec.ts e2e/assets-reverse.spec.ts --headed
```

If they fail because:
- Selector mismatch → use Playwright's recorder (`npx playwright codegen`) to find the right selector
- Auth redirect URL different → fix the `waitForURL` patterns
- Sticky action bar covers buttons → scroll into view first

Iterate until both pass.

- [ ] **Step 18.5: Run full test suite + final smoke**

```bash
./tools/check-types.sh all
./tools/run-tests.sh --skip-e2e
cd apps/api && npx jest src/modules/asset src/modules/journal/cpa-templates/asset-purchase
cd apps/web && npx playwright test e2e/assets-create-post.spec.ts e2e/assets-reverse.spec.ts
```

Expected: all green.

- [ ] **Step 18.6: Commit + final summary**

```bash
git add apps/web/e2e/assets-create-post.spec.ts apps/web/e2e/assets-reverse.spec.ts
git commit -m "test(asset): E2E for create+post and reverse

Login as FINANCE_MANAGER → create draft → POST → verify status.
Login as OWNER → create+post → reverse with reason → verify REVERSED."
```

```bash
git log --oneline -20  # verify all 18 task commits present
```

---

## Self-Review

**1. Spec coverage:** 

| Spec section | Task |
|--------------|------|
| Schema (FixedAsset, AssetCategory, AssetStatus, AssetTransferHistory) | Task 1 |
| Migration plan (wipe + reseed) | Task 1 (migration), Task 2 (CLI) |
| Workflow (DRAFT → POSTED → REVERSED + can_post + V15) | Task 7 |
| SoD soft warning | Task 14 (Section 5 frontend) + Task 7 backend |
| AssetPurchaseTemplate (4 categories, VAT inclusive/exclusive, WHT, idempotent) | Task 4 |
| AssetPurchaseReverseTemplate (mirror, no-touch original) | Task 5 |
| 12 API endpoints + role matrix | Task 10 |
| 6 DTOs | Task 3 |
| Copy endpoint detail | Task 8 |
| Validation V1-V14 | Task 3 (server DTO) + Task 11 (zod schema) |
| Validation V15 | Task 7 (backend) |
| Audit trail conventions | Tasks 7, 8, 9 (writes), Task 16 (read sidebar) |
| 33 unit tests asset.service | Tasks 6 (15), 7 (10), 8 (4) ≈ 29 — **add 4 more in execution if possible** |
| 10 unit tests asset-transfer | Task 9 |
| 12 + 8 unit tests templates | Tasks 4, 5 |
| 4 frontend routes | Task 17 |
| 5-section entry form | Tasks 13-15 |
| Detail page + transfer/reverse dialogs | Task 16 |
| 7-stat cards on list | Task 12 |
| 2 E2E specs | Task 18 |

**2. Placeholder scan:** No "TBD" / "implement later" / vague handwave. Every step has explicit code, command, or expected output.

**3. Type consistency:** `AssetCategory` referenced as `'EQUIPMENT' | 'IMPROVEMENT' | 'FURNITURE' | 'VEHICLE'` in: Prisma enum (Task 1), DTO (Task 3), template chart (Task 4), service (Task 6), zod schema (Task 11), types.ts (Task 11), select dropdown (Task 13). All match.

`AssetStatus` referenced as `'DRAFT' | 'POSTED' | 'REVERSED' | 'DISPOSED' | 'WRITTEN_OFF'` consistently.

JE template signatures (`{ assetId, postedById }` for purchase, `{ assetId, reversedById, reason }` for reverse) match between definition (Tasks 4, 5) and usage in service (Task 7).

API method signatures in `assetsApi` (Task 11) match controller endpoint shapes (Task 10).

**4. Known soft spots & mitigations:**

- **`createAndPost` `tx` parameter:** Task 4 notes that if `journal-auto.service.ts:35` doesn't accept `tx`, the implementer must adjust. This is a known interop point.
- **`PaginationDto` shape:** controller uses `PaginationDto` (Task 10). Confirm `apps/api/src/common/dto/pagination.dto.ts` has `page` and `limit` fields. If not, adjust the import path or replicate the shape.
- **Prisma `accountingPeriod` model:** the V15 test (Task 7) assumes a specific model + composite key. If the actual schema uses different field names, the test must adapt — this is flagged inline in Step 7.1.
- **shadcn components missing locally:** Tasks 13, 16 may need `Switch` → `Checkbox` swap, `DropdownMenu` could be missing. Notes inline.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-08-asset-module-phase1.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. ~18 task cycles, each with build + test + commit verification.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**





