# Pre-Merge Guard Report: feat/accounting-audit-fixes
**Date**: 2026-04-29  
**Reviewer**: Pre-Merge Guard Agent  
**Recommendation**: 🔴 BLOCK

---

## Branch Summary

| Field | Value |
|-------|-------|
| Branch | `feat/accounting-audit-fixes` |
| Unique commits ahead of main | 1,197 |
| Files changed (TS/TSX) | 1,590 |
| New modules | exchange, address, inter-company, chart-of-accounts, chatbot-finance, accounting |

### Top commits
- `feat(accounting)`: Thai accounting standards audit fixes (7 critical, 14 warnings)
- `feat`: inter-company accounting (BESTCHOICE SHOP ↔ BESTCHOICE FINANCE)
- `fix`: address 5 critical issues from code review
- `fix(test)`: test mocks updated for R-012 idempotency change

---

## Critical Issues (must fix before merge)

### C-1 · Prisma schema / client mismatch — `FINANCE_MANAGER` role

`schema.prisma` removes `FINANCE_MANAGER` from the `UserRole` enum, but migration `20260406100000_add_finance_manager_role/migration.sql` re-adds it via `ALTER TYPE … ADD VALUE`. This produces a generated Prisma client that does not know about `FINANCE_MANAGER` while the database does. Guards and queries referencing `FINANCE_MANAGER` will treat it as an unknown value at runtime, silently failing role checks for any user with that role.

**Fix**: Restore `FINANCE_MANAGER` to the `UserRole` enum in `schema.prisma` to match the migration SQL.

---

### C-2 · `Number()` on `Decimal` money fields in write paths

`inter-company.service.ts`, `accounting.service.ts`, and `bad-debt.service.ts` use `Number()` on Prisma `Decimal` fields for financial aggregation and DB writes:

- `inter-company.service.ts` — 8 `Decimal` fields converted to `number` for P&L accumulation
- `accounting.service.ts` — 46 `Number()` calls including `_sum` aggregations
- `bad-debt.service.ts` — 8 calls on `amountDue`, `provisionAmount`
- Inter-company DTOs declare money fields as `number`, causing float deserialization before the service layer

This is an explicit regression of the v4 hardening ("53 `Number()` → `Prisma.Decimal`" fix).

**Fix**: Replace `Number()` accumulation with `new Prisma.Decimal(0).add(…)`. DTO money fields must be `string` (Decimal input) not `number`. Call `.toNumber()` only at the final serialization boundary.

---

### C-3 · Inter-company FK constraints removed (hardening regression)

Migration `20260528300000_inter_company_not_null` (which adds `fromCompanyId`/`toCompanyId` NOT NULL FK columns with RESTRICT delete rules) is absent from this branch. The branch instead reverts to plain `fromEntity`/`toEntity` strings, losing audit traceability on which legal entity made each transaction.

**Fix**: Either include the `fromCompanyId`/`toCompanyId` FK migration, or document a deliberate deferral with a Sentry alarm.

---

## Warning Issues (should fix before merge)

### W-1 · `Number()` on `Decimal` in reporting read paths

`accounting.service.ts` accumulates P&L, cash flow, and trial balance using JS float arithmetic. Even in read paths, floating-point accumulation on financial figures is a compliance risk under TFRS for NPAEs.

**Fix**: Use `Prisma.Decimal` arithmetic throughout, including read-only report aggregations.

---

### W-2 · `AbortSignal.timeout` not confirmed in new chatbot-finance LINE client

The old `line-finance-client.service.ts` had explicit 10s/15s `AbortSignal.timeout` on all `fetch` calls with Sentry capture on timeout (v3 hardening). The file was replaced by a refactored module. The timeout is not confirmed present in the replacement.

**Fix**: Verify `AbortSignal.timeout(10_000)` is applied to all outbound LINE API `fetch` calls in the new `chatbot-finance` service.

---

### W-3 · Enum removals without migrations risk deploy failure

The branch removes `CallResult`, `CallDirection`, `NegotiationResult`, `FilterPresetScope`, `TodoStatus`, `TodoPriority` enums and `LEGAL`/`DEFECT_EXCHANGED` `ContractStatus` values — all present in `main`. No corresponding deprecation migrations exist. If any production rows carry these values, `prisma migrate deploy` will fail or silently corrupt data.

**Fix**: Add explicit `ALTER TYPE … DROP VALUE` migrations for each removed enum value, or confirm none exist in production and add a guard check.

---

### W-4 · Mock payment hook in LIFF customer path

`apps/web/src/pages/liff/useMockPayment.ts` is a prototype hook with a comment "when connecting real Omise → change to useOmisePayment()". Shipping placeholder payment code to the production LIFF path is a correctness risk.

**Fix**: Remove the mock hook before merge or ensure it is not reachable in the production LIFF flow.

---

## Info

| # | Note |
|---|------|
| I-1 | `AddressController` correctly has no `JwtAuthGuard` — matches security.md allow-list |
| I-2 | All other new controllers have correct `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles()` at class and method level |
| I-3 | No unparameterized `$queryRaw` found — only safe tagged template literal in health check |
| I-4 | No hardcoded secrets found — all use `process.env` or `IntegrationConfigService` |
| I-5 | All new `useMutation` hooks have `queryClient.invalidateQueries()` in `onSuccess` |
| I-6 | All new DTOs have Thai validation error messages |

---

## Recommendation: 🔴 BLOCK

Three merge blockers must be resolved:
1. **C-1** — Prisma client/schema mismatch on `FINANCE_MANAGER` will break role guards in production
2. **C-2** — `Number()` on financial Decimal fields is an explicit v4 regression (a critical rule in this codebase)
3. **C-3** — Removal of inter-company FK constraints without migration plan reverts v4 hardening

Resolve all three criticals, then re-review.
