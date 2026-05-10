# Merge Guard Report — `fix/contract-status-terminated`

**Date**: 2026-05-10  
**Branch**: `fix/contract-status-terminated`  
**Author**: Akenarin Kongdach (iamnaii@gmail.com)  
**Commits ahead of main**: 14  
**Recommendation**: ✅ APPROVE

---

## File Changes Summary

19 files changed, 52 insertions(+), 36 deletions(−)

This branch is a clean enum rename: `ContractStatus.LEGAL` → `ContractStatus.TERMINATED`  
and the corresponding SystemConfig key `jp5_require_legal_status` → `jp5_require_terminated_status`.

Files changed:
- `apps/api/prisma/schema.prisma` — enum value renamed
- `apps/api/prisma/migrations/20260909000000_rename_contract_status_legal_to_terminated/migration.sql` — migration
- `apps/api/src/modules/journal/cron/installment-accrual.cron.ts` — filter updated
- `apps/api/src/modules/overdue/auto-balance.service.ts` + spec
- `apps/api/src/modules/overdue/analytics-aging.service.ts`
- `apps/api/src/modules/overdue/analytics-leaderboard.service.ts`
- `apps/api/src/modules/overdue/contract-letter.service.ts` + spec
- `apps/api/src/modules/overdue/contract-snapshot.cron.ts`
- `apps/api/src/modules/overdue/queue.service.ts` + spec
- `apps/api/src/modules/overdue/stuck-contracts.service.ts`
- `apps/api/src/modules/repossessions/repossessions.service.ts` + spec
- `apps/api/src/cli/backfill-installment-schedules.cli.ts`
- `apps/web/src/pages/CollectionsPage/components/FilterDrawer.tsx`
- `apps/web/src/pages/CollectionsPage/components/LegalCaseBanner.tsx`
- `apps/web/src/pages/CollectionsPage/constants/systemPresets.ts`

---

## Issues

### Critical — None

### Warning — None

### Info — None

---

## Security Checklist

| Concern | Status |
|---------|--------|
| New controller without guards | No new controllers |
| Missing `@Roles` | No new methods |
| `Number()` on financial field | No financial changes |
| Missing `deletedAt: null` | No new queries |
| Hardcoded secret | None |
| Unparameterized SQL | None |

---

## Migration Safety

| Aspect | Assessment |
|--------|-----------|
| Migration type | `ALTER TYPE ... RENAME VALUE` — atomic, zero-downtime on Postgres 10+ |
| Existing rows | Automatically reflect new enum name (no row update needed) |
| SystemConfig key rename | `UPDATE ... WHERE key = 'jp5_require_legal_status'` — idempotent |
| No `LEGAL` string remaining in new code | ✅ Verified — all references replaced |
| All test mocks updated | ✅ Verified |
| Backfill CLI updated | ✅ `status: { in: [..., 'TERMINATED'] }` |

---

## Recommendation

**APPROVE** — Clean, mechanical rename with correct migration strategy. No security, financial, or logic concerns. Safe to merge.
