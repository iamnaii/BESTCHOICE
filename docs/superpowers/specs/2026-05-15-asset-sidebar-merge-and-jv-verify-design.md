# Asset Module — PR 1 Design: Sidebar Merge + JV Verify

**Date:** 2026-05-15
**Author:** Owner (Claude assist)
**Scope:** PR 1 of 2 — Critical fixes from accountant's ImplementationReview v1.2 (P1 + P2)
**Effort:** ~5 hours (per accountant ETA: P1 = 2-4hr verify, P2 = 2-3hr implement)
**Next PR:** PR 2 — P3-P17 (15 important + minor items, ~10.5hr)

---

## 1. Context

Accountant reviewed PR #828 (Asset Bug Report v2 Resolution) on 2026-05-14 and produced 5 PDFs:

| Doc | Purpose |
|-----|---------|
| `Acknowledgment_v1.pdf` | Accept 6 false positives from Bug Report v2; ask 3 verifications + 1 sign-off |
| `FilesToSendDev_Summary_v1.pdf` | Cover letter for sending docs to Dev |
| `Handover_v3.pdf` (v3.7) | Master spec with §5.9 Resolution History + §5.10 SSOT Rule + §5.12 Implementation Review |
| `ImplementationReview_v1.2.pdf` | 17 action items (2 Critical / 11 Important / 4 Minor) across 6 Asset pages |
| `UAT_Checklist_v1.pdf` | 8 test cases (Owner 2 + Accounting 6) for sign-off |

PR 1 ships the 2 Critical fixes; PR 2 ships P3-P17.

**Sign-off Criteria (Acknowledgment §5):**

| # | Criteria | Status after PR 1 |
|---|----------|-------------------|
| 1 | Source code matches Master COA | ✅ PASS (verified pre-PR-1) |
| 2 | HTML companion fixed | ✅ PASS (PR #828) |
| 3 | Production DB verify (0 orphan) | ⏳ Owner runs `verify-asset-orphans.ts` (out of scope) |
| 4 | Test infrastructure (104 tests) | ⏳ Deferred — accountant accepted "separate PR" |
| 5 | UAT 8 cases | ⏳ Accounting team after PR 1 deploy |
| 6 | **JV page works (API 404 fixed)** | ✅ **PASS after PR 1 deploy + smoke test** |
| 7 | **Sidebar merge per Spec** | ✅ **PASS after PR 1 merge** |

PR 1 closes 2/5 pending criteria (#6, #7).

---

## 2. P1 — หน้า JV สินทรัพย์ (Verify Only, No Code Change)

### 2.1 Investigation finding

Per PDF §5 Action Required (4 steps), source code verified:

| Check | File | Result |
|-------|------|--------|
| Backend route exists | `apps/api/src/modules/asset/asset-journal.controller.ts:10` | ✅ `@Controller('assets/journal')` + `@Get()` |
| Frontend URL correct | `apps/web/src/pages/assets/api.ts:199` | ✅ `api.get('/assets/journal')` |
| Controller registered | `apps/api/src/modules/asset/asset.module.ts:17` + `apps/api/src/app.module.ts:239` | ✅ `AssetJournalController` ∈ `AssetModule` ∈ `AppModule` |
| Auth/Roles match | `asset-journal.controller.ts:11,16` | ✅ `JwtAuthGuard + RolesGuard` + 4 roles incl. ACCOUNTANT |

URL flow: frontend `/assets/journal` → axios `baseURL='/api/admin'` → `/api/admin/assets/journal` → `AdminPrefixMiddleware` strips `/admin` → `/api/assets/journal` → NestJS `setGlobalPrefix('api')` strips `/api` → controller `assets/journal` ✅

**Root cause:** Accountant saw 404 because their test ran before PR #828 finished deploying. Code is correct.

### 2.2 PR 1 actions (no code change)

1. Document the 4-step verification (this section)
2. After PR 1 merge → fresh deploy → manual smoke test:
   - Login as ACCOUNTANT (or OWNER) → navigate to `/assets/journal`
   - Expect: HTTP 200 + table renders (may be empty if no POSTED docs)
3. Screenshot 200 OK → attach to Sign-off Criteria #6

**Out of scope per PDF:** No 404-specific error message, no E2E test, no smoke job (PDF doesn't request them — strict "ทำตาม PDF 100%").

---

## 3. P2 — Sidebar Merge (per ImplementationReview v1.2 §1)

### 3.1 Current state

Across 3 role configs (`OWNER`, `FINANCE_MANAGER`, `ACCOUNTANT`) in `apps/web/src/config/menu.ts`, the 5 asset menu items sit flat under group `'บัญชี & รายงาน'`:

```ts
// menu.ts L244-248 (FINANCE_MANAGER), L296-300 (ACCOUNTANT), L386-390 (OWNER)
{ label: 'สินทรัพย์',         path: '/assets',                icon: Landmark },
{ label: 'ทะเบียนสินทรัพย์',   path: '/assets/register',       icon: BookOpen },
{ label: 'JV สินทรัพย์',       path: '/assets/journal',        icon: FileText },
{ label: 'รายงานสรุป',         path: '/assets/summary-report', icon: BarChart3 },
{ label: 'ค่าเสื่อม',          path: '/depreciation',          icon: TrendingDown },
```

### 3.2 Target state (per PDF p.3)

```
▾ 🏛 สินทรัพย์  [{draftCount}]            ← collapsible parent + DRAFT count badge
   ├─ 📝 บันทึกซื้อ                            → /assets
   ├─ 📒 ทะเบียน + มูลค่าตามบัญชีสุทธิ (NBV)   → /assets/register
   ├─ 📓 สมุดรายวัน                            → /assets/journal
   ├─ 📊 สรุปแยกหมวด                           → /assets/summary-report
   ├─ 📅 ค่าเสื่อม                              → /depreciation
   └─ 📋 Audit Log (เพิ่มใหม่)                  → /assets/audit   ← new route
```

Behavior:
- Parent is collapsible (click → expand/collapse children with chevron)
- Parent path: not navigable on its own (acts as group header only)
- Default state: collapsed if no child matches current route; auto-expanded if current route is one of the 6
- Badge `[{draftCount}]`: shows DRAFT document count from `GET /assets?status=DRAFT&limit=1` (uses `total` field); hidden when count = 0; refetched every 30s + on window focus

### 3.3 Files to change (7 files)

| # | File | Change |
|---|------|--------|
| 1 | `apps/web/src/config/menu.ts` | Extend `MenuItem` type with optional `children?: MenuItem[]` + `badgeKey?` field; refactor 3 role configs to nested structure |
| 2 | `apps/web/src/components/layout/Sidebar.tsx` | Render nested item: when `children` present → render expand/collapse + sub-items; otherwise → render as today |
| 3 | `apps/web/src/App.tsx` | Add `<Route path="/assets/audit" element={<AssetAuditPage />} />` before existing `/assets/:id/audit` (more specific first) |
| 4 | `apps/web/src/pages/assets/AssetAuditPage.tsx` | Make `id` from `useParams` optional; when missing → call new `getGlobalAudit()` API; UI: hide "back to asset" link + show "Asset ID / Name" column when global |
| 5 | `apps/web/src/pages/assets/api.ts` | Add `getGlobalAudit(filters)` → calls `GET /assets/audit` |
| 6 | `apps/api/src/modules/asset/asset.controller.ts` (or new dedicated controller) | Add `GET /assets/audit` → query AuditLog where `entity = 'fixed_asset'` (snake_case — matches Prisma model `FixedAsset` and existing audit write sites) + pagination 50/page + date/action filters |
| 7 | `apps/web/src/hooks/useDraftAssetCount.ts` (new) | React Query hook that calls `assetsApi.list({ status: 'DRAFT', limit: 1 })`, returns `total`; consumed by Sidebar.tsx |

### 3.4 MenuItem schema change

```ts
// apps/web/src/config/menu.ts
export type MenuBadgeKey = 'chat-unread' | 'asset-draft-count';  // existing 'chat-unread' + new

export interface MenuItem {
  label: string;
  path: string;          // for collapsible parent, used as click-to-expand only (no navigation)
  icon: LucideIcon;
  children?: MenuItem[]; // when present, item renders as collapsible group
  badgeKey?: MenuBadgeKey;
}
```

`BottomNavItem.badgeKey` already exists with type `'chat-unread'` — promote to shared `MenuBadgeKey` union.

### 3.5 Sidebar.tsx render logic

Pseudo:
```tsx
function renderMenuItem(item: MenuItem) {
  if (item.children) {
    return <CollapsibleItem item={item} />; // chevron + count badge + children list
  }
  return <Link to={item.path}>...</Link>;
}
```

Auto-expand rule: if any child's path matches current `location.pathname` (or is a prefix of it), open by default. Store user toggle in `localStorage` (`sidebar-expanded-keys`) so it persists across navigation.

### 3.6 AssetAuditPage global mode

Current ([AssetAuditPage.tsx:31](apps/web/src/pages/assets/AssetAuditPage.tsx#L31)):
```ts
const { id } = useParams<{ id: string }>();
const query = useQuery({
  queryKey: ['asset-audit', id],
  queryFn: () => assetsApi.getAudit(id!),
  enabled: !!id,
});
if (!id) return null;  // ← blocks global mode today
```

Target:
```ts
const { id } = useParams<{ id?: string }>();
const isGlobal = !id;
const query = useQuery({
  queryKey: isGlobal ? ['asset-audit-global'] : ['asset-audit', id],
  queryFn: () => isGlobal ? assetsApi.getGlobalAudit() : assetsApi.getAudit(id!),
});
// remove `if (!id) return null`
// header: show "Audit Log สินทรัพย์ทั้งหมด" when global, hide back-to-asset link
// table: add "Asset" column showing entityId + lookup name when global
```

### 3.7 Backend `GET /assets/audit` endpoint

```ts
// apps/api/src/modules/asset/asset.controller.ts (or new asset-audit.controller.ts)
@Get('audit')
@Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
listGlobalAudit(
  @Query('page') page?: string,
  @Query('limit') limit?: string,
  @Query('action') action?: string,
  @Query('fromDate') fromDate?: string,
  @Query('toDate') toDate?: string,
) {
  // prisma.auditLog.findMany where entity = 'fixed_asset' (matches per-asset API filter pattern,
  // which already filters by entity='fixed_asset' + entityId — global mode drops only entityId)
  // include asset name lookup via separate batched query (avoid N+1)
  // default limit 50, max 200
}
```

Reuse existing `AuditLog` model + indexes. No schema migration.

---

## 4. Testing

### 4.1 Unit tests

- `apps/api/src/modules/asset/__tests__/asset-audit-global.spec.ts` — new
  - Returns paginated audit logs filtered to `entity='fixed_asset'`
  - Pagination respects `page`, `limit` (default 50, cap 200)
  - Action filter works (e.g. `ASSET_POST`)
  - Date range filter works
  - JwtAuthGuard rejects unauthenticated
  - RolesGuard rejects SALES role

- `apps/web/src/pages/assets/__tests__/AssetAuditPage.global.test.tsx` — new
  - When route is `/assets/audit` (no `:id`) → calls `getGlobalAudit`
  - When route is `/assets/:id/audit` → calls `getAudit(id)` (existing behavior)
  - Global mode renders "Asset" column; per-asset mode hides it

### 4.2 Type check

```bash
./tools/check-types.sh all
```

### 4.3 Manual UAT (post-deploy, before sign-off)

For each of 3 roles (OWNER, FINANCE_MANAGER, ACCOUNTANT):

1. Login → expand "🏛 สินทรัพย์" parent → verify 6 children appear
2. Click each child → verify navigation:
   - บันทึกซื้อ → /assets (list page renders)
   - ทะเบียน → /assets/register
   - สมุดรายวัน → /assets/journal (200 OK, table renders — P1 verify)
   - สรุปแยกหมวด → /assets/summary-report
   - ค่าเสื่อม → /depreciation
   - Audit Log → /assets/audit (new page renders global feed)
3. Verify DRAFT badge shows correct count (create 1 DRAFT → badge shows "1")
4. Verify auto-expand: navigate to `/assets/register` directly → "สินทรัพย์" parent auto-opens

### 4.4 E2E (deferred to PR 2 or beyond — per "ทำตาม PDF 100%")

---

## 5. Out of Scope (Explicitly Deferred)

| Item | Reason | Tracked in |
|------|--------|-----------|
| P3-P17 (15 items: Stat Cards / Tab Bar / Vendor DB / Permission / NBV terminology / Sticky Footer / Group Cards / Filter row / Table header / Account names / Breadcrumb / VAT-WHT styling / PDF Export / Status Badge / Reverse button) | Bundle as single PR 2 per Option C scope decision | PR 2 (separate brainstorm) |
| 11-4102 Transfer Flow ("ใบกำกับมาถึงแล้ว" button) | Accountant marked as "Phase ถัดไป" (Acknowledgment §4.1) — not a blocker | Phase 2 backlog |
| Test infra fix (104 tests blocked) | Accountant accepted "แยก PR" (Acknowledgment §3.2) | Separate PR |
| Production DB orphan verification (`verify-asset-orphans.ts`) | Owner action — not Dev work (Acknowledgment §3.1) | Owner task |
| UAT 8 cases (UAT_Checklist_v1.pdf) | Post-PR-1 work for accounting team | After PR 1 deploys |

---

## 6. Rollout

1. **Branch:** `feat/asset-sidebar-merge` (from `main`)
2. **Commits (suggested):**
   - `feat(menu): add children + badgeKey to MenuItem schema`
   - `feat(sidebar): render collapsible nested menu items`
   - `feat(menu): refactor asset menu to collapsible parent (3 role configs)`
   - `feat(assets): add /assets/audit global route + AssetAuditPage global mode`
   - `feat(assets): GET /assets/audit backend endpoint + getGlobalAudit api`
   - `feat(sidebar): wire DRAFT count badge via useDraftAssetCount hook`
3. **PR title:** `fix(assets): sidebar merge to collapsible + global Audit Log (P1+P2 from accountant review)`
4. **Review:** Dispatch `code-reviewer` subagent before merge
5. **Post-merge:** Manual smoke test → 2 screenshots (JV 200 OK + new Sidebar with all 3 roles) → send to accountant → close Sign-off Criteria #6 + #7

---

## 7. References

- PDF 1: `Acknowledgment_v1.pdf` — esp. §5 Sign-off Criteria + §4.2 Test Infra
- PDF 4: `ImplementationReview_v1.2.pdf` — esp. §1 Sidebar (P2 spec) + §5 JV API 404 (P1 spec) + §8 Action Plan
- PDF 3: `Handover_v3.pdf` (v3.7) — esp. §5.10 SSOT Rule + §5.12 Implementation Review changes
- Existing code:
  - [apps/web/src/config/menu.ts:54-78](apps/web/src/config/menu.ts#L54-L78) — MenuItem types
  - [apps/web/src/config/menu.ts:244-300](apps/web/src/config/menu.ts#L244-L300) — current asset menu (3 role configs)
  - [apps/web/src/components/layout/Sidebar.tsx](apps/web/src/components/layout/Sidebar.tsx) — render logic (509 lines)
  - [apps/api/src/modules/asset/asset-journal.controller.ts](apps/api/src/modules/asset/asset-journal.controller.ts) — verified for P1
  - [apps/web/src/pages/assets/AssetAuditPage.tsx](apps/web/src/pages/assets/AssetAuditPage.tsx) — per-asset audit, target for global mode adaptation
