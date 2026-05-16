# Merge Guard Report — feat/expense-v2-b1-sso-875

**Date**: 2026-05-16  
**Branch**: `feat/expense-v2-b1-sso-875`  
**Author**: Akenarin Kongdach  
**Commits**: 1  
**Diff summary**: 23 files changed, 330 insertions(+), 61 deletions(-)

---

## Summary

SSO contribution cap lifted from a hardcoded DTO `@Max(750)` to a DB-driven `sso_config` table with period-effective rows. Introduces new `SsoConfigModule` / `SsoConfigService` and updates `ExpenseDocumentsService.createPayroll` to call `SsoConfigService.validateContribution` per payroll line. All test files updated to inject a mock `SsoConfigService`.

---

## File Changes

| Area | Files | Notes |
|------|-------|-------|
| New module | `sso-config/sso-config.module.ts`, `sso-config/sso-config.service.ts` | Service-only, no controller |
| New tests | `sso-config/__tests__/sso-config.service.spec.ts` | 98 lines, covers getEffectiveConfig + validateContribution edge cases |
| Prisma migration | `20260927000000_sso_config_table/migration.sql` | New `sso_config` table |
| Schema | `prisma/schema.prisma` | `SsoConfig` model (+28 lines) |
| DTO change | `create-payroll.dto.ts` | Removed `@Max(750)`, added expanded comment explaining service-layer enforcement |
| Service change | `expense-documents.service.ts` | Calls `ssoConfig.validateContribution(docDate, l.ssoEmployee)` per line |
| Module wiring | `expense-documents.module.ts` | Imports `SsoConfigModule` |
| Test updates | 8 test files | Mock `{ validateContribution: jest.fn().mockResolvedValue(undefined) }` injected |
| Docs | `docs/superpowers/tracking/B1-sso-875.md` | Tracking updated |

---

## Issues Found

### Critical (must fix before merge)

None.

### Warning (should fix)

None.

### Info

**I1 — `toNumber()` for comparison in validateContribution**  
File: `sso-config/sso-config.service.ts:49`  
```ts
const cap = cfg.maxContribution.toNumber();
if (ssoEmployee > cap) {
```
The cap conversion to `number` is used only for comparison against the DTO `ssoEmployee` (which arrives as a plain JS number). No arithmetic is performed on the converted value. This is acceptable — the Decimal stays intact for the error message (`cfg.maxContribution.toFixed(2)`). No financial rounding risk.

**I2 — Prisma migration future date**  
Migration name: `20260927000000_sso_config_table` (dated 2026-09-27, today is 2026-05-16).  
This is an intentional forward-dating convention. Acceptable but unconventional; document in deploy runbook.

---

## Recommendation

**APPROVE** ✅

Logic is correct, guards are not involved (no new controller), `deletedAt: null` is present in the `findFirst` query, and Thai validation messages are in place. Test coverage is solid (10 spec cases covering null/0 passthrough, exact cap, over-cap for two periods, and missing-config NotFoundException).
