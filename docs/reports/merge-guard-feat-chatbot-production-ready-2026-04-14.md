# Merge Guard Report — feat/chatbot-production-ready

**Date**: 2026-04-14  
**PR**: #474  
**Branch**: `feat/chatbot-production-ready` → `main`  
**Author**: iamnaii  
**Recommendation**: 🔴 **BLOCK**

---

## File Changes Summary

16 files changed, +734 / -313 lines

| File | Change |
|------|--------|
| `apps/api/prisma/seed.ts` | +7 — KB seed wired up |
| `apps/api/prisma/seeds/knowledge-base.ts` | NEW — idempotent KB seed function |
| `apps/api/src/app.module.ts` | -2 — removed ChatconeModule |
| `chatbot-finance-admin.controller.ts` | +11 — added `POST knowledge/seed` endpoint |
| `constants/intents.ts` | +3 — added `FEEDBACK` intent |
| `dto/admin.dto.ts` | +8 — added `UpdatePromptDto` |
| `services/chatbot-finance.service.ts` | +130/-7 — feedback Quick Reply + postback handler |
| `services/finance-ai.service.ts` | +39/-1 — DB-backed system prompt with 5-min cache |
| `services/finance-config.service.ts` | +33 — prompt CRUD methods |
| `services/knowledge.service.ts` | +41 — `seedDefaults()` method |
| `services/line-finance-client.service.ts` | +20 — `replyWithQuickReply()` method |
| `chatcone/` (3 files) | DELETED — stub module removed |
| `ChatbotFinanceKnowledgePage.tsx` | +202 — System Prompt tab + Seed KB button |
| `docs/CTO-ROADMAP-2026.md` | +216 — new doc |

---

## Issues by Severity

### 🔴 Critical — Must Fix Before Merge

#### C-001: Missing backend endpoints for System Prompt Admin feature

The PR adds a "Admin Prompt Editor" feature in the frontend (`ChatbotFinanceKnowledgePage.tsx`) that calls 3 API endpoints which **do not exist** in the backend:

| Frontend call | Status |
|---|---|
| `GET /chatbot/finance/admin/prompt` | ❌ **Missing** |
| `PUT /chatbot/finance/admin/prompt` | ❌ **Missing** |
| `POST /chatbot/finance/admin/prompt/reset` | ❌ **Missing** |

**Root cause**: `FinanceConfigService` has all the business logic methods (`getSystemPrompt()`, `updateSystemPrompt()`, `resetSystemPrompt()`, `getDefaultSystemPrompt()`), but:
- `FinanceConfigService` is **not injected** into `ChatbotFinanceAdminController`
- `Put` HTTP decorator is **not imported** in the controller
- `UpdatePromptDto` is defined in `admin.dto.ts` but **not imported** into the controller
- The controller's JSDoc comment header does not list any `/prompt` routes

**Impact**: The "System Prompt" tab in `ChatbotFinanceKnowledgePage.tsx` will fail with 404 errors at runtime. The feature is non-functional as shipped.

**Fix required**: Add to `chatbot-finance-admin.controller.ts`:
```typescript
import { Put } from '@nestjs/common';
import { FinanceConfigService } from './services/finance-config.service';
import { UpdatePromptDto } from './dto/admin.dto';

// In constructor:
private financeConfig: FinanceConfigService,

// New endpoints:
@Get('prompt')
@Roles('OWNER', 'FINANCE_MANAGER')
async getPrompt() {
  const [current, defaultPrompt] = await Promise.all([
    this.financeConfig.getSystemPrompt(),
    Promise.resolve(this.financeConfig.getDefaultSystemPrompt()),
  ]);
  return { prompt: current, default: defaultPrompt };
}

@Put('prompt')
@Roles('OWNER', 'FINANCE_MANAGER')
async updatePrompt(@Body() dto: UpdatePromptDto) {
  await this.financeConfig.updateSystemPrompt(dto.prompt);
  return { ok: true };
}

@Post('prompt/reset')
@HttpCode(200)
@Roles('OWNER', 'FINANCE_MANAGER')
async resetPrompt() {
  await this.financeConfig.resetSystemPrompt();
  return { ok: true };
}
```

---

### ⚠️ Warning — Should Fix

#### W-001: Large file — ChatbotFinanceKnowledgePage.tsx is 523 lines

`apps/web/src/pages/ChatbotFinanceKnowledgePage.tsx` is 523 lines after this PR, exceeding the 500-line guideline. Consider extracting the System Prompt editor tab into a sub-component (e.g., `ChatbotPromptEditor.tsx`).

#### W-002: In-memory prompt cache is instance-scoped (no cross-instance invalidation)

`FinanceAiService.promptCache` is a class instance field. In a multi-instance deployment (Cloud Run with multiple replicas), editing the system prompt via the admin UI will only invalidate the cache on the instance that handled the request — other instances will continue serving the old prompt for up to 5 minutes.

This is acceptable for now (TTL is short), but should be noted in a follow-up task if the service scales horizontally.

#### W-003: Feedback postback `sessionId` is user-controlled

In `handlePostback()` (`chatbot-finance.service.ts:line ~245`), `sessionId` is extracted directly from the postback `data` string:
```typescript
const sessionId = params.get('sessionId');
```
A malicious user could craft a postback payload with an arbitrary `sessionId`. The `FeedbackService.saveFeedback()` should validate that the `sessionId` belongs to the `lineUserId` making the request before saving.

---

### ℹ️ Info

#### I-001: Chatcone module deletion is correct

The removal of `chatcone/` (3 files, -292 lines) is clean — the module was a stub with no real implementation, properly deregistered from `app.module.ts`. No downstream references remain.

#### I-002: Knowledge seed duplication

`seedDefaults()` logic is duplicated between `knowledge.service.ts` and `apps/api/prisma/seeds/knowledge-base.ts`. Both do identical `findFirst` + `create` loops over `KB_SEED_ENTRIES`. The service version is the canonical one; the prisma seed file could just call `new KnowledgeService(prisma).seedDefaults()` or share the logic.

#### I-003: New `UpdatePromptDto` lacks `@IsNotEmpty()`

`UpdatePromptDto.prompt` has `@MinLength(100)` which implicitly rejects empty strings, but an explicit `@IsNotEmpty()` would give a clearer error message.

---

## Positive Observations

- ✅ All new admin endpoints have `@UseGuards(JwtAuthGuard, RolesGuard)` at class level and `@Roles()` per method
- ✅ No `Number()` used on financial/money fields
- ✅ No raw `$queryRaw` SQL injection risks
- ✅ All new Prisma queries include `deletedAt: null` filter
- ✅ Frontend uses `api.get()`/`api.put()`/`api.post()` from `@/lib/api` (not raw fetch)
- ✅ All 3 mutations call `queryClient.invalidateQueries()` after success
- ✅ `UpdatePromptDto` has `@IsString`, `@MinLength(100)`, `@MaxLength(10000)` with Thai messages
- ✅ No hardcoded secrets or API keys

---

## Verdict

**🔴 BLOCK** — The Admin Prompt Editor feature is non-functional (C-001: 3 missing backend endpoints). Merge after adding the 3 missing controller endpoints. W-003 (sessionId validation in feedback) should also be addressed before production traffic hits this feature.
