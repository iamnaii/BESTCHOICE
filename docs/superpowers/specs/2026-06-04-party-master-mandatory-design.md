# Party Master Mandatory — ห้าม free-text ผู้ติดต่อทั้งโปรแกรม

วันที่: 2026-06-04
สถานะ: รออนุมัติ spec จาก owner
ต่อยอดจาก: [2026-06-01-unified-contact-party-master-design.md](2026-06-01-unified-contact-party-master-design.md) (party master) + [2026-06-04-peak-style-contact-picker-design.md](2026-06-04-peak-style-contact-picker-design.md) (slice 1 ผู้ขาย — merged)

## ที่มา / ปัญหา

แม้จะมี `Contact` (party master) แล้ว หลายจุดในแอปยัง**อ้างผู้ติดต่อเป็น free-text string** — `ExpenseDocument.vendorName`, `OtherIncome.counterpartyName`, `TradeIn.sellerName`, ช่องค้นที่พิมพ์ชื่อลอยได้ ฯลฯ → เกิด **"ผู้ติดต่อผี"** ที่ไม่ผูกเข้า Contact → AR/AP และเอกสารภาษีไม่ reconcile เข้า record เดียว ขัดทั้งหลักบัญชีและต้นแบบ PEAK

## เป้าหมาย (end-state)

**ทุกการอ้างอิงผู้ติดต่อ = Contact จริงเสมอ ไม่มี string ลอย** — ผู้ใช้เลือกผู้ติดต่อเดิม หรือสร้างใหม่ inline (เข้า party master ทันที); ข้อมูล free-text เดิมถูก migrate เป็น Contact

## การตัดสินใจ (เคาะกับ owner แล้ว — 2026-06-04)

1. **ห้าม free-text ทุกที่** — ไม่มีข้อยกเว้น one-off (แม้จ่ายครั้งเดียวก็ต้องเป็น Contact, สร้าง inline)
2. **บังคับถึง backend ที่ write-path** — service ปฏิเสธการเขียน free-text ใหม่ทุก path (ไม่ใช่แค่ซ่อนปุ่มใน UI). ข้อมูล free-text **เก่า** ทำ cleanup แยกที่ review ทีละชุด — **ไม่** ทำ NOT-NULL migration + mass fuzzy-backfill (scrutinize: เสี่ยงแปลง free-text orphan เป็น Contact ผีซ้ำ)
3. **create flow = context-aware** — ช่องผู้ขาย/คู่ค้า → mini-modal; ช่องลูกค้าผ่อน → ฟอร์มเต็ม; ทั้งคู่ติด badge "ข้อมูลไม่ครบ" ถ้ายังขาด

## Design

### 1. `ContactCombobox` v2 (enabler — ทุกอย่างพึ่งตัวนี้)

- **ตัด `onTypeName` (free-text path) ออก** — เลือกได้เฉพาะผู้ติดต่อจริง หรือกด "สร้างผู้ติดต่อใหม่"
- เพิ่ม inline create แบบ context-aware ผ่าน prop (เช่น `createMode: 'mini' | 'full-customer'`):
  - **`mini`** → เปิด `<CreateContactModal>` เก็บ: ชื่อ, ประเภท (บุคคล/นิติบุคคล), เลขผู้เสียภาษี/บัตรปชช., เบอร์, ที่อยู่, (บริบทผู้ขาย: hasVat + ประเภท WHT) → `POST /contacts` สร้าง Contact + ensure-role child → คืน childId กลับช่องนั้น
  - **`full-customer`** → นำทางไปฟอร์ม intake ลูกค้าเดิม (POS/contract) แทน mini (KYC ครบ)
- **ปิดรอยรั่ว KYC (scrutinize):** ในบริบท lending ถ้าเลือกผู้ติดต่อ **เดิม** ที่ Customer link เป็น stub (เช่น ไม่มี `nationalId`) → บังคับเด้งฟอร์ม KYC ก่อนใช้ ไม่ใช่แค่ตอน create ใหม่ (กันสัญญาเดินด้วยลูกค้า KYC ไม่ครบ)
- แถวที่ provision/สร้างใหม่แล้วข้อมูลไม่ครบ (เช่น phone ว่าง / ยังไม่มี KYC) → badge **"ข้อมูลไม่ครบ"**

### 2. Backend

- **เปิด CUSTOMER ใน `ensureRole`** (resolver) — สร้าง Customer stub (name + phone mirror, encryption/hash null ค่อยเติม) แบบเดียวกับ SUPPLIER
- **mini-create reuse endpoint เดิม** (scrutinize: ไม่สร้าง `POST /contacts` ใหม่) — `POST /suppliers` / `POST /customers` **สร้าง Contact ให้อยู่แล้ว**ผ่าน `findOrCreateByNaturalKey`; mini-modal เรียกตัวนี้ด้วย slim DTO (field เท่าที่กรอก)
- **write-path guard (P3):** service ของ Expense/OtherIncome/TradeIn **ปฏิเสธ**การบันทึกที่อ้างผู้ติดต่อแบบ free-text (ต้องมี contactId/childId) — กันของใหม่โดยไม่ต้อง migrate schema
  - เพิ่ม FK แบบ **nullable** (`vendorContactId` ฯลฯ) ให้ของใหม่ผูกได้ — **ไม่บังคับ NOT-NULL** กับแถวเก่า
  - `TradeIn` มี `sellerContactId` อยู่แล้ว; `OtherIncome` มี `customerId` บางส่วน
  - ของเก่า (free-text orphan): **cleanup แยก (P3.5)** — เครื่องมือ match → Contact ทีละชุดให้คน review, **ไม่** auto fuzzy-backfill ทั้งตาราง (เลี่ยง Contact ผีซ้ำ)

### 3. Picker inventory (ต้องแปลงให้ครบ)

| Picker | ช่อง | createMode |
|---|---|---|
| VendorCombobox (รายจ่าย v4) | ผู้ขาย | mini |
| PurchaseOrder supplier select | ผู้ขาย | mini |
| RepairCenterCombobox (ประกัน) | ศูนย์ซ่อม | mini (+ isRepairCenter) |
| CounterpartyPicker (รายรับอื่น) | คู่ค้า/ลูกค้า | mini |
| CustomerPickerStep (ประกัน) | ลูกค้า | mini หรือ full |
| CustomerSelectStep (สัญญา) | ลูกค้าผ่อน | **full-customer** |
| (Trade-in seller ถ้ามี UI) | คนขายมือสอง | mini |

### Inventory เต็มจาก sweep (P0a — 2026-06-04)

**ใน scope (เป็น party-master contact จริง):**
- **ผู้ขาย/vendor:** `VendorCombobox` (รายจ่าย, `onTypeName`), `PettyCashLinesSection` per-line `supplierName`, `AssetEntrySection3Vendor` (asset — มี dropdown "ชื่อที่เคยใช้"), PurchaseOrder supplier `<select>`
- **ศูนย์ซ่อม:** `RepairCenterCombobox` (supplier + `isRepairCenter`)
- **คู่ค้า/ลูกค้า:** `CounterpartyPicker` (รายรับอื่น)
- **ลูกค้า:** `CustomerPickerStep` (ประกัน), `CustomerSelectStep` (สัญญา → full-customer)
- **คนขายมือสอง:** TradeIn `sellerName`/`sellerPhone` (`AcceptModal`) — role `TRADE_IN_SELLER` มีใน party master

Backend free-text fields ที่ต้องกัน (P3): `ExpenseDocument.vendorName`, `ExpenseLine.supplierName`, `OtherIncome.counterpartyName/TaxId/Address/Phone`, `TradeIn.sellerName/sellerPhone`, `FixedAsset.supplierName/supplierTaxId`

**นอก scope ของ epic นี้ (ไม่ใช่ party-master contact — เคาะกับ owner):**
- `PayrollLine.employeeName` — **พนักงาน ไม่ใช่ลูกค้า/ผู้ขาย** (`Contact` ไม่มี role EMPLOYEE) → ควรเป็น "employee master" แยก ไม่ใช่ epic นี้
- `TradeIn.transferBankName/transferAccountName` — บัญชีธนาคารผู้รับเงิน ไม่ใช่ "ผู้ติดต่อ"
- `Receipt.payerName/receiverName` — auto-fill จาก customer/company อยู่แล้ว → แค่กันการแก้มือ (low)
- custodianName (`NameAutocomplete`, ผู้ถือเงินสดย่อย) — พนักงานภายใน ไม่ใช่ party

## เฟส (แต่ละเฟส = PR ที่ทำงาน/ทดสอบได้เอง)

- **P0 — ContactCombobox v2 + backend create** _(เริ่มที่นี่)_
  - **Sweep** หา free-text contact touchpoint ทั้ง repo → ทำ inventory จริงให้ครบ
  - เปิด CUSTOMER ใน `ensureRole` + tests
  - `CreateContactModal` (mini) **เรียก `POST /suppliers`/`POST /customers` เดิม** + ใส่ inline-create เข้า ContactCombobox, ตัด free-text path, badge "ข้อมูลไม่ครบ"
  - อัปเดต VendorCombobox (merged) ให้เลิก free-text — **แต่ validate ความเร็ว mini-modal กับ flow รายจ่ายจริงก่อน lock** (เผื่อ quick-create เบอร์เดียวสำหรับ one-off)
- **P1 — ช่องผู้ขายที่เหลือ:** PurchaseOrder supplier, RepairCenter
- **P2 — ช่องลูกค้า:** CounterpartyPicker, CustomerPickerStep, CustomerSelectStep (full-customer + ปิดรอยรั่ว KYC)
- **P3 — write-path guard + nullable FK:** service ปฏิเสธ free-text ใหม่, เพิ่ม FK nullable, ผูกของใหม่ — **ไม่บังคับ NOT-NULL/ไม่ mass-backfill** (ขึ้นกับ P1+P2 เสร็จครบ **ทุก write-path** ก่อน — P3 เป็น barrier ไม่ใช่ slice อิสระ)
- **P3.5 (แยก, optional) — cleanup ของเก่า:** เครื่องมือ match free-text orphan → Contact ทีละชุดมีคน review
- **P4 — เก็บกวาด:** badge ข้อมูลไม่ครบทุกหน้า detail, ลบ field free-text ที่ตายแล้ว, ลบ `onTypeName` ทุก caller

## ความเสี่ยง / ข้อควรระวัง

- **mass-backfill เสี่ยงสร้าง Contact ผีซ้ำ** (free-text ชื่อซ้ำ ไม่มีเลขภาษี) → ลดรูปเป็น cleanup ทีละชุดมีคน review (P3.5), ไม่ auto ทั้งตาราง
- **รอยรั่ว KYC:** เลือก contact เดิมเข้า lending context ได้ stub → ต้องเด้ง KYC ถ้า Customer เป็น stub (ไม่ใช่แค่ตอน create)
- **UX รายจ่าย one-off ช้าลง** (เลิกพิมพ์ลอย → ต้อง create) → validate ความเร็ว mini-modal ก่อน lock VendorCombobox
- **party master ปน non-trade** (ธนาคารดอกเบี้ยฝาก ฯลฯ) จากนโยบาย "ห้ามทุกที่" → owner รับทราบ/หรือแยก group "ผู้รับเงินเบ็ดเตล็ด" ภายหลัง

## ไม่ทำใน epic นี้ (YAGNI)

- Import Excel / custom groups (อยู่ใน spec แม่)
- Auto-fill จาก DBD (feature แยก)
