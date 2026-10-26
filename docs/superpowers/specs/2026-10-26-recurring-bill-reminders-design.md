# เตือนจ่ายบิลประจำ (D5) — ออกแบบ

วันที่ 2026-10-26 · ก้อน 6 ของรายการช่องว่าง Tooltify · สถานะ: **รอเจ้าของเคาะ** (mockup
`https://claude.ai/artifact/2CM7jqAmVoaRHSbaxBXQdr`)

## 1. ทำไมต้องมี

ร้านมีรายจ่ายที่มาทุกเดือนเหมือนเดิม (ค่าเช่า ค่าน้ำ ค่าไฟ อินเทอร์เน็ต ค่าทำบัญชี ประกัน) และวันนี้ไม่มีอะไรเตือน
เลยว่าใกล้ถึงกำหนด จ่ายแล้วหรือยัง หรือเลยกำหนดไปแล้วกี่วัน — รู้อีกทีคือโดนตัดเน็ต/โดนค่าปรับ. Tooltify มีหน้า
"บิลประจำ" ที่ทำเรื่องนี้ (ช่องว่าง D5).

สิ่งที่ระบบมีอยู่แล้วและข้อจำกัดของมัน (ตรวจโค้ด 2026-10-26):

| มีอยู่ | ข้อจำกัด |
|---|---|
| `ExpenseTemplate.isRecurring + recurringDay` + รอบ `expense-recurring.cron.ts` 08:00 สร้างร่างใบรายจ่ายจากแม่แบบ | สร้างร่าง**เงียบ ๆ** วันเดียวกับ `recurringDay` ไม่เตือนใคร ไม่รู้ว่าจ่ายแล้วหรือยัง · `recurringDay` 29–31 **ไม่ยิงเลย**ในเดือนที่สั้นกว่านั้น (เทียบ `=` ตรง ๆ) · มีแค่รายเดือน |
| `POST /expense-templates` (API) | **หน้าเว็บไม่มีที่สร้างแม่แบบ** — `apps/web` เรียกแค่ list / instantiate / delete ⇒ "รายการประจำ" ตั้งจากหน้าจอไม่ได้เลยวันนี้ |
| `ap-due-alerts.cron.ts` (เตือนเจ้าหนี้ค้างจ่าย) | ปิดอยู่ (`ap_due_alerts_enabled` default OFF) เพราะเอกสารไม่มี `dueDate` จริง — เป็นคนละเรื่อง (เอกสารที่โพสต์แล้วยังไม่จ่าย) ไม่แตะในก้อนนี้ |
| `Todo` + หน้า `/todos` "งานของทีม" · การ์ดเตือนบนแดชบอร์ด (`DashboardAlerts`) | ใช้ต่อได้ตรง ๆ — cron อื่นสร้าง Todo พร้อม tag กันซ้ำอยู่แล้ว |

## 2. คำตัดสินเจ้าของ (26/10/2569)

1. ความถี่: **รายเดือน + ราย 3 เดือน + รายปี**
2. ช่องทางเตือน: **งานใน /todos** + **หน้า "บิลประจำ" ของเดือน** + **การ์ดบนแดชบอร์ด** + **LINE (ต่อท่อไว้ รอก้อน 7 A16)**
3. เวลาเตือน: **3 วันก่อนครบกำหนด + วันครบกำหนด + ทุกวันที่เกินจนกว่าจะจ่าย**
4. ผู้รับ: **OWNER + ฝ่ายบัญชี ทุกสาขา**

## 3. เป้าหมาย · ไม่ทำ · ห้ามทำ

**เป้าหมาย**
- ตั้งบิลประจำจากหน้าจอได้ (ชื่อ ผู้รับเงิน สาขา บัญชี ยอดประมาณ ความถี่ วันครบกำหนด)
- ระบบรู้ทุกงวดว่า รอถึงรอบ / รอจ่าย / ครบกำหนดวันนี้ / เกินกำหนดกี่วัน / จ่ายแล้ว / ข้าม — และ "จ่ายแล้ว"
  อ่านจากใบรายจ่ายจริงที่ผูกกัน ไม่ต้องให้คนมาติ๊ก (ติ๊กเองได้เมื่อจ่ายนอกระบบ เช่น ตัดบัตรอัตโนมัติ)
- เตือนตามเวลาที่เคาะ โดย**ไม่สร้างงานซ้ำ** — งวดละ 1 งานใน /todos ที่ถูกยกระดับเมื่อถึง/เกินกำหนด
- แก้บั๊กวันที่ 29–31

**ไม่ทำในก้อนนี้**
- ส่ง LINE จริง (ก้อน 7 A16 เสียบท่อที่ `RecurringBillNotifier`)
- บิลที่มีวันสิ้นสุด / รายสัปดาห์ / หลายสาขาในแม่แบบเดียว
- แจ้งเตือน IN_APP ผ่าน `NotificationsService` (ช่องทางที่เคาะคือ 4 ข้อข้างบน)
- ย้ายข้อมูลเก่านอกจาก backfill คอลัมน์ให้แม่แบบ `isRecurring` ที่มีอยู่
- แม่แบบประเภท PAYROLL / VENDOR_SETTLEMENT เป็นบิลประจำ (บิลประจำ = ใบรายจ่าย `EXPENSE` เท่านั้น)

**ห้ามทำ (ทำแล้วถือว่าพัง)**
- โพสต์/จ่ายใบรายจ่ายให้อัตโนมัติ หรือลงบัญชีอะไรเอง — ระบบสร้างได้แค่ **ร่าง**
- สร้าง Todo ซ้ำทุกวันสำหรับงวดเดียวกัน
- เตือนงวดที่จ่ายแล้ว/ข้ามแล้ว

## 4. ภาพรวม

```
ตั้งบิลประจำ (dialog)  ──▶  รอบตรวจ 08:05 ทุกวัน (เวลาไทย)
                               │ งวดที่ถึง "วันครบกำหนด − N วัน" → สร้างแถวงวด + ร่างใบรายจ่าย + งาน /todos + LINE(stub)
                               │ งวดรอจ่าย: ใบที่ผูกจ่ายแล้ว? → จ่ายแล้ว + ปิดงาน
                               │ วันครบกำหนด → งานเป็น HIGH "ครบกำหนดวันนี้" + LINE
                               │ เกินกำหนด → งาน "เกินกำหนด N วัน" + LINE ทุกวัน (วันละครั้ง)
หน้า /expenses/recurring-bills ──▶ ตารางทั้งเดือน · เปิดร่าง · จ่ายแล้ว(บันทึกเอง) · ข้ามงวด · เปิดใหม่
การ์ดแดชบอร์ด ──▶ "บิลประจำ N รายการครบกำหนดใน 3 วัน · เกินกำหนด M" → หน้าบิลประจำ
```

## 5. ข้อมูล

### 5.1 `ExpenseTemplate` (ต่อยอด ไม่สร้างตารางแม่แบบใหม่)

| คอลัมน์ | ชนิด | ความหมาย |
|---|---|---|
| `isRecurring` (เดิม) | Boolean | สวิตช์ "เป็นบิลประจำ" — คงไว้ (index + หน้าจอเดิมอ่าน) |
| `recurringDay` (เดิม) | Int 1–31 | **เปลี่ยนความหมายเป็น "วันครบกำหนดจ่าย"** (เดิม = วันสร้างร่าง) · เดือนที่มีไม่ถึงวันนั้น = วันสุดท้ายของเดือน |
| `recurrence` ใหม่ | enum `RecurrenceKind { MONTHLY, QUARTERLY, YEARLY }` nullable | null ⇔ `isRecurring = false` (service บังคับคู่กัน) |
| `recurringMonth` ใหม่ | Int nullable | QUARTERLY: 1–3 = เดือนที่เท่าไรของไตรมาส (ม.ค./เม.ย./ก.ค./ต.ค. = 1) · YEARLY: 1–12 · MONTHLY: null |
| `reminderLeadDays` ใหม่ | Int default 3 (0–30) | เตือนล่วงหน้ากี่วัน (เจ้าของเคาะ 3 — ให้แก้รายบิลได้) |
| `startsOn` ใหม่ | DateTime nullable | งวดแรกที่นับ = วันครบกำหนดแรกที่ **≥ startsOn** (ค่าเริ่มต้น = วันที่สร้าง) — กันสร้างงวดที่ผ่านไปแล้วตอนตั้งบิลใหม่ |
| `prefilledData.sampleAmount` (เดิม) | number | = **ยอดประมาณ** (ตัวเดียวกับที่ `instantiate()` ใส่เป็น `unitPrice` ของร่าง) — ไม่เพิ่มคอลัมน์ |
| `prefilledData.vendorName / vendorSupplierId / category / description` (เดิม) | | ผู้รับเงิน (+FK ผู้จัดจำหน่ายจาก `VendorCombobox` เดิม) / รหัสบัญชีค่าใช้จ่าย / รายละเอียดบรรทัด |

Migration: เพิ่มคอลัมน์ + enum · backfill `recurrence = 'MONTHLY'`, `startsOn = now()` ให้แถว `isRecurring = true`
ที่มีอยู่ (วันนี้ prod แทบไม่มี — ตั้งจากหน้าจอไม่ได้) · `reminderLeadDays` default 3.

### 5.2 ตารางใหม่ `recurring_bill_occurrences` (หนึ่งแถว = หนึ่งงวดของบิลหนึ่งใบ)

| คอลัมน์ | หมายเหตุ |
|---|---|
| `id`, `templateId` (FK Restrict), `createdAt/updatedAt/deletedAt` | ตามกติกา |
| `periodKey` String | MONTHLY `2026-10` · QUARTERLY `2026-Q4` · YEARLY `2026` — `@@unique([templateId, periodKey])` = กันสร้างงวดซ้ำ (idempotency ของ cron) |
| `dueDate` DateTime | เที่ยงคืนเวลาไทยของวันครบกำหนด (คำนวณตอนสร้าง — แก้วันในแม่แบบทีหลังไม่ย้ายงวดที่สร้างแล้ว) |
| `status` enum `RecurringBillStatus { PENDING, PAID, SKIPPED }` | "ครบกำหนดวันนี้/เกินกำหนด/รอถึงรอบ" เป็น**มุมมอง**ที่คำนวณตอนอ่านจาก `PENDING` + วันไทย ไม่เก็บ |
| `expenseDocumentId` String? `@unique` | ร่างใบรายจ่ายที่สร้างให้ (null = สร้างไม่สำเร็จ / ยังไม่สร้าง) |
| `todoId` String? | งานใน /todos ของงวดนี้ |
| `paidAt`, `paidById`, `paidNote` | จ่ายแล้ว — อ่านจากใบ (`paidById` null) หรือคนบันทึกเอง |
| `skippedAt`, `skippedById`, `skipReason` | ข้ามงวดนี้ (เหตุผล 5–200 ตัว) |
| `lastRemindedOn` String? `YYYY-MM-DD` | วันไทยล่าสุดที่ส่ง LINE/ยกระดับงาน — รันรอบซ้ำในวันเดียวกันไม่เตือนซ้ำ |
| index `(status, dueDate)` · `(templateId, dueDate)` | หน้าเดือน + การ์ดแดชบอร์ด |

## 6. กติกาวันครบกำหนด (ฟังก์ชันบริสุทธิ์ใน `packages/shared/src/recurring-bill.ts` ใช้ร่วม API+เว็บ)

- `periodKeyFor(recurrence, date)` · `dueDateForPeriod(template, periodKey)` · `nextPeriods(template, from, count)`
  · `clampDay(year, month, day)` — ทุกตัวคิดด้วยปฏิทินไทย (ปีค.ศ. ภายใน แสดงเป็น พ.ศ. ที่หน้าจอ)
- MONTHLY: ทุกเดือน วันที่ `min(recurringDay, วันสุดท้ายของเดือน)`
- QUARTERLY: เดือน `{1,4,7,10} + (recurringMonth − 1)` วันที่ clamp เหมือนกัน
- YEARLY: เดือน `recurringMonth` วันที่ clamp (29 ก.พ. → 28 ก.พ. ปีที่ไม่ใช่อธิกสุรทิน)
- "หน้าต่างเตือน" ของงวด = `dueDate − reminderLeadDays` (วันไทย) · งวดนับเฉพาะ `dueDate ≥ startsOn`

ตัวเลขทอง (ปักเป็นเทส): day 31 รายเดือน → 31 ม.ค. / **28 ก.พ.** / 31 มี.ค. / **30 เม.ย.** 2569 · ราย 3 เดือน
`recurringMonth=2, day=15` → 15 ก.พ. / 15 พ.ค. / 15 ส.ค. / 15 พ.ย. · รายปี `month=2, day=29` → 28 ก.พ. 2569, 29 ก.พ. 2571 ·
`startsOn = 26 ต.ค. 2569`, day 25 → งวดแรก **25 พ.ย. 2569** (ไม่ใช่ 25 ต.ค.) · day 28 lead 3 startsOn 26 ต.ค. → งวดแรก
28 ต.ค. และเข้าหน้าต่างเตือนตั้งแต่ 25 ต.ค. ⇒ รอบ 27 ต.ค. สร้างทันที.

## 7. รอบตรวจรายวัน `recurring-bills.cron.ts` — 08:05 เวลาไทย (แทนที่ `expense-recurring.cron.ts` ซึ่งลบทิ้ง)

ตรรกะทั้งหมดอยู่ใน `RecurringBillsService` (cron เป็นแค่ผู้เรียก) เพื่อให้ปุ่มบันทึกแม่แบบเรียกขั้น A ได้ทันที.

**ขั้น A — สร้างงวดที่ถึงหน้าต่างเตือน** (ต่อแม่แบบ `isRecurring && recurrence && deletedAt null && documentType EXPENSE`):
งวดทุกงวดที่ `dueDate ≥ startsOn` และ `dueDate − leadDays ≤ วันนี้` และยังไม่มีแถว → **งวดที่ `dueDate ≥ วันนี้ − 7`** (`RECURRING_BILL_CATCHUP_DAYS`) สร้างเป็น `PENDING` ตามปกติ · **งวดที่เก่ากว่านั้น** (cron หยุด / สวิตช์ปิดแล้วเปิด) เขียนแถว `SKIPPED`
`skippedById null` เหตุผล "ระบบไม่ได้รันในช่วงนั้น" โดยไม่สร้างร่าง/งาน/LINE (log อย่างเดียว) — ไม่ผลิตร่าง "เกินกำหนด 40 วัน" ของบิลที่จ่ายไปแล้วนอกระบบ · ต่องวด (**ไม่ใช่ tx เดียว** — `create()` ของใบรายจ่ายเปิด tx ของตัวเอง): ① `occurrence.create(PENDING)` commit ก่อน ② ร่างผ่าน `ExpenseTemplatesService.instantiate(tpl.id, systemUser as OWNER,
{ documentDate: เที่ยงวันไทยของ **วันครบกำหนด** })` (ร่างลงวันที่บิล — `create()`/`post()` ไม่มีกติกาห้ามวันที่อนาคต มีเฉพาะ void ใต้ `payment_date_allow_future` (`lifecycle:727-738`) · เดือนที่ยังไม่มีแถวงวดบัญชี = เปิด (`period-lock.util.ts:84`) · ผู้ใช้แก้วันที่ในร่างได้) ③ ผูก `expenseDocumentId` (ก่อน ② ตรวจว่ามีใบ `fromTemplateId` เดียวกันลงวันไทยเดียวกับวันครบกำหนดอยู่แล้วไหม — มี = ผูกใบนั้นแทน กันร่างกำพร้าเมื่อ ② สำเร็จแต่ ③ ล้ม) ④ สร้างงาน /todos
(ข้อ 7.3) + `notifier.notify('UPCOMING')` · ร่างสร้างไม่ได้ (เช่น แม่แบบไม่ผ่าน validation) → แถวงวดยังอยู่ `expenseDocumentId = null`
+ งานยังสร้าง (ข้อความบอกว่าร่างสร้างไม่สำเร็จ) + Sentry — ไม่ลองซ้ำอัตโนมัติ (ปุ่ม "สร้างร่าง" บนหน้า).

**ขั้น B — อัปเดตงวด `PENDING` ทุกแถว** (เรียงตาม dueDate):
1. **จ่ายแล้ว?** `isExpenseDocumentPaid(doc)` = `deletedAt == null && status != 'VOIDED' && (paidAt != null || ถูกล้างด้วย VENDOR_SETTLEMENT ที่ไม่ VOIDED)`
   (predicate ของ `ap-due-alerts` + กัน VOIDED — ใบที่ void แบบจ่ายวันเดียวยังถือ `paidAt` อยู่ `lifecycle:859`) · `paidAt` ของใบ = วันที่เอกสาร ไม่ใช่เวลากดโพสต์ ·
   ตรวจ **ใบที่ผูก** และ **ใบอื่นจากแม่แบบเดียวกัน (`fromTemplateId`) ที่ `documentDate` อยู่ในงวดเดียวกัน** (คนกด "ใช้" สร้างร่างเองแล้วจ่ายทางนั้น) — เจอใบจ่ายแล้ว → ผูกใบนั้น → `PAID`, `paidAt` = ของใบ (ไม่มี = ตอนนี้), `paidById null`, งาน → `DONE` + `completedAt`
2. ใบที่ผูกถูก soft-delete หรือ `VOIDED` → ไม่แตะ (หน้าแสดง "ร่างถูกลบ" + ปุ่ม "สร้างร่างใหม่") — cron **ไม่**สร้างซ้ำเอง กันวนลูป
3. ระยะตามวันไทย: `วันนี้ < due` → ไม่ทำอะไร (เตือนไปตอนสร้างแล้ว) · `วันนี้ = due` → งาน priority `HIGH` + ชื่อ "ครบกำหนดวันนี้" +
   `notify('DUE_TODAY')` · `วันนี้ > due` → งาน `HIGH` + ชื่อ "เกินกำหนด N วัน" + `notify('OVERDUE')` **วันละครั้ง** —
   ทั้งสองกรณีข้ามเมื่อ `lastRemindedOn = วันนี้` แล้วเขียน `lastRemindedOn` หลังทำ
4. งานถูกลบ/ไม่พบ (คนลบงานเอง) → ไม่สร้างใหม่ (งวดยังอยู่บนหน้า) · คนกด DONE ที่งานโดยไม่จ่าย → งวดยัง PENDING — cron **ไม่เปิดงานกลับและไม่แก้ชื่องานที่ DONE** (เคารพการกดของคน) ช่องทางที่ยังเตือนคือหน้าบิลประจำ + การ์ด + LINE
5. **งวด `PAID` ที่ระบบตั้งเอง (`paidById null`)** ถูกสแกนด้วย: ใบที่ผูกไม่ผ่าน `isExpenseDocumentPaid` อีกแล้ว (ถูก void/ลบ) → ถอยกลับ `PENDING` + งานกลับ `TODO` + log · งวดที่คนบันทึกเอง (`paidById` มีค่า) ไม่ถอยกลับ
6. **งวด `PAID` ที่คนบันทึกเอง (`paidById` มีค่า) แต่ใบที่ผูกยังไม่ผ่าน `isExpenseDocumentPaid`** = มุมมอง "จ่ายแล้ว · ยังไม่ลงบัญชี" (`PAID_UNPOSTED`) — งานใน /todos **ไม่ปิด** แต่เปลี่ยนชื่อเป็น
   `ลงบัญชีใบ EX-… · <ชื่อบิล> (จ่ายแล้ว บันทึกเอง)` priority `MEDIUM` (ไม่มีร่าง = `สร้างและลงบัญชีใบรายจ่าย · <ชื่อบิล>`) · LINE หยุด · การ์ดแดชบอร์ดไม่นับ ·
   เมื่อใบผ่าน `isExpenseDocumentPaid` → งาน `DONE` (`paidById/paidAt/paidNote` คงเดิม — ประวัติว่าใครบอกว่าจ่ายแล้ว) · ตอนนี้รายจ่ายจริงจึงไม่มีวันหายจากบัญชีแบบเงียบ

**กติการ่วม:** ไม่มีผู้ใช้ระบบ (`isSystemUser`) = Sentry + จบรอบ (เหมือน cron เดิม) · ต่อแถว try/catch — แถวเดียวพังไม่หยุดรอบ ·
`tick()` ไม่ throw · log สรุป `created/paid/reminded/failed` · ทุกการเทียบวันใช้ `bangkokStartOfDay`/`bangkokDayDiff` ที่มีอยู่.

### 7.3 งานใน /todos (หนึ่งงานต่อหนึ่งงวด — ไม่มีงานซ้ำ)

| ช่อง | ค่า |
|---|---|
| `title` | `บิลประจำ: <ชื่อบิล> · ครบกำหนด 29 ต.ค. 69` → เมื่อถึง/เกิน: `… · ครบกำหนดวันนี้` / `… · เกินกำหนด 2 วัน` (cron แก้ title ของงานเดิม) |
| `description` | ผู้รับเงิน · สาขา · ยอดประมาณ · ร่าง `EX-…` (หรือ "สร้างร่างไม่สำเร็จ") · ลิงก์ `/expenses/recurring-bills?month=YYYY-MM` |
| `priority` | `MEDIUM` ตอนสร้าง → `HIGH` ตั้งแต่วันครบกำหนด |
| `dueDate` | = `dueDate` ของงวด · `branchId` = สาขาของแม่แบบ · `assigneeId` null · `createdById` = ผู้ใช้ระบบ |
| `tags` | `['recurring-bill', 'rb:<occurrenceId>']` — กันซ้ำด้วย `tags: { hasEvery: [...] }` + `deletedAt null` (รวมงานที่ DONE แล้ว) |
| ปิดงาน | `PAID`/`SKIPPED` (ทั้งจาก cron และจากหน้า) → `DONE` · เปิดงวดใหม่ (`reopen`) → งานกลับเป็น `TODO` |

**ข้อสมมติที่ builder ต้องตรวจตอนเขียนแผน:** งานที่ไม่มี `assigneeId` ปรากฏใน "งานของทีม" ให้ OWNER/ACCOUNTANT ทุกสาขาเห็น
(`TodosService.findAll` มี visibility filter — ถ้าไม่เห็นข้ามสาขา ต้องตั้ง `branchId = null` แล้วใส่ชื่อสาขาใน title แทน).

### 7.4 ท่อ LINE (`RecurringBillNotifier`) — ก้อนนี้ต่อท่อ ไม่ส่งจริง

- interface `{ notify(event: RecurringBillEvent): Promise<void> }` · `RecurringBillEvent = { kind: 'UPCOMING'|'DUE_TODAY'|'OVERDUE',
  occurrenceId, templateName, vendorName, branchName, dueDate, daysOverdue, amount, documentNumber|null, link }`
- ค่าเริ่มต้น `LoggingRecurringBillNotifier`: หาผู้รับ = ผู้ใช้ที่ยังใช้งาน role ∈ `RECURRING_BILL_NOTIFY_ROLES` (`packages/shared`:
  `['OWNER', 'ACCOUNTANT']` — "ฝ่ายบัญชี" = role ACCOUNTANT; ผจก.การเงินไม่อยู่ในคำตัดสิน) ทุกสาขา · ประกอบข้อความตามแบบในกระดาน 2 ·
  **เขียน log อย่างเดียว** ไม่แตะ `NotificationLog` · ก้อน 7 เปลี่ยนเฉพาะ provider เป็น LINE internal notify
- ข้อความ (ภาษาไทย ไม่มีอีโมจิ): บรรทัด 1 `[บิลประจำ] เกินกำหนด 2 วัน` / `ครบกำหนดวันนี้` / `ครบกำหนดใน 3 วัน` · บรรทัด 2 ชื่อบิล (สาขา) ·
  บรรทัด 3 `ครบกำหนด 24 ต.ค. 69 · ยอดประมาณ 1,284 บาท` · บรรทัด 4 `ร่างใบรายจ่าย EX-… รอจ่าย` หรือ `ยังไม่มีร่าง` · บรรทัด 5 ลิงก์หน้าบิลประจำ

## 8. API (`recurring-bills.controller.ts` ในโมดูล `expense-documents`) — `@Roles` OWNER · FINANCE_MANAGER · ACCOUNTANT · BRANCH_MANAGER

| Method | Path | ทำอะไร |
|---|---|---|
| GET | `/recurring-bills?month=YYYY-MM&branchId=` | แถวของเดือน = งวดที่ `dueDate` อยู่ในเดือน **รวมงวดที่ยังไม่สร้าง** (คำนวณจากแม่แบบ — สถานะ `UPCOMING`, `occurrenceId null`) + `summary { upcoming, pending, dueToday, overdue, paid, skipped, amountRemaining }` (`amountRemaining` = Σ ยอดประมาณของ upcoming+pending+dueToday+overdue) · BM เห็นเฉพาะสาขาตัวเอง (`getBranchScope`) |
| POST | `/recurring-bills/:occurrenceId/mark-paid` `{ note?: ≤200, paidAt?: date ≤ วันนี้ }` | `PENDING → PAID` (`paidById` = ผู้กด) · งาน**ไม่ปิด** แต่กลายเป็นงาน "ลงบัญชีใบ …" (ขั้น B ข้อ 6) · 409 ถ้าไม่ใช่ PENDING |
| POST | `/recurring-bills/:occurrenceId/skip` `{ reason: 5–200 }` | `PENDING → SKIPPED` · งาน DONE |
| POST | `/recurring-bills/:occurrenceId/reopen` | `PAID(ที่บันทึกเอง)/SKIPPED → PENDING` · งานกลับ TODO · PAID ที่ระบบตั้งจากใบ = 409 ข้อความ "งวดนี้จ่ายผ่านใบ EX-… — ถ้ายกเลิกใบนั้น ระบบจะเปิดงวดให้เองในรอบถัดไป" (ขั้น B ข้อ 5) |
| POST | `/recurring-bills/:occurrenceId/create-draft` | สร้างร่างให้งวดที่ `expenseDocumentId` null หรือใบถูกลบ/VOIDED · 409 ถ้ามีร่างที่ยังอยู่ |
| POST/PATCH | `/expense-templates` (เดิม) | DTO เพิ่ม `recurrence`, `recurringMonth`, `reminderLeadDays`, `startsOn` · validation: `isRecurring` ⇒ `recurrence` + `recurringDay` บังคับ · QUARTERLY ⇒ `recurringMonth` 1–3 · YEARLY ⇒ 1–12 · MONTHLY ⇒ ต้องว่าง · `documentType` ต้องเป็น `EXPENSE` · บันทึกแล้ว service เรียก**ขั้น A** ให้แม่แบบนั้นทันที (ไม่รอ 08:05) |

สถานะที่ส่งให้หน้าจอ (คำนวณตอนอ่าน): `UPCOMING` (ยังไม่สร้าง — ฉายเฉพาะงวดที่ `dueDate − leadDays > วันนี้`; งวดที่หน้าต่างเปิดแล้วแต่ยังไม่มีแถว = cron วันนี้ยังไม่รัน → `UPCOMING` + `awaitingSystem: true` ป้าย "รอระบบสร้าง (รอบ 08:05)"; งวดที่ผ่านไปแล้วและไม่มีแถว**ไม่ฉาย**) · `PENDING` (รอจ่าย, `daysUntilDue > 0`) · `DUE_TODAY` · `OVERDUE` (`daysOverdue`) ·
`PAID` · **`PAID_UNPOSTED`** (จ่ายแล้ว บันทึกเอง แต่ใบยังไม่ลงบัญชี — ขั้น B ข้อ 6) · `SKIPPED` (`skippedById null` = ระบบข้ามเพราะงวดหลุด) · ธง `documentMissing` เมื่อร่างไม่มี/ถูกลบ/VOIDED · `summary` เพิ่ม `paidUnposted`. AuditLog หลัง commit: `RECURRING_BILL_MARKED_PAID` /
`RECURRING_BILL_SKIPPED` / `RECURRING_BILL_REOPENED` (entity `recurring_bill_occurrence`).

**การ์ดแดชบอร์ด** (`computeAlerts`): นับงวด `PENDING` (ตามสาขาที่กรอง) ที่ `dueDate ≤ วันนี้ + 3 วัน` → `type: 'recurring_bills_due'`,
`severity: 'critical'` ถ้ามีเกินกำหนด ไม่งั้น `'warning'`, `message: 'บิลประจำ N รายการครบกำหนดใน 3 วัน · เกินกำหนด M'`,
`link: '/expenses/recurring-bills'` · เว็บเพิ่มไอคอน `alertIconMap.recurring_bills_due = CalendarClock`.

## 9. หน้าจอ (mockup `2CM7jqAmVoaRHSbaxBXQdr`)

1. **หน้า `/expenses/recurring-bills` "บิลประจำ"** (กระดาน 1) — เมนู รายจ่าย › บิลประจำ (OWNER/FM/ACCOUNTANT/BM) + ปุ่มบนหัวหน้า `/expenses`
   ข้าง "รายการโปรด" · เลือกเดือน (ค่าเริ่มต้นเดือนนี้) · ชิปสรุป · ตาราง: บิล/ผู้รับเงิน · สาขา · ครบกำหนด (+ "อีก N วัน"/"เกิน N วัน") ·
   ยอดประมาณ · สถานะ (ป้ายมีไอคอน ไม่ใช้สีอย่างเดียว · "จ่ายแล้ว · ยังไม่ลงบัญชี" เป็นป้ายแยก + ชิปสรุปแยก) · ร่าง/ใบ · ปุ่ม เปิดร่าง / จ่ายแล้ว / ข้าม / เปิดใหม่ / สร้างร่าง · แถว `UPCOMING`
   บอกวันที่ร่างจะถูกสร้าง · ไม่มีบิล = empty state ชี้ปุ่ม "+ บิลประจำ" · มือถือ: ตารางเลื่อนแนวนอนในกล่อง
2. **การ์ดแดชบอร์ด + งานใน /todos + ข้อความ LINE** (กระดาน 2) — การ์ดใช้ `alertSeverityStyles` เดิม · งานแสดงชื่อ/priority/tag ตามข้อ 7.3
3. **กล่อง "ตั้งบิลประจำ"** (กระดาน 3) — เปิดจากปุ่ม "+ บิลประจำ" บน `/expenses/favorites` และปุ่ม "แก้ไข" บนการ์ดแม่แบบที่เป็นบิลประจำ ·
   ช่อง: ชื่อบิล* · ผู้รับเงิน · สาขา* · บัญชีค่าใช้จ่าย (ตัวเลือกชุดเดียวกับฟอร์มรายจ่าย `ItemLinesSection` → `/chart-of-accounts/grouped` · DTO แม่แบบตรวจรหัสด้วย regex เดียวกับบรรทัดใบรายจ่าย `^5\d-\d{4}$` ไม่งั้นร่างแก้ผ่านฟอร์มไม่ได้ · ค่าเริ่มต้น `53-1302` ตัวเดิมของ `instantiate`) · รายละเอียด ·
   ยอดประมาณ · ความถี่ (รายเดือน | ราย 3 เดือน | รายปี) · วันครบกำหนด 1–31 + คำอธิบายเดือนสั้น · เดือน (เฉพาะราย 3 เดือน/รายปี) ·
   เตือนล่วงหน้า (วัน, ค่าเริ่มต้น 3) · เริ่มนับงวดแรกตั้งแต่ (วันที่, ค่าเริ่มต้นวันนี้) · บรรทัดพรีวิว "งวดถัดไป … · เตือน …" คำนวณจาก
   ฟังก์ชันใน `packages/shared` ตัวเดียวกับ API · การ์ดแม่แบบบนหน้า favorites แสดง "ทุกวันที่ 25 · รายเดือน · เตือน 3 วันก่อน"
   แทน "ทุกวันที่ X" เดิม · ปุ่ม "ใช้" บนการ์ดบิลประจำเปลี่ยนเป็น **"เปิดร่างงวดนี้"** (เปิดร่างของงวดปัจจุบัน หรือสร้างผ่าน `create-draft`) กันร่างซ้ำ · ปิดบิล = ติ๊ก `isRecurring` ออก (งวดที่สร้างแล้วคงอยู่ ไม่สร้างงวดใหม่) · ลบแม่แบบ = soft delete (งวด PENDING
   ที่ค้างยังแสดงบนหน้าจนกว่าจะจ่าย/ข้าม — บิลที่เลิกใช้แต่ยังค้างจ่ายต้องไม่หายเงียบ)

## 10. สิทธิ์

- ตั้ง/แก้บิล: role เดิมของ `/expense-templates` (OWNER/BM/FM/ACCOUNTANT) · BM สาขาตัวเอง (service บังคับ — route `:id` guard ไม่ครอบ)
- หน้าบิลประจำ + mark-paid/skip/reopen/create-draft: OWNER/FM/ACCOUNTANT ทุกสาขา · BM สาขาตัวเอง fail-closed
- ยอดเงินไม่ใช่ข้อมูลต้นทุนสินค้า — ไม่มีการตัดฝั่ง server ตาม role

## 11. ที่ builder ตัดสินเอง / ที่ยังเปิด

- ชื่อไฟล์/โฟลเดอร์หน้าเว็บ (`pages/RecurringBillsPage/`, `components/expense-templates/RecurringBillDialog.tsx`) · วิธีเลือกบัญชี/ผู้รับเงินใน
  dialog (ใช้ component เดิมของฟอร์มรายจ่ายถ้ามี ไม่งั้น input ธรรมดา + datalist ผู้รับเงินจาก `/suppliers`)
- `documentDate` ของร่าง = วันครบกำหนด (ข้อ 7) — prod ไม่มีแม่แบบเดิมเลย (0 แถว ตรวจ 26/10) จึงไม่มีพฤติกรรมเก่าให้รักษา
- บิลที่ตั้ง `reminderLeadDays = 0` → สร้างร่าง+เตือนวันครบกำหนดเลย (ถูกต้องตามนิยาม)
- ยังเปิด: ส่ง LINE จริง (ก้อน 7) · บิลมีวันสิ้นสุด · หลายสาขาจากแม่แบบเดียว · ปุ่ม "ตั้งเป็นบิลประจำ" จากหน้าใบรายจ่าย (copy ผู้รับเงิน/บรรทัด)

## 12. เทสที่ต้องมี

- `packages/shared` ตัวเลขทองข้อ 6 ทั้งหมด (วันสั้น · ไตรมาส · ปี/อธิกสุรทิน · startsOn)
- **integration บน Postgres จริง** `apps/api/src/modules/expense-documents/__tests__/recurring-bills.integration.spec.ts` (CI glob `EXPDOC_FILES` ครอบอัตโนมัติ): แม่แบบจริง → ขั้น A ได้ใบ `DRAFT` ที่ `fromTemplateId` / `documentDate = dueDate` / บรรทัด / เลขที่ + แถวงวด + Todo → โพสต์ใบจริง (same-day) → ขั้น B เป็น `PAID` งาน DONE → void ใบ → ถอยกลับ `PENDING` (ข้อ 5) · mark-paid มือแล้วโพสต์ → `PAID_UNPOSTED` → `PAID` งาน DONE (ข้อ 6) · งวดหลุดเกิน 7 วัน → `SKIPPED` ระบบ ไม่มีร่าง
- ก่อน deploy: ยืนยันผู้ใช้ระบบ (`isSystemUser`) มีบน prod ผ่าน Cloud SQL proxy (`seed-production.ts:238` seed ให้ แต่ role MCP อ่านตาราง `users` ไม่ได้)
- `RecurringBillsService` (jest, prisma mock): ขั้น A สร้างงวด+ร่าง+งาน · รันซ้ำวันเดียวกันไม่ซ้ำ (unique + tag) · งวดหลุด > 7 วัน = SKIPPED ระบบ · ร่างพังยังได้งาน ·
  ขั้น B จ่ายผ่านใบ → PAID + งาน DONE · ล้างด้วย settlement → PAID · วันครบ → HIGH + notify ครั้งเดียว · เกิน → notify วันละครั้ง
  (`lastRemindedOn`) · PAID/SKIPPED ไม่ถูกแตะ · ใบถูกลบ → `documentMissing` ไม่สร้างซ้ำ
- controller/service: mark-paid/skip/reopen/create-draft สถานะผิด = 409 · BM ข้ามสาขา = 403 · GET รวมแถว UPCOMING + summary
- `computeAlerts` การ์ด warning/critical/ไม่มี
- web (vitest): หน้าแสดง 6 สถานะ + ปุ่มตามสถานะ · dialog validation + พรีวิวงวดถัดไป · การ์ด favorites ข้อความใหม่

## 13. ผลตรวจ builder-check (26/10) — คำตัดสินของผม (ไม่มีข้อที่ต้องให้เจ้าของตอบ)

| # | ประเด็นที่ผู้ตรวจพบ | ตัดสิน |
|---|---|---|
| 1 | ช่องบัญชีในกล่อง: `53-1302` เป็นรหัสรูปแบบ FINANCE แต่ใบรายจ่ายทุกใบลงสมุด SHOP ด้วยรหัสที่ใส่มา (quirk เดิมของโมดูล) · DTO บรรทัดปฏิเสธรหัส `S` · ใบรายจ่ายต้องมีสาขาเสมอ | ทำเหมือนฟอร์มรายจ่ายเดิมทุกประการ (ตัวเลือกบัญชีชุดเดียวกัน + regex เดียวกัน) — ไม่แก้กติกาผังในก้อนนี้ · **บิลประจำผูกสาขาเสมอ** เหมือนใบรายจ่ายทุกใบ (รายจ่ายส่วนกลางเลือกสาขาหลักเหมือนที่ทำกันวันนี้) — mockup แถว "ทุกสาขา (ส่วนกลาง)" แก้แล้ว |
| 2 | งวด PAID จากใบ แล้วใบถูก void/ลบทีหลัง — สเปกเดิมสแกนแค่ PENDING ⇒ PAID ค้างตลอดกาล + reopen 409 ชี้ทางตัน | ขั้น B ข้อ 5: สแกน PAID ที่ `paidById null` ด้วย ใบไม่ paid แล้ว → ถอยกลับ PENDING + งานกลับ TODO · `isExpenseDocumentPaid` กัน VOIDED/deleted · ข้อความ 409 ของ reopen บอกว่าระบบเปิดให้เองในรอบถัดไป |
| 3 | คนกด DONE ที่งานโดยไม่จ่าย — cron จะเปิดกลับ/แก้ชื่อ/ไม่แตะ? | ไม่แตะงานที่ DONE (เคารพคน) · งวดยัง PENDING เตือนต่อทางหน้า + การ์ด + LINE |
| 4 | สวิตช์ `templates_enabled` (gate create/update/instantiate + ซ่อนหน้ารายการโปรด) ครอบบิลประจำไหม | **สวิตช์เดียว**: ปิด = cron ข้ามทั้งรอบ (log) · การ์ดไม่ออก · เมนู/หน้าบิลประจำซ่อนแบบเดียวกับรายการโปรด · endpoint ตอบ 403 ข้อความเดิม |
| 5 | โควต้า `max_templates_per_user` (20) นับบิลประจำด้วยไหม — ฝ่ายบัญชีตั้ง 6 บิล × 4 สาขาก็เต็ม | **ยกเว้น** — โควต้านับเฉพาะแม่แบบที่ไม่ใช่บิลประจำ (บิลเป็นของร้าน ไม่ใช่รายการโปรดส่วนตัว) · ป้าย `(n/20)` บนหน้ารายการโปรดนับตามนั้น |
| 6 | ร่างที่คนสร้างเองจากแม่แบบเดียวกัน (ปุ่ม "ใช้"/QuickStart) ไม่ถูกผูกงวด ⇒ จ่ายทางนั้นแล้วงวดยังเกินกำหนด | ขั้น B ข้อ 1 ตรวจใบอื่นจาก `fromTemplateId` เดียวกันที่ `documentDate` อยู่ในงวด → ผูกและปิดให้ · การ์ดบิลประจำบนหน้ารายการโปรดเปลี่ยนปุ่มเป็น "เปิดร่างงวดนี้" · QuickStart ในฟอร์มคงเดิม (ครอบด้วยการตรวจข้างต้น) |

ค่าเริ่มต้นอื่นของผู้ตรวจที่รับมาทั้งหมด: ขั้น A ไม่ใช่ tx เดียว (ข้อ 7) · เมนู ACCOUNTANT/BM วาง "บิลประจำ" ข้าง "บันทึกรายจ่าย" ของ zone เดิม ไม่สร้างหมวดใหม่ (ตรวจ `resolveZoneForPath` ว่าไม่เด้งออก) ·
การ์ดแดชบอร์ด `count = N + M` · ผู้รับเงินใช้ `VendorCombobox` เดิม (`vendorName` + `vendorSupplierId`) · ยอดประมาณว่าง → ร่างใส่ 0.01 ตามเดิม แต่หน้า/LINE/ยอดรวมแสดง "—" ·
ฟังก์ชันวันที่ใน `packages/shared` เขียนแบบ TZ-free ด้วย `Intl` + `Asia/Bangkok` (แบบ `appointment-confirmation.ts`) เพราะ `apps/api/src/utils/date.util.ts` เว็บ import ไม่ได้ · build shared ก่อนรัน jest ·
ลบ `ExpenseRecurringCron` ต้องแตะ `expense-documents.module.ts`, spec เดิม, คอมเมนต์ `cli/test-pack/_module.ts`, `docs/superpowers/tracking/A1-settings-audit.md` ·
สร้าง Todo ด้วย prisma ตรง (ห้ามผ่าน `TodosService` — `currentActor` ปฏิเสธ system user) · ข้อสมมติ §7.3 (งานไม่มีผู้รับเห็นข้ามสาขา) **ยืนยันแล้ว**จากโค้ด.

## 14. ผลตรวจ scrutinize (26/10) — แก้แล้ว (เจ้าของ "ok")

| # | ที่พบ | แก้ในสเปก |
|---|---|---|
| 1 | "จ่ายแล้ว บันทึกเอง" ปิดงาน+หยุดเตือนทั้งที่ร่างยังไม่ลงบัญชี ⇒ รายจ่ายจริงหายจากบัญชีเงียบ | มุมมอง `PAID_UNPOSTED` + ชิปสรุปแยก · งานไม่ปิดแต่กลายเป็นงาน "ลงบัญชีใบ …" จนใบโพสต์ (ขั้น B ข้อ 6) |
| 2 | ไล่ตามงวดหลุด 3 งวด + ฉาย UPCOMING ทุกงวดที่ไม่มีแถว ⇒ ร่างเกินกำหนดของบิลที่จ่ายไปแล้ว และเดือนเก่าโชว์ "รอถึงรอบ" | งวดหลุดเกิน 7 วัน = `SKIPPED` ระบบ ไม่มีร่าง/งาน/LINE · ฉาย UPCOMING เฉพาะงวดที่หน้าต่างยังไม่เปิด (+ `awaitingSystem` สำหรับวันที่ cron ยังไม่รัน) |
| 3 | วันที่ร่าง = วันสร้าง ทำให้บิลวันที่ 1 ตกเดือนก่อน เสี่ยงงวดปิด | `documentDate` = วันครบกำหนด (ไม่มีผู้ใช้เดิมให้รักษา · `post()` ไม่ห้ามวันอนาคต) |
| 4 | ทางสร้างร่างด้วยผู้ใช้ระบบไม่เคยพิสูจน์บนฐานจริง (เทสเดิม mock `instantiate`) | integration spec บน Postgres จริงใน §12 + ตรวจผู้ใช้ระบบบน prod ก่อน deploy |

ข้อเท็จจริงที่ยืนยันแล้ว: prod `expense_templates` = 0 แถว (26/10) · `assertTemplatesEnabled` ไม่มีแถว = เปิด · `approval_enabled = true` บน prod แต่ประเภทที่ต้องอนุมัติเป็นค่าเริ่มต้น (PAYROLL เท่านั้น) ·
`resolveAccountingPermissions` ปฏิเสธผู้ใช้ระบบ (`accounting-permissions.ts:54`) แต่ไม่อยู่บนทางสร้างร่าง — **ห้ามเสียบมันเข้าทาง `create()`** · โควต้า 20: เติม `isRecurring: false` ใน `count` (`expense-templates.service.ts:113-116`).

## 15. ผลรอบตรวจออกแบบรอบ 2 (26/10 — 4 มุมมอง 45 ข้อ · ขั้นคัดค้านล้มเพราะโควตาโมเดล จึงตรวจเองกับโค้ด) — **ส่วนนี้ทับทุกข้อที่ขัดกันด้านบน**

### 15.1 ข้อมูล (แก้ §5)
- enum สองตัวอยู่บล็อก enum ส่วนบนของ schema · relation ไป User ตั้งชื่อ `RecurringBillPaidBy` / `RecurringBillSkippedBy` + back-relation บน `User` · `todoId String? @unique` · FK: `templateId` Restrict · `expenseDocumentId`/`todoId` SetNull
- **ไม่มี `deletedAt` บนตารางงวด** (`/// งวดไม่ถูกลบ — เปลี่ยนสถานะเป็น SKIPPED เท่านั้น` ตามกติกา exception ของ rules/database) — unique เต็มจึงปลอดภัย
- เพิ่ม `estimatedAmount Decimal? @db.Decimal(12,2)` snapshot จาก `prefilledData.sampleAmount` ตอนสร้างงวด (null = "—") · ยอดรวมทุกที่ใช้ `Prisma.Decimal`
- `lastRemindedOn DateTime? @db.Date` (เขียน `bangkokMidnight` ของวันไทย)
- `startsOn` เก็บเป็น**เที่ยงคืนไทย**เสมอ (DTO รับ `YYYY-MM-DD` · ค่าเริ่มต้น = เที่ยงคืนไทยของวันที่สร้าง · ต้องไม่ย้อนเกิน 90 วันและไม่เกิน 1 ปีข้างหน้า) และเทียบกับ `dueDate` ด้วย**วันปฏิทินไทย** (`dueDate ≥ startsOn` วันเดียวกันนับ) — บิล day 26 ตั้งวันที่ 26 เวลา 14:00 → งวดแรก = 26 เดือนนี้
- migration: backfill `recurrence='MONTHLY'`, `starts_on` = เที่ยงคืนไทยของวันนี้ **เฉพาะ `document_type = 'EXPENSE'`** และ `is_recurring = false` ให้ประเภทอื่น · ดรอป index `expense_templates_is_recurring_recurring_day_idx` เพิ่ม `@@index([isRecurring, deletedAt])` · เติม `recurring_bill_occurrences` ใน `WIPE_TABLES` ของ `factory-reset-tables.ts` (ไม่งั้น `factory:reset` abort) · `wipe:expenses` ล้างงวดผ่าน CASCADE (จด docblock)
- `dueDate` = เที่ยงคืนไทย (เก็บ/เทียบ) · `documentDate` ของร่าง และ `Todo.dueDate` = **เที่ยงวันไทย** ของวันเดียวกัน (`getUTCHours() === 5`) — ห้ามส่งเที่ยงคืนเข้า `validatePeriodOpen` (อ่านเดือนตาม TZ ของโปรเซส)

### 15.2 "จ่ายแล้ว" / สถานะใบ (แก้ §7 ข้อ 1–2, §8)
- **`isExpenseDocumentPaid(doc) = doc.deletedAt == null && doc.status === 'POSTED' && doc.paidAt != null`** — ตัดข้อ settlement ออก (SE ร่าง/จ่ายบางส่วนไม่ใช่จ่ายแล้ว; SE ล้างครบจะพาใบ EX ไป `POSTED + paidAt` เอง `vendor-settlement.template.ts`)
- ร่างจาก `instantiate` ไม่มี `paymentMethod`/`depositAccountCode` ⇒ โพสต์ได้เป็น `ACCRUAL` (ตั้งหนี้ `paidAt null`) เท่านั้น (`status-transition.service.ts:50-54`, `lifecycle:288`) ⇒ **กล่องตั้งบิลเพิ่มช่อง "วิธีจ่าย" + "บัญชีที่จ่าย" (ไม่บังคับ)** เก็บใน `prefilledData.paymentMethod` / `prefilledData.depositAccountCode` (`create()` รับอยู่แล้ว `create.dto.ts:66-73`) · ไม่ตั้ง = หน้าบิลแสดงคำเตือน "ยังไม่ตั้งวิธีจ่าย — ใบจะลงเป็นตั้งหนี้ ต้องทำใบจ่ายเจ้าหนี้ต่อ"
- "ใบที่ยังอยู่" = `deletedAt == null && status !== 'VOIDED'` (ครอบ DRAFT / PENDING_APPROVAL / APPROVED / ACCRUAL / POSTED) · `documentMissing` = ไม่มีใบ / ถูกลบ / VOIDED · ป้ายใบตามสถานะจริง: DRAFT "ร่าง" · PENDING_APPROVAL "รออนุมัติ" · APPROVED "อนุมัติแล้ว รอลงบัญชี" · ACCRUAL "ตั้งหนี้แล้ว รอจ่าย" (ปุ่ม "เปิดใบ" — ทำใบจ่ายเจ้าหนี้ต่อ) · VOIDED "ใบถูกยกเลิก EX-…" · ลบ "ร่างถูกลบ" · ไม่มี "ยังไม่มีร่าง" · ปุ่ม "สร้างร่างใหม่" เฉพาะ `documentMissing`
- ด่านอนุมัติ = ประเภทใน `approval_required_doc_types` **หรือ** ยอด ≥ `approval_threshold` (50,000) (`lifecycle:265-283`) และบน prod `approval_enabled = true` ⇒ เส้นทางจริงของร่าง = ส่งขออนุมัติ → อนุมัติ → auto-post · ชื่อปุ่ม/งานใช้คำ "ลงบัญชี" กลาง ๆ
- `paidAt` ของงวดที่ระบบตั้งจากใบ = `min(doc.paidAt, now)` (ใบจ่ายสดก่อนกำหนดได้ `paidAt` = วันที่เอกสารในอนาคต)
- ร่างลงวันที่ครบกำหนด: โพสต์แบบจ่ายสดก่อนกำหนดจะลง JE/ตัดเงินสดวันที่อนาคต (`expense-same-day.template.ts:214,225`) — หน้าบิลประจำและคำอธิบายงานบอกว่า "ถ้าจ่ายก่อนกำหนด ให้แก้วันที่เอกสารเป็นวันจ่ายจริงก่อนโพสต์" (แก้ได้ขณะ DRAFT `expense-document-create.service.ts:1154`)

### 15.3 การจับคู่ใบ (แก้ §7 ขั้น A ③ และ B ข้อ 1)
- ขั้น A ③ ผูก "ใบที่มีอยู่แล้ว" เฉพาะใบที่ `createdById = ผู้สร้างงวด (ระบบ/ผู้บันทึก)` และ `documentDate` = วันครบกำหนด (ร่างของรอบก่อนที่ ③ ล้ม) — ไม่ผูกร่างที่คนสร้างจาก QuickStart (ร่างกำพร้าจาก QuickStart เป็นพฤติกรรมเดิม นอกขอบเขต)
- B ข้อ 1 ใบอื่นจากแม่แบบเดียวกัน: ค้น `fromTemplateId` เดียวกัน **ที่ยังไม่ถูกผูกงวดใด** (`recurringBillOccurrence: null`) และ `documentDate` อยู่ใน **หน้าต่างของงวด** `[windowOpens(งวดนี้), windowOpens(งวดถัดไป))` (วันไทย จาก shared) — ใบเดียวเข้าหลายงวดผูกงวดที่ `dueDate` ใกล้สุด · P2002 = ข้ามแถวพร้อม log ไม่ใช่ failed
- เมื่อย้ายการผูกไปใบอื่น: ร่างเดิมที่ยัง `DRAFT` และ `createdById = ผู้สร้างงวด` → `tx.expenseDocument.update({ deletedAt })` ตรงใน tx เดียวกัน + `tx.auditLog.create` action `DELETED` reason "งวดจ่ายผ่านใบ EX-… แล้ว" (ไม่ผ่าน `lifecycle.softDelete` ที่ต้องการสิทธิ์)

### 15.4 ความถูกต้องเมื่อรันซ้อน/พร้อมกัน (แก้ §7 กติการ่วม)
- `tick()` ขอ `pg_try_advisory_lock(hashtext('recurring-bills:tick'))` ก่อน (Cloud Run min 1 max 10 instance รัน scheduler ทุกตัว) — ไม่ได้ล็อก = log แล้วออก · ปล่อยใน finally
- ทุก transition ของแถวงวดเป็น **compare-and-set** `updateMany({ where: { id, status: 'PENDING', ... } })` แล้วทำงานข้างเคียง (งาน/LINE/audit) เฉพาะ `count === 1` — ข้อ 3 ใช้ `where: { id, status: 'PENDING', NOT: { lastRemindedOn: today } }` **ก่อน** แก้งาน/notify · mark-paid/skip/reopen ใช้ CAS เดียวกัน (count 0 → 409 "สถานะเปลี่ยนแล้ว")
- `occurrence.create` ชน P2002 (instance อื่นสร้างก่อน) = `skipped` ไม่ใช่ `failed`
- แถว PENDING ที่ `todoId null` และไม่มีงาน tag `rb:<id>` เลย (ค้นรวมงานที่ DONE/ลบ) → สร้างงาน + `notify('UPCOMING')` ครั้งเดียว (ซ่อมเคส ④ ล้ม) · มีงาน tag นั้นแต่ถูกลบ = คนลบ → ไม่สร้างใหม่
- cron เขียนทับเฉพาะ `title`/`priority` ของงาน ไม่แตะ `description`/`checklist` ที่คนแก้

### 15.5 งวดหลุด / แก้แม่แบบ / แม่แบบถูกลบ
- งวดหลุดเกิน 7 วัน: แถว `SKIPPED` `skippedById null` เหตุผล **"งวดผ่านไปก่อนระบบเริ่มติดตาม"** (จริงทั้งกรณี cron หยุด/สวิตช์ปิด/ตั้งย้อนหลัง/แก้วัน) + **งาน MEDIUM หนึ่งใบ** "งวดหลุด — ตรวจว่าจ่ายแล้วหรือยัง: <ชื่อบิล> ครบ <วัน>" (ไม่มีร่าง ไม่มี LINE) · หน้าแสดงแถวพร้อมปุ่ม "เปิดใหม่" (→ PENDING + สร้างร่าง) / "จ่ายแล้ว" · ขั้น A ไล่จาก `max(startsOn, วันนี้ − 7 วัน − 1 งวด)` (ไม่สร้างแถว SKIPPED ย้อนหลังเป็นสิบ ๆ แถว)
- แก้ `recurrence`/`recurringDay`/`recurringMonth` หรือพลิก `isRecurring` false→true: service ตั้ง `startsOn = max(startsOn, วันนี้)` · งวด `PENDING` ที่ใบยังไม่ผ่าน `isExpenseDocumentPaid` → `SKIPPED` ระบบ เหตุผล "แม่แบบเปลี่ยนรอบ" + งาน DONE + ร่างระบบที่ยัง DRAFT ถูกลบตาม 15.3 (ใน tx เดียว) · แล้วเรียกขั้น A ทันที · validation ทำบน**แถวที่รวมแล้ว** `{...tpl, ...dto}` (`isRecurring=false` ⇒ service ล้าง `recurrence/recurringMonth` เอง · `recurringDay` 1–31 เสมอ)
- แม่แบบถูก soft-delete: งวดค้างยังแสดง แต่ `create-draft`/"เปิดร่างงวดนี้" ถูกซ่อน และ endpoint ตอบ 409 "แม่แบบถูกลบแล้ว — บันทึกจ่ายเอง หรือข้ามงวด" (`instantiate` ปฏิเสธแม่แบบที่ลบ `expense-templates.service.ts:174-178`) · GET ส่ง `templateDeleted: true`
- โหมดแก้ไขในกล่อง: ช่องสาขา**อ่านอย่างเดียว** ("ย้ายสาขา = ปิดบิลนี้แล้วตั้งใหม่") — `UpdateTemplateDto` ตัด `branchId` ทิ้งเงียบ · BM โหมดสร้างล็อกสาขาตัวเอง

### 15.6 ผู้ใช้ระบบ / ผู้รับ / สิทธิ์
- หาผู้ใช้ระบบด้วย `{ isSystemUser: true, deletedAt: null }` — **ห้าม**ใส่ `isActive: true` (seed เป็น `isActive: false` `collections-foundation.seed.ts:24`) · ขั้น A ที่เรียกจากปุ่มบันทึกแม่แบบใช้**ผู้กด**เป็นผู้สร้างร่าง/งาน (ไม่พึ่งผู้ใช้ระบบ)
- ผู้รับ LINE: `{ isActive: true, deletedAt: null, isSystemUser: false, role: { in: RECURRING_BILL_NOTIFY_ROLES } }` (ผู้ใช้ระบบมี role OWNER ต้องถูกกัน) — ปักเทส
- สิทธิ์โพสต์/ยกเลิกใบเป็น**รายชื่อผู้ใช้**ใน SystemConfig `accounting_permissions` (`accounting-permissions.ts:26,54-70` — OWNER ได้ครบ role อื่นต้องถูกระบุชื่อ) ⇒ ก่อน deploy ตรวจว่า ACCOUNTANT ที่รับงานมี `EXPENSE_POST` (+`EXPENSE_APPROVE` สำหรับผู้อนุมัติ) · ข้อความงาน/409 เขียนเป็นข้อเท็จจริง ไม่สั่งให้ทำสิ่งที่อาจไม่มีสิทธิ์
- งานใน /todos มองเห็นได้ทุก role ทุกสาขา (รวม SALES — `todos.service.ts:48`, route ไม่จำกัด role) และ ACCOUNTANT ลบงานไม่ได้ (`todos.service.ts:292-296`) — **ยอมรับในก้อนนี้** (ปิดงานผ่านหน้าบิล ไม่ใช่ลบงาน) · ชื่องานใส่ชื่อสาขา · path ในคำอธิบายเป็นข้อความธรรมดา
- งาน `PAID_UNPOSTED` ยกเป็น `HIGH` ตั้งแต่วันครบกำหนด และคำอธิบายระบุ "ต้องลงบัญชีก่อนปิดงวด <เดือนของ dueDate>"
- เมนู: เพิ่ม `/expenses/recurring-bills` ให้**ครบทั้ง 4 role** (`resolveZoneForPath` เทียบ path ตรงตัว — ตกหล่น role เดียว = ถูกเด้ง) + เทส route-reachability · ห้ามเพิ่ม `/expenses/favorites` ให้ role เดียว
