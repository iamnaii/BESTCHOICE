# Layer 1 — Event Coverage Matrix

**Date:** 2026-04-29
**Scope:** `apps/api/src/modules/` — all services that write money-touching entities
**JournalAutoService:** `apps/api/src/modules/journal/journal-auto.service.ts`
**Methods available in JournalAutoService:** `createPaymentJournal`, `createExpenseJournal`, `createContractActivationJournal`, `createReversalJournal`, `createBadDebtWriteOffJournal`, `getTrialBalance`

## Event Coverage Matrix

| # | Event | Trigger service:line | JournalAutoService method | Called? | Status | Severity if missing |
|---|---|---|---|---|---|---|
| 1 | POS — Cash sale (เงินสด/โอน/QR) | `sales/sales.service.ts:407` (`createCashSale`) | *(none — TODO)* | No | ✗ | CRITICAL |
| 2 | POS — External finance sale (GFIN/KTC) | `sales/sales.service.ts:650` (`createExternalFinanceSale`) | *(none — TODO)* | No | ✗ | CRITICAL |
| 3 | POS — Internal installment sale | `sales/sales.service.ts:471` | *(none — TODO at 576)* | No | ✗ | WARNING |
| 4 | Contract — ACTIVATE | `contracts/contract-workflow.service.ts:428` | `createContractActivationJournal` | Yes — wrapped in try/catch swallowing error | partial | CRITICAL |
| 5 | Contract — EARLY_PAYOFF | `contracts/contract-payment.service.ts:180` | `createPaymentJournal` per installment | Yes — propagates in tx | ✓ | — |
| 6 | Contract — RESTRUCTURE | not implemented | (none) | N/A | N/A | INFO |
| 7 | Contract — DEFECT_EXCHANGE | `defect-exchange/defect-exchange.service.ts:162,174` | `createReversalJournal` | Yes — inside tx | ✓ | — |
| 8 | Contract — VOID/soft-delete (DRAFT/REJECTED) | `contracts/contracts.service.ts` | (none) | No (DRAFT had no JE) | partial | WARNING |
| 9 | Contract — REPOSSESSION_PREVIEW | `repossessions/repossessions.service.ts:76` | (read-only) | N/A | ✓ | — |
| 10 | Contract — REPOSSESSION_COMPLETE | `repossessions/repossessions.service.ts:269` | `createBadDebtWriteOffJournal` | Yes inside tx | ✓ | — |
| 11 | Repossession — READY_FOR_SALE/SOLD | `repossessions/repossessions.service.ts:406,363` | (none) | No | ✗ | WARNING |
| 12 | Payment — full installment | `payments/payments.service.ts:184` | `createPaymentJournal` | Yes only `isPaidInFull` | ✓ | — |
| 13 | Payment — partial | `payments/payments.service.ts:162` | `createPaymentJournal` | No — skipped | partial | WARNING |
| 14 | Payment — autoAllocate | `payments/payments.service.ts:358` | per fully-paid installment | Yes inside tx | ✓ | — |
| 15 | Payment — credit balance allocation | `payments/payments.service.ts:732` | `createPaymentJournal` | Yes inside tx | ✓ | — |
| 16 | Payment — overpayment → creditBalance | `payments/payments.service.ts:405` | (none) | No | ✗ | CRITICAL |
| 17 | Payment — PaySolutions webhook (QR) | `paysolutions/paysolutions.service.ts:713` | (none — direct row updates) | No | ✗ | CRITICAL |
| 18 | Payment — refund (markReversed PROCESSED) | `refunds/refunds.service.ts:204` | (none) | No | ✗ | CRITICAL |
| 19 | Receipt — VOID | `receipts/receipts.service.ts:418` | `createReversalJournal` wrapped try/catch | partial | partial | WARNING |
| 20 | Trade-in — accept | `trade-in/trade-in.service.ts` | (not injected) | No | ✗ | CRITICAL |
| 21 | Stock — PURCHASE | `purchase-orders/purchase-orders.service.ts` | (not injected) | No | ✗ | CRITICAL |
| 22 | Stock — TRANSFER | `inventory/branch-receiving.service.ts` | (none) | No | ✗ | WARNING |
| 23 | Stock — ADJUSTMENT (DAMAGED/LOST/FOUND) | `inventory/stock-adjustments.service.ts` | (not injected) | No | ✗ | CRITICAL |
| 24 | Stock — WRITE_OFF | `inventory/stock-adjustments.service.ts` | (none) | No | ✗ | CRITICAL |
| 25-26 | Expense — SUBMIT/APPROVE | `accounting.service.ts` | (none expected — not yet paid) | N/A | ✓ | — |
| 27 | Expense — PAY | `accounting.service.ts:375` | `createExpenseJournal` wrapped try/catch | partial | partial | CRITICAL |
| 28 | Expense — VOID after PAID | `accounting.service.ts:397` | (no reversal JE) | No | ✗ | CRITICAL |
| 29 | Commission — accrue | `commission/commission.service.ts:78` | (none) | No | ✗ | WARNING |
| 30 | Commission — approve | `commission/commission.service.ts:647` | (none) | No | ✗ | WARNING |
| 31 | Commission — markPaid (cash out) | `commission/commission.service.ts:249` | (not injected) | No | ✗ | CRITICAL |
| 32 | Commission — clawback | `commission/commission.service.ts:287` | (none) | No | ✗ | WARNING |
| 33 | Commission — payout markPayoutPaid | `commission/commission.service.ts:682` | (none) | No | ✗ | CRITICAL |
| 34 | Bad debt — calculateProvisions | `bad-debt.service.ts:55` | (no provision JE — only write-off) | No | ✗ | CRITICAL |
| 35 | Bad debt — writeOff | `bad-debt.service.ts:340` | `createBadDebtWriteOffJournal` | Yes inside tx | ✓ | — |
| 36 | Bad debt — recovery | not found | (none) | No | ✗ | CRITICAL |
| 37 | Late fee — assessment (cron) | payments cron | (none — cash basis OK) | N/A | ✓ | — |
| 38 | Late fee — waiver approved | `late-fee-waiver/late-fee-waiver.service.ts` | (TODO comment) | No | ✗ | WARNING |
| 39 | Inter-company SHOP↔FINANCE settlement | `inter-company/inter-company.service.ts:45` | (record only, no JE) | No | ✗ | CRITICAL |
| 40 | VAT submission (PP.30 to Revenue Dept) | `tax/tax.service.ts` | (no payment JE) | No | ✗ | CRITICAL |
| 41 | Period close OPEN→REVIEW→CLOSED | `monthly-close.service.ts:104,154` | `getTrialBalance` (read-only) | N/A | partial | — |
| 42 | Year-end closing entries | `monthly-close.service.ts` | (none) | No | ✗ | CRITICAL |
| 43 | Opening balance entry | `monthly-close.service.ts` | (none) | No | ✗ | WARNING |
| 44 | Data migration — retroactive activation JE | `data-audit/data-audit.service.ts:1081` | `createContractActivationJournal` | Yes | ✓ | — |
| 45 | Data migration — retroactive payment JE | `data-audit/data-audit.service.ts:1145` | `createPaymentJournal` | Yes | ✓ | — |

## Findings (Layer 1)

```yaml
- id: F-1-001
  severity: CRITICAL
  layer: 1
  title: Cash/Transfer/QR POS sale creates no journal entry (COGS or Revenue)
  location:
    - apps/api/src/modules/sales/sales.service.ts:443
    - apps/api/src/modules/sales/sales.service.ts:692
  evidence: |
    Line 443/692: TODO comments. Neither createCashSale nor createExternalFinanceSale
    injects or calls JournalAutoService. Sale model creates no JE.
  impact: |
    Every cash/QR/transfer sale (SHOP's primary revenue) produces zero JEs.
    Revenue (41-1101/41-1102) and COGS (51-1101/51-1102) never posted.
    Trial Balance and P&L systematically understated for SHOP.
  recommendation: |
    Add JournalAutoService to SalesService. Post Dr.Cash + Dr.COGS / Cr.Revenue + Cr.Inventory
    inside existing $transaction.

- id: F-1-002
  severity: CRITICAL
  layer: 1
  title: Contract activation journal wrapped in try/catch — failure silently swallowed
  location:
    - apps/api/src/modules/contracts/contract-workflow.service.ts:428-445
  evidence: |
    try { await journalAutoService.createContractActivationJournal(...) } catch { logger.error }
    Catch logs but does NOT rethrow. $transaction commits even if JE fails.
  impact: |
    Silent divergence: contract ACTIVE, no ledger entry. HP Receivable/Revenue/VAT never posted.
    Defeats v4 P0 guard (createAndPost throws on unbalanced).
  recommendation: |
    Remove try/catch. Let exception propagate so $transaction rolls back atomically.

- id: F-1-003
  severity: CRITICAL
  layer: 1
  title: PaySolutions webhook payment creates no journal entry
  location:
    - apps/api/src/modules/paysolutions/paysolutions.service.ts:713-816
  evidence: |
    handlePaymentCallback() updates Payment rows + closes contract but never calls
    JournalAutoService or PaymentsService.recordPayment. No JournalAutoService dependency.
  impact: |
    All LIFF QR payments (primary customer payment channel) produce zero JEs.
    Likely majority of monthly revenue with no ledger trace.
  recommendation: |
    Inject JournalAutoService. After fullyPaid update inside webhook tx, call
    createPaymentJournal. Errors must propagate.

- id: F-1-004
  severity: CRITICAL
  layer: 1
  title: Overpayment stored as Contract.creditBalance with no journal entry
  location:
    - apps/api/src/modules/payments/payments.service.ts:405-416
  evidence: |
    contract.update({ creditBalance: { increment: overpayment } }) — no JE for credit balance.
    Customer Credit (21-5101) is a liability but no Cr.21-5101/Dr.Cash entry exists.
  impact: |
    Off-balance-sheet liabilities. When credit later allocated (line 732 path posts JE),
    cash gets double-counted.
  recommendation: |
    On overpayment: Dr.Cash / Cr.CustomerCredit. On allocation: Dr.CustomerCredit / Cr.HPReceivable.

- id: F-1-005
  severity: CRITICAL
  layer: 1
  title: Trade-in (รับซื้อมือสอง) creates no journal entry — cash out + stock in unrecorded
  location:
    - apps/api/src/modules/trade-in/trade-in.service.ts:1-80
  evidence: |
    JournalAutoService NOT injected. Trade-in pays cash + adds Inventory Used (11-3102), no JE.
  impact: |
    Cash overstated, Inventory Used understated. Significant business volume.
  recommendation: |
    Add createTradeInJournal: Dr.Inventory Used / Cr.Cash [appraisalPrice].

- id: F-1-006
  severity: CRITICAL
  layer: 1
  title: Purchase Order receipt (Stock IN from supplier) creates no journal entry
  location:
    - apps/api/src/modules/purchase-orders/purchase-orders.service.ts:1-80
  evidence: |
    JournalAutoService not injected. PO receipt creates GoodsReceiving but no JE.
  impact: |
    Inventory has no debit from procurement. AP/Cash never credited. COGS basis unreliable.
  recommendation: |
    Add createStockPurchaseJournal: Dr.Inventory + Dr.VAT Input / Cr.AP or Cash.

- id: F-1-007
  severity: CRITICAL
  layer: 1
  title: Stock WRITE_OFF / DAMAGED / LOST adjustment creates no journal entry
  location:
    - apps/api/src/modules/inventory/stock-adjustments.service.ts:20-80
  evidence: |
    StockAdjustmentsService: only PrismaService. DAMAGED/LOST/WRITTEN_OFF post no Dr.Loss/Cr.Inventory.
  impact: |
    Inventory account overstated. Loss expense never recognized.
    TFRS NPAEs requires inventory write-down expensed in period.
  recommendation: |
    Add createInventoryAdjustmentJournal: Dr.Loss Expense / Cr.Inventory. Reverse on FOUND.

- id: F-1-008
  severity: CRITICAL
  layer: 1
  title: Commission markPaid / markPayoutPaid creates no cash-out journal entry
  location:
    - apps/api/src/modules/commission/commission.service.ts:249-266
    - apps/api/src/modules/commission/commission.service.ts:682-703
  evidence: |
    CommissionService: no JournalAutoService. Status→PAID, paidAt set, no Cr.Cash/Dr.CommissionPayable.
  impact: |
    Commission payments invisible to GL. Cash overstated, expense/payable understated.
    PP.30 and CIT calculations incorrect.
  recommendation: |
    Inject JournalAutoService. On markPayoutPaid: Dr.CommissionPayable / Cr.Cash inside tx.

- id: F-1-009
  severity: CRITICAL
  layer: 1
  title: Bad debt PROVISION creates no journal entry for Allowance account
  location:
    - apps/api/src/modules/accounting/bad-debt.service.ts:55-154
  evidence: |
    calculateProvisions() creates BadDebtProvision rows. No JE for Dr.Bad Debt Expense / Cr.Allowance.
  impact: |
    Allowance for Doubtful (11-2103) always zero on TB. Net HP Receivable overstates collectible.
    On write-off, Dr.Allowance debits zero-balance contra → spurious debit balance.
  recommendation: |
    Add createProvisionJournal: Dr.Bad Debt Expense / Cr.Allowance for Doubtful.

- id: F-1-010
  severity: CRITICAL
  layer: 1
  title: Expense VOID after PAID creates no reversal journal entry
  location:
    - apps/api/src/modules/accounting/accounting.service.ts:397-425
  evidence: |
    voidExpense() updates status=VOIDED but does NOT find/reverse original JE.
    No call to createReversalJournal.
  impact: |
    Voiding paid expense leaves original Dr.Expense/Cr.Cash on ledger. Cash + expense permanently overstated.
    Receipts service correctly calls createReversalJournal — inconsistency.
  recommendation: |
    In voidExpense(): find JE WHERE referenceType='EXPENSE' AND referenceId=id, call createReversalJournal in $transaction.

- id: F-1-011
  severity: CRITICAL
  layer: 1
  title: Inter-company SHOP↔FINANCE settlement creates no journal entry
  location:
    - apps/api/src/modules/inter-company/inter-company.service.ts:25-69
  evidence: |
    createFromSale() creates one InterCompanyTransaction record only. No JE either side.
  impact: |
    Inter-company A/R-A/P entirely off-ledger. When entities split, no history to reconcile.
    Even now, FINANCE's cash outflow to SHOP invisible.
  recommendation: |
    Business decision needed (per accounting.md current policy = single record).
    At minimum record cash settlement JE within each entity's books.

- id: F-1-012
  severity: CRITICAL
  layer: 1
  title: VAT remittance to Revenue Department creates no journal entry
  location:
    - apps/api/src/modules/tax/tax.service.ts:126-180
  evidence: |
    generate() creates TaxReport DRAFT/FILED. No state transition posts Dr.VAT Output / Cr.Cash.
    No JournalAutoService injection.
  impact: |
    21-2101 accumulates monthly via payments but never reduced when paid to Revenue Dept.
    TB shows growing 21-2101 credit balance that never clears.
  recommendation: |
    Add markFiled/recordPayment action: update status FILED + post Dr.VAT Output / Cr.Cash in $tx.

- id: F-1-013
  severity: CRITICAL
  layer: 1
  title: Year-end closing entries absent — Revenue/Expense never closed to Retained Earnings
  location:
    - apps/api/src/modules/accounting/monthly-close.service.ts:154-199
  evidence: |
    closePeriod() generates snapshots + status=CLOSED. No closing JE.
    No year-end-specific logic. No Retained Earnings in ACC map.
  impact: |
    Income statement accounts carry forward indefinitely. Balance sheet Equity has no Retained Earnings movement.
    Comparative P&L between years impossible from ledger.
  recommendation: |
    Add yearEndClose(): Sum Revenue → Income Summary, Sum Expense → Income Summary, Net → Retained Earnings.
    Trigger when month=12. Add Retained Earnings code to ChartOfAccount.

- id: F-1-014
  severity: CRITICAL
  layer: 1
  title: Refund PROCESSED (bank reversal confirmed) creates no journal entry
  location:
    - apps/api/src/modules/refunds/refunds.service.ts:181-229
  evidence: |
    markReversed() updates status=PROCESSED. No JournalAutoService. Original payment JE remains posted.
  impact: |
    Cash overstated by all refund amounts. Income from original payment never reversed.
  recommendation: |
    Inject JournalAutoService. In markReversed(): find original payment JE + createReversalJournal.

- id: F-1-015
  severity: WARNING
  layer: 1
  title: Partial payment (PARTIALLY_PAID) skips journal entry
  location:
    - apps/api/src/modules/payments/payments.service.ts:180-200
  evidence: |
    if (isPaidInFull) { createPaymentJournal(...) } — comment acknowledges gap.
    Real cash received but no entry until installment fully paid.
  impact: |
    If period closed during partial-paid state, cash receipt never appears in that period.
  recommendation: |
    For partial: post Dr.Cash / Cr.AdvancePayment. On full: reverse advance + post normally.

- id: F-1-016
  severity: WARNING
  layer: 1
  title: Expense payment journal wrapped in try/catch — failure silently swallowed
  location:
    - apps/api/src/modules/accounting/accounting.service.ts:374-391
  evidence: |
    Same pattern as F-1-002. Catch swallows error, no Sentry capture.
    Expense.status=PAID even if JE failed.
  impact: |
    Cash overstated, expense understated. Silent divergence.
  recommendation: |
    Remove try/catch (let propagate) or minimum add Sentry.captureException.

- id: F-1-017
  severity: WARNING
  layer: 1
  title: Receipt VOID reversal journal wrapped in try/catch — silently swallowed
  location:
    - apps/api/src/modules/receipts/receipts.service.ts:407-426
  evidence: |
    try-catch swallows reversal JE failure. Receipt voided + credit note created but original JE remains.
  impact: |
    Revenue + VAT permanently overstated for any silently-failed reversal.
  recommendation: |
    Remove try/catch. Let propagate.

- id: F-1-018
  severity: WARNING
  layer: 1
  title: Repossession READY_FOR_SALE / SOLD create no inventory/revenue journal
  location:
    - apps/api/src/modules/repossessions/repossessions.service.ts:363-399,406-460
  evidence: |
    update() handles SOLD transitions. costPrice adjusted. No JE for resale (Inventory Used → Cash/Revenue).
  impact: |
    Resale revenue from repossessed devices not posted.
  recommendation: |
    On SOLD: createResellJournal (Dr.Cash / Cr.Revenue Used + Dr.COGS Used / Cr.Inventory Used).

- id: F-1-019
  severity: WARNING
  layer: 1
  title: Commission accrual not journalized — commission liability unrecorded
  location:
    - apps/api/src/modules/commission/commission.service.ts:78-130,647-677
  evidence: |
    PENDING/APPROVED transitions: no JE. Under accrual, commission expense should arise at sale.
  impact: |
    Commission Expense + Payable accounts zero on TB until markPayoutPaid (which also has no JE).
  recommendation: |
    Business decision: cash-basis or accrual? Either way, PAID must have JE.

- id: F-1-020
  severity: WARNING
  layer: 1
  title: Late fee waiver approved zeroes lateFee with no journal entry
  location:
    - apps/api/src/modules/late-fee-waiver/late-fee-waiver.service.ts:1-30
  evidence: |
    Header TODO: "Journal impact intentionally NOT auto-posted yet — open accountant question."
  impact: |
    Currently OK under cash-basis. Becomes critical when N-005 accrual implemented.
  recommendation: |
    Document in AuditLog at minimum. Implement waiver reversal JE when N-005 done.

- id: F-1-021
  severity: WARNING
  layer: 1
  title: Stock transfer (branch-to-branch) creates no journal entry
  location:
    - apps/api/src/modules/inventory/branch-receiving.service.ts
  evidence: |
    No JournalAutoService injection. Product branchId updated, no JE.
  impact: |
    OK if branches not separate inventory pools on TB. SHOP↔FINANCE ownership transfers DO need JE.
  recommendation: |
    Clarify with owner/accountant. FINANCE-owned product transfers always need JE.

- id: F-1-022
  severity: INFO
  layer: 1
  title: POS installment sale has TODO comment for COGS journal
  location:
    - apps/api/src/modules/sales/sales.service.ts:576
  evidence: |
    COGS posted at activation (contract-workflow.service.ts:428), not at sale. OK if all sales activate.
  impact: |
    Minor — only affects DRAFT contracts that never activate.
  recommendation: |
    Remove TODO + document deferred-to-activation. Monitor stale DRAFT contracts.

- id: F-1-023
  severity: INFO
  layer: 1
  title: Period close has no pre-close guard for orphan transactions
  location:
    - apps/api/src/modules/accounting/monthly-close.service.ts:154-199
  evidence: |
    closePeriod() REVIEW→CLOSED without checking PAID payments without JE.
    runDataAudit() checks unbalanced JEs + missing breakdown only.
  impact: |
    Periods can be CLOSED with orphan transactions — gaps locked in once SYNCED.
  recommendation: |
    Add orphan-tx check to runDataAudit(). Optionally block closePeriod() if count > 0.
```

## Summary

**FAIL — 14 CRITICAL, 7 WARNING, 2 INFO**

Top 3 critical risks:
1. **PaySolutions webhook (F-1-003)** — primary customer payment channel posts zero JEs
2. **Cash/POS sales (F-1-001)** — SHOP's primary revenue invisible to GL
3. **try/catch swallowing journal errors (F-1-002, F-1-016, F-1-017)** — v4 P0 guard defeated at 3 sites

Structural gap: JournalAutoService has methods for 5 event types. Codebase has at least 10 additional money-touching event types with **zero journal coverage**.
