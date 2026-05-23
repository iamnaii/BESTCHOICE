# Insurance Wizard SP2 — Device Swap (Same-Price Exchange)

**Date:** 2026-05-23 (revised TWICE per owner clarification)
**Status:** Design — REVISED v3, awaiting plan
**Scope:** Same-price device swap for INSTALLMENT (BC FINANCE) — customer carries remaining installments to new device. No upgrade. No cash flow. CASH + GFIN exchange explicitly out of scope.
**Depends on:** SP1 (IMEI UX) — shipped via PR #1076 + hotfixes
**Awaiting before plan:** CPA sign-off on simplified Case 8 JE chain (perfect-offset only — no cash-diff sub-cases needed)

---

## ⚠️ Owner clarification v3 (2026-05-23) — supersedes ALL earlier drafts

After 2 rounds of clarification during local testing, owner's final business rule:

> เปลี่ยนเครื่อง = customer brings back old device + gets **identical-price** replacement device.
> - **Same brand + model + storage + sellingPrice ONLY** — no upgrade
> - **Customer pays ฿0 today** — no cash flow, no down-payment diff
> - **Carry remaining installments** — new contract opens with REMAINING schedule from old (e.g. paid 3 of 12 → new contract has 9 months left to pay)
> - Monthly payment stays identical
> - Old device → SHOP inventory as 2nd-hand → re-sold later
> - Only INSTALLMENT (BC FINANCE) supported. CASH = no exchange (just trade-in + new sale separately). GFIN blocked.

**Supersedes (v1 + v2 dropped):**
- ❌ Trade-in valuation table / manual buyback price input
- ❌ ±20% variance threshold + override reason
- ❌ Device condition photos as gating requirement
- ❌ New `sellingPrice` input (locked to old)
- ❌ `newPlanMonths` / `newPlanInterestRate` input (locked to remaining old)
- ❌ `customerDownPayment` field (always 0)
- ❌ JE3 sub-case A (customer pays cash diff) — no longer reachable
- ❌ JE3 sub-case C (refund cash to customer) — no longer reachable
- ❌ `cashAccountCode` for JE3 (no cash leg)
- ❌ CASH exchange flow (CHANNEL B in v2) — explicitly out of scope
- ❌ Multi-channel scope expansion

**Still applies:**
- ✅ Case 8 JE chain for INSTALLMENT — but JE3 reduces to perfect-offset always
- ✅ Maker-checker approval queue (SALES/BM submits, OWNER approves)
- ✅ New contract creation linked to old via FK (`exchangedFromContractId`)
- ✅ Old contract → status `EXCHANGED`
- ✅ Old Product → status `REFURBISHED` in same branch inventory
- ✅ `21-1106` clearing account usage
- ✅ Atomic `$transaction` with `updateMany` lock-acquire pattern
- ✅ Optional condition note + photos (not gating, just record)

**Net effect:** SP2 is now 30-40% smaller than v2. JE3 has 1 sub-case instead of 3. ContractExchangeRequest schema drops 6 fields. UI has no inputs to validate beyond replacement product selection.

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

## Design Decisions (v3)

| Topic | Decision |
|---|---|
| Channel scope | **INSTALLMENT (BC FINANCE) only.** CASH = out of scope (handle via trade-in + new sale separately). GFIN = UI blocked |
| Replacement device filter | Same `brand` + `model` + `storage` + **`sellingPrice`** as old. Server-enforced. |
| Customer cash today | **Always ฿0.** No down payment, no diff, no cash flow |
| New contract plan | **Carry remaining schedule.** New contract opens with: `totalMonths = old.totalMonths − paidInstallments`, `monthlyPayment` = same, `financedAmount` = `monthlyPayment × remainingMonths` |
| Old device disposition | `Product.status = REFURBISHED` (or reuse existing enum value). Stays in same branch's inventory. Optional condition note + photos. |
| Contract strategy | Create new INSTALLMENT contract. Old → status `EXCHANGED`. Both linked via FK `exchangedFromContractId`. |
| Old → new carry-over | `customerId` + KYC documents + signed agreement template. Payment history STAYS attached to old contract. |
| Approval flow | **Maker-checker** — SALES/BM submits → OWNER approves → atomic JE post + new contract created |
| 7-day window | **Not applicable** — exchange is customer-initiated swap, not defect repair. Any ACTIVE contract eligible |
| Concurrent approval | `updateMany({ where: { id, status: 'PENDING' }, data: {...} })` inside `$transaction`, assert count === 1; otherwise `ConflictException` |
| Buyback value (internal accounting) | Auto-derived = `oldContract.financedAmount + oldContract.commissionAmount` (= what FINANCE paid SHOP). Hidden from UI. Used only in JE templates. |

---

## Schema Changes

### New table: `ContractExchangeRequest`

```prisma
model ContractExchangeRequest {
  id                    String    @id @default(uuid())

  // Old contract being exchanged (INSTALLMENT only — CASH is out of scope)
  oldContractId         String    @map("old_contract_id")
  oldContract           Contract  @relation("ExchangeRequestsFromOldContract", fields: [oldContractId], references: [id])
  oldProductId          String    @map("old_product_id")  // for inventory return
  oldProduct            Product   @relation("ExchangeRequestsOldProduct", fields: [oldProductId], references: [id])

  // New device (server-enforced same brand+model+storage+sellingPrice)
  newProductId          String    @map("new_product_id")
  newProduct            Product   @relation("ExchangeRequestNewProduct", fields: [newProductId], references: [id])

  // Optional condition record (not gating)
  conditionNote         String?   @map("condition_note")
  conditionPhotos       String[]  @map("condition_photos")  // S3 URLs

  // Status flow
  status                ExchangeRequestStatus @default(PENDING)
  rejectionReason       String?   @map("rejection_reason")

  // People
  requestedById         String    @map("requested_by_id")
  requestedBy           User      @relation("ExchangeRequestsRequested", fields: [requestedById], references: [id])
  approvedById          String?   @map("approved_by_id")
  approvedBy            User?     @relation("ExchangeRequestsApproved", fields: [approvedById], references: [id])
  approvedAt            DateTime? @map("approved_at")

  // Linked after approval (3 JEs — 1A activation, 2 close-old, 3 clear vendor)
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

Templates live at `apps/api/src/modules/journal/cpa-templates/`. All 3 execute inside one `$transaction`; share `metadata.batchId`; balance asserts per template.

Because the exchange is **same-price + carry remaining schedule**:
- New contract's `financedAmount + commission` (= new vendor sum) **equals** old contract's `financedAmount + commission` (= buyback)
- JE3 always reduces to **perfect-offset** sub-case — no cash legs ever
- JE2 plug-balance line (loss `51-1102` or gain `41-1102`) still exists because old contract's remaining receivable (Gross + VAT) ≠ buyback in general

### Template A.1 — `ExchangeNewContract1ATemplate`

Same shape as existing `ContractActivation1ATemplate`, called from exchange approval. Posts on the new contract using the **remaining-installment** plan (totalMonths = old.totalMonths − paidInstallments; monthlyPayment = same as old).

```
Dr 11-2101 [new contract gross — based on REMAINING months]
Dr 11-2105 [new contract VAT receivable — pro-rated to remaining]
   Cr 21-1101 [new vendor yodjat — same as old yodjat]
   Cr 21-1102 [new vendor commission — same as old]
   Cr 11-2106 [new unearned interest — for remaining months]
   Cr 21-2102 [new deferred VAT output — pro-rated]
```

Rounding per `accounting.md`.

### Template A.2 — `ExchangeCloseOld21_1106Template`

Closes the old contract, stages buyback into `21-1106`. Loss/gain plug from buyback vs (Gross + VAT receivable outstanding).

```
Dr 21-1106 [buyback = old.financedAmount + old.commissionAmount]
Dr 11-2106 [old unearned interest remaining]
Dr 21-2102 [old deferred VAT remaining]
Dr 51-1102 [loss — if buyback < (11-2101 + 11-2105) outstanding]
   Cr 11-2101 [old receivable Gross outstanding]
   Cr 11-2105 [old VAT receivable outstanding]
   Cr 21-2101 [old VAT to ภ.พ.30]
   Cr 41-1101 [old unearned interest recognized]
   Cr 41-1102 [gain — if buyback > (11-2101 + 11-2105) outstanding]
```

Loss/gain handles the difference between "what SHOP receives back from FINANCE perspective" vs "what was still owed". Even with same-price swap this can be non-zero because customer has paid down some principal.

### Template A.3 — `ExchangeClearVendor21_1106Template` (perfect offset only)

Same-price constraint → new vendor sum = buyback → only one form:

```
Dr 21-1101 [new vendor yodjat = same as old]
Dr 21-1102 [new vendor commission = same as old]
   Cr 21-1106 [buyback = new vendor sum]
```

No cash leg. No sub-cases. No `cashAccountCode` needed.

Asserts in service: `newVendorYodjat + newVendorCommission === buyback`. If false → throw (defensive — should never trigger given same-price filter, but catches bugs in plan-calc).

---

### Out-of-scope channels

- **CASH** — handle via existing trade-in module + new POS sale (2 transactions). NOT supported by this exchange flow.
- **GFIN (EXTERNAL_FINANCE)** — UI blocked. Customer must close GFIN contract externally first.

### Atomicity guarantees

All 3 templates execute inside one Prisma `$transaction`:
- Each template internally validates Dr=Cr balance (throws if unbalanced)
- `Contract.status` of old → `EXCHANGED` updated
- New `Contract` row created with REMAINING-installment plan
- `Product.status` of old → `REFURBISHED`
- `21-1106` ending balance after A.3 must equal `0` for the batch — assertion guard

Failure at any step rolls back; no partial state.

---

## API Endpoints

### (NEW) `POST /insurance/exchange-requests`
```
Body: {
  oldContractId,        // required — INSTALLMENT only
  oldProductId,         // for inventory return
  newProductId,         // server validates: same brand+model+storage+sellingPrice as old
  conditionNote?,       // optional
  conditionPhotos?: [], // optional, S3 URLs, ≤5 photos
}
Response: ContractExchangeRequest (status=PENDING)
```

Server validation:
- Old contract: must exist + status=ACTIVE + linked to INSTALLMENT sale
- New product: must IN_STOCK + same brand + same model + same storage + **same sellingPrice** as old's product
- 400 if new product sellingPrice ≠ old product sellingPrice (carry-over math requires this)

Roles: SALES, BM, OWNER.

### (NEW) `GET /insurance/exchange-requests/pending`
```
Response: ContractExchangeRequest[] (status=PENDING)
```
Roles: OWNER only.

### (NEW) `POST /insurance/exchange-requests/:id/approve`
```
Body: {} // no body — all values auto-derived
```
Process (inside `$transaction`):
1. Lock-acquire via `updateMany({ where: { id, status: 'PENDING' }, data: {...} })` — assert count === 1
2. Re-fetch full request with old contract + old product + new product
3. Compute new plan: `remainingMonths = old.totalMonths − paidInstallments(old.id)`; `newFinancedAmount = old.monthlyPayment × remainingMonths`; `newMonthlyPayment = old.monthlyPayment` (same)
4. Run A.1 (new contract activation with remaining-installment plan)
5. Run A.2 (close old contract → 21-1106 + P&L plug)
6. Run A.3 (clear 21-1106 vs new vendor — perfect offset assertion)
7. Update old Product: `status = REFURBISHED`
8. Update old Contract: `status = EXCHANGED`, `exchangedAt = now`, link `replacedByContractId`
9. Update request: `newContractId`, JE IDs, status=APPROVED
10. Copy carry-over: `customerId`, `kycDocuments[]`, `signedAgreementUrl` → new contract
11. AuditLog `EXCHANGE_REQUEST_APPROVED` with full diff

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
- `/insurance/exchange-request/new?contractId=…` — `ExchangeRequestForm`:
  - Auto-display: old device info + old contract plan (read-only)
  - Required input:
    - **New product picker** — filtered server-side to: same brand + model + storage + sellingPrice + IN_STOCK
  - Preview (read-only):
    - "ลูกค้าจ่ายเพิ่ม: ฿0" (always 0 due to same-price constraint)
    - "งวดที่เหลือ: N จาก M" (auto from old contract paid count)
    - "งวดละ: ฿X" (same as old)
  - Optional: condition note + photos
  - Submit button enabled when new product selected → POST `/insurance/exchange-requests` → toast + redirect
- `/insurance/exchange-requests` — OWNER queue (list + detail + approve/reject). Mirrors `/finance/contract-cancellation` structure.
  - Approve dialog: confirm only — no inputs needed (no cashAccountCode, no manual valuation)

### Menu changes (`config/menu.ts`)
- OWNER: under "หลังการขาย" zone add "คำขอเปลี่ยนเครื่อง" with `badgeKey: 'exchange-requests-pending'`

### Old `/defect-exchange` route

Keep working (#1078 restored it as standalone DefectExchangePage). After SP2 ships, eventually deprecate. Defect-driven repair-warranty workflow still has value as a focused path even after upgrade-flow exchange goes live.

---

## Testing Strategy

### Unit tests (apps/api)
- JE template A.1 — validate against existing ContractActivation golden values (reuse, parameterized for remaining-months)
- JE template A.2 plug-balance — buyback vs (Gross + VAT receivable outstanding) → loss / gain / zero
- JE template A.3 perfect-offset — asserts vendor sum equals buyback (defensive); throws otherwise
- `ExchangeRequestService.submit` — same-price validation rejects mismatched sellingPrice with 400
- `ExchangeRequestService.approve` — full atomic flow + rollback test (force A.2 to throw, verify nothing partial)
- Remaining-installment math — `remainingMonths = old.totalMonths − count(payments where status=PAID)`
- Concurrent approval — spawn 2 approves, exactly 1 succeeds, other → 409
- Old Product → REFURBISHED status flip; new Product → status update on activation
- CSV golden fixture: `case-8-same-price.csv` (NEW — single sub-case, no cash legs)

### Integration tests
- Submit → approve → new Contract + 3 JEs + old.status=EXCHANGED + product.status=REFURBISHED
- Submit with non-matching price → 400
- Submit with GFIN sale → 403
- Reject path

### E2E (Playwright)
- SALES picks PHONE_USED contract → /insurance/exchange-request/new → select replacement → submit → OWNER queue → approve → verify new contract appears with carried-over remaining schedule

---

## Acceptance Criteria

- [ ] SALES/BM submits request in ≤ 15 sec (only pick new product)
- [ ] OWNER approves clean request in ≤ 5 sec (confirm only — no inputs)
- [ ] SALES user cannot approve their own request
- [ ] New product picker only shows same-brand+model+storage+sellingPrice IN_STOCK options
- [ ] Customer pays ฿0 — no cash leg in any JE
- [ ] All 3 JEs balance (Dr = Cr) per template and across batch
- [ ] Old INSTALLMENT contract → EXCHANGED exactly when JEs post (atomic)
- [ ] Old Product → REFURBISHED status retained in same branch
- [ ] New contract has remaining-installment plan (NOT a fresh 12 months)
- [ ] Failed JE leaves request PENDING + no Contract / Product status change
- [ ] Trial Balance: `21-1106` = 0 net after batch
- [ ] Audit log: `EXCHANGE_REQUEST_SUBMITTED` + `EXCHANGE_REQUEST_APPROVED|REJECTED` with full diff
- [ ] Concurrent approve: 2 OWNERs simultaneous → exactly 1 succeeds, other gets 409

---

## Migration plan

1. **Pre-plan checks** (block plan kickoff until done):
   - CPA confirms `21-1106` label fits Case 8 clearing-account intent
   - CPA reviews JE templates (A.1/A.2/A.3) against golden CSV — A.2 plug-balance edge cases especially
2. Schema migration: add `ContractExchangeRequest` table + `Contract.exchangedFromContractId` FK + `EXCHANGED` enum value + Product.status `REFURBISHED` (if absent)
3. Backend: 3 templates (A.1, A.2, A.3) + service + controller + 3 endpoints (submit / list-pending / approve / reject — body-less approve)
4. Frontend: new `ExchangeRequestForm` + `/insurance/exchange-requests` queue + menu entry + replace hotfix #1079's INSTALLMENT route (`/defect-exchange`) with `/insurance/exchange-request/new`
5. CSV golden fixture: `case-8-same-price.csv` (single sub-case)
6. Tests + E2E + deploy + smoke test one exchange in dev

No data backfill — feature is forward-only.

---

## Out of scope / deferred

- **CASH exchange** — out of scope per owner. Handle via existing trade-in + new POS sale (2 transactions, no JE chain).
- **GFIN integration** for exchange — UI blocked; customer closes GFIN externally
- **Upgrade exchange** (different sellingPrice) — explicitly disallowed per owner v3
- **Multi-device exchange** in one request — single-device only
- **Partial exchange / split contract** — not requested
- **Reverse exchange** (undo an APPROVED exchange) — separate "exchange reversal" template; deferred
- **Old `/defect-exchange` deprecation** — keep working after SP2 ships (defect-only path still has value); plan removal later
