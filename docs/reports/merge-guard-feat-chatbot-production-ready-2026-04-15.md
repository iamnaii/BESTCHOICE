# Merge Guard Report — feat/chatbot-production-ready

**Date**: 2026-04-15  
**Branch**: `feat/chatbot-production-ready`  
**Author**: iamnaii (Akenarin Kongdach)  
**Reviewed against**: `origin/main` (7750d1b8)  
**Recommendation**: 🔶 REVIEW (one functional defect in main, branch can be closed)

---

## Context

Main was force-pushed, rewriting history. The content of both unique commits in this branch
(`a4f8b94e` and `a068ba27`) is **already reflected in `origin/main`**. The branch can be
closed without merging. This report reviews the quality of those changes as they exist in main.

---

## File Changes Summary

**Unique commits** (2):
- `a4f8b94e` — feat(chatbot): production-ready — feedback Quick Reply, admin prompt editor, KB seed, remove CHATCONE
- `a068ba27` — fix(chatbot): fallback to hardcoded prompt when DB fails

**Key files changed**:
- `chatbot-finance-admin.controller.ts` — added `POST /admin/knowledge/seed`
- `chatbot-finance/services/finance-config.service.ts` — system prompt CRUD
- `chatbot-finance/services/knowledge.service.ts` — KB seed logic
- `chatbot-finance/services/finance-ai.service.ts` — prompt caching + fallback fix
- `apps/web/src/pages/ChatbotFinanceKnowledgePage.tsx` — System Prompt editor tab + Seed button

---

## Issues

### ⚠️ Warning (3)

**W-001** — Missing backend prompt endpoints (functional defect)  
The commit message claims "GET/PUT/POST /admin/prompt endpoints (OWNER only)" were added, but
`chatbot-finance-admin.controller.ts` contains **no prompt endpoints**. The frontend
`ChatbotFinanceKnowledgePage.tsx` calls:

```
GET  /chatbot/finance/admin/prompt
PUT  /chatbot/finance/admin/prompt
POST /chatbot/finance/admin/prompt/reset
```

These routes are not registered anywhere in the backend. The System Prompt Editor tab in
the admin UI will produce 404 errors in production.

`FinanceConfigService.getSystemPrompt()` and `updateSystemPrompt()` exist — the backend
business logic is implemented. Only the controller routing is missing.

**W-002** — Hard delete on `SystemConfig` in `finance-config.service.ts`  
`resetSystemPrompt()` uses `prisma.systemConfig.deleteMany()` — a **hard delete**.
This violates the project soft-delete convention (`deletedAt: null` pattern).
Should use `updateMany({ data: { deletedAt: new Date() } })`.

```typescript
// Current (hard delete — violates convention)
await this.prisma.systemConfig.deleteMany({
  where: { key: SYSTEM_CONFIG_KEYS.systemPrompt },
});

// Should be (soft delete)
await this.prisma.systemConfig.updateMany({
  where: { key: SYSTEM_CONFIG_KEYS.systemPrompt, deletedAt: null },
  data: { deletedAt: new Date() },
});
```

**W-003** — `SystemConfig` queries missing `deletedAt: null`  
`getSystemPrompt()`, `updateSystemPrompt()` query by unique key without `deletedAt: null`.
If a record was soft-deleted (per W-002 fix), `findUnique` by `key` would not find it but
`upsert` would create a duplicate — potentially causing stale reads on the soft-deleted record.

---

### ℹ️ Info (2)

**I-001** — Branch is already in main. All chatbot production features (KB seed, prompt caching, feedback Quick Reply, postback handling) are already deployed. Branch should be deleted.

**I-002** — CHATCONE module removal was clean (module + service + controller all deleted).

---

## Positive Findings

- All new admin endpoints properly use class-level `@UseGuards(JwtAuthGuard, RolesGuard)` with per-method `@Roles()` decorators
- `UpdatePromptDto` has `@IsString`, `@MinLength(100)`, `@MaxLength(10000)` with Thai messages
- `seedDefaults()` correctly uses `deletedAt: null` in its idempotency check
- `finance-ai.service.ts` fallback properly catches errors and falls back to hardcoded constant without infinite recursion
- Frontend uses `api.get()/api.post()` and `queryClient.invalidateQueries()` correctly

---

## Action Required (in main, not this branch)

1. **W-001**: Add the missing prompt endpoints to `chatbot-finance-admin.controller.ts`:
   - `GET /prompt` — return current system prompt
   - `PUT /prompt` — update prompt via `UpdatePromptDto`
   - `POST /prompt/reset` — reset to default
   All three should have `@Roles('OWNER')` (OWNER-only per the feature spec).

2. **W-002/W-003**: Fix `resetSystemPrompt()` to use soft-delete and add `deletedAt: null` to `SystemConfig` queries.

---

## Recommendation: 🔶 REVIEW / CLOSE BRANCH

Branch can be deleted (content already in main). Fix W-001 in main before the System Prompt
Editor tab can be used in production — without it, the tab silently fails with 404 errors.
