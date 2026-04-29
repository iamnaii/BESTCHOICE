# Layer 2 — Journal Correctness

## Methods Reviewed

| Method | Lines | Purpose |
|---|---|---|
| `createAndPost` | 75–127 | Internal: create + balance-validate + post JE |
| `createPaymentJournal` | 142–199 | Dr Cash / Cr HP_Receivable + Interest + Commission + VAT + LateFee |
| `createExpenseJournal` | 208–250 | Dr Expense + Dr VAT_Input / Cr Cash |
| `createContractActivationJournal` | 265–338 | Dr Cash + Dr HP_Receivable / Cr Revenue + Interest + VAT; Dr COGS / Cr Inventory |
| `createReversalJournal` | 344–372 | Swap Dr/Cr of original entry |
| `createBadDebtWriteOffJournal` | 390–445 | Dr BadDebt + Dr Allowance / Cr HP_Receivable |
| `getTrialBalance` | 450–531 | Aggregation query — no JE creation |

## Findings (Layer 2)

```yaml
- id: F-2-001
  severity: CRITICAL
  layer: 2
  title: createContractActivationJournal overstates HP_RECEIVABLE by double-counting i+c+v
  location:
    - apps/api/src/modules/journal/journal-auto.service.ts:297
    - apps/api/src/utils/installment.util.ts:56
  evidence: |
    Line 297: hpReceivable = financedAmount.add(interest).add(commission).add(vat)
    But Contract.financedAmount already = principal + storeCommission + interestTotal + vatAmount.
    So hpReceivable = (principal+c+i+v) + i+c+v = principal+2c+2i+2v.
    Dr side = downPayment + hpReceivable, Cr side = (sellingPrice+commission) + interest + vat.
    Imbalance = commission+interest+vat per contract.
  impact: |
    createAndPost balance check throws InternalServerErrorException on EVERY real contract.
    The try/catch at contract-workflow.service.ts:443 silently absorbs.
    Result: ZERO contract-activation JEs in ledger. HP_RECEIVABLE never debited;
    asset side of HP portfolio absent from TB entirely.
  recommendation: |
    Replace line 297: hpReceivable = financedAmount (already includes i+c+v).
    Update test fixture to use financedAmount = principal+c+i+v matching production.

- id: F-2-002
  severity: CRITICAL
  layer: 2
  title: BAD_DEBT_EXPENSE constant maps to 53-1101 which is Salaries in seed and owner CoA
  location:
    - apps/api/src/modules/journal/journal-auto.service.ts:43
    - apps/api/prisma/seeds/chart-of-accounts.ts:163
    - docs/references/owner-chart-of-accounts.csv:87
  evidence: |
    Service: BAD_DEBT_EXPENSE: '53-1101' // หนี้สูญ
    Seed: { code: '53-1101', nameTh: 'เงินเดือน ค่าจ้าง', nameEn: 'Salaries and Wages' }
    Owner: 53-1101 = "เงินเดือน ค่าจ้าง"
    No bad-debt expense account exists in seeded chart at all.
  impact: |
    Every bad-debt write-off posts Dr to Salaries account. P&L expense classification wrong.
    Salaries inflated by all write-offs. Tax deduction basis corrupted.
  recommendation: |
    Create new account (e.g. 53-1701) for Bad Debt Expense / หนี้สูญ. Update ACC.BAD_DEBT_EXPENSE.

- id: F-2-003
  severity: CRITICAL
  layer: 2
  title: Contract activation journal silently swallowed by try/catch
  location:
    - apps/api/src/modules/contracts/contract-workflow.service.ts:443
    - apps/api/src/modules/journal/journal-auto.service.ts:265
  evidence: |
    try { createContractActivationJournal(...) } catch { logger.error }
    No rethrow, no Sentry. F-2-001 makes underlying call always throw.
    Result: every activation silently logs error and continues.
  impact: |
    Zero sales revenue/HP receivable/COGS in ledger for any contract.
    TB missing entire HP portfolio asset (potentially millions of baht).
    Period close based on incomplete data.
  recommendation: |
    Fix F-2-001 first. Then remove try/catch or add Sentry + rethrow.

- id: F-2-004
  severity: CRITICAL
  layer: 2
  title: HP_RECEIVABLE balance permanently negative — payment JEs credit without prior debit
  location:
    - apps/api/src/modules/journal/journal-auto.service.ts:192
    - apps/api/src/modules/payments/payments.service.ts:184
  evidence: |
    Payment line 192: Cr HP_RECEIVABLE [principal].
    Activation JE never created (F-2-003) → no prior Dr HP_RECEIVABLE.
    Every payment reduces an asset that was never recorded.
    On TB: HP_RECEIVABLE credit total > debit total. Net negative — credit balance on asset.
  impact: |
    HP receivable asset understated by full portfolio. Balance sheet shows phantom liability.
    Subsidiary ledger, bad-debt provision, finance-receivable report all on wrong data.
  recommendation: |
    Fix F-2-001 + F-2-003. Then run correcting JE for all activated contracts before fix
    (backfill: Dr HP_RECEIVABLE / Cr opening balance per contract, with auditor sign-off).

- id: F-2-005
  severity: CRITICAL
  layer: 2
  title: Interest income recognized at activation AND per payment — double recognition risk
  location:
    - apps/api/src/modules/journal/journal-auto.service.ts:316
    - apps/api/src/modules/journal/journal-auto.service.ts:193
  evidence: |
    Activation JE line 316: Cr INTEREST_INCOME [interestTotal] — full life-of-contract upfront.
    Payment JE line 193: Cr INTEREST_INCOME [monthlyInterest] each payment.
    Accounting.md: cash basis. Memory: unearnedInterest field NOT yet implemented.
  impact: |
    If activation JE works: income overstated at inception by full future interest;
    income double-counted each payment month (total = interestTotal × 2 over contract life).
    Currently activation JE fails (F-2-003) so only payment-level recognition exists —
    correct for cash-basis but accidental.
  recommendation: |
    Choose ONE recognition policy. Option A: remove interest from activation JE, keep monthly.
    Option B: keep interest at activation, remove from payment, add Unearned Interest liability.
    Implement unearnedInterest field on Contract (W-003).

- id: F-2-006
  severity: WARNING
  layer: 2
  title: No journal entry for customer overpayment stored as creditBalance
  location:
    - apps/api/src/modules/payments/payments.service.ts:402-408
    - apps/api/src/modules/journal/journal-auto.service.ts:35
  evidence: |
    contract.update({ creditBalance: { increment: overpayment } }) — no JE.
    CUSTOMER_CREDIT: '21-5101' defined in ACC but never used.
  impact: |
    Cash from overpayment in bank with no liability entry. TB cash overstated vs liability.
    Credit allocation also lacks JE — offset never recorded.
  recommendation: |
    Add JE: Dr Cash / Cr CustomerCredit on overpayment. Dr CustomerCredit / Cr HPReceivable on allocation.

- id: F-2-007
  severity: WARNING
  layer: 2
  title: COMMISSION_INCOME (42-1105) is SHOP-only but used in payment journals without company guard
  location:
    - apps/api/src/modules/journal/journal-auto.service.ts:40,194
    - apps/api/prisma/seeds/chart-of-accounts.ts:137
  evidence: |
    Seed: 42-1105 allowedCompanies: ['SHOP'].
    Payment JE always credits 42-1105.
    payments.service.ts calls don't pass companyId → resolveCompanyId fallback.
    Payments collected by FINANCE → likely FINANCE companyId → SHOP-only account violated.
  impact: |
    From FINANCE perspective, commission is expense not income. Recording as Cr income misstates FINANCE P&L.
    Belongs in SHOP's books.
  recommendation: |
    Determine business owner of commission. Pass explicit companyId. If FINANCE: use FINANCE-allowed expense account.

- id: F-2-008
  severity: WARNING
  layer: 2
  title: Expense journal failure silently swallowed by try/catch
  location:
    - apps/api/src/modules/accounting/accounting.service.ts:374-391
  evidence: |
    try { createExpenseJournal(...) } catch { logger.error }
    No Sentry, no rethrow.
  impact: |
    Expense PAID but JE absent. Cash + expense accounts drift.
  recommendation: |
    Add Sentry.captureException. Consider rethrow for atomicity.

- id: F-2-009
  severity: WARNING
  layer: 2
  title: Revenue codes 42-1101/02/03 conflict with owner CoA definitions
  location:
    - apps/api/prisma/seeds/chart-of-accounts.ts:133-135
    - docs/references/owner-chart-of-accounts.csv:70-73
    - apps/api/src/modules/journal/journal-auto.service.ts:38-39
  evidence: |
    System 42-1101 = HP Interest / Owner = Rounding surplus
    System 42-1102 = Late Penalty / Owner = Bank deposit interest
    System 42-1103 = Forfeited Deposits / Owner = Late payment fee
  impact: |
    PEAK sync would classify entries under completely wrong accounts.
    PEAK reports + tax preview + audit trail all wrong.
  recommendation: |
    Reconcile with accountant. Either renumber HP-specific codes or update owner CoA.

- id: F-2-010
  severity: INFO
  layer: 2
  title: Balance validation in createAndPost uses floating-point Number sum (not Decimal)
  location:
    - apps/api/src/modules/journal/journal-auto.service.ts:91-93
  evidence: |
    totalDebit = lines.reduce((s, l) => s + l.debit, 0) — JS numbers.
    Math.abs(totalDebit - totalCredit) > 0.001 — floating-point tolerance.
  impact: |
    Low risk for current 2-6 line entries. Could false-pass 0.0009 unbalanced over time.
  recommendation: |
    Use Prisma.Decimal arithmetic. Tolerance 0.01 (1 satang).

- id: F-2-011
  severity: WARNING
  layer: 2
  title: Commission double-counted in income if activation journal succeeds
  location:
    - apps/api/src/modules/journal/journal-auto.service.ts:295,194
  evidence: |
    Activation: revenue = sellingPrice + commission → Cr REVENUE [sp+c].
    Payment: Cr COMMISSION_INCOME [monthlyCommission] per installment.
    Sum monthlyCommission = storeCommission already in revenue. Income twice.
  impact: |
    If F-2-001 fixed, income statement overstates by storeCommission per contract.
  recommendation: |
    One recognition point. If upfront: credit 42-1105 separately at activation, remove from payment.
    If cash: remove from activation, keep monthly.
```

**Key Relationships:**

F-2-001 root cause → F-2-003 → F-2-004 chain.
1. financedAmount = principal+c+i+v (calculateInstallment)
2. Journal adds again: hpReceivable = financedAmount + i+c+v — double-counts
3. Balance check throws
4. try/catch absorbs silently
5. No activation JE → HP_RECEIVABLE never booked → payment JEs create negative balance

Test suite doesn't catch F-2-001 because fixture uses financedAmount = sellingPrice - downPayment (pure principal), different from production.
