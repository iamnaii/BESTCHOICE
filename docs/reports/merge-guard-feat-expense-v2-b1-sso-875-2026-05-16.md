# Merge Guard Report — feat/expense-v2-b1-sso-875

**Date**: 2026-05-16  
**Branch**: `feat/expense-v2-b1-sso-875`  
**Last commit**: 2026-05-16 14:22 BKK — `feat(payroll): B1 — SSO ceiling configurable by effective period (875 in 2569+)`  
**Recommendation**: ⚠️ REVIEW (2 warnings, fix before merge)

---

## File Changes Summary (23 files, +330/−61)

| Area | Files |
|------|-------|
| New module | `sso-config/sso-config.module.ts`, `sso-config/sso-config.service.ts` |
| New tests | `sso-config/__tests__/sso-config.service.spec.ts` |
| Schema | `prisma/schema.prisma` (new `SsoConfig` model), `migrations/20260927000000_sso_config_table/migration.sql` |
| Modified service | `expense-documents/expense-documents.service.ts` |
| Modified DTO | `expense-documents/dto/create-payroll.dto.ts` |
| Updated tests (10) | Various `expense-documents/__tests__/*.spec.ts` integration tests |
| Docs | `docs/superpowers/tracking/B1-sso-875.md`, `README.md` |

---

## Issues Found

### ⚠️ Warning — W1: `SsoConfigModule` instantiates `PrismaService` directly

**File**: `apps/api/src/modules/sso-config/sso-config.module.ts`

```ts
@Module({
  providers: [SsoConfigService, PrismaService],   // ← WRONG
  exports: [SsoConfigService],
})
```

All other modules in this codebase use `imports: [PrismaModule]` to share the singleton `PrismaService`. Instantiating `PrismaService` directly in `providers` creates a second, unshared Prisma client for this module — this wastes a connection pool slot and is inconsistent with the project pattern.

**Fix**:
```ts
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [SsoConfigService],
  exports: [SsoConfigService],
})
```

Reference pattern: `apps/api/src/modules/customers/customers.module.ts`

---

### ⚠️ Warning — W2: `Prisma.Decimal.toNumber()` used for comparison in service

**File**: `apps/api/src/modules/sso-config/sso-config.service.ts:50`

```ts
const cap = cfg.maxContribution.toNumber();   // converts Decimal → JS float
if (ssoEmployee > cap) {
```

Project convention (`.claude/rules/database.md`): "ห้ามใช้ Float หรือ Int สำหรับจำนวนเงิน". While the comparison itself is safe for small integers (875, 1000, 1150), using `toNumber()` on a money `Decimal` violates the project rule and sets a bad precedent.

**Fix** — keep arithmetic in `Prisma.Decimal`:
```ts
if (new Prisma.Decimal(ssoEmployee).gt(cfg.maxContribution)) {
  throw new BadRequestException(
    `SSO ต่อคนไม่เกิน ${cfg.maxContribution.toFixed(2)} บาท/เดือน ...`,
  );
}
```
Also remove `const cap = ...` line. The error message already uses `toFixed(2)` on the Decimal directly — no `toNumber()` needed there either.

---

## Positive Findings

- ✅ New `SsoConfig` Prisma model uses `@db.Decimal(12,2)` for `salaryCeiling` and `maxContribution`
- ✅ Migration includes seed data for 3 known GST periods (2569/2572/2575) with correct values
- ✅ `getEffectiveConfig` query has `deletedAt: null` guard
- ✅ Compound index `[effectiveFrom, effectiveTo]` present in schema and migration
- ✅ Thai error messages on `BadRequestException` and `NotFoundException`
- ✅ No new public controller (no guards needed)
- ✅ `SsoConfigService.spec.ts` covers 8 test cases including both period boundaries and edge cases (null/0 pass-through, NotFoundException on missing seed)
- ✅ All 10 modified integration test files correctly inject `SsoConfigService` mock
- ✅ `@Max(750)` removal from DTO is intentional, well-documented, and tested

---

## Recommendation: REVIEW

Fix W1 (module pattern) and W2 (Decimal comparison) before merging. Both are small, one-line changes. No security issues. No missing guards. Logic is sound.
