# Contact Rich Fields + Edit Form (Sub-project A1)

วันที่: 2026-06-01
สถานะ: รออนุมัติ spec จาก owner
ส่วนหนึ่งของ: PEAK-style contact detail expansion (A → B → C). อันนี้คือ **A1**.

## ที่มา

หน้า contact detail ปัจจุบันมีแค่ field พื้นฐาน (code, name, taxId, phone, email, address เดี่ยว, roles, isActive). owner ต้องการให้ครบแบบ PEAK ซึ่งแยกเป็นหลาย sub-project:

- **A** = ฟิลด์ครบ + edit form  ← spec นี้ (A1) + DBD lookup (A2, ทีหลัง)
- **B** = ผังบัญชีต่อ contact (AR/AP/IR-GR code, ครบกำหนดชำระ, ธนาคารคู่ค้า) — spec แยก
- **C** = แท็บภาพรวมการเงิน (ยอดขาย/AR aging/เอกสาร/กราฟ) — spec แยก

ลำดับ build: A1 → A2 → B → C.

## ขอบเขต A1 (ชัดเจน)

ทำ:
- ขยาย `Contact` model ด้วย field ระดับกิจการ + ที่อยู่ structured (เก็บเป็น text)
- ฟอร์ม **แก้ไข** Contact (modal) บนหน้า detail + แท็บ "ข้อมูลกิจการ"
- `PATCH /contacts/:id`
- backfill `entityType` ของ 37 rows เดิม

ไม่ทำ (อยู่ sub-project อื่น / YAGNI):
- DBD/สรรพากร tax-id lookup → **A2** (รอ owner มี API token; ออกแบบ field+form ให้รองรับการต่อทีหลังไว้)
- ช่องบัญชี (AR/AP code, credit term, ธนาคารคู่ค้า) → **B**
- แท็บภาพรวมการเงิน → **C**
- การ **สร้าง** Contact ใหม่ตรงๆ จาก /contacts — ยังผ่านฟอร์มลูกค้า/ผู้ขายเดิม (เหมือน v1). A1 ทำแค่ **แก้ไข** รายที่มีอยู่
- ผู้ติดต่อบุคคล (sub-contacts), แนบไฟล์, กลุ่มกำหนดเอง, วงเงินขายเชื่อ, แฟกซ์ — ตัด

## 1. โครงข้อมูล (ขยาย Contact)

เพิ่ม field nullable ทั้งหมด (2-step migration ปลอดภัยกับ 37 rows):

```
enum ContactEntityType { JURISTIC, INDIVIDUAL }

Contact (เพิ่ม)
  entityType      ContactEntityType?           // นิติบุคคล / บุคคลธรรมดา
  titlePrefix     String?                        // คำนำหน้า (คุณ/นาย/นาง/บจก.)
  firstName       String?                        // บุคคลธรรมดา
  lastName        String?                        // บุคคลธรรมดา
  branchCode      String?                        // เลขที่สาขา ("00000"=สำนักงานใหญ่) — นิติบุคคล
  website         String?

  // ที่อยู่จดทะเบียน (text — ไม่ FK; reuse AddressForm ฝั่ง web)
  regAddressLine  String?
  regSubdistrict  String?                        // ชื่อตำบล/แขวง
  regDistrict     String?                        // ชื่ออำเภอ/เขต
  regProvince     String?                        // ชื่อจังหวัด
  regPostalCode   String?

  // ที่อยู่จัดส่งเอกสาร
  shipSameAsReg   Boolean  @default(true)
  shipAddressLine String?
  shipSubdistrict String?
  shipDistrict    String?
  shipProvince    String?
  shipPostalCode  String?
```

หมายเหตุ:
- `name` เดิม = display name (list/search ใช้ตัวนี้ ไม่เปลี่ยน). ที่อยู่เก็บเป็นชื่อ (string) ตามที่ทั้งแอปทำ — **ไม่มี DB address module ให้ FK** (`thai-address-data.ts` เป็น static ฝั่ง frontend, ไม่มีตาราง). UX dropdown ได้จาก component `AddressForm` ที่มีอยู่แล้ว.
- ไม่แตะ `taxId` / `email` / `phone` / `lineId` / `roles` / `isActive` เดิม.

## 2. Backend

- `PATCH /contacts/:id` — รับ field ข้างบน (DTO `UpdateContactDto`, class-validator, ข้อความ error ไทย). guard `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles('OWNER','FINANCE_MANAGER','ACCOUNTANT')`. audit string `CONTACT_UPDATED` (ผ่าน AuditInterceptor เดิม).
- **name-sync** ใน service ตอน update:
  - `INDIVIDUAL` → `name = [titlePrefix] + firstName + lastName` (trim ช่องว่างซ้อน)
  - `JURISTIC` → `name = <ชื่อกิจการที่ส่งมา>` (field เดียวกับ name)
- soft-delete filter `deletedAt: null` เหมือนเดิม; โยน `NotFoundException('ไม่พบผู้ติดต่อ')` ถ้าไม่เจอ.

## 3. Frontend

หน้า `ContactDetailPage` แท็บ **"ข้อมูลกิจการ"** (เลียน layout PEAK):
- กลุ่ม **ข้อมูลจดทะเบียน**: ประเภท (badge นิติบุคคล/บุคคล), เลขภาษี, เลขสาขา, ที่อยู่จดทะเบียน (รวมเป็นบรรทัด)
- กลุ่ม **ช่องทางติดต่อ**: เบอร์, อีเมล, เว็บไซต์, LINE, ที่อยู่จัดส่ง
- toggle **เปิด/ปิดใช้งาน** (isActive) → PATCH
- ปุ่ม **"แก้ไข"** → **modal** (react-hook-form + zod ตาม pattern โปรเจค):
  - toggle **นิติบุคคล / บุคคลธรรมดา** → conditional: นิติบุคคล = ชื่อกิจการ + เลขสาขา ; บุคคล = คำนำหน้า + ชื่อ + สกุล
  - taxId, website, phone, email, LINE
  - `AddressForm` (component เดิม) สำหรับที่อยู่จดทะเบียน + checkbox "ที่อยู่จัดส่ง = ที่อยู่จดทะเบียน" → ติ๊กออกเพื่อโชว์ `AddressForm` ตัวที่สองสำหรับที่อยู่จัดส่ง
  - submit → `PATCH /contacts/:id` → invalidate react-query → ปิด modal + toast success (sonner)
- ใช้ semantic tokens เท่านั้น (frontend.md), Thai `leading-snug`
- API client เพิ่ม `contactsApi.update(id, payload)` ใน `lib/api/contacts.ts`

## 4. Migration + Backfill

- Migration เพิ่ม column ข้างบน (nullable) + enum `ContactEntityType`. **ตั้งชื่อโฟลเดอร์ migration ด้วย synthetic timestamp ให้เรียงท้ายสุด** (สูงกว่า `20260966000000`) — กันบั๊กลำดับ migration ที่เคยทำ CI/prod พัง (วันที่จริงเรียงไปกลาง history ก่อนตารางที่อ้างถูกสร้าง). verify ด้วย `migrate reset` จาก dev DB ว่า apply ท้ายสุดสะอาด.
- Backfill `entityType` ของ rows เดิม (CLI `src/cli/` แบบ compiled — ไม่ใช่ `tsx scripts/` — เพื่อรันเป็น Cloud Run Job บน prod ได้; บทเรียนจาก backfill ก่อน). guard `CONFIRM_BACKFILL` + `EXPECTED_DB_NAME` (prod = `bestchoice`, ไม่ใช่ `bestchoice_prod`):
  - contact ที่มี role SUPPLIER/FINANCE_COMPANY หรือมี taxId 13 หลักของนิติบุคคล → `JURISTIC`
  - ที่เหลือ (CUSTOMER/TRADE_IN_SELLER บุคคล) → `INDIVIDUAL`
  - idempotent: ข้าม row ที่ entityType ไม่ null แล้ว
  - ไม่ parse `name` เดิมเป็น firstName/lastName (เสี่ยง) — ปล่อย null ให้ผู้ใช้กรอกตอนแก้ไข

## 5. ทดสอบ

- API: `UpdateContactDto` validation; name-sync ถูกตาม entityType (INDIVIDUAL ประกอบ prefix+first+last / JURISTIC ใช้ชื่อกิจการ); conditional update; NotFound; RolesGuard (OWNER/FM/ACC).
- Web: edit modal — toggle entityType โชว์ field ถูกชุด; AddressForm 2 ตัว + checkbox shipSameAsReg ซ่อน/โชว์; submit ยิง PATCH ด้วย payload ถูก.
- Backfill: idempotent (รันซ้ำ entityType ไม่เปลี่ยน), จับ entityType ตาม role/taxId ถูก.

## 6. รองรับ A2 (DBD lookup) ในอนาคต

ออกแบบฟอร์มให้มีที่วางปุ่ม "ค้นหา" ข้างช่อง taxId ไว้ (A2 จะมาเติม handler ที่เรียก DBD API แล้ว auto-fill ชื่อ/ที่อยู่). A1 ปล่อยช่อง taxId ให้กรอกมือไปก่อน — ไม่มี handler lookup.
