# BESTCHOICE Online Shop — Design Spec

> **Created:** 2026-04-20
> **Status:** APPROVED — ready for implementation planning
> **Predecessor docs:** docs/CTO-ROADMAP-2026.md (referenced as "e-commerce" extension)

---

## 1. Scope & Goals

### Project name
**BESTCHOICE Online Shop** — public-facing e-commerce site for the Lopburi-based phone shop.

### Business goals
1. Expand sales channel from "Lopburi storefront only" → online (target: ภาคกลางตอนบน — สระบุรี / สิงห์บุรี / อยุธยา)
2. Reduce friction for existing customers (browse + apply 24/7 without travel)
3. Differentiate from competitors (Ufriend, Uficon, Banana Pay Easy, BackMarket): pricing transparent + interest rate disclosed + LIFF + reservation pattern

### Scope (5 services + 1 new feature)
1. **ขายเงินสด (Cash sale)** — fully online: select → pay QR/card → ship Kerry/Flash or branch pickup
2. **ผ่อนมือใหม่ (Installment new)** — short online apply form → schedule branch visit
3. **ผ่อนมือสอง (Installment used)** ⭐ — same as #2 (84% of historical sales)
4. **เก่าแลกใหม่ (Trade-in)** — submit photos + spec → 24h quote → branch visit
5. **รับซื้อมือสอง (Buyback)** — instant rough quote → photos → 24h final quote → branch
6. **ออมดาวน์ (Saving plan)** — NEW: customer saves monthly → use as down payment

### Out of scope (Phase 1)
- ❌ ไอโฟนแลกเงิน (skipped per owner)
- ❌ Phase 4 deferred items: PEAK / MDM / CHATCONE / GFIN

### Constraints (driving design)
- **No credit bureau check** → max term 12 months stays, down payment required (no 0% down)
- **No installment shipping** → installment customers must come to branch (verify identity, prevent fraud)
- **Cash shipping OK** → customer pays in full first, low fraud risk

### Success metrics
- Online orders launching within 3 months
- 30% of new customers from online by month 6
- Cart-to-purchase conversion > 5%
- Online apply → branch visit scheduled < 2 hours

---

## 2. Customer Personas

Based on analysis of 440 active customers + competitor research (2026-04-20).

### Primary: บีม — โรงงาน Minebea (40%)
| | |
|---|---|
| Age | 28 |
| Job | พนักงานโรงงาน Minebea Mitsumi (มินิแบร์), Lopburi |
| Salary | 14,000 + OT ~17,000 |
| Location | ลพบุรี (เมือง / โคกสำโรง) |
| Shift | กะกลางคืน + พัก 2 ชม |
| Current phone | iPhone 11 Pro มือสอง |
| Digital | LINE 24/7, FB, TikTok, **mobile only at dorm** |

**Goals:** อัพเกรด iPhone 13/14 มือสอง, ผ่อน 1,500-2,000/เดือน, รับเครื่องเร็ว
**Pains:** dorm = no PC, limited time, fear scam used phones
**Behavior:** browse during shift breaks (12:00, late-night), LINE chat before deciding, weekend pickup

### Secondary: พี่ปู — ทหารค่ายลพบุรี (15-20%)
| | |
|---|---|
| Age | 35 |
| Job | จ่าทหาร (ค่ายภูมิรักษ์ / ค่ายเอราวัณ) |
| Salary | 22,000 |
| Family | married, 1 child |

**Goals:** ซื้อเครื่องใหม่เงินสดให้ครอบครัว, รับประกันแน่นอน
**Pains:** ไม่มีเวลาในวันธรรมดา, ต้องการความน่าเชื่อถือ
**Behavior:** desktop + mobile, reads spec/warranty, Facebook search → ship to base address

### Tertiary: แอน — พนักงานราชการอยุธยา (10-15%)
| | |
|---|---|
| Age | 32 |
| Job | ครู / อบต. / สาธา |
| Salary | 18,000 |
| Location | อยุธยา / สิงห์บุรี (ไม่ใช่ลพบุรี) |

**Goals:** อัพเกรดมือสองคุณภาพ, ผ่อนงวดเล็ก, ไม่อยากเสียเที่ยวมาเปล่า
**Pains:** ใกล้บ้านไม่มี iPhone มือสองคุณภาพ
**Behavior:** เจรจาผ่าน LINE → ขอ photos จริง → เดินทางมารับเฉพาะถ้ามั่นใจ

### Anti-personas (NOT designing for)
- 🚫 Credit card holders (we = "no CC needed")
- 🚫 Latest Pro Max buyers (Apple Store dominant)
- 🚫 Android buyers (we specialize iPhone — 100% of top 10 sales)

---

## 3. User Journeys

### Journey 1: บีม → ผ่อน iPhone 13 มือสอง (primary flow)

```
[Dorm, mobile, 13:00 lunch break]
1. Google → ร้านมือถือลพบุรี → click site
2. Homepage: see iPhone 13 hero + "ผ่อนเริ่ม 1,162 บ/เดือน"
3. Click iPhone 13 256GB → see Grade A/B/C tiers (12,500-13,900)
4. Select Grade A → system shows specific unit:
   - 5 photos + 360° + Battery 92% + IMEI partial
5. Tap "ผ่อน 12 เดือน × 1,162 บาท"
6. System reserves unit 15 min → opens LINE binding
7. Short form (name, phone, NID) → submit
8. LINE notification: "บันทึกแล้ว ทีมจะติดต่อใน 2 ชม"

[14:00 back to work]

9. 16:00 — staff calls back, schedules Saturday 10:00 visit
10. Saturday: visit branch → docs check → sign contract → take phone

Total: 3 days (Wed → Sat)
```

### Journey 2: พี่ปู → Cash iPhone 15 ship to home

```
[Home, desktop, 21:00 after kids sleep]
1. Facebook ad → site → iPhone 15 256GB
2. Read spec, warranty, trust signals
3. Add to cart → checkout
4. Address: ค่ายลพบุรี → Kerry 60 บาท
5. Pay PromptPay QR → 35,960 บาท total
6. LINE: "ออเดอร์ #BC-1234 รับชำระ — ส่งวันนี้"
7. Next day: staff packs → ship → tracking via LINE
8. Day +2: receive at base → confirm received → loyalty points

Total: 3 days
```

### Journey 3: แอน → ผ่อน + travel from อยุธยา

```
[Saturday morning, mobile]
1. Search → site → iPhone 13 Grade A
2. See unit photos + 360° + battery
3. Hesitates ("travel far, must be sure")
4. LINE chat → ask "เครื่องนี้จะอยู่จนเสาร์หน้าไหม?"
5. Staff: "reserve กันคนอื่นซื้อก่อน — ส่ง NID + ข้อตกลง"
6. Send NID via LINE → system extends reservation 3 days
7. Next Saturday: travel to Lopburi → docs + sign + receive

Total: 1 week
```

### Cross-cutting flows

**Trade-in flow:**
1. Existing customer wants upgrade → /trade-in
2. Submit form: เครื่องเก่า rrunคgn brand/model/storage + 4 photos + spec
3. Wait 24h → quote (e.g., 8,500)
4. Choose new phone → apply installment for difference
5. Schedule branch visit → trade phone + sign contract + take new

**Buyback flow:**
1. Customer wants to sell phone (no purchase) → /buyback
2. Quick quote dropdown → instant range (8,000-10,000)
3. Submit photos + spec details
4. Wait 24h → final quote (e.g., 9,500)
5. Branch visit → inspect → cash payment

**ออมดาวน์ flow:**
1. Customer picks target: iPhone 14 = 18,000
2. Set plan: save 1,500/month × 6 months = 9,000 (toward down)
3. Each month: LINE reminder → pay QR
4. Goal reached → notification "use savings as down"
5. Visit branch → choose actual unit → installment for remaining

---

## 4. Technical Architecture

### Stack
- **Frontend:** React 19 + Vite + Tailwind + shadcn/ui (same as existing app)
- **Backend:** NestJS + Prisma (existing)
- **Database:** PostgreSQL (existing) — add new tables
- **Storage:** GCS (existing) for product photos + 360° frames
- **Auth:** LINE Login + Facebook Login + Phone OTP
- **Notify:** LINE OA only (existing line-oa module)
- **Payment:** PaySolutions (existing) + PromptPay QR (new)
- **CDN:** Cloudflare (free tier)

### Architecture diagram

```
                          ┌─────────────────────────────────────┐
                          │  Public Web                          │
                          │  shop.bestchoicephone.app            │
                          │  React SPA — responsive              │
                          └──────────────┬──────────────────────┘
                                         │ JWT in-memory (where needed)
                          ┌──────────────▼──────────────────────┐
                          │  /api/shop/*  (new namespace)        │
                          │  NestJS modules:                     │
                          │  - shop-catalog                      │
                          │  - shop-cart                         │
                          │  - shop-checkout                     │
                          │  - shop-installment-apply            │
                          │  - shop-tradein                      │
                          │  - shop-buyback                      │
                          │  - shop-saving-plan                  │
                          │  - shop-tracking (visitor analytics)│
                          │  - shop-bot-defense                  │
                          └──────────────┬──────────────────────┘
                                         │
                  ┌──────────────────────┼──────────────────────┐
                  ▼                      ▼                      ▼
         ┌────────────────┐    ┌────────────────┐    ┌────────────────┐
         │ Existing modules│    │ Existing modules│    │ Existing modules│
         │ - products      │    │ - sales         │    │ - line-oa      │
         │ - inventory     │    │ - contracts     │    │ - paysolutions │
         │ - customers     │    │ - kyc           │    │ - notifications│
         │ - promotions    │    │ - credit-check  │    │ - storage(GCS) │
         │ - loyalty       │    │ - trade-in      │    │ - chat-engine  │
         └────────────────┘    └────────────────┘    └────────────────┘

                          ┌─────────────────────────────────────┐
                          │  Existing Admin Web (no change)     │
                          │  - Receive online orders queue      │
                          │  - Approve installment apply        │
                          │  - Process trade-in / buyback       │
                          │  - Stock management                 │
                          └─────────────────────────────────────┘
```

### Key design decisions

1. **Separate domain `shop.bestchoicephone.app`**
   - Decoupled from admin app
   - SEO-optimized public site
   - Static asset caching via Cloudflare CDN

2. **New API namespace `/api/shop/*`**
   - Doesn't affect internal endpoints
   - Separate rate limiting + auth strategy
   - Public endpoints (no JWT) for catalog/calculator
   - Authenticated endpoints (JWT) for checkout/apply/orders

3. **Re-use existing modules**
   - Do NOT recreate products / customers / sales modules
   - Create `shop-*` modules that orchestrate existing modules
   - 1 new model: `SavingPlan` (ออมดาวน์)
   - Add fields to existing: `Product`, `Sale`, `Customer`

4. **Reservation pattern**
   - Redis lock 15 minutes per unit
   - In-store sales preempt online reservations (in-store priority B)
   - LINE notification on preemption

5. **Payment flow (cash)**
   - PaySolutions API (existing) for credit/debit
   - PromptPay QR (new in paysolutions module)
   - Auto-confirm on webhook → order status → LINE notify

6. **LINE-first design**
   - LINE Login OAuth → bind to Customer record
   - LINE OA notifications (replace SMS for cost)
   - LIFF future support (Phase 2 post-launch)

### State diagrams

**Cash order:**
```
DRAFT → PENDING_PAYMENT → PAID → PACKING → SHIPPED → DELIVERED → COMPLETED
                              ↓
                            FAILED (refund)
                            CANCELLED (15-min timeout)
```

**Installment application:**
```
SUBMITTED → SCHEDULED → IN_REVIEW (at branch) → APPROVED → CONTRACT_SIGNED → ACTIVE
                                              ↓
                                           REJECTED (notify)
                                           NO_SHOW (expires 7 days)
```

**Reservation:**
```
NONE → RESERVED (15min) → CONSUMED (purchased)
                       ↓
                    EXPIRED → released
                    CANCELLED → released
                    PREEMPTED → in-store sold first
```

---

## 5. Component Architecture

### Page structure (full route map)

```
shop.bestchoicephone.app/
├── /                                  Home: hero + featured + services
├── /products                          Catalog: grid + filter + sort
│   └── /:slug                         Detail: photos + 360° + tier + reservation
├── /cart                              Cart: items + apply promo + checkout
├── /checkout                          Checkout: address + shipping + payment
│   └── /success/:orderId              Order success + LINE binding
├── /apply                             Installment apply
│   └── /:reservationId                with selected phone context
│   └── /success                       Submitted + next steps
├── /trade-in                          Trade-in landing
│   ├── /quote                         Quote form
│   └── /:tradeInId                    Status page
├── /buyback                           Buyback landing
│   ├── /quote                         Quick dropdown
│   ├── /detail                        Photos + spec
│   └── /:buybackId                    Status page
├── /saving-plan                       ออมดาวน์ landing
│   ├── /create                        Create plan
│   └── /:planId                       Status + history
├── /orders                            My orders (auth)
│   └── /:orderId                      Detail + tracking
├── /account                           Profile (auth)
│   ├── /profile                       Edit profile
│   ├── /addresses                     Saved addresses
│   └── /loyalty                       Points balance + history
├── /how-it-works                      Static: process explanation
├── /shipping                          Static: shipping policy
├── /returns                           Static: return policy
├── /about                             Static: about us
└── /contact                           LINE QR + map + phone
```

### Key components (high level)

**Catalog Page**
- FilterSidebar (price/brand/storage/color/condition tier/availability)
- ProductGrid with ProductCard (image, "from" price, installment badge, smart stock count, condition tier badge)
- SortDropdown (price, popularity, newest)
- Pagination

**Product Detail Page** ⭐ (most complex)
- ProductGallery: PhotoCarousel + Photo360Viewer (react-360-view) + ZoomLens
- ProductInfo:
  - Title + breadcrumb
  - ConditionTierTabs (Grade A/B/C) — price changes per tier
  - UnitDisplay (specific unit shown when tier selected): photos, IMEI partial, battery health, accessories, "use this unit" / "next unit" / "change tier"
  - PaymentCalculator (interactive: down/months → monthly payment + total + interest rate display)
  - CTAButtons: BuyNowCash + ApplyInstallment
  - TrustSignals (warranty, return policy, verified)
- RelatedProducts

**Reservation Modal**
- 15-minute countdown timer
- Unit summary
- Choice: Cash → /checkout, Installment → /apply
- Cancel reservation

**Checkout 3-step Wizard**
- Step 1 Address: AddressBook + new address form
- Step 2 Shipping: Branch pickup / Kerry / Flash / J&T (with rates)
- Step 3 Payment: PromoCode + LoyaltyApply + PaymentMethod (PromptPay/Bank/Card) + OrderSummary + Place button

**Installment Apply Form**
- Selected product summary
- Customer basic form (name, phone, NID — short)
- PaymentPreview (down + months → monthly)
- LineBindingButton (required)
- Submit

**Trade-in / Buyback Quote Form**
- DeviceSelector (cascade: brand → model → storage)
- QuickQuoteDisplay (instant range)
- PhotoUpload (max 5)
- SpecForm (battery, condition, accessories)
- Submit

**Saving Plan Create**
- TargetProductSelect
- PlanCalculator (monthly × duration → total)
- PaymentSchedule
- Create button

**Shared Layout**
- ShopHeader: Logo + SearchBar + NavMenu + CartIcon + UserMenu
- ShopFooter: contact, social, payment methods, trust badges
- FloatingLineButton (chat with shop)

### Re-use from existing app
- All shadcn/ui components
- `useDebounce`, `useIsMobile` hooks
- API client (with shop-specific interceptor)
- Toast (sonner)
- Date / currency formatters

### New libraries
- `react-360-view` or `threesixty-js` — 360° viewer
- `react-image-magnify` — photo zoom
- `react-hook-form` + `zod` — already in project
- ❌ NO redux/mobx — Zustand is sufficient

---

## 6. Data Model

### New tables

#### `SavingPlan` (ออมดาวน์)
```prisma
model SavingPlan {
  id                String      @id @default(uuid())
  customerId        String      @map("customer_id")
  customer          Customer    @relation(fields: [customerId], references: [id])
  targetProductModel String?    @map("target_product_model")
  targetProductId   String?     @map("target_product_id")
  targetAmount      Decimal     @map("target_amount") @db.Decimal(12, 2)
  monthlyAmount     Decimal     @map("monthly_amount") @db.Decimal(12, 2)
  durationMonths    Int         @map("duration_months")
  totalSaved        Decimal     @default(0) @map("total_saved") @db.Decimal(12, 2)
  status            SavingPlanStatus @default(ACTIVE)
  startedAt         DateTime    @map("started_at")
  completedAt       DateTime?   @map("completed_at")
  cancelledAt       DateTime?   @map("cancelled_at")
  appliedToContractId String?   @map("applied_to_contract_id")
  createdAt         DateTime    @default(now()) @map("created_at")
  updatedAt         DateTime    @updatedAt @map("updated_at")
  deletedAt         DateTime?   @map("deleted_at")
  payments          SavingPlanPayment[]

  @@index([customerId])
  @@index([status])
  @@map("saving_plans")
}

enum SavingPlanStatus { ACTIVE COMPLETED APPLIED CANCELLED }

model SavingPlanPayment {
  id            String      @id @default(uuid())
  savingPlanId  String      @map("saving_plan_id")
  savingPlan    SavingPlan  @relation(fields: [savingPlanId], references: [id])
  amount        Decimal     @db.Decimal(12, 2)
  paidAt        DateTime    @map("paid_at")
  paymentMethod String      @map("payment_method")
  paymentRef    String?     @map("payment_ref")
  createdAt     DateTime    @default(now()) @map("created_at")

  @@index([savingPlanId])
  @@map("saving_plan_payments")
}
```

#### `ProductReservation` (15-min hold)
```prisma
model ProductReservation {
  id          String   @id @default(uuid())
  productId   String   @map("product_id")
  product     Product  @relation(fields: [productId], references: [id])
  customerId  String?  @map("customer_id")
  sessionId   String   @map("session_id")
  reservedAt  DateTime @default(now()) @map("reserved_at")
  expiresAt   DateTime @map("expires_at")
  status      ReservationStatus @default(ACTIVE)
  consumedById String? @map("consumed_by_id")
  createdAt   DateTime @default(now()) @map("created_at")

  @@index([productId, status])
  @@index([customerId])
  @@index([expiresAt])
  @@map("product_reservations")
}

enum ReservationStatus { ACTIVE EXPIRED CONSUMED CANCELLED PREEMPTED }
```

#### `OnlineOrder` (cash sale)
```prisma
model OnlineOrder {
  id              String   @id @default(uuid())
  orderNumber     String   @unique @map("order_number")
  customerId      String   @map("customer_id")
  customer        Customer @relation(fields: [customerId], references: [id])
  productId       String   @map("product_id")
  product         Product  @relation(fields: [productId], references: [id])
  reservationId   String   @map("reservation_id")
  reservation     ProductReservation @relation(fields: [reservationId], references: [id])
  // Pricing
  productPrice    Decimal  @map("product_price") @db.Decimal(12, 2)
  shippingFee     Decimal  @default(0) @map("shipping_fee") @db.Decimal(12, 2)
  discountAmount  Decimal  @default(0) @map("discount_amount") @db.Decimal(12, 2)
  loyaltyPointsUsed Int    @default(0) @map("loyalty_points_used")
  loyaltyDiscount Decimal  @default(0) @map("loyalty_discount") @db.Decimal(12, 2)
  promoCode       String?  @map("promo_code")
  totalAmount     Decimal  @map("total_amount") @db.Decimal(12, 2)
  // Shipping
  shippingMethod  String   @map("shipping_method")
  shippingAddress Json?    @map("shipping_address")
  trackingNumber  String?  @map("tracking_number")
  shippedAt       DateTime? @map("shipped_at")
  deliveredAt     DateTime? @map("delivered_at")
  // Payment
  paymentMethod   String   @map("payment_method")
  paymentRef      String?  @map("payment_ref")
  paidAt          DateTime? @map("paid_at")
  status          OnlineOrderStatus @default(DRAFT)
  // Linkage
  saleId          String?  @unique @map("sale_id")
  sale            Sale?    @relation(fields: [saleId], references: [id])

  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")
  deletedAt       DateTime? @map("deleted_at")

  @@index([customerId])
  @@index([status])
  @@index([orderNumber])
  @@map("online_orders")
}

enum OnlineOrderStatus { DRAFT PENDING_PAYMENT PAID PACKING SHIPPED DELIVERED COMPLETED CANCELLED REFUNDED }
```

#### `OnlineInstallmentApplication`
```prisma
model OnlineInstallmentApplication {
  id              String   @id @default(uuid())
  applicationNumber String @unique @map("application_number")
  customerId      String?  @map("customer_id")
  productId       String   @map("product_id")
  reservationId   String   @map("reservation_id")
  fullName        String   @map("full_name")
  phone           String
  nationalId      String   @map("national_id")  // encrypted via Phase 6.5
  proposedDownPayment Decimal @map("proposed_down_payment") @db.Decimal(12, 2)
  proposedTotalMonths Int     @map("proposed_total_months")
  proposedMonthlyPayment Decimal @map("proposed_monthly_payment") @db.Decimal(12, 2)
  lineUserId      String?  @map("line_user_id")
  status          ApplicationStatus @default(SUBMITTED)
  scheduledAt     DateTime? @map("scheduled_at")
  reviewedAt      DateTime? @map("reviewed_at")
  reviewedById    String?   @map("reviewed_by_id")
  rejectReason    String?   @map("reject_reason")
  contractId      String?   @unique @map("contract_id")

  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")
  deletedAt       DateTime? @map("deleted_at")

  @@index([phone])
  @@index([status])
  @@map("online_installment_applications")
}

enum ApplicationStatus { SUBMITTED SCHEDULED IN_REVIEW APPROVED CONTRACT_SIGNED REJECTED NO_SHOW EXPIRED CANCELLED }
```

### Visitor Analytics tables

#### `WebsiteVisit` (raw events)
```prisma
model WebsiteVisit {
  id            String   @id @default(uuid())
  sessionId     String   @map("session_id")
  customerId    String?  @map("customer_id")
  ipHash        String   @map("ip_hash")           // SHA-256 + salt (PDPA-safe)
  ipCountry     String?  @map("ip_country")
  ipProvince    String?  @map("ip_province")
  userAgent     String?  @map("user_agent") @db.Text
  device        String?
  browser       String?
  os            String?
  pagePath      String   @map("page_path")
  referrer      String?
  utmSource     String?  @map("utm_source")
  utmMedium     String?  @map("utm_medium")
  utmCampaign   String?  @map("utm_campaign")
  visitedAt     DateTime @default(now()) @map("visited_at")
  durationSec   Int?     @map("duration_sec")

  @@index([sessionId])
  @@index([customerId])
  @@index([visitedAt])
  @@index([ipHash, visitedAt])
  @@index([pagePath, visitedAt])
  @@map("website_visits")
}
```

#### `WebsiteSession` (grouped)
```prisma
model WebsiteSession {
  id            String   @id @default(uuid())
  sessionId     String   @unique @map("session_id")
  customerId    String?  @map("customer_id")
  ipHash        String   @map("ip_hash")
  device        String?
  browser       String?
  startedAt     DateTime @map("started_at")
  endedAt       DateTime? @map("ended_at")
  pageCount     Int      @default(0) @map("page_count")
  durationSec   Int?     @map("duration_sec")
  reachedCart   Boolean  @default(false) @map("reached_cart")
  reachedCheckout Boolean @default(false) @map("reached_checkout")
  completedOrder Boolean @default(false) @map("completed_order")
  orderId       String?  @map("order_id")
  entryPage     String   @map("entry_page")
  exitPage      String?  @map("exit_page")
  referrer      String?
  utmSource     String?  @map("utm_source")
  utmCampaign   String?  @map("utm_campaign")

  @@index([customerId])
  @@index([startedAt])
  @@index([ipHash, startedAt])
  @@map("website_sessions")
}
```

#### `DailyVisitStats` (pre-aggregated)
```prisma
model DailyVisitStats {
  id              String   @id @default(uuid())
  date            DateTime @unique @map("date") @db.Date
  uniqueIps       Int      @map("unique_ips")
  uniqueSessions  Int      @map("unique_sessions")
  loggedInUsers   Int      @map("logged_in_users")
  totalPageViews  Int      @map("total_page_views")
  productViews    Int      @map("product_views")
  cartReached     Int      @map("cart_reached")
  checkoutReached Int      @map("checkout_reached")
  ordersCompleted Int      @map("orders_completed")
  totalRevenue    Decimal  @default(0) @map("total_revenue") @db.Decimal(12, 2)
  bySource        Json?    @map("by_source")
  byProvince      Json?    @map("by_province")
  byDevice        Json?    @map("by_device")
  byHour          Json?    @map("by_hour")
  createdAt       DateTime @default(now()) @map("created_at")

  @@map("daily_visit_stats")
}
```

### Bot Defense tables

#### `BotDetectionLog`
```prisma
model BotDetectionLog {
  id            String   @id @default(uuid())
  ipHash        String   @map("ip_hash")
  userAgent     String   @map("user_agent") @db.Text
  detectedType  BotType  @map("detected_type")
  signals       Json
  pagePath      String   @map("page_path")
  action        BotAction
  detectedAt    DateTime @default(now()) @map("detected_at")
  createdAt     DateTime @default(now()) @map("created_at")

  @@index([ipHash, detectedAt])
  @@index([detectedType, detectedAt])
  @@map("bot_detection_logs")
}

enum BotType { AI_CRAWLER GENERIC_BOT SCRAPER HEADLESS_BROWSER RATE_ABUSE PRICE_MONITOR KNOWN_GOOD }
enum BotAction { LOGGED RATE_LIMITED CAPTCHA_REQUIRED BLOCKED CLOAKED }
```

#### `IpRateLimit`
```prisma
model IpRateLimit {
  ipHash          String   @id @map("ip_hash")
  windowStart     DateTime @map("window_start")
  requestCount    Int      @default(0) @map("request_count")
  blockedUntil    DateTime? @map("blocked_until")
  blockReason     String?   @map("block_reason")
  pagesVisited    Int      @default(0) @map("pages_visited")
  uniquePagesVisited Int   @default(0) @map("unique_pages_visited")
  lastUserAgent   String?   @map("last_user_agent") @db.Text

  @@index([blockedUntil])
  @@map("ip_rate_limits")
}
```

### Existing model additions

#### Product
```prisma
// Add fields:
conditionGrade      String?  @map("condition_grade")     // A, B, C
gallery             String[] @default([])                 // photo URLs
gallery360          String[] @default([])                 // 360° frame URLs
isOnlineVisible     Boolean  @default(true) @map("is_online_visible")
onlineDescription   String?  @map("online_description") @db.Text
reservations        ProductReservation[]
onlineOrders        OnlineOrder[]
```

#### Sale
```prisma
saleSource      String?  @default("OFFLINE") @map("sale_source")  // OFFLINE, ONLINE
onlineOrderId   String?  @unique @map("online_order_id")
```

#### Customer
```prisma
shippingAddresses   Json[]  @default([]) @map("shipping_addresses")
facebookUserId      String? @map("facebook_user_id")
```

### Bot Defense Strategy

**Hybrid approach:** allow AI for marketing/SEO, block for data scraping.

**Allow these AI crawlers** (drives discoverability):
- GPTBot, ClaudeBot, Anthropic-AI, PerplexityBot, Google-Extended
- Allow: marketing pages, static pages, general product info
- Disallow: /api/*, /apply, /checkout, /orders, /account

**Block these aggressive scrapers:**
- CCBot (Common Crawl), Bytespider (TikTok)

**Defense in depth:**
| Defense | How |
|---------|-----|
| robots.txt | Allow list AI crawlers + block aggressive scrapers |
| Cloudflare Turnstile | Invisible CAPTCHA on cart/checkout |
| Rate limit per IP | 100 req/min general, 10 req/min on /products/* |
| Honeypot field | Hidden form input (real users skip, bots fill) |
| JS-required actions | Reservation/checkout require JS to fingerprint |
| No public price API | Prices via HTML render, not JSON endpoint |
| Watermark images | Subtle watermarks for traceback |
| Lazy load pricing | Real-time prices in 2nd request after session verified |

**Honeypot products:**
- 2-3 fake products hidden (display:none + screen-reader hidden)
- Scraper requesting these = identified → block

**SEO + AI Discovery (allow strategy):**
- Schema.org structured data (JSON-LD per product)
- Heading hierarchy (H1→H2→H3)
- Alt text on all images
- Local SEO content (ลพบุรี, ผ่อน iPhone ลพบุรี)
- FAQ pages for AI parsing
- llms.txt summary file

### PDPA Compliance
- IP hashed (SHA-256 + salt) — no plaintext IP stored
- Customer data linked only when logged in
- Cookie consent banner (first visit)
- Retention: raw visits 90 days, sessions 1 year, daily stats forever (anonymized)
- DSAR: customer can request data deletion

### Indexes Strategy
| Table | Index | Why |
|-------|-------|-----|
| product_reservations | (productId, status) | active reservation lookup |
| product_reservations | (expiresAt) | cron cleanup |
| online_orders | (orderNumber) | tracking lookup |
| online_orders | (customerId, status) | my orders |
| online_installment_applications | (phone) | dedup check |
| online_installment_applications | (status) | staff queue |
| saving_plans | (customerId, status) | my plans |
| website_visits | (ipHash, visitedAt) | frequency analysis |
| website_visits | (pagePath, visitedAt) | popular pages |

### Migration Strategy
1. Migration adds columns + tables (additive only, no impact to prod)
2. No backfill needed (all new fields optional)
3. Deploy → online shop developed in new modules, doesn't affect admin

---

## 7. Phased Rollout

### Phase 1: Foundation + Catalog (Month 1, 4 weeks)

**Goal:** Customer browses site → contacts via LINE (lead generation)

**Scope:**
- Setup: domain, Cloudflare CDN, GCS bucket
- Schema migration: Product fields, all visitor tracking + bot defense tables
- Visitor tracking + Bot defense + IP rate limit
- Pages: Home, Catalog, Product Detail, About, Contact, all static pages
- Calculator (interactive)
- 360° viewer
- Filter + sort + smart count
- LINE chat floating button
- Reservation pattern (15-min hold)
- Login: LINE + Facebook + Phone OTP
- SEO + structured data + robots.txt

**NOT in this phase:**
- Cart / Checkout (Phase 2)
- Payment (Phase 2)
- Apply forms (Phase 3)

**Deliverable:** Live website where customers see products, chat via LINE, deals close at branch

### Phase 2: Cash Sale + Checkout (Month 2, 4 weeks)

**Goal:** Customer completes cash purchase online → ships Kerry/Flash

**Scope:**
- Cart functionality
- Checkout 3-step wizard
- PromptPay QR + Bank transfer + PaySolutions
- Shipping integration (Kerry/Flash/J&T)
- Branch pickup option
- Order management (customer + admin queue)
- Auto-confirm payment + LINE notify
- Promotion code integration
- Loyalty points earn + redeem
- Address book

**Deliverable:** Cash sale end-to-end successful → revenue starts

### Phase 3: Apply Forms + All Services (Month 3, 4 weeks)

**Goal:** All 5 services online + ออมดาวน์

**Scope:**
- Installment apply (short form → branch)
- Trade-in submit + 24h quote workflow
- Buyback quick quote + photo submit
- ออมดาวน์ create + payment flow
- Admin queue tools
- Customer service tools (refund, return, cancel)
- Reviews/ratings
- Marketing tools (Facebook pixel, GA4)

**Deliverable:** 🚀 LAUNCH — full feature spec D

### Post-launch (Month 4+)

- A/B testing
- Conversion optimization
- LINE OA chatbot
- LIFF version
- Marketing: Facebook/IG/TikTok ads, LINE OA broadcast, Local SEO

### Risk + Mitigation

| Risk | Likelihood | Mitigation |
|------|-----------|-----------|
| Low traffic | High | Marketing budget Month 2-3, SEO + paid ads |
| Bot scraping | Medium | Bot defense in Phase 1 |
| Payment gateway issue | Medium | PaySolutions tested, fallback bank transfer |
| Stock conflict (online/offline) | High | Reservation + smart count + in-store priority |
| Low conversion | Medium | A/B test post-launch |
| Installment no-show | Medium | LINE auto-reminder + 7-day expiry |
| Trust low (new customers) | Medium | Reviews, warranty, local proof |

### Resources

| Resource | Phase 1 | Phase 2 | Phase 3 |
|----------|---------|---------|---------|
| Dev hours | ~120 | ~100 | ~120 |
| Photo equipment (360° turntable) | 1 set | - | - |
| Photographer | 30 hr (initial inventory) | 5 hr/wk ongoing | - |
| Marketing budget | 5-10K (test) | 20-30K | 30-50K |
| Staff training | 4 hr | 4 hr | 4 hr |

---

## Appendices

### A) Competitor analysis summary

5 competitors analyzed (Ufriend, Uficon, Banana Pay Easy, Pay Next Extra, UFUND, Backmarket, YelloBe, Apple Trade-In, Mobiletyme, JIB).

Key insights:
- All competitors hide pricing → BESTCHOICE shows it transparently
- Only UFUND discloses interest rate → BESTCHOICE always discloses
- None have LIFF integration → BESTCHOICE adds LIFF post-launch
- All require branch visit for installment → BESTCHOICE same (constraint)
- Backmarket grade-tier UX = best for used phones → adopted

### B) Customer data summary

From 440 active customers (analyzed 2026-04-19):
- 79% from ลพบุรี + 3 adjacent provinces
- 41% factory workers (Minebea, etc.)
- 63% earn 10-20K/month
- 84% bought used phone (vs 16% new)
- 100% iPhone in top 10 best-sellers
- 12-month installment most common (56%)
- 92% one-time buyers (low repeat)
- 99% have LINE, 98% have Facebook, 0.2% have email

### C) Constraints

- No credit bureau check → cannot extend to 48 months or 0% down
- 1 branch only (Lopburi) → cannot do home installment delivery
- ❌ ไอโฟนแลกเงิน skipped per owner
- ❌ Phase 4 deferred items remain deferred (PEAK/MDM/CHATCONE/GFIN)
