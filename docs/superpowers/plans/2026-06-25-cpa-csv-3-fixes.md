# CPA CSV 3-Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align the code with the CPA payment-recording CSV on three points — flat late-fee brackets, bounded overpay auto-routing to advance, and shop-collected early-payoff into account 11-2107 (with a clearing path).

**Architecture:** Three independent backend changes in the `apps/api` NestJS service plus a small `apps/web` UI wiring. D2 consolidates three duplicate late-fee computations onto one bracket function. D1 relaxes one guard in the payment orchestrator. D3 adds a chart account, a routing flag, and a settlement JE.

**Tech Stack:** NestJS + Prisma + PostgreSQL, `Prisma.Decimal` for money, Jest unit/e2e, React + Vite (web). Spec: `docs/superpowers/specs/2026-06-25-cpa-csv-3-fixes-design.md`.

## Global Constraints

- Money is always `Prisma.Decimal` — never `number`/`Float`. Use existing helpers (`d`, `dMul`, `dAdd`, `dSub`, `dRound`, `dGte`) where the file already imports them.
- Late-fee tiers/threshold come from SystemConfig (`late_fee_tier1_amount`=50, `late_fee_tier2_amount`=100, `late_fee_tier2_min_days`=3); `BUSINESS_RULES` holds the fallback defaults.
- The 5% legal cap (`LATE_FEE_CAP_PCT`) and per-day model are **removed** per owner decision 2026-06-25 — record this in a code comment at the bracket function. Reversible via config.
- Thai user-facing strings; English code identifiers.
- Run from repo root `d:/BESTCHOICE APP/BESTCHOICE`. Type-check command: `./tools/check-types.sh all`. Jest: `cd apps/api && npx jest <path>`.
- Branch: `fix/cpa-csv-3-fixes`. Commit after every task.

---

## Phase D2 — Late fee → flat brackets (50/100, no cap, retroactive)

### Task 1: Bracket late-fee function + defaults + util tests

**Files:**
- Modify: `apps/api/src/utils/late-fee.util.ts`
- Modify: `apps/api/src/utils/config.util.ts:199-203`
- Test: `apps/api/src/utils/late-fee.util.spec.ts` (rewrite)

**Interfaces:**
- Produces: `computeBracketLateFee(input: BracketLateFeeInput): Prisma.Decimal` where
  `BracketLateFeeInput = { daysOverdue: number; tier1Amount: Decimal|number|string; tier2Amount: Decimal|number|string; tier2MinDays: number }`.
- Produces: `BUSINESS_RULES.LATE_FEE_TIER1_AMOUNT=50`, `LATE_FEE_TIER2_AMOUNT=100`, `LATE_FEE_TIER2_MIN_DAYS=3`.

- [ ] **Step 1: Rewrite the util test (failing)**

Replace the entire body of `apps/api/src/utils/late-fee.util.spec.ts` with:

```typescript
import { computeBracketLateFee } from './late-fee.util';

const s = (d: { toString(): string }) => d.toString();

describe('computeBracketLateFee — flat brackets (no per-day, no cap)', () => {
  const cfg = { tier1Amount: 50, tier2Amount: 100, tier2MinDays: 3 };

  it('0 days overdue → 0', () => {
    expect(s(computeBracketLateFee({ daysOverdue: 0, ...cfg }))).toBe('0');
  });
  it('1 day → tier1 (50)', () => {
    expect(s(computeBracketLateFee({ daysOverdue: 1, ...cfg }))).toBe('50');
  });
  it('2 days → tier1 (50)', () => {
    expect(s(computeBracketLateFee({ daysOverdue: 2, ...cfg }))).toBe('50');
  });
  it('3 days → tier2 (100)', () => {
    expect(s(computeBracketLateFee({ daysOverdue: 3, ...cfg }))).toBe('100');
  });
  it('100 days → still flat tier2 (100, does not grow)', () => {
    expect(s(computeBracketLateFee({ daysOverdue: 100, ...cfg }))).toBe('100');
  });
  it('floors fractional days (2.9 → 2 → tier1)', () => {
    expect(s(computeBracketLateFee({ daysOverdue: 2.9, ...cfg }))).toBe('50');
  });
  it('negative days → 0', () => {
    expect(s(computeBracketLateFee({ daysOverdue: -5, ...cfg }))).toBe('0');
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd apps/api && npx jest src/utils/late-fee.util.spec.ts`
Expected: FAIL — `computeBracketLateFee is not a function` / import error.

- [ ] **Step 3: Replace the util implementation**

Replace the entire body of `apps/api/src/utils/late-fee.util.ts` with:

```typescript
import { Prisma } from '@prisma/client';

export interface BracketLateFeeInput {
  /** Days past due (floored, clamped to >= 0 internally). */
  daysOverdue: number;
  /** Flat fee for 1..(tier2MinDays-1) days overdue (config `late_fee_tier1_amount`). */
  tier1Amount: Prisma.Decimal | number | string;
  /** Flat fee for >= tier2MinDays days overdue (config `late_fee_tier2_amount`). */
  tier2Amount: Prisma.Decimal | number | string;
  /** Day at which tier2 begins (config `late_fee_tier2_min_days`, default 3). */
  tier2MinDays: number;
}

/**
 * Flat-bracket late fee (CPA CSV / owner decision 2026-06-25):
 *   0 days        → 0
 *   1..(min-1)    → tier1Amount   (e.g. 50฿)
 *   >= min        → tier2Amount   (e.g. 100฿, flat — does NOT accumulate per day)
 *
 * NOTE: The previous per-day model AND the 5% Thai-law per-installment cap
 * (LATE_FEE_CAP_PCT) were intentionally REMOVED by owner decision 2026-06-25.
 * Late fee is now a flat bracket only, config-driven (reversible). CPA to review
 * compliance before production rollout. Single source of truth — the collection
 * path (recordPayment), the overdue cron (raw SQL), and the LIFF chatbot quote
 * MUST all resolve the same brackets so quotes match charges.
 */
export function computeBracketLateFee(input: BracketLateFeeInput): Prisma.Decimal {
  const days = Math.max(0, Math.floor(input.daysOverdue));
  if (days <= 0) return new Prisma.Decimal(0);
  if (days >= input.tier2MinDays) return new Prisma.Decimal(input.tier2Amount.toString());
  return new Prisma.Decimal(input.tier1Amount.toString());
}
```

- [ ] **Step 4: Update BUSINESS_RULES defaults**

In `apps/api/src/utils/config.util.ts`, replace lines 200-202:

```typescript
  LATE_FEE_TIER1_AMOUNT: 50,   // flat fee, 1..(min-1) days overdue (baht)
  LATE_FEE_TIER2_AMOUNT: 100,  // flat fee, >= LATE_FEE_TIER2_MIN_DAYS days overdue (baht)
  LATE_FEE_TIER2_MIN_DAYS: 3,  // day at which tier2 begins
```

(Removes `LATE_FEE_PER_DAY`, `LATE_FEE_CAP`, `LATE_FEE_CAP_PCT`.)

- [ ] **Step 5: Run test, verify pass + typecheck**

Run: `cd apps/api && npx jest src/utils/late-fee.util.spec.ts`
Expected: PASS (7 tests).
Run: `./tools/check-types.sh api`
Expected: errors ONLY in the not-yet-migrated callers (orchestrator, cron, finance-tools) — those are Tasks 2-4. Note them; do not fix yet.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/utils/late-fee.util.ts apps/api/src/utils/late-fee.util.spec.ts apps/api/src/utils/config.util.ts
git commit -m "feat(late-fee): flat-bracket late fee function (50/100, no 5% cap) — D2 task 1"
```

---

### Task 2: recordPayment uses brackets (retroactive set)

**Files:**
- Modify: `apps/api/src/modules/payments/services/payment-receipt-orchestrator.ts:194-210`
- Test: `apps/api/src/modules/payments/payments.service.late-fee.spec.ts`

**Interfaces:**
- Consumes: `computeBracketLateFee` (Task 1), `BUSINESS_RULES.LATE_FEE_TIER1_AMOUNT` etc.

- [ ] **Step 1: Add a failing retroactive test**

Add to `apps/api/src/modules/payments/payments.service.late-fee.spec.ts` (inside the top-level describe; mirror the file's existing setup for `recordPayment`):

```typescript
it('retroactive downgrade: a stored 200฿ fee recomputes DOWN to the 100฿ bracket', async () => {
  // Arrange: an installment 10 days overdue with an inflated stored lateFee=200
  // (legacy linear model). Bracket for >=3 days = 100.
  const { contractId, installmentNo } = await seedOverdueInstallment({
    daysOverdue: 10,
    storedLateFee: 200,
    amountDue: 1515.83,
  });

  // Act: record an on-amount payment.
  await service.recordPayment({
    contractId, installmentNo, amount: 1615.83, paymentMethod: 'CASH', recordedById: adminId,
  });

  // Assert: stored lateFee was set to the bracket (100), NOT left at 200.
  const p = await prisma.payment.findFirst({ where: { contractId, installmentNo } });
  expect(Number(p!.lateFee)).toBe(100);
});
```

(`seedOverdueInstallment` — reuse the file's existing fixture helper; if none, build the contract+payment with `prisma.payment.update({ data: { lateFee: 200, dueDate: <10 days ago> } })`.)

- [ ] **Step 2: Run test, verify it fails**

Run: `cd apps/api && npx jest payments.service.late-fee.spec.ts -t "retroactive downgrade"`
Expected: FAIL — current code keeps 200 (never downgrades).

- [ ] **Step 3: Replace the inline late-fee block**

In `payment-receipt-orchestrator.ts`, replace lines 194-210 with:

```typescript
      // Real-time late fee: flat-bracket model (D2, owner 2026-06-25 — no per-day,
      // no 5% cap). Set = bracket (NOT max(stored, bracket)) so this path agrees
      // with the overdue cron's retroactive downgrade. Skip waived.
      let lateFee = d(payment.lateFee);
      if (!payment.lateFeeWaived && payment.dueDate < new Date()) {
        const daysOverdue = Math.floor((Date.now() - payment.dueDate.getTime()) / (1000 * 60 * 60 * 24));
        const [t1, t2, minDays] = await Promise.all([
          tx.systemConfig.findUnique({ where: { key: 'late_fee_tier1_amount' } }),
          tx.systemConfig.findUnique({ where: { key: 'late_fee_tier2_amount' } }),
          tx.systemConfig.findUnique({ where: { key: 'late_fee_tier2_min_days' } }),
        ]);
        const bracketFee = computeBracketLateFee({
          daysOverdue,
          tier1Amount: t1 ? d(t1.value) : BUSINESS_RULES.LATE_FEE_TIER1_AMOUNT,
          tier2Amount: t2 ? d(t2.value) : BUSINESS_RULES.LATE_FEE_TIER2_AMOUNT,
          tier2MinDays: t2 && minDays ? Number(minDays.value) : BUSINESS_RULES.LATE_FEE_TIER2_MIN_DAYS,
        });
        if (!bracketFee.eq(lateFee)) {
          lateFee = bracketFee;
          await tx.payment.update({ where: { id: payment.id }, data: { lateFee } });
        }
      }
```

Add the import at the top of the file: `import { computeBracketLateFee } from '../../../utils/late-fee.util';` (match the existing relative-path style; `BUSINESS_RULES` is already imported — verify).

- [ ] **Step 4: Run test, verify pass**

Run: `cd apps/api && npx jest payments.service.late-fee.spec.ts`
Expected: PASS (the retroactive test + existing tests that still hold; update any existing assertion that pinned the old per-day/cap numbers to the bracket values).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/payments/services/payment-receipt-orchestrator.ts apps/api/src/modules/payments/payments.service.late-fee.spec.ts
git commit -m "feat(payments): recordPayment uses flat-bracket late fee (retroactive set) — D2 task 2"
```

---

### Task 3: overdue cron SQL → bracket CASE

**Files:**
- Modify: `apps/api/src/modules/overdue/services/overdue-lifecycle-cron.service.ts:42-80`
- Test: `apps/api/src/modules/overdue/overdue.late-fee-escalation.spec.ts`, `apps/api/e2e/overdue-late-fee.e2e-spec.ts`

- [ ] **Step 1: Update the escalation spec (failing)**

In `overdue.late-fee-escalation.spec.ts`, replace the config-resolution assertions with bracket expectations:

```typescript
it('cron sets flat bracket: 2 days → 50, 5 days → 100, and DOWNGRADES a stored 200 → 100', async () => {
  await seedOverdue({ daysOverdue: 2, storedLateFee: 0 });   // → 50
  await seedOverdue({ daysOverdue: 5, storedLateFee: 0 });   // → 100
  const stale = await seedOverdue({ daysOverdue: 5, storedLateFee: 200 }); // → 100 (downgrade)

  await cron.calculateLateFees();

  expect(Number((await getPayment(0)).lateFee)).toBe(50);
  expect(Number((await getPayment(1)).lateFee)).toBe(100);
  expect(Number((await getPayment(stale.id)).lateFee)).toBe(100);
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd apps/api && npx jest overdue.late-fee-escalation.spec.ts`
Expected: FAIL (linear model still active).

- [ ] **Step 3: Replace the cron config + SQL**

In `overdue-lifecycle-cron.service.ts`, replace lines 46-76 with:

```typescript
    const [tier1Cfg, tier2Cfg, minDaysCfg] = await Promise.all([
      this.prisma.systemConfig.findUnique({ where: { key: 'late_fee_tier1_amount' } }),
      this.prisma.systemConfig.findUnique({ where: { key: 'late_fee_tier2_amount' } }),
      this.prisma.systemConfig.findUnique({ where: { key: 'late_fee_tier2_min_days' } }),
    ]);
    const tier1 = tier1Cfg ? Number(tier1Cfg.value) : BUSINESS_RULES.LATE_FEE_TIER1_AMOUNT;
    const tier2 = tier2Cfg ? Number(tier2Cfg.value) : BUSINESS_RULES.LATE_FEE_TIER2_AMOUNT;
    const minDays = minDaysCfg ? Number(minDaysCfg.value) : BUSINESS_RULES.LATE_FEE_TIER2_MIN_DAYS;

    // Flat-bracket late fee (D2): unconditional SET = retroactive (downgrades
    // stale higher fees to the new bracket). Skip waived. No per-day, no 5% cap.
    const result = await this.prisma.$executeRaw`
      UPDATE "payments"
      SET
        "late_fee" = CASE
          WHEN FLOOR(EXTRACT(EPOCH FROM (${now}::timestamp - "due_date")) / 86400)::int >= ${minDays} THEN ${tier2}
          WHEN FLOOR(EXTRACT(EPOCH FROM (${now}::timestamp - "due_date")) / 86400)::int >= 1 THEN ${tier1}
          ELSE 0
        END,
        "status" = 'OVERDUE'
      WHERE "status" IN ('PENDING', 'PARTIALLY_PAID', 'OVERDUE')
        AND "due_date" < ${now}
        AND "late_fee_waived" = false
        AND "contract_id" IN (
          SELECT "id" FROM "contracts"
          WHERE "status" IN ('ACTIVE', 'OVERDUE', 'DEFAULT')
            AND "deleted_at" IS NULL
        )
    `;
```

- [ ] **Step 4: Run tests, verify pass**

Run: `cd apps/api && npx jest overdue.late-fee-escalation.spec.ts && npx jest --config ./test/jest-e2e.json overdue-late-fee` (adjust to the repo's e2e invocation; update the e2e's expected fee numbers to brackets).
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/overdue/services/overdue-lifecycle-cron.service.ts apps/api/src/modules/overdue/overdue.late-fee-escalation.spec.ts apps/api/e2e/overdue-late-fee.e2e-spec.ts
git commit -m "feat(overdue): cron computes flat-bracket late fee + retroactive downgrade — D2 task 3"
```

---

### Task 4: chatbot quote uses brackets + fixes explanation

**Files:**
- Modify: `apps/api/src/modules/chatbot-finance/services/finance-tools.service.ts:55-94, 153-184`
- Test: `apps/api/src/modules/chatbot-finance/services/finance-tools.service.spec.ts`

- [ ] **Step 1: Add a failing "quote == charge" test**

In `finance-tools.service.spec.ts`:

```typescript
it('getCurrentBalance late fee matches the bracket charged (5 days → 100, not per-day)', async () => {
  const res = await service.getCurrentBalance(lineUserId5DaysOverdue);
  expect(res.lateFee).toBe(100);
});
it('calculateFine explanation describes brackets, not per-day×days', async () => {
  const res = await service.calculateFine({ daysOverdue: 5 });
  expect(res.totalFine).toBe(100);
  expect(res.explanation).toContain('100');
  expect(res.explanation).not.toContain('ต่อวัน');
  expect(res.explanation).not.toContain('/วัน');
});
```

- [ ] **Step 2: Run, verify fail**

Run: `cd apps/api && npx jest finance-tools.service.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Migrate both call sites + getLateFeeConfig + explanation**

Replace `getLateFeeConfig` (lines 153-162) with:

```typescript
  private async getLateFeeBracketConfig(): Promise<{ tier1: number; tier2: number; tier2MinDays: number }> {
    const [t1, t2, minDays] = await Promise.all([
      this.prisma.systemConfig.findUnique({ where: { key: 'late_fee_tier1_amount' } }),
      this.prisma.systemConfig.findUnique({ where: { key: 'late_fee_tier2_amount' } }),
      this.prisma.systemConfig.findUnique({ where: { key: 'late_fee_tier2_min_days' } }),
    ]);
    return {
      tier1: t1 ? Number(t1.value) : BUSINESS_RULES.LATE_FEE_TIER1_AMOUNT,
      tier2: t2 ? Number(t2.value) : BUSINESS_RULES.LATE_FEE_TIER2_AMOUNT,
      tier2MinDays: minDays ? Number(minDays.value) : BUSINESS_RULES.LATE_FEE_TIER2_MIN_DAYS,
    };
  }
```

Replace the `getCurrentBalance` late-fee block (lines 69-80) with:

```typescript
    const { tier1, tier2, tier2MinDays } = await this.getLateFeeBracketConfig();
    const lateFee = nextPayment.lateFeeWaived
      ? 0
      : Number(computeBracketLateFee({ daysOverdue, tier1Amount: tier1, tier2Amount: tier2, tier2MinDays }));
```

Replace the `calculateFine` block (lines 173-183) with:

```typescript
    const { tier1, tier2, tier2MinDays } = await this.getLateFeeBracketConfig();
    const totalFine = Number(computeBracketLateFee({ daysOverdue: days, tier1Amount: tier1, tier2Amount: tier2, tier2MinDays }));
    return {
      daysOverdue: days,
      totalFine,
      explanation:
        `ค่าปรับล่าช้าแบบเหมาจ่าย: 1–${tier2MinDays - 1} วัน = ${tier1} บาท, ` +
        `ตั้งแต่ ${tier2MinDays} วันขึ้นไป = ${tier2} บาท` +
        ` — งวดนี้เลย ${days} วัน ≈ ${totalFine} บาท`,
    };
```

Update the import: replace `computeCappedLateFee` with `computeBracketLateFee`; drop the now-unused `LATE_FEE_PER_DAY` import + `ratePerDay` field if the return type forbids extra props (check the tool schema in `tool-input-schemas.ts` / `tool-executor.ts` — remove `ratePerDay`/`ratePerDay` references there too).

- [ ] **Step 4: Run, verify pass + full typecheck**

Run: `cd apps/api && npx jest finance-tools.service.spec.ts`
Expected: PASS.
Run: `./tools/check-types.sh all`
Expected: 0 errors (all late-fee callers migrated).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/chatbot-finance/
git commit -m "feat(chatbot): late-fee quote uses brackets + corrected explanation — D2 task 4"
```

---

## Phase D1 — Overpay >1฿ auto-route to advance, bounded

### Task 5: bounded auto-route in recordPayment

**Files:**
- Modify: `apps/api/src/modules/payments/services/payment-receipt-orchestrator.ts:225-232`
- Test: `apps/api/src/modules/payments/payments.service.advance.spec.ts`

- [ ] **Step 1: Add failing tests**

In `payments.service.advance.spec.ts`:

```typescript
it('overpay within ceiling auto-parks as advance WITHOUT requiring OVERPAY_ADVANCE case', async () => {
  // installmentTotal ≈ 1515.83; default ceiling = 2× = 3031.66; overage 84.17 < ceiling
  const { contractId, installmentNo } = await seedDueInstallment({ amountDue: 1515.83 });
  await service.recordPayment({ contractId, installmentNo, amount: 1600, paymentMethod: 'CASH', recordedById: adminId });
  const c = await prisma.contract.findUnique({ where: { id: contractId } });
  expect(Number(c!.advanceBalance)).toBeCloseTo(84.17, 2);
});

it('overpay ABOVE ceiling still throws without explicit OVERPAY_ADVANCE case (typo guard)', async () => {
  const { contractId, installmentNo } = await seedDueInstallment({ amountDue: 1515.83 });
  // overage = 15150 - 1515.83 = 13634.17 > ceiling 3031.66 → throw
  await expect(
    service.recordPayment({ contractId, installmentNo, amount: 15150, paymentMethod: 'CASH', recordedById: adminId }),
  ).rejects.toThrow(/เกินยอดค้างชำระ/);
});

it('overpay above ceiling WITH explicit OVERPAY_ADVANCE case is allowed', async () => {
  const { contractId, installmentNo } = await seedDueInstallment({ amountDue: 1515.83 });
  await service.recordPayment({ contractId, installmentNo, amount: 15150, paymentMethod: 'CASH', recordedById: adminId, paymentCase: 'OVERPAY_ADVANCE' });
  const c = await prisma.contract.findUnique({ where: { id: contractId } });
  expect(Number(c!.advanceBalance)).toBeCloseTo(13634.17, 2);
});
```

- [ ] **Step 2: Run, verify fail**

Run: `cd apps/api && npx jest payments.service.advance.spec.ts -t "ceiling"`
Expected: FAIL — first test throws today (no case), needs the auto-route.

- [ ] **Step 3: Replace the overage guard**

In `payment-receipt-orchestrator.ts`, replace lines 225-232 with:

```typescript
      if (overage.gt(d('1.00'))) {
        // D1 (owner 2026-06-25): auto-route overpay >1฿ to advance (Cr 21-1103)
        // WITHIN a ceiling = multiplier × installment amountDue. Above the ceiling
        // it's likely a data-entry typo → still require explicit OVERPAY_ADVANCE.
        const multCfg = await tx.systemConfig.findUnique({ where: { key: 'overpay_advance_auto_max_multiplier' } });
        const multiplier = multCfg ? d(multCfg.value) : d(2);
        const autoCeiling = dMul(d(payment.amountDue), multiplier);
        if (overage.gt(autoCeiling) && paymentCase !== 'OVERPAY_ADVANCE') {
          throw new BadRequestException(
            `จำนวนเงินเกินยอดค้างชำระมาก (ยอดค้าง ${remaining.toNumber().toLocaleString()} บาท, ชำระ ${amount.toLocaleString()} บาท) — เกินเพดานอัตโนมัติ กรุณายืนยันด้วย case 'OVERPAY_ADVANCE' หากตั้งใจเก็บเป็นเงินรับล่วงหน้า`,
          );
        }
        advanceCredit = overage;
        this.logger?.log?.(
          `Overpay ${overage.toFixed(2)}฿ auto-routed to advance (contract ${contractId}, inst ${installmentNo})`,
        );
      } else if (
```

(Keep the existing `else if` advance-consume branch immediately after, unchanged. The `recordedAmountPaid`/`isPaidInFull` lines 256-262 reference `paymentCase === 'OVERPAY_ADVANCE'` to set full-clear — extend that condition to also fire when `advanceCredit.gt(0)`: change both to `(paymentCase === 'OVERPAY_ADVANCE' || advanceCredit.gt(0))`.)

- [ ] **Step 4: Run, verify pass**

Run: `cd apps/api && npx jest payments.service.advance.spec.ts`
Expected: PASS (new + existing advance tests).

- [ ] **Step 5: Seed the config default + commit**

Add `overpay_advance_auto_max_multiplier` = `2` to the SystemConfig seed (`apps/api/prisma/seed.ts`, alongside the other `late_fee_*` keys).

```bash
git add apps/api/src/modules/payments/ apps/api/prisma/seed.ts
git commit -m "feat(payments): bounded auto-route of overpay >1฿ to advance — D1 task 5"
```

---

## Phase D3 — Account 11-2107 + shop-collect early payoff + settlement

> **⚠️ DESCOPED 2026-06-25 (owner decision).** Tasks 6-9 below were implemented, then reverted (`git reset` to the last D1/D2 commit; archived in tag `d3-shop-payoff-archived`). Early payoff is FINANCE-direct only — no shop-collect / 11-2107 / remittance. Retained for historical context; **do not implement**. Only Phase D2 (Tasks 1-4) and Phase D1 (Task 5) are part of this branch.

### Task 6: add 11-2107 to FINANCE chart

**Files:**
- Modify: `apps/api/src/modules/journal/__tests__/fixtures/cpa-cases/finance-coa.csv:23` (insert after)
- Test: `apps/api/prisma/seed-coa-finance.spec.ts` (or add if absent)

- [ ] **Step 1: Add a failing seed test**

In `seed-coa-finance.spec.ts` (mirror existing structure; if none, create one seeding into the test DB then asserting):

```typescript
it('seeds 11-2107 ลูกหนี้-หน้าร้าน as a Dr asset, no VAT', async () => {
  await seedFinanceCoa(prisma);
  const acc = await prisma.chartOfAccount.findUnique({ where: { code: '11-2107' } });
  expect(acc).toBeTruthy();
  expect(acc!.name).toBe('ลูกหนี้-หน้าร้าน');
  expect(acc!.normalBalance).toBe('Dr');
  expect(acc!.vatApplicable).toBe('ไม่');
});
```

- [ ] **Step 2: Run, verify fail**

Run: `cd apps/api && npx jest seed-coa-finance.spec.ts`
Expected: FAIL — 11-2107 not found.

- [ ] **Step 3: Insert the CSV row**

In `finance-coa.csv`, insert a new line immediately after the `11-2106,...` row (line 23) and before `11-31XX ...` (line 24), matching the 9-column format + trailing-comma padding of sibling rows:

```
11-2107,ลูกหนี้-หน้าร้าน,สินทรัพย์,Dr,ลูกหนี้,ไม่,หน้าร้านรับชำระปิดยอดแทน FINANCE (รอนำส่ง),ใช้งาน,,,,,,,,,,,,,,,
```

- [ ] **Step 4: Run, verify pass**

Run: `cd apps/api && npx jest seed-coa-finance.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/journal/__tests__/fixtures/cpa-cases/finance-coa.csv apps/api/prisma/seed-coa-finance.spec.ts
git commit -m "feat(coa): add 11-2107 ลูกหนี้-หน้าร้าน to FINANCE chart — D3 task 6"
```

> **Deploy note:** production must run `npm --prefix apps/api run seed:coa` (non-destructive upsert) to create 11-2107.

---

### Task 7: shop-collect routing on early payoff

**Files:**
- Modify: `apps/api/src/modules/contracts/dto/contract.dto.ts:94` (EarlyPayoffDto)
- Modify: `apps/api/src/modules/contracts/contract-payment.service.ts:76, 231-234`
- Modify: `apps/api/src/modules/contracts/contracts.controller.ts:107-120`
- Test: `apps/api/src/modules/contracts/contract-payment.service.early-payoff-exec.spec.ts`

**Interfaces:**
- Produces: `EarlyPayoffDto.collectedByShop?: boolean`; `getEarlyPayoffQuote(id, discountPct?, depositAccountCode?, collectedByShop?)`.

- [ ] **Step 1: Add a failing test**

In `contract-payment.service.early-payoff-exec.spec.ts`:

```typescript
it('collectedByShop=true debits 11-2107 instead of cash', async () => {
  const { contractId } = await seedActiveContractWithUnpaid();
  await service.earlyPayoff(contractId, adminId, { paymentMethod: 'CASH', collectedByShop: true });
  const je = await getLatestJournalEntry(contractId, 'early-payoff');
  const debit = je.lines.find((l) => Number(l.dr) > 0 && l.accountCode.startsWith('11-'));
  expect(debit!.accountCode).toBe('11-2107');
});
```

- [ ] **Step 2: Run, verify fail**

Run: `cd apps/api && npx jest early-payoff-exec.spec.ts -t "collectedByShop"`
Expected: FAIL — debit is 11-1101.

- [ ] **Step 3a: Add the DTO field**

In `contract.dto.ts`, inside `EarlyPayoffDto` (after `depositAccountCode`, ~line 110):

```typescript
  /** หน้าร้านรับเงินปิดยอดแทน FINANCE → Dr 11-2107 ลูกหนี้-หน้าร้าน แทนบัญชีเงินสด */
  @IsOptional()
  @IsBoolean()
  collectedByShop?: boolean;
```

(Ensure `IsBoolean` is imported from `class-validator`.)

- [ ] **Step 3b: Route the deposit account**

In `contract-payment.service.ts`:
- `earlyPayoff` line 233 → `const depositAccountCode = dto.collectedByShop ? '11-2107' : (dto.depositAccountCode ?? '11-1101');`
- line 234 → pass through: `const quote = await this.getEarlyPayoffQuote(id, dto.discountPct, depositAccountCode, dto.collectedByShop);`
- `getEarlyPayoffQuote` signature (line 76) → add param `collectedByShop?: boolean`, and line 157 → `const epDepositCode = collectedByShop ? '11-2107' : (depositAccountCode ?? '11-1101');`

- [ ] **Step 3c: Thread through the quote endpoint**

In `contracts.controller.ts` `getEarlyPayoffQuote` (107-120): add `@Query('collectedByShop') collectedByShop?: string` and pass `collectedByShop === 'true'` as the 4th arg to `this.paymentService.getEarlyPayoffQuote(...)`.

- [ ] **Step 4: Run, verify pass + typecheck**

Run: `cd apps/api && npx jest early-payoff-exec.spec.ts && ./tools/check-types.sh api`
Expected: PASS, 0 errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/contracts/
git commit -m "feat(contracts): collectedByShop routes early-payoff debit to 11-2107 — D3 task 7"
```

---

### Task 8: shop-payoff remittance settlement (clears 11-2107)

**Files:**
- Modify: `apps/api/src/modules/contracts/dto/contract.dto.ts` (add `ShopPayoffRemittanceDto`)
- Modify: `apps/api/src/modules/contracts/contract-payment.service.ts` (add `recordShopPayoffRemittance`)
- Modify: `apps/api/src/modules/contracts/contracts.controller.ts` (add endpoint)
- Test: `apps/api/src/modules/contracts/contract-payment.service.shop-remittance.spec.ts` (new)

**Interfaces:**
- Produces: `recordShopPayoffRemittance(id: string, userId: string, dto: ShopPayoffRemittanceDto)` posting `Dr <cash> / Cr 11-2107`.
- `ShopPayoffRemittanceDto = { amount: number; depositAccountCode?: string; referenceNo: string }`.

- [ ] **Step 1: Failing test**

```typescript
it('records shop remittance Dr cash / Cr 11-2107 (balanced) and is idempotent on referenceNo', async () => {
  const { contractId } = await seedContract();
  await service.recordShopPayoffRemittance(contractId, adminId, { amount: 7594.98, depositAccountCode: '11-1101', referenceNo: 'RMT-1' });
  const je = await getLatestJournalEntry(contractId, 'shop-payoff-remittance');
  expect(Number(je.lines.find((l) => l.accountCode === '11-1101')!.dr)).toBeCloseTo(7594.98, 2);
  expect(Number(je.lines.find((l) => l.accountCode === '11-2107')!.cr)).toBeCloseTo(7594.98, 2);
  // idempotent
  await expect(
    service.recordShopPayoffRemittance(contractId, adminId, { amount: 7594.98, depositAccountCode: '11-1101', referenceNo: 'RMT-1' }),
  ).rejects.toThrow();
});
```

- [ ] **Step 2: Run, verify fail**

Run: `cd apps/api && npx jest shop-remittance.spec.ts`
Expected: FAIL — method undefined.

- [ ] **Step 3a: DTO**

In `contract.dto.ts`:

```typescript
export class ShopPayoffRemittanceDto {
  @IsNumber()
  amount: number;

  @IsOptional()
  @IsString()
  @IsIn([...CASH_ACCOUNT_CODES], { message: 'บัญชีรับเงินไม่ถูกต้อง' })
  depositAccountCode?: string;

  @IsString()
  referenceNo: string;
}
```

- [ ] **Step 3b: Service method**

In `contract-payment.service.ts`, model the JE post on the early-payoff call (lines 357-377):

```typescript
  async recordShopPayoffRemittance(id: string, userId: string, dto: ShopPayoffRemittanceDto) {
    const cash = dto.depositAccountCode ?? '11-1101';
    const amount = d(dto.amount);
    if (amount.lte(0)) throw new BadRequestException('จำนวนเงินนำส่งต้องมากกว่า 0');
    const contract = await this.findOne(id);
    const financeCompanyId = await this.resolveFinanceCompanyId();
    await validatePeriodOpen(this.prisma, new Date(), financeCompanyId);
    return this.prisma.$transaction(async (tx) => {
      await this.journalAutoService.createAndPost(
        {
          description: `หน้าร้านนำส่งเงินปิดยอด — สัญญา ${contract.contractNumber}`,
          reference: `${id}:shop-payoff-remittance:${dto.referenceNo}`,
          metadata: { flow: 'shop-payoff-remittance', contractId: id, referenceNo: dto.referenceNo },
          lines: [
            { accountCode: cash, dr: amount, cr: d(0), description: 'รับเงินหน้าร้านนำส่งปิดยอด' },
            { accountCode: '11-2107', dr: d(0), cr: amount, description: 'ล้างลูกหนี้-หน้าร้าน' },
          ],
        },
        tx,
      );
      await tx.auditLog.create({
        data: {
          action: 'SHOP_PAYOFF_REMITTANCE', entity: 'contract', entityId: id, userId,
          newValue: { amount: amount.toFixed(2), cash, referenceNo: dto.referenceNo },
        },
      });
      return { ok: true };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
```

(Idempotency: the unique `reference` on a posted JE makes the second identical `referenceNo` throw. Verify `createAndPost` enforces reference/idempotency uniqueness; if it relies on `metadata.idempotencyKey`, add `idempotencyKey: \`${id}:shop-payoff-remittance:${dto.referenceNo}\`` to metadata.)

- [ ] **Step 3c: Endpoint**

In `contracts.controller.ts`:

```typescript
  @Post(':id/shop-payoff-remittance')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  async shopPayoffRemittance(
    @Param('id') id: string,
    @Body() dto: ShopPayoffRemittanceDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.paymentService.recordShopPayoffRemittance(id, user.id, dto);
  }
```

- [ ] **Step 4: Run, verify pass + typecheck**

Run: `cd apps/api && npx jest shop-remittance.spec.ts && ./tools/check-types.sh api`
Expected: PASS, 0 errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/contracts/
git commit -m "feat(contracts): shop-payoff remittance settlement clears 11-2107 — D3 task 8"
```

---

### Task 9: Frontend — early-payoff checkbox + remittance action

**Files:**
- Modify: the early-payoff dialog (locate via `grep -rl "early-payoff-quote\|earlyPayoff\|ปิดยอด" apps/web/src`)
- Modify: `apps/web/src/lib/api.ts` consumers / the contract detail page for the remittance action

- [ ] **Step 1: Locate the components**

Run: `grep -rln "early-payoff-quote" apps/web/src && grep -rln "ปิดยอดก่อนกำหนด\|earlyPayoff" apps/web/src`
Identify the early-payoff dialog component and the contract detail page.

- [ ] **Step 2: Add the checkbox**

In the early-payoff dialog, add a controlled checkbox (shadcn `Checkbox`) "หน้าร้านรับเงินแทน (Dr 11-2107)" bound to `collectedByShop` state. Include it in the quote request (`?collectedByShop=true`) and the `POST /contracts/:id/early-payoff` body (`collectedByShop`). When checked, disable/hide the cash-account dropdown (debit is forced to 11-2107).

- [ ] **Step 3: Add the remittance action**

On the contract detail page, add a "หน้าร้านนำส่งเงินปิดยอด" action (button → dialog) posting `POST /contracts/:id/shop-payoff-remittance` with `{ amount, depositAccountCode, referenceNo }`, then `queryClient.invalidateQueries` for the contract. Gate visibility to OWNER/FINANCE_MANAGER/ACCOUNTANT.

- [ ] **Step 4: Verify**

Run: `./tools/check-types.sh web` and a manual click-through (or extend an existing early-payoff e2e if present).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): early-payoff shop-collect checkbox + remittance action — D3 task 9"
```

---

## Final verification (after all tasks)

- [ ] `./tools/check-types.sh all` → 0 errors
- [ ] `cd apps/api && npx jest src/utils/late-fee.util.spec.ts payments.service.late-fee.spec.ts payments.service.advance.spec.ts overdue.late-fee-escalation.spec.ts finance-tools.service.spec.ts early-payoff-exec.spec.ts shop-remittance.spec.ts seed-coa-finance.spec.ts` → all pass
- [ ] Dispatch `code-reviewer` agent on the branch diff; fix Critical/Warning before merge
- [ ] Update `.claude/rules/accounting.md` if late-fee policy / new account / new flow needs documenting
- [ ] Delete the `project_cpa_csv_spec_code_gaps` memory once merged (gaps resolved)

## Self-review notes (spec coverage)

- D1 → Task 5 ✓ | D2a/b/c → Tasks 1-4 ✓ | D3a → Task 6 ✓ | D3b → Task 7 ✓ | D3c → Task 8 ✓ | Frontend → Task 9 ✓
- Risk R1 (5% cap removal) → comment in Task 1 + spec doc ✓
- Risk R3 (3 late-fee paths) → Tasks 2,3,4 each migrate one path; "quote==charge" pinned in Task 4 ✓
