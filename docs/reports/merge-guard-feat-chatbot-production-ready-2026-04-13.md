# Merge Guard Report — feat/chatbot-production-ready

**Date**: 2026-04-13  
**Branch**: `feat/chatbot-production-ready`  
**Author**: iamnaii <akenarin.ak@gmail.com>  
**Base**: `origin/main`  
**Reviewer**: Pre-Merge Guard Agent  
**Recommendation**: ⚠️ REVIEW (fix Warning #1 before merge)

---

## File Changes Summary

| Stat | Value |
|------|-------|
| Files changed | 16 |
| Insertions | 734 |
| Deletions | 313 |

### Key areas touched

| File | Change |
|------|--------|
| `chatbot-finance-admin.controller.ts` | +11 lines — new `POST knowledge/seed` endpoint |
| `dto/admin.dto.ts` | +7 lines — new `UpdatePromptDto` |
| `services/chatbot-finance.service.ts` | +80 lines — postback handler + feedback Quick Reply |
| `services/finance-ai.service.ts` | +39 lines — DB-backed system prompt with 5-min cache |
| `services/finance-config.service.ts` | +33 lines — `getSystemPrompt / updateSystemPrompt / resetSystemPrompt` |
| `services/knowledge.service.ts` | +41 lines — `seedDefaults()` admin trigger |
| `services/line-finance-client.service.ts` | +20 lines — `replyWithQuickReply()` |
| `pages/ChatbotFinanceKnowledgePage.tsx` | +202 lines — System Prompt editor tab (OWNER only) |
| `prisma/seeds/knowledge-base.ts` | +42 lines — new seed file |
| `prisma/seed.ts` | +7 lines — calls `seedKnowledgeBase` |
| `modules/chatcone/` | **DELETED** — controller, service, module removed |
| `app.module.ts` | -2 lines — `ChatconeModule` unregistered |
| `docs/CTO-ROADMAP-2026.md` | +216 lines — new strategy doc |

---

## Issues by Severity

### Critical — 0 issues ✅

No critical issues found.

- All new/modified controllers have `@UseGuards(JwtAuthGuard, RolesGuard)` at class level
- All new endpoints have `@Roles(...)` decorators
- No `Number()` usage on financial/money fields in new code (the `Number()` lines in the diff are in *deleted* CHATCONE code)
- No hardcoded secrets or API keys
- No unparameterized `$queryRaw`
- LIFF controller is intentionally public (listed in security rules) and uses throttle guards

---

### Warning — 3 issues ⚠️

#### W-001 — Missing API endpoints for System Prompt tab (Broken Feature)

**Severity**: Warning — broken UI feature for OWNER users  
**File**: `apps/web/src/pages/ChatbotFinanceKnowledgePage.tsx`

The `SystemPromptEditor` component calls three endpoints that **do not exist** in any controller:

```
GET  /chatbot/finance/admin/prompt         ← returns { prompt, defaultPrompt, isCustom }
PUT  /chatbot/finance/admin/prompt         ← updates prompt (body: UpdatePromptDto)
POST /chatbot/finance/admin/prompt/reset   ← resets to default
```

`FinanceConfigService` (`services/finance-config.service.ts`) already implements all three methods (`getSystemPrompt`, `updateSystemPrompt`, `resetSystemPrompt`) and `UpdatePromptDto` is defined in `dto/admin.dto.ts` — but no controller routes expose them.

**Impact**: OWNER users navigating to the System Prompt tab will get 404 errors on page load. The tab is shown with `isOwner ? 'prompt' : 'kb'` as the default active tab, so OWNER lands on a broken screen immediately.

**Fix needed** — Add to `chatbot-finance-admin.controller.ts`:

```typescript
import { UpdatePromptDto } from './dto/admin.dto';
import { Put } from '@nestjs/common';
// also inject FinanceConfigService + FinanceAiService

@Get('prompt')
@Roles('OWNER')
async getPrompt() {
  const prompt = await this.financeConfig.getSystemPrompt();
  const defaultPrompt = this.financeConfig.getDefaultSystemPrompt();
  return { prompt, defaultPrompt, isCustom: prompt !== defaultPrompt };
}

@Put('prompt')
@HttpCode(200)
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

---

#### W-002 — Missing `deletedAt: null` filter on SystemConfig query

**Severity**: Warning — violates soft-delete convention  
**File**: `apps/api/src/modules/chatbot-finance/services/finance-config.service.ts:464`

```typescript
// Current (missing soft-delete filter)
const config = await this.prisma.systemConfig.findUnique({
  where: { key: SYSTEM_CONFIG_KEYS.systemPrompt },
});
```

`SystemConfig` has a `deletedAt DateTime?` field (confirmed in `schema.prisma`). A soft-deleted config record would be returned by this query. The `resetSystemPrompt()` method uses `deleteMany` (soft-delete target) correctly, but `getSystemPrompt` doesn't guard against retrieving deleted records.

**Fix**: Use `findFirst` with `deletedAt: null` filter:
```typescript
const config = await this.prisma.systemConfig.findFirst({
  where: { key: SYSTEM_CONFIG_KEYS.systemPrompt, deletedAt: null },
});
```

---

#### W-003 — Duplicated KB seed logic (DRY violation)

**Severity**: Warning — maintenance hazard  
**Files**: `apps/api/src/modules/chatbot-finance/services/knowledge.service.ts:520` and `apps/api/prisma/seeds/knowledge-base.ts:11`

Both `KnowledgeService.seedDefaults()` and `seedKnowledgeBase()` in the seed file contain nearly identical `findFirst + create` loops over `KB_SEED_ENTRIES`. Any future change to seed logic (e.g., updating `channel`, adding new fields) must be made in two places.

**Fix**: Have `seeds/knowledge-base.ts` call `prisma` directly (keep it standalone for seed script isolation) or have it import from a shared util. The service method `seedDefaults()` can be the canonical implementation; the seed file should call the service or share a helper.

---

### Info — 2 issues ℹ️

#### I-001 — `useEffect` eslint-disable comment on prompt draft sync

**File**: `apps/web/src/pages/ChatbotFinanceKnowledgePage.tsx:66`

```tsx
useEffect(() => {
  if (promptData) {
    setDraft(promptData.prompt);
  }
}, [promptData?.prompt]); // eslint-disable-line react-hooks/exhaustive-deps
```

The disable comment suppresses the warning about missing `promptData` in the deps array. The intent is to only sync on `prompt` string change, not on the full `promptData` object reference. Functionally correct, but the comment is a code smell. Consider using a `useRef` to track initial sync or the `initialData` pattern.

#### I-002 — New documentation file in repo root

**File**: `docs/CTO-ROADMAP-2026.md` (216 lines)

A strategy/roadmap document was added. Not a code issue, but confirm this is intentional and appropriate for version control.

---

## Summary

| Severity | Count | Status |
|----------|-------|--------|
| Critical | 0 | ✅ |
| Warning | 3 | ⚠️ |
| Info | 2 | ℹ️ |

**Overall Recommendation: ⚠️ REVIEW**

The branch is clean from a security standpoint — all controllers have proper guards, no money type violations, no hardcoded secrets. However, **W-001 is a functional blocker**: the System Prompt editor tab (which becomes the default landing tab for OWNER users) will fail with 404 errors because the three API endpoints it calls are never implemented in any controller. The service methods and DTO exist — the controller wiring is simply missing.

**W-002** (missing `deletedAt` filter) is a convention violation that could cause a soft-deleted system prompt record to persist in the UI.

Recommend fixing W-001 and W-002 before merge. W-003 can be addressed in a follow-up.
