# Merge Guard Report — feat/expense-documents-pr3

**Date**: 2026-05-15  
**Branch**: `feat/expense-documents-pr3`  
**Author**: Akenarin Kongdach  
**Last commit**: 2026-05-10  
**Unique commits vs main**: 10  

---

## File Changes Summary

New feature: Payroll document type (`documentType = 'PAYROLL'`) with multi-line employee breakdown.

Key files added/changed (new code only, relative to main):
| File | Change |
|------|--------|
| `apps/api/src/modules/expense-documents/expense-documents.service.ts` | +79 lines `createPayroll()` method, branch-access guard |
| `apps/api/src/modules/expense-documents/expense-documents.controller.ts` | +12 lines `POST /expense-documents/payroll` endpoint |
| `apps/api/src/modules/journal/cpa-templates/payroll.template.ts` | New PayrollTemplate JE (Dr 53-1101 / Cr cash+WHT+SSO) |
| `apps/api/src/modules/expense-documents/dto/create-payroll.dto.ts` | New DTO with multi-line validator |
| `apps/api/prisma/schema.prisma` | `PayrollDetail`, `PayrollLine` models |
| `apps/web/src/pages/PaymentsPage/components/RecordPaymentWizard.tsx` | 1103 lines (pre-existing, not introduced by this branch) |
| `apps/api/src/modules/expense-documents/__tests__/payroll-lifecycle.integration.spec.ts` | Integration tests |
| `apps/api/src/modules/journal/cpa-templates/__tests__/payroll.template.spec.ts` | Unit tests |
| Docs plan + fix commit | Review-cycle fixes (branch check, account codes, period format) |

---

## Issues Found

### Critical (block merge)

None found.

---

### Warning (should fix before merge)

**W1 — SSO payable using wrong account code**  
File: `apps/api/src/modules/journal/cpa-templates/payroll.template.ts`  

The `PayrollTemplate` posts SSO employee deduction to `21-1104` (เจ้าหนี้ค่าใช้จ่ายกิจการ — generic AP payable), but the accounting rules (`docs/superpowers/specs/accounting.md` and `.claude/rules/accounting.md`) specify:
- `21-3105` — เงินสมทบประกันสังคม-พนักงานค้างนำส่ง (employee deduction)  
- `21-3106` — เงินสมทบประกันสังคม-นายจ้างค้างนำส่ง (employer contribution)  

The code correctly acknowledges this with a TODO comment: `// TODO(CPA Phase A.7): no dedicated SSO payable in CoA. Using 21-1104 as defensible placeholder.`

However, `21-3105` already exists in the CoA from Phase A.4. Using `21-1104` will:
- Bloat the AP payable (21-1104) with SSO amounts that don't belong there
- Make สปส.1-10 reconciliation harder (accounting rules explicitly state the dedicated accounts were added to make filing trivial)
- Require a historical reclassification migration (like the one already documented in `apps/api/prisma/migrations-manual/2026-05-11-reclassify-sso-21-1104-to-21-3105.sql`)

**Recommended fix**: Change `21-1104` → `21-3105` and add the employer-match leg `21-3106` + expense `53-1102`. If the CoA CSV doesn't have `21-3106`, add it before merging.

---

**W2 — `Number()` in integration test for JE debit/credit sums**  
File: `apps/api/src/modules/expense-documents/__tests__/payroll-lifecycle.integration.spec.ts`  

```ts
const drSum = je.lines.reduce((s, l) => s + Number(l.debit), 0);
const crSum = je.lines.reduce((s, l) => s + Number(l.credit), 0);
```

Using `Number()` on `Prisma.Decimal` in tests is acceptable for rough equality checks (`expect(drSum).toBeCloseTo(...)`) but can mask precision errors for exact assertions (`expect(drSum).toBe(25000)`). For a payroll JE with whole-baht amounts this is low-risk, but the project convention is `Prisma.Decimal` for financial values. Consider using `.toNumber()` via a Decimal reduction or comparing stringified values.

Severity: low — test-only, no production data impact.

---

### Info

**I1 — `RecordPaymentWizard.tsx` is 1103 lines** (present on both this branch and main via prior merge; not introduced here). The component is hard to maintain at this size. Consider extracting step sub-components post-merge.

**I2 — Payroll JE template missing employer-match leg**: `PayrollTemplate` only posts the employee-deduction side (Dr salary expense / Cr SSO-employee + WHT + cash). The employer SSO contribution (`53-1102` Dr / `21-3106` Cr) is absent. If the business books employer SSO, this must be added. If employer SSO is deferred to Phase A.7, add a `// deferred` comment explaining the intent.

---

## Positive Signals

- `createPayroll()` uses `Prisma.Decimal` throughout for all monetary computations — no `Number()` on financial values.
- `@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)` present at controller class level — all routes protected.
- New endpoint `POST /expense-documents/payroll` has `@Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')`.
- Branch-access enforcement added: `hasCrossBranchAccess(user)` check — non-cross-branch users cannot create payroll for other branches (`ForbiddenException`).
- Payroll period forced to ค.ศ. format in review fix commit.
- `PayrollTemplate` tested with balanced Dr=Cr assertions.
- No hardcoded secrets, no raw SQL injection risks, no raw `fetch()` in frontend.
- `CreatePayrollDto` has proper class-validator decorators on all fields.

---

## Recommendation

**REVIEW** — Do not merge until W1 (SSO account code) is resolved. The `21-1104` usage contradicts the documented accounting chart and will create an immediate backlog of misbooked journal lines that need reclassification. Fix takes ~10 lines in the template. Once W1 is addressed and optionally I2 is clarified, this branch is APPROVE.
