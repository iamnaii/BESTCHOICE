# Pre-Merge Guard Report — fix/expenses-6-critical-gl-bugs

**Date**: 2026-05-15  
**Branch**: `fix/expenses-6-critical-gl-bugs`  
**Author**: Akenarin Kongdach  
**Commits**: 7  
**Reviewed against**: `origin/main`

---

## File Changes Summary

```
23 files changed, 1822 insertions(+), 111 deletions(-)
```

Key files modified:
- `apps/api/src/modules/expense-documents/expense-documents.service.ts` (+362 lines)
- `apps/api/src/modules/journal/cpa-templates/vendor-settlement.template.ts` (+104)
- `apps/api/src/modules/journal/utils/wht-form-type.ts` (new)
- `apps/api/src/modules/expense-documents/dto/create-payroll.dto.ts` (new)
- `apps/api/src/modules/journal/journal-auto.service.ts` (+32)
- `apps/web/src/pages/PaymentVoucherPage.tsx` (+88)

---

## Issues by Severity

### Critical — None found ✅

- No new controllers missing `@UseGuards(JwtAuthGuard)`.
- No `Number()` applied to monetary Prisma fields in production code.
- All new queries include `where: { deletedAt: null }` (verified in `findMany`, `findFirst` calls in expense-documents.service.ts).
- No hardcoded secrets or API keys.
- No unparameterized `$queryRaw`.
- No missing `@Roles()` on new endpoints (no new controllers added).

### Warning — None found ✅

- New DTO `CreatePayrollDto` has Thai validation messages on key fields:
  - `employeeName`: `'ชื่อพนักงานต้องมีอย่างน้อย 2 ตัวอักษร'`
  - `ssoEmployee`: `'SSO ต่อคนไม่เกิน 750 บาท/เดือน (5% × 15000 ceiling)'`
  - `payrollPeriod`: `'รูปแบบงวดต้องเป็น YYYY-MM...'`
  - `documentDate`: `'วันที่จ่ายไม่ถูกต้อง'`
- `PaymentVoucherPage.tsx` uses `api.get()`/`api.post()` pattern (no raw `fetch()` found).
- `journal-auto.service.ts` C9 fix correctly removes the global period guard from `createAndPost` with thorough documentation of call sites that each guard independently.

### Info

1. **Large files** — `expense-documents.service.ts` is 1517 lines. Pre-existing growth; this branch adds critical bug fixes, not the appropriate moment to split. Track separately.

2. **Missing Thai messages on two DTO fields** — `@Min(0)` on `ssoEmployee` and `whtAmount` in `CreatePayrollDto` lack explicit Thai messages (will fall back to default English). Low risk (these are `@IsOptional()` fields), but worth harmonising.

3. **New `wht-form-type.ts` utility** — correctly implemented with centralised `assertWhtFormType()` and `isWhtFormType()` helpers. Throws with Thai error string. No issues.

4. **`journal-auto.service.ts` comment verbosity** — the C9 period-guard audit comment enumerates 10 call sites. Useful now, but will drift as code evolves. Consider a brief unit test assertion instead of the comment long-term.

---

## Commit Highlights

| Commit | Summary |
|--------|---------|
| `b7f53b73` | C12 symmetry — WHT routing guard extended to SE/CN/PAYROLL |
| `78e41b9f` | 6 Critical GL bugs (JE preview, partial settlement, period guard, attachment, SSO cap, WHT routing) |
| `59ce34e9` | 8 Warning fixes (adjustment allow-list, APAging drift, BKK dates, doc-number overflow, WHT cert) |
| `01040594` | C9 period guard moved off `createAndPost`; C8 cheap idempotency |
| `0a1e6a1f` | W7 Decimal precision in form 50 ทวิ certificate |
| `2c10fdad` | 5 Info fixes (WHT helper, CN lock order, JE preview gating, daily summary multi-line) |
| `4ac1d374` | docs: V15 exemption JSDoc + SSO cap TODO |

---

## Recommendation: ✅ APPROVE

No critical or warning issues found. The Info items are pre-existing or cosmetic. Branch is safe to merge.
