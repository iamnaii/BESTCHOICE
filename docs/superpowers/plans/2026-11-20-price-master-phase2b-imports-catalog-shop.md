# ช่วง 2ข — นำเข้าราคากลาง / ใบราคา GFIN + หน้าตั้งราคา + รายชื่อรุ่น iPhone 18 Pro + งวดเว็บ shop + ไฟล์ข้อมูลจากชีต Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** เจ้าของนำเข้าราคาจากชีต MASTER ได้เองพร้อมหน้าตรวจก่อนยืนยัน (ราคากลางพร้อมงวด/ดาวน์ของรุ่น · ใบราคา GFIN) · หน้าตั้งราคาบอกชัดว่าราคาผ่อนคือ "ราคาเต็ม" · มี iPhone 18 Pro / Pro Max ในรายชื่อรุ่น · เว็บ shop เลือกได้เฉพาะงวดที่มีอัตรา และแสดงค่างวดปัดขึ้นเป็นบาท · มีไฟล์นำเข้า 2 ไฟล์พร้อมให้เจ้าของกด

**Architecture:** API `POST /pricing-templates/import` เขียนงวด/ดาวน์จากไฟล์ และรับ `deactivateIds` (ปิดแถวที่ไม่อยู่ในไฟล์) · `POST /gfin-config/max-prices/import` ใหม่ (เจ้าของเท่านั้น) หาแถวเดิมด้วย (ชื่อรุ่น, ความจุ, สภาพ) เอง · หน้าเว็บอ่าน Excel → สร้างหน้าตรวจ (เพิ่ม / แก้ / ข้าม + เหตุผล) ฝั่งเว็บเทียบกับรายการปัจจุบันจาก GET ที่มีอยู่ → ยืนยันแล้วส่งชุดละ 100 · กล่องตรวจใช้คอมโพเนนต์เดียว `ImportReviewDialog` ทั้งสองหน้า · หัวคอลัมน์ Excel อยู่ในค่าคงที่ที่สคริปต์ข้อมูลตรวจเทียบ

**Tech Stack:** TypeScript · NestJS + Prisma + class-validator · jest (`apps/api`) · React + TanStack Query + shadcn · vitest (`apps/web`, `apps/web-shop`) · exceljs · Python 3 + openpyxl (สคริปต์ข้อมูลนอก repo)

สเปค: `docs/superpowers/specs/2026-11-19-price-master-retire-design.md` ข้อ 3.1, 7.4, 7.5, 7.7, 8 · **ต้องทำหลังแผน 2ก** (`2026-11-20-price-master-phase2a-model-quotes-api-bot.md` — ใช้ `displayInstallment` และกติกาค้นราคากลางของ 2ก) · สัญญากลาง: `docs/superpowers/plans/2026-11-20-price-master-contracts.md`

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

- web-shop: `cd apps/web-shop && npx vitest run <paths>` · ตรวจชนิด `cd apps/web-shop && npx tsc --noEmit`
- route ใหม่ลงทะเบียนใน `access-policy.manifest.json` (ดู Task 5) · ตรวจทะเบียนบน Windows ใช้คำสั่งห่อใน Task 10
- ปุ่มเติมราคาขาย GFIN ให้เครื่องในสต๊อก (สเปคข้อ 7.5 ท่อนท้าย) เป็นงานช่วง 4 — **ไม่ทำในแผนนี้**
- ไฟล์ข้อมูลและสคริปต์ของ Task 9 อยู่นอก repo (`D:\BESTCHOICE APP\price-master-import\`) — ไม่ commit

## หัวคอลัมน์ไฟล์นำเข้า (ค่าคงที่เดียว ใช้ทั้งแบบฟอร์ม ตัวอ่าน และสคริปต์ข้อมูล)

| ไฟล์ | หัวคอลัมน์ (ตามลำดับ) |
|---|---|
| ราคากลาง | `ยี่ห้อ` · `รุ่น` · `ความจุ` · `เครื่องไทย/นอก` · `ประเภท` · `ประกัน` · `ราคาเงินสด` · `ราคาผ่อน BESTCHOICE (ราคาเต็ม)` · `ราคาขาย GFIN (ราคาเต็ม)` · `งวดเรท 1` · `ดาวน์เรท 1` · `งวดเรท 2` |
| ใบราคา GFIN | `รุ่น` · `ความจุ` · `มือ 1/มือ 2` · `ราคา` |

ตัวอ่านราคากลางยังรับหัวเดิม `ราคาผ่อน BESTCHOICE` / `ราคาผ่อนไฟแนนซ์` ของแบบฟอร์มเก่า (ช่องงวด/ดาวน์ที่ไม่มีในไฟล์ = ว่าง)

---

### Task 1: API นำเข้าราคากลาง — เขียนงวด/ดาวน์ + ปิดแถวที่ไม่อยู่ในไฟล์

**Files:**
- Modify: `apps/api/src/modules/pricing-templates/pricing-templates.service.ts:125-171` (`bulkImport`)
- Modify: `apps/api/src/modules/pricing-templates/pricing-templates.controller.ts:52-57` (`bulkImport`)
- Modify: `apps/api/src/modules/pricing-templates/pricing-templates.service.spec.ts`
- Modify: `apps/api/src/modules/employee-access/access-sticker-pricing-boundaries.ts:115`, `:152-154` (บันทึก audit นับแถวที่ปิด)
- Modify: `apps/api/src/modules/employee-access/access-sticker-pricing.integration.spec.ts:440-475` (เทสต์ `processes duplicate keys in order and preserves existing down/term while new imports keep defaults`)

**Interfaces:**
- Consumes: `CreatePricingTemplateDto` (มี `rate1DownPayment`, `rate1TermMonths`, `rate2TermMonths` อยู่แล้ว)
- Produces:
  - `bulkImport(items: CreatePricingTemplateDto[], deactivateIds?: unknown): Promise<{ success: number; skipped: number; errors: string[]; deactivated?: number }>`
  - ไฟล์คือค่าจริงของรุ่น: `rate1TermMonths` / `rate1DownPayment` / `rate2TermMonths` ที่ไม่ส่ง = เขียน `null` (ใช้กติกาตั้งต้น) ทั้งตอนสร้างและตอนแก้ · `rate2DownPayment` ไม่แตะ (สเปค 3.1 ไม่ใช้)
  - `deactivateIds`: อาร์เรย์ string ≤ 1000 · ปิด (`isActive=false`) เฉพาะแถวที่ยังเปิดและไม่ถูกลบ · ทำในธุรกรรมเดียวกับชุดนั้น · `deactivated` อยู่ในผลเฉพาะเมื่อส่ง `deactivateIds`
  - body ของ `POST /pricing-templates/import`: `{ items: CreatePricingTemplateDto[]; deactivateIds?: string[] }`

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน**

`pricing-templates.service.spec.ts`:
- `db.pricingTemplate` เพิ่ม `updateMany: jest.fn(),`
- import บรรทัดแรกเพิ่ม `import { BadRequestException } from '@nestjs/common';`
- เพิ่มต่อท้าย `describe`:

```ts
  const ITEM = {
    brand: 'Apple',
    model: 'iPhone 17 Pro',
    storage: '256GB',
    category: 'PHONE_NEW' as CreatePricingTemplateDto['category'],
    cashPrice: 39000,
    installmentBestchoicePrice: 39000,
    installmentFinancePrice: 39000,
  };

  it('นำเข้าเขียนงวด/ดาวน์จากไฟล์ทั้งตอนสร้างและตอนแก้ · ช่องว่าง = null (สเปค 7.4)', async () => {
    await service.bulkImport([
      { ...ITEM, rate1TermMonths: 12, rate1DownPayment: 15000, rate2TermMonths: 15 },
      { ...ITEM, model: 'iPhone 16' },
    ]);
    const [first, second] = db.pricingTemplate.upsert.mock.calls.map(([args]) => args);
    expect(first.update).toMatchObject({ rate1TermMonths: 12, rate1DownPayment: 15000, rate2TermMonths: 15, isActive: true });
    expect(first.create).toMatchObject({ rate1TermMonths: 12, rate1DownPayment: 15000, rate2TermMonths: 15 });
    expect(second.update).toMatchObject({ rate1TermMonths: null, rate1DownPayment: null, rate2TermMonths: null });
    expect(first.update).not.toHaveProperty('rate2DownPayment');
  });

  it('ปิดแถวที่เปิดใช้อยู่แต่ไม่อยู่ในไฟล์ตาม id ที่ส่งมา', async () => {
    db.pricingTemplate.updateMany.mockResolvedValue({ count: 2 });
    const result = await service.bulkImport([], ['a', 'b']);
    expect(db.pricingTemplate.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['a', 'b'] }, isActive: true, deletedAt: null },
      data: { isActive: false },
    });
    expect(result).toEqual({ success: 0, skipped: 0, errors: [], deactivated: 2 });
  });

  it('ไม่ส่ง deactivateIds → ไม่ปิดแถวใด และผลรูปเดิม', async () => {
    const result = await service.bulkImport([ITEM]);
    expect(db.pricingTemplate.updateMany).not.toHaveBeenCalled();
    expect(result).toEqual({ success: 1, skipped: 0, errors: [] });
  });

  it('deactivateIds ผิดรูป → 400', async () => {
    await expect(service.bulkImport([], 'a')).rejects.toThrow(BadRequestException);
    await expect(service.bulkImport([], [1])).rejects.toThrow(BadRequestException);
  });
```

`access-sticker-pricing.integration.spec.ts` — แทนเทสต์ `processes duplicate keys in order and preserves existing down/term while new imports keep defaults` ทั้งบล็อกด้วย:

```ts
  it('processes duplicate keys in order, writes down/term from the file (blank = null) and deactivates listed rows', async () => {
    const data = pricing();
    const p = await db.pricingTemplate.create({
      data: { ...data, category: 'PHONE_NEW', rate1DownPayment: 20, rate1TermMonths: 6, isActive: false },
    });
    const res = await http('post', '/pricing-templates/import?company=SHOP')
      .send({
        items: [
          { ...data, cashPrice: 10, rate1DownPayment: 99, rate1TermMonths: 3 },
          { ...data, cashPrice: 30 },
        ],
      })
      .expect(201);
    expect(res.body).toEqual({ success: 2, skipped: 0, errors: [] });
    const row = await db.pricingTemplate.findUniqueOrThrow({ where: { id: p.id } });
    expect(row.cashPrice.toString()).toBe('30');
    expect(row.rate1DownPayment).toBeNull();
    expect(row.rate1TermMonths).toBeNull();
    expect(row.isActive).toBe(true);
    const fresh = pricing();
    await http('post', '/pricing-templates/import?company=SHOP')
      .send({ items: [{ ...fresh, rate1DownPayment: 99, rate1TermMonths: 3, rate2TermMonths: 15 }] })
      .expect(201);
    const created = await db.pricingTemplate.findFirstOrThrow({ where: { model: fresh.model } });
    expect(created.rate1DownPayment?.toString()).toBe('99');
    expect(created.rate1TermMonths).toBe(3);
    expect(created.rate2TermMonths).toBe(15);
    const off = await http('post', '/pricing-templates/import?company=SHOP')
      .send({ items: [], deactivateIds: [created.id] })
      .expect(201);
    expect(off.body).toEqual({ success: 0, skipped: 0, errors: [], deactivated: 1 });
    expect((await db.pricingTemplate.findUniqueOrThrow({ where: { id: created.id } })).isActive).toBe(false);
  });
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**

Run: `NODE_OPTIONS=--max-old-space-size=12288 npm --prefix apps/api test -- src/modules/pricing-templates/pricing-templates.service.spec.ts`
Expected: FAIL — `first.update` ไม่มี `rate1TermMonths` · `updateMany` ไม่ถูกเรียก

- [ ] **Step 3: แก้โค้ด**

แทนที่เมธอด `bulkImport` ทั้งเมธอดใน `pricing-templates.service.ts`:

```ts
  async bulkImport(items: CreatePricingTemplateDto[], deactivateIds?: unknown) {
    if (!Array.isArray(items) || items.length > 100)
      throw new BadRequestException('รายการนำเข้าต้องเป็นอาร์เรย์ไม่เกิน 100 แถว');
    if (
      deactivateIds !== undefined &&
      (!Array.isArray(deactivateIds) ||
        deactivateIds.length > 1000 ||
        deactivateIds.some((id) => typeof id !== 'string'))
    )
      throw new BadRequestException('รายการแถวที่จะปิดไม่ถูกต้อง');
    const errors: string[] = [];
    const valid: CreatePricingTemplateDto[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        errors.push(`ROW_${i + 1}:INVALID_ROW`);
        continue;
      }
      const dto = plainToInstance(CreatePricingTemplateDto, item);
      if ((await validate(dto, { whitelist: true })).length)
        errors.push(`ROW_${i + 1}:INVALID_ROW`);
      else valid.push(dto);
    }
    if (errors.length) return { success: 0, skipped: items.length, errors };
    const ids = (deactivateIds as string[] | undefined) ?? [];
    return writeSharedReference(this.base, async (tx) => {
      for (const item of valid) {
        const key = {
          brand: item.brand,
          model: item.model,
          storage: item.storage || '',
          category: item.category as ProductCategory,
          hasWarranty: item.category === 'PHONE_USED' ? (item.hasWarranty ?? false) : false,
          deviceOrigin: item.deviceOrigin ?? ('UNSPECIFIED' as PricingDeviceOrigin),
        };
        const existing = await tx.pricingTemplate.findUnique({
          where: { brand_model_storage_category_hasWarranty_deviceOrigin: key },
        });
        if (existing?.deletedAt) throw new ConflictException('ข้อมูลอ้างอิงถูกลบแล้ว');
        if (existing)
          await tx.$queryRaw`SELECT id FROM pricing_templates WHERE id = ${existing.id} FOR UPDATE`;
        // ไฟล์คือค่าจริงของรุ่น (สเปคข้อ 7.4) — งวด/ดาวน์ที่ว่างในไฟล์ = ใช้กติกาตั้งต้น จึงเขียน null
        const values = {
          cashPrice: item.cashPrice,
          installmentBestchoicePrice: item.installmentBestchoicePrice,
          installmentFinancePrice: item.installmentFinancePrice,
          rate1TermMonths: item.rate1TermMonths ?? null,
          rate1DownPayment: item.rate1DownPayment ?? null,
          rate2TermMonths: item.rate2TermMonths ?? null,
        };
        await tx.pricingTemplate.upsert({
          where: { brand_model_storage_category_hasWarranty_deviceOrigin: key },
          update: { ...values, isActive: true },
          create: { ...key, ...values },
        });
      }
      // "ปิดแถวที่เปิดใช้อยู่แต่ไม่อยู่ในไฟล์" — หน้าเว็บส่ง id มากับชุดสุดท้าย
      const deactivated = ids.length
        ? (
            await tx.pricingTemplate.updateMany({
              where: { id: { in: ids }, isActive: true, deletedAt: null },
              data: { isActive: false },
            })
          ).count
        : 0;
      return {
        success: valid.length,
        skipped: 0,
        errors: [] as string[],
        ...(deactivateIds !== undefined ? { deactivated } : {}),
      };
    });
  }
```

`pricing-templates.controller.ts` แทนเมธอด `bulkImport` (ตัวตกแต่ง `@Post('import')` / `@Roles('OWNER')` คงเดิม ⇒ ทะเบียนสิทธิ์ไม่เปลี่ยน):

```ts
  bulkImport(@Body() body: { items: CreatePricingTemplateDto[]; deactivateIds?: string[] }) {
    if (!body || typeof body !== 'object' || !Array.isArray(body.items)) throw new BadRequestException('รายการนำเข้าต้องเป็นอาร์เรย์ไม่เกิน 100 แถว');
    return this.service.bulkImport(body.items, body.deactivateIds);
  }
```

`access-sticker-pricing-boundaries.ts`:
- `const value = result as { id?: string; success?: number; skipped?: number };` → `const value = result as { id?: string; success?: number; skipped?: number; deactivated?: number };`
- `? { success: value.success ?? 0, skipped: value.skipped ?? 0 }` → `? { success: value.success ?? 0, skipped: value.skipped ?? 0, deactivated: value.deactivated ?? 0 }`

- [ ] **Step 4: รันให้ผ่าน**

Run: `NODE_OPTIONS=--max-old-space-size=12288 npm --prefix apps/api test -- src/modules/pricing-templates`
Expected: PASS
ถ้ามีเครื่อง macOS/Linux ที่มี PostgreSQL: `tools/test-employee-access-sticker-pricing.sh` → PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/pricing-templates/pricing-templates.service.ts apps/api/src/modules/pricing-templates/pricing-templates.controller.ts apps/api/src/modules/pricing-templates/pricing-templates.service.spec.ts apps/api/src/modules/employee-access/access-sticker-pricing-boundaries.ts apps/api/src/modules/employee-access/access-sticker-pricing.integration.spec.ts
git commit -m "feat(pricing): template import writes rate-1 term/down and rate-2 term; can deactivate rows missing from the file" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: ชิ้นส่วนนำเข้าที่ใช้ร่วม — อ่านเซลล์ Excel + กล่องตรวจก่อนยืนยัน

**Files:**
- Create: `apps/web/src/utils/excel-cell.util.ts`
- Create: `apps/web/src/utils/excel-cell.util.test.ts`
- Create: `apps/web/src/components/import/ImportReviewDialog.tsx`
- Create: `apps/web/src/components/import/ImportReviewDialog.test.tsx`

**Interfaces:**
- Consumes: `Dialog*` (`@/components/ui/dialog`), `Button`, `Checkbox`, ไอคอน lucide
- Produces:
  - `cellText(value: unknown): string` — ค่าเซลล์ exceljs (ตัวเลข · ข้อความ · สูตร `{ result }` · rich text) → ข้อความตัดช่องว่างหัวท้าย
  - `chunk<T>(items: T[], size: number): T[][]`
  - `class ImportBatchError extends Error` — ชุดถูกปฏิเสธ (ข้อความภาษาไทยแสดงตรงได้)
  - `type ImportReviewAction = 'ADD' | 'UPDATE' | 'SKIP'` · `interface ImportReviewRow { rowNumber: number; label: string; action: ImportReviewAction; detail?: string }`
  - `ImportReviewDialog(props: { title: string; rows: ImportReviewRow[]; warning?: string | null; deactivateCount?: number; pending: boolean; progress?: string | null; onCancel(): void; onConfirm(o: { deactivateMissing: boolean }): void })`

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน**

`apps/web/src/utils/excel-cell.util.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { cellText, chunk } from './excel-cell.util';

describe('cellText', () => {
  it('ตัวเลข / ข้อความ / ว่าง', () => {
    expect(cellText(25900)).toBe('25900');
    expect(cellText('  มือ 1 ')).toBe('มือ 1');
    expect(cellText(null)).toBe('');
    expect(cellText(undefined)).toBe('');
  });

  it('เซลล์สูตรใช้ผลลัพธ์ · rich text ต่อกัน', () => {
    expect(cellText({ formula: 'E3', result: 25900 })).toBe('25900');
    expect(cellText({ richText: [{ text: 'iPhone ' }, { text: '15' }] })).toBe('iPhone 15');
    expect(cellText({ text: 'ลิงก์', hyperlink: 'https://x' })).toBe('ลิงก์');
  });
});

describe('chunk', () => {
  it('แบ่งเป็นชุดตามขนาด', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 100)).toEqual([]);
  });
});
```

`apps/web/src/components/import/ImportReviewDialog.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ImportReviewDialog, type ImportReviewRow } from './ImportReviewDialog';

const rows: ImportReviewRow[] = [
  { rowNumber: 2, label: 'Apple iPhone 15 128GB มือ 1', action: 'ADD' },
  { rowNumber: 3, label: 'Apple iPhone 13 128GB มือ 2 มีประกัน', action: 'UPDATE', detail: 'เงินสด 12,000 → 12,500' },
  { rowNumber: 4, label: 'Apple iPhone 12', action: 'SKIP', detail: 'ประเภทต้องเป็น มือ 1 หรือ มือ 2' },
];

const base = { title: 'ตรวจไฟล์ราคากลางก่อนนำเข้า', pending: false, onCancel: vi.fn(), onConfirm: vi.fn() };

describe('ImportReviewDialog', () => {
  it('สรุปจำนวน เพิ่ม / แก้ / ข้าม และบอกเหตุผลของแถวที่ข้าม', () => {
    render(<ImportReviewDialog {...base} rows={rows} />);
    expect(screen.getByText('ตรวจรายการก่อนยืนยัน — เพิ่ม 1 · แก้ 1 · ข้าม 1 แถว')).toBeInTheDocument();
    expect(screen.getByText('เงินสด 12,000 → 12,500')).toBeInTheDocument();
    expect(screen.getByText('ประเภทต้องเป็น มือ 1 หรือ มือ 2')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('ติ๊ก "ปิดแถวที่เปิดใช้อยู่แต่ไม่อยู่ในไฟล์" แล้วยืนยัน → ส่ง deactivateMissing', async () => {
    const onConfirm = vi.fn();
    render(<ImportReviewDialog {...base} rows={rows} deactivateCount={3} onConfirm={onConfirm} />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'ปิดแถวที่เปิดใช้อยู่แต่ไม่อยู่ในไฟล์ (3 แถว)' }));
    await userEvent.click(screen.getByRole('button', { name: 'ยืนยันนำเข้า' }));
    expect(onConfirm).toHaveBeenCalledWith({ deactivateMissing: true });
  });

  it('ไม่ติ๊ก → deactivateMissing = false', async () => {
    const onConfirm = vi.fn();
    render(<ImportReviewDialog {...base} rows={rows} deactivateCount={3} onConfirm={onConfirm} />);
    await userEvent.click(screen.getByRole('button', { name: 'ยืนยันนำเข้า' }));
    expect(onConfirm).toHaveBeenCalledWith({ deactivateMissing: false });
  });

  it('มีแต่แถวข้าม → ปุ่มยืนยันกดไม่ได้ · แสดงคำเตือนเมื่อส่งมา', () => {
    render(<ImportReviewDialog {...base} rows={[rows[2]]} warning="มีแถวเดิมรูปแบบเก่า 3 แถว" />);
    expect(screen.getByRole('button', { name: 'ยืนยันนำเข้า' })).toBeDisabled();
    expect(screen.getByText('มีแถวเดิมรูปแบบเก่า 3 แถว')).toBeInTheDocument();
  });

  it('กำลังนำเข้า → ปุ่มปิดใช้ และแสดงความคืบหน้า', () => {
    render(<ImportReviewDialog {...base} rows={rows} pending progress="กำลังนำเข้า ชุด 1/2" />);
    expect(screen.getByRole('button', { name: 'กำลังนำเข้า...' })).toBeDisabled();
    expect(screen.getByText('กำลังนำเข้า ชุด 1/2')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**

Run: `cd apps/web && npx vitest run src/utils/excel-cell.util.test.ts src/components/import/ImportReviewDialog.test.tsx`
Expected: FAIL — `Failed to resolve import "./excel-cell.util"` / `"./ImportReviewDialog"`

- [ ] **Step 3: เขียนโค้ด**

`apps/web/src/utils/excel-cell.util.ts`:

```ts
/** ค่าเซลล์จาก exceljs → ข้อความ (สูตรใช้ผลลัพธ์ · rich text ต่อกัน · ลิงก์ใช้ข้อความ) */
export function cellText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'object') {
    const v = value as { result?: unknown; text?: unknown; richText?: { text: string }[] };
    if (v.result !== undefined) return cellText(v.result);
    if (Array.isArray(v.richText)) return v.richText.map((part) => part.text).join('').trim();
    if (v.text !== undefined) return cellText(v.text);
    return '';
  }
  return String(value).trim();
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** เซิร์ฟเวอร์ปฏิเสธชุดนำเข้า — ข้อความภาษาไทยแสดงให้ผู้ใช้ได้ตรง ๆ */
export class ImportBatchError extends Error {}
```

`apps/web/src/components/import/ImportReviewDialog.tsx`:

```tsx
import { useState } from 'react';
import { PencilLine, Plus, SkipForward, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export type ImportReviewAction = 'ADD' | 'UPDATE' | 'SKIP';

export interface ImportReviewRow {
  /** เลขแถวใน Excel (แถว 1 = หัวคอลัมน์) */
  rowNumber: number;
  label: string;
  action: ImportReviewAction;
  /** แก้: ค่าเดิม → ค่าใหม่ · ข้าม: เหตุผล */
  detail?: string;
}

const ACTION = {
  ADD: { word: 'เพิ่ม', Icon: Plus, className: 'text-success' },
  UPDATE: { word: 'แก้', Icon: PencilLine, className: 'text-primary' },
  SKIP: { word: 'ข้าม', Icon: SkipForward, className: 'text-muted-foreground' },
} as const;

interface Props {
  title: string;
  rows: ImportReviewRow[];
  warning?: string | null;
  /** จำนวนแถวที่เปิดใช้อยู่แต่ไม่อยู่ในไฟล์ — 0 / ไม่ส่ง = ไม่มีตัวเลือกปิดแถว */
  deactivateCount?: number;
  pending: boolean;
  progress?: string | null;
  onCancel: () => void;
  onConfirm: (options: { deactivateMissing: boolean }) => void;
}

/** หน้าตรวจไฟล์นำเข้าก่อนยืนยัน (สเปคข้อ 7.4 / 7.7) — ใช้ทั้งราคากลางและใบราคา GFIN */
export function ImportReviewDialog({
  title,
  rows,
  warning,
  deactivateCount = 0,
  pending,
  progress,
  onCancel,
  onConfirm,
}: Props) {
  const [deactivateMissing, setDeactivateMissing] = useState(false);
  const count = (action: ImportReviewAction) => rows.filter((r) => r.action === action).length;
  const writes = count('ADD') + count('UPDATE');
  const deactivate = deactivateMissing && deactivateCount > 0;
  const canConfirm = !pending && (writes > 0 || deactivate);

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onCancel()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="leading-snug">
            ตรวจรายการก่อนยืนยัน — เพิ่ม {count('ADD')} · แก้ {count('UPDATE')} · ข้าม {count('SKIP')} แถว
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {warning && (
            <p className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-warning-strong leading-snug">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>{warning}</span>
            </p>
          )}
          <ul
            aria-label="รายการในไฟล์"
            className="max-h-[50vh] divide-y divide-border overflow-y-auto rounded-lg border border-border"
          >
            {rows.map((r) => {
              const a = ACTION[r.action];
              return (
                <li key={`${r.rowNumber}-${r.label}`} className="flex items-start gap-3 px-3 py-2 text-sm">
                  <span className={`inline-flex w-14 shrink-0 items-center gap-1 font-medium ${a.className}`}>
                    <a.Icon className="size-4" aria-hidden="true" />
                    {a.word}
                  </span>
                  <span className="min-w-0 flex-1 leading-snug">
                    <span className="text-muted-foreground">แถว {r.rowNumber} · </span>
                    {r.label}
                    {r.detail && (
                      <span className="block text-xs text-muted-foreground leading-snug">{r.detail}</span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
          {deactivateCount > 0 && (
            <label className="flex items-center gap-2 text-sm leading-snug">
              <Checkbox
                checked={deactivateMissing}
                disabled={pending}
                onCheckedChange={(value) => setDeactivateMissing(value === true)}
              />
              ปิดแถวที่เปิดใช้อยู่แต่ไม่อยู่ในไฟล์ ({deactivateCount} แถว)
            </label>
          )}
          {progress && (
            <p role="status" aria-live="polite" className="text-sm text-muted-foreground leading-snug">
              {progress}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={pending}>
            ยกเลิก
          </Button>
          <Button
            variant="primary"
            disabled={!canConfirm}
            onClick={() => onConfirm({ deactivateMissing: deactivate })}
          >
            {pending ? 'กำลังนำเข้า...' : 'ยืนยันนำเข้า'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: รันให้ผ่าน**

Run: `cd apps/web && npx vitest run src/utils/excel-cell.util.test.ts src/components/import/ImportReviewDialog.test.tsx`
Expected: PASS (3 + 5 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/utils/excel-cell.util.ts apps/web/src/utils/excel-cell.util.test.ts apps/web/src/components/import/ImportReviewDialog.tsx apps/web/src/components/import/ImportReviewDialog.test.tsx
git commit -m "feat(web): shared Excel cell reader and import review dialog" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: ตัวอ่านไฟล์ราคากลาง — แยกแถว · สร้างหน้าตรวจ · ส่งชุดละ 100

**Files:**
- Create: `apps/web/src/pages/pricing-templates/pricingTemplateImport.ts`
- Create: `apps/web/src/pages/pricing-templates/pricingTemplateImport.test.ts`

**Interfaces:**
- Consumes: `cellText`, `chunk`, `ImportBatchError` (Task 2) · `ImportReviewRow` (Task 2)
- Produces:
  - `PRICING_HEADER` (ชื่อหัวคอลัมน์ตามช่อง) · `PRICING_IMPORT_HEADERS` (ลำดับในแบบฟอร์ม — ตารางด้านบน) · `IMPORT_BATCH_SIZE = 100`
  - `interface PricingImportItem { brand; model; storage?; deviceOrigin: 'UNSPECIFIED' | 'THAI' | 'IMPORTED'; category: 'PHONE_NEW' | 'PHONE_USED'; hasWarranty: boolean; cashPrice; installmentBestchoicePrice; installmentFinancePrice; rate1TermMonths: number | null; rate1DownPayment: number | null; rate2TermMonths: number | null }`
  - `interface ExistingPricingTemplate` (รูปของ `GET /pricing-templates`) · `interface PricingImportReview { rows: ImportReviewRow[]; toSend: PricingImportItem[]; missingActive: ExistingPricingTemplate[] }`
  - `pricingKey(t)` · `parsePricingRow(row)` · `buildPricingImportReview(rows, existing): PricingImportReview`
  - `sendPricingImport(post, items, deactivateIds, onProgress?): Promise<{ saved: number; deactivated: number }>` — ส่ง `items` ชุดละ 100 ตามลำดับ · `deactivateIds` ไปกับชุดสุดท้าย · ชุดใดมี `errors` → โยน `ImportBatchError` บอกเลขชุดและจำนวนที่บันทึกแล้ว

กติกาหน้าตรวจ: แถวว่างไม่นับ · ข้อมูลผิด → ข้าม + เหตุผล · คีย์ซ้ำในไฟล์ → ข้าม "ซ้ำกับแถว N" · มีแถวเดิมค่าเท่ากันทุกช่อง → ข้าม "ราคาเท่าเดิม" (ไม่ส่ง) · ค่าต่าง → แก้ + รายการ "ช่อง เดิม → ใหม่" · ไม่มีแถวเดิม → เพิ่ม · `missingActive` = แถวที่เปิดอยู่ซึ่งคีย์ไม่ตรงแถวที่ถูกต้องใดในไฟล์ · คีย์ตรงกับ unique ของฐานข้อมูล (ยี่ห้อ, รุ่น, ความจุ ตามตัวอักษร · ประเภท · ประกัน · ที่มาเครื่อง)

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน**

`apps/web/src/pages/pricing-templates/pricingTemplateImport.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { ImportBatchError } from '@/utils/excel-cell.util';
import {
  PRICING_HEADER,
  PRICING_IMPORT_HEADERS,
  buildPricingImportReview,
  parsePricingRow,
  sendPricingImport,
  type ExistingPricingTemplate,
  type PricingImportItem,
} from './pricingTemplateImport';

const row = (over: Record<string, unknown> = {}) => ({
  'ยี่ห้อ': 'Apple',
  'รุ่น': 'iPhone 17 Pro',
  'ความจุ': '256GB',
  'เครื่องไทย/นอก': null,
  'ประเภท': 'มือ 1',
  'ประกัน': null,
  'ราคาเงินสด': 39000,
  'ราคาผ่อน BESTCHOICE (ราคาเต็ม)': 39000,
  'ราคาขาย GFIN (ราคาเต็ม)': 39000,
  'งวดเรท 1': 12,
  'ดาวน์เรท 1': 15000,
  'งวดเรท 2': null,
  ...over,
});

const existing = (over: Partial<ExistingPricingTemplate> = {}): ExistingPricingTemplate => ({
  id: 't1',
  brand: 'Apple',
  model: 'iPhone 17 Pro',
  storage: '256GB',
  category: 'PHONE_NEW',
  hasWarranty: false,
  deviceOrigin: 'UNSPECIFIED',
  cashPrice: '39000.00',
  installmentBestchoicePrice: '39000.00',
  installmentFinancePrice: '39000.00',
  rate1DownPayment: '15000.00',
  rate1TermMonths: 12,
  rate2TermMonths: null,
  ...over,
});

describe('หัวคอลัมน์', () => {
  it('ลำดับในแบบฟอร์มครบทุกช่อง', () => {
    expect([...PRICING_IMPORT_HEADERS]).toEqual(Object.values(PRICING_HEADER));
    expect(PRICING_IMPORT_HEADERS).toHaveLength(12);
  });
});

describe('parsePricingRow', () => {
  it('แถวครบ → รายการพร้อมงวด/ดาวน์ · ช่องว่าง = null · ที่มาเครื่องว่าง = ไม่ระบุ', () => {
    expect(parsePricingRow(row())).toEqual({
      label: 'Apple iPhone 17 Pro 256GB มือ 1',
      item: {
        brand: 'Apple',
        model: 'iPhone 17 Pro',
        storage: '256GB',
        deviceOrigin: 'UNSPECIFIED',
        category: 'PHONE_NEW',
        hasWarranty: false,
        cashPrice: 39000,
        installmentBestchoicePrice: 39000,
        installmentFinancePrice: 39000,
        rate1TermMonths: 12,
        rate1DownPayment: 15000,
        rate2TermMonths: null,
      },
    });
  });

  it('อ่านหัวคอลัมน์แบบฟอร์มเก่าได้', () => {
    const legacy: Record<string, unknown> = { ...row(), 'ราคาผ่อน BESTCHOICE': 31000, 'ราคาผ่อนไฟแนนซ์': 30000 };
    delete legacy['ราคาผ่อน BESTCHOICE (ราคาเต็ม)'];
    delete legacy['ราคาขาย GFIN (ราคาเต็ม)'];
    const parsed = parsePricingRow(legacy);
    expect(parsed && 'item' in parsed && parsed.item).toMatchObject({
      installmentBestchoicePrice: 31000,
      installmentFinancePrice: 30000,
    });
  });

  it('มือ 2 อ่านประกัน · เครื่องไทย/นอก', () => {
    const parsed = parsePricingRow(row({ 'ประเภท': 'มือ 2', 'ประกัน': 'มีประกัน', 'เครื่องไทย/นอก': 'เครื่องไทย' }));
    expect(parsed && 'item' in parsed && parsed.item).toMatchObject({
      category: 'PHONE_USED',
      hasWarranty: true,
      deviceOrigin: 'THAI',
    });
  });

  it.each([
    [{ 'ยี่ห้อ': '' }, 'ไม่มียี่ห้อหรือรุ่น'],
    [{ 'ประเภท': 'มือสาม' }, 'ประเภทต้องเป็น มือ 1 หรือ มือ 2'],
    [{ 'ประเภท': 'มือ 2' }, 'มือ 2 ต้องระบุ มีประกัน หรือ ไม่มีประกัน'],
    [{ 'เครื่องไทย/นอก': 'ญี่ปุ่น' }, 'เครื่องไทย/นอก ต้องเป็น เครื่องไทย · เครื่องนอก · หรือเว้นว่าง'],
    [{ 'ราคาเงินสด': 0 }, 'ราคาเงินสด ต้องเป็นตัวเลขมากกว่า 0'],
    [{ 'ราคาขาย GFIN (ราคาเต็ม)': 'abc' }, 'ราคาขาย GFIN ต้องเป็นตัวเลขมากกว่า 0'],
    [{ 'งวดเรท 1': 12.5 }, 'งวดเรท 1 ต้องเป็นจำนวนเต็ม 1–60 หรือเว้นว่าง'],
    [{ 'งวดเรท 2': 0 }, 'งวดเรท 2 ต้องเป็นจำนวนเต็ม 1–60 หรือเว้นว่าง'],
    [{ 'ดาวน์เรท 1': 39000 }, 'ดาวน์เรท 1 ต้องมากกว่า 0 และน้อยกว่าราคาผ่อน BESTCHOICE'],
  ])('ข้อมูลผิด %o → %s', (over, error) => {
    expect(parsePricingRow(row(over))).toMatchObject({ error });
  });

  it('แถวว่างทั้งแถว → null (ไม่นับ)', () => {
    expect(parsePricingRow({ 'ยี่ห้อ': null, 'รุ่น': '', 'ราคาเงินสด': null })).toBeNull();
  });
});

describe('buildPricingImportReview', () => {
  it('เพิ่ม / แก้ (บอกค่าเดิม → ใหม่) / ข้ามราคาเท่าเดิม / ข้ามแถวซ้ำ / แถวผิด + แถวที่ไม่อยู่ในไฟล์', () => {
    const review = buildPricingImportReview(
      [
        row(),
        row({ 'รุ่น': 'iPhone 17 Pro Max', 'ราคาเงินสด': 45900 }),
        row({ 'รุ่น': 'iPhone 18 Pro', 'ราคาเงินสด': 48900, 'งวดเรท 2': 15, 'ดาวน์เรท 1': 18000 }),
        row({ 'รุ่น': 'iPhone 18 Pro', 'ราคาเงินสด': 48900 }),
        row({ 'ประเภท': 'มือสาม' }),
        { 'ยี่ห้อ': null, 'รุ่น': null },
      ],
      [
        existing(),
        existing({ id: 't2', model: 'iPhone 17 Pro Max', cashPrice: '44900.00' }),
        existing({ id: 't3', model: 'iPhone 14', storage: '128GB' }),
      ],
    );
    expect(review.rows).toEqual([
      { rowNumber: 2, label: 'Apple iPhone 17 Pro 256GB มือ 1', action: 'SKIP', detail: 'ราคาเท่าเดิม' },
      { rowNumber: 3, label: 'Apple iPhone 17 Pro Max 256GB มือ 1', action: 'UPDATE', detail: 'เงินสด 44,900 → 45,900' },
      { rowNumber: 4, label: 'Apple iPhone 18 Pro 256GB มือ 1', action: 'ADD' },
      { rowNumber: 5, label: 'Apple iPhone 18 Pro 256GB มือ 1', action: 'SKIP', detail: 'ซ้ำกับแถว 4' },
      { rowNumber: 6, label: 'Apple iPhone 17 Pro 256GB มือสาม', action: 'SKIP', detail: 'ประเภทต้องเป็น มือ 1 หรือ มือ 2' },
    ]);
    expect(review.toSend.map((i) => i.model)).toEqual(['iPhone 17 Pro Max', 'iPhone 18 Pro']);
    expect(review.missingActive.map((t) => t.id)).toEqual(['t3']);
  });

  it('งวด/ดาวน์ที่เปลี่ยนถูกนับเป็นการแก้ (ว่าง ↔ มีค่า)', () => {
    const review = buildPricingImportReview([row({ 'ดาวน์เรท 1': null })], [existing()]);
    expect(review.rows[0]).toMatchObject({ action: 'UPDATE', detail: 'ดาวน์เรท 1 15,000 → ว่าง' });
  });

  it('มือ 2 มีประกัน กับ ไม่มีประกัน เป็นคนละแถว', () => {
    const used = (warranty: string) => row({ 'ประเภท': 'มือ 2', 'ประกัน': warranty });
    const review = buildPricingImportReview([used('มีประกัน'), used('ไม่มีประกัน')], []);
    expect(review.rows.map((r) => r.action)).toEqual(['ADD', 'ADD']);
  });
});

describe('sendPricingImport', () => {
  const item = { model: 'x' } as PricingImportItem;

  it('ส่งชุดละ 100 ตามลำดับ · deactivateIds ไปกับชุดสุดท้าย · รายงานความคืบหน้า', async () => {
    const post = vi.fn(async (body: { items: PricingImportItem[]; deactivateIds?: string[] }) => ({
      success: body.items.length,
      skipped: 0,
      errors: [],
      ...(body.deactivateIds ? { deactivated: body.deactivateIds.length } : {}),
    }));
    const progress = vi.fn();
    const result = await sendPricingImport(post, Array(205).fill(item), ['a', 'b'], progress);
    expect(post.mock.calls.map(([b]) => [b.items.length, b.deactivateIds])).toEqual([
      [100, undefined],
      [100, undefined],
      [5, ['a', 'b']],
    ]);
    expect(progress.mock.calls).toEqual([[1, 3], [2, 3], [3, 3]]);
    expect(result).toEqual({ saved: 205, deactivated: 2 });
  });

  it('ไม่มีแถวที่จะส่งแต่ต้องปิดแถว → ส่งชุดว่างพร้อม deactivateIds', async () => {
    const post = vi.fn(async () => ({ success: 0, skipped: 0, errors: [], deactivated: 1 }));
    expect(await sendPricingImport(post, [], ['a'])).toEqual({ saved: 0, deactivated: 1 });
    expect(post).toHaveBeenCalledWith({ items: [], deactivateIds: ['a'] });
  });

  it('ชุดถูกปฏิเสธ → หยุด และบอกว่าชุดก่อนหน้าบันทึกแล้ว', async () => {
    const post = vi
      .fn()
      .mockResolvedValueOnce({ success: 100, skipped: 0, errors: [] })
      .mockResolvedValueOnce({ success: 0, skipped: 3, errors: ['ROW_2:INVALID_ROW'] });
    const error = await sendPricingImport(post, Array(150).fill(item), []).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ImportBatchError);
    expect((error as Error).message).toBe('ชุดที่ 2 ถูกปฏิเสธ (ROW_2:INVALID_ROW) — บันทึกแล้ว 100 แถวจากชุดก่อนหน้า');
  });
});
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**

Run: `cd apps/web && npx vitest run src/pages/pricing-templates/pricingTemplateImport.test.ts`
Expected: FAIL — `Failed to resolve import "./pricingTemplateImport"`

- [ ] **Step 3: เขียนโค้ด**

`apps/web/src/pages/pricing-templates/pricingTemplateImport.ts`:

```ts
import type { ImportReviewRow } from '@/components/import/ImportReviewDialog';
import { ImportBatchError, cellText, chunk } from '@/utils/excel-cell.util';

/** ชื่อหัวคอลัมน์ของไฟล์นำเข้าราคากลาง (สเปคข้อ 7.4) */
export const PRICING_HEADER = {
  brand: 'ยี่ห้อ',
  model: 'รุ่น',
  storage: 'ความจุ',
  origin: 'เครื่องไทย/นอก',
  category: 'ประเภท',
  warranty: 'ประกัน',
  cash: 'ราคาเงินสด',
  bc: 'ราคาผ่อน BESTCHOICE (ราคาเต็ม)',
  finance: 'ราคาขาย GFIN (ราคาเต็ม)',
  rate1Term: 'งวดเรท 1',
  rate1Down: 'ดาวน์เรท 1',
  rate2Term: 'งวดเรท 2',
} as const;

/** ลำดับคอลัมน์ในแบบฟอร์ม — สคริปต์เตรียมไฟล์จากชีตตรวจเทียบกับรายการนี้ */
export const PRICING_IMPORT_HEADERS = [
  'ยี่ห้อ',
  'รุ่น',
  'ความจุ',
  'เครื่องไทย/นอก',
  'ประเภท',
  'ประกัน',
  'ราคาเงินสด',
  'ราคาผ่อน BESTCHOICE (ราคาเต็ม)',
  'ราคาขาย GFIN (ราคาเต็ม)',
  'งวดเรท 1',
  'ดาวน์เรท 1',
  'งวดเรท 2',
] as const;

/** หัวคอลัมน์ของแบบฟอร์มเก่า (ก่อนสเปคข้อ 3.1) */
const LEGACY_HEADER: Partial<Record<string, string>> = {
  [PRICING_HEADER.bc]: 'ราคาผ่อน BESTCHOICE',
  [PRICING_HEADER.finance]: 'ราคาผ่อนไฟแนนซ์',
};

export const IMPORT_BATCH_SIZE = 100;

export type PricingOrigin = 'UNSPECIFIED' | 'THAI' | 'IMPORTED';

export interface PricingImportItem {
  brand: string;
  model: string;
  storage?: string;
  deviceOrigin: PricingOrigin;
  category: 'PHONE_NEW' | 'PHONE_USED';
  hasWarranty: boolean;
  cashPrice: number;
  installmentBestchoicePrice: number;
  installmentFinancePrice: number;
  rate1TermMonths: number | null;
  rate1DownPayment: number | null;
  rate2TermMonths: number | null;
}

/** รูปแถวจาก GET /pricing-templates (Decimal มาเป็นข้อความ) */
export interface ExistingPricingTemplate {
  id: string;
  brand: string;
  model: string;
  storage: string | null;
  category: string;
  hasWarranty: boolean | null;
  deviceOrigin?: string;
  cashPrice: string | number;
  installmentBestchoicePrice: string | number;
  installmentFinancePrice: string | number;
  rate1DownPayment: string | number | null;
  rate1TermMonths: number | null;
  rate2TermMonths: number | null;
}

export interface PricingImportReview {
  rows: ImportReviewRow[];
  toSend: PricingImportItem[];
  missingActive: ExistingPricingTemplate[];
}

const ORIGINS: Record<string, PricingOrigin> = {
  '': 'UNSPECIFIED',
  'ยังไม่ระบุ': 'UNSPECIFIED',
  'ไม่ระบุ': 'UNSPECIFIED',
  'เครื่องไทย': 'THAI',
  'เครื่องนอก': 'IMPORTED',
  UNSPECIFIED: 'UNSPECIFIED',
  THAI: 'THAI',
  IMPORTED: 'IMPORTED',
};

function cell(row: Record<string, unknown>, header: string): string {
  const own = cellText(row[header]);
  const legacy = LEGACY_HEADER[header];
  return own !== '' || !legacy ? own : cellText(row[legacy]);
}

/** ว่าง → null · ไม่ใช่ตัวเลข → NaN */
function amount(text: string): number | null {
  if (text === '') return null;
  const n = Number(text.replace(/,/g, ''));
  return Number.isFinite(n) ? n : Number.NaN;
}

const badTerm = (v: number | null) => v !== null && !(Number.isInteger(v) && v >= 1 && v <= 60);

export function pricingKey(t: {
  brand: string;
  model: string;
  storage?: string | null;
  category: string;
  hasWarranty: boolean | null;
  deviceOrigin?: string;
}): string {
  const warranty = t.category === 'PHONE_USED' ? String(t.hasWarranty === true) : 'false';
  return [t.brand, t.model, t.storage ?? '', t.category, warranty, t.deviceOrigin ?? 'UNSPECIFIED'].join('|');
}

type ParsedRow = { label: string; item: PricingImportItem } | { label: string; error: string } | null;

export function parsePricingRow(row: Record<string, unknown>): ParsedRow {
  const brand = cell(row, PRICING_HEADER.brand);
  const model = cell(row, PRICING_HEADER.model);
  const storage = cell(row, PRICING_HEADER.storage);
  const categoryText = cell(row, PRICING_HEADER.category).replace(/\s+/g, ' ');
  const warrantyText = cell(row, PRICING_HEADER.warranty);
  const originText = cell(row, PRICING_HEADER.origin);
  const cashText = cell(row, PRICING_HEADER.cash);
  if (!brand && !model && !cashText) return null;
  const label = [brand, model, storage, categoryText, warrantyText, originText].filter(Boolean).join(' ');

  if (!brand || !model) return { label, error: 'ไม่มียี่ห้อหรือรุ่น' };
  if (!(originText in ORIGINS))
    return { label, error: 'เครื่องไทย/นอก ต้องเป็น เครื่องไทย · เครื่องนอก · หรือเว้นว่าง' };
  const compact = categoryText.replace(/\s+/g, '');
  const category = compact === 'มือ1' ? 'PHONE_NEW' : compact === 'มือ2' ? 'PHONE_USED' : null;
  if (!category) return { label, error: 'ประเภทต้องเป็น มือ 1 หรือ มือ 2' };
  let hasWarranty = false;
  if (category === 'PHONE_USED') {
    if (warrantyText !== 'มีประกัน' && warrantyText !== 'ไม่มีประกัน')
      return { label, error: 'มือ 2 ต้องระบุ มีประกัน หรือ ไม่มีประกัน' };
    hasWarranty = warrantyText === 'มีประกัน';
  }

  const cash = amount(cashText);
  const bc = amount(cell(row, PRICING_HEADER.bc));
  const finance = amount(cell(row, PRICING_HEADER.finance));
  if (cash === null || !(cash > 0)) return { label, error: 'ราคาเงินสด ต้องเป็นตัวเลขมากกว่า 0' };
  if (bc === null || !(bc > 0)) return { label, error: 'ราคาผ่อน BESTCHOICE ต้องเป็นตัวเลขมากกว่า 0' };
  if (finance === null || !(finance > 0)) return { label, error: 'ราคาขาย GFIN ต้องเป็นตัวเลขมากกว่า 0' };

  const rate1Term = amount(cell(row, PRICING_HEADER.rate1Term));
  const rate1Down = amount(cell(row, PRICING_HEADER.rate1Down));
  const rate2Term = amount(cell(row, PRICING_HEADER.rate2Term));
  if (badTerm(rate1Term)) return { label, error: 'งวดเรท 1 ต้องเป็นจำนวนเต็ม 1–60 หรือเว้นว่าง' };
  if (badTerm(rate2Term)) return { label, error: 'งวดเรท 2 ต้องเป็นจำนวนเต็ม 1–60 หรือเว้นว่าง' };
  if (rate1Down !== null && !(rate1Down > 0 && rate1Down < bc))
    return { label, error: 'ดาวน์เรท 1 ต้องมากกว่า 0 และน้อยกว่าราคาผ่อน BESTCHOICE' };

  return {
    label,
    item: {
      brand,
      model,
      storage: storage || undefined,
      deviceOrigin: ORIGINS[originText],
      category,
      hasWarranty,
      cashPrice: cash,
      installmentBestchoicePrice: bc,
      installmentFinancePrice: finance,
      rate1TermMonths: rate1Term,
      rate1DownPayment: rate1Down,
      rate2TermMonths: rate2Term,
    },
  };
}

const num = (v: string | number | null): number | null => (v === null || v === '' ? null : Number(v));
const show = (v: number | null) => (v === null ? 'ว่าง' : v.toLocaleString('th-TH'));

function changesOf(before: ExistingPricingTemplate, after: PricingImportItem): string[] {
  const pairs: [string, number | null, number | null][] = [
    ['เงินสด', num(before.cashPrice), after.cashPrice],
    ['ราคาผ่อน BESTCHOICE', num(before.installmentBestchoicePrice), after.installmentBestchoicePrice],
    ['ราคาขาย GFIN', num(before.installmentFinancePrice), after.installmentFinancePrice],
    ['งวดเรท 1', before.rate1TermMonths, after.rate1TermMonths],
    ['ดาวน์เรท 1', num(before.rate1DownPayment), after.rate1DownPayment],
    ['งวดเรท 2', before.rate2TermMonths, after.rate2TermMonths],
  ];
  return pairs.filter(([, a, b]) => a !== b).map(([name, a, b]) => `${name} ${show(a)} → ${show(b)}`);
}

/** หน้าตรวจก่อนยืนยัน (สเปคข้อ 7.4) — เทียบไฟล์กับแถวที่เปิดใช้อยู่ (GET /pricing-templates) */
export function buildPricingImportReview(
  rows: Record<string, unknown>[],
  existing: ExistingPricingTemplate[],
): PricingImportReview {
  const byKey = new Map(existing.map((t) => [pricingKey(t), t]));
  const seen = new Map<string, number>();
  const review: ImportReviewRow[] = [];
  const toSend: PricingImportItem[] = [];

  rows.forEach((row, index) => {
    const rowNumber = index + 2; // แถว 1 = หัวคอลัมน์
    const parsed = parsePricingRow(row);
    if (!parsed) return;
    if ('error' in parsed) {
      review.push({ rowNumber, label: parsed.label, action: 'SKIP', detail: parsed.error });
      return;
    }
    const key = pricingKey(parsed.item);
    const duplicateOf = seen.get(key);
    if (duplicateOf !== undefined) {
      review.push({ rowNumber, label: parsed.label, action: 'SKIP', detail: `ซ้ำกับแถว ${duplicateOf}` });
      return;
    }
    seen.set(key, rowNumber);
    const before = byKey.get(key);
    if (!before) {
      review.push({ rowNumber, label: parsed.label, action: 'ADD' });
      toSend.push(parsed.item);
      return;
    }
    const changes = changesOf(before, parsed.item);
    if (changes.length === 0) {
      review.push({ rowNumber, label: parsed.label, action: 'SKIP', detail: 'ราคาเท่าเดิม' });
      return;
    }
    review.push({ rowNumber, label: parsed.label, action: 'UPDATE', detail: changes.join(' · ') });
    toSend.push(parsed.item);
  });

  return { rows: review, toSend, missingActive: existing.filter((t) => !seen.has(pricingKey(t))) };
}

export interface PricingImportResponse {
  success: number;
  skipped: number;
  errors: string[];
  deactivated?: number;
}

/** ส่งชุดละ 100 ตามลำดับ · deactivateIds ไปกับชุดสุดท้าย (สเปคข้อ 7.4) */
export async function sendPricingImport(
  post: (body: { items: PricingImportItem[]; deactivateIds?: string[] }) => Promise<PricingImportResponse>,
  items: PricingImportItem[],
  deactivateIds: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<{ saved: number; deactivated: number }> {
  if (items.length === 0 && deactivateIds.length === 0) return { saved: 0, deactivated: 0 };
  const batches = chunk(items, IMPORT_BATCH_SIZE);
  if (batches.length === 0) batches.push([]);
  let saved = 0;
  let deactivated = 0;
  for (let i = 0; i < batches.length; i++) {
    onProgress?.(i + 1, batches.length);
    const last = i === batches.length - 1;
    const res = await post({
      items: batches[i],
      ...(last && deactivateIds.length > 0 ? { deactivateIds } : {}),
    });
    if (res.errors.length > 0)
      throw new ImportBatchError(
        `ชุดที่ ${i + 1} ถูกปฏิเสธ (${res.errors.join(', ')}) — บันทึกแล้ว ${saved} แถวจากชุดก่อนหน้า`,
      );
    saved += res.success;
    deactivated += res.deactivated ?? 0;
  }
  return { saved, deactivated };
}
```

- [ ] **Step 4: รันให้ผ่าน**

Run: `cd apps/web && npx vitest run src/pages/pricing-templates/pricingTemplateImport.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/pricing-templates/pricingTemplateImport.ts apps/web/src/pages/pricing-templates/pricingTemplateImport.test.ts
git commit -m "feat(web): pricing template import parser, review and 100-row batches" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: หน้าตั้งราคา — ป้าย "ราคาเต็ม" · คอลัมน์งวด/ดาวน์ · แบบฟอร์ม Excel 3 คอลัมน์ใหม่ · หน้าตรวจก่อนนำเข้า

**Files:**
- Modify: `apps/web/src/pages/PricingTemplatesPage.tsx`
- Create: `apps/web/src/pages/__tests__/PricingTemplatesPage.import.test.tsx`

**Interfaces:**
- Consumes: `ImportReviewDialog` (Task 2) · `ImportBatchError` (Task 2) · `PRICING_IMPORT_HEADERS`, `buildPricingImportReview`, `sendPricingImport`, `ExistingPricingTemplate`, `PricingImportItem`, `PricingImportReview` (Task 3) · `POST /pricing-templates/import` body ใหม่ (Task 1)
- Produces: UI เท่านั้น — หัวตาราง "ราคาผ่อน BESTCHOICE (ราคาเต็ม)" / "ราคาขาย GFIN (ราคาเต็ม)" · คอลัมน์ "งวด / ดาวน์" · ฟอร์มแก้รุ่นมีงวดเรท 1 / ดาวน์เรท 1 / งวดเรท 2 (ช่องดาวน์เรท 2 ถูกเอาออก — สเปค 3.1 ไม่ใช้) · ปุ่ม "นำเข้า Excel" เปิดหน้าตรวจ

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน**

`apps/web/src/pages/__tests__/PricingTemplatesPage.import.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const apiGet = vi.fn();
const apiPost = vi.fn();
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  default: { get: (...a: unknown[]) => apiGet(...a), post: (...a: unknown[]) => apiPost(...a), put: vi.fn(), delete: vi.fn() },
}));
const importFromExcel = vi.fn();
vi.mock('@/utils/excel.util', () => ({
  importFromExcel: (...a: unknown[]) => importFromExcel(...a),
  downloadExcelBuffer: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { toast } from 'sonner';
import PricingTemplatesPage from '../PricingTemplatesPage';

const template = {
  id: 't1',
  deviceOrigin: 'UNSPECIFIED',
  brand: 'Apple',
  model: 'iPhone 17 Pro',
  storage: '256GB',
  category: 'PHONE_NEW',
  hasWarranty: false,
  cashPrice: '39000.00',
  installmentBestchoicePrice: '39000.00',
  installmentFinancePrice: '39000.00',
  isActive: true,
  rate1DownPayment: '15000.00',
  rate1TermMonths: 12,
  rate2DownPayment: null,
  rate2TermMonths: 15,
};

function Wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  apiGet.mockReset().mockResolvedValue({ data: [template] });
  apiPost.mockReset().mockResolvedValue({ data: { success: 1, skipped: 0, errors: [], deactivated: 1 } });
  importFromExcel.mockReset();
  vi.mocked(toast.success).mockClear();
});

describe('PricingTemplatesPage', () => {
  it('ป้ายราคาผ่อนบอกว่าเป็นราคาเต็ม และแสดงงวด/ดาวน์ของรุ่น', async () => {
    render(<Wrapper><PricingTemplatesPage /></Wrapper>);
    expect(await screen.findByText('เรท 1: 12 งวด · ดาวน์ 15,000')).toBeInTheDocument();
    expect(screen.getByText('เรท 2: 15 งวด')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'ราคาผ่อน BESTCHOICE (ราคาเต็ม)' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'ราคาขาย GFIN (ราคาเต็ม)' })).toBeInTheDocument();
  });

  it('นำเข้า: อ่านไฟล์ → หน้าตรวจ → ติ๊กปิดแถวที่ไม่อยู่ในไฟล์ → ส่งรายการพร้อม deactivateIds', async () => {
    importFromExcel.mockResolvedValue([
      {
        'ยี่ห้อ': 'Apple',
        'รุ่น': 'iPhone 15',
        'ความจุ': '128GB',
        'ประเภท': 'มือ 1',
        'ราคาเงินสด': 25900,
        'ราคาผ่อน BESTCHOICE (ราคาเต็ม)': 25900,
        'ราคาขาย GFIN (ราคาเต็ม)': 25900,
        'งวดเรท 1': 12,
      },
    ]);
    const { container } = render(<Wrapper><PricingTemplatesPage /></Wrapper>);
    await screen.findByText('เรท 1: 12 งวด · ดาวน์ 15,000');
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['x'], 'prices.xlsx')] } });

    expect(await screen.findByText('ตรวจรายการก่อนยืนยัน — เพิ่ม 1 · แก้ 0 · ข้าม 0 แถว')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: 'ปิดแถวที่เปิดใช้อยู่แต่ไม่อยู่ในไฟล์ (1 แถว)' }));
    await userEvent.click(screen.getByRole('button', { name: 'ยืนยันนำเข้า' }));

    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith('/pricing-templates/import', {
        items: [
          {
            brand: 'Apple',
            model: 'iPhone 15',
            storage: '128GB',
            deviceOrigin: 'UNSPECIFIED',
            category: 'PHONE_NEW',
            hasWarranty: false,
            cashPrice: 25900,
            installmentBestchoicePrice: 25900,
            installmentFinancePrice: 25900,
            rate1TermMonths: 12,
            rate1DownPayment: null,
            rate2TermMonths: null,
          },
        ],
        deactivateIds: ['t1'],
      }),
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('นำเข้าแล้ว 1 แถว · ปิด 1 แถว'));
  });
});
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**

Run: `cd apps/web && npx vitest run src/pages/__tests__/PricingTemplatesPage.import.test.tsx`
Expected: FAIL — ไม่พบข้อความ `เรท 1: 12 งวด · ดาวน์ 15,000` · หัวตารางยังเป็น `ผ่อน BESTCHOICE`

- [ ] **Step 3: แก้โค้ด** (`apps/web/src/pages/PricingTemplatesPage.tsx`)

1. import — ต่อจาก `import { cn } from '@/lib/utils';` เพิ่ม:

```tsx
import { ImportReviewDialog } from '@/components/import/ImportReviewDialog';
import { ImportBatchError } from '@/utils/excel-cell.util';
import {
  PRICING_IMPORT_HEADERS,
  buildPricingImportReview,
  sendPricingImport,
  type ExistingPricingTemplate,
  type PricingImportItem,
  type PricingImportReview,
} from './pricing-templates/pricingTemplateImport';
```

2. interface `PricingTemplate`: `rate1DownPayment: number | null;` → `rate1DownPayment: string | number | null;`

3. state — ต่อจาก `const fileInputRef = useRef<HTMLInputElement>(null);` เพิ่ม:

```tsx
  const [review, setReview] = useState<PricingImportReview | null>(null);
  const [importProgress, setImportProgress] = useState<string | null>(null);
```

4. แทน `const importMutation = useMutation({ … });` (บรรทัด 122–136) ทั้งบล็อกด้วย:

```tsx
  const importMutation = useMutation({
    mutationFn: ({ items, deactivateIds }: { items: PricingImportItem[]; deactivateIds: string[] }) =>
      sendPricingImport(
        async (body) => (await api.post('/pricing-templates/import', body)).data,
        items,
        deactivateIds,
        (done, total) => setImportProgress(`กำลังนำเข้า ชุด ${done}/${total}`),
      ),
    onSuccess: ({ saved, deactivated }) => {
      queryClient.invalidateQueries({ queryKey: ['pricing-templates'] });
      toast.success(deactivated > 0 ? `นำเข้าแล้ว ${saved} แถว · ปิด ${deactivated} แถว` : `นำเข้าแล้ว ${saved} แถว`);
      setReview(null);
    },
    onError: (err: unknown) => {
      queryClient.invalidateQueries({ queryKey: ['pricing-templates'] });
      toast.error(err instanceof ImportBatchError ? err.message : getErrorMessage(err));
    },
    onSettled: () => setImportProgress(null),
  });
```

5. แทนเนื้อ `downloadTemplate` (บรรทัด 138–185) ด้วย:

```tsx
  const downloadTemplate = async () => {
    // Dynamic import — keeps exceljs out of the page's initial chunk
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();

    const ws = wb.addWorksheet('ราคาตั้งต้น');
    ws.columns = PRICING_IMPORT_HEADERS.map((header) => ({ header, key: header, width: Math.max(10, header.length + 4) }));
    const sample = (
      model: string, storage: string, category: string, warranty: string,
      cash: number, bc: number, finance: number, term1: number, down1: number | null, term2: number | null,
    ) => ({
      'ยี่ห้อ': 'Apple', 'รุ่น': model, 'ความจุ': storage, 'เครื่องไทย/นอก': '', 'ประเภท': category, 'ประกัน': warranty,
      'ราคาเงินสด': cash, 'ราคาผ่อน BESTCHOICE (ราคาเต็ม)': bc, 'ราคาขาย GFIN (ราคาเต็ม)': finance,
      'งวดเรท 1': term1, 'ดาวน์เรท 1': down1, 'งวดเรท 2': term2,
    });
    ws.addRows([
      sample('iPhone 15', '128GB', 'มือ 1', '', 25900, 25900, 25900, 12, null, null),
      sample('iPhone 18 Pro', '256GB', 'มือ 1', '', 48900, 48900, 48900, 12, 18000, 15),
      sample('iPhone 13', '128GB', 'มือ 2', 'มีประกัน', 12500, 10200, 9600, 12, null, null),
      sample('iPhone 13', '128GB', 'มือ 2', 'ไม่มีประกัน', 12500, 10200, 9600, 12, null, null),
    ]);

    const wsInstr = wb.addWorksheet('คำอธิบาย');
    wsInstr.columns = [{ width: 30 }, { width: 70 }];
    wsInstr.addRows([
      ['คำอธิบายคอลัมน์', ''],
      ['ยี่ห้อ', 'ชื่อยี่ห้อ เช่น Apple'],
      ['รุ่น', 'ชื่อรุ่นให้ตรงรายชื่อรุ่นในโปรแกรม เช่น iPhone 15 Pro Max'],
      ['ความจุ', 'เช่น 128GB, 1TB · เว้นว่าง = ทุกความจุ'],
      ['เครื่องไทย/นอก', 'เครื่องไทย หรือ เครื่องนอก · เว้นว่าง = ไม่ระบุ (ใช้เมื่อไม่มีแถวของเครื่องไทย/นอก)'],
      ['ประเภท', '"มือ 1" หรือ "มือ 2"'],
      ['ประกัน', 'มือ 2: "มีประกัน" หรือ "ไม่มีประกัน" · มือ 1 เว้นว่าง'],
      ['ราคาเงินสด', 'ตัวเลข'],
      ['ราคาผ่อน BESTCHOICE (ราคาเต็ม)', 'ราคาเต็มที่ใช้คิดผ่อนกับร้าน (ไม่ใช่ค่างวด)'],
      ['ราคาขาย GFIN (ราคาเต็ม)', 'ราคาขายเมื่อผ่อนกับ GFIN (ไม่ใช่ค่างวด)'],
      ['งวดเรท 1', 'จำนวนงวดผ่อนกับร้าน · เว้นว่าง = 12 งวด (ถ้าตั้งค่าดอกเบี้ยไม่มี 12 ใช้งวดแรกที่มี)'],
      ['ดาวน์เรท 1', 'ดาวน์ผ่อนกับร้านเป็นบาท · เว้นว่าง = ดาวน์ขั้นต่ำปัดขึ้นหลักร้อย'],
      ['งวดเรท 2', 'จำนวนงวด GFIN · เว้นว่าง = งวดสูงสุดตามกติกา OVER'],
      [],
      ['หมายเหตุ', ''],
      ['- แถวที่ ยี่ห้อ+รุ่น+ความจุ+ประเภท+ประกัน+เครื่องไทย/นอก ตรงกับของเดิม จะแก้ทับ (ช่องที่เว้นว่างจะถูกล้าง)', ''],
      ['- ก่อนบันทึกจะมีหน้าตรวจ: เพิ่ม / แก้ / ข้าม พร้อมเหตุผล', ''],
    ]);

    const buffer = await wb.xlsx.writeBuffer();
    downloadExcelBuffer(buffer, 'แบบฟอร์มราคาตั้งต้น.xlsx');
  };
```

6. แทน `handleFileImport` (บรรทัด 187–233) ทั้งฟังก์ชันด้วย:

```tsx
  const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (fileInputRef.current) fileInputRef.current.value = '';

    let rows: Record<string, unknown>[];
    try {
      rows = await importFromExcel(file);
    } catch {
      toast.error('ไม่สามารถอ่านไฟล์ได้ กรุณาใช้ไฟล์ .xlsx');
      return;
    }
    if (rows.length === 0) {
      toast.error('ไฟล์ไม่มีข้อมูล');
      return;
    }
    try {
      // เทียบกับแถวที่เปิดใช้อยู่ทั้งหมด (ไม่ใช้ตัวกรองของหน้า)
      const { data: current } = await api.get<ExistingPricingTemplate[]>('/pricing-templates');
      const next = buildPricingImportReview(rows, current);
      if (next.rows.length === 0) {
        toast.error('ไม่พบข้อมูลที่ถูกต้อง กรุณาตรวจสอบหัวคอลัมน์');
        return;
      }
      setReview(next);
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };
```

7. `PageHeader subtitle` → `"ราคาเงินสด / ราคาผ่อน BESTCHOICE / ราคาขาย GFIN (ราคาเต็มทั้งสองช่อง) และงวด/ดาวน์ ตามรุ่นสินค้า"`

8. หัวตาราง — แทน

```tsx
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">ผ่อน BESTCHOICE</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">ผ่อนไฟแนนซ์</th>
```

ด้วย

```tsx
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">ราคาผ่อน BESTCHOICE (ราคาเต็ม)</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">ราคาขาย GFIN (ราคาเต็ม)</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">งวด / ดาวน์</th>
```

9. แถว — ต่อจาก `<td …>{fmt(t.installmentFinancePrice)} ฿</td>` เพิ่ม:

```tsx
                    <td className="px-4 py-3 text-xs text-muted-foreground leading-snug">
                      <div>
                        เรท 1: {t.rate1TermMonths ? `${t.rate1TermMonths} งวด` : 'งวดตั้งต้น'} ·{' '}
                        {t.rate1DownPayment != null ? `ดาวน์ ${fmt(String(t.rate1DownPayment))}` : 'ดาวน์ขั้นต่ำ'}
                      </div>
                      <div>เรท 2: {t.rate2TermMonths ? `${t.rate2TermMonths} งวด` : 'งวดสูงสุดของ GFIN'}</div>
                    </td>
```

10. ฟอร์ม — ป้าย `ราคาผ่อน BESTCHOICE (บาท) *` → `ราคาผ่อน BESTCHOICE (ราคาเต็ม, บาท) *` · `ราคาผ่อนไฟแนนซ์ (บาท) *` → `ราคาขาย GFIN (ราคาเต็ม, บาท) *` · หัวข้อ `ดาวน์ + จำนวนเดือน (เว้นว่าง = ใช้ค่าเริ่มต้นจาก Settings)` → `งวด / ดาวน์ของรุ่นนี้ (เว้นว่าง = ใช้กติกาตั้งต้น)` · ป้าย `ดาวน์เรทที่ 1 (บาท)` → `ดาวน์เรท 1 (บาท · ว่าง = ขั้นต่ำปัดขึ้นหลักร้อย)` · `จำนวนเดือนเรทที่ 1` → `งวดเรท 1 (ว่าง = 12 งวด)` · `จำนวนเดือนเรทที่ 2` → `งวดเรท 2 (ว่าง = งวดสูงสุดของ GFIN)` · ลบ `<div>` ของช่อง `ดาวน์เรทที่ 2 (บาท)` (id `${uiFieldId}-10`) ทั้งก้อน · `rate1DownPayment: t.rate1DownPayment ?? undefined` ใน `openEdit` → `rate1DownPayment: t.rate1DownPayment != null ? Number(t.rate1DownPayment) : undefined`

11. ก่อน `<ConfirmDialog …/>` บรรทัดท้าย เพิ่ม:

```tsx
      {review && (
        <ImportReviewDialog
          title="ตรวจไฟล์ราคากลางก่อนนำเข้า"
          rows={review.rows}
          deactivateCount={review.missingActive.length}
          pending={importMutation.isPending}
          progress={importProgress}
          onCancel={() => setReview(null)}
          onConfirm={({ deactivateMissing }) =>
            importMutation.mutate({
              items: review.toSend,
              deactivateIds: deactivateMissing ? review.missingActive.map((t) => t.id) : [],
            })
          }
        />
      )}
```

- [ ] **Step 4: รันให้ผ่าน + ตรวจชนิด**

Run: `cd apps/web && npx vitest run src/pages/__tests__/PricingTemplatesPage.import.test.tsx src/pages/settings/__tests__/products-migration.test.tsx src/pages/__tests__/touchTargets.test.ts src/pages/__tests__/tabsButtonRowsNowrap.test.ts && npx tsc --noEmit`
Expected: PASS · 0 type errors

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/PricingTemplatesPage.tsx apps/web/src/pages/__tests__/PricingTemplatesPage.import.test.tsx
git commit -m "feat(web): pricing page labels full prices, shows term/down, imports with a review step" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: API นำเข้าใบราคา GFIN (`POST /gfin-config/max-prices/import`, เจ้าของเท่านั้น)

**Files:**
- Create: `apps/api/src/modules/gfin-config/dto/import-max-prices.dto.ts`
- Modify: `apps/api/src/modules/gfin-config/dto/index.ts` (เพิ่ม export)
- Modify: `apps/api/src/modules/gfin-config/gfin-config.service.ts` (เมธอดใหม่หลัง `softDeleteMaxPrice`)
- Modify: `apps/api/src/modules/gfin-config/gfin-config.controller.ts` (เมธอดใหม่หลัง `createMaxPrice`)
- Modify: `apps/api/src/modules/gfin-config/gfin-config.service.spec.ts`
- Modify: `apps/api/src/modules/employee-access/access-policy.manifest.json` (เพิ่ม 1 แถวต่อจาก `"GfinConfigController.getSettings"`)

**Interfaces:**
- Consumes: `GfinCondition` (Prisma) · `AuditService.log`
- Produces:
  - `ImportMaxPricesDto { items: ImportMaxPriceItemDto[] }` (≤ 100) · `ImportMaxPriceItemDto { model: string; storage: string; condition: GfinCondition; maxPrice: number }`
  - `GfinConfigService.importMaxPrices(dto: ImportMaxPricesDto, userId: string): Promise<{ created: number; updated: number; unchanged: number }>`
  - กฎ (สเปค 7.7): `gfinSeries` = ชื่อรุ่นเต็ม · `gfinVariant` = null · `modelMatchPattern` = ชื่อรุ่นเต็ม · `storage` = ตัดช่องว่าง + ตัวพิมพ์ใหญ่ · หาแถวเดิมเองด้วย (ชื่อรุ่นไม่สนตัวพิมพ์, ความจุ, สภาพ) เฉพาะแถวที่ไม่ถูกลบและ **ไม่มีรุ่นย่อย** · เจอ → แก้ราคา/คำจับคู่ + เปิดใช้ (ค่าเท่าเดิมและเปิดอยู่ = ไม่แตะ) · ไม่เจอ → สร้าง · ทั้งชุดในธุรกรรมเดียว · audit `GFIN_MAX_PRICE_IMPORTED`
  - ทะเบียนสิทธิ์: `settings.finance.manage` · `resource: none` · `resolution: none` · `surface` = `550f37b1c26befae35af` (จาก `["Controller('gfin-config')","UseGuards(JwtAuthGuard, RolesGuard)","Post('max-prices/import')","Roles('OWNER')"]`)

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน**

`gfin-config.service.spec.ts` — ต่อท้าย `describe('GfinConfigService', …)` (ก่อน `});` สุดท้าย):

```ts
  // ===== นำเข้าใบราคา (สเปค 7.7) =====

  describe('importMaxPrices', () => {
    const row = (over: Record<string, unknown> = {}) => ({
      id: 'm1',
      gfinSeries: 'iPhone 15',
      gfinVariant: null,
      storage: '128GB',
      condition: 'HAND_2',
      maxPrice: new Prisma.Decimal(16900),
      modelMatchPattern: 'iPhone 15',
      isActive: true,
      deletedAt: null,
      ...over,
    });

    beforeEach(() => {
      prisma.$transaction = jest.fn((fn: (tx: unknown) => unknown) => fn(prisma));
      prisma.gfinModelMapping.create.mockImplementation(({ data }: { data: object }) => ({ id: 'new', ...data }));
      prisma.gfinModelMapping.update.mockImplementation(({ data }: { data: object }) => ({ ...row(), ...data }));
    });

    it('ไม่มีแถวเดิม → สร้างด้วยชื่อรุ่นเต็ม · รุ่นย่อยว่าง · ความจุตัดช่องว่าง', async () => {
      prisma.gfinModelMapping.findMany.mockResolvedValue([]);
      const result = await service.importMaxPrices(
        { items: [{ model: 'iPhone 15 Pro Max', storage: '256 gb', condition: 'HAND_1', maxPrice: 34900 }] },
        'u1',
      );
      expect(prisma.gfinModelMapping.findMany).toHaveBeenCalledWith({ where: { deletedAt: null } });
      expect(prisma.gfinModelMapping.create).toHaveBeenCalledWith({
        data: {
          gfinSeries: 'iPhone 15 Pro Max',
          gfinVariant: null,
          storage: '256GB',
          condition: 'HAND_1',
          maxPrice: new Prisma.Decimal(34900),
          modelMatchPattern: 'iPhone 15 Pro Max',
          isActive: true,
        },
      });
      expect(result).toEqual({ created: 1, updated: 0, unchanged: 0 });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'GFIN_MAX_PRICE_IMPORTED', userId: 'u1', newValue: { created: 1, updated: 0, unchanged: 0, count: 1 } }),
      );
    });

    it('หาแถวเดิมด้วย (ชื่อรุ่น, ความจุ, สภาพ) เอง → แก้ราคา + เปิดใช้', async () => {
      prisma.gfinModelMapping.findMany.mockResolvedValue([row({ maxPrice: new Prisma.Decimal(16000), isActive: false })]);
      const result = await service.importMaxPrices(
        { items: [{ model: 'iphone 15', storage: '128GB', condition: 'HAND_2', maxPrice: 16900 }] },
        'u1',
      );
      expect(prisma.gfinModelMapping.update).toHaveBeenCalledWith({
        where: { id: 'm1' },
        data: { maxPrice: new Prisma.Decimal(16900), modelMatchPattern: 'iphone 15', isActive: true },
      });
      expect(result).toEqual({ created: 0, updated: 1, unchanged: 0 });
    });

    it('นำเข้าซ้ำค่าเท่าเดิม → ไม่สร้าง ไม่แก้', async () => {
      prisma.gfinModelMapping.findMany.mockResolvedValue([row()]);
      const result = await service.importMaxPrices(
        { items: [{ model: 'iPhone 15', storage: '128GB', condition: 'HAND_2', maxPrice: 16900 }] },
        'u1',
      );
      expect(prisma.gfinModelMapping.create).not.toHaveBeenCalled();
      expect(prisma.gfinModelMapping.update).not.toHaveBeenCalled();
      expect(result).toEqual({ created: 0, updated: 0, unchanged: 1 });
    });

    it('แถวเดิมแบบรุ่นหลัก + รุ่นย่อย (รูปแบบเก่า) ไม่นับเป็นรุ่นเดียวกัน → สร้างแถวใหม่', async () => {
      prisma.gfinModelMapping.findMany.mockResolvedValue([row({ gfinVariant: 'Pro' })]);
      const result = await service.importMaxPrices(
        { items: [{ model: 'iPhone 15', storage: '128GB', condition: 'HAND_2', maxPrice: 16900 }] },
        'u1',
      );
      expect(result).toEqual({ created: 1, updated: 0, unchanged: 0 });
    });

    it('รุ่นเดียวกันซ้ำในชุด → แถวหลังแก้แถวที่เพิ่งสร้าง ไม่สร้างซ้ำ', async () => {
      prisma.gfinModelMapping.findMany.mockResolvedValue([]);
      const item = { model: 'iPhone 16', storage: '128GB', condition: 'HAND_1' as const };
      const result = await service.importMaxPrices(
        { items: [{ ...item, maxPrice: 26900 }, { ...item, maxPrice: 27900 }] },
        'u1',
      );
      expect(prisma.gfinModelMapping.create).toHaveBeenCalledTimes(1);
      expect(prisma.gfinModelMapping.update).toHaveBeenCalledWith({
        where: { id: 'new' },
        data: { maxPrice: new Prisma.Decimal(27900), modelMatchPattern: 'iPhone 16', isActive: true },
      });
      expect(result).toEqual({ created: 1, updated: 1, unchanged: 0 });
    });
  });
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**

Run: `NODE_OPTIONS=--max-old-space-size=12288 npm --prefix apps/api test -- src/modules/gfin-config/gfin-config.service.spec.ts`
Expected: FAIL — `service.importMaxPrices is not a function`

- [ ] **Step 3: เขียนโค้ด**

`apps/api/src/modules/gfin-config/dto/import-max-prices.dto.ts`:

```ts
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { GfinCondition } from '@prisma/client';

/** หนึ่งแถวของใบราคา GFIN จาก Excel (คอลัมน์ รุ่น · ความจุ · มือ 1/มือ 2 · ราคา) */
export class ImportMaxPriceItemDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  model!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  storage!: string;

  @IsEnum(GfinCondition)
  condition!: GfinCondition;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  maxPrice!: number;
}

export class ImportMaxPricesDto {
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ImportMaxPriceItemDto)
  items!: ImportMaxPriceItemDto[];
}
```

`dto/index.ts` เพิ่มบรรทัด `export * from './import-max-prices.dto';`

`gfin-config.service.ts`:
- import จาก `./dto` เพิ่ม `ImportMaxPricesDto,`
- เพิ่มเมธอดหลัง `softDeleteMaxPrice`:

```ts
  /**
   * นำเข้าใบราคาจาก Excel (สเปคข้อ 7.7) — หนึ่งแถว = ชื่อรุ่นเต็ม + ความจุ + สภาพ
   * หาแถวเดิมเอง (unique ของฐานข้อมูลกันซ้ำไม่ได้เพราะ gfinVariant ว่าง) · แถวรูปแบบเก่าที่มีรุ่นย่อยไม่ถูกแตะ
   */
  async importMaxPrices(dto: ImportMaxPricesDto, userId: string) {
    const norm = (s: string) => s.replace(/\s+/g, '').toUpperCase();
    let created = 0;
    let updated = 0;
    let unchanged = 0;
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.gfinModelMapping.findMany({ where: { deletedAt: null } });
      for (const item of dto.items) {
        const model = item.model.trim();
        const storage = norm(item.storage);
        const match = existing.find(
          (r) =>
            !r.gfinVariant &&
            r.gfinSeries.trim().toLowerCase() === model.toLowerCase() &&
            norm(r.storage) === storage &&
            r.condition === item.condition,
        );
        const maxPrice = new Prisma.Decimal(item.maxPrice);
        if (!match) {
          const row = await tx.gfinModelMapping.create({
            data: {
              gfinSeries: model,
              gfinVariant: null,
              storage,
              condition: item.condition,
              maxPrice,
              modelMatchPattern: model,
              isActive: true,
            },
          });
          existing.push(row);
          created++;
          continue;
        }
        if (new Decimal(match.maxPrice.toString()).eq(item.maxPrice) && match.modelMatchPattern === model && match.isActive) {
          unchanged++;
          continue;
        }
        const row = await tx.gfinModelMapping.update({
          where: { id: match.id },
          data: { maxPrice, modelMatchPattern: model, isActive: true },
        });
        existing.splice(existing.indexOf(match), 1, row);
        updated++;
      }
    });
    await this.auditService.log({
      action: 'GFIN_MAX_PRICE_IMPORTED',
      entity: 'gfin_model_mapping',
      entityId: 'batch',
      userId,
      newValue: { created, updated, unchanged, count: dto.items.length },
    });
    return { created, updated, unchanged };
  }
```

`gfin-config.controller.ts`:
- import จาก `./dto` เพิ่ม `ImportMaxPricesDto,`
- เพิ่มต่อจากเมธอด `createMaxPrice`:

```ts
  @Post('max-prices/import')
  @Roles('OWNER')
  importMaxPrices(@Body() dto: ImportMaxPricesDto, @Req() req: { user: { id: string } }) {
    return this.service.importMaxPrices(dto, req.user.id);
  }
```

`access-policy.manifest.json` — เพิ่มต่อจาก `"GfinConfigController.getSettings": {…},`:

```json
  "GfinConfigController.importMaxPrices": {"classification":"staff","permission":"settings.finance.manage","resource":"none","company":"not-applicable","file":"apps/api/src/modules/gfin-config/gfin-config.controller.ts","transport":"Post('max-prices/import')","surface":"550f37b1c26befae35af","resolution":"none"},
```

- [ ] **Step 4: รันให้ผ่าน + ตรวจทะเบียน**

Run: `NODE_OPTIONS=--max-old-space-size=12288 npm --prefix apps/api test -- src/modules/gfin-config`
Expected: PASS
ทะเบียน: Linux/macOS `node tools/check-access-coverage.mjs` ไม่มี error · Windows ใช้คำสั่งห่อใน Task 10 กรอง `GfinConfigController` → ไม่มีผลลัพธ์

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/gfin-config/dto/import-max-prices.dto.ts apps/api/src/modules/gfin-config/dto/index.ts apps/api/src/modules/gfin-config/gfin-config.service.ts apps/api/src/modules/gfin-config/gfin-config.controller.ts apps/api/src/modules/gfin-config/gfin-config.service.spec.ts apps/api/src/modules/employee-access/access-policy.manifest.json
git commit -m "feat(gfin): owner-only GFIN price-list import keyed by full model, storage and condition" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: แท็บ "ใบราคา" ของหน้าตั้งค่า GFIN — แบบฟอร์ม + นำเข้า Excel + หน้าตรวจ

**Files:**
- Create: `apps/web/src/pages/GfinConfigPage/gfinPriceListImport.ts`
- Create: `apps/web/src/pages/GfinConfigPage/__tests__/gfinPriceListImport.test.ts`
- Create: `apps/web/src/pages/GfinConfigPage/__tests__/MaxPricesTab.import.test.tsx`
- Modify: `apps/web/src/pages/GfinConfigPage/MaxPricesTab.tsx`
- Modify: `apps/web/src/pages/GfinConfigPage/index.tsx:22`, `:30` (ชื่อแท็บ "ราคาสูงสุด" → "ใบราคา")

**Interfaces:**
- Consumes: `cellText`, `chunk`, `ImportBatchError`, `ImportReviewDialog`, `ImportReviewRow` (Task 2) · `POST /gfin-config/max-prices/import` (Task 5) · `GET /gfin-config/max-prices` เดิม
- Produces:
  - `GFIN_IMPORT_HEADERS = ['รุ่น', 'ความจุ', 'มือ 1/มือ 2', 'ราคา'] as const`
  - `interface GfinImportItem { model: string; storage: string; condition: 'HAND_1' | 'HAND_2'; maxPrice: number }`
  - `interface ExistingMaxPrice` (รูปของ GET) · `buildGfinImportReview(rows, existing): { rows: ImportReviewRow[]; toSend: GfinImportItem[]; legacyActive: number }`
  - `sendGfinImport(post, items, onProgress?): Promise<{ created: number; updated: number; unchanged: number }>` — ชุดละ 100
  - กติกาหน้าตรวจเหมือนเซิร์ฟเวอร์ (Task 5) · `legacyActive` = แถวที่เปิดอยู่และมีรุ่นย่อย → คำเตือนในหน้าตรวจ

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน**

`apps/web/src/pages/GfinConfigPage/__tests__/gfinPriceListImport.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import {
  GFIN_IMPORT_HEADERS,
  buildGfinImportReview,
  sendGfinImport,
  type ExistingMaxPrice,
  type GfinImportItem,
} from '../gfinPriceListImport';

const row = (model: string, storage: string, hand: unknown, price: unknown) => ({
  'รุ่น': model,
  'ความจุ': storage,
  'มือ 1/มือ 2': hand,
  'ราคา': price,
});

const existing = (over: Partial<ExistingMaxPrice> = {}): ExistingMaxPrice => ({
  id: 'm1',
  gfinSeries: 'iPhone 15',
  gfinVariant: null,
  storage: '128GB',
  condition: 'HAND_2',
  maxPrice: '16900.00',
  modelMatchPattern: 'iPhone 15',
  isActive: true,
  ...over,
});

describe('buildGfinImportReview', () => {
  it('หัวคอลัมน์ตามสเปค 7.7', () => {
    expect([...GFIN_IMPORT_HEADERS]).toEqual(['รุ่น', 'ความจุ', 'มือ 1/มือ 2', 'ราคา']);
  });

  it('เพิ่ม / แก้ / ข้ามราคาเท่าเดิม / ข้ามแถวผิดหรือซ้ำ · นับแถวรูปแบบเก่าที่มีรุ่นย่อย', () => {
    const review = buildGfinImportReview(
      [
        row('iPhone 15', '128GB', 'มือ 2', 16900),
        row('iPhone 15', '256 GB', 'มือ 2', 17900),
        row('iPhone 15 Pro Max', '256GB', 'มือ 1', 34900),
        row('iPhone 15 Pro Max', '256GB', 'มือ1', 34900),
        row('iPhone 13', '128GB', 'มือสาม', 12900),
        row('iPhone 13', '128GB', 'มือ 2', 0),
        row('', '', '', ''),
      ],
      [
        existing(),
        existing({ id: 'm2', storage: '256GB', maxPrice: '17000.00', isActive: false }),
        existing({ id: 'old', gfinSeries: 'iPhone 14', gfinVariant: 'Pro' }),
      ],
    );
    expect(review.rows).toEqual([
      { rowNumber: 2, label: 'iPhone 15 128GB มือ 2', action: 'SKIP', detail: 'ราคาเท่าเดิม' },
      { rowNumber: 3, label: 'iPhone 15 256GB มือ 2', action: 'UPDATE', detail: 'ราคา 17,000 → 17,900 · เปิดใช้อีกครั้ง' },
      { rowNumber: 4, label: 'iPhone 15 Pro Max 256GB มือ 1', action: 'ADD' },
      { rowNumber: 5, label: 'iPhone 15 Pro Max 256GB มือ1', action: 'SKIP', detail: 'ซ้ำกับแถว 4' },
      { rowNumber: 6, label: 'iPhone 13 128GB มือสาม', action: 'SKIP', detail: 'ช่อง มือ 1/มือ 2 ต้องเป็น มือ 1 หรือ มือ 2' },
      { rowNumber: 7, label: 'iPhone 13 128GB มือ 2', action: 'SKIP', detail: 'ราคาต้องเป็นตัวเลขมากกว่า 0' },
    ]);
    expect(review.toSend).toEqual([
      { model: 'iPhone 15', storage: '256GB', condition: 'HAND_2', maxPrice: 17900 },
      { model: 'iPhone 15 Pro Max', storage: '256GB', condition: 'HAND_1', maxPrice: 34900 },
    ]);
    expect(review.legacyActive).toBe(1);
  });
});

describe('sendGfinImport', () => {
  it('ส่งชุดละ 100 และรวมผล', async () => {
    const item = { model: 'x' } as GfinImportItem;
    const post = vi.fn(async (body: { items: GfinImportItem[] }) => ({ created: body.items.length, updated: 0, unchanged: 0 }));
    const progress = vi.fn();
    expect(await sendGfinImport(post, Array(106).fill(item), progress)).toEqual({ created: 106, updated: 0, unchanged: 0 });
    expect(post.mock.calls.map(([b]) => b.items.length)).toEqual([100, 6]);
    expect(progress.mock.calls).toEqual([[1, 2], [2, 2]]);
  });
});
```

`apps/web/src/pages/GfinConfigPage/__tests__/MaxPricesTab.import.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const apiGet = vi.fn();
const apiPost = vi.fn();
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  default: { get: (...a: unknown[]) => apiGet(...a), post: (...a: unknown[]) => apiPost(...a), patch: vi.fn(), delete: vi.fn() },
}));
const importFromExcel = vi.fn();
vi.mock('@/utils/excel.util', () => ({
  importFromExcel: (...a: unknown[]) => importFromExcel(...a),
  downloadExcelBuffer: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { toast } from 'sonner';
import { MaxPricesTab } from '../MaxPricesTab';

function Wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  apiGet.mockReset().mockResolvedValue({
    data: [
      { id: 'old', gfinSeries: 'iPhone 14', gfinVariant: 'Pro', storage: '128GB', condition: 'HAND_2', maxPrice: '18900.00', modelMatchPattern: 'iPhone 14 Pro', isActive: true, updatedAt: '2026-10-16T00:00:00Z' },
    ],
  });
  apiPost.mockReset().mockResolvedValue({ data: { created: 1, updated: 0, unchanged: 0 } });
  importFromExcel.mockReset().mockResolvedValue([
    { 'รุ่น': 'iPhone 18 Pro', 'ความจุ': '256GB', 'มือ 1/มือ 2': 'มือ 1', 'ราคา': 48900 },
  ]);
});

describe('MaxPricesTab — นำเข้าใบราคา', () => {
  it('อ่านไฟล์ → หน้าตรวจพร้อมคำเตือนแถวรูปแบบเก่า → ยืนยันแล้วส่งรายการ', async () => {
    const { container } = render(<Wrapper><MaxPricesTab /></Wrapper>);
    await screen.findByText('iPhone 14');
    fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [new File(['x'], 'gfin.xlsx')] },
    });
    expect(await screen.findByText('ตรวจรายการก่อนยืนยัน — เพิ่ม 1 · แก้ 0 · ข้าม 0 แถว')).toBeInTheDocument();
    expect(screen.getByText(/มีแถวเดิม 1 แถวที่ตั้งชื่อแบบรุ่นหลัก \+ รุ่นย่อย/)).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'ยืนยันนำเข้า' }));
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith('/gfin-config/max-prices/import', {
        items: [{ model: 'iPhone 18 Pro', storage: '256GB', condition: 'HAND_1', maxPrice: 48900 }],
      }),
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('นำเข้าใบราคาแล้ว — เพิ่ม 1 · แก้ 0 · เท่าเดิม 0 แถว'));
  });
});
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**

Run: `cd apps/web && npx vitest run src/pages/GfinConfigPage/__tests__/gfinPriceListImport.test.ts src/pages/GfinConfigPage/__tests__/MaxPricesTab.import.test.tsx`
Expected: FAIL — `Failed to resolve import "../gfinPriceListImport"` · ไม่มี input ไฟล์ในแท็บ

- [ ] **Step 3: เขียนโค้ด**

`apps/web/src/pages/GfinConfigPage/gfinPriceListImport.ts`:

```ts
import type { ImportReviewRow } from '@/components/import/ImportReviewDialog';
import { cellText, chunk } from '@/utils/excel-cell.util';

/** หัวคอลัมน์ไฟล์ใบราคา GFIN (สเปคข้อ 7.7) — สคริปต์เตรียมไฟล์จากชีตตรวจเทียบกับรายการนี้ */
export const GFIN_IMPORT_HEADERS = ['รุ่น', 'ความจุ', 'มือ 1/มือ 2', 'ราคา'] as const;

export interface GfinImportItem {
  model: string;
  storage: string;
  condition: 'HAND_1' | 'HAND_2';
  maxPrice: number;
}

export interface ExistingMaxPrice {
  id: string;
  gfinSeries: string;
  gfinVariant: string | null;
  storage: string;
  condition: 'HAND_1' | 'HAND_2';
  maxPrice: string | number;
  modelMatchPattern: string;
  isActive: boolean;
}

export interface GfinImportReview {
  rows: ImportReviewRow[];
  toSend: GfinImportItem[];
  /** แถวที่เปิดอยู่แบบรุ่นหลัก + รุ่นย่อย (รูปแบบเก่า) — ไฟล์นี้ไม่แตะ */
  legacyActive: number;
}

export const normalizeGfinStorage = (s: string) => s.replace(/\s+/g, '').toUpperCase();

function conditionOf(text: string): 'HAND_1' | 'HAND_2' | null {
  const t = text.replace(/\s+/g, '');
  if (t === 'มือ1') return 'HAND_1';
  if (t === 'มือ2' || t === 'มือสอง') return 'HAND_2';
  return null;
}

const keyOf = (model: string, storage: string, condition: string) =>
  `${model.trim().toLowerCase()}|${normalizeGfinStorage(storage)}|${condition}`;

/** หน้าตรวจก่อนยืนยัน — จับคู่แบบเดียวกับเซิร์ฟเวอร์: (ชื่อรุ่น, ความจุ, สภาพ) เฉพาะแถวที่ไม่มีรุ่นย่อย */
export function buildGfinImportReview(
  rows: Record<string, unknown>[],
  existing: ExistingMaxPrice[],
): GfinImportReview {
  const byKey = new Map(
    existing.filter((e) => !e.gfinVariant).map((e) => [keyOf(e.gfinSeries, e.storage, e.condition), e]),
  );
  const seen = new Map<string, number>();
  const review: ImportReviewRow[] = [];
  const toSend: GfinImportItem[] = [];

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const model = cellText(row['รุ่น']);
    const storageText = cellText(row['ความจุ']);
    const handText = cellText(row['มือ 1/มือ 2']);
    const priceText = cellText(row['ราคา']);
    if (!model && !storageText && !handText && !priceText) return;
    const storage = normalizeGfinStorage(storageText);
    const label = [model, storage, handText].filter(Boolean).join(' ');
    const skip = (detail: string) => review.push({ rowNumber, label, action: 'SKIP', detail });

    if (!model || !storage) return void skip('ไม่มีรุ่นหรือความจุ');
    const condition = conditionOf(handText);
    if (!condition) return void skip('ช่อง มือ 1/มือ 2 ต้องเป็น มือ 1 หรือ มือ 2');
    const price = Number(priceText.replace(/,/g, ''));
    if (!Number.isFinite(price) || !(price > 0)) return void skip('ราคาต้องเป็นตัวเลขมากกว่า 0');

    const key = keyOf(model, storage, condition);
    const duplicateOf = seen.get(key);
    if (duplicateOf !== undefined) return void skip(`ซ้ำกับแถว ${duplicateOf}`);
    seen.set(key, rowNumber);

    const item: GfinImportItem = { model, storage, condition, maxPrice: price };
    const before = byKey.get(key);
    if (!before) {
      review.push({ rowNumber, label, action: 'ADD' });
      toSend.push(item);
      return;
    }
    const changes: string[] = [];
    if (Number(before.maxPrice) !== price)
      changes.push(`ราคา ${Number(before.maxPrice).toLocaleString('th-TH')} → ${price.toLocaleString('th-TH')}`);
    if (!before.isActive) changes.push('เปิดใช้อีกครั้ง');
    if (before.modelMatchPattern !== model) changes.push(`คำจับคู่ "${before.modelMatchPattern}" → "${model}"`);
    if (changes.length === 0) return void skip('ราคาเท่าเดิม');
    review.push({ rowNumber, label, action: 'UPDATE', detail: changes.join(' · ') });
    toSend.push(item);
  });

  return { rows: review, toSend, legacyActive: existing.filter((e) => e.isActive && e.gfinVariant).length };
}

export async function sendGfinImport(
  post: (body: { items: GfinImportItem[] }) => Promise<{ created: number; updated: number; unchanged: number }>,
  items: GfinImportItem[],
  onProgress?: (done: number, total: number) => void,
): Promise<{ created: number; updated: number; unchanged: number }> {
  const batches = chunk(items, 100);
  const total = { created: 0, updated: 0, unchanged: 0 };
  for (let i = 0; i < batches.length; i++) {
    onProgress?.(i + 1, batches.length);
    const res = await post({ items: batches[i] });
    total.created += res.created;
    total.updated += res.updated;
    total.unchanged += res.unchanged;
  }
  return total;
}
```

`MaxPricesTab.tsx`:
1. import — `import { useId as useUiFieldId, useState } from 'react';` → `import { useId as useUiFieldId, useRef, useState } from 'react';` · `import api from '@/lib/api';` → `import api, { getErrorMessage } from '@/lib/api';` · `import { Pencil, Trash2 } from 'lucide-react';` → `import { Download, Pencil, Trash2, Upload } from 'lucide-react';` · เพิ่ม:

```tsx
import { downloadExcelBuffer, importFromExcel } from '@/utils/excel.util';
import { ImportReviewDialog } from '@/components/import/ImportReviewDialog';
import {
  GFIN_IMPORT_HEADERS,
  buildGfinImportReview,
  sendGfinImport,
  type ExistingMaxPrice,
  type GfinImportItem,
  type GfinImportReview,
} from './gfinPriceListImport';
```

2. ใน `MaxPricesTab()` ต่อจากบล็อก `const deleteRow = useMutation({ … });` — **ก่อน** `if (isLoading) return …` (hook ต้องอยู่ก่อน early return) — เพิ่ม:

```tsx
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [review, setReview] = useState<GfinImportReview | null>(null);
  const [importProgress, setImportProgress] = useState<string | null>(null);

  const importMutation = useMutation({
    mutationFn: (items: GfinImportItem[]) =>
      sendGfinImport(
        async (body) => (await api.post('/gfin-config/max-prices/import', body)).data,
        items,
        (done, total) => setImportProgress(`กำลังนำเข้า ชุด ${done}/${total}`),
      ),
    onSuccess: ({ created, updated, unchanged }) => {
      qc.invalidateQueries({ queryKey: ['gfin-max-prices'] });
      toast.success(`นำเข้าใบราคาแล้ว — เพิ่ม ${created} · แก้ ${updated} · เท่าเดิม ${unchanged} แถว`);
      setReview(null);
    },
    onError: (err: unknown) => {
      qc.invalidateQueries({ queryKey: ['gfin-max-prices'] });
      toast.error(getErrorMessage(err));
    },
    onSettled: () => setImportProgress(null),
  });

  const downloadTemplate = async () => {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('ใบราคา GFIN');
    ws.columns = GFIN_IMPORT_HEADERS.map((header) => ({ header, key: header, width: header === 'รุ่น' ? 22 : 14 }));
    ws.addRows([
      { 'รุ่น': 'iPhone 15 Pro Max', 'ความจุ': '256GB', 'มือ 1/มือ 2': 'มือ 1', 'ราคา': 34900 },
      { 'รุ่น': 'iPhone 13', 'ความจุ': '128GB', 'มือ 1/มือ 2': 'มือ 2', 'ราคา': 12900 },
    ]);
    const buffer = await wb.xlsx.writeBuffer();
    downloadExcelBuffer(buffer, 'แบบฟอร์มใบราคา-GFIN.xlsx');
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (fileInputRef.current) fileInputRef.current.value = '';
    try {
      const rows = await importFromExcel(file);
      const next = buildGfinImportReview(rows, (data ?? []) as ExistingMaxPrice[]);
      if (next.rows.length === 0) {
        toast.error('ไม่พบข้อมูลที่ถูกต้อง กรุณาตรวจสอบหัวคอลัมน์ (รุ่น · ความจุ · มือ 1/มือ 2 · ราคา)');
        return;
      }
      setReview(next);
    } catch {
      toast.error('ไม่สามารถอ่านไฟล์ได้ กรุณาใช้ไฟล์ .xlsx');
    }
  };
```

3. แถบปุ่ม — แทนบล็อก

```tsx
        <Button variant="primary" onClick={() => setCreating(true)}>
          + เพิ่ม
        </Button>
```

ด้วย

```tsx
        <Button variant="outline" onClick={downloadTemplate}>
          <Download className="size-4" aria-hidden="true" />
          ดาวน์โหลดแบบฟอร์ม
        </Button>
        <Button variant="outline" onClick={() => fileInputRef.current?.click()} disabled={importMutation.isPending}>
          <Upload className="size-4" aria-hidden="true" />
          นำเข้า Excel
        </Button>
        <input ref={fileInputRef} type="file" accept=".xlsx" className="hidden" onChange={handleFile} />
        <Button variant="primary" onClick={() => setCreating(true)}>
          + เพิ่ม
        </Button>
```

และเปลี่ยน `<div className="flex gap-2">` ของแถบนี้เป็น `<div className="flex flex-wrap gap-2">`

4. ก่อน `{(editing || creating) && (` เพิ่ม:

```tsx
      {review && (
        <ImportReviewDialog
          title="ตรวจใบราคา GFIN ก่อนนำเข้า"
          rows={review.rows}
          warning={
            review.legacyActive > 0
              ? `มีแถวเดิม ${review.legacyActive} แถวที่ตั้งชื่อแบบรุ่นหลัก + รุ่นย่อย — ไฟล์นี้ไม่แก้แถวเหล่านั้น ควรปิดแถวเหล่านั้นหลังนำเข้า เพื่อไม่ให้จับคู่ราคาซ้ำ`
              : null
          }
          pending={importMutation.isPending}
          progress={importProgress}
          onCancel={() => setReview(null)}
          onConfirm={() => importMutation.mutate(review.toSend)}
        />
      )}
```

`index.tsx`: `<TabsTrigger value="max-prices">ราคาสูงสุด</TabsTrigger>` → `<TabsTrigger value="max-prices">ใบราคา</TabsTrigger>` · คำอธิบายบรรทัด 22 `"ตารางราคาสูงสุด, กฎส่วนเพิ่มราคา …"` → `"ใบราคา (ราคาสูงสุด + นำเข้า Excel), กฎส่วนเพิ่มราคา (+ ผ่อนสูงสุด), เรทต่อ (งวด, % คอมมิชชั่น), ค่าตั้งต้น และกลุ่มไลน์/แม่แบบชุดเช็ค"`

- [ ] **Step 4: รันให้ผ่าน**

Run: `cd apps/web && npx vitest run src/pages/GfinConfigPage && npx tsc --noEmit`
Expected: PASS · 0 type errors

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/GfinConfigPage/gfinPriceListImport.ts apps/web/src/pages/GfinConfigPage/__tests__/gfinPriceListImport.test.ts apps/web/src/pages/GfinConfigPage/__tests__/MaxPricesTab.import.test.tsx apps/web/src/pages/GfinConfigPage/MaxPricesTab.tsx apps/web/src/pages/GfinConfigPage/index.tsx
git commit -m "feat(web): import the GFIN price list from Excel with a review step" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: เว็บ shop เลือกได้เฉพาะงวดที่มีอัตรา + แสดงค่างวดปัดขึ้นเป็นบาท

**Files:**
- Modify: `apps/api/src/modules/shop-catalog/installment-preview.service.ts:16-30` (`PreviewResult`), `:84-102` (`previewBc`)
- Modify: `apps/api/src/modules/shop-catalog/installment-preview.service.spec.ts` (เพิ่ม 1 เทสต์หลัง `BC: returns canonical worked example monthly payment 2,411.06`)
- Modify: `apps/web-shop/src/components/InstallmentCalculatorCard.tsx:8`, `:11-24`, `:36`, `:261`, `:282-286`, `:335-337`, `:358-362`
- Modify: `apps/web-shop/src/components/InstallmentCalculatorCard.test.tsx`

**Interfaces:**
- Consumes: `BcConfig.allowedMonths` (จาก `resolveBcConfigForCategory`) · `displayInstallment` (2ก Task 1)
- Produces: `PreviewResult.allowedMonths?: number[]` — มากับทุกคำตอบ BC ที่หาตั้งค่าดอกเบี้ยเจอ (ทั้งคิดได้และคิดไม่ได้) · หน้าเว็บ shop: ตัวเลือกจำนวนงวด = `allowedMonths` ของคำตอบ BC ล่าสุด (ก่อนคำตอบแรก = `[12]`) · งวดที่เลือกอยู่ไม่มีในรายการ → ย้ายไป 12 ถ้ามี ไม่งั้นงวดแรก · ค่างวดที่แสดง = `displayInstallment(monthlyPayment)`

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน**

`installment-preview.service.spec.ts` เพิ่ม:

```ts
  it('BC: ทุกคำตอบแนบงวดที่มีอัตรา (ตัวเลือกจำนวนงวดของเว็บ shop) — คิดได้และคิดไม่ได้', async () => {
    prisma.product.findFirst.mockResolvedValue({
      id: 'p1',
      installmentPrice: new Prisma.Decimal('25900'),
      prices: [],
      category: 'PHONE_NEW',
      brand: 'Apple',
      model: 'iPhone 15',
      storage: '128GB',
      deletedAt: null,
    });
    prisma.interestConfig.findFirst.mockResolvedValue({
      id: 'c1',
      minDownPaymentPct: new Prisma.Decimal('0.15'),
      storeCommissionPct: new Prisma.Decimal('0.10'),
      vatPct: new Prisma.Decimal('0.07'),
      minInstallmentMonths: 10,
      maxInstallmentMonths: 12,
      interestRate: new Prisma.Decimal('0.05'),
      rates: [
        { months: 10, ratePct: new Prisma.Decimal('0.50'), deletedAt: null },
        { months: 12, ratePct: new Prisma.Decimal('0.50'), deletedAt: null },
      ],
    });
    const ok = await service.preview({ productId: 'p1', provider: 'BC', months: 12 });
    expect(ok).toMatchObject({ available: true, allowedMonths: [10, 12], monthlyPayment: 3138.66 });
    const bad = await service.preview({ productId: 'p1', provider: 'BC', months: 6 });
    expect(bad).toMatchObject({ available: false, reason: 'invalid', allowedMonths: [10, 12] });
  });
```

`InstallmentCalculatorCard.test.tsx`:
- import บรรทัด 1 เพิ่ม `within`: `import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';`
- type `Result` เพิ่ม `allowedMonths?: number[];`
- ใน `answer()` ออบเจ็กต์ `data` เพิ่ม `allowedMonths: [6, 8, 10, 12],` ก่อน `...extra,`
- แทนทุก `'฿1,234.56'` ด้วย `'฿1,235'` และทุก `'฿2,567.89'` ด้วย `'฿2,568'` (ค่างวดที่แสดงปัดขึ้นเป็นบาท)
- เพิ่มต่อท้าย `describe('installment quote interactions', …)`:

```ts
  it('offers only the terms that have an interest rate (from the BC answer)', async () => {
    setup();
    await answer(requests.slice(), 3139, { allowedMonths: [10, 12] });
    const select = screen.getByLabelText('จำนวนงวด:');
    await waitFor(() =>
      expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['10 งวด', '12 งวด']),
    );
  });

  it('moves to 12, else the first allowed term, when the current term has no rate', async () => {
    setup();
    await answer(requests.slice(), 3139, { allowedMonths: [10] });
    await waitFor(() => expect(screen.getByLabelText('จำนวนงวด:')).toHaveValue('10'));
    expect(requests.slice(-2).every((request) => request.params.get('months') === '10')).toBe(true);
  });

  it('shows the monthly payment rounded up to whole baht', async () => {
    setup();
    await answer(requests.slice(), 3138.66);
    expect(await screen.findAllByText('฿3,139')).toHaveLength(2);
  });
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**

Run: `NODE_OPTIONS=--max-old-space-size=12288 npm --prefix apps/api test -- src/modules/shop-catalog/installment-preview.service.spec.ts` แล้ว `cd apps/web-shop && npx vitest run src/components/InstallmentCalculatorCard.test.tsx`
Expected: FAIL — ผล BC ไม่มี `allowedMonths` · ตัวเลือกยังเป็น 3–12 · แสดง `฿1,234.56`

- [ ] **Step 3: แก้โค้ด**

`installment-preview.service.ts`:
- `PreviewResult` เพิ่มต่อจาก `minDownPct?: number;`:

```ts
  /** BC only — งวดที่ตั้งค่าดอกเบี้ยมีอัตรา (ตัวเลือกจำนวนงวดของเว็บ shop) */
  allowedMonths?: number[];
```

- ใน `previewBc` ต่อจาก `const minDownPct = resolved.config!.minDownPct.mul(100).toNumber();` เพิ่ม `const allowedMonths = [...resolved.config!.allowedMonths];` · คำตอบ `invalid` เป็น `return { available: false, reason: 'invalid', errors: result.errors, minDownPct, allowedMonths };` · คำตอบปกติเพิ่ม `allowedMonths,` ต่อจาก `minDownPct,`

`InstallmentCalculatorCard.tsx`:
- บรรทัด 8 → `import { displayInstallment, minDownAmountFromPct } from '@installment/shared';`
- `PreviewResponse` เพิ่มต่อจาก `minDownPct?: number;`:

```ts
  /** BC only — งวดที่มีอัตราดอกเบี้ย · เลือกได้เฉพาะงวดเหล่านี้ */
  allowedMonths?: number[];
```

- บรรทัด 36 `const MONTHS_OPTIONS = [3, 4, 5, 6, 7, 8, 10, 12];` → 

```ts
/** งวดของคำขอแรก — ตัวเลือกจริงมาจากคำตอบ BC (allowedMonths) */
const INITIAL_MONTHS = 12;
```

- บรรทัด 261 `฿{formatTHB(result.monthlyPayment ?? 0)}` → `฿{formatTHB(displayInstallment(result.monthlyPayment ?? 0))}`
- บรรทัด 282 `const [months, setMonths] = useState(12);` → 

```ts
  const [months, setMonths] = useState(INITIAL_MONTHS);
  const [termOptions, setTermOptions] = useState<number[]>([INITIAL_MONTHS]);
```

- ต่อจาก effect `if (bcResult?.minDownPct != null) setMinDownPct(bcResult.minDownPct);` เพิ่ม:

```ts
  // เลือกได้เฉพาะงวดที่ตั้งค่าดอกเบี้ยมีอัตรา · งวดที่เลือกอยู่ไม่มีแล้ว → 12 ถ้ามี ไม่งั้นงวดแรก
  useEffect(() => {
    const allowed = bcResult?.allowedMonths;
    if (!allowed || allowed.length === 0) return;
    setTermOptions(allowed);
    setMonths((current) => (allowed.includes(current) ? current : allowed.includes(12) ? 12 : allowed[0]));
  }, [bcResult?.allowedMonths]);
```

- ใน `<NativeSelect …>` `{MONTHS_OPTIONS.map((value) => (` → `{termOptions.map((value) => (`

- [ ] **Step 4: รันให้ผ่าน + ตรวจชนิด**

Run: `NODE_OPTIONS=--max-old-space-size=12288 npm --prefix apps/api test -- src/modules/shop-catalog` แล้ว `cd apps/web-shop && npx vitest run src/components/InstallmentCalculatorCard.test.tsx && npx tsc --noEmit`
Expected: PASS · 0 type errors

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/shop-catalog/installment-preview.service.ts apps/api/src/modules/shop-catalog/installment-preview.service.spec.ts apps/web-shop/src/components/InstallmentCalculatorCard.tsx apps/web-shop/src/components/InstallmentCalculatorCard.test.tsx
git commit -m "feat(web-shop): offer only rated installment terms and show monthly rounded up to baht" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: เพิ่ม iPhone 18 Pro / iPhone 18 Pro Max ในรายชื่อรุ่น

**Files:**
- Modify: `apps/web/src/data/productCatalog.ts:16-17` (ก่อน `// === iPhone 17 Series (2025) ===`)
- Create: `apps/web/src/data/productCatalog.test.ts`
- Modify: `apps/web/src/pages/PurchaseOrdersPage/po-catalog.util.test.ts:14`, `:37`, `:52`

**Interfaces:**
- Consumes: ไม่มี
- Produces: สองรุ่นใหม่บนสุดของ Apple (`PHONE_NEW`)
  - สี (ชื่อทางการของ Apple, รูปแบบเดียวกับรุ่นอื่นในไฟล์ — ชื่ออังกฤษไม่มีวงเล็บ): `Black` · `Silver` · `Glacier` · `Burgundy` — ที่มา: หน้า Tech Specs ของ Apple https://www.apple.com/iphone-18-pro/specs/ (ตรวจ 2026-11-20 · ข่าวเปิดตัว 9 ก.ย. 2026 https://9to5mac.com/2026/09/09/iphone-18-pro-officially-announced-heres-whats-new/ เขียน "black, glacier, silver, burgundy" ตรงกัน · สื่อบางแห่งเรียกสีดำว่า "Deep Black" แต่หน้า specs ของ Apple ใช้ "Black") และตรงกับแท็บ "รุ่น-สี-ความจุ" ของชีต MASTER (แถว 371–402)
  - ความจุ: `256GB` · `512GB` · `1TB` · `2TB` (แท็บ "รุ่น-สี-ความจุ" ของชีต · ใบราคา G-Finn มีเฉพาะ 256/512)

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน**

`apps/web/src/data/productCatalog.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { productCatalog } from './productCatalog';

const apple = productCatalog.find((b) => b.brand === 'Apple')!;

describe('productCatalog — iPhone 18 Pro (ก.ย. 2026)', () => {
  it.each(['iPhone 18 Pro Max', 'iPhone 18 Pro'])('%s: สีตาม apple.com · ความจุตามชีต MASTER', (name) => {
    expect(apple.models.find((m) => m.name === name)).toEqual({
      name,
      category: 'PHONE_NEW',
      colors: ['Black', 'Silver', 'Glacier', 'Burgundy'],
      storage: ['256GB', '512GB', '1TB', '2TB'],
    });
  });

  it('รุ่นใหม่สุดอยู่บนสุด (ปุ่ม "รุ่นล่าสุด" ของใบสั่งซื้อเรียงตามรายการนี้)', () => {
    expect(apple.models.slice(0, 3).map((m) => m.name)).toEqual([
      'iPhone 18 Pro Max',
      'iPhone 18 Pro',
      'iPhone 17 Pro Max',
    ]);
  });

  it('ชื่อรุ่นไม่ซ้ำ', () => {
    const names = apple.models.map((m) => m.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
```

`po-catalog.util.test.ts`: บรรทัด 14 `name: 'iPhone 17 Pro Max'` → `name: 'iPhone 18 Pro Max'` · บรรทัด 37 `toBe('iPhone 17 Pro Max')` → `toBe('iPhone 18 Pro Max')` · บรรทัด 52 `['iPhone 17 Pro Max', 'iPhone 17 Pro', 'iPhone Air']` → `['iPhone 18 Pro Max', 'iPhone 18 Pro', 'iPhone 17 Pro Max']`

- [ ] **Step 2: รันให้เห็นว่าล้ม**

Run: `cd apps/web && npx vitest run src/data/productCatalog.test.ts src/pages/PurchaseOrdersPage/po-catalog.util.test.ts`
Expected: FAIL — ไม่พบ `iPhone 18 Pro Max`

- [ ] **Step 3: แก้โค้ด**

ใน `productCatalog.ts` แทรกก่อนบรรทัด `      // === iPhone 17 Series (2025) ===`:

```ts
      // === iPhone 18 Pro Series (2026) — สีตาม apple.com/iphone-18-pro/specs · ความจุตามชีต MASTER ===
      {
        name: 'iPhone 18 Pro Max',
        category: 'PHONE_NEW',
        colors: ['Black', 'Silver', 'Glacier', 'Burgundy'],
        storage: ['256GB', '512GB', '1TB', '2TB'],
      },
      {
        name: 'iPhone 18 Pro',
        category: 'PHONE_NEW',
        colors: ['Black', 'Silver', 'Glacier', 'Burgundy'],
        storage: ['256GB', '512GB', '1TB', '2TB'],
      },

```

- [ ] **Step 4: รันให้ผ่าน**

Run: `cd apps/web && npx vitest run src/data src/pages/PurchaseOrdersPage src/pages/ProductCreatePage src/components/trade-in src/pages/StockAlertsPage`
Expected: PASS (`StepItems.test.tsx` ยังกด `iPhone 17 Pro Max` ได้ — ปุ่มรุ่นล่าสุดมี 6 รุ่น)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/data/productCatalog.ts apps/web/src/data/productCatalog.test.ts apps/web/src/pages/PurchaseOrdersPage/po-catalog.util.test.ts
git commit -m "feat(web): add iPhone 18 Pro and iPhone 18 Pro Max to the product catalog" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: เตรียมไฟล์นำเข้าจากชีต MASTER (นอก repo — ไม่ commit)

**Files:**
- Create: `D:\BESTCHOICE APP\price-master-import\check_import_headers.py`
- Create: `D:\BESTCHOICE APP\price-master-import\build_import_files.py`
- Output: `D:\BESTCHOICE APP\price-master-import\ราคากลาง-นำเข้า.xlsx` (98 แถว) · `D:\BESTCHOICE APP\price-master-import\ใบราคา-GFIN-นำเข้า.xlsx` (106 แถว)
- Input: `C:\Users\what_\AppData\Local\Temp\claude\c6d66c95ab04b146\8930e9c8-75d7-4071-8d49-abc3f8867cb7\scratchpad\master-sheet-2026-11-19.xlsx` (ถ้าโฟลเดอร์ชั่วคราวถูกล้าง ให้ export ชีต "ตารางผ่อน MASTER (BESTCHOICE)" เป็น .xlsx ใหม่แล้วชี้ไฟล์นั้น)

**Interfaces:**
- Consumes: `PRICING_IMPORT_HEADERS` (Task 3) · `GFIN_IMPORT_HEADERS` (Task 6) — อ่านจากซอร์ส TypeScript
- Produces: ไฟล์นำเข้า 2 ไฟล์ตามกติกาสเปคข้อ 8:
  - ราคากลาง: มือ 1 8 แถว + มือ 2 45 แถว × 2 (มีประกัน / ไม่มีประกัน ราคาเดียวกัน) = 98 แถว · ยี่ห้อ Apple · เครื่องไทย/นอก ว่าง (= ไม่ระบุ) · เงินสด = E · ราคาผ่อน BESTCHOICE = F · ราคาขาย GFIN = G · งวดเรท 1 = H · ดาวน์เรท 1 = I (ว่าง = ขั้นต่ำ — 7 แถว) · งวดเรท 2 = K (2 แถว: iPhone 18 Pro / Pro Max มือ 1 = 15) · คอลัมน์ J (ราคา GFIN กำหนดเอง) ไม่นำเข้า (สเปคข้อ 1 "ไม่อยู่ในรอบนี้")
  - ใบราคา GFIN: แท็บ "ใบราคา G-Finn" แถวที่มีราคามือ 1 (D) → `มือ 1` 43 แถว · มีราคามือ 2 (G) → `มือ 2` 63 แถว
  - พิมพ์สรุปกติกา OVER (6+ กลุ่ม) ให้เจ้าของกรอกในแท็บ OVER เอง

- [ ] **Step 1: เขียนตัวตรวจที่ยังไม่ผ่าน**

`D:\BESTCHOICE APP\price-master-import\check_import_headers.py`:

```python
"""ตรวจไฟล์นำเข้า: หัวคอลัมน์ตรงกับค่าคงที่ในซอร์สของตัวนำเข้า + จำนวนแถวตรงสเปคข้อ 8
ใช้: py -3 -I check_import_headers.py <repo> <โฟลเดอร์ไฟล์นำเข้า>"""
import sys, io, os, re
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
import openpyxl


def ts_headers(repo, rel, const):
    src = open(os.path.join(repo, rel), encoding='utf-8').read()
    m = re.search(const + r"\s*=\s*\[(.*?)\]\s*as const", src, re.S)
    assert m, f'ไม่พบ {const} ใน {rel}'
    return re.findall(r"'([^']*)'", m.group(1))


def main(repo, out_dir):
    checks = [
        ('ราคากลาง-นำเข้า.xlsx',
         ts_headers(repo, 'apps/web/src/pages/pricing-templates/pricingTemplateImport.ts', 'PRICING_IMPORT_HEADERS'), 98),
        ('ใบราคา-GFIN-นำเข้า.xlsx',
         ts_headers(repo, 'apps/web/src/pages/GfinConfigPage/gfinPriceListImport.ts', 'GFIN_IMPORT_HEADERS'), 106),
    ]
    for name, headers, rows in checks:
        path = os.path.join(out_dir, name)
        assert os.path.exists(path), f'ไม่พบไฟล์ {path}'
        ws = openpyxl.load_workbook(path, data_only=True).worksheets[0]  # ตัวนำเข้าอ่านชีตแรก
        got = [c.value for c in ws[1]]
        assert got == headers, f'{name}: หัวคอลัมน์ {got} ≠ ตัวนำเข้า {headers}'
        assert ws.max_row - 1 == rows, f'{name}: {ws.max_row - 1} แถว ≠ {rows}'
        print('OK', name, rows, 'แถว')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**

Run (git bash): `cd "/d/BESTCHOICE APP/price-master-import" && py -3 -I check_import_headers.py "D:/BESTCHOICE APP/BESTCHOICE/.worktrees/price-master-rest" .`
Expected: FAIL — `AssertionError: ไม่พบไฟล์ .\ราคากลาง-นำเข้า.xlsx`

- [ ] **Step 3: เขียนสคริปต์สร้างไฟล์**

`D:\BESTCHOICE APP\price-master-import\build_import_files.py` (ทดลองรันกับชีต 2026-11-19 แล้ว: 98 / 106 แถว):

```python
"""แปลงชีต MASTER (export .xlsx) เป็นไฟล์นำเข้า 2 ไฟล์ — ราคากลาง + ใบราคา GFIN (สเปคข้อ 8)
ใช้: py -3 -I build_import_files.py <master.xlsx> <โฟลเดอร์ปลายทาง>
หัวคอลัมน์ต้องตรงกับตัวนำเข้าในโปรแกรม — ตรวจด้วย check_import_headers.py"""
import sys, io, os
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
import openpyxl

PRICING_HEADERS = ['ยี่ห้อ', 'รุ่น', 'ความจุ', 'เครื่องไทย/นอก', 'ประเภท', 'ประกัน', 'ราคาเงินสด',
                   'ราคาผ่อน BESTCHOICE (ราคาเต็ม)', 'ราคาขาย GFIN (ราคาเต็ม)', 'งวดเรท 1', 'ดาวน์เรท 1', 'งวดเรท 2']
GFIN_HEADERS = ['รุ่น', 'ความจุ', 'มือ 1/มือ 2', 'ราคา']


def money(v):
    if v is None or v == '':
        return None
    n = float(v)
    assert n == int(n), f'ค่าไม่เป็นจำนวนเต็ม: {v}'
    return int(n)


def main(src, out_dir):
    wb = openpyxl.load_workbook(src, data_only=True)
    os.makedirs(out_dir, exist_ok=True)

    # ---------- ราคากลาง ----------
    rows = []
    counts = {}
    for sheet, label in [('ข้อมูลหลัก มือ 1', 'มือ 1'), ('ข้อมูลหลัก มือ 2', 'มือ 2')]:
        ws = wb[sheet]
        assert ws.cell(2, 1).value == 'รุ่น' and ws.cell(2, 2).value == 'ความจุ', f'หัวตาราง {sheet} เปลี่ยน'
        n = 0
        for r in range(3, ws.max_row + 1):
            model = ws.cell(r, 1).value
            if not model:
                continue
            n += 1
            base = {
                'ยี่ห้อ': 'Apple', 'รุ่น': str(model).strip(), 'ความจุ': str(ws.cell(r, 2).value).strip(),
                'เครื่องไทย/นอก': None, 'ประเภท': label,
                'ราคาเงินสด': money(ws.cell(r, 5).value),                       # E
                'ราคาผ่อน BESTCHOICE (ราคาเต็ม)': money(ws.cell(r, 6).value),   # F
                'ราคาขาย GFIN (ราคาเต็ม)': money(ws.cell(r, 7).value),          # G
                'งวดเรท 1': money(ws.cell(r, 8).value),                         # H
                'ดาวน์เรท 1': money(ws.cell(r, 9).value),                       # I (ว่าง = ขั้นต่ำ)
                'งวดเรท 2': money(ws.cell(r, 11).value),                        # K (ว่าง = งวดสูงสุดตาม OVER)
            }
            for key in ['ราคาเงินสด', 'ราคาผ่อน BESTCHOICE (ราคาเต็ม)', 'ราคาขาย GFIN (ราคาเต็ม)', 'งวดเรท 1']:
                assert base[key], f'{sheet} แถว {r} ไม่มี {key}'
            if label == 'มือ 1':
                rows.append({**base, 'ประกัน': None})
            else:  # ราคาเดียวกันลงทั้ง "มีประกัน" และ "ไม่มีประกัน"
                rows.append({**base, 'ประกัน': 'มีประกัน'})
                rows.append({**base, 'ประกัน': 'ไม่มีประกัน'})
        counts[label] = n
    assert counts == {'มือ 1': 8, 'มือ 2': 45}, f'จำนวนแถวไม่ตรงสเปคข้อ 8: {counts}'
    assert len(rows) == 98

    out = openpyxl.Workbook()
    ws = out.active
    ws.title = 'ราคาตั้งต้น'
    ws.append(PRICING_HEADERS)
    for row in rows:
        ws.append([row[h] for h in PRICING_HEADERS])
    pricing_path = os.path.join(out_dir, 'ราคากลาง-นำเข้า.xlsx')
    out.save(pricing_path)

    # ---------- ใบราคา GFIN ----------
    g = wb['ใบราคา G-Finn']
    assert g.cell(4, 1).value == 'รุ่น' and g.cell(4, 4).value == 'ราคามือ 1' and g.cell(4, 7).value == 'ราคามือ 2', \
        'หัวใบราคาเปลี่ยน'
    gfin = []
    n1 = n2 = 0
    for r in range(5, g.max_row + 1):
        model = g.cell(r, 1).value
        if not model:
            continue
        storage = str(g.cell(r, 2).value).strip()
        p1, p2 = money(g.cell(r, 4).value), money(g.cell(r, 7).value)
        if p1:
            gfin.append([str(model).strip(), storage, 'มือ 1', p1])
            n1 += 1
        if p2:
            gfin.append([str(model).strip(), storage, 'มือ 2', p2])
            n2 += 1
    assert (n1, n2) == (43, 63), f'จำนวนแถวใบราคาไม่ตรงสเปคข้อ 8: มือ 1 {n1} · มือ 2 {n2}'

    out = openpyxl.Workbook()
    ws = out.active
    ws.title = 'ใบราคา GFIN'
    ws.append(GFIN_HEADERS)
    for row in gfin:
        ws.append(row)
    gfin_path = os.path.join(out_dir, 'ใบราคา-GFIN-นำเข้า.xlsx')
    out.save(gfin_path)

    # ---------- สรุปกติกา OVER ให้เจ้าของกรอกในแท็บ OVER (สเปคข้อ 8) ----------
    groups = {}
    for r in range(5, g.max_row + 1):
        model = g.cell(r, 1).value
        if not model:
            continue
        for label, pc, oc, mc in [('มือ 1', 4, 5, 6), ('มือ 2', 7, 8, 9)]:
            if g.cell(r, pc).value is None:
                continue
            key = (label, money(g.cell(r, oc).value), money(g.cell(r, mc).value))
            groups.setdefault(key, [])
            if model not in groups[key]:
                groups[key].append(model)
    print('ราคากลาง:', pricing_path, f'({len(rows)} แถว)')
    print('ใบราคา GFIN:', gfin_path, f'({len(gfin)} แถว: มือ 1 {n1} · มือ 2 {n2})')
    print('กติกา OVER จากใบราคา (รุ่นคั่นด้วย |):')
    for (label, over, months), models in sorted(groups.items()):
        print(f'  {label} · OVER {over} · งวดสูงสุด {months} · {"|".join(models)}')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
```

- [ ] **Step 4: สร้างไฟล์แล้วตรวจให้ผ่าน**

Run (git bash):
```bash
cd "/d/BESTCHOICE APP/price-master-import"
py -3 -I build_import_files.py "C:/Users/what_/AppData/Local/Temp/claude/c6d66c95ab04b146/8930e9c8-75d7-4071-8d49-abc3f8867cb7/scratchpad/master-sheet-2026-11-19.xlsx" .
py -3 -I check_import_headers.py "D:/BESTCHOICE APP/BESTCHOICE/.worktrees/price-master-rest" .
```
Expected:
```
ราคากลาง: .\ราคากลาง-นำเข้า.xlsx (98 แถว)
ใบราคา GFIN: .\ใบราคา-GFIN-นำเข้า.xlsx (106 แถว: มือ 1 43 · มือ 2 63)
กติกา OVER จากใบราคา (รุ่นคั่นด้วย |):
  มือ 1 · OVER 1000 · งวดสูงสุด 12 · iPhone 13|iPhone 14|iPhone 14 Plus|iPhone 15|iPhone 15 Plus
  มือ 1 · OVER 1000 · งวดสูงสุด 15 · iPhone 15 Pro|iPhone 15 Pro Max
  มือ 1 · OVER 2000 · งวดสูงสุด 15 · iPhone 16|iPhone 16e|iPhone 16 Plus|iPhone 16 Pro|iPhone 16 Pro Max|iPhone 17|iPhone Air|iPhone 17 Pro|iPhone 17 Pro Max|iPhone 17e|iPhone 18 Pro|iPhone 18 Pro Max
  มือ 2 · OVER 0 · งวดสูงสุด 12 · iPhone 13|iPhone 13 Pro|iPhone 13 Pro Max|iPhone 14 Pro
  มือ 2 · OVER 2000 · งวดสูงสุด 12 · iPhone 14|iPhone 14 Plus|iPhone 14 Pro|iPhone 14 Pro Max|iPhone 15|iPhone 15 Plus|iPhone 15 Pro
  มือ 2 · OVER 2000 · งวดสูงสุด 15 · iPhone 15 Pro Max|iPhone 16|iPhone 16e|iPhone 16 Plus|iPhone 16 Pro|iPhone 16 Pro Max|iPhone 17|iPhone Air|iPhone 17 Pro|iPhone 17 Pro Max|iPhone 17e
OK ราคากลาง-นำเข้า.xlsx 98 แถว
OK ใบราคา-GFIN-นำเข้า.xlsx 106 แถว
```
(iPhone 14 Pro มือ 2 อยู่สองกลุ่ม = คำถามเปิดข้อ 3 ของสเปค — ให้เจ้าของเลือกก่อนกรอกแท็บ OVER)

- [ ] **Step 5: ทดลองนำเข้าบนเครื่อง (ไม่ commit)**

เปิดเว็บ local → ตั้งค่า › สินค้า › ราคาตั้งต้น → "นำเข้า Excel" เลือก `ราคากลาง-นำเข้า.xlsx` → หน้าตรวจต้องขึ้น "เพิ่ม 98" (ฐานข้อมูลว่าง) ไม่มีแถวข้าม → ยืนยัน → ตาราง 98 แถว · iPhone 17 Pro 256GB มือ 1 แสดง "เรท 1: 12 งวด · ดาวน์ 15,000" · iPhone 18 Pro 256GB "เรท 2: 15 งวด"
ตั้งค่า GFIN › ใบราคา → "นำเข้า Excel" เลือก `ใบราคา-GFIN-นำเข้า.xlsx` → "เพิ่ม 106" → ยืนยัน (2 ชุด) → นำเข้าซ้ำอีกครั้ง → หน้าตรวจ "ข้าม 106" ราคาเท่าเดิม ปุ่มยืนยันกดไม่ได้

---

### Task 10: ตรวจรวมช่วง 2ข

**Files:** ไม่มีไฟล์ใหม่

- [ ] **Step 1: รันชุดทดสอบที่เกี่ยวข้อง + ตรวจชนิด**

Run:
```bash
NODE_OPTIONS=--max-old-space-size=12288 npm --prefix apps/api test -- src/modules/pricing-templates src/modules/gfin-config src/modules/shop-catalog src/modules/employee-access src/modules/sales-bot
cd apps/web && npx vitest run src/components/import src/utils/excel-cell.util.test.ts src/pages/pricing-templates src/pages/__tests__ src/pages/GfinConfigPage src/data src/pages/PurchaseOrdersPage src/pages/ProductCreatePage src/pages/settings && cd ../..
cd apps/web-shop && npx vitest run && npx tsc --noEmit && cd ../..
NODE_OPTIONS=--max-old-space-size=12288 ./tools/check-types.sh all
```
Expected: PASS ทั้งหมด · TypeScript 0 errors (api · web · web-shop)

- [ ] **Step 2: ตรวจทะเบียนสิทธิ์**

Linux/macOS/CI: `node tools/check-access-coverage.mjs` → ไม่มี error
Windows (git bash):
```bash
node -e "import('node:path').then(p=>{const r=p.default.relative;p.default.relative=(a,b)=>r(a,b).split(p.default.sep).join('/');return import('./tools/check-access-coverage.mjs')})" 2>&1 | grep -E "PricingTemplatesController|GfinConfigController|Unclassified|Stale"
```
Expected: ไม่มีผลลัพธ์

- [ ] **Step 3: ตรวจบนหน้าจอจริง (local) ทั้งจอสว่าง / จอมืด และจอกว้าง / มือถือ**

1. ราคาตั้งต้น: หัวตาราง "(ราคาเต็ม)" · คอลัมน์ "งวด / ดาวน์" · ฟอร์มแก้ไม่มีช่องดาวน์เรท 2 · ดาวน์โหลดแบบฟอร์มได้ 12 คอลัมน์
2. นำเข้าไฟล์ที่แก้ราคา 1 แถว + ลบ 1 แถวออกจากไฟล์ → หน้าตรวจ "แก้ 1" พร้อม "เงินสด เดิม → ใหม่" · ตัวเลือก "ปิดแถวที่เปิดใช้อยู่แต่ไม่อยู่ในไฟล์ (1 แถว)" · ติ๊กแล้วยืนยัน → แถวนั้นหายจากตาราง
3. ตั้งค่า GFIN แท็บ "ใบราคา": ปุ่มดาวน์โหลดแบบฟอร์ม / นำเข้า Excel · หน้าตรวจ · ไม่มี `confirm()` ใหม่
4. เว็บ shop หน้าสินค้าผ่อนได้: ตัวเลือกจำนวนงวดเหลือเฉพาะงวดที่ตั้งค่าดอกเบี้ยมีอัตรา (เช่น 10, 12) · ค่างวดเป็นบาทเต็ม
5. หน้าเพิ่มสินค้า / ใบสั่งซื้อ: เลือก iPhone 18 Pro Max ได้ สี Black / Silver / Glacier / Burgundy · ความจุ 256GB–2TB

- [ ] **Step 4: เปิด PR (รวม 2ก + 2ข เป็น PR เดียว หรือสองชิ้นที่ deploy พร้อมกัน)**

หัวข้อ: `feat: model quotes, price imports and full-price template meaning (price master phase 2)`
เนื้อหา: ลิงก์สเปค + แผน 2ก/2ข · ผลตรวจหน้าจอ (2ก Task 9 + 2ข Task 10) · **ลำดับขึ้นระบบ (สเปคข้อ 9)**: ตรวจราคากลางบนระบบจริงก่อน (ถ้าช่องราคาผ่อนกรอกเป็นค่างวด บอทจะอ่านเป็นราคาเต็มทันทีที่ขึ้นโค้ด) → ขึ้นโค้ด → เจ้าของนำเข้าใบราคา GFIN + ราคากลาง (ติ๊กปิดแถวเดิม) ในช่วงเวลาเดียวกัน · ไฟล์นำเข้าอยู่ที่ `D:\BESTCHOICE APP\price-master-import\` · demo training ต้อง deploy แยก · ลงท้ายด้วย `🤖 Generated with [Claude Code](https://claude.com/claude-code)`

---

## สิ่งที่แผนนี้ไม่ทำ

- ปุ่ม "เติมราคาขาย GFIN ให้เครื่องในสต๊อก" และ `Product.financePrice` (ช่วง 4)
- หน้า "ราคาและเรทผ่อน" ของพนักงาน (ช่วง 3 — ใช้ `GET /pricing-templates/quotes` ของ 2ก)
- กรอกกติกา OVER / เรท GFIN / ตั้งค่าดอกเบี้ย — เจ้าของกรอกเองในโปรแกรม (สเปคข้อ 8 ท้าย)
- ปิดแถวใบราคา GFIN รูปแบบเก่า (รุ่นหลัก + รุ่นย่อย) อัตโนมัติ — หน้าตรวจแค่เตือน
