# Merge Guard Report — feat/collections-partial-payment-escalate

**Date**: 2026-04-28  
**Branch**: `feat/collections-partial-payment-escalate`  
**Base**: `origin/main`  
**Author**: Akenarin Kongdach / Claude (iamnaii@MacBook-Pro / iamnaii@)  
**Recommendation**: ✅ APPROVE

---

## File Changes Summary

30 files changed · +3,817 / −1,936 lines  
_(~1,881 net new lines; bulk of diff is package-lock.json churn +3,810/−3,810)_

| Area | Files | Key Changes |
|------|-------|-------------|
| API — Overdue module | `overdue.controller.ts`, `overdue.service.ts`, `queue.service.ts` | 2 new endpoints + service methods |
| API — New DTOs | `partial-payment-reschedule.dto.ts`, `escalate.dto.ts` | Full validation coverage |
| API — Queue enrichment | `queue.service.ts` | PromiseMap for latest active promise display |
| Web — Components | `PartialPaymentRescheduleDialog.tsx`, `ContactLogDialog.tsx`, `ContractCard.tsx` | New dialog + UI hooks |
| Web — Hooks | `usePartialPaymentReschedule.ts`, `useEscalate.ts`, `useContactLog.ts` | React Query mutations |
| Tests | `overdue.service.spec.ts`, `queue.service.spec.ts`, `ContactLogDialog.test.tsx`, `ContractCard.test.tsx` | Coverage extended |
| Infra | `package.json`, `package-lock.json`, `config.util.ts` | Dep updates + config |
| Docs | `docs/reports/weekly-progress-2026-04-27.md` | Progress report |

---

## Security & Quality Checks

### ✅ Critical — PASS

| Check | Result |
|-------|--------|
| `@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)` on `OverdueController` class | ✅ Present |
| `@Roles(...)` on `partialPaymentReschedule` endpoint | ✅ `OWNER, BRANCH_MANAGER, SALES, FINANCE_MANAGER` |
| `@Roles(...)` on `escalate` endpoint | ✅ `OWNER, BRANCH_MANAGER, FINANCE_MANAGER, SALES` |
| LEGAL segregation-of-duty gate | ✅ Inside service (checked via `user.role`) |
| `deletedAt: null` in new DB queries | ✅ All new queries in `queue.service.ts` include `deletedAt: null` |
| No hardcoded secrets | ✅ Clean |
| No unparameterized `$queryRaw` | ✅ None used |

### ✅ Warning — PASS

| Check | Result |
|-------|--------|
| DTO validation on `PartialPaymentRescheduleDto` | ✅ Full class-validator coverage with Thai messages |
| DTO validation on `EscalateDto` | ✅ `@IsIn` + `@MinLength`/`@MaxLength` with Thai messages |
| Frontend uses `api.post()` (not raw `fetch`) | ✅ Both hooks import from `@/lib/api` |
| `queryClient.invalidateQueries()` after mutations | ✅ Both hooks invalidate `collections-queue`, `collections-kpi`, `contract-call-log-latest` |
| Error handling in service methods | ✅ Sentry + `BadRequestException`/`NotFoundException` covered |
| Decimal precision on money calculations | ✅ Service wraps `dto.amountPaid` in `new Prisma.Decimal()` before arithmetic |

### ℹ️ Info

1. **`PartialPaymentRescheduleDto.amountPaid` typed as `number`** (`@IsNumber()` decorator, `number` TS type).  
   The field is `number` from HTTP input (correct — JSON doesn't have Decimal). The service immediately wraps it in `new Prisma.Decimal(dto.amountPaid)` for all financial arithmetic.  
   → No precision risk; this is intentional. No change required.

2. **`PartialPaymentRescheduleDialog.tsx` is 320 lines** — within the 500-line guideline.

3. **`queue.service.ts` settlement amounts** use `new Prisma.Decimal(...).toNumber()` for serialization (JSON response) — correct pattern.

---

## Verdict

No Critical or Warning issues. Two new endpoints are properly guarded, validated, and tested. Financial arithmetic is Decimal-safe. Frontend follows all React Query + `api.*` conventions.

**Recommendation: ✅ APPROVE — safe to merge**
