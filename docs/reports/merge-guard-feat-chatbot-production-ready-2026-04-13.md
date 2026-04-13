# Pre-Merge Guard Report

**Branch**: `feat/chatbot-production-ready`
**Author**: iamnaii <akenarin.ak@gmail.com>
**Review Date**: 2026-04-13
**Commits**: 1 (`72a6fcce feat(chatbot): production-ready — feedback Quick Reply, admin prompt editor, KB seed, remove CHATCONE`)

---

## File Changes Summary

| File | Change | Lines |
|------|--------|-------|
| `apps/api/prisma/seed.ts` | Modified | +7 |
| `apps/api/prisma/seeds/knowledge-base.ts` | **New** | +42 |
| `apps/api/src/app.module.ts` | Modified | -2 (removed ChatconeModule) |
| `apps/api/src/modules/chatbot-finance/chatbot-finance-admin.controller.ts` | Modified | +11 (seed endpoint) |
| `apps/api/src/modules/chatbot-finance/constants/intents.ts` | Modified | +3 (FEEDBACK intent) |
| `apps/api/src/modules/chatbot-finance/dto/admin.dto.ts` | Modified | +9 (UpdatePromptDto) |
| `apps/api/src/modules/chatbot-finance/services/chatbot-finance.service.ts` | Modified | +80 (postback handler, feedback QR) |
| `apps/api/src/modules/chatbot-finance/services/finance-ai.service.ts` | Modified | +39 (prompt cache + DB prompt fetch) |
| `apps/api/src/modules/chatbot-finance/services/finance-config.service.ts` | Modified | +33 (system prompt CRUD) |
| `apps/api/src/modules/chatbot-finance/services/knowledge.service.ts` | Modified | +41 (seedDefaults) |
| `apps/api/src/modules/chatbot-finance/services/line-finance-client.service.ts` | Modified | +20 (QuickReply support) |
| `apps/api/src/modules/chatcone/chatcone.controller.ts` | **Deleted** | -93 |
| `apps/api/src/modules/chatcone/chatcone.module.ts` | **Deleted** | -10 |
| `apps/api/src/modules/chatcone/chatcone.service.ts` | **Deleted** | -189 |
| `apps/web/src/pages/ChatbotFinanceKnowledgePage.tsx` | Modified | +154 (SystemPromptEditor component) |
| `docs/CTO-ROADMAP-2026.md` | **New** | +216 (docs only) |

**Total**: 16 files changed, 734 insertions(+), 313 deletions(-)

---

## Issues Found

### Critical (must fix before merge)

None detected.

- Guards: `chatbot-finance-admin.controller.ts` has `@UseGuards(JwtAuthGuard, RolesGuard)` at class level and all new endpoints have `@Roles(...)` — **OK**
- Money fields: No `Number()` usage on financial data found — **OK**
- Soft delete: Seed queries (`findFirst`) include `deletedAt: null` — **OK**
- Hardcoded secrets: None found — **OK**
- SQL injection (`$queryRaw`): None found — **OK**

---

### Warning (should fix before merge)

#### W-001 — Missing backend routes for `/admin/prompt` (frontend calls unimplemented API)

**Severity**: Warning
**Files**:
- `apps/web/src/pages/ChatbotFinanceKnowledgePage.tsx` (lines ~940–975)
- `apps/api/src/modules/chatbot-finance/chatbot-finance-admin.controller.ts` (all routes)

The `SystemPromptEditor` component makes 3 API calls that have no corresponding backend route:
- `GET /chatbot/finance/admin/prompt` → 404 Not Found
- `PUT /chatbot/finance/admin/prompt` → 404 Not Found
- `POST /chatbot/finance/admin/prompt/reset` → 404 Not Found

The backend has `FinanceConfigService.getSystemPrompt()`, `updateSystemPrompt()`, and `resetSystemPrompt()` implemented, and `UpdatePromptDto` is defined in `admin.dto.ts`, but the admin controller has no routes wired for these methods. The SystemPromptEditor tab will fail completely for OWNER users.

**Fix**: Add to `chatbot-finance-admin.controller.ts`:
```typescript
@Get('prompt')
@Roles('OWNER')
async getPrompt() { ... }

@Put('prompt')
@Roles('OWNER')
async updatePrompt(@Body() dto: UpdatePromptDto) { ... }

@Post('prompt/reset')
@Roles('OWNER')
async resetPrompt() { ... }
```
Also inject `FinanceConfigService` and `FinanceAiService` into the admin controller to call `invalidatePromptCache()` after update.

---

#### W-002 — `SystemConfig.findUnique` missing `deletedAt: null` filter

**Severity**: Warning
**File**: `apps/api/src/modules/chatbot-finance/services/finance-config.service.ts:463`

```typescript
const config = await this.prisma.systemConfig.findUnique({
  where: { key: SYSTEM_CONFIG_KEYS.systemPrompt }, // missing deletedAt: null
});
```

The `SystemConfig` model has `deletedAt DateTime?`. A soft-deleted config record could be returned by `findUnique` since the `key` field is `@unique` — if a record is soft-deleted, it remains in the DB with that key, meaning a new `upsert` would conflict while `findUnique` would still return the deleted record.

**Fix**:
```typescript
const config = await this.prisma.systemConfig.findUnique({
  where: { key: SYSTEM_CONFIG_KEYS.systemPrompt, deletedAt: null },
});
```
Also add `deletedAt: null` filter to `resetSystemPrompt()`.

---

#### W-003 — `ChatbotFinanceKnowledgePage.tsx` exceeds 500 lines (523 lines)

**Severity**: Warning (Info borderline)
**File**: `apps/web/src/pages/ChatbotFinanceKnowledgePage.tsx`

The page now contains both KB management and the `SystemPromptEditor` component (154 new lines). At 523 lines it slightly exceeds the 500-line threshold. The `SystemPromptEditor` function is self-contained and could be extracted to a separate component file (`ChatbotSystemPromptEditor.tsx`) to keep the page maintainable.

---

#### W-004 — Seed logic duplicated between `knowledge.service.ts` and `seeds/knowledge-base.ts`

**Severity**: Warning
**Files**:
- `apps/api/prisma/seeds/knowledge-base.ts` (lines 51–79)
- `apps/api/src/modules/chatbot-finance/services/knowledge.service.ts:515–548`

The `seedDefaults()` logic in `KnowledgeService` and the `seedKnowledgeBase()` function in the Prisma seed file are near-identical (both loop `KB_SEED_ENTRIES`, check `findFirst`, and `create`). The seed file was added separately rather than importing the service. This creates a maintenance burden if the logic diverges.

**Fix**: Consider having `seeds/knowledge-base.ts` call a shared utility, or accept this duplication as intentional (seed file cannot import NestJS services).

---

### Info

#### I-001 — `FinanceAiService.promptCache` is instance-level (not process-level)

If the API runs multiple instances (e.g., Cloud Run with autoscaling), each instance has its own 5-minute prompt cache. An admin updating the prompt will see inconsistent behavior across instances until all caches expire. This is acceptable for current scale but worth documenting.

#### I-002 — Feedback `messageId` placeholder pattern (`__MSG_ID__`)

In `chatbot-finance.service.ts:285–300`, Quick Reply postback data contains `messageId=__MSG_ID__` as a placeholder replaced after `saveMessage()`. This is a code smell — if `replyWithQuickReply` is ever called without the replacement step, the placeholder leaks into production data. The current implementation does replace it correctly, but it's fragile.

#### I-003 — `UpdatePromptDto` defined but not imported in controller

`UpdatePromptDto` is defined in `dto/admin.dto.ts` but is not imported anywhere (since the prompt routes are missing — see W-001). It will be unused until W-001 is fixed.

#### I-004 — Chatcone module fully removed (breaking if any external code depends on it)

`ChatconeModule`, `ChatconeController`, and `ChatconeService` are deleted. Confirmed the module was already removed from `app.module.ts` imports. No other files import from `chatcone/` per this diff. Safe to remove.

---

## Summary

| Severity | Count |
|----------|-------|
| Critical | 0 |
| Warning  | 4 |
| Info     | 4 |

---

## Recommendation: **REVIEW**

The branch introduces solid work — feedback Quick Replies, KB seeding, system prompt DB storage with caching, and cleanup of the placeholder Chatcone module. No security vulnerabilities or financial data issues found.

**However, W-001 is a functional blocker**: the SystemPromptEditor UI that ships in this branch will throw 404 errors on every interaction because the backend routes are not wired. This is an incomplete feature, not a broken one, but shipping a tab that fully errors for OWNER users is poor UX.

**Recommended path to APPROVE**:
1. Fix W-001 — wire 3 prompt routes in admin controller (est. ~20 lines)
2. Fix W-002 — add `deletedAt: null` to `SystemConfig` queries (2 lines)
3. W-003 / W-004 — optional cleanup, can defer to follow-up PR
