# Insurance Wizard SP1 — IMEI-driven UX Simplification

**Date:** 2026-05-23
**Status:** Design — awaiting plan
**Scope:** `/insurance/new` wizard UX only — no accounting / no schema changes
**Related:** SP2 (Case 8 + approval queue) — separate spec

---

## Problem

Current insurance wizard at `/insurance/new` takes 4 steps to start any ticket — customer pick, device pick, warranty preview, confirm. Pain reported by owner: "ขั้นตอนเยอะ" (too many steps). 90% of cases involve a device sold by the shop (IMEI in DB) — manual customer/device picking is redundant data entry.

This spec addresses **only** the UX simplification. The "เปลี่ยนเครื่อง" (defect exchange) path for BC FINANCE customers still routes to the existing `DefectExchangePage` — Case 8 JE chain and maker-checker approval are deferred to SP2.

Out of scope (covered by SP2):
- New JE templates / new CoA usage
- Maker-checker approval queue
- Formal buyback price form with ±20% threshold
- Photo upload requirement

---

## Design Decisions

| Topic | Decision |
|---|---|
| Input | **IMEI / Serial only** — single field, scan or type |
| IMEI not in DB | Block with "ไม่ได้ซื้อจากร้าน" — no walk-in fallback |
| Channel routing | Auto-detect from `Sale.saleType`: CASH / EXTERNAL_FINANCE / INSTALLMENT |
| `saleType` null/unknown | Treat as EXTERNAL — block exchange, allow repair only |
| CASH exchange | Route to existing trade-in flow `/trade-in/new` (unchanged) |
| GFIN (EXTERNAL_FINANCE) exchange | UI blocks "เปลี่ยนเครื่อง" button; only "รับเข้าซ่อม" available |
| INSTALLMENT (BC FINANCE) exchange | **Route to existing `DefectExchangePage`** — no Case 8 yet (SP2) |
| Repair flow | Unchanged from today (`DefectDescriptionStep`) |

---

## Flow Overview

### Step 1 — IMEI input + auto-fill

```
[scan or type IMEI] → lookup Product, Sale, Contract
  │
  ├─ not found → ❌ "ไม่ได้ซื้อจากร้าน" (block, no retry to walk-in)
  │
  └─ found → preview card with:
            - Customer name + phone
            - Contract # + status + remaining installments (if INSTALLMENT)
            - Device (brand/model/storage/IMEI)
            - Warranty status badge
            - Channel badge (CASH / GFIN / BC FINANCE)
            + 2 action buttons:
              [🔧 รับเข้าซ่อม]     [🔄 เปลี่ยนเครื่อง]
```

Button states by channel:
- **CASH**: both active. "เปลี่ยนเครื่อง" → redirect `/trade-in/new?customerId=…&productId=…`
- **EXTERNAL_FINANCE (GFIN)**: only "รับเข้าซ่อม" active; "เปลี่ยนเครื่อง" disabled with tooltip "ผ่อนกับ GFIN — ติดต่อ GFIN เพื่อปิดสัญญาก่อน"
- **INSTALLMENT (BC FINANCE)**: both active. "เปลี่ยนเครื่อง" → redirect `/defect-exchange?contractId=…` (existing page)
- **`saleType` null or unknown**: treat as EXTERNAL — block exchange, allow repair

### Step 2 — depends on action chosen

- **รับเข้าซ่อม** → existing `DefectDescriptionStep` (form unchanged, but now pre-filled with everything from IMEI lookup)
- **เปลี่ยนเครื่อง** → redirect out to either trade-in or DefectExchangePage as above

---

## API Changes

### (NEW) `GET /insurance/lookup-by-imei`

```
Query: imei=<IMEI or Serial>
Response: {
  found: boolean,
  customer?: { id, name, phone },
  sale?: { id, saleType: 'CASH' | 'INSTALLMENT' | 'EXTERNAL_FINANCE' | null },
  contract?: { id, contractNumber, status, remainingInstallments },
  product?: { id, brand, model, storage, imeiSerial },
  warrantyStatus?: 'IN_7DAY_DEFECT' | 'IN_SHOP_WARRANTY' | 'IN_MANUFACTURER' | 'OUT_OF_WARRANTY',
  daysRemainingIn7Day?: number,
}
```

Behavior:
- Lookup `Product` by `imeiSerial`. If not found → return `{ found: false }`.
- Find latest `Sale` for that product. Derive `saleType`.
- If `saleType === 'INSTALLMENT'`, find linked `Contract`.
- Compute warranty status from existing logic in `DefectExchangePage` (eligibility check).

Roles: SALES, BRANCH_MANAGER, FINANCE_MANAGER, OWNER.

No POST endpoints in SP1 — repair ticket creation reuses existing `POST /repair-tickets`.

---

## UI Changes

### `CreateInsuranceWizardPage.tsx` — refactor

Replace 4-step `1 ลูกค้า → 2 เครื่อง → 3 ตรวจประกัน → 4 ยืนยัน` with:

```
Step 1: <ImeiLookupStep />  — single field + auto-fill preview + action buttons
Step 2: <DefectDescriptionStep />  — only reached for "รับเข้าซ่อม"; "เปลี่ยนเครื่อง" redirects out
```

Removed components from active flow (kept as files for SP2 reuse):
- `CustomerPickerStep` — replaced by IMEI auto-fill
- `DevicePickerStep` — replaced by IMEI auto-fill
- `WarrantyPreviewStep` — auto-shown inline in Step 1 preview card
- `ExchangeProductPickerStep` — not used in SP1 (DefectExchangePage handles it for now)

### Backwards compatibility

Existing entry URLs continue to work:
- `/defect-exchange?contractId=...` → still redirects to `DefectExchangePage` via `DefectExchangeRedirect`
- `/insurance/new?intent=exchange&contractId=...` (from WarrantyCheckPage) → SP1 Step 1 detects preset IDs and skips IMEI input

### No menu changes

Existing menu entries (`/insurance`, `/insurance/warranty-check`) unchanged.

---

## Testing Strategy

### Unit tests (apps/api)
- IMEI lookup: not-found case, found with each `saleType` value, `saleType === null` case
- Warranty status computation for all 4 statuses

### Frontend tests (vitest)
- IMEI input: empty submit blocked, format validation
- Button state per channel (CASH all-active, GFIN exchange-disabled, INSTALLMENT all-active)
- Preview card renders correctly for each lookup shape

### E2E (Playwright, 1 spec)
- Scan IMEI → see preview → click "รับเข้าซ่อม" → fill defect → submit → RepairTicket appears in list
- Scan unknown IMEI → see block message

---

## Acceptance Criteria

- [ ] Wizard reduces from 4 visible steps to 2 (IMEI input → action form)
- [ ] IMEI not in DB blocks with clear message — no walk-in option
- [ ] Each `saleType` branch shows correct action buttons
- [ ] Repair ticket creation flow yields identical `RepairTicket` records as before (no behavior regression)
- [ ] `/defect-exchange` redirect continues to work for INSTALLMENT exchange (existing UX preserved)
- [ ] IMEI input → action button click ≤ 3 user actions (scan, click ปุ่ม) on the happy path

---

## Migration plan

1. Add `GET /insurance/lookup-by-imei` endpoint + service
2. Refactor `CreateInsuranceWizardPage.tsx` to use new `ImeiLookupStep`
3. Verify redirect paths from `/defect-exchange` and `/insurance/warranty-check` still land correctly
4. Lint + type + integration tests + 1 E2E
5. Deploy + smoke test

No DB migration. No data backfill. Forward-compatible — old DefectExchangePage flow stays intact.

---

## Out of scope (deferred to SP2)

- Case 8 JE chain (3 templates) for BC FINANCE exchange
- `ContractExchangeRequest` table + maker-checker approval queue
- `±20%` buyback variance threshold with override reason
- Device condition photo upload
- New `/insurance/exchange-requests` queue page
- `21-1106` clearing account usage (already in CoA, but no template uses it yet)
- Old → new contract artifact transfer

SP2 will *add* the full Case 8 flow on top of SP1's IMEI foundation. Until SP2 ships, INSTALLMENT exchange continues to use the existing `DefectExchangePage` (which works but lacks proper accounting).
