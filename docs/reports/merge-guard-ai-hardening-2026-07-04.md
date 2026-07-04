# Merge Guard Report — feat/ai-hardening-followups

**Date**: 2026-07-04  
**Branch**: `feat/ai-hardening-followups`  
**Author**: akenarin.ak@gmail.com  
**Commits**: 5  
**Recommendation**: ✅ APPROVE

---

## File Changes Summary

30 files changed, 672 insertions(+), 111 deletions(-)

| Area | Files |
|------|-------|
| AI pricing | `ai-pricing.ts`, `ai-pricing.spec.ts` |
| Knowledge extractor | `knowledge-extractor.service.ts`, `.spec.ts` |
| Vision service | `vision.service.ts` |
| Credit check | `credit-check.service.ts`, `credit-check-ai-analysis.service.ts` + 6 spec files |
| OCR | `ocr.service.ts`, `anthropic-ocr.client.ts`, `ocr-extractors.service.ts`, `.spec` |
| Sales bot | `sales-bot.service.ts`, `.spec.ts` |
| Staff chat | `embedding-backfill.cron.ts`, `.cron.spec.ts`, `ai-assistant.service.ts`, `ai-auto-reply.service.ts`, `.spec` |
| Web | `AiSettingsPage.tsx` |
| Docs | 2 plan documents updated |

Key fixes (refs #1316, #1318, #1319, #1320):
- **#1318**: Embedding backfill cron survives poison rows — per-row retry + permanent EMBED_FAILED skip + systemic-outage breaker that rethrows to run-level Sentry instead of spamming per-row
- **#1319**: Sales-bot records error usage rows with accumulated tokens on provider throw (previously lost)
- **#1316**: AI auto-reply rolling-window wording corrected
- **#1320**: `ratesFor()` longest-prefix match + Gemini 2.5 Flash Lite rate added
- **#1321**: Credit check + vision services hardened with explicit error handling

---

## Issues Found

### Critical — None

### Warning — None

### Info

- **`as any` in test files** — `EmbeddingBackfillCron` specs use `prisma as any` and `embedding as any` for mock injection. Acceptable in tests where strict typing of the mock doubles would require significant boilerplate. Production code uses proper types.
- **`sales-bot.service.ts` is ~145-line rewrite** — logic paths are covered by new 65-line spec. The systemic-outage breaker (`consecutiveProviderErrors` counter) does not have a test for the reset path (counter resets on first success after hitting the threshold). Recommend adding that case to prevent a "stuck breaker" scenario.
- **No new controller endpoints** — this branch is pure service hardening, no API surface changes.

---

## Security Checks

| Check | Result |
|-------|--------|
| New controller endpoints | ✅ N/A — no new routes |
| `Number()` on money fields | ✅ Pass — no financial calculations; AI usage rows use `Prisma.Decimal` |
| Hardcoded secrets/API keys | ✅ Pass — `apiKey` read from `integrationConfig.getValue('claude-ai', 'apiKey')` |
| `$queryRaw` usage | ✅ Pass — only in test mocks, not production |
| Sentry coverage on cron | ✅ Pass — both per-row and run-level Sentry capture, with distinct tags |
| Raw `fetch()` in frontend | ✅ Pass — `AiSettingsPage.tsx` uses `api.get()` |
