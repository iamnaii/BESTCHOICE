# Payroll OT + Commission via Payroll + Paper Slip (D4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every payroll line linked to an employee gets server-computed, locked rows for OT / holiday pay from attendance, approved commissions, and clawbacks of commissions already paid; approving/posting pays the commissions and locks that month's attendance; the A4 slip shows hours × rate.

**Architecture:** A pure pay-math module (`payroll-pay.ts`) and one service (`PayrollSystemRowsService.compute`) produce every system row; the prefill endpoint (preview button), the save path and the post gate all call that same function, so preview == stored == posted. `PayrollCommissionItem` ties each commission payment (PAY) or clawback deduction (CLAWBACK) to one live payroll line; a partial unique index stops double payment. The existing `PayrollTemplate` journal is unchanged — system rows are ordinary custom income / deduction rows with a `source`.

**Tech Stack:** NestJS + Prisma 5 + PostgreSQL (apps/api, jest + vitest Postgres harness), React 18 + react-query + Tailwind/shadcn (apps/web, vitest + RTL).

**Spec:** `docs/superpowers/specs/2026-10-27-payroll-ot-commission-design.md` (owner decisions D1–D7, §14 answered, §16 post-review adjustments). Mockup (owner-approved): canvas `https://claude.ai/artifact/HwUwS9UHLVYosge2LbLef1`, boards 1–6.

## Global Constraints

- Worktree `/Users/iamnaii/Desktop/App/BESTCHOICE/.claude/worktrees/payroll-ot`, branch `feat/payroll-ot-commission` (based on `feat/attendance-kiosk`, PR #1738 unmerged — retarget to `main` after it merges). Use `git -C <worktree>`; never bare `git stash`; commit per task; **never push** (repo is public; the owner decides).
- Money is `Prisma.Decimal` end to end. Never feed `AttendanceService.month()` numbers (it converts to Number) into pay. Compare money as `new Prisma.Decimal(v).toFixed(2)` strings on both sides.
- Hourly base = **`EmployeeProfile.baseSalary`** (registry, full month) ÷ 240 — not `PayrollLine.baseSalary`. Row amount = `HALF_UP(base × multiplier × hours / 240, 2)`, once per row per person per month (hours summed first). Stored `rate` = `HALF_UP(base × multiplier / 240, 4)`, display only.
- Multipliers: weekday OT 1.5 · holiday work 1 · holiday OT 3. Auto-OT eligible = `employmentType = MONTHLY` **and** `baseSalary > 0`.
- **The server computes system rows for every line that has a `userId`, on every save** (create, update, template instantiation). The client never sends system rows; the button only previews.
- Accounts (all via `AccountRoleService`): weekday OT `${prefix}payroll_overtime` · holiday work and holiday OT `${prefix}payroll_holiday` (new, default `S52-1202` / `53-1103`) · commission `shop_payroll_commission` (new, `S51-1101`) · clawback deduction credits the **`accountCode` stored on the paying PAY item**. Commission and clawback rows only for `entityScope = 'SHOP'`.
- Cutoff = 18:00 Asia/Bangkok on day 1 of the month after the period (`payrollCutoff('2026-10')` = `2026-11-01T11:00:00.000Z`).
- Slips are paper only — no LINE / email path anywhere.
- Audit: expense lifecycle keeps its module pattern (`tx.auditLog.create` inside the tx, atomic with the status flip). Attendance keeps `await this.audit.log(...)` after commit. Never call `AuditService.log` inside a `$transaction`.
- Advisory lock order (deadlock rule): `post:${docId}` → `payroll:${branchId}:${period}:${scope}` → `payroll-attendance:${userId}:${period}` (users sorted) → `payroll-clawback:${userId}` (users sorted). Attendance writers take only `payroll-attendance:*`, sorted and de-duplicated.
- New constructor dependencies on `ExpenseDocumentCreateService`, `ExpenseDocumentLifecycleService`, `ExpenseDocumentQueryService` are trailing `@Optional()` parameters (9+ hand-built instances exist). When absent: create/update throw `Error('PayrollSystemRowsService not wired')` for a PAYROLL with linked lines; lifecycle throws the same for PAYROLL approve/post; query returns `payrollGate: null`. Never fail open.
- Migrations are hand-written SQL in a new folder; never `prisma migrate dev`, never `prisma format`. Partial unique indexes live only in SQL, with a `///` schema comment telling readers not to accept a diff that drops them.
- Every new route gets an entry in `apps/api/src/modules/employee-access/access-policy.manifest.json`; `node tools/check-access-coverage.mjs` must print 0 errors. Surface value for a new entry:
  `node --input-type=module -e "import c from 'node:crypto';import {inventory} from './tools/lib/access-entrypoints.mjs';for(const e of inventory())if(e.controller==='<C>'&&e.method==='<m>')console.log(c.createHash('sha256').update(JSON.stringify([...e.classDecorators,...e.decorators].filter(d=>/^(Controller|WebSocketGateway|UseGuards|Roles|Public|Entity|RequireAudience|AccessPolicy|Get|Post|Put|Patch|Delete|Head|Options|All|Sse|SubscribeMessage)\(/.test(d)))).digest('hex').slice(0,20))"`
- DTO fields must carry class-validator decorators (global `ValidationPipe({ whitelist: true })`, `app.setup.ts:172-180`, strips undecorated fields). IDs are `@IsString()` (dev seed ids are not UUIDs, e.g. `branch-001`).
- Commands (run from the worktree):
  - API unit: `cd apps/api && NODE_OPTIONS=--max-old-space-size=6144 npx jest <paths> --maxWorkers=2`
  - Postgres: `bash tools/test-db-vitest.sh <spec paths relative to apps/api>` (fresh DB, migrations only, no seed — every spec creates its own users/branches)
  - Web: `cd apps/web && npx vitest run <paths>`
  - Types: `NODE_OPTIONS=--max-old-space-size=6144 bash tools/check-types.sh all`
  - ESLint: `cd apps/api && npx eslint <files>` / `cd apps/web && npx eslint <files>` — **never** `npm --workspace apps/api run lint` (it has `--fix`).
- UI: tokens from `index.css` only; status = icon + words; `NativeSelect` not raw `<select>`; Thai text `leading-snug`; copy names menus/buttons that exist (ลงเวลา sits under "ขาย" for OWNER and "ภาพรวม" for BM — say "เมนู ลงเวลา"; payroll is created at หน้ารายจ่าย › `สร้างเอกสารใหม่` › `เงินเดือน (PR)`); layout and copy follow the mockup boards.

### Exact copy (server messages — use verbatim)

| Key | Thai text |
|---|---|
| `CUTOFF` | `อนุมัติและลงบัญชีได้ตั้งแต่ {วันที่ไทยสั้น} 18:00 — ใบนี้มี OT จากระบบลงเวลา รอให้พ้นเวลาตอกออกข้ามเที่ยงคืนของวันสุดท้ายของเดือนก่อน` |
| `STALE_SEND_BACK` (status PENDING_APPROVAL or APPROVED before the call) | `ยังไม่ได้ลงบัญชี — ข้อมูลลงเวลา/ค่าคอมเปลี่ยนหลังดึง กด "ส่งกลับเป็นร่าง" แล้วให้ผู้ทำเงินเดือนบันทึกใบอีกครั้ง (ระบบคิดยอดใหม่ให้) ตรวจยอด แล้วส่งขออนุมัติอีกครั้ง` |
| `STALE_DRAFT` | `ยังไม่ได้ลงบัญชี — ข้อมูลลงเวลา/ค่าคอมเปลี่ยนหลังบันทึก กด "แก้ไข" แล้วบันทึกใบอีกครั้ง (ระบบคิดยอดใหม่ให้) ตรวจยอดก่อนลงบัญชี` |
| `DEVICE_CONFLICT` | `อนุมัติไม่ได้ — มีวันที่ติดธง เครื่องถูกใช้ซ้อน {n} วัน ({ชื่อ · วันที่}, …) ให้เจ้าของตรวจที่เมนู ลงเวลา แล้วล้างธง หรือให้ผู้จัดการแก้เวลา` |
| `OTHER_DOC` | `OT ของ {ชื่อ} เดือนนี้อยู่ในใบ {เลขที่} แล้ว — เอาออกจากใบใดใบหนึ่งก่อน` |
| `COMMISSION_TAKEN` | `ค่าคอมบางรายการอยู่ในใบเงินเดือนอื่นแล้ว — บันทึกใบอีกครั้งเพื่อให้ระบบคิดยอดใหม่` |
| `MANUAL_OT_DUPLICATE` | `{ชื่อ} มีแถว OT ที่กรอกเองซ้ำกับ OT จากระบบลงเวลา — ลบแถว OT ที่กรอกเองออก (ระบบคิดจากลงเวลาให้แล้ว)` |
| `ATTENDANCE_PAID` | `เดือนนี้จ่ายเงินเดือนแล้ว (ใบ {เลขที่}) — แก้ไม่ได้ ถ้าต้องปรับให้ใส่รายการปรับปรุงในงวดถัดไป` |
| `VOID_AFTER_CLAWBACK` | `กลับรายการใบนี้ไม่ได้ — ค่าคอมที่ใบนี้จ่ายถูกหักคืนแล้วในใบ {เลขที่} ให้กลับรายการใบนั้นก่อน` |
| `VOID_PARTIAL_CLAWBACK` | `กลับรายการใบนี้ไม่ได้ — ค่าคอม {อ้างอิง} ที่ใบนี้จ่ายถูกเรียกคืนบางส่วนแล้ว ถ้าต้องแก้ยอดของคนอื่นในใบนี้ ให้ใส่รายการปรับปรุงในใบเงินเดือนงวดถัดไป` |
| `TRASH_RESTORE_PAYROLL` | `กู้คืนใบเงินเดือนนี้ไม่ได้ — ยอด OT/ค่าคอมในใบเก่าไม่ตรงแล้ว ให้สร้างใบใหม่ที่หน้ารายจ่าย › สร้างเอกสารใหม่ › เงินเดือน (PR)` |
| `PAY_VIA_PAYROLL` (410) | `จ่ายค่าคอมผ่านใบเงินเดือนเท่านั้น — สร้างใบเงินเดือนที่หน้ารายจ่าย › สร้างเอกสารใหม่ › เงินเดือน (PR) ระบบดึงค่าคอมที่อนุมัติแล้วให้เอง` |
| warning `NOT_MONTHLY_OR_NO_BASE` | `พนักงานรายวัน/สัญญาจ้าง หรือไม่มีเงินเดือนในทะเบียน — ระบบไม่คิด OT ให้ ลงเวลาเดือนนี้มี OT {h} ชม. กรอกในรายได้พิเศษเอง` |
| warning `COMMISSION_FINANCE_BLOCKED` | `ใบฝั่งส่วนกลาง (FINANCE) ยังไม่ดึงค่าคอม — รอฝ่ายบัญชีตอบ` |
| row names | `OT วันทำงาน (1.5 เท่า)` · `ทำงานวันหยุด (1 เท่า)` · `OT วันหยุด (3 เท่า)` · `ค่าคอมมิชชัน ({n} รายการ)` · `หักคืนค่าคอม ({n} รายการ)` |

### Decisions this plan adds (within the spec, settled here — owner reviews the list)

1. **Holiday break, no cliff:** paid minutes = `overlap < 300 ? overlap : max(overlap − 60, 299)`, then the 15/45 rounding, cap 8 h. The literal rule pays 10:00–14:59 as 5 h but 10:00–15:00 as 4 h; this is monotonic. Cost if wrong: slightly more pay for 5–6 h holiday shifts.
2. **Holiday OT recomputed with today's rules:** on `DAY_OFF` / `SHOP_CLOSED`, both holiday hours and holiday OT come from `computeDaySummary` + `holidayWorkHours` with `getRules(day.branchId)` — one rule set per day, so no hour is paid twice or dropped when rules changed after the punch. Cost: the attendance page's stored OT for that day can differ after a rule change.
3. **Cutoff applies by eligibility:** a payroll can't be approved/posted before the cutoff if any line belongs to an auto-OT-eligible user, even with 0 OT at the last save.
4. **Server always computes** for lines with a `userId` (Global Constraints) — so copy-previous, a forgotten button, or a recurring template can never post a line without its OT/commission. `PayrollLine.systemPulledAt` = time of the last computation. Manual income on the OT/holiday account of an eligible line is rejected (`MANUAL_OT_DUPLICATE`).
5. **Clawback double-deduction guard:** no unique index for CLAWBACK (carry-forward needs several live items per commission); instead outstanding = `clawbackAmount − Σ live CLAWBACK items in other documents`, read under `payroll-clawback:${userId}`, and re-checked by the post gate. No `deductedAt` column.
6. **Send back to draft:** PAYROLL only, from `PENDING_APPROVAL` or `APPROVED`, by holders of `EXPENSE_APPROVE` in that branch or the creator.
7. **Contract cancellation claws back paid commissions too** (spec §6ข (ง)); the cron `applyClawbackForContract` also goes through the shared helper (spec §6ข "helper ตัวเดียว").
8. **Void refused when a paid commission is partially clawed back** (`VOID_PARTIAL_CLAWBACK`) — no state can express "75% still payable"; the fix path is an adjustment row next period.
9. **Restoring a soft-deleted PAYROLL draft from the trash is refused** when it has system rows or commission items (`TRASH_RESTORE_PAYROLL`).
10. **Final-month resignees:** payroll accepts profiles whose `resignedDate` ≥ the first day of the payroll period (today: `> now`), because approval happens after month end.
11. **Sale void note timing:** the void dialog shows a fixed sentence and the exact amount comes in the success toast (mockup 6C showed it before confirming) — the sales list has no commission data.

## Review Focus

1. **One person, two branches, one month** — OT lands once, in the document saved first; the other shows `IN_OTHER_DOCUMENT` and no attendance rows; both can't post. (Task 4 (k), Task 7.)
2. **Overnight punch-out on the last day after the save** (31 Oct 19:00 → 1 Nov 01:30 attaches to 31 Oct) — approve before cutoff refused; after cutoff refused as stale until re-saved. (Task 7.)
3. **Registry salary / employment type changed between save and approve** — refused as stale with a diff. (Task 7.)
4. **Commission and clawback races** — two drafts with one commission → second save 409; one clawback in two drafts → second deducts 0; commission clawed back between save and approve → stale. (Tasks 6, 7.)
5. **Void and restore ordering** — void after a later document deducted the clawback → refused; void after a partial clawback → refused; plain void → commissions APPROVED and pullable; trash restore of a draft with system rows → refused. (Tasks 6, 7.)

---

### Task 1: Schema, migration, CoA row, roles

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (`PayrollLine` 5046-5074, `PayrollCustomIncome` 5080-5097, `PayrollCustomDeduction` 5102-5115, `SalesCommission` 5525-5580 back-relation)
- Create: `apps/api/prisma/migrations/20261106000000_payroll_ot_commission/migration.sql`
- Modify: `apps/api/src/modules/journal/account-role.service.ts` (`REQUIRED_ROLES` 44-71), `apps/api/src/modules/settings/role-map-validation.service.ts` (54-60), `apps/api/src/modules/journal/account-role.service.spec.ts` (`requiredRows` fixture 121-145)
- Test: `apps/api/src/modules/expense-documents/__tests__/payroll-ot-schema.spec.ts`

**Interfaces — Produces:** enums `PayrollIncomeSource { MANUAL ATTENDANCE_OT ATTENDANCE_HOLIDAY ATTENDANCE_HOLIDAY_OT COMMISSION }`, `PayrollDeductionSource { MANUAL COMMISSION_CLAWBACK }`, `PayrollCommissionItemKind { PAY CLAWBACK }`; `PayrollLine.lineNo Int @default(0)`, `systemPulledAt DateTime?`, `attendanceSummary Json?`, `commissionItems`; `PayrollCustomIncome.source @default(MANUAL)`, `quantity Decimal(6,1)?`, `rate Decimal(12,4)?`, `multiplier Decimal(3,1)?`; `PayrollCustomDeduction.source @default(MANUAL)`; model `PayrollCommissionItem { id, payrollLineId (Cascade), salesCommissionId (Restrict), kind, accountCode String, amount Decimal(12,2), releasedAt?, createdAt, updatedAt }` mapped `payroll_commission_items`; roles `shop_payroll_commission` → `S51-1101`, `shop_payroll_holiday` → `S52-1202`, `payroll_holiday` → `53-1103`.

- [ ] **Step 0: Install and generate inside the worktree** (it has no `node_modules`; generating from the shared checkout would overwrite that checkout's client): `npm ci` at the worktree root, then `cd apps/api && npx prisma generate && npx prisma generate --schema=prisma-finance/schema.prisma`. Expected: both succeed.
- [ ] **Step 1: Write the failing test** `payroll-ot-schema.spec.ts` (pattern `attendance/__tests__/attendance-schema.spec.ts`, reads `Prisma.dmmf`): the three enums with exactly the values above; the new fields with defaults/optionality; `PayrollCommissionItem` fields incl. `accountCode` and `onDelete: Cascade` on `payrollLine`; `REQUIRED_ROLES` contains the three new roles.
- [ ] **Step 2: Run** `npx jest src/modules/expense-documents/__tests__/payroll-ot-schema.spec.ts` · Expected: FAIL.
- [ ] **Step 3: Edit the schema by hand** (snake_case `@map`; `///` on `PayrollCommissionItem`: no `deletedAt` — lifecycle follows the payroll line, `releasedAt` marks void/soft-delete; `///` naming the SQL-only partial index and saying not to accept a diff that drops it). `migration.sql`: `CREATE TYPE` ×3; `ALTER TABLE` adds; `CREATE TABLE payroll_commission_items` + FKs + indexes on `sales_commission_id` and `payroll_line_id`; `CREATE UNIQUE INDEX "payroll_commission_items_one_active_pay" ON "payroll_commission_items" ("sales_commission_id") WHERE "kind" = 'PAY' AND "released_at" IS NULL;`; the CoA row `S51-1101 ค่าคอมพนักงานขายสาขา` with the column list and `ON CONFLICT ("code") DO NOTHING` copied from `migrations/20260991000000_seed_shop_payroll_salary_ot_accounts/migration.sql:1-17` (values from `shop-coa.csv:68`) — `AccountRoleService.onModuleInit` asserts every active role code exists in the chart (`account-role.service.ts:107-114`); then the three role rows using the column list/`ON CONFLICT` of `migrations/20260990000000_payroll_shop_side/migration.sql:31-40`. Add the roles to `REQUIRED_ROLES`, `'Dr'` in role-map validation, and the `requiredRows` fixture. Re-run `prisma generate` (both schemas).
- [ ] **Step 4: Run** the schema spec + `npx jest src/modules/journal/account-role.service.spec.ts src/modules/settings` · Expected: PASS. Then `bash tools/test-db-vitest.sh src/modules/attendance/__tests__/attendance.integration.spec.ts` · Expected: migrations apply, 10/10.
- [ ] **Step 5: Commit** `feat(payroll): schema for system rows, commission items and clawback deductions`.

### Task 2: Pure pay math + shared month summary

**Files:**
- Create: `apps/api/src/modules/expense-documents/payroll-system/payroll-pay.ts`
- Modify: `apps/api/src/modules/attendance/attendance-rules.ts` (export summary), `apps/api/src/modules/attendance/attendance.service.ts` (`summarize` 103-115, `cellOf` 128-139 call the extracted function)
- Test: `apps/api/src/modules/expense-documents/payroll-system/__tests__/payroll-pay.spec.ts`

**Interfaces — Produces:**
```ts
export const HOURS_PER_MONTH = 240;
export function systemIncomeAmount(base: Prisma.Decimal, multiplier: Prisma.Decimal, hours: Prisma.Decimal): Prisma.Decimal;
export function displayRate(base: Prisma.Decimal, multiplier: Prisma.Decimal): Prisma.Decimal; // 4 dp
export function holidayWorkHours(i: { workDate: Date; clockIn: Date | null; clockOut: Date | null; rules: ScheduleRules }): number;
export interface PayDay { workDate: Date; branchId: string; dayKind: AttendanceDayKind; clockIn: Date | null; clockOut: Date | null; otHours: Prisma.Decimal; lateMinutes: number; flags: string[] }
export interface MonthPayHours { otHours: Prisma.Decimal; holidayHours: Prisma.Decimal; holidayOtHours: Prisma.Decimal; holidayWorkedDays: number }
export function monthPayHours(days: PayDay[], rulesFor: (branchId: string) => ScheduleRules): MonthPayHours;
export function payrollCutoff(period: string): Date;
export function payrollAttendanceLockKey(userId: string, period: string): string;  // 'payroll-attendance:<userId>:<YYYY-MM>'
export function payrollClawbackLockKey(userId: string): string;                    // 'payroll-clawback:<userId>'
export function isAutoOtEligible(p: { employmentType: EmploymentType; baseSalary: Prisma.Decimal | null } | null): boolean;
export function payrollTaxableGross(line: { baseSalary: Prisma.Decimal; customIncome: { amount: Prisma.Decimal; isTaxable: boolean }[]; customDeduction: { amount: Prisma.Decimal; source: PayrollDeductionSource }[] }): Prisma.Decimal;
// attendance-rules.ts — the exact logic month() uses today; inputs whatever month() needs, output the existing MonthSummary (attendance.service.ts:67-74)
export function summarizeAttendanceMonth(...): MonthSummary;
```
Rules: weekday OT = Σ stored `otHours` of `WORK` and `LEAVE_*` days with a clock-in. `DAY_OFF` / `SHOP_CLOSED` with a clock-in: `holidayHours += holidayWorkHours(rulesFor(branchId))`, `holidayOtHours += computeDaySummary({ … rules: rulesFor(branchId) }).otHours` (decision 2). `holidayWorkHours` = overlap of `[clockIn, clockOut]` with `[workDate+workStart, workDate+workEnd]` in floored minutes → decision 1 → `roundOtMinutes` → cap 8; `clockOut === null` → 0.

- [ ] **Step 1: Write the failing tests:** `systemIncomeAmount(15000, 1.5, 6.5) = 609.38` · `(15000, 1, 8) = 500.00` · `(15000, 3, 2) = 375.00` · `(16500, 1.5, 1.5) = 154.69` · `displayRate(15000, 1.5) = 93.7500` · `displayRate(16500, 1.5) = 103.1250`. **Summed before rounding:** three WORK days with otHours 0.5 → `monthPayHours().otHours = 1.5` → amount `140.63` (per-day rounding would give 140.64). `holidayWorkHours` with rules 10:00–19:00: 13:00–21:00 → 5 · 10:00–21:00 → 8 · 09:00–12:10 → 2 · 10:00–14:59 → 5 · 10:00–15:00 → 5 · 10:00–16:00 → 5 · 10:00–17:00 → 6 · clockOut null → 0 · monotonic over every minute 10:01–19:00. Holiday day 13:00–21:00 with stored otHours 2 but current rules 10:00–20:00 → holidayHours 6, holidayOtHours 1. `payrollCutoff('2026-10')` → `2026-11-01T11:00:00.000Z`; `('2026-12')` → `2027-01-01T11:00:00.000Z`. `isAutoOtEligible` false for DAILY, null salary, salary 0. `payrollTaxableGross` = base + taxable income − COMMISSION_CLAWBACK deductions (manual ignored), floor 0. Lock keys exact strings.
- [ ] **Step 2: Run** `npx jest src/modules/expense-documents/payroll-system` · Expected: FAIL.
- [ ] **Step 3: Implement** (Decimal, `ROUND_HALF_UP`; cutoff = `bangkokMidnight(y, m0 + 1, 1)` + 18 h). Extract `summarizeAttendanceMonth` unchanged and call it from `month()`.
- [ ] **Step 4: Run** the new spec + `npx jest src/modules/attendance` · Expected: PASS.
- [ ] **Step 5: Commit** `feat(payroll): pay math for OT, holiday work and cutoff`.

### Task 3: One clawback helper for every source; 410 on old pay paths

**Files:**
- Create: `apps/api/src/modules/commission/commission-payout-cover.util.ts`, `apps/api/src/modules/commission/commission-clawback.util.ts`
- Modify: `apps/api/src/modules/commission/commission.service.ts` (`applyClawbackForContract` 286-342, `markPaid` 248, `generatePayouts` 560, `markPayoutPaid` 699), `apps/api/src/modules/sales/services/sale-void.service.ts` (G4 360-376, G4b 404-411, writes 515-527, response), `apps/api/src/modules/trade-in/services/credit-contract-cleanup.util.ts` (40-62), `apps/api/src/modules/contracts/services/contract-commission.util.ts` (66-104) + caller audit `contract-cancellation.service.ts:425-430`
- Test: `commission/__tests__/commission-clawback.util.spec.ts`; updates to `commission/commission.service.spec.ts` (clawback 556-645, markPaid 307-318, generatePayouts 737), `sales/services/sale-void.service.spec.ts` (354, 488), `sales/__tests__/sale-void.integration.spec.ts` (cases 4–7: seed PAID commissions and `CommissionPayout` rows directly with prisma — they call `markPaid` :792 and `generatePayouts` :833/:878/:907/:949 today), `contracts/services/contract-commission.util.spec.ts` (79); new `trade-in/services/__tests__/credit-contract-cleanup.util.spec.ts`

**Interfaces — Produces:**
```ts
export function isCoveredByPayout(c: { salespersonId: string; period: string; createdAt: Date }, p: { salespersonId: string; period: string; generatedAt: Date | null }): boolean; // replaces the 3 inline copies
export interface ClawbackCandidate { id: string; status: CommissionStatus; commissionAmount: Prisma.Decimal; paidAt: Date | null; paidAmount: Prisma.Decimal | null }
export function clawBackCommissions(tx: Prisma.TransactionClient, rows: ClawbackCandidate[], a: { reason: string; now: Date; percent?: number; monthsPaidBeforeDefault?: number }): Promise<{ unpaidIds: string[]; paidIds: string[]; paidTotal: Prisma.Decimal }>;
export const COMMISSION_PAY_VIA_PAYROLL_MSG: string; // PAY_VIA_PAYROLL copy
```
`clawBackCommissions` (percent default 100): skips rows already `CLAWED_BACK`; `status = percent === 100 ? 'CLAWED_BACK' : 'PARTIALLY_CLAWED_BACK'`; paid rows (`paidAt` set): `clawbackAmount = HALF_UP(paidAmount × percent / 100, 2)`; unpaid rows: `clawbackAmount = percent === 100 ? null : HALF_UP(commissionAmount × percent / 100, 2)` (today's cron meaning); always `clawbackPercent`, `clawbackAt = now`, `clawbackReason`, and `monthsPaidBeforeDefault` when given. Each write is a conditional `updateMany` on `(id, status)`; count ≠ 1 → `ConflictException('สถานะค่าคอมเปลี่ยนแล้ว กรุณาตรวจใหม่')`.

- [ ] **Step 1: Write the failing tests.** Helper: unpaid APPROVED → CLAWED_BACK, amount null; PAID 800 → CLAWED_BACK 800.00; paid PARTIALLY_CLAWED_BACK → CLAWED_BACK amount = paidAmount; percent 50 on PAID 1,000 → PARTIALLY_CLAWED_BACK 500.00; concurrent status change → Conflict. `applyClawbackForContract` keeps its tier table and idempotency but writes through the helper. Sale void: "G4: ค่าคอม PAID → ยกเลิกได้ ค่าคอมเป็น CLAWED_BACK ยอด = paidAmount" with response `paidCommissionClawback: '800.00'`; paid PARTIALLY_CLAWED_BACK likewise; G4b (locked legacy payout) still refuses. Credit cleanup: paid commission is clawed back instead of throwing. Contract cancellation: PAID → clawed back, audit key `commissionPaidClawedBackIds`. `markPaid`, `generatePayouts`, `markPayoutPaid` throw `GoneException(PAY_VIA_PAYROLL)`.
- [ ] **Step 2: Run** `npx jest src/modules/commission src/modules/sales/services/sale-void.service.spec.ts src/modules/contracts/services/contract-commission.util.spec.ts src/modules/trade-in` · Expected: FAIL.
- [ ] **Step 3: Implement**; G4's `CLAWABLE_COMMISSION_STATUSES` check goes away, G4b stays; controller decorators untouched (manifest surfaces unchanged).
- [ ] **Step 4: Run** the same jest set + `bash tools/test-db-vitest.sh src/modules/sales/__tests__/sale-void.integration.spec.ts` · Expected: PASS.
- [ ] **Step 5: Commit** `feat(commission): one clawback helper; paid commissions clawed back instead of blocking; old pay paths 410`.

### Task 4: `PayrollSystemRowsService.compute`

**Files:**
- Create: `apps/api/src/modules/expense-documents/payroll-system/payroll-system-rows.service.ts`, `.../payroll-system/payroll-system.types.ts`
- Modify: `apps/api/src/modules/expense-documents/expense-documents.module.ts` (provider; get `AttendanceSettingsService` without a circular import — export it from the attendance module or provide it directly)
- Test: `apps/api/src/modules/expense-documents/__tests__/payroll-system-rows.integration.spec.ts` (covered by the `EXPDOC_FILES` CI glob, `deploy-gcp.yml:282`)

**Interfaces — Consumes:** Task 2, Task 3 `isCoveredByPayout`. **Produces** (`payroll-system.types.ts`):
```ts
export interface SystemRowsQuery { branchId: string; entityScope: 'SHOP' | 'FINANCE'; payrollPeriod: string; userIds: string[]; excludeDocumentId?: string; now: Date }
export interface SystemIncomeRow { source: Exclude<PayrollIncomeSource, 'MANUAL'>; accountCode: string; name: string; quantity: string | null; rate: string | null; multiplier: string | null; amount: string; isTaxable: true }
export interface SystemDeductionRow { source: 'COMMISSION_CLAWBACK'; accountCode: string; name: string; amount: string }
export interface CommissionItemOut { salesCommissionId: string; kind: 'PAY' | 'CLAWBACK'; accountCode: string; amount: string; reference: string; date: string; reason: string | null; carriedForward: string | null }
export interface ReviewDay { dayId: string; date: string; branchId: string; flags: string[]; blocking: boolean }
export type SystemWarning =
  | { code: 'NOT_MONTHLY_OR_NO_BASE'; otHours: string } | { code: 'IN_OTHER_DOCUMENT'; documentId: string; documentNumber: string; branchName: string; status: string }
  | { code: 'COMMISSION_FINANCE_BLOCKED'; count: number } | { code: 'CLAWBACK_CARRIED'; amount: string } | { code: 'NO_PIN' } | { code: 'NOT_YET_CLOSABLE'; closableAt: string };
export interface AttendanceSummarySnapshot extends Omit<MonthSummary, 'otHours'> { otHours: string; holidayHours: string; holidayOtHours: string; holidayWorkedDays: number; reviewCount: number }
export interface SystemRowsForUser { userId: string; autoOtEligible: boolean; systemIncome: SystemIncomeRow[]; systemDeductions: SystemDeductionRow[]; commissionItems: CommissionItemOut[]; attendanceSummary: AttendanceSummarySnapshot; review: ReviewDay[]; warnings: SystemWarning[] }
export interface SystemRowsResult { attendanceAccountCodes: string[]; rows: SystemRowsForUser[] }
compute(client: Prisma.TransactionClient | PrismaService, q: SystemRowsQuery): Promise<SystemRowsResult>;
```
Rules (spec §5, §6, §6ข + decisions): attendance rows of the user in `[dbDate(bangkokMidnight(y,m0,1)), dbDate(bangkokMidnight(y,m0+1,1)))`, **all branches**, `deletedAt: null`; rules via `AttendanceSettingsService.getRules(day.branchId)`. If another live PAYROLL (`id ≠ excludeDocumentId`, not deleted, status ≠ `VOIDED`, same period) has a line for this user with any `ATTENDANCE_*` income row → no attendance rows + `IN_OTHER_DOCUMENT`. Not eligible → no attendance rows + `NOT_MONTHLY_OR_NO_BASE` (weekday + holiday OT hours). Commission (SHOP only): `salespersonId = user`, `status = APPROVED`, `period ≤ payrollPeriod`, `deletedAt null`, no live PAY item in another document, not covered by a non-DRAFT/CANCELLED legacy payout; the PAY item stores the role's current `accountCode`. FINANCE with such rows → `COMMISSION_FINANCE_BLOCKED`. Clawback (SHOP only): `salespersonId = user`, `paidAt` set, status `CLAWED_BACK`/`PARTIALLY_CLAWED_BACK`, `clawbackAmount > 0`; outstanding = `clawbackAmount − Σ live CLAWBACK items in other documents`; order `[clawbackAt asc, id asc]`; deduct up to this period's PAY total; remainder → `carriedForward` + `CLAWBACK_CARRIED`; each CLAWBACK item and its deduction row use the `accountCode` of the commission's posted PAY item (group deduction rows by account). Review = days whose flags hit `DEVICE_CONFLICT, MISSING_OUT, DEVICE_UNAVAILABLE, AFTER_PIN_LOCKOUT, LOCATION_CHANGED, NETWORK_CHANGED, CORRECTED`, `blocking` for `DEVICE_CONFLICT`. No PIN and no rows → `NO_PIN`. `now < payrollCutoff` → `NOT_YET_CLOSABLE`. `attendanceAccountCodes` = the scope's OT + holiday account codes.

- [ ] **Step 1: Write the failing integration tests** (each creates its own users/branches/profiles/commissions; `seedShopCoa` + `seedFinanceCoa`; `roles.onModuleInit()`): (a) salary 15,000, weekday days with otHours 1.5, 1.5, 1.5, 1.5, 0.5 + DAY_OFF 10:00–21:00 → rows `609.38` (not 609.40) / `500.00` / `375.00` with quantity, rate `93.7500`/`62.5000`/`187.5000`, multiplier; (b) days at two branches all counted; (c) DAILY user → no rows + warning with hours; (d) FINANCE scope → no commission rows + `COMMISSION_FINANCE_BLOCKED`; (e) APPROVED `2026-09` and `2026-10` pulled for `2026-10`; PENDING / CLAWED_BACK / `2026-11` excluded; (f) commission with a live PAY item elsewhere excluded; (g) clawbacks 800 + 600 vs commission 1,000 → items 800 / 200, carried 400, deduction 1,000.00; (h) DEVICE_CONFLICT review is blocking; (i) before cutoff → `NOT_YET_CLOSABLE`; (j) two live PAY items for one commission → P2002; (k) document A (branch 1) holds U's attendance rows → compute for branch 2 returns no ATTENDANCE_* rows + `IN_OTHER_DOCUMENT` with A's number, and a VOIDED or soft-deleted A does not block; (l) registry salary 0 → `NOT_MONTHLY_OR_NO_BASE`.
- [ ] **Step 2: Run** `bash tools/test-db-vitest.sh src/modules/expense-documents/__tests__/payroll-system-rows.integration.spec.ts` · Expected: FAIL.
- [ ] **Step 3: Implement** (batched by `userIds`, Decimal only).
- [ ] **Step 4: Run** the spec · Expected: PASS.
- [ ] **Step 5: Commit** `feat(payroll): compute OT, holiday, commission and clawback rows`.

### Task 5: Prefill (preview) endpoint

**Files:**
- Create: `apps/api/src/modules/expense-documents/dto/payroll-prefill.dto.ts`
- Modify: `apps/api/src/modules/expense-documents/expense-documents.controller.ts` (next to `createPayroll` 58-65, before `:id` routes), `expense-documents.service.ts` facade, `employee-access/access-policy.manifest.json`
- Test: `apps/api/src/modules/expense-documents/__tests__/payroll-prefill.controller.spec.ts`

**Interfaces — Produces:** `POST /expense-documents/payroll/prefill`, body `PayrollPrefillDto { @IsString() branchId; @IsIn(['SHOP','FINANCE']) entityScope; @Matches(/^(20\d{2})-(0[1-9]|1[0-2])$/) payrollPeriod; @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @IsString({ each: true }) userIds; @IsOptional() @IsString() documentId }` → `{ payrollPeriod; closableAt: string; attendanceAccountCodes: string[]; rows: SystemRowsForUser[] }`. Method `payrollPrefill`, `@Roles('OWNER','BRANCH_MANAGER','FINANCE_MANAGER','ACCOUNTANT')`; non-cross-branch users must match `branchId` (as `createPayroll:433`). Manifest: `staff`, `expenses.create`, `domain`, `resolved-source`, `resolution: "collection"`.

- [ ] **Step 1: Write the failing test:** roles metadata; `plainToInstance` + `validate` with whitelist keeps every field, accepts `branch-001`/`user-001`, rejects period `2026-13`, empty or 201 `userIds`; BM of another branch → 403; `documentId` passed as `excludeDocumentId`.
- [ ] **Step 2: Run** · Expected: FAIL.
- [ ] **Step 3: Implement** DTO, controller, facade, manifest entry.
- [ ] **Step 4: Run** the spec + `node tools/check-access-coverage.mjs` · Expected: PASS · 0 errors.
- [ ] **Step 5: Commit** `feat(payroll): prefill preview endpoint`.

### Task 6: Save path owns system rows

**Files:**
- Modify: `apps/api/src/modules/expense-documents/services/expense-document-create.service.ts` (`createPayroll` 427-506, `updatePayroll` 509-616, `preparePayrollInput` 624-815 incl. resigned filter 697-718), `services/expense-line-data.ts` (`payrollLineCreateData` 42-56), `services/expense-document-query.service.ts` (`findOne` include 619-631), `services/expense-document-lifecycle.service.ts` (`softDelete` 225-241), `apps/api/src/modules/trash/trash-registry.ts` (expense_document `check` 197-216), `__tests__/payroll-shop-flow.integration.spec.ts` (`beforeAll` 117-122: upsert its own OWNER user like `e2e/applycreditbalance-partial.e2e-spec.ts:258`)
- Test: `apps/api/src/modules/expense-documents/__tests__/payroll-save-system-rows.integration.spec.ts`; update `payroll.service.spec.ts`, `payroll-update.service.spec.ts`

**Interfaces — Consumes:** `compute` (Task 4). **Produces:** stored lines carry `lineNo` (payload order), `systemPulledAt`, `attendanceSummary`, system rows and `commissionItems`; `findOne` returns lines ordered `[{ lineNo: 'asc' }, { createdAt: 'asc' }]` with `commissionItems: { where: { releasedAt: null }, include: { salesCommission: { select: { id, period, commissionAmount, clawbackReason, createdAt, contract: { select: { contractNumber } }, sale: { select: { saleNumber } } } } } }`.

Behavior: client rows are MANUAL only (the DTO has no `source`; V17 whitelist + V19 still run, so a hand-typed `S51-1101` income is rejected). Inside the existing tx after the `payroll:` lock, take `payrollAttendanceLockKey` then `payrollClawbackLockKey` for all linked users (sorted), call `compute` (`excludeDocumentId` = this document on update), append system rows and items, set `systemPulledAt = now`, store `attendanceSummary`, recompute `netPaid` with system rows (reject < 0 with the existing message). Reject `MANUAL_OT_DUPLICATE` when an eligible line has a MANUAL income row on any of `attendanceAccountCodes`. `preparePayrollInput` takes the period and accepts `resignedDate ≥ bangkokMidnight(y, m0, 1)` (decision 10). `totalAmount = Σ(base + Σ income)` (gross, spec §8); `subtotal` stays Σ base — readers that now see gross (approval/attachment thresholds in `post()`, `getDailySummary.grandTotal`, voucher PDF "มูลค่ารวม", trash subtitle) are acceptable. P2002 on the partial index → `ConflictException(COMMISSION_TAKEN)`. `softDelete` of a DRAFT PAYROLL sets `releasedAt = now` on its items in the same tx; the trash `check` refuses restoring a PAYROLL whose lines have `systemPulledAt` or any item (`TRASH_RESTORE_PAYROLL`). `PayrollSystemRowsService` is a trailing `@Optional()` constructor parameter (Global Constraints).

- [ ] **Step 1: Write the failing integration tests:** create stores the Task 4 (a) rows, 3 PAY items, `systemPulledAt`, `attendanceSummary` — with no client flag; a free-text line (no `userId`) gets no system rows; `totalAmount` = base + all income; manual `S51-1101` income → 400 (V17); manual `S52-1202` income on an eligible line → 400 `MANUAL_OT_DUPLICATE`, on a DAILY line → accepted; update replaces rows (no duplicates); a second draft with the same commission → 409 `COMMISSION_TAKEN`; one clawback in two drafts of different periods → the second deducts 0 and carries nothing; lines come back in payload order; soft-deleting the first draft frees the commission; restoring it from the trash → refused; an employee with `resignedDate` = last day of the period is accepted, one resigned before the period start is rejected; a recurring-template instantiation (`expense-templates.service.ts:352-364`) gets system rows.
- [ ] **Step 2: Run** `bash tools/test-db-vitest.sh src/modules/expense-documents/__tests__/payroll-save-system-rows.integration.spec.ts` · Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** that spec + `payroll-shop-flow.integration.spec.ts` (now self-seeding) + `npx jest src/modules/expense-documents src/modules/trash` · Expected: PASS (update `totalAmount` expectations to gross).
- [ ] **Step 5: Commit** `feat(payroll): server computes and stores system rows on every save`.

### Task 7: Approve/post gate, commissions paid, void release, send back

**Files:**
- Create: `apps/api/src/modules/expense-documents/payroll-system/payroll-post-gate.service.ts`
- Modify: `services/expense-document-lifecycle.service.ts` (`approve` 586-657 — gate **before** the APPROVED flip at 613-616, whether or not `auto_post_on_approve`; `post` 251-317 → `executePostBody` PAYROLL branch before `payrollTemplate.execute` 493-495, skipped when `approve` already ran it; `voidDocument` 659-908; new `sendBackToDraft`), `services/status-transition.service.ts` (`assertCanSendBack`), `expense-documents.controller.ts` + facade (`@Post(':id/send-back')`, same `@Roles` as `approve`), `services/expense-document-query.service.ts` (`findOne` adds `payrollGate`; trailing `@Optional()`), manifest (`ExpenseDocumentsController.sendBackToDraft`: `expenses.approve`, `record`)
- Test: `apps/api/src/modules/expense-documents/__tests__/payroll-post-gate.integration.spec.ts`

**Interfaces — Consumes:** `compute`, `payrollCutoff`, lock keys. **Produces:**
```ts
assertPostable(tx: Prisma.TransactionClient, documentId: string, now: Date, statusBefore: DocumentStatus): Promise<void>;
inspect(client: Prisma.TransactionClient | PrismaService, documentId: string, now: Date): Promise<PayrollGateView>;
// PayrollGateView = { closableAt: string | null; deviceConflicts: { dayId: string; userId: string; employeeName: string; date: string }[] }
markCommissionsPaid(tx, documentId: string, paidAt: Date): Promise<string[]>;
releaseOnVoid(tx, documentId: string): Promise<string[]>;
sendBackToDraft(id: string, userId: string, role: string): Promise<ExpenseDocument>; // lifecycle
```
`assertPostable` (all linked lines; a line without `systemPulledAt` counts as stored-empty): locks (attendance then clawback, sorted) → (1) cutoff when any line is auto-OT eligible → `ConflictException({ code: 'PAYROLL_CUTOFF', closableAt, message: CUTOFF })` → (2) DEVICE_CONFLICT days of eligible linked users → `{ code: 'PAYROLL_DEVICE_CONFLICT', days, message }` → (3) per line: stored COMMISSION income must equal Σ **live** PAY items and stored COMMISSION_CLAWBACK deductions Σ live CLAWBACK items; recompute and compare multisets of income `(source, accountCode, amount)`, deductions `(source, accountCode, amount)`, live items `(salesCommissionId, kind, accountCode, amount)` with `toFixed(2)` → `{ code: 'PAYROLL_STALE', diffs: { userId, employeeName, label, stored, current }[], message: statusBefore === 'DRAFT' ? STALE_DRAFT : STALE_SEND_BACK }` → (4) another live document holds attendance rows for the same user/period → `OTHER_DOC`. After `payrollTemplate.execute`, `markCommissionsPaid`: each live PAY item's commission `APPROVED → PAID`, `paidAt = documentDate`, `paidAmount = item.amount` (conditional, count 1 else stale). Add `commissionItemIds` to the `POSTED` / `AUTO_POSTED` audit `newValue`.
`releaseOnVoid` (PAYROLL, before the status CAS): refuse `VOID_AFTER_CLAWBACK` when a PAY-item commission has a live CLAWBACK item in another non-VOIDED document; refuse `VOID_PARTIAL_CLAWBACK` when a PAY-item commission is `PARTIALLY_CLAWED_BACK`; PAY items only: PAID → APPROVED (clear `paidAt`, `paidAmount`); full `CLAWED_BACK` with `paidAt` and no live CLAWBACK item → clear `paidAt`, `paidAmount`, `clawbackAmount`; then `releasedAt = now` on **all** items of the document (CLAWBACK items just become outstanding again; their commissions are not touched). Add `releasedCommissionItemIds` to the `EXPENSE_VOIDED` audit.
`sendBackToDraft`: lock `post:${id}`; PAYROLL in `PENDING_APPROVAL` or `APPROVED` (`assertCanSendBack`); `EXPENSE_APPROVE` in branch or creator; CAS to `DRAFT`, `approvedById: null`; audit `SENT_BACK_TO_DRAFT` via `tx.auditLog.create`.

- [ ] **Step 1: Write the failing integration tests** (`vi.useFakeTimers({ toFake: ['Date'] })`): approve at 2026-11-01 17:59 BKK → 409 `PAYROLL_CUTOFF`; with `auto_post_on_approve = false` the same document is still refused at approve and stays `PENDING_APPROVAL`; a DEVICE_CONFLICT day → 409 listing the day; after cutoff: a manager correction adding OT → 409 `PAYROLL_STALE`, diff `1.5 → 2.5 ชม.`, `STALE_SEND_BACK`; registry salary changed → stale; a kiosk OUT at 2026-11-01 01:30 attached to 31 Oct → stale; a pulled commission clawed back by `clawBackCommissions` → stale; a manually inserted COMMISSION income that doesn't match live items → stale; send back → DRAFT → re-save → submit → approve → POSTED, commissions PAID with `paidAmount`; an APPROVED (auto-post off) stale document can be sent back; payroll pays X 1,000 → `applyClawbackForContract` 50% → next period's save deducts 500.00 (Cr the PAY item's account); void of a plain posted document → commissions APPROVED, items released, a new document pulls them; void of the deducting document → the next save deducts again; void of a paying document after a later one deducted → 409 `VOID_AFTER_CLAWBACK`; void after a partial clawback → 409 `VOID_PARTIAL_CLAWBACK`; second branch document with U's attendance rows → `OTHER_DOC`; `findOne` exposes `payrollGate.closableAt` and `deviceConflicts`.
- [ ] **Step 2: Run** `bash tools/test-db-vitest.sh src/modules/expense-documents/__tests__/payroll-post-gate.integration.spec.ts` · Expected: FAIL.
- [ ] **Step 3: Implement**; manifest entry for `sendBackToDraft`; update hand-built lifecycle/query instances only where tests need the gate (the rest use the `@Optional()` default).
- [ ] **Step 4: Run** the spec + all `expense-documents/__tests__/*.integration.spec.ts` + `npx jest src/modules/expense-documents` + `node tools/check-access-coverage.mjs` · Expected: PASS · 0 errors.
- [ ] **Step 5: Commit** `feat(payroll): approve/post gate, commission payment, void release and send-back`.

### Task 8: Lock attendance of a paid month

**Files:**
- Create: `apps/api/src/modules/attendance/attendance-payroll-lock.ts`
- Modify: `apps/api/src/modules/attendance/attendance.service.ts` (`correctDay` load :256-258 and tx :280-300; `setDayKinds` pairs :316 and tx :323-331; `clearConflictFlag` :349-356 — wrap its bare update in `$transaction`; `month()` and `today()` rows)
- Test: `attendance/__tests__/attendance.service.spec.ts` (S21–S25), `attendance/__tests__/attendance.integration.spec.ts` (I9)

**Interfaces — Consumes:** `payrollAttendanceLockKey` (Task 2). **Produces:**
```ts
export function findPaidPayroll(client: Prisma.TransactionClient | PrismaService, userId: string, period: string): Promise<{ documentId: string; number: string } | null>; // line for userId in a POSTED, non-deleted PAYROLL of that period
export function assertNotPaid(client: Prisma.TransactionClient | PrismaService, pairs: { userId: string; workDate: Date }[]): Promise<void>; // ConflictException(ATTENDANCE_PAID)
```
Inside each transaction take the lock keys (sorted, de-duplicated) first, re-read, `assertNotPaid`, then write; audit stays after commit. `month()` / `today()` rows gain `paidDocumentNumber: string | null`. Kiosk punches are untouched (spec §9).

- [ ] **Step 1: Write the failing tests:** S21 `correctDay` on a paid month → 409 with the number; S22 `setDayKinds` with one paid pair → 409, nothing written; S23 `clearConflictFlag` on a paid month → 409; S24 unpaid month unchanged; S25 `month()` sets `paidDocumentNumber`; I9 post a payroll, then `correctDay` → 409 while a kiosk punch for that user still succeeds.
- [ ] **Step 2: Run** `npx jest src/modules/attendance` · Expected: FAIL on S21–S25.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** jest + `bash tools/test-db-vitest.sh src/modules/attendance/__tests__/attendance.integration.spec.ts` · Expected: PASS.
- [ ] **Step 5: Commit** `feat(attendance): paid months are read-only`.

### Task 9: Tax base after clawback

**Files:**
- Modify: `apps/api/src/modules/tax/services/tax-preview.service.ts` (`previewPayrollWHT` ~702, `previewPnd1Annual` ~962)
- Test: create `apps/api/src/modules/expense-documents/__tests__/payroll-tax-base.integration.spec.ts` (self-contained)

**Interfaces — Consumes:** `payrollTaxableGross` (Task 2).

- [ ] **Step 1: Write the failing test:** a POSTED line base 15,000 + commission 1,000 + clawback deduction 1,000 (`COMMISSION_CLAWBACK`) + manual deduction 300 → monthly WHT gross `15000.00`, annual gross includes the same; a line without clawback unchanged.
- [ ] **Step 2: Run** `bash tools/test-db-vitest.sh src/modules/expense-documents/__tests__/payroll-tax-base.integration.spec.ts` · Expected: FAIL.
- [ ] **Step 3: Implement** with `payrollTaxableGross` (select `customDeduction.source`).
- [ ] **Step 4: Run** the spec + `payroll-shop-flow.integration.spec.ts` · Expected: PASS.
- [ ] **Step 5: Commit** `feat(tax): PND1 base nets commission clawbacks`.

### Task 10: Web — payroll form

**Files:**
- Modify: `apps/web/src/components/expense-form-v4/types.ts` (48-92), `PayrollLinesSection.tsx` (copy 88-155, table 384-442, row 492-586, sub-tables 591-809), `ExpenseFormV4.tsx` (edit mapping 192-214, payload 340-398)
- Create: `apps/web/src/components/expense-form-v4/payroll-system/{usePayrollPrefill.ts, PayrollSystemRows.tsx, PayrollReviewPanel.tsx}`
- Test: `components/expense-form-v4/__tests__/PayrollLinesSection.test.tsx` (new cases), `payroll-system/__tests__/PayrollReviewPanel.test.tsx`

**Interfaces — Consumes:** Task 5 response, Task 6 `findOne`. **Produces:** `PayrollCustomIncomeRow.source` / `PayrollCustomDeductionRow.source` (`'MANUAL'` editable), `PayrollLineForm.system?: SystemRowsForUser`.

UI per mockup board 1: button `ดึง OT และค่าคอมงวดนี้` (primary, next to `ดึงข้อมูลงวดล่าสุดมาเติม`) previews for linked users; KPI strip; locked system table (lock icon, `รายได้จากระบบ — แก้ในใบนี้ไม่ได้`, `ชม. × อัตรา`, chips `จากระบบลงเวลา` / `ค่าคอม {n} รายการ`, expandable commission list); locked clawback deduction table with `ยกไปงวดหน้า`; manual sub-tables unchanged; attendance box `สรุปลงเวลา … — ข้อมูลประกอบ ไม่หักเงิน`; column `รายได้พิเศษ`; side panel `วันที่ต้องตรวจ ({n})` (DEVICE_CONFLICT first, destructive chip `เครื่องถูกใช้ซ้อน`) and `คำเตือน ({n})`. Day link `/attendance?tab=today&date=YYYY-MM-DD` rendered only for OWNER, or BRANCH_MANAGER whose branch = the day's `branchId`; otherwise text `ให้เจ้าของหรือผู้จัดการสาขาตรวจที่เมนู ลงเวลา`. On preview, MANUAL rows on `attendanceAccountCodes` of eligible lines are removed with toast `เอาแถว OT ที่กรอกเองออก — ระบบคิดจากลงเวลาให้แล้ว`. Copy previous keeps only `source === 'MANUAL'` rows. Payload sends only MANUAL rows. Edit mode shows stored system rows locked. A note under the table: `ระบบคิด OT และค่าคอมใหม่ทุกครั้งที่บันทึก`.

- [ ] **Step 1: Write the failing tests:** preview fills locked rows (no inputs); payload has no system rows; copy skips system rows; manual OT row on an eligible line removed on preview with the toast; DAILY warning text; blocking day listed first; link hidden for ACCOUNTANT and for a BM of another branch.
- [ ] **Step 2: Run** `cd apps/web && npx vitest run src/components/expense-form-v4` · Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same + `npx eslint` on changed files · Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): preview OT and commissions in the payroll form`.

### Task 11: Web — payroll detail and slip

**Files:**
- Modify: `apps/web/src/components/accounting/InternalControlActionBar.tsx` (props 45-94, buttons 376-413: add optional `approveBlockedReason?: string`, `postBlockedReason?: string`, `extraActions?: ReactNode` — other modules unaffected), `apps/web/src/pages/ExpenseDetailPage.tsx` (type 52-69, mutations 157-235, CSV block 271-303, action bar 380-414), `apps/web/src/pages/PaymentVoucherPage.tsx` (`PayrollSlipLine` 58-80, `PayrollSlipSheet` 399-588, comment 387-388)
- Create: `apps/web/src/pages/expense-detail/PayrollDetailSection.tsx`
- Test: `pages/expense-detail/__tests__/PayrollDetailSection.test.tsx`, `components/accounting/__tests__/InternalControlActionBar.test.tsx` (new props), new cases in `pages/PaymentVoucherPage.test.tsx`

UI per mockup boards 2, 3, 6A: payroll lines table (name, base, OT/holiday, commission, other, SSO, net); `payrollGate.closableAt` in the future → info banner + approve/post blocked reason `ยังไม่ถึงเวลาปิดงวด`; `deviceConflicts` → destructive banner + reason `ติดธง เครื่องถูกใช้ซ้อน {n} วัน`; 409 `PAYROLL_STALE` from approve/post → alert with the diff table and `ส่งกลับเป็นร่าง` (status PENDING_APPROVAL or APPROVED) or `แก้ไข` (DRAFT); `ส่งกลับเป็นร่าง` in `extraActions` for approvers in PENDING_APPROVAL / APPROVED; `แก้ไข` in `extraActions` for a DRAFT PAYROLL, going to the same edit target as the `แก้ไข` item of `ExpensesPage.tsx:389` (`openEdit`) — so `STALE_DRAFT` names a button that exists on this page too; `พิมพ์สลิปเงินเดือน ({n} ใบ)` links to `/expenses/:id/voucher` only when POSTED, otherwise disabled with `ลงบัญชีก่อนจึงพิมพ์สลิปได้`; note `สลิปพิมพ์กระดาษเท่านั้น — ไม่มีส่งทาง LINE หรืออีเมล`. Slip: `ชม. × อัตรา` (rate 2 dp), commission list, clawback rows with `ยกไปงวดหน้า`, attendance box `ข้อมูลประกอบ — ไม่มีผลต่อยอดเงิน`, footer `ใบจ่ายเงินเดือน v2`; non-POSTED → message instead of slips; delete the "Email dispatch deferred" comment.

- [ ] **Step 1: Write the failing tests** for each state (future cutoff, device conflict, stale 409, send-back visibility, `แก้ไข` on DRAFT payroll only, POSTED print link, slip row `6.5 × 93.75 = 609.38`); action bar renders the blocked reason and disables the button.
- [ ] **Step 2: Run** `cd apps/web && npx vitest run src/pages/expense-detail src/components/accounting src/pages/PaymentVoucherPage.test.tsx` · Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same · Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): payroll detail gates, send-back and slip with hours x rate`.

### Task 12: Commissions page, sale void note, attendance lock UI

**Files:**
- Modify (API): `apps/api/src/modules/commission/commission.service.ts` `findAll` (97-130) adds `payrollLink: { documentId, documentNumber, status, kind } | null` (live items), `clawbackOutstanding: string | null` (paid rows only), `salespersonResigned: boolean`
- Modify (web): `apps/web/src/pages/CommissionsPage.tsx` (114, 126, 136-170, 194-358, 455-563), `apps/web/src/lib/status-badges.ts` (`commissionStatusMap` 364-368), `apps/web/src/pages/SalesHistoryPage.tsx` (void mutation :199 + dialog), `pages/attendance/AttendancePage/{index.tsx, components/TodayTab.tsx, components/MonthTab.tsx, components/ScheduleTab.tsx, components/CorrectDayDialog.tsx}`, `hooks/useAttendance.ts` (types 17-84)
- Test: `commission/commission.service.spec.ts` (findAll fields), new `pages/__tests__/CommissionsPage.test.tsx`, new cases in `pages/attendance/AttendancePage/AttendancePage.test.tsx`, `pages/SalesHistoryPage` void test (create if none)

UI per mockup boards 4, 5, 6C: approve uses `api.post`; row `จ่าย`, payout `อนุมัติ`/`จ่ายแล้ว`, `สร้างใบจ่าย` removed; payout tab `ใบจ่ายรายเดือน` + chip `ดูอย่างเดียว`; banner `ค่าคอมไม่มีปุ่มจ่ายแยกแล้ว` — `อนุมัติรายการที่นี่ แล้วระบบดึงเข้าใบเงินเดือนให้เมื่อบันทึกใบ (หน้ารายจ่าย › สร้างเอกสารใหม่ › เงินเดือน (PR)) — ค่าคอมจะเป็น "จ่ายแล้ว" เมื่อใบเงินเดือนลงบัญชี`; labels APPROVED `อนุมัติแล้ว · รอเข้าใบเงินเดือน`, CLAWED_BACK `เรียกคืน`, PARTIALLY_CLAWED_BACK `เรียกคืนบางส่วน`; chip `อยู่ในใบเงินเดือน {เลขที่} · {สถานะ}` / `หักคืนในใบ {เลขที่}` linking to the document; `clawbackOutstanding` → `เรียกคืน — รอหัก {n}`, with `salespersonResigned` → `เรียกคืน — พนักงานลาออก ให้เจ้าของตัดสิน`. Sale void dialog: fixed note `ถ้าค่าคอมของใบนี้จ่ายไปแล้วในเงินเดือน ระบบจะหักคืนในเงินเดือนงวดถัดไปเอง ไม่ต้องทำอะไรเพิ่ม`; success with `paidCommissionClawback` → toast `ค่าคอม {n} บาทที่จ่ายแล้วจะหักในเงินเดือนงวดถัดไป`. Attendance: banner + lock chip `จ่ายเงินเดือนแล้ว` for rows with `paidDocumentNumber`; edit / clear / schedule cells disabled for them; `CorrectDayDialog` shows `ATTENDANCE_PAID`; AttendancePage reads `?tab=&date=`.

- [ ] **Step 1: Write the failing tests** (API fields; approve calls POST; no pay buttons; chips; void note + toast; paid row disabled; deep link opens Today on that date).
- [ ] **Step 2: Run** `npx jest src/modules/commission` + `cd apps/web && npx vitest run src/pages/__tests__/CommissionsPage.test.tsx src/pages/attendance src/pages/SalesHistoryPage` · Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same · Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): commissions via payroll, sale void note, paid-month lock`.

### Task 13: Docs, version, full gates

**Files:**
- Modify: `.claude/rules/accounting.md` (Payroll 939-1013: new subsection "OT / ค่าคอม / หักคืนผ่านใบเงินเดือน (D4)"; commission 2153-2182 incl. :2164; void-sale G4 row :2243 and G4b 2247-2274), `.claude/rules/database.md` (attendance writers :67 + `payroll_commission_items` partial unique note), `.claude/CLAUDE.md` (Important Notes bullet near :369), `apps/web/package.json` version `26.10.62`

- [ ] **Step 1: Write the docs** — the rules as built (sources, always-compute, cutoff, gate order, locks, clawback cap and accounts, 410 paths, decisions 1–11) with file names; no prices, no employee data.
- [ ] **Step 2: Run the full gates:** types (all) · eslint on every changed file · `npx jest src/modules/expense-documents src/modules/attendance src/modules/commission src/modules/sales src/modules/contracts src/modules/trade-in src/modules/tax src/modules/trash src/modules/journal src/modules/settings src/modules/employee-access` · harness: all `expense-documents/__tests__/*.integration.spec.ts`, `attendance/__tests__/attendance.integration.spec.ts`, `sales/__tests__/sale-void.integration.spec.ts` · `cd apps/web && npx vitest run` · `node tools/check-access-coverage.mjs`. Expected: all PASS, 0 coverage errors; counts in the commit body.
- [ ] **Step 3: Commit** `docs(payroll): D4 rules; bump web 26.10.62`.
