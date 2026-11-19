# ช่วง 1ก — ดาวน์เรท 1 ปัดขึ้นหลักร้อย + ดอกเบี้ยสัญญาตรงกับหน้าราคา Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ดาวน์ของผ่อน BESTCHOICE ที่คิดจาก % ปัดขึ้นหลักร้อยเหมือนกันทุกหน้าจอ และสัญญาคิดดอกเบี้ยจากตารางเดียวกับที่หน้าราคา/การ์ดคำนวณ/บอทใช้

**Architecture:** ตัวช่วยปัดอยู่ที่ `packages/shared` ที่เดียว แล้ว `calcBcInstallment` เรียกใช้ ผู้เรียกที่ส่ง % จึงได้ผลใหม่โดยไม่ต้องแก้ ส่วนจุดที่คิด `ราคา × %` เองนอกตัวคำนวณ (3 จุด) เปลี่ยนมาเรียกตัวช่วยเดียวกัน `getRateForMonths` เลิกอ่าน env แล้วใช้กติกาเดียวกับ `toBcConfig` (มีแถวรายงวด = ใช้แถว · ไม่มีเลย = ดอกเบี้ยต่อเดือน × งวด)

**Tech Stack:** TypeScript · decimal.js · vitest (`packages/shared`, `apps/web`) · jest (`apps/api`) · NestJS + Prisma · React

สเปค: `docs/superpowers/specs/2026-11-19-price-master-retire-design.md` ข้อ 4.1, 4.2 · ช่วง 1 ของข้อ 11 แบ่งเป็น 1ก (แผนนี้ — เรท 1 และสัญญา) กับ 1ข (เรท 2 / GFIN — แผนถัดไป)

## Global Constraints

- ทำบน branch ใหม่จาก `main` ชื่อ `feat/price-master-1a` (worktree แยก) — **ห้าม stage ไฟล์ใต้ `apps/web/src/pages/ProductCreatePage/`** (มีงานอื่นค้างอยู่ใน working tree ของ main)
- ดาวน์ปัดขึ้นหลักร้อย **เฉพาะค่าที่คิดจาก %** (ขั้นต่ำ และ `downPct` ที่ส่งมา) · ดาวน์ที่ส่งเป็นจำนวนเงิน (`customDownAmount`, ช่องพิมพ์ดาวน์ในหน้าสัญญา) ไม่ถูกปัด
- **ห้ามแตะสูตรค่างวด** — `monthlyPayment` ของ `calcBcInstallment` และ `calculateInstallmentWithInterest` คงเดิมทุกบรรทัด (กติกาปัดผูกกับตัวเลขของผู้สอบบัญชี — `.claude/rules/accounting.md` หัวข้อ "Rounding Modes")
- การตรวจดาวน์ขั้นต่ำของสัญญา (`contract-quote.service.ts:80`) ยังเทียบเป็น % ตามเดิม ไม่แก้
- เงินใช้ `Decimal` เท่านั้น · ข้อความ error เป็นภาษาไทย
- `apps/api` อ่าน `@installment/shared` จาก `dist` (สร้างโดย `pretest`) ⇒ รันเทสต์ API ด้วย `npm --prefix apps/api test -- <path>` เสมอ ห้ามเรียก `npx jest` ตรง ๆ · `apps/web` อ่านจาก `src` ตรง
- commit message ลงท้ายด้วย `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

## ตัวเลขอ้างอิงสำหรับแก้ค่าคาดหวังในเทสต์เดิม

เทสต์เดิมหลายไฟล์ปักตัวอย่างมาตรฐาน: ราคาผ่อน 19,900 · ดาวน์ขั้นต่ำ 15% · ค่าคอม 10% · VAT 7% · ดอกเบี้ย 5–6 งวด 40% / 7–12 งวด 50%
หลังงานนี้ดาวน์ตั้งต้นเปลี่ยนจาก 2,985 เป็น 3,000 ค่าที่ตามมาเปลี่ยนตามตารางนี้ (คิดด้วยสูตร `calcBcInstallment` เดิม):

| ค่า | เดิม (ดาวน์ 2,985) | ใหม่ (ดาวน์ 3,000) |
|---|---|---|
| ยอดจัด | 16,915.00 | 16,900.00 |
| ค่าคอม | 1,691.50 | 1,690.00 |
| ดอกเบี้ย 50% | 8,457.50 | 8,450.00 |
| รวมก่อน VAT (50%) | 27,064.00 | 27,040.00 |
| VAT (50%) | 1,894.48 | 1,892.80 |
| รวม VAT (50%) | 28,958.48 | 28,932.80 |
| ร้านได้รับจาก FINANCE | 18,606.50 | 18,590.00 |
| ค่างวด 12 งวด | 2,413.20 | 2,411.06 |
| ค่างวด 10 งวด | 2,895.85 | 2,893.28 |
| ค่างวด 8 งวด | 3,619.81 | 3,616.60 |
| ค่างวด 7 งวด | 4,136.92 | 4,133.25 |
| ดอกเบี้ย 40% | 6,766.00 | 6,760.00 |
| ค่างวด 6 งวด | 4,524.76 | 4,520.75 |
| ค่างวด 5 งวด | 5,429.72 | 5,424.90 |
| ค่างวด 12 งวด ปัดขึ้นเป็นบาท (เว็บ shop) | 2,414 | 2,412 |

**กติกาแก้เทสต์เดิม:** แก้ได้เฉพาะ assertion ที่ค่าเดิมมาจากดาวน์ที่คิดจาก % (อยู่ในคอลัมน์ "เดิม" ของตารางนี้ หรือระบุไว้ในแต่ละ Task)
assertion ที่ส่งดาวน์เป็นจำนวนเงิน (เช่น `down: '2985'` ใน `installment-calc.parity.spec.ts`, `installment.util.spec.ts`,
`products.service.spec.ts`, `prepare-offer.service.spec.ts`) **ต้องไม่ล้มและห้ามแก้** — ถ้าล้ม แปลว่าโค้ดปัดดาวน์ที่เป็นจำนวนเงินไปด้วย ซึ่งผิด

---

### Task 1: ตัวช่วยปัดใน `packages/shared`

**Files:**
- Create: `packages/shared/src/installment-rounding.ts`
- Create: `packages/shared/src/installment-rounding.test.ts`
- Modify: `packages/shared/src/index.ts` (ต่อท้ายบรรทัด `export * from './default-bc-installment';`)

**Interfaces:**
- Consumes: ไม่มี
- Produces:
  - `DOWN_PAYMENT_STEP: 100`
  - `roundUpToStep(amount: Decimal, step?: number): Decimal`
  - `downFromPct(price: Decimal, pct: Decimal): Decimal`
  - `minDownAmountFromPct(price: number, pct: number): number`

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน**

`packages/shared/src/installment-rounding.test.ts`:

```ts
import Decimal from 'decimal.js';
import { describe, it, expect } from 'vitest';
import {
  DOWN_PAYMENT_STEP,
  downFromPct,
  minDownAmountFromPct,
  roundUpToStep,
} from './installment-rounding';

describe('roundUpToStep', () => {
  it('ปัดขึ้นเป็นหลักร้อย', () => {
    expect(DOWN_PAYMENT_STEP).toBe(100);
    expect(roundUpToStep(new Decimal('3885')).toFixed(2)).toBe('3900.00');
    expect(roundUpToStep(new Decimal('0.01')).toFixed(2)).toBe('100.00');
  });

  it('ค่าที่ลงหลักร้อยพอดีและศูนย์ไม่เปลี่ยน', () => {
    expect(roundUpToStep(new Decimal('3900')).toFixed(2)).toBe('3900.00');
    expect(roundUpToStep(new Decimal('0')).toFixed(2)).toBe('0.00');
  });
});

describe('downFromPct', () => {
  it('ตัวเลขจากชีต MASTER: 25,900 × 15% = 3,885 → 3,900', () => {
    expect(downFromPct(new Decimal('25900'), new Decimal('0.15')).toFixed(2)).toBe('3900.00');
  });

  it('ตัวอย่างมาตรฐานของเทสต์เดิม: 19,900 × 15% = 2,985 → 3,000', () => {
    expect(downFromPct(new Decimal('19900'), new Decimal('0.15')).toFixed(2)).toBe('3000.00');
  });

  it('ลงหลักร้อยพอดีไม่เปลี่ยน: 10,000 × 20% = 2,000', () => {
    expect(downFromPct(new Decimal('10000'), new Decimal('0.20')).toFixed(2)).toBe('2000.00');
  });

  it('ราคาต่ำจนปัดแล้วไม่น้อยกว่าราคา → ใช้ค่าก่อนปัด (90 × 30% = 27)', () => {
    expect(downFromPct(new Decimal('90'), new Decimal('0.30')).toFixed(2)).toBe('27.00');
  });

  it('ราคาต่ำแต่ปัดแล้วยังน้อยกว่าราคา → ปัด (290 × 30% = 87 → 100)', () => {
    expect(downFromPct(new Decimal('290'), new Decimal('0.30')).toFixed(2)).toBe('100.00');
  });

  it('% เป็นศูนย์ → 0', () => {
    expect(downFromPct(new Decimal('19900'), new Decimal('0')).toFixed(2)).toBe('0.00');
  });
});

describe('minDownAmountFromPct', () => {
  it('รับ/คืนเป็น number สำหรับหน้าเว็บ', () => {
    expect(minDownAmountFromPct(19900, 0.15)).toBe(3000);
    expect(minDownAmountFromPct(25900, 0.15)).toBe(3900);
  });
});
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**

Run: `cd packages/shared && npx vitest run src/installment-rounding.test.ts`
Expected: FAIL — `Failed to resolve import "./installment-rounding"`

- [ ] **Step 3: เขียนโค้ด**

`packages/shared/src/installment-rounding.ts`:

```ts
import Decimal from 'decimal.js';

/** ดาวน์ที่คิดจาก % ปัดขึ้นเป็นหลักนี้ (คำตัดสินเจ้าของ 2026-11-19 — ตามชีต MASTER ช่อง "ปัดเงินดาวน์ขึ้นเป็นหลัก") */
export const DOWN_PAYMENT_STEP = 100;

export function roundUpToStep(amount: Decimal, step: number = DOWN_PAYMENT_STEP): Decimal {
  return amount.div(step).ceil().mul(step);
}

/**
 * ดาวน์จาก % ของราคา — ปัดขึ้นหลักร้อย
 * ราคาต่ำมากจนค่าที่ปัดแล้วไม่น้อยกว่าราคา (เช่น อุปกรณ์เสริม 90 บาท) ใช้ค่าก่อนปัด
 * เพื่อไม่ให้ดาวน์ ≥ ราคาขายเพราะการปัดอย่างเดียว
 */
export function downFromPct(price: Decimal, pct: Decimal): Decimal {
  const raw = price.mul(pct).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const rounded = roundUpToStep(raw);
  return rounded.lt(price) ? rounded : raw;
}

/** รูปแบบ number ของ `downFromPct` สำหรับหน้าเว็บที่เก็บราคาเป็น number */
export function minDownAmountFromPct(price: number, pct: number): number {
  return downFromPct(new Decimal(price), new Decimal(pct)).toNumber();
}
```

`packages/shared/src/index.ts` — เพิ่มบรรทัดต่อจาก `export * from './default-bc-installment';`:

```ts
export * from './installment-rounding';
```

- [ ] **Step 4: รันให้ผ่าน**

Run: `cd packages/shared && npx vitest run src/installment-rounding.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/installment-rounding.ts packages/shared/src/installment-rounding.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): add down-payment rounding helpers" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `calcBcInstallment` และ `computeDefaultBcInstallment` ใช้ตัวช่วย

**Files:**
- Modify: `packages/shared/src/installment-calc.ts` (ฟังก์ชัน `calcBcInstallment` — บล็อก `const downAmount =`)
- Modify: `packages/shared/src/default-bc-installment.ts:33`
- Modify: `packages/shared/src/installment-calc.bc.test.ts`

**Interfaces:**
- Consumes: `downFromPct`, `minDownAmountFromPct` จาก Task 1
- Produces: `calcBcInstallment` คืน `downAmount` ที่ปัดขึ้นหลักร้อยเมื่อไม่ได้ส่ง `customDownAmount` · signature เดิมทุกตัว

- [ ] **Step 1: แก้เทสต์ให้คาดหวังค่าใหม่ (ยังไม่ผ่าน)**

ใน `packages/shared/src/installment-calc.bc.test.ts` แก้ค่าคาดหวังของ `describe('calcBcInstallment — canonical worked example …')`:

| `it(...)` | เดิม | ใหม่ |
|---|---|---|
| `downAmount = 2,985` | `'2985.00'` | `'3000.00'` (เปลี่ยนชื่อเทสต์เป็น `downAmount = 3,000 (2,985 ปัดขึ้นหลักร้อย)`) |
| `financedAmount = 16,915` | `'16915.00'` | `'16900.00'` |
| `interestAmount = 8,457.50` | `'8457.50'` | `'8450.00'` |
| `commissionAmount = 1,691.50` | `'1691.50'` | `'1690.00'` |
| `subtotal = 27,064.00` | `'27064.00'` | `'27040.00'` |
| `vatAmount = 1,894.48` | `'1894.48'` | `'1892.80'` |
| `totalWithVat = 28,958.48` | `'28958.48'` | `'28932.80'` |
| `monthlyPayment = 2,413.20` | `'2413.20'` | `'2411.06'` |
| `financeToShop = 18,606.50` | `'18606.50'` | `'18590.00'` |

แก้ชื่อเทสต์ให้ตรงตัวเลขใหม่ทุกข้อ และใน `describe('calcBcInstallment — edge cases')`:

- `accepts custom down higher than min (50% down at 12 mo)`: `downAmount` `'9950.00'` → `'10000.00'` · `financedAmount` `'9950.00'` → `'9900.00'`
- `handles 5-mo with 40% rate`: `interestAmount` `'6766.00'` → `'6760.00'` และแก้คอมเมนต์เป็น `// financed = 16900, interest = 16900 × 0.40 = 6760`

เพิ่มเทสต์ใหม่ท้าย `describe('calcBcInstallment — edge cases')`:

```ts
  it('ดาวน์ที่ส่งเป็นจำนวนเงินไม่ถูกปัด (2,985 คง 2,985)', () => {
    const out = calcBcInstallment({
      installmentPrice: new Decimal('19900'),
      months: 12,
      customDownAmount: new Decimal('2985'),
      config: DEFAULT_CONFIG,
    });
    expect(out.downAmount.toFixed(2)).toBe('2985.00');
    expect(out.monthlyPayment.toFixed(2)).toBe('2413.20');
  });

  it('ดาวน์ขั้นต่ำที่ปัดแล้วยังผ่านการตรวจ % ขั้นต่ำ', () => {
    const out = calcBcInstallment({
      installmentPrice: new Decimal('25900'),
      months: 12,
      config: DEFAULT_CONFIG,
    });
    expect(out.isValid).toBe(true);
    expect(out.downAmount.toFixed(2)).toBe('3900.00');
    expect(out.financedAmount.toFixed(2)).toBe('22000.00');
    expect(out.monthlyPayment.toFixed(2)).toBe('3138.66');
  });

  it('ราคาต่ำมาก: ดาวน์ไม่ถูกปัดจนเท่าหรือเกินราคา', () => {
    const out = calcBcInstallment({
      installmentPrice: new Decimal('90'),
      months: 12,
      downPct: new Decimal('0.30'),
      config: DEFAULT_CONFIG,
    });
    expect(out.downAmount.toFixed(2)).toBe('27.00');
    expect(out.errors.some((e) => e.includes('ต้องน้อยกว่าราคาขาย'))).toBe(false);
  });
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**

Run: `cd packages/shared && npx vitest run src/installment-calc.bc.test.ts`
Expected: FAIL — เช่น `expected '2985.00' to be '3000.00'`

- [ ] **Step 3: แก้โค้ด**

`packages/shared/src/installment-calc.ts` — เพิ่ม import ใต้ import เดิม:

```ts
import { downFromPct } from './installment-rounding';
```

ใน `calcBcInstallment` แทนบล็อก

```ts
  const downAmount =
    customDownAmount !== undefined
      ? round2(customDownAmount)
      : round2(installmentPrice.mul(resolvedDownPct));
```

ด้วย

```ts
  // ดาวน์ที่คิดจาก % ปัดขึ้นหลักร้อย (คำตัดสินเจ้าของ 2026-11-19) · ดาวน์ที่ส่งเป็นจำนวนเงินไม่ถูกปัด
  const downAmount =
    customDownAmount !== undefined
      ? round2(customDownAmount)
      : downFromPct(installmentPrice, resolvedDownPct);
```

`packages/shared/src/default-bc-installment.ts` — เพิ่ม import:

```ts
import { minDownAmountFromPct } from './installment-rounding';
```

แทนบรรทัด `const downAmount = Math.round(installmentPrice * config.minDownPct);` ด้วย

```ts
  const downAmount = minDownAmountFromPct(installmentPrice, config.minDownPct);
```

- [ ] **Step 4: รันทั้งแพ็กเกจให้ผ่าน**

Run: `cd packages/shared && npx vitest run`
Expected: PASS ทุกไฟล์ — `installment-calc.gfin.test.ts` ต้องผ่านโดยไม่แก้ (งานนี้ไม่แตะเรท 2)

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/installment-calc.ts packages/shared/src/default-bc-installment.ts packages/shared/src/installment-calc.bc.test.ts
git commit -m "feat(shared): round percentage-derived BC down payment up to 100" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: เทสต์ฝั่ง API ที่ปักดาวน์จาก %

งานนี้ไม่แก้โค้ด API — ผู้เรียก `calcBcInstallment` ฝั่ง API (`product-quote.service.ts:131`, `shop-catalog.service.ts:619`,
`calculate-installment.tool.ts:73`, `installment-preview.service.ts:75`) ได้ผลใหม่จาก Task 2 เอง · Task นี้แก้ค่าคาดหวังของเทสต์

**Files:**
- Modify: `apps/api/src/modules/sales-bot/tools/calculate-installment.tool.spec.ts:131-153`
- Modify: `apps/api/src/modules/shop-catalog/installment-preview.service.spec.ts:77-103`
- Modify: `apps/api/src/modules/shop-catalog/shop-catalog.installment-parity.spec.ts:115` และ assertion ที่ตามมา

**Interfaces:**
- Consumes: พฤติกรรมใหม่ของ `calcBcInstallment` จาก Task 2
- Produces: ไม่มี

- [ ] **Step 1: รันเทสต์ที่เกี่ยวข้องให้เห็นรายการที่ล้ม**

Run:
```bash
npm --prefix apps/api test -- src/modules/sales-bot/tools/calculate-installment.tool.spec.ts src/modules/shop-catalog src/modules/staff-chat/services/product-quote.service.spec.ts src/utils/installment-calc.util.spec.ts src/utils/installment-calc.parity.spec.ts src/utils/installment.util.spec.ts
```
Expected: FAIL เฉพาะใน 3 ไฟล์ของ Task นี้ · `installment-calc.util.spec.ts`, `installment-calc.parity.spec.ts`, `installment.util.spec.ts` ต้องผ่าน (ใช้ดาวน์ที่ลงหลักร้อยพอดีหรือส่งเป็นจำนวนเงิน)
ถ้า `product-quote.service.spec.ts` ล้ม: แก้ได้เฉพาะ assertion ที่ค่าเดิมอยู่ในตาราง "ตัวเลขอ้างอิง" ด้านบน

- [ ] **Step 2: แก้ `calculate-installment.tool.spec.ts`**

เทสต์ `ค่างวดตรงกับสูตร calcBcInstallment (commission/VAT = 0, rate สังเคราะห์ 0.10 × 12)` (ราคา 35,900 · ดาวน์ 20%) แทนคอมเมนต์และ assertion 5 บรรทัดด้วย:

```ts
    // down = 35900 × 0.20 = 7180 → ปัดขึ้นหลักร้อย 7200; financed = 28700; rate12 = 1.2; interest = 34440
    // subtotal = 63140; monthly = 63140 / 12 = 5261.66 (ปัดลง 2 ตำแหน่ง); total = 7200 + 63140 = 70340
    expect(r.downAmountThb).toBe(7200);
    expect(r.financedThb).toBe(28700);
    expect(r.ratePct).toBe(120);
    expect(r.monthlyThb).toBeCloseTo(5261.66, 2);
    expect(r.totalPaidThb).toBeCloseTo(70340, 2);
```

เทสต์ `ไม่ส่ง downPct → ใช้ minDownPaymentPct ของ InterestConfig (เลิก hardcode 20%)` แทนบรรทัด `expect(r.downAmountThb).toBe(10770); // 35900 × 0.30` ด้วย:

```ts
    expect(r.downAmountThb).toBe(10800); // 35900 × 0.30 = 10770 → ปัดขึ้นหลักร้อย
```

- [ ] **Step 3: แก้ `installment-preview.service.spec.ts`**

เทสต์ `BC: returns canonical worked example monthly payment 2,413.21` — เปลี่ยนชื่อเป็น `BC: returns canonical worked example monthly payment 2,411.06` และแทน 2 บรรทัด:

```ts
    expect(result.monthlyPayment).toBeCloseTo(2411.06, 2);
    expect(result.downAmount).toBeCloseTo(3000, 2);
```

- [ ] **Step 4: แก้ `shop-catalog.installment-parity.spec.ts`**

แทน 2 บรรทัด (บรรทัด 115–116)

```ts
    // golden: 19,900 / 12 งวด / ดาวน์ 15% → 2,413.21 → ปัดขึ้นเป็น 2,414
    expect(list.data[0].monthlyPaymentFrom).toBe(2414);
```

ด้วย

```ts
    // golden: 19,900 / 12 งวด / ดาวน์ 15% (2,985 → ปัดขึ้น 3,000) → 2,411.06 → ปัดขึ้นเป็น 2,412
    expect(list.data[0].monthlyPaymentFrom).toBe(2412);
```

- [ ] **Step 5: รันให้ผ่าน**

Run: คำสั่งเดียวกับ Step 1
Expected: PASS ทุกไฟล์

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/sales-bot/tools/calculate-installment.tool.spec.ts apps/api/src/modules/shop-catalog/installment-preview.service.spec.ts apps/api/src/modules/shop-catalog/shop-catalog.installment-parity.spec.ts
git commit -m "test(api): re-pin BC down payment goldens to rounded-up-to-100" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: หน้าเว็บ — ดาวน์ขั้นต่ำใช้ตัวช่วยเดียวกัน

**Files:**
- Modify: `apps/web/src/pages/ProductDetailPage/utils/bcQuote.ts:25-27`
- Modify: `apps/web/src/pages/ContractCreatePage/hooks/useContractCalculation.ts:76`
- Modify: `apps/web/src/pages/ContractCreatePage/hooks/useContractCalculation.test.ts`
- Modify (ค่าคาดหวัง): `apps/web/src/pages/ProductDetailPage/utils/bcQuote.test.ts` · `utils/resolveQuotes.test.ts:69` ·
  `utils/buildCustomerSummary.test.ts` · `hooks/__tests__/useCustomerSummary.test.ts:86` ·
  `components/__tests__/InstallmentCalculatorCard.test.tsx:116-120,214`

**Interfaces:**
- Consumes: `minDownAmountFromPct(price: number, pct: number): number` จาก Task 1
- Produces: `bcMinDownAmount(json: BcConfigJson, installmentPrice: number): number` signature เดิม ค่าใหม่ (ปัดขึ้นหลักร้อย)

- [ ] **Step 1: เพิ่มเทสต์ของหน้าสัญญา (ยังไม่ผ่าน)**

ต่อท้ายไฟล์ `apps/web/src/pages/ContractCreatePage/hooks/useContractCalculation.test.ts`:

```ts
describe('ดาวน์ตั้งต้นปัดขึ้นหลักร้อย (คำตัดสินเจ้าของ 2026-11-19)', () => {
  it('25,900 × 15% = 3,885 → ตั้งต้น 3,900', () => {
    const { result } = setupHook({
      product: makeProduct(25900),
      config: makeConfig({ minDownPaymentPct: '0.15' }),
    });
    expect(result.current.downPayment).toBe(3900);
  });

  it('มีเครดิตเทิร์น: หักจากดาวน์ที่ปัดแล้ว (3,900 − 1,000 = 2,900)', () => {
    const { result } = setupHook({
      product: makeProduct(25900),
      config: makeConfig({ minDownPaymentPct: '0.15' }),
      tradeInBaseAmount: 1000,
    });
    expect(result.current.downPayment).toBe(2900);
  });
});
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**

Run: `cd apps/web && npx vitest run src/pages/ContractCreatePage/hooks/useContractCalculation.test.ts`
Expected: FAIL — `expected 3885 to be 3900`

- [ ] **Step 3: แก้โค้ด**

`apps/web/src/pages/ContractCreatePage/hooks/useContractCalculation.ts` — เพิ่ม import:

```ts
import { minDownAmountFromPct } from '@installment/shared';
```

แทนบรรทัด

```ts
      setDownPayment(Decimal.max(0, new Decimal(sellingPrice).mul(minDownPct).ceil().minus(tradeInBaseAmount)).toNumber());
```

ด้วย

```ts
      setDownPayment(
        Decimal.max(0, new Decimal(minDownAmountFromPct(sellingPrice, minDownPct)).minus(tradeInBaseAmount)).toNumber(),
      );
```

`apps/web/src/pages/ProductDetailPage/utils/bcQuote.ts` — แก้ import บรรทัด 2 เป็น:

```ts
import {
  calcBcInstallment,
  minDownAmountFromPct,
  type BcCalcOutput,
  type BcConfig,
  type BcConfigJson,
} from '@installment/shared';
```

แก้คอมเมนต์ของ `minDownAmount` ใน `interface BcQuote` เป็น
`/** ดาวน์ขั้นต่ำ = ราคาผ่อน × minDownPct ปัดขึ้นหลักร้อย (ค่าตั้งต้นของช่องเงินดาวน์) */` และแทนฟังก์ชัน:

```ts
export function bcMinDownAmount(json: BcConfigJson, installmentPrice: number): number {
  return minDownAmountFromPct(installmentPrice, json.minDownPct);
}
```

- [ ] **Step 4: รันเทสต์หน้าเว็บที่เกี่ยวข้อง แล้วแก้ค่าคาดหวังเดิม**

Run:
```bash
cd apps/web && npx vitest run src/pages/ContractCreatePage src/pages/ProductDetailPage src/pages/StickerPrintPage
```

แก้ assertion ที่ล้มตามตาราง "ตัวเลขอ้างอิง" — รายการที่รู้แล้ว:

| ไฟล์ | เดิม | ใหม่ |
|---|---|---|
| `utils/bcQuote.test.ts:16` | `expect(q.minDownAmount).toBe(2985)` | `toBe(3000)` |
| `utils/bcQuote.test.ts:18,20` | `toBeCloseTo(2413.2, 2)` | `toBeCloseTo(2411.06, 2)` |
| `utils/buildCustomerSummary.test.ts:37-41` (เทสต์ `คืน 12 งวด ดาวน์ 2,985 งวดละ 2,413.20`) | `downAmount: 2985` · `monthlyPayment: 2413.20` | `downAmount: 3000` · `monthlyPayment: 2411.06` และเปลี่ยนชื่อเทสต์เป็น `คืน 12 งวด ดาวน์ 3,000 งวดละ 2,411.06` |
| `utils/resolveQuotes.test.ts:69` | `toBe(2985)` | `toBe(3000)` |
| `hooks/__tests__/useCustomerSummary.test.ts:86` | `'เรทที่ 1 ดาวน์ 2,985 บาท ผ่อนเดือนละ 2,413.20 บาท 12 งวด'` | `'เรทที่ 1 ดาวน์ 3,000 บาท ผ่อนเดือนละ 2,411.06 บาท 12 งวด'` |
| `components/__tests__/InstallmentCalculatorCard.test.tsx:119,214` | `/2,413\.20/` | `/2,411\.06/` |
| คอมเมนต์หัวไฟล์ที่เขียน `12 งวด/2,985/2,413.20` | — | `12 งวด/3,000/2,411.06` |

ค่างวดของงวดอื่นในตัวเลือก (dropdown "N งวด · ผ่อนเดือนละ X") แก้ตามแถวของงวดนั้นในตาราง
เทสต์ที่ตั้งดาวน์เองเป็นจำนวนเงิน (เช่น `resolveQuotes.test.ts:84` `downAmount: 5000`) ต้องผ่านโดยไม่แก้ ·
`buildCustomerSummary.test.ts` บรรทัด 78 ลงไป ส่ง `downAmount: 2985` เป็นข้อมูลนำเข้าของตัวจัดข้อความ ไม่ได้มาจากตัวคำนวณ — ห้ามแก้

- [ ] **Step 5: รันให้ผ่าน + ตรวจชนิด**

Run: คำสั่งเดียวกับ Step 4 แล้ว `./tools/check-types.sh web`
Expected: PASS ทั้งหมด · TypeScript 0 errors

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/ContractCreatePage/hooks apps/web/src/pages/ProductDetailPage
git commit -m "feat(web): default BC down payment rounds up to 100 on contract and product pages" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: `getRateForMonths` ใช้กติกาเดียวกับหน้าราคา (เลิกอ่าน env)

**Files:**
- Modify: `apps/api/src/utils/get-rate-for-months.util.ts` (ทั้งไฟล์)
- Modify: `apps/api/src/utils/get-rate-for-months.util.spec.ts` (ทั้งไฟล์)
- Modify: `apps/api/src/modules/contracts/services/contract-quote.service.spec.ts:13,19,43,49,82-91`
- Modify: `apps/api/e2e/credit-payment-flow.e2e-spec.ts:65,90,156`

**Interfaces:**
- Consumes: ไม่มี
- Produces: `getRateForMonths(prisma, configId: string, months: number): Promise<Prisma.Decimal>` signature เดิม ·
  มีแถวรายงวดของ config (ที่ `deletedAt` ว่าง) อย่างน้อย 1 แถว → คืน `ratePct` ของงวดนั้น หรือ throw `BadRequestException`
  ข้อความ `ไม่มีอัตราดอกเบี้ยสำหรับ N งวด — เลือกได้: a, b งวด` · ไม่มีแถวเลย → `interestRate × months`

- [ ] **Step 1: เขียนเทสต์ใหม่ทั้งไฟล์ (ยังไม่ผ่าน)**

`apps/api/src/utils/get-rate-for-months.util.spec.ts`:

```ts
import { Prisma, PrismaClient } from '@prisma/client';
import { getRateForMonths } from './get-rate-for-months.util';

const mockPrisma = {
  interestConfigRate: {
    findMany: jest.fn(),
  },
  interestConfig: {
    findUnique: jest.fn(),
  },
} as unknown as PrismaClient;

const rateRows = (...rows: Array<[number, string]>) =>
  rows.map(([months, ratePct]) => ({ months, ratePct: new Prisma.Decimal(ratePct) }));

describe('getRateForMonths', () => {
  const previousFlag = process.env.USE_NEW_RATE_LOOKUP;
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => {
    if (previousFlag === undefined) delete process.env.USE_NEW_RATE_LOOKUP;
    else process.env.USE_NEW_RATE_LOOKUP = previousFlag;
  });

  it('มีแถวรายงวด → ใช้อัตราของงวดนั้น และอ่านเฉพาะแถวที่ยังไม่ถูกลบ', async () => {
    (mockPrisma.interestConfigRate.findMany as jest.Mock).mockResolvedValue(
      rateRows([10, '0.5'], [12, '0.5']),
    );
    const rate = await getRateForMonths(mockPrisma, 'config-1', 12);
    expect(rate.toString()).toBe('0.5');
    expect(mockPrisma.interestConfigRate.findMany).toHaveBeenCalledWith({
      where: { configId: 'config-1', deletedAt: null },
      select: { months: true, ratePct: true },
      orderBy: { months: 'asc' },
    });
    expect(mockPrisma.interestConfig.findUnique).not.toHaveBeenCalled();
  });

  it('มีแถวรายงวดแต่ไม่มีงวดที่ขอ → ปฏิเสธพร้อมบอกงวดที่เลือกได้', async () => {
    (mockPrisma.interestConfigRate.findMany as jest.Mock).mockResolvedValue(
      rateRows([10, '0.5'], [12, '0.5']),
    );
    await expect(getRateForMonths(mockPrisma, 'config-1', 6)).rejects.toThrow(
      'ไม่มีอัตราดอกเบี้ยสำหรับ 6 งวด — เลือกได้: 10, 12 งวด',
    );
  });

  it('ไม่มีแถวรายงวดเลย → ดอกเบี้ยต่อเดือน × งวด', async () => {
    (mockPrisma.interestConfigRate.findMany as jest.Mock).mockResolvedValue([]);
    (mockPrisma.interestConfig.findUnique as jest.Mock).mockResolvedValue({
      interestRate: new Prisma.Decimal('0.05'),
    });
    const rate = await getRateForMonths(mockPrisma, 'config-1', 10);
    expect(rate.toFixed(4)).toBe('0.5000');
  });

  it('ผลไม่ขึ้นกับ env USE_NEW_RATE_LOOKUP', async () => {
    (mockPrisma.interestConfigRate.findMany as jest.Mock).mockResolvedValue(rateRows([12, '0.5']));
    process.env.USE_NEW_RATE_LOOKUP = 'false';
    expect((await getRateForMonths(mockPrisma, 'config-1', 12)).toString()).toBe('0.5');
    process.env.USE_NEW_RATE_LOOKUP = 'true';
    expect((await getRateForMonths(mockPrisma, 'config-1', 12)).toString()).toBe('0.5');
  });

  it('ไม่มีแถวรายงวดและไม่พบตั้งค่าดอกเบี้ย → ปฏิเสธ', async () => {
    (mockPrisma.interestConfigRate.findMany as jest.Mock).mockResolvedValue([]);
    (mockPrisma.interestConfig.findUnique as jest.Mock).mockResolvedValue(null);
    await expect(getRateForMonths(mockPrisma, 'config-1', 12)).rejects.toThrow(/ไม่พบ InterestConfig/);
  });

  it('ตั้งค่าดอกเบี้ยถูกลบ → ปฏิเสธ', async () => {
    (mockPrisma.interestConfigRate.findMany as jest.Mock).mockResolvedValue([]);
    (mockPrisma.interestConfig.findUnique as jest.Mock).mockResolvedValue({
      interestRate: new Prisma.Decimal('0.05'),
      deletedAt: new Date(),
    });
    await expect(getRateForMonths(mockPrisma, 'config-1', 12)).rejects.toThrow(/ไม่พบ InterestConfig/);
  });
});
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**

Run: `npm --prefix apps/api test -- src/utils/get-rate-for-months.util.spec.ts`
Expected: FAIL — `findUnique is not a function` หรือค่าที่ได้ไม่ตรง

- [ ] **Step 3: เขียนโค้ดใหม่ทั้งไฟล์**

`apps/api/src/utils/get-rate-for-months.util.ts`:

```ts
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * อัตราดอกเบี้ยรวมทั้งสัญญาของ (ตั้งค่าดอกเบี้ย, จำนวนงวด) — ค่าที่ใช้เป็น `ยอดจัด × อัตรา = ดอกเบี้ย`
 *
 * กติกาเดียวกับ `toBcConfig` (`bc-installment-config.util.ts`) ที่หน้าราคา / การ์ดคำนวณ / บอทใช้
 * เพื่อให้ค่างวดในสัญญาเท่ากับค่างวดที่บอกลูกค้า (สเปค 2026-11-19 ข้อ 4.2):
 *  - ตั้งค่าดอกเบี้ยมีแถวรายงวดที่ยังไม่ถูกลบอย่างน้อย 1 แถว → ใช้แถวของงวดนั้น · ไม่มีแถวของงวดนั้น = ปฏิเสธ
 *  - ไม่มีแถวรายงวดเลย → ดอกเบี้ยต่อเดือน (`InterestConfig.interestRate`) × งวด
 *
 * เดิมเลือกทางด้วย env `USE_NEW_RATE_LOOKUP` — เลิกอ่านแล้ว
 */
export async function getRateForMonths(
  prisma: Pick<Prisma.TransactionClient, 'interestConfig' | 'interestConfigRate'>,
  configId: string,
  months: number,
): Promise<Prisma.Decimal> {
  const rows = await prisma.interestConfigRate.findMany({
    where: { configId, deletedAt: null },
    select: { months: true, ratePct: true },
    orderBy: { months: 'asc' },
  });

  if (rows.length > 0) {
    const row = rows.find((r) => r.months === months);
    if (!row) {
      throw new BadRequestException(
        `ไม่มีอัตราดอกเบี้ยสำหรับ ${months} งวด — เลือกได้: ${rows.map((r) => r.months).join(', ')} งวด`,
      );
    }
    return new Prisma.Decimal(row.ratePct);
  }

  const config = await prisma.interestConfig.findUnique({ where: { id: configId } });
  if (!config || config.deletedAt) {
    throw new NotFoundException(`ไม่พบ InterestConfig (configId=${configId})`);
  }
  return new Prisma.Decimal(config.interestRate).mul(months);
}
```

- [ ] **Step 4: รันให้ผ่าน**

Run: `npm --prefix apps/api test -- src/utils/get-rate-for-months.util.spec.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: แก้ `contract-quote.service.spec.ts`**

1. ลบบรรทัด `const previousFlag = process.env.USE_NEW_RATE_LOOKUP;`
2. ใน `makeDb` แทนบรรทัด `interestConfigRate: { findUnique: jest.fn().mockResolvedValue({ ratePct: new D('.12'), deletedAt: null }) },` ด้วย

```ts
    // ไม่มีแถวรายงวด = ดอกเบี้ยต่อเดือน × งวด (ค่าเริ่มต้นของชุดนี้)
    interestConfigRate: { findMany: jest.fn().mockResolvedValue([]) },
```

3. ใน `beforeEach` ลบบรรทัด `process.env.USE_NEW_RATE_LOOKUP = 'false';`
4. ใน `afterEach` ลบบรรทัด `if (previousFlag === undefined) delete process.env.USE_NEW_RATE_LOOKUP; else process.env.USE_NEW_RATE_LOOKUP = previousFlag;`
5. แทนเทสต์ `selects a deterministic oldest config and respects the per-term rate flag` และ `fails closed when the enabled rate table lacks the requested term` ด้วย:

```ts
  it('selects a deterministic oldest config and uses the per-term rate row when the config has any', async () => {
    db.interestConfigRate.findMany.mockResolvedValue([{ months: 6, ratePct: new D('.12') }]);
    const quote = await service.resolve(input, actor);
    expect(quote.interestTotal).toBe('960.00');
    expect(db.interestConfig.findFirst).toHaveBeenCalledWith(expect.objectContaining({ orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }));
    expect(db.interestConfigRate.findMany).toHaveBeenCalledWith({
      where: { configId: 'config-oldest', deletedAt: null },
      select: { months: true, ratePct: true },
      orderBy: { months: 'asc' },
    });
  });
  it('fails closed when the rate table lacks the requested term', async () => {
    db.interestConfigRate.findMany.mockResolvedValue([{ months: 12, ratePct: new D('.12') }]);
    await expect(service.resolve(input, actor)).rejects.toThrow('ไม่มีอัตราดอกเบี้ยสำหรับ 6 งวด — เลือกได้: 12 งวด');
  });
```

- [ ] **Step 6: แก้ `e2e/credit-payment-flow.e2e-spec.ts`**

ไฟล์นี้ไม่สร้างแถวดอกเบี้ยรายงวด (ไม่มีคำว่า `interestConfigRate` ในไฟล์) จึงเดินทาง "ดอกเบี้ยต่อเดือน × งวด" เหมือนเดิมโดยไม่ต้องตั้ง env:

- บรรทัด 65: ลบ `rate: process.env.USE_NEW_RATE_LOOKUP, ` ออกจาก object `originalEnv`
- บรรทัด 90: ลบทั้งบรรทัด `process.env.USE_NEW_RATE_LOOKUP = 'false';`
- บรรทัด 156: ลบทั้งบรรทัด `if (originalEnv.rate === undefined) delete process.env.USE_NEW_RATE_LOOKUP; else process.env.USE_NEW_RATE_LOOKUP = originalEnv.rate;`

- [ ] **Step 7: รันเทสต์สัญญา + ตรวจว่าไม่มีที่อ่าน env เหลือ**

Run:
```bash
npm --prefix apps/api test -- src/modules/contracts src/utils/get-rate-for-months.util.spec.ts src/utils/installment-schedule.util.spec.ts
```
Expected: PASS

เดิมทาง "ดอกเบี้ยต่อเดือน × งวด" ไม่แตะ `interestConfigRate` เลย ตอนนี้อ่าน `findMany` ทุกครั้ง ⇒ เทสต์อื่นที่สร้าง
`ContractQuoteService` ด้วย mock ที่ไม่มี `interestConfigRate.findMany` จะล้มด้วย `Cannot read properties of undefined (reading 'findMany')`
ไฟล์ที่สร้าง service นี้นอกเหนือจากที่แก้แล้ว: `src/utils/installment-schedule.util.spec.ts` ·
`src/modules/contracts/__tests__/product-guard.integration.spec.ts` ·
`src/modules/employee-access/access-contract-promotions.integration.spec.ts` ·
`src/modules/employee-access/access-preparation-actions.integration.spec.ts`
(สามไฟล์หลังใช้ฐานข้อมูลจริง ไม่ต้องแก้) — ถ้าไฟล์ใดใช้ mock และล้มด้วยข้อความข้างบน ให้เพิ่มใน mock ของไฟล์นั้น:

```ts
    interestConfigRate: { findMany: jest.fn().mockResolvedValue([]) },
```

ใช้เครื่องมือ Grep ค้น `USE_NEW_RATE_LOOKUP` ใน `apps/api/src` และ `apps/api/e2e`
Expected: เหลือเฉพาะ `get-rate-for-months.util.ts` (คอมเมนต์) และ `get-rate-for-months.util.spec.ts` (เทสต์ "ผลไม่ขึ้นกับ env")

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/utils/get-rate-for-months.util.ts apps/api/src/utils/get-rate-for-months.util.spec.ts apps/api/src/modules/contracts/services/contract-quote.service.spec.ts apps/api/e2e/credit-payment-flow.e2e-spec.ts
git commit -m "fix(contracts): resolve interest rate with the same rule as price quotes" -m "Contract quotes read per-term rate rows whenever the config has any, instead of gating on USE_NEW_RATE_LOOKUP, so the contract installment equals the installment quoted on price screens and by the sales bot." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: หน้าสร้างสัญญาเลือกได้เฉพาะงวดที่มีอัตรา

**Files:**
- Modify: `apps/api/src/modules/interest-config/interest-config.service.ts:47-63` (`findByCategory`)
- Modify: `apps/api/src/modules/interest-config/interest-config.service.spec.ts`
- Modify: `apps/web/src/pages/ContractCreatePage/types.ts:37-47` (`InterestConfig`)
- Modify: `apps/web/src/pages/ContractCreatePage/hooks/useContractCalculation.ts` (บล็อก `monthOptions` + effect clamp)
- Modify: `apps/web/src/pages/ContractCreatePage/hooks/useContractCalculation.test.ts`

**Interfaces:**
- Consumes: กติกาของ Task 5 (มีแถวรายงวด = รับเฉพาะงวดที่มีแถว)
- Produces: `GET /interest-configs/by-category/:category` คืน field เพิ่ม `allowedMonths: number[]`
  (งวดที่มีแถวรายงวด เรียงน้อยไปมาก · `[]` = ไม่มีแถวรายงวด) · `useContractCalculation` คืน `monthOptions` ตามนั้น

- [ ] **Step 1: เทสต์ API (ยังไม่ผ่าน)**

ใน `apps/api/src/modules/interest-config/interest-config.service.spec.ts` เพิ่ม `interestConfigRate` ใน object `prisma` ของ `beforeEach` (ต่อจาก `companyInfo`):

```ts
      interestConfigRate: {
        findMany: jest.fn().mockResolvedValue([]),
      },
```

และเพิ่ม describe ใหม่ก่อนปิด `describe('InterestConfigService', …)`:

```ts
  describe('findByCategory — allowedMonths', () => {
    const config = { id: 'cfg-1', name: 'มือถือใหม่', vatPct: 0.07, minInstallmentMonths: 6, maxInstallmentMonths: 12 };

    it('คืนงวดที่มีแถวรายงวด เรียงน้อยไปมาก', async () => {
      prisma.interestConfig.findFirst.mockResolvedValue(config);
      prisma.interestConfigRate.findMany.mockResolvedValue([{ months: 10 }, { months: 12 }]);
      const result = await service.findByCategory('PHONE_NEW');
      expect(result).toMatchObject({ id: 'cfg-1', allowedMonths: [10, 12] });
      expect(prisma.interestConfigRate.findMany).toHaveBeenCalledWith({
        where: { configId: 'cfg-1', deletedAt: null },
        select: { months: true },
        orderBy: { months: 'asc' },
      });
    });

    it('ไม่มีแถวรายงวด → allowedMonths ว่าง', async () => {
      prisma.interestConfig.findFirst.mockResolvedValue(config);
      const result = await service.findByCategory('PHONE_NEW');
      expect(result).toMatchObject({ allowedMonths: [] });
    });

    it('ไม่พบตั้งค่าดอกเบี้ยของหมวด → คืนค่าเดิม (null) ไม่อ่านแถวรายงวด', async () => {
      prisma.interestConfig.findFirst.mockResolvedValue(null);
      expect(await service.findByCategory('PHONE_NEW')).toBeNull();
      expect(prisma.interestConfigRate.findMany).not.toHaveBeenCalled();
    });
  });
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**

Run: `npm --prefix apps/api test -- src/modules/interest-config/interest-config.service.spec.ts`
Expected: FAIL — ผลลัพธ์ไม่มี `allowedMonths`

- [ ] **Step 3: แก้ `findByCategory`**

ใน `apps/api/src/modules/interest-config/interest-config.service.ts` แทน 3 บรรทัดท้ายฟังก์ชัน

```ts
    if (!config) return config;
    const [withVat] = await this.withFinanceVat([config]);
    return withVat;
```

ด้วย

```ts
    if (!config) return config;
    const [withVat] = await this.withFinanceVat([config]);
    // งวดที่หน้าสร้างสัญญาให้เลือก — กติกาเดียวกับ getRateForMonths: มีแถวรายงวด = รับเฉพาะงวดที่มีแถว
    const rates = await this.prisma.interestConfigRate.findMany({
      where: { configId: config.id, deletedAt: null },
      select: { months: true },
      orderBy: { months: 'asc' },
    });
    return { ...withVat, allowedMonths: rates.map((r) => r.months) };
```

- [ ] **Step 4: รันให้ผ่าน**

Run: `npm --prefix apps/api test -- src/modules/interest-config`
Expected: PASS ทุกไฟล์ในโฟลเดอร์

- [ ] **Step 5: เทสต์หน้าเว็บ (ยังไม่ผ่าน)**

ต่อท้าย `apps/web/src/pages/ContractCreatePage/hooks/useContractCalculation.test.ts`:

```ts
describe('ตัวเลือกจำนวนงวดตามตารางดอกเบี้ยรายงวด', () => {
  it('มี allowedMonths → เลือกได้เฉพาะงวดนั้นที่อยู่ในช่วงต่ำสุด–สูงสุด', () => {
    const { result } = setupHook({
      product: makeProduct(25900),
      config: makeConfig({ minInstallmentMonths: 6, maxInstallmentMonths: 12, allowedMonths: [5, 10, 12, 15] }),
    });
    expect(result.current.monthOptions).toEqual([10, 12]);
  });

  it('งวดที่เลือกอยู่ไม่มีอัตรา → ย้ายไป 12 ถ้ามี', () => {
    const { result } = setupHook({
      product: makeProduct(25900),
      config: makeConfig({ minInstallmentMonths: 6, maxInstallmentMonths: 12, allowedMonths: [10, 12] }),
      initialMonths: 8,
    });
    expect(result.current.totalMonths).toBe(12);
  });

  it('งวดที่เลือกอยู่ไม่มีอัตรา และไม่มี 12 → ย้ายไปงวดแรกที่มี', () => {
    const { result } = setupHook({
      product: makeProduct(25900),
      config: makeConfig({ minInstallmentMonths: 6, maxInstallmentMonths: 12, allowedMonths: [6, 10] }),
      initialMonths: 8,
    });
    expect(result.current.totalMonths).toBe(6);
  });

  it('allowedMonths ว่างหรือไม่ส่งมา → ช่วงต่ำสุด–สูงสุดตามเดิม', () => {
    const { result } = setupHook({
      product: makeProduct(25900),
      config: makeConfig({ minInstallmentMonths: 6, maxInstallmentMonths: 8, allowedMonths: [] }),
      initialMonths: 6,
    });
    expect(result.current.monthOptions).toEqual([6, 7, 8]);
  });
});
```

- [ ] **Step 6: รันให้เห็นว่าล้ม**

Run: `cd apps/web && npx vitest run src/pages/ContractCreatePage/hooks/useContractCalculation.test.ts`
Expected: FAIL — `expected [6, 7, 8, 9, 10, 11, 12] to deeply equal [10, 12]`

- [ ] **Step 7: แก้หน้าเว็บ**

`apps/web/src/pages/ContractCreatePage/types.ts` — เพิ่ม field ใน `interface InterestConfig` ต่อจาก `maxInstallmentMonths: number;`:

```ts
  /** งวดที่มีอัตราดอกเบี้ยรายงวด (เรียงน้อยไปมาก) · ว่าง/ไม่มี = ไม่มีตารางรายงวด ใช้ช่วงต่ำสุด–สูงสุด */
  allowedMonths?: number[];
```

`apps/web/src/pages/ContractCreatePage/hooks/useContractCalculation.ts` — แทนบล็อก

```ts
  const monthOptions: number[] = [];
  for (let m = minMonths; m <= maxMonths; m++) {
    monthOptions.push(m);
  }
```

ด้วย

```ts
  // มีตารางดอกเบี้ยรายงวด = เลือกได้เฉพาะงวดที่มีอัตรา (เซิร์ฟเวอร์ปฏิเสธงวดอื่น — getRateForMonths)
  const rateMonths = (interestConfig?.allowedMonths ?? []).filter((m) => m >= minMonths && m <= maxMonths);
  const monthOptions: number[] = [];
  if (rateMonths.length > 0) {
    monthOptions.push(...rateMonths);
  } else {
    for (let m = minMonths; m <= maxMonths; m++) {
      monthOptions.push(m);
    }
  }
  const monthOptionsKey = monthOptions.join(',');

  // งวดที่เลือกอยู่ไม่มีในตัวเลือก → ย้ายไป 12 ถ้ามี ไม่งั้นงวดแรก
  useEffect(() => {
    if (configPending || monthOptions.length === 0) return;
    setTotalMonths((prev) =>
      monthOptions.includes(prev) ? prev : monthOptions.includes(12) ? 12 : monthOptions[0],
    );
  }, [monthOptionsKey, configPending]);
```

(บล็อกนี้อยู่หลัง effect "Clamp totalMonths when config range changes" เดิม ซึ่งคงไว้ไม่แก้)

- [ ] **Step 8: รันให้ผ่าน + ตรวจชนิด**

Run: `cd apps/web && npx vitest run src/pages/ContractCreatePage` แล้ว `./tools/check-types.sh all`
Expected: PASS · TypeScript 0 errors ทั้ง api และ web

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/modules/interest-config/interest-config.service.ts apps/api/src/modules/interest-config/interest-config.service.spec.ts apps/web/src/pages/ContractCreatePage/types.ts apps/web/src/pages/ContractCreatePage/hooks/useContractCalculation.ts apps/web/src/pages/ContractCreatePage/hooks/useContractCalculation.test.ts
git commit -m "feat(contracts): offer only installment terms that have an interest rate" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: ตรวจรวมทั้งช่วง

**Files:** ไม่มีไฟล์ใหม่

- [ ] **Step 1: รันชุดทดสอบทั้งสามแพ็กเกจ**

Run:
```bash
cd packages/shared && npx vitest run && cd ../..
npm --prefix apps/api test
cd apps/web && npx vitest run && cd ../..
./tools/check-types.sh all
```
Expected: PASS ทั้งหมด · TypeScript 0 errors
ถ้ามีเทสต์ล้มนอกไฟล์ที่ระบุใน Task 2–6: แก้ได้เฉพาะเมื่อค่าเดิมมาจากดาวน์ที่คิดจาก % ตามตาราง "ตัวเลขอ้างอิง" — นอกนั้นคือบั๊กของงานนี้ ต้องแก้โค้ด ไม่ใช่แก้เทสต์

- [ ] **Step 2: ตรวจบนหน้าจอจริง (local)**

เปิด API + เว็บ (`npm run dev` — API ต้องตั้ง `NODE_OPTIONS=--max-old-space-size=8192`) แล้วตรวจด้วยบัญชี `admin@bestchoice.com`:

1. หน้ารายละเอียดสินค้าของเครื่องที่มีราคาผ่อน: การ์ดคำนวณ ช่องเงินดาวน์ตั้งต้นลงหลักร้อย และค่างวดเปลี่ยนตาม
2. หน้าสร้างสัญญา เลือกเครื่องเดียวกัน: เงินดาวน์ตั้งต้นเท่ากับข้อ 1 · ค่างวดเท่ากับการ์ดคำนวณของงวดเดียวกัน
3. พิมพ์เงินดาวน์เองเป็น 2,985: ระบบรับค่า 2,985 ไม่ปัด (ถ้าไม่ต่ำกว่า % ขั้นต่ำ)
4. หน้าตั้งค่าดอกเบี้ย เพิ่มแถวรายงวด 10 และ 12 งวดให้หมวดมือถือใหม่ แล้วกลับไปหน้าสร้างสัญญา: ตัวเลือกจำนวนงวดเหลือ 10 และ 12

บันทึกผลแต่ละข้อ (ผ่าน / ไม่ผ่าน พร้อมตัวเลขที่เห็น) ในข้อความ PR

- [ ] **Step 3: เปิด PR**

หัวข้อ: `feat: BC down payment rounds up to 100 + contract interest matches price quotes (price master 1a)`
เนื้อหา PR ต้องมี: ลิงก์สเปค · ตารางตัวเลขเดิม → ใหม่ของตัวอย่างมาตรฐาน · ผลตรวจหน้าจอ 4 ข้อ ·
**คำเตือนสำหรับขึ้นระบบ** "ก่อน deploy ให้ดูว่าบนระบบจริงมีแถวดอกเบี้ยรายงวด (`interest_config_rates`) ค้างอยู่หรือไม่ —
ถ้ามี การ deploy จะเปลี่ยนดอกเบี้ยของสัญญาใหม่เป็นค่าตามแถวนั้นทันที (สเปคข้อ 9.1)" · ลงท้ายด้วย `🤖 Generated with [Claude Code](https://claude.com/claude-code)`

---

## สิ่งที่แผนนี้ไม่ทำ (อยู่แผนถัดไป)

- เรท 2 / GFIN: ดาวน์ขั้นต่ำตามกติกา OVER · ปัดดาวน์ลูกค้า · การจับคู่ชื่อรุ่น · migration `min_down_pct` (ช่วง 1ข)
- ตัวช่วยปัดค่างวดขึ้นเป็นบาทเต็มสำหรับแสดงผล (`displayInstallment` — สเปคข้อ 4.1) — เพิ่มพร้อมผู้เรียกแรกในช่วง 2
- ราคากลาง · นำเข้า · หน้า "ราคาและเรทผ่อน" · การ์ดราคาขาย (ช่วง 2–4)
