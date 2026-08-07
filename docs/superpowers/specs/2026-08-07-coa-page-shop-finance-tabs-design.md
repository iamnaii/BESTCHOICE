# หน้าผังบัญชี — แท็บ FINANCE | SHOP (เจ้าของเลือกทาง ก, 2026-08-07)

## ปัญหา (ตรวจ 2026-08-07)

`/settings/accounting/chart` (`ChartOfAccountsPage.tsx`) เขียนไว้ยุค A.4 (ผัง FINANCE เดียว):

1. แสดงบัญชีทั้งตารางรวมกัน — SHOP 52 ตัว (S-prefix) ต่อท้าย FINANCE 110 ตัว
2. บั๊กจัดหมวด: `codePrefix()` ตัด 2 ตัวอักษรแรก → `S52-1201` กลายเป็นหมวด "S5" แสดง
   หัวข้อ "หมวด S1/S2/S4/S5" (fallback) แทนชื่อหมวดจริง
3. Subtitle ตายตัว "— BESTCHOICE FINANCE"
4. ฟอร์มเพิ่มบัญชีไม่ validate ฝั่ง → เกิดบัญชีหลงผังได้ (พบจริง: `42-1199 รายได้อื่นๆ
   ทั่วไป` สร้างเอง 2026-05-14, ไม่อยู่ในผัง CPA, 0 journal_lines)

ข้อมูล prod ตรวจแล้ว **ครบถ้วน**: FINANCE 110/110 + SHOP 52/52 ตรง CSV, ไม่มี inactive,
เกินแค่ 42-1199 ตัวเดียว.

## Design (ทาง ก — เจ้าของอนุมัติ)

แก้ไฟล์เดียว `ChartOfAccountsPage.tsx` + util ใหม่:

- **แท็บ scope**: segmented toggle `FINANCE (การเงิน)` | `SHOP (หน้าร้าน)` เหนือ filters,
  default FINANCE. กรองด้วย `code.startsWith('S')` (convention P3-SP5 — S = partition key).
  ค้นหา/กรองประเภท ทำงานภายในแท็บ.
- **util ใหม่ `apps/web/src/utils/coa-partition.ts`** (+ vitest):
  `coaScopeOf(code)`, `coaCodePrefix(code)` (S52-1201 → "S52"), `coaSectionLabel(prefix)`
  — labels ฝั่ง SHOP ตามกลุ่มใน shop-coa.csv ต่อท้าย "(SHOP)" ให้สอดคล้อง SECTION_MAP
  ของรายงานฝั่ง API.
- **Subtitle ตามแท็บ**: FINANCE (จด VAT) / SHOP (หน้าร้าน — ไม่จด VAT).
- **กันสร้างบัญชีผิดฝั่ง**: submit ตรวจ prefix ตรงแท็บที่เปิด (SHOP → ต้องขึ้นต้น S,
  FINANCE → ตัวเลขล้วน) พร้อมข้อความไทย; placeholder เปลี่ยนตามแท็บ; สลับแท็บล้าง
  คำค้น/ตัวกรอง (review W1).
- **แก้ API DTO** (review CRITICAL): `CreateChartOfAccountDto.code` เดิม
  `/^[0-9-]{2,12}$/` (ยุค A.4) reject รหัส S ทุกตัว — เพิ่มบัญชี SHOP จากหน้าเว็บ
  จะ 400 เสมอ → เปลี่ยนเป็น `/^S?\d{2}-\d{4}$/` (รูปแบบเดียวกับ csv-fixture-loader).
- **Data fix prod**: soft-delete `42-1199` (ยืนยัน 0 JE — เจ้าของอนุมัติในแพ็กเกจทาง ก).

Out of scope: การ renumber ผัง SHOP ตามภาพ CPA ฉบับเต็ม (โปรเจคแยก — รอ CPA),
server-side scope filter (client กรองพอ — ข้อมูล 162 แถว).
