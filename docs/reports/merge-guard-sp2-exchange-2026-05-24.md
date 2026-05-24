# Pre-Merge Guard Report — SP2 Same-Price Exchange

**Date**: 2026-05-24  
**Reviewer**: Pre-Merge Guard (automated)  
**Branches reviewed**: 3 of 604 unmerged (most recently pushed)

---

## Branches Reviewed

| Branch | Last Push | Author | Files Changed |
|--------|-----------|--------|---------------|
| `feat/sp2-same-price-exchange` | 2026-05-24 11:56 +07 | Akenarin Kongdach | +23 files, +1972 / -8 |
| `fix/sp2-blockers` | 2026-05-24 13:39 +07 | Akenarin Kongdach | +3 files, +132 / -25 |
| `fix/sp2-deferred-blockers` | 2026-05-24 14:32 +07 | Akenarin Kongdach | +7 files, +675 / -36 |

---

## Branch 1: `feat/sp2-same-price-exchange`

**Recommendation: REVIEW** — 4 warnings before merge

### File Changes Summary

- **API new**: `modules/contract-exchange/` (controller, service, module, 2 DTOs)
- **API new**: 3 JE templates (`exchange-new-contract-1a`, `exchange-close-old-21-1106`, `exchange-clear-vendor-21-1106`)
- **API new**: 6 unit-test files for service + templates
- **Schema**: `ContractExchangeRequest` model, `ExchangeRequestStatus` enum, Contract self-relation
- **Frontend new**: `ExchangeRequestForm.tsx`, `ExchangeRequestsPage.tsx`
- **Routes**: wired into `App.tsx` + `menu.ts`
- **E2E**: `exchange-request-flow.spec.ts`

### Issues

#### ⚠️ Warning W1 — FINANCE_MANAGER excluded from management endpoints

**File**: `apps/api/src/modules/contract-exchange/contract-exchange.controller.ts:22-39`

```ts
@Get('pending')
@Roles('OWNER')              // ← FINANCE_MANAGER missing

@Post(':id/approve')
@Roles('OWNER')              // ← FINANCE_MANAGER missing

@Post(':id/reject')
@Roles('OWNER')              // ← FINANCE_MANAGER missing
```

The comparable `defect-exchange.controller.ts` uses `@Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER')` on its management endpoints. FINANCE_MANAGER oversees the financing side of contracts and would reasonably need to approve same-price exchanges. This inconsistency is likely an oversight.

**Fix**: Add `'FINANCE_MANAGER'` to all three decorators, or document explicitly why it's OWNER-only with a code comment.

---

#### ⚠️ Warning W2 — Hardcoded 10% fallback commission in JE template

**File**: `apps/api/src/modules/journal/cpa-templates/exchange-new-contract-1a.template.ts:62-66`

```ts
const commission =
  c.storeCommission != null
    ? new Decimal(c.storeCommission.toString())
    : financed.times('0.10').toDecimalPlaces(2);  // ← silent wrong value
```

`storeCommission` is nullable on the `Contract` model. When it is null, the template silently uses 10% of `financedAmount` as a fallback. In production this will produce a wrong JE: `21-1102 (เจ้าหนี้ค่าคอม)` will be overstated, breaking the SHOP–FINANCE settlement. The template should throw `InternalServerErrorException` when `storeCommission` is null on an exchange contract — any contract reaching this point must have had commission set at activation.

**Fix**:
```ts
if (c.storeCommission == null) {
  throw new InternalServerErrorException(
    `exchange-new-contract-1a: contract ${newContractId} has null storeCommission`
  );
}
const commission = new Decimal(c.storeCommission.toString());
```

---

#### ⚠️ Warning W3 — `approvedById` semantically overloaded for rejections

**File**: `apps/api/src/modules/contract-exchange/contract-exchange.service.ts:250-259`

```ts
// In reject():
data: {
  status: 'REJECTED',
  rejectionReason: reason,
  approvedById: userId,    // ← stored in the "approved" field on a rejection
  approvedAt: new Date(),  // ← same
}
```

The schema has no `rejectedById` / `rejectedAt` fields — the service stores the rejector's identity in `approvedById`. This creates a confusing audit trail: querying `WHERE approvedById IS NOT NULL` will also surface rejected requests. Future reports and PEAK exports are likely to misread these records.

**Fix options**:
1. Add `rejectedById String?` + `rejectedAt DateTime?` to the schema (preferred, 1 migration)
2. Rename `approvedById` → `resolvedById` to reflect dual use (breaking rename, 1 migration)
3. Keep current but add a `@@index([status])` and document the dual-use with a schema comment

---

#### ⚠️ Warning W4 — Missing `queryClient.invalidateQueries()` after submit mutation

**File**: `apps/web/src/pages/insurance/ExchangeRequestForm.tsx:88-92`

```ts
onSuccess: () => {
  toast.success('ส่งคำขอเปลี่ยนเครื่องสำเร็จ — รออนุมัติ');
  navigate('/insurance');
  // ← missing: queryClient.invalidateQueries({ queryKey: ['exchange-requests-pending'] })
},
```

The form navigates away on success but doesn't invalidate the pending-request cache. If the OWNER's browser has a cached `exchange-requests-pending` query, the newly submitted request won't appear until the query TTL expires. `ExchangeRequestsPage.tsx` correctly invalidates this key in its approve/reject `onSuccess` handlers — the form should do the same.

**Fix**: Add `useQueryClient()` and call `queryClient.invalidateQueries({ queryKey: ['exchange-requests-pending'] })` in `onSuccess`.

---

#### ℹ️ Info I1 — `listPending()` return type is `any[]`

**File**: `apps/api/src/modules/contract-exchange/contract-exchange.service.ts`

```ts
async listPending(): Promise<any[]> {
```

Should return a typed interface or `Prisma.ContractExchangeRequestGetPayload<{include: ...}>[]`.

---

#### ℹ️ Info I2 — E2E test depends on seed data not in this PR

**File**: `apps/web/e2e/exchange-request-flow.spec.ts:18-19`

```ts
await salesPage.goto('/insurance/exchange-request/new?contractId=sp1-ctr-used');
test.skip(opts < 2, 'no seed replacement available — run seed-sp1-used-exchange.sql first');
```

The referenced `seed-sp1-used-exchange.sql` is not included in this PR. The E2E test will auto-skip in CI, making it a no-op. The seed file should be added, or the test should use an existing seeded contract ID.

---

## Branch 2: `fix/sp2-blockers`

**Recommendation: APPROVE**

### File Changes Summary

- `contract-exchange.controller.ts` — passes `req.user` (full user object) instead of `req.user.id` to `submit()`
- `contract-exchange.service.ts` — adds `ForbiddenException` for cross-branch SALES, null-price guard (throws instead of silently using `0`), `downPayment: new Decimal(0)` on new contract
- `contract-exchange.service.spec.ts` — 6 new tests covering the 3 fixes

### Security / Correctness Check

| Check | Result |
|-------|--------|
| Guards on controller | ✅ `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles` on all methods |
| Money fields use Decimal | ✅ All new Decimal operations correct |
| Branch scoping | ✅ `hasCrossBranchAccess(user)` + `ForbiddenException` |
| Soft-delete guards | ✅ `deletedAt: null` in existing queries |
| Raw SQL / secret exposure | ✅ None |

No issues found.

---

## Branch 3: `fix/sp2-deferred-blockers`

**Recommendation: APPROVE**

### File Changes Summary

- `contract-exchange.service.ts` — replaces straight-line proration with real-ledger aggregation (`computeOldOutstanding`), adds `EXCH-YYYYMMDD-NNNN` contract numbering with advisory lock, adds SHOP re-intake JE (step A.4), flips `ownedByCompanyId` back to SHOP companyId
- `contract-exchange.module.ts` — adds `ShopExchangeReturnTemplate` + `CompanyResolverService`
- `shop-exchange-return.template.ts` — new SHOP-side JE: `Dr S11-2002 / Cr S50-1102`
- `shop-exchange-return.template.spec.ts` — 6 unit tests
- `contract-exchange.service.spec.ts` — +243 lines of tests covering all 4 fixes
- `schema.prisma` — adds `je4Id` to `ContractExchangeRequest`
- Migration — adds `je_4_id` column

### Security / Correctness Check

| Check | Result |
|-------|--------|
| Advisory lock key collision risk | ✅ `hashLockKey` uses polynomial hash; same pattern as `RepairTicketDocNumberService` |
| Contract number parsing `split('-')[2]` | ✅ `'EXCH-20260524-0001'.split('-')` = `['EXCH', '20260524', '0001']` — index 2 correct |
| `computeOldOutstanding` — negative outstanding risk | ✅ Returns `Decimal.toDecimalPlaces(2)`; zeroes when no lines |
| `ShopExchangeReturnTemplate` — SHOP companyId via `CompanyResolverService` | ✅ No hardcoded companyId |
| Idempotency key format | ✅ `${oldProductId}:${oldContractId}` unique per device per contract |
| costPrice null guard | ✅ Throws `InternalServerErrorException` if null |
| Decimal precision | ✅ No `Number()` used on money fields |

No issues found.

---

## Summary

| Branch | Recommendation | Critical | Warning | Info |
|--------|---------------|----------|---------|------|
| `feat/sp2-same-price-exchange` | **REVIEW** | 0 | 4 | 2 |
| `fix/sp2-blockers` | **APPROVE** | 0 | 0 | 0 |
| `fix/sp2-deferred-blockers` | **APPROVE** | 0 | 0 | 0 |

**Merge order** (when warnings resolved):
1. `feat/sp2-same-price-exchange` — fix W1 (FINANCE_MANAGER role), W2 (hardcoded 10% commission), W3 (approvedById naming), W4 (cache invalidation)
2. `fix/sp2-blockers` → ready to merge after (1) is merged or rebased
3. `fix/sp2-deferred-blockers` → ready to merge after (2)
