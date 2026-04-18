# Merge Guard Report — refactor/ui-design-tokens-2026-04-17

**Date**: 2026-04-18  
**Branch**: `refactor/ui-design-tokens-2026-04-17`  
**Author**: Akenarin Kongdach  
**Base**: `origin/main`

---

## File Changes Summary

| Category | Files | +Lines | -Lines |
|----------|-------|--------|--------|
| Backend (API) | 7 | ~270 | ~90 |
| Frontend (Web) | ~150 | ~1,680 | ~1,200 |
| DB Migration | 1 | 10 | 0 |
| Docs/Config | 2 | 402 | 0 |
| **Total** | **159** | **1,952** | **1,292** |

### Backend files changed
- `chat-adapters/chat-adapters.module.ts` — register adapters via `OnModuleInit`
- `chat-adapters/line-finance.adapter.ts` — await async `isConfigured()`
- `chat-engine/constants/chat-events.ts` — add `MESSAGE_SEND_FAILED` event
- `chat-engine/services/message-router.service.ts` — `sendStaffMessage` now returns `{ success, error? }`
- `facebook-domain/facebook-domain.module.ts` — register handler via `OnModuleInit`
- `staff-chat/staff-chat.gateway.ts` — surface delivery failures to UI via WS event
- `prisma/migrations/20260430000000_add_canned_response_type_media/migration.sql` — add `response_type` + `media_url` columns

### Frontend changes
Bulk removal of hardcoded gray/white classes and hex colors, replaced with semantic design tokens (`bg-background`, `text-foreground`, `text-muted-foreground`, `border-border`, `hover:bg-accent`, etc.) across ~150 component and page files.

---

## Issues Found

### Critical — None

### Warning

**W1: Mixed concerns in a single PR**  
- **Severity**: Warning  
- **Description**: Branch name is `refactor/ui-design-tokens-*` but it bundles unrelated backend changes (chat adapter registration refactor, `sendStaffMessage` return type change, new migration). This makes the PR harder to review and revert safely. If the backend changes introduce a regression, rolling back the design-token refactor is collateral damage.  
- **Recommendation**: Consider splitting into (a) backend/chat fixes and (b) frontend design-token sweep before merge. If timeline is tight, a reviewer must explicitly sign off on both halves.

### Info

**I1: Migration timestamp is in the future**  
- **File**: `apps/api/prisma/migrations/20260430000000_add_canned_response_type_media/migration.sql`  
- **Description**: Timestamp `20260430` is April 30 2026 (today is April 18). Prisma applies migrations in timestamp order — this is fine functionally but can cause confusion if another migration is added between now and April 30.  
- **Recommendation**: Rename to today's date (`20260418…`) before merge.

**I2: Large branch (159 files)**  
- **Description**: 159 files is near the limit of what can be meaningfully reviewed in one pass. The design-token sweep is mechanical and low-risk but the sheer size increases the chance that a reviewer misses a critical change buried in noise.

**I3: E2E `global-setup.ts` and `helpers/auth.ts` heavily modified**  
- **Files**: `apps/web/e2e/global-setup.ts`, `apps/web/e2e/helpers/auth.ts`  
- **Description**: 62 and 63 lines of changes respectively to E2E test infrastructure. If these break the E2E suite they will block CI for all subsequent PRs. Verify E2E suite passes on this branch before merge.

---

## Positive Observations

- **No new controllers without guards** — no security regressions introduced.
- **No `Number()` on money fields** — backend math still uses `Prisma.Decimal`.
- **No missing `deletedAt: null`** in any new Prisma queries.
- **No hardcoded secrets** found.
- **Design token replacements are correct** — new code uses `text-success`, `text-destructive/70`, `text-muted-foreground/50` etc. — no hardcoded hex or gray classes introduced.
- **Migration is safe** — uses `ALTER TABLE … ADD COLUMN IF NOT EXISTS`, zero data loss risk.
- **Chat send-failure propagation** — returning `{ success, error }` from `sendStaffMessage` and emitting `MESSAGE_SEND_FAILED` to the sending client is a meaningful UX improvement (silent failures become visible).

---

## Recommendation

**⚠️ REVIEW** — Do not block on Critical issues (none found), but two actions required before merge:

1. **Rename migration timestamp** from `20260430` to `20260418` (Info I1).
2. **Confirm E2E passes** on this branch (`cd apps/web && npx playwright test`).

If time permits, consider splitting backend chat fixes into a separate PR for cleaner history. Otherwise a single explicit LGTM covering both halves is sufficient.
