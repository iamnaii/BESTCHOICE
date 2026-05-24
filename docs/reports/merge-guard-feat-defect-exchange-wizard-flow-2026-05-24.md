# Pre-Merge Guard Report

**Branch:** `feat/defect-exchange-wizard-flow`
**Author:** Akenarin Kongdach <iamnaii@MacBook-Pro-khxng-Akenarin.local>
**Reviewed:** 2026-05-24
**Commits:** 3 (wizard refactor + seed + docs)
**Recommendation:** 🟡 **REVIEW — 1 Warning, otherwise low risk**

---

## File Changes Summary

| File | Lines Changed | Notes |
|------|--------------|-------|
| `apps/web/src/pages/DefectExchangePage.tsx` | +211 / -149 | Full refactor to 3-step wizard |
| `apps/api/src/cli/seed-sp1-used-exchange.sql` | +73 | Dev seed data — not production code |
| `apps/web/package.json` | +1 / -1 | Version bump |

No backend service/controller changes. Frontend-only refactor.

---

## Issues

### ⚠️ Warning

#### W1 — Seed SQL file references hardcoded branch/supplier IDs that may not exist in all dev environments
**File:** `apps/api/src/cli/seed-sp1-used-exchange.sql`

The SQL seed uses hardcoded foreign key values (`'sup-001'`, `'branch-002'`) that are assumed to be in the database from the main seed. If a developer runs this on a fresh DB without the base seed, it will fail with FK constraint violations. The file documents the precondition (`psql ... -f /tmp/seed-sp1-used-exchange.sql`) but doesn't validate it.

This is a developer-experience issue, not a production risk — the file is under `src/cli/` not `prisma/migrations/`.

**Suggestion:** Add a comment block at the top stating required seed prerequisites, or use a subquery to resolve branch/supplier by a stable code rather than hardcoded UUID.

---

### ℹ️ Info

#### I1 — `DefectExchangePage.tsx` is now 360 lines
The refactored wizard is 360 lines. Not over the 500-line threshold but growing — consider extracting `Step1`, `Step2`, `Step3` into sibling files if this page continues to grow.

---

## Positive Notes
- All API calls use `api.get()`/`api.post()` — no raw `fetch()`
- `useQuery`/`useMutation` from `@tanstack/react-query` used correctly
- `queryClient.invalidateQueries()` called after mutation success for 4 query keys (thorough invalidation)
- 3-step wizard matches the existing insurance wizard pattern (consistent UX)
- No new backend endpoints — reuses existing `/defect-exchange/*` routes
- No security concerns in the frontend code

---

## Recommendation
Merge after addressing W1 (low-risk seed improvement) or document the prerequisite in the file header and merge as-is. No blocking issues.
