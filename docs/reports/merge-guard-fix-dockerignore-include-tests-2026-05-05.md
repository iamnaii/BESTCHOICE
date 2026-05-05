# Merge Guard Report — fix/dockerignore-include-tests

**Date**: 2026-05-05  
**Branch**: `fix/dockerignore-include-tests`  
**Author**: iamnaii@MacBook-Pro-khxng-Akenarin.local  
**Recommendation**: ✅ APPROVE

---

## Summary

5-commit fix branch. Resolves a Docker build failure caused by `__tests__/` being excluded
from the build context, which broke the prod seed because `csv-fixture-loader.ts` + CPA CSV
fixtures are runtime dependencies of `seed-coa-finance.ts`. Also fixes a Sentry `require()`
→ ESM `import` in contract-workflow service, and adds skip-if-missing resilience to the
wipe-accounting CLI for pre-A.4 schema environments.

Also branched as `fix/sentry-require-eslint` (identical HEAD: `537747ed`).

## File Changes

| File | +/- | Type |
|------|-----|------|
| `.dockerignore` | +4 / -1 | Config |
| `apps/api/src/cli/wipe-accounting.cli.ts` | +48 / -35 | Source |
| `apps/api/src/modules/contracts/contract-workflow.service.ts` | +2 / -1 | Source |
| 13 `*.spec.ts` files | bulk | Tests |

**Total**: 16 files, +228 / -177

---

## Issues

### Info

**1. `Number(callArgs.provisionAmount)` in test assertion**  
File: `bad-debt.service.spec.ts`  
```ts
expect(Number(callArgs.provisionAmount)).toBeCloseTo(50, 4);
```
`Number()` is used here to convert a `Prisma.Decimal` for comparison with `toBeCloseTo()`,
which requires a JS number. This is acceptable test-only usage — not production financial
logic. No change required.

**2. `$executeRawUnsafe` with template literal for table names**  
File: `wipe-accounting.cli.ts`  
```ts
await prisma.$executeRawUnsafe(`TRUNCATE "${t}" CASCADE`);
```
The variable `t` comes exclusively from a hardcoded `const tables = [...]` array (no user
input reaches this code). Not a SQL injection risk. Acceptable for a CLI utility that already
requires explicit `CONFIRM_WIPE=YES_I_AM_SURE` and prod guards.

**3. `$queryRawUnsafe` for schema probe**  
File: `wipe-accounting.cli.ts`  
```ts
await prisma.$queryRawUnsafe('SELECT "normalBalance" FROM "chart_of_accounts" LIMIT 0');
```
Fully hardcoded string, no interpolation. Safe.

---

## Security Check

| Check | Result |
|-------|--------|
| New controllers without `@UseGuards` | None added |
| Raw `fetch()` instead of `api.get()` | N/A — no frontend changes |
| `localStorage` token access | None |
| Hardcoded secrets/API keys | None |
| `Number()` on production financial fields | None — test-only usage |
| Missing `deletedAt: null` in new queries | `deletedAt: null` correctly present in updated specs |
| SQL injection via `$executeRawUnsafe` | Table names from hardcoded array — safe |

---

## Key Changes Review

### `.dockerignore`
Previously excluded all of `**/__tests__`, which silently dropped
`apps/api/src/modules/journal/__tests__/csv-fixture-loader.ts` and
`fixtures/cpa-cases/finance-coa.csv` from the Docker build context. These are required at
runtime by the CoA seed. The fix correctly keeps `__tests__/` while noting that
`*.spec.ts` is still excluded by an earlier pattern — correct layered exclusion.

### `wipe-accounting.cli.ts`
The skip-if-missing guard allows running the wipe CLI against a pre-A.4 schema without
crashing on missing tables. The schema probe before seeding prevents a NOT NULL constraint
failure when `normalBalance` doesn't exist yet. Logic is sound; matches the documented
deploy sequence in `accounting.md`.

### `contract-workflow.service.ts`
Replaces `const Sentry = require('@sentry/node')` (CommonJS runtime import inside a function)
with top-level `import * as Sentry from '@sentry/nestjs'`. Correct ESM fix; uses the NestJS
Sentry package, which is the right import for this context.

---

## Recommendation

**APPROVE** — All changes are targeted bug fixes with no security concerns and no regressions
to business logic. The `.dockerignore` fix unblocks prod boot for Phase A.4. Spec refactors
are housekeeping only.
