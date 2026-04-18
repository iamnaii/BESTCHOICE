# Merge Guard Report — feat/defect-exchange-7day

**Date**: 2026-04-18
**Branch**: `feat/defect-exchange-7day`
**Author**: Akenarin Kongdach
**Commits**: 1 (`e8ac4c50`)

## File Changes Summary

| Category | Files | +Lines | -Lines |
|----------|-------|--------|--------|
| New API module | 4 | ~400 | 0 |
| contracts.service/controller/dto | 3 | ~60 | ~15 |
| customers.service | 1 | ~20 | ~5 |
| Prisma schema + migration | 2 | ~20 | 0 |
| Frontend (App.tsx, menu, ContractCreatePage, DefectExchangePage) | 8 | ~405 | ~5 |
| **Total** | **18** | **905** | **24** |

---

## Issues Found

### ⚠️ Warning (2)

**W-001** — `Number()` used on Decimal money field in filter
- **File**: `apps/api/src/modules/defect-exchange/defect-exchange.service.ts` (line ~154)
- **Code**: `.filter((p) => p.status === 'PAID' || Number(p.amountPaid) > 0)`
- **Rule**: No `Number()` on money/financial fields — use `Prisma.Decimal` arithmetic
- **Fix**: Replace with `new Decimal(p.amountPaid).greaterThan(new Decimal(0))`

**W-002** — Missing `deletedAt: null` on payments include inside `execute()` transaction
- **File**: `apps/api/src/modules/defect-exchange/defect-exchange.service.ts` (inside `execute()`)
- **Code**: `include: { product: true, payments: true }` — no `where: { deletedAt: null }` on payments
- **Note**: The outer `checkEligibility()` call (same service) uses `{ where: { deletedAt: null } }` correctly on payments, but the re-fetch inside `$transaction` does not. Soft-deleted payments would be included in the credit-transfer sum.
- **Fix**: Change to `include: { product: true, payments: { where: { deletedAt: null } } }`

### ℹ️ Info (2)

**I-001** — `paidInstallments.toNumber()` in response JSON and Prisma `creditBalance` update
- Decimal → number for JSON serialization is acceptable; `creditBalance` is a `Decimal` field but Prisma accepts `number` input. Not a precision risk at 2 d.p. with 32-bit float range.

**I-002** — New `DEFECT_EXCHANGED` contract status and `DEFECT_RETURN` product status added without corresponding frontend label mappings in `ContractStatusBadge` / `ProductStatusBadge`
- UI may show raw enum string for new statuses until badge components are updated.

---

## Positive Findings ✅

- Controller fully guarded: `@UseGuards(JwtAuthGuard, RolesGuard)` on class ✓
- All 3 endpoints have `@Roles()` decorators ✓
- DTO has Thai validation messages ✓
- Atomic `$transaction` with `isolationLevel: 'Serializable'` for exchange operation ✓
- Journal reversal correctly applied on both CONTRACT and CONTRACT_COGS entries ✓
- AuditLog entry created with all context (old/new contract, product IDs, defect reason, photo URLs) ✓
- Prisma schema: `parentContractId`, `creditBalance`, `deviceReceivedAt` fields all declared correctly with `@db.Decimal(12,2)` ✓
- Frontend page uses `useQuery`/`useMutation` + `queryClient.invalidateQueries()` ✓
- Frontend protected route configured for `['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES']` ✓

---

## Recommendation

**REVIEW** — Fix W-001 and W-002 before merge. Both are small, targeted changes. Feature logic is sound.

### Required fixes
```typescript
// W-001: defect-exchange.service.ts ~line 154
// Before:
.filter((p) => p.status === 'PAID' || Number(p.amountPaid) > 0)
// After:
.filter((p) => p.status === 'PAID' || new Decimal(p.amountPaid).greaterThan(0))

// W-002: defect-exchange.service.ts execute() → findUnique include
// Before:
include: { product: true, payments: true }
// After:
include: { product: true, payments: { where: { deletedAt: null } } }
```
