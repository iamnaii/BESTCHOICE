# Pre-Merge Guard Report — feat/chatbot-production-ready

**Date**: 2026-04-12
**Branch**: `feat/chatbot-production-ready`
**Author**: iamnaii <akenarin.ak@gmail.com>
**Reviewer**: Pre-Merge Guard (automated)
**Base**: `origin/main` (merge-base: `01c811958`)

---

## Summary

| Stat | Value |
|------|-------|
| Files changed | 16 |
| Insertions | +734 |
| Deletions | -313 |
| Commits ahead of main | 1 |
| Commits main is ahead | 23 |

**Net changes**: Remove CHATCONE module scaffold, add feedback Quick Reply, admin prompt editor (UI + service layer), KB seed endpoint, and knowledge-base seed data.

---

## File Changes

| File | Change |
|------|--------|
| `apps/api/prisma/seed.ts` | +seedKnowledgeBase() call |
| `apps/api/prisma/seeds/knowledge-base.ts` | New — FAQ seed data |
| `apps/api/src/app.module.ts` | Remove ChatconeModule |
| `apps/api/src/modules/chatbot-finance/chatbot-finance-admin.controller.ts` | +`POST knowledge/seed` endpoint |
| `apps/api/src/modules/chatbot-finance/constants/intents.ts` | +FEEDBACK intent |
| `apps/api/src/modules/chatbot-finance/dto/admin.dto.ts` | +UpdatePromptDto |
| `apps/api/src/modules/chatbot-finance/services/chatbot-finance.service.ts` | +postback handler, feedback Quick Reply, replyWithQuickReply |
| `apps/api/src/modules/chatbot-finance/services/finance-ai.service.ts` | +5-min prompt cache, DB prompt fetch |
| `apps/api/src/modules/chatbot-finance/services/finance-config.service.ts` | +getSystemPrompt/updateSystemPrompt/resetSystemPrompt |
| `apps/api/src/modules/chatbot-finance/services/knowledge.service.ts` | +seedDefaults() |
| `apps/api/src/modules/chatbot-finance/services/line-finance-client.service.ts` | +replyWithQuickReply, LineQuickReply types |
| `apps/api/src/modules/chatcone/chatcone.controller.ts` | Deleted |
| `apps/api/src/modules/chatcone/chatcone.module.ts` | Deleted |
| `apps/api/src/modules/chatcone/chatcone.service.ts` | Deleted |
| `apps/web/src/pages/ChatbotFinanceKnowledgePage.tsx` | +SystemPromptEditor component, tabs, Seed KB button |
| `docs/CTO-ROADMAP-2026.md` | New — CTO roadmap doc |

---

## Issues Found

### Critical

#### C-001: Missing Backend Endpoints for System Prompt Editor

**Severity**: Critical — frontend will throw 404 on all prompt-management API calls

**Location**: `apps/web/src/pages/ChatbotFinanceKnowledgePage.tsx` (lines 940–976)

The `SystemPromptEditor` component calls three API endpoints that **do not exist** in the backend:

```
GET  /chatbot/finance/admin/prompt       ← 404
PUT  /chatbot/finance/admin/prompt       ← 404
POST /chatbot/finance/admin/prompt/reset ← 404
```

The service methods are fully implemented in `FinanceConfigService` (`getSystemPrompt`, `updateSystemPrompt`, `resetSystemPrompt`) and `UpdatePromptDto` is defined in `dto/admin.dto.ts`, but **no routes are wired** in `chatbot-finance-admin.controller.ts`.

The diff's commit message describes "GET/PUT/POST /admin/prompt endpoints (OWNER only)" as completed, but this implementation is missing.

**Fix required**: Add three endpoints to `ChatbotFinanceAdminController`:
```typescript
@Get('prompt')
@Roles('OWNER')
async getPrompt() { ... }

@Put('prompt')
@Roles('OWNER')
async updatePrompt(@Body() dto: UpdatePromptDto) { ... }

@Post('prompt/reset')
@HttpCode(200)
@Roles('OWNER')
async resetPrompt() { ... }
```

Also: `FinanceAiService.invalidatePromptCache()` must be called after a successful PUT or reset.

---

### Warning

#### W-001: `eslint-disable-line` for `react-hooks/exhaustive-deps`

**Location**: `apps/web/src/pages/ChatbotFinanceKnowledgePage.tsx:952`

```typescript
useEffect(() => {
  if (promptData) {
    setDraft(promptData.prompt);
  }
}, [promptData?.prompt]); // eslint-disable-line react-hooks/exhaustive-deps
```

The dependency array uses optional chaining (`promptData?.prompt`) instead of the full object reference. The lint suppression hides a potential stale-closure issue. Recommend either including `promptData` as the dependency or restructuring to avoid the side effect.

#### W-002: Prompt cache fallback calls `getSystemPrompt()` again on error

**Location**: `apps/api/src/modules/chatbot-finance/services/finance-ai.service.ts` (lines ~416–421)

```typescript
} catch (err) {
  // ...
  return this.promptCache?.text || (await this.financeConfig.getSystemPrompt());
}
```

On a DB failure, if `promptCache` is null, this makes a second DB call that will also fail — causing an unhandled exception to propagate despite the intent to fall back gracefully. Should fall back to the hardcoded constant instead:

```typescript
return this.promptCache?.text || FINANCE_BOT_SYSTEM_PROMPT;
```

#### W-003: Feedback postback — `replyToken` always truthy on LINE postback events

**Location**: `apps/api/src/modules/chatbot-finance/services/chatbot-finance.service.ts` (line ~263)

```typescript
if (event.replyToken) {
  await this.replyAndSave(sessionId, event.replyToken, thankYou, INTENTS.FEEDBACK);
}
```

LINE postback events always include a `replyToken`, so this guard is redundant but harmless. The `replyAndSave` call uses `sessionId` (not the current session's ID) which is correct since it's extracted from the postback payload. Low risk, but worth noting.

#### W-004: `KB_SEED_ENTRIES` imported in two places (duplication)

**Location**: `apps/api/prisma/seeds/knowledge-base.ts` + `apps/api/src/modules/chatbot-finance/services/knowledge.service.ts`

Both files duplicate the seed loop logic verbatim. The Prisma seed file now delegates to `KB_SEED_ENTRIES` directly instead of reusing `KnowledgeService.seedDefaults()`. Recommend having the seed file call the service, or at minimum acknowledge the duplication.

---

### Info

#### I-001: ChatbotFinanceKnowledgePage.tsx is 523 lines

**Location**: `apps/web/src/pages/ChatbotFinanceKnowledgePage.tsx`

After this PR the file grows to 523 lines. The new `SystemPromptEditor` component (~130 lines) could be extracted to its own file (`ChatbotSystemPromptEditor.tsx`) to keep the page file manageable, but this is not blocking.

#### I-002: `CTO-ROADMAP-2026.md` — informational doc only

New documentation file, no code impact.

#### I-003: Branch is 23 commits behind `main`

This branch diverged before hardening merges. Should be rebased or merged from main before landing to avoid conflicts with more recent changes.

---

## Security Check

| Check | Result |
|-------|--------|
| New controllers have `@UseGuards(JwtAuthGuard, RolesGuard)` | Pass — class-level guard on `ChatbotFinanceAdminController` |
| All new endpoints have `@Roles()` | Pass — `@Roles('OWNER', 'FINANCE_MANAGER')` on new `knowledge/seed` |
| Hardcoded secrets / API keys | None found |
| `Number()` on money fields | Not applicable — no financial calculations in this branch |
| Missing `deletedAt: null` in queries | Pass — KB seed uses `{ deletedAt: null }` filter |
| SQL injection (`$queryRaw`) | None found |
| Raw `fetch()` in frontend | None found |

---

## Recommendation

**BLOCK**

**Reason**: Critical issue C-001 — the System Prompt Editor UI is fully built but the three backend API routes (`GET/PUT/POST /chatbot/finance/admin/prompt`) are not implemented. Every OWNER user who navigates to the System Prompt tab will see a broken UI with 404 errors on all actions.

**To unblock**:
1. Add `GET/PUT/POST prompt` endpoints to `ChatbotFinanceAdminController` (OWNER only)
2. Wire `FinanceAiService.invalidatePromptCache()` after PUT/reset
3. Fix W-002 fallback to use hardcoded constant instead of re-querying DB on error
4. Rebase onto current `main` (23 commits behind)

W-001 and W-003 are low-risk but should be addressed before merge.
