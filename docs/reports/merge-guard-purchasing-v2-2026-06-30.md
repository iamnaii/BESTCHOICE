# Pre-Merge Guard Report — feat/purchasing-v2 (B3/B4/B5) + fix/inbox-eslint

**Date**: 2026-06-30  
**Reviewed branches**: `fix/inbox-eslint-no-unused-expressions`, `feat/purchasing-v2-b4`, `feat/purchasing-v2-b5`  
**Author**: iamnaii <akenarin.ak@gmail.com>  
**Status**: Content already cherry-picked to `origin/main` — this is a post-merge audit

---

## Status Note: Branches vs Main

All three reviewed branches were applied to `main` via direct cherry-picks (different commit SHAs), not via branch merge. The branch pointers are stale orphans. The guard audit covers the code **as it now lives on main**.

| Branch | Main commits |
|--------|-------------|
| `fix/inbox-eslint-no-unused-expressions` | `8214bb0f` |
| `feat/purchasing-v2-b4` | `301855af`, `7e922109`, `be08b0d9`, `96ee17e0`, `582d73d2` |
| `feat/purchasing-v2-b5` | `0fee4ffe`, `b28e3e8b`, `10efd433`, `1c3091ec`, `d61fab4f` |

---

## Summary of Changes

### fix/inbox-eslint-no-unused-expressions (3 files, +6/-3)
- `QcCenterPage/index.tsx` — replace ternary-as-statement `a ? b : c` → `if/else` (ESLint `no-unused-expressions`)
- `UnifiedInboxPage/components/MessageBubble.tsx` — same fix
- `UnifiedInboxPage/hooks/useNotificationPrefs.ts` — same fix

### feat/purchasing-v2-b4 (21 files, +752/-125)
- **API**: New `POST /purchase-orders/qc-reject` — soft-delete QC-failed units; DTO `RejectQCDto` with Thai validation; widen `GET /qc-pending` to accept `poId` + `includePhotoPending` flags
- **Web**: New `QcCenterPage` (`/purchase-orders/qc`) — bulk confirm/reject queue with branch filter, search, sticky action bar; `useQcCenter` + `useQcPendingCount` hooks; nav badge on sidebar; command palette entry; `ProtectedRoute(OWNER, BRANCH_MANAGER)`
- **Cleanup**: Retire inline `QcPendingPanel` (moved to dedicated page)
- **Tests**: `purchase-orders.qc-pending.spec.ts`, `purchase-orders.qc-reject.spec.ts`, `useQcPendingCount.test.ts`, `qcLabels.test.ts`

### feat/purchasing-v2-b5 (7 files, +357/-15)
- **Web**: `PurchasingSummaryStrip` — 7 KPI cards (draft/approved/ordered/overdue/partial/qc/unpaid) wired to tab+filter navigation; `overdueOnly` filter state in `usePurchaseOrdersData`; AP tab progress bar + due-soon hint; `summaryStrip.test.ts` (verifies token-only classes, key coverage, filter routing)

---

## Security Review

### Critical — PASS ✅

| Check | B4 | B5 | Fix |
|-------|----|----|-----|
| New controllers: `@UseGuards(JwtAuthGuard, RolesGuard)` at class level | N/A (adds to existing controller that already has `@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)` at class level) | N/A (frontend only) | N/A |
| New endpoints have `@Roles(...)` | `POST /qc-reject` → `@Roles('OWNER', 'BRANCH_MANAGER')` ✅ | — | — |
| `Number()` on financial fields in backend | None ✅ | None (frontend display only, pre-existing pattern) ✅ | None ✅ |
| `deletedAt: null` in new queries | `getQCPending` where-clause includes `deletedAt: null` ✅; `rejectQC` `findMany` includes `deletedAt: null` ✅ | — | — |
| Hardcoded secrets | None found ✅ | None found ✅ | None found ✅ |
| SQL injection (`$queryRaw`) | None ✅ | None ✅ | None ✅ |

---

## Quality Review

### Warnings ⚠️

**W1 — `rejectQC` does not persist rejection `reason` to audit storage**  
`apps/api/src/modules/purchase-orders/services/po-receiving.service.ts` — `rejectQC()` soft-deletes products and returns the `reason` in the response body, but the reason is not written to an `AuditLog` row or stored on the `Product` record. If an operator rejects 5 units with reason "IMEI ถูกบล็อก", that reason is only visible in the API response and is lost after the session closes. The `AuditInterceptor` will log the HTTP verb/path/userId but not the freetext `reason`.

By contrast: `confirmQC` also has no explicit audit row, so this is internally consistent — but both are missing a persistent rejection trail. Recommend adding `auditLog.create({ action: 'QC_REJECTED', entity: 'product', entityId: productId, newValue: { reason } })` inside the transaction, or at minimum store `reason` on the product's `defectNotes`/notes field before soft-deleting.

**W2 — `useQcCenter` uses `Number()` on `raw?.total` (integer count field)**  
`apps/web/src/pages/QcCenterPage/useQcCenter.ts:49` — `Number(raw?.total)` is used to coerce a count field. This is safe since `total` is a plain integer (not a Decimal money value), but it's inconsistent with the rule discouraging `Number()` on fields coming from the API. Prefer `raw?.total ?? 0` or explicitly type the response as `{ data: QcPendingProduct[]; total: number }`.

### Info ℹ️

**I1 — `QcCenterPage` fetches `limit: 100` hard-coded**  
`apps/web/src/pages/QcCenterPage/useQcCenter.ts:42` — The QC center fetches up to 100 items. Branches with large QC queues (100+ units) will silently truncate. A pagination or load-more UI is not implemented. For current shop scale this is acceptable; flag for future if queue can exceed 100.

**I2 — Summary strip hits `/purchase-orders/summary` on every page mount**  
`usePurchaseOrdersData.ts` — The `staleTime: 30_000` means the summary re-fetches every 30 s. This is fine and intentional (the comment says "snappy counts are compute-on-read and cheap"). No action needed.

**I3 — `overdueOnly` filter persists in usePurchaseOrdersData state but clears on tab switch**  
`setStatusFilterAndResetOverdue` is called when the status dropdown changes, correctly clearing `overdueOnly`. But navigating to the `payable` tab and back does NOT clear `overdueOnly`. The overdue filter chip re-appears after returning to the list tab, which is correct UX (filter is preserved). This is intentional behaviour confirmed by the FilterChip rendering.

---

## Frontend Pattern Compliance

| Pattern | B4 | B5 |
|---------|----|----|
| `useQuery`/`useMutation` (no raw fetch/useEffect) | ✅ | ✅ |
| `api.get()`/`api.post()` from `@/lib/api` | ✅ | ✅ |
| `queryClient.invalidateQueries()` after mutations | ✅ (3 mutations + invalidate) | ✅ (8 mutations all invalidate `purchase-orders-summary`) |
| Design tokens only (no hex, no `bg-gray-*`, no `bg-white`) | ✅ (verified by `TONE_STYLES` test) | ✅ |
| `toast.success()`/`toast.error()` from sonner | ✅ | ✅ |
| `ProtectedRoute` wrapper | ✅ (`OWNER, BRANCH_MANAGER`) | — |
| `QueryBoundary` present | ✅ | — (strip renders `null` when undefined, no error state needed) |
| `React.lazy()` for page | ✅ (`App.tsx` lazy import) | — (already in App.tsx) |
| Thai UI labels | ✅ | ✅ |

---

## Recommendation

| Branch | Verdict | Rationale |
|--------|---------|-----------|
| `fix/inbox-eslint-no-unused-expressions` | **APPROVE** | Trivial syntactic fix; no logic change; unblocks CI |
| `feat/purchasing-v2-b4` | **APPROVE** (with W1 noted) | Security clean; guards correct; tests present; W1 (no audit reason persistence) is a minor gap, not a blocker |
| `feat/purchasing-v2-b5` | **APPROVE** | Frontend-only; pattern-clean; test covers token rules |

**Note**: All content is already on `main`. No merge action needed. W1 (rejection reason audit trail) is the only item worth a follow-up ticket before high-volume QC use.

---

## Action Items

- [ ] **W1 (follow-up)**: Write `AuditLog` entry inside `rejectQC` transaction to persist the rejection reason per product. Consider adding a `defectNotes` field on the `Product` model to make the reason queryable after soft-delete.
- [ ] Clean up stale branch pointers: `feat/purchasing-v2-b1..b5`, `fix/inbox-eslint-no-unused-expressions` can be deleted from remote.
