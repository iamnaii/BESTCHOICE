# Merge Guard Report — `chore/seed-collections-test-data`

**Date**: 2026-04-25  
**Reviewer**: Pre-Merge Guard Agent  
**Branch**: `chore/seed-collections-test-data`  
**Author**: iamnaii (Akenarin Kongdach)  
**Latest Commit**: `d4a4f44b` — `chore(scripts): add one-off seed/cleanup for collections test data`  
**Committed**: 2026-04-25 15:43:31 +0700

---

## Context

All other candidates found during this session (`fix/liff-pay-use-link-amount`, `fix/payment-link-base-url-fallback`, `fix/liff-skip-non-endpoint-routes`, `fix/verification-spec-mock`, etc.) were confirmed as already squash-merged into `main` via PRs #675–#677 and others. Their branches remain but carry 0 unique TypeScript diff against `main`. `chore/seed-collections-test-data` is the sole branch with genuinely new unreviewed content.

---

## File Changes Summary

```
scripts/seed-collections-test-data.ts      | 273 ++++++++++++++++++++++++++++++
scripts/cleanup-collections-test-data.ts   | 162 ++++++++++++++++++++++++
2 files changed, 435 insertions(+)
```

Both files are one-off admin **scripts** (run via `npx tsx`), not NestJS modules. They are not exposed as HTTP endpoints.

---

## Branch Purpose

Adds two companion scripts for testing the `/collections` page on production:

- **`seed-collections-test-data.ts`** — creates 20 test customers + 20 contracts + 240 payments (12 installments × 20), spread across 5 overdue aging buckets (current / 1-30d / 31-60d / 61-90d / 90+d). All records are marker-tagged (`__SEED_2026_04_25__`) for safe cleanup.
- **`cleanup-collections-test-data.ts`** — soft-deletes only marker-matched records; scrambles `nationalId` and `phone` unique constraints so re-seeding is possible without constraint violations.

---

## Critical Issues

None.

---

## Warnings

### W1 — Missing `deletedAt: null` on OWNER fallback query

**File**: `scripts/seed-collections-test-data.ts` (~line 175)

```typescript
const salesperson =
  (await prisma.user.findFirst({ where: { branchId: branch.id, role: 'SALES', deletedAt: null } })) ||
  (await prisma.user.findFirst({ where: { role: 'SALES', deletedAt: null } })) ||
  (await prisma.user.findFirst({ where: { role: 'OWNER' } }));  // ← missing deletedAt: null
```

The third fallback `{ role: 'OWNER' }` omits the soft-delete guard required by `database.md`. A deleted `OWNER` account could be assigned as salesperson on the seeded contracts. Low risk in practice (OWNER accounts are rarely soft-deleted) but inconsistent with project rules.

**Fix**:
```typescript
  (await prisma.user.findFirst({ where: { role: 'OWNER', deletedAt: null } }));
```

---

## Info

### I1 — Script imports from API internals

```typescript
import { encryptPII } from '../apps/api/src/utils/crypto.util';
import { hashPII } from '../apps/api/src/utils/pii.util';
```

These cross the package boundary, which is expected for a one-off dev script. The script itself guards against missing PII keys and skips encryption in dev mode — consistent with how `customers.service.ts` handles the same scenario.

### I2 — `MAX_DELETE_LIMIT = 25` anti-blast guard

Cleanup aborts if more than 25 marker-matched records exist. Good defensive design for a one-off script that targets production.

### I3 — Idempotency guard present

Seed script checks for existing active marker-tagged customers before creating and exits early — prevents double-seeding if accidentally run twice.

---

## Positive Observations

| Check | Result |
|-------|--------|
| Controller JwtAuthGuard | N/A — no new controllers |
| `Number()` on money fields | ✅ Uses `new Prisma.Decimal(...)` throughout |
| `deletedAt: null` on queries | ✅ Mostly correct (W1 above is the sole exception) |
| Hardcoded secrets/API keys | ✅ None |
| SQL injection (`$queryRaw`) | ✅ None — uses Prisma ORM only |
| PII encryption handling | ✅ Keys validated; dev-mode graceful skip |
| Soft-delete (no hard delete) | ✅ Both scripts use `update({ data: { deletedAt: now } })` |
| Cleanup companion script | ✅ Provided |
| Dry-run mode | ✅ Default mode; `--commit` required to write DB |

---

## Recommendation: ✅ APPROVE

No blocking issues. The single warning (W1 — missing `deletedAt: null` on OWNER fallback) is low-risk for a dev script but should be fixed before merging for consistency with project rules.

The scripts are well-designed for a one-off: dry-run default, idempotency guard, marker-based tracking, blast-radius cap (25 records), and a companion cleanup script. Safe to merge after W1 fix.
