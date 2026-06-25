# Shop-Collect Early Payoff (11-2107) Implementation Plan (Spec Section #2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow an early payoff to be collected at the SHOP branch — FINANCE books `Dr 11-2107 ลูกหนี้-หน้าร้าน` instead of `Dr cash`, then clears it when the shop remits to FINANCE (`Dr cash / Cr 11-2107`).

**Architecture:** No early-payoff *template* change — `computeEarlyPayoffJE` already debits whatever `depositAccountCode` it is handed. A new `collectedByShop` flag makes the **server** substitute `depositAccountCode = '11-2107'` (the DTO's `@IsIn(CASH_ACCOUNT_CODES)` validator stays intact; the client never names 11-2107). A new settlement endpoint posts the plain `Dr cash / Cr 11-2107` receipt when the shop remits.

**Tech Stack:** NestJS, Prisma, jest (`--runInBand`, the apps/api CI runner) for unit/mocked specs, vitest for DB-integration specs (`*.integration.spec.ts`), React for the frontend toggle.

## Global Constraints

- **CI runner = `jest --runInBand`**: pure/mocked specs use jest auto-globals as `*.spec.ts`; DB-backed specs MUST be `*.integration.spec.ts` (jest-ignored) + vitest, run `--no-file-parallelism`.
- Money is `Prisma.Decimal`. Soft-delete aware. Every new endpoint keeps `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles(...)`.
- Do **NOT** widen `EarlyPayoffDto.depositAccountCode`'s `@IsIn([...CASH_ACCOUNT_CODES])` — server sets `11-2107` from the `collectedByShop` flag.
- The early-payoff JE must remain balanced and identical to the FINANCE-direct case except the Dr account (`11-2107` vs a cash code).
- Spec ref: `docs/superpowers/specs/2026-06-25-payment-recording-doc-code-alignment-design.md` §Section 2.

## Precondition (owner-confirmed scope)
Section #2 reverses the archived D3 drop and is only warranted if the shop physically holds the customer's cash and remits to FINANCE later (a real inter-company receivable). Owner confirmed building all three sections. Merge stays behind CPA sign-off (inter-company receivable reintroduction).

---

## File Structure

- **Modify** `apps/api/src/modules/journal/__tests__/fixtures/cpa-cases/finance-coa.csv` — add the `11-2107` row.
- **Modify** `apps/api/src/modules/contracts/dto/contract.dto.ts` — `EarlyPayoffDto.collectedByShop?: boolean`.
- **Modify** `apps/api/src/modules/contracts/contract-payment.service.ts` — `earlyPayoff` substitutes `11-2107` when `collectedByShop`.
- **Create** `apps/api/src/modules/journal/cpa-templates/shop-collect-settlement.template.ts` — `Dr cash / Cr 11-2107` receipt.
- **Modify** `apps/api/src/modules/contracts/contracts.controller.ts` + `contract-payment.service.ts` — new `POST :id/shop-collect-settlement` endpoint + service method.
- **Modify** `apps/web/src/components/contract/ContractEarlyPayoff.tsx` — `collectedByShop` toggle; a settlement action.

---

### Task 1: Add `11-2107` to the FINANCE chart

**Files:**
- Modify: `apps/api/src/modules/journal/__tests__/fixtures/cpa-cases/finance-coa.csv`
- Test: `apps/api/src/modules/journal/cpa-templates/shop-collect-coa.integration.spec.ts` (vitest)

- [ ] **Step 1: Failing test** — `*.integration.spec.ts`, vitest:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';

const prisma = new PrismaClient();
describe('11-2107 ลูกหนี้-หน้าร้าน seeded into FINANCE chart', () => {
  beforeAll(async () => { await seedFinanceCoa(prisma); });
  afterAll(async () => { await prisma.$disconnect(); });
  it('exists as an active Dr asset account', async () => {
    const acc = await prisma.chartOfAccount.findUnique({ where: { code: '11-2107' } });
    expect(acc).not.toBeNull();
    expect(acc!.normalBalance).toBe('Dr');
  });
});
```
Run: `cd apps/api && npx vitest run --no-file-parallelism src/modules/journal/cpa-templates/shop-collect-coa.integration.spec.ts` → FAIL (account missing).

- [ ] **Step 2: Add the CSV row** — after the `11-2106` line in `finance-coa.csv`, matching the column layout `code,name,type,normalBalance,group,<isReceivable>,<note>,ใช้งาน,,,...`:

```
11-2107,ลูกหนี้-หน้าร้าน,สินทรัพย์,Dr,ลูกหนี้,ใช่,ลูกหนี้หน้าร้านรับปิดยอดแทน FINANCE (shop-collect early payoff) — เคลียร์เมื่อหน้าร้านโอนเข้า FINANCE,ใช้งาน,,,,,,,,,,,,,,,
```
Match the EXACT number of trailing commas of the `11-2106` row (count them in the file). Seeders read the CSV via `loadCoaFromCsv`, so no seeder code change is needed; the loader regex `^S?\d{2}-\d{4}$` accepts `11-2107`.

- [ ] **Step 3: Run, verify PASS** — same vitest command → PASS.

- [ ] **Step 4: Commit**
```bash
git add apps/api/src/modules/journal/__tests__/fixtures/cpa-cases/finance-coa.csv apps/api/src/modules/journal/cpa-templates/shop-collect-coa.integration.spec.ts
git commit -m "feat(coa): add 11-2107 ลูกหนี้-หน้าร้าน for shop-collect early payoff"
```

---

### Task 2: `collectedByShop` → server substitutes 11-2107 in earlyPayoff

**Files:**
- Modify: `apps/api/src/modules/contracts/dto/contract.dto.ts` (EarlyPayoffDto)
- Modify: `apps/api/src/modules/contracts/contract-payment.service.ts:231-347` (earlyPayoff)
- Test: `apps/api/src/modules/contracts/shop-collect-payoff.integration.spec.ts` (vitest)

**Interfaces produced:** `EarlyPayoffDto.collectedByShop?: boolean`; `earlyPayoff` Dr's `11-2107` when set.

- [ ] **Step 1: Failing integration test** (vitest, DB-backed) — activate a contract, call `earlyPayoff` with `collectedByShop: true`, assert the posted early-payoff JE has a `Dr 11-2107` line equal to the settlement and NO cash Dr line. (Mirror the construction in `apps/api/src/modules/accounting/bad-debt.streak-provision.integration.spec.ts` for seeding + activation via `ContractActivation1ATemplate`, and inspect `journalLine` rows by `accountCode='11-2107'`.) `afterAll` cleans `journalLine/journalEntry/payment/installmentSchedule/contract` + `$disconnect`. Run → FAIL.

- [ ] **Step 2: DTO** — add to `EarlyPayoffDto` (keep `depositAccountCode`'s `@IsIn` unchanged):
```ts
  @IsOptional()
  @IsBoolean()
  collectedByShop?: boolean;
```
(Confirm `IsBoolean` is imported from `class-validator` in the file; add to the import if absent.)

- [ ] **Step 3: Service** — in `earlyPayoff`, after resolving `depositAccountCode = dto.depositAccountCode ?? '11-1101'` (`:233`), add the substitution BEFORE the quote/posting:
```ts
    const effectiveDepositCode = dto.collectedByShop ? '11-2107' : depositAccountCode;
```
Use `effectiveDepositCode` for BOTH `getEarlyPayoffQuote(id, dto.discountPct, effectiveDepositCode)` and the inline posting's `depositAccountCode`. (The quote helper + `computeEarlyPayoffJE` already Dr whatever code they get — no template change.) Stamp `metadata.collectedByShop = true` + `metadata.shopReceivable = '11-2107'` on the early-payoff JE for the settlement step to find it. Write an `AuditLog { action: 'SHOP_COLLECT_PAYOFF', entity: 'contract', entityId: id }`.

- [ ] **Step 4: Run, verify PASS** — vitest spec green (Dr 11-2107 = settlement, balanced, no cash line). `cd apps/api && npx tsc --noEmit` → 0 errors.

- [ ] **Step 5: Regression** — `cd apps/api && npx jest --runInBand src/modules/contracts 2>&1 | grep -E "Tests:|^FAIL"` → no NEW failures (FINANCE-direct payoff path unchanged when `collectedByShop` is falsy).

- [ ] **Step 6: Commit**
```bash
git add apps/api/src/modules/contracts/dto/contract.dto.ts apps/api/src/modules/contracts/contract-payment.service.ts apps/api/src/modules/contracts/shop-collect-payoff.integration.spec.ts
git commit -m "feat(payoff): collectedByShop routes early-payoff Dr to 11-2107 (server-side, validator intact)"
```

---

### Task 3: Shop→FINANCE settlement (clear 11-2107)

**Files:**
- Create: `apps/api/src/modules/journal/cpa-templates/shop-collect-settlement.template.ts`
- Modify: `apps/api/src/modules/contracts/contract-payment.service.ts` (settlement method)
- Modify: `apps/api/src/modules/contracts/contracts.controller.ts` (endpoint)
- Modify: `apps/api/src/modules/contracts/dto/contract.dto.ts` (ShopCollectSettlementDto)
- Test: `apps/api/src/modules/contracts/shop-collect-settlement.integration.spec.ts` (vitest)

**Interfaces produced:** `POST /contracts/:id/shop-collect-settlement` body `{ depositAccountCode, amount }` → posts `Dr depositAccountCode / Cr 11-2107`.

- [ ] **Step 1: Failing integration test** — after a `collectedByShop` payoff (Task 2 flow) leaves a `Dr 11-2107` balance, call the settlement service with `{ depositAccountCode: '11-1201', amount: <settlement> }`; assert a balanced `Dr 11-1201 / Cr 11-2107` JE posts and the contract's net 11-2107 (ΣDr − ΣCr from JEs tagged `metadata.contractId=id`) returns to 0. `afterAll` cleanup + `$disconnect`. Run → FAIL.

- [ ] **Step 2: Template** — `ShopCollectSettlementTemplate.execute({ contractId, depositAccountCode, amount, postedById })`:
  - Validate `depositAccountCode` ∈ CASH_ACCOUNT_CODES (bank/cash).
  - Compute the outstanding 11-2107 for the contract = Σ(Dr 11-2107) − Σ(Cr 11-2107) over posted `journalLine`s whose entry `metadata.contractId === contractId`. Reject (`BadRequestException`) if `amount > outstanding + 0.01` or `outstanding <= 0`.
  - Post `Dr depositAccountCode [amount] / Cr 11-2107 [amount]` via `JournalAutoService.createAndPost`, `metadata: { flow: 'shop-collect-settlement', contractId }`, idempotency on `flow + contractId + amount` partial-unique (mirror the existing idempotency pattern).
  - FINANCE company (default — both lines are FINANCE accounts).

- [ ] **Step 3: Service + DTO + endpoint** — `ShopCollectSettlementDto { @IsIn(CASH_ACCOUNT_CODES) depositAccountCode; @IsPositive amount }`. Service `shopCollectSettlement(id, userId, dto)` wraps the template in a tx + `AuditLog { action: 'SHOP_COLLECT_SETTLED' }`. Controller: `@Post(':id/shop-collect-settlement') @Roles('OWNER','FINANCE_MANAGER','ACCOUNTANT')`.

- [ ] **Step 4: Run, verify PASS** — vitest green (Cr 11-2107 zeroes the balance). `tsc --noEmit` → 0.

- [ ] **Step 5: Regression** — `npx jest --runInBand src/modules/contracts 2>&1 | grep -E "Tests:|^FAIL"` → no NEW failures.

- [ ] **Step 6: Commit**
```bash
git add apps/api/src/modules/journal/cpa-templates/shop-collect-settlement.template.ts apps/api/src/modules/contracts/contract-payment.service.ts apps/api/src/modules/contracts/contracts.controller.ts apps/api/src/modules/contracts/dto/contract.dto.ts apps/api/src/modules/contracts/shop-collect-settlement.integration.spec.ts
git commit -m "feat(payoff): shop-collect settlement endpoint (Dr cash / Cr 11-2107)"
```

---

### Task 4: Frontend — toggle + settlement action

**Files:**
- Modify: `apps/web/src/components/contract/ContractEarlyPayoff.tsx`
- (Optional) a small settlement dialog/button on the contract detail page.

- [ ] **Step 1: Add the toggle** — `const [collectedByShop, setCollectedByShop] = useState(false);` + a checkbox "เก็บที่หน้าร้าน (หน้าร้านรับเงินแล้วโอนเข้า FINANCE ภายหลัง)" using existing UI tokens (shadcn `Checkbox`/`Switch`, no hardcoded colors). When checked, disable the `CashAccountSelect` (the deposit account is forced to 11-2107 server-side) and show a hint. Include `collectedByShop` in the `api.post('/contracts/:id/early-payoff', { discountPct, depositAccountCode, collectedByShop })` body.
- [ ] **Step 2: Settlement action** — a button "บันทึกรับโอนจากหน้าร้าน" (visible to OWNER/FM/ACC) opening a dialog that posts `/contracts/:id/shop-collect-settlement` with a `CashAccountSelect` + amount; on success `queryClient.invalidateQueries`. Use `toast.success`/`toast.error`.
- [ ] **Step 3: Verify** — `cd apps/web && npx tsc --noEmit` → 0 errors; if there is a component test harness for this file, extend it (web uses vitest — `apps/web/vitest.config.ts`). Otherwise manual-smoke note in the report.
- [ ] **Step 4: Commit**
```bash
git add apps/web/src/components/contract/ContractEarlyPayoff.tsx
git commit -m "feat(web): shop-collect toggle + remittance-settlement action on early payoff"
```

---

## Gate
**CPA sign-off** (inter-company receivable reintroduction) before production merge. The feature is inert unless a user ticks `collectedByShop`, so it can merge to main and stay unused until sign-off.

## Self-Review
- 11-2107 only reachable via the server-side flag, never client-named → validator unchanged (Task 2) ✓
- Early-payoff JE identical except the Dr account → no template change, `computeEarlyPayoffJE` Dr's `depositAccountCode` ✓
- Clearing is `Dr cash / Cr 11-2107` (a receipt, NOT vendor-clearance) with balance validation → Task 3 ✓
- jest (mocked/contracts) vs vitest (`*.integration.spec.ts`, DB) split respects the CI runner ✓
- Guards/roles on both new endpoints ✓
- No placeholders; type names consistent (`collectedByShop`, `ShopCollectSettlementTemplate`, `ShopCollectSettlementDto`, `shopCollectSettlement`).
