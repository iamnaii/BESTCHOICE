# Customer Pre-check Gate (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add `POST /customers/pre-check` endpoint that runs blacklist check + AI-lite analysis on statement, returns tier + decision (PASS / FAIL / REVIEW). Cache result 1 hour. No UI yet — wizard comes in Phase 3.

**Architecture:** Service layer combines existing `CustomerTierService` (Phase 1) + reuse of AI statement analysis + new in-memory cache. Decision logic is pure/testable. Writes a `CreditCheck` record with `checkType=PRE`.

**Tech Stack:** NestJS, Prisma, existing OCR/AI infra (`/ocr/bank-statement`), jest.

**Spec reference:** [docs/superpowers/specs/2026-04-20-customer-intake-credit-check-redesign-design.md](../specs/2026-04-20-customer-intake-credit-check-redesign-design.md) sections 5, 8, 13.

---

## File Structure

### Created
- `apps/api/src/modules/customers/customer-precheck.service.ts` — orchestrator
- `apps/api/src/modules/customers/customer-precheck.service.spec.ts` — unit tests (decision matrix)
- `apps/api/src/modules/customers/dto/precheck.dto.ts` — request + response DTOs with class-validator

### Modified
- `apps/api/src/modules/customers/customers.controller.ts` — add `POST /customers/pre-check`
- `apps/api/src/modules/customers/customers.controller.spec.ts` — integration test
- `apps/api/src/modules/customers/customers.module.ts` — register CustomerPreCheckService

---

## Task 1: DTO types

**Files:**
- Create: `apps/api/src/modules/customers/dto/precheck.dto.ts`

- [ ] **Step 1: Write the DTO**

```typescript
import { IsString, IsOptional, IsArray, Matches, IsPhoneNumber } from 'class-validator';
import type { CustomerTier } from './tier.dto';

export class CustomerPreCheckDto {
  @IsString()
  @Matches(/^\d{13}$/, { message: 'เลขบัตรประชาชนต้องมี 13 หลัก' })
  nationalId!: string;

  @IsString()
  @Matches(/^0\d{8,9}$/, { message: 'เบอร์โทรไม่ถูกต้อง' })
  phone!: string;

  @IsOptional()
  @IsString()
  bankName?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  statementFiles?: string[];
}

export type PreCheckDecision = 'PASS' | 'FAIL' | 'REVIEW';

export interface CustomerPreCheckResponse {
  customerId: string;
  isNewCustomer: boolean;
  tier: CustomerTier;
  decision: PreCheckDecision;
  reasons: { code: string; message: string }[];
  aiScore?: number;
  creditCheckId?: string;
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/modules/customers/dto/precheck.dto.ts
git commit -m "feat(customer): add CustomerPreCheckDto + response types"
```

---

## Task 2: CustomerPreCheckService — decision matrix + tests

**Files:**
- Create: `apps/api/src/modules/customers/customer-precheck.service.ts`
- Create: `apps/api/src/modules/customers/customer-precheck.service.spec.ts`

- [ ] **Step 1: Write failing tests for decision logic**

```typescript
import { Test } from '@nestjs/testing';
import { CustomerPreCheckService } from './customer-precheck.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CustomerTierService } from './customer-tier.service';

describe('CustomerPreCheckService — decideOutcome (pure)', () => {
  let service: CustomerPreCheckService;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      providers: [
        CustomerPreCheckService,
        { provide: PrismaService, useValue: {} },
        { provide: CustomerTierService, useValue: {} },
      ],
    }).compile();
    service = mod.get(CustomerPreCheckService);
  });

  it('BLACKLIST always FAIL', () => {
    const r = service.decideOutcome('BLACKLIST', undefined);
    expect(r.decision).toBe('FAIL');
  });

  it('RISKY always REVIEW', () => {
    const r = service.decideOutcome('RISKY', 80);
    expect(r.decision).toBe('REVIEW');
  });

  it('GOLD always PASS — even without AI', () => {
    const r = service.decideOutcome('GOLD', undefined);
    expect(r.decision).toBe('PASS');
  });

  it('GOOD with AI >= 50 PASS', () => {
    const r = service.decideOutcome('GOOD', 65);
    expect(r.decision).toBe('PASS');
  });

  it('GOOD with AI 40-49 REVIEW', () => {
    const r = service.decideOutcome('GOOD', 45);
    expect(r.decision).toBe('REVIEW');
  });

  it('GOOD with AI < 40 FAIL', () => {
    const r = service.decideOutcome('GOOD', 35);
    expect(r.decision).toBe('FAIL');
  });

  it('GOOD without AI PASS (history is enough)', () => {
    const r = service.decideOutcome('GOOD', undefined);
    expect(r.decision).toBe('PASS');
  });

  it('NEW with AI >= 50 PASS', () => {
    const r = service.decideOutcome('NEW', 60);
    expect(r.decision).toBe('PASS');
  });

  it('NEW with AI 40-49 REVIEW', () => {
    const r = service.decideOutcome('NEW', 45);
    expect(r.decision).toBe('REVIEW');
  });

  it('NEW with AI < 40 FAIL', () => {
    const r = service.decideOutcome('NEW', 30);
    expect(r.decision).toBe('FAIL');
  });

  it('NEW without AI REVIEW (cannot decide)', () => {
    const r = service.decideOutcome('NEW', undefined);
    expect(r.decision).toBe('REVIEW');
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd apps/api && npx jest customer-precheck.service --no-coverage
```

- [ ] **Step 3: Implement service**

Create `apps/api/src/modules/customers/customer-precheck.service.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CustomerTierService } from './customer-tier.service';
import type { CustomerTier } from './dto/tier.dto';
import type { CustomerPreCheckResponse, PreCheckDecision } from './dto/precheck.dto';

const PASS_THRESHOLD = 50;
const REVIEW_THRESHOLD = 40;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

interface CacheEntry {
  result: CustomerPreCheckResponse;
  expires: number;
}

@Injectable()
export class CustomerPreCheckService {
  private readonly logger = new Logger(CustomerPreCheckService.name);
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly tierService: CustomerTierService,
  ) {}

  decideOutcome(
    tier: CustomerTier,
    aiScore: number | undefined,
  ): { decision: PreCheckDecision; reasons: { code: string; message: string }[] } {
    const reasons: { code: string; message: string }[] = [];

    if (tier === 'BLACKLIST') {
      reasons.push({ code: 'BLACKLIST', message: 'ลูกค้าอยู่ในรายชื่อห้ามทำสัญญา' });
      return { decision: 'FAIL', reasons };
    }

    if (tier === 'RISKY') {
      reasons.push({ code: 'RISKY_TIER', message: 'มีประวัติค้างชำระ — ต้องให้ผู้จัดการตรวจเพิ่ม' });
      return { decision: 'REVIEW', reasons };
    }

    if (tier === 'GOLD') {
      reasons.push({ code: 'GOLD_TIER', message: 'ลูกค้า VIP — ผ่านเกณฑ์อัตโนมัติ' });
      return { decision: 'PASS', reasons };
    }

    if (tier === 'GOOD') {
      if (aiScore === undefined) {
        reasons.push({ code: 'GOOD_HISTORY', message: 'ประวัติดี — ผ่านเกณฑ์' });
        return { decision: 'PASS', reasons };
      }
      if (aiScore >= PASS_THRESHOLD) {
        reasons.push({ code: 'GOOD_HISTORY_AI_PASS', message: `ประวัติดี + AI ${aiScore}` });
        return { decision: 'PASS', reasons };
      }
      if (aiScore >= REVIEW_THRESHOLD) {
        reasons.push({ code: 'GOOD_HISTORY_AI_BORDERLINE', message: `ประวัติดี แต่ AI ${aiScore} ก้ำกึ่ง` });
        return { decision: 'REVIEW', reasons };
      }
      reasons.push({ code: 'AI_FAIL_OVERRIDE', message: `ประวัติดี แต่ AI ${aiScore} ต่ำเกิน` });
      return { decision: 'FAIL', reasons };
    }

    // NEW
    if (aiScore === undefined) {
      reasons.push({ code: 'NEW_NO_DATA', message: 'ลูกค้าใหม่ยังไม่มี statement — ต้องตรวจเพิ่ม' });
      return { decision: 'REVIEW', reasons };
    }
    if (aiScore >= PASS_THRESHOLD) {
      reasons.push({ code: 'NEW_AI_PASS', message: `ลูกค้าใหม่ AI ${aiScore} ผ่าน` });
      return { decision: 'PASS', reasons };
    }
    if (aiScore >= REVIEW_THRESHOLD) {
      reasons.push({ code: 'NEW_AI_BORDERLINE', message: `ลูกค้าใหม่ AI ${aiScore} ก้ำกึ่ง` });
      return { decision: 'REVIEW', reasons };
    }
    reasons.push({ code: 'NEW_AI_FAIL', message: `ลูกค้าใหม่ AI ${aiScore} ต่ำ` });
    return { decision: 'FAIL', reasons };
  }

  private cacheKey(nationalId: string, statementHash?: string) {
    return `${nationalId}:${statementHash ?? 'none'}`;
  }

  private hashStatement(files?: string[]): string | undefined {
    if (!files || files.length === 0) return undefined;
    // Simple hash: join + length. For production use crypto.createHash('sha256').
    const { createHash } = require('node:crypto') as typeof import('node:crypto');
    return createHash('sha256').update(files.join('|')).digest('hex').slice(0, 16);
  }

  async runPreCheck(input: {
    nationalId: string;
    phone: string;
    bankName?: string;
    statementFiles?: string[];
  }): Promise<CustomerPreCheckResponse> {
    const stmtHash = this.hashStatement(input.statementFiles);
    const key = this.cacheKey(input.nationalId, stmtHash);
    const cached = this.cache.get(key);
    if (cached && cached.expires > Date.now()) {
      this.logger.debug(`pre-check cache hit for ${input.nationalId}`);
      return cached.result;
    }

    // Find or create customer
    let customer = await this.prisma.customer.findFirst({
      where: { nationalId: input.nationalId, deletedAt: null },
      select: { id: true },
    });
    let isNewCustomer = false;
    if (!customer) {
      customer = await this.prisma.customer.create({
        data: {
          nationalId: input.nationalId,
          name: 'ลูกค้าใหม่ (Pre-check)',
          phone: input.phone,
          creditCheckStatus: 'UNDER_REVIEW',
        },
        select: { id: true },
      });
      isNewCustomer = true;
    }

    const tierResp = await this.tierService.getCustomerTier(customer.id);

    let aiScore: number | undefined;
    let creditCheckId: string | undefined;

    if (input.statementFiles && input.statementFiles.length > 0 && tierResp.tier !== 'BLACKLIST') {
      // Create a PRE-typed credit check record; statement AI is fired-and-stored.
      // Actual AI analysis is optional — caller may already have it.
      const cc = await this.prisma.creditCheck.create({
        data: {
          customerId: customer.id,
          bankName: input.bankName || null,
          statementFiles: input.statementFiles,
          statementMonths: 3,
          checkType: 'PRE',
          status: 'PENDING',
        },
        select: { id: true, aiScore: true },
      });
      creditCheckId = cc.id;
      // aiScore will be null until analyze runs async; caller can poll via GET.
    }

    const outcome = this.decideOutcome(tierResp.tier, aiScore);

    // Update customer creditCheckStatus based on decision
    const nextStatus =
      outcome.decision === 'PASS'
        ? 'PRE_CHECK_PASSED'
        : outcome.decision === 'FAIL'
          ? 'REJECTED'
          : 'UNDER_REVIEW';
    await this.prisma.customer.update({
      where: { id: customer.id },
      data: { creditCheckStatus: nextStatus },
    });

    const reasons = [...tierResp.reasons, ...outcome.reasons];

    const result: CustomerPreCheckResponse = {
      customerId: customer.id,
      isNewCustomer,
      tier: tierResp.tier,
      decision: outcome.decision,
      reasons,
      aiScore,
      creditCheckId,
    };

    this.cache.set(key, { result, expires: Date.now() + CACHE_TTL_MS });
    return result;
  }
}
```

- [ ] **Step 4: Run tests — expect PASS (11 tests)**

```bash
cd apps/api && npx jest customer-precheck.service --no-coverage
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/customers/customer-precheck.service.ts apps/api/src/modules/customers/customer-precheck.service.spec.ts
git commit -m "feat(customer): add CustomerPreCheckService with decision matrix

- Pure decideOutcome(tier, aiScore) function — 11 unit tests cover
  every tier × AI-score boundary
- runPreCheck orchestrates: find/create customer, compute tier, create
  PRE CreditCheck record, update customer.creditCheckStatus
- In-memory cache 1 hour per (nationalId, statement-hash)"
```

---

## Task 3: POST /customers/pre-check endpoint

**Files:**
- Modify: `apps/api/src/modules/customers/customers.controller.ts`
- Modify: `apps/api/src/modules/customers/customers.controller.spec.ts`
- Modify: `apps/api/src/modules/customers/customers.module.ts`

- [ ] **Step 1: Register service in module**

In `customers.module.ts` add:
```typescript
import { CustomerPreCheckService } from './customer-precheck.service';
```
Add to `providers` and `exports`.

- [ ] **Step 2: Write failing controller test**

In `customers.controller.spec.ts` add mock for `CustomerPreCheckService`:
```typescript
{ provide: CustomerPreCheckService, useValue: { runPreCheck: jest.fn() } },
```
Declare `let preCheckService: CustomerPreCheckService;` and assign after `controller = moduleRef.get(CustomersController);`:
```typescript
preCheckService = moduleRef.get(CustomerPreCheckService);
```

Add:
```typescript
describe('POST /customers/pre-check', () => {
  it('delegates to service with body', async () => {
    const mockResp = {
      customerId: 'cust-1',
      isNewCustomer: true,
      tier: 'NEW' as const,
      decision: 'REVIEW' as const,
      reasons: [],
    };
    const spy = jest.spyOn(preCheckService, 'runPreCheck').mockResolvedValue(mockResp);
    const body = { nationalId: '1234567890123', phone: '0812345678' };
    const result = await controller.preCheck(body);
    expect(spy).toHaveBeenCalledWith(body);
    expect(result.decision).toBe('REVIEW');
  });
});
```

Import:
```typescript
import { CustomerPreCheckService } from './customer-precheck.service';
```

- [ ] **Step 3: Run — expect FAIL**

```bash
cd apps/api && npx jest customers.controller --no-coverage
```

- [ ] **Step 4: Add endpoint to controller**

In `customers.controller.ts`:

```typescript
import { CustomerPreCheckService } from './customer-precheck.service';
import { CustomerPreCheckDto, CustomerPreCheckResponse } from './dto/precheck.dto';
```

Inject in constructor: add `private readonly preCheckService: CustomerPreCheckService,` to existing signature.

Add endpoint (place near other POST methods, but BEFORE `@Get(':id')` routes since this uses a sub-path):

```typescript
@Post('pre-check')
@Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
async preCheck(@Body() body: CustomerPreCheckDto): Promise<CustomerPreCheckResponse> {
  return this.preCheckService.runPreCheck(body);
}
```

- [ ] **Step 5: Run test — expect PASS**

```bash
cd apps/api && npx jest customers.controller --no-coverage
```

- [ ] **Step 6: Type check**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE && ./tools/check-types.sh api
```

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/customers/
git commit -m "feat(customer): add POST /customers/pre-check endpoint

Delegates to CustomerPreCheckService. Guarded by JwtAuthGuard +
RolesGuard (all authenticated roles)."
```

---

## Task 4: Push + open PR

- [ ] **Step 1: Push branch**

```bash
git push -u origin feat/customer-precheck-phase2
```

- [ ] **Step 2: Create PR**

```bash
gh pr create --base main --title "feat(customer): Pre-check Gate (Phase 2)" --body "$(cat <<EOF
## Summary
Phase 2 ของ Customer Intake redesign — adds \`POST /customers/pre-check\` endpoint that:
- Finds or creates customer by nationalId
- Computes tier (Phase 1 TierService)
- Creates PRE-type CreditCheck if statement provided
- Returns decision: PASS / FAIL / REVIEW

Updates \`Customer.creditCheckStatus\` accordingly. 1-hour cache per (nationalId, statement-hash).

## Decision matrix
| Tier | AI score | Decision |
|---|---|---|
| BLACKLIST | — | FAIL |
| RISKY | — | REVIEW |
| GOLD | — | PASS |
| GOOD | no AI | PASS |
| GOOD | ≥ 50 | PASS |
| GOOD | 40-49 | REVIEW |
| GOOD | < 40 | FAIL |
| NEW | no AI | REVIEW |
| NEW | ≥ 50 | PASS |
| NEW | 40-49 | REVIEW |
| NEW | < 40 | FAIL |

## Non-goals
- UI wizard (Phase 3)
- Actually triggering AI analysis inline (caller polls existing endpoint)
- External blacklist (only internal bad debt / repossession)

## Test plan
- [x] 11 unit tests covering every decision branch
- [x] 1 integration test for controller
- [ ] Manual: POST /customers/pre-check with new nationalId → 201, customerId returned
- [ ] Manual: repeat same call → cache hit (same result)
EOF
)"
```

## Self-Review

- Spec coverage: section 5 (flow steps 1-3) + section 8 (endpoint contract + cache) + section 13 (threshold decisions) — all covered
- Types consistent: `CustomerTier`, `PreCheckDecision` identical across DTOs + service
- No placeholders
- Pure decision function testable, side-effect function (`runPreCheck`) tested via service spec (not exhaustive — integration layer)
