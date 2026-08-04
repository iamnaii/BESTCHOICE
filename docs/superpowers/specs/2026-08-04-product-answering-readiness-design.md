# Product-Answering Readiness Wave — Design

**วันที่:** 2026-08-04
**สถานะ:** อนุมัติแล้ว (owner) — ดีไซน์ 6 batch ผ่านการยืนยันทีละข้อ
**เป้าหมาย:** ให้แอดมิน + บอท AI ตอบคำถามลูกค้าเรื่องสินค้า (ราคา/สภาพ/สต็อก/ผ่อน) ได้ถูกต้อง รวดเร็ว ทั้งทางแชท (LINE/FB/เว็บแชท) และหน้าเว็บ www.bestchoicephone.com — จากข้อมูลชุดเดียวกัน
**ฐานข้อมูลอ้างอิง:** audit 7-agent 2026-08-04 (main `673e5960c`) — ทุก claim หลักผ่านการ verify กับโค้ดจริงโดย critic agent

## 0. ข้อเท็จจริงที่ audit ยืนยัน (ฐานของ design นี้)

- **ราคาแตก 3 ระบบที่ไม่ sync กัน:**
  - หน้า admin แก้ตาราง `ProductPrice` (`prices[]` label rows) ผ่าน `POST/PATCH/DELETE /products/:id/prices` — เว็บไม่อ่าน
  - เว็บลูกค้าอ่านคอลัมน์ `Product.cashPrice`/`installmentPrice` **เท่านั้น** (`shop-catalog.service.ts:104-264`, ไม่มี fallback ไป prices[]) แต่คอลัมน์นี้ **ไม่มี writer ใน production code เลย** — `CreateProductDto`/`UpdateProductDto` ไม่มีฟิลด์, มีแค่ seed + `apps/api/scripts/backfill-product-prices.ts` (one-off)
  - บอทร้านอ่าน default `ProductPrice` row (`sales-bot/tools/search-products.tool.ts:47-74`) → `priceMissing` → handoff เมื่อไม่มี row
  - `PricingTemplate` (ตารางราคากลาง — มีข้อมูล ราคาสด/ผ่อน BC/ผ่อนไฟแนนซ์/ดาวน์+งวด 2 เรต) มีผู้อ่านเดียวคือ sticker (`stickers.service.ts:168`)
- **`conditionGrade` มี writer เดียวคือรับเครื่องยึด** (`repossessions.service.ts:396`); QC `completeInspection()` คำนวณ `overallGrade` แต่เขียนกลับ Product แค่ `{status:'QC_PENDING'}` (`inspections.service.ts:184-190`); publish gate บังคับมือสองต้องมีเกรด (`products-online-listing.service.ts:48`) → มือสองจากรับซื้อ/เทิร์น**ขึ้นเว็บไม่ได้เลย**
- **`isOnlineVisible` default `true`** (schema ~1703) + invariant รูป/เกรดเช็คเฉพาะตอนกด toggle ใน tab ขึ้นเว็บ → เครื่อง Apple ที่รับเข้า IN_STOCK โผล่เว็บทันทีแบบไม่มีรูป/ราคา ("สอบถามราคา"); checklist `missingReasons` (`OnlineListingPanel.tsx:139-144`) เช็คแค่รูป+เกรด **ไม่เช็คราคา**
- `shopBaseWhere` = `deletedAt:null + isOnlineVisible + status:'IN_STOCK' + brand==='Apple'` (case-sensitive const) + category PHONE_NEW/PHONE_USED (`shop-catalog.service.ts:51-63`) — brand พิมพ์เพี้ยนหายเงียบ ไม่มีเตือนฝั่ง admin
- **หน้า admin `/products/:id`** ([ProductDetailPage](../../../apps/web/src/pages/ProductDetailPage/index.tsx)): มีส่วนราคา (ทุน/ขาย/กำไร + ตาราง prices[]) อยู่แล้ว แต่ (a) แก้แล้วเว็บไม่เปลี่ยน (คนละแหล่ง), (b) ทุน+กำไรโชว์ SALES (`ProductInfo.tsx:125-143`, route `App.tsx:473-478`), (c) ไม่มี copy summary/ลิงก์เว็บ/QR, (d) `InstallmentCalculatorCard.tsx:40` ลิงก์ตาย `/products/:id/edit` (route ไม่มี), (e) API เปิดให้ FM/ACCOUNTANT (`products.controller.ts:143-147`) แต่ frontend route ไม่ให้, (f) `shopWarrantyDays`/`checklistResults` ไม่แสดง-แก้ไม่ได้ทั้งที่ API ส่งมาครบ
- **Inbox:** endpoint product search + ส่งการ์ดสินค้า **มีอยู่แล้วแต่ orphan 100%** (`chat-commerce.controller.ts` — ไม่มี frontend caller); `sendProductCard` (`chat-commerce.service.ts:228-285`) บันทึกผ่าน `roomManager.saveMessage` เท่านั้น **ไม่ส่งถึง LINE/FB** (ทางส่งจริงคือ `messageRouter.sendStaffMessage` — `staff-chat.controller.ts:162`) + hardcode "ผ่อนได้สูงสุด 12 งวด" + fallback ไป prices[0]; canned responses มี 7 ตัวแปร (ลูกค้า/สัญญา) **ไม่มีตัวแปรสินค้า**; `ProductContextCard` read-only + สต็อก hardcode 1 (`product-detect.service.ts:128`) + regex อังกฤษล้วน; "สร้างสัญญา" ไม่ส่ง product context (`SessionActions.tsx:161`, endpoint contract-prefill orphan); mock AI suggest แต่งราคามั่วเมื่อไม่มี `ANTHROPIC_API_KEY` (`staff-chat.controller.ts:488-494`)
- **บอทร้าน** (sales-bot บน LINE_SHOP/FACEBOOK/WEB): มี function-calling จริง (search/calc/rates/promotions/lead/handoff) + grounding guard กันมั่วราคา แต่ `search_products` select แค่ id/name/brand/model/grade/price (ไม่มี แบต/สี/ความจุ/ประกัน/สาขา/รูป), ค้นแค่ name/brand/model (พิมพ์ "iPhone 12 128GB"/สี = ไม่เจอ), ไม่ group รายรุ่น, กรอง `status='IN_STOCK'` (เครื่องติดจอง = "ไม่มีของ"); reply hardcode `type:'TEXT'` (`message-router.service.ts:187`); `calculate_installment` ไม่รวม VAT + downPct hardcode 20%; `list_promotions` ไม่กรอง productId; KB จำกัด LINE_FINANCE; kill switch หลายชั้นไม่มีหน้าสถานะ (รวม `FB_BOT_DISABLED` ที่ปิดโดยตั้งใจ)
- **บอทน้องเบส** (chatbot-finance, LINE_FINANCE): 7 tools สัญญา/จ่ายเงินล้วน **ไม่มี product tools** + persona ห้ามพูดราคา → ลูกค้าผ่อนถามเครื่องใหม่ = handoff เสมอ
- **web-shop:** OG แบบ static ทั้งเว็บ **ไม่มี og:image เลย** + SPA ไม่มี prerender → แปะลิงก์ใน FB/LINE ได้การ์ดเปล่า; ไม่มีปุ่มแชร์/copy; `ProductDetailPage.tsx:183-185` รูปไม่เปลี่ยนตาม unit ที่เลือก (API ส่ง gallery ต่อ unit มาแล้ว); URL เป็น unit id (ขายไปแล้วลิงก์ stale ได้ — head query ไม่กรอง status, `shop-catalog.service.ts:225-233`); LINE prefill แค่ "สนใจ <ชื่อ>" ไม่มี URL/unit; ไม่มี Messenger; ค้นหาไทย/คำย่อไม่เจอ; ไม่แสดงสาขา/อุปกรณ์/ตำหนิ; `monthlyPaymentFrom` ใช้ rate ปลอม hardcode (`shop-catalog.service.ts:48-50`); cashPrice null → 0 ปน tier range (:254)
- **จองจากเว็บ:** hold 15 นาทีไม่ flip `Product.status`, ไม่มีหน้า admin ดู `ProductReservation`, `preemptByInStoreSale()` ไม่มี caller, `placeOrder` ไม่เช็ค status ซ้ำ → หน้าร้านขายชนกับลูกค้าเว็บที่กำลังจ่ายได้; จอง/ออเดอร์ใหม่**ไม่แจ้งเตือน staff ใดๆ**
- **[DEMO] 7 เครื่องอยู่บน prod** และเป็นกลุ่มเดียวที่ราคา/เกรดครบ — catalog + บอทไม่มี DEMO filter → บอท quote เครื่องปลอมเป็นของจริงได้
- Migration ล่าสุด = `20260981000000` → **เลขว่างถัดไป `20260982000000+`**; QA UI ต้องใช้ local env (prod ปฏิเสธ seed accounts)

## 1. การตัดสินใจของ owner (ยืนยันแล้ว 2026-08-04)

1. **แหล่งราคาจริง = ราคาต่อเครื่อง** (`Product.cashPrice`/`installmentPrice`) — ตารางราคากลางเป็น**ค่าตั้งต้น** autofill ตอนรับเครื่องเข้า; `prices[]` เลิกใช้แบบค่อยเป็นค่อยไป
2. **บอทตอบสินค้าได้ทุกช่อง + น้องเบสด้วย** (ใช้ product tools ชุดเดียวกัน; FB ยังปิดตาม kill switch จนกว่า owner เปิดเอง)
3. **ขึ้นเว็บอัตโนมัติเมื่อข้อมูลครบ** (รูป+ราคา+เกรดมือสอง) — ปิดรายเครื่องได้; ไม่ต้องกดขึ้นทีละเครื่อง
4. **ซ่อนราคาทุน+กำไรจาก SALES** (เห็นเฉพาะ OWNER/BRANCH_MANAGER)
5. **ลำดับงาน = Data-first**: B0 ฐานข้อมูล → B1 admin → B2 inbox → B3 บอท → B4 เว็บ → B5 จอง/แจ้งเตือน — PR ละ batch ตามแพทเทิร์น inbox overhaul / purchasing v2

## 2. B0 — ฐานข้อมูล: ราคาเดียว + ฟิลด์ที่ขาด + เงื่อนไขขึ้นเว็บ (apps/api + prisma)

### 2.1 ราคา single source
- เพิ่ม `cashPrice`, `installmentPrice` ใน `UpdateProductDto`/`CreateProductDto` (role gate OWNER/BM ที่ controller เหมือน pricing เดิม)
- **Write-through ทางเดียว**: แก้คอลัมน์ → sync ลง default `ProductPrice` row (label "ราคาเงินสด") เพื่อ legacy readers (สัญญา/POS) ใช้ต่อได้ระหว่างเปลี่ยนผ่าน; ห้าม sync ย้อนกลับ
- `getDisplayPrices.ts` (web) ลดเหลืออ่านคอลัมน์อย่างเดียว
- **Autofill ตอนรับเข้า**: จุดสร้าง Product ทุกทาง (products.service.create, po-receiving `runReceiveInTx`, direct-receive, trade-in accept, buyback) — ถ้า `cashPrice` ว่าง → lookup `PricingTemplate` ตาม brand+model+storage+category แล้วเติม `cashPrice`+`installmentPrice` (ไม่ block ถ้า template ไม่มี)
- **Backfill prod**: รัน `scripts/backfill-product-prices.ts` (มีอยู่แล้ว — review ก่อนรัน) เป็น ops step ตอน deploy B0
- ตาราง prices[] ในหน้า admin เปลี่ยนเป็น**อ่านอย่างเดียว** (ลบปุ่ม add/edit/delete ใน B1)

### 2.2 เกรด + ฟิลด์ใหม่
- QC `completeInspection()` เขียน `overallGrade` (เคารพ `gradeOverride`) ลง `Product.conditionGrade` ในลูป update เดิม
- `UpdateProductDto` + EditProductModal (B1) เปิดแก้ `conditionGrade` (OWNER/BM)
- **Migration `20260982000000`**: เพิ่มบน Product — `accessoriesIncluded Json?` (checklist อุปกรณ์ที่ให้: สายชาร์จ/อะแดปเตอร์/เคส/ฟิล์ม/อื่นๆ+ข้อความ), `cosmeticNotes String?` (ตำหนิ/รอย ≤500 chars); เปิดแก้ `shopWarrantyDays` ผ่าน DTO (คอลัมน์มีแล้ว)
- ฟิลด์ทั้งหมด expose ใน shop API (`ProductUnit`) + bot tools (B3)

### 2.3 ขึ้นเว็บอัตโนมัติเมื่อครบ
- **Readiness util กลาง** (`apps/api/src/modules/products/product-readiness.util.ts`): เครื่องพร้อมขึ้นเว็บ ⇔ `IN_STOCK` + `gallery ≥ 1` + `cashPrice > 0` + (PHONE_USED → `conditionGrade` set) + brand ตรง shop gate + category PHONE_NEW/PHONE_USED
- `shopBaseWhere` เพิ่มเงื่อนไข readiness (query-side): `cashPrice not null`, `gallery not empty`, มือสองต้องมีเกรด — **ของไม่ครบไม่โผล่เว็บโดยอัตโนมัติ ไม่ต้อง migrate ข้อมูลเดิม**
- Semantics `isOnlineVisible` เปลี่ยนเป็น "**ไม่ได้ถูกปิดจากเว็บ**" (default true คงเดิม = ครบเมื่อไหร่ขึ้นเมื่อนั้น): ปลด invariant เดิมใน `products-online-listing.service.ts` (toggle กลายเป็นสวิตช์ปิดล้วนๆ กดได้เสมอ)
- Endpoint `GET /products/:id/readiness` คืน checklist ต่อข้อ (พร้อม/ขาดอะไร + เตือน brand/category ไม่เข้า shop gate) — ใช้ทั้งหน้า admin (B1) และอนาคต list badge
- แก้ null-price coercion: unit ที่หลุดมาโดย cashPrice null ห้ามกลายเป็น ฿0 ใน tier range (`shop-catalog.service.ts:254`)

### 2.4 util แปลงคำค้นไทย (ใช้ร่วม 3 ระบบ)
- `apps/api/src/common/utils/device-query-normalize.util.ts`: แปลง utterance → {brand, model, storage, color} tokens — รองรับ "ไอโฟน", เลขไทย/คำอ่าน ("โปรแม็กซ์", "พลัส"), คำย่อ ("15pm", "ip15", "promax"), ความจุ ("256", "1TB"), สีไทย; มี unit tests ครอบ alias หลัก
- ผู้ใช้: shop search (B4), bot `search_products` (B3), inbox `ProductDetectService` (B2)

## 3. B1 — หน้าสินค้า admin (apps/web — ProductDetailPage)

- **ส่วนราคาใหม่**: ช่อง ราคาเงินสด/ราคาผ่อน (เขียนคอลัมน์ผ่าน DTO ใหม่) + แสดงที่มา autofill ("จากตารางราคากลาง"); ตาราง prices[] เดิม read-only (collapsed "ราคาแบบเก่า"); **ราคาทุน+กำไร render เฉพาะ OWNER/BM** (SALES ไม่เห็นแม้ใน DOM)
- **ปุ่ม "คัดลอกสรุปส่งลูกค้า"**: ข้อความไทยพร้อมส่ง — รุ่น/ความจุ/สี/แบต%/เกรด/ประกันร้าน/อุปกรณ์/ตำหนิ(ถ้ามี)/ราคาสด/ผ่อนเริ่มต้น (จาก BC calculator เรตจริง)/สาขา — ใช้ `useCopyToClipboard` ที่มีอยู่
- **ปุ่ม "คัดลอกลิงก์หน้าเว็บ"** + เปิดดูหน้าเว็บจริง (URL รุ่นจาก B4; ก่อน B4 ใช้ /products/:id เดิม) — disabled พร้อม tooltip เมื่อเครื่องยังไม่ ready
- **การ์ด "ความพร้อมขึ้นเว็บ"** ใต้ header (กิน `GET /products/:id/readiness`): เขียว/แดงรายข้อ รูป/ราคา/เกรด + เตือน brand ไม่ตรง; แทน missingReasons เดิมใน tab ขึ้นเว็บด้วย component เดียวกัน
- **แสดงข้อมูลที่ขาด**: ประกันร้าน (แก้ได้), อุปกรณ์ที่ให้ (checklist แก้ได้), ตำหนิ (แก้ได้), ผลตรวจ QC รายข้อ (render `checklistResults` + ลิงก์ไป inspection), เกรด (แก้ได้ OWNER/BM)
- **การ์ด "เครื่องอื่นรุ่นเดียวกัน"**: query สต็อกรุ่น+ความจุเดียวกันทุกสาขา (สถานะ IN_STOCK/RESERVED + สาขา + ราคา + แบต) — ตอบ "มีของไหม สาขาไหนมี สีอื่นมีไหม" ได้ในหน้าเดียว
- **การ์ดโปรโมชั่น**: โปรที่ active และเข้าเงื่อนไขกับเครื่องนี้ (อ่านจาก promotions module; ใช้ productId filter ที่ B3 implement — ก่อนหน้านั้นแสดงโปร active ทั้งหมดพร้อม label)
- แก้ปลีกย่อย: ลิงก์ "ไปแก้ราคา" เปิด modal แทน route ตาย; เพิ่ม FINANCE_MANAGER/ACCOUNTANT ใน route (read-only ตาม API)

## 4. B2 — Inbox: ตอบแชทโดยไม่สลับแท็บ (apps/web + apps/api staff-chat)

- **Product picker ใน composer**: ปุ่มในแถบ composer → modal ค้นสต็อก (server search ผ่าน `GET /staff-chat/products/search` — ขยาย select: รูปแรก/ราคา/ผ่อน/แบต/เกรด/สาขา/readiness) → เลือกแล้วทำได้ 3 อย่าง: (a) แทรกข้อความสรุป (เหมือนปุ่ม copy ใน B1) ลง composer, (b) ส่งการ์ดสินค้า (รูป+สรุป+ลิงก์เว็บ), (c) เลือกส่งรูปเครื่องจริง (multi-select จาก photos/gallery ของเครื่อง) เป็นข้อความรูป
- **แก้ `sendProductCard`**: เปลี่ยนไปส่งผ่าน `messageRouter.sendStaffMessage` path (ถึง LINE/FB จริง + optimistic/idempotency กติกาเดิมของ send), เนื้อการ์ดใช้ราคาคอลัมน์ + งวดจาก InterestConfig จริง (ลบ "ผ่อนได้สูงสุด 12 งวด" + prices[0] fallback), แนบรูปแรก + URL เว็บ
- **ผูกสินค้ากับห้อง**: migration `20260983000000` เพิ่ม `ChatRoom.attachedProductId String?` — set ได้จาก picker/ProductContextCard; ใช้เป็นบริบทของตัวแปร canned + contract prefill
- **Canned responses ตัวแปรสินค้า**: `{productName} {productPrice} {productInstallment} {productStock} {productWarranty}` resolve จากสินค้าที่ผูกกับห้อง (ไม่มีสินค้าผูก → แทนด้วย "-" เหมือน convention เดิม); template editor เพิ่ม palette ตัวแปรทั้งหมด (รวม 7 ตัวเดิม) กดแทรกได้
- **ProductContextCard อัปเกรด**: กดเปิด /products/:id, ปุ่ม "ส่งให้ลูกค้า" (การ์ด/รูป), ปุ่ม "ผูกกับห้องนี้", แสดงรูป + จำนวนเครื่องจริงของรุ่น (เลิก hardcode 1), detection ใช้ util จาก B0 (จับไทย/ความจุ/สี)
- **สร้างสัญญาจากแชท**: `SessionActions` เรียก `GET /staff-chat/rooms/:id/contract-prefill` แล้วส่ง suggestedProducts + attachedProduct ไป query ของ /contracts/create
- **Mock AI suggest**: จำกัดเฉพาะ `NODE_ENV !== 'production'` + ติด label "[MOCK]" ในข้อความ

## 5. B3 — บอท: ตอบได้เท่าแอดมิน (apps/api sales-bot + chatbot-finance)

- **`search_products` ยกเครื่อง**: (a) parse query ด้วย util B0 → where ตาม brand/model/storage/color, (b) select เพิ่ม storage/color/batteryHealth/conditionGrade/shopWarrantyDays/accessoriesIncluded/cosmeticNotes/branch/gallery แรก, (c) **group ตามรุ่น+ความจุ**: คืน per-group count + ช่วงราคา + รายเครื่อง (สี/แบต/เกรด/สาขา/สถานะ), (d) รวมเครื่อง `RESERVED` ติด flag "ติดจองชั่วคราว" (แยกจากไม่มีของ), (e) ราคาอ่านคอลัมน์ (เลิกอ่าน ProductPrice), (f) readiness filter เดียวกับเว็บ (ไม่โชว์เครื่องข้อมูลไม่ครบ)
- **ส่งรูป/การ์ด/ลิงก์**: message router รองรับ reply หลายชิ้นจาก AI turn — เมื่อ tool result มีเครื่องที่เจาะจง (≤2 เครื่อง) แนบรูปแรก (IMAGE ผ่าน channel adapter ที่รองรับอยู่แล้ว) + URL เว็บต่อท้ายข้อความ; grounding guard เดิมคงไว้
- **`calculate_installment`**: เปลี่ยนไปใช้ตรรกะเดียวกับ `installment-preview.service` (รวม VAT/fee — เลขเดียวกับสัญญาจริง); downPct options มาจาก InterestConfig แทน hardcode 20%
- **`list_promotions`**: implement productId filter (parse `conditions.productIds/categories` จริง)
- **น้องเบส (FINANCE_TOOLS)**: เพิ่ม `search_products` + `get_installment_rates` + ปรับ persona อนุญาต quote **เฉพาะตัวเลขจาก tool** (คงห้ามสัญญาราคานอก tool data + จบด้วยชวนคุยต่อกับ SALES/ทำ trade-in)
- **KB ข้ามช่อง**: `ChatKnowledgeBase` เพิ่ม channel scope (migration `20260984000000` — เพิ่มคอลัมน์ channel/nullable = ทุกช่อง) + เปิด `search_knowledge_base` ให้บอทร้าน; หน้า admin knowledge เพิ่มตัวเลือกช่อง
- **หน้า AI Settings แสดงสถานะจริง**: env/flag ทุกตัวที่ทำให้บอทเงียบ (autoEnabled, autoChannels, central branch, `FB_BOT_DISABLED`, confidence threshold, 24h cap) เป็น status card อ่านอย่างเดียว
- **DEMO guard**: catalog + bot filter `NOT name startsWith '[DEMO]'` เมื่อ `NODE_ENV=production` (กันเหตุบอทขายเครื่อง demo ระหว่างยังไม่ได้ล้าง)
- แก้ `ProductDetectService` เลิกคิดค่างวดเองแบบผิด (#1335 class) — เรียก util เดียวกับ calculate_installment

## 6. B4 — Website (apps/web-shop + apps/api shop)

- **OG per-product + JSON-LD**: firebase.json เพิ่ม rewrite `/products/**` (และ `/p/**`) → Cloud Run api ก่อน catch-all; endpoint ใหม่ใน shop module เสิร์ฟ SPA shell (index.html) ที่ inject `og:title/og:description/og:image/og:url` + `product:price:amount` + JSON-LD `Product+Offer` (ราคา/availability/condition) ต่อสินค้า — ทุก UA (มนุษย์ได้ SPA ปกติ เพราะ shell เดียวกัน)
- **Permalink ระดับรุ่น**: route ใหม่ `/p/:slug` (เช่น `iphone-12-64gb`) แสดงหน้ารวมรุ่น (unit picker เลือกเครื่อง); `/products/:id` เดิมยังใช้ได้ — ถ้า unit ขายแล้ว redirect ไป `/p/:slug` ของรุ่นนั้น (ลิงก์ที่แอดมินเคยส่งไม่ตาย); ปุ่ม copy ใน B1/B2 ใช้ `/p/:slug?unit=:id`
- **ปุ่มแชร์/คัดลอกลิงก์** บนหน้าสินค้า (navigator.share + clipboard fallback)
- **รูปตามเครื่อง**: เลือก unit ใน UnitPicker → gallery/360 สลับเป็นของเครื่องนั้น (ข้อมูลมีแล้วใน API แก้ render จุดเดียว)
- **แสดงเพิ่มต่อเครื่อง**: สาขาที่เครื่องอยู่ (expose branch ใน `ProductUnit`), อุปกรณ์ที่ให้, ตำหนิ/condition notes + ไฮไลต์ผลตรวจ QC ("ผ่าน 30/30 จุด"), ประกันตามเครื่องจริง (เลิก hardcode "30 วัน" ใน meta copy)
- **ปุ่มแชทแนบบริบท**: LINE prefill = "สนใจ <ชื่อรุ่น> (<เลขเครื่อง 4 ตัวท้าย>) <URL>" + เพิ่มปุ่ม Facebook `m.me/<page>?ref=<unitId>` (ref โผล่ใน webhook → inbox/บอท resolve เครื่องอัตโนมัติ)
- **ค้นหาไทย/คำย่อ**: `listGroupedByModel` search ผ่าน util B0
- **แก้ค่างวดหน้ารายการ**: `monthlyPaymentFrom` คิดจาก InterestConfig จริง (util เดียวกับ preview) แทน 0.0099 hardcode
- SEO เก็บตก: sitemap เพิ่ม `/p/:slug` รายรุ่น (generate จาก catalog)

## 7. B5 — จองจากเว็บ ↔ ทีมขาย (apps/api + apps/web)

- **Admin เห็น hold**: endpoint list `ProductReservation` active (ใคร/ช่องทาง/หมดเมื่อไหร่) + ปุ่มปลด hold (OWNER/BM); แสดงบนหน้าสินค้า admin (B1 การ์ดสถานะ) + badge ในรายการสินค้า
- **กันขายชน**: `placeOrder` เช็ค `product.status === 'IN_STOCK'` ซ้ำในทรานแซกชันก่อนตัดเงิน; ต่อ `preemptByInStoreSale()` เข้ากับ flow ขายหน้าร้าน/สร้างสัญญา (แจ้งลูกค้าเว็บเมื่อโดนตัดหน้า)
- **แจ้งเตือน staff**: จองใหม่/ออเดอร์จ่ายแล้ว → notification ในระบบ (reuse notification infra ของ inbox) + badge ที่ /online-orders
- ลบ dead copy "แจ้งเตือนเมื่อมาใหม่" (เปลี่ยนเป็นปุ่มแชท LINE) — ระบบ back-in-stock จริงอยู่นอกขอบเขต

## 8. นอกขอบเขต (ตัดออก — ตกลงแล้ว)

- ตาราง spec รายรุ่น (จอ/กล้อง/ชิป) + คำอธิบายรุ่นแชร์ข้าม unit (model-catalog entity) — ค่อยทำเมื่อ SKU โต
- วิดีโอสินค้า, น้ำหนัก/ขนาดสำหรับค่าส่ง
- บอทกดจอง/hold เครื่องแทนลูกค้า
- ระบบแจ้งเตือนของเข้า (back-in-stock)
- แก้ historical data (prod เป็น testing-phase — forward-fix only)

## 9. งานฝั่ง owner (ไม่ใช่โค้ด — ทำคู่กับ deploy)

1. กรอก **ตารางราคากลาง** ให้ครบทุกรุ่นที่ขาย (autofill B0 + บอท B3 พึ่งตารางนี้)
2. **ล้าง [DEMO]** ก่อนเปิดจริง: `CLEAN=1 bash scripts/seed-demo-products-prod.sh` (B3 มี guard กันไว้ชั้นหนึ่งแล้ว)
3. เปิด **FB bot** (`FB_BOT_DISABLED`) เมื่อพร้อมให้บอทตอบเพจ
4. รีวิวราคาที่ backfill จาก prices[] เดิม (B0 ops) ว่าตรงราคาขายจริง

## 10. หลักปฏิบัติทุก batch

- **Red line**: ห้ามแตะ accounting/finance JE paths; contract flow ต้อง behavior-preserving (BC calculator/การสร้างสัญญาเลขเดิมทุกบาท)
- ทดสอบ: jest ต่อ module (money-math ใช้ mock-based golden ตาม convention journal module); ทุก batch `tsc` 0 + eslint 0; browser QA บน **local env** (prod ปฏิเสธ seed accounts)
- Migration กันชนเลข: B0=`20260982000000`, B2=`20260983000000`, B3=`20260984000000` — เช็ค max จริงอีกครั้งก่อนสร้างทุกครั้ง
- Deploy ทีละ batch (แพทเทิร์น one-deploy-per-batch เดิม); CI gate "Lint & Test" เขียว + ต้องการ code-owner review 1 คน (owner กด)
