# Merge /receipts → /payments?tab=receipts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** รวมหน้า `/receipts` เป็น tab ที่ 4 ใน `/payments` — ลด sidebar clutter + UX flow "บันทึกชำระ → print ใบเสร็จ" ต่อเนื่องในจอเดียว.

**Architecture:** Frontend-only refactor. ย้าย ReceiptsPage body เป็น component ใช้ใน PaymentsPage tab. Legacy `/receipts` URL redirect. ลบ menu entries.

**Tech Stack:** React + React Router, existing PaymentsPage tab system.

**Spec:** [docs/superpowers/specs/2026-04-20-merge-payments-receipts-design.md](../specs/2026-04-20-merge-payments-receipts-design.md)

---

## File Structure

### Created
- `apps/web/src/pages/PaymentsPage/components/ReceiptsTab.tsx` — receipts body moved here (takes same API data as old ReceiptsPage)

### Modified
- `apps/web/src/pages/PaymentsPage/index.tsx` — add 4th tab + render ReceiptsTab + gate by role
- `apps/web/src/App.tsx` — `/receipts` → redirect to `/payments?tab=receipts`; remove ReceiptsPage import if no longer used elsewhere
- `apps/web/src/config/menu.ts` — remove "ใบเสร็จ" menu entries (3 roles)
- `apps/web/src/components/CommandPalette.tsx` — update ใบเสร็จ path to `/payments?tab=receipts`

### Deleted
- `apps/web/src/pages/ReceiptsPage.tsx` — content moved to ReceiptsTab component

---

## Task 1: Extract ReceiptsPage body into ReceiptsTab component

**Files:**
- Create: `apps/web/src/pages/PaymentsPage/components/ReceiptsTab.tsx`

- [ ] **Step 1: Read existing ReceiptsPage**

Open `apps/web/src/pages/ReceiptsPage.tsx` and understand its structure. Identify:
- What PageHeader title/subtitle it uses (remove these in the tab version — parent page already has header)
- What filters, queries, state it has
- What components it renders

- [ ] **Step 2: Create ReceiptsTab as a self-contained component**

Create `apps/web/src/pages/PaymentsPage/components/ReceiptsTab.tsx`. Copy the body of ReceiptsPage — everything EXCEPT the outer `<PageHeader>` and `useDocumentTitle()`. Export as default function `ReceiptsTab()`.

Adjust imports to match the new path (relative paths may need adjustment — most imports use `@/` alias so should be unchanged).

- [ ] **Step 3: Type check**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE && ./tools/check-types.sh web
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/PaymentsPage/components/ReceiptsTab.tsx
git commit -m "refactor(payments): extract ReceiptsPage body into ReceiptsTab component"
```

---

## Task 2: Add receipts tab to PaymentsPage

**Files:**
- Modify: `apps/web/src/pages/PaymentsPage/index.tsx`

- [ ] **Step 1: Read current tabs structure**

Find where tabs are rendered. Locate:
- Tab state type `'pending' | 'summary' | 'slip-review'` — extend with `'receipts'`
- Tab buttons (usually an array or direct JSX)
- Conditional rendering blocks (e.g., `{tab === 'pending' && <PendingView />}`)

- [ ] **Step 2: Extend tab type + button + render**

Update the type alias:
```typescript
const tab = (searchParams.get('tab') || 'pending') as 'pending' | 'summary' | 'slip-review' | 'receipts';
const setTab = (value: 'pending' | 'summary' | 'slip-review' | 'receipts') => setSearchParams({ tab: value });
```

Import:
```typescript
import ReceiptsTab from './components/ReceiptsTab';
import { useAuth } from '@/contexts/AuthContext';
```

`useAuth` may already be imported — check.

Gate by role — receipts tab visible only for non-SALES:
```typescript
const canSeeReceipts = user && ['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT'].includes(user.role);
```

Add a 4th tab button in the tab nav (match existing style). Example:
```tsx
{canSeeReceipts && (
  <button
    onClick={() => setTab('receipts')}
    className={tabButtonCls(tab === 'receipts')}
  >
    ใบเสร็จ
  </button>
)}
```

Use the same `tabButtonCls` or inline classes as the existing tabs.

Add render block:
```tsx
{tab === 'receipts' && canSeeReceipts && <ReceiptsTab />}
```

Place it with the other conditional tab rendering blocks.

- [ ] **Step 3: Fallback if SALES tries to open `?tab=receipts`**

At top of component, after reading `tab`, add a guard:
```typescript
const effectiveTab = tab === 'receipts' && !canSeeReceipts ? 'pending' : tab;
```

Use `effectiveTab` wherever conditional rendering checks `tab`. (Or leave as-is — SALES will just see no content, tab button won't appear.) Simplest: since we hide the tab button for SALES AND the render block checks `canSeeReceipts`, SALES who manually add `?tab=receipts` will see blank. That's OK — add a redirect:
```typescript
useEffect(() => {
  if (tab === 'receipts' && !canSeeReceipts) setTab('pending');
}, [tab, canSeeReceipts]);
```

- [ ] **Step 4: Type check**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE && ./tools/check-types.sh web
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/PaymentsPage/index.tsx
git commit -m "feat(payments): add receipts tab (role-gated for non-SALES)"
```

---

## Task 3: Redirect /receipts → /payments?tab=receipts + remove page file

**Files:**
- Modify: `apps/web/src/App.tsx`
- Delete: `apps/web/src/pages/ReceiptsPage.tsx`

- [ ] **Step 1: Find ReceiptsPage route + usage**

In `App.tsx`, find:
- Lazy import: `const ReceiptsPage = lazy(() => import('@/pages/ReceiptsPage'));`
- Route: `<Route path="/receipts" element={...} />`

Check if ReceiptsPage is imported anywhere else:
```bash
grep -rn "ReceiptsPage" apps/web/src --include="*.tsx" --include="*.ts"
```

- [ ] **Step 2: Replace route with redirect**

Replace the existing `/receipts` route with:
```tsx
<Route path="/receipts" element={<Navigate to="/payments?tab=receipts" replace />} />
```

Ensure `Navigate` is imported from `react-router`:
```typescript
import { Routes, Route, Navigate } from 'react-router';
```
(It may already be imported — check).

Remove the `const ReceiptsPage = lazy(...)` line.

- [ ] **Step 3: Delete page file**

```bash
rm apps/web/src/pages/ReceiptsPage.tsx
```

If grep found ReceiptsPage imported elsewhere (e.g., in tests), also address those imports. If only App.tsx used it, safe to delete.

- [ ] **Step 4: Type check**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE && ./tools/check-types.sh web
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/App.tsx apps/web/src/pages/
git commit -m "feat(receipts): redirect /receipts to /payments?tab=receipts + delete page file"
```

---

## Task 4: Update menu + command palette

**Files:**
- Modify: `apps/web/src/config/menu.ts`
- Modify: `apps/web/src/components/CommandPalette.tsx`

- [ ] **Step 1: Remove `ใบเสร็จ` from sidebar menu**

In `menu.ts`, find all entries `{ label: 'ใบเสร็จ', path: '/receipts', icon: FileText }`. There are 3 (OWNER, FINANCE_MANAGER, ACCOUNTANT sections). Delete each line.

- [ ] **Step 2: Update command palette entry**

In `CommandPalette.tsx`, find:
```typescript
{ label: 'ใบเสร็จรับเงิน', path: '/receipts', icon: Receipt, keywords: 'receipt ใบเสร็จ', roles: [...] },
```

Change path to `/payments?tab=receipts`:
```typescript
{ label: 'ใบเสร็จรับเงิน', path: '/payments?tab=receipts', icon: Receipt, keywords: 'receipt ใบเสร็จ', roles: ['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT'] },
```

(Preserve existing roles array — just update path.)

- [ ] **Step 3: Type check**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE && ./tools/check-types.sh web
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/config/menu.ts apps/web/src/components/CommandPalette.tsx
git commit -m "chore(menu): remove 'ใบเสร็จ' sidebar entries + update command palette

Receipts now lives under /payments?tab=receipts. 3 sidebar entries
removed (OWNER, FINANCE_MANAGER, ACCOUNTANT sections)."
```

---

## Task 5: E2E smoke + push + PR

**Files:**
- Create: `apps/web/e2e/receipts-redirect.spec.ts` (tiny smoke)

- [ ] **Step 1: Smoke test**

Check existing `apps/web/e2e/` for any file mentioning `/receipts` — update URL OR just add new spec:

```typescript
import { test, expect } from '@playwright/test';
import { loginViaAPI } from './helpers/auth';

test.describe('Receipts redirect', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
  });

  test('/receipts redirects to /payments?tab=receipts', async ({ page }) => {
    await page.goto('/receipts');
    await page.waitForURL(/\/payments\?tab=receipts/, { timeout: 10000 });
    // Verify tab content loads
    await expect(page.getByText(/ใบเสร็จ|Receipt/i).first()).toBeVisible({ timeout: 10000 });
  });
});
```

- [ ] **Step 2: Commit + push + PR**

```bash
git add apps/web/e2e/receipts-redirect.spec.ts
git commit -m "test: smoke for /receipts redirect"
git push -u origin feat/merge-payments-receipts
gh pr create --base main --title "feat(payments): merge receipts into payments tab" --body "..."
```

---

## Self-Review

Spec coverage:
- Routing (2 URLs supported) ✓
- Permission gating (SALES hidden) ✓
- Menu cleanup (3 roles) ✓
- Command palette ✓
- Redirect ✓

No placeholders. Types consistent. Scope is 5 small tasks.
