# BESTCHOICE Phone Shop — Design Brief

**Audience of this doc:** designer (human or AI) producing Figma mockups for `shop.bestchoicephone.app`.
**Deliverable expected:** a Figma file with desktop (1440px) + mobile (390px) frames for the 20 pages listed in §5.
**Constraints:** final output will be built on the existing React + Tailwind + shadcn/ui stack (see §8) — please use tokens that already exist or can be expressed as CSS variables, avoid hardcoded hex.

---

## 1. The business

**BESTCHOICE** is a mobile phone retailer in Lopburi, Thailand. Two arms under one brand:

- **BESTCHOICE SHOP** — multi-branch retail, new + second-hand iPhones, accessories, walk-in installments
- **BESTCHOICE FINANCE** — central finance arm (own's the customer loan during installment)

The web-shop at `shop.bestchoicephone.app` is a **customer-facing storefront** for online catalog + applications. Staff operate the admin dashboard at `bestchoicephone.app` separately (not in this brief).

### Primary product
**Second-hand iPhones** (conditions A/B/C) sold on installment — 3–12 months, flat-rate interest, down payment + monthly. Differentiator: **"ผ่อนได้บัตรประชาชนใบเดียว"** (installment approval with just a national ID card — no credit cards needed). Price range ~฿8,000–฿35,000 per device.

### Target customer
- Aged 20–45, Thai nationals
- Cannot qualify for credit card financing (students, first-job workers, gig workers, small-business owners)
- Shops on mobile (~80% mobile traffic expected), uses LINE as primary chat app
- Wants: trust signals ("ของแท้", "รับประกันร้าน"), fast approval, clear monthly payment, ease of finding a shop nearby
- Sensitive to: hidden fees, unclear refund policies, looking scammy

### Channels already live
- LINE OA (customer chat + payment reminders + receipts)
- Facebook page + ads
- TikTok (short reviews)
- Walk-in at branches

### North-star metric
Number of completed **installment applications per week** from the online shop (currently 0 — shop just launched).

---

## 2. Brand + tone

### Visual tokens already in the codebase
- **Primary color (emerald):** `#1DB446` — used for CTAs, success states, brand moments
- **Primary dark:** `#158C36` — hover/active
- **Primary light tint:** `#E8F5E9` — subtle backgrounds
- **Semantic:** info blue `#0367D3`, warning orange `#FF6F00`, danger red `#DD2C00`
- **Neutrals:** dark `#1A1A2E`, text `#333`, muted `#888`, subtle `#AAA`, border `#EEE`, light bg `#F7F8FA`, white `#FFF`
- **Theme name:** "Minimal Zinc + Emerald Accent (ธาตุไม้)"
- **Font (Thai + English):** IBM Plex Sans Thai (all weights), with Inter as English fallback
- **Thai text rule:** always `line-height: 1.375` (`leading-snug` in Tailwind) — `leading-none` clips vowel marks like ิ ี ื ็

### Voice
- Thai-first. English only for brand words and SKUs.
- Casual + warm + direct. Not corporate.
- Trustworthy. Avoid superlatives ("ดีที่สุด", "สุดยอด"). Prefer concrete ("รับประกัน 30 วัน").
- Mobile microcopy tight — 40 characters per line max for CTAs.

### Do / don't
**Do:** emerald accents, white/light backgrounds, rounded corners `rounded-xl` (12px) + `rounded-lg` (8px), soft shadows, photos of actual iPhones on white, human smiling staff, LINE icon prominence.
**Don't:** black backgrounds, neon colors, aggressive sale red banners, "mystery box" gamification, US-style "LIMITED TIME ONLY" countdowns, emoji in the UI (use `lucide-react` icons — they're already installed).

### Reference aesthetic
Think **Apple.com/th × Dtac.co.th × a trusted Thai neighborhood shop**. Clean white space, generous photography, plain prices, warm Thai tone. Not "luxury app" — "the shop down the street, but online."

---

## 3. What's already built (and shipped)

The code is **live** at `https://bestchoicephone-shop.web.app`. The designer should go browse it on mobile + desktop to see the functional MVP — everything below is hooked to the real prod API. All 20 pages render; they're just un-designed.

Available components to compose with (under `apps/web-shop/src/components/`):
- `ui/` — `Button`, `Card`, `Dialog`, `Input`, `Label`, `Tabs` (shadcn/ui primitives)
- `layout/` — `ShopHeader`, `ShopFooter`, `ShopLayout`, `FloatingLineButton`
- `catalog/` — `ProductCard`, `FilterSidebar`, `SortDropdown`
- `cart/`, `checkout/`, `orders/` — item rows, stepper, address form, summary card
- `device-submit/` — `DeviceSelector` (brand → model → storage cascade), `DeviceSpecForm` (condition A/B/C + battery + IMEI + notes), `PhotoUploadGrid`, `ValuationDisplay`
- `reviews/` — `ReviewStars`, `ReviewCard`, `CreateReviewForm`, `ReviewsSection`
- `saving-plan/` — `PlanCalculator`, `PlanProgressBar`, `PaymentHistoryTable`

**Please keep component names stable** so the implementer can swap in your designs one-for-one without renaming files.

---

## 4. UX principles (non-negotiable)

1. **Mobile-first.** Design mobile (390×844) FIRST. Desktop is a widening of the mobile layout. Expect 80% mobile traffic.
2. **Thumb zone.** Primary CTA within reach of the right thumb (bottom third of screen). Sticky bottom bar for pages with a single dominant action (cart → checkout, product → reserve).
3. **Thai line-height.** Every Thai text block uses `leading-snug`. Test with a word containing ี ิ ุ.
4. **Loading states on every query.** Don't leave blank gaps. Use skeleton loaders that match the final shape.
5. **Empty states with action.** Every list that could be empty gets a friendly empty state + CTA to start.
6. **LINE as first-class.** "ติดต่อผ่าน LINE" is a consistent floating / bottom-anchored affordance. Not tucked in a footer only.
7. **Trust signals visible within the first viewport.** Warranty, authentic device, number of past customers, staff photo.
8. **Installment math transparent.** Show down payment + monthly + total cost. Never hide any field behind a click.

---

## 5. Pages to design (priority order)

Priority 1 = must have for launch. Priority 2 = nice-to-have within sprint. Priority 3 = later.

### Public / browse (Priority 1)
| Route | File in codebase | What happens | Key UI needs |
|---|---|---|---|
| `/` | `pages/HomePage.tsx` | Landing page | Hero with photo + warranty badges + 4 featured iPhones + "why us" section + testimonials strip + LINE CTA |
| `/products` | `pages/CatalogPage.tsx` | Browse catalog | Filter sidebar (brand, condition grade, price range), sort dropdown, grid of product group cards |
| `/products/:id` | `pages/ProductDetailPage.tsx` | Product group detail | Photo gallery (single photo today — add 360° swiper), price tiers by condition grade, condition chip, spec list, `<ReservationCountdownBadge>` 15-min hold CTA, `<ReviewsSection>` below |

### Purchase flow (Priority 1)
| Route | File | What happens | Key UI |
|---|---|---|---|
| `/cart` | `CartPage.tsx` | Single-item cart with 15-min reservation timer | Item row + countdown + subtotal + "go to checkout" primary CTA + "browse more" secondary |
| `/checkout` | `CheckoutPage.tsx` | 3-step wizard: Address → Shipping → Payment | `<CheckoutStepper>` at top; each step has `<OrderSummaryCard>` on the right (desktop) / bottom sticky (mobile). Payment has PromptPay QR + CC card + bank transfer tabs |
| `/checkout/success/:orderNumber` | `OrderSuccessPage.tsx` | Polls order status until PAID | Big success state; `<OrderStatusBadge>`; "view order" + "back to shop" |

### Account (Priority 1)
| Route | File | What happens | Key UI |
|---|---|---|---|
| `/account` | `account/AccountPage.tsx` | Hub: profile, orders, addresses, saving plans, applications | Card list linking to sub-pages; loyalty points balance prominent |
| `/account/addresses` | `account/AddressBookPage.tsx` | CRUD address book | Card list + "add new" CTA; default-pinned visual |
| `/orders` + `/orders/:n` | `OrdersPage.tsx`, `OrderDetailPage.tsx` | Order list + detail | Status badge timeline; tracking number; cancel + refund CTAs where allowed |

### Applications (Priority 1 — conversion driver)
| Route | File | What happens | Key UI |
|---|---|---|---|
| `/apply/:productId` | `apply/InstallmentApplyPage.tsx` | Installment application form | Product recap card + 6 fields (fullName, phone, nationalId, downPayment, months, notes). Show computed monthly estimate on the right as user types. Trust footer (PDPA) |
| `/apply/success/:applicationNumber` | `apply/ApplySuccessPage.tsx` | Application submitted | Success illustration + 2-hour contact promise + LINE CTA + "what happens next" 3-step |

### Services (Priority 2 — after launch validated)
| Route | File | What happens | Key UI |
|---|---|---|---|
| `/trade-in` | `trade-in/TradeInLandingPage.tsx` | How trade-in works | 3-step hero + "start" CTA |
| `/trade-in/submit` | `trade-in/TradeInSubmitPage.tsx` | Full submit form | `<DeviceSelector>` + `<DeviceSpecForm>` + `<PhotoUploadGrid>` + `<ValuationDisplay>` + seller fields. Progress bar across steps |
| `/trade-in/:id` | `trade-in/TradeInStatusPage.tsx` | Status of submission | Timeline + offered price + photos + accept/reject buttons |
| `/buyback` | `buyback/*` (4 pages) | Same shape as trade-in, but cash-out flow | Mirrors trade-in with cash icon |
| `/saving-plan` | `saving-plan/SavingPlanLandingPage.tsx` | Explainer for ออมดาวน์ | 3-step hero + "create plan" CTA |
| `/saving-plan/create` | `SavingPlanCreatePage.tsx` | Target + calculator | Target input + `<PlanCalculator>` (months slider → monthly amount) + CTA |
| `/saving-plan/:id` | `SavingPlanDetailPage.tsx` | Plan progress | `<PlanProgressBar>` + "pay this installment" CTA + `<PaymentHistoryTable>` |
| `/account/saving-plans` | `account/SavingPlansPage.tsx` | List my plans | Card list |

### Info / footer (Priority 3)
| Route | File | What happens |
|---|---|---|
| `/how-it-works` | `HowItWorksPage.tsx` | How installment + shipping works |
| `/shipping`, `/returns`, `/about`, `/contact` | — | Static info pages |

---

## 6. Photography + assets needed

The shop has **no production photography** right now. Please include in your Figma file placeholder slots for:
- Hero: 1 staff photo in-shop + 1 iPhone-in-hand photo
- Each iPhone model: 3 photos (front, back, lockscreen-on) + 24-frame 360° capture
- Branch photo (for About / Contact)
- Logo mark (current site uses text-only "BESTCHOICE")
- OG image 1200×630 for social share

Ask the owner to brief a photographer (1-day shoot at the Lopburi branch should cover everything). Deliverables from your Figma pass should include shot-list instructions for the photographer.

---

## 7. Accessibility + performance

- All interactive elements keyboard accessible + min 44×44 touch target
- Color contrast ≥ 4.5:1 for body text
- No autoplay video with audio
- Lazy-load below-the-fold product images
- Bundle budget: first-paint JS < 200 KB gzipped (currently 168 KB gzip, leave headroom)

---

## 8. Tech handoff notes (for the implementer after design)

- Stack: React 19 + Vite + Tailwind CSS v4 + shadcn/ui + `lucide-react` icons + `framer-motion` for page transitions (not yet installed — OK to add)
- Font loading: Google Fonts (IBM Plex Sans Thai) already preloaded in `index.html`
- Routing: `react-router` (SPA with Firebase rewrite to `/index.html`)
- State: `@tanstack/react-query` + `zustand` for cart
- Icons: please specify from `lucide-react` only (free + tree-shakes). List the icons used in each frame so the implementer can import them directly.
- Animations: prefer CSS transitions for hover/focus; reserve `framer-motion` for page transitions + modal enter/leave. Respect `prefers-reduced-motion`.

### Token map (Figma → Tailwind class)
| Figma variable | Tailwind class | Value |
|---|---|---|
| `color/primary` | `bg-primary` / `text-primary` | emerald `#1DB446` |
| `color/primary-fg` | `text-primary-foreground` | white |
| `color/bg` | `bg-background` | white |
| `color/card` | `bg-card` | white |
| `color/muted` | `bg-muted` | #F7F8FA |
| `color/muted-fg` | `text-muted-foreground` | #888 |
| `color/border` | `border-border` | #EEE |
| `color/destructive` | `bg-destructive` / `text-destructive-foreground` | #DD2C00 |
| `radius/sm` | `rounded-md` | 6px |
| `radius/md` | `rounded-lg` | 8px |
| `radius/lg` | `rounded-xl` | 12px |
| `radius/xl` | `rounded-2xl` | 16px |

**Do not introduce new hex colors.** If you need a new semantic role (e.g., "warning-tint"), add it as a token + request it from the implementer.

---

## 9. Out of scope for this design pass

- Admin dashboard (separate app at `bestchoicephone.app`)
- LIFF (in-LINE) experience (separate routes under `/liff/*` — already designed)
- Print receipts / legal documents
- Email templates

---

## 10. Deliverables

1. **Figma file** (shared link + editor access) organized as:
   - `01 Foundations` — color tokens, type ramp, spacing scale, elevation, icon set chosen, illustrations/illos
   - `02 Components` — Button (5 variants), Input states, Card patterns, ProductCard, ReviewStars, CheckoutStepper, OrderStatusBadge, DeviceSelector, etc.
   - `03 Pages/Desktop 1440` — all Priority 1 pages
   - `04 Pages/Mobile 390` — all Priority 1 pages
   - `05 Flows` — 3 task flows: **Browse → Reserve → Checkout**, **Apply for installment**, **Trade-in submission**
   - `06 Empty / Loading / Error states` — one board per page
2. **Photography shot list** (PDF or Figma page) telling the photographer what to capture
3. **Handoff notes** in the Figma (as text frames) for anything the implementer should know — e.g., "this card uses `framer-motion` with a 200ms fade-slide on mount"

---

## 11. Review + iteration

Expect 2 rounds of review. Owner + implementer will leave Figma comments; designer resolves and ships v2.

---

*Brief written 2026-04-22. Current shop MVP live at https://bestchoicephone-shop.web.app — please browse it before reading this brief to ground yourself in what exists.*
