# Pre-Merge Guard Report — Employee Master + Payroll Link Epic

**Date**: 2026-06-11  
**Reviewer**: Pre-Merge Guard (automated)  
**Branches reviewed**: 3 of 356 unmerged (selected by recency + feature relevance)

---

## Branches Reviewed

| Branch | Layer | Author | Last Commit | Unique Files |
|--------|-------|--------|-------------|-------------|
| `feat/employee-master-ui` | PR-B (frontend) | Akenarin Kongdach | 2026-06-04 | 8 files (+1429 lines) |
| `feat/payroll-employee-link` | PR-C (payroll link) | Akenarin Kongdach | 2026-06-05 | 40 files (+5372/-31) |
| `feat/payroll-backfill` | PR-D (backfill CLIs) | Akenarin Kongdach | 2026-06-05 | 28 files (+3425/-31) |

> **Note on branch stacking**: These 3 branches build on top of each other and on
> `feat/employee-master` (PR-A, backend). All 3 sit 158–164 commits ahead of `main`.
> PR-A and PR-B have `#1151` / `#1152` in commit messages, suggesting they were
> separately pull-requested; the review below covers each layer's unique diff only.

---

## Critical Issues (must fix before merge)

**None found.**

- `@UseGuards(JwtAuthGuard, RolesGuard)` present at class level on `EmployeesController` and `SsoConfigController` ✅  
- `@Roles(...)` on every controller method ✅  
- All money fields (`baseSalary`, `ssoEmployee`, `whtAmount`, `netPaid`) use `Prisma.Decimal` / `new Prisma.Decimal(dto.baseSalary)` — no `Number()` on financial data ✅  
- All Prisma queries include `deletedAt: null` where the model has a soft-delete column ✅  
- No hardcoded secrets or API keys ✅  
- No `$queryRawUnsafe` — backfill CLI uses `$queryRaw` with template literals (safe) ✅  

---

## Warning Issues (should fix)

### W1 — `PayrollLineInput.userId` missing `@IsUUID()` guard

**Branch**: `feat/payroll-backfill`  
**File**: `apps/api/src/modules/expense-documents/dto/create-payroll.dto.ts`

```typescript
// Current — accepts any string
@IsString()
@IsOptional()
userId?: string;
```

Should be:
```typescript
@IsUUID(undefined, { message: 'รูปแบบ userId ไม่ถูกต้อง' })
@IsOptional()
userId?: string;
```

The service validates the userId via a DB lookup against active `EmployeeProfile` rows,
so this is **not a security hole** — a malformed UUID will throw at the DB query level
before any harm can be done. However, it is inconsistent with the pattern established
by commit `3ad5e99c` ("fix(contacts): `@IsUUID` guards") which added UUID validation to
other FK fields across the codebase. Failing to validate format also means an attacker
can test arbitrary strings and observe timing differences on the DB lookup.

**Recommendation**: Add `@IsUUID()` to match the codebase convention.

---

### W2 — `/employees` route lacks role-level ProtectedRoute

**Branch**: `feat/employee-master-ui`  
**File**: `apps/web/src/App.tsx:497`

```tsx
// Current — protected by auth only (parent wrapper), no role restriction
<Route path="/employees" element={<EmployeesPage />} />
```

Comparable restricted pages use:
```tsx
<Route path="/users" element={<ProtectedRoute roles={['OWNER']}><UsersPage /></ProtectedRoute>} />
```

Any authenticated user (SALES, BRANCH_MANAGER) can navigate directly to `/employees`
by URL. The page-level `canManage` check hides action buttons, but the list query
fires and returns a 403 from the API — the user sees a `QueryBoundary` error state
instead of a clean "no access" redirect.

**Mitigations already in place**:
- Parent `<ProtectedRoute><MainLayout /></ProtectedRoute>` ensures authentication
- API enforces `@Roles('OWNER', 'ACCOUNTANT')` on all `/employees` endpoints
- Menu config only shows the link for OWNER and ACCOUNTANT roles

**Impact**: Minor UX issue for non-OWNER/ACCOUNTANT users who type the URL directly —
they see an error rather than a redirect. Consistent with `/customers` and `/contacts`
which also omit role-level route guards.

**Recommendation**: Optionally add
```tsx
<Route path="/employees" element={<ProtectedRoute roles={['OWNER', 'ACCOUNTANT']}><EmployeesPage /></ProtectedRoute>} />
```
for consistent UX (redirects rather than 403 error states).

---

### W3 — Hardcoded `CUSTOM_INCOME_WHITELIST` in PayrollLinesSection

**Branch**: `feat/payroll-employee-link`  
**File**: `apps/web/src/components/expense-form-v4/PayrollLinesSection.tsx:30-34`

The account code whitelist for custom income lines is hardcoded in the frontend:

```typescript
const CUSTOM_INCOME_WHITELIST = [
  { code: '53-1104', label: '53-1104 โบนัส' },
  { code: '53-1105', label: '53-1105 ค่าล่วงเวลา (OT)' },
];
```

The comment acknowledges this: _"UI can resync from API later when /settings page
exposes the whitelist editor."_

If the server-side whitelist is updated via SystemConfig, the frontend will be out
of sync until the next code deploy. The API validates the account code on the server
side (V17 check), so invalid codes are rejected — this is a UX issue rather than
a data integrity issue.

**Recommendation**: Acceptable as tech debt for the current sprint. Track in backlog
for Phase A.5: expose `/system-config/custom-income-accounts` endpoint and replace
the hardcoded array with a `useQuery`.

---

## Info

### I1 — `baseSalary` sent as `number` from frontend, converted to Decimal on backend

**Branch**: `feat/employee-master-ui`  
**File**: `apps/web/src/components/employees/ProvisionEmployeeDialog.tsx`

```typescript
baseSalary: baseSalary ? parseFloat(baseSalary) : undefined,
```

The `ProvisionEmployeeInput` type has `baseSalary?: number`. The backend converts
it properly with `new Prisma.Decimal(dto.baseSalary)`. No financial arithmetic is
performed on the `number` value — it is only a transport type between the form input
and the API.

**Not an issue** — pattern is intentional (HTML `<input type="number">` values are
strings, parsed to number for the API transport layer, stored as Decimal in DB).

---

### I2 — `parseFloat` in SSO pre-fill calculation (display only)

**Branch**: `feat/payroll-employee-link`  
**File**: `apps/web/src/components/expense-form-v4/PayrollLinesSection.tsx`

```typescript
const ceiling = ssoCfg.data ? parseFloat(ssoCfg.data.salaryCeiling) : null;
const rate = ssoCfg.data?.rate ?? 0.05;
patch.ssoEmployee = String(round2(Math.min(base, ceiling) * rate));
```

`parseFloat` is used only to compute a display pre-fill value in the UI. The actual
SSO amount stored in the DB is recalculated by the backend from `Prisma.Decimal`
values. No financial record is created from this `number` arithmetic.

**Not an issue** — pre-fill display only.

---

### I3 — Large branch stack ahead of main (158 commits)

The entire employee-master epic (PR-A through PR-D) is 158 commits ahead of `main`.
Even if PRs A and B are merged separately via GitHub, the local branch lineage
means `feat/payroll-backfill` will need rebase/merge after each preceding merge.

**Not a code quality issue** — normal for a multi-PR epic. Recommend sequential merge
order: PR-A → PR-B → PR-C → PR-D.

---

## Recommendations

| Branch | Verdict | Blocker |
|--------|---------|---------|
| `feat/employee-master-ui` | ✅ **APPROVE** | None (W2 is optional polish) |
| `feat/payroll-employee-link` | ✅ **APPROVE** | W3 is acknowledged tech debt |
| `feat/payroll-backfill` | 🔶 **REVIEW** | Fix W1 (`@IsUUID` on userId) before merge |

### Suggested fix for W1

In `apps/api/src/modules/expense-documents/dto/create-payroll.dto.ts`, add the import
and decorator:

```typescript
import { IsUUID, IsString, IsOptional, /* ... */ } from 'class-validator';

class PayrollLineInput {
  // ...
  @IsUUID(undefined, { message: 'รูปแบบ userId ไม่ถูกต้อง' })
  @IsOptional()
  userId?: string;
```
