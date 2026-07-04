# Merge Guard Report — feat/ai-hardening-followups

**Date**: 2026-07-04  
**Branch**: `feat/ai-hardening-followups`  
**Author**: iamnaii (akenarin.ak@gmail.com)  
**Commits ahead of main**: 7  
**Last commit**: `30e3e8ac` — fix(ai): systemic-outage breaker in backfill, honest sales-bot errorKind, rolling-window wording (#1318 #1319 #1316)

---

## File Changes Summary

30 files changed — 672 insertions, 111 deletions.

| Area | Key Files |
|------|-----------|
| ai-pricing | `ai-pricing.ts`, `ai-pricing.spec.ts` |
| knowledge-extractor | `knowledge-extractor.service.ts`, `.spec.ts` |
| chatbot-finance | `vision.service.ts` |
| credit-check | `credit-check.service.ts`, `credit-check-ai-analysis.service.ts`, multiple specs |
| OCR | `ocr.service.ts`, `anthropic-ocr.client.ts`, `ocr-extractors.service.ts` |
| sales-bot | `sales-bot.service.ts`, `.spec.ts` |
| staff-chat | `embedding-backfill.cron.ts`, `.spec.ts`, `ai-assistant.service.ts`, `ai-auto-reply.service.ts/.spec.ts` |
| frontend | `AiSettingsPage.tsx` |
| docs | 2 plan/design docs |

### Key Changes
- **sales-bot**: Error handling wrapped in try/catch with `toolFailed` flag — distinguishes LLM provider failures from tool (Prisma/logic) failures so `AiUsage` error rows are correctly tagged.
- **embedding-backfill.cron**: Added systemic-outage breaker — if all rows in a batch fail after per-row retry, it rethrows to the run-level Sentry handler instead of spamming row-by-row (avoids alert fatigue).
- **anthropic-ocr.client**: Error handling improvements — token/rate-limit errors reported distinctly.
- **credit-check-ai-analysis**: Defensive null-checks + error classification.
- **ai-assistant / ai-auto-reply**: Rolling-window wording fix, minor hardening.

---

## Issues

**None found.**

All changes are in AI service files — no new controllers, no new public endpoints, no financial calculations, no database money fields. Error handling improvements are correct and Sentry integration is consistent with existing patterns.

- No `@UseGuards` gaps (no new controllers).
- No `Number()` on money fields (no financial data touched).
- No missing `deletedAt: null` (no new Prisma queries on soft-deleted models).
- No hardcoded secrets.
- No SQL injection risks.
- No raw `fetch()` in frontend (no frontend mutations introduced).

---

## Recommendation: ✅ APPROVE

Straightforward AI service hardening — error classification, Sentry coverage, and systemic-outage protection. No security or correctness concerns. Test coverage is expanded across all modified services.
