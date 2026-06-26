# RecordPaymentWizard — Phase 1 Implementation Plan (UI/UX + 2-block preview)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `รับชำระค่างวด` modal + its JE preview match the new mockup — form on the left, a live **2-block (2A accrual / 2B receipt)** balanced journal on the right — without changing revenue recognition.

**Architecture:** Backend preview service returns block-tagged lines + per-block subtotals (2A fetched read-only from the posted accrual JE in `2B_ONLY` mode); frontend reshuffles the wizard to the mockup layout, redesigns the credit banner, adds quick-amount tiles, payment-type buttons, a date picker, and a card channel. Money math is untouched in Phase 1 (waiver/52-1105 = Phase 2).

**Tech Stack:** NestJS + Prisma (Decimal) · React 18 + TS + Tailwind (semantic tokens) · TanStack Query · jest (`*.integration.spec.ts` for DB tests).

## Global Constraints

- Money = `Prisma.Decimal`; rounding per `.claude/rules/accounting.md` (grossExclVat/months = ROUND_DOWN, VAT/interest = ROUND_HALF_UP). No account code outside `apps/api/src/modules/journal/__tests__/fixtures/cpa-cases/finance-coa.csv`.
- Frontend: semantic tokens only (no hex / `bg-white` / `text-gray-*`); `useQuery`/`useMutation`; `api.*`; `toast.*`; Thai UI text with `leading-snug`.
- Controller guards unchanged: `@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)` + `@Roles(...)`.
- DB-touching tests named `*.integration.spec.ts` (CI runner = jest).
- Do NOT rewrite existing components/endpoints — extend only.
- Phase 1 does NOT touch `split-receipt.ts` or `payment-receipt.template.ts` (Phase 2).

---

## Task 1: Preview service returns block-tagged lines + per-block subtotals

> **Harness note (corrected during execution):** `*.integration.spec.ts` runs under **vitest** against a live DB and is **jest-ignored** (`package.json` `testPathIgnorePatterns`). No DB was available in the build env, so the block/subtotal math was extracted into a pure `buildPreviewBlocks` util with a **DB-free jest unit test** (real red-green), and the DB-dependent 2A-fetch is covered by the vitest integration spec as an artifact (run by owner/CI). Run: unit → `npx jest payment-preview-blocks.util`; integration → `npx vitest run --no-file-parallelism src/modules/payments/services/payment-journal-preview.block.integration.spec.ts`.

**Files:**
- Create: `apps/api/src/modules/payments/services/payment-preview-blocks.util.ts` (pure helper)
- Create: `apps/api/src/modules/payments/services/payment-preview-blocks.util.spec.ts` (jest unit)
- Modify: `apps/api/src/modules/payments/services/payment-journal-preview.service.ts`
- Create: `apps/api/src/modules/payments/services/payment-journal-preview.block.integration.spec.ts` (vitest)
- Modify (mock stubs): `payments.preview-journal-money.spec.ts`, `payments.service.spec.ts` (add `journalEntry.findFirst`)

**Interfaces:**
- Produces: preview return adds `block: '2A' | '2B'` + `posted: boolean` on each line, and `subtotals?: { '2A'?: {debit:string;credit:string;balanced:boolean}; '2B': {debit:string;credit:string;balanced:boolean} }`. Existing fields (`lines`, `totalDebit`, `totalCredit`, `isBalanced`, `accrualMode`, `dueDate`, `rescheduleFeeDisplay`) preserved.

**Behavior:**
- `2B_ONLY` (accrued — `inst.accrualJournalEntryId != null`): emit the existing 2B lines tagged `block:'2B', posted:false`, **and** fetch the posted accrual JE by `inst.accrualJournalEntryId` (`journalEntry.findFirst({ where:{ entryNumber }, include:{ lines:true }})`) → map its lines to `block:'2A', posted:true`. (Include the advance-consume-on-accrual JE — `reference = \`${inst.id}:advance-consume-on-accrual\`` — if present, also `block:'2A', posted:true`.) Compute `subtotals['2A']` from those fetched lines and `subtotals['2B']` from the live lines.
- `CONSOLIDATED_*`: tag all live lines `block:'2B', posted:false`; `subtotals` has only `'2B'` (single combined block). No 2A fetch (none posted yet).
- `RESCHEDULE`/`PARTIAL` early-return paths: tag their lines `block:'2B', posted:false` + `subtotals['2B']` for shape consistency.

- [ ] **Step 1: Write the failing test**

```ts
// payment-journal-preview.block.integration.spec.ts
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';
import { PaymentJournalPreviewService } from './payment-journal-preview.service';
import { AccountRoleService } from '../../journal/account-role.service';

describe('PaymentJournalPreviewService — block tagging (integration)', () => {
  let prisma: PrismaService;
  let svc: PaymentJournalPreviewService;
  // ... standard module bootstrap with real PrismaService against test DB ...
  // Seed: one ACTIVE contract, installment #5 already accrued (accrualJournalEntryId set
  //   via InstallmentAccrual2ATemplate), amountReceived = full installment.

  it('2B_ONLY: returns a posted 2A block and a live 2B block, each balanced', async () => {
    const res = await svc.previewJournal({
      contractId, installmentNo: 5, amountReceived: 1515.83,
      depositAccountCode: '11-1201', lateFee: 0, case: 'NORMAL',
    });
    const blocks = new Set(res.lines.map((l) => l.block));
    expect(blocks.has('2A')).toBe(true);
    expect(blocks.has('2B')).toBe(true);
    expect(res.lines.filter((l) => l.block === '2A').every((l) => l.posted)).toBe(true);
    expect(res.lines.filter((l) => l.block === '2B').every((l) => !l.posted)).toBe(true);
    expect(res.subtotals?.['2A']?.balanced).toBe(true);
    expect(res.subtotals?.['2B'].balanced).toBe(true);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (`block`/`subtotals` undefined). Run: `cd apps/api && npx jest payment-journal-preview.block -t "2B_ONLY"`

- [ ] **Step 3: Implement.** Add `block`/`posted` to the line type and `subtotals` to the return type. Introduce a `tag` local and a `summarise(lines)` helper:

```ts
type Block = '2A' | '2B';
const summarise = (rows: { debit: string; credit: string }[]) => {
  let dr = new Prisma.Decimal(0), cr = new Prisma.Decimal(0);
  for (const r of rows) { dr = dr.plus(r.debit); cr = cr.plus(r.credit); }
  return { debit: dr.toFixed(2), credit: cr.toFixed(2), balanced: dr.toFixed(2) === cr.toFixed(2) };
};
```

In the Normal/Overpay/Underpay return, tag the existing mapped lines with `block:'2B', posted:false`. When `!isConsolidated` (i.e. `2B_ONLY`), fetch + map the accrual JE:

```ts
let block2A: Array<{ accountCode:string; accountName:string; debit:string; credit:string; description:string; block:Block; posted:boolean }> = [];
if (!isConsolidated && inst.accrualJournalEntryId) {
  const accrualEntries = await this.prisma.journalEntry.findMany({
    where: { OR: [
      { entryNumber: inst.accrualJournalEntryId },
      { reference: `${inst.id}:advance-consume-on-accrual` },
    ] },
    include: { lines: true },
  });
  block2A = accrualEntries.flatMap((e) => e.lines.map((l) => ({
    accountCode: l.accountCode,
    accountName: nameMap.get(l.accountCode) ?? l.accountCode, // extend nameMap fetch to cover these codes
    debit: new Prisma.Decimal(l.debit.toString()).toFixed(2),
    credit: new Prisma.Decimal(l.credit.toString()).toFixed(2),
    description: l.description ?? '',
    block: '2A' as Block, posted: true,
  })));
}
```

Return `lines: [...block2A, ...block2B]`, `subtotals: { ...(block2A.length ? { '2A': summarise(block2A) } : {}), '2B': summarise(block2B) }`. (Ensure the CoA `nameMap` query includes the 2A account codes — add them to `codes` before the `findMany`.)

- [ ] **Step 4: Run test — expect PASS.** Run: `cd apps/api && npx jest payment-journal-preview.block`
- [ ] **Step 5: Run the existing preview suite — expect GREEN.** Run: `cd apps/api && npx jest payment-journal-preview`
- [ ] **Step 6: Commit.** `git add -A && git commit -m "feat(payments): block-tag JE preview lines (2A accrual / 2B receipt) + per-block subtotals"`

---

## Task 2: JePreviewPanel renders two blocks with per-block Dr=Cr

**Files:**
- Modify: `apps/web/src/pages/PaymentsPage/components/RecordPaymentWizard.tsx` (the `JePreview*` types + `JePreviewPanel`)

**Interfaces:**
- Consumes: Task 1's `block`/`posted`/`subtotals`.
- Produces: a 2-block preview UI matching the mockup (header "2A — ถึงกำหนดงวด (ACCRUAL)" with "โพสต์แล้ว" chip + read-only styling; "2B — รับเงิน + อนุโลม"; each block footer "Dr = Cr = {subtotal}").

- [ ] **Step 1: Extend the FE types** — add `block: '2A' | '2B'; posted: boolean` to `JePreviewLine`; add `subtotals?: { '2A'?: { debit:string; credit:string; balanced:boolean }; '2B': { debit:string; credit:string; balanced:boolean } }` to `JePreview`.
- [ ] **Step 2: Refactor `JePreviewPanel`** to group `preview.lines` by `block` and render each group under a labeled header with its own Dr=Cr footer from `subtotals`. Reuse the existing line-row grid. 2A group: muted/`bg-muted/40` + a "โพสต์แล้วโดยระบบ" pill; 2B group: normal. When only `'2B'` exists (consolidated), render a single block labeled "2A+2B (โพสต์รวมตอนนี้)" with a one-line note. Keep the existing overall BALANCED footer. Semantic tokens only.
- [ ] **Step 3: Verify types + visual.** Run: `cd apps/web && npx tsc --noEmit`. Manually open the wizard on an accrued overdue installment → confirm 2A=2,115.00 / 2B reflects cash, each "BALANCED".
- [ ] **Step 4: Commit.** `git add -A && git commit -m "feat(web): render 2A/2B journal preview blocks with per-block balance"`

---

## Task 3: Layout swap to mockup (form LEFT, info+preview RIGHT) + header

**Files:**
- Modify: `apps/web/src/pages/PaymentsPage/components/RecordPaymentWizard.tsx`

- [ ] **Step 1:** In `DialogBody`, change the grid to `grid-cols-[1fr_340px]` and put the **form column first**, the **info+preview column second** (matching the mockup: รายการบัญชี on the right). Keep `ContractInfoPanel` + `JePreviewPanel` stacked in the right column; the รายการบัญชี panel header gets the "TFRS 15 + Accrual VAT" subtitle + a "BALANCED/UNBALANCED" pill driven by `preview.isBalanced`.
- [ ] **Step 2:** Verify. Run: `cd apps/web && npx tsc --noEmit`; visually confirm the two columns are swapped and nothing overflows on one screen.
- [ ] **Step 3: Commit.** `git add -A && git commit -m "feat(web): swap wizard to mockup layout (form left, journal right)"`

---

## Task 4: Credit banner redesign + `consumeAdvance` toggle

**Files:**
- Modify: `apps/web/src/pages/PaymentsPage/components/AdvanceBalanceBanner.tsx`
- Modify: `apps/web/src/pages/PaymentsPage/components/RecordPaymentWizard.tsx`
- Modify: `apps/web/src/pages/PaymentsPage/index.tsx` (payload)
- Modify: `apps/api/src/modules/payments/dto/payment.dto.ts` (`RecordPaymentDto.consumeAdvance?: boolean`)
- Modify: `apps/api/src/modules/payments/payments.controller.ts` (pass through) + `services/payment-receipt-orchestrator.ts` (gate the auto-consume)
- Test: `apps/api/src/modules/payments/services/payment-receipt-orchestrator.consume-flag.integration.spec.ts` (create)

**Interfaces:**
- Produces: `consumeAdvance` (default `true`) on `RecordPaymentDto`; orchestrator only auto-consumes advance when `true`.

- [ ] **Step 1 (backend test, failing):** assert that `recordPayment(..., consumeAdvance=false)` on a contract with `advanceBalance>0` and a net (short) payment throws the PARTIAL guard (i.e. no auto-consume), while `consumeAdvance=true` consumes as today. Run: `cd apps/api && npx jest orchestrator.consume-flag` → FAIL.
- [ ] **Step 2 (backend impl):** add `consumeAdvance = true` param to `recordPayment` (after `paymentCase`), thread from controller (`dto.consumeAdvance ?? true`), and guard the auto-consume branch at `payment-receipt-orchestrator.ts:238` with `&& consumeAdvance`. Run the test → PASS. Run existing payments suite → GREEN.
- [ ] **Step 3 (banner UI):** redesign `AdvanceBalanceBanner` to the mockup: copy "มีเครดิตคงเหลือ {advance}฿ จากชำระงวดก่อนเกิน · พักใน 21-1103 · ระบบจะหักอัตโนมัติ" + a checkbox (`checked` default) bound to a new `consumeAdvance` state in the wizard. When checked, prefill `amountReceived = netDue`; when unchecked, prefill = full `amountDue+lateFee−amountPaid` and pass `consumeAdvance:false`. Keep the existing `onApply` for the explicit "ใช้ยอดนี้" action.
- [ ] **Step 4 (wire payload):** add `consumeAdvance` to the wizard `onSubmit` payload, the `index.tsx` record mutation body, and `RecordPaymentDto`. Verify `detectCase` already returns `NORMAL` for net pay (it does — `:412`); no change needed there.
- [ ] **Step 5:** `cd apps/web && npx tsc --noEmit` + `cd apps/api && npx jest payments`.
- [ ] **Step 6: Commit.** `git add -A && git commit -m "feat(payments): credit-banner toggle + consumeAdvance flag (default on)"`

---

## Task 5: Quick-amount tiles (เต็มงวด / ปิดขึ้น / กำหนดเอง)

**Files:**
- Modify: `apps/web/src/pages/PaymentsPage/components/RecordPaymentWizard.tsx`

- [ ] **Step 1:** Add three tiles above the amount input. **เต็มงวด** = `netDue` (= amountDue+lateFee−amountPaid−(consumeAdvance?advance:0)) — sets `amountReceived` + `amountManuallyEdited=true`. **ปิดขึ้น** = `netDue` rounded UP to whole baht (`Decimal.ceil`), display the rounded value; the ≤1฿ residual rides the existing 52-1104/53-1503 tolerance. **กำหนดเอง** = focus the amount input (free entry). Show each tile's computed value like the mockup.
- [ ] **Step 2:** Edge note — when `consumeAdvance` is on, the preview currently skips ≤1฿ rounding while advance legs are present (`payment-journal-preview.service.ts:283`); surface the round-up residual in the รายการบัญชี only when it actually posts. (No backend change in Phase 1; just don't claim a 53-1503 line that won't post.)
- [ ] **Step 3:** `cd apps/web && npx tsc --noEmit`; verify tiles set the right amounts and the preview stays balanced.
- [ ] **Step 4: Commit.** `git add -A && git commit -m "feat(web): quick-amount tiles (full / round-up / custom)"`

---

## Task 6: Payment-type buttons → existing case enum

**Files:**
- Modify: `apps/web/src/pages/PaymentsPage/components/RecordPaymentWizard.tsx`

- [ ] **Step 1:** Add a "ประเภทการรับชำระ" button row: ปกติ→`NORMAL`, แบ่งชำระ→`PARTIAL`, ล่วงหน้า→`OVERPAY_ADVANCE`, ปิดยอด→`setShowPayoffOverlay(true)` (existing `EarlyPayoffOverlay`), ปรับงวด→`RESCHEDULE` (reveals the existing daysToShift/splitMode inputs — keep them gated to this type), คืนเครื่อง→`navigate('/repossessions')` (link out, not handled here). The selected type overrides the auto-`apiCase` where the user picks one explicitly; default stays auto-detect.
- [ ] **Step 2:** Ensure `previewParams.case` and the submit `case` follow the chosen type. Keep `toApiCase` as the fallback when type = ปกติ/auto.
- [ ] **Step 3:** `cd apps/web && npx tsc --noEmit`; verify each button drives the preview/case correctly and ปิดยอด opens the payoff overlay.
- [ ] **Step 4: Commit.** `git add -A && git commit -m "feat(web): payment-type buttons mapped to case enum"`

---

## Task 7: Backdated paidDate (D4) — full footprint

**Files:**
- Modify: `apps/api/src/modules/payments/dto/payment.dto.ts` (`RecordPaymentDto.paidDate?: string` ISO, `@IsOptional() @IsDateString()`)
- Modify: `apps/api/src/modules/payments/payments.controller.ts` (pass through)
- Modify: `apps/api/src/modules/payments/services/payment-receipt-orchestrator.ts`
- Modify: `apps/web/src/pages/PaymentsPage/components/RecordPaymentWizard.tsx` (date picker) + `index.tsx` (payload)
- Test: `apps/api/src/modules/payments/services/payment-receipt-orchestrator.backdate.integration.spec.ts` (create)

**Interfaces:**
- Produces: `paidDate` (optional ISO date) on `RecordPaymentDto`; orchestrator honors it for period-lock, late-fee days, paidDate/paidAt, and JE postedAt. Default = now. Guard: not in the future.

- [ ] **Step 1 (failing tests):** (a) backdating into a CLOSED period throws (period-lock); (b) a payment backdated N days computes late fee from `paidDate`, not `Date.now()` (assert `payment.lateFee` matches `resolveLateFee(cfg, daysOverdueAsOfPaidDate, amountDue)`); (c) `paidDate`/`paidAt` equal the supplied date. Run: `cd apps/api && npx jest orchestrator.backdate` → FAIL.
- [ ] **Step 2 (impl):** add `paidDate?: Date` param to `recordPayment`; `const effectivePaidDate = paidDate ?? new Date()` with a future-date guard (`if (effectivePaidDate > new Date()) throw new BadRequestException('วันที่รับเงินต้องไม่เป็นอนาคต')`). Replace `new Date()` at:
  - `:112` `validatePeriodOpen(this.prisma, effectivePaidDate, financeId)`
  - `:200` `daysOverdue = floor((effectivePaidDate − dueDate)/86400000)` (clamp ≥0)
  - `:278` `paidDate/paidAt = isPaidInFull ? effectivePaidDate : null`
  - receipt JE: forward `postedAt: effectivePaidDate` (extend `PaymentReceiptTemplate.execute` input with an optional `postedAt` → `createAndPost({ ..., postedAt })`; default keeps current behavior).
- [ ] **Step 3 (FE):** add a "วันที่รับเงิน" `<input type="date">` (default today, `max=today`) to the wizard; include `paidDate` in the submit payload + `index.tsx` mutation body + DTO.
- [ ] **Step 4:** Run: `cd apps/api && npx jest orchestrator.backdate payments` → GREEN; `cd apps/web && npx tsc --noEmit`.
- [ ] **Step 5: Commit.** `git add -A && git commit -m "feat(payments): honor backdated paidDate end-to-end (period-lock, late fee, JE date)"`

---

## Task 8: Card channel (เงินสด / QR-โอน / บัตร) + `CARD` enum

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (add `CARD` to `PaymentMethod` enum)
- Create: `apps/api/prisma/migrations/<ts>_add_card_payment_method/migration.sql` (`ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'CARD';`)
- Modify: `apps/api/src/modules/payments/dto/payment.dto.ts` (`wizardMethod`/`method` `@IsIn` add `'CARD'`)
- Modify: `apps/api/src/modules/payments/payments.controller.ts` (`methodMap.CARD = 'CARD'`)
- Modify: `apps/web/src/pages/PaymentsPage/components/RecordPaymentWizard.tsx` (`WizardMethod` + `METHOD_OPTIONS`)

**Interfaces:**
- Produces: `CARD` is a valid `PaymentMethod`; the บัตร channel persists; money still lands in a selectable bank account (existing `/payment-method-configs` mapping decides which 11-120x codes are valid for `CARD`).

- [ ] **Step 1 (migration):** add `CARD` to the enum in `schema.prisma`; create the additive migration SQL above (idempotent `ADD VALUE IF NOT EXISTS`). Run: `cd apps/api && npx prisma generate`.
- [ ] **Step 2 (backend wiring):** extend the DTO `@IsIn` lists to include `'CARD'`; add `CARD: 'CARD'` to the controller `methodMap`. Reconcile the channel strings: wizard sends `wizardMethod ∈ {CASH,TRANSFER,QR,CARD}`; controller maps → `{CASH,BANK_TRANSFER,QR_EWALLET,CARD}`.
- [ ] **Step 3 (FE):** add `'CARD'` to `WizardMethod` and a 4th `METHOD_OPTIONS` entry `{ id:'CARD', label:'บัตร', icon:<CreditCard/>, desc:'เครื่อง EDC · เงินเข้าบัญชีธนาคาร' }` (icon already imported). The existing method×account filter + `actuallySubmit` mapping must include CARD → `'CARD'`.
- [ ] **Step 4:** Run: `cd apps/api && npx jest payments` + `cd apps/web && npx tsc --noEmit`.
- [ ] **Step 5: Commit.** `git add -A && git commit -m "feat(payments): add CARD channel (EDC) persisting to a bank account"`

---

## Phase 1 close-out (OWNER SIGN-OFF GATE)

- [ ] `./tools/check-types.sh all` = 0 errors.
- [ ] Full backend payments suite green; web type-check green.
- [ ] `code-reviewer` agent on the Phase 1 diff → no Critical.
- [ ] Demo: open the wizard on the mockup contract (overdue, accrued) → 2A block = 2,115.00, 2B block balanced, card channel selectable, backdate respected, credit banner toggle works.
- [ ] Report to owner; **do not start Phase 2** until approved.

## Self-review notes (author)
- Spec coverage: Phase 1 items §3 of the spec all mapped (preview split → T1/T2; layout/state → T3; banner+detectCase → T4; quick tiles → T5; type buttons → T6; backdate → T7; card → T8). Phase 2/3 intentionally excluded.
- `split-receipt.ts` / `payment-receipt.template.ts` untouched (Phase 2). `consumeAdvance` + `paidDate` + `CARD` are additive, default-preserving.
- Known Phase-1 limitation (documented in spec §3.1): `CONSOLIDATED_*` paying-ahead shows a single combined block, not a faked split.
