# Control size follow-up — 18 October 2026

Follow-up to `control-size-audit-2026-10-18.md`. Request: finish the remaining button-size inconsistencies across the program. All changes remain local; no commit, push, merge or deployment.

## Changes

- Extended the shared screen control scale to public/LIFF routes and portalled dialogs, retaining the document, print, editor and embedded-input exclusions. Ordinary actions and fields have a 2.75rem minimum height (44px at the default 16px root). Icon actions use the same square size. Deliberate large calls to action and multiline actions can grow; link-like controls and calendar/menu items retain their contextual layout.
- Added the shared sizing marker to 43 remaining native action definitions in customer loyalty, product/price/transfer dialogs, stock price management, collections, finance receivables, settings, notification templates, purchase-order steps, payroll, device returns, user invitations, booking cancellation, chat, signature steps, LIFF contracts, other-income adjustments and LINE OA message-type choices. Existing handlers and disabled/permission conditions were preserved.
- Aligned storefront small Buttons and Inputs at 44px, including header actions. Removed catalog filter overrides that reduced their height at desktop breakpoints; dropdown menu-item sizing remains separate.
- Increased public landing navigation and LIFF notification-row targets. Allowed product-card price/action content to wrap. The previously inert landing product-detail button is now a link to the storefront product, or a product search for a placeholder card.
- Fixed an additional verified overflow in the interest-default editor at 320px with a 20px root font: labels and inputs now stack on narrow screens, the header badge can wrap, and desktop input rows retain their width.
- The final unmarked-control measurement found a 39px account dropdown and a 28px residual-adjustment button next to 44px controls on the other-income editor. Both now use the shared field/action scale. Dropdown opening/search and adding the residual as an unsaved form row were checked without submitting the document.
- A follow-up source review of left-aligned custom buttons found the PO compatible-model picker at 40px and LINE OA message-type choices around 39px. Both now use the shared action sizing; the model picker keeps its marker through `PopoverTrigger asChild`, and message types retain left alignment and multiline growth.
- Configured LINE OA at 320px with enlarged text exposed crowded two-column message choices and an overflowing connection-test button. Mobile choices now use one column with less nested padding; the connection-status row wraps and save/test actions stack. Desktop retains two columns. All 18 message-type choices were selected locally in each browser/width case; no send or connection test was invoked.
- UI font selection and document typography are unchanged by this follow-up. No financial calculations or API/auth logic changed.

## Evidence

Artifacts are in `.tmp/control-size-followup-20261018/`. The earlier admin route and Monthly Close matrices remain documented in the preceding report; they are not recounted as new checks here.

| Scope | Verified cases | Evidence |
| --- | ---: | --- |
| Populated admin detail, edit and inspection routes | 21 routes × 1440/390/320px = 63 views | `details-chromium.json` |
| Selected routes under Branch Manager, Finance Manager, Accountant and Sales | 58 navigation cases at 1440/390px, including expected access/legacy redirects | `roles.json` |
| Public and LIFF routes in Chromium | 25 routes × 1440/390/320px = 75 views | `public-chromium-verified.json` |
| Public and LIFF routes in WebKit | 25 routes × 390/320px = 50 views | `public-webkit-verified.json` |
| Storefront route entries in Chromium | 38 entries × 1440/768/390/320px = 152 views | `shop-chromium.json` |
| Storefront route entries in WebKit | 38 entries × 390/320px = 76 views | `shop-webkit.json` |
| Admin dialogs and detail tabs | 8 cases × 4 browser/viewport/font configurations = 32 cases | `dialogs.json` |
| Public/LIFF interactions | 8 cases × Chromium/WebKit at 390px and 320px with enlarged text = 32 cases | `public-interactions.json` |
| Other-income account/adjustment controls | Chromium/WebKit at 1440/390px and 320px with enlarged text = 6 cases | `other-income-controls.json` |
| Custom model picker and LINE message types | Chromium/WebKit at 1440/390px and 320px with enlarged text = 12 cases | `final-custom-controls.json` |

Final matrices above have no measured page horizontal overflow or reported page runtime errors. The interaction matrices also check marked action height and vertical content clipping. The dialog matrix includes product edit/price/transfer, stock price/add-price, loyalty, company edit and interest-default edit. Storefront address dialogs were opened at each tested width.

Public interaction checks exercised unlink confirmation/cancel, appointment time selection/review, simulated OTP entry, simulated notification toggle, consent display, expired payment, landing mobile navigation and the placeholder product-search link. Mutations were intercepted; no SMS, financial transaction or real consent change occurred.

Public/LIFF data were synthetic browser fixtures; invalid tokens and expired invitations intentionally exercise error states. Storefront entries include aliases, not-found/error states and authenticated synthetic account pages, not 38 distinct populated business screens. Role checks cover selected routes, not every role × every page. A denied Branch Manager accounting route and legacy redirects are recorded as navigation cases, not successful rendering of those restricted pages.

Early public scans with a mismatched API prefix, stale-auth dialog attempts and wrong test locators are not used as passing evidence. The consent measurement initially sampled during a style/layout update; waiting for the consent control and a settled frame produced matching dimensions in both engines. The interest-editor overflow was a real layout issue and was fixed before the final matrix.

Read-only code review: PASS, 0 Critical / 0 Warning, including the final responsive interest-editor fix. The reviewer confirmed the sizing annotations and final layout fix preserve handlers and business logic.

Fresh final-source `VITEST_MAX_WORKERS=2 npm run local:check`: **PASS, 39/39 checks**, including TypeScript, lint, **3,597 automated tests** (Web 3,396; Shared 149; Storefront 52), builds and desktop/mobile synthetic workflows. See `local-check-complete.json`, `local-check-complete.log` and `local-check-details.log`. The complete source fingerprint and all frozen source-file hashes match after completion. Earlier interrupted checks and checks invalidated by a later visual fix are not completion evidence.

The follow-up matrices total **556 cases** across routes, viewports and interaction states; this is not a count of unique pages. All recorded final targeted cases pass. `git diff --check` also passes. Git HEAD remains `bb6e864b31b490c3baca77e139216f5c96d01cf2`.

## Limits and preview

Browser phone viewports are simulated. Real iPhone/Android devices, the LINE webview, production data and external providers were not validated. This is visual/control-layout verification plus the repository's local regression suite, not a claim that every possible business state or external integration has been tested.

- Admin preview: <http://localhost:5206/monthly-close?zone=fin>
- Synthetic storefront preview: <http://127.0.0.1:61649/products>

Both previews use local synthetic data. Public/LIFF fixtures used by the audit are request-intercepted in the test browser; opening those routes in an ordinary browser does not reproduce the populated fixture automatically.
