# BESTCHOICE Shop — Design References

Curated reference designs for the shop redesign — gathered from live production sites 2026-04-22. Use alongside [SHOP-DESIGN-BRIEF.md](./SHOP-DESIGN-BRIEF.md).

---

## Aesthetic axes

Rate each reference on two axes to visualize the design space:

```
                   MINIMAL ←——————————————→ VIBRANT
    PREMIUM  Apple.com/th ●           ● Studio7.com
                          │            (corporate)
                          │
                Gazelle ● │ Back Market●
           (refurb trust) │     (quirky)
                          │
                 iStudio ●│● BNN (BaNANA)
              (Thai warm) │(Thai big-box)
                          │     ● Shopee / Lazada
    LOCAL ←———————————————┼  ● Power Buy
             ● FB shops / LINE OA shops
                          │     (e.g. Amp Mobile MBK)
                     APPROACHABLE
```

---

## 1. Apple TH — Premium baseline
URL: [apple.com/th](https://www.apple.com/th/shop/buy-iphone)

**Borrow:**
- **Installment-first messaging** — "ผ่อน 0% นานสูงสุด 10 เดือน" repeated on every product card, not tucked in a footer
- **Bank partnership badges** — SCB, KBank, UOB, Krungsri, TMB, BBL logos visible = credibility
- **Trade-in integration** — "Apple Trade In" as a primary nav link
- **Generous whitespace** — one product dominates each scroll section
- **Thai legal detail** — VAT inclusion, free shipping, ID requirements shown (compliance signal)

**Avoid:**
- Too corporate / too premium — doesn't fit a small shop feel
- Brutally minimal — used phones benefit from more trust signals than new

---

## 2. iStudio Thailand — Thai warmth + premium
URL: [istudio.store/en](https://www.istudio.store/en)

**Borrow:**
- **Casual Thai copy** — "สุดปัง", "สุดว้าว", "ฟิ้วววว" — energy + approachability reduces perceived risk on pre-owned products
- **Dual-language headers** — Thai casual + English formal product positioning
- **Trade-in CTA with amount** — "up to ฿26,200 value" shows concrete number, not vague "trade in your device"
- **Service reassurance strip** — "On-Site Service support" + 0% financing + store locator as a trio
- **Grid product cards** with starting-price + CTA variants ("Buy now", "Shop Now", "Notify me")

**Avoid:**
- Asymmetric product card imagery (left/right swap) — harder to implement + scan
- Multiple rotating hero banners — split attention

**Most relevant reference for BESTCHOICE.** Target audience overlap is high.

---

## 3. Gazelle — Refurb trust specialist
URL: [buy.gazelle.com/collections/iphones](https://buy.gazelle.com/collections/iphones)

**Borrow:**
- **Trust signals above the fold** — "Free 30-Day Returns", "Free Shipping", "Certified 55-Point Inspection", "Customer Service 7 Days a Week" as a bar, not footer
- **Three-tier condition grading** — "Fair / Good / Excellent" with price ranges per tier — maps to our A/B/C
- **"Peace of mind is a few dollars away"** — explicit warranty upsell copy
- **"Sell to Us" nav link** — pairs with purchase flow (our Trade-In does this)
- **Filtering depth** — carrier, model, storage, color — critical for used market where specs vary
- **Availability count** — "53 in stock" vs "323 out of stock" — urgency without manipulation

**Avoid:**
- Stark minimalism — too cold for Thai market
- English-only tone — wouldn't work for BESTCHOICE
- No lifestyle / human elements — misses trust opportunity

---

## 4. Studio7 — Thai corporate premium
URL: [studio7thailand.com/en](https://www.studio7thailand.com/en)

**Borrow:**
- **Authorized partner badge** — "Apple Premium Partner" (we can't use this but can show legit dealer relationships e.g., "Authorized LINE OA", "PaySolutions verified")
- **"iCare Store"** — service brand (we can parallel with "BESTCHOICE Care" or "Shop Warranty")
- **Click-and-collect option** ("1-hour click & collect") — branch pickup is our BRANCH_PICKUP shipping method

**Avoid:**
- Corporate blue (#1212BB) — too formal for a neighborhood shop
- "Feature stacked. Value packed" English taglines — not our voice
- Heavy navigation depth — we have 20 pages, not 200

---

## 5. BaNANA (BNN) — Thai big-box badge-heavy
URL: [bnn.in.th](https://www.bnn.in.th/en/p/smartphone-and-accessories/smartphone)

**Borrow:**
- **Price-range tier filters** — "3K / 5K / 10K / 15K+" budget buckets match how Thai customers shop
- **Trust certifications** — DBD (ผู้ประกอบการพาณิชย์อิเล็กทรอนิกส์) + OCPB badges in footer
- **Delivery partner logos** — Kerry, DHL (we can show Kerry/Flash/J&T)
- **Sticky filtering** — mobile filter drawer rather than sidebar on small screens
- **Savings callout** — "Save up to ฿4,000" — specific ฿ amount > percent

**Avoid:**
- **Badge pollution** — layered "New_Product_Feb2026" + "ผ่อน 0%" + "ฟรีของแถม" + red sale tag on every card → visual noise
- Budget-retailer vibe — conflicts with "trusted neighborhood shop" positioning
- Mixed-brand chaos — we only sell iPhones + a few Android, not 1000+ SKUs

---

## 6. Back Market — Refurb quirky global
URL: [backmarket.com](https://www.backmarket.com/en-us/l/iphone/)
(direct fetch blocked; design notes from 2026 search)

**Known patterns:**
- **"Certified refurbished"** as hero claim
- **Three condition tiers:** Fair → Good → Excellent — matching Gazelle
- **12-month minimum warranty** + **30-day money back guarantee** — above-the-fold
- **Quirky brand voice** — "Make the planet and your wallet happy" — sustainability angle
- **Price comparison to new** — struck-through MSRP above refurb price
- **Huge discount claim** — "40-55% off"

**Borrow:**
- Minimum-warranty + money-back-guarantee prominence
- Struck-through MSRP → refurb-price comparison
- Condition tier + warranty pairing

**Avoid:**
- Sustainability / planet angle — not our positioning
- International brand voice — we're neighborhood-tier

---

## 7. Thai LINE-OA / Facebook shops — Approachable local character
Examples:
- [Amp Mobile MBK](https://www.facebook.com/ampmobilee/) (Facebook page)
- [NASA Phone](https://www.facebook.com/nasaphone/) (wholesale)
- [OM Secondhand Mobile](https://www.facebook.com/OMsecondhandshop/)
- [Green Phone](https://www.facebook.com/greenphoneshop/) (Nakhon Ratchasima — tier-2 city like Lopburi)

**Patterns in the wild:**
- **Human staff photos** everywhere — ลุง/ป้า/พี่ smiling with iPhone in hand
- **LINE ID prominent** on cover photo + every post (@shop-name format)
- **Screenshot-of-reviews posts** — actual customer LINE chats as social proof
- **Short videos of actual phones** — unboxing, battery test, authenticity demo
- **Map + phone + LINE in every post** — local discoverability
- **Thai colloquial copy** — "เครื่องสวยใส", "ของมือ 1 ของแท้ชัวร์", "จ่ายสบายไม่ต้องบัตร"

**Borrow:**
- **Staff photo section** — owner + team photo on About / Contact + small avatar on Home hero
- **Real LINE chat screenshots as social proof** — aim for a "customers said" carousel
- **Map + opening hours + LINE CTA** prominent on every page footer
- **Video playlist** on ProductDetail (unboxing + battery check)
- **Colloquial Thai headlines** — "ผ่อนได้ ไม่ต้องบัตร", "ของแท้ชัวร์ 100%"

**Avoid:**
- Facebook-native visual clutter — emoji spam, neon text, wall-of-text captions
- Inconsistent layout across posts — we need design-system consistency

**Most culturally relevant reference.** These are our direct local competitors.

---

## Recommended hybrid direction

**iStudio warmth + Gazelle trust clarity + Apple TH installment transparency + LINE-OA local character**

Concrete translation to BESTCHOICE:

| Element | Borrow from | Implementation |
|---|---|---|
| Hero tone | iStudio + LINE-OA shops | Casual Thai tagline + staff-photo-in-shop hero (not device-only) |
| Product card | Gazelle + BNN | Photo + model + starting ฿ + monthly installment ฿ + condition badge (A/B/C tier) + stock count |
| Trust strip | Gazelle + Apple TH | "ตรวจสอบ 30 จุด" + "รับประกันร้าน 30 วัน" + "ผ่อนได้บัตรประชาชนใบเดียว" + bank/Paysolutions logos |
| Installment display | Apple TH | Monthly ฿ shown on card, full calculation expanded on detail page, no surprise fees |
| Trade-in callout | iStudio | Concrete ฿ example ("ตีราคาสูงสุด ฿15,000") in nav + Home |
| Condition grading | Gazelle + Back Market | A/B/C visible chip on every card with clear definition tooltip |
| Social proof | LINE-OA shops | Real customer review carousel + LINE chat screenshots |
| Footer | Local shops | Map + opening hours + LINE CTA + DBD/OCPB trust badges |
| Voice | iStudio + Green Phone | Warm casual Thai — "สบายๆ" but not sloppy |

**AVOID across the board:**
- Neon red/yellow sale banners
- Flashing countdown timers
- Gamified "spin the wheel" offers
- Generic stock iPhone photos (audience won't trust it)
- Corporate English-heavy headlines
- Emoji in UI (use `lucide-react` icons)

---

## What the shop has today (reminder)

- Color: emerald `#1DB446` primary, neutrals zinc-family, one Thai font (IBM Plex Sans Thai) — **keep**
- No hero imagery — **needs photo or illustration**
- No trust strip — **add per Gazelle/Apple pattern**
- No condition badge on cards — **add per Gazelle/Back Market pattern**
- No monthly installment display on card — **add per Apple TH pattern**
- No staff/human presence — **add per LINE-OA shop pattern**
- No LINE CTA except in footer — **promote to floating button + hero CTA**
- No real reviews visible — **build carousel per LINE-OA screenshots pattern**

---

## Next step

Pick an aesthetic direction:

- **Direction 1:** Hybrid recommended above (iStudio + Gazelle + LINE-OA)
- **Direction 2:** Closer to Apple TH (premium-tech feel, less local character)
- **Direction 3:** Closer to LINE-OA local shops (more human, less polished e-commerce)
- **Direction 4:** Something else (designer's call)

Once picked, the implementer will:
1. Build the token/component library against that direction
2. Apply it page-by-page starting with Home → ProductDetail → Checkout → Apply
3. Produce a Figma-equivalent in HTML so the owner can click through before we overwrite production
