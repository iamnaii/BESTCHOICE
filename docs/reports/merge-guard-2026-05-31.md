# Pre-Merge Guard Report — 2026-05-31

**Reviewed by**: Pre-Merge Guard Agent  
**Date**: 2026-05-31  
**Branches reviewed**: 3 most-recently-updated non-guard branches

---

## Branch 1: `feat/finance-receivable-contact-system`

**Author**: Akenarin Kongdach  
**Commits ahead of main**: 18 commits  
**Files changed**: 36 files, +6,099 / -18 lines  

### File Changes Summary

| Area | Files | Notes |
|------|-------|-------|
| API — new modules | `finance-company-contacts/`, `finance-receivable-contact-logs/` | Full CRUD + cron |
| API — schema | `schema.prisma` + migration `20260964000000` | 2 new models, 2 new enums, 4 new columns on existing tables |
| API — external-finance | extended controller + service | Added master fields + relations |
| Web — pages | `ExternalFinanceCompanyDetailPage.tsx`, `FinanceReceivablePage.tsx`, 3 sub-components | New 4-tab detail page + contact log dialog |
| Web — E2E | `finance-receivable-contact.spec.ts` | New E2E spec |
| Docs | 2 design docs in `docs/reports/` | ~3,700 lines of design notes |

---

### Critical Issues — NONE

- ✅ All new controllers have `@UseGuards(JwtAuthGuard, RolesGuard)` at class level
- ✅ All controller methods have `@Roles()` decorators
- ✅ All Prisma queries include `where: { deletedAt: null }`
- ✅ `$queryRaw` uses `Prisma.sql` template (parameterized, no injection risk)
- ✅ No hardcoded secrets
- ✅ `promisedAmount` schema field is `Decimal @db.Decimal(12, 2)` ✅
- ✅ Frontend uses `api.get()`/`api.post()` via `@/lib/api`, not raw fetch
- ✅ `useQuery`/`useMutation` + `queryClient.invalidateQueries()` pattern correct

---

### Warning Issues

#### W1 — `BrokenPromiseFinanceCron` missing Sentry capture

**File**: `apps/api/src/modules/finance-receivable-contact-logs/crons/broken-promise-finance.cron.ts`

The cron runs daily at 02:00 BKK but has no `try/catch` + `Sentry.captureException` around `$executeRaw`. All other cron jobs were hardened with Sentry in v2 (PR #432) and v4 (PR #444). A silent DB failure here would leave promises un-marked as broken without any alerting.

**Fix**: Wrap the body in `try/catch` and call `Sentry.captureException(err)` on failure (see `broken-promise.cron.ts` for the existing pattern).

```ts
// apps/api/src/modules/finance-receivable-contact-logs/crons/broken-promise-finance.cron.ts
@Cron('0 2 * * *', { timeZone: 'Asia/Bangkok' })
async handleCron(): Promise<number> {
  try {
    const affected = await this.prisma.$executeRaw(Prisma.sql`...`);
    this.logger.log(`...`);
    return Number(affected);
  } catch (err) {
    this.logger.error('broken-promise-finance cron failed', err);
    Sentry.captureException(err, { tags: { cron: 'broken-promise-finance' } });
    return 0;
  }
}
```

---

#### W2 — Float arithmetic on financial `outstanding` value

**File**: `apps/web/src/pages/FinanceReceivablePage/FinanceReceivableDetailDrawer.tsx:756`

```ts
const outstanding = Number(receivable.netExpectedAmount) - Number(receivable.receivedAmount ?? 0);
```

`netExpectedAmount` and `receivedAmount` are `Decimal` strings from the API. Converting to JS `number` before subtraction can produce IEEE-754 floating-point errors (e.g., `100000.10 - 0.10` → `99999.99999999999` in JS float). The `outstanding` value is then:
1. Passed as `outstanding={outstanding > 0 ? outstanding : 0}` to `FinanceContactLogDialog`
2. Used to pre-fill `promisedAmount` as `String(outstanding)`

While the final pre-fill is display/UX only and the backend validates/stores correctly, violating the "use Decimal for money arithmetic" rule creates a subtle UX bug when amounts have non-trivial decimals.

**Fix**: Either add `outstanding` as a pre-computed field on the API response, or use a simple string comparison for the `> 0` check and avoid the subtraction on the frontend:

```ts
// Option A — pass from API (preferred)
// Option B — avoid arithmetic:
const isOutstanding = parseFloat(receivable.netExpectedAmount) > parseFloat(receivable.receivedAmount ?? '0');
const outstandingDisplay = /* keep Number() for toLocaleString display only */
```

---

### Info Issues

#### I1 — `promisedAmount` DTO typed as `number` vs Decimal

**File**: `apps/api/src/modules/finance-receivable-contact-logs/dto/finance-receivable-contact-log.dto.ts`

```ts
@IsNumber({ maxDecimalPlaces: 2 })
@IsPositive()
promisedAmount?: number;
```

The schema stores `promisedAmount` as `Decimal(12,2)`. The DTO accepts `number`, which Prisma correctly coerces to `Decimal` on write. The `maxDecimalPlaces: 2` guard limits precision loss. This is safe but slightly inconsistent with other money fields (which typically use `string` DTOs + backend `new Prisma.Decimal()`). No functional bug but worth aligning in a follow-up.

---

#### I2 — `FinanceReceivableContactLog` is missing a `@@index` on `result`

**File**: `apps/api/prisma/schema.prisma`

The `result` column (`FinanceContactResult` enum) is queried in the cron (`WHERE result = 'PROMISED'`) but has no index. For a table that could accumulate many rows over time, filtering without an index will degrade the cron's query performance.

**Suggested fix**: Add `@@index([result])` or a partial index in the migration SQL:

```sql
CREATE INDEX ON finance_receivable_contact_logs (result)
WHERE result = 'PROMISED' AND promised_broken_at IS NULL AND deleted_at IS NULL;
```

---

### Recommendation: **REVIEW**

Fix **W1** (Sentry on cron) before merge. **W2** (float arithmetic) should also be addressed. Info items are low-priority and can be follow-up tickets.

---

## Branch 2: `fix/fb-webhook-integration-config`

**Author**: Akenarin Kongdach  
**Commits ahead of main**: 1 commit  
**Files changed**: 3 files, +96 / -11 lines  

### File Changes Summary

| File | Change |
|------|--------|
| `chat-adapters.module.ts` | Added `IntegrationConfigService` provider |
| `facebook-webhook.controller.ts` | Reads `verifyToken` + `appSecret` from `IntegrationConfig` instead of env vars |
| `facebook-webhook.controller.spec.ts` | New 68-line test coverage for verify-token + data-deletion flows |

### Issues — NONE

- ✅ Controller is in the intentionally-public list (Facebook webhook — no `JwtAuthGuard` is correct per `security.md`)
- ✅ Fail-closed pattern: `if (mode === 'subscribe' && verifyToken && token === verifyToken)` — correctly rejects when no token is configured
- ✅ HMAC-SHA256 signature verification unchanged
- ✅ No money fields, no `Number()` on financial values
- ✅ Test covers: token match, token mismatch, empty token (fail-closed)
- ✅ No hardcoded secrets (secrets come from `IntegrationConfig` / DB)

### Recommendation: **APPROVE** ✅

---

## Branch 3: `fix/letters-e2e-sales-assertion`

**Author**: Akenarin Kongdach  
**Commits ahead of main**: 1 commit  
**Files changed**: 1 file, +8 / -4 lines  

### File Changes Summary

| File | Change |
|------|--------|
| `apps/web/e2e/letters-page.spec.ts` | Replaced brittle cancel-button absence assertion with page-load check |

### Issues

#### I1 — Weaker test coverage (Info)

The original test asserted that SALES role cannot see the Cancel button. The new test only checks the page loads without redirect. The comment explains the rationale:
- The "ยกเลิก" text appears on both the Cancel action button AND the "CANCELLED" status tab — making the original `getByRole('button', { name: 'ยกเลิก' })` assertion unreliable
- Cancel-button RBAC is covered by backend unit tests (`POST /overdue/letters/:id/cancel` → 403 for SALES)

This is a reasonable trade-off but the coverage gap should be tracked. A follow-up could add a more targeted assertion (e.g., checking the actual row-level action menu, not the tab buttons).

### Recommendation: **APPROVE** ✅ (Info item tracked)

---

## Summary Table

| Branch | Critical | Warning | Info | Recommendation |
|--------|----------|---------|------|----------------|
| `feat/finance-receivable-contact-system` | 0 | 2 | 2 | **REVIEW** |
| `fix/fb-webhook-integration-config` | 0 | 0 | 0 | **APPROVE** ✅ |
| `fix/letters-e2e-sales-assertion` | 0 | 0 | 1 | **APPROVE** ✅ |

### Action Required Before Merging `feat/finance-receivable-contact-system`
1. Add `try/catch` + `Sentry.captureException` to `BrokenPromiseFinanceCron.handleCron()` (W1)
2. Fix float arithmetic on `outstanding` in `FinanceReceivableDetailDrawer.tsx` (W2)
