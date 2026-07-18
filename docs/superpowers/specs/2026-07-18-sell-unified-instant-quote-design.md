# รวมรับซื้อ+เก่าแลกใหม่เป็น "ขาย/เทิร์น iPhone" ที่ /sell — Design

**วันที่:** 2026-07-18
**สถานะ:** อนุมัติแล้ว (owner) + แก้ไขตามผล scrutinize (16-agent trace, 2026-07-18)
**ต่อยอดจาก:** spec 2026-07-17 buyback-iphone-instant-quote (PR #1360, merged+deployed)

## 1. เป้าหมาย

ยุบ `/trade-in` (เก่าแลกใหม่ flow เก่า: ทุกยี่ห้อ, เกรด A/B/C, รูปถ่าย, รอ staff 24 ชม.)
เข้ากับ instant-quote wizard → เหลือ **flow เดียวที่ `/sell`**:
ลูกค้าตอบแบบประเมิน → เห็น **2 ราคา** (เงินสด / เทิร์น ซึ่งสูงกว่า) → เลือกทาง → นัดเข้าร้าน

การตัดสินใจของ owner:
1. ยุบเหลือ instant-quote ตัวเดียว — flow เก่าของ trade-in ตายทั้งหมด (2026-07-18)
2. iPhone อย่างเดียว — ยี่ห้ออื่น = ปุ่มทักไลน์
3. ราคาเทิร์น = ราคาเงินสด × (1 + โบนัส % ตั้งค่าได้ในแอดมิน)
4. URL ใหม่ `/sell` — `/buyback*` และ `/trade-in*` ทุกเส้น redirect มา
5. **นโยบายเทิร์น (จาก scrutinize S1, 2026-07-18):** เทิร์น = **เครดิตส่วนลดซื้อเครื่องในร้าน** ไม่ใช่เงินสด —
   ต้นทุนสต็อกเครื่องที่รับเข้า (`Product.costPrice`) ใช้ **cashPrice เสมอ** (โบนัสเป็นส่วนลดฝั่งเครื่องใหม่
   ไม่ใช่ต้นทุนเครื่องเก่า); ถ้าลูกค้าเปลี่ยนใจไม่ซื้อเครื่อง staff กดถอยเป็นราคาเงินสดได้ในคลิกเดียว;
   การผูกเครดิตกับ POS/สัญญาจริง = defer เป็น phase ถัดไป (ตอนนี้ staff ใช้เป็นส่วนลด manual + อ้าง tradeInId)

## 2. Scope / Non-goals

**In scope**
- web-shop: routes `/sell` + redirects (ส่งต่อ query string), wizard dual-price + เลือก flow, landing ใหม่, nav/footer/home เหลือลิงก์เดียว, ลบหน้า trade-in 3 หน้า + `components/device-submit/` + `types/trade-in.ts` + hook `useSignedUpload.ts` (เหลือ 0 ผู้ใช้ — ลบทิ้ง), sitemap
- api: quote/submit dual-price + `flow`, SystemConfig โบนัส + admin endpoint, ปลดระวาง shop-trade-in (410), ถอด `TRADE_IN_PHOTO` จาก public presign, **แก้ REVISED ให้ flow-aware (§7.2)**, **แก้ accept() costPrice สำหรับ EXCHANGE instant (§7.4)**, getStatus เพิ่ม `deletedAt: null`
- staff (apps/web): badge เทิร์น/รับซื้อในตาราง, OnlineAppraiseModal โชว์ 2 ราคา + ปุ่มถอยเงินสด, TradeInDetailDialog โชว์ flow+2 ราคา, ช่องโบนัส % ในแท็บแบบประเมินออนไลน์
- CI: เพิ่ม step build web-shop ใน job "Lint & Test" (ปัจจุบัน**ไม่เคย build web-shop** — ลบไฟล์ผิดจะไปตายตอน deploy; local gate = `npm run build` ใน apps/web-shop บังคับก่อน PR ด้วย)

**Non-goals (ไม่แตะ)**
- ❌ ไม่มี migration — ราคาอยู่ใน `quoteBreakdown` JSON, โบนัสอยู่ SystemConfig
- Flow walk-in ของ staff (create/appraise เดิม/quick-buy) — เดิม; appraise-online โหมด **AS_ANSWERED/MANUAL ใช้กับ EXCHANGE ได้โดยไม่แก้** (REVISED ต้องแก้ตาม §7.2 — อย่าอ่าน non-goal นี้ว่าทั้ง handshake ไม่ต้องแตะ)
- บัญชี: **ห้ามแตะ `modules/journal/**` รวมถึง `cpa-templates/shop-trade-in.template.ts`** — ชื่อไฟล์คล้าย module ที่ปลดระวาง แต่เป็น JE template ของ walk-in accept คนละตัวกัน (ดู §6.3 ขอบเขตการลบ)
- ตารางราคากลาง, targetProductId (ตัดทิ้ง — ลูกค้าเลือกเครื่องใหม่ที่ร้าน)

## 3. Pricing

```
cashPrice     = สูตรเดิม (max − Σfixed) × (1 − Σ%/100) ปัดลงหลักสิบ
exchangePrice = floor(cashPrice × (100 + bonusPct) / 100 / 10) × 10   // Decimal ล้วน — ห้ามสร้างจาก float 1+pct/100
```
- `bonusPct` = SystemConfig `sell_exchange_bonus_pct` — อ่านผ่าน **`readNumberFlag` ใน `apps/api/src/utils/config.util.ts`**
  (กรอง `deletedAt: null`, DB พัง/ค่าเพี้ยน/NaN → **default 10**, ค่านอกช่วง 0–100 → default 10) — ไม่ใช่ pattern ของ late-fee.util (ไม่มีกันพัง)
- ไม่มี caching — PUT มีผล quote ถัดไปทันที
- Golden: cash 12,420 @10% → 13,662 → **13,660**; @0% → exchangePrice == cashPrice (UI ยังโชว์ 2 ทาง)
- `POST quote` ตอบเพิ่ม: `cashPrice`, `exchangePrice`, `bonusPct` (field `price` เดิม = cashPrice เพื่อ back-compat ของ bundle เก่า)
- `POST submit` รับ `flow` (`@IsOptional() @IsIn(['BUYBACK','EXCHANGE'])` **default `'BUYBACK'`** — bundle เก่าไม่ส่ง = พฤติกรรมเดิมเป๊ะ):
  - `estimatedValue` = ราคาทาง flow
  - **`quoteBreakdown.price` = ราคาทาง flow (== estimatedValue เสมอ — invariant ของระบบ)** + เก็บ `cashPrice`, `exchangePrice`, `bonusPct`, `chosenFlow` แยก (record BUYBACK: price == cashPrice → back-compat กับ record จาก #1360 ที่ไม่มี field ใหม่)
  - **submit response `price` = ราคาทาง flow**; `TradeIn.flow` = ตามเลือก
  - Flex LINE: copy **และ `altText`** แยกตาม flow — BUYBACK: alt "ยืนยันราคารับซื้อแล้ว" body "รับซื้อ ฿X — ทีมงานนัดวันเข้าร้าน"; EXCHANGE: alt "ยืนยันมูลค่าเทิร์นแล้ว" body "เครดิตเทิร์นแลกเครื่องใหม่ ฿Y — มาเลือกเครื่องที่ร้าน (ใช้เป็นส่วนลดซื้อเครื่อง ไม่จ่ายเป็นเงินสด)"; ราคาใน flex = ราคาทาง flow
- IMEI dedup 24 ชม. เดิมคงไว้ (ลูกค้าสลับ flow ภายใน 24 ชม. → โดน block — ยอมรับ + ข้อความเดิมชี้ทักไลน์)

## 4. UX (apps/web-shop)

### 4.1 Routes + redirects — **ทุกตัวส่งต่อ `location.search`** (utm จากโฆษณาเก่า)
| Route | เป็น |
|---|---|
| `/sell` · `/sell/quote` · `/sell/:id` | landing / wizard / status (ย้ายจาก buyback pages) |
| `/buyback`→`/sell`, `/buyback/quote`→`/sell/quote`, `/buyback/submit`→`/sell/quote`, `/buyback/:id`→`/sell/:id` | `<Navigate replace>` (:id ใช้ wrapper อ่าน useParams + forward search) |
| `/trade-in`→`/sell`, `/trade-in/submit`→`/sell/quote`, `/trade-in/:id`→`/sell/:id` | เดียวกัน |

### 4.2 Wizard dual-price + เลือกทาง
- Step 3: 2 แถวราคา — 💵 ขายรับเงินสด `฿{cashPrice}` / 🔄 เทิร์นแลกเครื่องใหม่ `฿{exchangePrice}` + badge `+{bonusPct}%` (เน้นเทิร์น) + คำอธิบายสั้น "เครดิตเทิร์นใช้เป็นส่วนลดซื้อเครื่องในร้าน"
- เลือกทาง = radio-card → state `chosenFlow` — **reset เป็น null ทุกจุดที่เรียก `setQuote(null)`** (pick คำตอบ, เปลี่ยนรุ่น, เปลี่ยนความจุ) และ **ปุ่ม submit disabled จนกว่า `chosenFlow` ไม่ null**
- breakdown: บรรทัดหักรวมเป็น cashPrice + **บรรทัด "โบนัสเทิร์น +X% = +฿Z" เมื่อเลือกเทิร์น** (เลขบวกกันได้ตรง headline เสมอ)
- Step 4: label ปุ่มตาม flow ("ยืนยันขาย — รับเงินสดที่ร้าน" / "ยืนยันเทิร์น — มาเลือกเครื่องที่ร้าน"); payload เพิ่ม `flow`
- ปุ่ม CTA "ดูราคา" มี **2 จุด** (inline desktop `hidden md:block` + StickyBottomBar) — แก้ label/logic คู่กันเสมอ
- Client preview เทิร์น: `bonusPct` มากับ `GET questions` response (โชว์ก่อนกด quote ได้)
- **Lead tracking:** คง `track('Lead', { type: 'buyback', ... })` shape เดิม + เพิ่ม field `flow` (ห้าม re-key GA4/Pixel — เหตุการณ์นี้เคยหลุดใน #1360 มารอบหนึ่งแล้ว)

### 4.3 Landing + nav + copy
- Nav/Footer: ลบ 2 ลิงก์เดิม → `{ to: '/sell', label: 'ขาย/เทิร์น iPhone' }` ตัวเดียว
- HomePage: SERVICE_ITEMS 3→2 การ์ด **+ แก้ grid `sm:grid-cols-3` → `sm:grid-cols-2`** (HomePage.tsx:174); copy keys `home.serviceTradeIn*`/`serviceBuyback*` → `home.serviceSell*`
- copy.ts: block `buyback` → rename `sell` + keys ใหม่ (`cashOption`, `exchangeOption`, `bonusBadge`, `exchangeCreditNote`); block `tradeIn` ลบ (grep ยืนยันไร้ผู้ใช้ก่อนลบ)
- sitemap.xml: แทน `/trade-in` + `/buyback` ด้วย `/sell`; usePageMeta หน้าใหม่

### 4.4 Status page (`/sell/:id`)
- **Key จาก `data.flow` (top-level จาก getStatus — ทนกว่า `quoteBreakdown.chosenFlow` ซึ่งอาจถูก REVISED เขียนใหม่)** + `Buyback` type เพิ่ม `flow: 'BUYBACK' | 'EXCHANGE'` และ breakdown fields ใหม่
- Instant records: header/stepper ตาม flow — BUYBACK "เข้าร้านตรวจเครื่อง รับเงินสด" / EXCHANGE "เข้าร้านตรวจเครื่อง เลือกเครื่องใหม่ (ใช้เครดิตเป็นส่วนลด)"; breakdown + **บรรทัดโบนัสเมื่อ EXCHANGE** (เลขบวกลงตัว); **REJECTED label แยก flow** ("ไม่รับซื้อ" / "ไม่รับเทิร์น"); breadcrumb → `/sell`
- Legacy records (ไม่มี quoteBreakdown — ครอบทั้ง EXCHANGE เก่า (มีรูป/แบต) และ BUYBACK ก่อน #1360): mode เดิมทุกอย่าง
- ลบ dead block `data.notes` (getStatus ไม่เคย select notes — ตั้งใจ PII-lean)

### 4.5 ลบทิ้ง (ระบุชื่อไฟล์)
`pages/trade-in/` ทั้ง 3 ไฟล์, `components/device-submit/` ทั้ง 4 ไฟล์, `types/trade-in.ts`, `hooks/useSignedUpload.ts` (0 ผู้ใช้หลังลบ PhotoUploadGrid — BANK_SLIP/REVIEW_PHOTO ไม่มีผู้เรียกจริง), copy `tradeIn` block — จบด้วย `grep -rn "TRADE_IN_PHOTO\|device-submit\|types/trade-in\|useSignedUpload" apps/web-shop/src` = ว่าง
- **e2e:** ลบ block trade-in ใน `apps/web/e2e/shop-phase3-apply.spec.ts` (describe.skip ค้าง — จะกลายเป็นซากถาวร) — **ห้ามแตะ** e2e `/trade-in` ของแอป staff 3 ไฟล์ (`trade-in-flow`, `advanced-operations`, `page-health-check`) — คนละแอป path บังเอิญซ้ำ

## 5. API (apps/api — path `/shop/buyback/*` คงเดิม ถือเป็น API ภายในของหน้า /sell)

### 5.1 shop-buyback
- `BuybackPricingService.applyExchangeBonus(cash: Decimal, bonusPct: Decimal): Decimal` — `cash.mul(HUNDRED.plus(pct)).div(HUNDRED)` → floor หลักสิบ
- `ShopBuybackService.getBonusPct()` ผ่าน readNumberFlag (§3); `getQuestions()` + `quoteForAnswers()` ตอบ 2 ราคา + bonusPct; `submit` ตาม §3
- `quoteForAnswers` เพิ่ม optional param `flow` (default BUYBACK) → คืน `price` ตาม flow (ให้ REVISED ใช้ซ้ำได้) — breakdown ภายในตาม invariant §3
- `getStatus`: เพิ่ม `deletedAt: null` ใน where (ปิดรู record ลบแล้ว/กันหน้า public เสิร์ฟ record ที่ไม่ควรเห็น — พฤติกรรม 404 เดิมสำหรับ id มั่ว)

### 5.2 Admin config (trade-in module, เหนือ `:id`)
| Method | Path | Roles |
|---|---|---|
| GET `/trade-ins/sell-config` | `{ exchangeBonusPct }` | OWNER, BM, SALES |
| PUT `/trade-ins/sell-config` | `@Min(0) @Max(100)`; upsert SystemConfig + **`deletedAt: null` ใน update branch** (กัน soft-delete ค้างทำให้ readNumberFlag มองไม่เห็น) + label ไทย | OWNER, BM |

### 5.3 ปลดระวาง shop-trade-in
- ลบ **6 ไฟล์ระบุชื่อ**: `shop-trade-in.service.ts`, `shop-trade-in.service.spec.ts`, `trade-in-intake.service.ts`, `trade-in-intake.module.ts`, `dto/estimate.dto.ts`, `dto/submit.dto.ts`
- `shop-trade-in.controller.ts` → 410 stub 3 routes (estimate/submit/:id) ไม่ inject อะไร; `shop-trade-in.module.ts` → `@Module({ controllers: [ShopTradeInController] })` เท่านั้น; **`app.module.ts` ไม่ต้องแตะ** (ShopTradeInModule ยังอยู่เป็นโฮสต์ stub — ถ้าถอด import stub จะกลายเป็น 404)
- อัปเดต **comment เก่า 3 จุด** ที่อ้าง "ห้ามแตะ TradeInIntakeService" (shop-buyback.service.ts:30-31, buyback-pricing.service.ts:27, shop-buyback.module.ts:9) — พันธะนั้นสิ้นสุดที่ spec นี้ → grep gate `grep -rn "TradeInIntakeService\|trade-in-intake" apps/api/src` = ว่างได้จริง
- `shop-upload.controller.ts`: ถอด `TRADE_IN_PHOTO` จาก `PUBLIC_UPLOAD_KINDS` (คง enum; staff-JWT route ไม่กระทบ) + **แก้ spec upload 2 จุด**: ย้าย TRADE_IN_PHOTO จาก accept-list ไป reject-list และ**ย้าย MIME-whitelist test ไปใช้ BANK_SLIP** (ไม่งั้น test ผ่านแต่ไม่ได้ test MIME branch อีกต่อไป)
- Release ถัดไป (นัดรวมกับ quick-quote 410): ลบ module จริง + อัปเดต `.claude/rules/security.md` รายการ public endpoints

## 6. ขอบเขตการลบ (กัน grep-collision)

**ลบเฉพาะ path ที่ระบุใน §4.5 + §5.3 เท่านั้น** — ห้ามลบตาม grep คำว่า `shop-trade-in`/`trade-in` เพราะชนของจริงที่ต้องอยู่:
- `apps/api/src/modules/journal/cpa-templates/shop-trade-in.template.ts` + `journal.module.ts` + `metadata.flow='shop-trade-in'` ใน `trade-in-lifecycle.service.ts` — **JE template ของ walk-in accept (red line บัญชี)**
- `apps/api/src/modules/trade-in/**` — module staff ทั้งตัว
- e2e staff 3 ไฟล์ (§4.5), `legal-case.service.spec.ts` (fixture string บังเอิญมีคำ)

## 7. Staff seams (จาก scrutinize — หัวใจของความถูกต้องเชิงเงิน)

### 7.1 Invariant การแสดงผล
ทุกจุดที่โชว์ราคา instant record ต้องอ่าน **`quoteBreakdown.price`/`estimatedValue` (= ราคาทาง flow)** เป็น headline และมี **flow badge**:
- `TradeInTable`: เพิ่ม badge เทิร์น/รับซื้อ ต่อแถว (field `flow` มีใน list แล้ว) — กัน staff อ่าน ฿13,660 เทิร์นเป็นเงินสดจ่ายจริง
- `OnlineAppraiseModal`: โชว์ flow badge + **2 ราคา** (cashPrice / exchangePrice จาก breakdown) + copy AS_ANSWERED อ้าง estimatedValue; **ปุ่มใหม่ "ลูกค้าไม่ซื้อเครื่อง — ใช้ราคาเงินสด"** (เฉพาะ record EXCHANGE): ส่ง `mode: 'AS_ANSWERED', useCashPrice: true`
- `TradeInDetailDialog`: โชว์ flow + 2 ราคา + บรรทัดโบนัส (เลขบวกลงตัว)

### 7.2 appraise-online (OnlineAppraisalService)
- `AS_ANSWERED`: เดิม (estimatedValue = ราคาทาง flow อยู่แล้ว) + รองรับ `useCashPrice?: boolean` — เมื่อ true บน record EXCHANGE: `offeredPrice = quoteBreakdown.cashPrice`, และ **flip `TradeIn.flow` → BUYBACK + `quoteBreakdown.chosenFlow` → BUYBACK** (ข้อมูลตรงความจริง; AuditInterceptor เก็บ log อยู่แล้ว)
- `REVISED`: คิดใหม่ด้วย `quoteForAnswers(..., record.flow)` — **โบนัสใช้ % ปัจจุบัน** (semantics: REVISED = สภาพไม่ตรงที่ตอบ → สัญญาเดิมโมฆะ คิดตามกติกาวันนี้ สอดคล้อง base/deduct ที่ใช้ค่าปัจจุบันอยู่แล้ว; AS_ANSWERED คือเส้นรักษาสัญญา) + breakdown ใหม่ **re-stamp `chosenFlow` จาก record.flow** — test: REVISED บน EXCHANGE ต้องได้ราคารวมโบนัส + chosenFlow ไม่หาย
- `MANUAL`: เดิม
- หมายเหตุ analytics: `basePriceAtAppraisal` ยัง = maxPrice (ฐานเงินสด) — deviation ของ EXCHANGE ให้อ่านคู่ `breakdown.cashPrice` (ยังไม่มี reader จริง — note ไว้เฉยๆ)

### 7.3 (สงวนเลขข้อ — รวมใน 7.1/7.2 แล้ว)

### 7.4 accept() — ต้นทุนสต็อก (นโยบาย §1.5)
`trade-in-lifecycle.service.ts` accept(): สำหรับ record ที่มี `quoteBreakdown.cashPrice` (instant ทุก flow) —
**`Product.costPrice = quoteBreakdown.cashPrice`** (ไม่ใช่ `offeredPrice` ซึ่งอาจรวมโบนัส) ; record อื่น (walk-in/legacy) = พฤติกรรมเดิม (`offeredPrice ?? estimatedValue`)
- Test: accept EXCHANGE instant (offered 13,660, cash 12,420) → Product.costPrice = 12,420; accept BUYBACK instant → costPrice = cash (= offered); walk-in → เดิม
- Voucher พิมพ์ `offeredPrice` เดิม (มูลค่าเครดิตที่ตกลง) — ถูกต้องตามเอกสารต่อลูกค้า
- ห้ามแตะ JE template (`ShopTradeInTemplate` รับ amount จาก caller — caller ส่ง cost เดิมอยู่แล้ว ตรวจใน plan ว่า amount ที่ post = costPrice ใหม่)

## 8. Error handling / ขอบเคส

| กรณี | พฤติกรรม |
|---|---|
| bonus config หาย/พัง/นอกช่วง | default 10 + warn (readNumberFlag) |
| bonus เปลี่ยนระหว่าง quote↔submit | submit recompute จากค่าปัจจุบัน |
| bundle เก่า submit ไม่ส่ง flow | default BUYBACK — พฤติกรรมเดิมเป๊ะ |
| bundle เก่าเรียก questions/quote | response เพิ่ม field แบบ additive — ไม่พัง |
| ลิงก์เก่า /trade-in/:id | redirect → /sell/:id → getStatus (no flow filter) ✓ |
| record ลบแล้ว (deletedAt) | getStatus 404 (ไม่พบคำขอ) |
| ลูกค้าเทิร์นแต่ไม่ซื้อเครื่อง | staff กด "ใช้ราคาเงินสด" → flip flow + ราคา cash (§7.2) |
| bonusPct = 0 | สองทางราคาเท่ากัน — UI ยังโชว์ 2 ตัวเลือก, badge ซ่อนเมื่อ 0 |

## 9. Testing

- Jest: applyExchangeBonus goldens (13,660 / @0% / ปัดหลักสิบ / Decimal-safe); getBonusPct (missing/invalid/clamp→default); quote 2 ราคา; submit ทั้ง 2 flow (invariant price==estimatedValue, chosenFlow, flex per-flow); REVISED-on-EXCHANGE (โบนัสปัจจุบัน + chosenFlow คงอยู่); AS_ANSWERED useCashPrice (flip flow + ราคา cash); accept costPrice 3 เคส (§7.4); sell-config GET/PUT + routing เหนือ `:id`; 410 stubs; upload spec 2 จุด
- Frontend: **build web-shop = gate บังคับ** (CI เพิ่ม step ด้วย — §2); browser pass ทั้ง 2 ทาง × 2 viewport, redirect 7 เส้น (+ ตรวจ query string ส่งต่อ), status 4 ยุค record, แอดมินแก้โบนัส → ราคาเปลี่ยน, staff badge/modal/detail, ปุ่มถอยเงินสด
- Regression: trade-in module suites เดิมเขียว (walk-in ไม่กระทบ), journal shop-templates suites เขียว (ห้ามแตะ)

## 10. Rollout

1. Deploy เดียวจบ (ไม่มี migration); โบนัสก่อนตั้งค่า = default 10%
2. Owner: ตั้งโบนัสจริง + ตรวจ copy + (ค้างจาก #1360) กรอกราคาจริงในตารางราคากลาง
3. แจ้ง staff: เทิร์น = เครดิตส่วนลด ห้ามจ่ายสดตามเลขเทิร์น — มีปุ่มถอยเงินสดใน modal
4. Release ถัดไป: ลบ shop-trade-in module จริง + quick-quote 410 + อัปเดต security.md
