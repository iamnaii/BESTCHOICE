# Merge Guard Report — hotfix/defect-exchange-preset-contract-visibility

**Date**: 2026-05-23  
**Branch**: `hotfix/defect-exchange-preset-contract-visibility`  
**Base**: `origin/main`  
**Reviewed by**: Pre-Merge Guard Agent

---

## File Changes Summary

| File | +/- |
|------|-----|
| `apps/web/src/pages/DefectExchangePage.tsx` | +9 / -3 |
| `apps/web/package.json` | version bump |

Total: **2 files changed**, 9 insertions(+), 3 deletions(-)

---

## Commits on Branch (beyond main)

1. `d7bbd478` fix(defect-exchange): show preset contract in dropdown even if PHONE_NEW

---

## Issues

### Critical
_None found._

### Warning
_None found._

### Info

**I1 — Query key scoped to `presetContractId`**  
`queryKey: ['defect-exchange-contracts', presetContractId ?? null]` — correct React Query practice. Prevents stale cache when navigating between contracts from the wizard.

**I2 — PHONE_NEW in exchange list with eligibility surfacing**  
The fix includes PHONE_NEW contracts when `presetContractId` is set rather than silently returning an empty dropdown. Eligibility check remains active and will surface rule violations to the user (e.g. "ไม่เข้าเกณฑ์"). This is the correct UX pattern — better feedback than a blank picker.

---

## Recommendation

**APPROVE** — Minimal, targeted bug fix. No security, money, or data-integrity concerns. Addresses the case where navigating to the defect-exchange flow with a preset PHONE_NEW contract would result in an empty contract dropdown, leaving the user with no feedback.

_Should be merged before `feat/defect-exchange-wizard-flow` which is built on top of this fix._
