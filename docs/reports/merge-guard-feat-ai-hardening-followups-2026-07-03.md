# Merge Guard Report — feat/ai-hardening-followups

**Date**: 2026-07-03  
**Author**: iamnaii (akenarin.ak@gmail.com)  
**Commits**: 7 (latest: `fix(staff-chat): embedding backfill survives poison rows`)  
**Diff**: 30 files changed, 672 insertions(+), 111 deletions(-)

---

## Summary of Changes

Three distinct sub-features:

1. **AI Usage Instrumentation (#1317)** — Adds `AiUsageService.record()` calls to 4 previously un-instrumented services: `VisionService`, `KnowledgeExtractorService`, `CreditCheckAiAnalysisService`, and `OcrService`. Credit-check facade grew a 3rd constructor arg (`AiUsageService`); all 8 spec files updated consistently.
2. **Longest-prefix model rate matching** (`ai-pricing.ts`) — Fixes a bug where `gemini-2.5-flash-lite` matched `gemini-2.5-flash` instead of the more specific key. New test covers the overlap case.
3. **Embedding backfill poison-row resilience (#1318)** — `EmbeddingBackfillCron` now processes batches item-by-item on error (instead of dropping the whole batch), permanently skips rows that have failed too many times, and adds SQL-level filtering for empty/whitespace messages. New tests verify the per-row fallback and the SQL shape.

---

## Issues Found

### Critical
*None.*

### Warning

**W1 — `void this.aiUsage.record(...)` fire-and-forget**  
Files: `vision.service.ts:105`, `knowledge-extractor.service.ts:62`  
The usage recording is intentionally fire-and-forget (`void`), consistent with the pattern in other services. However, if `AiUsageService.record()` throws (e.g. DB connection lost), the error is silently swallowed. This is acceptable for telemetry, but consider adding a `.catch(err => this.logger.warn(...))` to at least log the failure.

**W2 — `CreditCheckService` constructor now has 3 positional args**  
File: `apps/api/src/modules/credit-check/credit-check.service.ts:33`  
The constructor is no longer a standard 2-arg DI facade; 8 spec files were updated. If any call site outside the reviewed files still uses 2 args, it will fail at runtime (TypeScript would catch it at compile time). The TypeScript check should be run before merge.

### Info

**I1 — Hardcoded test API key `'sk-test'`**  
File: `credit-check.ai-analysis.spec.ts:204`  
`{ getValue: jest.fn().mockResolvedValue('sk-test') }` — this is a mock in a test file, not a real credential. No issue.

**I2 — `$queryRaw` in backfill cron spec**  
Spec mocks only (`$queryRaw: jest.fn()`). The production `EmbeddingBackfillCron` uses Prisma tagged-template `$queryRaw` (parameterized), confirmed by the test's `const [strings] = prisma.$queryRaw.mock.calls[0]` pattern. No SQL injection risk.

---

## Recommendation: **APPROVE**

- No new controllers, no missing guards, no hardcoded secrets in production code.
- All Prisma queries use `$queryRaw` with tagged templates (not `$queryRawUnsafe`).
- The AiUsage instrumentation closes a monitoring gap — previously 4 Claude/AI calls were un-billed in the usage log.
- Run `./tools/check-types.sh api` before merge to confirm the 3-arg CreditCheckService constructor has no missed call sites.
