# Pre-Merge Guard Report

| Field | Value |
|-------|-------|
| **Branch** | `fix/ci-pre-existing-test-failures` |
| **Base** | `origin/main` |
| **Author** | Akenarin Kongdach `<akenarin.ak@gmail.com>` |
| **Report date** | 2026-06-11 |
| **Recommendation** | ✅ **APPROVE** |

---

## Summary

CI repair branch + Wave-2/3 characterization test backfill.
7 commits, 23 files, +4 247 / −393 lines.

Only **5 production source files** changed (the rest are spec files):

| File | Change |
|------|--------|
| `accounting/accounting.module.ts` | Remove dead `BankReconciliationService` provider/export |
| `accounting/bank-reconciliation.service.ts` | **DELETED** — dead code, never wired to a controller |
| `chatbot-finance/services/finance-tools.service.ts` | Bug fix: cap late-fee quote to match what's actually charged |
| `chatbot-finance/tools/tool-executor.ts` | Fix missing `await` on async `calculateFine()` call |
| `finance-receivable/dto/finance-receivable.dto.ts` | Add `@Max(1)` guard on `commissionRate` (prevents negative receivable) |
| `utils/late-fee.util.ts` | **NEW** — `computeCappedLateFee()` using `Prisma.Decimal` throughout |
| `e2e/jest-e2e.json` | Exclude incomplete `approval-workflow` harness from CI run |

---

## Issues by Severity

### 🔴 Critical — None

No critical issues found:
- No new controllers — no missing `@UseGuards` or `@Roles` checks needed.
- No unparameterized `$queryRaw` / `$executeRaw` in production code.
- No hardcoded secrets or API keys.
- All new Prisma queries include `deletedAt: null` filter.
- No raw `fetch()` or `axios` in frontend code (branch is API-only).

### 🟡 Warning

#### W1 — `Number()` on financial value in `finance-tools.service.ts` (display context)

**File**: `apps/api/src/modules/chatbot-finance/services/finance-tools.service.ts`  
**Lines**: `calculateCurrentBalance()` and `calculateFine()`

```ts
// calculateCurrentBalance (line ~82):
const lateFee = nextPayment.lateFeeWaived
  ? 0
  : Number(computeCappedLateFee({ daysOverdue, feePerDay, flatCap, ... }));

// calculateFine (line ~167):
const totalFine = Number(computeCappedLateFee({ daysOverdue: days, feePerDay, flatCap }));
```

`computeCappedLateFee()` correctly returns `Prisma.Decimal`, but `Number()` is applied before returning the value in the chatbot JSON response.  
**Mitigation**: These are chatbot display values only — they are never written to the database. The actual precision computation uses `Prisma.Decimal` throughout. Acceptable in this context but inconsistent with the project-wide "no `Number()` on money" rule.

**Recommendation**: Acceptable as-is given the display-only context. If the return type of these tool functions is ever used for DB writes in a future integration, switch to `.toFixed(2)` string or keep as `Decimal`.

#### W2 — `Number()` on SystemConfig values in `getLateFeeConfig()`

**File**: `apps/api/src/modules/chatbot-finance/services/finance-tools.service.ts`

```ts
return {
  feePerDay: perDayCfg ? Number(perDayCfg.value) : LATE_FEE_PER_DAY,
  flatCap:   capCfg   ? Number(capCfg.value)    : 1500,
};
```

`SystemConfig.value` is a `String` field — converting it via `Number()` can silently produce `NaN` if the config value is malformed. The values are then passed to `computeCappedLateFee()` which converts them to `new Prisma.Decimal(value.toString())`, so `NaN` would propagate to the Decimal constructor.  
**Recommendation**: Consider `parseFloat(perDayCfg.value)` with an `isNaN` guard, or pass the raw string directly since `computeCappedLateFee` accepts `string`.

#### W3 — E2E harness permanently excluded from CI

**File**: `apps/api/e2e/jest-e2e.json`

```json
"testPathIgnorePatterns": ["approval-workflow.e2e-spec.ts"]
```

The `approval-workflow` E2E test is excluded because its dependency PRs (#912, #923, #931) landed but the harness was never updated (placeholder DI, missing `approval_enabled` config). The comment references tracking issue #1192.  
**Recommendation**: Ensure #1192 is actioned — this exclusion should not become permanent. A `TODO(#1192)` comment in `jest-e2e.json` would prevent it silently rotting.

### ℹ️ Info

#### I1 — Dead code removal is correct

`BankReconciliationService` was declared in `AccountingModule` but never injected into any controller or public service — it was unreachable. Removal is clean; the spec was deleted alongside it. No functionality lost.

#### I2 — ENCRYPTION_KEY test removal is correct

Two `env-validation.spec.ts` tests that asserted `validateEnv()` throws on a missing/short `ENCRYPTION_KEY` were removed. The guard existed solely to protect the TOTP 2FA secret, which was deleted in PR #1169. `PII_ENCRYPTION_KEY` + `PII_HASH_SALT` guards remain intact and are covered by the other tests.

#### I3 — New `computeCappedLateFee` util is well-structured

`apps/api/src/utils/late-fee.util.ts` uses `Prisma.Decimal` for all arithmetic, correctly applies `Prisma.Decimal.min(...caps)`, rounds with `ROUND_HALF_UP` to 2dp, and is covered by 6 targeted unit tests including the headline bug case.

#### I4 — Large spec files added

Several new spec files are 300–626 lines (characterization/golden tests). This is expected for wave backfill characterization work and does not indicate a design problem.

---

## Recommendation: ✅ APPROVE

All production code changes are small, targeted bug fixes:
1. A dead service removed.
2. Late-fee capping bug fixed in chatbot (now matches what's actually charged).
3. Missing `await` fixed on async method.
4. DTO `@Max(1)` guard added to prevent impossible negative receivable.
5. New `computeCappedLateFee()` util centralises the cap logic with proper `Prisma.Decimal` arithmetic.

The two `Number()` warnings (W1, W2) are display-context only and do not affect financial record integrity. W3 (E2E exclusion) is tracked in #1192.

No security issues. No missing guards. No Decimal precision bugs on DB writes.
