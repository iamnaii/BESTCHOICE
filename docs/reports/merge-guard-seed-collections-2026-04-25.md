# Merge Guard Report — chore/seed-collections-test-data

**Date**: 2026-04-25  
**Branch**: `chore/seed-collections-test-data`  
**Author**: Akenarin Kongdach  
**Latest commit**: `d4a4f44b` — chore(scripts): add one-off seed/cleanup for collections test data  
**Recommendation**: ✅ APPROVE (with notes)

---

## Summary of Changes

12 files changed, 487 insertions(+), 456 deletions(-).

The bulk of the diff (10 files / 456 deletions) is shared with the already-merged PR #696 (`fix/customer-intake-credit-check-cache`) — those changes are present in `origin/main` and represent **no new risk**. The two genuinely new files are one-off DevOps scripts:

| File | Lines | Purpose |
|------|-------|---------|
| `scripts/seed-collections-test-data.ts` | +273 | Seed 20 test customers + contracts + payments across 5 aging buckets |
| `scripts/cleanup-collections-test-data.ts` | +162 | Soft-delete the same test data when no longer needed |

---

## Issues by Severity

### Critical — 0 issues
No security, auth, or financial-integrity violations found.

### Warning — 2 issues

**W1 — No branch isolation in cleanup query**  
`scripts/cleanup-collections-test-data.ts:56` — `prisma.customer.findMany({ where: { legacyMemberCode: { startsWith: MARKER }, ... } })` queries across **all branches** in production. In a multi-branch deployment, a branch manager running `--commit` could soft-delete test customers that belong to a different branch. The 25-record blast guard limits blast radius, but explicit `branchId` scoping would be safer.

**W2 — Non-standard cross-package import in script**  
`scripts/seed-collections-test-data.ts:6-7`:
```ts
import { encryptPII } from '../apps/api/src/utils/crypto.util';
import { hashPII } from '../apps/api/src/utils/pii.util';
```
Scripts at repo root importing directly from `apps/api/src/` bypasses the monorepo boundary. Works today; breaks if `apps/api` moves or those utils change signatures without updating the script. Low risk for a one-off script, but worth noting.

### Info — 2 issues

**I1 — Decimal arithmetic is correct**  
All financial fields use `new Prisma.Decimal(...)` and `Prisma.Decimal.prototype.mul/div/add`. No `Number()` or `parseFloat` on money values. ✓

**I2 — `lateFee` omitted from Payment create — intentional**  
`lateFee` has `@default(0)` in schema (`schema.prisma:952`), so omitting it is safe and correct.

---

## Notes

- `deletedAt: null` guards are correct in both seed and cleanup queries.
- Idempotency guard (`existing > 0 → abort`) prevents double-seeding.
- PII encryption path validates key lengths ≥32 before writing on `--commit`.
- Dry-run mode (`no --commit`) is safe to run in production.
