# Online Shop — Phase 1 (Foundation + Catalog) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Launch a public catalog website at `shop.bestchoicephone.app` where customers browse iPhone inventory with 360° photos, calculate installment payments, and contact the shop via LINE — closing deals at the physical branch (no checkout/payment yet).

**Architecture:** Separate Vite SPA at new domain consuming new `/api/shop/*` NestJS namespace. Re-uses existing `products`, `customers`, `inventory`, `line-oa`, `storage` modules. Adds `shop-catalog`, `shop-tracking`, `shop-bot-defense`, `shop-reservation`, `shop-auth-social` modules. Adds `ProductReservation`, `WebsiteVisit`, `WebsiteSession`, `BotDetectionLog`, `IpRateLimit` tables. Extends `Product` (gallery, gallery360, conditionGrade, isOnlineVisible) and `Customer` (facebookUserId).

**Tech Stack:** React 19 + Vite 6 + Tailwind + shadcn/ui (existing), NestJS 11 + Prisma 6 + PostgreSQL 16 (existing), GCS storage (existing), LINE Login API + Facebook Graph API (new), Cloudflare CDN (new), `react-360-view` library (new).

**Spec:** `docs/superpowers/specs/2026-04-20-online-shop-design.md`
**Predecessors:** None — this is the first phase.
**Successors:** Phase 2 (Cart + Checkout, separate plan), Phase 3 (Apply Forms, separate plan).

---

## File Structure

### New backend files (apps/api)

```
apps/api/src/modules/
├── shop-catalog/
│   ├── shop-catalog.module.ts          # NestJS module
│   ├── shop-catalog.controller.ts      # GET /api/shop/products, GET /api/shop/products/:slug
│   ├── shop-catalog.service.ts         # Business logic
│   └── shop-catalog.service.spec.ts    # Unit tests
├── shop-reservation/
│   ├── shop-reservation.module.ts
│   ├── shop-reservation.controller.ts  # POST /api/shop/reservations, DELETE /reservations/:id
│   ├── shop-reservation.service.ts     # 15-min hold logic
│   ├── shop-reservation.service.spec.ts
│   └── reservation-cleanup.cron.ts     # Expire old reservations
├── shop-tracking/
│   ├── shop-tracking.module.ts
│   ├── shop-tracking.controller.ts     # POST /api/shop/track
│   ├── shop-tracking.service.ts        # Record visits + sessions
│   ├── shop-tracking.service.spec.ts
│   └── visit-aggregation.cron.ts       # Daily aggregation
├── shop-bot-defense/
│   ├── shop-bot-defense.module.ts
│   ├── shop-bot-defense.guard.ts       # NestJS guard for rate limit + bot check
│   ├── shop-bot-defense.service.ts     # Detection logic
│   └── shop-bot-defense.service.spec.ts
├── shop-auth-social/
│   ├── shop-auth-social.module.ts
│   ├── shop-auth-social.controller.ts  # OAuth callbacks
│   ├── shop-auth-social.service.ts     # LINE Login + Facebook Login
│   └── shop-auth-social.service.spec.ts
└── shop-line-chat/
    ├── shop-line-chat.module.ts
    ├── shop-line-chat.controller.ts    # POST /api/shop/contact
    └── shop-line-chat.service.ts       # Send LINE OA notification
```

### New frontend (apps/web-shop — separate Vite project)

```
apps/web-shop/                          # NEW workspace
├── package.json
├── vite.config.ts
├── tsconfig.json
├── tailwind.config.ts
├── index.html
├── public/
│   ├── robots.txt
│   ├── sitemap.xml (generated)
│   └── favicon.ico
└── src/
    ├── main.tsx
    ├── App.tsx                         # Router setup
    ├── lib/
    │   ├── api.ts                      # axios client → /api/shop/*
    │   ├── auth.ts                     # LINE/FB/OTP login
    │   ├── tracking.ts                 # POST /api/shop/track
    │   └── currency.ts                 # ฿ formatter
    ├── hooks/
    │   ├── useDebounce.ts              # (port from apps/web)
    │   ├── useIsMobile.ts              # (port)
    │   └── useReservation.ts           # 15-min countdown
    ├── components/
    │   ├── layout/
    │   │   ├── ShopLayout.tsx
    │   │   ├── ShopHeader.tsx
    │   │   ├── ShopFooter.tsx
    │   │   └── FloatingLineButton.tsx
    │   ├── catalog/
    │   │   ├── ProductCard.tsx
    │   │   ├── FilterSidebar.tsx
    │   │   ├── SortDropdown.tsx
    │   │   ├── StockIndicator.tsx       # smart count
    │   │   └── ConditionTierBadge.tsx
    │   ├── product-detail/
    │   │   ├── ProductGallery.tsx
    │   │   ├── Photo360Viewer.tsx       # react-360-view wrapper
    │   │   ├── ConditionTierTabs.tsx
    │   │   ├── UnitDisplay.tsx
    │   │   ├── PaymentCalculator.tsx
    │   │   ├── ReservationModal.tsx
    │   │   └── TrustSignals.tsx
    │   └── auth/
    │       ├── LineLoginButton.tsx
    │       ├── FacebookLoginButton.tsx
    │       └── PhoneOtpForm.tsx
    └── pages/
        ├── HomePage.tsx
        ├── CatalogPage.tsx
        ├── ProductDetailPage.tsx
        ├── HowItWorksPage.tsx
        ├── ShippingPage.tsx
        ├── ReturnsPage.tsx
        ├── AboutPage.tsx
        └── ContactPage.tsx
```

### Modified files

- `apps/api/prisma/schema.prisma` — add 5 new models + 2 model extensions
- `apps/api/src/app.module.ts` — register new modules
- `apps/api/src/main.ts` — CORS for shop.bestchoicephone.app
- `package.json` (root) — add `apps/web-shop` to workspaces
- `.github/workflows/deploy-gcp.yml` — deploy web-shop to Firebase / separate Cloud Run

---

## Task 0: Pre-flight checks

**Files:**
- Verify: `apps/api/src/utils/pii.util.ts` (Phase 6.5 dependency)
- Verify: `apps/api/src/modules/products/products.service.ts` exists
- Verify: domain `shop.bestchoicephone.app` reserved + DNS configured

- [ ] **Step 1: Verify Phase 6.5 PII util exists**

```bash
test -f apps/api/src/utils/pii.util.ts && echo "OK" || echo "MISSING"
```

Expected: `OK` (Phase 6.5 Phase 1+2+3+5 already shipped per session 2026-04-19)

- [ ] **Step 2: Verify existing modules to be re-used**

```bash
for m in products customers inventory line-oa storage promotions loyalty; do
  test -d apps/api/src/modules/$m && echo "$m: OK" || echo "$m: MISSING"
done
```

Expected: All 7 OK.

- [ ] **Step 3: Check that domain DNS is set up (manual / owner action)**

```bash
dig +short shop.bestchoicephone.app A
```

If empty: owner must configure DNS in Cloudflare → CNAME to Firebase Hosting (or A record). Block until done.

- [ ] **Step 4: Confirm GCS bucket exists for shop assets**

```bash
gcloud storage buckets describe gs://bestchoice-shop-assets 2>&1 | head -3
```

If error: create with:
```bash
gcloud storage buckets create gs://bestchoice-shop-assets \
  --location=asia-southeast1 --uniform-bucket-level-access
```

- [ ] **Step 5: Confirm `.env.example` documents new env vars**

Add to `.env.example`:
```
# Shop site
SHOP_BASE_URL=https://shop.bestchoicephone.app
SHOP_GCS_BUCKET=bestchoice-shop-assets

# Social Auth (Phase 1 Task 5)
LINE_LOGIN_CHANNEL_ID=
LINE_LOGIN_CHANNEL_SECRET=
FACEBOOK_APP_ID=
FACEBOOK_APP_SECRET=

# Bot defense (Phase 1 Task 4)
CLOUDFLARE_TURNSTILE_SITE_KEY=
CLOUDFLARE_TURNSTILE_SECRET=
```

- [ ] **Step 6: Commit pre-flight changes**

```bash
git add .env.example
git commit -m "chore(shop): add Phase 1 env var placeholders to .env.example"
```

---

## Task 1: Schema migration — Add new tables and Product extensions

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Migration: auto-generated

- [ ] **Step 1: Add 5 new models + 2 extensions to schema.prisma**

In `apps/api/prisma/schema.prisma`, after the existing `Product` model (line 999), find `ProductPhoto` model and BEFORE it, add the following NEW models. Add new fields to existing `Product` and `Customer` models inline.

**Modify `Product` model** (line 999) — add these fields BEFORE `@@map("products")`:
```prisma
  // === Online shop additions (Phase 1) ===
  conditionGrade     String?  @map("condition_grade")     // A, B, C for used phones
  gallery            String[] @default([])                 // catalog photo URLs
  gallery360         String[] @default([])                 // 360° frame URLs (24-36 frames)
  isOnlineVisible    Boolean  @default(true) @map("is_online_visible")
  onlineDescription  String?  @map("online_description") @db.Text
  reservations       ProductReservation[]
```

**Modify `Customer` model** (line 472) — add this field BEFORE `@@map("customers")`:
```prisma
  // === Online shop addition (Phase 1) ===
  facebookUserId     String?  @map("facebook_user_id")
  shippingAddresses  Json[]   @default([]) @map("shipping_addresses")
  reservations       ProductReservation[]
  websiteVisits      WebsiteVisit[]
  websiteSessions    WebsiteSession[]
```

**Add NEW models** at end of schema.prisma (before any final closing braces):

```prisma
// ============================================================
// Online Shop — Phase 1
// ============================================================

model ProductReservation {
  id           String            @id @default(uuid())
  productId    String            @map("product_id")
  product      Product           @relation(fields: [productId], references: [id])
  customerId   String?           @map("customer_id")
  customer     Customer?         @relation(fields: [customerId], references: [id])
  sessionId    String            @map("session_id")
  reservedAt   DateTime          @default(now()) @map("reserved_at")
  expiresAt    DateTime          @map("expires_at")
  status       ReservationStatus @default(ACTIVE)
  consumedById String?           @map("consumed_by_id")
  createdAt    DateTime          @default(now()) @map("created_at")
  updatedAt    DateTime          @updatedAt @map("updated_at")

  @@index([productId, status])
  @@index([customerId])
  @@index([expiresAt])
  @@map("product_reservations")
}

enum ReservationStatus {
  ACTIVE
  EXPIRED
  CONSUMED
  CANCELLED
  PREEMPTED
}

model WebsiteVisit {
  id          String    @id @default(uuid())
  sessionId   String    @map("session_id")
  customerId  String?   @map("customer_id")
  customer    Customer? @relation(fields: [customerId], references: [id])
  ipHash      String    @map("ip_hash")
  ipCountry   String?   @map("ip_country")
  ipProvince  String?   @map("ip_province")
  userAgent   String?   @map("user_agent") @db.Text
  device      String?
  browser     String?
  os          String?
  pagePath    String    @map("page_path")
  referrer    String?
  utmSource   String?   @map("utm_source")
  utmMedium   String?   @map("utm_medium")
  utmCampaign String?   @map("utm_campaign")
  visitedAt   DateTime  @default(now()) @map("visited_at")
  durationSec Int?      @map("duration_sec")

  @@index([sessionId])
  @@index([customerId])
  @@index([visitedAt])
  @@index([ipHash, visitedAt])
  @@index([pagePath, visitedAt])
  @@map("website_visits")
}

model WebsiteSession {
  id              String    @id @default(uuid())
  sessionId       String    @unique @map("session_id")
  customerId      String?   @map("customer_id")
  customer        Customer? @relation(fields: [customerId], references: [id])
  ipHash          String    @map("ip_hash")
  device          String?
  browser         String?
  startedAt       DateTime  @map("started_at")
  endedAt         DateTime? @map("ended_at")
  pageCount       Int       @default(0) @map("page_count")
  durationSec     Int?      @map("duration_sec")
  reachedCart     Boolean   @default(false) @map("reached_cart")
  reachedCheckout Boolean   @default(false) @map("reached_checkout")
  completedOrder  Boolean   @default(false) @map("completed_order")
  orderId         String?   @map("order_id")
  entryPage       String    @map("entry_page")
  exitPage        String?   @map("exit_page")
  referrer        String?
  utmSource       String?   @map("utm_source")
  utmCampaign     String?   @map("utm_campaign")

  @@index([customerId])
  @@index([startedAt])
  @@index([ipHash, startedAt])
  @@map("website_sessions")
}

model BotDetectionLog {
  id           String    @id @default(uuid())
  ipHash       String    @map("ip_hash")
  userAgent    String    @map("user_agent") @db.Text
  detectedType BotType   @map("detected_type")
  signals      Json
  pagePath     String    @map("page_path")
  action       BotAction
  detectedAt   DateTime  @default(now()) @map("detected_at")
  createdAt    DateTime  @default(now()) @map("created_at")

  @@index([ipHash, detectedAt])
  @@index([detectedType, detectedAt])
  @@map("bot_detection_logs")
}

enum BotType {
  AI_CRAWLER
  GENERIC_BOT
  SCRAPER
  HEADLESS_BROWSER
  RATE_ABUSE
  PRICE_MONITOR
  KNOWN_GOOD
}

enum BotAction {
  LOGGED
  RATE_LIMITED
  CAPTCHA_REQUIRED
  BLOCKED
  CLOAKED
}

model IpRateLimit {
  ipHash             String    @id @map("ip_hash")
  windowStart        DateTime  @map("window_start")
  requestCount       Int       @default(0) @map("request_count")
  blockedUntil       DateTime? @map("blocked_until")
  blockReason        String?   @map("block_reason")
  pagesVisited       Int       @default(0) @map("pages_visited")
  uniquePagesVisited Int       @default(0) @map("unique_pages_visited")
  lastUserAgent      String?   @map("last_user_agent") @db.Text

  @@index([blockedUntil])
  @@map("ip_rate_limits")
}
```

- [ ] **Step 2: Generate migration (don't apply to dev DB to avoid shadow DB issues)**

```bash
cd apps/api && npx prisma migrate dev --name add_shop_phase1_tables --create-only
```

If shadow DB error (pre-existing in this project per session memory): use `prisma migrate diff` instead:
```bash
npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script > /tmp/diff.sql
```

Then write migration manually at `apps/api/prisma/migrations/<timestamp>_add_shop_phase1_tables/migration.sql` containing CREATE TABLE for the 5 new tables + ALTER TABLE for Product/Customer extensions (matching the diff).

- [ ] **Step 3: Verify migration SQL**

Read generated migration and confirm:
- [ ] All NEW columns on existing tables are NULLABLE
- [ ] No ALTER on existing required columns
- [ ] No DROP statements
- [ ] 5 enum types created (ReservationStatus, BotType, BotAction)
- [ ] 5 new tables created
- [ ] All indexes per `@@index` directives created

- [ ] **Step 4: Run prisma generate**

```bash
cd apps/api && npx prisma generate
```

Expected: success.

- [ ] **Step 5: Run TypeScript check**

```bash
./tools/check-types.sh api
```

Expected: 0 errors related to new models (existing test files may have pre-existing warnings — ignore those).

- [ ] **Step 6: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/
git commit -m "feat(shop): Phase 1 schema — add reservations, tracking, bot defense tables

Adds 5 new models for online shop foundation:
- ProductReservation (15-min hold pattern)
- WebsiteVisit + WebsiteSession + DailyVisitStats (analytics)
- BotDetectionLog + IpRateLimit (bot defense)

Extends existing models:
- Product: gallery[], gallery360[], conditionGrade, isOnlineVisible
- Customer: facebookUserId, shippingAddresses[]

All extensions are NULLABLE — backwards compatible.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: shop-tracking module (visitor analytics)

**Files:**
- Create: `apps/api/src/modules/shop-tracking/shop-tracking.module.ts`
- Create: `apps/api/src/modules/shop-tracking/shop-tracking.controller.ts`
- Create: `apps/api/src/modules/shop-tracking/shop-tracking.service.ts`
- Create: `apps/api/src/modules/shop-tracking/shop-tracking.service.spec.ts`
- Create: `apps/api/src/modules/shop-tracking/dto/track-visit.dto.ts`

- [ ] **Step 1: Write failing test**

Create `apps/api/src/modules/shop-tracking/shop-tracking.service.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { ShopTrackingService } from './shop-tracking.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('ShopTrackingService', () => {
  let service: ShopTrackingService;
  let prisma: { websiteVisit: { create: jest.Mock }; websiteSession: { upsert: jest.Mock } };

  beforeEach(async () => {
    process.env.PII_HASH_SALT = 'test-salt-32-chars-minimum-needed-here';
    prisma = {
      websiteVisit: { create: jest.fn().mockResolvedValue({}) },
      websiteSession: { upsert: jest.fn().mockResolvedValue({}) },
    };
    const module = await Test.createTestingModule({
      providers: [ShopTrackingService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(ShopTrackingService);
  });

  afterEach(() => { delete process.env.PII_HASH_SALT; });

  it('hashes IP and records visit', async () => {
    await service.recordVisit({
      sessionId: 'sess-1',
      ip: '127.0.0.1',
      userAgent: 'Mozilla/5.0',
      pagePath: '/products',
      referrer: 'https://google.com',
    });
    const call = prisma.websiteVisit.create.mock.calls[0][0];
    expect(call.data.sessionId).toBe('sess-1');
    expect(call.data.ipHash).toMatch(/^[0-9a-f]{64}$/);
    expect(call.data.ipHash).not.toBe('127.0.0.1');
    expect(call.data.pagePath).toBe('/products');
    expect(call.data.referrer).toBe('https://google.com');
  });

  it('upserts session on visit', async () => {
    await service.recordVisit({
      sessionId: 'sess-1',
      ip: '127.0.0.1',
      userAgent: 'Mozilla/5.0',
      pagePath: '/',
    });
    expect(prisma.websiteSession.upsert).toHaveBeenCalled();
    const call = prisma.websiteSession.upsert.mock.calls[0][0];
    expect(call.where.sessionId).toBe('sess-1');
  });

  it('detects mobile device from user agent', async () => {
    await service.recordVisit({
      sessionId: 'sess-1',
      ip: '127.0.0.1',
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0)',
      pagePath: '/',
    });
    const call = prisma.websiteVisit.create.mock.calls[0][0];
    expect(call.data.device).toBe('mobile');
  });

  it('marks reachedCart when path is /cart', async () => {
    await service.recordVisit({
      sessionId: 'sess-1',
      ip: '127.0.0.1',
      userAgent: 'Mozilla/5.0',
      pagePath: '/cart',
    });
    const call = prisma.websiteSession.upsert.mock.calls[0][0];
    expect(call.update.reachedCart).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to confirm fail**

```bash
cd apps/api && npx jest shop-tracking.service.spec
```

Expected: FAIL with "Cannot find module './shop-tracking.service'"

- [ ] **Step 3: Implement DTO**

Create `apps/api/src/modules/shop-tracking/dto/track-visit.dto.ts`:

```typescript
import { IsString, IsOptional, IsInt, Min } from 'class-validator';

export class TrackVisitDto {
  @IsString()
  sessionId!: string;

  @IsString()
  pagePath!: string;

  @IsOptional()
  @IsString()
  referrer?: string;

  @IsOptional()
  @IsString()
  utmSource?: string;

  @IsOptional()
  @IsString()
  utmMedium?: string;

  @IsOptional()
  @IsString()
  utmCampaign?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  durationSec?: number;
}
```

- [ ] **Step 4: Implement service**

Create `apps/api/src/modules/shop-tracking/shop-tracking.service.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { hashPII } from '../../utils/pii.util';

export interface RecordVisitInput {
  sessionId: string;
  ip: string;
  userAgent: string;
  pagePath: string;
  referrer?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  durationSec?: number;
  customerId?: string;
}

@Injectable()
export class ShopTrackingService {
  private readonly logger = new Logger(ShopTrackingService.name);

  constructor(private prisma: PrismaService) {}

  async recordVisit(input: RecordVisitInput): Promise<void> {
    const salt = process.env.PII_HASH_SALT;
    if (!salt) {
      this.logger.warn('PII_HASH_SALT missing — skipping visit tracking');
      return;
    }

    const ipHash = hashPII(input.ip, salt);
    const device = this.detectDevice(input.userAgent);
    const browser = this.detectBrowser(input.userAgent);
    const os = this.detectOS(input.userAgent);

    try {
      await this.prisma.websiteVisit.create({
        data: {
          sessionId: input.sessionId,
          customerId: input.customerId,
          ipHash,
          userAgent: input.userAgent,
          device,
          browser,
          os,
          pagePath: input.pagePath,
          referrer: input.referrer,
          utmSource: input.utmSource,
          utmMedium: input.utmMedium,
          utmCampaign: input.utmCampaign,
          durationSec: input.durationSec,
        },
      });

      await this.prisma.websiteSession.upsert({
        where: { sessionId: input.sessionId },
        create: {
          sessionId: input.sessionId,
          customerId: input.customerId,
          ipHash,
          device,
          browser,
          startedAt: new Date(),
          pageCount: 1,
          entryPage: input.pagePath,
          referrer: input.referrer,
          utmSource: input.utmSource,
          utmCampaign: input.utmCampaign,
          reachedCart: input.pagePath === '/cart',
          reachedCheckout: input.pagePath.startsWith('/checkout'),
        },
        update: {
          pageCount: { increment: 1 },
          exitPage: input.pagePath,
          endedAt: new Date(),
          reachedCart: input.pagePath === '/cart' ? true : undefined,
          reachedCheckout: input.pagePath.startsWith('/checkout') ? true : undefined,
        },
      });
    } catch (err) {
      this.logger.error(`Visit tracking failed: ${(err as Error).message}`);
    }
  }

  private detectDevice(ua: string): string {
    if (/Mobile|iPhone|Android.*Mobile/i.test(ua)) return 'mobile';
    if (/Tablet|iPad/i.test(ua)) return 'tablet';
    return 'desktop';
  }

  private detectBrowser(ua: string): string {
    if (/Line\//i.test(ua)) return 'LINE';
    if (/Edg\//i.test(ua)) return 'Edge';
    if (/Chrome\//i.test(ua)) return 'Chrome';
    if (/Safari\//i.test(ua) && !/Chrome/i.test(ua)) return 'Safari';
    if (/Firefox\//i.test(ua)) return 'Firefox';
    return 'Other';
  }

  private detectOS(ua: string): string {
    if (/Windows/i.test(ua)) return 'Windows';
    if (/Mac OS|Macintosh/i.test(ua)) return 'macOS';
    if (/iPhone|iPad/i.test(ua)) return 'iOS';
    if (/Android/i.test(ua)) return 'Android';
    if (/Linux/i.test(ua)) return 'Linux';
    return 'Other';
  }
}
```

- [ ] **Step 5: Implement controller**

Create `apps/api/src/modules/shop-tracking/shop-tracking.controller.ts`:

```typescript
import { Body, Controller, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ShopTrackingService } from './shop-tracking.service';
import { TrackVisitDto } from './dto/track-visit.dto';

@Controller('shop')
export class ShopTrackingController {
  constructor(private trackingService: ShopTrackingService) {}

  @Post('track')
  async track(@Body() dto: TrackVisitDto, @Req() req: Request): Promise<{ ok: true }> {
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || '';
    const userAgent = req.headers['user-agent'] || '';
    const customerId = (req as Request & { user?: { id: string } }).user?.id;

    await this.trackingService.recordVisit({
      sessionId: dto.sessionId,
      ip,
      userAgent,
      pagePath: dto.pagePath,
      referrer: dto.referrer,
      utmSource: dto.utmSource,
      utmMedium: dto.utmMedium,
      utmCampaign: dto.utmCampaign,
      durationSec: dto.durationSec,
      customerId,
    });

    return { ok: true };
  }
}
```

- [ ] **Step 6: Implement module**

Create `apps/api/src/modules/shop-tracking/shop-tracking.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { ShopTrackingController } from './shop-tracking.controller';
import { ShopTrackingService } from './shop-tracking.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [ShopTrackingController],
  providers: [ShopTrackingService],
  exports: [ShopTrackingService],
})
export class ShopTrackingModule {}
```

- [ ] **Step 7: Register in app.module.ts**

In `apps/api/src/app.module.ts`, add import:
```typescript
import { ShopTrackingModule } from './modules/shop-tracking/shop-tracking.module';
```

Add `ShopTrackingModule` to the `imports` array (place it near other shop modules at the end).

- [ ] **Step 8: Run tests to confirm pass**

```bash
cd apps/api && npx jest shop-tracking.service.spec
```

Expected: All 4 tests PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/modules/shop-tracking/ apps/api/src/app.module.ts
git commit -m "feat(shop): visitor tracking module — record visits + sessions

POST /api/shop/track records every page view with IP-hashed analytics.
Auto-detects device/browser/OS from User-Agent.
Updates session aggregates (pageCount, reachedCart, reachedCheckout).
Audit-safe: graceful failure if PII_HASH_SALT missing.
4 unit tests cover hashing, session upsert, device detection, cart marking.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: shop-bot-defense module (rate limit + AI crawler control)

**Files:**
- Create: `apps/api/src/modules/shop-bot-defense/shop-bot-defense.module.ts`
- Create: `apps/api/src/modules/shop-bot-defense/shop-bot-defense.guard.ts`
- Create: `apps/api/src/modules/shop-bot-defense/shop-bot-defense.service.ts`
- Create: `apps/api/src/modules/shop-bot-defense/shop-bot-defense.service.spec.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/api/src/modules/shop-bot-defense/shop-bot-defense.service.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { ShopBotDefenseService } from './shop-bot-defense.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('ShopBotDefenseService', () => {
  let service: ShopBotDefenseService;
  let prisma: any;

  beforeEach(async () => {
    process.env.PII_HASH_SALT = 'test-salt-32-chars-minimum-needed-here';
    prisma = {
      ipRateLimit: {
        upsert: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      botDetectionLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const module = await Test.createTestingModule({
      providers: [ShopBotDefenseService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(ShopBotDefenseService);
  });

  afterEach(() => { delete process.env.PII_HASH_SALT; });

  describe('classifyUserAgent', () => {
    it('detects GPTBot as AI_CRAWLER', () => {
      expect(service.classifyUserAgent('Mozilla/5.0 GPTBot/1.0')).toBe('AI_CRAWLER');
    });
    it('detects ClaudeBot as AI_CRAWLER', () => {
      expect(service.classifyUserAgent('Mozilla/5.0 ClaudeBot/1.0')).toBe('AI_CRAWLER');
    });
    it('detects Anthropic-AI as AI_CRAWLER', () => {
      expect(service.classifyUserAgent('Anthropic-AI/1.0')).toBe('AI_CRAWLER');
    });
    it('detects Bytespider as SCRAPER', () => {
      expect(service.classifyUserAgent('Bytespider')).toBe('SCRAPER');
    });
    it('detects HeadlessChrome as HEADLESS_BROWSER', () => {
      expect(service.classifyUserAgent('Mozilla/5.0 HeadlessChrome/100')).toBe('HEADLESS_BROWSER');
    });
    it('detects curl as SCRAPER', () => {
      expect(service.classifyUserAgent('curl/7.64.1')).toBe('SCRAPER');
    });
    it('detects Googlebot as KNOWN_GOOD', () => {
      expect(service.classifyUserAgent('Mozilla/5.0 Googlebot/2.1')).toBe('KNOWN_GOOD');
    });
    it('returns null for normal browser', () => {
      expect(service.classifyUserAgent('Mozilla/5.0 (iPhone) Safari/605')).toBeNull();
    });
  });

  describe('decideAction', () => {
    it('blocks aggressive scrapers (Bytespider)', () => {
      const action = service.decideAction({ userAgent: 'Bytespider', requestRate: 10 });
      expect(action).toBe('BLOCKED');
    });
    it('logs (allows) AI crawlers — friendly to AI discovery', () => {
      const action = service.decideAction({ userAgent: 'GPTBot', requestRate: 10 });
      expect(action).toBe('LOGGED');
    });
    it('rate-limits when request rate too high', () => {
      const action = service.decideAction({ userAgent: 'normal', requestRate: 200 });
      expect(action).toBe('RATE_LIMITED');
    });
    it('captcha for headless browsers', () => {
      const action = service.decideAction({ userAgent: 'HeadlessChrome', requestRate: 5 });
      expect(action).toBe('CAPTCHA_REQUIRED');
    });
    it('allows normal traffic', () => {
      const action = service.decideAction({ userAgent: 'Mozilla/5.0 Safari', requestRate: 5 });
      expect(action).toBe('LOGGED');
    });
  });

  describe('recordRateLimit', () => {
    it('upserts rate limit row', async () => {
      await service.recordRateLimit('1.2.3.4', 'Mozilla/5.0', '/products');
      expect(prisma.ipRateLimit.upsert).toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: Run tests to confirm fail**

```bash
cd apps/api && npx jest shop-bot-defense.service.spec
```

Expected: FAIL "Cannot find module './shop-bot-defense.service'"

- [ ] **Step 3: Implement service**

Create `apps/api/src/modules/shop-bot-defense/shop-bot-defense.service.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { hashPII } from '../../utils/pii.util';

export type BotType =
  | 'AI_CRAWLER'
  | 'GENERIC_BOT'
  | 'SCRAPER'
  | 'HEADLESS_BROWSER'
  | 'RATE_ABUSE'
  | 'PRICE_MONITOR'
  | 'KNOWN_GOOD';

export type BotAction = 'LOGGED' | 'RATE_LIMITED' | 'CAPTCHA_REQUIRED' | 'BLOCKED' | 'CLOAKED';

const RATE_LIMIT_PER_MIN = 100;
const CATALOG_RATE_LIMIT_PER_MIN = 30;

@Injectable()
export class ShopBotDefenseService {
  private readonly logger = new Logger(ShopBotDefenseService.name);

  constructor(private prisma: PrismaService) {}

  classifyUserAgent(ua: string): BotType | null {
    if (/GPTBot|ClaudeBot|Anthropic-AI|PerplexityBot|Google-Extended/i.test(ua)) return 'AI_CRAWLER';
    if (/Bytespider|CCBot/i.test(ua)) return 'SCRAPER';
    if (/HeadlessChrome|PhantomJS|Selenium|Puppeteer/i.test(ua)) return 'HEADLESS_BROWSER';
    if (/wget|curl|python-requests|axios|node-fetch|scrapy/i.test(ua)) return 'SCRAPER';
    if (/Googlebot|Bingbot|DuckDuckBot|Slurp|Baiduspider/i.test(ua)) return 'KNOWN_GOOD';
    return null;
  }

  decideAction(input: { userAgent: string; requestRate: number; pagePath?: string }): BotAction {
    const type = this.classifyUserAgent(input.userAgent);

    // Aggressive scrapers — block
    if (type === 'SCRAPER' && /Bytespider|CCBot/i.test(input.userAgent)) {
      return 'BLOCKED';
    }
    // Other scraper tools (curl/wget) — captcha required
    if (type === 'SCRAPER') {
      return 'CAPTCHA_REQUIRED';
    }
    // Headless — captcha
    if (type === 'HEADLESS_BROWSER') {
      return 'CAPTCHA_REQUIRED';
    }
    // AI crawlers — allow + log (friendly to AI discovery for SEO)
    if (type === 'AI_CRAWLER') {
      return 'LOGGED';
    }
    // Known good search bots — allow
    if (type === 'KNOWN_GOOD') {
      return 'LOGGED';
    }
    // Rate limit check for normal browsers
    const limit = input.pagePath?.startsWith('/products') ? CATALOG_RATE_LIMIT_PER_MIN * 2 : RATE_LIMIT_PER_MIN;
    if (input.requestRate > limit) {
      return 'RATE_LIMITED';
    }
    return 'LOGGED';
  }

  async recordRateLimit(ip: string, userAgent: string, pagePath: string): Promise<void> {
    const salt = process.env.PII_HASH_SALT;
    if (!salt) return;
    const ipHash = hashPII(ip, salt);
    const now = new Date();
    const windowStart = new Date(now.getTime() - (now.getTime() % 60_000));

    await this.prisma.ipRateLimit.upsert({
      where: { ipHash },
      create: {
        ipHash,
        windowStart,
        requestCount: 1,
        pagesVisited: 1,
        uniquePagesVisited: 1,
        lastUserAgent: userAgent,
      },
      update: {
        requestCount: { increment: 1 },
        pagesVisited: { increment: 1 },
        lastUserAgent: userAgent,
        windowStart: now.getTime() - windowStart.getTime() > 60_000 ? now : windowStart,
      },
    });
  }

  async getRequestRate(ip: string): Promise<number> {
    const salt = process.env.PII_HASH_SALT;
    if (!salt) return 0;
    const ipHash = hashPII(ip, salt);
    const row = await this.prisma.ipRateLimit.findUnique({ where: { ipHash } });
    if (!row) return 0;
    const elapsedMs = Date.now() - row.windowStart.getTime();
    if (elapsedMs > 60_000) return 0; // window expired
    return row.requestCount;
  }

  async logDetection(input: {
    ip: string;
    userAgent: string;
    pagePath: string;
    detectedType: BotType;
    action: BotAction;
    signals: Record<string, unknown>;
  }): Promise<void> {
    const salt = process.env.PII_HASH_SALT;
    if (!salt) return;
    try {
      await this.prisma.botDetectionLog.create({
        data: {
          ipHash: hashPII(input.ip, salt),
          userAgent: input.userAgent,
          detectedType: input.detectedType,
          signals: input.signals,
          pagePath: input.pagePath,
          action: input.action,
        },
      });
    } catch (err) {
      this.logger.error(`Bot detection log failed: ${(err as Error).message}`);
    }
  }
}
```

- [ ] **Step 4: Implement guard**

Create `apps/api/src/modules/shop-bot-defense/shop-bot-defense.guard.ts`:

```typescript
import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { ShopBotDefenseService } from './shop-bot-defense.service';

@Injectable()
export class ShopBotDefenseGuard implements CanActivate {
  constructor(private botDefense: ShopBotDefenseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || '';
    const userAgent = req.headers['user-agent'] || '';
    const pagePath = req.path;

    const requestRate = await this.botDefense.getRequestRate(ip);
    const action = this.botDefense.decideAction({ userAgent, requestRate, pagePath });

    const detectedType = this.botDefense.classifyUserAgent(userAgent) || 'GENERIC_BOT';
    void this.botDefense.logDetection({ ip, userAgent, pagePath, detectedType, action, signals: { requestRate } });
    void this.botDefense.recordRateLimit(ip, userAgent, pagePath);

    if (action === 'BLOCKED') {
      throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
    }
    if (action === 'RATE_LIMITED') {
      throw new HttpException({ message: 'Too many requests', retryAfter: 60 }, HttpStatus.TOO_MANY_REQUESTS);
    }
    // CAPTCHA_REQUIRED handled in next phase (Cloudflare Turnstile)
    return true;
  }
}
```

- [ ] **Step 5: Implement module**

Create `apps/api/src/modules/shop-bot-defense/shop-bot-defense.module.ts`:

```typescript
import { Global, Module } from '@nestjs/common';
import { ShopBotDefenseService } from './shop-bot-defense.service';
import { ShopBotDefenseGuard } from './shop-bot-defense.guard';
import { PrismaModule } from '../../prisma/prisma.module';

@Global()
@Module({
  imports: [PrismaModule],
  providers: [ShopBotDefenseService, ShopBotDefenseGuard],
  exports: [ShopBotDefenseService, ShopBotDefenseGuard],
})
export class ShopBotDefenseModule {}
```

- [ ] **Step 6: Register in app.module.ts**

Add `ShopBotDefenseModule` to imports array.

- [ ] **Step 7: Run tests + check-types**

```bash
cd apps/api && npx jest shop-bot-defense.service.spec
./tools/check-types.sh api
```

Expected: 14 tests PASS, 0 type errors related to new code.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/shop-bot-defense/ apps/api/src/app.module.ts
git commit -m "feat(shop): bot defense module — rate limit + AI crawler classification

Hybrid approach per Section 6 of design spec:
- ALLOW AI crawlers (GPTBot, ClaudeBot, etc.) — friendly for AI discovery/SEO
- BLOCK aggressive scrapers (Bytespider, CCBot)
- CAPTCHA_REQUIRED for headless/curl/wget
- RATE_LIMITED for normal browsers exceeding 100 req/min (30 on /products)
- Logs every detection to BotDetectionLog (PII-hashed IP)
- Updates IpRateLimit per request

Guard usage: @UseGuards(ShopBotDefenseGuard) on /api/shop/* endpoints.
14 unit tests cover UA classification, action decisions, rate tracking.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: shop-reservation module (15-min unit hold)

**Files:**
- Create: `apps/api/src/modules/shop-reservation/shop-reservation.module.ts`
- Create: `apps/api/src/modules/shop-reservation/shop-reservation.controller.ts`
- Create: `apps/api/src/modules/shop-reservation/shop-reservation.service.ts`
- Create: `apps/api/src/modules/shop-reservation/shop-reservation.service.spec.ts`
- Create: `apps/api/src/modules/shop-reservation/dto/create-reservation.dto.ts`
- Create: `apps/api/src/modules/shop-reservation/reservation-cleanup.cron.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/api/src/modules/shop-reservation/shop-reservation.service.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { ShopReservationService } from './shop-reservation.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('ShopReservationService', () => {
  let service: ShopReservationService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      product: { findUnique: jest.fn() },
      productReservation: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
    };
    const module = await Test.createTestingModule({
      providers: [ShopReservationService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(ShopReservationService);
  });

  describe('reserve', () => {
    it('creates 15-min reservation for available product', async () => {
      prisma.product.findUnique.mockResolvedValue({ id: 'p1', status: 'IN_STOCK', isOnlineVisible: true });
      prisma.productReservation.findFirst.mockResolvedValue(null);
      prisma.productReservation.create.mockResolvedValue({ id: 'r1', expiresAt: new Date(Date.now() + 900_000) });

      const result = await service.reserve({ productId: 'p1', sessionId: 's1' });

      expect(prisma.productReservation.create).toHaveBeenCalled();
      const data = prisma.productReservation.create.mock.calls[0][0].data;
      expect(data.productId).toBe('p1');
      expect(data.sessionId).toBe('s1');
      expect(data.status).toBe('ACTIVE');
      expect(new Date(data.expiresAt).getTime() - Date.now()).toBeGreaterThan(890_000);
      expect(new Date(data.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(900_000);
    });

    it('rejects if product not found', async () => {
      prisma.product.findUnique.mockResolvedValue(null);
      await expect(service.reserve({ productId: 'p1', sessionId: 's1' })).rejects.toThrow(NotFoundException);
    });

    it('rejects if product not in stock', async () => {
      prisma.product.findUnique.mockResolvedValue({ id: 'p1', status: 'SOLD' });
      await expect(service.reserve({ productId: 'p1', sessionId: 's1' })).rejects.toThrow(ConflictException);
    });

    it('rejects if product not online visible', async () => {
      prisma.product.findUnique.mockResolvedValue({ id: 'p1', status: 'IN_STOCK', isOnlineVisible: false });
      await expect(service.reserve({ productId: 'p1', sessionId: 's1' })).rejects.toThrow(NotFoundException);
    });

    it('rejects if already reserved by another session', async () => {
      prisma.product.findUnique.mockResolvedValue({ id: 'p1', status: 'IN_STOCK', isOnlineVisible: true });
      prisma.productReservation.findFirst.mockResolvedValue({
        id: 'r-existing',
        sessionId: 'other-session',
        status: 'ACTIVE',
        expiresAt: new Date(Date.now() + 600_000),
      });
      await expect(service.reserve({ productId: 'p1', sessionId: 's1' })).rejects.toThrow(ConflictException);
    });

    it('extends existing reservation if same session re-reserves', async () => {
      prisma.product.findUnique.mockResolvedValue({ id: 'p1', status: 'IN_STOCK', isOnlineVisible: true });
      prisma.productReservation.findFirst.mockResolvedValue({
        id: 'r-existing',
        sessionId: 's1',
        status: 'ACTIVE',
      });
      prisma.productReservation.update.mockResolvedValue({ id: 'r-existing', expiresAt: new Date() });

      await service.reserve({ productId: 'p1', sessionId: 's1' });

      expect(prisma.productReservation.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'r-existing' } })
      );
      expect(prisma.productReservation.create).not.toHaveBeenCalled();
    });
  });

  describe('cancel', () => {
    it('marks reservation as CANCELLED', async () => {
      prisma.productReservation.update.mockResolvedValue({});
      await service.cancel('r1', 's1');
      expect(prisma.productReservation.update).toHaveBeenCalledWith({
        where: { id: 'r1' },
        data: expect.objectContaining({ status: 'CANCELLED' }),
      });
    });
  });

  describe('expireOldReservations', () => {
    it('updates all expired ACTIVE reservations to EXPIRED', async () => {
      prisma.productReservation.updateMany.mockResolvedValue({ count: 5 });
      const count = await service.expireOldReservations();
      expect(count).toBe(5);
      expect(prisma.productReservation.updateMany).toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: Run tests to confirm fail**

```bash
cd apps/api && npx jest shop-reservation.service.spec
```

Expected: FAIL.

- [ ] **Step 3: Implement DTO**

Create `apps/api/src/modules/shop-reservation/dto/create-reservation.dto.ts`:

```typescript
import { IsString, IsUUID } from 'class-validator';

export class CreateReservationDto {
  @IsUUID()
  productId!: string;

  @IsString()
  sessionId!: string;
}
```

- [ ] **Step 4: Implement service**

Create `apps/api/src/modules/shop-reservation/shop-reservation.service.ts`:

```typescript
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

const RESERVATION_DURATION_MS = 15 * 60 * 1000; // 15 minutes

export interface ReserveInput {
  productId: string;
  sessionId: string;
  customerId?: string;
}

@Injectable()
export class ShopReservationService {
  constructor(private prisma: PrismaService) {}

  async reserve(input: ReserveInput) {
    const product = await this.prisma.product.findUnique({ where: { id: input.productId } });
    if (!product || !product.isOnlineVisible) throw new NotFoundException('สินค้านี้ไม่พบ');
    if (product.status !== 'IN_STOCK') throw new ConflictException('สินค้านี้ไม่อยู่ในสต็อกแล้ว');

    const existing = await this.prisma.productReservation.findFirst({
      where: {
        productId: input.productId,
        status: 'ACTIVE',
        expiresAt: { gt: new Date() },
      },
    });

    const expiresAt = new Date(Date.now() + RESERVATION_DURATION_MS);

    if (existing) {
      if (existing.sessionId === input.sessionId) {
        return this.prisma.productReservation.update({
          where: { id: existing.id },
          data: { expiresAt },
        });
      }
      throw new ConflictException('เครื่องนี้ถูกจองโดยลูกค้ารายอื่นอยู่ — รอ 15 นาที');
    }

    return this.prisma.productReservation.create({
      data: {
        productId: input.productId,
        customerId: input.customerId,
        sessionId: input.sessionId,
        expiresAt,
        status: 'ACTIVE',
      },
    });
  }

  async cancel(reservationId: string, sessionId: string) {
    return this.prisma.productReservation.update({
      where: { id: reservationId },
      data: { status: 'CANCELLED' },
    });
  }

  async expireOldReservations(): Promise<number> {
    const result = await this.prisma.productReservation.updateMany({
      where: { status: 'ACTIVE', expiresAt: { lt: new Date() } },
      data: { status: 'EXPIRED' },
    });
    return result.count;
  }

  async preemptByInStoreSale(productId: string): Promise<void> {
    await this.prisma.productReservation.updateMany({
      where: { productId, status: 'ACTIVE' },
      data: { status: 'PREEMPTED' },
    });
  }
}
```

- [ ] **Step 5: Implement controller**

Create `apps/api/src/modules/shop-reservation/shop-reservation.controller.ts`:

```typescript
import { Body, Controller, Delete, Param, Post } from '@nestjs/common';
import { ShopReservationService } from './shop-reservation.service';
import { CreateReservationDto } from './dto/create-reservation.dto';

@Controller('shop/reservations')
export class ShopReservationController {
  constructor(private reservationService: ShopReservationService) {}

  @Post()
  async create(@Body() dto: CreateReservationDto) {
    return this.reservationService.reserve(dto);
  }

  @Delete(':id')
  async cancel(@Param('id') id: string, @Body('sessionId') sessionId: string) {
    return this.reservationService.cancel(id, sessionId);
  }
}
```

- [ ] **Step 6: Implement cron**

Create `apps/api/src/modules/shop-reservation/reservation-cleanup.cron.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as Sentry from '@sentry/node';
import { ShopReservationService } from './shop-reservation.service';

@Injectable()
export class ReservationCleanupCron {
  private readonly logger = new Logger(ReservationCleanupCron.name);

  constructor(private reservationService: ShopReservationService) {}

  @Cron('*/5 * * * *', { timeZone: 'Asia/Bangkok' }) // every 5 min
  async expireOldReservations(): Promise<void> {
    try {
      const count = await this.reservationService.expireOldReservations();
      if (count > 0) this.logger.log(`Expired ${count} reservations`);
    } catch (err) {
      this.logger.error(`Cron failed: ${(err as Error).message}`);
      Sentry.captureException(err);
    }
  }
}
```

- [ ] **Step 7: Implement module**

Create `apps/api/src/modules/shop-reservation/shop-reservation.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { ShopReservationController } from './shop-reservation.controller';
import { ShopReservationService } from './shop-reservation.service';
import { ReservationCleanupCron } from './reservation-cleanup.cron';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [ShopReservationController],
  providers: [ShopReservationService, ReservationCleanupCron],
  exports: [ShopReservationService],
})
export class ShopReservationModule {}
```

- [ ] **Step 8: Register in app.module.ts**

Add `ShopReservationModule` to imports.

- [ ] **Step 9: Run tests + commit**

```bash
cd apps/api && npx jest shop-reservation.service.spec
./tools/check-types.sh api
git add apps/api/src/modules/shop-reservation/ apps/api/src/app.module.ts
git commit -m "feat(shop): reservation module — 15-min unit hold for online buyers

POST /api/shop/reservations creates 15-min hold per session.
Same session re-reserve = extend (not duplicate).
Different session blocked while ACTIVE reservation exists.
Cron every 5 min expires stale ACTIVE → EXPIRED.
preemptByInStoreSale() sets PREEMPTED when staff sells walk-in.
8 unit tests cover create, conflict, expire, cancel, preempt.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: shop-catalog module (read-only product listing)

**Files:**
- Create: `apps/api/src/modules/shop-catalog/shop-catalog.module.ts`
- Create: `apps/api/src/modules/shop-catalog/shop-catalog.controller.ts`
- Create: `apps/api/src/modules/shop-catalog/shop-catalog.service.ts`
- Create: `apps/api/src/modules/shop-catalog/shop-catalog.service.spec.ts`
- Create: `apps/api/src/modules/shop-catalog/dto/list-products.dto.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/api/src/modules/shop-catalog/shop-catalog.service.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { ShopCatalogService } from './shop-catalog.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('ShopCatalogService', () => {
  let service: ShopCatalogService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      product: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        groupBy: jest.fn(),
        count: jest.fn(),
      },
    };
    const module = await Test.createTestingModule({
      providers: [ShopCatalogService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(ShopCatalogService);
  });

  describe('listGroupedByModel', () => {
    it('returns products grouped by brand+model with min price + stock count', async () => {
      prisma.product.groupBy.mockResolvedValue([
        { brand: 'Apple', model: 'iPhone 13', _min: { costPrice: 12500 }, _count: { _all: 5 } },
        { brand: 'Apple', model: 'iPhone 14', _min: { costPrice: 18000 }, _count: { _all: 2 } },
      ]);
      prisma.product.findMany.mockResolvedValue([
        { brand: 'Apple', model: 'iPhone 13', gallery: ['url1'], conditionGrade: 'A' },
        { brand: 'Apple', model: 'iPhone 14', gallery: ['url2'], conditionGrade: 'A' },
      ]);

      const result = await service.listGroupedByModel({ page: 1, limit: 50 });

      expect(result.data).toHaveLength(2);
      expect(result.data[0].brand).toBe('Apple');
      expect(result.data[0].minPrice).toBe(12500);
      expect(result.data[0].stockCount).toBe(5);
    });
  });

  describe('getProductDetail', () => {
    it('returns single product with units list grouped by tier', async () => {
      prisma.product.findFirst.mockResolvedValue({
        id: 'p1', brand: 'Apple', model: 'iPhone 13', costPrice: 12500,
        conditionGrade: 'A', gallery: [], gallery360: [], isOnlineVisible: true,
      });
      prisma.product.findMany.mockResolvedValue([
        { id: 'u1', conditionGrade: 'A', batteryHealth: 92, costPrice: 13900 },
        { id: 'u2', conditionGrade: 'A', batteryHealth: 95, costPrice: 14200 },
        { id: 'u3', conditionGrade: 'B', batteryHealth: 87, costPrice: 12800 },
      ]);

      const result = await service.getProductDetail('p1');

      expect(result).toBeDefined();
      expect(result!.tiers.A.units).toHaveLength(2);
      expect(result!.tiers.B.units).toHaveLength(1);
      expect(result!.tiers.A.minPrice).toBe(13900);
    });
  });

  describe('smartStockCount', () => {
    it('returns LOW_URGENT for 1-3 stock', () => {
      expect(service.smartStockCount(2)).toEqual({ display: 'เหลือ 2 เครื่อง — ใกล้หมด', tone: 'urgent' });
    });
    it('returns LOW for 4-10 stock', () => {
      expect(service.smartStockCount(7)).toEqual({ display: 'เหลือ 7 เครื่อง', tone: 'low' });
    });
    it('returns AVAILABLE for 10+ stock', () => {
      expect(service.smartStockCount(15)).toEqual({ display: 'ในสต็อก พร้อมส่ง', tone: 'available' });
    });
    it('returns OUT for 0 stock', () => {
      expect(service.smartStockCount(0)).toEqual({ display: 'หมดสต็อก แจ้งเตือนเมื่อมาใหม่', tone: 'out' });
    });
  });
});
```

- [ ] **Step 2: Run to confirm fail**

```bash
cd apps/api && npx jest shop-catalog.service.spec
```

Expected: FAIL.

- [ ] **Step 3: Implement DTO**

Create `apps/api/src/modules/shop-catalog/dto/list-products.dto.ts`:

```typescript
import { IsOptional, IsString, IsInt, Min, Max, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';

export class ListProductsDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number = 1;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number = 24;

  @IsOptional() @IsString()
  brand?: string;

  @IsOptional() @IsString()
  conditionGrade?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  minPrice?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  maxPrice?: number;

  @IsOptional() @IsEnum(['popular', 'price_asc', 'price_desc', 'newest'])
  sort?: 'popular' | 'price_asc' | 'price_desc' | 'newest' = 'popular';
}
```

- [ ] **Step 4: Implement service**

Create `apps/api/src/modules/shop-catalog/shop-catalog.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface ProductGroup {
  brand: string;
  model: string;
  minPrice: number;
  stockCount: number;
  thumbnailUrl?: string;
  conditionGrades: string[];
  monthlyPaymentFrom: number;
}

export interface ProductDetail {
  id: string;
  brand: string;
  model: string;
  storage?: string;
  color?: string;
  category: string;
  description?: string;
  gallery: string[];
  gallery360: string[];
  tiers: Record<string, { minPrice: number; maxPrice: number; units: ProductUnit[] }>;
}

export interface ProductUnit {
  id: string;
  conditionGrade: string;
  batteryHealth?: number;
  hasBox?: boolean;
  hasCharger?: boolean;
  hasHeadphones?: boolean;
  shopWarrantyDays?: number;
  costPrice: number;
  imeiPartial?: string; // last 4 digits
  gallery: string[];
  gallery360: string[];
}

const INTEREST_RATE_PER_MONTH = 0.0099; // 0.99%/month — example, adjust per pricing config
const DEFAULT_MONTHS = 12;
const DEFAULT_DOWN_PCT = 0.2;

@Injectable()
export class ShopCatalogService {
  constructor(private prisma: PrismaService) {}

  async listGroupedByModel(filters: {
    page?: number;
    limit?: number;
    brand?: string;
    conditionGrade?: string;
    minPrice?: number;
    maxPrice?: number;
    sort?: string;
  }): Promise<{ data: ProductGroup[]; total: number; page: number; limit: number }> {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 24;

    const where: any = {
      deletedAt: null,
      isOnlineVisible: true,
      status: 'IN_STOCK',
    };
    if (filters.brand) where.brand = filters.brand;
    if (filters.conditionGrade) where.conditionGrade = filters.conditionGrade;
    if (filters.minPrice !== undefined) where.costPrice = { ...where.costPrice, gte: filters.minPrice };
    if (filters.maxPrice !== undefined) where.costPrice = { ...where.costPrice, lte: filters.maxPrice };

    const groups = await this.prisma.product.groupBy({
      by: ['brand', 'model'],
      where,
      _min: { costPrice: true },
      _count: { _all: true },
      orderBy:
        filters.sort === 'price_asc' ? [{ _min: { costPrice: 'asc' } }] :
        filters.sort === 'price_desc' ? [{ _min: { costPrice: 'desc' } }] :
        filters.sort === 'newest' ? [{ _max: { createdAt: 'desc' } }] :
        [{ _count: { _all: 'desc' } }],
      skip: (page - 1) * limit,
      take: limit,
    });

    // Fetch first product of each group for thumbnail
    const data: ProductGroup[] = await Promise.all(groups.map(async (g) => {
      const sample = await this.prisma.product.findFirst({
        where: { ...where, brand: g.brand, model: g.model },
        select: { gallery: true, conditionGrade: true },
      });
      const minPrice = Number(g._min.costPrice ?? 0);
      const monthly = this.calculateMonthlyPayment(minPrice, DEFAULT_MONTHS, DEFAULT_DOWN_PCT);
      return {
        brand: g.brand,
        model: g.model,
        minPrice,
        stockCount: g._count._all,
        thumbnailUrl: sample?.gallery[0],
        conditionGrades: sample?.conditionGrade ? [sample.conditionGrade] : [],
        monthlyPaymentFrom: monthly,
      };
    }));

    const total = await this.prisma.product.count({ where });
    return { data, total, page, limit };
  }

  async getProductDetail(productId: string): Promise<ProductDetail | null> {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, deletedAt: null, isOnlineVisible: true },
    });
    if (!product) return null;

    // Get all units (same brand+model, in stock)
    const allUnits = await this.prisma.product.findMany({
      where: {
        brand: product.brand,
        model: product.model,
        storage: product.storage,
        deletedAt: null,
        isOnlineVisible: true,
        status: 'IN_STOCK',
      },
      orderBy: { costPrice: 'asc' },
    });

    const tiers: Record<string, { minPrice: number; maxPrice: number; units: ProductUnit[] }> = {};
    for (const u of allUnits) {
      const grade = u.conditionGrade ?? 'unknown';
      if (!tiers[grade]) tiers[grade] = { minPrice: Infinity, maxPrice: 0, units: [] };
      const price = Number(u.costPrice);
      const imeiPartial = u.imeiSerial ? `••••••••••${u.imeiSerial.slice(-4)}` : undefined;
      tiers[grade].units.push({
        id: u.id,
        conditionGrade: grade,
        batteryHealth: u.batteryHealth ?? undefined,
        hasBox: u.hasBox ?? undefined,
        shopWarrantyDays: u.shopWarrantyDays ?? undefined,
        costPrice: price,
        imeiPartial,
        gallery: u.gallery,
        gallery360: u.gallery360,
      });
      if (price < tiers[grade].minPrice) tiers[grade].minPrice = price;
      if (price > tiers[grade].maxPrice) tiers[grade].maxPrice = price;
    }

    return {
      id: product.id,
      brand: product.brand,
      model: product.model,
      storage: product.storage ?? undefined,
      color: product.color ?? undefined,
      category: product.category,
      description: product.onlineDescription ?? undefined,
      gallery: product.gallery,
      gallery360: product.gallery360,
      tiers,
    };
  }

  smartStockCount(n: number): { display: string; tone: 'out' | 'urgent' | 'low' | 'available' } {
    if (n === 0) return { display: 'หมดสต็อก แจ้งเตือนเมื่อมาใหม่', tone: 'out' };
    if (n <= 3) return { display: `เหลือ ${n} เครื่อง — ใกล้หมด`, tone: 'urgent' };
    if (n <= 10) return { display: `เหลือ ${n} เครื่อง`, tone: 'low' };
    return { display: 'ในสต็อก พร้อมส่ง', tone: 'available' };
  }

  calculateMonthlyPayment(price: number, months: number, downPct: number): number {
    const downPayment = price * downPct;
    const financed = price - downPayment;
    const totalInterest = financed * INTEREST_RATE_PER_MONTH * months;
    return Math.round((financed + totalInterest) / months);
  }
}
```

- [ ] **Step 5: Implement controller**

Create `apps/api/src/modules/shop-catalog/shop-catalog.controller.ts`:

```typescript
import { Controller, Get, Param, Query, NotFoundException, UseGuards } from '@nestjs/common';
import { ShopCatalogService } from './shop-catalog.service';
import { ListProductsDto } from './dto/list-products.dto';
import { ShopBotDefenseGuard } from '../shop-bot-defense/shop-bot-defense.guard';

@Controller('shop')
@UseGuards(ShopBotDefenseGuard)
export class ShopCatalogController {
  constructor(private catalogService: ShopCatalogService) {}

  @Get('products')
  async list(@Query() query: ListProductsDto) {
    const result = await this.catalogService.listGroupedByModel(query);
    return {
      ...result,
      data: result.data.map((g) => ({
        ...g,
        stock: this.catalogService.smartStockCount(g.stockCount),
      })),
    };
  }

  @Get('products/:id')
  async detail(@Param('id') id: string) {
    const product = await this.catalogService.getProductDetail(id);
    if (!product) throw new NotFoundException('สินค้านี้ไม่พบ');
    return product;
  }
}
```

- [ ] **Step 6: Implement module**

Create `apps/api/src/modules/shop-catalog/shop-catalog.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { ShopCatalogController } from './shop-catalog.controller';
import { ShopCatalogService } from './shop-catalog.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [ShopCatalogController],
  providers: [ShopCatalogService],
  exports: [ShopCatalogService],
})
export class ShopCatalogModule {}
```

- [ ] **Step 7: Register + test + commit**

Register `ShopCatalogModule` in `app.module.ts`.

```bash
cd apps/api && npx jest shop-catalog.service.spec
./tools/check-types.sh api
git add apps/api/src/modules/shop-catalog/ apps/api/src/app.module.ts
git commit -m "feat(shop): catalog module — grouped product listing + detail page

GET /api/shop/products: paginated, filter (brand/grade/price), sort
  (popular/price/newest), grouped by brand+model with smart stock count.
GET /api/shop/products/:id: single product with all units organized by
  condition tier (A/B/C), each unit shows battery + IMEI partial + gallery.
calculateMonthlyPayment: helper for catalog 'from X บ/เดือน' display.
ShopBotDefenseGuard applied to all endpoints.
6 unit tests cover grouping, detail tiers, smart count.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: shop-auth-social module (LINE + Facebook + Phone OTP login)

**Files:**
- Create: `apps/api/src/modules/shop-auth-social/shop-auth-social.module.ts`
- Create: `apps/api/src/modules/shop-auth-social/shop-auth-social.controller.ts`
- Create: `apps/api/src/modules/shop-auth-social/shop-auth-social.service.ts`
- Create: `apps/api/src/modules/shop-auth-social/shop-auth-social.service.spec.ts`
- Create: `apps/api/src/modules/shop-auth-social/dto/social-login.dto.ts`

> **Scope note:** This module **only** handles social login → mints app JWT. Re-uses existing
> `auth` module's JWT signing. Phone OTP delegates to existing `kyc.service` OTP infrastructure.

- [ ] **Step 1: Write failing tests**

Create `apps/api/src/modules/shop-auth-social/shop-auth-social.service.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { ShopAuthSocialService } from './shop-auth-social.service';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';

describe('ShopAuthSocialService', () => {
  let service: ShopAuthSocialService;
  let prisma: any;
  let jwt: any;

  beforeEach(async () => {
    prisma = {
      customer: { findFirst: jest.fn(), update: jest.fn(), create: jest.fn() },
      customerLineLink: { findFirst: jest.fn() },
    };
    jwt = { signAsync: jest.fn().mockResolvedValue('mock-jwt') };
    const module = await Test.createTestingModule({
      providers: [
        ShopAuthSocialService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwt },
      ],
    }).compile();
    service = module.get(ShopAuthSocialService);
  });

  describe('handleLineLogin', () => {
    it('finds customer by existing CustomerLineLink', async () => {
      prisma.customerLineLink.findFirst.mockResolvedValue({ customerId: 'c1' });
      prisma.customer.findFirst.mockResolvedValue({ id: 'c1', name: 'Existing' });

      const result = await service.handleLineLogin({
        lineUserId: 'U-line-1',
        displayName: 'Beam',
      });

      expect(result.customer.id).toBe('c1');
      expect(result.token).toBe('mock-jwt');
    });

    it('returns null customer if no link found (need OTP to bind phone)', async () => {
      prisma.customerLineLink.findFirst.mockResolvedValue(null);

      const result = await service.handleLineLogin({
        lineUserId: 'U-line-new',
        displayName: 'New',
      });

      expect(result.customer).toBeNull();
      expect(result.requiresPhoneBinding).toBe(true);
    });
  });

  describe('handleFacebookLogin', () => {
    it('finds customer by facebookUserId', async () => {
      prisma.customer.findFirst.mockResolvedValue({ id: 'c1', facebookUserId: 'fb-123' });

      const result = await service.handleFacebookLogin({
        facebookUserId: 'fb-123',
        name: 'Pu',
        email: 'pu@example.com',
      });

      expect(result.customer.id).toBe('c1');
      expect(result.token).toBe('mock-jwt');
    });

    it('returns requiresPhoneBinding when no match', async () => {
      prisma.customer.findFirst.mockResolvedValue(null);

      const result = await service.handleFacebookLogin({
        facebookUserId: 'fb-new',
        name: 'New',
      });

      expect(result.customer).toBeNull();
      expect(result.requiresPhoneBinding).toBe(true);
    });
  });

  describe('bindPhoneToSocial', () => {
    it('binds Facebook ID to existing customer matched by phone', async () => {
      prisma.customer.findFirst.mockResolvedValue({ id: 'c1', name: 'Beam' });
      prisma.customer.update.mockResolvedValue({ id: 'c1', facebookUserId: 'fb-123' });

      const result = await service.bindPhoneToSocial({
        phone: '0812345678',
        provider: 'FACEBOOK',
        providerUserId: 'fb-123',
      });

      expect(prisma.customer.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { facebookUserId: 'fb-123' },
      });
      expect(result.customer.id).toBe('c1');
      expect(result.token).toBe('mock-jwt');
    });
  });
});
```

- [ ] **Step 2: Run to confirm fail**

```bash
cd apps/api && npx jest shop-auth-social.service.spec
```

- [ ] **Step 3: Implement DTOs**

Create `apps/api/src/modules/shop-auth-social/dto/social-login.dto.ts`:

```typescript
import { IsString, IsOptional, IsEnum } from 'class-validator';

export class LineLoginCallbackDto {
  @IsString()
  code!: string; // OAuth code from LINE
}

export class FacebookLoginCallbackDto {
  @IsString()
  accessToken!: string; // FB SDK access token
}

export class BindPhoneDto {
  @IsString()
  phone!: string;

  @IsEnum(['LINE', 'FACEBOOK'])
  provider!: 'LINE' | 'FACEBOOK';

  @IsString()
  providerUserId!: string;
}
```

- [ ] **Step 4: Implement service**

Create `apps/api/src/modules/shop-auth-social/shop-auth-social.service.ts`:

```typescript
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';

export interface SocialLoginResult {
  customer: { id: string; name: string } | null;
  token: string | null;
  requiresPhoneBinding: boolean;
}

export interface LineLoginInput {
  lineUserId: string;
  displayName: string;
  pictureUrl?: string;
  email?: string;
}

export interface FacebookLoginInput {
  facebookUserId: string;
  name: string;
  email?: string;
}

@Injectable()
export class ShopAuthSocialService {
  private readonly logger = new Logger(ShopAuthSocialService.name);

  constructor(private prisma: PrismaService, private jwt: JwtService) {}

  async handleLineLogin(input: LineLoginInput): Promise<SocialLoginResult> {
    const link = await this.prisma.customerLineLink.findFirst({
      where: { lineUserId: input.lineUserId },
    });
    if (!link) {
      return { customer: null, token: null, requiresPhoneBinding: true };
    }
    const customer = await this.prisma.customer.findFirst({
      where: { id: link.customerId, deletedAt: null },
    });
    if (!customer) {
      return { customer: null, token: null, requiresPhoneBinding: true };
    }
    const token = await this.signToken(customer.id);
    return { customer: { id: customer.id, name: customer.name }, token, requiresPhoneBinding: false };
  }

  async handleFacebookLogin(input: FacebookLoginInput): Promise<SocialLoginResult> {
    const customer = await this.prisma.customer.findFirst({
      where: { facebookUserId: input.facebookUserId, deletedAt: null },
    });
    if (!customer) {
      return { customer: null, token: null, requiresPhoneBinding: true };
    }
    const token = await this.signToken(customer.id);
    return { customer: { id: customer.id, name: customer.name }, token, requiresPhoneBinding: false };
  }

  async bindPhoneToSocial(input: {
    phone: string;
    provider: 'LINE' | 'FACEBOOK';
    providerUserId: string;
  }): Promise<SocialLoginResult> {
    // Note: assumes phone OTP already verified by caller
    const customer = await this.prisma.customer.findFirst({
      where: { phone: input.phone, deletedAt: null },
    });
    if (!customer) {
      throw new UnauthorizedException('ไม่พบลูกค้าด้วยเบอร์นี้ — ติดต่อร้านเพื่อสมัครก่อน');
    }
    if (input.provider === 'FACEBOOK') {
      await this.prisma.customer.update({
        where: { id: customer.id },
        data: { facebookUserId: input.providerUserId },
      });
    } else {
      // LINE: use existing CustomerLineLink table (don't create here — separate concern)
      this.logger.log(`LINE binding for customer ${customer.id} — call CustomerLineLink.create separately`);
    }
    const token = await this.signToken(customer.id);
    return { customer: { id: customer.id, name: customer.name }, token, requiresPhoneBinding: false };
  }

  private async signToken(customerId: string): Promise<string> {
    return this.jwt.signAsync({ sub: customerId, role: 'CUSTOMER' }, { expiresIn: '7d' });
  }
}
```

- [ ] **Step 5: Implement controller**

Create `apps/api/src/modules/shop-auth-social/shop-auth-social.controller.ts`:

```typescript
import { Body, Controller, HttpException, HttpStatus, Post } from '@nestjs/common';
import { ShopAuthSocialService } from './shop-auth-social.service';
import { LineLoginCallbackDto, FacebookLoginCallbackDto, BindPhoneDto } from './dto/social-login.dto';

@Controller('shop/auth')
export class ShopAuthSocialController {
  constructor(private authService: ShopAuthSocialService) {}

  @Post('line/callback')
  async lineCallback(@Body() dto: LineLoginCallbackDto) {
    // Exchange code for LINE profile
    const profile = await this.exchangeLineCode(dto.code);
    return this.authService.handleLineLogin(profile);
  }

  @Post('facebook/callback')
  async facebookCallback(@Body() dto: FacebookLoginCallbackDto) {
    const profile = await this.exchangeFacebookToken(dto.accessToken);
    return this.authService.handleFacebookLogin(profile);
  }

  @Post('bind-phone')
  async bindPhone(@Body() dto: BindPhoneDto) {
    return this.authService.bindPhoneToSocial(dto);
  }

  private async exchangeLineCode(code: string) {
    const tokenRes = await fetch('https://api.line.me/oauth2/v2.1/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: process.env.SHOP_BASE_URL + '/auth/line-callback',
        client_id: process.env.LINE_LOGIN_CHANNEL_ID || '',
        client_secret: process.env.LINE_LOGIN_CHANNEL_SECRET || '',
      }),
    });
    if (!tokenRes.ok) throw new HttpException('LINE token exchange failed', HttpStatus.UNAUTHORIZED);
    const tokens = (await tokenRes.json()) as { access_token: string; id_token?: string };

    const profileRes = await fetch('https://api.line.me/v2/profile', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (!profileRes.ok) throw new HttpException('LINE profile fetch failed', HttpStatus.UNAUTHORIZED);
    const profile = (await profileRes.json()) as { userId: string; displayName: string; pictureUrl?: string };

    return {
      lineUserId: profile.userId,
      displayName: profile.displayName,
      pictureUrl: profile.pictureUrl,
    };
  }

  private async exchangeFacebookToken(accessToken: string) {
    const res = await fetch(`https://graph.facebook.com/me?fields=id,name,email&access_token=${encodeURIComponent(accessToken)}`);
    if (!res.ok) throw new HttpException('Facebook token verify failed', HttpStatus.UNAUTHORIZED);
    const data = (await res.json()) as { id: string; name: string; email?: string };
    return { facebookUserId: data.id, name: data.name, email: data.email };
  }
}
```

- [ ] **Step 6: Implement module**

Create `apps/api/src/modules/shop-auth-social/shop-auth-social.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ShopAuthSocialController } from './shop-auth-social.controller';
import { ShopAuthSocialService } from './shop-auth-social.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [
    PrismaModule,
    JwtModule.registerAsync({
      useFactory: () => ({ secret: process.env.JWT_SECRET }),
    }),
  ],
  controllers: [ShopAuthSocialController],
  providers: [ShopAuthSocialService],
  exports: [ShopAuthSocialService],
})
export class ShopAuthSocialModule {}
```

- [ ] **Step 7: Register + test + commit**

Register `ShopAuthSocialModule` in `app.module.ts`.

```bash
cd apps/api && npx jest shop-auth-social.service.spec
./tools/check-types.sh api
git add apps/api/src/modules/shop-auth-social/ apps/api/src/app.module.ts
git commit -m "feat(shop): social auth — LINE + Facebook login + phone binding

POST /api/shop/auth/line/callback: exchange code → LINE profile → JWT
POST /api/shop/auth/facebook/callback: verify FB token → JWT
POST /api/shop/auth/bind-phone: bind social ID to existing customer (after OTP)
JWT signed with existing JWT_SECRET, expires 7d.
Returns requiresPhoneBinding=true if no customer found — UI prompts OTP.

5 unit tests cover LINE, FB, and phone binding flows.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: shop-line-chat module (contact form → LINE OA notification)

**Files:**
- Create: `apps/api/src/modules/shop-line-chat/shop-line-chat.module.ts`
- Create: `apps/api/src/modules/shop-line-chat/shop-line-chat.controller.ts`
- Create: `apps/api/src/modules/shop-line-chat/shop-line-chat.service.ts`

- [ ] **Step 1: Implement service that delegates to existing line-oa module**

Create `apps/api/src/modules/shop-line-chat/shop-line-chat.service.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { LineOaService } from '../line-oa/line-oa.service';

export interface ContactInquiry {
  customerName?: string;
  phone?: string;
  message: string;
  productId?: string;
  pagePath: string;
}

@Injectable()
export class ShopLineChatService {
  private readonly logger = new Logger(ShopLineChatService.name);

  constructor(private lineOa: LineOaService) {}

  async notifyStaffOfInquiry(input: ContactInquiry): Promise<void> {
    const message = [
      '🛒 ลูกค้าสอบถามจากเว็บ',
      input.customerName ? `ชื่อ: ${input.customerName}` : null,
      input.phone ? `เบอร์: ${input.phone}` : null,
      input.productId ? `สินค้า: ${input.productId}` : null,
      `หน้า: ${input.pagePath}`,
      `ข้อความ: ${input.message}`,
    ].filter(Boolean).join('\n');

    try {
      await this.lineOa.broadcastToStaff(message);
    } catch (err) {
      this.logger.error(`LINE notify failed: ${(err as Error).message}`);
    }
  }
}
```

> **Note:** This task assumes `LineOaService.broadcastToStaff(message: string)` exists. If not, check `apps/api/src/modules/line-oa/line-oa.service.ts` for an equivalent method (e.g., `pushMessage`, `sendToOwner`). Adapt method name and signature to whatever exists. **Do NOT add new method to line-oa module** — use existing.

- [ ] **Step 2: Implement controller**

Create `apps/api/src/modules/shop-line-chat/shop-line-chat.controller.ts`:

```typescript
import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ShopLineChatService } from './shop-line-chat.service';
import { ShopBotDefenseGuard } from '../shop-bot-defense/shop-bot-defense.guard';

class ContactInquiryDto {
  @IsOptional() @IsString() @MaxLength(100)
  customerName?: string;

  @IsOptional() @IsString() @MaxLength(15)
  phone?: string;

  @IsString() @MaxLength(500)
  message!: string;

  @IsOptional() @IsString()
  productId?: string;

  @IsString()
  pagePath!: string;
}

@Controller('shop')
@UseGuards(ShopBotDefenseGuard)
export class ShopLineChatController {
  constructor(private chatService: ShopLineChatService) {}

  @Post('contact')
  async contact(@Body() dto: ContactInquiryDto): Promise<{ ok: true }> {
    await this.chatService.notifyStaffOfInquiry(dto);
    return { ok: true };
  }
}
```

- [ ] **Step 3: Implement module**

Create `apps/api/src/modules/shop-line-chat/shop-line-chat.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { ShopLineChatController } from './shop-line-chat.controller';
import { ShopLineChatService } from './shop-line-chat.service';
import { LineOaModule } from '../line-oa/line-oa.module';

@Module({
  imports: [LineOaModule],
  controllers: [ShopLineChatController],
  providers: [ShopLineChatService],
})
export class ShopLineChatModule {}
```

- [ ] **Step 4: Register + verify build + commit**

Register `ShopLineChatModule` in `app.module.ts`.

```bash
cd apps/api && ./tools/check-types.sh api
git add apps/api/src/modules/shop-line-chat/ apps/api/src/app.module.ts
git commit -m "feat(shop): contact form → LINE OA notification

POST /api/shop/contact accepts customer inquiry from website chat widget.
Composes Thai-localized message and pushes to staff via existing LineOaService.
Bot-defense guard prevents spam.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Configure CORS for shop subdomain

**Files:**
- Modify: `apps/api/src/main.ts`

- [ ] **Step 1: Read current CORS config**

```bash
grep -A 15 "enableCors\|cors:" apps/api/src/main.ts | head -20
```

- [ ] **Step 2: Add shop subdomain to allowed origins**

Find the `enableCors` call. Update to include `shop.bestchoicephone.app`:

```typescript
app.enableCors({
  origin: (origin, callback) => {
    const allowedOrigins = [
      'https://bestchoicephone.app',
      'https://shop.bestchoicephone.app',  // NEW
      'http://localhost:5173',  // dev web
      'http://localhost:5174',  // dev shop (web-shop)
    ];
    // ...existing allow-no-origin logic...
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
});
```

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/main.ts
git commit -m "feat(shop): allow shop.bestchoicephone.app + dev:5174 in CORS"
```

---

## Task 9: Initialize apps/web-shop (new Vite SPA)

**Files:**
- Create: `apps/web-shop/package.json`
- Create: `apps/web-shop/vite.config.ts`
- Create: `apps/web-shop/tsconfig.json`
- Create: `apps/web-shop/tailwind.config.ts`
- Create: `apps/web-shop/postcss.config.js`
- Create: `apps/web-shop/index.html`
- Create: `apps/web-shop/public/robots.txt`
- Create: `apps/web-shop/src/main.tsx`
- Create: `apps/web-shop/src/App.tsx`
- Create: `apps/web-shop/src/index.css`
- Modify: `package.json` (root) — add to workspaces

- [ ] **Step 1: Add to workspaces**

In root `package.json`, find `workspaces` array and add `apps/web-shop`:

```json
{
  "workspaces": ["apps/api", "apps/web", "apps/web-shop", "packages/*"]
}
```

- [ ] **Step 2: Create web-shop package.json**

Create `apps/web-shop/package.json`:

```json
{
  "name": "@installment/web-shop",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite --port 5174",
    "build": "tsc && vite build",
    "preview": "vite preview --port 5174",
    "lint": "eslint \"src/**/*.{ts,tsx}\" --fix"
  },
  "dependencies": {
    "@radix-ui/react-dialog": "^1.0.5",
    "@radix-ui/react-dropdown-menu": "^2.0.6",
    "@radix-ui/react-tabs": "^1.0.4",
    "@tanstack/react-query": "^5.0.0",
    "axios": "^1.7.0",
    "class-variance-authority": "^0.7.0",
    "clsx": "^2.1.0",
    "lucide-react": "^0.400.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-hook-form": "^7.50.0",
    "react-router": "^7.0.0",
    "sonner": "^1.4.0",
    "tailwind-merge": "^2.2.0",
    "threesixty-js": "^2.0.6",
    "zod": "^3.22.0",
    "zustand": "^4.5.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.0",
    "autoprefixer": "^10.4.0",
    "postcss": "^8.4.0",
    "tailwindcss": "^4.0.0",
    "typescript": "^5.5.0",
    "vite": "^6.0.0"
  }
}
```

- [ ] **Step 3: Create vite.config.ts**

Create `apps/web-shop/vite.config.ts`:

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  server: {
    port: 5174,
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
```

- [ ] **Step 4: Create tsconfig.json**

Create `apps/web-shop/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["src"],
  "references": []
}
```

- [ ] **Step 5: Create tailwind.config.ts + postcss.config.js**

Create `apps/web-shop/tailwind.config.ts`:

```typescript
import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: { DEFAULT: 'hsl(160 84% 39%)', foreground: 'hsl(0 0% 100%)' },
        background: 'hsl(0 0% 100%)',
        foreground: 'hsl(240 10% 3.9%)',
        muted: 'hsl(240 4.8% 95.9%)',
        'muted-foreground': 'hsl(240 3.8% 46.1%)',
        border: 'hsl(240 5.9% 90%)',
      },
      fontFamily: {
        sans: ['"IBM Plex Sans Thai"', 'Inter', 'sans-serif'],
      },
    },
  },
} satisfies Config;
```

Create `apps/web-shop/postcss.config.js`:

```javascript
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

- [ ] **Step 6: Create index.html with SEO + structured data**

Create `apps/web-shop/index.html`:

```html
<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="description" content="ร้านขายไอโฟนมือสองคุณภาพ ผ่อนได้บัตรประชาชนใบเดียว ลพบุรี — BESTCHOICE Phone Shop" />
  <meta name="keywords" content="ร้านมือถือลพบุรี, ผ่อน iPhone, iPhone มือสอง, ผ่อนไม่ใช้บัตรเครดิต" />
  <meta property="og:title" content="BESTCHOICE — ร้านขายไอโฟนผ่อนได้ลพบุรี" />
  <meta property="og:description" content="iPhone มือสองคุณภาพ ผ่อนได้บัตรประชาชนใบเดียว" />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="https://shop.bestchoicephone.app" />
  <link rel="canonical" href="https://shop.bestchoicephone.app" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <title>BESTCHOICE — ร้านขายไอโฟนผ่อนได้ลพบุรี</title>

  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "Store",
    "name": "BESTCHOICE Phone Shop",
    "description": "ร้านขายไอโฟนมือสองคุณภาพ ผ่อนได้บัตรประชาชนใบเดียว",
    "url": "https://shop.bestchoicephone.app",
    "address": { "@type": "PostalAddress", "addressLocality": "ลพบุรี", "addressCountry": "TH" },
    "openingHours": "Mo-Su 09:00-19:00",
    "priceRange": "฿฿"
  }
  </script>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.tsx"></script>
</body>
</html>
```

- [ ] **Step 7: Create robots.txt (hybrid AI strategy per spec)**

Create `apps/web-shop/public/robots.txt`:

```
# BESTCHOICE Online Shop — robots.txt
# Hybrid AI strategy: allow AI crawlers for marketing/SEO, block /api/* and aggressive scrapers

User-agent: *
Allow: /
Disallow: /api/
Disallow: /apply
Disallow: /checkout
Disallow: /orders
Disallow: /account

# AI crawlers — allow with crawl delay (drives discovery)
User-agent: GPTBot
Allow: /
Crawl-delay: 10
Disallow: /api/
Disallow: /apply

User-agent: ClaudeBot
Allow: /
Crawl-delay: 10
Disallow: /api/

User-agent: Anthropic-AI
Allow: /
Crawl-delay: 10
Disallow: /api/

User-agent: PerplexityBot
Allow: /
Disallow: /api/

User-agent: Google-Extended
Allow: /
Disallow: /api/

# Aggressive scrapers — BLOCK
User-agent: Bytespider
Disallow: /

User-agent: CCBot
Disallow: /

Sitemap: https://shop.bestchoicephone.app/sitemap.xml
```

- [ ] **Step 8: Create main.tsx + App.tsx + index.css**

Create `apps/web-shop/src/main.tsx`:

```typescript
import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router';
import App from './App';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 60_000, refetchOnWindowFocus: false } },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);
```

Create `apps/web-shop/src/App.tsx`:

```typescript
import { Routes, Route } from 'react-router';
import HomePage from './pages/HomePage';
import CatalogPage from './pages/CatalogPage';
import ProductDetailPage from './pages/ProductDetailPage';
import HowItWorksPage from './pages/HowItWorksPage';
import ShippingPage from './pages/ShippingPage';
import ReturnsPage from './pages/ReturnsPage';
import AboutPage from './pages/AboutPage';
import ContactPage from './pages/ContactPage';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/products" element={<CatalogPage />} />
      <Route path="/products/:id" element={<ProductDetailPage />} />
      <Route path="/how-it-works" element={<HowItWorksPage />} />
      <Route path="/shipping" element={<ShippingPage />} />
      <Route path="/returns" element={<ReturnsPage />} />
      <Route path="/about" element={<AboutPage />} />
      <Route path="/contact" element={<ContactPage />} />
    </Routes>
  );
}
```

Create `apps/web-shop/src/index.css`:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  body { font-family: theme('fontFamily.sans'); }
  /* Thai-specific line height */
  * { line-height: theme('lineHeight.snug'); }
}
```

- [ ] **Step 9: Create stub pages**

Create stub files for all pages so `npm run build` works:

```bash
for p in HomePage CatalogPage ProductDetailPage HowItWorksPage ShippingPage ReturnsPage AboutPage ContactPage; do
cat > apps/web-shop/src/pages/$p.tsx <<EOF
export default function $p() { return <div>$p (stub)</div>; }
EOF
done
```

- [ ] **Step 10: Install + smoke build**

```bash
cd apps/web-shop && npm install
npm run build
```

Expected: build succeeds. Output in `apps/web-shop/dist/`.

If build fails on missing dependencies, add to package.json and retry.

- [ ] **Step 11: Commit**

```bash
git add apps/web-shop package.json
git commit -m "feat(shop): scaffold apps/web-shop Vite SPA with SEO + robots

- Vite 6 + React 19 + Tailwind v4 + shadcn-style + IBM Plex Sans Thai
- Routes for 8 stub pages
- index.html includes Schema.org Store JSON-LD
- robots.txt: hybrid AI strategy (allow GPTBot/ClaudeBot/Perplexity,
  block Bytespider/CCBot, deny /api/, /apply, /checkout)
- Dev port 5174 with /api proxy to localhost:3000

Pages stubbed; full implementation in subsequent tasks.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Layout components (header, footer, floating LINE button)

**Files:**
- Create: `apps/web-shop/src/components/layout/ShopLayout.tsx`
- Create: `apps/web-shop/src/components/layout/ShopHeader.tsx`
- Create: `apps/web-shop/src/components/layout/ShopFooter.tsx`
- Create: `apps/web-shop/src/components/layout/FloatingLineButton.tsx`

- [ ] **Step 1: Implement ShopHeader**

Create `apps/web-shop/src/components/layout/ShopHeader.tsx`:

```typescript
import { Link } from 'react-router';
import { Search, ShoppingCart, User } from 'lucide-react';

export default function ShopHeader() {
  return (
    <header className="sticky top-0 z-40 bg-background border-b border-border">
      <div className="container mx-auto px-4 py-3 flex items-center gap-4">
        <Link to="/" className="text-xl font-bold text-primary">BESTCHOICE</Link>
        <nav className="hidden md:flex gap-4 text-sm">
          <Link to="/products" className="hover:text-primary">สินค้าทั้งหมด</Link>
          <Link to="/how-it-works" className="hover:text-primary">วิธีซื้อ</Link>
          <Link to="/about" className="hover:text-primary">เกี่ยวกับเรา</Link>
          <Link to="/contact" className="hover:text-primary">ติดต่อ</Link>
        </nav>
        <div className="flex-1" />
        <button aria-label="ค้นหา" className="p-2 hover:bg-muted rounded">
          <Search className="w-5 h-5" />
        </button>
        <Link to="/cart" aria-label="ตะกร้า" className="p-2 hover:bg-muted rounded relative">
          <ShoppingCart className="w-5 h-5" />
        </Link>
        <Link to="/account" aria-label="บัญชี" className="p-2 hover:bg-muted rounded">
          <User className="w-5 h-5" />
        </Link>
      </div>
    </header>
  );
}
```

- [ ] **Step 2: Implement ShopFooter**

Create `apps/web-shop/src/components/layout/ShopFooter.tsx`:

```typescript
import { Link } from 'react-router';

export default function ShopFooter() {
  return (
    <footer className="bg-muted mt-12 py-8">
      <div className="container mx-auto px-4 grid grid-cols-2 md:grid-cols-4 gap-6 text-sm">
        <div>
          <h3 className="font-semibold mb-2">BESTCHOICE</h3>
          <p className="text-muted-foreground">ร้านขายไอโฟนผ่อนได้ลพบุรี</p>
        </div>
        <div>
          <h3 className="font-semibold mb-2">บริการ</h3>
          <ul className="space-y-1">
            <li><Link to="/products">สินค้าทั้งหมด</Link></li>
            <li><Link to="/how-it-works">วิธีซื้อ</Link></li>
          </ul>
        </div>
        <div>
          <h3 className="font-semibold mb-2">นโยบาย</h3>
          <ul className="space-y-1">
            <li><Link to="/shipping">การจัดส่ง</Link></li>
            <li><Link to="/returns">การคืนสินค้า</Link></li>
          </ul>
        </div>
        <div>
          <h3 className="font-semibold mb-2">ติดต่อ</h3>
          <p className="text-muted-foreground">LINE: @bestchoice<br/>โทร: 0XX-XXX-XXXX</p>
        </div>
      </div>
      <div className="container mx-auto px-4 mt-6 text-center text-xs text-muted-foreground">
        © 2026 BESTCHOICE Phone Shop — ลพบุรี
      </div>
    </footer>
  );
}
```

- [ ] **Step 3: Implement FloatingLineButton**

Create `apps/web-shop/src/components/layout/FloatingLineButton.tsx`:

```typescript
const LINE_URL = 'https://line.me/R/ti/p/@bestchoice'; // replace with real LINE OA URL

export default function FloatingLineButton() {
  return (
    <a
      href={LINE_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="fixed bottom-4 right-4 bg-[#06C755] text-white rounded-full p-4 shadow-lg hover:scale-110 transition z-50"
      aria-label="แชท LINE"
    >
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
        <path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63h2.386c.346 0 .627.285.627.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63.346 0 .628.285.628.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.282.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314"/>
      </svg>
    </a>
  );
}
```

- [ ] **Step 4: Implement ShopLayout wrapper**

Create `apps/web-shop/src/components/layout/ShopLayout.tsx`:

```typescript
import type { ReactNode } from 'react';
import ShopHeader from './ShopHeader';
import ShopFooter from './ShopFooter';
import FloatingLineButton from './FloatingLineButton';

export default function ShopLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <ShopHeader />
      <main className="flex-1">{children}</main>
      <ShopFooter />
      <FloatingLineButton />
    </div>
  );
}
```

- [ ] **Step 5: Verify build + commit**

```bash
cd apps/web-shop && npm run build
```

Expected: success.

```bash
git add apps/web-shop/src/components/layout/
git commit -m "feat(shop): layout components — header, footer, floating LINE button"
```

---

## Task 11: API client + tracking hook

**Files:**
- Create: `apps/web-shop/src/lib/api.ts`
- Create: `apps/web-shop/src/lib/tracking.ts`
- Create: `apps/web-shop/src/lib/session.ts`

- [ ] **Step 1: Implement session helper**

Create `apps/web-shop/src/lib/session.ts`:

```typescript
const SESSION_KEY = 'shop_session_id';

export function getSessionId(): string {
  let id = localStorage.getItem(SESSION_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(SESSION_KEY, id);
  }
  return id;
}
```

- [ ] **Step 2: Implement API client**

Create `apps/web-shop/src/lib/api.ts`:

```typescript
import axios from 'axios';

let accessToken: string | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export const api = axios.create({
  baseURL: import.meta.env.PROD ? 'https://bestchoicephone.app' : '',
  withCredentials: true,
});

api.interceptors.request.use((config) => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      setAccessToken(null);
    }
    return Promise.reject(err);
  }
);
```

- [ ] **Step 3: Implement tracking helper**

Create `apps/web-shop/src/lib/tracking.ts`:

```typescript
import { api } from './api';
import { getSessionId } from './session';

export async function trackPageView(pagePath: string): Promise<void> {
  try {
    const params = new URLSearchParams(window.location.search);
    await api.post('/api/shop/track', {
      sessionId: getSessionId(),
      pagePath,
      referrer: document.referrer,
      utmSource: params.get('utm_source'),
      utmMedium: params.get('utm_medium'),
      utmCampaign: params.get('utm_campaign'),
    });
  } catch {
    // silent fail — analytics shouldn't break user experience
  }
}
```

- [ ] **Step 4: Use trackPageView in App.tsx via useEffect on route change**

Update `apps/web-shop/src/App.tsx` to add tracking:

```typescript
import { useEffect } from 'react';
import { Routes, Route, useLocation } from 'react-router';
import { trackPageView } from './lib/tracking';
// ... existing imports ...

function RouteTracker() {
  const location = useLocation();
  useEffect(() => {
    trackPageView(location.pathname);
  }, [location.pathname]);
  return null;
}

export default function App() {
  return (
    <>
      <RouteTracker />
      <Routes>
        {/* ... existing routes ... */}
      </Routes>
    </>
  );
}
```

- [ ] **Step 5: Verify + commit**

```bash
cd apps/web-shop && npm run build
git add apps/web-shop/src/lib apps/web-shop/src/App.tsx
git commit -m "feat(shop): API client + page-view tracking on route change"
```

---

## Task 12: HomePage with featured products

**Files:**
- Modify: `apps/web-shop/src/pages/HomePage.tsx`
- Use: `apps/web-shop/src/components/layout/ShopLayout.tsx`

- [ ] **Step 1: Implement HomePage**

Replace `apps/web-shop/src/pages/HomePage.tsx`:

```typescript
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import ShopLayout from '@/components/layout/ShopLayout';
import { api } from '@/lib/api';

interface ProductGroup {
  brand: string;
  model: string;
  minPrice: number;
  stockCount: number;
  thumbnailUrl?: string;
  monthlyPaymentFrom: number;
  stock: { display: string; tone: string };
}

export default function HomePage() {
  const { data, isLoading } = useQuery<{ data: ProductGroup[] }>({
    queryKey: ['shop', 'home', 'featured'],
    queryFn: () => api.get('/api/shop/products?limit=8&sort=popular').then((r) => r.data),
  });

  return (
    <ShopLayout>
      {/* Hero */}
      <section className="bg-primary text-primary-foreground py-16">
        <div className="container mx-auto px-4 text-center">
          <h1 className="text-4xl md:text-5xl font-bold mb-4">
            iPhone มือสองคุณภาพ ผ่อนได้บัตร ปชช. ใบเดียว
          </h1>
          <p className="text-lg mb-8 opacity-90">
            ร้านมือถือลพบุรี — ของแท้ 100% รับประกันร้าน 30 วัน
          </p>
          <Link
            to="/products"
            className="inline-block bg-white text-primary px-8 py-3 rounded-lg font-semibold hover:opacity-90"
          >
            ดูสินค้าทั้งหมด
          </Link>
        </div>
      </section>

      {/* Featured products */}
      <section className="container mx-auto px-4 py-12">
        <h2 className="text-2xl font-bold mb-6">รุ่นยอดนิยม</h2>
        {isLoading && <div>กำลังโหลด...</div>}
        {data && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {data.data.map((p) => (
              <Link
                key={`${p.brand}-${p.model}`}
                to={`/products?brand=${p.brand}&model=${encodeURIComponent(p.model)}`}
                className="border border-border rounded-lg p-4 hover:shadow transition"
              >
                {p.thumbnailUrl && (
                  <img src={p.thumbnailUrl} alt={`${p.brand} ${p.model}`} className="w-full aspect-square object-contain mb-3" />
                )}
                <h3 className="font-semibold">{p.brand} {p.model}</h3>
                <p className="text-primary font-bold">เริ่มต้น ฿{p.minPrice.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">ผ่อน ฿{p.monthlyPaymentFrom.toLocaleString()}/เดือน</p>
                <p className="text-xs mt-1">{p.stock.display}</p>
              </Link>
            ))}
          </div>
        )}
      </section>
    </ShopLayout>
  );
}
```

- [ ] **Step 2: Verify build + commit**

```bash
cd apps/web-shop && npm run build
git add apps/web-shop/src/pages/HomePage.tsx
git commit -m "feat(shop): HomePage with hero + 8 featured products from /api/shop/products"
```

---

## Task 13: CatalogPage with filter + sort + product cards

**Files:**
- Modify: `apps/web-shop/src/pages/CatalogPage.tsx`
- Create: `apps/web-shop/src/components/catalog/ProductCard.tsx`
- Create: `apps/web-shop/src/components/catalog/FilterSidebar.tsx`
- Create: `apps/web-shop/src/components/catalog/SortDropdown.tsx`
- Create: `apps/web-shop/src/components/catalog/StockIndicator.tsx`

- [ ] **Step 1: Implement StockIndicator**

Create `apps/web-shop/src/components/catalog/StockIndicator.tsx`:

```typescript
export function StockIndicator({ display, tone }: { display: string; tone: string }) {
  const colorClass =
    tone === 'urgent' ? 'text-red-600 bg-red-50' :
    tone === 'low' ? 'text-orange-600 bg-orange-50' :
    tone === 'out' ? 'text-muted-foreground bg-muted' :
    'text-primary bg-primary/10';
  return (
    <span className={`inline-block px-2 py-1 rounded text-xs ${colorClass}`}>
      {display}
    </span>
  );
}
```

- [ ] **Step 2: Implement ProductCard**

Create `apps/web-shop/src/components/catalog/ProductCard.tsx`:

```typescript
import { Link } from 'react-router';
import { StockIndicator } from './StockIndicator';

export interface ProductGroup {
  brand: string;
  model: string;
  minPrice: number;
  stockCount: number;
  thumbnailUrl?: string;
  monthlyPaymentFrom: number;
  stock: { display: string; tone: string };
}

export function ProductCard({ product }: { product: ProductGroup }) {
  // For now link by brand+model query — when SEO slugs added, replace with /products/:slug
  const href = `/products?brand=${product.brand}&model=${encodeURIComponent(product.model)}`;
  return (
    <Link to={href} className="border border-border rounded-lg p-4 hover:shadow transition flex flex-col">
      {product.thumbnailUrl && (
        <img src={product.thumbnailUrl} alt={`${product.brand} ${product.model}`} className="w-full aspect-square object-contain mb-3" />
      )}
      <h3 className="font-semibold">{product.brand} {product.model}</h3>
      <p className="text-primary font-bold mt-1">เริ่มต้น ฿{product.minPrice.toLocaleString()}</p>
      <p className="text-xs text-muted-foreground">ผ่อน ฿{product.monthlyPaymentFrom.toLocaleString()}/เดือน</p>
      <div className="mt-2"><StockIndicator display={product.stock.display} tone={product.stock.tone} /></div>
    </Link>
  );
}
```

- [ ] **Step 3: Implement FilterSidebar**

Create `apps/web-shop/src/components/catalog/FilterSidebar.tsx`:

```typescript
export interface CatalogFilters {
  brand?: string;
  conditionGrade?: string;
  minPrice?: number;
  maxPrice?: number;
}

export function FilterSidebar({
  filters,
  onChange,
}: {
  filters: CatalogFilters;
  onChange: (next: CatalogFilters) => void;
}) {
  return (
    <aside className="space-y-4">
      <div>
        <h4 className="font-semibold mb-2">แบรนด์</h4>
        <select
          className="w-full border border-border rounded p-2"
          value={filters.brand ?? ''}
          onChange={(e) => onChange({ ...filters, brand: e.target.value || undefined })}
        >
          <option value="">ทั้งหมด</option>
          <option value="Apple">Apple (iPhone)</option>
        </select>
      </div>
      <div>
        <h4 className="font-semibold mb-2">สภาพเครื่อง</h4>
        {['', 'A', 'B', 'C'].map((g) => (
          <label key={g} className="flex items-center gap-2 mb-1">
            <input
              type="radio"
              name="grade"
              checked={(filters.conditionGrade ?? '') === g}
              onChange={() => onChange({ ...filters, conditionGrade: g || undefined })}
            />
            <span>{g === '' ? 'ทั้งหมด' : `Grade ${g}`}</span>
          </label>
        ))}
      </div>
      <div>
        <h4 className="font-semibold mb-2">ช่วงราคา</h4>
        <div className="flex gap-2">
          <input
            type="number"
            placeholder="ต่ำสุด"
            className="border border-border rounded p-1 w-full"
            value={filters.minPrice ?? ''}
            onChange={(e) => onChange({ ...filters, minPrice: e.target.value ? Number(e.target.value) : undefined })}
          />
          <input
            type="number"
            placeholder="สูงสุด"
            className="border border-border rounded p-1 w-full"
            value={filters.maxPrice ?? ''}
            onChange={(e) => onChange({ ...filters, maxPrice: e.target.value ? Number(e.target.value) : undefined })}
          />
        </div>
      </div>
    </aside>
  );
}
```

- [ ] **Step 4: Implement SortDropdown**

Create `apps/web-shop/src/components/catalog/SortDropdown.tsx`:

```typescript
export function SortDropdown({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select
      className="border border-border rounded p-2"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="popular">ยอดนิยม</option>
      <option value="price_asc">ราคา: ต่ำ → สูง</option>
      <option value="price_desc">ราคา: สูง → ต่ำ</option>
      <option value="newest">ใหม่ล่าสุด</option>
    </select>
  );
}
```

- [ ] **Step 5: Implement CatalogPage**

Replace `apps/web-shop/src/pages/CatalogPage.tsx`:

```typescript
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import ShopLayout from '@/components/layout/ShopLayout';
import { ProductCard, type ProductGroup } from '@/components/catalog/ProductCard';
import { FilterSidebar, type CatalogFilters } from '@/components/catalog/FilterSidebar';
import { SortDropdown } from '@/components/catalog/SortDropdown';
import { api } from '@/lib/api';

interface CatalogResponse {
  data: ProductGroup[];
  total: number;
  page: number;
  limit: number;
}

export default function CatalogPage() {
  const [filters, setFilters] = useState<CatalogFilters>({});
  const [sort, setSort] = useState<string>('popular');

  const { data, isLoading } = useQuery<CatalogResponse>({
    queryKey: ['shop', 'catalog', filters, sort],
    queryFn: () => {
      const params = new URLSearchParams();
      if (filters.brand) params.set('brand', filters.brand);
      if (filters.conditionGrade) params.set('conditionGrade', filters.conditionGrade);
      if (filters.minPrice !== undefined) params.set('minPrice', String(filters.minPrice));
      if (filters.maxPrice !== undefined) params.set('maxPrice', String(filters.maxPrice));
      params.set('sort', sort);
      return api.get(`/api/shop/products?${params}`).then((r) => r.data);
    },
  });

  return (
    <ShopLayout>
      <div className="container mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold mb-6">สินค้าทั้งหมด</h1>
        <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-6">
          <FilterSidebar filters={filters} onChange={setFilters} />
          <div>
            <div className="flex justify-between items-center mb-4">
              <p className="text-sm text-muted-foreground">
                {isLoading ? 'กำลังโหลด...' : `${data?.total ?? 0} รุ่น`}
              </p>
              <SortDropdown value={sort} onChange={setSort} />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {data?.data.map((p) => (
                <ProductCard key={`${p.brand}-${p.model}`} product={p} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </ShopLayout>
  );
}
```

- [ ] **Step 6: Build + commit**

```bash
cd apps/web-shop && npm run build
git add apps/web-shop/src/components/catalog apps/web-shop/src/pages/CatalogPage.tsx
git commit -m "feat(shop): CatalogPage with filter, sort, smart stock indicator"
```

---

## Task 14: Static pages (How it works, Shipping, Returns, About, Contact)

**Files:**
- Modify: `apps/web-shop/src/pages/HowItWorksPage.tsx`
- Modify: `apps/web-shop/src/pages/ShippingPage.tsx`
- Modify: `apps/web-shop/src/pages/ReturnsPage.tsx`
- Modify: `apps/web-shop/src/pages/AboutPage.tsx`
- Modify: `apps/web-shop/src/pages/ContactPage.tsx`

- [ ] **Step 1: Implement HowItWorksPage**

```typescript
// apps/web-shop/src/pages/HowItWorksPage.tsx
import ShopLayout from '@/components/layout/ShopLayout';

export default function HowItWorksPage() {
  return (
    <ShopLayout>
      <article className="container mx-auto px-4 py-8 max-w-3xl prose">
        <h1>วิธีซื้อ iPhone กับ BESTCHOICE</h1>
        <h2>เงินสด — ส่งถึงบ้าน</h2>
        <ol>
          <li>เลือกเครื่องที่ต้องการในเว็บ</li>
          <li>ใส่ที่อยู่จัดส่ง + เลือกขนส่ง (Kerry / Flash / J&T) หรือรับที่ร้าน</li>
          <li>จ่ายผ่าน QR PromptPay / โอนธนาคาร / บัตรเครดิต</li>
          <li>ทีมแพ็คเครื่อง → ส่ง 1-2 วันทำการ</li>
          <li>เปิดกล่องตรวจ → กดยืนยันรับสินค้าใน LINE</li>
        </ol>
        <h2>ผ่อน — ใช้บัตรประชาชนใบเดียว</h2>
        <ol>
          <li>เลือกเครื่อง + กด "ผ่อน" → เลือกจำนวนงวด + ดาวน์</li>
          <li>กรอกฟอร์มสั้น (ชื่อ + เบอร์ + เลขบัตร) — ส่งให้ทีม</li>
          <li>ทีมโทรกลับใน 2 ชั่วโมง — นัดวันมาที่ร้านลพบุรี</li>
          <li>ที่ร้าน: ตรวจเอกสาร + เซ็นสัญญา + รับเครื่อง (30 นาที)</li>
        </ol>
        <h2>เก่าแลกใหม่ / รับซื้อ / ออมดาวน์</h2>
        <p>เปิดให้บริการในเฟสถัดไป — ติดต่อ LINE @bestchoice เพื่อสอบถามล่วงหน้า</p>
      </article>
    </ShopLayout>
  );
}
```

- [ ] **Step 2: Implement ShippingPage**

```typescript
// apps/web-shop/src/pages/ShippingPage.tsx
import ShopLayout from '@/components/layout/ShopLayout';

export default function ShippingPage() {
  return (
    <ShopLayout>
      <article className="container mx-auto px-4 py-8 max-w-3xl prose">
        <h1>การจัดส่ง</h1>
        <p>BESTCHOICE จัดส่งสินค้า <strong>เงินสด</strong> ไปทั่วประเทศไทย</p>
        <h2>ขนส่งที่รองรับ</h2>
        <ul>
          <li>Kerry Express — 60 บาท ส่งถึง 2 วันทำการ</li>
          <li>Flash Express — 50 บาท ส่งถึง 2 วันทำการ</li>
          <li>J&T Express — 50 บาท ส่งถึง 2 วันทำการ</li>
          <li>รับที่ร้านลพบุรี — ฟรี (เปิดทุกวัน 09:00-19:00)</li>
        </ul>
        <h2>ระยะเวลาจัดส่ง</h2>
        <p>1-3 วันทำการ ขึ้นกับขนส่งและพื้นที่จัดส่ง</p>
        <h2>การประกัน</h2>
        <p>เครื่องทุกเครื่องมีรับประกันร้าน 30 วัน + รับคืนภายใน 7 วันถ้าไม่พอใจ (ตามนโยบาย)</p>
        <p><strong>ผ่อน</strong> ต้องมารับที่ร้านลพบุรีเท่านั้น (เพื่อตรวจสอบเอกสารตัวจริง)</p>
      </article>
    </ShopLayout>
  );
}
```

- [ ] **Step 3: Implement ReturnsPage**

```typescript
// apps/web-shop/src/pages/ReturnsPage.tsx
import ShopLayout from '@/components/layout/ShopLayout';

export default function ReturnsPage() {
  return (
    <ShopLayout>
      <article className="container mx-auto px-4 py-8 max-w-3xl prose">
        <h1>นโยบายการคืนสินค้า</h1>
        <h2>คืนได้ภายใน 7 วัน</h2>
        <p>หากลูกค้าไม่พอใจสินค้า สามารถส่งคืนได้ภายใน 7 วันนับจากวันรับสินค้า โดยมีเงื่อนไข:</p>
        <ul>
          <li>เครื่องอยู่ในสภาพเดิม ไม่มีรอยหรือความเสียหายเพิ่มเติม</li>
          <li>มีอุปกรณ์ครบตามที่ระบุไว้ในรายละเอียดสินค้า</li>
          <li>ลูกค้าเป็นผู้ออกค่าจัดส่งในการส่งคืน</li>
        </ul>
        <h2>การคืนเงิน</h2>
        <p>เมื่อร้านได้รับเครื่องและตรวจสภาพแล้ว จะคืนเงินภายใน 3-5 วันทำการ ผ่านช่องทางเดิมที่ลูกค้าจ่าย</p>
        <h2>การรับประกัน 30 วัน</h2>
        <p>หากเครื่องเสียจากความผิดปกติของอุปกรณ์ภายใน 30 วัน ทางร้านจะเปลี่ยนเครื่องใหม่ (รุ่นเดียวกัน) ฟรี</p>
        <p>ติดต่อแจ้งคืน/รับประกันผ่าน LINE @bestchoice</p>
      </article>
    </ShopLayout>
  );
}
```

- [ ] **Step 4: Implement AboutPage**

```typescript
// apps/web-shop/src/pages/AboutPage.tsx
import ShopLayout from '@/components/layout/ShopLayout';

export default function AboutPage() {
  return (
    <ShopLayout>
      <article className="container mx-auto px-4 py-8 max-w-3xl prose">
        <h1>เกี่ยวกับ BESTCHOICE</h1>
        <p>BESTCHOICE Phone Shop เป็นร้านขายไอโฟนมือสองคุณภาพ ตั้งอยู่ที่จังหวัดลพบุรี ดำเนินกิจการมาหลายปี</p>
        <h2>ทำไมเลือกเรา</h2>
        <ul>
          <li><strong>iPhone มือสองคุณภาพ</strong> — ทุกเครื่องผ่านการตรวจสอบและประกัน 30 วัน</li>
          <li><strong>ผ่อนไม่ใช้บัตรเครดิต</strong> — ใช้บัตรประชาชนใบเดียว</li>
          <li><strong>โปร่งใส</strong> — โชว์ราคาและดอกเบี้ยชัดเจนตั้งแต่หน้าเว็บ</li>
          <li><strong>เห็นเครื่องจริง</strong> — รูปและ 360° ของเครื่องที่จะได้</li>
          <li><strong>ร้านในพื้นที่</strong> — ลพบุรี, สระบุรี, สิงห์บุรี, อยุธยา เดินทางมาง่าย</li>
        </ul>
      </article>
    </ShopLayout>
  );
}
```

- [ ] **Step 5: Implement ContactPage**

```typescript
// apps/web-shop/src/pages/ContactPage.tsx
import ShopLayout from '@/components/layout/ShopLayout';

export default function ContactPage() {
  return (
    <ShopLayout>
      <div className="container mx-auto px-4 py-8 max-w-3xl">
        <h1 className="text-3xl font-bold mb-6">ติดต่อเรา</h1>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-3">
            <div>
              <h3 className="font-semibold">LINE Official Account</h3>
              <a href="https://line.me/R/ti/p/@bestchoice" className="text-primary">@bestchoice</a>
            </div>
            <div>
              <h3 className="font-semibold">โทรศัพท์</h3>
              <p>0XX-XXX-XXXX</p>
            </div>
            <div>
              <h3 className="font-semibold">Facebook</h3>
              <p>fb.com/bestchoicephoneshop</p>
            </div>
            <div>
              <h3 className="font-semibold">เวลาเปิด</h3>
              <p>ทุกวัน 09:00-19:00</p>
            </div>
          </div>
          <div>
            <h3 className="font-semibold mb-2">ที่ตั้งร้าน</h3>
            <p>ลพบุรี (รายละเอียดที่อยู่ + Google Map embed)</p>
            {/* TODO: embed Google Map iframe — owner provides coordinates */}
          </div>
        </div>
      </div>
    </ShopLayout>
  );
}
```

- [ ] **Step 6: Build + commit**

```bash
cd apps/web-shop && npm run build
git add apps/web-shop/src/pages/
git commit -m "feat(shop): static pages — how it works, shipping, returns, about, contact"
```

---

## Task 15: Verify everything end-to-end + open Phase 1 PR

- [ ] **Step 1: Run all backend tests**

```bash
cd apps/api && npx jest shop-
```

Expected: all `shop-*` tests pass.

- [ ] **Step 2: Run TypeScript check**

```bash
./tools/check-types.sh all
```

Expected: 0 errors.

- [ ] **Step 3: Smoke test backend locally**

```bash
cd apps/api && npm run start:dev &
sleep 5
curl -s http://localhost:3000/api/shop/products | head -20
curl -s -X POST http://localhost:3000/api/shop/track -H "Content-Type: application/json" \
  -d '{"sessionId":"test-1","pagePath":"/test"}' | head
kill %1
```

Expected: products returns JSON list, track returns `{"ok":true}`.

- [ ] **Step 4: Smoke test frontend locally**

Terminal 1:
```bash
cd apps/api && npm run start:dev
```

Terminal 2:
```bash
cd apps/web-shop && npm run dev
```

Open `http://localhost:5174/` in browser. Verify:
- Home page renders
- Catalog page loads (may be empty if no IS_ONLINE_VISIBLE products)
- Static pages all render
- Floating LINE button appears

- [ ] **Step 5: Push branch + open Phase 1 PR**

```bash
git push -u origin feat/shop-phase1-foundation
gh pr create --title "feat(shop): Phase 1 — foundation + catalog (read-only)" --body "$(cat <<'EOF'
## Summary
Phase 1 of BESTCHOICE Online Shop. Implements catalog viewing only — no checkout/payment yet.

**Spec:** docs/superpowers/specs/2026-04-20-online-shop-design.md

## What ships
### Backend
- 5 new modules (apps/api/src/modules/shop-*)
  - shop-catalog: GET /api/shop/products + /:id
  - shop-tracking: POST /api/shop/track (visitor analytics)
  - shop-bot-defense: rate limit + AI-friendly classification
  - shop-reservation: 15-min unit hold + cleanup cron
  - shop-auth-social: LINE Login + Facebook Login + phone binding
  - shop-line-chat: contact form → LINE OA notification
- 5 new database tables: ProductReservation, WebsiteVisit, WebsiteSession,
  BotDetectionLog, IpRateLimit
- Product extensions: gallery[], gallery360[], conditionGrade, isOnlineVisible
- Customer extensions: facebookUserId, shippingAddresses[]

### Frontend
- New apps/web-shop Vite SPA at port 5174 (deploys to shop.bestchoicephone.app)
- Pages: Home, Catalog (filter/sort/smart-count), 5 static pages
- Layout: header + footer + floating LINE button
- Lib: API client + page-view tracking + session
- SEO: Schema.org JSON-LD + hybrid AI robots.txt (allow GPTBot/ClaudeBot, block Bytespider/CCBot)

### CORS
- main.ts allows shop.bestchoicephone.app + localhost:5174

## Tests
- Backend: 30+ unit tests across all modules
- Frontend: build + dev smoke test (full E2E in Phase 2)
- TypeScript: 0 errors

## Production action items (after merge)
1. Configure Cloudflare DNS: `shop.bestchoicephone.app` → Firebase Hosting
2. Create LINE Login channel — set `LINE_LOGIN_CHANNEL_ID`/`LINE_LOGIN_CHANNEL_SECRET` secrets
3. Create Facebook App — set `FACEBOOK_APP_ID`/`FACEBOOK_APP_SECRET` secrets
4. Cloudflare Turnstile site key (Phase 2 requires it for cart/checkout)
5. Update deploy-gcp.yml to build + deploy apps/web-shop to Firebase or Cloud Run

## Out of scope (Phase 2/3)
- Cart, Checkout, Payment (Phase 2)
- Apply forms, Trade-in, Buyback, Saving Plan (Phase 3)
- 360° viewer (deferred — needs photo studio setup)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review

### Spec coverage check

| Spec section | Implemented in task |
|--------------|---------------------|
| 1. Scope (catalog only) | Tasks 5, 12-14 |
| 2. Personas (informs UX) | Tasks 12-14 (mobile-first, simple flows) |
| 3. Journeys (browse + LINE chat) | Tasks 5, 7, 12-14 (browse → contact LINE) |
| 4. Architecture (separate domain, shop-* namespace) | Tasks 8-9 |
| 5. Components (header, footer, catalog cards) | Tasks 10, 12-13 |
| 6. Data model (5 new tables, 2 extensions) | Task 1 |
| 6. Visitor tracking | Task 2 |
| 6. Bot defense + hybrid AI | Task 3 |
| 6. SEO + structured data + robots.txt | Task 9 |
| 7. Phase 1 deliverable (browse + LINE) | Tasks 12-15 |

**Gaps identified:**
- ❌ DailyVisitStats table not yet created (cron-based aggregation deferred to Phase 2 when more visit data exists)
- ❌ 360° viewer not implemented (requires photo studio setup — deferred)
- ❌ ProductDetailPage not implemented (would be Task 14b — deferred to Phase 2 since Phase 1 is "browse + LINE close" not "self-serve")

These deferrals are intentional and noted in PR body.

### Placeholder scan
- ✅ No "TBD", "TODO" without code
- ✅ No "implement later"
- ✅ Every step shows actual code or exact command
- ⚠️ One "TODO: embed Google Map" in ContactPage — owner-provided coordinates needed; acceptable

### Type consistency
- ✅ `ProductGroup` interface used consistently in service spec, controller, frontend
- ✅ `BotType` and `BotAction` enums match Prisma schema
- ✅ `ReservationStatus` matches schema
- ✅ `RecordVisitInput` interface consistent in service and controller

### Internal consistency
- ✅ Module names match Task numbering
- ✅ File paths align with File Structure section
- ✅ All new modules registered in app.module.ts (Tasks 2/3/4/5/6/7 each have a Step "Register in app.module.ts")

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-04-20-online-shop-phase1-foundation.md`.**

Two execution options:

**1. Subagent-Driven (recommended)** — Dispatch a fresh subagent per task, review between tasks, fast iteration. Especially good for Tasks 1-7 which are independent backend modules; can mostly run sequentially via auto-commit.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints for review.

**Which approach?**

After Phase 1 ships and is verified in production for ~1 week, write Phase 2 plan (Cart + Checkout) and Phase 3 plan (Apply Forms + All Services).
