# Per-Day Late Fee + 5% Cap Implementation Plan (Spec Section #3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat-bracket late fee with the document's per-day model — `min(daysOverdue × ratePerDay, maxAmount, capPct% × installmentGross)` — config-switchable back to bracket, with all four call sites resolving identically.

**Architecture:** Add `computePerDayLateFee` + a `resolveLateFee(cfg, days, installmentGross)` dispatcher + a `loadLateFeeConfig(prisma)` reader to the existing `late-fee.util.ts`. Three TS call sites (recordPayment, two chatbot quotes) call `resolveLateFee`; the overdue cron's bulk raw-SQL `UPDATE` reproduces the same `LEAST(...)` math, guarded by an anti-drift test that asserts SQL output == util output to the satang.

**Tech Stack:** NestJS, Prisma (PostgreSQL), jest (`--runInBand`, the apps/api CI runner) for pure-unit specs, vitest for DB-integration specs.

## Global Constraints

- **CI runner is `jest --runInBand`** (apps/api/package.json + .github/workflows/deploy-gcp.yml). Pure-unit specs use **jest auto-globals** (NO `import from 'vitest'`) and live as `*.spec.ts` (e.g. the existing `late-fee.util.spec.ts`). DB-backed specs MUST be named `*.integration.spec.ts` (jest `testPathIgnorePatterns` ignores them) and use vitest + a real Postgres; run them with `npx vitest run --no-file-parallelism <file>`.
- Money is `Prisma.Decimal` — `computePerDayLateFee` returns `Prisma.Decimal`; never `Number()` a money sum.
- **Quote == charge:** all four sites must resolve the identical late fee for the same `(daysOverdue, installmentGross, config)`. The cron's raw SQL is the highest-risk seam.
- 5% base = `installmentGross` = the payment's `amountDue` (monthly installment incl VAT).
- Formula (D2): `lateFee = min(daysOverdue × ratePerDay, maxAmount, capPct/100 × installmentGross)`; 0 when `daysOverdue < 1`.
- `late_fee_mode = BRACKET` must reproduce today's exact behaviour (rollback safety); default `PER_DAY`.
- Worked example: `5% × 1,515.83 = 75.79` — the cap, so the canonical late fee is **75.79** (not 100); CI golden asserts this.
- Spec ref: `docs/superpowers/specs/2026-06-25-payment-recording-doc-code-alignment-design.md` §Section 3.

---

## File Structure

- **Modify** `apps/api/src/utils/late-fee.util.ts` — add `computePerDayLateFee`, `LateFeeConfig`, `loadLateFeeConfig`, `resolveLateFee`. Keep `computeBracketLateFee` (BRACKET mode reuses it).
- **Modify** `apps/api/src/utils/config.util.ts` — add `LATE_FEE_MODE`, `LATE_FEE_PER_DAY_RATE`, `LATE_FEE_MAX_AMOUNT`, `LATE_FEE_CAP_PCT` to `BUSINESS_RULES`.
- **Modify** `apps/api/src/utils/late-fee.util.spec.ts` — jest unit tests for `computePerDayLateFee` + `resolveLateFee`.
- **Modify** `apps/api/src/modules/payments/services/payment-receipt-orchestrator.ts` — recordPayment late-fee block calls `resolveLateFee`.
- **Modify** `apps/api/src/modules/chatbot-finance/services/finance-tools.service.ts` + `auto-trigger.service.ts` — quote via `resolveLateFee`.
- **Modify** `apps/api/src/modules/overdue/services/overdue-lifecycle-cron.service.ts` — `calculateLateFees` raw SQL branches on mode (`LEAST(...)` for PER_DAY).
- **Create** `apps/api/src/modules/overdue/services/late-fee-perday-sql.integration.spec.ts` — vitest anti-drift (SQL == util).

---

### Task 1: `computePerDayLateFee` + config loader + dispatcher

**Files:**
- Modify: `apps/api/src/utils/config.util.ts:200-202` (add constants)
- Modify: `apps/api/src/utils/late-fee.util.ts`
- Test: `apps/api/src/utils/late-fee.util.spec.ts`

**Interfaces produced (later tasks consume):**
- `computePerDayLateFee(input: { daysOverdue: number; perDayRate: Decimal|number|string; maxAmount: Decimal|number|string; capPct: Decimal|number|string; installmentGross: Decimal|number|string }): Prisma.Decimal`
- `interface LateFeeConfig { mode: 'BRACKET'|'PER_DAY'; tier1Amount: number; tier2Amount: number; tier2MinDays: number; perDayRate: number; maxAmount: number; capPct: number }`
- `loadLateFeeConfig(prisma: { systemConfig: { findUnique: Function } }): Promise<LateFeeConfig>`
- `resolveLateFee(cfg: LateFeeConfig, daysOverdue: number, installmentGross: Decimal|number|string): Prisma.Decimal`

- [ ] **Step 1: Write the failing jest unit test** (append to `late-fee.util.spec.ts` — jest globals, no vitest import)

```ts
import {
  computePerDayLateFee,
  resolveLateFee,
  type LateFeeConfig,
} from './late-fee.util';

const sd = (d: { toString(): string }) => d.toString();

describe('computePerDayLateFee — min(days×rate, maxAmount, 5%×installment)', () => {
  const base = { perDayRate: 20, maxAmount: 500, capPct: 5 };
  it('0 days → 0', () => {
    expect(sd(computePerDayLateFee({ daysOverdue: 0, installmentGross: 1515.83, ...base }))).toBe('0');
  });
  it('per-day wins when small: 2 days × 20 = 40 (< maxAmount 500, < 5% 75.79)', () => {
    expect(sd(computePerDayLateFee({ daysOverdue: 2, installmentGross: 1515.83, ...base }))).toBe('40');
  });
  it('5% cap binds: 10 days × 20 = 200, but 5% × 1515.83 = 75.79 → 75.79', () => {
    expect(sd(computePerDayLateFee({ daysOverdue: 10, installmentGross: 1515.83, ...base }))).toBe('75.79');
  });
  it('absolute maxAmount binds when below 5%: rate 200/day, 5 days = 1000, maxAmount 500, 5% of 20000 = 1000 → 500', () => {
    expect(sd(computePerDayLateFee({ daysOverdue: 5, installmentGross: 20000, perDayRate: 200, maxAmount: 500, capPct: 5 }))).toBe('500');
  });
});

describe('resolveLateFee — mode dispatch', () => {
  const perDayCfg: LateFeeConfig = { mode: 'PER_DAY', tier1Amount: 50, tier2Amount: 100, tier2MinDays: 3, perDayRate: 20, maxAmount: 500, capPct: 5 };
  const bracketCfg: LateFeeConfig = { ...perDayCfg, mode: 'BRACKET' };
  it('PER_DAY mode → per-day formula (5% cap) ', () => {
    expect(sd(resolveLateFee(perDayCfg, 10, 1515.83))).toBe('75.79');
  });
  it('BRACKET mode → flat bracket (tier2 at >=3 days)', () => {
    expect(sd(resolveLateFee(bracketCfg, 10, 1515.83))).toBe('100');
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

`cd apps/api && npx jest --runInBand src/utils/late-fee.util.spec.ts`
Expected: FAIL — `computePerDayLateFee`/`resolveLateFee` not exported.

- [ ] **Step 3: Add the BUSINESS_RULES constants**

In `config.util.ts`, after the three existing `LATE_FEE_*` lines (`:200-202`), add:

```ts
  LATE_FEE_MODE: 'PER_DAY' as 'PER_DAY' | 'BRACKET', // per-day model (Section #3); 'BRACKET' = rollback
  LATE_FEE_PER_DAY_RATE: 20,   // baht per overdue day (owner to tune via config)
  LATE_FEE_MAX_AMOUNT: 500,    // absolute baht ceiling (owner to tune)
  LATE_FEE_CAP_PCT: 5,         // % of installment gross (Thai-law style cap)
```

- [ ] **Step 4: Implement the functions in `late-fee.util.ts`**

Append to `late-fee.util.ts` (keep `computeBracketLateFee` as-is):

```ts
import { BUSINESS_RULES } from './config.util';

export interface PerDayLateFeeInput {
  daysOverdue: number;
  perDayRate: Prisma.Decimal | number | string;
  maxAmount: Prisma.Decimal | number | string;
  capPct: Prisma.Decimal | number | string;
  /** Monthly installment incl VAT (the 5% base). */
  installmentGross: Prisma.Decimal | number | string;
}

/**
 * Per-day late fee (Section #3 / D2):
 *   0 days        → 0
 *   >= 1 day      → min(days × perDayRate, maxAmount, capPct% × installmentGross)
 * All three caps applied; the binding one wins. ROUND_HALF_UP to 2dp (matches the
 * SQL ROUND used by the overdue cron — see late-fee-perday-sql.integration.spec.ts).
 */
export function computePerDayLateFee(input: PerDayLateFeeInput): Prisma.Decimal {
  const days = Math.max(0, Math.floor(input.daysOverdue));
  if (days < 1) return new Prisma.Decimal(0);
  const byDay = new Prisma.Decimal(input.perDayRate.toString()).mul(days);
  const byMax = new Prisma.Decimal(input.maxAmount.toString());
  const byPct = new Prisma.Decimal(input.capPct.toString())
    .div(100)
    .mul(new Prisma.Decimal(input.installmentGross.toString()))
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  return Prisma.Decimal.min(byDay, byMax, byPct);
}

export interface LateFeeConfig {
  mode: 'BRACKET' | 'PER_DAY';
  tier1Amount: number;
  tier2Amount: number;
  tier2MinDays: number;
  perDayRate: number;
  maxAmount: number;
  capPct: number;
}

/** Read all late-fee config keys once, with BUSINESS_RULES defaults. */
export async function loadLateFeeConfig(prisma: {
  systemConfig: { findUnique: (a: { where: { key: string } }) => Promise<{ value: string } | null> };
}): Promise<LateFeeConfig> {
  const keys = [
    'late_fee_mode', 'late_fee_tier1_amount', 'late_fee_tier2_amount',
    'late_fee_tier2_min_days', 'late_fee_per_day_rate', 'late_fee_max_amount', 'late_fee_cap_pct',
  ];
  const rows = await Promise.all(keys.map((key) => prisma.systemConfig.findUnique({ where: { key } })));
  const [mode, t1, t2, minDays, rate, max, pct] = rows;
  const modeVal = mode?.value === 'BRACKET' || mode?.value === 'PER_DAY' ? mode.value : BUSINESS_RULES.LATE_FEE_MODE;
  return {
    mode: modeVal,
    tier1Amount: t1 ? Number(t1.value) : BUSINESS_RULES.LATE_FEE_TIER1_AMOUNT,
    tier2Amount: t2 ? Number(t2.value) : BUSINESS_RULES.LATE_FEE_TIER2_AMOUNT,
    tier2MinDays: minDays ? Number(minDays.value) : BUSINESS_RULES.LATE_FEE_TIER2_MIN_DAYS,
    perDayRate: rate ? Number(rate.value) : BUSINESS_RULES.LATE_FEE_PER_DAY_RATE,
    maxAmount: max ? Number(max.value) : BUSINESS_RULES.LATE_FEE_MAX_AMOUNT,
    capPct: pct ? Number(pct.value) : BUSINESS_RULES.LATE_FEE_CAP_PCT,
  };
}

/** Dispatch by mode. One definition consumed by every TS call site. */
export function resolveLateFee(
  cfg: LateFeeConfig,
  daysOverdue: number,
  installmentGross: Prisma.Decimal | number | string,
): Prisma.Decimal {
  if (cfg.mode === 'PER_DAY') {
    return computePerDayLateFee({
      daysOverdue,
      perDayRate: cfg.perDayRate,
      maxAmount: cfg.maxAmount,
      capPct: cfg.capPct,
      installmentGross,
    });
  }
  return computeBracketLateFee({
    daysOverdue,
    tier1Amount: cfg.tier1Amount,
    tier2Amount: cfg.tier2Amount,
    tier2MinDays: cfg.tier2MinDays,
  });
}
```
(Confirm `Prisma` is already imported in `late-fee.util.ts` — it is, used by `computeBracketLateFee`.)

- [ ] **Step 5: Run, verify PASS**

`cd apps/api && npx jest --runInBand src/utils/late-fee.util.spec.ts`
Expected: PASS (existing 7 bracket tests + the new per-day/dispatch tests).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/utils/late-fee.util.ts apps/api/src/utils/config.util.ts apps/api/src/utils/late-fee.util.spec.ts
git commit -m "feat(late-fee): per-day model + 5% cap + resolveLateFee dispatcher (config-switchable)"
```

---

### Task 2: Wire the three TS call sites through `resolveLateFee`

**Files:**
- Modify: `apps/api/src/modules/payments/services/payment-receipt-orchestrator.ts:198-216`
- Modify: `apps/api/src/modules/chatbot-finance/services/finance-tools.service.ts:69-72,146-152`
- Modify: `apps/api/src/modules/chatbot-finance/services/auto-trigger.service.ts:172-197`

**Interfaces consumed:** `loadLateFeeConfig`, `resolveLateFee` (Task 1).

- [ ] **Step 1: Write/extend a failing test for the orchestrator path**

Add a vitest **integration** spec `apps/api/src/modules/payments/services/late-fee-resolve.integration.spec.ts` (DB-backed; `*.integration.spec.ts` so jest ignores it):

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient, Prisma } from '@prisma/client';
import { loadLateFeeConfig, resolveLateFee } from '../../../utils/late-fee.util';

const prisma = new PrismaClient();

describe('loadLateFeeConfig + resolveLateFee against the live SystemConfig', () => {
  afterAll(async () => {
    await prisma.systemConfig.deleteMany({ where: { key: { in: ['late_fee_mode', 'late_fee_per_day_rate', 'late_fee_max_amount', 'late_fee_cap_pct'] } } });
    await prisma.$disconnect();
  });

  it('PER_DAY mode with configured values resolves the 5% cap', async () => {
    for (const [key, value] of [['late_fee_mode', 'PER_DAY'], ['late_fee_per_day_rate', '20'], ['late_fee_max_amount', '500'], ['late_fee_cap_pct', '5']] as const) {
      await prisma.systemConfig.upsert({ where: { key }, update: { value }, create: { key, value } });
    }
    const cfg = await loadLateFeeConfig(prisma);
    expect(cfg.mode).toBe('PER_DAY');
    expect(resolveLateFee(cfg, 10, new Prisma.Decimal('1515.83')).toString()).toBe('75.79');
  });
});
```
Run: `cd apps/api && npx vitest run --no-file-parallelism src/modules/payments/services/late-fee-resolve.integration.spec.ts` → expected PASS already (Task 1 shipped the functions); this spec guards the config-read wiring. If `systemConfig` requires more fields on create, add them (check the SystemConfig model).

- [ ] **Step 2: Replace the orchestrator late-fee computation**

In `payment-receipt-orchestrator.ts`, the block at `:200-211` reads the three tier configs and calls `computeBracketLateFee`. Replace the config reads + `computeBracketLateFee(...)` with:

```ts
        const lateFeeCfg = await loadLateFeeConfig(tx);
        const bracketFee = resolveLateFee(lateFeeCfg, daysOverdue, payment.amountDue);
```
(Keep the surrounding `if (!payment.lateFeeWaived && payment.dueDate < new Date())` guard, the `daysOverdue` computation, and the `if (!bracketFee.eq(lateFee)) { lateFee = bracketFee; ... }` update. Replace the `import { computeBracketLateFee }` with `import { loadLateFeeConfig, resolveLateFee }`.)

- [ ] **Step 3: Replace both chatbot quote sites**

`finance-tools.service.ts`: the `getLateFeeBracketConfig`-style reads (`:146-152`) + `computeBracketLateFee(...)` at `:71` → load `loadLateFeeConfig(this.prisma)` once and `resolveLateFee(cfg, daysOverdue, nextPayment.amountDue)`.
`auto-trigger.service.ts`: `getLateFeeBracketConfig()` (`:172-176`) + `computeBracketLateFee(...)` (`:197`) → same swap, using the payment's `amountDue` as `installmentGross`.
Update imports to `{ loadLateFeeConfig, resolveLateFee }`.

- [ ] **Step 4: Type-check + run the orchestrator/chatbot jest specs**

`cd apps/api && npx tsc --noEmit` → 0 errors.
`cd apps/api && npx jest --runInBand src/modules/payments src/modules/chatbot-finance 2>&1 | grep -E "Tests:|^FAIL"` → no NEW failures vs the pre-existing baseline (the 3 pre-existing payment specs noted in the §1 work stay red; nothing else regresses). If a chatbot spec asserted the old bracket fee for an overdue case, update its expectation to the per-day value (note it in the report).

- [ ] **Step 5: Run the anti-drift integration + commit**

`cd apps/api && npx vitest run --no-file-parallelism src/modules/payments/services/late-fee-resolve.integration.spec.ts` → PASS.
```bash
git add apps/api/src/modules/payments/services/payment-receipt-orchestrator.ts apps/api/src/modules/chatbot-finance/services/finance-tools.service.ts apps/api/src/modules/chatbot-finance/services/auto-trigger.service.ts apps/api/src/modules/payments/services/late-fee-resolve.integration.spec.ts
git commit -m "feat(late-fee): route recordPayment + chatbot quotes through resolveLateFee"
```

---

### Task 3: Per-day SQL in the overdue cron + anti-drift exit criterion

**Files:**
- Modify: `apps/api/src/modules/overdue/services/overdue-lifecycle-cron.service.ts:46-82` (`calculateLateFees`)
- Test: `apps/api/src/modules/overdue/services/late-fee-perday-sql.integration.spec.ts` (new, vitest)

**Interfaces consumed:** `loadLateFeeConfig`, `computePerDayLateFee` (Task 1).

- [ ] **Step 1: Write the failing anti-drift integration test**

Create `late-fee-perday-sql.integration.spec.ts` (vitest, `*.integration.spec.ts`):

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient, Prisma } from '@prisma/client';
import { seedStandard17k12m } from '../../journal/__tests__/scenario-helpers';
import { OverdueLifecycleCronService } from './overdue-lifecycle-cron.service';
import { ConsecutiveMissedService } from '../consecutive-missed.service';
import { computePerDayLateFee, loadLateFeeConfig } from '../../../utils/late-fee.util';

const prisma = new PrismaClient();

describe('calculateLateFees PER_DAY SQL == computePerDayLateFee (anti-drift)', () => {
  let contractId: string;
  const now = Date.now();
  const cases = [ { n: 1, days: 2 }, { n: 2, days: 10 }, { n: 3, days: 40 } ]; // varied bands

  beforeAll(async () => {
    await prisma.payment.deleteMany({});
    await prisma.installmentSchedule.deleteMany({});
    await prisma.contract.deleteMany({});
    for (const [key, value] of [['late_fee_mode', 'PER_DAY'], ['late_fee_per_day_rate', '20'], ['late_fee_max_amount', '500'], ['late_fee_cap_pct', '5']] as const) {
      await prisma.systemConfig.upsert({ where: { key }, update: { value }, create: { key, value } });
    }
    const c = await seedStandard17k12m(prisma);
    contractId = c.id;
    await prisma.contract.update({ where: { id: contractId }, data: { status: 'ACTIVE' } });
    for (const { n, days } of cases) {
      await prisma.payment.create({ data: { contractId, installmentNo: n, amountDue: '1515.83', dueDate: new Date(now - days * 86_400_000), status: 'PENDING' } as any });
    }
  });
  afterAll(async () => {
    await prisma.payment.deleteMany({});
    await prisma.installmentSchedule.deleteMany({});
    await prisma.contract.deleteMany({});
    await prisma.systemConfig.deleteMany({ where: { key: { in: ['late_fee_mode', 'late_fee_per_day_rate', 'late_fee_max_amount', 'late_fee_cap_pct'] } } });
    await prisma.$disconnect();
  });

  it('every row gets the util value', async () => {
    const svc = new OverdueLifecycleCronService(prisma as any, new ConsecutiveMissedService(prisma as any));
    await svc.calculateLateFees();
    const cfg = await loadLateFeeConfig(prisma);
    for (const { n, days } of cases) {
      const p = await prisma.payment.findFirst({ where: { contractId, installmentNo: n } });
      const expected = computePerDayLateFee({ daysOverdue: days, perDayRate: cfg.perDayRate, maxAmount: cfg.maxAmount, capPct: cfg.capPct, installmentGross: '1515.83' });
      expect(new Prisma.Decimal(p!.lateFee.toString()).toString()).toBe(expected.toString());
    }
  });
});
```
Run: `cd apps/api && npx vitest run --no-file-parallelism src/modules/overdue/services/late-fee-perday-sql.integration.spec.ts` → FAIL (cron still posts flat bracket).

- [ ] **Step 2: Branch the cron SQL on mode**

In `calculateLateFees`, replace the config read (`:50-57`) + the `$executeRaw` (`:61-78`) with a mode-aware version. Load config via `loadLateFeeConfig(this.prisma)`. Keep the BRACKET branch byte-identical to today's CASE. Add the PER_DAY branch:

```ts
    const cfg = await loadLateFeeConfig(this.prisma);
    const daysExpr = Prisma.sql`FLOOR(EXTRACT(EPOCH FROM (${now}::timestamp - "due_date")) / 86400)::int`;
    const feeExpr =
      cfg.mode === 'PER_DAY'
        ? Prisma.sql`CASE WHEN ${daysExpr} >= 1 THEN LEAST(
              ${daysExpr} * ${cfg.perDayRate}::numeric,
              ${cfg.maxAmount}::numeric,
              ROUND(${cfg.capPct}::numeric / 100 * "amount_due", 2)
            ) ELSE 0 END`
        : Prisma.sql`CASE
              WHEN ${daysExpr} >= ${cfg.tier2MinDays} THEN ${cfg.tier2Amount}
              WHEN ${daysExpr} >= 1 THEN ${cfg.tier1Amount}
              ELSE 0 END`;
    const result = await this.prisma.$executeRaw(Prisma.sql`
      UPDATE "payments" SET "late_fee" = ${feeExpr}, "status" = 'OVERDUE'
      WHERE "status" IN ('PENDING', 'PARTIALLY_PAID', 'OVERDUE')
        AND "due_date" < ${now} AND "late_fee_waived" = false
        AND "contract_id" IN (SELECT "id" FROM "contracts" WHERE "status" IN ('ACTIVE','OVERDUE','DEFAULT') AND "deleted_at" IS NULL)`);
```
Confirm `Prisma` is imported in this file (it is — `Prisma, DunningStage`). The `LEAST` + `ROUND(...,2)` mirrors `computePerDayLateFee`'s `Decimal.min` + `ROUND_HALF_UP` — Postgres `ROUND(numeric, 2)` is half-away-from-zero, matching ROUND_HALF_UP for non-negative values (all late fees are ≥0).

- [ ] **Step 3: Run the anti-drift test, verify PASS**

`cd apps/api && npx vitest run --no-file-parallelism src/modules/overdue/services/late-fee-perday-sql.integration.spec.ts` → PASS (SQL == util for 2/10/40-day rows).

- [ ] **Step 4: Regression — BRACKET mode still matches the old behaviour + jest overdue suite**

Add a second `it` (or a sibling spec) setting `late_fee_mode='BRACKET'` and asserting a 10-day row gets `100` (tier2). Then:
`cd apps/api && npx jest --runInBand src/modules/overdue 2>&1 | grep -E "Tests:|^FAIL"` → no NEW failures.
`cd apps/api && npx tsc --noEmit` → 0 errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/overdue/services/overdue-lifecycle-cron.service.ts apps/api/src/modules/overdue/services/late-fee-perday-sql.integration.spec.ts
git commit -m "feat(late-fee): per-day LEAST() SQL in overdue cron + anti-drift test (SQL==util)"
```

---

### Task 4: Config defaults seed + docs (no CPA-gated merge)

**Files:**
- Modify: the SystemConfig seed (locate via `grep -rl "late_fee_tier1_amount" apps/api/prisma`) — add the four new keys with the BUSINESS_RULES defaults so a fresh DB has them.
- Modify: `.claude/rules/accounting.md` (VAT/late-fee section — note per-day model + `late_fee_mode` switch).
- Modify: memory `project_vat_latefee_skip.md` / `project_cpa_csv_spec_code_gaps.md` (D2 now per-day, reversing the flat-bracket note).

- [ ] **Step 1: Seed the four keys** — mirror however the existing `late_fee_tier*` keys are seeded; if they are not seeded (config-on-demand only), skip the seed and rely on `BUSINESS_RULES` defaults (note which in the report).
- [ ] **Step 2: Update accounting.md + memory** — one paragraph each; per-day formula + the 75.79 worked example + `late_fee_mode` rollback note.
- [ ] **Step 3: Commit**
```bash
git add -A apps/api/prisma .claude/rules/accounting.md
git commit -m "docs(late-fee): seed per-day config keys + document the per-day model"
```

---

## Gate
**CPA sign-off on the 5% cap before production.** Code may merge to main behind `late_fee_mode`: ship with prod SystemConfig `late_fee_mode=BRACKET` until CPA signs, then flip to `PER_DAY`. The default in code is `PER_DAY` (fresh dev/test); prod overrides via config.

## Self-Review
- Formula in all four sites resolves identically → Tasks 1-3 (util single def; anti-drift SQL==util test) ✓
- jest unit (pure) + vitest integration (DB) split respects the CI runner → every new pure test is jest-global, every DB test is `*.integration.spec.ts` ✓
- BRACKET rollback path preserved + tested → Task 3 Step 4 ✓
- 5% base = amountDue; 75.79 golden → Tasks 1 & 3 ✓
- CPA gate documented → Gate section ✓
- No placeholders; every step has runnable code/commands. Type names consistent: `LateFeeConfig`, `computePerDayLateFee`, `resolveLateFee`, `loadLateFeeConfig` used identically across tasks.
