# System icon verification

Final local acceptance for the BESTCHOICE Phosphor Duotone migration on 2026-11-23. The [inventory](2026-11-23-system-icons-inventory.md) records every source migration and reviewed exception.

## Final review fixes

Chromium now excludes decorative SVGs from its accessibility tree. The home page’s account and search controls keep their Thai names, keyboard search opens and focuses the input, and the storefront sell progress indicator exposes completed and current steps. The isolated admin contract page retains its named signing status. The document browser test now requires the downloaded image to decode at both widths. [Before](../../../.tmp/icons/final-fix/ax-red.json) · [After](../../../.tmp/icons/final-fix/ax-green.json) · [Document browser run](../../../.tmp/icons/final-fix/api-final.log)

Both literal Thai add captions now fail the icon guard when reintroduced. The storefront honors the legacy Sonner loading icon, the sell fixture checks unmatched requests after the fallback page, the admin browser suite requires a current preview fingerprint, and both CI event filters include shared icon tooling. [Regression tests](../../../.tmp/icons/final-fix/green-scanner.log) · [Sonner checks](../../../.tmp/icons/final-fix/green-shop.log) · [Full fix evidence](../../../.tmp/icons/final-fix/report.md)

## Browser acceptance

| Coverage | Checks | Evidence |
| --- | --- | --- |
| Storefront home, catalogue and filters | Chromium at 390 and 1440 px. Brand logo, social destinations, keyboard menu/search, price selection, filter dialog, loading, empty, error and retry. | [Browser results](../../../.tmp/icons/final-fix/storefront.log) |
| Storefront product | 390 and 1440 px. Keyboard gallery navigation, selected thumbnail, mouse-drag frame change, zoom/reset controls, dismiss, and disabled one-image controls. | [Gallery screenshots](../../../.tmp/icons/final-fix/storefront/) |
| Storefront account, sell and fallback | 390 and 1440 px. Synthetic customer session, address form request and success toast, logout and LINE sign-in control, sell model selection and unknown-route fallback. Header and address dialog bounds at 320 px. | [Storefront screenshots](../../../.tmp/icons/final-fix/storefront/) |
| Storefront `/stock` | Built canonical path at 390 and 1440 px. First-party loading shell with 56 px BESTCHOICE logo, phone and LINE destinations, and iframe title. Chromium fulfilled the Apps Script request locally. | [Stock screenshots](../../../.tmp/icons/final-fix/storefront/) |
| Admin work and settings navigation | 390 and 1440 px in light and dark. Distinct SHOP, FINANCE and settings geometry and selected state. Mounted managed preview returned actual SHOP-home and scoped FINANCE-portfolio responses. | [Admin results](../../../.tmp/icons/final-fix/admin.log) · [Settled menus](../../../.tmp/icons/final-fix/admin-settled/) |
| Admin reverse reasons and signing | 390 and 1440 px. Add, edit and delete glyphs, switch state, edit and confirmation dialogs with synthetic settings data. Signing showed KYC, PDPA, acknowledgement-disabled action, completed step names and company signer state with synthetic contract responses. | [Admin screenshots](../../../.tmp/icons/final-fix/admin/) |
| Admin LIFF notification preferences | 390 and 1440 px in light and dark. Wallet, warning, receipt, contract/profile links, disabled pending controls, request payload, success, failure and keyboard toast dismissal with a synthetic LINE session and synthetic preferences API. At 320 px the failure illustration is 48 px and centered above its heading. | [LIFF screenshots](../../../.tmp/icons/final-fix/admin/) |
| Real contract evidence and staff signing API | Disposable AppModule, PostgreSQL and local file storage. Chromium decoded the synthetic 1 × 1 PNG from the protected content response as a blob at 390 and 1440 px, checked status/view/delete glyphs, keyboard focus return and canceled deletion. Signing status, preview and signature list returned 200. Credentialless LIFF GET and POST returned 401. | [Full API runtime results](../../../.tmp/icons/final-fix/api-final.log) · [Evidence screenshots](../../../.tmp/icons/final-fix/api-final/icons-browser/) · [Browser decode results](../../../.tmp/icons/final-fix/api-final/browser-blob-decoded.jsonl) |
| All six Sonner slots | Separate Vite-built fixtures import the real wrappers and each app’s Sonner version. Success, info, warning, error, loading and close glyphs were checked in actual DOM. The spinner runs with no motion preference and stops under reduced motion. Keyboard dismissal verifies the close name and removes only the target toast. | [Toaster results](../../../.tmp/icons/final-fix/toasts.log) · [Screenshots](../../../.tmp/icons/final-fix/toasts/) |

The [pre-review screenshots](../../../.tmp/icons/screenshots/) include the final storefront and admin behavior. The settled menu captures check the entire sidebar bounds and wait for the page fade to finish. Opening-animation frames are retained separately. [Capture results](../../../.tmp/icons/final-fix/admin-settled.log) · [Open-transition frames](../../../.tmp/icons/admin-current/)

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
| `NODE_OPTIONS=--max-old-space-size=8192 npm run local:check` | **PASS**, 48 recorded checks. Includes 17 scanner fixtures, the inventory guard, shared icon renderer test and types, API and frontend types, lint, 5,364 admin tests, 397 shared tests, 139 storefront tests, both Vite builds and managed browser checks. [Check summary](../../../.tmp/icons/final-fix/check.json) · [Full output](../../../.tmp/icons/final-fix/checks.log) |
| `npm run test --workspace=apps/web -- <focused navigation, renderer, receiving and payment specs>` | 60 passed in eight files. [Focused output](../../../.tmp/icons/final-fix/admin-focused.log) |
| `npx playwright test -c tools/icons/toasts.config.mts` | Six viewport/theme combinations passed. Two storefront dark configurations skipped because the storefront uses the light theme. [Output](../../../.tmp/icons/final-fix/toasts.log) |
| `cd apps/web-shop && CI=1 npx playwright test e2e/catalog-origin.spec.ts` | Four passed. [Output](../../../.tmp/icons/final-fix/catalog.log) |
| `cd apps/web-shop && SELL_E2E_PORT=5186 npx playwright test -c e2e/sell-round3.config.ts` | 32 passed, including actual synthetic submit payloads, retries, expiry, enlarged text, keyboard and reduced-motion cases. [Output](../../../.tmp/icons/final-fix/sell.log) |
| `bash tools/docs-integration.sh --runInBand --runTestsByPath e2e/documents/{icons.browser,contract-pdpa,kyc-evidence}.docs-spec.ts` | 20 passed and 10 PDF artifacts verified on disposable PostgreSQL. The local command uses the isolated-module Jest transform documented in the task record. [Output](../../../.tmp/icons/final-fix/api-final.log) |
| `npm run build:prerender --workspace=apps/web-shop`, routed to the synthetic prerender fixture | 13 routes plus the SPA shell, with zero unmatched API requests. [Build and prerender output](../../../.tmp/icons/final-fix/prerender.log) |
| `npx playwright test -c e2e/icons.config.ts` in each app directory | 15 storefront and 13 admin cases passed. [Built storefront output](../../../.tmp/icons/final-fix/storefront.log) · [Managed admin output](../../../.tmp/icons/final-fix/admin.log) |

The scanner classified **399 approved exceptions**, including **41 brand**, **303 content**, **48 graphics**, **5 references** and **2 external/native**. Counts for pending replacements, unclassified, forbidden, stale and invalid findings are all **zero**. The 30 protected product-photo and evidence paths match their baseline SHA-256 values. [Preservation check](../../../.tmp/icons/protected-verified.json)

Lint reported 3,083 API warnings and 440 admin warnings, with zero errors. The logs also record Browserslist age, existing jsdom navigation/scroll/XHR warnings where exercised, and Vite’s chunk-size warnings. The full-API harness logs disabled LINE credentials and deliberately provoked KYC race/storage failures. [Local output](../../../.tmp/icons/final-fix/checks.log) · [Full API output](../../../.tmp/icons/final-fix/api-final.log)


## Production JavaScript

The earlier Task 6 build measurements and browser evidence are retained for comparison. [Pre-review bundle table](../../../.tmp/icons/bundle-comparison.md) · [Pre-review check](../../../.tmp/icons/check.json)

The baseline was captured from the pre-migration built assets at `6a8481e1b`. The final comparison uses each app’s production Vite build and Node gzip for each JS file. The storefront ships its entry and feature code in one JavaScript asset. Admin preserves separate shared and lazy chunks.

| Asset or bundle | Before bytes | After bytes | Δ bytes | Before gzip | After gzip | Δ gzip |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Admin total (443 JS assets) | 12,221,664 | 12,236,498 | +14,834 | 3,257,314 | 3,260,406 | +3,092 |
| Admin entry | 323,176 | 323,668 | +492 | 84,762 | 84,888 | +126 |
| Admin shared icons | 798,284 | 805,351 | +7,067 | 174,378 | 176,214 | +1,836 |
| Admin React vendor | 219,415 | 219,415 | 0 | 69,637 | 69,637 | 0 |
| Admin React Query | 34,368 | 34,368 | 0 | 10,409 | 10,409 | 0 |
| Admin LINE SDK | 120,079 | 120,079 | 0 | 33,322 | 33,322 | 0 |
| Admin contract detail lazy chunk | 140,296 | 140,668 | +372 | 29,991 | 30,007 | +16 |
| Admin signing lazy chunk | 37,816 | 38,155 | +339 | 10,097 | 10,175 | +78 |
| Admin LIFF preferences lazy chunk | 4,939 | 5,150 | +211 | 1,882 | 1,936 | +54 |
| Admin product detail lazy chunk | 102,501 | 102,501 | 0 | 23,783 | 23,781 | -2 |
| Storefront entry and total (one JS asset) | 995,009 | 1,154,088 | +159,079 | 294,819 | 333,102 | +38,283 |

The storefront increase is **38,283 gzip bytes** (13.0%). Its production graph includes 61 Phosphor glyphs, each with its paired definition. The Duotone package’s code and geometry contribute 222,049 bytes at Vite’s rendered-module layer. Admin already used Phosphor in the baseline. Its full increase is **3,092 gzip bytes** (0.09%), with 312 paired glyphs across the application. The Vite graphs contain the included glyph and supporting modules without the Phosphor catalogue entry. [Baseline assets](../../../.tmp/icons/task-1-before-assets-and-candidates.json) · [Admin graph and chunks](../../../.tmp/icons/final-fix/bundle-after-web.json) · [Storefront graph and chunks](../../../.tmp/icons/final-fix/bundle-after-web-shop.json)

A single `ShieldCheck` import rendered one semantic export and exactly the ShieldCheck CSR and definition modules in both production fixture builds. The fixture sizes were 25,124 bytes and 9,172 gzip bytes with admin’s Vite 8.0.12, and 25,110 bytes and 9,222 gzip bytes with storefront’s Vite 6.4.2. The app navigation registry and other glyphs are absent from the fixture. [Admin fixture output](../../../.tmp/icons/final-fix/bundle-web.log) · [Storefront fixture output](../../../.tmp/icons/final-fix/bundle-web-shop.log)

## Running local previews

| Preview | Running process | Verified response |
| --- | --- | --- |
| [Admin Inbox](http://localhost:5218/inbox) | Manager PID 30892, API PID 30971, Vite PID 31149 | Owned preview of this checkout. Managed browser checks and icon suite completed there. [Preview state](../../../.tmp/icons/final-fix/previews.json) |
| [Interactive storefront](http://127.0.0.1:5293/) · [Catalogue](http://127.0.0.1:5293/products) · [Example product](http://127.0.0.1:5293/products/phone-1) | Fixture proxy PID 36540, static upstream PID 36468 on 5292 | Fresh Chromium hydrated the homepage, loaded six catalogue products, filtered to four used models, and opened the iPhone 15 detail with its local image at 390 and 1440 px. Each viewport recorded 16 local API responses at HTTP 200 and zero external requests or browser errors. [Browser results](../../../.tmp/icons/final-fix/public-preview-browser/responses.json) · [Screenshots](../../../.tmp/icons/final-fix/public-preview-browser/) · [Preview state](../../../.tmp/icons/public-storefront-preview.json) |

The managed preview, check report and storefront build use source fingerprint `c4766a206a10e0a83a98d2c4371891ef1bb49d0c24b77e4c692780dcf66bf919`. The final check completed at 2026-11-23 13:04:21 UTC.

The standalone static origin on port 5292 serves the prerendered pages and built assets. In a fresh browser its catalogue and product API requests returned 404 after hydration. The loopback proxy on 5293 serves identical HTML and JavaScript from that static origin and supplies read-only synthetic storefront responses using the existing test fixture. The browser check used regular HTTP requests without Playwright routing. The proxy blocks third-party subresources and embeds, including the live Maps and Apps Script frames. [Static-only browser results](../../../.tmp/icons/static-preview-browser/responses.json) · [HTTP byte and fixture checks](../../../.tmp/icons/final-fix/previews.json) · [Frame blocking check](../../../.tmp/icons/final-fix/frame-policy.log)

Interactive catalogue and product data, promotions, and illustrative installment values use synthetic records. Customer account, signed-in orders and addresses are exercised through the separate Playwright audit fixtures. Live sign-in, payments and sell submissions require the storefront backend. The public preview disables sign-in and rejects transaction writes. [Fixture proxy source](../../../.tmp/icons/serve-public-storefront.mjs)


## Final review disposition

The independent whole-branch review and one scoped fix review completed. Decorative icon accessibility, completed/current step announcements, original leading-plus action regressions, preview freshness, request coverage, blob decoding, loading-icon overrides and both CI path filters are covered by the final evidence above. No current implementation blocker remains.

One **Minor scanner limitation** is retained explicitly: a formula caption split into JSX nodes, such as `<button>ยอดสุทธิ = <strong>เงินต้น</strong> + ดอกเบี้ย</button>`, can produce a candidate for its last `+ ดอกเบี้ย` fragment. The two original add-action cases are correctly detected and the current source scan has 399 approved entries with zero violations. A future legitimate formula may need an exact, reviewed content exception; the scanner never rewrites content. This is a future false-positive cost, not a current UI or data defect.

The complete decision record, including this disposition and its cost, is in [the decision audit](2026-11-23-system-icons-decisions.md). The scoped review was accepted with that documented Minor limitation; this does not assert that every possible static or runtime expression can be classified automatically.
