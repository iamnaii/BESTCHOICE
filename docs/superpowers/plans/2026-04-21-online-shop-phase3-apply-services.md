# Online Shop — Phase 3 (Apply Forms + All Services) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the online shop spec — all 5 services live (installment apply, trade-in, buyback, saving plan) + reviews + admin queue pages + light marketing hooks — so bestchoicephone.app reaches the §7 Phase 3 "LAUNCH" deliverable.

**Architecture:** Reuse existing admin workflows via customer-facing wrapper modules (`shop-installment-apply`, `shop-trade-in`, `shop-buyback`, `shop-saving-plan`, `shop-reviews`). Installment applications flow into existing `ContractsService` pipeline (apply → admin approve → contract create at branch visit). Trade-in/buyback wrap existing `TradeInService` with a `submissionSource='ONLINE'` + `flow='EXCHANGE'|'BUYBACK'` discriminator. Saving plan is fully new (`SavingPlan` + `SavingPlanPayment` models + `@Cron` monthly reminder). Reviews is fully new (`Review` model, verified-purchase gate). Admin web (`apps/web`) gains 4 new queue pages. S3 gets `getSignedUploadUrl()` for direct browser photo upload. Marketing = GA4 + FB Pixel event helpers on web-shop (no backend).

**Tech Stack:** NestJS 11 + Prisma 6 (existing), React 19 + Vite 6 + Tailwind 4 (web-shop), React 18 + Vite 6 + Tailwind + shadcn (web admin), `@nestjs/schedule` cron, GCS/S3 presigned URLs, LINE OA flex messages.

**Spec:** `docs/superpowers/specs/2026-04-20-online-shop-design.md` §7 Phase 3
**Predecessors:** Phase 1 plan (shipped), Phase 2 plan (PR #628 — merged)
**Successors:** Post-launch marketing & optimization (A/B, LIFF-native — out of scope)

**Scope guardrails:**
- ✅ Installment apply = form-only → admin approves → contract created at **branch visit** (no remote contract signing)
- ✅ Trade-in/buyback = 24h admin SLA (no instant auto-quote — needs human review)
- ✅ Saving plan = PromptPay monthly top-up, no auto-debit, no bank-transfer reconciliation (customer pays QR)
- ✅ Reviews = **verified purchase only** (must have `Sale.saleSource='ONLINE'` OR completed contract for that product category)
- ✅ Marketing = event firing only (GA4 + FB Pixel) — NO ad-conversion dashboards, NO segment/retargeting infra
- ❌ NO refund auto-execution (refund status exists → admin manually triggers PaySolutions refund API in follow-up)
- ❌ NO ROI dashboard for admin — reuse existing analytics tables
- ❌ NO A/B testing infra

---

## File Structure

### New backend modules (apps/api)

```
apps/api/src/modules/
├── shop-installment-apply/
│   ├── shop-installment-apply.module.ts
│   ├── shop-installment-apply.controller.ts       # customer: POST /shop/applications
│   ├── shop-installment-apply.admin.controller.ts # admin: list/approve/reject/schedule
│   ├── shop-installment-apply.service.ts
│   ├── shop-installment-apply.service.spec.ts
│   └── dto/
│       ├── create-application.dto.ts
│       ├── schedule-application.dto.ts
│       └── decide-application.dto.ts             # approve/reject body
├── shop-trade-in/
│   ├── shop-trade-in.module.ts
│   ├── shop-trade-in.controller.ts               # customer-facing submit
│   ├── shop-trade-in.service.ts                  # wraps TradeInService
│   ├── shop-trade-in.service.spec.ts
│   └── dto/
│       ├── estimate.dto.ts                        # quick estimate from valuation table
│       └── submit.dto.ts                          # full submission with photos
├── shop-buyback/
│   ├── shop-buyback.module.ts
│   ├── shop-buyback.controller.ts                # customer-facing buyback submit
│   ├── shop-buyback.service.ts                   # wraps TradeInService with flow=BUYBACK
│   ├── shop-buyback.service.spec.ts
│   └── dto/
│       ├── quick-quote.dto.ts                    # instant range from valuation
│       └── submit.dto.ts
├── shop-saving-plan/
│   ├── shop-saving-plan.module.ts
│   ├── shop-saving-plan.controller.ts            # customer: create/list/pay/cancel
│   ├── shop-saving-plan.admin.controller.ts      # admin: list/view
│   ├── shop-saving-plan.service.ts
│   ├── shop-saving-plan.service.spec.ts
│   ├── saving-plan-reminder.cron.ts              # monthly reminder at 09:00 Bangkok
│   └── dto/
│       ├── create-plan.dto.ts
│       └── pay-installment.dto.ts
├── shop-reviews/
│   ├── shop-reviews.module.ts
│   ├── shop-reviews.controller.ts                # public: list; auth: create
│   ├── shop-reviews.admin.controller.ts          # admin: moderate (hide/restore)
│   ├── shop-reviews.service.ts
│   ├── shop-reviews.service.spec.ts
│   └── dto/
│       ├── create-review.dto.ts
│       └── moderate-review.dto.ts
└── shop-cs/
    ├── shop-cs.module.ts
    ├── shop-cs.controller.ts                     # customer: cancel/refund-request/return-request
    ├── shop-cs.service.ts
    └── shop-cs.service.spec.ts
```

### Modified backend

- `apps/api/prisma/schema.prisma` — add `OnlineInstallmentApplication`, `SavingPlan`, `SavingPlanPayment`, `Review` models + `ApplicationStatus` + `SavingPlanStatus` enums; extend `TradeIn` with `submissionSource` + `flow`
- `apps/api/src/modules/storage/storage.service.ts` — add `getSignedUploadUrl(key, contentType, expiresSec)`
- `apps/api/src/modules/storage/storage.controller.ts` — new `POST /shop/upload/signed-url` endpoint
- `apps/api/src/app.module.ts` — register 6 new modules

### New frontend (web-shop)

```
apps/web-shop/src/
├── pages/
│   ├── apply/
│   │   ├── InstallmentApplyPage.tsx
│   │   └── ApplySuccessPage.tsx
│   ├── trade-in/
│   │   ├── TradeInLandingPage.tsx
│   │   ├── TradeInSubmitPage.tsx
│   │   └── TradeInStatusPage.tsx
│   ├── buyback/
│   │   ├── BuybackLandingPage.tsx
│   │   ├── BuybackQuickQuotePage.tsx
│   │   ├── BuybackSubmitPage.tsx
│   │   └── BuybackStatusPage.tsx
│   ├── saving-plan/
│   │   ├── SavingPlanLandingPage.tsx
│   │   ├── SavingPlanCreatePage.tsx
│   │   └── SavingPlanDetailPage.tsx
│   └── account/
│       └── SavingPlansPage.tsx
├── components/
│   ├── device-submit/
│   │   ├── DeviceSelector.tsx                  # brand/model/storage cascade
│   │   ├── DeviceSpecForm.tsx                  # battery, accessories, condition checkboxes
│   │   ├── PhotoUploadGrid.tsx                 # multi-photo via signed-upload
│   │   └── ValuationDisplay.tsx                # min-max range
│   ├── reviews/
│   │   ├── ReviewStars.tsx                     # 5-star rating + display
│   │   ├── ReviewCard.tsx
│   │   ├── ReviewsSection.tsx                  # list + CreateReviewForm
│   │   └── CreateReviewForm.tsx
│   └── saving-plan/
│       ├── PlanCalculator.tsx                  # monthly × duration = target
│       ├── PlanProgressBar.tsx
│       └── PaymentHistoryTable.tsx
├── hooks/
│   ├── useSignedUpload.ts                      # handles signed-URL POST flow
│   └── useTrackEvent.ts                        # FB Pixel + GA4 wrapper
├── lib/
│   └── analytics.ts                            # initGA4, initFbPixel, track helpers
└── types/
    ├── application.ts
    ├── trade-in.ts
    ├── buyback.ts
    ├── saving-plan.ts
    └── review.ts
```

### New frontend (web admin)

```
apps/web/src/pages/
├── OnlineOrdersPage.tsx                        # /online-orders queue (API from Phase 2)
├── InstallmentApplicationsPage.tsx             # /installment-applications queue
├── SavingPlansAdminPage.tsx                    # /saving-plans (read-only overview)
└── ReviewsModerationPage.tsx                   # /reviews (moderate flag/hide)
```

### Modified frontend (web admin)

- `apps/web/src/App.tsx` — 4 new routes
- `apps/web/src/components/layout/AppSidebar.tsx` (or equivalent) — add menu items under "Operations" group
- `apps/web/src/pages/TradeInPage/` — add `submissionSource` filter + "Online" badge row

---

## Task 0: Pre-flight

- [ ] **Step 1: Verify Phase 2 merged + live**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE
git log --oneline main..HEAD | head  # if feature/shop-phase2 still ahead of main, Phase 2 not yet merged
gh pr view 628 --json state,mergedAt
```

Expected: PR #628 `MERGED` or branch is current HEAD. If still open, stop and ask user to merge first.

- [ ] **Step 2: Create Phase 3 worktree**

```bash
git worktree add .worktrees/shop-phase3 -b feature/shop-phase3-apply-services
cd .worktrees/shop-phase3
cp ../../apps/api/.env apps/api/.env 2>/dev/null || true
npm install --no-audit --no-fund
```

- [ ] **Step 3: Verify new modules' targets exist**

```bash
for m in trade-in credit-check contracts line-oa storage shop-auth-social; do
  test -d apps/api/src/modules/$m && echo "$m OK" || echo "$m MISSING"
done
```

Expected: all 6 OK.

- [ ] **Step 4: Baseline types + tests pass**

```bash
./tools/check-types.sh all
cd apps/api && npx jest --silent --testPathPattern='shop-' | tail -5
```

Expected: 0 TS errors, all shop-* suites green.

---

## Task 1: Prisma schema — apply, saving plan, review, trade-in flags

**Files:**
- Modify: `apps/api/prisma/schema.prisma`

- [ ] **Step 1: Add enums near top of file (alongside existing `OnlineOrderStatus`)**

```prisma
enum ApplicationStatus {
  SUBMITTED
  SCHEDULED
  IN_REVIEW
  APPROVED
  CONTRACT_SIGNED
  REJECTED
  NO_SHOW
  EXPIRED
  CANCELLED
}

enum SavingPlanStatus {
  ACTIVE
  COMPLETED
  APPLIED
  CANCELLED
}

enum TradeInSubmissionSource {
  OFFLINE
  ONLINE
}

enum TradeInFlow {
  EXCHANGE
  BUYBACK
}

enum ReviewStatus {
  PUBLISHED
  HIDDEN
  FLAGGED
}
```

- [ ] **Step 2: Add `OnlineInstallmentApplication` model after `OnlineOrder`**

```prisma
model OnlineInstallmentApplication {
  id                     String              @id @default(uuid())
  applicationNumber      String              @unique @map("application_number")
  customerId             String?             @map("customer_id")
  customer               Customer?           @relation(fields: [customerId], references: [id])
  productId              String              @map("product_id")
  product                Product             @relation(fields: [productId], references: [id])
  reservationId          String?             @map("reservation_id")
  reservation            ProductReservation? @relation("ApplicationReservation", fields: [reservationId], references: [id])

  fullName               String              @map("full_name")
  phone                  String
  nationalId             String              @map("national_id")

  proposedDownPayment    Decimal             @map("proposed_down_payment") @db.Decimal(12, 2)
  proposedTotalMonths    Int                 @map("proposed_total_months")
  proposedMonthlyPayment Decimal             @map("proposed_monthly_payment") @db.Decimal(12, 2)

  lineUserId             String?             @map("line_user_id")
  notes                  String?             @db.Text

  status                 ApplicationStatus   @default(SUBMITTED)
  scheduledAt            DateTime?           @map("scheduled_at")
  reviewedAt             DateTime?           @map("reviewed_at")
  reviewedById           String?             @map("reviewed_by_id")
  rejectReason           String?             @map("reject_reason")
  contractId             String?             @unique @map("contract_id")
  contract               Contract?           @relation(fields: [contractId], references: [id])

  createdAt              DateTime            @default(now()) @map("created_at")
  updatedAt              DateTime            @updatedAt @map("updated_at")
  deletedAt              DateTime?           @map("deleted_at")

  @@index([phone])
  @@index([status])
  @@index([customerId])
  @@index([createdAt])
  @@map("online_installment_applications")
}
```

- [ ] **Step 3: Add `SavingPlan` + `SavingPlanPayment` models**

```prisma
model SavingPlan {
  id                  String              @id @default(uuid())
  planNumber          String              @unique @map("plan_number")
  customerId          String              @map("customer_id")
  customer            Customer            @relation(fields: [customerId], references: [id])

  targetProductModel  String?             @map("target_product_model")
  targetProductId     String?             @map("target_product_id")
  targetProduct       Product?            @relation(fields: [targetProductId], references: [id])
  targetAmount        Decimal             @map("target_amount") @db.Decimal(12, 2)

  monthlyAmount       Decimal             @map("monthly_amount") @db.Decimal(12, 2)
  durationMonths      Int                 @map("duration_months")
  totalSaved          Decimal             @default(0) @map("total_saved") @db.Decimal(12, 2)

  status              SavingPlanStatus    @default(ACTIVE)
  startedAt           DateTime            @map("started_at")
  nextPaymentDueAt    DateTime?           @map("next_payment_due_at")
  completedAt         DateTime?           @map("completed_at")
  cancelledAt         DateTime?           @map("cancelled_at")
  appliedToContractId String?             @map("applied_to_contract_id")

  createdAt           DateTime            @default(now()) @map("created_at")
  updatedAt           DateTime            @updatedAt @map("updated_at")
  deletedAt           DateTime?           @map("deleted_at")

  payments            SavingPlanPayment[]

  @@index([customerId])
  @@index([status])
  @@index([nextPaymentDueAt])
  @@map("saving_plans")
}

model SavingPlanPayment {
  id            String      @id @default(uuid())
  savingPlanId  String      @map("saving_plan_id")
  savingPlan    SavingPlan  @relation(fields: [savingPlanId], references: [id])
  amount        Decimal     @db.Decimal(12, 2)
  paidAt        DateTime    @map("paid_at")
  paymentMethod String      @map("payment_method")
  paymentRef    String?     @map("payment_ref")
  paymentLinkId String?     @unique @map("payment_link_id")
  createdAt     DateTime    @default(now()) @map("created_at")

  @@index([savingPlanId])
  @@index([paidAt])
  @@map("saving_plan_payments")
}
```

- [ ] **Step 4: Add `Review` model**

```prisma
model Review {
  id             String       @id @default(uuid())
  productId      String       @map("product_id")
  product        Product      @relation(fields: [productId], references: [id])
  customerId     String       @map("customer_id")
  customer       Customer     @relation(fields: [customerId], references: [id])

  rating         Int          // 1..5
  title          String?
  comment        String?      @db.Text
  verified       Boolean      @default(false)
  verifiedSource String?      @map("verified_source") // e.g., saleId/contractId

  status         ReviewStatus @default(PUBLISHED)
  hiddenReason   String?      @map("hidden_reason")
  moderatedById  String?      @map("moderated_by_id")
  moderatedAt    DateTime?    @map("moderated_at")

  createdAt      DateTime     @default(now()) @map("created_at")
  updatedAt      DateTime     @updatedAt @map("updated_at")
  deletedAt      DateTime?    @map("deleted_at")

  @@index([productId, status])
  @@index([customerId])
  @@unique([productId, customerId])
  @@map("reviews")
}
```

- [ ] **Step 5: Extend `TradeIn` model**

Find `model TradeIn {` — add near top of scalar fields:

```prisma
  submissionSource TradeInSubmissionSource @default(OFFLINE) @map("submission_source")
  flow             TradeInFlow             @default(EXCHANGE) @map("flow")
  customerNotes    String?                 @map("customer_notes") @db.Text
  customerLineId   String?                 @map("customer_line_id")
```

Add index: `@@index([submissionSource, status])`

- [ ] **Step 6: Add back-relations to existing models**

In `model Customer {`, add:
```prisma
  savingPlans               SavingPlan[]
  reviews                   Review[]
  onlineApplications        OnlineInstallmentApplication[]
```

In `model Product {`, add:
```prisma
  savingPlansTargetingThis  SavingPlan[]
  reviews                   Review[]
  onlineApplications        OnlineInstallmentApplication[]
```

In `model ProductReservation {`, add:
```prisma
  application ApplicationReservation? @relation("ApplicationReservation")
```

(If Prisma complains about optional back relation naming — use `onlineApplication OnlineInstallmentApplication?` without the `@relation` name and match the forward side too.)

In `model Contract {`, add:
```prisma
  onlineApplication OnlineInstallmentApplication?
```

- [ ] **Step 7: Generate + apply migration**

```bash
cd apps/api
npx prisma migrate dev --name add_apply_saving_review_phase3 --create-only
# Review SQL for: no DROPs, no required cols without defaults on existing tables
```

If migrate dev fails due to pre-existing dev DB drift, fall back to:
```bash
npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --script > prisma/migrations/$(date +%Y%m%d%H%M%S)_add_apply_saving_review_phase3/migration.sql
npx prisma db execute --file <that-file>
npx prisma migrate resolve --applied <dir-name>
```

- [ ] **Step 8: Regenerate + type check + commit**

```bash
cd apps/api && npx prisma generate
cd ../.. && ./tools/check-types.sh api
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/
git commit -m "feat(shop-phase3): add application/saving/review models + TradeIn flow flags"
```

---

## Task 2: `shop-installment-apply` — customer submission

**Files:**
- Create: full module under `apps/api/src/modules/shop-installment-apply/`

- [ ] **Step 1: DTOs**

`dto/create-application.dto.ts`:
```typescript
import { IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, Max, Min } from 'class-validator';

export class CreateApplicationDto {
  @IsUUID() productId!: string;
  @IsOptional() @IsUUID() reservationId?: string;

  @IsString() @IsNotEmpty() fullName!: string;
  @IsString() @Matches(/^0\d{9}$/, { message: 'เบอร์โทร 10 หลัก' }) phone!: string;
  @IsString() @Matches(/^\d{13}$/, { message: 'เลขบัตรประชาชน 13 หลัก' }) nationalId!: string;

  @IsInt() @Min(0) proposedDownPayment!: number;
  @IsInt() @Min(3) @Max(12) proposedTotalMonths!: number;

  @IsOptional() @IsString() lineUserId?: string;
  @IsOptional() @IsString() notes?: string;
}
```

- [ ] **Step 2: Service — write failing spec**

`shop-installment-apply.service.spec.ts`:
```typescript
import { Test } from '@nestjs/testing';
import { ShopInstallmentApplyService } from './shop-installment-apply.service';
import { PrismaService } from '../../prisma/prisma.service';
import { LineOaService } from '../line-oa/line-oa.service';

const prismaMock: any = {
  product: { findUnique: jest.fn() },
  onlineInstallmentApplication: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), findMany: jest.fn(), findUnique: jest.fn() },
};
const lineMock: any = { sendFlexMessage: jest.fn() };

describe('ShopInstallmentApplyService', () => {
  let service: ShopInstallmentApplyService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const mod = await Test.createTestingModule({
      providers: [
        ShopInstallmentApplyService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: LineOaService, useValue: lineMock },
      ],
    }).compile();
    service = mod.get(ShopInstallmentApplyService);
  });

  it('computes monthly payment correctly and creates SUBMITTED application', async () => {
    prismaMock.product.findUnique.mockResolvedValue({ id: 'p1', costPrice: 12000, deletedAt: null });
    prismaMock.onlineInstallmentApplication.findFirst.mockResolvedValue(null);
    prismaMock.onlineInstallmentApplication.create.mockResolvedValue({
      id: 'app1', applicationNumber: 'APP-260421-1', status: 'SUBMITTED',
    });
    const res = await service.submit(
      {
        productId: 'p1', fullName: 'บีม', phone: '0812345678', nationalId: '1234567890123',
        proposedDownPayment: 2000, proposedTotalMonths: 12,
      } as any,
      undefined,
    );
    expect(res.applicationNumber).toMatch(/^APP-/);
    const createArgs = prismaMock.onlineInstallmentApplication.create.mock.calls[0][0];
    expect(createArgs.data.proposedMonthlyPayment).toBeGreaterThan(0);
  });

  it('rejects duplicate active applications for same phone+product', async () => {
    prismaMock.product.findUnique.mockResolvedValue({ id: 'p1', costPrice: 12000, deletedAt: null });
    prismaMock.onlineInstallmentApplication.findFirst.mockResolvedValue({ id: 'dup', status: 'SUBMITTED' });
    await expect(
      service.submit(
        { productId: 'p1', fullName: 'บีม', phone: '0812345678', nationalId: '1234567890123',
          proposedDownPayment: 2000, proposedTotalMonths: 12 } as any,
        undefined,
      ),
    ).rejects.toThrow(/ใบสมัคร/);
  });
});
```

- [ ] **Step 3: Service implementation**

`shop-installment-apply.service.ts`:
```typescript
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LineOaService } from '../line-oa/line-oa.service';
import { CreateApplicationDto } from './dto/create-application.dto';

// Flat-rate interest approximation used for storefront estimate.
// Real rates come from InterestConfig at admin approval time.
const DEFAULT_INTEREST_MONTHLY = 0.013; // ~1.3% monthly flat

@Injectable()
export class ShopInstallmentApplyService {
  constructor(private prisma: PrismaService, private line: LineOaService) {}

  async submit(dto: CreateApplicationDto, customerId: string | undefined) {
    const product = await this.prisma.product.findUnique({ where: { id: dto.productId } });
    if (!product || product.deletedAt) throw new NotFoundException('ไม่พบสินค้า');

    const duplicate = await this.prisma.onlineInstallmentApplication.findFirst({
      where: {
        productId: dto.productId,
        phone: dto.phone,
        status: { in: ['SUBMITTED', 'SCHEDULED', 'IN_REVIEW', 'APPROVED'] },
        deletedAt: null,
      },
    });
    if (duplicate) throw new BadRequestException('มีใบสมัครของท่านอยู่แล้ว ทีมงานจะติดต่อกลับ');

    const price = Number(product.costPrice);
    const financed = Math.max(0, price - dto.proposedDownPayment);
    const interestTotal = financed * DEFAULT_INTEREST_MONTHLY * dto.proposedTotalMonths;
    const monthly = Math.ceil((financed + interestTotal) / dto.proposedTotalMonths);

    const now = new Date();
    const applicationNumber = `APP-${now.getFullYear().toString().slice(-2)}${(now.getMonth() + 1).toString().padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}-${Math.floor(100 + Math.random() * 900)}`;

    const app = await this.prisma.onlineInstallmentApplication.create({
      data: {
        applicationNumber,
        customerId,
        productId: dto.productId,
        reservationId: dto.reservationId,
        fullName: dto.fullName,
        phone: dto.phone,
        nationalId: dto.nationalId,
        proposedDownPayment: dto.proposedDownPayment,
        proposedTotalMonths: dto.proposedTotalMonths,
        proposedMonthlyPayment: monthly,
        lineUserId: dto.lineUserId,
        notes: dto.notes,
        status: 'SUBMITTED',
      },
    });

    if (dto.lineUserId) {
      try {
        await this.line.sendFlexMessage(dto.lineUserId, this.buildSubmittedFlex(app.applicationNumber));
      } catch (e) {
        // non-fatal — staff will follow up by phone
      }
    }
    return { applicationNumber: app.applicationNumber, id: app.id, proposedMonthlyPayment: monthly };
  }

  private buildSubmittedFlex(applicationNumber: string): Record<string, unknown> {
    return {
      type: 'flex',
      altText: `ใบสมัครผ่อน ${applicationNumber} ได้รับแล้ว`,
      contents: {
        type: 'bubble',
        body: {
          type: 'box', layout: 'vertical', contents: [
            { type: 'text', text: 'บันทึกใบสมัครแล้ว', weight: 'bold', size: 'lg' },
            { type: 'text', text: applicationNumber, margin: 'md' },
            { type: 'text', text: 'ทีมงานจะติดต่อกลับภายใน 2 ชั่วโมง (เวลาทำการ)', size: 'xs', color: '#888888', margin: 'md', wrap: true },
          ],
        },
      },
    };
  }

  async getByNumber(applicationNumber: string, customerId: string | undefined) {
    const app = await this.prisma.onlineInstallmentApplication.findUnique({
      where: { applicationNumber },
      include: { product: { select: { id: true, name: true, gallery: true } } },
    });
    if (!app) throw new NotFoundException('ไม่พบใบสมัคร');
    if (customerId && app.customerId && app.customerId !== customerId) {
      throw new NotFoundException('ไม่พบใบสมัคร');
    }
    return app;
  }

  async listMine(customerId: string) {
    return this.prisma.onlineInstallmentApplication.findMany({
      where: { customerId, deletedAt: null },
      include: { product: { select: { name: true, gallery: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }
}
```

- [ ] **Step 4: Controller (customer-facing)**

`shop-installment-apply.controller.ts`:
```typescript
import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ShopInstallmentApplyService } from './shop-installment-apply.service';
import { CreateApplicationDto } from './dto/create-application.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('shop/applications')
export class ShopInstallmentApplyController {
  constructor(private service: ShopInstallmentApplyService) {}

  @Post()
  // Intentionally public — applications accept unauthenticated submissions so new
  // customers without LINE binding can apply. lineUserId is optional and opt-in.
  submit(@Body() dto: CreateApplicationDto, @Req() req: any) {
    const customerId = req.user?.sub as string | undefined;
    return this.service.submit(dto, customerId);
  }

  @Get('mine')
  @UseGuards(JwtAuthGuard)
  listMine(@Req() req: { user: { sub: string } }) {
    return this.service.listMine(req.user.sub);
  }

  @Get(':applicationNumber')
  get(@Param('applicationNumber') n: string, @Req() req: any) {
    return this.service.getByNumber(n, req.user?.sub as string | undefined);
  }
}
```

- [ ] **Step 5: Module + register**

`shop-installment-apply.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { ShopInstallmentApplyController } from './shop-installment-apply.controller';
import { ShopInstallmentApplyService } from './shop-installment-apply.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { LineOaModule } from '../line-oa/line-oa.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [PrismaModule, LineOaModule, AuthModule],
  controllers: [ShopInstallmentApplyController],
  providers: [ShopInstallmentApplyService],
  exports: [ShopInstallmentApplyService],
})
export class ShopInstallmentApplyModule {}
```

Register in `apps/api/src/app.module.ts`.

- [ ] **Step 6: Run spec + commit**

```bash
cd apps/api && npx jest shop-installment-apply
./tools/check-types.sh api
git add apps/api/src/modules/shop-installment-apply apps/api/src/app.module.ts
git commit -m "feat(shop-phase3): shop-installment-apply module (customer submission)"
```

---

## Task 3: `shop-installment-apply` — admin queue + decide

**Files:**
- Create: `apps/api/src/modules/shop-installment-apply/shop-installment-apply.admin.controller.ts`
- Create: `apps/api/src/modules/shop-installment-apply/dto/schedule-application.dto.ts`
- Create: `apps/api/src/modules/shop-installment-apply/dto/decide-application.dto.ts`
- Modify: service (add admin methods)
- Modify: module (register admin controller)

- [ ] **Step 1: Admin DTOs**

`schedule-application.dto.ts`:
```typescript
import { IsDateString } from 'class-validator';
export class ScheduleApplicationDto { @IsDateString() scheduledAt!: string; }
```

`decide-application.dto.ts`:
```typescript
import { IsOptional, IsString } from 'class-validator';
export class DecideApplicationDto {
  @IsOptional() @IsString() rejectReason?: string;
  @IsOptional() @IsString() contractId?: string; // set when transitioning to CONTRACT_SIGNED
}
```

- [ ] **Step 2: Admin service methods — append to `ShopInstallmentApplyService`**

```typescript
  async adminList(status?: string) {
    return this.prisma.onlineInstallmentApplication.findMany({
      where: { deletedAt: null, ...(status ? { status: status as any } : {}) },
      include: {
        product: { select: { name: true, gallery: true, conditionGrade: true } },
        customer: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async schedule(id: string, scheduledAt: Date, reviewerId: string) {
    return this.prisma.onlineInstallmentApplication.update({
      where: { id },
      data: { status: 'SCHEDULED', scheduledAt, reviewedById: reviewerId, reviewedAt: new Date() },
    });
  }

  async approve(id: string, reviewerId: string) {
    return this.prisma.onlineInstallmentApplication.update({
      where: { id },
      data: { status: 'APPROVED', reviewedById: reviewerId, reviewedAt: new Date() },
    });
  }

  async reject(id: string, reviewerId: string, reason: string) {
    const app = await this.prisma.onlineInstallmentApplication.update({
      where: { id },
      data: { status: 'REJECTED', reviewedById: reviewerId, reviewedAt: new Date(), rejectReason: reason },
    });
    if (app.lineUserId) {
      try {
        await this.line.sendFlexMessage(app.lineUserId, this.buildRejectedFlex(app.applicationNumber, reason));
      } catch {}
    }
    return app;
  }

  async linkContract(id: string, contractId: string) {
    return this.prisma.onlineInstallmentApplication.update({
      where: { id },
      data: { status: 'CONTRACT_SIGNED', contractId },
    });
  }

  private buildRejectedFlex(applicationNumber: string, reason: string): Record<string, unknown> {
    return {
      type: 'flex',
      altText: `ใบสมัคร ${applicationNumber} ไม่ผ่านการอนุมัติ`,
      contents: {
        type: 'bubble',
        body: {
          type: 'box', layout: 'vertical', contents: [
            { type: 'text', text: 'ใบสมัครไม่ผ่านการอนุมัติ', weight: 'bold', size: 'lg' },
            { type: 'text', text: applicationNumber, margin: 'md' },
            { type: 'text', text: reason, size: 'sm', color: '#888888', margin: 'md', wrap: true },
          ],
        },
      },
    };
  }
```

- [ ] **Step 3: Admin controller**

```typescript
// shop-installment-apply.admin.controller.ts
import { Body, Controller, Get, Param, Patch, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ShopInstallmentApplyService } from './shop-installment-apply.service';
import { ScheduleApplicationDto } from './dto/schedule-application.dto';
import { DecideApplicationDto } from './dto/decide-application.dto';

@Controller('admin/installment-applications')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
export class ShopInstallmentApplyAdminController {
  constructor(private service: ShopInstallmentApplyService) {}

  @Get()
  list(@Query('status') status?: string) { return this.service.adminList(status); }

  @Patch(':id/schedule')
  schedule(@Param('id') id: string, @Body() dto: ScheduleApplicationDto, @Req() req: { user: { id: string } }) {
    return this.service.schedule(id, new Date(dto.scheduledAt), req.user.id);
  }

  @Patch(':id/approve')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER')
  approve(@Param('id') id: string, @Req() req: { user: { id: string } }) {
    return this.service.approve(id, req.user.id);
  }

  @Patch(':id/reject')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER')
  reject(@Param('id') id: string, @Body() dto: DecideApplicationDto, @Req() req: { user: { id: string } }) {
    return this.service.reject(id, req.user.id, dto.rejectReason ?? '');
  }

  @Patch(':id/link-contract')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER')
  linkContract(@Param('id') id: string, @Body() dto: DecideApplicationDto) {
    if (!dto.contractId) throw new Error('contractId required');
    return this.service.linkContract(id, dto.contractId);
  }
}
```

- [ ] **Step 4: Register admin controller in module + commit**

Add to `controllers: [...]` array.

```bash
./tools/check-types.sh api
git add apps/api/src/modules/shop-installment-apply
git commit -m "feat(shop-phase3): admin installment-application controller (schedule/approve/reject/link)"
```

---

## Task 4: S3 signed upload URL helper

**Files:**
- Modify: `apps/api/src/modules/storage/storage.service.ts` — add `getSignedUploadUrl()`
- Create: `apps/api/src/modules/storage/shop-upload.controller.ts`
- Modify: `apps/api/src/modules/storage/storage.module.ts`

- [ ] **Step 1: Add service method**

At the end of `StorageService`:
```typescript
  async getSignedUploadUrl(key: string, contentType: string, expiresSec = 600): Promise<{ url: string; method: 'PUT' }> {
    if (this.backend === 'gcs') {
      const file = this.gcsBucket.file(key);
      const [url] = await file.getSignedUrl({
        action: 'write',
        version: 'v4',
        expires: Date.now() + expiresSec * 1000,
        contentType,
      });
      return { url, method: 'PUT' };
    }
    // S3-compatible
    const { GetSignedUrlCommand } = await import('@aws-sdk/s3-request-presigner');
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    const cmd = new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType });
    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
    const url = await getSignedUrl(this.s3, cmd, { expiresIn: expiresSec });
    return { url, method: 'PUT' };
  }
```

> Adjust imports to actual implementation style of `StorageService` — if it already has `s3: S3Client` and `import { PutObjectCommand } from '@aws-sdk/client-s3'` at the top, use those directly without dynamic `import()`.

- [ ] **Step 2: Upload controller**

`shop-upload.controller.ts`:
```typescript
import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { StorageService } from './storage.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { randomUUID } from 'crypto';

enum UploadKind {
  TRADE_IN_PHOTO = 'TRADE_IN_PHOTO',
  BUYBACK_PHOTO = 'BUYBACK_PHOTO',
  BANK_SLIP = 'BANK_SLIP',
  REVIEW_PHOTO = 'REVIEW_PHOTO',
}

class PresignedUploadDto {
  @IsEnum(UploadKind) kind!: UploadKind;
  @IsString() @IsNotEmpty() contentType!: string; // "image/jpeg" etc
}

@Controller('shop/upload')
@UseGuards(JwtAuthGuard)
export class ShopUploadController {
  constructor(private storage: StorageService) {}

  @Post('signed-url')
  async presign(@Body() dto: PresignedUploadDto) {
    const ext = dto.contentType === 'image/png' ? 'png' : 'jpg';
    const key = `shop/${dto.kind.toLowerCase()}/${new Date().toISOString().slice(0, 10)}/${randomUUID()}.${ext}`;
    const signed = await this.storage.getSignedUploadUrl(key, dto.contentType);
    return { uploadUrl: signed.url, method: signed.method, key, publicUrl: await this.storage.getPublicUrl(key) };
  }
}
```

> If `StorageService` doesn't yet have `getPublicUrl(key)`, either add a trivial helper that returns the GCS/S3 canonical URL or return just the `key` and let callers derive the URL later.

- [ ] **Step 3: Register controller + AuthModule import in storage.module**

Add `ShopUploadController` to controllers, `AuthModule` to imports.

- [ ] **Step 4: Verify + commit**

```bash
./tools/check-types.sh api
git add apps/api/src/modules/storage
git commit -m "feat(shop-phase3): storage.getSignedUploadUrl + /api/shop/upload/signed-url endpoint"
```

---

## Task 5: `shop-trade-in` — customer online submission

**Files:**
- Create: `apps/api/src/modules/shop-trade-in/` full module

- [ ] **Step 1: DTOs**

`dto/estimate.dto.ts`:
```typescript
import { IsIn, IsString } from 'class-validator';

export class EstimateDto {
  @IsString() brand!: string;
  @IsString() model!: string;
  @IsString() storage!: string;
  @IsIn(['A', 'B', 'C']) condition!: 'A' | 'B' | 'C';
}
```

`dto/submit.dto.ts`:
```typescript
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

export class SubmitTradeInDto {
  @IsString() brand!: string;
  @IsString() model!: string;
  @IsString() storage!: string;
  @IsIn(['A', 'B', 'C']) condition!: 'A' | 'B' | 'C';
  @IsInt() @Min(0) @Max(100) batteryHealth!: number;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(8) @IsString({ each: true }) photoUrls!: string[];
  @IsOptional() @IsString() imei?: string;
  @IsOptional() @IsString() notes?: string;

  @IsString() sellerName!: string;
  @IsString() @Matches(/^0\d{9}$/, { message: 'เบอร์โทร 10 หลัก' }) sellerPhone!: string;
  @IsOptional() @IsString() lineUserId?: string;

  // Optional — customer selects a target product they want to put this toward
  @IsOptional() @IsString() targetProductId?: string;
}
```

- [ ] **Step 2: Service**

`shop-trade-in.service.ts`:
```typescript
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LineOaService } from '../line-oa/line-oa.service';
import { EstimateDto } from './dto/estimate.dto';
import { SubmitTradeInDto } from './dto/submit.dto';

@Injectable()
export class ShopTradeInService {
  constructor(private prisma: PrismaService, private line: LineOaService) {}

  async estimate(dto: EstimateDto) {
    const v = await this.prisma.tradeInValuation.findUnique({
      where: { brand_model_storage_condition: { brand: dto.brand, model: dto.model, storage: dto.storage, condition: dto.condition } },
    });
    if (!v) return { min: 0, max: 0, available: false };
    const base = Number(v.basePrice);
    return { min: Math.floor(base * 0.85), max: Math.ceil(base * 1.05), available: true, basePrice: base };
  }

  async submit(dto: SubmitTradeInDto, customerId: string | undefined) {
    // Dedup by phone+imei within 24h
    if (dto.imei) {
      const dup = await this.prisma.tradeIn.findFirst({
        where: { imei: dto.imei, createdAt: { gt: new Date(Date.now() - 24 * 3600_000) }, deletedAt: null },
      });
      if (dup) throw new BadRequestException('เครื่องนี้อยู่ระหว่างประเมินราคาแล้ว');
    }
    const valuation = await this.prisma.tradeInValuation.findUnique({
      where: { brand_model_storage_condition: { brand: dto.brand, model: dto.model, storage: dto.storage, condition: dto.condition } },
    });
    if (!valuation) throw new NotFoundException('ไม่พบข้อมูลราคาประเมินสำหรับรุ่นนี้');

    const tradeIn = await this.prisma.tradeIn.create({
      data: {
        submissionSource: 'ONLINE',
        flow: 'EXCHANGE',
        status: 'PENDING_APPRAISAL',
        deviceBrand: dto.brand,
        deviceModel: dto.model,
        deviceStorage: dto.storage,
        deviceCondition: dto.condition,
        batteryHealth: dto.batteryHealth,
        imei: dto.imei,
        photoUrls: dto.photoUrls,
        customerNotes: dto.notes,
        customerLineId: dto.lineUserId,
        sellerName: dto.sellerName,
        sellerPhone: dto.sellerPhone,
        valuationId: valuation.id,
        basePriceAtAppraisal: valuation.basePrice,
        customerId,
      } as any,
    });

    if (dto.lineUserId) {
      try {
        await this.line.sendFlexMessage(dto.lineUserId, this.buildSubmittedFlex(tradeIn.id));
      } catch {}
    }
    return { id: tradeIn.id, status: tradeIn.status, etaHours: 24 };
  }

  async getStatus(id: string) {
    const t = await this.prisma.tradeIn.findUnique({
      where: { id },
      select: {
        id: true, status: true, offeredPrice: true, agreedPrice: true, photoUrls: true,
        deviceBrand: true, deviceModel: true, deviceStorage: true, deviceCondition: true,
        batteryHealth: true, flow: true, submissionSource: true, createdAt: true,
      },
    });
    if (!t) throw new NotFoundException('ไม่พบคำขอ');
    return t;
  }

  private buildSubmittedFlex(id: string): Record<string, unknown> {
    return {
      type: 'flex',
      altText: 'รับเรื่องเก่าแลกใหม่แล้ว',
      contents: { type: 'bubble', body: { type: 'box', layout: 'vertical', contents: [
        { type: 'text', text: 'รับเรื่องเก่าแลกใหม่', weight: 'bold', size: 'lg' },
        { type: 'text', text: `รหัส ${id.slice(0, 8).toUpperCase()}`, margin: 'md' },
        { type: 'text', text: 'ราคาเสนอภายใน 24 ชั่วโมง', size: 'xs', color: '#888888', margin: 'md' },
      ]}},
    };
  }
}
```

- [ ] **Step 3: Controller + Module + register + commit**

`shop-trade-in.controller.ts`:
```typescript
import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ShopTradeInService } from './shop-trade-in.service';
import { EstimateDto } from './dto/estimate.dto';
import { SubmitTradeInDto } from './dto/submit.dto';
import { ShopBotDefenseGuard } from '../shop-bot-defense/shop-bot-defense.guard';

@Controller('shop/trade-in')
@UseGuards(ShopBotDefenseGuard)
export class ShopTradeInController {
  constructor(private service: ShopTradeInService) {}

  @Post('estimate')
  estimate(@Body() dto: EstimateDto) { return this.service.estimate(dto); }

  @Post('submit')
  submit(@Body() dto: SubmitTradeInDto, @Req() req: any) {
    return this.service.submit(dto, req.user?.sub as string | undefined);
  }

  @Get(':id')
  getStatus(@Param('id') id: string) { return this.service.getStatus(id); }
}
```

`shop-trade-in.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { ShopTradeInController } from './shop-trade-in.controller';
import { ShopTradeInService } from './shop-trade-in.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { LineOaModule } from '../line-oa/line-oa.module';

@Module({
  imports: [PrismaModule, LineOaModule],
  controllers: [ShopTradeInController],
  providers: [ShopTradeInService],
  exports: [ShopTradeInService],
})
export class ShopTradeInModule {}
```

Register in `app.module.ts`. Type check. Commit:
```
feat(shop-phase3): shop-trade-in module (customer online submission + estimate)
```

---

## Task 6: `shop-buyback` — customer buyback submission

**Files:** `apps/api/src/modules/shop-buyback/` full module. Identical pattern to Task 5 except:
- `flow: 'BUYBACK'` (no `targetProductId`)
- Quick-quote endpoint uses same `TradeInValuation` table but applies different margin (buyback pays less cash-out vs exchange): `min = base * 0.80`, `max = base * 0.95`
- Reuses `estimate` structure

- [ ] **Step 1: Write quick-quote DTO**

`dto/quick-quote.dto.ts` — same shape as `EstimateDto` in Task 5.

- [ ] **Step 2: Implement service with BUYBACK margin**

Copy the Task 5 service structure to `shop-buyback.service.ts`. Changes:
- `flow: 'BUYBACK'`
- In `estimate()`: `min = Math.floor(base * 0.80); max = Math.ceil(base * 0.95);`
- Omit `targetProductId` logic — pure cash buyback has no target product

- [ ] **Step 3: Controller at `@Controller('shop/buyback')`**

Three endpoints: `POST /quick-quote`, `POST /submit`, `GET /:id`. Mirror Task 5.

- [ ] **Step 4: Module + register + commit**

Commit: `feat(shop-phase3): shop-buyback module (customer cash-out flow)`

---

## Task 7: Trade-In admin extension — filter ONLINE submissions

**Files:**
- Modify: `apps/api/src/modules/trade-in/trade-in.service.ts` — `findAll()` accepts `submissionSource?`, `flow?` query filters
- Modify: `apps/api/src/modules/trade-in/trade-in.controller.ts` — pass new query params

- [ ] **Step 1: Add filter to existing `findAll`**

Find the `findAll` method. In its `where` clause, OR the existing one:
```typescript
  where: {
    deletedAt: null,
    ...(query.status ? { status: query.status as any } : {}),
    ...(query.submissionSource ? { submissionSource: query.submissionSource as any } : {}),
    ...(query.flow ? { flow: query.flow as any } : {}),
  },
```

Controller: add `@Query('submissionSource') submissionSource?: string`, `@Query('flow') flow?: string` and pass through.

- [ ] **Step 2: Type check + commit**

```
feat(shop-phase3): trade-in admin listing supports submissionSource/flow filters
```

---

## Task 8: `shop-saving-plan` — create + pay + cancel

**Files:**
- Create: `apps/api/src/modules/shop-saving-plan/` full module

- [ ] **Step 1: DTOs**

`dto/create-plan.dto.ts`:
```typescript
import { IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

export class CreatePlanDto {
  @IsOptional() @IsUUID() targetProductId?: string;
  @IsOptional() @IsString() targetProductModel?: string;
  @IsInt() @Min(1000) targetAmount!: number;
  @IsInt() @Min(500) monthlyAmount!: number;
  @IsInt() @Min(2) @Max(12) durationMonths!: number;
}
```

`dto/pay-installment.dto.ts`:
```typescript
import { IsInt, Min } from 'class-validator';
export class PayInstallmentDto { @IsInt() @Min(100) amount!: number; }
```

- [ ] **Step 2: Service** — includes plan creation, payment (via PromptPay PaymentLink), cancel, and `listDueReminders()` for the cron.

`shop-saving-plan.service.ts`:
```typescript
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PaySolutionsService } from '../paysolutions/paysolutions.service';
import { LineOaService } from '../line-oa/line-oa.service';
import { CreatePlanDto } from './dto/create-plan.dto';

@Injectable()
export class ShopSavingPlanService {
  constructor(
    private prisma: PrismaService,
    private paysolutions: PaySolutionsService,
    private line: LineOaService,
  ) {}

  async create(dto: CreatePlanDto, customerId: string) {
    if (dto.monthlyAmount * dto.durationMonths < dto.targetAmount) {
      throw new BadRequestException('ยอดออมรวมต้องไม่น้อยกว่าเป้าหมาย');
    }
    const now = new Date();
    const nextDue = new Date(now);
    nextDue.setMonth(nextDue.getMonth() + 1);
    const planNumber = `SV-${now.getFullYear().toString().slice(-2)}${(now.getMonth() + 1).toString().padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}-${Math.floor(100 + Math.random() * 900)}`;
    return this.prisma.savingPlan.create({
      data: {
        planNumber, customerId,
        targetProductId: dto.targetProductId, targetProductModel: dto.targetProductModel,
        targetAmount: dto.targetAmount, monthlyAmount: dto.monthlyAmount,
        durationMonths: dto.durationMonths,
        startedAt: now, nextPaymentDueAt: nextDue, status: 'ACTIVE',
      },
    });
  }

  async listMine(customerId: string) {
    return this.prisma.savingPlan.findMany({
      where: { customerId, deletedAt: null },
      include: { payments: { orderBy: { paidAt: 'desc' }, take: 20 } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(id: string, customerId: string) {
    const p = await this.prisma.savingPlan.findUnique({
      where: { id },
      include: { payments: { orderBy: { paidAt: 'desc' } } },
    });
    if (!p || p.customerId !== customerId) throw new NotFoundException('ไม่พบแผนออม');
    return p;
  }

  async createPaymentIntent(id: string, amount: number, customerId: string) {
    const plan = await this.get(id, customerId);
    if (plan.status !== 'ACTIVE') throw new BadRequestException('แผนนี้ไม่เปิดรับชำระแล้ว');
    // Reuse PaySolutions pattern — the same createOnlineOrderIntent requires an onlineOrderId.
    // For saving plans we create a plain PaymentLink with contractId+onlineOrderId both null,
    // flagged via metadata-style prefix in the token.
    const intent = await (this.paysolutions as any).createSavingPlanIntent({
      savingPlanId: plan.id,
      amount,
      description: `ออมดาวน์ ${plan.planNumber}`,
    });
    return intent;
  }

  async cancel(id: string, customerId: string) {
    const plan = await this.get(id, customerId);
    if (plan.status !== 'ACTIVE') throw new BadRequestException('ยกเลิกไม่ได้');
    return this.prisma.savingPlan.update({
      where: { id },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });
  }

  async listDueReminders(now = new Date()) {
    const to = new Date(now.getTime() + 24 * 3600_000);
    return this.prisma.savingPlan.findMany({
      where: { status: 'ACTIVE', nextPaymentDueAt: { lte: to, gte: new Date(now.getTime() - 2 * 3600_000) }, deletedAt: null },
      include: { customer: { select: { lineId: true, name: true } } },
    });
  }
}
```

> `createSavingPlanIntent` is added to PaySolutionsService in Task 10. Until then keep the `as any` cast.

- [ ] **Step 3: Controller**

```typescript
// shop-saving-plan.controller.ts
import { Body, Controller, Delete, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ShopSavingPlanService } from './shop-saving-plan.service';
import { CreatePlanDto } from './dto/create-plan.dto';
import { PayInstallmentDto } from './dto/pay-installment.dto';

@Controller('shop/saving-plans')
@UseGuards(JwtAuthGuard)
export class ShopSavingPlanController {
  constructor(private service: ShopSavingPlanService) {}

  @Post()
  create(@Body() dto: CreatePlanDto, @Req() req: { user: { sub: string } }) {
    return this.service.create(dto, req.user.sub);
  }

  @Get()
  listMine(@Req() req: { user: { sub: string } }) { return this.service.listMine(req.user.sub); }

  @Get(':id')
  get(@Param('id') id: string, @Req() req: { user: { sub: string } }) {
    return this.service.get(id, req.user.sub);
  }

  @Post(':id/pay')
  pay(@Param('id') id: string, @Body() dto: PayInstallmentDto, @Req() req: { user: { sub: string } }) {
    return this.service.createPaymentIntent(id, dto.amount, req.user.sub);
  }

  @Delete(':id')
  cancel(@Param('id') id: string, @Req() req: { user: { sub: string } }) {
    return this.service.cancel(id, req.user.sub);
  }
}
```

- [ ] **Step 4: Module + register + commit**

Module imports: PrismaModule, PaySolutionsModule, LineOaModule, AuthModule.

```
feat(shop-phase3): shop-saving-plan module (create/list/pay/cancel)
```

---

## Task 9: Saving plan reminder cron

**Files:**
- Create: `apps/api/src/modules/shop-saving-plan/saving-plan-reminder.cron.ts`

- [ ] **Step 1: Cron provider**

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as Sentry from '@sentry/nestjs';
import { ShopSavingPlanService } from './shop-saving-plan.service';
import { LineOaService } from '../line-oa/line-oa.service';

@Injectable()
export class SavingPlanReminderCron {
  private readonly log = new Logger(SavingPlanReminderCron.name);

  constructor(
    private service: ShopSavingPlanService,
    private line: LineOaService,
  ) {}

  @Cron('0 9 * * *', { timeZone: 'Asia/Bangkok' })
  async handle() {
    try {
      const due = await this.service.listDueReminders();
      for (const plan of due) {
        if (!plan.customer.lineId) continue;
        try {
          await this.line.sendFlexMessage(plan.customer.lineId, {
            type: 'flex',
            altText: `เตือนชำระออมดาวน์ ${plan.planNumber}`,
            contents: { type: 'bubble', body: { type: 'box', layout: 'vertical', contents: [
              { type: 'text', text: 'เตือนชำระออมดาวน์', weight: 'bold', size: 'lg' },
              { type: 'text', text: plan.planNumber, margin: 'md' },
              { type: 'text', text: `งวดนี้ ฿${Number(plan.monthlyAmount).toLocaleString()}`, margin: 'md', weight: 'bold' },
            ]}},
          });
        } catch (e) {
          this.log.warn(`Reminder failed for ${plan.id}: ${String(e)}`);
        }
      }
      this.log.log(`Saving-plan reminders sent: ${due.length}`);
    } catch (err) {
      Sentry.captureException(err, { tags: { kind: 'cron-job', cron: 'saving-plan-reminder' } });
    }
  }
}
```

- [ ] **Step 2: Register in module + commit**

Add `SavingPlanReminderCron` to `providers`.

Commit: `feat(shop-phase3): saving-plan reminder cron (09:00 Bangkok)`

---

## Task 10: PaySolutions `createSavingPlanIntent` + webhook branch

**Files:**
- Modify: `apps/api/src/modules/paysolutions/paysolutions.service.ts`

- [ ] **Step 1: Add `createSavingPlanIntent`**

Mirror `createOnlineOrderIntent`. Differences:
- `orderRef = 'SP' + Date.now().toString(36).toUpperCase()`.slice(0,12)
- Store `savingPlanId` in `PaymentLink.metadata` JSON column (if missing in schema, add a new column `savingPlanId String? @unique @map("saving_plan_id")` + migration similar to Phase 2 Task 7)

Given the Phase 2 PaymentLink extension added `onlineOrderId`, follow the same pattern: add `savingPlanId` nullable + unique back-relation. Include a tiny migration:

```sql
ALTER TABLE "payment_links" ADD COLUMN "saving_plan_id" UUID;
CREATE UNIQUE INDEX "payment_links_saving_plan_id_key" ON "payment_links"("saving_plan_id");
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_saving_plan_id_fkey" FOREIGN KEY ("saving_plan_id") REFERENCES "saving_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

- [ ] **Step 2: Webhook branch — after online-order branch**

In `handlePaymentCallback`, add ANOTHER branch after the existing `if (!paymentLink.contractId)` online-order block:

```typescript
    if (paymentLink.savingPlanId) {
      const isOk = result_code === '00';
      if (isOk) {
        await this.confirmSavingPlanPayment(paymentLink.savingPlanId, paymentLink.id, webhookData);
        await this.prisma.paymentLink.update({ where: { id: paymentLink.id }, data: { status: 'USED', usedAt: new Date() } });
      } else {
        await this.prisma.paymentLink.update({ where: { id: paymentLink.id }, data: { status: 'EXPIRED' } });
      }
      return;
    }
```

- [ ] **Step 3: `confirmSavingPlanPayment`**

```typescript
  async confirmSavingPlanPayment(savingPlanId: string, paymentLinkId: string, webhookData: Record<string, string>) {
    const plan = await this.prisma.savingPlan.findUnique({ where: { id: savingPlanId }, include: { customer: true, payments: true } });
    if (!plan) return;
    const paid = await this.prisma.savingPlanPayment.findFirst({ where: { paymentLinkId } });
    if (paid) return; // idempotent
    const amount = Number(webhookData.total ?? 0);
    await this.prisma.$transaction(async (tx) => {
      await tx.savingPlanPayment.create({
        data: {
          savingPlanId, amount, paidAt: new Date(),
          paymentMethod: 'PROMPTPAY',
          paymentRef: webhookData.transaction_id || webhookData.refno,
          paymentLinkId,
        },
      });
      const newTotal = Number(plan.totalSaved) + amount;
      const completed = newTotal >= Number(plan.targetAmount);
      const next = new Date(plan.nextPaymentDueAt ?? new Date());
      next.setMonth(next.getMonth() + 1);
      await tx.savingPlan.update({
        where: { id: savingPlanId },
        data: {
          totalSaved: newTotal,
          nextPaymentDueAt: completed ? null : next,
          status: completed ? 'COMPLETED' : 'ACTIVE',
          completedAt: completed ? new Date() : null,
        },
      });
    });
    if (plan.customer.lineId) {
      try {
        await this.lineOaService.sendFlexMessage(plan.customer.lineId, {
          type: 'flex',
          altText: 'ชำระออมดาวน์สำเร็จ',
          contents: { type: 'bubble', body: { type: 'box', layout: 'vertical', contents: [
            { type: 'text', text: 'ชำระออมดาวน์สำเร็จ', weight: 'bold', size: 'lg' },
            { type: 'text', text: plan.planNumber, margin: 'md' },
            { type: 'text', text: `ยอดสะสม ฿${(Number(plan.totalSaved) + amount).toLocaleString()}`, weight: 'bold', margin: 'md' },
          ]}},
        });
      } catch {}
    }
  }
```

- [ ] **Step 4: Migration + type check + commit**

```
feat(shop-phase3): PaySolutions saving-plan payment intents + webhook branch
```

---

## Task 11: `shop-reviews` — list + create + moderate

**Files:**
- Create: `apps/api/src/modules/shop-reviews/` full module

- [ ] **Step 1: DTOs**

`dto/create-review.dto.ts`:
```typescript
import { IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

export class CreateReviewDto {
  @IsUUID() productId!: string;
  @IsInt() @Min(1) @Max(5) rating!: number;
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() comment?: string;
}
```

- [ ] **Step 2: Service with verified-purchase gate**

```typescript
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateReviewDto } from './dto/create-review.dto';

@Injectable()
export class ShopReviewsService {
  constructor(private prisma: PrismaService) {}

  async listPublic(productId: string) {
    return this.prisma.review.findMany({
      where: { productId, status: 'PUBLISHED', deletedAt: null },
      include: { customer: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async summary(productId: string) {
    const rows = await this.prisma.review.groupBy({
      by: ['rating'],
      where: { productId, status: 'PUBLISHED', deletedAt: null },
      _count: true,
    });
    const total = rows.reduce((a, r) => a + (r._count as number), 0);
    const sum = rows.reduce((a, r) => a + r.rating * (r._count as number), 0);
    return { total, average: total ? Math.round((sum / total) * 10) / 10 : 0, byRating: rows };
  }

  async create(dto: CreateReviewDto, customerId: string) {
    const dup = await this.prisma.review.findUnique({
      where: { productId_customerId: { productId: dto.productId, customerId } },
    });
    if (dup) throw new BadRequestException('คุณรีวิวสินค้านี้ไปแล้ว');

    // Verified purchase gate: must have a Sale (saleSource ONLINE or contract) linking this customer to this product's model.
    const verified = await this.prisma.sale.findFirst({
      where: {
        customerId,
        productId: dto.productId,
        deletedAt: null,
      },
    });
    if (!verified) throw new ForbiddenException('รีวิวได้เฉพาะสินค้าที่คุณเคยซื้อ');

    return this.prisma.review.create({
      data: {
        productId: dto.productId, customerId,
        rating: dto.rating, title: dto.title, comment: dto.comment,
        verified: true, verifiedSource: verified.id,
        status: 'PUBLISHED',
      },
    });
  }

  async moderate(id: string, status: 'HIDDEN' | 'PUBLISHED', reason: string | undefined, moderatorId: string) {
    const r = await this.prisma.review.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('ไม่พบรีวิว');
    return this.prisma.review.update({
      where: { id },
      data: { status, hiddenReason: reason, moderatedById: moderatorId, moderatedAt: new Date() },
    });
  }

  async adminList(productId?: string, status?: string) {
    return this.prisma.review.findMany({
      where: { deletedAt: null, ...(productId ? { productId } : {}), ...(status ? { status: status as any } : {}) },
      include: { customer: { select: { name: true, phone: true } }, product: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }
}
```

- [ ] **Step 3: Controllers (customer + admin)**

```typescript
// shop-reviews.controller.ts — public read + auth write
import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ShopReviewsService } from './shop-reviews.service';
import { CreateReviewDto } from './dto/create-review.dto';

@Controller('shop/reviews')
export class ShopReviewsController {
  constructor(private service: ShopReviewsService) {}

  @Get(':productId')
  list(@Param('productId') productId: string) { return this.service.listPublic(productId); }

  @Get(':productId/summary')
  summary(@Param('productId') productId: string) { return this.service.summary(productId); }

  @Post()
  @UseGuards(JwtAuthGuard)
  create(@Body() dto: CreateReviewDto, @Req() req: { user: { sub: string } }) {
    return this.service.create(dto, req.user.sub);
  }
}
```

```typescript
// shop-reviews.admin.controller.ts
import { Body, Controller, Get, Param, Patch, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ShopReviewsService } from './shop-reviews.service';

@Controller('admin/reviews')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'BRANCH_MANAGER')
export class ShopReviewsAdminController {
  constructor(private service: ShopReviewsService) {}

  @Get()
  list(@Query('productId') productId?: string, @Query('status') status?: string) {
    return this.service.adminList(productId, status);
  }

  @Patch(':id/hide')
  hide(@Param('id') id: string, @Body() body: { reason?: string }, @Req() req: { user: { id: string } }) {
    return this.service.moderate(id, 'HIDDEN', body.reason, req.user.id);
  }

  @Patch(':id/restore')
  restore(@Param('id') id: string, @Req() req: { user: { id: string } }) {
    return this.service.moderate(id, 'PUBLISHED', undefined, req.user.id);
  }
}
```

- [ ] **Step 4: Module + register + commit**

```
feat(shop-phase3): shop-reviews module (list/create/moderate + verified-purchase gate)
```

---

## Task 12: `shop-cs` — customer service (cancel + refund request)

**Files:**
- Create: `apps/api/src/modules/shop-cs/` full module

- [ ] **Step 1: DTO**

`dto/request.dto.ts`:
```typescript
import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';

export class CancelOrderDto { @IsString() reason!: string; }
export class RefundRequestDto {
  @IsOptional() @IsString() reason?: string;
  @IsIn(['FULL', 'PARTIAL']) type!: 'FULL' | 'PARTIAL';
}
```

- [ ] **Step 2: Service**

```typescript
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ShopCsService {
  constructor(private prisma: PrismaService) {}

  async cancel(orderNumber: string, customerId: string, reason: string) {
    const order = await this.prisma.onlineOrder.findUnique({ where: { orderNumber } });
    if (!order || order.customerId !== customerId) throw new NotFoundException('ไม่พบคำสั่งซื้อ');
    if (order.status !== 'PENDING_PAYMENT' && order.status !== 'PAID') {
      throw new BadRequestException('สถานะนี้ยกเลิกไม่ได้');
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.onlineOrder.update({
        where: { id: order.id },
        data: { status: 'CANCELLED', cancelReason: reason, cancelledAt: new Date() },
      });
      await tx.productReservation.updateMany({
        where: { id: order.reservationId, status: 'ACTIVE' },
        data: { status: 'CANCELLED' },
      });
      return updated;
    });
  }

  async requestRefund(orderNumber: string, customerId: string, type: 'FULL' | 'PARTIAL', reason?: string) {
    const order = await this.prisma.onlineOrder.findUnique({ where: { orderNumber } });
    if (!order || order.customerId !== customerId) throw new NotFoundException('ไม่พบคำสั่งซื้อ');
    if (!['PAID', 'PACKING', 'SHIPPED', 'DELIVERED'].includes(order.status)) {
      throw new BadRequestException('สถานะนี้ขอคืนเงินไม่ได้');
    }
    // Mark as REFUNDED — actual refund at gateway is done manually by admin
    return this.prisma.onlineOrder.update({
      where: { id: order.id },
      data: { status: 'REFUNDED', cancelReason: `[${type}] ${reason ?? ''}`, cancelledAt: new Date() },
    });
  }
}
```

- [ ] **Step 3: Controller**

```typescript
import { Body, Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ShopCsService } from './shop-cs.service';
import { CancelOrderDto, RefundRequestDto } from './dto/request.dto';

@Controller('shop/cs')
@UseGuards(JwtAuthGuard)
export class ShopCsController {
  constructor(private service: ShopCsService) {}

  @Post('orders/:orderNumber/cancel')
  cancel(@Param('orderNumber') orderNumber: string, @Body() dto: CancelOrderDto, @Req() req: { user: { sub: string } }) {
    return this.service.cancel(orderNumber, req.user.sub, dto.reason);
  }

  @Post('orders/:orderNumber/refund')
  refund(@Param('orderNumber') orderNumber: string, @Body() dto: RefundRequestDto, @Req() req: { user: { sub: string } }) {
    return this.service.requestRefund(orderNumber, req.user.sub, dto.type, dto.reason);
  }
}
```

- [ ] **Step 4: Module + register + commit**

Commit: `feat(shop-phase3): shop-cs module (cancel + refund-request endpoints)`

---

## Task 13: Frontend — analytics + signed-upload hooks

**Files:**
- Create: `apps/web-shop/src/lib/analytics.ts`
- Create: `apps/web-shop/src/hooks/useTrackEvent.ts`
- Create: `apps/web-shop/src/hooks/useSignedUpload.ts`
- Modify: `apps/web-shop/src/main.tsx` — init on boot
- Modify: `apps/web-shop/index.html` — GA4 + FB Pixel script tags (guarded by env)

- [ ] **Step 1: `lib/analytics.ts`**

```typescript
/// <reference types="vite/client" />
const GA_ID = import.meta.env.VITE_GA4_ID as string | undefined;
const FB_PIXEL_ID = import.meta.env.VITE_FB_PIXEL_ID as string | undefined;

declare global {
  interface Window {
    dataLayer?: any[];
    gtag?: (...args: any[]) => void;
    fbq?: (...args: any[]) => void;
  }
}

export function initAnalytics() {
  if (GA_ID && typeof window !== 'undefined') {
    const s = document.createElement('script');
    s.async = true;
    s.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
    document.head.appendChild(s);
    window.dataLayer = window.dataLayer || [];
    window.gtag = function gtag() {
      window.dataLayer!.push(arguments);
    };
    window.gtag('js', new Date());
    window.gtag('config', GA_ID);
  }
  if (FB_PIXEL_ID && typeof window !== 'undefined') {
    ((f: any, b, e, v, n: any, t, s) => {
      if (f.fbq) return;
      n = f.fbq = function () {
        n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
      };
      if (!f._fbq) f._fbq = n;
      n.push = n;
      n.loaded = !0;
      n.version = '2.0';
      n.queue = [];
      t = b.createElement(e);
      t.async = !0;
      t.src = v;
      s = b.getElementsByTagName(e)[0];
      s.parentNode.insertBefore(t, s);
    })(window as any, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js', undefined, undefined, undefined);
    window.fbq!('init', FB_PIXEL_ID);
    window.fbq!('track', 'PageView');
  }
}

export function track(event: string, params?: Record<string, unknown>) {
  if (typeof window === 'undefined') return;
  try {
    window.gtag?.('event', event, params ?? {});
    window.fbq?.('trackCustom', event, params ?? {});
  } catch {
    // telemetry failures never break user flow
  }
}
```

- [ ] **Step 2: `hooks/useTrackEvent.ts`**

```typescript
import { track } from '../lib/analytics';
export function useTrackEvent() {
  return track;
}
```

- [ ] **Step 3: `hooks/useSignedUpload.ts`**

```typescript
import { useMutation } from '@tanstack/react-query';
import { api } from '../lib/api';

export type UploadKind = 'TRADE_IN_PHOTO' | 'BUYBACK_PHOTO' | 'BANK_SLIP' | 'REVIEW_PHOTO';

export function useSignedUpload(kind: UploadKind) {
  return useMutation({
    mutationFn: async (file: File) => {
      const presign = await api
        .post('/api/shop/upload/signed-url', { kind, contentType: file.type })
        .then((r) => r.data as { uploadUrl: string; key: string; publicUrl: string });
      const put = await fetch(presign.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      });
      if (!put.ok) throw new Error('upload failed');
      return { key: presign.key, publicUrl: presign.publicUrl };
    },
  });
}
```

- [ ] **Step 4: Init on boot**

Modify `main.tsx`:
```typescript
import { initAnalytics } from './lib/analytics';
// ...
initAnalytics();
```

Call before `ReactDOM.createRoot(...)`.

- [ ] **Step 5: Type check + commit**

```
feat(shop-phase3): analytics (GA4 + FB Pixel) + useSignedUpload hook
```

---

## Task 14: Frontend — InstallmentApplyPage + types

**Files:**
- Create: `apps/web-shop/src/types/application.ts`
- Create: `apps/web-shop/src/pages/apply/InstallmentApplyPage.tsx`
- Create: `apps/web-shop/src/pages/apply/ApplySuccessPage.tsx`
- Modify: `apps/web-shop/src/App.tsx` — add `/apply/:productId` and `/apply/success/:applicationNumber`

- [ ] **Step 1: Type**

`types/application.ts`:
```typescript
export type ApplicationStatus =
  | 'SUBMITTED' | 'SCHEDULED' | 'IN_REVIEW' | 'APPROVED' | 'CONTRACT_SIGNED'
  | 'REJECTED' | 'NO_SHOW' | 'EXPIRED' | 'CANCELLED';

export interface Application {
  id: string;
  applicationNumber: string;
  status: ApplicationStatus;
  fullName: string;
  phone: string;
  proposedDownPayment: number;
  proposedTotalMonths: number;
  proposedMonthlyPayment: number;
  scheduledAt: string | null;
  rejectReason: string | null;
  createdAt: string;
  product: { id: string; name: string; gallery: string[] };
}
```

- [ ] **Step 2: `InstallmentApplyPage.tsx`**

```tsx
import { useMutation, useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate, useParams } from 'react-router';
import { z } from 'zod';
import { toast } from 'sonner';
import { api } from '../../lib/api';
import { useTrackEvent } from '../../hooks/useTrackEvent';
import ShopLayout from '../../components/layout/ShopLayout';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';

const schema = z.object({
  fullName: z.string().min(2, 'กรุณาระบุชื่อ'),
  phone: z.string().regex(/^0\d{9}$/, 'เบอร์โทร 10 หลัก'),
  nationalId: z.string().regex(/^\d{13}$/, 'เลขบัตรประชาชน 13 หลัก'),
  proposedDownPayment: z.coerce.number().int().min(0),
  proposedTotalMonths: z.coerce.number().int().min(3).max(12),
  notes: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

export default function InstallmentApplyPage() {
  const { productId } = useParams<{ productId: string }>();
  const nav = useNavigate();
  const track = useTrackEvent();

  const { data: product } = useQuery({
    queryKey: ['shop-product', productId],
    queryFn: () => api.get(`/api/shop/products/${productId}`).then((r) => r.data),
    enabled: !!productId,
  });

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { proposedTotalMonths: 12, proposedDownPayment: 2000 },
  });

  const mut = useMutation({
    mutationFn: (v: FormValues) =>
      api.post('/api/shop/applications', { productId, ...v }).then((r) => r.data),
    onSuccess: (res) => {
      track('Lead', { type: 'installment-apply', productId, applicationNumber: res.applicationNumber });
      toast.success('รับเรื่องแล้ว ทีมงานจะติดต่อกลับภายใน 2 ชั่วโมง');
      nav(`/apply/success/${res.applicationNumber}`);
    },
    onError: (e: { response?: { data?: { message?: string } } }) =>
      toast.error(e.response?.data?.message ?? 'ส่งใบสมัครไม่สำเร็จ'),
  });

  return (
    <ShopLayout>
      <div className="container mx-auto px-4 py-6 max-w-xl space-y-6 leading-snug">
        <h1 className="text-2xl font-bold">สมัครผ่อน</h1>
        {product && (
          <div className="rounded-xl border border-border p-4 flex gap-4">
            {product.gallery?.[0] && <img src={product.gallery[0]} alt={product.brand ?? 'product'} className="h-16 w-16 rounded-lg object-cover bg-muted" />}
            <div>
              <div className="font-semibold">{[product.brand, product.model, product.storage].filter(Boolean).join(' ')}</div>
            </div>
          </div>
        )}
        <form onSubmit={handleSubmit((v) => mut.mutate(v))} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="fullName">ชื่อ-นามสกุล</Label>
            <Input id="fullName" {...register('fullName')} />
            {errors.fullName && <span className="text-xs text-destructive">{errors.fullName.message}</span>}
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label htmlFor="phone">เบอร์โทร</Label>
              <Input id="phone" {...register('phone')} placeholder="0812345678" />
              {errors.phone && <span className="text-xs text-destructive">{errors.phone.message}</span>}
            </div>
            <div className="space-y-1">
              <Label htmlFor="nationalId">เลขบัตรประชาชน</Label>
              <Input id="nationalId" {...register('nationalId')} placeholder="1234567890123" />
              {errors.nationalId && <span className="text-xs text-destructive">{errors.nationalId.message}</span>}
            </div>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label htmlFor="proposedDownPayment">ดาวน์ (บาท)</Label>
              <Input id="proposedDownPayment" type="number" {...register('proposedDownPayment')} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="proposedTotalMonths">จำนวนงวด (เดือน)</Label>
              <Input id="proposedTotalMonths" type="number" min={3} max={12} {...register('proposedTotalMonths')} />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="notes">หมายเหตุ (ถ้ามี)</Label>
            <Input id="notes" {...register('notes')} />
          </div>
          <Button type="submit" disabled={isSubmitting || mut.isPending} className="w-full">
            {mut.isPending ? 'กำลังส่ง...' : 'ส่งใบสมัคร'}
          </Button>
          <p className="text-xs text-muted-foreground">
            ข้อมูลของคุณถูกเก็บภายใต้นโยบาย PDPA — ใช้เพื่อประเมินสินเชื่อเท่านั้น
          </p>
        </form>
      </div>
    </ShopLayout>
  );
}
```

- [ ] **Step 3: `ApplySuccessPage.tsx`**

```tsx
import { useParams, Link } from 'react-router';
import ShopLayout from '../../components/layout/ShopLayout';

export default function ApplySuccessPage() {
  const { applicationNumber } = useParams<{ applicationNumber: string }>();
  return (
    <ShopLayout>
      <div className="container mx-auto px-4 py-8 max-w-xl text-center leading-snug">
        <div className="text-3xl font-bold mb-4">ส่งใบสมัครแล้ว</div>
        <div className="text-lg mb-4">{applicationNumber}</div>
        <p className="text-muted-foreground mb-6">
          ทีมงานจะติดต่อกลับภายใน 2 ชั่วโมง (เวลาทำการ 09:00–20:00)
        </p>
        <Link to="/" className="text-primary underline-offset-4 hover:underline">กลับหน้าแรก</Link>
      </div>
    </ShopLayout>
  );
}
```

- [ ] **Step 4: Register routes + commit**

```tsx
<Route path="/apply/:productId" element={<InstallmentApplyPage />} />
<Route path="/apply/success/:applicationNumber" element={<ApplySuccessPage />} />
```

Commit: `feat(shop-phase3): InstallmentApplyPage + ApplySuccessPage`

---

## Task 15: Frontend — shared device-submit components

**Files:**
- Create: `apps/web-shop/src/components/device-submit/DeviceSelector.tsx`
- Create: `apps/web-shop/src/components/device-submit/DeviceSpecForm.tsx`
- Create: `apps/web-shop/src/components/device-submit/PhotoUploadGrid.tsx`
- Create: `apps/web-shop/src/components/device-submit/ValuationDisplay.tsx`

All four are used by TradeInSubmitPage (Task 16) and BuybackSubmitPage (Task 17).

- [ ] **Step 1: `DeviceSelector.tsx`** — cascading select brand → model → storage

Keep it simple: three `<select>` elements, each `onChange` triggers parent state. No API call — brand/model lists are hardcoded arrays for MVP (Apple/Samsung only given 100% iPhone sales).

```tsx
import { useMemo } from 'react';

const CATALOG: Record<string, Record<string, string[]>> = {
  Apple: {
    'iPhone 11': ['64GB', '128GB', '256GB'],
    'iPhone 12': ['64GB', '128GB', '256GB'],
    'iPhone 13': ['128GB', '256GB', '512GB'],
    'iPhone 14': ['128GB', '256GB', '512GB'],
    'iPhone 15': ['128GB', '256GB', '512GB'],
  },
  Samsung: {
    'Galaxy S23': ['128GB', '256GB'],
    'Galaxy S24': ['128GB', '256GB'],
  },
};

interface Props {
  value: { brand: string; model: string; storage: string };
  onChange: (v: { brand: string; model: string; storage: string }) => void;
}

export default function DeviceSelector({ value, onChange }: Props) {
  const models = useMemo(() => (value.brand ? Object.keys(CATALOG[value.brand] ?? {}) : []), [value.brand]);
  const storages = useMemo(() => (value.brand && value.model ? CATALOG[value.brand]?.[value.model] ?? [] : []), [value.brand, value.model]);

  return (
    <div className="grid sm:grid-cols-3 gap-4 leading-snug">
      <select
        className="rounded-md border border-input bg-background px-3 py-2"
        value={value.brand}
        onChange={(e) => onChange({ brand: e.target.value, model: '', storage: '' })}
      >
        <option value="">ยี่ห้อ</option>
        {Object.keys(CATALOG).map((b) => <option key={b} value={b}>{b}</option>)}
      </select>
      <select
        className="rounded-md border border-input bg-background px-3 py-2"
        value={value.model}
        onChange={(e) => onChange({ ...value, model: e.target.value, storage: '' })}
        disabled={!value.brand}
      >
        <option value="">รุ่น</option>
        {models.map((m) => <option key={m} value={m}>{m}</option>)}
      </select>
      <select
        className="rounded-md border border-input bg-background px-3 py-2"
        value={value.storage}
        onChange={(e) => onChange({ ...value, storage: e.target.value })}
        disabled={!value.model}
      >
        <option value="">ความจุ</option>
        {storages.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
    </div>
  );
}
```

- [ ] **Step 2: `DeviceSpecForm.tsx`**

```tsx
import { Input } from '../ui/input';
import { Label } from '../ui/label';

export interface DeviceSpec {
  condition: 'A' | 'B' | 'C';
  batteryHealth: number;
  imei?: string;
  notes?: string;
}

interface Props {
  value: DeviceSpec;
  onChange: (v: DeviceSpec) => void;
}

const CONDITIONS: Array<{ v: 'A' | 'B' | 'C'; label: string; desc: string }> = [
  { v: 'A', label: 'เกรด A', desc: 'เหมือนใหม่ ไม่มีรอย' },
  { v: 'B', label: 'เกรด B', desc: 'มีรอยใช้งานเล็กน้อย' },
  { v: 'C', label: 'เกรด C', desc: 'มีรอยหรือตำหนิชัดเจน' },
];

export default function DeviceSpecForm({ value, onChange }: Props) {
  return (
    <div className="space-y-4 leading-snug">
      <div>
        <Label>สภาพเครื่อง</Label>
        <div className="grid sm:grid-cols-3 gap-2 mt-2">
          {CONDITIONS.map((c) => (
            <button
              key={c.v}
              type="button"
              onClick={() => onChange({ ...value, condition: c.v })}
              className={`rounded-xl border p-3 text-left transition-colors ${
                value.condition === c.v ? 'border-primary bg-primary/5' : 'border-border'
              }`}
            >
              <div className="font-semibold">{c.label}</div>
              <div className="text-xs text-muted-foreground">{c.desc}</div>
            </button>
          ))}
        </div>
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label htmlFor="battery">Battery Health (%)</Label>
          <Input
            id="battery"
            type="number"
            min={0}
            max={100}
            value={value.batteryHealth}
            onChange={(e) => onChange({ ...value, batteryHealth: Number(e.target.value) })}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="imei">IMEI (ถ้ามี)</Label>
          <Input id="imei" value={value.imei ?? ''} onChange={(e) => onChange({ ...value, imei: e.target.value })} />
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="notes">หมายเหตุ (ถ้ามี)</Label>
        <Input id="notes" value={value.notes ?? ''} onChange={(e) => onChange({ ...value, notes: e.target.value })} />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: `PhotoUploadGrid.tsx`**

```tsx
import { useSignedUpload, type UploadKind } from '../../hooks/useSignedUpload';
import { Button } from '../ui/button';
import { toast } from 'sonner';

interface Props {
  kind: UploadKind;
  photoUrls: string[];
  onChange: (urls: string[]) => void;
  max?: number;
}

export default function PhotoUploadGrid({ kind, photoUrls, onChange, max = 5 }: Props) {
  const upload = useSignedUpload(kind);

  const pickFiles = async (files: FileList | null) => {
    if (!files) return;
    for (const file of Array.from(files).slice(0, max - photoUrls.length)) {
      try {
        const res = await upload.mutateAsync(file);
        onChange([...photoUrls, res.publicUrl]);
      } catch {
        toast.error('อัปโหลดไฟล์ไม่สำเร็จ');
      }
    }
  };

  return (
    <div className="space-y-2 leading-snug">
      <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
        {photoUrls.map((url, i) => (
          <div key={url} className="relative">
            <img src={url} alt={`photo ${i + 1}`} className="h-24 w-full object-cover rounded-lg bg-muted" />
            <button
              type="button"
              onClick={() => onChange(photoUrls.filter((u) => u !== url))}
              className="absolute top-1 right-1 rounded-full bg-background/90 border border-border px-2 py-0.5 text-xs"
            >
              ลบ
            </button>
          </div>
        ))}
        {photoUrls.length < max && (
          <label className="h-24 flex items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground cursor-pointer hover:bg-accent">
            + รูป
            <input
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => pickFiles(e.target.files)}
            />
          </label>
        )}
      </div>
      {upload.isPending && <div className="text-xs text-muted-foreground">กำลังอัปโหลด...</div>}
    </div>
  );
}
```

- [ ] **Step 4: `ValuationDisplay.tsx`**

```tsx
interface Props {
  quote: { min: number; max: number; available: boolean } | null;
}

export default function ValuationDisplay({ quote }: Props) {
  if (!quote) return null;
  if (!quote.available) return <div className="text-muted-foreground text-sm">ยังไม่มีข้อมูลราคาสำหรับรุ่นนี้ — ทีมงานจะประเมินหลังส่งคำขอ</div>;
  return (
    <div className="rounded-xl border border-border p-4 leading-snug">
      <div className="text-sm text-muted-foreground">ราคาประเมิน</div>
      <div className="text-2xl font-bold text-primary">
        ฿{quote.min.toLocaleString()} – ฿{quote.max.toLocaleString()}
      </div>
      <div className="text-xs text-muted-foreground mt-1">ราคาจริงยืนยันภายใน 24 ชั่วโมงหลังส่งรูป</div>
    </div>
  );
}
```

- [ ] **Step 5: Commit**

```
feat(shop-phase3): device-submit shared components (Selector, SpecForm, PhotoUploadGrid, ValuationDisplay)
```

---

## Task 16: Frontend — Trade-In landing + submit + status

**Files:**
- Create: `apps/web-shop/src/types/trade-in.ts`
- Create: `apps/web-shop/src/pages/trade-in/TradeInLandingPage.tsx`
- Create: `apps/web-shop/src/pages/trade-in/TradeInSubmitPage.tsx`
- Create: `apps/web-shop/src/pages/trade-in/TradeInStatusPage.tsx`
- Modify: `apps/web-shop/src/App.tsx` — 3 routes

- [ ] **Step 1: Types**

```typescript
// types/trade-in.ts
export type TradeInStatus = 'PENDING_APPRAISAL' | 'APPRAISED' | 'ACCEPTED' | 'COMPLETED' | 'REJECTED';
```

- [ ] **Step 2: `TradeInLandingPage.tsx`** — 3-step visual explainer + CTA

```tsx
import { Link } from 'react-router';
import ShopLayout from '../../components/layout/ShopLayout';
import { Button } from '../../components/ui/button';

export default function TradeInLandingPage() {
  const steps = [
    { n: 1, title: 'บอกข้อมูลเครื่องเก่า', desc: 'รุ่น ความจุ สภาพ' },
    { n: 2, title: 'ถ่ายรูป 5 รูป', desc: 'หน้า หลัง ข้าง จอ กล่อง (ถ้ามี)' },
    { n: 3, title: 'รับราคาภายใน 24 ชม.', desc: 'ทีมงานตอบกลับทาง LINE' },
  ];
  return (
    <ShopLayout>
      <div className="container mx-auto px-4 py-8 max-w-xl space-y-6 leading-snug">
        <h1 className="text-3xl font-bold">เก่าแลกใหม่</h1>
        <p className="text-muted-foreground">
          แลกเครื่องเก่าของคุณเป็นส่วนลดซื้อเครื่องใหม่ — ราคาดีกว่าขายต่อเอง
        </p>
        <div className="grid gap-4">
          {steps.map((s) => (
            <div key={s.n} className="rounded-xl border border-border p-4 flex gap-4">
              <div className="h-10 w-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold">
                {s.n}
              </div>
              <div>
                <div className="font-semibold">{s.title}</div>
                <div className="text-sm text-muted-foreground">{s.desc}</div>
              </div>
            </div>
          ))}
        </div>
        <Button asChild size="lg" className="w-full">
          <Link to="/trade-in/submit">เริ่มเลย</Link>
        </Button>
      </div>
    </ShopLayout>
  );
}
```

- [ ] **Step 3: `TradeInSubmitPage.tsx`**

```tsx
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { api } from '../../lib/api';
import { useTrackEvent } from '../../hooks/useTrackEvent';
import ShopLayout from '../../components/layout/ShopLayout';
import DeviceSelector from '../../components/device-submit/DeviceSelector';
import DeviceSpecForm, { type DeviceSpec } from '../../components/device-submit/DeviceSpecForm';
import PhotoUploadGrid from '../../components/device-submit/PhotoUploadGrid';
import ValuationDisplay from '../../components/device-submit/ValuationDisplay';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';

export default function TradeInSubmitPage() {
  const nav = useNavigate();
  const track = useTrackEvent();
  const [device, setDevice] = useState({ brand: '', model: '', storage: '' });
  const [spec, setSpec] = useState<DeviceSpec>({ condition: 'A', batteryHealth: 90 });
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const [sellerName, setSellerName] = useState('');
  const [sellerPhone, setSellerPhone] = useState('');

  const quoteQ = useQuery({
    queryKey: ['trade-in-estimate', device, spec.condition],
    queryFn: () =>
      api
        .post('/api/shop/trade-in/estimate', { ...device, condition: spec.condition })
        .then((r) => r.data as { min: number; max: number; available: boolean }),
    enabled: !!(device.brand && device.model && device.storage),
  });

  const submit = useMutation({
    mutationFn: () =>
      api
        .post('/api/shop/trade-in/submit', {
          ...device,
          condition: spec.condition,
          batteryHealth: spec.batteryHealth,
          imei: spec.imei,
          notes: spec.notes,
          photoUrls,
          sellerName,
          sellerPhone,
        })
        .then((r) => r.data as { id: string }),
    onSuccess: (res) => {
      track('Lead', { type: 'trade-in' });
      toast.success('ส่งเรื่องเก่าแลกใหม่แล้ว');
      nav(`/trade-in/${res.id}`);
    },
    onError: (e: { response?: { data?: { message?: string } } }) =>
      toast.error(e.response?.data?.message ?? 'ส่งเรื่องไม่สำเร็จ'),
  });

  const canSubmit =
    device.brand && device.model && device.storage && photoUrls.length >= 1 && sellerName.length >= 2 && /^0\d{9}$/.test(sellerPhone);

  return (
    <ShopLayout>
      <div className="container mx-auto px-4 py-6 max-w-2xl space-y-6 leading-snug">
        <h1 className="text-2xl font-bold">เก่าแลกใหม่ — ส่งข้อมูล</h1>
        <section className="space-y-3">
          <h2 className="font-semibold">1. เครื่องเก่าของคุณ</h2>
          <DeviceSelector value={device} onChange={setDevice} />
        </section>
        <section className="space-y-3">
          <h2 className="font-semibold">2. สภาพเครื่อง</h2>
          <DeviceSpecForm value={spec} onChange={setSpec} />
        </section>
        <ValuationDisplay quote={quoteQ.data ?? null} />
        <section className="space-y-3">
          <h2 className="font-semibold">3. รูปเครื่อง (อย่างน้อย 1 รูป)</h2>
          <PhotoUploadGrid kind="TRADE_IN_PHOTO" photoUrls={photoUrls} onChange={setPhotoUrls} />
        </section>
        <section className="space-y-3">
          <h2 className="font-semibold">4. ข้อมูลติดต่อ</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>ชื่อ</Label>
              <Input value={sellerName} onChange={(e) => setSellerName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>เบอร์โทร</Label>
              <Input value={sellerPhone} onChange={(e) => setSellerPhone(e.target.value)} />
            </div>
          </div>
        </section>
        <Button onClick={() => submit.mutate()} disabled={!canSubmit || submit.isPending} className="w-full">
          {submit.isPending ? 'กำลังส่ง...' : 'ส่งข้อมูล'}
        </Button>
      </div>
    </ShopLayout>
  );
}
```

- [ ] **Step 4: `TradeInStatusPage.tsx`**

```tsx
import { useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import ShopLayout from '../../components/layout/ShopLayout';

export default function TradeInStatusPage() {
  const { id } = useParams<{ id: string }>();
  const { data } = useQuery({
    queryKey: ['trade-in', id],
    queryFn: () => api.get(`/api/shop/trade-in/${id}`).then((r) => r.data),
    enabled: !!id,
    refetchInterval: 60_000,
  });
  if (!data) {
    return <ShopLayout><div className="p-8 text-muted-foreground">กำลังโหลด...</div></ShopLayout>;
  }
  return (
    <ShopLayout>
      <div className="container mx-auto px-4 py-6 max-w-xl space-y-4 leading-snug">
        <h1 className="text-2xl font-bold">เก่าแลกใหม่</h1>
        <div className="rounded-xl border border-border p-4">
          <div className="font-semibold">{data.deviceBrand} {data.deviceModel} {data.deviceStorage}</div>
          <div className="text-sm text-muted-foreground">เกรด {data.deviceCondition} · Battery {data.batteryHealth}%</div>
          <div className="mt-2 text-sm">สถานะ: <b>{data.status}</b></div>
          {data.offeredPrice && (
            <div className="mt-2 text-xl font-bold text-primary">ราคาที่เสนอ ฿{Number(data.offeredPrice).toLocaleString()}</div>
          )}
        </div>
      </div>
    </ShopLayout>
  );
}
```

- [ ] **Step 5: Routes + commit**

```tsx
<Route path="/trade-in" element={<TradeInLandingPage />} />
<Route path="/trade-in/submit" element={<TradeInSubmitPage />} />
<Route path="/trade-in/:id" element={<TradeInStatusPage />} />
```

Commit: `feat(shop-phase3): trade-in landing + submit + status pages`

---

## Task 17: Frontend — Buyback pages

Same structure as Task 16 but:
- Route: `/buyback`, `/buyback/quote`, `/buyback/submit`, `/buyback/:id`
- No `targetProductId`
- Quick quote page = form just to get price range BEFORE submitting (can skip and go straight to submit)

**Files:**
- Create: `apps/web-shop/src/pages/buyback/BuybackLandingPage.tsx`
- Create: `apps/web-shop/src/pages/buyback/BuybackQuickQuotePage.tsx`
- Create: `apps/web-shop/src/pages/buyback/BuybackSubmitPage.tsx`
- Create: `apps/web-shop/src/pages/buyback/BuybackStatusPage.tsx`

- [ ] **Step 1: Copy TradeInLandingPage → BuybackLandingPage**

Change text: "ขายมือถือเก่า" / CTA "/buyback/quote". Steps text adjusted: "1. บอกข้อมูล 2. รับราคาทันที 3. ส่งรูป รับราคาจริง 24 ชม."

- [ ] **Step 2: `BuybackQuickQuotePage.tsx`** — reuse `DeviceSelector` + condition radio, call `POST /api/shop/buyback/quick-quote`, show `ValuationDisplay`, CTA → "/buyback/submit" with state

- [ ] **Step 3: `BuybackSubmitPage.tsx`** — mostly identical to `TradeInSubmitPage` but:
  - POST to `/api/shop/buyback/submit`
  - Event name `'Lead' { type: 'buyback' }`
  - No target product

- [ ] **Step 4: `BuybackStatusPage.tsx`** — identical to `TradeInStatusPage` but endpoint `/api/shop/buyback/:id`

- [ ] **Step 5: Register routes + commit**

```
feat(shop-phase3): buyback landing + quick-quote + submit + status pages
```

---

## Task 18: Frontend — Saving Plan pages + calculator

**Files:**
- Create: `apps/web-shop/src/types/saving-plan.ts`
- Create: `apps/web-shop/src/components/saving-plan/PlanCalculator.tsx`
- Create: `apps/web-shop/src/components/saving-plan/PlanProgressBar.tsx`
- Create: `apps/web-shop/src/components/saving-plan/PaymentHistoryTable.tsx`
- Create: `apps/web-shop/src/pages/saving-plan/SavingPlanLandingPage.tsx`
- Create: `apps/web-shop/src/pages/saving-plan/SavingPlanCreatePage.tsx`
- Create: `apps/web-shop/src/pages/saving-plan/SavingPlanDetailPage.tsx`
- Create: `apps/web-shop/src/pages/account/SavingPlansPage.tsx`

- [ ] **Step 1: Types**

```typescript
// types/saving-plan.ts
export type SavingPlanStatus = 'ACTIVE' | 'COMPLETED' | 'APPLIED' | 'CANCELLED';

export interface SavingPlan {
  id: string;
  planNumber: string;
  targetAmount: number;
  monthlyAmount: number;
  durationMonths: number;
  totalSaved: number;
  status: SavingPlanStatus;
  startedAt: string;
  nextPaymentDueAt: string | null;
  completedAt: string | null;
  targetProductModel: string | null;
  payments: Array<{
    id: string;
    amount: number;
    paidAt: string;
    paymentMethod: string;
  }>;
}
```

- [ ] **Step 2: `PlanCalculator.tsx`**

```tsx
import { useState } from 'react';
import { Input } from '../ui/input';
import { Label } from '../ui/label';

interface Props {
  targetAmount: number;
  onChange: (v: { monthlyAmount: number; durationMonths: number }) => void;
}

export default function PlanCalculator({ targetAmount, onChange }: Props) {
  const [duration, setDuration] = useState(6);
  const monthly = Math.ceil(targetAmount / duration);
  return (
    <div className="space-y-3 leading-snug">
      <div className="space-y-1">
        <Label htmlFor="dur">ออมกี่เดือน</Label>
        <Input
          id="dur"
          type="number"
          min={2}
          max={12}
          value={duration}
          onChange={(e) => {
            const d = Math.min(12, Math.max(2, Number(e.target.value)));
            setDuration(d);
            onChange({ monthlyAmount: Math.ceil(targetAmount / d), durationMonths: d });
          }}
        />
      </div>
      <div className="rounded-xl border border-border p-4">
        <div className="text-sm text-muted-foreground">ออมเดือนละ</div>
        <div className="text-2xl font-bold text-primary">฿{monthly.toLocaleString()}</div>
        <div className="text-xs text-muted-foreground mt-1">
          {duration} เดือน × ฿{monthly.toLocaleString()} = ฿{(monthly * duration).toLocaleString()}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: `PlanProgressBar.tsx`**

```tsx
interface Props { total: number; target: number; }
export default function PlanProgressBar({ total, target }: Props) {
  const pct = Math.min(100, Math.round((total / target) * 100));
  return (
    <div className="space-y-1 leading-snug">
      <div className="h-3 w-full rounded-full bg-muted overflow-hidden">
        <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
      </div>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>฿{total.toLocaleString()}</span>
        <span>{pct}%</span>
        <span>฿{target.toLocaleString()}</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: `PaymentHistoryTable.tsx`**

```tsx
interface Payment { id: string; amount: number; paidAt: string; paymentMethod: string; }
export default function PaymentHistoryTable({ payments }: { payments: Payment[] }) {
  if (payments.length === 0) return <div className="text-muted-foreground text-sm">ยังไม่มีการชำระ</div>;
  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <table className="w-full text-sm leading-snug">
        <thead className="bg-muted/40 text-left">
          <tr><th className="p-3">วันที่</th><th className="p-3">จำนวน</th><th className="p-3">ช่องทาง</th></tr>
        </thead>
        <tbody>
          {payments.map((p) => (
            <tr key={p.id} className="border-t border-border">
              <td className="p-3">{new Date(p.paidAt).toLocaleDateString('th-TH')}</td>
              <td className="p-3 font-semibold">฿{Number(p.amount).toLocaleString()}</td>
              <td className="p-3 text-muted-foreground">{p.paymentMethod}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 5: `SavingPlanLandingPage.tsx`** — 3-step explainer + "Create" CTA → `/saving-plan/create`

Text: "ออมดาวน์ให้เครื่องที่คุณอยากได้ — เก็บเงินทีละน้อย เริ่ม 500 บาท/เดือน"

- [ ] **Step 6: `SavingPlanCreatePage.tsx`**

```tsx
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { api } from '../../lib/api';
import ShopLayout from '../../components/layout/ShopLayout';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Button } from '../../components/ui/button';
import PlanCalculator from '../../components/saving-plan/PlanCalculator';

export default function SavingPlanCreatePage() {
  const nav = useNavigate();
  const [targetAmount, setTargetAmount] = useState(9000);
  const [targetProductModel, setTargetProductModel] = useState('iPhone 13');
  const [calc, setCalc] = useState({ monthlyAmount: 1500, durationMonths: 6 });
  const mut = useMutation({
    mutationFn: () =>
      api
        .post('/api/shop/saving-plans', {
          targetProductModel,
          targetAmount,
          monthlyAmount: calc.monthlyAmount,
          durationMonths: calc.durationMonths,
        })
        .then((r) => r.data),
    onSuccess: (plan) => {
      toast.success('สร้างแผนออมดาวน์แล้ว');
      nav(`/saving-plan/${plan.id}`);
    },
    onError: (e: { response?: { data?: { message?: string } } }) =>
      toast.error(e.response?.data?.message ?? 'สร้างแผนไม่สำเร็จ'),
  });
  return (
    <ShopLayout>
      <div className="container mx-auto px-4 py-6 max-w-xl space-y-6 leading-snug">
        <h1 className="text-2xl font-bold">สร้างแผนออมดาวน์</h1>
        <div className="space-y-1">
          <Label>รุ่นที่อยากได้</Label>
          <Input value={targetProductModel} onChange={(e) => setTargetProductModel(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label>เป้าหมายเงินดาวน์ (บาท)</Label>
          <Input type="number" min={1000} value={targetAmount} onChange={(e) => setTargetAmount(Number(e.target.value))} />
        </div>
        <PlanCalculator targetAmount={targetAmount} onChange={setCalc} />
        <Button className="w-full" onClick={() => mut.mutate()} disabled={mut.isPending}>
          {mut.isPending ? 'กำลังสร้าง...' : 'สร้างแผน'}
        </Button>
      </div>
    </ShopLayout>
  );
}
```

- [ ] **Step 7: `SavingPlanDetailPage.tsx`** — shows PlanProgressBar + pay button + PaymentHistoryTable

```tsx
import { useParams } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../../lib/api';
import ShopLayout from '../../components/layout/ShopLayout';
import PlanProgressBar from '../../components/saving-plan/PlanProgressBar';
import PaymentHistoryTable from '../../components/saving-plan/PaymentHistoryTable';
import { Button } from '../../components/ui/button';

export default function SavingPlanDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data } = useQuery({
    queryKey: ['saving-plan', id],
    queryFn: () => api.get(`/api/shop/saving-plans/${id}`).then((r) => r.data),
    enabled: !!id,
    refetchInterval: 30_000,
  });
  const pay = useMutation({
    mutationFn: () => api.post(`/api/shop/saving-plans/${id}/pay`, { amount: Number(data?.monthlyAmount) }).then((r) => r.data),
    onSuccess: (res: { paymentUrl?: string }) => {
      if (res.paymentUrl) window.location.href = res.paymentUrl;
      else toast.success('เปิดใบชำระแล้ว');
    },
  });
  if (!data) return <ShopLayout><div className="p-8 text-muted-foreground">กำลังโหลด...</div></ShopLayout>;
  return (
    <ShopLayout>
      <div className="container mx-auto px-4 py-6 max-w-xl space-y-4 leading-snug">
        <h1 className="text-2xl font-bold">{data.planNumber}</h1>
        <div className="rounded-xl border border-border p-4 space-y-3">
          <div className="flex justify-between"><span>เป้าหมาย</span><span className="font-semibold">฿{Number(data.targetAmount).toLocaleString()}</span></div>
          <div className="flex justify-between"><span>สะสม</span><span className="font-semibold">฿{Number(data.totalSaved).toLocaleString()}</span></div>
          <PlanProgressBar total={Number(data.totalSaved)} target={Number(data.targetAmount)} />
        </div>
        {data.status === 'ACTIVE' && (
          <Button className="w-full" onClick={() => pay.mutate()} disabled={pay.isPending}>
            {pay.isPending ? 'กำลังสร้างใบชำระ...' : `ชำระงวดนี้ ฿${Number(data.monthlyAmount).toLocaleString()}`}
          </Button>
        )}
        <PaymentHistoryTable payments={data.payments ?? []} />
      </div>
    </ShopLayout>
  );
}
```

- [ ] **Step 8: `SavingPlansPage.tsx` (account)** — list mine

Query `/api/shop/saving-plans`, map to cards linking to detail. 10-line component similar to OrdersPage.

- [ ] **Step 9: Register routes + commit**

```tsx
<Route path="/saving-plan" element={<SavingPlanLandingPage />} />
<Route path="/saving-plan/create" element={<SavingPlanCreatePage />} />
<Route path="/saving-plan/:id" element={<SavingPlanDetailPage />} />
<Route path="/account/saving-plans" element={<SavingPlansPage />} />
```

Commit: `feat(shop-phase3): saving plan landing/create/detail/list pages`

---

## Task 19: Frontend — ReviewsSection on ProductDetailPage

**Files:**
- Create: `apps/web-shop/src/types/review.ts`
- Create: `apps/web-shop/src/components/reviews/ReviewStars.tsx`
- Create: `apps/web-shop/src/components/reviews/ReviewCard.tsx`
- Create: `apps/web-shop/src/components/reviews/CreateReviewForm.tsx`
- Create: `apps/web-shop/src/components/reviews/ReviewsSection.tsx`
- Modify: `apps/web-shop/src/pages/ProductDetailPage.tsx` — mount `<ReviewsSection productId={...} />` at the bottom

- [ ] **Step 1: `ReviewStars.tsx` — display + picker modes**

```tsx
import { Star } from 'lucide-react';

interface Props { value: number; onChange?: (v: number) => void; size?: number; }
export default function ReviewStars({ value, onChange, size = 20 }: Props) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange?.(n)}
          disabled={!onChange}
          aria-label={`${n} stars`}
          className="text-primary"
        >
          <Star size={size} fill={n <= value ? 'currentColor' : 'none'} />
        </button>
      ))}
    </div>
  );
}
```

Requires `lucide-react` in web-shop — if missing, install: `cd apps/web-shop && npm i lucide-react`.

- [ ] **Step 2: `ReviewCard.tsx`**

```tsx
import ReviewStars from './ReviewStars';

interface Props {
  review: {
    id: string;
    rating: number;
    title: string | null;
    comment: string | null;
    verified: boolean;
    createdAt: string;
    customer: { name: string };
  };
}

export default function ReviewCard({ review }: Props) {
  return (
    <div className="rounded-xl border border-border p-4 space-y-2 leading-snug">
      <div className="flex items-center justify-between">
        <ReviewStars value={review.rating} />
        {review.verified && <span className="text-xs text-primary">ซื้อจริง</span>}
      </div>
      {review.title && <div className="font-semibold">{review.title}</div>}
      {review.comment && <p className="text-sm">{review.comment}</p>}
      <div className="text-xs text-muted-foreground">
        {review.customer.name} · {new Date(review.createdAt).toLocaleDateString('th-TH')}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: `CreateReviewForm.tsx`**

```tsx
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../../lib/api';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import ReviewStars from './ReviewStars';

export default function CreateReviewForm({ productId }: { productId: string }) {
  const qc = useQueryClient();
  const [rating, setRating] = useState(5);
  const [title, setTitle] = useState('');
  const [comment, setComment] = useState('');
  const mut = useMutation({
    mutationFn: () => api.post('/api/shop/reviews', { productId, rating, title, comment }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reviews', productId] });
      setTitle(''); setComment('');
      toast.success('ขอบคุณสำหรับรีวิว');
    },
    onError: (e: { response?: { status?: number; data?: { message?: string } } }) => {
      toast.error(e.response?.data?.message ?? 'รีวิวไม่สำเร็จ');
    },
  });
  return (
    <div className="rounded-xl border border-border p-4 space-y-3 leading-snug">
      <div className="font-semibold">เขียนรีวิว</div>
      <ReviewStars value={rating} onChange={setRating} size={28} />
      <Input placeholder="หัวข้อ (ถ้ามี)" value={title} onChange={(e) => setTitle(e.target.value)} />
      <textarea
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        placeholder="รีวิวของคุณ"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        rows={3}
      />
      <Button onClick={() => mut.mutate()} disabled={mut.isPending}>
        {mut.isPending ? 'กำลังส่ง...' : 'ส่งรีวิว'}
      </Button>
    </div>
  );
}
```

- [ ] **Step 4: `ReviewsSection.tsx`**

```tsx
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useAuth } from '../../hooks/useAuth';
import ReviewCard from './ReviewCard';
import ReviewStars from './ReviewStars';
import CreateReviewForm from './CreateReviewForm';

export default function ReviewsSection({ productId }: { productId: string }) {
  const { customer } = useAuth();
  const reviews = useQuery({
    queryKey: ['reviews', productId],
    queryFn: () => api.get(`/api/shop/reviews/${productId}`).then((r) => r.data as any[]),
  });
  const summary = useQuery({
    queryKey: ['reviews-summary', productId],
    queryFn: () => api.get(`/api/shop/reviews/${productId}/summary`).then((r) => r.data as { total: number; average: number }),
  });
  return (
    <section className="space-y-4 leading-snug">
      <h2 className="text-xl font-bold">รีวิวจากผู้ซื้อจริง</h2>
      {summary.data && summary.data.total > 0 && (
        <div className="flex items-center gap-3">
          <ReviewStars value={Math.round(summary.data.average)} />
          <span className="text-sm text-muted-foreground">{summary.data.average} จาก {summary.data.total} รีวิว</span>
        </div>
      )}
      <div className="space-y-3">
        {(reviews.data ?? []).map((r) => <ReviewCard key={r.id} review={r} />)}
        {reviews.data && reviews.data.length === 0 && (
          <div className="text-sm text-muted-foreground">ยังไม่มีรีวิว — เป็นคนแรกที่รีวิวสินค้านี้</div>
        )}
      </div>
      {customer && <CreateReviewForm productId={productId} />}
    </section>
  );
}
```

- [ ] **Step 5: Mount in ProductDetailPage**

In `apps/web-shop/src/pages/ProductDetailPage.tsx`, at the end of the outer grid/container, add:
```tsx
<div className="container mx-auto px-4 pb-8">
  <ReviewsSection productId={id!} />
</div>
```

- [ ] **Step 6: Commit**

```
feat(shop-phase3): reviews section on ProductDetailPage + review components
```

---

## Task 20: Admin web — online-orders queue page

**Files:**
- Create: `apps/web/src/pages/OnlineOrdersPage.tsx`
- Modify: `apps/web/src/App.tsx` — add `/online-orders`
- Modify: sidebar config — add nav entry

- [ ] **Step 1: Page skeleton**

Follow the pattern of `apps/web/src/pages/OverduePage.tsx` — use `PageHeader`, `QueryBoundary`, a data table, status filter dropdown, action buttons. Backend endpoints:
- List: `GET /api/admin/online-orders?status=PAID`
- Ship: `PATCH /api/admin/online-orders/:id/ship` with `{ trackingNumber }`
- Deliver: `PATCH /api/admin/online-orders/:id/deliver`
- Cancel: `PATCH /api/admin/online-orders/:id/cancel` with `{ reason }`
- Confirm bank: `PATCH /api/admin/online-orders/:id/confirm-bank`

Component sketch:
```tsx
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '@/lib/api';
import MainLayout from '@/components/layout/MainLayout';
import PageHeader from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';

const STATUSES = ['', 'PENDING_BANK_REVIEW', 'PAID', 'PACKING', 'SHIPPED', 'DELIVERED', 'CANCELLED'];

export default function OnlineOrdersPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState('PAID');
  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-online-orders', status],
    queryFn: () => api.get(`/api/admin/online-orders?status=${status}`).then((r) => r.data as any[]),
  });

  const shipMut = useMutation({
    mutationFn: ({ id, trackingNumber }: { id: string; trackingNumber: string }) =>
      api.patch(`/api/admin/online-orders/${id}/ship`, { trackingNumber }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-online-orders'] });
      toast.success('บันทึกการจัดส่งแล้ว');
    },
  });
  const confirmBank = useMutation({
    mutationFn: (id: string) => api.patch(`/api/admin/online-orders/${id}/confirm-bank`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-online-orders'] }),
  });
  const deliverMut = useMutation({
    mutationFn: (id: string) => api.patch(`/api/admin/online-orders/${id}/deliver`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-online-orders'] }),
  });

  return (
    <MainLayout>
      <PageHeader title="คำสั่งซื้อออนไลน์" />
      <div className="p-4 space-y-4">
        <div className="flex gap-2 items-center">
          {STATUSES.map((s) => (
            <button
              key={s || 'all'}
              onClick={() => setStatus(s)}
              className={`rounded-full px-3 py-1 text-sm ${status === s ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}
            >
              {s || 'ทั้งหมด'}
            </button>
          ))}
        </div>
        {isLoading && <div className="text-muted-foreground">กำลังโหลด...</div>}
        {error && <div className="text-destructive">{String((error as any).message)}</div>}
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left">
              <tr>
                <th className="p-3">เลขที่</th>
                <th className="p-3">ลูกค้า</th>
                <th className="p-3">สินค้า</th>
                <th className="p-3 text-right">ยอดรวม</th>
                <th className="p-3">สถานะ</th>
                <th className="p-3">การจัดการ</th>
              </tr>
            </thead>
            <tbody>
              {(data ?? []).map((o: any) => (
                <OrderRow
                  key={o.id}
                  order={o}
                  onShip={(trackingNumber) => shipMut.mutate({ id: o.id, trackingNumber })}
                  onConfirmBank={() => confirmBank.mutate(o.id)}
                  onDeliver={() => deliverMut.mutate(o.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </MainLayout>
  );
}

function OrderRow({ order, onShip, onConfirmBank, onDeliver }: {
  order: any;
  onShip: (t: string) => void;
  onConfirmBank: () => void;
  onDeliver: () => void;
}) {
  const [tracking, setTracking] = useState(order.trackingNumber ?? '');
  return (
    <tr className="border-t border-border">
      <td className="p-3 font-mono">{order.orderNumber}</td>
      <td className="p-3">{order.customer?.name ?? '-'}<div className="text-xs text-muted-foreground">{order.customer?.phone}</div></td>
      <td className="p-3">{order.product?.name}</td>
      <td className="p-3 text-right">฿{Number(order.totalAmount).toLocaleString()}</td>
      <td className="p-3">{order.status}</td>
      <td className="p-3 space-y-1">
        {order.status === 'PENDING_BANK_REVIEW' && <Button size="sm" onClick={onConfirmBank}>ยืนยันสลิป</Button>}
        {['PAID', 'PACKING'].includes(order.status) && (
          <div className="flex gap-1">
            <Input value={tracking} onChange={(e) => setTracking(e.target.value)} placeholder="tracking #" />
            <Button size="sm" onClick={() => tracking && onShip(tracking)}>ส่ง</Button>
          </div>
        )}
        {order.status === 'SHIPPED' && <Button size="sm" variant="outline" onClick={onDeliver}>ส่งถึงแล้ว</Button>}
      </td>
    </tr>
  );
}
```

- [ ] **Step 2: Routes + sidebar + commit**

Add `<Route path="/online-orders" element={<OnlineOrdersPage />} />` and a sidebar entry under the existing "Core Business" group.

Commit: `feat(shop-phase3): admin /online-orders queue page`

---

## Task 21: Admin web — installment-applications queue

Same pattern as Task 20. Backend endpoints from Task 3:
- List: `GET /api/admin/installment-applications?status=SUBMITTED`
- Schedule: `PATCH /api/admin/installment-applications/:id/schedule` with `{ scheduledAt }`
- Approve: `PATCH /api/admin/installment-applications/:id/approve`
- Reject: `PATCH /api/admin/installment-applications/:id/reject` with `{ rejectReason }`
- Link contract: `PATCH /api/admin/installment-applications/:id/link-contract` with `{ contractId }`

**Files:**
- Create: `apps/web/src/pages/InstallmentApplicationsPage.tsx`
- Modify: `apps/web/src/App.tsx` + sidebar

- [ ] **Step 1: Implement page**

Columns: เลขที่ใบสมัคร, ชื่อ, โทร, สินค้า, ดาวน์, งวด, สถานะ, การจัดการ.

Row actions:
- SUBMITTED → input datetime → "นัดเยี่ยมชม" (schedule) + "ปฏิเสธ"
- SCHEDULED → "อนุมัติ" + "ปฏิเสธ"
- APPROVED → input contractId → "ผูกสัญญา"

- [ ] **Step 2: Routes + sidebar + commit**

```
feat(shop-phase3): admin /installment-applications queue page
```

---

## Task 22: Admin web — saving-plans overview + reviews moderation

**Files:**
- Create: `apps/web/src/pages/SavingPlansAdminPage.tsx`
- Create: `apps/web/src/pages/ReviewsModerationPage.tsx`
- Modify: `App.tsx` + sidebar

- [ ] **Step 1: SavingPlansAdminPage** — read-only list with filters (status), columns: planNumber, ลูกค้า, เป้าหมาย, สะสม, งวดถัดไป, สถานะ

Call `GET /api/admin/saving-plans?status=ACTIVE` — needs admin controller added.

**Note**: Task 8's `shop-saving-plan.module.ts` doesn't include an admin controller. Add it here:

```typescript
// apps/api/src/modules/shop-saving-plan/shop-saving-plan.admin.controller.ts
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { PrismaService } from '../../prisma/prisma.service';

@Controller('admin/saving-plans')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
export class ShopSavingPlanAdminController {
  constructor(private prisma: PrismaService) {}

  @Get()
  list(@Query('status') status?: string) {
    return this.prisma.savingPlan.findMany({
      where: { deletedAt: null, ...(status ? { status: status as any } : {}) },
      include: {
        customer: { select: { name: true, phone: true } },
        payments: { orderBy: { paidAt: 'desc' }, take: 1 },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }
}
```

Register in module. Then build the admin page on top of it.

- [ ] **Step 2: ReviewsModerationPage** — table: customer, product, rating, comment, status, actions (hide/restore)

Uses `GET /api/admin/reviews` and `PATCH /api/admin/reviews/:id/hide`, `/restore` from Task 11.

- [ ] **Step 3: Trade-in admin filter addition**

Extend the existing `TradeInPage` to include a `submissionSource` filter toggle (All / Online / Offline) and a `flow` filter (Exchange / Buyback) by passing `?submissionSource=ONLINE&flow=BUYBACK` to the list endpoint (Task 7 already supports these query params).

- [ ] **Step 4: Routes + sidebar + commit**

Commit: `feat(shop-phase3): admin saving-plans overview + reviews moderation + trade-in online filter`

---

## Task 23: Analytics events — wire up key conversions

**Files:**
- Modify: `apps/web-shop/src/pages/CatalogPage.tsx`
- Modify: `apps/web-shop/src/pages/ProductDetailPage.tsx`
- Modify: `apps/web-shop/src/pages/CartPage.tsx`
- Modify: `apps/web-shop/src/pages/CheckoutPage.tsx`
- Modify: `apps/web-shop/src/pages/OrderSuccessPage.tsx`

- [ ] **Step 1: Fire events at key points**

In each page, import `useTrackEvent`, then call:
- CatalogPage on mount: `track('ViewContent', { content_type: 'catalog' })`
- ProductDetailPage when data loads: `track('ViewContent', { content_type: 'product', content_ids: [id] })`
- ProductDetailPage on reservation success: `track('AddToCart', { content_ids: [id], value: price, currency: 'THB' })`
- CheckoutPage on mount: `track('InitiateCheckout')`
- OrderSuccessPage when status becomes 'PAID': `track('Purchase', { value: Number(data.totalAmount), currency: 'THB' })`

- [ ] **Step 2: Commit**

```
feat(shop-phase3): analytics events on catalog/detail/cart/checkout/success
```

---

## Task 24: E2E smoke + final verification

**Files:**
- Create: `apps/web/e2e/shop-phase3-apply.spec.ts`

- [ ] **Step 1: E2E smoke (skipped)**

```typescript
import { test, expect } from '@playwright/test';

test.describe.skip('Phase 3: apply + trade-in + saving plan — enable after seed fixtures', () => {
  test('installment apply submits successfully', async ({ page }) => {
    await page.goto('http://localhost:5174/apply/<product-id>');
    await page.getByLabel('ชื่อ-นามสกุล').fill('บีม ทดสอบ');
    await page.getByLabel('เบอร์โทร').fill('0812345678');
    await page.getByLabel('เลขบัตรประชาชน').fill('1234567890123');
    await page.getByRole('button', { name: /ส่งใบสมัคร/ }).click();
    await expect(page).toHaveURL(/\/apply\/success\//);
  });
});
```

- [ ] **Step 2: Full type + test sweep**

```bash
./tools/check-types.sh all
cd apps/api && npx jest --testPathPattern='shop-' --silent | tail -8
cd apps/web-shop && npm run build
cd ../web && npm run build
```

Expected: 0 TS errors, all shop-* suites green, both web builds succeed.

- [ ] **Step 3: Manual smoke**

Start: `npm run dev` + `cd apps/web-shop && npm run dev`
1. Submit an application at `/apply/:productId` → check `/api/admin/installment-applications` lists it
2. Submit trade-in with 1 photo → check admin trade-in page shows it with `submissionSource=ONLINE`
3. Create saving plan → pay first installment → check balance increments after webhook
4. Review product → verify `verified=true` is enforced (attempt to review without a Sale returns 403)

- [ ] **Step 4: Commit**

```
test(shop-phase3): E2E apply smoke scaffold + final verification pass
```

---

## Task 25: Finish — merge or PR

Follow `superpowers:finishing-a-development-branch` — verify tests pass, pick merge-locally vs push-PR.

---

## Out of scope (documented)

- Refund API integration (PaySolutions refund endpoint) — status flips to REFUNDED only; actual gateway refund happens manually in PaySolutions dashboard
- A/B testing infrastructure — plan a dedicated sprint post-launch
- LINE chatbot (not LIFF) — reuse existing `chat-engine` module when business needs scaled triage
- LIFF-native shop — post-launch optimization
- Segment + retargeting dashboards — ingest GA4/FB Pixel data externally
- Buyback instant KYC — current flow relies on branch visit for ID verification; remote eKYC is a separate project

## Dependencies on Owner Actions

| Owner action | Blocks | Workaround |
|---|---|---|
| `SHOP_STAFF_LINE_ID` env (Phase 1 carryover) | LINE notifications on application submit/reject | Endpoint still succeeds; notification silently no-ops |
| GA4 property + FB Pixel ID | Task 13 `initAnalytics` | Uninitialized when `VITE_GA4_ID`/`VITE_FB_PIXEL_ID` unset — events are no-ops, not errors |
| `TradeInValuation` seed data | Trade-in/buyback estimate endpoint | Returns `{ available: false, min: 0, max: 0 }` when no entry; admin can appraise manually |
| PaySolutions sandbox credentials | Saving-plan payment, installment checkout | Use `BANK_TRANSFER` channel in tests + manual webhook simulation |

---

**Plan complete.**

