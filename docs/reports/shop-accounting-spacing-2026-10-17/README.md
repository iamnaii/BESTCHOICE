# SHOP accounting spacing — 17 October 2026

Scope: `/shop/accounting?zone=shop`, both Trial Balance and Profit & Loss. Presentation only; endpoints, query parameters, roles, formulas, account rows, signs and totals are unchanged.

## Reproduced

Baseline: `f819c1bf5fdad824617d938fabd37c0b61b19580`.

- At 1440px, the date control ended **1px above the card divider**; the header had no vertical padding.
- Ordinary data rows were **38px** tall.
- Auto-sized columns differed between account sections. On a narrow screen, names and amounts competed for space inside an overflow-hidden table.
- The header's inner flex container did not span the card, so its auto margin could not align totals to the right edge.

Evidence: [before metrics](before.json), [desktop before](before-1440.png), [mobile before](before-390.png).

## Changes

- Add 20px top/bottom padding to report headers and use shared 44px date controls with a 12px label gap (base 16px root size).
- Align debit/credit summaries within the full header width and wrap them on small screens.
- Increase row padding; ordinary rows now measure 46px. Keep column widths consistent across sections, reserve space for complete amounts, and allow long account names to wrap.
- Constrain horizontal scrolling to each table. Labeled, focusable regions support unmodified left/right arrow keys in Chromium and WebKit. Modified keys and descendant controls retain their behavior.
- Let the P&L net total wrap below its label when needed.
- Collapse the long accounting explanation. The incomplete-ledger warning and prohibition on filing/closing before accounting acceptance remain visible, including when collapsed. All existing explanatory caveats remain accessible.

## Verification

Read-only code review passed, including a follow-up review of keyboard scrolling. The existing five ShopAccountingPage unit tests passed in the focused run; the complete local check is also required before handoff.

Browser matrix: **22 configurations / 44 report views**, all passing. Chromium and WebKit each cover 320, 390, 640, 768, 1024, 1280 and 1440px with a 16px root; dark mode at 320, 640 and 1024px with a 20px root; dark desktop at 1440px/16px. Additional empty/error/retry checks passed in both engines.

Assertions cover:

- No document horizontal overflow, Noto Sans Thai Looped loaded, header padding, label spacing and control size.
- Complete large positive/negative amounts and long Thai account names; P&L net total inside its padded card.
- Matching column widths across report sections and keyboard access to the last column of both reports.
- Essential warning visible when collapsed; opening/closing explanation with the keyboard.
- All three date pickers change the corresponding ISO query parameter while displaying Buddhist-era dates.
- Selected tabs and date values retained when switching reports; no page errors.
- Empty states and recovery from a simulated GET failure through the retry button.

[Results](results.json) · [Desktop after](after-1440.png) · [Mobile after](after-390.png) · [P&L mobile](after-pl-390.png) · [Enlarged dark mobile](after-pl-chromium-320-20-dark.png).

The fixture renders the actual page and production typography/color styles, with a sidebar-width frame and synthetic GET responses. It does not validate live accounting balances, permissions, physical devices or other application routes. No production data is written.

## Reproduce from repository root

```sh
node docs/reports/shop-accounting-spacing-2026-10-17/serve.mjs
# In another terminal, while that server is running:
node docs/reports/shop-accounting-spacing-2026-10-17/baseline.mjs
node docs/reports/shop-accounting-spacing-2026-10-17/audit.mjs
LOCAL_PREVIEW_PORT=5206 npm run local:check
```

The server prints its URL and records it under ignored `.tmp/shop-accounting-spacing-20261017/server.json`. Its optimizer cache is isolated. `fixture.txt` contains synthetic data only; `?large=1`, `?scenario=empty`, `?scenario=error`, `?theme=dark` and `?root=20` select verification scenarios.
