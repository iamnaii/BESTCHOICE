# Merge Guard Report — fix/fraud-audit-p1-governance

**Date**: 2026-04-19  
**Branch**: `fix/fraud-audit-p1-governance`  
**Author**: Akenarin Kongdach  
**Commit**: `9a0d5824` — fix(fraud-audit): Phase 1 governance — audit log immutability + session revoke

---

## File Changes Summary

| File | +/- | Notes |
|------|-----|-------|
| `apps/api/prisma/migrations/20260520300000_audit_log_archive_immutable/migration.sql` | +31 (new) | `archived_at` column + DELETE trigger |
| `apps/api/prisma/schema.prisma` | +6 | `archivedAt` field on AuditLog |
| `apps/api/src/modules/notifications/scheduler.service.ts` | +25/-10 | hard-delete → soft-archive, 1yr → 7yr |
| `apps/api/src/modules/users/users.service.spec.ts` | +65 (new) | 4 tests for deactivation token revocation |
| `apps/api/src/modules/users/users.service.ts` | +25/-9 | Revoke refresh tokens on deactivation |

**Total**: 5 files changed, 142 insertions (+), 10 deletions (−)

---

## Issues Found

### Critical — None

### Warning — None

### Info

**1. Silently swallowed token-revocation error — `users.service.ts` ~line 178**

```typescript
try {
  await this.prisma.refreshToken.updateMany({ ... });
} catch {
  // Intentionally swallowed — tokens will also be rejected by the
  // isActive check in the auth guard, so this is defence-in-depth.
}
```

The comment correctly explains the defence-in-depth rationale. However, if the `refreshToken` table were to consistently fail (e.g., a schema mismatch in a deployment), the failure would be silent — no log entry, no Sentry event. Consider adding `this.logger.warn(...)` in the catch so ops can detect a persistent revocation failure. Not a security regression (the `isActive` guard is the primary control), but improves observability.

**2. DB DELETE trigger may interfere with `prisma migrate reset` in test environments**

The migration installs a `BEFORE DELETE` trigger on `audit_logs`. Running `prisma migrate reset` (used by `db-reset.sh` in dev) will attempt to truncate/drop the table, which issues a DELETE that the trigger will block. Workaround: the trigger only fires on `DELETE` statements, not on `DROP TABLE` or `TRUNCATE`, so `migrate reset` which uses `DROP SCHEMA ... CASCADE` is unaffected. ✓  
However, any test suite that directly calls `prisma.auditLog.deleteMany(...)` in test teardown (e.g., to clean up fixtures) will fail. Audit whether any test helpers do this.

**3. `scheduler.service.ts` — variable rename only (minor)**  
`auditLogsCleared` renamed to `auditLogsArchived`. Log message updated consistently. ✓ No dead variable.

---

## Detailed Findings

### Audit Log Immutability (T2-C4)
Changes the retention policy correctly:
- Hard delete → `updateMany({ data: { archivedAt: now } })` ✓
- 1-year → 7-year retention (Thai Revenue Code / financial industry standard) ✓
- DB trigger (`BEFORE DELETE`) rejects all DELETE attempts on `audit_logs` at the DB level ✓
- `archived_at` column nullable — no backfill required for existing rows ✓
- New index on `archived_at` to support the `WHERE archivedAt IS NULL` filter in the cron ✓
- Prisma schema updated to match (`archivedAt DateTime? @map("archived_at")`) ✓

### Session Revocation on Deactivation (T7-C7)
Logic is correct:
```
active → inactive  : revoke all live refresh tokens  ✓
inactive → inactive: no-op (tokens already invalid)  ✓
inactive → active  : no revocation (reactivation)    ✓
unrelated update   : no token touch                  ✓
```
The `isNowBeingDeactivated` flag is evaluated before the `user.update` call, from the pre-update snapshot. ✓  
Token revocation runs **after** the user update succeeds — so a DB failure on the user update rolls back cleanly (no orphaned revocation). ✓  
Best-effort try/catch is appropriate because the `isActive` guard in the auth middleware is the primary control. ✓

### Tests
`users.service.spec.ts` covers all 4 transition paths with clear assertions. ✓

---

## Recommendation

**APPROVE**

No critical or warning issues. Both changes (audit log immutability + session revocation) are well-implemented with appropriate tests. Address Info #1 (add a warn log inside the token-revocation catch) as a follow-up — it does not block this merge.
