# เตือนจ่ายบิลประจำ (D5) — แผนงาน

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ร้านตั้ง "บิลประจำ" จากหน้าจอได้ ระบบสร้างร่างใบรายจ่ายล่วงหน้า เตือนผ่านงาน/หน้า/การ์ด/LINE(stub) และอ่าน "จ่ายแล้ว" จากใบจริง

**Architecture:** ต่อยอด `ExpenseTemplate` (recurrence/recurringMonth/reminderLeadDays/startsOn) + ตารางงวด `recurring_bill_occurrences` (unique templateId+periodKey) · ตรรกะทั้งหมดใน `RecurringBillsService` (ขั้น A สร้างงวด · ขั้น B อัปเดตงวด) ซึ่ง cron 08:05 และปุ่มบันทึกแม่แบบเรียก · ฟังก์ชันวันที่/งวดเป็น pure function ใน `packages/shared` ใช้ร่วม API+เว็บ · งวดละ 1 Todo (tag) · `RecurringBillNotifier` เป็นท่อ LINE ที่ก้อน 7 เสียบ

**Tech Stack:** NestJS + Prisma (jest unit · vitest integration บน Postgres ชุดทดลอง) · React/Vite/shadcn (vitest) · `packages/shared` (vitest)

**Spec:** `docs/superpowers/specs/2026-10-26-recurring-bill-reminders-design.md` (รวม §13 คำตัดสินหลัง builder-check และ §14 หลัง scrutinize — ทั้งสองส่วนเป็นกติกาบังคับ)

## Global Constraints

- ข้อความบนจอ/validation ภาษาไทย · โทเคนสี `index.css` เท่านั้น ห้าม hex/`text-gray-*` · ข้อความไทย `leading-snug` · ป้ายสถานะมีไอคอน ไม่ใช้สีอย่างเดียว · ปุ่มใช้ `text-primary-foreground` บน `bg-primary` · ตัวอักษรเหลืองใช้ `text-warning-strong`
- Prisma: uuid · `createdAt/updatedAt/deletedAt` · soft delete เท่านั้น · enum ประกาศส่วนบน schema · migration ชื่อ `20261103000000_recurring_bill_occurrences` · Production = `migrate deploy`
- "ระบบสร้างได้แค่ร่าง" — ห้ามโพสต์/จ่าย/ลง JE จากโค้ดใหม่ทุกจุด
- AuditLog เขียน**หลัง** `$transaction` commit ผ่าน `AuditService.log` · Todo สร้างด้วย `prisma.todo.create` ตรง (ห้ามผ่าน `TodosService`)
- ทุกการเทียบวันใช้ปฏิทินไทย: API ใช้ `apps/api/src/utils/date.util.ts` (`bangkokCalendarParts`, `bangkokMidnight`, `bangkokDayDiff`, `addBkkDays`) · shared ใช้ `Intl` + `Asia/Bangkok` เท่านั้น (ไม่มี TZ ของโปรเซส)
- `isExpenseDocumentPaid(doc)` = `deletedAt == null && status === 'POSTED' && paidAt != null` (สเปก §15.2 — ไม่มีข้อ settlement) — ที่เดียว ห้ามเขียนซ้ำ
- **สเปก §15 ทับทุกข้อที่ขัดกัน** — อ่านส่วน "ส่วนแก้ตาม §15" ท้ายแผนก่อนเริ่มแต่ละงาน
- `RECURRING_BILL_NOTIFY_ROLES = ['OWNER','ACCOUNTANT']` · `RECURRING_BILL_TODO_TAG = 'recurring-bill'` · tag งวด `rb:<occurrenceId>` · `RECURRING_BILL_CATCHUP_DAYS = 7` · lead default 3 (0–30) · เหตุผลข้าม 5–200 · หมายเหตุจ่าย ≤ 200
- ห้ามรัน `apps/api run lint` (มี `--fix`) · ก่อน jest ของ API ต้อง `npm run build --workspace=@installment/shared` · ห้าม `git stash` เปล่า
- รันทุกคำสั่งจาก root ของ worktree ด้วย absolute path (`/Users/iamnaii/Desktop/App/BESTCHOICE/.claude/worktrees/recurring-bills`) — cwd เลื่อนได้
- เวอร์ชันเว็บ `apps/web/package.json` → `26.10.53` (งานสุดท้าย)

## Review Focus

1. แก้แม่แบบ (วัน/ความถี่) หลังมีงวดแล้ว — งวดเดิมต้องคง `dueDate` เดิม งวดใหม่ใช้กติกาใหม่ ไม่ชน unique เดิม → เทสใน Task 4
2. BRANCH_MANAGER ที่ไม่มี `branchId` ต้องได้ 403 ทุก endpoint ใหม่ (fail-closed) → เทสใน Task 7
3. `templates_enabled = 'false'` ระหว่างเดือน — cron ต้องข้ามทั้งรอบโดยไม่สร้างงวด/งาน และ endpoint เขียนได้ 403 ข้อความเดิม → เทสใน Task 3 และ 7
4. ผู้ใช้ลบงาน /todos เอง — cron ไม่สร้างงานใหม่ ไม่ throw งวดยังเดินต่อ → เทสใน Task 3
5. ร่างถูกลบแล้วกด "สร้างร่างใหม่" ขณะที่คนอื่นเพิ่งสร้าง — 409 ไม่ใช่ร่างซ้ำ (unique `expenseDocumentId` + ตรวจใบ live) → เทสใน Task 7

---

### Task 1: ฟังก์ชันงวด/วันครบกำหนดใน `packages/shared`

**Files:**
- Create: `packages/shared/src/recurring-bill.ts`, `packages/shared/src/recurring-bill.test.ts`
- Modify: `packages/shared/src/index.ts` (export)

**Interfaces:**
- Produces:
  - types `RecurrenceKind = 'MONTHLY'|'QUARTERLY'|'YEARLY'`, `RecurringBillStatus = 'PENDING'|'PAID'|'SKIPPED'`, `RecurringBillViewStatus = 'UPCOMING'|'PENDING'|'DUE_TODAY'|'OVERDUE'|'PAID'|'PAID_UNPOSTED'|'SKIPPED'`, `RecurringRule = { recurrence: RecurrenceKind; recurringDay: number; recurringMonth: number | null }`, `CalendarDate = { year: number; month: number; day: number }` (เลขปฏิทินไทย = Gregorian ใน Asia/Bangkok)
  - constants ตาม Global Constraints + `RECURRING_BILL_DEFAULT_LEAD_DAYS = 3`, `RECURRING_BILL_LEAD_DAYS_MAX = 30`, `RECURRING_BILL_SKIP_REASON = { min: 5, max: 200 }`, `RECURRING_BILL_PAID_NOTE_MAX = 200`, `RECURRING_BILL_ERROR = { NOT_PENDING: 'งวดนี้ไม่ได้อยู่ในสถานะรอจ่าย', ... }`
  - `bkkCalendarDate(d: Date): CalendarDate` (Intl `en-CA` + `Asia/Bangkok`) · `daysInMonth(y, m)` · `clampDay(y, m, day)` · `compareCalendarDate(a, b): number` · `addCalendarDays(a, n): CalendarDate`
  - `periodKeyFor(rule, date: CalendarDate): string` — MONTHLY `YYYY-MM` · QUARTERLY `YYYY-Qn` (n = ไตรมาสของ `date.month`) · YEARLY `YYYY`
  - `dueDateForPeriod(rule, periodKey): CalendarDate` — MONTHLY วัน clamp · QUARTERLY เดือน `(n−1)*3 + recurringMonth` · YEARLY เดือน `recurringMonth`
  - `nextPeriodKey(rule, periodKey): string` · `periodsFrom(rule, start: CalendarDate, count: number): string[]` (งวดแรก = งวดแรกที่ `dueDate ≥ start`)
  - `reminderWindowOpens(rule, periodKey, leadDays): CalendarDate` = due − leadDays
  - `formatPeriodLabelTh(rule, periodKey): string` (`ต.ค. 2569` · `ไตรมาส 4/2569` · `ปี 2569`)

- [ ] **Step 1: เขียนเทสที่ล้มก่อน** (`recurring-bill.test.ts`) — ตัวเลขทองจากสเปก §6:
  - `dueDateForPeriod({MONTHLY, 31}, '2026-02')` = `{2026,2,28}` · `'2026-04'` = 30 · `'2026-01'` = 31
  - `{QUARTERLY, 15, recurringMonth 2}` → `'2026-Q1'`=15/2 · `Q2`=15/5 · `Q3`=15/8 · `Q4`=15/11 · `periodKeyFor` ของ `{2026,11,3}` = `'2026-Q4'`
  - `{YEARLY, 29, 2}` → `'2026'`=28/2 · `'2028'`=29/2
  - `periodsFrom({MONTHLY,25}, {2026,10,26}, 2)` = `['2026-11','2026-12']` · `periodsFrom({MONTHLY,28}, {2026,10,26}, 1)` = `['2026-10']`
  - `reminderWindowOpens({MONTHLY,28}, '2026-10', 3)` = `{2026,10,25}` · lead 0 = วันครบ
  - `bkkCalendarDate(new Date('2026-10-26T17:30:00Z'))` = `{2026,10,27}` (เที่ยงคืนครึ่งไทย) · `formatPeriodLabelTh` 3 แบบ
- [ ] **Step 2: รันให้ล้ม** — `cd /Users/iamnaii/Desktop/App/BESTCHOICE/.claude/worktrees/recurring-bills/packages/shared && npx vitest run src/recurring-bill.test.ts` → FAIL (module not found)
- [ ] **Step 3: เขียน `recurring-bill.ts`** ตาม Interfaces (ไม่มี `Date.now()` ภายใน — รับ `Date`/`CalendarDate` เข้ามาเสมอ)
- [ ] **Step 4: รันให้ผ่าน** — คำสั่งเดิม → PASS ทั้งไฟล์ · `npm run build --workspace=@installment/shared` ผ่าน
- [ ] **Step 5: Commit** — `git add packages/shared/src/recurring-bill.ts packages/shared/src/recurring-bill.test.ts packages/shared/src/index.ts && git commit -m "feat(shared): recurring bill period and due-date rules"`

### Task 2: Schema + migration

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (enums ส่วนบน · `model ExpenseTemplate` · `model ExpenseDocument` back-relation · `model Todo` back-relation · `model User` back-relations · model ใหม่)
- Create: `apps/api/prisma/migrations/20261103000000_recurring_bill_occurrences/migration.sql`

**Interfaces:**
- Produces (Prisma): enum `RecurrenceKind { MONTHLY QUARTERLY YEARLY }` · enum `RecurringBillStatus { PENDING PAID SKIPPED }` · `ExpenseTemplate.recurrence RecurrenceKind? @map("recurrence")`, `recurringMonth Int? @map("recurring_month")`, `reminderLeadDays Int @default(3) @map("reminder_lead_days")`, `startsOn DateTime? @map("starts_on")`, `occurrences RecurringBillOccurrence[]` · model `RecurringBillOccurrence` @@map("recurring_bill_occurrences"): `id`, `templateId` (relation `onDelete: Restrict`), `periodKey String @map("period_key")`, `dueDate DateTime @map("due_date")`, `status RecurringBillStatus @default(PENDING)`, `expenseDocumentId String? @unique @map("expense_document_id")` (relation "RecurringBillOccurrenceDocument" `onDelete: SetNull`), `todoId String? @map("todo_id")` (relation "RecurringBillOccurrenceTodo" `onDelete: SetNull`), `paidAt DateTime?`, `paidById String?` (relation "RecurringBillPaidBy" SetNull), `paidNote String?`, `skippedAt DateTime?`, `skippedById String?` (relation "RecurringBillSkippedBy" SetNull), `skipReason String?`, `lastRemindedOn String? @map("last_reminded_on")`, timestamps 3 ตัว · `@@unique([templateId, periodKey])` · `@@index([status, dueDate])` · `@@index([templateId, dueDate])`
- SQL backfill ใน migration เดียวกัน: `UPDATE expense_templates SET recurrence = 'MONTHLY', starts_on = now() WHERE is_recurring = true AND recurrence IS NULL;`

- [ ] **Step 1: แก้ schema + เขียน migration.sql ด้วยมือ** (รูปแบบเดียวกับ `20261102000000_contract_blacklist_override` — `ALTER TABLE … ADD COLUMN`, `CREATE TYPE`, `CREATE TABLE`, index, FK, backfill)
- [ ] **Step 2: ตรวจ** — `cd /Users/iamnaii/Desktop/App/BESTCHOICE/.claude/worktrees/recurring-bills && env DATABASE_URL=postgresql://u:p@localhost:5432/db npx prisma validate --schema apps/api/prisma/schema.prisma` → "The schema … is valid" · `(cd apps/api && npx prisma generate)` ผ่าน · `./tools/check-types.sh api` 0 errors
- [ ] **Step 3: Commit** — `git add apps/api/prisma && git commit -m "feat(db): recurring bill occurrences + template recurrence fields"`

### Task 3: `RecurringBillsService` ขั้น A/B + notifier + helper จ่ายแล้ว (jest, prisma mock)

**Files:**
- Create: `apps/api/src/modules/expense-documents/recurring-bills/recurring-bill-paid.util.ts`, `recurring-bill-notifier.ts`, `recurring-bills.service.ts`, `__tests__/recurring-bill-paid.util.spec.ts`, `__tests__/recurring-bills.service.spec.ts`
- Modify: `apps/api/src/modules/expense-documents/expense-documents.module.ts` (providers + `{ provide: RECURRING_BILL_NOTIFIER, useClass: LoggingRecurringBillNotifier }` + export service)

**Interfaces:**
- Consumes: Task 1 functions · `ExpenseTemplatesService.instantiate(id, user, { documentDate })` (`expense-templates.service.ts:210`)
- Produces (ก่อน): `apps/api/src/modules/expense-documents/templates-flag.util.ts` → `isTemplatesEnabled(prisma): Promise<boolean>` (ตรรกะเดียวกับ `assertTemplatesEnabled` `expense-templates.service.ts:70-88`: ไม่มีแถว/อ่านพัง = true, `'false'`/`'0'` = false) และให้ `assertTemplatesEnabled` เรียกมัน
- Produces:
  - `isExpenseDocumentPaid(doc: { deletedAt, status, paidAt, settlementsClearingThis?: {...}[] })` (pure) + `PAID_DOCUMENT_SELECT` (select/include ที่ต้องส่งมา — settlement แบบเดียวกับ `ap-due-alerts.cron.ts:72-93`)
  - `RECURRING_BILL_NOTIFIER` token · `interface RecurringBillNotifier { notify(e: RecurringBillEvent): Promise<void> }` · `RecurringBillEvent = { kind: 'UPCOMING'|'DUE_TODAY'|'OVERDUE'; occurrenceId; templateName; vendorName: string|null; branchName; dueDate: Date; daysOverdue: number; amount: string|null; documentNumber: string|null; link: string }` · `buildRecurringBillMessage(e): string` (ข้อความ 5 บรรทัดตามสเปก §7.4 — ไม่มีอีโมจิ) · `LoggingRecurringBillNotifier` (หาผู้รับ `user.findMany({ where: { role: { in: RECURRING_BILL_NOTIFY_ROLES }, isActive: true, deletedAt: null, isSystemUser: false }, select: { id, email } })` แล้ว `Logger.log` เท่านั้น)
  - `RecurringBillsService` (ctor `prisma`, `templates: ExpenseTemplatesService`, `@Inject(RECURRING_BILL_NOTIFIER) notifier`):
    - `runDaily(now = new Date()): Promise<{ disabled: boolean; created; skippedMissed; paid; reverted; unpostedClosed; reminded; failed }>` = ถ้า `templates_enabled` ปิด → `{ disabled: true, ...0 }` ไม่แตะ DB · ไม่มีผู้ใช้ระบบ → Sentry + คืน 0 · ไม่งั้น `generateForTemplate` ทุกแม่แบบ → `syncOccurrences`
    - `generateForTemplate(templateId: string, now?: Date, actor?: { id: string; branchId: string | null; role: 'OWNER' }): Promise<{ created: string[]; skippedMissed: string[] }>` — `actor` ว่าง = หาผู้ใช้ระบบเอง (ไม่มี = throw ข้อความไทย) · ขั้น A ตามสเปก §7 (catch-up 7 วัน · ลำดับ ①②③④ · dedupe ใบ `fromTemplateId` + `documentDate` ในวันครบกำหนด · ร่างล้ม = งวดอยู่ + งานบอก + Sentry)
    - `syncOccurrences(now, systemUser)` ขั้น B ข้อ 1–6 (ใช้ `isExpenseDocumentPaid` · ใบอื่นจาก `fromTemplateId` เดียวกันในงวด · ถอยกลับ PENDING · PAID_UNPOSTED → งานลงบัญชี · stage/`lastRemindedOn`)
    - `upsertTodo(occ, view: 'UPCOMING'|'DUE_TODAY'|'OVERDUE'|'UNPOSTED', systemUserId)` (หา `tags: { hasEvery: [TAG, 'rb:'+id] }, deletedAt: null` → create/update title/priority; งานที่ `DONE` ไม่แตะ) · `closeTodo(occ)` · `reopenTodo(occ)`
    - `viewStatusOf(occ, doc, today): RecurringBillViewStatus` (pure, export)
- Todo title/description/priority/tags ตามสเปก §7.3 · `branchId` = `template.branchId` · `dueDate` = `occ.dueDate`

- [ ] **Step 1: เทส util ล้มก่อน** — `isExpenseDocumentPaid`: paidAt+POSTED → true · paidAt+VOIDED → false · deletedAt → false · ACCRUAL (paidAt null) → false · PENDING_APPROVAL → false · `isLiveDocument`: DRAFT/PENDING_APPROVAL/APPROVED/ACCRUAL/POSTED → true · VOIDED/deleted → false
- [ ] **Step 2: รันให้ล้ม** — `cd /Users/iamnaii/Desktop/App/BESTCHOICE/.claude/worktrees/recurring-bills && npm run build --workspace=@installment/shared && npm --prefix apps/api test -- src/modules/expense-documents/recurring-bills/__tests__/recurring-bill-paid.util.spec.ts` → FAIL
- [ ] **Step 3: เขียน util** → PASS
- [ ] **Step 4: เทส service ล้มก่อน** (`recurring-bills.service.spec.ts` — prisma mock แบบ `expense-recurring.cron.spec.ts` + mock `templates.instantiate` + notifier spy; `now` คงที่ `2026-10-26T01:05:00Z`):
  - A1 แม่แบบ MONTHLY day 28 lead 3 startsOn 26/10 → สร้าง `2026-10` PENDING + `instantiate` ถูกเรียกด้วย `documentDate` = เที่ยงวันไทย 28/10 + todo.create (title `บิลประจำ: <ชื่อ> · ครบกำหนด 28 ต.ค. 69`, priority MEDIUM, tags ครบ, branchId) + notify UPCOMING
  - A2 รันซ้ำ (มีแถวแล้ว) → ไม่สร้าง ไม่ instantiate ไม่ notify
  - A3 day 25 startsOn 26/10 → ไม่สร้าง `2026-10` (due ก่อน startsOn) และ `2026-11` ยังไม่เข้าหน้าต่าง
  - A4 งวดหลุด: แม่แบบ startsOn 1/8 ไม่มีแถว → `2026-08`,`2026-09` = SKIPPED skippedById null (ไม่ instantiate/todo/notify) · `2026-10` (due 28/10 ≥ 26−7) = PENDING
  - A5 instantiate throw → แถว PENDING `expenseDocumentId null` + todo ข้อความ "สร้างร่างไม่สำเร็จ" + Sentry
  - A6 มีใบ `fromTemplateId` เดียวกัน `documentDate` ในวันครบกำหนดอยู่แล้ว → ผูกใบนั้น ไม่ instantiate
  - B1 ใบที่ผูก paidAt → PAID paidById null paidAt = ของใบ · todo update status DONE
  - B2 ใบอื่น fromTemplateId เดียวกันในงวด paid → PAID + ผูกใบนั้น
  - B3 PAID ระบบ แล้วใบ VOIDED → PENDING + todo TODO
  - B4 PAID มือ ใบยังไม่ paid → todo title ขึ้นต้น `ลงบัญชีใบ EX-` MEDIUM ไม่ DONE · ไม่ notify · ต่อมาใบ paid → todo DONE, paidById คงเดิม
  - B5 วันครบ (due = 26/10) → todo HIGH title มี `ครบกำหนดวันนี้` + notify DUE_TODAY ครั้งเดียว (`lastRemindedOn` = '2026-10-26'; รันซ้ำไม่ notify)
  - B6 เกิน 2 วัน → title `เกินกำหนด 2 วัน` + notify OVERDUE · วันถัดไป notify อีกครั้ง
  - B7 งานถูกลบ (`findFirst` คืน null หลังเคยมี `todoId`) → ไม่ create ใหม่ ไม่ throw
  - B8 `templates_enabled='false'` → `runDaily` คืน `disabled: true` ไม่เรียก findMany ใด ๆ
  - B9 ไม่มีผู้ใช้ระบบ → Sentry.captureMessage + คืน 0
  - N1 `buildRecurringBillMessage` 3 kind ตรงรูปสเปก · `LoggingRecurringBillNotifier` หาผู้รับเฉพาะ OWNER/ACCOUNTANT active ไม่ใช่ system
- [ ] **Step 5: รันให้ล้ม** — `npm --prefix apps/api test -- src/modules/expense-documents/recurring-bills/__tests__/recurring-bills.service.spec.ts` → FAIL
- [ ] **Step 6: เขียน service + notifier + templates-flag util + ลงทะเบียนใน module** → PASS ทั้ง 2 ไฟล์ · `./tools/check-types.sh api` 0 errors
- [ ] **Step 7: Commit** — `git add apps/api/src/modules/expense-documents && git commit -m "feat(api): recurring bills service, paid predicate, notifier stub"`

### Task 4: แม่แบบรับฟิลด์ใหม่ + ยกเว้นโควต้า + ขั้น A ทันทีหลังบันทึก

**Files:**
- Modify: `apps/api/src/modules/expense-documents/dto/create-template.dto.ts`, `expense-templates.service.ts` (`create`, `update`, `findAll` select ฟิลด์ใหม่), `__tests__/expense-templates.service.spec.ts`

**Interfaces:**
- Consumes: `RecurringBillsService.generateForTemplate` (Task 3) — inject แบบ `forwardRef` ถ้าวงกลม (templates ↔ recurring-bills); ทางเลือกที่ง่ายกว่า: controller เรียก `recurringBills.generateForTemplate` หลัง `templates.create/update` คืนค่า (เลือกทางนี้ — ไม่มีวงกลม)
- Produces: DTO ฟิลด์ `recurrence?: RecurrenceKind`, `recurringMonth?: number`, `reminderLeadDays?: number (0–30)`, `startsOn?: string (ISO date)` · validation ใน service `assertRecurringRule(dto, existing?)`: `isRecurring` ⇒ `recurrence` + `recurringDay` 1–31 · QUARTERLY ⇒ `recurringMonth` 1–3 · YEARLY ⇒ 1–12 · MONTHLY ⇒ null · `documentType === 'EXPENSE'` เท่านั้นเมื่อ `isRecurring` · ข้อความไทย · `startsOn` default `now()` เมื่อเปิด `isRecurring` ครั้งแรก · โควต้า: `count({ where: { createdById, deletedAt: null, isRecurring: false } })` · `update` รับฟิลด์ใหม่ (UpdateTemplateDto สืบจาก Create อยู่แล้ว)

- [ ] **Step 1: เทสล้มก่อน** (ต่อท้าย spec เดิม): create QUARTERLY ไม่ส่ง recurringMonth → 400 ไทย · YEARLY month 13 → 400 · MONTHLY ส่ง month → 400 · PAYROLL + isRecurring → 400 · lead 31 → 400 · create recurring เมื่อมี 20 แม่แบบธรรมดา → ผ่าน (ยกเว้นโควต้า) · create ธรรมดาเมื่อมี 20 ธรรมดา → 400 เดิม · update เปลี่ยน recurrence เป็น QUARTERLY โดยไม่ส่ง month → 400 · update เปิด isRecurring ครั้งแรก → `startsOn` ถูกตั้ง
- [ ] **Step 2: รันให้ล้ม** — `npm --prefix apps/api test -- src/modules/expense-documents/__tests__/expense-templates.service.spec.ts` → FAIL
- [ ] **Step 3: แก้ DTO + service** → PASS
- [ ] **Step 4: Commit** — `git commit -am "feat(api): recurring template fields, validation, quota exemption"`

### Task 5: cron 08:05 แทน `ExpenseRecurringCron`

**Files:**
- Create: `apps/api/src/modules/expense-documents/crons/recurring-bills.cron.ts`, `__tests__/recurring-bills.cron.spec.ts`
- Delete: `crons/expense-recurring.cron.ts`, `__tests__/expense-recurring.cron.spec.ts`
- Modify: `expense-documents.module.ts` (สลับ provider), `apps/api/src/cli/test-pack/_module.ts` (คอมเมนต์บรรทัด ~29), `docs/superpowers/tracking/A1-settings-audit.md` (อ้างอิงบรรทัด ~195)

**Interfaces:**
- Produces: `RecurringBillsCron.tick()` = `@Cron('5 8 * * *', { timeZone: 'Asia/Bangkok' })` → `service.runDaily()` ใน try/catch + Sentry (ห้าม throw) + log สรุป

- [ ] **Step 1: เทสล้มก่อน** — tick เรียก `runDaily` และคืนผล · `runDaily` throw → Sentry.captureException + ไม่ throw
- [ ] **Step 2: รันให้ล้ม** → **Step 3: เขียน cron + ลบของเก่า + แก้ module/คอมเมนต์** → **Step 4: PASS** + `grep -rn "ExpenseRecurringCron" apps/api/src docs` = 0 แถว + `./tools/check-types.sh api`
- [ ] **Step 5: Commit** — `git add -A apps/api/src/modules/expense-documents apps/api/src/cli/test-pack/_module.ts docs/superpowers/tracking/A1-settings-audit.md && git commit -m "feat(api): recurring bills cron replaces expense-recurring cron"`

### Task 6: มุมมองรายเดือน + การกระทำ (service)

**Files:**
- Modify: `recurring-bills.service.ts`, `__tests__/recurring-bills.service.spec.ts`
- Create: `recurring-bills/dto/mark-paid.dto.ts` (`note?` ≤200, `paidAt?` ISO), `dto/skip.dto.ts` (`reason` 5–200), `dto/list-query.dto.ts` (`month` `^\d{4}-\d{2}$`, `branchId?`)

**Interfaces:**
- Produces:
  - `listMonth(user: UserContext, month: string, branchId?: string, now?: Date): Promise<RecurringBillMonthView>` — `RecurringBillMonthView = { month; summary: { upcoming, pending, dueToday, overdue, paid, paidUnposted, skipped, amountRemaining: string }; rows: RecurringBillRow[] }` · `RecurringBillRow = { occurrenceId: string|null; templateId; templateName; vendorName; branch: { id; name }; recurrence; periodKey; periodLabel; dueDate: string (ISO); daysUntilDue; daysOverdue; expectedAmount: string|null; status: RecurringBillViewStatus; awaitingSystem: boolean; documentMissing: boolean; document: { id; number; status; totalAmount: string; paidAt: string|null } | null; todoId; paidAt; paidById; paidByName; paidNote; skipReason; skippedByName; }` · แถวจริง = occurrences ที่ `dueDate` ในเดือน (รวม template ที่ถูก soft-delete) · แถวฉาย = แม่แบบ live `isRecurring` ที่งวดในเดือนยังไม่มีแถวและ `reminderWindowOpens > วันนี้` (หรือ = `awaitingSystem` เมื่อหน้าต่างเปิดแล้ว) · BM: `getBranchScope(user)` (`auth/branch-access.util.ts`) ไม่มีสาขา → 403
  - `markPaid(id, user, dto)` · `skip(id, user, dto)` · `reopen(id, user)` · `createDraft(id, user)` — กติกา/409 ตามสเปก §8 · BM เช็คสาขาของแม่แบบ · AuditLog หลัง commit (`RECURRING_BILL_MARKED_PAID` / `_SKIPPED` / `_REOPENED` / `_DRAFT_CREATED`, entity `recurring_bill_occurrence`) · `createDraft` ใช้ขั้นตอน ②③ ของขั้น A กับผู้กด (ไม่ใช่ผู้ใช้ระบบ) · markPaid → `upsertTodo(occ,'UNPOSTED')` · skip → `closeTodo` · reopen → `reopenTodo`
- [ ] **Step 1: เทสล้มก่อน**: listMonth เดือน 2026-10 มี 7 แถวตาม mockup (PAID จากใบ · PAID_UNPOSTED · OVERDUE 2 · DUE_TODAY documentMissing · PENDING อีก 3 วัน · UPCOMING awaitingSystem=false · SKIPPED) + summary ตรง · เดือนก่อนที่ไม่มีแถว = ไม่ฉาย · BM สาขาอื่นไม่เห็นแถว · BM ไม่มี branchId → 403 · markPaid บน PAID → 409 · skip เหตุผล 3 ตัว → 400 · reopen PAID ระบบ → 409 ข้อความมี "ยกเลิกใบนั้น" · reopen PAID มือ → PENDING + todo TODO · createDraft เมื่อมีร่าง live → 409 · createDraft เมื่อใบถูกลบ → instantiate ด้วยผู้กด + ผูกใหม่
- [ ] **Step 2: รันให้ล้ม** → **Step 3: เขียน** → **Step 4: PASS** (`npm --prefix apps/api test -- src/modules/expense-documents/recurring-bills`)
- [ ] **Step 5: Commit** — `git commit -am "feat(api): recurring bills month view and occurrence actions"`

### Task 7: Controller + การ์ดแดชบอร์ด

**Files:**
- Create: `recurring-bills/recurring-bills.controller.ts`, `__tests__/recurring-bills.controller.spec.ts`
- Modify: `expense-documents.module.ts` (controllers), `apps/api/src/modules/expense-documents/expense-templates.controller.ts` (หลัง create/update ที่ผลลัพธ์ `isRecurring`: `await recurringBills.generateForTemplate(tpl.id)` ใน try/catch → ล้ม = `Sentry.captureException` + log, **ไม่ทำให้การบันทึกแม่แบบล้ม** — เทส: generateForTemplate throw → controller ยังคืน 201/200), `apps/api/src/modules/dashboard/services/dashboard-ops.service.ts` (`computeAlerts`), `__tests__` ของ dashboard ops (ไฟล์ spec เดิมของ computeAlerts)

**Interfaces:**
- Produces routes (`@UseGuards(JwtAuthGuard, RolesGuard)` · `@Roles('OWNER','BRANCH_MANAGER','FINANCE_MANAGER','ACCOUNTANT')`): `GET /recurring-bills?month&branchId` · `POST /recurring-bills/:id/mark-paid` · `POST /recurring-bills/:id/skip` · `POST /recurring-bills/:id/reopen` · `POST /recurring-bills/:id/create-draft` — ส่ง `@CurrentUser()` ทั้งก้อน
- Dashboard alert object: `{ type: 'recurring_bills_due', severity: overdue > 0 ? 'critical' : 'warning', message: 'บิลประจำ N รายการครบกำหนดใน 3 วัน · เกินกำหนด M' (M = 0 → ตัดส่วนท้าย), link: '/expenses/recurring-bills', count: N + M }` · N = PENDING `dueDate` ใน (วันนี้, วันนี้+3] · M = PENDING `dueDate ≤ วันนี้` · กรอง `template.branchId` เมื่อมี branchId · ไม่มีการ์ดเมื่อ N+M = 0 · `templates_enabled` ปิด → ไม่มีการ์ด
- [ ] **Step 1: เทสล้มก่อน**: controller ส่ง user/dto ถูก · dashboard: 0 → ไม่มีการ์ด · 2 ใกล้ครบ → warning count 2 · 2 ใกล้ + 1 เกิน → critical count 3 ข้อความครบ · branch filter · templates ปิด → ไม่มี
- [ ] **Step 2: รันให้ล้ม** → **Step 3: เขียน** → **Step 4: PASS** + `./tools/check-types.sh api`
- [ ] **Step 5: Commit** — `git commit -am "feat(api): recurring bills endpoints + dashboard alert"`

### Task 8: integration บน Postgres จริง + สคริปต์รัน

**Files:**
- Create: `tools/test-db-vitest.sh` (bootstrap Postgres เหมือน `tools/test-chat-credit.sh` บรรทัด 11–60 แล้ว `cd apps/api && ../../node_modules/.bin/vitest run --no-file-parallelism "$@"` — ไม่เปิด Vite/jest), `apps/api/src/modules/expense-documents/__tests__/recurring-bills.integration.spec.ts`

**Interfaces:**
- Consumes: `PrismaClient` ตรง + ประกอบ service ด้วยมือแบบ `payroll-shop-flow.integration.spec.ts` (ไม่ใช้ Nest DI) · seed ผัง `seedFinanceCoa/seedShopCoa` · สร้างสาขา/ผู้ใช้ระบบ/ผู้ใช้บัญชีในเทส
- [ ] **Step 1: เขียน spec ล้มก่อน** (ลำดับตามสเปก §12): แม่แบบจริง MONTHLY day = วันนี้+2 → `generateForTemplate` → ใบ `DRAFT` มี `fromTemplateId`, `documentDate` = เที่ยงวันไทยของ due, 1 บรรทัด category/unitPrice=sampleAmount, เลขที่ `EX-<due yyyymmdd>-NNNN` · แถวงวด + Todo มี tag · โพสต์ใบจริงแบบ same-day ผ่าน `ExpenseDocumentLifecycleService.post` (วิธีประกอบดู payroll spec) → `syncOccurrences` → PAID + todo DONE · void ใบ → PENDING + todo TODO · `markPaid` มือบนงวดใหม่ → PAID_UNPOSTED (todo title ขึ้นต้น "ลงบัญชีใบ") → โพสต์ → DONE · แม่แบบ startsOn 60 วันก่อน → งวดเก่า SKIPPED ระบบ ไม่มีใบ
- [ ] **Step 2: รันให้ล้ม** — `bash /Users/iamnaii/Desktop/App/BESTCHOICE/.claude/worktrees/recurring-bills/tools/test-db-vitest.sh src/modules/expense-documents/__tests__/recurring-bills.integration.spec.ts`
- [ ] **Step 3: แก้จนผ่าน** (แก้ service ถ้าของจริงต่างจาก mock — บันทึก Ruling)
- [ ] **Step 4: Commit** — `git add tools/test-db-vitest.sh apps/api/src/modules/expense-documents/__tests__/recurring-bills.integration.spec.ts && git commit -m "test(api): recurring bills end-to-end on real Postgres"`

### Task 9: เว็บ — hook + หน้า "บิลประจำ" + route + เมนู

**Files:**
- Create: `apps/web/src/hooks/useRecurringBills.ts`, `apps/web/src/pages/RecurringBillsPage/index.tsx`, `components/MonthHeader.tsx`, `components/SummaryChips.tsx`, `components/BillsTable.tsx`, `components/StatusBadge.tsx`, `components/MarkPaidDialog.tsx`, `components/SkipDialog.tsx`, `RecurringBillsPage.test.tsx`
- Modify: `apps/web/src/App.tsx` (route `/expenses/recurring-bills` lazy + ProtectedRoute 4 role แบบบรรทัด 601–607), `apps/web/src/config/menu.ts` (เพิ่ม `{ label: 'บิลประจำ', path: '/expenses/recurring-bills', icon: CalendarClock }` ถัดจาก "บันทึกรายจ่าย"/"ค่าใช้จ่ายดำเนินงาน" ใน 4 section: บรรทัด ~256 (BM), ~391 (FM), ~495 (ACC), ~702 (OWNER) — ตรวจ `resolveZoneForPath` ว่า path ใหม่ map ถูก zone), `apps/web/src/pages/ExpensesPage.tsx` (ปุ่ม "บิลประจำ" ข้าง "รายการโปรด" บรรทัด ~510 ภายใต้ `templatesEnabled`)

**Interfaces:**
- Consumes: `GET /recurring-bills` shape จาก Task 6 · `RecurringBillViewStatus` จาก `@installment/shared` · formatters เดิม (`formatDateShort`, `formatNumber`)
- Produces: `useRecurringBills(month, branchId)` (`useQuery(['recurring-bills', month, branchId])`) + mutations 4 ตัว invalidate key เดียวกัน · `STATUS_META: Record<RecurringBillViewStatus, { label; icon; className }>` (ป้าย+ไอคอน ตาม mockup: UPCOMING muted · PENDING primary/10 · DUE_TODAY warning · OVERDUE destructive · PAID success · PAID_UNPOSTED `bg-warning/10 text-warning-strong` + ไอคอนเอกสาร · SKIPPED muted) · ปุ่มต่อสถานะตาม mockup กระดาน 1 · empty state ชี้ปุ่ม "+ บิลประจำ" (ปุ่มเปิด `RecurringBillDialog` ของ Task 10 — ใน Task นี้ render ปุ่มที่ navigate ไป `/expenses/favorites` ก่อน) · ตารางอยู่ใน `overflow-x-auto` · `templatesEnabled=false` → แสดงกล่อง "ระบบรายการโปรด/บิลประจำถูกปิดใช้งาน" เหมือน favorites (`ExpenseFavoritesPage.tsx:46-48`)
- [ ] **Step 1: เทสล้มก่อน** (vitest + RTL, mock api): render 7 แถวจาก fixture → ป้ายทั้ง 7 ข้อความถูก · ปุ่มต่อสถานะ (OVERDUE มี เปิดร่าง/จ่ายแล้ว/ข้าม · PAID_UNPOSTED มี เปิดร่าง/เปิดใหม่ · UPCOMING มีแค่ แก้ไขบิล) · กด "ข้าม" เหตุผลสั้น → ปุ่มยืนยัน disabled · กด "จ่ายแล้ว" ส่ง POST พร้อม note · ชิปสรุปตัวเลข · empty state
- [ ] **Step 2: รันให้ล้ม** — `cd /Users/iamnaii/Desktop/App/BESTCHOICE/.claude/worktrees/recurring-bills/apps/web && npx vitest run src/pages/RecurringBillsPage` → **Step 3: เขียน** → **Step 4: PASS** + `./tools/check-types.sh web`
- [ ] **Step 5: Commit** — `git add apps/web && git commit -m "feat(web): recurring bills month page, route, menu"`

### Task 10: เว็บ — กล่อง "ตั้งบิลประจำ" + การ์ดบนหน้ารายการโปรด

**Files:**
- Create: `apps/web/src/components/expense-templates/RecurringBillDialog.tsx`, `RecurringBillDialog.test.tsx`
- Modify: `apps/web/src/pages/ExpenseFavoritesPage.tsx` (+ test ถ้ามี), `apps/web/src/pages/RecurringBillsPage/index.tsx` (ปุ่ม + บิลประจำ เปิด dialog จริง)

**Interfaces:**
- Consumes: `POST/PATCH /expense-templates` (Task 4) · `VendorCombobox` (`components/expense-form-v4/VendorCombobox.tsx` — props `value`, `onSelectSupplier`) · ตัวเลือกบัญชีแบบเดียวกับ `ItemLinesSection.tsx:55-72` (query `/chart-of-accounts/grouped`) · `/branches` สำหรับ select สาขา · `periodsFrom`/`reminderWindowOpens`/`formatPeriodLabelTh` จาก shared สำหรับพรีวิว
- Produces: `RecurringBillDialog({ open, onClose, template?: ExpenseTemplate })` ฟิลด์ตาม mockup กระดาน 3 · validate ฝั่งเว็บเหมือน Task 4 (ข้อความไทยเดียวกัน) · payload `{ name, documentType: 'EXPENSE', branchId, prefilledData: { vendorName, vendorSupplierId?, category, description, sampleAmount }, isRecurring: true, recurrence, recurringDay, recurringMonth, reminderLeadDays, startsOn }` · บันทึกแล้ว `invalidateQueries(['expense-templates'])` + `['recurring-bills']` · การ์ดบน favorites: ป้าย "บิลประจำ" + บรรทัด `ทุกวันที่ D · <ความถี่> · เตือนล่วงหน้า N วัน · งวดถัดไป <วันที่>` · ปุ่ม "ใช้" → "เปิดร่างงวดนี้" เมื่อ `isRecurring` (ไป `/expenses/recurring-bills?month=<งวดถัดไป>`) · ปุ่ม "แก้ไข" เปิด dialog · ปุ่มหัวหน้า "+ บิลประจำ" และ "บิลประจำเดือนนี้" · ป้าย `(n/20)` นับเฉพาะแม่แบบที่ไม่ใช่บิลประจำ
- [ ] **Step 1: เทสล้มก่อน**: เลือก ราย 3 เดือน → ช่องเดือนเปิดและบังคับ · วัน 31 + รายเดือน → พรีวิว "28 ก.พ." เมื่อถึงกุมภา (ใช้ fixture วันนี้ 26/1/2570) · lead 31 → error · submit ส่ง payload ถูก · โหมดแก้ไขเติมค่าเดิม · การ์ด recurring แสดงบรรทัดใหม่และปุ่ม "เปิดร่างงวดนี้"
- [ ] **Step 2: รันให้ล้ม** — `npx vitest run src/components/expense-templates src/pages/ExpenseFavoritesPage` → **Step 3: เขียน** → **Step 4: PASS** + `./tools/check-types.sh web`
- [ ] **Step 5: Commit** — `git add apps/web && git commit -m "feat(web): recurring bill dialog + favorites cards"`

### Task 11: เว็บ — การ์ดแดชบอร์ด + งานใน /todos อ่านลิงก์ + เวอร์ชัน + เอกสาร

**Files:**
- Modify: `apps/web/src/pages/DashboardPage/types.tsx` (`alertIconMap.recurring_bills_due = CalendarClock`), `apps/web/package.json` (`26.10.53`), `.claude/CLAUDE.md` (Important Notes 1 bullet: บิลประจำ — cron 08:05 · ตาราง occurrences · ระบบสร้างแค่ร่าง · spec path), `docs/superpowers/specs/2026-10-26-recurring-bill-reminders-design.md` (สถานะ "ทำแล้ว" + ลิงก์ PR ภายหลัง)
- [ ] **Step 1: เทส** — `DashboardAlerts` render alert `recurring_bills_due` ด้วยไอคอนใหม่ (ต่อท้าย spec เดิมของ DashboardAlerts ถ้ามี ไม่มี = สร้าง `DashboardAlerts.test.tsx` สั้น ๆ) → ล้ม → แก้ → ผ่าน
- [ ] **Step 2: รันครบ** — `./tools/check-types.sh all` 0 errors · `npm --prefix apps/api test -- src/modules/expense-documents src/modules/dashboard` เขียว · `(cd apps/web && npx vitest run src/pages/RecurringBillsPage src/components/expense-templates src/pages/ExpenseFavoritesPage src/pages/DashboardPage)` เขียว · `bash tools/test-db-vitest.sh src/modules/expense-documents/__tests__/recurring-bills.integration.spec.ts` เขียว
- [ ] **Step 3: Commit** — `git commit -am "chore: bump web 26.10.53, docs for recurring bills"`
- หมายเหตุก่อน deploy (ไม่ใช่โค้ด): ยืนยันผู้ใช้ระบบบน prod `SELECT id, is_active FROM users WHERE is_system_user = true` ผ่าน Cloud SQL proxy — ไม่มี = รัน `seedCollectionsFoundation` ส่วนผู้ใช้ระบบก่อนเปิดใช้

---

## ส่วนแก้ตาม §15 ของสเปก (ทับ Interfaces/Steps ข้างบนเมื่อขัดกัน)

**Task 1 (shared):** เพิ่ม `windowOpensFor(rule, periodKey, leadDays)` (= `reminderWindowOpens`) และ `matchWindow(rule, periodKey, leadDays): { from: CalendarDate; to: CalendarDate }` = `[windowOpens(งวดนี้), windowOpens(งวดถัดไป))` · `periodsFrom` รับ `start` เป็นวันปฏิทิน (วันเดียวกันนับ) · ตัวเลขทองเพิ่ม: "ตั้งบิล 26 ต.ค. day 26 lead 3 → งวดแรก 2026-10" · "ค่าเช่า day 1 lead 3: ใบลง 30 ต.ค. อยู่ในหน้าต่างของ 2026-11"

**Task 2 (schema):** ตามสเปก §15.1 ทั้งหมด — ไม่มี `deletedAt` บนงวด (+ `///` comment) · `estimatedAmount Decimal?` · `lastRemindedOn DateTime? @db.Date` · `todoId @unique` · ชื่อ relation · enum บล็อกบน · backfill เฉพาะ EXPENSE + `is_recurring=false` ประเภทอื่น · ดรอป/เพิ่ม index · เติม `recurring_bill_occurrences` ใน `apps/api/src/cli/factory-reset-tables.ts` `WIPE_TABLES` · docblock `wipe-expenses.cli.ts` · `prisma validate` + เทส factory-reset ที่มีอยู่ (ถ้ามี spec ตรวจรายชื่อตาราง) ต้องผ่าน

**Task 3 (service):** ตามสเปก §15.2–15.6: `isExpenseDocumentPaid` ใหม่ + `isLiveDocument` · ขั้น A: ③ ผูกเฉพาะใบ `createdById = actor.id` + `documentDate` วันครบกำหนด · catch-up: ไล่จาก `max(startsOn, วันนี้−7−1 งวด)` · งวดหลุด → SKIPPED ระบบ + งาน MEDIUM "งวดหลุด — ตรวจว่าจ่ายแล้วหรือยัง" (ไม่มีร่าง/LINE) · `estimatedAmount` snapshot · `documentDate`/`Todo.dueDate` เที่ยงวันไทย · P2002 บน create = skipped · ขั้น B: CAS ทุก transition (`updateMany` + `count === 1`) · ข้อ 1 ค้นใบอื่นด้วย `recurringBillOccurrence: null` + หน้าต่างงวด (`matchWindow`) + ใกล้สุด · ย้ายผูกแล้วลบร่างระบบที่ยัง DRAFT ใน tx (`tx.expenseDocument.update({deletedAt})` + `tx.auditLog.create` DELETED) · `paidAt = min(doc.paidAt, now)` · todoId null + ไม่มีงาน tag → สร้าง+notify ครั้งเดียว · ผู้ใช้ระบบ `{ isSystemUser: true, deletedAt: null }` · ผู้รับ LINE where ครบ 4 เงื่อนไข · `tick` ใช้ `pg_try_advisory_lock` (ใน cron Task 5) · เทสเพิ่ม: A7 QuickStart draft (createdById คน) ไม่ถูกผูก · A8 งวดหลุด → SKIPPED + งาน MEDIUM · A9 P2002 → skipped · B10 ใบคนทำเองลง 30 ต.ค. ผูกงวด 2026-11 (day 1) · B11 ใบที่ผูกงวดอื่นแล้วไม่ถูกผูกซ้ำ · B12 CAS: งวดถูก skip ระหว่าง tick → ไม่ notify · B13 todoId null ซ่อม · B14 ร่างระบบ DRAFT ถูกลบเมื่อผูกใบอื่น · N2 ผู้ใช้ระบบไม่อยู่ในผู้รับ

**Task 4 (template):** validation บนแถวรวม `{...tpl, ...dto}` · `startsOn` normalize เที่ยงคืนไทย + ช่วง [วันนี้−90, วันนี้+365] · แก้ rule → `startsOn = max(startsOn, วันนี้)` + งวด PENDING ที่ใบยังไม่ paid → SKIPPED "แม่แบบเปลี่ยนรอบ" + งาน DONE + ลบร่างระบบ DRAFT (เรียก `RecurringBillsService.retireOpenOccurrences(templateId, reason, actor)` — ย้ายการเรียกขั้น A/retire ไป controller เพื่อเลี่ยงวงกลม) · `prefilledData` รับ `paymentMethod`/`depositAccountCode` (ตรวจค่าเหมือน `create.dto.ts:66-73`) · เทสเพิ่มตามนั้น

**Task 5 (cron):** `tick()` = `SELECT pg_try_advisory_lock(hashtext('recurring-bills:tick'))` → false = log+return · `finally` unlock · เทส: lock ไม่ได้ → ไม่เรียก runDaily

**Task 6 (view/actions):** แถว GET เพิ่ม `templateDeleted`, `document.status` ป้ายตาม §15.2, `estimatedAmount` จาก snapshot, `paymentConfigured: boolean` (prefilledData มีวิธีจ่าย+บัญชี) · `create-draft` บนแม่แบบที่ลบ → 409 ข้อความ §15.5 · reopen จาก SKIPPED ระบบ (งวดหลุด) → PENDING + สร้างร่าง · CAS ทุก action (count 0 → 409 "สถานะเปลี่ยนแล้ว กรุณาโหลดใหม่") · summary ใช้ Decimal

**Task 7 (controller/dashboard):** หลัง create/update แม่แบบ: `retireOpenOccurrences` (เมื่อ rule เปลี่ยน) แล้ว `generateForTemplate(tpl.id, now, actor = ผู้กด)` ใน try/catch

**Task 8 (integration):** เพิ่มเคส: ใบไม่มีวิธีจ่าย โพสต์ → ACCRUAL → งวดยัง PENDING ป้าย "ตั้งหนี้แล้ว รอจ่าย" · ใบมีวิธีจ่าย (prefilledData) โพสต์ → POSTED+paidAt → PAID · `documentDate.getUTCHours() === 5` · สอง `runDaily` พร้อมกัน (Promise.all) → งวดเดียว/งานเดียว

**Task 9 (page):** ป้ายใบตามสถานะ (DRAFT/รออนุมัติ/อนุมัติแล้ว/ตั้งหนี้แล้ว/ยกเลิก/ลบ/ไม่มี) · ปุ่มตาม `documentMissing`/`templateDeleted` · แถว SKIPPED ระบบ มีปุ่ม "เปิดใหม่"/"จ่ายแล้ว" · คำเตือน "ยังไม่ตั้งวิธีจ่าย" เมื่อ `!paymentConfigured` · เมนูครบ 4 role + เทส reachability (`resolveZoneForPath('/expenses/recurring-bills')` ทุก role ที่ route อนุญาต)

**Task 10 (dialog):** ช่อง "วิธีจ่าย" (select ค่าที่ `create.dto.ts` รับ) + "บัญชีที่จ่าย" (`CashAccountSelect` เดิมถ้ามี ไม่งั้น select จาก `CASH_ACCOUNT_CODES`) ไม่บังคับ · โหมดแก้ไข ช่องสาขาอ่านอย่างเดียว · BM ล็อกสาขา · `startsOn` min/max ตาม §15.1

**Task 11:** หมายเหตุก่อน deploy เพิ่ม: ตรวจ `accounting_permissions` ว่าผู้รับงาน (ACCOUNTANT) มี `EXPENSE_POST` และผู้อนุมัติมี `EXPENSE_APPROVE`
