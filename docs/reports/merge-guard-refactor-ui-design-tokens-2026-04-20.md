# Merge Guard Report — refactor/ui-design-tokens-2026-04-17

**Date**: 2026-04-20  
**Branch**: `refactor/ui-design-tokens-2026-04-17`  
**Author**: Akenarin Kongdach (iamnaii@MacBook-Pro-khxng-Akenarin.local)  
**Unique commits** (not in current main): 10+ spanning Fri Apr 17  
**Reviewed by**: Pre-Merge Guard (automated)

---

## File Changes Summary (Unique Commits)

### Tip Commit `32aef061` — fix(chat): register adapters via OnModuleInit + surface send failures to UI

| File | Change |
|------|--------|
| `chat-adapters/chat-adapters.module.ts` | `OnModuleInit` — self-registers all 5 adapters with `MessageRouterService` |
| `chat-adapters/line-finance.adapter.ts` | Fix: `await isConfigured()` (was sync getter) |
| `chat-engine/constants/chat-events.ts` | New `MESSAGE_SEND_FAILED` event constant |
| `chat-engine/services/message-router.service.ts` | `sendStaffMessage` returns `{success, error}` (was `void`); new `registerAdapter/registerDomainHandler` |
| `facebook-domain/facebook-domain.module.ts` | `OnModuleInit` — self-registers domain handler |
| `staff-chat/staff-chat.gateway.ts` | Emits `chat:message:send-failed` to sender on delivery failure |
| `UnifiedInboxPage/hooks/useChatSocket.ts` | Handles `MESSAGE_SEND_FAILED` → `toast.error` |
| `UnifiedInboxPage/index.tsx` | Wires failure handler |

### Commit `5c86e645` — test(e2e): share login tokens across workers

| File | Change |
|------|--------|
| `e2e/global-setup.ts` | Pre-warm all 5 role tokens to `.playwright-roles-auth.json` before sharded run |

### Commit `092d3949` — fix(api): add missing canned_responses migration

| File | Change |
|------|--------|
| `migrations/20260430000000_add_canned_response_type_media/migration.sql` | `ALTER TABLE canned_responses ADD COLUMN IF NOT EXISTS response_type / media_url` |

### Commits `6efa2b3a`–`4b564048` — refactor(web): Phase 5–8 UI tokenization

Large-scale search-and-replace: hardcoded Tailwind color scales (`text-gray-*`, `bg-gray-*`, hex colors) → semantic CSS variable tokens (`text-foreground`, `bg-background`, etc.) across ~100+ component files.

---

## Issues

### Critical
None.

### Warning

1. **`sendStaffMessage` signature change is a breaking change for any callers not yet updated**  
   `MessageRouterService.sendStaffMessage()` now returns `Promise<{success, error?}>` instead of `Promise<void>`. The gateway (`staff-chat.gateway.ts`) is correctly updated. Verify there are no other callers in the codebase that discard the return value and would silently miss delivery failures. TypeScript should catch this at compile time — run `./tools/check-types.sh api` to confirm zero errors.

2. **`@SkipThrottle` not present on `/health` endpoint in `app.controller.ts`**  
   The `/health` endpoint added in this branch has no `@SkipThrottle` decorator. Since it's a health check hit by infrastructure (GCP load balancer probes), it should not be throttled. The existing `/` ping route has `@SkipThrottle`. This is a warning, not a block — health check failures from throttling would self-resolve.

   *Note*: `/health` has no `@UseGuards` which is **correct and intentional** — health endpoints are listed as intentionally public in the project guard policy.

### Info

1. **Playwright token cache is gitignored** — `.playwright-roles-auth.json` is correctly listed in `.gitignore`. No secrets leak risk.
2. **`MESSAGE_SEND_FAILED` event is client-only** — the new WebSocket event is never persisted to the database. This is correct for a transient UI notification.
3. **Phase 5–8 tokenization is a very large diff** (~100+ files, ~1500+ line changes). The mechanical nature (color class replacements) makes it low-risk, but visual regressions across many pages are possible. An E2E screenshot pass or manual spot-check of major pages (Dashboard, POS, Customers, Contracts) is recommended before merging.

---

## Branch Staleness Note ⚠️

Like `refactor/customer-contract-detail-ui`, this branch also diverged from an older `main` (before the force-push). It carries 10+ unique commits. A three-dot diff against current `main` is not resolvable — this branch also **requires a rebase** onto `origin/main` before merging cleanly.

---

## Assessment

The code quality on the unique commits is good:
- The chat adapter fix solves a real silent-failure bug (staff sending messages that never reached customers)
- The `sendStaffMessage` return value improvement is the right fix
- The migration is idempotent and safe
- The tokenization refactor is mechanical and follows project conventions
- No new controllers without guards
- No `Number()` on financial fields
- No raw `fetch()` in frontend code

The primary blocker is the same as the other branch: **diverged history requires rebase before merge**.

---

## Recommendation: ⚠️ REVIEW (Rebase Required + Type Check)

Code changes are sound. Before merging:
1. `git rebase origin/main` — resolve conflicts
2. `./tools/check-types.sh all` — confirm `sendStaffMessage` callers are updated
3. Add `@SkipThrottle` to `/health` endpoint (minor improvement)
4. Spot-check UI on major pages for visual regressions from tokenization
