# Pre-Merge Guard Report

| Field | Value |
|-------|-------|
| **Branch** | `refactor/ui-design-tokens-2026-04-17` |
| **Author** | Akenarin Kongdach (akenarin.ak@gmail.com) |
| **Review Date** | 2026-04-17 |
| **Reviewer** | Pre-Merge Guard (automated) |
| **Recommendation** | ✅ REVIEW — one warning before merge |

---

## Summary

Large design-system refactor: replaces 598+ hardcoded Tailwind color-scale classes (`emerald-600`, `red-500`, etc.) with semantic design tokens (`text-success`, `text-destructive`, `bg-primary`, etc.) across 159 files. Also ships:

- ESLint `no-restricted-syntax` rule to **enforce** token usage going forward (with print/receipt overrides)
- Prisma migration fixing a schema-drift bug (`canned_responses.response_type` column missing)
- Backend: LINE Finance adapter fix (property → async method call), Staff Chat Gateway delivery-failure event

**Files changed:** 159 | **+1952 / −1292 lines** | **33 commits ahead of main**

---

## Issues Found

### ⚠️ Warning (should fix before merge)

#### W-001: Lingering `shadow-emerald-500/20` introduced in LandingPage
- **File:** `apps/web/src/pages/LandingPage.tsx` (diff line 5510)
- **Code:** `className="… shadow-lg shadow-emerald-500/20"`
- **Problem:** This hardcoded Tailwind color-scale class is the **opposite** of the branch's mission. Worse, the new ESLint rule (`no-restricted-syntax`) targets `Literal` values matching this exact pattern — so this line will produce a lint warning in CI after merge.
- **Fix:** Replace with `shadow-primary/20` (Tailwind v3 supports arbitrary shadow-color from CSS vars when configured) or just `shadow-md`. Check `DESIGN.md` for approved shadow tokens.

---

### ℹ️ Info (low risk, acceptable)

#### I-001: `type: 'TEXT' as any` in message-router.service.ts
- **File:** `apps/api/src/modules/chat-engine/services/message-router.service.ts` (diff line 174)
- **Code:** `type: 'TEXT' as any`
- **Problem:** Minor type safety bypass. The `as any` was already present in the old code (diff shows it was moved, not introduced). No regression.

#### I-002: New migration uses `ADD COLUMN IF NOT EXISTS` — safe
- **File:** `apps/api/prisma/migrations/20260430000000_add_canned_response_type_media/migration.sql`
- This migration patches a schema drift (columns existed in `schema.prisma` but not in the actual table). The `IF NOT EXISTS` guard makes it idempotent and safe on both fresh and existing databases. No data loss risk.

#### I-003: `saveCreditCheckMutation` correctly invalidates `credit-checks` query
- `queryClient.invalidateQueries({ queryKey: ['credit-checks'] })` called in `onSuccess`. ✅

#### I-004: Consent revoke mutation uses `refetchConsents()` instead of `invalidateQueries`
- **File:** PDPAPage
- `refetchConsents()` achieves the same result (forces re-fetch). Not a bug, but `invalidateQueries` is the convention. Low priority.

---

## Security Checklist

| Check | Result |
|-------|--------|
| Missing `@UseGuards(JwtAuthGuard)` on new controllers | ✅ No new controllers added |
| `Number()` on financial/money fields (backend) | ✅ No backend money fields changed |
| Missing `deletedAt: null` in new queries | ✅ No new Prisma queries |
| Hardcoded secrets or API keys | ✅ None found (test credentials in E2E fixtures only) |
| Missing `@Roles()` decorator | ✅ No new controller methods |
| Unparameterized `$queryRaw` | ✅ None |
| Raw `fetch()` in new React components | ✅ None (all use `api.get()`/`api.post()`) |

---

## File Change Breakdown

| Category | Files |
|----------|-------|
| Frontend pages (design token migration) | ~150 |
| Backend API modules | 6 (`chat-adapters`, `chat-engine`, `facebook-domain`, `staff-chat`) |
| Prisma migration | 1 |
| ESLint config | 1 |
| Design docs | 1 (`DESIGN.md`) |

---

## Recommendation

**REVIEW** — The branch is in good shape. One warning must be resolved:

1. **W-001** (LandingPage `shadow-emerald-500/20`) — fix or acknowledge before merge to avoid lint noise from the very rule this branch introduces.

After W-001 is addressed, this branch can be merged. No blocking security or correctness issues found.
