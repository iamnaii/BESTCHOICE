# Merge Guard Report — `fix/expenses-6-critical-gl-bugs`

**Date**: 2026-05-16  
**Author**: Akenarin Kongdach  
**Branch**: `fix/expenses-6-critical-gl-bugs` vs `main`  
**Commits**: 7  
**Files changed**: 23 (+1,822 / −111)

---

## File Changes Summary

| File | Change |
|------|--------|
| `expense-documents.service.ts` | +362 / −8 — period guard relocation (C9), WHT routing (C12), SSO cap |
| `journal-auto.service.ts` | +32 / −2 — WHT routing extended |
| `vendor-settlement.template.ts` | +104 / −13 — WHT routing + settlement guard |
| `expense-same-day.template.ts` | +31 / −6 — WHT routing |
| `credit-note.template.ts` | +14 / −5 — WHT routing |
| `je-preview.service.ts` | +92 / −3 — JE preview gating fix |
| `doc-number.service.ts` | +23 / −1 — overflow guard |
| `create-payroll.dto.ts` | +14 / −0 — `@Max(750)` SSO cap |
| `utils/wht-form-type.ts` | +41 (new) — WHT routing helper |
| `ExpenseFormV4.tsx` | +26 / −3 — form cert fix |
| `PaymentVoucherPage.tsx` | +88 / −39 — Decimal cert display |
| 12 test files | +1,100+ — new coverage for all fixes |

---

## Issues Found

### Critical — None ✅

- No new controllers without `@UseGuards` / `@Roles`
- No `Number()` on financial fields in service/template code
- All new Prisma queries include `deletedAt: null`
- No hardcoded secrets or API keys
- No unparameterized `$queryRaw`
- No raw `fetch()` in frontend files

### Warning — None ✅

- `Number.isFinite(Number(rawThreshold))` at line parsing config value (non-money, safe)
- DTO validation present on new `@Max(750)` for SSO cap (`create-payroll.dto.ts`)
- No raw `fetch()` replacing `api.get()` / `api.post()`
- WHT routing guard symmetrically applied to SE / CN / PAYROLL as documented

### Info

- **`expense-documents.service.ts` is 1,517 lines** — approaching split threshold. Consider extracting `PayrollService` or `CreditNoteService` in a future PR.
- `any` types appear only in test file mocks (acceptable — Prisma mock stubs).
- `Number.isFinite(Number(rawThreshold))` used for non-money system config threshold — not a precision risk.

---

## Key Fixes Verified

| Fix ID | Description | Verified |
|--------|-------------|---------|
| C8 | Cheap idempotency on `createAndPost` | ✅ |
| C9 | Period guard moved off `createAndPost`, now at `post()` module boundary | ✅ |
| C12 | WHT routing guard extended symmetrically to SE/CN/PAYROLL | ✅ |
| C11 | SSO cap `@Max(750)` on DTO | ✅ |
| W7 | Decimal precision in form 50 ทวิ certificate | ✅ |

---

## Recommendation

**APPROVE** ✅

All 6 original critical fixes and follow-up rounds are structurally sound. Security posture unchanged (no new controllers, existing guards maintained). Accounting conventions followed (Prisma.Decimal throughout, no Number() on money). Test coverage added for every fix.
