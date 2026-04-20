# Customer Tier Foundation (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose a computed `CustomerTier` (GOLD/GOOD/NEW/RISKY/BLACKLIST) for every customer, surfaced as a badge on customer list + detail pages, plus a new API endpoint. No flow changes yet — just visibility.

**Architecture:** Tier is computed on-the-fly from existing `Contract`/`Payment` data (no new tier column). Add two Prisma enums + two optional fields (`CustomerCreditCheckStatus`, `CreditCheckType`) to prepare for Phase 2. Backend service is pure — takes history snapshot in, returns tier. Frontend badge is pure component driven by props.

**Tech Stack:** Prisma + PostgreSQL, NestJS, Prisma migrations, React 18 + TS + Tailwind + shadcn/ui + React Query.

**Spec reference:** [docs/superpowers/specs/2026-04-20-customer-intake-credit-check-redesign-design.md](../specs/2026-04-20-customer-intake-credit-check-redesign-design.md)

---

## File Structure

### Created
- `apps/api/src/modules/customers/customer-tier.service.ts` — pure tier compute + history extension
- `apps/api/src/modules/customers/customer-tier.service.spec.ts` — unit tests
- `apps/api/src/modules/customers/dto/tier.dto.ts` — response DTO
- `apps/web/src/components/customer/CustomerTierBadge.tsx` — badge UI
- `apps/web/src/components/customer/CustomerTierBadge.test.tsx` — unit test
- `apps/web/src/types/customer-tier.ts` — shared `CustomerTier` type + constants

### Modified
- `apps/api/prisma/schema.prisma` — add 2 enums + 2 optional fields on existing models
- `apps/api/prisma/migrations/<timestamp>_add_customer_tier_status/migration.sql` — schema migration (auto-generated)
- `apps/api/src/modules/customers/customers.module.ts` — register CustomerTierService
- `apps/api/src/modules/customers/customers.controller.ts` — add GET /:id/tier endpoint
- `apps/api/src/modules/customers/customers.controller.spec.ts` — integration test for new endpoint
- `apps/web/src/pages/CustomersPage.tsx` — add tier column + filter chip
- `apps/web/src/pages/CustomerDetailPage.tsx` — show tier badge in header

---

## Task 1: Add Prisma enums + optional fields

**Files:**
- Modify: `apps/api/prisma/schema.prisma`

- [ ] **Step 1: Add the two enums near top of schema**

Open `apps/api/prisma/schema.prisma`. Find the existing enum section (usually below `generator client`/`datasource` and above `model User`). Add these two enums at the end of the enum section:

```prisma
enum CustomerCreditCheckStatus {
  NONE
  PRE_CHECK_PASSED
  FULL_CHECK_PASSED
  REJECTED
  UNDER_REVIEW
}

enum CreditCheckType {
  PRE
  FULL
}
```

- [ ] **Step 2: Add optional field on `Customer` model**

Find `model Customer {` block. Add this field (place it near other status-like fields; if none, place it just before `createdAt`):

```prisma
  creditCheckStatus   CustomerCreditCheckStatus @default(NONE) @map("credit_check_status")
```

- [ ] **Step 3: Add optional field on `CreditCheck` model**

Find `model CreditCheck {` block. Add this field:

```prisma
  checkType           CreditCheckType @default(FULL) @map("check_type")
```

- [ ] **Step 4: Generate migration**

Run (from repo root):

```bash
cd apps/api && npx prisma migrate dev --name add_customer_tier_status --create-only
```

Expected: New migration directory created under `apps/api/prisma/migrations/<timestamp>_add_customer_tier_status/`. Review `migration.sql` — must only contain `CREATE TYPE` for 2 enums + `ALTER TABLE` adding `credit_check_status` (with default NONE) on `Customer` and `check_type` (with default FULL) on `CreditCheck`. No data loss.

- [ ] **Step 5: Apply migration**

Run:

```bash
cd apps/api && npx prisma migrate dev
```

Expected: "Database in sync". Generated client regenerated automatically.

- [ ] **Step 6: Commit**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/
git commit -m "feat(customer): add CustomerCreditCheckStatus + CreditCheckType enums

Two optional fields with safe defaults (NONE / FULL) — prepares for
Phase 1 tier visibility + Phase 2 pre-check gate. No data migration
needed for existing rows."
```

---

## Task 2: CustomerTierService — tier computation logic

**Files:**
- Create: `apps/api/src/modules/customers/customer-tier.service.ts`
- Create: `apps/api/src/modules/customers/customer-tier.service.spec.ts`
- Create: `apps/api/src/modules/customers/dto/tier.dto.ts`

- [ ] **Step 1: Create tier DTO**

Create `apps/api/src/modules/customers/dto/tier.dto.ts`:

```typescript
export type CustomerTier = 'GOLD' | 'GOOD' | 'NEW' | 'RISKY' | 'BLACKLIST';

export interface TierReason {
  code: string;
  message: string;
}

export interface CustomerTierResponse {
  customerId: string;
  tier: CustomerTier;
  reasons: TierReason[];
  history: {
    totalContracts: number;
    closedContracts: number;
    activeContracts: number;
    onTimePaymentPct: number; // 0-100
    onTimePayments: number;
    latePayments: number;
    maxOverdueDays: number;
    currentOutstanding: number;
    hasBadDebt: boolean;
    hasRepossession: boolean;
  };
}
```

- [ ] **Step 2: Write failing unit tests**

Create `apps/api/src/modules/customers/customer-tier.service.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { CustomerTierService } from './customer-tier.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('CustomerTierService — computeTierFromHistory', () => {
  let service: CustomerTierService;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      providers: [
        CustomerTierService,
        { provide: PrismaService, useValue: {} },
      ],
    }).compile();
    service = mod.get(CustomerTierService);
  });

  const h = (over: Partial<Parameters<typeof service.computeTierFromHistory>[0]>) => ({
    totalContracts: 0,
    closedContracts: 0,
    activeContracts: 0,
    onTimePayments: 0,
    latePayments: 0,
    maxOverdueDays: 0,
    currentOutstanding: 0,
    hasBadDebt: false,
    hasRepossession: false,
    activeContractsAllOnTime: false,
    activeContractsPaidCount: 0,
    ...over,
  });

  it('returns BLACKLIST when hasBadDebt=true', () => {
    const r = service.computeTierFromHistory(h({ hasBadDebt: true }));
    expect(r.tier).toBe('BLACKLIST');
    expect(r.reasons.map((x) => x.code)).toContain('BAD_DEBT');
  });

  it('returns BLACKLIST when hasRepossession=true', () => {
    const r = service.computeTierFromHistory(h({ hasRepossession: true }));
    expect(r.tier).toBe('BLACKLIST');
    expect(r.reasons.map((x) => x.code)).toContain('REPOSSESSED');
  });

  it('returns RISKY when maxOverdueDays > 30 and no bad debt', () => {
    const r = service.computeTierFromHistory(
      h({ closedContracts: 1, onTimePayments: 10, latePayments: 2, maxOverdueDays: 45 }),
    );
    expect(r.tier).toBe('RISKY');
    expect(r.reasons.map((x) => x.code)).toContain('OVERDUE_OVER_30');
  });

  it('returns GOLD when closedContracts >= 2 and onTime 100%', () => {
    const r = service.computeTierFromHistory(
      h({ closedContracts: 2, totalContracts: 2, onTimePayments: 24, latePayments: 0 }),
    );
    expect(r.tier).toBe('GOLD');
  });

  it('returns GOOD when onTime >= 90% and closedContracts >= 1', () => {
    const r = service.computeTierFromHistory(
      h({ closedContracts: 1, totalContracts: 1, onTimePayments: 11, latePayments: 1 }),
    );
    expect(r.tier).toBe('GOOD');
  });

  it('returns GOOD when active contract all on-time and >= 3 payments', () => {
    const r = service.computeTierFromHistory(
      h({ activeContracts: 1, totalContracts: 1, activeContractsAllOnTime: true, activeContractsPaidCount: 3, onTimePayments: 3, latePayments: 0 }),
    );
    expect(r.tier).toBe('GOOD');
  });

  it('returns NEW when no history', () => {
    const r = service.computeTierFromHistory(h({}));
    expect(r.tier).toBe('NEW');
  });

  it('returns NEW when has contract but not enough on-time data', () => {
    const r = service.computeTierFromHistory(
      h({ activeContracts: 1, totalContracts: 1, activeContractsAllOnTime: true, activeContractsPaidCount: 1 }),
    );
    expect(r.tier).toBe('NEW');
  });
});
```

- [ ] **Step 3: Run tests — expect failure**

Run from repo root:

```bash
cd apps/api && npx jest customer-tier.service --no-coverage
```

Expected: FAIL — `Cannot find module './customer-tier.service'`.

- [ ] **Step 4: Create the service with minimal implementation**

Create `apps/api/src/modules/customers/customer-tier.service.ts`:

```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  CustomerTier,
  CustomerTierResponse,
  TierReason,
} from './dto/tier.dto';

interface TierInputHistory {
  totalContracts: number;
  closedContracts: number;
  activeContracts: number;
  onTimePayments: number;
  latePayments: number;
  maxOverdueDays: number;
  currentOutstanding: number;
  hasBadDebt: boolean;
  hasRepossession: boolean;
  activeContractsAllOnTime: boolean;
  activeContractsPaidCount: number;
}

@Injectable()
export class CustomerTierService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Pure tier computation — no DB calls. Given a normalized history snapshot,
   * returns the tier + machine-readable reasons.
   */
  computeTierFromHistory(history: TierInputHistory): {
    tier: CustomerTier;
    reasons: TierReason[];
  } {
    const reasons: TierReason[] = [];

    if (history.hasBadDebt) {
      reasons.push({ code: 'BAD_DEBT', message: 'เคยถูกตัดเป็นหนี้สูญ' });
      return { tier: 'BLACKLIST', reasons };
    }
    if (history.hasRepossession) {
      reasons.push({ code: 'REPOSSESSED', message: 'เคยถูกยึดเครื่อง' });
      return { tier: 'BLACKLIST', reasons };
    }

    if (history.maxOverdueDays > 30) {
      reasons.push({
        code: 'OVERDUE_OVER_30',
        message: `เคยค้างชำระเกิน 30 วัน (สูงสุด ${history.maxOverdueDays} วัน)`,
      });
      return { tier: 'RISKY', reasons };
    }

    const totalPayments = history.onTimePayments + history.latePayments;
    const onTimePct = totalPayments > 0 ? (history.onTimePayments / totalPayments) * 100 : 0;

    if (history.closedContracts >= 2 && onTimePct === 100) {
      reasons.push({
        code: 'GOLD',
        message: `ปิดสัญญา ${history.closedContracts} ครั้ง จ่ายตรงเวลา 100%`,
      });
      return { tier: 'GOLD', reasons };
    }

    if (onTimePct >= 90 && history.closedContracts >= 1) {
      reasons.push({
        code: 'GOOD_CLOSED',
        message: `เคยปิดสัญญา ${history.closedContracts} ครั้ง จ่ายตรงเวลา ${onTimePct.toFixed(0)}%`,
      });
      return { tier: 'GOOD', reasons };
    }

    if (
      history.activeContractsAllOnTime &&
      history.activeContractsPaidCount >= 3 &&
      history.activeContracts >= 1
    ) {
      reasons.push({
        code: 'GOOD_ACTIVE',
        message: `สัญญาปัจจุบันจ่ายตรงเวลา ${history.activeContractsPaidCount} งวดติด`,
      });
      return { tier: 'GOOD', reasons };
    }

    reasons.push({ code: 'NEW', message: 'ลูกค้าใหม่หรือยังไม่มีประวัติเพียงพอ' });
    return { tier: 'NEW', reasons };
  }

  async getCustomerTier(customerId: string): Promise<CustomerTierResponse> {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, deletedAt: null },
      select: { id: true },
    });
    if (!customer) throw new NotFoundException('ไม่พบลูกค้า');

    const contracts = await this.prisma.contract.findMany({
      where: { customerId, deletedAt: null },
      select: {
        id: true,
        status: true,
        totalMonths: true,
        monthlyPayment: true,
        writtenOffAt: true,
        payments: {
          select: { status: true, dueDate: true, paidAt: true },
        },
      },
    });

    const repossessionCount = await this.prisma.repossession.count({
      where: { contract: { customerId }, deletedAt: null },
    });

    const totalContracts = contracts.length;
    const closedContracts = contracts.filter(
      (c) => c.status === 'COMPLETED' || c.status === 'EARLY_PAYOFF',
    ).length;
    const activeContracts = contracts.filter(
      (c) => c.status === 'ACTIVE' || c.status === 'OVERDUE',
    ).length;

    const hasBadDebt =
      contracts.some(
        (c) =>
          c.writtenOffAt != null ||
          c.status === 'WRITTEN_OFF' ||
          c.status === 'CLOSED_BAD_DEBT' ||
          c.status === 'DEFAULTED',
      );
    const hasRepossession = repossessionCount > 0;

    let onTimePayments = 0;
    let latePayments = 0;
    let maxOverdueDays = 0;
    let currentOutstanding = 0;
    let activeContractsPaidCount = 0;
    let activeAllOnTime = activeContracts > 0;

    for (const contract of contracts) {
      const isActive = contract.status === 'ACTIVE' || contract.status === 'OVERDUE';
      let contractActivePaid = 0;
      let contractActiveLate = 0;

      for (const p of contract.payments) {
        if (p.status === 'PAID') {
          onTimePayments++;
          if (isActive) contractActivePaid++;
        } else if (p.status === 'OVERDUE') {
          latePayments++;
          if (isActive) contractActiveLate++;
          const due = new Date(p.dueDate).getTime();
          const end = p.paidAt ? new Date(p.paidAt).getTime() : Date.now();
          const days = Math.max(0, Math.floor((end - due) / 86_400_000));
          if (days > maxOverdueDays) maxOverdueDays = days;
        }
      }

      if (isActive) {
        const paidCount = contract.payments.filter((p) => p.status === 'PAID').length;
        const remaining = contract.totalMonths - paidCount;
        currentOutstanding += remaining * Number(contract.monthlyPayment);
        activeContractsPaidCount += contractActivePaid;
        if (contractActiveLate > 0) activeAllOnTime = false;
      }
    }

    const totalPayments = onTimePayments + latePayments;
    const onTimePct =
      totalPayments > 0 ? Math.round((onTimePayments / totalPayments) * 10000) / 100 : 0;

    const { tier, reasons } = this.computeTierFromHistory({
      totalContracts,
      closedContracts,
      activeContracts,
      onTimePayments,
      latePayments,
      maxOverdueDays,
      currentOutstanding,
      hasBadDebt,
      hasRepossession,
      activeContractsAllOnTime: activeAllOnTime,
      activeContractsPaidCount,
    });

    return {
      customerId,
      tier,
      reasons,
      history: {
        totalContracts,
        closedContracts,
        activeContracts,
        onTimePaymentPct: onTimePct,
        onTimePayments,
        latePayments,
        maxOverdueDays,
        currentOutstanding: Math.round(currentOutstanding * 100) / 100,
        hasBadDebt,
        hasRepossession,
      },
    };
  }
}
```

- [ ] **Step 5: Run tests — expect pass**

Run:

```bash
cd apps/api && npx jest customer-tier.service --no-coverage
```

Expected: PASS — 8 tests passing.

- [ ] **Step 6: Commit**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE
git add apps/api/src/modules/customers/customer-tier.service.ts apps/api/src/modules/customers/customer-tier.service.spec.ts apps/api/src/modules/customers/dto/tier.dto.ts
git commit -m "feat(customer): add CustomerTierService with pure tier computation

- Pure computeTierFromHistory function drives decision (BLACKLIST →
  RISKY → GOLD → GOOD → NEW precedence)
- getCustomerTier queries Contract + Payment + Repossession and
  aggregates into TierInputHistory
- 8 unit tests cover each tier boundary + reasons"
```

---

## Task 3: Expose `GET /customers/:id/tier` endpoint

**Files:**
- Modify: `apps/api/src/modules/customers/customers.module.ts`
- Modify: `apps/api/src/modules/customers/customers.controller.ts`
- Modify: `apps/api/src/modules/customers/customers.controller.spec.ts`

- [ ] **Step 1: Register service in module**

Open `apps/api/src/modules/customers/customers.module.ts`. Add import:

```typescript
import { CustomerTierService } from './customer-tier.service';
```

Add `CustomerTierService` to `providers` array. Add to `exports` array (so other modules can use tier later in Phase 2).

- [ ] **Step 2: Write failing controller test**

Open `apps/api/src/modules/customers/customers.controller.spec.ts`. Inside the main `describe`, add:

```typescript
describe('GET /customers/:id/tier', () => {
  it('returns tier response from service', async () => {
    const mockResp = {
      customerId: 'cust-1',
      tier: 'GOLD',
      reasons: [{ code: 'GOLD', message: 'x' }],
      history: {
        totalContracts: 3, closedContracts: 3, activeContracts: 0,
        onTimePaymentPct: 100, onTimePayments: 36, latePayments: 0,
        maxOverdueDays: 0, currentOutstanding: 0,
        hasBadDebt: false, hasRepossession: false,
      },
    };
    const tierSpy = jest.spyOn(tierService, 'getCustomerTier').mockResolvedValue(mockResp as any);
    const result = await controller.getTier('cust-1');
    expect(tierSpy).toHaveBeenCalledWith('cust-1');
    expect(result.tier).toBe('GOLD');
  });
});
```

You'll also need to wire `tierService` in the test setup — add to the providers array in the `Test.createTestingModule` call:

```typescript
{ provide: CustomerTierService, useValue: { getCustomerTier: jest.fn() } },
```

and add above the `describe` blocks:

```typescript
let tierService: CustomerTierService;
// inside beforeAll after `controller = moduleRef.get(CustomersController);`:
tierService = moduleRef.get(CustomerTierService);
```

Don't forget the import at top:

```typescript
import { CustomerTierService } from './customer-tier.service';
```

- [ ] **Step 3: Run test — expect failure**

Run:

```bash
cd apps/api && npx jest customers.controller --no-coverage
```

Expected: FAIL — `controller.getTier is not a function` or similar.

- [ ] **Step 4: Add endpoint to controller**

Open `apps/api/src/modules/customers/customers.controller.ts`. Add import:

```typescript
import { CustomerTierService } from './customer-tier.service';
import type { CustomerTierResponse } from './dto/tier.dto';
```

Inject service in constructor (add to existing constructor params):

```typescript
constructor(
  private readonly customersService: CustomersService,
  private readonly tierService: CustomerTierService,
  // ...other existing services
) {}
```

Add endpoint method (place near other GET-by-id methods):

```typescript
@Get(':id/tier')
@Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
async getTier(@Param('id') id: string): Promise<CustomerTierResponse> {
  return this.tierService.getCustomerTier(id);
}
```

- [ ] **Step 5: Run test — expect pass**

Run:

```bash
cd apps/api && npx jest customers.controller --no-coverage
```

Expected: PASS.

- [ ] **Step 6: Smoke-test with curl (manual verification)**

Start API if not running (`cd apps/api && npm run dev`). In another terminal:

```bash
# Login first to get a token, or use existing dev session token
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3000/customers | jq '.data[0].id'
# Take the id from above, then:
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3000/customers/<id>/tier | jq
```

Expected response shape:

```json
{
  "customerId": "...",
  "tier": "NEW",
  "reasons": [{ "code": "NEW", "message": "..." }],
  "history": { "totalContracts": 0, ... }
}
```

- [ ] **Step 7: Commit**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE
git add apps/api/src/modules/customers/customers.module.ts apps/api/src/modules/customers/customers.controller.ts apps/api/src/modules/customers/customers.controller.spec.ts
git commit -m "feat(customer): add GET /customers/:id/tier endpoint

Guarded by JwtAuthGuard + RolesGuard (all authenticated roles).
Delegates fully to CustomerTierService."
```

---

## Task 4: Shared types + CustomerTierBadge component

**Files:**
- Create: `apps/web/src/types/customer-tier.ts`
- Create: `apps/web/src/components/customer/CustomerTierBadge.tsx`
- Create: `apps/web/src/components/customer/CustomerTierBadge.test.tsx`

- [ ] **Step 1: Create shared type file**

Create `apps/web/src/types/customer-tier.ts`:

```typescript
export type CustomerTier = 'GOLD' | 'GOOD' | 'NEW' | 'RISKY' | 'BLACKLIST';

export interface TierReason {
  code: string;
  message: string;
}

export interface CustomerTierResponse {
  customerId: string;
  tier: CustomerTier;
  reasons: TierReason[];
  history: {
    totalContracts: number;
    closedContracts: number;
    activeContracts: number;
    onTimePaymentPct: number;
    onTimePayments: number;
    latePayments: number;
    maxOverdueDays: number;
    currentOutstanding: number;
    hasBadDebt: boolean;
    hasRepossession: boolean;
  };
}

export const TIER_LABELS: Record<CustomerTier, string> = {
  GOLD: 'VIP (Gold)',
  GOOD: 'ลูกค้าดี',
  NEW: 'ลูกค้าใหม่',
  RISKY: 'ต้องระวัง',
  BLACKLIST: 'ห้ามทำสัญญา',
};
```

- [ ] **Step 2: Write failing component test**

Create `apps/web/src/components/customer/CustomerTierBadge.test.tsx`:

```typescript
import { render, screen } from '@testing-library/react';
import CustomerTierBadge from './CustomerTierBadge';

describe('CustomerTierBadge', () => {
  it('renders GOLD label', () => {
    render(<CustomerTierBadge tier="GOLD" />);
    expect(screen.getByText('VIP (Gold)')).toBeInTheDocument();
  });

  it('renders GOOD label', () => {
    render(<CustomerTierBadge tier="GOOD" />);
    expect(screen.getByText('ลูกค้าดี')).toBeInTheDocument();
  });

  it('renders NEW label', () => {
    render(<CustomerTierBadge tier="NEW" />);
    expect(screen.getByText('ลูกค้าใหม่')).toBeInTheDocument();
  });

  it('renders RISKY label', () => {
    render(<CustomerTierBadge tier="RISKY" />);
    expect(screen.getByText('ต้องระวัง')).toBeInTheDocument();
  });

  it('renders BLACKLIST label', () => {
    render(<CustomerTierBadge tier="BLACKLIST" />);
    expect(screen.getByText('ห้ามทำสัญญา')).toBeInTheDocument();
  });

  it('applies GOLD colour tokens', () => {
    const { container } = render(<CustomerTierBadge tier="GOLD" />);
    const el = container.firstChild as HTMLElement;
    expect(el.className).toMatch(/amber/);
  });
});
```

- [ ] **Step 3: Run test — expect failure**

Run (from repo root):

```bash
cd apps/web && npx vitest run src/components/customer/CustomerTierBadge.test.tsx
```

Expected: FAIL — cannot resolve `./CustomerTierBadge`.

- [ ] **Step 4: Implement badge**

Create `apps/web/src/components/customer/CustomerTierBadge.tsx`:

```typescript
import { Crown, Check, User, AlertTriangle, XCircle } from 'lucide-react';
import type { CustomerTier } from '@/types/customer-tier';
import { TIER_LABELS } from '@/types/customer-tier';

interface Props {
  tier: CustomerTier;
  size?: 'sm' | 'md';
  showIcon?: boolean;
  className?: string;
}

const TIER_STYLES: Record<CustomerTier, string> = {
  GOLD: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30',
  GOOD: 'bg-success/10 text-success border-success/30',
  NEW: 'bg-muted text-muted-foreground border-border',
  RISKY: 'bg-warning/10 text-warning border-warning/30',
  BLACKLIST: 'bg-destructive/10 text-destructive border-destructive/30',
};

const TIER_ICONS: Record<CustomerTier, typeof Crown> = {
  GOLD: Crown,
  GOOD: Check,
  NEW: User,
  RISKY: AlertTriangle,
  BLACKLIST: XCircle,
};

export default function CustomerTierBadge({
  tier,
  size = 'sm',
  showIcon = true,
  className = '',
}: Props) {
  const Icon = TIER_ICONS[tier];
  const sizeCls = size === 'sm' ? 'text-2xs px-2 py-0.5' : 'text-xs px-2.5 py-1';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border font-medium ${TIER_STYLES[tier]} ${sizeCls} ${className}`}
      title={TIER_LABELS[tier]}
    >
      {showIcon && <Icon className={size === 'sm' ? 'size-3' : 'size-3.5'} />}
      {TIER_LABELS[tier]}
    </span>
  );
}
```

- [ ] **Step 5: Run test — expect pass**

Run:

```bash
cd apps/web && npx vitest run src/components/customer/CustomerTierBadge.test.tsx
```

Expected: PASS — 6 tests passing.

- [ ] **Step 6: Commit**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE
git add apps/web/src/types/customer-tier.ts apps/web/src/components/customer/CustomerTierBadge.tsx apps/web/src/components/customer/CustomerTierBadge.test.tsx
git commit -m "feat(customer): add CustomerTierBadge component

Pure component driven by tier prop. 5 tier colours using semantic
Tailwind tokens (+ amber for GOLD). Lucide icons per tier."
```

---

## Task 5: Show tier badge on Customer Detail page

**Files:**
- Modify: `apps/web/src/pages/CustomerDetailPage.tsx`

- [ ] **Step 1: Add the tier query + badge in header**

Open `apps/web/src/pages/CustomerDetailPage.tsx`. At the top, add imports:

```typescript
import CustomerTierBadge from '@/components/customer/CustomerTierBadge';
import type { CustomerTierResponse } from '@/types/customer-tier';
```

Find the existing `useQuery<CustomerDetail>(...)` call (query key starts with `['customer', id]`). Right after it, add:

```typescript
const { data: tierData } = useQuery<CustomerTierResponse>({
  queryKey: ['customer-tier', id],
  queryFn: async () => {
    const { data } = await api.get(`/customers/${id}/tier`);
    return data;
  },
  enabled: !!id,
  staleTime: 5 * 60 * 1000, // 5 min cache per spec
});
```

- [ ] **Step 2: Render the badge in the `PageHeader`/title area**

Find the `PageHeader` usage (or equivalent header block showing customer's name). Add the badge beside the name. Example: if the header uses `<PageHeader title={customer.name} ...>`, replace the title-containing section with:

```tsx
<div className="flex items-center gap-2">
  <span>{customer.name}</span>
  {tierData && <CustomerTierBadge tier={tierData.tier} size="md" />}
</div>
```

If there's no convenient slot, render the badge just below the name:

```tsx
{tierData && (
  <div className="mt-1">
    <CustomerTierBadge tier={tierData.tier} size="md" />
  </div>
)}
```

- [ ] **Step 3: Manually test in browser**

Start web dev server if needed (`cd apps/web && npm run dev`). Open a customer detail page (`http://localhost:5173/customers/<id>`). Expected: badge renders next to/below the customer name. Try several customers with different histories — `NEW` should be most common on dev data.

- [ ] **Step 4: Type check**

Run:

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE && ./tools/check-types.sh web
```

Expected: "Web: OK".

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/CustomerDetailPage.tsx
git commit -m "feat(customer): show CustomerTierBadge on detail page header

Query /customers/:id/tier with 5 min cache (aligns with spec
section 8 caching note)."
```

---

## Task 6: Show tier column on Customers list

**Files:**
- Modify: `apps/web/src/pages/CustomersPage.tsx`

- [ ] **Step 1: Extend list API to include tier**

The `/customers` endpoint returns a list without tier. Two options:
- **Option A (chosen):** add a small query-per-row via React Query with `enabled` gated by viewport — but this N+1s badly.
- **Option B (chosen):** compute tier on the backend as part of list response.

Go with Option B (batch). In `apps/api/src/modules/customers/customers.service.ts`, find the list-returning method (likely `list()` or `findAll()`). After fetching customers, compute tier for each using `CustomerTierService.getCustomerTier` in parallel with `Promise.all`. Attach as `tier` field.

Example modification (add near the return):

```typescript
const withTier = await Promise.all(
  customers.map(async (c) => {
    try {
      const t = await this.tierService.getCustomerTier(c.id);
      return { ...c, tier: t.tier };
    } catch {
      return { ...c, tier: 'NEW' as const };
    }
  }),
);
```

Inject `CustomerTierService` in the service constructor + module. This is bounded by the page limit (default 50), so up to 50 tier queries per request — acceptable for now.

- [ ] **Step 2: Update frontend types**

In `apps/web/src/pages/CustomersPage.tsx`, find the `Customer` interface (or the inline type used by the table). Add:

```typescript
import type { CustomerTier } from '@/types/customer-tier';

// inside the Customer interface
tier?: CustomerTier;
```

- [ ] **Step 3: Render tier column**

Find the `columns` array for the customer DataTable. Insert a new column after `เครดิต` (or wherever fits):

```typescript
{
  key: 'tier',
  label: 'ระดับ',
  hideable: true,
  render: (c: Customer) =>
    c.tier ? <CustomerTierBadge tier={c.tier} /> : null,
},
```

Add import:

```typescript
import CustomerTierBadge from '@/components/customer/CustomerTierBadge';
```

- [ ] **Step 4: Add tier filter chip**

Find the existing filter controls (status / credit / branch). Add a new select:

```tsx
<select
  value={tierFilter}
  onChange={(e) => setTierFilter(e.target.value)}
  className="h-10 px-3 rounded-lg border border-input bg-background text-sm"
>
  <option value="">ทุกระดับลูกค้า</option>
  <option value="GOLD">VIP (Gold)</option>
  <option value="GOOD">ลูกค้าดี</option>
  <option value="NEW">ลูกค้าใหม่</option>
  <option value="RISKY">ต้องระวัง</option>
  <option value="BLACKLIST">ห้ามทำสัญญา</option>
</select>
```

Add state:

```typescript
const [tierFilter, setTierFilter] = useState('');
```

Thread it into the `useQuery` key + API call params (add `tier` query param):

```typescript
// inside buildParams or where URLSearchParams is built
if (tierFilter) params.set('tier', tierFilter);
```

- [ ] **Step 5: Support `tier` filter on backend**

Back in `apps/api/src/modules/customers/customers.service.ts`, after computing tier for each row, filter by `tier` query param if provided:

```typescript
const filtered = tier ? withTier.filter((c) => c.tier === tier) : withTier;
```

Also in the controller, accept `tier` in the `@Query()` params and pass to service.

Note: filtering after tier compute means pagination is on the pre-filter set. For v1 this is acceptable (most branches have < 500 customers). A future optimization can move tier compute into a SQL view.

- [ ] **Step 6: Type check + run**

Run:

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE && ./tools/check-types.sh all
```

Expected: "TypeScript check passed!".

Start dev servers and manually verify:
- Open `/customers` — tier badge shows in the list
- Change tier filter — list updates
- Empty filter — all rows shown

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/customers/ apps/web/src/pages/CustomersPage.tsx
git commit -m "feat(customer): show tier column + filter on customers list

Backend computes tier per row (bounded by page limit). Frontend adds
'ระดับ' column + tier filter dropdown.

Known limitation: tier filter applies after page fetch — small shops
only, revisit with SQL view when customer count grows."
```

---

## Task 7: Integration smoke test + ship check

**Files:**
- Modify: `apps/web/e2e/customer-tier.spec.ts` (new E2E spec)

- [ ] **Step 1: Write E2E smoke test**

Create `apps/web/e2e/customer-tier.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';
import { loginViaAPI } from './helpers/auth';
import { gotoWithRetry, hasErrorBoundary } from './helpers/navigation';

test.describe('Customer Tier badge', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
  });

  test('customers list shows tier column', async ({ page }) => {
    const ok = await gotoWithRetry(page, '/customers');
    if (!ok) return;
    await expect(page.getByText('ระดับ').first()).toBeVisible({ timeout: 15000 });
    expect(await hasErrorBoundary(page)).toBe(false);
  });

  test('customer detail page shows tier badge in header', async ({ page }) => {
    const ok = await gotoWithRetry(page, '/customers');
    if (!ok) return;
    // Click first row
    const firstRow = page.locator('table tbody tr').first();
    if (await firstRow.isVisible({ timeout: 5000 }).catch(() => false)) {
      await firstRow.click();
      await page.waitForURL(/\/customers\/[^/]+$/, { timeout: 10000 });
      // Tier label must appear somewhere
      const tierText = page.getByText(
        /VIP \(Gold\)|ลูกค้าดี|ลูกค้าใหม่|ต้องระวัง|ห้ามทำสัญญา/,
      ).first();
      await expect(tierText).toBeVisible({ timeout: 10000 });
      expect(await hasErrorBoundary(page)).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run E2E locally**

Make sure both API + web dev servers are running. Then:

```bash
cd apps/web && npx playwright test e2e/customer-tier.spec.ts --headed
```

Expected: 2 tests passing.

- [ ] **Step 3: Run full type check**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE && ./tools/check-types.sh all
```

Expected: "TypeScript check passed!".

- [ ] **Step 4: Run API tests affected**

```bash
cd apps/api && npx jest customer-tier customers.controller --no-coverage
```

Expected: all pass.

- [ ] **Step 5: Commit + open PR**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE
git add apps/web/e2e/customer-tier.spec.ts
git commit -m "test(customer): add E2E smoke for tier badge rendering"

# Push the feature branch + open PR
git checkout -b feat/customer-tier-phase1
git push -u origin feat/customer-tier-phase1
gh pr create --base main --title "feat(customer): Tier foundation (Phase 1)" --body "Implements Phase 1 of customer intake redesign spec. Adds computed CustomerTier visible on customers list + detail pages. No flow changes yet.

See spec: docs/superpowers/specs/2026-04-20-customer-intake-credit-check-redesign-design.md

## Manual test plan
- [ ] /customers — tier column visible, filter works
- [ ] /customers/:id — tier badge visible in header"
```

---

## Self-Review

### Spec coverage
- Section 2 (Goals): tier visibility — ✓ Tasks 5-6
- Section 6 (Data model): enums + fields — ✓ Task 1
- Section 6 (Tier computation): BLACKLIST → RISKY → GOLD → GOOD → NEW — ✓ Task 2
- Section 7 (Components): CustomerTierBadge — ✓ Task 4
- Section 8 (Backend): GET /customers/:id/tier — ✓ Task 3
- Section 12 Phase 1 items — all covered
- Phase 2/3/4 items — explicitly out of scope, future plans

### Placeholder scan
- No TBD/TODO
- All code steps include complete code
- All test steps show actual assertions
- All commands include expected output
- Tier computation logic matches spec section 5 exactly (GOLD/GOOD conditions including active-contract on-time rule)

### Type consistency
- `CustomerTier` type identical backend DTO + frontend types
- `CustomerTierResponse` shape identical in both
- `computeTierFromHistory` input contract consistent across service + tests
- Tier enum values GOLD/GOOD/NEW/RISKY/BLACKLIST used consistently

No issues.
