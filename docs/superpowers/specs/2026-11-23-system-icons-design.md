# Complete Phosphor Duotone coverage — proposed design

Date: 2026-11-23 (Asia/Bangkok). Status: approved for implementation by the owner: “เริ่มทำ แบบ subagent ได้เลย”. Execution uses task-scoped subagents and independent reviews; release is not included.

## Intent and confirmed requirements

The owner selected **Phosphor Duotone** and requested consistent icons throughout the system, with distinct icons for different menus. SHOP and FINANCE retain their existing destinations, labels, permissions and behavior. This follow-up closes the gaps found after the first migration; it is not another menu redesign.

Acceptance means a complete, reviewable inventory rather than a claim that a few screenshots represent every page. A repeated action (search, edit, delete, close) retains the same semantic icon across pages. Different navigation destinations have distinct geometry; the same destination keeps its icon across sidebar, mobile navigation and settings. This interpretation preserves the owner's per-menu uniqueness requirement without making familiar controls unpredictable.

Existing text-only menus remain text-only, including storefront header and footer link lists. Do not add decorative icons to every text link. Per-destination uniqueness applies to navigation surfaces that actually display icons; icon-only action links are classified by purpose, not blindly by URL.

## Evidence from the checkout

- Admin `apps/web/src/lib/icons/create-icon.ts` already enforces `weight: 'duotone'`, retains refs/accessibility/events and removes incompatible outline props.
- `apps/web/src/config/navigation-icons.ts` maps destinations, groups and SHOP/FINANCE selectors. Its existing tests compare rendered geometry across all entries and check coverage for six roles.
- The two existing icon suites passed **14 tests** on 2026-11-23. This proves renderer/mapping behavior, not visual inspection of every route.
- `apps/web-shop/src` still contains **48 Lucide import files** (including one story) and **61 imported names**, one of which is the `LucideIcon` type. Migration must preserve all consumer props.
- Eight names are absent from the admin adapter: `BadgeCheck`, `BatteryCharging`, `Compass`, `Expand`, `Facebook`, `Music2`, `Share2`, `LucideIcon`.
- UI emoji remain in admin/customer screens, including `TestModeBanner`, `ValuationsTab`, `ExpenseDetailPage`, `QuickReplyEditor`, `ReverseConfirmDialog`, `LiffNotificationSettings` and the sticker-tab label in `ChatMediaPicker`. This is a seed list, not a complete inventory.
- Handwritten SVG in `SystemStatusPage`, `LiffContract` and `ui/progress` represents charts/progress, not legacy icons.
- `apps/card-reader` is a local service without a rendered application UI. CLI/log symbols are not UI icons.
- `packages/shared` contains API-used domain utilities. Adding React/icon dependencies there would cross an unnecessary boundary.
- Both Dockerfiles copy `packages/` before npm install. A new package must therefore be install-safe without a prepare/build hook requiring absent app files.

## Approaches

1. **Recommended engineering choice: shared UI-only icons package.** Extract the existing renderer and semantic exports into `packages/icons`; keep app-local adapters. Navigation mappings remain owned by admin. Both apps use the same treatment and version, and coverage checks prevent drift. Adds one small workspace, with no API dependency.
2. **Separate adapters in each app.** Slightly smaller initial change, but duplicates mappings and makes future style divergence more likely. Rejected for the owner's whole-system consistency goal.
3. **Direct Phosphor imports throughout every page.** Avoids an adapter but scatters weights, prop handling and glyph decisions across hundreds of consumers. Rejected because consistency would depend on individual authors.

This technical choice is the assistant's proposal, not a newly expressed user preference.

## Scope and boundaries

In scope: all first-party web UI in `apps/web/src` (SHOP, FINANCE, settings, dialogs, statuses, empty/error/loading states, LIFF/customer/signing screens) and `apps/web-shop/src` (public pages, catalogue/gallery, sell flow, account/auth, components, stories). Tests, local preview, build and CI checks must cover the shared package.

Also inventory shipped first-party static UI and library-rendered controls. Configure Sonner success/info/warning/error/loading/close slots in both apps through the shared renderer; inspect other configurable library glyphs in the runtime audit. Browser-native widgets and non-configurable third-party controls require a specific exception, not a claim that their glyphs were migrated. The installed Sonner declarations expose all six icon slots; no dependency upgrade is needed for this.

`apps/web-shop/public/stock/index.html` is a production shell: inventory and verify its loading UI (currently a brand logo). Its Google Apps Script iframe is externally hosted and outside this checkout; record the boundary and do not claim that embedded UI was migrated. The five `apps/web/public/design-preview-*.html` files are historical mockups, explicitly excluded from application UI migration and individually recorded as reviewed reference assets. Public privacy/terms pages and CSS/image-based icons must still be audited. No archived file is silently treated as active application coverage.

Classify every discovered use into one of these categories:

| Category | Treatment |
|---|---|
| Navigation/control/status/decoration that communicates UI meaning | Phosphor Duotone through the shared renderer |
| Brand identities (BESTCHOICE, Facebook, TikTok, LINE, payment providers) | Preserve recognizable brand identity; brand exceptions have an explicit named source and reason |
| User content, emoji picker choices, chat previews, canned-message/rich-menu payloads, notification document titles | Preserve content and semantics; do not globally replace emoji in strings |
| Charts, progress rings, QR/barcodes, product artwork, signature drawing, image evidence | Preserve rendering; classify as non-icon graphics |
| Existing legal/PDF templates, generated customer documents and historical records | No document rewrite in this UI migration; record as outside web-UI scope |

No financial calculations, data model, access policy, customer evidence privacy, URLs, menu labels/order, text payload or business action changes. Preserve the uncommitted six-angle/evidence-photo work already present in this checkout. No merge/deploy as part of this plan.

## Architecture and interfaces

Create UI-only workspace `@installment/icons` at `packages/icons`, with source ESM exports, `sideEffects: false`, React as a peer, and exact `@phosphor-icons/react: 2.1.10`. No package `prepare` hook. Use per-glyph Phosphor imports and pure wrapper annotations to preserve tree shaking. Admin retains its direct declared Phosphor dependency because its navigation map imports glyphs; neither API nor domain shared package imports the UI package. Package-only changes must trigger CI and local guards.

Move the current renderer unchanged initially:

```ts
type AppIconProps = SVGProps<SVGSVGElement> & {
  size?: number | string;
  absoluteStrokeWidth?: boolean;
};
type AppIcon = ForwardRefExoticComponent<
  Omit<AppIconProps, 'ref'> & RefAttributes<SVGSVGElement>
>;
createAppIcon(Glyph: Icon, name: string): AppIcon;
```

Expose `@installment/icons` and `@installment/icons/create-icon`; retain `apps/web/src/lib/icons/index.ts` and `create-icon.ts` as thin re-exports. Add `apps/web-shop/src/lib/icons.ts` as a thin re-export. Existing admin import paths remain valid. `navigation-icons.ts` keeps its destination/group maps and uses the shared factory.

Add missing semantic glyphs with explicit mapping: BadgeCheck → SealCheck; BatteryCharging → BatteryCharging; Compass → Compass; Expand → ArrowsOut; Share2 → ShareNetwork. Replace `LucideIcon` type uses with `AppIcon`. In the footer replace Facebook/Music2 usages with named `FacebookLogo`/`TiktokLogo` exports instead of introducing new generic aliases for brand actions; preserve their accessible names and URLs. Existing real brand assets remain unchanged. These brand glyphs may use the common renderer, but brand identity is an allowed exception to unique semantic glyphs.

Regular icons use `currentColor`, the shared duotone treatment and existing explicit dimensions. Standard sizes: 16px inline/dense status, 20px regular control, 24px menu/large control. Keep established larger illustration sizes when classified and recorded. Preserve spinner animation and reduced-motion behavior. Decorative icons are hidden from assistive technology; icon-only controls retain an accessible name. Never remove textual status labels or rely on the faint layer alone for meaning. Interactive controls retain at least 44px touch targets in mobile primary flows; glyph size is independent of target size.

## Inventory and completion accounting

Implementation produces `docs/superpowers/reports/2026-11-23-system-icons-inventory.md` with exact file, symbol/context, category, target glyph or exception reason, migration state, route/state and verification evidence. Scan imports/re-exports/requires, JSX SVG, Unicode UI symbols and image/CSS-based icons; manually classify candidates. Comments, tests, examples and message payloads must not inflate claims about active UI.

Every candidate ends as **migrated** or **reviewed exception**. No unknown/pending entries at completion. Check source coverage for every route; mark routes exercised in a real local API separately from mocked/fixture-only UI. Report unsupported routes instead of claiming full runtime verification.

## Verification and risks

- Preserve the 14 existing icon tests. Add meaningful checks for all exported glyphs, missing storefront mappings, no duplicate navigation geometry, ref/event/accessibility behavior and protection from outline-style props.
- Source guard rejects old icon-library imports and unapproved direct Phosphor imports outside the central package/admin navigation map; rejects unclassified UI-icon candidates. Exception entries need exact paths and stable context/reasons, not blanket directory exemptions.
- Verify storefront and admin desktop/mobile, light/dark where supported, keyboard focus, loading, error, disabled and selected states. Check gallery zoom/360, sell steps, account navigation and contract document controls specifically.
- Use built/prerendered storefront fixtures already available; forbid unmatched fixture requests and report mocks. Reserve an unused port and fail rather than reuse another checkout's server.
- Record before/after JS chunk sizes and inspect a single-icon import fixture so the entire Phosphor catalogue is not pulled into the entry chunk. Exact glyph shape and weight tests must run against the package consumers, not a copied renderer.
- Run `NODE_OPTIONS=--max-old-space-size=8192 npm run local:check`, storefront focused/browser checks and a code review. The managed admin preview alone does not verify the storefront, LIFF or all admin routes.
- Source checks are not proof of visual coverage; screenshots are not proof of import coverage. Require both, with inventory accounting.

## Definition of done

1. No active Lucide/other legacy icon imports or dependencies remain in either web app.
2. All classified UI icons use the shared Phosphor treatment; every exception is documented.
3. Different icon-bearing navigation destinations/groups/selectors remain distinct, including storefront equivalents; identical actions stay consistent. Existing text-only navigation does not gain icons.
4. Labels, links, menus, permissions, loading behavior and customer-facing document/content payloads retain existing behavior.
5. Required tests/builds/local verification pass; route/state evidence and any fixture-only coverage are explicit.
6. Leave preview servers from the changed checkout running and provide their actual URLs. A deployment, if later requested, gets its own authorized release step and production verification.

## Review decision

The owner confirmed the library/style and consistency goal, then approved this plan for subagent execution. Implementation boundaries and the shared-package approach are accepted for execution. No additional choice of icon library is needed.
