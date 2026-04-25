# Merge Guard Report — Collections Feature Branches
**Date**: 2026-04-25  
**Reviewer**: Pre-Merge Guard (automated)  
**Branches reviewed**: 3 (top by last-commit date, all from today)

---

## Branch Overview

| Branch | Last Commit | Files | +LOC | Recommendation |
|--------|-------------|-------|------|----------------|
| `feat/collections-ui-p0` | 2026-04-25 03:08 | 128 | +21,662 | **BLOCK** |
| `feat/collections-backlog` | 2026-04-25 01:57 | 109 | +18,063 | **BLOCK** |
| `feat/collections-workflow-hub` | 2026-04-25 01:49 | 58 | +8,964 | **REVIEW** |

**Author (all branches)**: Akenarin Kongdach  
**Context**: These branches are part of the same Collections feature stack.
- `feat/collections-ui-p0` ⊃ `feat/collections-backlog` ⊃ `feat/collections-workflow-hub` (linear ancestry)
- `feat/collections-ui-p0` is the most complete; merging it subsumes the other two.

---

## Branch 1: `feat/collections-ui-p0`

### Summary of Changes
- New **CollectionsPage** with 5 tabs: Queue, FollowUp, Promise, Approval, Analytics
- New backend services: `queue.service.ts`, `kpi.service.ts`, `mdm-lock.service.ts`, `analytics.service.ts`, `contract-letter.service.ts`, `bulk.service.ts`
- New `search.controller.ts` (global search endpoint)
- Extended `shop-upload.controller.ts` (adds LETTER_* and MDM_WALLPAPER upload kinds)
- Extended `overdue.controller.ts` (6 new endpoints for MDM lock/unlock/approve/reject, bulk actions)
- SSRF-defended `update-letter-evidence.dto.ts` (allowlist-based URL validator)
- 75+ new test files (unit + spec)

### Critical Issues

#### C1 — `ShopUploadController` missing `RolesGuard` + `@Roles()` decorator
**File**: `apps/api/src/modules/storage/shop-upload.controller.ts:28`  
**Severity**: CRITICAL

```typescript
// CURRENT (broken)
@Controller('shop/upload')
@UseGuards(JwtAuthGuard)           // ← RolesGuard missing
export class ShopUploadController {
  @Post('signed-url')
  async presign(@Body() dto: PresignedUploadDto) { ... }
  // ↑ no @Roles() — any authenticated user can call this
```

**Issue**: This branch extends `UploadKind` to include `LETTER_SIGNATURE`, `LETTER_LETTERHEAD`, and `MDM_WALLPAPER` (sensitive assets) without fixing the pre-existing missing `RolesGuard`. Any authenticated user (including SALES, ACCOUNTANT) can now obtain presigned S3 upload URLs to overwrite letter headers, signatures, and MDM lock screen wallpapers.

**Fix**:
```typescript
@Controller('shop/upload')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ShopUploadController {
  @Post('signed-url')
  @Roles('OWNER', 'FINANCE_MANAGER', 'BRANCH_MANAGER')
  async presign(@Body() dto: PresignedUploadDto) { ... }
```

> Note: The missing `RolesGuard` also exists in `main` (4 UploadKind values). Fixing it here addresses both the pre-existing issue and the new sensitivity introduced by this branch.

---

#### C2 — `window.prompt()` / `window.confirm()` in new component
**File**: `apps/web/src/pages/CollectionsPage/components/Customer360Actions.tsx`  
**Severity**: CRITICAL (regression against v4 hardening)

```typescript
// CURRENT (broken)
const reason = window.prompt('ระบุเหตุผลการเสนอล็อคเครื่อง (≥ 5 ตัวอักษร):');
const proceed = window.confirm('ยืนยันการดำเนินการ?');
```

**Issue**: v4 hardening (PR #444) explicitly replaced `confirm()` with `ConfirmDialog`. Reintroducing `window.prompt()` / `window.confirm()`:
- Breaks accessibility (WCAG: must be dismissible, keyboard-navigable, screen-reader-friendly)
- Blocks Playwright E2E tests (native dialogs require special handling)
- Inconsistent UX: all other critical actions use modal dialogs

**Fix**: Replace with `ConfirmDialog` for confirmation, and a modal with a `<Input>` field for MDM lock reason input. See `/contracts` page for the pattern with reason inputs in modal dialogs.

---

### Warning Issues

#### W1 — `.toNumber()` on financial aggregates for API response serialization
**File**: `apps/api/src/modules/overdue/kpi.service.ts`  
**Severity**: WARNING

```typescript
return {
  totalOutstanding: amountDue.sub(amountPaid).toNumber(),  // ← Decimal → float
  totalLateFees: lateFees.toNumber(),                       // ← Decimal → float
  ...
};
```

`Prisma.Decimal.toNumber()` converts to JS float — safe for display values (≤ ~9 quadrillion ฿) but if the frontend ever feeds these back into further calculations, precision will be silently lost. Prefer `.toString()` in API response shapes when the value is transmitted to another system.

---

#### W2 — Hardcoded hex colors in `AnalyticsTab.tsx` (recharts)
**File**: `apps/web/src/pages/CollectionsPage/tabs/AnalyticsTab.tsx`  
**Severity**: WARNING

```typescript
const CHART_COLORS = {
  success: '#10b981',     // ← should be CSS var
  destructive: '#ef4444', // ← should be CSS var
  warning: '#f59e0b',
  muted: '#a1a1aa',
};
const AXIS_STYLE = { stroke: '#a1a1aa', fontSize: 11 };  // ← hardcoded
const GRID_PROPS = { strokeDasharray: '3 3', stroke: '#e4e4e7' };
```

**Design token rule violation** (`rules/frontend.md`). Charts won't adapt to theme changes. Fix:
```typescript
const root = document.documentElement;
const primary = getComputedStyle(root).getPropertyValue('--primary').trim();
```
Or define a `useChartColors()` hook that reads CSS variables once.

---

#### W3 — `as any` type assertions in production services
**Files**: `queue.service.ts`, `kpi.service.ts`, `mdm-lock.service.ts`  
**Severity**: WARNING

```typescript
private cache = new Map<string, { value: any; expiresAt: number }>();  // kpi.service
channel: rule.channel as any,     // queue.service — Prisma enum mismatch
status: status as any,            // queue.service + mdm-lock.service
letterType: letterType as any,    // queue.service
private toRow(c: any, now: Date)  // queue.service
```

Most are Prisma `groupBy` result typing workarounds. Should define explicit result types:
```typescript
type GroupByResult = { assignedToId: string | null; _count: { _all: number } };
const workloadBuckets = await this.prisma.contract.groupBy(...) as GroupByResult[];
```

---

### Info

#### I1 — `queue.service.ts` is 577 lines
**File**: `apps/api/src/modules/overdue/queue.service.ts`  
Exceeds 500-line guideline. Consider splitting into `queue-filter.service.ts` (filter/scoring logic) and `queue-enrichment.service.ts` (aggregation enrichment). Not blocking but worth tracking.

#### I2 — `fetch()` to S3 presigned URLs (accepted exception)
**Files**: `LetterDispatchDialog.tsx`, `CollectionsPage/components/BulkSlipUploadDialog.tsx`  
Two direct `fetch(presignedUrl, { method: 'PUT', body: file })` calls. This is the correct pattern for S3 binary uploads (can't proxy binary through the API). Acceptable exception to the `api.get()/api.post()` rule.

---

### Positive Findings
- All 6 new `overdue.controller.ts` endpoints have `@Roles()` decorators ✓
- New `search.controller.ts` has `@UseGuards(JwtAuthGuard, RolesGuard)` at class level ✓
- All `$queryRaw` calls use Prisma's tagged template literals (safe parameterization) ✓
- SSRF allowlist on `update-letter-evidence.dto.ts` is well-implemented ✓
- New DTOs have Thai-language validation messages ✓
- `deletedAt: null` filters present in all new queries ✓
- No hardcoded secrets or API keys found ✓
- 75+ new test files with good coverage ✓

---

## Branch 2: `feat/collections-backlog`

**Relationship**: ancestor of `feat/collections-ui-p0` (5 commits behind). No unique code vs `feat/collections-ui-p0`.

**Recommendation: BLOCK** — same C1 (ShopUploadController extends sensitive UploadKinds without fixing guards) and C2 (window.prompt introduced in commits not yet in this branch — actually C2 is NOT present here, see below).

> Check: `Customer360Actions.tsx` does **not** exist in this branch. The branch contains analytics tab, bulk letter actions, and SSRF fix for evidence URL. No `window.prompt` in this branch.

**Revised recommendation**: **REVIEW** — C1 (shop-upload RolesGuard) still applies if this branch is merged independently, but C2 does not. No blocking issues unique to this branch beyond the pre-existing main issue.

**Key positive in this branch**: SSRF host allowlist (`IsPublicHttpsUrlConstraint`) on `UpdateLetterEvidenceDto` — strong security implementation.

---

## Branch 3: `feat/collections-workflow-hub`

### Summary of Changes (unique vs main)
- New collections page foundation: QueueTab, FollowUpTab, PromiseTab, ApprovalTab
- New backend: `overdue.controller.ts` extensions (6 endpoints), `kpi.service.ts`, `mdm-lock.service.ts`
- C1 search scoping + C3 batch loading fixes for previous review

### Issues Found

#### No Critical Issues
All 6 new overdue controller endpoints have `@Roles()` decorators. `shop-upload.controller.ts` is not modified in this branch (uses the 4-UploadKind version from main — same pre-existing guard issue as main but not worsened here).

#### Warning — `as any` in production code
Same as ui-p0 W3 above: `channel: rule.channel as any`, `status: status as any`, `private toRow(c: any, ...)`.

**Recommendation: REVIEW** — No new critical issues introduced. Type-safety warnings should be addressed before merge but are not blocking.

---

## Summary Table

| Issue | Branch(es) | Severity | Status |
|-------|-----------|----------|--------|
| `ShopUploadController` missing `RolesGuard` + `@Roles` | ui-p0 (worsens pre-existing main bug) | **CRITICAL** | Open |
| `window.prompt()` / `window.confirm()` in Customer360Actions | ui-p0 only | **CRITICAL** | Open |
| `.toNumber()` on financial fields for API response | ui-p0, backlog | Warning | Open |
| Hardcoded hex colors in AnalyticsTab | ui-p0, backlog | Warning | Open |
| `as any` type assertions in production services | ui-p0, backlog, workflow-hub | Warning | Open |
| `queue.service.ts` > 500 lines | ui-p0, backlog | Info | Open |
| `fetch()` to S3 presigned URL | ui-p0, backlog | Info | Accepted exception |

---

## Action Items

**Before merging `feat/collections-ui-p0`**:
1. Fix `ShopUploadController`: add `RolesGuard` + `@Roles('OWNER', 'FINANCE_MANAGER', 'BRANCH_MANAGER')` — also consider fixing in `main` directly as a security patch
2. Replace `window.prompt()` / `window.confirm()` in `Customer360Actions.tsx` with modal + `ConfirmDialog`
3. (Warning) Replace hardcoded chart hex colors with CSS variable reads
4. (Warning) Define explicit Prisma groupBy result types to eliminate `as any`

**Before merging `feat/collections-workflow-hub`** (if merging independently):
1. (Warning) Clean up `as any` in `queue.service.ts` / `kpi.service.ts`

---

*Generated by Pre-Merge Guard agent — 2026-04-25*
