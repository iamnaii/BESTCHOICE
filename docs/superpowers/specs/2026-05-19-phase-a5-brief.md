# Phase A.5 — Brief for Owner Review

**Date:** 2026-05-19
**Trigger:** Owner Response v2.0 (signed 2026-05-17), Bonus item B3
**Author:** Dev (Claude)
**Status:** ⚠️ Draft — sending to Owner for review **BEFORE implementation begins**, per B3 directive
**Standard:** TFRS for NPAEs (continuing the A.4 chart)

---

## TL;DR

Owner asked for Dev's view on what Phase A.5 should cover. Below is an
audit of the 4 items Owner listed, plus a 5th item that's been blocked
by the same CPA dependencies.

**Verdict:** Only **2 of the 4 listed items** still require CPA input.
The other 2 are already in production (Phase A.4 / P3-SP5) and the
"deferred" labels in CLAUDE.md are stale — see §4 to update.

| # | Item | Real status | A.5 action |
|---|------|-------------|------------|
| **B3.1** | **CR-001** VAT-on-interest | OPEN — CPA decision required | Brief CPA; spec depends on answer |
| **B3.2** | **N-005** Interest recognition (upfront vs accrual) | **PARTIAL** — accrual done in A.4 (per-period via 11-2106); EIR vs straight-line still open | Brief CPA on §60-65 simplification |
| **B3.3** | **W-003** Unearned interest field | ✅ **DONE in A.4** via 11-2106 Contra Asset | Update CLAUDE.md "deferred" list |
| **B3.4** | SHOP-side accounting / paired JEs | **PARTIAL** — P3-SP5 added SHOP chart + templates + `PairedJournalService`; only inventory transfer currently uses pairing | Scope decision: which lifecycle events need atomic pairing |

A 5th item, also explicitly listed in `accounting.md` "DEFERRED to Phase A.5":
| # | Item | Status | A.5 action |
|---|------|--------|------------|
| **A.5-X** | PPE depreciation (12-21XX, 53-16XX); WHT (21-31XX/32XX, 54-XXXX); tax-disallowed expense flag (54-XXXX) | Partly done — fixed-asset module + ม.65 ตรี flag landed (PR #937) | Verify scope; closing-out work |

---

## §1 — CR-001 VAT-on-interest (open)

### Current state
- **SHOP** is not VAT-registered; SHOP transactions never carry VAT.
- **FINANCE** is VAT-registered at 7%.
- Today: FINANCE issues a single VAT invoice at contract activation covering
  **(เงินต้น + ดอกเบี้ย + ค่าคอม)** × 7% — booked via
  `ContractActivation1ATemplate` (Cr 21-2102 ภาษีขายรอเรียกเก็บ).
- The 21-2102 balance unwinds into 21-2101 (ภ.พ.30 settled) via
  `PaymentReceipt2BTemplate` each month as the customer pays.

### What's unsettled
Legally, **interest component of installment revenue ≠ subject to VAT** in
ภ.พ. ม.79/4(7) — only the principal + service-fee portion is taxable.
Owner has been booking VAT on the whole basis (incl. interest) since
business inception. Continuing this is conservative (overpays VAT, which
สรรพากร will not complain about) but may not survive an audit, and
overpaid VAT is **not refundable retroactively** more than a few months.

### CPA questions
1. ภ.พ.30 ของเรา ที่ผ่านมาเคย report VAT บนดอกเบี้ยไหม? (= "did we historically file VAT including interest?")
2. ม.79/4(7) ใช้กับ "ดอกเบี้ยเช่าซื้อ" ตามนิยามนี้หรือไม่?
3. ถ้าจริง — ตั้งแต่ไหนเริ่มยกเว้น VAT บนดอกเบี้ย? (forward-only? back-correct?)
4. ถ้าใช่ accountant ต้อง split base ออกเป็น taxable principal + exempt interest บนใบกำกับภาษีไหม?

### Implementation paths (depending on CPA answer)

**Path A — Status quo (continue VAT on full base)**
- Zero code change.
- Add a CPA-signed policy memo into `docs/accounting/eir-decision-memo.md` siblings.
- Pros: Simple, no historical re-stating.
- Cons: Inflates ภ.พ.30 output VAT; not aligned with ม.79/4(7) spirit.

**Path B — Forward-only switch (most likely)**
- Schema: `Contract.vatableComponent = 'PRINCIPAL_PLUS_FEE' | 'FULL'`
  (default `'FULL'` for legacy contracts, `'PRINCIPAL_PLUS_FEE'` for new).
- Effective-date in `system_config` (e.g. `vat_on_interest_exempt_from = '2026-07-01'`).
- `ContractActivation1ATemplate` reads the flag; new contracts after the
  date book VAT only on (principal + commission).
- New CoA codes from A.1a spec:
  - `21-2104` ภาษีขายดอกเบี้ยรอตัดบัญชี (deferred output VAT exempt portion) — already drafted in `2026-04-29-accounting-phase-a1a-coa-split.md`
- ~3 new JE templates (contract activation variant; payment receipt variant).
- ~10 CPA case CSV variants needed (gold tests).
- **Estimated effort:** 1.5-2 weeks dev + 1 week CPA review.

**Path C — Back-correction (only if regulator demands)**
- Reverse historical 21-2102 over-bookings, refile ภ.พ.30, request refund.
- High risk, only if CPA + regulator request.
- **NOT recommending unless mandated.**

---

## §2 — N-005 Interest recognition (partial)

### Current state (Phase A.4)
- Accrual model is **already wired** via `InstallmentAccrual2ATemplate`
  (daily cron 00:01 BKK).
- Per-period interest recognized as `interestTotal / totalMonths`
  (= straight-line allocation, not effective-interest method).
- 11-2106 (รายได้รอตัดบัญชี-ดอกเบี้ย Contra Asset) holds the
  unrecognized portion until each accrual entry releases its share to
  41-1101 (รายได้ดอกเบี้ย).

### What's unsettled
TFRS 15 §60-65 prescribes the **Effective Interest Method (EIR)** for
contracts with a "significant financing component". For 12-month
contracts at 37.5% flat → 154% EIR, the financing component is
material — auditors may flag the use of straight-line.

TFRS for NPAEs §11 allows simplification when financing is
"insignificant". The threshold is judgment-based — no statutory cutoff.
See `docs/accounting/eir-decision-memo.md` for the full per-period
difference table.

### CPA questions
1. ผ่าน NPAEs §11 simplification ในเคสของเราหรือไม่?
2. ถ้าผ่าน — ออก Policy Memo ลายลักษณ์อักษร (สำหรับ audit trail) ได้หรือไม่?
3. ถ้าไม่ผ่าน — กำหนด timeline migration เป็น EIR

### Implementation paths

**Path A — Stay straight-line + CPA Policy Memo**
- Zero code change.
- File the memo into accounting evidence.
- Recommended if CPA agrees.

**Path B — Migrate to EIR**
- Rewrite `InstallmentAccrual2ATemplate` formula.
- Regenerate 7 CPA case CSV gold files.
- Update ~30 test cases.
- **Estimated effort:** 1 week dev + verification.

**Path C — Hybrid (straight-line in books, EIR in notes-to-FS)**
- Add EIR computation as report-only output.
- No JE change.
- **Estimated effort:** ~3 days.

---

## §3 — W-003 Unearned interest field — ALREADY DONE

### Reality check
Phase A.4 (Full Accrual TFRS 15 chart, 2026-05-04) introduced
`11-2106 รายได้รอตัดบัญชี-ดอกเบี้ย` as a **Contra Asset** holding
unrecognized interest. The same line item the W-003 deferred note
was talking about. See:

- `ContractActivation1ATemplate`: Cr 11-2106 for `interestTotal`
- `InstallmentAccrual2ATemplate`: Dr 11-2106 / Cr 41-1101 per period
- `EarlyPayoffJP4Template`: reverses remaining 11-2106
- Repossession / reschedule flows: also drain 11-2106 correctly
- `accounting.service.ts.getBalanceSheetFromJournal`: contra-asset rule
  shows 11-2106 as a negative under Asset (per TFRS presentation).

**No additional schema column** (`Contract.unearnedInterest` or
`Installment.unearnedInterest`) was needed — the GL itself is the
source of truth (correct per TFRS — don't denormalize).

### A.5 action
**No implementation work** — but two cleanup items:

1. Remove "W-003 Unearned interest field" from `CLAUDE.md` "Things
   deferred" list. It's misleading.
2. Update `docs/accounting/eir-decision-memo.md` to clarify that W-003
   itself is closed; only N-005 EIR-vs-straight-line is what's left.

---

## §4 — SHOP-side accounting / paired JEs (partial)

### What's done (P3-SP5)
- SHOP chart-of-accounts (~50 accounts under `S*` prefix) — seeded.
- SHOP JE templates: `ShopCashSale`, `ShopDownPayment`,
  `ShopDownPaymentReversal`, `ShopInventoryTransfer`, `ShopFinanceReceipt`,
  `ShopTradeIn`, `ShopExpense`.
- `PairedJournalService.postPaired()` exists — posts SHOP + FINANCE JEs
  atomically in one `$transaction` with shared `metadata.batchId`.
- SHOP-scoped Trial Balance + P&L (`/expenses/ledger/shop/*` endpoints +
  `ShopAccountingPage`).

### What's not paired yet
| Lifecycle event | FINANCE side | SHOP side | Paired? |
|---|---|---|---|
| Contract activation | `ContractActivation1A` | — (SHOP side is `ShopInventoryTransfer`, posted by a different call site) | ❌ Not atomic |
| Down payment received | — | `ShopDownPayment` | n/a |
| FINANCE wires to SHOP | — | `ShopFinanceReceipt` | n/a |
| Repossession | `RepossessionJP5` | — (no SHOP reversal template yet) | ❌ Missing pair |
| Trade-in accepted | — | `ShopTradeIn` | n/a |
| SHOP expense | — | `ShopExpense` | n/a |
| Inventory transfer to FINANCE pool | (covered by activation flow) | (covered by activation flow) | ✅ Inside PairedJournalService |

### A.5 questions for Owner
1. ต้องการให้ Contract Activation รวม SHOP + FINANCE ใน 1 $transaction (atomic) หรือไม่?
   - **ข้อดี:** ถ้า SHOP-side fail → FINANCE rolls back → ไม่มี orphan JE
   - **ข้อเสีย:** Activation request ช้าขึ้น ~10-20ms (extra JE writes), shared lock on more rows
2. Repossession SHOP-side reversal template — ต้องการ implement หรือไม่?
   - ปัจจุบัน: FINANCE post repo เท่านั้น (`RepossessionJP5Template`).
   - ที่ขาด: SHOP-side ยังถือ stock inventory ของเครื่องไปแล้ว (ตอน activation) → ตอนยึดเครื่องคืนเข้าสต็อก ต้อง book Dr S11-2002 used inventory / Cr S50-XXXX COGS reversal.

### Implementation effort
- Pair Contract Activation: ~3 days (refactor 1 service call site, add tests)
- SHOP repossession reversal template: ~4 days (new template + CoA verification + tests)
- **Total:** ~1.5 weeks.

### Risk
P3-SP7 (multi-entity legal split, 2027) will refactor `PairedJournalService`
into a cross-DB transaction (or eventual-consistency saga). If we pair
more events now, P3-SP7 has more to migrate. Recommendation: **only pair
events that have a real risk of partial-write today.** Right now
ContractActivation is the only one with that risk.

---

## §5 — Adjacent A.5 items already shipped or pending

These don't appear in Owner B3 but are in `accounting.md` "DEFERRED to
Phase A.5":

| Item | Status | Notes |
|---|---|---|
| **PPE + depreciation** (12-21XX, 53-16XX) | ✅ **Done** (Asset module, PR #828 et al) | Asset register + monthly depreciation cron live |
| **WHT** (21-31XX/32XX, 54-XXXX) | ✅ **Done** (Expense, Payroll, Other Income, Vendor Settlement) | Per-line WHT routing, ม.50 / ม.65 ตรี / V17 base = amountBeforeVat |
| **Tax-disallowed expense flag** (54-XXXX) | ✅ **Done** (PR #937) | `Expense.isTaxDisallowed` boolean. Owner Bonus B2 asks for inline UI hints per ม.65 ตรี category — see §6 |
| **41-2101/02 HP Revenue** | NOT NEEDED | Owner FINANCE income IS interest (41-1101); principal is repayment, not revenue |

So §5 ของ A.5 ที่ owner ฝากใน B3 จริง ๆ **ทำเสร็จไปแล้วเกือบหมด** — เหลือเฉพาะ §1 / §2 / §4.

---

## §6 — Owner Bonus B2 — Tax-disallowed UI hints (small, separate)

Owner asked for inline hints on the tax-disallowed flag — e.g.
"ของขวัญ > 2,000฿" / "ค่าปรับภาษี" / "ค่าใช้จ่ายส่วนตัว". This is a
small frontend addition on the Expense entry form:

- Tooltip / Popover anchored to the `isTaxDisallowed` checkbox.
- Shows the ม.65 ตรี category list (10-15 items) so user picks the
  reason BEFORE marking the flag.
- Persist optional `taxDisallowedCategory String?` per ExpenseLine for
  ภ.ง.ด.50/51 prep.

**Estimated effort:** ~1-2 days. Can ship as a sub-PR of Phase A.5 §3
docs cleanup, or as a standalone.

---

## §7 — Suggested Phase A.5 sequencing

If Owner approves this brief, the rollout would look like:

```
Week 0  ─ Send §1+§2 CPA questions; wait for answers
Week 1  ─ A.5-SP1 docs cleanup (§3 W-003 closure, CLAUDE.md update)
        ─ A.5-SP2 Owner B2 tax-disallowed UI hints (§6)
Week 2  ─ A.5-SP3 SHOP repossession reversal template (§4 part 1)
        ─ A.5-SP4 ContractActivation pairing (§4 part 2)
Week 3+ ─ A.5-SP5 N-005 implementation (§2) — path A/B/C per CPA
        ─ A.5-SP6 CR-001 implementation (§1) — path A/B/C per CPA
```

A.5-SP1/2/3/4 are **independent of CPA** — can ship in parallel.
A.5-SP5/6 are **CPA-blocked** — start only after answers in.

Total: ~6-8 weeks of dev + CPA cycle time. Most cost is in the §1
back-correction risk (Path C) — if CPA picks Path A/B for both items,
Phase A.5 fits in ~3-4 weeks.

---

## §8 — Open questions for Owner BEFORE we start

1. Should Dev brief CPA directly on §1 + §2, or does Owner want to be the channel?
2. SHOP pairing scope — pair just ContractActivation, or also Repossession + future SHOP-aware Settlement?
3. B2 UI hints — bundle into Phase A.5 or ship standalone now (1-2 day PR)?
4. CR-001 Path C (historical re-stating) — under what circumstance is Owner willing to consider this?

Reply on this brief → we lock the plan and open the first SP after Owner sign-off.
