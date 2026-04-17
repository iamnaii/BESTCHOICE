# Pre-Merge Guard Report — `feat/chatbot-production-ready`

**Date**: 2026-04-17  
**Branch**: `feat/chatbot-production-ready`  
**Author**: iamnaii <akenarin.ak@gmail.com>  
**Reviewer**: Pre-Merge Guard (automated)

---

## Branch Summary

- **Unique commits (not in main)**: 2 commits at tip
- **Behind main by**: 50 commits (Facebook integration, inbox redesign, and other changes)
- **Key changes**: LINE Quick Reply feedback, DB-editable system prompt with 5-min cache, KB seed endpoint, removal of CHATCONE stub module

### Top Unique Commits
| Commit | Message |
|--------|---------|
| `a068ba27` | fix(chatbot): fallback to hardcoded prompt when DB fails |
| `a4f8b94e` | feat(chatbot): production-ready — feedback Quick Reply, admin prompt editor, KB seed, remove CHATCONE |

### File Changes Summary (unique commits)
- `apps/api/src/modules/chatbot-finance/chatbot-finance-admin.controller.ts` — added `POST /admin/knowledge/seed` and `GET/PUT /admin/prompt` endpoints
- `apps/api/src/modules/chatbot-finance/services/finance-ai.service.ts` — 5-min prompt cache, DB-fallback to hardcoded constant
- `apps/api/src/modules/chatbot-finance/services/knowledge.service.ts` — `seedDefaults()` idempotent seeder
- `apps/api/src/modules/chatbot-finance/services/finance-config.service.ts` — `getSystemPrompt()` / `saveSystemPrompt()` DB methods
- `apps/api/prisma/seeds/knowledge-base.ts` — default KB entries
- `apps/api/src/app.module.ts` — removed CHATCONE stub module
- `apps/web/src/pages/ChatbotFinanceKnowledgePage.tsx` — system prompt editor tab added

---

## Issues Found

### 🔴 Critical

None found.

---

### 🟡 Warning

#### W-1: Branch is 50 commits behind `main`
The branch diverged before several significant changes in main:
- Facebook Messenger integration
- Inbox full-bleed redesign
- Integration Hub / SMS consolidation
- `IntegrationConfigService` migration for LINE and Anthropic config

The chatbot module itself was modified in several main-only commits (e.g., `feat(chatbot-finance): migrate LINE finance/staff config to IntegrationConfigService`). A rebase is required before merge to resolve conflicts in `chatbot-finance` module files.

---

### 🔵 Info

#### I-1: `a4f8b94e` removes `@UseGuards(JwtAuthGuard, RolesGuard)` from CHATCONE controller
This is expected — the entire CHATCONE module was deleted. Not a security regression; the removed code was a stub module.

#### I-2: Knowledge seed button in frontend calls `POST /admin/knowledge/seed`
The endpoint correctly requires `OWNER` or `FINANCE_MANAGER` role and is idempotent. No concerns.

#### I-3: Prompt cache is in-memory (5 min TTL)
Fine for a single-instance deployment. Would need Redis cache if running multiple API replicas.

---

## Verdict

**🟡 REVIEW — Rebase required before merge**

No blocking security or financial-accuracy issues in the 2 unique commits. The logic is sound. However the branch is 50 commits behind main and conflicts in the chatbot-finance module are likely. Rebase onto `main` and resolve conflicts, then re-run TypeScript check before merge.
