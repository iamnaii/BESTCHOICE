# Dynamic Chart-of-Accounts Architecture

**Date:** 2026-05-06
**Author:** owner + Claude
**Status:** Design (approved)
**Phase:** A.6 (post Phase A.4-A.5c)

## 1. Goal

Eliminate drift between hardcoded account codes/category mappings and the canonical CSV. After this work, updating `finance-coa.csv` requires zero code changes — UI dropdowns, backend mappings, and category groupings sync automatically from the seeded `ChartOfAccount` table.

## 2. Problem

Audit (2026-05-06) found ~100 hardcoded XX-XXXX references in api+web, of which:
- **~20 are DRIFT** — wrong codes (e.g., `ADMIN_RENT: '53-1301'` actually = ค่าน้ำ in CSV; `ADMIN_INSURANCE: '53-1103'` = ค่าล่วงเวลา)
- **~10 are stale UI dropdowns** in ExpensesPage + AssetForm + IntercompanySettlementPage that hardcoded subset of codes from old chart
- **~70 are intentional** template/JE references aligned with CSV (Phase A.4 design)

Each CSV update (99→105 just happened, more coming for SHOP/PEAK) requires manual sync of ~30 hardcoded sites. Drift inevitable.

## 3. Architecture

```
CSV (finance-coa.csv)         ←── single source of truth
        │
        │ npm run seed:coa  (idempotent upsert)
        ▼
ChartOfAccount table (105 rows, category column populated)
        │
        │ GET /accounting/coa-grouped?type=ค่าใช้จ่าย
        │ GET /accounting/coa-by-codes?codes=12-2101,12-2103
        ▼
┌────────────────────────────────────────────────────────────┐
│ React Query (staleTime: Infinity, cache key by query)      │
└────────────────────────────────────────────────────────────┘
        │
        ▼
┌──────────────┬───────────────┬──────────────┬─────────────┐
│ ExpensesPage │   AssetForm   │ CashAccount  │ Intercompany│
│              │               │  (existing)  │ Settlement  │
└──────────────┴───────────────┴──────────────┴─────────────┘
```

## 4. Components

### 4.1 New API endpoint — `GET /accounting/coa-grouped`

**Location:** extend `apps/api/src/modules/chart-of-accounts/chart-of-accounts.controller.ts`

**Query params:**
- `type` — filter by `ChartOfAccount.type` (e.g., `ค่าใช้จ่าย`, `สินทรัพย์`, `หนี้สิน`, `รายได้`, `ทุน`)
- `codePrefix` (optional) — filter by code prefix `12-21` (matches `12-21XX`)
- `category` (optional) — filter by `ChartOfAccount.category` (e.g., `เงินสด`, `OpEx-บุคลากร`)

**Response shape:**
```typescript
{
  groups: Array<{
    category: string;          // CSV "หมวดหมู่" column
    accounts: Array<{
      code: string;            // "53-1101"
      name: string;            // "เงินเดือน ค่าจ้าง"
      normalBalance: 'Dr' | 'Cr' | 'Dr/Cr';
      vatApplicable: boolean;
      notes: string | null;
    }>;
  }>;
}
```

Auth: `JwtAuthGuard, RolesGuard`. Roles: all logged-in users (read-only data).

### 4.2 Existing endpoint reuse — `GET /accounting/coa-by-codes`

Already exists from Phase A.4. Used by callers that need a specific known set (e.g., `CashAccountSelect` 6 codes, IntercompanySettlement 2 codes).

### 4.3 Frontend — `useCoaGroups` hook

**Location:** `apps/web/src/hooks/useCoa.ts` (new file)

```typescript
export function useCoaGroups(filter: { type?: string; codePrefix?: string; category?: string }) {
  return useQuery({
    queryKey: ['coa-grouped', filter],
    queryFn: () => api.get<CoaGroupedResponse>('/accounting/coa-grouped', { params: filter }).then(r => r.data),
    staleTime: Infinity, // CoA changes only on seed
  });
}

export function useCoaByCodes(codes: string[]) {
  return useQuery({
    queryKey: ['coa-by-codes', codes.sort().join(',')],
    queryFn: () => api.get<CoaRow[]>('/accounting/coa-by-codes', { params: { codes: codes.join(',') } }).then(r => r.data),
    staleTime: Infinity,
    enabled: codes.length > 0,
  });
}
```

### 4.4 ExpensesPage refactor

Replace hardcoded `categoryGroups` + `categoryLabels`:

```typescript
// BEFORE: 70+ lines of hardcoded categoryGroups + categoryLabels

// AFTER:
const { data: coa } = useCoaGroups({ type: 'ค่าใช้จ่าย' });
// renders dropdown groups directly from coa.groups
// label = `${account.code} ${account.name}`
```

Removes `accountType` field — type is implicit (always `ค่าใช้จ่าย`). Single dropdown grouped by category.

`categoryLabels` lookup still needed for filter chips/table display → derive from CoA name.

### 4.5 AssetForm refactor

Replace 4 hardcoded `<option>` blocks with:

```typescript
const { data: assetGroups } = useCoaGroups({ codePrefix: '12-21' });    // for asset cost
const { data: depGroups } = useCoaGroups({ codePrefix: '53-16' });      // for depreciation expense
const { data: accumGroups } = useCoaGroups({ codePrefix: '12-21' });    // accumulated dep — Contra Asset rows only
```

Filter by `normalBalance` to separate cost (Dr) from accumulated (Cr).

### 4.6 IntercompanySettlementPage refactor

Replace `l.accountCode === '11-1101'` with looking up from CoA. Or keep hardcoded since this is for filtering JE lines, not for display.

### 4.7 Backend `CATEGORY_CODE_MAP` refactor

`apps/api/src/modules/accounting/accounting.service.ts:46-79`

Two options:

**A. Replace hardcoded map with DB lookup at runtime:**
```typescript
async getCodeForCategory(category: string): Promise<string> {
  // Map ExpenseCategory enum → CoA code via category alias table
  // Need new schema: ExpenseCategoryMapping(category, accountCode)
}
```

**B. Keep central TS map but auto-validate at startup:**
```typescript
async onModuleInit() {
  const codes = Object.values(CATEGORY_CODE_MAP);
  const found = await this.prisma.chartOfAccount.findMany({ where: { code: { in: codes } } });
  const missing = codes.filter(c => !found.some(f => f.code === c));
  if (missing.length > 0) throw new Error(`CATEGORY_CODE_MAP references missing CoA codes: ${missing.join(', ')}`);
}
```

**Recommendation: B** — simpler, cheaper, fails fast. Only requires fixing the existing wrong mappings + adding boot validator.

### 4.8 Drop ExpenseCategory enum from DB?

Currently `ExpenseCategory` is an enum on `Expense.category` field. Keep it (categories are user-meaningful labels), just ensure each enum value maps to a real CoA code via validated `CATEGORY_CODE_MAP`.

## 5. Migration Steps

| # | Step | Touches | Risk |
|---|------|---------|------|
| 1 | Add `GET /accounting/coa-grouped` endpoint + service method | api/chart-of-accounts | Low — additive |
| 2 | Add `useCoaGroups` + `useCoaByCodes` hooks | web/hooks | Low — additive |
| 3 | Refactor ExpensesPage to use hook (remove hardcoded categoryGroups) | web/pages | Medium — visible UI change |
| 4 | Refactor AssetForm to use hook | web/pages/AssetManagementPage | Low |
| 5 | Fix CATEGORY_CODE_MAP (correct wrong codes per audit) + add `onModuleInit` validator | api/accounting | Medium — boot fails if map wrong |
| 6 | Remove old hardcoded mappings (keep cpa-templates intentional) | many files | Low — cleanup |
| 7 | Verify tests pass + smoke test | api+web | — |

## 6. Backwards compatibility

`Expense` records already in DB have `category` enum values (ADMIN_SALARY, etc.). Mapping these to current CSV codes:

| Old enum | Old code (drift) | New code (correct) | Action |
|----------|------------------|---------------------|--------|
| ADMIN_SOCIAL_SECURITY | 53-1103 (ค่าล่วงเวลา) | 53-1102 (ประกันสังคม) | Update map |
| ADMIN_INSURANCE | 53-1103 (ค่าล่วงเวลา) | TBD — owner decides (53-1502 misc?) | Update map after owner picks |
| ADMIN_RENT | 53-1301 (ค่าน้ำ) | TBD — CSV lacks dedicated rent | Update map after owner picks OR add CSV row |
| ADMIN_DEPRECIATION | (REMOVED) | 53-1601 (now exists in updated 105 CSV!) | Re-add, point to 53-1601 |
| COGS_PRODUCT | (REMOVED) | TBD — no COGS in FINANCE chart | Mark deprecated, add SHOP-side later |
| COGS_REPAIR_PARTS | (REMOVED) | TBD | same |
| SELL_PACKAGING | 52-1102 (ส่งเสริมการขาย) | TBD — wrong, packaging not present | Map to 53-1502 misc OR add CSV |

Existing Expense rows with deprecated categories → rerender with old labels via fallback. New expenses can't pick deprecated categories.

## 7. Out of scope

- SHOP-side accounting (Phase A.5b — waits CSV from CPA)
- PEAK code mapping integration
- Auto-conversion of historical Expense.category to new categories (will rerender labels but not data-migrate)

## 8. Acceptance Criteria

- [ ] `GET /accounting/coa-grouped` returns expected shape and data for type=ค่าใช้จ่าย
- [ ] ExpensesPage dropdown shows ~30 actual CSV expense accounts (not 21 hardcoded)
- [ ] AssetForm dropdowns load from CoA (no hardcoded options)
- [ ] `CATEGORY_CODE_MAP` boot validator passes (or throws at startup if drift detected)
- [ ] Updating `finance-coa.csv` then running `seed:coa` immediately reflects in UI dropdowns (no code change)
- [ ] All existing Expense.category values still map to a valid CoA code
- [ ] TSC clean (api + web)
- [ ] Tests pass

## 9. Open Questions

1. **ADMIN_INSURANCE / ADMIN_RENT** — CSV has no dedicated accounts. Owner decides:
   - Add CSV rows (53-1306 ค่าเช่า, 53-1107 ค่าประกันภัย)
   - Map to nearest existing (53-1502 misc)
   - Mark as deprecated, hide from UI
2. **COGS_PRODUCT / COGS_REPAIR_PARTS** — FINANCE chart has no COGS. Defer to SHOP A.5b? Or remove from UI now?
3. **ExpenseCategory enum** — keep as DB enum, or drop and just store CoA code on Expense.category (string)?

These can be resolved during implementation or by follow-up CSV update from CPA.
