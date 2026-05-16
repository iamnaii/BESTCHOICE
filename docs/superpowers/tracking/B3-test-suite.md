# B3 · Test Suite J + K

**Status:** ⬜ Pending  |  **Started:** —  |  **PRs:** —
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
| B3.J-01 | PAYROLL JV — `Cr 21-3105 = sso_employee_amount` | P2 | ⬜ | — | Should exist in payroll-lifecycle spec |
| B3.J-02 | PAYROLL JV — `Cr 21-3106 = sso_employer_amount` | P2 | ⬜ | — | Should exist in payroll-lifecycle spec |
| B3.J-03 | PAYROLL JV — `Dr 53-1102 = sso_employer_amount` | P2 | ⬜ | — | Should exist in payroll-lifecycle spec |
| B3.J-04 | `calculateSSO(20000)` returns **875** (ceiling, post-B1) | P2 | ⬜ | — | Currently expects 750 — must update after B1 lands |
| B3.J-05 | `calculateSSO(10000)` returns **500** (5% of base) | P2 | ⬜ | — | Below ceiling — unaffected by B1 |
| B3.J-06 | Trial Balance — `21-1104` no longer contains SSO rows | P2 | ⬜ | — | Tracks A0.2 reclassify; query asserts count = 0 |

## Items Checklist · Suite K (Critical Fixes)

| ID | Item | Priority | Status | PR | Evidence/Notes |
|---|---|---|---|---|---|
| B3.K-01 | Every JV with VAT > 0 uses `Dr 11-4101` (not `11-2104`) | P2 | ⬜ | — | Anti-regression for ม.83/6 mis-routing |
| B3.K-02 | ACCRUAL JV1 with WHT > 0 throws V15 `BadRequestException` | P2 | ⬜ | — | Should already exist — verify |
| B3.K-03 | SETTLEMENT JV of an ACCRUAL with WHT — WHT lands on settlement leg | P2 | ⬜ | — | Verify routing via vendor-settlement template spec |
| B3.K-04 | ภ.พ.30 export uses `11-4101` balance for input VAT refund | P2 | ⬜ | — | Verify via tax module spec |
| B3.K-05 | Multi-line Adjustment with `diff = 0` POSTs successfully | P2 | ⬜ | — | Edge case |
| B3.K-06 | Multi-line Adjustment with `Σ amount ≠ \|diff\|` throws V12 | P2 | ⬜ | — | Should already exist |
| B3.K-07 | SETTLEMENT + adjustment results in balanced JE | P2 | ⬜ | — | NEW — depends on B2.5 |
| B3.K-08 | Direction routing: `diff < 0` → `52-1104` (underpay); `diff > 0` → `53-1503` (overpay) | P2 | ⬜ | — | NEW — verifies Dev Action #1 fix |

## Decision Log

(empty)

## Open Questions

- [ ] Q: Should B3 verify existing tests pass before adding new ones, or assume passing main + add new on top?
- [ ] Q: B3.J-04 — update test expectation in same PR as B1.5, or here separately?

## Dependencies

- ✅ T0
- B1.5 (fixture update) overlaps with B3.J-04 — coordinate ordering
- B2.5 maps directly to B3.K-07

## Test file paths (reference)

- `apps/api/src/modules/expense-documents/__tests__/payroll.service.spec.ts`
- `apps/api/src/modules/expense-documents/__tests__/payroll-lifecycle.integration.spec.ts`
- `apps/api/src/modules/expense-documents/__tests__/settlement-lifecycle.integration.spec.ts`
- `apps/api/src/modules/expense-documents/__tests__/full-lifecycle.integration.spec.ts`
- `apps/api/src/modules/expense-documents/__tests__/cn-lifecycle.integration.spec.ts`
- `apps/api/src/modules/expense-documents/__tests__/multi-line-lifecycle.integration.spec.ts`
- `apps/api/src/modules/expense-documents/__tests__/create-payroll.dto.spec.ts`
