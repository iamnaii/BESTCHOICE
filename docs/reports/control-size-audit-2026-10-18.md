# Admin control size audit — 18 October 2026

Request: make ordinary buttons visually consistent throughout the program, including the company selector and previous/next-year buttons on Monthly Close. Local changes only; no commit, push, merge or deployment.

## Changes

- Screen-only `admin-controls.css` sets ordinary action buttons and tab triggers to a 2.75rem (44px at the default font scale) minimum height. Icon controls use the same square size. Text buttons keep a content-appropriate width; wrapped text may increase height instead of clipping.
- Shared Button carries a stable marker that survives Radix `asChild`. Existing native actions, segmented filters, legacy tabs and buttons whose classes come from helper variables carry the same marker. Link-like controls, sorting labels, calendar cells, embedded steppers and multiline selection cards retain their layout.
- Visibility and alignment defaults use the components cascade layer. Existing `hidden`, breakpoint visibility and `justify-between` field layouts retain precedence.
- Explicit larger actions retain their size (after-sales intake, collection session actions and receiving actions). Printed/document/editor content retains its metrics. No font-family change.
- Monthly Close aligns the company/year groups at the bottom, uses matching 44px arrow controls and gives the year enough width and spacing. Segmented wrappers grow with their buttons. Note metadata and the appointment alert can wrap without clipping controls.
- PO and stock action columns allow button groups to wrap within the cell. The stock action width is 112px, keeping compatibility with its pixel-based column-width calculation; the PO action width is 10rem.
- Click handlers, disabled conditions, authorization and financial calculations are unchanged by the button annotations.

## Verification and evidence

Evidence directory: `.tmp/control-size-audit-20261018/` (local synthetic data).

- Source inventory covered native JSX actions plus shared Button/Tabs; a separate sweep checked class-name aliases.
- Chromium: **158 unique initial admin routes × 1440px and 390px = 316 views**. Measured 3,754 control instances, including 1,869 marked buttons/tab triggers. No document horizontal overflow, JavaScript runtime errors, marked controls below 44px, marked control vertical content clipping or clipped overflow-container height in those states. See `final-results.json`.
- Opened **14 different create/edit dialogs** in Chromium at desktop and phone widths; four also in WebKit. Tested company selection and previous/next year. See `interactions.json` (39 cases including seven Monthly Close cases).
- Monthly Close: ten additional Chromium/WebKit viewport/font combinations, 320–1440px. Both arrows and the company field measured 44px at a 16px root and 55px at a 20px root; no horizontal overflow. See `monthly-preview.json` and `controls-after.png`.
- Payment tables: 16 Chromium/WebKit cases covering pending/paid, long names, large amounts, expanded sidebar, 320–1440px, dark theme and enlarged root font. Checked cell/header clipping, reachable action column and batch selection/cancellation with synthetic GET fixtures. See `payments/results.json`.
- Final alias controls: **16 targeted cases** for booking, purchase, audit-log and appointment-alert layouts in Chromium/WebKit at 320–1440px, including enlarged text. No overflow or control clipping; local alert snooze dismissed it correctly. See `aliases-browser.json`.
- Followed three seeded contract/customer detail links at desktop and phone widths (six additional views); no page overflow or marked-control clipping. See `details.json`.
- Table containment sweep: 16 routes at two widths (32 views) found action groups extending beyond the PO/stock cells; fixed both and reran the sweep with no remaining cell containment violations. A final 16-case Chromium/WebKit matrix verified the final PO/stock widths at 320–1440px and enlarged text, with detail/price dialogs opened without submitting changes. See `table-controls.json` and `table-focus.json`.
- Read-only code review: PASS, no outstanding Critical or Warning findings. Earlier visibility/alignment and large-control findings were resolved before the final review.
- Fresh `VITEST_MAX_WORKERS=2 npm run local:check`: **PASS, 39/39 checks** on the final source, including type checks, lint, 3,597 automated tests (Web 3,396; Shared 149; Storefront 52), builds and desktop/mobile preview workflows. Evidence is `local-check-complete.json` and `local-check-complete.log`; the managed result is `.tmp/local-preview/check.json`. Source hashes match `source-freeze.json` after completion. Earlier completed or interrupted checks are not used as final-source completion evidence.

## Limits

The route scan covers initial admin states, not every role, parameterized detail page or modal combination. Public/LIFF/storefront and document layout were not part of this button migration. Browser phone viewports are simulated, not physical phones. LINE rich-menu and Yeastar profile reads report missing-provider configuration in the isolated full API fixture (400/500); their external integrations were not validated. No real transaction or outbound message was submitted.

Review preview: <http://localhost:5206/monthly-close?zone=fin>. This uses synthetic company/period data. The broader isolated full-API preview remains running separately for review.
