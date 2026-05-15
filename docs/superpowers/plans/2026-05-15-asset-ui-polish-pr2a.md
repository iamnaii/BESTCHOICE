# Asset UI Polish PR 2a — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. All implementer + reviewer subagents use `model="opus"` (owner directive 2026-05-15).

**Goal:** Ship 6 items P3-P8 from accountant's ImplementationReview v1.2 Day 2 (8hr estimate): list page stat cards Thai labels, label fix, vendor master integration, lightweight permission UI, NBV terminology, Tab Bar verify.

**Architecture:** Frontend-heavy. P3/P4/P5/P8 are UI-only. P6 + P7 require small backend additions (FixedAsset model fields + DTO + service persistence). Reuse existing SuppliersPage API for P6. P7 stores permissions as JSON metadata without runtime enforcement (per PDF 2hr budget).

**Tech Stack:** React 18 + TypeScript + Tailwind + shadcn/ui (frontend) · NestJS + Prisma + PostgreSQL (backend). React Query for data. Zod for schemas.

**Spec:** [docs/superpowers/specs/2026-05-15-asset-ui-polish-pr2a-design.md](../specs/2026-05-15-asset-ui-polish-pr2a-design.md)

---

## File Structure

| File | Status | Responsibility |
|------|--------|----------------|
| `apps/web/src/pages/assets/AssetsListPage.tsx` | Modify | P3 stat cards (4 Thai labels with ทั้งหมด count) |
| `apps/web/src/pages/assets/components/AssetEntrySection2Cost.tsx` | Modify | P5 label text update |
| `apps/web/src/pages/assets/components/AssetEntrySection3Vendor.tsx` | Modify | P6 supplier combobox + auto-fill taxId + amount paid |
| `apps/web/src/pages/assets/components/AssetEntrySection5Approver.tsx` → rename `AssetEntrySection5Permission.tsx` | Rename + rewrite | P7 multi-user permission picker |
| `apps/web/src/pages/assets/AssetEntryPage.tsx` | Modify | Update Section 5 import name |
| `apps/web/src/pages/assets/schema.ts` | Modify | P6: vendorId, vendorAmountPaid; P7: permissionConfig array |
| `apps/web/src/pages/assets/types.ts` | Modify | Add `PermissionConfigEntry` type |
| `apps/web/src/pages/assets/api.ts` | Modify | Add useSuppliers query helper |
| `apps/web/src/pages/assets/AssetRegisterPage.tsx` | Modify | P8 NBV terminology |
| `apps/web/src/pages/assets/AssetSummaryReportPage.tsx` | Modify | P8 NBV terminology |
| `apps/web/src/pages/assets/AssetSchedulePage.tsx` | Modify | P8 NBV terminology |
| Other files containing user-visible `'NBV'` strings | Modify | P8 (enumerate via grep) |
| `apps/api/prisma/schema.prisma` | Modify | Add FixedAsset.vendorId, vendorAmountPaid, permissionConfig |
| `apps/api/prisma/migrations/2026XXXXXXXXXX_asset_vendor_permission/migration.sql` | Create | New migration |
| `apps/api/src/modules/asset/dto/create-asset.dto.ts` | Modify | Accept new fields |
| `apps/api/src/modules/asset/dto/update-asset.dto.ts` | Modify | Accept new fields |
| `apps/api/src/modules/asset/asset.service.ts` | Modify | Persist new fields + map permissionConfig |
| `apps/api/src/modules/asset/__tests__/asset-permission-config.spec.ts` | Create | Jest: DTO + persistence test |
| `apps/web/src/pages/assets/__tests__/AssetsListPage.statcards.test.tsx` | Create | Vitest: 4 Thai stat cards |
| `apps/web/src/pages/assets/__tests__/AssetEntrySection3Vendor.test.tsx` | Create | Vitest: supplier combobox + auto-fill |
| `apps/web/src/pages/assets/__tests__/AssetEntrySection5Permission.test.tsx` | Create | Vitest: permission rows + checkboxes |

---

## Task 1: P4 Tab Bar Verify (no code change)

**Files:** none

- [ ] **Step 1: Verify Tab Bar is not present**

```bash
grep -rn "AccountingModuleTabBar" apps/web/src
grep -rn "ซื้อทรัพย์สิน" apps/web/src/components apps/web/src/pages/assets
```

Expected: 0 hits for the component name and 0 hits for the Thai tab label in component files (matches outside config/menu.ts which renders the side menu, not a tab bar).

- [ ] **Step 2: Document finding in PR body**

No commit for this task. Findings flow to PR description: "P4 (Tab Bar removal) verified — component does not exist in current codebase. No action."

---

## Task 2: P3 Stat Cards Refactor (TDD)

**Files:**
- Create: `apps/web/src/pages/assets/__tests__/AssetsListPage.statcards.test.tsx`
- Modify: `apps/web/src/pages/assets/AssetsListPage.tsx` (lines 138-174 `statCards` array)

- [ ] **Step 1: Write failing component test**

Create `apps/web/src/pages/assets/__tests__/AssetsListPage.statcards.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { vi, describe, it, expect } from 'vitest';
import AssetsListPage from '../AssetsListPage';

vi.mock('../api', () => ({
  assetsApi: {
    getSummary: vi.fn().mockResolvedValue({
      draft: 5, posted: 12, reversed: 2, disposed: 0, writtenOff: 0,
      totalPurchaseCost: 100000, totalNetBookValue: 80000,
    }),
    list: vi.fn().mockResolvedValue({ data: [], total: 0, page: 1, limit: 50 }),
    delete: vi.fn(),
  },
}));

const renderPage = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><AssetsListPage /></MemoryRouter>
    </QueryClientProvider>,
  );
};

describe('AssetsListPage — P3 stat cards (Thai labels, no TOTAL COST)', () => {
  it('renders exactly 4 stat cards with Thai labels', async () => {
    renderPage();
    expect(await screen.findByText('ทั้งหมด')).toBeInTheDocument();
    expect(await screen.findByText('รอดำเนินการ')).toBeInTheDocument();
    expect(await screen.findByText('ลงบัญชี')).toBeInTheDocument();
    expect(await screen.findByText('ยกเลิก')).toBeInTheDocument();
  });

  it('does NOT render legacy English labels for stat cards', async () => {
    renderPage();
    await screen.findByText('ทั้งหมด');
    // Status badges in the table still use English labels — only stat cards are Thai
    const draftLabels = screen.queryAllByText('DRAFT');
    expect(draftLabels.length).toBeLessThanOrEqual(1); // 1 = filter dropdown option, never as stat card
    expect(screen.queryByText('TOTAL COST')).not.toBeInTheDocument();
  });

  it('ทั้งหมด card shows sum of draft+posted+reversed', async () => {
    renderPage();
    expect(await screen.findByText('19')).toBeInTheDocument(); // 5+12+2
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/web && npx vitest run src/pages/assets/__tests__/AssetsListPage.statcards.test.tsx
```

Expected: 3 tests FAIL (current labels are DRAFT/POSTED/REVERSED/TOTAL COST).

- [ ] **Step 3: Refactor statCards array in AssetsListPage.tsx**

Open `apps/web/src/pages/assets/AssetsListPage.tsx`. Find the `statCards: StatCardConfig[] = useMemo(...)` block (around line 138). Replace with:

```tsx
const statCards: StatCardConfig[] = useMemo(
  () => [
    {
      label: 'ทั้งหมด',
      caption: 'เอกสารทั้งหมด',
      value: Number(summary?.draft ?? 0) + Number(summary?.posted ?? 0) + Number(summary?.reversed ?? 0),
      decimals: 0,
      icon: Files,
      tone: 'info',
    },
    {
      label: 'รอดำเนินการ',
      caption: 'ฉบับร่าง',
      value: Number(summary?.draft ?? 0),
      decimals: 0,
      icon: FileEdit,
      tone: 'muted',
    },
    {
      label: 'ลงบัญชี',
      caption: 'บันทึกแล้ว',
      value: Number(summary?.posted ?? 0),
      decimals: 0,
      icon: CheckCircle2,
      tone: 'success',
    },
    {
      label: 'ยกเลิก',
      caption: 'กลับรายการ',
      value: Number(summary?.reversed ?? 0),
      decimals: 0,
      icon: RotateCcw,
      tone: 'warning',
    },
  ],
  [summary],
);
```

Add `Files` to the lucide-react import block at the top of the file (the icon used for "ทั้งหมด"). Remove `Gem` import if unused (was used for TOTAL COST).

Update the grid class above the stat cards map: change `lg:grid-cols-6` to `lg:grid-cols-4` (since we now have 4 cards, not 6). Find the line `<div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">` and change to `<div className="grid grid-cols-2 md:grid-cols-4 gap-3">`. Also update the stale comment `{/* Stat row: 4 status counts + 2 navigation cards */}` to `{/* Stat row: 4 Thai-labeled status counts (P3 of PR 2a) */}`.

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/web && npx vitest run src/pages/assets/__tests__/AssetsListPage.statcards.test.tsx
```

Expected: 3 PASS.

- [ ] **Step 5: Type check**

```bash
./tools/check-types.sh web
```

Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/assets/AssetsListPage.tsx apps/web/src/pages/assets/__tests__/AssetsListPage.statcards.test.tsx
git commit -m "feat(assets): P3 stat cards Thai labels + ALL count card"
```

---

## Task 3: P5 Label Change

**Files:**
- Modify: `apps/web/src/pages/assets/components/AssetEntrySection2Cost.tsx`

- [ ] **Step 1: Locate the label**

```bash
grep -n "capitalize\|otherCost" apps/web/src/pages/assets/components/AssetEntrySection2Cost.tsx
```

- [ ] **Step 2: Update the label text**

Find the `<Label>` wrapping the `otherCost` input. Current text contains "ค่า capitalize อื่น". Change to:

```tsx
<Label>ต้นทุนสินทรัพย์อื่น ๆ (ค่า capitalize อื่น)</Label>
```

- [ ] **Step 3: Type check**

```bash
./tools/check-types.sh web
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/assets/components/AssetEntrySection2Cost.tsx
git commit -m "feat(assets): P5 clarify 'ค่า capitalize อื่น' label"
```

---

## Task 4: P8 NBV Terminology Search-Replace

**Files:** (enumerated via grep — typically 8-15 hits across asset + depreciation pages)

- [ ] **Step 1: Enumerate hits**

```bash
grep -rn "'NBV'\|\"NBV\"\|>NBV<\|: 'NBV'\|: NBV " apps/web/src/pages/assets apps/web/src/pages/depreciation 2>/dev/null
```

Manually filter results: only fix **user-visible rendered text** (e.g. JSX text content, prop strings passed to PageHeader/Column header/Label/tooltip). Skip:
- Variable names (`const nbv = ...`)
- Type properties (`netBookValue`)
- Comments
- Test files (unless they assert on the rendered text)

- [ ] **Step 2: For each user-facing hit, change `NBV` to `มูลค่าตามบัญชีสุทธิ (NBV)`**

Common patterns:
- Column header: `{ key: 'netBookValue', label: 'NBV' }` → `{ ..., label: 'มูลค่าตามบัญชีสุทธิ (NBV)' }`
- Stat card: `label: 'NBV รวม'` → `label: 'มูลค่าตามบัญชีสุทธิ (NBV) รวม'`
- Tooltip / subtitle: `"NBV"` → `"มูลค่าตามบัญชีสุทธิ (NBV)"`

- [ ] **Step 3: Type check**

```bash
./tools/check-types.sh web
```

Expected: 0 errors.

- [ ] **Step 4: Re-grep to verify**

```bash
grep -rn "'NBV'\|>NBV<" apps/web/src/pages/assets apps/web/src/pages/depreciation | grep -v "//\|netBookValue\|nbv"
```

Expected: 0 remaining hits in user-facing strings.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(assets): P8 NBV → 'มูลค่าตามบัญชีสุทธิ (NBV)' user-facing strings"
```

---

## Task 5: P6 Vendor Database Integration (TDD)

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (add `vendorId`, `vendorAmountPaid` to FixedAsset)
- Create: `apps/api/prisma/migrations/2026XXXX_asset_vendor_link/migration.sql`
- Modify: `apps/api/src/modules/asset/dto/create-asset.dto.ts` + `update-asset.dto.ts`
- Modify: `apps/api/src/modules/asset/asset.service.ts` (persist new fields)
- Modify: `apps/web/src/pages/assets/schema.ts` (add `vendorId?: string`, `vendorAmountPaid?: number`)
- Modify: `apps/web/src/pages/assets/api.ts` (add `useSuppliers` exported query helper)
- Modify: `apps/web/src/pages/assets/components/AssetEntrySection3Vendor.tsx` (Combobox + auto-fill + amount field)
- Create: `apps/web/src/pages/assets/__tests__/AssetEntrySection3Vendor.test.tsx`

- [ ] **Step 1: Verify Suppliers API exists and field names**

```bash
grep -n "name\|taxId\|@@map" apps/api/prisma/schema.prisma | grep -A 2 "model Supplier"
grep -rn "/suppliers" apps/api/src/modules/suppliers/ 2>/dev/null | head -5
```

Confirm: Supplier model has `id`, `name`, `taxId` (or `taxNo` — adjust). Confirm `GET /suppliers` returns `{ data: Supplier[], total, page, limit }` or `Supplier[]` — note which shape for the API helper.

- [ ] **Step 2: Add Prisma fields**

Open `apps/api/prisma/schema.prisma`. In `model FixedAsset { ... }`, add:

```prisma
vendorId         String?  @map("vendor_id")
vendor           Supplier? @relation("FixedAssetVendor", fields: [vendorId], references: [id])
vendorAmountPaid Decimal? @db.Decimal(12, 2) @map("vendor_amount_paid")
```

In `model Supplier { ... }`, add the reverse relation:

```prisma
fixedAssets FixedAsset[] @relation("FixedAssetVendor")
```

- [ ] **Step 3: Create + apply migration**

```bash
cd apps/api && npx prisma migrate dev --name asset_vendor_link --create-only
```

Inspect the generated SQL — ensure it adds nullable columns + FK constraint. Then apply:

```bash
npx prisma migrate dev
```

If migration applies, run `npx prisma generate` to refresh client.

- [ ] **Step 4: Update DTOs**

`apps/api/src/modules/asset/dto/create-asset.dto.ts`:

```ts
@IsOptional()
@IsUUID()
vendorId?: string;

@IsOptional()
@IsNumber()
@IsPositive()
@Max(99999999.99)
vendorAmountPaid?: number;
```

Do the same in `update-asset.dto.ts`.

- [ ] **Step 5: Update service to persist**

In `apps/api/src/modules/asset/asset.service.ts` `create` and `update` methods, ensure `vendorId` and `vendorAmountPaid` are passed through to `prisma.fixedAsset.create/update` calls. Set `vendorAmountPaid` via `Prisma.Decimal(dto.vendorAmountPaid)` if provided.

- [ ] **Step 6: Frontend schema update**

`apps/web/src/pages/assets/schema.ts` — add to the zod schema:

```ts
vendorId: z.string().uuid().optional(),
vendorAmountPaid: z.number().nonnegative().max(99999999.99).optional(),
```

- [ ] **Step 7: Add useSuppliers query helper**

`apps/web/src/pages/assets/api.ts` — add (near the existing exports):

```ts
import type { Supplier } from '@/pages/SuppliersPage/types';
// (Adjust import path to where Supplier type lives — verify with grep first)

export const useSuppliersList = () => {
  // delegate to existing /suppliers API — minimal helper for the combobox
  return assetsApi.suppliersList();
};

// Add inside assetsApi const:
suppliersList: async (): Promise<Supplier[]> => {
  const { data } = await api.get('/suppliers', { params: { limit: 500 } });
  // unwrap paginated response if needed
  return Array.isArray(data) ? data : data.data ?? [];
},
suppliersCreate: async (input: { name: string; taxId?: string }): Promise<Supplier> => {
  const { data } = await api.post<Supplier>('/suppliers', input);
  return data;
},
```

If `Supplier` type is unavailable to import, declare a local minimal interface in `apps/web/src/pages/assets/types.ts`:

```ts
export interface SupplierLite {
  id: string;
  name: string;
  taxId?: string;
}
```

And use `SupplierLite` in the helper signatures.

- [ ] **Step 8: Write failing component test**

Create `apps/web/src/pages/assets/__tests__/AssetEntrySection3Vendor.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FormProvider, useForm } from 'react-hook-form';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { AssetEntrySection3Vendor } from '../components/AssetEntrySection3Vendor';

vi.mock('../api', () => ({
  assetsApi: {
    suppliersList: vi.fn().mockResolvedValue([
      { id: 'sup-1', name: 'ABC Trading', taxId: '0105561234567' },
      { id: 'sup-2', name: 'XYZ Co.,Ltd.', taxId: '0105567654321' },
    ]),
    suppliersCreate: vi.fn().mockResolvedValue({ id: 'sup-new', name: 'New Vendor', taxId: '' }),
  },
}));

function Wrapper({ children }: { children: React.ReactNode }) {
  const methods = useForm({ defaultValues: { vendorId: '', vendorName: '', vendorTaxId: '', vendorAmountPaid: 0 } });
  return <FormProvider {...methods}>{children}</FormProvider>;
}

const renderSection = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Wrapper><AssetEntrySection3Vendor /></Wrapper>
    </QueryClientProvider>,
  );
};

describe('AssetEntrySection3Vendor — P6 supplier integration', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists suppliers in combobox', async () => {
    renderSection();
    fireEvent.click(await screen.findByRole('combobox', { name: /ผู้ขาย/ }));
    expect(await screen.findByText('ABC Trading')).toBeInTheDocument();
    expect(await screen.findByText('XYZ Co.,Ltd.')).toBeInTheDocument();
  });

  it('auto-fills taxId when supplier selected', async () => {
    renderSection();
    fireEvent.click(await screen.findByRole('combobox', { name: /ผู้ขาย/ }));
    fireEvent.click(await screen.findByText('ABC Trading'));
    await waitFor(() => {
      const taxIdInput = screen.getByLabelText(/เลขประจำตัวผู้เสียภาษี/) as HTMLInputElement;
      expect(taxIdInput.value).toBe('0105561234567');
    });
  });

  it('shows "+ เพิ่มผู้ขายใหม่" option in empty search', async () => {
    renderSection();
    fireEvent.click(await screen.findByRole('combobox', { name: /ผู้ขาย/ }));
    expect(await screen.findByText(/เพิ่มผู้ขายใหม่/)).toBeInTheDocument();
  });

  it('has "จำนวนเงินที่จ่าย" input', async () => {
    renderSection();
    expect(await screen.findByLabelText(/จำนวนเงินที่จ่าย/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 9: Run test → confirm FAIL**

```bash
cd apps/web && npx vitest run src/pages/assets/__tests__/AssetEntrySection3Vendor.test.tsx
```

Expected: FAIL — Section 3 still uses plain Input.

- [ ] **Step 10: Refactor `AssetEntrySection3Vendor.tsx`**

Replace the existing `<Input>` for vendor name with a Combobox (use the shadcn/ui Command component or existing Combobox helper if available). Wire `useQuery(['suppliers'], assetsApi.suppliersList)`. On supplier select, `setValue('vendorId', supplier.id)`, `setValue('vendorName', supplier.name)`, `setValue('vendorTaxId', supplier.taxId ?? '')`.

In the empty-search state of the Combobox dropdown, show a "+ เพิ่มผู้ขายใหม่" action button. Clicking it opens a small inline form (or shadcn Dialog) that takes `name` + optional `taxId`, calls `assetsApi.suppliersCreate(...)`, then auto-selects the new vendor.

Below the existing vendor fields, add:

```tsx
<div>
  <Label htmlFor="vendor-amount-paid">จำนวนเงินที่จ่าย</Label>
  <Input
    id="vendor-amount-paid"
    type="number"
    step="0.01"
    {...register('vendorAmountPaid', { valueAsNumber: true })}
  />
  <p className="text-xs text-muted-foreground mt-1">
    หากชำระบางส่วน ระบบจะแสดงเป็น เจ้าหนี้ ใน JE preview
  </p>
</div>
```

- [ ] **Step 11: Run test → confirm PASS**

```bash
cd apps/web && npx vitest run src/pages/assets/__tests__/AssetEntrySection3Vendor.test.tsx
```

Expected: 4 PASS.

- [ ] **Step 12: Type check**

```bash
./tools/check-types.sh all
```

Expected: 0 errors (api + web).

- [ ] **Step 13: Commit**

```bash
git add -A
git commit -m "feat(assets): P6 vendor master integration + partial payment field"
```

---

## Task 6: P7 Permission UI + JSON Persist (TDD)

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (add `permissionConfig Json @default("[]")`)
- Modify: existing migration from Task 5 OR add new migration `2026XXXX_asset_permission_config/migration.sql`
- Modify: DTO files (accept `permissionConfig` array)
- Modify: `apps/api/src/modules/asset/asset.service.ts` (persist permissionConfig; one-time backfill from approverId on first save)
- Create: `apps/api/src/modules/asset/__tests__/asset-permission-config.spec.ts`
- Modify: `apps/web/src/pages/assets/schema.ts` (add zod schema for permissionConfig)
- Modify: `apps/web/src/pages/assets/types.ts` (add `PermissionConfigEntry`)
- Rename: `AssetEntrySection5Approver.tsx` → `AssetEntrySection5Permission.tsx`
- Modify: `apps/web/src/pages/assets/AssetEntryPage.tsx` (update import)
- Create: `apps/web/src/pages/assets/__tests__/AssetEntrySection5Permission.test.tsx`

- [ ] **Step 1: Add Prisma JSON field**

In `apps/api/prisma/schema.prisma` `model FixedAsset`:

```prisma
permissionConfig Json @default("[]") @map("permission_config")
```

Keep existing `approverId` column for backward compat.

- [ ] **Step 2: Generate + apply migration**

```bash
cd apps/api && npx prisma migrate dev --name asset_permission_config
```

The generated SQL will add column `permission_config jsonb NOT NULL DEFAULT '[]'`. Verify before applying.

- [ ] **Step 3: Update DTOs**

`apps/api/src/modules/asset/dto/create-asset.dto.ts`:

```ts
class PermissionConfigEntryDto {
  @IsUUID()
  userId!: string;
  @IsBoolean()
  canView!: boolean;
  @IsBoolean()
  canEdit!: boolean;
  @IsBoolean()
  canPost!: boolean;
}

@IsOptional()
@IsArray()
@ValidateNested({ each: true })
@Type(() => PermissionConfigEntryDto)
permissionConfig?: PermissionConfigEntryDto[];
```

Add to `update-asset.dto.ts` similarly.

- [ ] **Step 4: Write failing backend test**

Create `apps/api/src/modules/asset/__tests__/asset-permission-config.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { validate } from 'class-validator';
import { plainToClass } from 'class-transformer';
import { CreateAssetDto } from '../dto/create-asset.dto';

describe('CreateAssetDto — permissionConfig', () => {
  it('accepts valid permissionConfig array', async () => {
    const dto = plainToClass(CreateAssetDto, {
      // minimal valid payload — fill required fields
      name: 'Test Asset',
      category: 'EQUIPMENT',
      purchaseDate: '2026-05-15',
      branchId: '00000000-0000-0000-0000-000000000001',
      purchaseCost: 10000,
      installationCost: 0,
      otherCost: 0,
      usefulLifeMonths: 36,
      paymentMethod: 'CASH',
      paymentAccount: '11-1101',
      vendorName: 'Test Vendor',
      hasVat: false,
      hasWht: false,
      permissionConfig: [
        { userId: '11111111-1111-1111-1111-111111111111', canView: true, canEdit: true, canPost: true },
        { userId: '22222222-2222-2222-2222-222222222222', canView: true, canEdit: false, canPost: false },
      ],
    });
    const errors = await validate(dto);
    expect(errors.filter((e) => e.property === 'permissionConfig')).toHaveLength(0);
  });

  it('rejects invalid userId (not UUID)', async () => {
    const dto = plainToClass(CreateAssetDto, {
      // minimum required fields omitted for brevity — assume controller layer validates separately
      permissionConfig: [{ userId: 'not-a-uuid', canView: true, canEdit: true, canPost: true }],
    } as Record<string, unknown>);
    const errors = await validate(dto);
    const permissionErrors = errors.flatMap((e) => e.children ?? []).flatMap((c) => c.children ?? []);
    expect(permissionErrors.some((e) => e.property === 'userId')).toBe(true);
  });

  it('treats permissionConfig as optional (no error when omitted)', async () => {
    const dto = plainToClass(CreateAssetDto, {
      name: 'Test Asset',
      category: 'EQUIPMENT',
      purchaseDate: '2026-05-15',
      branchId: '00000000-0000-0000-0000-000000000001',
      purchaseCost: 10000,
      installationCost: 0,
      otherCost: 0,
      usefulLifeMonths: 36,
      paymentMethod: 'CASH',
      paymentAccount: '11-1101',
      vendorName: 'Test Vendor',
      hasVat: false,
      hasWht: false,
    });
    const errors = await validate(dto);
    expect(errors.filter((e) => e.property === 'permissionConfig')).toHaveLength(0);
  });
});
```

- [ ] **Step 5: Run test → confirm FAIL**

```bash
cd apps/api && npx jest src/modules/asset/__tests__/asset-permission-config.spec.ts
```

Expected: FAIL until DTO is updated.

- [ ] **Step 6: Run test again → confirm PASS after Step 3**

If you have already updated the DTO in Step 3, the test should now PASS. Otherwise, finalize DTO update and re-run.

- [ ] **Step 7: Update service**

In `apps/api/src/modules/asset/asset.service.ts`:

- `create`: if `dto.permissionConfig` provided, persist as-is. If omitted but `dto.approverId` provided (legacy callers), backfill `permissionConfig = [{ userId: approverId, canView: true, canEdit: false, canPost: true }]`.
- `update`: same logic — replace `permissionConfig` array entirely on update.

- [ ] **Step 8: Frontend types + schema**

`apps/web/src/pages/assets/types.ts`:

```ts
export interface PermissionConfigEntry {
  userId: string;
  canView: boolean;
  canEdit: boolean;
  canPost: boolean;
}
```

`apps/web/src/pages/assets/schema.ts`:

```ts
permissionConfig: z.array(z.object({
  userId: z.string().uuid(),
  canView: z.boolean(),
  canEdit: z.boolean(),
  canPost: z.boolean(),
})).default([]),
```

Remove `approverId` from the form schema (it remains in the DB but the UI no longer manages it directly — the migration in Step 7 handles it).

- [ ] **Step 9: Rename + rewrite Section 5 component**

```bash
git mv apps/web/src/pages/assets/components/AssetEntrySection5Approver.tsx apps/web/src/pages/assets/components/AssetEntrySection5Permission.tsx
```

Rewrite the file:

```tsx
import { useFormContext } from 'react-hook-form';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ShieldCheck, UserPlus, X, Info } from 'lucide-react';
import api from '@/lib/api';
import type { AssetEntryFormValues } from '../schema';
import { AssetSectionHeader } from './AssetSectionHeader';

interface User {
  id: string;
  name: string;
  role: string;
}

export function AssetEntrySection5Permission() {
  const { watch, setValue } = useFormContext<AssetEntryFormValues>();
  const permissions = watch('permissionConfig') ?? [];

  const usersQuery = useQuery({
    queryKey: ['users', 'asset-permission'],
    queryFn: async () => {
      const res = await api.get('/users', { params: { limit: 500 } });
      const list: User[] = res.data?.data ?? (Array.isArray(res.data) ? res.data : []);
      return list;
    },
  });

  const addUser = (userId: string) => {
    if (permissions.some((p) => p.userId === userId)) return;
    setValue('permissionConfig', [
      ...permissions,
      { userId, canView: true, canEdit: false, canPost: false },
    ], { shouldDirty: true });
  };

  const removeUser = (userId: string) => {
    setValue('permissionConfig', permissions.filter((p) => p.userId !== userId), { shouldDirty: true });
  };

  const togglePerm = (userId: string, key: 'canView' | 'canEdit' | 'canPost') => {
    setValue('permissionConfig',
      permissions.map((p) => p.userId === userId ? { ...p, [key]: !p[key] } : p),
      { shouldDirty: true });
  };

  const userMap = new Map(usersQuery.data?.map((u) => [u.id, u]) ?? []);
  const availableUsers = (usersQuery.data ?? []).filter((u) => !permissions.some((p) => p.userId === u.id));

  return (
    <Card>
      <AssetSectionHeader
        icon={<ShieldCheck className="size-5" />}
        title="กำหนดสิทธิ์ (Permission)"
        subtitle="กำหนดว่าใครมีสิทธิ์ดู / แก้ไข / ลงบัญชี เอกสารนี้"
      />
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2">
          <Select value="" onValueChange={(v) => v && addUser(v)}>
            <SelectTrigger aria-label="เพิ่มผู้ใช้" className="max-w-xs">
              <SelectValue placeholder="+ เพิ่มผู้ใช้" />
            </SelectTrigger>
            <SelectContent>
              {availableUsers.length === 0 ? (
                <div className="px-2 py-1.5 text-sm text-muted-foreground">ไม่มีผู้ใช้เพิ่มเติม</div>
              ) : (
                availableUsers.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name} <span className="text-xs text-muted-foreground ml-2">{u.role}</span>
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
          <UserPlus className="size-4 text-muted-foreground" />
        </div>

        {permissions.length === 0 ? (
          <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            ยังไม่มีผู้ใช้ในรายการสิทธิ์ · ใช้ปุ่ม "+ เพิ่มผู้ใช้" ด้านบนเพื่อระบุ
          </div>
        ) : (
          <div className="space-y-2">
            {permissions.map((perm) => {
              const user = userMap.get(perm.userId);
              return (
                <div key={perm.userId} className="rounded-lg border p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-medium">{user?.name ?? perm.userId}</div>
                      <div className="text-xs text-muted-foreground">{user?.role ?? '—'}</div>
                    </div>
                    <Button type="button" variant="ghost" size="sm" onClick={() => removeUser(perm.userId)} aria-label="ลบ">
                      <X className="size-4" />
                    </Button>
                  </div>
                  <div className="flex items-center gap-4 pl-1">
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox checked={perm.canView} onCheckedChange={() => togglePerm(perm.userId, 'canView')} />
                      ดู (view)
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox checked={perm.canEdit} onCheckedChange={() => togglePerm(perm.userId, 'canEdit')} />
                      แก้ไข (edit)
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox checked={perm.canPost} onCheckedChange={() => togglePerm(perm.userId, 'canPost')} />
                      ลงบัญชี (post)
                    </label>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/50 rounded-lg p-3">
          <Info className="size-4 shrink-0 mt-0.5" />
          <span>
            การกำหนดสิทธิ์นี้บันทึกเป็น metadata ของเอกสาร · การบังคับสิทธิ์ที่ระดับ API จะเพิ่มในเฟสถัดไป
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 10: Update AssetEntryPage import**

`apps/web/src/pages/assets/AssetEntryPage.tsx`:

```ts
import { AssetEntrySection5Permission } from './components/AssetEntrySection5Permission';
```

And in render:

```tsx
<AssetEntrySection5Permission />
```

(replacing the `<AssetEntrySection5Approver />`)

- [ ] **Step 11: Write failing frontend test**

Create `apps/web/src/pages/assets/__tests__/AssetEntrySection5Permission.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FormProvider, useForm } from 'react-hook-form';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { AssetEntrySection5Permission } from '../components/AssetEntrySection5Permission';

vi.mock('@/lib/api', () => ({
  default: {
    get: vi.fn().mockResolvedValue({
      data: { data: [
        { id: 'u1', name: 'สุทธินีย์ คงเดช', role: 'OWNER' },
        { id: 'u2', name: 'เอกนรินทร์ คงเดช', role: 'FINANCE_MANAGER' },
      ]},
    }),
  },
}));

function Wrapper({ children }: { children: React.ReactNode }) {
  const methods = useForm({ defaultValues: { permissionConfig: [] } });
  return <FormProvider {...methods}>{children}</FormProvider>;
}

const renderSection = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Wrapper><AssetEntrySection5Permission /></Wrapper>
    </QueryClientProvider>,
  );
};

describe('AssetEntrySection5Permission — P7 permission UI', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders section header "กำหนดสิทธิ์ (Permission)"', async () => {
    renderSection();
    expect(await screen.findByText(/กำหนดสิทธิ์/)).toBeInTheDocument();
  });

  it('shows empty state when no permissions set', async () => {
    renderSection();
    expect(await screen.findByText(/ยังไม่มีผู้ใช้ในรายการสิทธิ์/)).toBeInTheDocument();
  });

  it('shows lightweight enforcement disclaimer', async () => {
    renderSection();
    expect(await screen.findByText(/บังคับสิทธิ์ที่ระดับ API จะเพิ่มในเฟสถัดไป/)).toBeInTheDocument();
  });

  it('does NOT show legacy approver dropdown text "ผู้อนุมัติ"', async () => {
    renderSection();
    await screen.findByText(/กำหนดสิทธิ์/);
    expect(screen.queryByText(/^ผู้อนุมัติ$/)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 12: Run test → confirm PASS (since Step 9 component already passes the assertions)**

```bash
cd apps/web && npx vitest run src/pages/assets/__tests__/AssetEntrySection5Permission.test.tsx
```

Expected: 4 PASS.

- [ ] **Step 13: Type check + commit**

```bash
./tools/check-types.sh all
```

Expected: 0 errors.

```bash
git add -A
git commit -m "feat(assets): P7 Permission settings UI (replaces approver flow)"
```

---

## Task 7: Final Integration Verification

**Files:** none (verification only)

- [ ] **Step 1: Full type check**

```bash
./tools/check-types.sh all
```

Expected: 0 errors.

- [ ] **Step 2: All new tests + asset module regression**

```bash
cd apps/api && npx jest src/modules/asset/__tests__/asset-permission-config.spec.ts
cd ../web && npx vitest run src/pages/assets/__tests__/
```

Expected: all new tests PASS (3 + 4 + 4 + 3 = 14 tests minimum from this PR, plus prior PR #845's 3 — total 17 vitest passing). Asset module regression no worse than pre-PR (still passing same set).

- [ ] **Step 3: NBV grep verification (final P8 sweep)**

```bash
grep -rn "'NBV'\|>NBV<" apps/web/src/pages/assets apps/web/src/pages/depreciation | grep -v "//\|netBookValue\|nbv\b" | wc -l
```

Expected: 0.

- [ ] **Step 4: Manual UAT script (post-deploy, before sign-off)**

For each role [OWNER, FINANCE_MANAGER, ACCOUNTANT]:

1. `/assets` → see 4 stat cards in Thai (ทั้งหมด / รอดำเนินการ / ลงบัญชี / ยกเลิก) — P3
2. `/assets` → no horizontal Tab Bar above content — P4
3. `/assets/new` → Section 2 → label reads "ต้นทุนสินทรัพย์อื่น ๆ (ค่า capitalize อื่น)" — P5
4. `/assets/new` → Section 3 → click vendor combobox → see existing suppliers list → select one → taxId auto-fills — P6
5. `/assets/new` → Section 3 → type new name not in list → "+ เพิ่มผู้ขายใหม่" appears → save new vendor → auto-selected — P6
6. `/assets/new` → Section 3 → enter "จำนวนเงินที่จ่าย" = 5000 → submit asset → confirm `vendorAmountPaid` persisted (check via GET asset detail) — P6
7. `/assets/new` → Section 5 → see "กำหนดสิทธิ์ (Permission)" header (not "ผู้อนุมัติ") → "+ เพิ่มผู้ใช้" picker → add 2 users with different view/edit/post combinations → submit → reload → permissions preserved — P7
8. `/assets/register` → column header reads "มูลค่าตามบัญชีสุทธิ (NBV)" — P8
9. `/assets/summary-report` → tab content shows "มูลค่าตามบัญชีสุทธิ (NBV)" labels — P8
10. `/assets/:id/schedule` → "มูลค่าตามบัญชีสุทธิ (NBV)" column header — P8

- [ ] **Step 5: No additional commit. Branch is ready for PR.**

---

## Out of Scope (Explicitly Deferred per Spec §11)

- P7 enforcement at API endpoints (Phase ถัดไป)
- AP aging integration with vendor (future)
- Removing legacy `approverId` column (kept for backward compat)
- Pagination UI on Audit Log (PR #845 deferred I4)
- P9-P17 → PR 2b

---

## Self-Review Notes

- **Spec coverage:** P3 ✓ (Task 2), P4 ✓ (Task 1), P5 ✓ (Task 3), P8 ✓ (Task 4), P6 ✓ (Task 5), P7 ✓ (Task 6), verification ✓ (Task 7)
- **Tests:** 3 frontend P3 + 4 frontend P6 + 4 frontend P7 + 3 backend P7 = 14 new tests
- **Commits:** ~6 (one per substantive task — Task 1 is no-op, Task 7 is verification)
- **TDD applied** for P3, P6, P7 (the 3 user-facing changes with non-trivial behavior); P5+P8 are text-only so type check is sufficient
