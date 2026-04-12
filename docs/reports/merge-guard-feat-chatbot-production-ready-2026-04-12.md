# Pre-Merge Guard Report

**Branch**: `feat/chatbot-production-ready`
**Author**: iamnaii <akenarin.ak@gmail.com>
**Date**: 2026-04-12
**Reviewed by**: Pre-Merge Guard Agent

---

## Summary

16 files changed, 734 insertions(+), 313 deletions(-)

The branch makes the Finance Bot chatbot production-ready by adding:
- Feedback Quick Reply (👍/👎) via LINE postback
- Admin-editable System Prompt (DB-backed with 5-min cache)
- Knowledge Base seed endpoint + UI button
- Removal of the entire `ChatconeModule` (scaffold placeholder)

---

## File Changes

| File | Change |
|------|--------|
| `apps/api/prisma/seed.ts` | +7 lines — KB seed call |
| `apps/api/prisma/seeds/knowledge-base.ts` | NEW — idempotent KB seed |
| `apps/api/src/app.module.ts` | -2 lines — remove ChatconeModule |
| `chatbot-finance-admin.controller.ts` | +11 lines — `/knowledge/seed` endpoint |
| `chatbot-finance/constants/intents.ts` | +3 lines — add `FEEDBACK` intent |
| `chatbot-finance/dto/admin.dto.ts` | +9 lines — add `UpdatePromptDto` |
| `chatbot-finance/services/chatbot-finance.service.ts` | +130/-7 — postback handler, feedback quick reply |
| `chatbot-finance/services/finance-ai.service.ts` | +39/-4 — DB-backed system prompt with cache |
| `chatbot-finance/services/finance-config.service.ts` | +33 lines — prompt CRUD methods |
| `chatbot-finance/services/knowledge.service.ts` | +41 lines — `seedDefaults()` method |
| `chatbot-finance/services/line-finance-client.service.ts` | +20 lines — `replyWithQuickReply()` |
| `chatcone/chatcone.controller.ts` | -93 lines — removed |
| `chatcone/chatcone.module.ts` | -10 lines — removed |
| `chatcone/chatcone.service.ts` | -189 lines — removed |
| `apps/web/src/pages/ChatbotFinanceKnowledgePage.tsx` | +202/-1 — SystemPromptEditor component, tabs |
| `docs/CTO-ROADMAP-2026.md` | NEW — 216 lines docs |

---

## Issues Found

### 🔴 Critical (must fix before merge)

#### C-001: System Prompt API endpoints not implemented

**Severity**: Critical — runtime 404 at production

**Description**: `ChatbotFinanceKnowledgePage.tsx` renders a `SystemPromptEditor` component that calls three API endpoints:
- `GET /chatbot/finance/admin/prompt` (fetch current prompt + default)
- `PUT /chatbot/finance/admin/prompt` (save edited prompt)
- `POST /chatbot/finance/admin/prompt/reset` (reset to hardcoded default)

None of these endpoints exist in any controller. The `chatbot-finance-admin.controller.ts` has **zero occurrences** of "prompt". The `FinanceConfigService` has the service methods (`getSystemPrompt`, `updateSystemPrompt`, `resetSystemPrompt`) and the `UpdatePromptDto` DTO was added to `admin.dto.ts` — but they were never wired into the controller.

**Evidence**:
```bash
# admin controller — 186 lines, 0 matches for "prompt"
git show origin/feat/chatbot-production-ready:apps/api/src/modules/chatbot-finance/chatbot-finance-admin.controller.ts | grep -c "prompt"
# → 0
```

**Impact**: The System Prompt tab in the Knowledge Base admin page will fail with 404 on all three actions. The UI will show errors to OWNER users. `UpdatePromptDto` is dead code.

**Fix**: Add three endpoints to `chatbot-finance-admin.controller.ts` (OWNER-only):
```typescript
@Get('prompt')
@Roles('OWNER')
async getPrompt() {
  const [prompt, defaultPrompt] = await Promise.all([
    this.financeConfig.getSystemPrompt(),
    Promise.resolve(this.financeConfig.getDefaultSystemPrompt()),
  ]);
  return { prompt, defaultPrompt, isCustom: prompt !== defaultPrompt };
}

@Put('prompt')
@HttpCode(200)
@Roles('OWNER')
async updatePrompt(@Body() dto: UpdatePromptDto) {
  await this.financeConfig.updateSystemPrompt(dto.prompt);
  this.financeAi.invalidatePromptCache();
  return { message: 'บันทึก System Prompt แล้ว' };
}

@Post('prompt/reset')
@HttpCode(200)
@Roles('OWNER')
async resetPrompt() {
  await this.financeConfig.resetSystemPrompt();
  this.financeAi.invalidatePromptCache();
  return { message: 'รีเซ็ต System Prompt แล้ว' };
}
```
Also inject `FinanceConfigService` and `FinanceAiService` into the admin controller constructor.

---

### 🟡 Warning (should fix)

#### W-001: `__MSG_ID__` placeholder string replacement is fragile

**File**: `chatbot-finance.service.ts:358–375`

The feedback Quick Reply uses a hardcoded placeholder `__MSG_ID__` in the postback `data` string, then replaces it with the actual `savedMsg.id` after saving. While UUIDs cannot contain that string, this pattern couples `buildFeedbackQuickReply` and `replyAndSave` via a magic string constant. If the replacement ever fails silently (e.g., `item.action.type !== 'postback'`), the feedback will be recorded without a `messageId`.

**Fix**: Pass `messageId` as a parameter to `buildFeedbackQuickReply(sessionId, messageId)` and call it after `savedMsg` is returned, instead of using placeholder substitution.

#### W-002: `systemConfig.findUnique` missing `deletedAt: null`

**File**: `finance-config.service.ts:105`

```typescript
const config = await this.prisma.systemConfig.findUnique({
  where: { key: SYSTEM_CONFIG_KEYS.systemPrompt },
});
```

`SystemConfig` has `deletedAt DateTime?`. A `findUnique` on a `@unique` key doesn't filter soft-deleted rows. If a prompt config is ever soft-deleted (e.g., via `resetSystemPrompt`'s `deleteMany`), a subsequent `findUnique` will still return null — this is actually correct here because `resetSystemPrompt` calls `deleteMany` (hard-style soft-delete), not `update({ deletedAt: new Date() })`. However, the pattern is inconsistent with the codebase convention (`deletedAt: null` in every query). Use `findFirst({ where: { key: ..., deletedAt: null } })` for consistency.

#### W-003: `eslint-disable-line` suppressing exhaustive-deps

**File**: `ChatbotFinanceKnowledgePage.tsx:74`

```tsx
}, [promptData?.prompt]); // eslint-disable-line react-hooks/exhaustive-deps
```

The intent (only reset draft when the prompt text changes, not on every render) is reasonable. However, `setDraft` is stable and `promptData` itself should be in the deps. Consider using `useEffect(() => { ... }, [promptData])` — this works correctly because React will still only call it when `promptData` changes by reference (which React Query manages).

---

### 🔵 Info

#### I-001: Large files

- `ChatbotFinanceKnowledgePage.tsx` — **523 lines** (threshold: 500). The new `SystemPromptEditor` sub-component (120+ lines) could be split to its own file: `ChatbotFinancePromptEditor.tsx`.
- `chatbot-finance.service.ts` — **444 lines**, approaching the threshold.

#### I-002: Postback handler logs session ID in plaintext

**File**: `chatbot-finance.service.ts:320`

```typescript
this.logger.log(`[Finance] Postback: ${data}`);
```

`data` contains `sessionId` as a URL parameter. This is logged at INFO level. Per PII-webhook allow-list policy (v3 hardening), consider logging only `action` and `rating` — omit `sessionId` and `messageId` from the log line.

#### I-003: `UpdatePromptDto` currently dead code

**File**: `chatbot-finance/dto/admin.dto.ts:40-48`

Defined but not imported anywhere (no controller uses it yet — see C-001). Will become live code after C-001 fix.

---

## Security Check

| Check | Result |
|-------|--------|
| New controllers have `@UseGuards(JwtAuthGuard, RolesGuard)` | ✅ `@Controller('chatbot/finance/admin') @UseGuards(JwtAuthGuard, RolesGuard)` at class level |
| All new endpoints have `@Roles()` | ✅ Every method has explicit `@Roles` decorator |
| No `Number()` on money fields | ✅ No financial arithmetic in new code |
| No `deletedAt: null` missing on new `findMany`/`findFirst` | ✅ `knowledge.service.ts` and `seeds/knowledge-base.ts` both include `deletedAt: null` |
| No hardcoded secrets | ✅ All credentials via `ConfigService` / environment |
| No unparameterized `$queryRaw` | ✅ None |
| `chatcone` removal complete | ✅ Controller, module, service all deleted; `app.module.ts` updated |

---

## Recommendation

**BLOCK — fix C-001 before merge**

The System Prompt editor UI is fully implemented on the frontend but has no backend endpoints. OWNER users will see 404 errors immediately on the "System Prompt" tab. This is a user-visible breakage.

**Minimum required fix**: Add 3 prompt endpoints to `chatbot-finance-admin.controller.ts` (see C-001 fix above). W-001 and W-002 are low-risk but should be addressed in the same PR to avoid future confusion.

**Positive notes**: The feedback Quick Reply architecture is clean, the ChatconeModule removal is thorough, the KB seed is properly idempotent, and all security guards are correctly applied.

---

## Addendum (second pass — 2026-04-12)

Two additional findings not in the initial review:

#### A-001: Error fallback in `FinanceAiService.getSystemPromptText()` can re-throw

**File**: `services/finance-ai.service.ts` (catch block, ~line 415)

```typescript
} catch (err) {
  this.logger.warn(`...`);
  return this.promptCache?.text || (await this.financeConfig.getSystemPrompt());
  //                                          ^^^ same call that just failed
}
```

On a cold start (no cache) with a DB error, the catch block calls `financeConfig.getSystemPrompt()` again — which throws the same error — causing an unhandled rejection instead of a graceful fallback. Fix: use the hardcoded constant directly in the catch:

```typescript
return this.promptCache?.text ?? this.financeConfig.getDefaultSystemPrompt();
```

#### A-002: Branch is 5 commits behind `origin/main`

The branch diverged at `01c81195` (Merge PR #472). `origin/main` has 5 subsequent commits (Docker build fixes, `@nestjs/cli` hoisting, journal-auto test fix). Rebase onto main before merging.
