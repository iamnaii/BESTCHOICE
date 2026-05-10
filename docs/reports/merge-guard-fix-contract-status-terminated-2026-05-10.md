# Merge Guard Report — fix/contract-status-terminated

**Date**: 2026-05-10  
**Author**: Akenarin Kongdach  
**Recommendation**: ✅ APPROVE (one stale-comment cleanup recommended)

---

## Branch Summary

Renames the `ContractStatus` enum value `LEGAL` → `TERMINATED` across the entire codebase to align with the CPA-provided `termination_policy.docx`. The mismatch caused the 2A accrual cron filter and JP5 strict guard to incorrectly bypass legally-terminated contracts (ป.พ.พ. 386).

**Migration strategy**: Uses Postgres `ALTER TYPE ... RENAME VALUE` — atomic, preserves all existing rows, no data migration needed. Also renames the `SystemConfig` key `jp5_require_legal_status` → `jp5_require_terminated_status`.

## File Changes (19 files, +52 / -36)

Predominantly mechanical string substitutions across:
- Cron/service files in `overdue/` module
- `repossessions.service.ts`
- Frontend `FilterDrawer.tsx`, `LegalCaseBanner.tsx`, `systemPresets.ts`
- Schema + migration

---

## Issues Found

### Critical
_None._

### Warning
_None._

### Info

**I1 — Stale inline comments in `auto-balance.service.ts`**  
The code logic was correctly updated (`'LEGAL'` → `'TERMINATED'`), but 5 inline comments still reference the old name:

```
Line 11:  status = LEGAL — already handed to legal team, do not move
Line 17:  LEGAL > snooze > recent
Line 18:  ("rebalance N (ยกเว้น snooze X / LEGAL Y /
Line 109: into LEGAL > snooze-protected > recently-assigned > eligible.
Line 193: // Order matters: each contract counted once. LEGAL is sticky
```

These are non-functional but will confuse future readers. Recommend updating in this PR or immediately after merge.

---

## Security Checks

| Check | Result |
|-------|--------|
| No new controllers added | N/A |
| `deletedAt: null` in all modified queries | ✅ |
| No hardcoded secrets | ✅ |
| Raw SQL in `analytics-aging.service.ts` and `stuck-contracts.service.ts` | ✅ Uses `$1` parameterized placeholder — not an injection risk |
| Migration uses `ALTER TYPE` (DDL, no user input) | ✅ |
| `SystemConfig` key rename is idempotent (`WHERE key = 'jp5_require_legal_status'`) | ✅ |

---

## Recommendation

**APPROVE** — the change is safe, well-scoped, and the migration approach (enum rename) is correct for Postgres. The only finding is stale comments (I1) which are cosmetic. Merge when ready and clean up the comments in a follow-up commit or directly in this PR.
