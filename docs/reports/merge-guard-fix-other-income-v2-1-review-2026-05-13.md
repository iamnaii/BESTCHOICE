# Merge Guard Report — fix/other-income-v2-1-review-followup

**Date**: 2026-05-13  
**Branch**: `fix/other-income-v2-1-review-followup`  
**Author**: Akenarin Kongdach  
**Commits**: 3 (2026-05-12)  
**Recommendation**: ✅ APPROVE

---

## File Changes Summary

5 files changed, 89 insertions(+), 31 deletions(−)

- `apps/api/src/modules/other-income/other-income.controller.ts` — role cleanup on template endpoints
- `apps/api/src/modules/other-income/other-income.service.ts` — CAS guard on `approve()` + `reject()`, Thai error messages
- `apps/api/src/modules/other-income/__tests__/maker-checker.spec.ts` — new CAS race test + afterEach flag restore
- `apps/web/src/pages/other-income/OtherIncomeTemplatesPage.tsx` — rename `useMutation_` → `applyTemplateMutation`
- `apps/web/src/pages/other-income/components/TemplatePickerCombobox.tsx` — same rename

---

## Issues Found

None.

---

## Notable Improvements

**1. CAS (Compare-And-Swap) concurrency guard on `approve()` and `reject()`**

```ts
// approve() — atomically flips READY → POSTED only if still READY
const claimed = await tx.otherIncome.updateMany({
  where: { id, status: OtherIncomeStatus.READY },
  data: { status: OtherIncomeStatus.POSTED, approverId: userId, approvedAt: now, ... },
});
if (claimed.count === 0) {
  throw new ConflictException(`เอกสาร ... ถูกอนุมัติหรือปฏิเสธโดยผู้อื่นแล้ว — กรุณารีโหลด`);
}
```

This correctly prevents two concurrent approvers from double-posting the same document. The reject path has the same guard. The race test (`Promise.allSettled`) verifies that exactly one call wins.

**2. Role cleanup — `SALES` removed from template and approval endpoints**

```diff
- @Roles('OWNER', 'ACCOUNTANT', 'SALES', 'FINANCE_MANAGER')
+ @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
```

Template management and approval request should not be accessible to `SALES`. This is correct tightening.

**3. `afterEach` flag restore guards against test state leakage**

The maker-checker flag is restored after every test in the spec, preventing test ordering failures if an assertion throws before the inline `prisma.update` restore.

**4. Thai error messages on Maker-Checker disabled state**

```diff
- throw new BadRequestException('Maker-Checker disabled — use POST directly');
+ throw new BadRequestException('Maker-Checker ปิดอยู่ — ใช้ /post โดยตรง');
```

Consistent with the Thai validation message convention.

---

## Security Checks — PASSED

| Check | Result |
|-------|--------|
| No new controllers | ✅ N/A |
| No new endpoints — only role changes on existing | ✅ All changes tighten, not loosen, access |
| No `Number()` on financial fields | ✅ None |
| No raw `$queryRaw` | ✅ None |
| No hardcoded secrets | ✅ None |
| `deletedAt: null` in queries | ✅ Not applicable (no new queries) |
| Frontend mutations have `invalidateQueries` | ✅ Not applicable (no new mutations) |

---

## Recommendation: ✅ APPROVE

Clean, well-scoped fix. All changes are defensive improvements with tests. Safe to merge.
