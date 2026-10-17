# Dropdown migration — 17 October 2026

Status: **PASS — migration complete, final local check passed on the final source fingerprint, verified preview remains running.**

## Scope and result

Migrated **206 legacy native dropdown sites in 122 files**, plus the Todo assignee filter that removed the browser arrow without replacing it. Includes all **197 admin + 9 storefront** legacy sites, including the dormant AssetForm/AssetTable, RichTextEditor and SortDropdown components. Total: **207 migrated sites / 123 files**, plus their shared primitives and affected layout consumers. A second pass also removed the native datalists in seller bank name and canned-response category, replacing them with the existing free-text NameAutocomplete. **Final total: 209 migrated sites / 125 consumer files.**

The after-scan covers **1,322 production source files** across admin, storefront, card reader and shared packages. It finds **zero legacy native sites**. The only two raw `<select>` implementations are the shared primitives, with **239 NativeSelect usages**. It also finds **zero raw datalists** and 5 shared NameAutocomplete usages. Existing Radix/SearchableSelect components remain in use. The internal API CLI benchmark HTML (`shop-ai-bench.cli.ts`) is outside the application UI scope.

Migrated files and counts: [migration-files.csv](migration-files.csv); per-site native changes: [migration-manifest.json](migration-manifest.json); free-text suggestions: [autocomplete-migration.json](autocomplete-migration.json).

Before inventory: [../dropdown-inventory-2026-10-17/README.md](../dropdown-inventory-2026-10-17/README.md). After inventory: [inventory.json](inventory.json), [inventory.csv](inventory.csv).

## Implementation

- Reuse the admin NativeSelect and add its storefront counterpart; one decorative arrow with reserved text space, native validation/change events/ref behavior preserved.
- 2.75rem (44px at normal root size) controls in both apps; 16px text below 1024px and 14px desktop. Noto Sans Thai Looped and existing document fonts retained.
- Width/margins/flex/grid placement belong to the wrapper; automatic widths stay automatic instead of taking space from adjacent inputs.
- Credit decision controls, contact prefix/name and card-button editor reflow on mobile. Todo leading icon and dropdown arrow coexist.
- A source inventory regression test rejects raw dropdowns outside the two shared primitives and rejects raw datalists.
- AST comparison confirms existing values, native props, handlers, ref spreads, validation and option/optgroup contents are retained at all 207 sites. Added an accessible name to the card button type control.

## Focused verification

| Evidence | Scope | Result |
|---|---|---|
| Component tests | Native form validation/data/reset, controlled changes, refs, disabled fieldsets, React Hook Form focus/value in both apps | 8 PASS |
| Source guard | Whole frontend source inventory | 1 PASS |
| Seller payment + autocomplete tests | Bank selection, free text, account preservation, disabled fields, keyboard, click without submit, Escape in dialog | 6 PASS |
| TypeScript | Admin and storefront | PASS |
| [style-matrix.json](style-matrix.json) | 207 isolated style fixtures × 24 combinations: Chromium/WebKit, light/dark, 320/390/768/1440px, enlarged root font at 320/1280px; long option labels, arrow inset/centering, text reserve, size/font, overflow, selection | PASS; 4,968 observations |
| [browser-chromium.json](browser-chromium.json), [browser-webkit.json](browser-webkit.json) | Actual admin app/API with disposable DB: sales, stock, contracts, finance receivables, pricing, invite and create-customer dialog at 1440/390px; selection/restoration | 28 page states PASS; 80 control observations |
| [contexts.json](contexts.json) | Actual CardBubbleEditor, CreditCheckPanel, TodoFilters, CreateContactModal with in-memory fixtures; 320/390/768/1440px and 320px with enlarged font, both engines | 10 configurations PASS |
| [storefront.json](storefront.json) | Actual catalog, product installment control, buyback model/storage, synthetic API responses; 5 viewport/font combinations × 2 engines | 30 states PASS |
| [browser-chromium-branches.json](browser-chromium-branches.json), [browser-webkit-branches.json](browser-webkit-branches.json) | Actual appointments branch fields, 1440/390px, both engines | 4 states PASS |
| [po-modern.json](po-modern.json) | Existing PO Radix filters: open, last/first selection, popup bounds, 1440/390/320px, both engines | 6 states PASS |
| [autocomplete.json](autocomplete.json) | Actual AcceptModal and TemplateEditorPane with synthetic in-memory data: final option visible/clickable inside scroll containers, free text, keyboard, Escape, template save patch; 5 sizes/font configurations, both engines | 20 states PASS |
| [quick-buy-autocomplete.json](quick-buy-autocomplete.json) | Actual QuickBuyModal through device/seller/payment steps in isolated local API preview, bank suggestions and free text; 390/1440/320px (320 enlarged font), both engines; no purchase submission | 6 states PASS |
| [system-e2e.json](system-e2e.json) | Full existing Chromium suite, real API + disposable PostgreSQL | **814 passed, 10 skipped, 0 failed/flaky**; 19.5 minutes |
| [room-summary-regression.json](room-summary-regression.json) | Additional Inbox request-size regression on actual API, 426 retained synthetic rooms, Chromium/WebKit | PASS; all rooms returned across requests of at most 3,786 URL characters |

## Additional issue found during final verification

The first final `local:check` passed types, lint, unit tests, builds and the desktop flow, then failed in the mobile Inbox flow with HTTP 431. Hundreds of retained synthetic chat rooms exposed a real limit: the existing appointment-summary query put up to 500 UUIDs into a single URL (~20KB). The Inbox now sends batches of 100 and merges all results. It retains the API authentication/company scope and query cancellation; a failed batch rejects the complete query instead of returning partial success. A regression test reproduced the old failure with 500 UUIDs, then passed after the fix. Three tests cover all IDs/null results, an empty list, and mixed successful/failed batches. Read-only review passed, and actual browser/API checks returned all 426 available rooms with no 431 errors on both engines. The managed check was rerun after this final source change and passed all 39 checks.

## Review and limits

Read-only code review compared all 207 sites to the pre-migration snapshots. Three layout/cascade warnings were fixed and re-reviewed: auto-width flex items, inconsistent compact height, and tablet font size. Final code review: no remaining Critical/Warning findings. The two additional datalist replacements also passed read-only review; the identified scroll-container integration risk was checked in AcceptModal, QuickBuyModal and TemplateEditorPane with both browser engines.

The style matrix is an isolated rendering of the migrated styles, not 207 real page workflows. Browser route samples and the full E2E suite provide separate integration evidence. This does not assert every role, every conditional modal state, real iPhone/Android hardware, live LINE/Meta, or the deployed production build was tested. No business forms were submitted by the focused browser scripts; full E2E uses its own disposable PostgreSQL and blocked/simulated providers.

The full E2E run started at the core migration fingerprint recorded in [core-source-snapshot.json](core-source-snapshot.json); the two datalist consumers were updated while it was running. The autocomplete/QuickBuy checks ran after the datalist updates. The Inbox request-size fix was made after the full E2E run, with its own regression tests and browser/API verification; the final local check runs after all source edits. These are separate verification layers, not a claim that the full E2E suite ran against one frozen final snapshot. The 10 skipped E2E scenarios are listed with their original reasons in [system-e2e-skipped.json](system-e2e-skipped.json); they include missing accounting/receivable/overdue fixtures, document API authentication/availability and tests explicitly marked skipped. They are not counted as passed. Final local results are recorded in [local-check.json](local-check.json) and [verification-summary.json](verification-summary.json). No commit, push, merge or deployment is part of this local handoff.

## Final local verification

- `npm run local:check`: **39/39 PASS**, final source fingerprint `4a3bbec0b4d74db5903f6fb408f58a6463a823f2f15dfcdd5908167f3ac4d07c`. Types, lint, builds, unit tests and desktop/mobile browser flows completed after the last source edit.
- Unit tests: **3,389 admin + 149 shared + 52 storefront = 3,590 PASS**; local tooling: 13 PASS.
- Lint: 0 errors; API reports 3,013 warnings and admin reports 467 warnings. This work does not claim those repository-wide warnings were all resolved.
- [Appointments preview](http://localhost:5206/appointments?zone=shop), [Inbox preview](http://localhost:5206/inbox?zone=shop). Verified running from this checkout and matching the final source fingerprint. Data/AI are synthetic; live LINE/Meta and physical devices remain outside this verification.
