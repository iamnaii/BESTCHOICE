# Merge Guard Report — feat/p3-sp4-pii-encryption

**Date**: 2026-05-18  
**Branch**: `feat/p3-sp4-pii-encryption`  
**Author**: Akenarin Kongdach  
**Commits**: 8 (incl. merge + DEEP-review fix commit)  
**Files changed**: 25 (+3,675 / -58)  
**Recommendation**: ✅ APPROVE

---

## File Changes Summary

| Area | Files | Notes |
|------|-------|-------|
| Backend | `pdpa-encryption.service.ts`, `pdpa-encryption.controller.ts`, `pdpa.module.ts`, `pdpa-backfill-retention.cron.ts` | New PDPA module |
| Backend | `customer-pii.service.ts`, `customers.service.ts` | PII read/write guard |
| Backend | `crypto.util.ts` | AES-256 encrypt/decrypt util |
| Backend | `encrypt-customer-pii.cli.ts` | Backfill CLI |
| DB | Migration `20260948`, `20260949` + schema | `PdpaBackfillRun` model + backfill indexes |
| Frontend | `PdpaTab.tsx`, `SettingsPage/index.tsx` | New `/settings#pdpa` tab |
| Tests | `pdpa-encryption.*.spec.ts`, `customer-pii.service.spec.ts`, `PdpaTab.test.tsx` | Unit + component tests |

---

## Critical Issues

None found.

**Guards**: `PdpaEncryptionController` has `@UseGuards(JwtAuthGuard, RolesGuard)` at class level; all 5 endpoints have `@Roles('OWNER')` or `@Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')`. ✅

**Money fields**: No `Number()` usage on financial data. ✅

**Soft delete**: No new `findMany`/`findFirst` without `deletedAt: null`. ✅

**Secrets**: No hardcoded API keys or secrets. PII key correctly read from `process.env.PII_ENCRYPTION_KEY`. ✅

**SQL injection**: `$queryRaw` used only for PostgreSQL advisory lock (`pg_try_advisory_lock`), via tagged template literals — fully parameterized. ✅

---

## Warning Issues

### W1 — `pdpa-encryption.service.ts` at 803 lines (>500)
**File**: `apps/api/src/modules/pdpa/pdpa-encryption.service.ts`  
The backfill logic, status queries, and lock management could be split into a `PdpaBackfillService`. Not blocking, but will be painful to maintain.

### W2 — `customers.service.ts` now at 1,139 lines
**File**: `apps/api/src/modules/customers/customers.service.ts`  
This file was already large before this PR; the addition of PII routing calls pushes it further. Consider extracting PII-aware queries into `CustomerPiiService` over time.

### W3 — Backfill endpoint has no dedicated rate-limit decorator
**File**: `apps/api/src/modules/pdpa/pdpa-encryption.controller.ts:81`  
`POST /pdpa-encryption/backfill` is protected by the global ThrottlerGuard (200 req/s) and a PostgreSQL advisory lock in the service, so concurrent abuse is prevented at the DB level. However, a `@Throttle({ default: { limit: 3, ttl: 60000 } })` on this specific endpoint would make the defense explicit and reduce unnecessary advisory-lock contention. Low priority since advisory lock already prevents double-runs.

---

## Info

### I1 — `PdpaBackfillRun` has no `deletedAt`
**File**: `apps/api/prisma/schema.prisma`  
By the Database rules, `updatedAt`/`deletedAt` may be omitted for append-only audit/run logs. `PdpaBackfillRun` looks like an immutable run record, but it's missing the `/// Immutable` Prisma comment that the rules require when omitting timestamps. Minor documentation gap.

### I2 — Thai DTO message present but minimal
`SetStrictModeDto` has `{ message: 'enabled ต้องเป็น boolean' }`. Passes the Thai-message rule. Single-field DTO is appropriately concise.

---

## Test Coverage

- `pdpa-encryption.service.spec.ts` — service unit tests present  
- `pdpa-encryption.controller.spec.ts` — controller tests present  
- `customer-pii.service.spec.ts` — PII service unit tests present  
- `PdpaTab.test.tsx` — React component tests (181 lines) present  
- `crypto.util.spec.ts` — crypto utility tests present  

---

## Recommendation: ✅ APPROVE

All Critical checks pass. No security vulnerabilities. Warning items are code-quality improvements that can be addressed in follow-up chores. The DEEP-review fix commit (`39e516e1`) already addressed the originally flagged Critical + Warning items. Safe to merge.
