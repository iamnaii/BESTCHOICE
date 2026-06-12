# Pre-Merge Guard Report

**Branch**: `fix/ci-pre-existing-test-failures`
**Author**: Akenarin Kongdach <iamnaii@MacBook-Pro-khxng-Akenarin.local>
**Report Date**: 2026-06-12
**Recommendation**: ⚠️ REVIEW (rebase required before merge)

---

## Branch Summary

- Commits ahead of main: 178
- Commits behind main: 113 (diverged — needs rebase)
- Actual new work (top 2 commits): test-only fixes

### New Commits on Branch Tip

| SHA | Message |
|-----|---------|
| `77f12aed` | ci(e2e): exclude incomplete approval-workflow harness (#1192) |
| `528ca9d1` | fix(ci): repair 3 pre-existing test failures blocking the merge gate |

---

## File Changes

The 2 new commits touch only:
- `apps/api/src/modules/contracts/contract-signing-workflow.spec.ts` — added missing mock fields (`createdAt`, `findUniqueOrThrow`, `installmentSchedule.count/createMany`)
- `apps/api/src/env-validation.spec.ts` — removed 2 stale tests that guarded the removed 2FA `ENCRYPTION_KEY`
- `apps/api/e2e/jest-e2e.json` — added `testPathIgnorePatterns` to exclude unfinished `approval-workflow.e2e-spec.ts`

**No production code changes in the 2 new commits.**

---

## Issues Found

### Critical
*None*

### Warning
*None in new commits.*

### Info

| # | File | Issue |
|---|------|-------|
| I-1 | branch status | Branch is **113 commits behind `main`**. Must rebase onto current `main` before merge — otherwise the CI fix is moot (the broken tests may already be fixed differently on `main`). |
| I-2 | `e2e/jest-e2e.json` | `approval-workflow.e2e-spec.ts` is excluded via `testPathIgnorePatterns`. This is intentional (spec filed as #1192 to complete), but the exclusion should be tracked and not left indefinitely. |

---

## Verdict

The 2 commits on this branch are **test-only, low-risk fixes** that unblock the CI gate for all other PRs. The changes are correct and minimal.

**Action required before merge**: rebase onto `origin/main` to bring branch current (currently 113 commits behind). After rebase, recommend immediate merge as a gate-unblock.
