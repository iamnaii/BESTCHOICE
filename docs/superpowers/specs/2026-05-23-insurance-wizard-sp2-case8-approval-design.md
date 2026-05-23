# Insurance Wizard SP2 — Case 8 JE Chain + Maker-Checker Approval

**Date:** 2026-05-23
**Status:** Design — awaiting plan
**Scope:** Full accounting + approval flow for BC FINANCE device exchange
**Depends on:** SP1 (IMEI UX) — assumes IMEI lookup endpoint + wizard refactor have shipped
**Awaiting before plan:** CPA sign-off on Case 8 templates + verification that existing `21-1106` CoA label matches intended use

---

## Problem

After SP1 simplifies the wizard UX, BC FINANCE exchange ("เปลี่ยนเครื่อง" for INSTALLMENT sale type) still routes to the existing `DefectExchangePage`, which:
- Has no formal accounting wiring — Case 8 JE chain (3 entries per CSV reference) not implemented
- Has no maker-checker approval — exchange action commits immediately
- Has no formal buyback price logic with variance control
- Has no required photo evidence of returned device condition

This spec adds the full accounting + approval flow on top of SP1.

---

## Design Decisions

| Topic | Decision |
|---|---|
| Approval flow | **Maker-checker** — SALES / BM submits request → OWNER approves → JE chain posts atomically |
| Buyback price | Hybrid — default from trade-in valuation lookup, manual override allowed; `±20%` threshold (configurable via SystemConfig) |
| Variance > threshold | Require `overrideReason` text (min 10 chars) before submit |
| Out-of-7-day window | Submit allowed only for OWNER / BM with explicit "เปิดด้วยสิทธิ์พิเศษ" affordance; stored as `requiresOwnerBypass = true` on the request; approval queue surfaces this with a yellow badge |
| Pre-exchange guards | (a) Within 7-day warranty window OR `requiresOwnerBypass=true`; (b) at least 1 device condition photo uploaded |
| Photo upload | S3 storage; up to 5 photos per request; allowed formats `image/jpeg|png|webp`; max 8 MB per file |
| S3 unavailable | Block submission with clear error message — no offline draft |
| Contract strategy | **Always new contract** — old → status `EXCHANGED`, new gets fresh contract #, both linked via FK |
| Old → new carry-over | Customer + KYC documents + signed agreement template + deposit (if any). Payment history stays attached to OLD contract via existing relations |
| `Sale.saleType === null` | Treat as `EXTERNAL_FINANCE` (block exchange — matches SP1 behavior) |
| Concurrent approval | `updateMany({ where: { id, status: 'PENDING' }, data: {...} })` inside `$transaction`, assert returned count === 1; otherwise throw `ConflictException` |

---

## Schema Changes

### New table: `ContractExchangeRequest`

```prisma
model ContractExchangeRequest {
  id                    String    @id @default(uuid())

  // Old contract being exchanged
  oldContractId         String    @map("old_contract_id")
  oldContract           Contract  @relation("ExchangeRequestsFromOldContract", fields: [oldContractId], references: [id])

  // Buyback details
  buybackPrice          Decimal   @map("buyback_price") @db.Decimal(12, 2)
  buybackPriceFromTable Decimal   @map("buyback_price_from_table") @db.Decimal(12, 2)
  variancePercent       Decimal   @map("variance_percent") @db.Decimal(5, 2)  // signed: -25.00 = 25% below table
  overrideReason        String?   @map("override_reason")  // required if |variance| > threshold
  requiresOwnerBypass   Boolean   @default(false) @map("requires_owner_bypass")  // true if submitted outside 7-day window

  // New product + plan
  newProductId          String    @map("new_product_id")
  newProduct            Product   @relation(fields: [newProductId], references: [id])
  newPlanDownPayment    Decimal   @map("new_plan_down_payment") @db.Decimal(12, 2)
  newPlanCommission     Decimal   @map("new_plan_commission") @db.Decimal(12, 2)
  newPlanMonths         Int       @map("new_plan_months")
  newPlanInterestRate   Decimal   @map("new_plan_interest_rate") @db.Decimal(5, 2)

  // Documentation
  deviceConditionPhotos String[]  @map("device_condition_photos")  // S3 URLs; min 1 required

  // Status flow
  status                ExchangeRequestStatus @default(PENDING)
  rejectionReason       String?   @map("rejection_reason")

  // Cash account for JE3 (selected at approval time, defaulted from User.defaultCashAccountCode)
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

`EXCHANGE_BUYBACK_VARIANCE_THRESHOLD` — string-typed decimal, default `"20.00"` (interpreted as percent). OWNER-editable via `/settings`.

---

## Case 8 JE Templates

Three new templates under `apps/api/src/modules/journal/cpa-templates/`. All three run in one `$transaction` and share `metadata.batchId`. Each template's spec must include a balance-assertion test against the CSV golden fixture (`cpa-cases/case-8-*.csv`).

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

### Template 2 — `ExchangeCloseOld21_1106Template`

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

### Template 3 — `ExchangeClearVendor21_1106Template`

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

### Atomicity guarantees

All three templates execute inside one Prisma `$transaction`:
- Each template internally validates Dr=Cr balance (throws if unbalanced)
- `Contract.status` of old → `EXCHANGED` updated
- New `Contract` row created with full installment schedule
- `21-1106` ending balance after JE3 must equal `0` for the batch — assertion guard

Failure at any step rolls back; no partial state.

---

## API Endpoints

### (NEW) `GET /trade-in/buyback-suggest`
```
Query: productId=<id>
Response: { suggestedPrice: Decimal, source: 'TABLE' | 'FALLBACK', tableVersion: string | null }
```
If no matching entry in the buyback table, returns `source: 'FALLBACK'` with `suggestedPrice = 0` — UI shows a hint that staff must enter manually.

Roles: SALES, BM, OWNER.

> Note: the "buyback table" referenced in `accounting.md` ("ตีราคาตามตารางกลาง") may not be materialized as a separate table at SP2 plan time. Verify in plan: if a `TradeInValuation` (or similar) table exists, query it; otherwise the plan must propose creating one as a sub-task.

### (NEW) `POST /insurance/exchange-requests`
```
Body: {
  oldContractId, buybackPrice, newProductId,
  newPlanDownPayment, newPlanCommission, newPlanMonths, newPlanInterestRate,
  deviceConditionPhotos[],
  overrideReason?,         // required if |variance| > threshold
  requiresOwnerBypass?,    // true only if SALES/BM was outside 7-day window
}
Response: ContractExchangeRequest (status=PENDING)
```
Validation:
- Old contract must be `ACTIVE` + INSTALLMENT
- Photos: 1 ≤ count ≤ 5
- Variance computed server-side from `buybackPrice` vs `GET /trade-in/buyback-suggest` result; `overrideReason` required if exceeds threshold
- `requiresOwnerBypass`: server re-checks 7-day window; if outside, requires submitter role in OWNER/BM

Roles: SALES, BM, OWNER.

### (NEW) `GET /insurance/exchange-requests/pending`
```
Response: ContractExchangeRequest[] (status=PENDING)
```
Roles: OWNER only.

### (NEW) `POST /insurance/exchange-requests/:id/approve`
```
Body: { cashAccountCode: string }  // required, used in JE3 sub-case A/C
```
Process:
1. Lock-acquire via `updateMany({ where: { id, status: 'PENDING' }, data: { status: 'APPROVED', approvedById, approvedAt, cashAccountCode } })` inside `$transaction`
2. Assert returned count === 1 — else throw `ConflictException("คำขออาจถูกอนุมัติแล้ว")`
3. Compute Sub-case (A/B/C) from `buybackPrice` vs `(newPlanDownPayment + newPlanCommission)` (the vendor sum on new contract)
4. Run `ExchangeNewContract1ATemplate` → create new `Contract` row + installment schedule
5. Run `ExchangeCloseOld21_1106Template` against old contract
6. Run `ExchangeClearVendor21_1106Template` against new contract
7. Update old `Contract`: `status='EXCHANGED'`, `exchangedAt=now`, `replacedByContractId=<new>`
8. Update request: `newContractId`, `je1aId`, `je2Id`, `je3Id`
9. Copy carry-over fields from old → new contract: `customerId`, `kycDocuments[]`, `signedAgreementUrl`, `depositAmount`. Payment history stays attached to old (no copy).
10. Write AuditLog `EXCHANGE_REQUEST_APPROVED` with full diff

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
- `CreateInsuranceWizardPage.tsx` (from SP1) — when channel is INSTALLMENT and user clicks "เปลี่ยนเครื่อง", route to **new** `ExchangeRequestForm` instead of `/defect-exchange`
- `InsurancePage.tsx` — add tab "เปลี่ยนเครื่องรอ approval" with count badge (OWNER only)

### New pages
- `ExchangeRequestForm` (replaces redirect to `DefectExchangePage` for INSTALLMENT channel) — fields:
  - ① Buyback price (default from `/trade-in/buyback-suggest`, ±20% inline indicator, override reason field appears when over threshold)
  - ② New product picker (from stock, reuse existing `ExchangeProductPickerStep` UI)
  - ③ New plan calc (down / commission / months / interest — defaults from old contract plan)
  - ④ Device condition photos (1+ required, S3 upload)
  - Live preview: JE3 cash flow direction (positive = customer pays / negative = customer refund / zero = perfect offset)
  - Submit button: only enabled when all required fields valid
- `/insurance/exchange-requests` — OWNER queue (list + detail + approve/reject) — mirrors `/finance/contract-cancellation` UX
  - Yellow badge on rows with `requiresOwnerBypass=true`
  - Approve dialog: select `cashAccountCode` (default from approver's `User.defaultCashAccountCode`)

### Menu changes (`config/menu.ts`)
- OWNER: under "หลังการขาย" zone add "คำขอเปลี่ยนเครื่อง" with `badgeKey: 'exchange-requests-pending'`

### Old `/defect-exchange` route

Keep working as today for any existing bookmarks / external links. After SP2 ships, eventually deprecate (deferred decision).

---

## Testing Strategy

### Unit tests (apps/api)
- 3 JE templates: validate Dr=Cr balance for sub-cases A/B/C against CSV golden values (`case-8-A.csv`, `case-8-B.csv`, `case-8-C.csv`)
- Cross-template JE2 P&L threshold tests:
  - buyback < (Gross + VAT) → loss
  - buyback > (Gross + VAT) → gain
  - buyback == (Gross + VAT) → no P&L
- `ContractExchangeRequestService.approve`: full atomic flow + rollback test (force JE2 to throw, verify nothing partial)
- Variance calc: ±20% threshold edge cases (exactly at, just over, just under)
- Concurrent approval: spawn 2 approves, assert exactly 1 succeeds

### Integration tests
- E2E submission → approve → verify new Contract + 3 JEs + old.status='EXCHANGED'
- Reject path
- `requiresOwnerBypass` filter visibility

### E2E (Playwright)
- SALES submits exchange for INSTALLMENT contract → OWNER sees in queue → approves → verifies new contract appears
- Buyback variance > 20% → reason field appears → submit blocked without reason

---

## Acceptance Criteria

- [ ] SALES/BM can submit an exchange request in ≤ 30 seconds (excluding photo upload)
- [ ] OWNER can approve a clean request in ≤ 15 seconds
- [ ] SALES user cannot approve their own (or any) request
- [ ] Buyback variance > 20% requires reason text before submit (server-side enforced)
- [ ] All three JEs balance (Dr = Cr) per template and across batch
- [ ] Old contract status flips to `EXCHANGED` exactly when JEs post (not before)
- [ ] Approval is atomic — failed JE leaves request `PENDING` and no Contract artifacts
- [ ] Trial Balance after exchange shows `21-1106` = 0 net (clearing account fully settled for the batch)
- [ ] Audit log captures `EXCHANGE_REQUEST_SUBMITTED` + `EXCHANGE_REQUEST_APPROVED`/`REJECTED` with full diff
- [ ] Concurrent approve: 2 OWNERs clicking simultaneously → exactly 1 succeeds, the other gets `409 Conflict`

---

## Migration plan

1. **Pre-plan checks** (block plan kickoff until done):
   - CPA confirms `21-1106` existing label matches Case 8 use
   - CPA reviews 3 JE template designs against finance-coa.csv golden cases
   - Verify whether buyback valuation table exists in schema (if not, plan must include creating one)
2. Schema migration: add `ContractExchangeRequest` + `Contract` self-relation + `EXCHANGED` enum
3. Seed: insert `EXCHANGE_BUYBACK_VARIANCE_THRESHOLD = "20.00"`
4. Backend: 3 templates + service + controller + endpoint roles
5. Frontend: new `ExchangeRequestForm` + `/insurance/exchange-requests` queue page + menu entry
6. Tests + E2E + deploy + smoke test with one real exchange in dev

No data backfill — feature is forward-only for new exchange events.

---

## Out of scope / deferred

- **GFIN integration** for exchange — needs GFIN API contract; current scope only **blocks** the UI (consistent with SP1)
- **Multi-device exchange** in one request — single-device only
- **Partial exchange / split contract** — not requested
- **Reverse exchange** (undo an APPROVED exchange) — needs separate "exchange reversal" template; deferred
- **Old `/defect-exchange` deprecation** — keep working, plan later removal after SP2 settles
- **Auto-detect buyback table refresh** — manual via admin tool, not auto-sync
