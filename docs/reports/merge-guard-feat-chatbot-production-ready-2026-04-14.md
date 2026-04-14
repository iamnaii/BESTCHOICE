# Pre-Merge Guard Report

**Branch**: `feat/chatbot-production-ready`
**Author**: iamnaii <akenarin.ak@gmail.com>
**Latest Commit**: `72a6fcce` — feat(chatbot): production-ready — feedback Quick Reply, admin prompt editor, KB seed, remove CHATCONE
**Review Date**: 2026-04-14
**Reviewer**: Pre-Merge Guard (automated)

---

## Summary

This branch performs a large-scale cleanup: it removes the unified chat engine, CHATCONE integration, CRM, AdsTracking, Broadcast, and CSAT modules (94 files deleted, ~10 k lines removed). It also adds two new features to `chatbot-finance`: feedback Quick Reply and a system-prompt admin editor.

**File Changes** (excluding `package-lock.json`):
- Added: 2 files (`seeds/knowledge-base.ts`, `docs/CTO-ROADMAP-2026.md`)
- Deleted: 94 files (unified chat engine, CHATCONE, CRM, Ads, CSAT modules)
- Modified: 25 files

---

## Issues by Severity

### CRITICAL — Must Fix Before Merge

#### C-1: Missing API endpoints for System Prompt Editor

**Files**: `apps/web/src/pages/ChatbotFinanceKnowledgePage.tsx` (lines 52, 67, 78)
and `apps/api/src/modules/chatbot-finance/chatbot-finance-admin.controller.ts`

The frontend System Prompt Editor makes three API calls that have no backend routes:

```typescript
// ChatbotFinanceKnowledgePage.tsx:52
await api.get<PromptData>('/chatbot/finance/admin/prompt');       // 404

// ChatbotFinanceKnowledgePage.tsx:67
await api.put('/chatbot/finance/admin/prompt', { prompt: draft }); // 404

// ChatbotFinanceKnowledgePage.tsx:78
await api.post('/chatbot/finance/admin/prompt/reset');             // 404
```

The admin controller (`chatbot-finance-admin.controller.ts`) has no prompt endpoints — confirmed by listing all `@Get`/`@Post`/`@Put`/`@Patch` decorators: `analytics`, `sessions`, `knowledge`, `learning`. No `prompt` route exists.

`FinanceConfigService` already has the service methods implemented (`getSystemPrompt()`, `updateSystemPrompt()`, `resetSystemPrompt()`, `getDefaultSystemPrompt()`), and `UpdatePromptDto` is defined in `dto/admin.dto.ts` with proper validation — but the controller routes are missing and `FinanceConfigService` is not injected into the admin controller.

**Impact**: The System Prompt Editor UI renders but all interactions silently fail (React Query catches the 404s). Admin cannot read or modify the bot's system prompt.

**Fix**: Add to `chatbot-finance-admin.controller.ts`:
1. Inject `FinanceConfigService` in the constructor
2. Add `GET chatbot/finance/admin/prompt` → `@Roles('OWNER')`
3. Add `PUT chatbot/finance/admin/prompt` → `@Roles('OWNER')` with `@Body() dto: UpdatePromptDto`
4. Add `POST chatbot/finance/admin/prompt/reset` → `@Roles('OWNER')`
5. Call `this.financeAi.invalidatePromptCache()` after update/reset

---

#### C-2: Schema models removed without a corresponding migration

**Files**: `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/`

Eleven models are removed from `schema.prisma` in this branch:

| Removed Model | Was Added In |
|---|---|
| `ConversationTag` | `20260412200000_add_unified_chat_engine` |
| `CannedResponse` | same |
| `StaffChatActivity` | same |
| `ChatNote` | same |
| `ChatSnooze` | same |
| `ChatSideMessage` | same |
| `AdsCampaign` | same |
| `AdsAttribution` | same |
| `CrmLead` | same |
| `CrmNote` | same |
| `CustomerScore` | same |

The migration `20260412200000_add_unified_chat_engine/migration.sql` (which created these tables) is **deleted** from the migrations directory. No new `DROP TABLE` migration was created to replace it.

**Impact**:
- `prisma migrate deploy` in production will error because the migration history is inconsistent (a migration that was applied to the DB is now missing from the filesystem).
- The database tables still exist in production; Prisma will detect schema drift.

**Fix**: Do NOT delete the old migration. Instead, create a new migration:
```sql
-- 20260414200000_remove_unified_chat_engine_crm_ads/migration.sql
DROP TABLE IF EXISTS "conversation_tags";
DROP TABLE IF EXISTS "canned_responses";
DROP TABLE IF EXISTS "staff_chat_activities";
DROP TABLE IF EXISTS "chat_notes";
DROP TABLE IF EXISTS "chat_snoozes";
DROP TABLE IF EXISTS "chat_side_messages";
DROP TABLE IF EXISTS "ads_campaigns";
DROP TABLE IF EXISTS "ads_attributions";
DROP TABLE IF EXISTS "crm_leads";
DROP TABLE IF EXISTS "crm_notes";
DROP TABLE IF EXISTS "customer_scores";
-- Remove columns referencing these tables from users, contracts, customers, branches
```
Then restore the deleted migration `20260412200000_add_unified_chat_engine/migration.sql` (or re-create it with the original content so migration history is intact).

---

### WARNING — Should Fix Before Merge

#### W-1: Duplicate knowledge-base seed logic

**Files**:
- `apps/api/prisma/seeds/knowledge-base.ts` (new file)
- `apps/api/src/modules/chatbot-finance/services/knowledge.service.ts:seedDefaults()`

Both implement the same idempotent KB seed loop using `KB_SEED_ENTRIES`. The prisma seed calls the standalone file; the admin `POST /knowledge/seed` endpoint calls the service. The logic is duplicated (~40 lines each).

**Fix**: Remove `apps/api/prisma/seeds/knowledge-base.ts` and make the seed script call `KnowledgeService.seedDefaults()` (inject via NestJS application context), or keep the file but have `seedDefaults()` call it as a shared utility.

---

#### W-2: `UpdatePromptDto` declared but unused

**File**: `apps/api/src/modules/chatbot-finance/dto/admin.dto.ts`

`UpdatePromptDto` (with `@MinLength(100)` + `@MaxLength(10000)` validation) is defined but never imported or referenced by any controller. This will become needed when C-1 is fixed.

**Note**: This is a consequence of C-1 — resolving C-1 will also resolve W-2.

---

#### W-3: No error handling on `handlePostback` for missing session

**File**: `apps/api/src/modules/chatbot-finance/services/chatbot-finance.service.ts:handlePostback()` (line ~314)

The `feedback.saveFeedback()` call is wrapped in try/catch, which is good. However, if `sessionId` is present but the session is not found, `FeedbackService` throws `ForbiddenException`. This exception propagates up to the LINE webhook handler, which may cause a non-200 response to LINE's platform — LINE will then retry the webhook repeatedly.

**Fix**: Catch `ForbiddenException` specifically in the postback handler:
```typescript
} catch (err) {
  if (err instanceof ForbiddenException) {
    this.logger.warn(`[Finance] Feedback postback: session not found, ignoring`);
    return;
  }
  this.logger.error(...);
}
```

---

### INFO

#### I-1: Large module deletion — verify no orphan routes in App.tsx

The branch removes routes for: `/ads`, `/crm`, `/broadcast`, `/unified-inbox`, `/csat`, `/channel-settings`, `/canned-responses`, `/chat-analytics`. Confirm `apps/web/src/App.tsx` has no remaining lazy imports pointing to now-deleted page files. A quick `grep` on the modified `App.tsx` shows these routes are cleaned up correctly.

#### I-2: `FinanceConfigService` needs to be added to admin controller providers

Related to C-1 — the module providers list in `chatbot-finance.module.ts` does not currently export `FinanceConfigService`. It will need to be added when implementing the prompt endpoints.

#### I-3: docs/CTO-ROADMAP-2026.md added

New file. No code impact. This is documentation only.

---

## Positive Findings

- All new controller endpoints (`knowledge/seed`) are properly guarded with `@UseGuards(JwtAuthGuard, RolesGuard)` and `@Roles`.
- The `__MSG_ID__` placeholder in feedback Quick Reply is correctly resolved in `replyAndSave()` (line 427) before the LINE reply is sent — not a bug.
- `FeedbackService.saveFeedback()` correctly validates session ownership before writing (prevents spoofed feedback postbacks).
- `UpdatePromptDto` has proper min/max length validation for the prompt field.
- All `deletedAt: null` filters are present in new queries.
- No `Number()` calls on money fields in added code (only in deleted `ads-tracking.service.ts` which is being removed).
- No hardcoded secrets or API keys in new code.
- No raw `$queryRaw` usage in new code.

---

## Recommendation

**BLOCK** — Do not merge until C-1 and C-2 are resolved.

| Issue | Severity | Blocker? |
|---|---|---|
| C-1: Missing prompt API endpoints | Critical | YES |
| C-2: Schema models removed without migration | Critical | YES |
| W-1: Duplicate KB seed logic | Warning | No |
| W-2: UpdatePromptDto unused | Warning | No (fix with C-1) |
| W-3: Postback missing ForbiddenException catch | Warning | No |

C-1 is a functional regression — the System Prompt Editor ships as a broken UI feature.
C-2 is a deployment blocker — `prisma migrate deploy` will fail in production with a missing migration error, and restoring the history later requires manual DB intervention.
