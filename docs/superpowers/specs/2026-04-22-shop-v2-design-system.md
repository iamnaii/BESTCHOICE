# Shop v2 — Design System Foundation + Full Page Redesign

**Spec for:** a big-bang visual redesign of `apps/web-shop` (customer-facing shop at `shop.bestchoicephone.app` / `bestchoicephone-shop.web.app`) that rebuilds the design system first, then applies it to all 28 pages in a single PR.

**Status:** design approved 2026-04-22, ready for implementation plan.
**Predecessors:** PR #637 (web-shop deploy infra), #640 (api envelope unwrap), the shipped Phase 2+3 functional shop at `bestchoicephone-shop.web.app`.
**References:** [SHOP-DESIGN-BRIEF.md](../../design/SHOP-DESIGN-BRIEF.md), [SHOP-REFERENCES.md](../../design/SHOP-REFERENCES.md).

---

## 1. Goals

1. Replace the unstyled MVP on all **28 pages** (13 top-level + 2 apply + 4 buyback + 3 saving-plan + 3 trade-in + 3 account) with a cohesive visual identity rooted in four anchor references: **iStudio (Thai warmth) + Gazelle (refurb trust) + Apple TH (installment transparency) + local LINE-OA phone shops (human character)**.
2. Build a reusable token + component foundation so future pages cost hours not days.
3. Ship in one PR from an isolated worktree, verifiable by Playwright snapshot + smoke tests, zero regression to live orders.
4. Keep the upgrade path to real photography clean — swap a single `media-placeholders.ts` map later, no page-level changes.

## 2. Non-goals

- No backend changes. No API shape changes. No new routes.
- No admin dashboard redesign (separate app at `bestchoicephone.app`).
- No LIFF (in-LINE) redesign.
- No copy rewrite beyond the microcopy constants in `lib/copy.ts`.
- No real photoshoot during this spec — Phase 2 photography swaps in post-launch, no spec change required.

## 3. Decisions locked during brainstorming

| # | Dimension | Choice | Reasoning |
|---|---|---|---|
| 1 | Phasing | **A — design system foundation first** | Owner wants comprehensive planning; token/component library avoids rework mid-project |
| 2 | Aesthetic | **1 — Hybrid** (iStudio + Gazelle + Apple TH + LINE-OA) | Target audience is "credit-card-rejected tier-2 city" — needs trust + warmth + local character |
| 3 | Photography | **E — phased A+B+C** | Apple press + AI abstracts + Unsplash placeholders now; real photoshoot swaps in later via `media-placeholders.ts` |
| 4 | Ship strategy | **B — big-bang PR from worktree** | Shop just launched, traffic ~0, foundation change affects every component — cleanest with one atomic PR |

## 4. Scope

### In scope
- 28 pages in `apps/web-shop/src/pages/` + sub-folders (apply/, trade-in/, buyback/, saving-plan/, account/)
- Shared components in `apps/web-shop/src/components/`
- `apps/web-shop/src/index.css` + Tailwind config
- `apps/web-shop/src/main.tsx` (animation init)
- Photography placeholder module (new): `apps/web-shop/src/lib/media-placeholders.ts`
- Thai microcopy constants (new): `apps/web-shop/src/lib/copy.ts`
- E2E visual regression baseline + smoke suite (new specs under `apps/web/e2e/shop-v2-*.spec.ts`)

### Out of scope
- Anything in `apps/api/`, `apps/web/`, `packages/shared/`
- New routes, new API endpoints, schema changes
- Real photography / photoshoot
- Copy rewrite beyond `lib/copy.ts`
- A/B testing infra
- Service worker / PWA

## 5. Architecture

### 5.1 Design tokens
Added to Tailwind config + mirrored as CSS variables in `styles/tokens.css`. Existing token values (emerald primary, IBM Plex Sans Thai, zinc neutrals) are preserved; this expansion adds missing scales and semantic tokens.

**Color palette additions:**
```
emerald/50   #ECFDF5   — hero tint, success state background
emerald/100  #D1FAE5   — hover background
emerald/500  #1DB446   — primary (existing)
emerald/700  #158C36   — active (existing)
emerald/900  #064E3B   — primary text on tinted background

zinc/50..900           — neutral scale (existing partial, complete to 11 shades)
sand/50..900           — warm neutral for "local shop" accents (limited use — footer, testimonial cards)

condition-a  #10B981   — สภาพดีมาก (green badge)
condition-b  #F59E0B   — สภาพใช้งาน (amber badge)
condition-c  #F97316   — สภาพมีรอย (orange badge)
```

All new colors added as semantic tokens (`bg-condition-a`, `text-condition-a-foreground`) so they inherit from the same primary/secondary system. No raw hex in components.

**Typography scale** (Tailwind class → size/leading in px, all `leading-snug` for Thai):
```
xs    12/18    caption, secondary number
sm    14/22    body secondary, spec list
base  16/26    body
lg    18/28    description, price
xl    20/30    card title
2xl   24/34    section heading
3xl   30/40    page title (mobile)
4xl   36/46    hero (mobile)
5xl   48/58    hero (desktop)
```

**Spacing scale:** Tailwind default (4px base, 0.5–24). No changes.

**Shadows** (emerald-tinted, subtle):
```
shadow-sm   0 1px 2px      emerald/20% 3%
shadow-md   0 2px 6px      emerald/20% 6%
shadow-lg   0 6px 16px     emerald/20% 8%
shadow-xl   0 12px 32px    emerald/20% 10%
shadow-2xl  0 24px 64px    emerald/20% 12%
```

**Radius:**
```
rounded-md    6px    small chips
rounded-lg    8px    inputs, small buttons
rounded-xl    12px   default buttons
rounded-2xl   16px   cards
rounded-3xl   24px   hero bordered containers, emphasis cards
rounded-full          pills, avatars, floating buttons
```

**Motion tokens** (custom Tailwind utilities + `motion.css` keyframes):
```
duration-fast     150ms    hover, pressed
duration-base     200ms    default transitions, tab switch
duration-medium   300ms    modal enter/exit, drawer
duration-slow     500ms    hero reveal, stagger complete

ease-out-quad       standard reveal
ease-in-out-quint   reserved for drawer + page transition
```

**Decision: CSS-only motion, no framer-motion.** IntersectionObserver + CSS transitions cover every motion need (reveal, hover, modal, stagger). Skip the 35KB gzipped library cost. `components/motion/Reveal.tsx` uses IntersectionObserver + a className toggle; `StaggerChildren` uses `transition-delay` tricks.

All motion respects `@media (prefers-reduced-motion: reduce)` → `@media` block disables every transition + animation to instant.

### 5.2 Component library

**7 primitives — Phase 1 (owned by orchestrator):**

```
Button         src/components/ui/button.tsx          5 variants × 3 sizes × 4 states (+ loading slot, + icon slot)
Input          src/components/ui/input.tsx           + InputAddon (฿ prefix, clear icon)
Label          src/components/ui/label.tsx           + required marker, + help text, + error text
Card           src/components/ui/card.tsx            4 patterns: plain, elevated, outlined, interactive (hoverable)
Badge          src/components/ui/badge.tsx           6 variants: default, primary, success, warning, danger, outline
Skeleton       src/components/ui/skeleton.tsx        matches card/row/avatar/line shapes
Dialog         src/components/ui/dialog.tsx          Radix base + custom transition (existing — refresh only)
```

**8 composites — Phase 2 (primitives must be frozen before starting):**

```
Hero                   src/components/hero/Hero.tsx                3 variants: home (image+copy), category (title+breadcrumb), landing (service explainer)
ProductCard            src/components/shop/ProductCard.tsx         photo + brand/model + starting ฿ + monthly ฿ + condition badge + stock line
TrustStrip             src/components/shop/TrustStrip.tsx          horizontal 4-icon bar: warranty, check, LINE, installment
StatefulList<T>        src/components/states/StatefulList.tsx      orchestrates { isLoading, isError, data, empty }, renders skeleton/error/empty/list
Stepper                src/components/ui/Stepper.tsx               existing refresh + accessible nav, indicates current/completed/future
FloatingLineButton     src/components/layout/FloatingLineButton.tsx existing refresh — desktop side-rail + mobile FAB
ReviewCard             src/components/reviews/ReviewCard.tsx       existing refresh + verified badge + optional LINE screenshot slot
SectionHeader          src/components/layout/SectionHeader.tsx     title + optional "ดูทั้งหมด" CTA + decoration rule
```

**4 layout primitives — Phase 2:**

```
Container    src/components/layout/Container.tsx    max-w responsive (sm 640 / md 768 / lg 1024 / xl 1280 / full) + gutter
Stack        src/components/layout/Stack.tsx        vertical spacing (gap-0.5 through gap-24)
Row          src/components/layout/Row.tsx          horizontal alignment + gap + wrap
Section      src/components/layout/Section.tsx      py-12 md:py-16 consistent vertical rhythm + optional bg tint
```

**3 motion helpers — Phase 2:**

```
useMotionPrefs   src/components/motion/useMotionPrefs.ts    returns { reduce: boolean } from matchMedia
Reveal           src/components/motion/Reveal.tsx           IntersectionObserver-triggered fade-up-on-enter
StaggerChildren  src/components/motion/StaggerChildren.tsx  50ms stagger wrapper for lists
```

### 5.3 Page patterns

Each page is assembled from primitives + composites. Three shared macro-patterns:

**ListPage pattern** (used by CatalogPage, OrdersPage, SavingPlansPage, reviews admin, etc.):
```
<ShopLayout>
  <Container>
    <SectionHeader title="..." cta={<Link/>} />
    <StatefulList query={useQuery} renderItem={...} emptyState={...} />
  </Container>
</ShopLayout>
```

**FormPage pattern** (used by InstallmentApplyPage, Trade-in/Buyback submit, SavingPlanCreate):
```
<ShopLayout>
  <Container narrow>
    <Hero variant="landing" title="..." description="..." />
    <Card elevated>
      <form>
        <Stack gap-6>
          <Label>...<Input ... /></Label>
          ...
        </Stack>
        <StickyBottomBar>  // mobile only
          <Button variant="primary" size="lg" fullWidth>ส่งใบสมัคร</Button>
        </StickyBottomBar>
      </form>
    </Card>
    <TrustStrip />
  </Container>
</ShopLayout>
```

**DetailPage pattern** (used by ProductDetailPage, OrderDetailPage, SavingPlanDetailPage, Trade-in/Buyback status):
```
<ShopLayout>
  <Container>
    <Row>  // desktop 2-column / mobile stacked
      <MediaGallery />
      <Stack>
        <Header />
        <Actions />
        <Specs />
      </Stack>
    </Row>
    <Section>
      <ReviewsSection />  // or OrderTimeline, PaymentHistory, etc.
    </Section>
  </Container>
</ShopLayout>
```

### 5.4 Thumb-zone mobile pattern
Every page on mobile (<768px) follows:
- **Sticky header** — shrinks on scroll (logo + hamburger only)
- **Scrollable content area** — main content
- **Sticky bottom bar** (context-aware) — primary CTA for the page (e.g., "จองเครื่องนี้" on ProductDetail, "ไปชำระ" on Cart). Not present on pages without a dominant action (e.g., Home, About).
- **Floating LINE button** — bottom-left, above the bottom bar, 48×48, emerald background, LINE icon.

### 5.5 Photography placeholder strategy
New module `apps/web-shop/src/lib/media-placeholders.ts`:
```typescript
export const mediaPlaceholders = {
  'hero.home': '/media/hero-home.jpg',          // AI abstract, 1600x800
  'hero.category': '/media/hero-category.jpg',
  'staff.owner': '/media/staff-owner.jpg',      // Unsplash Thai shop
  'staff.team': '/media/staff-team.jpg',        // Unsplash group
  'iphone.13': 'https://www.apple.com/...',     // Apple press kit
  'iphone.14': '...',
  // ...
} as const;

export type MediaKey = keyof typeof mediaPlaceholders;
export function media(key: MediaKey): string { return mediaPlaceholders[key]; }
```

Components that need imagery import `media('key')` — never hardcode URL. When real photos land, swap the map, no component change.

### 5.6 Icon + illustration set
- Icons: `lucide-react` only (already installed, tree-shakes). Document chosen icons per component in JSDoc.
- Illustrations: 5-6 inline SVGs for empty states (`empty-cart.svg`, `empty-orders.svg`, `empty-reviews.svg`, `success-check.svg`, `warning-alert.svg`, `no-results.svg`). Authored as React components in `components/illustrations/`.

### 5.7 Accessibility
- All interactive elements keyboard accessible, 44×44 min touch target.
- Color contrast ≥ 4.5:1 body / ≥ 3:1 large text — verified with automated tool in CI.
- Focus ring: 2px emerald/500 offset 2px — never removed on `:focus-visible`.
- ARIA: `aria-label` on icon-only buttons; `aria-live="polite"` on toast + reservation countdown; `aria-current="page"` on active nav.
- Thai line-height rule enforced via ESLint custom rule (or lint note — manual for now).

### 5.8 Responsive breakpoints
```
0–767     mobile (design target: 390×844 iPhone 13)
768–1023  tablet (treat as medium mobile — same layout as mobile, tighter gutters)
1024+     desktop (design target: 1440 container)
```
Use Tailwind `md:` (≥768) only to widen gutters / grids. Switch to desktop-first patterns at `lg:` (≥1024).

## 6. Implementation phasing

### Phase 0 — worktree + baseline (30 min, orchestrator solo)
1. `git worktree add .worktrees/shop-v2-design -b feature/shop-v2-design origin/main`
2. `cd .worktrees/shop-v2-design && npm install && npx prisma generate --schema=apps/api/prisma/schema.prisma`
3. Baseline Playwright visual snapshot of current live shop — `apps/web/e2e/shop-v2-baseline.spec.ts` (captures 28 pages × desktop + mobile, stored in `apps/web/e2e/snapshots/shop-v2-baseline/`)
4. Commit baseline snapshots

### Phase 1 — tokens + primitives (6-8 hrs, orchestrator solo)
1. Expand `tailwind.config.js` + `styles/tokens.css` with full token set per §5.1
2. Build 7 primitives per §5.2 — each with a demo story in `apps/web-shop/src/stories/` (plain HTML page for visual QA)
3. Run `npm run build --workspace=apps/web-shop` clean + Playwright primitives snapshot
4. Commit per primitive (7 commits)

### Phase 2 — composites + layouts + motion (6-8 hrs, orchestrator + 1 subagent)
1. Orchestrator builds: Hero, ProductCard, TrustStrip, StatefulList, 4 layout primitives, 3 motion helpers
2. Subagent builds: Stepper refresh, FloatingLineButton refresh, ReviewCard refresh, SectionHeader
3. Lock component APIs (freeze prop types — subagents in Phase 3 may not change them)
4. Commit per composite (8 commits)

### Phase 3 — parallel page redesign (8-10 hrs, 5 parallel subagents)

Cluster assignments (each subagent owns a folder, does not touch shared components):

| Cluster | Pages | Subagent | Est hrs |
|---|---|---|---|
| **Browse** | Home, CatalogPage, ProductDetailPage | A | 3 |
| **Purchase** | CartPage, CheckoutPage, OrderSuccessPage, OrdersPage, OrderDetailPage | B | 3 |
| **Account** | AccountPage, AddressBookPage, SavingPlansPage (account list), SavingPlanLandingPage, SavingPlanCreatePage, SavingPlanDetailPage | C | 3 |
| **Apply/Services** | InstallmentApplyPage, ApplySuccessPage, TradeInLandingPage, TradeInSubmitPage, TradeInStatusPage, BuybackLandingPage, BuybackQuickQuotePage, BuybackSubmitPage, BuybackStatusPage | D | 3 |
| **Info** | HowItWorksPage, ShippingPage, ReturnsPage, AboutPage, ContactPage | E | 1 |

Each subagent:
- Reads the page template patterns in §5.3
- Uses only composites + primitives from Phase 1-2 (no ad-hoc new components)
- Uses `media('key')` for imagery
- Uses `copy.pageName.xxx` for user-facing Thai strings
- Uses `leading-snug` on every Thai text block
- Runs `npx tsc --noEmit` before committing
- Commits own branch `shop-v2-cluster-{a..e}`, orchestrator merges into `feature/shop-v2-design`

### Phase 4 — QA + polish + PR (3-4 hrs, orchestrator solo)
1. Integration run: start dev server, click through all 28 pages on mobile + desktop
2. Playwright snapshot compare vs baseline — expect different visuals but same `data-testid` targets and form validation behavior
3. Smoke suite run (8 critical flows from §8)
4. Lighthouse mobile run — target ≥ 90 performance / ≥ 95 accessibility
5. Bundle size check — ≤ 750 KB gzipped
6. Manual a11y: tab-through every interactive page, zoom 200%, test reduced motion
7. Open PR with the test report embedded, request owner review

## 7. File inventory (what changes)

### New files (~35)
- `apps/web-shop/src/styles/tokens.css`
- `apps/web-shop/src/styles/motion.css`
- `apps/web-shop/src/components/ui/skeleton.tsx`
- `apps/web-shop/src/components/ui/badge.tsx`
- `apps/web-shop/src/components/ui/Stepper.tsx` (extracted, existing inline only)
- `apps/web-shop/src/components/hero/Hero.tsx`
- `apps/web-shop/src/components/hero/HomeHero.tsx`
- `apps/web-shop/src/components/hero/CategoryHero.tsx`
- `apps/web-shop/src/components/hero/LandingHero.tsx`
- `apps/web-shop/src/components/shop/ProductCard.tsx` (rename from existing)
- `apps/web-shop/src/components/shop/TrustStrip.tsx`
- `apps/web-shop/src/components/states/StatefulList.tsx`
- `apps/web-shop/src/components/states/EmptyState.tsx`
- `apps/web-shop/src/components/states/ErrorState.tsx`
- `apps/web-shop/src/components/states/LoadingState.tsx`
- `apps/web-shop/src/components/layout/Container.tsx`
- `apps/web-shop/src/components/layout/Stack.tsx`
- `apps/web-shop/src/components/layout/Row.tsx`
- `apps/web-shop/src/components/layout/Section.tsx`
- `apps/web-shop/src/components/layout/SectionHeader.tsx`
- `apps/web-shop/src/components/layout/StickyBottomBar.tsx`
- `apps/web-shop/src/components/motion/useMotionPrefs.ts`
- `apps/web-shop/src/components/motion/Reveal.tsx`
- `apps/web-shop/src/components/motion/StaggerChildren.tsx`
- `apps/web-shop/src/components/illustrations/*.tsx` (6 SVG React components)
- `apps/web-shop/src/lib/media-placeholders.ts`
- `apps/web-shop/src/lib/copy.ts`
- `apps/web-shop/public/media/*.jpg` (placeholder assets — committed to repo; small, <500KB total)
- `apps/web/e2e/shop-v2-baseline.spec.ts`
- `apps/web/e2e/shop-v2-smoke.spec.ts`
- `apps/web/e2e/shop-v2-visual.spec.ts`

### Modified files (~30)
- `apps/web-shop/tailwind.config.js` — extended theme
- `apps/web-shop/src/index.css` — import tokens.css + motion.css
- `apps/web-shop/src/main.tsx` — add reduced-motion preference respect
- `apps/web-shop/src/App.tsx` — no change expected (routes stable)
- `apps/web-shop/src/components/layout/ShopLayout.tsx` — new Container + SkipLink
- `apps/web-shop/src/components/layout/ShopHeader.tsx` — redesign
- `apps/web-shop/src/components/layout/ShopFooter.tsx` — redesign
- `apps/web-shop/src/components/layout/FloatingLineButton.tsx` — refresh
- `apps/web-shop/src/components/ui/button.tsx` — expand variants
- `apps/web-shop/src/components/ui/input.tsx` — add InputAddon
- `apps/web-shop/src/components/ui/label.tsx` — add required marker
- `apps/web-shop/src/components/ui/card.tsx` — expand patterns
- `apps/web-shop/src/components/ui/dialog.tsx` — transition update
- All 20 page files in `src/pages/**` — rewritten to use new components/patterns

### Added dependencies
None. Motion handled via CSS + IntersectionObserver (see §5.1 decision). Keeps bundle delta ~0KB for motion system.

## 8. Smoke test plan (must pass before merge)

1. **Home loads + 4 products visible** — `page.locator('[data-testid="product-card"]').count() === 4`
2. **Product detail reserve flow** — click first product → see ProductDetail → click "จองเครื่องนี้" → navigates to /cart with item
3. **Cart reservation countdown visible** — `page.locator('[data-testid="reservation-countdown"]')` shows `mm:ss`
4. **Checkout stepper progresses** — complete address step → shipping step visible → complete shipping → payment step visible
5. **Apply form validates** — `/apply/:productId` with invalid phone → error shown, form not submitted
6. **Trade-in form validates** — `/trade-in/submit` with missing photo → error shown
7. **Saving-plan create form submits** (mocked) — fills fields → clicks submit → mock API returns → navigates to detail
8. **FloatingLineButton visible on every page** — iterate 28 pages, assert button present
9. **Reduced motion respected** — set `prefers-reduced-motion: reduce` → no Reveal animations play
10. **Lighthouse mobile performance ≥ 90** — CI asserts via `@lhci/cli`

## 9. Risks + mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Component API drift during Phase 3 | Subagents produce incompatible page code | Freeze composite props in Phase 2, export strict TS types from component index, subagents import types not guess |
| Bundle size creep from new illustrations / state components | Slow first paint on mobile | Budget ≤ 750 KB gzipped total; illustrations inline-SVG (tiny), components tree-shake per route |
| Prod accident (direct push to main) | Live shop breaks mid-redesign | Work in `.worktrees/shop-v2-design`, branch `feature/shop-v2-design`, no touch to main until PR |
| Concurrent agent branch race | Another agent pushes over my branch | Branch prefix `shop-v2-` unique, PR squash to avoid merge commit chaos, one-file orchestrator lock on shared files (App.tsx, main.tsx, tokens) |
| Placeholder photos look AI-obvious | Users distrust the shop | Use Apple press for products (real) + emerald geometric abstracts for hero (clearly decorative, not masquerading) + Unsplash for staff (real-looking) — documented in `media-placeholders.ts` |
| Thai line-height clipping on new sizes | Vowel marks cut off on ก็, ี | Enforce `leading-snug` minimum; add a Playwright visual check with sample words (ก็ ที ื ่) at every page size |
| Phase 3 subagent produces hardcoded hex | Violates design token rule | Subagent prompt explicitly forbids raw hex, lint rule warning, code-reviewer subagent check before merge |

## 10. Owner-facing outcome

After merge + deploy:
- `https://bestchoicephone-shop.web.app` looks like a designed Thai phone shop, not an MVP
- Every page has a hero / header matching brand voice
- Product cards show installment monthly ฿, condition badge, stock urgency
- LINE CTA always reachable (floating button + bottom nav)
- Trust strip above fold on Home ("ตรวจสอบ 30 จุด", "รับประกันร้าน 30 วัน", "ผ่อนได้บัตรประชาชนใบเดียว", bank logos)
- Forms (apply/trade-in/saving-plan) feel safe to fill in, with live validation + transparent microcopy
- Photography stays placeholder-quality until owner schedules the real shoot, then `media-placeholders.ts` swap replaces everything

## 11. Deferred / v2.1 candidates

- Real photoshoot + swap into `media-placeholders.ts`
- 360° product spinner component (frame 1 of N implemented, full spinner deferred)
- Motion choreography richer than fade-up (hero parallax, product card 3D tilt)
- Dark mode token pass
- PWA + offline cart
- A/B test infra (flag pages for variant)
- i18n infrastructure (Thai + English toggle — currently Thai only)
- Service worker preload hero image
- LINE LIFF integration inside shop (share a product to LINE chat)
