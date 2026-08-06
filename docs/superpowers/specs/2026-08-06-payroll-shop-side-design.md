# Payroll ฝั่ง SHOP — คำสั่งเจ้าของ 2026-08-06

## คำสั่งเจ้าของ (2026-08-06)

1. เงินเดือนพนักงานหน้าร้าน = ค่าใช้จ่ายของ **SHOP** (ผัง CPA เตรียมบัญชีไว้แล้ว — เจ้าของแนบภาพผังบัญชี SHOP ฉบับเต็ม)
2. เพิ่มรายการรับ (custom income) และรายการหัก (custom deduction) ได้
3. คุมด้วย **สิทธิ**: อนุมัติก่อนจ่าย + สิทธิการเห็นเงินเดือนระหว่างสาขา
4. ล้างข้อมูลเงินเดือนที่เคยบันทึกไว้ (บัญชีเก่าผิดฝั่ง/ผิดรหัส)
5. เสร็จแล้วทดลองบันทึกตามสถานการณ์สมมุติ + สรุปรายงาน

## บริบท (จากการ audit โค้ด 2026-08-06)

- Payroll = `documentType='PAYROLL'` ใน expense-documents (ไม่มีโมดูลแยก)
- บั๊กเดิม B1: OT ถูก whitelist บังคับลง 53-1105 (ค่าอบรม สัมมนา) — รหัสถูกคือ 53-1103
- บั๊กเดิม B2: JE เงินเดือน post ด้วย `companyId=SHOP` แต่รหัสบัญชีเป็นผัง FINANCE
  (ไม่มี S นำหน้า) → scope=FINANCE ตกที่ companyId filter, scope=SHOP ตกที่ code filter
  → เงินเดือนหายจาก TB/P&L ทั้งสอง scope โผล่เฉพาะ scope=ALL

## การออกแบบ

### 1. entityScope บน PayrollDetail — 'SHOP' (default) | 'FINANCE'

เอกสารเงินเดือน 1 ใบสังกัด scope เดียว:
- **SHOP** — พนักงานสาขา (คำสั่งเจ้าของ ข้อ 1) → ผัง S + companyId SHOP
- **FINANCE** — พนักงานส่วนกลาง (บัญชี/เร่งรัด) → ผัง FINANCE เดิม + **companyId FINANCE**
  (แก้ B2 ของฝั่งนี้ไปพร้อมกัน)

แถว payroll เดิมทั้งหมด backfill เป็น 'FINANCE' (สอดคล้องรหัสบัญชีที่ JE เก่าใช้จริง)
ก่อนถูกล้างด้วย wipe CLI อยู่ดี

### 2. บัญชี SHOP — ขยายกลุ่มที่มีอยู่ ไม่ชนรหัสเดิม

ผังใหม่ฉบับเต็มของ CPA (ภาพ) จัดเงินเดือนไว้ 53-11XX แต่ S53-1101 ในระบบปัจจุบันถูกใช้เป็น
"ขาดทุนจากการขายมือถือมือสอง" อยู่ → **ไม่ยึดเลขของภาพในรอบนี้** ใช้กลุ่ม OpEx-บุคลากร
S52-12XX ที่ CSV ปัจจุบันเตรียมไว้แล้ว + เพิ่มที่ขาด (การ renumber ทั้งผังเป็นงาน
chart-adoption แยกต่างหาก — เมื่อทำ แค่ remap AccountRoleMap ไม่ต้องแก้โค้ด):

| บัญชี | ชื่อ | สถานะ | เทียบผังภาพ CPA |
|---|---|---|---|
| S52-1201 | เงินเดือนพนักงานสาขา | มีอยู่แล้ว | 53-1101 |
| S52-1202 | ค่าล่วงเวลา - พนักงานสาขา | มีอยู่แล้ว | 53-1103 |
| S52-1204 | โบนัส - พนักงานสาขา | **ใหม่** | 53-1104 |
| S52-1205 | เงินสมทบประกันสังคม และกองทุนทดแทน - สาขา | **ใหม่** | 53-1102 |
| S21-3101 | ภ.ง.ด. 1 ค้างจ่าย - SHOP | **ใหม่** | 21-3101 |
| S21-3105 | เงินสมทบ ปกส.-พนักงานค้างนำส่ง - SHOP | **ใหม่** | 21-3105 |
| S21-3106 | เงินสมทบ ปกส.-นายจ้างค้างนำส่ง - SHOP | **ใหม่** | 21-3106 |

เงินสด/ธนาคาร SHOP ใช้ของเดิม: S11-1101..1103 (เงินสดสาขา), S11-1201 (KBank รับ),
S11-1202 (SCB จ่าย)

หมายเหตุนิติบุคคลเดียว: ภ.ง.ด.1 / สปส. ยื่นรวมทั้งบริษัท → รายงาน PND1 อ่านทั้ง
21-3101 และ S21-3101

### 3. AccountRoleMap — roles ใหม่ (migration `20260990000000_payroll_shop_side`)

`shop_payroll_expense→S52-1201`, `shop_payroll_sso_expense→S52-1205`,
`shop_wht_payroll→S21-3101`, `shop_sso_employee→S21-3105`, `shop_sso_employer→S21-3106`,
`shop_payroll_overtime→S52-1202`, `shop_payroll_bonus→S52-1204`

- migration insert ทั้งแถว CoA (ON CONFLICT DO NOTHING) และแถว role map ในไฟล์เดียว
  → กัน boot-fail จาก `assertCodesExistInCoa` กรณี deploy ก่อน seed
- 5 ตัวแรกเข้า `REQUIRED_ROLES` + `EXPECTED_NORMAL_BALANCE`

### 4. JE ต่อ scope (โครงเดิม เปลี่ยนเฉพาะชุด role + companyId)

```
SHOP:    Dr S52-1201 Σฐาน / Dr S52-1205 ΣSSO / Dr S52-1202,S52-1204 (custom income)
         Cr S21-3101 ΣWHT / Cr S21-3105 ΣSSO / Cr S21-3106 ΣSSO
         Cr <custom deduction S-codes> / Cr S11-XXXX Σสุทธิ     [companyId=SHOP]
FINANCE: ชุดเดิม 53-1101/53-1102/21-3101/21-3105/21-3106/11-XXXX  [companyId=FINANCE ← แก้ B2]
```

- template ใช้ `CompanyResolverService` (เลิก per-instance cache — W3 pattern)
- เพิ่ม `metadata.idempotencyKey = expense-payroll:<docId>` → DB partial unique index
  คุ้มกัน double-post (เดิมมีแค่ app-level `doc.journalEntryId` check)
- period guard ใน `executePostBody` ตรวจ company ตาม scope ของเอกสาร (เฉพาะ PAYROLL)

### 5. Whitelist รายได้พิเศษ — แยกตาม scope + แก้ B1

- `custom_income_accounts_whitelist` (FINANCE): แก้ค่า seed เดิม `["53-1104","53-1105"]`
  → `["53-1103","53-1104"]` (OT เข้า 53-1103 ตามผัง; update เฉพาะเมื่อ value ยังเป็นค่า
  seed เดิม — ไม่ทับค่าที่เจ้าของแก้เอง)
- ใหม่ `custom_income_accounts_whitelist_shop`: `["S52-1202","S52-1204"]`
- รายการหัก: DTO regex เปิดรับ `S?\d{2}-\d{4}` + service ตรวจว่ารหัสมีจริงใน CoA และ
  prefix ตรง scope (เดิมพิมพ์ 99-9999 ผ่าน DTO ไประเบิดตอน post)
- UI เลิก hardcode — ดึงจาก endpoint ใหม่ `GET /expense-documents/payroll/meta?scope=`
  (คืน whitelist + ชื่อบัญชี + บัญชีเงินสดของ scope)

### 6. สิทธิ (คำสั่งข้อ 2)

- **อนุมัติก่อนจ่าย**: ใช้กลไกเดิม (`approval_enabled` + `approval_required_doc_types`
  default `['PAYROLL']` + `approvers_list` + OWNER) — dev seed เปิด `approval_enabled='true'`;
  prod เปิดผ่าน SystemConfig row (runbook). ฟอร์มเงินเดือน: เมื่อ approval เปิด ปุ่มหลัก
  เปลี่ยนเป็น "บันทึก & ส่งขออนุมัติ" (สร้าง + submit-for-approval แทน post ตรง)
- **เห็นเงินเดือนข้ามสาขา**: `GET /expense-documents/:id` เพิ่ม branch scope —
  role ที่ไม่อยู่ใน CROSS_BRANCH_ROLES (OWNER/FM/ACC) เห็นเฉพาะเอกสารสาขาตัวเอง
  (เดิม BM รู้ id ก็เปิดเงินเดือนสาขาอื่นได้ — mirror guard ของ getAuditTrail)

### 7. กันซ้ำ

- ห้าม 2 เอกสาร PAYROLL งวดเดียวกัน + สาขาเดียวกัน + scope เดียวกัน (นับเฉพาะไม่ VOIDED/
  ไม่ถูกลบ) — service check ใน tx + advisory lock `payroll:<branch>:<period>:<scope>`
- ห้ามพนักงาน (userId) ซ้ำแถวในใบเดียว — DTO check + DB `@@unique([payrollId, userId])`
  (NULL ไม่ชนกันตาม PG semantics — free-text lines ไม่กระทบ)

### 8. ภ.ง.ด.1 (แก้ให้ครบตามกฎหมาย + เข้าถึงได้)

- อ่าน `accountCode IN ('21-3101','S21-3101')` (นิติบุคคลเดียว ยื่นรวม)
- ถอด filter `whtAmount > 0` — พนักงานภาษี 0 ต้องปรากฏ
- `gross = baseSalary + Σ customIncome(isTaxable)` — โบนัส/OT เข้าเงินได้
- ต่อ route `/finance/wht-report` (WhtReportPage — เดิม lazy-import ไว้แต่ไม่มี Route) + เมนู

### 9. Wipe (คำสั่งข้อ 3) — `npm --prefix apps/api run wipe:payroll`

CLI ใหม่ `apps/api/src/cli/wipe-payroll.cli.ts` (guards ตาม wipe-accounting pattern:
`CONFIRM_WIPE=YES_I_AM_SURE` + `EXPECTED_DB_NAME` + prod ต้อง `ALLOW_PROD_WIPE` + cooldown
+ `DRY_RUN=1`): hard-delete JEs `flow IN ('expense-payroll','expense-payroll-void')`
(journal_lines → journal_entries) + เอกสาร PAYROLL ทุกสถานะ (cascade PayrollDetail/Line/
custom) + TaxReport PND1 ที่ยัง DRAFT. AuditLog คงไว้ (immutable)

### 10. นอกขอบเขตรอบนี้ (บันทึกไว้ ไม่เงียบหาย)

- สปส.1-10 + JE นำส่ง ปกส./ภ.ง.ด.1, ใบ 50 ทวิ, ภ.ง.ด.1ก, คำนวณ WHT อัตโนมัติ,
  copy-last-month, ไฟล์โอนธนาคาร (รอบ 2-3 ของแผนที่เสนอเจ้าของ)
- expense templates อื่น (same-day/accrual/CN/petty-cash) ยังมีปัญหา B2 แบบเดียวกัน
  (FINANCE codes + SHOP companyId) — ต้องถาม CPA ว่ารายจ่ายดำเนินงานสังกัดฝั่งไหน
  ก่อนแก้ อย่าเหมารวมกับคำตอบเงินเดือน
- การ adopt ผังภาพ CPA ฉบับเต็ม (renumber ทั้ง SHOP chart) — โปรเจคแยก
