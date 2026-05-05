# Merge Guard Report — `feat/seed-coa-cli`

**Date**: 2026-05-05  
**Branch**: `feat/seed-coa-cli`  
**Author**: iamnaii@MacBook-Pro-khxng-Akenarin.local  
**Commits**: 2 (CoA page rewrite → add seed CLI)

---

## File Changes Summary

| File | +Lines | -Lines | Notes |
|------|--------|--------|-------|
| `apps/api/src/cli/seed-coa.cli.ts` | +48 | 0 | New non-destructive upsert CLI |
| `apps/api/package.json` | +3 | -1 | Registers `seed:coa` npm script |
| `apps/web/src/pages/ChartOfAccountsPage.tsx` | +572 | -269 | Rewrites CoA list for Phase A.4 schema (105 accounts) |

---

## Issues Found

### Info

#### I-1: `ChartOfAccountsPage.tsx` is 557 lines

Slightly over the 500-line guideline. The page combines filter/search state, a table renderer, and a detail drawer. Extracting a `CoaDetailDrawer` or `CoaTable` subcomponent would help. Not a blocker.

#### I-2: `$queryRaw` used in `seed-coa.cli.ts`

```typescript
const [{ current_database: actualDb }] = await prisma.$queryRaw<...>`SELECT current_database()`;
```

This is a tagged template literal with no interpolated user input. Prisma handles tag-template queries as parameterized — no SQL injection risk.

---

## Backend Security Checklist

| Check | Result |
|-------|--------|
| CLI has no HTTP endpoint — no guards needed | ✅ Correct — it's a standalone node script |
| `EXPECTED_DB_NAME` guard prevents wrong-DB runs | ✅ Present and enforced first |
| No secrets hardcoded | ✅ |
| Idempotent upsert (no destructive ops) | ✅ `upsert` by `code` — safe to re-run |

---

## Recommendation

**APPROVE** — No Critical or Warning issues.

Clean, well-guarded CLI tool with proper DB-name check. The `ChartOfAccountsPage` rewrite correctly uses React Query (`useQuery`, `api.get()`), semantic design tokens, and the `QueryBoundary` pattern. The slight oversize of the page component is the only note.
