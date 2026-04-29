# Accounting & Chart of Accounts — Audit Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute end-to-end accounting audit (6 layers) and produce a single Markdown finding report with severity tagging + action plan. No code/data changes.

**Architecture:** Static analysis via 4 parallel code-reviewer subagents (Layers 1, 2, 3, 5+6) + 1 dynamic prod query subagent (Layer 4) using a one-shot Cloud Run Job. Parent agent aggregates findings, dedupes, cross-references, and writes the final report.

**Tech Stack:** TypeScript (script), Prisma Client (readonly DB queries), Markdown (report), Cloud Run Jobs (one-shot prod query), code-reviewer subagent (Sonnet).

**Spec:** `docs/superpowers/specs/2026-04-29-accounting-audit-discovery-design.md`
**Owner CoA reference:** `docs/references/owner-chart-of-accounts.csv`

---

## File Structure

| File | Purpose | Status |
|---|---|---|
| `apps/api/scripts/audit-trial-balance.ts` | One-shot script: query journal_entries/journal_lines per (company, year, month) → output Σ Dr, Σ Cr, diff, orphan tx counts. Read-only. Reusable for monthly audits. | Create |
| `docs/reports/2026-04-29-accounting-audit.md` | Final audit report with all findings + action plan. | Create |
| `docs/reports/audit-2026-04-29-raw/` | Raw subagent outputs (5 files: layer-1.md → layer-5+6.md + layer-4-data.json) — kept for traceability. | Create |
| `docs/references/owner-chart-of-accounts.csv` | Owner-supplied CoA (109 accounts) — already committed in spec PR. | Exists |

**Boundaries:**
- Script does NOT modify any data. SELECT only. Allowlist of tables: `journal_entries`, `journal_lines`, `payments`, `expenses`, `accounting_periods`, `chart_of_accounts`.
- Subagents output finding YAML — parent does NOT trust any subagent to write to `docs/reports/`. All file writes done by parent.

---

## Task 1: Write Cloud Run Job script for trial balance audit

**Files:**
- Create: `apps/api/scripts/audit-trial-balance.ts`

- [ ] **Step 1: Create script with 6 read-only queries**

```typescript
/**
 * Audit script: trial balance integrity per (company, year, month).
 *
 * Outputs JSON to stdout:
 *   - monthlyTrialBalance: [{ companyId, year, month, sumDebit, sumCredit, diff, balanced }]
 *   - draftEntriesOlderThan7d: [{ id, entryNumber, createdAt, companyId, daysOld }]
 *   - voidedWithoutReverse: [{ id, entryNumber, voidedAt }] (no reverse JE found)
 *   - orphanPayments: [{ id, amountPaid, paidAt, contractId }] (Payment with no JE referencing it)
 *   - orphanPaidExpenses: [{ id, paidAt, totalAmount }] (Expense.PAID with no JE)
 *   - postedAfterClose: [{ entryId, entryDate, periodYear, periodMonth, periodStatus, postedAt }]
 *
 * Run locally:  npx tsx apps/api/scripts/audit-trial-balance.ts > audit-output.json
 * Run on prod:  via Cloud Run Job (ephemeral) — DO NOT commit DATABASE_URL
 *
 * Read-only: SELECT queries only. Allowlist tables:
 *   journal_entries, journal_lines, payments, expenses, accounting_periods, chart_of_accounts
 */
import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

interface MonthlyTB {
  companyId: string;
  year: number;
  month: number;
  sumDebit: string;
  sumCredit: string;
  diff: string;
  balanced: boolean;
  entryCount: number;
}

async function getMonthlyTrialBalance(): Promise<MonthlyTB[]> {
  const rows = await prisma.$queryRaw<Array<{
    company_id: string;
    year: number;
    month: number;
    sum_debit: Prisma.Decimal;
    sum_credit: Prisma.Decimal;
    entry_count: bigint;
  }>>(Prisma.sql`
    SELECT
      je.company_id,
      EXTRACT(YEAR FROM je.entry_date)::int AS year,
      EXTRACT(MONTH FROM je.entry_date)::int AS month,
      COALESCE(SUM(jl.debit), 0) AS sum_debit,
      COALESCE(SUM(jl.credit), 0) AS sum_credit,
      COUNT(DISTINCT je.id) AS entry_count
    FROM journal_entries je
    JOIN journal_lines jl ON jl.journal_entry_id = je.id
    WHERE je.status = 'POSTED'
      AND je.deleted_at IS NULL
      AND jl.deleted_at IS NULL
    GROUP BY je.company_id, year, month
    ORDER BY je.company_id, year, month
  `);

  return rows.map((r) => {
    const diff = r.sum_debit.minus(r.sum_credit);
    return {
      companyId: r.company_id,
      year: r.year,
      month: r.month,
      sumDebit: r.sum_debit.toFixed(2),
      sumCredit: r.sum_credit.toFixed(2),
      diff: diff.toFixed(2),
      balanced: diff.isZero(),
      entryCount: Number(r.entry_count),
    };
  });
}

async function getDraftOlderThan7d() {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  return prisma.journalEntry.findMany({
    where: { status: 'DRAFT', deletedAt: null, createdAt: { lt: cutoff } },
    select: { id: true, entryNumber: true, createdAt: true, companyId: true, description: true },
    orderBy: { createdAt: 'asc' },
    take: 200,
  });
}

async function getVoidedWithoutReverse() {
  // VOIDED entries that have no other JE referencing them via description containing "REVERSE"
  return prisma.$queryRaw<Array<{ id: string; entry_number: string; updated_at: Date }>>(Prisma.sql`
    SELECT je.id, je.entry_number, je.updated_at
    FROM journal_entries je
    WHERE je.status = 'VOIDED'
      AND je.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM journal_entries r
        WHERE r.deleted_at IS NULL
          AND r.status = 'POSTED'
          AND r.description ILIKE 'REVERSE%' || je.entry_number || '%'
      )
    ORDER BY je.updated_at DESC
    LIMIT 200
  `);
}

async function getOrphanPayments() {
  // Payment rows with no JournalEntry where reference_type='PAYMENT' and reference_id=payment.id
  return prisma.$queryRaw<Array<{
    id: string;
    amount_paid: Prisma.Decimal;
    paid_at: Date;
    contract_id: string | null;
  }>>(Prisma.sql`
    SELECT p.id, p.amount_paid, p.paid_at, p.contract_id
    FROM payments p
    WHERE p.deleted_at IS NULL
      AND p.status = 'COMPLETED'
      AND NOT EXISTS (
        SELECT 1 FROM journal_entries je
        WHERE je.reference_type = 'PAYMENT'
          AND je.reference_id = p.id
          AND je.deleted_at IS NULL
      )
    ORDER BY p.paid_at DESC
    LIMIT 500
  `);
}

async function getOrphanPaidExpenses() {
  return prisma.$queryRaw<Array<{
    id: string;
    paid_at: Date;
    total_amount: Prisma.Decimal;
  }>>(Prisma.sql`
    SELECT e.id, e.paid_at, e.total_amount
    FROM expenses e
    WHERE e.deleted_at IS NULL
      AND e.status = 'PAID'
      AND NOT EXISTS (
        SELECT 1 FROM journal_entries je
        WHERE je.reference_type = 'EXPENSE'
          AND je.reference_id = e.id
          AND je.deleted_at IS NULL
      )
    ORDER BY e.paid_at DESC
    LIMIT 500
  `);
}

async function getPostedAfterClose() {
  // JE posted_at AFTER the corresponding accounting_periods.closed_at
  return prisma.$queryRaw<Array<{
    entry_id: string;
    entry_number: string;
    entry_date: Date;
    posted_at: Date;
    period_year: number;
    period_month: number;
    period_status: string;
    closed_at: Date | null;
  }>>(Prisma.sql`
    SELECT
      je.id AS entry_id,
      je.entry_number,
      je.entry_date,
      je.posted_at,
      ap.year AS period_year,
      ap.month AS period_month,
      ap.status AS period_status,
      ap.closed_at
    FROM journal_entries je
    JOIN accounting_periods ap
      ON ap.company_id = je.company_id
     AND ap.year = EXTRACT(YEAR FROM je.entry_date)::int
     AND ap.month = EXTRACT(MONTH FROM je.entry_date)::int
    WHERE je.deleted_at IS NULL
      AND ap.status IN ('CLOSED', 'SYNCED')
      AND ap.closed_at IS NOT NULL
      AND je.posted_at > ap.closed_at
    ORDER BY je.posted_at DESC
    LIMIT 200
  `);
}

async function main() {
  const start = Date.now();
  console.error('[audit] starting trial balance audit...');

  const [
    monthlyTrialBalance,
    draftEntriesOlderThan7d,
    voidedWithoutReverse,
    orphanPayments,
    orphanPaidExpenses,
    postedAfterClose,
  ] = await Promise.all([
    getMonthlyTrialBalance(),
    getDraftOlderThan7d(),
    getVoidedWithoutReverse(),
    getOrphanPayments(),
    getOrphanPaidExpenses(),
    getPostedAfterClose(),
  ]);

  const elapsed = Date.now() - start;
  console.error(`[audit] completed in ${elapsed}ms`);

  const output = {
    runAt: new Date().toISOString(),
    elapsedMs: elapsed,
    summary: {
      monthCount: monthlyTrialBalance.length,
      unbalancedMonthCount: monthlyTrialBalance.filter((m) => !m.balanced).length,
      draftOver7d: draftEntriesOlderThan7d.length,
      voidedWithoutReverse: voidedWithoutReverse.length,
      orphanPaymentCount: orphanPayments.length,
      orphanExpenseCount: orphanPaidExpenses.length,
      postedAfterCloseCount: postedAfterClose.length,
    },
    monthlyTrialBalance,
    draftEntriesOlderThan7d,
    voidedWithoutReverse,
    orphanPayments: orphanPayments.map((p) => ({
      id: p.id,
      amountPaid: p.amount_paid.toFixed(2),
      paidAt: p.paid_at.toISOString(),
      contractId: p.contract_id,
    })),
    orphanPaidExpenses: orphanPaidExpenses.map((e) => ({
      id: e.id,
      totalAmount: e.total_amount.toFixed(2),
      paidAt: e.paid_at.toISOString(),
    })),
    postedAfterClose,
  };

  console.log(JSON.stringify(output, null, 2));
}

main()
  .catch((err) => {
    console.error('[audit] FATAL:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
```

- [ ] **Step 2: Type-check the script**

Run: `cd apps/api && npx tsc --noEmit scripts/audit-trial-balance.ts`
Expected: no errors. If errors → fix and re-run.

- [ ] **Step 3: Test against local dev DB**

Run: `cd apps/api && npx tsx scripts/audit-trial-balance.ts > /tmp/audit-local.json 2>&1`
Expected:
- Exit code 0
- `/tmp/audit-local.json` valid JSON
- `summary` section populated (numbers may all be 0 if dev DB is empty — that's fine, just verifying structure)

- [ ] **Step 4: Verify output structure**

Run: `jq '.summary' /tmp/audit-local.json`
Expected: object with 7 numeric keys (monthCount, unbalancedMonthCount, draftOver7d, voidedWithoutReverse, orphanPaymentCount, orphanExpenseCount, postedAfterCloseCount).

- [ ] **Step 5: Commit script**

```bash
git add apps/api/scripts/audit-trial-balance.ts
git commit -m "feat(audit): add trial balance audit script for accounting audit

Read-only one-shot script for Layer 4 of accounting audit. Outputs
monthly TB, orphan transactions, DRAFT/VOID issues, and post-close
violations as JSON to stdout. Designed to run via Cloud Run Job
against prod DB.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Get owner approval + run prod query (Gate G1)

**Files:** None (operational task)

- [ ] **Step 1: Pause and ask owner for prod query approval**

Output to user:
> "Script `apps/api/scripts/audit-trial-balance.ts` พร้อม run prod query (readonly). ขออนุญาต deploy ไป Cloud Run Job แล้ว run? — A. OK / B. Skip Layer 4 ทำเฉพาะ static (1, 2, 3, 5, 6)"

- [ ] **Step 2a: If owner says A (approve)**

Reference: `~/.claude/projects/-Users-iamnaii-Desktop-App-BESTCHOICE/memory/reference_prod_db_oneshot_jobs.md`

Deploy + run via Cloud Run Job (parent will use the verified pattern from memory). Save output to `docs/reports/audit-2026-04-29-raw/layer-4-data.json`.

- [ ] **Step 2b: If owner says B (skip)**

Mark Layer 4 as SKIPPED in final report. Add explicit note in Executive Summary: "Layer 4 (trial balance integrity) was not run — recommend running before next month-end close."

- [ ] **Step 3: Verify output (only if 2a)**

Run: `jq '.summary' docs/reports/audit-2026-04-29-raw/layer-4-data.json`
Expected: All counts populated, `unbalancedMonthCount` is the most important — if > 0, escalate to CRITICAL findings.

---

## Task 3: Dispatch 4 static subagents in parallel (Layers 1, 2, 3, 5+6)

**Files:**
- Create: `docs/reports/audit-2026-04-29-raw/layer-1.md`
- Create: `docs/reports/audit-2026-04-29-raw/layer-2.md`
- Create: `docs/reports/audit-2026-04-29-raw/layer-3.md`
- Create: `docs/reports/audit-2026-04-29-raw/layer-5-6.md`

- [ ] **Step 1: Ensure raw output directory exists**

Run: `mkdir -p docs/reports/audit-2026-04-29-raw`

- [ ] **Step 2: Dispatch all 4 subagents in ONE message (parallel execution)**

Use 4 Agent tool calls in a single response, each with `subagent_type: code-reviewer`. Each subagent receives the spec + finding format + their assigned layer.

**S1 (Layer 1 — Event Coverage Matrix):**

Prompt template:
```
You are auditing accounting event coverage for BESTCHOICE installment system.
Spec: docs/superpowers/specs/2026-04-29-accounting-audit-discovery-design.md (read first).

Your scope: Layer 1 ONLY (Event Coverage Matrix).

Task:
1. Enumerate every business event that touches money. Cover at minimum:
   - POS sales (cash/transfer/QR/external finance/installment)
   - Contract lifecycle (ACTIVATE, EARLY_PAYOFF, RESTRUCTURE, REPOSSESSION_PREVIEW,
     REPOSSESSION_COMPLETE, VOID)
   - Payment (full/partial/overpay/underpay/refund/reverse)
   - Trade-in
   - Stock (PURCHASE/TRANSFER/ADJUSTMENT/WRITE_OFF)
   - Expense workflow (SUBMIT/APPROVE/PAY/VOID)
   - Commission accrue + pay
   - Bad debt (provision/write-off/recovery)
   - Late fee, ค่ามัดจำริบ
   - Inter-company SHOP↔FINANCE settlement
   - VAT submission
   - Period close + opening balance + year-end

2. For each event find the trigger service (in apps/api/src/modules/) and check
   whether JournalAutoService (apps/api/src/modules/journal/journal-auto.service.ts)
   has a corresponding method that gets called.

3. Output a Markdown table:
   | Event | Trigger service:line | JournalAutoService method | Status (✓/✗/partial) | Severity if missing |

4. Output finding YAML list (id F-1-001, F-1-002, ...) for every GAP using the
   exact format from spec section 5.

Constraints:
- READ ONLY. Do not modify any file.
- Do not spawn subagents.
- Do not run prod queries.
- Timeout 20 minutes.

Output format: Single Markdown document with H1 "# Layer 1 — Event Coverage Matrix",
then the matrix table, then "## Findings" section with YAML findings.
Save your output by responding with the full Markdown content — parent will save it.
```

**S2 (Layer 2 — Journal Correctness):**

Prompt template:
```
You are auditing journal entry correctness for BESTCHOICE.
Spec: docs/superpowers/specs/2026-04-29-accounting-audit-discovery-design.md.
Owner CoA reference: docs/references/owner-chart-of-accounts.csv.

Your scope: Layer 2 ONLY (Journal Correctness).

Task:
1. Read JournalAutoService (apps/api/src/modules/journal/journal-auto.service.ts, 532 lines).
2. For every method that creates JournalEntry+JournalLine, verify:
   a. Math: Σ debit = Σ credit per entry (read code logic)
   b. Account nature: Dr/Cr correct side (Dr.Asset↑/Cr.Liability↑/etc.)
   c. TFRS NPAEs compliance:
      - Cash basis revenue (recognize on payment, not contract activation)
      - Accrual expense
      - HP interest A2 cash-basis policy (memory: project_interest_recognition_policy.md
        says fix needed but unearnedInterest field not yet implemented)
      - VAT timing
   d. Multi-entity: account `allowedCompanies` consistent with the JE's companyId
   e. Decimal precision: uses Prisma.Decimal not Number()
   f. Special cases: late fee no-VAT, trade-in no-VAT, ส่วนลด direction

3. Output finding YAML list (F-2-001, F-2-002, ...) using the exact format from
   spec section 5. One finding per issue. Include the journal-auto.service.ts:line
   in `location`.

Constraints:
- READ ONLY.
- Do not spawn subagents.
- Timeout 20 minutes.

Output: Single Markdown document with H1 "# Layer 2 — Journal Correctness", then
findings YAML list.
```

**S3 (Layer 3 — Chart of Accounts Reconciliation):**

Prompt template:
```
You are auditing chart of accounts vs owner ground truth for BESTCHOICE.
Spec: docs/superpowers/specs/2026-04-29-accounting-audit-discovery-design.md.

Your scope: Layer 3 ONLY (CoA Reconciliation).

Inputs:
- System CoA (76 accounts): apps/api/prisma/seeds/chart-of-accounts.ts
- Owner CoA (109 accounts): docs/references/owner-chart-of-accounts.csv (parse it)
- Journal account references: grep all string literals matching /\d{2}-\d{4}/ in
  apps/api/src/modules/journal/journal-auto.service.ts

Task: Build a diff matrix and produce findings:

1. F-3-A MISSING: account in owner CoA but NOT in system CoA → CRITICAL if business-essential
2. F-3-B EXTRA: account in system CoA but NOT in owner CoA → WARNING
3. F-3-C MISMATCH: code matches but name/group/parent differs → WARNING
4. F-3-D STRUCTURE-DIVERGE: hierarchy/numbering differs (e.g. 11-0000 vs 11-1000) → WARNING
5. F-3-E ORPHAN: account in system CoA but no journal line uses it → INFO
6. F-3-F UNDEFINED-USAGE: journal_auto.service.ts references account code that doesn't
   exist in system OR owner CoA → CRITICAL
7. F-3-G ALLOWED-COMPANY-VIOLATION: code that JournalAutoService uses with a
   companyId where the account's allowedCompanies excludes that company → CRITICAL

Output format: Markdown with H1 "# Layer 3 — CoA Reconciliation", then 7 sub-sections
(3.1 MISSING through 3.7 ALLOWED-COMPANY-VIOLATION) each with its finding table +
YAML findings list.

Specifically check (already known divergences from preview — verify and detail):
- HP Receivable (11-2102): system has it, owner CoA does not — investigate
- HP Interest Income (42-1101): system has it, owner CoA does not
- Top-level code conflict: system 11-0000 vs owner 11-1000
- 53-1101 conflict: system "Bad Debt Expense" vs owner "เงินเดือน ค่าจ้าง"

Constraints:
- READ ONLY.
- Do not spawn subagents.
- Timeout 20 minutes.
```

**S5 (Layers 5+6 — Reports & Period Close):**

Prompt template:
```
You are auditing financial reports completeness and period close hardening for BESTCHOICE.
Spec: docs/superpowers/specs/2026-04-29-accounting-audit-discovery-design.md.

Your scope: Layer 5 (Financial Reports) + Layer 6 (Period Close) ONLY.

LAYER 5 — Financial Reports Completeness:
1. Read journal.controller.ts, accounting.controller.ts, tax.controller.ts.
2. List every report endpoint that exists.
3. Compare against TFRS for NPAEs requirements (minimum):
   - Income Statement (P&L) — งบกำไรขาดทุน
   - Balance Sheet — งบฐานะการเงิน
   - Statement of Cash Flow
   - Notes to Financial Statements
   - General Ledger detail
   - Subsidiary ledger (HP Receivable per customer)
   - Tax: PND.50, PND.51, ภ.ง.ด.51
4. Output: comparison table (TFRS-required × system-has × endpoint × gap).

LAYER 6 — Period Close Hardening:
1. Read MonthlyCloseService (apps/api/src/modules/accounting/monthly-close.service.ts).
2. Check:
   - Does CLOSED period block insert/update/delete on JournalEntry? (look for guard)
   - Pre-close checklist: orphan tx / DRAFT entries / unbalanced TB → blocks close?
   - Reopen audit trail (who/when/why)?
   - Late posting policy (where does it land)?
   - Year-end closing entries (revenue/expense → retained earnings) automated?
3. Output finding YAML list.

Output format: Single Markdown document with two H1 sections "# Layer 5" + "# Layer 6",
each with sub-sections + findings.

Constraints:
- READ ONLY.
- Do not spawn subagents.
- Timeout 20 minutes.
```

- [ ] **Step 3: Wait for all 4 subagents to return**

Parent agent waits for all 4 results. If any subagent fails or times out, parent runs that layer manually as fallback.

- [ ] **Step 4: Save each subagent output to raw directory**

Save each subagent's response verbatim to:
- `docs/reports/audit-2026-04-29-raw/layer-1.md`
- `docs/reports/audit-2026-04-29-raw/layer-2.md`
- `docs/reports/audit-2026-04-29-raw/layer-3.md`
- `docs/reports/audit-2026-04-29-raw/layer-5-6.md`

Use the Write tool. Do NOT modify subagent output.

---

## Task 4: Aggregate findings + dedupe + cross-reference

**Files:**
- Read: all `docs/reports/audit-2026-04-29-raw/*.md` + `layer-4-data.json` (if Task 2 ran)

- [ ] **Step 1: Parse all finding YAML blocks**

Read each layer file, extract YAML finding blocks (each starts with `- id: F-`).

- [ ] **Step 2: Convert Layer 4 JSON → findings**

For each entry in `layer-4-data.json`:
- `unbalancedMonthCount > 0` → one CRITICAL finding F-4-001 listing each unbalanced (companyId, year, month, diff)
- `orphanPaymentCount > 0` → CRITICAL F-4-002, list first 10 + total count
- `orphanExpenseCount > 0` → CRITICAL F-4-003
- `draftOver7d > 0` → WARNING F-4-004
- `voidedWithoutReverse > 0` → WARNING F-4-005
- `postedAfterCloseCount > 0` → CRITICAL F-4-006

If Task 2 was skipped, write a single F-4-000 INFO finding noting that Layer 4 was skipped.

- [ ] **Step 3: Dedupe**

Group findings by `(layer, location prefix, evidence first-line)`. If duplicates → merge into one finding, list all locations.

- [ ] **Step 4: Cross-reference**

For each finding, scan other findings for related items. Add `relatedFindings: [F-X-NNN]` field where applicable. Common patterns:
- F-1 GAP (event has no JE) often relates to F-3-F (UNDEFINED-USAGE) — link them
- F-3-A MISSING (owner has, system lacks) often relates to F-1 GAP for that domain
- F-4 unbalanced months often relate to F-2 Dr/Cr math errors

- [ ] **Step 5: Write aggregated findings to scratch file**

Save deduped + cross-referenced findings as a JSON intermediate file:
`docs/reports/audit-2026-04-29-raw/findings-aggregated.json`

Schema: `{ findings: [{...}], counts: { critical, warning, info } }`.

---

## Task 5: Write final audit report

**Files:**
- Create: `docs/reports/2026-04-29-accounting-audit.md`

- [ ] **Step 1: Write report skeleton matching spec section 6**

Use the exact structure from spec section 6:
1. Title + metadata (Date, Scope, Methodology, Owner CoA reference)
2. Executive Summary
3. Layer 1 (matrix from S1 + findings)
4. Layer 2 (findings)
5. Layer 3 (7 sub-sections from S3)
6. Layer 4 (TB tables + orphan lists from script output, or SKIPPED notice)
7. Layer 5 (TFRS comparison from S5)
8. Layer 6 (period close findings from S5)
9. Recommended Action Plan (Phase A/B/C)
10. Critical Business Decisions Needed
11. Appendix (SQL queries, files inspected, references)

- [ ] **Step 2: Fill Executive Summary**

```markdown
## Executive Summary

- **Total findings:** {NN} (Critical: {X}, Warning: {Y}, Info: {Z})
- **System status:** {READY-TO-CLOSE | NEEDS-FIX-BEFORE-CLOSE | BROKEN}
- **Top 3 risks:** {list 3 highest-impact CRITICAL findings, 1 line each}
- **Top 3 quick wins:** {list 3 INFO/WARNING findings that take <1hr to fix}
- **Critical business decisions needed:** {short list — at minimum the owner-CoA-vs-system question}
```

Substitute actual numbers from `findings-aggregated.json`.

- [ ] **Step 3: Embed each layer's content**

Copy raw output from each `docs/reports/audit-2026-04-29-raw/layer-N.md` into the appropriate report section. Preserve tables and formatting. Wrap each in the section header.

- [ ] **Step 4: Build Recommended Action Plan**

Group findings into 3 phases:
- **Phase A — Critical Fix:** all CRITICAL findings, ordered by dependency (e.g. fix CoA divergence before fixing Dr/Cr that uses divergent codes)
- **Phase B — Build Missing Reports:** F-5-* findings about missing P&L, Balance Sheet, etc.
- **Phase C — Backlog:** all WARNING + INFO findings

For each phase, list finding IDs + 1-line summary.

- [ ] **Step 5: Build Critical Business Decisions section**

Always include at minimum:
1. **Owner CoA vs System CoA:** which is ground truth? Resolution required before any code fix in Phase A.

Add other business decisions surfaced by findings (e.g. CR-001 VAT on interest if S2 finds something).

- [ ] **Step 6: Fill Appendix**

```markdown
## Appendix

### A. SQL queries used (Layer 4)
[Embed the 6 queries from apps/api/scripts/audit-trial-balance.ts as code blocks]

### B. Files inspected
- apps/api/src/modules/journal/journal-auto.service.ts
- apps/api/src/modules/journal/journal.service.ts
- apps/api/src/modules/journal/journal.controller.ts
- apps/api/src/modules/accounting/accounting.service.ts
- apps/api/src/modules/accounting/monthly-close.service.ts
- apps/api/src/modules/accounting/bad-debt.service.ts
- apps/api/src/modules/chart-of-accounts/chart-of-accounts.service.ts
- apps/api/src/modules/tax/tax.service.ts
- apps/api/prisma/seeds/chart-of-accounts.ts
- apps/api/prisma/schema.prisma (ChartOfAccount, JournalEntry, JournalLine, AccountingPeriod, JournalPostAuditLog models)
- {other service files inspected by S1 — list from S1 output}

### C. References
- TFRS for NPAEs (มาตรฐานรายงานทางการเงินสำหรับกิจการที่ไม่มีส่วนได้เสียสาธารณะ)
- .claude/rules/accounting.md
- memory: project_interest_recognition_policy.md
- memory: reference_prod_db_oneshot_jobs.md
- memory: feedback_parallel_subagent_audit.md
- Spec: docs/superpowers/specs/2026-04-29-accounting-audit-discovery-design.md
```

---

## Task 6: Self-review the report

**Files:** Read-only review of `docs/reports/2026-04-29-accounting-audit.md`

- [ ] **Step 1: Placeholder scan**

Search for: `TBD`, `TODO`, `{NN}`, `{X}`, `XXX`, "fill in", "to be determined".
Run: `grep -nE "TBD|TODO|\{NN\}|\{X\}|XXX|fill in|to be determined" docs/reports/2026-04-29-accounting-audit.md`
Expected: NO matches. If any found → fill them in.

- [ ] **Step 2: Finding format check**

Run: `grep -cE "^- id: F-[1-6]-[0-9]{3}$" docs/reports/2026-04-29-accounting-audit.md`
Expected: count > 0. Verify visually that every finding has all required fields (severity, layer, title, location, evidence, impact, recommendation).

- [ ] **Step 3: Cross-reference check**

Verify Executive Summary numbers match actual finding counts:
- Run: `grep -c "severity: CRITICAL" docs/reports/2026-04-29-accounting-audit.md` → should match Executive Summary's Critical count
- Same for WARNING and INFO

- [ ] **Step 4: Action plan completeness**

Verify every CRITICAL finding appears in Phase A, every "missing report" finding in Phase B, every WARNING/INFO in Phase C. No finding orphaned.

- [ ] **Step 5: Layer skipped notice**

If Layer 4 was skipped (Task 2b), verify Executive Summary explicitly notes this and Layer 4 section contains the SKIPPED notice (not empty).

---

## Task 7: Commit + summary to user

**Files:** Add raw outputs + final report to git

- [ ] **Step 1: Verify branch**

Run: `git branch --show-current`
Expected: `main` (audit is doc-only, OK to commit on main per existing pattern in `docs/reports/`).

- [ ] **Step 2: Stage files**

```bash
git add docs/reports/2026-04-29-accounting-audit.md docs/reports/audit-2026-04-29-raw/
```

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
docs(accounting): add 2026-04-29 audit report (6-layer audit)

End-to-end accounting audit covering event coverage, journal
correctness, CoA reconciliation vs owner ground truth, trial
balance integrity (prod data), financial reports gap, and period
close hardening.

Findings: {N} total (Critical {X}, Warning {Y}, Info {Z}).
Top critical: {1-line}.

Spec: docs/superpowers/specs/2026-04-29-accounting-audit-discovery-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Substitute {N}, {X}, {Y}, {Z} with actual counts from Executive Summary before running.

- [ ] **Step 4: Output summary to user**

Print to user (chat output, not file):
```
Audit เสร็จ — `docs/reports/2026-04-29-accounting-audit.md`

Findings: {N} (Critical {X}, Warning {Y}, Info {Z})
System status: {READY-TO-CLOSE | NEEDS-FIX-BEFORE-CLOSE | BROKEN}

Top 3 critical:
1. {first critical finding title}
2. {second}
3. {third}

Critical business decisions ที่รอ:
1. Owner CoA vs System CoA — ใช้แบบไหนเป็น ground truth?
{additional decisions if any}

Next steps: เลือก
- A. Brainstorm spec ถัดไป (Phase A — Critical Fix)
- B. ดู report เต็มก่อน
- C. Park ไว้ — ทำงานอื่น
```

---

## Self-Review Checklist (post-write, parent verifies before handing off)

- [ ] Spec coverage: every layer (1-6) has a task that produces its findings ✓
- [ ] Spec coverage: owner CoA reference is used (Task 3 S3 prompt) ✓
- [ ] Spec coverage: Cloud Run Job pattern used for Layer 4 (Task 1 + 2) ✓
- [ ] Spec coverage: 5 subagents pattern (4 static + 1 prod) ✓
- [ ] Spec coverage: finding format (Section 5 of spec) — used in S2/S3/S5 prompts ✓
- [ ] Spec coverage: Action Plan Phase A/B/C — Task 5 Step 4 ✓
- [ ] Spec coverage: Approval Gate G1 — Task 2 Step 1 ✓
- [ ] Placeholder scan: report skeleton uses {N}, {X} which Task 5 Step 2 fills in. Plan itself has no TBD/TODO. ✓
- [ ] Type consistency: `findings-aggregated.json` schema referenced consistently in Task 4 + 5 ✓
- [ ] No subagent writes to `docs/reports/` directly — parent owns all writes ✓
- [ ] Layer 4 skip path explicitly handled (Task 2 Step 2b + Task 4 Step 2 fallback + Task 5 Step 5 verification + Task 6 Step 5) ✓
