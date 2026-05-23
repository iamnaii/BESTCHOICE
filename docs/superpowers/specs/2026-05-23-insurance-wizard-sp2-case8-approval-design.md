# Insurance Wizard SP2 — Unified Device Exchange (Upgrade Flow)

**Date:** 2026-05-23 (revised 2026-05-23 per owner clarification)
**Status:** Design — REVISED, awaiting plan
**Scope:** Device exchange = upgrade flow that works for **all 3 channels** (CASH / INSTALLMENT / GFIN-blocked). New sale is ALWAYS a fresh INSTALLMENT contract; old device returns to SHOP inventory as 2nd-hand.
**Depends on:** SP1 (IMEI UX) — shipped via PR #1076 + hotfixes
**Awaiting before plan:** CPA sign-off on JE templates for each channel (Case 8 for INSTALLMENT; new templates for CASH)

---

## ⚠️ Owner clarification (2026-05-23) — supersedes earlier draft

The original draft of this spec treated "เปลี่ยนเครื่อง" as a **defect-warranty replacement** with manual buyback valuation. Owner clarified during local testing that the real business meaning is broader:

> เปลี่ยนเครื่อง = customer gives back old device + gets NEW device of equal or higher price.
> - If new > old → customer pays the difference as ดาวน์ on a new installment contract.
> - Buyback value of old device = **what FINANCE already paid SHOP for it** (= `financedAmount + commissionAmount` for INSTALLMENT). No manual valuation. No ±% threshold.
> - New sale always becomes a fresh INSTALLMENT contract (even if old was CASH).
> - Old device → SHOP inventory (status `REFURBISHED` or similar) → re-sold as 2nd-hand later.

**Supersedes:**
- ❌ Trade-in valuation lookup endpoint (no manual buyback)
- ❌ `buybackPrice` / `buybackPriceFromTable` / `variancePercent` / `overrideReason` fields on `ContractExchangeRequest`
- ❌ `±20%` SystemConfig threshold (`EXCHANGE_BUYBACK_VARIANCE_THRESHOLD`)
- ❌ Required device-condition photos (still useful but not gating)

**Still applies:**
- ✅ Case 8 JE chain for INSTALLMENT (new contract + close old + clear 21-1106 vendor)
- ✅ Maker-checker approval queue
- ✅ Always create new contract (always INSTALLMENT, even if old was CASH)
- ✅ `21-1106` clearing account usage
- ✅ Concurrent approval guard (updateMany + count===1)

---

## Problem

After SP1 + hotfixes:
- SP1 wizard surfaces "เปลี่ยนเครื่อง" button for all non-GFIN cases (PR #1079)
- INSTALLMENT click → routes to existing `DefectExchangePage` (works for defect path only)
- CASH click → routes to `/trade-in` list page (dead-end — no destination wired)
- GFIN click → button disabled (correctly blocked)

This spec adds the **unified exchange destination** that handles all 3 channels and produces:
- New INSTALLMENT contract
- Old device repurposed into SHOP inventory
- Correct accounting JEs per channel
- Down payment = `(new sellingPrice) − (old buyback value)`

---

## Design Decisions (revised)

| Topic | Decision |
|---|---|
| Channel scope | CASH + INSTALLMENT (BC FINANCE) supported. GFIN blocked in UI (button disabled) |
| New sale type | **Always INSTALLMENT** — even if old was CASH. Owner: "ทำสัญญาผ่อนใหม่" |
| Approval flow | **Maker-checker** — SALES/BM submits → OWNER approves → atomic JE post + new contract |
| Buyback value (auto-derived, NO manual input) | INSTALLMENT: `oldContract.financedAmount + oldContract.commissionAmount` (= what FINANCE paid SHOP). CASH: `oldSale.sellingPrice` (= original cash price — owner-confirmed proxy for FINANCE-equivalent value) |
| Required customer payment | Down payment = `newSellingPrice − buybackValue`. Must be ≥ 0 (UI blocks if new < old) |
| Out-of-7-day window | Not applicable to upgrade flow — owner clarified this is a customer-initiated upgrade, not defect-driven. Any active contract / any CASH sale eligible |
| Old device disposition | Mark `Product.status = REFURBISHED` (or new enum value). Stays in same branch's inventory. Re-sold later as 2nd-hand. Optional condition note + photo (not gating) |
| Contract strategy | Always create new INSTALLMENT contract. Old contract (if any) → status `EXCHANGED`, both linked via FK |
| Old → new carry-over | `customerId` always; KYC docs / signed agreement template / deposit — only if old was a contract (no contract for CASH) |
| `Sale.saleType === null` | Treat as EXTERNAL_FINANCE — block exchange |
| Concurrent approval | `updateMany({ where: { id, status: 'PENDING' }, data: {...} })` inside `$transaction`, assert count === 1; otherwise `ConflictException` |

---

## Schema Changes

### New table: `ContractExchangeRequest`

```prisma
model ContractExchangeRequest {
  id                    String    @id @default(uuid())

  // Origin: either old contract (INSTALLMENT) OR old sale (CASH). Exactly one is set.
  oldContractId         String?   @map("old_contract_id")
  oldContract           Contract? @relation("ExchangeRequestsFromOldContract", fields: [oldContractId], references: [id])
  oldSaleId             String?   @map("old_sale_id")
  oldSale               Sale?     @relation("ExchangeRequestsFromOldSale", fields: [oldSaleId], references: [id])
  oldProductId          String    @map("old_product_id")  // for inventory return
  oldProduct            Product   @relation("ExchangeRequestsOldProduct", fields: [oldProductId], references: [id])

  // Buyback value — AUTO-derived from old sale/contract; stored for audit (no manual input)
  // - INSTALLMENT: financedAmount + commissionAmount of old contract
  // - CASH:        sellingPrice of old sale
  buybackValue          Decimal   @map("buyback_value") @db.Decimal(12, 2)
  buybackSource         String    @map("buyback_source")  // 'OLD_CONTRACT_FINANCED' | 'OLD_SALE_SELLING_PRICE'

  // New product + new INSTALLMENT plan
  newProductId          String    @map("new_product_id")
  newProduct            Product   @relation("ExchangeRequestNewProduct", fields: [newProductId], references: [id])
  newSellingPrice       Decimal   @map("new_selling_price") @db.Decimal(12, 2)
  newPlanCommission     Decimal   @map("new_plan_commission") @db.Decimal(12, 2)
  newPlanMonths         Int       @map("new_plan_months")
  newPlanInterestRate   Decimal   @map("new_plan_interest_rate") @db.Decimal(5, 2)

  // Computed: customer pays this as down payment (newSellingPrice - buybackValue). 0 if equal.
  customerDownPayment   Decimal   @map("customer_down_payment") @db.Decimal(12, 2)

  // Optional condition record (not gating)
  conditionNote         String?   @map("condition_note")
  conditionPhotos       String[]  @map("condition_photos")  // S3 URLs; optional

  // Status flow
  status                ExchangeRequestStatus @default(PENDING)
  rejectionReason       String?   @map("rejection_reason")

  // Cash account for receiving customer's down payment (defaulted from User.defaultCashAccountCode)
  cashAccountCode       String?   @map("cash_account_code")  // one of 11-1101..1103 or 11-1201..1203

  // People
  requestedById         String    @map("requested_by_id")
  requestedBy           User      @relation("ExchangeRequestsRequested", fields: [requestedById], references: [id])
  approvedById          String?   @map("approved_by_id")
  approvedBy            User?     @relation("ExchangeRequestsApproved", fields: [approvedById], references: [id])
  approvedAt            DateTime? @map("approved_at")

  // Linked after approval
  newContractId         String?   @unique @map("new_contract_id")
  newContract           Contract? @relation("ExchangeRequestsToNewContract", fields: [newContractId], references: [id])
  je1aId                String?   @map("je_1a_id")
  je2Id                 String?   @map("je_2_id")
  je3Id                 String?   @map("je_3_id")

  createdAt             DateTime  @default(now())
  updatedAt             DateTime  @updatedAt
  deletedAt             DateTime?

  @@index([status, createdAt])
  @@index([oldContractId])
  @@index([oldSaleId])
  @@index([oldProductId])
  @@map("contract_exchange_requests")
}

enum ExchangeRequestStatus {
  PENDING
  APPROVED
  REJECTED
}
```

### `Contract` model additions

```prisma
model Contract {
  // ... existing fields ...

  // Exchange tracking (self-relation pair)
  exchangedFromContractId String?   @unique @map("exchanged_from_contract_id")
  exchangedFromContract   Contract? @relation("ContractExchange", fields: [exchangedFromContractId], references: [id])
  replacedByContract      Contract? @relation("ContractExchange")
  exchangedAt             DateTime? @map("exchanged_at")

  // Reverse relations for ContractExchangeRequest
  exchangeRequestsAsOld   ContractExchangeRequest[] @relation("ExchangeRequestsFromOldContract")
  exchangeRequestsAsNew   ContractExchangeRequest[] @relation("ExchangeRequestsToNewContract")
}
```

`Contract.status` enum gains: `EXCHANGED` (sibling to `CANCELED`).

### Chart of Accounts — no new code

**Important**: `21-1106` ("บัญชีพักเครดิตเปลี่ยนเครื่อง") **already exists** in `finance-coa.csv` — verified at design time. SP2 introduces **usage** of this account via new JE templates, but no CoA changes. CPA must confirm the existing label fits the Case 8 clearing-account intent before plan kicks off.

### SystemConfig key

**REMOVED** — `EXCHANGE_BUYBACK_VARIANCE_THRESHOLD` no longer needed (buyback is auto-derived, no manual valuation, no threshold).

### Product status enum

Add new value to existing `ProductStatus` enum: **`REFURBISHED`** (or reuse if it exists).
Old device gets `status = REFURBISHED` after exchange approval. Stays in same branch's inventory; OWNER decides re-sell price later in normal sales flow.

> Note: if a suitable status already exists (`REPOSSESSED`, `RESELL_PENDING`, etc.) prefer reusing rather than adding new.

---

## JE Templates by channel

Templates live at `apps/api/src/modules/journal/cpa-templates/`. All execute inside one `$transaction` per approval; share `metadata.batchId`; balance asserts per template.

### CHANNEL A — INSTALLMENT (BC FINANCE) exchange = Case 8 JE chain

3 templates, atomically chained, identical to original draft:

#### A.1 — `ExchangeNewContract1ATemplate`

Identical structure to existing `ContractActivation1ATemplate` but invoked from exchange approval. Posts on the **new** contract.

```
Dr 11-2101 [new contract gross]
Dr 11-2105 [new contract VAT receivable]
   Cr 21-1101 [new vendor yodjat]
   Cr 21-1102 [new vendor commission]
   Cr 11-2106 [new unearned interest]
   Cr 21-2102 [new deferred VAT output]
```

Rounding per `accounting.md` (ROUND_DOWN principal, ROUND_HALF_UP VAT).

### Template 1 — `ExchangeNewContract1ATemplate`

Identical structure to existing `ContractActivation1ATemplate` but invoked from the exchange approval service. Posts on the **new** contract.

```
Dr 11-2101 [new contract gross]
Dr 11-2105 [new contract VAT receivable]
   Cr 21-1101 [new vendor head — yodjat]
   Cr 21-1102 [new vendor commission]
   Cr 11-2106 [new unearned interest]
   Cr 21-2102 [new deferred VAT output]
```

Rounding rules per `accounting.md` (ROUND_DOWN for principal, ROUND_HALF_UP for VAT).

#### A.2 — `ExchangeCloseOld21_1106Template`

Closes the old contract and stages the buyback credit into `21-1106`. Loss / gain plug computed from buyback vs **gross receivable remaining + VAT receivable remaining** (i.e. `11-2101 outstanding + 11-2105 outstanding`).

Plug-balance threshold: `threshold = (11-2101 + 11-2105) outstanding`

- If `buyback < threshold` → Dr `51-1102` (loss) for the difference
- If `buyback > threshold` → Cr `41-1102` (gain) for the difference
- If `buyback == threshold` → no P&L line

**Note**: this threshold does NOT match the JE3 cash-flow sub-cases (which compare buyback vs new vendor sum). All three JE3 sub-cases can independently produce a JE2 loss or gain. Implementer must treat JE2 P&L and JE3 cash flow as orthogonal.

```
Dr 21-1106 [buyback price]
Dr 11-2106 [old unearned interest remaining]
Dr 21-2102 [old deferred VAT remaining]
Dr 51-1102 [loss — if buyback < (11-2101 + 11-2105) remaining]
   Cr 11-2101 [old receivable Gross remaining]
   Cr 11-2105 [old VAT receivable remaining]
   Cr 21-2101 [old VAT recognized to ภ.พ.30]
   Cr 41-1101 [old interest revenue recognized]
   Cr 41-1102 [gain — if buyback > (11-2101 + 11-2105) remaining]
```

CSV verification (using Case 8 fixture values: old gross 11,333.28 + old VAT receivable 793.36 = threshold 12,126.64):

| Sub-case | buyback | vs threshold | P&L line | Amount |
|---|---:|---|---|---:|
| A | 8,000 | < 12,126.64 | Dr 51-1102 | 4,126.64 |
| B | 11,000 | < 12,126.64 | Dr 51-1102 | 1,126.64 |
| C | 13,000 | > 12,126.64 | Cr 41-1102 | 873.36 |

#### A.3 — `ExchangeClearVendor21_1106Template`

Clears `21-1106` against new contract's vendor payables. Three sub-cases based on `buyback vs (new vendor yodjat + new vendor commission)`:

**Sub-case A: buyback < new vendor sum** — customer adds cash diff
```
Dr 21-1101 [new vendor yodjat]
Dr 21-1102 [new vendor commission]
   Cr 21-1106 [buyback price]
   Cr [cashAccountCode] [cash diff received from customer]
```

**Sub-case B: buyback == new vendor sum** — no cash flow, perfect offset
```
Dr 21-1101 [new vendor yodjat]
Dr 21-1102 [new vendor commission]
   Cr 21-1106 [buyback price = new vendor sum]
```

**Sub-case C: buyback > new vendor sum** — refund cash to customer
```
Dr 21-1101 [new vendor yodjat]
Dr 21-1102 [new vendor commission]
Dr [cashAccountCode] [cash diff paid to customer]
   Cr 21-1106 [buyback price]
```

`cashAccountCode` follows the same pattern as `Payment.depositAccountCode` — defaulted from the approver's `User.defaultCashAccountCode` and pickable at approval time. Must be one of the 6 valid codes (11-1101..1103 or 11-1201..1203). Sub-case is auto-determined by the service.

---

### CHANNEL B — CASH exchange (no old contract)

For CASH sale exchange, **no old contract to close** → drop JE A.2. Buyback value = `oldSale.sellingPrice` (full original cash price). The old device returns to SHOP inventory; customer signs a new INSTALLMENT contract.

Two templates instead of three:

#### B.1 — `ExchangeNewContract1ATemplate` (same as A.1)

Same template, same logic. New INSTALLMENT contract activation.

#### B.2 — `ExchangeClearVendor21_1106TemplateCash`

Differs from A.3 in the source of the credit balancing `21-1101` + `21-1102`. For CASH there's no `21-1106` buyback liability from the closed contract — instead, the buyback equivalent is the inventory value SHOP gains by receiving the device back.

```
Dr 21-1101 [new vendor yodjat]
Dr 21-1102 [new vendor commission]
   Cr 11-3101 [old device → SHOP inventory at buyback value = oldSale.sellingPrice]
   ± [cashAccountCode] (depending on direction of customer down payment vs sum)
```

(11-3101 is the existing "สินค้าคงเหลือ-เครื่องยึดคืน" inventory account per `accounting.md`. CPA must confirm this is the correct account for re-entered exchange devices, or assign a new one.)

Sub-cases for cash flow same pattern as A.3:
- buyback < new vendor sum → customer pays diff (Cr cash from customer)
- buyback == new vendor sum → no cash flow
- buyback > new vendor sum → refund cash to customer

> **Open question for CPA:** Should CASH exchange also realize gain/loss vs original sale's COGS? Defer until CPA review. For initial design, treat the buyback at full `oldSale.sellingPrice` (no gain/loss line) and let SP2.1 add the depreciation/markdown logic if needed.

---

### CHANNEL C — GFIN (EXTERNAL_FINANCE) exchange

**BLOCKED in UI.** No JE templates needed. Customer must close GFIN contract externally first; then they appear in BC system as a walk-in or new INSTALLMENT customer.

---

### Atomicity guarantees

All three templates execute inside one Prisma `$transaction`:
- Each template internally validates Dr=Cr balance (throws if unbalanced)
- `Contract.status` of old → `EXCHANGED` updated
- New `Contract` row created with full installment schedule
- `21-1106` ending balance after JE3 must equal `0` for the batch — assertion guard

Failure at any step rolls back; no partial state.

---

## API Endpoints

### ~~(NEW) `GET /trade-in/buyback-suggest`~~ — DROPPED

No manual valuation in the revised design — buyback is auto-derived server-side from `oldContract.financedAmount + commissionAmount` (INSTALLMENT) or `oldSale.sellingPrice` (CASH). The IMEI lookup endpoint already exposes everything the form needs.

### (NEW) `POST /insurance/exchange-requests`
```
Body: {
  oldProductId,           // required — anchors old device for inventory return
  oldContractId?,         // present iff INSTALLMENT
  oldSaleId?,             // present iff CASH (alternative anchor; mutually exclusive with oldContractId)
  newProductId,
  newSellingPrice,        // owner-set; UI validates ≥ buyback
  newPlanCommission,
  newPlanMonths,
  newPlanInterestRate,
  conditionNote?,         // optional
  conditionPhotos?: [],   // optional, S3 URLs, ≤5 photos, ≤8MB each, jpg/png/webp
}
Response: ContractExchangeRequest (status=PENDING)
```

Server-side computation:
- Lookup old contract/sale → derive `buybackValue` + `buybackSource`
- `customerDownPayment = newSellingPrice − buybackValue`. Reject if < 0.
- Validate channel: if EXTERNAL_FINANCE → 403 ("ผ่อน GFIN ใช้ exchange ไม่ได้")

Roles: SALES, BM, OWNER.

### (NEW) `GET /insurance/exchange-requests/pending`
```
Response: ContractExchangeRequest[] (status=PENDING)
```
Roles: OWNER only.

### (NEW) `POST /insurance/exchange-requests/:id/approve`
```
Body: { cashAccountCode: string }  // required, used in B.2 cash diff line
```
Process (inside `$transaction`):
1. Lock-acquire via `updateMany({ where: { id, status: 'PENDING' }, data: {...} })` — assert count === 1
2. Re-fetch full request with old contract/sale + new product
3. Branch on channel:
   - **INSTALLMENT** → run A.1 (new contract activation) → A.2 (close old contract) → A.3 (clear 21-1106 + cash diff)
   - **CASH** → run B.1 (new contract activation) → B.2 (clear 21-1101/02 against 11-3101 inventory + cash diff)
4. Update old device: `Product.status = REFURBISHED` (still in branch inventory, ready for resale)
5. If INSTALLMENT: update old Contract → `status='EXCHANGED'`, `exchangedAt=now`, link `replacedByContractId`
6. Update request: `newContractId`, JE IDs, status=APPROVED
7. Copy carry-over fields from old contract (INSTALLMENT) → new contract: `customerId`, `kycDocuments[]`, `signedAgreementUrl`. For CASH: only `customerId`.
8. AuditLog `EXCHANGE_REQUEST_APPROVED` with full diff (channel, buyback source/value, customer down)

Roles: OWNER only.

### (NEW) `POST /insurance/exchange-requests/:id/reject`
```
Body: { reason: string }  // min 10 chars
```
Lock-acquire pattern as above. Writes AuditLog `EXCHANGE_REQUEST_REJECTED`.

Roles: OWNER only.

---

## UI Changes

### Modified pages
- `CreateInsuranceWizardPage.tsx` (from SP1 + hotfix #1079) — when "เปลี่ยนเครื่อง" clicked, route to new `/insurance/exchange-request/new?productId=…` page. Channel-specific destinations from #1079 (CASH → /trade-in, INSTALLMENT → /defect-exchange) all replaced by this unified form.
- `InsurancePage.tsx` — add tab "เปลี่ยนเครื่องรอ approval" with count badge (OWNER only)

### New pages
- `/insurance/exchange-request/new?productId=…` — `ExchangeRequestForm`:
  - Auto-display: old device info + **auto-derived buyback value** (no input field for it) — labeled either "ราคาที่ FINANCE จ่ายให้ SHOP" (INSTALLMENT) or "ราคาเดิมที่ขายเงินสด" (CASH)
  - Required input:
    - ① New product picker (filtered to `sellingPrice ≥ buybackValue` — owner rule)
    - ② New `sellingPrice` (auto-populated from product but editable)
    - ③ New `commission`, `months`, `interestRate` (use existing plan calc utility)
  - Live preview:
    - "ลูกค้าจ่ายดาวน์" = `newSellingPrice − buybackValue` (≥ 0)
    - Monthly payment + total interest from plan calc
  - Optional: condition note + photos (not gating)
  - Submit → POST `/insurance/exchange-requests` → toast + redirect to /insurance
- `/insurance/exchange-requests` — OWNER queue (list + detail + approve/reject). Mirrors `/finance/contract-cancellation` structure.
  - Approve dialog: select `cashAccountCode`

### Menu changes (`config/menu.ts`)
- OWNER: under "หลังการขาย" zone add "คำขอเปลี่ยนเครื่อง" with `badgeKey: 'exchange-requests-pending'`

### Old `/defect-exchange` route

Keep working (#1078 restored it as standalone DefectExchangePage). After SP2 ships, eventually deprecate. Defect-driven repair-warranty workflow still has value as a focused path even after upgrade-flow exchange goes live.

---

## Testing Strategy

### Unit tests (apps/api)
- JE templates A.1 / A.2 / A.3 — validate Dr=Cr balance for sub-cases A/B/C against CSV golden values (`case-8-A.csv`, `case-8-B.csv`, `case-8-C.csv`)
- JE template B.1 (= A.1 reuse) + B.2 (new) — validate against `case-8-cash-{A,B,C}.csv` golden values (NEW fixture, to be authored)
- A.2 plug-balance: buyback vs (Gross + VAT receivable) thresholds
- `ExchangeRequestService.submit`: buyback auto-derivation per channel + customerDownPayment ≥ 0 guard
- `ExchangeRequestService.approve`: full atomic flow per channel + rollback test
- Concurrent approval: spawn 2 approves, exactly 1 succeeds, other → 409
- Old device status flip to REFURBISHED + correct branch retention

### Integration tests
- INSTALLMENT submission → approve → new Contract + 3 JEs + old.status=EXCHANGED + product.status=REFURBISHED
- CASH submission → approve → new Contract + 2 JEs (B.1 + B.2) + product.status=REFURBISHED
- Reject path (both channels)
- Block path: GFIN attempt → 403

### E2E (Playwright)
- SALES submits CASH exchange → OWNER approves → new INSTALLMENT contract appears + old product status changed
- SALES submits INSTALLMENT exchange → OWNER approves → as above + old contract status EXCHANGED

---

## Acceptance Criteria

- [ ] SALES/BM submits request in ≤ 30 sec (excluding optional photo upload)
- [ ] OWNER approves clean request in ≤ 15 sec (select cashAccountCode → confirm)
- [ ] SALES user cannot approve their own request
- [ ] CASH exchange creates new INSTALLMENT contract (not new CASH sale)
- [ ] All JEs balance (Dr = Cr) per template and across batch
- [ ] Old INSTALLMENT contract → EXCHANGED exactly when JEs post (atomic)
- [ ] Old Product → REFURBISHED status retained in same branch
- [ ] Failed JE leaves request PENDING + no Contract / Product status change
- [ ] Trial Balance: `21-1106` = 0 net after INSTALLMENT batch
- [ ] Audit log: `EXCHANGE_REQUEST_SUBMITTED` + `EXCHANGE_REQUEST_APPROVED|REJECTED` with full diff (channel, buyback source/value, customer down payment, JE batch ID)
- [ ] Concurrent approve: 2 OWNERs simultaneous → exactly 1 succeeds, other gets 409

---

## Migration plan

1. **Pre-plan checks** (block plan kickoff until done):
   - CPA confirms `21-1106` label fits Case 8 clearing-account intent
   - CPA reviews JE template designs (A.1/A.2/A.3 + B.1/B.2) against golden CSVs
   - CPA decides: CASH exchange B.2 buyback-account question (11-3101 vs new account?)
   - CPA decides: should CASH exchange realize gain/loss vs original sale's cost? (currently spec defers)
2. Schema migration: add `ContractExchangeRequest` + `Contract.exchangedFromContractId` + `EXCHANGED` enum value + Product.status `REFURBISHED` (if absent)
3. Backend: 5 templates total (A.1 = B.1 reuse, A.2, A.3, B.2) + service + controller + 4 endpoints
4. Frontend: new `ExchangeRequestForm` + `/insurance/exchange-requests` queue + menu entry + remove hotfix #1079's split routing (CASH/INSTALLMENT now both → /insurance/exchange-request/new)
5. CSV golden fixtures: case-8-{A,B,C}.csv (INSTALLMENT) + case-8-cash-{A,B,C}.csv (CASH)
6. Tests + E2E + deploy + smoke test one exchange per channel in dev

No data backfill — feature is forward-only.

---

## Out of scope / deferred

- **GFIN integration** for exchange — needs GFIN API contract; current scope only **blocks** the UI (consistent with SP1)
- **Multi-device exchange** in one request — single-device only
- **Partial exchange / split contract** — not requested
- **Reverse exchange** (undo an APPROVED exchange) — needs separate "exchange reversal" template; deferred
- **Old `/defect-exchange` deprecation** — keep working, plan later removal after SP2 settles
- **Auto-detect buyback table refresh** — manual via admin tool, not auto-sync
