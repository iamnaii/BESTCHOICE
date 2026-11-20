# ช่วง 2ก — ใบเสนอราคาตามรุ่น (shared) + `GET /pricing-templates/quotes` + บอทขาย + ค้นราคากลางถอยไป "ไม่ระบุ" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ช่องราคาผ่อนสองช่องของตารางราคากลางหมายถึง "ราคาเต็ม" ทุกที่ · มีตัวคิดใบเสนอราคาตามรุ่นตัวเดียว (`buildModelQuote`) ที่ให้ตัวเลขเท่าชีต MASTER · API `GET /pricing-templates/quotes` และบอทขายใช้บริการเดียวกัน (`PricingQuoteService`) · ไม่มีแถวของเครื่องไทย/นอก → ถอยไปแถว "ไม่ระบุ"

**Architecture:** `packages/shared/src/model-quote.ts` รวมเรท 1 (`calcBcInstallment` เดิม) + เรท 2 (`calcGfinInstallment` ของช่วง 1ข) + กำไร เป็น `ModelQuote` · ฝั่ง API `PricingQuoteService` โหลดตั้งค่าดอกเบี้ย/GFIN ครั้งเดียวต่อคำขอ แล้วคิดทุกแถวด้วย `buildModelQuote` · บอท `get_installment_rates` เรียก `quoteForModel` ต่อแถวที่ตรง (≤ 3) ส่วน `recommend_devices` อ่าน `listQuotes` (โหลดตั้งค่าครั้งเดียวแทนการเรียกต่อแถว) · ตัวเติมราคาตอนสร้างเครื่องเลิกเดาว่า "ราคาผ่อนต่ำกว่าเงินสด = ค่างวด"

**Tech Stack:** TypeScript · decimal.js · vitest (`packages/shared`, `apps/web`) · jest (`apps/api`) · NestJS + Prisma

สเปค: `docs/superpowers/specs/2026-11-19-price-master-retire-design.md` ข้อ 3.1, 4.1, 4.5, 6 (API), 7.1, 7.6, 10 · ช่วง 2 ของข้อ 11 แบ่งเป็น 2ก (แผนนี้) กับ 2ข (`2026-11-20-price-master-phase2b-imports-catalog-shop.md` — นำเข้า, หน้าตั้งราคา, ใบราคา GFIN, รายชื่อรุ่น, เว็บ shop, ไฟล์ข้อมูล) · สัญญากลาง: `docs/superpowers/plans/2026-11-20-price-master-contracts.md`

**ต้องมีก่อน (ช่วง 1ข ลงแล้ว):** `resolveGfinDownPct` ส่งออกจาก `packages/shared/src/installment-calc.ts` และ `index.ts` · `GfinOverpriceRuleRow.minDownPct: number | null` · `GfinOverpriceRule.minDownPct` ใน Prisma · `calcGfinInstallment` ปัด `downAmountActual` ขึ้นหลักร้อย · `findGfinMapping` จับชื่อรุ่นตรงทั้งคำ — ถ้า `resolveGfinDownPct` ยังไม่อยู่ในรายการ `export { … } from './installment-calc'` ของ `index.ts` ให้เพิ่มใน Task 2 Step 3

## Global Constraints

(คัดจากสัญญากลาง — ใช้ทุกช่วง)

- Do not change the BC installment formula, VAT, commission or schedule maths (`calcBcInstallment` body stays as is).
- Percentage-derived down payments round **up** to 100 with `roundUpToStep` / `downFromPct` (`packages/shared/src/installment-rounding.ts`).
  Down payments typed as an amount are never rounded.
- Contract installment keeps satang. Displayed and bot-quoted installments round **up** to whole baht via `displayInstallment`.
- Imported phones and phones with unknown origin get half OVER (`gfinAllowanceFactor`); Thai phones get full OVER.
- Profit is shown only to roles that can see cost. The staff price page never shows cost, profit or GFIN submit price.
- Thai UI copy, `leading-snug` on Thai text, semantic colour tokens only, no `alert`/`confirm`, lucide icons, no emoji.
- `packages/shared` is consumed by the API from `dist` — run `npm run build --workspace=packages/shared` after shared changes.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Commands: shared `npm --prefix packages/shared test` · web `cd apps/web && npx vitest run <paths>` ·
  api `NODE_OPTIONS=--max-old-space-size=12288 npm --prefix apps/api test -- <paths>` ·
  types `NODE_OPTIONS=--max-old-space-size=12288 ./tools/check-types.sh all`.
- Migrations: Prisma, add-column only, nullable, folder `apps/api/prisma/migrations/<timestamp>_<name>/migration.sql`. (แผนนี้ไม่มี migration)

เพิ่มเติมของช่วงนี้:

- ทำบน branch `feat/price-master-rest` ต่อจากช่วง 1ข
- route ใหม่ของ API ต้องลงทะเบียนใน `apps/api/src/modules/employee-access/access-policy.manifest.json` (ค่า `surface` คำนวณแบบเดียวกับ `tools/check-access-coverage.mjs`) และถ้าพนักงานที่ย้ายเข้าระบบสิทธิ์ใหม่ (managed) ต้องเปิดได้ ต้องมี boundary ใน `ACCESS_BOUNDARIES`
- `tools/check-access-coverage.mjs` ใช้ path แบบ `/` — บน Windows ให้รันผ่านคำสั่งห่อใน Task 9 (บนเครื่อง Windows มี 27 รายการเดิมที่ฟ้องเพราะ CRLF ในตัวตกแต่งหลายบรรทัด ไม่เกี่ยวกับงานนี้)

## ข้อเท็จจริงจากชีต MASTER ที่แผนนี้ยึด (ตรวจด้วย openpyxl `data_only=True` กับ `master-sheet-2026-11-19.xlsx`)

- 53 แถว (มือ 1 8 แถว · มือ 2 45 แถว) — ดาวน์เรท 1 · ดาวน์เรท 2 · ค่างวดเรท 2 · งวด · ราคา 2 · ราคา 3 ตรงทุกบาทกับสูตรของแผนนี้
- **ค่างวดเรท 1 ที่แสดงสูงกว่าชีต 0–3 บาท ไม่ใช่ 0–2** — 11 แถวต่าง 3 บาท (เช่น iPhone 16 128GB มือ 1: ชีต 3,493 · ระบบ 3,495.33 → 3,496) เพราะชีตคูณ 0.1426 แล้วปัดลง ส่วนสัญญาคิด 50% จริง (= 0.142667) แล้วแสดงปัดขึ้น · แก้สูตรไม่ได้ (Global Constraints) เทสต์จึงยอม ≤ 3 และแจ้งเจ้าของ
- แถวมือ 2 ของ iPhone 17 ในชีตใช้ดาวน์ขั้นต่ำ GFIN 25% (สเปคข้อ 8 เขียน 30% ทั้งมือ 1/มือ 2) — ชุดทดสอบใช้ค่าตามชีตรายแถว

---

### Task 1: `displayInstallment` ใน `packages/shared`

**Files:**
- Modify: `packages/shared/src/installment-rounding.ts` (ต่อท้ายไฟล์)
- Modify: `packages/shared/src/installment-rounding.test.ts` (import บรรทัด 3–8 + ต่อท้ายไฟล์)

**Interfaces:**
- Consumes: ไม่มี
- Produces: `displayInstallment(amount: Decimal | number): number`

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน**

`packages/shared/src/installment-rounding.test.ts` — แก้ import เป็น

```ts
import {
  DOWN_PAYMENT_STEP,
  displayInstallment,
  downFromPct,
  minDownAmountFromPct,
  roundUpToStep,
} from './installment-rounding';
```

ต่อท้ายไฟล์:

```ts
describe('displayInstallment', () => {
  it('ปัดสตางค์ขึ้นเป็นบาทเต็ม (ตัวเลขสเปคข้อ 4.5)', () => {
    expect(displayInstallment(new Decimal('3138.66'))).toBe(3139);
    expect(displayInstallment(1010.08)).toBe(1011);
    expect(displayInstallment(new Decimal('1226.93'))).toBe(1227);
  });

  it('ค่าที่เป็นบาทเต็มอยู่แล้วไม่เปลี่ยน', () => {
    expect(displayInstallment(new Decimal('3424.00'))).toBe(3424);
    expect(displayInstallment(3403)).toBe(3403);
    expect(displayInstallment(0)).toBe(0);
  });
});
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**

Run: `cd packages/shared && npx vitest run src/installment-rounding.test.ts`
Expected: FAIL — `displayInstallment is not a function` (หรือ TypeError import)

- [ ] **Step 3: เขียนโค้ด**

ต่อท้าย `packages/shared/src/installment-rounding.ts`:

```ts
/**
 * ค่างวดที่แสดง / ที่บอทบอกลูกค้า — ปัดขึ้นเป็นบาทเต็ม (คำตัดสินเจ้าของ 2026-11-19)
 * ค่างวดในสัญญายังเก็บถึงสตางค์ตามเดิม ห้ามใช้ตัวนี้กับยอดที่ลงสัญญา/บัญชี
 */
export function displayInstallment(amount: Decimal | number): number {
  return new Decimal(amount).ceil().toNumber();
}
```

- [ ] **Step 4: รันให้ผ่าน**

Run: `cd packages/shared && npx vitest run src/installment-rounding.test.ts`
Expected: PASS (13 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/installment-rounding.ts packages/shared/src/installment-rounding.test.ts
git commit -m "feat(shared): add displayInstallment (round displayed installment up to whole baht)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `buildModelQuote` + ชุดตรวจจากชีต MASTER 53 แถว

**Files:**
- Create: `packages/shared/src/model-quote.ts`
- Create: `packages/shared/src/model-quote.test.ts`
- Modify: `packages/shared/src/index.ts` (บรรทัดหลัง `export * from './installment-rounding';`)

**Interfaces:**
- Consumes: `calcBcInstallment`, `calcGfinInstallment`, `findGfinMapping`, `findGfinOverpriceRule`, `findGfinRateFactor`, `resolveGfinDownPct` (1ข) จาก `./installment-calc` · `displayInstallment` (Task 1) · ชนิดใน `./installment-calc.types`
- Produces (ชื่อ/ชนิดตามสัญญากลาง + ฟิลด์เพิ่ม 1 ช่อง):
  - `interface ModelQuoteGfinContext { mappings; rules; rateFactors; settingMinDownPct: Decimal; commissionPct: number; contractFee: Decimal }`
  - `interface ModelQuoteInput { product; deviceOrigin; cashPrice; bcPrice; financePrice; rate1TermMonths?; rate1DownPayment?; rate2TermMonths?; bcConfig; gfin; costPrice? }`
  - `interface CashQuote { price: number; profit: number | null }`
  - `interface Rate1Quote { price; downAmount; months; monthlyContract; monthlyDisplay; recordedSalePrice; profit; allowedMonths: number[] }` — **`allowedMonths` เพิ่มจากสัญญากลาง** (บอทต้องบอกงวดที่เลือกได้)
  - `type Rate2Quote` · `interface ModelQuote` ตามสัญญากลาง
  - `buildModelQuote(input: ModelQuoteInput): ModelQuote`

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน**

`packages/shared/src/model-quote.test.ts`:

```ts
import Decimal from 'decimal.js';
import { describe, it, expect } from 'vitest';
import { buildModelQuote, type ModelQuoteGfinContext, type ModelQuoteInput } from './model-quote';
import type { BcConfig, GfinRateFactorRow } from './installment-calc.types';

// ตั้งค่าตามชีต MASTER 2026-11-19 (สเปคข้อ 8): ดอกเบี้ย 10 / 12 งวด = 50% · ดาวน์ขั้นต่ำ 15% · คอม 10% · VAT 7%
const BC: BcConfig = {
  minDownPct: new Decimal('0.15'),
  commissionPct: new Decimal('0.10'),
  vatPct: new Decimal('0.07'),
  ratePctByMonths: new Map([
    [10, new Decimal('0.50')],
    [12, new Decimal('0.50')],
  ]),
  allowedMonths: [10, 12],
};

// เรท GFIN ตามชีต: 10 งวด 0.201 · 12 งวด 0.17 · 15 งวด 0.1467 · ค่าธรรมเนียม 100/งวด · คอมมือถือ 15%
const RATES: GfinRateFactorRow[] = (
  [
    [10, '0.201'],
    [12, '0.17'],
    [15, '0.1467'],
  ] as const
).map(([months, factor]) => ({
  months,
  shopCommissionPct: 15,
  factor: new Decimal(factor),
  feePerInstallment: new Decimal(100),
  isActive: true,
}));

interface GoldenRow {
  model: string;
  storage: string;
  category: 'PHONE_NEW' | 'PHONE_USED';
  cost: number | null;
  cash: number;
  bc: number;
  fin: number;
  t1: number;
  d1: number | null;
  t2: number | null;
  /** ใบราคา G-Finn ของแถว: ราคา · OVER · งวดสูงสุด · ดาวน์ขั้นต่ำ % ที่ชีตใช้ — null = GFIN ไม่รับ */
  gfin: { list: number; over: number; maxMonths: number; minDownPct: number } | null;
  expect: {
    down1: number;
    contract: string;
    display: number;
    /** ค่างวดเรท 1 ที่ชีตพิมพ์ (คอลัมน์ U) */
    sheet: number;
    price2: number;
    rate2: { down: number; monthly: number; months: number; price3: number } | null;
  };
}

// สร้างจาก 'ข้อมูลหลัก มือ 1' / 'ข้อมูลหลัก มือ 2' ของ master-sheet-2026-11-19.xlsx (คอลัมน์ A–K, M–O, S, U, X, Y, AA, AB, AJ)
// ค่าคาดหวังคิดด้วยสูตรของแผนนี้แล้วเทียบชีต: ตรงทุกบาท ยกเว้นค่างวดเรท 1 ที่แสดง (สูงกว่าชีต 0–3 บาท)
const GOLDEN: GoldenRow[] = [
  { model: 'iPhone 15', storage: '128GB', category: 'PHONE_NEW', cost: 25800, cash: 25900, bc: 25900, fin: 25900, t1: 12, d1: null, t2: null, gfin: { list: 24900, over: 1000, maxMonths: 12, minDownPct: 25 },
    expect: { down1: 3900, contract: '3138.66', display: 3139, sheet: 3137, price2: 28100, rate2: { down: 6500, monthly: 3403, months: 12, price3: 28738 } } },
  { model: 'iPhone 16', storage: '128GB', category: 'PHONE_NEW', cost: null, cash: 28900, bc: 28900, fin: 28900, t1: 12, d1: null, t2: null, gfin: { list: 26900, over: 2000, maxMonths: 15, minDownPct: 25 },
    expect: { down1: 4400, contract: '3495.33', display: 3496, sheet: 3493, price2: 31350, rate2: { down: 7300, monthly: 3280, months: 15, price3: 32126 } } },
  { model: 'iPhone 16 Plus', storage: '128GB', category: 'PHONE_NEW', cost: null, cash: 31900, bc: 31900, fin: 31900, t1: 12, d1: null, t2: null, gfin: { list: 29900, over: 2000, maxMonths: 15, minDownPct: 25 },
    expect: { down1: 4800, contract: '3866.26', display: 3867, sheet: 3864, price2: 34610, rate2: { down: 8000, monthly: 3610, months: 15, price3: 35413 } } },
  { model: 'iPhone 17', storage: '256GB', category: 'PHONE_NEW', cost: 32000, cash: 31900, bc: 31900, fin: 31900, t1: 12, d1: null, t2: null, gfin: { list: 29900, over: 2000, maxMonths: 15, minDownPct: 30 },
    expect: { down1: 4800, contract: '3866.26', display: 3867, sheet: 3864, price2: 34610, rate2: { down: 9600, monthly: 3376, months: 15, price3: 35179 } } },
  { model: 'iPhone 17 Pro', storage: '256GB', category: 'PHONE_NEW', cost: 38900, cash: 39000, bc: 39000, fin: 39000, t1: 12, d1: 15000, t2: null, gfin: { list: 39900, over: 2000, maxMonths: 15, minDownPct: 30 },
    expect: { down1: 15000, contract: '3424.00', display: 3424, sheet: 3422, price2: 41400, rate2: { down: 9700, monthly: 4403, months: 15, price3: 43329 } } },
  { model: 'iPhone 17 Pro Max', storage: '256GB', category: 'PHONE_NEW', cost: 43500, cash: 45900, bc: 45900, fin: 45900, t1: 12, d1: 15000, t2: null, gfin: { list: 44900, over: 2000, maxMonths: 15, minDownPct: 30 },
    expect: { down1: 15000, contract: '4408.40', display: 4409, sheet: 4406, price2: 48990, rate2: { down: 13100, monthly: 4917, months: 15, price3: 50754 } } },
  { model: 'iPhone 18 Pro', storage: '256GB', category: 'PHONE_NEW', cost: 47000, cash: 48900, bc: 48900, fin: 48900, t1: 12, d1: 18000, t2: 15, gfin: { list: 48900, over: 2000, maxMonths: 15, minDownPct: 30 },
    expect: { down1: 18000, contract: '4408.40', display: 4409, sheet: 4406, price2: 51990, rate2: { down: 13300, monthly: 5327, months: 15, price3: 54174 } } },
  { model: 'iPhone 18 Pro Max', storage: '256GB', category: 'PHONE_NEW', cost: 52500, cash: 52900, bc: 52900, fin: 52900, t1: 12, d1: 20000, t2: 15, gfin: { list: 52900, over: 2000, maxMonths: 15, minDownPct: 30 },
    expect: { down1: 20000, contract: '4693.73', display: 4694, sheet: 4691, price2: 56190, rate2: { down: 14500, monthly: 5738, months: 15, price3: 58594 } } },
  { model: 'iPhone 12', storage: '64GB', category: 'PHONE_USED', cost: 5000, cash: 8900, bc: 7000, fin: 6700, t1: 10, d1: null, t2: null, gfin: null,
    expect: { down1: 1100, contract: '1010.08', display: 1011, sheet: 1010, price2: 7590, rate2: null } },
  { model: 'iPhone 12', storage: '128GB', category: 'PHONE_USED', cost: 6000, cash: 9900, bc: 7800, fin: 7500, t1: 10, d1: null, t2: null, gfin: null,
    expect: { down1: 1200, contract: '1129.92', display: 1130, sheet: 1129, price2: 8460, rate2: null } },
  { model: 'iPhone 12', storage: '256GB', category: 'PHONE_USED', cost: 7000, cash: 10900, bc: 8500, fin: 8200, t1: 10, d1: null, t2: null, gfin: null,
    expect: { down1: 1300, contract: '1232.64', display: 1233, sheet: 1232, price2: 9220, rate2: null } },
  { model: 'iPhone 12 Pro', storage: '128GB', category: 'PHONE_USED', cost: 8300, cash: 10900, bc: 8700, fin: 8200, t1: 10, d1: null, t2: null, gfin: null,
    expect: { down1: 1400, contract: '1249.76', display: 1250, sheet: 1249, price2: 9430, rate2: null } },
  { model: 'iPhone 12 Pro', storage: '256GB', category: 'PHONE_USED', cost: 8800, cash: 11900, bc: 9500, fin: 9000, t1: 10, d1: null, t2: null, gfin: null,
    expect: { down1: 1500, contract: '1369.60', display: 1370, sheet: 1369, price2: 10300, rate2: null } },
  { model: 'iPhone 12 Pro', storage: '512GB', category: 'PHONE_USED', cost: 9300, cash: 12900, bc: 10200, fin: 9700, t1: 10, d1: null, t2: null, gfin: null,
    expect: { down1: 1600, contract: '1472.32', display: 1473, sheet: 1472, price2: 11060, rate2: null } },
  { model: 'iPhone 12 Pro Max', storage: '128GB', category: 'PHONE_USED', cost: 10500, cash: 12900, bc: 10200, fin: 9700, t1: 10, d1: null, t2: null, gfin: null,
    expect: { down1: 1600, contract: '1472.32', display: 1473, sheet: 1472, price2: 11060, rate2: null } },
  { model: 'iPhone 12 Pro Max', storage: '256GB', category: 'PHONE_USED', cost: 11000, cash: 13900, bc: 11000, fin: 10500, t1: 10, d1: null, t2: null, gfin: null,
    expect: { down1: 1700, contract: '1592.16', display: 1593, sheet: 1592, price2: 11930, rate2: null } },
  { model: 'iPhone 13', storage: '128GB', category: 'PHONE_USED', cost: 9700, cash: 12500, bc: 10200, fin: 9600, t1: 12, d1: null, t2: null, gfin: { list: 12900, over: 0, maxMonths: 12, minDownPct: 25 },
    expect: { down1: 1600, contract: '1226.93', display: 1227, sheet: 1226, price2: 11060, rate2: { down: 0, monthly: 1745, months: 12, price3: 11026 } } },
  { model: 'iPhone 13', storage: '256GB', category: 'PHONE_USED', cost: 10500, cash: 13500, bc: 11000, fin: 10400, t1: 12, d1: null, t2: null, gfin: { list: 13900, over: 0, maxMonths: 12, minDownPct: 25 },
    expect: { down1: 1700, contract: '1326.80', display: 1327, sheet: 1326, price2: 11930, rate2: { down: 0, monthly: 1873, months: 12, price3: 11888 } } },
  { model: 'iPhone 13 Pro', storage: '128GB', category: 'PHONE_USED', cost: 12000, cash: 14900, bc: 12500, fin: 11900, t1: 12, d1: null, t2: null, gfin: { list: 15900, over: 0, maxMonths: 12, minDownPct: 25 },
    expect: { down1: 1900, contract: '1512.26', display: 1513, sheet: 1511, price2: 13560, rate2: { down: 0, monthly: 2128, months: 12, price3: 13613 } } },
  { model: 'iPhone 13 Pro', storage: '256GB', category: 'PHONE_USED', cost: 13000, cash: 15900, bc: 13200, fin: 12600, t1: 12, d1: null, t2: null, gfin: { list: 16900, over: 0, maxMonths: 12, minDownPct: 25 },
    expect: { down1: 2000, contract: '1597.86', display: 1598, sheet: 1597, price2: 14320, rate2: { down: 0, monthly: 2255, months: 12, price3: 14476 } } },
  { model: 'iPhone 13 Pro', storage: '512GB', category: 'PHONE_USED', cost: 13200, cash: 16900, bc: 14200, fin: 13400, t1: 12, d1: null, t2: null, gfin: { list: 17900, over: 0, maxMonths: 12, minDownPct: 25 },
    expect: { down1: 2200, contract: '1712.00', display: 1712, sheet: 1711, price2: 15400, rate2: { down: 0, monthly: 2383, months: 12, price3: 15338 } } },
  { model: 'iPhone 13 Pro Max', storage: '128GB', category: 'PHONE_USED', cost: 13000, cash: 16900, bc: 14200, fin: 13400, t1: 12, d1: null, t2: null, gfin: { list: 17900, over: 0, maxMonths: 12, minDownPct: 25 },
    expect: { down1: 2200, contract: '1712.00', display: 1712, sheet: 1711, price2: 15400, rate2: { down: 0, monthly: 2383, months: 12, price3: 15338 } } },
  { model: 'iPhone 13 Pro Max', storage: '256GB', category: 'PHONE_USED', cost: 14000, cash: 17900, bc: 14900, fin: 14100, t1: 12, d1: null, t2: null, gfin: { list: 18900, over: 0, maxMonths: 12, minDownPct: 25 },
    expect: { down1: 2300, contract: '1797.60', display: 1798, sheet: 1796, price2: 16160, rate2: { down: 0, monthly: 2510, months: 12, price3: 16201 } } },
  { model: 'iPhone 13 Pro Max', storage: '512GB', category: 'PHONE_USED', cost: 15000, cash: 18900, bc: 15700, fin: 14900, t1: 12, d1: null, t2: null, gfin: { list: 19900, over: 0, maxMonths: 12, minDownPct: 25 },
    expect: { down1: 2400, contract: '1897.46', display: 1898, sheet: 1896, price2: 17030, rate2: { down: 0, monthly: 2638, months: 12, price3: 17063 } } },
  { model: 'iPhone 14', storage: '128GB', category: 'PHONE_USED', cost: 11500, cash: 13900, bc: 11700, fin: 11100, t1: 12, d1: null, t2: null, gfin: { list: 12900, over: 2000, maxMonths: 12, minDownPct: 25 },
    expect: { down1: 1800, contract: '1412.40', display: 1413, sheet: 1411, price2: 12690, rate2: { down: 0, monthly: 2000, months: 12, price3: 12751 } } },
  { model: 'iPhone 14', storage: '256GB', category: 'PHONE_USED', cost: 12000, cash: 14900, bc: 12500, fin: 11900, t1: 12, d1: null, t2: null, gfin: { list: 13900, over: 2000, maxMonths: 12, minDownPct: 25 },
    expect: { down1: 1900, contract: '1512.26', display: 1513, sheet: 1511, price2: 13560, rate2: { down: 0, monthly: 2128, months: 12, price3: 13613 } } },
  { model: 'iPhone 14 Plus', storage: '128GB', category: 'PHONE_USED', cost: 13500, cash: 15900, bc: 14000, fin: 13400, t1: 12, d1: null, t2: null, gfin: { list: 15900, over: 2000, maxMonths: 12, minDownPct: 25 },
    expect: { down1: 2100, contract: '1697.73', display: 1698, sheet: 1696, price2: 15190, rate2: { down: 0, monthly: 2383, months: 12, price3: 15338 } } },
  { model: 'iPhone 14 Plus', storage: '256GB', category: 'PHONE_USED', cost: 14500, cash: 16900, bc: 14700, fin: 14100, t1: 12, d1: null, t2: null, gfin: { list: 16900, over: 2000, maxMonths: 12, minDownPct: 25 },
    expect: { down1: 2300, contract: '1769.06', display: 1770, sheet: 1768, price2: 15940, rate2: { down: 0, monthly: 2510, months: 12, price3: 16201 } } },
  { model: 'iPhone 14 Pro', storage: '128GB', category: 'PHONE_USED', cost: 15500, cash: 18900, bc: 16500, fin: 15600, t1: 12, d1: null, t2: null, gfin: { list: 18900, over: 2000, maxMonths: 12, minDownPct: 25 },
    expect: { down1: 2500, contract: '1997.33', display: 1998, sheet: 1996, price2: 17900, rate2: { down: 0, monthly: 2765, months: 12, price3: 17926 } } },
  { model: 'iPhone 14 Pro', storage: '256GB', category: 'PHONE_USED', cost: 16500, cash: 19900, bc: 17300, fin: 16400, t1: 12, d1: null, t2: null, gfin: { list: 19900, over: 2000, maxMonths: 12, minDownPct: 25 },
    expect: { down1: 2600, contract: '2097.20', display: 2098, sheet: 2096, price2: 18770, rate2: { down: 0, monthly: 2893, months: 12, price3: 18788 } } },
  { model: 'iPhone 14 Pro', storage: '512GB', category: 'PHONE_USED', cost: 17500, cash: 20900, bc: 18200, fin: 17100, t1: 12, d1: null, t2: null, gfin: { list: 20900, over: 2000, maxMonths: 12, minDownPct: 25 },
    expect: { down1: 2800, contract: '2197.06', display: 2198, sheet: 2196, price2: 19740, rate2: { down: 0, monthly: 3020, months: 12, price3: 19651 } } },
  { model: 'iPhone 14 Pro Max', storage: '128GB', category: 'PHONE_USED', cost: 18000, cash: 21900, bc: 19000, fin: 17900, t1: 12, d1: null, t2: null, gfin: { list: 21900, over: 2000, maxMonths: 12, minDownPct: 25 },
    expect: { down1: 2900, contract: '2296.93', display: 2297, sheet: 2295, price2: 20610, rate2: { down: 0, monthly: 3148, months: 12, price3: 20513 } } },
  { model: 'iPhone 14 Pro Max', storage: '256GB', category: 'PHONE_USED', cost: 19000, cash: 22900, bc: 19700, fin: 18600, t1: 12, d1: null, t2: null, gfin: { list: 22900, over: 2000, maxMonths: 12, minDownPct: 25 },
    expect: { down1: 3000, contract: '2382.53', display: 2383, sheet: 2381, price2: 21370, rate2: { down: 0, monthly: 3275, months: 12, price3: 21376 } } },
  { model: 'iPhone 15', storage: '128GB', category: 'PHONE_USED', cost: 15500, cash: 18900, bc: 17000, fin: 16000, t1: 12, d1: null, t2: null, gfin: { list: 16900, over: 2000, maxMonths: 12, minDownPct: 25 },
    expect: { down1: 2600, contract: '2054.40', display: 2055, sheet: 2053, price2: 18440, rate2: { down: 1900, monthly: 2510, months: 12, price3: 18101 } } },
  { model: 'iPhone 15', storage: '256GB', category: 'PHONE_USED', cost: 16500, cash: 19900, bc: 17500, fin: 16800, t1: 12, d1: null, t2: null, gfin: { list: 17900, over: 2000, maxMonths: 12, minDownPct: 25 },
    expect: { down1: 2700, contract: '2111.46', display: 2112, sheet: 2110, price2: 18980, rate2: { down: 1900, monthly: 2638, months: 12, price3: 18963 } } },
  { model: 'iPhone 15 Plus', storage: '128GB', category: 'PHONE_USED', cost: 17000, cash: 21900, bc: 19500, fin: 18300, t1: 12, d1: null, t2: null, gfin: { list: 19900, over: 2000, maxMonths: 12, minDownPct: 25 },
    expect: { down1: 3000, contract: '2354.00', display: 2354, sheet: 2352, price2: 21150, rate2: { down: 1900, monthly: 2893, months: 12, price3: 20688 } } },
  { model: 'iPhone 15 Plus', storage: '256GB', category: 'PHONE_USED', cost: 18000, cash: 22900, bc: 20000, fin: 19000, t1: 12, d1: null, t2: null, gfin: { list: 20900, over: 2000, maxMonths: 12, minDownPct: 25 },
    expect: { down1: 3000, contract: '2425.33', display: 2426, sheet: 2424, price2: 21700, rate2: { down: 1900, monthly: 3020, months: 12, price3: 21551 } } },
  { model: 'iPhone 15 Pro', storage: '128GB', category: 'PHONE_USED', cost: 18500, cash: 23900, bc: 20500, fin: 18600, t1: 12, d1: null, t2: null, gfin: { list: 22900, over: 2000, maxMonths: 12, minDownPct: 25 },
    expect: { down1: 3100, contract: '2482.40', display: 2483, sheet: 2481, price2: 22240, rate2: { down: 0, monthly: 3275, months: 12, price3: 21376 } } },
  { model: 'iPhone 15 Pro', storage: '256GB', category: 'PHONE_USED', cost: 19500, cash: 24900, bc: 21200, fin: 19400, t1: 12, d1: null, t2: null, gfin: { list: 23900, over: 2000, maxMonths: 12, minDownPct: 25 },
    expect: { down1: 3200, contract: '2568.00', display: 2568, sheet: 2566, price2: 23000, rate2: { down: 0, monthly: 3403, months: 12, price3: 22238 } } },
  { model: 'iPhone 15 Pro Max', storage: '256GB', category: 'PHONE_USED', cost: 22800, cash: 26900, bc: 24200, fin: 23100, t1: 12, d1: null, t2: null, gfin: { list: 28900, over: 2000, maxMonths: 15, minDownPct: 25 },
    expect: { down1: 3700, contract: '2924.66', display: 2925, sheet: 2923, price2: 26250, rate2: { down: 0, monthly: 3500, months: 15, price3: 26551 } } },
  { model: 'iPhone 15 Pro Max', storage: '512GB', category: 'PHONE_USED', cost: 23800, cash: 27900, bc: 25000, fin: 23900, t1: 12, d1: null, t2: null, gfin: { list: 29900, over: 2000, maxMonths: 15, minDownPct: 25 },
    expect: { down1: 3800, contract: '3024.53', display: 3025, sheet: 3023, price2: 27120, rate2: { down: 0, monthly: 3610, months: 15, price3: 27413 } } },
  { model: 'iPhone 16', storage: '128GB', category: 'PHONE_USED', cost: 19000, cash: 21900, bc: 20800, fin: 19800, t1: 12, d1: null, t2: null, gfin: { list: 21900, over: 2000, maxMonths: 15, minDownPct: 25 },
    expect: { down1: 3200, contract: '2510.93', display: 2511, sheet: 2509, price2: 22560, rate2: { down: 1900, monthly: 2730, months: 15, price3: 22413 } } },
  { model: 'iPhone 16', storage: '256GB', category: 'PHONE_USED', cost: 20000, cash: 22900, bc: 21500, fin: 20500, t1: 12, d1: null, t2: null, gfin: { list: 22900, over: 2000, maxMonths: 15, minDownPct: 25 },
    expect: { down1: 3300, contract: '2596.53', display: 2597, sheet: 2595, price2: 23320, rate2: { down: 1900, monthly: 2840, months: 15, price3: 23276 } } },
  { model: 'iPhone 16 Plus', storage: '128GB', category: 'PHONE_USED', cost: 22500, cash: 24900, bc: 23200, fin: 22300, t1: 12, d1: null, t2: null, gfin: { list: 23900, over: 2000, maxMonths: 15, minDownPct: 25 },
    expect: { down1: 3500, contract: '2810.53', display: 2811, sheet: 2809, price2: 25170, rate2: { down: 2900, monthly: 2950, months: 15, price3: 25138 } } },
  { model: 'iPhone 16 Plus', storage: '256GB', category: 'PHONE_USED', cost: 23500, cash: 25900, bc: 24000, fin: 23000, t1: 12, d1: null, t2: null, gfin: { list: 24900, over: 2000, maxMonths: 15, minDownPct: 25 },
    expect: { down1: 3600, contract: '2910.40', display: 2911, sheet: 2909, price2: 26040, rate2: { down: 2900, monthly: 3060, months: 15, price3: 26001 } } },
  { model: 'iPhone 16 Pro', storage: '128GB', category: 'PHONE_USED', cost: 22000, cash: 26900, bc: 23500, fin: 22400, t1: 12, d1: null, t2: null, gfin: { list: 27900, over: 2000, maxMonths: 15, minDownPct: 25 },
    expect: { down1: 3600, contract: '2839.06', display: 2840, sheet: 2837, price2: 25490, rate2: { down: 0, monthly: 3390, months: 15, price3: 25688 } } },
  { model: 'iPhone 16 Pro', storage: '256GB', category: 'PHONE_USED', cost: 23000, cash: 27900, bc: 24200, fin: 23100, t1: 12, d1: null, t2: null, gfin: { list: 28900, over: 2000, maxMonths: 15, minDownPct: 25 },
    expect: { down1: 3700, contract: '2924.66', display: 2925, sheet: 2923, price2: 26250, rate2: { down: 0, monthly: 3500, months: 15, price3: 26551 } } },
  { model: 'iPhone 16 Pro Max', storage: '256GB', category: 'PHONE_USED', cost: 27500, cash: 32900, bc: 29200, fin: 27600, t1: 12, d1: null, t2: null, gfin: { list: 34900, over: 2000, maxMonths: 15, minDownPct: 25 },
    expect: { down1: 4400, contract: '3538.13', display: 3539, sheet: 3536, price2: 31680, rate2: { down: 0, monthly: 4160, months: 15, price3: 31726 } } },
  { model: 'iPhone 16 Pro Max', storage: '512GB', category: 'PHONE_USED', cost: 28500, cash: 33900, bc: 30700, fin: 29100, t1: 12, d1: null, t2: null, gfin: { list: 36900, over: 2000, maxMonths: 15, minDownPct: 25 },
    expect: { down1: 4700, contract: '3709.33', display: 3710, sheet: 3707, price2: 33300, rate2: { down: 0, monthly: 4380, months: 15, price3: 33451 } } },
  { model: 'iPhone 17', storage: '256GB', category: 'PHONE_USED', cost: 24500, cash: 27900, bc: 25000, fin: 24000, t1: 12, d1: null, t2: null, gfin: { list: 24900, over: 2000, maxMonths: 15, minDownPct: 25 },
    expect: { down1: 3800, contract: '3024.53', display: 3025, sheet: 3023, price2: 27120, rate2: { down: 3900, monthly: 3060, months: 15, price3: 27001 } } },
  { model: 'iPhone 17 Pro', storage: '256GB', category: 'PHONE_USED', cost: 33000, cash: 36900, bc: 34500, fin: 33000, t1: 12, d1: 10000, t2: null, gfin: { list: 35900, over: 2000, maxMonths: 15, minDownPct: 25 },
    expect: { down1: 10000, contract: '3495.33', display: 3496, sheet: 3493, price2: 36950, rate2: { down: 4600, monthly: 4270, months: 15, price3: 37188 } } },
  { model: 'iPhone 17 Pro Max', storage: '256GB', category: 'PHONE_USED', cost: 38000, cash: 42900, bc: 40000, fin: 38000, t1: 12, d1: 15000, t2: null, gfin: { list: 40900, over: 2000, maxMonths: 15, minDownPct: 25 },
    expect: { down1: 15000, contract: '3566.66', display: 3567, sheet: 3565, price2: 42500, rate2: { down: 5900, monthly: 4821, months: 15, price3: 42801 } } },
  { model: 'iPhone 17 Pro Max', storage: '512GB', category: 'PHONE_USED', cost: 33000, cash: 43900, bc: 41000, fin: 39000, t1: 12, d1: 15000, t2: null, gfin: { list: 41900, over: 2000, maxMonths: 15, minDownPct: 25 },
    expect: { down1: 15000, contract: '3709.33', display: 3710, sheet: 3707, price2: 43600, rate2: { down: 6100, monthly: 4931, months: 15, price3: 43863 } } },
];

function gfinFor(row: GoldenRow): ModelQuoteGfinContext {
  const condition = row.category === 'PHONE_USED' ? 'HAND_2' : 'HAND_1';
  return {
    mappings: row.gfin
      ? [{ id: 'm', gfinSeries: row.model, gfinVariant: null, storage: row.storage, condition, maxPrice: new Decimal(row.gfin.list), modelMatchPattern: row.model, isActive: true }]
      : [],
    rules: row.gfin
      ? [{ id: 'r', label: row.model, seriesPattern: row.model, condition, allowance: new Decimal(row.gfin.over), maxMonths: row.gfin.maxMonths, minDownPct: row.gfin.minDownPct, isActive: true }]
      : [],
    rateFactors: RATES,
    settingMinDownPct: new Decimal('0.25'),
    commissionPct: 15,
    contractFee: new Decimal(100),
  };
}

function inputFor(row: GoldenRow, over: Partial<ModelQuoteInput> = {}): ModelQuoteInput {
  return {
    product: { brand: 'Apple', model: row.model, storage: row.storage, category: row.category },
    deviceOrigin: 'THAI',
    cashPrice: row.cash,
    bcPrice: row.bc,
    financePrice: row.fin,
    rate1TermMonths: row.t1,
    rate1DownPayment: row.d1,
    rate2TermMonths: row.t2,
    bcConfig: BC,
    gfin: gfinFor(row),
    costPrice: row.cost,
    ...over,
  };
}

const golden = (model: string, storage: string, category: GoldenRow['category']): GoldenRow => {
  const row = GOLDEN.find((g) => g.model === model && g.storage === storage && g.category === category);
  if (!row) throw new Error(`no golden row ${model} ${storage} ${category}`);
  return row;
};

describe('buildModelQuote — ตัวเลขตรวจสเปคข้อ 4.5 (เครื่องไทย)', () => {
  it('iPhone 15 128GB มือ 1: เงินสด 25,900 · เรท 1 ดาวน์ 3,900 · 3,138.66 → 3,139 × 12 · เรท 2 ดาวน์ 6,500 · 3,403 × 12', () => {
    const q = buildModelQuote(inputFor(golden('iPhone 15', '128GB', 'PHONE_NEW')));
    expect(q.cash?.price).toBe(25900);
    expect(q.rate1).toMatchObject({ downAmount: 3900, monthlyContract: 3138.66, monthlyDisplay: 3139, months: 12 });
    expect(q.rate2).toMatchObject({ available: true, downAmount: 6500, monthly: 3403, months: 12, submitPrice: 25900, originNote: false });
  });

  it('iPhone 15 128GB มือ 1 ทุน 25,800: ราคา 2 = 28,100 · ราคา 3 = 28,738 · กำไร 100 / 2,300 / 2,938', () => {
    const q = buildModelQuote(inputFor(golden('iPhone 15', '128GB', 'PHONE_NEW')));
    expect(q.cash?.profit).toBe(100);
    expect(q.rate1).toMatchObject({ recordedSalePrice: 28100, profit: 2300 });
    expect(q.rate2).toMatchObject({ recordedSalePrice: 28738, profit: 2938 });
  });

  it('iPhone 17 Pro 256GB มือ 1: ดาวน์กำหนดเอง 15,000 · 3,424.00 → 3,424 × 12 · เรท 2 ดาวน์ 9,700 · 4,403 × 15', () => {
    const q = buildModelQuote(inputFor(golden('iPhone 17 Pro', '256GB', 'PHONE_NEW')));
    expect(q.cash?.price).toBe(39000);
    expect(q.rate1).toMatchObject({ downAmount: 15000, monthlyContract: 3424, monthlyDisplay: 3424, months: 12 });
    expect(q.rate2).toMatchObject({ available: true, downAmount: 9700, monthly: 4403, months: 15 });
  });

  it('iPhone 12 64GB มือ 2: เรท 1 ดาวน์ 1,100 · 1,010.08 → 1,011 × 10 · GFIN ไม่รับ', () => {
    const q = buildModelQuote(inputFor(golden('iPhone 12', '64GB', 'PHONE_USED')));
    expect(q.cash?.price).toBe(8900);
    expect(q.rate1).toMatchObject({ downAmount: 1100, monthlyContract: 1010.08, monthlyDisplay: 1011, months: 10 });
    expect(q.rate2).toEqual({ available: false, reason: 'NO_PRICE_LIST', message: 'GFIN ไม่รับรุ่นนี้' });
  });

  it('iPhone 13 128GB มือ 2: เรท 1 ดาวน์ 1,600 · 1,226.93 → 1,227 × 12 · เรท 2 ดาวน์ 0 · 1,745 × 12', () => {
    const q = buildModelQuote(inputFor(golden('iPhone 13', '128GB', 'PHONE_USED')));
    expect(q.cash?.price).toBe(12500);
    expect(q.rate1).toMatchObject({ downAmount: 1600, monthlyContract: 1226.93, monthlyDisplay: 1227, months: 12 });
    expect(q.rate2).toMatchObject({ available: true, downAmount: 0, monthly: 1745, months: 12 });
  });

  it('iPhone 14 Pro 128GB มือ 2: เรท 1 ดาวน์ 2,500 · 1,997.33 → 1,998 × 12 · เรท 2 ดาวน์ 0 · 2,765 × 12', () => {
    const q = buildModelQuote(inputFor(golden('iPhone 14 Pro', '128GB', 'PHONE_USED')));
    expect(q.cash?.price).toBe(18900);
    expect(q.rate1).toMatchObject({ downAmount: 2500, monthlyContract: 1997.33, monthlyDisplay: 1998, months: 12 });
    expect(q.rate2).toMatchObject({ available: true, downAmount: 0, monthly: 2765, months: 12 });
  });
});

describe('buildModelQuote — 53 แถวของชีต MASTER (สเปคข้อ 10)', () => {
  it('ชุดตรวจครบ 53 แถว (มือ 1 8 · มือ 2 45)', () => {
    expect(GOLDEN.filter((g) => g.category === 'PHONE_NEW')).toHaveLength(8);
    expect(GOLDEN.filter((g) => g.category === 'PHONE_USED')).toHaveLength(45);
  });

  it.each(GOLDEN.map((g) => [`${g.model} ${g.storage} ${g.category === 'PHONE_NEW' ? 'มือ 1' : 'มือ 2'}`, g] as const))(
    '%s',
    (_name, row) => {
      const q = buildModelQuote(inputFor(row));
      expect(q.cash).toEqual({ price: row.cash, profit: row.cost === null ? null : row.cash - row.cost });

      expect(q.rate1).not.toBeNull();
      expect(q.rate1!.downAmount).toBe(row.expect.down1);
      expect(q.rate1!.months).toBe(row.t1);
      expect(q.rate1!.monthlyContract.toFixed(2)).toBe(row.expect.contract);
      expect(q.rate1!.monthlyDisplay).toBe(row.expect.display);
      // ชีตคูณเรท 0.1426 แล้วปัดลง · สัญญาคิด 50% จริงแล้วแสดงปัดขึ้น ⇒ สูงกว่าชีตได้ 0–3 บาท (11 แถวต่าง 3)
      expect(q.rate1!.monthlyDisplay - row.expect.sheet).toBeGreaterThanOrEqual(0);
      expect(q.rate1!.monthlyDisplay - row.expect.sheet).toBeLessThanOrEqual(3);
      expect(q.rate1!.recordedSalePrice).toBe(row.expect.price2);
      expect(q.rate1!.profit).toBe(row.cost === null ? null : row.expect.price2 - row.cost);

      if (row.expect.rate2 === null) {
        expect(q.rate2).toMatchObject({ available: false, reason: 'NO_PRICE_LIST' });
      } else {
        expect(q.rate2).toMatchObject({
          available: true,
          downAmount: row.expect.rate2.down,
          monthly: row.expect.rate2.monthly,
          months: row.expect.rate2.months,
          recordedSalePrice: row.expect.rate2.price3,
          profit: row.cost === null ? null : row.expect.rate2.price3 - row.cost,
        });
      }
    },
  );
});

describe('buildModelQuote — กติกาเพิ่มเติม', () => {
  const iphone15 = golden('iPhone 15', '128GB', 'PHONE_NEW');

  it('เครื่องนอก → OVER ครึ่ง (ราคาส่ง 24,900 + 500)', () => {
    const q = buildModelQuote(inputFor(iphone15, { deviceOrigin: 'IMPORTED' }));
    expect(q.rate2).toMatchObject({ available: true, submitPrice: 25400, downAmount: 6400, monthly: 3339, months: 12, originNote: false });
  });

  it('ยังไม่ระบุไทย/นอก → OVER ครึ่ง + originNote', () => {
    const q = buildModelQuote(inputFor(iphone15, { deviceOrigin: null }));
    expect(q.rate2).toMatchObject({ available: true, submitPrice: 25400, monthly: 3339, originNote: true });
  });

  it('งวดเรท 1 ของรุ่นไม่อยู่ในตารางดอกเบี้ย → 12 · ไม่มี 12 → งวดแรกที่มี', () => {
    expect(buildModelQuote(inputFor(iphone15, { rate1TermMonths: 24 })).rate1?.months).toBe(12);
    const only10: BcConfig = { ...BC, ratePctByMonths: new Map([[10, new Decimal('0.50')]]), allowedMonths: [10] };
    const q = buildModelQuote(inputFor(iphone15, { rate1TermMonths: 12, bcConfig: only10 }));
    expect(q.rate1?.months).toBe(10);
    expect(q.rate1?.allowedMonths).toEqual([10]);
  });

  it('ดาวน์เรท 1 ที่กำหนดเป็นจำนวนเงินไม่ถูกปัด (15,050 คง 15,050)', () => {
    const q = buildModelQuote(inputFor(golden('iPhone 17 Pro', '256GB', 'PHONE_NEW'), { rate1DownPayment: 15050 }));
    expect(q.rate1?.downAmount).toBe(15050);
  });

  it('ไม่มีตั้งค่าดอกเบี้ย หรือไม่มีราคาผ่อน → เรท 1 = null', () => {
    expect(buildModelQuote(inputFor(iphone15, { bcConfig: null })).rate1).toBeNull();
    expect(buildModelQuote(inputFor(iphone15, { bcPrice: null })).rate1).toBeNull();
  });

  it('ไม่มีราคาขาย GFIN → เรท 2 ใช้ราคาผ่อน BESTCHOICE', () => {
    const q = buildModelQuote(inputFor(iphone15, { financePrice: null }));
    expect(q.rate2).toMatchObject({ available: true, salePrice: 25900 });
  });

  it('ไม่มีราคาเลยทั้งสองช่อง → NO_PRICE', () => {
    const q = buildModelQuote(inputFor(iphone15, { financePrice: null, bcPrice: null }));
    expect(q.rate2).toMatchObject({ available: false, reason: 'NO_PRICE' });
  });

  it('ไม่มีเรท GFIN ของงวดนั้น → NO_RATE พร้อมจำนวนงวด', () => {
    const q = buildModelQuote(inputFor(iphone15, { rate2TermMonths: 18 }));
    expect(q.rate2).toEqual({ available: false, reason: 'NO_RATE', message: 'ยังไม่มีเรท GFIN 18 งวด' });
  });

  it('ไม่ส่งตั้งค่า GFIN → NO_CONFIG', () => {
    expect(buildModelQuote(inputFor(iphone15, { gfin: null })).rate2).toMatchObject({ available: false, reason: 'NO_CONFIG' });
  });

  it('ไม่ส่งทุน → กำไรทุกแถวเป็น null', () => {
    const q = buildModelQuote(inputFor(iphone15, { costPrice: undefined }));
    expect(q.cash?.profit).toBeNull();
    expect(q.rate1?.profit).toBeNull();
    expect(q.rate2).toMatchObject({ profit: null });
  });

  it('ไม่มีราคาเงินสด → cash = null', () => {
    expect(buildModelQuote(inputFor(iphone15, { cashPrice: null })).cash).toBeNull();
  });
});
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**

Run: `cd packages/shared && npx vitest run src/model-quote.test.ts`
Expected: FAIL — `Failed to resolve import "./model-quote"`

- [ ] **Step 3: เขียนโค้ด**

`packages/shared/src/model-quote.ts`:

```ts
import Decimal from 'decimal.js';
import {
  calcBcInstallment,
  calcGfinInstallment,
  findGfinMapping,
  findGfinOverpriceRule,
  findGfinRateFactor,
  resolveGfinDownPct,
} from './installment-calc';
import { displayInstallment } from './installment-rounding';
import type {
  BcConfig,
  GfinDeviceOrigin,
  GfinModelMappingRow,
  GfinOverpriceRuleRow,
  GfinRateFactorRow,
  ProductForGfin,
} from './installment-calc.types';

/** ตาราง GFIN ที่ใช้คิดเรท 2 — ผู้เรียกโหลดครั้งเดียวต่อคำขอแล้วใช้กับทุกรุ่น */
export interface ModelQuoteGfinContext {
  mappings: GfinModelMappingRow[];
  rules: GfinOverpriceRuleRow[];
  rateFactors: GfinRateFactorRow[];
  /** ค่าตั้ง gfin.minDownPct เป็นสัดส่วน เช่น 0.25 */
  settingMinDownPct: Decimal;
  /** % คอมที่ร้านเลือก เช่น 15 (มือถือ) / 5 (iPad) */
  commissionPct: number;
  /** ค่าทำสัญญาที่ GFIN หัก เช่น 100 */
  contractFee: Decimal;
}

export interface ModelQuoteInput {
  product: ProductForGfin;
  /** null = ยังไม่รู้ไทย/นอก → OVER ครึ่ง */
  deviceOrigin: GfinDeviceOrigin | null;
  cashPrice: number | null;
  /** ราคาผ่อน BESTCHOICE (ราคาเต็ม) */
  bcPrice: number | null;
  /** ราคาขาย GFIN (ราคาเต็ม) · null → ใช้ bcPrice */
  financePrice: number | null;
  rate1TermMonths?: number | null;
  /** ดาวน์เรท 1 ที่กำหนดเป็นจำนวนเงิน — ไม่ปัด */
  rate1DownPayment?: number | null;
  rate2TermMonths?: number | null;
  /** null → เรท 1 = null */
  bcConfig: BcConfig | null;
  /** null → เรท 2 ใช้ไม่ได้ 'NO_CONFIG' */
  gfin: ModelQuoteGfinContext | null;
  /** มีค่า = เติมกำไร · ไม่มี = กำไรเป็น null (ผู้ไม่เห็นทุน) */
  costPrice?: number | null;
}

export interface CashQuote {
  price: number;
  profit: number | null;
}

export interface Rate1Quote {
  price: number;
  downAmount: number;
  months: number;
  /** ค่างวดในสัญญา (สตางค์) จาก calcBcInstallment */
  monthlyContract: number;
  /** displayInstallment(monthlyContract) */
  monthlyDisplay: number;
  /** ราคา 2 = ปัดลง(ดาวน์ + ยอดจัด × (1 + ค่าคอม)) */
  recordedSalePrice: number;
  profit: number | null;
  /** งวดที่ตั้งค่าดอกเบี้ยมีอัตรา (เพิ่มจากสัญญากลาง — บอทบอกลูกค้าเมื่อขอจำนวนงวดที่ทำไม่ได้) */
  allowedMonths: number[];
}

export type Rate2Quote =
  | {
      available: true;
      salePrice: number;
      submitPrice: number;
      downAmount: number;
      months: number;
      monthly: number;
      /** ราคา 3 = ปัดลง(ยอดจัด × (1 + คอม %) − ค่าทำสัญญา + ดาวน์ลูกค้า) */
      recordedSalePrice: number;
      profit: number | null;
      /** true เมื่อไม่รู้ไทย/นอก (คิด OVER ครึ่งไว้ก่อน) */
      originNote: boolean;
    }
  | { available: false; reason: 'NO_PRICE_LIST' | 'NO_RATE' | 'NO_PRICE' | 'NO_CONFIG'; message: string };

export interface ModelQuote {
  cash: CashQuote | null;
  rate1: Rate1Quote | null;
  rate2: Rate2Quote;
}

function positive(v: number | null | undefined): number | null {
  return v != null && Number.isFinite(v) && v > 0 ? v : null;
}

function profitOf(price: number, cost: number | null | undefined): number | null {
  return cost != null && Number.isFinite(cost) ? price - cost : null;
}

/** งวดเรท 1: งวดของรุ่นถ้าตั้งค่าดอกเบี้ยมีอัตรา · ไม่งั้น 12 ถ้ามี · ไม่งั้นงวดแรกที่มี (สเปคข้อ 4.2) */
function pickRate1Months(allowedMonths: number[], wanted: number | null | undefined): number | null {
  if (allowedMonths.length === 0) return null;
  if (wanted != null && allowedMonths.includes(wanted)) return wanted;
  return allowedMonths.includes(12) ? 12 : allowedMonths[0];
}

function buildRate1(input: ModelQuoteInput): Rate1Quote | null {
  const price = positive(input.bcPrice);
  const config = input.bcConfig;
  if (price === null || !config) return null;
  const months = pickRate1Months(config.allowedMonths, input.rate1TermMonths);
  if (months === null) return null;
  const fixedDown = positive(input.rate1DownPayment);
  const out = calcBcInstallment({
    installmentPrice: new Decimal(price),
    months,
    // ดาวน์กำหนดเองเป็นจำนวนเงิน (ไม่ปัด) · ไม่มี = ขั้นต่ำจาก % ที่ calcBcInstallment ปัดขึ้นหลักร้อยให้
    customDownAmount: fixedDown !== null ? new Decimal(fixedDown) : undefined,
    config,
  });
  if (!out.isValid) return null;
  const recordedSalePrice = out.downAmount.add(out.financeToShop).floor().toNumber();
  return {
    price,
    downAmount: out.downAmount.toNumber(),
    months,
    monthlyContract: out.monthlyPayment.toNumber(),
    monthlyDisplay: displayInstallment(out.monthlyPayment),
    recordedSalePrice,
    profit: profitOf(recordedSalePrice, input.costPrice),
    allowedMonths: [...config.allowedMonths],
  };
}

function unavailable(
  reason: 'NO_PRICE_LIST' | 'NO_RATE' | 'NO_PRICE' | 'NO_CONFIG',
  message: string,
): Rate2Quote {
  return { available: false, reason, message };
}

function buildRate2(input: ModelQuoteInput): Rate2Quote {
  const g = input.gfin;
  if (!g) return unavailable('NO_CONFIG', 'ยังไม่ได้ตั้งค่า GFIN');
  const salePrice = positive(input.financePrice) ?? positive(input.bcPrice);
  if (salePrice === null) return unavailable('NO_PRICE', 'ยังไม่มีราคาขาย GFIN ของรุ่นนี้');
  const mapping = findGfinMapping(input.product, g.mappings);
  if (!mapping) return unavailable('NO_PRICE_LIST', 'GFIN ไม่รับรุ่นนี้');
  const rule = findGfinOverpriceRule(mapping, g.rules);
  // งวดกำหนดเองของรุ่น · ไม่มี = งวดสูงสุดของกติกา OVER · ไม่มีกติกา = 12
  const months = positive(input.rate2TermMonths) ?? rule?.maxMonths ?? 12;
  const rateFactor = findGfinRateFactor(g.rateFactors, months, g.commissionPct);
  if (!rateFactor) return unavailable('NO_RATE', `ยังไม่มีเรท GFIN ${months} งวด`);
  const out = calcGfinInstallment({
    installmentPrice: new Decimal(salePrice),
    product: input.product,
    months,
    downPct: resolveGfinDownPct(rule, g.settingMinDownPct),
    shopCommissionPct: new Decimal(g.commissionPct),
    contractFee: g.contractFee,
    mapping,
    overpriceRule: rule,
    rateFactor,
    deviceOrigin: input.deviceOrigin,
  });
  if (!out.isValid) return unavailable('NO_RATE', out.errors[0] ?? 'คิดเรท GFIN ไม่ได้');
  const recordedSalePrice = out.shopTotalReceived.floor().toNumber();
  return {
    available: true,
    salePrice,
    submitPrice: out.gfinSubmitPrice.toNumber(),
    downAmount: out.downAmountActual.toNumber(),
    months,
    monthly: out.monthlyPayment.toNumber(),
    recordedSalePrice,
    profit: profitOf(recordedSalePrice, input.costPrice),
    originNote: input.deviceOrigin === null,
  };
}

/**
 * ใบเสนอราคาของรุ่นหนึ่ง: เงินสด · เรท 1 (BESTCHOICE) · เรท 2 (GFIN) · กำไร (สเปคข้อ 4.2–4.4)
 * ผู้ใช้: API `PricingQuoteService` (หน้า "ราคาและเรทผ่อน" + บอทขาย) และการ์ดราคาขายในหน้าเพิ่มสินค้า (ช่วง 4)
 */
export function buildModelQuote(input: ModelQuoteInput): ModelQuote {
  const cashPrice = positive(input.cashPrice);
  return {
    cash: cashPrice === null ? null : { price: cashPrice, profit: profitOf(cashPrice, input.costPrice) },
    rate1: buildRate1(input),
    rate2: buildRate2(input),
  };
}
```

`packages/shared/src/index.ts` — เพิ่มบรรทัดต่อจาก `export * from './installment-rounding';`:

```ts
export * from './model-quote';
```

(ถ้า `resolveGfinDownPct` ยังไม่อยู่ในรายการ `export { calcBcInstallment, … } from './installment-calc';` ให้เพิ่มเข้าไปด้วย)

- [ ] **Step 4: รันให้ผ่าน + build**

Run: `cd packages/shared && npx vitest run src/model-quote.test.ts && npm run build`
Expected: PASS (6 + 54 + 11 = 71 tests) · build สำเร็จ

ถ้าแถวใดล้ม: **ห้ามแก้ค่าคาดหวัง** — ค่าในตารางตรวจกับชีตแล้ว ให้ดูว่าช่วง 1ข ปัดดาวน์ลูกค้า / ใช้ `minDownPct` ของกติกาแล้วหรือยัง

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/model-quote.ts packages/shared/src/model-quote.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): add buildModelQuote with MASTER-sheet golden rows" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `PricingTemplatesService.lookup` ถอยไปแถว "ไม่ระบุ" (สเปคข้อ 7.1)

**Files:**
- Modify: `apps/api/src/modules/pricing-templates/pricing-templates.service.ts:49-90` (`lookup`)
- Modify: `apps/api/src/modules/pricing-templates/pricing-templates.service.spec.ts:21-29` (เทสต์ `never falls back from imported to Thai or unspecified prices`)

**Interfaces:**
- Consumes: ไม่มี
- Produces: `lookup(brand, model, storage, category, hasWarranty, deviceOrigin = 'UNSPECIFIED')` — signature เดิม · ลำดับค้น: (ที่มาเครื่อง, ความจุตรง) → (ที่มาเครื่อง, ความจุว่าง) → ("ไม่ระบุ", ความจุตรง) → ("ไม่ระบุ", ความจุว่าง) · ไม่ข้ามจากเครื่องนอกไปเครื่องไทยหรือกลับกัน

- [ ] **Step 1: แก้เทสต์ให้คาดหวังกติกาใหม่ (ยังไม่ผ่าน)**

ใน `pricing-templates.service.spec.ts` แทนที่ `it('never falls back from imported to Thai or unspecified prices', …)` ทั้งบล็อกด้วย:

```ts
  it('เครื่องนอกไม่มีแถวของตัวเอง → ถอยไปแถว "ไม่ระบุ" แต่ไม่ข้ามไปเครื่องไทย (สเปค 7.1)', async () => {
    db.pricingTemplate.findFirst.mockResolvedValue(null);
    expect(
      await service.lookup('Apple', 'iPhone 15', '128GB', 'PHONE_USED', false, 'IMPORTED'),
    ).toBeNull();
    expect(
      db.pricingTemplate.findFirst.mock.calls.map(([args]) => [args.where.deviceOrigin, args.where.storage]),
    ).toEqual([
      ['IMPORTED', '128GB'],
      ['IMPORTED', ''],
      ['UNSPECIFIED', '128GB'],
      ['UNSPECIFIED', ''],
    ]);
  });

  it('เครื่องไทยไม่มีแถวของตัวเอง → คืนแถว "ไม่ระบุ"', async () => {
    const unspecified = { id: 'u1', deviceOrigin: 'UNSPECIFIED' };
    db.pricingTemplate.findFirst.mockImplementation(async ({ where }) =>
      where.deviceOrigin === 'UNSPECIFIED' && where.storage === '128GB' ? unspecified : null,
    );
    expect(await service.lookup('Apple', 'iPhone 15', '128GB', 'PHONE_NEW', null, 'THAI')).toBe(
      unspecified,
    );
  });

  it('ขอแถว "ไม่ระบุ" ตรง ๆ → ไม่ค้นแถวของเครื่องไทย/นอก', async () => {
    db.pricingTemplate.findFirst.mockResolvedValue(null);
    await service.lookup('Apple', 'iPhone 15', null, 'PHONE_NEW', null);
    expect(db.pricingTemplate.findFirst.mock.calls.map(([args]) => args.where.deviceOrigin)).toEqual([
      'UNSPECIFIED',
    ]);
  });
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**

Run: `NODE_OPTIONS=--max-old-space-size=12288 npm --prefix apps/api test -- src/modules/pricing-templates/pricing-templates.service.spec.ts`
Expected: FAIL — ข้อแรกได้ 2 calls (`IMPORTED` เท่านั้น) · ข้อสองได้ `null`

- [ ] **Step 3: แก้โค้ด**

แทนที่เมธอด `lookup` ทั้งเมธอด (`pricing-templates.service.ts:46-90`) ด้วย:

```ts
  /**
   * ค้นราคากลางของรุ่นตอนสร้างสินค้า / หน้า "ราคาและเรทผ่อน" / บอท
   * ไม่มีแถวของเครื่องไทย/เครื่องนอก → ถอยไปแถว "ไม่ระบุ" (สเปคข้อ 7.1) · ไม่ข้ามไปอีกฝั่ง
   * ในแต่ละที่มาเครื่อง: ความจุตรงก่อน แล้วค่อยแถวที่ไม่ระบุความจุ
   */
  async lookup(
    brand: string,
    model: string,
    storage: string | null,
    category: string,
    hasWarranty: boolean | null,
    deviceOrigin: PricingDeviceOrigin = 'UNSPECIFIED',
  ) {
    const origins: PricingDeviceOrigin[] =
      deviceOrigin === 'UNSPECIFIED' ? ['UNSPECIFIED'] : [deviceOrigin, 'UNSPECIFIED'];
    const storages = storage ? [storage, ''] : [''];
    for (const origin of origins) {
      for (const s of storages) {
        const template = await this.prisma.pricingTemplate.findFirst({
          where: {
            deviceOrigin: origin,
            brand: { equals: brand, mode: 'insensitive' },
            model: { equals: model, mode: 'insensitive' },
            storage: s,
            category: category as ProductCategory,
            hasWarranty: category === 'PHONE_USED' ? (hasWarranty ?? false) : false,
            isActive: true,
            deletedAt: null,
          },
        });
        if (template) return template;
      }
    }
    return null;
  }
```

- [ ] **Step 4: รันให้ผ่าน**

Run: `NODE_OPTIONS=--max-old-space-size=12288 npm --prefix apps/api test -- src/modules/pricing-templates/pricing-templates.service.spec.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/pricing-templates/pricing-templates.service.ts apps/api/src/modules/pricing-templates/pricing-templates.service.spec.ts
git commit -m "feat(pricing): template lookup falls back from Thai/imported to unspecified rows" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: ตัวเติมราคาตอนสร้างเครื่อง — ราคาผ่อน = ราคาเต็มเสมอ + ถอยไป "ไม่ระบุ"

**Files:**
- Modify: `apps/api/src/utils/product-price-autofill.util.ts` (ทั้งไฟล์)
- Modify: `apps/api/src/utils/product-price-autofill.util.spec.ts`
- Modify: `apps/api/src/modules/purchase-orders/services/po-receiving.service.ts:47-50` (import), `:248-251` (อ่านค่าตั้ง), `:366` (อาร์กิวเมนต์ที่ 4)
- Modify: `apps/api/src/modules/products/products-price-columns.service.spec.ts:153-159`, `:173-179` (แถวเทมเพลตจำลองเพิ่ม `deviceOrigin`)

**Interfaces:**
- Consumes: `normalizeStorage` (`device-query-normalize.util`) · `syncPriceRowsFromColumns`
- Produces:
  - `autofillProductPriceFromTemplate(tx, input: AutofillInput, logger?)` — พารามิเตอร์ที่ 4 `semanticsOverride` ถูกลบ
  - `AutofillResult.reason: 'FILLED' | 'ALREADY_PRICED' | 'NO_TEMPLATE' | 'ZERO_PRICE'` (ลบ `INSTALLMENT_LOOKS_PER_MONTH`)
  - ลบ export `TemplateInstallmentSemantics`, `SEMANTICS_CONFIG_KEY`, `resolveInstallmentSemantics` (ค่าตั้ง `pricing_template_installment_semantics` เลิกอ่าน — แถวใน `system_configs` ถ้ามีปล่อยไว้ ไม่มีใครอ่าน)

- [ ] **Step 1: แก้เทสต์ (ยังไม่ผ่าน)**

ใน `product-price-autofill.util.spec.ts`:

1. `TPL` เพิ่ม `deviceOrigin: 'UNSPECIFIED',` ต่อจาก `id: 't1',` และ `installmentBestchoicePrice: D('31900'),` แทน `D('2500')`
2. `makeTx` ตัดพารามิเตอร์ `semantics` และ `systemConfig` เหลือ:

```ts
function makeTx(templates: unknown[]) {
  return {
    pricingTemplate: { findMany: jest.fn().mockResolvedValue(templates) },
    product: { update: jest.fn().mockResolvedValue({ id: 'p1' }) },
    productPrice: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: 'row-1' }),
      update: jest.fn().mockResolvedValue({ id: 'row-1' }),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    systemConfig: { findFirst: jest.fn().mockResolvedValue(null) },
  };
}
```

3. ลบ 4 เทสต์: `semantics PER_MONTH (default) → ไม่เติม installmentPrice` · `semantics TOTAL → เติม installmentPrice ด้วย` · `semantics พิมพ์ผิด (เช่น "total ") → warn + ใช้ PER_MONTH ไม่เขียน installmentPrice` · `TOTAL แต่ราคาผ่อน < ราคาเงินสด → เติมเฉพาะเงินสด + reason INSTALLMENT_LOOKS_PER_MONTH`
4. เพิ่มต่อท้าย `describe`:

```ts
  it('ราคาผ่อน BESTCHOICE ของราคากลาง = ราคาเต็ม → เติม installmentPrice พร้อมเงินสดเสมอ ไม่อ่านค่าตั้งใด ๆ (สเปค 3.1)', async () => {
    const tx = makeTx([TPL()]);
    const r = await autofillProductPriceFromTemplate(tx as never, BASE);
    expect(r).toMatchObject({ filled: true, reason: 'FILLED' });
    expect(r.installmentPrice?.toString()).toBe('31900');
    expect(tx.product.update.mock.calls[0][0].data.installmentPrice.toString()).toBe('31900');
    expect(tx.systemConfig.findFirst).not.toHaveBeenCalled();
  });

  it('มือ 2 ที่ราคาผ่อนต่ำกว่าเงินสด (ทุกรุ่นในชีต) ก็ยังเติมราคาผ่อน', async () => {
    const tx = makeTx([
      TPL({ category: 'PHONE_USED', hasWarranty: false, cashPrice: D('8900'), installmentBestchoicePrice: D('7000') }),
    ]);
    const r = await autofillProductPriceFromTemplate(tx as never, {
      ...BASE,
      category: 'PHONE_USED',
      hasWarranty: false,
    });
    expect(r.installmentPrice?.toString()).toBe('7000');
  });

  it('เครื่องไทยไม่มีแถวของตัวเอง → ใช้แถว "ไม่ระบุ" (สเปค 7.1)', async () => {
    const tx = makeTx([TPL({ id: 'u1', deviceOrigin: 'UNSPECIFIED' })]);
    const r = await autofillProductPriceFromTemplate(tx as never, { ...BASE, deviceOrigin: 'THAI' });
    expect(r.templateId).toBe('u1');
    expect(tx.pricingTemplate.findMany.mock.calls[0][0].where.deviceOrigin).toEqual({
      in: ['THAI', 'UNSPECIFIED'],
    });
  });

  it('มีทั้งแถวเครื่องไทยและ "ไม่ระบุ" → ใช้แถวเครื่องไทย', async () => {
    const tx = makeTx([
      TPL({ id: 'u1', deviceOrigin: 'UNSPECIFIED', cashPrice: D('28900') }),
      TPL({ id: 'th', deviceOrigin: 'THAI', cashPrice: D('29900') }),
    ]);
    const r = await autofillProductPriceFromTemplate(tx as never, { ...BASE, deviceOrigin: 'THAI' });
    expect(r.templateId).toBe('th');
    expect(r.cashPrice?.toString()).toBe('29900');
  });

  it('เครื่องที่ไม่ระบุที่มา → ค้นเฉพาะแถว "ไม่ระบุ"', async () => {
    const tx = makeTx([TPL()]);
    await autofillProductPriceFromTemplate(tx as never, BASE);
    expect(tx.pricingTemplate.findMany.mock.calls[0][0].where.deviceOrigin).toEqual({ in: ['UNSPECIFIED'] });
  });
```

ใน `apps/api/src/modules/products/products-price-columns.service.spec.ts` แถวเทมเพลตจำลองสองแห่ง (บรรทัด ~153 และ ~173) เพิ่ม `deviceOrigin: 'UNSPECIFIED',` ต่อจาก `id: 't1',`

- [ ] **Step 2: รันให้เห็นว่าล้ม**

Run: `NODE_OPTIONS=--max-old-space-size=12288 npm --prefix apps/api test -- src/utils/product-price-autofill.util.spec.ts`
Expected: FAIL — `installmentPrice` เป็น `undefined` (ค่าตั้ง PER_MONTH) · `where.deviceOrigin` เป็น `'THAI'`

- [ ] **Step 3: แก้โค้ด**

แทนที่ `apps/api/src/utils/product-price-autofill.util.ts` ทั้งไฟล์:

```ts
import { Prisma, ProductCategory, type PricingTemplate } from '@prisma/client';
import { normalizeStorage } from './device-query-normalize.util';
import { syncPriceRowsFromColumns } from './product-price-sync.util';

export interface AutofillResult {
  filled: boolean;
  reason: 'FILLED' | 'ALREADY_PRICED' | 'NO_TEMPLATE' | 'ZERO_PRICE';
  templateId?: string;
  cashPrice?: Prisma.Decimal;
  installmentPrice?: Prisma.Decimal;
}

export interface AutofillInput {
  deviceOrigin?: 'THAI' | 'IMPORTED' | null;
  productId: string;
  brand: string;
  model: string;
  storage: string | null;
  category: ProductCategory;
  /** null = ไม่รู้สถานะประกันของเครื่อง (เช่น เทิร์นเข้ามา) */
  hasWarranty: boolean | null;
  currentCashPrice: Prisma.Decimal | null;
}

type Logger = { warn: (m: string) => void; log: (m: string) => void };

/** เลือกแถวจากชุดเดียวกัน (ที่มาเครื่องเดียว): ความจุตรงก่อน → แถวไม่ระบุความจุ · ประกันแบบ deterministic */
function pickTemplate(
  rows: PricingTemplate[],
  input: AutofillInput,
  logger?: Logger,
): PricingTemplate | null {
  const wanted = normalizeStorage(input.storage);
  let candidates = rows.filter((r) => normalizeStorage(r.storage) === wanted);
  if (candidates.length === 0) candidates = rows.filter((r) => normalizeStorage(r.storage) === '');
  if (candidates.length === 0) return null;

  if (input.category !== 'PHONE_USED') {
    const noWarranty = candidates.filter((r) => r.hasWarranty === false);
    if (noWarranty.length > 0) candidates = noWarranty;
  } else if (input.hasWarranty !== null) {
    candidates = candidates.filter((r) => r.hasWarranty === input.hasWarranty);
  } else if (candidates.length > 1) {
    // ไม่รู้สถานะประกัน (เครื่องเทิร์น/รับซื้อส่ง null เสมอ) และเทมเพลตมี 2 แถวต่อรุ่น
    // → เลือก "ไม่มีประกัน" = ราคาต่ำกว่า (อนุรักษ์นิยม ไม่ตั้งราคาสูงเกินจริง)
    const noWarranty = candidates.filter((r) => r.hasWarranty === false);
    if (noWarranty.length > 0) candidates = noWarranty;
    logger?.log(
      `[autofill] product=${input.productId} ไม่รู้สถานะประกัน — ใช้ราคาแถว "ไม่มีประกัน" (${input.brand} ${input.model} ${wanted || 'ไม่ระบุความจุ'})`,
    );
  }
  return candidates[0] ?? null;
}

/**
 * B0 §2.1 — เติมราคาตั้งต้นจากตารางราคากลางตอนสร้าง Product
 *
 * เงื่อนไข: เติมเฉพาะเมื่อยังไม่มี cashPrice (ราคาที่คนกรอกชนะเสมอ) · ราคาผ่อน BESTCHOICE ของราคากลาง
 * = ราคาเต็มเสมอ (สเปคข้อ 3.1 — เลิกค่าตั้ง pricing_template_installment_semantics และการเดาว่า
 * "ราคาผ่อนต่ำกว่าเงินสด = ค่างวด" เพราะมือ 2 ในชีตตั้งราคาผ่อนต่ำกว่าเงินสดทุกรุ่น) จึงเติมพร้อมเงินสด
 * · ไม่มีแถวของเครื่องไทย/นอก → ถอยไปแถว "ไม่ระบุ" (สเปคข้อ 7.1)
 *
 * ต้องเรียกภายใน tx ของ caller
 */
export async function autofillProductPriceFromTemplate(
  tx: Prisma.TransactionClient,
  input: AutofillInput,
  logger?: Logger,
): Promise<AutofillResult> {
  if (input.currentCashPrice != null && input.currentCashPrice.greaterThan(0)) {
    return { filled: false, reason: 'ALREADY_PRICED' };
  }

  const origin = input.deviceOrigin ?? 'UNSPECIFIED';
  const origins: ('THAI' | 'IMPORTED' | 'UNSPECIFIED')[] =
    origin === 'UNSPECIFIED' ? ['UNSPECIFIED'] : [origin, 'UNSPECIFIED'];
  const rows = await tx.pricingTemplate.findMany({
    where: {
      deviceOrigin: { in: origins },
      isActive: true,
      deletedAt: null,
      category: input.category,
      brand: { equals: input.brand, mode: 'insensitive' },
      model: { equals: input.model, mode: 'insensitive' },
    },
    // deterministic: hasWarranty asc = แถว false (ไม่มีประกัน / ราคาถูกกว่า) มาก่อนเสมอ
    orderBy: [{ hasWarranty: 'asc' }, { createdAt: 'asc' }],
  });
  if (rows.length === 0) return { filled: false, reason: 'NO_TEMPLATE' };

  let template: PricingTemplate | null = null;
  for (const o of origins) {
    template = pickTemplate(rows.filter((r) => r.deviceOrigin === o), input, logger);
    if (template) break;
  }
  if (!template) return { filled: false, reason: 'NO_TEMPLATE' };

  const cashPrice = new Prisma.Decimal(template.cashPrice.toString());
  if (!cashPrice.greaterThan(0)) return { filled: false, reason: 'ZERO_PRICE' };

  const templateInstallment = new Prisma.Decimal(template.installmentBestchoicePrice.toString());
  const installmentPrice = templateInstallment.greaterThan(0) ? templateInstallment : undefined;

  await tx.product.update({
    where: { id: input.productId },
    data: {
      cashPrice,
      ...(installmentPrice ? { installmentPrice } : {}),
      priceAutofilledAt: new Date(),
    },
  });

  await syncPriceRowsFromColumns(tx, input.productId, {
    cashPrice,
    installmentPrice: installmentPrice ?? null,
  });

  return { filled: true, reason: 'FILLED', templateId: template.id, cashPrice, installmentPrice };
}
```

`apps/api/src/modules/purchase-orders/services/po-receiving.service.ts`:

- บรรทัด 47–50 แทนด้วย `import { autofillProductPriceFromTemplate } from '../../../utils/product-price-autofill.util';`
- ลบ 4 บรรทัด (คอมเมนต์ `// Fix round 1 [Minor]: resolve the installment-semantics …` 3 บรรทัด + `const installmentSemantics = await resolveInstallmentSemantics(tx, this.logger);`) และบรรทัดว่างที่ตามมา
- ในการเรียก `autofillProductPriceFromTemplate(` ลบบรรทัด `installmentSemantics,` (หลัง `this.logger,`)

- [ ] **Step 4: รันให้ผ่าน**

Run: `NODE_OPTIONS=--max-old-space-size=12288 npm --prefix apps/api test -- src/utils/product-price-autofill.util.spec.ts src/modules/products/products-price-columns.service.spec.ts src/modules/purchase-orders src/modules/trade-in`
Expected: PASS ทั้งหมด

- [ ] **Step 5: ตรวจว่าไม่มีผู้อ่านค่าตั้งเหลือ**

Run: `grep -rn "pricing_template_installment_semantics\|resolveInstallmentSemantics\|INSTALLMENT_LOOKS_PER_MONTH" apps/api/src apps/web/src`
Expected: ไม่มีผลลัพธ์

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/utils/product-price-autofill.util.ts apps/api/src/utils/product-price-autofill.util.spec.ts apps/api/src/modules/purchase-orders/services/po-receiving.service.ts apps/api/src/modules/products/products-price-columns.service.spec.ts
git commit -m "feat(pricing): template installment price is always a full price; autofill falls back to unspecified origin" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: `PricingQuoteService` (`listQuotes` + `quoteForModel`)

**Files:**
- Create: `apps/api/src/modules/pricing-templates/pricing-quote.service.ts`
- Create: `apps/api/src/modules/pricing-templates/pricing-quote.service.spec.ts`
- Modify: `apps/api/src/modules/pricing-templates/pricing-templates.module.ts` (providers/exports)
- Modify: `apps/api/src/modules/gfin-config/gfin-settings.util.ts:1-2,34` (ชนิดพารามิเตอร์ `loadGfinSettings` เป็น `SystemConfigReader` — เพื่อรับ client ของธุรกรรมสิทธิ์ได้)

**Interfaces:**
- Consumes: `buildModelQuote`, `ModelQuote`, `BcConfig`, `GfinModelMappingRow`, `GfinOverpriceRuleRow` (มี `minDownPct` จาก 1ข), `GfinRateFactorRow` จาก `@installment/shared` · `resolveBcConfigForCategory` · `loadGfinSettings`, `commissionPctForCategory` · `PricingTemplatesService.lookup` (Task 3) · `currentDomainAccess`
- Produces:
  - `type QuoteCategory = 'PHONE_NEW' | 'PHONE_USED' | 'TABLET'` · `type QuoteOrigin = 'THAI' | 'IMPORTED'`
  - `interface PriceQuoteRow` · `interface PriceQuoteList` (ตามสัญญากลาง)
  - `class PricingQuoteService { constructor(base: PrismaService, templates: PricingTemplatesService); listQuotes(q: { category: QuoteCategory; origin: QuoteOrigin; q?: string }): Promise<PriceQuoteList>; quoteForModel(i: { brand: string; model: string; storage: string; category: QuoteCategory; hasWarranty?: boolean | null; origin: QuoteOrigin }): Promise<ModelQuote | null> }`
  - กติกาแถว: เครื่องไทย/นอกก่อน "ไม่ระบุ" · มือ 2 ที่มี/ไม่มีประกันตัวเลขเท่ากัน → แถวเดียว `hasWarranty: null` · มือ 1 `hasWarranty: false` · เรียง ยี่ห้อ → รุ่น (เลขแบบธรรมชาติ) → ความจุ (GB) → ไม่มีประกันก่อน · `updatedAt` = `max(updatedAt)` ของแถวที่ยังไม่ถูกลบ · ไม่มีทุน/กำไร/ราคาส่ง GFIN

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน**

`apps/api/src/modules/pricing-templates/pricing-quote.service.spec.ts`:

```ts
import { Prisma } from '@prisma/client';
import { PricingQuoteService } from './pricing-quote.service';
import { PricingTemplatesService } from './pricing-templates.service';

const D = (v: string | number) => new Prisma.Decimal(v);

const tpl = (over: Record<string, unknown> = {}) => ({
  id: 't-15',
  deviceOrigin: 'UNSPECIFIED',
  brand: 'Apple',
  model: 'iPhone 15',
  storage: '128GB',
  category: 'PHONE_NEW',
  hasWarranty: false,
  cashPrice: D(25900),
  installmentBestchoicePrice: D(25900),
  installmentFinancePrice: D(25900),
  rate1DownPayment: null,
  rate1TermMonths: 12,
  rate2DownPayment: null,
  rate2TermMonths: null,
  isActive: true,
  createdAt: new Date('2026-11-01T00:00:00Z'),
  updatedAt: new Date('2026-11-19T03:00:00Z'),
  deletedAt: null,
  ...over,
});

const used13 = (over: Record<string, unknown> = {}) =>
  tpl({
    id: 'u13',
    model: 'iPhone 13',
    category: 'PHONE_USED',
    cashPrice: D(12500),
    installmentBestchoicePrice: D(10200),
    installmentFinancePrice: D(9600),
    ...over,
  });

function makeDb(rows: unknown[]) {
  return {
    pricingTemplate: {
      findMany: jest.fn().mockResolvedValue(rows),
      findFirst: jest.fn().mockResolvedValue(null),
      aggregate: jest.fn().mockResolvedValue({ _max: { updatedAt: new Date('2026-11-19T03:00:00Z') } }),
    },
    // ตั้งค่าดอกเบี้ยตามชีต: 10/12 งวด 50% · ดาวน์ขั้นต่ำ 15% · คอม 10% · VAT 7% (FINANCE)
    interestConfig: {
      findFirst: jest.fn().mockResolvedValue({
        minDownPaymentPct: D('0.15'),
        storeCommissionPct: D('0.10'),
        interestRate: D('0.05'),
        minInstallmentMonths: 10,
        maxInstallmentMonths: 12,
        rates: [
          { months: 10, ratePct: D('0.50') },
          { months: 12, ratePct: D('0.50') },
        ],
      }),
    },
    companyInfo: { findFirst: jest.fn().mockResolvedValue({ vatRegistered: true, vatRate: D('0.07') }) },
    // ค่าตั้ง gfin.* ไม่มีแถว → ค่าตั้งต้น (ดาวน์ 25% · คอมมือถือ 15% · ค่าทำสัญญา 100)
    systemConfig: { findFirst: jest.fn().mockResolvedValue(null) },
    gfinModelMapping: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'm1', gfinSeries: 'iPhone 15', gfinVariant: null, storage: '128GB', condition: 'HAND_1', maxPrice: D(24900), modelMatchPattern: 'iPhone 15', isActive: true },
        { id: 'm2', gfinSeries: 'iPhone 13', gfinVariant: null, storage: '128GB', condition: 'HAND_2', maxPrice: D(12900), modelMatchPattern: 'iPhone 13', isActive: true },
      ]),
    },
    gfinOverpriceRule: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'r1', label: 'มือ 1 OVER 1,000', seriesPattern: 'iPhone 15', condition: 'HAND_1', allowance: D(1000), maxMonths: 12, minDownPct: null, isActive: true },
        { id: 'r2', label: 'มือ 2 OVER 0', seriesPattern: 'iPhone 13', condition: 'HAND_2', allowance: D(0), maxMonths: 12, minDownPct: null, isActive: true },
      ]),
    },
    gfinRateFactor: {
      findMany: jest.fn().mockResolvedValue([
        { months: 12, shopCommissionPct: 15, factor: D('0.17'), feePerInstallment: D(100), isActive: true },
      ]),
    },
  };
}

function build(rows: unknown[]) {
  const db = makeDb(rows);
  return { db, service: new PricingQuoteService(db as never, new PricingTemplatesService(db as never)) };
}

describe('PricingQuoteService.listQuotes', () => {
  it('คิดแถวด้วยตัวคำนวณกลาง — iPhone 15 128GB มือ 1 เครื่องไทย = ตัวเลขชีต', async () => {
    const { service } = build([tpl()]);
    const result = await service.listQuotes({ category: 'PHONE_NEW', origin: 'THAI' });
    expect(result).toEqual({
      updatedAt: '2026-11-19T03:00:00.000Z',
      rows: [
        {
          key: 'Apple|iPhone 15|128GB|false',
          brand: 'Apple',
          model: 'iPhone 15',
          storage: '128GB',
          category: 'PHONE_NEW',
          hasWarranty: false,
          cashPrice: 25900,
          rate1: { downAmount: 3900, monthly: 3139, months: 12 },
          rate2: { downAmount: 6500, monthly: 3403, months: 12 },
        },
      ],
    });
  });

  it('ไม่ส่งทุน กำไร ราคาส่ง GFIN หรือราคาบันทึกขายออกไป', async () => {
    const { service } = build([tpl()]);
    const text = JSON.stringify(await service.listQuotes({ category: 'PHONE_NEW', origin: 'THAI' }));
    expect(text).not.toMatch(/profit|submit|cost|recordedSalePrice|salePrice/i);
  });

  it('ค้นแถวของที่มาเครื่องนั้น + "ไม่ระบุ" · มีทั้งคู่ → ใช้แถวของที่มาเครื่อง', async () => {
    const { db, service } = build([
      tpl({ id: 'u', deviceOrigin: 'UNSPECIFIED', cashPrice: D(25900) }),
      tpl({ id: 'th', deviceOrigin: 'THAI', cashPrice: D(26900) }),
    ]);
    const result = await service.listQuotes({ category: 'PHONE_NEW', origin: 'THAI' });
    expect(db.pricingTemplate.findMany.mock.calls[0][0].where).toMatchObject({
      category: 'PHONE_NEW',
      isActive: true,
      deletedAt: null,
      deviceOrigin: { in: ['THAI', 'UNSPECIFIED'] },
    });
    expect(result.rows.map((r) => r.cashPrice)).toEqual([26900]);
  });

  it('เครื่องนอก → เรท 2 คิด OVER ครึ่ง', async () => {
    const { service } = build([tpl()]);
    const result = await service.listQuotes({ category: 'PHONE_NEW', origin: 'IMPORTED' });
    expect(result.rows[0].rate2).toEqual({ downAmount: 6400, monthly: 3339, months: 12 });
  });

  it('มือ 2 มีประกัน / ไม่มีประกันตัวเลขเท่ากัน → แถวเดียว hasWarranty = null', async () => {
    const { service } = build([used13({ hasWarranty: false }), used13({ id: 'u13w', hasWarranty: true })]);
    const result = await service.listQuotes({ category: 'PHONE_USED', origin: 'THAI' });
    expect(result.rows).toEqual([
      {
        key: 'Apple|iPhone 13|128GB|null',
        brand: 'Apple',
        model: 'iPhone 13',
        storage: '128GB',
        category: 'PHONE_USED',
        hasWarranty: null,
        cashPrice: 12500,
        rate1: { downAmount: 1600, monthly: 1227, months: 12 },
        rate2: { downAmount: 0, monthly: 1745, months: 12 },
      },
    ]);
  });

  it('มือ 2 ราคาต่างกัน → สองแถว ไม่มีประกันก่อน', async () => {
    const { service } = build([
      used13({ id: 'w', hasWarranty: true, cashPrice: D(13500) }),
      used13({ hasWarranty: false }),
    ]);
    const result = await service.listQuotes({ category: 'PHONE_USED', origin: 'THAI' });
    expect(result.rows.map((r) => [r.hasWarranty, r.cashPrice])).toEqual([
      [false, 12500],
      [true, 13500],
    ]);
  });

  it('GFIN ไม่มีใบราคาของรุ่น → rate2 บอกเหตุผล', async () => {
    const { service } = build([used13({ model: 'iPhone 12', storage: '64GB' })]);
    const result = await service.listQuotes({ category: 'PHONE_USED', origin: 'THAI' });
    expect(result.rows[0].rate2).toEqual({ unavailable: 'GFIN ไม่รับรุ่นนี้' });
  });

  it('คำค้นที่มีความจุ → ค้นชื่อรุ่นไม่รวมความจุ แล้วกรองความจุ', async () => {
    const { db, service } = build([tpl(), tpl({ id: 't256', storage: '256GB' })]);
    const result = await service.listQuotes({ category: 'PHONE_NEW', origin: 'THAI', q: 'iPhone 15 256GB' });
    expect(db.pricingTemplate.findMany.mock.calls[0][0].where.OR).toEqual([
      { model: { contains: 'iPhone 15', mode: 'insensitive' } },
      { brand: { contains: 'iPhone 15', mode: 'insensitive' } },
    ]);
    expect(result.rows.map((r) => r.storage)).toEqual(['256GB']);
  });

  it('เรียงรุ่นแบบตัวเลขธรรมชาติ แล้วความจุจากน้อยไปมาก', async () => {
    const { service } = build([
      tpl({ id: 'a', model: 'iPhone 16', storage: '128GB' }),
      tpl({ id: 'b', model: 'iPhone 15', storage: '1TB' }),
      tpl({ id: 'c', model: 'iPhone 15', storage: '256GB' }),
    ]);
    const result = await service.listQuotes({ category: 'PHONE_NEW', origin: 'THAI' });
    expect(result.rows.map((r) => `${r.model} ${r.storage}`)).toEqual([
      'iPhone 15 256GB',
      'iPhone 15 1TB',
      'iPhone 16 128GB',
    ]);
  });
});

describe('PricingQuoteService.quoteForModel', () => {
  it('ค้นราคากลางด้วย lookup (ถอยไป "ไม่ระบุ") แล้วคืน ModelQuote เต็ม', async () => {
    const { db, service } = build([]);
    db.pricingTemplate.findFirst.mockImplementation(async ({ where }: { where: { deviceOrigin: string } }) =>
      where.deviceOrigin === 'UNSPECIFIED' ? tpl() : null,
    );
    const quote = await service.quoteForModel({
      brand: 'Apple',
      model: 'iPhone 15',
      storage: '128GB',
      category: 'PHONE_NEW',
      origin: 'THAI',
    });
    expect(quote?.rate1).toMatchObject({ downAmount: 3900, monthlyDisplay: 3139, months: 12, allowedMonths: [10, 12] });
    expect(quote?.rate2).toMatchObject({ available: true, downAmount: 6500, monthly: 3403 });
  });

  it('ไม่มีราคากลางของรุ่น → null', async () => {
    const { service } = build([]);
    expect(
      await service.quoteForModel({ brand: 'Apple', model: 'Nokia', storage: '', category: 'PHONE_NEW', origin: 'THAI' }),
    ).toBeNull();
  });
});
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**

Run: `NODE_OPTIONS=--max-old-space-size=12288 npm --prefix apps/api test -- src/modules/pricing-templates/pricing-quote.service.spec.ts`
Expected: FAIL — `Cannot find module './pricing-quote.service'`

- [ ] **Step 3: เขียนโค้ด**

`apps/api/src/modules/gfin-config/gfin-settings.util.ts`:
- บรรทัด 1 แทนด้วย `import { readIntFlag, readNumberFlag, type SystemConfigReader } from '../../utils/config.util';`
- ลบบรรทัด 2 (`import { PrismaService } …`)
- บรรทัด 34 แทนด้วย `export async function loadGfinSettings(prisma: SystemConfigReader): Promise<GfinSettings> {`

`apps/api/src/modules/pricing-templates/pricing-quote.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import type { PricingTemplate, Prisma } from '@prisma/client';
import {
  buildModelQuote,
  type BcConfig,
  type GfinModelMappingRow,
  type GfinOverpriceRuleRow,
  type GfinRateFactorRow,
  type ModelQuote,
} from '@installment/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { currentDomainAccess } from '../employee-access/access-execution-context';
import { resolveBcConfigForCategory } from '../../utils/bc-installment-config.util';
import {
  extractStorageToken,
  normalizeStorage,
  stripStorageToken,
} from '../../utils/device-query-normalize.util';
import {
  commissionPctForCategory,
  loadGfinSettings,
  type GfinSettings,
} from '../gfin-config/gfin-settings.util';
import { PricingTemplatesService } from './pricing-templates.service';

export type QuoteCategory = 'PHONE_NEW' | 'PHONE_USED' | 'TABLET';
export type QuoteOrigin = 'THAI' | 'IMPORTED';
export const QUOTE_CATEGORIES: readonly QuoteCategory[] = ['PHONE_NEW', 'PHONE_USED', 'TABLET'];

/** หนึ่งแถวของหน้า "ราคาและเรทผ่อน" — ไม่มีทุน / กำไร / ราคาส่ง GFIN (สเปคข้อ 6) */
export interface PriceQuoteRow {
  /** brand|model|storage|hasWarranty */
  key: string;
  brand: string;
  model: string;
  storage: string;
  category: QuoteCategory;
  /** null = มือ 2 ที่มี/ไม่มีประกันตัวเลขเท่ากัน รวมเป็นแถวเดียว */
  hasWarranty: boolean | null;
  cashPrice: number | null;
  /** monthly = ค่างวดที่แสดง (ปัดขึ้นเป็นบาท) */
  rate1: { downAmount: number; monthly: number; months: number } | null;
  rate2: { downAmount: number; monthly: number; months: number } | { unavailable: string };
}

export interface PriceQuoteList {
  /** วันที่แก้ราคากลางล่าสุด (ISO) */
  updatedAt: string | null;
  rows: PriceQuoteRow[];
}

interface QuoteContext {
  bc: Map<QuoteCategory, BcConfig | null>;
  mappings: GfinModelMappingRow[];
  rules: GfinOverpriceRuleRow[];
  rateFactors: GfinRateFactorRow[];
  settings: GfinSettings;
}

const toNumber = (v: Prisma.Decimal | null | undefined): number | null =>
  v == null ? null : Number(v.toString());

const keyOf = (r: { brand: string; model: string; storage: string; hasWarranty: boolean | null }) =>
  `${r.brand}|${r.model}|${r.storage}|${r.hasWarranty === null ? 'null' : String(r.hasWarranty)}`;

/** แถวเดียวกันมีทั้งของเครื่องไทย/นอกและ "ไม่ระบุ" → ใช้แถวของเครื่องไทย/นอก (สเปคข้อ 7.1) */
function preferOrigin(rows: PricingTemplate[], origin: QuoteOrigin): PricingTemplate[] {
  const byKey = new Map<string, PricingTemplate>();
  for (const r of rows) {
    const k = `${r.brand.toLowerCase()}|${r.model.toLowerCase()}|${normalizeStorage(r.storage)}|${r.hasWarranty}`;
    const prev = byKey.get(k);
    if (!prev || (prev.deviceOrigin !== origin && r.deviceOrigin === origin)) byKey.set(k, r);
  }
  return [...byKey.values()];
}

function toQuoteRow(r: PricingTemplate, q: ModelQuote): PriceQuoteRow {
  return {
    key: keyOf(r),
    brand: r.brand,
    model: r.model,
    storage: r.storage,
    category: r.category as QuoteCategory,
    hasWarranty: r.hasWarranty,
    cashPrice: q.cash?.price ?? null,
    rate1: q.rate1
      ? { downAmount: q.rate1.downAmount, monthly: q.rate1.monthlyDisplay, months: q.rate1.months }
      : null,
    rate2: q.rate2.available
      ? { downAmount: q.rate2.downAmount, monthly: q.rate2.monthly, months: q.rate2.months }
      : { unavailable: q.rate2.message },
  };
}

/** มือ 2 ที่มีประกัน / ไม่มีประกันตัวเลขเท่ากันทุกช่อง → แถวเดียว (สเปคข้อ 6) */
function mergeWarrantyTwins(rows: PriceQuoteRow[]): PriceQuoteRow[] {
  const out: PriceQuoteRow[] = [];
  const twins = new Map<string, PriceQuoteRow[]>();
  for (const r of rows) {
    if (r.category !== 'PHONE_USED') {
      out.push(r);
      continue;
    }
    const k = `${r.brand}|${r.model}|${r.storage}`;
    twins.set(k, [...(twins.get(k) ?? []), r]);
  }
  const numbers = (r: PriceQuoteRow) => JSON.stringify([r.cashPrice, r.rate1, r.rate2]);
  for (const group of twins.values()) {
    if (group.length === 2 && numbers(group[0]) === numbers(group[1])) {
      const merged = { ...group[0], hasWarranty: null };
      out.push({ ...merged, key: keyOf(merged) });
    } else {
      out.push(...group);
    }
  }
  return out;
}

function storageGb(storage: string): number {
  const m = normalizeStorage(storage).match(/^(\d+(?:\.\d+)?)(GB|TB)$/);
  if (!m) return Number.MAX_SAFE_INTEGER;
  return m[2] === 'TB' ? Number(m[1]) * 1024 : Number(m[1]);
}

function sortRows(rows: PriceQuoteRow[]): PriceQuoteRow[] {
  const warrantyRank = (w: boolean | null) => (w === true ? 1 : 0);
  return [...rows].sort(
    (a, b) =>
      a.brand.localeCompare(b.brand) ||
      a.model.localeCompare(b.model, 'en', { numeric: true }) ||
      storageGb(a.storage) - storageGb(b.storage) ||
      warrantyRank(a.hasWarranty) - warrantyRank(b.hasWarranty),
  );
}

/**
 * ใบเสนอราคาตามรุ่นจากตารางราคากลาง — ตัวเลขเดียวกับชีต MASTER (ตัวคำนวณกลาง buildModelQuote)
 * ผู้ใช้: GET /pricing-templates/quotes (หน้า "ราคาและเรทผ่อน") และบอทขาย
 */
@Injectable()
export class PricingQuoteService {
  constructor(
    private readonly base: PrismaService,
    private readonly templates: PricingTemplatesService,
  ) {}

  private get prisma() {
    return currentDomainAccess()?.client ?? this.base;
  }

  async listQuotes(query: {
    category: QuoteCategory;
    origin: QuoteOrigin;
    q?: string;
  }): Promise<PriceQuoteList> {
    const text = (query.q ?? '').trim();
    const storageToken = text ? extractStorageToken(text) : null;
    const modelText = storageToken ? stripStorageToken(text) : text;
    const where: Prisma.PricingTemplateWhereInput = {
      isActive: true,
      deletedAt: null,
      category: query.category,
      deviceOrigin: { in: [query.origin, 'UNSPECIFIED'] },
    };
    if (modelText) {
      where.OR = [
        { model: { contains: modelText, mode: 'insensitive' } },
        { brand: { contains: modelText, mode: 'insensitive' } },
      ];
    }
    const rows = await this.prisma.pricingTemplate.findMany({
      where,
      orderBy: [{ brand: 'asc' }, { model: 'asc' }, { storage: 'asc' }, { hasWarranty: 'asc' }],
    });
    const latest = await this.prisma.pricingTemplate.aggregate({
      where: { deletedAt: null },
      _max: { updatedAt: true },
    });
    const picked = preferOrigin(rows, query.origin).filter(
      (r) => !storageToken || normalizeStorage(r.storage) === storageToken,
    );
    const ctx = await this.loadContext();
    const quoted = picked.map((r) => toQuoteRow(r, this.quoteTemplate(r, query.origin, ctx)));
    return {
      updatedAt: latest._max.updatedAt ? latest._max.updatedAt.toISOString() : null,
      rows: sortRows(mergeWarrantyTwins(quoted)),
    };
  }

  async quoteForModel(input: {
    brand: string;
    model: string;
    storage: string;
    category: QuoteCategory;
    hasWarranty?: boolean | null;
    origin: QuoteOrigin;
  }): Promise<ModelQuote | null> {
    const row = await this.templates.lookup(
      input.brand,
      input.model,
      input.storage || null,
      input.category,
      input.hasWarranty ?? null,
      input.origin,
    );
    if (!row) return null;
    return this.quoteTemplate(row, input.origin, await this.loadContext());
  }

  private quoteTemplate(r: PricingTemplate, origin: QuoteOrigin, ctx: QuoteContext): ModelQuote {
    const category = r.category as QuoteCategory;
    return buildModelQuote({
      product: { brand: r.brand, model: r.model, storage: r.storage, category },
      deviceOrigin: origin,
      cashPrice: toNumber(r.cashPrice),
      bcPrice: toNumber(r.installmentBestchoicePrice),
      financePrice: toNumber(r.installmentFinancePrice),
      rate1TermMonths: r.rate1TermMonths,
      rate1DownPayment: toNumber(r.rate1DownPayment),
      rate2TermMonths: r.rate2TermMonths,
      bcConfig: ctx.bc.get(category) ?? null,
      gfin: {
        mappings: ctx.mappings,
        rules: ctx.rules,
        rateFactors: ctx.rateFactors,
        settingMinDownPct: new Decimal(ctx.settings.minDownPct).div(100),
        commissionPct: commissionPctForCategory(ctx.settings, category),
        contractFee: new Decimal(ctx.settings.contractFee),
      },
    });
  }

  /** ตั้งค่าดอกเบี้ยทั้ง 3 หมวด + ตาราง GFIN — ครั้งเดียวต่อคำขอ (อ่านทีละคำสั่ง: client ในธุรกรรมสิทธิ์รันคำสั่งเรียงกันอยู่แล้ว) */
  private async loadContext(): Promise<QuoteContext> {
    const db = this.prisma;
    const bc = new Map<QuoteCategory, BcConfig | null>();
    for (const category of QUOTE_CATEGORIES) {
      const resolved = await resolveBcConfigForCategory(db, category);
      bc.set(category, resolved.found && resolved.config ? resolved.config : null);
    }
    const mappings = await db.gfinModelMapping.findMany({ where: { deletedAt: null, isActive: true } });
    const rules = await db.gfinOverpriceRule.findMany({ where: { deletedAt: null, isActive: true } });
    const factors = await db.gfinRateFactor.findMany({ where: { deletedAt: null, isActive: true } });
    const settings = await loadGfinSettings(db);
    return {
      bc,
      mappings: mappings.map((m) => ({
        id: m.id,
        gfinSeries: m.gfinSeries,
        gfinVariant: m.gfinVariant,
        storage: m.storage,
        condition: m.condition,
        maxPrice: new Decimal(m.maxPrice.toString()),
        modelMatchPattern: m.modelMatchPattern,
        isActive: m.isActive,
      })),
      rules: rules.map((r) => ({
        id: r.id,
        label: r.label,
        seriesPattern: r.seriesPattern,
        condition: r.condition,
        allowance: new Decimal(r.allowance.toString()),
        maxMonths: r.maxMonths ?? null,
        minDownPct: r.minDownPct ?? null,
        isActive: r.isActive,
      })),
      rateFactors: factors.map((f) => ({
        months: f.months,
        shopCommissionPct: f.shopCommissionPct,
        factor: new Decimal(f.factor.toString()),
        feePerInstallment: new Decimal(f.feePerInstallment.toString()),
        isActive: f.isActive,
      })),
      settings,
    };
  }
}
```

`apps/api/src/modules/pricing-templates/pricing-templates.module.ts` แทนทั้งไฟล์:

```ts
import { Module } from '@nestjs/common';
import { PricingTemplatesController } from './pricing-templates.controller';
import { PricingTemplatesService } from './pricing-templates.service';
import { PricingQuoteService } from './pricing-quote.service';

@Module({
  controllers: [PricingTemplatesController],
  providers: [PricingTemplatesService, PricingQuoteService],
  exports: [PricingTemplatesService, PricingQuoteService],
})
export class PricingTemplatesModule {}
```

- [ ] **Step 4: รันให้ผ่าน**

Run: `NODE_OPTIONS=--max-old-space-size=12288 npm --prefix apps/api test -- src/modules/pricing-templates src/modules/gfin-config src/modules/shop-catalog`
Expected: PASS ทั้งหมด (pricing-quote 11 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/pricing-templates/pricing-quote.service.ts apps/api/src/modules/pricing-templates/pricing-quote.service.spec.ts apps/api/src/modules/pricing-templates/pricing-templates.module.ts apps/api/src/modules/gfin-config/gfin-settings.util.ts
git commit -m "feat(pricing): add PricingQuoteService (model quotes from the shared calculator)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: `GET /pricing-templates/quotes` (ทุกตำแหน่ง) + ทะเบียนสิทธิ์

**Files:**
- Modify: `apps/api/src/modules/pricing-templates/pricing-templates.controller.ts` (import + constructor + เมธอดใหม่ก่อน `@Get(':id')` บรรทัด 40)
- Create: `apps/api/src/modules/pricing-templates/pricing-templates.controller.spec.ts`
- Modify: `apps/api/src/modules/employee-access/access-policy.manifest.json` (เพิ่ม 1 แถวต่อจาก `"PricingTemplatesController.lookup"` บรรทัด 957)
- Modify: `apps/api/src/modules/employee-access/access-sticker-pricing-boundaries.ts:14-29` (รายชื่อ route), `:182-192` (คีย์ที่รับ), `:220-230` (เรียก controller)
- Modify: `apps/api/src/modules/employee-access/access-sticker-pricing.integration.spec.ts:147-152` (providers), `:206` (เพิ่ม case)

**Interfaces:**
- Consumes: `PricingQuoteService.listQuotes`, `QuoteCategory` (Task 5)
- Produces: `PricingTemplatesController.quotes(category?: string, origin?: string, q?: string): Promise<PriceQuoteList>` — ค่าเริ่มต้น `category=PHONE_NEW`, `origin=THAI` (สเปคข้อ 3.4 หน้าราคาเริ่มที่เครื่องไทย) · `q` ตัดที่ 80 ตัวอักษร · หมวด/ที่มาเครื่องผิด → 400 · `@Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')` เท่ากับ GET อื่นของ controller (VIEWER ไม่อยู่ในทุก route ตามกติกาของ repo)
- ทะเบียนสิทธิ์: `pricing.read` · `resource: domain` · `resolution: collection` · `surface` = `556e24acdfee9de70114` (คำนวณจาก `["Controller('pricing-templates')","UseGuards(JwtAuthGuard, RolesGuard)","Get('quotes')","Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')"]` ด้วยสูตรใน `tools/check-access-coverage.mjs`) · พนักงาน managed เปิดได้ผ่าน boundary ชุด `STICKER_PRICING_ROUTES`

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน**

`apps/api/src/modules/pricing-templates/pricing-templates.controller.spec.ts`:

```ts
import { BadRequestException } from '@nestjs/common';
import { PricingTemplatesController } from './pricing-templates.controller';

describe('PricingTemplatesController.quotes', () => {
  const listQuotes = jest.fn().mockResolvedValue({ updatedAt: null, rows: [] });
  const controller = new PricingTemplatesController({} as never, { listQuotes } as never);
  beforeEach(() => listQuotes.mockClear());

  it('ค่าเริ่มต้น = มือ 1 · เครื่องไทย (สเปคข้อ 3.4)', async () => {
    await controller.quotes(undefined, undefined, undefined);
    expect(listQuotes).toHaveBeenCalledWith({ category: 'PHONE_NEW', origin: 'THAI', q: undefined });
  });

  it('ส่งตัวกรองต่อ และตัดคำค้นที่ยาวเกิน 80 ตัวอักษร', async () => {
    await controller.quotes('PHONE_USED', 'IMPORTED', 'x'.repeat(100));
    expect(listQuotes).toHaveBeenCalledWith({ category: 'PHONE_USED', origin: 'IMPORTED', q: 'x'.repeat(80) });
  });

  it('หมวด / ที่มาเครื่องผิด → 400', () => {
    expect(() => controller.quotes('ACCESSORY', 'THAI')).toThrow(BadRequestException);
    expect(() => controller.quotes('PHONE_NEW', 'UNSPECIFIED')).toThrow(BadRequestException);
  });
});
```

ใน `access-sticker-pricing.integration.spec.ts`:
- import ต่อจากบรรทัด `import { PricingTemplatesService } from '../pricing-templates/pricing-templates.service';` เพิ่ม `import { PricingQuoteService } from '../pricing-templates/pricing-quote.service';`
- `providers:` เพิ่ม `PricingQuoteService,` ต่อจาก `PricingTemplatesService,`
- `cases` เพิ่มบรรทัดต่อจาก `['get', '/pricing-templates/lookup?brand=Owned&model=Absent', undefined, 200],`:

```ts
  ['get', '/pricing-templates/quotes?category=PHONE_NEW&origin=THAI&q=Owned', undefined, 200],
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**

Run: `NODE_OPTIONS=--max-old-space-size=12288 npm --prefix apps/api test -- src/modules/pricing-templates/pricing-templates.controller.spec.ts`
Expected: FAIL — `controller.quotes is not a function`

- [ ] **Step 3: แก้โค้ด**

`pricing-templates.controller.ts`:
- เพิ่ม import ต่อจากบรรทัด `import { PricingTemplatesService } from './pricing-templates.service';`:

```ts
import { PricingQuoteService, QUOTE_CATEGORIES, type QuoteCategory } from './pricing-quote.service';
```

- constructor บรรทัด 16 แทนด้วย:

```ts
  constructor(
    private service: PricingTemplatesService,
    private quoteService: PricingQuoteService,
  ) {}
```

- เพิ่มเมธอดก่อน `@Get(':id')` (ต้องอยู่ก่อน — ไม่งั้น `:id` กิน `quotes`):

```ts
  /** หน้า "ราคาและเรทผ่อน" — ดาวน์ / ค่างวด / งวด ของทุกรุ่นจากตัวคำนวณกลาง · ไม่มีทุน กำไร ราคาส่ง GFIN (สเปคข้อ 6) */
  @Get('quotes')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  quotes(@Query('category') category?: string, @Query('origin') origin?: string, @Query('q') q?: string) {
    const c = category || 'PHONE_NEW';
    if (!QUOTE_CATEGORIES.includes(c as QuoteCategory)) throw new BadRequestException('ประเภทสินค้าไม่ถูกต้อง');
    const o = origin || 'THAI';
    if (o !== 'THAI' && o !== 'IMPORTED') throw new BadRequestException('เครื่องไทย/เครื่องนอกไม่ถูกต้อง');
    return this.quoteService.listQuotes({ category: c as QuoteCategory, origin: o, q: q?.slice(0, 80) });
  }
```

`access-policy.manifest.json` — เพิ่มบรรทัดต่อจาก `"PricingTemplatesController.lookup": {…},`:

```json
  "PricingTemplatesController.quotes": {"classification":"staff","permission":"pricing.read","resource":"domain","company":"resolved-source","file":"apps/api/src/modules/pricing-templates/pricing-templates.controller.ts","transport":"Get('quotes')","surface":"556e24acdfee9de70114","resolution":"collection"},
```

`access-sticker-pricing-boundaries.ts`:
- ใน `STICKER_PRICING_ROUTES` เพิ่ม `'PricingTemplatesController.quotes',` ต่อจาก `'PricingTemplatesController.lookup',`
- บล็อก `const allowed = …` แทนส่วน `: method === 'lookup' ? [ … ] : ['company', 'brand', 'category', 'deviceOrigin'];` ด้วย:

```ts
                  : method === 'lookup'
                    ? [
                        'company',
                        'brand',
                        'model',
                        'storage',
                        'category',
                        'hasWarranty',
                        'deviceOrigin',
                      ]
                    : method === 'quotes'
                      ? ['company', 'category', 'origin', 'q']
                      : ['company', 'brand', 'category', 'deviceOrigin'];
```

- ก่อนบรรทัด `return controller.findAll(q.brand, q.category, q.deviceOrigin);` เพิ่ม:

```ts
                if (method === 'quotes') return controller.quotes(q.category, q.origin, q.q);
```

- [ ] **Step 4: รันให้ผ่าน + ตรวจทะเบียนสิทธิ์**

Run: `NODE_OPTIONS=--max-old-space-size=12288 npm --prefix apps/api test -- src/modules/pricing-templates src/modules/employee-access/access-policy`
Expected: PASS

ตรวจทะเบียน (Linux/macOS/CI): `node tools/check-access-coverage.mjs` → Expected: `Access inventory: … classified entrypoints …` ไม่มี error
บน Windows (git bash):

```bash
node -e "import('node:path').then(p=>{const r=p.default.relative;p.default.relative=(a,b)=>r(a,b).split(p.default.sep).join('/');return import('./tools/check-access-coverage.mjs')})" 2>&1 | grep -E "PricingTemplatesController|Unclassified|Stale"
```
Expected: ไม่มีผลลัพธ์ (27 รายการเดิมที่ฟ้องบน Windows เป็นตัวตกแต่งหลายบรรทัด ไม่เกี่ยว)

ถ้ามีเครื่อง macOS/Linux ที่มี PostgreSQL: `tools/test-employee-access-sticker-pricing.sh` → Expected: PASS รวม case `/pricing-templates/quotes`

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/pricing-templates/pricing-templates.controller.ts apps/api/src/modules/pricing-templates/pricing-templates.controller.spec.ts apps/api/src/modules/employee-access/access-policy.manifest.json apps/api/src/modules/employee-access/access-sticker-pricing-boundaries.ts apps/api/src/modules/employee-access/access-sticker-pricing.integration.spec.ts
git commit -m "feat(pricing): GET /pricing-templates/quotes for all staff roles" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: บอท `get_installment_rates` + `recommend_devices` ใช้ `PricingQuoteService`

**Files:**
- Modify: `apps/api/src/modules/sales-bot/tools/get-installment-rates.tool.ts` (ทั้งไฟล์)
- Modify: `apps/api/src/modules/sales-bot/tools/get-installment-rates.tool.spec.ts` (ทั้งไฟล์)
- Modify: `apps/api/src/modules/sales-bot/tools/recommend-devices.tool.ts:15-37` (คำอธิบาย), `:221-222` (กรองแถว), `:360-366` (สต๊อก), `:427-454` (`pickRates`)
- Modify: `apps/api/src/modules/sales-bot/tools/recommend-devices.tool.spec.ts` (เพิ่ม 2 เทสต์)
- Modify: `apps/api/src/modules/sales-bot/sales-bot.module.ts` (imports)
- Modify: `apps/api/src/cli/bot-eval.cli.ts:224-236` (รูปผลจำลองของ `get_installment_rates`)

**Interfaces:**
- Consumes: `PricingQuoteService.quoteForModel` / `listQuotes`, `PriceQuoteRow`, `QuoteCategory`, `QuoteOrigin` (Task 5) · `ModelQuote` จาก `@installment/shared`
- Produces:
  - `GetInstallmentRatesTool` constructor `(prisma: PrismaService, quotes: PricingQuoteService)`
  - `PricingTemplateRateMatch { deviceOrigin?; condition; brand; model; storage; hasWarranty; rate1: InstallmentRateOption | null; rate2: InstallmentRateOption | null; rate2Unavailable?: string; allowedTerms?: number[] }`
  - `monthlyPrice` ของเรท 1 = ค่างวดที่แสดง (ปัดขึ้นเป็นบาท) · เรท 2 = ค่างวด GFIN (บาทเต็มอยู่แล้ว)
  - ที่มาเครื่อง: ลูกค้าบอกเครื่องนอก → `IMPORTED` · นอกนั้น → `THAI` (= ค่าเริ่มต้นหน้า "ราคาและเรทผ่อน" — สเปคข้อ 10 บอทต้องตรงหน้าราคา)
  - เลิกอ่าน `sticker.*` จาก `system_configs` (ค่าตั้งของสติกเกอร์ไม่ใช่กติกาเรทอีกต่อไป)

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน**

แทนที่ `get-installment-rates.tool.spec.ts` ทั้งไฟล์:

```ts
import type { ModelQuote } from '@installment/shared';
import { PrismaService } from '../../../prisma/prisma.service';
import type { PricingQuoteService, PriceQuoteRow } from '../../pricing-templates/pricing-quote.service';
import { GET_INSTALLMENT_RATES_TOOL, GetInstallmentRatesTool } from './get-installment-rates.tool';

/**
 * ช่วง 2 ของการเลิกใช้ชีต MASTER: ช่องราคาผ่อนของราคากลางเป็น "ราคาเต็ม" แล้ว — บอทเลิกอ่านเป็นค่างวด
 * ตัวเลขทุกตัวมาจาก PricingQuoteService (ตัวคำนวณกลางเดียวกับหน้า "ราคาและเรทผ่อน" และสัญญา)
 * คีย์ downPayment / monthlyPrice คงชื่อเดิม เพราะ collectGroundedPrices (sales-bot.service.ts) เก็บคีย์นี้
 */

const row = (over: Record<string, unknown> = {}) => ({
  deviceOrigin: 'UNSPECIFIED',
  brand: 'Apple',
  model: 'iPhone 15',
  storage: '128GB',
  category: 'PHONE_NEW',
  hasWarranty: false,
  ...over,
});

const quote = (over: Partial<ModelQuote> = {}): ModelQuote => ({
  cash: { price: 25900, profit: null },
  rate1: {
    price: 25900,
    downAmount: 3900,
    months: 12,
    monthlyContract: 3138.66,
    monthlyDisplay: 3139,
    recordedSalePrice: 28100,
    profit: null,
    allowedMonths: [10, 12],
  },
  rate2: {
    available: true,
    salePrice: 25900,
    submitPrice: 25900,
    downAmount: 6500,
    months: 12,
    monthly: 3403,
    recordedSalePrice: 28738,
    profit: null,
    originNote: false,
  },
  ...over,
});

function build(rows: unknown[], q: ModelQuote | null = quote()) {
  const prisma = { pricingTemplate: { findMany: jest.fn().mockResolvedValue(rows) } } as unknown as PrismaService;
  const quotes = {
    quoteForModel: jest.fn().mockResolvedValue(q),
    listQuotes: jest.fn().mockResolvedValue({ updatedAt: null, rows: [] }),
  };
  const tool = new GetInstallmentRatesTool(prisma, quotes as unknown as PricingQuoteService);
  const findMany = prisma.pricingTemplate.findMany as unknown as jest.Mock;
  return { tool, quotes, findMany };
}

describe('GetInstallmentRatesTool.run', () => {
  it('ตอบด้วยตัวเลขจากตัวคำนวณกลาง: เรท 1 ค่างวดที่แสดง (ปัดขึ้น) · เรท 2 GFIN · งวดที่เลือกได้', async () => {
    const { tool, quotes } = build([row()]);
    const r = await tool.run({ query: 'iPhone 15 128GB' });
    expect(r.templates).toEqual([
      {
        deviceOrigin: 'UNSPECIFIED',
        condition: 'มือ 1',
        brand: 'Apple',
        model: 'iPhone 15',
        storage: '128GB',
        hasWarranty: false,
        rate1: { downPayment: 3900, monthlyPrice: 3139, termMonths: 12 },
        rate2: { downPayment: 6500, monthlyPrice: 3403, termMonths: 12 },
        allowedTerms: [10, 12],
      },
    ]);
    expect(quotes.quoteForModel).toHaveBeenCalledWith({
      brand: 'Apple',
      model: 'iPhone 15',
      storage: '128GB',
      category: 'PHONE_NEW',
      hasWarranty: false,
      origin: 'THAI',
    });
  });

  it('GFIN ไม่รับรุ่นนี้ → rate2 = null พร้อมเหตุผล', async () => {
    const { tool } = build(
      [row()],
      quote({ rate2: { available: false, reason: 'NO_PRICE_LIST', message: 'GFIN ไม่รับรุ่นนี้' } }),
    );
    const r = await tool.run({ query: 'iPhone 15' });
    expect(r.templates[0].rate2).toBeNull();
    expect(r.templates[0].rate2Unavailable).toBe('GFIN ไม่รับรุ่นนี้');
  });

  it('ลูกค้าบอกเครื่องนอก → คิดแบบเครื่องนอก และค้นแถวเครื่องนอก + "ไม่ระบุ"', async () => {
    const { tool, quotes, findMany } = build([row()]);
    await tool.run({ query: 'iPhone 15', deviceOrigin: 'IMPORTED' });
    expect(findMany.mock.calls[0][0].where.deviceOrigin).toEqual({ in: ['IMPORTED', 'UNSPECIFIED'] });
    expect(quotes.quoteForModel.mock.calls[0][0].origin).toBe('IMPORTED');
  });

  it('แถวแฝดของเครื่องไทยกับ "ไม่ระบุ" → คิดครั้งเดียว', async () => {
    const { tool, quotes } = build([row({ deviceOrigin: 'THAI' }), row()]);
    const r = await tool.run({ query: 'iPhone 15', deviceOrigin: 'THAI' });
    expect(r.templates).toHaveLength(1);
    expect(quotes.quoteForModel).toHaveBeenCalledTimes(1);
  });

  it('ราคากลางหาไม่เจอตอนคิด (null) → ข้ามแถวนั้น', async () => {
    const { tool } = build([row()], null);
    expect(await tool.run({ query: 'iPhone 15' })).toEqual({ templates: [] });
  });

  it('ตัดคำความจุออกจากคำค้นรุ่น แล้วใช้ความจุเป็นตัวแคบผล', async () => {
    const { tool, findMany } = build([row({ storage: '128GB' }), row({ storage: '256GB' })]);
    const r = await tool.run({ query: 'iPhone 15 256 gb' });
    expect(JSON.stringify(findMany.mock.calls[0][0].where)).not.toContain('256');
    expect(r.templates.map((t) => t.storage)).toEqual(['256GB']);
  });

  it('ความจุที่ขอไม่มีในตาราง → ไม่ทิ้งผลทั้งหมด', async () => {
    const { tool } = build([row({ storage: '128GB' })]);
    expect((await tool.run({ query: 'iPhone 15 1TB' })).templates).toHaveLength(1);
  });

  it('ได้ไม่เกิน 3 แถว', async () => {
    const { tool } = build(['128GB', '256GB', '512GB', '1TB'].map((storage) => row({ storage })));
    expect((await tool.run({ query: 'iPhone 15' })).templates).toHaveLength(3);
  });

  it('ไม่มีแถว / คำค้นว่าง → templates ว่าง', async () => {
    expect(await build([]).tool.run({ query: 'Nokia 3310' })).toEqual({ templates: [] });
    const { tool, findMany } = build([row()]);
    expect(await tool.run({ query: '' })).toEqual({ templates: [] });
    expect(findMany).not.toHaveBeenCalled();
  });

  it('condition → where: มือ 1 = PHONE_NEW · มือสอง/มือ 2 = ไม่ใช่ PHONE_NEW · อื่น = ไม่กรอง', async () => {
    const { tool, findMany } = build([row()]);
    await tool.run({ query: 'iPhone 15', condition: 'มือ 1' });
    expect(findMany.mock.calls[0][0].where.category).toBe('PHONE_NEW');
    await tool.run({ query: 'iPhone 15', condition: 'มือ 2' });
    expect(findMany.mock.calls[1][0].where.category).toEqual({ not: 'PHONE_NEW' });
    await tool.run({ query: 'iPhone 15', condition: 'ใหม่' });
    expect(findMany.mock.calls[2][0].where.category).toBeUndefined();
  });

  it('ที่มาเครื่อง THAI รวมแถว "ไม่ระบุ" · ไม่ส่ง = ไม่กรอง', async () => {
    const { tool, findMany } = build([row()]);
    await tool.run({ query: 'iPhone 15', deviceOrigin: 'THAI' });
    expect(findMany.mock.calls[0][0].where.deviceOrigin).toEqual({ in: ['THAI', 'UNSPECIFIED'] });
    await tool.run({ query: 'iPhone 15' });
    expect(findMany.mock.calls[1][0].where.deviceOrigin).toBeUndefined();
  });

  it('เรียงแถวแฝด มือ 1 ก่อนมือสอง (category ก่อน hasWarranty)', async () => {
    const { tool, findMany } = build([row()]);
    await tool.run({ query: 'iPhone 15' });
    expect(findMany.mock.calls[0][0].orderBy).toEqual([
      { brand: 'asc' },
      { model: 'asc' },
      { storage: 'asc' },
      { category: 'asc' },
      { hasWarranty: 'asc' },
    ]);
  });

  it('คีย์ที่ด่านตรวจตัวเลขเก็บ (downPayment, monthlyPrice) อยู่ในผล', async () => {
    const { tool } = build([row()]);
    const text = JSON.stringify(await tool.run({ query: 'iPhone 15' }));
    expect(text).toContain('"downPayment"');
    expect(text).toContain('"monthlyPrice"');
  });
});

describe('GetInstallmentRatesTool.listAllRates (recommend_devices)', () => {
  it('อ่านใบเสนอราคาเครื่องไทยของมือ 1 และมือ 2 จาก listQuotes', async () => {
    const used: PriceQuoteRow = {
      key: 'Apple|iPhone 13|128GB|null',
      brand: 'Apple',
      model: 'iPhone 13',
      storage: '128GB',
      category: 'PHONE_USED',
      hasWarranty: null,
      cashPrice: 12500,
      rate1: { downAmount: 1600, monthly: 1227, months: 12 },
      rate2: { unavailable: 'GFIN ไม่รับรุ่นนี้' },
    };
    const { tool, quotes } = build([]);
    quotes.listQuotes.mockImplementation(async ({ category }: { category: string }) => ({
      updatedAt: null,
      rows: category === 'PHONE_USED' ? [used] : [],
    }));
    const rows = await tool.listAllRates();
    expect(quotes.listQuotes.mock.calls.map(([q]) => q)).toEqual([
      { category: 'PHONE_NEW', origin: 'THAI' },
      { category: 'PHONE_USED', origin: 'THAI' },
    ]);
    expect(rows).toEqual([
      {
        category: 'PHONE_USED',
        condition: 'มือสอง',
        brand: 'Apple',
        model: 'iPhone 13',
        storage: '128GB',
        hasWarranty: false,
        rate1: { downPayment: 1600, monthlyPrice: 1227, termMonths: 12 },
        rate2: null,
        rate2Unavailable: 'GFIN ไม่รับรุ่นนี้',
      },
    ]);
  });
});

describe('GET_INSTALLMENT_RATES_TOOL description', () => {
  const d = GET_INSTALLMENT_RATES_TOOL.description;

  it('ไม่มีผล → ห้ามเดาเรท ห้ามถามงบ', () => {
    expect(d).toContain("do NOT ask for the customer's budget");
    expect(d).toContain('retry once with the plain English model name');
  });

  it('ป้ายภายในห้ามพิมพ์ · UNSPECIFIED = ตารางปกติ · ห้ามใช้กับโปรฟรีดาวน์เครื่องนอก', () => {
    expect(d).toContain('never print THAI/IMPORTED/UNSPECIFIED');
    expect(d).toContain("UNSPECIFIED rows are the shop's regular (Thai) table");
    expect(d).toContain('Never quote these rows for the imported free-down promo');
  });

  it('บอกว่าเลขปัดเป็นบาทแล้ว · rate2 ว่างได้ · ของวดอื่นให้บอก allowedTerms', () => {
    expect(d).toContain('whole baht');
    expect(d).toContain('rate2Unavailable');
    expect(d).toContain('allowedTerms');
  });

  it('enum condition ของ input คงเดิม', () => {
    expect(GET_INSTALLMENT_RATES_TOOL.input_schema.properties.condition.enum).toEqual(['มือ 1', 'มือสอง']);
  });
});
```

ใน `recommend-devices.tool.spec.ts` เพิ่มต่อท้าย `describe('RecommendDevicesTool.run', …)` (ก่อน `});` ปิด):

```ts
  it('เรท 2 ใช้ไม่ได้ (GFIN ไม่รับ) → พิจารณาเฉพาะเรท 1', async () => {
    const { tool } = build([
      tpl({
        model: 'iPhone 13',
        rate1: { downPayment: 1600, monthlyPrice: 1227, termMonths: 12 },
        rate2: null,
        rate2Unavailable: 'GFIN ไม่รับรุ่นนี้',
      }),
    ]);
    const r = await tool.run({ downBudget: 2000, monthlyBudget: 1300 });
    expect(r.recommended).toHaveLength(1);
    expect(r.recommended[0]).toMatchObject({ rateLabel: 'เรทที่ 1', monthlyPrice: 1227 });
  });

  it('แถวที่คิดไม่ได้ทั้งสองเรท → ไม่ถูกแนะนำและไม่ทำให้ล้ม', async () => {
    const { tool } = build([tpl({ model: 'iPhone 13', rate1: null, rate2: null })]);
    const r = await tool.run({ downBudget: 5000, monthlyBudget: 5000 });
    expect(r.recommended).toEqual([]);
    expect(r.nearMiss).toEqual([]);
  });
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**

Run: `NODE_OPTIONS=--max-old-space-size=12288 npm --prefix apps/api test -- src/modules/sales-bot/tools/get-installment-rates.tool.spec.ts src/modules/sales-bot/tools/recommend-devices.tool.spec.ts`
Expected: FAIL — `monthlyPrice` ได้ค่าจากคอลัมน์เทมเพลต / constructor ไม่รับ `quotes` / `rate1: null` ทำ `pickRates` ล้ม

- [ ] **Step 3: แก้โค้ด**

แทนที่ `apps/api/src/modules/sales-bot/tools/get-installment-rates.tool.ts` ทั้งไฟล์:

```ts
import { Injectable } from '@nestjs/common';
import type { ModelQuote } from '@installment/shared';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  extractStorageToken,
  normalizeStorage,
  stripStorageToken,
} from '../../../utils/device-query-normalize.util';
import {
  PricingQuoteService,
  type PriceQuoteRow,
  type QuoteCategory,
  type QuoteOrigin,
} from '../../pricing-templates/pricing-quote.service';

export const GET_INSTALLMENT_RATES_TOOL = {
  name: 'get_installment_rates',
  description:
    "Look up the shop's installment quotes for a phone model from the price table (PricingTemplate). " +
    'Numbers come from the same calculator as the staff price page and contracts: rate1 = ผ่อนกับร้าน ' +
    '(BESTCHOICE), rate2 = ผ่อนกับ GFIN; each plan has its own downPayment / monthlyPrice / termMonths in ' +
    'whole baht (monthly already rounded up) — quote them directly, never round or recompute. ' +
    '`query` MUST be ONLY the model name (brand/model, optionally storage) — e.g. "iPhone 15 128GB" — with ' +
    'NO other words: matching requires the stored model to contain the query text, so greetings or extra ' +
    'words ("มีไหมคะ") make it match nothing. Returns up to 3 matches. rate2 can be null with ' +
    'rate2Unavailable (Thai reason, e.g. "GFIN ไม่รับรุ่นนี้") — then offer rate1 only. allowedTerms lists ' +
    'the ONLY terms rate1 can be done at; if the customer asks for another term, say which terms are ' +
    'available (e.g. "ผ่อนได้ 10 หรือ 12 งวด") instead of computing a number. Matches can be sibling ' +
    'models (asked "iPhone 15", got "iPhone 15 Pro Max") — ALWAYS attribute quoted numbers to the ' +
    'returned brand+model+storage verbatim. Use this whenever search_products found nothing (or every ' +
    'hit has priceMissing) so the bot can still answer with real down/monthly/term numbers instead of ' +
    "going silent. No match → templates: [] — do NOT guess a rate and do NOT ask for the customer's " +
    'budget; retry once with the plain English model name without storage, then follow the persona rule ' +
    'for an empty table. deviceOrigin and condition are internal labels — never print ' +
    "THAI/IMPORTED/UNSPECIFIED to the customer; UNSPECIFIED rows are the shop's regular (Thai) table. " +
    'Pass deviceOrigin IMPORTED only when the customer wants an imported phone (GFIN gives imported ' +
    'phones a lower price, so rate2 differs). Never quote these rows for the imported free-down promo ' +
    '(promo rates come from search_knowledge_base only). Each match carries `condition` ("มือ 1" = new, ' +
    '"มือสอง" = used) — the same model+storage can have BOTH rows with different numbers (มือ 1 rows ' +
    'come first); quote ONLY the row whose condition matches what the customer is buying (pass ' +
    '`condition` to filter).',
  input_schema: {
    type: 'object',
    properties: {
      deviceOrigin: {
        type: 'string',
        enum: ['THAI', 'IMPORTED', 'UNSPECIFIED'],
        description: 'Device origin requested by the customer, if specified',
      },
      condition: {
        type: 'string',
        enum: ['มือ 1', 'มือสอง'],
        description: 'ใส่เมื่อรู้แล้วว่าลูกค้าสนใจมือ 1 หรือมือสอง — กรองให้เหลือเฉพาะแถวประเภทนั้น',
      },
      query: {
        type: 'string',
        description:
          'Model name ONLY, e.g. "iPhone 15 Pro Max 256GB" — no greetings/extra words ' +
          '(stored model must contain this text)',
      },
    },
    required: ['query'],
  },
};

export interface InstallmentRateOption {
  downPayment: number;
  monthlyPrice: number;
  termMonths: number;
}

export type RateCondition = 'มือ 1' | 'มือสอง';

export interface PricingTemplateRateMatch {
  deviceOrigin?: string;
  /** มือ 1 (PHONE_NEW) / มือสอง (อื่น ๆ) */
  condition: RateCondition;
  brand: string;
  model: string;
  storage: string;
  hasWarranty: boolean;
  /** เรท 1 (ผ่อนกับร้าน) — null = คิดไม่ได้ (ไม่มีราคาผ่อน / ตั้งค่าดอกเบี้ย) */
  rate1: InstallmentRateOption | null;
  /** เรท 2 (GFIN) — null = ใช้ไม่ได้ ดูเหตุผลที่ rate2Unavailable */
  rate2: InstallmentRateOption | null;
  rate2Unavailable?: string;
  /** งวดที่เรท 1 ทำได้ (ตั้งค่าดอกเบี้ย) — ลูกค้าขอวดอื่นให้บอกตัวเลือกนี้ */
  allowedTerms?: number[];
}

export interface GetInstallmentRatesResult {
  templates: PricingTemplateRateMatch[];
}

/** แถวของ listAllRates() — ผู้เรียกภายใน (recommend_devices) ต้องรู้ category ดิบ */
export interface PricingTemplateRateRow extends PricingTemplateRateMatch {
  category: string;
}

interface PricingTemplateRow {
  deviceOrigin: string;
  brand: string;
  model: string;
  storage: string;
  category: string;
  hasWarranty: boolean;
}

const MAX_MATCHES = 3;

/**
 * เรียงผลให้คงที่ และแถวแฝด (รุ่น+ความจุเดียวกัน) ออก มือ 1 ก่อน มือสอง — enum ProductCategory ใน
 * Postgres เรียงตามลำดับประกาศ (PHONE_NEW, PHONE_USED, …) ⇒ category asc = PHONE_NEW ก่อน
 */
const RATE_ORDER_BY = [
  { brand: 'asc' as const },
  { model: 'asc' as const },
  { storage: 'asc' as const },
  { category: 'asc' as const },
  { hasWarranty: 'asc' as const },
];

const conditionOf = (category: string): RateCondition => (category === 'PHONE_NEW' ? 'มือ 1' : 'มือสอง');

/** ลูกค้าขอเครื่องนอก → คิดแบบเครื่องนอก (OVER ครึ่ง) · นอกนั้น = เครื่องไทย (ค่าเริ่มต้นหน้า "ราคาและเรทผ่อน") */
const quoteOrigin = (origin: string | undefined): QuoteOrigin => (origin === 'IMPORTED' ? 'IMPORTED' : 'THAI');

function fromQuote(t: PricingTemplateRow, q: ModelQuote): PricingTemplateRateMatch {
  return {
    deviceOrigin: t.deviceOrigin,
    condition: conditionOf(t.category),
    brand: t.brand,
    model: t.model,
    storage: t.storage,
    hasWarranty: t.hasWarranty,
    rate1: q.rate1
      ? { downPayment: q.rate1.downAmount, monthlyPrice: q.rate1.monthlyDisplay, termMonths: q.rate1.months }
      : null,
    rate2: q.rate2.available
      ? { downPayment: q.rate2.downAmount, monthlyPrice: q.rate2.monthly, termMonths: q.rate2.months }
      : null,
    ...(q.rate2.available ? {} : { rate2Unavailable: q.rate2.message }),
    allowedTerms: q.rate1?.allowedMonths ?? [],
  };
}

function fromQuoteRow(r: PriceQuoteRow): PricingTemplateRateRow {
  const rate2 = 'unavailable' in r.rate2 ? null : r.rate2;
  return {
    category: r.category,
    condition: conditionOf(r.category),
    brand: r.brand,
    model: r.model,
    storage: r.storage,
    hasWarranty: r.hasWarranty === true,
    rate1: r.rate1
      ? { downPayment: r.rate1.downAmount, monthlyPrice: r.rate1.monthly, termMonths: r.rate1.months }
      : null,
    rate2: rate2 ? { downPayment: rate2.downAmount, monthlyPrice: rate2.monthly, termMonths: rate2.months } : null,
    ...('unavailable' in r.rate2 ? { rate2Unavailable: r.rate2.unavailable } : {}),
  };
}

@Injectable()
export class GetInstallmentRatesTool {
  constructor(
    private readonly prisma: PrismaService,
    private readonly quotes: PricingQuoteService,
  ) {}

  async run(
    input: { query?: string; deviceOrigin?: string; condition?: string } = {},
  ): Promise<GetInstallmentRatesResult> {
    const rawQuery = String(input?.query ?? '').trim();
    if (!rawQuery) return { templates: [] };

    const storageToken = extractStorageToken(rawQuery);
    // ตัดความจุออกจากคำค้นรุ่น — ชื่อรุ่นที่เก็บไม่มีคำ "256GB" อยู่ในตัว
    const modelQuery = storageToken ? stripStorageToken(rawQuery) : rawQuery;
    if (!modelQuery) return { templates: [] };

    const rows: PricingTemplateRow[] = await this.prisma.pricingTemplate.findMany({
      where: {
        ...originFilter(input.deviceOrigin),
        ...conditionFilter(input.condition),
        isActive: true,
        deletedAt: null,
        OR: [
          { model: { contains: modelQuery, mode: 'insensitive' } },
          { brand: { contains: modelQuery, mode: 'insensitive' } },
        ],
      },
      orderBy: RATE_ORDER_BY,
      select: { deviceOrigin: true, brand: true, model: true, storage: true, category: true, hasWarranty: true },
    });
    if (rows.length === 0) return { templates: [] };

    // ความจุเป็นตัวแคบผล ไม่ใช่ตัวกรอง — ไม่มีแถวของความจุนั้นก็คงทุกแถวไว้
    let candidates = rows;
    if (storageToken) {
      const bySize = rows.filter((r) => normalizeStorage(r.storage) === storageToken);
      if (bySize.length > 0) candidates = bySize;
    }

    // แถวของเครื่องไทย/นอกกับ "ไม่ระบุ" ของรุ่นเดียวกัน = คิดครั้งเดียว (quoteForModel เลือกแถวตามกติกาข้อ 7.1 เอง)
    const seen = new Set<string>();
    const unique = candidates.filter((r) => {
      if (r.category === 'ACCESSORY') return false;
      const k = `${r.brand.toLowerCase()}|${r.model.toLowerCase()}|${normalizeStorage(r.storage)}|${r.category}|${r.hasWarranty}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    const origin = quoteOrigin(input.deviceOrigin);
    const templates: PricingTemplateRateMatch[] = [];
    for (const t of unique.slice(0, MAX_MATCHES)) {
      const q = await this.quotes.quoteForModel({
        brand: t.brand,
        model: t.model,
        storage: t.storage,
        category: t.category as QuoteCategory,
        hasWarranty: t.hasWarranty,
        origin,
      });
      if (q) templates.push(fromQuote(t, q));
    }
    return { templates };
  }

  /**
   * ใบเสนอราคาทุกรุ่นของมือ 1 / มือ 2 (เครื่องไทย) ให้ recommend_devices — อ่าน listQuotes ซึ่งโหลด
   * ตั้งค่าครั้งเดียวต่อหมวด แทนการเรียก quoteForModel ทีละแถว
   */
  async listAllRates(): Promise<PricingTemplateRateRow[]> {
    const out: PricingTemplateRateRow[] = [];
    for (const category of ['PHONE_NEW', 'PHONE_USED'] as const) {
      const { rows } = await this.quotes.listQuotes({ category, origin: 'THAI' });
      out.push(...rows.map(fromQuoteRow));
    }
    return out;
  }
}

/**
 * THAI / IMPORTED รวมแถว "ไม่ระบุ" (สเปคข้อ 7.1 — ไม่มีแถวของที่มาเครื่องนั้นให้ใช้แถว "ไม่ระบุ")
 * ไม่ส่ง = ไม่กรอง
 */
function originFilter(origin: string | undefined) {
  if (origin === 'THAI' || origin === 'IMPORTED')
    return { deviceOrigin: { in: [origin, 'UNSPECIFIED'] as ('THAI' | 'IMPORTED' | 'UNSPECIFIED')[] } };
  if (origin === 'UNSPECIFIED') return { deviceOrigin: 'UNSPECIFIED' as const };
  return {};
}

function conditionFilter(condition: string | undefined) {
  const c = String(condition ?? '').replace(/\s+/g, '');
  if (c === 'มือ1') return { category: 'PHONE_NEW' as const };
  if (c === 'มือสอง' || c === 'มือ2') return { category: { not: 'PHONE_NEW' as const } };
  return {};
}
```

`recommend-devices.tool.ts`:
- ในคำอธิบาย `RECOMMEND_DEVICES_TOOL.description` แทนข้อความ `'server-side from the same PricingTemplate rates get_installment_rates reads (sticker-exact ' + 'baht), live stock counts, …'` ส่วน `the same PricingTemplate rates get_installment_rates reads (sticker-exact baht)` ด้วย `the same price-table quotes get_installment_rates returns (whole baht, same calculator as contracts)` (แก้เฉพาะวลีนี้ ประโยคอื่นคงเดิม)
- บรรทัด 222 แทนด้วย:

```ts
    // แถวที่คิดไม่ได้ทั้งสองเรท (ไม่มีราคาผ่อน / ไม่มีตั้งค่า) ไม่มีอะไรให้แนะนำ
    const templates = allRates.filter((t) => phoneCats.has(t.category) && (t.rate1 !== null || t.rate2 !== null));
```

- ใน `loadStock` แทนบรรทัด `(r.deviceOrigin ?? 'UNSPECIFIED') === (t.deviceOrigin ?? 'UNSPECIFIED') &&` ด้วย:

```ts
            // ใบเสนอราคาจาก listQuotes ไม่ผูกที่มาเครื่อง (deviceOrigin ว่าง) → นับทุกเครื่องของรุ่นนี้
            (t.deviceOrigin === undefined || (r.deviceOrigin ?? 'UNSPECIFIED') === t.deviceOrigin) &&
```

- ใน `pickRates` แทน `const options: { label: RateLabel; rate: InstallmentRateOption }[] = [ … ];` ด้วย:

```ts
  const options: { label: RateLabel; rate: InstallmentRateOption }[] = [];
  if (t.rate1) options.push({ label: 'เรทที่ 1', rate: t.rate1 });
  if (t.rate2) options.push({ label: 'เรทที่ 2', rate: t.rate2 });
```

`sales-bot.module.ts`:
- เพิ่ม `import { PricingTemplatesModule } from '../pricing-templates/pricing-templates.module';` ต่อจาก import `CustomerJourneyModule`
- `imports:` เพิ่ม `PricingTemplatesModule,` ต่อจาก `CustomerJourneyModule,` (พร้อมคอมเมนต์ `// GetInstallmentRatesTool: PricingQuoteService (ใบเสนอราคาตามรุ่นจากตัวคำนวณกลาง)`)

`apps/api/src/cli/bot-eval.cli.ts` ใน `runRates` ออบเจ็กต์ที่ map แต่ละแถว เพิ่มต่อจาก `rate2: opt(r.rate2),`:

```ts
      allowedTerms: [10, 12],
```

- [ ] **Step 4: รันให้ผ่าน**

Run: `NODE_OPTIONS=--max-old-space-size=12288 npm --prefix apps/api test -- src/modules/sales-bot src/utils/price-grounding`
Expected: PASS ทั้งหมด (`sales-bot.service.spec.ts` ใช้ผลจำลองรูปเดิม `rate1`/`rate2` ยังผ่าน)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/sales-bot/tools/get-installment-rates.tool.ts apps/api/src/modules/sales-bot/tools/get-installment-rates.tool.spec.ts apps/api/src/modules/sales-bot/tools/recommend-devices.tool.ts apps/api/src/modules/sales-bot/tools/recommend-devices.tool.spec.ts apps/api/src/modules/sales-bot/sales-bot.module.ts apps/api/src/cli/bot-eval.cli.ts
git commit -m "feat(sales-bot): quote installment rates from the shared model-quote calculator" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: บอท `calculate_installment` — งวดที่ไม่มีอัตราบอกงวดที่เลือกได้ + ค่างวดปัดขึ้นเป็นบาท

**Files:**
- Modify: `apps/api/src/modules/sales-bot/tools/calculate-installment.tool.ts:1-26` (import + คำอธิบาย), `:67-71` (งวดนอกตาราง), `:98` (`monthlyThb`)
- Modify: `apps/api/src/modules/sales-bot/tools/calculate-installment.tool.spec.ts:128-141`, `:188-193`, `:287`

**Interfaces:**
- Consumes: `displayInstallment` (Task 1)
- Produces: งวดนอกตาราง → `{ error: 'rate_not_configured', allowedMonths: number[], message: string }` · ผลปกติ `monthlyThb` = `displayInstallment(monthlyPayment)` (คีย์อื่นคงเดิม) · ไม่มีตั้งค่าดอกเบี้ยของหมวด → `{ error: 'rate_not_configured' }` เดิม

- [ ] **Step 1: แก้เทสต์ (ยังไม่ผ่าน)**

ใน `calculate-installment.tool.spec.ts`:
- เพิ่ม `import { displayInstallment } from '@installment/shared';` ต่อจาก import บรรทัด 1
- เทสต์ `ค่างวดตรงกับสูตร calcBcInstallment …` แทนบรรทัด `expect(r.monthlyThb).toBeCloseTo(5261.66, 2);` ด้วย

```ts
    // ค่างวดในสัญญา 5,261.66 · ที่บอทบอกลูกค้าปัดขึ้นเป็นบาท (คำตัดสินเจ้าของ 2026-11-19)
    expect(r.monthlyThb).toBe(5262);
```

- เทสต์ `จำนวนงวดนอกตาราง → rate_not_configured …` แทนทั้งบล็อกด้วย

```ts
  it('จำนวนงวดนอกตาราง → rate_not_configured พร้อมงวดที่เลือกได้ (ไม่ throw)', async () => {
    const tool = new CalculateInstallmentTool(makePrisma(productRow(), cfgRow()));
    expect(await tool.run({ productId: 'prd-1', tenureMonths: 36 })).toEqual({
      error: 'rate_not_configured',
      allowedMonths: [6, 7, 8, 9, 10, 11, 12],
      message: 'ผ่อน 36 งวดไม่ได้ — เลือกได้ 6, 7, 8, 9, 10, 11, 12 งวด',
    });
  });

  it('ตั้งค่าดอกเบี้ยมีแถวรายงวด 10/12 → บอกเฉพาะ 10, 12', async () => {
    const tool = new CalculateInstallmentTool(
      makePrisma(
        productRow(),
        cfgRow({ rates: [{ months: 10, ratePct: D('0.5') }, { months: 12, ratePct: D('0.5') }] }),
      ),
    );
    expect(await tool.run({ productId: 'prd-1', tenureMonths: 6 })).toMatchObject({
      error: 'rate_not_configured',
      allowedMonths: [10, 12],
    });
  });
```

- เทสต์ parity บรรทัด ~287 แทน `expect(fromBot.monthlyThb).toBe(fromWeb.monthlyPayment);` ด้วย

```ts
    expect(fromBot.monthlyThb).toBe(displayInstallment(fromWeb.monthlyPayment!));
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**

Run: `NODE_OPTIONS=--max-old-space-size=12288 npm --prefix apps/api test -- src/modules/sales-bot/tools/calculate-installment.tool.spec.ts`
Expected: FAIL — `expected 5261.66 to be 5262` · ผลงวดนอกตารางไม่มี `allowedMonths`

- [ ] **Step 3: แก้โค้ด**

`calculate-installment.tool.ts`:
- เพิ่ม `import { displayInstallment } from '@installment/shared';` ต่อจาก `import Decimal from 'decimal.js';`
- ในคำอธิบาย แทน `'error=rate_not_configured แปลว่าจำนวนงวดนี้ไม่มีในตาราง ให้เสนอจำนวนงวดอื่นหรือส่งต่อพนักงาน. ' +` ด้วย

```ts
    'error=rate_not_configured + allowedMonths แปลว่าจำนวนงวดนี้ทำไม่ได้ ให้บอกลูกค้าว่าเลือกได้เฉพาะงวดใน allowedMonths ' +
    '(ไม่มี allowedMonths = ยังไม่ได้ตั้งอัตรา ให้ส่งต่อพนักงาน). monthlyThb ปัดขึ้นเป็นบาทแล้ว พูดตามได้เลย. ' +
```

- แทนบล็อก `if (!config.allowedMonths.includes(input.tenureMonths)) { return { error: 'rate_not_configured' }; }` ด้วย

```ts
    if (!config.allowedMonths.includes(input.tenureMonths)) {
      return {
        error: 'rate_not_configured',
        allowedMonths: config.allowedMonths,
        message: `ผ่อน ${input.tenureMonths} งวดไม่ได้ — เลือกได้ ${config.allowedMonths.join(', ')} งวด`,
      };
    }
```

- แทน `monthlyThb: result.monthlyPayment.toNumber(),` ด้วย

```ts
      // ค่างวดที่บอกลูกค้าปัดขึ้นเป็นบาท — สัญญาจริงยังเก็บสตางค์ (สเปคข้อ 4.1)
      monthlyThb: displayInstallment(result.monthlyPayment),
```

- [ ] **Step 4: รันให้ผ่าน**

Run: `NODE_OPTIONS=--max-old-space-size=12288 npm --prefix apps/api test -- src/modules/sales-bot`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/sales-bot/tools/calculate-installment.tool.ts apps/api/src/modules/sales-bot/tools/calculate-installment.tool.spec.ts
git commit -m "feat(sales-bot): offer allowed terms when a term has no rate; quote monthly rounded up to baht" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: ตรวจรวมช่วง 2ก

**Files:** ไม่มีไฟล์ใหม่

- [ ] **Step 1: รันชุดทดสอบที่เกี่ยวข้อง + ตรวจชนิด**

Run:
```bash
npm --prefix packages/shared test
NODE_OPTIONS=--max-old-space-size=12288 npm --prefix apps/api test -- src/modules/pricing-templates src/modules/sales-bot src/utils src/modules/purchase-orders src/modules/trade-in src/modules/products src/modules/shop-catalog src/modules/gfin-config src/modules/employee-access src/cli
NODE_OPTIONS=--max-old-space-size=12288 ./tools/check-types.sh all
```
Expected: PASS ทั้งหมด · TypeScript 0 errors ทั้ง api และ web

- [ ] **Step 2: ตรวจทะเบียนสิทธิ์**

Linux/macOS/CI: `node tools/check-access-coverage.mjs` → Expected: ไม่มี error
Windows (git bash):
```bash
node -e "import('node:path').then(p=>{const r=p.default.relative;p.default.relative=(a,b)=>r(a,b).split(p.default.sep).join('/');return import('./tools/check-access-coverage.mjs')})" 2>&1 | grep -E "PricingTemplatesController|Unclassified|Stale"
```
Expected: ไม่มีผลลัพธ์

- [ ] **Step 3: ตรวจบนเครื่อง (local)**

เปิด API (`NODE_OPTIONS=--max-old-space-size=8192 npm run dev`) แล้วด้วยบัญชี `admin@bestchoice.com`:

1. ตั้งค่าดอกเบี้ยมือ 1: แถวรายงวด 10 และ 12 งวด = 50% · ดาวน์ขั้นต่ำ 15% · ค่าคอม 10%
2. สร้างราคากลาง Apple iPhone 15 128GB มือ 1 ไม่ระบุที่มา: 25,900 / 25,900 / 25,900 งวดเรท 1 = 12 · ใบราคา GFIN iPhone 15 128GB มือ 1 = 24,900 · OVER 1,000 งวดสูงสุด 12 · เรท GFIN 12 งวด 0.17
3. `GET /api/pricing-templates/quotes?category=PHONE_NEW&origin=THAI&q=iPhone 15` → แถวเดียว: เงินสด 25,900 · เรท 1 3,900 / 3,139 / 12 · เรท 2 6,500 / 3,403 / 12 · ไม่มีคำว่า profit / submit ใน JSON
4. `origin=IMPORTED` → เรท 2 6,400 / 3,339
5. ห้องแชททดสอบของบอท ถาม "iPhone 15 128GB มือ 1 ผ่อนเท่าไหร่" → บอทตอบ 3,900 · 3,139 × 12 และ 6,500 · 3,403 × 12 · ถาม "ผ่อน 6 เดือนได้ไหม" (กับเครื่องในสต๊อก) → บอทบอกเลือกได้ 10 หรือ 12 งวด

บันทึกผลทั้ง 5 ข้อในข้อความ PR

---

## สิ่งที่แผนนี้ไม่ทำ (อยู่ช่วง 2ข)

- นำเข้าราคากลาง (งวด/ดาวน์ · ชุดละ 100 · หน้าตรวจ · ปิดแถวเดิม) · ป้ายคอลัมน์หน้าตั้งราคา · นำเข้าใบราคา GFIN · iPhone 18 Pro / Pro Max ในรายชื่อรุ่น · งวดของเว็บ shop · ไฟล์นำเข้าจากชีต
- **ช่วง 2ก และ 2ข ต้องขึ้นระบบพร้อมกันและพร้อมการนำเข้าราคา (สเปคข้อ 9.3)** — ถ้าราคากลางบนระบบจริงยังกรอกช่องราคาผ่อนเป็นค่างวด บอทจะคิดค่างวดจากเลขนั้นเป็นราคาเต็ม ต้องนำเข้าทับทันทีหลังขึ้นโค้ด
