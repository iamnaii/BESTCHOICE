# Merge Guard Report — worktree-feat+sp7.1-dual-prisma-foundation
**Date:** 2026-07-01  
**Branch:** `origin/worktree-feat+sp7.1-dual-prisma-foundation`  
**Reviewer:** Pre-Merge Guard Agent  
**Recommendation:** ✅ APPROVE (with notes)

---

## Summary

Large worktree branch (~2,571 commits ahead of main, 1,602 files changed) implementing the P3-SP7 SHOP/FINANCE legal entity split via dual Prisma clients. Review focused on the new security-sensitive additions: `JwtAudienceGuard`, `PrismaFinanceService`, `ConsolidatedController`, `OutboxService`, and the 2FA authentication endpoints.

### Key New Features
- **`PrismaFinanceService`** — second Prisma client connecting to `DATABASE_URL_FINANCE`
- **`JwtAudienceGuard`** — global APP_GUARD enforcing `aud` claim on all JWTs (admin vs shop)
- **`ConsolidatedController`** — cross-entity trial balance / P&L / dashboard (SP7.6)
- **`OutboxService` + `OutboxProcessorService`** — saga pattern for cross-entity JEs
- **2FA endpoints** on `AuthController` (`generate`, `enable`, `disable`, `status`)
- **`ReversePermissionGuard`** — document reversal SOD guard

---

## Issues Found

### 🟢 No Critical Issues

No missing `JwtAuthGuard`, no unparameterized SQL injection, no hardcoded secrets.

---

### 🟡 Warning

**W1 — 2FA endpoints use `@UseGuards(JwtAuthGuard)` without `RolesGuard`**  
File: `apps/api/src/modules/auth/auth.controller.ts`

```
POST /auth/2fa/generate  → @UseGuards(JwtAuthGuard)  (no RolesGuard, no @Roles)
POST /auth/2fa/enable    → @UseGuards(JwtAuthGuard)
POST /auth/2fa/disable   → @UseGuards(JwtAuthGuard)
GET  /auth/2fa/status    → @UseGuards(JwtAuthGuard)
```

These are user-self-service operations (each user manages their own 2FA via `@CurrentUser('id')`), so `RolesGuard` / `@Roles` would be incorrect here. However, this pattern deviates from the project's security rule that says all controller methods must have `@Roles`. Recommend documenting as an intentional exception in `security.md` to prevent future "missing Roles" audit findings.

**W2 — `JwtAudienceGuard` path-based detection depends on `AdminPrefixMiddleware` ordering**  
File: `apps/api/src/modules/auth/guards/jwt-audience.guard.ts`

The guard comment states: "middleware strips /api/admin/* → /api/* before guards run." If `AdminPrefixMiddleware` is not registered globally before this guard runs, admin paths would fall through the audience check. Verify middleware registration order in `app.module.ts` — the guard assumes this stripping already happened.

---

### 🔵 Info

**I1 — `OutboxProcessorService` retries up to 5 attempts with no exponential backoff**  
File: `apps/api/src/modules/journal/outbox-processor.service.ts`

Failed outbox events are retried on each hourly cron run without delay between attempts. This is acceptable for low-frequency cross-entity JEs, but a retry storm after a DB brownout could generate many near-simultaneous JEs. Consider exponential backoff (`attempts < 5` → delay 2^attempts minutes) in a future iteration.

**I2 — `DATABASE_URL_FINANCE` pool config mutates `process.env` at constructor time**  
File: `apps/api/src/prisma/prisma-finance.service.ts`, lines ~14-20

The constructor appends `connection_limit` parameters directly to `process.env.DATABASE_URL_FINANCE`. This is the same pattern as the existing `PrismaService`, so it's consistent, but mutation of environment variables at construction time is surprising and can cause issues in test environments where multiple service instances are constructed. Worth noting for the test harness.

**I3 — `ConsolidatedController` removes VIEWER role that was present before**  
File: `apps/api/src/modules/accounting/consolidated.controller.ts`

```diff
-@Roles('OWNER', 'ACCOUNTANT', 'VIEWER')
+@Roles('OWNER', 'ACCOUNTANT')
```

The `VIEWER` role was removed. If any VIEWER-role users need cross-entity consolidated reporting, this would silently start 403ing them. Intentional? Worth confirming with the owner.

---

## Security Checklist

| Check | Status |
|-------|--------|
| New controllers have proper guards | ✅ ConsolidatedController: `JwtAuthGuard + RolesGuard + @Roles('OWNER','ACCOUNTANT')` |
| `JwtAudienceGuard` correctly registered as APP_GUARD | ✅ Confirmed in `app.module.ts` |
| New public endpoints | ✅ None — 2FA endpoints require JWT |
| SQL injection in new `$queryRaw` usages | ✅ All use `Prisma.sql\`...\`` tagged template (parameterized) |
| `deletedAt: null` in new queries | ✅ `outbox.service.ts` includes in both `findPending` and `findFailed` |
| No hardcoded secrets | ✅ Clean — DB URL comes from `process.env.DATABASE_URL_FINANCE` |
| Money fields avoid `Number()` in calculations | ✅ New consolidated service uses `Prisma.Decimal` arithmetic |
| Soft-delete patterns | ✅ OutboxEvent has `deletedAt` field with proper filters |

---

## Recommendation: ✅ APPROVE

Architecture is sound. The new dual-Prisma pattern is clean. `JwtAudienceGuard` is well-designed — correct path exceptions, no over-permissiveness. `OutboxService` follows proper idempotency patterns.

**Pre-merge checklist:**
1. Confirm W2 (`AdminPrefixMiddleware` registration order) — add an integration test that verifies a `/api/admin/` path correctly requires `aud=admin` 
2. Add 2FA exception to `security.md` (W1) so the next guard run doesn't flag it as a bug
3. Clarify VIEWER role removal (I3) with the owner
