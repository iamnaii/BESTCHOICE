# Employee Master — ทะเบียนพนักงาน + ปิด free-text payroll

วันที่: 2026-06-04
สถานะ: รออนุมัติ spec จาก owner (brainstorm + scrutinize เสร็จ — รอ review ก่อนทำ implementation plan)

> **แก้หลัง scrutinize (2026-06-04):** (1) ปิด PII leak — `pickable` ไม่คืน `nationalId` แล้ว, gate nationalId เฉพาะ OWNER/ACCOUNTANT (2) นิยาม pickable filter พนักงานลาออก (3) backfill tier-2 (ชื่อ) ต้อง manual review + audit (4) ระบุ ไม่ branch-scope. `employmentType`/`resignedDate` **คงไว้** (load-bearing: คอลัมน์ master + filter picker).
ส่วนหนึ่งของ: ขยายหลัก "ห้าม free-text คน" (party-master) จาก Contact ไปถึง **พนักงาน**

> **ที่มา:** epic Party Master Mandatory (#1143–1149) ปิด free-text "คน" ทุก picker ฝั่งคู่ค้า
> (ลูกค้า/ผู้ขาย/คนขายมือสอง/ไฟแนนซ์) ผ่าน `Contact`. free-text "คน" ที่ยังเหลือคือ **พนักงาน**:
> `PayrollLine.employeeName` (required) + `employeeTaxId` (optional) ที่พิมพ์มือใน
> `PayrollLinesSection.tsx`. (custodian เงินสดย่อยเป็น User FK อยู่แล้ว — ไม่ใช่ free-text)

---

## 1. การตัดสินใจสถาปัตยกรรม (decisions log)

| # | คำถาม | คำตอบที่เคาะ |
|---|---|---|
| 1 | ขอบเขต | **HR-lite เต็ม** (ทะเบียน + ประวัติ + เอกสาร + lifecycle) — แต่ spec นี้ทำ **Phase 1+2**, Phase 3 เป็น roadmap |
| 2 | พนักงาน vs User | **พนักงานทุกคน = User อยู่แล้ว** (มี login ครบ) |
| 3 | วางข้อมูลที่ไหน | **`EmployeeProfile` 1:1 กับ User** (ไม่ใช่ Contact role, ไม่ยัดลง User ตรงๆ) |
| 4 | phasing | spec **Phase 1+2 รวมกัน** (master + payroll pre-fill/tax fields) |
| 5 | PII (เลขบัตร/SSO) | **Plaintext + RBAC** (อ่านได้เฉพาะ OWNER/ACCOUNTANT — ต้องใช้เลขจริงยื่น ภงด.1/สปส.1-10) |

**ทำไม EmployeeProfile แทน Contact+role EMPLOYEE:** พนักงาน = คนภายในที่มี User อยู่แล้ว;
Contact มีไว้สำหรับคู่ค้า**ภายนอก** — เอาพนักงานไปปนสมุดผู้ขาย/ลูกค้า + บันทึกซ้ำ (User+Contact คนเดียว)
ไม่สมเหตุผล. EmployeeProfile ผูก User ตรง ใช้ FK แบบเดียวกับ custodian.

**ทำไม EmployeeProfile แทนยัดลง User:** (1) HR-lite Phase 3 (ประวัติเงินเดือน/เอกสาร/lifecycle)
hang ตารางลูกจาก EmployeeProfile ได้สะอาด (2) การมี profile = flag "เป็นพนักงาน payroll" ชัด
(User integration/ระบบ ไม่มี profile) (3) salary/bank/SSO เป็น payroll concern ไม่ใช่ auth.

**ของจริงที่ User มีอยู่แล้ว (ไม่สร้างซ้ำ):** `employeeId` (รหัสพนักงาน, @unique), `name`, `nickname`,
`nationalId` (เลข 13 หลัก plaintext = เลขผู้เสียภาษี + SSO id), `startDate`, `birthDate`, `phone`,
`address`, `branchId`, `isActive`, `isSystemUser`.

---

## 2. Data Model

### 2.1 `User` (เดิม — ไม่แตะ schema)
ใช้ field ที่มี: `employeeId`, `name`, `nickname`, `nationalId`, `startDate`, `birthDate`,
`phone`, `address`, `branchId`, `isActive`, `isSystemUser`.

### 2.2 `EmployeeProfile` (ใหม่ — 1:1 User)
```prisma
enum EmploymentType { MONTHLY DAILY CONTRACT }

model EmployeeProfile {
  id             String         @id @default(uuid())
  userId         String         @unique @map("user_id")   // FK → User ; presence = "เป็นพนักงาน payroll"
  user           User           @relation(fields: [userId], references: [id])
  position       String?                                   // ตำแหน่ง
  employmentType EmploymentType @default(MONTHLY) @map("employment_type")
  baseSalary     Decimal?       @map("base_salary") @db.Decimal(12, 2)   // ฐานเงินเดือน default → pre-fill
  ssoEligible    Boolean        @default(true) @map("sso_eligible")      // เข้าประกันสังคมไหม
  bankName       String?        @map("bank_name")
  bankAccountNo  String?        @map("bank_account_no")
  taxIdOverride  String?        @map("tax_id_override")    // เผื่อ taxId ≠ nationalId (ต่างด้าว) ; null = ใช้ User.nationalId
  note           String?
  resignedDate   DateTime?      @map("resigned_date")      // startDate อยู่ที่ User แล้ว
  createdAt      DateTime       @default(now()) @map("created_at")
  updatedAt      DateTime       @updatedAt @map("updated_at")
  deletedAt      DateTime?      @map("deleted_at")

  @@map("employee_profiles")
}
```
(User เพิ่ม relation back: `employeeProfile EmployeeProfile?`)

### 2.3 `PayrollLine` (แก้ — เพิ่ม FK + คง snapshot)
```prisma
model PayrollLine {
  // ...เดิม...
  userId        String?  @map("user_id")          // ใหม่: FK → User (= ปิด free-text)
  user          User?    @relation(fields: [userId], references: [id], onDelete: SetNull)
  employeeName  String                            // คงไว้เป็น SNAPSHOT (ตั้งจาก User ตอนสร้าง)
  employeeTaxId String?                           // คง SNAPSHOT
  // ...
  @@index([userId])
}
```
> `userId` **optional** (เหมือน `ExpenseDocument.vendorSupplierId`) — แถวเก่า backfill ทีหลัง, ไม่ break.
> snapshot `employeeName`/`employeeTaxId` = หลักเดียวกับ party-master (เก็บค่า ณ เวลาทำรายการ —
> ประวัติ payroll ต้องไม่เปลี่ยนตามชื่อที่แก้ทีหลัง = historical correctness).

---

## 3. UI

### 3.1 หน้า Employee Master `/employees` (RBAC: OWNER, ACCOUNTANT)
- **List**: ค้นหา/กรอง active, คอลัมน์ รหัสพนักงาน · ชื่อ(เล่น) · ตำแหน่ง · ประเภทจ้าง · สาขา · สถานะ
- **Detail/Edit**: provision `EmployeeProfile` จาก User ที่ยังไม่มี profile (เลือก User → กรอก
  position/baseSalary/bank/ssoEligible) + แก้ field payroll. `nationalId`/`startDate` แก้บนข้อมูล User
  (deep-link `/users` หรือ inline) — ไม่ทำซ้ำ.
- `nationalId` แสดง **เฉพาะ OWNER/ACCOUNTANT** (RBAC ตาม PII).
- pattern ตาม `CustomersPage.tsx` (list) + react-query + semantic tokens + Thai `leading-snug`.

### 3.2 Payroll picker — แก้ `PayrollLinesSection.tsx` คอลัมน์ "ชื่อ"
- free-text input → **`EmployeeCombobox`** (search active employees ; pattern คล้าย `ContactCombobox`
  แต่ **ไม่มี inline-create** — พนักงาน=User สร้างที่ `/users`/master ก่อน ; ถ้าไม่เจอโชว์
  "เพิ่มพนักงานที่หน้าทะเบียน").
- เลือกแล้ว set `userId` + auto-fill: `employeeName` (จากชื่อใน pickable), **pre-fill** `ฐาน`=`baseSalary`,
  `SSO`=`min(ฐาน×5%, 750)` ถ้า `ssoEligible`.
- คอลัมน์ `เลขบัตร`: **server เป็นคน derive ตอนบันทึก** (pickable ไม่ส่ง nationalId มา — PII) → ในฟอร์มก่อน save
  โชว์ read-only placeholder "(ดึงเลขบัตรอัตโนมัติตอนบันทึก)"; แถว legacy free-text ยังพิมพ์เลขบัตรเองได้.
- ตัวเลขทุกช่อง **แก้มือได้** (เงินเดือนจริงต่างกันแต่ละงวด) — pre-fill เป็นแค่ค่าเริ่มต้น.
- `WHT` กรอกมือ (ขึ้นกับฐานสะสมทั้งปี — ไม่ pre-fill ใน phase นี้).
- **Backward-compat**: แถว payroll เดิม (free-text, ไม่มี userId) แสดง/แก้ได้ — combobox โชว์ชื่อ snapshot เดิม.

---

## 4. Backend

### 4.1 โมดูลใหม่ `employees` (controller → service → PrismaService ; gate ทั้ง class `@UseGuards(JwtAuthGuard, RolesGuard)`)

| Method | Path | Roles | คืน `nationalId`? | หมายเหตุ |
|---|---|---|---|---|
| GET | `/employees` | OWNER, ACCOUNTANT | masked (4 ท้าย) | list + search, `{data,total,page,limit}` |
| GET | `/employees/pickable?search=` | OWNER, ACCOUNTANT, FINANCE_MANAGER | **ไม่คืน** | `EmployeeCombobox` — `{userId, employeeId, name, nickname, baseSalary, ssoEligible}` (ไม่มี PII) |
| GET | `/employees/:id` | OWNER, ACCOUNTANT | full | detail (หน้า master) |
| POST | `/employees` | OWNER, ACCOUNTANT | — | provision profile ให้ `userId` (CreateEmployeeDto) |
| PATCH | `/employees/:id` | OWNER, ACCOUNTANT | — | UpdateEmployeeDto (ทุก field optional) |
| DELETE | `/employees/:id` | OWNER, ACCOUNTANT | — | soft-delete = เลิกเป็นพนักงาน payroll |

- **PII gating (แก้หลัง scrutinize — blocker เดิม)**: `nationalId` คืน**เฉพาะ endpoint ที่ gate OWNER/ACCOUNTANT** (list=masked, detail=full). `pickable` (ที่ FINANCE_MANAGER เข้าได้) **ไม่คืน nationalId เลย** — combobox ไม่ต้องใช้ เพราะ taxId snapshot derive ฝั่ง server ตอน payroll create (§4.2). แก้ความขัดแย้งกับ decision-5 + harden PII.
- **`pickable` filter (แก้หลัง scrutinize — gap)**: คืนเฉพาะ `deletedAt IS NULL AND (resignedDate IS NULL OR resignedDate > today)` — พนักงานลาออก/ถูกลบ ไม่ขึ้นให้เลือกในแถวใหม่. แถว payroll legacy (มี userId แต่คนลาออกแล้ว) ยังโชว์ snapshot ได้ (read-only, ไม่ re-link).
- **DTO ภาษาไทย** validation ; `userId` unique → P2002 → `ConflictException('พนักงานคนนี้มีทะเบียนแล้ว')`.
- **Audit**: `EMPLOYEE_PROFILE_CREATED` / `_UPDATED` / `_DELETED` (action string ตาม pattern เดิม).
- **Soft-delete query**: ทุก query `where: { deletedAt: null }`.
- **ไม่ branch-scope**: HR/payroll เป็นฟังก์ชันกลาง (OWNER/ACCOUNTANT เห็นพนักงานทุกสาขา) — ไม่ใส่ BranchGuard (สอดคล้องกับ payroll ที่เป็น FINANCE-level).

### 4.2 ผูกเข้า payroll (create-payroll DTO/service)
- `PayrollLineInput.userId?` (optional). ถ้ามี → **server derive snapshot** (`employeeName = User.name`,
  `employeeTaxId = User.nationalId` หรือ `taxIdOverride`) — ไม่เชื่อ snapshot จาก client (integrity).
  ถ้าไม่มี `userId` → ต้องมี `employeeName` (พฤติกรรมเดิม/legacy).
- `userId` ที่ส่งมาต้องเป็นพนักงาน active (มี EmployeeProfile, ไม่ถูก soft-delete) ไม่งั้น reject.
- `baseSalary`/`ssoEmployee`/`whtAmount` ที่ client ส่ง = ค่าจริงที่จ่าย — server ไม่ override ตัวเลข.

### 4.3 JE — ไม่เปลี่ยน
`payroll.template.ts` คิดจากตัวเลข (base/sso/wht) เหมือนเดิม. `userId` เป็น metadata link ไม่กระทบ
JE/SSO accounts (21-3105/3106/53-1102). มี anti-regression test ยืนยัน JE คงเดิม.

---

## 5. Migration & Backfill

### 5.1 Migration (additive — ไม่ต้อง 2-step เพราะ nullable)
```
+ enum EmploymentType { MONTHLY DAILY CONTRACT }
+ table employee_profiles (userId @unique FK, ...)
+ payroll_lines.user_id nullable FK → users (onDelete SET NULL)
+ @@index([user_id]) บน payroll_lines
```

### 5.2 Backfill CLI (รันมือ dry-run → `--apply` ; pattern ตาม `backfill:expense-vendor-fk`)
1. **`backfill:employee-profiles`** — provision `EmployeeProfile` ให้ User ที่เป็นพนักงานจริง
   - candidate = `isSystemUser=false AND deletedAt IS NULL`
   - สร้าง profile (position/baseSalary = null ให้ OWNER เติมในหน้า master)
   - dry-run โชว์รายชื่อ → `--apply` ; idempotent (มี profile แล้วข้าม)
2. **`backfill:payroll-user-fk`** — ผูก `PayrollLine` เก่าเข้า User
   - **tier 1** (`employeeTaxId === User.nationalId`, exact): มั่นใจสูง → `--apply` ได้เลย, idempotent
   - **tier 2** (match ชื่อ exact): **เสี่ยง false-positive → ต้อง manual review ก่อน** — dry-run ออก
     `matched-by-name.csv` ให้ owner ตรวจ แล้ว apply แยก flag (เช่น `--apply --tier=2`) + เขียน audit
     `PAYROLL_FK_MATCHED_BY_NAME` ทุกแถวที่ผูกด้วยชื่อ (เผื่อ dispute/rollback ภายหลัง)
   - **ไม่แตะ** snapshot ; เติมแค่ `userId` ; ที่ match ไม่ได้ → ปล่อย null (ของเก่า free-text ยังอยู่/แก้ได้ ไม่ re-link)
   - dry-run โชว์ matched(tier1/tier2)/unmatched → apply

> ทั้งคู่ manual + idempotent + ไม่ทำลายข้อมูลเดิม (เหมือน epic party-master). บันทึกใน memory ว่าต้องรันมือ.

---

## 6. Testing

**API (jest, รัน `--runInBand` — memory: parallel-DB flaky):**
- `employees.service.spec` — provision (P2002 dup → Conflict), update, soft-delete, list/search,
  `pickable` คืน active เท่านั้น
- **PII** — `pickable` **ไม่คืน `nationalId`** ; GET /employees คืน masked, /:id คืน full
- **resigned filter** — `pickable` ไม่คืนพนักงาน `resignedDate ≤ today` หรือ soft-deleted
- RBAC — SALES/BRANCH_MANAGER → 403 ทุก endpoint ; FINANCE_MANAGER → 403 บน list/detail/CUD (เข้าได้แค่ `pickable`)
- payroll create: `userId` → server derive snapshot ถูก ; ไม่มี userId → legacy path ;
  userId ของคน soft-deleted/ไม่ใช่พนักงาน → reject
- payroll JE anti-regression — JE/SSO เหมือนเดิมเมื่อมี userId
- backfill CLI specs — dry-run≠apply, idempotent, match `taxId=nationalId`, unmatched=null

**Web (vitest):**
- `EmployeeCombobox` — search, select set userId+snapshot, ไม่มี inline-create
- `PayrollLinesSection` — pre-fill ฐาน/SSO ตอน select, แก้มือแล้วค่าคงอยู่, แถว legacy (ไม่มี userId) ยังแก้ได้
- Employee master page — list/provision/edit, nationalId โชว์ตาม RBAC, validation

---

## 7. Edge cases (ออกแบบรองรับ)
- พนักงานลาออก (soft-delete) แต่มี payroll เก่า → snapshot คงอยู่ (ประวัติไม่หาย), combobox ไม่โชว์สำหรับแถวใหม่
- User เปลี่ยนชื่อหลังทำ payroll → snapshot เดิมไม่เปลี่ยน (historical correctness)
- `ssoEligible=false` → pre-fill SSO = 0
- ต่างด้าว `taxId ≠ บัตรปชช.` → snapshot ใช้ `taxIdOverride` ถ้ามี ไม่งั้น `nationalId`
- provision profile ซ้ำ (userId เดิม) → ConflictException

---

## 8. Phase 3 roadmap (นอก spec นี้)
- `SalaryHistory` — ประวัติปรับฐานเงินเดือน (effectiveDate, baseSalary, reason)
- `EmploymentEvent` — lifecycle จ้าง/เลื่อน/ลาออก (type, date, note)
- `EmployeeDocument` — สัญญาจ้าง/สำเนาบัตร บน S3 (เหมือน ContractDocument pattern)
- resignation flow + กันออกจาก payroll picker อัตโนมัติเมื่อ `resignedDate` ผ่าน

---

## 9. ลำดับการทำ (phased PR — merge ก่อนทำต่อ, ไม่ stack ลึก)
รายละเอียดทำเป็น implementation plan แยก (writing-plans) — ภาพคร่าว:
1. **PR-A (backend master)**: schema + migration + โมดูล `employees` (CRUD + pickable) + tests
2. **PR-B (frontend master)**: หน้า `/employees` + EmployeeCombobox + tests
3. **PR-C (payroll link)**: PayrollLine.userId + create-payroll DTO/service derive snapshot + pre-fill UI + tests
4. **PR-D (backfill)**: 2 CLI + tests (รันมือหลัง deploy)

> หมายเหตุ: PR-A/B/C/D เรียงตาม dependency. backfill (D) รันมือหลัง A–C ขึ้น prod.
