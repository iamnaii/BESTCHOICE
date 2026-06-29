# Purchasing & Receiving UX Overhaul (v2) — Design

**Date:** 2026-06-29
**Status:** Approved (brainstormed + scrutinized twice — approach + spec-vs-source — + accounting-boundary verified)
**Scope:** `apps/web/src/pages/PurchaseOrdersPage/**` (+ a new QC page + a purchasing summary strip) and `apps/api/src/modules/purchase-orders/**` (+ `suppliers` polish). **Additive only** — no data-model rewrite, no accounting/finance changes.
**Source:** Two-agent exploration of the live system + a 3-track verification sweep, all traced against source. See "Evidence base" at the bottom.

---

## Goal

Make the purchasing flow — **สั่งซื้อ → อนุมัติ → สั่ง → รับเข้า → QC** — materially more user-friendly for a Thai phone-shop, on **both desktop (สร้าง/อนุมัติ PO) and mobile (รับเข้าหน้างาน)**, by rebuilding the *experience* on top of the existing (already well-factored, accounting-isolated) backend. The four pains the owner named, all in scope:

1. **มองภาพรวมไม่ออก** — no overview; can't see what's pending approval / on the way / late / waiting QC / unpaid.
2. **สร้าง PO ยุ่งยาก** — one long modal; VAT/discount math is opaque.
3. **ตอนรับของวุ่น** — two receive buttons, slow per-unit entry, no partial-receive clarity.
4. **QC ตกหล่น** — QC state hidden in a collapsible panel; no real queue.

## Hard constraints (red lines)

- **ห้ามยุ่ง/กระทบ ACCOUNTING และ FINANCE.** Verified: the `purchase-orders` module is architecturally sealed — `imports: []`, only `PrismaService` injected, **creates zero JournalEntry / GeneralLedger / ExpenseDocument rows**. Receiving today posts **no JE** (the SHOP inventory JE templates incl. `ShopTradeInTemplate` are scaffolded but **not wired** to production callers per `.claude/rules/accounting.md`). This rebuild **keeps receiving 100% JE-free** and introduces **no** cross-module import into accounting/finance/journal/expense/tax. Wiring SHOP inventory JEs is a separate, owner-gated decision — explicitly **out of scope**.
- **One indirect touchpoint to respect:** `Product.costPrice` is set at receive time from `POItem.unitPrice` ([po-receiving.service.ts:86,250](../../../apps/api/src/modules/purchase-orders/services/po-receiving.service.ts)) and is later read by COGS at *sale* time (`accounting/transactional-report.service.ts` aggregates `costPrice` for SOLD products). We do not change that path — but the new **supplier-direct receive** must **require + validate costPrice**, or COGS silently breaks.
- **Don't touch `trade-in`** (the B2C buy-back module — its own appraisal/consent/photo/anti-theft flow) and **don't touch `Product.ownedByCompanyId`** (owned by the `contracts` module's `transferOwnership`).
- **No new dependencies.** Reuse existing infra (see below).

## Approach

- **Experience rebuild + additive backend** (chosen over a data-model rewrite). The owner picked "รื้อทั้งระบบ", but scrutiny showed the *backend is already clean and isolated* and **all** the pain is front-of-glass + a few additive fields. A full data-model rewrite would force re-touching the `costPrice`/ownership write paths — i.e. the exact accounting-adjacent code the red line forbids. So: rebuild every screen, extend the schema **additively** (one new `POStatus` value, a few new columns, one new `DefectReason` enum), reuse the rest.
- **Batch-by-batch, one-deploy-per-batch** (the proven inbox-overhaul cadence): each batch is a coherent branch → main → deploy → owner review, then the next.
- **Reuse, don't reinvent** (verified to exist):
  - Mobile: `components/ui/drawer.tsx` (bottom-sheet) + `hooks/useIsMobile.ts`. `apps/web` is already responsive (`grid-cols-2 lg:grid-cols-4`, viewport-aware modals).
  - Dashboard/cards: `DashboardPage/components/DashboardKPIs.tsx` + `DashboardAlerts.tsx` card pattern; the `/dashboard/alerts` `computeAlerts()` compute-on-read pattern in `dashboard/services/dashboard-ops.service.ts`.
  - Running numbers: the existing `poNumber` generator (PO-YYYY-MM-NNN) — GR numbers follow the same operational pattern (see decision 2).
  - Cron infra (`notifications/scheduler.service.ts`, `@nestjs/schedule`) exists but is **not** used in MVP (overdue = compute-on-read; cron is a later upgrade only if the owner wants proactive LINE pushes).
- **YAGNI on the long tail.** The high-value items are the 6 batches below. No GR PDF e-mailing to suppliers, no SLA engine, no QC analytics dashboards in v2.

## Cross-cutting decisions

1. **Direct receive = SUPPLIER-ONLY B2B, implemented as auto-PO** (owner-confirmed model, chosen over nullable-FK after scrutiny). "รับเข้าตรงไม่มี PO" covers urgent buys from a vendor with no pre-made PO. Instead of threading nullable `poId`/`poItemId` through the PO-centric read paths, the backend **auto-creates a real PO** (supplier + line items, `unitPrice = costPrice`) and advances it `DRAFT→APPROVED→ORDERED` in **one Serializable `$transaction`**, then runs the **existing** `goodsReceiving()` flow. Net effect: `GoodsReceiving.poId` is **never null**, so GR history / AP / timeline / progress / the T5-C16 ceiling check all work unchanged with **zero null-guards**. It **requires `supplierId` + per-line `costPrice`** (validated; COGS reads it), **posts no JE**, **bypasses the OWNER approval gate** (BM acts on the spot — write an `AuditLog` for the bypass), and flags the PO `isDirectReceive = true` so the list can badge it. It does **not** absorb used-phone buy-back (that's `trade-in`, untouched).
2. **GR number = operational, follows `poNumber`.** `GoodsReceiving.grNumber` is `GR-YYYY-MM-NNN`, generated by mirroring `generatePONumber()` ([sequence.util.ts:129](../../../apps/api/src/utils/sequence.util.ts)) — a **count-based** monthly sequence. Because count-based numbering is **not** collision-proof on its own, it MUST be generated **inside the existing Serializable receive `$transaction`**, with the `@unique` constraint as the backstop and a **retry on P2002**. It is **not** an accounting document number — deliberately not routed through `DocNumberService`'s `<TYPE>-YYYYMMDD-NNNN` accounting convention, to keep purchasing out of the accounting surface.
3. **`ORDERED` is an additive state, not a rewrite.** New PO status `ORDERED` + `orderedAt DateTime?` sits between `APPROVED` and the receive states. "กดสั่งซื้อ" stamps `orderedAt` and confirms `expectedDate`. Receiving is allowed from `ORDERED` **or** `APPROVED` (back-compat). The unused `PENDING` enum value is left in place but documented as dead (removing an enum value is a breaking migration — not worth it). **AP needs no change for `ORDERED`:** `getAccountsPayable` filters `status notIn ['CANCELLED','DRAFT']` ([po-query.service.ts:86](../../../apps/api/src/modules/purchase-orders/services/po-query.service.ts)), so an `ORDERED` PO appears in AP exactly as an `APPROVED` PO already does today — verified no-op, no regression.
4. **Overdue = computed-on-read, no cron.** "เลยกำหนดส่ง" = `status = ORDERED AND expectedDate < now() AND deletedAt IS NULL`. Surfaced as a badge on the list + a count in the summary strip, piggybacking the existing dashboard-alerts cache pattern. (Proactive LINE notification via the existing cron infra is a documented future upgrade, not built.)
5. **Retire the legacy `receive()` path.** Verified functionally dead: zero UI callers (the frontend posts only to `/goods-receiving`, [usePurchaseOrdersData.ts:129](../../../apps/web/src/pages/PurchaseOrdersPage/hooks/usePurchaseOrdersData.ts)), zero internal callers, only 3 race-condition unit tests. "Unify the two flows" is therefore just *delete the dead one* + migrate those 3 tests onto `goodsReceiving()` (the race defense is identical). Done in B0.
6. **Structured defect reasons.** Replace free-text `GoodsReceivingItem.rejectReason` (kept as an optional note) with a `DefectReason` enum (e.g. `SCREEN`, `BATTERY`, `IMEI_BLOCKED`, `BOX_MISSING`, `WRONG_MODEL`, `DOA`, `OTHER`) so QC rejections are reportable. Additive column.
7. **IMEI duplicate guard at receive.** Before creating a `Product` for a phone unit, reject if a non-deleted `Product` already has that `imeiSerial` (reuse the existing partial-unique convention; no schema change). Applies to both PO receive and supplier-direct receive.

## State machine (additive)

```
DRAFT ──approve──▶ APPROVED ──กดสั่งซื้อ──▶ ORDERED ──รับของ──▶ PARTIALLY_RECEIVED ──รับครบ──▶ FULLY_RECEIVED
  │                   │  (back-compat: รับของ allowed straight from APPROVED)        │
  └──reject──┐        └──cancel──▶ CANCELLED                                          └──(optional later) CLOSED
             ▼
          CANCELLED  (reject = set status CANCELLED + rejectReason; there is NO separate REJECTED value)
```

- Verified against `enum POStatus` ([schema.prisma:191](../../../apps/api/prisma/schema.prisma)): values are `DRAFT / APPROVED / PENDING(unused) / PARTIALLY_RECEIVED / FULLY_RECEIVED / CANCELLED`. **There is no `REJECTED`** — reject sets `CANCELLED`.
- New: `ORDERED` value + `PurchaseOrder.orderedAt DateTime?`. `expectedDate` already exists.
- Overdue is **derived**, not a stored status.
- `CLOSED` (received-in-full *and* paid-in-full) is **deferred** — `FULLY_RECEIVED` + the independent payment chip already convey this; add `CLOSED` only if the owner later wants an explicit archive bucket.

## Data model — additive migrations only

> Next API migration timestamp **must be ≥ `20260977000000`** (per memory: `20260976000000` is already taken). Follow `workflows/prisma-changes.md`. Prod is throwaway test data (forward-fix, no historical backfill), but still use safe 2-step or `@default` for any required column.

> **Shrunk by the auto-PO decision.** Because direct-receive creates a real PO, `GoodsReceiving.poId` and `GoodsReceivingItem.poItemId` **stay `NOT NULL`** — no nullable-FK churn, no inline attrs, no `supplierId` on GR, no `onDelete` rework. Verified current state: both are `String` (required) at [schema.prisma:1816,1834](../../../apps/api/prisma/schema.prisma).

- `PurchaseOrder`: add enum value `ORDERED`; add `orderedAt DateTime?`; add `isDirectReceive Boolean @default(false)` (marks an auto-PO from walk-in/urgent receive; drives the list badge). `@default(false)` makes this safe on existing rows.
- `GoodsReceiving`: add `grNumber String?` then backfill then promote to `@unique NOT NULL` (2-step — a `@unique NOT NULL` column **cannot** take a static `@default` on a populated table); add `@@index([grNumber])`. (Prod is throwaway test data so backfill is trivial, but keep the migration shape correct for dev.)
- `GoodsReceivingItem`: add `defectReason DefectReason?` (enum). Keep `rejectReason String?` as a free-text note. **No** nullable `poItemId`, **no** inline attrs.
- New enum `DefectReason` (SCREAMING_SNAKE_CASE values).
- **No changes** to `Product`, `Supplier` core, accounting/finance tables.

## Information architecture — split the mega-page into zones

Today: one `PurchaseOrdersPage` = 2 tabs (รายการ PO / ยอดค้างชำระ) + 4 modals + a collapsible QC panel. New structure (all under the existing `/purchase-orders` + one new route):

| Zone | Today | v2 |
|---|---|---|
| **ภาพรวมจัดซื้อ** (summary strip) | none | KPI/alert cards (reuse `DashboardKPIs` pattern): รออนุมัติ · รอสั่ง · กำลังมา (⚠️ เลยกำหนด) · รอรับ · รอ QC · ค้างจ่าย. Each card = a filter shortcut. Counts from a new `GET /purchase-orders/summary` (compute-on-read). |
| **รายการ PO** (desktop list) | raw table + status filter | status **pill**, **partial-receive progress** (รับแล้ว 3/10), payment **chip**, **overdue badge**, search by PO#/supplier, clearer empty states. |
| **PO detail** | read-only modal | **status timeline** (Draft→อนุมัติ→สั่งแล้ว→รับ→ครบ), per-item received/QC progress, **GR history** (each GR shows grNumber + receiver + time, **printable ใบรับของ**), contextual actions, payment section. |
| **สร้าง PO** (desktop) | one long modal | **4-step wizard**: (1) เลือกผู้ขาย (+inline create, show credit terms → due-date preview) → (2) เพิ่มรายการ (product picker + running subtotal) → (3) ส่วนลด/VAT (**transparent breakdown** — show how VAT & net are computed and rounded) → (4) ทบทวน+บันทึก. Auto-save draft (reuse the ContractCreate localStorage-draft pattern). |
| **รับเข้า** (mobile-first) | modal | full-screen / `Drawer` flow: pick PO **or "รับเข้าตรง (supplier)"** → per unit: scan/enter **IMEI (dup-checked)** + camera photos + checklist (used phones) + PASS/REJECT with **structured defect** → big touch targets, progress, partial-receive supported. |
| **QC center** | collapsible panel | **dedicated page** (e.g. `/purchase-orders/qc` or a top-level tab) + **nav badge** of pending count: queue of `QC_PENDING`/`PHOTO_PENDING`, filter by branch/PO/date, bulk confirm, reject→defect. |
| **Suppliers** | full CRUD + history (fine) | light polish only. |

All frontend work obeys `.claude/rules/frontend.md`: react-query + `@/lib/api`, shadcn/ui + Radix + lucide, **design tokens only** (no hardcoded gray/hex), `leading-snug` on Thai, lazy-loaded routes, `sonner` toasts, `useDebounce` for search.

## Batches (one-deploy-per-batch)

Each item: primary location + (impact / effort). Every backend change ships with jest specs (`--runInBand` for DB-backed specs per memory). Follow the WAT workflows (`add-api-endpoint.md`, `prisma-changes.md`, `create-page.md`).

### B0 — Backend additive foundation
- Migration (timestamp ≥ `20260977000000`): `ORDERED` + `orderedAt` + `isDirectReceive` on `PurchaseOrder`; `GoodsReceiving.grNumber` (2-step: nullable → backfill → `@unique NOT NULL`) + `@@index([grNumber])`; `GoodsReceivingItem.defectReason`; `DefectReason` enum. (high / M)
- `grNumber` generation mirroring `generatePONumber()`, **inside the Serializable receive `$tx`** + P2002 retry. (high / S)
- `POST /purchase-orders/:id/order` → `APPROVED → ORDERED` (sets `orderedAt`, confirms `expectedDate`). (high / S)
- `GET /purchase-orders/summary` → counts for the strip (compute-on-read). (high / S)
- IMEI duplicate guard in the receive `$tx`. (high / S)
- **Retire legacy `receive()`**: delete route + service method + `ReceivePODto`; migrate the 3 race tests onto `goodsReceiving()`. (medium / S)

### B1 — PO list + detail redesign
- Status pills, partial-receive progress bar, payment chip, overdue badge, PO#/supplier search, empty states. `POListTab.tsx`. (high / M)
- PO detail: status timeline + per-item received/QC progress + GR history list. `PODetailModal.tsx` (or promote to a detail view). (high / M)
- **Printable ใบรับของ (GR)** per receiving record (grNumber, supplier, items, receiver, time). (high / M)

### B2 — สร้าง PO wizard (desktop)
- 4-step wizard with product picker + running totals; supplier inline-create + credit-term/due-date preview. `CreatePOModal.tsx` → stepper. (high / L)
- **Transparent VAT/discount breakdown** (mirror the service's `ROUND_HALF_UP`/net math so the UI shows the same numbers). (high / M)
- Auto-save draft (localStorage, reuse ContractCreate pattern). (medium / S)

### B3 — รับเข้า mobile-first + supplier-direct receive
- Mobile receive flow in `Drawer`/full-screen: per-unit IMEI (with dup feedback), camera photo capture, checklist, PASS/REJECT + structured defect, partial-receive progress. `GoodsReceivingModal.tsx` → mobile-first rebuild. (high / L)
- **Supplier-direct receive (auto-PO)**: `POST /purchase-orders/direct-receive` — in one Serializable `$tx`: create PO (`isDirectReceive = true`, `unitPrice = costPrice`, supplier required) → set `APPROVED`/`ORDERED` (approval-bypass + `AuditLog`) → run existing `goodsReceiving()`. Requires `supplierId` + per-line `costPrice` (validated). Frontend entry "รับเข้าตรง" in the mobile receive flow; auto-POs badged in the list. (high / L)

### B4 — QC center
- Dedicated QC page + nav badge (pending count): queue, branch/PO/date filters, bulk confirm, reject→defect. Reuses `getQCPending` + `qc-confirm`. `QcPendingPanel.tsx` → page. (high / M)

### B5 — Purchasing dashboard strip + overdue + AP polish
- Summary strip on `/purchase-orders` using `DashboardKPIs` card pattern, wired to `GET /purchase-orders/summary`. (high / M)
- Overdue badge/count (compute-on-read) surfaced on strip + list. (medium / S)
- AP tab polish (clearer remaining/paid, links into PO detail). (medium / S)

## Out of scope (documented, not built)

- **SHOP inventory JE wiring** (S11-2001/2002/2003 + S21-1101/1102) on receive — owner-gated accounting decision; keep receive JE-free.
- **Hardening the `POST /products` backdoor** (BM can create `PHONE_USED` with arbitrary `costPrice`, no appraisal) — real risk found during scrutiny, but it lives in the `products` module and would touch the trade-in boundary. Logged here; fix later.
- Used-phone buy-back changes (owned by `trade-in`).
- Branch-to-branch incoming (`/stock/transfers?view=incoming`) — separate from supplier receiving; untouched.
- Proactive overdue LINE notifications (cron), GR e-mail to suppliers, SLA engine, QC analytics.
- `CLOSED` PO status, GR↔contract back-reference, receiving-batch sign-off/lock.

## Testing & verification

- API: jest per batch; DB-backed specs run `--runInBand` (parallel-DB flaky per memory). Keep the T5-C16 receive race coverage alive on `goodsReceiving()`.
- Types: `./tools/check-types.sh all` must be 0 before each ship.
- Web: vitest where used; manual mobile pass for B3 on a real phone viewport.
- Per batch: `code-reviewer` agent → fix → `/pre-deploy` → branch → main → deploy → owner review.

## Evidence base

- System map: `purchase-orders` module = facade ([purchase-orders.service.ts](../../../apps/api/src/modules/purchase-orders/purchase-orders.service.ts), 101 LOC) over query/lifecycle/receiving; models `PurchaseOrder`/`POItem`/`GoodsReceiving`/`GoodsReceivingItem`/`Supplier`; statuses `DRAFT/APPROVED/PENDING(unused)/PARTIALLY_RECEIVED/FULLY_RECEIVED/CANCELLED`; product lifecycle `PO_RECEIVED→QC_PENDING→PHOTO_PENDING→IN_STOCK`.
- Accounting boundary: module `imports: []`, only Prisma injected; receiving/QC create no JE; `getAccountsPayable` + VAT are display-only (tax reports source from `JournalLine`, not PO); `ownedByCompanyId` set by `contracts`, not PO; `costPrice` read by COGS for SOLD products only.
- Verification sweep: trade-in module is the existing B2C used-phone path (untouched); legacy `receive()` is dead (safe to retire); mobile/dashboard/alert infra all exist to reuse.
