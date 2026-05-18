# Pre-Merge Guard Report

**Branch**: `feat/p3-sp2-offsite-backup`  
**Author**: Akenarin Kongdach <akenarin.ak@gmail.com>  
**Date**: 2026-05-18  
**Reviewer**: Pre-Merge Guard (automated)

---

## File Changes Summary

| File | Lines Added |
|------|-------------|
| `apps/api/src/modules/backup/backup.controller.ts` | +104 (new) |
| `apps/api/src/modules/backup/backup.module.ts` | +23 (new) |
| `apps/api/src/modules/backup/offsite-backup.service.ts` | +614 (new) |
| `apps/api/src/modules/backup/offsite-backup.cron.ts` | +74 (new) |
| `apps/api/src/modules/backup/offsite-backup-retention.cron.ts` | +54 (new) |
| `apps/api/src/modules/backup/dto/toggle-offsite-backup.dto.ts` | +6 (new) |
| `apps/api/src/modules/backup/backup.controller.spec.ts` | +136 (new) |
| `apps/api/src/modules/backup/offsite-backup.service.spec.ts` | +537 (new) |
| `apps/api/src/modules/backup/offsite-backup-retention.cron.spec.ts` | +42 (new) |
| `apps/web/src/pages/SettingsPage/tabs/OffsiteBackupTab.tsx` | +284 (new) |
| `apps/web/src/pages/SettingsPage/tabs/__tests__/OffsiteBackupTab.test.tsx` | +234 (new) |
| `apps/api/src/app.module.ts` | +4 modified |
| `apps/web/src/pages/SettingsPage/index.tsx` | +7 modified |
| `apps/api/prisma/schema.prisma` | +49 modified |
| `docs/guides/OFFSITE-BACKUP.md` | +379 (new) |
| `.env.example` | +15 modified |
| `Dockerfile` | +21 modified |
| 2 migrations | +90 (new) |

**Total**: 19 files changed, 2664 insertions, 9 deletions

---

## Issues by Severity

### Critical (must fix before merge)
_No critical issues found._

### Warning (should fix)
_No warning issues found._

### Info (low priority)
1. **`Number(totalBytes)` on BigInt** — `offsite-backup.service.ts:1396, 1602`  
   `totalBytes` is accumulated as a BigInt (`0n`) in the service and stored as `BigInt` in the DB (`OffsiteBackupRun.totalBytes`). Before returning it in the API response, `Number(totalBytes)` is called to convert to a JavaScript number.  
   This is safe for all realistic backup sizes — loss of precision only occurs above ~9 petabytes. An alternative is to return it as a string (`totalBytes.toString()`), but since this is a display/informational field (not a money amount), the current approach is acceptable. No action required.

2. **`$queryRaw` usage** — `offsite-backup.service.ts:193, 210`  
   Uses Prisma tagged template literals (`$queryRaw\`SELECT pg_try_advisory_lock(hashtext(${CONST}))\``) for PostgreSQL advisory locking. The parameter `OffsiteBackupService.ADVISORY_LOCK_KEY` is a static class constant — no user input flows into the query. This is safe.

---

## Positive Findings

- `@UseGuards(JwtAuthGuard, RolesGuard)` correctly applied at class level on `BackupController`
- `@Roles()` on all 3 endpoints: `POST /backup/offsite-now` (OWNER), `GET /backup/offsite-status` (OWNER/FM/ACC), `PUT /backup/offsite-enabled` (OWNER)
- W7 security: `destBucket` and `sqlSourceBucket` masked for non-OWNER callers in `getStatus()`
- Advisory lock (`pg_try_advisory_lock`) prevents concurrent backup runs — idempotency pattern correctly implemented
- C2 audit log emitted on `POST /backup/offsite-now` capturing who triggered manual run
- `deletedAt: null` on all DB queries (including the SystemConfig upsert revival pattern)
- Frontend uses `api.get/post/put` ✅, `invalidateQueries` ✅
- DTO has class-validator decorators
- Tests cover: concurrent-lock rejection, enabled/disabled toggle state, BigInt→Number conversion, S3 upload/download, retention cron
- `OFFSITE_BACKUP_ENABLED` feature flag allows safe rollout without disabling the service on existing deployments

---

## Recommendation: **APPROVE**

No blocking issues. Security model is correct (OWNER-gated mutations, FM/ACC read-only access with infrastructure detail masking). The advisory-lock concurrency guard prevents double-run. Test coverage is thorough.
