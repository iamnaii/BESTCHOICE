# Trade-in list and detail usability — 8 September 2026

User report: the right side of `/trade-in?zone=shop` is cut off, details are incomplete, and actions cannot be used.

## Diagnosis ledger

- The user's Chrome window measured `{0, 33, 1920, 982}` while the desktop was 1512 × 982. The page and document both measured 1920 px and the purchase button ended at x=1892; the app did not see the physical screen boundary. Resetting the browser viewport override did not change this. Resizing only the identified Chrome window to the desktop width restored inner/outer width 1512 and purchase-button right edge 1484. No global CSS workaround was applied.
- Separate reproducible mobile bug: at 390 px the page measured 406 px; the online-appraisal tab ended at x=404 and the last filter at x=563. The inner table toolbar kept custom filters on one line. Wrapped the controls and tab groups within TradeInPage; other DataTable consumers are unchanged. Four-width checks then reported no clipped controls.
- Accepted walk-in details omitted receipt/payment/branch/receiver fields already returned by the API. A failed detail request rendered an empty modal. Partial historical quote JSON without `lines` crashed rendering. Six initial regression tests failed before the fix.

## Changes

- Show original intake device/seller data, receipt number/date, agreed/offered/estimated amounts with distinct labels, actual payment method, masked seller bank account, branch/receiver and evidence indicators. Preserve explicit CASH/TRANSFER on legacy records whose old default flow was EXCHANGE.
- Show current Product status, real six-angle photo count, cash price and installment starting price through the existing scoped product/photo endpoints. Signed intake identifiers and amounts remain sourced from TradeIn. Failed reads show retry actions rather than invented zero values or a ready state.
- Print existing documents from details. Only OWNER/BM can issue missing documents; SALES sees a manager handoff. Refresh the detail query after mutations and when reopening it.
- Keep table actions pinned. Extend the managed local check to use search, open details at both horizontal scroll edges, verify receipt/current stock/photo/prices, and open/download the PDF preview from the detail flow.

No schema, accounting, ownership, access-grant or transaction changes. Local datasets and photos remain synthetic.

## Verification

- Detail/flow unit regression: 21 passed (11 new detail cases and 10 existing purchase-flow cases).
- Isolated preview mobile browser: purchase → voucher → prices/photos → stock → filtered list → details and PDF at both horizontal scroll edges passed.
- `npm run local:check`: all 17 checks passed on source fingerprint `e01fd7289e3bec405617ba3a706ebc0a77b51db8d04683dc14246aae44e94dca`. Includes API/Web types and lint, Web tests/build, Shared tests and extended desktop/mobile purchase → document → photos/prices → stock → list/details/PDF browser checks.
- Full AppModule with the existing disposable PostgreSQL database: 390, 1024, 1280 and 1440 px passed; desktop widths passed with the sidebar expanded and collapsed (7 combinations). All toolbar controls passed hit testing, row actions opened details at both horizontal scroll edges, current photo data loaded without an alert, and no page errors or horizontal document/detail overflow occurred. The test waits for the closing dialog to be removed before checking the next layout.
- Visually inspected desktop/mobile details. Refreshed the user's Chrome tab and opened the latest sample receipt; the purchase action now fits inside the physical window. The managed preview remains available at `http://localhost:5195/trade-in?zone=shop`; the full local app remains on port 5198. Both use synthetic records.

These are local checks for this UI change. Earlier CI/E2E results on `a88079789` predate this change; no merge or deployment was performed.

## Detail redesign with UI UX Pro Max

The detail dialog now leads with the device model, condition, original IMEI/Serial and agreed intake amount. A compact inventory panel follows immediately with current status, both selling prices, photo count and a single primary link to the product. Receipt/payment metadata and seller/evidence data sit in two columns on desktop and one column on mobile. Historical online quote, answers, notes and photos remain available below.

Used the existing controlled Radix/shadcn Dialog primitives with a bounded scroll body and fixed header/document footer. The dialog is at most 896 px wide with viewport gutters; print/close targets are at least 44 px. API queries, permissions, cache behavior and financial meanings are unchanged. No new packages or shared component changes.

UI UX Pro Max searches verified font-size hierarchy, readable mobile text and controlled Dialog composition. The layout applies those guidelines to the staff workflow using existing semantic colors and Thai fonts. Primary-button contrast was measured at 4.69:1 in light mode and 6.84:1 in dark mode; badges retain state colors with readable foreground text.

Design verification:

- Existing detail regression: all 11 tests passed.
- Browser checks passed at 1440×1000, 390×844, 375×667, 844×390 landscape, 1024×768 dark mode, and 390×844 with root text enlarged to 20 px. Tested both scroll ends, full evidence visibility, fixed document/close controls, keyboard focus/Escape, horizontal bounds and page errors. Screenshots inspected in light/dark/mobile.
- Full AppModule with disposable PostgreSQL: all 7 width/sidebar combinations passed after redesign, including opening details at both table scroll edges.
- `npm run local:check` after the redesign: all 17 checks passed, including 1,719 Web tests, 42 Shared tests, types/lint/build and the extended desktop/mobile purchase/document/photo/stock/detail flow. Source fingerprint: `a9a8b35a1ac013a30078b098a83c2d088e616a89e014dcc3fd29d85c89679e7b`.
