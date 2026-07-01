# Merge Guard Report — feat/purchasing-v2-b3, b4, b5

**Date**: 2026-07-01  
**Reviewer**: Pre-Merge Guard (automated)  
**Author**: iamnaii <akenarin.ak@gmail.com>  
**Base branch**: `origin/main`  
**Branches reviewed**: `feat/purchasing-v2-b3` → `feat/purchasing-v2-b4` → `feat/purchasing-v2-b5` (stacked)

---

## Summary

| Branch | Files | +/- | Recommendation |
|--------|-------|-----|----------------|
| feat/purchasing-v2-b3 | 15 | +1834 / -566 | **REVIEW** |
| feat/purchasing-v2-b4 | 21 | +752 / -125 | **APPROVE** |
| feat/purchasing-v2-b5 | 7 | +357 / -15 | **APPROVE** |

---

## Branch: feat/purchasing-v2-b3 — Supplier Direct Receive (auto-PO)

### What it does
Adds `POST /purchase-orders/direct-receive` — creates an auto-PO at ORDERED status (bypassing the OWNER approval gate, with an audit log entry for the bypass), then immediately runs the same goods-receiving pipeline. Designed for walk-in supplier deliveries without a prior PO.

Also adds frontend: `DirectReceiveModal`, mobile-first `GoodsReceivingModal` with camera/IMEI-dup feedback/DefectReason select.

### Security Check
- **Guard**: `@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)` at class level ✓
- **Roles**: `@Roles('OWNER', 'BRANCH_MANAGER')` on `directReceive` ✓
- **No secrets, no `$queryRaw`** ✓
- **Approval-bypass explicitly audited** via `tx.auditLog.create` inside the transaction ✓

### Issues Found

#### ⚠️ WARNING — `Number()` arithmetic on Decimal money fields (b3, po-receiving.service.ts ~line 313)

```ts
// po-receiving.service.ts — directReceive()
const totalAmount = dto.items.reduce((s, i) => s + Number(i.unitPrice) * i.quantity, 0);
// stored into:
//   PurchaseOrder.totalAmount  Decimal  @db.Decimal(12, 2)
//   PurchaseOrder.netAmount    Decimal  @db.Decimal(12, 2)
```

`totalAmount` is computed with JavaScript floating-point arithmetic (`Number()`) and then assigned to a `Decimal @db.Decimal(12, 2)` field. Prisma truncates to 2 decimal places at storage, which masks most FP errors, but this is non-compliant with the project rule ("use `Prisma.Decimal`, never `Number()` or `Float` for money"). The v4 hardening sprint converted 53 similar occurrences across 12 services.

**Fix** (3 lines):
```ts
import { Prisma } from '@prisma/client';  // already imported

const totalAmount = dto.items.reduce(
  (s, i) => s.add(new Prisma.Decimal(i.unitPrice).mul(i.quantity)),
  new Prisma.Decimal(0),
);
```

**Note**: The pre-existing `costPrice: Number(poItem.unitPrice)` at line 179 of `runReceiveInTx` is a carry-over from the merge-base (not introduced by b3). Flag for a separate cleanup.

#### ℹ️ INFO — Missing `invalidateQueries(['purchase-orders-summary'])` on direct-receive mutation

The direct-receive mutation in `usePurchaseOrdersData.ts` invalidates `['purchase-orders']` but **not** `['purchase-orders-summary']` (the key added in b5 for the summary strip). After b5 merges, a direct-receive won't refresh the summary strip counts until the stale timer expires (30s).

File: `apps/web/src/pages/PurchaseOrdersPage/hooks/usePurchaseOrdersData.ts` — the `directReceiveMutation.onSuccess`

**Fix** (b5 already adds `queryClient.invalidateQueries({ queryKey: ['purchase-orders-summary'] })` to every _other_ mutation; b3's direct-receive mutation needs the same):
```ts
onSuccess: (res) => {
  queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
+ queryClient.invalidateQueries({ queryKey: ['purchase-orders-summary'] });
  ...
```

---

## Branch: feat/purchasing-v2-b4 — QC Center Page + QC Reject Endpoint

### What it does
Adds:
- `POST /purchase-orders/qc-reject` — soft-deletes products that failed post-receive QC (QC_PENDING / PHOTO_PENDING → `deletedAt`), with validation that all productIds are in a QC stage.
- `GET /purchase-orders/qc-pending` — extended with `?poId=` and `?includePhotoPending=true` filters.
- `QcCenterPage` (`/purchase-orders/qc`) — mobile-friendly QC queue with confirm/reject dialogs.

### Security Check
- **Guard**: Class-level JwtAuthGuard + RolesGuard + BranchGuard ✓
- **`@Roles('OWNER', 'BRANCH_MANAGER')`** on both new endpoints ✓
- **`deletedAt: null` filter** present on product query inside rejectQC ✓
- **No raw `fetch()`** in frontend — uses `api.get()` / `api.post()` ✓
- **`queryClient.invalidateQueries()`** called on both confirm and reject mutations ✓

### Issues Found

No critical or warning issues. 

#### ℹ️ INFO — `rejectQC` no inline AuditLog (acceptable — global interceptor covers it)

`rejectQC` does not call `tx.auditLog.create` inside the transaction, unlike `directReceive` which explicitly audits the approval-bypass. This is consistent with how `confirmQC` behaves (also no inline audit). The global `AuditInterceptor` logs the `POST /purchase-orders/qc-reject` call (method, URL, body, userId, response) at the HTTP level, which is sufficient for QC state transitions.

---

## Branch: feat/purchasing-v2-b5 — Summary Strip + AP Tab Polish

### What it does
Frontend-only. Adds:
- `PurchasingSummaryStrip` — 7 clickable KPI cards (DashboardKPIs pattern) wired to tab/filter actions.
- `summaryStrip.ts` — pure config + type definitions, tested with 5 Vitest specs including design-token compliance check.
- `overdueOnly` filter state on PO list.
- AP tab polish: paid-progress bar, due-soon 7-day hint, row deep-link.

### Security Check
- Frontend-only — no new API endpoints ✓
- All API calls use `api.get()` via React Query ✓
- No hardcoded hex/gray/white (verified by `summaryStrip.test.ts` assertion) ✓

### Issues Found

#### ℹ️ INFO — `usePurchaseOrdersData.ts` exceeds 500-line threshold

File is now 618 lines. Consider extracting `usePayableData` and `useSummaryData` into sibling hooks to keep the orchestrator hook readable. Not a blocker.

#### ℹ️ INFO — Inline `api.get()` in `AccountsPayableTab` row `onClick`

```tsx
// AccountsPayableTab.tsx
<tr onClick={async () => { try { const { data } = await api.get(`/purchase-orders/${po.id}`); onOpenDetail(data, data); } catch {} }}>
```

Using `api.get()` (not raw `fetch()`) so it's compliant, but an ad-hoc `try {} catch {}` with a swallowed error is a no-toast failure path. If the request fails the user sees nothing. Existing pattern in the pre-b5 code (`<button onClick={async () => { try {...} catch {} }>`), so b5 merely preserves and refactors it. Not a new regression.

---

## Merge Order & Decision

These are stacked branches; merge in order:

1. **b3** → Fix the `Number()` → `Prisma.Decimal` issue in `directReceive` before merging. Add the missing `summary` cache invalidation. **REVIEW**
2. **b4** → Clean. Merge after b3. **APPROVE**
3. **b5** → Clean. Merge after b4. **APPROVE**

### What to fix in b3 before merge

| File | Line | Change |
|------|------|--------|
| `apps/api/src/modules/purchase-orders/services/po-receiving.service.ts` | ~313 | Replace `Number()` reduce with `Prisma.Decimal` accumulation |
| `apps/web/src/pages/PurchaseOrdersPage/hooks/usePurchaseOrdersData.ts` | directReceiveMutation.onSuccess | Add `queryClient.invalidateQueries({ queryKey: ['purchase-orders-summary'] })` |
