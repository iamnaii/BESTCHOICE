# ช่วง 1ค — ตารางดอกเบี้ยรายงวดในหน้าตั้งค่าดอกเบี้ย Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** เจ้าของตั้ง "ดอกเบี้ยรวมทั้งสัญญา" แยกตามจำนวนงวด (เช่น 10 งวด 50% · 12 งวด 50%) ได้เองในหน้า ตั้งค่า › ดอกเบี้ย

**Architecture:** ตาราง `interest_config_rates` มีอยู่แล้ว และหลังช่วง 1ก ทั้งสัญญา (`getRateForMonths`) หน้าราคา (`toBcConfig`) และตัวเลือกงวดในหน้าสร้างสัญญา (`findByCategory.allowedMonths`) อ่านตารางนี้ แต่ไม่มีทางเขียนนอกจากสคริปต์
แผนนี้ให้ `POST /interest-configs` และ `PUT /interest-configs/:id` รับช่อง `rates` เพิ่ม (ไม่เพิ่ม route ใหม่ ⇒ ไม่ต้องแก้ access manifest)
และให้หน้า InterestConfigPage แก้ตารางนี้ได้ พร้อมแสดงตัวอย่างคำนวณตามอัตรารายงวด

**Tech Stack:** NestJS + Prisma + class-validator (jest) · React + vitest + Testing Library

สเปค: `docs/superpowers/specs/2026-11-19-price-master-retire-design.md` ข้อ 4.2 และข้อ 8 (แถว "ตั้งค่าดอกเบี้ย มือ 1 และ มือ 2")
คำตัดสินเจ้าของ 2026-11-19: เพิ่มตารางรายงวดในหน้าตั้งค่า (แทนการใส่ด้วย SQL)

## Global Constraints

- ทำต่อบน branch `feat/price-master-1a` (worktree `.worktrees/price-master-1a`) หลังงานของช่วง 1ก — ส่งเป็น PR เดียวกัน
- **ห้าม stage ไฟล์ใต้ `apps/web/src/pages/ProductCreatePage/`**
- ความหมายของแถว (ห้ามเปลี่ยน — ผู้อ่านเดิมใช้แบบนี้): `ratePct` = ดอกเบี้ยรวมทั้งสัญญาเป็นเศษส่วน (0.5 = 50%) · ใช้แทน `interestRate × months` ของงวดนั้น
- กติกาเดียวกับผู้อ่าน: มีแถวที่ `deletedAt` ว่างอย่างน้อย 1 แถว = รับเฉพาะงวดที่มีแถว · ไม่มีแถวเลย = ดอกเบี้ยต่อเดือน × งวด
- ทุกงวดในตารางต้องอยู่ในช่วง งวดต่ำสุด–สูงสุด ของตั้งค่าเดียวกัน (ปิดช่องที่หน้าราคาเสนองวดที่สัญญาปฏิเสธ)
- ลบแถว = soft delete (`deletedAt`) · unique `(configId, months)` รวมแถวที่ถูกลบ ⇒ เพิ่มงวดที่เคยลบ = ชุบแถวเดิม
- `ratePct` เก็บ `Decimal(5,4)` ⇒ ช่วงที่รับ 0–9.9999 ทศนิยมไม่เกิน 4 ตำแหน่ง
- เขียนทุกอย่างใน `writeSharedReference` (ทรานแซกชันเดียวกับการแก้ตั้งค่า)
- ข้อความ error / UI ภาษาไทย · ใช้ semantic tokens · ปุ่มลบแถวมี `aria-label`
- คำสั่งเทสต์ API: `NODE_OPTIONS=--max-old-space-size=12288 npm --prefix apps/api test -- <paths>` (ห้าม `npx jest` ตรง)
- commit message ลงท้ายด้วย `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

---

### Task 1: API รับและคืนตารางรายงวด

**Files:**
- Modify: `apps/api/src/modules/interest-config/dto/interest-config.dto.ts`
- Modify: `apps/api/src/modules/interest-config/interest-config.service.ts` (`findAll`, `findOne`, `create`, `update`, เพิ่ม `replaceRates`)
- Modify: `apps/api/src/modules/interest-config/interest-config.service.spec.ts`

**Interfaces:**
- Produces:
  - `class InterestRateRowDto { months: number; ratePct: number }`
  - `CreateInterestConfigDto.rates?: InterestRateRowDto[]` · `UpdateInterestConfigDto.rates?: InterestRateRowDto[]`
    (ไม่ส่ง = ไม่แตะตาราง · `[]` = ลบทุกแถว กลับไปใช้ดอกเบี้ยต่อเดือน × งวด · มีค่า = แทนทั้งชุด)
  - `GET /interest-configs` และ `GET /interest-configs/:id` คืน field เพิ่ม `rates: { months: number; ratePct: Decimal }[]` (เฉพาะแถวที่ยังไม่ถูกลบ เรียงตามงวด)

- [ ] **Step 1: เขียนเทสต์ (ยังไม่ผ่าน)**

ใน `interest-config.service.spec.ts`:

1. ใน object `prisma` ของ `beforeEach` แทน `interestConfigRate: { findMany: jest.fn().mockResolvedValue([]) },` ด้วย

```ts
      interestConfigRate: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        upsert: jest.fn().mockResolvedValue({}),
      },
```

2. แทนเทสต์ใน `describe('findAll')` ทั้งก้อนด้วย

```ts
  describe('findAll', () => {
    it('filters out soft-deleted configs and returns active per-term rows', async () => {
      prisma.interestConfig.findMany.mockResolvedValue([]);

      await service.findAll();

      expect(prisma.interestConfig.findMany).toHaveBeenCalledWith({
        where: { deletedAt: null },
        orderBy: { createdAt: 'asc' },
        include: RATES_INCLUDE,
      });
    });
  });
```

และแก้ assertion ของเทสต์ `findOne` แรกเป็น

```ts
      expect(prisma.interestConfig.findFirst).toHaveBeenCalledWith({
        where: { id: 'cfg-1', deletedAt: null },
        include: RATES_INCLUDE,
      });
```

โดยประกาศค่าคงที่ใต้ import ของไฟล์ spec:

```ts
const RATES_INCLUDE = {
  rates: {
    where: { deletedAt: null },
    select: { months: true, ratePct: true },
    orderBy: { months: 'asc' },
  },
};
```

3. เพิ่ม describe ใหม่ก่อนปิด `describe('InterestConfigService', …)`:

```ts
  describe('ตารางดอกเบี้ยรายงวด (rates)', () => {
    const existing = { id: 'cfg-1', minInstallmentMonths: 6, maxInstallmentMonths: 12, deletedAt: null };

    beforeEach(() => {
      prisma.interestConfig.findFirst.mockResolvedValue(existing);
      prisma.interestConfig.update.mockResolvedValue({ ...existing, vatPct: 0.07 });
    });

    it('ไม่ส่ง rates → ไม่แตะตาราง', async () => {
      await service.update('cfg-1', { name: 'มือ 1' });
      expect(prisma.interestConfigRate.updateMany).not.toHaveBeenCalled();
      expect(prisma.interestConfigRate.upsert).not.toHaveBeenCalled();
    });

    it('ส่ง rates → ลบแถวที่ไม่อยู่ในชุด แล้ว upsert ทุกแถว (ชุบแถวที่เคยลบ)', async () => {
      await service.update('cfg-1', {
        rates: [
          { months: 10, ratePct: 0.5 },
          { months: 12, ratePct: 0.5 },
        ],
      });
      expect(prisma.interestConfigRate.updateMany).toHaveBeenCalledWith({
        where: { configId: 'cfg-1', deletedAt: null, months: { notIn: [10, 12] } },
        data: { deletedAt: expect.any(Date) },
      });
      expect(prisma.interestConfigRate.upsert).toHaveBeenCalledTimes(2);
      expect(prisma.interestConfigRate.upsert).toHaveBeenCalledWith({
        where: { configId_months: { configId: 'cfg-1', months: 12 } },
        update: { ratePct: 0.5, deletedAt: null },
        create: { configId: 'cfg-1', months: 12, ratePct: 0.5 },
      });
    });

    it('rates: [] → ลบทุกแถว', async () => {
      await service.update('cfg-1', { rates: [] });
      expect(prisma.interestConfigRate.updateMany).toHaveBeenCalledWith({
        where: { configId: 'cfg-1', deletedAt: null, months: { notIn: [] } },
        data: { deletedAt: expect.any(Date) },
      });
      expect(prisma.interestConfigRate.upsert).not.toHaveBeenCalled();
    });

    it('งวดซ้ำในชุด → ปฏิเสธ ไม่เขียนอะไร', async () => {
      await expect(
        service.update('cfg-1', { rates: [{ months: 12, ratePct: 0.5 }, { months: 12, ratePct: 0.4 }] }),
      ).rejects.toThrow('จำนวนงวดซ้ำกันในตารางรายงวด: 12 งวด');
      expect(prisma.interestConfigRate.upsert).not.toHaveBeenCalled();
    });

    it('งวดนอกช่วงต่ำสุด–สูงสุด → ปฏิเสธ', async () => {
      await expect(service.update('cfg-1', { rates: [{ months: 15, ratePct: 0.6 }] })).rejects.toThrow(
        'ตารางรายงวดมี 15 งวด ซึ่งอยู่นอกช่วงงวดต่ำสุด–สูงสุด (6–12 งวด)',
      );
    });

    it('ใช้ช่วงงวดใหม่ที่ส่งมาพร้อมกันในการตรวจ', async () => {
      await service.update('cfg-1', { maxInstallmentMonths: 15, rates: [{ months: 15, ratePct: 0.6 }] });
      expect(prisma.interestConfigRate.upsert).toHaveBeenCalledTimes(1);
    });

    it('แก้ช่วงงวดจนแถวเดิมหลุดช่วง (ไม่ได้ส่ง rates) → ปฏิเสธ', async () => {
      prisma.interestConfigRate.findMany.mockResolvedValue([{ months: 10 }, { months: 12 }]);
      await expect(service.update('cfg-1', { maxInstallmentMonths: 10 })).rejects.toThrow(
        'ตารางรายงวดมี 12 งวด ซึ่งอยู่นอกช่วงงวดต่ำสุด–สูงสุด (6–10 งวด) — แก้ตารางรายงวดก่อน',
      );
    });

    it('create พร้อม rates → เขียนตารางให้ config ใหม่', async () => {
      prisma.interestConfig.create.mockResolvedValue({ id: 'cfg-new', vatPct: 0.07 });
      await service.create({
        name: 'มือ 2',
        productCategories: ['PHONE_USED'],
        interestRate: 0.05,
        minDownPaymentPct: 0.15,
        minInstallmentMonths: 6,
        maxInstallmentMonths: 12,
        rates: [{ months: 10, ratePct: 0.5 }],
      });
      expect(prisma.interestConfigRate.upsert).toHaveBeenCalledWith({
        where: { configId_months: { configId: 'cfg-new', months: 10 } },
        update: { ratePct: 0.5, deletedAt: null },
        create: { configId: 'cfg-new', months: 10, ratePct: 0.5 },
      });
    });
  });
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**

Run: `NODE_OPTIONS=--max-old-space-size=12288 npm --prefix apps/api test -- src/modules/interest-config/interest-config.service.spec.ts`
Expected: FAIL — `include` ไม่ตรง และเทสต์ rates ล้ม (ไม่มีการเขียนตาราง / ไม่ปฏิเสธ)

- [ ] **Step 3: DTO**

ใน `dto/interest-config.dto.ts` แก้บรรทัด import เป็น

```ts
import {
  IsString,
  IsNumber,
  IsArray,
  IsBoolean,
  IsOptional,
  IsInt,
  Min,
  Max,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
```

เพิ่ม class ก่อน `CreateInterestConfigDto`:

```ts
/** แถวของตารางดอกเบี้ยรายงวด — `ratePct` = ดอกเบี้ยรวมทั้งสัญญาเป็นเศษส่วน (0.5 = 50%) */
export class InterestRateRowDto {
  @IsInt({ message: 'จำนวนงวดต้องเป็นจำนวนเต็ม' })
  @Min(1, { message: 'จำนวนงวดต้องอย่างน้อย 1' })
  @Max(120, { message: 'จำนวนงวดต้องไม่เกิน 120' })
  months: number;

  @IsNumber({ maxDecimalPlaces: 4 }, { message: 'ดอกเบี้ยรวมทศนิยมได้ไม่เกิน 4 ตำแหน่ง' })
  @Min(0, { message: 'ดอกเบี้ยรวมต้องไม่น้อยกว่า 0' })
  @Max(9.9999, { message: 'ดอกเบี้ยรวมต้องไม่เกิน 999.99%' })
  ratePct: number;
}
```

เพิ่ม field เดียวกันท้ายทั้ง `CreateInterestConfigDto` และ `UpdateInterestConfigDto`:

```ts
  /** ไม่ส่ง = ไม่แตะตาราง · [] = ลบทุกแถว (ใช้ดอกเบี้ยต่อเดือน × งวด) · มีค่า = แทนทั้งชุด */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InterestRateRowDto)
  rates?: InterestRateRowDto[];
```

- [ ] **Step 4: service**

ใน `interest-config.service.ts`:

เพิ่ม import `InterestRateRowDto` จาก `./dto/interest-config.dto` และประกาศค่าคงที่ใต้ import:

```ts
const RATES_INCLUDE = {
  rates: {
    where: { deletedAt: null },
    select: { months: true, ratePct: true },
    orderBy: { months: 'asc' as const },
  },
};
```

`findAll` — เพิ่ม `include: RATES_INCLUDE,` ใน `findMany` · `findOne` — เพิ่ม `include: RATES_INCLUDE,` ใน `findFirst`

`create` — แทน callback ของ `writeSharedReference` ด้วย

```ts
    const created = await writeSharedReference(this.base, async (tx) => {
      const row = await tx.interestConfig.create({
        data: {
          name: dto.name,
          productCategories: dto.productCategories,
          interestRate: dto.interestRate,
          minDownPaymentPct: dto.minDownPaymentPct,
          storeCommissionPct: dto.storeCommissionPct,
          // vat_pct ไม่เขียน (#22 — VAT มาจาก FINANCE) · คอลัมน์ได้ค่า default ของตาราง ไม่มีใครอ่าน
          minInstallmentMonths: dto.minInstallmentMonths,
          maxInstallmentMonths: dto.maxInstallmentMonths,
        },
      });
      if (dto.rates !== undefined) {
        await this.replaceRates(tx, row.id, dto.rates, dto.minInstallmentMonths, dto.maxInstallmentMonths);
      }
      return row;
    });
```

`update` — แทน callback ด้วย

```ts
    const updated = await writeSharedReference(this.base, async (tx) => {
      const config = await tx.interestConfig.findFirst({ where: { id, deletedAt: null } });
      if (!config) throw new NotFoundException('ไม่พบการตั้งค่าดอกเบี้ย');
      const minMonths = dto.minInstallmentMonths ?? config.minInstallmentMonths;
      const maxMonths = dto.maxInstallmentMonths ?? config.maxInstallmentMonths;
      this.validateMonths(minMonths, maxMonths);
      // #22: vatPct จากหน้าเว็บรุ่นเก่า (ถ้ามี) ไม่ถูกเขียน — VAT ของการผ่อนมาจาก FINANCE
      const { vatPct: _ignoredVatPct, rates, ...data } = dto as UpdateInterestConfigDto & {
        vatPct?: unknown;
      };
      void _ignoredVatPct;
      if (rates !== undefined) {
        await this.replaceRates(tx, id, rates, minMonths, maxMonths);
      } else if (dto.minInstallmentMonths !== undefined || dto.maxInstallmentMonths !== undefined) {
        // ช่วงงวดเปลี่ยนแต่ไม่ได้ส่งตาราง — แถวเดิมต้องยังอยู่ในช่วง (ไม่งั้นหน้าราคาเสนองวดที่สัญญาปฏิเสธ)
        const current = await tx.interestConfigRate.findMany({
          where: { configId: id, deletedAt: null },
          select: { months: true },
        });
        const outside = current.find((r) => r.months < minMonths || r.months > maxMonths);
        if (outside) {
          throw new BadRequestException(
            `${this.outsideRangeMessage(outside.months, minMonths, maxMonths)} — แก้ตารางรายงวดก่อน`,
          );
        }
      }
      return tx.interestConfig.update({ where: { id }, data });
    });
```

เพิ่ม private methods ก่อน `validateMonths`:

```ts
  /** แทนตารางรายงวดของ config ทั้งชุด — แถวที่ไม่อยู่ในชุดถูก soft delete · แถวที่เคยลบถูกชุบ (unique รวมแถวที่ลบ) */
  private async replaceRates(
    tx: Prisma.TransactionClient,
    configId: string,
    rates: InterestRateRowDto[],
    minMonths: number,
    maxMonths: number,
  ) {
    const seen = new Set<number>();
    for (const r of rates) {
      if (seen.has(r.months)) {
        throw new BadRequestException(`จำนวนงวดซ้ำกันในตารางรายงวด: ${r.months} งวด`);
      }
      seen.add(r.months);
      if (r.months < minMonths || r.months > maxMonths) {
        throw new BadRequestException(this.outsideRangeMessage(r.months, minMonths, maxMonths));
      }
    }
    const months = rates.map((r) => r.months);
    await tx.interestConfigRate.updateMany({
      where: { configId, deletedAt: null, months: { notIn: months } },
      data: { deletedAt: new Date() },
    });
    for (const r of rates) {
      await tx.interestConfigRate.upsert({
        where: { configId_months: { configId, months: r.months } },
        update: { ratePct: r.ratePct, deletedAt: null },
        create: { configId, months: r.months, ratePct: r.ratePct },
      });
    }
  }

  private outsideRangeMessage(months: number, minMonths: number, maxMonths: number) {
    return `ตารางรายงวดมี ${months} งวด ซึ่งอยู่นอกช่วงงวดต่ำสุด–สูงสุด (${minMonths}–${maxMonths} งวด)`;
  }
```

(`Prisma` import จาก `@prisma/client` มีอยู่แล้วในไฟล์)

- [ ] **Step 5: รันให้ผ่าน**

Run: `NODE_OPTIONS=--max-old-space-size=12288 npm --prefix apps/api test -- src/modules/interest-config src/modules/employee-access/access-interest-reference`
Expected: PASS ทุก suite ที่รันได้ (spec ที่ต้องใช้ฐานข้อมูลจริงอาจถูกข้าม — รายงานว่าข้ามเพราะอะไร)

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/interest-config/dto/interest-config.dto.ts apps/api/src/modules/interest-config/interest-config.service.ts apps/api/src/modules/interest-config/interest-config.service.spec.ts
git commit -m "feat(interest-config): read and write per-term interest rate rows" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: ฟังก์ชันคำนวณของหน้าตั้งค่า (ไม่มี UI)

**Files:**
- Create: `apps/web/src/pages/interest-config/rate-rows.ts`
- Create: `apps/web/src/pages/interest-config/rate-rows.test.ts`

**Interfaces:**
- Produces:
  - `interface RateRowForm { months: number; ratePct: number }` — `ratePct` เป็น **เปอร์เซ็นต์** ในฟอร์ม (50 = 50%)
  - `validateRateRows(rows: RateRowForm[], minMonths: number, maxMonths: number): string | null` — ข้อความ error แรก หรือ `null`
  - `previewMonths(rows: { months: number }[], maxMonths: number): number` — งวดที่ใช้ทำตัวอย่างคำนวณ
  - `totalInterestPct(rows: { months: number; ratePct: number }[], monthlyRatePct: number, months: number): number` — ดอกเบี้ยรวมเป็นเปอร์เซ็นต์ของงวดนั้น

- [ ] **Step 1: เขียนเทสต์ (ยังไม่ผ่าน)**

`apps/web/src/pages/interest-config/rate-rows.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { previewMonths, totalInterestPct, validateRateRows } from './rate-rows';

describe('validateRateRows', () => {
  it('ตารางว่างผ่าน', () => {
    expect(validateRateRows([], 6, 12)).toBeNull();
  });

  it('ตารางที่ถูกต้องผ่าน', () => {
    expect(validateRateRows([{ months: 10, ratePct: 50 }, { months: 12, ratePct: 50 }], 6, 12)).toBeNull();
  });

  it('งวดไม่เป็นจำนวนเต็มหรือน้อยกว่า 1', () => {
    expect(validateRateRows([{ months: 10.5, ratePct: 50 }], 6, 12)).toBe('จำนวนงวดต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป');
    expect(validateRateRows([{ months: 0, ratePct: 50 }], 6, 12)).toBe('จำนวนงวดต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป');
  });

  it('งวดซ้ำ', () => {
    expect(validateRateRows([{ months: 12, ratePct: 50 }, { months: 12, ratePct: 40 }], 6, 12)).toBe(
      'จำนวนงวดซ้ำกัน: 12 งวด',
    );
  });

  it('งวดนอกช่วง', () => {
    expect(validateRateRows([{ months: 15, ratePct: 60 }], 6, 12)).toBe(
      '15 งวด อยู่นอกช่วงงวดต่ำสุด–สูงสุด (6–12 งวด)',
    );
  });

  it('ดอกเบี้ยรวมต้องมากกว่า 0 และไม่เกิน 999.99', () => {
    expect(validateRateRows([{ months: 12, ratePct: 0 }], 6, 12)).toBe('ดอกเบี้ยรวมต้องมากกว่า 0% และไม่เกิน 999.99%');
    expect(validateRateRows([{ months: 12, ratePct: 1000 }], 6, 12)).toBe(
      'ดอกเบี้ยรวมต้องมากกว่า 0% และไม่เกิน 999.99%',
    );
  });
});

describe('previewMonths', () => {
  it('ไม่มีตาราง → งวดสูงสุด', () => {
    expect(previewMonths([], 12)).toBe(12);
  });

  it('มีตารางและมี 12 งวด → 12', () => {
    expect(previewMonths([{ months: 10 }, { months: 12 }], 15)).toBe(12);
  });

  it('มีตารางแต่ไม่มี 12 งวด → งวดมากสุดในตาราง', () => {
    expect(previewMonths([{ months: 6 }, { months: 10 }], 15)).toBe(10);
  });
});

describe('totalInterestPct', () => {
  it('มีแถวของงวดนั้น → ใช้ค่าในแถว', () => {
    expect(totalInterestPct([{ months: 12, ratePct: 50 }], 8, 12)).toBe(50);
  });

  it('ไม่มีตาราง → ดอกเบี้ยต่อเดือน × งวด', () => {
    expect(totalInterestPct([], 5, 12)).toBe(60);
  });
});
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**

Run: `cd apps/web && npx vitest run src/pages/interest-config/rate-rows.test.ts`
Expected: FAIL — `Failed to resolve import "./rate-rows"`

- [ ] **Step 3: เขียนโค้ด**

`apps/web/src/pages/interest-config/rate-rows.ts`:

```ts
/** แถวของตารางดอกเบี้ยรายงวดในฟอร์ม — `ratePct` เป็นเปอร์เซ็นต์ (50 = 50%) · ส่ง API เป็นเศษส่วน (÷ 100) */
export interface RateRowForm {
  months: number;
  ratePct: number;
}

/** ข้อความ error แรก หรือ null — กติกาเดียวกับ API (`InterestConfigService.replaceRates`) */
export function validateRateRows(rows: RateRowForm[], minMonths: number, maxMonths: number): string | null {
  const seen = new Set<number>();
  for (const r of rows) {
    if (!Number.isInteger(r.months) || r.months < 1) return 'จำนวนงวดต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป';
    if (seen.has(r.months)) return `จำนวนงวดซ้ำกัน: ${r.months} งวด`;
    seen.add(r.months);
    if (r.months < minMonths || r.months > maxMonths) {
      return `${r.months} งวด อยู่นอกช่วงงวดต่ำสุด–สูงสุด (${minMonths}–${maxMonths} งวด)`;
    }
    if (!(r.ratePct > 0) || r.ratePct > 999.99) return 'ดอกเบี้ยรวมต้องมากกว่า 0% และไม่เกิน 999.99%';
  }
  return null;
}

/** งวดที่ใช้ทำตัวอย่างคำนวณ — มีตาราง: 12 ถ้ามี ไม่งั้นงวดมากสุดในตาราง · ไม่มีตาราง: งวดสูงสุด */
export function previewMonths(rows: { months: number }[], maxMonths: number): number {
  if (rows.length === 0) return maxMonths;
  if (rows.some((r) => r.months === 12)) return 12;
  return Math.max(...rows.map((r) => r.months));
}

/** ดอกเบี้ยรวมทั้งสัญญา (เปอร์เซ็นต์) ของงวดนั้น — กติกาเดียวกับสัญญา: มีแถว = ค่าในแถว · ไม่มีตาราง = ต่อเดือน × งวด */
export function totalInterestPct(
  rows: { months: number; ratePct: number }[],
  monthlyRatePct: number,
  months: number,
): number {
  const row = rows.find((r) => r.months === months);
  if (row) return row.ratePct;
  return monthlyRatePct * months;
}
```

- [ ] **Step 4: รันให้ผ่าน**

Run: `cd apps/web && npx vitest run src/pages/interest-config/rate-rows.test.ts`
Expected: PASS (13 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/interest-config/rate-rows.ts apps/web/src/pages/interest-config/rate-rows.test.ts
git commit -m "feat(web): per-term interest rate helpers for the interest settings page" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: หน้า InterestConfigPage แก้ตารางรายงวด

**Files:**
- Create: `apps/web/src/pages/interest-config/RateRowsEditor.tsx`
- Modify: `apps/web/src/pages/InterestConfigPage.tsx`
- Create: `apps/web/src/pages/InterestConfigPage.rates.test.tsx`

**Interfaces:**
- Consumes: `RateRowForm`, `validateRateRows`, `previewMonths`, `totalInterestPct` จาก Task 2 · API field `rates` จาก Task 1
- Produces: `RateRowsEditor({ rows, onChange, error }: { rows: RateRowForm[]; onChange: (rows: RateRowForm[]) => void; error?: string })`

**ข้อความบนหน้าจอ (ใช้ตามนี้):**

| ที่ | ข้อความ |
|---|---|
| หัวส่วนในฟอร์ม | `ดอกเบี้ยรายงวด` |
| คำอธิบายใต้หัว | `ใส่ดอกเบี้ยรวมทั้งสัญญาแยกตามจำนวนงวด เช่น 10 งวด 50% · มีตารางนี้แล้ว สัญญาและหน้าราคาจะใช้อัตราในตาราง และเลือกได้เฉพาะงวดที่มีในตาราง` |
| เมื่อตารางว่าง | `ยังไม่มีตาราง — ใช้ดอกเบี้ยต่อเดือน × จำนวนงวด และเลือกได้ทุกงวดในช่วงต่ำสุด–สูงสุด` |
| ป้ายช่อง | `จำนวนงวด` · `ดอกเบี้ยรวม (%)` |
| ปุ่มเพิ่ม | `+ เพิ่มงวด` |
| ปุ่มลบ (`aria-label`) | `ลบแถว {months} งวด` |
| ป้ายช่องดอกเบี้ยต่อเดือนเดิม | เปลี่ยนจาก `ดอกเบี้ย (%)` เป็น `ดอกเบี้ยต่อเดือน (%)` · คำอธิบายใต้ช่อง `ใช้เมื่อไม่มีตารางดอกเบี้ยรายงวด` |
| การ์ดของแต่ละตั้งค่า (มีตาราง) | ช่อง "ดอกเบี้ย" แสดง `ตามตารางรายงวด` และใต้แถวตัวเลขแสดงชิป `{months} งวด {ratePct}%` ต่อแถว |

- [ ] **Step 1: เขียนเทสต์หน้า (ยังไม่ผ่าน)**

`apps/web/src/pages/InterestConfigPage.rates.test.tsx` — ใช้ mock และ helper `open()` แบบเดียวกับ `InterestConfigPage.vat.test.tsx` (คัดลอก `vi.hoisted` · `vi.mock('@/lib/api', …)` · `open()` มาทั้งก้อน):

```tsx
const configWithRates = {
  id: 'ic-1',
  name: 'มือ 2',
  productCategories: ['PHONE_USED'],
  interestRate: '0.05',
  minDownPaymentPct: '0.15',
  storeCommissionPct: '0.10',
  vatPct: '0.07',
  minInstallmentMonths: 6,
  maxInstallmentMonths: 12,
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  rates: [
    { months: 10, ratePct: '0.5' },
    { months: 12, ratePct: '0.5' },
  ],
};

describe('InterestConfigPage — ตารางดอกเบี้ยรายงวด', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.get.mockImplementation(async (url: string) => {
      if (url === '/settings') return { data: [] };
      if (url === '/interest-configs') return { data: [configWithRates] };
      if (url === '/companies')
        return { data: [{ id: 'f', companyCode: 'FINANCE', vatRegistered: true, vatRate: '0.0700' }] };
      throw new Error(`unexpected ${url}`);
    });
    mocks.put.mockResolvedValue({ data: configWithRates });
  });

  it('การ์ดแสดงอัตราตามตาราง', async () => {
    open();
    await screen.findByText('มือ 2');
    expect(screen.getByText('ตามตารางรายงวด')).toBeInTheDocument();
    expect(screen.getByText('10 งวด 50%')).toBeInTheDocument();
    expect(screen.getByText('12 งวด 50%')).toBeInTheDocument();
  });

  it('แก้ไข: แสดงแถวเดิม เพิ่มงวด ลบแถว แล้วบันทึกเป็นเศษส่วน', async () => {
    open();
    await screen.findByText('มือ 2');
    fireEvent.click(screen.getAllByRole('button', { name: 'แก้ไข' })[1]);

    const monthInputs = await screen.findAllByLabelText('จำนวนงวด');
    expect(monthInputs.map((el) => (el as HTMLInputElement).value)).toEqual(['10', '12']);

    fireEvent.click(screen.getByRole('button', { name: 'ลบแถว 10 งวด' }));
    fireEvent.click(screen.getByRole('button', { name: '+ เพิ่มงวด' }));
    const after = screen.getAllByLabelText('จำนวนงวด');
    fireEvent.change(after[after.length - 1], { target: { value: '8' } });
    const rates = screen.getAllByLabelText('ดอกเบี้ยรวม (%)');
    fireEvent.change(rates[rates.length - 1], { target: { value: '45' } });

    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }));
    await vi.waitFor(() => expect(mocks.put).toHaveBeenCalledTimes(1));
    expect(mocks.put.mock.calls[0][1].rates).toEqual([
      { months: 12, ratePct: 0.5 },
      { months: 8, ratePct: 0.45 },
    ]);
  });

  it('งวดซ้ำ → แสดงข้อความ และไม่บันทึก', async () => {
    open();
    await screen.findByText('มือ 2');
    fireEvent.click(screen.getAllByRole('button', { name: 'แก้ไข' })[1]);
    await screen.findAllByLabelText('จำนวนงวด');
    fireEvent.click(screen.getByRole('button', { name: '+ เพิ่มงวด' }));
    const after = screen.getAllByLabelText('จำนวนงวด');
    fireEvent.change(after[after.length - 1], { target: { value: '12' } });
    const rates = screen.getAllByLabelText('ดอกเบี้ยรวม (%)');
    fireEvent.change(rates[rates.length - 1], { target: { value: '40' } });

    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }));
    expect(await screen.findByText('จำนวนงวดซ้ำกัน: 12 งวด')).toBeInTheDocument();
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it('ตัวอย่างคำนวณในการ์ดใช้อัตราในตาราง (12 งวด 50%)', async () => {
    open();
    await screen.findByText('มือ 2');
    // 12,900 × 15% = 1,935 · ยอดปล่อย 10,965 · ดอกเบี้ย 50% = 5,482.5 → แสดงปัดเป็น 5,483
    expect(screen.getByText('ตัวอย่างคำนวณ (ราคา 12,900 บาท / 12 งวด)')).toBeInTheDocument();
    expect(screen.getAllByText('5,483 ฿').length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**

Run: `cd apps/web && npx vitest run src/pages/InterestConfigPage.rates.test.tsx`
Expected: FAIL — ไม่พบ `ตามตารางรายงวด` / ช่อง `จำนวนงวด`

- [ ] **Step 3: component แก้ตาราง**

`apps/web/src/pages/interest-config/RateRowsEditor.tsx`:

```tsx
import { useId } from 'react';
import { NumberInput } from '@/components/ui/NumberInput';
import { formControlClass } from '@/components/ui/form-styles';
import { cn } from '@/lib/utils';
import type { RateRowForm } from './rate-rows';

export default function RateRowsEditor({
  rows,
  onChange,
  error,
}: {
  rows: RateRowForm[];
  onChange: (rows: RateRowForm[]) => void;
  error?: string;
}) {
  const fieldId = useId();
  const update = (index: number, patch: Partial<RateRowForm>) =>
    onChange(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));

  return (
    <section aria-labelledby={`${fieldId}-title`} className="rounded-lg border border-border p-3">
      <h3 id={`${fieldId}-title`} className="text-sm font-semibold leading-snug text-foreground">
        ดอกเบี้ยรายงวด
      </h3>
      <p className="mt-1 text-xs leading-snug text-muted-foreground">
        ใส่ดอกเบี้ยรวมทั้งสัญญาแยกตามจำนวนงวด เช่น 10 งวด 50% · มีตารางนี้แล้ว สัญญาและหน้าราคาจะใช้อัตราในตาราง
        และเลือกได้เฉพาะงวดที่มีในตาราง
      </p>

      {rows.length === 0 ? (
        <p className="mt-3 text-xs leading-snug text-muted-foreground">
          ยังไม่มีตาราง — ใช้ดอกเบี้ยต่อเดือน × จำนวนงวด และเลือกได้ทุกงวดในช่วงต่ำสุด–สูงสุด
        </p>
      ) : (
        <div className="mt-3 space-y-2">
          {rows.map((row, index) => (
            <div key={index} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
              <div>
                <label htmlFor={`${fieldId}-m-${index}`} className="mb-1 block text-xs text-muted-foreground">
                  จำนวนงวด
                </label>
                <NumberInput
                  unstyled
                  id={`${fieldId}-m-${index}`}
                  min="1"
                  step="1"
                  value={row.months}
                  onChange={(e) => update(index, { months: Number(e.target.value) })}
                  className={cn(formControlClass, 'w-full')}
                />
              </div>
              <div>
                <label htmlFor={`${fieldId}-r-${index}`} className="mb-1 block text-xs text-muted-foreground">
                  ดอกเบี้ยรวม (%)
                </label>
                <NumberInput
                  unstyled
                  id={`${fieldId}-r-${index}`}
                  min="0"
                  step="0.01"
                  value={row.ratePct}
                  onChange={(e) => update(index, { ratePct: Number(e.target.value) })}
                  className={cn(formControlClass, 'w-full')}
                />
              </div>
              <button
                type="button"
                data-ui-control="button"
                aria-label={`ลบแถว ${row.months} งวด`}
                onClick={() => onChange(rows.filter((_, i) => i !== index))}
                className="rounded-lg px-3 text-sm text-destructive hover:bg-destructive/10"
              >
                ลบ
              </button>
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        data-ui-control="button"
        onClick={() => onChange([...rows, { months: 12, ratePct: 50 }])}
        className="mt-3 rounded-lg border border-input px-3 text-sm text-foreground hover:bg-accent"
      >
        + เพิ่มงวด
      </button>
      {error && <p className="mt-2 text-xs leading-snug text-destructive">{error}</p>}
    </section>
  );
}
```

- [ ] **Step 4: ต่อเข้าหน้า InterestConfigPage**

ใน `apps/web/src/pages/InterestConfigPage.tsx`:

1. import:

```ts
import RateRowsEditor from './interest-config/RateRowsEditor';
import {
  previewMonths,
  totalInterestPct,
  validateRateRows,
  type RateRowForm,
} from './interest-config/rate-rows';
```

2. `interface InterestConfig` เพิ่ม `rates?: { months: number; ratePct: string }[];`
3. `defaultForm` เพิ่ม `rates: [] as RateRowForm[],` · แก้ `type FormErrors` เป็น `Partial<Record<keyof typeof defaultForm, string>>` (คงเดิม — `rates` เป็น key ของ defaultForm แล้ว)
4. ท้าย `validateForm` ก่อน `return errors;`:

```ts
  const rateError = validateRateRows(form.rates, form.minInstallmentMonths, form.maxInstallmentMonths);
  if (rateError) errors.rates = rateError;
```

5. `saveMutation` payload เพิ่ม `rates: form.rates.map((r) => ({ months: r.months, ratePct: Number((r.ratePct / 100).toFixed(4)) })),`
6. `openEdit` เพิ่ม `rates: (config.rates ?? []).map((r) => ({ months: r.months, ratePct: Number((parseFloat(r.ratePct) * 100).toFixed(2)) })),`
7. `simulateCalc` — แทน `const months = config.maxInstallmentMonths;` และ `const interest = loan * rate * months;` ด้วย

```ts
    const rows = (config.rates ?? []).map((r) => ({ months: r.months, ratePct: parseFloat(r.ratePct) * 100 }));
    const months = previewMonths(rows, config.maxInstallmentMonths);
```

```ts
    const interest = loan * (totalInterestPct(rows, rate * 100, months) / 100);
```

8. การ์ด: แทนบล็อกช่อง "ดอกเบี้ย" (บรรทัด `<div className="text-xs text-muted-foreground">ดอกเบี้ย</div>` และค่าใต้มัน) ด้วย

```tsx
                      <div>
                        <div className="text-xs text-muted-foreground">ดอกเบี้ย</div>
                        <div className="text-lg font-bold text-primary">
                          {config.rates && config.rates.length > 0
                            ? 'ตามตารางรายงวด'
                            : `${(parseFloat(config.interestRate) * 100).toFixed(2)}%`}
                        </div>
                      </div>
```

และต่อจาก `</div>` ปิด grid ของตัวเลข (ก่อน `{/* Simulation */}`) เพิ่ม

```tsx
                    {config.rates && config.rates.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {config.rates.map((r) => (
                          <span
                            key={r.months}
                            className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary dark:bg-primary/15"
                          >
                            {`${r.months} งวด ${Number((parseFloat(r.ratePct) * 100).toFixed(2))}%`}
                          </span>
                        ))}
                      </div>
                    )}
```

9. ฟอร์ม: เปลี่ยนป้าย `ดอกเบี้ย (%)` เป็น `ดอกเบี้ยต่อเดือน (%)` และเพิ่มใต้ `NumberInput` ของช่องนั้น (ก่อนบรรทัดแสดง error)
`<p className="mt-1 text-xs leading-snug text-muted-foreground">ใช้เมื่อไม่มีตารางดอกเบี้ยรายงวด</p>`

10. ฟอร์ม: ต่อจาก grid "งวดต่ำสุด + สูงสุด" (ก่อน `{/* Preview Calculation */}`) เพิ่ม

```tsx
            <RateRowsEditor
              rows={form.rates}
              onChange={(rates) => setForm((f) => ({ ...f, rates }))}
              error={touched ? errors.rates : undefined}
            />
```

11. ตัวอย่างคำนวณในฟอร์ม — แทน `form.maxInstallmentMonths` ทั้ง 3 จุดในบล็อก Preview (หัวข้อ, `interest`, `monthly`) ด้วยตัวแปร `months` และคำนวณ:

```ts
                  const months = previewMonths(form.rates, form.maxInstallmentMonths);
                  const interest = loan * (totalInterestPct(form.rates, form.interestRate, months) / 100);
```

(ย้ายหัวข้อ `ตัวอย่างคำนวณ (…/ {…} งวด)` เข้าไปใน IIFE เพื่อใช้ `months` เดียวกัน)

- [ ] **Step 5: รันให้ผ่าน + ตรวจชนิด**

Run:
```bash
cd apps/web && npx vitest run src/pages/InterestConfigPage.rates.test.tsx src/pages/InterestConfigPage.vat.test.tsx src/pages/interest-config
cd ../.. && NODE_OPTIONS=--max-old-space-size=12288 ./tools/check-types.sh web
```
Expected: PASS · TypeScript 0 errors (`InterestConfigPage.vat.test.tsx` ต้องผ่านโดยไม่แก้ — config ในเทสต์นั้นไม่มี `rates`)

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/interest-config/RateRowsEditor.tsx apps/web/src/pages/InterestConfigPage.tsx apps/web/src/pages/InterestConfigPage.rates.test.tsx
git commit -m "feat(web): edit per-term interest rates on the interest settings page" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## หลังแผนนี้

- ตรวจรวมทั้ง branch (1ก + 1ค) · รันชุดทดสอบทั้งหมด · ตรวจหน้าจอจริง (เพิ่มแถว 10/12 งวด 50% ในหน้าตั้งค่า → หน้าสร้างสัญญาเหลือ 10 และ 12 งวด และค่างวดเท่าการ์ดคำนวณ) · เปิด PR เดียว
