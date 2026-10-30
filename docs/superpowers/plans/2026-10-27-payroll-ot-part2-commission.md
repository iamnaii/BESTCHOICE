# Payroll D4 — Part 2: Commissions Paid through Payroll + Clawback Deduction

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Approved commissions are pulled into the SHOP payroll automatically and become PAID when it posts; commissions already paid that get clawed back (sale void, credit trade-in return, early-default cron) are deducted from the next payroll, capped at that period's commission; the old per-row/monthly-payout pay paths return 410.

**Architecture:** Extends Part 1's seams: `PayrollSystemRowsService.compute` gains commission PAY items and clawback deductions; the same save writer stores them; the same gate compares them; `PayrollCommissionItem` ties each payment or deduction to one live line (partial unique on live PAY). One helper `clawBackCommissions` is the only writer of clawback state (contract cancellation calls it with unpaid rows only — same result as today).

**Tech Stack:** as Part 1.

**Spec:** `docs/superpowers/specs/2026-10-27-payroll-ot-commission-design.md` (§6, §6ข, D2, D7, §16, §17). **Depends on:** `docs/superpowers/plans/2026-10-27-payroll-ot-part1.md` merged into this branch first (branch `feat/payroll-commission` from Part 1's head). Mockup boards 1 (commission rows), 3 (slip commissions), 4, 6B, 6C.

## Global Constraints

- Everything in Part 1's Global Constraints still applies (worktree/git rules, Decimal, commands, `@Optional()`, structured 409 allow-list, DTO decorators, role codes read from the DB in the tx, UI rules).
- Commission and clawback rows only for `entityScope = 'SHOP'`. Commission role `shop_payroll_commission` → `S51-1101`. A clawback deduction credits the `accountCode` stored on the commission's **posted PAY item** (not the current role).
- Lock order appends `payroll-clawback:${userId}` (users sorted) after the `payroll-attendance:*` locks, in save, submit, approve and post.
- **Contract cancellation keeps its behavior** — owner ruling 2026-09-20: only unpaid commissions are clawed back, `keptPaidIds` stays; it now writes through `clawBackCommissions` with the PENDING/APPROVED rows only (identical result).
- Clawbacks are deducted only for commissions with `paidAt` set **and** a live PAY item in a POSTED payroll. Paid without such an item → warning `CLAWBACK_PAID_OUTSIDE_PAYROLL`. Never paid (e.g. the cron's 50% on an APPROVED row) → nothing, no warning.
- Commission PAY and clawback rows are computed for **every linked SHOP line** regardless of `autoOtEligible`, `IN_OTHER_DOCUMENT` or PIN (those affect attendance rows only).
- Client deductions are always MANUAL; edit mapping, payload, copy-previous and the submit rebuild keep only `source === 'MANUAL'` deductions. A MANUAL deduction on the commission account on a line that gets a `COMMISSION_CLAWBACK` row → 400 `CLAWBACK_DUPLICATE`.
- Void / soft-delete of a PAYROLL throw `Error('PayrollSystemRowsService not wired')` when the gate service is absent (never fail open); `voidDocument` takes `payroll-clawback:${userId}` (sorted, after `post:`) before `releaseOnVoid`'s checks.

### Exact copy (verbatim; Part 1 keys not repeated)

| Key | Thai text |
|---|---|
| `STALE` (replaces Part 1's) | `ยังไม่ได้ลงบัญชี — ข้อมูลลงเวลา/ค่าคอมเปลี่ยนหลังบันทึกใบ ให้ผู้ทำเงินเดือนกด "แก้ไข" แล้วบันทึกใบอีกครั้ง (ระบบคิดยอดใหม่ให้) ตรวจยอด แล้วส่งขออนุมัติอีกครั้ง` |
| `COMMISSION_TAKEN` (code `PAYROLL_COMMISSION_TAKEN`, defensive P2002) | `ค่าคอมบางรายการอยู่ในใบเงินเดือนอื่นแล้ว — บันทึกใบอีกครั้งเพื่อให้ระบบคิดยอดใหม่` |
| `CLAWBACK_DUPLICATE` (code `PAYROLL_CLAWBACK_DUPLICATE`) | `{ชื่อ} มีรายการหักบนบัญชีค่าคอมที่กรอกเองซ้ำกับหักคืนค่าคอมจากระบบ — ลบแถวนั้นออก` |
| `VOID_AFTER_CLAWBACK` (code `PAYROLL_VOID_AFTER_CLAWBACK`) | `กลับรายการใบนี้ไม่ได้ — ค่าคอมที่ใบนี้จ่ายถูกหักคืนแล้วในใบ {เลขที่} ให้กลับรายการใบนั้นก่อน` |
| `VOID_PARTIAL_CLAWBACK` (code `PAYROLL_VOID_PARTIAL_CLAWBACK`) | `กลับรายการใบนี้ไม่ได้ — ค่าคอม {อ้างอิง} ที่ใบนี้จ่ายถูกเรียกคืนบางส่วนแล้ว ถ้าต้องแก้ยอดของคนอื่นในใบนี้ ให้ใส่แถว "รายการปรับปรุงงวดก่อน" (จ่ายเพิ่ม) หรือรายการหัก (หักคืน) ในใบเงินเดือนงวดถัดไป` |
| `PAY_VIA_PAYROLL` (410, code `COMMISSION_PAY_VIA_PAYROLL`) | `จ่ายค่าคอมผ่านใบเงินเดือนเท่านั้น — สร้างใบเงินเดือนที่หน้ารายจ่าย › สร้างเอกสารใหม่ › เงินเดือน (PR) ระบบดึงค่าคอมที่อนุมัติแล้วให้เอง` |
| warning `COMMISSION_FINANCE_BLOCKED` | `ใบฝั่งส่วนกลาง (FINANCE) ยังไม่ดึงค่าคอม — รอฝ่ายบัญชีตอบ` |
| warning `COMMISSION_IN_OTHER_DOCUMENT` | `ค่าคอม {n} รายการของ {ชื่อ} อยู่ในใบ {เลขที่} แล้ว` |
| warning `CLAWBACK_CARRIED` | `หักคืนค่าคอมได้ {x} บาท (ไม่เกินค่าคอมงวดนี้) — ยกไปงวดหน้า {y} บาท` |
| warning `CLAWBACK_PAID_OUTSIDE_PAYROLL` | `ค่าคอม {อ้างอิง} ถูกเรียกคืน แต่จ่ายไปนอกใบเงินเดือน — ระบบไม่หักให้อัตโนมัติ ถ้าจะหัก ให้ใส่รายการหักในใบนี้เอง` |
| row names | `ค่าคอมมิชชัน ({n} รายการ)` · `หักคืนค่าคอม ({n} รายการ)` |

### Decisions (settled here; owner reviews the list)

1. **Clawback double-deduction guard without a unique index** (carry-forward needs several live CLAWBACK items per commission): outstanding = `clawbackAmount − Σ live CLAWBACK items in other documents`, read under `payroll-clawback:${userId}`, re-checked by the gate. No `deductedAt` column.
2. **Cap at the period's commission** (LPA s.76 — commission is wages; deducting from base salary is not one of the permitted deductions): deduct up to Σ this period's PAY items; remainder carried. A salesperson who is on a payroll is netted normally (incl. the final month of a resignee); whatever is still outstanding once `EmployeeProfile.resignedDate ≤ now` is shown on the commissions page as `เรียกคืน — พนักงานลาออก ให้เจ้าของตัดสิน` (no automatic deduction anywhere).
3. **One clawback helper** for sale void, credit-return cleanup, the early-default cron (`applyClawbackForContract`) and contract cancellation (unpaid rows only).
4. **Commissions approved after submit are not stale:** the gate fails only when a stored PAY/CLAWBACK item became unpayable or changed (commission no longer APPROVED, amount changed, clawback outstanding below the item) or attendance rows changed; commissions/clawbacks that appeared after the save are a warning and fall into the next period automatically (`period ≤ payrollPeriod`).
5. **Void refused** when a PAY-item commission is `PARTIALLY_CLAWED_BACK` or already deducted elsewhere.
6. **Sale void note timing:** fixed sentence in the dialog, exact amount in the success toast (the sales list has no commission data).

## Review Focus

1. **Paid → cron 50% → next payroll** deducts 500.00 Cr the PAY item's account. (Task 4.)
2. **Two drafts, one commission** — the second saves without it and shows `COMMISSION_IN_OTHER_DOCUMENT`. (Task 3/4.)
3. **One clawback, two drafts in different periods** — the second deducts 0. (Task 4.)
4. **Void ordering** — after a later deduction → refused; after a partial clawback → refused; plain void → commissions APPROVED and pullable again. (Task 4.)
5. **Commission clawed back between submit and approve** → stale; a **new** commission approved after submit → approve passes and the commission lands in next month's payroll. (Task 4.)

---

### Task 1: Schema for commission items and clawback deductions

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (`PayrollCustomDeduction` 5102-5115, `PayrollLine` relation, `SalesCommission` 5525-5580 back-relation)
- Create: `apps/api/prisma/migrations/20261107000000_payroll_commission/migration.sql`
- Modify: `account-role.service.ts` (`REQUIRED_ROLES`), `role-map-validation.service.ts`, `account-role.service.spec.ts` (`requiredRows`)
- Test: extend `expense-documents/__tests__/payroll-ot-schema.spec.ts`

**Interfaces — Produces:** `PayrollIncomeSource` + `COMMISSION`; `enum PayrollDeductionSource { MANUAL COMMISSION_CLAWBACK }`; `PayrollCustomDeduction.source @default(MANUAL)`; `enum PayrollCommissionItemKind { PAY CLAWBACK }`; model `PayrollCommissionItem { id, payrollLineId (Cascade), salesCommissionId (Restrict), kind, accountCode String, amount Decimal(12,2), releasedAt?, createdAt, updatedAt }` → `payroll_commission_items` (`///`: no `deletedAt`, lifecycle follows the line; partial index is SQL-only — do not accept a diff that drops it); role `shop_payroll_commission`.

- [ ] **Step 1: Failing test** for the enums/fields/role.
- [ ] **Step 2: Run** · Expected: FAIL.
- [ ] **Step 3:** Schema by hand; `migration.sql`: `ALTER TYPE "PayrollIncomeSource" ADD VALUE 'COMMISSION';` (not used in the same migration), `CREATE TYPE` ×2, `ALTER TABLE`, `CREATE TABLE` + FKs + indexes on `sales_commission_id`, `payroll_line_id`; `CREATE UNIQUE INDEX "payroll_commission_items_one_active_pay" ON "payroll_commission_items" ("sales_commission_id") WHERE "kind" = 'PAY' AND "released_at" IS NULL;`; CoA row `S51-1101 ค่าคอมพนักงานขายสาขา` with the column list and `ON CONFLICT ("code") DO NOTHING` of `migrations/20260991000000_seed_shop_payroll_salary_ot_accounts/migration.sql:1-17` (values `shop-coa.csv:68` — `AccountRoleService.onModuleInit` asserts role codes exist, `account-role.service.ts:107-114`); role row as Part 1 Task 1. Generate both clients.
- [ ] **Step 4: Run** the schema spec + account-role spec + attendance harness spec · Expected: PASS.
- [ ] **Step 5: Commit** `feat(payroll): schema for commission items and clawback deductions`.

### Task 2: One clawback helper; paid commissions clawed back instead of blocked; 410

**Files:**
- Create: `apps/api/src/modules/commission/commission-payout-cover.util.ts`, `apps/api/src/modules/commission/commission-clawback.util.ts`
- Modify: `commission/commission.service.ts` (`applyClawbackForContract` 286-342, `markPaid` 248, `generatePayouts` 560, `markPayoutPaid` 699), `sales/services/sale-void.service.ts` (G4 360-376, G4b 404-411, writes 515-527, response), `trade-in/services/credit-contract-cleanup.util.ts` (40-62), `contracts/services/contract-commission.util.ts` (cover predicate 96-97 → helper; unpaid write 84-90 → `clawBackCommissions` with PENDING/APPROVED rows only; `keptPaidIds` and results unchanged)
- Test: `commission/__tests__/commission-clawback.util.spec.ts`; updates to `commission/commission.service.spec.ts` (556-645, 307-318, 737), `sales/services/sale-void.service.spec.ts` (354, 488), `sales/__tests__/sale-void.integration.spec.ts` (cases 4–7 seed PAID commissions and `CommissionPayout` rows directly — they call `markPaid` :792 and `generatePayouts` :833/:878/:907/:949 today); new `trade-in/services/__tests__/credit-contract-cleanup.util.spec.ts`

**Interfaces — Produces:**
```ts
export function isCoveredByPayout(c: { salespersonId: string; period: string; createdAt: Date }, p: { salespersonId: string; period: string; generatedAt: Date | null }): boolean;
export interface ClawbackCandidate { id: string; status: CommissionStatus; commissionAmount: Prisma.Decimal; paidAt: Date | null; paidAmount: Prisma.Decimal | null }
export function clawBackCommissions(tx: Prisma.TransactionClient, rows: ClawbackCandidate[], a: { reason: string; now: Date; percent?: number; monthsPaidBeforeDefault?: number }): Promise<{ unpaidIds: string[]; paidIds: string[]; paidTotal: Prisma.Decimal }>;
export const COMMISSION_PAY_VIA_PAYROLL_MSG: string;
```
Helper (percent default 100): skip `CLAWED_BACK`; `status = percent === 100 ? 'CLAWED_BACK' : 'PARTIALLY_CLAWED_BACK'`; paid rows → `clawbackAmount = HALF_UP(paidAmount × percent / 100, 2)`; unpaid rows → `percent === 100 ? null : HALF_UP(commissionAmount × percent / 100, 2)`; always `clawbackPercent`, `clawbackAt`, `clawbackReason`, `monthsPaidBeforeDefault` when given; conditional `updateMany` on `(id, status)`, count ≠ 1 → `ConflictException('สถานะค่าคอมเปลี่ยนแล้ว กรุณาตรวจใหม่')`.

- [ ] **Step 1: Failing tests:** helper cases (unpaid → null amount; PAID 800 → 800.00; paid PARTIALLY → amount = paidAmount; percent 50 on PAID 1,000 → PARTIALLY 500.00; race → Conflict); cron keeps tiers + idempotency through the helper; sale void "G4: ค่าคอม PAID → ยกเลิกได้ ค่าคอมเป็น CLAWED_BACK ยอด = paidAmount" with `paidCommissionClawback: '800.00'`; G4b still refuses; credit cleanup claws back paid instead of throwing; contract cancellation unchanged (existing "leaves commission that was already paid alone" stays green); the three old pay methods throw `GoneException(PAY_VIA_PAYROLL)`.
- [ ] **Step 2: Run** `npx jest src/modules/commission src/modules/sales/services/sale-void.service.spec.ts src/modules/contracts/services/contract-commission.util.spec.ts src/modules/trade-in` · Expected: FAIL.
- [ ] **Step 3: Implement** (controller decorators untouched ⇒ manifest unchanged).
- [ ] **Step 4: Run** the same + `bash tools/test-db-vitest.sh src/modules/sales/__tests__/sale-void.integration.spec.ts` · Expected: PASS.
- [ ] **Step 5: Commit** `feat(commission): one clawback helper; paid commissions clawed back on sale void/credit return; old pay paths 410`.

### Task 3: `compute` — commission PAY items and clawback deductions

**Files:**
- Modify: `apps/api/src/modules/expense-documents/payroll-system/{payroll-system-rows.service.ts, payroll-system.types.ts}`
- Test: extend `__tests__/payroll-system-rows.integration.spec.ts`

**Interfaces — Produces (additions):**
```ts
export interface SystemDeductionRow { source: 'COMMISSION_CLAWBACK'; accountCode: string; name: string; amount: string }
export interface CommissionItemOut { salesCommissionId: string; kind: 'PAY' | 'CLAWBACK'; accountCode: string; amount: string; reference: string; date: string; reason: string | null; carriedForward: string | null }
// SystemRowsForUser gains: systemDeductions: SystemDeductionRow[]; commissionItems: CommissionItemOut[]
// SystemIncomeRow.source gains 'COMMISSION' (quantity/rate/multiplier null)
// SystemWarning gains COMMISSION_FINANCE_BLOCKED {count}, COMMISSION_IN_OTHER_DOCUMENT {count, documentNumber}, CLAWBACK_CARRIED {deducted, carried}, CLAWBACK_PAID_OUTSIDE_PAYROLL {reference}
```
Rules (for every linked SHOP line, regardless of attendance eligibility): PAY = `salespersonId = user`, `status = APPROVED`, `period ≤ payrollPeriod`, `deletedAt null`, no live PAY item in another document (those → `COMMISSION_IN_OTHER_DOCUMENT`), not covered by a non-DRAFT/CANCELLED legacy payout; one COMMISSION income row (role `shop_payroll_commission`, read from the DB). FINANCE → `COMMISSION_FINANCE_BLOCKED`. Clawback = `salespersonId = user`, status `CLAWED_BACK`/`PARTIALLY_CLAWED_BACK`, `clawbackAmount > 0`, `paidAt` set, **and a live PAY item in a POSTED payroll** (paid without one → `CLAWBACK_PAID_OUTSIDE_PAYROLL`; never paid → ignored); outstanding = `clawbackAmount − Σ live CLAWBACK items in other documents`; order `[clawbackAt asc, id asc]`; deduct up to this period's PAY total; remainder → `carriedForward` + `CLAWBACK_CARRIED`; each CLAWBACK item and deduction row use the PAY item's `accountCode` (deduction rows grouped by account).

- [ ] **Step 1: Failing tests:** (d) FINANCE → no commission rows + warning; (e) APPROVED `2026-09` + `2026-10` pulled for `2026-10`, PENDING / CLAWED_BACK / `2026-11` excluded; (f) commission with a live PAY item elsewhere → excluded + `COMMISSION_IN_OTHER_DOCUMENT`; (g) clawbacks 800 + 600 (both with posted PAY items) vs commission 1,000 → items 800 / 200, carried 400, deduction 1,000.00; (g2) two clawbacks with the same `clawbackAt` → deterministic split by id; (j) two live PAY items for one commission → P2002; (n) PAID commission with no PAY item, clawed back → no deduction + `CLAWBACK_PAID_OUTSIDE_PAYROLL`; (n2) APPROVED (unpaid) commission hit by a 50% cron clawback → no deduction, no warning; (o) role remapped after payment → the clawback still credits the PAY item's account; (p) a DAILY salesperson gets a COMMISSION row plus `NOT_MONTHLY_OR_NO_BASE`; (q) a line whose OT sits in another document still gets its commission.
- [ ] **Step 2: Run** the harness spec · Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** · Expected: PASS.
- [ ] **Step 5: Commit** `feat(payroll): compute commission and clawback rows`.

### Task 4: Store, gate, pay, void

**Files:**
- Modify: `services/expense-document-create.service.ts` (`updatePayrollInTx` / create: write `commissionItems`, deduction rows with `source`, force client deductions to MANUAL, `CLAWBACK_DUPLICATE`; `payroll-clawback` locks; P2002 → `COMMISSION_TAKEN`; `netPaid`/`netPayment` include deductions), `services/expense-document-lifecycle.service.ts` `submitForApproval` (rebuild keeps MANUAL deductions only), `services/expense-line-data.ts`, `services/expense-document-query.service.ts` (`findOne`: `commissionItems: { where: { releasedAt: null }, include: { salesCommission: { select: { id, period, commissionAmount, clawbackReason, createdAt, contract: { select: { contractNumber } }, sale: { select: { saleNumber } } } } } }`), `payroll-system/payroll-post-gate.service.ts` (compare deductions + live items; per-line COMMISSION income = Σ live PAY, COMMISSION_CLAWBACK = Σ live CLAWBACK; `markCommissionsPaid`; `releaseOnVoid`), `services/expense-document-lifecycle.service.ts` (`executePostBody` after the template → `markCommissionsPaid`; `voidDocument` 659-908 → `releaseOnVoid` before the status CAS; `softDelete` 225-241 → `releasedAt` on the draft's items; audits gain `commissionItemIds` / `releasedCommissionItemIds`)
- Test: `__tests__/payroll-commission-flow.integration.spec.ts`

**Interfaces — Produces:**
```ts
markCommissionsPaid(tx, documentId: string, paidAt: Date): Promise<string[]>; // live PAY: APPROVED → PAID, paidAt = documentDate, paidAmount = item.amount; conditional, count 1 else PAYROLL_STALE with a StaleDiff for that commission
releaseOnVoid(tx, documentId: string): Promise<string[]>;
```
`releaseOnVoid` (after `payroll-clawback` locks for the document's users): refuse `VOID_AFTER_CLAWBACK` when a PAY-item commission has a live CLAWBACK item in another non-VOIDED document; refuse `VOID_PARTIAL_CLAWBACK` when a PAY-item commission is `PARTIALLY_CLAWED_BACK`; PAY items only: PAID → APPROVED (clear `paidAt`, `paidAmount`); full `CLAWED_BACK` with `paidAt` and no live CLAWBACK item → clear `paidAt`, `paidAmount`, `clawbackAmount`; then `releasedAt = now` on **all** items of the document.

- [ ] **Step 1: Failing integration tests:** save → submit (after cutoff) → approve → POSTED, JE has Dr `S51-1101` for the commission, commissions PAID with `paidAmount`; second draft for the same salesperson saves **without** that commission and shows `COMMISSION_IN_OTHER_DOCUMENT` (no 409); one clawback in two drafts of different periods → the second deducts 0; pays X 1,000 in October → `applyClawbackForContract` 50% → November has an APPROVED commission of 1,000 → November save: COMMISSION income 1,000.00, deduction 500.00, carried 0, `netPaid` = base + 1,000 − 500 − sso − wht and the document `netPayment` matches, JE Cr the PAY item's account; sibling: November with no commission → deduction 0 and `CLAWBACK_CARRIED` 500; a draft holding a 500.00 clawback row edited (PATCH from the form payload) and then submitted → still exactly one `COMMISSION_CLAWBACK` 500.00 and no MANUAL `S51-1101` deduction; a MANUAL `S51-1101` deduction on that line → 400 `CLAWBACK_DUPLICATE`; a new October commission approved after submit → approve passes, it is pulled into November; a resignee's final-month clawback nets against that month's commission; a commission clawed back between submit and approve → `PAYROLL_STALE` with a diff for that commission; a COMMISSION income row tampered in the DB → stale; void plain → APPROVED + items released + a new document pulls them; void of the deducting document → the next save deducts again; void of a paying document after a later deduction → `VOID_AFTER_CLAWBACK`; void after a partial clawback → `VOID_PARTIAL_CLAWBACK`; soft-deleting a draft frees its commission.
- [ ] **Step 2: Run** `bash tools/test-db-vitest.sh src/modules/expense-documents/__tests__/payroll-commission-flow.integration.spec.ts` · Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it + all `expense-documents/__tests__/*.integration.spec.ts` + `npx jest src/modules/expense-documents` · Expected: PASS.
- [ ] **Step 5: Commit** `feat(payroll): pay commissions on post, release on void, deduct clawbacks`.

### Task 5: Tax base after clawback

**Files:**
- Modify: `apps/api/src/modules/tax/services/tax-preview.service.ts` (`previewPayrollWHT` ~702, `previewPnd1Annual` ~962)
- Modify: `apps/api/src/modules/expense-documents/payroll-system/payroll-pay.ts` — add `payrollTaxableGross(line)` (base + taxable income − COMMISSION_CLAWBACK deductions, floor 0)
- Test: `apps/api/src/modules/expense-documents/payroll-system/__tests__/payroll-pay.spec.ts` (helper), `apps/api/src/modules/expense-documents/__tests__/payroll-tax-base.integration.spec.ts` (self-contained; `EXPDOC_FILES` glob)

- [ ] **Step 1: Failing tests:** helper goldens; a POSTED line base 15,000 + commission 1,000 + clawback 1,000 + manual deduction 300 → WHT gross `15000.00`, annual the same; line without clawback unchanged.
- [ ] **Step 2: Run** `npx jest src/modules/expense-documents/payroll-system` + `bash tools/test-db-vitest.sh src/modules/expense-documents/__tests__/payroll-tax-base.integration.spec.ts` · Expected: FAIL.
- [ ] **Step 3: Implement** (select `customDeduction.source`).
- [ ] **Step 4: Run** + `payroll-shop-flow.integration.spec.ts` · Expected: PASS.
- [ ] **Step 5: Commit** `feat(tax): PND1 base nets commission clawbacks`.

### Task 6: Web — commission rows, commissions page, sale void note

**Files:**
- Modify (API): `commission/commission.service.ts` `findAll` (97-130): `payrollLinks: { documentId, documentNumber, status, kind: 'PAY' | 'CLAWBACK' }[]` (live items), `clawbackOutstanding: string | null` (paid rows only), `salespersonResigned: boolean` (`resignedDate ≤ now`)
- Modify (web): `components/expense-form-v4/payroll-system/PayrollSystemRows.tsx` (commission row with null quantity/rate + expandable list, locked clawback table with `ยกไปงวดหน้า`), `components/expense-form-v4/payroll-system/PayrollReviewPanel.tsx` (copy for `COMMISSION_FINANCE_BLOCKED`, `COMMISSION_IN_OTHER_DOCUMENT`, `CLAWBACK_CARRIED`, `CLAWBACK_PAID_OUTSIDE_PAYROLL`), `components/expense-form-v4/{ExpenseFormV4.tsx (edit mapping 207-212, payload), PayrollLinesSection.tsx (copy-previous 139/187), types.ts}` (keep only `source === 'MANUAL'` deductions), `pages/expense-detail/PayrollDetailSection.tsx` (commission column + `ยกไปงวดหน้า {y} บาท` from the line's `CLAWBACK_CARRIED` note), `pages/PaymentVoucherPage.tsx` (commission list, clawback rows, `ยกไปงวดหน้า {y} บาท`), `pages/CommissionsPage.tsx` (114, 126, 136-170, 194-358, 455-563), `lib/status-badges.ts` (`commissionStatusMap` 364-368), `pages/SalesHistoryPage.tsx` (void mutation :199 + dialog)
- Test: `commission/commission.service.spec.ts` (findAll), `pages/__tests__/CommissionsPage.test.tsx` (new), `pages/__tests__/SalesHistoryPage.void.test.tsx` (existing — add cases), form/slip/detail cases

UI per boards 1, 3, 4, 6B, 6C: approve uses `api.post`; row `จ่าย`, payout `อนุมัติ`/`จ่ายแล้ว`, `สร้างใบจ่าย` removed; payout tab `ใบจ่ายรายเดือน` + `ดูอย่างเดียว`; banner `ค่าคอมไม่มีปุ่มจ่ายแยกแล้ว` — `อนุมัติรายการที่นี่ แล้วระบบดึงเข้าใบเงินเดือนให้เมื่อบันทึกใบ (หน้ารายจ่าย › สร้างเอกสารใหม่ › เงินเดือน (PR)) — ค่าคอมจะเป็น "จ่ายแล้ว" เมื่อใบเงินเดือนลงบัญชี`; labels APPROVED `อนุมัติแล้ว · รอเข้าใบเงินเดือน`, CLAWED_BACK `เรียกคืน`, PARTIALLY_CLAWED_BACK `เรียกคืนบางส่วน`; one chip per `payrollLinks` entry: `อยู่ในใบเงินเดือน {เลขที่} · {สถานะ}` (PAY) / `หักคืนในใบ {เลขที่}` (CLAWBACK); `clawbackOutstanding` → `เรียกคืน — รอหัก {n}`, + `salespersonResigned` → `เรียกคืน — พนักงานลาออก ให้เจ้าของตัดสิน`. Sale void dialog note `ถ้าค่าคอมของใบนี้จ่ายไปแล้วในเงินเดือน ระบบจะหักคืนในเงินเดือนงวดถัดไปเอง ไม่ต้องทำอะไรเพิ่ม`; success with `paidCommissionClawback` → toast `ค่าคอม {n} บาทที่จ่ายแล้วจะหักในเงินเดือนงวดถัดไป`.

- [ ] **Step 1: Failing tests** (fields; a commission paid in PR-A and deducted in PR-B and PR-C shows three chips; POST approve; no pay buttons; void note + toast; form/slip commission rows; slip of the 800 + 600 vs 1,000 case prints `ยกไปงวดหน้า 400.00 บาท`; edit/copy drop the clawback deduction from the payload).
- [ ] **Step 2: Run** jest commission + `cd apps/web && npx vitest run src/pages/__tests__/CommissionsPage.test.tsx src/pages/__tests__/SalesHistoryPage src/components/expense-form-v4 src/pages/expense-detail src/pages/PaymentVoucherPage.test.tsx` · Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** · Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): commissions through payroll`.

### Task 7: Docs, version, full gates

**Files:** `.claude/rules/accounting.md` (Payroll section: subsection "ค่าคอม/หักคืนผ่านใบเงินเดือน (D4 ส่วนที่ 2)"; commission section 2153-2182; void-sale G4 row :2243 + G4b 2247-2274 — pay paths now 410), `.claude/CLAUDE.md` (Important Notes), `apps/web/package.json` → `26.10.63`

- [ ] **Step 1:** Write the rules as built (sources, cap/carry, accounts, guard, void refusals, contract cancellation unchanged, 410 paths, decisions 1–5).
- [ ] **Step 2: Full gates:** types · eslint on changed files · `npx jest src/modules/expense-documents src/modules/attendance src/modules/commission src/modules/sales src/modules/contracts src/modules/trade-in src/modules/tax src/modules/trash src/modules/journal src/modules/settings src/filters` · harness: all `expense-documents/__tests__/*.integration.spec.ts`, `attendance/__tests__/attendance.integration.spec.ts`, `sales/__tests__/sale-void.integration.spec.ts` · `cd apps/web && npx vitest run` · `node tools/check-access-coverage.mjs`. Counts in the commit body.
- [ ] **Step 3: Commit** `docs(payroll): D4 part 2 rules; bump web 26.10.63`.
