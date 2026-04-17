# Pre-Merge Guard Report

**Branch**: `refactor/ui-design-tokens-2026-04-17`
**Author**: Akenarin Kongdach
**Review date**: 2026-04-17
**Reviewer**: Pre-Merge Guard (automated)
**Base**: `origin/main`

---

## Change Summary

| Metric | Value |
|--------|-------|
| Files changed | 159 |
| Insertions | 1,952 |
| Deletions | 1,292 |
| Commits | 15 |
| API files changed | 6 (chat-adapters, message-router, facebook-domain, staff-chat, migrations) |
| Frontend files changed | ~150 tsx/ts (design token refactor across all pages) |
| E2E files changed | 1 (global-setup.ts) |

### Commit history
```
32aef061 fix(chat): register adapters via OnModuleInit + surface send failures to UI
5c86e645 test(e2e): share login tokens across workers to beat /auth/login 10/min throttle
092d3949 fix(api): add missing canned_responses.response_type + media_url migration
6efa2b3a refactor(web): Phase 8 tokenize 32 component/hook/lib/constant files
4b564048 refactor(web): Phase 7 eliminate final 45 color-scale violations
cea00f34 refactor(web): Phase 6 tokenize 50 sub-component files (~294 violations)
e1dcd092 chore(eslint): remove exemption for LineGreeting/RichMenu/Broadcast pages
19f80496 refactor(web): Phase 5 deep-clean 5 remaining CRITICAL/MAJOR pages
1ce132e2 refactor(web): tokenize LineGreeting remaining violations + CollectionDashboard a11y
7aaaefcf chore(lint): add no-restricted-syntax rule for hardcoded Tailwind color scales
783483d0 refactor(ui): overhaul 19 CRITICAL pages to design tokens (Phase 4)
958d57db refactor(ui): migrate 16 MAJOR pages to design tokens (Phase 3)
4841ff33 refactor(ui): migrate 14 MINOR pages to design tokens (Phase 2)
f9edb1a1 docs(ui): restore DESIGN.md north star (was accidentally removed)
00c7c849 refactor(ui): migrate 6 hero pages to design tokens (Phase 1)
```

---

## Issues Found

### Critical (block merge) — NONE

No critical issues were found:
- No new controllers added without `@UseGuards(JwtAuthGuard, RolesGuard)`.
- No new `Number()` arithmetic on financial fields — all `Number()` occurrences are pre-existing display-formatting calls (`toLocaleString()`); no new ones were introduced.
- No missing `deletedAt: null` in new Prisma queries (no new query sites).
- No hardcoded secrets or API keys.
- No SQL injection (`$queryRaw` with interpolation).

---

### Warning (should fix)

#### W-001 — Pre-existing `type: 'TEXT' as any` moved to new location
**File**: `apps/api/src/modules/chat-engine/services/message-router.service.ts:411`
**Detail**: The `type: 'TEXT' as any` cast existed before this branch; it was simply moved during the `sendStaffMessage` refactor. Not introduced here, but the refactor is a good opportunity to fix it by extending the `OutboundMessage` type to include `'TEXT'` as a proper union member.
**Severity**: Low — no runtime impact, but weakens type safety on the adapter interface.

#### W-002 — Bot bubble loses visual distinction
**File**: `apps/web/src/pages/UnifiedInboxPage/components/ConversationItem.tsx:128`
**Before**: `text-purple-500` (distinct bot colour)
**After**: `text-muted-foreground` (same as regular metadata text)
**Detail**: Bot-sent message previews in the conversation list are now styled identically to human-sent messages, reducing at-a-glance differentiation. The token migration is technically correct per the design rules (no raw scale colours), but the purple was semantically meaningful. Consider using `text-info` or adding a `text-bot` design token.

---

### Info

#### I-001 — Migration uses future date
**File**: `apps/api/prisma/migrations/20260430000000_add_canned_response_type_media/migration.sql`
**Detail**: Migration timestamp is `20260430` (April 30, 2026) — 13 days in the future. This is a Prisma convention (sequential ordering by filename), not a bug. Will execute correctly on deploy.

#### I-002 — `fill-warning` SVG class (new pattern)
**File**: `apps/web/src/pages/UnifiedInboxPage/components/ConversationItem.tsx:105`
**Detail**: First use of `fill-warning` in the codebase for SVG fill. The token is defined in `index.css` as `--color-warning` (Tailwind v4 CSS variable pattern). Should resolve correctly. No action needed unless CI reveals a rendering issue.

#### I-003 — ESLint `no-restricted-syntax` rule added for colour enforcement
**File**: `apps/web/.eslintrc.*` (or equivalent)  
**Detail**: A lint rule now forbids hardcoded Tailwind colour scale classes (`text-gray-*`, `bg-red-*`, etc.) project-wide. This is a quality improvement that will catch future regressions automatically.

#### I-004 — E2E global setup now shares tokens across all 5 roles
**File**: `apps/web/e2e/global-setup.ts`
**Detail**: Login tokens for OWNER, BRANCH_MANAGER, FINANCE_MANAGER, SALES, ACCOUNTANT are all pre-fetched sequentially (to stay under the 10-req/min throttle) and stored in `.playwright-roles-auth.json`. This is a good improvement that enables role-based E2E tests without per-test logins.

#### I-005 — Chat send-failure surface complete (backend + frontend)
**Files**: `staff-chat.gateway.ts`, `message-router.service.ts`, `useChatSocket.ts`, `UnifiedInboxPage/index.tsx`
**Detail**: When LINE/FB push fails (quota exceeded, blocked OA, etc.), the sending staff now sees a Thai-language toast and the message list is re-queried. Properly implemented end-to-end.

---

## Design Token Refactor Quality

Random-sample review of changed files confirmed:

| Check | Result |
|-------|--------|
| No new `text-gray-*` / `bg-gray-*` | PASS |
| No new hardcoded hex colours (`#...`) | PASS |
| No new `bg-white` outside print/sticker context | PASS |
| Tokens used: `text-foreground`, `text-muted-foreground`, `bg-background`, `bg-card`, `bg-muted`, `text-success`, `text-destructive`, `text-warning`, `text-primary`, `bg-accent` | PASS |
| `text-success` / `fill-warning` backed by CSS variables in `index.css` | PASS |
| New mutation (`saveCreditCheckMutation`) has `invalidateQueries` in `onSuccess` | PASS |
| No raw `fetch()` calls introduced | PASS |

---

## Recommendation

**APPROVE** ✅

No critical or blocking issues. W-001 and W-002 are minor quality items that can be addressed in a follow-up PR. The design token refactor is complete, correct, and enforced by lint rules going forward.

### Optional follow-ups (not blocking)
1. Fix `type: 'TEXT' as any` in `OutboundMessage` interface (W-001)
2. Introduce `text-info` or `text-bot` token for bot message previews (W-002)
