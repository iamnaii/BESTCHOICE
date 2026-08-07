# Runbook — Payroll ฝั่ง SHOP + ล้างข้อมูลเงินเดือนเก่า (คำสั่งเจ้าของ 2026-08-06)

Spec: `docs/superpowers/specs/2026-08-06-payroll-shop-side-design.md`

สิ่งที่เปลี่ยน: ใบเงินเดือนแยกฝั่ง SHOP (พนักงานสาขา — default) / FINANCE (ส่วนกลาง),
JE ลงผัง S + companyId ตรงฝั่ง (แก้บั๊กเงินเดือนหายจาก TB/P&L), OT เข้า 53-1103/S52-1202
(แก้บั๊กเดิมที่ลง 53-1105 ค่าอบรม), กันงวดซ้ำ, บังคับอนุมัติก่อนจ่าย, ภ.ง.ด.1 ครบทุกคน+
รวมโบนัส/OT + มีหน้าจอกดได้จริง (/finance/wht-report)

## ลำดับ deploy บน prod

### 1. Merge + deploy ตามปกติ

`prisma migrate deploy` จะรัน `20260990000000_payroll_shop_side` อัตโนมัติ:
- เพิ่มบัญชี SHOP 5 ตัว (S52-1204, S52-1205, S21-3101, S21-3105, S21-3106) — idempotent
- เพิ่ม account_role_map `shop_*` 7 แถว
- แก้ whitelist OT: `custom_income_accounts_whitelist` → `["53-1103","53-1104"]`
  (เฉพาะเมื่อค่ายังเป็น seed เดิม `["53-1104","53-1105"]` — ไม่ทับค่าที่เจ้าของแก้เอง)
- เพิ่ม `custom_income_accounts_whitelist_shop` = `["S52-1202","S52-1204"]`
- เพิ่มคอลัมน์ `payroll_details.entity_scope` (แถวเก่า backfill = FINANCE)
- unique `(payroll_id, user_id)` บน payroll_lines

หมายเหตุ: migration insert แถว CoA เองด้วย ON CONFLICT — boot ไม่มีทาง fail ที่
`assertCodesExistInCoa` แม้ยังไม่รัน seed:coa. รัน `npm run seed:coa` เพิ่มได้ถ้าต้องการ
sync ชื่อ/หมายเหตุบัญชีให้ตรง CSV เป๊ะ (non-destructive upsert).

### 2. ล้างข้อมูลเงินเดือนเก่า (คำสั่งเจ้าของข้อ 3)

ใบเงินเดือนเก่าทุกใบลงบัญชีผิดฝั่ง (FINANCE codes ใต้ SHOP companyId) — ล้างแล้วบันทึกใหม่.

```bash
# ผ่าน cloud-sql-proxy ตาม runbook ปกติ — DRY RUN ก่อนเสมอ
DRY_RUN=1 CONFIRM_WIPE=YES_I_AM_SURE EXPECTED_DB_NAME=bestchoice \
  npm --prefix apps/api run wipe:payroll

# ตรวจรายการที่พิมพ์ออกมา (เลขเอกสาร PR + เลข JE) แล้วรันจริง
CONFIRM_WIPE=YES_I_AM_SURE EXPECTED_DB_NAME=bestchoice ALLOW_PROD_WIPE=YES_I_AM_SURE \
  NODE_ENV=production npm --prefix apps/api run wipe:payroll
```

ลบ: เอกสาร PAYROLL ทุกสถานะ (+ payroll_details/lines/custom cascade), JE flow
`expense-payroll`/`expense-payroll-void` (+ lines), TaxReport PND1 ที่ยัง DRAFT.
คงไว้: AuditLog (immutable), TaxReport PND1 ที่ SUBMITTED แล้ว.

⚠️ `EXPECTED_DB_NAME=bestchoice` — ชื่อ DB prod จริงคือ `bestchoice`
(เอกสารเก่าบางฉบับเขียน bestchoice_prod = ผิด).

### 3. เปิด approval ก่อนจ่าย (คำสั่งเจ้าของข้อ 2)

Dev seed เปิดให้แล้ว; prod ต้อง insert SystemConfig เอง (ยังไม่มี UI toggle):

```sql
INSERT INTO system_config (id, key, value, label, created_at, updated_at)
VALUES (gen_random_uuid()::text, 'approval_enabled', 'true',
        'เปิด workflow ขออนุมัติเอกสารรายจ่าย (เงินเดือนต้องอนุมัติเสมอ)', NOW(), NOW())
ON CONFLICT (key) DO UPDATE SET value = 'true', updated_at = NOW();
```

ผล: เอกสาร PAYROLL ต้องผ่านอนุมัติเสมอ (`approval_required_doc_types` default
`['PAYROLL']`), เอกสารรายจ่ายอื่นต้องอนุมัติเมื่อเกิน `approval_threshold`
(default 50,000). ผู้มีสิทธิ์อนุมัติ = OWNER เสมอ + userId ใน `approvers_list`.

สิทธิเห็นเงินเดือนข้ามสาขา: OWNER / FINANCE_MANAGER / ACCOUNTANT เห็นทุกสาขา;
BRANCH_MANAGER เห็นเฉพาะสาขาตัวเอง (บังคับที่ `GET /expense-documents/:id` แล้ว —
เดิมรู้ id ก็เปิดดูได้).

### 4. Smoke test หลัง deploy

1. รายจ่าย → สร้างเอกสารใหม่ → เงินเดือน (PR) — ฟอร์มต้องเปิดแท็บเงินเดือนทันที
2. ตัวเลือก "กลุ่มพนักงาน" ต้อง default พนักงานสาขา (SHOP) + บัญชีจ่ายเป็น S11-XXXX
3. บันทึก & ส่งขออนุมัติ → อนุมัติ (OWNER) → auto-post
4. `/shop/accounting` Trial Balance ต้องเห็น S52-1201 ยอดตรงกับใบ
5. `/finance/wht-report` เลือกงวด → พนักงานครบทุกคนรวมคนภาษี 0, gross รวมโบนัส/OT
6. ทดลองสร้างงวดเดิมซ้ำ → ต้องถูกปฏิเสธพร้อมเลขเอกสารเดิม

## สถานะหลัง rollout (อัปเดต 2026-08-06)

ทำเสร็จในรอบ 2+3 แล้ว (PR #1395): สปส.1-10 + JE นำส่ง ปกส./ภ.ง.ด.1 (per-book),
ใบ 50 ทวิ + ภ.ง.ด.1ก (/finance/wht-annual), คัดลอกงวดที่แล้ว, แก้ไขร่าง,
WHT แนะนำ ม.48, ไฟล์โอนธนาคาร CSV.

Prod setup เสร็จ 2026-08-06: deploy + migration ✓, wipe:payroll DRY_RUN = 0 ใบ
(prod ไม่เคยมีเงินเดือน — ไม่ต้องล้าง), `approval_enabled='true'` ตั้งแล้ว,
seed ตรวจครบ (shop_* roles 7 / CoA S ใหม่ 5 / whitelist ทั้งสอง).

### คำตัดสินเจ้าของ 2026-08-06 — ปิดประเด็น (อย่าเสนอซ้ำ)

- **ส่งสลิปให้พนักงาน (LINE/email): ไม่ทำ** — พิมพ์สลิปกระดาษตามเดิม
- **PDPA retention payroll_lines: ไม่ลบทิ้ง** — เก็บข้อมูลเงินเดือนถาวร

### ยังค้างจริง

- กท.20ก แบบฟอร์มเต็ม (annualWageTotal บนหน้า /finance/wht-annual ใช้อ้างอิงยื่นได้แล้ว)
- จ่ายนำส่งภาษี/ปกส. รวมฝั่งเดียว — รอ CPA ตอบเรื่องบัญชี interco ฝั่ง SHOP (interco spec §11)
- รายจ่ายดำเนินงานอื่น (EX/CN/PC) ยังลง FINANCE codes ใต้ SHOP companyId เหมือนเดิม —
  ต้องถาม CPA ว่าค่าเช่า/ค่าไฟสาขาสังกัดฝั่งไหนก่อนแก้ (อย่าเหมารวมกับคำตอบเงินเดือน)
- `approvers_list` ยังว่าง — OWNER คนเดียวอนุมัติเงินเดือนได้ (เพิ่ม FM ได้ผ่าน SystemConfig)
