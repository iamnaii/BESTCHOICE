# System-wide Phosphor Duotone Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish consistent Phosphor Duotone UI coverage across BESTCHOICE admin, storefront and customer web screens, with an auditable list of intentional exceptions.

**Architecture:** Extract the proven admin icon adapter into a UI-only workspace, keep app-local re-exports, and migrate remaining consumers. Keep menu identity maps local to the application. Add source and runtime coverage for handwritten, Unicode and dependency-generated icons so completion does not depend on import searches alone.

**Tech Stack:** TypeScript, React, npm workspaces, Phosphor React 2.1.10, Vite, Vitest, Playwright, existing Sonner.

**Spec:** [2026-11-23-system-icons-design.md](../specs/2026-11-23-system-icons-design.md). Read both documents before implementation.

**Status:** Approved for subagent execution on 2026-11-23: “เริ่มทำ แบบ subagent ได้เลย”. Library selection and design are confirmed. Do not interpret this document as a release instruction.

## Global Constraints

- Phosphor Duotone: exact `@phosphor-icons/react: 2.1.10`, `weight: 'duotone'`, `currentColor`.
- Standard glyph sizes: 16px inline/dense status, 20px regular control, 24px menu/large control. Record justified larger illustrations; do not resize every existing component indiscriminately.
- Distinct icon-bearing navigation destinations/groups/selectors have distinct geometry; the same destination and same action retain their icon across surfaces. Existing text-only menus remain text-only.
- Preserve brand identities, user/message content, charts/progress/QR/signatures, legal/PDF templates, URLs, menu labels/order, permissions and all business behavior.
- UI-only package `@installment/icons`; no React dependency or icon import in API/domain `@installment/shared`. Retain admin's direct declared Phosphor dependency for navigation glyph imports.
- Preserve existing photo/evidence work and all unrelated dirty files. Never use `git add .`, reset, stash or overwrite another session's changes.
- No implementation until the proposed design/plan is reviewed. No push, merge or deployment in local verification. Commit instructions below apply only during authorized execution and only to that task's changes.
- Use synthetic fixtures, reserve free ports, do not reuse another checkout's servers or kill by port/name. Leave verified local previews running at handoff.
- The `/stock` Google Apps Script iframe is outside this checkout. Its first-party wrapper is in scope; historical `public/design-preview-*.html` mockups are individually documented reference exceptions.

## Review Focus

1. A forwarded ref, `asChild` trigger, disabled state or focusable icon-only control must still work after adapter extraction — Task 1 compatibility tests and Tasks 2/6 browser interactions.
2. Loading/error/success/close glyphs emitted by Sonner must use shared icons, without changing dismissal or live announcement — Tasks 3/6 toast tests.
3. Emoji in chat content and rich-menu payloads must survive while interface emoji are replaced — Task 3 regression assertions and Task 5 scanner fixtures.
4. Rare/mobile/dark/empty states and first-party static shells must not escape the inventory — Tasks 4/6 route/state matrix and explicit external/reference exceptions.
5. Package extraction must not ship the full glyph catalogue, break clean workspace resolution or skip CI on package-only changes — Tasks 1/5 build and CI checks; Task 6 bundle evidence.

---

### Task 1: Extract the existing icon renderer into a shared UI workspace

**Files**
- Create: `packages/icons/package.json`, `packages/icons/tsconfig.json`, `packages/icons/src/index.ts`, `packages/icons/src/create-icon.ts`, `packages/icons/src/__tests__/icons.test.tsx`, `packages/icons/vitest.config.ts`.
- Modify: `apps/web/package.json`, `apps/web/src/lib/icons/index.ts`, `apps/web/src/lib/icons/create-icon.ts`, `package-lock.json`.
- Retain/test: `apps/web/src/lib/icons/__tests__/icons.test.tsx`, `apps/web/src/config/__tests__/navigation-icons.test.tsx`.
- Create: `docs/superpowers/reports/2026-11-23-system-icons-inventory.md` with the current-state inventory, including the storefront files in Appendix A.

**Interfaces**
- Consumes: current `createAppIcon(Glyph: Icon, name: string): AppIcon`, semantic exports and tests from admin.
- Produces: source ESM exports `@installment/icons` and `@installment/icons/create-icon`; identical `AppIcon`, `AppIconProps` and factory signatures from the spec. App-local import paths continue working.

- [ ] Capture a before baseline: git status/diff, exact candidates, route/state ownership and current built admin/storefront chunk sizes. Record it outside generated bundles; do not treat the photo work as icon-task changes.
- [ ] Add a consumer test that imports the new package and asserts `data-icon-style="duotone"`, `viewBox="0 0 256 256"`, a rendered path, and an opacity layer for a representative duotone glyph. It must fail with unresolved package before extraction.
- [ ] Extract the existing semantic map/factory without changing existing geometry. Set package name/version `@installment/icons`/`1.0.0`, source exports, `type: module`, `sideEffects: false`, React peer `>=18 <20`, exact Phosphor dependency, and `test`/`typecheck` scripts. Do not add a prepare hook. Use root TypeScript/React test tooling; avoid an API/shared dependency.
- [ ] Make admin adapter files thin re-exports and add `@installment/icons: 1.0.0` to admin. Regenerate the lockfile through npm; inspect the diff for unrelated dependency updates. Keep Phosphor declared in admin because `navigation-icons.ts` directly imports glyphs.
- [ ] Run package tests/typecheck, both existing icon suites and admin build. Assertions retain refs, events, accessible names, animation classes, explicit sizes, removed outline props and navigation geometry. A single-icon Vite fixture must not contain unrelated navigation glyphs or a whole-catalogue runtime registry. Resolve package exports through npm rather than a cross-app relative import.
- [ ] Commit only Task 1 hunks with `refactor(icons): share Phosphor renderer across web apps` after validation. Existing uncommitted application changes remain untouched.

### Task 2: Migrate all remaining storefront icons

**Files**
- Create: `apps/web-shop/src/lib/icons.ts`, `apps/web-shop/src/lib/icons.test.tsx`.
- Modify: `packages/icons/src/index.ts`, `apps/web-shop/package.json`, `package-lock.json`, and all **48 exact source files in Appendix A**.
- Test: existing `apps/web-shop/src/components/ui/native-select.test.tsx`, storefront tests and gallery/sell/account browser tests.

**Interfaces**
- Consumes: shared factory/semantic exports from Task 1.
- Produces: storefront `@/lib/icons` adapter; all storefront icon type consumers use `AppIcon`, not `LucideIcon`.

- [ ] Add tests importing BadgeCheck, BatteryCharging, Compass, Expand, Share2, FacebookLogo and TiktokLogo from the storefront adapter. Before implementation, expect missing export/module failures. Assert correct geometry, duotone style, size and accessible consumer labels.
- [ ] Add spec mappings: BadgeCheck→SealCheck, BatteryCharging→BatteryCharging, Compass→Compass, Expand→ArrowsOut, Share2→ShareNetwork. Add named brand glyphs FacebookLogo/TiktokLogo for footer links. Resolve per-glyph imports against installed 2.1.10 files; never substitute a generic fallback silently.
- [ ] Replace all 48 imports with `@/lib/icons`, change `LucideIcon` types to `AppIcon`, and change footer Facebook/Music2 usages to the named brand exports. Preserve hrefs, aria labels, selected/disabled state and interactions. Add the shared dependency and remove storefront `lucide-react` only after consumers are migrated.
- [ ] Run `npm run test --workspace=@installment/web-shop` and `npm run build --workspace=@installment/web-shop`. Verify the source audit reports zero Lucide imports/re-exports/requires in both apps. Inspect Radix close, native select leading icon, spinner and gallery controls rather than assuming prop compatibility.
- [ ] Commit only Task 2 changes with `feat(storefront): use shared Phosphor Duotone icons`.

### Task 3: Finish admin/customer status icons and dependency-generated icons

**Files**
- Modify known candidates: `apps/web/src/components/layout/TestModeBanner.tsx`, `apps/web/src/pages/TradeInPage/components/ValuationsTab.tsx`, `apps/web/src/pages/ExpenseDetailPage.tsx`, `apps/web/src/pages/canned-response-admin/QuickReplyEditor.tsx`, `apps/web/src/components/accounting/ReverseConfirmDialog.tsx`, `apps/web/src/pages/liff/LiffNotificationSettings.tsx`, `apps/web/src/pages/UnifiedInboxPage/components/ChatMediaPicker.tsx`, `apps/web/src/pages/ContractDetailPage.tsx` where visual status marks are present.
- Modify: `apps/web/src/components/ui/sonner.tsx`, `apps/web-shop/src/main.tsx`.
- Create: `apps/web-shop/src/components/ui/sonner.tsx`, `apps/web/src/components/ui/sonner.test.tsx`, `apps/web-shop/src/components/ui/sonner.test.tsx`.
- Update exact additional UI candidates discovered in Task 1's inventory; record their paths before editing. No blanket Unicode replacement.

**Interfaces**
- Consumes: shared semantic icons. Status configuration becomes `{ label: string; icon: AppIcon; ...existingFields }` where required; labels exclude decorative emoji.
- Produces: consistent first-party status/control UI and application-owned Toaster wrappers supplying six Sonner slots.

- [ ] Add behavioral assertions for plain Thai status labels with decorative SVG, preserved toast dismissal/announcements, all six toast slots and unchanged emoji picker/message text values. Run focused tests and confirm the new icon assertions fail on current emoji/default-Sonner rendering.
- [ ] Replace visual warning marks with AlertTriangle, draft with PencilLine, waiting with Clock, approved with CheckCircle2, accrual with BookOpen and reversed with RotateCcw. These exports exist in the current adapter. Keep each existing status label and business state intact.
- [ ] Map LIFF notification payment/overdue/receipt categories to Wallet/AlertTriangle/Receipt. Replace the sticker tab's decorative package emoji only; do not alter selectable emoji, sticker payloads, rich-menu message labels or chat previews.
- [ ] Supply Sonner `success`, `info`, `warning`, `error`, `loading`, `close` icons as CheckCircle2, Info, AlertTriangle, CircleX, Loader2 with animation, and X through each app wrapper. Keep theme, position, colors, actions, close-button labels and live regions. Inspect installed prop declarations before changing caller overrides; do not upgrade Sonner for this task.
- [ ] Run focused tests, admin/storefront typechecks and inspect customer/mobile status pages using synthetic fixtures. Inventory any library-generated control that cannot be configured as a narrow exception with the exact component/version and reason.
- [ ] Commit only Task 3 changes with `feat(icons): unify status and notification glyphs`.

### Task 4: Verify navigation identity and finish the route/state inventory

**Files**
- Test/modify if needed: `apps/web/src/config/navigation-icons.ts`, `apps/web/src/config/__tests__/navigation-icons.test.tsx`, `apps/web/src/config/menu.ts`, `apps/web/src/config/settings-registry.ts`.
- Review: `apps/web-shop/src/components/layout/ShopHeader.tsx`, `ShopFooter.tsx` in the same directory, `apps/web-shop/src/pages/account/AccountPage.tsx`.
- Update: `docs/superpowers/reports/2026-11-23-system-icons-inventory.md`.

**Interfaces**
- Consumes: admin MENU_ICONS/MENU_GROUP_ICONS/WORK_ZONE_ICONS and actual storefront icon-bearing destinations.
- Produces: destination-to-geometry coverage for every existing icon-bearing navigation surface, plus exact route/state verification matrix. Text-only links remain unchanged.

- [ ] Re-run the geometry test for all six roles and SHOP/FINANCE/settings. Add assertions only for any uncovered actual icon-bearing navigation destinations; a duplicate fixture must make the test fail. Group/selectors and destination aliases retain the existing policy.
- [ ] Inspect repeated storefront destinations and identify navigation versus action glyphs explicitly. Keep identical search/close/contact actions consistent. If separate storefront destinations actually share an icon, select a distinct semantic glyph and record it; do not add icons to plain header/footer links.
- [ ] Classify static assets: production `/stock` shell, public privacy/terms pages, all five historical design previews, product illustrations, CSS/image glyphs and external/native controls. Link each reviewed exception to its exact file/context. Source coverage includes all routes; runtime coverage names actual pages/states rather than claiming all routes from shared components.
- [ ] Mark inventory rows migrated or reviewed exception after their evidence exists. No unknown entries. Run menu/settings tests and a diff of labels/paths/roles to confirm this task did not alter navigation behavior.
- [ ] Commit only Task 4 changes with `test(icons): cover navigation identity and remaining surfaces`.

### Task 5: Add a regression guard and wire local/CI checks

**Files**
- Create: `tools/check-icons.mjs`, `tools/check-icons.test.mjs`, `tools/icon-exceptions.json`, `.github/workflows/icons.yml`.
- Modify: root `package.json`, `tools/local-check.mjs`.
- Review clean installation inputs: `Dockerfile`, `Dockerfile.web` (both already copy `packages/`; edit only if verification proves it necessary).

**Interfaces**
- `scanIconUsage(root: string): Promise<IconFinding[]>`; finding `{ path, kind, context }`, with kind `legacy-import | direct-phosphor | inline-svg | unicode-symbol | image-or-css-icon`.
- Exception schema `{ path: string, kind: string, context: string, reason: string, category: 'brand' | 'content' | 'graphic' | 'reference' | 'external-native' }[]`. Match exact normalized syntax context, not line numbers or whole-directory globs.
- CLI `node tools/check-icons.mjs` emits counts/unclassified findings and returns nonzero for forbidden imports, unclassified candidates or stale exceptions. It never edits source. Root script: `check:icons`.

- [ ] Write scanner tests with inline source fixtures: alias/re-export/dynamic/require legacy imports fail; central permitted Phosphor imports pass; comments do not become UI; JSX warning/✓/arrow text is detected; user-content exception requires exact context/reason; inline SVG/chart and CSS/image candidates are classified; stale/broad exception fails. Verify expected failure before implementing the scanner.
- [ ] Implement scanning with the installed TypeScript AST for TS/TSX and explicit HTML/CSS/image candidate enumeration. Use Unicode Extended_Pictographic plus the standalone status/arrows found in the inventory, not a global replacement. Scan both web src roots and first-party public HTML/CSS; ignore generated dist/node_modules and document their exclusion. Keep a small explicit allowlist for package implementation and admin navigation glyph imports.
- [ ] Populate only reviewed exceptions from the inventory. The human report keeps migrated history; the machine manifest contains current exceptions only. Reject legacy library imports even inside an exception category. Run `node --test tools/check-icons.test.mjs` then `npm run check:icons`; expect PASS with zero unclassified candidates.
- [ ] Add the scanner and shared-package tests/typecheck to `local:check`. Create a non-deploying Node 24 CI workflow that runs on changes to either web app, `packages/icons/**`, icon tools, root manifest/lockfile and itself. CI runs scanner/tests and both app icon consumer suites; package-only edits must trigger it.
- [ ] Validate a clean npm workspace install in an isolated checkout/temp copy using the existing lockfile, then builds for both apps. Do not delete the active checkout's node_modules. Verify no API dependency on `@installment/icons` and no install lifecycle hook requiring app files. Commit Task 5 only with `test(icons): guard full-system icon consistency`.

### Task 6: Browser acceptance, bundle check and local handoff

**Files**
- Create: `apps/web-shop/e2e/icons.spec.ts`, `apps/web-shop/e2e/icons.config.ts`, `apps/web/e2e/icons.spec.ts`, `docs/superpowers/reports/2026-11-23-system-icons-verification.md`.
- Reuse: `apps/web-shop/e2e/fixtures/shop-api.ts`, `sell-api.ts`, `static-server.mjs`; existing admin e2e auth/fixture patterns.
- Update: inventory evidence links and verification status. Store screenshots/traces/generated audit output under `.tmp/icons/` rather than committing fixtures containing customer data.

**Interfaces**
- Storefront config uses `ICON_E2E_PORT` (default 5289, change if occupied), `reuseExistingServer: false`, built/prerendered `dist` served by the existing static fixture server. All APIs are synthetic and unmatched fixture requests fail.
- Admin uses the changed checkout's managed preview where supported and existing LIFF/session API fixtures for appearance-only checks on unsupported customer routes. Block service workers and assert the intended state explicitly. Use the isolated full-API harness if an actual backend behavior question arises; this icon migration changes no backend. Never point at production or claim mocks verify authorization.

- [ ] Add/browser-run assertions at 390px and 1440px: storefront home/catalog/filter/product gallery/zoom/360/sell/account/auth/404; admin SHOP/FINANCE/settings menus, edit/delete/dialog/status controls, customer LIFF notification settings and contract evidence controls. Use 320px as a focused header/dialog overflow check. Exercise light/dark where the application supports it and default/loading/error/empty/disabled/selected states where applicable.
- [ ] Visit built storefront `/stock` with the Google Apps Script iframe request blocked/stubbed. Assert the first-party loading shell, BESTCHOICE logo, contact links and iframe title remain intact at both widths; report that the external frame's contents were not tested or migrated. Do not make requests to the live Apps Script service during this check.
- [ ] Trigger success/info/warning/error/loading/dismissible toasts in each app and inspect all six actual DOM glyphs. Check icon-only accessible names, keyboard activation/focus, reduced-motion behavior, no horizontal overflow and mobile primary touch targets. Compare social-link hrefs and payment/form actions to the before baseline.
- [ ] Run/store results: package tests/typecheck; scanner; focused admin navigation/renderer tests; storefront tests; storefront build/prerender and icon browser suite; relevant existing sell/gallery flows. Compare before/after entry/shared/lazy chunk sizes and a one-icon fixture: no full-catalogue registry or unrelated glyph set. Investigate unexplained growth before marking pass.
- [ ] Run `NODE_OPTIONS=--max-old-space-size=8192 npm run local:check` after the final code edit. Require PASS and a current source fingerprint. Run the storefront browser suite separately because managed admin checks do not cover it. Run explicit fixture-backed appearance checks for remaining admin/LIFF surfaces; record actual API versus fixture-only coverage and any unavailable surface explicitly.
- [ ] Request final code review of package boundaries, brand/content exceptions, menu identity and runtime coverage. Fix actionable findings, rerun affected checks and final local check when source changes. Commit only remaining icon-task files with `test(icons): verify storefront and admin coverage`.
- [ ] After Playwright stops its managed webServer, start a separate owned storefront preview from this checkout on a verified free port and keep it running. Use the fixture-backed audit harness for customer/account states; document public routes that need an API. Verify its root/catalog response and record URL/PID. Keep the managed admin preview running as well.
- [ ] Hand off actual running local URLs, before/after evidence, zero-pending inventory counts, test/build results and fixture/external limitations. Do not deploy automatically. If a later release is authorized, follow the release workflow and verify deployed assets/representative pages separately; local PASS is not deployment evidence.

## Execution recommendation

**Selected by owner: Subagent-driven execution.** Use a fresh implementer and independent task review for each task, then a broad final review. No additional decision about the icon library or confirmed menu requirements is needed.

## Self-review

- Spec coverage maps to Tasks 1–6: shared style, storefront migration, residual UI/dependency icons, navigation/exceptions, regression guard, runtime/build handoff.
- The five Review Focus items each have explicit assertions in their owning task.
- No backend schema, PDF/customer document, payment calculation or release action is introduced.
- Inventory counts are the inspected baseline, not a hardcoded completion target; execution rescans and accounts for newly discovered candidates.
- Design review resolved hidden Sonner glyphs, text-only navigation scope, static mockups and the external stock iframe boundary before implementation.

## Appendix A: Exact storefront Lucide consumer files at planning time

Generated by inspecting current source imports on 2026-11-23. All 48 files are Task 2 migration inputs; the one story is included so examples do not reintroduce old imports.

- `apps/web-shop/src/components/InstallmentCalculatorCard.tsx`
- `apps/web-shop/src/components/catalog/Breadcrumb.tsx`
- `apps/web-shop/src/components/catalog/CatalogResults.tsx`
- `apps/web-shop/src/components/catalog/FilterSidebar.tsx`
- `apps/web-shop/src/components/catalog/GalleryImage.tsx`
- `apps/web-shop/src/components/catalog/ImageLightbox.tsx`
- `apps/web-shop/src/components/catalog/Product360Viewer.tsx`
- `apps/web-shop/src/components/catalog/ProductGallery.tsx`
- `apps/web-shop/src/components/hero/CategoryHero.tsx`
- `apps/web-shop/src/components/hero/HomeHero.tsx`
- `apps/web-shop/src/components/hero/PhoneShowcase.tsx`
- `apps/web-shop/src/components/layout/FloatingLineButton.tsx`
- `apps/web-shop/src/components/layout/ShopFooter.tsx`
- `apps/web-shop/src/components/layout/ShopHeader.tsx`
- `apps/web-shop/src/components/shop/FaqAccordion.tsx`
- `apps/web-shop/src/components/shop/PromotionsStrip.tsx`
- `apps/web-shop/src/components/shop/TrustStrip.tsx`
- `apps/web-shop/src/components/states/ErrorState.tsx`
- `apps/web-shop/src/components/ui/Stepper.tsx`
- `apps/web-shop/src/components/ui/button.tsx`
- `apps/web-shop/src/components/ui/dialog.tsx`
- `apps/web-shop/src/components/ui/native-select.tsx`
- `apps/web-shop/src/pages/AboutPage.tsx`
- `apps/web-shop/src/pages/CatalogPage.tsx`
- `apps/web-shop/src/pages/ContactPage.tsx`
- `apps/web-shop/src/pages/HomePage.tsx`
- `apps/web-shop/src/pages/HowItWorksPage.tsx`
- `apps/web-shop/src/pages/InstallmentTermsPage.tsx`
- `apps/web-shop/src/pages/NotFoundPage.tsx`
- `apps/web-shop/src/pages/OrdersPage.tsx`
- `apps/web-shop/src/pages/ProductDetailPage.tsx`
- `apps/web-shop/src/pages/PromotionsPage.tsx`
- `apps/web-shop/src/pages/ReturnsPage.tsx`
- `apps/web-shop/src/pages/ShippingPage.tsx`
- `apps/web-shop/src/pages/account/AccountPage.tsx`
- `apps/web-shop/src/pages/account/AddressBookPage.tsx`
- `apps/web-shop/src/pages/auth/LineCallbackPage.tsx`
- `apps/web-shop/src/pages/auth/LoginPage.tsx`
- `apps/web-shop/src/pages/landing/InstallmentLopburiPage.tsx`
- `apps/web-shop/src/pages/landing/NoCreditCardPage.tsx`
- `apps/web-shop/src/pages/landing/UsedIphoneLopburiPage.tsx`
- `apps/web-shop/src/pages/sell/SellLandingPage.tsx`
- `apps/web-shop/src/pages/sell/SellStatusPage.tsx`
- `apps/web-shop/src/pages/sell/components/ChoiceButton.tsx`
- `apps/web-shop/src/pages/sell/components/QuoteResultStep.tsx`
- `apps/web-shop/src/pages/sell/components/SellContactLinks.tsx`
- `apps/web-shop/src/pages/sell/components/SellFlowLayout.tsx`
- `apps/web-shop/src/stories/button.story.tsx`
