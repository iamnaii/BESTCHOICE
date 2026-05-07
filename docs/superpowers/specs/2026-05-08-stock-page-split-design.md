# Stock Page Split — Design

**Date:** 2026-05-08
**Branch:** `design/stock-page-split`
**Author:** owner + Claude (subagent-driven)

## Problem

Current `/stock` mounts a single `StockPage` component with a `dashboard | list` tab toggle (URL `?tab=list`). User feedback: "รายการกับภาพรวม ดูยาก" — the small tab pill is hard to find/use, and the dual-purpose page is cramped. Both views compete for the same viewport.

The user's actual flow is **B+A** — they primarily search/edit products (B) and check overview KPIs (A) frequently, switching between modes. The current tab toggle creates friction for context switches.

## Goal

Split `/stock` into two focused routes:
- `/stock` — **Overview** (KPIs, ActionZone, Branch cards, charts, top sellers, slow movers)
- `/stock/products` — **Products list** (search, filter, table, bulk actions)

Each page can fully use the viewport for its purpose. Sidebar gets two entries so users can navigate directly to either context.

## Non-goals

- No changes to data API endpoints (`/products`, `/products/stock`, `/products/stock/dashboard` stay as-is).
- No changes to existing sub-routes (`/stock/transfers`, `/stock/alerts`, `/stock/adjustments`, `/stock/count`, `/stock/workflow`).
- No changes to `BulkTransferModal` / `PriceManagementModal` behavior.
- Sticker print, transfer flow, and price management modal logic untouched.

## Architecture

### Routes (App.tsx)

```
/stock              → StockOverviewPage   (NEW)
/stock/products     → StockProductsPage   (NEW)
/products           → redirect /stock/products  (was: /stock?tab=list)
/inventory          → redirect /stock          (unchanged)
/stock/transfers    → unchanged
/stock/alerts       → unchanged
/stock/adjustments  → unchanged
/stock/count        → unchanged
/stock/workflow     → unchanged
```

### File structure

```
apps/web/src/pages/StockPage/
├── OverviewPage.tsx        NEW — top-level component for /stock
├── ProductsPage.tsx        NEW — top-level component for /stock/products
├── components/             unchanged (used by both pages):
│   ├── BranchSummaryCards.tsx
│   ├── StockHeroKpi.tsx
│   ├── StockActionZone.tsx
│   ├── StockDashboardTab.tsx    (used by Overview only)
│   ├── StockListTab.tsx         (used by Products only)
│   ├── BulkTransferModal.tsx    (Products only)
│   └── PriceManagementModal.tsx (Products only)
├── hooks/
│   ├── useStockOverview.ts  NEW — summary + dashboard + warranty + branches
│   ├── useStockProducts.ts  NEW — list query + filters + bulk + price modal state
│   └── useStockFilters.ts   REFACTORED — drop `activeTab`, simpler URL state
└── types.ts                 unchanged
```

The current `index.tsx` will be deleted (replaced by the two new top-level pages).

### Hook split

Current `useStockData` mounts 4 queries:
- `summaryData` (used by both pages — branch totals)
- `dashboard` (overview only — analytics)
- `branches` (both — for filter dropdown)
- `warrantyExpiring` (overview only — alert list)

Plus mutations and modal state (Products only).

**New `useStockOverview(branchId)`:**
- summary, dashboard, warranty, branches queries
- Returns: `summary`, `totalInStock`, `totalValue`, `dashboard`, `warrantyExpiring`, `branches`

**New `useStockProducts(filters)`:**
- summary + branches (cached, also used here for branch filter dropdown)
- list query (paginated, gated by `enabled`)
- Price modal state + mutations
- Bulk transfer state + mutation
- Selection state + helpers

### Branch filter sharing

`branchId` filter syncs via URL `?branchId=xxx`. Both pages read/write the same param.

When user clicks a branch card on Overview, it navigates with `?branchId=xxx`. Going to Products preserves that filter. This works through `useSearchParams` directly, no global state needed.

### Sidebar (config/menu.ts)

Add `รายการสินค้า` after `สต็อกสินค้า` (renamed to `ภาพรวมคลัง`) in 4 role configs (SALES, BRANCH_MANAGER, FINANCE_MANAGER, OWNER):

```ts
{ label: 'ภาพรวมคลัง', path: '/stock', icon: Warehouse },
{ label: 'รายการสินค้า', path: '/stock/products', icon: Package },
```

Mobile bottom nav (`สต็อก` shortcut) stays pointing to `/stock`.

## Action button placement

| Page | Always shown | Conditionally shown (manager + selection) |
|---|---|---|
| Overview | `+ เพิ่มสินค้า`, `พิมพ์สติกเกอร์` | — |
| Products | `+ เพิ่มสินค้า` | `โอน (N)`, `พิมพ์ (N)`, `ส่งออก (N)` |

## Migration plan

1. Build new files (Overview + Products + hooks).
2. Update `App.tsx` routes.
3. Update `config/menu.ts` (4 sections).
4. Delete old `StockPage/index.tsx`.
5. Typecheck → commit → PR → merge.

## Out of scope (future)

- Persist last visited tab as default landing per user preference.
- Add deep-link from ActionZone cards to filtered list (e.g. `/stock/products?status=REPOSSESSED`).
- Migrate StockListTab columns to a proper DataGrid component.
