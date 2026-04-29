# Accounting & Chart of Accounts Audit

**Date:** 2026-04-29
**Scope:** ทั้ง SHOP + FINANCE (single-entity, dual-business-unit)
**Methodology:** 6-layer audit (static analysis + production data query)
**Spec:** `docs/superpowers/specs/2026-04-29-accounting-audit-discovery-design.md`
**Owner CoA reference:** `docs/references/owner-chart-of-accounts.csv` (109 accounts)
**Layer 4 prod data:** `docs/reports/audit-2026-04-29-raw/layer-4-data.json`
**Raw subagent outputs:** `docs/reports/audit-2026-04-29-raw/layer-{1,2,3,5-6}.md`

---

## Executive Summary

- **Total findings: 79** — Critical: **41**, Warning: **32**, Info: **6**
- **System status: BROKEN** — TFRS NPAEs compliance gaps + zero ledger coverage for primary revenue channels
- **Critical chain identified:** Contract activation JE math bug → silent try/catch → zero HP portfolio in ledger → payment JEs create negative HP_RECEIVABLE balance

**Reading guide:** Each layer section below summarizes findings as a table (id × severity × title). **Full YAML evidence + impact + recommendation for each finding** is in the raw layer files at `docs/reports/audit-2026-04-29-raw/layer-{1,2,3,5-6}.md`. F-4-001 (Layer 4 — production data) is the only finding inlined in full because it was synthesized from the prod query, not from a subagent.

### Top 5 critical risks

1. **Contract activation journal math bug (F-2-001)** — `hpReceivable = financedAmount + i+c+v` double-counts; `financedAmount` already includes those. Throws on every contract. Combined with try/catch (F-1-002, F-2-003), **zero contract-activation JEs exist in production ledger**.

2. **PaySolutions webhook posts no JE (F-1-003)** — primary customer QR payment channel bypasses JournalAutoService. Layer 4 prod data confirms **36 orphan payments** with cash received but no double-entry record.

3. **Bad debt write-off posts to Salary account (F-2-002, F-3-026, F-3-022)** — `ACC.BAD_DEBT_EXPENSE = '53-1101'` but seed defines 53-1101 as "เงินเดือน ค่าจ้าง" (Salaries). Every write-off inflates Salary expense.

4. **`createAndPost` bypasses `allowedCompanies` validation (F-3-027)** — FINANCE-restricted accounts (11-2102, 42-1101, etc.) can post under SHOP entity due to non-deterministic `resolveCompanyId`.

5. **No General Ledger endpoint; P&L + Balance Sheet derived from raw tables, not JournalEntry (F-5-003)** — two independent sources of truth diverge silently.

### Top 3 quick wins (< 1hr each)

1. **F-2-010**: Switch balance check from `Number()` to `Prisma.Decimal` arithmetic in `createAndPost` (single-line fix).
2. **F-3-006**: Rename retained earnings 32-1001 → 32-1101 to match owner CoA (migration with `@map`).
3. **F-3-007**: Add 12-2108 vehicle depreciation contra account (one seed entry).

### Critical business decisions needed

A summary list — see the dedicated `## Critical Business Decisions Needed` section below the Action Plan for full detail and blocking dependencies.

1. Owner CoA vs System CoA — ground truth choice (blocks Phase A)
2. HP interest recognition policy (cash basis vs unearnedInterest)
3. Commission ownership (FINANCE expense or SHOP income)
4. CR-001 VAT on interest (CPA pending)
5. Inter-company transactions formal policy

---

## Layer 1 — Event Coverage Matrix

> Source: `docs/reports/audit-2026-04-29-raw/layer-1.md`

### Coverage at a glance

JournalAutoService has **5 method types** (payment, expense, contract activation, reversal, bad-debt write-off). Codebase has **45 distinct money-touching events**.

- ✓ Fully covered: 9 events
- partial (try/catch swallows / partial path): 5 events
- ✗ Missing entirely: 25 events
- N/A: 6 events

### Findings (Layer 1) — 14 CRITICAL, 7 WARNING, 2 INFO

See `docs/reports/audit-2026-04-29-raw/layer-1.md` for full evidence + recommendations.

| ID | Severity | Title |
|---|---|---|
| F-1-001 | CRITICAL | Cash/Transfer/QR POS sale creates no JE (COGS or Revenue) |
| F-1-002 | CRITICAL | Contract activation journal wrapped in try/catch — silently swallowed |
| F-1-003 | CRITICAL | PaySolutions webhook payment creates no JE |
| F-1-004 | CRITICAL | Overpayment stored as creditBalance with no JE |
| F-1-005 | CRITICAL | Trade-in creates no JE — cash out + stock in unrecorded |
| F-1-006 | CRITICAL | Purchase Order receipt creates no JE |
| F-1-007 | CRITICAL | Stock WRITE_OFF / DAMAGED / LOST adjustment creates no JE |
| F-1-008 | CRITICAL | Commission markPaid / markPayoutPaid creates no cash-out JE |
| F-1-009 | CRITICAL | Bad debt PROVISION creates no JE for Allowance account |
| F-1-010 | CRITICAL | Expense VOID after PAID creates no reversal JE |
| F-1-011 | CRITICAL | Inter-company SHOP↔FINANCE settlement creates no JE |
| F-1-012 | CRITICAL | VAT remittance to Revenue Department creates no JE |
| F-1-013 | CRITICAL | Year-end closing entries absent |
| F-1-014 | CRITICAL | Refund PROCESSED creates no JE |
| F-1-015 | WARNING | Partial payment (PARTIALLY_PAID) skips JE |
| F-1-016 | WARNING | Expense payment journal try/catch swallowed |
| F-1-017 | WARNING | Receipt VOID reversal try/catch swallowed |
| F-1-018 | WARNING | Repossession READY_FOR_SALE / SOLD no inventory/revenue JE |
| F-1-019 | WARNING | Commission accrual not journalized |
| F-1-020 | WARNING | Late fee waiver no JE |
| F-1-021 | WARNING | Stock branch transfer no JE |
| F-1-022 | INFO | POS installment sale TODO for COGS journal |
| F-1-023 | INFO | Period close has no pre-close orphan-tx guard |

---

## Layer 2 — Journal Correctness

> Source: `docs/reports/audit-2026-04-29-raw/layer-2.md`

### Findings (Layer 2) — 5 CRITICAL, 5 WARNING, 1 INFO

| ID | Severity | Title |
|---|---|---|
| F-2-001 | CRITICAL | createContractActivationJournal overstates HP_RECEIVABLE by double-counting i+c+v |
| F-2-002 | CRITICAL | BAD_DEBT_EXPENSE constant maps to 53-1101 = Salaries in seed |
| F-2-003 | CRITICAL | Contract activation journal silently swallowed by try/catch |
| F-2-004 | CRITICAL | HP_RECEIVABLE balance permanently negative (no prior debit) |
| F-2-005 | CRITICAL | Interest income recognized at activation AND per payment — double recognition risk |
| F-2-006 | WARNING | No JE for customer overpayment (creditBalance) |
| F-2-007 | WARNING | COMMISSION_INCOME (42-1105 SHOP-only) used in payment JE without company guard |
| F-2-008 | WARNING | Expense journal failure silently swallowed by try/catch |
| F-2-009 | WARNING | Revenue codes 42-1101/02/03 conflict with owner CoA |
| F-2-010 | INFO | Balance validation uses floating-point Number, not Decimal |
| F-2-011 | WARNING | Commission double-counted in income if activation JE succeeds |

### Critical chain (root cause analysis)

```
F-2-001 (math bug: hpReceivable double-counts i+c+v)
  ↓ throws InternalServerErrorException on every real contract
F-2-003 / F-1-002 (try/catch swallows the throw)
  ↓ contract activation succeeds in DB but no JE created
F-2-004 (every payment JE credits HP_RECEIVABLE that was never debited)
  ↓ TB shows negative HP_RECEIVABLE balance
Trial balance shows: HP portfolio asset = NEGATIVE (phantom liability)
                     Salary expense = INFLATED (bad debt amounts)
                     PaySolutions revenue = ZERO (F-1-003)
                     Cash sales revenue = ZERO (F-1-001)
```

---

## Layer 3 — CoA Reconciliation (vs Owner Ground Truth)

> Source: `docs/reports/audit-2026-04-29-raw/layer-3.md`

### Diff matrix summary

- System CoA: 76 accounts
- Owner CoA: 109 accounts
- **MISSING (owner has, system lacks): 15** — 9 operationally significant
- **EXTRA (system has, owner lacks): 15** — 1 actively journal-posted (42-1105 commission)
- **MISMATCH (same code, different name): 32** — 7 with critical semantic collisions
- **STRUCTURE-DIVERGE: 4 systematic blocks** — top-level codes + 42-11XX + 52-11XX + 53-11XX
- **ORPHAN (in system, no journal use): 47**
- **ALLOWED-COMPANY-VIOLATION: bypassed entirely in createAndPost**

### Findings (Layer 3) — 13 CRITICAL, 14 WARNING, 1 INFO

| ID | Severity | Title |
|---|---|---|
| F-3-001 | CRITICAL | WHT Receivable (11-4103) missing |
| F-3-002 | CRITICAL | ภ.พ.36 Payable (21-2103) missing |
| F-3-003 | CRITICAL | Net Tax Payable section (21-32XX) missing |
| F-3-004 | WARNING | Stamp duty (53-1203) missing |
| F-3-005 | WARNING | Employee deposit + suspense accounts missing |
| F-3-006 | WARNING | Retained earnings code mismatch (32-1001 vs 32-1101) |
| F-3-007 | WARNING | Vehicle depreciation contra (12-2108) missing |
| F-3-008 | CRITICAL | Commission Income (42-1105) journal-posted but absent from owner CoA |
| F-3-009 | WARNING | HP Receivable (11-2102) and related not in owner CoA |
| F-3-010 | WARNING | Customer Credit Balance (21-5101) absent + unused |
| F-3-011 | WARNING | Bonus/Welfare non-standard codes (53-0102, 53-0116) |
| F-3-012 | CRITICAL | 42-1101 collision: HP Interest vs Rounding Excess |
| F-3-013 | CRITICAL | 42-1102 collision: Late Fee vs Bank Interest |
| F-3-014 | CRITICAL | 52-1102 collision: Advertising vs Employee Commission |
| F-3-015 | CRITICAL | 53-1102/03 shift: Social Security → Overtime; Bad Debt → Salary |
| F-3-016 | WARNING | 53-14XX block shifted by 1 |
| F-3-017 | WARNING | Bank account names don't match owner |
| F-3-018 | WARNING | 21-2102 conflict: VAT Payable vs Unearned VAT |
| F-3-019 | WARNING | Top-level asset codes differ (11-0000 vs 11-1000) |
| F-3-020 | CRITICAL | Entire 42-11XX block reassigned by system to FINANCE concepts |
| F-3-021 | WARNING | 52-11XX block shifted |
| F-3-022 | CRITICAL | 53-11XX block shifted — Social Security → Overtime; Bad Debt → Salary |
| F-3-023 | WARNING | Repossession income/inventory orphan |
| F-3-024 | WARNING | PP&E + depreciation accounts orphan |
| F-3-025 | INFO | 47 of 78 level-3 accounts have no journal reference |
| F-3-026 | CRITICAL | ACC.BAD_DEBT_EXPENSE points to Salary account |
| F-3-027 | CRITICAL | journal-auto bypasses allowedCompanies — FINANCE accounts can post under SHOP |
| F-3-028 | CRITICAL | Commission Income (42-1105 SHOP-only) posted from FINANCE-context payment |

---

## Layer 4 — Trial Balance Integrity (Production Data)

> Source: `docs/reports/audit-2026-04-29-raw/layer-4-data.json`
> Run: 2026-04-29 via Cloud Run Job (ephemeral, READ-ONLY)
> Job: `audit-trial-balance-oneshot` (deleted after execution)

### Production data summary

| Metric | Count | Status |
|---|---|---|
| Months with POSTED journal entries | 1 (April 2026) | ⚠ Only 1 month of data |
| Unbalanced months (Dr ≠ Cr) | 0 | ✓ |
| DRAFT entries > 7 days old | 0 | ✓ |
| VOIDED without reverse | 0 | ✓ |
| **Orphan payments (PAID/PARTIALLY_PAID, no JE)** | **36** | ✗ **CRITICAL** |
| Orphan PAID expenses | 0 | ✓ |
| Posted-after-CLOSE violations | 0 | ✓ |

### April 2026 Trial Balance (only month with data)

| Company | Year | Month | Σ Debit | Σ Credit | Diff | Balanced |
|---|---|---|---|---|---|---|
| `72fd440f-2a1d-4628-890a-60521a9c0fa4` | 2026 | 4 | 6,125.63 | 6,125.63 | 0.00 | ✓ |

**Interpretation:** Only **1 journal entry** posted in entire production history (April 2026, ฿6,125.63). Meanwhile **36 PAID payments exist with no JE** — payments dating back to March 2026. Confirms F-1-003 + F-1-001 + F-1-002 chain in production data: real cash received, zero double-entry tracking.

### Findings (Layer 4) — 1 CRITICAL

```yaml
- id: F-4-001
  severity: CRITICAL
  layer: 4
  title: 36 PAID payments in production have no JournalEntry
  location:
    - production database (query: payments WHERE status IN ('PAID','PARTIALLY_PAID') AND no JE refType=PAYMENT/refId=p.id)
  evidence: |
    Layer 4 prod query (2026-04-28 18:26 UTC = 2026-04-29 01:26 ICT) found 36 orphan payments.
    Earliest paidAt: 2025-11-24. Latest: 2026-04-23.
    Payment IDs include f59620c2..., 836439ba..., 8589e610..., etc. (full list in layer-4-data.json).
    All amountPaid = 1080.00, status=PAID. Pattern suggests automated/recurring source (likely PaySolutions webhook per F-1-003).
    5 months of orphan payments accumulating with no double-entry record.
  impact: |
    ฿38,880 of customer payments received with no double-entry record.
    Cash account understated by full amount. Revenue (interest + late fee) understated.
    HP Receivable not credited — customers paid but ledger still shows full balance.
    Cannot reconcile bank statements vs GL. April 2026 period close (if attempted) would
    snapshot incomplete state.
  impact_extended: |
    More fundamentally: with only 1 JE in prod history (the April balance shown above),
    the ENTIRE accounting ledger is essentially empty. Any P&L, BS, or tax report run today
    is meaningless. The system is producing operational records (Payment, Contract, Sale rows)
    but is NOT producing financial records (JournalEntry rows).
  recommendation: |
    BLOCKING: Do NOT close any accounting period until F-1-003 (PaySolutions webhook JE)
    AND F-2-001/F-2-003 (contract activation JE chain) are fixed.
    After fix: run a backfill script to retroactively create JEs for all 36 orphan payments
    + any historical contract activations missing JEs.
    Coordinate with CPA before backfill — backdating JEs requires audit sign-off.
  relatedFindings:
    - F-1-002 (try/catch swallowing activation JE failures)
    - F-1-003 (PaySolutions webhook no JE)
    - F-2-001 (activation JE math bug throws every time)
    - F-2-003 (try/catch hides the throw)
    - F-2-004 (HP_RECEIVABLE permanently negative — confirmed by absence of debits in prod)
```

---

## Layer 5 — Financial Reports Completeness

> Source: `docs/reports/audit-2026-04-29-raw/layer-5-6.md`

### TFRS NPAEs Required vs System Has

| TFRS Requirement | Has? | Endpoint | Severity |
|---|---|---|---|
| งบกำไรขาดทุนเบ็ดเสร็จ (P&L) | partial | `/reports/profit-loss` | WARNING (derived from raw tables not GL) |
| งบฐานะการเงิน (Balance Sheet) | partial | `/reports/balance-sheet` | WARNING (derived; RE = A-L tautology) |
| งบกระแสเงินสด (Cash Flow) | partial | `/reports/cash-flow` | CRITICAL (investing/financing missing) |
| หมายเหตุประกอบงบ (Notes) | NO | none | CRITICAL |
| บัญชีแยกประเภท (General Ledger) | NO | none | CRITICAL |
| บัญชีย่อย HP per customer | partial | finance portfolio | WARNING |
| งบทดลอง (Trial Balance) | YES | `/journal-entries/trial-balance` | OK |
| ภ.พ.30 / ภ.ง.ด.3/53 | YES | `/tax/*` | OK |
| ภ.ง.ด.50 / 51 (Annual CIT) | NO | none | CRITICAL |

### Findings (Layer 5) — 4 CRITICAL, 2 WARNING, 1 INFO

| ID | Severity | Title |
|---|---|---|
| F-5-001 | CRITICAL | Cash Flow Statement missing Investing & Financing sections |
| F-5-002 | CRITICAL | No Notes to Financial Statements |
| F-5-003 | CRITICAL | No General Ledger endpoint — P&L and Balance Sheet bypass GL |
| F-5-004 | CRITICAL | No PND.50 / PND.51 (annual & mid-year corporate income tax) support |
| F-5-005 | WARNING | Balance Sheet retained earnings = A-L (always balanced by definition) |
| F-5-006 | WARNING | No HP Receivable subsidiary ledger endpoint per customer |
| F-5-007 | INFO | P&L uses raw tables not JournalEntry — reconciliation untested |

---

## Layer 6 — Period Close Hardening

> Source: `docs/reports/audit-2026-04-29-raw/layer-5-6.md`

### Workflow analysis (key gaps)

- **Late posting allowed**: `JournalService.post()` does NOT call `validatePeriodOpen()`. DRAFT created before close can post into closed month after close.
- **Auto JE bypasses lock entirely**: `JournalAutoService` has zero references to `validatePeriodOpen` or `AccountingPeriod`.
- **closePeriod doesn't enforce auditIssues**: even if `runDataAudit` flagged `hasIssues=true`, close still proceeds.
- **reopenPeriod has no audit trail**: only `Logger.log()`, no `AuditLog`, no userId captured (controller missing `@Request()`), `boardResolutionId` to stdout only.
- **No year-end closing entries**: revenue/expense never closed to retained earnings; RE computed as A-L residual.
- **Two coexisting period-close systems**: legacy SystemConfig-based + new AccountingPeriod-based.

### Findings (Layer 6) — 4 CRITICAL, 4 WARNING, 1 INFO

| ID | Severity | Title |
|---|---|---|
| F-6-001 | CRITICAL | JournalService.post() does not validate CLOSED period |
| F-6-002 | CRITICAL | JournalAutoService bypasses period lock entirely |
| F-6-003 | CRITICAL | closePeriod() does not enforce auditIssues.hasIssues |
| F-6-004 | CRITICAL | reopenPeriod() does not create AuditLog or capture userId |
| F-6-005 | WARNING | Pre-close checklist does not check DRAFT entries in period |
| F-6-006 | WARNING | Pre-close does not verify orphan payments |
| F-6-007 | WARNING | No year-end closing entries |
| F-6-008 | WARNING | Legacy AccountingPeriod endpoints under /expenses — confusing path |
| F-6-009 | INFO | Pre-close does not check unbalanced trial balance for the period |

---

## Recommended Action Plan

### Phase A — Critical Fix (next spec)

**A.0 — Pre-requisite: Owner business decisions**

Owner + accountant + CPA must decide:
1. Owner CoA vs System CoA reconciliation strategy (extend owner CoA OR maintain dual chart)
2. HP interest recognition policy (cash basis vs unearnedInterest)
3. Commission ownership (FINANCE expense vs SHOP income)
4. Inter-company settlement approach
5. CR-001 VAT on interest (still pending CPA)

**Until A.0 resolved, code fixes in A.1+ should not proceed** — they may produce wrong CoA mappings.

**A.1 — Fix journal-correctness chain (P0 must do together)**

Sequence (each builds on previous):
1. F-2-001 (fix `hpReceivable = financedAmount` math) — **single-line fix**
2. F-2-003 / F-1-002 (remove try/catch in `contract-workflow.service.ts:443`) — propagate exception
3. F-2-002 / F-3-026 (add new `53-1701 หนี้สูญ` account, update `ACC.BAD_DEBT_EXPENSE`, update accounting.md)
4. F-3-027 (add `allowedCompanies` validation in `createAndPost`, fix `resolveCompanyId` ORDER BY, pass explicit companyId from callers)
5. F-1-003 (inject JournalAutoService into PaySolutions webhook + post payment JE)
6. F-1-001 (add JE to cash sale + external finance sale paths)
7. F-1-016, F-1-017 (remove try/catch in expense + receipt reversal)
8. F-1-010 (add reversal JE to voidExpense)
9. F-1-014 (add reversal JE to refund markReversed)
10. F-1-009 (add provision JE to bad debt calculateProvisions)

**A.2 — Backfill historical orphan transactions**

After A.1 ships:
1. Backfill JEs for 36 orphan payments (Layer 4 finding)
2. Backfill JEs for all historical contract activations
3. Run with auditor sign-off — backdated entries require accountant approval
4. Use `data-audit.service.ts:1081/1145` patterns (already exist)

**A.3 — Period close hardening**

1. F-6-001 — add `validatePeriodOpen` to `JournalService.post()`
2. F-6-002 — add `validatePeriodOpen` to `JournalAutoService.createAndPost`
3. F-6-003 — `closePeriod` must check `auditIssues.hasIssues`
4. F-6-004 — add `@Request()` + AuditLog + persistent reopen fields

**A.4 — CoA migration (depends on A.0)**

After A.0 decisions:
1. Create migration to add: 11-4103, 21-2103, 21-32XX, 53-1203, 12-2108, 53-1701, 21-4101/02 (rename), 32-1101 (rename from 32-1001)
2. Create migration to fix block alignment: 42-11XX, 52-11XX, 53-11XX
3. Update `JournalAutoService.ACC` constants
4. Update `accounting.service.ts CATEGORY_CODE_MAP`
5. Update `accounting.md` rules file

### Phase B — Build Missing Reports (separate spec after A)

1. F-5-003 — General Ledger endpoint (`GET /journal-entries/general-ledger?accountCode=&start=&end=`)
2. F-5-001 — Cash Flow investing + financing sections
3. F-5-002 — Notes to Financial Statements endpoint
4. F-5-006 — HP Receivable subsidiary ledger
5. F-5-004 — PND.50 / PND.51 annual corporate income tax
6. F-5-005 — Refactor BS retained earnings to source from cumulative net profit (not residual)
7. F-1-013 / F-6-007 — Year-end closing entries automation

### Phase C — Backlog (32 Warnings + 6 Info)

Group by domain:

**Stock & Inventory journal coverage:**
- F-1-005 (trade-in), F-1-006 (PO receipt), F-1-007 (write-off), F-1-021 (transfer), F-3-024 (PP&E + depreciation)

**Commission journal coverage:**
- F-1-008 (commission markPaid + markPayoutPaid cash-out), F-1-019 (commission accrual not journalized), F-2-007 (42-1105 SHOP-only used in payment JE without company guard), F-3-028 (commission income posted from FINANCE-context payment)

**Other revenue/expense gaps:**
- F-1-018 (repossession resale), F-1-020 (waiver), F-1-011 (inter-company)

**CoA cleanup (mostly cosmetic):**
- F-3-004, F-3-005, F-3-006, F-3-007, F-3-011, F-3-016, F-3-017, F-3-018, F-3-019, F-3-021, F-3-023

**Period close polish:**
- F-6-005 (DRAFT check), F-6-006 (orphan check), F-6-008 (deprecate legacy), F-6-009 (TB check)

**Code quality:**
- F-2-006, F-2-008, F-2-009, F-2-010, F-2-011, F-1-015 (partial payment), F-3-010, F-5-005, F-5-006, F-5-007

---

## Critical Business Decisions Needed

These decisions block code fixes in Phase A. Owner + accountant + CPA must align before implementation begins. Each decision has a default fallback if consensus is not reached, but defaults are sub-optimal and noted as such.

### 1. Owner CoA vs System CoA — ground truth choice [BLOCKS PHASE A]

- **Context:** Owner's 109-account CoA (`docs/references/owner-chart-of-accounts.csv`) is designed for single-entity SHOP business. System's 76-account CoA assumes SHOP↔FINANCE split with full HP accounting. 11 critical code-name collisions exist (Layer 3 findings F-3-008 through F-3-022, F-3-026).
- **Options:**
  - (a) **Extend owner CoA** with FINANCE-side accounts at an agreed code range (e.g. 42-12XX or 43-XXXX for HP-specific revenue, new bad debt expense code 53-1701). Owner's accountant approves the additions. System seed updated to match.
  - (b) **Maintain 2 separate charts** in preparation for legal entity split. SHOP uses owner's 109. FINANCE uses a new 100+ account chart aligned with TFRS NPAEs for finance companies. ChartOfAccount.allowedCompanies enforced strictly.
- **Default fallback (if no decision):** option (a) — but using arbitrary code assignments that may need to change later.
- **Required input from:** Owner + owner's accountant.
- **Estimated decision time:** 1-2 hours of accountant consultation.

### 2. HP interest recognition policy [BLOCKS Phase A — F-2-005]

- **Context:** `accounting.md` says cash basis. Memory `project_interest_recognition_policy.md` says A2 cash-basis chosen but `unearnedInterest` field deferred. Code currently posts interest both at activation (full life-of-contract) AND per payment — double counting if activation JE works (currently doesn't due to F-2-001).
- **Options:**
  - (a) **Pure cash basis** — remove interest from activation JE, keep monthly recognition at payment time. Simpler, matches accounting.md.
  - (b) **Accrual with unearned interest** — recognize full interest at activation (Cr Unearned Interest liability), reverse monthly at payment (Dr Unearned Interest / Cr Interest Income). Aligns with TFRS effective-interest-rate method; needs new account + unearnedInterest field on Contract.
- **Default fallback:** option (a) — already partially implemented (payment JE recognizes monthly).
- **Required input from:** CPA (must verify TFRS NPAEs allowance for cash basis on hire-purchase interest).
- **Estimated decision time:** 1 hour CPA consultation + sign-off memo.

### 3. Commission ownership [F-2-007, F-3-028]

- **Context:** Account 42-1105 (Commission Income) is `allowedCompanies: ['SHOP']` but JournalAutoService posts it during payment journals — payments are received by FINANCE. Either entity could record it.
- **Options:**
  - (a) **FINANCE expense, SHOP income** — proper inter-company. FINANCE journal: Dr Commission Expense / Cr Cash. SHOP journal: Dr Cash / Cr Commission Income. Requires inter-company JE coordination.
  - (b) **SHOP-only recognition** — commission stays out of FINANCE books entirely; recorded only in SHOP-side ledger when settlement happens.
- **Default fallback:** option (b) — simplest, matches `allowedCompanies: ['SHOP']`. Remove commission from FINANCE payment JE.
- **Required input from:** Owner.
- **Estimated decision time:** 30 min discussion.

### 4. CR-001 VAT on interest [previously deferred]

- **Context:** Section 81(1)(ช) of Revenue Code may exempt hire-purchase interest from VAT. Currently system charges 7% VAT on (principal + commission + interest) per accounting.md.
- **Required input from:** CPA + Revenue Department interpretation.
- **Default fallback:** keep current behavior (7% VAT on interest); flag in tax report disclosure.

### 5. Inter-company transactions [F-1-011]

- **Context:** Currently single `InterCompanyTransaction` record only — both entities have no JE. Per accounting.md this is "current policy" because they're one legal entity.
- **Options:**
  - (a) **Add internal-division JEs** — even within single entity, post Dr Due-from-SHOP / Cr Cash on FINANCE side and Dr Cash / Cr Due-to-FINANCE on SHOP side using clearing accounts. Better audit trail, easier when entities split.
  - (b) **Stay with single record** — formalize current behavior; document that inter-company cash flow is intentionally invisible to GL.
- **Default fallback:** option (a) — defensible long-term.
- **Required input from:** Owner + accountant.

---

## Cross-Reference Map

Findings linked across layers (root cause / chain):

| Chain | Root | Connected findings |
|---|---|---|
| **Activation JE chain** | F-2-001 (math) | → F-2-003/F-1-002 (try/catch) → F-2-004 (negative HP_RECEIVABLE) → F-4-001 (orphan in prod) |
| **Bad Debt → Salary** | F-3-026 | ↔ F-2-002 ↔ F-3-022 (53-1101 collision) |
| **PaySolutions webhook** | F-1-003 | ↔ F-4-001 (36 orphan payments in prod) |
| **42-11XX block collision** | F-3-020 | ↔ F-3-012 + F-3-013 (individual codes) ↔ F-2-009 |
| **53-11XX block shift** | F-3-022 | ↔ F-3-015 ↔ F-2-002 (same root) |
| **Year-end closing** | F-1-013 | ↔ F-6-007 |
| **Orphan tx checks** | F-1-023 | ↔ F-6-006 |
| **try/catch swallowing** | F-1-002 | ↔ F-1-016 ↔ F-1-017 ↔ F-2-008 (4 sites) |
| **allowedCompanies bypass** | F-3-027 | ↔ F-3-028 ↔ F-2-007 |
| **Stock no JE** | F-1-006 | ↔ F-1-005 ↔ F-1-007 ↔ F-3-024 |

---

## Appendix

### A. SQL queries used (Layer 4)

Source: `apps/api/scripts/audit-trial-balance.ts` (committed). Inline JS version (saved to `/tmp/audit-prod.js` then base64-encoded for Cloud Run Job).

**Q1 — Monthly Trial Balance per company:**
```sql
SELECT je.company_id,
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
ORDER BY je.company_id, year, month;
```

**Q2 — DRAFT entries older than 7 days** (Prisma `journalEntry.findMany`)

**Q3 — VOIDED without reverse** (heuristic: no POSTED entry with `description ILIKE '%REVERSE%'` containing original entry number):
```sql
SELECT je.id, je.entry_number, je.updated_at
FROM journal_entries je
WHERE je.status = 'VOIDED'
  AND je.deleted_at IS NULL
  AND NOT EXISTS (...);
```

**Q4 — Orphan payments (the 36-finding):**
```sql
SELECT p.id, p.amount_paid, p.paid_at, p.contract_id, p.status::text
FROM payments p
WHERE p.deleted_at IS NULL
  AND p.status IN ('PAID', 'PARTIALLY_PAID')
  AND p.paid_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM journal_entries je
    WHERE je.reference_type = 'PAYMENT'
      AND je.reference_id = p.id
      AND je.deleted_at IS NULL
  )
ORDER BY p.paid_at DESC LIMIT 500;
```

**Q5 — Orphan PAID expenses** (similar pattern, expenses table)

**Q6 — Posted after close** (JOIN journal_entries × accounting_periods)

### B. Files inspected

**Backend services (33 files):**
- `apps/api/src/modules/journal/journal-auto.service.ts` (532 lines — core)
- `apps/api/src/modules/journal/journal.service.ts`
- `apps/api/src/modules/journal/journal.controller.ts`
- `apps/api/src/modules/journal/journal-auto.service.spec.ts`
- `apps/api/src/modules/accounting/accounting.service.ts` (1255 lines)
- `apps/api/src/modules/accounting/accounting.controller.ts`
- `apps/api/src/modules/accounting/monthly-close.service.ts` (480 lines)
- `apps/api/src/modules/accounting/monthly-close.service.spec.ts`
- `apps/api/src/modules/accounting/bad-debt.service.ts`
- `apps/api/src/modules/accounting/bank-reconciliation.service.ts`
- `apps/api/src/modules/chart-of-accounts/chart-of-accounts.service.ts`
- `apps/api/src/modules/tax/tax.service.ts`
- `apps/api/src/modules/tax/tax.controller.ts`
- `apps/api/src/modules/payments/payments.service.ts`
- `apps/api/src/modules/contracts/contract-workflow.service.ts`
- `apps/api/src/modules/contracts/contract-payment.service.ts`
- `apps/api/src/modules/sales/sales.service.ts`
- `apps/api/src/modules/repossessions/repossessions.service.ts`
- `apps/api/src/modules/trade-in/trade-in.service.ts`
- `apps/api/src/modules/purchase-orders/purchase-orders.service.ts`
- `apps/api/src/modules/inventory/stock-adjustments.service.ts`
- `apps/api/src/modules/inventory/branch-receiving.service.ts`
- `apps/api/src/modules/commission/commission.service.ts`
- `apps/api/src/modules/refunds/refunds.service.ts`
- `apps/api/src/modules/receipts/receipts.service.ts`
- `apps/api/src/modules/late-fee-waiver/late-fee-waiver.service.ts`
- `apps/api/src/modules/inter-company/inter-company.service.ts`
- `apps/api/src/modules/paysolutions/paysolutions.service.ts`
- `apps/api/src/modules/finance-receivable/finance-receivable.controller.ts`
- `apps/api/src/modules/reports/reports.controller.ts`
- `apps/api/src/modules/data-audit/data-audit.service.ts`
- `apps/api/src/modules/defect-exchange/defect-exchange.service.ts`
- `apps/api/src/utils/installment.util.ts`
- `apps/api/src/utils/period-lock.util.ts`

**Schema + seed:**
- `apps/api/prisma/schema.prisma` (ChartOfAccount, JournalEntry, JournalLine, AccountingPeriod, JournalPostAuditLog, Payment, Expense, AuditLog models)
- `apps/api/prisma/seeds/chart-of-accounts.ts`

**References:**
- `docs/references/owner-chart-of-accounts.csv` (109 accounts owner-supplied)
- `.claude/rules/accounting.md`

### C. References

- TFRS for NPAEs (มาตรฐานรายงานทางการเงินสำหรับกิจการที่ไม่มีส่วนได้เสียสาธารณะ)
- `.claude/rules/accounting.md` — internal accounting policy
- Memory: `project_interest_recognition_policy.md` — A2 cash-basis decision, unearnedInterest pending
- Memory: `reference_prod_db_oneshot_jobs.md` — Cloud Run Job pattern verified 2026-04-23
- Memory: `feedback_parallel_subagent_audit.md` — parallel subagent pattern (PR #705)
- Spec: `docs/superpowers/specs/2026-04-29-accounting-audit-discovery-design.md`
- Plan: `docs/superpowers/plans/2026-04-29-accounting-audit-discovery.md`
- Prior PRs: v4 hardening sprint (#444-#448), v5 P2P lifecycle (#712)
- Cloud Run Job execution: `audit-trial-balance-oneshot-9rgms` (2026-04-29, deleted after run)
