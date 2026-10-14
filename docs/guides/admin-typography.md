# Admin screen typography

The application UI uses locally served **Noto Sans Thai Looped** for Thai, Latin and numbers (owner decision, 2026-10-14). This includes admin, auth/public pages, customer/LIFF screens, identifiers, portalled controls and notifications. `apps/web/src/styles/fonts.css` declares normal variable weights 100–900; `public/fonts/noto-sans-thai-looped/` contains official Google Fonts WOFF2 subsets, the OFL license and source hashes. Only the Thai subset is preloaded. The existing screen scale in `admin-typography.css` is retained.

- Main page headings: 24px desktop, 22px below 1024px, line height 1.5.
- Normal text and tables retain their 14px baseline. Compact text uses line height 1.5; legacy 7–11.5px labels are raised to 12px.
- Normal form controls: 14px desktop, at least 16px below 1024px. Explicit large amount and scanner fields retain their original sizes.
- Right-aligned table columns use tabular numerals. UI amounts, identifiers, code and keyboard hints use the same Noto Sans Thai Looped stack, including legacy `font-mono` elements; existing alignment is retained. The global mono token remains unchanged for paper and stickers.
- Sonner notifications use the same font stack as the admin UI.

## Document boundary

Document components, templates, PDF generators and print rules retain their existing typography. The base layer isolates actual paper/editor roots (`.voucher-sheet`, `.document-sheet`, `.bc-document`, `.template-paper`, `.font-sarabun`, `.mobile-receipt`, `.sticker`, `.print-stickers`, `.tiptap`) with the legacy Inter/IBM fallback token; explicit Sarabun, sticker and editor faces keep priority. Existing document font assets and imports remain available.

Report-page and print-dialog wrappers also contain UI controls, so `.document-landscape` and `.document-print-dialog` do **not** establish a legacy font boundary. Their headings, filters and print buttons use Noto; the actual paper inside retains its font. Admin screen scale/color selectors still exclude their existing document subtrees. New renderers should mark paper content separately from the surrounding controls.

## Verification

Run `npm run local:check` in this checkout, then `node tools/check-admin-typography.mjs`. The latter requires this checkout's current isolated local preview. It checks Finance portfolio, contracts, credit checks, receivables, customers and Inbox at 390/768/1056/1440px (with the desktop sidebar expanded; the desktop Inbox renders no app sidebar — only its own 72px rail, whose layout contract lives in `tools/check-local-inbox-design.mjs`); normal and large amount input sizes; consistent computed font families for visible text, controls, portal menus and notifications; and real receipt, contract-template preview and sticker components with the new stylesheet enabled and disabled. All descendant font metrics and dimensions must match in both screen and print media. Preview records are synthetic; this does not test production financial transactions.

Finance portfolio status labels and amount/currency pairs stay on one line. Screen-only 12px cell padding reduces crowding on narrow laptop windows; the existing inner table scroller handles smaller widths. Print spacing is unchanged.

Additional narrow-layout audit: contracts (including workflow badges), credit-check queue and finance receivable status labels opt into `admin-status-badge`. These finite labels remain whole; arbitrary tags elsewhere retain their existing wrapping. Portfolio summary cards adapt to available width and place amounts below the icon row. Both changes are inside the existing screen/document guard. The browser check covers all six routes at four widths; receivable rows use intercepted synthetic GET data to verify layout only, not that feature’s backend flow.

## Finance summary cards

Selected finance summary strips opt into `finance-card-grid`: monetary cards use one column below 390px, two columns on larger phones/laptops, and four (or three/five for strips with three/five cards) from 1280px. With three or five monetary cards, the last card spans the narrow-screen row. Compact expense count filters retain two columns on narrow screens. Mobile card-content padding is 16px horizontally. Values scale from 18–22px with each card’s width and use 1.65 line-height so the taller Noto glyph metrics fit their local scroll containers. They stay on one line, and can scroll locally for exceptionally large amounts instead of being ellipsized. Screen/document guards also protect these rules. Payment navigation tabs scroll within their container on narrow screens.

Payment accounting-code hints and the year-end closing formula use `SummaryCardHelp`; operational warnings and accounting amounts remain visible. Full hint text is retained in the popover and in a print-only fallback. No API, financial calculation, receipt, PDF, export or document template changes are included.

Run `node tools/check-finance-cards.mjs` after the local check. It exercises 10 actual route layouts at 320/375/390/768/1056/1440px, plus payment daily-summary, commission payout and Inter-co aging tabs. It checks million-baht values (including negative amounts), single-line fit, page overflow and help controls. Unsupported local read endpoints are intercepted with synthetic browser fixtures; this validates UI layout, not their backend financial flows.

## Supplemental instructions

`PageHeader` accepts optional `help` and `helpLabel`. It uses `InlineHelp`, a native keyboard-accessible details/summary disclosure, for optional instructions only. Keep the short page purpose, required next action, financial conditions and security/destructive-action consequences visible. Do not hide text automatically by character count or reduce font sizes to make a page look minimal.

The full route inventory (`npm run docs:check -- uxui-pages.browser.docs-spec.ts`) additionally checks loaded Noto faces and the computed family of visible UI text, excluding actual paper/editor content. See `docs/review/2026-10-14-noto-minimal/README.md` for coverage and evidence.

`node tools/check-noto-ui.mjs` checks standalone policy pages, public recovery UI, native disclosures at 100%/200% root text size, Thai/Latin font loading, and mobile navigation label fit across role/zone configurations. Standalone policy HTML links the local public font declarations with screen-only overrides; its print type remains unchanged. The privacy table has a keyboard-focusable horizontal scroller and long URLs wrap on screen.
