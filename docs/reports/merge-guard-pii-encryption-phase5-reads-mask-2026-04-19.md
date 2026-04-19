# Merge Guard Report — feat/pii-encryption-phase5-reads-mask

**Date**: 2026-04-19  
**Author**: Akenarin Kongdach <iamnaii@MacBook-Pro-khxng-Akenarin.local>  
**Recommendation**: ✅ APPROVE

---

## Branch Summary

Implements PII Phase 5: decryption on reads + role-based masking + audit logging.  
8 files changed, 695 insertions, 41 deletions.

### Key commits
- `feat(pii): Phase 5a` — CustomersService reads from encrypted columns
- `feat(pii): Phase 5b` — role-based mask + audit log on CustomersController
- `feat(pii): Phase 5c` — TradeIn read decrypt + role-based mask + audit log
- `fix(lint)` — replace `require()` with import in spec files

### Files changed
| File | Change |
|------|--------|
| `customers.controller.ts` | Role-based PII masking + PiiAuditService injection |
| `customers.service.ts` | `decryptCustomerPII()` + hash-based dedup queries |
| `trade-in.controller.ts` | Role-based bank account masking + audit logging |
| `trade-in.service.ts` | `decryptTradeInPII()` on reads |
| `customers.controller.spec.ts` | NEW — 5 controller PII tests |
| `trade-in.controller.spec.ts` | NEW — 9 controller PII tests |
| `customers.service.spec.ts` | Phase 5 test additions (dedup now uses hash) |
| `trade-in.service.spec.ts` | Phase 5 decryption tests |

---

## Issues Found

### Critical — 0 issues

No critical issues found:
- ✅ `@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)` at class level on both controllers
- ✅ All endpoints have `@Roles()` decorators
- ✅ No `Number()` on money fields
- ✅ All Prisma queries retain `deletedAt: null` filter
- ✅ No hardcoded secrets or API keys
- ✅ No raw `$queryRaw` SQL

### Warning — 2 issues

**W-1: Fire-and-forget audit logging silently drops on DB failure**  
Location: `customers.controller.ts:212`, `trade-in.controller.ts:863`  
```typescript
void this.piiAudit.logDecryption({ ... });  // errors swallowed silently
```
If `PiiAuditService.logDecryption` throws (e.g., DB outage), the audit record is lost with no alert.  
Recommendation: wrap in `.catch((err) => this.logger.error('PII audit log failed', err))`.

**W-2: Optional `req` in `findAll` could skip masking if undefined**  
Location: `customers.controller.ts:198`, `trade-in.controller.ts:849`  
```typescript
@Req() req?: AuthRequest
const role = req?.user?.role || 'UNKNOWN';
```
If `req` is undefined, `role` becomes `'UNKNOWN'`, which skips masking for SALES users. In practice, `JwtAuthGuard` ensures `req.user` is always set, but the optional typing creates a false safe-path.  
Recommendation: make `req` non-optional, or add `if (!req?.user) throw new ForbiddenException()`.

### Info — 2 items

**I-1: Heavy use of `as unknown as Record<string, unknown>` in service**  
Driven by Prisma's generated types not yet including the new encrypted columns (pre-`prisma generate`). Acceptable during migration, but should be cleaned up after Phase 6 drops plaintext columns.

**I-2: Dedup query changed from `nationalId` to `nationalIdHash` unique lookup**  
`findUnique({ where: { nationalIdHash: nidHash } })` — requires a `@unique` constraint on `nationalIdHash` in the Prisma schema. Confirm the migration for Phase 2 added `@@unique([nationalIdHash])` or `@unique` on the field.

---

## Security Assessment

The masking matrix is correctly implemented:

| Role | nationalId | phone | transferAccountNumber |
|------|-----------|-------|----------------------|
| OWNER | ✅ Full | ✅ Full | ✅ Full |
| FINANCE_MANAGER | ✅ Full | ✅ Full | ✅ Full |
| ACCOUNTANT | ✅ Full | ✅ Full | ✅ Full |
| BRANCH_MANAGER | ✅ Full | ✅ Full | ⚠️ Masked |
| SALES | ⚠️ Masked | ✅ Full | ⚠️ Masked |

PII audit trail is logged for every read access. Fallback to legacy plaintext columns when encrypted is NULL ensures safe rolling deploy.

---

## Recommendation: ✅ APPROVE

Ship after addressing W-1 (audit error handling). W-2 is low risk given guard coverage.
