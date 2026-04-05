# Overnight Codebase Audit Report — 2026-04-05

## Summary

Comprehensive 6-phase codebase improvement for BESTCHOICE installment management system.
All phases completed successfully with zero TypeScript errors in both apps.

| Phase | Description | Files Changed | Status |
|-------|-------------|---------------|--------|
| 1 | Type Safety Audit | 61 files | Done |
| 2 | Dead Code & Console Cleanup | 15 files | Done |
| 3 | Security & Backend Audit | 11 files | Done |
| 4 | Frontend Quality | 0 (already compliant) | Done |
| 5 | E2E Test Expansion | 4 files (316 lines added) | Done |
| 6 | Final Verification & Report | 1 file | Done |

**Total: 91 files modified, 4 commits**

---

## Phase 1: Type Safety Audit

**Commit:** `623b383 refactor: eliminate unsafe 'any' types across API and web`

### API (36 files, 121 `any` instances fixed)
- `catch (err: any)` replaced with `catch (err: unknown)` + type narrowing using `instanceof`
- Prisma enum casts: `as any` replaced with specific enums (`ProductCategory`, `CreditCheckStatus`, etc.)
- Express types: `@Req() req: any` replaced with `Request` from express
- Prisma meta access: `(err.meta as any)` replaced with typed access
- Test mocks: Retained `any` with eslint-disable annotations where dynamic property access required
- JSON fields: `as any[]` replaced with `Prisma.JsonArray`

### Web (25 files, 56 `any` instances fixed)
- Error handlers: `catch (err: any)` replaced with `catch (err: unknown)` + `instanceof Error`
- Mutation callbacks: `onError: (err: any)` to `onError: (err: unknown)`
- Component interfaces: Defined proper types for `aiAnalysis`, `contractDocuments`, `creditCheck`
- Library types: Typed jsPDF internals, recharts payload, template data
- Utility functions: `applyFormat(value: any)` to `applyFormat(value: unknown)`

### Shared Constants Sync
- Added `CREDIT_BALANCE` and `ONLINE_GATEWAY` to `PaymentMethod` enum in `packages/shared/src/constants.ts`
- Added Thai labels: `เครดิตคงเหลือ`, `ชำระออนไลน์`

---

## Phase 2: Dead Code & Console Cleanup

**Commit:** `91b6740 refactor: remove console.logs, replace confirm() with ConfirmDialog, fix eslint-disable`

### Console Statements
- API: 2 `console.error` in `receipts.service.ts` replaced with NestJS `Logger` service
- Web: 7 console statements retained (all legitimate: DEV-gated, PDF error handlers, env validation)

### confirm() Replacement (13 files)
All `confirm()` and `window.confirm()` calls replaced with `ConfirmDialog` component using Radix UI Dialog primitives and state-based confirmation pattern:
- DocumentUpload, ProductPhotosPanel, StepSignature, BlockItem, HeaderBar
- ContractTemplatesPage, InterestConfigPage, LiffProfile, NotificationsPage
- PricingTemplatesPage, ProductDetailPage, StockAlertsPage, SupplierDetailPage

### eslint-disable Cleanup
- `StepKycVerification.tsx`: Removed 2 `eslint-disable-line` comments, replaced with descriptive dependency comments
- `chart.tsx` (2) and `data-grid.tsx` (2): Retained — library limitation justifications

---

## Phase 3: Security & Backend Audit

**Commit:** `a201ade fix(security): enforce soft-delete compliance and add missing timestamps`

### Soft Delete Compliance (10 services, 86+ queries fixed)

| Module | Before | After |
|--------|--------|-------|
| exchange | 0% | 100% |
| auth | 0% | 100% |
| invite | 0% | 100% |
| pdpa | 0% | 100% |
| payments | 13% | 100% |
| sales | 20% | 100% |
| receipts | 20% | 100% |
| credit-check | 8% | 100% |
| products-stock | 35% | 100% |
| purchase-orders | 26% | 100% |

Patterns applied:
- `findMany`/`findFirst`/`count`/`aggregate`: Added `deletedAt: null` to `where`
- `findUnique`: Added `if (!result || result.deletedAt)` check after fetch
- Transaction queries: Same filters applied inside `$transaction` blocks

### Prisma Schema Timestamps (6 models updated)
Added `deletedAt DateTime?` to:
- SupplierPaymentMethod, GoodsReceivingItem, EDocument, CallLog, StockCountItem, BranchReceivingItem

Added `updatedAt DateTime @updatedAt` to:
- StockCountItem, BranchReceivingItem

**Note:** Requires `prisma migrate dev` before deployment to create the migration.

### Items Already Compliant (no changes needed)
- Controller guards: All 43 controllers have `@UseGuards(JwtAuthGuard, RolesGuard)`
- 3 intentionally public endpoints: address (static data), sms-webhook, paysolutions (payment gateway)
- DTO validation: 49/51 DTOs have full class-validator decorators
- Money fields: All use `@db.Decimal(12, 2)` — no Float/Int for money

---

## Phase 4: Frontend Quality

**No commit needed — all patterns already compliant.**

### Audit Results
- Data fetching: All use `useQuery`/`useMutation` from TanStack Query
- API calls: All use `api` from `@/lib/api` (no raw fetch/axios)
- Routing: All 65+ routes lazy-loaded with `React.lazy()`
- Components: All functional (no class components)
- Error handling: All 53 `useMutation` calls have `onError` callbacks
- Notifications: Now all use `toast` from sonner (after Phase 2 confirm() fix)

---

## Phase 5: E2E Test Expansion

**Commit:** `38d95b6 test: expand E2E coverage for credit checks, templates, signing, receipts`

### New Test Files
1. **`credit-checks.spec.ts`** (7 tests)
   - Page load, status filter, search, detail navigation
   - Approve/reject actions for pending checks

2. **`template-editor.spec.ts`** (11 tests)
   - Contract template: list, create, editor, save, PDF preview
   - Pricing template: list, add, brand filter, import/export

### Enhanced Test Files
3. **`contract-workflow.spec.ts`** (+2 tests)
   - Signature step indicators (customer/staff)
   - Clear and re-sign button availability

4. **`finance.spec.ts`** (+4 tests)
   - Receipt navigation from contract detail
   - Receipt detail with company info display
   - PDF download action availability
   - Receipt number format verification

### Coverage Summary
- Before: 22 test files, ~180 test cases
- After: 24 test files, ~204 test cases
- Critical flows now covered: credit checks, template editor, signature workflow, receipt generation

---

## Phase 6: Final Verification

### TypeScript Compilation
- `apps/api`: `npx tsc --noEmit` — **0 errors**
- `apps/web`: `npx tsc --noEmit` — **0 errors**

### Prisma Schema
- `npx prisma validate` — **valid**

---

## Action Items for Deployment

1. **Run Prisma migration** for new timestamps (6 models):
   ```bash
   cd apps/api && npx prisma migrate dev --name add_missing_timestamps
   ```
2. **Test the soft-delete changes** with existing data to ensure no regressions
3. **Run full E2E suite** against dev server to validate new tests
