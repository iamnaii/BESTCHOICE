# SHOP-side Journal-Entry Wiring — Design Spec

**Date:** 2026-06-23
**Status:** Design (approved decisions; pending spec review + implementation plan)
**Owner-decision source:** `docs/ceo-review/owner-decisions-pending-2026-06-22.md` (D1) · deep-audit F3 (`docs/ceo-review/deep-audit-2026-06-11-findings.md`) · `.claude/rules/accounting.md` (SHOP JE templates + 3-event flow + WIRING STATUS — DEFERRED)

---

## 1. Problem

7 of 8 SHOP-side JE templates are code-complete + golden-spec-covered but have **zero production callers** (only `ShopExchangeReturnTemplate` is wired, at `contract-exchange.service.ts:396`). Consequently `/shop/accounting` Trial Balance + P&L are near-empty even though SHOP is the actively-selling business; the page currently carries a disclaimer banner (`ShopAccountingPage.tsx`). This spec wires all 7 to their real triggers so SHOP books become real and (eventually) tax/audit-authoritative.

The 7 templates: `ShopCashSale`, `ShopDownPayment`, `ShopDownPaymentReversal`, `ShopInventoryTransfer`, `ShopFinanceReceipt`, `ShopTradeIn`, `ShopExpense`.

## 2. Goals / Non-goals

**Goals**
- Wire all 7 templates to real production triggers so SHOP TB/P&L reflect actual business.
- SHOP + FINANCE stay consistent at contract activation (atomic).
- One source of truth for SHOP account-code resolution (category → revenue/COGS/inventory; branch/method → cash/bank).

**Non-goals (explicitly out of scope)**
- Multi-entity legal split (P3-SP7 / D3) — still 1 DB partitioned by `companyCode`.
- SHOP VAT (SHOP not VAT-registered).
- Historical migration of past SHOP transactions — forward-only.
- Removing the `/shop/accounting` disclaimer banner — stays until owner declares SHOP reports authoritative (post-rollout decision).

## 3. Approved decisions

| # | Decision | Choice |
|---|----------|--------|
| D-1 | Contract activation posts SHOP + FINANCE | **Atomic** — both in one `$transaction`; SHOP-JE failure rolls back activation |
| D-2 | Scope | **All 7 templates** |
| D-3 | `ShopFinanceReceipt` trigger | **New action/endpoint** "record FINANCE→SHOP payment" (no existing event) |
| D-4 | Branch → cash-till mapping | **New field `Branch.shopCashAccountCode`** (+ migration, settings UI), fail-closed |
| D-5 | `TABLET` category accounts | **Reuse PHONE_NEW codes** (S41-1101 / S50-1101 / S11-2001); dedicated codes deferrable |
| D-6 | `ShopFinanceReceipt` persistence | **No new model** — the JE (queryable by `metadata.flow`) + audit log is the record |
| D-7 | Posting style | **Synchronous, inside each trigger's `$transaction`** (not event-driven) |
| D-8 | `salePrice` fed to `ShopInventoryTransfer` (resolves Blocker-1) | **Reconstructed = `downPayment + financedAmount`** (NOT raw `sellingPrice`) so the financing-identity assertion holds by construction and can never throw inside the activation `$tx` |

> **Changelog:** D-8 + §4A + §6 bundle handling + §6A pending-settlements + §9 hard-gate added 2026-06-23 after `/scrutinize` (Blocker-1 + Majors 2/3 + Minor 4).

## 4. Architecture

**Approach chosen:** central resolver + synchronous in-`$tx` posting helpers (vs. inline-everywhere, vs. event-driven which conflicts with D-1 atomic).

**New components**
- **`ShopAccountResolver`** (`apps/api/src/modules/journal/shop-account-resolver.service.ts`) — single source of truth for SHOP account-code resolution. Pure mapping + small DB reads (product cost, branch till). Mirrors the role of `CompanyResolverService`.
- **`FinanceToShopSettlement`** flow — `POST /shop/finance-settlements` endpoint + service method that posts `ShopFinanceReceipt` (D-3, D-6).
- **`Branch.shopCashAccountCode`** column (D-4) + settings UI to set it per branch.

**Reuse / pattern to copy:** `contract-exchange.service.ts:396` (the one wired example): inject template → resolve inputs → `template.execute(input, tx)` inside the host `$transaction` → store back-ref JE id on the source entity → audit log. Every SHOP template is stateless; all data flows via the input DTO; idempotency via `metadata.flow + metadata.idempotencyKey` (DB partial-unique index `journal_entries_idempotency_idx`). Always resolve SHOP companyId via `CompanyResolverService.getShopCompanyId(tx)` (never cache).

**Installment 3-event flow (atomic at activation):**
```
สร้างสัญญา (down>0)   ShopDownPayment        Dr cash / Cr S21-2001
        │
activate() :494       ShopInventoryTransfer  JE-A Dr S50-xx / Cr S11-200x  (COGS)
  (one $tx, atomic)                          JE-B Dr S11-3001 + S11-3002 + S21-2001 / Cr S41-revenue + S41-1201
        │             + ContractActivation1A (FINANCE) in the SAME $tx; shared metadata.batchRef = contractId
        ▼
FINANCE จ่าย SHOP      ShopFinanceReceipt     Dr bank (S11-1201) / Cr S11-3001 + S11-3002
  (new endpoint)
```

### 4A. Activation atomicity safety (Blocker-1 resolution)

Because D-1 makes a SHOP-JE failure roll back contract activation (a customer-facing critical op), the SHOP JE posted at activation **must not be able to throw**. Two facts make this safe:

1. **Financing identity holds by construction (D-8).** `ShopInventoryTransfer` asserts `downAmount + financedAmount === salePrice` with strict `Decimal` equality (`shop-inventory-transfer.template.ts:110`). `financedAmount` is stored as `roundBaht(sellingPrice - downPayment)` (`contract-lifecycle.service.ts:107`), so passing the raw `sellingPrice` would throw whenever `sellingPrice - downPayment` is not whole-baht. We therefore pass **`salePrice := downPayment + financedAmount`** — the identity is then true by definition and the assertion can never fire inside the activation `$tx`.
   - **Consequence:** SHOP financed-sale revenue (`Cr S41-revenue`) = `downPayment + financedAmount`. In the normal whole-baht case this equals `sellingPrice`. Any sub-baht difference from `roundBaht` (rare) is simply not booked as SHOP revenue; immaterial for a non-VAT SHOP. **Owner confirm:** acceptable (vs. adding a rounding line to book to exact `sellingPrice`).
2. **No cash-account dependency at activation.** `ShopInventoryTransfer` posts only COGS + receivables + revenue + down-clearance — **no cash/bank line** — so the fail-closed `Branch.shopCashAccountCode` rule (§5C) does **not** apply at activation. The cash-account dependency exists only at down-payment (creation), cash-sale, and trade-in triggers — none of which are inside the activation `$tx`.

Net: the only inputs to the activation SHOP JE are contract fields + product cost + resolved S-codes (category mapping, never null for a valid category). With D-8, activation cannot be blocked by SHOP-side rounding or missing cash config.

## 5. `ShopAccountResolver` spec

### 5A. Category → revenue / COGS / inventory

| `ProductCategory` | revenue | COGS | inventory |
|---|---|---|---|
| PHONE_NEW | S41-1101 | S50-1101 | S11-2001 |
| PHONE_USED | S41-1102 | S50-1102 | S11-2002 |
| ACCESSORY | S41-1103 | S50-1103 | S11-2003 |
| TABLET | S41-1101 | S50-1101 | S11-2001 (per D-5) |

### 5B. Cash / bank routing

CoA: per-branch cash tills `S11-1101` (กลาง) / `S11-1102` (ลาดพร้าว) / `S11-1103` (รามอินทรา); bank `S11-1201` (รับเงิน: ดาวน์/ขายสด) / `S11-1202` (จ่าย: ค่าใช้จ่ายสาขา).

Sale/Contract/TradeIn carry only `branchId` + `paymentMethod` (no per-txn account field), so the resolver derives:

| Money flow | Rule |
|---|---|
| Inflow, CASH (cash sale / down) | `Branch.shopCashAccountCode` of that branch (S11-110x) |
| Inflow, TRANSFER / QR | `S11-1201` (receiving bank) |
| Outflow, CASH (trade-in payout) | `Branch.shopCashAccountCode` (S11-110x) |
| Outflow, TRANSFER (trade-in payout) | `S11-1202` (paying bank) |
| Branch expense (ShopExpense CASH mode) | `S11-1202` (paying bank) |

`S11-1201` / `S11-1202` are constants in the resolver for now (single receiving/paying bank); can be lifted to config later if SHOP adds bank accounts.

### 5C. Fail-closed
If `Branch.shopCashAccountCode` is null when a CASH route is needed, the resolver **throws** a clear error (rolls back the host `$tx`) — it never silently picks a default. Mitigation: go-live checklist gains a step "every active branch has `shopCashAccountCode` set"; a startup/CI guard can assert this.

## 6. Per-trigger wiring

| Template | Trigger site | Resolver inputs | Idempotency key | Condition |
|---|---|---|---|---|
| ShopDownPayment | contract creation `$tx` (flow to be located under `contracts/`) | cash from (branch, method) | `shop-down-payment:<contractId>` | only if `downPayment > 0` |
| ShopInventoryTransfer | `ContractWorkflowService.activate()` (`contract-workflow.service.ts:494`), in the existing activation `$tx`, immediately after `ContractActivation1ATemplate` | category→codes; cost from product; assert `down + financed === salePrice` | `shop-inventory-transfer:<contractId>` | stamp `batchRef = contractId` to pair with FINANCE |
| ShopDownPaymentReversal | pre-activation cancel `$tx` (flow to be located) | refund account = original down cash account | `shop-down-payment-reversal:<contractId>` | only if a down JE was posted |
| ShopFinanceReceipt | **new** `POST /shop/finance-settlements` | bank `S11-1201` | `shop-finance-receipt:<contractId>` | per-contract; batchable in one call |
| ShopCashSale | `SaleWriterService.createCashSale()` (`sale-writer.service.ts:111`), existing `$tx` (replaces TODO at ~:147) | category→codes per product; cost from each product; cash from (branch, method) | `shop-cash-sale:<saleId>:<productId>` | **one JE per product** (see §6B) |
| ShopTradeIn | `TradeInLifecycleService.accept()` (`trade-in-lifecycle.service.ts:350`), existing `$tx` | inventory `S11-2002`; cash from (branch, method/transfer) | `shop-trade-in:<tradeInId>` | post on ACCEPTED |
| ShopExpense | hook when an expense-document with `companyId = SHOP` is POSTED (`expense-document-lifecycle.service.ts`) | expense code from the doc; mode CASH/ACCRUAL from doc; paying bank `S11-1202` for CASH | `shop-expense:<expenseDocId>` | companyId = SHOP only |

**To-locate during implementation** (not yet pinned in code): the contract-creation down-payment flow and the pre-activation cancel flow. Both will post inside their respective existing `$transaction`.

### 6A. `ShopFinanceReceipt` endpoint
- `POST /shop/finance-settlements` — body: `{ contractIds: string[], bankAccountCode?: string (default S11-1201), postedAt? }`.
- Roles: `OWNER`, `FINANCE_MANAGER`, `ACCOUNTANT` (same as other SHOP-accounting endpoints; BRANCH_MANAGER excluded per existing W5 policy).
- For each contract: resolve outstanding `financedAmount + storeCommission`, post `ShopFinanceReceipt` idempotently (`shop-finance-receipt:<contractId>`), audit `SHOP_FINANCE_SETTLED`.
- No new model (D-6); the posted JE + audit log are the record. "Which contracts are settled" is queryable via `metadata.flow = 'shop-finance-receipt'`.
- **Pending-settlements list (Minor-4):** the operator UI needs "which activated contracts has FINANCE not yet paid SHOP." Specify a read endpoint `GET /shop/finance-settlements/pending` = contracts that are ACTIVE/activated **minus** those that already have a posted `shop-finance-receipt:<contractId>` JE (left-anti-join on `journal_entries.metadata.flow`). This keeps D-6 (no new model) while giving the UI a concrete worklist. If the anti-join proves too slow at scale, revisit a `shopFinanceSettledAt` timestamp on `Contract` (cheaper than a full model).

### 6B. Cash-sale bundle handling (Major-3)
`Sale.bundleProductIds[]` (`schema.prisma:2452`) means one cash sale can span several products across mixed categories (e.g. PHONE_NEW + ACCESSORY → S41-1101 **and** S41-1103). `ShopCashSale` takes a single revenue/COGS/inventory triple, so the wiring **iterates the sale's products and posts one `ShopCashSale` JE per product** (key `shop-cash-sale:<saleId>:<productId>`), each resolving its own category codes + cost + the shared cash account. Per-line `revenueAmount` = that product's portion of `sellingPrice` (allocation rule for bundles — equal to each product's listed/line price; define the allocation source during implementation since `Sale` stores one `sellingPrice` for the bundle). **Open:** confirm whether bundle line prices are recoverable per product, else allocate proportionally by cost (flag for implementation).

## 7. Error handling
- Templates balance-check (Dr=Cr) **before** any DB write; on failure they throw → the host `$transaction` rolls back (atomic at every trigger, not just activation).
- **Period lock:** validate the SHOP company's accounting period is open before posting (consistent with FINANCE templates' `validatePeriodOpen`).
- **Missing config** (`Branch.shopCashAccountCode` null on a CASH route): fail-closed (§5C).
- **Activation risk:** since SHOP-JE failure now rolls back contract activation (D-1), the SHOP path must be robust — covered by golden specs + the go-live config guard. This is the accepted trade-off vs. SHOP/FINANCE divergence.

## 8. Testing
- `ShopAccountResolver` unit tests: category→codes (incl. TABLET), branch→till, inflow/outflow/transfer routing, fail-closed on null config.
- Per-trigger integration specs (jest, mock `PrismaService`, `--runInBand`): assert the correct template is invoked with correctly-resolved inputs inside the trigger's `$tx`; mirror the existing chatbot/expense mock-based style.
- The 7 templates' existing golden specs (`apps/api/src/modules/journal/shop-templates/*.spec.ts`) remain the JE-correctness acceptance net.
- `finance-settlements` endpoint spec: roles, idempotency (double-call = single JE), batch.

## 9. Prerequisite — X5 (PEAK isolation) — HARD GATE, must merge before P1

**Verified (scrutiny):** `peak.service.ts:75-88` selects journal entries with `where: { status:'POSTED', entryDate, deletedAt:null, peakSyncedAt:null }` — **no company filter at all**. The moment a SHOP (`S`-prefix) JE is POSTED it would be pulled into FINANCE's PEAK export (where `S`-codes have no PEAK mapping → silently skipped or mis-exported).

Therefore X5 is a **hard gate, not a nicety**: add `company: { companyCode: 'FINANCE' }` (or `companyId = getFinanceCompanyId()`) to that `findMany` where-clause (and to the `/expenses/journal/export-peak` query, same module) **and merge it before any SHOP JE goes live**. Add a regression test asserting a posted `S`-prefix JE is excluded from the PEAK export. No SHOP JE wiring (P1+) may ship until X5 is on `main`.

## 10. Implementation phasing (writing-plans will detail)
- **P0:** X5 PEAK filter + `ShopAccountResolver` + `Branch.shopCashAccountCode` (migration + settings UI) + go-live config guard.
- **P1 (installment lifecycle):** ShopDownPayment + ShopInventoryTransfer (atomic at activation) + ShopDownPaymentReversal + ShopFinanceReceipt endpoint.
- **P2:** ShopCashSale.
- **P3:** ShopTradeIn.
- **P4:** ShopExpense.

## 11. Acceptance criteria
- After P1, an end-to-end installment (create-with-down → activate → record finance settlement) produces a balanced SHOP TB where S11-3001/3002 net to zero once settled, and SHOP P&L shows the sale revenue + COGS.
- `prisma migrate deploy` on a fresh DB succeeds with the new `Branch.shopCashAccountCode` column.
- No SHOP (`S`-prefix) lines appear in the PEAK export (X5).
- All new + existing journal/shop specs green; `tsc` 0.
- `/shop/accounting` TB/P&L reflect real posted activity for the wired triggers.

## 12. Open items for spec review

_Resolved by `/scrutinize` (2026-06-23): Blocker-1 (atomic × strict assertion × `roundBaht`) → D-8 + §4A; Major-2 (PEAK no-company-filter) → §9 hard gate; Major-3 (cash-sale bundles) → §6B; Minor-4 (pending-settlements) → §6A._

Remaining owner/implementation confirms:
- **Revenue = `downPayment + financedAmount` for financed sales (D-8/§4A)** — confirm the sub-baht `roundBaht` delta vs raw `sellingPrice` is acceptable to leave unbooked (vs adding a rounding line).
- **Bundle price allocation (§6B)** — confirm per-product line prices are recoverable for a bundled `Sale`; else allocate proportionally by cost.
- TABLET reusing PHONE_NEW codes (D-5) — confirm vs. adding dedicated tablet S-codes.
- Fail-closed on missing `Branch.shopCashAccountCode` (§5C) — confirm acceptable that an unconfigured branch blocks cash-route posting (mitigated by go-live guard).
- `ShopFinanceReceipt` with no tracking model (D-6) — confirm JE+audit is sufficient (no per-settlement entity).
- **In-flight contracts at P1 rollout (down/transfer coupling):** a contract *created before* P1 (no `ShopDownPayment` JE) but *activated after* P1 would make `ShopInventoryTransfer` Dr S21-2001 to clear a down-payable that was never credited → negative liability. The implementation plan must pick a rollout strategy: (a) the activation wiring checks whether a `shop-down-payment:<contractId>` JE exists and, if absent for a down>0 contract, posts a catch-up down JE first (or omits the S21-2001 clearance line); or (b) a cutover date after which only post-P1 contracts get SHOP JEs. Recommend (a) so books stay complete. Same consideration for `ShopDownPaymentReversal` on pre-P1 contracts.
