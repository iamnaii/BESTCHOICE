# Pre-Merge Guard Report

**Branch**: `fix/ci-pre-existing-test-failures`
**Author**: Akenarin Kongdach <akenarin.ak@gmail.com>
**Date reviewed**: 2026-06-11
**Commits ahead of main**: 7

---

## Summary of Changes

| Category | Count |
|---|---|
| Files changed | 23 |
| Insertions | +4,247 |
| Deletions | −393 |
| Production files changed | 6 |
| Test/spec files changed | 17 |

### Commit log
```
77f12aed ci(e2e): exclude the incomplete approval-workflow harness (#1192)
528ca9d1 fix(ci): repair 3 pre-existing test failures blocking the merge gate
d6ef53b3 fix(chatbot-finance): cap the LIFF late-fee quote to match charged amount (#1182)
8578057b fix(finance-receivable): cap commissionRate at 1 to prevent negative receivable (#1177)
0e16355b test(api): Wave-2/3 characterization backfill — mdm-auto/pdpa/analytics (+84) (#1181)
acee3f4e test(api): Wave-2/3 golden/characterization backfill for regulated money paths (+105) (#1178)
3d527ec5 chore(accounting): remove dead, unwired BankReconciliationService (#18) (#1173)
```

### Production files
| File | Change |
|---|---|
| `accounting/accounting.module.ts` | Remove dead `BankReconciliationService` provider/export |
| `accounting/bank-reconciliation.service.ts` | **DELETED** — dead code (no controller ever wired it) |
| `chatbot-finance/services/finance-tools.service.ts` | Cap LIFF late-fee quote to match actual charge |
| `chatbot-finance/tools/tool-executor.ts` | Add `await` on now-async `calculateFine()` |
| `finance-receivable/dto/finance-receivable.dto.ts` | Add `@Max(1)` on `commissionRate` |
| `utils/late-fee.util.ts` | **NEW** — canonical capped late-fee utility returning `Prisma.Decimal` |

---

## Security Checks

| Check | Result |
|---|---|
| New controllers missing `@UseGuards(JwtAuthGuard)` | None |
| New controllers missing `@Roles()` | None |
| Hardcoded secrets / API keys | None |
| `$queryRaw` without `Prisma.sql` | None (mock only in test) |
| Soft-delete `deletedAt: null` missing on new queries | None (new queries are in `systemConfig.findUnique`, not entity tables with soft-delete) |

---

## Issues Found

### Critical
*None.*

---

### Warning

**W1 — `Number()` coercion of `Prisma.Decimal` in chatbot display path**
- File: `apps/api/src/modules/chatbot-finance/services/finance-tools.service.ts` lines ~72-82, ~151, ~158
- `Number(computeCappedLateFee(...))` converts a `Prisma.Decimal` result to a JS Number for the chatbot response payload.
- `Number(perDayCfg.value)` and `Number(capCfg.value)` convert `SystemConfig.value` strings to Number and pass them into `computeCappedLateFee` (which accepts `number | Decimal | string` — valid).
- **Why it's a warning, not critical**: The coerced values are used exclusively in the JSON response to the LINE chatbot (display string, never written to DB). Thai installment amounts are ≤ 100,000฿ — well within IEEE 754 double precision. However, the pattern diverges from the project-wide "no `Number()` on money" rule and could confuse future readers.
- **Suggestion**: Return `lateFee: computeCappedLateFee(...).toFixed(2)` as a string for display, or document explicitly with a comment that this is display-only and not a DB value.

---

### Info

**I1 — Approval workflow E2E excluded from test runner**
- File: `apps/api/e2e/jest-e2e.json` + `apps/api/e2e/approval-workflow.e2e-spec.ts`
- The harness is excluded via `testPathIgnorePatterns` because provider DI is incomplete (tracking issue #1192). A warning comment was added to the spec. Not a production risk — CI will still pass without it, and the issue is documented. Should be re-enabled when the providers are properly wired.

**I2 — Two ENCRYPTION_KEY validation tests removed**
- File: `apps/api/src/utils/env-validation.spec.ts`
- Tests asserting `validateEnv()` throws on missing/short `ENCRYPTION_KEY` in prod were removed. Staff-login 2FA (which used this key) was removed in PR #1169. PII encryption is separately protected by `PII_ENCRYPTION_KEY` + `PII_HASH_SALT` (tested). Intentional and well-commented.

**I3 — Large number of new spec files (+4,200 lines)**
- 9 new characterization/golden spec files added across `analytics`, `credit-check`, `mdm-auto`, `payment-method-config`, `paysolutions`, `pdpa`, `purchase-orders`, `reports`, `finance-receivable`. These pin existing behavior rather than test new logic. No concerns — increases test coverage baseline.

---

## Positive Notes

- `utils/late-fee.util.ts` is a well-designed single source of truth for the capped late-fee formula. It correctly uses `Prisma.Decimal` arithmetic throughout and is fully tested in `late-fee.util.spec.ts`.
- `@Max(1)` on `commissionRate` closes a real data-integrity gap — a rate > 1 would produce a negative `netExpectedAmount` receivable. This is a legitimate bug fix.
- Dead code removal of `BankReconciliationService` is clean: module registration, exports, and both the service and spec files are all removed together.
- The `await` fix on `tool-executor.ts` is a correct async bug fix (the method became async in this branch but the caller wasn't awaiting it).

---

## Recommendation

**APPROVE**

No critical issues found. One warning (`Number()` coercion for chatbot display) that is acceptable in this context but worth a follow-up comment or type-safe string return. All security guards are in place, no money fields are written to DB with coerced Number values, and soft-delete patterns are intact. The branch is ready to merge.
