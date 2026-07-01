# Pre-Merge Guard Report

**Branch**: `feat/purchasing-v2-b4`
**Author**: iamnaii <akenarin.ak@gmail.com>
**Date**: 2026-07-01
**Reviewer**: Pre-Merge Guard (automated)

---

## File Changes Summary

| File | +/- | Type |
|------|-----|------|
| `apps/api/src/modules/purchase-orders/dto/create-po.dto.ts` | +14 / -1 | Backend — new `RejectQCDto` |
| `apps/api/src/modules/purchase-orders/purchase-orders.controller.ts` | +10 / -4 | Backend — new `POST qc-reject` + `GET qc-pending` params |
| `apps/api/src/modules/purchase-orders/purchase-orders.service.ts` | +5 / -1 | Backend — new `rejectQC` delegation |
| `apps/api/src/modules/purchase-orders/services/po-query.service.ts` | +16 / -6 | Backend — `getQCPending` additive filters |
| `apps/api/src/modules/purchase-orders/services/po-receiving.service.ts` | +40 / 0 | Backend — `rejectQC` implementation |
| `apps/api/src/modules/purchase-orders/purchase-orders.qc-pending.spec.ts` | +55 / 0 | Tests (new) |
| `apps/api/src/modules/purchase-orders/purchase-orders.qc-reject.spec.ts` | +58 / 0 | Tests (new) |
| `apps/web/src/App.tsx` | +9 / 0 | Frontend — `/purchase-orders/qc` route |
| `apps/web/src/components/CommandPalette.tsx` | +2 / -1 | Frontend — QC center palette entry |
| `apps/web/src/components/layout/Sidebar.tsx` | +9 / -4 | Frontend — `qc-pending-count` badge |
| `apps/web/src/components/ui/ConfirmDialog.tsx` | +4 / -1 | Frontend — `closeOnConfirm` + `children` props |
| `apps/web/src/hooks/useQcPendingCount.ts` | +25 / 0 | Frontend (new hook) |
| `apps/web/src/hooks/useQcPendingCount.test.ts` | (new) | Tests |
| `apps/web/src/pages/PurchaseOrdersPage/components/QcPendingPanel.tsx` | retired/refactored | Frontend |
| `apps/web/src/pages/QcCenterPage/index.tsx` | +290 / 0 | Frontend (new page) |
| `apps/web/src/pages/QcCenterPage/qcLabels.ts` | +34 / 0 | Frontend (new) |
| `apps/web/src/pages/QcCenterPage/qcLabels.test.ts` | +45 / 0 | Tests (new) |
| `apps/web/src/pages/QcCenterPage/useQcCenter.ts` | +85 / 0 | Frontend (new hook) |

**21 files changed, 752 insertions(+), 125 deletions(-)**

**Key changes:**
- New standalone `/purchase-orders/qc` route (QC Center page)
- New `POST /purchase-orders/qc-reject` endpoint (soft-delete products that failed QC)
- Extended `GET /purchase-orders/qc-pending` with `poId` + `includePhotoPending` additive filters
- `useQcPendingCount` sidebar badge hook (30s polling)
- CommandPalette entry for QC Center
- ConfirmDialog extended with `closeOnConfirm` + `children` slots

---

## Issues by Severity

### Critical (0)
None.

### Warning (2)

**W1 — `rejectQC` does not write an entity-level audit log**
- File: `apps/api/src/modules/purchase-orders/services/po-receiving.service.ts`
- The `rejectQC` method soft-deletes products (permanent inventory removal — products can never be recovered from `QC_PENDING` after soft-delete). The HTTP action is captured by the global `AuditInterceptor`, but that only records the endpoint call — not *which* product IDs were rejected and the reason supplied.
- Recommendation: write an explicit `AuditLog` entry (action: `QC_REJECTED`, entity: `product`, entityId: productIds.join(','), newValue: `{ reason, count }`) inside the `$transaction`, consistent with how other inventory-impacting operations are logged.
- Severity: Warning (not Critical because `AuditInterceptor` does capture the HTTP action; the missing piece is per-product granularity).

**W2 — `QcCenterPage` has a hard limit of 100 products with no pagination UI**
- File: `apps/web/src/pages/QcCenterPage/useQcCenter.ts` (line ~45: `limit: 100, page: 1`)
- The hook fetches at most 100 QC-pending items. If the queue grows beyond 100 (busy multi-branch scenario), items beyond page 1 are silently invisible.
- Recommendation: either add pagination controls or surface a "showing X of Y" indicator with a "load more" path when `total > data.length`.

### Info (2)

**I1 — `Number(raw?.total)` cast in `useQcCenter`**
- File: `apps/web/src/pages/QcCenterPage/useQcCenter.ts` (line ~58)
- `total` is a record count, not a financial value. `Number()` is acceptable here.

**I2 — `QcPendingPanel.tsx` retired (inline panel removed)**
- The old inline `QcPendingPanel` is superseded by the dedicated `/purchase-orders/qc` page. Confirm the panel component is fully deleted from the file tree (not just un-imported) to avoid dead code accumulation.

---

## Security Checklist

| Check | Result |
|-------|--------|
| `@UseGuards(JwtAuthGuard, RolesGuard)` on controller | ✅ (class-level, inherited by new endpoint) |
| `@Roles()` on new `POST qc-reject` | ✅ `OWNER`, `BRANCH_MANAGER` |
| `@Roles()` on modified `GET qc-pending` | ✅ pre-existing `OWNER`, `BRANCH_MANAGER` |
| DTO validation (`@IsArray`, `@ArrayNotEmpty`, `@IsNotEmpty`) | ✅ Thai messages on both fields |
| `deletedAt: null` in new `findMany` | ✅ (`rejectQC` + `getQCPending`) |
| No `$queryRaw` / SQL injection | ✅ |
| No hardcoded secrets | ✅ |
| Frontend: `api.get()` / `api.post()` only | ✅ |
| Frontend: `queryClient.invalidateQueries()` after mutations | ✅ (both confirm + reject) |
| `ProtectedRoute roles={['OWNER', 'BRANCH_MANAGER']}` on new route | ✅ |
| Design tokens only (no hardcoded hex / gray) | ✅ |

---

## Pattern Compliance

| Check | Result |
|-------|--------|
| Soft-delete used (`deletedAt = new Date()`) not hard-delete | ✅ |
| `$transaction` for multi-step DB operations | ✅ |
| `BadRequestException` for validation failures | ✅ |
| Thai error messages in service layer | ✅ |
| `useQuery` / `useMutation` (no raw `useEffect + fetch`) | ✅ |
| `toast.success()` / `toast.error()` from sonner | ✅ |
| `React.lazy()` for new page | ✅ (`QcCenterPage` lazy-loaded in App.tsx) |

---

## Recommendation: ⚠️ REVIEW

Two warnings. **W1 is the more important one** — `rejectQC` performs an irreversible inventory action (soft-delete) without a per-product audit trail beyond the HTTP interceptor log. Add an explicit AuditLog row inside the transaction before merging. W2 (pagination) is lower risk and can be deferred as a follow-up issue if the queue size stays small in practice.
