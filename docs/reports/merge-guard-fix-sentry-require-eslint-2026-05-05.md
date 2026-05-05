# Merge Guard Report — fix/sentry-require-eslint

| Field | Value |
|-------|-------|
| Branch | `fix/sentry-require-eslint` |
| Author | Akenarin Kongdach |
| Date reviewed | 2026-05-05 |
| Base | `origin/main` |

## File Changes Summary

| File | Change |
|------|--------|
| `.dockerignore` | Include `__tests__/` in build context |
| `apps/api/package.json` | Add `vitest` CPA-spec exclusion from Jest run |
| `apps/api/src/cli/wipe-accounting.cli.ts` | Skip-if-missing for old-schema tables; skip seed on incompatible schema |
| 11 `*.spec.ts` files | Add DI mocks for A.5a/A.5c templates; fix existing tests broken by new providers |

5 commits:
- `fix(docker): include __tests__/ in build context`
- `test(api): exclude vitest CPA template specs from Jest CI run`
- `fix(wipe): skip-if-missing for old-schema tables + skip seed on incompatible schema`
- `test(accounting): add CPA template DI mocks to fix CI after A.5a/A.5c wiring`
- `fix(contracts): replace require() with import * as Sentry to satisfy lint`

---

## Issues by Severity

### Critical
_None._

### Warning
_None._

### Info

**I1 — `$executeRawUnsafe` and `$queryRawUnsafe` in wipe CLI (`wipe-accounting.cli.ts`)**

```typescript
await prisma.$executeRawUnsafe(`TRUNCATE "${t}" CASCADE`);
await prisma.$queryRawUnsafe('SELECT "normalBalance" FROM "chart_of_accounts" LIMIT 0');
```

Table names come from a static array defined in the same file; the column name is a string literal. No user-supplied input reaches either call, so SQL injection is not a risk. `$queryRaw` with tagged templates would be cleaner but the Prisma template tag doesn't support dynamic identifiers for DDL statements, making `$executeRawUnsafe` the pragmatic choice here. Acceptable given the context (admin-only CLI, protected by three env-var guards).

---

**I2 — `Number(callArgs.provisionAmount)` in test assertions (`bad-debt.service.spec.ts`)**

```typescript
expect(Number(callArgs.provisionAmount)).toBeCloseTo(50, 4);
```

`Number()` on a `Decimal` in test assertions is fine (no production money arithmetic involved). Not an issue.

---

## Positive Findings

- ✅ `require('@sentry/nestjs')` → `import * as Sentry from '@sentry/nestjs'` — lint-clean.
- ✅ `__tests__/` correctly added back to Docker build context (vitest specs need to be bundled for CI).
- ✅ Jest `testPathIgnorePatterns` excludes vitest-native CPA specs — eliminates double-run false failures.
- ✅ Wipe CLI `skip-if-missing` makes the tool safe to run on pre-A.4 schemas (e.g. local dev before migration).
- ✅ Schema-probe guard (`SELECT "normalBalance" LIMIT 0`) prevents CoA seed on incompatible schema — avoids confusing failures on old DBs.
- ✅ All 11 spec files add only DI mocks — no production logic changed.
- ✅ No new controllers, no guards changes, no money arithmetic.

---

## Recommendation

**APPROVE** — No Critical or Warning issues. Pure test/build hygiene fixes. Safe to merge.
