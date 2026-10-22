# ใบปะหน้าพัสดุจากใบขาย — ฉลาก 100×150 มม. หรือ A4 (A6 · 2026-10-22)

ก้อน 3 ส่วนสุดท้ายของแผนปิดช่องว่าง Tooltify → BESTCHOICE (A5 สติกเกอร์ = #1726 · A4 ยิง QR หน้าขาย = #1727 · A6 = งานนี้).
Mockup กระดาษ: canvas `TAzRReVG6MaHZZ7tfiUZZB` บอร์ด `Label.dc.html` (ขาวดำ โซนคั่นเส้นดำหนา หัวแถบดำ BESTCHOICE · ขนส่ง 4 ช่องติ๊ก ·
ผู้รับตัวใหญ่ · ของในกล่อง + QR · ผู้ส่ง). เจ้าของสั่ง "ไปต่อ" (2026-10-22) หลัง A4 เสร็จ — ถือว่าใช้กระดาษตาม mockup นี้; หน้าจอสำหรับกรอก/พิมพ์
ใช้แบบแผนเดียวกับหน้าพิมพ์สติกเกอร์ (ฟอร์มซ้าย ตัวอย่างขวา ปุ่มพิมพ์) ไม่มี mockup แยก.

## เจตนา

ร้านส่งเครื่องให้ลูกค้าทางขนส่งอยู่แล้ว (เขียนใบปะหน้าด้วยมือ) — ให้พิมพ์จากใบขายได้ในคลิกเดียว: ชื่อ/เบอร์/ที่อยู่ลูกค้าเติมให้ แก้ได้ก่อนพิมพ์ ·
เลือกขนส่งแล้วช่องถูกติ๊กบนกระดาษ · ของในกล่อง + IMEI มาจากใบขาย (พนักงานขนส่ง/คนรับตรวจได้) · QR เปิดใบขายในระบบได้จากกล้องมือถือ.

## คำตัดสินที่ผมทำแทน (เจ้าของยังไม่ได้ตอบว่ามีเครื่องพิมพ์ฉลาก 100×150 ไหม)

- รองรับ**สองรูปแบบ**เลือกได้บนหน้าพิมพ์: **ฉลาก 100×150 มม.** (`@page { size: 100mm 150mm; margin: 0 }`) และ **A4** (ฉลากขนาดจริงบนกระดาษ A4
  มีเส้นประให้ตัด — ใช้กับเครื่องพิมพ์ธรรมดาทุกเครื่อง). ค่าที่เลือกจำไว้ที่เครื่องนั้น (`localStorage` `parcel-label:format` · ค่าเริ่มต้น A4 เพราะไม่รู้ว่ามีเครื่องฉลาก)
  — ไม่ใช่การตั้งค่ากลาง เพราะเครื่องพิมพ์ต่างกันต่อสาขา/ต่อเครื่อง และไม่แตะไฟล์ตั้งค่าที่ #1726 แก้อยู่.
- **ไม่บันทึกใบปะหน้าลงฐานข้อมูล** (ไม่มีเลขพัสดุ/สถานะส่ง) — Tooltify ที่เทียบก็แค่พิมพ์ · การแก้ที่อยู่บนหน้านี้ไม่เขียนกลับไปที่ลูกค้า.
- **QR = ลิงก์เปิดใบขาย** `${origin}/sales?saleId=<id>` (ไม่ใช่เลขใบขายเปล่า ๆ) — กล้องมือถือ/เครื่องยิงเปิดหน้าใบขายได้ทันที (ต้องล็อกอิน) ·
  ข้อความใต้ QR ยังเป็นเลขใบขาย.
- ผู้ส่ง = บริษัท SHOP จาก `GET /company/public` (`nameTh` · `address` · `phone`) — สาขาไม่มีที่อยู่ในสคีมา (`Branch` มีแค่ `location`/`phone`).

## เป้าหมาย / ไม่ทำ

- ทำ: ปุ่ม "พิมพ์ใบปะหน้าพัสดุ" ในแผงรายละเอียดใบขาย (`/sales?saleId=`) → หน้า `/sales/:id/parcel-label` · เติมผู้รับจากลูกค้า แก้ได้ทุกช่อง ·
  เลือกขนส่ง / เก็บเงินปลายทาง / หมายเหตุถึงขนส่ง · ของในกล่องจากใบขาย (เครื่องหลัก + IMEI + ของแถม) · QR · ผู้ส่ง · พิมพ์ 2 รูปแบบ.
- ไม่ทำ: เลขพัสดุ/ติดตามสถานะ · เชื่อม API ขนส่ง · ใบปะหน้าจากใบจอง/สัญญา (ใบขายผ่อนในเครือมีแถว `Sale` อยู่แล้ว จึงพิมพ์ได้เหมือนกัน) ·
  แก้ที่อยู่ลูกค้าย้อนกลับ · ตั้งค่ากลาง · ฉลากหลายใบต่อครั้ง.

## API — เพิ่ม `bundleProducts` ใน `GET /sales/:id`

`SalesQueryService.findOne` คืน `bundleProducts: { id: string; name: string }[]` (จาก `product.findMany({ where: { id: { in: sale.bundleProductIds } },
select: { id, name } })` — ว่าง = `[]` ไม่ query). แถวอื่นของผลลัพธ์ไม่เปลี่ยน (`projectSaleForActor` ส่งผ่าน). ไม่มี endpoint ใหม่ —
หน้าใบปะหน้าใช้ `GET /sales/:id` (scope สาขาตาม `salesBranchWhere`) + `GET /customers/:id` (ชื่อ/เบอร์/ที่อยู่ปัจจุบัน ถอดรหัสแล้ว ·
SALES ได้เลขบัตรแบบ mask ซึ่งไม่ใช้) + `GET /company/public` (ผู้ส่ง) — ทั้งสามเปิดให้ทุก role ที่เข้าหน้า `/sales` ได้อยู่แล้ว.

## เว็บ — `apps/web/src/pages/ParcelLabelPage/`

### `parcelLabel.ts` (pure · ไม่มี DOM)

- `CARRIERS: { code: 'FLASH' | 'KERRY' | 'JT_EXPRESS' | 'THAILAND_POST'; label: string }[]` = Flash · Kerry · J&T · ไปรษณีย์ (ลำดับตาม mockup ·
  รหัสตาม enum `OnlineShippingMethod` เดิม ตัด `BRANCH_PICKUP`).
- `resolveCustomerAddress(text)` — **ที่อยู่ลูกค้าจากฟอร์มเว็บเก็บเป็น JSON** (`serializeAddress` ใน `components/ui/AddressForm.tsx` — ผู้เขียน `CustomerCreateDialog`/`CustomerEditModal`/`CreateContactModal`):
  ข้อความขึ้นต้น `{` → `deserializeAddress` แล้ว `lines = composeAddress({...addr, province:'', postalCode:''})` + จังหวัด/รหัสจากโครงสร้างตรง ๆ · ไม่ใช่ JSON (ข้อมูลเก่า/นำเข้า/บอท) → `parseThaiAddress` (ผลตรวจทานอิสระ 2026-10-22 — ฉบับแรกพิมพ์ก้อน JSON ลงฉลาก).
- `parseThaiAddress(text: string): { lines: string; province: string | null; postalCode: string | null }` — ที่อยู่ปัจจุบันของลูกค้าเป็นข้อความบรรทัดเดียว
  (`Customer.addressCurrent`): รหัสไปรษณีย์ = ตัวเลข 5 หลักตัวสุดท้ายในข้อความ · จังหวัด = ชื่อจังหวัด (จาก `THAI_ADDRESS_DATA` คอลัมน์แรก 77 ชื่อ)
  ที่ปรากฏ**ท้ายสุด**ในข้อความ **แบบมีขอบคำ**: ตัวอักษรก่อนหน้าเป็นต้นข้อความ/ช่องว่าง/`.` และ (มี `จ.`/`จังหวัด` นำหน้า — ติดกันก็ได้ — หรือเป็นคำท้ายข้อความ) — ชื่อจังหวัดที่ซ้อนในชื่อถนน/ตำบล/อำเภอ (ถ.ตากสิน · ต.สระแก้ว อ.เมือง · ศรีเชียงใหม่) ไม่ถูกเดา (`province: null` และไม่แตะ `lines`) · `กทม.`/`กรุงเทพฯ`/`กรุงเทพ` = กรุงเทพมหานคร · `lines` = ข้อความเดิมที่ถอดรหัสไปรษณีย์และ
  จังหวัด (พร้อมคำนำหน้า) ตัวที่จับได้ออก แล้วยุบช่องว่างซ้ำ · จับไม่ได้ = `null` และ `lines` คงข้อความเดิม · ว่าง = `{ lines: '', province: null, postalCode: null }`.
- `buildParcelLabelDraft({ sale, customer, company, origin }): ParcelLabelDraft` —
  ```ts
  interface ParcelLabelDraft {
    saleId: string; saleNumber: string;
    recipientName: string;            // customer.prefix + name (ไม่มี prefix = name)
    phone: string;                    // customer.phone ?? sale.customer.phone ?? ''
    addressLines: string; province: string; postalCode: string;   // จาก parseThaiAddress(customer.addressCurrent) · null → ''
    carrier: CarrierCode | null;      // เริ่ม null = พิมพ์ช่องว่างทั้ง 4 ให้ติ๊กมือ
    note: string;                     // หมายเหตุถึงขนส่ง · เริ่ม ''
    cod: string;                      // เก็บเงินปลายทาง · เริ่ม 'ไม่มี'
    item: { title: string; imei: string | null; extras: string[] };  // title = sale.product.name · imei = imeiSerial ?? serialNumber · extras = bundleProducts[].name
    sender: { name: string; address: string; phone: string };        // company.shop (ไม่มี = 'BESTCHOICE' / '' / '')
    qrValue: string;                  // `${origin}/sales?saleId=${sale.id}`
  }
  ```
- `labelStyles(format: ParcelLabelFormat): string` — CSS ของกระดาษ (หน่วย mm/pt) + `@media print` ตามรูปแบบ: `LABEL_100x150` → `@page { size: 100mm 150mm; margin: 0 }`
  · `A4` → `@page { size: A4; margin: 12mm }` และฉลากมีเส้นประรอบ (ตัดตาม) · `page-break-inside: avoid` · **หลบ chrome ของ MainLayout ตอนพิมพ์แบบหน้าสติกเกอร์**:
  `body * { visibility: hidden }` + `.parcel-print, .parcel-print * { visibility: visible }` + `.parcel-print { position: absolute; top: 0; left: 0 }` — `.wrapper` ของ MainLayout มี `padding-left` ตามเมนู (264/70px) ที่ `index.css` ไม่รีเซ็ตในโหมดพิมพ์
  ฉบับแรกจึงพิมพ์ฉลากเริ่มที่ 74 มม. และถูกตัด (ผลตรวจทานอิสระ 2026-10-22 · วัดซ้ำหลังแก้ด้วย Chromium: ทุกฉาก 1 หน้า ฉลากที่ 0,0 ขนาด 100×150).
- `PARCEL_LABEL_FORMAT_KEY = 'parcel-label:format'` · `readLabelFormat()` / `writeLabelFormat()` ห่อ `try/catch` (localStorage ใช้ไม่ได้ = A4).

### `ParcelLabelCard.tsx` — กระดาษตาม mockup (100×150 มม. · ขาวดำ)

| โซน | เนื้อหา |
|---|---|
| หัว (พื้นดำ) | `BESTCHOICE` ซ้าย · ขวา "ใบปะหน้าพัสดุ" + เลขใบขาย (mono) |
| ขนส่ง | ป้าย "ขนส่ง" + 4 ช่องติ๊ก Flash · Kerry · J&T · ไปรษณีย์ (ช่องที่เลือก = ทึบมีเครื่องหมายถูก `aria-label="<label> เลือกแล้ว"`) · วันที่พิมพ์ขวาสุด (`formatDateMedium(วันนี้)`) |
| ผู้รับ (ยืดเต็ม) | "ผู้รับ" · ชื่อใหญ่ · เบอร์ mono · ที่อยู่ (`white-space: pre-line`) · จังหวัดหนา + รหัสไปรษณีย์ mono ใหญ่ · เส้นประ + "หมายเหตุถึงขนส่ง: <note หรือ —>" |
| ของในกล่อง + QR | "ของในกล่อง" · ชื่อเครื่อง · `IMEI <imei>` (ไม่มี = ไม่แสดงบรรทัด) · `+ <extras คั่น ·>` (ไม่มี = ไม่แสดง) · เส้น + "เก็บเงินปลายทาง" / `<cod>` · QR (`QRCodeSVG` `level="M"` 22 มม. `aria-label="QR เปิดใบขาย <saleNumber>"`) + เลขใบขายใต้ QR |
| ผู้ส่ง | "ผู้ส่ง" · ชื่อบริษัท · `<ที่อยู่> · โทร <เบอร์>` · ขวา "ยิง QR ตอนส่ง/รับคืน เพื่อเปิดใบขาย" |

ตัวอักษรไทย `line-height ≥ 1.35` ทุกบรรทัด ไม่มี `position:absolute` ไม่มี `overflow:hidden` ตัดหัวสระ (บทเรียน A5) · ชื่อผู้รับ/ที่อยู่ยาว:
`overflow-wrap: anywhere` ให้ขึ้นบรรทัดใหม่ โซนผู้รับยืด (`flex: 1`) ส่วนโซนล่างคงที่ · สีเป็นดำ/ขาวตายตัว (กระดาษ — ยกเว้นกฎ token เหมือน
`StickerCard`) · `data-testid="parcel-label"`.

### `index.tsx` — หน้า `/sales/:id/parcel-label`

- โหลด `GET /sales/:id` · `GET /customers/:customerId` · `GET /company/public` (QueryBoundary) → `buildParcelLabelDraft` เมื่อข้อมูลครบ และ**ร่างใหม่เมื่อ `:id` เปลี่ยนขณะหน้ายัง mount** (back/forward — `draft.saleId !== sale.id`; ฉบับแรกค้างใบเก่า) ·
  ลูกค้า/บริษัทโหลดไม่ได้ (403/404) ยังพิมพ์ได้ — ชื่อ/เบอร์จากใบขาย ที่อยู่ว่างให้กรอก · ใบขายที่ยกเลิกแล้ว (`deletedAt`) = แถบเตือน + ไม่มีปุ่มพิมพ์.
- ฟอร์มซ้าย (`print:hidden`): ชื่อผู้รับ · เบอร์ · ที่อยู่ (textarea) · จังหวัด · รหัสไปรษณีย์ · ขนส่ง (ปุ่มเลือก 4 ตัว + "ยังไม่เลือก") · เก็บเงินปลายทาง ·
  หมายเหตุถึงขนส่ง · รูปแบบกระดาษ (`NativeSelect`: "ฉลาก 100 × 150 มม." / "A4 (ตัดตามเส้นประ)") — เปลี่ยนแล้วจำไว้ · ของในกล่อง/ผู้ส่ง/QR แสดงอย่างเดียว
  (แก้ไม่ได้ — มาจากใบขาย/ตั้งค่าบริษัท; ลิงก์ "แก้ที่ตั้งค่าบริษัท" ไม่ใส่เพราะ SALES เข้าไม่ได้).
- ขวา: ตัวอย่าง `ParcelLabelCard` ขนาดจริง + ปุ่ม "พิมพ์ใบปะหน้า" (`window.print()`) · ป้ายใต้ปุ่มบอกรูปแบบที่เลือก.
- ตอนพิมพ์: ทั้งหน้ายกเว้น `.parcel-print` ซ่อน (ใช้ `print:hidden` ของ `index.css`) · `<style>{labelStyles(format)}</style>`.
- `PageHeader` title "ใบปะหน้าพัสดุ" subtitle `ใบขาย <saleNumber> · <ชื่อลูกค้า>` · `onBack` → `/sales?saleId=<id>` · `useDocumentTitle`.
- ปุ่มเข้าหน้า: แผงรายละเอียดใบขายใน `SalesHistoryPage` — `Link` สไตล์ปุ่ม "พิมพ์ใบปะหน้าพัสดุ" ใต้บล็อกพนักงาน/สาขา (ซ่อนเมื่อใบถูกยกเลิก).
- Route ใน `App.tsx`: `/sales/:id/parcel-label` (lazy) ใน `MainLayout` ไม่จำกัด role เหมือน `/sales` (API scope สาขาเอง).

## ทดสอบ

- API jest `sales-query.service.spec.ts`: `findOne` คืน `bundleProducts` จาก `product.findMany` เฉพาะเมื่อมี id · ว่าง = `[]` และไม่ query.
- เว็บ vitest: `parcelLabel.test.ts` (`parseThaiAddress` 6 เคส: ครบ "99/1 ม.2 ต.ท่าหิน อ.เมืองลพบุรี จ.ลพบุรี 15000" → lines "99/1 ม.2 ต.ท่าหิน อ.เมืองลพบุรี" ·
  "กทม." · ไม่มีจังหวัด · ไม่มีรหัส · ว่าง · จังหวัดซ้อนในชื่ออำเภอ "เมืองลพบุรี" เลือกตัวท้าย) · `buildParcelLabelDraft` (prefix+ชื่อ · เบอร์ fallback · extras · sender fallback · qrValue) ·
  `readLabelFormat` ทนทาน) · `ParcelLabelCard.test.tsx` (ช่องติ๊กที่เลือก · IMEI/ของแถม/หมายเหตุ ว่างไม่แสดง · QR aria-label) ·
  `ParcelLabelPage.test.tsx` (mock api 3 เส้น → ฟอร์มเติมค่า · แก้ชื่อแล้วตัวอย่างเปลี่ยน · เลือกขนส่งติ๊ก · เปลี่ยนรูปแบบแล้ว localStorage เปลี่ยน · ใบยกเลิกไม่มีปุ่มพิมพ์) ·
  `SalesHistoryPage` เทสเดิมไม่แตะ (ปุ่มเป็น Link).
- เวอร์ชันเว็บ 26.10.50.

## ที่รู้ว่ายังเปิด

- ที่อยู่ลูกค้าที่พิมพ์ไม่ตรงรูปแบบ (ไม่มี "จ." / ใช้ชื่อย่อจังหวัด) → จังหวัด/รหัสว่าง ให้พนักงานกรอกเอง (ช่องอยู่ในฟอร์ม).
- ไม่เก็บประวัติว่าพิมพ์ใบปะหน้าใบขายไหนเมื่อไร — ถ้าต้องการให้เพิ่ม event/AuditLog ทีหลัง.
- หน้าจอกรอก/พิมพ์ไม่มี mockup ที่เจ้าของเคาะ (กระดาษเท่านั้น) — ถ้าเจ้าของอยากปรับหน้าจอ ทำเป็นรอบถัดไป.
