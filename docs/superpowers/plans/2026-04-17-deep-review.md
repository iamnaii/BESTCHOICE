# Deep Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sequential deep audit + auto-fix across 11 dimensions of the BESTCHOICE monorepo — produce clean commit chain, green tests, and final report.

**Architecture:** Per-dimension 6-step cycle (audit → triage → fix → verify → commit → report entry). Audit dispatches a sonnet Explore subagent per dimension; opus triages, fixes, verifies, commits. E2E runs in Verify step of every dimension. Final Task 12 does full-suite E2E + report finalize.

**Tech Stack:** NestJS + Prisma + PostgreSQL, React 18 + Vite + Tailwind + shadcn/ui, Playwright E2E, Turborepo monorepo.

---

## File Structure

**Created during execution:**
- `docs/reports/2026-04-17-deep-review.md` — running report (Task 0 scaffolds, each task appends)
- New E2E specs (Task 11) under `apps/web/e2e/<flow>.spec.ts` — only for flows not yet covered

**Modified during execution:** Varies by audit findings — typical locations:
- `apps/api/src/modules/**/*.service.ts` (decimal, soft-delete, guards)
- `apps/api/src/modules/**/*.controller.ts` (guards, roles)
- `apps/api/prisma/schema.prisma` (indexes, relations)
- `apps/web/src/**/*.tsx` (design tokens, React Query, A11y)
- `apps/web/src/lib/**/*.ts` (API client, state)

**Principle:** 1 dimension = 1 commit (or 2-3 if internal domain split is natural).

---

## Task 0: Setup — Baseline + Report Scaffold

**Files:**
- Create: `docs/reports/2026-04-17-deep-review.md`

- [ ] **Step 1: Capture baseline test counts**

Run:
```bash
cd apps/api && npm test -- --silent 2>&1 | tail -5
cd apps/web && npm test -- --silent 2>&1 | tail -5
cd apps/web && npx playwright test --list 2>&1 | tail -3
```
Note the counts for: API tests, Web unit tests, E2E specs.

- [ ] **Step 2: Verify clean baseline before starting**

Run:
```bash
./tools/check-types.sh all
```
Expected: 0 errors. If errors exist, STOP — baseline must be clean.

- [ ] **Step 3: Create report scaffold**

Write to `docs/reports/2026-04-17-deep-review.md`:

```markdown
# Deep Review Report — 2026-04-17

**Spec:** [docs/superpowers/specs/2026-04-17-deep-review-design.md](../superpowers/specs/2026-04-17-deep-review-design.md)

## Baseline
- API tests: [N] suites, [N] tests
- Web unit tests: [N] files, [N] tests
- E2E specs: [N] specs
- TypeScript: 0 errors

## Dimensions

### 1. Database & Schema
_pending_

### 2. Security
_pending_

### 3. Correctness (core)
_pending_

### 4. Accounting logic
_pending_

### 5. Backend patterns
_pending_

### 6. Integrations
_pending_

### 7. Frontend core
_pending_

### 8. Frontend polish
_pending_

### 9. Performance & Ops
_pending_

### 10. Tests + DX
_pending_

### 11. E2E Coverage Audit
_pending_

## Final
_pending_
```

Fill the baseline numbers from Step 1.

- [ ] **Step 4: Commit**

```bash
git add docs/reports/2026-04-17-deep-review.md
git commit -m "docs: scaffold deep review report (2026-04-17)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 1: Dimension 1 — Database & Schema

**Files to scan:**
- `apps/api/prisma/schema.prisma`
- `apps/api/prisma/migrations/**`

- [ ] **Step 1: Dispatch audit subagent**

Use Agent tool with `subagent_type: Explore`, thoroughness "very thorough":

```
Audit the BESTCHOICE Prisma schema + migrations for issues. Report structured findings.

Context: See /Users/iamnaii/Desktop/App/BESTCHOICE/.claude/rules/database.md for rules. Read git log -20 FIRST — skip any finding that matches commits already merged (e.g., FK cascade fixes, missing FK indexes — v3 already did many).

Check these patterns:
1. Models missing soft-delete (deletedAt DateTime?)
2. Models missing timestamps (createdAt, updatedAt)
3. Money fields using Float or Int instead of Decimal @db.Decimal(12,2)
4. Missing indexes on fields queried in services (check corresponding service.ts files)
5. Missing composite indexes for multi-field WHERE clauses
6. onDelete: Cascade on tables that hold legal/audit evidence (should be Restrict — see v3)
7. Relations without @relation name when multiple relations to same model
8. Enums in wrong case (should be SCREAMING_SNAKE_CASE for values)
9. UUID usage — should be @default(uuid()), never autoincrement
10. Migrations with required fields added without @default on populated tables

Return findings as:
[{severity: 'Critical'|'Warning'|'Info', file: 'path:line', root_cause: '...', fix_proposal: '...'}]

Do not propose fixes for items already done in v1-v4 hardening (see CLAUDE.md). Under 400 words total.
```

- [ ] **Step 2: Triage findings**

Read findings. For each:
- Verify 1-2 via Read/Grep (confirm not false positive)
- Group by root cause
- Drop duplicates with recent commits (`git log --oneline -30`)

- [ ] **Step 3: Apply fixes**

For each verified finding, make the edit. If fix requires migration:
```bash
cd apps/api && npx prisma migrate dev --name <descriptive_name> --create-only
```
Review generated SQL before applying.

- [ ] **Step 4: Verify**

Run:
```bash
cd apps/api && npx prisma generate
./tools/check-types.sh all
cd apps/api && npm test -- --silent
cd apps/web && npx playwright test e2e/contracts.spec.ts e2e/customers.spec.ts --reporter=line
```
Expected: all pass. If E2E flaky, retry once.

- [ ] **Step 5: Commit**

```bash
git add apps/api/prisma/ apps/api/src/
git commit -m "fix(db): <summary> (<n> findings)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

- [ ] **Step 6: Update report**

Edit `docs/reports/2026-04-17-deep-review.md` section 1 with finding count, fix summary, files touched, test status.

---

## Task 2: Dimension 2 — Security

**Files to scan:**
- `apps/api/src/modules/**/*.controller.ts` (guards, @Roles)
- `apps/api/src/guards/`, `apps/api/src/modules/auth/`
- `apps/web/src/lib/api.ts`, `apps/web/src/contexts/AuthContext.tsx`

- [ ] **Step 1: Dispatch audit subagent**

Use Agent tool with `subagent_type: Explore`, thoroughness "very thorough":

```
Audit BESTCHOICE security posture. Report structured findings.

Context: /Users/iamnaii/Desktop/App/BESTCHOICE/.claude/rules/security.md defines the rules. Read git log -30 FIRST — recent PRs #430-#448 did massive security hardening (account lockout, PII masking, LINE/FB signature verify, webhook throttle, paysolutions atomicity, CSRF, throttle). SKIP duplicates.

Check:
1. Controllers without @UseGuards(JwtAuthGuard, RolesGuard) (except intentionally-public listed in rules/security.md: chatbot-finance-liff, sms-webhook, paysolutions, address)
2. Methods without @Roles() decorator
3. JWT stored in localStorage/sessionStorage/cookie (should be in-memory)
4. Raw SQL without parameterization
5. User input reflected in responses without escaping (XSS)
6. Console.log / Logger calls that include tokens/passwords/PII (phone, email, IMEI)
7. Secrets in committed files (scan .env.example vs .env references)
8. Public endpoints (no JwtAuthGuard) that mutate data
9. Role bypass — service layer that skips role check from controller
10. CORS, Helmet, throttle config in main.ts
11. Webhook verification (HMAC/signature) on inbound webhooks

Return findings as:
[{severity, file:line, root_cause, fix_proposal}]

Under 400 words.
```

- [ ] **Step 2: Triage**

Verify each finding. Cross-check `rules/security.md` "Intentionally Public Endpoints" list before flagging missing guards.

- [ ] **Step 3: Apply fixes**

Add missing guards, move tokens to in-memory, mask PII in logs, add webhook verification.

- [ ] **Step 4: Verify**

Run:
```bash
./tools/check-types.sh all
cd apps/api && npm test -- --silent
cd apps/web && npx playwright test e2e/login.spec.ts e2e/admin-settings.spec.ts --reporter=line
```
Expected: pass. Auth-related E2E are critical — no flaky allowed.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/ apps/web/src/
git commit -m "fix(security): <summary> (<n> findings)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

- [ ] **Step 6: Update report** — section 2

---

## Task 3: Dimension 3 — Correctness (core)

**Files to scan:**
- All `apps/api/src/modules/**/*.service.ts`

- [ ] **Step 1: Dispatch audit subagent**

```
Audit BESTCHOICE for correctness bugs. Report findings.

Context: v2-v4 did massive Decimal precision sweep (53 Number() → Prisma.Decimal across 12 services) and added soft-delete, Serializable transactions. Read git log -40 first — skip duplicates.

Check:
1. `Number(sum)` or `parseFloat(decimal)` on Decimal values (should use Prisma.Decimal arithmetic)
2. Money calculations using JS number operators instead of Decimal .add/.sub/.mul/.div
3. Prisma queries missing `where: { deletedAt: null }` (soft-delete leak)
4. Multi-step mutations NOT wrapped in `this.prisma.$transaction(...)` 
5. Transactions without `isolationLevel: Serializable` where concurrent writes possible (payments, contracts, journal)
6. Race conditions: read-then-write without transaction or version lock
7. Off-by-one in date math (especially due date, grace period)
8. Boolean/null conflation (if (value) vs if (value != null))
9. Async functions missing await
10. Promise.all swallowing errors on one branch

Return findings. Under 400 words.
```

- [ ] **Step 2: Triage + Step 3: Fix**

Apply Prisma.Decimal, wrap in transactions, add soft-delete filters.

- [ ] **Step 4: Verify**

```bash
./tools/check-types.sh all
cd apps/api && npm test -- --silent
cd apps/web && npx playwright test e2e/installment-calculation.spec.ts e2e/early-payoff.spec.ts --reporter=line
```

- [ ] **Step 5: Commit**

```bash
git commit -m "fix(correctness): <summary> (<n> findings)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

- [ ] **Step 6: Update report** — section 3

---

## Task 4: Dimension 4 — Accounting Logic

**Files to scan:**
- `apps/api/src/modules/accounting/`, `journal`, `tax`, `commission`, `bad-debt`, `contracts/hp-*.service.ts`

- [ ] **Step 1: Dispatch audit subagent**

```
Audit BESTCHOICE accounting logic for compliance with TFRS for NPAEs. Report findings.

Context: /Users/iamnaii/Desktop/App/BESTCHOICE/.claude/rules/accounting.md has the chart of accounts + journal templates. Read git log -40 — v4 added bad-debt write-off journal, journal unbalanced throw+Sentry, fixed journal precision. Skip duplicates.

Check:
1. Journal entries: Dr = Cr (must balance — v4 made unbalanced throw)
2. Payment Received journal uses correct accounts: Dr Cash / Cr HP Receivable + Commission + VAT + Late Fee
3. Contract Activation journal: Dr HP Receivable / Cr Revenue + VAT; Dr COGS / Cr Inventory
4. VAT 7% applies to (principal + commission + interest) for FINANCE — NOT to SHOP (not VAT registered)
5. Late fees NOT subject to VAT (policy)
6. Revenue recognition: cash basis for revenue, accrual for expenses
7. Interest: straight-line (not effective rate)
8. Inter-company uses single InterCompanyTransaction record (not cross-entity double-entry) — by design
9. Allowance for doubtful debt + write-off sequence correct
10. Commission income recognized on payment received (not contract activation)
11. Soft-delete cascading to journal (journal must persist even if contract soft-deleted — legal record)

Deferred items — DO NOT flag (CR-001 VAT on interest, N-005 interest upfront, GFIN integration).

Return findings. Under 400 words.
```

- [ ] **Step 2-3: Triage + Fix**

- [ ] **Step 4: Verify**

```bash
./tools/check-types.sh all
cd apps/api && npm test -- --silent
cd apps/web && npx playwright test e2e/finance.spec.ts e2e/contract-workflow.spec.ts --reporter=line
```

- [ ] **Step 5: Commit**

```bash
git commit -m "fix(accounting): <summary> (<n> findings)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

- [ ] **Step 6: Update report** — section 4

---

## Task 5: Dimension 5 — Backend Patterns

**Files to scan:**
- `apps/api/src/modules/**/*.controller.ts`, `*.service.ts`, `dto/`

- [ ] **Step 1: Dispatch audit subagent**

```
Audit BESTCHOICE backend pattern conformance. Report findings.

Context: /Users/iamnaii/Desktop/App/BESTCHOICE/.claude/rules/backend.md — pattern is controller→service→PrismaService. Reference: apps/api/src/modules/customers/. Read git log -20.

Check:
1. Controller calling PrismaService directly (must go through service)
2. DTOs without class-validator decorators
3. DTOs without Thai error messages
4. Missing separate CreateDto / UpdateDto (UpdateDto fields must be @IsOptional)
5. Service throwing generic Error instead of NestJS exceptions (NotFoundException, BadRequestException, ConflictException, ForbiddenException)
6. List endpoints without pagination (`?page=1&limit=50` shape: {data, total, page, limit})
7. Unbounded findMany (no limit, no where filter)
8. Module not registered in app.module.ts
9. Services not exported from module where needed
10. File upload endpoints without S3 config check

Return findings. Under 400 words.
```

- [ ] **Step 2-3: Triage + Fix**

- [ ] **Step 4: Verify**

```bash
./tools/check-types.sh all
cd apps/api && npm test -- --silent
cd apps/web && npx playwright test e2e/crud-flows.spec.ts --reporter=line
```

- [ ] **Step 5: Commit**

```bash
git commit -m "fix(backend): <summary> (<n> findings)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

- [ ] **Step 6: Update report** — section 5

---

## Task 6: Dimension 6 — Integrations

**Files to scan:**
- `apps/api/src/modules/{line-*,facebook,paysolutions,mdm,sms,integrations}/**`

- [ ] **Step 1: Dispatch audit subagent**

```
Audit BESTCHOICE external integrations. Report findings.

Context: v3-v4 hardened PaySolutions (timeout 15s, abort, idempotent webhook, orphan-intent Sentry), LINE (signature verify, cookie for ID token), Facebook (timingSafeEqual, signature verify), SMS webhook throttle. Read git log -40 — skip duplicates.

Check all integrations:
1. Outbound HTTP calls without timeout or AbortController
2. Webhook handlers without signature verification
3. Webhook handlers that are not idempotent (retry = double-process)
4. Gateway call NOT wrapped in try/catch with Sentry capture
5. Gateway + DB write NOT in $transaction (orphan risk)
6. Retry logic missing for transient errors
7. Rate limiting / throttle on webhook endpoints
8. Credentials in plain log
9. Provider status/error mapped to generic 500 (should map meaningfully)
10. Integration config not validated at boot (missing env vars)

Return findings. Under 400 words.
```

- [ ] **Step 2-3: Triage + Fix**

- [ ] **Step 4: Verify**

```bash
./tools/check-types.sh all
cd apps/api && npm test -- --silent
cd apps/web && npx playwright test e2e/admin-settings.spec.ts --reporter=line
```

- [ ] **Step 5: Commit**

```bash
git commit -m "fix(integrations): <summary> (<n> findings)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

- [ ] **Step 6: Update report** — section 6

---

## Task 7: Dimension 7 — Frontend Core

**Files to scan:**
- `apps/web/src/pages/**`, `hooks/**`, `lib/api.ts`, `store/**`

- [ ] **Step 1: Dispatch audit subagent**

```
Audit BESTCHOICE frontend core patterns. Report findings.

Context: /Users/iamnaii/Desktop/App/BESTCHOICE/.claude/rules/frontend.md — React Query only, no raw fetch, Zustand for complex state, shadcn/ui. v1 added QueryBoundary to ~44 pages, v4 added 6 more. Read git log -30.

Check:
1. Pages using raw useEffect + fetch (should be useQuery)
2. Pages using raw axios or fetch (should use @/lib/api)
3. Mutations missing queryClient.invalidateQueries after success
4. Components using alert() / confirm() (should be toast.* or ConfirmDialog)
5. Class components (must be functional + hooks)
6. Pages not lazy-loaded via React.lazy()
7. Pages without QueryBoundary wrapping data sections
8. Pages without ProtectedRoute wrapper (except public)
9. useEffect with missing deps (react-hooks/exhaustive-deps)
10. Search inputs without useDebounce
11. Controlled forms submitting without validation
12. Global state in component state (should be Zustand if shared across routes)

Return findings. Under 400 words.
```

- [ ] **Step 2-3: Triage + Fix**

- [ ] **Step 4: Verify**

```bash
./tools/check-types.sh all
cd apps/web && npm test -- --silent
cd apps/web && npx playwright test e2e/dashboard.spec.ts e2e/customers.spec.ts --reporter=line
```

- [ ] **Step 5: Commit**

```bash
git commit -m "fix(web-core): <summary> (<n> findings)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

- [ ] **Step 6: Update report** — section 7

---

## Task 8: Dimension 8 — Frontend Polish

**Files to scan:**
- `apps/web/src/**/*.tsx`, `apps/web/src/**/*.css`

- [ ] **Step 1: Dispatch audit subagent**

```
Audit BESTCHOICE frontend polish. Report findings.

Context: /Users/iamnaii/Desktop/App/BESTCHOICE/.claude/rules/frontend.md — design tokens only, no hardcoded colors, IBM Plex Sans Thai + leading-snug for Thai. Recent commits 86f3db27, df5c7498, 43c8b5ac fixed many gray/hex issues. Read git log -20.

Check all .tsx/.css:
1. Hardcoded hex colors (#xxx, #xxxxxx) outside index.css tokens
2. Tailwind classes: text-gray-*, bg-gray-*, bg-white (except print/receipt context — grep for data-print or receipt)
3. border-gray-*, hover:bg-gray-* (should use border-border, hover:bg-accent)
4. Thai text with leading-none (cuts upper diacritics)
5. Missing leading-snug on Thai text (badges, labels, multi-line Thai)
6. alt="" on <img> (should have meaningful alt, or aria-hidden if decorative)
7. <div> with onClick (should be <button>)
8. Missing aria-label on icon-only buttons
9. Missing SkipLink at page top
10. Tailwind classes with arbitrary values [#xxx] when token exists
11. Icon imports not from lucide-react (other libraries = violation)

Return findings. Under 400 words.
```

- [ ] **Step 2-3: Triage + Fix**

- [ ] **Step 4: Verify**

```bash
./tools/check-types.sh all
cd apps/web && npm test -- --silent
cd apps/web && npx playwright test e2e/dashboard.spec.ts --reporter=line
```

- [ ] **Step 5: Commit**

```bash
git commit -m "fix(web-polish): <summary> (<n> findings)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

- [ ] **Step 6: Update report** — section 8

---

## Task 9: Dimension 9 — Performance & Ops

**Files to scan:**
- Services with Prisma queries, cron jobs, BullMQ workers, retention scripts

- [ ] **Step 1: Dispatch audit subagent**

```
Audit BESTCHOICE performance + ops. Report findings.

Context: v3-v4 added Sentry to 17+ cron jobs, retention crons (AuditLog 1yr, NotificationLog 6mo, ChatMessage 6mo, DocumentAuditLog 2yr), bundle split (exceljs/jspdf/recharts), /health endpoint, x-request-id. Read git log -40.

Check:
1. N+1 queries (findMany then forEach → fetch related) — should use `include` / nested select
2. Unbounded findMany (no take limit) in list endpoints or aggregations
3. .count() + findMany separately (should use Promise.all or single query)
4. Missing indexes on high-freq WHERE columns (cross-check schema vs query)
5. Large files loaded into memory (should stream)
6. Cron jobs without Sentry capture on failure
7. Cron jobs without lock (multiple runners could double-execute)
8. Missing retention policy on log tables
9. Missing health check probe (DB, S3, Redis)
10. Structured logging missing on core services (should have x-request-id correlation)
11. Frontend bundle — check vite.config.ts for manual chunks
12. Images not lazy-loaded (loading="lazy")

Return findings. Under 400 words.
```

- [ ] **Step 2-3: Triage + Fix**

- [ ] **Step 4: Verify**

```bash
./tools/check-types.sh all
cd apps/api && npm test -- --silent
cd apps/web && npx playwright test e2e/dashboard.spec.ts --reporter=line
cd apps/web && npm run build 2>&1 | tail -20
```
Check bundle size output — flag if initial bundle > 800KB gzip.

- [ ] **Step 5: Commit**

```bash
git commit -m "fix(perf): <summary> (<n> findings)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

- [ ] **Step 6: Update report** — section 9

---

## Task 10: Dimension 10 — Tests + DX

**Files to scan:**
- `apps/api/**/*.spec.ts`, `apps/web/src/**/*.test.tsx`, `.eslintrc`, `tsconfig.json`

- [ ] **Step 1: Dispatch audit subagent**

```
Audit BESTCHOICE tests + developer experience. Report findings.

Context: Baseline — 577 API tests / 129 Web tests / 35 E2E specs. v4 added 177 API tests. Type errors = 0. Read git log -30.

Check:
1. Services without any corresponding *.spec.ts (flag top-10 most-called services)
2. Tests that mock too much (should test real behavior)
3. Tests that don't assert (only setup, no expect)
4. Skipped tests (it.skip, describe.skip, xit) without tracking comment
5. tsconfig strict mode disabled
6. ESLint rules disabled inline without comment explaining why
7. Unused imports (ts-unused-exports or lint)
8. Any type usage (should be specific — recent sweep done, but check new code)
9. // @ts-ignore / // @ts-expect-error without ticket reference
10. Missing @types packages
11. README / docs references to removed scripts (e.g., scripts/backup.sh deleted 2026-04-09)
12. Husky/lint-staged broken or missing
13. Git hooks bypass patterns (--no-verify in scripts)

Return findings. Under 400 words.
```

- [ ] **Step 2-3: Triage + Fix**

- [ ] **Step 4: Verify**

```bash
./tools/check-types.sh all
cd apps/api && npm test -- --silent
cd apps/web && npm test -- --silent
cd apps/web && npm run lint 2>&1 | tail -20
```

- [ ] **Step 5: Commit**

```bash
git commit -m "fix(tests-dx): <summary> (<n> findings)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

- [ ] **Step 6: Update report** — section 10

---

## Task 11: Dimension 11 — E2E Coverage Audit

**Files to scan + modify:**
- `apps/web/e2e/*.spec.ts`
- Create new specs for uncovered critical flows

- [ ] **Step 1: List existing E2E specs + map to flows**

Run:
```bash
ls apps/web/e2e/*.spec.ts
```

Map each spec to the flow it covers. Identify gaps against critical flows:
- **POS sale (cash + installment)** — apps/web/src/pages/POSPage.tsx
- **Payment recording (cash/transfer/QR)** — apps/web/src/pages/PaymentsPage.tsx  
- **Contract sign (LINE LIFF)** — apps/web/src/pages/liff/*
- **LIFF customer portal** — apps/web/src/pages/liff/*
- **Trade-in workflow** — apps/web/src/pages/TradeInPage.tsx
- **Repossession workflow** — apps/web/src/pages/RepossessionsPage.tsx

- [ ] **Step 2: Dispatch audit subagent for gap analysis**

```
Map BESTCHOICE E2E coverage to critical business flows. Identify gaps.

List all specs in apps/web/e2e/*.spec.ts with a 1-line summary of what each covers. Then compare against this critical-flow list:
- POS sale (cash + installment)
- Payment recording (cash/transfer/QR/PaySolutions intent)
- Contract sign via LINE LIFF
- LIFF customer portal (view contract, history, early payoff)
- Trade-in workflow (inspect → price → pay → stock in)
- Repossession workflow (schedule → execute → resale)
- Bad debt write-off
- Commission settlement
- Tax report generation

Output:
1. Coverage matrix: flow → covered? (yes/partial/no) + spec file
2. List of gaps needing new smoke tests
3. List of existing specs that look flaky (based on .skip, .only, long timeouts, or manual waits)

Under 400 words.
```

- [ ] **Step 3: Triage — pick gaps to close**

Pick 3-5 most critical gaps (prefer: POS, Payment, LIFF contract sign, LIFF portal). Defer the rest to followup in report.

- [ ] **Step 4: Write smoke test for gap #1 (POS installment sale)**

Follow pattern from `apps/web/e2e/full-flow-installment.spec.ts`. Create `apps/web/e2e/pos-sale.spec.ts` if not exists:

```typescript
import { test, expect } from '@playwright/test';

test('POS: complete installment sale with down payment', async ({ page }) => {
  await page.goto('/login');
  await page.fill('input[name="email"]', 'sales1@bestchoice.com');
  await page.fill('input[name="password"]', 'admin1234');
  await page.click('button[type="submit"]');
  await page.waitForURL('/');
  
  await page.goto('/pos');
  // TODO: exact selectors depend on current POS UI — inspect and fill
  // 1. Select customer
  // 2. Select product
  // 3. Choose installment plan (6 months)
  // 4. Enter down payment
  // 5. Confirm sale
  // 6. Assert: redirected to contract signing or success page
  // 7. Assert: toast success
});
```

Fill in selectors by inspecting `POSPage.tsx` and existing POS-related specs.

- [ ] **Step 5: Run new test, fix until green**

```bash
cd apps/web && npx playwright test e2e/pos-sale.spec.ts --reporter=line --headed
```

Iterate until green. If flaky on 2 retries, mark with `test.skip` + comment `// TODO: de-flake`.

- [ ] **Step 6: Repeat Steps 4-5 for remaining critical gaps**

Priority order: Payment recording → LIFF contract sign → LIFF customer portal → (optional: trade-in, repossession)

- [ ] **Step 7: Run FULL E2E suite**

```bash
cd apps/web && npx playwright test --reporter=line
```

Expected: all pass (or only pre-existing flaky skipped, documented in report). If new test regressions, fix.

- [ ] **Step 8: Commit**

```bash
git add apps/web/e2e/
git commit -m "test(e2e): close coverage gaps on POS/payment/LIFF (<n> specs)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

- [ ] **Step 9: Update report** — section 11

Include: coverage matrix, new specs added, gaps deferred.

---

## Task 12: Final Verification + Report

- [ ] **Step 1: Run full test suite**

```bash
./tools/check-types.sh all
cd apps/api && npm test -- --silent 2>&1 | tail -5
cd apps/web && npm test -- --silent 2>&1 | tail -5
cd apps/web && npx playwright test --reporter=line 2>&1 | tail -20
cd apps/web && npm run build 2>&1 | tail -10
```

All must be green. If any regression, fix (create sub-commit scoped to that regression).

- [ ] **Step 2: Diff stats**

Run:
```bash
git log --oneline --since="2026-04-17 12:00" 
git diff --stat HEAD~12..HEAD
```
Capture: commits, files changed, insertions/deletions.

- [ ] **Step 3: Finalize report**

Edit `docs/reports/2026-04-17-deep-review.md` — add final section:

```markdown
## Final

- Commits: [N] (from `<hash>` to `<hash>`)
- Files changed: [N]
- Insertions / Deletions: +[N] / -[N]
- TypeScript: 0 errors
- API tests: [N] (baseline [N]) — [new/changed]
- Web unit tests: [N] (baseline [N])
- E2E specs: [N] (baseline [N]) — +[new]
- Bundle size: [X] KB gzip initial (baseline pre-v3: ~[X])

### Deferred Items (followup needed)
- [list of items identified but out of scope]

### Flaky / Skipped Tests
- [list with reason]

### Recommendations for next hardening cycle
- [top 3-5 areas that could benefit from future work]
```

- [ ] **Step 4: Commit report finalization**

```bash
git add docs/reports/2026-04-17-deep-review.md
git commit -m "docs: finalize deep review report (11 dimensions, all green)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

- [ ] **Step 5: Summary to user**

Print summary:
```
Deep review complete.
- 11 dimensions audited + fixed
- [N] commits on main (not pushed)
- [N] findings fixed
- All tests green (TS / API / Web / E2E / build)
- Report: docs/reports/2026-04-17-deep-review.md

Push to remote? [y/N]
```

**Do NOT push without explicit user confirmation.**
