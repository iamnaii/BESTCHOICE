# Pre-Merge Guard Report

**Branch**: `fix/installment-schedules-on-activate`
**Author**: Akenarin Kongdach
**Review date**: 2026-05-06
**Recommendation**: 🟡 REVIEW

---

## File Changes Summary

This branch is a superset of `feat/payment-wizard-je-preview` (includes all wizard changes) plus one additional commit:

| File | +/- |
|------|-----|
| `apps/api/src/modules/contracts/contract-workflow.service.ts` | +64 |
| *(all `feat/payment-wizard-je-preview` files)* | see wizard report |

**Total delta vs main**: 12 files changed, 2275 insertions(+), 279 deletions(-)

---

## Issues

### 🔴 Critical

_None specific to the installment-schedule commit. See `feat/payment-wizard-je-preview` report for wizard-specific issues._

---

### ⚠️ Warning

#### [W-1] `generateInstallmentSchedules` is non-blocking — silent failure leaves contract without schedules

**Location**: `apps/api/src/modules/contracts/contract-workflow.service.ts` (~line 474)

```typescript
// Phase A.4 — generate installment_schedules rows
this.generateInstallmentSchedules(contract).catch((err) => {
  this.logger.error(...);
  Sentry.captureException(err, ...);
  // silently continues — no rethrow
});
```

The `.catch()` without re-throw means a failure in schedule generation does not roll back or block contract activation. If `generateInstallmentSchedules` fails (DB constraint, timeout, etc.), the contract moves to ACTIVE with zero schedules. The accrual cron (`InstallmentAccrual2ATemplate`), payment preview endpoint, and the `RecordPaymentWizard` all call `installmentSchedule.findUnique()` and will get `null` — silently failing or throwing NotFoundException.

**Risk**: This is a data-consistency issue. A contract activated without schedules will not accrue interest and cannot be paid via the new wizard. The Sentry alert would eventually be noticed, but in the meantime the contract is operationally broken.

**Recommendation**: Keep the non-blocking call pattern (to avoid blocking activation), but add an async health-check / compensating retry mechanism, or at minimum store a flag on the contract indicating schedules are pending so the UI can warn staff.

#### [W-2] Schedule base date uses `c.createdAt` instead of activation date

**Location**: `apps/api/src/modules/contracts/contract-workflow.service.ts` — `generateInstallmentSchedules()`

```typescript
const baseDate = c.createdAt;
const dueDay = c.paymentDueDay ?? baseDate.getDate();

for (let i = 1; i <= total; i++) {
  const dueDate = new Date(baseDate.getFullYear(), baseDate.getMonth() + i, dueDay);
```

`createdAt` is the DRAFT creation timestamp, not the activation timestamp. A contract drafted on April 28 but activated on May 3 would generate due dates starting May 28 instead of June 3. The `Contract` model has no `activatedAt` field, so this is a schema gap rather than a code bug, but the generated schedules will be systematically early for any contract not activated on the same day it was drafted.

**Recommendation**: Add `activatedAt DateTime?` to `Contract` schema and set it on activation, then use it as `baseDate` in `generateInstallmentSchedules`. Without this, schedule due dates are incorrect for deferred-activation contracts.

#### [W-3–W-5] (inherited from `feat/payment-wizard-je-preview`)

See separate wizard report for W-1 (raw fetch), W-2 (missing UserThrottlerGuard on preview-journal), and W-3 (`as any` type cast).

---

### ℹ️ Info

#### [I-1] Schedule generation is idempotent — safe to re-run

The implementation correctly checks `existing > 0` before generating, so a compensating script or manual re-trigger will not duplicate rows. Good defensive coding.

#### [I-2] Large `RecordPaymentWizard.tsx` (1162 lines) — inherited from wizard branch

See wizard report I-1.

---

## Summary

This branch builds on the payment wizard by adding `generateInstallmentSchedules` to the contract activation flow — a necessary prerequisite for accrual crons and the wizard's `installmentSchedule.findUnique()` lookup to work.

The main concern is **W-1**: schedule generation failure silently leaves an activated contract without schedules, breaking interest accrual and payment recording. The other issues (W-2 base-date drift) require a schema change to fully resolve.

**Recommended action before merge**:
1. Address W-1 by adding a compensating retry or contract-level flag for missing schedules.
2. Create a tracking issue for W-2 (`activatedAt` schema field) — acceptable to defer if all contracts are activated same-day, but must be resolved before allowing deferred-activation workflows.
3. Apply wizard W-2 and W-3 fixes (UserThrottlerGuard, remove `as any`).
