# Merge Guard Report: feat/ai-hardening-followups

**Date**: 2026-07-05  
**Branch**: `feat/ai-hardening-followups`  
**Author**: iamnaii <akenarin.ak@gmail.com>  
**Commits**: 7 (latest: 2026-07-02)  
**Diff**: 30 files changed, +672 / -111  

---

## File Changes Summary

| File | Change |
|------|--------|
| `apps/api/src/modules/ai-usage/ai-pricing.ts` | +7 |
| `apps/api/src/modules/ai-usage/ai-pricing.spec.ts` | +9 |
| `apps/api/src/modules/chatbot-finance/knowledge-extractor.service.ts` | +19 |
| `apps/api/src/modules/chatbot-finance/knowledge-extractor.service.spec.ts` | +17 |
| `apps/api/src/modules/chatbot-finance/services/vision.service.ts` | +15 |
| `apps/api/src/modules/credit-check/credit-check.service.ts` | +19 |
| `apps/api/src/modules/credit-check/services/credit-check-ai-analysis.service.ts` | +21 |
| `apps/api/src/modules/credit-check/*.spec.ts` (5 files) | +50 |
| `apps/api/src/modules/ocr/ocr.service.ts` | +10 |
| `apps/api/src/modules/ocr/services/anthropic-ocr.client.ts` | +34 |
| `apps/api/src/modules/ocr/services/ocr-extractors.service.ts` | +15 |
| `apps/api/src/modules/ocr/ocr.service.spec.ts` | +31 |
| `apps/api/src/modules/sales-bot/sales-bot.service.ts` | +145 / -49 |
| `apps/api/src/modules/sales-bot/sales-bot.service.spec.ts` | +65 |
| `apps/api/src/modules/staff-chat/cron/embedding-backfill.cron.ts` | +107 / -30 |
| `apps/api/src/modules/staff-chat/cron/embedding-backfill.cron.spec.ts` | +123 |
| `apps/api/src/modules/staff-chat/services/ai-assistant.service.ts` | +20 |
| `apps/api/src/modules/staff-chat/services/ai-auto-reply.service.ts` | +13 |
| `apps/api/src/modules/staff-chat/services/ai-auto-reply.service.spec.ts` | +38 |
| `apps/web/src/pages/AiSettingsPage.tsx` | +6 / -6 |
| Doc files (2) | +6 |
| `.gitignore` | +1 |

---

## Issues Found

### Critical
_None found._

### Warning

**W1 — `as any` in test files (3 occurrences)**  
`embedding-backfill.cron.spec.ts` uses `prisma as any` and `embedding as any` when constructing the cron under test. This is a standard test-isolation pattern (partial mocks) and is limited to test files only. Production code has no `as any` in this branch.

**W2 — `embedding-backfill.cron.ts` is now 200+ lines**  
The backfill cron grew substantially with the `embedBatchWithFallback` poison-row logic. At current size it is still coherent but is approaching the threshold for decomposition. Not blocking.

### Info

**I1 — No new controllers introduced**  
All changes are in service/cron/spec files. No new endpoint → no guard review needed.

**I2 — No financial field handling**  
AI/OCR modules do not handle `Decimal` money fields. No `Number()` concern applies here.

**I3 — No raw queries or raw `fetch()` calls**  
Searched across all modified `.ts` / `.tsx` files — none found.

**I4 — Embedding backfill poison-row handling**  
`embedBatchWithFallback` correctly stamps `EMBED_FAILED` marker only on confirmed per-row failures (not systemic outages), rethrows on full-batch failure to avoid Sentry spam, and the spec covers both cases. Well-implemented.

**I5 — `sales-bot.service.ts` refactored to 145 added / 49 removed lines**  
The net change consolidates AI-reply path; spec coverage added (+65 lines). No financial logic touched.

---

## Recommendation: ✅ APPROVE

No critical or security issues. The branch hardens AI service reliability (poison-row protection on embedding backfill, better fallback handling across OCR/credit-check/vision services) and adds comprehensive tests. No new public endpoints, no Decimal mis-handling, no raw fetch calls.
