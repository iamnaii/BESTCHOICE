# Merge Guard Report — feat/chatbot-production-ready
**Date**: 2026-04-12  
**Author**: iamnaii <akenarin.ak@gmail.com>  
**Reviewed commits** (1 commit unique to branch):
- `72a6fcc` feat(chatbot): production-ready — feedback Quick Reply, admin prompt editor, KB seed, remove CHATCONE

## File Changes Summary
16 files changed, 734 insertions(+), 313 deletions(-)

**Key files changed:**
- `apps/api/src/modules/chatbot-finance/chatbot-finance-admin.controller.ts` — new endpoints
- `apps/api/src/modules/chatbot-finance/services/chatbot-finance.service.ts` — postback + feedback
- `apps/api/src/modules/chatbot-finance/services/finance-ai.service.ts` — 5-min prompt cache
- `apps/api/src/modules/chatbot-finance/services/finance-config.service.ts` — DB-backed system prompt
- `apps/api/src/modules/chatbot-finance/services/knowledge.service.ts` — seed defaults
- `apps/api/src/modules/chatbot-finance/services/line-finance-client.service.ts` — Quick Reply support
- `apps/api/src/modules/chatcone/chatcone.controller.ts` — **deleted** (removal of stub module)
- `apps/api/src/modules/chatcone/chatcone.module.ts` — **deleted**
- `apps/api/src/modules/chatcone/chatcone.service.ts` — **deleted**
- `apps/web/src/pages/ChatbotFinanceKnowledgePage.tsx` — system prompt editor tab

---

## Issues by Severity

### Critical (must fix before merge): 1

**C-1: Frontend calls `/chatbot/finance/admin/prompt` endpoints that do NOT exist in the backend**

The commit message claims:
> GET/PUT/POST /admin/prompt endpoints (OWNER only)

The frontend `ChatbotFinanceKnowledgePage.tsx` makes these API calls:
```typescript
// apps/web/src/pages/ChatbotFinanceKnowledgePage.tsx
api.get<PromptData>('/chatbot/finance/admin/prompt');
api.put('/chatbot/finance/admin/prompt', { prompt: draft });
api.post('/chatbot/finance/admin/prompt/reset');
```

The `UpdatePromptDto` class is defined in `apps/api/src/modules/chatbot-finance/dto/admin.dto.ts`, and `FinanceConfigService.getSystemPrompt()` / `updateSystemPrompt()` / `resetSystemPrompt()` methods exist in `finance-config.service.ts`.

**However, the controller routes are completely absent** from `chatbot-finance-admin.controller.ts`:
- `@Get('prompt')` — missing
- `@Put('prompt')` — missing  
- `@Post('prompt/reset')` — missing

The System Prompt editor tab in the admin UI will always return `404 Not Found`. The feature is **broken at the API layer** despite the frontend and service being implemented.

**Fix**: Add the three prompt management endpoints to `ChatbotFinanceAdminController`:
```typescript
@Get('prompt')
@Roles('OWNER')
async getPrompt() {
  const prompt = await this.financeConfig.getSystemPrompt();
  const defaultPrompt = this.financeConfig.getDefaultPrompt();
  return { prompt, defaultPrompt };
}

@Put('prompt')
@Roles('OWNER')
async updatePrompt(@Body() dto: UpdatePromptDto) {
  await this.financeConfig.updateSystemPrompt(dto.prompt);
  this.financeAi.invalidatePromptCache();
  return { ok: true };
}

@Post('prompt/reset')
@HttpCode(200)
@Roles('OWNER')
async resetPrompt() {
  await this.financeConfig.resetSystemPrompt();
  this.financeAi.invalidatePromptCache();
  return { ok: true };
}
```
Note: `FinanceConfigService` and `FinanceAiService` must be injected into the constructor.

---

### Warning (should fix before merge): 0

No warnings found:
- All new admin endpoints have `@UseGuards(JwtAuthGuard, RolesGuard)` at class level ✅
- All methods have `@Roles(...)` decorators with appropriate roles ✅
- Knowledge service correctly uses `deletedAt: null` in all queries ✅
- Seed method is idempotent (checks existing by intent before creating) ✅
- Frontend uses `api.get()` / `api.post()` / `api.put()` / `api.delete()` (not raw `fetch()`) ✅
- `queryClient.invalidateQueries()` called after all mutations ✅
- `UpdatePromptDto` has proper class-validator decorators including Thai messages ✅
- Chatcone module removal is clean — no dangling imports or references ✅
- Postback handler validates all fields before saving feedback ✅

---

### Info

**I-1: `FinanceAiService` prompt cache is module-scoped (in-memory)**  
The 5-minute TTL cache (`this.promptCache`) is instance-level. In a multi-instance deployment (GCP Cloud Run with multiple replicas), each instance will independently fetch and cache the prompt. This means prompt updates won't propagate to all instances immediately — up to 5 minutes per instance. This is acceptable for the stated use case but worth documenting in a comment.

**I-2: Postback `sessionId` is trusted from LINE webhook data**  
`params.get('sessionId')` in the postback handler uses data the LINE platform echoes back. While LINE signs the webhook payload (verified by `LineFinanceWebhookGuard`), using the sessionId as a DB lookup key is fine since it's validated before use. No injection risk, but worth noting the trust chain.

---

## Recommendation: **BLOCK**

The branch is otherwise well-structured: security guards are correct, soft-delete is applied, frontend uses the API client properly, and the chatcone removal is clean.

**However, C-1 is a showstopper**: the advertised System Prompt editor feature is completely broken — the backend routes do not exist. The UI will display a non-functional editor that always throws 404 on load, save, and reset. This must be fixed before merge.

Once C-1 is fixed, this branch is APPROVE-ready.
