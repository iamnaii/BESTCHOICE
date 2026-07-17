# รับซื้อ iPhone รู้ราคาทันที (Instant Quote) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** เปลี่ยน `/buyback` บนเว็บ shop เป็น flow แบบ yellobe — ลูกค้าเลือกรุ่น iPhone → ตอบแบบประเมินสภาพ 8 กลุ่ม → เห็นราคารับซื้อเลขเดียวทันที → ส่งข้อมูลนัดเข้าร้าน — พร้อมหน้าแอดมินแก้ราคา/ค่าหัก และ handshake ให้ staff ยืนยันราคาหน้าร้านได้

**Architecture:** Backend เพิ่ม 2 ตาราง questionnaire + pricing engine (Decimal) ใน `shop-buyback` module ที่ **เลิก delegate** ไป `TradeInIntakeService` (คงไว้ byte-identical ให้ trade-in EXCHANGE); staff ยืนยันราคาผ่าน `OnlineAppraisalService` ใหม่ (ข้าม valuation-band ±15% เมื่อ record มี `quoteBreakdown`); ฝั่ง web-shop เขียน wizard ใหม่ 4 step; ฝั่ง apps/web สร้างหน้า valuations CRUD + questionnaire editor + TradeIn detail dialog ใหม่ทั้งหมด

**Tech Stack:** NestJS + Prisma (PostgreSQL), React 19 + Vite (web-shop: react-router v7 + TanStack Query + Tailwind v4), React 18 (apps/web), Jest

**Spec:** `docs/superpowers/specs/2026-07-17-buyback-iphone-instant-quote-design.md` (อ่านก่อนเริ่ม — ทุก requirement มาจากไฟล์นี้)

## Global Constraints

- เงินใช้ `Prisma.Decimal` + `@db.Decimal(12, 2)` เท่านั้น — ห้าม `Number()` ในการคำนวณ (ยกเว้นโค้ดเดิมของ intake ที่ห้ามแตะ)
- สูตรราคา: `price = max(floor(((maxPrice − Σfixed) × (1 − min(Σpct,100)/100)) / 10) × 10, 0)` — golden: max 14,500 / fixed 1,000 / pct 8 → **12,420**
- `TradeInIntakeService` (apps/api/src/modules/shop-trade-in/trade-in-intake.service.ts) **ห้ามแก้ทุก byte** และ `shop-trade-in.service.spec.ts` ต้องเขียวโดยไม่แก้ไฟล์
- Route ใหม่ที่เป็น static GET ต้องประกาศ**ก่อน** `@Get(':id')` ในทุก controller
- Error message ภาษาไทย, soft delete เท่านั้น (`deletedAt`), UI text ไทยใช้ `leading-snug`
- web-shop import UI จาก `@/components` (frozen API) เท่านั้น; apps/web ห้าม hardcode สี ใช้ semantic tokens
- Migration ถัดไปต้องใช้เลข `20260980000000` (โฟลเดอร์ล่าสุดตอนนี้ = `20260979000000_partial_link_purpose_metadata`)
- ทุก commit อยู่บน branch `feat/buyback-iphone-instant-quote` (แตกจาก main)
- คำสั่งรัน test ฝั่ง api: `cd apps/api && npx jest <path> --runInBand`

---

## Phase A — Backend

### Task 0: Branch

**Files:** ไม่มี

- [ ] **Step 0.1:** `cd /Users/iamnaii/Desktop/App/BESTCHOICE && git checkout -b feat/buyback-iphone-instant-quote`
  (working tree มีไฟล์ payments ค้าง 4 ไฟล์ของงานอื่น — **ห้าม** add/commit ไฟล์เหล่านั้น: `apps/web/src/components/payment/*`, `apps/web/src/pages/PaymentsPage/__tests__/draftHydration.test.ts`)

### Task 1: Prisma schema — BuybackQuestion/BuybackChoice + TradeIn fields

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (enum section บนสุด + ต่อท้าย model `TradeInValuation` + ใน model `TradeIn`)
- Create: `apps/api/prisma/migrations/20260980000000_buyback_questionnaire/migration.sql` (ผ่าน prisma)

**Interfaces:**
- Produces: model `BuybackQuestion` (key, title, helpText?, selectType SINGLE|MULTI, sortOrder, isActive, choices[]), `BuybackChoice` (questionId, label, deductType PERCENT|FIXED, deductValue Decimal(12,2), sortOrder, isActive), TradeIn ใหม่ 3 fields: `conditionAnswers Json?`, `quoteBreakdown Json?`, `preferredVisitDate DateTime?`

- [ ] **Step 1.1: เพิ่ม enums** — ใน `schema.prisma` หา block enum ที่มีอยู่ (บนไฟล์) แล้วเพิ่มต่อท้าย enum ตัวสุดท้าย:

```prisma
enum BuybackDeductType {
  PERCENT
  FIXED
}

enum BuybackSelectType {
  SINGLE
  MULTI
}
```

- [ ] **Step 1.2: เพิ่ม 2 models** — วางต่อท้าย model `TradeInValuation` (หลังบรรทัด `@@map("trade_in_valuations")` + `}`):

```prisma
/// คำถามประเมินสภาพ iPhone สำหรับ buyback instant-quote (yellobe-style)
model BuybackQuestion {
  id         String            @id @default(uuid())
  key        String            @unique // slug เช่น "body-condition"
  title      String
  helpText   String?           @map("help_text")
  selectType BuybackSelectType @default(SINGLE) @map("select_type")
  sortOrder  Int               @default(0) @map("sort_order")
  isActive   Boolean           @default(true) @map("is_active")
  choices    BuybackChoice[]

  createdAt DateTime  @default(now()) @map("created_at")
  updatedAt DateTime  @updatedAt @map("updated_at")
  deletedAt DateTime? @map("deleted_at")

  @@index([deletedAt])
  @@map("buyback_questions")
}

model BuybackChoice {
  id          String            @id @default(uuid())
  questionId  String            @map("question_id")
  question    BuybackQuestion   @relation(fields: [questionId], references: [id])
  label       String
  deductType  BuybackDeductType @default(PERCENT) @map("deduct_type")
  deductValue Decimal           @map("deduct_value") @db.Decimal(12, 2)
  sortOrder   Int               @default(0) @map("sort_order")
  isActive    Boolean           @default(true) @map("is_active")

  createdAt DateTime  @default(now()) @map("created_at")
  updatedAt DateTime  @updatedAt @map("updated_at")
  deletedAt DateTime? @map("deleted_at")

  @@index([questionId])
  @@index([deletedAt])
  @@map("buyback_choices")
}
```

- [ ] **Step 1.3: เพิ่ม 3 fields ใน model TradeIn** — Edit โดย anchor ที่บรรทัดเดิม:

old_string:
```prisma
  photoUrls            String[]                @default([]) @map("photo_urls")
  batteryHealth        Int?                    @map("battery_health")
```
new_string:
```prisma
  photoUrls            String[]                @default([]) @map("photo_urls")
  batteryHealth        Int?                    @map("battery_health")
  /// Instant-quote (yellobe-style): snapshot คำตอบแบบประเมิน ณ ตอน submit
  conditionAnswers     Json?                   @map("condition_answers")
  /// {maxPrice, fixedTotal, pctTotal, price, lines[]} — จำนวนเงินเป็น string (Decimal)
  quoteBreakdown       Json?                   @map("quote_breakdown")
  preferredVisitDate   DateTime?               @map("preferred_visit_date")
```

- [ ] **Step 1.4: สร้าง migration เลข 20260980000000**

```bash
cd apps/api
npx prisma migrate dev --create-only --name buyback_questionnaire
# prisma จะสร้างโฟลเดอร์ชื่อ <วันนี้>_buyback_questionnaire — เปลี่ยนชื่อเป็นเลข convention ของ repo:
mv prisma/migrations/*_buyback_questionnaire prisma/migrations/20260980000000_buyback_questionnaire
npx prisma migrate dev
npx prisma generate
```
Expected: migration applied, generate สำเร็จ (ถ้า DB local ต่อไม่ได้: รัน `npx prisma generate` อย่างเดียวเพื่อให้ type มาก่อน แล้วบันทึกไว้ว่าต้อง `migrate dev` เมื่อ DB พร้อม — jest test ที่ตามมาเป็น mock-based ไม่ต้องใช้ DB)

- [ ] **Step 1.5: Typecheck + commit**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE && ./tools/check-types.sh api
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/20260980000000_buyback_questionnaire
git commit -m "feat(api): schema BuybackQuestion/BuybackChoice + TradeIn instant-quote fields"
```

### Task 2: Seed questionnaire + แก้ seed valuations กันคืนชีพแถวที่ลบ

**Files:**
- Create: `apps/api/prisma/seeds/buyback-questions.ts`
- Modify: `apps/api/prisma/seed.ts` (import + เรียกหลัง `seedTradeInValuations`)
- Modify: `apps/api/prisma/seeds/trade-in-valuations.ts:182-190` (dedupe)

**Interfaces:**
- Produces: `seedBuybackQuestions(prisma: PrismaClient)` — idempotent ด้วย `key` (ข้ามทั้งคำถามถ้า key เคยมี รวม soft-deleted)

- [ ] **Step 2.1: สร้าง seed file** — `apps/api/prisma/seeds/buyback-questions.ts` (ค่าจาก spec §5.4 ครบ 8 กลุ่ม):

```ts
import { Prisma, PrismaClient } from '@prisma/client';

type PrismaAny = PrismaClient & Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

type ChoiceSeed = { label: string; deductType: 'PERCENT' | 'FIXED'; deductValue: number };
type QuestionSeed = {
  key: string;
  title: string;
  helpText?: string;
  selectType: 'SINGLE' | 'MULTI';
  choices: ChoiceSeed[];
};

const questionData: QuestionSeed[] = [
  {
    key: 'device-origin',
    title: 'เครื่องศูนย์',
    selectType: 'SINGLE',
    choices: [
      { label: 'เครื่องศูนย์ไทย (TH)', deductType: 'FIXED', deductValue: 0 },
      { label: 'เครื่องนอก (โมเดลอื่น)', deductType: 'FIXED', deductValue: 1500 },
    ],
  },
  {
    key: 'warranty',
    title: 'ประกัน Apple',
    helpText: 'เช็คได้ที่ Settings > General > About หรือ checkcoverage.apple.com',
    selectType: 'SINGLE',
    choices: [
      { label: 'ประกันเหลือมากกว่า 4 เดือน', deductType: 'FIXED', deductValue: 0 },
      { label: 'ประกันเหลือน้อยกว่า 4 เดือน', deductType: 'FIXED', deductValue: 300 },
      { label: 'หมดประกัน', deductType: 'FIXED', deductValue: 500 },
    ],
  },
  {
    key: 'body-condition',
    title: 'สภาพตัวเครื่อง',
    selectType: 'SINGLE',
    choices: [
      { label: 'ไม่มีรอยขีดข่วน', deductType: 'PERCENT', deductValue: 0 },
      { label: 'มีรอยนิดหน่อย รอยเคส', deductType: 'PERCENT', deductValue: 8 },
      { label: 'มีรอยมาก ถลอก สีหลุด', deductType: 'PERCENT', deductValue: 18 },
      { label: 'ตัวเครื่องมีรอยตก / เบี้ยว / แตก / งอ', deductType: 'PERCENT', deductValue: 51 },
      { label: 'ฝาหลัง / กระจกหลังแตก', deductType: 'PERCENT', deductValue: 51 },
    ],
  },
  {
    key: 'screen-scratch',
    title: 'รอยหน้าจอ',
    selectType: 'SINGLE',
    choices: [
      { label: 'หน้าจอไม่มีรอย', deductType: 'PERCENT', deductValue: 0 },
      { label: 'หน้าจอมีรอยบางๆ', deductType: 'PERCENT', deductValue: 8 },
      { label: 'หน้าจอมีรอยสะดุด', deductType: 'PERCENT', deductValue: 18 },
      { label: 'หน้าจอมีรอยแตกชำรุด', deductType: 'PERCENT', deductValue: 70 },
    ],
  },
  {
    key: 'display',
    title: 'การแสดงผลหน้าจอ',
    selectType: 'SINGLE',
    choices: [
      { label: 'แสดงภาพปกติ', deductType: 'PERCENT', deductValue: 0 },
      { label: 'จุด Bright / ฝุ่นในจอ / ขอบจอเงา', deductType: 'PERCENT', deductValue: 35 },
      { label: 'จุด Dead / จุดสี / ลายเส้น / จอปลอม', deductType: 'PERCENT', deductValue: 70 },
      { label: 'ไม่สามารถแสดงภาพหน้าจอ', deductType: 'PERCENT', deductValue: 85 },
    ],
  },
  {
    key: 'battery',
    title: 'สุขภาพแบตเตอรี่',
    helpText: 'เช็คได้ที่ Settings > Battery > Battery Health',
    selectType: 'SINGLE',
    choices: [
      { label: 'แบตเตอรี่ 80% ขึ้นไป', deductType: 'FIXED', deductValue: 0 },
      { label: 'แบตเตอรี่ต่ำกว่า 80%', deductType: 'FIXED', deductValue: 1500 },
    ],
  },
  {
    key: 'box-accessories',
    title: 'กล่อง / อุปกรณ์',
    selectType: 'SINGLE',
    choices: [
      { label: 'มีกล่อง อุปกรณ์ครบ', deductType: 'FIXED', deductValue: 0 },
      { label: 'มีกล่อง อุปกรณ์ไม่ครบ', deductType: 'FIXED', deductValue: 200 },
      { label: 'ไม่มีกล่อง', deductType: 'FIXED', deductValue: 500 },
    ],
  },
  {
    key: 'functional-issues',
    title: 'ปัญหาการใช้งาน (เลือกได้หลายข้อ — ไม่เลือก = ไม่มีปัญหา)',
    selectType: 'MULTI',
    choices: [
      { label: 'ระบบสัมผัส (ทัชสกรีน)', deductType: 'PERCENT', deductValue: 75 },
      { label: 'WiFi / Bluetooth / GPS', deductType: 'PERCENT', deductValue: 85 },
      { label: 'ระบบสั่น', deductType: 'PERCENT', deductValue: 35 },
      { label: 'โทรออก-รับสาย / ไมค์ มีปัญหา', deductType: 'PERCENT', deductValue: 75 },
      { label: 'Face ID / สแกนนิ้ว', deductType: 'PERCENT', deductValue: 51 },
      { label: 'ลำโพงบน-ล่าง', deductType: 'PERCENT', deductValue: 35 },
      { label: 'กล้องหน้า-หลัง / แฟลช', deductType: 'PERCENT', deductValue: 70 },
      { label: 'Sensor', deductType: 'PERCENT', deductValue: 51 },
      { label: 'ปุ่มล็อก power / volume', deductType: 'PERCENT', deductValue: 35 },
    ],
  },
];

export async function seedBuybackQuestions(prisma: PrismaClient) {
  console.log('Seeding buyback questions...');
  const db = prisma as unknown as PrismaAny;
  let created = 0;
  let skipped = 0;

  for (let qi = 0; qi < questionData.length; qi++) {
    const q = questionData[qi];
    // idempotent by key — นับรวม soft-deleted (ห้ามคืนชีพของที่ owner ลบ)
    const existing = await db.buybackQuestion.findFirst({ where: { key: q.key } });
    if (existing) {
      skipped++;
      continue;
    }
    await db.buybackQuestion.create({
      data: {
        key: q.key,
        title: q.title,
        helpText: q.helpText ?? null,
        selectType: q.selectType,
        sortOrder: qi,
        choices: {
          create: q.choices.map((c, ci) => ({
            label: c.label,
            deductType: c.deductType,
            deductValue: new Prisma.Decimal(c.deductValue),
            sortOrder: ci,
          })),
        },
      },
    });
    created++;
  }
  console.log(`Buyback questions: ${created} created, ${skipped} skipped`);
}
```

- [ ] **Step 2.2: Wire เข้า seed.ts** — เพิ่ม import ใต้บรรทัด 7 (`import { seedTradeInValuations } ...`):

```ts
import { seedBuybackQuestions } from './seeds/buyback-questions';
```
และหลังบรรทัด `await seedTradeInValuations(prisma);` (บรรทัด ~1554) เพิ่ม:
```ts
  await seedBuybackQuestions(prisma);
```

- [ ] **Step 2.3: แก้ dedupe ใน trade-in-valuations.ts** — Edit ที่ `seedTradeInValuations` (บรรทัด ~182):

old_string:
```ts
    const existing = await db.tradeInValuation.findFirst({
      where: {
        brand: entry.brand,
        model: entry.model,
        storage: entry.storage,
        condition: entry.condition,
        deletedAt: null,
      },
    });
```
new_string:
```ts
    // ข้ามถ้า "เคยมี" แถวนี้ (รวม soft-deleted) — seed rerun ต้องไม่คืนชีพ
    // แถวที่ owner ลบไปแล้วด้วยราคา demo (ราคานี้เป็นข้อเสนอเงินสดต่อลูกค้าแล้ว)
    const existing = await db.tradeInValuation.findFirst({
      where: {
        brand: entry.brand,
        model: entry.model,
        storage: entry.storage,
        condition: entry.condition,
      },
    });
```

- [ ] **Step 2.4: รัน seed (ถ้า DB local พร้อม) + commit**

```bash
cd apps/api && npx tsx prisma/seed.ts 2>&1 | grep -i buyback
# Expected: "Buyback questions: 8 created, 0 skipped" (รันซ้ำ → "0 created, 8 skipped")
cd /Users/iamnaii/Desktop/App/BESTCHOICE
git add apps/api/prisma/seeds/buyback-questions.ts apps/api/prisma/seed.ts apps/api/prisma/seeds/trade-in-valuations.ts
git commit -m "feat(api): seed แบบประเมิน buyback 8 กลุ่ม + กัน seed คืนชีพ valuation ที่ถูกลบ"
```
(หมายเหตุ: ถ้า seed.ts รันด้วยคำสั่งอื่นใน repo เช่น `npx prisma db seed` ให้ใช้ตามนั้น — ดู `package.json` prisma.seed)

### Task 3: BuybackPricingService (pricing engine, TDD)

**Files:**
- Create: `apps/api/src/modules/shop-buyback/buyback-pricing.service.ts`
- Test: `apps/api/src/modules/shop-buyback/buyback-pricing.service.spec.ts`

**Interfaces:**
- Produces:
  - `interface DeductSelection { choiceId: string; label: string; deductType: 'PERCENT' | 'FIXED'; deductValue: Prisma.Decimal }`
  - `interface QuoteComputation { maxPrice: Prisma.Decimal; fixedTotal: Prisma.Decimal; pctTotal: Prisma.Decimal; price: Prisma.Decimal; lines: Array<{ label: string; deductType: 'PERCENT' | 'FIXED'; deductValue: string; amount: string }> }`
  - `BuybackPricingService.compute(maxPrice: Prisma.Decimal, selections: DeductSelection[]): QuoteComputation`
  - `BuybackPricingService.gradeFromPct(pctTotal: Prisma.Decimal): 'A' | 'B' | 'C' | 'D'`

- [ ] **Step 3.1: เขียน failing test** — `buyback-pricing.service.spec.ts`:

```ts
import { Prisma } from '@prisma/client';
import { BuybackPricingService, DeductSelection } from './buyback-pricing.service';

const D = (n: number | string) => new Prisma.Decimal(n);
const sel = (
  deductType: 'PERCENT' | 'FIXED',
  deductValue: number,
  label = 'x',
): DeductSelection => ({ choiceId: 'c-' + label, label, deductType, deductValue: D(deductValue) });

describe('BuybackPricingService', () => {
  const svc = new BuybackPricingService();

  it('สภาพสมบูรณ์ (ไม่มีหัก) = maxPrice เต็ม', () => {
    const r = svc.compute(D(14500), []);
    expect(r.price.toNumber()).toBe(14500);
    expect(r.fixedTotal.toNumber()).toBe(0);
    expect(r.pctTotal.toNumber()).toBe(0);
  });

  it('golden yellobe: max 14,500 / หมดประกัน 500 + ไม่มีกล่อง 500 + รอยนิดหน่อย 8% → 12,420', () => {
    const r = svc.compute(D(14500), [
      sel('FIXED', 500, 'หมดประกัน'),
      sel('FIXED', 500, 'ไม่มีกล่อง'),
      sel('PERCENT', 8, 'รอยนิดหน่อย'),
    ]);
    expect(r.price.toNumber()).toBe(12420);
    expect(r.fixedTotal.toNumber()).toBe(1000);
    expect(r.pctTotal.toNumber()).toBe(8);
  });

  it('seed จริง: max 20,000 / fixed 1,000 / pct 8 → 17,480', () => {
    const r = svc.compute(D(20000), [sel('FIXED', 1000), sel('PERCENT', 8)]);
    expect(r.price.toNumber()).toBe(17480);
  });

  it('ปัดลงเหลือหลักสิบ', () => {
    // (9999 - 0) * 1 = 9999 → 9990
    expect(svc.compute(D(9999), []).price.toNumber()).toBe(9990);
  });

  it('Σ% เกิน 100 → clamp ที่ 100 → ราคา 0', () => {
    const r = svc.compute(D(14500), [sel('PERCENT', 75), sel('PERCENT', 85)]);
    expect(r.pctTotal.toNumber()).toBe(100);
    expect(r.price.toNumber()).toBe(0);
  });

  it('fixed เกิน maxPrice → ราคา 0 ไม่ติดลบ', () => {
    expect(svc.compute(D(1000), [sel('FIXED', 1500)]).price.toNumber()).toBe(0);
  });

  it('lines: PERCENT คิดจากยอดหลังหัก fixed', () => {
    const r = svc.compute(D(14500), [sel('FIXED', 1000), sel('PERCENT', 8, 'scratch')]);
    const pctLine = r.lines.find((l) => l.label === 'scratch')!;
    expect(pctLine.amount).toBe('1080.00'); // (14500-1000)*8%
  });

  it.each([
    [0, 'A'],
    [8, 'B'],
    [10, 'B'],
    [18, 'C'],
    [35, 'C'],
    [51, 'D'],
  ])('gradeFromPct(%d) = %s', (pct, grade) => {
    expect(svc.gradeFromPct(D(pct))).toBe(grade);
  });
});
```

- [ ] **Step 3.2: รันให้ fail**

```bash
cd apps/api && npx jest src/modules/shop-buyback/buyback-pricing.service.spec.ts --runInBand
```
Expected: FAIL — `Cannot find module './buyback-pricing.service'`

- [ ] **Step 3.3: Implement** — `buyback-pricing.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export interface DeductSelection {
  choiceId: string;
  label: string;
  deductType: 'PERCENT' | 'FIXED';
  deductValue: Prisma.Decimal;
}

export interface QuoteComputation {
  maxPrice: Prisma.Decimal;
  fixedTotal: Prisma.Decimal;
  pctTotal: Prisma.Decimal;
  price: Prisma.Decimal;
  lines: Array<{
    label: string;
    deductType: 'PERCENT' | 'FIXED';
    deductValue: string;
    amount: string;
  }>;
}

/**
 * Pricing engine ของ buyback instant-quote (yellobe-style):
 *   price = max(floor(((max − Σfixed) × (1 − min(Σpct,100)/100)) / 10) × 10, 0)
 * Decimal ล้วนตาม money rule — ห้ามแตะ TradeInIntakeService.quote() เดิม
 * (ตัวนั้นเป็น Number()+Math.floor ของ EXCHANGE flow ที่ spec เดิม lock ไว้)
 */
@Injectable()
export class BuybackPricingService {
  compute(maxPrice: Prisma.Decimal, selections: DeductSelection[]): QuoteComputation {
    const ZERO = new Prisma.Decimal(0);
    const HUNDRED = new Prisma.Decimal(100);

    let fixedTotal = ZERO;
    let pctSum = ZERO;
    for (const s of selections) {
      if (s.deductType === 'FIXED') fixedTotal = fixedTotal.plus(s.deductValue);
      else pctSum = pctSum.plus(s.deductValue);
    }
    const pctTotal = Prisma.Decimal.min(pctSum, HUNDRED);
    const afterFixed = Prisma.Decimal.max(maxPrice.minus(fixedTotal), ZERO);
    const raw = afterFixed.mul(HUNDRED.minus(pctTotal)).div(HUNDRED);
    const price = Prisma.Decimal.max(raw.div(10).floor().mul(10), ZERO);

    const lines = selections.map((s) => ({
      label: s.label,
      deductType: s.deductType,
      deductValue: s.deductValue.toString(),
      amount: (s.deductType === 'FIXED'
        ? s.deductValue
        : afterFixed.mul(s.deductValue).div(HUNDRED)
      ).toFixed(2),
    }));

    return { maxPrice, fixedTotal, pctTotal, price, lines };
  }

  /** เกรดอิง Σ% เท่านั้น (fixed ไม่มีผล) — ใช้กับ TradeIn.deviceCondition เพื่อ filter/รายงาน */
  gradeFromPct(pctTotal: Prisma.Decimal): 'A' | 'B' | 'C' | 'D' {
    if (pctTotal.lte(0)) return 'A';
    if (pctTotal.lte(10)) return 'B';
    if (pctTotal.lte(35)) return 'C';
    return 'D';
  }
}
```

- [ ] **Step 3.4: รันให้ผ่าน** — คำสั่งเดิมจาก Step 3.2, Expected: PASS ทุกข้อ

- [ ] **Step 3.5: Commit**

```bash
git add apps/api/src/modules/shop-buyback/buyback-pricing.service*.ts
git commit -m "feat(api): BuybackPricingService — สูตร yellobe Decimal + derived grade (TDD)"
```

### Task 4: DTOs ใหม่ + ShopBuybackService เขียนใหม่ (catalog / questions / quote / submit / getStatus)

**Files:**
- Create: `apps/api/src/modules/shop-buyback/dto/quote.dto.ts`
- Rewrite: `apps/api/src/modules/shop-buyback/dto/submit.dto.ts` (มีอยู่? — ไฟล์เดิม import จาก `../shop-trade-in/dto/submit.dto` ดังนั้น**สร้างใหม่**ใน shop-buyback/dto/)
- Rewrite: `apps/api/src/modules/shop-buyback/shop-buyback.service.ts`
- Rewrite: `apps/api/src/modules/shop-buyback/shop-buyback.service.spec.ts` (characterization เดิมของ flow เก่า — แทนด้วยชุดใหม่)
- Modify: `apps/api/src/modules/shop-buyback/shop-buyback.module.ts`
- Delete: `apps/api/src/modules/shop-buyback/dto/quick-quote.dto.ts` (ใน Task 5 หลัง controller เลิกใช้)

**Interfaces:**
- Consumes: `BuybackPricingService.compute/gradeFromPct` (Task 3)
- Produces (ใช้โดย Task 5 controller + Task 7 handshake):
  - `class QuoteAnswerDto { questionKey: string; choiceIds: string[] }`
  - `class BuybackQuoteDto { model: string; storage: string; answers: QuoteAnswerDto[] }`
  - `class SubmitBuybackDto extends BuybackQuoteDto { sellerName; sellerPhone; imei?; notes?; preferredVisitDate?; lineUserId? }`
  - `ShopBuybackService.getCatalog(): Promise<{ models: Array<{ model: string; storages: Array<{ storage: string; maxPrice: string }> }> }>`
  - `ShopBuybackService.getQuestions()` — active questions + choices
  - `ShopBuybackService.quoteForAnswers(model: string, storage: string, answers: QuoteAnswerDto[])` → `{ available: boolean; price?: string; maxPrice?: string; breakdown?: QuoteComputation-json; conditionAnswers?: unknown[]; grade?: 'A'|'B'|'C'|'D' }` (ใช้ซ้ำโดย Task 7 REVISED mode)
  - `ShopBuybackService.submit(dto, customerId?)` → `{ id, status, price }`
  - `ShopBuybackService.getStatus(id)` — เดิม + `estimatedValue, quoteBreakdown, preferredVisitDate`

- [ ] **Step 4.1: DTO** — `dto/quote.dto.ts`:

```ts
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  ValidateNested,
} from 'class-validator';

export class QuoteAnswerDto {
  @IsString()
  @IsNotEmpty({ message: 'กรุณาระบุคำถาม' })
  questionKey!: string;

  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  choiceIds!: string[];
}

export class BuybackQuoteDto {
  @IsString()
  @IsNotEmpty({ message: 'กรุณาระบุรุ่น' })
  model!: string;

  @IsString()
  @IsNotEmpty({ message: 'กรุณาระบุความจุ' })
  storage!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuoteAnswerDto)
  answers!: QuoteAnswerDto[];
}

export class SubmitBuybackDto extends BuybackQuoteDto {
  @IsString()
  @IsNotEmpty({ message: 'กรุณาระบุชื่อผู้ขาย' })
  sellerName!: string;

  @IsString()
  @Matches(/^0\d{9}$/, { message: 'เบอร์โทรต้องเป็นตัวเลข 10 หลักขึ้นต้นด้วย 0' })
  sellerPhone!: string;

  @IsOptional()
  @IsString()
  imei?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsISO8601({}, { message: 'รูปแบบวันที่ไม่ถูกต้อง' })
  preferredVisitDate?: string;

  @IsOptional()
  @IsString()
  lineUserId?: string;
}
```
แล้ว**ลบไฟล์เดิม** `apps/api/src/modules/shop-buyback/dto/submit.dto.ts` ถ้ามี (ของเดิม re-export จาก shop-trade-in) — SubmitBuybackDto ตัวใหม่อยู่ใน quote.dto.ts ไฟล์เดียว

- [ ] **Step 4.2: เขียน failing tests** — แทนที่ `shop-buyback.service.spec.ts` ทั้งไฟล์:

```ts
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ShopBuybackService } from './shop-buyback.service';
import { BuybackPricingService } from './buyback-pricing.service';

const D = (n: number) => new Prisma.Decimal(n);

/** DB fixture: 1 คำถาม SINGLE + 1 คำถาม MULTI + valuation iPhone 15 128GB = 14,500 */
const QUESTIONS = [
  {
    id: 'q1', key: 'warranty', title: 'ประกัน Apple', helpText: null,
    selectType: 'SINGLE', sortOrder: 0, isActive: true, deletedAt: null,
    choices: [
      { id: 'c10', label: 'เหลือ >4 เดือน', deductType: 'FIXED', deductValue: D(0), sortOrder: 0, isActive: true, deletedAt: null },
      { id: 'c11', label: 'หมดประกัน', deductType: 'FIXED', deductValue: D(500), sortOrder: 1, isActive: true, deletedAt: null },
    ],
  },
  {
    id: 'q2', key: 'functional-issues', title: 'ปัญหาการใช้งาน', helpText: null,
    selectType: 'MULTI', sortOrder: 1, isActive: true, deletedAt: null,
    choices: [
      { id: 'c20', label: 'ลำโพง', deductType: 'PERCENT', deductValue: D(35), sortOrder: 0, isActive: true, deletedAt: null },
    ],
  },
];

describe('ShopBuybackService (instant quote)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let line: any;
  let service: ShopBuybackService;

  beforeEach(() => {
    prisma = {
      tradeInValuation: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'v1', brand: 'Apple', model: 'iPhone 15', storage: '128GB',
          condition: 'A', basePrice: D(14500), deletedAt: null,
        }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      buybackQuestion: { findMany: jest.fn().mockResolvedValue(QUESTIONS) },
      tradeIn: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ id: 'ti-1', status: 'PENDING_APPRAISAL', ...data })),
        findUnique: jest.fn().mockResolvedValue(null),
      },
    };
    line = { sendFlexMessage: jest.fn().mockResolvedValue(undefined) };
    service = new ShopBuybackService(prisma, line, new BuybackPricingService());
  });

  const answers = [
    { questionKey: 'warranty', choiceIds: ['c11'] },
    { questionKey: 'functional-issues', choiceIds: [] },
  ];

  describe('quoteForAnswers', () => {
    it('คำนวณราคาเดียว + breakdown: (14500-500)*1 → 14000', async () => {
      const r = await service.quoteForAnswers('iPhone 15', '128GB', answers);
      expect(r.available).toBe(true);
      expect(r.price).toBe('14000.00');
      expect(r.maxPrice).toBe('14500.00');
      expect(r.grade).toBe('A');
      expect(r.breakdown!.lines).toHaveLength(1);
    });

    it('MULTI เลือกได้ → หัก % และเกรดขยับ', async () => {
      const r = await service.quoteForAnswers('iPhone 15', '128GB', [
        { questionKey: 'warranty', choiceIds: ['c11'] },
        { questionKey: 'functional-issues', choiceIds: ['c20'] },
      ]);
      // (14500-500)*(1-0.35) = 9100 → floor10 = 9100
      expect(r.price).toBe('9100.00');
      expect(r.grade).toBe('C');
    });

    it('รุ่นไม่มีในตาราง → available:false ไม่ throw', async () => {
      prisma.tradeInValuation.findFirst.mockResolvedValue(null);
      const r = await service.quoteForAnswers('iPhone 99', '1TB', answers);
      expect(r.available).toBe(false);
    });

    it('SINGLE ไม่ตอบ → BadRequestException', async () => {
      await expect(
        service.quoteForAnswers('iPhone 15', '128GB', [
          { questionKey: 'functional-issues', choiceIds: [] },
        ]),
      ).rejects.toThrow(BadRequestException);
    });

    it('choiceId ไม่อยู่ใต้คำถาม → BadRequestException', async () => {
      await expect(
        service.quoteForAnswers('iPhone 15', '128GB', [
          { questionKey: 'warranty', choiceIds: ['c20'] },
          { questionKey: 'functional-issues', choiceIds: [] },
        ]),
      ).rejects.toThrow(BadRequestException);
    });

    it('questionnaire ว่าง → ราคา = maxPrice', async () => {
      prisma.buybackQuestion.findMany.mockResolvedValue([]);
      const r = await service.quoteForAnswers('iPhone 15', '128GB', []);
      expect(r.price).toBe('14500.00');
    });
  });

  describe('submit', () => {
    const dto = {
      model: 'iPhone 15', storage: '128GB', answers,
      sellerName: 'สมชาย', sellerPhone: '0812345678',
      imei: '111', lineUserId: 'L1',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    it('สร้าง TradeIn snapshot ครบ + คืนราคา', async () => {
      const r = await service.submit(dto, undefined);
      expect(r).toEqual({ id: 'ti-1', status: 'PENDING_APPRAISAL', price: '14000.00' });
      const data = prisma.tradeIn.create.mock.calls[0][0].data;
      expect(data.flow).toBe('BUYBACK');
      expect(data.submissionSource).toBe('ONLINE');
      expect(data.deviceBrand).toBe('Apple');
      expect(data.deviceCondition).toBe('A');
      expect(data.estimatedValue.toString()).toBe('14000');
      expect(data.basePriceAtAppraisal).toBeUndefined(); // spec §5.2 — ห้าม snapshot maxPrice ที่นี่
      expect(data.quoteBreakdown.maxPrice).toBe('14500.00');
      expect(Array.isArray(data.conditionAnswers)).toBe(true);
    });

    it('IMEI ซ้ำใน 24 ชม. → BadRequestException', async () => {
      prisma.tradeIn.findFirst.mockResolvedValue({ id: 'dup' });
      await expect(service.submit(dto, undefined)).rejects.toThrow(BadRequestException);
    });

    it('LINE flex พังต้องไม่ล้ม submit + flex มีราคา', async () => {
      line.sendFlexMessage.mockRejectedValue(new Error('down'));
      const r = await service.submit(dto, undefined);
      expect(r.id).toBe('ti-1');
      expect(JSON.stringify(line.sendFlexMessage.mock.calls[0][1])).toContain('14,000');
    });

    it('รุ่นไม่มีราคา → NotFoundException', async () => {
      prisma.tradeInValuation.findFirst.mockResolvedValue(null);
      await expect(service.submit(dto, undefined)).rejects.toThrow(NotFoundException);
    });
  });

  describe('getCatalog', () => {
    it('group รุ่น + เรียงใหม่→เก่า, unparseable ไปท้าย, ความจุน้อย→มาก', async () => {
      prisma.tradeInValuation.findMany.mockResolvedValue([
        { model: 'iPhone 15', storage: '128GB', basePrice: D(14500) },
        { model: 'iPhone 15', storage: '256GB', basePrice: D(15000) },
        { model: 'iPhone 16 Pro Max', storage: '256GB', basePrice: D(30000) },
        { model: 'iPhone SE 2022', storage: '64GB', basePrice: D(5000) },
        { model: 'iPhone 16 Pro', storage: '256GB', basePrice: D(27000) },
      ]);
      const r = await service.getCatalog();
      expect(r.models.map((m) => m.model)).toEqual([
        'iPhone 16 Pro Max', 'iPhone 16 Pro', 'iPhone 15', 'iPhone SE 2022',
      ]);
      expect(r.models[2].storages.map((s) => s.storage)).toEqual(['128GB', '256GB']);
      expect(r.models[2].storages[0].maxPrice).toBe('14500.00');
    });
  });

  describe('getStatus', () => {
    it('ไม่พบ → NotFoundException; พบ → รวม field ใหม่', async () => {
      await expect(service.getStatus('x')).rejects.toThrow(NotFoundException);
      prisma.tradeIn.findUnique.mockResolvedValue({ id: 'ti-1', estimatedValue: D(14000) });
      const r = await service.getStatus('ti-1');
      expect(r.id).toBe('ti-1');
      const select = prisma.tradeIn.findUnique.mock.calls[1][0].select;
      expect(select.estimatedValue).toBe(true);
      expect(select.quoteBreakdown).toBe(true);
      expect(select.preferredVisitDate).toBe(true);
    });
  });
});
```

- [ ] **Step 4.3: รันให้ fail**

```bash
cd apps/api && npx jest src/modules/shop-buyback/shop-buyback.service.spec.ts --runInBand
```
Expected: FAIL — constructor ใหม่ยังไม่มี (`ShopBuybackService` ยังรับ `TradeInIntakeService`)

- [ ] **Step 4.4: เขียน `shop-buyback.service.ts` ใหม่ทั้งไฟล์:**

```ts
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { LineOaService } from '../line-oa/line-oa.service';
import type { FlexMessagePayload } from '../line-oa/flex-messages/base-template';
import { BuybackPricingService, DeductSelection } from './buyback-pricing.service';
import { QuoteAnswerDto, SubmitBuybackDto } from './dto/quote.dto';

/** เรียงรุ่น iPhone ใหม่→เก่า: gen*10 + (Pro Max 3 / Pro 2 / Plus 1 / base 0); parse ไม่ได้ → null (ไปท้าย) */
export function iphoneModelRank(model: string): number | null {
  const m = /iphone\s+(\d+)/i.exec(model);
  if (!m) return null;
  const lower = model.toLowerCase();
  const variant = lower.includes('pro max') ? 3 : lower.includes('pro') ? 2 : lower.includes('plus') ? 1 : 0;
  return Number(m[1]) * 10 + variant;
}

function storageGb(storage: string): number {
  const m = /(\d+)/.exec(storage);
  return m ? Number(m[1]) * (/tb/i.test(storage) ? 1024 : 1) : 0;
}

/**
 * Buyback instant-quote (yellobe-style) — จงใจ "fork" ออกจาก TradeInIntakeService:
 * intake ตัวเดิมยังเสิร์ฟ /shop/trade-in (EXCHANGE) แบบ byte-identical ห้ามแตะ
 * (spec §7.5). Module นี้มี pricing/submit/flex ของตัวเอง
 */
@Injectable()
export class ShopBuybackService {
  private readonly logger = new Logger(ShopBuybackService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly line: LineOaService,
    private readonly pricing: BuybackPricingService,
  ) {}

  // ─── Catalog ──────────────────────────────────────────────────────────
  async getCatalog() {
    const rows = await this.prisma.tradeInValuation.findMany({
      where: {
        brand: { equals: 'Apple', mode: 'insensitive' },
        model: { startsWith: 'iphone', mode: 'insensitive' },
        condition: 'A',
        deletedAt: null,
      },
      select: { model: true, storage: true, basePrice: true },
    });

    const byModel = new Map<string, Array<{ storage: string; maxPrice: string }>>();
    for (const r of rows) {
      const list = byModel.get(r.model) ?? [];
      list.push({ storage: r.storage, maxPrice: new Prisma.Decimal(r.basePrice).toFixed(2) });
      byModel.set(r.model, list);
    }

    const models = [...byModel.entries()]
      .map(([model, storages]) => ({
        model,
        storages: storages.sort((a, b) => storageGb(a.storage) - storageGb(b.storage)),
      }))
      .sort((a, b) => {
        const ra = iphoneModelRank(a.model);
        const rb = iphoneModelRank(b.model);
        if (ra !== null && rb !== null) return rb - ra;
        if (ra !== null) return -1;
        if (rb !== null) return 1;
        return a.model.localeCompare(b.model); // parse ไม่ได้ → ท้าย, เรียงตามชื่อ
      });

    return { models };
  }

  // ─── Questions ────────────────────────────────────────────────────────
  async getQuestions() {
    const questions = await this.loadActiveQuestions();
    return {
      questions: questions.map((q) => ({
        id: q.id,
        key: q.key,
        title: q.title,
        helpText: q.helpText,
        selectType: q.selectType,
        choices: q.choices.map((c) => ({
          id: c.id,
          label: c.label,
          deductType: c.deductType,
          deductValue: new Prisma.Decimal(c.deductValue).toString(),
        })),
      })),
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async loadActiveQuestions(): Promise<any[]> {
    const rows = await this.prisma.buybackQuestion.findMany({
      where: { isActive: true, deletedAt: null },
      orderBy: { sortOrder: 'asc' },
      include: { choices: { orderBy: { sortOrder: 'asc' } } },
    });
    // choices กรอง active ใน JS (Prisma include+where ซ้อนได้ แต่แบบนี้ mock ง่ายกว่า)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return rows.map((q: any) => ({
      ...q,
      choices: q.choices.filter((c: any) => c.isActive && !c.deletedAt), // eslint-disable-line @typescript-eslint/no-explicit-any
    }));
  }

  // ─── Quote ────────────────────────────────────────────────────────────
  async quoteForAnswers(model: string, storage: string, answers: QuoteAnswerDto[]) {
    const valuation = await this.prisma.tradeInValuation.findFirst({
      where: {
        brand: { equals: 'Apple', mode: 'insensitive' },
        model: { equals: model, mode: 'insensitive' },
        storage: { equals: storage, mode: 'insensitive' },
        condition: 'A',
        deletedAt: null,
      },
    });
    if (!valuation) {
      return { available: false as const };
    }

    const questions = await this.loadActiveQuestions();
    if (questions.length === 0) {
      this.logger.warn('Buyback questionnaire ว่าง — เสนอ maxPrice ตรงๆ');
    }

    const byKey = new Map(answers.map((a) => [a.questionKey, a.choiceIds]));
    const selections: DeductSelection[] = [];
    const conditionAnswers: unknown[] = [];

    for (const q of questions) {
      const chosenIds = byKey.get(q.key) ?? [];
      if (q.selectType === 'SINGLE' && chosenIds.length !== 1) {
        throw new BadRequestException('กรุณาตอบแบบประเมินให้ครบทุกข้อ');
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const chosen = chosenIds.map((id: string) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const c = q.choices.find((x: any) => x.id === id);
        if (!c) throw new BadRequestException('กรุณาตอบแบบประเมินให้ครบทุกข้อ');
        return c;
      });
      for (const c of chosen) {
        selections.push({
          choiceId: c.id,
          label: `${q.title}: ${c.label}`,
          deductType: c.deductType,
          deductValue: new Prisma.Decimal(c.deductValue),
        });
      }
      conditionAnswers.push({
        questionKey: q.key,
        title: q.title,
        selectType: q.selectType,
        choices: chosen.map((c) => ({
          choiceId: c.id,
          label: c.label,
          deductType: c.deductType,
          deductValue: new Prisma.Decimal(c.deductValue).toString(),
        })),
      });
    }

    const maxPrice = new Prisma.Decimal(valuation.basePrice);
    const comp = this.pricing.compute(maxPrice, selections);
    return {
      available: true as const,
      model: valuation.model as string,
      storage: valuation.storage as string,
      price: comp.price.toFixed(2),
      maxPrice: maxPrice.toFixed(2),
      grade: this.pricing.gradeFromPct(comp.pctTotal),
      breakdown: {
        maxPrice: maxPrice.toFixed(2),
        fixedTotal: comp.fixedTotal.toFixed(2),
        pctTotal: comp.pctTotal.toString(),
        price: comp.price.toFixed(2),
        lines: comp.lines,
      },
      conditionAnswers,
    };
  }

  // ─── Submit ───────────────────────────────────────────────────────────
  async submit(dto: SubmitBuybackDto, customerId: string | undefined) {
    if (dto.imei) {
      const dup = await this.prisma.tradeIn.findFirst({
        where: {
          imei: dto.imei,
          sellerPhone: dto.sellerPhone,
          createdAt: { gt: new Date(Date.now() - 24 * 3600_000) },
          deletedAt: null,
        },
      });
      if (dup) throw new BadRequestException('เครื่องนี้อยู่ระหว่างประเมินราคาแล้ว');
    }

    const quote = await this.quoteForAnswers(dto.model, dto.storage, dto.answers);
    if (!quote.available) {
      throw new NotFoundException('รุ่นนี้ยังไม่เปิดรับซื้อออนไลน์');
    }

    const tradeIn = await this.prisma.tradeIn.create({
      data: {
        submissionSource: 'ONLINE',
        flow: 'BUYBACK',
        status: 'PENDING_APPRAISAL',
        deviceBrand: 'Apple',
        deviceModel: quote.model,
        deviceStorage: quote.storage,
        deviceCondition: quote.grade,
        imei: dto.imei,
        customerNotes: dto.notes,
        customerLineId: dto.lineUserId,
        sellerName: dto.sellerName,
        sellerPhone: dto.sellerPhone,
        estimatedValue: new Prisma.Decimal(quote.price!),
        conditionAnswers: quote.conditionAnswers as Prisma.InputJsonValue,
        quoteBreakdown: quote.breakdown as unknown as Prisma.InputJsonValue,
        preferredVisitDate: dto.preferredVisitDate ? new Date(dto.preferredVisitDate) : undefined,
        customerId,
        // basePriceAtAppraisal จงใจไม่ set (spec §5.2) — appraise handshake เป็นคน snapshot
      },
    });

    if (dto.lineUserId) {
      try {
        await this.line.sendFlexMessage(
          dto.lineUserId,
          this.buildQuoteFlex(tradeIn.id, quote.price!),
          'line-shop',
        );
      } catch (err) {
        this.logger.warn(`Failed to send buyback LINE flex: ${(err as Error).message}`);
      }
    }

    return { id: tradeIn.id, status: tradeIn.status, price: quote.price! };
  }

  // ─── Status ───────────────────────────────────────────────────────────
  async getStatus(id: string) {
    const t = await this.prisma.tradeIn.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        offeredPrice: true,
        agreedPrice: true,
        estimatedValue: true,
        quoteBreakdown: true,
        preferredVisitDate: true,
        photoUrls: true,
        deviceBrand: true,
        deviceModel: true,
        deviceStorage: true,
        deviceCondition: true,
        batteryHealth: true,
        flow: true,
        submissionSource: true,
        createdAt: true,
      },
    });
    if (!t) throw new NotFoundException('ไม่พบคำขอ');
    return t;
  }

  private buildQuoteFlex(id: string, price: string): FlexMessagePayload {
    const pretty = Number(price).toLocaleString('th-TH', { maximumFractionDigits: 0 });
    return {
      type: 'flex',
      altText: 'ยืนยันราคารับซื้อแล้ว',
      contents: {
        type: 'bubble',
        body: {
          type: 'box',
          layout: 'vertical',
          contents: [
            { type: 'text', text: 'ราคาที่ประเมิน', weight: 'bold', size: 'lg' },
            { type: 'text', text: `฿${pretty}`, weight: 'bold', size: 'xxl', margin: 'md' },
            { type: 'text', text: `รหัส ${id.slice(0, 8).toUpperCase()}`, margin: 'md' },
            {
              type: 'text',
              text: 'ทีมงานจะติดต่อนัดวันเข้าร้าน — ยืนยันราคาจริงตอนตรวจเครื่อง',
              size: 'xs',
              color: '#888888',
              margin: 'md',
              wrap: true,
            },
          ],
        },
      },
    };
  }
}
```

- [ ] **Step 4.5: อัปเดต module** — `shop-buyback.module.ts` ทั้งไฟล์:

```ts
import { Module } from '@nestjs/common';
import { ShopBuybackController } from './shop-buyback.controller';
import { ShopBuybackService } from './shop-buyback.service';
import { BuybackPricingService } from './buyback-pricing.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { LineOaModule } from '../line-oa/line-oa.module';

// ShopBotDefenseModule is @Global — guard is available without importing.
// จงใจไม่ import TradeInIntakeModule แล้ว (fork ตาม spec §7.5)

@Module({
  imports: [PrismaModule, LineOaModule],
  controllers: [ShopBuybackController],
  providers: [ShopBuybackService, BuybackPricingService],
  exports: [ShopBuybackService, BuybackPricingService],
})
export class ShopBuybackModule {}
```

- [ ] **Step 4.6:** controller ยัง import DTO เก่าอยู่ — จะ error จนถึง Task 5; รัน service spec ก่อน:

```bash
cd apps/api && npx jest src/modules/shop-buyback/shop-buyback.service.spec.ts --runInBand
```
Expected: PASS ทุกข้อ (controller typecheck ค่อยเขียวใน Task 5)

- [ ] **Step 4.7: ยืนยัน trade-in EXCHANGE ไม่กระทบ**

```bash
cd apps/api && npx jest src/modules/shop-trade-in --runInBand && git diff --stat apps/api/src/modules/shop-trade-in/
```
Expected: PASS ทุกข้อ + `git diff` ว่าง (ไม่มีไฟล์ shop-trade-in ถูกแก้)

- [ ] **Step 4.8: Commit**

```bash
git add apps/api/src/modules/shop-buyback/
git commit -m "feat(api): ShopBuybackService instant-quote — catalog/questions/quote/submit fork จาก intake"
```

### Task 5: Controller ใหม่ + throttle + 410 quick-quote + routing test

**Files:**
- Rewrite: `apps/api/src/modules/shop-buyback/shop-buyback.controller.ts`
- Delete: `apps/api/src/modules/shop-buyback/dto/quick-quote.dto.ts`, `apps/api/src/modules/shop-buyback/dto/submit.dto.ts` (ตัวเก่าที่ re-export)
- Test: `apps/api/src/modules/shop-buyback/shop-buyback.routing.spec.ts`

**Interfaces:**
- Consumes: `ShopBuybackService` (Task 4), `BuybackQuoteDto`/`SubmitBuybackDto` (Task 4)
- Produces: routes `GET /shop/buyback/catalog`, `GET /shop/buyback/questions`, `POST /shop/buyback/quote`, `POST /shop/buyback/submit`, `POST /shop/buyback/quick-quote` (410), `GET /shop/buyback/:id` (ท้ายสุด)

- [ ] **Step 5.1: เขียน failing routing test** — `shop-buyback.routing.spec.ts` (supertest มีใน repo แล้วเป็น dependency ของ @nestjs/testing e2e — ถ้า import ไม่ได้ให้ `npm i -D supertest @types/supertest` ใน apps/api):

```ts
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { ShopBuybackController } from './shop-buyback.controller';
import { ShopBuybackService } from './shop-buyback.service';
import { ShopBotDefenseGuard } from '../shop-bot-defense/shop-bot-defense.guard';

/**
 * กัน route-shadowing: static GET (catalog/questions) ต้องไม่โดน @Get(':id') กลืน
 * — unit spec เรียก method ตรงจับบั๊กนี้ไม่ได้ ต้องยิงผ่าน HTTP layer จริง
 */
describe('ShopBuybackController routing', () => {
  let app: INestApplication;
  const service = {
    getCatalog: jest.fn().mockResolvedValue({ models: [] }),
    getQuestions: jest.fn().mockResolvedValue({ questions: [] }),
    getStatus: jest.fn().mockResolvedValue({ id: 'ti-1' }),
    quoteForAnswers: jest.fn(),
    submit: jest.fn(),
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [ShopBuybackController],
      providers: [{ provide: ShopBuybackService, useValue: service }],
    })
      .overrideGuard(ShopBotDefenseGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = mod.createNestApplication();
    await app.init();
  });

  afterAll(async () =>
    await app.close());

  it('GET /shop/buyback/catalog → catalog ไม่ใช่ getStatus', async () => {
    await request(app.getHttpServer()).get('/shop/buyback/catalog').expect(200);
    expect(service.getCatalog).toHaveBeenCalled();
    expect(service.getStatus).not.toHaveBeenCalledWith('catalog');
  });

  it('GET /shop/buyback/questions → questions ไม่ใช่ getStatus', async () => {
    await request(app.getHttpServer()).get('/shop/buyback/questions').expect(200);
    expect(service.getQuestions).toHaveBeenCalled();
    expect(service.getStatus).not.toHaveBeenCalledWith('questions');
  });

  it('GET /shop/buyback/:id ยังทำงาน', async () => {
    await request(app.getHttpServer()).get('/shop/buyback/some-uuid').expect(200);
    expect(service.getStatus).toHaveBeenCalledWith('some-uuid');
  });

  it('POST /shop/buyback/quick-quote → 410 Gone', async () => {
    await request(app.getHttpServer())
      .post('/shop/buyback/quick-quote')
      .send({})
      .expect(410);
  });
});
```

- [ ] **Step 5.2: รันให้ fail** — `cd apps/api && npx jest src/modules/shop-buyback/shop-buyback.routing.spec.ts --runInBand`
Expected: FAIL (controller เดิมยัง compile ไม่ผ่าน/ยังไม่มี route ใหม่)

- [ ] **Step 5.3: เขียน controller ใหม่ทั้งไฟล์:**

```ts
import { Body, Controller, Get, GoneException, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { ShopBuybackService } from './shop-buyback.service';
import { BuybackQuoteDto, SubmitBuybackDto } from './dto/quote.dto';
import { ShopBotDefenseGuard } from '../shop-bot-defense/shop-bot-defense.guard';

/**
 * Buyback instant-quote (yellobe-style) — public storefront, iPhone-only.
 * ⚠️ route order สำคัญ: static GET ทุกตัวต้องมาก่อน @Get(':id')
 */
@Controller('shop/buyback')
@UseGuards(ShopBotDefenseGuard)
export class ShopBuybackController {
  constructor(private service: ShopBuybackService) {}

  @Get('catalog')
  @Throttle({ short: { limit: 60, ttl: 60_000 } })
  getCatalog() {
    return this.service.getCatalog();
  }

  @Get('questions')
  @Throttle({ short: { limit: 60, ttl: 60_000 } })
  getQuestions() {
    return this.service.getQuestions();
  }

  @Post('quote')
  @Throttle({ short: { limit: 60, ttl: 60_000 } })
  quote(@Body() dto: BuybackQuoteDto) {
    return this.service.quoteForAnswers(dto.model, dto.storage, dto.answers);
  }

  @Post('submit')
  @Throttle({ short: { limit: 5, ttl: 60_000 } })
  submit(@Body() dto: SubmitBuybackDto, @Req() req: Request & { user?: { sub?: string } }) {
    return this.service.submit(dto, req.user?.sub);
  }

  /** Endpoint เก่า — คงไว้ 1 release เป็น 410 กัน SPA bundle เก่าใน cache แล้วค่อยลบ */
  @Post('quick-quote')
  quickQuoteGone() {
    throw new GoneException('เวอร์ชันหน้าเว็บเก่าเกินไป กรุณารีเฟรชหน้า (Ctrl+R) แล้วลองใหม่');
  }

  // ⚠️ ต้องอยู่ท้ายสุดเสมอ — ไม่งั้นกลืน catalog/questions
  @Get(':id')
  getStatus(@Param('id') id: string) {
    return this.service.getStatus(id);
  }
}
```
แล้วลบ `dto/quick-quote.dto.ts` + `dto/submit.dto.ts` (เก่า): `git rm apps/api/src/modules/shop-buyback/dto/quick-quote.dto.ts apps/api/src/modules/shop-buyback/dto/submit.dto.ts`

- [ ] **Step 5.4: รันให้ผ่าน + typecheck**

```bash
cd apps/api && npx jest src/modules/shop-buyback --runInBand
./tools/check-types.sh api
```
Expected: PASS ทั้ง module + tsc 0 errors

- [ ] **Step 5.5: Commit**

```bash
git add apps/api/src/modules/shop-buyback/
git commit -m "feat(api): buyback controller ใหม่ — catalog/questions/quote/submit + throttle + 410 quick-quote + routing test"
```

### Task 6: Admin CRUD questionnaire + แก้ route-shadowing เดิมใน trade-ins controller

**Files:**
- Create: `apps/api/src/modules/trade-in/services/buyback-question-admin.service.ts`
- Create: `apps/api/src/modules/trade-in/dto/buyback-question.dto.ts`
- Modify: `apps/api/src/modules/trade-in/trade-in.controller.ts` (ย้าย 4 valuation GET + เพิ่ม CRUD ใหม่ **เหนือ** `@Get(':id')`)
- Modify: `apps/api/src/modules/trade-in/trade-in.module.ts` (provider ใหม่)
- Test: `apps/api/src/modules/trade-in/trade-in.routing.spec.ts`

**Interfaces:**
- Produces (Task 13-14 ฝั่ง web ใช้):
  - `GET /trade-ins/buyback-questions` → `{ questions: [{id,key,title,helpText,selectType,sortOrder,isActive,choices:[{id,label,deductType,deductValue,sortOrder,isActive}]}] }` (รวม inactive, ไม่รวม soft-deleted)
  - `POST /trade-ins/buyback-questions` body `CreateBuybackQuestionDto { key,title,helpText?,selectType,sortOrder? }`
  - `PATCH /trade-ins/buyback-questions/:id` body `UpdateBuybackQuestionDto` (ทุก field optional)
  - `DELETE /trade-ins/buyback-questions/:id` (soft delete + soft delete choices ใต้มัน)
  - `POST /trade-ins/buyback-questions/:id/choices` body `CreateBuybackChoiceDto { label,deductType,deductValue,sortOrder? }`
  - `PATCH /trade-ins/buyback-choices/:id`, `DELETE /trade-ins/buyback-choices/:id`

- [ ] **Step 6.1: DTO** — `dto/buyback-question.dto.ts`:

```ts
import { IsBoolean, IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, Matches, Min } from 'class-validator';

export class CreateBuybackQuestionDto {
  @IsString()
  @Matches(/^[a-z0-9-]+$/, { message: 'key ต้องเป็น a-z 0-9 และ - เท่านั้น' })
  key!: string;

  @IsString()
  @IsNotEmpty({ message: 'กรุณาระบุหัวข้อคำถาม' })
  title!: string;

  @IsOptional()
  @IsString()
  helpText?: string;

  @IsIn(['SINGLE', 'MULTI'])
  selectType!: 'SINGLE' | 'MULTI';

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

export class UpdateBuybackQuestionDto {
  @IsOptional() @IsString() @IsNotEmpty() title?: string;
  @IsOptional() @IsString() helpText?: string;
  @IsOptional() @IsInt() sortOrder?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class CreateBuybackChoiceDto {
  @IsString()
  @IsNotEmpty({ message: 'กรุณาระบุตัวเลือก' })
  label!: string;

  @IsIn(['PERCENT', 'FIXED'])
  deductType!: 'PERCENT' | 'FIXED';

  @IsNumber({}, { message: 'กรุณาระบุค่าหัก' })
  @Min(0, { message: 'ค่าหักต้องไม่ติดลบ' })
  deductValue!: number;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

export class UpdateBuybackChoiceDto {
  @IsOptional() @IsString() @IsNotEmpty() label?: string;
  @IsOptional() @IsIn(['PERCENT', 'FIXED']) deductType?: 'PERCENT' | 'FIXED';
  @IsOptional() @IsNumber() @Min(0) deductValue?: number;
  @IsOptional() @IsInt() sortOrder?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
```

- [ ] **Step 6.2: Admin service** — `services/buyback-question-admin.service.ts`:

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  CreateBuybackChoiceDto,
  CreateBuybackQuestionDto,
  UpdateBuybackChoiceDto,
  UpdateBuybackQuestionDto,
} from '../dto/buyback-question.dto';

/** CRUD แบบประเมิน buyback (แอดมิน) — soft delete เท่านั้น; public read อยู่ที่ shop-buyback */
@Injectable()
export class BuybackQuestionAdminService {
  constructor(private prisma: PrismaService) {}

  async list() {
    const questions = await this.prisma.buybackQuestion.findMany({
      where: { deletedAt: null },
      orderBy: { sortOrder: 'asc' },
      include: {
        choices: { where: { deletedAt: null }, orderBy: { sortOrder: 'asc' } },
      },
    });
    return { questions };
  }

  createQuestion(dto: CreateBuybackQuestionDto) {
    return this.prisma.buybackQuestion.create({
      data: {
        key: dto.key,
        title: dto.title,
        helpText: dto.helpText,
        selectType: dto.selectType,
        sortOrder: dto.sortOrder ?? 0,
      },
    });
  }

  async updateQuestion(id: string, dto: UpdateBuybackQuestionDto) {
    await this.mustFindQuestion(id);
    return this.prisma.buybackQuestion.update({ where: { id }, data: { ...dto } });
  }

  async deleteQuestion(id: string) {
    await this.mustFindQuestion(id);
    const now = new Date();
    return this.prisma.$transaction([
      this.prisma.buybackChoice.updateMany({
        where: { questionId: id, deletedAt: null },
        data: { deletedAt: now },
      }),
      this.prisma.buybackQuestion.update({ where: { id }, data: { deletedAt: now } }),
    ]);
  }

  async createChoice(questionId: string, dto: CreateBuybackChoiceDto) {
    await this.mustFindQuestion(questionId);
    return this.prisma.buybackChoice.create({
      data: {
        questionId,
        label: dto.label,
        deductType: dto.deductType,
        deductValue: new Prisma.Decimal(dto.deductValue),
        sortOrder: dto.sortOrder ?? 0,
      },
    });
  }

  async updateChoice(id: string, dto: UpdateBuybackChoiceDto) {
    const c = await this.prisma.buybackChoice.findFirst({ where: { id, deletedAt: null } });
    if (!c) throw new NotFoundException('ไม่พบตัวเลือก');
    const { deductValue, ...rest } = dto;
    return this.prisma.buybackChoice.update({
      where: { id },
      data: {
        ...rest,
        ...(deductValue !== undefined ? { deductValue: new Prisma.Decimal(deductValue) } : {}),
      },
    });
  }

  async deleteChoice(id: string) {
    const c = await this.prisma.buybackChoice.findFirst({ where: { id, deletedAt: null } });
    if (!c) throw new NotFoundException('ไม่พบตัวเลือก');
    return this.prisma.buybackChoice.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  private async mustFindQuestion(id: string) {
    const q = await this.prisma.buybackQuestion.findFirst({ where: { id, deletedAt: null } });
    if (!q) throw new NotFoundException('ไม่พบคำถาม');
    return q;
  }
}
```

- [ ] **Step 6.3: Routing test (failing ก่อน)** — `trade-in.routing.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { TradeInController } from './trade-in.controller';
import { TradeInService } from './trade-in.service';
import { BuybackQuestionAdminService } from './services/buyback-question-admin.service';
import { PiiAuditService } from '../pii/pii-audit.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BranchGuard } from '../auth/guards/branch.guard';

/**
 * บั๊กเดิมที่ scrutinize เจอ: @Get(':id') ประกาศก่อน static GET → GET
 * /trade-ins/valuations เคยตอบ findOne('valuations') = 404 ทุกครั้ง
 * Test นี้ pin ว่า static ทุกตัว reachable
 */
describe('TradeInController routing', () => {
  let app: INestApplication;
  const tradeInService = {
    findOne: jest.fn().mockResolvedValue({ id: 'x' }),
    listValuations: jest.fn().mockResolvedValue({ data: [], total: 0 }),
    lookupValuation: jest.fn().mockResolvedValue({ found: false }),
    getValuationBrands: jest.fn().mockResolvedValue([]),
    getValuationModels: jest.fn().mockResolvedValue([]),
  };
  const adminService = { list: jest.fn().mockResolvedValue({ questions: [] }) };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [TradeInController],
      providers: [
        { provide: TradeInService, useValue: tradeInService },
        { provide: BuybackQuestionAdminService, useValue: adminService },
        { provide: PiiAuditService, useValue: { logDecryption: jest.fn() } },
      ],
    })
      .overrideGuard(JwtAuthGuard).useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard).useValue({ canActivate: () => true })
      .overrideGuard(BranchGuard).useValue({ canActivate: () => true })
      .compile();
    app = mod.createNestApplication();
    await app.init();
  });

  afterAll(async () => await app.close());

  it.each([
    ['/trade-ins/valuations', 'listValuations'],
    ['/trade-ins/valuation-brands', 'getValuationBrands'],
    ['/trade-ins/valuation-models?brand=Apple', 'getValuationModels'],
  ])('GET %s ไม่โดน :id กลืน', async (path, method) => {
    await request(app.getHttpServer()).get(path).expect(200);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((tradeInService as any)[method]).toHaveBeenCalled();
    expect(tradeInService.findOne).not.toHaveBeenCalled();
  });

  it('GET /trade-ins/buyback-questions → admin list', async () => {
    await request(app.getHttpServer()).get('/trade-ins/buyback-questions').expect(200);
    expect(adminService.list).toHaveBeenCalled();
    expect(tradeInService.findOne).not.toHaveBeenCalled();
  });

  it('GET /trade-ins/:id ยังทำงาน', async () => {
    await request(app.getHttpServer()).get('/trade-ins/some-id').expect(200);
    expect(tradeInService.findOne).toHaveBeenCalledWith('some-id');
  });
});
```
รัน: `cd apps/api && npx jest src/modules/trade-in/trade-in.routing.spec.ts --runInBand` → Expected: FAIL (valuations โดน :id กลืน + ไม่มี buyback-questions)

- [ ] **Step 6.4: แก้ controller** — ใน `trade-in.controller.ts`:
  1. เพิ่ม import: `Delete` จาก `@nestjs/common`, `BuybackQuestionAdminService` + DTO ใหม่ทั้ง 4, และเพิ่ม `private buybackAdmin: BuybackQuestionAdminService` ใน constructor
  2. **ย้าย** block "Valuation table" ทั้งหมด (5 routes: `@Get('valuation')` ... `@Post('valuations')` บรรทัด ~246-296) ขึ้นไปวาง**เหนือ** `@Get(':id')` (บรรทัด ~157) — ห้ามแก้เนื้อใน แค่ย้ายตำแหน่ง
  3. วาง block ใหม่ต่อจาก valuation block (ยังเหนือ `@Get(':id')`):

```ts
  // ─── Buyback questionnaire (แอดมินแบบประเมินรับซื้อออนไลน์) ───────────
  // ⚠️ ต้องอยู่เหนือ @Get(':id') เสมอ (route-shadowing)

  @Get('buyback-questions')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  listBuybackQuestions() {
    return this.buybackAdmin.list();
  }

  @Post('buyback-questions')
  @Roles('OWNER', 'BRANCH_MANAGER')
  createBuybackQuestion(@Body() dto: CreateBuybackQuestionDto) {
    return this.buybackAdmin.createQuestion(dto);
  }

  @Patch('buyback-questions/:id')
  @Roles('OWNER', 'BRANCH_MANAGER')
  updateBuybackQuestion(@Param('id') id: string, @Body() dto: UpdateBuybackQuestionDto) {
    return this.buybackAdmin.updateQuestion(id, dto);
  }

  @Delete('buyback-questions/:id')
  @Roles('OWNER', 'BRANCH_MANAGER')
  deleteBuybackQuestion(@Param('id') id: string) {
    return this.buybackAdmin.deleteQuestion(id);
  }

  @Post('buyback-questions/:id/choices')
  @Roles('OWNER', 'BRANCH_MANAGER')
  createBuybackChoice(@Param('id') id: string, @Body() dto: CreateBuybackChoiceDto) {
    return this.buybackAdmin.createChoice(id, dto);
  }

  @Patch('buyback-choices/:id')
  @Roles('OWNER', 'BRANCH_MANAGER')
  updateBuybackChoice(@Param('id') id: string, @Body() dto: UpdateBuybackChoiceDto) {
    return this.buybackAdmin.updateChoice(id, dto);
  }

  @Delete('buyback-choices/:id')
  @Roles('OWNER', 'BRANCH_MANAGER')
  deleteBuybackChoice(@Param('id') id: string) {
    return this.buybackAdmin.deleteChoice(id);
  }
```

  4. `trade-in.module.ts` — เพิ่ม `BuybackQuestionAdminService` ใน `providers` + import path `./services/buyback-question-admin.service`

- [ ] **Step 6.5: รันให้ผ่าน + regression**

```bash
cd apps/api && npx jest src/modules/trade-in --runInBand
```
Expected: routing spec PASS + spec เดิมของ trade-in ทั้งหมด PASS

- [ ] **Step 6.6: Commit**

```bash
git add apps/api/src/modules/trade-in/
git commit -m "feat(api): buyback-questions admin CRUD + fix route-shadowing (valuations GET 404 bug) + routing test"
```

### Task 7: Appraise handshake — OnlineAppraisalService (§7.4)

**Files:**
- Create: `apps/api/src/modules/trade-in/services/online-appraisal.service.ts`
- Create: `apps/api/src/modules/trade-in/dto/appraise-online.dto.ts`
- Modify: `apps/api/src/modules/trade-in/trade-in.controller.ts` (route `PATCH :id/appraise-online`)
- Modify: `apps/api/src/modules/trade-in/trade-in.module.ts` (import ShopBuybackModule + provider)
- Modify: `apps/api/src/modules/trade-in/services/trade-in-lifecycle.service.ts` (guard เดียว: record มี quoteBreakdown → ห้ามใช้ appraise เดิม)
- Test: `apps/api/src/modules/trade-in/services/online-appraisal.service.spec.ts`

**Interfaces:**
- Consumes: `ShopBuybackService.quoteForAnswers(model, storage, answers)` (Task 4 — export จาก ShopBuybackModule)
- Produces: `PATCH /trade-ins/:id/appraise-online` body `AppraiseOnlineDto { mode: 'AS_ANSWERED'|'REVISED'|'MANUAL'; answers?; offeredPrice?; reason?; notes? }` — Roles OWNER, BRANCH_MANAGER (MANUAL = OWNER เท่านั้น เช็คใน service)

- [ ] **Step 7.1: DTO** — `dto/appraise-online.dto.ts`:

```ts
import { Type } from 'class-transformer';
import { IsArray, IsIn, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';
import { QuoteAnswerDto } from '../../shop-buyback/dto/quote.dto';

export class AppraiseOnlineDto {
  @IsIn(['AS_ANSWERED', 'REVISED', 'MANUAL'], { message: 'mode ไม่ถูกต้อง' })
  mode!: 'AS_ANSWERED' | 'REVISED' | 'MANUAL';

  /** REVISED: คำตอบชุดใหม่ที่ staff แก้หน้างาน */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuoteAnswerDto)
  answers?: QuoteAnswerDto[];

  /** MANUAL (OWNER เท่านั้น): ราคา free-hand */
  @IsOptional()
  @IsNumber({}, { message: 'กรุณาระบุราคา' })
  offeredPrice?: number;

  /** MANUAL: เหตุผล ≥ 3 ตัวอักษร (audited) */
  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
```

- [ ] **Step 7.2: เขียน failing tests** — `services/online-appraisal.service.spec.ts`:

```ts
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { OnlineAppraisalService } from './online-appraisal.service';

const D = (n: number | string) => new Prisma.Decimal(n);

const ONLINE_TRADEIN = {
  id: 'ti-1',
  status: 'PENDING_APPRAISAL',
  appraisalLocked: false,
  firstAppraisedAt: null,
  deviceModel: 'iPhone 15',
  deviceStorage: '128GB',
  estimatedValue: D(12420),
  quoteBreakdown: { maxPrice: '14500.00', price: '12420.00', lines: [] },
  deletedAt: null,
  notes: null,
};

describe('OnlineAppraisalService', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let shopBuyback: any;
  let service: OnlineAppraisalService;

  beforeEach(() => {
    prisma = {
      tradeIn: {
        findFirst: jest.fn().mockResolvedValue({ ...ONLINE_TRADEIN }),
        update: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ ...ONLINE_TRADEIN, ...data })),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    shopBuyback = { quoteForAnswers: jest.fn() };
    service = new OnlineAppraisalService(prisma, shopBuyback);
  });

  it('AS_ANSWERED: offeredPrice = estimatedValue เป๊ะ + snapshot maxPrice + lock', async () => {
    await service.appraiseOnline('ti-1', { mode: 'AS_ANSWERED' }, 'u1', 'BRANCH_MANAGER');
    const data = prisma.tradeIn.update.mock.calls[0][0].data;
    expect(data.offeredPrice.toString()).toBe('12420');
    expect(data.status).toBe('APPRAISED');
    expect(data.appraisalLocked).toBe(true);
    expect(data.basePriceAtAppraisal.toString()).toBe('14500');
    expect(data.appraisedById).toBe('u1');
  });

  it('REVISED: คิดราคาใหม่จาก engine + อัปเดต snapshot + เกรดใหม่', async () => {
    shopBuyback.quoteForAnswers.mockResolvedValue({
      available: true,
      price: '9100.00',
      maxPrice: '14500.00',
      grade: 'C',
      breakdown: { maxPrice: '14500.00', price: '9100.00', lines: [] },
      conditionAnswers: [{ questionKey: 'x' }],
    });
    const answers = [{ questionKey: 'warranty', choiceIds: ['c11'] }];
    await service.appraiseOnline('ti-1', { mode: 'REVISED', answers }, 'u1', 'BRANCH_MANAGER');
    expect(shopBuyback.quoteForAnswers).toHaveBeenCalledWith('iPhone 15', '128GB', answers);
    const data = prisma.tradeIn.update.mock.calls[0][0].data;
    expect(data.offeredPrice.toString()).toBe('9100');
    expect(data.deviceCondition).toBe('C');
    expect(data.estimatedValue.toString()).toBe('9100');
    expect(data.quoteBreakdown.price).toBe('9100.00');
  });

  it('REVISED โดยไม่ส่ง answers → BadRequestException', async () => {
    await expect(
      service.appraiseOnline('ti-1', { mode: 'REVISED' }, 'u1', 'OWNER'),
    ).rejects.toThrow(BadRequestException);
  });

  it('MANUAL: ต้องเป็น OWNER + reason — เขียน audit log', async () => {
    await expect(
      service.appraiseOnline('ti-1', { mode: 'MANUAL', offeredPrice: 5000, reason: 'จอมีตำหนิเพิ่ม' }, 'u1', 'BRANCH_MANAGER'),
    ).rejects.toThrow(ForbiddenException);

    await service.appraiseOnline('ti-1', { mode: 'MANUAL', offeredPrice: 5000, reason: 'จอมีตำหนิเพิ่ม' }, 'u1', 'OWNER');
    expect(prisma.auditLog.create).toHaveBeenCalled();
    const audit = prisma.auditLog.create.mock.calls[0][0].data;
    expect(audit.action).toBe('TRADE_IN_ONLINE_MANUAL_PRICE');
    const data = prisma.tradeIn.update.mock.calls[0][0].data;
    expect(data.offeredPrice.toString()).toBe('5000');
  });

  it('MANUAL ไม่มี reason → BadRequestException', async () => {
    await expect(
      service.appraiseOnline('ti-1', { mode: 'MANUAL', offeredPrice: 5000 }, 'u1', 'OWNER'),
    ).rejects.toThrow(BadRequestException);
  });

  it('record ไม่มี quoteBreakdown → BadRequestException (ให้ใช้ appraise เดิม)', async () => {
    prisma.tradeIn.findFirst.mockResolvedValue({ ...ONLINE_TRADEIN, quoteBreakdown: null });
    await expect(
      service.appraiseOnline('ti-1', { mode: 'AS_ANSWERED' }, 'u1', 'OWNER'),
    ).rejects.toThrow(BadRequestException);
  });

  it('ล็อคแล้ว → เฉพาะ MANUAL+OWNER เท่านั้น', async () => {
    prisma.tradeIn.findFirst.mockResolvedValue({ ...ONLINE_TRADEIN, appraisalLocked: true, firstAppraisedAt: new Date('2026-07-01') });
    await expect(
      service.appraiseOnline('ti-1', { mode: 'AS_ANSWERED' }, 'u1', 'BRANCH_MANAGER'),
    ).rejects.toThrow(ForbiddenException);
    await service.appraiseOnline('ti-1', { mode: 'MANUAL', offeredPrice: 5000, reason: 'ตกลงราคาใหม่' }, 'u1', 'OWNER');
    expect(prisma.tradeIn.update).toHaveBeenCalled();
  });
});
```
รัน: `cd apps/api && npx jest src/modules/trade-in/services/online-appraisal.service.spec.ts --runInBand` → FAIL (module ไม่มี)

- [ ] **Step 7.3: Implement** — `services/online-appraisal.service.ts`:

```ts
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { ShopBuybackService } from '../../shop-buyback/shop-buyback.service';
import { AppraiseOnlineDto } from '../dto/appraise-online.dto';

/**
 * Handshake ยืนยันราคาหน้าร้านของ record ที่มาจาก instant quote (spec §7.4):
 * ข้าม valuation-band ±15% เดิมทั้งหมด — ราคาตรวจสอบได้จาก engine + snapshot
 *  - AS_ANSWERED: สภาพตรงตามตอบ → ใช้ estimatedValue เป๊ะ
 *  - REVISED:     staff แก้คำตอบ → engine คิดใหม่จาก config ปัจจุบัน
 *  - MANUAL:      OWNER + reason (audited) — free-hand
 * Record walk-in / online แบบเก่า (ไม่มี quoteBreakdown) → ใช้ appraise() เดิม
 */
@Injectable()
export class OnlineAppraisalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly shopBuyback: ShopBuybackService,
  ) {}

  async appraiseOnline(id: string, dto: AppraiseOnlineDto, userId: string, userRole: string) {
    const tradeIn = await this.prisma.tradeIn.findFirst({ where: { id, deletedAt: null } });
    if (!tradeIn) throw new NotFoundException('ไม่พบรายการเทรดอิน');
    if (!tradeIn.quoteBreakdown) {
      throw new BadRequestException(
        'รายการนี้ไม่ได้มาจากใบเสนอราคาออนไลน์ — ใช้การประเมินราคาแบบปกติ',
      );
    }
    if (tradeIn.appraisalLocked && dto.mode !== 'MANUAL') {
      throw new ForbiddenException(
        'รายการนี้ถูกตีราคาไปแล้ว — แก้ราคาได้เฉพาะเจ้าของร้านแบบระบุเหตุผล (MANUAL)',
      );
    }
    if (!tradeIn.appraisalLocked && tradeIn.status !== 'PENDING_APPRAISAL') {
      throw new BadRequestException('รายการนี้ไม่อยู่ในสถานะรอประเมิน');
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const breakdown = tradeIn.quoteBreakdown as any;
    const maxPrice = new Prisma.Decimal(breakdown.maxPrice ?? 0);

    let offeredPrice: Prisma.Decimal;
    let extraData: Record<string, unknown> = {};

    if (dto.mode === 'AS_ANSWERED') {
      if (tradeIn.estimatedValue === null) {
        throw new BadRequestException('รายการนี้ไม่มีราคาที่เสนอออนไลน์');
      }
      offeredPrice = new Prisma.Decimal(tradeIn.estimatedValue);
    } else if (dto.mode === 'REVISED') {
      if (!dto.answers || dto.answers.length === 0) {
        throw new BadRequestException('กรุณาส่งคำตอบแบบประเมินชุดใหม่');
      }
      const quote = await this.shopBuyback.quoteForAnswers(
        tradeIn.deviceModel,
        tradeIn.deviceStorage ?? '',
        dto.answers,
      );
      if (!quote.available) {
        throw new BadRequestException('รุ่นนี้ไม่มีราคาในตารางแล้ว — แก้ตารางราคากลางก่อน');
      }
      offeredPrice = new Prisma.Decimal(quote.price!);
      extraData = {
        deviceCondition: quote.grade,
        estimatedValue: new Prisma.Decimal(quote.price!),
        conditionAnswers: quote.conditionAnswers as Prisma.InputJsonValue,
        quoteBreakdown: quote.breakdown as unknown as Prisma.InputJsonValue,
      };
    } else {
      // MANUAL
      if (userRole !== 'OWNER') {
        throw new ForbiddenException('ราคานอกระบบประเมิน — เฉพาะเจ้าของร้าน (OWNER) เท่านั้น');
      }
      if (dto.offeredPrice === undefined || dto.offeredPrice <= 0) {
        throw new BadRequestException('กรุณาระบุราคาที่เสนอ');
      }
      if (!dto.reason || dto.reason.trim().length < 3) {
        throw new BadRequestException('ต้องระบุเหตุผล (อย่างน้อย 3 ตัวอักษร)');
      }
      offeredPrice = new Prisma.Decimal(dto.offeredPrice);
      await this.prisma.auditLog.create({
        data: {
          userId,
          action: 'TRADE_IN_ONLINE_MANUAL_PRICE',
          entity: 'trade_in',
          entityId: id,
          oldValue: {
            estimatedValue: tradeIn.estimatedValue?.toString() ?? null,
            offeredPrice: tradeIn.offeredPrice?.toString() ?? null,
          },
          newValue: { offeredPrice: dto.offeredPrice, reason: dto.reason },
        },
      });
    }

    return this.prisma.tradeIn.update({
      where: { id },
      data: {
        offeredPrice,
        notes: dto.notes ?? tradeIn.notes,
        appraisedById: userId,
        status: 'APPRAISED',
        basePriceAtAppraisal: maxPrice, // deviation analytics เทียบกับ "ราคาสูงสุด" ของใบเสนอ
        appraisalLocked: true,
        firstAppraisedAt: tradeIn.firstAppraisedAt ?? new Date(),
        ...extraData,
      },
    });
  }
}
```

- [ ] **Step 7.4: Guard ใน appraise เดิม** — `trade-in-lifecycle.service.ts` เพิ่มก่อนบรรทัด `// Snapshot the valuation base price...` (หลังจบ if-block ของ appraisalLocked ~บรรทัด 277):

old_string:
```ts
    // Snapshot the valuation base price if we can find one for this spec.
```
new_string:
```ts
    // Instant-quote records (มี quoteBreakdown) ต้องยืนยันผ่าน appraise-online
    // (§7.4) — valuation-band ของ path นี้ใช้เกรด staff ซึ่งไม่สัมพันธ์กับราคา
    // ที่ engine หักไว้ และจะ block/หลุด guard แบบสุ่มตามว่ามีแถวเกรดนั้นไหม
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((tradeIn as any).quoteBreakdown) {
      throw new BadRequestException(
        'รายการนี้มาจากใบเสนอราคาออนไลน์ — กรุณายืนยันราคาผ่านหน้าจอยืนยันราคาออนไลน์',
      );
    }

    // Snapshot the valuation base price if we can find one for this spec.
```

- [ ] **Step 7.5: Controller + module**
  - `trade-in.controller.ts` — วางใต้ `@Patch(':id/appraise')`:

```ts
  /** §7.4 handshake — ยืนยันราคา record ที่มาจาก instant quote (มี quoteBreakdown) */
  @Patch(':id/appraise-online')
  @Roles('OWNER', 'BRANCH_MANAGER')
  appraiseOnline(
    @Param('id') id: string,
    @Body() dto: AppraiseOnlineDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string,
  ) {
    return this.onlineAppraisal.appraiseOnline(id, dto, userId, userRole);
  }
```
  พร้อม import `AppraiseOnlineDto`, `OnlineAppraisalService` + เพิ่ม `private onlineAppraisal: OnlineAppraisalService` ใน constructor
  - `trade-in.module.ts` — `imports: [..., ShopBuybackModule]` (จาก `../shop-buyback/shop-buyback.module`) + providers เพิ่ม `OnlineAppraisalService`
  (ไม่มี circular: ShopBuybackModule ไม่ import อะไรจาก trade-in)

- [ ] **Step 7.6: รันให้ผ่าน + ทั้ง module + typecheck**

```bash
cd apps/api && npx jest src/modules/trade-in src/modules/shop-buyback --runInBand
cd /Users/iamnaii/Desktop/App/BESTCHOICE && ./tools/check-types.sh api
```
Expected: PASS ทั้งหมด (รวม lifecycle spec เดิม — ถ้า lifecycle spec เดิมมี fixture ที่ไม่มี field quoteBreakdown ใน mock object, `undefined` = falsy → guard ไม่สะดุด, ผ่านตามเดิม)

- [ ] **Step 7.7: Commit**

```bash
git add apps/api/src/modules/trade-in/ apps/api/src/modules/shop-buyback/
git commit -m "feat(api): appraise-online handshake 3 โหมด (§7.4) + guard กัน instant-quote เข้า appraise เดิม"
```

### Task 8: ถอด BUYBACK_PHOTO จาก public presign

**Files:**
- Modify: `apps/api/src/modules/storage/shop-upload.controller.ts` (~บรรทัด 100-112)
- Modify: `apps/web-shop/src/hooks/useSignedUpload.ts:4`

- [ ] **Step 8.1:** ใน `shop-upload.controller.ts` — Edit:

old_string:
```ts
const PUBLIC_UPLOAD_KINDS: readonly UploadKind[] = [
  UploadKind.TRADE_IN_PHOTO,
  UploadKind.BUYBACK_PHOTO,
  UploadKind.BANK_SLIP,
  UploadKind.REVIEW_PHOTO,
];
```
new_string:
```ts
// BUYBACK_PHOTO ถูกถอดออก (2026-07): buyback instant-quote ไม่รับรูปแล้ว —
// คง enum value ไว้ให้ record เก่า แต่ปิดช่อง presign นิรนามที่ไร้ผู้เรียก
const PUBLIC_UPLOAD_KINDS: readonly UploadKind[] = [
  UploadKind.TRADE_IN_PHOTO,
  UploadKind.BANK_SLIP,
  UploadKind.REVIEW_PHOTO,
];
```

- [ ] **Step 8.2:** ใน `useSignedUpload.ts` — Edit:

old_string:
```ts
export type UploadKind = 'TRADE_IN_PHOTO' | 'BUYBACK_PHOTO' | 'BANK_SLIP' | 'REVIEW_PHOTO';
```
new_string:
```ts
export type UploadKind = 'TRADE_IN_PHOTO' | 'BANK_SLIP' | 'REVIEW_PHOTO';
```

- [ ] **Step 8.3: ตรวจว่าไม่มีผู้ใช้ค้าง + commit**

```bash
grep -rn "BUYBACK_PHOTO" apps/web-shop/src apps/api/src --include="*.ts" --include="*.tsx" | grep -v "shop-upload.controller"
```
Expected: ว่าง (BuybackSubmitPage ที่เคยใช้จะถูกลบใน Task 10 — ถ้ายังโผล่ให้รอ Task 10 แล้วกลับมารันซ้ำ)
```bash
git add apps/api/src/modules/storage/shop-upload.controller.ts apps/web-shop/src/hooks/useSignedUpload.ts
git commit -m "fix(api): ถอด BUYBACK_PHOTO จาก public presign allowlist"
```

---

## Phase B — web-shop (ลูกค้า)

### Task 9: Types ใหม่ฝั่ง web-shop

**Files:**
- Rewrite: `apps/web-shop/src/types/buyback.ts`

**Interfaces:**
- Produces (Task 10/12 ใช้): `BuybackCatalog`, `BuybackQuestion`, `BuybackQuoteResult`, `BuybackSubmitResponse`, `Buyback` (แก้: `deviceCondition: 'A'|'B'|'C'|'D'|null`, `batteryHealth: number|null`, + `estimatedValue`, `quoteBreakdown`, `preferredVisitDate`)

- [ ] **Step 9.1: เขียนใหม่ทั้งไฟล์:**

```ts
export type BuybackStatus =
  | 'PENDING_APPRAISAL'
  | 'APPRAISED'
  | 'ACCEPTED'
  | 'COMPLETED'
  | 'REJECTED';

export interface BuybackCatalog {
  models: Array<{
    model: string;
    storages: Array<{ storage: string; maxPrice: string }>;
  }>;
}

export interface BuybackChoice {
  id: string;
  label: string;
  deductType: 'PERCENT' | 'FIXED';
  deductValue: string;
}

export interface BuybackQuestion {
  id: string;
  key: string;
  title: string;
  helpText: string | null;
  selectType: 'SINGLE' | 'MULTI';
  choices: BuybackChoice[];
}

export interface BuybackBreakdownLine {
  label: string;
  deductType: 'PERCENT' | 'FIXED';
  deductValue: string;
  amount: string;
}

export interface BuybackBreakdown {
  maxPrice: string;
  fixedTotal: string;
  pctTotal: string;
  price: string;
  lines: BuybackBreakdownLine[];
}

export interface BuybackQuoteResult {
  available: boolean;
  model?: string;
  storage?: string;
  price?: string;
  maxPrice?: string;
  grade?: 'A' | 'B' | 'C' | 'D';
  breakdown?: BuybackBreakdown;
}

export interface BuybackSubmitResponse {
  id: string;
  status: BuybackStatus;
  price: string;
}

export interface Buyback {
  id: string;
  status: BuybackStatus;
  deviceBrand: string;
  deviceModel: string;
  deviceStorage: string | null;
  deviceCondition: 'A' | 'B' | 'C' | 'D' | null;
  batteryHealth: number | null;
  notes?: string | null;
  photoUrls: string[];
  estimatedValue?: number | string | null;
  quoteBreakdown?: BuybackBreakdown | null;
  preferredVisitDate?: string | null;
  offeredPrice?: number | string | null;
  agreedPrice?: number | string | null;
  createdAt: string;
}
```

- [ ] **Step 9.2:** typecheck จะแดงชั่วคราว (หน้าเก่ายังใช้ `BuybackEstimate`) — แก้ใน Task 10; commit รวมกับ Task 10

### Task 10: Wizard `/buyback/quote` ใหม่ + ลบหน้าเก่า + routes

**Files:**
- Create: `apps/web-shop/src/pages/buyback/BuybackQuotePage.tsx`
- Delete: `apps/web-shop/src/pages/buyback/BuybackQuickQuotePage.tsx`, `apps/web-shop/src/pages/buyback/BuybackSubmitPage.tsx`
- Modify: `apps/web-shop/src/App.tsx`

**Interfaces:**
- Consumes: `GET /api/shop/buyback/catalog|questions`, `POST /api/shop/buyback/quote|submit` (Task 5), types (Task 9), copy keys (Task 11 — ใช้ key ตามตาราง Task 11 ได้เลย ทำ Task 11 ก่อนหรือหลังก็ compile ผ่านเมื่อครบคู่)

- [ ] **Step 10.1: สร้าง `BuybackQuotePage.tsx`:**

```tsx
import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { CheckCircle2, ChevronDown, MessageCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { copy } from '@/lib/copy';
import ShopLayout from '@/components/layout/ShopLayout';
import {
  Button,
  Card,
  CardBody,
  CategoryHero,
  Container,
  Input,
  Label,
  LoadingState,
  ErrorState,
  StickyBottomBar,
  StickyBottomBarSpacer,
} from '@/components';
import type {
  BuybackCatalog,
  BuybackQuestion,
  BuybackQuoteResult,
  BuybackSubmitResponse,
} from '@/types/buyback';
import { usePageMeta } from '@/hooks/usePageMeta';

type Answers = Record<string, string[]>;

/** mirror สูตร server ไว้แสดง preview เท่านั้น — ราคาจริงมาจาก POST /quote */
function previewPrice(
  maxPrice: number,
  questions: BuybackQuestion[],
  answers: Answers,
): { price: number; complete: boolean } {
  let fixed = 0;
  let pct = 0;
  let complete = true;
  for (const q of questions) {
    const chosen = answers[q.key] ?? [];
    if (q.selectType === 'SINGLE' && chosen.length !== 1) complete = false;
    for (const id of chosen) {
      const c = q.choices.find((x) => x.id === id);
      if (!c) continue;
      if (c.deductType === 'FIXED') fixed += Number(c.deductValue);
      else pct += Number(c.deductValue);
    }
  }
  pct = Math.min(pct, 100);
  const raw = Math.max(maxPrice - fixed, 0) * (1 - pct / 100);
  return { price: Math.max(Math.floor(raw / 10) * 10, 0), complete };
}

export default function BuybackQuotePage() {
  usePageMeta(copy.buyback.pageTitle, copy.buyback.description);
  const nav = useNavigate();

  const [model, setModel] = useState('');
  const [storage, setStorage] = useState('');
  const [answers, setAnswers] = useState<Answers>({});
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [quote, setQuote] = useState<BuybackQuoteResult | null>(null);
  const [seller, setSeller] = useState({ name: '', phone: '', imei: '', visitDate: '', notes: '' });

  const catalog = useQuery<BuybackCatalog>({
    queryKey: ['buyback-catalog'],
    queryFn: () => api.get<BuybackCatalog>('/api/shop/buyback/catalog').then((r) => r.data),
    staleTime: 5 * 60_000,
  });
  const questionsQ = useQuery<{ questions: BuybackQuestion[] }>({
    queryKey: ['buyback-questions'],
    queryFn: () =>
      api.get<{ questions: BuybackQuestion[] }>('/api/shop/buyback/questions').then((r) => r.data),
    staleTime: 5 * 60_000,
  });

  const models = catalog.data?.models ?? [];
  const storages = models.find((m) => m.model === model)?.storages ?? [];
  const maxPrice = storages.find((s) => s.storage === storage)?.maxPrice ?? null;
  const questions = questionsQ.data?.questions ?? [];

  const answersPayload = useMemo(
    () => questions.map((q) => ({ questionKey: q.key, choiceIds: answers[q.key] ?? [] })),
    [questions, answers],
  );
  const preview = maxPrice ? previewPrice(Number(maxPrice), questions, answers) : null;

  const quoteMutation = useMutation({
    mutationFn: () =>
      api
        .post<BuybackQuoteResult>('/api/shop/buyback/quote', {
          model,
          storage,
          answers: answersPayload,
        })
        .then((r) => r.data),
    onSuccess: (data) => {
      if (!data.available) {
        toast.error(copy.buyback.modelUnavailable);
        return;
      }
      setQuote(data);
    },
    onError: (e: { response?: { data?: { message?: string } } }) =>
      toast.error(e.response?.data?.message ?? copy.buyback.quoteError),
  });

  const submitMutation = useMutation({
    mutationFn: () =>
      api
        .post<BuybackSubmitResponse>('/api/shop/buyback/submit', {
          model,
          storage,
          answers: answersPayload,
          sellerName: seller.name,
          sellerPhone: seller.phone,
          imei: seller.imei || undefined,
          notes: seller.notes || undefined,
          preferredVisitDate: seller.visitDate || undefined,
        })
        .then((r) => r.data),
    onSuccess: (data) => {
      toast.success(copy.buyback.submitSuccess);
      nav(`/buyback/${data.id}`);
    },
    onError: (e: { response?: { data?: { message?: string } } }) =>
      toast.error(e.response?.data?.message ?? copy.buyback.submitError),
  });

  function pick(q: BuybackQuestion, choiceId: string) {
    setQuote(null); // คำตอบเปลี่ยน → ใบเสนอเดิมใช้ไม่ได้
    setAnswers((prev) => {
      const current = prev[q.key] ?? [];
      if (q.selectType === 'SINGLE') {
        // ตอบแล้วเลื่อนไปข้อถัดไปแบบ yellobe
        const idx = questions.findIndex((x) => x.key === q.key);
        setOpenKey(questions[idx + 1]?.key ?? null);
        return { ...prev, [q.key]: [choiceId] };
      }
      return {
        ...prev,
        [q.key]: current.includes(choiceId)
          ? current.filter((x) => x !== choiceId)
          : [...current, choiceId],
      };
    });
  }

  const deviceReady = !!(model && storage && maxPrice);
  const sellerReady = seller.name.trim().length > 0 && /^0\d{9}$/.test(seller.phone);

  if (catalog.isLoading || questionsQ.isLoading) {
    return (
      <ShopLayout>
        <Container narrow className="py-10"><LoadingState /></Container>
      </ShopLayout>
    );
  }
  if (catalog.isError || questionsQ.isError) {
    return (
      <ShopLayout>
        <Container narrow className="py-10"><ErrorState title={copy.buyback.quoteError} /></Container>
      </ShopLayout>
    );
  }

  return (
    <ShopLayout>
      <CategoryHero
        title={copy.buyback.quoteCta}
        breadcrumbs={[{ label: copy.buyback.pageTitle, to: '/buyback' }, { label: 'เช็คราคา' }]}
      />

      <Container narrow className="py-6 md:py-10 space-y-6 leading-snug">
        {/* Step 1: เลือกเครื่อง */}
        <Card variant="elevated">
          <CardBody className="space-y-4 leading-snug">
            <h2 className="font-semibold leading-snug">1. เลือกรุ่น iPhone</h2>
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="bb-model">รุ่น</Label>
                <select
                  id="bb-model"
                  className="w-full h-10 rounded-xl border border-zinc-200 bg-background px-3 text-sm leading-snug"
                  value={model}
                  onChange={(e) => {
                    setModel(e.target.value);
                    setStorage('');
                    setQuote(null);
                  }}
                >
                  <option value="">เลือกรุ่น</option>
                  {models.map((m) => (
                    <option key={m.model} value={m.model}>{m.model}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bb-storage">ความจุ</Label>
                <select
                  id="bb-storage"
                  className="w-full h-10 rounded-xl border border-zinc-200 bg-background px-3 text-sm leading-snug"
                  value={storage}
                  onChange={(e) => {
                    setStorage(e.target.value);
                    setQuote(null);
                  }}
                  disabled={!model}
                >
                  <option value="">เลือกความจุ</option>
                  {storages.map((s) => (
                    <option key={s.storage} value={s.storage}>{s.storage}</option>
                  ))}
                </select>
              </div>
            </div>
            {models.length === 0 && (
              <p className="text-sm text-muted-foreground leading-snug">{copy.buyback.modelUnavailable}</p>
            )}
            {deviceReady && (
              <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 leading-snug">
                <div className="text-sm text-emerald-800">ราคารับซื้อสูงสุด</div>
                <div className="text-3xl font-bold text-emerald-600">
                  ฿{Number(maxPrice).toLocaleString()}
                </div>
              </div>
            )}
          </CardBody>
        </Card>

        {/* Step 2: แบบประเมินสภาพ */}
        {deviceReady && (
          <Card variant="elevated">
            <CardBody className="space-y-3 leading-snug">
              <h2 className="font-semibold leading-snug">2. ประเมินสภาพเครื่อง</h2>
              {questions.map((q, qi) => {
                const chosen = answers[q.key] ?? [];
                const answered = q.selectType === 'SINGLE' ? chosen.length === 1 : true;
                const open = openKey === q.key || (openKey === null && qi === 0 && chosen.length === 0);
                return (
                  <div key={q.key} className="rounded-xl border border-zinc-200">
                    <button
                      type="button"
                      className="w-full flex items-center justify-between gap-2 p-3 text-left leading-snug"
                      aria-expanded={open}
                      onClick={() => setOpenKey(open ? null : q.key)}
                    >
                      <span className="flex items-center gap-2 leading-snug">
                        {answered && chosen.length > 0 && (
                          <CheckCircle2 className="size-4 text-emerald-600" aria-hidden="true" />
                        )}
                        <span className="font-medium">{q.title}</span>
                      </span>
                      <span className="flex items-center gap-2 text-xs text-muted-foreground leading-snug">
                        {q.selectType === 'SINGLE'
                          ? q.choices.find((c) => c.id === chosen[0])?.label ?? 'ยังไม่ได้เลือก'
                          : `มี ${chosen.length} ข้อ`}
                        <ChevronDown className={`size-4 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
                      </span>
                    </button>
                    {open && (
                      <div className="p-3 pt-0 space-y-2">
                        {q.helpText && (
                          <p className="text-xs text-muted-foreground leading-snug">{q.helpText}</p>
                        )}
                        <div
                          className="grid gap-2 sm:grid-cols-2"
                          role={q.selectType === 'SINGLE' ? 'radiogroup' : 'group'}
                          aria-label={q.title}
                        >
                          {q.choices.map((c) => {
                            const selected = chosen.includes(c.id);
                            return (
                              <button
                                key={c.id}
                                type="button"
                                role={q.selectType === 'SINGLE' ? 'radio' : 'checkbox'}
                                aria-checked={selected}
                                onClick={() => pick(q, c.id)}
                                className={`rounded-xl border p-3 text-left text-sm leading-snug transition-colors ${
                                  selected
                                    ? 'border-emerald-500 bg-emerald-50'
                                    : 'border-zinc-200 hover:bg-accent'
                                }`}
                              >
                                {c.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              {preview && preview.complete && !quote && (
                <div className="rounded-xl bg-muted p-3 text-sm leading-snug">
                  ราคาประเมินเบื้องต้น ~฿{preview.price.toLocaleString()} — กด "ดูราคารับซื้อ" เพื่อยืนยัน
                </div>
              )}
            </CardBody>
          </Card>
        )}

        {/* Step 3: ผลประเมิน */}
        {quote?.available && quote.breakdown && (
          <Card variant="outlined">
            <CardBody className="space-y-4 leading-snug">
              <h2 className="font-semibold leading-snug">3. ราคารับซื้อของคุณ</h2>
              <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-4 leading-snug">
                <div className="text-sm text-emerald-800">รับซื้อ {quote.model} {quote.storage}</div>
                <div className="text-4xl font-bold text-emerald-600">
                  ฿{Number(quote.price).toLocaleString()}
                </div>
              </div>
              <div className="space-y-1 text-sm leading-snug">
                <div className="flex justify-between text-muted-foreground">
                  <span>ราคาสูงสุด</span>
                  <span>฿{Number(quote.breakdown.maxPrice).toLocaleString()}</span>
                </div>
                {quote.breakdown.lines
                  .filter((l) => Number(l.amount) > 0)
                  .map((l, i) => (
                    <div key={i} className="flex justify-between text-muted-foreground">
                      <span>
                        {l.label}
                        {l.deductType === 'PERCENT' ? ` (−${Number(l.deductValue)}%)` : ''}
                      </span>
                      <span>−฿{Number(l.amount).toLocaleString()}</span>
                    </div>
                  ))}
              </div>
              <p className="text-xs text-muted-foreground leading-snug">{copy.buyback.priceCondition}</p>

              {/* Step 4: ส่งข้อมูลนัดเข้าร้าน */}
              <div className="space-y-3 border-t border-zinc-200 pt-4">
                <h3 className="font-semibold leading-snug">4. ยืนยันขาย — นัดเข้าร้าน</h3>
                <div className="grid sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="bb-name">{copy.buyback.sellerName} *</Label>
                    <Input
                      id="bb-name"
                      value={seller.name}
                      onChange={(e) => setSeller((s) => ({ ...s, name: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="bb-phone">{copy.buyback.sellerPhone} *</Label>
                    <Input
                      id="bb-phone"
                      inputMode="numeric"
                      value={seller.phone}
                      onChange={(e) => setSeller((s) => ({ ...s, phone: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="bb-imei">IMEI (ถ้ามี)</Label>
                    <Input
                      id="bb-imei"
                      value={seller.imei}
                      onChange={(e) => setSeller((s) => ({ ...s, imei: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="bb-visit">วันที่สะดวกเข้าร้าน (ถ้ามี)</Label>
                    <Input
                      id="bb-visit"
                      type="date"
                      value={seller.visitDate}
                      onChange={(e) => setSeller((s) => ({ ...s, visitDate: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="bb-notes">หมายเหตุ (ถ้ามี)</Label>
                    <Input
                      id="bb-notes"
                      value={seller.notes}
                      onChange={(e) => setSeller((s) => ({ ...s, notes: e.target.value }))}
                    />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground leading-snug">
                  ร้านอยู่ {copy.contact.branchAddress} · {copy.contact.branchHours}
                </p>
                <Button
                  onClick={() => submitMutation.mutate()}
                  disabled={!sellerReady || submitMutation.isPending}
                  loading={submitMutation.isPending}
                  variant="primary"
                  size="lg"
                  fullWidth
                >
                  ยืนยันขาย — รอทีมงานติดต่อนัดวัน
                </Button>
              </div>
            </CardBody>
          </Card>
        )}

        {/* รุ่นไม่เปิดรับซื้อ → ชวนทักไลน์ */}
        {model && storages.length === 0 && (
          <Card variant="outlined">
            <CardBody className="space-y-3 leading-snug">
              <p className="text-sm text-muted-foreground leading-snug">{copy.buyback.modelUnavailable}</p>
              <Button asChild variant="outline" fullWidth>
                <a href="https://line.me/R/ti/p/@bestchoice" target="_blank" rel="noreferrer">
                  <MessageCircle className="size-4" aria-hidden="true" />
                  สอบถามราคาทางไลน์
                </a>
              </Button>
            </CardBody>
          </Card>
        )}
      </Container>

      <StickyBottomBar>
        <Button
          onClick={() => quoteMutation.mutate()}
          disabled={!deviceReady || !preview?.complete || quoteMutation.isPending || !!quote}
          loading={quoteMutation.isPending}
          variant="primary"
          size="lg"
          fullWidth
        >
          {quote ? 'เลื่อนลงเพื่อยืนยันขาย' : preview?.complete ? 'ดูราคารับซื้อ' : 'ตอบแบบประเมินให้ครบก่อน'}
        </Button>
      </StickyBottomBar>
      <StickyBottomBarSpacer />
    </ShopLayout>
  );
}
```
หมายเหตุ implementer: ตรวจ prop จริงของ `Button` (`loading`/`fullWidth` ใช้อยู่แล้วใน BuybackQuickQuotePage เดิม — ถ้าชื่อไม่ตรงให้ยึดตามหน้าเดิม) และ `copy.contact.branchAddress/branchHours` มีอยู่แล้วใน copy.ts (`branchAddress: shopInfo.address`)

- [ ] **Step 10.2: Routes** — ใน `App.tsx`:
  1. แก้ import: ลบ `BuybackQuickQuotePage`, `BuybackSubmitPage`; เพิ่ม `BuybackQuotePage`; แก้บรรทัด 2 เป็น `import { Routes, Route, useLocation, Navigate } from 'react-router';`
  2. แก้ routes:

old_string:
```tsx
        <Route path="/buyback" element={<BuybackLandingPage />} />
        <Route path="/buyback/quote" element={<BuybackQuickQuotePage />} />
        <Route path="/buyback/submit" element={<BuybackSubmitPage />} />
        <Route path="/buyback/:id" element={<BuybackStatusPage />} />
```
new_string:
```tsx
        <Route path="/buyback" element={<BuybackLandingPage />} />
        <Route path="/buyback/quote" element={<BuybackQuotePage />} />
        {/* หน้า submit เดิมถูกยุบเข้า wizard — กันลิงก์เก่า */}
        <Route path="/buyback/submit" element={<Navigate to="/buyback/quote" replace />} />
        <Route path="/buyback/:id" element={<BuybackStatusPage />} />
```
  3. ลบไฟล์: `git rm apps/web-shop/src/pages/buyback/BuybackQuickQuotePage.tsx apps/web-shop/src/pages/buyback/BuybackSubmitPage.tsx`

- [ ] **Step 10.3: Build + commit** (copy keys ใหม่จะยังแดงจนทำ Task 11 — ทำ Task 11 ต่อทันทีแล้วค่อยรัน build; ถ้าต้องการ commit แยก ให้เพิ่ม key ใน Task 11 ก่อนแล้วกลับมา commit Task 9+10+11 พร้อมกัน)

### Task 11: Copy + Landing + Nav labels

**Files:**
- Modify: `apps/web-shop/src/lib/copy.ts` (block `buyback:` บรรทัด ~185-208 + home keys ~60-62)
- Rewrite: `apps/web-shop/src/pages/buyback/BuybackLandingPage.tsx`
- Modify: `apps/web-shop/src/components/layout/ShopHeader.tsx:8`, `apps/web-shop/src/components/layout/ShopFooter.tsx` (ลิงก์ "รับซื้อมือถือ")

- [ ] **Step 11.1: copy.ts** — แทนที่ block `buyback: { ... }` ทั้งก้อนด้วย:

```ts
  buyback: {
    pageTitle: 'รับซื้อ iPhone',
    description: 'ขาย iPhone รู้ราคาทันทีใน 1 นาที ตอบแบบประเมินสภาพ เห็นราคาชัดเจน มารับเงินสดที่ร้าน',
    quoteCta: 'เช็คราคารับซื้อ',
    submitCta: 'ยืนยันขาย',
    sellerName: 'ชื่อ-นามสกุล',
    sellerPhone: 'เบอร์โทร (10 หลัก)',
    submitSuccess: 'ยืนยันการขายแล้ว ทีมงานจะติดต่อนัดวันเข้าร้าน',
    submitError: 'ส่งเรื่องไม่สำเร็จ กรุณาลองใหม่',
    quoteError: 'ประเมินราคาไม่สำเร็จ',
    priceCondition: 'ราคานี้ยืนยันจริงตอนตรวจเครื่องที่ร้าน หากสภาพตรงตามที่ตอบ — ปฏิเสธการขายได้ ไม่มีค่าใช้จ่าย',
    modelUnavailable: 'รุ่นนี้ยังไม่เปิดรับซื้อออนไลน์ ทักไลน์สอบถามราคาได้เลย',
    statusTitle: 'สถานะการรับซื้อ',
    statusNotFound: 'ไม่พบข้อมูลเรื่องรับซื้อ',
    acceptPrice: 'ยอมรับราคา',
    rejectPrice: 'ปฏิเสธ',
    followUp: 'ทีมงานจะติดต่อนัดวันเข้าร้านทาง LINE/โทรศัพท์',
    quotedTitle: 'ราคาที่ยืนยันแล้ว',
    visitStep: 'เข้าร้านตรวจเครื่อง รับเงินสดทันที',
  },
```
(key ที่หายไป — `stepDevice/stepCondition/stepPhotos/stepSeller/quoteSuccess/realPriceCta/photosRequired/sellerLineId` — ถูกลบเพราะหน้าเดียวที่ใช้ถูกลบใน Task 10; หลังแก้ให้รัน `grep -rn "buyback\.\(stepPhotos\|realPriceCta\|photosRequired\|stepDevice\|stepCondition\|stepSeller\|quoteSuccess\|sellerLineId\)" apps/web-shop/src` → ต้องว่าง)

- [ ] **Step 11.2: home keys** — Edit:

old_string:
```ts
    serviceBuybackTitle: 'รับซื้อมือถือ',
    serviceBuybackDescription: 'ขายเครื่องรับเงินสดหรือโอนทันที ตีราคาเบื้องต้นออนไลน์ได้เลย',
    serviceBuybackCta: 'ขายเครื่อง',
```
new_string:
```ts
    serviceBuybackTitle: 'รับซื้อ iPhone',
    serviceBuybackDescription: 'ขาย iPhone รู้ราคาทันที ตอบแบบประเมินสภาพออนไลน์ มารับเงินสดที่ร้าน',
    serviceBuybackCta: 'เช็คราคา',
```

- [ ] **Step 11.3: Nav labels**
  - `ShopHeader.tsx` — old: `  { to: '/buyback', label: 'รับซื้อมือถือ' },` → new: `  { to: '/buyback', label: 'รับซื้อ iPhone' },`
  - `ShopFooter.tsx` — old: `<li><Link to="/buyback">รับซื้อมือถือ</Link></li>` → new: `<li><Link to="/buyback">รับซื้อ iPhone</Link></li>`

- [ ] **Step 11.4: Landing ใหม่** — `BuybackLandingPage.tsx` ทั้งไฟล์:

```tsx
import { Banknote, ClipboardCheck, Store } from 'lucide-react';
import { copy } from '@/lib/copy';
import ShopLayout from '@/components/layout/ShopLayout';
import { Card, CardBody, Container, LandingHero } from '@/components';
import { usePageMeta } from '@/hooks/usePageMeta';

const TRUST_POINTS = [
  { title: 'ราคามาตรฐาน ไม่ต้องต่อรอง', description: 'ทุกคำตอบมีราคากำกับชัดเจน เห็น breakdown ทุกรายการหัก' },
  { title: 'ตรวจเครื่องต่อหน้า ปฏิเสธได้', description: 'ยืนยันราคาจริงตอนตรวจเครื่องที่ร้าน ไม่พอใจราคายกเลิกได้ ฟรี' },
  { title: 'ลบข้อมูลให้ฟรี ปลอดภัย', description: 'ทีมงานช่วยสำรอง/ลบข้อมูลก่อนขาย ใช้บัตรประชาชนใบเดียว' },
];

export default function BuybackLandingPage() {
  usePageMeta(
    copy.buyback.pageTitle,
    'รับซื้อ iPhone มือสอง ลพบุรี รู้ราคาทันทีออนไลน์ จ่ายเงินสดที่ร้าน ราคามาตรฐานไม่ต้องต่อรอง',
  );

  return (
    <ShopLayout>
      <LandingHero
        eyebrow="บริการเสริม"
        title="ขาย iPhone รู้ราคาใน 1 นาที"
        description={copy.buyback.description}
        cta={{ label: copy.buyback.quoteCta, to: '/buyback/quote' }}
        steps={[
          {
            icon: <ClipboardCheck className="size-8" aria-hidden="true" />,
            title: 'เช็คราคาออนไลน์',
            description: 'เลือกรุ่น ตอบแบบประเมินสภาพ เห็นราคาทันที',
          },
          {
            icon: <Banknote className="size-8" aria-hidden="true" />,
            title: 'ยืนยันการขาย',
            description: 'ส่งชื่อ-เบอร์ นัดวันเข้าร้าน',
          },
          {
            icon: <Store className="size-8" aria-hidden="true" />,
            title: 'มาที่ร้าน รับเงินสด',
            description: 'ตรวจเครื่องต่อหน้า จ่ายทันที',
          },
        ]}
      />
      <Container narrow className="py-8 md:py-12">
        <div className="grid gap-3 sm:grid-cols-3">
          {TRUST_POINTS.map((t) => (
            <Card key={t.title} variant="outlined">
              <CardBody className="space-y-1 leading-snug">
                <div className="font-semibold leading-snug">{t.title}</div>
                <p className="text-sm text-muted-foreground leading-snug">{t.description}</p>
              </CardBody>
            </Card>
          ))}
        </div>
      </Container>
    </ShopLayout>
  );
}
```

- [ ] **Step 11.5: Build + commit Tasks 9-11**

```bash
cd apps/web-shop && npm run build
```
Expected: build ผ่าน 0 errors
```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE
git add apps/web-shop/src/types/buyback.ts apps/web-shop/src/pages/buyback/ apps/web-shop/src/App.tsx apps/web-shop/src/lib/copy.ts apps/web-shop/src/components/layout/ShopHeader.tsx apps/web-shop/src/components/layout/ShopFooter.tsx
git commit -m "feat(web-shop): wizard รับซื้อ iPhone รู้ราคาทันที + landing/nav ใหม่ + ลบหน้า quick-quote/submit เก่า"
```

### Task 12: BuybackStatusPage สอง mode

**Files:**
- Modify: `apps/web-shop/src/pages/buyback/BuybackStatusPage.tsx`

**Interfaces:**
- Consumes: `Buyback` type ใหม่ (Task 9) — record ใหม่มี `quoteBreakdown`/`estimatedValue`, `batteryHealth` = null

- [ ] **Step 12.1: แก้ 4 จุด:**

  1. Stepper + copy ตาม mode — เพิ่มตัวแปรหลัง `const agreed = ...` (บรรทัด ~91):
```tsx
  const isInstantQuote = !!data.quoteBreakdown;
  const estimated = priceValue(data.estimatedValue);
```
  2. แทน `<Stepper steps={[...]} ... />` (บรรทัด ~106-113) ด้วย:
```tsx
          <Stepper
            steps={
              isInstantQuote
                ? [{ label: 'ยืนยันราคาแล้ว' }, { label: 'เข้าร้านตรวจเครื่อง' }, { label: 'เสร็จสิ้น' }]
                : [{ label: 'รอประเมิน' }, { label: 'เสนอราคา' }, { label: 'สรุป' }]
            }
            current={statusToStep(data.status)}
          />
```
  3. Card ราคา — แทรก card ใหม่**ก่อน** block `{offered !== null && (` (บรรทัด ~122):
```tsx
          {isInstantQuote && estimated !== null && (
            <Card variant="elevated" className="bg-emerald-50 border-emerald-200">
              <CardBody className="space-y-2 leading-snug">
                <div className="text-sm font-medium text-emerald-800 leading-snug">
                  {copy.buyback.quotedTitle}
                </div>
                <div className="text-4xl font-bold text-emerald-600 leading-snug">
                  ฿{estimated.toLocaleString()}
                </div>
                {data.quoteBreakdown && (
                  <div className="space-y-0.5 text-xs text-emerald-800 leading-snug">
                    <div className="flex justify-between">
                      <span>ราคาสูงสุด</span>
                      <span>฿{Number(data.quoteBreakdown.maxPrice).toLocaleString()}</span>
                    </div>
                    {data.quoteBreakdown.lines
                      .filter((l) => Number(l.amount) > 0)
                      .map((l, i) => (
                        <div key={i} className="flex justify-between">
                          <span>{l.label}</span>
                          <span>−฿{Number(l.amount).toLocaleString()}</span>
                        </div>
                      ))}
                  </div>
                )}
                <p className="text-xs text-emerald-800 leading-snug">{copy.buyback.priceCondition}</p>
              </CardBody>
            </Card>
          )}
```
     และแก้เงื่อนไข card เดิมจาก `{offered !== null && (` เป็น `{!isInstantQuote && offered !== null && (` (record instant-quote ที่ staff ยืนยันแล้ว offeredPrice จะโชว์ผ่าน STATUS_LABEL='ประเมินราคาแล้ว' — เพิ่มบรรทัดใน card instant-quote: หลัง `<p ...priceCondition...>` แทรก `{offered !== null && offered !== estimated && (<p className="text-xs font-semibold text-emerald-900 leading-snug">ราคายืนยันหน้าร้าน: ฿{offered.toLocaleString()}</p>)}`)
  4. บรรทัดเกรด/แบต (บรรทัด ~145-147) — แทน:
```tsx
              <div className="text-sm text-muted-foreground leading-snug">
                {data.deviceCondition && <>เกรด {data.deviceCondition}</>}
                {data.batteryHealth !== null && data.batteryHealth !== undefined && (
                  <> · แบตเตอรี่ {data.batteryHealth}%</>
                )}
              </div>
```
  5. `STATUS_LABEL.PENDING_APPRAISAL` ปล่อยไว้ (ใช้กับ record เก่า) แต่ป้าย Badge ของ instant-quote: แทนบรรทัด `{STATUS_LABEL[data.status] ?? data.status}` ด้วย:
```tsx
              {data.status === 'PENDING_APPRAISAL' && isInstantQuote
                ? 'ยืนยันราคาแล้ว — รอนัดเข้าร้าน'
                : STATUS_LABEL[data.status] ?? data.status}
```

- [ ] **Step 12.2: Build + commit**

```bash
cd apps/web-shop && npm run build && cd /Users/iamnaii/Desktop/App/BESTCHOICE
git add apps/web-shop/src/pages/buyback/BuybackStatusPage.tsx
git commit -m "feat(web-shop): status page สอง mode — instant-quote แสดง breakdown, guard แบต null"
```

---

## Phase C — apps/web (staff แอดมิน)

### Task 13: TradeInPage แท็บใหม่ + ตารางราคากลาง (valuations CRUD UI — สร้างใหม่ ของเดิมไม่มี)

**Files:**
- Modify: `apps/web/src/pages/TradeInPage/index.tsx`
- Create: `apps/web/src/pages/TradeInPage/components/ValuationsTab.tsx`

**Interfaces:**
- Consumes: `GET /trade-ins/valuations?brand=&model=&page=&limit=` → `{data:[{id,brand,model,storage,condition,basePrice,note}],total,page,limit}`, `POST /trade-ins/valuations` body `{brand,model,storage,condition,basePrice,note?}` (upsert) — ใช้งานได้จริงหลัง Task 6 แก้ route-shadowing
- Produces: แท็บ 3 อัน `[รายการรับซื้อ | ตารางราคากลาง | แบบประเมินออนไลน์]` — 2 แท็บหลัง canManage (OWNER/BM) เท่านั้น

- [ ] **Step 13.1: สร้าง `ValuationsTab.tsx`:**

```tsx
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface ValuationRow {
  id: string;
  brand: string;
  model: string;
  storage: string;
  condition: string;
  basePrice: string | number;
  note: string | null;
}

interface ValuationsResponse {
  data: ValuationRow[];
  total: number;
  page: number;
  limit: number;
}

const EMPTY_FORM = { brand: 'Apple', model: '', storage: '', condition: 'A', basePrice: '' };

/**
 * ตารางราคากลาง (TradeInValuation CRUD) — แถว condition A ของ Apple/iPhone
 * = "ราคารับซื้อสูงสุด" ที่ลูกค้าเห็นบนเว็บ shop ทันที
 */
export default function ValuationsTab() {
  const queryClient = useQueryClient();
  const [brand, setBrand] = useState('Apple');
  const [page, setPage] = useState(1);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [form, setForm] = useState(EMPTY_FORM);

  const { data, isLoading } = useQuery<ValuationsResponse>({
    queryKey: ['trade-in-valuations', brand, page],
    queryFn: () =>
      api
        .get('/trade-ins/valuations', { params: { brand: brand || undefined, page, limit: 50 } })
        .then((r) => r.data),
  });

  const upsert = useMutation({
    mutationFn: (body: { brand: string; model: string; storage: string; condition: string; basePrice: number }) =>
      api.post('/trade-ins/valuations', body),
    onSuccess: () => {
      toast.success('บันทึกราคาแล้ว');
      queryClient.invalidateQueries({ queryKey: ['trade-in-valuations'] });
      setForm(EMPTY_FORM);
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  function saveRow(row: ValuationRow) {
    const price = Number(edits[row.id]);
    if (!Number.isFinite(price) || price <= 0) {
      toast.error('กรุณาระบุราคาให้ถูกต้อง');
      return;
    }
    upsert.mutate({
      brand: row.brand,
      model: row.model,
      storage: row.storage,
      condition: row.condition,
      basePrice: price,
    });
    setEdits((e) => {
      const { [row.id]: _, ...rest } = e;
      return rest;
    });
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-warning/10 p-3 text-sm leading-snug">
        ⚠️ แถว Apple + เกรด A ของรุ่น iPhone = <strong>ราคารับซื้อสูงสุด</strong> ที่ลูกค้าเห็นบนเว็บทันที
        และราคาชุดนี้ยังใช้กับ quote เก่าแลกใหม่ + กรอบ ±15% ของการตีราคาหน้าร้านด้วย
      </div>

      <div className="flex items-end gap-3 flex-wrap">
        <div>
          <Label>ยี่ห้อ</Label>
          <Input className="mt-1 w-40" value={brand} onChange={(e) => { setBrand(e.target.value); setPage(1); }} placeholder="เช่น Apple" />
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground leading-snug">กำลังโหลด...</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left">
              <tr>
                <th className="p-2">ยี่ห้อ</th>
                <th className="p-2">รุ่น</th>
                <th className="p-2">ความจุ</th>
                <th className="p-2">เกรด</th>
                <th className="p-2">ราคา (บาท)</th>
                <th className="p-2 w-24"></th>
              </tr>
            </thead>
            <tbody>
              {(data?.data ?? []).map((row) => (
                <tr key={row.id} className="border-t border-border">
                  <td className="p-2">{row.brand}</td>
                  <td className="p-2">{row.model}</td>
                  <td className="p-2">{row.storage}</td>
                  <td className="p-2">{row.condition}</td>
                  <td className="p-2">
                    <Input
                      className="w-28 h-8"
                      type="number"
                      value={edits[row.id] ?? String(Number(row.basePrice))}
                      onChange={(e) => setEdits((prev) => ({ ...prev, [row.id]: e.target.value }))}
                    />
                  </td>
                  <td className="p-2">
                    {edits[row.id] !== undefined && (
                      <Button size="sm" onClick={() => saveRow(row)} disabled={upsert.isPending}>
                        บันทึก
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
              {(data?.data ?? []).length === 0 && (
                <tr><td colSpan={6} className="p-4 text-center text-muted-foreground">ไม่มีข้อมูล</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {(data?.total ?? 0) > 50 && (
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>ก่อนหน้า</Button>
          <Button variant="outline" size="sm" disabled={page * 50 >= (data?.total ?? 0)} onClick={() => setPage((p) => p + 1)}>ถัดไป</Button>
        </div>
      )}

      <div className="rounded-lg border border-border p-3 space-y-3">
        <div className="font-medium leading-snug">เพิ่มรุ่น / ราคาใหม่</div>
        <div className="grid gap-3 sm:grid-cols-5">
          <div><Label>ยี่ห้อ</Label><Input className="mt-1" value={form.brand} onChange={(e) => setForm((f) => ({ ...f, brand: e.target.value }))} /></div>
          <div><Label>รุ่น</Label><Input className="mt-1" placeholder="iPhone 15" value={form.model} onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))} /></div>
          <div><Label>ความจุ</Label><Input className="mt-1" placeholder="128GB" value={form.storage} onChange={(e) => setForm((f) => ({ ...f, storage: e.target.value }))} /></div>
          <div>
            <Label>เกรด</Label>
            <select
              className="mt-1 w-full h-10 rounded-lg border border-input bg-background px-3 text-sm"
              value={form.condition}
              onChange={(e) => setForm((f) => ({ ...f, condition: e.target.value }))}
            >
              <option value="A">A (= ราคาสูงสุดบนเว็บ)</option>
              <option value="B">B</option>
              <option value="C">C</option>
              <option value="D">D</option>
            </select>
          </div>
          <div><Label>ราคา (บาท)</Label><Input className="mt-1" type="number" value={form.basePrice} onChange={(e) => setForm((f) => ({ ...f, basePrice: e.target.value }))} /></div>
        </div>
        <Button
          onClick={() => {
            const price = Number(form.basePrice);
            if (!form.model || !form.storage || !Number.isFinite(price) || price <= 0) {
              toast.error('กรอกรุ่น/ความจุ/ราคาให้ครบ');
              return;
            }
            upsert.mutate({ brand: form.brand, model: form.model, storage: form.storage, condition: form.condition, basePrice: price });
          }}
          disabled={upsert.isPending}
        >
          เพิ่ม
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 13.2: เพิ่มแท็บใน `TradeInPage/index.tsx`:**
  1. import เพิ่ม: `import ValuationsTab from './components/ValuationsTab';` และ (เผื่อ Task 14) `import QuestionnaireTab from './components/QuestionnaireTab';`
  2. เพิ่ม state ใต้ `const canManage = ...`:
```tsx
  const [tab, setTab] = useState<'list' | 'valuations' | 'questions'>('list');
```
  3. ใต้ `<PageHeader ... />` (หลังปิด prop) แทรกแถบแท็บ:
```tsx
      {canManage && (
        <div className="flex items-center gap-1.5 mb-4">
          {(
            [
              ['list', 'รายการรับซื้อ'],
              ['valuations', 'ตารางราคากลาง'],
              ['questions', 'แบบประเมินออนไลน์'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`px-3 py-1.5 rounded-md text-sm leading-snug transition-colors ${
                tab === key
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-accent'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {tab === 'valuations' && <ValuationsTab />}
      {tab === 'questions' && <QuestionnaireTab />}
```
  4. ครอบเนื้อหาเดิมทั้งหมด (ตั้งแต่ filter chips `<div className="flex flex-wrap items-center gap-4 mb-4">` จนถึง `<AcceptModal ... />`) ด้วย `{tab === 'list' && (<> ... </>)}`
  (SALES: canManage=false → ไม่เห็นแถบแท็บ, tab ค้าง 'list' — พฤติกรรมเดิมทุกอย่าง)

- [ ] **Step 13.3:** typecheck จะแดงจนมี QuestionnaireTab (Task 14) — ทำ Task 14 ต่อแล้ว commit พร้อมกัน

### Task 14: แท็บแบบประเมินออนไลน์ (questionnaire editor)

**Files:**
- Create: `apps/web/src/pages/TradeInPage/components/QuestionnaireTab.tsx`

**Interfaces:**
- Consumes (Task 6): `GET /trade-ins/buyback-questions`, `PATCH /trade-ins/buyback-questions/:id`, `POST /trade-ins/buyback-questions/:id/choices`, `PATCH /trade-ins/buyback-choices/:id`, `DELETE /trade-ins/buyback-choices/:id`

- [ ] **Step 14.1: สร้าง `QuestionnaireTab.tsx`:**

```tsx
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface Choice {
  id: string;
  label: string;
  deductType: 'PERCENT' | 'FIXED';
  deductValue: string | number;
  sortOrder: number;
  isActive: boolean;
}

interface Question {
  id: string;
  key: string;
  title: string;
  helpText: string | null;
  selectType: 'SINGLE' | 'MULTI';
  sortOrder: number;
  isActive: boolean;
  choices: Choice[];
}

/** แก้คำถาม/ตัวเลือก/ค่าหักของแบบประเมินรับซื้อออนไลน์ — มีผลกับ quote ถัดไปทันที */
export default function QuestionnaireTab() {
  const queryClient = useQueryClient();
  const [edits, setEdits] = useState<Record<string, { label?: string; deductValue?: string }>>({});
  const [newChoice, setNewChoice] = useState<Record<string, { label: string; deductType: 'PERCENT' | 'FIXED'; deductValue: string }>>({});

  const { data, isLoading } = useQuery<{ questions: Question[] }>({
    queryKey: ['buyback-questions-admin'],
    queryFn: () => api.get('/trade-ins/buyback-questions').then((r) => r.data),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['buyback-questions-admin'] });

  const patchQuestion = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      api.patch(`/trade-ins/buyback-questions/${id}`, body),
    onSuccess: () => { toast.success('บันทึกแล้ว'); invalidate(); },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const patchChoice = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      api.patch(`/trade-ins/buyback-choices/${id}`, body),
    onSuccess: () => { toast.success('บันทึกแล้ว'); invalidate(); },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const addChoice = useMutation({
    mutationFn: ({ questionId, body }: { questionId: string; body: Record<string, unknown> }) =>
      api.post(`/trade-ins/buyback-questions/${questionId}/choices`, body),
    onSuccess: () => { toast.success('เพิ่มตัวเลือกแล้ว'); invalidate(); },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const deleteChoice = useMutation({
    mutationFn: (id: string) => api.delete(`/trade-ins/buyback-choices/${id}`),
    onSuccess: () => { toast.success('ลบตัวเลือกแล้ว'); invalidate(); },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  function saveChoice(c: Choice) {
    const e = edits[c.id];
    if (!e) return;
    const body: Record<string, unknown> = {};
    if (e.label !== undefined) body.label = e.label;
    if (e.deductValue !== undefined) {
      const v = Number(e.deductValue);
      if (!Number.isFinite(v) || v < 0) { toast.error('ค่าหักไม่ถูกต้อง'); return; }
      body.deductValue = v;
    }
    patchChoice.mutate({ id: c.id, body });
    setEdits((prev) => { const { [c.id]: _, ...rest } = prev; return rest; });
  }

  if (isLoading) return <p className="text-sm text-muted-foreground leading-snug">กำลังโหลด...</p>;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground leading-snug">
        การแก้ค่าหักมีผลกับการเช็คราคาครั้งถัดไปทันที — ใบเสนอที่ลูกค้าส่งมาแล้วไม่เปลี่ยน (snapshot ไว้)
      </p>
      {(data?.questions ?? []).map((q) => (
        <div key={q.id} className="rounded-lg border border-border">
          <div className="flex items-center justify-between gap-2 p-3 bg-muted/50">
            <div className="leading-snug">
              <span className="font-medium">{q.title}</span>
              <span className="ml-2 text-xs text-muted-foreground">
                {q.selectType === 'SINGLE' ? 'เลือก 1 ข้อ' : 'เลือกได้หลายข้อ'} · key: {q.key}
              </span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => patchQuestion.mutate({ id: q.id, body: { isActive: !q.isActive } })}
            >
              {q.isActive ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
            </Button>
          </div>
          <table className="w-full text-sm">
            <tbody>
              {q.choices.map((c) => (
                <tr key={c.id} className="border-t border-border">
                  <td className="p-2">
                    <Input
                      className="h-8"
                      value={edits[c.id]?.label ?? c.label}
                      onChange={(e) => setEdits((prev) => ({ ...prev, [c.id]: { ...prev[c.id], label: e.target.value } }))}
                    />
                  </td>
                  <td className="p-2 w-28 text-muted-foreground">{c.deductType === 'PERCENT' ? 'หัก %' : 'หักบาท'}</td>
                  <td className="p-2 w-32">
                    <Input
                      className="h-8"
                      type="number"
                      value={edits[c.id]?.deductValue ?? String(Number(c.deductValue))}
                      onChange={(e) => setEdits((prev) => ({ ...prev, [c.id]: { ...prev[c.id], deductValue: e.target.value } }))}
                    />
                  </td>
                  <td className="p-2 w-36 text-right">
                    {edits[c.id] && (
                      <Button size="sm" onClick={() => saveChoice(c)} disabled={patchChoice.isPending}>บันทึก</Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      className="ml-1 text-destructive"
                      onClick={() => { if (window.confirm(`ลบตัวเลือก "${c.label}"?`)) deleteChoice.mutate(c.id); }}
                    >
                      ลบ
                    </Button>
                  </td>
                </tr>
              ))}
              <tr className="border-t border-border bg-muted/30">
                <td className="p-2">
                  <Input
                    className="h-8"
                    placeholder="เพิ่มตัวเลือกใหม่..."
                    value={newChoice[q.id]?.label ?? ''}
                    onChange={(e) => setNewChoice((prev) => ({ ...prev, [q.id]: { label: e.target.value, deductType: prev[q.id]?.deductType ?? 'PERCENT', deductValue: prev[q.id]?.deductValue ?? '' } }))}
                  />
                </td>
                <td className="p-2 w-28">
                  <select
                    className="w-full h-8 rounded-lg border border-input bg-background px-2 text-sm"
                    value={newChoice[q.id]?.deductType ?? 'PERCENT'}
                    onChange={(e) => setNewChoice((prev) => ({ ...prev, [q.id]: { label: prev[q.id]?.label ?? '', deductType: e.target.value as 'PERCENT' | 'FIXED', deductValue: prev[q.id]?.deductValue ?? '' } }))}
                  >
                    <option value="PERCENT">หัก %</option>
                    <option value="FIXED">หักบาท</option>
                  </select>
                </td>
                <td className="p-2 w-32">
                  <Input
                    className="h-8"
                    type="number"
                    placeholder="ค่าหัก"
                    value={newChoice[q.id]?.deductValue ?? ''}
                    onChange={(e) => setNewChoice((prev) => ({ ...prev, [q.id]: { label: prev[q.id]?.label ?? '', deductType: prev[q.id]?.deductType ?? 'PERCENT', deductValue: e.target.value } }))}
                  />
                </td>
                <td className="p-2 w-36 text-right">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const nc = newChoice[q.id];
                      const v = Number(nc?.deductValue);
                      if (!nc?.label || !Number.isFinite(v) || v < 0) { toast.error('กรอกตัวเลือก/ค่าหักให้ครบ'); return; }
                      addChoice.mutate({ questionId: q.id, body: { label: nc.label, deductType: nc.deductType, deductValue: v } });
                      setNewChoice((prev) => { const { [q.id]: _, ...rest } = prev; return rest; });
                    }}
                    disabled={addChoice.isPending}
                  >
                    เพิ่ม
                  </Button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
```
(หมายเหตุ: `window.confirm` ขัด rule ห้าม confirm() — ถ้า lint แดง ให้ใช้ `ConfirmDialog` จาก `@/components/ui/ConfirmDialog` ตาม pattern ที่หน้าอื่นใช้ แทน)

- [ ] **Step 14.2: Typecheck + commit Tasks 13-14**

```bash
./tools/check-types.sh web
git add apps/web/src/pages/TradeInPage/
git commit -m "feat(web): แท็บตารางราคากลาง + แบบประเมินออนไลน์ ในหน้ารับซื้อเครื่อง (สร้าง valuations UI ครั้งแรก)"
```

### Task 15: TradeIn detail dialog + ยืนยันราคา online (staff)

**Files:**
- Modify: `apps/web/src/pages/TradeInPage/types.ts` (fields ใหม่)
- Create: `apps/web/src/pages/TradeInPage/components/TradeInDetailDialog.tsx`
- Create: `apps/web/src/pages/TradeInPage/components/OnlineAppraiseModal.tsx`
- Modify: `apps/web/src/pages/TradeInPage/index.tsx` (wiring)
- Modify: `apps/web/src/pages/TradeInPage/components/TradeInTable.tsx` (ปุ่ม "ดู" + route appraise ไป modal ที่ถูกตัว)

**Interfaces:**
- Consumes: `GET /trade-ins/:id` (มีอยู่), `PATCH /trade-ins/:id/appraise-online` (Task 7), `GET /api/shop/buyback/questions` (Task 5 — public ใช้ prefix `/api` ตรงๆ ผ่าน axios ของ apps/web ได้เพราะ dev proxy เดียวกัน; ถ้า api client ของ apps/web เติม `/api` ให้อยู่แล้ว ใช้ path `/shop/buyback/questions` — ดู `apps/web/src/lib/api.ts` แล้วยึดตาม convention ของ endpoint อื่นในไฟล์ที่แก้)

- [ ] **Step 15.1: types.ts** — เพิ่มใน `interface TradeIn` (ต่อจาก `appraisedBy?: ...`):

```ts
  // Instant-quote (buyback ออนไลน์)
  batteryHealth?: number | null;
  photoUrls?: string[];
  customerNotes?: string | null;
  preferredVisitDate?: string | null;
  conditionAnswers?: Array<{
    questionKey: string;
    title: string;
    selectType: 'SINGLE' | 'MULTI';
    choices: Array<{ choiceId: string; label: string; deductType: 'PERCENT' | 'FIXED'; deductValue: string }>;
  }> | null;
  quoteBreakdown?: {
    maxPrice: string;
    fixedTotal: string;
    pctTotal: string;
    price: string;
    lines: Array<{ label: string; deductType: 'PERCENT' | 'FIXED'; deductValue: string; amount: string }>;
  } | null;
```

- [ ] **Step 15.2: `TradeInDetailDialog.tsx`:**

```tsx
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import Modal from '@/components/ui/Modal';
import type { TradeIn } from '../types';

interface Props {
  id: string | null;
  onClose: () => void;
}

/** รายละเอียด TradeIn — โชว์คำตอบประเมินออนไลน์ + breakdown + รูป/แบต/โน้ตของ record online เก่า */
export default function TradeInDetailDialog({ id, onClose }: Props) {
  const { data, isLoading } = useQuery<TradeIn>({
    queryKey: ['trade-in-detail', id],
    queryFn: () => api.get(`/trade-ins/${id}`).then((r) => r.data),
    enabled: !!id,
  });

  return (
    <Modal isOpen={!!id} onClose={onClose} title="รายละเอียดรายการรับซื้อ" size="lg">
      {isLoading && <p className="text-sm text-muted-foreground">กำลังโหลด...</p>}
      {data && (
        <div className="space-y-4 text-sm leading-snug">
          <div>
            <div className="font-semibold">
              {data.deviceBrand} {data.deviceModel} {data.deviceStorage ?? ''}
            </div>
            <div className="text-muted-foreground">
              {data.deviceCondition && <>เกรด {data.deviceCondition}</>}
              {data.batteryHealth != null && <> · แบตเตอรี่ {data.batteryHealth}%</>}
              {data.imei && <> · IMEI {data.imei}</>}
            </div>
            <div className="text-muted-foreground">
              ผู้ขาย: {data.sellerName ?? data.customer?.name ?? '-'} {data.sellerPhone ? `(${data.sellerPhone})` : ''}
            </div>
            {data.preferredVisitDate && (
              <div className="text-muted-foreground">
                วันที่สะดวกเข้าร้าน: {new Date(data.preferredVisitDate).toLocaleDateString('th-TH')}
              </div>
            )}
          </div>

          {data.quoteBreakdown && (
            <div className="rounded-lg border border-border p-3 space-y-1">
              <div className="font-medium">ใบเสนอราคาออนไลน์</div>
              <div className="flex justify-between text-muted-foreground">
                <span>ราคาสูงสุด</span><span>฿{Number(data.quoteBreakdown.maxPrice).toLocaleString()}</span>
              </div>
              {data.quoteBreakdown.lines.filter((l) => Number(l.amount) > 0).map((l, i) => (
                <div key={i} className="flex justify-between text-muted-foreground">
                  <span>{l.label}</span><span>−฿{Number(l.amount).toLocaleString()}</span>
                </div>
              ))}
              <div className="flex justify-between font-semibold border-t border-border pt-1">
                <span>ราคาที่เสนอ</span><span>฿{Number(data.quoteBreakdown.price).toLocaleString()}</span>
              </div>
            </div>
          )}

          {data.conditionAnswers && data.conditionAnswers.length > 0 && (
            <div className="rounded-lg border border-border p-3 space-y-1.5">
              <div className="font-medium">คำตอบประเมินออนไลน์ของลูกค้า</div>
              {data.conditionAnswers.map((a) => (
                <div key={a.questionKey} className="flex justify-between gap-3">
                  <span className="text-muted-foreground">{a.title}</span>
                  <span className="text-right">
                    {a.choices.length === 0 ? 'ไม่มีปัญหา' : a.choices.map((c) => c.label).join(', ')}
                  </span>
                </div>
              ))}
            </div>
          )}

          {data.customerNotes && (
            <div className="text-muted-foreground">หมายเหตุลูกค้า: {data.customerNotes}</div>
          )}

          {(data.photoUrls?.length ?? 0) > 0 && (
            <div className="grid grid-cols-4 gap-2">
              {data.photoUrls!.map((url, i) => (
                <a key={i} href={url} target="_blank" rel="noreferrer" className="block aspect-square rounded-lg overflow-hidden bg-muted">
                  <img src={url} alt={`รูปที่ ${i + 1}`} className="h-full w-full object-cover" />
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
```

- [ ] **Step 15.3: `OnlineAppraiseModal.tsx`** (3 โหมดตาม §7.4):

```tsx
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import Modal from '@/components/ui/Modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/contexts/AuthContext';
import type { TradeIn } from '../types';

interface QuestionChoice { id: string; label: string; deductType: 'PERCENT' | 'FIXED'; deductValue: string }
interface Question { id: string; key: string; title: string; selectType: 'SINGLE' | 'MULTI'; choices: QuestionChoice[] }

interface Props {
  item: TradeIn | null;
  onClose: () => void;
}

type Mode = 'AS_ANSWERED' | 'REVISED' | 'MANUAL';

/** §7.4 — ยืนยันราคา record จาก instant quote: ตรงตามตอบ / แก้คำตอบ / OWNER free-hand */
export default function OnlineAppraiseModal({ item, onClose }: Props) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isOwner = user?.role === 'OWNER';
  const [mode, setMode] = useState<Mode>('AS_ANSWERED');
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [manualPrice, setManualPrice] = useState('');
  const [manualReason, setManualReason] = useState('');

  // questionnaire ปัจจุบัน (public endpoint) — ใช้เฉพาะโหมดแก้คำตอบ
  const questionsQ = useQuery<{ questions: Question[] }>({
    queryKey: ['buyback-questions-public'],
    queryFn: () => api.get('/shop/buyback/questions').then((r) => r.data),
    enabled: !!item && mode === 'REVISED',
  });

  // prefill จากคำตอบเดิมของลูกค้าเมื่อเปิดโหมด REVISED ครั้งแรก
  const prefill = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const a of item?.conditionAnswers ?? []) map[a.questionKey] = a.choices.map((c) => c.choiceId);
    return map;
  }, [item]);
  const effectiveAnswers = Object.keys(answers).length > 0 ? answers : prefill;

  const appraise = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.patch(`/trade-ins/${item!.id}/appraise-online`, body),
    onSuccess: () => {
      toast.success('ยืนยันราคาเรียบร้อย');
      queryClient.invalidateQueries({ queryKey: ['trade-ins'] });
      handleClose();
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  function handleClose() {
    setMode('AS_ANSWERED');
    setAnswers({});
    setManualPrice('');
    setManualReason('');
    onClose();
  }

  function confirm() {
    if (mode === 'AS_ANSWERED') {
      appraise.mutate({ mode });
    } else if (mode === 'REVISED') {
      const qs = questionsQ.data?.questions ?? [];
      const payload = qs.map((q) => ({ questionKey: q.key, choiceIds: effectiveAnswers[q.key] ?? [] }));
      const incomplete = qs.some((q) => q.selectType === 'SINGLE' && (effectiveAnswers[q.key] ?? []).length !== 1);
      if (incomplete) { toast.error('ตอบแบบประเมินให้ครบทุกข้อ'); return; }
      appraise.mutate({ mode, answers: payload });
    } else {
      const price = Number(manualPrice);
      if (!Number.isFinite(price) || price <= 0) { toast.error('กรุณาระบุราคา'); return; }
      if (manualReason.trim().length < 3) { toast.error('ระบุเหตุผลอย่างน้อย 3 ตัวอักษร'); return; }
      appraise.mutate({ mode, offeredPrice: price, reason: manualReason });
    }
  }

  const quoted = item?.quoteBreakdown ? Number(item.quoteBreakdown.price) : null;

  return (
    <Modal isOpen={!!item} onClose={handleClose} title="ยืนยันราคาใบเสนอออนไลน์" size="lg">
      {item && (
        <div className="space-y-4 text-sm leading-snug">
          <div className="rounded-lg bg-muted p-3">
            <div className="font-semibold">{item.deviceBrand} {item.deviceModel} {item.deviceStorage ?? ''}</div>
            {quoted !== null && (
              <div className="text-lg font-bold">ราคาที่เสนอออนไลน์: ฿{quoted.toLocaleString()}</div>
            )}
          </div>

          <div className="flex gap-1.5 flex-wrap">
            <Button variant={mode === 'AS_ANSWERED' ? 'default' : 'outline'} size="sm" onClick={() => setMode('AS_ANSWERED')}>
              สภาพตรงตามที่ตอบ
            </Button>
            <Button variant={mode === 'REVISED' ? 'default' : 'outline'} size="sm" onClick={() => setMode('REVISED')}>
              สภาพไม่ตรง — แก้คำตอบ
            </Button>
            {isOwner && (
              <Button variant={mode === 'MANUAL' ? 'default' : 'outline'} size="sm" onClick={() => setMode('MANUAL')}>
                กำหนดราคาเอง (OWNER)
              </Button>
            )}
          </div>

          {mode === 'AS_ANSWERED' && quoted !== null && (
            <p className="text-muted-foreground">ยืนยันรับซื้อที่ ฿{quoted.toLocaleString()} ตามใบเสนอ</p>
          )}

          {mode === 'REVISED' && (
            <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
              {questionsQ.isLoading && <p className="text-muted-foreground">กำลังโหลดแบบประเมิน...</p>}
              {(questionsQ.data?.questions ?? []).map((q) => {
                const chosen = effectiveAnswers[q.key] ?? [];
                return (
                  <div key={q.key}>
                    <Label>{q.title}</Label>
                    <div className="mt-1 grid gap-1.5 sm:grid-cols-2">
                      {q.choices.map((c) => {
                        const selected = chosen.includes(c.id);
                        return (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() =>
                              setAnswers((_prev) => {
                                const base = { ...effectiveAnswers };
                                if (q.selectType === 'SINGLE') return { ...base, [q.key]: [c.id] };
                                return {
                                  ...base,
                                  [q.key]: selected ? chosen.filter((x) => x !== c.id) : [...chosen, c.id],
                                };
                              })
                            }
                            className={`rounded-lg border p-2 text-left text-xs leading-snug transition-colors ${
                              selected ? 'border-primary bg-primary/10' : 'border-border hover:bg-accent'
                            }`}
                          >
                            {c.label}
                            <span className="text-muted-foreground">
                              {' '}({c.deductType === 'PERCENT' ? `−${Number(c.deductValue)}%` : `−฿${Number(c.deductValue).toLocaleString()}`})
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              <p className="text-xs text-muted-foreground">ระบบจะคิดราคาใหม่จากตารางค่าหักปัจจุบันโดยอัตโนมัติ</p>
            </div>
          )}

          {mode === 'MANUAL' && (
            <div className="space-y-3">
              <div>
                <Label>ราคาที่เสนอ (บาท) *</Label>
                <Input className="mt-1" type="number" value={manualPrice} onChange={(e) => setManualPrice(e.target.value)} />
              </div>
              <div>
                <Label>เหตุผล * (บันทึก audit)</Label>
                <Input className="mt-1" value={manualReason} onChange={(e) => setManualReason(e.target.value)} />
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={handleClose}>ยกเลิก</Button>
            <Button onClick={confirm} disabled={appraise.isPending}>
              {appraise.isPending ? 'กำลังบันทึก...' : 'ยืนยันราคา'}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
```
(⚠️ path `/shop/buyback/questions`: เช็ค `apps/web/src/lib/api.ts` ว่า baseURL เติม `/api` ไหม — endpoint อื่นในหน้านี้เรียก `/trade-ins/...` ตรงๆ แปลว่า axios มี prefix อยู่แล้ว ให้ใช้ `/shop/buyback/questions` แบบไม่มี `/api` นำหน้า ถ้า convention เป็นแบบนั้น)

- [ ] **Step 15.4: Wiring ใน `index.tsx`:**
  1. import: `TradeInDetailDialog`, `OnlineAppraiseModal`
  2. state เพิ่ม: `const [detailId, setDetailId] = useState<string | null>(null);` และ `const [onlineAppraise, setOnlineAppraise] = useState<TradeIn | null>(null);`
  3. แก้ callback `onAppraise` ของ `<TradeInTable ... />` จาก `onAppraise={setAppraiseModal}` เป็น:
```tsx
        onAppraise={(item) => (item.quoteBreakdown ? setOnlineAppraise(item) : setAppraiseModal(item))}
```
  4. เพิ่ม prop `onDetail={(item) => setDetailId(item.id)}` ให้ `<TradeInTable ... />`
  5. ต่อท้าย `<AcceptModal ... />` (ยังใน block `tab === 'list'`):
```tsx
      <TradeInDetailDialog id={detailId} onClose={() => setDetailId(null)} />
      <OnlineAppraiseModal item={onlineAppraise} onClose={() => setOnlineAppraise(null)} />
```

- [ ] **Step 15.5: `TradeInTable.tsx`** — เพิ่ม prop + ปุ่ม:
  1. interface props เพิ่ม `onDetail: (item: TradeIn) => void;`
  2. ใน action cell ของแต่ละแถว (หา block ปุ่ม appraise/accept ที่มีอยู่) เพิ่มปุ่มแรกสุด ตาม pattern ปุ่มอื่นในไฟล์:
```tsx
                <Button variant="outline" size="sm" onClick={() => onDetail(item)}>
                  ดู
                </Button>
```
  (สำคัญ: `GET /trade-ins/:id` ต้อง return field ใหม่ — `findOne` ใช้ include/select เดิมที่คืนทั้ง row อยู่แล้ว จึงได้ conditionAnswers/quoteBreakdown อัตโนมัติ; ถ้า findOne มี `select` explicit ให้เพิ่ม 3 field ใหม่ + batteryHealth/photoUrls/customerNotes ใน `apps/api/src/modules/trade-in/services/trade-in-query.service.ts`)
  3. `findAll` (list) ต้องมี `quoteBreakdown` ให้ปุ่ม appraise route ถูก — เช็ค `trade-in-query.service.ts` `findAll`: ถ้าใช้ select explicit เพิ่ม `quoteBreakdown: true`; ถ้าคืน row เต็มไม่ต้องทำอะไร

- [ ] **Step 15.6: Typecheck + commit**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE && ./tools/check-types.sh all
git add apps/web/src/pages/TradeInPage/ apps/api/src/modules/trade-in/services/trade-in-query.service.ts
git commit -m "feat(web): TradeIn detail dialog + ยืนยันราคาใบเสนอออนไลน์ 3 โหมด (§7.4 staff UI)"
```

---

## Phase D — Verification & Ship

### Task 16: Full verification + browser pass + PR

**Files:** ไม่มีไฟล์ใหม่ (แก้เฉพาะที่ verification เจอ)

- [ ] **Step 16.1: ชุดตรวจอัตโนมัติทั้งหมด**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE
./tools/check-types.sh all                     # Expected: 0 errors ทั้ง api+web
cd apps/api && npx jest src/modules/shop-buyback src/modules/trade-in src/modules/shop-trade-in --runInBand
cd ../web-shop && npm run build && npx eslint src --max-warnings=0 2>/dev/null || npx eslint src
cd ../web && npx eslint src/pages/TradeInPage --max-warnings=0 2>/dev/null || true
```
Expected: jest PASS ทุก suite (โดย **shop-trade-in spec ผ่านแบบไฟล์ไม่ถูกแตะ** — ตรวจ `git log --oneline -- apps/api/src/modules/shop-trade-in/` ต้องไม่มี commit ใดแตะโฟลเดอร์นี้เลย)

- [ ] **Step 16.2: Browser pass (local dev — ใช้ LOCAL เท่านั้น, prod ไม่มี seed account)**

```bash
npm run dev   # api :3000 + web :5173; web-shop: cd apps/web-shop && npm run dev (:5174 หรือตามที่ vite แจ้ง)
```
Checklist (ใช้ browser จริงหรือ webapp-testing/Playwright):
1. web-shop `/buyback` → landing ใหม่ 3 ขั้น + trust cards; nav header/footer เขียน "รับซื้อ iPhone"
2. `/buyback/quote` → เลือก iPhone 15 / 128GB → เห็น "ราคาสูงสุด ฿20,000" (seed) → ตอบครบ 8 ข้อ (หมดประกัน + ไม่มีกล่อง + รอยนิดหน่อย ที่เหลือดีหมด) → กด "ดูราคารับซื้อ" → เห็น **฿17,480** + breakdown → กรอกชื่อ/เบอร์ → ยืนยันขาย → ไปหน้า `/buyback/:id` เห็น "ยืนยันราคาแล้ว" + breakdown + **ไม่มี** "แบตเตอรี่ %" เพี้ยน
3. เลือกรุ่นแล้วลบ valuation ใน DB ชั่วคราว (หรือรุ่นที่ไม่มี) → เห็น card "ยังไม่เปิดรับซื้อออนไลน์" + ปุ่ม LINE
4. `/buyback/submit` → redirect ไป `/buyback/quote`
5. apps/web `/trade-in` (login OWNER admin@bestchoice.com/admin1234) → เห็น 3 แท็บ; แท็บตารางราคากลาง: แก้ราคา iPhone 15 128GB A → บันทึก → กลับไป web-shop เช็คราคาใหม่เปลี่ยนตาม; แท็บแบบประเมิน: แก้ค่าหัก "หมดประกัน" 500→700 → quote ใหม่เปลี่ยน; กด "ดู" record ที่เพิ่ง submit → เห็นคำตอบ+breakdown
6. กด "ตีราคา" record เดียวกัน → ขึ้น OnlineAppraiseModal (ไม่ใช่ modal เดิม) → "สภาพตรงตามที่ตอบ" → ยืนยัน → status APPRAISED; ลอง MANUAL ด้วย BRANCH_MANAGER (manager.ladprao@) → ถูกปฏิเสธ
7. `/trade-in` (เก่าแลกใหม่ฝั่ง web-shop) → estimate เดิมยังทำงาน (regression EXCHANGE)
8. Mobile viewport 390px: wizard + sticky bar + แท็บ staff ไม่ล้น

- [ ] **Step 16.3: อัปเดต memory/สถานะ + PR**

```bash
git push -u origin feat/buyback-iphone-instant-quote
gh pr create --title "feat: รับซื้อ iPhone รู้ราคาทันที (yellobe-style instant quote)" --body "$(cat <<'EOF'
## Summary
- เว็บ shop `/buyback` ใหม่: iPhone-only, ตอบแบบประเมิน 8 กลุ่ม → ราคาเลขเดียวทันที (สูตร yellobe, Decimal, server-side) → นัดเข้าร้าน ไม่ต้องถ่ายรูป
- ตาราง questionnaire ใหม่ 2 ตาราง + แอดมิน: ตารางราคากลาง (สร้าง UI ครั้งแรก) + editor ค่าหัก
- Appraise handshake §7.4: ยืนยันราคา online record 3 โหมด ข้าม valuation-band; แก้บั๊กเดิม route-shadowing (GET /trade-ins/valuations เคย 404)
- Spec: docs/superpowers/specs/2026-07-17-buyback-iphone-instant-quote-design.md

## Test plan
- jest: pricing golden (12,420 yellobe-verified) + routing + handshake 3 โหมด + shop-trade-in เดิมเขียวไม่แตะไฟล์
- browser pass local ครบ 8 ข้อ (Task 16.2)

⚠️ ก่อนเปิดใช้จริง: owner ต้องกรอกราคารับซื้อจริงในแท็บตารางราคากลาง (ราคา seed เป็น demo)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
Expected: PR เปิดสำเร็จ; "Lint & Test" ต้องเขียว (เป็น gate จริงตั้งแต่ 2026-07-07); E2E workflow แดง = ปกติทุก PR ไม่ใช่ gate; ห้าม merge เอง — รอ user

## Execution note

- ลำดับ dependency: Task 1→2→3→4→5→6→7 (backend ต้องเรียงตามนี้), Task 8 อิสระหลัง 5, Task 9→10→11→12 (web-shop), Task 13→14→15 (staff — ต้องรอ Task 6+7), Task 16 ท้ายสุด
- ทุก task จบด้วย test เขียว + commit — ห้ามข้าม
- ไฟล์ที่ **ห้ามแตะเด็ดขาด**: `apps/api/src/modules/shop-trade-in/**` (ยกเว้นไม่มีข้อยกเว้น), ไฟล์ payments 4 ไฟล์ที่ dirty อยู่ก่อนแล้ว
