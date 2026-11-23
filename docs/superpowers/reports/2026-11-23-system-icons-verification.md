# System icon verification

Local acceptance for the BESTCHOICE Phosphor Duotone migration on 2026-11-23. The [inventory](2026-11-23-system-icons-inventory.md) records every source migration and reviewed exception.

## Browser acceptance

| Coverage | Checks | Evidence |
| --- | --- | --- |
| Storefront home, catalogue and filters | Chromium at 390 and 1440 px. Brand logo, social destinations, keyboard menu/search, price selection, filter dialog, loading, empty, error and retry. | [Browser results](../../../.tmp/icons/storefront-final.log) |
| Storefront product | 390 and 1440 px. Keyboard gallery navigation, selected thumbnail, mouse-drag frame change, zoom/reset controls, dismiss, and disabled one-image controls. | [Gallery screenshots](../../../.tmp/icons/storefront/) |
| Storefront account, sell and fallback | 390 and 1440 px. Synthetic customer session, address form request and success toast, logout and LINE sign-in control, sell model selection and unknown-route fallback. Header and address dialog bounds at 320 px. | [Storefront screenshots](../../../.tmp/icons/storefront/) |
| Storefront `/stock` | Built canonical path at 390 and 1440 px. First-party loading shell with 56 px BESTCHOICE logo, phone and LINE destinations, and iframe title. Chromium fulfilled the Apps Script request locally. | [Stock screenshots](../../../.tmp/icons/storefront/) |
| Admin work and settings navigation | 390 and 1440 px in light and dark. Distinct SHOP, FINANCE and settings geometry and selected state. Mounted managed preview returned actual SHOP-home and scoped FINANCE-portfolio responses. | [Admin results](../../../.tmp/icons/admin-final.log) · [Settled menus](../../../.tmp/icons/admin-settled/) |
| Admin reverse reasons and signing | 390 and 1440 px. Add, edit and delete glyphs, switch state, edit and confirmation dialogs with synthetic settings data. Signing showed KYC, PDPA, acknowledgement-disabled action, completed step names and company signer state with synthetic contract responses. | [Admin screenshots](../../../.tmp/icons/admin/) |
| Admin LIFF notification preferences | 390 and 1440 px in light and dark. Wallet, warning, receipt, contract/profile links, disabled pending controls, request payload, success, failure and keyboard toast dismissal with a synthetic LINE session and synthetic preferences API. At 320 px the failure illustration is 48 px and centered above its heading. | [LIFF screenshots](../../../.tmp/icons/admin/) |
| Real contract evidence and staff signing API | Disposable AppModule, PostgreSQL and local file storage. Chromium decoded the synthetic 1 × 1 PNG from the protected content response as a blob at 390 and 1440 px, checked status/view/delete glyphs, keyboard focus return and canceled deletion. Signing status, preview and signature list returned 200. Credentialless LIFF GET and POST returned 401. | [Full API runtime results](../../../.tmp/icons/full-api-acceptance.log) · [Evidence screenshots](../../../.tmp/icons/full-api-decoded/icons-browser/) · [Browser decode results](../../../.tmp/icons/full-api-decoded/browser-blob-decoded.jsonl) |
| All six Sonner slots | Separate Vite-built fixtures import the real wrappers and each app’s Sonner version. Success, info, warning, error, loading and close glyphs were checked in actual DOM. The spinner runs with no motion preference and stops under reduced motion. Keyboard dismissal verifies the close name and removes only the target toast. | [Toaster results](../../../.tmp/icons/toasts-fifth.log) · [Screenshots](../../../.tmp/icons/toasts/) |

The [retained screenshots](../../../.tmp/icons/screenshots/) include the final storefront and admin behavior. The settled menu captures check the entire sidebar bounds and wait for the page fade to finish. Opening-animation frames are retained separately. [Capture results](../../../.tmp/icons/admin-settled.log) · [Open-transition frames](../../../.tmp/icons/admin-current/)

The storefront resolves Sonner 1.7.4 and retains its default close label. Admin resolves Sonner 2.0.7 and supports a custom label through `toastOptions.closeButtonAriaLabel`. The regular app interactions above separately exercised storefront address success and admin LIFF success/error notifications. The six-slot fixtures have no in-app routes.

The [before/after source comparison](../../../.tmp/icons/compare-actions.log) matched the sampled link/form/API expressions against `6a8481e1b`. This includes the storefront social destinations, address submission, sell quote requests, product contact links, LINE authorization entry, the LIFF payment-intent/status routes and uploaded document actions. Chromium checked the storefront social destinations, address request and LIFF notification payloads. Existing payment intent and label tests exercise the LIFF payment controls. The receiving component regression checks the same accessible item name, its `ผ่าน` and `ไม่ผ่าน` descriptions, selected state and corresponding glyphs.

## Findings and verification limits

- The controlled storefront address dialog remains dismissible with Escape. Focus stays on the document after closing instead of returning to the Add button. The dialog structure and dismissal handling match the baseline.
- The catalogue’s existing GSAP entrance showed a transient transform during the reduced-motion probe. The sell step regression and both Toaster spinner fixtures passed their reduced-motion checks.
- An additional full-API mobile interaction suite passed the contract-template Add menu, final item and preview steps. Its later GFIN keyboard tab had a right edge at **403.83 px** on a **320 px** viewport in both themes. The GFIN tab container and shared tabs code match the baseline source. The only GFIN page-tree change is the Add glyph in RateFactorsTab. Those two exploratory cases are reported separately from the focused acceptance runs. [Exploratory log](../../../.tmp/icons/full-api.log) · [GFIN source comparison](../../../.tmp/icons/gfin-baseline-diff.patch)
- The storefront UI uses its light theme. Successful customer LIFF sessions and writes in the browser use synthetic fixtures. Live LINE configuration, actual payment processing, and unselected routes/states are outside this run. The external Google Apps Script frame’s contents are outside the migration and were replaced with synthetic HTML during acceptance.
- The managed preview runs the services listed in its check report with synthetic data, simulated outbound providers and isolated local storage. The full AppModule document checks use a separate disposable database. These are local acceptance results.

## Managed smoke correction

The first complete-run attempt stopped at the Inbox media picker after the build and unit checks passed. The smoke still searched for the emoji-prefixed names. Chromium reproduced zero matches for the old names and exposed the Duotone Smiley and Package on the Thai-named tabs. The corrected smoke verifies the same composer flows, picker glyphs, selected state and keyboard activation at 390 and 1440 px. [Failed run](../../../.tmp/icons/local-check-stale-emoji-locator.json) · [DOM reproduction](../../../.tmp/icons/composer-label-repro.log) · [Focused rerun](../../../.tmp/icons/chat-library-current.log)

## Test and build record

| Command | Result |
| --- | --- |
| `NODE_OPTIONS=--max-old-space-size=8192 npm run local:check` | **PASS**, 48 recorded checks. Includes 16 scanner fixtures, the inventory guard, shared icon renderer test and types, API and frontend types, lint, 5,364 admin tests, 397 shared tests, 135 storefront tests, both Vite builds and managed browser checks. [Check summary](../../../.tmp/icons/check.json) · [Full output](../../../.tmp/icons/checks.log) |
| `npm run test --workspace=apps/web -- <focused navigation, renderer, receiving and payment specs>` | 60 passed in eight files. [Focused output](../../../.tmp/icons/admin-focused.log) |
| `npx playwright test -c tools/icons/toasts.config.mts` | Six viewport/theme combinations passed. Two storefront dark configurations skipped because the storefront uses the light theme. [Output](../../../.tmp/icons/toasts-fifth.log) |
| `cd apps/web-shop && CI=1 npx playwright test e2e/catalog-origin.spec.ts` | Four passed. [Output](../../../.tmp/icons/catalog-origin.log) |
| `cd apps/web-shop && SELL_E2E_PORT=5186 npx playwright test -c e2e/sell-round3.config.ts` | 32 passed, including actual synthetic submit payloads, retries, expiry, enlarged text, keyboard and reduced-motion cases. [Output](../../../.tmp/icons/sell-round3.log) |
| `bash tools/docs-integration.sh --runInBand --runTestsByPath e2e/documents/{icons.browser,contract-pdpa,kyc-evidence}.docs-spec.ts` | 20 passed and 10 PDF artifacts verified on disposable PostgreSQL. The local command uses the isolated-module Jest transform documented in the task record. [Output](../../../.tmp/icons/full-api-acceptance.log) |
| `npm run build:prerender --workspace=apps/web-shop`, routed to the synthetic prerender fixture | 13 routes plus the SPA shell, with zero unmatched API requests. [Build and prerender output](../../../.tmp/icons/storefront-prerender.log) |
| `npx playwright test -c e2e/icons.config.ts` in each app directory | 13 passed in each app. [Built storefront output](../../../.tmp/icons/storefront-final.log) · [Managed admin output](../../../.tmp/icons/admin-final.log) |

The scanner classified **399 approved exceptions**, including **41 brand**, **303 content**, **48 graphics**, **5 references** and **2 external/native**. Counts for pending replacements, unclassified, forbidden, stale and invalid findings are all **zero**. The 30 protected product-photo and evidence paths match their baseline SHA-256 values. [Preservation check](../../../.tmp/icons/protected-verified.json)

Lint reported 3,083 API warnings and 440 admin warnings, with zero errors. The logs also record Browserslist age, existing jsdom navigation/scroll/XHR warnings where exercised, and Vite’s chunk-size warnings. The full-API harness logs disabled LINE credentials and deliberately provoked KYC race/storage failures. [Local output](../../../.tmp/icons/checks.log) · [Full API output](../../../.tmp/icons/full-api-acceptance.log)


## Production JavaScript

The baseline was captured from the pre-migration built assets at `6a8481e1b`. The final comparison uses each app’s production Vite build and Node gzip for each JS file. The storefront ships its entry and feature code in one JavaScript asset. Admin preserves separate shared and lazy chunks.

| Asset or bundle | Before bytes | After bytes | Δ bytes | Before gzip | After gzip | Δ gzip |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Admin total (443 JS assets) | 12,221,664 | 12,236,271 | +14,607 | 3,257,314 | 3,260,258 | +2,944 |
| Admin entry | 323,176 | 323,668 | +492 | 84,762 | 84,919 | +157 |
| Admin shared icons | 798,284 | 805,124 | +6,840 | 174,378 | 176,033 | +1,655 |
| Admin React vendor | 219,415 | 219,415 | 0 | 69,637 | 69,637 | 0 |
| Admin React Query | 34,368 | 34,368 | 0 | 10,409 | 10,409 | 0 |
| Admin LINE SDK | 120,079 | 120,079 | 0 | 33,322 | 33,322 | 0 |
| Admin contract detail lazy chunk | 140,296 | 140,668 | +372 | 29,991 | 30,005 | +14 |
| Admin signing lazy chunk | 37,816 | 38,155 | +339 | 10,097 | 10,172 | +75 |
| Admin LIFF preferences lazy chunk | 4,939 | 5,150 | +211 | 1,882 | 1,936 | +54 |
| Admin product detail lazy chunk | 102,501 | 102,501 | 0 | 23,783 | 23,782 | -1 |
| Storefront entry and total (one JS asset) | 995,009 | 1,153,664 | +158,655 | 294,819 | 332,914 | +38,095 |

The storefront increase is **38,095 gzip bytes** (12.9%). Its production graph includes 61 Phosphor glyphs, each with its paired definition. The Duotone package’s code and geometry contribute 222,049 bytes at Vite’s rendered-module layer. Admin already used Phosphor in the baseline. Its full increase is **2,944 gzip bytes** (0.09%), with 312 paired glyphs across the application. The Vite graphs contain the included glyph and supporting modules without the Phosphor catalogue entry. [Baseline assets](../../../.tmp/icons/task-1-before-assets-and-candidates.json) · [Admin graph and chunks](../../../.tmp/icons/bundle-after-web.json) · [Storefront graph and chunks](../../../.tmp/icons/bundle-after-web-shop.json)

A single `ShieldCheck` import rendered one semantic export and exactly the ShieldCheck CSR and definition modules in both production fixture builds. The fixture sizes were 24,897 bytes and 9,059 gzip bytes with admin’s Vite 8.0.12, and 24,883 bytes and 9,101 gzip bytes with storefront’s Vite 6.4.2. The app navigation registry and other glyphs are absent from the fixture. [Admin fixture output](../../../.tmp/icons/bundle-web.log) · [Storefront fixture output](../../../.tmp/icons/bundle-web-shop.log)

## Running local previews

| Preview | Running process | Verified response |
| --- | --- | --- |
| [Admin Inbox](http://localhost:5218/inbox) | Manager PID 95577, API PID 95658, Vite PID 95856 | Owned preview of this checkout. Managed browser checks and icon suite completed there. [Preview state](../../../.tmp/icons/admin-preview.json) |
| [Storefront](http://127.0.0.1:5292/) · [Catalogue](http://127.0.0.1:5292/products) | Static server PID 3499 | Root, catalogue and the exact built JavaScript asset returned 200 after the Playwright server stopped. [Preview state](../../../.tmp/icons/storefront-preview.json) |

The managed preview, check report and storefront build use source fingerprint `f0862c556b1de63fa43f9ee8a6d1029c0ac68abbc4dbca2ae4b3e5f2dbc5962e`. The final check completed at 2026-11-23 12:18:16 UTC. The storefront server serves the built, prerendered pages with synthetic initial data. Interactive catalogue/filter, product and installment estimates, promotions, auth, orders, addresses and sell quote/status requests require a storefront API. The Playwright fixture supplies those responses for tested states. Both preview URLs are local.
