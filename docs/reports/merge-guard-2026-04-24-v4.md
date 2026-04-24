# Pre-Merge Guard Report — 2026-04-24 (v4)

**Generated**: 2026-04-24  
**Reviewer**: Pre-Merge Guard Agent  
**Branches reviewed**: 3 (selected from ~170 unmerged; criteria: has merge-base with main, substantive TS/TSX changes, not a guard/docs/chore branch)

---

## Branch 1: `fix/liff-payoff-close-all-installments`

**Author**: Akenarin Kongdach  
**Commit**: `7119d1eb` — 2026-04-24  
**Files changed**: 5 (`paysolutions.service.ts`, `paysolutions.module.ts`, `line-oa-payment.controller.ts`, `useLiffInit.ts`, `api.ts`)

### Summary
Rewrites the PaySolutions webhook success handler to close **all** unpaid installments in FIFO order using the paid amount, instead of only updating the single `paymentLink.paymentId`. This is the backend complement to the LIFF early-payoff flow. Also adds `sessionStorage` caching in `useLiffInit` so navigating between LIFF pages (e.g. contract → early-payoff) doesn't trigger a new OAuth round-trip and hit a 401.

### Issues Found

#### Warnings

**[W1] `Number()` conversion on Prisma.Decimal values in notification function**  
`apps/api/src/modules/paysolutions/paysolutions.service.ts`

```ts
amountPaid: Number(paidAmount),      // Prisma.Decimal → Number
originalAmount: Number(originalAmount),
savings: Number(savings),
```

These conversions are for display in a LINE Flex message only (not financial calculations), and the upstream arithmetic uses `Prisma.Decimal` throughout. Precision loss at Thai Baht scale is not a practical risk, but the pattern is inconsistent with the project's "Decimal-first" rule. Consider accepting `Prisma.Decimal` in `buildEarlyPayoffSuccessFlex` and converting to string inside the template function.

**[W2] `originalAmount` in notification may be inflated for partially-paid contracts**  
`apps/api/src/modules/paysolutions/paysolutions.service.ts` — `sendEarlyPayoffSuccessNotification`

```ts
const originalAmount = contract.payments.reduce((acc, p) => {
  const lateFee = p.lateFeeWaived ? new Prisma.Decimal(0) : p.lateFee;
  return acc.add(p.amountDue).add(lateFee);
}, new Prisma.Decimal(0));
```

This sums ALL installments (including already-PAID ones). For a customer who has paid 6 of 12 installments before choosing early payoff, the "original amount" shown in the LINE message overstates the remaining obligation by the already-paid portion. The displayed "savings" is then inflated. Consider filtering to `status: { not: 'PAID' }` installments for the notification baseline, or documenting that "original total contract value" is the intentional semantics.

#### Info

**[I1] `sessionStorage` LIFF cache — appropriate choice**  
`apps/web/src/hooks/useLiffInit.ts`

Using `sessionStorage` (tab-scoped, cleared on tab close) rather than `localStorage` for the LIFF id_token cache is correct. 50-minute TTL matches LIFF OAuth token validity. The 401 → `clearLiffSessionCache()` path in `api.ts` via dynamic import is a clean decoupling; the `.catch(() => {})` silencer for HMR is acceptable.

**[I2] Idempotency gate is correct**  
`updateMany({ where: { id, status: 'ACTIVE' }, data: { status: 'USED' } })` with Serializable isolation means only one concurrent webhook wins and retries are no-ops. This matches the pattern established in v3 hardening.

### Recommendation: **REVIEW** ✅

No Critical issues. W1 and W2 are style/accuracy concerns in the notification path only — they do not affect financial ledger correctness. The core transaction logic (FIFO installment closing, contract status, product ownership transfer) is sound.

---

## Branch 2: `redesign/liff-pay-scan-only`

**Author**: Akenarin Kongdach  
**Commits**: `34b36efc`, `aabb3ecc`, `aeb4a2ef`, `816fdcd5`, `e93ef578` — 2026-04-24  
**Files changed**: `LiffPayment.tsx` (–604/+446 lines), `liff-payment.spec.ts`, `LiffEarlyPayoff.tsx`, `firebase.json`

### Summary
Full redesign of the LIFF payment page to a "scan-to-pay only" flow: removes slip upload (manual transfer) tab entirely, removes PromptPay QR display, wires in `useLiffInit` session cache to fix 401 on reload. Also removes `/pay/{token}` landing redirect for early-payoff (LiffEarlyPayoff now calls PaySolutions directly). Firebase hosting rules updated for no-cache SPA HTML and JS/CSS immutable cache.

### Issues Found

#### Warnings

**[W1] Hardcoded hex color violates design token rule**  
`apps/web/src/pages/liff/LiffPayment.tsx`

```tsx
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="relative min-h-screen overflow-x-hidden"
      style={{ backgroundColor: '#fafaf7' }}   // ← hardcoded hex
    >
```

Rule (`.claude/rules/frontend.md`): "ห้ามใช้ hardcoded hex colors — ใช้ CSS variable tokens เท่านั้น". Replace with `className="bg-background"` or add a dedicated CSS variable. This is a linting-class violation, not a functional bug.

**[W2] `Number()` on Decimal fields used in UI comparison**  
`apps/web/src/pages/liff/LiffPayment.tsx`

```ts
const amount = data ? Number(data.amount) : 0;
const isMultiInstallment =
  amount > Number(payment.amountDue) + Number(payment.lateFee ?? 0) + 0.5;
```

Used only to branch UI display (multi-installment badge), not in financial calculations. The `+0.5` tolerance guard handles floating-point drift, but the pattern should be noted. No ledger impact.

#### Info

**[I1] Slip upload removal is intentional and documented**  
E2E tests explicitly assert `โอนเอง` tab and slip upload are NOT visible. This is a deliberate product decision (gateway-only). The test comment confirms: "Slip-upload + 'โอนเอง' tab are intentionally removed."

**[I2] `window.location.search` in component body without memo**  
Accessed once at render time in LIFF context where the URL is fixed post-load. Not a performance concern here, but worth `useMemo` if this component is ever reused in non-LIFF contexts.

### Recommendation: **REVIEW** ✅

W1 (hardcoded color) is a rule violation that should be fixed before merge. W2 is a Decimal-consistency nit. No Critical issues; the core redesign is structurally clean.

---

## Branch 3: `fix/intake-full-step-add-missing-fields`

**Author**: Akenarin Kongdach  
**Commit**: `71e194a6` — 2026-04-22  
**Files changed**: 2 (`FullIntakeStep.tsx`, `CustomerIntakePage/types.ts`)

### Summary
Adds address fields (ID-card address, current address with "same as ID card" toggle, work address) and personal fields (nickname, birthday, Facebook link URL, Google Maps link) to the customer intake full-step form. Uses the existing `AddressForm` component and existing backend DTO fields — frontend-only change.

### Issues Found

#### Warnings

**[W1] URL fields lack `@IsUrl()` validation on backend DTO**  
`apps/api/src/modules/customers/dto/customer.dto.ts`

```ts
@IsString()
@IsOptional()
facebookLink?: string;   // should be @IsUrl()

@IsString()
@IsOptional()
googleMapLink?: string;  // should be @IsUrl()
```

Both fields accept any string server-side. If these URLs are ever rendered as `<a href>` without sanitization, `javascript:` protocol injection is possible. While the branch itself only stores the values, the missing `@IsUrl({ protocols: ['http', 'https'], require_protocol: true })` validator is a latent XSS vector. This pre-dates this branch (DTO exists in main), but the branch adds the UI that surfaces these fields prominently.

**[W2] No `queryClient.invalidateQueries()` after mutation**  
`apps/web/src/pages/CustomerIntakePage/components/FullIntakeStep.tsx`

The `saveMut.onSuccess` calls `onDone()` which advances the intake flow state machine — it does not invalidate any customer queries. If the customer detail page or overview is open in another tab, or if the user navigates back to a customer page in the same session, stale cached data will show until TTL expires. Consider adding `queryClient.invalidateQueries({ queryKey: ['customer', customerId] })` in `onSuccess`.

#### Info

**[I1] `parseFloat()` on salary field**  
`payload.salary = parseFloat(form.salary)` — acceptable since `salary` is informational (credit assessment input), not used in financial ledger calculations.

**[I2] `FullIntakeStep.tsx` is ~340 lines post-change**  
Below the 500-line threshold but growing. No action required now.

### Recommendation: **REVIEW** ✅

W1 (URL validation) is a pre-existing DTO gap that this branch makes more visible but does not introduce. W2 (cache invalidation) is a UX correctness issue. No Critical issues blocking merge, but both warnings should be addressed before or shortly after merge.

---

## Summary Table

| Branch | Critical | Warning | Info | Recommendation |
|--------|----------|---------|------|----------------|
| `fix/liff-payoff-close-all-installments` | 0 | 2 | 2 | **REVIEW** |
| `redesign/liff-pay-scan-only` | 0 | 2 | 2 | **REVIEW** |
| `fix/intake-full-step-add-missing-fields` | 0 | 2 | 2 | **REVIEW** |

**No branches are BLOCKED.** All three are in REVIEW state — they have no Critical issues (no missing guards, no Decimal bypasses in ledger paths, no hardcoded secrets, no unparameterized SQL) but each has 2 Warnings that should be resolved before or shortly after merge.

### Priority fixes before merge

1. **`redesign/liff-pay-scan-only`** — Replace `style={{ backgroundColor: '#fafaf7' }}` with `className="bg-background"` (rule violation, 1-line fix).
2. **`fix/liff-payoff-close-all-installments`** — Clarify `originalAmount` semantics in notification (either filter unpaid-only or add a comment explaining "total contract value" intent).
3. **`fix/intake-full-step-add-missing-fields`** — Add `queryClient.invalidateQueries` in mutation `onSuccess`; separately add `@IsUrl()` to DTO (can be a follow-up PR).
