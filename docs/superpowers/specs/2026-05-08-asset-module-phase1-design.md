# Asset Module Phase 1 — Foundation & Entry — Design Spec

**Date:** 2026-05-08
**Author:** Brainstorming session
**Source:** `Handover.md` (Asset Acquisition System v3.4 prototype) — adopted **100%** as source of truth, adapted to BESTCHOICE conventions
**Phase:** 1 of 3 (Foundation + Entry workflow)
**Scope:** FINANCE company only; SHOP company deferred to a future spec
**Verification:** All 11 design assumptions cross-checked against actual BESTCHOICE code (see "Verification" section)

---

## Background

The user provided an external React + in-memory prototype (`Handover.md`, ~4,099 lines, 11 pages, 41 components) for a fixed-asset acquisition system: purchase → POST → depreciate → dispose. BESTCHOICE already has a minimal `FixedAsset` module (Phase A.5c, PR #743) but lacks entry workflow, vendor capture, VAT/WHT, custodian transfer, approval, and reverse-JE.

This spec ports **Phase 1** (Foundation + Entry) of the prototype into BESTCHOICE. Phases 2 (Lifecycle: Depreciation/Disposal/Transfer ops) and Phase 3 (Reports: Register/Schedule/Journal/Summary/Audit pages) are deferred to follow-up specs.

**Existing code disposition:** Anything in the current `apps/api/src/modules/asset/` module that doesn't match the new design is replaced. Schema is wiped and reseeded (production records expected = 0; one-shot Cloud Run job after deploy).

---

## Goals

1. Replace the minimal `FixedAsset` schema with a richer model matching the prototype: cost breakdown, VAT/WHT capture, vendor info, custodian/location, status workflow, account snapshots.
2. Add 2-step `DRAFT → POSTED` workflow with optional `REVERSED` reversal, gated by V15 period lock.
3. Auto-post a Journal Entry on POST via a new `AssetPurchaseTemplate`, mirroring it on reverse via `AssetPurchaseReverseTemplate`.
4. Track custodian/location transfers (no JE — operational only) with full history.
5. Deliver 4 frontend routes: list, new, edit, detail.

Phase 1 does **not** ship: depreciation manual run UI, disposal UI, transfer UI as a dedicated page (transfer endpoint only), Register/Schedule/Audit reports.

---

## Non-Goals

- **SHOP-side asset accounting** — deferred. SHOP cannot claim VAT input; future spec covers SHOP-only path.
- **Multi-tier approval (DRAFT → READY → APPROVED → POSTED)** — Handover prototype simplified to `DRAFT → POSTED` with `can_post`; we follow that.
- **Hard-block SoD** — only soft warning when `createdById === postedById` (matches owner preference).
- **PeriodsPage UI** — reuse existing `validatePeriodOpen` from accounting service; no new period management UI.
- **Cost allocation (1 invoice → multiple assets pro-rata)** — explicitly out of scope per Handover §1.5.
- **Attachment upload** — out of scope per Handover §1.5; `taxInvoiceNo` field captures evidence reference only.

---

## Architecture

### Module layout

```
apps/api/src/modules/asset/                 [REPLACE existing]
├── asset.controller.ts                     — CRUD + post/reverse/transfer endpoints
├── asset.service.ts                        — DRAFT/POST/REVERSE workflow, list, detail
├── asset-transfer.service.ts               — custodian/location transfer + history
├── dto/
│   ├── create-asset.dto.ts
│   ├── update-asset.dto.ts
│   ├── post-asset.dto.ts
│   ├── reverse-asset.dto.ts
│   └── transfer-asset.dto.ts
└── __tests__/
    ├── asset.service.spec.ts
    └── asset-transfer.service.spec.ts

apps/api/src/modules/journal/cpa-templates/
├── asset-purchase.template.ts              [NEW]
├── asset-purchase-reverse.template.ts      [NEW]
├── depreciation.template.ts                [keep — Phase 2 will refactor]
└── asset-disposal.template.ts              [keep — Phase 2 will refactor]

apps/web/src/pages/assets/                  [NEW]
├── AssetsListPage.tsx                      — list + filters + 7 stat cards
├── AssetEntryPage.tsx                      — 5-section form (create/edit)
├── AssetDetailPage.tsx                     — read-only + action menu
├── components/
│   ├── AssetEntrySection1Info.tsx
│   ├── AssetEntrySection2Cost.tsx
│   ├── AssetEntrySection3Vendor.tsx
│   ├── AssetEntrySection4Journal.tsx
│   ├── AssetEntrySection5Approver.tsx
│   ├── AssetStatusBadge.tsx
│   └── ReverseAssetDialog.tsx
└── hooks/
    └── useAssetCalculation.ts              — VAT/WHT/totals memoized
```

### Multi-entity scope

Phase 1 covers **FINANCE only**. All asset journal entries post to the FINANCE company (`companyCode='FINANCE'`). `branchId` on `FixedAsset` is optional and represents physical placement (which SHOP branch the equipment lives at), not legal ownership. SHOP-owned assets (e.g., shop fixtures) are deferred to a separate spec.

---

## Schema

```prisma
// REPLACE existing FixedAsset enum
enum AssetStatus {
  DRAFT       // ร่าง
  POSTED      // ลง JE แล้ว
  REVERSED    // กลับรายการ
  DISPOSED    // จำหน่ายแล้ว (Phase 2)
  WRITTEN_OFF // ตัดบัญชี (Phase 2)
}

// REPLACE existing AssetCategory enum (rename values)
enum AssetCategory {
  EQUIPMENT     // อุปกรณ์สำนักงาน → 12-2101 / 12-2102 / 53-1601
  IMPROVEMENT   // ปรับปรุงอาคาร → 12-2103 / 12-2104 / 53-1602
  FURNITURE     // เครื่องตกแต่ง → 12-2105 / 12-2106 / 53-1603
  VEHICLE       // ยานพาหนะ → 12-2107 / 12-2108 / 53-1604
}

// REPLACE existing FixedAsset
model FixedAsset {
  id              String  @id @default(uuid())
  assetCode       String  @unique @map("asset_code")    // COMP-001 (auto-generated)
  docNo           String  @unique @map("doc_no")        // ASSET-2605-0001
  name            String
  description     String?
  category        AssetCategory
  branchId        String? @map("branch_id")             // optional placement

  // Cost breakdown (Handover §13 Section 2)
  basePrice           Decimal @map("base_price") @db.Decimal(12, 2)
  shippingCost        Decimal @default(0) @map("shipping_cost") @db.Decimal(12, 2)
  installationCost    Decimal @default(0) @map("installation_cost") @db.Decimal(12, 2)
  otherCapitalized    Decimal @default(0) @map("other_capitalized") @db.Decimal(12, 2)

  // VAT
  hasVat        Boolean @default(false) @map("has_vat")
  vatInclusive  Boolean @default(false) @map("vat_inclusive")
  vatAmount     Decimal @default(0) @map("vat_amount") @db.Decimal(12, 2)
  vatAccount    String? @map("vat_account")             // 11-4101 (เครดิตได้) | 11-4102 (รอเรียกเก็บ)

  // WHT (Handover Fix #1.1 — base on installation cost or custom)
  hasWht        Boolean  @default(false) @map("has_wht")
  whtBaseAmount Decimal? @map("wht_base_amount") @db.Decimal(12, 2)
  whtRate       Decimal? @map("wht_rate") @db.Decimal(5, 4)
  whtAmount     Decimal  @default(0) @map("wht_amount") @db.Decimal(12, 2)
  whtAccount    String?  @map("wht_account")            // 21-3102 (PND3 บุคคล) | 21-3103 (PND53 นิติ)
  whtFormType   String?  @map("wht_form_type")          // PND3 | PND53

  // Totals (computed at POST, persisted)
  purchaseCost     Decimal @map("purchase_cost") @db.Decimal(12, 2)        // basePrice + ship + install + other (no VAT/WHT)
  residualValue    Decimal @default(0) @map("residual_value") @db.Decimal(12, 2)
  usefulLifeMonths Int     @map("useful_life_months")
  monthlyDepr      Decimal @map("monthly_depr") @db.Decimal(12, 4)         // 4 decimals to avoid drift over months
  accumulatedDepr  Decimal @default(0) @map("accumulated_depr") @db.Decimal(12, 2)
  netBookValue     Decimal @map("net_book_value") @db.Decimal(12, 2)

  // Account snapshots (Handover Fix #1.2 — pinned at POST, immune to A.6 dynamic CoA remap)
  coaCostAccount    String? @map("coa_cost_account")    // 12-2101/03/05/07
  coaDeprAccount    String? @map("coa_depr_account")    // 12-2102/04/06/08
  coaExpenseAccount String? @map("coa_expense_account") // 53-1601/02/03/04

  // Dates
  purchaseDate   DateTime  @map("purchase_date")
  invoiceDate    DateTime? @map("invoice_date")
  disposalDate   DateTime? @map("disposal_date")        // Phase 2
  warrantyExpire DateTime? @map("warranty_expire")

  // Vendor (Handover §13 Section 3)
  supplierName    String?         @map("supplier_name")
  supplierTaxId   String?         @map("supplier_tax_id")
  invoiceNo       String?         @map("invoice_no")
  taxInvoiceNo    String?         @map("tax_invoice_no")
  paymentMethod   PaymentMethod?  @map("payment_method")
  paymentAccount  String?         @map("payment_account")  // bank account code

  // Operations
  custodian      String? // ผู้ดูแล (free text — wire to User in future)
  location       String? // ที่ตั้ง
  serialNo       String? @map("serial_no")
  prRef          String? @map("pr_ref")
  note           String?

  // Workflow
  status        AssetStatus @default(DRAFT)
  isOverridden  Boolean     @default(false) @map("is_overridden")  // JE override mode

  // Audit
  createdById    String    @map("created_by_id")
  approverId     String?   @map("approver_id")
  postedById     String?   @map("posted_by_id")
  postedAt       DateTime? @map("posted_at")
  reversedById   String?   @map("reversed_by_id")
  reversedAt     DateTime? @map("reversed_at")
  reversalReason String?   @map("reversal_reason")

  createdAt DateTime  @default(now()) @map("created_at")
  updatedAt DateTime  @updatedAt @map("updated_at")
  deletedAt DateTime? @map("deleted_at")

  branch              Branch?                @relation(fields: [branchId], references: [id])
  createdBy           User                   @relation("AssetCreatedBy", fields: [createdById], references: [id])
  approver            User?                  @relation("AssetApprover", fields: [approverId], references: [id])
  postedBy            User?                  @relation("AssetPostedBy", fields: [postedById], references: [id])
  reversedBy          User?                  @relation("AssetReversedBy", fields: [reversedById], references: [id])
  depreciationEntries DepreciationEntry[]
  transferHistory     AssetTransferHistory[]

  @@index([status])
  @@index([category, status])
  @@index([purchaseDate])
  @@index([branchId])
  @@map("fixed_assets")
}

/// Append-only — updatedAt/deletedAt intentionally omitted (event log).
model AssetTransferHistory {
  id              String     @id @default(uuid())
  transferId      String     @unique @map("transfer_id") // TRF-1715000000
  assetId         String     @map("asset_id")
  asset           FixedAsset @relation(fields: [assetId], references: [id], onDelete: Restrict)
  transferDate    DateTime   @map("transfer_date")
  fromCustodian   String?    @map("from_custodian")
  toCustodian     String?    @map("to_custodian")
  fromLocation    String?    @map("from_location")
  toLocation      String?    @map("to_location")
  reason          String
  transferredById String     @map("transferred_by_id")
  transferredBy   User       @relation("AssetTransferredBy", fields: [transferredById], references: [id])
  createdAt       DateTime   @default(now()) @map("created_at")

  @@index([assetId, transferDate])
  @@map("asset_transfer_history")
}
```

`DepreciationEntry` model unchanged from Phase A.5c — kept as idempotency record for Phase 2 depreciation work.

### Migration plan

1. **Wipe before migrate** (similar to Phase A.4 pattern):
   ```bash
   CONFIRM_WIPE=YES_I_AM_SURE EXPECTED_DB_NAME=bestchoice_prod ALLOW_PROD_WIPE=YES_I_AM_SURE \
     npm --prefix apps/api run wipe:assets
   ```
   Truncates: `asset_transfer_history`, `depreciation_entries`, `fixed_assets`. CLI guards mirror existing `wipe-accounting.cli.ts`.

2. **Apply schema migration:**
   ```bash
   npx prisma migrate deploy
   ```
   Drops legacy columns (`costValue`, `salvageValue`, `usefulLife`, `assetCategory`, `lastDepreciationPeriod`, `disposalProceeds`, `disposalNote`, `depreciationAccountCode`, `accumulatedAccountCode`); adds new columns with defaults; renames enum values.

3. **No reseed needed** — `FixedAsset` has no master data; users create via UI.

4. **Update existing JE template references:** `depreciation.template.ts` and `asset-disposal.template.ts` reference enum values + Thai labels — update to new enum names. Tests follow.

---

## Workflow

```
DRAFT ────────────► POSTED ──────────► REVERSED  (terminal)
  │                   │
  │                   ├──► DISPOSED   (Phase 2)
  │                   └──► WRITTEN_OFF (Phase 2)
  │
  └──► (delete OK while DRAFT)
```

### Transitions (Phase 1)

| From   | Action       | To       | Permission                                                    | Side effects |
|--------|--------------|----------|---------------------------------------------------------------|--------------|
| –      | `createDraft`| DRAFT    | OWNER, BRANCH_MANAGER, FINANCE_MANAGER, ACCOUNTANT            | + AuditLog `ASSET_CREATE` |
| DRAFT  | `update`     | DRAFT    | createdBy or `can_post` (OWNER/FINANCE_MANAGER)               | + AuditLog `ASSET_UPDATE` (if fields changed) |
| DRAFT  | `delete`     | (gone)   | createdBy or OWNER                                            | soft delete + AuditLog `ASSET_DELETE` |
| DRAFT  | `post`       | POSTED   | `can_post` + V15 period guard on `purchaseDate`               | + JE via `AssetPurchaseTemplate`; + JournalPostAuditLog; + AuditLog `ASSET_POST` |
| POSTED | `reverse`    | REVERSED | OWNER + V15 period guard + reason required                    | + reverse JE via `AssetPurchaseReverseTemplate`; + AuditLog `ASSET_REVERSE` |
| POSTED | `transfer`   | (no Δ)   | createdBy or `can_post` + V15 period guard on `transferDate`  | + AssetTransferHistory row; + AuditLog `ASSET_TRANSFER` (no JE) |

### SoD soft warning

When `createdById === postedById` or `createdById === approverId`, return a non-blocking `Sonner` toast on the frontend (`"คุณกำลัง POST เอกสารที่คุณสร้างเอง"`). Backend still allows the operation. Matches owner preference (memory: `feedback_simplification_cycle` — soft warnings not hard blocks).

### V15 period lock

Reuse `validatePeriodOpen(prisma, date, companyId)` from `apps/api/src/utils/period-lock.util.ts`. Asset module passes:
- `purchaseDate` for `post`/`reverse`
- `transferDate` for `transfer`
- FINANCE `companyId` (resolved from `companyCode='FINANCE'` lookup, cached in service)

Blocked operations log AuditLog with `action='ASSET_POST_BLOCKED'` (or `ASSET_REVERSE_BLOCKED` etc.) so we can audit attempts to post into closed periods.

---

## Journal Entry Templates

### `AssetPurchaseTemplate.execute(asset, postedById, tx?)`

Called inside `assetService.post(id, postedById)` within a `$transaction`. Posts a single JE with `referenceType='AUTO'` (the BESTCHOICE convention enforced by `journalAuto.createAndPost`) and `referenceId=asset.id`. The unique partial index on `(referenceType, referenceId)` ensures one purchase JE per asset.

**Computation:**

```typescript
purchaseCost  = basePrice + shippingCost + installationCost + otherCapitalized
                (Note: when vatInclusive=true, basePrice has VAT removed first — see below)
totalPayable  = purchaseCost + (vatInclusive ? 0 : vatAmount) − whtAmount
monthlyDepr   = (purchaseCost − residualValue) / usefulLifeMonths  // ROUND_HALF_UP to 4 decimals
netBookValue  = purchaseCost  // at POST time

// VAT inclusive case (Handover Fix #1.3):
if (hasVat && vatInclusive) {
  vatAmount  = round2(basePrice × 7 / 107)
  basePrice  = basePrice − vatAmount  // store ex-VAT
}

// WHT (Handover Fix #1.1):
whtBase   = whtBaseAmount ?? installationCost ?? 0
whtAmount = hasWht && whtBase > 0 ? round2(whtBase × whtRate) : 0
```

**JE structure** (lines order; signs are debit/credit, not negative):

```
Dr  coaCostAccount     purchaseCost            // 12-2101/03/05/07 by category
Dr  vatAccount         vatAmount               // 11-4101 or 11-4102 (only if hasVat && !vatInclusive)
                                                 // (when vatInclusive, VAT is embedded in basePrice already)
                       Cr  whtAccount         whtAmount       // 21-3102 or 21-3103 (only if hasWht)
                       Cr  paymentAccount     totalPayable    // bank or AP account
```

**Account snapshots:** before creating the JE, copy `cat.cost`/`cat.accDepr`/`cat.expense` from a `ASSET_CATEGORY_CHART` const into `asset.coaCostAccount`/`coaDeprAccount`/`coaExpenseAccount`. Pinned values protect against future CoA renames.

**Idempotency:** before posting, query `journalEntries.where({ referenceType: 'AUTO', referenceId: asset.id, deletedAt: null })`. If a row exists, return its entryNumber (skip posting). Mirrors `expense.template.ts` idempotency log line.

**T2-C14:** insert `JournalPostAuditLog` row in the same `$transaction` (mirrors `journal.service.ts:233-255`).

### `AssetPurchaseReverseTemplate.execute(asset, reversedById, reason, tx?)`

Pre-checks (throw `BadRequestException` if any fails):
- `asset.status === 'POSTED'`
- No `DepreciationEntry` rows exist for this asset (must un-depreciate first)
- `reason` is non-empty
- `validatePeriodOpen(asset.purchaseDate, financeCompanyId)` passes

Steps inside `$transaction`:
1. Find original JE: `findFirst({ referenceType: 'AUTO', referenceId: asset.id })`. Throw if missing.
2. Build mirror lines (swap debit/credit, prefix description with `[VOID]`).
3. Call `journalAuto.createAndPost({ description: '[ยกเลิก] ...', reference: '${asset.id}:reverse', metadata: { tag: 'REVERSAL', flow: 'asset-purchase-reverse', originalEntryId, originalEntryNumber }, lines })`.
4. Update original JE: `metadata.reversed = true`, `metadata.reversedByEntryNumber = newJe.entryNumber`. (Original status stays `POSTED` — TFRS no-touch principle. Both JE rows remain queryable for trial balance.)
5. Update asset: `status='REVERSED'`, `reversedAt=now`, `reversedById`, `reversalReason`.
6. Insert AuditLog: `action='ASSET_REVERSE'`, `entity='fixed_asset'`, `entityId=asset.id`, `oldValue={ status:'POSTED' }`, `newValue={ status:'REVERSED', reversedById, reversalReason, reversalEntryNumber }`.

The reversal JE's `referenceId` is `${asset.id}:reverse` — different value than the original `asset.id`, so the partial unique index on `(referenceType, referenceId)` does not conflict. Same trick used by `receipt-void-reversal.template.ts:88`.

---

## API Endpoints

```
GET    /assets                  list + filter (search, category, status, branchId, page, limit)
GET    /assets/summary          stat cards (count by status, total cost)
GET    /assets/generate-code    auto-generate next assetCode
GET    /assets/:id              single asset + last 10 transferHistory
GET    /assets/:id/audit        per-asset AuditLog trail
POST   /assets                  create DRAFT
PATCH  /assets/:id              update DRAFT only
DELETE /assets/:id              soft delete (DRAFT only)
POST   /assets/:id/post         DRAFT → POSTED
POST   /assets/:id/reverse      POSTED → REVERSED
POST   /assets/:id/transfer     custodian/location change (no status change)
POST   /assets/:id/copy         create new DRAFT cloned from this asset (Handover §8.2)
```

### Guards & roles

All endpoints require `JwtAuthGuard + RolesGuard + BranchGuard`. Per-method role matrix:

| Endpoint                  | Roles                                                  | Extra check                                     |
|---------------------------|--------------------------------------------------------|-------------------------------------------------|
| `GET *`                   | OWNER, BRANCH_MANAGER, FINANCE_MANAGER, ACCOUNTANT     | —                                               |
| `POST /assets` (create)   | OWNER, BRANCH_MANAGER, FINANCE_MANAGER, ACCOUNTANT     | —                                               |
| `PATCH /assets/:id`       | createdBy or `can_post` (OWNER/FINANCE_MANAGER)        | `status='DRAFT'`                                |
| `DELETE /assets/:id`      | createdBy or OWNER                                     | `status='DRAFT'`                                |
| `POST /:id/post`          | OWNER, FINANCE_MANAGER                                 | V15 on `purchaseDate`; SoD soft warning         |
| `POST /:id/reverse`       | OWNER                                                  | V15; no DepreciationEntry; `reason` required    |
| `POST /:id/transfer`      | createdBy or `can_post`                                | `status='POSTED'`; V15 on `transferDate`        |
| `POST /:id/copy`          | OWNER, BRANCH_MANAGER, FINANCE_MANAGER, ACCOUNTANT     | source asset can be any status                  |

### DTOs (key validators)

`CreateAssetDto`:
```typescript
@IsString() @IsNotEmpty() name: string;
@IsOptional() @IsString() description?: string;
@IsEnum(AssetCategory) category: AssetCategory;
@IsOptional() @IsString() branchId?: string;

@IsNumber() @Min(0.01) basePrice: number;
@IsNumber() @Min(0) @IsOptional() shippingCost?: number;
@IsNumber() @Min(0) @IsOptional() installationCost?: number;
@IsNumber() @Min(0) @IsOptional() otherCapitalized?: number;

@IsBoolean() @IsOptional() hasVat?: boolean;
@IsBoolean() @IsOptional() vatInclusive?: boolean;
@IsString() @IsOptional() vatAccount?: string;        // '11-4101' | '11-4102'

@IsBoolean() @IsOptional() hasWht?: boolean;
@IsNumber() @Min(0) @IsOptional() whtBaseAmount?: number;
@IsNumber() @Min(0) @Max(0.05) @IsOptional() whtRate?: number;
@IsString() @IsOptional() whtAccount?: string;        // '21-3102' | '21-3103'
@IsIn(['PND3','PND53']) @IsOptional() whtFormType?: string;

@IsNumber() @Min(0) @IsOptional() residualValue?: number;
@IsInt() @Min(1) usefulLifeMonths: number;

@IsDateString() purchaseDate: string;
@IsDateString() @IsOptional() invoiceDate?: string;
@IsDateString() @IsOptional() warrantyExpire?: string;

@IsString() @IsOptional() supplierName?: string;
@IsString() @IsOptional() supplierTaxId?: string;
@IsString() @IsOptional() invoiceNo?: string;
@IsString() @IsOptional() taxInvoiceNo?: string;
@IsEnum(PaymentMethod) @IsOptional() paymentMethod?: PaymentMethod;
@IsString() @IsOptional() paymentAccount?: string;

@IsString() @IsOptional() custodian?: string;
@IsString() @IsOptional() location?: string;
@IsString() @IsOptional() serialNo?: string;
@IsString() @IsOptional() prRef?: string;
@IsString() @IsOptional() note?: string;
@IsString() @IsOptional() approverId?: string;
```

Error messages in Thai: `{ message: 'กรุณาระบุชื่อสินทรัพย์' }` etc.

### Response shape

`GET /assets` returns `{ data: Asset[], total, page, limit }`. `GET /assets/:id` returns the asset object plus the latest 10 `transferHistory` rows.

### Copy endpoint detail

`POST /assets/:id/copy` creates a new `DRAFT` asset by cloning an existing one (any status). Use case: bulk purchase of identical equipment (e.g., 5 matching workstations) — fill once, copy four times.

**Cloned fields:** `name`, `description`, `category`, `branchId`, `basePrice`, `shippingCost`, `installationCost`, `otherCapitalized`, `hasVat`, `vatInclusive`, `vatAccount`, `hasWht`, `whtRate`, `whtAccount`, `whtFormType`, `residualValue`, `usefulLifeMonths`, `supplierName`, `supplierTaxId`, `paymentMethod`, `paymentAccount`, `custodian`, `location`, `warrantyExpire`, `prRef`, `note`.

**Reset on copy:**
- `id`, `assetCode` (regenerate via `generateAssetCode`), `docNo` (regenerate)
- `status = 'DRAFT'`
- `purchaseDate = today` (user typically edits on the new draft)
- `invoiceDate = null`, `invoiceNo = null`, `taxInvoiceNo = null`, `serialNo = null`, `whtBaseAmount = null`
- `accumulatedDepr = 0`, all `posted*`/`reversed*`/`approver*` fields = null
- `purchaseCost`, `vatAmount`, `whtAmount`, `monthlyDepr`, `netBookValue` = recomputed from the cost fields
- `coaCostAccount/coaDeprAccount/coaExpenseAccount` = null (will be snapshot at next POST)
- `createdById` = current user; `createdAt = now()`
- `transferHistory`: NOT copied
- `depreciationEntries`: NOT copied

**AuditLog:** `action='ASSET_CREATE'`, `entity='fixed_asset'`, `entityId=newAssetId`, `newValue: { copiedFromAssetId, copiedFromAssetCode }`. The `copiedFromAssetId` lets reports trace cloning lineage.

**Returns:** the new asset (same shape as `GET /assets/:id`).

---

## Frontend

### Routes

```
/assets                  AssetsListPage      (list + filter + 7 stat cards)
/assets/new              AssetEntryPage      (create mode)
/assets/:id/edit         AssetEntryPage      (edit mode — DRAFT only)
/assets/:id              AssetDetailPage     (read-only + action menu)
```

All routes lazy-loaded via `React.lazy()`, wrapped in `ProtectedRoute` + `MainLayout`.

### `AssetsListPage`

- Header with "+ สินทรัพย์ใหม่" button
- 7 stat cards: DRAFT count, POSTED count, REVERSED count, DISPOSED count, WRITTEN_OFF count, total purchaseCost, total NBV
- Filters: search (debounced via `useDebounce`), category, status, branchId
- Table columns: assetCode, name, category badge, purchaseCost, status badge, custodian, purchaseDate, actions (edit/dispose/transfer/reverse based on status)
- Pagination (default 50/page)
- `QueryBoundary` wrapper for error+retry UI

### `AssetEntryPage` (5 sections)

Built with `react-hook-form` + `zod` (matching v4 form modernization pattern). Inline validation; submit button disabled until form is valid.

```
┌─ Section 1: ข้อมูลสินทรัพย์ ────────────────────┐
│ assetCode (auto from /assets/generate-code)     │
│ name · description · category · branchId        │
│ custodian · location · serialNo · warrantyExpire│
└─────────────────────────────────────────────────┘
┌─ Section 2: รายละเอียดต้นทุน + ภาษี ────────────┐
│ basePrice · shipping · installation · other     │
│ ☐ มี VAT  ☐ inclusive  → vatAmount (live calc)  │
│ ☐ มี WHT  rate (1/2/3%)  whtBase  whtFormType   │
│ ──── live totals ────                           │
│ purchaseCost · totalPayable · monthlyDepr        │
│ residual · usefulLifeMonths                     │
└─────────────────────────────────────────────────┘
┌─ Section 3: ผู้ขาย + การชำระเงิน ───────────────┐
│ supplierName · taxId · invoiceNo · taxInvoiceNo │
│ paymentMethod · paymentAccount (bank dropdown)* │
│ * dropdown of cash account codes per accounting.md  │
│   (11-1101..11-1103 cash, 11-1201..11-1203 bank)    │
└─────────────────────────────────────────────────┘
┌─ Section 4: รายการบัญชี (Auto JE Preview) ──────┐
│ Live preview ตาม Section 2 (Dr/Cr lines)        │
│ ☐ Override mode (manual edit lines)             │
└─────────────────────────────────────────────────┘
┌─ Section 5: ผู้รับผิดชอบ + อนุมัติ ─────────────┐
│ createdBy chip · approverId dropdown · note     │
│ SoD soft warning ถ้า createdBy === approverId   │
└─────────────────────────────────────────────────┘

┌─ Sticky Action Bar ─────────────────────────────┐
│ [ยกเลิก]  [บันทึกร่าง]  [บันทึก & POST]         │
└─────────────────────────────────────────────────┘
```

The "บันทึก & POST" button is disabled if V1-V14 validation fails on the client. V15 (period lock) is validated **server-side only** on `POST /assets/:id/post` — the server returns a 400 with a Thai error message (`'ไม่สามารถ POST: งวด YYYY-MM ถูกปิดบัญชีแล้ว'`) and the frontend surfaces it via `Sonner` toast. No client-side period check endpoint is needed; this matches the existing Expense module's submission flow.

`useAssetCalculation(form)` hook returns memoized `{ purchaseCost, vatAmount, whtAmount, totalPayable, monthlyDepr, netBookValue, journalLines }` — drives sections 2 and 4.

### `AssetDetailPage`

Read-only summary + action menu (`MoreVertical` dropdown):
- DRAFT: Edit, Delete, Submit & POST
- POSTED: Reverse (opens `ReverseAssetDialog` with reason textarea)
- REVERSED: no actions
- POSTED: Transfer custodian/location (opens transfer modal — operational, no JE)

Right panel: transfer history list, JE references (linked to `/journal/:id` if it exists), audit trail (last 10 from `/assets/:id/audit`).

---

## Validation Rules (V1-V15)

Per Handover §5.5; checked both client (form) and server (DTO + service).

| Rule | Description |
|------|-------------|
| V1   | `name` required, ≤ 150 chars |
| V2   | `category` is one of the 4 enum values |
| V3   | `basePrice > 0` |
| V4   | `purchaseDate` not in future, not before 5 years ago |
| V5   | `vatAccount` required if `hasVat=true` |
| V6   | `vatAccount ∈ {'11-4101','11-4102'}` |
| V7   | `whtAccount` and `whtRate` required if `hasWht=true` |
| V8   | `whtRate ∈ {0.01, 0.02, 0.03, 0.05}` (1/2/3/5%) |
| V9   | `usefulLifeMonths ≥ 1` |
| V10  | `residualValue ≤ basePrice` |
| V11  | `purchaseDate ≤ today` |
| V12  | `supplierName` required if `paymentMethod !== 'CASH'` |
| V13  | useful-life sanity by category (warning only): EQUIPMENT 24-60mo, IMPROVEMENT 60-120mo, FURNITURE 36-60mo, VEHICLE 60-120mo |
| V14  | When `isOverridden=true`, sum(Dr) === sum(Cr) on JE preview lines |
| V15  | `purchaseDate` falls in an open accounting period for FINANCE (server-side: `validatePeriodOpen`) |

V13 is a soft warning (toast); the rest are hard validation errors that block submission.

---

## Audit Trail Conventions

All audit log writes use the existing `AuditLog` model (no schema change). Conventions:

```typescript
{
  userId: <UUID FK>,
  action: 'ASSET_CREATE' | 'ASSET_UPDATE' | 'ASSET_DELETE' | 'ASSET_POST' | 'ASSET_REVERSE' | 'ASSET_TRANSFER' | 'ASSET_POST_BLOCKED' | 'ASSET_REVERSE_BLOCKED',
  entity: 'fixed_asset',  // lowercase
  entityId: <asset.id>,
  oldValue: { ... },      // pre-state
  newValue: { ... },      // post-state including JE references
  ipAddress: <optional>,
  userAgent: <optional>,
}
```

The `AuditInterceptor` (global) handles request metadata. Service code only needs to write `action`/`entity`/`entityId`/`oldValue`/`newValue`.

---

## Testing

### Unit tests (vitest)

- `asset.service.spec.ts` (~33 cases)
  - createDraft happy path
  - update DRAFT (allowed) vs POSTED (rejected)
  - delete DRAFT (allowed) vs POSTED (rejected)
  - post happy path (asserts JE created with correct lines, account snapshots written, status='POSTED')
  - post into closed period → rejected with V15 error
  - post idempotent (calling post twice returns same JE, no duplicate row)
  - reverse happy path (asserts mirror JE, original metadata.reversed=true, asset.status='REVERSED')
  - reverse rejected if DepreciationEntry exists
  - reverse idempotency (cannot reverse twice)
  - SoD soft warning case (createdBy === postedBy, operation succeeds)
  - VAT inclusive math (basePrice 107 → vatAmount 7, purchaseCost stored as 100)
  - VAT exclusive math
  - WHT calculation on installation cost only (Fix #1.1)
  - Account snapshot pinned at POST time (Fix #1.2)
  - copy from POSTED → new DRAFT (assetCode + docNo regenerated, status reset, transferHistory not cloned)
  - copy from REVERSED → new DRAFT (still allowed)
  - copy preserves cost fields but resets posted/reversed audit fields

- `asset-transfer.service.spec.ts` (~10 cases)
  - happy path: custodian + location change → history row created, AuditLog ASSET_TRANSFER written, no JE
  - reject if asset.status !== 'POSTED'
  - reject if both fields unchanged
  - V15 period lock on transferDate
  - rejects if transferDate in future

- `asset-purchase.template.spec.ts` (~12 cases)
  - happy path JE structure (4 categories)
  - VAT inclusive vs exclusive
  - WHT PND3 vs PND53
  - Decimal balanced (Dr === Cr)
  - account snapshot copied
  - idempotency

- `asset-purchase-reverse.template.spec.ts` (~8 cases)
  - mirror JE structure
  - rejects if DepreciationEntry exists
  - original JE metadata flagged
  - reversal entryNumber linkage

### E2E tests (Playwright) — Phase 1 minimal

- `e2e/assets-create-post.spec.ts`: login as FINANCE_MANAGER → fill form → save draft → post → verify status=POSTED in list
- `e2e/assets-reverse.spec.ts`: existing POSTED asset → reverse with reason → verify status=REVERSED + JE link visible

### Acceptance criteria

- All vitest suites pass (`./tools/check-types.sh all` + `cd apps/api && npm test`)
- 0 TypeScript errors
- E2E both pass (`cd apps/web && npx playwright test e2e/assets-*.spec.ts`)
- Trial balance still balances after creating/reversing 5 test assets (manual check)
- Auto Journal preview matches actual JE created at POST time (UI vs DB diff = 0)

---

## Verification (key design assumptions cross-checked against actual code)

| # | Assumption | Verdict | Citation |
|---|------------|---------|----------|
| 1 | Partial unique index on `(referenceType, referenceId)` | ✅ exists | `apps/api/prisma/migrations/20260428010000_journal_entries_ref_unique/migration.sql:6-10` |
| 2 | `createAndPost` hardcodes `referenceType='AUTO'`; only `reference` (=referenceId) is user-controllable | ✅ confirmed | `apps/api/src/modules/journal/journal-auto.service.ts:35-73` |
| 3 | Reversal pattern: original stays POSTED with `metadata.reversed=true`; reversing JE uses different `referenceId` (`<id>:reverse` suffix) | ✅ matches `receipt-void-reversal.template.ts:78-108` |
| 4 | `generateEntryNumber` advisory lock `JE-YYYYMM-NNNNN` (5 digits) | ✅ confirmed | `apps/api/src/modules/journal/journal-auto.service.ts:95-109` |
| 5 | `JournalPostAuditLog` (T2-C14) inserted in same `$transaction` | ✅ confirmed | `apps/api/src/modules/journal/journal.service.ts:233-255` |
| 6 | `validatePeriodOpen(prisma, date, companyId?)` works cross-module | ✅ polymorphic util | `apps/api/src/utils/period-lock.util.ts:31-35` |
| 7 | AuditLog has `oldValue/newValue Json?` fields, no `metadata` field | ✅ confirmed (design adjusted) | `apps/api/prisma/schema.prisma:2143-2174` |
| 8 | FINANCE company resolution via `companyCode='FINANCE'`, no helper, cached per service | ✅ confirmed | `apps/api/src/modules/journal/journal-auto.service.ts:113-122` |
| 9 | No FixedAsset records in seed; only created via service code | ✅ confirmed | `apps/api/prisma/seed.ts` (no `fixedAsset.create`) |
| 10 | AssetCategory rename impact: 6 files need updating (depreciation.template, asset-disposal.template, both spec files, asset.dto, schema) | ⚠ scope noted | grep of `OFFICE_EQUIPMENT` etc. across module |
| 11 | Decimal precision standard is `@db.Decimal(12, 2)` for money fields | ✅ standard adopted (was 14,2 in prototype, normalized to 12,2) | `apps/api/prisma/schema.prisma` JournalLine.debit/credit:3372-3373 |

All findings folded into the design above. The design uses BESTCHOICE conventions exclusively, not Handover's prototype-specific patterns.

---

## Out of Scope (deferred to Phase 2 / Phase 3)

**Phase 2 — Lifecycle Operations:**
- DepreciationPage (preview / manual run / reverse run)
- DisposalPage (disposal + write-off + period guard)
- TransferPage (UI for the existing `/transfer` endpoint built in Phase 1)
- Refactor `depreciation.template.ts` and `asset-disposal.template.ts` to use new schema

**Phase 3 — Reports:**
- AssetRegisterPage (as-of date + CSV export)
- AssetSchedulePage (NBV month-by-month)
- AssetJournalPage (filtered JV list scoped to assets)
- AssetSummaryReportPage (4 tabs: by category / custodian / location / movement)
- AssetAuditPage (per-asset audit trail viewer — endpoint exists in Phase 1)

**Permanently out of scope (per Handover §1.5):**
- Repair / Maintenance module
- Capitalization decision UI (case-by-case)
- Settings page (admin CoA)
- CWIP (assets under construction)
- Intangible assets (amortization)
- Dual approval (>100k threshold)
- Lease/ROU (TFRS 16)
- Impairment test (TAS 36)
- Cost allocation (1 invoice → multiple assets pro-rata)
- Asset adjustment (use Reverse + create new instead)
- Attachment upload (file storage)

---

## Open Questions

None — all design decisions were resolved during brainstorming. The design is ready for `/writing-plans` to produce an implementation plan.
