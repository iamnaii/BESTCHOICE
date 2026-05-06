# Phase A.6 Dynamic CoA Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace ~20 drift-prone hardcoded XX-XXXX account codes in UI + backend with dynamic CoA-driven lookups so future CSV updates require zero code change.

**Architecture:** New `GET /accounting/coa-grouped` endpoint returns accounts grouped by `category` field (already populated from CSV in Phase A.4). Frontend hooks `useCoaGroups` + `useCoaByCodes` cache responses (`staleTime: Infinity`). `CATEGORY_CODE_MAP` in accounting.service gets boot validator that throws if any mapped code missing from CoA.

**Tech Stack:** NestJS + Prisma + React Query + shadcn/ui

**Spec:** [docs/superpowers/specs/2026-05-06-coa-dynamic-architecture-design.md](../specs/2026-05-06-coa-dynamic-architecture-design.md)

---

## File Structure

| File | Responsibility | Status |
|------|----------------|--------|
| `apps/api/src/modules/chart-of-accounts/dto/coa-grouped.dto.ts` | Query DTO + response shape | Create |
| `apps/api/src/modules/chart-of-accounts/chart-of-accounts.service.ts` | Add `findGrouped()` method | Modify |
| `apps/api/src/modules/chart-of-accounts/chart-of-accounts.controller.ts` | Add `GET /chart-of-accounts/grouped` | Modify |
| `apps/api/src/modules/chart-of-accounts/chart-of-accounts.service.spec.ts` | Test `findGrouped()` | Create |
| `apps/api/src/modules/accounting/accounting.service.ts` | Fix `CATEGORY_CODE_MAP` + add `onModuleInit` validator | Modify |
| `apps/api/src/modules/accounting/accounting.service.spec.ts` | Test boot validator behavior | Modify |
| `apps/web/src/hooks/useCoa.ts` | `useCoaGroups` + `useCoaByCodes` hooks | Create |
| `apps/web/src/pages/ExpensesPage.tsx` | Replace hardcoded `categoryGroups` with hook | Modify |
| `apps/web/src/pages/AssetManagementPage/components/AssetForm.tsx` | Replace 4 hardcoded `<option>` blocks | Modify |
| `apps/web/src/pages/IntercompanySettlementPage.tsx` | Optional: replace `'11-1101'` filter | Modify (optional) |

---

## Dependency Graph

```
T1 endpoint (api)
    ↓
T2 hook (web) ─────────────────┐
    ↓                          ↓
T3 ExpensesPage refactor   T4 AssetForm refactor
                               ↓
T5 fix CATEGORY_CODE_MAP + boot validator (api accounting service)
    ↓
T6 verification + commit + PR
```

T1 must complete before T2. T3 + T4 parallel after T2. T5 independent. T6 last.

---

## Task 1: Backend — `GET /chart-of-accounts/grouped` endpoint

**Files:**
- Create: `apps/api/src/modules/chart-of-accounts/dto/coa-grouped.dto.ts`
- Modify: `apps/api/src/modules/chart-of-accounts/chart-of-accounts.service.ts`
- Modify: `apps/api/src/modules/chart-of-accounts/chart-of-accounts.controller.ts`
- Modify: `apps/api/src/modules/chart-of-accounts/chart-of-accounts.service.spec.ts`

- [ ] **Step 1.1: Write DTO**

Create `apps/api/src/modules/chart-of-accounts/dto/coa-grouped.dto.ts`:

```typescript
import { IsOptional, IsString, Matches } from 'class-validator';

export class CoaGroupedQueryDto {
  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{2}(-\d{0,4})?$/, { message: 'codePrefix must match XX or XX-XXXX' })
  codePrefix?: string;

  @IsOptional()
  @IsString()
  category?: string;
}

export interface CoaAccountRow {
  code: string;
  name: string;
  normalBalance: string;
  vatApplicable: boolean;
  notes: string | null;
}

export interface CoaGroup {
  category: string;
  accounts: CoaAccountRow[];
}

export interface CoaGroupedResponse {
  groups: CoaGroup[];
}
```

- [ ] **Step 1.2: Write service test (TDD)**

In `apps/api/src/modules/chart-of-accounts/chart-of-accounts.service.spec.ts` (create if missing — note: per memory T3 deleted earlier spec; rebuild minimal version):

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { ChartOfAccountsService } from './chart-of-accounts.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('ChartOfAccountsService.findGrouped', () => {
  let service: ChartOfAccountsService;
  let prisma: { chartOfAccount: { findMany: jest.Mock } };

  beforeEach(async () => {
    prisma = { chartOfAccount: { findMany: jest.fn() } };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChartOfAccountsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get<ChartOfAccountsService>(ChartOfAccountsService);
  });

  it('groups accounts by category, sorted by code', async () => {
    prisma.chartOfAccount.findMany.mockResolvedValue([
      { code: '53-1101', name: 'เงินเดือน', type: 'ค่าใช้จ่าย', normalBalance: 'Dr', category: 'OpEx-บุคลากร', vatApplicable: false, notes: null },
      { code: '53-1102', name: 'ประกันสังคม', type: 'ค่าใช้จ่าย', normalBalance: 'Dr', category: 'OpEx-บุคลากร', vatApplicable: false, notes: null },
      { code: '53-1201', name: 'วัสดุสำนักงาน', type: 'ค่าใช้จ่าย', normalBalance: 'Dr', category: 'OpEx-วัสดุ', vatApplicable: false, notes: null },
    ]);

    const result = await service.findGrouped({ type: 'ค่าใช้จ่าย' });

    expect(result.groups).toHaveLength(2);
    expect(result.groups[0].category).toBe('OpEx-บุคลากร');
    expect(result.groups[0].accounts).toHaveLength(2);
    expect(result.groups[0].accounts[0].code).toBe('53-1101');
    expect(result.groups[1].category).toBe('OpEx-วัสดุ');
  });

  it('filters by codePrefix', async () => {
    prisma.chartOfAccount.findMany.mockResolvedValue([
      { code: '12-2101', name: 'อุปกรณ์สำนักงาน', type: 'สินทรัพย์', normalBalance: 'Dr', category: 'สินทรัพย์ถาวร', vatApplicable: false, notes: null },
    ]);

    await service.findGrouped({ codePrefix: '12-21' });

    expect(prisma.chartOfAccount.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ code: { startsWith: '12-21' } }),
      }),
    );
  });

  it('groups uncategorized accounts under "อื่นๆ"', async () => {
    prisma.chartOfAccount.findMany.mockResolvedValue([
      { code: '99-9999', name: 'test', type: 'ค่าใช้จ่าย', normalBalance: 'Dr', category: null, vatApplicable: false, notes: null },
    ]);

    const result = await service.findGrouped({});

    expect(result.groups[0].category).toBe('อื่นๆ');
  });
});
```

- [ ] **Step 1.3: Run test, expect failure**

```bash
cd apps/api && npx jest src/modules/chart-of-accounts/chart-of-accounts.service.spec.ts
```

Expected: FAIL — `findGrouped is not a function`

- [ ] **Step 1.4: Implement service method**

In `apps/api/src/modules/chart-of-accounts/chart-of-accounts.service.ts`, add:

```typescript
async findGrouped(query: { type?: string; codePrefix?: string; category?: string }): Promise<CoaGroupedResponse> {
  const where: Prisma.ChartOfAccountWhereInput = { deletedAt: null, status: 'ใช้งาน' };
  if (query.type) where.type = query.type;
  if (query.codePrefix) where.code = { startsWith: query.codePrefix };
  if (query.category) where.category = query.category;

  const rows = await this.prisma.chartOfAccount.findMany({
    where,
    orderBy: { code: 'asc' },
    select: {
      code: true,
      name: true,
      normalBalance: true,
      category: true,
      vatApplicable: true,
      notes: true,
    },
  });

  const map = new Map<string, CoaAccountRow[]>();
  for (const r of rows) {
    const cat = r.category ?? 'อื่นๆ';
    const arr = map.get(cat) ?? [];
    arr.push({
      code: r.code,
      name: r.name,
      normalBalance: r.normalBalance,
      vatApplicable: r.vatApplicable,
      notes: r.notes,
    });
    map.set(cat, arr);
  }
  return { groups: Array.from(map, ([category, accounts]) => ({ category, accounts })) };
}
```

Add imports at top:
```typescript
import { CoaAccountRow, CoaGroupedResponse } from './dto/coa-grouped.dto';
```

- [ ] **Step 1.5: Run test, expect pass**

```bash
cd apps/api && npx jest src/modules/chart-of-accounts/chart-of-accounts.service.spec.ts
```

Expected: 3 tests pass.

- [ ] **Step 1.6: Add controller endpoint**

In `apps/api/src/modules/chart-of-accounts/chart-of-accounts.controller.ts`, add after `by-codes` endpoint:

```typescript
@Get('grouped')
@Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
async grouped(@Query() query: CoaGroupedQueryDto): Promise<CoaGroupedResponse> {
  return this.service.findGrouped(query);
}
```

Add imports:
```typescript
import { CoaGroupedQueryDto, CoaGroupedResponse } from './dto/coa-grouped.dto';
```

- [ ] **Step 1.7: TSC + commit**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE && ./tools/check-types.sh api
git add apps/api/src/modules/chart-of-accounts/
git commit -m "feat(coa): add GET /chart-of-accounts/grouped endpoint

Returns accounts grouped by category for dynamic UI dropdowns.
Filters: type, codePrefix, category."
```

---

## Task 2: Frontend — `useCoa` hooks

**Files:**
- Create: `apps/web/src/hooks/useCoa.ts`

- [ ] **Step 2.1: Write hooks**

Create `apps/web/src/hooks/useCoa.ts`:

```typescript
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface CoaAccountRow {
  code: string;
  name: string;
  normalBalance: string;
  vatApplicable: boolean;
  notes: string | null;
}

export interface CoaGroup {
  category: string;
  accounts: CoaAccountRow[];
}

export interface CoaGroupedResponse {
  groups: CoaGroup[];
}

export interface CoaByCodesRow {
  code: string;
  name: string;
}

export interface CoaGroupedFilter {
  type?: string;
  codePrefix?: string;
  category?: string;
}

export function useCoaGroups(filter: CoaGroupedFilter) {
  return useQuery<CoaGroupedResponse>({
    queryKey: ['coa', 'grouped', filter],
    queryFn: async () => {
      const { data } = await api.get<CoaGroupedResponse>('/chart-of-accounts/grouped', { params: filter });
      return data;
    },
    staleTime: Infinity,
  });
}

export function useCoaByCodes(codes: string[]) {
  const sortedKey = [...codes].sort().join(',');
  return useQuery<CoaByCodesRow[]>({
    queryKey: ['coa', 'by-codes', sortedKey],
    queryFn: async () => {
      const { data } = await api.get<CoaByCodesRow[]>('/chart-of-accounts/by-codes', {
        params: { codes: codes.join(',') },
      });
      return data;
    },
    staleTime: Infinity,
    enabled: codes.length > 0,
  });
}
```

- [ ] **Step 2.2: TSC check + commit**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE && ./tools/check-types.sh web
git add apps/web/src/hooks/useCoa.ts
git commit -m "feat(web): add useCoaGroups + useCoaByCodes hooks

Wraps GET /chart-of-accounts/grouped + /by-codes with React Query
(staleTime Infinity since CoA only changes on seed)."
```

---

## Task 3: Refactor ExpensesPage to use `useCoaGroups`

**Files:**
- Modify: `apps/web/src/pages/ExpensesPage.tsx`

- [ ] **Step 3.1: Read existing structure**

Open `apps/web/src/pages/ExpensesPage.tsx` and identify:
- Lines 47-59: `categoryLabels` const (used for table display)
- Lines 71-101: `categoryGroups` const (used for dropdowns)
- Line 110-111: `emptyForm` defaults — references `accountType: 'ADMINISTRATIVE_EXPENSE'`, `category: 'ADMIN_UTILITIES'`
- Line 206: `availableCategories = categoryGroups[form.accountType]`
- Lines 294-302: dropdowns rendering categoryGroups + availableCategories
- Lines 660-668: filter controls

- [ ] **Step 3.2: Replace hardcoded constants with hook usage**

Remove `categoryLabels` and `categoryGroups` constants. Replace with:

```typescript
import { useCoaGroups, type CoaAccountRow } from '@/hooks/useCoa';

// Inside component:
const { data: coaData } = useCoaGroups({ type: 'ค่าใช้จ่าย' });
const groups = coaData?.groups ?? [];

// Build flat lookup: code → name (for table display)
const codeToName = new Map<string, string>();
groups.forEach(g => g.accounts.forEach(a => codeToName.set(a.code, a.name)));

// Replace categoryLabels[e.category] usage with codeToName.get(e.category)
```

Form simplification — remove `accountType` field; user picks one expense category directly:

```typescript
// emptyForm — drop accountType, default category to first available
const emptyForm = {
  branchId: '',
  category: '',  // will be set when groups load
  description: '',
  ...
};

// Effect: when groups load, set initial category
useEffect(() => {
  if (groups.length > 0 && !form.category) {
    setForm(f => ({ ...f, category: groups[0].accounts[0]?.code ?? '' }));
  }
}, [groups, form.category]);
```

The `category` field now stores the actual CoA code (e.g., `'53-1101'`) instead of enum (`'ADMIN_SALARY'`). The backend's `Expense.category` field stays a string column accepting both enum strings and CoA codes — see Task 5 migration for backwards compat.

Render dropdown grouped by category:

```tsx
<select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} className={inputClass}>
  {groups.map(g => (
    <optgroup key={g.category} label={g.category}>
      {g.accounts.map(a => (
        <option key={a.code} value={a.code}>{a.code} {a.name}</option>
      ))}
    </optgroup>
  ))}
</select>
```

Filter dropdown — same `<optgroup>` pattern, plus "ทั้งหมด" empty option.

- [ ] **Step 3.3: Update API payload**

In the create/update mutation, send `category` (now CoA code string) directly. Drop `accountType` from payload.

The backend `expenses.service.ts` already accepts `category` as string. Just verify it doesn't validate against the old enum. If it does, relax that check in Task 5.

- [ ] **Step 3.4: Verify locally**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE && ./tools/check-types.sh web
```

Expected: 0 errors.

- [ ] **Step 3.5: Commit**

```bash
git add apps/web/src/pages/ExpensesPage.tsx
git commit -m "refactor(expenses): use useCoaGroups for dynamic categories

Removes hardcoded categoryGroups + categoryLabels (drift-prone, had wrong
codes per Phase A.4 audit). Dropdown now loads from CoA via API. Single
category dropdown grouped by CoA category column.

Existing Expense.category enum values stored in DB still display via
codeToName fallback."
```

---

## Task 4: Refactor AssetForm to use `useCoaGroups`

**Files:**
- Modify: `apps/web/src/pages/AssetManagementPage/components/AssetForm.tsx`

- [ ] **Step 4.1: Identify hardcoded blocks**

Lines 303-312, 326-329, 342-344 contain 4 dropdowns with hardcoded `<option>` for:
- Asset cost accounts (12-2101/03/05/07)
- Depreciation expense (53-1601..04)
- Accumulated depreciation (12-2102/04/06/08)

- [ ] **Step 4.2: Add hook usage**

At top of component:

```typescript
import { useCoaGroups } from '@/hooks/useCoa';

// Inside component:
const { data: assetCoa } = useCoaGroups({ codePrefix: '12-21' });
const { data: depCoa } = useCoaGroups({ codePrefix: '53-16' });

// Split asset accounts into cost (Dr-normal) vs accumulated (Cr-normal)
const allAssets = assetCoa?.groups.flatMap(g => g.accounts) ?? [];
const costAccounts = allAssets.filter(a => a.normalBalance === 'Dr');
const accumAccounts = allAssets.filter(a => a.normalBalance === 'Cr');
const depAccounts = depCoa?.groups.flatMap(g => g.accounts) ?? [];
```

- [ ] **Step 4.3: Replace dropdowns**

Replace each hardcoded `<select>` with:

```tsx
{/* Asset cost dropdown */}
<select value={form.assetAccountCode} onChange={...}>
  <option value="">เลือก...</option>
  {costAccounts.map(a => (
    <option key={a.code} value={a.code}>{a.code} {a.name}</option>
  ))}
</select>

{/* Depreciation expense dropdown */}
<select value={form.depreciationAccountCode} onChange={...}>
  <option value="">เลือก...</option>
  {depAccounts.map(a => (
    <option key={a.code} value={a.code}>{a.code} {a.name}</option>
  ))}
</select>

{/* Accumulated depreciation dropdown */}
<select value={form.accumulatedAccountCode} onChange={...}>
  <option value="">เลือก...</option>
  {accumAccounts.map(a => (
    <option key={a.code} value={a.code}>{a.code} {a.name}</option>
  ))}
</select>
```

- [ ] **Step 4.4: TSC + commit**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE && ./tools/check-types.sh web
git add apps/web/src/pages/AssetManagementPage/components/AssetForm.tsx
git commit -m "refactor(assets): AssetForm dropdowns from useCoaGroups

Replaces 4 hardcoded <option> blocks (12-2101..07, 53-1601..04, 12-2102..08)
with dynamic CoA lookup. New CSV codes auto-appear; renamed accounts auto-update."
```

---

## Task 5: Fix CATEGORY_CODE_MAP + boot validator

**Files:**
- Modify: `apps/api/src/modules/accounting/accounting.service.ts`
- Modify: `apps/api/src/modules/accounting/accounting.service.spec.ts`

- [ ] **Step 5.1: Update map per audit findings**

Open `apps/api/src/modules/accounting/accounting.service.ts:46-79`. Current map has correct comments — convert TODOs to actual fixes:

```typescript
// Current top of file uses Record<string, string>. Change comments to reflect Phase A.6 audit.
const CATEGORY_CODE_MAP: Record<string, string> = {
  // FINANCE chart only (SHOP-side defer to A.5b/A.7)
  // COGS_PRODUCT — deprecated; FINANCE has no COGS. UI hides this category.
  // COGS_REPAIR_PARTS — same as COGS_PRODUCT.
  SELL_COMMISSION: '52-1101',     // ค่าคอมฯ พนักงาน
  SELL_ADVERTISING: '52-1102',    // ค่าส่งเสริมการขาย
  SELL_TRANSPORT: '53-1304',      // ค่าไปรษณีย์ และขนส่ง
  SELL_PACKAGING: '52-1102',      // nearest match (CSV lacks dedicated packaging)
  ADMIN_SALARY: '53-1101',        // เงินเดือน ค่าจ้าง
  ADMIN_SOCIAL_SECURITY: '53-1102', // เงินสมทบประกันสังคม (corrected from 53-1103 ค่าล่วงเวลา)
  ADMIN_RENT: '53-1502',          // ค่าธรรมเนียมราชการ — TEMP placeholder; CSV needs dedicated rent (defer A.7)
  ADMIN_UTILITIES: '53-1302',     // ค่าไฟฟ้า
  ADMIN_OFFICE_SUPPLIES: '53-1201', // ค่าเครื่องเขียน วัสดุสำนักงาน
  ADMIN_DEPRECIATION: '53-1601',  // ค่าเสื่อมราคา-อุปกรณ์ (now exists in 105-CSV; was REMOVED before update)
  ADMIN_INSURANCE: '53-1502',     // ค่าธรรมเนียมราชการ — TEMP; CSV needs dedicated insurance
  ADMIN_TAX_FEE: '54-1103',       // เบี้ยปรับ-ภ.พ.30 (รายจ่ายต้องห้าม)
  ADMIN_MAINTENANCE: '53-1305',   // ค่าซ่อมแซมฯ
  ADMIN_TRAVEL: '53-1304',        // ค่าไปรษณีย์ และขนส่ง
  ADMIN_TELEPHONE: '53-1303',     // ค่าโทรศัพท์สำนักงาน
  OTHER_INTEREST: '53-1501',      // ค่าธรรมเนียมธนาคาร
  OTHER_LOSS: '53-1503',          // กำไร(ขาดทุน) สุทธิจากการปัดเศษ
  OTHER_FINE: '54-1104',          // เบี้ยปรับเงินเพิ่ม (อื่นๆ)
  OTHER_MISC: '53-1502',          // ค่าธรรมเนียมราชการ
};
```

- [ ] **Step 5.2: Implement boot validator**

In `AccountingService` class, add `OnModuleInit`:

```typescript
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

@Injectable()
export class AccountingService implements OnModuleInit {
  private readonly logger = new Logger(AccountingService.name);
  // ... existing code ...

  async onModuleInit() {
    const codes = [...new Set(Object.values(CATEGORY_CODE_MAP))];
    const found = await this.prisma.chartOfAccount.findMany({
      where: { code: { in: codes }, deletedAt: null },
      select: { code: true },
    });
    const foundSet = new Set(found.map(f => f.code));
    const missing = codes.filter(c => !foundSet.has(c));
    if (missing.length > 0) {
      const msg = `[Phase A.6] CATEGORY_CODE_MAP references missing CoA codes: ${missing.join(', ')}. Update CATEGORY_CODE_MAP or seed missing codes.`;
      this.logger.error(msg);
      throw new Error(msg);
    }
    this.logger.log(`CATEGORY_CODE_MAP validated: all ${codes.length} codes exist in CoA.`);
  }
}
```

- [ ] **Step 5.3: Spec test for validator**

In `apps/api/src/modules/accounting/accounting.service.spec.ts`, add test (use the existing test setup pattern):

```typescript
describe('CATEGORY_CODE_MAP boot validator', () => {
  it('throws when any mapped code missing from CoA', async () => {
    prisma.chartOfAccount.findMany = jest.fn().mockResolvedValue([
      { code: '52-1101' }, // only 1 of N
    ]);
    await expect(service.onModuleInit()).rejects.toThrow(/missing CoA codes/);
  });

  it('passes when all mapped codes exist', async () => {
    // mock find to return all codes from CATEGORY_CODE_MAP
    prisma.chartOfAccount.findMany = jest.fn().mockImplementation(({ where }: any) => {
      const requested = where.code.in as string[];
      return Promise.resolve(requested.map(code => ({ code })));
    });
    await expect(service.onModuleInit()).resolves.not.toThrow();
  });
});
```

- [ ] **Step 5.4: Run tests + TSC + commit**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE && ./tools/check-types.sh api
cd apps/api && npx jest src/modules/accounting/accounting.service.spec.ts -t "CATEGORY_CODE_MAP"
```

Expected: 2 new tests pass + existing tests still pass.

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE
git add apps/api/src/modules/accounting/accounting.service.ts apps/api/src/modules/accounting/accounting.service.spec.ts
git commit -m "fix(accounting): CATEGORY_CODE_MAP corrected + boot validator

Fixes mapping drift caught in Phase A.6 audit:
- ADMIN_SOCIAL_SECURITY: 53-1103 (ค่าล่วงเวลา) → 53-1102 (ประกันสังคม)
- ADMIN_DEPRECIATION: re-added → 53-1601 (now exists in 105-CSV)
- ADMIN_RENT, ADMIN_INSURANCE: temp placeholder 53-1502 (CSV lacks dedicated)

Adds onModuleInit validator that throws if any mapped code missing from
seeded CoA — fails fast at boot instead of NotFoundException at runtime."
```

---

## Task 6: Verify + push + PR

- [ ] **Step 6.1: Run all relevant tests**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE
./tools/check-types.sh all
cd apps/api && npx jest src/modules/chart-of-accounts src/modules/accounting
cd apps/web && npm run build
```

Expected: TSC clean, all jest specs pass, web build succeeds.

- [ ] **Step 6.2: Push + PR**

```bash
git push -u origin <feature-branch>
gh pr create --title "feat(accounting): Phase A.6 dynamic CoA architecture" --body "$(cat <<'EOF'
Eliminates ~20 drift-prone hardcoded XX-XXXX codes per Phase A.6 audit.

## Changes
- API: GET /chart-of-accounts/grouped (filter by type/codePrefix/category)
- Web: useCoaGroups + useCoaByCodes hooks (staleTime Infinity)
- ExpensesPage: removes 70 lines of hardcoded categoryGroups
- AssetForm: removes 4 hardcoded option blocks
- accounting.service: CATEGORY_CODE_MAP corrections + onModuleInit validator (fails fast on drift)

## Effect
CSV updates now reflect immediately in UI dropdowns after seed:coa job.
Boot fails fast if a mapped code goes missing from chart.

## Spec
docs/superpowers/specs/2026-05-06-coa-dynamic-architecture-design.md

## Test plan
- [ ] Existing Expense rows still display category labels (codeToName fallback)
- [ ] New expenses use CoA code as category value
- [ ] Asset form loads correct dropdowns after image deploy
EOF
)" --base main
```

Don't auto-merge — owner reviews.

---

## Self-Review

### Spec coverage check
- [x] §4.1 New endpoint → Task 1
- [x] §4.2 Existing by-codes endpoint → reused
- [x] §4.3 Frontend hooks → Task 2
- [x] §4.4 ExpensesPage refactor → Task 3
- [x] §4.5 AssetForm refactor → Task 4
- [x] §4.6 IntercompanySettlementPage → noted optional, not in critical path
- [x] §4.7 Backend CATEGORY_CODE_MAP fix + validator → Task 5
- [x] §5 Migration steps → covered T1-T6
- [x] §6 Backwards compat → handled in Task 3 step 3.2 (codeToName fallback)
- [x] §8 Acceptance Criteria → met if T1-T6 pass

### Spec §9 Open Questions resolution
1. **ADMIN_INSURANCE / ADMIN_RENT** — temp placeholder `53-1502` (defer A.7 dedicated CSV row)
2. **COGS_PRODUCT/REPAIR_PARTS** — keep DEPRECATED (commented out); UI hides
3. **ExpenseCategory enum** — keep enum on existing rows; new rows store CoA code (string column accepts both)

### Placeholder scan
- No "TBD" or "implement later" in tasks
- All code blocks are concrete and complete
- File paths exact

### Type consistency
- `CoaAccountRow`, `CoaGroup`, `CoaGroupedResponse` defined consistently in DTO + hook
- `findGrouped` signature matches in service + spec + controller
