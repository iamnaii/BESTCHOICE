# Payroll รอบ 2+3 — นำส่งภาษี/ปกส. + เครื่องมือลดงาน (คำสั่งเจ้าของ 2026-08-06 "ทำเลยสิ")

ต่อยอดจาก `2026-08-06-payroll-shop-side-design.md` (merged เป็น commit b1410f2d).
เจ้าของสั่งเดินรอบ 2 (ภาษี/กฎหมาย) + รอบ 3 (ลดงานคนทำเงินเดือน) ต่อทันที.

## ขอบเขตรอบนี้

| # | งาน | รูปแบบ |
|---|---|---|
| R2-1 | สปส.1-10 รายเดือน | `GET /tax/sso-1-10-preview?year&month` + XLSX `form=SSO110` |
| R2-2 | JE นำส่ง ปกส. | `SsoRemittanceTemplate` + `POST /tax/payroll-remit/sso` |
| R2-3 | JE นำส่ง ภ.ง.ด.1 | `Pnd1RemittanceTemplate` + `POST /tax/payroll-remit/pnd1` |
| R2-4 | ภ.ง.ด.1ก รายปี | `GET /tax/pnd1-annual-preview?year` + XLSX `form=PND1A` |
| R2-5 | ใบ 50 ทวิ พนักงาน | หน้า `/finance/wht-annual` — print sheet ต่อคน (ม.40(1)) |
| R3-1 | คัดลอกงวดก่อน | ปุ่มในฟอร์ม — ดึงใบล่าสุด (branch+scope) มาเติม client-side |
| R3-2 | แก้ไขร่าง | `PATCH /expense-documents/:id/payroll` (DRAFT เท่านั้น) + UI edit mode |
| R3-3 | ไฟล์โอนธนาคาร | `GET /expense-documents/:id/bank-transfer.csv` |
| R3-4 | WHT แนะนำ | util ขั้นบันได ม.48 ฝั่ง web — advisory hint ใต้ช่อง WHT |
| CI | Test Web step | เทสต์ web ไม่เคยรันใน CI มาก่อน |

**เว้นไว้ (พร้อมเหตุผล):** ส่งสลิปเข้า LINE/email (ต้องต่อ Mailer/LINE infra — งานแยก),
PDPA retention payroll_lines (รอนโยบายเจ้าของว่าเก็บกี่ปี), กท.20ก แบบเต็ม
(annual preview ให้ Σ ค่าจ้างทั้งปีไว้ประกอบการยื่นแล้ว — แบบฟอร์มเต็มไว้รอบหน้า).

## D1 — นำส่ง "แยกฝั่ง" (per-book) เท่านั้น

การยื่น สปส.1-10 / ภ.ง.ด.1 เป็นระดับนิติบุคคล (ยื่นรวม) แต่สมุดบัญชีแยก SHOP/FINANCE.
จ่ายรวมก้อนเดียวจากธนาคารฝั่งเดียว ⇒ ต้องมีบัญชี "เจ้าหนี้ระหว่างกันฝั่ง SHOP" ซึ่งเป็น
คำถาม CPA ที่ค้าง (interco spec §11 + exchange asymmetry note) — **ห้ามเดา JE**.
ดังนั้นรอบนี้: **แต่ละฝั่งล้างเจ้าหนี้ของตัวเองจากธนาคารของตัวเอง** (2 JE เมื่อมีทั้งสองฝั่ง):

```
SSO   (per scope):  Dr <sso_employee payable> X + Dr <sso_employer payable> X
                       Cr <เงินสด/ธนาคารฝั่งนั้น> 2X
PND1  (per scope):  Dr <wht_payroll payable> W / Cr <เงินสด/ธนาคารฝั่งนั้น> W
```

- Codes ผ่าน AccountRoleMap ตาม scope (`sso_employee`/`shop_sso_employee` ฯลฯ)
- **ยอด** = Σ จาก `PayrollLine` ของใบ POSTED (ไม่ลบ/ไม่ VOID) ในงวด+ฝั่งนั้น —
  ตรงกับตัวเลขบนแบบยื่น. ไม่ใช้ยอด GL ทั้งบัญชีเพราะอาจมีหลายงวดค้างปน
- **Guard**: ยอดค้าง GL ของบัญชีเจ้าหนี้นั้น (per company) ต้อง ≥ ยอดนำส่ง —
  กันนำส่งเกิน/นำส่งงวดที่จ่ายแล้ว; idempotency `sso-remit:<scope>:<period>` /
  `pnd1-remit:<scope>:<period>` (DB partial unique index); period-open guard ที่
  วันจ่าย (payDate, default วันนี้ BKK) ของ company ฝั่งนั้น
- ภ.ง.ด.36-style 2-step (ตั้งเจ้าหนี้สรรพากรก่อนจ่าย) ไม่ใช้ — จ่ายตรงขั้นเดียว
  เหมือน `WhtRemittanceTemplate` เดิม (ซึ่งยังคงไว้สำหรับ vendor PND3/53, ไม่แตะ)

## D2 — สปส.1-10 / ภ.ง.ด.1ก: document-driven (pattern เดียวกับ PND1 ที่พิสูจน์แล้ว)

- แหล่งข้อมูล = เอกสาร PAYROLL `status='POSTED' AND journalEntryId != null AND
  deletedAt IS NULL` คีย์งวดด้วย `paidAt` (fallback `documentDate`) — ใบ VOID
  หลุดออกอัตโนมัติ, ไม่ gate ด้วย branch/company (นิติบุคคลเดียว)
- สปส.1-10: รายคน `{scope, employeeName, employeeTaxId, wage=baseSalary,
  ssoEmployee, ssoEmployer=ssoEmployee}` เฉพาะแถว `ssoEmployee > 0` (คนไม่เข้า
  ปกส. ไม่ขึ้นแบบ) + subtotal per scope + รวม
- ภ.ง.ด.1ก: group ทั้งปีด้วย `employeeTaxId ?? employeeName` →
  `{employeeName, employeeTaxId, monthsPaid, grossTotal(ฐาน+รายได้พิเศษที่เสียภาษี),
  whtTotal, ssoTotal}` + `annualWageTotal` (อ้างอิง กท.20ก)
- 50 ทวิ: ใช้ข้อมูล annual ต่อคน + `CompanyInfo` (nameTh, taxId, address,
  directorName) — บริษัทผู้จ่ายใช้ FINANCE CompanyInfo (นิติบุคคลจดทะเบียนเดียว)

## D3 — แก้ไขร่าง (R3-2)

`PATCH /expense-documents/:id/payroll` body = `UpdatePayrollDto` (ชุดเดียวกับ create
ยกเว้น `branchId` — ห้ามย้ายสาขา). เงื่อนไข: `documentType='PAYROLL'` + `status='DRAFT'`
+ ผู้แก้ต้องเข้าถึงสาขาได้. ใน `$transaction`: validator ครบชุดเดิม (SSO cap, V17/V18/V19,
dup userId, scope↔deposit, dup-งวด **ยกเว้นตัวเอง**) → ลบ PayrollDetail เดิม (cascade
lines/custom — ปลอดภัยเพราะ DRAFT ไม่มี JE อ้าง — pattern เดียวกับ
`updateBatch` ของ interco) → สร้างใหม่ + อัปเดต header totals. AuditLog ผ่าน
global interceptor ตามเดิม.
UI: ปุ่มแก้ไขบน ExpensesPage (ร่าง PR) → `/expenses/new?edit=<id>` → ฟอร์ม prefill
จาก findOne → บันทึก = PATCH (ปุ่มเดียวกับ create แต่สลับ endpoint).

## D4 — เครื่องมือฝั่งฟอร์ม

- **คัดลอกงวดก่อน**: ปุ่ม "ดึงงวดล่าสุด" → `GET /expense-documents?type=PAYROLL`
  (branch, ล่าสุด, ไม่ VOID) → `findOne` → เติม userId/ฐาน/SSO/WHT/custom rows —
  ชื่อ+เลขบัตร re-derive ฝั่ง server ตอนบันทึกอยู่แล้ว (คนลาออก → server ปฏิเสธพร้อม
  ข้อความบอกให้เอาออก), SSO cap re-validate ด้วยวันที่ใหม่. ไม่มี endpoint ใหม่.
- **WHT แนะนำ** (`pit-withholding.util.ts` ฝั่ง web + unit test): รายปี = ฐานเดือน×12;
  หักค่าใช้จ่าย 50% ไม่เกิน 100,000; ลดหย่อนส่วนตัว 60,000; หัก ปกส. จริง×12;
  ขั้นบันได ม.48 (0-150k ยกเว้น, 5%,10%,15%,20%,25%,30%,35%) → ภาษีปี/12.
  แสดงเป็น hint + เตือนเบาๆ เมื่อผู้ใช้กรอกต่างมาก — **advisory เท่านั้น ไม่ block**
  (ไม่มีข้อมูลลดหย่อนรายคน เช่น คู่สมรส/บุตร — ค่าแนะนำจึงเป็น "ขั้นต่ำแบบมาตรฐาน")
- **Bank CSV**: คอลัมน์ `ลำดับ,ชื่อพนักงาน,ธนาคาร,เลขบัญชี,จำนวนเงิน(netPaid)` UTF-8
  BOM; แถวที่ไม่มีข้อมูลธนาคาร (free-text/ไม่กรอก) → ข้าม + `X-Skipped-Lines`
  header (pattern เดียวกับ PEAK export). Roles OWNER/FM/ACC.

## การทดสอบ

- Unit: template goldens ทั้ง 2 ฝั่ง (SSO/PND1 remit), sso-1-10 + annual preview
  (รวมคน sso=0 ไม่ขึ้น สปส. แต่ขึ้น ภ.ง.ด.1ก), updatePayroll (dup-งวด exclude self,
  status guard), bank CSV (skip rows), pit-withholding util (ขั้นบันได golden)
- Integration (ต่อไฟล์ `payroll-shop-flow.integration.spec.ts`): นำส่ง SSO+PND1 ฝั่ง
  SHOP → GL S21-3101/S21-3105/S21-3106 เหลือ 0, นำส่งซ้ำ → reject, แก้ร่าง →
  ยอดใหม่ถูก, CSV มีเลขบัญชีจริง
- CI: เพิ่ม `Test Web` step (vitest apps/web) — เทสต์ web ทั้งหมดไม่เคยรันใน CI
