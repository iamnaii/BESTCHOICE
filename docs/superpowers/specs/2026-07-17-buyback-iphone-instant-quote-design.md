# รับซื้อ iPhone รู้ราคาทันที (yellobe-style instant quote) — Design

**วันที่:** 2026-07-17
**สถานะ:** อนุมัติแล้ว (owner, 2026-07-17)
**ขอบเขต:** web-shop `/buyback` + shop-buyback API + แอดมิน questionnaire editor

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
- Backend: model `BuybackQuestion`/`BuybackChoice` + seed, pricing engine, endpoint catalog/questions/quote/submit ใหม่, field ใหม่บน `TradeIn`
- web-shop: เขียน `/buyback` landing ใหม่, `/buyback/quote` เป็น wizard iPhone-only, ตัด `/buyback/submit` (redirect), ปรับ `/buyback/:id` แสดง breakdown
- apps/web (staff): แท็บแอดมินแก้คำถาม/ค่าหัก + แสดงคำตอบลูกค้าใน TradeIn detail

**Non-goals (ไม่แตะ)**
- `/trade-in` (เก่าแลกใหม่) — คงเดิมทุกยี่ห้อ เกรด A/B/C
- Flow รับซื้อหน้าร้านของ staff (`/trade-ins` walk-in, appraise, voucher)
- บริการรับถึงบ้าน / ส่งไปรษณีย์
- บัญชี (ShopTradeInTemplate ยัง deferred ตาม Phase A.5)
- Backfill ข้อมูลเดิม — forward-only

## 4. UX (apps/web-shop)

### 4.1 `/buyback` — Landing (เขียนใหม่)
- Hero: "ขาย iPhone รู้ราคาใน 1 นาที" + CTA เช็คราคา
- 3 ขั้นตอน: ① เช็คราคาออนไลน์ → ② ยืนยันการขาย → ③ มาที่ร้าน ตรวจเครื่อง รับเงินสดทันที
- Trust: ราคามาตรฐานไม่ต้องต่อรอง / ตรวจเครื่องต่อหน้า ปฏิเสธขายได้ / ลบข้อมูลให้ฟรี / ใช้บัตรประชาชนใบเดียว
- Nav label เปลี่ยน "รับซื้อมือถือ" → "รับซื้อ iPhone" (ShopHeader/ShopFooter/HomePage service card)

### 4.2 `/buyback/quote` — Wizard (แทน BuybackQuickQuotePage เดิม)
- **Step 1 เลือกเครื่อง:** รุ่น + ความจุ (dropdown จาก `GET /api/shop/buyback/catalog` — เลิก hardcode CATALOG)
  → เห็น "ราคารับซื้อสูงสุด ฿XX,XXX" ทันที
- **Step 2 ประเมินสภาพ:** คำถาม 8 กลุ่มจาก `GET /api/shop/buyback/questions` (accordion เปิดทีละข้อแบบ yellobe,
  ตอบแล้วเลื่อนไปข้อถัดไป) + ราคา preview อัปเดตสด client-side
- **Step 3 ผลประเมิน:** ราคาเลขเดียวตัวใหญ่ + ตาราง breakdown (รายการหักทีละบรรทัด) + หมายเหตุ
  "ยืนยันราคาจริงตอนตรวจเครื่องที่ร้าน หากสภาพตรงตามที่ตอบ" → CTA "ยืนยันขาย"
- **Step 4 ส่งข้อมูล:** ชื่อ, เบอร์โทร (บังคับ), IMEI (ไม่บังคับ), วันที่สะดวกเข้าร้าน (ไม่บังคับ), หมายเหตุ
  — **ไม่ต้องถ่ายรูป** — แสดงที่อยู่/เวลาเปิดร้านจาก `shopInfo` → submit → success + LINE flex (เดิม)
- รุ่น/ความจุที่ไม่มีราคาในตาราง → "รุ่นนี้ยังไม่เปิดรับซื้อออนไลน์ ทักไลน์สอบถามได้" + ปุ่ม LINE OA

### 4.3 Routes
| Route | การเปลี่ยนแปลง |
|---|---|
| `/buyback` | landing ใหม่ |
| `/buyback/quote` | wizard 4 step ข้างบน |
| `/buyback/submit` | ลบหน้า — `<Navigate to="/buyback/quote" replace />` (กันลิงก์เก่า) |
| `/buyback/:id` | คงเดิม + แสดง estimatedValue + breakdown |

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
conditionAnswers   Json?     @map("condition_answers")    // [{questionKey, title, choices:[{label, deductType, deductValue}]}]
quoteBreakdown     Json?     @map("quote_breakdown")      // {maxPrice, fixedTotal, pctTotal, lines:[{label, amount}], price}
preferredVisitDate DateTime? @map("preferred_visit_date") // วันที่ลูกค้าสะดวกเข้าร้าน
```

- ราคาที่เสนอออนไลน์เก็บใน `estimatedValue` (field เดิม, ความหมายเดิม "ราคาประเมินเบื้องต้น")
- `deviceCondition` (nullable อยู่แล้ว) ใส่เกรดที่ derive จากคำตอบ (ข้อ 7.3) เพื่อให้หน้า staff เดิมอ่านได้

### 5.3 ราคาสูงสุดต่อรุ่น
ใช้ตาราง `TradeInValuation` เดิม: **แถว `brand='Apple'`, `condition='A'`, model ขึ้นต้น "iPhone"**
= ราคาสูงสุดของรุ่น+ความจุนั้น. จัดการผ่าน CRUD `/trade-ins/valuations` ที่มีอยู่ — ไม่มี schema ใหม่.

### 5.4 Seed (ค่าเริ่มต้น — owner ปรับได้ในแอดมิน)
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

## 6. API

### 6.1 Public (shop-buyback module — `ShopBotDefenseGuard` + throttle เหมือนเดิม, PII-safe)

| Method | Path | ทำอะไร |
|---|---|---|
| GET | `/api/shop/buyback/catalog` | รายการ iPhone ที่เปิดรับซื้อ: `{ models: [{ model, storages: [{ storage, maxPrice }] }] }` จาก TradeInValuation (Apple + condition A + model LIKE 'iPhone%' + deletedAt null) เรียงรุ่นใหม่→เก่า (ตัวเลขรุ่นมาก→น้อย, ใน generation เดียวกัน Pro Max > Pro > Plus > base; ความจุ น้อย→มาก) |
| GET | `/api/shop/buyback/questions` | คำถาม active + choices (รวม deductType/deductValue เพื่อให้ client แสดง preview ได้) เรียง sortOrder |
| POST | `/api/shop/buyback/quote` | `{ model, storage, answers: [{questionKey, choiceIds[]}] }` → `{ available, price, maxPrice, breakdown }` — คำนวณฝั่ง server |
| POST | `/api/shop/buyback/submit` | payload ใหม่: `{ model, storage, answers, sellerName, sellerPhone, imei?, notes?, preferredVisitDate?, lineUserId? }` → recompute ราคาใหม่ (ห้ามเชื่อราคาจาก client) → สร้าง TradeIn → LINE flex → `{ id, status, price }` — flex copy ฝั่ง BUYBACK เปลี่ยนจาก "ราคาเสนอภายใน 24 ชั่วโมง" เป็น "ราคาที่ประเมิน ฿X — ทีมงานจะติดต่อนัดวันเข้าร้าน" |
| GET | `/api/shop/buyback/:id` | เดิม + `estimatedValue`, `quoteBreakdown` |

- `POST quick-quote` เดิม (A/B/C + margin) **ลบทิ้ง** — ไม่มีผู้เรียกอื่น
- `submit` เดิมที่บังคับ photoUrls/batteryHealth → เปลี่ยนเป็น DTO ใหม่ (photoUrls ไม่รับจาก flow นี้แล้ว; field DB คงอยู่)
- Validation: answers ต้องครอบทุกคำถาม active ชนิด SINGLE (MULTI เลือก 0 ข้อได้), choiceId ต้องอยู่ใต้ question นั้นจริง, error message ภาษาไทย
- IMEI dedup 24 ชม. (เดิม) คงไว้

### 6.2 Admin (trade-in module — JWT + Roles เดียวกับ valuations CRUD เดิม)

| Method | Path | ทำอะไร |
|---|---|---|
| GET | `/trade-ins/buyback-questions` | list ทั้งหมด (รวม inactive) |
| POST | `/trade-ins/buyback-questions` | สร้างคำถาม |
| PATCH | `/trade-ins/buyback-questions/:id` | แก้ title/helpText/sortOrder/isActive |
| POST | `/trade-ins/buyback-questions/:id/choices` | เพิ่มตัวเลือก |
| PATCH | `/trade-ins/buyback-choices/:id` | แก้ label/deductType/deductValue/sortOrder/isActive |
| DELETE | `/trade-ins/buyback-questions/:id`, `/trade-ins/buyback-choices/:id` | soft delete |

AuditInterceptor global บันทึกอยู่แล้ว; การแก้ค่าหักมีผลกับ quote ถัดไปทันที (ไม่กระทบ TradeIn เดิมเพราะ snapshot คำตอบ+breakdown ไว้ใน record แล้ว)

## 7. Pricing engine (server-side, single source of truth)

### 7.1 สูตร
```
fixedTotal = Σ deductValue ของ choice ชนิด FIXED ที่เลือก
pctTotal   = min(Σ deductValue ของ choice ชนิด PERCENT ที่เลือก, 100)
raw        = (maxPrice − fixedTotal) × (1 − pctTotal/100)
price      = max(floor(raw / 10) × 10, 0)   // ปัดลงเหลือหลักสิบ, ไม่ติดลบ
```
- ทุกการคูณ/บวกใช้ `Prisma.Decimal` (ห้าม Number ตาม rule เงิน)
- Golden case (พิสูจน์จาก yellobe): max 14,500 / fixed 1,000 / pct 8 → **12,420** (ก่อนปัดหลักสิบ = 12,420 พอดี)

### 7.2 ความปลอดภัยราคา
- `POST quote` และ `POST submit` คำนวณจาก DB เสมอ — client ส่งเฉพาะ choiceIds, ราคา preview ฝั่ง client ใช้แสดงผลเท่านั้น
- Snapshot ลง TradeIn: `conditionAnswers` (label+ค่าหัก ณ ตอนนั้น), `quoteBreakdown`, `estimatedValue`, `basePriceAtAppraisal = maxPrice`

### 7.3 Derived grade (เพื่อ staff UI เดิม)
จาก `pctTotal`: 0 → **A** · ≤10 → **B** · ≤35 → **C** · >35 → **D** (บาทคงที่ไม่มีผลต่อเกรด)

## 8. หน้าแอดมิน (apps/web)

- หน้า trade-in valuations เดิม: เพิ่มแท็บ **"แบบประเมินรับซื้อออนไลน์"** — ตารางคำถาม (ลาก/แก้ sortOrder, toggle active)
  + ตารางตัวเลือกต่อคำถาม (แก้ label, ชนิดหัก บาท/%, ค่า) — pattern เดียวกับ valuations CRUD เดิม
- TradeIn detail (staff): section "คำตอบประเมินออนไลน์" แสดงคำตอบ + breakdown + ราคาที่เสนอออนไลน์
  (จาก conditionAnswers/quoteBreakdown — read-only)

## 9. Error handling

| กรณี | พฤติกรรม |
|---|---|
| รุ่น/ความจุไม่มีใน valuation | `available: false` → UI แสดง "ยังไม่เปิดรับซื้อออนไลน์" + LINE CTA (ไม่ 404) |
| answers ไม่ครบ/choiceId ปลอม | 400 ภาษาไทย "กรุณาตอบแบบประเมินให้ครบ" |
| ราคา valuation เปลี่ยนระหว่างตอบ | submit คิดราคาใหม่จากค่าปัจจุบัน — ถ้าต่างจาก preview ลูกค้าเห็นราคาสุดท้ายบนหน้า success (ราคาจริงยืนยันหน้าร้านอยู่แล้ว) |
| IMEI ซ้ำใน 24 ชม. | 400 "เครื่องนี้อยู่ระหว่างประเมินราคาแล้ว" (เดิม) |
| questionnaire ว่าง (ยังไม่ seed) | quote ใช้ maxPrice ตรงๆ + log warning |

## 10. Testing

- **Jest (api):** pricing engine golden cases — perfect condition = maxPrice, yellobe case 12,420, pct รวม >100 → floor 0, ปัดหลักสิบ, MULTI ว่าง, FIXED เกิน maxPrice → 0; controller specs: catalog/questions/quote/submit + validation + IMEI dedup; derived grade mapping
- **Frontend:** `npm run build` + typecheck ผ่าน; browser pass จริง: เดิน wizard ครบ 4 step, รุ่นไม่เปิดรับซื้อ, mobile viewport (sticky bar), หน้า status
- **Admin:** แก้ค่าหักในแอดมิน → quote ถัดไปเปลี่ยนตาม

## 11. Rollout / งานที่ owner ต้องทำ

1. **กรอกราคารับซื้อจริง** ของ iPhone ทุกรุ่นที่จะเปิดรับ (ตาราง valuations, condition A) — ราคาปัจจุบันเป็น demo seed
2. ตรวจข้อความ landing + ค่าหัก default แล้วปรับตามนโยบายร้าน
3. (แนะนำ) เพิ่มรุ่นเก่ากว่า iPhone 13 ถ้าต้องการรับ (yellobe รับถึง iPhone 8)

## 12. คำถามที่ปิดแล้ว

- ยี่ห้ออื่น → ตัดออกจาก /buyback (trade-in ยังรับทุกยี่ห้อ)
- ราคาเดียว ไม่ใช่ช่วง; margin multiplier 0.80/0.95 เดิม → เลิกใช้ใน flow นี้ (ราคาคุมผ่านตาราง valuations + ค่าหัก)
- ไม่มีรับถึงบ้าน; ไม่บังคับถ่ายรูป
- แบตเตอรี่ถามแบบ ≥80%/<80% (เลิกกรอกตัวเลข batteryHealth ใน flow ออนไลน์)
