# รับซื้อ iPhone รู้ราคาทันที (yellobe-style instant quote) — Design

**วันที่:** 2026-07-17
**สถานะ:** อนุมัติแล้ว (owner) + แก้ไขตามผล scrutinize (24-agent trace, 2026-07-17)
**ขอบเขต:** web-shop `/buyback` + shop-buyback API + แอดมิน valuations/questionnaire + appraise handshake

## 1. เป้าหมาย

เปลี่ยนหน้ารับซื้อ (`/buyback`) จาก "เกรด A/B/C → ช่วงราคา → ส่งรูป → รอ staff ตีราคา 24 ชม."
เป็นแบบ yellobe.com: **ลูกค้าตอบแบบประเมินสภาพ → เห็นราคารับซื้อเป็นเลขเดียวทันที → ยืนยัน →
มารับเงินสดที่ร้าน** โดย**รับซื้อออนไลน์เฉพาะ iPhone เท่านั้น**

การตัดสินใจของ owner (2026-07-17):
1. รับซื้อออนไลน์**เฉพาะ iPhone** — ตัดยี่ห้ออื่นออกจากหน้า /buyback
2. แสดงราคาเป็น**เลขเดียว** (ไม่ใช่ช่วง min–max) + ตาราง breakdown การหัก
3. ตารางหักราคาเก็บใน **DB + มีหน้าแอดมิน** แก้ได้โดยไม่ต้อง deploy
4. ช่องทางรับซื้อ = **มาที่ร้าน** (ไม่มีบริการรับถึงบ้าน) — ลูกค้าส่งชื่อ/เบอร์/วันที่สะดวกไว้ staff ติดต่อกลับ

## 2. หลักการ yellobe ที่นำมาใช้ (แกะจากระบบจริง 2026-07-17)

- Funnel: เลือกรุ่น+ความจุ → เห็น "ราคาสูงสุด" ทันที → ตอบแบบประเมินสภาพ → ราคาจริงทันที ไม่ต้องรอคน ไม่ต้องถ่ายรูป
- สูตรราคา (ยืนยันด้วยการยิงระบบจริง: iPhone 15 128GB max ฿14,500, ตอบ "รอยนิดหน่อย 8% + หมดประกัน ฿500 + ไม่มีกล่อง ฿500" → ฿12,420):

```
ราคารับซื้อ = (ราคาสูงสุด − Σ หักบาทคงที่) × (1 − Σ %หัก / 100)
```

- โครงคำถาม: 7 กลุ่มเลือกตอบเดียว + 1 กลุ่มปัญหาการใช้งานเลือกได้หลายข้อ
- การหักมี 2 ชนิด: **บาทคงที่** (ประกัน/แบต/กล่อง/เครื่องนอก) และ **เปอร์เซ็นต์** (สภาพตัวเครื่อง/จอ/ปัญหาการใช้งาน)
- ราคาที่เห็นออนไลน์ = ข้อเสนอเบื้องต้น ยืนยันจริงตอนตรวจเครื่องหน้าร้าน; ลูกค้าปฏิเสธขายได้ฟรี

## 3. Scope / Non-goals

**In scope**
- Backend: model `BuybackQuestion`/`BuybackChoice` + seed, pricing engine ใหม่ (Decimal), endpoint catalog/questions/quote/submit, field ใหม่บน `TradeIn`, **appraise handshake สำหรับ online quote (§7.4)**, แก้ route-shadowing เดิมใน trade-in controller (§6.3)
- web-shop: เขียน `/buyback` landing ใหม่, `/buyback/quote` เป็น wizard iPhone-only, ตัด `/buyback/submit` (redirect), ปรับ `/buyback/:id` (§4.4)
- apps/web (staff): **สร้าง** หน้า valuations CRUD + แท็บ questionnaire editor + TradeIn detail dialog (§8 — ของเดิมไม่มี ต้องสร้างใหม่ทั้งหมด)
- Storage: ถอด `BUYBACK_PHOTO` ออกจาก `PUBLIC_UPLOAD_KINDS` (ช่อง presign นิรนามที่จะไร้ผู้เรียก — คง enum value ไว้ให้ record เก่า) + ถอดจาก web-shop `UploadKind` union

**Non-goals (ไม่แตะ)**
- `/trade-in` (เก่าแลกใหม่) — คงเดิมทุกยี่ห้อ เกรด A/B/C; **`TradeInIntakeService` ต้องคงเดิม byte-identical** (§7.5)
- Flow รับซื้อหน้าร้านของ staff สำหรับ record ที่ไม่มี quoteBreakdown (walk-in / online แบบเก่า) — appraise เดิมทุกอย่าง
- บริการรับถึงบ้าน / ส่งไปรษณีย์
- บัญชี (ShopTradeInTemplate ยัง deferred ตาม Phase A.5)
- Backfill ข้อมูลเดิม — forward-only

## 4. UX (apps/web-shop)

### 4.1 `/buyback` — Landing (เขียนใหม่)
- Hero: "ขาย iPhone รู้ราคาใน 1 นาที" + CTA เช็คราคา
- 3 ขั้นตอน: ① เช็คราคาออนไลน์ → ② ยืนยันการขาย → ③ มาที่ร้าน ตรวจเครื่อง รับเงินสดทันที
- Trust: ราคามาตรฐานไม่ต้องต่อรอง / ตรวจเครื่องต่อหน้า ปฏิเสธขายได้ / ลบข้อมูลให้ฟรี / ใช้บัตรประชาชนใบเดียว

### 4.2 `/buyback/quote` — Wizard (แทน BuybackQuickQuotePage เดิม)
- **Step 1 เลือกเครื่อง:** รุ่น + ความจุ (dropdown จาก `GET /api/shop/buyback/catalog`)
  → เห็น "ราคารับซื้อสูงสุด ฿XX,XXX" ทันที
  - หมายเหตุ: wizard นี้**เลิกใช้** `DeviceSelector`/CATALOG hardcode — แต่ component เดิม**คงไว้**ให้ `TradeInSubmitPage` (trade-in ยังใช้)
- **Step 2 ประเมินสภาพ:** คำถาม 8 กลุ่มจาก `GET /api/shop/buyback/questions` (accordion เปิดทีละข้อแบบ yellobe) + ราคา preview อัปเดตสด client-side
- **Step 3 ผลประเมิน:** ราคาเลขเดียวตัวใหญ่ + ตาราง breakdown + หมายเหตุ
  "ยืนยันราคาจริงตอนตรวจเครื่องที่ร้าน หากสภาพตรงตามที่ตอบ" → CTA "ยืนยันขาย"
- **Step 4 ส่งข้อมูล:** ชื่อ, เบอร์โทร (บังคับ), IMEI (ไม่บังคับ), วันที่สะดวกเข้าร้าน (ไม่บังคับ), หมายเหตุ
  — **ไม่ต้องถ่ายรูป** — แสดงที่อยู่/เวลาเปิดร้านจาก `shopInfo` → submit → success + LINE flex
- รุ่น/ความจุที่ไม่มีราคาในตาราง → "รุ่นนี้ยังไม่เปิดรับซื้อออนไลน์ ทักไลน์สอบถามได้" + ปุ่ม LINE OA

### 4.3 Copy checklist (ครบทุกจุด — ตกข้อใดข้อหนึ่งจะเหลือข้อความยุค 24 ชม./ส่งรูป ค้างบนเว็บ)
- `copy.ts` `buyback.*`: `pageTitle` (→ "รับซื้อ iPhone"), `description`, `quoteCta`, `submitCta`, `submitSuccess` (ตัด "ภายใน 24 ชั่วโมง"), `followUp` (→ นัดเข้าร้าน), ลบ `stepPhotos`, `realPriceCta` ("ส่งรูปเพื่อราคาจริง"), `photosRequired`
- `copy.ts` `home.serviceBuybackTitle`/`serviceBuybackDescription` (HomePage SERVICE_ITEMS)
- Hardcode 3 จุด: `ShopHeader.tsx` NAV_LINKS "รับซื้อมือถือ" → "รับซื้อ iPhone", `ShopFooter.tsx` คอลัมน์บริการ, meta ของ BuybackLandingPage

### 4.4 Routes + หน้า status
| Route | การเปลี่ยนแปลง |
|---|---|
| `/buyback` | landing ใหม่ |
| `/buyback/quote` | wizard 4 step ข้างบน |
| `/buyback/submit` | ลบหน้า — `<Navigate to="/buyback/quote" replace />` (กันลิงก์เก่า) |
| `/buyback/:id` | แก้ตามรายการล่างนี้ |

`BuybackStatusPage` ต้องแก้จริง (ไม่ใช่ "คงเดิม"):
- Record ที่มี `quoteBreakdown` → stepper/copy ใหม่: "ยืนยันราคาแล้ว ฿X → เข้าร้านตรวจเครื่อง → เสร็จสิ้น" + แสดง breakdown; **ห้าม**แสดง "รอทีมงานประเมินราคา…ติดต่อกลับภายใน 24 ชั่วโมง" (copy เดิม)
- Record เก่า (ไม่มี quoteBreakdown) → แสดงแบบเดิม
- Guard null: `batteryHealth` เป็น null ใน flow ใหม่ → ซ่อนบรรทัดแบต; type `types/buyback.ts` ขยายเป็น `deviceCondition: 'A'|'B'|'C'|'D'|null`, `batteryHealth: number|null`
- จำนวนเงินจาก API เป็น Decimal-string — ใช้ pattern แปลงเดิมของหน้านี้
- สถานะ DB ยังเป็น `PENDING_APPRAISAL` (ไม่เพิ่ม enum) — UI แยกด้วยการมี `quoteBreakdown`

## 5. Data model (apps/api — migration ถัดไป ≥ `20260980000000`)

### 5.1 Model ใหม่

```prisma
enum BuybackDeductType {
  PERCENT
  FIXED
}

enum BuybackSelectType {
  SINGLE
  MULTI
}

model BuybackQuestion {
  id         String            @id @default(uuid())
  key        String            @unique // slug เช่น "body-condition"
  title      String            // "สภาพตัวเครื่อง"
  helpText   String?           // คำอธิบาย/วิธีเช็ค เช่น "Settings > Battery > Battery Health"
  selectType BuybackSelectType @default(SINGLE)
  sortOrder  Int               @default(0)
  isActive   Boolean           @default(true)
  choices    BuybackChoice[]
  createdAt  DateTime          @default(now())
  updatedAt  DateTime          @updatedAt
  deletedAt  DateTime?
  @@map("buyback_questions")
}

model BuybackChoice {
  id          String            @id @default(uuid())
  questionId  String
  question    BuybackQuestion   @relation(fields: [questionId], references: [id])
  label       String            // "มีรอยนิดหน่อย รอยเคส"
  deductType  BuybackDeductType @default(PERCENT)
  deductValue Decimal           @db.Decimal(12, 2) // 8 (%) หรือ 500 (บาท)
  sortOrder   Int               @default(0)
  isActive    Boolean           @default(true)
  createdAt   DateTime          @default(now())
  updatedAt   DateTime          @updatedAt
  deletedAt   DateTime?
  @@index([questionId])
  @@map("buyback_choices")
}
```

### 5.2 Field ใหม่บน `TradeIn` (nullable ทั้งหมด — ของเดิมไม่กระทบ)

```prisma
conditionAnswers   Json?     @map("condition_answers")    // [{questionKey, title, choices:[{choiceId, label, deductType, deductValue}]}]
quoteBreakdown     Json?     @map("quote_breakdown")      // {maxPrice, fixedTotal, pctTotal, lines:[{label, amount}], price}
preferredVisitDate DateTime? @map("preferred_visit_date") // วันที่ลูกค้าสะดวกเข้าร้าน
```

- ราคาที่เสนอออนไลน์เก็บใน `estimatedValue` (field เดิม, ความหมายเดิม "ราคาประเมินเบื้องต้น")
- **`basePriceAtAppraisal` ตอน intake = null** (แก้จาก draft แรก — ห้ามใส่ maxPrice: guardrail เดิมไม่อ่าน field นี้
  และจะบันทึก deviation ปลอมถาวร ขัด semantics ใน schema; maxPrice อยู่ใน `quoteBreakdown.maxPrice` แล้ว
  ส่วน appraise ตาม §7.4 จะ snapshot เอง)
- `deviceCondition` ใส่เกรด derive (§7.3) เพื่อการ filter/รายงาน — หมายเหตุ: หน้า staff ปัจจุบันไม่แสดง
  field นี้; การแสดงอยู่ใน scope ของ TradeIn detail dialog (§8.3)

### 5.3 ราคาสูงสุดต่อรุ่น + coupling policy
ใช้ตาราง `TradeInValuation` เดิม: **แถว `brand='Apple'`, `condition='A'`, model ขึ้นต้น "iPhone"** = ราคาสูงสุดของรุ่น+ความจุนั้น

⚠️ **Coupling ที่ยอมรับ (นโยบาย):** แถว condition-A ชุดเดียวกันนี้ยังเลี้ยง (ก) quote ของ `/trade-in`
(×0.85–1.05) และ (ข) band ±15% ของ staff appraise สำหรับ walk-in — การที่ owner ปรับ "ราคารับซื้อสูงสุด"
จะขยับสองระบบนั้นตาม **ตัดสินใจ: ยอมรับ** เพราะทั้งสามคือราคาตลาดตัวเดียวกัน; ระบุคำเตือนนี้ในหน้าแอดมิน valuations (§8.1)

### 5.4 Seed questionnaire (ค่าเริ่มต้น — owner ปรับได้ในแอดมิน)
คำถาม 8 กลุ่ม ปรับจาก yellobe สำหรับ iPhone:

| # | key | title | selectType | ตัวเลือก (label → หัก) |
|---|---|---|---|---|
| 1 | device-origin | เครื่องศูนย์ | SINGLE | ศูนย์ไทย (TH) → 0 · เครื่องนอก → ฿1,500 |
| 2 | warranty | ประกัน Apple | SINGLE | เหลือ >4 เดือน → 0 · เหลือ <4 เดือน → ฿300 · หมดประกัน → ฿500 |
| 3 | body-condition | สภาพตัวเครื่อง | SINGLE | ไม่มีรอย → 0 · รอยนิดหน่อย/รอยเคส → 8% · รอยมาก ถลอก สีหลุด → 18% · มีรอยตก/เบี้ยว/แตก/งอ → 51% · ฝาหลัง/กระจกหลังแตก → 51% |
| 4 | screen-scratch | รอยหน้าจอ | SINGLE | ไม่มีรอย → 0 · รอยบางๆ → 8% · รอยสะดุด → 18% · แตกชำรุด → 70% |
| 5 | display | การแสดงผลหน้าจอ | SINGLE | ปกติ → 0 · จุด Bright/ฝุ่นในจอ/ขอบจอเงา → 35% · จุด Dead/จุดสี/ลายเส้น/จอปลอม → 70% · จอไม่แสดงภาพ → 85% |
| 6 | battery | สุขภาพแบตเตอรี่ | SINGLE | ≥80% → 0 · <80% → ฿1,500 (helpText: Settings > Battery > Battery Health) |
| 7 | box-accessories | กล่อง/อุปกรณ์ | SINGLE | มีกล่อง อุปกรณ์ครบ → 0 · มีกล่อง อุปกรณ์ไม่ครบ → ฿200 · ไม่มีกล่อง → ฿500 |
| 8 | functional-issues | ปัญหาการใช้งาน | MULTI | ทัชสกรีน → 75% · WiFi/Bluetooth/GPS → 85% · ระบบสั่น → 35% · โทรออก-รับสาย/ไมค์ → 75% · Face ID/สแกนนิ้ว → 51% · ลำโพง → 35% · กล้อง/แฟลช → 70% · Sensor → 51% · ปุ่ม power/volume → 35% (เลือก 0 ข้อ = ไม่มีปัญหา) |

**ข้อควรระวัง seed valuations เดิม:** dedupe ของ seed ข้ามเฉพาะแถว `deletedAt: null` — แถวที่ owner
soft-delete แล้วจะถูก**สร้างใหม่ด้วยราคา demo** เมื่อ seed รันซ้ำ ซึ่งตอนนี้ราคากลายเป็นข้อเสนอเงินสด
ต่อลูกค้าโดยตรง → แก้ dedupe ให้ข้ามถ้า**เคยมี**แถว (รวม soft-deleted) สำหรับ (brand,model,storage,condition) นั้น

## 6. API

### 6.1 Public (shop-buyback module)

| Method | Path | ทำอะไร |
|---|---|---|
| GET | `/api/shop/buyback/catalog` | รายการ iPhone ที่เปิดรับซื้อ: `{ models: [{ model, storages: [{ storage, maxPrice }] }] }` จาก TradeInValuation — query แบบ **case-insensitive** (brand equals-insensitive 'apple', model startsWith-insensitive 'iphone', condition 'A', deletedAt null) ตาม convention ของ module |
| GET | `/api/shop/buyback/questions` | คำถาม active + choices (รวม deductType/deductValue เพื่อ preview) เรียง sortOrder |
| POST | `/api/shop/buyback/quote` | `{ model, storage, answers: [{questionKey, choiceIds[]}] }` → `{ available, price, maxPrice, breakdown }` — คำนวณฝั่ง server |
| POST | `/api/shop/buyback/submit` | `{ model, storage, answers, sellerName, sellerPhone, imei?, notes?, preferredVisitDate?, lineUserId? }` → recompute ราคา (ห้ามเชื่อ client) → สร้าง TradeIn → LINE flex (copy ใหม่: "ราคาที่ประเมิน ฿X — ทีมงานจะติดต่อนัดวันเข้าร้าน") → `{ id, status, price }` |
| GET | `/api/shop/buyback/:id` | เดิม + `estimatedValue`, `quoteBreakdown`, `preferredVisitDate` (PII-redacted เท่าเดิม) |
| POST | `/api/shop/buyback/quick-quote` | **คง endpoint ไว้ 1 release เป็น 410 Gone** + ข้อความไทย "กรุณาโหลดหน้าใหม่" (bundle SPA เก่าที่ค้าง cache ยังเรียกอยู่) แล้วค่อยลบรอบถัดไป |

- **ลำดับ route บังคับ:** `@Get('catalog')` และ `@Get('questions')` ต้องประกาศ**ก่อน** `@Get(':id')` ใน
  `shop-buyback.controller.ts` (ตอนนี้ `:id` เป็น GET ตัวท้าย — ถ้า append ต่อท้ายจะโดนกลืนเป็น id='catalog')
  + เพิ่ม **controller-level routing test** (supertest) เพราะ unit spec เรียก method ตรงจับบั๊กนี้ไม่ได้
- **Throttle ระบุชัด** (module นี้ไม่เคยมี @Throttle รายตัว): catalog/questions/quote = `@Throttle 60/60s`
  (precedent: shop-catalog installment-preview), submit = `@Throttle 5/60s` (precedent: shop-installment-apply)
- ผู้เรียก quick-quote เดิมมี **2 หน้า** (BuybackQuickQuotePage + BuybackSubmitPage) — ทั้งคู่ถูกแทน/ลบใน PR เดียวกัน (atomic)
- Validation: answers ครอบทุกคำถาม active ชนิด SINGLE (MULTI เลือก 0 ข้อได้), choiceId ต้องอยู่ใต้ question นั้นจริง, error ภาษาไทย
- IMEI dedup 24 ชม. (เดิม) คงไว้

### 6.2 Admin (trade-in module — roles ระบุต่อ verb ตาม precedent valuations)

| Method | Path | Roles |
|---|---|---|
| GET | `/trade-ins/buyback-questions` | OWNER, BRANCH_MANAGER, SALES (mirror GET valuations) |
| POST | `/trade-ins/buyback-questions` · `/:id/choices` | OWNER, BRANCH_MANAGER (mirror POST valuations) |
| PATCH/DELETE | `.../buyback-questions/:id`, `/trade-ins/buyback-choices/:id` | OWNER, BRANCH_MANAGER (soft delete; ไม่มี precedent DELETE ใน controller นี้ — สร้างใหม่ตาม pattern soft-delete มาตรฐาน) |

- แท็บ editor ฝั่ง web ต้อง client-gate ด้วย pattern `canManage` เดิม (SALES เปิด /trade-in ได้)
- การแก้ค่าหักมีผลกับ quote ถัดไปทันที — record เดิมไม่กระทบเพราะ snapshot answers+breakdown ไว้แล้ว

### 6.3 แก้ route-shadowing เดิม (prerequisite ที่ค้นพบระหว่าง scrutinize)
`trade-in.controller.ts` ประกาศ `@Get(':id')` (บรรทัด ~157) **ก่อน** static GET 4 ตัว:
`valuation`, `valuations`, `valuation-brands`, `valuation-models` → ทั้ง 4 ตัว**ตอบ 404 อยู่วันนี้**
(request ถูก bind เป็น id='valuations') — งานนี้ต้องย้าย `@Get(':id')` ลงท้ายสุด + ประกาศ
`buyback-questions` เหนือ `:id` + เพิ่ม routing test ครอบทั้ง controller (หน้าแอดมิน §8 ใช้ endpoint พวกนี้จริงเป็นครั้งแรก)

## 7. Pricing engine + appraise handshake

### 7.1 สูตร
```
fixedTotal = Σ deductValue ของ choice ชนิด FIXED ที่เลือก
pctTotal   = min(Σ deductValue ของ choice ชนิด PERCENT ที่เลือก, 100)
raw        = (maxPrice − fixedTotal) × (1 − pctTotal/100)
price      = max(floor(raw / 10) × 10, 0)   // ปัดลงเหลือหลักสิบ, ไม่ติดลบ
```
- **Service ใหม่** ใน shop-buyback module ใช้ `Prisma.Decimal` ล้วน — **ห้าม**ต่อยอดจาก
  `TradeInIntakeService.quote()` (ตัวนั้นใช้ `Number()`+Math.floor ซึ่ง lock ด้วย spec ของ trade-in อยู่ และต้องคงไว้ให้ EXCHANGE)
- Golden case (พิสูจน์จาก yellobe): max 14,500 / fixed 1,000 / pct 8 → **12,420**

### 7.2 ความปลอดภัยราคา
- `POST quote` และ `POST submit` คำนวณจาก DB เสมอ — client ส่งเฉพาะ choiceIds
- Snapshot ลง TradeIn: `conditionAnswers` (รวม choiceId+ค่าหัก ณ ตอนนั้น), `quoteBreakdown`, `estimatedValue`; `basePriceAtAppraisal = null` (§5.2)

### 7.3 Derived grade (เพื่อ filter/รายงาน)
จาก `pctTotal`: 0 → **A** · ≤10 → **B** · ≤35 → **C** · >35 → **D** (บาทคงที่ไม่มีผลต่อเกรด)

### 7.4 Appraise handshake — ยืนยันราคาหน้าร้าน (แก้ blocker จาก scrutinize)

ปัญหา: `appraise()` เดิม lookup ตาราง valuation ตามเกรดที่ staff เลือก แล้ว hard-reject ราคานอก ±15%
ของแถวนั้นโดยไม่มีทาง override (`deviationReason` ใน DTO ไม่มีโค้ดอ่าน; OWNER force ข้ามเฉพาะ appraisal-lock)
→ ราคา online ที่หักหนัก (เช่น −59% จาก max) จะถูก block, และเกรด D ที่ไม่มีแถว → guard หายเงียบ

**ดีไซน์:** record ที่มี `quoteBreakdown` (online instant quote) ใช้เส้นทางยืนยันของตัวเอง —
**ข้าม valuation-band เดิมทั้งหมด** เพราะราคาตรวจสอบได้จาก engine + snapshot:

1. **สภาพตรงตามที่ตอบ:** staff กด "ใช้ราคาที่เสนอ" → `offeredPrice = estimatedValue` (เป๊ะ ไม่มี band)
2. **สภาพไม่ตรง:** staff แก้คำตอบใน UI (questionnaire ชุดเดียวกัน) → server คำนวณราคาใหม่จาก
   config ปัจจุบัน → `offeredPrice = ราคาที่ engine คิด` + snapshot คำตอบที่แก้ (audit ผ่าน AuditInterceptor เดิม)
3. **ราคา free-hand นอก engine:** OWNER เท่านั้น + บังคับเหตุผล (audited) — mirror นโยบาย force เดิม

- appraise ของ record เหล่านี้ snapshot `basePriceAtAppraisal = quoteBreakdown.maxPrice` (ให้ deviation
  analytics เทียบ offered vs max ได้อย่างมีความหมาย)
- record ที่**ไม่มี** quoteBreakdown (walk-in, online เก่า) → พฤติกรรม appraise เดิมทุกอย่าง ไม่แตะ
- UI: AppraisalModal เดิมเพิ่มโหมดสำหรับ record ที่มี quoteBreakdown — แสดงคำตอบลูกค้า + ราคาเสนอ +
  ปุ่ม 2 ทาง (ตรงตามตอบ / แก้คำตอบ); prefill เกรดจาก record

### 7.5 การแยกโค้ดจาก trade-in (EXCHANGE)
`shop-buyback` เลิก delegate ไป `TradeInIntakeService` (ยกเว้น reuse pattern IMEI-dedup) —
quote/submit/flex ของ buyback เป็นโค้ดใหม่ใน module ตัวเอง; `TradeInIntakeService.quote()/submit()/buildSubmittedFlex()`
**คงเดิมทุก byte** ให้ `/shop/trade-in` (EXCHANGE, margin 0.85/1.05, flex "ราคาเสนอภายใน 24 ชั่วโมง")
และ spec เดิมของ shop-trade-in ต้องเขียวโดยไม่แก้

## 8. หน้าแอดมิน (apps/web) — สร้างใหม่ทั้งหมด (ของเดิมไม่มี UI valuation ใดๆ)

ผล scrutinize: apps/web ไม่มีหน้า/แท็บ valuations อยู่จริง (endpoint CRUD ไม่เคยมีผู้เรียก) และไม่มีหน้า
TradeIn detail — §นี้คืองานสร้างใหม่ ไม่ใช่ "เพิ่มแท็บ"

### 8.1 TradeInPage → โครงแท็บใหม่: [รายการรับซื้อ | ตารางราคากลาง | แบบประเมินออนไลน์]
- **ตารางราคากลาง:** CRUD ตาราง TradeInValuation (list + filter brand/model, แก้ basePrice ต่อแถว, เพิ่ม/ลบรุ่น)
  — consume GET/POST `/trade-ins/valuations` (ใช้งานได้จริงครั้งแรกหลังแก้ §6.3) + คำเตือน coupling ตาม §5.3
- **แบบประเมินออนไลน์:** ตารางคำถาม (แก้ sortOrder, toggle active) + ตัวเลือกต่อคำถาม (label, ชนิดหัก บาท/%, ค่า)
- ทั้งสองแท็บ client-gate ด้วย `canManage` (OWNER/BM); SALES เห็นเฉพาะแท็บรายการ

### 8.2 AppraisalModal — โหมด online-quote ตาม §7.4

### 8.3 TradeIn detail dialog (ใหม่ — consume `GET /trade-ins/:id` ที่มีอยู่)
- แสดง `conditionAnswers` + `quoteBreakdown` + ราคาเสนอออนไลน์ + `preferredVisitDate`
- แถม: แสดง `photoUrls`/`batteryHealth`/`customerNotes` ของ record online แบบเก่าด้วย
  (ข้อมูลเก็บมาแล้วแต่ staff ไม่เคยเห็นเลยจนวันนี้ — appraise ตาบอดอยู่)

## 9. Error handling

| กรณี | พฤติกรรม |
|---|---|
| รุ่น/ความจุไม่มีใน valuation | `available: false` → UI "ยังไม่เปิดรับซื้อออนไลน์" + LINE CTA (ไม่ 404) |
| answers ไม่ครบ/choiceId ปลอม | 400 ภาษาไทย "กรุณาตอบแบบประเมินให้ครบ" |
| ราคา valuation เปลี่ยนระหว่างตอบ | submit คิดใหม่จากค่าปัจจุบัน — ลูกค้าเห็นราคาสุดท้ายบนหน้า success |
| IMEI ซ้ำใน 24 ชม. | 400 "เครื่องนี้อยู่ระหว่างประเมินราคาแล้ว" (เดิม) |
| questionnaire ว่าง (ยังไม่ seed) | quote ใช้ maxPrice ตรงๆ + log warning |
| Bundle SPA เก่าหลัง deploy | quick-quote ตอบ 410 + ข้อความให้โหลดหน้าใหม่ (1 release) |
| Catalog sort เจอชื่อรุ่น parse ไม่ได้ (SE/X/16e) | เรียงท้ายแบบ alphabetical — parser ห้าม throw |

## 10. Testing

- **Jest (api):** pricing engine golden — perfect = maxPrice, yellobe case 12,420 (mock max 14,500), pct >100 → floor 0, ปัดหลักสิบ, MULTI ว่าง, FIXED เกิน maxPrice → 0; **routing test ระดับ controller** (static routes ไม่โดน `:id` กลืน — ทั้ง shop-buyback และ trade-ins); appraise handshake ทั้ง 3 ทาง (§7.4) + ยืนยันว่า record ไม่มี quoteBreakdown ใช้ band เดิม; derived grade; validation; IMEI dedup; **spec เดิมของ shop-trade-in ต้องเขียวโดยไม่แก้ไฟล์**
- **Frontend:** build + typecheck; browser pass จริง: wizard ครบ 4 step, รุ่นไม่เปิดรับซื้อ, mobile viewport, หน้า status ทั้ง record ใหม่ (มี breakdown, ไม่มีแบต) และเก่า
  — หมายเหตุ: golden 12,420 เป็น engine-level (mock); กับ seed จริง (iPhone 15 128GB = 20,000) คำตอบชุดเดียวกันต้องได้ (20,000−1,000)×0.92 = **17,480** — assert สูตร ไม่ใช่เลข yellobe
- **Admin:** แก้ค่าหัก → quote ถัดไปเปลี่ยน; valuations CRUD ใช้ได้จริงผ่าน UI

## 11. Rollout / งานที่ owner ต้องทำ

1. **กรอกราคารับซื้อจริง** iPhone ทุกรุ่นที่เปิดรับ ผ่านแท็บ "ตารางราคากลาง" ใหม่ (§8.1) — ราคา seed เป็น demo
   ⚠️ การแก้ราคา condition A มีผลต่อ quote `/trade-in` และ band ของ staff ด้วย (§5.3)
2. ตรวจข้อความ landing + ค่าหัก default แล้วปรับตามนโยบายร้าน
3. (แนะนำ) เพิ่มรุ่นเก่ากว่า iPhone 13 ถ้าต้องการรับ (yellobe รับถึง iPhone 8; ระวัง sort fallback §9)
4. ห้ามรัน seed ซ้ำบน prod หลัง go-live จนกว่า seed dedupe จะแก้ตาม §5.4

## 12. คำถามที่ปิดแล้ว

- ยี่ห้ออื่น → ตัดออกจาก /buyback (trade-in ยังรับทุกยี่ห้อ)
- ราคาเดียว ไม่ใช่ช่วง; margin 0.80/0.95 → ลบพร้อม endpoint (มีอยู่แค่ใน shop-buyback; trade-in ใช้ 0.85/1.05 ของตัวเอง)
- ไม่มีรับถึงบ้าน; ไม่บังคับถ่ายรูป
- แบตเตอรี่ถามแบบ ≥80%/<80% (เลิกกรอกตัวเลข batteryHealth; field เป็น null ใน flow ใหม่ — UI ต้อง guard)
- ยืนยันราคาหน้าร้าน = appraise handshake §7.4 (ข้าม valuation-band เมื่อมี quoteBreakdown)
