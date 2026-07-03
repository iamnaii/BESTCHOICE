# Merge Guard Report — feat/ai-hardening-followups

**Date**: 2026-07-03  
**Author**: iamnaii <akenarin.ak@gmail.com>  
**Last commit**: fix(ai): systemic-outage breaker in backfill, honest sales-bot errorKind, rolling-window wording — 2 days ago  
**Base**: origin/main (4f0ef17f)

---

## File Changes Summary

30 files changed, +672 / -111 lines

| Area | Key Files |
|------|-----------|
| AI services | `ai-auto-reply.service.ts`, `ai-assistant.service.ts`, `knowledge-extractor.service.ts` |
| AI pricing | `ai-pricing.ts` (refactored), `ai-pricing.spec.ts` |
| OCR | `ocr.service.ts`, `anthropic-ocr.client.ts`, `ocr-extractors.service.ts` |
| Credit check | `credit-check.service.ts`, `credit-check-ai-analysis.service.ts` |
| Sales bot | `sales-bot.service.ts` |
| Vision | `chatbot-finance/services/vision.service.ts` |
| Cron | `embedding-backfill.cron.ts` (circuit breaker added) |
| Frontend | `AiSettingsPage.tsx` (label wording fix) |
| Tests | 11 spec files updated/added |
| Docs | 2 design/plan markdown files updated |

---

## Issues

### Critical

None found.

### Warning

None found.

### Info

**I1 — Test fixture uses literal `'sk-test'` as API key value**  
File: `apps/api/src/modules/credit-check/credit-check.ai-analysis.spec.ts` (and others)

```ts
const config = { getValue: jest.fn().mockResolvedValue('sk-test') }
```

This is in a test file only and is a mock value — not a real secret. No concern.

**I2 — `AiSettingsPage.tsx` uses `Number(e.target.value)` for form input**  
```ts
onChange={(e) => setForm((prev) => ({ ...prev, maxRepliesPerSession: Number(e.target.value) }))}
```
This converts a string input to a JS number for a count field (max replies per session) — not a money field. Correct usage.

**I3 — Circuit breaker in embedding-backfill cron**  
The addition of a systemic-outage circuit breaker in `embedding-backfill.cron.ts` is a positive hardening. Ensure the breaker threshold is configurable via `SystemConfig` rather than hardcoded, to allow ops tuning without a deploy.

---

## Recommendation

**APPROVE** — Hardening and bug fixes across AI services. No new controllers, no guard changes, no financial Decimal issues. Tests are comprehensive (11 spec files). The rolling-window wording fix in `AiSettingsPage.tsx` is UX-only. Clean diff.
