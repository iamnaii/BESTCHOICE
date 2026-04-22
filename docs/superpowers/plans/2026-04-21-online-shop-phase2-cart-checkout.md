# Online Shop — Phase 2 (Cart + Cash Checkout) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable end-to-end **cash** purchase on `shop.bestchoicephone.app`: customer adds a reserved iPhone to cart, walks through 3-step checkout (address → shipping → payment), pays via PaySolutions (PromptPay QR / credit-debit / bank-transfer-manual), receives auto LINE confirmation, earns loyalty points, admin sees order in fulfillment queue.

**Architecture:** Reuse Phase 1 `shop-reservation` as the cart primitive (1 reservation = 1 cart item — single-item cart is MVP; multi-item deferred). Add new NestJS modules `shop-shipping` (static rate table), `shop-cart` (list/add/remove reservations with product joins), `shop-checkout` (place-order orchestration + promo + loyalty validation + PaymentLink creation), `shop-orders` (customer order views + admin queue). Extend `paysolutions.service.ts` webhook branch to upgrade `OnlineOrder` status and spawn `Sale` via `SalesService.create()` on payment confirmation. New `OnlineOrder` + `OnlineOrderStatus` Prisma model; `Sale` gains `saleSource` + `onlineOrderId`. Frontend: new Zustand cart store, Auth context, React Query hooks, and 6 new pages (Cart, Checkout, OrderSuccess, Orders, OrderDetail, Account/AddressBook).

**Tech Stack:** React 19 + Vite 6 + Tailwind 4 + shadcn/Radix (apps/web-shop), NestJS 11 + Prisma 6 + PostgreSQL 16 (apps/api), PaySolutions v2 API (existing), LINE OA Messaging API via `LineOaService` (existing), `@tanstack/react-query` v5, `zustand` v4, `react-hook-form` + `zod` (existing deps).

**Spec:** `docs/superpowers/specs/2026-04-20-online-shop-design.md` §7 Phase 2
**Predecessors:** Phase 1 plan (`docs/superpowers/plans/2026-04-20-online-shop-phase1-foundation.md`) — deployed revision 00318-6mw
**Successors:** Phase 3 (Apply Forms + Trade-in + Buyback + ออมดาวน์)

**Scope guardrails:**
- ✅ Cash purchase only (installment = Phase 3)
- ✅ Single-item cart (one reservation per checkout); spec's `OnlineOrder` has single `productId` + `reservationId` → multi-item would require schema rework, deferred
- ✅ Shipping: static rate table + manual tracking # by admin (no Kerry/Flash/J&T API integration — YAGNI until volume justifies)
- ✅ Bank transfer = manual admin confirmation (upload slip), NOT auto-confirmed
- ✅ PromptPay QR + Credit/Debit = auto-confirmed via PaySolutions webhook
- ❌ No admin UI pages (admin uses existing `/admin` app with a new "Online Orders" route added in Phase 2) — full admin UX polish deferred
- ❌ No Sentry/analytics dashboards for online orders (reuse existing audit interceptor)

---

## File Structure

### New backend files (apps/api)

```
apps/api/src/modules/
├── shop-shipping/
│   ├── shop-shipping.module.ts          # exports service
│   ├── shop-shipping.controller.ts      # GET /api/shop/shipping/methods
│   ├── shop-shipping.service.ts         # static method + rate table, quote(province, method)
│   ├── shop-shipping.types.ts           # ShippingMethod enum + ShippingQuote interface
│   └── shop-shipping.service.spec.ts
├── shop-cart/
│   ├── shop-cart.module.ts
│   ├── shop-cart.controller.ts          # GET/DELETE /api/shop/cart, GET /api/shop/cart/item/:id
│   ├── shop-cart.service.ts             # list active reservations → join product + compute totals
│   └── shop-cart.service.spec.ts
├── shop-checkout/
│   ├── shop-checkout.module.ts
│   ├── shop-checkout.controller.ts      # POST /api/shop/checkout/validate-promo, /apply-loyalty, /place
│   ├── shop-checkout.service.ts         # orchestrate OnlineOrder + PaymentLink creation
│   ├── shop-checkout.service.spec.ts
│   ├── dto/
│   │   ├── validate-promo.dto.ts
│   │   ├── apply-loyalty.dto.ts
│   │   └── place-order.dto.ts
│   └── shop-checkout.types.ts           # PaymentChannel enum
├── shop-orders/
│   ├── shop-orders.module.ts
│   ├── shop-orders.controller.ts        # customer: GET /api/shop/orders, GET /:orderNumber; slip upload
│   ├── shop-orders.admin.controller.ts  # admin: GET /api/admin/online-orders, PATCH /:id/ship, /deliver, /cancel, /confirm-bank
│   ├── shop-orders.service.ts
│   └── shop-orders.service.spec.ts
└── paysolutions/
    └── paysolutions.service.ts           # MODIFY: extend handlePaymentCallback to detect OnlineOrder via PaymentLink.metadata.onlineOrderId
```

### New frontend files (apps/web-shop)

```
apps/web-shop/src/
├── hooks/
│   ├── useDebounce.ts                   # port from apps/web
│   ├── useAuth.ts                       # consume AuthContext
│   ├── useCart.ts                       # zustand wrapper
│   ├── useReservationCountdown.ts       # 15-min countdown
│   └── useShopApi.ts                    # react-query helpers
├── stores/
│   └── cartStore.ts                     # zustand: { reservationId, productId, addedAt }
├── contexts/
│   └── AuthContext.tsx                  # holds { customer, token } from /shop/auth
├── types/
│   ├── product.ts
│   ├── order.ts
│   └── shipping.ts
├── components/
│   ├── cart/
│   │   ├── CartItemRow.tsx
│   │   ├── CartEmpty.tsx
│   │   ├── CartSummary.tsx
│   │   └── ReservationCountdownBadge.tsx
│   ├── checkout/
│   │   ├── CheckoutStepper.tsx
│   │   ├── AddressStep.tsx              # step 1: pick saved / add new
│   │   ├── AddressForm.tsx              # inline form with zod
│   │   ├── ShippingStep.tsx             # step 2: select method + quote
│   │   ├── PaymentStep.tsx              # step 3: promo + loyalty + method + place
│   │   ├── PromoCodeInput.tsx
│   │   ├── LoyaltyPointsInput.tsx
│   │   ├── OrderSummaryCard.tsx
│   │   └── PaymentMethodPicker.tsx
│   ├── orders/
│   │   ├── OrderStatusBadge.tsx
│   │   ├── OrderTimeline.tsx
│   │   ├── OrderCard.tsx
│   │   └── SlipUploadDialog.tsx
│   ├── payment/
│   │   ├── PromptPayQrPanel.tsx         # polls /status/:paymentId
│   │   ├── BankTransferPanel.tsx
│   │   └── CardRedirectPanel.tsx
│   └── ui/                               # shadcn primitives (button, input, dialog, card, tabs)
│       ├── button.tsx
│       ├── input.tsx
│       ├── dialog.tsx
│       ├── tabs.tsx
│       └── card.tsx
└── pages/
    ├── CartPage.tsx
    ├── CheckoutPage.tsx                 # wraps 3-step wizard
    ├── OrderSuccessPage.tsx             # /checkout/success/:orderNumber
    ├── OrdersPage.tsx                   # /orders
    ├── OrderDetailPage.tsx              # /orders/:orderNumber
    ├── ProductDetailPage.tsx            # REPLACE stub with full version + reservation CTA
    └── account/
        ├── AccountPage.tsx              # /account
        └── AddressBookPage.tsx          # /account/addresses
```

### Modified files

- `apps/api/prisma/schema.prisma` — add `OnlineOrder` model + `OnlineOrderStatus` enum; extend `Sale` with `saleSource` + `onlineOrderId`; extend `Product` with `onlineOrders` relation
- `apps/api/src/app.module.ts` — register 4 new shop modules
- `apps/api/src/modules/paysolutions/paysolutions.service.ts` — extend `handlePaymentCallback` to upgrade `OnlineOrder` + create Sale on confirmation
- `apps/api/src/modules/paysolutions/paysolutions.service.ts` — extend `createPaymentIntent` to accept optional `onlineOrderId` metadata
- `apps/web-shop/package.json` — add `zustand`, `react-hook-form`, `zod`, `@hookform/resolvers`, `qrcode.react`
- `apps/web-shop/src/App.tsx` — register 7 new routes
- `apps/web-shop/src/main.tsx` — wrap App in AuthProvider
- `apps/web-shop/src/lib/api.ts` — add auth bootstrap that reads token from cookie-set refresh (no change needed — rely on existing 401 handler)
- `apps/web-shop/src/pages/ProductDetailPage.tsx` — full implementation with reservation + "Add to Cart" CTA

---

## Task 0: Pre-flight checks

**Files:** read-only verification

- [ ] **Step 1: Verify Phase 1 shop modules are deployed and module-registered**

Run: `grep -l "ShopReservationModule\|ShopCatalogModule" apps/api/src/app.module.ts`
Expected: returns `apps/api/src/app.module.ts`.

- [ ] **Step 2: Verify `ProductReservation` model + `consumedById` field exist**

Run: `grep -A2 "model ProductReservation" apps/api/prisma/schema.prisma | head -20`
Expected: fields `id`, `productId`, `customerId`, `sessionId`, `reservedAt`, `expiresAt`, `status`, `consumedById` all present.

- [ ] **Step 3: Verify `Customer.shippingAddresses Json[]` field exists**

Run: `grep "shippingAddresses" apps/api/prisma/schema.prisma`
Expected: `shippingAddresses Json[] @default([]) @map("shipping_addresses")` on line ~579.

- [ ] **Step 4: Verify `PaySolutionsService` + `LineOaService` + `PromotionsService` + `LoyaltyService` + `SalesService` exist**

Run:
```bash
for f in paysolutions/paysolutions.service line-oa/line-oa.service promotions/promotions.service loyalty/loyalty.service sales/sales.service; do
  test -f apps/api/src/modules/$f.ts && echo "$f: OK" || echo "$f: MISSING"
done
```
Expected: All 5 OK.

- [ ] **Step 5: Verify `apps/web-shop` workspace runs**

Run: `cd apps/web-shop && npm run build`
Expected: Build succeeds, outputs to `dist/`.

---

## Task 1: Prisma schema — `OnlineOrder` model + enum

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (add enum at enums section; add model after `Sale` model at line ~1696)

- [ ] **Step 1: Add `OnlineOrderStatus` enum**

Find the enum section (near top of file, after `SaleType`). Append:

```prisma
enum OnlineOrderStatus {
  DRAFT
  PENDING_PAYMENT
  PENDING_BANK_REVIEW
  PAID
  PACKING
  SHIPPED
  DELIVERED
  COMPLETED
  CANCELLED
  REFUNDED
}

enum OnlinePaymentChannel {
  PROMPTPAY_QR
  CREDIT_DEBIT_CARD
  BANK_TRANSFER
}

enum OnlineShippingMethod {
  BRANCH_PICKUP
  KERRY
  FLASH
  JT_EXPRESS
  THAILAND_POST
}
```

- [ ] **Step 2: Add `OnlineOrder` model after `model Sale { ... }` closing brace**

Insert after line ~1696:

```prisma
model OnlineOrder {
  id                 String                @id @default(uuid())
  orderNumber        String                @unique @map("order_number")
  customerId         String                @map("customer_id")
  customer           Customer              @relation(fields: [customerId], references: [id])
  productId          String                @map("product_id")
  product            Product               @relation(fields: [productId], references: [id])
  reservationId      String                @unique @map("reservation_id")
  reservation        ProductReservation    @relation(fields: [reservationId], references: [id])

  productPrice       Decimal               @map("product_price") @db.Decimal(12, 2)
  shippingFee        Decimal               @default(0) @map("shipping_fee") @db.Decimal(12, 2)
  promoCode          String?               @map("promo_code")
  promoDiscount      Decimal               @default(0) @map("promo_discount") @db.Decimal(12, 2)
  promotionUsageId   String?               @map("promotion_usage_id")
  loyaltyPointsUsed  Int                   @default(0) @map("loyalty_points_used")
  loyaltyDiscount    Decimal               @default(0) @map("loyalty_discount") @db.Decimal(12, 2)
  totalAmount        Decimal               @map("total_amount") @db.Decimal(12, 2)

  shippingMethod     OnlineShippingMethod  @map("shipping_method")
  shippingAddress    Json?                 @map("shipping_address")
  trackingNumber     String?               @map("tracking_number")
  shippedAt          DateTime?             @map("shipped_at")
  deliveredAt        DateTime?             @map("delivered_at")

  paymentChannel     OnlinePaymentChannel  @map("payment_channel")
  paymentLinkId      String?               @map("payment_link_id")
  paymentRef         String?               @map("payment_ref")
  paidAt             DateTime?             @map("paid_at")
  bankSlipUrl        String?               @map("bank_slip_url")
  bankConfirmedById  String?               @map("bank_confirmed_by_id")

  status             OnlineOrderStatus     @default(DRAFT)
  cancelReason       String?               @map("cancel_reason")
  cancelledAt        DateTime?             @map("cancelled_at")

  saleId             String?               @unique @map("sale_id")
  sale               Sale?                 @relation(fields: [saleId], references: [id])

  createdAt          DateTime              @default(now()) @map("created_at")
  updatedAt          DateTime              @updatedAt @map("updated_at")
  deletedAt          DateTime?             @map("deleted_at")

  @@index([customerId])
  @@index([status])
  @@index([createdAt])
  @@index([orderNumber])
  @@map("online_orders")
}
```

- [ ] **Step 3: Extend `Sale` model — add `saleSource`, `onlineOrderId`, back-relation**

Find `model Sale` (line ~1654). Within its block, before `createdAt`, add:

```prisma
  saleSource        String?        @default("OFFLINE") @map("sale_source")
  onlineOrderId     String?        @unique @map("online_order_id")
```

Within the relations section (after `promotionUsages`):

```prisma
  onlineOrder             OnlineOrder?
```

- [ ] **Step 4: Extend `Customer` and `Product` models with back-relations**

Find `model Customer`, add to relations section:

```prisma
  onlineOrders OnlineOrder[]
```

Find `model Product`, add to relations section (near existing `reservations` relation):

```prisma
  onlineOrders OnlineOrder[]
```

- [ ] **Step 5: Extend `ProductReservation` — add back-relation**

Find `model ProductReservation`, add to relations section:

```prisma
  onlineOrder OnlineOrder?
```

- [ ] **Step 6: Generate migration**

Run: `cd apps/api && npx prisma migrate dev --name add_online_order_model --create-only`
Expected: migration file created under `apps/api/prisma/migrations/YYYYMMDDHHMMSS_add_online_order_model/migration.sql`.

- [ ] **Step 7: Review migration SQL for forbidden patterns**

Open the generated `migration.sql` and verify:
- No `DROP COLUMN` or `DROP TABLE`
- No `ALTER TABLE ... NOT NULL` without a `DEFAULT`
- All new columns on existing tables (`sales`) are either nullable or have defaults

- [ ] **Step 8: Apply the migration locally**

Run: `cd apps/api && npx prisma migrate dev`
Expected: "Applying migration ..." → "Your database is now in sync with your schema."

- [ ] **Step 9: Regenerate Prisma client**

Run: `cd apps/api && npx prisma generate`
Expected: "Generated Prisma Client" message.

- [ ] **Step 10: TypeScript check**

Run: `./tools/check-types.sh api`
Expected: exit 0, 0 errors.

- [ ] **Step 11: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/
git commit -m "feat(shop-phase2): add OnlineOrder model + enums + Sale.saleSource/onlineOrderId"
```

---

## Task 2: `shop-shipping` module — rates + types

**Files:**
- Create: `apps/api/src/modules/shop-shipping/shop-shipping.types.ts`
- Create: `apps/api/src/modules/shop-shipping/shop-shipping.service.ts`
- Create: `apps/api/src/modules/shop-shipping/shop-shipping.service.spec.ts`
- Create: `apps/api/src/modules/shop-shipping/shop-shipping.controller.ts`
- Create: `apps/api/src/modules/shop-shipping/shop-shipping.module.ts`

- [ ] **Step 1: Generate scaffold**

Run: `./tools/generate-module.sh shop-shipping`
Expected: module directory created with empty controller/service/module.

- [ ] **Step 2: Write types**

Create `shop-shipping.types.ts`:

```typescript
export enum ShippingMethod {
  BRANCH_PICKUP = 'BRANCH_PICKUP',
  KERRY = 'KERRY',
  FLASH = 'FLASH',
  JT_EXPRESS = 'JT_EXPRESS',
  THAILAND_POST = 'THAILAND_POST',
}

export interface ShippingQuote {
  method: ShippingMethod;
  label: string;
  fee: number;
  etaDays: string;
  available: boolean;
  note?: string;
}
```

- [ ] **Step 3: Write failing service test**

Create `shop-shipping.service.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { ShopShippingService } from './shop-shipping.service';
import { ShippingMethod } from './shop-shipping.types';

describe('ShopShippingService', () => {
  let service: ShopShippingService;

  beforeEach(async () => {
    const mod = await Test.createTestingModule({ providers: [ShopShippingService] }).compile();
    service = mod.get(ShopShippingService);
  });

  it('lists all shipping methods with branch pickup free', () => {
    const methods = service.listMethods();
    expect(methods).toHaveLength(5);
    const pickup = methods.find((m) => m.method === ShippingMethod.BRANCH_PICKUP);
    expect(pickup?.fee).toBe(0);
  });

  it('quotes Kerry 60 THB for any province', () => {
    const quote = service.quote(ShippingMethod.KERRY, 'อยุธยา');
    expect(quote.fee).toBe(60);
    expect(quote.available).toBe(true);
  });

  it('throws on unknown method', () => {
    expect(() => service.quote('INVALID' as ShippingMethod, 'ลพบุรี')).toThrow();
  });
});
```

- [ ] **Step 4: Run test to confirm it fails**

Run: `cd apps/api && npx jest shop-shipping.service.spec -t "lists all"`
Expected: FAIL ("service.listMethods is not a function" or "Cannot find module").

- [ ] **Step 5: Implement `ShopShippingService`**

Create `shop-shipping.service.ts`:

```typescript
import { BadRequestException, Injectable } from '@nestjs/common';
import { ShippingMethod, ShippingQuote } from './shop-shipping.types';

const RATES: Record<ShippingMethod, { label: string; fee: number; etaDays: string }> = {
  [ShippingMethod.BRANCH_PICKUP]: { label: 'รับเองที่สาขาลพบุรี', fee: 0, etaDays: 'วันเดียวกัน' },
  [ShippingMethod.KERRY]: { label: 'Kerry Express', fee: 60, etaDays: '1-2 วัน' },
  [ShippingMethod.FLASH]: { label: 'Flash Express', fee: 50, etaDays: '1-2 วัน' },
  [ShippingMethod.JT_EXPRESS]: { label: 'J&T Express', fee: 55, etaDays: '2-3 วัน' },
  [ShippingMethod.THAILAND_POST]: { label: 'ไปรษณีย์ไทย EMS', fee: 40, etaDays: '2-3 วัน' },
};

@Injectable()
export class ShopShippingService {
  listMethods(): ShippingQuote[] {
    return (Object.keys(RATES) as ShippingMethod[]).map((m) => ({
      method: m,
      label: RATES[m].label,
      fee: RATES[m].fee,
      etaDays: RATES[m].etaDays,
      available: true,
    }));
  }

  quote(method: ShippingMethod, _province: string): ShippingQuote {
    const rate = RATES[method];
    if (!rate) throw new BadRequestException('วิธีจัดส่งไม่ถูกต้อง');
    return { method, label: rate.label, fee: rate.fee, etaDays: rate.etaDays, available: true };
  }
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd apps/api && npx jest shop-shipping.service.spec`
Expected: PASS, 3 tests.

- [ ] **Step 7: Write controller**

Create `shop-shipping.controller.ts`:

```typescript
import { Controller, Get, UseGuards } from '@nestjs/common';
import { ShopShippingService } from './shop-shipping.service';
import { ShopBotDefenseGuard } from '../shop-bot-defense/shop-bot-defense.guard';

@Controller('shop/shipping')
@UseGuards(ShopBotDefenseGuard)
export class ShopShippingController {
  constructor(private service: ShopShippingService) {}

  @Get('methods')
  listMethods() {
    return this.service.listMethods();
  }
}
```

- [ ] **Step 8: Write module**

Create `shop-shipping.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { ShopShippingController } from './shop-shipping.controller';
import { ShopShippingService } from './shop-shipping.service';
import { ShopBotDefenseModule } from '../shop-bot-defense/shop-bot-defense.module';

@Module({
  imports: [ShopBotDefenseModule],
  controllers: [ShopShippingController],
  providers: [ShopShippingService],
  exports: [ShopShippingService],
})
export class ShopShippingModule {}
```

- [ ] **Step 9: Register in `app.module.ts`**

Open `apps/api/src/app.module.ts`. Add `import { ShopShippingModule } from './modules/shop-shipping/shop-shipping.module';` and add `ShopShippingModule` to the `imports` array next to the other `Shop*Module` entries.

- [ ] **Step 10: Type check + commit**

```bash
./tools/check-types.sh api
git add apps/api/src/modules/shop-shipping apps/api/src/app.module.ts
git commit -m "feat(shop-phase2): add shop-shipping module with static rate table"
```

---

## Task 3: `shop-cart` module — list active reservations as cart items

**Files:**
- Create: `apps/api/src/modules/shop-cart/shop-cart.service.ts`
- Create: `apps/api/src/modules/shop-cart/shop-cart.service.spec.ts`
- Create: `apps/api/src/modules/shop-cart/shop-cart.controller.ts`
- Create: `apps/api/src/modules/shop-cart/shop-cart.module.ts`

- [ ] **Step 1: Write failing service test**

Create `shop-cart.service.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { ShopCartService } from './shop-cart.service';
import { PrismaService } from '../../prisma/prisma.service';

const prismaMock = {
  productReservation: { findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
};

describe('ShopCartService', () => {
  let service: ShopCartService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const mod = await Test.createTestingModule({
      providers: [ShopCartService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();
    service = mod.get(ShopCartService);
  });

  it('returns active reservations for session with product joined', async () => {
    prismaMock.productReservation.findMany.mockResolvedValue([
      {
        id: 'r1',
        productId: 'p1',
        sessionId: 's1',
        expiresAt: new Date(Date.now() + 10 * 60000),
        status: 'ACTIVE',
        product: { id: 'p1', name: 'iPhone 13', sellingPrice: 12500, gallery: ['u1'] },
      },
    ]);
    const items = await service.listForSession('s1');
    expect(items).toHaveLength(1);
    expect(items[0].product.name).toBe('iPhone 13');
    expect(items[0].secondsRemaining).toBeGreaterThan(0);
  });

  it('filters out expired reservations even if still ACTIVE in DB', async () => {
    prismaMock.productReservation.findMany.mockResolvedValue([
      {
        id: 'r2',
        productId: 'p2',
        sessionId: 's1',
        expiresAt: new Date(Date.now() - 1000),
        status: 'ACTIVE',
        product: { id: 'p2', name: 'iPhone 14', sellingPrice: 18000, gallery: [] },
      },
    ]);
    const items = await service.listForSession('s1');
    expect(items).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `cd apps/api && npx jest shop-cart.service.spec`
Expected: FAIL (`Cannot find module './shop-cart.service'`).

- [ ] **Step 3: Implement `ShopCartService`**

Create `shop-cart.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface CartItem {
  reservationId: string;
  productId: string;
  expiresAt: Date;
  secondsRemaining: number;
  product: {
    id: string;
    name: string;
    sellingPrice: number;
    gallery: string[];
    conditionGrade: string | null;
  };
}

@Injectable()
export class ShopCartService {
  constructor(private prisma: PrismaService) {}

  async listForSession(sessionId: string): Promise<CartItem[]> {
    const reservations = await this.prisma.productReservation.findMany({
      where: { sessionId, status: 'ACTIVE' },
      include: { product: true },
      orderBy: { reservedAt: 'desc' },
    });
    const now = Date.now();
    return reservations
      .filter((r) => r.expiresAt.getTime() > now)
      .map((r) => ({
        reservationId: r.id,
        productId: r.productId,
        expiresAt: r.expiresAt,
        secondsRemaining: Math.max(0, Math.floor((r.expiresAt.getTime() - now) / 1000)),
        product: {
          id: r.product.id,
          name: r.product.name,
          sellingPrice: Number(r.product.sellingPrice),
          gallery: r.product.gallery,
          conditionGrade: r.product.conditionGrade,
        },
      }));
  }

  async countForSession(sessionId: string): Promise<number> {
    const items = await this.listForSession(sessionId);
    return items.length;
  }
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `cd apps/api && npx jest shop-cart.service.spec`
Expected: PASS, 2 tests.

- [ ] **Step 5: Write controller**

Create `shop-cart.controller.ts`:

```typescript
import { Controller, Get, Headers, UseGuards, BadRequestException } from '@nestjs/common';
import { ShopCartService } from './shop-cart.service';
import { ShopBotDefenseGuard } from '../shop-bot-defense/shop-bot-defense.guard';

@Controller('shop/cart')
@UseGuards(ShopBotDefenseGuard)
export class ShopCartController {
  constructor(private service: ShopCartService) {}

  @Get()
  async get(@Headers('x-shop-session') sessionId: string) {
    if (!sessionId) throw new BadRequestException('missing session');
    const items = await this.service.listForSession(sessionId);
    const subtotal = items.reduce((a, i) => a + i.product.sellingPrice, 0);
    return { items, subtotal };
  }
}
```

- [ ] **Step 6: Write module**

Create `shop-cart.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { ShopCartService } from './shop-cart.service';
import { ShopCartController } from './shop-cart.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { ShopBotDefenseModule } from '../shop-bot-defense/shop-bot-defense.module';

@Module({
  imports: [PrismaModule, ShopBotDefenseModule],
  controllers: [ShopCartController],
  providers: [ShopCartService],
  exports: [ShopCartService],
})
export class ShopCartModule {}
```

- [ ] **Step 7: Register in `app.module.ts`**

Add `ShopCartModule` import + add to `imports` array.

- [ ] **Step 8: Type check + commit**

```bash
./tools/check-types.sh api
git add apps/api/src/modules/shop-cart apps/api/src/app.module.ts
git commit -m "feat(shop-phase2): add shop-cart module (session-based reservation list)"
```

---

## Task 4: `shop-checkout` module — DTOs + promo validation

**Files:**
- Create: `apps/api/src/modules/shop-checkout/dto/validate-promo.dto.ts`
- Create: `apps/api/src/modules/shop-checkout/dto/apply-loyalty.dto.ts`
- Create: `apps/api/src/modules/shop-checkout/dto/place-order.dto.ts`
- Create: `apps/api/src/modules/shop-checkout/shop-checkout.service.ts`
- Create: `apps/api/src/modules/shop-checkout/shop-checkout.service.spec.ts`

- [ ] **Step 1: Create DTO files**

`validate-promo.dto.ts`:

```typescript
import { IsString, IsNotEmpty, IsUUID } from 'class-validator';

export class ValidatePromoDto {
  @IsString() @IsNotEmpty() code!: string;
  @IsUUID() reservationId!: string;
}
```

`apply-loyalty.dto.ts`:

```typescript
import { IsInt, Min, IsUUID } from 'class-validator';

export class ApplyLoyaltyDto {
  @IsUUID() reservationId!: string;
  @IsInt() @Min(1) points!: number;
}
```

`place-order.dto.ts`:

```typescript
import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Min, IsObject, ValidateNested, IsNotEmpty } from 'class-validator';
import { Type } from 'class-transformer';
import { ShippingMethod } from '../../shop-shipping/shop-shipping.types';

export enum PaymentChannel {
  PROMPTPAY_QR = 'PROMPTPAY_QR',
  CREDIT_DEBIT_CARD = 'CREDIT_DEBIT_CARD',
  BANK_TRANSFER = 'BANK_TRANSFER',
}

export class ShippingAddressDto {
  @IsString() @IsNotEmpty() recipientName!: string;
  @IsString() @IsNotEmpty() phone!: string;
  @IsString() @IsNotEmpty() line1!: string;
  @IsOptional() @IsString() line2?: string;
  @IsString() @IsNotEmpty() subDistrict!: string;
  @IsString() @IsNotEmpty() district!: string;
  @IsString() @IsNotEmpty() province!: string;
  @IsString() @IsNotEmpty() postalCode!: string;
}

export class PlaceOrderDto {
  @IsUUID() reservationId!: string;
  @IsEnum(ShippingMethod) shippingMethod!: ShippingMethod;
  @IsObject() @ValidateNested() @Type(() => ShippingAddressDto) shippingAddress!: ShippingAddressDto;
  @IsEnum(PaymentChannel) paymentChannel!: PaymentChannel;
  @IsOptional() @IsString() promoCode?: string;
  @IsOptional() @IsInt() @Min(0) loyaltyPointsRedeemed?: number;
}
```

- [ ] **Step 2: Write failing service test (promo validation)**

Create `shop-checkout.service.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { ShopCheckoutService } from './shop-checkout.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PromotionsService } from '../promotions/promotions.service';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { ShopShippingService } from '../shop-shipping/shop-shipping.service';
import { PaySolutionsService } from '../paysolutions/paysolutions.service';
import { SalesService } from '../sales/sales.service';

const prismaMock = {
  productReservation: { findUnique: jest.fn() },
  onlineOrder: { create: jest.fn(), findUnique: jest.fn() },
};
const promotionsMock = { findActivePromotions: jest.fn() };
const loyaltyMock = { getCustomerPoints: jest.fn() };
const shippingMock = { quote: jest.fn() };

describe('ShopCheckoutService', () => {
  let service: ShopCheckoutService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const mod = await Test.createTestingModule({
      providers: [
        ShopCheckoutService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: PromotionsService, useValue: promotionsMock },
        { provide: LoyaltyService, useValue: loyaltyMock },
        { provide: ShopShippingService, useValue: shippingMock },
        { provide: PaySolutionsService, useValue: {} },
        { provide: SalesService, useValue: {} },
      ],
    }).compile();
    service = mod.get(ShopCheckoutService);
  });

  it('validates a percentage promo and returns discount', async () => {
    prismaMock.productReservation.findUnique.mockResolvedValue({
      id: 'r1', status: 'ACTIVE', expiresAt: new Date(Date.now() + 60000),
      product: { sellingPrice: 10000 },
    });
    promotionsMock.findActivePromotions.mockResolvedValue([
      { id: 'promo1', code: 'SAVE10', type: 'PERCENTAGE_DISCOUNT', value: 10, maxUsageCount: 100, currentUsageCount: 5 },
    ]);
    const result = await service.validatePromoCode({ code: 'SAVE10', reservationId: 'r1' });
    expect(result.valid).toBe(true);
    expect(result.discountAmount).toBe(1000);
    expect(result.promotionId).toBe('promo1');
  });

  it('rejects expired reservation', async () => {
    prismaMock.productReservation.findUnique.mockResolvedValue({
      id: 'r1', status: 'EXPIRED', expiresAt: new Date(Date.now() - 60000),
      product: { sellingPrice: 10000 },
    });
    await expect(
      service.validatePromoCode({ code: 'SAVE10', reservationId: 'r1' })
    ).rejects.toThrow(/reservation/i);
  });

  it('rejects unknown promo code', async () => {
    prismaMock.productReservation.findUnique.mockResolvedValue({
      id: 'r1', status: 'ACTIVE', expiresAt: new Date(Date.now() + 60000),
      product: { sellingPrice: 10000 },
    });
    promotionsMock.findActivePromotions.mockResolvedValue([]);
    const result = await service.validatePromoCode({ code: 'INVALID', reservationId: 'r1' });
    expect(result.valid).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify failure**

Run: `cd apps/api && npx jest shop-checkout.service.spec`
Expected: FAIL.

- [ ] **Step 4: Implement `validatePromoCode` in service**

Create `shop-checkout.service.ts`:

```typescript
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PromotionsService } from '../promotions/promotions.service';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { ShopShippingService } from '../shop-shipping/shop-shipping.service';
import { PaySolutionsService } from '../paysolutions/paysolutions.service';
import { SalesService } from '../sales/sales.service';
import { ValidatePromoDto } from './dto/validate-promo.dto';

export interface ValidatePromoResult {
  valid: boolean;
  reason?: string;
  discountAmount: number;
  promotionId?: string;
}

@Injectable()
export class ShopCheckoutService {
  constructor(
    private prisma: PrismaService,
    private promotions: PromotionsService,
    private loyalty: LoyaltyService,
    private shipping: ShopShippingService,
    private paysolutions: PaySolutionsService,
    private sales: SalesService,
  ) {}

  private async loadActiveReservation(reservationId: string) {
    const r = await this.prisma.productReservation.findUnique({
      where: { id: reservationId },
      include: { product: true },
    });
    if (!r) throw new NotFoundException('ไม่พบรายการที่จองไว้');
    if (r.status !== 'ACTIVE' || r.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('reservation หมดอายุแล้ว — กรุณาเลือกสินค้าใหม่');
    }
    return r;
  }

  async validatePromoCode(dto: ValidatePromoDto): Promise<ValidatePromoResult> {
    const reservation = await this.loadActiveReservation(dto.reservationId);
    const promos = await this.promotions.findActivePromotions();
    const promo = promos.find((p: any) => p.code?.toUpperCase() === dto.code.toUpperCase());
    if (!promo) return { valid: false, reason: 'โค้ดส่วนลดไม่ถูกต้องหรือหมดอายุ', discountAmount: 0 };
    if (promo.maxUsageCount && promo.currentUsageCount >= promo.maxUsageCount) {
      return { valid: false, reason: 'โค้ดนี้ถูกใช้เต็มจำนวนแล้ว', discountAmount: 0 };
    }
    const price = Number(reservation.product.sellingPrice);
    let discount = 0;
    if (promo.type === 'PERCENTAGE_DISCOUNT') discount = Math.floor((price * Number(promo.value)) / 100);
    else if (promo.type === 'FIXED_DISCOUNT' || promo.type === 'FIXED_AMOUNT') discount = Math.min(price, Number(promo.value));
    else return { valid: false, reason: 'โค้ดนี้ใช้ในร้านออนไลน์ไม่ได้', discountAmount: 0 };
    return { valid: true, discountAmount: discount, promotionId: promo.id };
  }
}
```

- [ ] **Step 5: Run tests to verify pass**

Run: `cd apps/api && npx jest shop-checkout.service.spec`
Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/shop-checkout
git commit -m "feat(shop-phase2): add shop-checkout service with promo validation"
```

---

## Task 5: `shop-checkout` — loyalty validation

**Files:**
- Modify: `apps/api/src/modules/shop-checkout/shop-checkout.service.ts`
- Modify: `apps/api/src/modules/shop-checkout/shop-checkout.service.spec.ts`

- [ ] **Step 1: Add failing test**

Append to spec file:

```typescript
describe('validateLoyaltyRedemption', () => {
  it('allows redemption within balance + daily cap', async () => {
    prismaMock.productReservation.findUnique.mockResolvedValue({
      id: 'r1', status: 'ACTIVE', expiresAt: new Date(Date.now() + 60000),
      product: { sellingPrice: 10000 },
    });
    loyaltyMock.getCustomerPoints.mockResolvedValue({ balance: 2000 });
    const result = await service.validateLoyaltyRedemption({ reservationId: 'r1', points: 500 }, 'cust-1');
    expect(result.valid).toBe(true);
    expect(result.discountAmount).toBe(500);
  });

  it('rejects redemption exceeding balance', async () => {
    prismaMock.productReservation.findUnique.mockResolvedValue({
      id: 'r1', status: 'ACTIVE', expiresAt: new Date(Date.now() + 60000),
      product: { sellingPrice: 10000 },
    });
    loyaltyMock.getCustomerPoints.mockResolvedValue({ balance: 100 });
    const result = await service.validateLoyaltyRedemption({ reservationId: 'r1', points: 500 }, 'cust-1');
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/ไม่เพียงพอ/);
  });

  it('rejects redemption exceeding daily cap (5000)', async () => {
    prismaMock.productReservation.findUnique.mockResolvedValue({
      id: 'r1', status: 'ACTIVE', expiresAt: new Date(Date.now() + 60000),
      product: { sellingPrice: 10000 },
    });
    loyaltyMock.getCustomerPoints.mockResolvedValue({ balance: 10000 });
    const result = await service.validateLoyaltyRedemption({ reservationId: 'r1', points: 5001 }, 'cust-1');
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/5,?000/);
  });
});
```

- [ ] **Step 2: Implement `validateLoyaltyRedemption`**

Append to `shop-checkout.service.ts`:

```typescript
  async validateLoyaltyRedemption(
    dto: { reservationId: string; points: number },
    customerId: string,
  ): Promise<{ valid: boolean; reason?: string; discountAmount: number }> {
    await this.loadActiveReservation(dto.reservationId);
    const { balance } = await this.loyalty.getCustomerPoints(customerId);
    if (dto.points > balance) {
      return { valid: false, reason: 'แต้มสะสมของคุณไม่เพียงพอ', discountAmount: 0 };
    }
    if (dto.points > 5000) {
      return { valid: false, reason: 'แลกแต้มได้สูงสุด 5,000 แต้ม/วัน', discountAmount: 0 };
    }
    return { valid: true, discountAmount: dto.points };
  }
```

And add to `ValidatePromoResult`-adjacent imports (`ApplyLoyaltyDto` import not needed — dto is inline-typed).

- [ ] **Step 3: Run tests**

Run: `cd apps/api && npx jest shop-checkout.service.spec`
Expected: PASS, 6 tests.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/shop-checkout
git commit -m "feat(shop-phase2): add loyalty redemption validation in checkout"
```

---

## Task 6: `shop-checkout` — place order (core orchestration)

**Files:**
- Modify: `apps/api/src/modules/shop-checkout/shop-checkout.service.ts`
- Modify: `apps/api/src/modules/shop-checkout/shop-checkout.service.spec.ts`
- Create: `apps/api/src/modules/shop-checkout/order-number.util.ts`

- [ ] **Step 1: Write order-number util**

Create `order-number.util.ts`:

```typescript
export function generateOrderNumber(now = new Date()): string {
  const y = now.getFullYear().toString().slice(-2);
  const m = (now.getMonth() + 1).toString().padStart(2, '0');
  const d = now.getDate().toString().padStart(2, '0');
  const suffix = Math.floor(100000 + Math.random() * 900000);
  return `BC-${y}${m}${d}-${suffix}`;
}
```

- [ ] **Step 2: Write failing placeOrder tests**

Append to spec:

```typescript
describe('placeOrder', () => {
  const dto = {
    reservationId: 'r1',
    shippingMethod: 'KERRY' as any,
    shippingAddress: {
      recipientName: 'บีม', phone: '0812345678',
      line1: '123 ม.1', subDistrict: 'ในเมือง', district: 'เมือง',
      province: 'ลพบุรี', postalCode: '15000',
    },
    paymentChannel: 'PROMPTPAY_QR' as any,
  };

  it('creates OnlineOrder in PENDING_PAYMENT with PaySolutions intent for QR', async () => {
    prismaMock.productReservation.findUnique.mockResolvedValue({
      id: 'r1', status: 'ACTIVE', expiresAt: new Date(Date.now() + 60000),
      productId: 'p1', customerId: 'cust-1',
      product: { id: 'p1', sellingPrice: 12500, name: 'iPhone 13' },
    });
    shippingMock.quote.mockReturnValue({ method: 'KERRY', fee: 60, label: 'Kerry', etaDays: '1-2' });
    prismaMock.onlineOrder.create.mockResolvedValue({ id: 'order-1', orderNumber: 'BC-260421-111111' });
    const psMock = service['paysolutions'] as any;
    psMock.createOnlineOrderIntent = jest.fn().mockResolvedValue({ paymentLinkId: 'pl1', paymentUrl: 'https://pay/...' });

    const result = await service.placeOrder(dto, 'cust-1');
    expect(result.orderNumber).toMatch(/^BC-/);
    expect(result.paymentUrl).toBe('https://pay/...');
    expect(prismaMock.onlineOrder.create).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Implement placeOrder (service layer, DB transaction)**

Append to `shop-checkout.service.ts`:

```typescript
import { generateOrderNumber } from './order-number.util';
import { PlaceOrderDto, PaymentChannel } from './dto/place-order.dto';
import { OnlineShippingMethod, OnlinePaymentChannel } from '@prisma/client';

  async placeOrder(dto: PlaceOrderDto, customerId: string) {
    const reservation = await this.loadActiveReservation(dto.reservationId);
    if (reservation.customerId && reservation.customerId !== customerId) {
      throw new BadRequestException('reservation นี้ไม่ใช่ของคุณ');
    }

    const shippingQuote = this.shipping.quote(dto.shippingMethod, dto.shippingAddress.province);
    const price = Number(reservation.product.sellingPrice);

    let promoDiscount = 0;
    let promotionId: string | undefined;
    if (dto.promoCode) {
      const p = await this.validatePromoCode({ code: dto.promoCode, reservationId: dto.reservationId });
      if (!p.valid) throw new BadRequestException(p.reason ?? 'โค้ดส่วนลดใช้ไม่ได้');
      promoDiscount = p.discountAmount;
      promotionId = p.promotionId;
    }

    let loyaltyDiscount = 0;
    if (dto.loyaltyPointsRedeemed && dto.loyaltyPointsRedeemed > 0) {
      const l = await this.validateLoyaltyRedemption(
        { reservationId: dto.reservationId, points: dto.loyaltyPointsRedeemed },
        customerId,
      );
      if (!l.valid) throw new BadRequestException(l.reason ?? 'ใช้แต้มไม่ได้');
      loyaltyDiscount = l.discountAmount;
    }

    const totalAmount = Math.max(0, price + shippingQuote.fee - promoDiscount - loyaltyDiscount);
    const orderNumber = generateOrderNumber();

    const order = await this.prisma.onlineOrder.create({
      data: {
        orderNumber,
        customerId,
        productId: reservation.productId,
        reservationId: reservation.id,
        productPrice: price,
        shippingFee: shippingQuote.fee,
        promoCode: dto.promoCode,
        promoDiscount,
        loyaltyPointsUsed: dto.loyaltyPointsRedeemed ?? 0,
        loyaltyDiscount,
        totalAmount,
        shippingMethod: dto.shippingMethod as unknown as OnlineShippingMethod,
        shippingAddress: dto.shippingAddress as any,
        paymentChannel: dto.paymentChannel as unknown as OnlinePaymentChannel,
        status: 'PENDING_PAYMENT',
      },
    });

    if (dto.paymentChannel === PaymentChannel.BANK_TRANSFER) {
      return {
        orderNumber: order.orderNumber,
        orderId: order.id,
        totalAmount,
        paymentChannel: dto.paymentChannel,
      };
    }

    const intent = await (this.paysolutions as any).createOnlineOrderIntent({
      onlineOrderId: order.id,
      amount: totalAmount,
      description: `ชำระเงินคำสั่งซื้อ ${orderNumber}`,
      channel: dto.paymentChannel,
    });

    await this.prisma.onlineOrder.update({
      where: { id: order.id },
      data: { paymentLinkId: intent.paymentLinkId },
    });

    return {
      orderNumber: order.orderNumber,
      orderId: order.id,
      totalAmount,
      paymentChannel: dto.paymentChannel,
      paymentUrl: intent.paymentUrl,
      paymentLinkId: intent.paymentLinkId,
    };
  }
```

- [ ] **Step 4: Run tests**

Run: `cd apps/api && npx jest shop-checkout.service.spec`
Expected: PASS including new placeOrder test.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/shop-checkout
git commit -m "feat(shop-phase2): implement placeOrder orchestration (promo+loyalty+shipping+PaySolutions intent)"
```

---

## Task 7: Extend `PaySolutionsService` — online-order-aware payment intent

**Files:**
- Modify: `apps/api/src/modules/paysolutions/paysolutions.service.ts`
- Modify: `apps/api/src/modules/paysolutions/paysolutions.service.spec.ts` (if present, else add)

- [ ] **Step 1: Add `createOnlineOrderIntent` method**

Open `paysolutions.service.ts`. Near the existing `createPaymentIntent`, add:

```typescript
  async createOnlineOrderIntent(input: {
    onlineOrderId: string;
    amount: number;
    description: string;
    channel: 'PROMPTPAY_QR' | 'CREDIT_DEBIT_CARD';
  }): Promise<{ paymentLinkId: string; paymentUrl: string; qrCodeUrl?: string }> {
    const config = await this.integrationConfig.getActive('paysolutions');
    if (!config) throw new Error('PaySolutions not configured');

    const paymentLink = await this.prisma.paymentLink.create({
      data: {
        amount: input.amount,
        status: 'ACTIVE',
        description: input.description,
        metadata: { onlineOrderId: input.onlineOrderId, channel: input.channel } as any,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      },
    });

    const res = await this.callPaySolutionsApi({
      merchantId: config.merchantId,
      apiKey: config.apiKey,
      apiUrl: config.apiUrl,
      amount: input.amount,
      description: input.description,
      channel: input.channel === 'PROMPTPAY_QR' ? 'promptpay' : 'card',
      refno: paymentLink.id,
    });

    await this.prisma.paymentLink.update({
      where: { id: paymentLink.id },
      data: { gatewayRef: res.gatewayRef, paymentUrl: res.paymentUrl },
    });

    return { paymentLinkId: paymentLink.id, paymentUrl: res.paymentUrl, qrCodeUrl: res.qrCodeUrl };
  }
```

> Note: `callPaySolutionsApi` is the existing private helper. If the signature differs, match the actual codebase — this is a private helper in the service, find and use it. If named differently, follow the existing `createPaymentIntent` pattern.

- [ ] **Step 2: Extend `handlePaymentCallback` to route by metadata**

Find the existing `handlePaymentCallback(webhookData)`. After loading `PaymentLink` from refno, add branch:

```typescript
    const onlineOrderId = (paymentLink.metadata as any)?.onlineOrderId as string | undefined;
    if (onlineOrderId) {
      await this.confirmOnlineOrderPayment(onlineOrderId, webhookData);
      return { ok: true, handled: 'online_order' };
    }
    // fall through to existing contract-payment flow
```

And add helper method (new, invoking SalesService via injection):

```typescript
  async confirmOnlineOrderPayment(onlineOrderId: string, webhookData: any): Promise<void> {
    const order = await this.prisma.onlineOrder.findUnique({
      where: { id: onlineOrderId },
      include: { reservation: true, product: true, customer: true },
    });
    if (!order) return;
    if (order.status === 'PAID') return; // idempotent

    await this.prisma.$transaction(async (tx) => {
      await tx.onlineOrder.update({
        where: { id: onlineOrderId },
        data: { status: 'PAID', paidAt: new Date(), paymentRef: webhookData.transaction_id ?? webhookData.refno },
      });
      await tx.productReservation.update({
        where: { id: order.reservationId },
        data: { status: 'CONSUMED', consumedById: order.id },
      });
    });

    // Create Sale (cash) via SalesService — cannot run in same tx because SalesService uses its own
    await this.salesForOnlineOrder.createForOnlineOrder(order.id);

    // Send LINE notification
    if (order.customer.lineId) {
      await this.lineOa.sendFlexMessage(order.customer.lineId, this.buildOrderPaidFlex(order));
    }
  }
```

- [ ] **Step 3: Wire `SalesService` + extract Sale-creation adapter**

To avoid circular imports, create a thin adapter. In `shop-orders` module (Task 9), we'll add `OnlineOrderSaleAdapter` with `createForOnlineOrder(orderId)`. For now, stub the call as:

```typescript
    // TODO: wired in Task 9 via constructor injection
```

…and inject `@Optional() private readonly salesForOnlineOrder: { createForOnlineOrder(id: string): Promise<void> }`.

- [ ] **Step 4: Type check**

Run: `./tools/check-types.sh api`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/paysolutions
git commit -m "feat(shop-phase2): PaySolutions supports online-order payment intents + webhook branching"
```

---

## Task 8: `shop-checkout` controller + module registration

**Files:**
- Create: `apps/api/src/modules/shop-checkout/shop-checkout.controller.ts`
- Create: `apps/api/src/modules/shop-checkout/shop-checkout.module.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: Write controller**

Create `shop-checkout.controller.ts`:

```typescript
import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { ShopCheckoutService } from './shop-checkout.service';
import { ValidatePromoDto } from './dto/validate-promo.dto';
import { ApplyLoyaltyDto } from './dto/apply-loyalty.dto';
import { PlaceOrderDto } from './dto/place-order.dto';
import { ShopBotDefenseGuard } from '../shop-bot-defense/shop-bot-defense.guard';
import { ShopAuthGuard } from '../shop-auth-social/shop-auth.guard';

@Controller('shop/checkout')
@UseGuards(ShopBotDefenseGuard, ShopAuthGuard)
export class ShopCheckoutController {
  constructor(private service: ShopCheckoutService) {}

  @Post('validate-promo')
  validatePromo(@Body() dto: ValidatePromoDto) {
    return this.service.validatePromoCode(dto);
  }

  @Post('apply-loyalty')
  applyLoyalty(@Body() dto: ApplyLoyaltyDto, @Req() req: any) {
    return this.service.validateLoyaltyRedemption(dto, req.customer.id);
  }

  @Post('place')
  place(@Body() dto: PlaceOrderDto, @Req() req: any) {
    return this.service.placeOrder(dto, req.customer.id);
  }
}
```

> If `ShopAuthGuard` does not exist yet in `shop-auth-social`, fall back to the existing `JwtAudienceGuard` configured for shop-audience tokens. Check `shop-auth-social.service.ts` for how `signToken` sets audience, mirror in guard.

- [ ] **Step 2: Write module**

Create `shop-checkout.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { ShopCheckoutService } from './shop-checkout.service';
import { ShopCheckoutController } from './shop-checkout.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { PromotionsModule } from '../promotions/promotions.module';
import { LoyaltyModule } from '../loyalty/loyalty.module';
import { ShopShippingModule } from '../shop-shipping/shop-shipping.module';
import { PaySolutionsModule } from '../paysolutions/paysolutions.module';
import { SalesModule } from '../sales/sales.module';
import { ShopAuthSocialModule } from '../shop-auth-social/shop-auth-social.module';
import { ShopBotDefenseModule } from '../shop-bot-defense/shop-bot-defense.module';

@Module({
  imports: [
    PrismaModule, PromotionsModule, LoyaltyModule, ShopShippingModule,
    PaySolutionsModule, SalesModule, ShopAuthSocialModule, ShopBotDefenseModule,
  ],
  controllers: [ShopCheckoutController],
  providers: [ShopCheckoutService],
  exports: [ShopCheckoutService],
})
export class ShopCheckoutModule {}
```

- [ ] **Step 3: Register in app.module**

Add `ShopCheckoutModule` to `imports` in `apps/api/src/app.module.ts`.

- [ ] **Step 4: Boot + verify**

Run: `cd apps/api && npm run dev` in background, then `curl -X POST http://localhost:3000/api/shop/checkout/validate-promo`
Expected: 401 Unauthorized (auth guard engaged) or 400 validation — both confirm route is live.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/shop-checkout apps/api/src/app.module.ts
git commit -m "feat(shop-phase2): wire shop-checkout controller + module"
```

---

## Task 9: `shop-orders` module — customer side

**Files:**
- Create: `apps/api/src/modules/shop-orders/shop-orders.service.ts`
- Create: `apps/api/src/modules/shop-orders/shop-orders.service.spec.ts`
- Create: `apps/api/src/modules/shop-orders/shop-orders.controller.ts`
- Create: `apps/api/src/modules/shop-orders/shop-orders.module.ts`
- Create: `apps/api/src/modules/shop-orders/online-order-sale.adapter.ts`

- [ ] **Step 1: Write Sale adapter**

Create `online-order-sale.adapter.ts`:

```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SalesService } from '../sales/sales.service';

@Injectable()
export class OnlineOrderSaleAdapter {
  constructor(private prisma: PrismaService, private sales: SalesService) {}

  async createForOnlineOrder(onlineOrderId: string): Promise<void> {
    const order = await this.prisma.onlineOrder.findUnique({
      where: { id: onlineOrderId },
      include: { product: true, customer: true },
    });
    if (!order) throw new NotFoundException('online order not found');
    if (order.saleId) return; // already created

    // Default branch = the shop's Lopburi branch (by companyCode=SHOP + name)
    const branch = await this.prisma.branch.findFirst({
      where: { company: { companyCode: 'SHOP' } },
      orderBy: { createdAt: 'asc' },
    });
    if (!branch) throw new Error('No SHOP branch configured');

    // System "online" salesperson — fallback to first OWNER user
    const salesperson = await this.prisma.user.findFirst({
      where: { role: 'OWNER' },
      orderBy: { createdAt: 'asc' },
    });
    if (!salesperson) throw new Error('No user available as online sales attribution');

    const sale = await this.sales.create(
      {
        saleType: 'CASH' as any,
        customerId: order.customerId,
        productId: order.productId,
        branchId: branch.id,
        sellingPrice: Number(order.productPrice),
        discount: Number(order.promoDiscount) + Number(order.loyaltyDiscount),
        paymentMethod: 'PROMPTPAY' as any,
        amountReceived: Number(order.totalAmount),
        loyaltyPointsRedeemed: order.loyaltyPointsUsed || undefined,
      } as any,
      salesperson.id,
      'OWNER',
    );

    await this.prisma.sale.update({
      where: { id: sale.id },
      data: { saleSource: 'ONLINE', onlineOrderId: order.id },
    });
    await this.prisma.onlineOrder.update({
      where: { id: order.id },
      data: { saleId: sale.id, status: 'PACKING' },
    });
  }
}
```

- [ ] **Step 2: Write customer-facing orders service**

Create `shop-orders.service.ts`:

```typescript
import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ShopOrdersService {
  constructor(private prisma: PrismaService) {}

  async listMine(customerId: string) {
    return this.prisma.onlineOrder.findMany({
      where: { customerId, deletedAt: null },
      include: { product: { select: { id: true, name: true, gallery: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getByOrderNumber(orderNumber: string, customerId: string) {
    const order = await this.prisma.onlineOrder.findUnique({
      where: { orderNumber },
      include: { product: true },
    });
    if (!order) throw new NotFoundException('ไม่พบคำสั่งซื้อ');
    if (order.customerId !== customerId) throw new ForbiddenException('คำสั่งซื้อนี้ไม่ใช่ของคุณ');
    return order;
  }

  async uploadBankSlip(orderNumber: string, customerId: string, slipUrl: string) {
    const order = await this.getByOrderNumber(orderNumber, customerId);
    if (order.paymentChannel !== 'BANK_TRANSFER') {
      throw new ForbiddenException('คำสั่งซื้อนี้ไม่ได้เลือกโอนธนาคาร');
    }
    return this.prisma.onlineOrder.update({
      where: { id: order.id },
      data: { bankSlipUrl: slipUrl, status: 'PENDING_BANK_REVIEW' },
    });
  }
}
```

- [ ] **Step 3: Write controller**

Create `shop-orders.controller.ts`:

```typescript
import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ShopOrdersService } from './shop-orders.service';
import { ShopAuthGuard } from '../shop-auth-social/shop-auth.guard';

@Controller('shop/orders')
@UseGuards(ShopAuthGuard)
export class ShopOrdersController {
  constructor(private service: ShopOrdersService) {}

  @Get()
  listMine(@Req() req: any) { return this.service.listMine(req.customer.id); }

  @Get(':orderNumber')
  get(@Param('orderNumber') orderNumber: string, @Req() req: any) {
    return this.service.getByOrderNumber(orderNumber, req.customer.id);
  }

  @Post(':orderNumber/bank-slip')
  uploadSlip(
    @Param('orderNumber') orderNumber: string,
    @Body() body: { slipUrl: string },
    @Req() req: any,
  ) {
    return this.service.uploadBankSlip(orderNumber, req.customer.id, body.slipUrl);
  }
}
```

- [ ] **Step 4: Write module**

Create `shop-orders.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { ShopOrdersService } from './shop-orders.service';
import { ShopOrdersController } from './shop-orders.controller';
import { OnlineOrderSaleAdapter } from './online-order-sale.adapter';
import { PrismaModule } from '../../prisma/prisma.module';
import { SalesModule } from '../sales/sales.module';
import { ShopAuthSocialModule } from '../shop-auth-social/shop-auth-social.module';

@Module({
  imports: [PrismaModule, SalesModule, ShopAuthSocialModule],
  controllers: [ShopOrdersController],
  providers: [ShopOrdersService, OnlineOrderSaleAdapter],
  exports: [ShopOrdersService, OnlineOrderSaleAdapter],
})
export class ShopOrdersModule {}
```

- [ ] **Step 5: Wire adapter into PaySolutionsService**

Modify `paysolutions.module.ts` to import `ShopOrdersModule` (forwardRef if circular), and inject `OnlineOrderSaleAdapter` into `PaySolutionsService` constructor. Replace the `// TODO` from Task 7 with:

```typescript
    await this.saleAdapter.createForOnlineOrder(order.id);
```

Inject in constructor: `private saleAdapter: OnlineOrderSaleAdapter`.

Handle circular dependency with `forwardRef`:

```typescript
// paysolutions.module.ts
imports: [..., forwardRef(() => ShopOrdersModule)],
// paysolutions.service.ts
constructor(..., @Inject(forwardRef(() => OnlineOrderSaleAdapter)) private saleAdapter: OnlineOrderSaleAdapter) {}
```

- [ ] **Step 6: Register in app.module**

Add `ShopOrdersModule`.

- [ ] **Step 7: Type check + test**

```bash
./tools/check-types.sh api
cd apps/api && npx jest shop-orders
```

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/shop-orders apps/api/src/modules/paysolutions apps/api/src/app.module.ts
git commit -m "feat(shop-phase2): shop-orders module + OnlineOrder↔Sale adapter wired into PaySolutions webhook"
```

---

## Task 10: `shop-orders` — admin controller (queue + ship + cancel)

**Files:**
- Create: `apps/api/src/modules/shop-orders/shop-orders.admin.controller.ts`
- Modify: `apps/api/src/modules/shop-orders/shop-orders.service.ts` (add admin methods)
- Modify: `apps/api/src/modules/shop-orders/shop-orders.module.ts`

- [ ] **Step 1: Add admin service methods**

Append to `shop-orders.service.ts`:

```typescript
  async listAdminQueue(status?: string) {
    return this.prisma.onlineOrder.findMany({
      where: { deletedAt: null, ...(status ? { status: status as any } : {}) },
      include: {
        product: { select: { name: true, gallery: true, conditionGrade: true } },
        customer: { select: { name: true, phone: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async confirmBankTransfer(orderId: string, adminUserId: string) {
    return this.prisma.onlineOrder.update({
      where: { id: orderId },
      data: { status: 'PAID', paidAt: new Date(), bankConfirmedById: adminUserId },
    });
  }

  async markShipped(orderId: string, trackingNumber: string) {
    return this.prisma.onlineOrder.update({
      where: { id: orderId },
      data: { status: 'SHIPPED', trackingNumber, shippedAt: new Date() },
    });
  }

  async markDelivered(orderId: string) {
    return this.prisma.onlineOrder.update({
      where: { id: orderId },
      data: { status: 'DELIVERED', deliveredAt: new Date() },
    });
  }

  async cancelOrder(orderId: string, reason: string) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.onlineOrder.update({
        where: { id: orderId },
        data: { status: 'CANCELLED', cancelReason: reason, cancelledAt: new Date() },
      });
      await tx.productReservation.updateMany({
        where: { id: order.reservationId, status: 'ACTIVE' },
        data: { status: 'CANCELLED' },
      });
      return order;
    });
  }
```

- [ ] **Step 2: Write admin controller**

Create `shop-orders.admin.controller.ts`:

```typescript
import { Body, Controller, Get, Param, Patch, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ShopOrdersService } from './shop-orders.service';

@Controller('admin/online-orders')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
export class ShopOrdersAdminController {
  constructor(private service: ShopOrdersService) {}

  @Get()
  list(@Query('status') status?: string) { return this.service.listAdminQueue(status); }

  @Patch(':id/confirm-bank')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  confirmBank(@Param('id') id: string, @Req() req: any) {
    return this.service.confirmBankTransfer(id, req.user.id);
  }

  @Patch(':id/ship')
  ship(@Param('id') id: string, @Body() body: { trackingNumber: string }) {
    return this.service.markShipped(id, body.trackingNumber);
  }

  @Patch(':id/deliver')
  deliver(@Param('id') id: string) { return this.service.markDelivered(id); }

  @Patch(':id/cancel')
  @Roles('OWNER', 'BRANCH_MANAGER')
  cancel(@Param('id') id: string, @Body() body: { reason: string }) {
    return this.service.cancelOrder(id, body.reason);
  }
}
```

- [ ] **Step 3: Register admin controller in module**

Modify `shop-orders.module.ts`:

```typescript
import { AuthModule } from '../auth/auth.module';
// ...
imports: [PrismaModule, SalesModule, ShopAuthSocialModule, AuthModule],
controllers: [ShopOrdersController, ShopOrdersAdminController],
```

- [ ] **Step 4: Type check + commit**

```bash
./tools/check-types.sh api
git add apps/api/src/modules/shop-orders
git commit -m "feat(shop-phase2): admin online orders controller (ship/deliver/cancel/confirm-bank)"
```

---

## Task 11: LINE notification helper — "order paid"

**Files:**
- Modify: `apps/api/src/modules/paysolutions/paysolutions.service.ts` — add `buildOrderPaidFlex(order)` method

- [ ] **Step 1: Implement builder**

Add private method:

```typescript
  private buildOrderPaidFlex(order: any) {
    return {
      type: 'flex',
      altText: `ชำระเงินคำสั่งซื้อ ${order.orderNumber} สำเร็จ`,
      contents: {
        type: 'bubble',
        body: {
          type: 'box', layout: 'vertical', contents: [
            { type: 'text', text: '✅ ชำระเงินสำเร็จ', weight: 'bold', size: 'lg' },
            { type: 'text', text: `คำสั่งซื้อ ${order.orderNumber}`, size: 'md', margin: 'md' },
            { type: 'text', text: `${order.product.name}`, size: 'sm', color: '#666' },
            { type: 'separator', margin: 'md' },
            { type: 'text', text: `ยอดรวม ฿${Number(order.totalAmount).toLocaleString()}`, size: 'md', margin: 'md', weight: 'bold' },
            { type: 'text', text: 'ทางร้านจะจัดส่งภายใน 1 วันทำการ', size: 'xs', color: '#888', margin: 'md' },
          ],
        },
      },
    };
  }
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/modules/paysolutions
git commit -m "feat(shop-phase2): LINE order-paid flex message"
```

---

## Task 12: Frontend — dependency install + shadcn primitives

**Files:**
- Modify: `apps/web-shop/package.json`
- Create: `apps/web-shop/src/components/ui/{button,input,dialog,tabs,card,label}.tsx`
- Create: `apps/web-shop/src/lib/utils.ts`

- [ ] **Step 1: Install deps**

Run: `cd apps/web-shop && npm install zustand@^4.5.0 react-hook-form@^7.50.0 zod @hookform/resolvers qrcode.react @radix-ui/react-dialog @radix-ui/react-tabs @radix-ui/react-label class-variance-authority clsx tailwind-merge`

- [ ] **Step 2: Create `lib/utils.ts` (cn helper)**

```typescript
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }
```

- [ ] **Step 3: Port shadcn primitives (button/input/dialog/tabs/card/label)**

Copy from `apps/web/src/components/ui/` into `apps/web-shop/src/components/ui/`:
- `button.tsx`, `input.tsx`, `dialog.tsx`, `tabs.tsx`, `card.tsx`, `label.tsx`

Adjust imports: `@/lib/utils` remains correct (alias same).

- [ ] **Step 4: Verify build**

Run: `cd apps/web-shop && npm run build`
Expected: success.

- [ ] **Step 5: Commit**

```bash
git add apps/web-shop/package.json apps/web-shop/package-lock.json apps/web-shop/src/components/ui apps/web-shop/src/lib/utils.ts
git commit -m "chore(shop-phase2): add shadcn primitives + zustand/zod/qr deps to web-shop"
```

---

## Task 13: Frontend — AuthContext + Zustand cart store

**Files:**
- Create: `apps/web-shop/src/contexts/AuthContext.tsx`
- Create: `apps/web-shop/src/stores/cartStore.ts`
- Create: `apps/web-shop/src/hooks/useAuth.ts`
- Create: `apps/web-shop/src/hooks/useCart.ts`
- Create: `apps/web-shop/src/types/product.ts`
- Create: `apps/web-shop/src/types/order.ts`
- Create: `apps/web-shop/src/types/shipping.ts`
- Modify: `apps/web-shop/src/main.tsx`

- [ ] **Step 1: Write types**

`types/product.ts`:

```typescript
export interface ShopProduct {
  id: string;
  name: string;
  sellingPrice: number;
  gallery: string[];
  gallery360?: string[];
  conditionGrade: 'A' | 'B' | 'C' | null;
  brand?: string;
  model?: string;
}
```

`types/shipping.ts`:

```typescript
export type ShippingMethod =
  | 'BRANCH_PICKUP' | 'KERRY' | 'FLASH' | 'JT_EXPRESS' | 'THAILAND_POST';

export interface ShippingQuote {
  method: ShippingMethod;
  label: string;
  fee: number;
  etaDays: string;
  available: boolean;
}

export interface ShippingAddress {
  recipientName: string;
  phone: string;
  line1: string;
  line2?: string;
  subDistrict: string;
  district: string;
  province: string;
  postalCode: string;
}
```

`types/order.ts`:

```typescript
import { ShippingAddress, ShippingMethod } from './shipping';

export type PaymentChannel = 'PROMPTPAY_QR' | 'CREDIT_DEBIT_CARD' | 'BANK_TRANSFER';
export type OrderStatus =
  | 'DRAFT' | 'PENDING_PAYMENT' | 'PENDING_BANK_REVIEW' | 'PAID' | 'PACKING'
  | 'SHIPPED' | 'DELIVERED' | 'COMPLETED' | 'CANCELLED' | 'REFUNDED';

export interface OnlineOrder {
  id: string;
  orderNumber: string;
  productPrice: number;
  shippingFee: number;
  promoDiscount: number;
  loyaltyDiscount: number;
  totalAmount: number;
  shippingMethod: ShippingMethod;
  shippingAddress: ShippingAddress | null;
  trackingNumber: string | null;
  paymentChannel: PaymentChannel;
  paidAt: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  status: OrderStatus;
  createdAt: string;
  product: { id: string; name: string; gallery: string[] };
}
```

- [ ] **Step 2: Write AuthContext**

`contexts/AuthContext.tsx`:

```typescript
import { createContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { setAccessToken } from '../lib/api';

export interface AuthCustomer {
  id: string;
  name: string;
  phone: string | null;
  lineId: string | null;
  loyaltyBalance: number;
}

interface AuthState {
  customer: AuthCustomer | null;
  token: string | null;
  setAuth: (customer: AuthCustomer, token: string) => void;
  logout: () => void;
  hydrating: boolean;
}

export const AuthContext = createContext<AuthState>({} as AuthState);

const TOKEN_KEY = 'shop_auth_token';
const CUSTOMER_KEY = 'shop_auth_customer';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [customer, setCustomer] = useState<AuthCustomer | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [hydrating, setHydrating] = useState(true);

  useEffect(() => {
    const t = sessionStorage.getItem(TOKEN_KEY);
    const c = sessionStorage.getItem(CUSTOMER_KEY);
    if (t && c) {
      setToken(t);
      setCustomer(JSON.parse(c));
      setAccessToken(t);
    }
    setHydrating(false);
  }, []);

  const setAuth = useCallback((c: AuthCustomer, t: string) => {
    sessionStorage.setItem(TOKEN_KEY, t);
    sessionStorage.setItem(CUSTOMER_KEY, JSON.stringify(c));
    setToken(t);
    setCustomer(c);
    setAccessToken(t);
  }, []);

  const logout = useCallback(() => {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(CUSTOMER_KEY);
    setToken(null);
    setCustomer(null);
    setAccessToken(null);
  }, []);

  return (
    <AuthContext.Provider value={{ customer, token, setAuth, logout, hydrating }}>
      {children}
    </AuthContext.Provider>
  );
}
```

> Note: spec says tokens should stay in memory only. Session storage used here because BrowserRouter reload would lose context. Mark as an intentional trade-off for Phase 2; revisit if OWASP review flags.

- [ ] **Step 3: Write hook**

`hooks/useAuth.ts`:

```typescript
import { useContext } from 'react';
import { AuthContext } from '../contexts/AuthContext';
export function useAuth() { return useContext(AuthContext); }
```

- [ ] **Step 4: Write cart store**

`stores/cartStore.ts`:

```typescript
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface CartState {
  reservationId: string | null;
  productId: string | null;
  addedAt: number | null;
  setItem: (r: string, p: string) => void;
  clear: () => void;
}

export const useCartStore = create<CartState>()(
  persist(
    (set) => ({
      reservationId: null, productId: null, addedAt: null,
      setItem: (r, p) => set({ reservationId: r, productId: p, addedAt: Date.now() }),
      clear: () => set({ reservationId: null, productId: null, addedAt: null }),
    }),
    { name: 'shop_cart' }
  )
);
```

- [ ] **Step 5: Write `useCart` hook (server-state merge)**

`hooks/useCart.ts`:

```typescript
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useCartStore } from '../stores/cartStore';
import { getSessionId } from '../lib/session';

export function useCart() {
  const store = useCartStore();
  const q = useQuery({
    queryKey: ['cart', store.reservationId],
    queryFn: async () => {
      const res = await api.get('/api/shop/cart', { headers: { 'x-shop-session': getSessionId() } });
      return res.data as { items: any[]; subtotal: number };
    },
    enabled: !!store.reservationId,
    refetchInterval: 5000,
  });
  return { ...q, clear: store.clear };
}
```

- [ ] **Step 6: Wrap App in AuthProvider**

Modify `apps/web-shop/src/main.tsx`:

```typescript
import { AuthProvider } from './contexts/AuthContext';
// ...
<QueryClientProvider client={queryClient}>
  <AuthProvider>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </AuthProvider>
</QueryClientProvider>
```

- [ ] **Step 7: Build check + commit**

```bash
cd apps/web-shop && npm run build
git add apps/web-shop/src
git commit -m "feat(shop-phase2): AuthContext + Zustand cart store + types"
```

---

## Task 14: Frontend — replace ProductDetailPage stub with full reservation flow

**Files:**
- Modify: `apps/web-shop/src/pages/ProductDetailPage.tsx` (currently stub)
- Create: `apps/web-shop/src/hooks/useReservationCountdown.ts`

- [ ] **Step 1: Write countdown hook**

`hooks/useReservationCountdown.ts`:

```typescript
import { useEffect, useState } from 'react';
export function useReservationCountdown(expiresAt: Date | string | null) {
  const [remaining, setRemaining] = useState<number>(0);
  useEffect(() => {
    if (!expiresAt) return;
    const target = new Date(expiresAt).getTime();
    const tick = () => setRemaining(Math.max(0, Math.floor((target - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);
  const mm = Math.floor(remaining / 60).toString().padStart(2, '0');
  const ss = (remaining % 60).toString().padStart(2, '0');
  return { seconds: remaining, label: `${mm}:${ss}`, expired: remaining === 0 };
}
```

- [ ] **Step 2: Rewrite ProductDetailPage**

Replace `apps/web-shop/src/pages/ProductDetailPage.tsx`:

```tsx
import { useParams, useNavigate } from 'react-router';
import { useQuery, useMutation } from '@tanstack/react-query';
import { api } from '../lib/api';
import { getSessionId } from '../lib/session';
import { useCartStore } from '../stores/cartStore';
import ShopLayout from '../components/layout/ShopLayout';
import { Button } from '../components/ui/button';
import { toast } from 'sonner';

export default function ProductDetailPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const cart = useCartStore();

  const { data, isLoading } = useQuery({
    queryKey: ['product', id],
    queryFn: () => api.get(`/api/shop/products/${id}`).then((r) => r.data),
    enabled: !!id,
  });

  const reserveMut = useMutation({
    mutationFn: () =>
      api.post('/api/shop/reservations', { productId: id, sessionId: getSessionId() })
        .then((r) => r.data),
    onSuccess: (res) => {
      cart.setItem(res.id, id!);
      toast.success('จองเครื่องนี้ไว้ 15 นาทีแล้ว');
      nav('/cart');
    },
    onError: (e: any) => toast.error(e.response?.data?.message ?? 'จองไม่สำเร็จ'),
  });

  if (isLoading || !data) return <ShopLayout><div className="p-8">กำลังโหลด...</div></ShopLayout>;

  return (
    <ShopLayout>
      <div className="container mx-auto px-4 py-6 grid md:grid-cols-2 gap-8">
        <div>
          {data.gallery?.[0] && (
            <img src={data.gallery[0]} alt={data.name} className="w-full rounded-2xl" />
          )}
        </div>
        <div className="space-y-4">
          <h1 className="text-2xl font-bold">{data.name}</h1>
          {data.conditionGrade && (
            <span className="inline-block rounded-full bg-primary/10 text-primary px-3 py-1 text-sm">
              เกรด {data.conditionGrade}
            </span>
          )}
          <div className="text-3xl font-bold text-primary">
            ฿{Number(data.sellingPrice).toLocaleString()}
          </div>
          <Button
            size="lg"
            className="w-full"
            onClick={() => reserveMut.mutate()}
            disabled={reserveMut.isPending}
          >
            {reserveMut.isPending ? 'กำลังจอง...' : 'ซื้อเลย (จอง 15 นาที)'}
          </Button>
          <Button variant="outline" size="lg" className="w-full" onClick={() => nav('/apply')}>
            ผ่อนเริ่ม ฿{Math.floor(Number(data.sellingPrice) * 0.093).toLocaleString()} / เดือน
          </Button>
        </div>
      </div>
    </ShopLayout>
  );
}
```

- [ ] **Step 3: Build + manual smoke**

Run `cd apps/web-shop && npm run dev`. Navigate `/products/<id>` → click "ซื้อเลย" → verify reservation created (check backend logs) + redirects to `/cart`.

- [ ] **Step 4: Commit**

```bash
git add apps/web-shop/src
git commit -m "feat(shop-phase2): ProductDetailPage with reservation CTA + countdown hook"
```

---

## Task 15: Frontend — CartPage

**Files:**
- Create: `apps/web-shop/src/pages/CartPage.tsx`
- Create: `apps/web-shop/src/components/cart/CartItemRow.tsx`
- Create: `apps/web-shop/src/components/cart/CartEmpty.tsx`
- Create: `apps/web-shop/src/components/cart/CartSummary.tsx`
- Create: `apps/web-shop/src/components/cart/ReservationCountdownBadge.tsx`
- Modify: `apps/web-shop/src/App.tsx` (add `/cart` route)

- [ ] **Step 1: Write `ReservationCountdownBadge`**

```tsx
import { useReservationCountdown } from '../../hooks/useReservationCountdown';

export default function ReservationCountdownBadge({ expiresAt }: { expiresAt: string }) {
  const { label, expired } = useReservationCountdown(expiresAt);
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm ${
      expired ? 'bg-destructive/10 text-destructive' : 'bg-primary/10 text-primary'
    }`}>
      {expired ? 'หมดเวลา' : `เวลาที่เหลือ ${label}`}
    </span>
  );
}
```

- [ ] **Step 2: Write `CartItemRow`**

```tsx
import ReservationCountdownBadge from './ReservationCountdownBadge';

export default function CartItemRow({ item }: { item: any }) {
  return (
    <div className="flex gap-4 rounded-xl border border-border p-4">
      <img src={item.product.gallery?.[0]} alt={item.product.name} className="h-24 w-24 rounded-lg object-cover bg-muted" />
      <div className="flex-1 space-y-1">
        <div className="font-semibold">{item.product.name}</div>
        {item.product.conditionGrade && (
          <div className="text-xs text-muted-foreground">เกรด {item.product.conditionGrade}</div>
        )}
        <ReservationCountdownBadge expiresAt={item.expiresAt} />
      </div>
      <div className="text-right font-bold">฿{Number(item.product.sellingPrice).toLocaleString()}</div>
    </div>
  );
}
```

- [ ] **Step 3: Write `CartEmpty` + `CartSummary`**

```tsx
// CartEmpty.tsx
import { Link } from 'react-router';
export default function CartEmpty() {
  return (
    <div className="text-center py-16">
      <div className="text-muted-foreground">ตะกร้าของคุณว่างเปล่า</div>
      <Link to="/products" className="mt-4 inline-block text-primary">ไปเลือกซื้อสินค้า</Link>
    </div>
  );
}
```

```tsx
// CartSummary.tsx
import { Button } from '../ui/button';
export default function CartSummary({ subtotal, onCheckout }: { subtotal: number; onCheckout: () => void }) {
  return (
    <div className="rounded-xl border border-border p-6 space-y-3 sticky top-4">
      <div className="flex justify-between text-sm"><span>ราคาสินค้า</span><span>฿{subtotal.toLocaleString()}</span></div>
      <div className="flex justify-between text-sm text-muted-foreground"><span>ค่าจัดส่ง</span><span>คำนวณขั้นตอนถัดไป</span></div>
      <div className="border-t pt-3 flex justify-between font-bold"><span>ยอดรวม</span><span>฿{subtotal.toLocaleString()}</span></div>
      <Button className="w-full" size="lg" onClick={onCheckout}>ดำเนินการชำระเงิน</Button>
    </div>
  );
}
```

- [ ] **Step 4: Write `CartPage`**

```tsx
import { useNavigate } from 'react-router';
import { useCart } from '../hooks/useCart';
import ShopLayout from '../components/layout/ShopLayout';
import CartItemRow from '../components/cart/CartItemRow';
import CartEmpty from '../components/cart/CartEmpty';
import CartSummary from '../components/cart/CartSummary';

export default function CartPage() {
  const nav = useNavigate();
  const { data, isLoading } = useCart();

  if (isLoading) return <ShopLayout><div className="p-8">กำลังโหลด...</div></ShopLayout>;
  if (!data || data.items.length === 0) return <ShopLayout><CartEmpty /></ShopLayout>;

  return (
    <ShopLayout>
      <div className="container mx-auto px-4 py-6 grid md:grid-cols-3 gap-6">
        <div className="md:col-span-2 space-y-3">
          <h1 className="text-2xl font-bold mb-4">ตะกร้าของคุณ</h1>
          {data.items.map((i: any) => <CartItemRow key={i.reservationId} item={i} />)}
        </div>
        <CartSummary subtotal={data.subtotal} onCheckout={() => nav('/checkout')} />
      </div>
    </ShopLayout>
  );
}
```

- [ ] **Step 5: Register route in `App.tsx`**

Add `import CartPage from './pages/CartPage';` and `<Route path="/cart" element={<CartPage />} />`.

- [ ] **Step 6: Build + commit**

```bash
cd apps/web-shop && npm run build
git add apps/web-shop/src
git commit -m "feat(shop-phase2): cart page + components"
```

---

## Task 16: Frontend — Checkout stepper + AddressStep

**Files:**
- Create: `apps/web-shop/src/pages/CheckoutPage.tsx`
- Create: `apps/web-shop/src/components/checkout/CheckoutStepper.tsx`
- Create: `apps/web-shop/src/components/checkout/AddressStep.tsx`
- Create: `apps/web-shop/src/components/checkout/AddressForm.tsx`
- Modify: `apps/web-shop/src/App.tsx`

- [ ] **Step 1: Create Stepper**

```tsx
// CheckoutStepper.tsx
export default function CheckoutStepper({ step }: { step: 1 | 2 | 3 }) {
  const steps = ['ที่อยู่จัดส่ง', 'วิธีจัดส่ง', 'ชำระเงิน'];
  return (
    <div className="flex items-center justify-center gap-4 py-6">
      {steps.map((label, i) => {
        const n = i + 1;
        return (
          <div key={n} className="flex items-center gap-2">
            <div className={`h-8 w-8 rounded-full flex items-center justify-center text-sm font-bold ${
              n <= step ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
            }`}>{n}</div>
            <span className={n === step ? 'font-semibold' : 'text-muted-foreground'}>{label}</span>
            {n < 3 && <div className="w-8 h-px bg-border" />}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Create AddressForm (zod + rhf)**

```tsx
// AddressForm.tsx
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { Label } from '../ui/label';
import type { ShippingAddress } from '../../types/shipping';

const schema = z.object({
  recipientName: z.string().min(2, 'กรุณาระบุชื่อผู้รับ'),
  phone: z.string().regex(/^0\d{9}$/, 'เบอร์โทร 10 หลัก'),
  line1: z.string().min(5, 'ที่อยู่ไม่ครบ'),
  line2: z.string().optional(),
  subDistrict: z.string().min(2),
  district: z.string().min(2),
  province: z.string().min(2),
  postalCode: z.string().regex(/^\d{5}$/, 'รหัสไปรษณีย์ 5 หลัก'),
});

export default function AddressForm({ onSubmit, initial }: {
  onSubmit: (addr: ShippingAddress) => void;
  initial?: Partial<ShippingAddress>;
}) {
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm({
    resolver: zodResolver(schema),
    defaultValues: initial,
  });

  return (
    <form onSubmit={handleSubmit((v) => onSubmit(v as ShippingAddress))} className="space-y-4 max-w-xl">
      <div className="grid sm:grid-cols-2 gap-4">
        <div><Label>ชื่อผู้รับ</Label><Input {...register('recipientName')} />{errors.recipientName && <span className="text-xs text-destructive">{errors.recipientName.message}</span>}</div>
        <div><Label>เบอร์โทร</Label><Input {...register('phone')} />{errors.phone && <span className="text-xs text-destructive">{errors.phone.message}</span>}</div>
      </div>
      <div><Label>ที่อยู่ (บ้านเลขที่ ซอย ถนน)</Label><Input {...register('line1')} />{errors.line1 && <span className="text-xs text-destructive">{errors.line1.message}</span>}</div>
      <div><Label>ที่อยู่เพิ่มเติม (ถ้ามี)</Label><Input {...register('line2')} /></div>
      <div className="grid sm:grid-cols-3 gap-4">
        <div><Label>ตำบล/แขวง</Label><Input {...register('subDistrict')} /></div>
        <div><Label>อำเภอ/เขต</Label><Input {...register('district')} /></div>
        <div><Label>จังหวัด</Label><Input {...register('province')} /></div>
      </div>
      <div className="max-w-[160px]"><Label>รหัสไปรษณีย์</Label><Input {...register('postalCode')} />{errors.postalCode && <span className="text-xs text-destructive">{errors.postalCode.message}</span>}</div>
      <Button type="submit" disabled={isSubmitting} className="w-full sm:w-auto">ดำเนินการต่อ</Button>
    </form>
  );
}
```

- [ ] **Step 3: Create AddressStep (picks saved or adds new)**

```tsx
// AddressStep.tsx
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../lib/api';
import AddressForm from './AddressForm';
import type { ShippingAddress } from '../../types/shipping';

export default function AddressStep({ onNext }: { onNext: (addr: ShippingAddress) => void }) {
  const [adding, setAdding] = useState(false);
  const { data } = useQuery({
    queryKey: ['addresses'],
    queryFn: () => api.get('/api/shop/me/addresses').then((r) => r.data as ShippingAddress[]),
  });
  const addresses = data ?? [];

  if (adding || addresses.length === 0) {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-bold">ที่อยู่จัดส่ง</h2>
        <AddressForm onSubmit={onNext} />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h2 className="text-xl font-bold">เลือกที่อยู่จัดส่ง</h2>
      {addresses.map((a, i) => (
        <button key={i} onClick={() => onNext(a)} className="w-full text-left rounded-xl border border-border p-4 hover:border-primary">
          <div className="font-semibold">{a.recipientName} · {a.phone}</div>
          <div className="text-sm text-muted-foreground">{a.line1} {a.line2} {a.subDistrict} {a.district} {a.province} {a.postalCode}</div>
        </button>
      ))}
      <button onClick={() => setAdding(true)} className="text-primary text-sm">+ เพิ่มที่อยู่ใหม่</button>
    </div>
  );
}
```

- [ ] **Step 4: Add addresses endpoint on backend (quick extension)**

In `shop-auth-social` (or new `shop-me`) add:
- `GET /api/shop/me/addresses` → returns `customer.shippingAddresses` (or `[]`)
- `POST /api/shop/me/addresses` → appends to `shippingAddresses` array

Create file `apps/api/src/modules/shop-me/shop-me.controller.ts`:

```typescript
import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ShopAuthGuard } from '../shop-auth-social/shop-auth.guard';

@Controller('shop/me')
@UseGuards(ShopAuthGuard)
export class ShopMeController {
  constructor(private prisma: PrismaService) {}

  @Get('addresses')
  async listAddresses(@Req() req: any) {
    const c = await this.prisma.customer.findUnique({ where: { id: req.customer.id } });
    return (c?.shippingAddresses ?? []) as any[];
  }

  @Post('addresses')
  async addAddress(@Req() req: any, @Body() addr: any) {
    const c = await this.prisma.customer.findUnique({ where: { id: req.customer.id } });
    const next = [...((c?.shippingAddresses as any[]) ?? []), addr];
    await this.prisma.customer.update({ where: { id: req.customer.id }, data: { shippingAddresses: next } });
    return next;
  }
}
```

Create module file `shop-me.module.ts`, import PrismaModule + ShopAuthSocialModule. Register in app.module.

- [ ] **Step 5: Build + commit**

```bash
cd apps/web-shop && npm run build
git add apps/web-shop/src apps/api/src/modules/shop-me apps/api/src/app.module.ts
git commit -m "feat(shop-phase2): checkout AddressStep + /shop/me/addresses endpoint"
```

---

## Task 17: Frontend — ShippingStep

**Files:**
- Create: `apps/web-shop/src/components/checkout/ShippingStep.tsx`

- [ ] **Step 1: Implement**

```tsx
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import type { ShippingMethod, ShippingQuote } from '../../types/shipping';
import { Button } from '../ui/button';
import { useState } from 'react';

export default function ShippingStep({ onNext, onBack }: {
  onNext: (m: ShippingMethod, fee: number) => void;
  onBack: () => void;
}) {
  const { data } = useQuery({
    queryKey: ['shipping-methods'],
    queryFn: () => api.get('/api/shop/shipping/methods').then((r) => r.data as ShippingQuote[]),
  });
  const [selected, setSelected] = useState<ShippingMethod | null>(null);
  const methods = data ?? [];
  const picked = methods.find((m) => m.method === selected);

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">วิธีจัดส่ง</h2>
      <div className="space-y-2">
        {methods.map((m) => (
          <button
            key={m.method}
            onClick={() => setSelected(m.method)}
            className={`w-full text-left rounded-xl border p-4 ${selected === m.method ? 'border-primary bg-primary/5' : 'border-border'}`}
          >
            <div className="flex justify-between">
              <div>
                <div className="font-semibold">{m.label}</div>
                <div className="text-sm text-muted-foreground">{m.etaDays}</div>
              </div>
              <div className="font-bold">{m.fee === 0 ? 'ฟรี' : `฿${m.fee}`}</div>
            </div>
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <Button variant="outline" onClick={onBack}>ย้อนกลับ</Button>
        <Button
          disabled={!picked}
          onClick={() => picked && onNext(picked.method, picked.fee)}
        >
          ดำเนินการต่อ
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web-shop/src/components/checkout
git commit -m "feat(shop-phase2): checkout ShippingStep"
```

---

## Task 18: Frontend — PaymentStep (promo + loyalty + method)

**Files:**
- Create: `apps/web-shop/src/components/checkout/PaymentStep.tsx`
- Create: `apps/web-shop/src/components/checkout/PromoCodeInput.tsx`
- Create: `apps/web-shop/src/components/checkout/LoyaltyPointsInput.tsx`
- Create: `apps/web-shop/src/components/checkout/OrderSummaryCard.tsx`
- Create: `apps/web-shop/src/components/checkout/PaymentMethodPicker.tsx`

- [ ] **Step 1: Write `OrderSummaryCard`**

```tsx
export default function OrderSummaryCard({ productPrice, shippingFee, promoDiscount, loyaltyDiscount }: {
  productPrice: number; shippingFee: number; promoDiscount: number; loyaltyDiscount: number;
}) {
  const total = Math.max(0, productPrice + shippingFee - promoDiscount - loyaltyDiscount);
  return (
    <div className="rounded-xl border border-border p-4 space-y-2 text-sm">
      <div className="flex justify-between"><span>ราคาสินค้า</span><span>฿{productPrice.toLocaleString()}</span></div>
      <div className="flex justify-between"><span>ค่าจัดส่ง</span><span>฿{shippingFee.toLocaleString()}</span></div>
      {promoDiscount > 0 && <div className="flex justify-between text-primary"><span>ส่วนลดโค้ด</span><span>-฿{promoDiscount.toLocaleString()}</span></div>}
      {loyaltyDiscount > 0 && <div className="flex justify-between text-primary"><span>ส่วนลดแต้ม</span><span>-฿{loyaltyDiscount.toLocaleString()}</span></div>}
      <div className="border-t pt-2 flex justify-between font-bold text-base"><span>รวมที่ต้องชำระ</span><span>฿{total.toLocaleString()}</span></div>
    </div>
  );
}
```

- [ ] **Step 2: Write `PromoCodeInput`**

```tsx
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../lib/api';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { toast } from 'sonner';

export default function PromoCodeInput({ reservationId, onDiscount }: {
  reservationId: string;
  onDiscount: (amount: number, code: string | null) => void;
}) {
  const [code, setCode] = useState('');
  const mut = useMutation({
    mutationFn: () => api.post('/api/shop/checkout/validate-promo', { code, reservationId }).then((r) => r.data),
    onSuccess: (res) => {
      if (res.valid) { toast.success(`ใช้โค้ดได้ ส่วนลด ฿${res.discountAmount}`); onDiscount(res.discountAmount, code); }
      else { toast.error(res.reason ?? 'โค้ดใช้ไม่ได้'); onDiscount(0, null); }
    },
  });
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">โค้ดส่วนลด</div>
      <div className="flex gap-2">
        <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="ใส่โค้ด" />
        <Button onClick={() => mut.mutate()} disabled={!code || mut.isPending}>ใช้โค้ด</Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Write `LoyaltyPointsInput`**

```tsx
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../lib/api';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { toast } from 'sonner';
import { useAuth } from '../../hooks/useAuth';

export default function LoyaltyPointsInput({ reservationId, onDiscount }: {
  reservationId: string;
  onDiscount: (amount: number, points: number) => void;
}) {
  const { customer } = useAuth();
  const [pts, setPts] = useState('');
  const { data: balance } = useQuery({
    queryKey: ['loyalty-balance', customer?.id],
    queryFn: () => api.get(`/api/loyalty/${customer!.id}/points`).then((r) => r.data.balance as number),
    enabled: !!customer,
  });
  const mut = useMutation({
    mutationFn: () => api.post('/api/shop/checkout/apply-loyalty', {
      reservationId, points: Number(pts),
    }).then((r) => r.data),
    onSuccess: (res) => {
      if (res.valid) { toast.success(`ใช้ ${pts} แต้ม ลด ฿${res.discountAmount}`); onDiscount(res.discountAmount, Number(pts)); }
      else { toast.error(res.reason); onDiscount(0, 0); }
    },
  });

  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">แต้มสะสม (ยอด: {balance ?? 0} แต้ม — 1 แต้ม = 1฿)</div>
      <div className="flex gap-2">
        <Input type="number" value={pts} onChange={(e) => setPts(e.target.value)} placeholder="0" />
        <Button onClick={() => mut.mutate()} disabled={!pts || mut.isPending}>ใช้แต้ม</Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Write `PaymentMethodPicker`**

```tsx
import type { PaymentChannel } from '../../types/order';

const OPTIONS: { value: PaymentChannel; label: string; desc: string }[] = [
  { value: 'PROMPTPAY_QR', label: 'PromptPay QR', desc: 'แสกนจ่ายจากแอปธนาคาร — ยืนยันทันที' },
  { value: 'CREDIT_DEBIT_CARD', label: 'บัตรเครดิต/เดบิต', desc: 'Visa, Mastercard, JCB' },
  { value: 'BANK_TRANSFER', label: 'โอนเงินเข้าบัญชี', desc: 'แนบสลิปหลังโอน — ยืนยันภายใน 1 ชม.' },
];

export default function PaymentMethodPicker({ value, onChange }: {
  value: PaymentChannel | null;
  onChange: (v: PaymentChannel) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">วิธีชำระเงิน</div>
      {OPTIONS.map((o) => (
        <button key={o.value} onClick={() => onChange(o.value)}
          className={`w-full text-left rounded-xl border p-3 ${value === o.value ? 'border-primary bg-primary/5' : 'border-border'}`}>
          <div className="font-semibold">{o.label}</div>
          <div className="text-xs text-muted-foreground">{o.desc}</div>
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Write `PaymentStep`**

```tsx
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { Button } from '../ui/button';
import { toast } from 'sonner';
import PromoCodeInput from './PromoCodeInput';
import LoyaltyPointsInput from './LoyaltyPointsInput';
import PaymentMethodPicker from './PaymentMethodPicker';
import OrderSummaryCard from './OrderSummaryCard';
import type { PaymentChannel } from '../../types/order';
import type { ShippingAddress, ShippingMethod } from '../../types/shipping';

interface Props {
  reservationId: string;
  productPrice: number;
  shippingMethod: ShippingMethod;
  shippingFee: number;
  shippingAddress: ShippingAddress;
  onBack: () => void;
  onPlaced: (orderNumber: string, paymentUrl?: string) => void;
}

export default function PaymentStep(p: Props) {
  const [promoCode, setPromoCode] = useState<string | null>(null);
  const [promoDiscount, setPromoDiscount] = useState(0);
  const [loyaltyPoints, setLoyaltyPoints] = useState(0);
  const [loyaltyDiscount, setLoyaltyDiscount] = useState(0);
  const [channel, setChannel] = useState<PaymentChannel | null>(null);

  const placeMut = useMutation({
    mutationFn: () => api.post('/api/shop/checkout/place', {
      reservationId: p.reservationId,
      shippingMethod: p.shippingMethod,
      shippingAddress: p.shippingAddress,
      paymentChannel: channel,
      promoCode: promoCode ?? undefined,
      loyaltyPointsRedeemed: loyaltyPoints || undefined,
    }).then((r) => r.data),
    onSuccess: (res) => {
      toast.success('สร้างคำสั่งซื้อสำเร็จ');
      p.onPlaced(res.orderNumber, res.paymentUrl);
    },
    onError: (e: any) => toast.error(e.response?.data?.message ?? 'สร้างคำสั่งซื้อไม่สำเร็จ'),
  });

  return (
    <div className="grid md:grid-cols-3 gap-6">
      <div className="md:col-span-2 space-y-6">
        <h2 className="text-xl font-bold">ชำระเงิน</h2>
        <PromoCodeInput reservationId={p.reservationId} onDiscount={(amt, code) => { setPromoDiscount(amt); setPromoCode(code); }} />
        <LoyaltyPointsInput reservationId={p.reservationId} onDiscount={(amt, pts) => { setLoyaltyDiscount(amt); setLoyaltyPoints(pts); }} />
        <PaymentMethodPicker value={channel} onChange={setChannel} />
      </div>
      <div className="space-y-4">
        <OrderSummaryCard productPrice={p.productPrice} shippingFee={p.shippingFee} promoDiscount={promoDiscount} loyaltyDiscount={loyaltyDiscount} />
        <div className="flex gap-2">
          <Button variant="outline" onClick={p.onBack}>ย้อน</Button>
          <Button className="flex-1" disabled={!channel || placeMut.isPending} onClick={() => placeMut.mutate()}>
            {placeMut.isPending ? 'กำลังดำเนินการ...' : 'สั่งซื้อ'}
          </Button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add apps/web-shop/src/components/checkout
git commit -m "feat(shop-phase2): checkout PaymentStep with promo/loyalty/method"
```

---

## Task 19: Frontend — CheckoutPage (wires 3 steps)

**Files:**
- Create: `apps/web-shop/src/pages/CheckoutPage.tsx`
- Modify: `apps/web-shop/src/App.tsx`

- [ ] **Step 1: Implement**

```tsx
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useCart } from '../hooks/useCart';
import { useAuth } from '../hooks/useAuth';
import ShopLayout from '../components/layout/ShopLayout';
import CheckoutStepper from '../components/checkout/CheckoutStepper';
import AddressStep from '../components/checkout/AddressStep';
import ShippingStep from '../components/checkout/ShippingStep';
import PaymentStep from '../components/checkout/PaymentStep';
import type { ShippingAddress, ShippingMethod } from '../types/shipping';

export default function CheckoutPage() {
  const nav = useNavigate();
  const { customer, hydrating } = useAuth();
  const { data: cart } = useCart();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [address, setAddress] = useState<ShippingAddress | null>(null);
  const [ship, setShip] = useState<{ method: ShippingMethod; fee: number } | null>(null);

  if (hydrating) return <ShopLayout><div className="p-8">กำลังโหลด...</div></ShopLayout>;
  if (!customer) { nav('/login?returnTo=/checkout'); return null; }
  if (!cart || cart.items.length === 0) { nav('/cart'); return null; }

  const item = cart.items[0];

  return (
    <ShopLayout>
      <div className="container mx-auto px-4 py-4">
        <CheckoutStepper step={step} />
        {step === 1 && <AddressStep onNext={(a) => { setAddress(a); setStep(2); }} />}
        {step === 2 && address && (
          <ShippingStep
            onBack={() => setStep(1)}
            onNext={(method, fee) => { setShip({ method, fee }); setStep(3); }}
          />
        )}
        {step === 3 && address && ship && (
          <PaymentStep
            reservationId={item.reservationId}
            productPrice={item.product.sellingPrice}
            shippingMethod={ship.method}
            shippingFee={ship.fee}
            shippingAddress={address}
            onBack={() => setStep(2)}
            onPlaced={(orderNumber, paymentUrl) => {
              if (paymentUrl) window.location.href = paymentUrl;
              else nav(`/checkout/success/${orderNumber}`);
            }}
          />
        )}
      </div>
    </ShopLayout>
  );
}
```

- [ ] **Step 2: Register route**

Add to `App.tsx`:

```tsx
import CheckoutPage from './pages/CheckoutPage';
// ...
<Route path="/checkout" element={<CheckoutPage />} />
```

- [ ] **Step 3: Build + smoke test**

Run: `cd apps/web-shop && npm run dev`
Navigate: `/products/:id` → "ซื้อเลย" → `/cart` → "ชำระเงิน" → walk through 3 steps → verify backend POST /checkout/place returns paymentUrl.

- [ ] **Step 4: Commit**

```bash
git add apps/web-shop/src
git commit -m "feat(shop-phase2): CheckoutPage wires 3-step wizard"
```

---

## Task 20: Frontend — OrderSuccessPage + OrdersPage + OrderDetailPage

**Files:**
- Create: `apps/web-shop/src/pages/OrderSuccessPage.tsx`
- Create: `apps/web-shop/src/pages/OrdersPage.tsx`
- Create: `apps/web-shop/src/pages/OrderDetailPage.tsx`
- Create: `apps/web-shop/src/components/orders/OrderStatusBadge.tsx`
- Create: `apps/web-shop/src/components/orders/OrderCard.tsx`
- Create: `apps/web-shop/src/components/orders/OrderTimeline.tsx`
- Modify: `apps/web-shop/src/App.tsx`

- [ ] **Step 1: OrderStatusBadge**

```tsx
const LABELS: Record<string, { text: string; color: string }> = {
  DRAFT: { text: 'รอดำเนินการ', color: 'bg-muted text-muted-foreground' },
  PENDING_PAYMENT: { text: 'รอชำระเงิน', color: 'bg-amber-100 text-amber-800' },
  PENDING_BANK_REVIEW: { text: 'รอตรวจสลิป', color: 'bg-amber-100 text-amber-800' },
  PAID: { text: 'ชำระแล้ว', color: 'bg-emerald-100 text-emerald-800' },
  PACKING: { text: 'กำลังแพ็ค', color: 'bg-blue-100 text-blue-800' },
  SHIPPED: { text: 'จัดส่งแล้ว', color: 'bg-blue-100 text-blue-800' },
  DELIVERED: { text: 'ส่งถึงแล้ว', color: 'bg-emerald-100 text-emerald-800' },
  COMPLETED: { text: 'เสร็จสิ้น', color: 'bg-emerald-100 text-emerald-800' },
  CANCELLED: { text: 'ยกเลิก', color: 'bg-red-100 text-red-800' },
  REFUNDED: { text: 'คืนเงินแล้ว', color: 'bg-red-100 text-red-800' },
};

export default function OrderStatusBadge({ status }: { status: string }) {
  const l = LABELS[status] ?? LABELS.DRAFT;
  return <span className={`inline-block rounded-full px-3 py-1 text-xs ${l.color}`}>{l.text}</span>;
}
```

- [ ] **Step 2: OrderCard + OrderTimeline**

```tsx
// OrderCard.tsx
import { Link } from 'react-router';
import OrderStatusBadge from './OrderStatusBadge';
export default function OrderCard({ order }: { order: any }) {
  return (
    <Link to={`/orders/${order.orderNumber}`} className="block rounded-xl border border-border p-4 hover:border-primary">
      <div className="flex justify-between items-start">
        <div>
          <div className="font-semibold">{order.orderNumber}</div>
          <div className="text-sm text-muted-foreground">{order.product.name}</div>
        </div>
        <OrderStatusBadge status={order.status} />
      </div>
      <div className="mt-2 text-right font-bold">฿{Number(order.totalAmount).toLocaleString()}</div>
    </Link>
  );
}
```

```tsx
// OrderTimeline.tsx
const STEPS = [
  { key: 'PENDING_PAYMENT', label: 'สั่งซื้อ' },
  { key: 'PAID', label: 'ชำระเงิน' },
  { key: 'PACKING', label: 'แพ็คสินค้า' },
  { key: 'SHIPPED', label: 'จัดส่ง' },
  { key: 'DELIVERED', label: 'ส่งถึง' },
];
export default function OrderTimeline({ status }: { status: string }) {
  const idx = STEPS.findIndex((s) => s.key === status);
  return (
    <div className="flex items-center justify-between py-4">
      {STEPS.map((s, i) => (
        <div key={s.key} className="flex flex-col items-center flex-1">
          <div className={`h-3 w-3 rounded-full ${i <= idx ? 'bg-primary' : 'bg-muted'}`} />
          <div className={`text-xs mt-1 ${i <= idx ? '' : 'text-muted-foreground'}`}>{s.label}</div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: OrderSuccessPage (with PromptPay polling)**

```tsx
import { useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import ShopLayout from '../components/layout/ShopLayout';
import OrderStatusBadge from '../components/orders/OrderStatusBadge';
import { useCartStore } from '../stores/cartStore';
import { useEffect } from 'react';

export default function OrderSuccessPage() {
  const { orderNumber } = useParams();
  const cart = useCartStore();
  const { data } = useQuery({
    queryKey: ['order', orderNumber],
    queryFn: () => api.get(`/api/shop/orders/${orderNumber}`).then((r) => r.data),
    refetchInterval: (q) => q.state.data?.status === 'PENDING_PAYMENT' ? 3000 : false,
    enabled: !!orderNumber,
  });

  useEffect(() => { if (data?.status === 'PAID') cart.clear(); }, [data?.status]);

  if (!data) return <ShopLayout><div className="p-8">กำลังโหลด...</div></ShopLayout>;

  return (
    <ShopLayout>
      <div className="container mx-auto px-4 py-8 max-w-xl text-center">
        <div className="text-3xl font-bold mb-4">✓ สั่งซื้อสำเร็จ</div>
        <div className="text-lg mb-2">{data.orderNumber}</div>
        <OrderStatusBadge status={data.status} />
        <div className="mt-4 text-muted-foreground">{data.status === 'PENDING_PAYMENT' ? 'รอชำระเงิน…' : 'ทางร้านจะจัดส่งภายใน 1 วันทำการ'}</div>
      </div>
    </ShopLayout>
  );
}
```

- [ ] **Step 4: OrdersPage**

```tsx
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import ShopLayout from '../components/layout/ShopLayout';
import OrderCard from '../components/orders/OrderCard';

export default function OrdersPage() {
  const { data } = useQuery({
    queryKey: ['my-orders'],
    queryFn: () => api.get('/api/shop/orders').then((r) => r.data as any[]),
  });

  return (
    <ShopLayout>
      <div className="container mx-auto px-4 py-6 space-y-3 max-w-2xl">
        <h1 className="text-2xl font-bold mb-2">คำสั่งซื้อของฉัน</h1>
        {(data ?? []).map((o) => <OrderCard key={o.id} order={o} />)}
        {data?.length === 0 && <div className="text-muted-foreground">ยังไม่มีคำสั่งซื้อ</div>}
      </div>
    </ShopLayout>
  );
}
```

- [ ] **Step 5: OrderDetailPage**

```tsx
import { useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import ShopLayout from '../components/layout/ShopLayout';
import OrderStatusBadge from '../components/orders/OrderStatusBadge';
import OrderTimeline from '../components/orders/OrderTimeline';

export default function OrderDetailPage() {
  const { orderNumber } = useParams();
  const { data } = useQuery({
    queryKey: ['order', orderNumber],
    queryFn: () => api.get(`/api/shop/orders/${orderNumber}`).then((r) => r.data),
    enabled: !!orderNumber,
    refetchInterval: 10000,
  });
  if (!data) return <ShopLayout><div className="p-8">กำลังโหลด...</div></ShopLayout>;

  const addr = data.shippingAddress;
  return (
    <ShopLayout>
      <div className="container mx-auto px-4 py-6 space-y-4 max-w-2xl">
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-xl font-bold">{data.orderNumber}</h1>
            <div className="text-sm text-muted-foreground">สร้างเมื่อ {new Date(data.createdAt).toLocaleString('th-TH')}</div>
          </div>
          <OrderStatusBadge status={data.status} />
        </div>
        <OrderTimeline status={data.status} />
        <div className="rounded-xl border border-border p-4">
          <div className="font-semibold">{data.product.name}</div>
          <div className="mt-2 flex justify-between"><span>ราคาสินค้า</span><span>฿{Number(data.productPrice).toLocaleString()}</span></div>
          <div className="flex justify-between"><span>ค่าจัดส่ง ({data.shippingMethod})</span><span>฿{Number(data.shippingFee).toLocaleString()}</span></div>
          {Number(data.promoDiscount) > 0 && <div className="flex justify-between text-primary"><span>ส่วนลด ({data.promoCode})</span><span>-฿{Number(data.promoDiscount).toLocaleString()}</span></div>}
          {Number(data.loyaltyDiscount) > 0 && <div className="flex justify-between text-primary"><span>ใช้แต้ม {data.loyaltyPointsUsed} แต้ม</span><span>-฿{Number(data.loyaltyDiscount).toLocaleString()}</span></div>}
          <div className="border-t mt-2 pt-2 flex justify-between font-bold"><span>รวม</span><span>฿{Number(data.totalAmount).toLocaleString()}</span></div>
        </div>
        {addr && (
          <div className="rounded-xl border border-border p-4 text-sm">
            <div className="font-semibold mb-1">ที่อยู่จัดส่ง</div>
            <div>{addr.recipientName} · {addr.phone}</div>
            <div className="text-muted-foreground">{addr.line1} {addr.line2} {addr.subDistrict} {addr.district} {addr.province} {addr.postalCode}</div>
          </div>
        )}
        {data.trackingNumber && (
          <div className="rounded-xl border border-border p-4 text-sm">
            <div className="font-semibold">หมายเลขพัสดุ</div>
            <div className="text-primary">{data.trackingNumber}</div>
          </div>
        )}
      </div>
    </ShopLayout>
  );
}
```

- [ ] **Step 6: Register routes**

In `App.tsx`:

```tsx
import OrderSuccessPage from './pages/OrderSuccessPage';
import OrdersPage from './pages/OrdersPage';
import OrderDetailPage from './pages/OrderDetailPage';
// ...
<Route path="/checkout/success/:orderNumber" element={<OrderSuccessPage />} />
<Route path="/orders" element={<OrdersPage />} />
<Route path="/orders/:orderNumber" element={<OrderDetailPage />} />
```

- [ ] **Step 7: Commit**

```bash
git add apps/web-shop/src
git commit -m "feat(shop-phase2): order success + orders list + order detail pages"
```

---

## Task 21: Frontend — Account / AddressBook page

**Files:**
- Create: `apps/web-shop/src/pages/account/AccountPage.tsx`
- Create: `apps/web-shop/src/pages/account/AddressBookPage.tsx`
- Modify: `apps/web-shop/src/App.tsx`

- [ ] **Step 1: AccountPage**

```tsx
import { Link, useNavigate } from 'react-router';
import ShopLayout from '../../components/layout/ShopLayout';
import { useAuth } from '../../hooks/useAuth';
import { Button } from '../../components/ui/button';

export default function AccountPage() {
  const { customer, logout } = useAuth();
  const nav = useNavigate();
  if (!customer) { nav('/login'); return null; }
  return (
    <ShopLayout>
      <div className="container mx-auto px-4 py-6 space-y-3 max-w-xl">
        <h1 className="text-2xl font-bold">บัญชีของฉัน</h1>
        <div className="rounded-xl border border-border p-4">
          <div className="font-semibold">{customer.name}</div>
          <div className="text-sm text-muted-foreground">{customer.phone ?? '(ยังไม่ผูกเบอร์)'}</div>
          <div className="text-sm mt-2">แต้มสะสม: <b>{customer.loyaltyBalance}</b> แต้ม</div>
        </div>
        <Link className="block rounded-xl border border-border p-4 hover:border-primary" to="/account/addresses">ที่อยู่จัดส่ง</Link>
        <Link className="block rounded-xl border border-border p-4 hover:border-primary" to="/orders">คำสั่งซื้อของฉัน</Link>
        <Button variant="outline" onClick={logout}>ออกจากระบบ</Button>
      </div>
    </ShopLayout>
  );
}
```

- [ ] **Step 2: AddressBookPage**

```tsx
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import ShopLayout from '../../components/layout/ShopLayout';
import AddressForm from '../../components/checkout/AddressForm';
import { useState } from 'react';
import { toast } from 'sonner';

export default function AddressBookPage() {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const { data } = useQuery({
    queryKey: ['addresses'],
    queryFn: () => api.get('/api/shop/me/addresses').then((r) => r.data as any[]),
  });
  const mut = useMutation({
    mutationFn: (addr: any) => api.post('/api/shop/me/addresses', addr).then((r) => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['addresses'] }); setAdding(false); toast.success('บันทึกแล้ว'); },
  });
  return (
    <ShopLayout>
      <div className="container mx-auto px-4 py-6 space-y-4 max-w-2xl">
        <h1 className="text-2xl font-bold">ที่อยู่จัดส่ง</h1>
        {(data ?? []).map((a: any, i: number) => (
          <div key={i} className="rounded-xl border border-border p-4">
            <div className="font-semibold">{a.recipientName} · {a.phone}</div>
            <div className="text-sm text-muted-foreground">{a.line1} {a.line2} {a.subDistrict} {a.district} {a.province} {a.postalCode}</div>
          </div>
        ))}
        {adding ? <AddressForm onSubmit={(v) => mut.mutate(v)} />
          : <button onClick={() => setAdding(true)} className="text-primary">+ เพิ่มที่อยู่ใหม่</button>}
      </div>
    </ShopLayout>
  );
}
```

- [ ] **Step 3: Routes**

```tsx
import AccountPage from './pages/account/AccountPage';
import AddressBookPage from './pages/account/AddressBookPage';
<Route path="/account" element={<AccountPage />} />
<Route path="/account/addresses" element={<AddressBookPage />} />
```

- [ ] **Step 4: Commit**

```bash
git add apps/web-shop/src
git commit -m "feat(shop-phase2): account + address book pages"
```

---

## Task 22: E2E smoke — cash checkout happy path

**Files:**
- Create: `apps/web/e2e/shop-cash-checkout.spec.ts` (Playwright)

Note: the existing e2e harness in `apps/web/e2e/` runs against the admin app + API. We'll add a web-shop-specific spec reachable at its dev port 5174.

- [ ] **Step 1: Seed test data**

Run: `./tools/db-reset.sh` then manually seed one `IN_STOCK` product with `isOnlineVisible=true`, `conditionGrade='A'`, `sellingPrice=12500`.

- [ ] **Step 2: Write spec**

Create `apps/web/e2e/shop-cash-checkout.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';

test.describe.skip('Phase 2: cash checkout — enable after PaySolutions sandbox wired', () => {
  test('browse → reserve → cart → checkout → place order', async ({ page }) => {
    await page.goto('http://localhost:5174/products');
    await page.getByText('iPhone', { exact: false }).first().click();
    await page.getByRole('button', { name: /ซื้อเลย/ }).click();
    await expect(page).toHaveURL(/\/cart/);
    await page.getByRole('button', { name: /ดำเนินการชำระเงิน/ }).click();
    await expect(page).toHaveURL(/\/checkout/);
    // TODO: login + fill address + ship + pay — complete once seed fixtures exist
  });
});
```

> Marked `describe.skip` — seed fixtures + PaySolutions sandbox not ready in Phase 2 initial ship. Enable in a follow-up once fixtures land.

- [ ] **Step 3: Commit**

```bash
git add apps/web/e2e
git commit -m "test(shop-phase2): scaffold cash checkout e2e (skipped until fixtures)"
```

---

## Task 23: Final verification

**Files:** verification only

- [ ] **Step 1: Full type check**

Run: `./tools/check-types.sh all`
Expected: 0 errors.

- [ ] **Step 2: Full unit test suite**

Run: `cd apps/api && npx jest --testPathPattern='shop-'`
Expected: All shop-* tests pass. Target coverage: shop-shipping (3), shop-cart (2), shop-checkout (6+), shop-orders (smoke).

- [ ] **Step 3: Manual walkthrough (local)**

Start: `npm run dev` (root) + `cd apps/web-shop && npm run dev`.
Walkthrough:
1. `/products` — list loads
2. Click product → `/products/:id` detail page renders
3. Click "ซื้อเลย" → reservation created, redirects `/cart`
4. Cart shows item with countdown timer
5. Click "ดำเนินการชำระเงิน" → `/checkout`
6. Complete 3 steps — address, shipping, payment
7. Choose PromptPay QR → placeOrder returns paymentUrl → redirect
8. (Simulate webhook) — POST to `/api/paysolutions/webhook` with PaymentLink.metadata.onlineOrderId
9. Check `/orders/:orderNumber` — status transitions PENDING_PAYMENT → PAID → PACKING
10. Admin `/api/admin/online-orders` — list includes new order
11. `PATCH /:id/ship` with `trackingNumber` → status SHIPPED

- [ ] **Step 4: Run pre-deploy**

Run: `./tools/run-tests.sh --skip-e2e`
Expected: lint + types + unit tests pass.

- [ ] **Step 5: Confirm migration is safe**

Verify last migration SQL has no `DROP` and no required columns without defaults on existing tables.

- [ ] **Step 6: Summary commit (if any leftover)**

```bash
git status
# if clean, done. Otherwise stage + commit with descriptive message.
```

---

## Out-of-scope (documented, not blocking Phase 2 ship)

- **Multi-item cart** — current data model has single `productId` per `OnlineOrder`; either iterate N orders per cart or refactor to `OnlineOrderItem` in a later phase
- **Shipping API integration** — Kerry/Flash/J&T real-time rates + label printing; currently static rates + manual tracking #
- **Automated bank-transfer reconciliation** — manual admin review of slip
- **Refund flow** — Phase 2 ships `REFUNDED` status only; admin console + PaySolutions refund API call deferred
- **Cart abandonment email/LINE** — Phase 3 marketing scope
- **Installment apply form** — Phase 3
- **Trade-in / Buyback / ออมดาวน์** — Phase 3
- **Admin UI for online-orders queue** — Phase 2 ships API only; admin uses `curl` / existing web admin can add a page in Phase 3 polish sprint

---

## Dependencies on Owner Actions (from conversation context)

| Owner action | Blocks which task | Workaround if not ready |
|---|---|---|
| `SHOP_STAFF_LINE_ID` env | LINE notify on paid (Task 11) | Code runs; notification silently no-ops — verify and backfill later |
| DNS + Firebase + Cloudflare | Deploy, not build | Build + local testing unaffected |
| PaySolutions sandbox / prod config | Task 7, 9, 22 | Use stub in `createOnlineOrderIntent` that returns a fake `paymentUrl` + hit webhook manually to test |
| GCS bucket for slip uploads | Task 9 step "bank-slip" | Accept any URL in dev; production requires `S3_BUCKET` + signed URL — add in Phase 2 polish if needed |

---

**Plan complete.**
