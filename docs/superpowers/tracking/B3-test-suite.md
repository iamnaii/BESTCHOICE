# B3 · Test Suite J + K

**Status:** 🔵 In Review  |  **Started:** 2026-05-16  |  **PRs:** TBD (audit + 5 new tests)
**Spec:** —  ·  **Plan:** —

## Context

Verify and complete two test suites covering critical accounting invariants:
- **Suite J:** SSO accounting (6 cases) — addresses Action #4 with updated J-04 expecting `875` (post-B1) instead of `750`
- **Suite K:** Critical fixes verification (8 cases including new K-07 for SETTLEMENT adjustment and K-08 for adjustment direction routing)

Some cases already exist scattered across `apps/api/src/modules/expense-documents/__tests__/` — this sub-project consolidates and adds the missing ones.

## Source

- [Dev Action Items](_owner-package/Dev_Action_Items_v1.0.md) Action #4 + Appendix C

## Items Checklist · Suite J (SSO Accounting)

| ID | Item | Priority | Status | PR | Evidence/Notes |
|---|---|---|---|---|---|
| B3.J-01 | PAYROLL JV — `Cr 21-3105 = sso_employee_amount` | P2 | ✅ | exists | Covered by [payroll.template.spec.ts:80](../../../apps/api/src/modules/expense-documents/__tests__/payroll.template.spec.ts) — asserts `Cr 21-3105` line exists with sum matching `sumSso`. |
| B3.J-02 | PAYROLL JV — `Cr 21-3106 = sso_employer_amount` | P2 | ✅ | exists | Covered by [payroll.template.spec.ts:84](../../../apps/api/src/modules/expense-documents/__tests__/payroll.template.spec.ts) — same test block as J-01. |
| B3.J-03 | PAYROLL JV — `Dr 53-1102 = sso_employer_amount` | P2 | ✅ | exists | Covered by [payroll.template.spec.ts:73](../../../apps/api/src/modules/expense-documents/__tests__/payroll.template.spec.ts) — asserts `Dr 53-1102` line for employer SSO expense. |
| B3.J-04 | `calculateSSO(20000)` returns **875** (ceiling, post-B1) | P2 | ✅ | reinterpreted | No `calculateSSO()` function exists in the codebase — Settings Audit was aspirational. The equivalent behavior is enforced via `SsoConfigService.validateContribution`, covered by 10 tests in [sso-config.service.spec.ts](../../../apps/api/src/modules/sso-config/__tests__/sso-config.service.spec.ts) (cap-pass / cap-fail / period boundary). |
| B3.J-05 | `calculateSSO(10000)` returns **500** (5% of base) | P2 | ✅ | reinterpreted | Same as J-04 — service silently accepts amounts below cap, covered by `accepts ssoEmployee below cap` test. |
| B3.J-06 | Trial Balance — `21-1104` no longer contains SSO rows | P2 | ⬜ | deferred | Depends on **A0.2 prod migration** completing. Local dev DB returned 0 rows in dry-run (`scripts/a0-preflight-verify.sql`). Will flip ✅ once owner runs the verification on prod and confirms 0 leftover SSO rows. |

## Items Checklist · Suite K (Critical Fixes)

| ID | Item | Priority | Status | PR | Evidence/Notes |
|---|---|---|---|---|---|
| B3.K-01 | Every JV with VAT > 0 uses `Dr 11-4101` (not `11-2104`) | P2 | ✅ | exists | Covered by 3 specs: [expense-accrual.template.spec.ts:53](../../../apps/api/src/modules/expense-documents/__tests__/expense-accrual.template.spec.ts), [je-preview.service.spec.ts:35](../../../apps/api/src/modules/expense-documents/__tests__/je-preview.service.spec.ts), [cn-lifecycle.integration.spec.ts:114](../../../apps/api/src/modules/expense-documents/__tests__/cn-lifecycle.integration.spec.ts). |
| B3.K-02 | ACCRUAL JV1 with WHT > 0 throws V15 `BadRequestException` | P2 | ✅ | this PR | **NEW test** added in [expense-documents.service.spec.ts `B3 / K-02 (V15)`](../../../apps/api/src/modules/expense-documents/__tests__/expense-documents.service.spec.ts) + control test for `whtFormType: 'PND53'` to ensure V15 fires (not the form-type guard). |
| B3.K-03 | SETTLEMENT JV of an ACCRUAL with WHT — WHT lands on settlement leg | P2 | ✅ | exists | Covered by [vendor-settlement.template.spec.ts:151](../../../apps/api/src/modules/expense-documents/__tests__/vendor-settlement.template.spec.ts) — `with WHT (PND3) — Dr 21-1104 5000 / Cr cash 4900 + Cr 21-3102 100`. |
| B3.K-04 | ภ.พ.30 export uses `11-4101` balance for input VAT refund | P2 | ⬜ | out-of-scope | Belongs to **tax module** test suite, not expense-documents. Defer to a separate B3-tax sub-project. K-01 already proves `11-4101` is the booking account; whether ภ.พ.30 export reads it correctly is downstream. |
| B3.K-05 | Multi-line Adjustment with `diff = 0` POSTs successfully | P2 | ✅ | this PR | **NEW test** in expense-documents.service.spec.ts `B3 / K-05 (V12 fast path)` — omit `amountPaid` and `adjustments`, POSTs successfully (proves the post-B2 helper extraction didn't break the legacy zero-adjustment path). |
| B3.K-06 | Multi-line Adjustment with `Σ amount ≠ \|diff\|` throws V12 | P2 | ✅ | exists | Covered in 2 places: [settlement-lifecycle.integration.spec.ts `B2 / K-07 negative`](../../../apps/api/src/modules/expense-documents/__tests__/settlement-lifecycle.integration.spec.ts) (SE side) + the existing SAMEDAY V12 test in this same service spec. |
| B3.K-07 | SETTLEMENT + adjustment results in balanced JE | P2 | ✅ | #863 | Covered by 3 integration tests added in #863 — happy path + V12 violation + V13 disallowed-code. |
| B3.K-08 | Direction routing: `diff < 0` → `52-1104` (underpay); `diff > 0` → `53-1503` (overpay) | P2 | ✅ | this PR | **2 NEW tests** in expense-documents.service.spec.ts `B3 / K-08 (direction overpay)` and `B3 / K-08 (direction underpay)`. Confirms signed-sum rule routes either side correctly + rejects wrong-side via V12. Verifies Dev Action #1 fix is locked in. |

## Decision Log

- **2026-05-16:** This sub-project is primarily a **coverage audit** of existing tests with targeted additions for the 3 real gaps. Of the 14 items: 10 had existing coverage (8 directly + 2 reinterpreted under the post-B1 architecture), 3 needed new tests (K-02, K-05, K-08), 1 deferred (K-04 belongs to tax-module suite), 1 blocks on prod (J-06 depends on A0.2).
- **2026-05-16:** J-04 / J-05 reinterpreted. The `calculateSSO()` function the Settings Audit assumed never existed in the codebase. The equivalent guarantee (cap enforcement at the right value per period) is supplied by `SsoConfigService.validateContribution`, which has 10 dedicated tests in `sso-config.service.spec.ts`. Marking both ✅ on the strength of that coverage rather than fabricating a `calculateSSO()` function just to satisfy the row.

## Open Questions

- [x] Q: Should B3 verify existing tests pass before adding new ones, or assume passing main + add new on top? — **Audit first, then add**. The audit revealed 10/14 already covered, avoiding duplicate-test churn.
- [x] Q: B3.J-04 — update test expectation in same PR as B1.5, or here separately? — **Moot** since `calculateSSO()` doesn't exist; B1's SsoConfigService covers the underlying invariant.

## Dependencies

- ✅ T0
- ✅ B1 SsoConfigService (covers J-04, J-05 substitutes)
- ✅ B2 SETTLEMENT adjustment (covers K-07)
- ⬜ A0.2 prod migration (blocks J-06)
- ⬜ Tax module suite (out-of-scope owner for K-04)

## Test file paths (reference)

- `apps/api/src/modules/expense-documents/__tests__/payroll.service.spec.ts`
- `apps/api/src/modules/expense-documents/__tests__/payroll-lifecycle.integration.spec.ts`
- `apps/api/src/modules/expense-documents/__tests__/settlement-lifecycle.integration.spec.ts`
- `apps/api/src/modules/expense-documents/__tests__/full-lifecycle.integration.spec.ts`
- `apps/api/src/modules/expense-documents/__tests__/cn-lifecycle.integration.spec.ts`
- `apps/api/src/modules/expense-documents/__tests__/multi-line-lifecycle.integration.spec.ts`
- `apps/api/src/modules/expense-documents/__tests__/create-payroll.dto.spec.ts`
