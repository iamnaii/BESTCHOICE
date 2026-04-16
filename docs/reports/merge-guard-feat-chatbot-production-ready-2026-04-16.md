# Merge Guard Report — feat/chatbot-production-ready

**Date:** 2026-04-16  
**Branch:** `feat/chatbot-production-ready`  
**Author:** Akenarin Kongdach <iamnaii@MacBook-Pro-khxng-Akenarin.local>  
**Last commit:** 2026-04-14  
**Recommendation:** ✅ APPROVE

---

## File Changes Summary

Unique commits ahead of `origin/main`:
- `a4f8b94e` — feat(chatbot): production-ready — feedback Quick Reply, admin prompt editor, KB seed, remove CHATCONE
- `a068ba27` — fix(chatbot): fallback to hardcoded prompt when DB fails

Key files changed:
| File | Change |
|------|--------|
| `apps/api/src/modules/chatbot-finance/chatbot-finance-admin.controller.ts` | +1 endpoint (`POST /admin/knowledge/seed`) |
| `apps/api/src/modules/chatbot-finance/dto/admin.dto.ts` | New `UpdatePromptDto` |
| `apps/api/src/modules/chatbot-finance/services/chatbot-finance.service.ts` | +130 lines (postback handling, feedback Quick Reply) |
| `apps/api/src/modules/chatbot-finance/services/finance-ai.service.ts` | 5-min prompt cache + fallback fix |
| `apps/api/src/modules/chatbot-finance/services/finance-config.service.ts` | DB-editable system prompt CRUD |
| `apps/api/src/modules/chatcone/` | **Deleted** (entire stub module removed) |
| `apps/web/src/pages/ChatbotFinanceKnowledgePage.tsx` | +System prompt editor tab, +Seed KB button |
| `apps/api/prisma/seeds/knowledge-base.ts` | New seed file for default KB entries |

---

## Issues by Severity

### Critical (0)
No critical issues found.

### Warning (0)
No warnings found.

### Info (2)

**[INFO-1]** `ChatbotFinanceKnowledgePage.tsx` is 611 lines — exceeds the 500-line soft threshold.  
- File: `apps/web/src/pages/ChatbotFinanceKnowledgePage.tsx`
- The extra lines are due to the new "System Prompt" tab and "KB Suggestions" tab additions.
- Not blocking — the page is well-structured with clear tab sections.

**[INFO-2]** Residual CHATCONE references remain in non-critical code paths after module deletion:  
- `apps/api/src/modules/staff-chat/services/ai-import.service.ts:35,48` — uses `source: 'CHATCONE_IMPORT'` as a string constant for historical import attribution (benign)
- `apps/web/src/pages/IntegrationHubPage.tsx:74` — display name in integration hub list
- `apps/web/src/pages/AiTrainingPage.tsx:168` — UI label for import feature
- None of these reference the deleted module — they are label strings only.

---

## Security Review

| Check | Result |
|-------|--------|
| New controllers have `@UseGuards(JwtAuthGuard, RolesGuard)` | ✅ All new endpoints are on existing guarded controllers |
| New methods have `@Roles(...)` | ✅ `@Roles('OWNER', 'FINANCE_MANAGER')` on `POST /admin/knowledge/seed` |
| No `Number()` on money fields | ✅ No financial arithmetic added |
| No missing `deletedAt: null` filters | ✅ No new findMany/findFirst queries without filter |
| No hardcoded secrets | ✅ Clean |
| No raw `$queryRaw` | ✅ None |
| No raw `fetch()` in React components | ✅ All API calls use `api.get()`/`api.post()`/`api.patch()` |
| `queryClient.invalidateQueries()` after mutations | ✅ Present in all 3 new mutations |
| DTO validation with Thai error messages | ✅ `UpdatePromptDto` has Thai messages |

---

## Positive Changes

- CHATCONE stub module cleanly removed from `app.module.ts` — no dangling imports
- `finance-ai.service.ts` fallback fix (`a068ba27`) prevents unhandled rejection when DB and cache both fail
- KB seed endpoint is **idempotent** (upsert pattern, `skipped` counter returned)
- System prompt editor correctly restricted to `OWNER` and `FINANCE_MANAGER` only
- 5-minute prompt cache reduces DB reads on high-traffic chatbot sessions
