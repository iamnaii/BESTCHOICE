# Device Exchange Wizard Redesign — IMEI-driven 2-step flow with Case 8 JE

**Date:** 2026-05-23
**Status:** Design — awaiting plan
**Scope:** `/insurance/new` wizard simplification + multi-channel exchange + BC FINANCE Case 8 accounting

---

## Problem

Current insurance wizard at `/insurance/new` takes 4 steps to create a repair ticket or device exchange:
1. ลูกค้า (manual customer pick)
2. เครื่อง (manual contract + product pick)
3. ตรวจประกัน (warranty preview)
4. ยืนยัน (defect description OR exchange product picker)

Pain points raised by the owner:
- Too many steps for a routine intake — most data could be auto-derived from a single IMEI scan
- Exchange flow currently only handles defect-window swap; no support for trade-in (CASH sales) or BC FINANCE installment exchange (which requires Case 8 JE chain)
- No accounting wiring for "exchange with same shop" — the CSV-defined Case 8 JE chain is not yet implemented

Out-of-scope (deferred):
- Walk-in repair (devices not sold by BESTCHOICE) — explicitly **blocked** per owner decision
- GFIN exchange — blocked at UI (customer must clear GFIN externally first)

---

## Design Decisions (settled during brainstorm)

| Topic | Decision |
|---|---|
| Input | **IMEI / Serial only** — single field, scan or type |
| IMEI not in DB | Block with "ไม่ได้ซื้อจากร้าน" — no walk-in fallback |
| Channel routing | Auto-detect from `Sale.saleType`: CASH / EXTERNAL_FINANCE / INSTALLMENT |
| CASH exchange | Route to existing **trade-in module** |
| GFIN exchange | UI blocks the "เปลี่ยนเครื่อง" button; only "รับเข้าซ่อม" available |
| BC FINANCE exchange | **Case 8 JE chain** (3 entries) — full accounting flow |
| Old device buyback | **Hybrid** — default from trade-in valuation table, manual override allowed; **±20% threshold** before requiring OWNER approval (configurable via SystemConfig) |
| Approval flow | **Maker-checker** — SALES / BM submits → OWNER reviews queue → approve triggers JE post |
| Pre-exchange guards | Within 7-day warranty window + device condition photos required |
| Out-of-window exchange | OWNER manual bypass (existing `bypassWindow` capability) |
| Contract strategy | **Always new contract** — old contract status → `EXCHANGED`, new contract gets new number, both linked via FK |

---

## Flow Overview

### Step 1 — IMEI input + auto-fill

```
[scan or type IMEI] → lookup Product, Sale, Contract
  │
  ├─ not found → ❌ "ไม่ได้ซื้อจากร้าน" (block)
  │
  └─ found → preview card (customer/contract/device/warranty)
            + 2 action buttons:
              [🔧 รับเข้าซ่อม] [🔄 เปลี่ยนเครื่อง]
```

Preview card content (from IMEI lookup):
- Customer name + phone
- Contract number + status + remaining installments (if INSTALLMENT)
- Device (brand/model/storage/IMEI)
- Warranty status badge (color-coded)
- Channel badge (CASH / GFIN / BC FINANCE)

Button states by channel:
- CASH: both buttons active
- EXTERNAL_FINANCE: only "รับเข้าซ่อม" active; "เปลี่ยนเครื่อง" disabled with hover tooltip "ผ่อนกับ GFIN — ติดต่อ GFIN เพื่อปิดสัญญาก่อน"
- INSTALLMENT: both active; "เปลี่ยนเครื่อง" with 7-day check (OWNER/BM can bypass)

### Step 2 — Per-action form

**Repair path (existing UX — no changes):**
- Defect description (required, min 5 chars)
- Payer (SHOP / CUSTOMER / SUPPLIER_CLAIM — auto-default from warranty status)
- Repair supplier (optional)
- Estimated cost (optional)
- Submit → creates RepairTicket

**Exchange path — CASH channel:**
- Redirect to existing trade-in flow at `/trade-in/new?customerId=…&productId=…`

**Exchange path — BC FINANCE channel (Case 8):**
- ① Buyback price (default from trade-in table, ±20% inline; override → reason field appears)
- ② New product picker (from stock, same as current `ExchangeProductPickerStep`)
- ③ New installment plan (down payment / commission / months — defaults from old contract plan)
- ④ Device condition photos (1+ required, upload to S3)
- Live preview: net cash flow (positive = customer pays diff; negative = customer gets refund)
- Submit → creates **`ContractExchangeRequest`** in `PENDING` status (no JE posted yet)

### Step 3 — OWNER approval queue (`/insurance/exchange-requests`)

New page mirroring `/finance/contract-cancellation`:
- List of pending `ContractExchangeRequest` rows
- Detail view: old contract + new product + buyback price (with variance) + photos + override reason
- Actions: **Approve** (triggers Case 8 JE atomic chain + creates new Contract) / **Reject** (with reason)
- Audit log: `EXCHANGE_REQUEST_APPROVED` / `EXCHANGE_REQUEST_REJECTED`

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

### Contract model additions

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

`Contract.status` enum gets new value: `EXCHANGED` (sibling to `CANCELED`).

### Chart of Accounts addition (FINANCE chart)

New CoA code: **`21-1106` "หนี้สินจากเครดิตเปลี่ยนเครื่อง"** (Liability for exchange credit) — temporary clearing account.

Stamped from `apps/api/src/modules/journal/__tests__/fixtures/cpa-cases/finance-coa.csv` and seeded via `seedFinanceCoa()`.

### SystemConfig key

`EXCHANGE_BUYBACK_VARIANCE_THRESHOLD` — Decimal, default `20.00` (interpreted as percent). OWNER-editable.

---

## Case 8 JE Templates

Three new templates under `apps/api/src/modules/journal/cpa-templates/`. All three run inside one `$transaction` and share `metadata.batchId`.

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

Re-uses existing rounding rules from `accounting.md` (ROUND_DOWN for principal, ROUND_HALF_UP for VAT).

### Template 2 — `ExchangeCloseOld21_1106Template`

Closes the old contract and stages the buyback credit into `21-1106`.

```
Dr 21-1106 [buyback price]
Dr 11-2106 [old unearned interest remaining]
Dr 21-2102 [old deferred VAT remaining]
Dr 51-1102 [loss — if buyback < remaining receivable] *
   Cr 11-2101 [old receivable Gross remaining]
   Cr 11-2105 [old VAT receivable remaining]
   Cr 21-2101 [old VAT recognized to ภ.พ.30]
   Cr 41-1101 [old interest revenue recognized]
   Cr 41-1102 [gain — if buyback > remaining receivable] *

* Loss / Gain mutually exclusive — only one posts based on sign of variance.
```

### Template 3 — `ExchangeClearVendor21_1106Template`

Clears `21-1106` against new contract's vendor payables. Three sub-cases based on `buyback vs new vendor payable`:

**Sub-case A: buyback < new vendor (10,000 + 1,000 = 11,000)** — customer adds cash diff
```
Dr 21-1101 [new vendor yodjat]
Dr 21-1102 [new vendor commission]
   Cr 21-1106 [buyback price]
   Cr 11-1101/1201 [cash diff received from customer]
```

**Sub-case B: buyback == new vendor** — no cash flow, perfect offset
```
Dr 21-1101 + Dr 21-1102
   Cr 21-1106 [buyback price = new vendor sum]
```

**Sub-case C: buyback > new vendor** — refund cash to customer
```
Dr 21-1101 + Dr 21-1102
Dr 11-1101/1201 [cash diff paid to customer]
   Cr 21-1106 [buyback price]
```

Sub-case is determined automatically by the service; no user choice.

### Atomicity guarantees

All three templates execute inside a single Prisma `$transaction`:
- Each template internally validates Dr=Cr balance (throws if unbalanced)
- `Contract.status` of old → `EXCHANGED` updated
- New `Contract` row created with full installment schedule
- `21-1106` ending balance must equal `0` per-contract-pair after JE3 — assertion guard

If any step fails, the whole transaction rolls back; no partial state.

---

## API Endpoints

### IMEI lookup
```
GET /insurance/lookup-by-imei?imei=<IMEI or Serial>
→ {
    found: boolean,
    customer?: { id, name, phone },
    sale?: { id, saleType: 'CASH' | 'INSTALLMENT' | 'EXTERNAL_FINANCE' },
    contract?: { id, contractNumber, status, ... },
    product?: { id, brand, model, storage, imeiSerial, ... },
    warrantyStatus?: 'IN_7DAY_DEFECT' | 'IN_SHOP_WARRANTY' | 'IN_MANUFACTURER' | 'OUT_OF_WARRANTY',
    daysRemainingIn7Day?: number,
  }
```
Roles: SALES, BRANCH_MANAGER, FINANCE_MANAGER, OWNER

### Trade-in buyback price suggestion
```
GET /trade-in/suggest-buyback-price?productId=<id>
→ { suggestedPrice, source: 'TRADE_IN_TABLE' | 'FALLBACK', tableVersion }
```
Reuses existing `/trade-in/evaluate` if present; otherwise wraps the table read.

### Exchange request lifecycle
```
POST /insurance/exchange-requests
Body: { oldContractId, buybackPrice, newProductId, newPlanDownPayment, newPlanCommission, newPlanMonths, deviceConditionPhotos[], overrideReason? }
→ ContractExchangeRequest (status=PENDING)

GET /insurance/exchange-requests/pending
→ [{ ... pending requests ... }]

POST /insurance/exchange-requests/:id/approve
→ Inside $transaction:
  - Validate request still PENDING + lock row
  - Compute Sub-case (A/B/C) from buyback vs new vendor
  - Run ExchangeNewContract1ATemplate → create new Contract row
  - Run ExchangeCloseOld21_1106Template → close old contract
  - Run ExchangeClearVendor21_1106Template → settle 21-1106
  - Update old Contract.status = EXCHANGED, exchangedAt, replacedByContractId
  - Update request: status=APPROVED, newContractId, je1aId, je2Id, je3Id
  - Write AuditLog: EXCHANGE_REQUEST_APPROVED

POST /insurance/exchange-requests/:id/reject
Body: { reason: string (min 10 chars) }
→ status=REJECTED, write AuditLog
```

### Role gates
- POST /insurance/exchange-requests — SALES, BM, OWNER
- GET pending + approve + reject — OWNER only

---

## UI Changes

### Modified pages
- `/insurance/new` (`CreateInsuranceWizardPage.tsx`) — reduce from 4 steps to 2; add IMEI input as Step 1; add channel detection; add `ExchangeRequestForm` for BC FINANCE branch
- `/insurance` (`InsurancePage.tsx`) — button "+ รับเครื่องเข้าซ่อม" remains (already renamed in PR #1075's branch); add tab for "เปลี่ยนเครื่องรอ approval" (count badge for OWNER)

### New pages
- `/insurance/exchange-requests` — OWNER queue (list + detail + approve/reject) — mirrors `/finance/contract-cancellation`

### Menu changes (`config/menu.ts`)
- OWNER: under "หลังการขาย" zone add "คำขอเปลี่ยนเครื่อง" with `badgeKey: 'exchange-requests-pending'`
- Other roles: no menu change (request submission happens inside the wizard, not as a standalone menu)

---

## Testing Strategy

### Unit tests (apps/api)
- 3 JE templates: validate Dr=Cr balance for sub-cases A/B/C (use CPA CSV golden values)
- `ContractExchangeRequestService.approve`: full atomic flow, including failure rollback test
- IMEI lookup: not-found case, multi-channel branching
- Variance calculation: ±20% threshold edge cases (exactly at threshold, just over, just under)

### Integration tests
- End-to-end: submit request → approve → verify new contract created + 3 JEs posted + old contract status changed
- Reject path
- Approval idempotency (double-click safety)
- Concurrent approval guard (only one OWNER can approve a given request)

### E2E (Playwright)
- SALES user submits exchange request for BC FINANCE contract
- OWNER sees in queue, approves, verifies new contract appears in /contracts

---

## Out of scope / deferred

- **GFIN integration for exchange** — needs GFIN API contract clarification; current scope only **blocks** the UI
- **Multi-device exchange** (swap 2 devices in one request) — single-device-per-request only
- **Partial exchange / split contract** — not requested
- **Reverse exchange** (undo an APPROVED exchange) — needs separate "exchange reversal" template; deferred
- **Old `/defect-exchange` redirect** — keep working as today; eventually deprecate
- **CASH exchange detail flow** — defers to existing trade-in module; no changes needed in this scope

---

## Migration plan

1. Schema migration: add `ContractExchangeRequest` table + Contract self-relation fields + `EXCHANGED` enum + CoA 21-1106 row
2. Seed: insert SystemConfig key `EXCHANGE_BUYBACK_VARIANCE_THRESHOLD = 20`
3. Backend: 3 templates + service + controller + endpoint roles
4. Frontend: wizard refactor + new approval queue page + menu entry
5. Lint + types + integration tests + E2E
6. Deploy + smoke test with one real exchange

No data backfill needed — feature is forward-only for new exchange events.

---

## Acceptance criteria

- [ ] OWNER can complete a BC FINANCE exchange end-to-end in ≤ 60 seconds (excluding photo upload)
- [ ] SALES user can submit a request but cannot approve their own
- [ ] Buyback variance > 20% requires reason text before submit
- [ ] All three JEs balance (Dr = Cr) per template and overall batch
- [ ] Old contract status flips to `EXCHANGED` exactly when JEs post (not before)
- [ ] Approval is atomic — failed JE leaves request `PENDING` and no Contract artifacts
- [ ] Trial Balance after exchange shows `21-1106` = 0 net (clearing account fully settled)
- [ ] Audit log captures both submission (`EXCHANGE_REQUEST_SUBMITTED`) and approval (`EXCHANGE_REQUEST_APPROVED`) with full diff
