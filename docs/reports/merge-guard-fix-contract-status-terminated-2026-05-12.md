# Merge Guard Report — fix/contract-status-terminated

**Date**: 2026-05-12  
**Branch**: `fix/contract-status-terminated`  
**Author**: Akenarin Kongdach  
**Last commit**: `7f54191c` — fix(termination): rename ContractStatus LEGAL → TERMINATED to match termination_policy.docx (2026-05-09)  
**Recommendation**: ✅ APPROVE

---

## File Changes Summary

| Metric | Value |
|--------|-------|
| Files changed | 19 |
| Insertions | +52 |
| Deletions | −36 |
| Unique commits ahead of main | 1 |

**Key areas touched:**
- `apps/api/prisma/migrations/20260909000000_rename_contract_status_legal_to_terminated/migration.sql` — atomic `ALTER TYPE ... RENAME VALUE 'LEGAL' TO 'TERMINATED'`
- `apps/api/prisma/schema.prisma` — enum value renamed
- `apps/api/src/modules/overdue/` — 7 service files: status filter strings updated
- `apps/api/src/modules/repossessions/repossessions.service.ts` — JP5 strict-mode guard updated
- `apps/web/src/pages/CollectionsPage/` — 3 frontend files: filter presets + UI labels updated

---

## Issues Found

### Critical — None

No new controllers introduced. No guard changes. No financial calculation changes.

---

### Warning

**W-1 — `as any` cast on enum string literals**

```ts
// queue.service.ts
status: { in: ['ACTIVE', 'OVERDUE', 'DEFAULT', 'TERMINATED'] as any }

// FilterDrawer.tsx
contractStatuses: ['DEFAULT', 'TERMINATED'] as any
```

The `as any` is required because `'TERMINATED'` was not in the Prisma-generated `ContractStatus` type at the time the branch was cut (before `prisma generate` runs the new migration). After `prisma migrate deploy` + `prisma generate` in CI, the type will be correct and `as any` can be removed in a follow-up. Not a blocking issue.

---

**W-2 — Enum rename affects any external consumers reading raw DB values**

`ALTER TYPE ... RENAME VALUE` is atomic and safe on Postgres 10+. All existing DB rows using `'LEGAL'` will automatically reflect `'TERMINATED'` after migration. The `system_config` UPDATE is idempotent (only updates if the old key exists). Risk: any external script, report, or integration that hard-codes `'LEGAL'` will break silently. Confirm no PEAK/Chatcone integrations reference `ContractStatus.LEGAL` directly.

---

### Info

**I-1 — All occurrences of `'LEGAL'` replaced**

The diff confirms every service file, spec file, and frontend constant that previously used `LEGAL` / `LEGAL_CASE` / `LegalCaseBanner` has been updated to `TERMINATED`. No stale references found.

**I-2 — Migration rationale is well-documented**

The migration SQL comment references `ปพพ.386 + termination_policy.docx` and explains that the mismatch caused the 2A cron filter and JP5 strict guard to bypass on terminated contracts — a compliance bug.

---

## Recommendation: ✅ APPROVE

This is a well-scoped, single-commit rename with a safe Postgres atomic migration. No security issues. No financial calculation changes. The only open question (W-2) is an external-integration check that should happen before production deployment, not a code blocker.

Post-merge: remove `as any` casts once `prisma generate` runs in CI and regenerates the enum type.
