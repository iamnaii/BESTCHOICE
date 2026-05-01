# Pre-Merge Guard Report — 2026-05-01

**Guard run**: 2026-05-01  
**Branches reviewed**: 3 of 282 unmerged (most-recently-updated feat/fix)  
**Base**: `origin/main` @ `d37b2d35`

---

## Branch 1: `feat/ai-semantic-retrieval`

**Author**: Akenarin Kongdach  
**Last commit**: `ec3d99d0` — feat(ai): semantic retrieval for shop sales bot via pgvector + Vertex AI  
**Files changed**: 13 files, +603 / -29 lines  

### Summary
Adds pgvector-based semantic retrieval for the AI sales bot. New `EmbeddingService` calls Vertex AI (`text-multilingual-embedding-002`) to embed customer messages; `AiTrainingService.getFewShotExamples` now does cosine-similarity search over stored training pairs when a query is provided, falling back to top-quality sort when Vertex AI is unavailable. Also adds a one-off seed script and dev test-retrieval script.

### Issues

#### Warning

**W1 — `$executeRawUnsafe` in seed script** (`apps/api/scripts/seed-fb-training.ts:262`)  
The seed script uses `prisma.$executeRawUnsafe(sql, ...params)` to insert embeddings in bulk (pgvector cast requires raw SQL). Parameters are passed safely via positional `$N` placeholders — no SQL injection risk — but `$executeRawUnsafe` should be documented at the call site. This is a one-off admin script, not a production API endpoint, so risk is contained.  
*Recommendation*: Add a comment clarifying the `$executeRawUnsafe` is safe here (parameterized, not templated). Low priority.

**W2 — `csv-parse` added as production dependency** (`apps/api/package.json:52`)  
`csv-parse` is only used by `scripts/seed-fb-training.ts`, a one-off admin script. It should be a `devDependency` to avoid bloating the production bundle.

**W3 — Migration timestamp is in the future** (`apps/api/prisma/migrations/20260801000000_add_pgvector_to_ai_training_pairs/migration.sql`)  
Migration is stamped `2026-08-01`, which is 3 months ahead of today (2026-05-01). Prisma runs migrations in lexicographic order — this will run after all current migrations, but future migrations might accidentally be created with a timestamp between today and August 2026, causing ordering ambiguity. Recommend renaming to the actual merge date before merging.

**W4 — `any` type in test-retrieval script** (`apps/api/scripts/test-retrieval.ts:304`)  
`const j: any = await res.json()` loses type safety. Low risk (dev script only) but inconsistent with the typed `VertexEmbeddingResponse` interface in `embedding.service.ts`.

#### Info

**I1 — `SHOP_SALES_PERSONA` hardcodes store-specific data**  
`sales-persona.ts` embeds phone number (095-567-8887), address, and a Google Maps URL directly. This is intentional (prompt engineering) but will require a code change if store details change. Acceptable for now.

**I2 — Graceful degradation correctly implemented**  
`EmbeddingService.isReady()` returns `false` when `GOOGLE_CLOUD_PROJECT` is unset. `AiTrainingService` falls back to top-quality sort on any error. Production will not break on Vertex AI outage.

**I3 — Production semantic search uses safe `$queryRaw` tagged template**  
`ai-training.service.ts` uses `prisma.$queryRaw\`...\`` (the safe tagged-template form) with the pgvector literal. No SQL injection vector.

### Recommendation: **REVIEW**

Fix W2 (move `csv-parse` to devDependencies) and W3 (rename migration timestamp) before merge. W1 and W4 are low risk but worth cleaning up.

---

## Branch 2: `fix/accounting-w2-w4-frontend`

**Author**: Akenarin Kongdach  
**Last commit**: `2941131a` — feat(accounting): W-2 + W-4 + frontend  
**Unique diff**: 1 commit on top of `fix/accounting-phase-a3-ic-settlement` merge base  
**Files changed**: 8 files, +405 / -37 lines  

### Summary
Two accounting fixes bundled with a new frontend page:
- **Phase W-2**: Replaces `SELECT ... FOR UPDATE` with `pg_advisory_xact_lock` in both `generateJournalEntryNumber` and `generateReceiptNumber` to prevent first-of-month race conditions.
- **Phase W-4**: Reworks early-payoff discount JE to post income lines at full original amounts and add explicit `Dr Sales Discount Interest / Commission` expense lines — makes discounts visible as P&L line items instead of hidden in income asymmetry.
- **Frontend**: New `IntercompanySettlementPage.tsx` + route `/accounting/intercompany` (depends on backend in `fix/accounting-phase-a3-ic-settlement`).

### Issues

#### Critical

**C1 — Frontend page depends on backend from a separate unmerged branch**  
`IntercompanySettlementPage.tsx` calls `GET /accounting/intercompany/balance` and `POST /accounting/intercompany/settle`. The backend controller for these endpoints lives in `fix/accounting-phase-a3-ic-settlement`, which is NOT yet merged. Merging this branch alone will result in the page loading with `404` API errors at runtime.  
**Must merge `fix/accounting-phase-a3-ic-settlement` first (or together).**

#### Warning

**W1 — `pg_advisory_xact_lock` lock-key collision risk** (`journal-auto.service.ts:126`, `receipts.service.ts:306`)  
Journal entries use `lockKey = parseInt(ym, 10)` (e.g., `202605`).  
Receipts use `lockKey = parseInt('1' + year + month, 10)` (e.g., `1202605`).  
These are distinct namespaces — no collision between JE and receipt generation. However, other services that use `pg_advisory_xact_lock` with integer keys in the same DB session could conflict if they happen to use the same numeric values. This is unlikely but undocumented. Consider adding a comment noting the namespacing convention.

**W2 — `parseFloat(amount)` on user input in `IntercompanySettlementPage.tsx`** (line 443)  
User-typed amount is converted via `parseFloat(amount)` before sending to the API. `parseFloat('1e10')` = 10,000,000,000, which would pass a naive positive check. The backend DTO has `@IsPositive()` and `@IsNumber({ maxDecimalPlaces: 2 })` — `1e10` has 0 decimal places and IS positive, so it would pass validation. The frontend does cap at `balance.financeOwesToShop`, but only with a client-side `toast.error`. A malformed value like `1e308` could theoretically pass. Recommend converting to a fixed-decimal string or using `Number.parseFloat` + `toFixed(2)` before sending.

#### Info

**I1 — `settlementHistory` client-side filter is fragile** (`IntercompanySettlementPage.tsx:463`)  
History filtering: `e.description?.includes('IC-') && e.description?.includes('ชำระเงินระหว่างบริษัท')`. If the description format changes, this silently returns empty. Should filter by `referenceType === 'IC_SETTLEMENT'` server-side instead.

**I2 — W-4 test expectations correctly updated**  
`journal-auto.service.spec.ts` tests are updated to match the new explicit-discount pattern. The "balance when discount applied" test now expects `Interest Income Cr = 300` (full) + `Sales Discount Dr = 225` (interest 150 + vat 75), which is correct double-entry.

**I3 — Legacy zero-breakdown fallback handled correctly**  
When `sumOtherOrig.isZero()`, the code falls back to a flat HP Receivable drain without income recognition. This correctly handles historical contracts that lack per-component breakdown.

### Recommendation: **BLOCK**

Must merge `fix/accounting-phase-a3-ic-settlement` first. After that, re-classify to REVIEW (address W2 before shipping to production).

---

## Branch 3: `fix/accounting-phase-a3-ic-settlement`

**Author**: Akenarin Kongdach  
**Last commit**: `ae734a73` — feat(accounting): Phase A.3 (W-5) — Inter-company settlement JE  
**Unique diff**: 2 commits  
**Files changed**: 8 files, +474 / -0 lines (pure additions)  

### Summary
Implements Phase A.3 (W-5): inter-company settlement JE. New `IntercompanyModule` with controller, service, DTO, and tests. `JournalAutoService.createInterCompanySettlementJournal` posts paired SHOP+FINANCE double-entry JEs that reduce `Due-to-SHOP` (FINANCE 21-1102) and `Due-from-FINANCE` (SHOP 11-2105) symmetrically. The service includes a balance-drift detector and prevents over-settlement.

### Issues

#### Critical

None found.

#### Warning

**W1 — `SettleIntercompanyDto.amount` typed as `number`, not `Decimal`** (`dto/settle-intercompany.dto.ts:5`)  
`amount!: number` with `@IsNumber({ maxDecimalPlaces: 2 })` is the correct pattern for JSON deserialization. The service immediately wraps it with `new Prisma.Decimal(dto.amount)`. This is consistent with the project pattern. Flagging only because the CLAUDE.md rule says "ใช้ Decimal สำหรับจำนวนเงิน" — in DTOs, `number` at the boundary is correct, but the comment should make this clear.

**W2 — `settle()` calls `getOutstandingBalance()` and then starts a transaction**  
There is a TOCTOU (time-of-check-time-of-use) window: the balance is checked outside the transaction, then the JE is posted inside it. A concurrent settlement could post between the check and the transaction. Acceptable for now given the low concurrency of this operation (finance staff only), but should be noted.

#### Info

**I1 — Guards correctly applied**  
`@UseGuards(JwtAuthGuard, RolesGuard)` at class level ✅  
`@Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')` on GET ✅  
`@Roles('OWNER', 'FINANCE_MANAGER')` on POST (write-restricted) ✅

**I2 — `deletedAt: null` present in all queries**  
`journalLine.aggregate` where clauses include `deletedAt: null` on both journalLine and journalEntry. ✅

**I3 — No new migration required**  
The service reads existing `journal_lines` data — no schema changes needed. ✅

**I4 — 124 service tests + 92 JournalAutoService tests**  
Test coverage is thorough: balance matching, drift detection, over-settlement guard, zero-amount guard, missing company guard. ✅

**I5 — Double-entry accounting is correct**  
FINANCE: `Dr Due-to-SHOP / Cr Cash` ✅  
SHOP: `Dr Cash / Cr Due-from-FINANCE` ✅  
Symmetric — IC invariant preserved before and after settlement.

### Recommendation: **APPROVE**

Clean implementation. Merge this branch before `fix/accounting-w2-w4-frontend`. Address W2 (TOCTOU) in a follow-up if settlement volume increases.

---

## Overall Merge Order Recommendation

```
1. fix/accounting-phase-a3-ic-settlement  →  APPROVE (merge first)
2. fix/accounting-w2-w4-frontend          →  REVIEW  (merge after #1, fix W2 parseFloat)
3. feat/ai-semantic-retrieval             →  REVIEW  (fix csv-parse devDep + migration timestamp)
```

---

*Generated by Pre-Merge Guard agent — 2026-05-01*
