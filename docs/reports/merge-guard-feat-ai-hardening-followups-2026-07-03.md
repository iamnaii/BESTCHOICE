# Merge Guard Report — feat/ai-hardening-followups

**Date**: 2026-07-03  
**Branch**: `feat/ai-hardening-followups`  
**Author**: iamnaii <akenarin.ak@gmail.com>  
**Commits**: 7
```
30e3e8ac fix(ai): systemic-outage breaker in backfill, honest sales-bot errorKind, rolling-window wording
6b1aa95e chore: remove accidentally committed node_modules symlinks
429dd4b9 fix(ai-usage): longest-prefix match in ratesFor; add gemini-2.5-flash-lite rate
dc48ae0a fix(sales-bot): record error usage rows with accumulated tokens on provider throw
c57881bd fix(staff-chat): embedding backfill survives poison rows — per-row fallback + permanent skip
b3c4e6f3 feat(ai-usage): instrument vision, ai-assistant, knowledge-extractor, credit-check, ocr
bef849fe fix(staff-chat): per-room AI reply cap counts a rolling 24h window, not room lifetime
```
**Recommendation**: ✅ APPROVE

---

## File Changes Summary

30 files changed, 672 insertions(+), 111 deletions(-)

Key areas changed:
- `apps/api/src/modules/ai-usage/ai-pricing.ts` — longest-prefix match + gemini-2.5-flash-lite rate
- `apps/api/src/modules/credit-check/credit-check.service.ts` — added `AiUsageService` as 3rd constructor arg
- 5 credit-check spec files — updated to pass `AiUsageService` mock
- `apps/api/src/modules/chatbot-finance/services/vision.service.ts` — AI usage recording
- `apps/api/src/modules/chat-history-extractor/knowledge-extractor.service.ts` — AI usage recording
- `apps/api/src/modules/staff-chat/services/ai-auto-reply.service.ts` — rolling-window cap fix
- Various spec files and AI assistant/OCR services

---

## Issues Found

### Critical

None.

### Warning

None.

### ℹ️ Info

#### I1 — `void this.aiUsage.record(...)` — fire-and-forget usage recording

Multiple services use `void this.aiUsage.record(...)` (not `await`). This means a failure in usage recording will be silently swallowed. This is an intentional design decision (usage recording must not block the main response path), but errors won't surface in Sentry unless `AiUsageService.record` internally catches and reports.

This is consistent with the existing pattern in the codebase (`void` on non-critical side effects). No change needed — just documented here for awareness.

---

## What Looks Good

- **No new controller endpoints** — no guard review required.
- **No money/financial fields** touched — no `Number()` concerns.
- **Rolling-window fix** (`#1316`): the per-room AI reply cap now queries `createdAt > (now - 24h)` instead of lifetime count — a real correctness fix.
- **Poison-row backfill fix** (`#1318`): per-row try/catch with `PermanentEmbeddingSkip` upsert prevents one bad row from crashing the whole backfill run.
- **Longest-prefix match** (`#1320`): `gemini-2.5-flash-lite` rate key now takes precedence over `gemini-2.5-flash` when the model string starts with the longer key — correct fix.
- **Honest `errorKind`** (`#1319`): sales-bot now reports `'tool_error'` when a tool run fails instead of always blaming `'provider_error'` — improves error analytics.
- **`node_modules` symlinks removed** (`6b1aa95e`) — no functional impact, cleanliness fix.
- All spec files updated to pass the new `AiUsageService` mock — no tests broken.
- No raw `fetch()`, no hardcoded secrets, no SQL injection vectors.
