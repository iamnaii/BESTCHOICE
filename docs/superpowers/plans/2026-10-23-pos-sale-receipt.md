# ใบเสร็จรับเงินขายสด (A1 + A2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ใบขาย `CASH`/`EXTERNAL_FINANCE` ออกใบเสร็จรับเงิน PDF A4 ได้จาก POS และหน้า `/sales` และส่งให้ลูกค้าได้ 3 ทาง (LINE ร้าน · หน้าสาธารณะ `/r/:token` 30 วัน · คัดลอกลิงก์)

**Architecture:** เรนเดอร์สดจาก `Sale` (ไม่สร้างแถว `Receipt`) ด้วย puppeteer ตามแบบ `other-income/services/receipt-pdf.service.ts`; HTML เป็นฟังก์ชันบริสุทธิ์ทดสอบด้วยสตริง; token สาธารณะเก็บบน `Sale` (คอลัมน์ใหม่ 2 คอลัมน์) ต่ออายุทุกครั้งที่ออกเอกสาร; LINE ส่ง Flex ผ่าน `LineOaService.sendFlexMessage` ช่อง `line-shop` + `NotificationLog`; web มี `SaleReceiptActions` ตัวเดียวใช้ทั้ง dialog หลังขายและแผงใบขาย

**Tech Stack:** NestJS + Prisma + puppeteer + qrcode · React + react-query + shadcn Dialog · jest (API) · vitest (web)

**Spec:** `docs/superpowers/specs/2026-10-23-pos-sale-receipt-design.md`

## Global Constraints

- ประเภทใบขายที่รองรับ: `CASH`, `EXTERNAL_FINANCE` เท่านั้น · `INSTALLMENT` → 400 ข้อความ `ใบขายผ่อนชำระใช้ใบเสร็จของสัญญา` (ทุก endpoint ใหม่)
- เลขเอกสาร = `sale.saleNumber` · กระดาษ A4 เท่านั้น · พิมพ์ชื่อผู้ขาย (`salesperson.name`) เสมอ
- token: `crypto.randomBytes(32).toString('base64url')` · TTL 30 วัน = `30 * 24 * 60 * 60 * 1000` ms · ต่ออายุทุกครั้ง ไม่หมุน token
- URL สาธารณะ: `${PAYMENT_LINK_BASE_URL ?? FRONTEND_URL ?? 'http://localhost:5173'}/r/${token}`
- คีย์ตั้งค่า `receipt_shop_warranty_terms` · ค่าเริ่มต้น `DEFAULT_RECEIPT_WARRANTY_TERMS` (ข้อความตามสเปก) ประกาศครั้งเดียวใน `packages/shared/src/sale-receipt.ts`
- ข้อความสาธารณะ 404: `ไม่พบเอกสาร หรือลิงก์หมดอายุแล้ว` (ไม่แยกเหตุ) · throttle `{ short: { limit: 10, ttl: 60_000 } }`
- ทุกค่าที่ลง HTML ผ่าน `escapeHtml` · เงิน `fmtMoney` · วันที่ไทย `fmtDateShort`
- ห้ามอ่าน `PrismaService` จาก controller · ห้าม `<select>` ดิบในเว็บ (ใช้ `NativeSelect`) · สี/โทเคนจาก `index.css` เท่านั้น
- เวอร์ชัน web บั๊มเป็น `26.10.51` ใน commit สุดท้าย

## Review Focus

1. ใบขายที่ **ถูกยกเลิก** (`deletedAt`) — พนักงานเปิด PDF ได้พร้อมลายน้ำ แต่ `share`/`line` → 400 และลิงก์สาธารณะที่เคยส่ง → 404 (Task 1 + 4 + 5)
2. ใบขายเก่า **ไม่มี `shopTenders`** — ต้องพิมพ์วิธีชำระจาก `paymentMethod` + `amountReceived` ไม่ใช่ว่าง/NaN (Task 2)
3. `SALES` สาขาอื่น ขอ PDF/share/line ของใบขายคนละสาขา → 403 (`salesBranchWhere` เดิม) (Task 5)
4. ลูกค้า **ไม่ผูก LINE ร้าน** → `{ delivered:false, reason:'NO_LINE_LINK' }` + `NotificationLog` FAILED · push โยน → `PUSH_FAILED` ไม่ 500 (Task 4)
5. ชื่อสินค้า/ชื่อลูกค้าที่มี `<`/`&` และของแถม 0 ชิ้น — HTML ไม่พัง, ไม่มีแถวว่าง (Task 2)

---

### Task 1: Migration + `SaleReceiptTokenService`

**Files:**
- Create: `apps/api/prisma/migrations/20261101000000_sale_receipt_token/migration.sql`
- Modify: `apps/api/prisma/schema.prisma` (model `Sale`)
- Create: `apps/api/src/modules/sales/services/sale-receipt-token.service.ts`
- Test: `apps/api/src/modules/sales/services/sale-receipt-token.service.spec.ts`

**Interfaces:**
- Produces: `SaleReceiptTokenService.ensureToken(saleId: string): Promise<{ token: string; expiresAt: Date }>` — โยน `NotFoundException('ไม่พบใบขาย')` เมื่อไม่มี/ถูกลบ · มี token อยู่แล้ว = คง token เดิม ต่ออายุ now+30d · ไม่มี = mint ใหม่
- Produces: `SaleReceiptTokenService.findSaleIdByToken(token: string): Promise<string | null>` — คืน `null` เมื่อไม่พบ / `deletedAt` / `receiptTokenExpiresAt <= now`
- Produces: `SaleReceiptTokenService.publicUrl(token: string): string`
- Produces: `RECEIPT_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000`

- [ ] **Step 1: schema + migration**

`Sale` เพิ่ม `receiptToken String? @unique @map("receipt_token")` และ `receiptTokenExpiresAt DateTime? @map("receipt_token_expires_at")`. migration.sql:

```sql
ALTER TABLE "sales" ADD COLUMN "receipt_token" TEXT, ADD COLUMN "receipt_token_expires_at" TIMESTAMP(3);
CREATE UNIQUE INDEX "sales_receipt_token_key" ON "sales"("receipt_token");
```

Run: `(cd apps/api && npx prisma generate)` → Expected: generated โดยไม่มี error

- [ ] **Step 2: เขียน spec ที่ล้ม** — mock prisma แบบ `sale-void.service.spec.ts` (`{ sale: { findFirst: jest.fn(), update: jest.fn() } }`), `ConfigService` mock `get` คืน `undefined`
  - `ensureToken` mint เมื่อ `receiptToken` null: `update` ถูกเรียกด้วย `data.receiptToken` ยาว ≥ 40 ตัว base64url และ `receiptTokenExpiresAt` ≈ now+30d (±5s)
  - `ensureToken` คง token เดิมเมื่อมีอยู่: `data.receiptToken` ไม่ถูกส่ง (undefined) และ expiry ถูกเลื่อน
  - `ensureToken` โยน `NotFoundException` เมื่อ `findFirst` คืน null (where ต้องมี `deletedAt: null`)
  - `findSaleIdByToken` คืน id เมื่อ expiry อนาคต · คืน null เมื่อหมดอายุ · null เมื่อ `findFirst` คืน null
  - `publicUrl('abc')` = `http://localhost:5173/r/abc` เมื่อไม่มี env · ใช้ `PAYMENT_LINK_BASE_URL` ก่อน `FRONTEND_URL`

- [ ] **Step 3: รันให้ล้ม** — `(cd apps/api && npx jest --runTestsByPath src/modules/sales/services/sale-receipt-token.service.spec.ts)` → FAIL (module not found)

- [ ] **Step 4: implement** `@Injectable() SaleReceiptTokenService` constructor `(prisma: PrismaService, config: ConfigService)` ตาม Interfaces (baseUrl ตัด `/` ท้าย)

- [ ] **Step 5: รันให้ผ่าน** → PASS

- [ ] **Step 6: Commit** `feat(sales): receipt token on Sale + SaleReceiptTokenService`

---

### Task 2: HTML builder (ฟังก์ชันบริสุทธิ์)

**Files:**
- Create: `packages/shared/src/sale-receipt.ts` + export ใน `packages/shared/src/index.ts`
- Create: `apps/api/src/modules/sales/services/sale-receipt-html.ts`
- Test: `apps/api/src/modules/sales/services/sale-receipt-html.spec.ts`

**Interfaces:**
- Produces (shared): `RECEIPT_WARRANTY_TERMS_KEY = 'receipt_shop_warranty_terms'`, `DEFAULT_RECEIPT_WARRANTY_TERMS` (ข้อความสเปก), `PAYMENT_METHOD_RECEIPT_LABEL: Record<PaymentMethod-string, string>` (CASH เงินสด · BANK_TRANSFER โอน · QR_EWALLET QR/e-Wallet · CARD บัตร · CREDIT_BALANCE เครดิตคงเหลือ · ONLINE_GATEWAY ชำระออนไลน์)
- Produces: `interface SaleReceiptModel` — `{ saleNumber, saleType: 'CASH'|'EXTERNAL_FINANCE', createdAt: Date, branchName, company: { nameTh, address, taxId, phone }, customer: { name, phone, memberCode?: string|null }, salespersonName, tenders: { label, amount: string, reference?: string|null }[], depositLine?: { label, amount }|null, finance?: { company, refNumber, amount: string }|null, mainItem: { name, idLabel: 'IMEI'|'S/N'|null, idValue, note, price: string }, bundleItems: { name, idText }[], totals: { gross, discount, tradeIn?: { voucher, amount }|null, net, received, downPayment?: string|null }, warranty: { headline, terms, productTerms?: string|null }, notice: string, qrDataUrl: string, voided?: { at: Date, reason: string|null }|null }`
- Produces: `buildSaleReceiptHtml(m: SaleReceiptModel, fontCss: string): string`
- Produces: `toSaleReceiptModel(input: SaleForReceipt, ctx: { company, terms: string, qrDataUrl }): SaleReceiptModel` โดย `SaleForReceipt` = Prisma `Sale` รวม `customer{name,phone,legacyMemberCode}`, `product{name,brand,model,storage,imeiSerial,serialNumber,category}`, `branch{name}`, `salesperson{name}`, `shopTenders[{method,amount,reference,seq}]`, `bundleProducts[{name,imeiSerial,legacyProductCode}]`, `receiptBreakdown` (ผลของ `bookingReceipt`) , `productDisclosure`, `tradeInCreditSnapshot`

- [ ] **Step 1: spec ที่ล้ม** — ใช้ fixture ขายสดตามสเปก (iPhone 15 Pro Max · tender CASH 5,000 + BANK_TRANSFER 17,900 ref 2510221432 · ของแถม 2 · ส่วนลด 1,000 · เครดิตเทิร์น 8,000 voucher TI-20261022-0003 · net 22,900) และ fixture ไฟแนนซ์นอก (GFIN ref GF-7781 · ดาวน์ 5,000 · financeAmount 36,900)
  - `toSaleReceiptModel`: tenders 2 บรรทัด label `เงินสด`/`โอน`, reference เฉพาะบรรทัดโอน · ไม่มี tender → 1 บรรทัดจาก `paymentMethod`/`amountReceived` · `totals.received` = ผลรวม tender `22900.00` · tradeIn amount `8000.00` voucher `TI-20261022-0003` · EXTERNAL_FINANCE: `finance.amount = '36900.00'`, `totals.downPayment = '5000.00'`, `totals.received = '5000.00'` · `mainItem.idLabel` = `IMEI` เมื่อมี imeiSerial, `S/N` เมื่อมีแค่ serialNumber, null เมื่อไม่มี · `mainItem.note` ขึ้นต้น `มือสอง` เมื่อ category PHONE_USED และต่อด้วย `disclosureText` · `warranty.headline` = `ประกันร้าน 7 วัน · dd/mm/yyyy – dd/mm/yyyy` จาก `productDisclosure.shopWarrantyDays` + วันจริง · ไม่มี end date → `ไม่มีประกันร้าน · ประกันศูนย์ตามเงื่อนไขผู้ผลิต` · receiptBreakdown.depositAmount → `depositLine.label` ขึ้นต้น `มัดจำจอง`
  - `buildSaleReceiptHtml`: มี `ใบเสร็จรับเงิน` และ `RECEIPT · ต้นฉบับ` · EXTERNAL_FINANCE มี ` · เงินดาวน์` และประโยค `ส่วนที่เหลือ 36,900.00 บาท ชำระกับ GFIN` · CASH มีประโยค `ไม่ใช่ใบกำกับภาษี` · ของแถมเป็นแถว `ของแถม` 2 แถว และราคา `0.00` · ไม่มีของแถม → ไม่มีคำว่า `ของแถม` · ชื่อลูกค้า `A&B <x>` ถูก escape เป็น `A&amp;B &lt;x&gt;` · `voided` → มี `ยกเลิก` และ `ยกเลิกเมื่อ` · มี `<img src="data:image/png;base64,...">` ของ QR · มีชื่อผู้ขาย `สมชาย` ในช่องลงนาม · `thaiBahtText(22900)` ปรากฏ

- [ ] **Step 2: รันให้ล้ม** → FAIL (module not found)

- [ ] **Step 3: implement** `sale-receipt.ts` (shared) แล้ว `sale-receipt-html.ts` — โครง CSS ใช้ `TRANSACTION_PAGE_CSS` + `transactionDocumentCss('body')` + `PAPER_SPACING_CSS` + `paperSpacingScript()` และโลโก้ `BESTCHOICE_LOGO_SVG` คัดลอกจาก other-income (คอนสแตนต์เดียวกัน) · เลย์เอาต์ตามสเปกข้อ 1–8 (หัว · คู่สัญญา/การรับชำระ · ตาราง · สรุปเงิน+ตัวอักษร · กล่องประกัน · ข้อความกำกับ · QR/ติดต่อ/ลงนาม · ลายน้ำ) สี header `#065f46` ขาวดำพิมพ์ได้ · `thaiBahtText(Number(received))`

- [ ] **Step 4: รันให้ผ่าน** → PASS · `(cd packages/shared && npm run build)` ผ่าน

- [ ] **Step 5: Commit** `feat(sales): sale receipt HTML builder + shared receipt constants`

---

### Task 3: `SaleReceiptPdfService`

**Files:**
- Create: `apps/api/src/modules/sales/services/sale-receipt-pdf.service.ts`
- Test: `apps/api/src/modules/sales/services/sale-receipt-pdf.service.spec.ts`

**Interfaces:**
- Consumes: Task 1 `ensureToken`/`publicUrl` · Task 2 `toSaleReceiptModel`/`buildSaleReceiptHtml`
- Produces: `SaleReceiptPdfService.generate(saleId: string, actor: SalesReadActor | null): Promise<{ pdf: Buffer; saleNumber: string; voided: boolean }>` — actor null = เส้นทางสาธารณะ (ไม่กรองสาขา, ใบยกเลิก → `NotFoundException`) · actor มี = `where: { AND: [{ id }, salesBranchWhere(actor)] }` (ใบยกเลิกได้ PDF ลายน้ำ) · ไม่พบ → `NotFoundException('ไม่พบใบขาย')` · `INSTALLMENT` → `BadRequestException('ใบขายผ่อนชำระใช้ใบเสร็จของสัญญา')`
- Produces: `loadReceiptTerms(prisma): Promise<string>` = `systemConfig.findUnique({ where: { key: RECEIPT_WARRANTY_TERMS_KEY } })?.value?.trim() || DEFAULT_RECEIPT_WARRANTY_TERMS`

- [ ] **Step 1: spec ที่ล้ม** — `jest.mock('puppeteer')` ให้ `launch` คืน `{ newPage: () => ({ setContent, evaluate, pdf: () => Buffer.from('%PDF') }), close }` · mock prisma `sale.findFirst`, `product.findMany` (bundle), `companyInfo.findFirst`, `systemConfig.findUnique` · mock token service
  - INSTALLMENT → BadRequestException
  - actor SALES สาขา A ขอใบสาขา B → `findFirst` ถูกเรียกด้วย where ที่มี `branchId` ของ actor (ตรวจผ่าน `salesBranchWhere`) และคืน null → NotFound
  - public (actor null) + `deletedAt` ไม่ null → NotFound · staff + deletedAt → ได้ pdf และ `voided: true`
  - `companyInfo.findFirst` ถูกเรียกด้วย `{ where: { companyCode: 'SHOP' } }` · `systemConfig` ไม่มีแถว → ใช้ `DEFAULT_RECEIPT_WARRANTY_TERMS` (ตรวจว่า `setContent` ได้ HTML ที่มีข้อความนั้น) · `ensureToken` ถูกเรียก 1 ครั้งทุกเส้นทางที่สำเร็จ

- [ ] **Step 2: รันให้ล้ม** → FAIL

- [ ] **Step 3: implement** — โหลด sale (`include` เหมือน `SalesQueryService.findOne` + `shopTenders: SALE_TENDERS_SELECT` export จาก sales-query.service · `receiptBreakdown: bookingReceipt(sale)`) · bundle ผ่าน `product.findMany({ where: { id: { in: bundleProductIds } } })` · QR ด้วย `QRCode.toDataURL(publicUrl, { margin: 0, width: 220 })` · puppeteer flags/ตั้งค่า `page.pdf({ format: 'A4', margin 0, printBackground: true })` เหมือน other-income · `embeddedDocumentFonts()` ส่งเป็น `fontCss`

- [ ] **Step 4: รันให้ผ่าน** → PASS

- [ ] **Step 5: Commit** `feat(sales): SaleReceiptPdfService renders cash/external-finance receipt`

---

### Task 4: `SaleReceiptLineService`

**Files:**
- Create: `apps/api/src/modules/sales/services/sale-receipt-line.service.ts`
- Test: `apps/api/src/modules/sales/services/sale-receipt-line.service.spec.ts`

**Interfaces:**
- Consumes: Task 1 · `LineOaService.sendFlexMessage(to, flex, 'line-shop')` · `wrapFlexMessage`/`COLORS` จาก `line-oa/flex-messages/base-template`
- Produces: `SaleReceiptLineService.send(saleId: string, actor: SalesReadActor): Promise<{ delivered: true } | { delivered: false; reason: 'NO_LINE_LINK' | 'PUSH_FAILED' }>` — sale ไม่พบ/นอกสาขา → NotFound · INSTALLMENT → BadRequest · ใบยกเลิก → `BadRequestException('ใบขายนี้ถูกยกเลิกแล้ว')`
- Produces: `buildSaleReceiptFlex(input: { saleNumber, deviceName, amountLabel: string, amountText: string, url: string }): FlexMessagePayload` (export เพื่อเทส)

- [ ] **Step 1: spec ที่ล้ม**
  - ลูกค้า `lineIdShop` null → `{ delivered:false, reason:'NO_LINE_LINK' }` · `notificationLog.create` ถูกเรียกด้วย `status: 'FAILED'`, `channelKey: 'line-shop'`, `subject: 'ใบเสร็จรับเงิน'`, `relatedId: saleId`, `category: 'TRANSACTIONAL'` · ไม่เรียก `sendFlexMessage`
  - ส่งสำเร็จ → `{ delivered:true }` · `sendFlexMessage` ถูกเรียกด้วย `to = lineIdShop`, channel `line-shop`, altText `ใบเสร็จรับเงิน SL-...` · log `SENT` + `sentAt` · `ensureToken` ถูกเรียก
  - `sendFlexMessage` โยน → `PUSH_FAILED` + log FAILED `errorMsg` มีข้อความ error
  - `buildSaleReceiptFlex`: bubble มี text `ใบเสร็จรับเงิน`, `เลขที่ SL-1`, ปุ่ม `uri` = url label `เปิดใบเสร็จ`, และ `ลิงก์ใช้ได้ 30 วัน` · EXTERNAL_FINANCE ใช้ amountLabel `เงินดาวน์`

- [ ] **Step 2: รันให้ล้ม** → FAIL

- [ ] **Step 3: implement** (`deviceName` = `[brand, model, storage].filter(Boolean).join(' ')` · amount CASH = `netAmount`, EF = `downPaymentAmount` ผ่าน `fmtMoney` + ` บาท`)

- [ ] **Step 4: รันให้ผ่าน** → PASS

- [ ] **Step 5: Commit** `feat(sales): send sale receipt link via LINE shop OA`

---

### Task 5: Controllers + module + e2e wiring + security rule

**Files:**
- Modify: `apps/api/src/modules/sales/sales.controller.ts` (เพิ่ม 3 route ก่อน `@Get(':id')`)
- Create: `apps/api/src/modules/sales/sales-receipt-public.controller.ts`
- Modify: `apps/api/src/modules/sales/sales.module.ts` (providers 3 service · controllers +1)
- Modify: `apps/api/e2e/sales-read-scope.e2e-spec.ts` (เพิ่ม 3 service ใหม่ใน `.map(provide => ({ provide, useValue: {} }))`)
- Modify: `.claude/rules/security.md` (bullet `sales-receipt-public`)
- Test: `apps/api/src/modules/sales/sales-receipt.controller.spec.ts`

**Interfaces:**
- Produces: `GET /sales/:id/receipt.pdf` → `@Roles('OWNER','BRANCH_MANAGER','FINANCE_MANAGER','ACCOUNTANT','SALES')` · `@Res()` ส่ง `application/pdf` · `Content-Disposition: inline; filename="<encodeURIComponent('ใบเสร็จ-'+saleNumber)>.pdf"` · `Cache-Control: private, no-store`
- Produces: `POST /sales/:id/receipt/share` → `{ url, expiresAt }` (roles เดียวกัน · ตรวจสาขา/ประเภท/ยกเลิกผ่าน `SalesService.findOne(id, actor)` ก่อน แล้ว `ensureToken`)
- Produces: `POST /sales/:id/receipt/line` → ผลจาก `SaleReceiptLineService.send`
- Produces: `GET /sales/receipt/public/:token/pdf` ใน `SalesReceiptPublicController` (`@Controller('sales/receipt/public')`, ไม่มี guard, `@Throttle({ short: { limit: 10, ttl: 60_000 } })`) → `findSaleIdByToken` null → `NotFoundException('ไม่พบเอกสาร หรือลิงก์หมดอายุแล้ว')` · ไม่งั้น `generate(saleId, null)`; log เฉพาะ saleId ไม่ log token

- [ ] **Step 1: spec ที่ล้ม** (controller แบบ `products.controller.spec.ts` — `new SalesController(...)` ด้วย mock service) — `getReceiptPdf` ตั้ง header 3 ตัวและ `res.send(buffer)` · `share` คืน `{ url, expiresAt }` และเรียก `findOne` ก่อน `ensureToken` · public controller: token ไม่พบ → NotFound ข้อความสเปก · พบ → `generate(saleId, null)`
- [ ] **Step 2: รันให้ล้ม** → FAIL
- [ ] **Step 3: implement** controller/module/e2e/security.md (ลำดับ route: `receipt/public` อยู่คนละ controller จึงไม่ชน `:id`; ใน `SalesController` วาง 3 route ใหม่ **ก่อน** `@Get(':id')` และ `@Post(':id/void')`)
- [ ] **Step 4: รันให้ผ่าน** → PASS · `(cd apps/api && npx tsc --noEmit -p tsconfig.json)` 0 error · `grep -n "SaleReceiptPdfService\|SaleReceiptTokenService\|SaleReceiptLineService" apps/api/e2e/sales-read-scope.e2e-spec.ts` ต้องเจอทั้ง 3
- [ ] **Step 5: Commit** `feat(sales): receipt PDF/share/LINE endpoints + public token route`

---

### Task 6: หน้าตั้งค่า "ใบเสร็จขายสด"

**Files:**
- Create: `apps/web/src/pages/SettingsPage/ReceiptsSettingsPage.tsx`
- Modify: `apps/web/src/config/settings-registry.tsx` (เพิ่ม item ใน `products`: `{ id: 'receipts', label: 'ใบเสร็จขายสด', roles: ['OWNER'], kind: 'route', component: ReceiptsSettingsPage, path: '/settings/products/receipts' }` ต่อจาก `stickers`)
- Test: `apps/web/src/pages/SettingsPage/__tests__/ReceiptsSettingsPage.test.tsx`

**Interfaces:**
- Consumes: `useSettingsEditor()` → `{ values, editingSection, setEditingSection, saveMutation }` · `SettingsCard` props `{ group, values, isEditing, onEdit, onSave, onCancel, isSaving }` · `ConfigGroup { key, title, subtitle, items: [{ key, label, shortLabel, suffix, type: 'text', step: '', desc }] }`
- Produces: group key `receipts` item key `receipt_shop_warranty_terms` label `เงื่อนไขประกันร้านท้ายใบเสร็จ` desc = `DEFAULT_RECEIPT_WARRANTY_TERMS` (จาก `@installment/shared`) ขึ้นต้น `ค่าเริ่มต้น: `

- [ ] **Step 1: test ที่ล้ม** — mock `useSettingsEditor` (hook ห้ามคืน mock object เดียวกันซ้ำ — คืน object ใหม่ต่อการเรียก) · render → เห็นหัว `ตั้งค่าใบเสร็จขายสด` และ label ช่อง · กด แก้ไข → พิมพ์ → บันทึก → `saveMutation.mutate` ถูกเรียกด้วย `[{ key: 'receipt_shop_warranty_terms', value: '...' }]`
- [ ] **Step 2: รันให้ล้ม** `(cd apps/web && npx vitest run src/pages/SettingsPage/__tests__/ReceiptsSettingsPage.test.tsx)` → FAIL
- [ ] **Step 3: implement** หน้า (`useDocumentTitle('ตั้งค่าใบเสร็จขายสด')` + `PageHeader` + `SettingsCard`) + registry
- [ ] **Step 4: รันให้ผ่าน** → PASS
- [ ] **Step 5: Commit** `feat(settings): receipt warranty terms card under products`

---

### Task 7: `SaleReceiptActions` (web)

**Files:**
- Create: `apps/web/src/components/sales/SaleReceiptActions.tsx`
- Create: `apps/web/src/components/sales/saleReceipt.ts` (ข้อความ + helper)
- Test: `apps/web/src/components/sales/__tests__/SaleReceiptActions.test.tsx`

**Interfaces:**
- Produces: `<SaleReceiptActions sale={{ id, saleNumber, saleType, deletedAt }} size?: 'sm'|'md' />` — คืน `null` เมื่อ `saleType === 'INSTALLMENT'` · `deletedAt` → แสดงเฉพาะปุ่ม `พิมพ์ใบเสร็จ`
- Produces: `lineResultMessage(r: { delivered: boolean; reason?: string }): { kind: 'success'|'error'; text: string }` — delivered → `ส่งใบเสร็จทาง LINE แล้ว` · `NO_LINE_LINK` → `ลูกค้ายังไม่ผูก LINE ร้าน — คัดลอกลิงก์ส่งให้แทน` · อื่น → `ส่ง LINE ไม่สำเร็จ ลองใหม่หรือคัดลอกลิงก์`
- Produces: `receiptPdfPath(id) = /sales/${id}/receipt.pdf` · `receiptFilename(saleNumber) = ใบเสร็จ-${saleNumber}.pdf`

- [ ] **Step 1: test ที่ล้ม** — mock `@/lib/api` (`post`), mock `sonner`, mock `@/components/PdfPreview` เป็น stub ที่ render `data-testid="pdf-preview"` พร้อม `path`
  - กด `พิมพ์ใบเสร็จ` → stub ได้ `path=/sales/s1/receipt.pdf` และ `filename=ใบเสร็จ-SL-1.pdf`
  - กด `ส่ง LINE` → `post('/sales/s1/receipt/line')` → `toast.success('ส่งใบเสร็จทาง LINE แล้ว')` · reason NO_LINE_LINK → `toast.error(...)` ข้อความสเปก
  - กด `คัดลอกลิงก์` → `post('/sales/s1/receipt/share')` → `navigator.clipboard.writeText(url)` → `toast.success` มี `คัดลอกลิงก์แล้ว` · clipboard โยน → แสดง `<input readonly value=url>` ในกล่อง
  - `saleType INSTALLMENT` → render ว่าง · `deletedAt` → มีแค่ปุ่มพิมพ์

- [ ] **Step 2: รันให้ล้ม** → FAIL
- [ ] **Step 3: implement** (ปุ่ม `Button` variant outline + ไอคอน lucide `Printer`/`MessageCircle`/`Link` · `useMutation` ทั้งสอง · state `preview` เปิด `PdfPreview` ด้วย `title="ใบเสร็จรับเงิน"`)
- [ ] **Step 4: รันให้ผ่าน** → PASS
- [ ] **Step 5: Commit** `feat(web): SaleReceiptActions (print / LINE / copy link)`

---

### Task 8: POS — `SaleDoneDialog`

**Files:**
- Create: `apps/web/src/pages/POSPage/components/SaleDoneDialog.tsx`
- Modify: `apps/web/src/pages/POSPage/index.tsx` (`onSuccess` บรรทัด 245–250)
- Test: `apps/web/src/pages/POSPage/components/SaleDoneDialog.test.tsx` · แก้ `apps/web/src/pages/POSPage/POSPage.test.tsx`

**Interfaces:**
- Consumes: Task 7
- Produces: `<SaleDoneDialog sale={{ id, saleNumber, saleType, netAmount, downPaymentAmount? } | null} onClose={() => void} />` — หัว `ขายสำเร็จ · {saleNumber}` · บรรทัดยอด (`ยอดสุทธิ` หรือ `เงินดาวน์` สำหรับ EF) · `SaleReceiptActions` · ปุ่มหลัก `ขายต่อ` = `onClose` · ปิดด้วย Esc/คลิกนอก = `onClose`
- POS: `onSuccess(data)` → `invalidateSalesQueries` เหมือนเดิม · `setReviewOpen(false)` · ถ้า `data.saleType !== 'INSTALLMENT'` → `setDoneSale(data)` (ไม่ toast) ไม่งั้น toast เดิม · `onClose` = `setDoneSale(null); resetForm()`

- [ ] **Step 1: test ที่ล้ม** — dialog test: render ด้วย sale CASH → เห็นหัว, ยอด `22,900` , ปุ่ม `ขายต่อ` เรียก `onClose` · EF → เห็น `เงินดาวน์` · POSPage.test: หลัง `mocks.post` resolve `{ id:'s1', saleNumber:'TEST-SALE-1', saleType:'CASH', netAmount:'9000' }` และกดขาย (ใช้ flow ที่เทสเดิมใช้กด submit — ดูเทส `ขาย...สำเร็จ` ถ้ามี, ไม่มีให้เพิ่มตาม renderPOS + เลือกลูกค้าทดสอบ + ปุ่มยืนยันขาย) → เห็น `ขายสำเร็จ · TEST-SALE-1` และกด `ขายต่อ` แล้ว dialog หาย
- [ ] **Step 2: รันให้ล้ม** → FAIL
- [ ] **Step 3: implement** dialog (`Dialog`/`DialogContent`/`DialogHeader`/`DialogTitle`/`DialogDescription`/`DialogFooter` จาก `@/components/ui/dialog`) + POS wiring
- [ ] **Step 4: รันให้ผ่าน** ทั้ง 2 ไฟล์ → PASS
- [ ] **Step 5: Commit** `feat(pos): sale-done dialog with receipt actions replaces toast`

---

### Task 9: แผงใบขาย `/sales`

**Files:**
- Modify: `apps/web/src/pages/SalesHistoryPage.tsx` (ใน Sheet หลัง `<dl>` สรุปเงิน บรรทัด ~830)
- Test: `apps/web/src/pages/__tests__/SalesHistoryPage.receipt.test.tsx`

- [ ] **Step 1: test ที่ล้ม** — ลอก setup จาก `SalesHistoryPage.void.test.tsx` (mock api/auth) เปิด `?saleId=s1` ที่ `saleType: 'CASH'` → เห็นปุ่ม `พิมพ์ใบเสร็จ`, `ส่ง LINE`, `คัดลอกลิงก์` · `deletedAt` → เห็นเฉพาะพิมพ์ · `INSTALLMENT` → ไม่มีปุ่มทั้งสาม
- [ ] **Step 2: รันให้ล้ม** → FAIL
- [ ] **Step 3: implement** — `<div><p className="text-muted-foreground">เอกสาร</p><SaleReceiptActions sale={saleDetail.data} size="sm" /></div>`
- [ ] **Step 4: รันให้ผ่าน** → PASS
- [ ] **Step 5: Commit** `feat(sales): receipt actions in sale detail sheet`

---

### Task 10: หน้าสาธารณะ `/r/:token`

**Files:**
- Create: `apps/web/src/pages/SaleReceiptViewPage.tsx`
- Modify: `apps/web/src/App.tsx` (lazy import + `<Route path="/r/:token" element={<SaleReceiptViewPage />} />` ข้าง `/cn/:token`)
- Test: `apps/web/src/pages/__tests__/SaleReceiptViewPage.test.tsx`

**Interfaces:**
- Consumes: `liffApi.get('/sales/receipt/public/${token}/pdf', { responseType: 'blob' })`
- Produces: หน้าเดียวกับ `CreditNoteViewPage` ต่างที่ path, ชื่อ `ใบเสร็จรับเงิน`, ชื่อไฟล์ `ใบเสร็จ-${token}.pdf`, ข้อความ error `ไม่พบเอกสาร หรือลิงก์หมดอายุแล้ว`

- [ ] **Step 1: test ที่ล้ม** — mock `liffApi.get` คืน Blob → render ที่ `/r/abc` → มี iframe/ปุ่มดาวน์โหลด · reject 404 → เห็นข้อความ error
- [ ] **Step 2: รันให้ล้ม** → FAIL
- [ ] **Step 3: implement** (คัดลอก `CreditNoteViewPage.tsx` แล้วแก้ 4 จุด — ไม่ต้อง generalize)
- [ ] **Step 4: รันให้ผ่าน** → PASS
- [ ] **Step 5: Commit** `feat(web): public sale receipt page /r/:token`

---

### Task 11: ตรวจรวม + เวอร์ชัน + PR

- [ ] **Step 1:** `apps/web/package.json` version → `26.10.51`
- [ ] **Step 2:** `(cd apps/web && npx tsc --noEmit && npx eslint src --max-warnings=0 && npx vitest run)` → 0 error, ทุกเทสผ่าน
- [ ] **Step 3:** `(cd apps/api && npx tsc --noEmit && npx jest --runTestsByPath src/modules/sales/services/sale-receipt-*.spec.ts src/modules/sales/sales-receipt.controller.spec.ts)` → PASS · `bash tools/test-chat-credit.sh` (ชุด e2e ที่ประกอบ SalesController — ต้องเขียว หลังแก้ `sales-read-scope`)
- [ ] **Step 4:** เรนเดอร์ PDF จริง 2 ใบ (CASH + EF) ด้วยสคริปต์ชั่วคราวใน scratchpad ที่เรียก `buildSaleReceiptHtml` + puppeteer แล้วเปิดดูภาพ: ไม่ล้นหน้า A4 เดียว ตัวอักษรไทยไม่ถูกตัด
- [ ] **Step 5:** Commit `chore(web): bump 26.10.51` · push `feat/pos-sale-receipt` · เปิด PR ชื่อ `feat(sales): ใบเสร็จรับเงินขายสด A4 + แชร์ LINE/ลิงก์สาธารณะ (ก้อน 4 A1+A2)` อ้างสเปก · ท้าย body ใส่ `🤖 Generated with [Claude Code](https://claude.com/claude-code)`
