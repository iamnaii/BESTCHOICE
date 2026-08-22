# BESTCHOICE Shop — Redesign 2026-08 (apple-exchange DNA + CI green)

**Target:** `apps/web-shop` (customer storefront at shop.bestchoicephone.app)
**Reference:** [apple-exchange.com/wtb](https://www.apple-exchange.com/wtb) — DOM + CSS + screenshots captured 2026-08-21
**Visual spec (rendered mockup):** https://claude.ai/code/artifact/e7bb4449-779b-4931-a097-cee9b6046da5
**Supersedes:** nothing — this sits on top of [SHOP-DESIGN-BRIEF.md](./SHOP-DESIGN-BRIEF.md) §2 (brand tokens) and updates its color section.

---

## 0. Owner decisions (2026-08-21)

| Question | Decision |
|---|---|
| Card granularity | **Second-hand never groups** (owner, 2026-08-21: "มือสอง ต้องเครื่องใครเครื่องมันสิ") — one card per physical device, with its own number, grade, battery, colour and price. Sealed **new** stock still groups by model+storage. Superseded the original "Phase 1 grouped / Phase 2 per-unit" split; both shipped together |
| CI primary | **`#25BC93`** — the middle stop of the real logo gradient in `apps/web/public/logo.svg` (`#39F0CF → #25BC93 → #1DA579`). Retires LINE-green `#1DB446` |
| Header | **Solid CI-green bar, full width, black capsule CTA** — mirrors the reference's gold bar |
| Mobile grid | **2 columns** (reference is 1; ours stays denser) |

---

## 1. What the reference actually does

Extracted from the live page, not from memory:

| Element | Reference implementation |
|---|---|
| Page canvas | `bg-gray-50` — cards are glass **on grey**, never on white |
| Header | `.bg-scroll-head { background-color: gold !important }`, `max-w-[1280px]`, nav links with `after:` underline grow-on-hover, dropdowns `bg-white/80 backdrop-blur-xl rounded-2xl` |
| Filter panel | `rounded-[42px] bg-[#F4F4F4] border-10 border-white shadow-[0_8px_20px_rgba(0,0,0,0.08)] sticky top-24` — category tiles with real product photos, `h-14 rounded-xl` selects |
| Waiting-list card | Same `rounded-[42px]` shell but `bg-black`, big white heading + white pill button |
| Product grid | `grid grid-cols-1 lg:grid-cols-4 md:grid-cols-3 gap-2` inside a `lg:col-span-3` content column |
| Product card | `bg-gray-100/50 backdrop-blur-2xl rounded-4xl p-3 border border-white/60 shadow-[0_8px_32px_rgba(0,0,0,0.08)] hover:scale-[1.02]` |
| — image | `aspect-[4/3] rounded-3xl bg-[#f0f0f0]`, horizontal `snap-x` carousel + dot indicators |
| — grade badge | top-left pill: circular letter chip on a `bg-<color>/60 backdrop-blur` capsule with a white hairline ring |
| — tags | top-right stacked `bg-white/40 border-white/60 backdrop-blur` pills with a colored dot, each links to `?tag=` |
| — thumbnails | 4 × `w-16 h-16 rounded-xl`, active one ringed, last tile is `+7` |
| — text rows | `name │ #4136` · `ความจุ │ 128 GB · ขาว` · `👁 73 │ ฿13,500` |
| — CTA | `bg-[#2c2c2c] rounded-4xl w-full` "Buy Now" |
| Footer | `linear-gradient(#000,#0f0f0f,#191919,#222,#2b2b2b)`, inverted logo, round social buttons |
| Fonts | Sukhumvit + DB Heavent (Thai) — **we keep IBM Plex Sans Thai**, per existing system |

---

## 2. Token changes — `apps/web-shop/src/styles/tokens.css`

`tokens.css` is the single source of truth (Tailwind v4 ignores `tailwind.config.ts` — there is no `@config`).

| Token | Was | Becomes | Why |
|---|---|---|---|
| `--color-primary` | `#1DB446` | `#25BC93` | LINE green is not the brand color; the logo is teal-emerald |
| `--color-emerald-400` | `#34D399` | `#39F0CF` | gradient start |
| `--color-emerald-500` | `#1DB446` | `#25BC93` | gradient middle = primary |
| `--color-emerald-600` | `#158C36` | `#1DA579` | gradient end = hover/active |
| `--color-emerald-700` | `#0E6B29` | `#157C61` | text-on-light |
| `--color-background` | `hsl(0 0% 100%)` | `#F3F7F5` | glass cards need a grey ground; on pure white they vanish |
| `--color-card` | `hsl(0 0% 100%)` | `#FFFFFF` | unchanged — cards stay white/translucent |
| `--color-foreground` | `hsl(240 10% 3.9%)` | `#0E211C` | near-black biased green so it belongs to the accent family |
| `--color-muted` | `hsl(240 4.8% 95.9%)` | `#EDF2F0` | image plate + sunk surfaces |
| `--color-border` | `hsl(240 5.9% 90%)` | `#E3ECE8` | hairline, green-biased |
| `--shadow-*` | `rgb(29 180 70 / …)` | `rgb(14 33 28 / …)` | the reference uses neutral shadows; green shadows read as smudge |
| `--color-cta` | `#EA580C` | **unchanged** | stays reserved for the single highest-intent action (reserve on product detail). Card CTAs are ink-black |

`--color-condition-a|b|c` already map to emerald / amber / orange — reuse them for the GRADE badge, no new tokens.

**Also delete `apps/web-shop/tailwind.config.ts`** — it is dead (Tailwind v4, no `@config` directive) but still declares `primary: hsl(160 84% 39%)`, which invites someone to "fix" the color in a file that has no effect.

---

## 2b. Typography — matching the reference's Thai face

The reference sets its Thai text in **two** self-hosted commercial faces:

| Family | Where | Files it serves |
|---|---|---|
| **DB Heavent** | global body default (`font-family: DB Heavent, Inter, sans-serif`) — the giant hero type | `/fonts/DB_Heavent_Original_Webfont_unhinted/*.woff2`, 5 weights |
| **Sukhumvit Set** | every card, the filter panel, the UI chrome — set inline as `font-family:'Sukhumvit', sans-serif` | `/fonts/SukhumvitSet-{Text,Medium,SemiBold,Bold}.woff2` |

Neither can simply be copied. **Sukhumvit Set** is Cadson Demak's, bundled by
Apple as a macOS/iOS system font (`/System/Library/Fonts/Supplemental/SukhumvitSet.ttc`,
"Copyright © 2009, 2013 Cadson Demak Co. Ltd." — designer Anuthin Wongsunkakon);
its licence does not cover re-serving it as a webfont. **DB Heavent** is a
commercial DB Design retail font that needs a purchased web licence. The
reference appears to serve both without one — not a thing to copy.

### What we do instead

```
'Sukhumvit Set'  →  'Anuphan'  →  'IBM Plex Sans Thai'  →  'Noto Sans Thai'
```

1. **Name Sukhumvit Set first, never serve it.** Referencing an installed
   system font in a stack is unrestricted. Every Mac, iPhone and iPad already
   has it — and this is a shop whose customers are shopping *for iPhones*, so a
   large share of visitors land on the exact face the reference uses, at zero
   bytes and zero licence risk.
2. **Anuphan carries everyone else.** Free on Google Fonts, variable 100–700,
   and from Cadson Demak — the same foundry and the same loopless humanist
   construction as Sukhumvit Set. Rendered side by side at matched weights it
   is visibly the closest of the free Thai faces; IBM Plex Sans Thai (what the
   shop used before) is the same foundry too but noticeably squarer and tighter
   in the aperture.
3. **DB Heavent is dropped, not substituted.** It is the reference's "cheap Thai
   signage" half, and it only earns its keep at their 9rem hero size, which we
   do not use.

### Consequences to respect

- **Sukhumvit Set stops at Bold (700).** There is no 800/900. Asking for
  `font-extrabold` on it makes the browser synthesise a smeared faux-bold, so
  headline and price weights cap at `font-bold`.
- Latin-only lockups that genuinely want 800 — the `BESTCHOICE` wordmark, the
  `GRADE A` badge — use the `.font-brand` utility, which is Inter.
- `.font-display` no longer means "Inter with tight tracking". It is the same
  Thai stack as body at `-0.01em`; Thai tone and vowel marks sit above and below
  the line and collide at the old `-0.03em`.
- Both families load from **one** `<link>` in `index.html`
  (`Anuphan:wght@100..700` + `Inter:wght@300..900`). The old `@import` inside
  `index.css` is gone — an `@import` there serialises the font request behind
  the stylesheet.

---

## 3. Phase 1 — frontend only

No API change, no Prisma change, shippable on its own.

| # | Task | Files |
|---|---|---|
| 1 | Apply the token table above; swap shadow hue | `src/styles/tokens.css` |
| 2 | Delete the dead Tailwind config | `tailwind.config.ts` |
| 3 | `ShopHeader` → solid CI-green bar: real logo from `logo.svg`, white nav with `after:` underline hover, black capsule CTA "เช็คยอดผ่อนทันที" right-aligned, hamburger on mobile | `src/components/layout/ShopHeader.tsx` |
| 4 | `ProductCard` rewritten: glass card, grade badge top-left, ≤2 tags top-right, `name │ #no` row, `ความจุ │ value` row, `ผ่อน ฿x/ด. │ ฿price` row, full-width ink capsule button. Give `.crow` a `min-height` so cards in a row align | `src/components/catalog/ProductCard.tsx` |
| 5 | `CatalogPage` → 4-column layout (sticky filter panel 1/4 + grid 3/4). Remove the sticky pill toolbar (moves into the panel). Mobile keeps 2 columns and collapses filters to chips | `src/pages/CatalogPage.tsx` |
| 6 | `FilterSidebar` → `rounded-[40px]` panel with a thick white border. Device-type tiles are **iPhone มือ 1 / iPhone มือ 2 only** (owner call 2026-08-21 — we sell iPhone exclusively, and the backend already hard-filters `brand='Apple'` + `category ∈ {PHONE_NEW, PHONE_USED}`), wired to the existing `condition=NEW\|USED` param. Then `h-14 rounded-xl` selects for รุ่น and สภาพเครื่อง (grade), **plus a new "ค่างวดต่อเดือน" filter** (how our customers actually shop) | `src/components/catalog/FilterSidebar.tsx` |
| 7 | New `WaitlistCard` — black `rounded-[40px]` block under the filters → "ฝากหาฟรี / แจ้งรุ่นที่ต้องการ" | `src/components/catalog/WaitlistCard.tsx` (new) |
| 8 | `ShopFooter` → dark gradient, inverted logo, link columns, round FB / LINE / TikTok buttons | `src/components/layout/ShopFooter.tsx` |
| 9 | Skeletons re-shaped to the new card, otherwise the grid jumps on load (CLS) | `src/components/states/LoadingState.tsx` |

**Thai typography guard:** headings scale up a lot here. Every Thai block keeps `leading-snug` (project rule — `leading-none` clips สระบน/วรรณยุกต์). Test strings must include ี ิ ุ ็ ้.

---

## 4. Phase 2 — per-unit cards ✅ SHIPPED 2026-08-21

**Status:** built, not the deferred plan below. The owner overturned the grouped
listing while Phase 1 was on screen, so the split never happened — see §4a for
what actually landed. The table in this section is kept for the two items that
are still open (unit number policy, in-card carousel).

### §4a — what shipped

| Piece | Where |
|---|---|
| `listGroupedByModel` splits: `groupBy` for `PHONE_NEW`, `findMany` for `PHONE_USED`, merged + sorted + paged in memory (capped at `MAX_UNIT_SCAN = 2000` rows) | `shop-catalog.service.ts` |
| `kind: 'UNIT' \| 'GROUP'` discriminator on every card, plus `displayNo`, `color`, `conditionGrade`, `batteryHealth`, `tags[]` | same |
| Tag + device-number derivation, with specs | `catalog-item.util.ts`, `catalog-item.util.spec.ts` |
| `stockLabelFor()` — a UNIT reads "เครื่องนี้มีตัวเดียว", not "เหลือ 1 เครื่อง — ใกล้หมด", which would otherwise fire on every used card and stop meaning anything | `shop-catalog.service.ts` + controller |
| `listRelated` shows the cheapest real **device** of each other model, not an averaged group | same |
| Card renders `#4218`, per-device grade/colour/battery, CTA "ดูเครื่องนี้" | `ProductCard.tsx` |
| Detail page opens on the device in the URL instead of the model's cheapest unit | `ProductDetailPage.tsx` |
| Sort label "ยอดนิยม" → "แนะนำ" — the old `popular` sort was `_count(id) desc`, i.e. deepest stock, which says nothing to a shopper and is meaningless once used stock lists one-per-card. It now means freshest-first | `CatalogPage.tsx` |

| Default order is by **model, newest generation first** (`modelRank`): every iPhone 15 Pro Max sits together, 16 before 15. Within a model — new stock first, then second-hand best-grade first, then dearest first. `sort=newest` still means freshest-arrival | `catalog-item.util.ts`, `shop-catalog.service.ts` |
| **Adjustable down payment.** `?downPct=` + `?months=` re-quote every card through `calcBcInstallment` — the same function the detail page uses, so the grid and the detail page cannot drift (red line §10). Below-minimum requests are clamped up, never quoted. Cards print `ดาวน์ ฿x · N งวด` beside the monthly | `shop-catalog.service.ts`, `dto/list-products.dto.ts`, `FilterSidebar.tsx`, `CatalogPage.tsx`, `ProductCard.tsx` |
| Response carries `minDownPct` + `monthsOptions` so the slider and tenure picker have no hardcoded numbers | `shop-catalog.service.ts` |

**Why the quote is server-side:** the down-payment maths could have been done in
the browser for an instant slider, but that would be a second implementation of
the installment formula — exactly what the parity spec exists to prevent. The
slider debounces 250ms and refetches instead.

Tests: 98 passing in `shop-catalog` (was 75).

### §4b — original plan, still open where noted


`ShopCatalogService.list()` groups by `brand + model + storage + category` and returns `stockCount`, so one card = many devices. That makes `#4218`, per-device grade, battery %, and real photos impossible. `Product` already carries every field needed — only the display number is missing.

| # | Task | Files |
|---|---|---|
| 1 | Add `?view=unit` to the existing endpoint (default stays `group`, so nothing breaks). Returns per-unit `conditionGrade`, `batteryHealth`, `color`, `gallery[]`, `hasBox`, `warrantyExpireDate`, `stockInDate` | `apps/api/src/modules/shop-catalog/shop-catalog.service.ts`, `dto/list-products.dto.ts` |
| 2 | Derive tags server-side, return `tags: string[]` so the frontend only paints | `apps/api/src/modules/shop-catalog/unit-tags.util.ts` (new) |
| 3 | **Decide the customer-facing unit number** (see §7) | `prisma/schema.prisma` (only if a running number is chosen) |
| 4 | Filters must work per-unit: grade, battery band, color, monthly-payment band | `shop-catalog.service.ts` |
| 5 | Card CTA deep-links to that exact unit, skipping `UnitPicker` | `src/components/catalog/UnitPicker.tsx`, `src/pages/ProductDetailPage.tsx` |
| 6 | In-card image carousel: touch snap + arrow keys + honors `prefers-reduced-motion` | `src/components/catalog/CardGallery.tsx` (new) |

### Tag derivation — no schema change

| Tag | Condition | Source field |
|---|---|---|
| GRADE A/B/C | always, used devices | `conditionGrade` |
| แบต NN% | `batteryHealth >= 85` | `batteryHealth` |
| ครบกล่อง | `hasBox === true` | `hasBox` |
| ประกัน N ด. | > 90 days remaining | `warrantyExpireDate` |
| เข้าใหม่ | stocked in ≤ 7 days | `stockInDate` |
| ลดเพิ่ม | current price < previous | `ProductPrice` history |
| สุดคุ้ม | below median for same model+storage | computed at query time |

Cap at **2 tags per card** — the reference stacks up to 5 and buries the product photo.

---

## 5. Phase 3 — 360°

Roughly 60% of this already exists and has been sitting unused since 2026-07-22.

### What is already in place

| Piece | Where | State |
|---|---|---|
| `Product.gallery360 String[]` | `prisma/schema.prisma:1730` | ✅ present, comment says "24-36 frames" |
| API passthrough | `shop-catalog.service.ts:308` (per unit) and `:328` (per product) | ✅ returned already |
| Viewer component | `apps/web-shop/src/components/catalog/Product360Viewer.tsx` | ✅ drag-to-spin, 8px per frame |
| Detail-page wiring | `ProductDetailPage.tsx:290-292, 363` | ✅ รูป / 360° toggle, per-unit frames with product-level fallback |
| Sample data on prod | `prisma/seed-demo-products.ts:139` `spinFrames()` | ✅ 24 synthetic SVG frames on the iPhone 15 Pro demo unit |

### What is missing — and why nothing has 360 today

1. **There is no way to get frames in.** `UpdateOnlineListingDto` (`apps/api/src/modules/products/dto/online-listing.dto.ts`) has `gallery`, `isOnlineVisible`, `onlineDescription` — **no `gallery360`**. `promotePhoto` only moves one existing photo at a time into `gallery`, capped at 8. The seeder is currently the only writer. `OnlineListingPanel.tsx` in the admin has no 360 UI at all.
2. **No capture workflow.** 24–36 shots per device is not something a shop sustains by hand.
3. **The viewer never preloads.** 24 remote images fetched one-at-a-time while the finger is moving = visible stutter on first spin.
4. **Keyboard cannot drive it.** Mouse/touch drag only, no focus target, no arrow keys.
5. **`react-360-view` in `apps/web-shop/package.json` has zero imports** — the viewer is hand-written. Dead dependency, remove it.

### Capture: record a video, let the browser cut the frames

The image is Alpine with `chromium` + fonts (`Dockerfile:65-73`) — **no ffmpeg**, so server-side video decoding would mean a new system package or a separate job. Not needed: the browser can do it.

1. Device on a cheap turntable, phone on a tripod, fixed light, white backdrop — **record 12–15 seconds**, about one minute of staff time per device.
2. Staff drops the video into the "ขึ้นเว็บ" tab on the admin product page. The video itself is never uploaded.
3. The page seeks a `<video>` to 24 evenly-spaced timestamps, draws each to a `<canvas>`, downscales the long edge to 1000px, exports JPEG q0.8.
4. Each frame goes straight to storage through the **existing** `POST /shop/upload/signed-url` (`shop-upload.controller.ts`) under a new `UploadKind.PRODUCT_360_FRAME`. GCS enforces the size cap through `x-goog-content-length-range` (`storage.service.ts:188+`).
5. Staff previews the spin, then `PATCH /products/:id/online-listing` with the ordered `gallery360` array.

Fallback for devices where a video is impractical: accept 24 individual stills through the same uploader.

### Tasks

| # | Task | Files |
|---|---|---|
| 1 | Add `gallery360?: string[]` to `UpdateOnlineListingDto` with `@ArrayMaxSize(36)` + `@ArrayUnique`. **Security: validate every URL is one we issued** — it must sit under our bucket's public prefix and inside `shop/product-360/{productId}/`. The existing `gallery` guard ("must already be in the gallery") does not transfer, because a 360 set arrives all at once | `apps/api/src/modules/products/dto/online-listing.dto.ts`, `products-online-listing.service.ts` |
| 2 | Add `UploadKind.PRODUCT_360_FRAME` + MIME allow-list `['image/jpeg','image/webp']` + `pickBasePath` case. Staff route only — **never** add it to `PUBLIC_UPLOAD_KINDS` | `apps/api/src/modules/storage/shop-upload.controller.ts` |
| 3 | Admin: 360 block in the online-listing panel — video picker, client-side frame extraction, parallel presigned uploads with a progress bar, spin preview, save, and a "ลบชุด 360°" action | `apps/web/src/pages/ProductDetailPage/components/OnlineListingPanel.tsx`, new `Frame360Uploader.tsx` |
| 4 | Viewer upgrade: two-pass preload (frames 1, 5, 9, 13, 17, 21 first, then the rest), `tabindex` + arrow keys, prev/next buttons, position meter + frame counter, one attention spin on first intersection gated by `prefers-reduced-motion`, and **fetch only when the 360 tab is opened** | `apps/web-shop/src/components/catalog/Product360Viewer.tsx` |
| 5 | Move the entry point into the thumbnail strip (first tile, rotate icon) instead of the floating รูป / 360° toggle above the image; restyle to the new glass language | `apps/web-shop/src/pages/ProductDetailPage.tsx` |
| 6 | Surface `360°` as a derived tag on the catalog card (`gallery360.length >= 12`) and let `?tag=360` filter on it — reuses the Phase 2 tag pipeline | `unit-tags.util.ts`, `ProductCard.tsx`, `CatalogPage.tsx` |
| 7 | Remove the unused `react-360-view` dependency | `apps/web-shop/package.json` |

### Weight budget

24 frames × ~70–90 KB ≈ **2 MB per device**. Acceptable **only** because it loads on tab-open, never on page load. First pass is 6 frames (~0.5 MB) so a coarse spin is available in about a second on 4G; the remaining 18 fill in behind it. Cap the DTO at 36 to match the schema comment.

### Scope — do not attempt every device

360 is a differentiator, not a baseline. Recommended: **pilot 5 devices first**, measure whether product-detail → reserve conversion moves, then decide a threshold (e.g. grade A, or price ≥ ฿15,000). This also keeps the labour honest — at one minute per device it is roughly 40 minutes a week for a 40-device intake, which is sustainable; 24 hand-taken stills per device is not.

---

## 6. Deliberately not copied

| Reference | Ours | Why |
|---|---|---|
| 1-column mobile grid | 2 columns | ~80% of our traffic is mobile; one device per screen makes a 30-unit list unscrollable |
| Up to 5 stacked tags | max 2 | they cover the product photo |
| View count (eye icon) | monthly payment | we don't track views, and the monthly figure is our actual differentiator |
| `text-[9rem]` hero | ~3rem | Thai headlines at that size overflow a phone and eat a full viewport |

---

## 7. Open before starting

1. **Photo coverage is a hard gate.** The card lives on 4+ real photos per device. If production `gallery[]` mostly holds one image (or none), the grid becomes rows of grey boxes — worse than today. **Count units with ≥3 gallery images on prod before enabling the carousel.**
2. **Unit number.** No customer-facing device number exists. Last-4 of IMEI works today with no schema change but can collide; a running number reads better but needs a column + backfill across the whole stock. Decide before Phase 2 task 1.
3. **360 scope + pilot.** Phase 3 assumes a turntable, a fixed lighting spot, and someone owning the capture step. Confirm who does it and on which devices before any code is written — the viewer is the easy half.
4. ~~**Category tiles.**~~ **Resolved 2026-08-21:** two tiles only — **iPhone มือ 1** and **iPhone มือ 2**. No iPad / Mac / อื่น ๆ. They map to the existing `condition=NEW|USED` filter, so grade (A/B/C) stays a separate control below.
