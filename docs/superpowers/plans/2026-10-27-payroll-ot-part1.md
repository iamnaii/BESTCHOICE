# Payroll D4 — Part 1: OT / Holiday Pay from Attendance + Gates + Paid-Month Lock + Slip

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every payroll line linked to an employee gets server-computed, locked OT / holiday-work / holiday-OT rows from attendance on every save; submit is possible only after the period's cutoff and re-computes; approve/post is gated (cutoff, device-conflict flag, stale data, other document); a posted month's attendance becomes read-only; the A4 slip shows hours × rate.

**Architecture:** Pure pay math (`payroll-pay.ts`) + one service (`PayrollSystemRowsService.compute`) produce every system row. The save path (`updatePayrollInTx` / create) is the only writer of system rows; submit calls the same writer; the gate recomputes and compares. `PayrollTemplate` is unchanged — system rows are ordinary custom-income rows with a `source`. Part 2 (`2026-10-27-payroll-ot-part2-commission.md`) adds commissions on top of the same seams.

**Tech Stack:** NestJS + Prisma 5 + PostgreSQL (apps/api, jest + vitest Postgres harness), React 18 + react-query + Tailwind/shadcn (apps/web, vitest + RTL).

**Spec:** `docs/superpowers/specs/2026-10-27-payroll-ot-commission-design.md` (D1–D7, §16, §17). Mockup: canvas `https://claude.ai/artifact/HwUwS9UHLVYosge2LbLef1` boards 1, 2, 3, 5, 6A (commission parts of those boards belong to Part 2).

## Global Constraints

- Worktree `/Users/iamnaii/Desktop/App/BESTCHOICE/.claude/worktrees/payroll-ot`, branch `feat/payroll-ot-commission` (based on `feat/attendance-kiosk`, PR #1738 unmerged — retarget to `main` after it merges). `git -C <worktree>`; never bare `git stash`; commit per task; **never push** (repo is public; the owner decides).
- Money is `Prisma.Decimal` end to end; never feed `AttendanceService.month()` numbers (Number) into pay. Compare money as `new Prisma.Decimal(v).toFixed(2)`.
- Hourly base = **`EmployeeProfile.baseSalary`** (registry, full month) ÷ 240. Row amount = `HALF_UP(base × multiplier × hours / 240, 2)`, once per row per person per month (hours summed first). Stored `rate` = `HALF_UP(base × multiplier / 240, 4)`, display only.
- Multipliers: weekday OT 1.5 · holiday work 1 · holiday OT 3. Auto-OT eligible = `employmentType = MONTHLY` **and** `baseSalary > 0`.
- **The server computes system rows for every line with a `userId` on every save** (create, update, template instantiate, submit). The client never sends system rows.
- Accounts: weekday OT role `${prefix}payroll_overtime` (`S52-1202` / `53-1103`); holiday work + holiday OT role `${prefix}payroll_holiday` (new, same defaults). Role → code is read **from `account_role_map` inside the transaction** (same selection as `AccountRoleService`'s cache load), never from the per-instance cache (prod runs up to 10 Cloud Run instances).
- Cutoff = 18:00 Asia/Bangkok on day 1 of the month after the period (`payrollCutoff('2026-10')` = `2026-11-01T11:00:00.000Z`). It applies to **every PAYROLL that has at least one line with a `userId`**, at submit and at approve/post.
- Slips are paper only — no LINE / email path.
- Audit: expense lifecycle keeps its module pattern (`tx.auditLog.create` inside the tx, atomic with the status flip). Attendance keeps `await this.audit.log(...)` after commit. Never call `AuditService.log` inside a `$transaction`.
- Advisory lock order: `post:${docId}` → `payroll:${branchId}:${period}:${scope}` → `payroll-attendance:${userId}:${period}` (users sorted, de-duplicated). Attendance writers take only `payroll-attendance:*`, sorted. (Part 2 appends `payroll-clawback:${userId}`.)
- Non-cross-branch roles (outside `CROSS_BRANCH_ROLES`, `branch-access.util.ts`) may put only employees whose `User.branchId` equals the document branch on a payroll — `NOT_IN_BRANCH` 403 — because the stored `rate` reveals the registry salary, which only OWNER / ACCOUNTANT / FINANCE_MANAGER can read today (`employees.controller.ts:31-32`).
- New constructor dependencies on `ExpenseDocumentCreateService`, `ExpenseDocumentLifecycleService`, `ExpenseDocumentQueryService` are trailing `@Optional()` parameters (9+ hand-built instances). When absent: create/update/submit/approve/post of a PAYROLL with linked lines throw `Error('PayrollSystemRowsService not wired')`; query returns `payrollGate: null`. Never fail open.
- Structured 409 bodies must survive the global `SentryExceptionFilter` (`apps/api/src/filters/sentry-exception.filter.ts:48-63, :89-95` rebuilds 4xx bodies from an allow-list) — Task 5 extends the allow-list.
- Migrations: hand-written SQL in a new folder; never `prisma migrate dev`, never `prisma format`.
- DTO fields carry class-validator decorators (global `ValidationPipe({ whitelist: true })`, `app.setup.ts:172-180`). IDs are `@IsString()` (dev seed ids are not UUIDs).
- Commands (from the worktree): API unit `cd apps/api && NODE_OPTIONS=--max-old-space-size=6144 npx jest <paths> --maxWorkers=2` · Postgres `bash tools/test-db-vitest.sh <specs relative to apps/api>` (migrations only, no seed — specs create their own users/branches) · Web `cd apps/web && npx vitest run <paths>` · Types `NODE_OPTIONS=--max-old-space-size=6144 bash tools/check-types.sh all` · ESLint `cd apps/<app> && npx eslint <files>` — **never** `npm --workspace apps/api run lint` (`--fix`). Coverage `node tools/check-access-coverage.mjs` (no new routes in Part 1 — must stay 0 errors).
- UI: tokens from `index.css`; status = icon + words; `NativeSelect`; Thai `leading-snug`; copy names menus/buttons that exist (ลงเวลา sits under "ขาย" for OWNER and "ภาพรวม" for BM — say "เมนู ลงเวลา"; payroll is created at หน้ารายจ่าย › `สร้างเอกสารใหม่` › `เงินเดือน (PR)`).

### Exact copy (verbatim)

| Key | Thai text |
|---|---|
| `SUBMIT_CUTOFF` | `ส่งขออนุมัติได้ตั้งแต่ {วันที่ไทยสั้น} 18:00 — รอให้ข้อมูลลงเวลาของเดือนนี้ครบก่อน ระหว่างนี้บันทึกร่างไว้ได้` |
| `POST_CUTOFF` | `ลงบัญชีได้ตั้งแต่ {วันที่ไทยสั้น} 18:00 — รอให้ข้อมูลลงเวลาของเดือนนี้ครบก่อน` |
| `STALE` | `ยังไม่ได้ลงบัญชี — ข้อมูลลงเวลาเปลี่ยนหลังบันทึกใบ ให้ผู้ทำเงินเดือนกด "แก้ไข" แล้วบันทึกใบอีกครั้ง (ระบบคิดยอดใหม่ให้) ตรวจยอด แล้วส่งขออนุมัติอีกครั้ง` |
| `DEVICE_CONFLICT` | `อนุมัติไม่ได้ — มีวันที่ติดธง เครื่องถูกใช้ซ้อน {n} วัน ({ชื่อ · วันที่}, …) ให้เจ้าของตรวจที่เมนู ลงเวลา แล้วกด "ตรวจแล้ว ล้างธง"` |
| `OTHER_DOC` | `OT ของ {ชื่อ} เดือนนี้อยู่ในใบ {เลขที่} แล้ว — เอาออกจากใบใดใบหนึ่งก่อน` |
| `MANUAL_OT_DUPLICATE` | `{ชื่อ} มีแถว OT ที่กรอกเองซ้ำกับ OT จากระบบลงเวลา — ลบแถวนั้น หรือติ๊ก "รายการปรับปรุงงวดก่อน" ถ้าเป็นการแก้ OT ของเดือนก่อน` |
| `NOT_IN_BRANCH` | `{ชื่อ} ไม่ใช่พนักงานของสาขานี้ — ให้เจ้าของหรือฝ่ายบัญชีทำใบเงินเดือนนี้` |
| `ATTENDANCE_PAID` | `เดือนนี้จ่ายเงินเดือนแล้ว (ใบ {เลขที่}) — แก้ไม่ได้ ถ้าต้องปรับ ให้ใส่แถว "รายการปรับปรุงงวดก่อน" (จ่ายเพิ่ม) หรือรายการหัก (หักคืน) ในใบเงินเดือนงวดถัดไป` |
| `TRASH_RESTORE_PAYROLL` | `กู้คืนใบเงินเดือนไม่ได้ — ให้สร้างใบใหม่ที่หน้ารายจ่าย › สร้างเอกสารใหม่ › เงินเดือน (PR)` |
| Todo line (paid month flagged) | `วันที่ติดธงอยู่ในเดือนที่จ่ายเงินเดือนแล้ว (ใบ {เลขที่}) — ถ้าตอกแทนกันจริง ให้ใส่รายการหักในใบเงินเดือนงวดถัดไป` |
| warning `NOT_MONTHLY_OR_NO_BASE` | `พนักงานรายวัน/สัญญาจ้าง หรือไม่มีเงินเดือนในทะเบียน — ระบบไม่คิด OT ให้ ลงเวลาเดือนนี้มี OT {h} ชม. กรอกในรายได้พิเศษเอง` |
| row names | `OT วันทำงาน (1.5 เท่า)` · `ทำงานวันหยุด (1 เท่า)` · `OT วันหยุด (3 เท่า)` |

### Decisions (settled here; owner reviews the list)

1. **Holiday break, no cliff:** paid minutes = `overlap < 300 ? overlap : max(overlap − 60, 299)` → 15/45 rounding → cap 8 h.
2. **Holiday OT recomputed with today's rules:** on `DAY_OFF` / `SHOP_CLOSED`, holiday hours and holiday OT both come from today's `getRules(day.branchId)` (`computeDaySummary` + `holidayWorkHours`) so an hour is never paid twice or dropped after a rule change; the attendance page's stored OT for that day can differ.
3. **Submit only after the cutoff, and submit recomputes** (owner OK 27/10); approve/post re-check. Applies to every PAYROLL with a linked line (an all-DAILY payroll posted mid-month would otherwise lock the rest of the month).
4. **Always compute on save**; the form button is `บันทึกร่าง + คิดยอด` (owner OK §17 — saves the draft, stays in edit mode). Review days and warnings are stored per line (`systemNotes`) so the approver sees them.
5. **Manual OT on an eligible line is rejected** unless the row is ticked `รายการปรับปรุงงวดก่อน` (source `ADJUSTMENT`) — the fix path for underpaid OT of a locked month.
6. **Send back = "แก้ไข":** `updatePayroll` accepts a PAYROLL in `PENDING_APPROVAL` or `APPROVED` and resets it to `DRAFT` (audit `SENT_BACK_TO_DRAFT`); no new route.
7. **Trash restore of any PAYROLL is refused** (also closes a duplicate-period hole: delete A, create B for the same period, restore A).
8. **Final-month resignees:** payroll accepts profiles whose `resignedDate` ≥ the first day of the payroll period.
9. **Clearing the device-conflict flag stays allowed on paid months** (flags don't change pay); only `correctDay` / `setDayKinds` are locked. `lockForConflict` adds the payroll number to its owner Todo when it flags a paid month.

## Review Focus

1. **One person, two branches, one month** — OT lands once (first document saved); the other shows `IN_OTHER_DOCUMENT`; both can't post. (Task 3 (k), Task 5.)
2. **Overnight punch-out on the last day** (31 Oct 19:00 → 1 Nov 01:30) — submit before 18:00 on 1 Nov refused; a submit at 18:01 contains the OUT; a manager correction after submit → approve refused as stale. (Task 5.)
3. **Registry salary / employment type changed between submit and approve** → stale with a diff. (Task 5.)
4. **Auto-post off** — approve gates before the flip; a later `post()` of the APPROVED document re-runs the gate. (Task 5.)
5. **Structured 409 over HTTP** — the browser gets `code`, `diffs`, `closableAt`, `days`. (Task 5 HTTP test.)

---

### Task 1: Schema, migration, holiday roles

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (`PayrollLine` 5046-5074, `PayrollCustomIncome` 5080-5097)
- Create: `apps/api/prisma/migrations/20261106000000_payroll_ot_part1/migration.sql`
- Modify: `apps/api/src/modules/journal/account-role.service.ts` (`REQUIRED_ROLES` 44-71), `apps/api/src/modules/settings/role-map-validation.service.ts` (54-60), `apps/api/src/modules/journal/account-role.service.spec.ts` (`requiredRows` 121-145)
- Test: `apps/api/src/modules/expense-documents/__tests__/payroll-ot-schema.spec.ts`

**Interfaces — Produces:** `enum PayrollIncomeSource { MANUAL ADJUSTMENT ATTENDANCE_OT ATTENDANCE_HOLIDAY ATTENDANCE_HOLIDAY_OT }`; `PayrollCustomIncome.source @default(MANUAL)`, `quantity Decimal(6,1)?`, `rate Decimal(12,4)?`, `multiplier Decimal(3,1)?`; `PayrollLine.lineNo Int @default(0)`, `systemPulledAt DateTime?`, `attendanceSummary Json?`, `systemNotes Json?`; roles `shop_payroll_holiday` → `S52-1202`, `payroll_holiday` → `53-1103`.

- [ ] **Step 0:** `npm ci` at the worktree root, then `cd apps/api && npx prisma generate && npx prisma generate --schema=prisma-finance/schema.prisma` (the worktree has no `node_modules`; generating from the shared checkout would overwrite its client). Expected: both succeed.
- [ ] **Step 1: Failing test** (pattern `attendance/__tests__/attendance-schema.spec.ts`, `Prisma.dmmf`): enum values exactly as above; new fields with defaults/optionality; `REQUIRED_ROLES` has both holiday roles.
- [ ] **Step 2: Run** `npx jest src/modules/expense-documents/__tests__/payroll-ot-schema.spec.ts` · Expected: FAIL.
- [ ] **Step 3:** Edit the schema by hand (snake_case `@map`). `migration.sql`: `CREATE TYPE`, `ALTER TABLE` adds, two role rows with the column list and `ON CONFLICT` of `migrations/20260990000000_payroll_shop_side/migration.sql:31-40`. Add roles to `REQUIRED_ROLES`, `'Dr'` in role-map validation, and the spec fixture. Re-run both `prisma generate`.
- [ ] **Step 4: Run** the schema spec + `npx jest src/modules/journal/account-role.service.spec.ts src/modules/settings` · Expected: PASS. Then `bash tools/test-db-vitest.sh src/modules/attendance/__tests__/attendance.integration.spec.ts` · Expected: migrations apply, 10/10.
- [ ] **Step 5: Commit** `feat(payroll): schema for attendance system rows and holiday roles`.

### Task 2: Pure pay math + shared month summary

**Files:**
- Create: `apps/api/src/modules/expense-documents/payroll-system/payroll-pay.ts`
- Modify: `apps/api/src/modules/attendance/attendance-rules.ts`, `apps/api/src/modules/attendance/attendance.service.ts` (`summarize` 103-115, `cellOf` 128-139 call the extracted function)
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
export function payrollAttendanceLockKey(userId: string, period: string): string; // 'payroll-attendance:<userId>:<YYYY-MM>'
export function isAutoOtEligible(p: { employmentType: EmploymentType; baseSalary: Prisma.Decimal | null } | null): boolean;
export function summarizeAttendanceMonth(/* inputs month() already uses */): MonthSummary; // in attendance-rules.ts; output = existing MonthSummary (attendance.service.ts:67-74)
```
Rules: weekday OT = Σ stored `otHours` of `WORK` and `LEAVE_*` days with a clock-in; `DAY_OFF` / `SHOP_CLOSED` with a clock-in: `holidayHours += holidayWorkHours(rulesFor(b))`, `holidayOtHours += computeDaySummary({…, rules: rulesFor(b)}).otHours`. `holidayWorkHours` = overlap of `[clockIn, clockOut]` and `[workDate+workStart, workDate+workEnd]` (floored minutes) → decision 1 → `roundOtMinutes` → cap 8; no clock-out → 0.

- [ ] **Step 1: Failing tests:** `systemIncomeAmount(15000,1.5,6.5)=609.38` · `(15000,1,8)=500.00` · `(15000,3,2)=375.00` · `(16500,1.5,1.5)=154.69` · `displayRate(15000,1.5)=93.7500` · `(16500,1.5)=103.1250`; three WORK days of otHours 0.5 → `monthPayHours().otHours = 1.5` → `140.63` (per-day rounding gives 140.64); `holidayWorkHours` (rules 10:00–19:00): 13:00–21:00 → 5 · 10:00–21:00 → 8 · 09:00–12:10 → 2 · 10:00–14:59 → 5 · 10:00–15:00 → 5 · 10:00–16:00 → 5 · 10:00–17:00 → 6 · no clock-out → 0 · monotonic over every minute 10:01–19:00; holiday 13:00–21:00 with stored otHours 2 and current rules 10:00–20:00 → holiday 6 / holiday OT 1; `payrollCutoff('2026-10')` → `2026-11-01T11:00:00.000Z`, `('2026-12')` → `2027-01-01T11:00:00.000Z`; `isAutoOtEligible` false for DAILY, null salary, salary 0; lock key exact string.
- [ ] **Step 2: Run** `npx jest src/modules/expense-documents/payroll-system` · Expected: FAIL.
- [ ] **Step 3: Implement** (Decimal `ROUND_HALF_UP`; cutoff = `bangkokMidnight(y, m0 + 1, 1)` + 18 h); extract `summarizeAttendanceMonth` unchanged and call it from `month()`.
- [ ] **Step 4: Run** the spec + `npx jest src/modules/attendance` · Expected: PASS.
- [ ] **Step 5: Commit** `feat(payroll): pay math for OT, holiday work and cutoff`.

### Task 3: `PayrollSystemRowsService.compute` (attendance)

**Files:**
- Create: `apps/api/src/modules/expense-documents/payroll-system/{payroll-system-rows.service.ts, payroll-system.types.ts, role-codes.ts}`
- Modify: `apps/api/src/modules/expense-documents/expense-documents.module.ts` (provider; obtain `AttendanceSettingsService` without a circular import)
- Test: `apps/api/src/modules/expense-documents/__tests__/payroll-system-rows.integration.spec.ts` (CI glob `EXPDOC_FILES`, `deploy-gcp.yml:282`)

**Interfaces — Produces:**
```ts
export interface SystemRowsQuery { branchId: string; entityScope: 'SHOP' | 'FINANCE'; payrollPeriod: string; userIds: string[]; excludeDocumentId?: string; now: Date }
export interface SystemIncomeRow { source: 'ATTENDANCE_OT' | 'ATTENDANCE_HOLIDAY' | 'ATTENDANCE_HOLIDAY_OT'; accountCode: string; name: string; quantity: string | null; rate: string | null; multiplier: string | null; amount: string; isTaxable: true } // attendance rows always fill quantity/rate/multiplier; Part 2's COMMISSION row leaves them null — every consumer (table, slip, diff) must handle null
export interface StaleDiff { userId: string; employeeName: string; label: string; stored: { amount: string; hours: string | null }; current: { amount: string; hours: string | null } }
export interface ReviewDay { dayId: string; date: string; branchId: string; flags: string[]; blocking: boolean }
export type SystemWarning = { code: 'NOT_MONTHLY_OR_NO_BASE'; otHours: string } | { code: 'IN_OTHER_DOCUMENT'; documentId: string; documentNumber: string; branchName: string; status: string } | { code: 'NO_PIN' } | { code: 'NOT_YET_CLOSABLE'; closableAt: string };
export interface AttendanceSummarySnapshot extends Omit<MonthSummary, 'otHours'> { otHours: string; holidayHours: string; holidayOtHours: string; holidayWorkedDays: number; reviewCount: number }
export interface SystemNotes { review: ReviewDay[]; warnings: SystemWarning[] }
export interface SystemRowsForUser { userId: string; autoOtEligible: boolean; systemIncome: SystemIncomeRow[]; attendanceSummary: AttendanceSummarySnapshot; notes: SystemNotes }
export interface SystemRowsResult { attendanceAccountCodes: string[]; rows: SystemRowsForUser[] }
// role-codes.ts
export function resolveRoleCodes(client: Prisma.TransactionClient | PrismaService, roles: string[]): Promise<Record<string, string>>; // throws BadRequest naming the missing role
// service
compute(client: Prisma.TransactionClient | PrismaService, q: SystemRowsQuery): Promise<SystemRowsResult>;
```
Rules: attendance rows of the user in `[dbDate(bangkokMidnight(y,m0,1)), dbDate(bangkokMidnight(y,m0+1,1)))`, **all branches**, `deletedAt: null`; rules via `AttendanceSettingsService.getRules(day.branchId)`. Another live PAYROLL (`id ≠ excludeDocumentId`, not deleted, status ≠ `VOIDED`, same period) with a line for this user holding any `ATTENDANCE_*` row → no `ATTENDANCE_*` rows + `IN_OTHER_DOCUMENT`. Not eligible → no `ATTENDANCE_*` rows + `NOT_MONTHLY_OR_NO_BASE` (weekday + holiday OT hours). (These exits skip **attendance rows only** — Part 2 computes commissions for every linked SHOP line regardless.) Review = days whose flags hit `DEVICE_CONFLICT, MISSING_OUT, DEVICE_UNAVAILABLE, AFTER_PIN_LOCKOUT, LOCATION_CHANGED, NETWORK_CHANGED, CORRECTED`; `blocking` = `DEVICE_CONFLICT`. No PIN and no attendance rows in the period → `NO_PIN`. `now < payrollCutoff` → `NOT_YET_CLOSABLE`. Accounts via `resolveRoleCodes` (same active-row/priority selection as `AccountRoleService`'s cache load).

- [ ] **Step 1: Failing integration tests** (own users/branches/profiles; `seedShopCoa` + `seedFinanceCoa`; `roles.onModuleInit()`): (a) salary 15,000, weekday otHours 1.5, 1.5, 1.5, 1.5, 0.5 + DAY_OFF 10:00–21:00 → `609.38` (not 609.40) / `500.00` / `375.00`, quantity, rate `93.7500`/`62.5000`/`187.5000`, multiplier; (b) days at two branches all counted; (c) DAILY → no rows + warning with hours; (h) DEVICE_CONFLICT review blocking; (i) before cutoff → `NOT_YET_CLOSABLE`; (k) document A (branch 1) holds U's attendance rows → compute for branch 2 → no rows + `IN_OTHER_DOCUMENT` with A's number; VOIDED or soft-deleted A does not block; (l) salary 0 → `NOT_MONTHLY_OR_NO_BASE`; (m) `account_role_map` updated in the DB without `invalidate()` → compute uses the new code.
- [ ] **Step 2: Run** `bash tools/test-db-vitest.sh src/modules/expense-documents/__tests__/payroll-system-rows.integration.spec.ts` · Expected: FAIL.
- [ ] **Step 3: Implement** (batched by `userIds`, Decimal only).
- [ ] **Step 4: Run** · Expected: PASS.
- [ ] **Step 5: Commit** `feat(payroll): compute OT and holiday rows from attendance`.

### Task 4: Save path owns system rows; send back via edit

**Files:**
- Modify: `apps/api/src/modules/expense-documents/services/expense-document-create.service.ts` (`createPayroll` 427-506, `updatePayroll` 509-616 → extract `updatePayrollInTx`, `preparePayrollInput` 624-815 incl. resigned filter 697-718 and V18 call 739-773), `services/expense-line-data.ts` (42-56), `services/payroll-custom.service.ts` (`getMeta` 65-79 adds `attendanceAccountCodes`), `dto/create-payroll.dto.ts` (`PayrollCustomIncomeInput` 22-40 adds `@IsOptional() @IsBoolean() isAdjustment?`), `services/expense-document-query.service.ts` (`findOne` include 619-631), `services/expense-document-lifecycle.service.ts` (`softDelete` 225-241 unchanged; `findOne` consumers), `apps/api/src/modules/trash/trash-registry.ts` (expense_document `check` 197-216), `__tests__/payroll-shop-flow.integration.spec.ts` (`beforeAll` 117-122: upsert its own OWNER user, pattern `e2e/applycreditbalance-partial.e2e-spec.ts:258`)
- Test: `apps/api/src/modules/expense-documents/__tests__/payroll-save-system-rows.integration.spec.ts`; update `payroll.service.spec.ts`, `payroll-update.service.spec.ts`, `create-payroll.dto.spec.ts`

**Interfaces — Consumes:** `compute`. **Produces:** `updatePayrollInTx(tx, id: string, dto: UpdatePayrollDto, user: { id: string; branchId?: string | null; role?: string }, now: Date): Promise<ExpenseDocument>` (used by PATCH and by Task 5 submit); stored lines carry `lineNo`, `systemPulledAt`, `attendanceSummary` (now also `autoOtEligible: boolean`), `systemNotes` (= compute's `notes`), system rows; `findOne` lines ordered `[{ lineNo: 'asc' }, { createdAt: 'asc' }]`; `GET payroll/meta` returns `attendanceAccountCodes` via `resolveRoleCodes(this.prisma, [overtime, holiday role])` (not the per-instance cache).

Behavior: client rows are MANUAL (or ADJUSTMENT when `isAdjustment`); V17 + V19 run on them. Non-cross-branch user + linked employee whose `User.branchId ≠ dto.branchId` → 403 `NOT_IN_BRANCH`. Inside the tx after the `payroll:` lock: `payroll-attendance` locks (sorted) for linked users → `compute` (`excludeDocumentId` on update) → append rows → `systemPulledAt = now`, `attendanceSummary`, `systemNotes` → recompute each line's `netPaid` (base + all income − sso − wht − all deductions) and the document's `netPayment` (Σ netPaid) — `PayrollTemplate` credits cash with Σ line `netPaid` (`payroll.template.ts:108-111, 213-218`) → **V18 and `netPaid ≥ 0` run on these merged values** (move V18 after the merge). Eligible line with a MANUAL (not ADJUSTMENT) row on `attendanceAccountCodes` → 400 `MANUAL_OT_DUPLICATE`. `preparePayrollInput` takes the period: accept `resignedDate ≥ bangkokMidnight(y, m0, 1)`. `totalAmount = Σ(base + Σ income)`; `subtotal` Σ base. `updatePayroll` accepts PAYROLL in `DRAFT`, `PENDING_APPROVAL`, `APPROVED` (still under `post:${id}`); non-DRAFT → status `DRAFT`, `approvedById null`, `tx.auditLog.create` `SENT_BACK_TO_DRAFT`. Trash `check` refuses every PAYROLL (`TRASH_RESTORE_PAYROLL`). `PayrollSystemRowsService` is a trailing `@Optional()` parameter.

- [ ] **Step 1: Failing integration tests:** create stores Task 3 (a) rows + notes + `systemPulledAt` with no client flag, and the line's `netPaid` and the document's `netPayment` include the OT; free-text line gets none; `totalAmount` gross; manual `S52-1202` on an eligible line → 400 `MANUAL_OT_DUPLICATE`, same row with `isAdjustment` → accepted (source ADJUSTMENT), on a DAILY line → accepted; a manual deduction that fits only after OT (base 9,000 + OT 2,000, deduction 10,000) → accepted; update replaces system rows; lines return in payload order; BM with another branch's employee → 403 `NOT_IN_BRANCH`; PATCH of a PENDING_APPROVAL payroll → DRAFT + `SENT_BACK_TO_DRAFT` audit; resigned on the last day of the period accepted, before the period start rejected; template instantiation (`expense-templates.service.ts:352-364`) gets rows; trash restore of a PAYROLL → refused; `GET payroll/meta?scope=SHOP` has `attendanceAccountCodes: ['S52-1202']`; DTO `validate()` keeps `isAdjustment`.
- [ ] **Step 2: Run** `bash tools/test-db-vitest.sh src/modules/expense-documents/__tests__/payroll-save-system-rows.integration.spec.ts` · Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** that spec + `payroll-shop-flow.integration.spec.ts` + `npx jest src/modules/expense-documents src/modules/trash` · Expected: PASS (update `totalAmount` expectations).
- [ ] **Step 5: Commit** `feat(payroll): server computes OT rows on every save; edit sends back to draft`.

### Task 5: Submit / approve / post gate + error filter

**Files:**
- Create: `apps/api/src/modules/expense-documents/payroll-system/payroll-post-gate.service.ts`
- Modify: `services/expense-document-lifecycle.service.ts` (constructor 50-72: trailing `@Optional()` `ExpenseDocumentCreateService` for `updatePayrollInTx` and `PayrollPostGateService`; `submitForApproval` 87-147; `approve` 586-657 — gate before the flip at 613-616 regardless of `auto_post_on_approve` (630); `post` 251-317; `executePostBody` 337-567 PAYROLL branch before `payrollTemplate.execute` 493-495 with an explicit `{ payrollGateDone: boolean }` argument — no status-based skip), `services/expense-document-query.service.ts` (`findOne` adds `payrollGate`, trailing `@Optional()`), `apps/api/src/filters/sentry-exception.filter.ts` (allow-list 48-63)
- Test: `apps/api/src/modules/expense-documents/__tests__/payroll-post-gate.integration.spec.ts`; `apps/api/src/filters/sentry-exception.filter.spec.ts` (create if absent); `apps/api/src/modules/expense-documents/__tests__/payroll-gate.http.spec.ts` (boot through `configureApp`, pattern `attendance/__tests__/kiosk-public.http.spec.ts`)

**Interfaces — Consumes:** `compute`, `updatePayrollInTx`, `payrollCutoff`, lock key. **Produces:**
```ts
assertSubmittable(tx: Prisma.TransactionClient, documentId: string, now: Date): Promise<void>;   // cutoff only
assertPostable(tx: Prisma.TransactionClient, documentId: string, now: Date): Promise<void>;
inspect(client: Prisma.TransactionClient | PrismaService, documentId: string, now: Date): Promise<PayrollGateView>;
// PayrollGateView = { closableAt: string | null; deviceConflicts: { dayId: string; userId: string; employeeName: string; date: string }[] }
```
Submit (PAYROLL): after the existing DRAFT check, `assertSubmittable` → 409 `{ code: 'PAYROLL_SUBMIT_CUTOFF', closableAt, message: SUBMIT_CUTOFF }`; then `updatePayrollInTx` with a DTO rebuilt from the stored MANUAL/ADJUSTMENT rows (recompute + re-store), then the existing flip. `assertPostable` on every linked line (no `systemPulledAt` = stored-empty): locks → (1) cutoff → `{ code: 'PAYROLL_CUTOFF', closableAt, message: POST_CUTOFF }` → (2) DEVICE_CONFLICT days of linked users → `{ code: 'PAYROLL_DEVICE_CONFLICT', days, message: DEVICE_CONFLICT }` → (3) recompute and compare multisets of `ATTENDANCE_*` income `(source, accountCode, amount)` → `{ code: 'PAYROLL_STALE', diffs: StaleDiff[], message: STALE }` (amounts always; hours when the row has them) → (4) another live document holds attendance rows for the same user/period → `{ code: 'PAYROLL_OTHER_DOC', documentNumber, message: OTHER_DOC }`. Filter: add `code`, `closableAt`, `days`, `diffs`, `documentNumber` to the `status < 500` allow-list.

- [ ] **Step 1: Failing tests** (`vi.useFakeTimers({ toFake: ['Date'] })`): submit at 2026-11-01 17:59 BKK → 409 `PAYROLL_SUBMIT_CUTOFF`; an all-DAILY payroll → same; submit at 18:01 re-stores rows (a punch added after the save appears); with `approval_enabled = false`, `post()` of a DRAFT before the cutoff → `PAYROLL_CUTOFF`; DEVICE_CONFLICT → 409 listing the day, document stays `PENDING_APPROVAL`; manager correction after submit → `PAYROLL_STALE` diff hours `1.5 → 2.5`, amounts `154.69 → 257.81`; registry salary changed → stale (same hours, different amounts); a kiosk OUT at 2026-11-01 01:30 attached to 31 Oct is recorded before the cutoff and a submit at 18:01 includes it (no stale); auto-post **off**: approve still gated before the flip; approve OK → `APPROVED`; then `correctDay` adds OT → `post()` → `PAYROLL_STALE`; second branch document with U's attendance rows → `PAYROLL_OTHER_DOC`; `findOne` exposes `payrollGate`. Filter spec: `ConflictException({ code, diffs, message })` keeps `code` and `diffs`. HTTP spec: approve route with the gate throwing → JSON has `code` and `diffs`.
- [ ] **Step 2: Run** the three specs · Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them + all `expense-documents/__tests__/*.integration.spec.ts` + `npx jest src/modules/expense-documents src/filters` · Expected: PASS.
- [ ] **Step 5: Commit** `feat(payroll): submit after cutoff, gated approve/post, structured 409s reach the web`.

### Task 6: Lock attendance of a paid month

**Files:**
- Create: `apps/api/src/modules/attendance/attendance-payroll-lock.ts`
- Modify: `apps/api/src/modules/attendance/attendance.service.ts` (`correctDay` 256-300, `setDayKinds` 305-331, `month()`, `today()`; `clearConflictFlag` 349-356 **not** locked), `apps/api/src/modules/attendance/attendance-device.service.ts` (`lockForConflict` 225-260 Todo text)
- Test: `attendance/__tests__/attendance.service.spec.ts` (S21–S25), `attendance/__tests__/attendance-device.service.spec.ts` (paid-month Todo), `attendance/__tests__/attendance.integration.spec.ts` (I9)

**Interfaces — Consumes:** `payrollAttendanceLockKey`. **Produces:**
```ts
export function findPaidPayroll(client: Prisma.TransactionClient | PrismaService, userId: string, period: string): Promise<{ documentId: string; number: string } | null>; // line in a POSTED, non-deleted PAYROLL of that period
export function assertNotPaid(client: Prisma.TransactionClient | PrismaService, pairs: { userId: string; workDate: Date }[]): Promise<void>; // 409 ATTENDANCE_PAID
```
Inside each transaction take the lock keys (sorted, de-duplicated) first, re-read, `assertNotPaid`, write; audit after commit. `month()` / `today()` rows gain `paidDocumentNumber: string | null`. Kiosk punches untouched.

- [ ] **Step 1: Failing tests:** S21 `correctDay` on a paid month → 409 with the number; S22 `setDayKinds` with one paid pair → 409, nothing written; S23 (regression guard) `clearConflictFlag` on a paid month → succeeds; S24 (regression guard) unpaid month unchanged; S25 `month()` sets `paidDocumentNumber`; device spec: `lockForConflict` flagging a paid month → Todo contains the paid-month line with the number; I9 post the October payroll → `correctDay` on an October day 409, while a kiosk punch on 2 Nov (next month) still succeeds.
- [ ] **Step 2: Run** `npx jest src/modules/attendance` · Expected: FAIL on S21, S22, S25 and the device case (S23/S24 pass already).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** jest + `bash tools/test-db-vitest.sh src/modules/attendance/__tests__/attendance.integration.spec.ts` · Expected: PASS.
- [ ] **Step 5: Commit** `feat(attendance): paid months are read-only (flags stay clearable)`.

### Task 7: Web — payroll form

**Files:**
- Modify: `apps/web/src/components/expense-form-v4/types.ts` (48-92), `PayrollLinesSection.tsx` (copy 88-155, table 384-442, row 492-586, `CustomIncomeSubTable` 591-722), `ExpenseFormV4.tsx` (edit gate :171, edit mapping 192-214, payload 340-398, save/submit 494-504), `apps/web/src/pages/ExpensesPage.tsx` (edit menu 387-389: allow PAYROLL in DRAFT / PENDING_APPROVAL / APPROVED)
- Create: `apps/web/src/components/expense-form-v4/payroll-system/{PayrollSystemRows.tsx, PayrollReviewPanel.tsx}`
- Test: `components/expense-form-v4/__tests__/PayrollLinesSection.test.tsx`, `payroll-system/__tests__/PayrollReviewPanel.test.tsx`, `pages/ExpensesPage.ux.test.tsx` (edit menu)

UI per mockup board 1 (OT parts): button `บันทึกร่าง + คิดยอด` saves (create or PATCH) and stays/opens in edit mode of that draft; locked system table (lock icon, `รายได้จากระบบ — แก้ในใบนี้ไม่ได้`, `ชม. × อัตรา`, chip `จากระบบลงเวลา`); attendance box `สรุปลงเวลา … — ข้อมูลประกอบ ไม่หักเงิน`; column `รายได้พิเศษ`; side panel from stored `systemNotes`: `วันที่ต้องตรวจ ({n})` (DEVICE_CONFLICT first, destructive chip `เครื่องถูกใช้ซ้อน`) and `คำเตือน ({n})`; day link `/attendance?tab=today&date=YYYY-MM-DD` only for OWNER or a BRANCH_MANAGER of the day's branch, else text `ให้เจ้าของหรือผู้จัดการสาขาตรวจที่เมนู ลงเวลา`. Manual income rows get checkbox `รายการปรับปรุงงวดก่อน` (sends `isAdjustment`). Before saving, MANUAL non-adjustment rows on `attendanceAccountCodes` (from `GET payroll/meta`) are removed only on lines whose **stored** `attendanceSummary.autoOtEligible` is true, with toast `เอาแถว OT ที่กรอกเองออก — ระบบคิดจากลงเวลาให้แล้ว`; new or never-saved lines are left to the server (`MANUAL_OT_DUPLICATE` 400 shown inline). Copy previous keeps only `source === 'MANUAL'` rows. Note under the table: `ระบบคิด OT ใหม่ทุกครั้งที่บันทึก`. "Save and submit" before the cutoff shows the `SUBMIT_CUTOFF` message (document stays a draft).

- [ ] **Step 1: Failing tests:** button saves and renders locked rows (no inputs) + panel from stored notes; payload has no system rows; adjustment checkbox sends `isAdjustment`; copy skips system/adjustment rows; manual OT stripped with toast on a saved eligible line; a DAILY line's manual `S52-1202` row is kept and sent; link hidden for ACCOUNTANT and other-branch BM; edit menu shown for a PENDING_APPROVAL payroll.
- [ ] **Step 2: Run** `cd apps/web && npx vitest run src/components/expense-form-v4 src/pages/ExpensesPage.ux.test.tsx` · Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same + `npx eslint` on changed files · Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): save-and-compute OT in the payroll form`.

### Task 8: Web — payroll detail, list actions, slip

**Files:**
- Modify: `apps/web/src/components/accounting/InternalControlActionBar.tsx` (props 45-94, buttons 376-413: optional `approveBlockedReason?`, `postBlockedReason?`, `extraActions?: ReactNode`), `apps/web/src/pages/ExpenseDetailPage.tsx` (type 52-69, mutations 157-235, CSV block 271-303, action bar 380-414), `apps/web/src/pages/ExpensesPage.tsx` (row approve/post 448-477), `apps/web/src/hooks/useApprovalActions.ts` (50-63), `apps/web/src/pages/PaymentVoucherPage.tsx` (`PayrollSlipLine` 58-80, `PayrollSlipSheet` 399-588, comment 387-388)
- Create: `apps/web/src/pages/expense-detail/PayrollDetailSection.tsx`
- Test: `pages/expense-detail/__tests__/PayrollDetailSection.test.tsx`, `components/accounting/__tests__/InternalControlActionBar.test.tsx`, new cases in `pages/PaymentVoucherPage.test.tsx`

UI per boards 2, 3, 6A (OT parts): payroll lines table (name, base, OT/holiday, other income, SSO, net) + per-line review/warnings from `systemNotes`; `payrollGate.closableAt` in the future → info banner + `ยังไม่ถึงเวลาปิดงวด` on submit/approve/post; `deviceConflicts` → destructive banner + `ติดธง เครื่องถูกใช้ซ้อน {n} วัน`; 409 `PAYROLL_STALE` → alert with the diff table and `แก้ไข`; `แก้ไข` in `extraActions` for a PAYROLL in DRAFT / PENDING_APPROVAL / APPROVED (same target as `ExpensesPage.tsx:389`); `พิมพ์สลิปเงินเดือน ({n} ใบ)` → `/expenses/:id/voucher` only when POSTED, else disabled `ลงบัญชีก่อนจึงพิมพ์สลิปได้`; note `สลิปพิมพ์กระดาษเท่านั้น — ไม่มีส่งทาง LINE หรืออีเมล`. List page: PAYROLL rows replace approve/post with `เปิดใบ` (link to detail); a PAYROLL 409 toast says `เปิดใบเพื่อดูรายละเอียด`. Slip: `ชม. × อัตรา` (rate 2 dp), adjustment rows labelled `(ปรับปรุงงวดก่อน)`, attendance box `ข้อมูลประกอบ — ไม่มีผลต่อยอดเงิน`, footer `ใบจ่ายเงินเดือน v2`; non-POSTED → message instead of slips; delete the "Email dispatch deferred" comment.

- [ ] **Step 1: Failing tests** for each state above + slip row `6.5 × 93.75 = 609.38` + list row shows `เปิดใบ` for PAYROLL.
- [ ] **Step 2: Run** `cd apps/web && npx vitest run src/pages/expense-detail src/components/accounting src/pages/PaymentVoucherPage.test.tsx src/pages/ExpensesPage.ux.test.tsx` · Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** · Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): payroll gates on detail/list and slip with hours x rate`.

### Task 9: Web — attendance lock UI

**Files:**
- Modify: `apps/web/src/pages/attendance/AttendancePage/{index.tsx (tabs 19-24/62-78: read ?tab=&date=), components/TodayTab.tsx (canEdit :36, button 104-107), components/MonthTab.tsx, components/ScheduleTab.tsx (lock 89-104), components/CorrectDayDialog.tsx (save 139-140)}`, `apps/web/src/hooks/useAttendance.ts` (types 17-84)
- Test: new cases in `pages/attendance/AttendancePage/AttendancePage.test.tsx`

UI per board 5: banner + lock chip `จ่ายเงินเดือนแล้ว` for rows with `paidDocumentNumber`; edit and schedule cells disabled for them; `CorrectDayDialog` save disabled with the `ATTENDANCE_PAID` text, while `ตรวจแล้ว ล้างธง` stays enabled for the owner; `?tab=today&date=YYYY-MM-DD` opens that day.

- [ ] **Step 1: Failing tests** (paid row disabled, clear-flag still enabled, deep link).
- [ ] **Step 2: Run** `cd apps/web && npx vitest run src/pages/attendance` · Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** · Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): paid-month lock on attendance pages`.

### Task 10: Docs, version, full gates

**Files:** `.claude/rules/accounting.md` (Payroll 939-1013: subsection "OT จากระบบลงเวลา (D4 ส่วนที่ 1)"), `.claude/rules/database.md` (attendance writers :67 — paid-month lock), `.claude/CLAUDE.md` (Important Notes bullet near :369), `apps/web/package.json` → `26.10.62`

- [ ] **Step 1:** Write the rules as built (always-compute, cutoff at submit/approve/post, gate order, locks, adjustment rows, send back via edit, decisions 1–9) with file names; no prices or employee data.
- [ ] **Step 2: Full gates:** types (all) · eslint on changed files · `npx jest src/modules/expense-documents src/modules/attendance src/modules/trash src/modules/journal src/modules/settings src/filters` · harness: all `expense-documents/__tests__/*.integration.spec.ts` + `attendance/__tests__/attendance.integration.spec.ts` · `cd apps/web && npx vitest run` · `node tools/check-access-coverage.mjs` (0 errors, no new routes). Record counts in the commit body.
- [ ] **Step 3: Commit** `docs(payroll): D4 part 1 rules; bump web 26.10.62`.
