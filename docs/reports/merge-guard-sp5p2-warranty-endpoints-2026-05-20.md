# Merge Guard Report — feat/sp5p2-warranty-endpoints

**Date**: 2026-05-20  
**Branch**: `feat/sp5p2-warranty-endpoints`  
**Author**: Akenarin Kongdach <iamnaii@MacBook-Pro-khxng-Akenarin.local>  
**Recommendation**: ⚠️ **REVIEW** — fix Warnings before merge

---

## File Changes Summary

| File | Lines ± | Notes |
|---|---|---|
| `apps/api/prisma/seed.ts` | +4/-4 | CoA code update REPAIR_* keys → SHOP prefix |
| `apps/api/prisma/seed-production.ts` | +4/-4 | Same CoA code update |
| `apps/api/src/modules/repair-tickets/__tests__/fixtures/cpa-cases/shop-coa.csv` | +3 | New SHOP CoA rows |
| `apps/api/src/modules/repair-tickets/__tests__/repair-tickets.service.spec.ts` | +309 | New warranty tests |
| `apps/api/src/modules/repair-tickets/dto/warranty-lookup.dto.ts` | +22 | New DTO |
| `apps/api/src/modules/repair-tickets/dto/warranty-preview.dto.ts` | +15 | New DTO |
| `apps/api/src/modules/repair-tickets/repair-tickets.controller.ts` | +16 | 2 new GET endpoints |
| `apps/api/src/modules/repair-tickets/repair-tickets.service.ts` | +272/-1 | warrantyPreview + warrantyLookup impl |
| `apps/api/src/modules/repair-tickets/__tests__/repair-config-defaults.spec.ts` | +18/-18 | Updated for new CoA codes |

**9 files changed, 647 insertions(+), 18 deletions(-)**

---

## Issues Found

### Critical (0)

None. All security patterns are correctly applied:
- `RepairTicketsController` retains `@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)` at class level
- Both new methods have explicit `@Roles()` decorators:
  - `warrantyPreview` → `@Roles('OWNER', 'BRANCH_MANAGER', 'SALES')`
  - `warrantyLookup` → `@Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES', 'ACCOUNTANT')`
- All Prisma queries include `deletedAt: null` soft-delete filters
- No raw `$queryRaw` SQL; no hardcoded secrets

---

### Warning (2)

#### W1 — Missing `@MaxLength()` on WarrantyLookupDto string fields

**File**: `apps/api/src/modules/repair-tickets/dto/warranty-lookup.dto.ts`

Three string fields have `@MinLength()` but no `@MaxLength()`. Without an upper bound, an attacker can submit multi-MB strings that pass validation and reach service logic (DB query or regex), causing a DoS via memory pressure or slow regex backtrack.

```typescript
// Current — missing @MaxLength
@MinLength(4, { message: 'imei ต้องมีอย่างน้อย 4 ตัวอักษร' })
imei?: string;

// Required fix
@MaxLength(20, { message: 'imei ต้องไม่เกิน 20 ตัวอักษร' })
@MinLength(4, { message: 'imei ต้องมีอย่างน้อย 4 ตัวอักษร' })
imei?: string;
```

Suggested limits: `imei` → 20, `serial` → 50, `contractNumber` → 30.

#### W2 — Audit log fire-and-forget swallows errors silently

**File**: `apps/api/src/modules/repair-tickets/repair-tickets.service.ts`

Two audit calls use `.catch(() => {})` with an empty catch block. Silent failures block observability — Sentry never receives these errors.

```typescript
// Current (approx line 587 / 723)
this.audit(...).catch(() => {});

// Preferred fix
this.audit(...).catch((err) => this.logger.warn('Audit log failed', err));
```

This is consistent with the pattern established in v2/v3 Sentry hardening. The `RepairTicketsService` already has a `Logger` instance — use it.

---

### Info (2)

#### I1 — Large test file

`repair-tickets.service.spec.ts` grows to ~1,340 lines after this PR. Consider splitting into `warranty-preview.spec.ts` and `warranty-lookup.spec.ts` in a future cleanup. Not a blocker.

#### I2 — Seed file CoA code change

`REPAIR_EXPENSE_ACCOUNT_CODE` changes from `53-1306` → `S51-1105` and `REPAIR_INCOME_ACCOUNT_CODE` from `42-1106` → `S42-1101`. These are SHOP-prefix codes — correct for the SHOP-side accounting model (Phase 3 SP5). Verify with accounting stakeholder before deploy to production.

---

## Positive Findings

- BKK timezone handling in `computeWarrantyWindows()` correctly implements UTC+7 offset arithmetic with `Math.max(0, ...)` guards
- Branch-scope filtering for SALES role is correctly applied via `hasCrossBranchAccess()` check
- Thai validation messages present on all DTO fields
- No `Number()` on financial fields; CoA codes remain plain strings
