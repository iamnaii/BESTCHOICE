# Merge Guard Report — PDPA Hotfixes
**Date**: 2026-05-18  
**Branches reviewed**:
- `hotfix/pdpa-extract-pii-module`
- `hotfix/pdpa-authmodule-forwardref`

**Author**: Akenarin Kongdach  
**Reviewer**: Pre-Merge Guard (automated)

---

## Branch: `hotfix/pdpa-extract-pii-module`

### File Changes Summary
| File | +/- |
|------|-----|
| `apps/api/src/modules/customers/customer-pii.module.ts` | +24 (new) |
| `apps/api/src/modules/customers/customers.module.ts` | +3 / -4 |
| `apps/api/src/modules/pdpa/pdpa-encryption.service.ts` | -3 |
| `apps/api/src/modules/pdpa/pdpa.module.ts` | +8 / -16 |

**Total**: 4 files, 34 insertions, 22 deletions

### Context
Fixes NestJS boot crash caused by circular module chain:
`PDPAModule → CustomersModule → OverdueModule → ChatEngineModule ↔ StaffChatModule`

Solution: extract `CustomerPiiService` into a standalone `CustomerPiiModule` (leaf — depends only on `PrismaModule`), so `PDPAModule` can import it without pulling in the rest of the `CustomersModule` chain.

### Issues Found

#### Critical
_None._

#### Warning
_None._

#### Info
- **`customer-pii.module.ts:23-24`** — Two leftover debug comments at end of file:
  ```ts
  // hotfix 2026-05-18
  // hotfix trigger 2
  ```
  These are vestigial CI-trigger comments and should be removed before merge. Not harmful, purely cosmetic.

### Recommendation: ✅ APPROVE
> Architecture is sound. The leaf-module pattern correctly breaks the circular dep without forwardRef hacks. One cosmetic cleanup (remove debug comments) would be nice but does not block merge.

---

## Branch: `hotfix/pdpa-authmodule-forwardref`

### File Changes Summary
| File | +/- |
|------|-----|
| `apps/api/src/modules/pdpa/pdpa.module.ts` | +18 / -6 |

**Total**: 1 file, 18 insertions, 6 deletions

### Context
Follow-up to `pdpa-extract-pii-module` (#1018). After extracting `CustomerPiiModule`, a second circular cycle remained:
`NotificationsModule → PDPAModule → AuthModule` (AuthModule mid-init via `LineOaModule forwardRef` in scan order → seen as `undefined` by NestJS DI).

Solution: wrap `AuthModule` in `forwardRef(() => AuthModule)` in `pdpa.module.ts`. Standard NestJS resolution for init-order cycles.

### Issues Found

#### Critical
_None._

#### Warning
_None._

#### Info
_None._ (This is a minimal, correct fix.)

### Recommendation: ✅ APPROVE
> Single-file change. Correct use of `forwardRef` for NestJS circular import resolution. No guards, no money fields, no new endpoints — no security surface.

---

## Summary

| Branch | Files | Critical | Warning | Info | Verdict |
|--------|-------|----------|---------|------|---------|
| `hotfix/pdpa-extract-pii-module` | 4 | 0 | 0 | 1 | ✅ APPROVE |
| `hotfix/pdpa-authmodule-forwardref` | 1 | 0 | 0 | 0 | ✅ APPROVE |

Both hotfixes are safe to merge immediately.
