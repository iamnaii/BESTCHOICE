# ใบเสร็จรับเงินขายสด (ก้อน 4 — A1 + A2) — Design Spec

**วันที่:** 2026-10-23 · **ที่มา:** เทียบ Tooltify ข้อ A1/A2 · mockup เจ้าของเคาะ canvas `MJtjyKKQzBYRNyM4jVhFec` (บอร์ด `Receipt.dc.html` / `PosDone.dc.html` / `Share.dc.html`)

## คำตัดสินเจ้าของ (23/10)

| ข้อ | คำตอบ |
|---|---|
| กระดาษ | **A4 อย่างเดียว** ไม่ทำสลิป 80mm |
| ชื่อผู้ขาย | **พิมพ์** |
| ข้อความเงื่อนไขประกันร้าน | **แก้ได้จากหน้าตั้งค่า** ค่าเริ่มต้นคือข้อความใน mockup |
| เลขเอกสาร | **ใช้เลขใบขาย `saleNumber` เดิม** ไม่ออกเลขใบเสร็จแยก |
| A2 แชร์ให้ลูกค้า | **ทั้ง 3 ทาง**: LINE ร้าน (Flex) · หน้าสาธารณะ 30 วัน · คัดลอกลิงก์ |
| เอกสารอื่น (ใบกำกับ/ใบเสนอราคา) | ไม่ทำ (A1 โน้ต "ขายสดทำแต่ใบเสร็จพอ" · A3 ไม่ทำ) |

## ขอบเขต

ใบขายประเภท `CASH` และ `EXTERNAL_FINANCE` เท่านั้น. `INSTALLMENT` ไม่เข้า — ประกัน/ใบเสร็จผูกกับสัญญาและมีเส้นทางของตัวเองอยู่แล้ว (`receipts` module).

**ไม่สร้างแถว `Receipt`** — `Receipt.contractId` บังคับ. ใบเสร็จขายสดเรนเดอร์สดจาก `Sale` ทุกครั้ง (เหมือน `other-income/services/receipt-pdf.service.ts`).

## ข้อมูล

Migration `20261101000000_sale_receipt_token` เพิ่มบน `sales`:
- `receipt_token TEXT NULL UNIQUE` — `crypto.randomBytes(32).toString('base64url')`
- `receipt_token_expires_at TIMESTAMP(3) NULL` — ต่ออายุเป็น now + 30 วันทุกครั้งที่ออกเอกสาร/แชร์ (token เดิมคงไว้ ลิงก์ที่เคยส่งไม่ตาย — แบบเดียวกับใบลดหนี้)

ค่าตั้งค่า `SystemConfig` คีย์ `receipt_shop_warranty_terms` (snake_case ตาม `SettingItemDto`). ค่าเริ่มต้นเมื่อไม่มีแถว = `DEFAULT_RECEIPT_WARRANTY_TERMS` ใน `packages/shared/src/sale-receipt.ts`:

> เปลี่ยนเครื่องรุ่นเดิมได้เมื่อมีตำหนิจากการผลิตภายในระยะประกันร้าน นับจากวันรับเครื่อง · ไม่รวมตก น้ำเข้า จอแตก · ประกันศูนย์ตามเงื่อนไขผู้ผลิต

(mockup เขียน "ภายใน 7 วัน" แต่จำนวนวันจริงมาจาก `warranty.shopWarrantyDays` ซึ่งเปลี่ยนได้ — ข้อความเริ่มต้นจึงไม่ฝังตัวเลข บรรทัด "ประกันร้าน N วัน · เริ่ม – สิ้นสุด" พิมพ์จากวันจริงของใบขายแทน)

## API (module `sales`)

| Route | สิทธิ์ | ทำอะไร |
|---|---|---|
| `GET /sales/:id/receipt.pdf` | OWNER, BRANCH_MANAGER, FINANCE_MANAGER, ACCOUNTANT, SALES + ขอบเขตสาขาเดิม (`salesBranchWhere`) | PDF A4 `inline` · ใบยกเลิกได้ PDF พร้อมลายน้ำ "ยกเลิก" · INSTALLMENT → 400 |
| `POST /sales/:id/receipt/share` | เท่ากัน | ออก/ต่ออายุ token → `{ url, expiresAt }` · ใบยกเลิก → 400 |
| `POST /sales/:id/receipt/line` | เท่ากัน | ส่ง Flex ไป `customer.lineIdShop` ช่อง `line-shop` → `{ delivered, reason? }` (`NO_LINE_LINK` / `PUSH_FAILED`) · ใบยกเลิก → 400 · ไม่ throw เมื่อส่งไม่ได้ |
| `GET /sales/receipt/public/:token/pdf` | สาธารณะ (controller แยก ไม่มี guard) · throttle 10/นาที | token ไม่รู้จัก/หมดอายุ/ใบยกเลิก → 404 ข้อความเดียวกัน "ไม่พบเอกสาร หรือลิงก์หมดอายุแล้ว" |

URL สาธารณะ = `${PAYMENT_LINK_BASE_URL ∥ FRONTEND_URL ∥ http://localhost:5173}/r/${token}` (แหล่งเดียวกับใบลดหนี้ `credit-note-delivery.service.ts`).

ทุกครั้งที่ออก PDF (ทั้งพนักงานและสาธารณะ) ระบบ `ensureToken` ก่อน เพราะ QR บนกระดาษชี้ไปหน้าสาธารณะ — การพิมพ์ซ้ำจึงต่ออายุลิงก์ให้ลูกค้าด้วย.

การส่ง LINE บันทึก `NotificationLog` ทุกครั้ง (channel `LINE`, channelKey `line-shop`, subject `ใบเสร็จรับเงิน`, category `TRANSACTIONAL`, relatedId = saleId, status SENT/FAILED) — แบบเดียวกับ `sale-warranty-notifier.service.ts`. ไม่ gate PDPA (เอกสารการเงินของธุรกรรมที่ลูกค้าทำเอง — เหตุผลเดียวกับใบลดหนี้).

## เนื้อหา PDF (ตาม mockup `Receipt.dc.html`)

โครงเอกสารใช้ `TRANSACTION_PAGE_CSS` + `transactionDocumentCss('body')` + `embeddedDocumentFonts()` เหมือน other-income. A4 ขอบ 0 (CSS จัดเอง).

1. **หัว**: `CompanyInfo(companyCode='SHOP')` — `nameTh (สาขา {branch.name})` · address · "เลขประจำตัวผู้เสียภาษี {taxId} · โทร {phone}" · ขวา: "ใบเสร็จรับเงิน" + "RECEIPT · ต้นฉบับ" (EXTERNAL_FINANCE ต่อท้าย " · เงินดาวน์") · เลขที่ = `saleNumber` · วันที่ = `createdAt` เวลาไทย `dd/MM/พ.ศ. HH:mm` · สาขา.
2. **คู่สัญญา**: ลูกค้า `customer.name` · โทร · (รหัสลูกค้า: พิมพ์เฉพาะเมื่อมี `legacyMemberCode` — `Customer` ไม่มีรหัสอื่น). ขวา "การรับชำระเงิน": วันที่ชำระ = `createdAt` · บรรทัดเงินจาก `shopTenders` (direction IN, เรียง seq): `{วิธี} {amount} บาท` + " · อ้างอิง {reference}" ถ้ามี · ไม่มี tender (ใบเก่า) → ใช้ `paymentMethod` + `amountReceived` · ใบจากการจอง (`receiptBreakdown.depositAmount` ไม่ null) → เพิ่มบรรทัดแรก "มัดจำจอง ({วิธี}) {depositAmount} บาท" · EXTERNAL_FINANCE → บรรทัด "ไฟแนนซ์ {financeCompany} · เลขอ้างอิง {financeRefNumber ∥ '-'}" · "พนักงานขาย {salesperson.name}".
   ป้ายวิธี: CASH=เงินสด · BANK_TRANSFER=โอน · QR_EWALLET=QR/e-Wallet · CARD=บัตร · CREDIT_BALANCE=เครดิตคงเหลือ · ONLINE_GATEWAY=ชำระออนไลน์.
3. **ตารางรายการ** (รายการ · จำนวน · ราคา · จำนวนเงิน): เครื่องหลัก = `product.name` · "IMEI {imeiSerial}" (หรือ S/N) · บรรทัดเปิดเผย = `{หมวด} · {disclosureText(productDisclosure)}` (หมวด: PHONE_NEW=เครื่องใหม่ · PHONE_USED=มือสอง · อื่น=ไม่พิมพ์) · 1 · sellingPrice · sellingPrice. ของแถม = สินค้าใน `bundleProductIds` (ชื่อ + รหัส/IMEI) · "ของแถม" · 0.00.
4. **สรุปเงิน** (ขวา): รวมรายการ = sellingPrice · ส่วนลด = −discount (ซ่อนถ้า 0) · เครดิตเทิร์น (ใบรับเทิร์น {voucherNumber ∥ tradeInId}) = −baseAmount (ถ้ามี snapshot; โบนัสรวมอยู่ในส่วนลดแล้วตามหน้า /sales) · **ยอดสุทธิ** = netAmount · CASH: "จำนวนเงินที่รับ" = ผลรวม tender IN (∥ amountReceived ∥ netAmount) · EXTERNAL_FINANCE: "จัดไฟแนนซ์ {financeCompany}" = −financeAmount · "เงินดาวน์ที่รับ" = downPaymentAmount. ซ้าย: "จำนวนเงิน (ตัวอักษร)" = `thaiBahtText(จำนวนที่รับ)`.
5. **กล่องประกัน**: มี `shopWarrantyEndDate` → "ประกันร้าน {days} วัน · {start} – {end}" (days = จาก `productDisclosure.shopWarrantyDays` ∥ นับวันจริง) · ไม่มี → "ไม่มีประกันร้าน · ประกันศูนย์ตามเงื่อนไขผู้ผลิต" · บรรทัดถัดไป = ข้อความตั้งค่า `receipt_shop_warranty_terms` · ถ้า `productDisclosure.warrantyTerms` มี → ต่อท้ายอีกบรรทัด.
6. **ข้อความกำกับ**: CASH: "ร้านค้าไม่ได้จดทะเบียนภาษีมูลค่าเพิ่ม — เอกสารนี้เป็นใบเสร็จรับเงิน ไม่ใช่ใบกำกับภาษี" · EXTERNAL_FINANCE: "ส่วนที่เหลือ {financeAmount} บาท ชำระกับ {financeCompany} ตามสัญญาของบริษัทไฟแนนซ์ · ร้านค้าไม่ได้จดทะเบียนภาษีมูลค่าเพิ่ม — เอกสารนี้ไม่ใช่ใบกำกับภาษี".
7. **ท้าย**: QR (ลิงก์สาธารณะ) "สแกนเพื่อเปิดใบเสร็จ" · ติดต่อ "สาขา{branch} · โทร {company.phone}" · ช่องลงนาม "ผู้ขาย · {วันที่}" ชื่อ `salesperson.name` · "ออกโดยระบบ BESTCHOICE".
8. **ใบยกเลิก** (`deletedAt`): ลายน้ำ "ยกเลิก" ทแยงทับกลางหน้า + บรรทัด "ยกเลิกเมื่อ {deletedAt} · {voidReason}".

ทุกค่าผ่าน `escapeHtml`. เงินผ่าน `fmtMoney`. วันที่ไทยผ่าน `fmtDateShort`.

## Flex (LINE ร้าน)

bubble: หัว "ใบเสร็จรับเงิน" สี `COLORS.PRIMARY` · ชื่อเครื่อง (brand model storage) · "เลขที่ {saleNumber}" · "ยอดสุทธิ {netAmount} บาท" (EXTERNAL_FINANCE: "เงินดาวน์ {downPaymentAmount} บาท") · ปุ่ม `uri` "เปิดใบเสร็จ" → URL สาธารณะ · หมายเหตุ "ลิงก์ใช้ได้ 30 วัน". altText = `ใบเสร็จรับเงิน {saleNumber}`.

## Web

- **หลังขายสำเร็จ (POS)** — `SaleDoneDialog` แทน toast สำหรับ CASH/EXTERNAL_FINANCE (ตาม `PosDone.dc.html`): หัว "ขายสำเร็จ · {saleNumber}" + ยอด · ปุ่ม `SaleReceiptActions` (พิมพ์ใบเสร็จ / ส่ง LINE / คัดลอกลิงก์) · ปุ่มหลัก "ขายต่อ" = ปิด + `resetForm()`. ปิดด้วย Esc/คลิกนอก = เหมือนกดขายต่อ.
- **แผงใบขาย `/sales?saleId=`** — แถว "เอกสาร" ใส่ `SaleReceiptActions` (ใบยกเลิก → เหลือ "พิมพ์ใบเสร็จ" อย่างเดียว · INSTALLMENT → ไม่แสดง).
- **`SaleReceiptActions`** (`components/sales/SaleReceiptActions.tsx`): พิมพ์ = `PdfPreview` path `/sales/{id}/receipt.pdf` ชื่อไฟล์ `ใบเสร็จ-{saleNumber}.pdf` · ส่ง LINE = POST `/receipt/line` → toast: delivered → "ส่งใบเสร็จทาง LINE แล้ว" · NO_LINE_LINK → "ลูกค้ายังไม่ผูก LINE ร้าน — คัดลอกลิงก์ส่งให้แทน" · PUSH_FAILED → "ส่ง LINE ไม่สำเร็จ ลองใหม่หรือคัดลอกลิงก์" · คัดลอกลิงก์ = POST `/receipt/share` → `navigator.clipboard.writeText(url)` → toast "คัดลอกลิงก์แล้ว · ใช้ได้ถึง {วันที่}" (clipboard ไม่ได้ → แสดงลิงก์ให้ลากคัดลอกในกล่องเดิม).
- **หน้าสาธารณะ `/r/:token`** — `SaleReceiptViewPage` ลอก `CreditNoteViewPage` (liffApi, blob → iframe, ปุ่มดาวน์โหลด, 404 → "ไม่พบเอกสาร หรือลิงก์หมดอายุแล้ว").
- **ตั้งค่า** — `ตั้งค่า › สินค้า & การขาย › ใบเสร็จขายสด` (`/settings/products/receipts`, OWNER) การ์ด `SettingsCard` 1 ช่อง `receipt_shop_warranty_terms` (type text) placeholder = ค่าเริ่มต้น.

## ความปลอดภัย

เพิ่มรายการ `sales-receipt-public` ใน `.claude/rules/security.md` ข้างรายการ `receipts-public` (token 256-bit · 30 วัน · throttle · read-only · controller แยกเพราะ `SalesController` มี guard ระดับ class).

## เทสต์

API (jest): token service (mint/ต่ออายุ/หา · หมดอายุ · ใบยกเลิก=null) · HTML builder (หัวเรื่องตามประเภท · tender/fallback · ของแถม · เครดิตเทิร์น · ประโยคไฟแนนซ์ · ลายน้ำ · escape) · PDF service (INSTALLMENT=400 · puppeteer mock) · LINE service (3 ทาง + log) · controller (roles + public 404 ทุกเหตุ) · **อัปเดต `e2e/sales-read-scope.e2e-spec.ts`** ที่ประกอบ `SalesController` เอง (บทเรียน #1727).
Web (vitest): `SaleReceiptActions` (3 ปุ่ม + toast ตาม reason + ซ่อนตามสถานะ) · `SaleDoneDialog` · POSPage (dialog แทน toast) · `SaleReceiptViewPage` · หน้าตั้งค่า.

## นอกขอบเขต

สลิป 80mm · ใบกำกับภาษี · ใบเสนอราคา · เลขใบเสร็จแยก · retry อัตโนมัติของ LINE · LINE id ร้านบนกระดาษ (CompanyInfo ไม่มีช่อง) · A15 รายงานเคลม (รอก่อน).
