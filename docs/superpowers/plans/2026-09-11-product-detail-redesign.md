# Product Detail Redesign (แนว A + เครื่องคำนวณ BESTCHOICE | GFIN) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** สร้างหน้า `/products/:id` ใหม่ตาม mockup แนว A (2 คอลัมน์ ราคา+ค่างวดอยู่ขวา) พร้อมเครื่องคำนวณการ์ดเดียวที่สลับ BESTCHOICE | GFIN ได้ และทำให้การคำนวณ GFIN ตรงกับหน้าคำนวณสินเชื่อของ GFIN (ปัดขึ้นเป็นบาท · เรทตามงวด+%คอม · แผงเฉพาะร้าน · ส่วนต่างราคาส่งลดดาวน์)

**Architecture:** สูตรทั้งหมดอยู่ใน `packages/shared` (`calcBcInstallment`/`calcGfinInstallment`) ใช้ร่วมกันโดย web (การ์ดคำนวณ · สรุปส่งลูกค้า) และ api (preview เว็บร้าน) · ตาราง GFIN อยู่ใน Prisma (`gfin_model_mappings` ราคากลาง · `gfin_overprice_rules` OVER + ผ่อนสูงสุด · `gfin_rate_factors` เรทต่อ (งวด, %คอม)) และค่าตั้งค่าเล็ก ๆ ใน `SystemConfig` · หน้า web แยกการ์ดเป็นคอมโพเนนต์ย่อยใน `apps/web/src/pages/ProductDetailPage/components/` โดย state ของเครื่องคำนวณยกขึ้นที่ `index.tsx` เพื่อให้ปุ่ม "คัดลอกสรุปส่งลูกค้า" ใช้ค่าที่เลือกอยู่

**Tech Stack:** React 19 + TS + Tailwind v4 + shadcn/Radix (`Select`, `Collapsible`, `DropdownMenu`, `Popover`, `Dialog`) · react-query · vitest + testing-library (web/shared) · NestJS + Prisma + jest `--runInBand` (api) · decimal.js

**Spec:** `docs/superpowers/specs/2026-09-11-product-detail-redesign-design.md`

## Global Constraints

- ห้ามใช้ hex/gray ใน web — ใช้ token (`bg-card`, `text-muted-foreground`, `border-border`, `text-primary`, `text-info`…) · ข้อความไทยใช้ `leading-snug`
- data fetching ผ่าน `useQuery`/`useMutation` + `api` จาก `@/lib/api` เท่านั้น
- เงินใน api = `Prisma.Decimal` · ทุก query กรอง `deletedAt: null`
- `apps/api` lint script มี `--fix` — **ห้ามรัน `npm run lint` ใน apps/api** ใช้ `npx eslint "src/**/*.ts"` (ไม่มี --fix) แทน
- api jest ต้อง `--runInBand` (script `npm test` ใน apps/api ทำให้แล้ว) · shared/web = vitest
- ราคาที่โชว์/คำนวณต้องมาจาก `getPositiveDisplayPrices` เสมอ (ห้ามอ่านคอลัมน์ดิบ)
- ต้นทุน/กำไร/คอมมิชชั่น ซ่อนจาก role `SALES` (server strip `costPrice` อยู่แล้ว)
- ข้อความถึงลูกค้า (สรุปส่งลูกค้า) ห้ามมีคำว่า GFIN / ดอกเบี้ย / % — ใช้ "เรทที่ 1" (BESTCHOICE) และ "เรทที่ 2" (GFIN)
- ค่างวด GFIN = `ceil(ยอดจัด × เรท) + ค่าล็อกเครื่อง 100` (ปัดขึ้นเป็นบาท) · ค่าคอม = ยอดจัด × %คอม · ยอดโอนให้ร้าน = ยอดจัด + คอม − ค่าทำสัญญา 100
- ค่าตั้งต้น GFIN: ดาวน์ขั้นต่ำ 25% · สูงสุด 80% · ขั้นละ 5 · คอม มือถือ 15 · iPad 5 · ค่าทำสัญญา 100 (แก้ได้ผ่านตั้งค่า)
- commit บ่อย ๆ ด้วยข้อความไทย/อังกฤษสั้น ๆ ระบุส่วนที่แตะ (`feat(web): …`, `feat(api): …`, `feat(shared): …`)

---

## File Structure

**packages/shared/src/**
- `installment-calc.types.ts` — เพิ่ม `TABLET` ใน `ProductCategoryForGfin`, `shopCommissionPct` ใน `GfinRateFactorRow`, `shopCommissionPct?`/`contractFee?` ใน `GfinCalcInput`, ฟิลด์ฝั่งร้านใน `GfinCalcOutput`
- `installment-calc.ts` — `calcGfinInstallment` ปัดขึ้น + ฝั่งร้าน · `findGfinMapping` รับ TABLET · ใหม่ `findGfinRateFactor(factors, months, commissionPct)`
- `gfin-customer-summary.ts` (ใหม่) — `formatRateLine(rateNo, down, monthly, months)` ใช้ทั้ง web
- `installment-calc.gfin.test.ts` — เทสเพิ่ม

**apps/api/**
- `prisma/schema.prisma` + `prisma/migrations/20261000900000_gfin_commission_dimension_max_months/migration.sql`
- `prisma/fixtures/gfin-2026-05-22.json` + `scripts/seed-gfin-tables.ts` — key ใหม่
- `src/modules/gfin-config/dto/rate-factor.dto.ts`, `overprice-rule.dto.ts`, `gfin-settings.dto.ts` (ใหม่)
- `src/modules/gfin-config/gfin-settings.util.ts` (ใหม่) — อ่าน/เขียน SystemConfig keys `gfin.*`
- `src/modules/gfin-config/gfin-config.service.ts` + `.controller.ts` + `.service.spec.ts`
- `src/modules/shop-catalog/installment-preview.service.ts` + `.spec.ts`
- `src/modules/products/products.service.ts` (findOne → `activeContract`) + `products-active-contract.util.ts` (ใหม่, pure) + spec

**apps/web/src/**
- `components/layout/TopBar.tsx` — map `/products`
- `pages/GfinConfigPage/RateFactorsTab.tsx`, `OverpriceRulesTab.tsx`, `GfinSettingsPanel.tsx` (ใหม่), `index.tsx`
- `pages/ProductDetailPage/`
  - `index.tsx` — layout 2 คอลัมน์ + header actions + state เครื่องคำนวณ
  - `hooks/useGfinTables.ts` (ใหม่) · `hooks/useBcConfig.ts` (ใหม่) · `hooks/useInstallmentCalcState.ts` (ใหม่) · `hooks/useCustomerSummary.ts` (แก้)
  - `utils/gfinQuote.ts` (ใหม่, pure: เลือก mapping/rule/factor + เรียก calc) + `gfinQuote.test.ts`
  - `utils/bcQuote.ts` (ใหม่, pure) + test
  - `utils/buildCustomerSummary.ts` (+test) — เรทที่ 1/2
  - `components/InstallmentCalculatorCard.tsx` (เขียนใหม่) · `components/calc/FinanceSwitch.tsx` · `components/calc/BcPanel.tsx` · `components/calc/GfinPanel.tsx` · `components/calc/MonthsSelect.tsx` · `components/calc/CalcRows.tsx` (ResultBox/DetailRow/CompareRow)
  - `components/ProductIdentityCard.tsx` (ใหม่) · `components/CostProfitStrip.tsx` (ใหม่) · `components/QcSummaryCard.tsx` (ใหม่) · `components/ContractSummaryCard.tsx` (ใหม่) · `components/SellingPriceCard.tsx` (แก้) · `components/ProductHeaderActions.tsx` (ใหม่)
  - ลบ `components/ProductInfo.tsx`, `BcCalculatorCard.tsx`, `GfinCalculatorCard.tsx` + เทสเดิมของมัน (แทนด้วยเทสใหม่)

---

### Task 1: shared — `calcGfinInstallment` ปัดขึ้น + คอมมิชชั่น + ฝั่งร้าน + TABLET

**Files:**
- Modify: `packages/shared/src/installment-calc.types.ts:40-99`
- Modify: `packages/shared/src/installment-calc.ts:75-153`
- Create: `packages/shared/src/gfin-customer-summary.ts`
- Modify: `packages/shared/src/index.ts` (export ใหม่)
- Test: `packages/shared/src/installment-calc.gfin.test.ts`

**Interfaces:**
- Produces:
```ts
export type ProductCategoryForGfin = 'PHONE_NEW' | 'PHONE_USED' | 'TABLET';
export interface GfinRateFactorRow { months: number; shopCommissionPct: number; factor: Decimal; feePerInstallment: Decimal; isActive: boolean }
export interface GfinOverpriceRuleRow { …เดิม; maxMonths: number | null }
export interface GfinCalcInput { …เดิม; shopCommissionPct?: Decimal /* default = rateFactor.shopCommissionPct */; contractFee?: Decimal /* default 100 */ }
export interface GfinCalcOutput { …เดิม; shopCommissionPct: Decimal; shopCommissionAmount: Decimal; contractFee: Decimal; netTransferToShop: Decimal; shopTotalReceived: Decimal; priceAboveSubmit: boolean }
export function findGfinRateFactor(factors: GfinRateFactorRow[], months: number, commissionPct: number): GfinRateFactorRow | null
export function formatRateLine(rateNo: 1 | 2, downAmount: number, monthlyPayment: number, months: number): string // "เรทที่ 1 ดาวน์ 2,985 บาท ผ่อนเดือนละ 1,838.26 บาท 12 งวด"
export function gfinDownPctOptions(minPct: number, maxPct = 80, step = 5): number[]
```

- [ ] **Step 1: เขียนเทสที่ต้องล้มก่อน** (ต่อท้ายไฟล์เทสเดิม)

```ts
describe('calcGfinInstallment — GFIN portal parity (2026-09-11)', () => {
  const factor12c15: GfinRateFactorRow = { months: 12, shopCommissionPct: 15, factor: new Decimal('0.179238'), feePerInstallment: new Decimal('100'), isActive: true };
  const mapping15_128: GfinModelMappingRow = { id: 'm15', gfinSeries: 'iPhone 15', gfinVariant: null, storage: '128GB', condition: 'HAND_1', maxPrice: new Decimal('23000'), modelMatchPattern: 'iPhone 15', isActive: true };
  const over15h1: GfinOverpriceRuleRow = { id: 'r15', label: 'iPhone 15 มือ 1', seriesPattern: 'iPhone 15', condition: 'HAND_1', allowance: new Decimal('1000'), maxMonths: 12, isActive: true };
  const out = calcGfinInstallment({ installmentPrice: new Decimal('19900'), product: { brand: 'Apple', model: 'iPhone 15', storage: '128GB', category: 'PHONE_NEW' }, months: 12, downPct: new Decimal('0.25'), mapping: mapping15_128, overpriceRule: over15h1, rateFactor: factor12c15 });
  it('ราคาส่ง 24,000 · ส่วนลดดาวน์ 4,100 · ดาวน์จริง 1,900 · ยอดจัด 18,000', () => {
    expect(out.gfinSubmitPrice.toFixed(2)).toBe('24000.00');
    expect(out.downDiscount.toFixed(2)).toBe('4100.00');
    expect(out.downAmountByFormula.toFixed(2)).toBe('6000.00');
    expect(out.downAmountActual.toFixed(2)).toBe('1900.00');
    expect(out.financedAmount.toFixed(2)).toBe('18000.00');
  });
  it('ค่างวดปัดขึ้นเป็นบาท: ceil(18000×0.179238=3226.28)=3227 + 100 = 3,327', () => {
    expect(out.monthlyPayment.toFixed(2)).toBe('3327.00');
    expect(out.totalPayback.toFixed(2)).toBe('39924.00');
  });
  it('ฝั่งร้าน: คอม 15% ของยอดจัด 2,700 · ค่าทำสัญญา 100 · โอนให้ร้าน 20,600 · ร้านรับรวม 22,500', () => {
    expect(out.shopCommissionPct.toNumber()).toBe(15);
    expect(out.shopCommissionAmount.toFixed(2)).toBe('2700.00');
    expect(out.contractFee.toFixed(2)).toBe('100.00');
    expect(out.netTransferToShop.toFixed(2)).toBe('20600.00');
    expect(out.shopTotalReceived.toFixed(2)).toBe('22500.00');
    expect(out.priceAboveSubmit).toBe(false);
  });
  it('ภาพจริง iPhone 17e: ราคาส่ง 22,000 ดาวน์ 25% = 5,500 ยอดจัด 16,500 → คอม 2,475 โอนให้ร้าน 18,875', () => {
    const m = { ...mapping15_128, id: 'm17e', gfinSeries: 'iPhone 17e', storage: '256GB', maxPrice: new Decimal('22000'), modelMatchPattern: 'iPhone 17e' };
    const o = calcGfinInstallment({ installmentPrice: new Decimal('22000'), product: { brand: 'Apple', model: 'iPhone 17e', storage: '256GB', category: 'PHONE_NEW' }, months: 15, downPct: new Decimal('0.25'), mapping: m, overpriceRule: null, rateFactor: { months: 15, shopCommissionPct: 15, factor: new Decimal('0.1467'), feePerInstallment: new Decimal('100'), isActive: true } });
    expect(o.financedAmount.toFixed(2)).toBe('16500.00');
    expect(o.shopCommissionAmount.toFixed(2)).toBe('2475.00');
    expect(o.netTransferToShop.toFixed(2)).toBe('18875.00');
    expect(o.monthlyPayment.toFixed(2)).toBe('2521.00'); // ceil(16500×0.1467=2420.55)=2421+100
  });
  it('ราคาผ่อนที่ต้องการสูงกว่าราคาส่ง → ส่วนลด 0, priceAboveSubmit=true', () => {
    const o = calcGfinInstallment({ installmentPrice: new Decimal('26000'), product: { brand: 'Apple', model: 'iPhone 15', storage: '128GB', category: 'PHONE_NEW' }, months: 12, downPct: new Decimal('0.25'), mapping: mapping15_128, overpriceRule: over15h1, rateFactor: factor12c15 });
    expect(o.downDiscount.toFixed(2)).toBe('0.00');
    expect(o.priceAboveSubmit).toBe(true);
  });
  it('shopCommissionPct ใน input ทับของ rateFactor ได้ และคอมของ rateFactor ไม่ตรง → error', () => {
    const o = calcGfinInstallment({ installmentPrice: new Decimal('19900'), product: { brand: 'Apple', model: 'iPhone 15', storage: '128GB', category: 'PHONE_NEW' }, months: 12, shopCommissionPct: new Decimal('5'), mapping: mapping15_128, overpriceRule: over15h1, rateFactor: factor12c15 });
    expect(o.isValid).toBe(false);
    expect(o.errors[0]).toContain('คอมมิชชั่น');
  });
});
describe('findGfinRateFactor / findGfinMapping TABLET / formatRateLine / gfinDownPctOptions', () => {
  it('เลือกเรทตาม (งวด, %คอม) และข้าม inactive', () => {
    const rows: GfinRateFactorRow[] = [
      { months: 12, shopCommissionPct: 15, factor: new Decimal('0.18'), feePerInstallment: new Decimal('100'), isActive: true },
      { months: 12, shopCommissionPct: 5, factor: new Decimal('0.16'), feePerInstallment: new Decimal('100'), isActive: false },
    ];
    expect(findGfinRateFactor(rows, 12, 15)?.factor.toString()).toBe('0.18');
    expect(findGfinRateFactor(rows, 12, 5)).toBeNull();
    expect(findGfinRateFactor(rows, 10, 15)).toBeNull();
  });
  it('TABLET แมปเป็น HAND_1', () => {
    const m: GfinModelMappingRow = { id: 't1', gfinSeries: 'iPad 10', gfinVariant: null, storage: '64GB', condition: 'HAND_1', maxPrice: new Decimal('12000'), modelMatchPattern: 'iPad 10', isActive: true };
    expect(findGfinMapping({ brand: 'Apple', model: 'iPad 10', storage: '64GB', category: 'TABLET' }, [m])?.id).toBe('t1');
  });
  it('formatRateLine ตรงรูปแบบสติกเกอร์', () => {
    expect(formatRateLine(1, 2985, 1838.26, 12)).toBe('เรทที่ 1 ดาวน์ 2,985 บาท ผ่อนเดือนละ 1,838.26 บาท 12 งวด');
    expect(formatRateLine(2, 1900, 3327, 12)).toBe('เรทที่ 2 ดาวน์ 1,900 บาท ผ่อนเดือนละ 3,327 บาท 12 งวด');
  });
  it('gfinDownPctOptions 25→80 ขั้นละ 5', () => {
    expect(gfinDownPctOptions(25)).toEqual([25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80]);
  });
});
```

- [ ] **Step 2: รันให้ล้ม** — `cd packages/shared && npx vitest run src/installment-calc.gfin.test.ts` → FAIL (type/`shopCommissionPct` ไม่มี)

- [ ] **Step 3: แก้ types + calc**

`installment-calc.types.ts`: ตามบล็อก Interfaces ด้านบน (`maxMonths: number | null` บน `GfinOverpriceRuleRow`, `shopCommissionPct: number` บน `GfinRateFactorRow`, ฟิลด์ใหม่ใน input/output)

`installment-calc.ts` ส่วน GFIN:
```ts
export function calcGfinInstallment(input: GfinCalcInput): GfinCalcOutput {
  const { installmentPrice, months, downPct, mapping, overpriceRule, rateFactor } = input;
  const errors: string[] = [];
  const contractFee = input.contractFee ?? new Decimal(100);
  const shopCommissionPct = input.shopCommissionPct ?? new Decimal(rateFactor.shopCommissionPct);

  const allowance = overpriceRule?.allowance ?? new Decimal(0);
  const gfinSubmitPrice = round2(mapping.maxPrice.add(allowance));
  const priceAboveSubmit = installmentPrice.gt(gfinSubmitPrice);
  const downDiscount = round2(Decimal.max(gfinSubmitPrice.sub(installmentPrice), 0));
  const resolvedDownPct = downPct ?? new Decimal('0.25');
  const downAmountByFormula = round2(gfinSubmitPrice.mul(resolvedDownPct));
  const downAmountActual = round2(Decimal.max(downAmountByFormula.sub(downDiscount), 0));
  const financedAmount = round2(gfinSubmitPrice.sub(downAmountByFormula));

  if (rateFactor.months !== months) errors.push(`ตารางอัตราสำหรับ ${months} งวด ไม่ตรงกับ rate factor ที่ส่งเข้ามา`);
  if (!new Decimal(rateFactor.shopCommissionPct).eq(shopCommissionPct)) errors.push(`เรทที่ส่งเข้ามาเป็นของคอมมิชชั่น ${rateFactor.shopCommissionPct}% ไม่ใช่ ${shopCommissionPct.toString()}%`);
  if (!rateFactor.isActive) errors.push('อัตราดอกเบี้ย GFIN ปิดใช้งาน');

  // GFIN portal: monthly = Math.ceil(financed × rate) + deviceLockFee; total = monthly × months
  const interestPart = rateFactor.factor.mul(financedAmount).ceil();
  const monthlyPayment = round2(interestPart.add(rateFactor.feePerInstallment));
  const totalPayback = months > 0 ? round2(monthlyPayment.mul(months)) : new Decimal(0);
  const shopCommissionAmount = round2(financedAmount.mul(shopCommissionPct).div(100));
  const netTransferToShop = round2(financedAmount.add(shopCommissionAmount).sub(contractFee));
  const shopTotalReceived = round2(downAmountActual.add(netTransferToShop));
  return { gfinSubmitPrice, downDiscount, downPct: resolvedDownPct, downAmountByFormula, downAmountActual, financedAmount, monthlyPayment, totalPayback, feePerInstallment: rateFactor.feePerInstallment, shopCommissionPct, shopCommissionAmount, contractFee, netTransferToShop, shopTotalReceived, priceAboveSubmit, isValid: errors.length === 0, errors };
}
export function findGfinRateFactor(factors: GfinRateFactorRow[], months: number, commissionPct: number): GfinRateFactorRow | null {
  return factors.find((f) => f.isActive && f.months === months && f.shopCommissionPct === commissionPct) ?? null;
}
```
`findGfinMapping`: `const condition = product.category === 'PHONE_USED' ? 'HAND_2' : 'HAND_1';`

`gfin-customer-summary.ts`:
```ts
export function formatBahtPlain(n: number): string { /* เหมือน formatBaht ใน web: คั่นหลักพัน, ตัด .00 */ }
export function formatRateLine(rateNo: 1 | 2, downAmount: number, monthlyPayment: number, months: number): string {
  return `เรทที่ ${rateNo} ดาวน์ ${formatBahtPlain(downAmount)} บาท ผ่อนเดือนละ ${formatBahtPlain(monthlyPayment)} บาท ${months} งวด`;
}
export function gfinDownPctOptions(minPct: number, maxPct = 80, step = 5): number[] { const out: number[] = []; for (let p = minPct; p <= maxPct; p += step) out.push(p); return out; }
```
export ทั้งหมดใน `index.ts`

- [ ] **Step 4: รันเทส shared ทั้งชุด** — `cd packages/shared && npx vitest run` → PASS (เทสเดิม canonical 2,923 ยังผ่านเพราะ ceil(2822.9985)=2823)

- [ ] **Step 5: build shared + commit** — `npm run build --workspace=@installment/shared` · `git add packages/shared && git commit -m "feat(shared): GFIN calc ตามหน้าคำนวณสินเชื่อ GFIN — ปัดขึ้นเป็นบาท · เรทตาม (งวด, %คอม) · แผงฝั่งร้าน · TABLET"`

---

### Task 2: api — schema/migration: เรทต่อ (งวด, %คอม) + ผ่อนสูงสุดต่อกฎ OVER

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (`GfinOverpriceRule`, `GfinRateFactor`)
- Create: `apps/api/prisma/migrations/20261000900000_gfin_commission_dimension_max_months/migration.sql`
- Modify: `apps/api/src/modules/gfin-config/dto/rate-factor.dto.ts`, `dto/overprice-rule.dto.ts`, `gfin-config.service.ts`, `scripts/seed-gfin-tables.ts`, `prisma/fixtures/gfin-2026-05-22.json`
- Test: `apps/api/src/modules/gfin-config/gfin-config.service.spec.ts`

**Interfaces:**
- Produces: Prisma `GfinRateFactor.shopCommissionPct: number` (unique `[months, shopCommissionPct]`), `GfinOverpriceRule.maxMonths: number | null`; DTO fields `shopCommissionPct?: number` (0–100, int), `maxMonths?: number | null` (1–36)

- [ ] **Step 1: เทสล้มก่อน** ใน `gfin-config.service.spec.ts` (describe `createRateFactor`)
```ts
it('ส่ง shopCommissionPct ไป Prisma และ default 15 เมื่อไม่ระบุ', async () => {
  prisma.gfinRateFactor.create.mockResolvedValue({ id: 'f2' });
  await service.createRateFactor({ months: 12, factor: 0.179238, shopCommissionPct: 5 }, 'user-1');
  expect(prisma.gfinRateFactor.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ months: 12, shopCommissionPct: 5 }) }));
  await service.createRateFactor({ months: 12, factor: 0.179238 }, 'user-1');
  expect(prisma.gfinRateFactor.create).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ shopCommissionPct: 15 }) }));
});
it('createOverpriceRule ส่ง maxMonths', async () => {
  prisma.gfinOverpriceRule.create.mockResolvedValue({ id: 'r9' });
  await service.createOverpriceRule({ label: 'iPhone 16 มือ 1', seriesPattern: 'iPhone 16', condition: 'HAND_1', allowance: 2000, maxMonths: 15 }, 'user-1');
  expect(prisma.gfinOverpriceRule.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ maxMonths: 15 }) }));
});
```
- [ ] **Step 2: รัน** — `cd apps/api && npx jest src/modules/gfin-config --runInBand` → FAIL (type error `shopCommissionPct`)
- [ ] **Step 3: schema + migration**
```prisma
model GfinOverpriceRule { …เดิม
  /// ผ่อนได้สูงสุด (งวด) ของซีรีส์/สภาพนี้ตามตารางราคา GFIN — null = ไม่จำกัด
  maxMonths     Int?          @map("max_months")
}
model GfinRateFactor { …
  months            Int
  /// % คอมมิชชั่นที่ร้านเลือกในหน้า GFIN — เรทต่างกันตามค่านี้ (มือถือ 15 · iPad 5)
  shopCommissionPct Int       @default(15) @map("shop_commission_pct")
  …
  @@unique([months, shopCommissionPct])
}
```
(ลบ `@unique` ออกจาก `months`) — migration.sql:
```sql
ALTER TABLE "gfin_rate_factors" ADD COLUMN "shop_commission_pct" INTEGER NOT NULL DEFAULT 15;
DROP INDEX "gfin_rate_factors_months_key";
CREATE UNIQUE INDEX "gfin_rate_factors_months_shop_commission_pct_key" ON "gfin_rate_factors"("months", "shop_commission_pct");
ALTER TABLE "gfin_overprice_rules" ADD COLUMN "max_months" INTEGER;
```
`cd apps/api && npx prisma generate`
- [ ] **Step 4: DTO + service + seed** — `CreateRateFactorDto.shopCommissionPct?: number` (`@IsOptional() @IsInt() @Min(0) @Max(100)`), `UpdateRateFactorDto` เหมือนกัน; overprice DTOs `maxMonths?: number | null` (`@IsOptional() @IsInt() @Min(1) @Max(36)`); service create/update ส่งค่า (`shopCommissionPct: dto.shopCommissionPct ?? 15`); `listRateFactors` orderBy `[{ months: 'asc' }, { shopCommissionPct: 'asc' }]`; seed upsert `where: { months_shopCommissionPct: { months, shopCommissionPct: rf.shopCommissionPct ?? 15 } }`; fixture `rateFactors[]` เพิ่ม `"shopCommissionPct": 15` ทุกแถว และ `overpriceRules[]` เพิ่ม `maxMonths` (12 series 10 · 13–15 = 12 · 16–17 = 15)
- [ ] **Step 5: รันเทส** — `npx jest src/modules/gfin-config --runInBand` → PASS · `npx tsc --noEmit -p apps/api/tsconfig.json`
- [ ] **Step 6: commit** — `git add apps/api/prisma apps/api/src/modules/gfin-config apps/api/scripts && git commit -m "feat(api): GFIN rate factors มีมิติ %คอม + ผ่อนสูงสุดต่อกฎ OVER"`

---

### Task 3: api — `GET/PATCH /gfin-config/settings` (ดาวน์ขั้นต่ำ · คอมตามหมวด · ค่าทำสัญญา)

**Files:**
- Create: `apps/api/src/modules/gfin-config/gfin-settings.util.ts`, `dto/gfin-settings.dto.ts`
- Modify: `gfin-config.service.ts`, `gfin-config.controller.ts`
- Test: `gfin-config.service.spec.ts`

**Interfaces:**
```ts
export interface GfinSettings { minDownPct: number; maxDownPct: number; downStepPct: number; contractFee: number; commissionPctByCategory: { PHONE: number; TABLET: number } }
export const GFIN_SETTINGS_KEYS = { minDownPct: 'gfin.minDownPct', commissionPhone: 'gfin.commissionPct.PHONE', commissionTablet: 'gfin.commissionPct.TABLET', contractFee: 'gfin.contractFee' } as const;
export async function loadGfinSettings(prisma: PrismaService): Promise<GfinSettings> // defaults 25 / 80 / 5 / 100 / {15,5}
export function commissionPctForCategory(settings: GfinSettings, category: string): number // TABLET → TABLET, อื่น → PHONE
```
`UpdateGfinSettingsDto { minDownPct?: number (0-80, step ไม่บังคับ); commissionPhone?: number; commissionTablet?: number; contractFee?: number }` · `GET /gfin-config/settings` (ทุก role) · `PATCH /gfin-config/settings` (OWNER) → upsert `systemConfig` แต่ละ key + `auditService.log({ action: 'GFIN_SETTINGS_UPDATED', entity: 'system_config', entityId: 'gfin' })`

- [ ] **Step 1: เทสล้มก่อน**
```ts
describe('gfin settings', () => {
  it('คืนค่า default เมื่อไม่มี key', async () => {
    prisma.systemConfig = { findMany: jest.fn().mockResolvedValue([]), upsert: jest.fn() };
    const s = await service.getSettings();
    expect(s).toEqual({ minDownPct: 25, maxDownPct: 80, downStepPct: 5, contractFee: 100, commissionPctByCategory: { PHONE: 15, TABLET: 5 } });
  });
  it('อ่านค่าจาก system_config และ PATCH upsert รายคีย์', async () => {
    prisma.systemConfig.findMany.mockResolvedValue([{ key: 'gfin.minDownPct', value: '30' }, { key: 'gfin.commissionPct.TABLET', value: '7' }]);
    expect((await service.getSettings()).minDownPct).toBe(30);
    await service.updateSettings({ minDownPct: 35, commissionPhone: 10 }, 'user-1');
    expect(prisma.systemConfig.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { key: 'gfin.minDownPct' } }));
    expect(prisma.systemConfig.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { key: 'gfin.commissionPct.PHONE' } }));
  });
});
```
- [ ] **Step 2: รันให้ล้ม** → FAIL (`getSettings` ไม่มี)
- [ ] **Step 3: implement** util (อ่านด้วย `prisma.systemConfig.findMany({ where: { key: { in: [...] }, deletedAt: null } })` แปลง `Number`, ตกเป็น default เมื่อ NaN) + service `getSettings()/updateSettings(dto, userId)` + controller routes (ประกาศ `settings` **ก่อน** route ที่มี `:id`)
- [ ] **Step 4: รัน** → PASS
- [ ] **Step 5: commit** — `feat(api): ตั้งค่า GFIN (ดาวน์ขั้นต่ำ · คอมตามหมวด · ค่าทำสัญญา) ผ่าน system_config`

---

### Task 4: api — preview เว็บร้านใช้เรทตาม (งวด, คอมตามหมวด) + ปัดขึ้น

**Files:**
- Modify: `apps/api/src/modules/shop-catalog/installment-preview.service.ts:104-200`
- Test: `apps/api/src/modules/shop-catalog/installment-preview.service.spec.ts`

- [ ] **Step 1: แก้เทส GFIN ใน spec** — mock `prisma.gfinRateFactor.findFirst` ให้ถูกเรียกด้วย `where: expect.objectContaining({ months: 12, shopCommissionPct: 15 })` และ mock `prisma.systemConfig.findMany` → `[]` (default) · เพิ่มเคส `category: 'TABLET'` → `shopCommissionPct: 5` · เพิ่ม `shopCommissionPct: 15` ในแถว factor ที่ mock · ยอดเดิม 2,923 ยังเท่าเดิม
- [ ] **Step 2: รันให้ล้ม** — `npx jest src/modules/shop-catalog/installment-preview --runInBand`
- [ ] **Step 3: implement** — `const settings = await loadGfinSettings(this.prisma); const commissionPct = commissionPctForCategory(settings, product.category);` · `findFirst({ where: { months: dto.months, shopCommissionPct: commissionPct, deletedAt: null, isActive: true } })` · ส่ง `shopCommissionPct: new Decimal(commissionPct)`, `contractFee: new Decimal(settings.contractFee)`, `downPct: dto.downPct ?? new Decimal(settings.minDownPct / 100)` · category สำหรับ `findGfinMapping`: `'PHONE_NEW' | 'PHONE_USED' | 'TABLET'` (อื่นถือเป็น PHONE_USED เหมือนเดิม) · rule objects เพิ่ม `maxMonths` · ถ้า `rule?.maxMonths && dto.months > rule.maxMonths` → `{ available: false, reason: 'months_over_max' }`
- [ ] **Step 4: รัน** → PASS
- [ ] **Step 5: commit** — `feat(api): preview GFIN ใช้คอมตามหมวด + เพดานงวด`

---

### Task 5: api — `GET /products/:id` เพิ่ม `activeContract`

**Files:**
- Create: `apps/api/src/modules/products/products-active-contract.util.ts` (+ `.spec.ts`)
- Modify: `apps/api/src/modules/products/products.service.ts:141-147`
- Test: `apps/api/src/modules/products/products.service.spec.ts`

**Interfaces:**
```ts
export interface ActiveContractSummary { id: string; contractNumber: string; status: string; createdAt: Date; customerName: string; salespersonName: string; sellingPrice: string; downPayment: string; totalMonths: number; monthlyPayment: string; paidInstallments: number; nextDueDate: Date | null }
export function summarizeContractPayments(payments: Array<{ status: string; dueDate: Date }>): { paidInstallments: number; nextDueDate: Date | null }
```
- [ ] **Step 1: เทส util ล้มก่อน** (`products-active-contract.util.spec.ts`): PAID 1 + PENDING 2 → `{ paidInstallments: 1, nextDueDate: <dueDate ต่ำสุดของที่ไม่ใช่ PAID> }` · ทั้งหมด PAID → `nextDueDate: null`
- [ ] **Step 2: implement util** (pure) → รันผ่าน
- [ ] **Step 3: เทส service**: `prisma.product.findUnique` คืน `status: 'SOLD_INSTALLMENT'` → `prisma.contract.findFirst` ถูกเรียกด้วย `where: { productId: 'p1', deletedAt: null, status: { notIn: ['DRAFT', 'CANCELED'] } }, orderBy: { createdAt: 'desc' }` และผลลัพธ์มี `activeContract.customerName` = `${firstName} ${lastName}`.trim() · สถานะ `IN_STOCK` → `activeContract: null` และ **ไม่เรียก** `contract.findFirst`
- [ ] **Step 4: implement `findOne`** — หลัง findUnique: `const activeContract = product.status === 'SOLD_INSTALLMENT' ? await this.loadActiveContract(product.id) : null; return { ...product, activeContract };` โดย `loadActiveContract` ใช้ `contract.findFirst({ …, select: { id, contractNumber, status, createdAt, sellingPrice, downPayment, totalMonths, monthlyPayment, customer: { select: { firstName, lastName } }, salesperson: { select: { name } }, payments: { where: { deletedAt: null }, select: { status, dueDate } } } })` (ตรวจชื่อฟิลด์ลูกค้า/ผู้ใช้จริงใน schema ก่อน: `Customer.firstName/lastName`, `User.name`)
- [ ] **Step 5: รัน** `npx jest src/modules/products --runInBand` → PASS · commit `feat(api): GET /products/:id แนบสรุปสัญญาที่ผูกกับเครื่อง (activeContract)`

---

### Task 6: web — ตั้งค่า GFIN: คอลัมน์ %คอม · ผ่อนสูงสุด · แผงค่าตั้งต้น

**Files:**
- Modify: `apps/web/src/pages/GfinConfigPage/RateFactorsTab.tsx` (คอลัมน์+ฟิลด์ `shopCommissionPct`, ค้นหาตามงวด/คอม), `OverpriceRulesTab.tsx` (คอลัมน์+ฟิลด์ `maxMonths`), `index.tsx` (แท็บ "ค่าตั้งต้น")
- Create: `apps/web/src/pages/GfinConfigPage/GfinSettingsPanel.tsx` + `__tests__/GfinSettingsPanel.test.tsx`

- [ ] **Step 1: เทสล้มก่อน** — render panel with mocked `api.get('/gfin-config/settings')` → โชว์ค่า 25/15/5/100 · แก้ช่อง minDownPct เป็น 30 แล้วกดบันทึก → `api.patch('/gfin-config/settings', { minDownPct: 30, commissionPhone: 15, commissionTablet: 5, contractFee: 100 })`
- [ ] **Step 2: implement** panel (4 ช่อง Input + ปุ่มบันทึก, OWNER เท่านั้นเห็นปุ่ม) + คอลัมน์ในตาราง 2 แท็บ + ฟอร์ม
- [ ] **Step 3: รัน** `cd apps/web && npx vitest run src/pages/GfinConfigPage` → PASS · commit `feat(web): ตั้งค่า GFIN — %คอมต่อเรท · ผ่อนสูงสุดต่อกฎ · ค่าตั้งต้น`

---

### Task 7: web — pure quote helpers + hooks

**Files:**
- Create: `apps/web/src/pages/ProductDetailPage/utils/gfinQuote.ts` (+test), `utils/bcQuote.ts` (+test)
- Create: `hooks/useGfinTables.ts`, `hooks/useBcConfig.ts`, `hooks/useInstallmentCalcState.ts`

**Interfaces:**
```ts
// gfinQuote.ts
export interface GfinTables { mappings: MaxPriceApi[]; rules: OverpriceApi[]; factors: RateFactorApi[]; settings: GfinSettingsApi }
export interface GfinQuoteInput { product: { brand: string; model: string; storage: string | null; category: string }; installmentPrice: number; months: number; downPct: number /* 25 */; commissionPct: number /* 15 */ }
export type GfinQuote =
  | { available: false; reason: 'no_mapping' | 'no_factor' | 'invalid'; errors?: string[] }
  | { available: true; result: GfinCalcOutput; mapping: MaxPriceApi; rule: OverpriceApi | null; maxMonths: number | null; monthsOptions: Array<{ months: number; monthly: number }> }
export function buildGfinQuote(tables: GfinTables, input: GfinQuoteInput): GfinQuote
export function defaultCommissionPct(settings: GfinSettingsApi, category: string): number
// bcQuote.ts
export function buildBcQuote(config: BcConfigJson, installmentPrice: number, months: number, downAmount: number): { result: BcCalcOutput; monthsOptions: Array<{ months: number; monthly: number }> }
// useInstallmentCalcState.ts
export interface CalcState { fin: 'bc' | 'gfin'; bc: { months: number | null; downAmount: number | null }; gfin: { months: number | null; downPct: number | null; commissionPct: number | null } }
export function useInstallmentCalcState(): [CalcState, (patch: Partial<CalcState> | ((s: CalcState) => CalcState)) => void]
```
`monthsOptions` ของ GFIN = ทุก factor ที่ active ของคอมที่เลือก เรียงงวด ตัดที่ `maxMonths` ของ rule · ของ BC = `config.allowedMonths`

- [ ] **Step 1: เทส `gfinQuote.test.ts`** — ใช้ตาราง iPhone 15 128GB (23,000 + 1,000, maxMonths 12) และ factors {10,12,15}@15 → `monthsOptions` = [10, 12] (15 ถูกตัด) · quote 12 งวด ดาวน์ 25% → `result.monthlyPayment` 3,327 · Samsung → `reason: 'no_mapping'` · `defaultCommissionPct(settings, 'TABLET')` = 5
- [ ] **Step 2: เทส `bcQuote.test.ts`** — golden config เดิมของ `BcCalculatorCard.test.tsx` → `monthsOptions.length === allowedMonths.length` และ monthly ของ 12 งวดตรง `calcBcInstallment`
- [ ] **Step 3: implement** helpers + hooks (`useGfinTables`: 4 queries key `['gfin-max-prices']`, `['gfin-overprice-rules']`, `['gfin-rate-factors']`, `['gfin-settings']`; `useBcConfig(category)`: key `['interest-config', category, 'bc']` enabled เฉพาะ PHONE_*)
- [ ] **Step 4: รัน** `npx vitest run src/pages/ProductDetailPage/utils` → PASS · commit `feat(web): quote helpers BESTCHOICE/GFIN + hooks`

---

### Task 8: web — `InstallmentCalculatorCard` ใหม่ (สวิตช์ · dropdown งวด · ดาวน์จริง · แผงร้าน)

**Files:**
- Rewrite: `components/InstallmentCalculatorCard.tsx`
- Create: `components/calc/FinanceSwitch.tsx`, `components/calc/MonthsSelect.tsx`, `components/calc/BcPanel.tsx`, `components/calc/GfinPanel.tsx`, `components/calc/CalcRows.tsx`
- Delete: `components/BcCalculatorCard.tsx`, `components/GfinCalculatorCard.tsx`, `__tests__/BcCalculatorCard.test.tsx`
- Test: `__tests__/InstallmentCalculatorCard.test.tsx` (เขียนใหม่)

**Interfaces:**
```ts
interface Props { product: ProductForCalc /* id, category, brand, model, storage, cashPrice, installmentPrice, prices */; state: CalcState; onChange: (patch) => void; canEditPrice: boolean; onEditPrice: () => void; bcConfig?: BcConfigJson; gfinTables?: GfinTables; loading: boolean }
```
พฤติกรรม: ค่าตั้งต้น BC = 12 งวด (ถ้ามี) + ดาวน์ขั้นต่ำ · GFIN = 12 งวด (หรือสูงสุดที่ ≤ maxMonths) + ดาวน์ขั้นต่ำ + คอมตามหมวด · SALES ไม่เห็นแถวคอม BC, ช่อง %คอม GFIN และแผงเฉพาะร้าน · GFIN `available:false` → สวิตช์ GFIN disabled + ข้อความ "GFIN: รุ่นนี้ไม่อยู่ในตารางราคาของ GFIN" · `priceAboveSubmit` → กล่องเตือน warning "ราคาผ่อนสูงกว่าราคาส่งสูงสุด GFIN (X) — ร้านจะได้น้อยกว่าราคาผ่อน"

- [ ] **Step 1: เทสล้มก่อน** (ตัวอย่างสำคัญ)
```ts
it('สวิตช์เริ่มที่ BESTCHOICE, dropdown งวดบอกค่างวด, ปุ่มทำสัญญา', …) // expect(screen.getByText(/12 งวด · ผ่อนเดือนละ 1,838.26/)) …
it('สลับไป GFIN → โชว์ดาวน์ที่แจ้ง 6,000 → ลูกค้าจ่ายจริง 1,900 และค่างวด 3,327', …)
it('SALES ไม่เห็นแผงเฉพาะร้านค้าและช่อง % คอมมิชชั่น', …)
it('รุ่นไม่อยู่ในตาราง GFIN → ปุ่ม GFIN disabled + ข้อความ', …)
it('ไม่มีราคาผ่อน → กล่องเตือนเดิม + ลิงก์แก้ราคาเมื่อ canEditPrice', …)
it('เปลี่ยนงวดเรียก onChange ด้วย state ใหม่', …)
```
- [ ] **Step 2: implement** ตาม mockup (คลาส token เท่านั้น) — `MonthsSelect` ใช้ `Select` ของ shadcn แสดง `N งวด · ผ่อนเดือนละ X` · `FinanceSwitch` = 2 ปุ่ม role="tab" aria-selected · `Collapsible` สำหรับ "รายละเอียดการคำนวณ" (ค่าเริ่มต้นพับ) · ปุ่มทำสัญญา `navigate('/contracts/create?productId=…&downAmount=…&months=…')` เฉพาะฝั่ง BC + role เดิม
- [ ] **Step 3: รัน** `npx vitest run src/pages/ProductDetailPage` → PASS · commit `feat(web): เครื่องคำนวณค่างวดการ์ดเดียว สลับ BESTCHOICE | GFIN`

---

### Task 9: web — การ์ดข้อมูลเครื่อง · แถบทุน/กำไร · QC ย่อ

**Files:**
- Create: `components/ProductIdentityCard.tsx`, `components/CostProfitStrip.tsx`, `components/QcSummaryCard.tsx`
- Delete: `components/ProductInfo.tsx`; แก้ `__tests__/ProductInfo.cost.test.tsx` → `CostProfitStrip.test.tsx` (เงื่อนไข canSeeCost เดิม) + `ProductIdentityCard.test.tsx` (มือสองโชว์แถบ 6 มุมจาก `/products/:id/photos`, ช่องว่างเป็น "—", ปุ่มคัดลอก IMEI เรียก copy)
- Modify: `components/QcResultsCard.tsx` → export รายการเป็น `QcResultsList` ใช้ใน Dialog ของ `QcSummaryCard`

- [ ] เทสล้ม → implement → รัน → commit `feat(web): การ์ดข้อมูลเครื่อง + แถบทุน/กำไร + QC ย่อ`

---

### Task 10: web — `SellingPriceCard` ใหม่ + `ContractSummaryCard`

**Files:**
- Modify: `components/SellingPriceCard.tsx` (+ props `readiness`, `legacyPrices`, ลิงก์ไปแท็บขึ้นเว็บ `onGoOnline`) + `__tests__/SellingPriceCard.test.tsx`
- Create: `components/ContractSummaryCard.tsx` + test (โชว์เลขที่/ลูกค้า/งวดละ/ชำระแล้ว k/N/งวดถัดไป · ปุ่มไป `/contracts/:id`)

- [ ] เทสล้ม → implement → รัน → commit `feat(web): การ์ดราคาขาย (สถานะขึ้นเว็บ · ราคาระบบเดิม) + การ์ดสัญญา`

---

### Task 11: web — สรุปส่งลูกค้าใช้ค่าที่เลือก + เรทที่ 1/2

**Files:**
- Modify: `utils/buildCustomerSummary.ts` (+test): `installment` → `rate1?: { months, downAmount, monthlyPayment } | null`, `rate2?: … | null`; บรรทัด `formatRateLine(1|2, …)` · ตัดบรรทัดเมื่อ null/NaN
- Modify: `hooks/useCustomerSummary.ts` — รับ `{ product, calcState, bcConfig, gfinTables }` คำนวณ rate1 จาก `buildBcQuote` (fallback `computeDefaultBcInstallment`) และ rate2 จาก `buildGfinQuote` เมื่อ available; `__tests__/useCustomerSummary.test.ts` ปรับ

- [ ] เทสล้ม (ข้อความใหม่ `เรทที่ 1 ดาวน์ 2,985 บาท ผ่อนเดือนละ 2,413.21 บาท 12 งวด`) → implement → รัน → commit `feat(web): สรุปส่งลูกค้าใช้ค่าที่เลือก + บรรทัดเรทที่ 2`

---

### Task 12: web — `index.tsx` โครงหน้าใหม่ + header actions

**Files:**
- Create: `components/ProductHeaderActions.tsx` (+test: พร้อมขาย → ปุ่มหลัก "คัดลอกสรุปส่งลูกค้า" + เมนู ⋯ มี "โอนสาขา" เมื่อ manager · ขายผ่อน → ปุ่มหลัก "เปิดสัญญา CT-…" ไม่มีคัดลอกสรุป · ไม่มีปุ่ม "กลับ")
- Modify: `index.tsx` — grid `lg:grid-cols-[minmax(0,1fr)_420px]`, ขวา `lg:sticky lg:top-[76px] self-start order-first lg:order-none`, ต่อ state/hook ทั้งหมด, ซ่อนโปร/เครื่องคำนวณเมื่อขาย, ลบ import ProductInfo/ReturnToStock ปุ่มย้ายเข้า header actions
- Modify: `components/layout/TopBar.tsx` map เพิ่ม `'/products': NAV_LABELS.stock` (+ เทสถ้ามี `TopBar.test.tsx`)

- [ ] implement → `npx vitest run src/pages/ProductDetailPage src/components/layout` PASS → commit `feat(web): หน้ารายละเอียดสินค้าแนว A 2 คอลัมน์ + TopBar breadcrumb`

---

### Task 13: ตรวจรวม + PR

- [ ] `./tools/check-types.sh all` → 0 errors
- [ ] `cd apps/web && npx eslint src/pages/ProductDetailPage src/pages/GfinConfigPage src/components/layout/TopBar.tsx` · `cd apps/api && npx eslint "src/modules/gfin-config/**/*.ts" "src/modules/products/**/*.ts" "src/modules/shop-catalog/**/*.ts"` · `cd packages/shared && npx eslint src/`
- [ ] เทสทั้งชุด: `cd packages/shared && npx vitest run` · `cd apps/web && npx vitest run` · `cd apps/api && npx jest src/modules/gfin-config src/modules/products src/modules/shop-catalog --runInBand`
- [ ] ดูของจริง: vite ตัวที่สอง + mock API (ตามเมโมรี่ local-dev) หรือ dev DB ถ้ามี — จับภาพหน้า (พร้อมขาย · GFIN · ขายผ่อน · SALES)
- [ ] bump `apps/web/package.json` version (YY.M.ลำดับถัดไปจาก origin/main)
- [ ] `git push -u origin worktree-feat-product-detail-redesign` → `gh pr create` (ไทย: สรุป · ภาพ · จุดที่ต้อง veto: ข้อความบรรทัดผ่อน "เรทที่ 1/2" · migration ต้องรันบน prod · เจ้าของต้องกรอกตาราง 15 ส.ค. 2569 / maxMonths / เรทคอม 5 ผ่านตั้งค่า)
