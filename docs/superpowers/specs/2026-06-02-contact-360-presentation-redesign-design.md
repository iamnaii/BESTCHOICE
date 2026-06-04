# Contact 360° — Presentation Redesign

วันที่: 2026-06-02
สถานะ: ✅ DONE — merged เข้า main 2026-06-02 (merge `e52d2154`; feat `2c2154ac` + schema `3bc5f6a6` + cleanup `41cf8b18`). 3 UX decision ที่ปล่อยให้ implementer เลือก: LINE=copy lineId, edit=ลิงก์ใน tile (ไม่มี dropdown), ไม่มี PageHeader (h1 เดียว). TradeIn tile โชว์ sellerName เพิ่มใน cleanup ภายหลัง
ส่วนหนึ่งของ: PEAK-style contact expansion. อันนี้คือ **ชั้น presentation** ที่รวบ A1 (read-through) + C (financial snapshot) ที่ implement ไปแล้ว ให้เป็น layout เดียวที่อ่านง่ายขึ้นและไม่โชว์ข้อมูลซ้ำ

## ที่มา / ปัญหา (จาก /scrutinize)

หน้า `/contacts/:id` ปัจจุบัน ([ContactDetailPage.tsx](../../apps/web/src/pages/ContactDetailPage.tsx)) แสดง identity ของ party ซ้ำกันหลายรอบในจอเดียว: สำหรับ contact ที่มี role เดียว (เช่น ผู้ขายอย่างเดียว) `เลขผู้เสียภาษี`/`เบอร์`/`ชื่อ`/`ที่อยู่` โผล่ทั้งใน section "ข้อมูลทั่วไป" ([:400-401](../../apps/web/src/pages/ContactDetailPage.tsx)) **และ** ซ้ำอีกในการ์ด role ("ข้อมูลกิจการ", [:85-97](../../apps/web/src/pages/ContactDetailPage.tsx)) แล้วยังซ้ำรอบที่ 3 บนหน้า workspace ต้นทาง (`/suppliers/:id`). หน้านี้มีคุณค่าจริงเฉพาะตอน contact มี **หลาย role** (จุดรวม 360°) แต่ layout ปัจจุบันไม่ได้ออกแบบมาเพื่อสิ่งนั้น

ปัญหารองที่ /scrutinize เจอ:
- empty-state (ไม่มี link) โชว์ name/phone ซ้ำกับหัวอีกรอบ ([:414-423](../../apps/web/src/pages/ContactDetailPage.tsx))
- `useDocumentTitle('ผู้ติดต่อ')` คงที่ ไม่ใส่ชื่อ ([:315](../../apps/web/src/pages/ContactDetailPage.tsx))
- KPI การเงินซ่อนอยู่ในการ์ดลูกค้า ไม่เด่นพอสำหรับธุรกิจผ่อน (ความเสี่ยงเงินควรเห็นทันทีที่เปิดหน้า)

## เป้าหมาย

หน้า **360° ของคนคนเดียว** ที่: (1) เปิดมาเห็นตัวตน + ความเสี่ยงเงินทันที, (2) แสดง identity ครั้งเดียว, (3) การ์ด role เป็น "จุดกระโดด" ไป workspace ไม่ใช่สำเนาข้อมูล

## ขอบเขตและหลักการ (สำคัญ — ตัดสินใจหลังเห็นข้อจำกัด)

- **frontend ล้วน** — ไม่มี backend change / schema / migration / endpoint ใหม่. ใช้ `GET /contacts/:id` + `GET /customers/:id/summary` ที่มีอยู่
- **identity = read-through + แก้ที่หน้าต้นทาง (สอดคล้อง A1)** — ปุ่ม "แก้ไข" deep-link ไป `/customers/:id`, `/suppliers/:id` ฯลฯ ซึ่งเป็นตัวจริงที่เอกสารกฎหมายอ่าน (สัญญา/ใบเสร็จอ่านที่อยู่จาก `Customer` — [contract-workflow.service.ts:176-177](../../apps/api/src/modules/contracts/contract-workflow.service.ts)). **ไม่มี PATCH /contacts/:id, ไม่ sync, ไม่แตะ encrypted PII**
- **reuse C** — customer snapshot ใช้ `GET /customers/:id/summary` เดิม (แค่ย้ายตำแหน่งจากในการ์ดมาที่ strip บนสุด)
- semantic tokens เท่านั้น (ห้าม hardcode hex/gray), Thai `leading-snug`, lazy-load + QueryBoundary เดิม

> **ความสัมพันธ์กับ spec อื่น:** A1 (read-through detail) + C (customer snapshot บน CustomerCard) + Contact Hardening (merge UI) ถูก implement ลงหน้านี้แล้ว. งานนี้ **ไม่เพิ่ม data ใหม่** — รื้อเฉพาะการจัดวาง (presentation) ของข้อมูลเดิม. ตำแหน่ง snapshot ที่ C ระบุ ("inline บน CustomerCard") ถูก **supersede** ด้วย strip บนสุดในงานนี้

## 1. Backend

ไม่มีการเปลี่ยนแปลง. ใช้ตามเดิม:
- `GET /contacts/:id` → `ContactDetail` ({ ...identity, roles, customers[], suppliers[], tradeInsAsSeller[], externalFinanceCompany[] }) — [contacts.ts:49-54](../../apps/web/src/lib/api/contacts.ts)
- `GET /customers/:id/summary` → `{ id, name, phone, activeContracts, overdueCount, totalOutstandingThb }` — [customers.ts:3-10](../../apps/web/src/lib/api/customers.ts)

## 2. Frontend — โครงหน้าใหม่ (ContactDetailPage.tsx)

แทนที่ layout 2-section เดิม ("ข้อมูลทั่วไป" + "ข้อมูลกิจการ") ด้วย 3 บล็อก:

### บล็อก 1 — IdentityHero (การ์ดเดียว แทน "ข้อมูลทั่วไป")
- **avatar** วงกลม = อักษรย่อจาก `data.name` (เช่น "นิ") พื้น `bg-primary`
- **ชื่อ** ตัวใหญ่ + role badges (reuse `ROLE_LABELS` / `ROLE_BADGE_VARIANT` ที่มีอยู่) + `ปิดใช้งาน` badge ถ้า `!isActive`
- **บรรทัดรอง:** `contactCode` · `entityType` (derive read-time เดิม [:335-337](../../apps/web/src/pages/ContactDetailPage.tsx)) · เบอร์ · taxId
- **identity grid (แสดงครั้งเดียว):** เลขผู้เสียภาษี, เบอร์โทร, อีเมล, ที่อยู่ (`data.address` ของ Contact — ไม่ใช่ PII ลูกค้า), LINE (`data.lineId` ถ้ามี), รหัส PEAK (ถ้ามี)
- **quick actions:**
  - `โทร` → `<a href="tel:{phone}">` (แสดงเมื่อมี phone)
  - `คัดลอกเบอร์` → `useCopyToClipboard()` ([hooks/useCopyToClipboard.ts](../../apps/web/src/hooks/useCopyToClipboard.ts)) + toast/`copied` state
  - `LINE` → แสดงเมื่อมี `lineId` (เปิด `https://line.me/ti/p/~{lineId}` หรือคัดลอก — implementer เลือกตาม UX ที่ปลอดภัยสุด)
  - `แก้ไข` → deep-link หน้าต้นทาง: ถ้ามี role เดียว ไปหน้านั้นตรง (`/suppliers/:id` ฯลฯ); ถ้าหลาย role แสดงเมนูเลือกปลายทาง หรือ scroll ไป tile (implementer เลือก — ดู §4 จุดต้องตัดสิน)
  - `รวมผู้ติดต่อซ้ำ` → OWNER เท่านั้น, เปิด `MergeContactsDialog` เดิม (ไม่แตะ logic)

### บล็อก 2 — Summary strip (role-aware, ซ่อนได้)
- **customer role:** ดึง `customersApi.summary(customer.id)` ต่อ customer link (เหมือน C เดิม) → รวม client-side → KPI: `ยอดค้างชำระ` (sum `totalOutstandingThb`, format ฿, เน้นแดงถ้า >0), `สัญญา active` (sum), `งวดค้าง` (sum `overdueCount`, แดงถ้า >0)
- **supplier role:** แสดงเฉพาะข้อมูลที่มีใน link อยู่แล้ว — `สถานะ VAT` (จาก `supplier.hasVat`). **ไม่ทำ** PO count / มูลค่าสินค้า (ไม่มี summary endpoint — ตาม C; ดู §5)
- **เงื่อนไขแสดง:** ถ้าไม่มี customer role และไม่มี KPI supplier ที่จะโชว์ → ซ่อน strip ทั้งแถบ
- **resilience:** summary fetch fail → ซ่อน KPI ของ customer นั้น (ไม่พังหน้า) — เหมือน C

### บล็อก 3 — Role tiles (grid, แทนการ์ด "ข้อมูลกิจการ")
การ์ดกระชับต่อ role record — **ตัดฟิลด์ที่ซ้ำกับ hero ออก** (taxId / เบอร์ / ชื่อ party):
- **ผู้ขาย:** เลขสาขา (`branchCode`), ผู้ติดต่อ (`contactName` + `contactPhone` — คนละคนกับ party, เก็บไว้), ที่อยู่ (`displayAddress`) + ลิงก์ `เปิดข้อมูลผู้ขาย / แก้ไข →` `/suppliers/:id`
- **ลูกค้า:** ถ้า KPI ขึ้น strip แล้ว การ์ดเหลือแค่ prefix+name (ถ้าต่างจาก party) + ลิงก์ `เปิดข้อมูลลูกค้า / แก้ไข →` `/customers/:id` (ถ้าไม่มีฟิลด์เฉพาะเหลือเลย อาจยุบเป็นแถวลิงก์ — implementer เลือก)
- **ไฟแนนซ์:** email, creditTermDays + ลิงก์ `/external-finance-companies/:id`
- **คนขายมือสอง:** รุ่น/ชื่อ (`sellerName`), วันที่ (`createdAt`) + ลิงก์ `/trade-in`
- reuse `Field` / `CardLink` helper เดิม

### Empty state (ไม่มี role link)
แทน block ที่โชว์ name/phone ซ้ำ → ข้อความ "ยังไม่ผูกกับลูกค้า/ผู้ขาย — เพิ่ม role ได้ที่หน้าลูกค้า/ผู้ขาย" (identity เห็นครบใน hero อยู่แล้ว ไม่ต้องซ้ำ)

### เก็บกวาดเพิ่ม
- `useDocumentTitle(data?.name ?? 'ผู้ติดต่อ')` — ใส่ชื่อจริง
- PageHeader: ใช้สำหรับ breadcrumb (`ผู้ติดต่อ / {name}`) + back เท่านั้น — ย้าย title/badge/actions ลงไปอยู่ใน IdentityHero เพื่อเลี่ยงชื่อซ้ำหัว-ฮีโร่ (implementer ตัดสินรายละเอียด ดู §4)

## 3. การทดสอบ

web (`pages/__tests__/ContactDetailPage.test.tsx` — มี 4 เคสเดิม):
- **อัปเดต** เคส "customer financial snapshot" — snapshot ย้ายจากการ์ด → **strip บนสุด**; assert KPI ขึ้นที่ strip
- **คงความหมาย** เคส supplier read-through: การ์ดผู้ขายยังมีลิงก์ `/suppliers/:id` (แต่ assert ว่า **ไม่มี** taxId/เบอร์ซ้ำในการ์ดแล้ว — ย้ายขึ้น hero)
- **คงเดิม** merge: OWNER เห็นปุ่ม + เปิด dialog; non-OWNER ไม่เห็น
- **เพิ่ม:** identity แสดงครั้งเดียว (taxId ปรากฏใน hero, ไม่ปรากฏซ้ำในการ์ด), quick action `คัดลอกเบอร์` เรียก clipboard, multi-role โชว์หลาย tile, empty-state ไม่โชว์ name/phone ซ้ำ
- ไม่มี backend test (ไม่แตะ backend)
- รัน E2E ที่แตะหน้านี้ให้เขียว (`e2e/finance-receivable-contact.spec.ts`)

## 4. จุดต้องตัดสินตอน implement (ไม่บล็อก spec)
- **PageHeader vs hero**: PageHeader ไม่มี avatar/hero ([PageHeader.tsx](../../apps/web/src/components/ui/PageHeader.tsx)) → hero เป็นการ์ด custom ใต้ PageHeader. ต้องเลี่ยงชื่อซ้ำ (PageHeader ใช้ breadcrumb แทน title ใหญ่)
- **ปุ่ม "แก้ไข" เมื่อมีหลาย role**: เมนู dropdown เลือกปลายทาง vs scroll ไป tile — เลือกอันที่ click น้อยสุด
- **LINE action**: เปิด deep link vs คัดลอก lineId — เลือกตามความปลอดภัย/ใช้งานจริง

## 5. ไม่ทำ (YAGNI / นอก scope)
- PATCH /contacts/:id / sync identity / แตะ encrypted PII (ขัด A1 — ตัดสินใจแล้วไม่ทำ)
- supplier summary endpoint (PO count / มูลค่าสินค้ารวม) — ต้องมี backend ใหม่ก่อน, แยกพิจารณา (ตาม C)
- timeline กิจกรรมรวมข้าม module / กราฟ / AR aging / lifetime revenue
- เพิ่ม column บน Contact / migration / backfill
