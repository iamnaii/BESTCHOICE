# Pre-Merge Guard Report — fix/contract-status-terminated

**Date**: 2026-05-09  
**Branch**: `fix/contract-status-terminated`  
**Author**: Akenarin Kongdach  
**Recommendation**: ✅ APPROVE

---

## Summary

Renames the `ContractStatus` enum value `LEGAL` → `TERMINATED` across the entire codebase to align with `termination_policy.docx` (the canonical CPA document). The mismatch between the DB enum value and the policy document caused the 2A cron filter and JP5 strict guard to bypass validation on contracts that were legally terminated, violating ป.พ.พ. 386 ข้อ 2(6).

## File Changes (19 files, +52 / −36)

| Area | Files | Change |
|------|-------|--------|
| API — service layer | repossessions.service.ts, contract-letter.service.ts, auto-balance.service.ts, queue.service.ts, stuck-contracts.service.ts, contract-snapshot.cron.ts, analytics-aging.service.ts, analytics-leaderboard.service.ts | LEGAL → TERMINATED in status filters |
| API — CLI / cron | backfill-installment-schedules.cli.ts, installment-accrual.cron.ts | Status constant renamed |
| API — specs | auto-balance.service.spec.ts, contract-letter.service.spec.ts, queue.service.spec.ts, repossessions.service.spec.ts | Test assertions updated |
| Prisma migration | 20260909000000_rename_contract_status_legal_to_terminated/migration.sql | ALTER TYPE RENAME VALUE + SystemConfig key rename |
| Frontend | FilterDrawer.tsx, LegalCaseBanner.tsx, systemPresets.ts | Display values updated |

## Issues Found

### Critical
_None._

### Warning
_None._

### Info

1. **Stale comment in `auto-balance.service.ts:192`**  
   The code correctly checks `c.status === 'TERMINATED'` but the comment above still reads:  
   ```
   // Order matters: each contract counted once. LEGAL is sticky regardless
   ```  
   The word "LEGAL" in the comment is now misleading. Low risk (code is correct), but should be updated for clarity.

## Migration Assessment

The migration uses:
```sql
ALTER TYPE "ContractStatus" RENAME VALUE 'LEGAL' TO 'TERMINATED';
```
This is the correct Postgres-native approach — atomic, preserves all existing rows automatically, and requires no data backfill. Available on PostgreSQL 10+.

The SystemConfig key rename is also idempotent:
```sql
UPDATE "system_config" SET "key" = 'jp5_require_terminated_status'
WHERE "key" = 'jp5_require_legal_status';
```

## Recommendation

**APPROVE.** The rename is complete and consistent across all 19 files. The migration is correct. The only finding is a stale comment (word "LEGAL" in a code comment at `auto-balance.service.ts:192`) — cosmetic, not blocking.
