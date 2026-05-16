# Merge Guard Report — feat/expense-v2-b1-sso-875

**Date**: 2026-05-16  
**Branch**: `feat/expense-v2-b1-sso-875`  
**Author**: Akenarin Kongdach  
**Commits**: 1  
**Changes**: 23 files changed, +330 / -61  

---

## Summary

Moves the Thai Social Security (SSO) per-person contribution cap from a hard-coded `@Max(750)` DTO validator to a runtime lookup against a new `sso_config` DB table. This enables the cap to update automatically when กฎกระทรวง raises the salary ceiling (875 THB/person in 2569+, 1,000 in 2572+, 1,150 in 2575+) without requiring a code deploy.

**Affected modules**: `expense-documents` (payroll flow), new `sso-config` service module, `payroll.template.ts`, Prisma schema.

---

## File Changes

| Area | Files | Δ |
|---|---|---|
| New: `SsoConfigModule` + `SsoConfigService` | 2 | +68 |
| New: `SsoConfig` Prisma model + migration | 2 | +44 |
| Modified: `ExpenseDocumentsService.createPayroll` | 1 | +15 |
| Modified: `CreatePayrollDto` (removed `@Max(750)`) | 1 | +23 / -10 |
| Modified: `PayrollTemplate` (comment update) | 1 | +4 / -3 |
| Modified: `ExpenseDocumentsModule` (SsoConfigModule import) | 1 | +2 |
| Updated: 9 test files (inject `SsoConfigService` mock) | 9 | +179 / -44 |
| New: `sso-config.service.spec.ts` (10 tests) | 1 | +98 |

---

## Issues Found

### Critical
_None_

### Warning

**W1 — `SsoConfigModule` directly provides `PrismaService` instead of importing `PrismaModule`**  
File: `apps/api/src/modules/sso-config/sso-config.module.ts`

```ts
// Current
@Module({
  providers: [SsoConfigService, PrismaService],  // ← direct instantiation
  exports: [SsoConfigService],
})
```

Convention across all other modules (e.g. `ExpenseDocumentsModule`, `JournalModule`) is `imports: [PrismaModule]`. Direct `PrismaService` in `providers` bypasses the shared module and instantiates a separate `PrismaService`. In practice Prisma's connection pool means this doesn't cause extra DB connections, but it's inconsistent and will break if `PrismaModule` ever becomes `@Global()` or starts injecting config. **Suggest** changing to:

```ts
@Module({
  imports: [PrismaModule],
  providers: [SsoConfigService],
  exports: [SsoConfigService],
})
```

### Info

**I1 — SSO cap validation runs N serial DB lookups (one per payroll line)**  
File: `apps/api/src/modules/expense-documents/expense-documents.service.ts:437-440`

`for (const l of dto.lines) await this.ssoConfig.validateContribution(docDate, l.ssoEmployee)` — each iteration issues one `ssoConfig.findFirst` query. For typical payrolls (2–30 employees) this is negligible, but N sequential queries where one pre-fetch would do. Not a regression; acceptable for now.

**I2 — `sso-config` module is not registered in `app.module.ts`**  
This is intentional — `SsoConfigModule` is imported only by `ExpenseDocumentsModule` (which is registered). No action needed; documented here to pre-empt confusion.

---

## Security Checklist

| Check | Result |
|---|---|
| New controllers with missing `@UseGuards` | ✅ No new controllers |
| `Number()` on server-side money fields | ✅ Clean — `Prisma.Decimal` used in service |
| `deletedAt: null` in new queries | ✅ `getEffectiveConfig()` includes `deletedAt: null` |
| Hardcoded secrets / API keys | ✅ None |
| `$queryRaw` without parameterization | ✅ None |
| Missing `@Roles()` | ✅ No new endpoints |
| Thai error messages on DTOs/exceptions | ✅ `BadRequestException` / `NotFoundException` in Thai |
| `SsoConfig` model: `Decimal` for money | ✅ `salaryCeiling` + `maxContribution` both `@db.Decimal(12,2)` |
| `SsoConfig` model: proper timestamps | ✅ `createdAt`, `updatedAt`, `deletedAt` all present |
| `SsoConfig` model: index on lookup fields | ✅ `@@index([effectiveFrom, effectiveTo])` |

---

## Recommendation

**APPROVE** — no critical issues.

Address W1 (PrismaModule import pattern) before or immediately after merge. All other findings are informational.
