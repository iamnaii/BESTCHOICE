# Finance Receivable Contact System (PEAK-style) — Design

**Date:** 2026-05-31
**Status:** v2 (post-scrutinize) — pending user review before plan
**Owner:** BESTCHOICE Finance module
**Scope:** เพิ่มระบบผู้ติดต่อ (Contact directory + Activity log) บนบัญชีไฟแนนซ์ภายนอก (`FinanceReceivable` / `ExternalFinanceCompany`) ตามแนวคิด PEAK Contact
**Revision v2:** ปิด blockers/majors จาก scrutinize — (1) log FK lazy-resolve, (2) ลบ `@@unique` ปลอม, (3) update sale workflow, (4) drop `FinanceCompanyGroup` YAGNI, (5) backfill idempotent guard, (6) เพิ่ม `promisedKeptAt`

---

## 1. Background

### 1.1 ปัญหา

หน้า [FinanceReceivablePage.tsx](apps/web/src/pages/FinanceReceivablePage.tsx) แสดงรายการเงินรับจากไฟแนนซ์ภายนอก (KK, KTC, GFIN ฯลฯ) ที่บริษัทรอรับโอนหลังขายเครื่องผ่อนผ่าน external finance ปัจจุบัน **ไม่มีเครื่องมือใดในระบบ** สำหรับ:

- จัดเก็บรายชื่อผู้ประสานงาน (AR Manager, Branch Manager) หลายคนต่อบริษัทไฟแนนซ์
- บันทึกประวัติการติดตามเงินรับที่ค้าง (โทรไปแล้วใครรับ ผลเป็นอย่างไร นัดโอนวันไหน)
- รู้ว่าใน receivable ที่ค้าง — ติดต่อล่าสุดเมื่อไหร่ ใครรับปาก แต่ไม่ส่ง

ฝั่ง overdue (in-house installment) มี `CallLog` + `PromiseSlot` ครบมาก แต่ออกแบบมาเพื่อ customer (legal-grade evidence trail, Yeastar CDR, dunning escalation) — ไม่เหมาะ reuse สำหรับ B2B finance follow-up

### 1.2 Existing state

- **`FinanceReceivable`** ([schema.prisma:3539](apps/api/prisma/schema.prisma#L3539)): `financeCompany` เป็น **free-text** ไม่ผูก FK กับ `ExternalFinanceCompany`
- **`ExternalFinanceCompany`** ([schema.prisma:6947](apps/api/prisma/schema.prisma#L6947)): มี `contactPerson` + `contactPhone` เป็น single field เดี่ยว เก็บได้ 1 คน/บริษัท
- ไม่มี contact log / activity tracking ใด ๆ บนฝั่ง external finance

### 1.3 PEAK Contact reference

PEAK Account ([peakaccount.com/peak-manual/peak-contact](https://www.peakaccount.com/peak-manual/peak-contact)) ใช้โครงสร้าง:

- **ผู้ติดต่อหลัก** (1 บริษัท): ชื่อกิจการ, เลขผู้เสียภาษี, ที่อยู่, ประเภท, กลุ่มผู้ติดต่อ, วงเงินขายเชื่อ, เครดิตเทอม
- **ผู้ติดต่อย่อย** (หลายคน/บริษัท): ชื่อ, ตำแหน่ง, โทร, อีเมล — มี flag "ตัวหลัก" (primary)
- **กลุ่มผู้ติดต่อ**: ชื่อกลุ่ม + คำอธิบาย เพื่อจัดหมวด
- PEAK เอง **ไม่มี activity log** — เราเสริมเองเฉพาะส่วนที่จำเป็นต่อการติดตามเงินรับ

---

## 2. Goals

1. รายชื่อผู้ประสานงานหลายคนต่อบริษัทไฟแนนซ์ พร้อม "ตัวหลัก" แบบ PEAK
2. บันทึก / ดูประวัติการติดต่อต่อ receivable แต่ละใบ
3. KPI denormalized บน receivable (ติดต่อล่าสุด, นัดล่าสุด, จำนวนครั้งติดต่อ) → ใช้ filter/sort ในตารางหลัก
4. Auto-flag broken promise เมื่อพ้นวันนัดแล้วยังไม่โอน
5. Migrate `FinanceReceivable.financeCompany` (text) ให้ผูก FK กับ `ExternalFinanceCompany` (PEAK source-of-truth pattern)

## 3. Non-Goals

- ❌ Channel EMAIL / LINE / MEETING (เก็บ enum extensible แต่ UI รอบนี้ CALL อย่างเดียว)
- ❌ Multi-slot promise (B2B ไม่ซับซ้อนเหมือนผ่อนลูกค้า — single promise พอ)
- ❌ Yeastar PBX auto-log สำหรับ B2B (manual log เท่านั้น)
- ❌ Voice memo upload
- ❌ Per-receivable credit limit alerting (มี PEAK-style field แต่ไม่ enforce รอบนี้)
- ❌ ลบ field `FinanceReceivable.financeCompany` (text) — รอ Phase 3 ภายหลัง
- ❌ Broadcast / mass-call campaign

---

## 4. Architecture Overview

2 ส่วนใหม่ + 1 ขยาย ตามแนวคิด PEAK Contact:

| ระดับ | ตาราง | PEAK Term | บทบาท |
|---|---|---|---|
| Master | `ExternalFinanceCompany` (ขยาย field) | ผู้ติดต่อหลัก | บริษัทไฟแนนซ์ (KK, KTC, GFIN) |
| Sub-contact | `FinanceCompanyContact` (ใหม่) | ผู้ติดต่อย่อย | เจ้าหน้าที่ AR/AM/Branch Mgr |
| Activity log | `FinanceReceivableContactLog` (ใหม่) | (PEAK ไม่มี) | ติดตามเงินรับ — บันทึกการโทรต่อ 1 receivable |

### Key design decisions (จาก brainstorm + scrutinize)

| # | Decision | เหตุผล |
|---|---|---|
| D1 | Standalone tables (ไม่ reuse `CallLog`) | แยก legal-grade customer evidence ออกจาก B2B follow-up; semantic ต่างกัน |
| D2 | Single promise per log | B2B ไฟแนนซ์ไม่ซับซ้อนเหมือน installment ลูกค้า; รับปากครั้งเดียว/log |
| D3 | Migrate `financeCompany` เป็น FK เต็มตัว | PEAK source-of-truth — บริษัท = 1 record |
| D4 | Channel = CALL only (UI), enum extensible | YAGNI สำหรับ email/Line/meeting; เก็บ enum slot ไว้รอบหน้า |
| D5 | Denormalize KPI (lastContactedAt ฯลฯ) บน FinanceReceivable | Filter/sort ตารางหลักโดยไม่ join นับ logs |
| D6 (post-scrutinize) | Lazy resolve FK ที่ contact-log create — upsert ExternalFinanceCompany จาก receivable.financeCompany ถ้ายังไม่มี | รองรับ in-flight receivables ที่ยัง pre-backfill — บันทึก log ได้เลย ไม่ติด deploy order |
| D7 (post-scrutinize) | ตัด `FinanceCompanyGroup` ออก scope | YAGNI — BESTCHOICE มีไฟแนนซ์ ≤10 ราย ไม่ต้องการ grouping |
| D8 (post-scrutinize) | ตัด address/branchCode/entityType/website ออก scope | ไม่ตรง use case "ติดต่อทวงเงิน" — เพิ่มภายหลังตามความจำเป็น |
| D9 (post-scrutinize) | เพิ่ม `promisedKeptAt` คู่กับ `promisedBrokenAt` | UI distinguish "นัดสำเร็จ vs ค้าง" โดยไม่ leak logic ข้าม table |

---

## 5. Schema Changes

### 5.1 ขยาย `ExternalFinanceCompany`

```prisma
model ExternalFinanceCompany {
  // ── เดิม ──
  id                    String    @id @default(uuid())
  name                  String    @unique
  defaultCommissionRate Decimal?  @map("default_commission_rate") @db.Decimal(5, 4)
  bankAccountInfo       Json?     @map("bank_account_info")
  notes                 String?
  isActive              Boolean   @default(true) @map("is_active")
  createdAt             DateTime  @default(now()) @map("created_at")
  updatedAt             DateTime  @updatedAt @map("updated_at")
  deletedAt             DateTime? @map("deleted_at")

  // ── ใหม่ (focused fields เพื่อ use case "ติดต่อทวงเงิน") ──
  taxId          String?  @map("tax_id")          // เลขผู้เสียภาษี 13 หลัก
  email          String?
  lineOaId       String?  @map("line_oa_id")
  creditTermDays Int?     @map("credit_term_days")

  // ── Deprecated (คงไว้เพื่อ back-compat ใน Phase 1-2) ──
  /// @deprecated ใช้ FinanceCompanyContact (isPrimary=true) แทน
  contactPerson String? @map("contact_person")
  /// @deprecated
  contactPhone  String? @map("contact_phone")

  // ── Relations ──
  contacts    FinanceCompanyContact[]
  receivables FinanceReceivable[]
  contactLogs FinanceReceivableContactLog[]
  commissions ExternalFinanceCommission[]

  @@map("external_finance_companies")
}
```

> **หมายเหตุ:** field address/website/entityType/branchCode/group ที่ PEAK มี — ตัดออกจาก scope รอบนี้ (D8). เพิ่มภายหลังถ้ามี use case ชัด (เช่น ส่งจดหมาย, ออกใบกำกับภาษี)

### 5.2 `FinanceCompanyContact` (ใหม่)

```prisma
model FinanceCompanyContact {
  id                       String   @id @default(uuid())
  externalFinanceCompanyId String   @map("external_finance_company_id")
  name                     String
  position                 String?
  department               String?
  phone                    String?
  email                    String?
  lineId                   String?  @map("line_id")
  notes                    String?
  isPrimary                Boolean  @default(false) @map("is_primary")
  isActive                 Boolean  @default(true)  @map("is_active")
  createdAt                DateTime @default(now()) @map("created_at")
  updatedAt                DateTime @updatedAt @map("updated_at")
  deletedAt                DateTime?

  company     ExternalFinanceCompany        @relation(fields: [externalFinanceCompanyId], references: [id])
  contactLogs FinanceReceivableContactLog[]

  @@index([externalFinanceCompanyId, isActive])
  @@map("finance_company_contacts")
}
```

> **Partial unique index (raw SQL — สำคัญ):**
> **ห้ามใส่ `@@unique([externalFinanceCompanyId, isPrimary])`** เพราะจะ block หลาย contact ที่ `isPrimary=false` (case ปกติของบริษัทที่มี 3 พนักงาน, none primary).
> ต้องใช้ raw SQL ใน migration:
> ```sql
> CREATE UNIQUE INDEX uniq_primary_per_company
>   ON finance_company_contacts (external_finance_company_id)
>   WHERE is_primary = true AND deleted_at IS NULL;
> ```

### 5.3 `FinanceReceivableContactLog` (ใหม่)

```prisma
enum FinanceContactChannel {
  CALL
  EMAIL
  LINE
  MEETING
  OTHER
}

enum FinanceContactResult {
  ANSWERED        // คุย/รับสาย
  NO_ANSWER       // ไม่รับ
  PROMISED        // รับปากจะโอน
  DISPUTED        // มีปัญหา/โต้แย้ง
  REQUESTED_DOCS  // ขอเอกสารเพิ่ม
  OTHER
}

model FinanceReceivableContactLog {
  id                       String                @id @default(uuid())
  financeReceivableId      String                @map("finance_receivable_id")
  externalFinanceCompanyId String                @map("external_finance_company_id")  // denormalized — always set via lazy-resolve at create time (D6)
  financeCompanyContactId  String?               @map("finance_company_contact_id")   // โทรหาใคร (nullable)
  contactedById            String                @map("contacted_by_id")
  contactedAt              DateTime              @default(now()) @map("contacted_at")
  channel                  FinanceContactChannel @default(CALL)
  result                   FinanceContactResult
  notes                    String?
  promisedDate             DateTime?             @map("promised_date")
  promisedAmount           Decimal?              @map("promised_amount") @db.Decimal(12, 2)
  promisedBrokenAt         DateTime?             @map("promised_broken_at")   // cron set เมื่อพ้นวันนัด + เงินยังไม่เข้า
  promisedKeptAt           DateTime?             @map("promised_kept_at")     // cron/recordReceive set เมื่อเงินเข้า ≤ นัด (D9)
  createdAt                DateTime              @default(now()) @map("created_at")
  updatedAt                DateTime              @updatedAt @map("updated_at")
  deletedAt                DateTime?

  receivable  FinanceReceivable      @relation(fields: [financeReceivableId], references: [id])
  company     ExternalFinanceCompany @relation(fields: [externalFinanceCompanyId], references: [id])
  contact     FinanceCompanyContact? @relation(fields: [financeCompanyContactId], references: [id])
  contactedBy User                   @relation("FinanceContactLogger", fields: [contactedById], references: [id])

  @@index([financeReceivableId, contactedAt])
  @@index([externalFinanceCompanyId, contactedAt])
  @@index([promisedDate, promisedBrokenAt, promisedKeptAt])
  @@map("finance_receivable_contact_logs")
}
```

> **Lazy FK resolution (D6) — สำคัญ:**
> เมื่อ `recordContactLog` ถูกเรียก ถ้า `receivable.externalFinanceCompanyId IS NULL` (in-flight pre-backfill):
> 1. Normalize `receivable.financeCompany` (text)
> 2. Upsert `ExternalFinanceCompany` by normalized name → ได้ id
> 3. UPDATE receivable.externalFinanceCompanyId = upserted.id ใน transaction เดียวกัน
> 4. Insert log โดย externalFinanceCompanyId = upserted.id
>
> วิธีนี้ทำให้ deployment order ไม่สำคัญ — UI deploy ก่อน backfill เสร็จก็ใช้งานได้

### 5.4 ขยาย `FinanceReceivable`

```prisma
model FinanceReceivable {
  // ... existing fields

  // ── ใหม่ ──
  externalFinanceCompanyId String? @map("external_finance_company_id")  // nullable until Phase 3
  lastContactedAt          DateTime? @map("last_contacted_at")           // KPI denorm
  lastPromisedDate         DateTime? @map("last_promised_date")          // KPI denorm
  contactAttemptCount      Int       @default(0) @map("contact_attempt_count")

  /// @deprecated migrate ไป externalFinanceCompanyId — Phase 3 จะ drop
  financeCompany String @map("finance_company")

  company     ExternalFinanceCompany?       @relation(fields: [externalFinanceCompanyId], references: [id])
  contactLogs FinanceReceivableContactLog[]

  @@index([externalFinanceCompanyId, status])
  @@index([lastContactedAt])
}
```

### 5.5 User relation

```prisma
model User {
  // ... existing
  financeContactLogs FinanceReceivableContactLog[] @relation("FinanceContactLogger")
}
```

---

## 6. API Design

> **Role shorthand:** "viewers" = `OWNER, BRANCH_MANAGER, FINANCE_MANAGER, ACCOUNTANT` (ดูตาราง §9)

### 6.1 Contact directory (`/external-finance/companies/:companyId/...`)

| Method | Path | Roles | Action |
|---|---|---|---|
| GET | `/contacts` | viewers | list contacts (active first, primary first) |
| POST | `/contacts` | OWNER, FINANCE_MANAGER | create — ถ้า isPrimary=true ต้องเป็น atomic swap |
| PATCH | `/contacts/:contactId` | OWNER, FINANCE_MANAGER | update |
| DELETE | `/contacts/:contactId` | OWNER, FINANCE_MANAGER | soft delete (ห้ามลบถ้าเป็น primary และมี contact อื่นเหลือ → ต้อง re-assign ก่อน) |
| POST | `/contacts/:contactId/set-primary` | OWNER, FINANCE_MANAGER | transactional: ปลด primary อื่นใน company → set primary ตัวนี้ |

### 6.2 Activity log (`/finance-receivable/:receivableId/...`)

| Method | Path | Roles | Action |
|---|---|---|---|
| GET | `/contact-logs` | viewers | timeline (newest first) |
| POST | `/contact-logs` | viewers | บันทึก log + update KPI denorm (transactional) |
| PATCH | `/contact-logs/:logId` | own log within 24h OR OWNER/FINANCE_MANAGER | edit |
| DELETE | `/contact-logs/:logId` | OWNER, FINANCE_MANAGER | soft delete + recompute KPI |

### 6.3 Aggregation

| Method | Path | Roles | Action |
|---|---|---|---|
| GET | `/external-finance/companies/:id/contact-summary` | viewers | สรุป: receivableCount, totalOutstanding, lastContactedAt, brokenPromiseCount, keptPromiseCount |
| GET | `/external-finance/companies/:id/contact-logs?page=&limit=20` | viewers | timeline รวมทุก receivable ของบริษัทนี้ (default 20/page, max 100) |

### 6.4 DTOs

```typescript
class CreateFinanceCompanyContactDto {
  @IsString() @MaxLength(200) name!: string;
  @IsOptional() @IsString() @MaxLength(200) position?: string;
  @IsOptional() @IsString() @MaxLength(100) department?: string;
  @IsOptional() @IsString() @MaxLength(50) phone?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() @MaxLength(100) lineId?: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
  @IsOptional() @IsBoolean() isPrimary?: boolean;
}

class CreateContactLogDto {
  @IsOptional() @IsUUID() financeCompanyContactId?: string;
  @IsEnum(FinanceContactChannel) channel: FinanceContactChannel = 'CALL';
  @IsEnum(FinanceContactResult) result!: FinanceContactResult;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @IsOptional() @IsDateString() contactedAt?: string;  // default = now
  // promise (เฉพาะถ้า result=PROMISED)
  @IsOptional() @IsDateString() promisedDate?: string;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @IsPositive() promisedAmount?: number;
}
```

### 6.5 Service guarantees

- **`recordContactLog`**: ใน `$transaction` —
  1. ถ้า `receivable.externalFinanceCompanyId IS NULL` → normalize `receivable.financeCompany` (text) → upsert `ExternalFinanceCompany` → UPDATE receivable.externalFinanceCompanyId (D6 lazy-resolve)
  2. Insert log
  3. UPDATE `FinanceReceivable.lastContactedAt = log.contactedAt`, `lastPromisedDate = (result===PROMISED ? promisedDate : prev)`, `contactAttemptCount += 1`

- **`setPrimary`**: ใน `$transaction` —
  1. `SELECT id FROM external_finance_companies WHERE id=? FOR UPDATE` (row lock บนบริษัท → serialize concurrent setPrimary; last writer wins โดยไม่ผิด invariant)
  2. `UPDATE finance_company_contacts SET is_primary=false WHERE external_finance_company_id=? AND is_primary=true`
  3. `UPDATE finance_company_contacts SET is_primary=true WHERE id=?`

- **`deleteContact`**: ถ้า contact ที่จะลบ `isPrimary=true` AND ยังมี contact อื่น active เหลือ → **reject** + แจ้งให้ assign primary ใหม่ก่อน

- **`deleteContactLog`**: soft delete + recompute KPI (อาจมี cost — กรณีมี log เยอะ → cap ที่ N=100 ล่าสุดสำหรับ recompute)

- **Promise lifecycle on `recordReceive`**: ใน `recordReceive` flow ของ `FinanceReceivableService` → หลัง update status ถ้าเป็น `RECEIVED` หรือ `PARTIALLY_RECEIVED` AND มี log ที่ `result=PROMISED AND promisedKeptAt IS NULL AND promisedBrokenAt IS NULL` AND `receivedDate <= promisedDate` → SET `promisedKeptAt = receivedDate` (D9)

---

## 7. Cron Jobs

### 7.1 `broken-promise-finance.cron.ts` (ใหม่)

- **Schedule:** 02:00 BKK ทุกวัน
- **Logic:**
  ```sql
  UPDATE finance_receivable_contact_logs
  SET promised_broken_at = now()
  WHERE promised_date < CURRENT_DATE
    AND promised_broken_at IS NULL
    AND promised_kept_at IS NULL
    AND result = 'PROMISED'
    AND deleted_at IS NULL
    AND finance_receivable_id IN (
      SELECT id FROM finance_receivables
      WHERE status NOT IN ('RECEIVED', 'PARTIALLY_RECEIVED')
        AND deleted_at IS NULL
    )
  ```
- **Output:** count + log → metrics
- **Note:** `promisedKeptAt` ไม่ต้อง cron — เซ็ตที่ `recordReceive` handler ตรงๆ (ดู §6.5)

---

## 8. Web UI

### 8.1 `FinanceReceivableDetailDrawer` (ใหม่) — เปิดจากตารางหลัก

- **Header card**: status badge, expectedAmount, daysOverdue, receivedAmount (ถ้ามี)
- **Card "บริษัทไฟแนนซ์"**: ชื่อ + กลุ่ม + เครดิตเทอม + ผู้ติดต่อหลัก (พร้อม `tel:` link) → คลิกเปิด `/external-finance-companies/:id`
- **Card "KPI ติดตาม"**: ติดต่อล่าสุด, นัดล่าสุด (เน้นแดงถ้า broken), จำนวนครั้งที่ติดต่อ
- **Section "ประวัติการติดต่อ"**: vertical timeline — แต่ละ log แสดง: รูป/ชื่อพนักงาน, contactedAt (relative + absolute), ผู้ติดต่อในบริษัท (chip), result chip สี, notes, promise box ถ้ามี (สีแดงถ้า broken)
- **Sticky button "+ บันทึกการติดต่อ"** เปิด `FinanceContactLogDialog`

### 8.2 `FinanceContactLogDialog` (ใหม่ component)

- **ผู้ติดต่อ**: dropdown โหลด `FinanceCompanyContact` ของ company — default = primary, แสดง badge "ตัวหลัก", ปุ่ม "+ เพิ่มผู้ติดต่อใหม่" inline
- **ผลการติดต่อ**: chip group (ANSWERED / NO_ANSWER / PROMISED / DISPUTED / REQUESTED_DOCS / OTHER) สีตามผล
- **โน้ต**: textarea
- **ถ้าเลือก PROMISED:** unfold section → ThaiDateInput (วันที่นัด) + number input (ยอด default = outstanding)
- **บันทึก** → POST log + close + invalidate query
- Toast success/error

### 8.3 `ExternalFinanceCompanyDetailPage` (ใหม่ `/external-finance-companies/:id`) — 4 tabs

| Tab | Content |
|---|---|
| **ข้อมูลกิจการ** | form: name, taxId, email, lineOaId, creditTermDays, defaultCommissionRate, bankAccountInfo (JSON editor), notes |
| **ผู้ติดต่อ** | table FinanceCompanyContact — column: ชื่อ, ตำแหน่ง, โทร, email, badge "ตัวหลัก", action menu (edit/delete/set-primary). ปุ่ม "+ เพิ่มผู้ติดต่อ" |
| **บัญชีค้างรับ** | list FinanceReceivable ของบริษัทนี้ (status filter) — link ไปหน้า detail |
| **ประวัติติดต่อ** | aggregated timeline ทุก receivable ของบริษัทนี้ (20/page, infinite scroll หรือ pagination) |

### 8.4 ปรับ `FinanceReceivablePage` (เดิม)

- **คอลัมน์ใหม่**:
  - "ติดต่อล่าสุด" (relative time + tooltip absolute, จาก `lastContactedAt`)
  - "นัดล่าสุด" (date + badge "เลยกำหนด" ถ้า broken — จาก `lastPromisedDate` + log status)
- **คอลัมน์ "บริษัทไฟแนนซ์"**: คลิกชื่อ → ไป `/external-finance-companies/:id`
- **คลิก row** → เปิด `FinanceReceivableDetailDrawer`
- เพิ่ม filter "มีนัดเลยกำหนด" (broken promise) — backend ใช้ EXISTS subquery

---

## 9. Roles & Permissions

| Action | OWNER | BRANCH_MANAGER | FINANCE_MANAGER | ACCOUNTANT | SALES |
|---|---|---|---|---|---|
| View contacts/logs | ✅ | ✅ | ✅ | ✅ | ❌ |
| Create/edit contact directory | ✅ | ❌ | ✅ | ❌ | ❌ |
| Create contact log | ✅ | ✅ | ✅ | ✅ | ❌ |
| Edit/delete own log (within 24h) | ✅ | ✅ | ✅ | ✅ | ❌ |
| Edit/delete any log | ✅ | ❌ | ✅ | ❌ | ❌ |
| Edit company master fields | ✅ | ❌ | ✅ | ❌ | ❌ |

---

## 10. Migration Plan

### Phase 1 — Schema + back-compat code + sale workflow update (รอบ deploy นี้)

1. Prisma migration: เพิ่มตารางใหม่ 2 ตัว (`FinanceCompanyContact`, `FinanceReceivableContactLog`) + columns ใหม่บน `ExternalFinanceCompany` (4 field) และ `FinanceReceivable` (4 field: FK + KPI denorm 3 ตัว) — ทั้งหมด nullable
2. Raw SQL migration: partial unique index บน `finance_company_contacts` (ดู §5.2)
3. **Update Sale workflow (M3 จาก scrutinize)** — ทุกจุดที่สร้าง `FinanceReceivable` (sale completion handler) ต้อง:
   - Resolve `ExternalFinanceCompany` จาก `sale.financeCompany` (text) ผ่าน upsert by normalized name
   - SET ทั้ง `financeCompany` (text, back-compat) และ `externalFinanceCompanyId` (FK)
   - → ตัด orphan creation ตั้งแต่ต้นน้ำ
4. Deploy code: contact-log service ที่มี D6 lazy-resolve (รองรับ receivable เก่าที่ยัง FK NULL)
5. Deploy UI ใหม่

### Phase 2 — Backfill script (`scripts/backfill-external-finance-fk.ts`)

1. Group `FinanceReceivable.financeCompany` (text) ด้วย normalized name (trim, lowercase, collapse multiple spaces, unify วงเล็บ Thai/English)
2. Match กับ `ExternalFinanceCompany.name` (case-insensitive) — ถ้าไม่มี → `upsert` row (`isActive=true`, อื่นๆ null) **โดยใช้ normalized name เป็น match key** (เก็บ original name ไว้)
3. `UPDATE FinanceReceivable SET externalFinanceCompanyId = matched.id WHERE externalFinanceCompanyId IS NULL` (guard กัน double-write)
4. **Idempotent guard (M5 จาก scrutinize)** — ย้าย `contactPerson/contactPhone` → `FinanceCompanyContact` ด้วย:
   ```sql
   INSERT INTO finance_company_contacts (id, external_finance_company_id, name, phone, is_primary, is_active)
   SELECT gen_random_uuid(), efc.id, efc.contact_person, efc.contact_phone, true, true
   FROM external_finance_companies efc
   WHERE efc.contact_person IS NOT NULL
     AND efc.deleted_at IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM finance_company_contacts fcc
       WHERE fcc.external_finance_company_id = efc.id
         AND fcc.is_primary = true
         AND fcc.deleted_at IS NULL
     )
   ```
5. รายงานสรุป: matched / new-created / orphan / contacts-migrated / contacts-skipped (มี primary อยู่แล้ว)
6. ทำใน transaction รายบริษัท — re-runnable

### Phase 3 — Lock down (รอบหลัง, นอก scope ครั้งนี้)

- ทำ `externalFinanceCompanyId` required (NOT NULL)
- Drop column `financeCompany` (text)
- Drop column `ExternalFinanceCompany.contactPerson` / `contactPhone`

---

## 11. Testing Plan

### 11.1 Unit tests

- `FinanceCompanyContactService.setPrimary` — atomic swap with row lock (transaction rollback ถ้า fail; concurrent serializable)
- `FinanceCompanyContactService.delete` — block ถ้า primary AND มี contact อื่น active เหลือ
- `BrokenPromiseFinanceCron` — เซ็ตเฉพาะ logs ที่ result=PROMISED + promisedKeptAt IS NULL + receivable.status != RECEIVED/PARTIALLY_RECEIVED
- `ContactLogService.record` — KPI denorm ถูก (lastContactedAt, lastPromisedDate, contactAttemptCount); ถ้า receivable.FK NULL → lazy-upsert ExternalFinanceCompany แล้ว set FK
- `ContactLogService.delete` — recompute KPI ถูก
- `FinanceReceivableService.recordReceive` — เซ็ต `promisedKeptAt` ถ้าเงินเข้า ≤ promisedDate ใน log ที่ open
- `backfill` script — Thai name normalization (trim, collapse multiple spaces, unify วงเล็บ Thai/English) — e.g. `"เคทีซี  "` = `"เคทีซี"`, `"กสิกร (KK)"` = `"กสิกร(KK)"`
- `backfill` rerun — second pass ไม่สร้าง duplicate primary contact (NOT EXISTS guard)
- `Sale workflow` — สร้าง FinanceReceivable ใหม่ตั้งทั้ง `financeCompany` text และ FK

### 11.2 Integration tests

- POST contact log → GET timeline → KPI denorm reflect
- POST contact log with PROMISED + promisedDate → cron → log มี promisedBrokenAt
- POST contact log PROMISED → recordReceive ก่อน promisedDate → log มี promisedKeptAt (broken IS NULL)
- POST contact log บน receivable ที่ FK NULL → log สร้างได้ + receivable FK ถูก set อัตโนมัติ
- Role guard: ACCOUNTANT POST log ผ่าน, PATCH others' log ห้าม

### 11.3 E2E (Playwright)

- จากหน้า `/finance-receivable` คลิก row → drawer เปิด → "+ บันทึกการติดต่อ" → กรอก → save → ปรากฏใน timeline + คอลัมน์ "ติดต่อล่าสุด" update
- เปลี่ยน primary contact → reload → primary badge ย้าย
- Filter "มีนัดเลยกำหนด" → แสดงเฉพาะ broken

---

## 12. Open Questions (เก็บไว้ resolve ใน plan)

1. UI design ของ `FinanceContactLogDialog` ใช้ Modal หรือ Drawer? — แนะนำ Modal (simpler)
2. Bulk action "บันทึกการติดต่อ" หลาย receivable พร้อมกันใช้ไหม? — รอบนี้ไม่ทำ (YAGNI)
3. ภาษาในตัวเลือก result enum — ใส่ Thai label ใน DB หรือใส่ map ใน UI? — UI map (i18n-friendly)

---

## 13. Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Backfill match ผิดบริษัท | data corruption | dry-run flag, report ก่อน commit, transaction รายบริษัท |
| Partial unique index ไม่ portable (PG specific) | migration fail บน MySQL | ระบุชัดใน migration ว่าใช้ Postgres เท่านั้น (โปรเจกต์ใช้ PG อยู่แล้ว) |
| KPI denorm out-of-sync ถ้า log ลบโดยตรงจาก DB | dashboard inaccurate | recompute job รายสัปดาห์ (recommend) — แต่อยู่นอก scope รอบนี้ |
| Race condition setPrimary | 2 primary ในเวลาเดียวกัน | `SELECT FOR UPDATE` row ของ company ก่อน transaction → serialize concurrent calls; last writer wins โดย invariant ยังถูก (1 primary at a time) |
| Lazy upsert ที่ contact-log create เกิด name collision ขณะ backfill รัน parallel | duplicate ExternalFinanceCompany rows | upsert ใช้ unique constraint บน `name` (มีอยู่แล้ว) → catch P2002 + retry SELECT |
