# Accounting Phase A.1b — Inter-Company JE Wiring — Spec

**Date:** 2026-04-29
**Type:** Backend code refactor (no schema, no policy changes)
**Status:** Draft for review
**Predecessor:** Phase A.1a PR #723 (`feat/accounting-phase-a1a-coa-split`) — schema split SHOP + FINANCE charts, ACC remap, commission temporarily folded
**Audit source:** `docs/reports/2026-04-29-accounting-audit.md` Phase A.1b section

---

## 1. Goal

Implement proper inter-company journal entry pairing for SHOP↔FINANCE flows. Undoes A.1a's commission fold (adds proper Due-from/Due-to clearing). Adds 4 missing JE patterns: contract activation split, bad debt provision, customer credit overpayment + allocation, repossession resale.

After A.1b ships:
- SHOP and FINANCE each have correct P&L (revenue, COGS, expense booked correctly per entity)
- Inter-company clearing balances (`11-2105 Due-from-FINANCE`, `21-1102 Due-to-SHOP`) accumulate transparently
- Bad debt write-off operates on proper Allowance contra account
- Customer overpayments tracked as proper liability (not just contract field)
- Repossessed phone resales journal-posted

**Deliverable:** 1 PR, ~28 hr work, 8 backend files modified + 1 new helper, ~50 new unit tests + 1 E2E. No schema change.

**Out of scope:**
- Settlement (cash transfer FINANCE → SHOP) — A.1c or manual operations
- Backfill historical JEs with new structure — A.3 (CPA sign-off)
- Interest accrual fix (F-2-005 double recognition) — A.2 (CPA pending)
- Year-end clearing balance reconciliation — A.2

---

## 2. Background

### 2.1 What A.1a left undone

A.1a focused on schema partition (companyId per chart). For practicality during A.1a:
- Contract activation posted entirely on FINANCE side (used FINANCE_ACC for everything including REVENUE_NEW=41-2101 and COGS_NEW=51-2101)
- Payment JE folded commission into HP_RECEIVABLE credit (so balance still works without separate commission line)
- Sentry alarm `commission-deferred` fires every payment with monthlyCommission > 0 (audit trail of what's deferred)

A.1b addresses this debt:
- Activation split — SHOP records its revenue + COGS, FINANCE records HP receivable + Due-to-SHOP
- Payment commission split — proper inter-company JE pair
- Removes Sentry alarm (no longer deferred)

### 2.2 Why proper inter-company JE matters

Even though SHOP + FINANCE are 1 legal entity (same taxId), keeping books separate enables:
- Per-entity P&L for management decisions (which business unit is profitable?)
- Pre-staging for future legal entity split (no forklift refactor when splitting)
- Audit trail for inter-company commission flow (regulator-friendly)
- TFRS NPAEs alignment (proper revenue/expense recognition per entity)

### 2.3 Inter-company clearing accounts (already seeded by A.1a)

- **SHOP `11-2105` Due-from-FINANCE** — SHOP's receivable from FINANCE (commission earned, sales not yet settled)
- **FINANCE `21-1102` Due-to-SHOP** — FINANCE's payable to SHOP (commission owed, sales not yet settled)

After A.1b ships, these balances should equal at all times (inter-company invariant).

---

## 3. Scope — 5 JE patterns + 1 helper

### 3.1 Helper: `inter-company-link.util.ts` (NEW)

Create a util that:
1. Accepts 2 sets of lines (SHOP entry + FINANCE entry)
2. Creates an `InterCompanyTransaction` record linking them
3. Calls `createAndPost` for each entry within the same `$transaction`
4. Both entries share `metadata.intercompanyId` for traceability

```typescript
// Signature
async function postInterCompanyEntries(tx: Prisma.TransactionClient, params: {
  referenceType: string;     // CONTRACT | PAYMENT | REPO_RESALE | BAD_DEBT_PROVISION
  referenceId: string;
  description: string;
  shopEntry: { lines: JournalLineInput[]; createdById: string; companyId: string };
  financeEntry: { lines: JournalLineInput[]; createdById: string; companyId: string };
  amount: Decimal;            // amount of inter-company flow (for InterCompanyTransaction record)
  fromCompanyId: string;      // FINANCE for commission flow
  toCompanyId: string;        // SHOP for commission flow
}): Promise<{ shopEntryId: string; financeEntryId: string; intercompanyId: string }>
```

Internally:
- Create `InterCompanyTransaction` record (existing model)
- Call `createAndPost(tx, shopEntry, { intercompanyId })`
- Call `createAndPost(tx, financeEntry, { intercompanyId })`
- Both must succeed or transaction rolls back (atomic)

### 3.2 Contract Activation Split

**File:** `apps/api/src/modules/journal/journal-auto.service.ts createContractActivationJournal`

Replace single FINANCE-side entry with 2 paired entries:

```
SHOP entry (companyId=SHOP):
  Dr Cash (SHOP)              [downPayment]
  Dr Due-from-FINANCE         [sellingPrice + storeCommission - downPayment]
    Cr Revenue New/Used        [sellingPrice]
    Cr Commission Income       [storeCommission]
  Dr COGS New/Used             [costPrice]
    Cr Inventory New/Used      [costPrice]

FINANCE entry (companyId=FINANCE):
  Dr HP Receivable             [financedAmount]
    Cr Due-to-SHOP             [sellingPrice + storeCommission - downPayment]
    Cr Interest Income         [interestTotal]   (preserves current upfront recognition)
    Cr VAT Output              [vatAmount]
```

Math verification:
- SHOP: Dr = downPayment + (sellingPrice + commission - downPayment) + costPrice = sellingPrice + commission + costPrice
        Cr = sellingPrice + commission + costPrice ✓ balanced
- FINANCE: Dr = financedAmount = (sellingPrice - downPayment) + commission + interest + vat
          Cr = (sellingPrice - downPayment + commission) + interest + vat = same ✓ balanced

Inter-company invariant: SHOP's Dr Due-from-FINANCE = FINANCE's Cr Due-to-SHOP = (sellingPrice + commission - downPayment) ✓

### 3.3 Payment Received Split

**File:** `apps/api/src/modules/journal/journal-auto.service.ts createPaymentJournal`

Undo A.1a fold + add Due-to-SHOP + emit SHOP commission entry:

```
FINANCE entry (companyId=FINANCE):
  Dr Cash (FINANCE)            [amountPaid]
    Cr HP Receivable           [principal]   (no longer folded with commission)
    Cr Interest Income         [monthlyInterest]
    Cr Late Fee Income         [lateFee]
    Cr VAT Output              [vatAmount]
    Cr Due-to-SHOP             [monthlyCommission]

SHOP entry (companyId=SHOP):
  Dr Due-from-FINANCE          [monthlyCommission]
    Cr Commission Income       [monthlyCommission]
```

Math verification:
- FINANCE: Dr = amountPaid; Cr = principal + interest + lateFee + vat + commission = amountPaid (since amountPaid breaks down into these parts) ✓
- SHOP: Dr = commission; Cr = commission ✓

Inter-company invariant: SHOP's Dr Due-from-FINANCE = FINANCE's Cr Due-to-SHOP = monthlyCommission ✓

When monthlyCommission = 0 → skip SHOP entry (use existing zero-line filter).

### 3.4 Bad Debt Provision (NEW method)

**Files:**
- New: `journal-auto.service.ts createBadDebtProvisionJournal`
- Caller: `apps/api/src/modules/accounting/bad-debt.service.ts calculateProvisions`

Provision is a FINANCE-side single entry (no inter-company):

```
FINANCE entry (companyId=FINANCE):
  Dr Bad Debt Expense (53-1701)         [delta]
    Cr Allowance for Doubtful (11-2103) [delta]
```

Behavior:
- Delta-based: only post on increment/decrement vs previous period
- If new provision > old: Dr Expense / Cr Allowance for delta
- If new provision < old (recovery): reverse — Dr Allowance / Cr Expense for delta
- referenceType = 'BAD_DEBT_PROVISION', referenceId = `<contractId>:<period>` to allow multiple per contract per period

### 3.5 Customer Credit Overpayment + Allocation (NEW methods)

**Files:**
- New: `journal-auto.service.ts createCustomerCreditOverpaymentJournal`
- New: `journal-auto.service.ts createCreditAllocationJournal`
- Caller updates: `payments.service.ts recordPayment` overpayment branch (line ~405); `payments.service.ts allocateCreditBalance` (line ~732)

**On overpayment** (Dr Cash → Cr Customer Credit):

```
FINANCE entry (companyId=FINANCE):
  Dr Cash (FINANCE)              [overpayment]
    Cr Customer Credit (21-5101) [overpayment]
```

referenceType = 'CUSTOMER_CREDIT_OVERPAY', referenceId = paymentId

**On credit allocation** (Dr Customer Credit instead of Cash):

This REPLACES the current `createPaymentJournal` call from `allocateCreditBalance`. Same JE structure as Payment Received Split (3.3) BUT with `Dr Customer Credit` instead of `Dr Cash`.

```
FINANCE entry:
  Dr Customer Credit (21-5101)   [allocated amount]
    Cr HP Receivable             [principal portion]
    Cr Interest Income           [interest portion]
    Cr VAT Output                [vat portion]
    Cr Late Fee Income           [late fee portion]
    Cr Due-to-SHOP               [commission portion]

SHOP entry:
  Dr Due-from-FINANCE            [commission portion]
    Cr Commission Income         [commission portion]
```

referenceType = 'CREDIT_ALLOCATION', referenceId = paymentId

### 3.6 Repossession Resale (NEW method)

**Files:**
- New: `journal-auto.service.ts createRepossessionResaleJournal`
- Caller: `apps/api/src/modules/repossessions/repossessions.service.ts update SOLD branch`

```
On SOLD with gain (resellPrice > bookValue):
FINANCE entry (companyId=FINANCE):
  Dr Cash (FINANCE)                    [resellPrice]
    Cr Repossession Inventory (11-3103) [bookValue = costPrice + repairCost]
    Cr Repossession Income (42-2104)    [resellPrice - bookValue]

On SOLD with loss (resellPrice < bookValue):
FINANCE entry (companyId=FINANCE):
  Dr Cash (FINANCE)                    [resellPrice]
  Dr Loss on Repossession (53-1804)    [bookValue - resellPrice]
    Cr Repossession Inventory (11-3103) [bookValue]
```

Note: For loss case, use account `53-1503 ขาดทุน(กำไร)จากการปิดสัญญา` from owner CoA (SHOP). Wait — this is FINANCE-side resale, so the loss should go to FINANCE chart. **Decision: add new FINANCE account `53-1804 ขาดทุนจากการขายสินค้ายึดคืน` to FINANCE chart** (1 line update to seed file). Or reuse `53-1702 หนี้สงสัยจะสูญ` — no, semantically wrong.

For A.1b: add `53-1804 Loss on Repossession Resale` to FINANCE chart seed.

### 3.7 Sentry alarm cleanup

**File:** `apps/api/src/modules/journal/journal-auto.service.ts createPaymentJournal`

Remove `commission-deferred` Sentry.captureMessage call (no longer needed since commission is properly posted via 3.3).

---

## 4. Pattern Decisions (captured)

| ID | Decision | Choice |
|---|---|---|
| P1 | Commission timing | **Per payment per installment** (uses existing `payment.monthlyCommission`) |
| P2 | Settlement cash transfer | **DEFER** to A.1c or manual operations. A.1b only records clearing balances. |
| P3 | Atomic JE pairs | `$transaction` wraps SHOP+FINANCE entries together — fail both or pass both |
| P4 | Bad debt provision | **Delta-based** (post only on increment/decrement, not full re-post each cycle) |
| P5 | Credit allocation method | Separate `createCreditAllocationJournal` (uses Customer Credit Dr, not Cash) |
| P6 | Repossession bookValue | `costPrice + repairCost` (existing repossessions service convention) |
| P7 | InterCompanyTransaction link | Reuse existing model + add new entries (no schema change). Use as audit link. |
| P8 | Loss on repossession account | Add new FINANCE account `53-1804 ขาดทุนจากการขายสินค้ายึดคืน` to seed |

---

## 5. File Structure

### Modified files (8)

| File | Wave | Changes |
|---|---|---|
| `apps/api/src/modules/journal/journal-auto.service.ts` | 1, 2, 3, 4 | Major: split activation, split payment, 4 new methods, remove Sentry alarm |
| `apps/api/src/modules/contracts/contract-workflow.service.ts` | 1 | Pass SHOP companyId alongside FINANCE for activation split |
| `apps/api/src/modules/payments/payments.service.ts` | 2 | Add overpayment JE call, swap allocateCreditBalance to use new method |
| `apps/api/src/modules/paysolutions/paysolutions.service.ts` | 2 | Mirror payment JE update + add overpayment if applicable |
| `apps/api/src/modules/contracts/contract-payment.service.ts` | 2 | Mirror payment JE update (early payoff) |
| `apps/api/src/modules/data-audit/data-audit.service.ts` | 2 | Mirror payment JE update (backfill path) |
| `apps/api/src/modules/accounting/bad-debt.service.ts` | 3 | Call createBadDebtProvisionJournal on calculateProvisions delta |
| `apps/api/src/modules/repossessions/repossessions.service.ts` | 3 | Call createRepossessionResaleJournal on SOLD transition |
| `apps/api/prisma/seeds/chart-of-accounts-finance.ts` | 1 | Add `53-1804` Loss on Repossession Resale account |

### New files (1)

| File | Purpose |
|---|---|
| `apps/api/src/modules/journal/inter-company-link.util.ts` | Helper: paired SHOP+FINANCE entry creation with InterCompanyTransaction link |

### Test files (~9)

- `journal-auto.service.spec.ts` — +20 tests for new methods + split entries
- `contract-workflow.service.spec.ts` — Update activation tests
- `payments.service.spec.ts` — Update for split JE + overpayment + credit allocation
- `paysolutions.service.spec.ts` — Mirror updates
- `bad-debt.service.spec.ts` — +5 tests for provision JE
- `repossessions.service.spec.ts` — +3 tests for resale JE
- New: `inter-company-link.util.spec.ts` — +8 tests for helper
- New: `apps/web/e2e/accounting-inter-company-flow.spec.ts` — End-to-end inter-company verification

---

## 6. Wave order (single PR, multi-commit)

**Wave 1 — Foundation (3 commits)**
- (1a) Add `53-1804 Loss on Repossession Resale` to FINANCE seed (small)
- (1b) Create `inter-company-link.util.ts` helper + tests
- (1c) Refactor `createContractActivationJournal` split → 2 paired entries

**Wave 2 — Payment + Credit (3 commits)**
- (2a) Refactor `createPaymentJournal` — undo fold + add Due-to-SHOP + SHOP commission entry
- (2b) Add `createCreditAllocationJournal` + update `allocateCreditBalance` callers
- (2c) Add `createCustomerCreditOverpaymentJournal` + wire into `recordPayment` overpayment + PaySolutions

**Wave 3 — Standalone JEs (2 commits)**
- (3a) Add `createBadDebtProvisionJournal` + wire into `bad-debt.service.calculateProvisions`
- (3b) Add `createRepossessionResaleJournal` + wire into `repossessions.service.update` SOLD

**Wave 4 — Cleanup + Tests (2 commits)**
- (4a) Remove A.1a `commission-deferred` Sentry alarm
- (4b) Update all affected test specs + add new tests + 1 E2E

**Wave 5 — Verification + push + PR (3 commits/actions)**
- (5a) Full TS check + jest suite
- (5b) Final code-reviewer subagent on entire branch — fix any critical findings
- (5c) Pre-deploy backup + push + open PR

---

## 7. Testing Strategy

### Unit tests (~50 new + ~30 existing updates)

| Wave | New tests |
|---|---|
| 1 | 8 — paired-entry helper, atomic rollback both directions, balance math both sides, link via InterCompanyTransaction, contract activation balanced (SHOP + FINANCE), no leak between |
| 2 | 15 — payment split balance, Due-to-SHOP correctness, overpayment JE, credit allocation no double-cash, PaySolutions/early payoff/autoAllocate updates |
| 3 | 8 — provision delta logic (increase/decrease/recovery), repossession gain JE, repossession loss JE |
| 4 | 5 — Sentry alarm removed, contract→payment→bad debt full lifecycle balanced |

### E2E test (1 new)

`apps/web/e2e/accounting-inter-company-flow.spec.ts`:
- Activate test contract → assert 2 JEs created (SHOP + FINANCE) with matching `intercompanyId`
- Record payment → assert FINANCE JE has Due-to-SHOP line + SHOP JE with Commission Income
- Trigger bad debt provision recalc → assert Bad Debt Expense JE created
- **Invariant check:** `SUM(Due-from-FINANCE on SHOP) === SUM(Due-to-SHOP on FINANCE)` after each step

### Manual verification (post-deploy)

1. Activate 1 test contract → query `journal_entries WHERE reference_type='CONTRACT' AND reference_id=<id>` → expect 2 rows
2. Trigger 1 PaySolutions test webhook → query `journal_entries WHERE reference_type='PAYMENT' AND reference_id=<paymentId>` → expect 2 rows
3. Run query: `SELECT SUM(debit) - SUM(credit) FROM journal_lines WHERE account_code='11-2105'` (Due-from-FINANCE on SHOP) → should equal `SELECT SUM(credit) - SUM(debit) FROM journal_lines WHERE account_code='21-1102'` (Due-to-SHOP on FINANCE)

---

## 8. Success Criteria

- [ ] All unit tests pass (existing 2177+ + ~50 new)
- [ ] All E2E pass (existing + 1 new)
- [ ] TypeScript: 0 errors
- [ ] Sentry: no error spike 1 hr post-deploy
- [ ] Sentry: `commission-deferred` alarm count drops to 0 (no longer firing)
- [ ] Manual: Activation → 2 JEs (SHOP + FINANCE)
- [ ] Manual: Payment → 2 JEs (FINANCE + SHOP commission entry, IF monthlyCommission > 0)
- [ ] **Inter-company invariant:** Sum Due-from-FINANCE (SHOP) = Sum Due-to-SHOP (FINANCE)
- [ ] Bad debt write-off uses 53-1701 (still — no change in code)
- [ ] Bad debt provision creates new JE on calculateProvisions delta

---

## 9. Risk & Mitigation

| Risk | Severity | Mitigation |
|---|---|---|
| Atomic rollback failure (SHOP creates, FINANCE fails) | CRITICAL | `$transaction` wraps both; tests cover both directions |
| Due-from / Due-to drift | HIGH | Invariant check in E2E + post-deploy script. Sentry alarm if drift |
| Existing JEs from A.1a have wrong commission fold | MEDIUM | A.3 backfill will re-post. Document but don't fix in A.1b |
| PaySolutions webhook regression | HIGH | Sentry+log+continue pattern preserved per Phase A.0 |
| Bad debt provision delta math wrong | HIGH | Test increment + decrement + recovery cases. Decimal throughout |
| Customer credit allocation double-cash | HIGH | createCreditAllocationJournal uses Dr Customer Credit, not Cash. Test verifies |
| InterCompanyTransaction model overload | LOW | Reuse existing — no schema change |
| Loss on repossession needs new account | LOW | Added to seed in Wave 1a |

### Pre-deploy backup (mandatory)

```bash
gcloud sql backups create --instance=bestchoice-db --project=bestchoice-prod --description="pre-A1b-intercompany"
```

### Rollback plan

If post-deploy issues:
- Revert merge commit + redeploy → ~10 min
- New JEs created on prod will be valid (not orphan) but inter-company pairs may have only 1 side
- Cleanup script: VOID one-sided pairs + reverse

---

## 10. Out of Scope (deferred)

- ❌ Settlement cash transfer (FINANCE → SHOP) — A.1c or manual
- ❌ Backfill historical contracts/payments with new JE structure — A.3 (CPA sign-off)
- ❌ A.1a interest double-recognition fix (F-2-005) — A.2 (CPA pending)
- ❌ Year-end clearing balance reconciliation — A.2
- ❌ Automated periodic Due-from/Due-to balance check + Sentry alarm — A.1c
- ❌ UI for viewing inter-company flows — future enhancement

---

## 11. Estimated Effort

| Phase | Time |
|---|---|
| Wave 1 (helper + activation split + new account) | ~5 hr |
| Wave 2 (payment + credit + allocation) | ~8 hr |
| Wave 3 (provision + repossession standalone) | ~3 hr |
| Wave 4 (Sentry cleanup + tests + E2E) | ~6 hr |
| Wave 5 (verification + PR) | ~3 hr |
| Self-review + 2-stage subagent review + fix loops | ~3 hr |
| **Total A.1b** | **~28 hr** |

---

## 12. Follow-up Specs

After A.1b ships:

- **A.1c** (optional) — Settlement automation: cron job to detect Due-from/Due-to threshold, auto-post settlement JE pair (or manual UI). Periodic balance check + Sentry alarm.
- **A.2** — Policy-dependent: HP interest accrual (W-003 unearnedInterest), CR-001 VAT on interest, year-end closing
- **A.3** — Backfill: 36 orphan payments + historical activations (with new JE structure post-A.1b)
- **B** — Reports: P&L from JE, BS from JE, Cash Flow investing/financing, Notes, GL endpoint, PND.50/51

---

## 13. References

- A.1a spec: `docs/superpowers/specs/2026-04-29-accounting-phase-a1a-coa-split-design.md`
- A.1a PR: #723 (`feat(accounting): Phase A.1a — CoA split` — merged squash `f77230c1`)
- A.0 spec + PR #722
- Audit report: `docs/reports/2026-04-29-accounting-audit.md`
- Owner CoA: `docs/references/owner-chart-of-accounts.csv`
- FINANCE chart: `docs/references/finance-chart-of-accounts.csv`
- Accounting rules: `.claude/rules/accounting.md`
- Memory: `project_accounting_phase_a1a_pr723.md`
- Memory: `project_accounting_phase_a0_pr722.md`
- Memory: `project_accounting_audit_2026_04_29.md`
