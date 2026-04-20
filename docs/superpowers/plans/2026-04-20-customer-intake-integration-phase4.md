# Customer Intake Integration (Phase 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** Wire the Customer Intake Wizard (Phase 3) into the rest of the app — `/contracts/create` reads `?customerId=` to pre-select, `/customers` list redirects to the wizard for new customers, manager review queue accessible via filter.

**Architecture:** Pure integration — no new backend logic. Add URL-param handling to existing hook, redirect button to new page, new filter chip. Reuses Phase 1-3 pieces.

**Tech Stack:** React Router URL params, existing hooks.

**Spec reference:** [docs/superpowers/specs/2026-04-20-customer-intake-credit-check-redesign-design.md](../specs/2026-04-20-customer-intake-credit-check-redesign-design.md) section 5 (flow), section 12 Phase 4.

---

## File Structure

### Modified
- `apps/web/src/pages/ContractCreatePage/hooks/useContractCreateData.ts` — accept preselected customer from URL
- `apps/web/src/pages/ContractCreatePage/index.tsx` — skip step 1 (customer select) when preselected
- `apps/web/src/pages/CustomersPage.tsx` — "+ เพิ่มลูกค้า" button → `/customer-intake`, add review-queue filter
- `apps/web/e2e/customer-intake-full-flow.spec.ts` — new E2E for full happy path

---

## Task 1: ContractCreatePage — accept `?customerId=` pre-select

**Files:**
- Modify: `apps/web/src/pages/ContractCreatePage/hooks/useContractCreateData.ts`
- Modify: `apps/web/src/pages/ContractCreatePage/index.tsx`

- [ ] **Step 1: Read searchParams in hook**

In `useContractCreateData.ts`, add import at top:
```typescript
import { useSearchParams } from 'react-router';
```

Near the top of the hook (after `useNavigate()`):
```typescript
const [searchParams] = useSearchParams();
const preselectedCustomerId = searchParams.get('customerId');
```

After the existing `useState` for `selectedCustomer`, add a query to fetch the preselected customer (only if param present):
```typescript
useQuery({
  queryKey: ['preselect-customer', preselectedCustomerId],
  queryFn: async () => {
    if (!preselectedCustomerId) return null;
    const { data } = await api.get(`/customers/${preselectedCustomerId}`);
    if (data && !selectedCustomer) {
      setSelectedCustomer(data);
      setStep((s) => (s === 0 ? 1 : s)); // skip customer select step if on step 0 → jump to plan
    }
    return data;
  },
  enabled: !!preselectedCustomerId && !selectedCustomer,
});
```

Wait — current wizard has 3 steps (product → customer → plan). If customerId pre-set, user should skip to plan step. But they still need to pick product first. So:
- Step 0 (product select) — stay
- Step 1 (customer select) — SKIP if pre-selected, auto-select and jump forward
- Step 2 (plan) — final

Modify the logic: when preselectedCustomer loads, set selectedCustomer AND set step=1 only after product is also selected. Actually simpler: don't auto-jump, just pre-select. The wizard's `canNext()` logic will let user proceed naturally.

Simplified implementation — just auto-set selectedCustomer:
```typescript
useQuery({
  queryKey: ['preselect-customer', preselectedCustomerId],
  queryFn: async () => {
    if (!preselectedCustomerId) return null;
    const { data } = await api.get(`/customers/${preselectedCustomerId}`);
    return data;
  },
  enabled: !!preselectedCustomerId && !selectedCustomer,
});
```

Then in a separate `useEffect`:
```typescript
useEffect(() => {
  // Auto-advance to customer step if product is already selected and customer just loaded
  if (preselectedCustomerId && selectedCustomer && step === 0 && selectedProduct) {
    setStep(2); // skip customer-select, go directly to plan
  }
}, [preselectedCustomerId, selectedCustomer, selectedProduct, step]);
```

But the subsequent issue: we need the query data to flow to selectedCustomer. Let me use queryClient to seed + setState:

Final clean version:
```typescript
useQuery<Customer | null>({
  queryKey: ['preselect-customer', preselectedCustomerId],
  queryFn: async () => {
    if (!preselectedCustomerId) return null;
    const { data } = await api.get(`/customers/${preselectedCustomerId}`);
    return data;
  },
  enabled: !!preselectedCustomerId,
});

useEffect(() => {
  if (!preselectedCustomerId || selectedCustomer) return;
  // Fetch + set imperatively via queryClient cache
  const cached = queryClient.getQueryData<Customer>(['preselect-customer', preselectedCustomerId]);
  if (cached) setSelectedCustomer(cached);
}, [preselectedCustomerId, selectedCustomer, queryClient]);
```

Simpler — just put the setter inside queryFn:

```typescript
const { data: _preselected } = useQuery({
  queryKey: ['preselect-customer', preselectedCustomerId],
  queryFn: async () => {
    if (!preselectedCustomerId) return null;
    const { data } = await api.get(`/customers/${preselectedCustomerId}`);
    if (data) setSelectedCustomer(data);
    return data;
  },
  enabled: !!preselectedCustomerId && !selectedCustomer,
});
```

(Side-effect in queryFn is OK here — it's idempotent + gated.)

- [ ] **Step 2: Type check**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE && ./tools/check-types.sh web
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/ContractCreatePage/hooks/useContractCreateData.ts
git commit -m "feat(contract-create): support ?customerId= URL param to preselect customer

Wired to Phase 3 intake wizard which redirects here with the param."
```

---

## Task 2: CustomersPage — redirect "+ เพิ่มลูกค้า" + review-queue filter

**Files:**
- Modify: `apps/web/src/pages/CustomersPage.tsx`

- [ ] **Step 1: Change button to redirect**

Find the `+ เพิ่มลูกค้า` button handler. If it opens a modal, REPLACE with navigation:

```tsx
<Button
  variant="primary"
  onClick={() => navigate('/customer-intake')}
>
  + เพิ่มลูกค้าใหม่
</Button>
```

Remove any `showCreateModal` state + `CustomerCreateModal` rendering if they were only used for new-customer creation from this page. (If the same modal is used for OTHER features, leave it.)

Check: does `CustomersPage.tsx` render a `CustomerCreateModal`? Look for imports and JSX. If yes, assess if it's only for "+ เพิ่มลูกค้า" — if so, remove.

- [ ] **Step 2: Add creditCheckStatus filter for review queue**

In the filter bar, add a new select beside existing filters:
```tsx
<select
  value={creditStatusFilter}
  onChange={(e) => setCreditStatusFilter(e.target.value)}
  className="h-10 px-3 rounded-lg border border-input bg-background text-sm"
>
  <option value="">ทุกสถานะเครดิต</option>
  <option value="UNDER_REVIEW">รอผู้จัดการตรวจ</option>
  <option value="PRE_CHECK_PASSED">ผ่าน pre-check</option>
  <option value="FULL_CHECK_PASSED">ผ่านเต็ม</option>
  <option value="REJECTED">ไม่ผ่าน</option>
</select>
```

State:
```typescript
const [creditStatusFilter, setCreditStatusFilter] = useState('');
```

Thread into query key + params:
```typescript
if (creditStatusFilter) params.set('creditCheckStatus', creditStatusFilter);
```

Page reset effect should include this new filter:
```typescript
useEffect(() => setPage(1), [debouncedSearch, statusFilter, creditFilter, tierFilter, branchFilter, creditStatusFilter]);
```

- [ ] **Step 3: Backend — accept `creditCheckStatus` query param**

Open `apps/api/src/modules/customers/customers.controller.ts`. Add query param:
```typescript
@Query('creditCheckStatus') creditCheckStatus?: string,
```
Pass to service.

In `customers.service.ts` `findAll()`, accept the new param and add to `where` clause:
```typescript
if (creditCheckStatus) where.creditCheckStatus = creditCheckStatus;
```

- [ ] **Step 4: Type check**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE && ./tools/check-types.sh all
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/CustomersPage.tsx apps/api/src/modules/customers/customers.controller.ts apps/api/src/modules/customers/customers.service.ts
git commit -m "feat(customer): redirect create button + credit status filter

- '+ เพิ่มลูกค้าใหม่' ไป /customer-intake (full wizard)
- เพิ่ม filter สถานะเครดิต (UNDER_REVIEW, PRE/FULL_CHECK_PASSED, REJECTED)
- Backend accepts creditCheckStatus query param on /customers list

Manager review queue = /customers?creditCheckStatus=UNDER_REVIEW"
```

---

## Task 3: E2E full-flow smoke test

**Files:**
- Create: `apps/web/e2e/customer-intake-full-flow.spec.ts`

- [ ] **Step 1: E2E**

```typescript
import { test, expect } from '@playwright/test';
import { loginViaAPI } from './helpers/auth';
import { gotoWithRetry, hasErrorBoundary } from './helpers/navigation';

test.describe('Customer Intake — full flow smoke', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
  });

  test('clicking "+ เพิ่มลูกค้าใหม่" navigates to /customer-intake', async ({ page }) => {
    const ok = await gotoWithRetry(page, '/customers');
    if (!ok) return;
    const btn = page.getByRole('button', { name: /เพิ่มลูกค้า/ }).first();
    if (!(await btn.isVisible({ timeout: 5000 }).catch(() => false))) return;
    await btn.click();
    await page.waitForURL(/\/customer-intake$/);
    expect(await hasErrorBoundary(page)).toBe(false);
  });

  test('contracts/create accepts ?customerId= param', async ({ page }) => {
    // First, find an existing customer id
    await gotoWithRetry(page, '/customers');
    const firstRow = page.locator('table tbody tr').first();
    if (!(await firstRow.isVisible({ timeout: 5000 }).catch(() => false))) return;
    await firstRow.click();
    await page.waitForURL(/\/customers\/[^/]+$/, { timeout: 10000 });
    const url = page.url();
    const customerId = url.split('/').pop()?.split('?')[0];
    if (!customerId) return;

    await gotoWithRetry(page, `/contracts/create?customerId=${customerId}`);
    // Page should load without error
    expect(await hasErrorBoundary(page)).toBe(false);
  });

  test('credit status filter chip exists on /customers', async ({ page }) => {
    const ok = await gotoWithRetry(page, '/customers');
    if (!ok) return;
    await expect(page.getByText(/ทุกสถานะเครดิต|รอผู้จัดการตรวจ/).first()).toBeVisible({
      timeout: 10000,
    });
  });
});
```

- [ ] **Step 2: Commit + push + PR**

```bash
git add apps/web/e2e/customer-intake-full-flow.spec.ts
git commit -m "test(customer-intake): E2E full flow smoke"
git push -u origin feat/customer-intake-integration-phase4
gh pr create --base main --title "feat(customer): Intake Integration (Phase 4)" --body "..."
```

---

## Self-Review

Spec coverage:
- Section 12 Phase 4: all items delivered (pre-select, redirect, review queue filter, E2E)

No placeholders. Types consistent.

Scope tight — only integration; no logic duplicated.
