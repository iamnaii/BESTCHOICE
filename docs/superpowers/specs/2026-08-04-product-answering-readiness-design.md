# Product-Answering Readiness Wave — Design

**วันที่:** 2026-08-04
**สถานะ:** อนุมัติแล้ว (owner) + **แก้ตามผล scrutinize** (7-agent adversarial trace เทียบ main `673e5960c` — 5 BLOCKER + ~20 MAJOR แก้ในดีไซน์นี้แล้ว; scope ตัด 4 จุดตามข้อเสนอ skeptic)
**เป้าหมาย:** ให้แอดมิน + บอท AI ตอบคำถามลูกค้าเรื่องสินค้า (ราคา/สภาพ/สต็อก/ผ่อน) ได้ถูกต้อง รวดเร็ว ทั้งทางแชท (LINE/FB/เว็บแชท) และหน้าเว็บ www.bestchoicephone.com — จากข้อมูลชุดเดียวกัน
**ฐานข้อมูลอ้างอิง:** audit 7-agent 2026-08-04 + scrutiny 7-agent (ทุก claim หลัก verify กับโค้ดจริง; จุดที่ audit แรกพลาดถูกแก้ในเอกสารนี้แล้ว)

## 0. ข้อเท็จจริงที่ยืนยันแล้ว (ฐานของ design — รวมผล scrutiny)

### ราคา — แตก 3 ระบบ และผู้อ่านแต่ละตัวคาดหวังคนละรูปแบบ
- เว็บลูกค้าอ่านคอลัมน์ `Product.cashPrice`/`installmentPrice` เท่านั้น (`shop-catalog.service.ts:91-93,116,254`) และคอลัมน์นี้**ไม่มี writer ใน production** (DTO ไม่มีฟิลด์; มีแค่ seed + `apps/api/scripts/backfill-product-prices.ts`) — แต่ `installment-preview.service.ts:40-43` มี fallback ไป prices[] labels อยู่
- **ผู้อ่าน `prices[]` ที่ยัง load-bearing:** POS (`POSPage/index.tsx:135-142` default row), **เครื่องคิดเงินสัญญา** (`useContractCalculation.ts:37-43` — ลำดับ: label==='ราคาผ่อน BESTCHOICE' → startsWith('ราคาผ่อน') → isDefault → prices[0]), stock-overview margin (`stock-overview.service.ts:44,105`), บอท (`search-products.tool.ts:47-50` + `calculate-installment.tool.ts:33-36` — `where:{isDefault:true} take:1` **ไม่มี orderBy**)
- **default rows ใน prod มี label ปนกันหลายแบบ**: 'ราคาขาย' (PO receive `po-receiving.service.ts:198-206`), 'ราคาขายต่อ (Refurbished)' (repossession refurb `repossessions.service.ts:698-725`), 'ราคาผ่อน' (หน้า create) — backfill script เดิม match แค่ 'ราคาเงินสด/ราคาผ่อน*' จะ**ข้ามของจริงเกือบหมด**
- `PricingTemplate` มีผู้อ่าน 2 ตัว: sticker (`stickers.service.ts:142-168`) + บอท `get-installment-rates.tool.ts:106-160`; unique key = `[brand, model, storage, category, hasWarranty]` (schema:1795) และ **`installmentBestchoicePrice` ความหมายกำกวม** — sticker/บอทตีความเป็น "ต่อเดือน" (`StickerPrintPage.tsx:152` render 'X ฿ × N ด.') แต่ import help ฝั่ง admin สื่อว่าเป็นราคารวม → **ต้อง settle ก่อนเขียน autofill**

### เกรด/ขึ้นเว็บ
- **`Product.conditionGrade` ไม่มี production writer เลย** (แย่กว่าที่ audit แรกบอก — `repossessions.service.ts:396` เขียนลง Repossession row ไม่ใช่ Product); QC `completeInspection` เขียนแค่ `{status:'QC_PENDING'}` (`inspections.service.ts:184-190`); `overrideGrade` (:195-201) **เรียกได้หลัง complete เท่านั้น** → ตอน complete ค่า gradeOverride เป็น null เสมอ; publish gate บังคับเกรดที่ `products-online-listing.service.ts:48`
- `isOnlineVisible` default true (schema:1703); ผู้อ่านอื่นนอก catalog: บอท (`search-products.tool.ts:32`) และ **`shop-reservation.service.ts:23` reserve()** — จองได้แม้เครื่องไม่มีราคา
- `shopBaseWhere` (:51-63) ใช้ Prisma ล้วนไม่มี raw SQL — เพิ่มเงื่อนไขได้ แต่ `getProductDetail` **inline where เอง 2 จุด** (:226-232, :238-246) และ `listGroupedByModel` **assign `where.OR`** สำหรับ search (:96-99) → readiness fragment ต้อง AND-composable
- null cashPrice → 0 มี **4 จุด**: `shop-catalog.service.ts:254`, `shop-cart.service.ts:39`, `shop-installment-apply.service.ts:44-47` (คำนวณแผนผ่อนบนราคา 0!), `web-shop ProductDetailPage.tsx:146,177`

### Admin / Inbox
- ทุน+กำไรโชว์ SALES ใน UI (`ProductInfo.tsx:120-159`) **และ API ก็ส่ง costPrice ให้ SALES** ทั้ง findOne/findAll/stock (`products.controller.ts:143-147` + service include ไม่มี select) — precedent การ strip รายฟิลด์ตาม role มีแล้วที่ `staff-chat.controller.ts:126-135` (SALES → nationalId:null)
- inbox: `sendStaffMessage` (`message-router.service.ts:514-586`) **ส่งได้แค่ TEXT** (type hardcode); ทางส่งภาพเดียวที่มีคือ `sendStaffOutbound` (:609-670) ซึ่ง**ไม่มี clientMessageId idempotency**; **อัปโหลดรูปจาก composer วันนี้ไม่ถึงลูกค้าเลย** (`room-manager.uploadFile` :652-683 → saveMessage role:BOT อย่างเดียว ไม่เรียก adapter — บั๊ก live ที่ต้องแก้ใน B2)
- **`Product.photos` เป็น base64 data URLs** (`products-online-listing.service.ts:8,76-90`) — LINE/FB adapter ต้องการ public HTTPS URL → รูปที่ส่งลูกค้าได้ต้องมาจาก `gallery[]` เท่านั้น
- contract wizard อ่าน query แค่ `customerId, productId, downAmount, months` (`useContractCreateData.ts:15-19`) — ส่ง suggestedProducts ไป = no-op
- canned sender มี `VARIABLE_KEYS` hardcode แยกจาก variable service (`canned-response-sender.service.ts:130-140`) — เพิ่มตัวแปรต้องแก้ 2 ที่

### บอท
- grounding guard ผูกกับ**ชื่อ key ใน tool result** (`sales-bot.service.ts:304-369` GROUNDED_PRICE_KEYS) — เปลี่ยน shape ผลลัพธ์ tool โดยไม่อัปเดต = บอทโดน block เงียบ (confidence 0.3 → handoff)
- `SalesBotResult` = `{reply, confidence, toolsUsed(ชื่ออย่างเดียว), tokens, model}` — **ไม่มีช่องทางส่ง productId/รูป/ลิงก์ออกมา** (`sales-bot.service.ts:30-37`); multi-reply seam มีเฉพาะ domain-handler path (:334-355) ไม่ใช่ path บอทร้าน (step 3.5 :184-199); WEB adapter `sendMessage` เป็น stub no-op
- **น้องเบสไม่ผ่าน MessageRouter** — pipeline จริง: webhook → ChatbotFinanceService → FinanceAiService → `lineClient.replyMessage` (`finance-domain.handler.ts:76-88` เป็น stub); ใช้ Haiku เปิดเทิร์น + escalate Sonnet เมื่อเจอ tool_use; **ไม่มี grounding guard**; system prompt อ่านจาก DB ก่อนแล้ว fallback เป็น constant (`finance-config.service.ts:108-113` = `config?.value || FINANCE_BOT_SYSTEM_PROMPT`, cache 5 นาที) — **ไม่มี UI/endpoint แก้ prompt เลย**: `FinanceConfigService.updateSystemPrompt()` + `invalidatePromptCache()` + `UpdatePromptDto` ไม่มี caller ใดๆ ใน src → การ rollout ต้องแก้ **ทั้งสองที่**: code constant (มีผลเมื่อ DB ไม่มีแถว เช่น local) + SQL upsert `system_config.key='finance_bot_system_prompt'` บน prod
- `ChatKnowledgeBase.channel` **มีอยู่แล้ว** (schema:5177 NOT NULL default LINE_FINANCE + index) — ข้อจำกัดคือ hardcode ใน `knowledge.service.ts:51,165,189,197`; การเพิ่ม tool ให้น้องเบสต้องแก้ 3 ที่: TOOL_INPUT_VALIDATORS allowlist, ToolName + executor switch, providers (import class ตรงๆ ไม่ import module)
- `search_products` วันนี้**จงใจเก็บเครื่องไม่มีราคาไว้เป็น priceMissing** (comment ในไฟล์: ตัดออก 'would have nuked all bot quotes') + #1332 flow ตอบเรตกลางแล้ว flag staff — readiness filter แบบเว็บ (บังคับรูป) จะ**ซ่อนของขายได้จริงจากแชท**
- NODE_ENV=production ตั้งจริงทั้ง Dockerfile:52 + deploy-gcp.yml:340; AiSettingsPage มี toggle/threshold/channels/central-branch **แก้ไขได้อยู่แล้ว** — ที่ไม่มีคือ env-only flags (FB_BOT_DISABLED) + checkbox LINE_FINANCE/TIKTOK เป็น no-op หลอกตา

### เว็บ / จอง
- **api image ไม่มี index.html ของ web-shop** (Dockerfile build แค่ apps/api) + `setGlobalPrefix('api')` ไม่มี exclude (`main.ts:159`) → rewrite /products/** ตรงๆ ตามที่เขียนตอนแรก = 404 ทั้งเว็บ; helmet ปิด CSP ด้วยเหตุผล 'API serves no HTML' (`main.ts:85-99`)
- `/products/:id` ของ unit ที่ขายแล้ว**ยัง render หน้ารุ่นพร้อมเครื่องที่เหลือได้อยู่แล้ว** (head query ไม่กรอง status :225-233, units re-query IN_STOCK :245) — ปัญหา "ลิงก์ตาย" เดิมเบากว่าที่คิด
- slug รุ่นแบบ 'iphone-12-64gb' **ไม่ unique** — catalog แยกมือ1/มือ2 เป็นคนละการ์ด (GROUP_BY รวม category, #1368)
- m.me `?ref=` วันนี้: **standalone referral event โดน drop** (`facebook-webhook.controller.ts:259` return เมื่อ !message), อ่าน ref เฉพาะเมื่อพ่วง postback (ไป ads attribution); ไม่มี Get Started button; FB_PAGE_ID ไม่มีฝั่ง client
- bot-defense classifier **ไม่รู้จัก facebookexternalhit/Facebot/Twitterbot/LINE crawler** + จำกัด /products 60/min ต่อ IP (`shop-bot-defense.service.ts:25-61`) — บั๊ก 429 เดิมยังไม่แก้
- monthlyPaymentFrom ใช้ rate ปลอม (0.0099) จาก `_min(cashPrice)` — engine จริงต้องใช้ `installmentPrice` + InterestConfig (สองเครื่องคิดเงิน resolve config คนละ key: บอท tenure-range/createdAt desc vs preview productCategories ไม่กรอง tenure)
- **จอง/จ่ายเงิน:** `placeOrder` เป็นขั้น **ก่อนจ่ายเงิน** (เงินเข้าทีหลังผ่าน PaySolutions webhook) — จุดต้อง guard จริงคือ `confirmOnlineOrderPayment` (`paysolutions-confirmation.service.ts:289-319` — tx เดียว order→PAID + reservation→CONSUMED **update by id ไม่กรอง status** + Sale fail = swallow); **BANK_TRANSFER คือรูโหว่ที่สุด**: `confirmBankTransfer` (`shop-orders.service.ts:54-59`) set PAID อย่างเดียว — ไม่ consume จอง ไม่สร้าง Sale ไม่ flip status → **ขายซ้ำได้ 100% ไม่ต้องอาศัย race**; `preemptByInStoreSale` ใช้ this.prisma (ร่วม tx caller ไม่ได้); hold ทุกอัน anonymous (DTO มีแค่ productId+sessionId); EventsGateway ปิดใน prod (ไม่มี ENABLE_WEBSOCKET) — pattern แจ้งเตือนจริงคือ 30s polling badge (`useQcPendingCount` + MenuBadge)
- ข้อความ 'หมดสต็อก แจ้งเตือนเมื่อมาใหม่' อยู่ฝั่ง **api** (`shop-catalog.service.ts:291` + spec assertion) ไม่ใช่ web-shop
- [DEMO] 7 เครื่องบน prod, ไม่มี filter; migration ล่าสุด `20260981000000` → ว่าง `20260982000000+`; QA UI ใช้ local เท่านั้น

## 1. การตัดสินใจของ owner (ยืนยันแล้ว 2026-08-04)

1. **แหล่งราคาจริง = ราคาต่อเครื่อง** (`Product.cashPrice`/`installmentPrice`) — ตารางราคากลางเป็น**ค่าตั้งต้น** autofill ตอนรับเครื่องเข้า; `prices[]` เลิกใช้แบบค่อยเป็นค่อยไป
2. **บอทตอบสินค้าได้ทุกช่อง + น้องเบสด้วย** (product tools ชุดเดียวกัน; FB ยังปิดตาม kill switch จนกว่า owner เปิดเอง)
3. **ขึ้นเว็บอัตโนมัติเมื่อข้อมูลครบ** (รูป+ราคา+เกรดมือสอง) — ปิดรายเครื่องได้
4. **ซ่อนราคาทุน+กำไรจาก SALES** — บังคับทั้ง**ฝั่ง server** (strip ใน API) ไม่ใช่แค่ DOM
5. **ลำดับงาน = Data-first**: B0 → B1 → B2 → B3 → B4 → B5 — PR ละ batch

**Scope ที่ตัดตามผล scrutinize (ยืนยันกับ owner ตอนรีวิว spec นี้):**
- ตัด `/p/:slug` + dynamic sitemap — `/products/:id` ทำหน้าที่ permalink ได้อยู่แล้ว (unit ขายแล้วยัง render รุ่น+เครื่องเหลือ); OG ใช้ share endpoint แทน (§6)
- ตัด `ChatRoom.attachedProductId` + ตัวแปรสินค้าใน canned responses — ปุ่ม "แทรกสรุป" จาก picker ให้ผลเดียวกันโดยไม่มี schema/สถานะค้าง; ค่อยเพิ่มถ้า staff ขอ
- ตัด migration KB (คอลัมน์ channel มีอยู่แล้ว) — เหลือ ALTER DROP NOT NULL เล็กๆ + แก้ query
- ตัด "แจ้งลูกค้าเว็บเมื่อโดนตัดหน้า" แบบ push — เหลือ: cart self-correct (โพลทุก 5s อยู่แล้ว) + ข้อความ reject แยกกรณี + LINE best-effort เมื่อมีออเดอร์ + งาน refund เข้าคิว staff เสมอ

## 2. B0 — ฐานข้อมูล: ราคาเดียว + เกรด + เงื่อนไขขึ้นเว็บ (apps/api + prisma + จุดเล็กใน web)

### 2.1 ราคา single source
- เพิ่ม `cashPrice`, `installmentPrice` ใน Create/UpdateProductDto (เขียนได้เฉพาะ OWNER/BM)
- **Write-through ทางเดียว (คอลัมน์ → prices[])**: หา row `isDefault` ปัจจุบัน → update amount (+relabel 'ราคาเงินสด') ถ้าไม่มีค่อย create — ห้าม label-match create ซ้อน (กัน isDefault 2 row ทำ take:1 readers เพี้ยน); ใช้ transaction unset-other-defaults แบบเดียวกับ ProductsPricingService; **upsert row 'ราคาผ่อน BESTCHOICE' จาก installmentPrice ด้วย** (ผู้อ่านสัญญา prefer label นี้)
- **แก้เครื่องคิดเงินสัญญา**: `useContractCalculation.getSellingPrice` เปลี่ยนเป็น **columns-first** ผ่าน `getDisplayPrices` (installment-first) + fallback prices[] เดิม — พร้อม **golden jest test** ยืนยันผลเท่าเดิมทุกบาทกับสินค้าที่มีทั้งสองแหล่ง (red line §10)
- **redirect writer เดิม 2 จุดมาเขียนคอลัมน์**: repossession refurb (`markReadyForSale` → set cashPrice=resellPrice) + PO receiving (selling price → cashPrice) — prices[] row ได้ฟรีจาก write-through
- **คง `getDisplayPrices` fallback ไว้** (มัน columns-first อยู่แล้ว — คอลัมน์ถูกเขียนเมื่อไหร่ก็อ่านเอง; ลบ fallback ใน release เก็บกวาดทีหลัง) — ห้าม "ลดเหลือคอลัมน์อย่างเดียว" ใน B0 เพราะ ProductsPage/POSPage ส่ง object ที่มีแต่ prices[]
- **Autofill จาก PricingTemplate** ตอนสร้าง Product ทุกทาง — จุด hook: `products.service.create` (:81), `runReceiveInTx` (:55 — ครอบ direct-receive ที่ delegate เข้ามาแล้ว :385), trade-in accept, buyback, repossession refurb; เงื่อนไข: cashPrice ว่างเท่านั้น, normalize storage null↔'', **PHONE_NEW → แถว hasWarranty=false** (ตาม schema:1781 comment "false = ไม่เกี่ยว/ไม่มีประกัน, true = มีประกัน (มือ 2)" และ `pricing-templates.service.ts:70` บังคับ `hasWarranty: category === 'PHONE_USED' ? (dto.hasWarranty ?? false) : false` ตอน create → แถว PHONE_NEW ที่ true สร้างไม่ได้) **/ PHONE_USED → เลือกตาม warranty ของเครื่อง; กำกวม (template มาตรฐานมี 2 แถวต่อรุ่นมือสอง) → fallback แถว hasWarranty=false ตาม precedent `pricing-templates.service.ts:37` (`hasWarranty ?? false` = ราคาถูกกว่า อนุรักษ์นิยม) + log info**; stamp `priceAutofilledAt` (คอลัมน์ใหม่ — เคลียร์เมื่อแก้ราคามือ)
- ⚠️ **Gate ก่อนเขียนโค้ด autofill**: settle ความหมาย `installmentBestchoicePrice` (ต่อเดือน vs ราคารวม) กับ owner ด้วย query ข้อมูล template จริงบน prod 1 ครั้ง — ถ้าเป็นต่อเดือน: autofill เติมได้เฉพาะ cashPrice (หรือคำนวณรวม = ต่อเดือน × งวด)
- **Backfill prod**: ขยาย script ให้ fallback ไป **isDefault row ทุก label** (ครอบ 'ราคาขาย'/'ราคาขายต่อ (Refurbished)') + log จำนวนต่อ label ให้ owner รีวิว (§9.4); **รันใน deploy เดียวกับ readiness filter** (ก่อน filter มีผล) — ไม่งั้นของมีราคาหายจากเว็บทั้งกระดาน
- แก้ null→0 ครบ **4 จุด**: shop-catalog:254 (tier), shop-cart:39, shop-installment-apply:44 (→ BadRequest เมื่อไม่มีราคา), web-shop ProductDetailPage:146,177 (→ 'สอบถามราคา')

### 2.2 เกรด + ฟิลด์ใหม่
- เขียน `Product.conditionGrade` **2 จุด**: `completeInspection` (เขียน overallGrade ลงทุก product ที่ผูก) **และ `overrideGrade`** (อัปเดตเกรดเครื่องตาม dto.grade ด้วย — override เกิดหลัง complete เสมอ ตรรกะจุดเดียวไม่พอ)
- เปิดแก้ `conditionGrade` + `shopWarrantyDays` ผ่าน DTO (OWNER/BM)
- **Migration `20260982000000`**: `accessoriesIncluded Json?`, `cosmeticNotes String?` (≤500), `priceAutofilledAt DateTime?`
- expose ฟิลด์ทั้งหมดใน shop `ProductUnit` + bot tools (B3)

### 2.3 ขึ้นเว็บอัตโนมัติเมื่อครบ
- **Readiness util กลาง** (`product-readiness.util.ts`): IN_STOCK + `gallery ≥ 1` + `cashPrice > 0` + (PHONE_USED → มีเกรด) + brand/category เข้า shop gate + **`NOT name startsWith '[DEMO]'` แบบ unconditional** (ไม่ผูก NODE_ENV — QA local เห็นพฤติกรรมเดียวกับ prod; เครื่อง demo ยังเห็นใน admin ปกติ)
- Fragment ต้องคืน **object AND-composable** (`{AND:[...]}`) และใช้ใน: `shopBaseWhere`, **`getProductDetail` ทั้ง 2 inline where**, **`shop-reservation.reserve()`** — ระวัง `listGroupedByModel` ที่ assign `where.OR` สำหรับ search
- `isOnlineVisible` = สวิตช์ "ปิดจากเว็บ" (default true คงเดิม); ปลด invariant ใน `products-online-listing.service.ts` (toggle กดได้เสมอ)
- Endpoint `GET /products/:id/readiness` คืน checklist ต่อข้อ + เตือน brand/category ไม่เข้า gate

### 2.4 util แปลงคำค้นไทย
- `device-query-normalize.util.ts`: utterance → {brand, model, storage, color} — รองรับ ไอโฟน/โปรแม็กซ์/พลัส/15pm/ip15/ความจุ/สีไทย; **ดูด `normalizeStorage` + storage-token refine จาก `get-installment-rates.tool.ts:83,120-128` เข้ามารวม** (B3 re-point tool มาใช้) — ผู้ใช้: shop search (B4), bot (B3), inbox detect (B2)

## 3. B1 — หน้าสินค้า admin (apps/web + จุดเล็กใน api)

- **ซ่อนทุน/กำไรฝั่ง server**: strip `costPrice` ออกจาก response เมื่อ role=SALES ทั้ง findOne/findAll/stock (ตาม precedent `staff-chat.controller.ts:126-135`) + ฝั่ง UI ไม่ render การ์ดทุน/กำไรให้ SALES
- **ส่วนราคาใหม่**: ช่องราคาเงินสด/ราคาผ่อน (เขียนคอลัมน์) + badge "เติมอัตโนมัติจากตารางราคากลาง" (อ่าน `priceAutofilledAt`); ตาราง prices[] เดิม read-only (collapsed)
- **ปุ่ม "คัดลอกสรุปส่งลูกค้า"**: คำนวณผ่อนเริ่มต้นที่ระดับหน้า **เรียก `calcBcInstallment` ตรง** (BcCalculatorCard expose อะไรออกมาไม่ได้ — state ภายใน) — ข้ามบรรทัดผ่อนเมื่อ installmentPrice ว่าง; ทุกฟิลด์ null-safe ('-')
- **ปุ่ม "คัดลอกลิงก์"**: ใช้ **share URL จาก B4** (`/api/shop/share/:id` — ก่อน B4 ใช้ /products/:id ตรง); disabled+tooltip เมื่อไม่ ready
- **การ์ด readiness** (กิน endpoint B0) แทน missingReasons เดิม
- **การ์ดเครื่องอื่นรุ่นเดียวกัน**: **ขยาย `GET /products` findAll** เพิ่ม query params `model`, `storage`, `status` ซ้ำได้ (IN_STOCK+RESERVED) — ไม่สร้าง endpoint ใหม่
- **การ์ดโปรโมชั่น**: ใช้ `GET /promotions/active` + **ขยาย @Roles ให้ FM/ACCOUNTANT** (ตอนนี้ FM/ACC โดน 403 — ชนกับการเปิด route ให้สองบทบาทนี้ใน batch เดียวกัน); label "ยังไม่กรองรายเครื่อง (มาใน B3)"
- แสดง: ประกันร้าน/อุปกรณ์/ตำหนิ (แก้ได้), ผลตรวจ QC รายข้อ, เกรด (แก้ได้ OWNER/BM)
- แก้ลิงก์ตาย "ไปแก้ราคา": thread callback `onEditPrice` เปิดตัวแก้ราคาใหม่ของ B1, **render เฉพาะ OWNER/BM** (SALES เห็นข้อความ 'แจ้งผู้จัดการ'); ซ่อน "ใช้ราคานี้ทำสัญญา" สำหรับ role ที่เข้า /contracts/create ไม่ได้ (FM/ACC)
- เพิ่ม FM/ACCOUNTANT ใน route (mount-safe — verify แล้วทุก fetch ตอน mount อนุญาต)

## 4. B2 — Inbox (apps/web + apps/api staff-chat / chat-engine)

- **primitive ส่งภาพแบบ idempotent (งานแกนของ batch)**: ขยาย `sendStaffMessage` รับ optional `{type, mediaUrl}` ส่งผ่านทั้ง saveMessage + adapter (คง clientMessageId exactly-once ทั้ง text และรูป) — **ห้าม**ไปใช้ `sendStaffOutbound` โดยไม่เพิ่ม idempotency; role ที่ persist = STAFF
- **แก้บั๊ก live: รูปจาก composer ไม่ถึงลูกค้า** — reroute upload path (upload → public/signed URL → ส่งผ่าน primitive ใหม่); LINE ต้องการ public HTTPS `originalContentUrl`
- **Product picker ใน composer**: ค้นผ่าน `GET /staff-chat/products/search` (ขยาย select: **`gallery[0]` เป็นรูป — ห้ามใช้ `photos[]` ที่เป็น base64**, ราคา/ผ่อน/แบต/เกรด/สาขา/readiness; **ห้ามส่ง photos[] ในผล search** — payload บวมเป็น MB) → action: แทรกสรุปลง composer / ส่งการ์ด / ส่งรูปจาก `gallery[]` (เครื่องที่มีแต่ photos[] → hint 'ยังไม่มีรูปขึ้นเว็บ'); เพิ่ม ACCOUNTANT ใน @Roles chat-commerce (ตอนนี้ส่งข้อความได้แต่ค้นสินค้า 403)
- **สร้างการ์ดใหม่บน primitive**: 2 bubble idempotent (รูป + ข้อความสรุป: ราคาคอลัมน์ + งวดจริงจาก InterestConfig + share URL) — ลบ hardcode '12 งวด'/prices[0]
- **ProductContextCard อัปเกรด**: กดไปหน้าเต็ม, ปุ่มส่งให้ลูกค้า, จำนวนเครื่องจริง, render รูป, detection ใช้ util B0 (ไทย/ความจุ/สี)
- **สร้างสัญญาจากแชท**: ส่ง `?customerId=...&productId=<เครื่องที่เลือก>` (wizard อ่าน productId อยู่แล้ว — prefill ได้จริง); suggestedProducts จาก contract-prefill แสดงเป็นตัวช่วยเลือกใน SessionActions เท่านั้น (เลือก 1 → เป็น productId)
- **Mock AI**: gate ใน `AiSuggestService.suggest` (prod → คืนว่าง; dev → prefix '[MOCK] ') + ลบ dead injection ใน AiAutoReplyService
- ~~ChatRoom.attachedProductId + ตัวแปรสินค้า canned~~ **ตัดออก** (§1) — ถ้าเพิ่มภายหลัง: ต้อง register ทั้ง variable service + `VARIABLE_KEYS` ของ sender (export ค่าคงที่ร่วมกันกัน drift)

## 5. B3 — บอท (apps/api sales-bot + chatbot-finance)

- **`search_products` ยกเครื่อง**: parse ด้วย util B0 (brand/model/storage/color), select เพิ่ม (แบต/สี/ความจุ/ประกัน/อุปกรณ์/ตำหนิ/สาขา/`gallery[0]`), **group รายรุ่น+ความจุ+สภาพ** (count + ช่วงราคา + รายเครื่อง), รวม RESERVED ติด flag 'ติดจองชั่วคราว', ราคาอ่านคอลัมน์
- **Filter บอท = หลวมกว่าเว็บ**: บังคับเกรดมือสอง แต่ **ไม่กรอง `cashPrice` ที่ query** — คงพฤติกรรม `priceMissing` → handoff เดิมไว้ (§0: ในโค้ดมีคอมเมนต์ว่าการตัดเครื่องไม่มีราคาออก "would have nuked all bot quotes") และ**ไม่บังคับรูป** — ของจริงส่วนใหญ่ยังไม่มีรูป จะซ่อนสต็อกขายได้จากแชท; ใส่ `photoAvailable` ต่อเครื่อง; คงพฤติกรรม priceMissing→handoff + #1332 rate-reply เดิม; [DEMO] ถูกกรองโดย util B0 แล้ว
- **Grounding guard (definition-of-done)**: คงชื่อ key เดิมในผล tool ใหม่ หรือขยาย `GROUNDED_PRICE_KEYS` ใน PR เดียวกัน + **jest fixture test** รัน collectGroundedPrices+guardGrounding กับ shape ใหม่ (กันบอท 'โง่ลงเงียบๆ')
- **ส่งรูป/ลิงก์ — ระบุ contract จริง**: เพิ่ม `attachments?: {productId, imageUrl?, webUrl?}[]` ใน `SalesBotResult` (**เติม deterministic จากผล tool ใน runTool — ไม่ใช่ให้โมเดลเขียน**) → thread ผ่าน autoReply → router ส่ง text ก่อน (replyToken) แล้วตาม IMAGE bubble ผ่าน adapter + persist type/mediaUrl ให้ครบ; แนบเมื่อเจาะจง ≤2 เครื่อง; WEB adapter เป็น stub — ฝั่งเว็บ widget อาศัย saveMessage render
- **`calculate_installment` รวมเครื่องคิดที่ระดับ util**: เรียก `calcBcInstallment` + **เลือก config-resolution เดียว** (ตัดสินใจใน plan: ใช้แบบ preview หรือแบบ tenure-match — สองที่ resolve คนละ key อยู่) + golden test เทียบผล bot tool === InstallmentPreviewService ที่ input เดียวกัน; downPct จาก InterestConfig
- **น้องเบส — คนละ pipeline อย่าแตะ router**: เพิ่ม tools ใน pipeline ตัวเอง — 3 จุด mechanical: TOOL_INPUT_VALIDATORS + ToolName/executor switch + providers (import class จาก sales-bot ตรงๆ); ภาพ: ขยาย `replyAndSave` ส่ง LINE image array (LINE reply รับ 5 messages/call, มีตัวอย่าง 2-message อยู่แล้ว); **port `guardGrounding` เข้า FinanceAiService ใน PR เดียวกัน** (ห้ามพึ่ง prompt อย่างเดียว — บทเรียน #1064/#1337); **ops step: อัปเดต system prompt 2 ที่** — แก้ constant `prompts/system-prompt.ts` (มีผลเมื่อ DB ไม่มีแถว) + SQL upsert `system_config.key='finance_bot_system_prompt'` บน prod (ไม่มี UI/endpoint — dead code path) แล้วรอ cache 5 นาที
- **KB ข้ามช่อง (ไม่มี add-column)**: migration `20260983000000` = ALTER `chat_knowledge_base.channel` DROP NOT NULL (null = ทุกช่อง); parameterize `knowledge.service` (`OR:[{channel:null},{channel}]`); `search_knowledge_base` tool ใน sales bot (Prisma-only); admin page เพิ่มตัวเลือกช่อง
- **`list_promotions`**: implement productId/categories filter จริง
- **AI status**: endpoint เล็กคืน boolean env flags (FB_BOT_DISABLED, whitelist, central-branch-set) → status strip บนหน้าเดิม; แก้/annotate checkbox LINE_FINANCE/TIKTOK ที่เป็น no-op — **ไม่สร้าง status card ซ้ำกับของที่แก้ไขได้อยู่แล้ว**
- แก้ `ProductDetectService` เลิกคิดค่างวดเอง → util เดียวกัน

## 6. B4 — Website (apps/web-shop + apps/api shop)

- **OG ผ่าน share endpoint (ไม่ rewrite ทั้งเว็บ)**: endpoint `GET /api/shop/share/:id` — HTML สั้น escaped (OG title/description/**image**/price + JSON-LD Product+Offer + `<link canonical>` + meta-refresh/JS ไป `/products/:id`) — **วิ่งบน rewrite `/api/**` ที่มีอยู่แล้ว ไม่แตะ firebase.json/prefix/deploy ordering**; ปุ่ม copy B1/B2 + ลิงก์บอท + ปุ่มแชร์เว็บ ใช้ URL นี้; escape ทุกค่า inject (ปิด stored-XSS — api ไม่เคยเสิร์ฟ HTML, CSP ปิดอยู่); **bot-defense: classify facebookexternalhit/Facebot/Twitterbot/LINE crawler = KNOWN_GOOD + ยกเว้น rate-limit endpoint นี้ + แก้บั๊ก 429 เดิมก่อน**
- ~~/p/:slug + dynamic sitemap~~ **ตัดออก** (§1 — /products/:id ทำหน้าที่นี้ได้แล้ว; ถ้าอนาคตอยากได้ SEO ระดับรุ่นค่อยทำพร้อม disambiguation มือ1/มือ2)
- **รูปตามเครื่อง**: UnitPicker เลือกแล้ว gallery/360 สลับเป็นของเครื่องนั้น + reset activeImage index
- **ปุ่มแชร์/คัดลอกลิงก์** (navigator.share + clipboard fallback) → share URL
- **แสดงต่อเครื่อง**: สาขา (expose ใน ProductUnit), อุปกรณ์, ตำหนิ + ไฮไลต์ QC, ประกันจริง (เลิก hardcode '30 วัน')
- **ปุ่มแชทแนบบริบท**: LINE prefill = 'สนใจ <ชื่อรุ่น> (<4 ตัวท้าย>) <share URL>' (จุดแก้เดียว copy.ts:25-28 + 2 call sites); ปุ่ม Messenger `m.me/<page>?ref=p:<unitId>` — **งาน webhook จริง**: เพิ่ม branch `referral && !message && !postback` ใน processMessagingEvent (ตอนนี้โดน drop) → resolve room ตาม PSID → **post system message ในห้อง 'ลูกค้ากดมาจากสินค้า X' + ให้ detection เห็น** (ไม่ใช้ attachedProductId ที่ตัดไป, ไม่ปนกับ ads-attribution) + ตั้ง Get Started button (พก ref ให้ user ใหม่) + เพิ่ม page username ใน `shopInfo` (copy.ts — ข้อมูล public)
- **ค้นหาไทย**: listGroupedByModel ต่อ util B0 (Prisma query-builder ต่อได้สะอาด — ระวัง where.OR assign)
- **แก้ค่างวดหน้ารายการ**: เพิ่ม `_min(installmentPrice)` ใน groupBy + extract config-resolution ของ preview เป็น helper ใช้ร่วม → 'ผ่อนเริ่มต้น' = เลขที่ทำสัญญาได้จริง (งวดยาวสุด+ดาวน์ต่ำสุด); กลุ่มไม่มี installmentPrice → ไม่แสดงบรรทัดผ่อน

## 7. B5 — จองจากเว็บ ↔ ทีมขาย (apps/api + apps/web)

- **Guard ที่จุดเงินเข้าจริง (webhook)**: ใน tx ของ `confirmOnlineOrderPayment` — re-check `product.status==='IN_STOCK'` + reservation consume เปลี่ยนเป็น `updateMany({where:{id, status:'ACTIVE'}})` แล้ว branch เมื่อ count=0 (แพ้ race/โดน preempt) → order เข้าสถานะใหม่ `PAYMENT_RECEIVED_UNFULFILLABLE` + แจ้ง staff คิว refund — **ห้าม** update by id เฉยๆ (ทับ PREEMPTED เป็น CONSUMED); คง check ที่ placeOrder ด้วย (ถูก)
- **ปิดรู BANK_TRANSFER (ขายซ้ำได้ 100%)**: `confirmBankTransfer` ต้องวิ่ง path เดียวกับ gateway confirm — consume reservation + สร้าง Sale ผ่าน adapter + re-check status ใน tx; hold ของออเดอร์โอนเงิน**อยู่ยาวจนออเดอร์จบ** (ไม่ใช่ 15 นาที)
- **Preempt แบบ in-tx**: ไม่ inject service ข้าม module — util จิ๋วรับ tx client: `tx.productReservation.updateMany({where:{productId(+bundle), status:'ACTIVE'}, data:{status:'PREEMPTED'}})` วางในทุก transaction ที่ flip เครื่องออกจาก IN_STOCK (sale-writer 3 ทาง + bundle, contract-lifecycle) — คืน id ที่โดน preempt แล้วค่อยแจ้งเตือน**หลัง commit**; เป็น additive ใน tx เดิม + ทดสอบว่าไม่เปลี่ยนพฤติกรรมเงิน (red line)
- **Admin เห็น hold ตามข้อมูลที่มีจริง**: list สินค้า/เวลาจอง-หมด/สถานะ/ที่มา (จากออเดอร์/ใบสมัครผ่อน/ยังไม่ผูก) — ชื่อลูกค้าแสดงเมื่อมีออเดอร์เท่านั้น (hold เว็บ anonymous ทั้งหมด); ปุ่มปลด hold (OWNER/BM); indicator บนหน้าสินค้า admin
- **แจ้งเตือน staff = polling badge pattern ที่พิสูจน์แล้ว**: MenuBadgeKey `online-orders-pending` + endpoint pending-count + hook 30s (แบบ useQcPendingCount) — **ไม่พึ่ง EventsGateway** (ปิดใน prod); WS push เป็น follow-up ถ้าเปิด ENABLE_WEBSOCKET
- ลูกค้าเว็บ: ข้อความ reject แยก 'ถูกตัดหน้า' จาก 'หมดอายุ' (อ่าน PREEMPTED ใน loadActiveReservation) + LINE flex best-effort เมื่อมีออเดอร์
- แก้ dead copy: `shop-catalog.service.ts:291` + spec assertion (:393) + component ฝั่ง web-shop ที่ render tone:'out' → ปุ่มแชท LINE

## 8. นอกขอบเขต (ตัดออก — ตกลงแล้ว)

- ตาราง spec รายรุ่น (จอ/กล้อง/ชิป), วิดีโอสินค้า, น้ำหนัก/ค่าส่งตามเครื่อง
- บอทกดจอง/hold แทนลูกค้า; ระบบ back-in-stock
- `/p/:slug` + dynamic sitemap; `attachedProductId` + ตัวแปรสินค้า canned (ดู §1)
- แก้ historical data (prod = testing-phase, forward-fix only)

## 9. งานฝั่ง owner (ไม่ใช่โค้ด — ทำคู่กับ deploy)

1. **ตอบคำถามความหมาย `installmentBestchoicePrice`** (ต่อเดือน vs ราคารวม) — gate ของ B0 autofill; ผมเตรียม query ให้ดูจากข้อมูลจริง
2. กรอก **ตารางราคากลาง** ให้ครบทุกรุ่นที่ขาย
3. **ล้าง [DEMO]** ก่อนเปิดจริง: `CLEAN=1 bash scripts/seed-demo-products-prod.sh` (มี filter กันใน B0 แล้ว)
4. รีวิวราคาที่ backfill (log per-label จาก script) ว่าตรงราคาขายจริง
5. เปิด **FB bot** (`FB_BOT_DISABLED`) เมื่อพร้อม; อัปเดต **system prompt น้องเบส** ตอน B3 deploy — ผมรัน SQL runbook ให้ (ไม่มีหน้าจอแก้), มี checklist ในแผน B3

## 10. หลักปฏิบัติทุก batch

- **Red line**: ห้ามแตะ accounting/finance JE; เครื่องคิดเงินสัญญา/สร้างสัญญา behavior-preserving — ทุกจุดที่แตะ (useContractCalculation B0, preempt-in-tx B5) ต้องมี golden test เลขเดิมทุกบาท
- ทดสอบ: jest ต่อ module (money-math = mock-based golden ตาม convention journal); tsc 0 + eslint 0; browser QA บน local
- Migration: B0=`20260982000000`, B3=`20260983000000` (KB DROP NOT NULL) — เช็ค max จริงก่อนสร้างทุกครั้ง
- Deploy ทีละ batch; B0 ต้อง**รวม backfill ไว้ใน deploy เดียวกับ readiness filter**; CI gate เขียว + code-owner review 1 คน (owner กด)
