# Merge Guard Report — `feat/purchasing-v2-b4`

**Date**: 2026-07-01  
**Author**: iamnaii <akenarin.ak@gmail.com>  
**Last commit**: 2026-06-29  
**Recommendation**: ✅ APPROVE

---

## File Changes Summary

| File | Change |
|------|--------|
| `apps/api` — DTO, controller, service (3 files) | Backend: new `RejectQCDto` + `POST /qc-reject` endpoint + `rejectQC` service |
| `apps/api` — 2 new spec files | 3+3+6 test cases covering `rejectQC` + `getQCPending` filters |
| `apps/web/src/App.tsx` | New `/purchase-orders/qc` lazy route with `ProtectedRoute` |
| `apps/web/src/components/CommandPalette.tsx` | New "ศูนย์ตรวจ QC" entry for OWNER/BM |
| `apps/web/src/components/layout/Sidebar.tsx` | `qc-pending-count` nav badge wired via `useQcPendingCount` |
| `apps/web/src/components/ui/ConfirmDialog.tsx` | `closeOnConfirm` prop + `children` slot |
| `apps/web/src/config/menu.ts` | `qc-pending-count` badge key + QC Center menu item (OWNER + BM) |
| `apps/web/src/hooks/useQcPendingCount.ts` + `.test.ts` | Sidebar count hook |
| `apps/web/src/pages/QcCenterPage/` (4 files) | Full QC Center page + hook + labels + tests |
| `apps/web/src/pages/PurchaseOrdersPage/components/QcPendingPanel.tsx` | Deleted (superseded) |
| `apps/web/src/pages/PurchaseOrdersPage/hooks/usePurchaseOrdersData.ts` | Removes inline QC state now that QcCenterPage owns it |

**Total**: 21 files changed, 752 insertions, 125 deletions

---

## What This Branch Does

Promotes QC workflow from an inline collapsible panel inside PurchaseOrdersPage to a dedicated `/purchase-orders/qc` route with full list, bulk confirm/reject, branch filter, and sidebar badge. Adds the backend `POST /qc-reject` endpoint (soft-delete failed units).

### Backend additions
- `RejectQCDto` — `@IsArray()`, `@ArrayNotEmpty()`, `@IsString({ each: true })`, `@IsNotEmpty()` with Thai messages ✓
- `POST /qc-reject` on the existing controller (class-level `@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)` confirmed, method-level `@Roles('OWNER', 'BRANCH_MANAGER')`) ✓
- `rejectQC` service: validates non-empty, `findMany` with `deletedAt: null` guard, status must be `QC_PENDING | PHOTO_PENDING`, then `updateMany` soft-delete inside `$transaction` ✓

### Frontend additions
- `QcCenterPage`: `useQuery` + `useMutation` from react-query, `api.get/post` from `@/lib/api`, `queryClient.invalidateQueries()` on confirm and reject ✓
- `ConfirmDialog` extended with `children` slot and `closeOnConfirm` prop (used for multi-step reject flow) — backward-compatible default `closeOnConfirm=true` ✓
- `useQcPendingCount`: polls `GET /purchase-orders/qc-pending` with `limit=1` for cheap sidebar count, 30s interval ✓

---

## Issues Found

### Critical
None.

### Warning

**W1 — Native `<input>` and `<select>` in QcCenterPage instead of shadcn Input/Select** (`QcCenterPage/index.tsx`)

```tsx
<input type="text" ... className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-input bg-background ..." />
<select ... className="px-3 py-2 text-sm rounded-lg border border-input bg-background ...">
```

Pattern diverges from the frontend rule of using shadcn/ui Input and Select components. Design tokens used correctly (no hardcoded hex/gray) so visual parity is maintained. Low risk but creates inconsistency in the component layer.

### Info

**I1 — `QcCenterPage/index.tsx` is 290 lines** — approaching the "consider splitting" threshold. The sticky bulk-action bar and ConfirmDialog could be extracted into sub-components if the file grows further.

**I2 — `useQcCenter` fetches `limit=100` items** — sufficient for now, but QC queue could grow beyond 100 at busy branches. Server pagination exists; a load-more pattern would future-proof this. Not a correctness issue.

---

## Security Checklist

| Check | Result |
|-------|--------|
| `@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)` on controller class | ✅ Confirmed |
| `@Roles('OWNER', 'BRANCH_MANAGER')` on new endpoint | ✅ Present |
| DTO validation decorators with Thai messages | ✅ Present |
| Soft delete (not hard delete) in `rejectQC` | ✅ `deletedAt: new Date()` |
| `deletedAt: null` guard in `findMany` before update | ✅ Present |
| `$transaction` wrapping the reject operation | ✅ Present |
| Frontend uses `api.get/post` (not raw fetch) | ✅ Correct |
| `queryClient.invalidateQueries()` after mutations | ✅ All 3 queries invalidated |
| No hardcoded secrets or API keys | ✅ None found |
| No `$queryRaw` usage | ✅ None found |

---

## Verdict: APPROVE

No critical issues. One warning (native HTML inputs instead of shadcn) is a style concern, not a functional or security problem. The backend endpoint is properly guarded and the soft-delete logic is sound. Safe to merge.
