# Loyalty Admin Page + Policy Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-04-19-loyalty-admin-page-design.md`

**Goal:** Build admin-level Loyalty page + editable Policy engine; wire earn triggers for cash/GFIN/FINANCE-completion + referral; activity-based expiry cron.

**Architecture:** New `LoyaltyAdjustment` + `LoyaltyPolicy` tables alongside existing `LoyaltyPoint`/`LoyaltyRedemption`. Refactor `LoyaltyService` to read rates from policy (5-min cache w/ fallback). Single admin page `/loyalty` with 4 tabs + settings page `/settings/loyalty-policy`. Daily cron expires inactive customers' balances. Maker-checker approval workflow with asymmetric threshold (auto-approve small bonuses, manual for penalties).

**Tech Stack:** NestJS + Prisma + PostgreSQL (API), React 18 + Vite + shadcn/ui + @tanstack/react-query + react-hook-form + zod (Web), Jest (API tests), Vitest + React Testing Library (Web tests), Playwright (E2E), BullMQ (cron).

---

## File Structure

### Backend (Create)
- `apps/api/src/modules/loyalty-policy/loyalty-policy.module.ts` — NestJS module
- `apps/api/src/modules/loyalty-policy/loyalty-policy.controller.ts` — GET/PATCH `/settings/loyalty-policy`
- `apps/api/src/modules/loyalty-policy/loyalty-policy.service.ts` — CRUD + 5-min cache
- `apps/api/src/modules/loyalty-policy/loyalty-policy.service.spec.ts`
- `apps/api/src/modules/loyalty-policy/dto/loyalty-policy.dto.ts` — UpdatePolicy DTO
- `apps/api/src/modules/loyalty-admin/loyalty-admin.module.ts`
- `apps/api/src/modules/loyalty-admin/loyalty-admin.controller.ts` — 6 endpoints under `/loyalty/*`
- `apps/api/src/modules/loyalty-admin/loyalty-admin.service.ts` — overview, customers, referrals, adjustments
- `apps/api/src/modules/loyalty-admin/loyalty-admin.service.spec.ts`
- `apps/api/src/modules/loyalty-admin/dto/loyalty-admin.dto.ts` — CreateAdjustment, ReviewAdjustment, OverviewQuery DTOs
- `apps/api/src/modules/loyalty/cron/loyalty-expiry.cron.ts` — daily expiry job
- `apps/api/src/modules/loyalty/cron/loyalty-expiry.cron.spec.ts`

### Backend (Modify)
- `apps/api/prisma/schema.prisma` — add 2 models + 2 enums + 1 field
- `apps/api/src/modules/loyalty/loyalty.service.ts` — refactor to read policy
- `apps/api/src/modules/loyalty/loyalty.module.ts` — import `LoyaltyPolicyModule`
- `apps/api/src/modules/loyalty/cron/loyalty-expiry.cron.ts` (new, under existing module)
- `apps/api/src/app.module.ts` — register 2 new modules
- `apps/api/src/modules/pos/pos.service.ts` — wire cash sale earn
- `apps/api/src/modules/contracts/contracts.service.ts` — wire GFIN activate + FINANCE completion bonus + referral (CONTRACT_ACTIVATE)
- `apps/api/src/modules/payments/payments.service.ts` — wire referral (FIRST_PAYMENT / THIRD_PAYMENT); update `lastLoyaltyActivityAt`
- `apps/api/src/modules/customers/customers.service.ts` — wire referral (REGISTER)

### Frontend (Create)
- `apps/web/src/pages/LoyaltyPage/index.tsx` — main page with 4 tabs
- `apps/web/src/pages/LoyaltyPage/types.ts` — shared types
- `apps/web/src/pages/LoyaltyPage/components/LoyaltyOverview.tsx` — metric cards + top 10
- `apps/web/src/pages/LoyaltyPage/components/LoyaltyCustomers.tsx` — paginated list
- `apps/web/src/pages/LoyaltyPage/components/LoyaltyReferrals.tsx` — tree view
- `apps/web/src/pages/LoyaltyPage/components/LoyaltyAdjustments.tsx` — queue + history
- `apps/web/src/pages/LoyaltyPage/components/AdjustmentModal.tsx` — request form
- `apps/web/src/pages/LoyaltyPage/components/ReferralTree.tsx` — recursive tree
- `apps/web/src/pages/LoyaltyPolicySettingsPage.tsx` — settings form
- `apps/web/src/pages/LoyaltyPage/__tests__/LoyaltyAdjustments.test.tsx`
- `apps/web/src/pages/LoyaltyPage/__tests__/ReferralTree.test.tsx`
- `apps/web/src/pages/__tests__/LoyaltyPolicySettingsPage.test.tsx`

### Frontend (Modify)
- `apps/web/src/App.tsx` — add 2 routes (lazy)
- `apps/web/src/components/MainLayout.tsx` or sidebar config — add menu items
- `apps/web/e2e/loyalty-admin.spec.ts` (new E2E spec)

---

## Phase A — Schema & Migration (Agent 1, blocks others)

### Task A1: Add Prisma models & migration

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/YYYYMMDDHHMMSS_add_loyalty_admin_policy/migration.sql` (via `prisma migrate dev`)

- [ ] **Step 1: Add enums to schema.prisma**

Find the other enum declarations near the top of `schema.prisma` and add:

```prisma
enum AdjustmentStatus {
  PENDING
  APPROVED
  REJECTED
  AUTO_APPROVED
}

enum AdjustmentReason {
  BONUS_CAMPAIGN
  STAFF_ERROR
  CUSTOMER_COMPLAINT
  MANUAL_OTHER
}
```

- [ ] **Step 2: Add `LoyaltyAdjustment` model**

Append near the existing `LoyaltyPoint` / `LoyaltyRedemption` models:

```prisma
model LoyaltyAdjustment {
  id           String             @id @default(uuid())
  customerId   String             @map("customer_id")
  delta        Int
  reason       AdjustmentReason
  note         String?
  status       AdjustmentStatus   @default(PENDING)
  requestedBy  String             @map("requested_by")
  approvedBy   String?            @map("approved_by")
  approvedAt   DateTime?          @map("approved_at")
  rejectReason String?            @map("reject_reason")

  createdAt DateTime  @default(now()) @map("created_at")
  updatedAt DateTime  @updatedAt      @map("updated_at")
  deletedAt DateTime? @map("deleted_at")

  customer  Customer @relation(fields: [customerId], references: [id])
  requester User     @relation("AdjustRequester", fields: [requestedBy], references: [id])
  approver  User?    @relation("AdjustApprover",  fields: [approvedBy],  references: [id])

  @@index([status, createdAt])
  @@index([customerId])
  @@map("loyalty_adjustments")
}
```

- [ ] **Step 3: Add `LoyaltyPolicy` model**

Append:

```prisma
model LoyaltyPolicy {
  id String @id @default("singleton")

  pointsPerBahtCash    Decimal @db.Decimal(8,6) @default(0.01) @map("points_per_baht_cash")
  pointsPerBahtGfin    Decimal @db.Decimal(8,6) @default(0.01) @map("points_per_baht_gfin")
  pointsPerBahtFinance Decimal @db.Decimal(8,6) @default(0.01) @map("points_per_baht_finance")
  completionBonus      Int     @default(500) @map("completion_bonus")

  referralBonus   Int    @default(500) @map("referral_bonus")
  referralTrigger String @default("FIRST_PAYMENT") @map("referral_trigger")

  inactivityMonths Int     @default(12) @map("inactivity_months")
  minRedeemPoints  Int     @default(100) @map("min_redeem_points")
  bahtPerPoint     Decimal @db.Decimal(8,2) @default(1.00) @map("baht_per_point")

  isActive  Boolean   @default(true) @map("is_active")
  updatedBy String?   @map("updated_by")
  updatedAt DateTime  @updatedAt @map("updated_at")
  createdAt DateTime  @default(now()) @map("created_at")

  @@map("loyalty_policy")
}
```

- [ ] **Step 4: Add `lastLoyaltyActivityAt` + inverse relations on `Customer` and `User`**

In `Customer` model, inside the fields list add:
```prisma
  lastLoyaltyActivityAt DateTime? @map("last_loyalty_activity_at")
  loyaltyAdjustments    LoyaltyAdjustment[]
```

In `User` model add:
```prisma
  loyaltyAdjustmentsRequested LoyaltyAdjustment[] @relation("AdjustRequester")
  loyaltyAdjustmentsApproved  LoyaltyAdjustment[] @relation("AdjustApprover")
```

- [ ] **Step 5: Generate migration**

Run:
```bash
cd apps/api && npx prisma migrate dev --name add_loyalty_admin_policy
```

Expected: migration file created, schema applied to dev DB.

- [ ] **Step 6: Backfill `lastLoyaltyActivityAt`**

Append to the generated migration SQL file:
```sql
-- Backfill lastLoyaltyActivityAt from most recent LoyaltyPoint for customers with balance
UPDATE customers c
SET last_loyalty_activity_at = (
  SELECT MAX(lp.created_at)
  FROM loyalty_points lp
  WHERE lp.customer_id = c.id AND lp.deleted_at IS NULL
)
WHERE c.loyalty_balance > 0 AND c.deleted_at IS NULL;

-- Seed LoyaltyPolicy singleton row with current defaults
INSERT INTO loyalty_policy (id)
VALUES ('singleton')
ON CONFLICT (id) DO NOTHING;
```

Re-apply:
```bash
cd apps/api && npx prisma migrate resolve --applied <migration-name-from-step-5>
# or reset if dev: npx prisma migrate reset --skip-seed && npx prisma migrate dev
```

- [ ] **Step 7: Run type check**

Run: `./tools/check-types.sh api`
Expected: 0 errors.

- [ ] **Step 8: Commit**

```bash
git add apps/api/prisma/
git commit -m "feat(loyalty): add LoyaltyAdjustment + LoyaltyPolicy schema"
```

---

## Phase B — Policy Service (Agent 1)

### Task B1: Create LoyaltyPolicyService with caching

**Files:**
- Create: `apps/api/src/modules/loyalty-policy/loyalty-policy.service.ts`
- Create: `apps/api/src/modules/loyalty-policy/loyalty-policy.service.spec.ts`
- Create: `apps/api/src/modules/loyalty-policy/dto/loyalty-policy.dto.ts`

- [ ] **Step 1: Write failing test — cache + fallback**

Create `apps/api/src/modules/loyalty-policy/loyalty-policy.service.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { LoyaltyPolicyService } from './loyalty-policy.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('LoyaltyPolicyService', () => {
  let service: LoyaltyPolicyService;
  let prisma: { loyaltyPolicy: { findUnique: jest.Mock; upsert: jest.Mock } };

  beforeEach(async () => {
    prisma = { loyaltyPolicy: { findUnique: jest.fn(), upsert: jest.fn() } };
    const mod = await Test.createTestingModule({
      providers: [
        LoyaltyPolicyService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = mod.get(LoyaltyPolicyService);
  });

  it('returns DB policy on first call', async () => {
    prisma.loyaltyPolicy.findUnique.mockResolvedValue({
      id: 'singleton',
      pointsPerBahtCash: '0.02',
      referralBonus: 500,
    });
    const p = await service.getPolicy();
    expect(Number(p.pointsPerBahtCash)).toBe(0.02);
  });

  it('caches for 5 minutes (no second DB call)', async () => {
    prisma.loyaltyPolicy.findUnique.mockResolvedValue({ id: 'singleton', referralBonus: 500 });
    await service.getPolicy();
    await service.getPolicy();
    expect(prisma.loyaltyPolicy.findUnique).toHaveBeenCalledTimes(1);
  });

  it('invalidates cache on update', async () => {
    prisma.loyaltyPolicy.findUnique.mockResolvedValue({ id: 'singleton', referralBonus: 500 });
    prisma.loyaltyPolicy.upsert.mockResolvedValue({ id: 'singleton', referralBonus: 777 });
    await service.getPolicy();
    await service.updatePolicy({ referralBonus: 777 } as any, 'user-1');
    await service.getPolicy();
    expect(prisma.loyaltyPolicy.findUnique).toHaveBeenCalledTimes(2);
  });

  it('falls back to defaults on DB error', async () => {
    prisma.loyaltyPolicy.findUnique.mockRejectedValue(new Error('db down'));
    const p = await service.getPolicy();
    expect(Number(p.pointsPerBahtCash)).toBe(0.01);
    expect(p.referralBonus).toBe(500);
  });
});
```

- [ ] **Step 2: Run — expect FAIL (module not built)**

Run: `cd apps/api && npx jest loyalty-policy.service.spec --no-coverage`
Expected: `Cannot find module './loyalty-policy.service'`

- [ ] **Step 3: Create DTO**

Create `apps/api/src/modules/loyalty-policy/dto/loyalty-policy.dto.ts`:

```typescript
import { IsNumber, IsOptional, IsBoolean, IsInt, IsIn, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateLoyaltyPolicyDto {
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) pointsPerBahtCash?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) pointsPerBahtGfin?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) pointsPerBahtFinance?: number;
  @IsOptional() @IsInt() @Min(0) completionBonus?: number;
  @IsOptional() @IsInt() @Min(0) referralBonus?: number;
  @IsOptional() @IsIn(['REGISTER', 'FIRST_PAYMENT', 'CONTRACT_ACTIVATE', 'THIRD_PAYMENT'])
  referralTrigger?: string;
  @IsOptional() @IsInt() @Min(1) inactivityMonths?: number;
  @IsOptional() @IsInt() @Min(0) minRedeemPoints?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) bahtPerPoint?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
```

- [ ] **Step 4: Create service**

Create `apps/api/src/modules/loyalty-policy/loyalty-policy.service.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateLoyaltyPolicyDto } from './dto/loyalty-policy.dto';

const CACHE_TTL_MS = 5 * 60 * 1000;

export interface LoyaltyPolicyResolved {
  id: string;
  pointsPerBahtCash: number;
  pointsPerBahtGfin: number;
  pointsPerBahtFinance: number;
  completionBonus: number;
  referralBonus: number;
  referralTrigger: 'REGISTER' | 'FIRST_PAYMENT' | 'CONTRACT_ACTIVATE' | 'THIRD_PAYMENT';
  inactivityMonths: number;
  minRedeemPoints: number;
  bahtPerPoint: number;
  isActive: boolean;
}

const DEFAULTS: LoyaltyPolicyResolved = {
  id: 'singleton',
  pointsPerBahtCash: 0.01,
  pointsPerBahtGfin: 0.01,
  pointsPerBahtFinance: 0.01,
  completionBonus: 500,
  referralBonus: 500,
  referralTrigger: 'FIRST_PAYMENT',
  inactivityMonths: 12,
  minRedeemPoints: 100,
  bahtPerPoint: 1.0,
  isActive: true,
};

@Injectable()
export class LoyaltyPolicyService {
  private readonly logger = new Logger(LoyaltyPolicyService.name);
  private cache: { value: LoyaltyPolicyResolved; expiresAt: number } | null = null;

  constructor(private prisma: PrismaService) {}

  async getPolicy(): Promise<LoyaltyPolicyResolved> {
    if (this.cache && Date.now() < this.cache.expiresAt) return this.cache.value;
    try {
      const row = await this.prisma.loyaltyPolicy.findUnique({ where: { id: 'singleton' } });
      const resolved: LoyaltyPolicyResolved = row
        ? {
            id: row.id,
            pointsPerBahtCash: Number(row.pointsPerBahtCash),
            pointsPerBahtGfin: Number(row.pointsPerBahtGfin),
            pointsPerBahtFinance: Number(row.pointsPerBahtFinance),
            completionBonus: row.completionBonus,
            referralBonus: row.referralBonus,
            referralTrigger: row.referralTrigger as LoyaltyPolicyResolved['referralTrigger'],
            inactivityMonths: row.inactivityMonths,
            minRedeemPoints: row.minRedeemPoints,
            bahtPerPoint: Number(row.bahtPerPoint),
            isActive: row.isActive,
          }
        : DEFAULTS;
      this.cache = { value: resolved, expiresAt: Date.now() + CACHE_TTL_MS };
      return resolved;
    } catch (err) {
      this.logger.error('Failed to read LoyaltyPolicy, using defaults', err as Error);
      return DEFAULTS;
    }
  }

  invalidate(): void {
    this.cache = null;
  }

  async updatePolicy(dto: UpdateLoyaltyPolicyDto, userId: string) {
    const row = await this.prisma.loyaltyPolicy.upsert({
      where: { id: 'singleton' },
      update: { ...dto, updatedBy: userId },
      create: { id: 'singleton', ...dto, updatedBy: userId },
    });
    this.invalidate();
    return row;
  }
}
```

- [ ] **Step 5: Run test — expect PASS**

Run: `cd apps/api && npx jest loyalty-policy.service.spec --no-coverage`
Expected: 4 tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/loyalty-policy/
git commit -m "feat(loyalty): add LoyaltyPolicyService with caching + fallback"
```

### Task B2: Controller + Module wiring

**Files:**
- Create: `apps/api/src/modules/loyalty-policy/loyalty-policy.controller.ts`
- Create: `apps/api/src/modules/loyalty-policy/loyalty-policy.module.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: Write controller**

Create `apps/api/src/modules/loyalty-policy/loyalty-policy.controller.ts`:

```typescript
import {
  Body,
  Controller,
  Get,
  Patch,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { LoyaltyPolicyService } from './loyalty-policy.service';
import { UpdateLoyaltyPolicyDto } from './dto/loyalty-policy.dto';

@Controller('settings/loyalty-policy')
@UseGuards(JwtAuthGuard, RolesGuard)
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class LoyaltyPolicyController {
  constructor(private service: LoyaltyPolicyService) {}

  @Get()
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  get() {
    return this.service.getPolicy();
  }

  @Patch()
  @Roles('OWNER')
  update(@Body() dto: UpdateLoyaltyPolicyDto, @Req() req: Request) {
    const userId = (req as any).user?.id ?? 'system';
    return this.service.updatePolicy(dto, userId);
  }
}
```

- [ ] **Step 2: Write module**

Create `apps/api/src/modules/loyalty-policy/loyalty-policy.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { LoyaltyPolicyService } from './loyalty-policy.service';
import { LoyaltyPolicyController } from './loyalty-policy.controller';

@Module({
  controllers: [LoyaltyPolicyController],
  providers: [LoyaltyPolicyService],
  exports: [LoyaltyPolicyService],
})
export class LoyaltyPolicyModule {}
```

- [ ] **Step 3: Register in app.module.ts**

Open `apps/api/src/app.module.ts`, add import:
```typescript
import { LoyaltyPolicyModule } from './modules/loyalty-policy/loyalty-policy.module';
```
and add `LoyaltyPolicyModule` to the `imports: [...]` array (near `LoyaltyModule`).

- [ ] **Step 4: Run type check**

Run: `./tools/check-types.sh api`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/loyalty-policy/ apps/api/src/app.module.ts
git commit -m "feat(loyalty): wire LoyaltyPolicy controller + module"
```

---

## Phase C — Refactor LoyaltyService to use Policy (Agent 1)

### Task C1: Inject policy + read rates instead of constants

**Files:**
- Modify: `apps/api/src/modules/loyalty/loyalty.service.ts`
- Modify: `apps/api/src/modules/loyalty/loyalty.module.ts`

- [ ] **Step 1: Add failing test for policy-driven rate**

Append to `apps/api/src/modules/loyalty/loyalty.service.spec.ts`:

```typescript
describe('LoyaltyService — policy-driven rates', () => {
  it('calcPointsForPayment uses policy pointsPerBahtFinance', async () => {
    const policy = { getPolicy: jest.fn().mockResolvedValue({ pointsPerBahtFinance: 0.02 }) };
    const prisma = {};
    const service = new (require('./loyalty.service').LoyaltyService)(prisma, policy);
    const pts = await service.calcPointsForPayment(1000);
    expect(pts).toBe(20);
  });

  it('falls back to 0.01 if policy throws', async () => {
    const policy = { getPolicy: jest.fn().mockRejectedValue(new Error()) };
    const prisma = {};
    const service = new (require('./loyalty.service').LoyaltyService)(prisma, policy);
    const pts = await service.calcPointsForPayment(1000);
    expect(pts).toBe(10);
  });
});
```

- [ ] **Step 2: Run — expect FAIL (constructor mismatch)**

Run: `cd apps/api && npx jest loyalty.service.spec --no-coverage`
Expected: calcPointsForPayment is static, constructor doesn't accept policy.

- [ ] **Step 3: Refactor `LoyaltyService` constructor and method**

In `apps/api/src/modules/loyalty/loyalty.service.ts`:

Change constructor:
```typescript
constructor(
  private prisma: PrismaService,
  private policy: LoyaltyPolicyService,
) {}
```

Add import at top:
```typescript
import { LoyaltyPolicyService } from '../loyalty-policy/loyalty-policy.service';
```

Convert `static calcPointsForPayment` to instance method:
```typescript
async calcPointsForPayment(amountBaht: number, channel: 'CASH' | 'GFIN' | 'FINANCE' = 'FINANCE'): Promise<number> {
  try {
    const p = await this.policy.getPolicy();
    const rate =
      channel === 'CASH' ? p.pointsPerBahtCash :
      channel === 'GFIN' ? p.pointsPerBahtGfin : p.pointsPerBahtFinance;
    return Math.floor(amountBaht * rate);
  } catch {
    return Math.floor(amountBaht * 0.01);
  }
}
```

Keep the existing `POINTS_PER_BAHT` const as a local constant inside `calcPointsForPayment` fallback path only — remove the other exports. Also keep `REFERRAL_POINTS` const but mark as fallback; `awardReferralPoints` should read `policy.referralBonus` (see Task C2).

- [ ] **Step 4: Replace static call sites**

Run: `grep -rn "LoyaltyService.calcPointsForPayment" apps/api/src --files-with-matches`

For each file found (likely `payments.service.ts`), convert static call to instance call. For example in `apps/api/src/modules/payments/payments.service.ts` replace:
```typescript
const points = LoyaltyService.calcPointsForPayment(amount);
```
with:
```typescript
const points = await this.loyaltyService.calcPointsForPayment(amount, 'FINANCE');
```

Ensure constructor of `PaymentsService` injects `LoyaltyService` (check existing import — likely already exists as it's called in `awardLoyaltyPoints`).

- [ ] **Step 5: Update loyalty.module.ts to import policy**

Modify `apps/api/src/modules/loyalty/loyalty.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { LoyaltyController } from './loyalty.controller';
import { LoyaltyService } from './loyalty.service';
import { LoyaltyPolicyModule } from '../loyalty-policy/loyalty-policy.module';

@Module({
  imports: [LoyaltyPolicyModule],
  controllers: [LoyaltyController],
  providers: [LoyaltyService],
  exports: [LoyaltyService],
})
export class LoyaltyModule {}
```

- [ ] **Step 6: Refactor `awardReferralPoints` to use policy**

In `loyalty.service.ts`, inside `awardReferralPoints`, replace `REFERRAL_POINTS` use with:
```typescript
const policy = await this.policy.getPolicy();
const referralBonus = policy.referralBonus;
```
and use `referralBonus` in `loyaltyBalance: { increment: referralBonus }` and log.

- [ ] **Step 7: Run all loyalty tests**

Run: `cd apps/api && npx jest loyalty --no-coverage`
Expected: all previous loyalty tests still pass + new policy-driven tests pass.

- [ ] **Step 8: Type check all**

Run: `./tools/check-types.sh api`
Expected: 0 errors.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/modules/loyalty/ apps/api/src/modules/payments/
git commit -m "refactor(loyalty): read rates from LoyaltyPolicy with fallback"
```

---

## Phase D — Adjustment Workflow (Agent 1)

### Task D1: Create LoyaltyAdminService — submit adjustment

**Files:**
- Create: `apps/api/src/modules/loyalty-admin/loyalty-admin.service.ts`
- Create: `apps/api/src/modules/loyalty-admin/loyalty-admin.service.spec.ts`
- Create: `apps/api/src/modules/loyalty-admin/dto/loyalty-admin.dto.ts`

- [ ] **Step 1: Write failing test — submit + auto-approve + self-approve guard**

Create `apps/api/src/modules/loyalty-admin/loyalty-admin.service.spec.ts`:

```typescript
import { BadRequestException } from '@nestjs/common';
import { LoyaltyAdminService } from './loyalty-admin.service';
import { AdjustmentReason, AdjustmentStatus } from '@prisma/client';

describe('LoyaltyAdminService.submitAdjustment', () => {
  const mockPrisma = () => ({
    $transaction: jest.fn().mockImplementation(async (fn) => fn(mockPrisma())),
    loyaltyAdjustment: { create: jest.fn() },
    customer: { update: jest.fn(), findUnique: jest.fn() },
    loyaltyPoint: { create: jest.fn() },
  });

  let prisma: any;
  let service: LoyaltyAdminService;

  beforeEach(() => {
    prisma = mockPrisma();
    prisma.customer.findUnique.mockResolvedValue({ id: 'c1', loyaltyBalance: 100 });
    service = new LoyaltyAdminService(prisma as any);
  });

  it('auto-approves delta 1..20', async () => {
    prisma.loyaltyAdjustment.create.mockResolvedValue({ id: 'a1', status: 'AUTO_APPROVED', delta: 15 });
    const result = await service.submitAdjustment('user-sales-1', {
      customerId: 'c1',
      delta: 15,
      reason: AdjustmentReason.BONUS_CAMPAIGN,
    });
    expect(result.status).toBe('AUTO_APPROVED');
    expect(prisma.customer.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ loyaltyBalance: { increment: 15 } }) }),
    );
  });

  it('queues PENDING for delta > 20', async () => {
    prisma.loyaltyAdjustment.create.mockResolvedValue({ id: 'a2', status: 'PENDING', delta: 50 });
    const result = await service.submitAdjustment('user-sales-1', {
      customerId: 'c1',
      delta: 50,
      reason: AdjustmentReason.BONUS_CAMPAIGN,
    });
    expect(result.status).toBe('PENDING');
    expect(prisma.customer.update).not.toHaveBeenCalled();
  });

  it('queues PENDING for any negative delta', async () => {
    prisma.loyaltyAdjustment.create.mockResolvedValue({ id: 'a3', status: 'PENDING', delta: -5 });
    const result = await service.submitAdjustment('user-sales-1', {
      customerId: 'c1',
      delta: -5,
      reason: AdjustmentReason.STAFF_ERROR,
    });
    expect(result.status).toBe('PENDING');
  });

  it('rejects delta of 0', async () => {
    await expect(
      service.submitAdjustment('u1', { customerId: 'c1', delta: 0, reason: AdjustmentReason.STAFF_ERROR }),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('LoyaltyAdminService.reviewAdjustment', () => {
  let prisma: any;
  let service: LoyaltyAdminService;

  beforeEach(() => {
    prisma = {
      $transaction: jest.fn().mockImplementation(async (fn) => fn(prisma)),
      loyaltyAdjustment: { findUnique: jest.fn(), update: jest.fn() },
      customer: { update: jest.fn() },
    };
    service = new LoyaltyAdminService(prisma as any);
  });

  it('rejects self-approve', async () => {
    prisma.loyaltyAdjustment.findUnique.mockResolvedValue({
      id: 'a1', status: 'PENDING', delta: 50, requestedBy: 'user-1', customerId: 'c1',
    });
    await expect(
      service.reviewAdjustment('user-1', 'a1', { action: 'APPROVE' } as any),
    ).rejects.toThrow(BadRequestException);
  });

  it('applies points on APPROVE', async () => {
    prisma.loyaltyAdjustment.findUnique.mockResolvedValue({
      id: 'a1', status: 'PENDING', delta: 50, requestedBy: 'user-sales', customerId: 'c1',
    });
    prisma.loyaltyAdjustment.update.mockResolvedValue({ id: 'a1', status: 'APPROVED' });
    await service.reviewAdjustment('user-owner', 'a1', { action: 'APPROVE' } as any);
    expect(prisma.customer.update).toHaveBeenCalled();
  });

  it('requires rejectReason on REJECT', async () => {
    prisma.loyaltyAdjustment.findUnique.mockResolvedValue({
      id: 'a1', status: 'PENDING', delta: 50, requestedBy: 'user-sales', customerId: 'c1',
    });
    await expect(
      service.reviewAdjustment('user-owner', 'a1', { action: 'REJECT' } as any),
    ).rejects.toThrow(BadRequestException);
  });
});
```

- [ ] **Step 2: Create DTO**

Create `apps/api/src/modules/loyalty-admin/dto/loyalty-admin.dto.ts`:

```typescript
import { IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';
import { AdjustmentReason } from '@prisma/client';

export class CreateAdjustmentDto {
  @IsUUID() customerId!: string;
  @IsInt() delta!: number;
  @IsEnum(AdjustmentReason) reason!: AdjustmentReason;
  @IsOptional() @IsString() note?: string;
}

export class ReviewAdjustmentDto {
  @IsString() @IsNotEmpty() action!: 'APPROVE' | 'REJECT';
  @IsOptional() @IsString() rejectReason?: string;
}

export class AdjustmentQueryDto {
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() page?: string;
  @IsOptional() @IsString() limit?: string;
}

export class OverviewQueryDto {
  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsString() to?: string;
}
```

- [ ] **Step 3: Implement service (submit + review)**

Create `apps/api/src/modules/loyalty-admin/loyalty-admin.service.ts`:

```typescript
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AdjustmentStatus, AdjustmentReason, Prisma } from '@prisma/client';
import { CreateAdjustmentDto, ReviewAdjustmentDto } from './dto/loyalty-admin.dto';

const AUTO_APPROVE_MAX = 20;

@Injectable()
export class LoyaltyAdminService {
  private readonly logger = new Logger(LoyaltyAdminService.name);
  constructor(private prisma: PrismaService) {}

  async submitAdjustment(userId: string, dto: CreateAdjustmentDto) {
    if (dto.delta === 0) throw new BadRequestException('จำนวนแต้มต้องไม่เท่ากับ 0');

    const customer = await this.prisma.customer.findUnique({ where: { id: dto.customerId } });
    if (!customer || customer.deletedAt) throw new NotFoundException('ไม่พบลูกค้า');

    const autoApprove = dto.delta > 0 && dto.delta <= AUTO_APPROVE_MAX;
    const status = autoApprove ? AdjustmentStatus.AUTO_APPROVED : AdjustmentStatus.PENDING;

    return this.prisma.$transaction(async (tx) => {
      const adj = await tx.loyaltyAdjustment.create({
        data: {
          customerId: dto.customerId,
          delta: dto.delta,
          reason: dto.reason,
          note: dto.note,
          status,
          requestedBy: userId,
          approvedBy: autoApprove ? userId : null,
          approvedAt: autoApprove ? new Date() : null,
        },
      });
      if (autoApprove) {
        await tx.customer.update({
          where: { id: dto.customerId },
          data: {
            loyaltyBalance: { increment: dto.delta },
            lastLoyaltyActivityAt: new Date(),
          },
        });
      }
      return adj;
    });
  }

  async reviewAdjustment(reviewerId: string, id: string, dto: ReviewAdjustmentDto) {
    const adj = await this.prisma.loyaltyAdjustment.findUnique({ where: { id } });
    if (!adj) throw new NotFoundException('ไม่พบรายการ');
    if (adj.status !== AdjustmentStatus.PENDING) {
      throw new BadRequestException('รายการถูกดำเนินการไปแล้ว');
    }
    if (adj.requestedBy === reviewerId) {
      throw new BadRequestException('ไม่สามารถอนุมัติรายการของตัวเองได้');
    }
    if (dto.action === 'REJECT' && !dto.rejectReason?.trim()) {
      throw new BadRequestException('กรุณาระบุเหตุผลการปฏิเสธ');
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.loyaltyAdjustment.update({
        where: { id },
        data: {
          status: dto.action === 'APPROVE' ? AdjustmentStatus.APPROVED : AdjustmentStatus.REJECTED,
          approvedBy: reviewerId,
          approvedAt: new Date(),
          rejectReason: dto.action === 'REJECT' ? dto.rejectReason : null,
        },
      });
      if (dto.action === 'APPROVE') {
        await tx.customer.update({
          where: { id: adj.customerId },
          data: {
            loyaltyBalance: { increment: adj.delta },
            lastLoyaltyActivityAt: new Date(),
          },
        });
      }
      return updated;
    });
  }

  async listAdjustments(filter: { status?: string; page?: number; limit?: number }) {
    const page = filter.page ?? 1;
    const limit = filter.limit ?? 50;
    const where: Prisma.LoyaltyAdjustmentWhereInput = { deletedAt: null };
    if (filter.status) where.status = filter.status as AdjustmentStatus;

    const [data, total] = await Promise.all([
      this.prisma.loyaltyAdjustment.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          customer: { select: { id: true, name: true, phone: true } },
          requester: { select: { id: true, name: true } },
          approver: { select: { id: true, name: true } },
        },
      }),
      this.prisma.loyaltyAdjustment.count({ where }),
    ]);
    return { data, total, page, limit };
  }
}
```

- [ ] **Step 4: Run tests**

Run: `cd apps/api && npx jest loyalty-admin.service.spec --no-coverage`
Expected: 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/loyalty-admin/
git commit -m "feat(loyalty): add LoyaltyAdminService submit + review workflow"
```

### Task D2: Overview + customers + referrals endpoints

**Files:**
- Modify: `apps/api/src/modules/loyalty-admin/loyalty-admin.service.ts`
- Modify: `apps/api/src/modules/loyalty-admin/loyalty-admin.service.spec.ts`

- [ ] **Step 1: Write failing test for getOverview**

Append to spec:

```typescript
describe('LoyaltyAdminService.getOverview', () => {
  it('aggregates issued/redeemed/outstanding + top 10', async () => {
    const prisma: any = {
      loyaltyPoint: { aggregate: jest.fn().mockResolvedValue({ _sum: { points: 12500 } }) },
      loyaltyRedemption: { aggregate: jest.fn().mockResolvedValue({ _sum: { points: 3200 } }) },
      customer: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { loyaltyBalance: 8400 } }),
        findMany: jest.fn().mockResolvedValue([{ id: 'c1', name: 'A', loyaltyBalance: 500 }]),
      },
    };
    const service = new LoyaltyAdminService(prisma);
    const o = await service.getOverview({ from: undefined, to: undefined });
    expect(o.totalIssued).toBe(12500);
    expect(o.totalRedeemed).toBe(3200);
    expect(o.totalOutstanding).toBe(8400);
    expect(o.topCustomers).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Implement getOverview**

Append to service:

```typescript
async getOverview(filter: { from?: string; to?: string }) {
  const dateFilter: Prisma.DateTimeFilter | undefined = filter.from || filter.to
    ? {
        ...(filter.from && { gte: new Date(filter.from) }),
        ...(filter.to && { lte: new Date(filter.to) }),
      }
    : undefined;

  const pointWhere = dateFilter ? { createdAt: dateFilter, deletedAt: null } : { deletedAt: null };

  const [issuedAgg, redeemedAgg, balanceAgg, topCustomers] = await Promise.all([
    this.prisma.loyaltyPoint.aggregate({
      where: { ...pointWhere, points: { gt: 0 } },
      _sum: { points: true },
    }),
    this.prisma.loyaltyRedemption.aggregate({
      where: { ...pointWhere },
      _sum: { points: true },
    }),
    this.prisma.customer.aggregate({
      where: { deletedAt: null },
      _sum: { loyaltyBalance: true },
    }),
    this.prisma.customer.findMany({
      where: { deletedAt: null, loyaltyBalance: { gt: 0 } },
      orderBy: { loyaltyBalance: 'desc' },
      take: 10,
      select: { id: true, name: true, phone: true, loyaltyBalance: true, lastLoyaltyActivityAt: true },
    }),
  ]);

  const totalIssued = issuedAgg._sum.points ?? 0;
  const totalRedeemed = redeemedAgg._sum.points ?? 0;
  const totalOutstanding = balanceAgg._sum.loyaltyBalance ?? 0;
  const redemptionRate = totalIssued > 0 ? totalRedeemed / totalIssued : 0;

  return { totalIssued, totalRedeemed, totalOutstanding, redemptionRate, topCustomers };
}
```

- [ ] **Step 3: Add listCustomers + getReferrals**

Append:

```typescript
async listCustomers(filter: { search?: string; page?: number; limit?: number }) {
  const page = filter.page ?? 1;
  const limit = filter.limit ?? 50;
  const where: Prisma.CustomerWhereInput = { deletedAt: null };
  if (filter.search) {
    where.OR = [
      { name: { contains: filter.search, mode: 'insensitive' } },
      { phone: { contains: filter.search } },
    ];
  }
  const [data, total] = await Promise.all([
    this.prisma.customer.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { loyaltyBalance: 'desc' },
      select: {
        id: true,
        name: true,
        phone: true,
        loyaltyBalance: true,
        lastLoyaltyActivityAt: true,
        referredById: true,
      },
    }),
    this.prisma.customer.count({ where }),
  ]);
  return { data, total, page, limit };
}

async getReferrals() {
  // Returns top-level referrers with immediate children (2 levels)
  const roots = await this.prisma.customer.findMany({
    where: {
      deletedAt: null,
      referrals: { some: { deletedAt: null } },
    },
    select: {
      id: true,
      name: true,
      phone: true,
      loyaltyBalance: true,
      referrals: {
        where: { deletedAt: null },
        select: {
          id: true,
          name: true,
          phone: true,
          referralAwardedAt: true,
          createdAt: true,
        },
      },
    },
    orderBy: { loyaltyBalance: 'desc' },
    take: 100,
  });
  return { referrers: roots };
}
```

- [ ] **Step 4: Run tests**

Run: `cd apps/api && npx jest loyalty-admin.service.spec --no-coverage`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/loyalty-admin/
git commit -m "feat(loyalty): add overview/customers/referrals admin queries"
```

### Task D3: Controller + module

**Files:**
- Create: `apps/api/src/modules/loyalty-admin/loyalty-admin.controller.ts`
- Create: `apps/api/src/modules/loyalty-admin/loyalty-admin.module.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: Write controller**

Create `loyalty-admin.controller.ts`:

```typescript
import {
  Body, Controller, Get, Param, Patch, Post, Query, Req,
  UseGuards, UsePipes, ValidationPipe,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { LoyaltyAdminService } from './loyalty-admin.service';
import {
  CreateAdjustmentDto, ReviewAdjustmentDto,
  AdjustmentQueryDto, OverviewQueryDto,
} from './dto/loyalty-admin.dto';

@Controller('loyalty')
@UseGuards(JwtAuthGuard, RolesGuard)
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class LoyaltyAdminController {
  constructor(private service: LoyaltyAdminService) {}

  @Get('overview')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  overview(@Query() q: OverviewQueryDto) {
    return this.service.getOverview(q);
  }

  @Get('customers')
  @Roles('OWNER', 'FINANCE_MANAGER', 'BRANCH_MANAGER', 'SALES', 'ACCOUNTANT')
  customers(
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.listCustomers({
      search,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('referrals')
  @Roles('OWNER', 'FINANCE_MANAGER', 'BRANCH_MANAGER', 'SALES', 'ACCOUNTANT')
  referrals() {
    return this.service.getReferrals();
  }

  @Post('adjustments')
  @Roles('OWNER', 'FINANCE_MANAGER', 'BRANCH_MANAGER', 'SALES', 'ACCOUNTANT')
  submit(@Body() dto: CreateAdjustmentDto, @Req() req: Request) {
    const userId = (req as any).user?.id ?? 'system';
    return this.service.submitAdjustment(userId, dto);
  }

  @Get('adjustments')
  @Roles('OWNER', 'FINANCE_MANAGER', 'BRANCH_MANAGER', 'SALES', 'ACCOUNTANT')
  list(@Query() q: AdjustmentQueryDto) {
    return this.service.listAdjustments({
      status: q.status,
      page: q.page ? Number(q.page) : undefined,
      limit: q.limit ? Number(q.limit) : undefined,
    });
  }

  @Patch('adjustments/:id')
  @Roles('OWNER', 'FINANCE_MANAGER')
  review(
    @Param('id') id: string,
    @Body() dto: ReviewAdjustmentDto,
    @Req() req: Request,
  ) {
    const userId = (req as any).user?.id ?? 'system';
    return this.service.reviewAdjustment(userId, id, dto);
  }
}
```

- [ ] **Step 2: Write module**

Create `loyalty-admin.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { LoyaltyAdminController } from './loyalty-admin.controller';
import { LoyaltyAdminService } from './loyalty-admin.service';

@Module({
  controllers: [LoyaltyAdminController],
  providers: [LoyaltyAdminService],
  exports: [LoyaltyAdminService],
})
export class LoyaltyAdminModule {}
```

- [ ] **Step 3: Register in app.module.ts**

Add to imports:
```typescript
import { LoyaltyAdminModule } from './modules/loyalty-admin/loyalty-admin.module';
// ... in imports array: LoyaltyAdminModule,
```

- [ ] **Step 4: Type check + commit**

```bash
./tools/check-types.sh api
# expect 0 errors
git add apps/api/src/modules/loyalty-admin/ apps/api/src/app.module.ts
git commit -m "feat(loyalty): wire LoyaltyAdmin controller + module"
```

---

## Phase E — Earning Triggers (Agent 2)

### Task E1: Wire cash sale earn

**Files:**
- Modify: `apps/api/src/modules/pos/pos.service.ts`
- Modify: `apps/api/src/modules/pos/pos.module.ts` (ensure LoyaltyModule imported)

- [ ] **Step 1: Find the cash-sale completion method**

Run: `grep -n "cash\|CASH\|completed\|finalize" apps/api/src/modules/pos/pos.service.ts | head -30`

Identify the method that marks a POS sale complete for cash transactions (typically `completeSale` or `finalizeSale`).

- [ ] **Step 2: Add failing integration test**

Create `apps/api/src/modules/pos/pos.service.spec.ts` (or append if exists):

```typescript
it('awards cash earn points on sale complete', async () => {
  // given a completed cash sale of 10,000 baht for customer c1
  // policy.pointsPerBahtCash = 0.01
  // when sale completes
  // then loyaltyService.addPoints(c1, 100, 'CASH_SALE', saleId) is called
});
```

(Mark test.todo until Step 3 complete.)

- [ ] **Step 3: Inject LoyaltyService + LoyaltyPolicyService in PosService**

In `pos.service.ts` constructor add:
```typescript
constructor(
  // ...existing,
  private loyalty: LoyaltyService,
  private policy: LoyaltyPolicyService,
) {}
```
Add imports at top.

In `pos.module.ts` add:
```typescript
imports: [LoyaltyModule, LoyaltyPolicyModule],
```

- [ ] **Step 4: Call `addPoints` after cash sale commit**

Inside the cash-sale completion path, after the sale is fully persisted (inside or after the $transaction):

```typescript
try {
  if (sale.paymentMethod === 'CASH' && sale.customerId) {
    const p = await this.policy.getPolicy();
    const points = Math.floor(Number(sale.totalAmount) * p.pointsPerBahtCash);
    if (points > 0) {
      await this.prisma.loyaltyPoint.upsert({
        where: { paymentId: sale.id }, // reuse unique key; saleId stored as paymentId
        create: {
          customerId: sale.customerId,
          paymentId: sale.id,
          contractId: sale.contractId ?? sale.id, // fallback: use saleId for standalone cash sale
          points,
          reason: 'CASH_SALE',
        },
        update: {},
      });
      await this.prisma.customer.update({
        where: { id: sale.customerId },
        data: {
          loyaltyBalance: { increment: points },
          lastLoyaltyActivityAt: new Date(),
        },
      });
    }
  }
} catch (err) {
  this.logger.error(`cash sale loyalty award failed for sale ${sale.id}`, err);
  // swallow — sale succeeded, loyalty is best-effort
}
```

**Note:** if `LoyaltyPoint.contractId` is required and POS cash sale has no contract, either relax the schema (contractId optional) or store a sentinel. Preferred: a schema migration to make `contractId` nullable on `LoyaltyPoint` — add to this task:

Edit schema.prisma (`LoyaltyPoint`):
```prisma
contractId String?  @map("contract_id")
contract   Contract? @relation(fields: [contractId], references: [id])
```
Then run:
```bash
cd apps/api && npx prisma migrate dev --name loyalty_point_contract_optional
```

- [ ] **Step 5: Run POS tests**

Run: `cd apps/api && npx jest pos --no-coverage`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/pos/ apps/api/prisma/
git commit -m "feat(loyalty): award points on cash POS sale"
```

### Task E2: Wire GFIN activate + FINANCE completion bonus

**Files:**
- Modify: `apps/api/src/modules/contracts/contracts.service.ts`
- Modify: `apps/api/src/modules/contracts/contracts.module.ts`
- Modify: `apps/api/src/modules/payments/payments.service.ts`

- [ ] **Step 1: Identify contract activation method**

Run: `grep -n "activate\|ACTIVE\|contractType" apps/api/src/modules/contracts/contracts.service.ts | head -30`

Find the method that transitions contract to ACTIVE state (likely `activateContract` or `approveAndActivate`).

- [ ] **Step 2: Add GFIN earn on activate**

In the activation method, after transaction commits:

```typescript
if (contract.financingType === 'GFIN' && contract.customerId) {
  try {
    const p = await this.policy.getPolicy();
    const pts = Math.floor(Number(contract.financedAmount) * p.pointsPerBahtGfin);
    if (pts > 0) {
      await this.prisma.loyaltyPoint.create({
        data: {
          customerId: contract.customerId,
          paymentId: `gfin-activate-${contract.id}`, // synthetic idempotency key
          contractId: contract.id,
          points: pts,
          reason: 'GFIN_ACTIVATION',
        },
      });
      await this.prisma.customer.update({
        where: { id: contract.customerId },
        data: {
          loyaltyBalance: { increment: pts },
          lastLoyaltyActivityAt: new Date(),
        },
      });
    }
  } catch (err) {
    this.logger.error(`GFIN loyalty award failed for contract ${contract.id}`, err);
  }
}
```

Ensure `LoyaltyPolicyService` is injected (mirror Task E1 pattern).

- [ ] **Step 3: Add FINANCE completion bonus in payments.service.ts**

In `PaymentsService.create` (after existing `awardLoyaltyPoints`), add check for "is this the final installment?":

```typescript
// After the payment is persisted:
const allPayments = await this.prisma.payment.findMany({
  where: { contractId: payment.contractId, deletedAt: null },
  select: { installmentNo: true, status: true },
});
const contractInfo = await this.prisma.contract.findUnique({
  where: { id: payment.contractId },
  select: { id: true, totalMonths: true, customerId: true, financingType: true, status: true },
});
const paidCount = allPayments.filter((p) => p.status === 'PAID').length;

if (
  contractInfo &&
  contractInfo.financingType === 'FINANCE' &&
  paidCount >= contractInfo.totalMonths &&
  contractInfo.customerId
) {
  try {
    const p = await this.policyService.getPolicy();
    await this.prisma.loyaltyPoint.upsert({
      where: { paymentId: `completion-${contractInfo.id}` },
      create: {
        customerId: contractInfo.customerId,
        paymentId: `completion-${contractInfo.id}`,
        contractId: contractInfo.id,
        points: p.completionBonus,
        reason: 'COMPLETION_BONUS',
      },
      update: {},
    });
    await this.prisma.customer.update({
      where: { id: contractInfo.customerId },
      data: {
        loyaltyBalance: { increment: p.completionBonus },
        lastLoyaltyActivityAt: new Date(),
      },
    });
  } catch (err) {
    this.logger.error(`Completion bonus failed for contract ${contractInfo.id}`, err);
  }
}
```

Inject `LoyaltyPolicyService` in `PaymentsService` constructor and update `payments.module.ts` imports.

- [ ] **Step 4: Update lastLoyaltyActivityAt in existing awardLoyaltyPoints**

In `payments.service.ts` existing `awardLoyaltyPoints` method, inside the upsert block, add:
```typescript
await this.prisma.customer.update({
  where: { id: customerId },
  data: { lastLoyaltyActivityAt: new Date() },
});
```

- [ ] **Step 5: Run tests**

Run: `cd apps/api && npx jest contracts payments --no-coverage`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/contracts/ apps/api/src/modules/payments/
git commit -m "feat(loyalty): award GFIN activate + FINANCE completion bonus"
```

### Task E3: Wire referral trigger (all 4 call sites)

**Files:**
- Modify: `apps/api/src/modules/customers/customers.service.ts` (REGISTER)
- Modify: `apps/api/src/modules/contracts/contracts.service.ts` (CONTRACT_ACTIVATE)
- Modify: `apps/api/src/modules/payments/payments.service.ts` (FIRST_PAYMENT, THIRD_PAYMENT)

- [ ] **Step 1: Extract helper — gated by policy trigger**

Pattern to add at each call site:

```typescript
const p = await this.policyService.getPolicy();
if (p.referralTrigger === 'FIRST_PAYMENT') {
  await this.loyaltyService.awardReferralPoints(customerId).catch((err) => {
    this.logger.error(`awardReferralPoints failed for ${customerId}`, err);
  });
}
```

- [ ] **Step 2: Wire REGISTER in customers.service.ts**

In `CustomersService.create`, after customer is persisted:
```typescript
const p = await this.policyService.getPolicy();
if (p.referralTrigger === 'REGISTER' && created.referredById) {
  await this.loyaltyService.awardReferralPoints(created.id).catch((err) =>
    this.logger.error(`referral REGISTER failed for ${created.id}`, err),
  );
}
```

Inject `LoyaltyService` + `LoyaltyPolicyService`. Update `customers.module.ts` imports.

- [ ] **Step 3: Wire CONTRACT_ACTIVATE in contracts.service.ts**

In activation method (same location as E2 Step 2):
```typescript
const p = await this.policyService.getPolicy();
if (p.referralTrigger === 'CONTRACT_ACTIVATE' && contract.customerId) {
  await this.loyaltyService.awardReferralPoints(contract.customerId).catch((err) =>
    this.logger.error(`referral CONTRACT_ACTIVATE failed for ${contract.customerId}`, err),
  );
}
```

- [ ] **Step 4: Wire FIRST_PAYMENT + THIRD_PAYMENT in payments.service.ts**

In `PaymentsService.create`, after the payment succeeds:
```typescript
const p = await this.policyService.getPolicy();
if (p.referralTrigger === 'FIRST_PAYMENT' || p.referralTrigger === 'THIRD_PAYMENT') {
  const threshold = p.referralTrigger === 'FIRST_PAYMENT' ? 1 : 3;
  const paidCount = await this.prisma.payment.count({
    where: {
      contractId: payment.contractId,
      status: 'PAID',
      deletedAt: null,
    },
  });
  if (paidCount >= threshold && customerId) {
    await this.loyaltyService.awardReferralPoints(customerId).catch((err) =>
      this.logger.error(`referral ${p.referralTrigger} failed for ${customerId}`, err),
    );
  }
}
```

(Note: `awardReferralPoints` is already idempotent via `referralAwardedAt`.)

- [ ] **Step 5: Run tests**

Run: `cd apps/api && npx jest customers contracts payments loyalty --no-coverage`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/
git commit -m "feat(loyalty): wire referral trigger at 4 policy-gated call sites"
```

---

## Phase F — Expiry Cron (Agent 2)

### Task F1: Daily expiry cron

**Files:**
- Create: `apps/api/src/modules/loyalty/cron/loyalty-expiry.cron.ts`
- Create: `apps/api/src/modules/loyalty/cron/loyalty-expiry.cron.spec.ts`
- Modify: `apps/api/src/modules/loyalty/loyalty.module.ts` (register cron provider)

- [ ] **Step 1: Write failing test**

Create `apps/api/src/modules/loyalty/cron/loyalty-expiry.cron.spec.ts`:

```typescript
import { LoyaltyExpiryCron } from './loyalty-expiry.cron';

describe('LoyaltyExpiryCron.run', () => {
  it('expires balance for customers inactive beyond inactivityMonths', async () => {
    const prisma = {
      customer: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'c1', loyaltyBalance: 500, lineId: 'L1', name: 'A' },
          { id: 'c2', loyaltyBalance: 50, lineId: null, name: 'B' },
        ]),
        update: jest.fn(),
      },
      loyaltyPoint: { create: jest.fn() },
      $transaction: jest.fn().mockImplementation(async (fn) => fn({
        customer: { update: jest.fn() },
        loyaltyPoint: { create: jest.fn() },
      })),
    };
    const policy = { getPolicy: jest.fn().mockResolvedValue({ inactivityMonths: 12 }) };
    const cron = new LoyaltyExpiryCron(prisma as any, policy as any);
    const result = await cron.run();
    expect(result.expiredCount).toBe(2);
    expect(result.totalPointsExpired).toBe(550);
  });

  it('skips customers with zero balance', async () => {
    const prisma = {
      customer: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
      loyaltyPoint: { create: jest.fn() },
      $transaction: jest.fn(),
    };
    const policy = { getPolicy: jest.fn().mockResolvedValue({ inactivityMonths: 12 }) };
    const cron = new LoyaltyExpiryCron(prisma as any, policy as any);
    const result = await cron.run();
    expect(result.expiredCount).toBe(0);
  });
});
```

- [ ] **Step 2: Implement cron**

Create `apps/api/src/modules/loyalty/cron/loyalty-expiry.cron.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as Sentry from '@sentry/node';
import { PrismaService } from '../../../prisma/prisma.service';
import { LoyaltyPolicyService } from '../../loyalty-policy/loyalty-policy.service';

@Injectable()
export class LoyaltyExpiryCron {
  private readonly logger = new Logger(LoyaltyExpiryCron.name);

  constructor(
    private prisma: PrismaService,
    private policy: LoyaltyPolicyService,
  ) {}

  @Cron('0 2 * * *', { timeZone: 'Asia/Bangkok' })
  async runScheduled() {
    try {
      const result = await this.run();
      this.logger.log(`loyalty-expiry: expired ${result.expiredCount} customers, ${result.totalPointsExpired} pts`);
    } catch (err) {
      this.logger.error('loyalty-expiry cron failed', err as Error);
      Sentry.captureException(err, { tags: { cron: 'loyalty-expiry' } });
    }
  }

  async run(): Promise<{ expiredCount: number; totalPointsExpired: number }> {
    const policy = await this.policy.getPolicy();
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - policy.inactivityMonths);

    const inactive = await this.prisma.customer.findMany({
      where: {
        deletedAt: null,
        loyaltyBalance: { gt: 0 },
        OR: [
          { lastLoyaltyActivityAt: null }, // never had activity but somehow has balance → expire
          { lastLoyaltyActivityAt: { lt: cutoff } },
        ],
      },
      select: { id: true, loyaltyBalance: true, lineId: true, name: true },
      take: 1000, // safety cap
    });

    let totalPointsExpired = 0;
    for (const c of inactive) {
      await this.prisma.$transaction(async (tx) => {
        await tx.loyaltyPoint.create({
          data: {
            customerId: c.id,
            paymentId: `expire-${c.id}-${Date.now()}`,
            contractId: null as any, // require nullable (from E1 schema change)
            points: -c.loyaltyBalance,
            reason: 'EXPIRED_INACTIVITY',
          },
        });
        await tx.customer.update({
          where: { id: c.id },
          data: { loyaltyBalance: 0 },
        });
      });
      totalPointsExpired += c.loyaltyBalance;
    }

    return { expiredCount: inactive.length, totalPointsExpired };
  }
}
```

- [ ] **Step 3: Register in loyalty.module.ts**

```typescript
import { LoyaltyExpiryCron } from './cron/loyalty-expiry.cron';

@Module({
  imports: [LoyaltyPolicyModule],
  controllers: [LoyaltyController],
  providers: [LoyaltyService, LoyaltyExpiryCron],
  exports: [LoyaltyService],
})
export class LoyaltyModule {}
```

- [ ] **Step 4: Run test**

Run: `cd apps/api && npx jest loyalty-expiry.cron.spec --no-coverage`
Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/loyalty/cron/ apps/api/src/modules/loyalty/loyalty.module.ts
git commit -m "feat(loyalty): add daily expiry cron for inactive customers"
```

---

## Phase G — Frontend: Admin Loyalty Page (Agent 3)

### Task G1: Types + Page scaffold

**Files:**
- Create: `apps/web/src/pages/LoyaltyPage/types.ts`
- Create: `apps/web/src/pages/LoyaltyPage/index.tsx`

- [ ] **Step 1: Create types.ts**

```typescript
export interface LoyaltyOverviewResponse {
  totalIssued: number;
  totalRedeemed: number;
  totalOutstanding: number;
  redemptionRate: number;
  topCustomers: Array<{
    id: string;
    name: string;
    phone: string | null;
    loyaltyBalance: number;
    lastLoyaltyActivityAt: string | null;
  }>;
}

export interface LoyaltyCustomerRow {
  id: string;
  name: string;
  phone: string | null;
  loyaltyBalance: number;
  lastLoyaltyActivityAt: string | null;
  referredById: string | null;
}

export interface ReferralNode {
  id: string;
  name: string;
  phone: string | null;
  loyaltyBalance: number;
  referrals: Array<{
    id: string;
    name: string;
    phone: string | null;
    referralAwardedAt: string | null;
    createdAt: string;
  }>;
}

export type AdjustmentStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'AUTO_APPROVED';
export type AdjustmentReason = 'BONUS_CAMPAIGN' | 'STAFF_ERROR' | 'CUSTOMER_COMPLAINT' | 'MANUAL_OTHER';

export interface AdjustmentRow {
  id: string;
  customerId: string;
  delta: number;
  reason: AdjustmentReason;
  note: string | null;
  status: AdjustmentStatus;
  requestedBy: string;
  approvedBy: string | null;
  approvedAt: string | null;
  rejectReason: string | null;
  createdAt: string;
  customer: { id: string; name: string; phone: string | null };
  requester: { id: string; name: string };
  approver: { id: string; name: string } | null;
}
```

- [ ] **Step 2: Create LoyaltyPage/index.tsx**

```tsx
import { Suspense, lazy } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import PageHeader from '@/components/PageHeader';
import { Skeleton } from '@/components/ui/skeleton';

const LoyaltyOverview = lazy(() => import('./components/LoyaltyOverview'));
const LoyaltyCustomers = lazy(() => import('./components/LoyaltyCustomers'));
const LoyaltyReferrals = lazy(() => import('./components/LoyaltyReferrals'));
const LoyaltyAdjustments = lazy(() => import('./components/LoyaltyAdjustments'));

export default function LoyaltyPage() {
  return (
    <div className="flex flex-col gap-5 lg:gap-7.5">
      <PageHeader title="ระบบแต้มสะสม" subtitle="จัดการแต้มลูกค้า + การแนะนำเพื่อน" />
      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">ภาพรวม</TabsTrigger>
          <TabsTrigger value="customers">ลูกค้า</TabsTrigger>
          <TabsTrigger value="referrals">การแนะนำ</TabsTrigger>
          <TabsTrigger value="adjustments">ปรับแต้ม</TabsTrigger>
        </TabsList>
        <Suspense fallback={<Skeleton className="h-64" />}>
          <TabsContent value="overview"><LoyaltyOverview /></TabsContent>
          <TabsContent value="customers"><LoyaltyCustomers /></TabsContent>
          <TabsContent value="referrals"><LoyaltyReferrals /></TabsContent>
          <TabsContent value="adjustments"><LoyaltyAdjustments /></TabsContent>
        </Suspense>
      </Tabs>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/LoyaltyPage/types.ts apps/web/src/pages/LoyaltyPage/index.tsx
git commit -m "feat(loyalty): add LoyaltyPage scaffold with 4 tabs"
```

### Task G2: LoyaltyOverview component

**Files:**
- Create: `apps/web/src/pages/LoyaltyPage/components/LoyaltyOverview.tsx`

- [ ] **Step 1: Implement**

```tsx
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { QueryBoundary } from '@/components/QueryBoundary';
import type { LoyaltyOverviewResponse } from '../types';

export default function LoyaltyOverview() {
  const q = useQuery({
    queryKey: ['loyalty', 'overview'],
    queryFn: async () => (await api.get<LoyaltyOverviewResponse>('/loyalty/overview')).data,
  });

  return (
    <QueryBoundary isLoading={q.isLoading} isError={q.isError} error={q.error} onRetry={q.refetch}>
      {q.data && (
        <div className="grid gap-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card><CardHeader><CardTitle className="text-sm text-muted-foreground">แต้มออก</CardTitle></CardHeader><CardContent className="text-2xl font-semibold">{q.data.totalIssued.toLocaleString()}</CardContent></Card>
            <Card><CardHeader><CardTitle className="text-sm text-muted-foreground">แลกไปแล้ว</CardTitle></CardHeader><CardContent className="text-2xl font-semibold">{q.data.totalRedeemed.toLocaleString()}</CardContent></Card>
            <Card><CardHeader><CardTitle className="text-sm text-muted-foreground">คงเหลือ</CardTitle></CardHeader><CardContent className="text-2xl font-semibold">{q.data.totalOutstanding.toLocaleString()}</CardContent></Card>
            <Card><CardHeader><CardTitle className="text-sm text-muted-foreground">Redemption rate</CardTitle></CardHeader><CardContent className="text-2xl font-semibold">{(q.data.redemptionRate * 100).toFixed(1)}%</CardContent></Card>
          </div>
          <Card>
            <CardHeader><CardTitle>Top 10 ลูกค้าแต้มสูงสุด</CardTitle></CardHeader>
            <CardContent>
              <table className="w-full text-sm">
                <thead><tr className="text-left text-muted-foreground"><th className="py-2">ลูกค้า</th><th>เบอร์</th><th className="text-right">แต้ม</th></tr></thead>
                <tbody>
                  {q.data.topCustomers.map((c) => (
                    <tr key={c.id} className="border-t border-border"><td className="py-2">{c.name}</td><td>{c.phone ?? '-'}</td><td className="text-right font-medium">{c.loyaltyBalance.toLocaleString()}</td></tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </div>
      )}
    </QueryBoundary>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/pages/LoyaltyPage/components/LoyaltyOverview.tsx
git commit -m "feat(loyalty): add LoyaltyOverview tab"
```

### Task G3: LoyaltyCustomers component

**Files:**
- Create: `apps/web/src/pages/LoyaltyPage/components/LoyaltyCustomers.tsx`

- [ ] **Step 1: Implement**

```tsx
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { QueryBoundary } from '@/components/QueryBoundary';
import { useDebounce } from '@/hooks/useDebounce';
import type { LoyaltyCustomerRow } from '../types';

interface Response {
  data: LoyaltyCustomerRow[];
  total: number;
  page: number;
  limit: number;
}

export default function LoyaltyCustomers() {
  const [search, setSearch] = useState('');
  const debounced = useDebounce(search, 300);
  const q = useQuery({
    queryKey: ['loyalty', 'customers', debounced],
    queryFn: async () => (await api.get<Response>('/loyalty/customers', { params: { search: debounced || undefined } })).data,
  });
  return (
    <Card>
      <CardContent className="pt-6 space-y-4">
        <Input placeholder="ค้นหาชื่อ/เบอร์" value={search} onChange={(e) => setSearch(e.target.value)} />
        <QueryBoundary isLoading={q.isLoading} isError={q.isError} error={q.error} onRetry={q.refetch}>
          {q.data && (
            <table className="w-full text-sm leading-snug">
              <thead><tr className="text-left text-muted-foreground"><th className="py-2">ชื่อ</th><th>เบอร์</th><th className="text-right">แต้ม</th><th>กิจกรรมล่าสุด</th></tr></thead>
              <tbody>
                {q.data.data.map((c) => (
                  <tr key={c.id} className="border-t border-border">
                    <td className="py-2"><Link className="text-primary hover:underline" to={`/customers/${c.id}`}>{c.name}</Link></td>
                    <td>{c.phone ?? '-'}</td>
                    <td className="text-right font-medium">{c.loyaltyBalance.toLocaleString()}</td>
                    <td>{c.lastLoyaltyActivityAt ? new Date(c.lastLoyaltyActivityAt).toLocaleDateString('th-TH') : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </QueryBoundary>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/pages/LoyaltyPage/components/LoyaltyCustomers.tsx
git commit -m "feat(loyalty): add LoyaltyCustomers tab"
```

### Task G4: LoyaltyReferrals + ReferralTree

**Files:**
- Create: `apps/web/src/pages/LoyaltyPage/components/ReferralTree.tsx`
- Create: `apps/web/src/pages/LoyaltyPage/components/LoyaltyReferrals.tsx`
- Create: `apps/web/src/pages/LoyaltyPage/__tests__/ReferralTree.test.tsx`

- [ ] **Step 1: Write failing test**

Create `apps/web/src/pages/LoyaltyPage/__tests__/ReferralTree.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { ReferralTree } from '../components/ReferralTree';
import type { ReferralNode } from '../types';

describe('ReferralTree', () => {
  it('renders 2 levels', () => {
    const data: ReferralNode[] = [{
      id: '1', name: 'แนน', phone: '081', loyaltyBalance: 500,
      referrals: [
        { id: '2', name: 'กวาง', phone: '082', referralAwardedAt: '2026-01-01T00:00:00Z', createdAt: '2026-01-01T00:00:00Z' },
      ],
    }];
    render(<ReferralTree referrers={data} />);
    expect(screen.getByText('แนน')).toBeInTheDocument();
    expect(screen.getByText('กวาง')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `cd apps/web && npx vitest run ReferralTree`

- [ ] **Step 3: Implement component**

Create `ReferralTree.tsx`:

```tsx
import type { ReferralNode } from '../types';

interface Props {
  referrers: ReferralNode[];
}

export function ReferralTree({ referrers }: Props) {
  if (!referrers.length) return <p className="text-muted-foreground text-sm">ยังไม่มีการแนะนำ</p>;
  return (
    <ul className="space-y-3">
      {referrers.map((r) => (
        <li key={r.id} className="border border-border rounded-lg p-3">
          <div className="flex items-center justify-between">
            <div className="font-medium">{r.name}</div>
            <div className="text-sm text-muted-foreground">{r.phone ?? '-'} · แต้ม {r.loyaltyBalance.toLocaleString()}</div>
          </div>
          <ul className="mt-2 pl-4 border-l border-border space-y-1">
            {r.referrals.map((child) => (
              <li key={child.id} className="text-sm flex items-center gap-2">
                <span>{child.name}</span>
                <span className="text-muted-foreground">({child.phone ?? '-'})</span>
                <span className={child.referralAwardedAt ? 'text-success' : 'text-muted-foreground'}>
                  {child.referralAwardedAt ? '✓ ได้รับแต้มแล้ว' : 'ยังไม่ได้รับ'}
                </span>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}
```

(Replace `✓` with `<CheckCircle className="w-4 h-4" />` from lucide-react if emoji policy strict — follow feedback memory rule: no emoji. Use `lucide-react`'s `Check`:

```tsx
import { Check } from 'lucide-react';
// inside:
<span className={child.referralAwardedAt ? 'inline-flex items-center gap-1 text-success' : 'text-muted-foreground'}>
  {child.referralAwardedAt ? (<><Check className="w-3 h-3" /> ได้รับแต้มแล้ว</>) : 'ยังไม่ได้รับ'}
</span>
```
)

- [ ] **Step 4: Run test — expect PASS**

Run: `cd apps/web && npx vitest run ReferralTree`

- [ ] **Step 5: Create LoyaltyReferrals.tsx**

```tsx
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { QueryBoundary } from '@/components/QueryBoundary';
import { ReferralTree } from './ReferralTree';
import type { ReferralNode } from '../types';

export default function LoyaltyReferrals() {
  const q = useQuery({
    queryKey: ['loyalty', 'referrals'],
    queryFn: async () => (await api.get<{ referrers: ReferralNode[] }>('/loyalty/referrals')).data,
  });
  return (
    <Card>
      <CardContent className="pt-6">
        <QueryBoundary isLoading={q.isLoading} isError={q.isError} error={q.error} onRetry={q.refetch}>
          {q.data && <ReferralTree referrers={q.data.referrers} />}
        </QueryBoundary>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/LoyaltyPage/components/ReferralTree.tsx apps/web/src/pages/LoyaltyPage/components/LoyaltyReferrals.tsx apps/web/src/pages/LoyaltyPage/__tests__/ReferralTree.test.tsx
git commit -m "feat(loyalty): add LoyaltyReferrals tab + ReferralTree"
```

### Task G5: AdjustmentModal + LoyaltyAdjustments

**Files:**
- Create: `apps/web/src/pages/LoyaltyPage/components/AdjustmentModal.tsx`
- Create: `apps/web/src/pages/LoyaltyPage/components/LoyaltyAdjustments.tsx`
- Create: `apps/web/src/pages/LoyaltyPage/__tests__/LoyaltyAdjustments.test.tsx`

- [ ] **Step 1: Write failing test — self-approve guard UI message**

Create `apps/web/src/pages/LoyaltyPage/__tests__/LoyaltyAdjustments.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import LoyaltyAdjustments from '../components/LoyaltyAdjustments';
import { api } from '@/lib/api';

vi.mock('@/lib/api', () => ({ api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));

function renderWithClient(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('LoyaltyAdjustments', () => {
  it('renders PENDING queue', async () => {
    (api.get as any).mockResolvedValueOnce({ data: { data: [{
      id: 'a1', customerId: 'c1', delta: 50, reason: 'BONUS_CAMPAIGN',
      note: 'test', status: 'PENDING', requestedBy: 'u1', approvedBy: null,
      approvedAt: null, rejectReason: null, createdAt: '2026-04-19',
      customer: { id: 'c1', name: 'A', phone: '081' },
      requester: { id: 'u1', name: 'SalesOne' }, approver: null,
    }], total: 1, page: 1, limit: 50 } });
    renderWithClient(<LoyaltyAdjustments />);
    await waitFor(() => expect(screen.getByText('SalesOne')).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement AdjustmentModal**

Create `AdjustmentModal.tsx`:

```tsx
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';

const schema = z.object({
  customerId: z.string().uuid('กรุณาเลือกลูกค้า'),
  delta: z.coerce.number().int().refine((v) => v !== 0, 'ต้องไม่เท่ากับ 0'),
  reason: z.enum(['BONUS_CAMPAIGN', 'STAFF_ERROR', 'CUSTOMER_COMPLAINT', 'MANUAL_OTHER']),
  note: z.string().max(500).optional(),
});

type FormValues = z.infer<typeof schema>;

interface Props { defaultCustomerId?: string }

export function AdjustmentModal({ defaultCustomerId }: Props) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { customerId: defaultCustomerId ?? '', delta: 0 as any, reason: 'MANUAL_OTHER' } });

  const mutation = useMutation({
    mutationFn: async (v: FormValues) => (await api.post('/loyalty/adjustments', v)).data,
    onSuccess: (data) => {
      toast.success(data.status === 'AUTO_APPROVED' ? 'ปรับแต้มแล้ว (auto-approve)' : 'ส่งขออนุมัติแล้ว');
      qc.invalidateQueries({ queryKey: ['loyalty'] });
      setOpen(false);
      form.reset();
    },
    onError: (err: any) => toast.error(err?.response?.data?.message ?? 'ผิดพลาด'),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button>ขอปรับแต้ม</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>ขอปรับแต้มลูกค้า</DialogTitle></DialogHeader>
        <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-3">
          <div><Label>Customer ID (UUID)</Label><Input {...form.register('customerId')} /></div>
          <div><Label>จำนวน (+บวก/-ลบ)</Label><Input type="number" {...form.register('delta')} /></div>
          <div><Label>เหตุผล</Label>
            <select className="w-full border border-border rounded-md h-9 px-2 bg-background" {...form.register('reason')}>
              <option value="BONUS_CAMPAIGN">โบนัสแคมเปญ</option>
              <option value="STAFF_ERROR">บันทึกพนักงานผิด</option>
              <option value="CUSTOMER_COMPLAINT">ลูกค้าร้องเรียน</option>
              <option value="MANUAL_OTHER">อื่นๆ</option>
            </select>
          </div>
          <div><Label>หมายเหตุ</Label><Textarea {...form.register('note')} /></div>
          <Button type="submit" disabled={mutation.isPending}>บันทึก</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Implement LoyaltyAdjustments**

Create `LoyaltyAdjustments.tsx`:

```tsx
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { QueryBoundary } from '@/components/QueryBoundary';
import { AdjustmentModal } from './AdjustmentModal';
import type { AdjustmentRow } from '../types';

interface Response { data: AdjustmentRow[]; total: number; page: number; limit: number }

export default function LoyaltyAdjustments() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'PENDING' | 'ALL'>('PENDING');
  const q = useQuery({
    queryKey: ['loyalty', 'adjustments', tab],
    queryFn: async () => (await api.get<Response>('/loyalty/adjustments', { params: tab === 'PENDING' ? { status: 'PENDING' } : {} })).data,
  });

  const approve = useMutation({
    mutationFn: async ({ id, action, reason }: { id: string; action: 'APPROVE' | 'REJECT'; reason?: string }) =>
      (await api.patch(`/loyalty/adjustments/${id}`, { action, rejectReason: reason })).data,
    onSuccess: (_, v) => { toast.success(v.action === 'APPROVE' ? 'อนุมัติแล้ว' : 'ปฏิเสธแล้ว'); qc.invalidateQueries({ queryKey: ['loyalty'] }); },
    onError: (err: any) => toast.error(err?.response?.data?.message ?? 'ผิดพลาด'),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div className="flex gap-2">
          <Button variant={tab === 'PENDING' ? 'default' : 'outline'} size="sm" onClick={() => setTab('PENDING')}>รออนุมัติ</Button>
          <Button variant={tab === 'ALL' ? 'default' : 'outline'} size="sm" onClick={() => setTab('ALL')}>ทั้งหมด</Button>
        </div>
        <AdjustmentModal />
      </CardHeader>
      <CardContent>
        <QueryBoundary isLoading={q.isLoading} isError={q.isError} error={q.error} onRetry={q.refetch}>
          {q.data && (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-muted-foreground"><th className="py-2">ลูกค้า</th><th>จำนวน</th><th>เหตุผล</th><th>ผู้เสนอ</th><th>สถานะ</th><th /></tr></thead>
              <tbody>
                {q.data.data.map((a) => (
                  <tr key={a.id} className="border-t border-border">
                    <td className="py-2">{a.customer.name}</td>
                    <td className={a.delta > 0 ? 'text-success' : 'text-destructive'}>{a.delta > 0 ? '+' : ''}{a.delta}</td>
                    <td>{a.reason}</td>
                    <td>{a.requester.name}</td>
                    <td><Badge variant={a.status === 'PENDING' ? 'default' : 'secondary'}>{a.status}</Badge></td>
                    <td className="text-right">
                      {a.status === 'PENDING' && (
                        <div className="flex gap-2 justify-end">
                          <Button size="sm" onClick={() => approve.mutate({ id: a.id, action: 'APPROVE' })} disabled={approve.isPending}>อนุมัติ</Button>
                          <Button size="sm" variant="destructive" onClick={() => {
                            const reason = window.prompt('เหตุผลการปฏิเสธ');
                            if (reason) approve.mutate({ id: a.id, action: 'REJECT', reason });
                          }} disabled={approve.isPending}>ปฏิเสธ</Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </QueryBoundary>
      </CardContent>
    </Card>
  );
}
```

(Note: replace `window.prompt` with a proper ConfirmDialog + textarea in a follow-up — for this task the prompt is acceptable since `confirm()` ban is documented; `prompt` for reject reason is pragmatic and will be refined in polish task.)

- [ ] **Step 5: Run tests**

Run: `cd apps/web && npx vitest run LoyaltyAdjustments`

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/LoyaltyPage/components/AdjustmentModal.tsx apps/web/src/pages/LoyaltyPage/components/LoyaltyAdjustments.tsx apps/web/src/pages/LoyaltyPage/__tests__/LoyaltyAdjustments.test.tsx
git commit -m "feat(loyalty): add AdjustmentModal + LoyaltyAdjustments tab"
```

### Task G6: Route + menu wiring

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: menu config file (find via `grep -rn "ลูกค้า" apps/web/src/components/ | head`)

- [ ] **Step 1: Add route (lazy)**

In `apps/web/src/App.tsx`, in the routes section:

```tsx
const LoyaltyPage = lazy(() => import('./pages/LoyaltyPage'));
// inside <Routes>
<Route path="/loyalty" element={<ProtectedRoute><MainLayout><LoyaltyPage /></MainLayout></ProtectedRoute>} />
```

- [ ] **Step 2: Add sidebar menu entry**

Find sidebar config (usually `apps/web/src/components/AppSidebar.tsx` or similar) and add under the Business Operations group:

```tsx
{ path: '/loyalty', label: 'ระบบแต้มสะสม', icon: <Award className="w-4 h-4" /> }
```

Import `Award` from `lucide-react`.

- [ ] **Step 3: Run type check + dev server check**

```bash
./tools/check-types.sh web
# navigate to /loyalty in dev to eyeball
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/App.tsx apps/web/src/components/
git commit -m "feat(loyalty): add /loyalty route + sidebar menu"
```

---

## Phase H — Frontend: Policy Settings Page (Agent 4)

### Task H1: LoyaltyPolicySettingsPage

**Files:**
- Create: `apps/web/src/pages/LoyaltyPolicySettingsPage.tsx`
- Create: `apps/web/src/pages/__tests__/LoyaltyPolicySettingsPage.test.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: settings menu config

- [ ] **Step 1: Write failing test**

Create `apps/web/src/pages/__tests__/LoyaltyPolicySettingsPage.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import LoyaltyPolicySettingsPage from '../LoyaltyPolicySettingsPage';
import { api } from '@/lib/api';

vi.mock('@/lib/api', () => ({ api: { get: vi.fn(), patch: vi.fn() } }));

describe('LoyaltyPolicySettingsPage', () => {
  it('loads and displays current policy', async () => {
    (api.get as any).mockResolvedValue({ data: {
      pointsPerBahtCash: 0.01, pointsPerBahtGfin: 0.01, pointsPerBahtFinance: 0.01,
      completionBonus: 500, referralBonus: 500, referralTrigger: 'FIRST_PAYMENT',
      inactivityMonths: 12, minRedeemPoints: 100, bahtPerPoint: 1,
    } });
    const qc = new QueryClient();
    render(<QueryClientProvider client={qc}><LoyaltyPolicySettingsPage /></QueryClientProvider>);
    await waitFor(() => expect(screen.getByDisplayValue('0.01')).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Implement page**

Create `apps/web/src/pages/LoyaltyPolicySettingsPage.tsx`:

```tsx
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import PageHeader from '@/components/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { QueryBoundary } from '@/components/QueryBoundary';

const schema = z.object({
  pointsPerBahtCash: z.coerce.number().min(0).max(1),
  pointsPerBahtGfin: z.coerce.number().min(0).max(1),
  pointsPerBahtFinance: z.coerce.number().min(0).max(1),
  completionBonus: z.coerce.number().int().min(0),
  referralBonus: z.coerce.number().int().min(0),
  referralTrigger: z.enum(['REGISTER', 'FIRST_PAYMENT', 'CONTRACT_ACTIVATE', 'THIRD_PAYMENT']),
  inactivityMonths: z.coerce.number().int().min(1).max(120),
  minRedeemPoints: z.coerce.number().int().min(0),
  bahtPerPoint: z.coerce.number().min(0.01),
});
type Values = z.infer<typeof schema>;

export default function LoyaltyPolicySettingsPage() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['loyalty-policy'],
    queryFn: async () => (await api.get<Values>('/settings/loyalty-policy')).data,
  });
  const form = useForm<Values>({ resolver: zodResolver(schema), values: q.data });

  const mutation = useMutation({
    mutationFn: async (v: Values) => (await api.patch('/settings/loyalty-policy', v)).data,
    onSuccess: () => { toast.success('บันทึก policy แล้ว'); qc.invalidateQueries({ queryKey: ['loyalty-policy'] }); },
    onError: (err: any) => toast.error(err?.response?.data?.message ?? 'ผิดพลาด'),
  });

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="ตั้งค่าระบบแต้มสะสม" subtitle="อัตราได้แต้ม โบนัส และระยะเวลาหมดอายุ" />
      <QueryBoundary isLoading={q.isLoading} isError={q.isError} error={q.error} onRetry={q.refetch}>
        <Card>
          <CardHeader><CardTitle>Loyalty Policy</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="grid gap-4 grid-cols-1 md:grid-cols-2">
              <div><Label>แต้ม/บาท (ซื้อสด)</Label><Input type="number" step="0.01" {...form.register('pointsPerBahtCash')} /></div>
              <div><Label>แต้ม/บาท (ผ่อน GFIN)</Label><Input type="number" step="0.01" {...form.register('pointsPerBahtGfin')} /></div>
              <div><Label>แต้ม/บาท (ผ่อน FINANCE on-time)</Label><Input type="number" step="0.01" {...form.register('pointsPerBahtFinance')} /></div>
              <div><Label>โบนัสผ่อนหมด</Label><Input type="number" {...form.register('completionBonus')} /></div>
              <div><Label>โบนัสแนะนำเพื่อน (ต่อ 1 คน)</Label><Input type="number" {...form.register('referralBonus')} /></div>
              <div><Label>Trigger แนะนำ</Label>
                <select className="w-full border border-border rounded-md h-9 px-2 bg-background" {...form.register('referralTrigger')}>
                  <option value="REGISTER">สมัครสมาชิก</option>
                  <option value="FIRST_PAYMENT">จ่ายงวดแรก</option>
                  <option value="CONTRACT_ACTIVATE">เปิดสัญญา</option>
                  <option value="THIRD_PAYMENT">จ่าย 3 งวด</option>
                </select>
              </div>
              <div><Label>เดือน inactive → หมดอายุ</Label><Input type="number" {...form.register('inactivityMonths')} /></div>
              <div><Label>แต้มขั้นต่ำแลก</Label><Input type="number" {...form.register('minRedeemPoints')} /></div>
              <div><Label>บาท / 1 แต้ม (แลก)</Label><Input type="number" step="0.01" {...form.register('bahtPerPoint')} /></div>
              <div className="md:col-span-2"><Button type="submit" disabled={mutation.isPending}>บันทึก</Button></div>
            </form>
          </CardContent>
        </Card>
      </QueryBoundary>
    </div>
  );
}
```

- [ ] **Step 3: Add route**

In `App.tsx`:
```tsx
const LoyaltyPolicySettingsPage = lazy(() => import('./pages/LoyaltyPolicySettingsPage'));
// inside routes
<Route path="/settings/loyalty-policy" element={<ProtectedRoute><MainLayout><LoyaltyPolicySettingsPage /></MainLayout></ProtectedRoute>} />
```

- [ ] **Step 4: Add settings menu entry**

Find the Settings submenu config and add:
```tsx
{ path: '/settings/loyalty-policy', label: 'Loyalty Policy', roles: ['OWNER'] }
```

- [ ] **Step 5: Run tests + type check + commit**

```bash
cd apps/web && npx vitest run LoyaltyPolicySettingsPage
./tools/check-types.sh web
git add apps/web/src/pages/LoyaltyPolicySettingsPage.tsx apps/web/src/pages/__tests__/ apps/web/src/App.tsx apps/web/src/components/
git commit -m "feat(loyalty): add /settings/loyalty-policy page"
```

---

## Phase I — E2E + Final Integration

### Task I1: Playwright E2E spec

**Files:**
- Create: `apps/web/e2e/loyalty-admin.spec.ts`

- [ ] **Step 1: Write E2E**

```typescript
import { test, expect } from '@playwright/test';

test.describe('Loyalty admin', () => {
  test('sales submits adjustment → owner approves', async ({ browser }) => {
    // sales context
    const salesCtx = await browser.newContext();
    const salesPage = await salesCtx.newPage();
    await salesPage.goto('/login');
    await salesPage.fill('[name=email]', 'sales1@bestchoice.com');
    await salesPage.fill('[name=password]', 'admin1234');
    await salesPage.click('button[type=submit]');
    await salesPage.waitForURL('/');
    await salesPage.goto('/loyalty');
    await salesPage.click('[role=tab]:has-text("ปรับแต้ม")');
    await salesPage.click('button:has-text("ขอปรับแต้ม")');
    // fill form — need seed customer UUID, hardcoded for test env
    await salesPage.fill('[name=customerId]', process.env.E2E_CUSTOMER_UUID || '');
    await salesPage.fill('[name=delta]', '50');
    await salesPage.click('button:has-text("บันทึก")');
    await expect(salesPage.getByText('ส่งขออนุมัติแล้ว')).toBeVisible();

    // owner context
    const ownerCtx = await browser.newContext();
    const ownerPage = await ownerCtx.newPage();
    await ownerPage.goto('/login');
    await ownerPage.fill('[name=email]', 'admin@bestchoice.com');
    await ownerPage.fill('[name=password]', 'admin1234');
    await ownerPage.click('button[type=submit]');
    await ownerPage.waitForURL('/');
    await ownerPage.goto('/loyalty');
    await ownerPage.click('[role=tab]:has-text("ปรับแต้ม")');
    await ownerPage.click('button:has-text("อนุมัติ")');
    await expect(ownerPage.getByText('อนุมัติแล้ว')).toBeVisible();
  });
});
```

- [ ] **Step 2: Skip test if no E2E_CUSTOMER_UUID**

Add at top of test:
```typescript
test.skip(!process.env.E2E_CUSTOMER_UUID, 'E2E_CUSTOMER_UUID not set');
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/e2e/loyalty-admin.spec.ts
git commit -m "test(loyalty): add E2E spec for adjustment workflow"
```

### Task I2: Final full-suite check + PR

- [ ] **Step 1: Run full tests**

```bash
./tools/check-types.sh all
cd apps/api && npx jest --no-coverage
cd ../web && npx vitest run
```

Expected: 0 TS errors, all new + existing tests pass.

- [ ] **Step 2: Summary commit (if docs changed)**

Optional: update `docs/CTO-ROADMAP-2026.md` marking 5.4 done.

- [ ] **Step 3: Open PR**

```bash
gh pr create --title "feat(loyalty): admin page + policy engine (5.4)" --body "$(cat <<'EOF'
## Summary
- New `/loyalty` admin page (4 tabs): Overview, Customers, Referrals, Adjustments
- New `/settings/loyalty-policy` page: editable rates/bonuses/expiry
- `LoyaltyAdjustment` + `LoyaltyPolicy` schema + migration
- Maker-checker workflow (auto-approve ≤20 bonus, manual for penalty/larger bonus, no self-approve)
- Wired 4 earning triggers: cash sale, GFIN activate, FINANCE completion bonus, on-time (existing)
- Wired referral award at 4 policy-gated trigger points
- Daily expiry cron (rolling 12-month activity-based)

## Test plan
- [ ] Visit `/loyalty` as OWNER — overview cards render
- [ ] Customers tab — search works
- [ ] Referrals tab — tree shows 2 levels
- [ ] Adjustments tab — submit +10 as SALES → AUTO_APPROVED
- [ ] Submit +50 as SALES → PENDING; approve as OWNER → customer balance updates
- [ ] Attempt self-approve → rejected with Thai error
- [ ] Visit `/settings/loyalty-policy` as OWNER — change `referralBonus` to 777 → next referral awards 777
- [ ] Cash sale in POS → loyalty balance increases
EOF
)"
```

---

## Spec Self-Review Notes

**Coverage check vs spec sections:**
- §5 Earning rules → Tasks E1/E2 ✓
- §6 Approval workflow → Task D1 ✓
- §7 Referral triggers → Task E3 ✓
- §8 Expiry → Task F1 ✓
- §9 Schema → Task A1 ✓
- §9 Endpoints → Tasks B2 + D3 ✓
- §9 Frontend routes → Tasks G6 + H1 ✓
- §9 Service refactor → Task C1 ✓
- §9 New trigger points → Tasks E1/E2/E3 ✓
- §9 Cron → Task F1 ✓
- §10 Test plan → tests embedded in each task ✓
- §11 Migration → Task A1 Step 6 ✓
- §14 Acceptance criteria → I1 E2E + manual test plan in I2 ✓

**Consistency fixes already applied:**
- `LoyaltyPoint.contractId` nullable — added as schema change in Task E1 Step 4 (required for expiry entry + cash sale entry)
- `calcPointsForPayment` converted from static to instance method — call sites updated in Task C1 Step 4

**Known simplifications (acceptable per auto-mode scope):**
- `window.prompt` used for reject reason (Task G5) — prompt acceptable since modal already defined; polish follow-up can replace with proper dialog
- Overview top-customer display uses raw table — sparklines deferred per spec §11 "Deliverable" vs nice-to-have

---

**Total estimated effort**: ~1.5-2 days calendar with 4 parallel agents (Agent 1: Phases A-D, Agent 2: Phases E-F, Agent 3: Phase G, Agent 4: Phase H). Merge order: A → B → C → D (Agent 1 serial); E/F/G/H parallel after C; I1 last.
