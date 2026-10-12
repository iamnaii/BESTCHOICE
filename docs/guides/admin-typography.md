# Admin screen typography

The admin UI retains Inter for Latin text/numbers and IBM Plex Sans Thai for Thai. The screen-only layer in `apps/web/src/styles/admin-typography.css` improves legibility without changing global Tailwind tokens or the fonts used for documents.

- Main page headings: 24px desktop, 22px below 1024px, line height 1.5.
- Normal text and tables retain their 14px baseline. Compact text uses line height 1.5; legacy 7–11.5px labels are raised to 12px.
- Normal form controls: 14px desktop, at least 16px below 1024px. Explicit large amount and scanner fields retain their original sizes.
- Right-aligned table columns use tabular numerals. UI amounts, identifiers, code and keyboard hints use the same Inter + IBM Plex Sans Thai stack, including legacy `font-mono` elements; existing alignment is retained. The global mono token remains unchanged for paper and stickers.
- Sonner notifications use the same font stack as the admin UI.

## Document boundary

No document component, template, font asset, shared document style, PDF generator or print rule is changed. The new stylesheet applies only in screen media with an admin app shell present. When a document, receipt, sticker, template editor or iframe is mounted, the entire screen keeps its original typography. This conservative boundary also prevents inherited changes from a parent from reaching paper content. New document renderers should use an existing document container marker.

## Verification

Run `npm run local:check` in this checkout, then `node tools/check-admin-typography.mjs`. The latter requires this checkout's current isolated local preview. It checks Finance portfolio, customers and Inbox at 390/768/1056/1440px (with the desktop sidebar expanded; the desktop Inbox renders no app sidebar — only its own 72px rail, whose layout contract lives in `tools/check-local-inbox-design.mjs`); normal and large amount input sizes; consistent computed font families for visible text, controls, portal menus and notifications; and real receipt, contract-template preview and sticker components with the new stylesheet enabled and disabled. All descendant font metrics and dimensions must match in both screen and print media. Preview records are synthetic; this does not test production financial transactions.

Finance portfolio status labels and amount/currency pairs stay on one line. Screen-only 12px cell padding reduces crowding on narrow laptop windows; the existing inner table scroller handles smaller widths. Print spacing is unchanged.

Additional narrow-layout audit: contracts (including workflow badges), credit-check queue and finance receivable status labels opt into `admin-status-badge`. These finite labels remain whole; arbitrary tags elsewhere retain their existing wrapping. Portfolio summary cards adapt to available width and place amounts below the icon row. Both changes are inside the existing screen/document guard. The browser check covers all six routes at four widths; receivable rows use intercepted synthetic GET data to verify layout only, not that feature’s backend flow.

## Finance summary cards

Selected finance summary strips opt into `finance-card-grid`: card columns follow usable content width (including the expanded sidebar), with a 224px minimum and a 160px minimum for expense count filters. Values scale from 18–22px with each card’s width, stay on one line, and can scroll locally for exceptionally large amounts instead of being ellipsized. Screen/document guards also protect these rules. Payment navigation tabs scroll within their container on narrow screens.

Payment accounting-code hints and the year-end closing formula use `SummaryCardHelp`; operational warnings and accounting amounts remain visible. Full hint text is retained in the popover and in a print-only fallback. No API, financial calculation, receipt, PDF, export or document template changes are included.

Run `node tools/check-finance-cards.mjs` after the local check. It exercises 10 actual route layouts at 390/768/1056/1440px, plus payment daily-summary, commission payout and Inter-co aging tabs. It checks million-baht values (including negative amounts), single-line fit, page overflow and help controls. Unsupported local read endpoints are intercepted with synthetic browser fixtures; this validates UI layout, not their backend financial flows.
