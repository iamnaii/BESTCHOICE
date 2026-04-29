# Layer 5 — Financial Reports Completeness

## 5.1 Existing Endpoints (key)

- `GET /journal-entries/trial-balance` — งบทดลอง from JournalLine (POSTED)
- `POST/GET /journal-entries/...` — JE CRUD + post + void
- `GET /reports/profit-loss`, `/reports/revenue-pl`, `/reports/comparative-pl`, `/reports/monthly-pl`
- `GET /reports/balance-sheet` — derived (NOT from GL)
- `GET /reports/cash-flow` — derived (operating only)
- `GET /reports/aging`, `/reports/high-risk`, `/reports/branch-comparison`, etc.
- `GET /tax/pp30-preview`, `/tax/pnd3-preview`, `/tax/pnd53-preview`
- `POST /tax/generate`, `PATCH /tax/:id/submit`
- `GET /finance-receivable/summary`
- `GET/POST /expenses/periods/...` — period close workflow

## 5.2 TFRS-Required vs System

| TFRS Requirement | Has? | Endpoint | Severity |
|---|---|---|---|
| งบกำไรขาดทุนเบ็ดเสร็จ (P&L) | YES partial | /reports/profit-loss | WARNING — derived from raw tables not GL |
| งบฐานะการเงิน (Balance Sheet) | YES partial | /reports/balance-sheet | WARNING — code comment notes "not from general ledger"; RE = A-L (tautology) |
| งบกระแสเงินสด (Cash Flow) | YES partial | /reports/cash-flow | CRITICAL — investing/financing missing |
| หมายเหตุประกอบงบ (Notes) | NO | none | CRITICAL |
| บัญชีแยกประเภท (General Ledger) | NO | none | CRITICAL — P&L/BS bypass JournalEntry |
| บัญชีย่อย HP per customer | Partial | finance portfolio | WARNING |
| งบทดลอง (Trial Balance) | YES full | /journal-entries/trial-balance | OK |
| ภ.พ.30 / ภ.ง.ด.3/53 | YES | /tax/* | OK |
| ภ.ง.ด.50 / 51 (Annual CIT) | NO | none | CRITICAL |
| ค่าเผื่อหนี้สงสัย | YES | /expenses/bad-debt/* | OK |

## Findings (Layer 5)

```yaml
- id: F-5-001
  severity: CRITICAL
  layer: 5
  title: Cash Flow Statement missing Investing & Financing sections
  location:
    - apps/api/src/modules/accounting/accounting.service.ts:1228
  evidence: |
    // No investing or financing activities are tracked separately
    const netCashChange = netOperating;
    Return has only operatingActivities + netCashChange.
  impact: |
    TFRS NPAEs requires all 3 sections. BS reconciliation impossible.
    Statutory filings will fail audit.
  recommendation: |
    Add investing (equipment) + financing (owner contributions, inter-company).
    At minimum zero-value stubs with rationale.

- id: F-5-002
  severity: CRITICAL
  layer: 5
  title: No Notes to Financial Statements
  location:
    - apps/api/src/modules/accounting/accounting.controller.ts
    - apps/api/src/modules/reports/reports.controller.ts
  evidence: |
    grep zero matches for 'notes.*financial', 'disclosures', 'หมายเหตุประกอบงบ'.
  impact: |
    TFRS NPAEs mandates: accounting policies, estimates, HP receivable aging,
    related-party (SHOP↔FINANCE), tax contingencies. Statutory filing rejection risk.
  recommendation: |
    Create NotesToFinancialStatements endpoint aggregating policies + disclosures + aging.

- id: F-5-003
  severity: CRITICAL
  layer: 5
  title: No General Ledger endpoint — P&L and Balance Sheet bypass GL
  location:
    - apps/api/src/modules/accounting/accounting.service.ts:940,495,1146
  evidence: |
    Comments at 940/1146: "Balance Sheet (derived from existing data, no general ledger)"
    P&L line 495 queries Sale, Payment, Expense models — not JournalEntry/JournalLine.
    No account-level ledger drill-down endpoint.
  impact: |
    Two independent sources of truth. Auditor cross-reference TB vs P&L → discrepancies = material misstatement.
    Audit opinion qualified.
  recommendation: |
    Implement GET /journal-entries/general-ledger?accountCode=&start=&end= with running balance.
    Refactor P&L/BS to source from JournalEntry. Add reconciliation step before period close.

- id: F-5-004
  severity: CRITICAL
  layer: 5
  title: No PND.50 / PND.51 (annual & mid-year corporate income tax) support
  location:
    - apps/api/src/modules/tax/tax.controller.ts
    - apps/api/src/modules/tax/tax.service.ts
  evidence: |
    Only PP30, PND3, PND53 supported.
    Zero matches for PND50, PND51, ภ.ง.ด.50, ภ.ง.ด.51, annual.*corporate.
  impact: |
    BESTCHOICE FINANCE (VAT-registered) must file ภ.ง.ด.50 annually + ภ.ง.ด.51 mid-year.
    Filing outside system = manual reconciliation high error risk.
  recommendation: |
    Add annual CIT module: aggregate annual P&L from JE, compute taxable income,
    expose preview/generate matching Revenue Dept form.

- id: F-5-005
  severity: WARNING
  layer: 5
  title: Balance Sheet retained earnings = A-L (always balanced by definition)
  location:
    - apps/api/src/modules/accounting/accounting.service.ts:1093,1140
  evidence: |
    const retainedEarnings = totalAssets.sub(totalLiabilities);
    Code comment: "When GL implemented, should verify A=L+E independently."
  impact: |
    BS cannot detect data integrity errors. Always "balances" by residual computation.
    Auditor expects RE traceable to prior-year balance + current net profit.
  recommendation: |
    Source RE from cumulative net profit across CLOSED periods + opening equity.
    Verify A=L+E independently during period close.

- id: F-5-006
  severity: WARNING
  layer: 5
  title: No HP Receivable subsidiary ledger endpoint per customer
  location:
    - apps/api/src/modules/finance-receivable/finance-receivable.controller.ts
  evidence: |
    No endpoint for per-customer HP balance + payment history with breakdown + running balance
    suitable for TFRS subsidiary ledger reconciliation against control account 11-2102.
    FinanceReceivable module = external finance company receivables not internal HP.
  impact: |
    TFRS NPAEs requires subsidiary ledger to tie to control account.
    Auditors cannot verify completeness of 11-2102 balance.
  recommendation: |
    Add GET /contracts/:id/ledger with amortization + running principal + total paid + interest earned.
    Cross-reference summary endpoint to reconcile against TB 11-2102.

- id: F-5-007
  severity: INFO
  layer: 5
  title: P&L uses raw tables not JournalEntry — reconciliation untested
  location:
    - apps/api/src/modules/accounting/accounting.service.ts:495
  evidence: |
    getProfitLossReport queries Sale/Payment/Expense/FinanceReceivable directly.
    No automated reconciliation step.
  impact: |
    Silent divergence between P&L and TB possible if JE write fails but source tx succeeds.
  recommendation: |
    In startReview(): compare P&L revenue/expense vs TB account groups, surface discrepancies in auditIssues.
```

# Layer 6 — Period Close Hardening

## 6.1 Close Workflow Analysis

State machine: OPEN → REVIEW → CLOSED → SYNCED. Reopen: CLOSED → OPEN (blocked if SYNCED).
Guards correct: OWNER|FINANCE_MANAGER for review/close; OWNER only for reopen.

**(a) CLOSED period blocking JournalEntry mutations:**
- `validatePeriodOpen()` correctly called from JournalService.create, PaymentsService, ReceiptsService, AccountingService.createExpense, ContractPaymentService.
- **GAP:** JournalService.post() (DRAFT→POSTED) does NOT call validatePeriodOpen. DRAFT created before close can be posted after close into closed month.
- **GAP:** JournalAutoService does NOT call validatePeriodOpen at all. Auto-entries bypass period lock.

**(b) Pre-close checklist:**
- runDataAudit checks: POSTED count, unbalanced JEs, payments without breakdown.
- closePeriod() does NOT read auditIssues.hasIssues. Period with hasIssues=true can close silently.
- No checks: DRAFT entries in period, unbalanced TB, orphan payments.

**(c) Reopen audit trail:**
- reopenPeriod uses Logger.log() only — no AuditLog DB record.
- Controller missing @Request() — userId never captured.
- boardResolutionId logged to stdout only, not persisted.

**(d) Late posting:**
- Manual create: blocked by validatePeriodOpen ✓
- Manual post: NOT blocked — gap.
- Auto JE: NOT blocked — gap.

**(e) Year-end closing:**
- No year-end closing entries.
- Revenue/expense never closed to retained earnings.
- getBalanceSheet computes RE as A-L residual.
- No YEAR_END status, no generateYearEndClosingEntries method.

## Findings (Layer 6)

```yaml
- id: F-6-001
  severity: CRITICAL
  layer: 6
  title: JournalService.post() does not validate CLOSED period — late posting allowed
  location:
    - apps/api/src/modules/journal/journal.service.ts:200
  evidence: |
    post(id, userId, meta) does balance re-check only. NO validatePeriodOpen.
    DRAFT entry with entryDate=2025-03-15 can be posted on 2026-04-29
    even though March 2025 is CLOSED.
  impact: |
    Period close integrity violated. Posted entries with dates in closed periods
    alter TB retroactively. Statutory auditor red flag.
  recommendation: |
    Add validatePeriodOpen(prisma, entry.entryDate, entry.companyId) at start of post().

- id: F-6-002
  severity: CRITICAL
  layer: 6
  title: JournalAutoService bypasses period lock entirely
  location:
    - apps/api/src/modules/journal/journal-auto.service.ts
  evidence: |
    No import of validatePeriodOpen, no AccountingPeriod reference, no period check in create* methods.
    All system-generated JEs (activation, payment, expense, bad debt) bypass the lock.
  impact: |
    Most common path for accidentally mutating closed-period data.
    Webhook payments with backdated entry alter closed period TB.
  recommendation: |
    JournalAutoService should call validatePeriodOpen for entryDate.
    For webhooks where payment must be accepted: log WARNING + post to current open period
    with reference note, not silently backdate.

- id: F-6-003
  severity: CRITICAL
  layer: 6
  title: closePeriod() does not enforce auditIssues.hasIssues — closes with known errors
  location:
    - apps/api/src/modules/accounting/monthly-close.service.ts:154
  evidence: |
    closePeriod checks status==REVIEW only. NEVER reads existing.auditIssues.
    Period with hasIssues=true (unbalanced JEs, payments without breakdown) can close silently.
  impact: |
    Period close cosmetic. Known integrity issues preserved in reportSnapshot → wrong statutory reports.
  recommendation: |
    Read existing.auditIssues. If hasIssues throw BadRequestException with details.
    Provide force-override for OWNER with written justification string.

- id: F-6-004
  severity: CRITICAL
  layer: 6
  title: reopenPeriod() does not create AuditLog or capture userId
  location:
    - apps/api/src/modules/accounting/monthly-close.service.ts:253
    - apps/api/src/modules/accounting/accounting.controller.ts:268
  evidence: |
    Controller: reopenPeriod(@Body() dto) — no @Request, no userId.
    Service: only this.logger.log() — no prisma.auditLog.create.
    boardResolutionId only in log line, not DB.
    AccountingPeriod.update clears closedAt/closedById/auditIssues but no reopenedById/At/boardResolutionId.
  impact: |
    Reopening closed period = high-risk action altering filed FS.
    Without persistent audit trail, action untraceable except via ephemeral Cloud Run logs.
    Revenue Dept / external auditors require Board approval evidence.
    PDPA + Thai accounting law compliance gap.
  recommendation: |
    1. Add @Request() req, pass req.user.id.
    2. Add reopenedById/reopenedAt/boardResolutionId to AccountingPeriod (or PeriodReopenAuditLog model).
    3. Create AuditLog: action=PERIOD_REOPEN, entity=accounting_period, with boardResolutionId.

- id: F-6-005
  severity: WARNING
  layer: 6
  title: Pre-close checklist does not check DRAFT journal entries in period
  location:
    - apps/api/src/modules/accounting/monthly-close.service.ts:355
  evidence: |
    runDataAudit only counts POSTED + payments without breakdown.
    DRAFT entries in period not counted.
  impact: |
    DRAFT invisible to TB and P&L. Unposted expense JE for March → expense not in March's financials.
    Detected only when DRAFT eventually posted (after close — see F-6-001).
  recommendation: |
    Add to runDataAudit: count JE WHERE status=DRAFT + entryDate in period.
    Include in auditIssues + hasIssues logic.

- id: F-6-006
  severity: WARNING
  layer: 6
  title: Pre-close does not verify orphan payments (Payment without JE)
  location:
    - apps/api/src/modules/accounting/monthly-close.service.ts:399
  evidence: |
    Checks paymentsWithoutBreakdown (monthlyPrincipal=null). NOT orphan check.
    No cross-reference of PAID payments vs JournalEntry.referenceId.
  impact: |
    Payment without JE = cash inflow not in double-entry ledger. TB understates cash + revenue.
    Material misstatement risk.
  recommendation: |
    Add orphan check: PAID payments in period vs JE refType=PAYMENT.
    Include orphanPayments count in auditIssues.

- id: F-6-007
  severity: WARNING
  layer: 6
  title: No year-end closing entries — income statement never zeroed to retained earnings
  location:
    - apps/api/src/modules/accounting/accounting.service.ts:1093
  evidence: |
    getBalanceSheet: const retainedEarnings = totalAssets.sub(totalLiabilities);
    No generateYearEndClosingEntries method.
    No YEAR_END/YEAR_CLOSE status in AccountingPeriodStatus enum.
    Revenue 41-/42- and expense 51-/53- accumulate indefinitely without closing to 32-1001.
  impact: |
    TFRS NPAEs requires year-end revenue/expense closed to RE so next year starts zero.
    Without closing: TB carries multi-year cumulative totals.
    Period-level P&L impossible from TB alone.
    Year-end FS structurally incorrect for Revenue Dept/BOJ/bank covenants.
  recommendation: |
    Implement generateYearEndClosingEntries(companyId, year):
    1. Sum revenue → Income Summary
    2. Sum expense → Income Summary
    3. Net → Retained Earnings (32-1001)
    Auto-trigger when December closes, or explicit step.

- id: F-6-008
  severity: WARNING
  layer: 6
  title: Legacy AccountingPeriod endpoints under /expenses — confusing path
  location:
    - apps/api/src/modules/accounting/accounting.controller.ts:169,219
  evidence: |
    Period management routes under /expenses prefix.
    GET /expenses/period-status + POST /expenses/close-period are LEGACY SystemConfig-based,
    separate from new MonthlyCloseService.
    Two period-close systems coexist.
  impact: |
    Legacy writes to SystemConfig.accounting_period_closed_until.
    New writes to AccountingPeriod. Both checked by validatePeriodOpen (two-tier).
    UI could close via legacy bypassing REVIEW→CLOSED workflow + audit + snapshot.
  recommendation: |
    Deprecate + disable legacy GET /expenses/period-status + POST /expenses/close-period.
    Migrate UI to MonthlyCloseService /expenses/periods/*. Remove Tier-2 SystemConfig check.

- id: F-6-009
  severity: INFO
  layer: 6
  title: Pre-close does not check unbalanced trial balance for the period
  location:
    - apps/api/src/modules/accounting/monthly-close.service.ts:436
  evidence: |
    generateReportSnapshots calls getTrialBalance during closePeriod.
    Stores in reportSnapshot. If unbalanced (balanced:false) close NOT blocked.
    Snapshot stores balanced:false silently.
  impact: |
    Period CLOSED with demonstrably unbalanced TB.
    Statutory filings from this period incorrect.
  recommendation: |
    After generateReportSnapshots in closePeriod: read reportSnapshot.trialBalance.balanced.
    If false: throw BadRequestException OR require OWNER acknowledgment with justification.
```

## Summary

**FAIL** — 4 CRITICAL + 4 WARNING + 1 INFO (Layer 6); 4 CRITICAL + 2 WARNING + 1 INFO (Layer 5)

**Critical issues requiring fix before statutory filing:**
1. Cash flow missing investing/financing (F-5-001)
2. No Notes to FS (F-5-002)
3. No General Ledger — P&L/BS bypass JE (F-5-003)
4. No PND.50/PND.51 support (F-5-004)
5. JournalService.post() doesn't check CLOSED (F-6-001)
6. JournalAutoService bypasses period lock (F-6-002)
7. closePeriod doesn't enforce auditIssues.hasIssues (F-6-003)
8. reopenPeriod no AuditLog + no userId (F-6-004)
