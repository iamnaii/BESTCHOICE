# รวมรับซื้อ+เก่าแลกใหม่เป็น "ขาย/เทิร์น iPhone" ที่ /sell — Design

**วันที่:** 2026-07-18
**สถานะ:** อนุมัติแล้ว (owner, 2026-07-18)
**ต่อยอดจาก:** spec 2026-07-17 buyback-iphone-instant-quote (PR #1360, merged+deployed)

## 1. เป้าหมาย

ยุบ `/trade-in` (เก่าแลกใหม่ flow เก่า: ทุกยี่ห้อ, เกรด A/B/C, รูปถ่าย, รอ staff 24 ชม.)
เข้ากับ instant-quote wizard ที่เพิ่งสร้าง → เหลือ **flow เดียวที่ `/sell`**:
ลูกค้าตอบแบบประเมิน → เห็น **2 ราคา** (เงินสด / เทิร์น ซึ่งสูงกว่า) → เลือกทาง → นัดเข้าร้าน

การตัดสินใจของ owner (2026-07-18):
1. **ยุบเหลือ instant-quote ตัวเดียว** — flow เก่าของ trade-in ตายทั้งหมด
2. **iPhone อย่างเดียว** ทั้งขายและเทิร์น — ยี่ห้ออื่น = ปุ่มทักไลน์
3. ราคาเทิร์น = ราคาเงินสด × (1 + **โบนัส % ที่ตั้งค่าได้ในแอดมิน**)
4. URL ใหม่ **`/sell`** — `/buyback*` และ `/trade-in*` ทุกเส้น redirect มา

## 2. Scope / Non-goals

**In scope**
- web-shop: routes `/sell`, `/sell/quote`, `/sell/:id` + redirects; wizard เพิ่ม dual-price + เลือก flow; landing ใหม่; nav/footer/home เหลือลิงก์เดียว; ลบหน้า trade-in 3 หน้า + `components/device-submit/` ทั้ง dir
- api: quote/submit รองรับ EXCHANGE + โบนัส; SystemConfig `sell_exchange_bonus_pct`; admin GET/PUT config; **ปลดระวาง shop-trade-in module** (410 หนึ่ง release แล้วค่อยลบจริง) + ลบ `TradeInIntakeService`; ถอด `TRADE_IN_PHOTO` จาก public presign
- แอดมิน staff: ช่องแก้โบนัสเทิร์น % ในแท็บ "แบบประเมินออนไลน์"
- sitemap: `/trade-in`,`/buyback` → `/sell`

**Non-goals (ไม่แตะ)**
- ❌ **ไม่มี migration** — schema เดิมพอ (ราคาเทิร์นอยู่ใน `quoteBreakdown` JSON; โบนัสอยู่ใน SystemConfig)
- Flow walk-in ของ staff (`/trade-ins` create/appraise/accept/quick-buy) — เดิมทุกอย่าง
- appraise-online handshake — ใช้กับ record EXCHANGE ได้ทันทีโดยไม่แก้ (ราคา snapshot = ราคาทางที่ลูกค้าเลือกแล้ว)
- บัญชี, ตารางราคากลาง (ราคาเกรด A ยังเป็นฐานเดียว), targetProductId (flow เก่าเคยมี — ตัดทิ้ง ลูกค้าเลือกเครื่องใหม่ที่ร้าน)

## 3. Pricing (ส่วนขยายจากสูตรเดิม)

```
cashPrice     = สูตรเดิม (max − Σfixed) × (1 − Σ%/100) ปัดลงหลักสิบ
exchangePrice = floor(cashPrice × (1 + bonusPct/100) / 10) × 10
```
- `bonusPct` อ่านจาก SystemConfig key **`sell_exchange_bonus_pct`** (default **10**, ไม่มี row = ใช้ default; validate 0–100)
- Decimal ล้วนเหมือนเดิม; golden: cash 12,420 @10% → **13,660** (12,420×1.1=13,662 → ปัดลงหลักสิบ)
- `POST quote` ตอบเพิ่ม: `exchangePrice`, `bonusPct` (เดิม `price` = cash คงชื่อไว้)
- `POST submit` รับ field ใหม่ `flow: 'BUYBACK' | 'EXCHANGE'` (บังคับ) → server recompute แล้วใช้ราคาตามทาง:
  `estimatedValue` = ราคาทางที่เลือก; `quoteBreakdown` เพิ่ม `{ cashPrice, exchangePrice, bonusPct, chosenFlow }`;
  `TradeIn.flow` = ตามเลือก; flex LINE copy ตาม flow ("รับซื้อ ฿X — นัดเข้าร้าน" / "เทิร์นแลกเครื่องใหม่ มูลค่า ฿Y — มาเลือกเครื่องที่ร้าน")

## 4. UX (apps/web-shop)

### 4.1 Routes + redirects
| Route | เป็น |
|---|---|
| `/sell` | landing ใหม่ "ขาย/เทิร์น iPhone รู้ราคาใน 1 นาที" (โครงเดิมของ BuybackLandingPage + section อธิบาย 2 ทางเลือก + trust) |
| `/sell/quote` | wizard (ย้าย+ขยาย BuybackQuotePage) |
| `/sell/:id` | status (ย้าย BuybackStatusPage) |
| `/buyback` → `/sell`, `/buyback/quote` → `/sell/quote`, `/buyback/submit` → `/sell/quote`, `/buyback/:id` → `/sell/:id` (คง param) | `<Navigate replace>` |
| `/trade-in` → `/sell`, `/trade-in/submit` → `/sell/quote`, `/trade-in/:id` → `/sell/:id` | `<Navigate replace>` |

หมายเหตุ: react-router `<Navigate>` กับ param ใช้ wrapper component เล็กๆ อ่าน useParams แล้วสร้าง path ใหม่

### 4.2 Wizard: Step 3 dual-price + เลือกทาง
- หลังกด "ดูราคารับซื้อ" (เปลี่ยน label เป็น "ดูราคา") → การ์ดผลลัพธ์แสดง **2 แถวราคา**:
  💵 ขายรับเงินสด `฿{price}` · 🔄 เทิร์นแลกเครื่องใหม่ `฿{exchangePrice}` + badge `+{bonusPct}%` (เน้นแถวเทิร์นให้เด่น — จูงใจ)
- ใต้ราคา: ปุ่มเลือก 2 ทาง (radio-card แบบเดียวกับ choice ใน questionnaire) → state `chosenFlow` → breakdown เดิมแสดงต่อท้าย + บรรทัดโบนัสเมื่อเลือกเทิร์น
- Step 4 เดิม (ชื่อ/เบอร์/IMEI/วันเข้าร้าน) + ปุ่ม submit label ตาม flow ("ยืนยันขาย — รับเงินสดที่ร้าน" / "ยืนยันเทิร์น — มาเลือกเครื่องที่ร้าน"); payload เพิ่ม `flow`
- Client preview เดิมคำนวณ cash — เพิ่มบรรทัดเทิร์น preview จาก bonusPct ที่ได้จาก quote/questions response (ให้ GET questions ตอบ bonusPct มาด้วยเพื่อ preview ก่อนกด quote)

### 4.3 Landing + nav + copy
- Nav `ShopHeader` NAV_LINKS: ลบ `เก่าแลกใหม่` + `รับซื้อ iPhone` → เพิ่ม `{ to: '/sell', label: 'ขาย/เทิร์น iPhone' }` ตัวเดียว; `ShopFooter` เช่นกัน
- HomePage SERVICE_ITEMS: 3 การ์ด → 2 การ์ด (ซื้อ/ผ่อน + ขาย/เทิร์น iPhone `to: '/sell'`); copy keys `home.serviceTradeIn*`/`serviceBuyback*` → แทนด้วย `home.serviceSell*`
- copy.ts: block `buyback` → rename เป็น `sell` (คีย์เดิมที่ยังใช้ + `exchangeOption`, `cashOption`, `bonusBadge`, flex-เกี่ยวข้อง); block `tradeIn` ลบทั้งก้อน (ตรวจ grep ไม่เหลือผู้ใช้)
- usePageMeta/SEO ของหน้า sell; sitemap.xml: แทน 2 entries เดิมด้วย `/sell`

### 4.4 Status page (`/sell/:id`)
- ใช้ `flow` จาก getStatus: header/stepper copy ตาม flow — BUYBACK: "เข้าร้านตรวจเครื่อง รับเงินสด" / EXCHANGE: "เข้าร้านตรวจเครื่อง เลือกเครื่องใหม่"; แสดง `quoteBreakdown.chosenFlow`+ราคา 2 ทางถ้ามี
- Record เก่าทุกแบบยังแสดงได้: online-EXCHANGE เก่า (มีรูป/แบต ไม่มี quoteBreakdown) = mode เดิม "รอทีมงานประเมิน"; instant BUYBACK จาก PR #1360 = เดิม

### 4.5 ลบทิ้ง (หลังไม่มีผู้ใช้)
`pages/trade-in/{TradeInLandingPage,TradeInSubmitPage,TradeInStatusPage}.tsx`, `components/device-submit/` ทั้ง dir (DeviceSelector+CATALOG, DeviceSpecForm, PhotoUploadGrid, ValuationDisplay), `types/trade-in.ts`, `UploadKind` เหลือ `'BANK_SLIP' | 'REVIEW_PHOTO'` — จบด้วย `grep -rn "TRADE_IN_PHOTO\|device-submit\|types/trade-in" apps/web-shop/src` = ว่าง

## 5. API (apps/api)

### 5.1 shop-buyback (ขยาย — ชื่อ module/path `/shop/buyback/*` คงเดิม ไม่ rename เพื่อไม่ทำ churn; ถือเป็น API ภายในของหน้า /sell)
- `BuybackPricingService` เพิ่ม `applyExchangeBonus(cashPrice: Decimal, bonusPct: Decimal): Decimal` (×(1+pct/100) ปัดลงหลักสิบ)
- `ShopBuybackService`:
  - `getBonusPct()`: อ่าน SystemConfig `sell_exchange_bonus_pct` → Decimal (default 10, clamp 0–100, value ไม่ใช่ตัวเลข → default + warn)
  - `getQuestions()` ตอบเพิ่ม `bonusPct`
  - `quoteForAnswers()` ตอบเพิ่ม `exchangePrice`, `bonusPct`; breakdown เพิ่ม `cashPrice/exchangePrice/bonusPct`
  - `submit(dto)` — dto เพิ่ม `flow` (`@IsOptional() @IsIn(['BUYBACK','EXCHANGE'])` **default `'BUYBACK'`** — bundle เก่าจาก PR #1360 ที่ไม่ส่ง flow ได้พฤติกรรมเดิมเป๊ะ ไม่มีหน้าต่างพัง); `estimatedValue` = ราคาทาง flow; `quoteBreakdown.chosenFlow`; `TradeIn.flow`; flex ตาม flow
  - `getStatus` — มี `flow` อยู่แล้ว (ไม่แก้ select)
- ตรวจ appraise-online: AS_ANSWERED ใช้ `estimatedValue` (ราคาทางที่เลือก) ✓ ไม่แก้; REVISED recompute → ราคา **ทาง flow ของ record** (เพิ่ม: OnlineAppraisalService ส่ง flow ของ record เข้า recompute หรือคูณโบนัสเมื่อ record.flow=EXCHANGE — ระบุใน plan; test ครอบ)

### 5.2 Admin config endpoint (trade-in module — ข้าง buyback-questions CRUD, ประกาศเหนือ `:id`)
| Method | Path | Roles | ทำอะไร |
|---|---|---|---|
| GET | `/trade-ins/sell-config` | OWNER, BM, SALES | `{ exchangeBonusPct: number }` |
| PUT | `/trade-ins/sell-config` | OWNER, BM | body `{ exchangeBonusPct }` (`@Min(0) @Max(100)`) → upsert SystemConfig + label ไทย |

### 5.3 ปลดระวาง shop-trade-in module
- `shop-trade-in.controller.ts` → เหลือ 3 stub ตอบ **410** ("เวอร์ชันหน้าเว็บเก่าเกินไป กรุณารีเฟรช"): `POST estimate`, `POST submit`, `GET :id` — คง 1 release แล้วลบทั้ง module รอบหน้า
- **ลบ**: `shop-trade-in.service.ts`, `trade-in-intake.service.ts`, `trade-in-intake.module.ts`, DTO เก่า, spec เก่าทั้งหมดของ module (`shop-trade-in.service.spec.ts`, ฯลฯ) — ข้อผูกพัน "intake ห้ามแตะ" ของ spec ก่อนหน้า**สิ้นสุดที่ spec นี้** (module ถูก retire อย่างเป็นทางการ)
- ตรวจไม่มีใคร import `TradeInIntakeService` เหลือ (`grep -rn "TradeInIntakeService\|trade-in-intake" apps/api/src` ต้องเหลือแค่ shop-trade-in เอง → ลบพร้อมกัน)
- `shop-upload.controller.ts`: ถอด `TRADE_IN_PHOTO` จาก `PUBLIC_UPLOAD_KINDS` (คง enum ให้ record เก่า) + แก้ spec ของ controller ตาม
- `app.module.ts`: ถอด import module ที่ลบ (ShopTradeInModule เหลือ stub controller — ตรวจชื่อ module จริงตอน implement)

## 6. Error handling / ขอบเคส

| กรณี | พฤติกรรม |
|---|---|
| bonusPct config หาย/พัง | ใช้ default 10 + log warn — quote ไม่ล้ม |
| bonus เปลี่ยนระหว่าง quote กับ submit | submit recompute จากค่าปัจจุบัน (เหมือนราคา valuation เดิม) |
| submit ไม่ส่ง flow (bundle เก่าจาก PR #1360 ที่ cache ค้าง) | default `'BUYBACK'` — พฤติกรรมเดิมเป๊ะ ไม่มี break |
| record EXCHANGE เก่า (photos, ไม่มี quoteBreakdown) | status page mode เดิม; staff appraise เดิม (valuation-band) — ไม่เปลี่ยน |
| ลิงก์เก่า /trade-in/:id ใน LINE ลูกค้า | redirect → /sell/:id → getStatus ตอบได้ทุก flow ✓ |

## 7. Testing

- Jest: `applyExchangeBonus` golden (12,420 @10% → 13,660; @0% → เท่าเดิม; ปัดหลักสิบ); getBonusPct (missing/invalid/clamp); quote ตอบครบ 2 ราคา; submit ทั้ง 2 flow (estimatedValue+flow+chosenFlow ถูก); REVISED กับ record EXCHANGE คิดโบนัสถูก; sell-config GET/PUT + routing (เหนือ `:id`); 410 stubs; upload allowlist
- Frontend: build; browser pass — เดินทั้ง 2 ทาง (เงินสด/เทิร์น) desktop+mobile, redirect ทุกเส้น (6 เส้น), status ทุก mode (ใหม่ 2 flow + เก่า 2 แบบ), แก้โบนัสในแอดมิน → ราคาเทิร์นเปลี่ยน
- Regression: staff walk-in appraise/accept เดิมเขียว; `/trade-ins` specs เดิมเขียว

## 8. Rollout

1. Deploy เดียวจบ (ไม่มี migration); SystemConfig สร้างเองตอน PUT ครั้งแรก (ก่อนนั้นใช้ default 10)
2. Owner ตั้งโบนัสเทิร์น % จริงในแท็บแบบประเมินออนไลน์ + ตรวจ copy landing
3. Release ถัดไป: ลบ shop-trade-in stub + quick-quote 410 เดิม (นัดรวมกัน)
4. ราคา valuations ยังใช้ชุดเดียวกับที่ owner ต้องกรอก (งานค้างจาก PR #1360)
