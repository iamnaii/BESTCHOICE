# Merge Guard Report — feat/pii-encryption-phase2-schema

**Date**: 2026-04-20  
**Branch**: `feat/pii-encryption-phase2-schema`  
**Author**: Akenarin Kongdach  
**Commits**: 1 (`707785be feat(pii): Phase 2 — schema migration adds nullable encrypted + hash columns`)  
**Recommendation**: ✅ APPROVE

---

## File Changes Summary

| File | +/- | Purpose |
|------|-----|---------|
| `apps/api/prisma/schema.prisma` | +23 | Nullable encrypted/hash columns on `Customer` and `TradeIn` |
| `apps/api/prisma/migrations/20260528400000_add_pii_encrypted_columns/migration.sql` | +32 | Additive SQL migration — only ADD COLUMN, no DROP |

---

## Issues

### 🔴 Critical

None.

### ⚠️ Warning

None.

### ℹ️ Info

#### I1 — Migration timestamp is in the future (2026-05-28 vs today 2026-04-20)

**File**: `apps/api/prisma/migrations/20260528400000_add_pii_encrypted_columns/migration.sql`

The migration folder is named `20260528400000_...` (May 28). Prisma uses the migration timestamp for ordering and tracking. Since this will be the next migration deployed, it must sort after the latest existing migration. This is safe as long as no migration with a later timestamp already exists. Worth verifying before deploy:
```bash
ls apps/api/prisma/migrations | sort | tail -3
```

#### I2 — Phase 3 dual-write not included (by design)

No service/application code changes. All new columns are nullable and will remain NULL until Phase 3 (dual-write). This is correct for a phased migration strategy — additive schema change with zero application-layer risk.

#### I3 — `nationalIdHash` UNIQUE vs `phoneHash` non-unique is correct

`nationalIdHash` carries `@unique` (one NID per person). `phoneHash` is non-unique with `@@index([phoneHash])` — correct because household phones may be shared across customer records.

#### I4 — Migration is purely additive

All statements are `ADD COLUMN ... TEXT` / `ADD COLUMN ... JSONB` with no `NOT NULL` constraints. No existing columns modified, no DROP statements. Zero-downtime safe.

---

## Verdict

**✅ APPROVE** — Clean additive schema migration. Migration file is present and consistent with the schema changes. All new columns are nullable, migration is zero-downtime safe, and the phased approach (schema now, dual-write in Phase 3) is sound. Verify migration timestamp ordering before deploy (I1).
