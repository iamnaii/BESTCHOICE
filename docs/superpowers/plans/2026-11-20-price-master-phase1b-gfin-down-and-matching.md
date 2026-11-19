# ช่วง 1ข — เรท 2 (GFIN): ดาวน์ขั้นต่ำตามกติกา OVER · ปัดดาวน์ลูกค้า · จับคู่ชื่อรุ่นตรงทั้งคำ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** เรท 2 (GFIN) ให้ดาวน์และค่างวดเท่าชีต MASTER ทุกหน้าจอ — ดาวน์ขั้นต่ำมาจากกติกา OVER ของรุ่น (ไม่มีแล้วใช้ค่าตั้ง GFIN) · ดาวน์ที่ลูกค้าจ่ายปัดขึ้นหลักร้อย · รุ่นที่ใบราคาไม่มี (เช่น iPhone 13 Pro มือ 1) ไม่ไปได้ราคาของรุ่นที่ชื่อสั้นกว่า

**Architecture:** กติกาทั้งสามอยู่ใน `packages/shared` ที่เดียว — `GfinOverpriceRuleRow.minDownPct` + `resolveGfinDownPct` (เลือก % ดาวน์ขั้นต่ำ) · `calcGfinInstallment` ปัด `downAmountActual` ด้วย `roundUpToStep` · `findGfinMapping` จับชื่อรุ่นตรงทั้งคำก่อน แล้วผู้เรียกเรท 2 ทั้งสองทาง (เว็บ `buildGfinQuote` ผ่าน `resolveQuotes` ซึ่งสติกเกอร์ใช้ด้วย · API `installment-preview.service.ts` ของเว็บ shop) ส่ง % จาก `resolveGfinDownPct` แทนค่าตั้ง `gfin.minDownPct` ตรง ๆ (ค่าตั้งยังเป็นค่าถอยเมื่อกติกาไม่ได้กำหนด) · คอลัมน์ใหม่ `gfin_overprice_rules.min_down_pct` แก้ได้ในแท็บ "ส่วนเพิ่มราคา" (OVER) ของหน้าตั้งค่า GFIN

**Tech Stack:** TypeScript · decimal.js · vitest (`packages/shared`, `apps/web`) · jest + ts-jest (`apps/api`) · NestJS + Prisma (PostgreSQL) · React + TanStack Query

สเปค: `docs/superpowers/specs/2026-11-19-price-master-retire-design.md` ข้อ 3.3, 3.4, 4.3, 4.5 (คอลัมน์เรท 2), 7.8, 7.10 (`min_down_pct`), 10, แถวช่วง 1 ของข้อ 11
สัญญาชื่อ/ชนิด: `docs/superpowers/plans/2026-11-20-price-master-contracts.md` หัวข้อ "Global constraints" และ "Phase 1b"
แผนก่อนหน้า: `docs/superpowers/plans/2026-11-19-price-master-phase1a-bc-rounding-rate-parity.md` (1ก — เรท 1 + สัญญา · ขึ้นระบบแล้วใน #1798)

## Global Constraints

(คัดจากสัญญาชื่อ — ใช้กับทุกช่วง)

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
- Migrations: Prisma, add-column only, nullable, folder `apps/api/prisma/migrations/<timestamp>_<name>/migration.sql`.

เฉพาะช่วงนี้:

- ทำใน worktree `D:\BESTCHOICE APP\BESTCHOICE\.worktrees\price-master-rest` บน branch `feat/price-master-rest` (ช่วง 2–4 ต่อบน branch เดียวกัน)
- `calcGfinInstallment`: เปลี่ยนเฉพาะ `downAmountActual` — `downAmountByFormula` (ดาวน์ที่แจ้ง GFIN) และ `financedAmount` = ราคาส่ง − `downAmountByFormula` **ไม่ปัด** · `shopTotalReceived` ใช้ `downAmountActual` ที่ปัดแล้ว · ค่าตั้งต้น `downPct` 0.30 เมื่อผู้เรียกไม่ส่ง คงเดิม
- ค่าตั้ง `gfin.minDownPct` (`loadGfinSettings` / `GfinSettingsApi.minDownPct`) **คงอยู่** เป็นค่าถอยเมื่อกติกา OVER ไม่ได้ตั้ง `minDownPct`
- `apps/api` ใช้ ts-jest ที่ตรวจชนิด — ไฟล์ spec ที่ประกาศ `GfinOverpriceRuleRow` ต้องมี `minDownPct` ไม่งั้นคอมไพล์ไม่ผ่าน
- ห้ามแก้ปุ่มลบที่ใช้ `confirm(...)` เดิมใน `OverpriceRulesTab.tsx` ในงานนี้ (นอกขอบเขต — ไม่เพิ่มของใหม่ที่ใช้ `confirm`)

## ตัวเลขอ้างอิง

### ตัวเลขตรวจจากชีต MASTER (2026-11-19 · กรณีเครื่องไทย · เรท GFIN 10 งวด 0.201 · 12 งวด 0.17 · 15 งวด 0.1467 · ค่าธรรมเนียม 100/งวด · คอม 15% · ค่าทำสัญญา 100)

ราคาส่ง = ใบราคา + OVER · ดาวน์ที่แจ้ง = ราคาส่ง × % · ดาวน์ลูกค้า = ปัดขึ้นหลักร้อย(ดาวน์ที่แจ้ง − (ราคาส่ง − ราคาขาย GFIN)) ต่ำสุด 0 · ค่างวด = ceil(ยอดจัด × เรท) + 100

| รุ่น | สภาพ | ใบราคา | OVER | งวด | ดาวน์ % | ราคาขาย GFIN | ดาวน์ที่แจ้ง | ก่อนปัด | ดาวน์ลูกค้า | ยอดจัด | ค่างวด |
|---|---|---|---|---|---|---|---|---|---|---|---|
| iPhone 15 128GB | มือ 1 | 24,900 | 1,000 | 12 | 25 | 25,900 | 6,475 | 6,475 | **6,500** | 19,425 | **3,403** |
| iPhone 16 128GB | มือ 1 | 26,900 | 2,000 | 15 | 25 | 28,900 | 7,225 | 7,225 | **7,300** | 21,675 | **3,280** |
| iPhone 17 256GB | มือ 1 | 29,900 | 2,000 | 15 | 30 | 31,900 | 9,570 | 9,570 | **9,600** | 22,330 | **3,376** |
| iPhone 17 Pro 256GB | มือ 1 | 39,900 | 2,000 | 15 | 30 | 39,000 | 12,570 | 9,670 | **9,700** | 29,330 | **4,403** |
| iPhone 13 128GB | มือ 2 | 12,900 | 0 | 12 | 25 | 9,600 | 3,225 | 0 | **0** | 9,675 | **1,745** |
| iPhone 13 Pro 128GB | มือ 2 | 15,900 | 0 | 12 | 25 | 11,900 | 3,975 | 0 | **0** | 11,925 | **2,128** |
| iPhone 14 Pro 128GB | มือ 2 | 18,900 | 2,000 | 12 | 25 | 15,600 | 5,225 | 0 | **0** | 15,675 | **2,765** |
| iPhone 16 Plus 128GB | มือ 2 | 23,900 | 2,000 | 15 | 25 | 22,300 | 6,475 | 2,875 | **2,900** | 19,425 | **2,950** |
| iPhone 12 64GB | มือ 2 | — | — | — | — | 6,700 | GFIN ไม่รับ | | | | |
| iPhone 13 Pro 128GB | มือ 1 | — (มีแต่ iPhone 13 128GB มือ 1 = 14,900) | | | | | GFIN ไม่รับ | | | | |

ทุกแถวตรงคอลัมน์ X (ดาวน์ GFIN ลูกค้าจ่าย) และ Y (ผ่อน GFIN /เดือน) ของแท็บ "ข้อมูลหลัก มือ 1/2" — ตรวจด้วย Decimal แล้ว

### ค่าคาดหวังในเทสต์เดิมที่เปลี่ยนเพราะการปัด (Task 2)

| ไฟล์ | assertion | เดิม | ใหม่ |
|---|---|---|---|
| `packages/shared/src/installment-calc.gfin.test.ts` | canonical `downAmountActual` (6,750 − 2,600) | `'4150.00'` | `'4200.00'` |
| `apps/api/src/utils/installment-calc.util.spec.ts` | `downAmountActual` (3,450 − 1,500) | `'1950.00'` | `'2000.00'` |
| `apps/api/src/modules/shop-catalog/installment-preview.service.spec.ts` | GFIN canonical `downAmount` | `4150` | `4200` |
| `apps/web/src/pages/ProductDetailPage/utils/gfinQuote.test.ts` | เครื่องนอก `downAmountActual` (5,875 − 3,600) | `2275` | `2300` |
| `tools/verify-shared-runtime.cjs` (smoke นอก CI) | GFIN `downAmountActual` | `'4150.00'` | `'4200.00'` |

ค่าที่ลงหลักร้อยอยู่แล้ว (1,900 · 6,000 · 3,600 · 4,500 · 0) **ต้องไม่เปลี่ยน** — ถ้าล้ม แปลว่าโค้ดปัดผิดที่
(`financedAmount`, `downAmountByFormula`, `monthlyPayment` ต้องไม่เปลี่ยนในเทสต์ไหนเลย)

---

### Task 1: คอลัมน์ `min_down_pct` + API กติกา OVER รับ/คืน `minDownPct`

**Files:**
- Create: `apps/api/prisma/migrations/20261120000000_gfin_overprice_rule_min_down_pct/migration.sql`
- Modify: `apps/api/prisma/schema.prisma:9241` (model `GfinOverpriceRule` — ต่อจากบรรทัด `maxMonths`)
- Modify: `apps/api/src/modules/gfin-config/dto/overprice-rule.dto.ts` (ทั้งสองคลาส ต่อจาก `maxMonths`)
- Modify: `apps/api/src/modules/gfin-config/gfin-config.service.ts:112-121` (`createOverpriceRule`), `:137-143` (`updateOverpriceRule`)
- Create: `apps/api/src/modules/gfin-config/dto/overprice-rule.dto.spec.ts`
- Modify: `apps/api/src/modules/gfin-config/gfin-config.service.spec.ts` (เพิ่ม describe ต่อจาก `describe('overprice rule — maxMonths'` ที่จบบรรทัด 337)

**Interfaces:**
- Consumes: ไม่มี
- Produces:
  - Prisma `GfinOverpriceRule.minDownPct: number | null` (`@map("min_down_pct")`)
  - `CreateOverpriceRuleDto.minDownPct?: number | null` · `UpdateOverpriceRuleDto.minDownPct?: number | null` — จำนวนเต็ม 0–80 (เท่าช่วงของค่าตั้ง `gfin.minDownPct`) · `null` = ใช้ค่าตั้ง
  - `GET /gfin-config/overprice-rules` คืน `minDownPct` ในทุกแถว (findMany คืนทุกคอลัมน์อยู่แล้ว)

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน**

`apps/api/src/modules/gfin-config/dto/overprice-rule.dto.spec.ts`:

```ts
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateOverpriceRuleDto, UpdateOverpriceRuleDto } from './overprice-rule.dto';

const base = { label: 'iPhone 17 มือ 1', seriesPattern: 'iPhone 17', condition: 'HAND_1', allowance: 2000 };

describe('OverpriceRule DTO — minDownPct (ดาวน์ขั้นต่ำ % ของกลุ่มรุ่น)', () => {
  it.each([undefined, null, 0, 30, 80])('รับ %p', (minDownPct) => {
    expect(validateSync(plainToInstance(CreateOverpriceRuleDto, { ...base, minDownPct }))).toHaveLength(0);
    expect(validateSync(plainToInstance(UpdateOverpriceRuleDto, { minDownPct }))).toHaveLength(0);
  });

  it.each([-1, 81, 30.5])('ปฏิเสธ %p', (minDownPct) => {
    expect(validateSync(plainToInstance(CreateOverpriceRuleDto, { ...base, minDownPct })).length).toBeGreaterThan(0);
    expect(validateSync(plainToInstance(UpdateOverpriceRuleDto, { minDownPct })).length).toBeGreaterThan(0);
  });
});
```

ใน `apps/api/src/modules/gfin-config/gfin-config.service.spec.ts` เพิ่มต่อจาก `describe('overprice rule — maxMonths', ...)` (ก่อนคอมเมนต์ `// ===== ค่าตั้งค่า GFIN`):

```ts
  describe('overprice rule — minDownPct', () => {
    it('createOverpriceRule ส่ง minDownPct · ไม่ส่ง = null (ใช้ค่าตั้ง gfin.minDownPct)', async () => {
      prisma.gfinOverpriceRule.create.mockResolvedValue({ id: 'r9' });

      await service.createOverpriceRule(
        {
          label: 'iPhone 17 มือ 1',
          seriesPattern: 'iPhone 17|iPhone 17 Pro|iPhone 17 Pro Max|iPhone Air',
          condition: 'HAND_1',
          allowance: 2000,
          maxMonths: 15,
          minDownPct: 30,
        },
        'user-1',
      );
      expect(prisma.gfinOverpriceRule.create).toHaveBeenLastCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ minDownPct: 30 }) }),
      );

      await service.createOverpriceRule(
        { label: 'iPhone 16 มือ 1', seriesPattern: 'iPhone 16', condition: 'HAND_1', allowance: 2000 },
        'user-1',
      );
      expect(prisma.gfinOverpriceRule.create).toHaveBeenLastCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ minDownPct: null }) }),
      );
    });

    it('updateOverpriceRule ตั้ง/ล้าง minDownPct ได้ · ไม่ส่งมา = ไม่แตะ', async () => {
      prisma.gfinOverpriceRule.findUnique.mockResolvedValue({ id: 'r1', deletedAt: null });
      prisma.gfinOverpriceRule.update.mockResolvedValue({ id: 'r1' });

      await service.updateOverpriceRule('r1', { minDownPct: 30 }, 'user-1');
      expect(prisma.gfinOverpriceRule.update).toHaveBeenLastCalledWith({
        where: { id: 'r1' },
        data: { minDownPct: 30 },
      });

      await service.updateOverpriceRule('r1', { minDownPct: null }, 'user-1');
      expect(prisma.gfinOverpriceRule.update).toHaveBeenLastCalledWith({
        where: { id: 'r1' },
        data: { minDownPct: null },
      });

      await service.updateOverpriceRule('r1', { label: 'iPhone 17 มือ 1 (30%)' }, 'user-1');
      expect(prisma.gfinOverpriceRule.update).toHaveBeenLastCalledWith({
        where: { id: 'r1' },
        data: { label: 'iPhone 17 มือ 1 (30%)' },
      });
    });
  });
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**

Run: `NODE_OPTIONS=--max-old-space-size=12288 npm --prefix apps/api test -- src/modules/gfin-config`
Expected: FAIL — `gfin-config.service.spec.ts` คอมไพล์ไม่ผ่าน (ts-jest: `Object literal may only specify known properties, and 'minDownPct' does not exist in type 'CreateOverpriceRuleDto'`) · `overprice-rule.dto.spec.ts` กรณี "ปฏิเสธ -1 / 81 / 30.5" ล้ม (`expected 0 to be greater than 0`)

- [ ] **Step 3: เขียนโค้ด**

`apps/api/prisma/migrations/20261120000000_gfin_overprice_rule_min_down_pct/migration.sql`:

```sql
-- GFIN: ดาวน์ขั้นต่ำ % ของกลุ่มรุ่น (เต็มร้อย: 30 = 30%) — null = ใช้ค่าตั้ง gfin.minDownPct (สเปค price-master-retire ข้อ 3.3)
ALTER TABLE "gfin_overprice_rules" ADD COLUMN "min_down_pct" INTEGER;
```

`apps/api/prisma/schema.prisma` — ใน `model GfinOverpriceRule` เพิ่มต่อจากบรรทัด `maxMonths     Int?          @map("max_months")`:

```prisma
  /// ดาวน์ขั้นต่ำ % ของกลุ่มรุ่นนี้ (เต็มร้อย: 30 = 30%) — null = ใช้ค่าตั้ง gfin.minDownPct (iPhone 17 / 18 / Air = 30 ตามชีต MASTER)
  minDownPct    Int?          @map("min_down_pct")
```

`apps/api/src/modules/gfin-config/dto/overprice-rule.dto.ts` — เพิ่มในทั้ง `CreateOverpriceRuleDto` และ `UpdateOverpriceRuleDto` ต่อจาก property `maxMonths` (decorator ชุดเดียวกันทั้งสองคลาส):

```ts
  /** ดาวน์ขั้นต่ำ % ของกลุ่มรุ่นนี้ (เต็มร้อย) — null/ไม่ส่ง = ใช้ค่าตั้ง gfin.minDownPct · ช่วงเดียวกับค่าตั้ง (0–80) */
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsInt()
  @Min(0)
  @Max(80)
  minDownPct?: number | null;
```

`apps/api/src/modules/gfin-config/gfin-config.service.ts` — `createOverpriceRule` บล็อก `data:` เพิ่มต่อจาก `maxMonths: dto.maxMonths ?? null,`:

```ts
        minDownPct: dto.minDownPct ?? null,
```

`updateOverpriceRule` เพิ่มต่อจาก `if (dto.maxMonths !== undefined) data.maxMonths = dto.maxMonths;`:

```ts
    if (dto.minDownPct !== undefined) data.minDownPct = dto.minDownPct;
```

แล้วสร้าง Prisma client ใหม่ (หยุด API dev server ก่อน — Windows ล็อกไฟล์ engine):

```bash
cd apps/api && npx prisma validate && npx prisma generate && cd ../..
```

Expected: `The schema at prisma/schema.prisma is valid 🚀` และ `Generated Prisma Client`

- [ ] **Step 4: รันให้ผ่าน**

Run: `NODE_OPTIONS=--max-old-space-size=12288 npm --prefix apps/api test -- src/modules/gfin-config`
Expected: PASS ทุกไฟล์ในโฟลเดอร์ (DTO spec 8 กรณี · service spec เพิ่ม 2 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/prisma/migrations/20261120000000_gfin_overprice_rule_min_down_pct/migration.sql apps/api/prisma/schema.prisma apps/api/src/modules/gfin-config/dto/overprice-rule.dto.ts apps/api/src/modules/gfin-config/dto/overprice-rule.dto.spec.ts apps/api/src/modules/gfin-config/gfin-config.service.ts apps/api/src/modules/gfin-config/gfin-config.service.spec.ts
git commit -m "feat(gfin-config): per-rule minimum GFIN down payment percent" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: shared — `minDownPct` ในแถวกติกา · `resolveGfinDownPct` · ดาวน์ลูกค้าปัดขึ้นหลักร้อย

**Files:**
- Modify: `packages/shared/src/installment-calc.types.ts:55-64` (`GfinOverpriceRuleRow`), `:119-120` (คอมเมนต์ `downAmountActual`)
- Modify: `packages/shared/src/installment-calc.ts:2` (import), `:104` (`downAmountActual`), เพิ่ม `resolveGfinDownPct` ต่อจาก `gfinAllowanceFactor` (`:157-160`)
- Modify: `packages/shared/src/index.ts:12-19` (รายการ export จาก `./installment-calc`)
- Modify: `packages/shared/src/installment-calc.gfin.test.ts`
- Modify: `apps/api/src/modules/shop-catalog/installment-preview.service.ts:167-175` (`ruleObjects` — ชนิดตาม)
- Modify: `apps/api/src/modules/shop-catalog/installment-preview.service.spec.ts:156`
- Modify: `apps/api/src/utils/installment-calc.util.spec.ts:145-153`, `:178`, `:282-290`
- Modify: `apps/web/src/pages/ProductDetailPage/utils/gfinQuote.ts:27-35` (`OverpriceApi`), `:114-116` (`toRuleRow`)
- Modify: `apps/web/src/pages/ProductDetailPage/utils/gfinQuote.test.ts:86`
- Modify: `tools/verify-shared-runtime.cjs:51-52,67`

**Interfaces:**
- Consumes: `roundUpToStep` จาก `packages/shared/src/installment-rounding.ts` (1ก) · Prisma `GfinOverpriceRule.minDownPct` จาก Task 1
- Produces:
  - `GfinOverpriceRuleRow.minDownPct: number | null`
  - `resolveGfinDownPct(rule: GfinOverpriceRuleRow | null, settingMinDownPct: Decimal): Decimal` (export จาก `@installment/shared`)
  - `calcGfinInstallment(...).downAmountActual` = `roundUpToStep(max(downAmountByFormula − downDiscount, 0))` · signature เดิม
  - เว็บ `OverpriceApi.minDownPct?: number | null`

- [ ] **Step 1: แก้/เพิ่มเทสต์ shared (ยังไม่ผ่าน)**

ใน `packages/shared/src/installment-calc.gfin.test.ts`:

1. import เพิ่ม `resolveGfinDownPct` ในบล็อก `from './installment-calc'` (บรรทัด 3-8):

```ts
import {
  calcGfinInstallment,
  findGfinMapping,
  findGfinOverpriceRule,
  findGfinRateFactor,
  resolveGfinDownPct,
} from './installment-calc';
```

2. เพิ่ม `minDownPct: null,` ต่อจาก `maxMonths: ...` ในแถวกติกาที่ประกาศชนิด `GfinOverpriceRuleRow`: `overpriceIphone14Hand2` (บรรทัด 34), `over15h1` (บรรทัด 181), `over16h2` (บรรทัด 384 — อยู่ใน describe), `broad` (บรรทัด 453 — อยู่ใน describe) — ตัวที่ spread จากสี่ตัวนี้ (`specific` ฯลฯ) ได้ค่าไปเอง ·
   เทสต์ใหม่ในข้อ 4 อ้างได้เฉพาะตัวที่ประกาศระดับไฟล์ (`mapping14Pro128`, `factor12`, `over15h1`)

3. `describe('calcGfinInstallment — canonical worked example'` แก้ `it('downAmountActual = 4,150', ...)` เป็น:

```ts
  it('downAmountActual = 4,200 (6,750 − 2,600 = 4,150 ปัดขึ้นหลักร้อย)', () => {
    expect(out.downAmountActual.toFixed(2)).toBe('4200.00');
  });
```

4. ต่อท้ายไฟล์:

```ts
describe('resolveGfinDownPct — ดาวน์ขั้นต่ำ: กติกา OVER ก่อน ไม่มีแล้วค่าตั้ง (สเปค 3.3)', () => {
  const setting = new Decimal('0.25');

  it('กติกาตั้ง 30 → 0.3', () => {
    expect(resolveGfinDownPct({ ...over15h1, minDownPct: 30 }, setting).toString()).toBe('0.3');
  });

  it('กติกาไม่ตั้ง (null) หรือไม่มีกติกา → ค่าตั้ง', () => {
    expect(resolveGfinDownPct(over15h1, setting).toString()).toBe('0.25');
    expect(resolveGfinDownPct(null, setting).toString()).toBe('0.25');
  });

  it('0 เป็นค่าที่ตั้งจริง ไม่ถอยไปค่าตั้ง', () => {
    expect(resolveGfinDownPct({ ...over15h1, minDownPct: 0 }, setting).toString()).toBe('0');
  });
});

describe('calcGfinInstallment — ดาวน์ลูกค้าปัดขึ้นหลักร้อย (ชีต MASTER 2026-11-19 · เครื่องไทย)', () => {
  const factor15m: GfinRateFactorRow = {
    months: 15,
    shopCommissionPct: 15,
    factor: new Decimal('0.1467'),
    feePerInstallment: new Decimal('100'),
    isActive: true,
  };

  it('iPhone 16 Plus 128GB มือ 2: 6,475 − 3,600 = 2,875 → 2,900 · ยอดจัดยังคิดจากดาวน์ที่แจ้ง 6,475 · 2,950 × 15', () => {
    const o = calcGfinInstallment({
      installmentPrice: new Decimal('22300'),
      product: { brand: 'Apple', model: 'iPhone 16 Plus', storage: '128GB', category: 'PHONE_USED' },
      months: 15,
      downPct: new Decimal('0.25'),
      mapping: {
        id: 'm16plus',
        gfinSeries: 'iPhone 16 Plus',
        gfinVariant: null,
        storage: '128GB',
        condition: 'HAND_2',
        maxPrice: new Decimal('23900'),
        modelMatchPattern: 'iPhone 16 Plus',
        isActive: true,
      },
      overpriceRule: {
        id: 'r16plus-h2',
        label: 'iPhone 16 Plus มือ 2',
        seriesPattern: 'iPhone 16 Plus',
        condition: 'HAND_2',
        allowance: new Decimal('2000'),
        maxMonths: 15,
        minDownPct: null,
        isActive: true,
      },
      rateFactor: factor15m,
      deviceOrigin: 'THAI',
    });
    expect(o.gfinSubmitPrice.toFixed(2)).toBe('25900.00');
    expect(o.downAmountByFormula.toFixed(2)).toBe('6475.00');
    expect(o.downAmountActual.toFixed(2)).toBe('2900.00');
    expect(o.financedAmount.toFixed(2)).toBe('19425.00');
    expect(o.monthlyPayment.toFixed(2)).toBe('2950.00');
    // ร้านรับรวม = ดาวน์ที่ปัดแล้ว + (19,425 + คอม 2,913.75 − ค่าทำสัญญา 100)
    expect(o.netTransferToShop.toFixed(2)).toBe('22238.75');
    expect(o.shopTotalReceived.toFixed(2)).toBe('25138.75');
  });

  it('iPhone 17 Pro 256GB มือ 1 กติกา 30%: 12,570 − 2,900 = 9,670 → 9,700 · 4,403 × 15', () => {
    const rule17: GfinOverpriceRuleRow = {
      id: 'r17',
      label: 'iPhone 17 มือ 1',
      seriesPattern: 'iPhone 17|iPhone 17 Pro|iPhone 17 Pro Max|iPhone Air',
      condition: 'HAND_1',
      allowance: new Decimal('2000'),
      maxMonths: 15,
      minDownPct: 30,
      isActive: true,
    };
    const o = calcGfinInstallment({
      installmentPrice: new Decimal('39000'),
      product: { brand: 'Apple', model: 'iPhone 17 Pro', storage: '256GB', category: 'PHONE_NEW' },
      months: 15,
      downPct: resolveGfinDownPct(rule17, new Decimal('0.25')),
      mapping: {
        id: 'm17p',
        gfinSeries: 'iPhone 17 Pro',
        gfinVariant: null,
        storage: '256GB',
        condition: 'HAND_1',
        maxPrice: new Decimal('39900'),
        modelMatchPattern: 'iPhone 17 Pro',
        isActive: true,
      },
      overpriceRule: rule17,
      rateFactor: factor15m,
      deviceOrigin: 'THAI',
    });
    expect(o.downAmountByFormula.toFixed(2)).toBe('12570.00');
    expect(o.downAmountActual.toFixed(2)).toBe('9700.00');
    expect(o.monthlyPayment.toFixed(2)).toBe('4403.00');
  });

  it('ส่วนลดมากกว่าดาวน์ → 0 (ไม่ปัดเป็น 100)', () => {
    const o = calcGfinInstallment({
      installmentPrice: new Decimal('9600'),
      product: { brand: 'Apple', model: 'iPhone 13', storage: '128GB', category: 'PHONE_USED' },
      months: 12,
      downPct: new Decimal('0.25'),
      mapping: { ...mapping14Pro128, id: 'm13', gfinSeries: 'iPhone 13', gfinVariant: null, maxPrice: new Decimal('12900'), modelMatchPattern: 'iPhone 13' },
      overpriceRule: null,
      rateFactor: { ...factor12, factor: new Decimal('0.17') },
      deviceOrigin: 'THAI',
    });
    expect(o.downAmountActual.toFixed(2)).toBe('0.00');
    expect(o.monthlyPayment.toFixed(2)).toBe('1745.00');
  });
});
```

- [ ] **Step 2: แก้เทสต์ที่ค่าคาดหวังเปลี่ยนในแอปอื่น (ยังไม่ผ่าน)**

`apps/api/src/utils/installment-calc.util.spec.ts`:
- `const overpriceRule: GfinOverpriceRuleRow = {` (บรรทัด 145) และ `const rule: GfinOverpriceRuleRow = {` (บรรทัด 282): เพิ่ม `minDownPct: null,` ต่อจาก `maxMonths: null,`
- บรรทัด 178 แก้เป็น:

```ts
    expect(r.downAmountActual.toFixed(2)).toBe('2000.00'); // max(3450 - 1500, 0) = 1950 → ปัดขึ้นหลักร้อย
```

`apps/api/src/modules/shop-catalog/installment-preview.service.spec.ts` บรรทัด 156 แก้เป็น:

```ts
    expect(result.downAmount).toBeCloseTo(4200, 2); // downAmountActual = 6750 − 2600 = 4150 → ปัดขึ้นหลักร้อย
```

`apps/web/src/pages/ProductDetailPage/utils/gfinQuote.test.ts` บรรทัด 86 แก้เป็น:

```ts
    expect(imported.result.downAmountActual.toNumber()).toBe(2300); // 5,875 − 3,600 = 2,275 → ปัดขึ้นหลักร้อย
```

- [ ] **Step 3: รันให้เห็นว่าล้ม**

Run: `npm --prefix packages/shared test -- src/installment-calc.gfin.test.ts`
Expected: FAIL — `resolveGfinDownPct is not a function` (หรือ `does not provide an export named 'resolveGfinDownPct'`) และ `expected '4150.00' to be '4200.00'`

Run: `cd apps/web && npx vitest run src/pages/ProductDetailPage/utils/gfinQuote.test.ts && cd ../..`
Expected: FAIL — `expected 2275 to be 2300`

- [ ] **Step 4: เขียนโค้ด shared**

`packages/shared/src/installment-calc.types.ts` — `GfinOverpriceRuleRow` เพิ่มต่อจาก `maxMonths: number | null;`:

```ts
  /** ดาวน์ขั้นต่ำ % ของกลุ่มรุ่นนี้ (เต็มร้อย: 30 = 30%) · null = ใช้ค่าตั้ง gfin.minDownPct */
  minDownPct: number | null;
```

และแก้คอมเมนต์ของ `downAmountActual` (บรรทัด 119) เป็น:

```ts
  /** ดาวน์ที่ลูกค้าจ่ายจริง = ปัดขึ้นหลักร้อย(ดาวน์ตามสูตร − ส่วนลดดาวน์) ไม่ต่ำกว่า 0 (คำตัดสินเจ้าของ 2026-11-19) */
```

`packages/shared/src/installment-calc.ts`:

บรรทัด 2:

```ts
import { downFromPct, roundUpToStep } from './installment-rounding';
```

บรรทัด 104 (`const downAmountActual = ...`) แทนด้วย:

```ts
  // ดาวน์ลูกค้าปัดขึ้นหลักร้อย (คำตัดสินเจ้าของ 2026-11-19 · สเปค price-master-retire 4.3)
  // ยอดจัดยังคิดจากดาวน์ตามสูตรที่แจ้ง GFIN (ไม่ปัด) — การปัดเปลี่ยนแค่เงินที่ร้านเก็บจากลูกค้า
  const downAmountActual = roundUpToStep(Decimal.max(downAmountByFormula.sub(downDiscount), 0));
```

เพิ่มต่อจากฟังก์ชัน `gfinAllowanceFactor`:

```ts
/**
 * ดาวน์ขั้นต่ำ GFIN เป็นสัดส่วน (0.30) — กติกา OVER ก่อน ไม่มีแล้วใช้ค่าตั้ง (settingMinDownPct เป็นสัดส่วน เช่น 0.25)
 * ใช้ตั้ง 30% ให้ iPhone 17 / 18 / Air ตามชีต MASTER (สเปค 3.3) · 0 = ตั้งเป็น 0% จริง ไม่ถอยไปค่าตั้ง
 */
export function resolveGfinDownPct(rule: GfinOverpriceRuleRow | null, settingMinDownPct: Decimal): Decimal {
  if (rule?.minDownPct != null) return new Decimal(rule.minDownPct).div(100);
  return settingMinDownPct;
}
```

`packages/shared/src/index.ts` — รายการ export จาก `./installment-calc` เพิ่ม `resolveGfinDownPct,` ต่อจาก `gfinAllowanceFactor,`:

```ts
export {
  calcBcInstallment,
  calcGfinInstallment,
  findGfinMapping,
  findGfinOverpriceRule,
  findGfinRateFactor,
  gfinAllowanceFactor,
  resolveGfinDownPct,
} from './installment-calc';
```

- [ ] **Step 5: ชนิดตามในผู้แปลงแถวกติกา (API + เว็บ)**

`apps/api/src/modules/shop-catalog/installment-preview.service.ts` — ใน `ruleObjects` (บรรทัด 167-175) เพิ่มต่อจาก `maxMonths: r.maxMonths ?? null,`:

```ts
      minDownPct: r.minDownPct ?? null,
```

`apps/web/src/pages/ProductDetailPage/utils/gfinQuote.ts` — `OverpriceApi` เพิ่มต่อจาก `maxMonths?: number | null;`:

```ts
  /** ดาวน์ขั้นต่ำ % ของกลุ่มรุ่น (เต็มร้อย) — null/ไม่มี = ใช้ค่าตั้ง GFIN */
  minDownPct?: number | null;
```

และ `toRuleRow` (บรรทัด 114-116) แทนด้วย:

```ts
function toRuleRow(r: OverpriceApi): GfinOverpriceRuleRow {
  return {
    ...r,
    allowance: new Decimal(r.allowance),
    maxMonths: r.maxMonths ?? null,
    minDownPct: r.minDownPct ?? null,
  };
}
```

`tools/verify-shared-runtime.cjs` (smoke Node 24 นอก CI — ตัวเลขค้างมาตั้งแต่ 1ก):
- บรรทัด 51: `'2413.20'` → `'2411.06'` · บรรทัด 52: `'28958.48'` → `'28932.80'` (ดาวน์ BC 2,985 → 3,000 จาก 1ก)
- บรรทัด 67: `'4150.00'` → `'4200.00'`

(ไม่ต้องรัน smoke นี้ในแผน — ต้อง build API ทั้งก้อนและ Node 24 · แก้เพื่อให้ตัวเลขไม่ค้าง)

- [ ] **Step 6: รันให้ผ่าน**

Run:
```bash
npm run build --workspace=packages/shared
npm --prefix packages/shared test
cd apps/web && npx vitest run src/pages/ProductDetailPage/utils && cd ../..
NODE_OPTIONS=--max-old-space-size=12288 npm --prefix apps/api test -- src/utils/installment-calc src/modules/shop-catalog/installment-preview
NODE_OPTIONS=--max-old-space-size=12288 ./tools/check-types.sh all
```
Expected: PASS ทั้งหมด (shared เพิ่ม 6 tests) · TypeScript 0 errors ทั้ง api และ web
ค่า 1,900 / 3,327 / 4,500 / 6,000 ในเทสต์อื่นต้องไม่เปลี่ยน

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/installment-calc.types.ts packages/shared/src/installment-calc.ts packages/shared/src/index.ts packages/shared/src/installment-calc.gfin.test.ts apps/api/src/modules/shop-catalog/installment-preview.service.ts apps/api/src/modules/shop-catalog/installment-preview.service.spec.ts apps/api/src/utils/installment-calc.util.spec.ts apps/web/src/pages/ProductDetailPage/utils/gfinQuote.ts apps/web/src/pages/ProductDetailPage/utils/gfinQuote.test.ts tools/verify-shared-runtime.cjs
git commit -m "feat(shared): GFIN customer down rounds up to 100 and per-rule minimum down percent" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: shared — `findGfinMapping` จับชื่อรุ่นตรงทั้งคำก่อน + ชุดตรวจจากชีต

**Files:**
- Modify: `packages/shared/src/installment-calc.ts:175-201` (`findGfinMapping`)
- Modify: `packages/shared/src/installment-calc.gfin.test.ts` (ต่อท้ายไฟล์)
- Create: `packages/shared/src/installment-calc.gfin-master.test.ts`

**Interfaces:**
- Consumes: `resolveGfinDownPct`, `roundUpToStep` (Task 2)
- Produces: `findGfinMapping(product, mappings)` signature เดิม — ถ้าแถวที่เปิดใช้แถวใดมี `modelMatchPattern` ตรงชื่อรุ่นทั้งคำ (ไม่สนตัวพิมพ์ · ตัดช่องว่างหัวท้าย · ไม่ดูสภาพ/ความจุ) → ใช้ได้เฉพาะแถวที่ตรงทั้งคำ ไม่มีแถวของสภาพ + ความจุนั้น = `null` · ไม่ตรงแถวใดเลย → กติกาเดิม (ชื่อรุ่นมีคำนี้ · ยาวสุดก่อน)
  ผู้เรียกที่ได้กติกาใหม่ไปพร้อมกันโดยไม่ต้องแก้: `gfinQuote.ts:144` · `installment-preview.service.ts:156` · `gfin-config.service.ts:304` (`matchPreview` — แท็บ "ทดสอบ จับคู่")

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน**

ต่อท้าย `packages/shared/src/installment-calc.gfin.test.ts`:

```ts
describe('findGfinMapping — ชื่อรุ่นตรงทั้งคำก่อน (สเปค 4.3)', () => {
  // ใบราคา G-Finn 16/10/2569: iPhone 13 128GB มือ 1 = 14,900 · มือ 2 = 12,900 · iPhone 13 Pro 128GB มีแต่มือ 2 = 15,900
  const m13h1: GfinModelMappingRow = {
    id: '13-h1',
    gfinSeries: 'iPhone 13',
    gfinVariant: null,
    storage: '128GB',
    condition: 'HAND_1',
    maxPrice: new Decimal('14900'),
    modelMatchPattern: 'iPhone 13',
    isActive: true,
  };
  const m13h2: GfinModelMappingRow = { ...m13h1, id: '13-h2', condition: 'HAND_2', maxPrice: new Decimal('12900') };
  const m13ProH2: GfinModelMappingRow = {
    ...m13h1,
    id: '13pro-h2',
    gfinSeries: 'iPhone 13 Pro',
    condition: 'HAND_2',
    maxPrice: new Decimal('15900'),
    modelMatchPattern: 'iPhone 13 Pro',
  };
  const sheet = [m13h1, m13h2, m13ProH2];
  const p = (model: string, category: ProductForGfin['category']): ProductForGfin => ({
    brand: 'Apple',
    model,
    storage: '128GB',
    category,
  });

  it('iPhone 13 Pro 128GB มือ 1 = GFIN ไม่รับ ทั้งที่มี iPhone 13 128GB มือ 1', () => {
    expect(findGfinMapping(p('iPhone 13 Pro', 'PHONE_NEW'), sheet)).toBeNull();
  });

  it('iPhone 13 Pro 128GB มือ 2 ได้แถวของตัวเอง · iPhone 13 128GB มือ 1 ยังได้แถว iPhone 13', () => {
    expect(findGfinMapping(p('iPhone 13 Pro', 'PHONE_USED'), sheet)?.id).toBe('13pro-h2');
    expect(findGfinMapping(p('iPhone 13', 'PHONE_NEW'), sheet)?.id).toBe('13-h1');
  });

  it('เทียบชื่อแบบไม่สนตัวพิมพ์และช่องว่างหัวท้าย', () => {
    expect(findGfinMapping(p('  iphone 13 pro ', 'PHONE_NEW'), sheet)).toBeNull();
    expect(findGfinMapping(p('  iphone 13 pro ', 'PHONE_USED'), sheet)?.id).toBe('13pro-h2');
  });

  it('ไม่มีแถวที่เปิดใช้ตั้งชื่อรุ่นนี้ → จับแบบเดิม (ชื่อรุ่นมีคำนี้)', () => {
    expect(findGfinMapping(p('iPhone 13 Pro', 'PHONE_NEW'), [m13h1, m13h2])?.id).toBe('13-h1');
    expect(
      findGfinMapping(p('iPhone 13 Pro', 'PHONE_NEW'), [m13h1, { ...m13ProH2, isActive: false }])?.id,
    ).toBe('13-h1');
  });
});
```

`packages/shared/src/installment-calc.gfin-master.test.ts`:

```ts
import Decimal from 'decimal.js';
import { describe, it, expect } from 'vitest';
import {
  calcGfinInstallment,
  findGfinMapping,
  findGfinOverpriceRule,
  findGfinRateFactor,
  resolveGfinDownPct,
} from './installment-calc';
import type {
  GfinCondition,
  GfinModelMappingRow,
  GfinOverpriceRuleRow,
  GfinRateFactorRow,
  ProductForGfin,
} from './installment-calc.types';

/**
 * ชุดตรวจเรท 2 จากชีต MASTER (2026-11-19) — แท็บ "ใบราคา G-Finn" + "ข้อมูลหลัก มือ 1/2" · กรณีเครื่องไทย
 * ใบราคาตั้งชื่อแบบนำเข้าใหม่ (สเปค 7.7): gfinSeries = modelMatchPattern = ชื่อรุ่นเต็ม
 * กติกา OVER ตามสเปคข้อ 8 · ดาวน์ขั้นต่ำ 30% เฉพาะกลุ่ม iPhone 17 / 18 / Air มือ 1 (คอลัมน์ AJ ของชีต)
 */
function price(model: string, storage: string, condition: GfinCondition, maxPrice: number): GfinModelMappingRow {
  return {
    id: `${model} ${storage} ${condition}`,
    gfinSeries: model,
    gfinVariant: null,
    storage,
    condition,
    maxPrice: new Decimal(maxPrice),
    modelMatchPattern: model,
    isActive: true,
  };
}

function rule(
  id: string,
  condition: GfinCondition,
  allowance: number,
  maxMonths: number,
  series: string[],
  minDownPct: number | null = null,
): GfinOverpriceRuleRow {
  return {
    id,
    label: id,
    seriesPattern: series.join('|'),
    condition,
    allowance: new Decimal(allowance),
    maxMonths,
    minDownPct,
    isActive: true,
  };
}

const mappings: GfinModelMappingRow[] = [
  price('iPhone 13', '128GB', 'HAND_1', 14900),
  price('iPhone 13', '128GB', 'HAND_2', 12900),
  price('iPhone 13 Pro', '128GB', 'HAND_2', 15900),
  price('iPhone 14 Pro', '128GB', 'HAND_2', 18900),
  price('iPhone 15', '128GB', 'HAND_1', 24900),
  price('iPhone 16', '128GB', 'HAND_1', 26900),
  price('iPhone 16 Plus', '128GB', 'HAND_2', 23900),
  price('iPhone 17', '256GB', 'HAND_1', 29900),
  price('iPhone 17 Pro', '256GB', 'HAND_1', 39900),
];

const rules: GfinOverpriceRuleRow[] = [
  rule('h1-12', 'HAND_1', 1000, 12, ['iPhone 13', 'iPhone 14', 'iPhone 14 Plus', 'iPhone 15', 'iPhone 15 Plus']),
  rule('h1-15', 'HAND_1', 1000, 15, ['iPhone 15 Pro', 'iPhone 15 Pro Max']),
  rule('h1-16', 'HAND_1', 2000, 15, ['iPhone 16', 'iPhone 16 Plus', 'iPhone 16 Pro', 'iPhone 16 Pro Max']),
  rule(
    'h1-17',
    'HAND_1',
    2000,
    15,
    ['iPhone 17', 'iPhone 17 Pro', 'iPhone 17 Pro Max', 'iPhone Air', 'iPhone 18 Pro', 'iPhone 18 Pro Max'],
    30,
  ),
  rule('h2-13', 'HAND_2', 0, 12, ['iPhone 13', 'iPhone 13 Pro', 'iPhone 13 Pro Max']),
  // iPhone 14 Pro 128GB มือ 2 ในชีต = OVER 2,000 (ความจุอื่นยังเป็นคำถามเปิดข้อ 3 ของสเปค)
  rule('h2-14', 'HAND_2', 2000, 12, [
    'iPhone 14',
    'iPhone 14 Plus',
    'iPhone 14 Pro',
    'iPhone 14 Pro Max',
    'iPhone 15',
    'iPhone 15 Plus',
    'iPhone 15 Pro',
  ]),
  rule('h2-15', 'HAND_2', 2000, 15, [
    'iPhone 15 Pro Max',
    'iPhone 16',
    'iPhone 16 Plus',
    'iPhone 16 Pro',
    'iPhone 16 Pro Max',
    'iPhone 17',
    'iPhone 17 Pro',
    'iPhone 17 Pro Max',
    'iPhone Air',
  ]),
];

const factors: GfinRateFactorRow[] = [
  { months: 10, shopCommissionPct: 15, factor: new Decimal('0.201'), feePerInstallment: new Decimal('100'), isActive: true },
  { months: 12, shopCommissionPct: 15, factor: new Decimal('0.17'), feePerInstallment: new Decimal('100'), isActive: true },
  { months: 15, shopCommissionPct: 15, factor: new Decimal('0.1467'), feePerInstallment: new Decimal('100'), isActive: true },
];

/** ทางเดียวกับผู้เรียกจริง: จับใบราคา → กติกา OVER → งวดสูงสุดของกติกา → ดาวน์ขั้นต่ำ (ค่าตั้ง 25%) */
function quote(model: string, storage: string, category: ProductForGfin['category'], salePrice: number) {
  const product: ProductForGfin = { brand: 'Apple', model, storage, category };
  const mapping = findGfinMapping(product, mappings);
  if (!mapping) return null;
  const overpriceRule = findGfinOverpriceRule(mapping, rules);
  const months = overpriceRule?.maxMonths ?? 12;
  const rateFactor = findGfinRateFactor(factors, months, 15);
  if (!rateFactor) throw new Error(`no rate for ${months}`);
  const out = calcGfinInstallment({
    installmentPrice: new Decimal(salePrice),
    product,
    months,
    downPct: resolveGfinDownPct(overpriceRule, new Decimal('0.25')),
    shopCommissionPct: new Decimal(15),
    contractFee: new Decimal(100),
    mapping,
    overpriceRule,
    rateFactor,
    deviceOrigin: 'THAI',
  });
  return { down: out.downAmountActual.toNumber(), monthly: out.monthlyPayment.toNumber(), months };
}

describe('เรท 2 ตรงชีต MASTER ทุกบาท (สเปค 4.5 + 10)', () => {
  it.each([
    ['iPhone 15', '128GB', 'PHONE_NEW', 25900, 6500, 3403, 12],
    ['iPhone 16', '128GB', 'PHONE_NEW', 28900, 7300, 3280, 15],
    ['iPhone 17', '256GB', 'PHONE_NEW', 31900, 9600, 3376, 15],
    ['iPhone 17 Pro', '256GB', 'PHONE_NEW', 39000, 9700, 4403, 15],
    ['iPhone 13', '128GB', 'PHONE_USED', 9600, 0, 1745, 12],
    ['iPhone 13 Pro', '128GB', 'PHONE_USED', 11900, 0, 2128, 12],
    ['iPhone 14 Pro', '128GB', 'PHONE_USED', 15600, 0, 2765, 12],
    ['iPhone 16 Plus', '128GB', 'PHONE_USED', 22300, 2900, 2950, 15],
  ] as const)('%s %s %s ราคาขาย %d → ดาวน์ %d · %d × %d', (model, storage, category, sale, down, monthly, months) => {
    expect(quote(model, storage, category, sale)).toEqual({ down, monthly, months });
  });

  it('iPhone 12 64GB มือ 2 = GFIN ไม่รับ (ไม่มีในใบราคา)', () => {
    expect(quote('iPhone 12', '64GB', 'PHONE_USED', 6700)).toBeNull();
  });

  it('iPhone 13 Pro 128GB มือ 1 = GFIN ไม่รับ ทั้งที่มี iPhone 13 128GB มือ 1', () => {
    expect(quote('iPhone 13 Pro', '128GB', 'PHONE_NEW', 14900)).toBeNull();
  });
});
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**

Run: `npm --prefix packages/shared test -- src/installment-calc.gfin.test.ts src/installment-calc.gfin-master.test.ts`
Expected: FAIL 3 tests — `iPhone 13 Pro 128GB มือ 1 = GFIN ไม่รับ …` ทั้งสองไฟล์ (`expected { id: '13-h1', … } to be null` / `expected { down: 3000, monthly: 2128, months: 12 } to be null` — ได้ราคาของ iPhone 13 มือ 1) และ `เทียบชื่อแบบไม่สนตัวพิมพ์…` (`expected { id: '13-h1', … } to be null`) · แถวอื่นของตารางชีตต้องผ่านแล้ว (ได้จาก Task 2)

- [ ] **Step 3: เขียนโค้ด**

`packages/shared/src/installment-calc.ts` — แทน `findGfinMapping` ทั้งฟังก์ชันด้วย:

```ts
export function findGfinMapping(
  product: ProductForGfin,
  mappings: GfinModelMappingRow[],
): GfinModelMappingRow | null {
  const normStorage = product.storage.replace(/\s+/g, '').toUpperCase();
  // มือสองเท่านั้นที่เป็น HAND_2 — เครื่องใหม่และ iPad (TABLET) ถือเป็นมือ 1
  const condition = product.category === 'PHONE_USED' ? 'HAND_2' : 'HAND_1';
  const modelLower = product.model.toLowerCase();
  const modelName = modelLower.trim();
  const isExactName = (m: GfinModelMappingRow) => m.modelMatchPattern.trim().toLowerCase() === modelName;

  // สเปค price-master-retire 4.3: ชื่อรุ่นตรงกับคำจับคู่ของแถวที่เปิดใช้แถวใดก็ตาม (ไม่ดูสภาพ/ความจุ)
  // = ใบราคามีรุ่นนี้ → ใช้ได้เฉพาะแถวที่ตรงชื่อทั้งคำ · ไม่มีแถวของสภาพ + ความจุนั้น = GFIN ไม่รับ
  // (เดิม iPhone 13 Pro มือ 1 ได้ราคาของ iPhone 13 มือ 1 เพราะ "iPhone 13 Pro" มีคำว่า "iPhone 13")
  const exactOnly = modelName !== '' && mappings.some((m) => m.isActive && isExactName(m));

  // Sort by pattern length descending so more-specific patterns (e.g. "iPhone 14 Pro Max")
  // are checked before shorter ones (e.g. "iPhone 14 Pro") — prevents false substring matches.
  const sorted = [...mappings].sort((a, b) => b.modelMatchPattern.length - a.modelMatchPattern.length);

  for (const m of sorted) {
    if (!m.isActive) continue;
    if (m.condition !== condition) continue;
    if (m.storage.replace(/\s+/g, '').toUpperCase() !== normStorage) continue;
    if (exactOnly) {
      if (isExactName(m)) return m;
      continue;
    }
    const patternLower = m.modelMatchPattern.toLowerCase();
    // Match whole-pattern: after the match position, ensure no additional word characters follow.
    const idx = modelLower.indexOf(patternLower);
    if (idx === -1) continue;
    const after = modelLower[idx + patternLower.length];
    if (after !== undefined && /\w/.test(after)) continue;
    return m;
  }
  return null;
}
```

- [ ] **Step 4: รันให้ผ่าน**

Run:
```bash
npm --prefix packages/shared test
npm run build --workspace=packages/shared
NODE_OPTIONS=--max-old-space-size=12288 npm --prefix apps/api test -- src/utils/installment-calc src/modules/gfin-config src/modules/shop-catalog/installment-preview
cd apps/web && npx vitest run src/pages/ProductDetailPage && cd ../..
```
Expected: PASS ทั้งหมด — เทสต์จับคู่เดิม (Pro vs Pro Max · ความจุ · ช่องว่าง · ProMax · สภาพไม่ตรง · TABLET) ผ่านโดยไม่แก้

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/installment-calc.ts packages/shared/src/installment-calc.gfin.test.ts packages/shared/src/installment-calc.gfin-master.test.ts
git commit -m "fix(shared): GFIN price list matches the exact model name before substring" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: API — preview เว็บ shop ใช้ดาวน์ขั้นต่ำตามกติกา OVER

**Files:**
- Modify: `apps/api/src/utils/installment-calc.util.ts:2-7` (re-export)
- Modify: `apps/api/src/modules/shop-catalog/installment-preview.service.ts:4-9` (import), `:177-210` (บล็อกหลัง `findGfinOverpriceRule`)
- Modify: `apps/api/src/modules/shop-catalog/installment-preview.service.spec.ts` (เพิ่ม describe ต่อจาก test `SECURITY: never leaks …` ก่อน `});` สุดท้าย)

**Interfaces:**
- Consumes: `resolveGfinDownPct` (Task 2) · `loadGfinSettings(...).minDownPct` (เต็มร้อย — ค่าถอย)
- Produces: `InstallmentPreviewService.preview({ provider: 'GFIN', … })` — % ดาวน์ที่ใช้ = `max(dto.downPct, ขั้นต่ำของรุ่น)` เมื่อส่ง `downPct` มา · ไม่ส่ง = ขั้นต่ำของรุ่น · รูปร่าง `PreviewResult` เดิม
  เหตุผลที่ยกขึ้นเป็นขั้นต่ำ: เว็บ shop (`apps/web-shop/src/components/InstallmentCalculatorCard.tsx:319`) ส่ง % ดาวน์เดียวกับเรท 1 (ค่าเริ่ม 15%) ให้ทั้งสองผู้ให้สินเชื่อ — ถ้าไม่ยก ค่างวด GFIN บนเว็บ shop จะคิดที่ 15% ซึ่ง GFIN ไม่รับ และไม่เท่าการ์ดในหน้าสินค้า (สเปคข้อ 10 "ผู้เรียกเรท 2 ทุกจุดให้ผลเดียวกัน")

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน**

ใน `apps/api/src/modules/shop-catalog/installment-preview.service.spec.ts` เพิ่มต่อจาก `it('SECURITY: never leaks maxPrice, factor, seriesPattern in response', ...)` (ภายใน `describe('InstallmentPreviewService'`):

```ts
  describe('GFIN: ดาวน์ขั้นต่ำตามกติกา OVER (สเปค 3.3 / 4.3)', () => {
    // iPhone 14 Pro 128GB มือ 2 เครื่องไทย: ราคาส่ง 21,500 + OVER 1,000 = 22,500 · ราคาผ่อน 19,900 → ส่วนลดดาวน์ 2,600
    function mockIphone14Pro(ruleMinDownPct: number | null) {
      prisma.systemConfig.findFirst.mockResolvedValue(null); // ค่าตั้ง gfin.minDownPct = ค่าเริ่ม 25
      prisma.product.findFirst.mockResolvedValue({
        id: 'p1',
        installmentPrice: new Prisma.Decimal('19900'),
        prices: [],
        category: 'PHONE_USED',
        brand: 'Apple',
        model: 'iPhone 14 Pro',
        storage: '128GB',
        deviceOrigin: 'THAI',
        deletedAt: null,
      });
      prisma.gfinModelMapping.findMany.mockResolvedValue([
        {
          id: 'm1',
          gfinSeries: 'iPhone 14 Pro',
          gfinVariant: null,
          storage: '128GB',
          condition: 'HAND_2',
          maxPrice: new Prisma.Decimal('21500'),
          modelMatchPattern: 'iPhone 14 Pro',
          isActive: true,
        },
      ]);
      prisma.gfinOverpriceRule.findMany.mockResolvedValue([
        {
          id: 'r1',
          label: 'iPhone 14 Pro มือ 2',
          seriesPattern: 'iPhone 14 Pro',
          condition: 'HAND_2',
          allowance: new Prisma.Decimal('1000'),
          maxMonths: 12,
          minDownPct: ruleMinDownPct,
          isActive: true,
        },
      ]);
      prisma.gfinRateFactor.findFirst.mockResolvedValue({
        months: 12,
        shopCommissionPct: 15,
        factor: new Prisma.Decimal('0.179238'),
        feePerInstallment: new Prisma.Decimal('100'),
        isActive: true,
      });
    }

    it('กติกาตั้ง 30% ชนะค่าตั้ง 25%: 6,750 − 2,600 = 4,150 → 4,200 · ยอดจัด 15,750 · 2,923', async () => {
      mockIphone14Pro(30);
      const result = await service.preview({ productId: 'p1', provider: 'GFIN', months: 12 });
      expect(result.available).toBe(true);
      expect(result.downAmount).toBe(4200);
      expect(result.financedAmount).toBe(15750);
      expect(result.monthlyPayment).toBe(2923);
    });

    it('กติกาไม่ตั้ง → ค่าตั้ง 25%: 5,625 − 2,600 = 3,025 → 3,100 · ยอดจัด 16,875 · 3,125', async () => {
      mockIphone14Pro(null);
      const result = await service.preview({ productId: 'p1', provider: 'GFIN', months: 12 });
      expect(result.downAmount).toBe(3100);
      expect(result.financedAmount).toBe(16875);
      expect(result.monthlyPayment).toBe(3125);
    });

    it('เว็บ shop ส่ง 15% (ดาวน์เรท 1) → ยกขึ้นเป็นขั้นต่ำของรุ่น 30%', async () => {
      mockIphone14Pro(30);
      const result = await service.preview({ productId: 'p1', provider: 'GFIN', months: 12, downPct: 0.15 });
      expect(result.downAmount).toBe(4200);
      expect(result.monthlyPayment).toBe(2923);
    });

    it('ส่ง % สูงกว่าขั้นต่ำ (40%) → ใช้ตามที่ส่ง: 9,000 − 2,600 = 6,400 · ยอดจัด 13,500 · 2,520', async () => {
      mockIphone14Pro(30);
      const result = await service.preview({ productId: 'p1', provider: 'GFIN', months: 12, downPct: 0.4 });
      expect(result.downAmount).toBe(6400);
      expect(result.financedAmount).toBe(13500);
      expect(result.monthlyPayment).toBe(2520);
    });
  });
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**

Run: `NODE_OPTIONS=--max-old-space-size=12288 npm --prefix apps/api test -- src/modules/shop-catalog/installment-preview`
Expected: FAIL 2 tests — `กติกาตั้ง 30% ชนะค่าตั้ง 25%` (`expected 3100 to be 4200`) และ `เว็บ shop ส่ง 15%` (ได้ดาวน์จาก 15% = 3,375 − 2,600 = 775 → `expected 800 to be 4200`) · อีกสองข้อผ่าน

- [ ] **Step 3: เขียนโค้ด**

`apps/api/src/utils/installment-calc.util.ts` — บล็อก export แรกเพิ่ม `resolveGfinDownPct`:

```ts
export {
  calcBcInstallment,
  calcGfinInstallment,
  findGfinMapping,
  findGfinOverpriceRule,
  resolveGfinDownPct,
} from '@installment/shared';
```

`apps/api/src/modules/shop-catalog/installment-preview.service.ts` — import บรรทัด 4-9:

```ts
import {
  calcBcInstallment,
  calcGfinInstallment,
  findGfinMapping,
  findGfinOverpriceRule,
  resolveGfinDownPct,
} from '../../utils/installment-calc.util';
```

ต่อจากบล็อก `if (rule?.maxMonths != null && dto.months > rule.maxMonths) { ... }` เพิ่ม:

```ts
    // ดาวน์ขั้นต่ำ: กติกา OVER ของรุ่นก่อน ไม่มีแล้วใช้ค่าตั้ง gfin.minDownPct (สเปค price-master-retire 3.3)
    // เว็บ shop ส่ง % เดียวกับเรท 1 มาด้วย (ค่าเริ่ม 15%) — GFIN ไม่รับดาวน์ต่ำกว่าขั้นต่ำ จึงยกขึ้นเป็นขั้นต่ำ
    const minDownPct = resolveGfinDownPct(rule, new Decimal(settings.minDownPct).div(100));
    const downPct =
      dto.downPct !== undefined ? Decimal.max(new Decimal(dto.downPct), minDownPct) : minDownPct;
```

และใน `calcGfinInstallment({ ... })` แทนบล็อก

```ts
      // ดาวน์ขั้นต่ำเป็นค่าต่อร้านจากตั้งค่า GFIN (ไม่ใช่ 30% ตายตัวอีกต่อไป)
      downPct:
        dto.downPct !== undefined
          ? new Decimal(dto.downPct)
          : new Decimal(settings.minDownPct).div(100),
```

ด้วย

```ts
      downPct,
```

- [ ] **Step 4: รันให้ผ่าน**

Run: `NODE_OPTIONS=--max-old-space-size=12288 npm --prefix apps/api test -- src/modules/shop-catalog src/utils/installment-calc`
Expected: PASS ทุกไฟล์ — เทสต์ GFIN เดิม (canonical 4,200 · เครื่องนอก 4,500 · iPad · months_over_max · SECURITY) ผ่านโดยไม่แก้เพิ่ม

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/utils/installment-calc.util.ts apps/api/src/modules/shop-catalog/installment-preview.service.ts apps/api/src/modules/shop-catalog/installment-preview.service.spec.ts
git commit -m "feat(shop-catalog): GFIN preview uses the per-model minimum down percent" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: เว็บ — การ์ดคำนวณในหน้าสินค้าและสติกเกอร์ใช้ดาวน์ขั้นต่ำตามกติกา OVER

**Files:**
- Modify: `apps/web/src/pages/ProductDetailPage/utils/gfinQuote.ts:2-13` (import), เพิ่ม `gfinMinDownPctFor` ต่อจาก `defaultCommissionPct` (`:105-109`)
- Modify: `apps/web/src/pages/ProductDetailPage/utils/resolveQuotes.ts:5` (import), `:26-32` (`ResolvedGfin`), `:84-122` (บล็อก GFIN)
- Modify: `apps/web/src/pages/ProductDetailPage/components/calc/GfinPanel.tsx:117`, `:121-125`, `:181-184`
- Modify: `apps/web/src/pages/ProductDetailPage/components/calc/CalcRows.tsx:173-176` (`DownCallout` บรรทัดอธิบาย)
- Modify: `apps/web/src/pages/ProductDetailPage/utils/gfinQuote.test.ts` (ต่อท้าย)
- Modify: `apps/web/src/pages/ProductDetailPage/utils/resolveQuotes.test.ts` (ต่อท้าย describe)
- Modify: `apps/web/src/pages/ProductDetailPage/components/__tests__/InstallmentCalculatorCard.test.tsx` (ต่อจาก test `ยังไม่ระบุไทย/นอก …` บรรทัด 205-209)

**Interfaces:**
- Consumes: `resolveGfinDownPct`, `findGfinMapping`, `findGfinOverpriceRule` จาก `@installment/shared` (เว็บอ่านจาก `src`)
- Produces:
  - `gfinMinDownPctFor(tables: GfinTables, product: GfinQuoteInput['product']): number` — ดาวน์ขั้นต่ำของเครื่องเป็นเต็มร้อย (30) · หมวดที่ GFIN ไม่รับ / รุ่นไม่อยู่ในใบราคา = `tables.settings.minDownPct`
  - `ResolvedGfin.minDownPct: number` · `ResolvedGfin.downPct` ค่าเริ่ม = `minDownPct` (เดิม = `settings.minDownPct`)
  - สติกเกอร์ (`apps/web/src/pages/StickerPrintPage/useStickerQuotes.ts:71`) เรียก `resolveQuotes` ด้วย `INITIAL_CALC_STATE` ⇒ ได้ % ใหม่โดยไม่ต้องแก้ไฟล์

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน**

`apps/web/src/pages/ProductDetailPage/utils/gfinQuote.test.ts` — เพิ่ม `gfinMinDownPctFor` ใน import บรรทัด 2-7:

```ts
import {
  buildGfinQuote,
  defaultCommissionPct,
  gfinCategoryOf,
  gfinMinDownPctFor,
  type GfinTables,
} from './gfinQuote';
```

ต่อท้ายไฟล์:

```ts
describe('gfinMinDownPctFor — ดาวน์ขั้นต่ำของเครื่อง (กติกา OVER ก่อน ไม่มีแล้วค่าตั้ง)', () => {
  const tables30: GfinTables = { ...tables, rules: [{ ...tables.rules[0], minDownPct: 30 }] };

  it('กติกาของรุ่นตั้ง 30 → 30', () => {
    expect(gfinMinDownPctFor(tables30, iphone15)).toBe(30);
  });

  it('กติกาไม่ตั้ง → ค่าตั้ง 25 · รุ่นไม่อยู่ในใบราคา / หมวดที่ไม่รับ → ค่าตั้ง', () => {
    expect(gfinMinDownPctFor(tables, iphone15)).toBe(25);
    expect(
      gfinMinDownPctFor(tables30, { brand: 'Samsung', model: 'Galaxy S24', storage: '256GB', category: 'PHONE_USED' }),
    ).toBe(25);
    expect(gfinMinDownPctFor(tables30, { brand: 'Apple', model: 'AirPods', storage: null, category: 'ACCESSORY' })).toBe(25);
  });
});
```

`apps/web/src/pages/ProductDetailPage/utils/resolveQuotes.test.ts` — เพิ่มใน `describe('resolveQuotes'` ต่อจาก test สุดท้าย:

```ts
  it('กติกา OVER ตั้งดาวน์ขั้นต่ำ 30% → ค่าเริ่ม GFIN 30% (สติกเกอร์ใช้ค่าเดียวกัน): 7,200 − 4,100 = 3,100 · 3,112/เดือน', () => {
    const tables30: GfinTables = { ...gfinTables, rules: [{ ...gfinTables.rules[0], minDownPct: 30 }] };
    const r = resolveQuotes({ product, state: INITIAL_CALC_STATE, bcConfig, gfinTables: tables30 });
    expect(r.gfin!.minDownPct).toBe(30);
    expect(r.gfin!.downPct).toBe(30);
    if (!r.gfin!.quote.available) throw new Error('expected GFIN quote');
    expect(r.gfin!.quote.result.downAmountByFormula.toNumber()).toBe(7200);
    expect(r.gfin!.quote.result.downAmountActual.toNumber()).toBe(3100);
    expect(r.gfin!.quote.result.monthlyPayment.toNumber()).toBe(3112);
  });

  it('กติกาไม่ตั้ง → ขั้นต่ำ = ค่าตั้ง 25 · % ที่ผู้ใช้เลือกยังทับค่าเริ่มได้', () => {
    const r = resolveQuotes({ product, state: INITIAL_CALC_STATE, bcConfig, gfinTables });
    expect(r.gfin!.minDownPct).toBe(25);
    const tables30: GfinTables = { ...gfinTables, rules: [{ ...gfinTables.rules[0], minDownPct: 30 }] };
    const chosen = resolveQuotes({
      product,
      state: { ...INITIAL_CALC_STATE, gfin: { months: null, downPct: 40, commissionPct: null } },
      bcConfig,
      gfinTables: tables30,
    });
    expect(chosen.gfin!.minDownPct).toBe(30);
    expect(chosen.gfin!.downPct).toBe(40);
  });
```

`apps/web/src/pages/ProductDetailPage/components/__tests__/InstallmentCalculatorCard.test.tsx` — เพิ่มต่อจาก `it('ยังไม่ระบุไทย/นอก → คิดครึ่งเดียวไว้ก่อน …')`:

```ts
  it('กติกา OVER ตั้งดาวน์ขั้นต่ำ 30% → การ์ดเริ่มที่ 30% · แจ้ง GFIN 7,200 → ลูกค้าจ่าย 3,100 · 3,112/เดือน', () => {
    const tables30: GfinTables = { ...gfinTables, rules: [{ ...gfinTables.rules[0], minDownPct: 30 }] };
    renderCard({ state: { ...INITIAL_CALC_STATE, fin: 'gfin' }, tables: tables30 });
    expect(screen.getByRole('combobox', { name: 'ดาวน์ (%)' })).toHaveTextContent('30 %');
    expect(screen.getByText('ดาวน์ที่แจ้ง GFIN (30%)')).toBeInTheDocument();
    expect(screen.getByText('7,200 ฿')).toBeInTheDocument();
    expect(screen.getByText('3,100 ฿')).toBeInTheDocument();
    expect(screen.getByText(/เริ่มจากดาวน์ขั้นต่ำของรุ่นนี้ 30%/)).toBeInTheDocument();
    expect(screen.getByText(/ปัดขึ้นหลักร้อย/)).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'ผ่อนชำระ' })).toHaveTextContent('12 งวด · ผ่อนเดือนละ 3,112');
  });
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**

Run: `cd apps/web && npx vitest run src/pages/ProductDetailPage/utils/gfinQuote.test.ts src/pages/ProductDetailPage/utils/resolveQuotes.test.ts src/pages/ProductDetailPage/components/__tests__/InstallmentCalculatorCard.test.tsx && cd ../..`
Expected: FAIL — `gfinMinDownPctFor is not a function` · `expected undefined to be 30` (`r.gfin.minDownPct`) · การ์ด: `expected element to have text content "30 %"` (ได้ `25 %`)

- [ ] **Step 3: เขียนโค้ด**

`apps/web/src/pages/ProductDetailPage/utils/gfinQuote.ts` — import บรรทัด 2-13:

```ts
import {
  calcGfinInstallment,
  findGfinMapping,
  findGfinOverpriceRule,
  findGfinRateFactor,
  resolveGfinDownPct,
  type GfinCalcOutput,
  type GfinDeviceOrigin,
  type GfinModelMappingRow,
  type GfinOverpriceRuleRow,
  type GfinRateFactorRow,
  type ProductCategoryForGfin,
} from '@installment/shared';
```

เพิ่มต่อจาก `toFactorRow` (ก่อนคอมเมนต์ของ `buildGfinQuote`):

```ts
/**
 * ดาวน์ขั้นต่ำ GFIN ของเครื่องนี้ เป็นเต็มร้อย (30) — กติกา OVER ของรุ่นก่อน ไม่มีแล้วใช้ค่าตั้ง GFIN
 * (สเปค price-master-retire 3.3: iPhone 17 / 18 / Air = 30%) · หมวดที่ไม่รับ / รุ่นไม่อยู่ในใบราคา = ค่าตั้ง
 */
export function gfinMinDownPctFor(tables: GfinTables, product: GfinQuoteInput['product']): number {
  const category = gfinCategoryOf(product.category);
  if (!category) return tables.settings.minDownPct;
  const mappingRow = findGfinMapping(
    { brand: product.brand, model: product.model, storage: product.storage ?? '', category },
    tables.mappings.map(toMappingRow),
  );
  const ruleRow = mappingRow ? findGfinOverpriceRule(mappingRow, tables.rules.map(toRuleRow)) : null;
  return resolveGfinDownPct(ruleRow, new Decimal(tables.settings.minDownPct).div(100)).mul(100).toNumber();
}
```

`apps/web/src/pages/ProductDetailPage/utils/resolveQuotes.ts`:

บรรทัด 5:

```ts
import {
  buildGfinQuote,
  defaultCommissionPct,
  gfinMinDownPctFor,
  type GfinQuote,
  type GfinTables,
} from './gfinQuote';
```

`ResolvedGfin` (บรรทัด 26-32):

```ts
export interface ResolvedGfin {
  /** null = ไม่มีงวดให้เลือกเลย (ตารางเรทว่าง) */
  months: number | null;
  downPct: number;
  /** ดาวน์ขั้นต่ำของรุ่นนี้ (เต็มร้อย) — กติกา OVER ก่อน ไม่มีแล้วค่าตั้ง GFIN · ตัวเลือก % ในการ์ดเริ่มที่ค่านี้ */
  minDownPct: number;
  commissionPct: number;
  quote: GfinQuote;
}
```

บล็อก `if (gfinTables) { ... }` (บรรทัด 84-122) แทนด้วย:

```ts
  if (gfinTables) {
    const commissionPct =
      state.gfin.commissionPct ?? defaultCommissionPct(gfinTables.settings, product.category);
    const productForGfin = {
      brand: product.brand,
      model: product.model,
      storage: product.storage,
      category: product.category,
      deviceOrigin: product.deviceOrigin,
    };
    // ดาวน์ขั้นต่ำตามกติกา OVER ของรุ่น (ไม่มีแล้วค่าตั้ง GFIN) — ค่าเริ่มของการ์ดและสติกเกอร์
    const minDownPct = gfinMinDownPctFor(gfinTables, productForGfin);
    const downPct = state.gfin.downPct ?? minDownPct;
    const preferred = state.gfin.months ?? 12;
    let months: number | null = preferred;
    let quote = buildGfinQuote(gfinTables, {
      product: productForGfin,
      installmentPrice,
      months: preferred,
      downPct,
      commissionPct,
    });
    // งวดที่เลือก/ตั้งต้นไม่มีเรทหรือเกินเพดานของรุ่น → ถอยไปงวดใกล้ 12 ที่สุดในตัวเลือกที่มี
    if (!quote.available && quote.reason === 'no_factor') {
      months = pickDefaultMonths(
        quote.monthsOptions.map((o) => o.months),
        preferred,
      );
      if (months != null) {
        quote = buildGfinQuote(gfinTables, {
          product: productForGfin,
          installmentPrice,
          months,
          downPct,
          commissionPct,
        });
      }
    }
    gfin = { months: quote.available ? months : null, downPct, minDownPct, commissionPct, quote };
    gfinAvailable = quote.available;
  }
```

`apps/web/src/pages/ProductDetailPage/components/calc/GfinPanel.tsx`:

บรรทัด 117:

```ts
  const { quote, months, downPct, minDownPct, commissionPct } = gfin;
```

บรรทัด 121-125:

```ts
  const downOptions = gfinDownPctOptions(minDownPct, settings.maxDownPct, settings.downStepPct);
```

`HintLine` บรรทัด 181-184:

```tsx
        <HintLine>
          เริ่มจากดาวน์ขั้นต่ำของรุ่นนี้ {minDownPct}% ถึง {settings.maxDownPct}% ขั้นละ{' '}
          {settings.downStepPct}% · พิมพ์ทับได้ · คิดจากราคาส่ง GFIN {formatBaht(submit)}
        </HintLine>
```

`apps/web/src/pages/ProductDetailPage/components/calc/CalcRows.tsx` — ใน `DownCallout` แทนย่อหน้า (บรรทัด 173-176):

```tsx
      <p className="col-span-3 text-xs text-muted-foreground leading-snug">
        หักส่วนต่าง ราคาส่งสูงสุด {formatBaht(submit)} − ราคาผ่อนที่ต้องการ {formatBaht(ourPrice)} ={' '}
        {formatBaht(discount)} ฿ แล้วปัดขึ้นหลักร้อย (กติกาของร้าน)
      </p>
```

- [ ] **Step 4: รันให้ผ่าน**

Run:
```bash
cd apps/web && npx vitest run src/pages/ProductDetailPage src/pages/StickerPrintPage src/pages/StockPage && cd ../..
NODE_OPTIONS=--max-old-space-size=12288 ./tools/check-types.sh web
```
Expected: PASS ทั้งหมด (สติกเกอร์ยัง `ดาวน์ 1,900` / `3,327` เพราะ fixture ไม่ตั้ง `minDownPct`) · TypeScript 0 errors

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/ProductDetailPage/utils/gfinQuote.ts apps/web/src/pages/ProductDetailPage/utils/gfinQuote.test.ts apps/web/src/pages/ProductDetailPage/utils/resolveQuotes.ts apps/web/src/pages/ProductDetailPage/utils/resolveQuotes.test.ts apps/web/src/pages/ProductDetailPage/components/calc/GfinPanel.tsx apps/web/src/pages/ProductDetailPage/components/calc/CalcRows.tsx apps/web/src/pages/ProductDetailPage/components/__tests__/InstallmentCalculatorCard.test.tsx
git commit -m "feat(web): GFIN calculator and stickers start at the per-model minimum down percent" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: เว็บ — ช่อง "ดาวน์ขั้นต่ำ %" ในแท็บส่วนเพิ่มราคา (OVER)

**Files:**
- Modify: `apps/web/src/pages/GfinConfigPage/OverpriceRulesTab.tsx:33-43` (`OverpriceRule`), `:113-121` (หัวตาราง), `:132-134` (เซลล์), `:166` (`colSpan`), `:200-206` (state ฟอร์ม), `:210-214` (payload), `:283-295` (ช่องกรอก)
- Modify: `apps/web/src/pages/GfinConfigPage/__tests__/OverpriceRulesTab.test.tsx`

**Interfaces:**
- Consumes: `GET/POST/PATCH /gfin-config/overprice-rules` รับ/คืน `minDownPct: number | null` (Task 1)
- Produces: คอลัมน์ "ดาวน์ขั้นต่ำ" (`30%` · ว่าง = `ตามค่าตั้งต้น`) และช่อง "ดาวน์ขั้นต่ำ %" ในกล่องเพิ่ม/แก้ — ช่องว่างส่ง `minDownPct: null`

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน**

แทน `apps/web/src/pages/GfinConfigPage/__tests__/OverpriceRulesTab.test.tsx` ทั้งไฟล์ด้วย:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const apiGet = vi.fn();
const apiPatch = vi.fn();
const apiPost = vi.fn();
vi.mock('@/lib/api', () => ({
  __esModule: true,
  default: {
    get: (...args: unknown[]) => apiGet(...args),
    patch: (...args: unknown[]) => apiPatch(...args),
    post: (...args: unknown[]) => apiPost(...args),
    delete: vi.fn(),
  },
}));

import { OverpriceRulesTab } from '../OverpriceRulesTab';

function Wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

function renderTab() {
  render(
    <Wrapper>
      <OverpriceRulesTab />
    </Wrapper>,
  );
}

describe('OverpriceRulesTab — ผ่อนสูงสุด + ดาวน์ขั้นต่ำต่อกฎ', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPatch.mockReset();
    apiPost.mockReset();
    apiPatch.mockResolvedValue({ data: {} });
    apiPost.mockResolvedValue({ data: {} });
    apiGet.mockResolvedValue({
      data: [
        {
          id: 'r1',
          label: 'iPhone 17 มือ 1',
          seriesPattern: 'iPhone 17|iPhone Air',
          condition: 'HAND_1',
          allowance: '2000',
          maxMonths: 15,
          minDownPct: 30,
          isActive: true,
          updatedAt: '2026-09-11T03:00:00.000Z',
        },
        {
          id: 'r2',
          label: 'iPhone 12 มือ 2',
          seriesPattern: 'iPhone 12',
          condition: 'HAND_2',
          allowance: '0',
          maxMonths: null,
          minDownPct: null,
          isActive: true,
          updatedAt: '2026-09-11T03:00:00.000Z',
        },
      ],
    });
  });

  it('มีคอลัมน์ผ่อนสูงสุด: โชว์ "15 งวด" และ "ไม่จำกัด" เมื่อ null', async () => {
    renderTab();
    expect(await screen.findByRole('columnheader', { name: 'ผ่อนสูงสุด' })).toBeInTheDocument();
    expect(screen.getByText('15 งวด')).toBeInTheDocument();
    expect(screen.getByText('ไม่จำกัด')).toBeInTheDocument();
  });

  it('มีคอลัมน์ดาวน์ขั้นต่ำ: โชว์ "30%" และ "ตามค่าตั้งต้น" เมื่อ null', async () => {
    renderTab();
    expect(await screen.findByRole('columnheader', { name: 'ดาวน์ขั้นต่ำ' })).toBeInTheDocument();
    expect(screen.getByText('30%')).toBeInTheDocument();
    expect(screen.getByText('ตามค่าตั้งต้น')).toBeInTheDocument();
  });

  it('แก้กฎ: ช่อง "ดาวน์ขั้นต่ำ %" ขึ้นค่าเดิม · ลบให้ว่างแล้วบันทึก → ส่ง minDownPct: null', async () => {
    renderTab();
    await userEvent.click(await screen.findByRole('button', { name: 'แก้ไข iPhone 17 มือ 1' }));
    const field = screen.getByLabelText('ดาวน์ขั้นต่ำ %');
    expect(field).toHaveValue('30');
    await userEvent.clear(field);
    await userEvent.click(screen.getByRole('button', { name: 'บันทึก' }));
    await waitFor(() =>
      expect(apiPatch).toHaveBeenCalledWith(
        '/gfin-config/overprice-rules/r1',
        expect.objectContaining({ minDownPct: null, maxMonths: 15 }),
      ),
    );
  });

  it('แก้กฎที่ยังไม่ตั้ง: พิมพ์ 30 แล้วบันทึก → ส่ง minDownPct: 30', async () => {
    renderTab();
    await userEvent.click(await screen.findByRole('button', { name: 'แก้ไข iPhone 12 มือ 2' }));
    const field = screen.getByLabelText('ดาวน์ขั้นต่ำ %');
    expect(field).toHaveValue('');
    await userEvent.type(field, '30');
    await userEvent.click(screen.getByRole('button', { name: 'บันทึก' }));
    await waitFor(() =>
      expect(apiPatch).toHaveBeenCalledWith(
        '/gfin-config/overprice-rules/r2',
        expect.objectContaining({ minDownPct: 30, maxMonths: null }),
      ),
    );
  });
});
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**

Run: `cd apps/web && npx vitest run src/pages/GfinConfigPage/__tests__/OverpriceRulesTab.test.tsx && cd ../..`
Expected: FAIL 3 tests — `Unable to find role="columnheader" and name "ดาวน์ขั้นต่ำ"` · `Unable to find a label with the text of: ดาวน์ขั้นต่ำ %` (สองข้อ) · test ผ่อนสูงสุดเดิมผ่าน

- [ ] **Step 3: เขียนโค้ด**

`apps/web/src/pages/GfinConfigPage/OverpriceRulesTab.tsx`:

`interface OverpriceRule` เพิ่มต่อจาก `maxMonths: number | null;`:

```ts
  /** ดาวน์ขั้นต่ำ % ของกลุ่มรุ่น (เต็มร้อย) — null = ใช้ค่าตั้ง "ดาวน์ขั้นต่ำที่ GFIN ตั้งให้ร้าน" */
  minDownPct: number | null;
```

หัวตาราง — เพิ่มต่อจาก `<TableHead className="text-right">ผ่อนสูงสุด</TableHead>`:

```tsx
            <TableHead className="text-right">ดาวน์ขั้นต่ำ</TableHead>
```

เซลล์ — เพิ่มต่อจากเซลล์ `{row.maxMonths != null ? ... : 'ไม่จำกัด'}`:

```tsx
              <TableCell className="text-right">
                {row.minDownPct != null ? `${row.minDownPct}%` : 'ตามค่าตั้งต้น'}
              </TableCell>
```

แถว "ไม่พบรายการ": `colSpan={7}` → `colSpan={8}`

state ฟอร์มใน `OverpriceRuleFormDialog` เพิ่มต่อจาก `maxMonths: ...`:

```ts
    minDownPct: initial?.minDownPct != null ? String(initial.minDownPct) : '',
```

payload ใน `mutationFn` เพิ่มต่อจาก `maxMonths: ...`:

```ts
        minDownPct: form.minDownPct.trim() === '' ? null : Number(form.minDownPct),
```

ช่องกรอก — เพิ่มต่อจาก `<div>` ของ "ผ่อนได้สูงสุด (งวด)" (ก่อน `</div>` ปิด `space-y-3`):

```tsx
          <div>
            <label htmlFor={`${uiFieldId}-6`} className="text-sm font-medium">ดาวน์ขั้นต่ำ %</label>
            <NumberInput id={`${uiFieldId}-6`}
              min="0"
              max="80"
              value={form.minDownPct}
              onChange={(e) => setForm((f) => ({ ...f, minDownPct: e.target.value }))}
              placeholder="ว่าง = ใช้ค่าตั้งต้น"
            />
            <p className="text-xs text-muted-foreground mt-1 leading-snug">
              ดาวน์ขั้นต่ำที่ GFIN กำหนดให้กลุ่มรุ่นนี้ เช่น iPhone 17 / 18 / Air = 30 · ว่าง = ใช้ "ดาวน์ขั้นต่ำที่ GFIN
              ตั้งให้ร้าน" ในแท็บค่าตั้งต้น
            </p>
          </div>
```

- [ ] **Step 4: รันให้ผ่าน**

Run:
```bash
cd apps/web && npx vitest run src/pages/GfinConfigPage && cd ../..
NODE_OPTIONS=--max-old-space-size=12288 ./tools/check-types.sh web
```
Expected: PASS ทุกไฟล์ในโฟลเดอร์ (OverpriceRulesTab 4 tests) · TypeScript 0 errors

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/GfinConfigPage/OverpriceRulesTab.tsx apps/web/src/pages/GfinConfigPage/__tests__/OverpriceRulesTab.test.tsx
git commit -m "feat(web): minimum down percent field on GFIN over-price rules" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: ตรวจรวมทั้งช่วง

**Files:** ไม่มีไฟล์ใหม่

- [ ] **Step 1: ตรวจว่าไม่มีผู้เรียกเรท 2 ที่หลุด**

Run: `git grep -n "calcGfinInstallment(\|settings.minDownPct\|gfinTables.settings.minDownPct" -- apps packages ':!*.test.*' ':!*.spec.*'`
Expected: `calcGfinInstallment(` เหลือ 2 ผู้เรียก — `apps/api/src/modules/shop-catalog/installment-preview.service.ts` และ `apps/web/src/pages/ProductDetailPage/utils/gfinQuote.ts` (บวกนิยามใน `packages/shared/src/installment-calc.ts`) · `settings.minDownPct` เหลือ 2 จุด ทั้งคู่เป็นค่าถอยที่ส่งเข้า `resolveGfinDownPct`: `installment-preview.service.ts` และ `gfinQuote.ts` (`gfinMinDownPctFor`) · `resolveQuotes.ts` และ `GfinPanel.tsx` ต้องไม่ขึ้นในผลแล้ว

- [ ] **Step 2: รันชุดทดสอบที่เกี่ยวข้องทั้งหมด + ตรวจชนิด**

Run:
```bash
npm run build --workspace=packages/shared
npm --prefix packages/shared test
NODE_OPTIONS=--max-old-space-size=12288 npm --prefix apps/api test -- src/utils src/modules/shop-catalog src/modules/gfin-config
cd apps/web && npx vitest run src/pages/ProductDetailPage src/pages/StickerPrintPage src/pages/StockPage src/pages/GfinConfigPage && cd ../..
cd apps/web-shop && npx vitest run src/components/InstallmentCalculatorCard.test.tsx && cd ../..
NODE_OPTIONS=--max-old-space-size=12288 ./tools/check-types.sh all
```
Expected: PASS ทั้งหมด · TypeScript 0 errors ทั้ง api และ web
ถ้ามีเทสต์ล้มนอกไฟล์ที่ระบุใน Task 1–6: แก้ได้เฉพาะเมื่อค่าเดิมคือ `downAmountActual` ที่ไม่ลงหลักร้อย (ตามตาราง "ค่าคาดหวังในเทสต์เดิม") — นอกนั้นคือบั๊กของงานนี้ ต้องแก้โค้ด ไม่ใช่แก้เทสต์

- [ ] **Step 3: รัน API ทั้งชุด (กันผลข้างเคียงนอกโมดูล)**

Run: `NODE_OPTIONS=--max-old-space-size=12288 npm --prefix apps/api test`
Expected: PASS (ไม่มีไฟล์อื่นอ้าง `GfinOverpriceRuleRow` หรือค่าดาวน์ GFIN — ถ้าล้มเพราะคอมไพล์ `minDownPct` ให้เพิ่ม `minDownPct: null` ในแถวกติกาของไฟล์นั้น)

- [ ] **Step 4: ตรวจบนหน้าจอจริง (local)**

เปิด API + เว็บ (`npm run dev` — API ต้องตั้ง `NODE_OPTIONS=--max-old-space-size=8192` · `start:dev` รัน `prisma migrate deploy` ให้คอลัมน์ใหม่) ด้วยบัญชี `admin@bestchoice.com`:

1. ตั้งค่า → GFIN → แท็บ "ส่วนเพิ่มราคา": คอลัมน์ "ดาวน์ขั้นต่ำ" ขึ้น "ตามค่าตั้งต้น" ทุกแถวเดิม · แก้กฎหนึ่งแถวเป็น 30 บันทึกแล้วเห็น "30%" · ลบให้ว่างแล้วกลับเป็น "ตามค่าตั้งต้น"
2. ตั้งกฎของรุ่นที่มีเครื่องในสต๊อกเป็น 30 → หน้ารายละเอียดเครื่องรุ่นนั้น แท็บ GFIN: ช่อง "ดาวน์ (%)" เริ่มที่ 30 % · ตัวเลือกเริ่มที่ 30 · บรรทัดใต้ช่องบอก "เริ่มจากดาวน์ขั้นต่ำของรุ่นนี้ 30%" · "ลูกค้าจ่ายดาวน์จริง" ลงหลักร้อย
3. หน้าพิมพ์สติกเกอร์ เลือกเครื่องเดียวกัน: เรท 2 ดาวน์และค่างวดเท่าข้อ 2
4. เว็บ shop หน้าเครื่องเดียวกัน (ดาวน์ 15% ค่าเริ่ม): ค่างวด GFIN เท่าข้อ 2
5. แท็บ "ทดสอบ จับคู่": เครื่องที่ชื่อรุ่นยาวกว่าแถวใบราคา (เช่น iPhone 13 Pro มือ 1 เมื่อใบราคามี iPhone 13 Pro มือ 2) ได้ "ไม่พบ" ไม่ใช่แถวของ iPhone 13
6. ตรวจข้อ 1–2 ทั้งจอสว่าง / จอมืด และจอกว้าง / มือถือ

บันทึกผลแต่ละข้อ (ผ่าน / ไม่ผ่าน พร้อมตัวเลขที่เห็น) ไว้ใช้ในข้อความ PR ของ branch `feat/price-master-rest`

- [ ] **Step 5: หมายเหตุสำหรับขึ้นระบบ (ใส่ในข้อความ PR)**

- migration เพิ่มคอลัมน์ nullable อย่างเดียว — แถวเดิมทุกแถว = ใช้ค่าตั้ง ⇒ หลังขึ้นระบบสิ่งเดียวที่เปลี่ยนทันทีคือ **ดาวน์ลูกค้า GFIN ปัดขึ้นหลักร้อย** และ **รุ่นที่ใบราคาไม่มีแต่ชื่อยาวกว่าแถวที่มี จะขึ้น "GFIN ไม่รับ"**
- เว็บ shop: ลูกค้าที่ใส่ดาวน์ต่ำกว่าขั้นต่ำ GFIN (เช่น 15%) จะเห็นค่างวด GFIN ที่ดาวน์ขั้นต่ำ แทนค่าที่คิดจาก 15% เดิม
- เจ้าของกรอก "ดาวน์ขั้นต่ำ %" = 30 ในกฎ OVER ของกลุ่ม iPhone 17 / 18 / Air — กลุ่มมือ 1 "16 ทุกรุ่น · 17 ทุกรุ่น · Air · 18 Pro / Pro Max" (สเปคข้อ 8) ต้องแยกเป็นสองกฎ (16 = ค่าตั้ง · 17/18/Air = 30) เพราะ % ตั้งต่อกฎ

---

## สิ่งที่แผนนี้ไม่ทำ (อยู่แผนถัดไป)

- `displayInstallment` · `buildModelQuote` · `GET /pricing-templates/quotes` · บอทขายเลิกอ่านราคากลางเป็นค่างวด (`get-installment-rates.tool.ts`, `recommend-devices.tool.ts` ยังไม่เรียก `calcGfinInstallment` — ช่วง 2)
- หน้า "ราคาและเรทผ่อน" (ช่วง 3) · `Product.financePrice` และผู้อ่านเรท 2 ใช้ราคาขาย GFIN (ช่วง 4) — ช่วงนี้ผู้เรียกยังส่งราคาผ่อน BESTCHOICE เป็น `installmentPrice` ตามเดิม
- `matchPreview` (`gfin-config.service.ts:301-302`) ยังแปลง TABLET เป็น `PHONE_USED` (บั๊กเดิม — iPad ในแท็บ "ทดสอบ จับคู่" ได้ผลเป็นมือ 2) ไม่แก้ในช่วงนี้
- ปุ่มลบกฎ OVER ที่ใช้ `confirm(...)` เดิม
