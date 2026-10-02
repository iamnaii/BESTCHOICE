# POS model-compatible quick gifts — local verification

Preview: http://localhost:5227/pos?zone=shop
Release: 26.10.5. Production rollout is verified separately through GitHub Actions.

- Match declared target brand and comma-separated exact model; normalize case/spacing. No substring or product-name guesses. iPhone 15 differs from Pro/Pro Max/Plus. Multi-model declarations supported.
- Quick picks and manual search filter before pagination, require same branch and IN_STOCK. Bounded candidate batches and page ID list.
- Changing the selected phone removes incompatible gifts. Server enforces compatibility atomically for CASH and EXTERNAL_FINANCE.
- Missing model declarations and connector-only charger metadata do not establish phone compatibility.

Verification:
- npm run local:check: PASS (22 checks); web 2806, shared 134, storefront 46 tests passed; API focused 38 passed.
- Read-only reviewer: PASS, zero outstanding issues.
- 14 UI flows: light/dark × 320, 390, 768, 1024, 1280, 1440, 1920px; no horizontal overflow, quick controls >=44px, mobile bar above navigation, short-height confirmation reachable.
- Live local API: compatible case remains visible behind 12 newer incompatible cases; multi-model film matches; unknown/Pro/charger excluded.
- Live UI: manual search cannot bypass compatibility; changing to Pro refreshes choices and removes gifts.
- Three bad local sale submissions rejected with no stock, sale or journal mutation.
- Successful local cash sale 1230d4f8-8a47-47f1-9aa4-adfde82a7d9e: net 15900, two gifts, all three units SOLD_CASH, 3 balanced journal entries.
- Synthetic external-finance fixture now uses ordinary SL numbering to avoid collision on repeated preview sales; existing fixture relations preserved.
- Fresh compatible synthetic stock left for preview: search TEST-POS-DEMO-0.

Scope: disposable PostgreSQL only, synthetic customers/products, outbound warranty notifications disabled. External-finance compatibility covered by the shared writer guard/unit checks; the completed live transaction was cash. Production data unchanged.
