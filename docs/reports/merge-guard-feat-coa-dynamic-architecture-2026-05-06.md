# Pre-Merge Guard Report: feat/coa-dynamic-architecture

**Date**: 2026-05-06  
**Branch**: `feat/coa-dynamic-architecture`  
**Author**: Akenarin Kongdach  
**Recommendation**: 🟡 **REVIEW** — One documented `as any` cast needs confirmation; otherwise clean

---

## File Changes Summary

15 files changed, 1 290 insertions, 145 deletions

**Modified API files** (`apps/api/src/modules/`):
- CoA service/controller updates for dynamic category architecture (Phase A.6)
- `AssetManagementPage/components/AssetForm.tsx` refactored to use `useCoaGroups`

**Modified frontend**:
- `apps/web/src/pages/ExpensesPage.tsx` — dynamic category dropdowns
- `AssetForm.tsx` — dropdowns from `useCoaGroups`

**Docs**: 2 architecture plan/design files (≈900 lines)

---

## Issues

### 🔴 Critical

None.

---

### ⚠️ Warning

#### W1 — `as any` casts on `category` field (3 locations, documented)

**Files**: CoA service and controller (Phase A.6)

```ts
category: dto.category as any, // Phase A.6: String after migration; cast until Prisma client regenerates
if (category) where.category = category as any; // Phase A.6: String after migration...
data.category = dto.category as any; // Phase A.6: String after migration...
```

Comments indicate these are intentional temporary casts pending Prisma client regeneration after the schema migration. Acceptable for a short-lived branch, but **must be removed once Prisma client is regenerated** — otherwise they mask type errors permanently.

**Action**: Confirm Prisma client has been regenerated after the migration, and remove these casts if so. If regeneration is deferred to merge time, add a TODO comment with a ticket reference.

---

### ℹ️ Info

#### I1 — `deletedAt: null` present in all new queries

```ts
where: { code: { in: codes }, deletedAt: null },
const where: Prisma.ChartOfAccountWhereInput = { deletedAt: null, status: 'ใช้งาน' };
```
✅ Correct soft-delete pattern.

#### I2 — No new controllers introduced

No `@Controller` additions. All changes are within existing module boundaries. No guard checks needed. ✅

#### I3 — No `Number()` on money fields

No financial arithmetic changes in this branch. `useCoaGroups` returns metadata (code, name, category) — not monetary values. ✅

#### I4 — No raw `fetch()` in frontend changes

Both `ExpensesPage.tsx` and `AssetForm.tsx` use `useQuery` from `@tanstack/react-query` via the `useCoaGroups` hook. ✅

---

## Action Required

1. **Verify W1**: Check whether Prisma client was regenerated after the Phase A.6 migration. If yes, remove the three `as any` casts. If regeneration is intentionally deferred, add a ticket reference to the comments.
2. No other blockers. Safe to merge after W1 is confirmed.
